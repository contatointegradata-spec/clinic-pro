import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { logAudit } from '../lib/secretaryAccess'

import { triggerLightAutomatedMessage } from '../lib/chatbot-light-engine'

const router = Router()
router.use(authenticate)

// Resolve o(s) doctorId(s) que o usuário atual pode enxergar — mesmo padrão
// de patients.ts/appointments.ts. ADMIN não é filtrado (visão geral).
async function resolveDoctorScope(req: AuthRequest): Promise<string[] | null> {
  if (req.user!.role === 'ADMIN') return null
  if (req.user!.role === 'DOCTOR') return [req.user!.userId]
  const links = await prisma.doctorSecretary.findMany({
    where: { secretaryId: req.user!.userId, active: true },
    select: { doctorId: true },
  })
  return links.map(l => l.doctorId)
}

const procedureSchema = z.object({
  appointmentTypeId: z.string().optional(),
  name: z.string().min(1),
  valorTabelado: z.coerce.number().min(0),
  valorPago: z.coerce.number().min(0),
})

const recordSchema = z.object({
  patientId:       z.string().min(1, 'Paciente obrigatório'),
  doctorId:        z.string().min(1, 'Médico obrigatório'),
  title:           z.string().min(2, 'Título muito curto'),
  type:            z.enum(['ANAMNESE', 'EVOLUCAO', 'PRESCRICAO', 'EXAME', 'ATESTADO', 'OUTROS']).default('EVOLUCAO'),
  date:            z.string().optional(),
  objetivoClinico: z.string().optional().default(''),
  sintese:         z.string().optional().default(''),
  encaminhamento:  z.string().optional().default(''),
  // Campos específicos de type: 'ANAMNESE' — ver buildAnamneseContent() logo
  // abaixo. Nos demais tipos ficam vazios e não são usados.
  queixaPrincipal:      z.string().optional().default(''),
  historiaDoencaAtual:  z.string().optional().default(''),
  antecedentesPessoais: z.string().optional().default(''),
  antecedentesFamiliares: z.string().optional().default(''),
  habitosVida:          z.string().optional().default(''),
  exameFisico:           z.string().optional().default(''),
  hipoteseDiagnostica:   z.string().optional().default(''),
  procedures:      z.array(procedureSchema).optional(),
})

// Monta o texto livre (content) a partir dos 3 campos estruturados — mantém
// busca textual e compatibilidade com telas/integrações que só leem `content`.
function buildContent(data: { objetivoClinico?: string; sintese?: string; encaminhamento?: string }): string {
  const parts: string[] = []
  if (data.objetivoClinico) parts.push(`Objetivo Clínico:\n${data.objetivoClinico}`)
  if (data.sintese) parts.push(`Síntese:\n${data.sintese}`)
  if (data.encaminhamento) parts.push(`Encaminhamento:\n${data.encaminhamento}`)
  return parts.join('\n\n') || '(sem conteúdo)'
}

const ANAMNESE_FIELDS = {
  queixaPrincipal: 'Queixa Principal',
  historiaDoencaAtual: 'História da Doença Atual',
  antecedentesPessoais: 'Antecedentes Pessoais',
  antecedentesFamiliares: 'Antecedentes Familiares',
  habitosVida: 'Hábitos de Vida',
  exameFisico: 'Exame Físico',
  hipoteseDiagnostica: 'Hipótese Diagnóstica / Conduta',
} as const

type AnamneseData = Record<keyof typeof ANAMNESE_FIELDS, string | undefined>

function buildAnamneseContent(data: AnamneseData): string {
  const parts: string[] = []
  for (const [key, label] of Object.entries(ANAMNESE_FIELDS) as Array<[keyof typeof ANAMNESE_FIELDS, string]>) {
    if (data[key]) parts.push(`${label}:\n${data[key]}`)
  }
  return parts.join('\n\n') || '(sem conteúdo)'
}

