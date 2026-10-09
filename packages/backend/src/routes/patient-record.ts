// Ficha completa da paciente: tudo o que antes ficava espalhado em menus
// (prontuário, documentos, financeiro, orçamentos, retornos) agregado por
// paciente, para a tela /pacientes/:id. Montado em /api/clinical.
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'
import { resolveDoctorScope, doctorScopeWhere, loadPatientInScope } from '../lib/clinical-access'

const router = Router()

// Palavras na anamnese que merecem destaque no topo da ficha (alergias,
// anticoagulantes, gestação etc.). É um aviso para ler a anamnese, não um
// diagnóstico.
const HEALTH_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /alerg/i, label: 'Alergia' },
  { re: /anticoag|varfarin|marevan|xarelto|aas\b|aspirina/i, label: 'Anticoagulante' },
  { re: /gestant|gr[aá]vida|gesta[cç][aã]o|amamenta/i, label: 'Gestação / amamentação' },
  { re: /diabet/i, label: 'Diabetes' },
  { re: /hipertens|press[aã]o alta/i, label: 'Hipertensão' },
  { re: /cardiopat|marca-?passo|infarto/i, label: 'Cardiopatia' },
  { re: /queloide/i, label: 'Queloide' },
  { re: /herpes/i, label: 'Herpes' },
  { re: /autoimun|l[uú]pus/i, label: 'Doença autoimune' },
]

function healthAlertsFrom(text: string): string[] {
  const found = new Set<string>()
  for (const { re, label } of HEALTH_KEYWORDS) {
    // ignora negações simples ("nega alergias", "sem alergia", "não possui …")
    const negated = new RegExp(`(nega|sem|n[aã]o (possui|tem|relata))[^.\\n]{0,30}(?:${re.source})`, 'i')
    if (re.test(text) && !negated.test(text)) found.add(label)
  }
  return [...found]
}

// Pagamentos da paciente: lançamentos com patientId direto ou via agendamento.
function paymentsWhere(patientId: string, scope: string[] | null) {
  return {
    ...doctorScopeWhere(scope),
    OR: [{ patientId }, { appointment: { patientId } }],
  }
}

