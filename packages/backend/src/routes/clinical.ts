// Recursos clínicos de odontologia e estética: odontograma, mapa de
// aplicação, fotos de antes/depois, orçamentos (planos de tratamento com
// pacotes de sessões) e retornos programados.
import { Router, Response } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { requireRole, AuthRequest } from '../middleware/auth'
import {
  resolveDoctorScope, doctorScopeWhere, loadPatientInScope, recordDoctorId, inScope,
} from '../lib/clinical-access'
import { RETURN_STATUSES } from '../lib/scheduled-returns'

const router = Router()

function handleError(res: Response, error: unknown, label: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
    return
  }
  console.error(`[clinical] ${label}:`, error)
  res.status(500).json({ message: 'Erro interno do servidor' })
}

const optionalDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional()
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined
  // 'YYYY-MM-DD' vira meio-dia UTC — evita cair no dia anterior em America/Sao_Paulo.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value)
}

// ═══ ODONTOGRAMA ════════════════════════════════════════════════════════════

const TOOTH_RE = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/
export const DENTAL_CONDITIONS = [
  'HIGIDO', 'CARIE', 'RESTAURACAO', 'RESTAURACAO_INSATISFATORIA', 'CANAL', 'COROA', 'IMPLANTE',
  'PROTESE', 'AUSENTE', 'EXTRACAO_INDICADA', 'FRATURA', 'SELANTE', 'APARELHO', 'OUTRO',
] as const

const dentalSchema = z.object({
  tooth: z.string().regex(TOOTH_RE, 'Dente inválido (numeração FDI)'),
  faces: z.array(z.enum(['O', 'M', 'D', 'V', 'L'])).default([]),
  condition: z.enum(DENTAL_CONDITIONS),
  status: z.enum(['EXISTENTE', 'PLANEJADO', 'REALIZADO']).default('EXISTENTE'),
  notes: z.string().max(2000).optional().nullable(),
  date: optionalDate,
})

router.get('/patients/:patientId/dental-chart', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const entries = await prisma.dentalChartEntry.findMany({
      where: { patientId: patient.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    })
    res.json(entries)
  } catch (error) { handleError(res, error, 'dental list') }
})

router.post('/patients/:patientId/dental-chart', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = dentalSchema.parse(req.body)
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const entry = await prisma.dentalChartEntry.create({
      data: {
        patientId: patient.id,
        doctorId: await recordDoctorId(req, patient),
        tooth: data.tooth,
        faces: data.faces,
        condition: data.condition,
        status: data.status,
        notes: data.notes || null,
        date: parseDate(data.date) ?? new Date(),
        createdById: req.user!.userId,
      },
    })
    res.status(201).json(entry)
  } catch (error) { handleError(res, error, 'dental create') }
})

router.put('/dental-chart/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = dentalSchema.partial().parse(req.body)
    const current = await prisma.dentalChartEntry.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Registro não encontrado' }); return }
    const entry = await prisma.dentalChartEntry.update({
      where: { id: current.id },
      data: {
        ...(data.tooth && { tooth: data.tooth }),
        ...(data.faces && { faces: data.faces }),
        ...(data.condition && { condition: data.condition }),
        ...(data.status && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.date && { date: parseDate(data.date) }),
      },
    })
    res.json(entry)
  } catch (error) { handleError(res, error, 'dental update') }
})

router.delete('/dental-chart/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const current = await prisma.dentalChartEntry.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Registro não encontrado' }); return }
    await prisma.dentalChartEntry.delete({ where: { id: current.id } })
    res.status(204).end()
  } catch (error) { handleError(res, error, 'dental delete') }
})

// ═══ MAPA DE APLICAÇÃO (harmonização / estética) ════════════════════════════

const applicationSchema = z.object({
  area: z.string().min(1, 'Informe a área').max(120),
  product: z.string().min(1, 'Informe o produto').max(160),
  productId: z.string().optional().nullable(),
  quantity: z.coerce.number().min(0).max(100000).optional().nullable(),
  unit: z.string().max(20).optional().nullable(),
  lot: z.string().max(80).optional().nullable(),
  technique: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  date: optionalDate,
  // Baixa opcional no estoque (unidades inteiras do produto: frasco, seringa…).
  stockQty: z.coerce.number().int().min(0).max(1000).optional(),
})

router.get('/patients/:patientId/applications', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const apps = await prisma.aestheticApplication.findMany({
      where: { patientId: patient.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    })
    res.json(apps)
  } catch (error) { handleError(res, error, 'applications list') }
})

