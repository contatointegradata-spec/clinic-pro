import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const planSchema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  type: z.enum(['PARTICULAR', 'CONVENIO', 'OUTROS']).default('PARTICULAR'),
  customTypeName: z.string().optional(),
  description: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  defaultValue: z.coerce.number().min(0).optional(),
  roomId: z.string().optional().nullable(),
  procedures: z.array(z.object({
    appointmentTypeId: z.string(),
    value: z.coerce.number().min(0),
  })).optional(),
})

const PROCEDURES_INCLUDE = {
  procedures: { include: { appointmentType: { select: { id: true, name: true } } } },
} as const

// Substitui a lista de Procedimentos vinculados a um Convênio pela recebida
// no payload (apaga os removidos, faz upsert dos demais) — chamado após
// create/update do HealthPlan.
async function syncHealthPlanProcedures(healthPlanId: string, procedures?: { appointmentTypeId: string; value: number }[]) {
  if (!procedures) return
  await prisma.$transaction([
    prisma.healthPlanProcedure.deleteMany({
      where: {
        healthPlanId,
        appointmentTypeId: { notIn: procedures.map(p => p.appointmentTypeId) },
      },
    }),
    ...procedures.map(p =>
      prisma.healthPlanProcedure.upsert({
        where: { healthPlanId_appointmentTypeId: { healthPlanId, appointmentTypeId: p.appointmentTypeId } },
        create: { healthPlanId, appointmentTypeId: p.appointmentTypeId, value: p.value },
        update: { value: p.value },
      })
    ),
  ])
}

/**
 * Retorna o doctorId efetivo com base no papel do usuário autenticado.
 * - DOCTOR  → próprio userId
 * - SECRETARY → doctorId do médico vinculado
 * - ADMIN   → null (sem filtro; pode passar ?doctorId=xxx via query)
 */
async function getEffectiveDoctorId(req: AuthRequest): Promise<string | null> {
  if (!req.user) return null

  if (req.user.role === 'DOCTOR') return req.user.userId

  if (req.user.role === 'SECRETARY') {
    const link = await prisma.doctorSecretary.findFirst({
      where: { secretaryId: req.user.userId, active: true },
      select: { doctorId: true },
    })
    return link?.doctorId ?? null
  }

  // ADMIN: sem filtro automático
  return null
}

// ─── GET / — planos ativos do tenant ────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getEffectiveDoctorId(req)

    // ADMIN pode filtrar por ?doctorId=xxx; sem parâmetro vê tudo
    const filterDoctorId =
      req.user?.role === 'ADMIN'
        ? (req.query.doctorId as string | undefined) ?? undefined
        : doctorId ?? undefined

    const plans = await prisma.healthPlan.findMany({
      where: {
        active: true,
        ...(filterDoctorId ? { doctorId: filterDoctorId } : {}),
      },
      include: {
        _count: { select: { patientPlans: true } },
        room: { select: { id: true, name: true, logradouro: true, cidade: true } },
        ...PROCEDURES_INCLUDE,
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
    res.json(plans)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── GET /all — todos os planos do tenant (inclusive inativos) ───────────────
router.get('/all', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getEffectiveDoctorId(req)

    const filterDoctorId =
      req.user?.role === 'ADMIN'
        ? (req.query.doctorId as string | undefined) ?? undefined
        : doctorId ?? undefined

    const plans = await prisma.healthPlan.findMany({
      where: {
        ...(filterDoctorId ? { doctorId: filterDoctorId } : {}),
      },
      include: {
        _count: { select: { patientPlans: true } },
        room: { select: { id: true, name: true, logradouro: true, cidade: true } },
        ...PROCEDURES_INCLUDE,
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })
    res.json(plans)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── POST / — criar plano ────────────────────────────────────────────────────
router.post('/', requireRole('ADMIN', 'SECRETARY', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const data = planSchema.parse(req.body)

    const doctorId = await getEffectiveDoctorId(req)
    if (!doctorId) {
      res.status(400).json({ message: 'Não foi possível identificar o médico responsável' })
      return
    }

    // Unicidade por nome dentro do mesmo tenant
    const existing = await prisma.healthPlan.findFirst({
      where: { name: { equals: data.name }, doctorId },
    })
    if (existing) {
      res.status(400).json({ message: 'Plano com este nome já existe' })
      return
    }

    const { procedures, ...planData } = data
    const plan = await prisma.healthPlan.create({ data: { ...planData, doctorId } })
    await syncHealthPlanProcedures(plan.id, procedures)
    const withProcedures = await prisma.healthPlan.findUnique({ where: { id: plan.id }, include: PROCEDURES_INCLUDE })
    res.status(201).json(withProcedures)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── PUT /:id — atualizar plano ──────────────────────────────────────────────
router.put('/:id', requireRole('ADMIN', 'SECRETARY', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const data = planSchema.partial().parse(req.body)

    const doctorId = await getEffectiveDoctorId(req)

    // Verifica existência e propriedade (ADMIN ignora filtro de tenant)
    const plan = await prisma.healthPlan.findUnique({ where: { id } })
    if (!plan) {
      res.status(404).json({ message: 'Plano não encontrado' })
      return
    }
    if (doctorId && plan.doctorId !== doctorId) {
      res.status(403).json({ message: 'Acesso negado. Este plano pertence a outro médico.' })
      return
    }

    // Se está renomeando, garante unicidade dentro do tenant
    if (data.name && data.name !== plan.name) {
      const conflict = await prisma.healthPlan.findFirst({
        where: { name: { equals: data.name }, doctorId: plan.doctorId, NOT: { id } },
      })
      if (conflict) {
        res.status(400).json({ message: 'Plano com este nome já existe' })
        return
      }
    }

    const { procedures, ...planData } = data
    const updated = await prisma.healthPlan.update({ where: { id }, data: planData })
    await syncHealthPlanProcedures(id, procedures)
    const withProcedures = await prisma.healthPlan.findUnique({ where: { id }, include: PROCEDURES_INCLUDE })
    res.json(withProcedures)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── PATCH /:id/toggle — ativar/desativar ────────────────────────────────────
router.patch('/:id/toggle', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const plan = await prisma.healthPlan.findUnique({ where: { id } })
    if (!plan) {
      res.status(404).json({ message: 'Plano não encontrado' })
      return
    }

    const doctorId = await getEffectiveDoctorId(req)
    if (doctorId && plan.doctorId !== doctorId) {
      res.status(403).json({ message: 'Acesso negado. Este plano pertence a outro médico.' })
      return
    }

    const updated = await prisma.healthPlan.update({
      where: { id },
      data: { active: !plan.active },
    })
    res.json(updated)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── DELETE /:id — desativar plano (soft delete) ─────────────────────────────
router.delete('/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const plan = await prisma.healthPlan.findUnique({ where: { id } })
    if (!plan) {
      res.status(404).json({ message: 'Plano não encontrado' })
      return
    }

    const doctorId = await getEffectiveDoctorId(req)
    if (doctorId && plan.doctorId !== doctorId) {
      res.status(403).json({ message: 'Acesso negado. Este plano pertence a outro médico.' })
      return
    }

    await prisma.healthPlan.update({ where: { id }, data: { active: false } })
    res.json({ message: 'Plano desativado' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