router.get('/patients/:patientId/overview', async (req: AuthRequest, res) => {
  try {
    const base = await loadPatientInScope(req, req.params.patientId)
    if (!base) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const scope = await resolveDoctorScope(req)
    const pid = base.id
    const now = new Date()

    const [patient, upcoming, lastVisit, apptCounts, recentRecords, anamnese, openPlans, openReturns, payments, counts] = await Promise.all([
      prisma.patient.findUnique({
        where: { id: pid },
        select: {
          id: true, name: true, phone: true, email: true, cpf: true, rg: true, birthDate: true, address: true,
          notes: true, status: true, origin: true, createdAt: true, responsibleName: true, responsiblePhone: true,
          anonymizedAt: true,
          patientPlans: { select: { walletNumber: true, healthPlanId: true, healthPlan: { select: { name: true, type: true } } } },
        },
      }),
      prisma.appointment.findMany({
        where: { patientId: pid, date: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
        select: { id: true, date: true, type: true, title: true, status: true, room: { select: { name: true } }, doctor: { select: { name: true } } },
        orderBy: { date: 'asc' },
        take: 5,
      }),
      prisma.appointment.findFirst({
        where: { patientId: pid, status: 'COMPLETED' },
        select: { date: true, type: true },
        orderBy: { date: 'desc' },
      }),
      prisma.appointment.groupBy({ by: ['status'], where: { patientId: pid }, _count: { _all: true } }),
      prisma.medicalRecord.findMany({
        where: { patientId: pid, ...doctorScopeWhere(scope) },
        select: { id: true, type: true, title: true, date: true, procedures: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      prisma.medicalRecord.findFirst({
        where: { patientId: pid, type: 'ANAMNESE', ...doctorScopeWhere(scope) },
        select: { content: true, date: true },
        orderBy: { date: 'desc' },
      }),
      prisma.treatmentPlan.findMany({
        where: { patientId: pid, status: { in: ['ENVIADO', 'APROVADO'] } },
        select: { id: true, title: true, status: true, discount: true, items: { select: { quantity: true, unitPrice: true, completedQty: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.scheduledReturn.findMany({
        where: { patientId: pid, status: { in: ['PENDENTE', 'AVISADO', 'AGENDADO'] } },
        select: { id: true, procedureName: true, dueDate: true, status: true },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['status'],
        where: { ...paymentsWhere(pid, scope), type: 'INCOME' },
        _sum: { amount: true },
      }),
      Promise.all([
        prisma.patientPhoto.count({ where: { patientId: pid } }),
        prisma.generatedDocument.count({ where: { patientId: pid } }),
        prisma.dentalChartEntry.count({ where: { patientId: pid } }),
        prisma.aestheticApplication.count({ where: { patientId: pid } }),
        prisma.medicalRecord.count({ where: { patientId: pid, type: { not: 'SISTEMA' }, ...doctorScopeWhere(scope) } }),
      ]),
    ])

    const byStatus = Object.fromEntries(apptCounts.map(a => [a.status, a._count._all])) as Record<string, number>
    const sumBy = (s: string) => payments.find(p => p.status === s)?._sum.amount ?? 0

    res.json({
      patient,
      upcomingAppointments: upcoming,
      lastVisit,
      appointments: {
        total: apptCounts.reduce((n, a) => n + a._count._all, 0),
        completed: byStatus.COMPLETED ?? 0,
        noShow: byStatus.NO_SHOW ?? 0,
        cancelled: byStatus.CANCELLED ?? 0,
      },
      recentRecords,
      healthAlerts: anamnese ? healthAlertsFrom(anamnese.content) : [],
      lastAnamneseAt: anamnese?.date ?? null,
      openPlans: openPlans.map(p => {
        const subtotal = p.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
        return {
          id: p.id, title: p.title, status: p.status,
          total: Math.max(0, subtotal - p.discount),
          sessions: p.items.reduce((s, i) => s + i.quantity, 0),
          sessionsDone: p.items.reduce((s, i) => s + Math.min(i.completedQty, i.quantity), 0),
        }
      }),
      openReturns,
      financial: { paid: sumBy('PAID'), pending: sumBy('PENDING') },
      counts: { photos: counts[0], documents: counts[1], dentalEntries: counts[2], applications: counts[3], records: counts[4] },
    })
  } catch (error) {
    console.error('[patient-record] overview:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.get('/patients/:patientId/payments', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const scope = await resolveDoctorScope(req)
    const transactions = await prisma.transaction.findMany({
      where: paymentsWhere(patient.id, scope),
      select: {
        id: true, type: true, amount: true, description: true, date: true, status: true, paidAt: true,
        paymentMethod: true, items: true,
        paymentMethodRef: { select: { name: true } },
        appointment: { select: { id: true, date: true, type: true } },
        nfse: { select: { status: true, numeroNfse: true } },
      },
      orderBy: { date: 'desc' },
    })
    const income = transactions.filter(t => t.type === 'INCOME')
    res.json({
      transactions,
      summary: {
        paid: income.filter(t => t.status === 'PAID').reduce((s, t) => s + t.amount, 0),
        pending: income.filter(t => t.status === 'PENDING').reduce((s, t) => s + t.amount, 0),
      },
    })
  } catch (error) {
    console.error('[patient-record] payments:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.get('/patients/:patientId/documents', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const scope = await resolveDoctorScope(req)
    const docs = await prisma.generatedDocument.findMany({
      where: { patientId: patient.id, ...doctorScopeWhere(scope) },
      select: { id: true, name: true, content: true, status: true, createdAt: true, sentAt: true, createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(docs)
  } catch (error) {
    console.error('[patient-record] documents:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// Aniversariantes: ?month=1..12 (padrão: mês atual, America/Sao_Paulo).
router.get('/birthdays', async (req: AuthRequest, res) => {
  try {
    const scope = await resolveDoctorScope(req)
    if (scope !== null && scope.length === 0) { res.json([]); return }
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const month = Math.min(12, Math.max(1, Number(req.query.month) || today.getMonth() + 1))

    const patients = await prisma.patient.findMany({
      where: { ...doctorScopeWhere(scope), active: true, anonymizedAt: null, birthDate: { not: null }, status: { not: 'INATIVO' } },
      select: { id: true, name: true, phone: true, birthDate: true },
    })
    const list = patients
      .filter(p => p.birthDate!.getUTCMonth() + 1 === month)
      .map(p => {
        const bd = p.birthDate!
        const day = bd.getUTCDate()
        const year = today.getFullYear()
        const turning = year - bd.getUTCFullYear()
        const thisYear = new Date(year, month - 1, day)
        const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        const daysUntil = Math.round((thisYear.getTime() - startToday.getTime()) / 86_400_000)
        return { id: p.id, name: p.name, phone: p.phone, birthDate: bd, day, turning, daysUntil }
      })
      .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name))
    res.json({ month, patients: list })
  } catch (error) {
    console.error('[patient-record] birthdays:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