router.post('/patients/:patientId/applications', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = applicationSchema.parse(req.body)
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const doctorId = await recordDoctorId(req, patient)

    const product = data.productId
      ? await prisma.product.findFirst({ where: { id: data.productId, doctorId } })
      : null
    if (data.productId && !product) { res.status(400).json({ message: 'Produto do estoque não encontrado' }); return }
    const stockQty = product && data.stockQty ? data.stockQty : 0
    if (product && stockQty > product.quantity) {
      res.status(400).json({ message: `Estoque insuficiente de ${product.name} (disponível: ${product.quantity} ${product.unit})` })
      return
    }

    const app = await prisma.$transaction(async (tx) => {
      const created = await tx.aestheticApplication.create({
        data: {
          patientId: patient.id,
          doctorId,
          area: data.area,
          product: data.product,
          productId: product?.id ?? null,
          quantity: data.quantity ?? null,
          unit: data.unit || null,
          lot: data.lot || null,
          technique: data.technique || null,
          notes: data.notes || null,
          date: parseDate(data.date) ?? new Date(),
          createdById: req.user!.userId,
        },
      })
      if (product && stockQty > 0) {
        await tx.product.update({ where: { id: product.id }, data: { quantity: { decrement: stockQty } } })
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: 'SAIDA',
            quantity: stockQty,
            reason: `Aplicação em ${patient.name} — ${data.area}`,
            userId: req.user!.userId,
          },
        })
      }
      return created
    })
    res.status(201).json(app)
  } catch (error) { handleError(res, error, 'applications create') }
})

router.put('/applications/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = applicationSchema.omit({ stockQty: true, productId: true }).partial().parse(req.body)
    const current = await prisma.aestheticApplication.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Registro não encontrado' }); return }
    const app = await prisma.aestheticApplication.update({
      where: { id: current.id },
      data: {
        ...(data.area && { area: data.area }),
        ...(data.product && { product: data.product }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.unit !== undefined && { unit: data.unit || null }),
        ...(data.lot !== undefined && { lot: data.lot || null }),
        ...(data.technique !== undefined && { technique: data.technique || null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.date && { date: parseDate(data.date) }),
      },
    })
    res.json(app)
  } catch (error) { handleError(res, error, 'applications update') }
})

router.delete('/applications/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const current = await prisma.aestheticApplication.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Registro não encontrado' }); return }
    await prisma.aestheticApplication.delete({ where: { id: current.id } })
    res.status(204).end()
  } catch (error) { handleError(res, error, 'applications delete') }
})

// ═══ FOTOS (antes / depois) ═════════════════════════════════════════════════

const PHOTO_CATEGORIES = ['ANTES', 'DURANTE', 'DEPOIS', 'OUTRO'] as const
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
const MAX_PHOTO_BYTES = 6 * 1024 * 1024
const MAX_THUMB_BYTES = 300 * 1024

function decodeDataUrl(value: string, maxBytes: number): { mime: string; buffer: Buffer } | null {
  const match = DATA_URL_RE.exec(value)
  if (!match) return null
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0 || buffer.length > maxBytes) return null
  return { mime: match[1], buffer }
}

const photoMetaSchema = z.object({
  category: z.enum(PHOTO_CATEGORIES).default('ANTES'),
  area: z.string().max(120).optional().nullable(),
  procedure: z.string().max(160).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  takenAt: optionalDate,
})

const photoSchema = photoMetaSchema.extend({
  image: z.string().min(1),
  thumbnail: z.string().min(1),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
})

function photoMeta(p: { id: string; patientId: string; takenAt: Date; category: string; area: string | null; procedure: string | null; notes: string | null; width: number | null; height: number | null; createdAt: Date }) {
  return {
    id: p.id, patientId: p.patientId, takenAt: p.takenAt, category: p.category, area: p.area,
    procedure: p.procedure, notes: p.notes, width: p.width, height: p.height, createdAt: p.createdAt,
  }
}

router.get('/patients/:patientId/photos', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const photos = await prisma.patientPhoto.findMany({
      where: { patientId: patient.id },
      select: {
        id: true, patientId: true, takenAt: true, category: true, area: true, procedure: true, notes: true,
        width: true, height: true, createdAt: true, thumbnail: true,
      },
      orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
    })
    res.json(photos.map(p => ({
      ...photoMeta(p),
      thumbnailUrl: `data:image/jpeg;base64,${Buffer.from(p.thumbnail).toString('base64')}`,
    })))
  } catch (error) { handleError(res, error, 'photos list') }
})