router.get('/', async (req: AuthRequest, res) => {
  try {
    const { patientId, doctorId } = req.query
    const where: Record<string, unknown> = {}

    if (patientId) where.patientId = patientId as string

    const scope = await resolveDoctorScope(req)
    if (scope !== null) {
      // SECRETARY/DOCTOR — restrito ao(s) médico(s) vinculado(s). Um
      // doctorId pedido via query só é aceito se estiver dentro do escopo,
      // nunca confiado "cru" (era assim antes — qualquer SECRETARY
      // conseguia pedir o prontuário de um médico ao qual não tem vínculo).
      if (doctorId && scope.includes(doctorId as string)) {
        where.doctorId = doctorId as string
      } else {
        where.doctorId = scope.length === 1 ? scope[0] : { in: scope }
      }
    }

    const records = await prisma.medicalRecord.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true, specialty: true, crm: true } },
        procedures: true,
        transaction: { select: { id: true } },
      },
      orderBy: { date: 'desc' },
    })

    res.json(records)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.get('/by-patient/:patientId', async (req: AuthRequest, res) => {
  try {
    const { patientId } = req.params
    const where: Record<string, unknown> = { patientId }

    // Sem isso, qualquer usuário autenticado (de qualquer clínica/médico)
    // conseguia ler o prontuário completo de qualquer paciente só sabendo o
    // id — era o maior vazamento cross-tenant do sistema.
    const scope = await resolveDoctorScope(req)
    if (scope !== null) {
      if (scope.length === 0) {
        res.json([])
        return
      }
      where.doctorId = scope.length === 1 ? scope[0] : { in: scope }
    }

    const records = await prisma.medicalRecord.findMany({
      where,
      include: {
        doctor: { select: { id: true, name: true, specialty: true, crm: true } },
        procedures: true,
        transaction: { select: { id: true } },
      },
      orderBy: { date: 'desc' },
    })

    // Group by doctor
    const grouped: Record<string, {
      doctor: { id: string; name: string; specialty: string | null; crm: string | null }
      records: typeof records
    }> = {}

    for (const record of records) {
      if (!grouped[record.doctorId]) {
        grouped[record.doctorId] = {
          doctor: record.doctor,
          records: [],
        }
      }
      grouped[record.doctorId].records.push(record)
    }

    if (records.length > 0) {
      await logAudit({
        userId: req.user!.userId,
        action: 'MEDICAL_RECORD_VIEWED',
        description: `Prontuário do paciente ${patientId} consultado`,
        metadata: { patientId, recordCount: records.length },
      })
    }

    res.json(Object.values(grouped))
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/', requireRole('ADMIN', 'DOCTOR', 'SECRETARY'), async (req: AuthRequest, res) => {
  try {
    const data = recordSchema.parse(req.body)

    const scope = await resolveDoctorScope(req)
    if (scope !== null && !scope.includes(data.doctorId)) {
      res.status(403).json({ message: 'Acesso negado a este médico' })
      return
    }

    const {
      procedures, objetivoClinico, sintese, encaminhamento,
      queixaPrincipal, historiaDoencaAtual, antecedentesPessoais, antecedentesFamiliares,
      habitosVida, exameFisico, hipoteseDiagnostica,
      ...rest
    } = data
    const anamneseData: AnamneseData = { queixaPrincipal, historiaDoencaAtual, antecedentesPessoais, antecedentesFamiliares, habitosVida, exameFisico, hipoteseDiagnostica }
    const isAnamnese = rest.type === 'ANAMNESE'

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.medicalRecord.create({
        data: {
          ...rest,
          date: rest.date ? new Date(rest.date) : new Date(),
          content: isAnamnese ? buildAnamneseContent(anamneseData) : buildContent({ objetivoClinico, sintese, encaminhamento }),
          specialtyType: isAnamnese ? 'ANAMNESE' : 'GERAL',
          specialtyData: (isAnamnese ? anamneseData : { objetivoClinico, sintese, encaminhamento }) as Prisma.InputJsonValue,
        },
      })

      if (procedures && procedures.length > 0) {
        await tx.medicalRecordProcedure.createMany({
          data: procedures.map(p => ({
            medicalRecordId: created.id,
            appointmentTypeId: p.appointmentTypeId || null,
            name: p.name,
            valorTabelado: p.valorTabelado,
            valorPago: p.valorPago,
          })),
        })
      }

      return tx.medicalRecord.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          patient: { select: { id: true, name: true, phone: true } },
          doctor: { select: { id: true, name: true, specialty: true } },
          procedures: true,
        },
      })
    })

    if (record.patient?.phone) {
      triggerLightAutomatedMessage(record.doctorId, 'POST_CONSULTATION_SUMMARY', {
        patientName: record.patient.name,
        patientPhone: record.patient.phone,
        doctorName: record.doctor.name,
      }).catch(err => console.error('[triggerLightAutomatedMessage SUMMARY error]', err))
    }

    await logAudit({
      userId: req.user!.userId,
      action: 'MEDICAL_RECORD_CREATED',
      description: `Prontuário criado para ${record.patient?.name ?? record.patientId}`,
      metadata: { recordId: record.id, patientId: record.patientId, type: record.type },
    })

    res.status(201).json(record)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.put('/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const data = recordSchema.parse(req.body)
    const {
      procedures, objetivoClinico, sintese, encaminhamento,
      queixaPrincipal, historiaDoencaAtual, antecedentesPessoais, antecedentesFamiliares,
      habitosVida, exameFisico, hipoteseDiagnostica,
      ...rest
    } = data
    const anamneseData: AnamneseData = { queixaPrincipal, historiaDoencaAtual, antecedentesPessoais, antecedentesFamiliares, habitosVida, exameFisico, hipoteseDiagnostica }
    const isAnamnese = rest.type === 'ANAMNESE'

    const existing = await prisma.medicalRecord.findUnique({ where: { id } })
    if (!existing) {
      res.status(404).json({ message: 'Registro não encontrado' })
      return
    }

    // Sem isso, qualquer DOCTOR/ADMIN autenticado conseguia editar o
    // prontuário de um paciente de outro médico só sabendo o id do registro.
    const scope = await resolveDoctorScope(req)
    if (scope !== null && !scope.includes(existing.doctorId)) {
      res.status(403).json({ message: 'Acesso negado a este prontuário' })
      return
    }

    if (procedures && existing.billedAt) {
      res.status(409).json({ message: 'Este prontuário já foi lançado no financeiro — não é possível alterar os procedimentos.' })
      return
    }

    const record = await prisma.$transaction(async (tx) => {
      const updated = await tx.medicalRecord.update({
        where: { id },
        data: {
          ...rest,
          date: rest.date ? new Date(rest.date) : undefined,
          content: isAnamnese ? buildAnamneseContent(anamneseData) : buildContent({ objetivoClinico, sintese, encaminhamento }),
          specialtyType: isAnamnese ? 'ANAMNESE' : 'GERAL',
          specialtyData: (isAnamnese ? anamneseData : { objetivoClinico, sintese, encaminhamento }) as Prisma.InputJsonValue,
        },
      })

      if (procedures) {
        await tx.medicalRecordProcedure.deleteMany({ where: { medicalRecordId: id } })
        if (procedures.length > 0) {
          await tx.medicalRecordProcedure.createMany({
            data: procedures.map(p => ({
              medicalRecordId: id,
              appointmentTypeId: p.appointmentTypeId || null,
              name: p.name,
              valorTabelado: p.valorTabelado,
              valorPago: p.valorPago,
            })),
          })
        }
      }

      return tx.medicalRecord.findUniqueOrThrow({
        where: { id: updated.id },
        include: {
          patient: { select: { id: true, name: true } },
          doctor: { select: { id: true, name: true } },
          procedures: true,
        },
      })
    })

    await logAudit({
      userId: req.user!.userId,
      action: 'MEDICAL_RECORD_UPDATED',
      description: `Prontuário ${id} atualizado`,
      metadata: { recordId: id, patientId: record.patientId },
    })

    res.json(record)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// Prontuário é o histórico permanente do paciente — não há endpoint de
// exclusão, nem para médico/admin, mesmo que o paciente não esteja mais na
// lista do médico.

// ─── Charge Endpoint — lança os procedimentos do prontuário no financeiro ─────

const chargeSchema = z.object({
  paymentMethodId: z.string().optional(),
  paymentMethodName: z.string().optional(),
  notes: z.string().optional(),
})

router.post('/:id/charge', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const body = chargeSchema.parse(req.body)

    const record = await prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, name: true } },
        procedures: true,
        transaction: { select: { id: true } },
      },
    })

    if (!record) {
      res.status(404).json({ message: 'Registro não encontrado' })
      return
    }

    if (req.user!.role === 'DOCTOR' && record.doctorId !== req.user!.userId) {
      res.status(403).json({ message: 'Acesso negado' })
      return
    }

    if (record.billedAt || record.transaction) {
      res.status(409).json({ message: 'Este prontuário já foi lançado no financeiro' })
      return
    }

    if (record.procedures.length === 0) {
      res.status(400).json({ message: 'Nenhum procedimento para lançar' })
      return
    }

    const amount = record.procedures.reduce((sum, p) => sum + p.valorPago, 0)
    if (amount <= 0) {
      res.status(400).json({ message: 'Nenhum procedimento com valor a lançar (todos em cortesia)' })
      return
    }

    const items = record.procedures.map(p => ({ name: p.name, value: p.valorPago, valorTabelado: p.valorTabelado }))
    const now = new Date()

    const [transaction] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          doctorId:        record.doctorId,
          medicalRecordId: record.id,
          patientId:       record.patientId,
          type:            'INCOME',
          amount,
          description:     `Procedimentos (prontuário) - ${record.patient.name}`,
          date:            now,
          paidAt:          now,
          status:          'PAID',
          category:        'Procedimento',
          paymentMethodId: body.paymentMethodId ?? null,
          paymentMethod:   body.paymentMethodName ?? null,
          notes:           body.notes ?? null,
          items,
        },
      }),
      prisma.medicalRecord.update({
        where: { id },
        data: { billedAt: now },
      }),
    ])

    await logAudit({
      userId: req.user!.userId,
      action: 'MEDICAL_RECORD_CHARGED',
      description: `Prontuário ${record.id} cobrado — R$ ${amount.toFixed(2)}`,
      metadata: { recordId: record.id, patientId: record.patientId, transactionId: transaction.id, amount },
    })

    res.status(201).json({ transaction, medicalRecordId: record.id })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
