import { Router, Request, Response, NextFunction } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'
import {
  AttendanceAccessError,
  AttendanceScope,
  canManageQueues,
  canSeeConversation,
  ensureDefaultQueues,
  getDefaultQueue,
  listEligibleAgents,
  resolveAttendanceScope,
  resolveStreamUser,
  signStreamToken,
} from '../lib/attendance-access'
import {
  addInternalNote,
  assumeConversation,
  deleteInternalNote,
  editInternalNote,
  linkConversationPatientManual,
  listPatientCandidates,
  unlinkConversationPatient,
  updateConversationContact,
  getConversationDetail,
  getSummary,
  listConversations,
  listEvents,
  listMessages,
  markConversationRead,
  reopenConversation,
  resolveConversation,
  returnConversationToBot,
  sendHumanMessage,
  startConversation,
  transferConversation,
} from '../lib/attendance'
import { subscribe, AttendanceEnvelope } from '../lib/attendance-events'
import { isSubscriptionEnforced } from '../lib/kiwify-config'
import { calculateClinicAccess } from '../lib/subscription-access'

// ─── /api/attendance ──────────────────────────────────────────────────────────
// Todo endpoint resolve o escopo em lib/attendance-access.ts e filtra por ele.
// Erros: { message } com 400/403/404/409.

type ScopedRequest = AuthRequest & { attendanceScope?: AttendanceScope }

function handleError(res: Response, err: unknown, context: string) {
  if (err instanceof AttendanceAccessError) {
    res.status(err.status).json({ ...(err.details ?? {}), message: err.message })
    return
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ message: err.errors[0]?.message || 'Dados inválidos' })
    return
  }
  console.error(`[attendance] ${context}:`, (err as Error)?.message || err)
  res.status(500).json({ message: 'Erro interno do servidor' })
}

/** Async handler com o escopo já resolvido em req.attendanceScope. */
function scoped(context: string, fn: (req: ScopedRequest, res: Response, scope: AttendanceScope) => Promise<void>) {
  return async (req: ScopedRequest, res: Response) => {
    try {
      const scope = await resolveAttendanceScope({ userId: req.user!.userId, role: req.user!.role })
      if (!scope) {
        res.status(403).json({ message: 'Você não tem acesso ao Atendimento' })
        return
      }
      req.attendanceScope = scope
      await fn(req, res, scope)
    } catch (err) {
      handleError(res, err, context)
    }
  }
}

function requireManager(scope: AttendanceScope) {
  if (!canManageQueues(scope)) throw new AttendanceAccessError(403, 'Apenas o médico pode gerenciar filas')
}

// Envio de mensagens: 30/min por usuário (além do limitador geral por IP).
const sendRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).user?.userId ?? ipKeyGenerator(req.ip ?? ''),
  message: { message: 'Muitas mensagens em pouco tempo. Aguarde alguns segundos.' },
})

const contentSchema = z.object({
  content: z.string().trim().min(1, 'Mensagem vazia').max(4096, 'Mensagem muito longa (máx. 4096 caracteres)'),
})

const colorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, 'Cor inválida')

// ─── Router principal (authenticate + requireActiveSubscription no index.ts) ─

const router = Router()

router.get('/summary', scoped('GET /summary', async (_req, res, scope) => {
  res.json(await getSummary(scope))
}))

// ─── Filas ───────────────────────────────────────────────────────────────────