router.get('/photos/:id', async (req: AuthRequest, res) => {
  try {
    const photo = await prisma.patientPhoto.findUnique({ where: { id: req.params.id } })
    if (!photo || !(await inScope(req, photo.doctorId))) { res.status(404).json({ message: 'Foto não encontrada' }); return }
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.json({ ...photoMeta(photo), imageUrl: `data:${photo.mimeType};base64,${Buffer.from(photo.data).toString('base64')}` })
  } catch (error) { handleError(res, error, 'photo get') }
})

router.post('/patients/:patientId/photos', async (req: AuthRequest, res) => {
  try {
    const data = photoSchema.parse(req.body)
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const image = decodeDataUrl(data.image, MAX_PHOTO_BYTES)
    const thumb = decodeDataUrl(data.thumbnail, MAX_THUMB_BYTES)
    if (!image || !thumb) { res.status(400).json({ message: 'Imagem inválida ou grande demais (máx. 6 MB)' }); return }
    const photo = await prisma.patientPhoto.create({
      data: {
        patientId: patient.id,
        doctorId: await recordDoctorId(req, patient),
        category: data.category,
        area: data.area || null,
        procedure: data.procedure || null,
        notes: data.notes || null,
        takenAt: parseDate(data.takenAt) ?? new Date(),
        mimeType: image.mime,
        width: data.width ?? null,
        height: data.height ?? null,
        data: image.buffer,
        thumbnail: thumb.buffer,
        createdById: req.user!.userId,
      },
    })
    res.status(201).json({ ...photoMeta(photo), thumbnailUrl: data.thumbnail })
  } catch (error) { handleError(res, error, 'photo create') }
})

router.put('/photos/:id', async (req: AuthRequest, res) => {
  try {
    const data = photoMetaSchema.partial().parse(req.body)
    const current = await prisma.patientPhoto.findUnique({ where: { id: req.params.id }, select: { id: true, doctorId: true } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Foto não encontrada' }); return }
    const photo = await prisma.patientPhoto.update({
      where: { id: current.id },
      data: {
        ...(data.category && { category: data.category }),
        ...(data.area !== undefined && { area: data.area || null }),
        ...(data.procedure !== undefined && { procedure: data.procedure || null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.takenAt && { takenAt: parseDate(data.takenAt) }),
      },
    })
    res.json(photoMeta(photo))
  } catch (error) { handleError(res, error, 'photo update') }
})

router.delete('/photos/:id', async (req: AuthRequest, res) => {
  try {
    const current = await prisma.patientPhoto.findUnique({ where: { id: req.params.id }, select: { id: true, doctorId: true } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Foto não encontrada' }); return }
    await prisma.patientPhoto.delete({ where: { id: current.id } })
    res.status(204).end()
  } catch (error) { handleError(res, error, 'photo delete') }
})

// ═══ ORÇAMENTOS / PLANOS DE TRATAMENTO ══════════════════════════════════════

export const PLAN_STATUSES = ['RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'CONCLUIDO', 'CANCELADO'] as const
const EDITABLE_PLAN_STATUSES = ['RASCUNHO', 'ENVIADO', 'RECUSADO']

const planItemSchema = z.object({
  appointmentTypeId: z.string().optional().nullable(),
  name: z.string().min(1, 'Informe o procedimento').max(160),
  region: z.string().max(120).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(500).default(1),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
})

const planSchema = z.object({
  title: z.string().min(2, 'Informe um título').max(160),
  notes: z.string().max(4000).optional().nullable(),
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  validUntil: optionalDate.nullable(),
  items: z.array(planItemSchema).min(1, 'Adicione pelo menos um procedimento').max(100),
})

type PlanWithItems = { discount: number; items: Array<{ quantity: number; unitPrice: number; completedQty: number }> }

export function planTotals(plan: PlanWithItems) {
  const subtotal = plan.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const total = Math.max(0, subtotal - plan.discount)
  const sessions = plan.items.reduce((sum, i) => sum + i.quantity, 0)
  const sessionsDone = plan.items.reduce((sum, i) => sum + Math.min(i.completedQty, i.quantity), 0)
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round(total * 100) / 100,
    sessions,
    sessionsDone,
  }
}

function newApprovalToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function publicPlanUrl(req: AuthRequest, token: string): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')
  return `${base}/orcamento/${token}`
}

async function loadPlanInScope(req: AuthRequest, id: string) {
  const plan = await prisma.treatmentPlan.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: 'asc' } },
      patient: { select: { id: true, name: true, phone: true } },
    },
  })
  if (!plan || !(await inScope(req, plan.doctorId))) return null
  return plan
}

