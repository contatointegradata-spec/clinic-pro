// Página pública do orçamento: a paciente abre o link (sem login), confere
// os procedimentos e aprova ou recusa. O token (24 bytes aleatórios) é a
// única credencial — não expomos dados além do necessário para decidir.
import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { planTotals } from './clinical'
import { notifyClinicTeam } from '../lib/notifications'

const router = Router()

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

async function loadByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null
  return prisma.treatmentPlan.findUnique({
    where: { approvalToken: token },
    include: {
      items: { orderBy: { position: 'asc' } },
      patient: { select: { name: true } },
    },
  })
}

function isExpired(plan: { validUntil: Date | null }): boolean {
  if (!plan.validUntil) return false
  // validUntil é meio-dia UTC do dia escolhido — vale até o fim desse dia.
  return plan.validUntil.getTime() + 12 * 60 * 60 * 1000 < Date.now()
}

async function publicView(plan: NonNullable<Awaited<ReturnType<typeof loadByToken>>>) {
  const doctor = await prisma.user.findUnique({
    where: { id: plan.doctorId },
    select: { name: true, specialty: true, phone: true },
  })
  return {
    title: plan.title,
    status: plan.status,
    notes: plan.notes,
    validUntil: plan.validUntil,
    expired: isExpired(plan),
    createdAt: plan.createdAt,
    approvedAt: plan.approvedAt,
    approvedName: plan.approvedName,
    rejectedAt: plan.rejectedAt,
    patientFirstName: plan.patient.name.split(' ')[0],
    professional: doctor ? { name: doctor.name, specialty: doctor.specialty } : null,
    discount: plan.discount,
    items: plan.items.map(i => ({ name: i.name, region: i.region, quantity: i.quantity, unitPrice: i.unitPrice })),
    ...planTotals(plan),
  }
}

function notFound(res: Response) {
  res.status(404).json({ message: 'Orçamento não encontrado ou link inválido.' })
}

router.get('/:token', async (req, res) => {
  try {
    const plan = await loadByToken(req.params.token)
    if (!plan || plan.status === 'CANCELADO') { notFound(res); return }
    res.setHeader('Cache-Control', 'no-store')
    res.json(await publicView(plan))
  } catch (error) {
    console.error('[public-plans] get:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const decisionSchema = z.object({
  decision: z.enum(['APROVAR', 'RECUSAR']),
  name: z.string().trim().min(3, 'Digite seu nome completo').max(160),
  accepted: z.boolean().optional(),
})

router.post('/:token/decision', async (req, res) => {
  try {
    const data = decisionSchema.parse(req.body)
    const plan = await loadByToken(req.params.token)
    if (!plan || plan.status === 'CANCELADO') { notFound(res); return }
    if (!['RASCUNHO', 'ENVIADO'].includes(plan.status)) {
      res.status(409).json({ message: 'Este orçamento já foi respondido.' })
      return
    }
    if (isExpired(plan)) {
      res.status(409).json({ message: 'Este orçamento expirou. Fale com a clínica para receber um novo.' })
      return
    }
    if (data.decision === 'APROVAR' && !data.accepted) {
      res.status(400).json({ message: 'Confirme que leu e concorda com o orçamento.' })
      return
    }
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: data.decision === 'APROVAR'
        ? { status: 'APROVADO', approvedAt: new Date(), approvedName: data.name, approvalChannel: 'LINK', approvalIp: req.ip ?? null }
        : { status: 'RECUSADO', rejectedAt: new Date(), approvedName: data.name, approvalChannel: 'LINK', approvalIp: req.ip ?? null },
      include: { items: { orderBy: { position: 'asc' } }, patient: { select: { name: true } } },
    })

    // Avisa o profissional e a recepção no sininho.
    const approved = data.decision === 'APROVAR'
    notifyClinicTeam(plan.doctorId, null, {
      title: approved ? 'Orçamento aprovado' : 'Orçamento recusado',
      message: `${plan.patient.name} ${approved ? 'aprovou' : 'recusou'} o orçamento "${plan.title}" pelo link.`,
      type: approved ? 'SUCCESS' : 'WARNING',
      category: 'CRM',
      link: `/pacientes/${plan.patientId}?aba=orcamentos`,
      entityType: 'treatmentPlan',
      entityId: plan.id,
      dedupeKey: `treatment-plan:${plan.id}:${data.decision}`,
    })

    res.json(await publicView(updated))
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: error.errors[0]?.message ?? 'Dados inválidos' })
      return
    }
    console.error('[public-plans] decision:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
