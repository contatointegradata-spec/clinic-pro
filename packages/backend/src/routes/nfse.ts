import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AuthRequest, requireRole } from '../middleware/auth'
import {
  NfseError, cancelNfse, configView, emitNfse, getDanfse, getOrCreateConfig, removeCertificate,
  saveCertificate, syncNfse, testConnection, updateConfig, usageSummary,
} from '../lib/nfse/service'

// ─── NFS-e (Emissor Público Nacional) ────────────────────────────────────────
// Montado em /api/nfse com authenticate + requireActiveSubscription.
// Mesmo escopo do Financeiro: DOCTOR opera a própria conta; ADMIN informa doctorId.

const router = Router()
router.use(requireRole('ADMIN', 'DOCTOR'))

function doctorIdOf(req: AuthRequest): string {
  if (req.user!.role === 'DOCTOR') return req.user!.userId
  const id = (req.query.doctorId as string | undefined) || (req.body?.doctorId as string | undefined)
  if (!id) throw new NfseError(400, 'doctorId obrigatório para ADMIN')
  return id
}

function handle(res: Response, err: unknown) {
  if (err instanceof NfseError) {
    res.status(err.status).json({ message: err.message, ...err.extra })
    return
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ message: err.errors[0]?.message ?? 'Dados inválidos', errors: err.errors })
    return
  }
  console.error('[nfse] erro:', (err as Error)?.message)
  res.status(500).json({ message: 'Erro interno do servidor' })
}

function serialize<T extends { dpsXml?: string | null; nfseXml?: string | null }>(n: T) {
  const { dpsXml, nfseXml, ...rest } = n
  return { ...rest, hasXml: Boolean(nfseXml || dpsXml) }
}

// ─── Configuração ────────────────────────────────────────────────────────────

const configSchema = z.object({
  ambiente: z.enum(['PRODUCAO', 'HOMOLOGACAO']).optional(),
  tipoDocumento: z.enum(['CPF', 'CNPJ']).optional(),
  documento: z.string().max(20).optional(),
  inscricaoMunicipal: z.string().max(20).nullable().optional(),
  razaoSocial: z.string().max(150).optional(),
  email: z.string().email('E-mail inválido').max(120).nullable().optional().or(z.literal('').transform(() => null)),
  telefone: z.string().max(20).nullable().optional(),
  codigoMunicipio: z.string().regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos').optional(),
  opcaoSimplesNacional: z.number().int().min(1).max(3).optional(),
  regimeApuracaoSN: z.number().int().min(1).max(3).nullable().optional(),
  regimeEspecial: z.number().int().min(0).max(9).optional(),
  codigoTributacaoNacional: z.string().regex(/^\d{2}\.?\d{2}\.?\d{2}$/, 'Código de tributação nacional: 6 dígitos (ex.: 04.01.01)').optional(),
  codigoTributacaoMunicipal: z.string().max(20).nullable().optional(),
  codigoNbs: z.string().max(20).nullable().optional(),
  descricaoServicoPadrao: z.string().min(3).max(2000).optional(),
  aliquotaIss: z.number().min(0).max(5).nullable().optional(),
  percentualTributosSN: z.number().min(0).max(100).nullable().optional(),
  serie: z.string().regex(/^\d{1,5}$/, 'Série: 1 a 5 dígitos').optional(),
  proximoNumero: z.number().int().min(1).max(999_999_999).optional(),
}).strict()

router.get('/config', async (req: AuthRequest, res) => {
  try {
    res.json(configView(await getOrCreateConfig(doctorIdOf(req))))
  } catch (err) { handle(res, err) }
})

router.put('/config', async (req: AuthRequest, res) => {
  try {
    const doctorId = doctorIdOf(req)
    const { doctorId: _ignored, ...body } = req.body ?? {}
    res.json(await updateConfig(doctorId, req.user!.userId, configSchema.parse(body)))
  } catch (err) { handle(res, err) }
})

const certSchema = z.object({
  pfxBase64: z.string().min(100, 'Arquivo inválido').max(80_000, 'Arquivo grande demais'),
  password: z.string().min(1, 'Informe a senha do certificado').max(200),
})

router.post('/config/certificate', async (req: AuthRequest, res) => {
  try {
    const { pfxBase64, password } = certSchema.parse(req.body)
    res.json(await saveCertificate(doctorIdOf(req), req.user!.userId, pfxBase64, password))
  } catch (err) { handle(res, err) }
})

router.delete('/config/certificate', async (req: AuthRequest, res) => {
  try {
    res.json(await removeCertificate(doctorIdOf(req), req.user!.userId))
  } catch (err) { handle(res, err) }
})