function serializePlan(req: AuthRequest, plan: Awaited<ReturnType<typeof loadPlanInScope>> & object) {
  return { ...plan, ...planTotals(plan), publicUrl: publicPlanUrl(req, plan.approvalToken) }
}

router.get('/treatment-plans', async (req: AuthRequest, res) => {
  try {
    const scope = await resolveDoctorScope(req)
    if (scope !== null && scope.length === 0) { res.json([]); return }
    const status = typeof req.query.status === 'string' && (PLAN_STATUSES as readonly string[]).includes(req.query.status)
      ? req.query.status
      : undefined
    const plans = await prisma.treatmentPlan.findMany({
      where: { ...doctorScopeWhere(scope), ...(status && { status }) },
      include: {
        items: { orderBy: { position: 'asc' } },
        patient: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    })
    res.json(plans.map(p => serializePlan(req, p)))
  } catch (error) { handleError(res, error, 'plans list') }
})

router.get('/patients/:patientId/treatment-plans', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const plans = await prisma.treatmentPlan.findMany({
      where: { patientId: patient.id },
      include: {
        items: { orderBy: { position: 'asc' } },
        patient: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(plans.map(p => serializePlan(req, p)))
  } catch (error) { handleError(res, error, 'patient plans') }
})

router.get('/treatment-plans/:id', async (req: AuthRequest, res) => {
  try {
    const plan = await loadPlanInScope(req, req.params.id)
    if (!plan) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    res.json(serializePlan(req, plan))
  } catch (error) { handleError(res, error, 'plan get') }
})

router.post('/patients/:patientId/treatment-plans', async (req: AuthRequest, res) => {
  try {
    const data = planSchema.parse(req.body)
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const created = await prisma.treatmentPlan.create({
      data: {
        patientId: patient.id,
        doctorId: await recordDoctorId(req, patient),
        title: data.title,
        notes: data.notes || null,
        discount: data.discount,
        validUntil: data.validUntil ? parseDate(data.validUntil) : null,
        approvalToken: newApprovalToken(),
        createdById: req.user!.userId,
        items: {
          create: data.items.map((item, position) => ({
            appointmentTypeId: item.appointmentTypeId || null,
            name: item.name,
            region: item.region || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            position,
          })),
        },
      },
    })
    const plan = await loadPlanInScope(req, created.id)
    res.status(201).json(serializePlan(req, plan!))
  } catch (error) { handleError(res, error, 'plan create') }
})

router.put('/treatment-plans/:id', async (req: AuthRequest, res) => {
  try {
    const data = planSchema.parse(req.body)
    const current = await loadPlanInScope(req, req.params.id)
    if (!current) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    if (!EDITABLE_PLAN_STATUSES.includes(current.status)) {
      res.status(409).json({ message: 'Orçamento aprovado não pode ser alterado. Crie um novo orçamento.' })
      return
    }
    await prisma.$transaction([
      prisma.treatmentPlanItem.deleteMany({ where: { planId: current.id } }),
      prisma.treatmentPlan.update({
        where: { id: current.id },
        data: {
          title: data.title,
          notes: data.notes || null,
          discount: data.discount,
          validUntil: data.validUntil ? parseDate(data.validUntil) : null,
          // Editar um orçamento recusado o devolve para rascunho.
          ...(current.status === 'RECUSADO' && { status: 'RASCUNHO', rejectedAt: null }),
          items: {
            create: data.items.map((item, position) => ({
              appointmentTypeId: item.appointmentTypeId || null,
              name: item.name,
              region: item.region || null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              position,
            })),
          },
        },
      }),
    ])
    const plan = await loadPlanInScope(req, current.id)
    res.json(serializePlan(req, plan!))
  } catch (error) { handleError(res, error, 'plan update') }
})

// Marca como enviado e devolve o link público + texto pronto para o WhatsApp.
router.post('/treatment-plans/:id/send', async (req: AuthRequest, res) => {
  try {
    const plan = await loadPlanInScope(req, req.params.id)
    if (!plan) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    if (!['RASCUNHO', 'ENVIADO'].includes(plan.status)) {
      res.status(409).json({ message: 'Este orçamento não está aguardando aprovação.' })
      return
    }
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: { status: 'ENVIADO', sentAt: new Date() },
      include: { items: { orderBy: { position: 'asc' } }, patient: { select: { id: true, name: true, phone: true } } },
    })
    const url = publicPlanUrl(req, plan.approvalToken)
    const firstName = plan.patient.name.split(' ')[0]
    const message = `Olá, ${firstName}! Segue o seu orçamento "${plan.title}". Você pode conferir os detalhes e aprovar por este link: ${url}`
    res.json({ ...serializePlan(req, updated), whatsappMessage: message })
  } catch (error) { handleError(res, error, 'plan send') }
})

