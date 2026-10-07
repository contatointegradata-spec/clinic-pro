import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

const isPrismaNotFound = (e: unknown): boolean =>
  e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2025'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { logAudit } from '../lib/secretaryAccess'
import { CLINIC_PRO_SUBSCRIPTION } from '../lib/billing-config'
import { calculateClinicAccess, getDisplayStatus, ensureAllDoctorsHaveSubscription, buildTrialWindow } from '../lib/subscription-access'
import { isSubscriptionEnforced } from '../lib/kiwify-config'

const router = Router()
router.use(authenticate)
router.use(requireRole('ADMIN'))

// GET /api/admin/overview
router.get('/overview', async (_req: AuthRequest, res) => {
  try {
    const [totalPatients, assignedPatients, totalDoctors, totalSecretaries] = await Promise.all([
      prisma.patient.count({ where: { active: true } }),
      prisma.patient.count({ where: { active: true, doctorId: { not: null } } }),
      prisma.user.count({ where: { role: 'DOCTOR', active: true } }),
      prisma.user.count({ where: { role: 'SECRETARY', active: true } }),
    ])

    res.json({
      totalPatients,
      assignedPatients,
      orphanPatients: totalPatients - assignedPatients,
      totalDoctors,
      totalSecretaries,
    })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/doctors
router.get('/doctors', async (_req: AuthRequest, res) => {
  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR', active: true },
      select: {
        id: true,
        name: true,
        email: true,
        specialty: true,
        _count: {
          select: {
            patients: true,
            doctorAppointments: true,
            doctorTeam: { where: { active: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    })
    res.json(doctors)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/patients
// TODO: Frontend currently expects a plain array. After this pagination change,
// the frontend must be updated to consume { data, total, page, totalPages } instead.
router.get('/patients', async (req: AuthRequest, res) => {
  try {
    const { doctorId, orphans, search } = req.query

    // --- Pagination params ---
    const pageRaw = parseInt(req.query.page as string, 10)
    const limitRaw = parseInt(req.query.limit as string, 10)
    const page = !isNaN(pageRaw) && pageRaw > 0 ? pageRaw : 1
    const limit = !isNaN(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
    const skip = (page - 1) * limit

    const where: Prisma.PatientWhereInput = { active: true }

    if (orphans === 'true') {
      where.doctorId = null
    } else if (doctorId) {
      where.doctorId = doctorId as string
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { cpf: { contains: search as string } },
      ]
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          cpf: true,
          doctorId: true,
          createdAt: true,
          doctor: { select: { id: true, name: true, specialty: true } },
          _count: { select: { appointments: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.patient.count({ where }),
    ])

    const totalPages = Math.ceil(total / limit)

    res.json({ data: patients, total, page, totalPages })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// PATCH /api/admin/patients/:id/doctor - reassign patient to doctor
router.patch('/patients/:id/doctor', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { doctorId } = z
      .object({ doctorId: z.string().uuid().nullable() })
      .parse(req.body)

    // Validate patient existence
    const existingPatient = await prisma.patient.findUnique({ where: { id } })
    if (!existingPatient) {
      res.status(404).json({ message: 'Paciente não encontrado' })
      return
    }

    // Validate doctorId belongs to a user with role DOCTOR
    if (doctorId !== null) {
      const doctor = await prisma.user.findUnique({
        where: { id: doctorId },
        select: { id: true, role: true, active: true },
      })
      if (!doctor || doctor.role !== 'DOCTOR') {
        res.status(400).json({ message: 'O usuário informado não é um médico válido' })
        return
      }
    }

    const patient = await prisma.$transaction(async (tx) => {
      return tx.patient.update({
        where: { id },
        data: { doctorId },
        select: {
          id: true,
          name: true,
          doctorId: true,
          doctor: { select: { id: true, name: true } },
        },
      })
    })

    res.json(patient)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    if (isPrismaNotFound(error)) {
      res.status(404).json({ message: 'Paciente não encontrado' })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// POST /api/admin/migrate-patients - auto-assign orphan patients via appointment history
router.post('/migrate-patients', async (_req: AuthRequest, res) => {
  try {
    const orphans = await prisma.patient.findMany({
      where: { doctorId: null, active: true },
      select: {
        id: true,
        name: true,
        appointments: {
          select: { doctorId: true },
          orderBy: { date: 'desc' },
          take: 1,
        },
      },
    })

    // Group patient IDs by their most recent doctorId
    const groupedByDoctor = new Map<string, string[]>()
    const unassignedResults: { patientId: string; name: string; doctorId: null }[] = []

    for (const patient of orphans) {
      const doctorId = patient.appointments[0]?.doctorId ?? null
      if (doctorId) {
        const ids = groupedByDoctor.get(doctorId) ?? []
        ids.push(patient.id)
        groupedByDoctor.set(doctorId, ids)
      } else {
        unassignedResults.push({ patientId: patient.id, name: patient.name, doctorId: null })
      }
    }

    // Build patient lookup for result reporting
    const patientMap = new Map(orphans.map((p) => [p.id, p.name]))

    // Execute all updateMany calls atomically inside a single transaction
    const assignedResults: { patientId: string; name: string; doctorId: string }[] = []

    await prisma.$transaction(async (tx) => {
      for (const [doctorId, ids] of groupedByDoctor.entries()) {
        await tx.patient.updateMany({
          where: { id: { in: ids } },
          data: { doctorId },
        })
        for (const patientId of ids) {
          assignedResults.push({
            patientId,
            name: patientMap.get(patientId) ?? '',
            doctorId,
          })
        }
      }
    })

    const assigned = assignedResults.length
    const unassigned = unassignedResults.length

    res.json({
      total: orphans.length,
      assigned,
      unassigned,
      results: [...assignedResults, ...unassignedResults],
      message: `${assigned} pacientes atribuídos automaticamente. ${unassigned} sem histórico de agendamento (atribuição manual necessária).`,
    })
  } catch (error) {
    if (isPrismaNotFound(error)) {
      res.status(404).json({ message: 'Um ou mais pacientes não foram encontrados durante a migração' })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/team - doctor with their secretaries
router.get('/team', async (_req: AuthRequest, res) => {
  try {
    const doctors = await prisma.user.findMany({
      where: { role: 'DOCTOR', active: true },
      select: {
        id: true,
        name: true,
        email: true,
        specialty: true,
        doctorTeam: {
          where: { active: true },
          include: {
            secretary: { select: { id: true, name: true, email: true, active: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    })
    res.json(doctors)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── Gestão manual de assinatura (usuários de teste, suporte) ───────────────
// Só ADMIN chega aqui (requireRole('ADMIN') no topo do arquivo). Liberar a
// assinatura do médico libera automaticamente toda a equipe vinculada — o
// acesso é sempre calculado a partir da assinatura do doctorId
// (getEffectiveDoctorId), nunca por usuário individual.

// GET /api/admin/subscriptions — lista todos os médicos com status de assinatura
// (status efetivo calculado em tempo real, não só o rótulo gravado no banco)
router.get('/subscriptions', async (_req: AuthRequest, res) => {
  try {
    await ensureAllDoctorsHaveSubscription()

    const [doctors, enforced] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'DOCTOR', active: true },
        select: {
          id: true,
          name: true,
          email: true,
          specialty: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              trialStartedAt: true,
              trialEndsAt: true,
              currentPeriodEndsAt: true,
              lastPaymentAt: true,
              blockedAt: true,
              canceledAt: true,
              adminNote: true,
              kiwifySubscriptionId: true,
              lastKiwifyOrderId: true,
              updatedAt: true,
              _count: { select: { payments: { where: { status: 'APPROVED' } } } },
            },
          },
          _count: {
            select: { doctorTeam: { where: { active: true } } },
          },
        },
        orderBy: { name: 'asc' },
      }),
      isSubscriptionEnforced(),
    ])

    const now = new Date()
    const rows = doctors.map(d => {
      const access = calculateClinicAccess(d.subscription, now)
      return {
        ...d,
        access: {
          allowed: access.allowed,
          reason: access.reason,
          displayStatus: getDisplayStatus(d.subscription, access),
          trialDaysRemaining: access.trialDaysRemaining ?? null,
        },
      }
    })

    res.json({ enforced, trialDays: CLINIC_PRO_SUBSCRIPTION.trialDays, doctors: rows })
  } catch (error) {
    console.error('[admin/subscriptions] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const bulkTrialSchema = z.object({ note: z.string().max(500).optional() })

// POST /api/admin/subscriptions/bulk-trial — concede um novo teste grátis a
// todo médico que HOJE estaria sem acesso (trial vencido, bloqueado,
// cancelado...). Pensado pro momento de ligar o bloqueio: ninguém que já
// usava o sistema é barrado sem aviso. Não mexe em quem já tem acesso.
router.post('/subscriptions/bulk-trial', async (req: AuthRequest, res) => {
  try {
    const { note } = bulkTrialSchema.parse(req.body)
    await ensureAllDoctorsHaveSubscription()

    const subs = await prisma.doctorSubscription.findMany({
      where: { doctor: { role: 'DOCTOR', active: true } },
      select: { id: true, doctorId: true, status: true, trialEndsAt: true, currentPeriodEndsAt: true },
    })

    const now = new Date()
    const targets = subs.filter(sub => !calculateClinicAccess(sub, now).allowed)
    const window = buildTrialWindow(now)

    for (const sub of targets) {
      await prisma.doctorSubscription.update({
        where: { id: sub.id },
        data: { status: 'TRIAL', ...window, blockedAt: null, canceledAt: null, adminNote: note ?? 'Teste grátis concedido em lote' },
      })
    }

    await logAudit({
      userId: req.user!.userId,
      action: 'SUBSCRIPTION_ADMIN_BULK_TRIAL',
      description: `Admin concedeu ${CLINIC_PRO_SUBSCRIPTION.trialDays} dias de teste a ${targets.length} médico(s) sem acesso`,
    })

    res.json({ updated: targets.length, trialDays: CLINIC_PRO_SUBSCRIPTION.trialDays })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    console.error('[admin/subscriptions/bulk-trial] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const grantAccessSchema = z.object({
  unlimited: z.boolean().optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  note: z.string().max(500).optional(),
})

// POST /api/admin/subscriptions/:doctorId/grant — libera acesso manualmente
router.post('/subscriptions/:doctorId/grant', async (req: AuthRequest, res) => {
  try {
    const { doctorId } = req.params
    const { unlimited, days, note } = grantAccessSchema.parse(req.body)

    const doctor = await prisma.user.findUnique({ where: { id: doctorId, role: 'DOCTOR' } })
    if (!doctor) {
      res.status(404).json({ message: 'Médico não encontrado' })
      return
    }

    const now = new Date()
    const currentPeriodEndsAt = unlimited ? null : new Date(now.getTime() + (days ?? 30) * 24 * 60 * 60 * 1000)

    const subscription = await prisma.doctorSubscription.upsert({
      where: { doctorId },
      create: {
        doctorId,
        status: 'ACTIVE',
        trialStartedAt: now,
        trialEndsAt: now,
        currentPeriodStartedAt: now,
        currentPeriodEndsAt,
        adminNote: note,
      },
      update: {
        status: 'ACTIVE',
        currentPeriodStartedAt: now,
        currentPeriodEndsAt,
        blockedAt: null,
        canceledAt: null,
        adminNote: note,
      },
    })

    await logAudit({
      userId: req.user!.userId,
      action: 'SUBSCRIPTION_ADMIN_GRANTED',
      description: `Admin liberou acesso de ${doctor.email} (${unlimited ? 'sem prazo' : `${days ?? 30} dias`})${note ? ` — ${note}` : ''}`,
    })

    res.json(subscription)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const blockAccessSchema = z.object({ note: z.string().max(500).optional() })

// POST /api/admin/subscriptions/:doctorId/block — bloqueia acesso manualmente
router.post('/subscriptions/:doctorId/block', async (req: AuthRequest, res) => {
  try {
    const { doctorId } = req.params
    const { note } = blockAccessSchema.parse(req.body)

    const doctor = await prisma.user.findUnique({ where: { id: doctorId, role: 'DOCTOR' } })
    if (!doctor) {
      res.status(404).json({ message: 'Médico não encontrado' })
      return
    }

    const subscription = await prisma.doctorSubscription.upsert({
      where: { doctorId },
      create: {
        doctorId,
        status: 'BLOCKED',
        trialStartedAt: new Date(),
        trialEndsAt: new Date(),
        blockedAt: new Date(),
        adminNote: note,
      },
      update: { status: 'BLOCKED', blockedAt: new Date(), adminNote: note },
    })

    await logAudit({
      userId: req.user!.userId,
      action: 'SUBSCRIPTION_ADMIN_BLOCKED',
      description: `Admin bloqueou acesso de ${doctor.email}${note ? ` — ${note}` : ''}`,
    })

    res.json(subscription)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const resetTrialSchema = z.object({ note: z.string().max(500).optional() })

// POST /api/admin/subscriptions/:doctorId/reset-trial — concede um novo teste grátis (CLINIC_PRO_TRIAL_DAYS)
router.post('/subscriptions/:doctorId/reset-trial', async (req: AuthRequest, res) => {
  try {
    const { doctorId } = req.params
    const { note } = resetTrialSchema.parse(req.body)

    const doctor = await prisma.user.findUnique({ where: { id: doctorId, role: 'DOCTOR' } })
    if (!doctor) {
      res.status(404).json({ message: 'Médico não encontrado' })
      return
    }

    const { trialStartedAt, trialEndsAt } = buildTrialWindow()

    const subscription = await prisma.doctorSubscription.upsert({
      where: { doctorId },
      create: { doctorId, status: 'TRIAL', trialStartedAt, trialEndsAt, adminNote: note },
      update: {
        status: 'TRIAL',
        trialStartedAt,
        trialEndsAt,
        blockedAt: null,
        canceledAt: null,
        adminNote: note,
      },
    })

    await logAudit({
      userId: req.user!.userId,
      action: 'SUBSCRIPTION_ADMIN_TRIAL_RESET',
      description: `Admin concedeu ${CLINIC_PRO_SUBSCRIPTION.trialDays} dias de teste a ${doctor.email}${note ? ` — ${note}` : ''}`,
    })

    res.json(subscription)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── Trilha de auditoria (LGPD) ─────────────────────────────────────────────
// GET /api/admin/audit-log?userId=&action=&startDate=&endDate=&page=&pageSize=
router.get('/audit-log', async (req: AuthRequest, res) => {
  try {
    const { userId, action, startDate, endDate } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))

    const where: Record<string, unknown> = {}
    if (userId) where.userId = userId as string
    if (action) where.action = action as string
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate as string) } : {}),
        ...(endDate ? { lte: new Date(endDate as string) } : {}),
      }
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    const userIds = [...new Set(entries.map(e => e.userId))]
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    })
    const userById = new Map(users.map(u => [u.id, u]))

    res.json({
      entries: entries.map(e => ({ ...e, user: userById.get(e.userId) ?? null })),
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('[admin/audit-log] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