async function serializeQueues(scope: AttendanceScope) {
  await ensureDefaultQueues(scope.doctorId)
  const [queues, waiting] = await Promise.all([
    prisma.attendanceQueue.findMany({
      where: { doctorId: scope.doctorId },
      include: { members: { include: { user: { select: { id: true, name: true } } } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    scope.roomIds.length > 0
      ? prisma.conversation.groupBy({
          by: ['queueId'],
          where: { doctorId: scope.doctorId, roomId: { in: scope.roomIds }, attendanceStatus: 'QUEUED' },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ queueId: string | null; _count: { _all: number } }>),
  ])
  const waitingByQueue = new Map(waiting.map((w) => [w.queueId, w._count._all]))
  return queues.map((q) => ({
    id: q.id,
    name: q.name,
    color: q.color,
    kind: q.kind,
    isDefault: q.isDefault,
    active: q.active,
    sortOrder: q.sortOrder,
    waitingCount: waitingByQueue.get(q.id) ?? 0,
    members: q.members.map((m) => ({ id: m.user.id, name: m.user.name })),
  }))
}

router.get('/queues', scoped('GET /queues', async (_req, res, scope) => {
  res.json(await serializeQueues(scope))
}))

const queueCreateSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da fila').max(60),
  color: colorSchema.optional().nullable(),
  kind: z.enum(['RECEPTION', 'DOCTOR', 'CUSTOM']).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

router.post('/queues', scoped('POST /queues', async (req, res, scope) => {
  requireManager(scope)
  const body = queueCreateSchema.parse(req.body)
  await ensureDefaultQueues(scope.doctorId)
  try {
    const created = await prisma.$transaction(async (tx) => {
      // Só uma fila padrão por médico.
      if (body.isDefault) await tx.attendanceQueue.updateMany({ where: { doctorId: scope.doctorId }, data: { isDefault: false } })
      const maxOrder = await tx.attendanceQueue.aggregate({ where: { doctorId: scope.doctorId }, _max: { sortOrder: true } })
      return tx.attendanceQueue.create({
        data: {
          doctorId: scope.doctorId,
          name: body.name,
          color: body.color ?? null,
          kind: body.kind ?? 'CUSTOM',
          isDefault: !!body.isDefault,
          sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
        },
      })
    })
    const all = await serializeQueues(scope)
    res.status(201).json(all.find((q) => q.id === created.id))
  } catch (err) {
    if (isUniqueViolation(err)) throw new AttendanceAccessError(409, 'Já existe uma fila com esse nome')
    throw err
  }
}))

const queueUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: colorSchema.optional().nullable(),
  kind: z.enum(['RECEPTION', 'DOCTOR', 'CUSTOM']).optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

router.patch('/queues/:id', scoped('PATCH /queues/:id', async (req, res, scope) => {
  requireManager(scope)
  const body = queueUpdateSchema.parse(req.body)
  const queue = await prisma.attendanceQueue.findFirst({ where: { id: req.params.id, doctorId: scope.doctorId } })
  if (!queue) throw new AttendanceAccessError(404, 'Fila não encontrada')
  if (queue.isDefault && body.isDefault === false) {
    throw new AttendanceAccessError(400, 'Defina outra fila como padrão em vez de desmarcar esta')
  }
  if ((queue.isDefault || body.isDefault) && body.active === false) {
    throw new AttendanceAccessError(400, 'A fila padrão não pode ser desativada')
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (body.isDefault && !queue.isDefault) {
        await tx.attendanceQueue.updateMany({ where: { doctorId: scope.doctorId, id: { not: queue.id } }, data: { isDefault: false } })
      }
      await tx.attendanceQueue.update({
        where: { id: queue.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.isDefault ? { isDefault: true, active: true } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      })
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new AttendanceAccessError(409, 'Já existe uma fila com esse nome')
    throw err
  }
  const all = await serializeQueues(scope)
  res.json(all.find((q) => q.id === queue.id))
}))

router.delete('/queues/:id', scoped('DELETE /queues/:id', async (req, res, scope) => {
  requireManager(scope)
  const queue = await prisma.attendanceQueue.findFirst({ where: { id: req.params.id, doctorId: scope.doctorId } })
  if (!queue) throw new AttendanceAccessError(404, 'Fila não encontrada')
  if (queue.isDefault) throw new AttendanceAccessError(400, 'A fila padrão não pode ser excluída')
  const fallback = await getDefaultQueue(scope.doctorId)
  if (fallback.id === queue.id) throw new AttendanceAccessError(400, 'A fila padrão não pode ser excluída')
  await prisma.$transaction([
    prisma.conversation.updateMany({ where: { queueId: queue.id, doctorId: scope.doctorId }, data: { queueId: fallback.id } }),
    prisma.attendanceQueue.delete({ where: { id: queue.id } }),
  ])
  res.json({ ok: true, movedTo: fallback.id })
}))

const membersSchema = z.object({ userIds: z.array(z.string().min(1)).max(200) })

router.put('/queues/:id/members', scoped('PUT /queues/:id/members', async (req, res, scope) => {
  requireManager(scope)
  const { userIds } = membersSchema.parse(req.body)
  const queue = await prisma.attendanceQueue.findFirst({ where: { id: req.params.id, doctorId: scope.doctorId } })
  if (!queue) throw new AttendanceAccessError(404, 'Fila não encontrada')

  const team = await listTeam(scope.doctorId)
  const teamIds = new Set(team.map((u) => u.id))
  const unique = Array.from(new Set(userIds))
  if (unique.some((id) => !teamIds.has(id))) throw new AttendanceAccessError(400, 'Usuário inválido para esta equipe')

  await prisma.$transaction([
    prisma.attendanceQueueMember.deleteMany({ where: { queueId: queue.id } }),
    prisma.attendanceQueueMember.createMany({ data: unique.map((userId) => ({ queueId: queue.id, userId })), skipDuplicates: true }),
  ])
  const all = await serializeQueues(scope)
  res.json(all.find((q) => q.id === queue.id))
}))

// ─── Agentes (pessoas para transferência / membros de fila) ─────────────────

/** Equipe inteira: médico + secretárias com vínculo ativo. */
async function listTeam(doctorId: string) {
  const [doctor, secretaries] = await Promise.all([
    prisma.user.findFirst({ where: { id: doctorId, active: true }, select: { id: true, name: true, role: true } }),
    prisma.user.findMany({
      where: { active: true, role: 'SECRETARY', secretaryOf: { some: { doctorId, active: true } } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return doctor ? [doctor, ...secretaries] : secretaries
}

router.get('/agents', scoped('GET /agents', async (req, res, scope) => {
  const roomId = typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : null
  if (!roomId) {
    res.json(await listTeam(scope.doctorId))
    return
  }
  if (!scope.roomIds.includes(roomId)) throw new AttendanceAccessError(404, 'Sala não encontrada')
  res.json(await listEligibleAgents(scope.doctorId, roomId))
}))

// ─── Conversas ───────────────────────────────────────────────────────────────

const listSchema = z.object({
  tab: z.enum(['mine', 'queue', 'bot', 'all', 'resolved']).default('all'),
  queueId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  search: z.string().max(100).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

router.get('/conversations', scoped('GET /conversations', async (req, res, scope) => {
  const q = listSchema.parse(req.query)
  res.json(await listConversations(scope, q))
}))

const startSchema = z
  .object({
    roomId: z.string().min(1),
    patientId: z.string().min(1).optional(),
    phone: z.string().trim().min(8).max(30).optional(),
    content: contentSchema.shape.content,
  })
  .refine((b) => !!b.patientId !== !!b.phone, { message: 'Informe o paciente OU o telefone' })

router.post('/conversations', sendRateLimiter, scoped('POST /conversations', async (req, res, scope) => {
  const body = startSchema.parse(req.body)
  res.status(201).json(await startConversation(scope, body))
}))

router.get('/conversations/:id', scoped('GET /conversations/:id', async (req, res, scope) => {
  res.json(await getConversationDetail(scope, req.params.id))
}))

const messagesQuerySchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

router.get('/conversations/:id/messages', scoped('GET /conversations/:id/messages', async (req, res, scope) => {
  const q = messagesQuerySchema.parse(req.query)
  res.json(await listMessages(scope, req.params.id, { before: q.before ? new Date(q.before) : undefined, limit: q.limit }))
}))

router.get('/conversations/:id/events', scoped('GET /conversations/:id/events', async (req, res, scope) => {
  res.json(await listEvents(scope, req.params.id))
}))

router.post('/conversations/:id/messages', sendRateLimiter, scoped('POST /conversations/:id/messages', async (req, res, scope) => {
  const { content } = contentSchema.parse(req.body)
  res.status(201).json(await sendHumanMessage(scope, req.params.id, content))
}))

router.post('/conversations/:id/notes', scoped('POST /conversations/:id/notes', async (req, res, scope) => {
  const { content } = contentSchema.parse(req.body)
  res.status(201).json(await addInternalNote(scope, req.params.id, content))
}))

// Observações internas: só o autor (ou o médico) edita/exclui — soft delete.
// Mensagens trocadas com o WhatsApp são imutáveis (400 se o id não for de observação).
router.patch('/conversations/:id/notes/:messageId', scoped('PATCH /conversations/:id/notes/:messageId', async (req, res, scope) => {
  const { content } = contentSchema.parse(req.body)
  res.json(await editInternalNote(scope, req.params.id, req.params.messageId, content))
}))

router.delete('/conversations/:id/notes/:messageId', scoped('DELETE /conversations/:id/notes/:messageId', async (req, res, scope) => {
  res.json(await deleteInternalNote(scope, req.params.id, req.params.messageId))
}))

// Contato: nome exibido (null/vazio = volta a seguir o perfil do WhatsApp).
const contactSchema = z.object({
  contactName: z.string().trim().max(120, 'Nome muito longo').nullable(),
})

router.patch('/conversations/:id', scoped('PATCH /conversations/:id', async (req, res, scope) => {
  const body = contactSchema.parse(req.body)
  res.json(await updateConversationContact(scope, req.params.id, body))
}))

// Vínculo com paciente.
const candidatesQuerySchema = z.object({ search: z.string().max(100).optional() })

router.get('/conversations/:id/patient-candidates', scoped('GET /conversations/:id/patient-candidates', async (req, res, scope) => {
  const { search } = candidatesQuerySchema.parse(req.query)
  res.json(await listPatientCandidates(scope, req.params.id, search))
}))

const linkPatientSchema = z
  .object({
    patientId: z.string().min(1).optional(),
    create: z
      .object({
        name: z.string().trim().min(2, 'Informe o nome do paciente').max(120, 'Nome muito longo'),
        confirmDuplicate: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((b) => !!b.patientId !== !!b.create, { message: 'Informe o paciente existente OU os dados do novo pré-cadastro' })

router.post('/conversations/:id/link-patient', scoped('POST /conversations/:id/link-patient', async (req, res, scope) => {
  const body = linkPatientSchema.parse(req.body)
  res.json(await linkConversationPatientManual(scope, req.params.id, body))
}))

router.delete('/conversations/:id/link-patient', scoped('DELETE /conversations/:id/link-patient', async (req, res, scope) => {
  res.json(await unlinkConversationPatient(scope, req.params.id))
}))

router.post('/conversations/:id/assume', scoped('POST /conversations/:id/assume', async (req, res, scope) => {
  const { force } = z.object({ force: z.boolean().optional() }).parse(req.body ?? {})
  res.json(await assumeConversation(scope, req.params.id, !!force))
}))

const transferSchema = z
  .object({
    queueId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((b) => !!b.queueId !== !!b.userId, { message: 'Informe exatamente um destino: fila ou pessoa' })

router.post('/conversations/:id/transfer', scoped('POST /conversations/:id/transfer', async (req, res, scope) => {
  const body = transferSchema.parse(req.body)
  res.json(await transferConversation(scope, req.params.id, body))
}))

router.post('/conversations/:id/return-to-bot', scoped('POST /conversations/:id/return-to-bot', async (req, res, scope) => {
  res.json(await returnConversationToBot(scope, req.params.id))
}))

router.post('/conversations/:id/resolve', scoped('POST /conversations/:id/resolve', async (req, res, scope) => {
  res.json(await resolveConversation(scope, req.params.id))
}))

router.post('/conversations/:id/reopen', scoped('POST /conversations/:id/reopen', async (req, res, scope) => {
  res.json(await reopenConversation(scope, req.params.id))
}))

router.post('/conversations/:id/read', scoped('POST /conversations/:id/read', async (req, res, scope) => {
  await markConversationRead(scope, req.params.id)
  res.json({ ok: true })
}))

// ─── Stream (token curto) ────────────────────────────────────────────────────

router.post('/stream-token', scoped('POST /stream-token', async (req, res) => {
  res.json({ token: signStreamToken(req.user!.userId) })
}))

export default router

// ─── SSE: GET /api/attendance/stream?token= ──────────────────────────────────
// Montado ANTES do router principal e SEM authenticate (EventSource não manda
// header Authorization): autentica pelo token curto da query e aplica o mesmo
// gate de assinatura manualmente.

const HEARTBEAT_MS = 25_000
const SCOPE_REFRESH_EVERY = 5 // heartbeats (~2 min)

async function streamSubscriptionAllowed(role: string, doctorId: string): Promise<boolean> {
  try {
    if (!(await isSubscriptionEnforced()) || role === 'ADMIN') return true
    const subscription = await prisma.doctorSubscription.findUnique({ where: { doctorId } })
    return calculateClinicAccess(subscription, new Date()).allowed
  } catch {
    return true // mesma política do middleware: falha no banco não derruba
  }
}

export const attendanceStreamRouter = Router()

attendanceStreamRouter.get('/stream', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    const user = await resolveStreamUser(token)
    if (!user) {
      res.status(401).json({ message: 'Token inválido ou expirado' })
      return
    }
    let scope = await resolveAttendanceScope(user)
    if (!scope) {
      res.status(403).json({ message: 'Você não tem acesso ao Atendimento' })
      return
    }
    if (!(await streamSubscriptionAllowed(user.role, scope.doctorId))) {
      res.status(402).json({ code: 'SUBSCRIPTION_REQUIRED', message: 'Assinatura inativa' })
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    req.socket.setTimeout(0)
    req.socket.setNoDelay(true)
    req.socket.setKeepAlive(true)
    res.write('retry: 5000\n\n')

    let closed = false
    const write = (chunk: string) => {
      if (closed) return
      try {
        res.write(chunk)
      } catch {
        cleanup()
      }
    }

    const listener = (env: AttendanceEnvelope) => {
      if (!scope) return
      if (env.onlyUserIds && !env.onlyUserIds.includes(scope.userId)) return
      if (!canSeeConversation(scope, env.ref)) return
      write(`event: ${env.event}\ndata: ${JSON.stringify(env.data)}\n\n`)
    }

    let unsubscribe = subscribe(scope.doctorId, listener)
    let beats = 0
    let refreshing = false

    const heartbeat = setInterval(async () => {
      write(': ping\n\n')
      beats++
      if (beats % SCOPE_REFRESH_EVERY !== 0 || refreshing) return
      // Revalida o acesso periodicamente: usuário desativado, vínculo/salas
      // removidos ou assinatura bloqueada → encerra/atualiza o stream.
      refreshing = true
      try {
        const fresh = await prisma.user.findFirst({ where: { id: user.userId, active: true }, select: { role: true } })
        const nextScope = fresh ? await resolveAttendanceScope({ userId: user.userId, role: fresh.role }) : null
        if (!nextScope || !(await streamSubscriptionAllowed(fresh!.role, nextScope.doctorId))) {
          write('event: revoked\ndata: {}\n\n')
          cleanup()
          res.end()
          return
        }
        if (nextScope.doctorId !== scope!.doctorId) {
          unsubscribe()
          unsubscribe = subscribe(nextScope.doctorId, listener)
        }
        scope = nextScope
      } catch {
        // mantém o escopo atual; tenta de novo no próximo ciclo
      } finally {
        refreshing = false
      }
    }, HEARTBEAT_MS)

    function cleanup() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
    }

    req.on('close', cleanup)
    res.on('error', cleanup)
  } catch (err) {
    if (!res.headersSent) handleError(res, err, 'GET /stream')
    else res.end()
  }
})