const manualApprovalSchema = z.object({
  approvedName: z.string().min(2).max(160).optional(),
  channel: z.enum(['PRESENCIAL', 'WHATSAPP', 'TELEFONE', 'OUTRO']).default('PRESENCIAL'),
})

router.post('/treatment-plans/:id/approve', async (req: AuthRequest, res) => {
  try {
    const data = manualApprovalSchema.parse(req.body ?? {})
    const plan = await loadPlanInScope(req, req.params.id)
    if (!plan) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    if (!EDITABLE_PLAN_STATUSES.includes(plan.status)) {
      res.status(409).json({ message: 'Este orçamento não pode ser aprovado no status atual.' })
      return
    }
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: {
        status: 'APROVADO',
        approvedAt: new Date(),
        approvedName: data.approvedName ?? plan.patient.name,
        approvalChannel: data.channel,
        rejectedAt: null,
      },
      include: { items: { orderBy: { position: 'asc' } }, patient: { select: { id: true, name: true, phone: true } } },
    })
    res.json(serializePlan(req, updated))
  } catch (error) { handleError(res, error, 'plan approve') }
})

const statusChangeSchema = z.object({ status: z.enum(['RECUSADO', 'CANCELADO', 'RASCUNHO', 'CONCLUIDO', 'APROVADO']) })

router.patch('/treatment-plans/:id/status', async (req: AuthRequest, res) => {
  try {
    const { status } = statusChangeSchema.parse(req.body)
    const plan = await loadPlanInScope(req, req.params.id)
    if (!plan) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    // APROVADO aqui só serve para reabrir um plano concluído; aprovar um
    // orçamento pendente é pelo /approve (registra quem/como aprovou).
    if (status === 'APROVADO' && plan.status !== 'CONCLUIDO') {
      res.status(409).json({ message: 'Use a aprovação do orçamento.' })
      return
    }
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: {
        status,
        ...(status === 'RECUSADO' && { rejectedAt: new Date() }),
        ...(status === 'RASCUNHO' && { approvedAt: null, approvedName: null, approvalChannel: null, rejectedAt: null }),
      },
      include: { items: { orderBy: { position: 'asc' } }, patient: { select: { id: true, name: true, phone: true } } },
    })
    res.json(serializePlan(req, updated))
  } catch (error) { handleError(res, error, 'plan status') }
})

// Registra (+1) ou desfaz (-1) uma sessão de um item — pacotes de sessões.
const sessionSchema = z.object({ delta: z.union([z.literal(1), z.literal(-1)]).default(1) })

router.post('/treatment-plan-items/:itemId/sessions', async (req: AuthRequest, res) => {
  try {
    const { delta } = sessionSchema.parse(req.body ?? {})
    const item = await prisma.treatmentPlanItem.findUnique({ where: { id: req.params.itemId }, select: { planId: true } })
    if (!item) { res.status(404).json({ message: 'Item não encontrado' }); return }
    const plan = await loadPlanInScope(req, item.planId)
    if (!plan) { res.status(404).json({ message: 'Item não encontrado' }); return }
    if (!['APROVADO', 'CONCLUIDO'].includes(plan.status)) {
      res.status(409).json({ message: 'Aprove o orçamento antes de registrar sessões.' })
      return
    }
    const target = plan.items.find(i => i.id === req.params.itemId)!
    const next = Math.max(0, Math.min(target.quantity, target.completedQty + delta))
    await prisma.treatmentPlanItem.update({ where: { id: target.id }, data: { completedQty: next } })

    const items = plan.items.map(i => (i.id === target.id ? { ...i, completedQty: next } : i))
    const allDone = items.every(i => i.completedQty >= i.quantity)
    const status = allDone ? 'CONCLUIDO' : 'APROVADO'
    const updated = await prisma.treatmentPlan.update({
      where: { id: plan.id },
      data: { status },
      include: { items: { orderBy: { position: 'asc' } }, patient: { select: { id: true, name: true, phone: true } } },
    })
    res.json(serializePlan(req, updated))
  } catch (error) { handleError(res, error, 'plan session') }
})