router.post('/config/test', async (req: AuthRequest, res) => {
  try {
    res.json(await testConnection(doctorIdOf(req)))
  } catch (err) { handle(res, err) }
})

// ─── Notas ───────────────────────────────────────────────────────────────────

router.get('/usage', async (req: AuthRequest, res) => {
  try {
    res.json(await usageSummary(doctorIdOf(req), req.query.month as string | undefined))
  } catch (err) { handle(res, err) }
})

router.get('/invoices', async (req: AuthRequest, res) => {
  try {
    const doctorId = doctorIdOf(req)
    const q = z.object({
      status: z.enum(['PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'ERROR']).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      search: z.string().max(100).optional(),
      page: z.coerce.number().int().min(0).default(0),
    }).parse(req.query)
    const where: Prisma.NfseWhereInput = { doctorId }
    if (q.status) where.status = q.status
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59-03:00`) } : {}) }
    if (q.search?.trim()) {
      const s = q.search.trim()
      const digits = s.replace(/\D/g, '')
      where.OR = [
        { tomadorNome: { contains: s, mode: 'insensitive' } },
        ...(digits ? [{ tomadorDocumento: { contains: digits } }, { numeroNfse: { contains: digits } }, { chaveAcesso: { contains: digits } }] : []),
      ]
    }
    const PAGE = 50
    const [items, total] = await Promise.all([
      prisma.nfse.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.page * PAGE, take: PAGE }),
      prisma.nfse.count({ where }),
    ])
    res.json({ items: items.map(serialize), total, pageSize: PAGE })
  } catch (err) { handle(res, err) }
})

router.get('/invoices/:id', async (req: AuthRequest, res) => {
  try {
    const n = await prisma.nfse.findFirst({
      where: { id: req.params.id, doctorId: doctorIdOf(req) },
      include: { transaction: { select: { id: true, description: true, date: true, amount: true } }, createdBy: { select: { id: true, name: true } } },
    })
    if (!n) throw new NfseError(404, 'Nota não encontrada.')
    res.json(serialize(n))
  } catch (err) { handle(res, err) }
})

const emitSchema = z.object({
  transactionId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  tomador: z.object({
    documento: z.string().max(20).nullable().optional(),
    nome: z.string().max(300).optional(),
    email: z.string().email('E-mail do tomador inválido').nullable().optional().or(z.literal('').transform(() => null)),
  }).nullable().optional(),
  valorCents: z.number().int().positive().optional(),
  descricao: z.string().max(2000).optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

router.post('/invoices', async (req: AuthRequest, res) => {
  try {
    const doctorId = doctorIdOf(req)
    const { doctorId: _ignored, ...body } = req.body ?? {}
    const nfse = await emitNfse(doctorId, req.user!.userId, emitSchema.parse(body))
    res.status(nfse.status === 'REJECTED' ? 422 : 201).json(serialize(nfse))
  } catch (err) { handle(res, err) }
})

router.post('/invoices/:id/sync', async (req: AuthRequest, res) => {
  try {
    res.json(serialize(await syncNfse(doctorIdOf(req), req.params.id)))
  } catch (err) { handle(res, err) }
})

router.post('/invoices/:id/cancel', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ motivo: z.enum(['1', '2', '9']), justificativa: z.string().min(15, 'Justificativa: mínimo 15 caracteres').max(255) }).parse(req.body)
    res.json(serialize(await cancelNfse(doctorIdOf(req), req.user!.userId, req.params.id, body.motivo, body.justificativa)))
  } catch (err) { handle(res, err) }
})

router.get('/invoices/:id/xml', async (req: AuthRequest, res) => {
  try {
    const n = await prisma.nfse.findFirst({ where: { id: req.params.id, doctorId: doctorIdOf(req) }, select: { nfseXml: true, dpsXml: true, chaveAcesso: true, idDps: true } })
    const xml = n?.nfseXml ?? n?.dpsXml
    if (!n || !xml) throw new NfseError(404, 'XML não disponível.')
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${n.chaveAcesso ? `NFSe-${n.chaveAcesso}` : n.idDps}.xml"`)
    res.send(xml)
  } catch (err) { handle(res, err) }
})

router.get('/invoices/:id/danfse', async (req: AuthRequest, res) => {
  try {
    const pdf = await getDanfse(doctorIdOf(req), req.params.id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="DANFSe-${req.params.id}.pdf"`)
    res.send(pdf)
  } catch (err) { handle(res, err) }
})

export default router