router.delete('/treatment-plans/:id', async (req: AuthRequest, res) => {
  try {
    const plan = await loadPlanInScope(req, req.params.id)
    if (!plan) { res.status(404).json({ message: 'Orçamento não encontrado' }); return }
    if (['APROVADO', 'CONCLUIDO'].includes(plan.status) && req.user!.role === 'SECRETARY') {
      res.status(403).json({ message: 'Apenas o profissional pode excluir um orçamento aprovado.' })
      return
    }
    await prisma.treatmentPlan.delete({ where: { id: plan.id } })
    res.status(204).end()
  } catch (error) { handleError(res, error, 'plan delete') }
})

// ═══ RETORNOS PROGRAMADOS ═══════════════════════════════════════════════════

const returnSchema = z.object({
  procedureName: z.string().min(1, 'Informe o procedimento').max(160),
  appointmentTypeId: z.string().optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  notes: z.string().max(2000).optional().nullable(),
})

const returnPatchSchema = z.object({
  status: z.enum(RETURN_STATUSES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional().nullable(),
})

const returnInclude = { patient: { select: { id: true, name: true, phone: true } } } as const

router.get('/returns', async (req: AuthRequest, res) => {
  try {
    const scope = await resolveDoctorScope(req)
    if (scope !== null && scope.length === 0) { res.json([]); return }
    const statusParam = typeof req.query.status === 'string' ? req.query.status.split(',') : ['PENDENTE', 'AVISADO']
    const statuses = statusParam.filter(s => (RETURN_STATUSES as readonly string[]).includes(s))
    const days = Number(req.query.withinDays)
    const until = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : undefined
    const returns = await prisma.scheduledReturn.findMany({
      where: {
        ...doctorScopeWhere(scope),
        ...(statuses.length > 0 && { status: { in: statuses } }),
        ...(until && { dueDate: { lte: until } }),
      },
      include: returnInclude,
      orderBy: { dueDate: 'asc' },
      take: 500,
    })
    res.json(returns)
  } catch (error) { handleError(res, error, 'returns list') }
})

router.get('/patients/:patientId/returns', async (req: AuthRequest, res) => {
  try {
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const returns = await prisma.scheduledReturn.findMany({
      where: { patientId: patient.id },
      include: returnInclude,
      orderBy: { dueDate: 'desc' },
    })
    res.json(returns)
  } catch (error) { handleError(res, error, 'patient returns') }
})

router.post('/patients/:patientId/returns', async (req: AuthRequest, res) => {
  try {
    const data = returnSchema.parse(req.body)
    const patient = await loadPatientInScope(req, req.params.patientId)
    if (!patient) { res.status(404).json({ message: 'Paciente não encontrado' }); return }
    const ret = await prisma.scheduledReturn.create({
      data: {
        patientId: patient.id,
        doctorId: await recordDoctorId(req, patient),
        procedureName: data.procedureName,
        appointmentTypeId: data.appointmentTypeId || null,
        dueDate: parseDate(data.dueDate)!,
        notes: data.notes || null,
      },
      include: returnInclude,
    })
    res.status(201).json(ret)
  } catch (error) { handleError(res, error, 'return create') }
})

router.patch('/returns/:id', async (req: AuthRequest, res) => {
  try {
    const data = returnPatchSchema.parse(req.body)
    const current = await prisma.scheduledReturn.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Retorno não encontrado' }); return }
    const ret = await prisma.scheduledReturn.update({
      where: { id: current.id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.status === 'AVISADO' && !current.notifiedAt && { notifiedAt: new Date() }),
        // Nova data volta o retorno para PENDENTE (será avisado de novo no vencimento).
        ...(data.dueDate && { dueDate: parseDate(data.dueDate), ...(!data.status && { status: 'PENDENTE', notifiedAt: null }) }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
      },
      include: returnInclude,
    })
    res.json(ret)
  } catch (error) { handleError(res, error, 'return update') }
})

router.delete('/returns/:id', async (req: AuthRequest, res) => {
  try {
    const current = await prisma.scheduledReturn.findUnique({ where: { id: req.params.id } })
    if (!current || !(await inScope(req, current.doctorId))) { res.status(404).json({ message: 'Retorno não encontrado' }); return }
    await prisma.scheduledReturn.delete({ where: { id: current.id } })
    res.status(204).end()
  } catch (error) { handleError(res, error, 'return delete') }
})

export default router
