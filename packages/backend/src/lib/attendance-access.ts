import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { AttendanceQueue, AttendanceQueueKind, Prisma, Role } from '@prisma/client'
import { prisma } from './prisma'
import { JWT_SECRET } from '../utils/jwt'

// ─── Camada central de autorização do módulo Atendimento ─────────────────────
// TODO endpoint de /api/attendance e o stream SSE resolvem o escopo aqui e
// filtram por ele. Regra de ouro: NUNCA buscar conversa só pelo id — sempre
// via getAccessibleConversation / conversationScopeWhere.

export interface AttendanceUser {
  userId: string
  role: string
}

export interface AttendanceScope {
  // Médico "dono" dos dados (DOCTOR/ADMIN = o próprio usuário; SECRETARY = médico vinculado)
  doctorId: string
  userId: string
  role: Role
  // DOCTOR/ADMIN: acesso total às salas do médico, gestão de filas e `force` no assumir
  isDoctor: boolean
  // Salas cujas conversas o usuário pode ver
  roomIds: string[]
  // Subconjunto de roomIds onde o usuário pode responder/assumir/transferir
  replyRoomIds: string[]
}

export interface ConversationScopeRef {
  doctorId: string | null
  roomId: string | null
}

// Erro com status HTTP — as rotas convertem em { message } com o status.
// `details` (opcional) vai junto no corpo: { message, ...details }.
export class AttendanceAccessError extends Error {
  status: number
  details?: Record<string, unknown>
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AttendanceAccessError'
    this.status = status
    this.details = details
  }
}

function toRole(role: string): Role | null {
  return role === 'ADMIN' || role === 'DOCTOR' || role === 'SECRETARY' ? (role as Role) : null
}

/**
 * Resolve o escopo de atendimento do usuário autenticado.
 * - DOCTOR/ADMIN → doctorId = próprio userId (mesmo fallback de ai-agent.ts/stock.ts),
 *   todas as salas do médico, pode responder em todas.
 * - SECRETARY → médico do vínculo ativo (mesma regra de getEffectiveDoctorId);
 *   vê salas com RoomSecretary ativo + (canViewHistory OU canSendMessages);
 *   responde só onde tem canSendMessages.
 * Retorna null quando o usuário não tem acesso nenhum (ex.: secretária sem vínculo ativo).
 */
export async function resolveAttendanceScope(user: AttendanceUser): Promise<AttendanceScope | null> {
  const role = toRole(user.role)
  if (!role) return null

  if (role === 'DOCTOR' || role === 'ADMIN') {
    const rooms = await prisma.room.findMany({
      where: { doctorId: user.userId },
      select: { id: true },
    })
    const roomIds = rooms.map((r) => r.id)
    return { doctorId: user.userId, userId: user.userId, role, isDoctor: true, roomIds, replyRoomIds: roomIds }
  }

  const link = await prisma.doctorSecretary.findFirst({
    where: { secretaryId: user.userId, active: true },
    select: { doctorId: true },
  })
  if (!link) return null

  const access = await prisma.roomSecretary.findMany({
    where: {
      secretaryId: user.userId,
      active: true,
      room: { doctorId: link.doctorId },
      OR: [{ canViewHistory: true }, { canSendMessages: true }],
    },
    select: { roomId: true, canSendMessages: true },
  })

  return {
    doctorId: link.doctorId,
    userId: user.userId,
    role,
    isDoctor: false,
    roomIds: access.map((a) => a.roomId),
    replyRoomIds: access.filter((a) => a.canSendMessages).map((a) => a.roomId),
  }
}

/** Filtro Prisma que restringe conversas ao escopo (médico + salas acessíveis). */
export function conversationScopeWhere(scope: AttendanceScope): Prisma.ConversationWhereInput {
  return { doctorId: scope.doctorId, roomId: { in: scope.roomIds } }
}

/** Busca a conversa SÓ se estiver no escopo do usuário; senão null (→ 404, sem vazar existência). */
export async function getAccessibleConversation<I extends Prisma.ConversationInclude = Record<string, never>>(
  scope: AttendanceScope,
  id: string,
  include?: I,
): Promise<Prisma.ConversationGetPayload<{ include: I }> | null> {
  if (!id || scope.roomIds.length === 0) return null
  const conversation = await prisma.conversation.findFirst({
    where: { AND: [{ id }, conversationScopeWhere(scope)] },
    include,
  })
  return conversation as Prisma.ConversationGetPayload<{ include: I }> | null
}

/** Síncrono — usado para filtrar eventos do SSE sem ir ao banco. */
export function canSeeConversation(scope: AttendanceScope, conversation: ConversationScopeRef): boolean {
  return (
    conversation.doctorId === scope.doctorId &&
    conversation.roomId !== null &&
    scope.roomIds.includes(conversation.roomId)
  )
}

/** Pode responder/assumir/transferir/resolver nesta conversa? */
export function canReply(scope: AttendanceScope, conversation: ConversationScopeRef): boolean {
  return (
    canSeeConversation(scope, conversation) &&
    conversation.roomId !== null &&
    scope.replyRoomIds.includes(conversation.roomId)
  )
}

export function assertCanReply(scope: AttendanceScope, conversation: ConversationScopeRef): void {
  if (!canSeeConversation(scope, conversation)) {
    throw new AttendanceAccessError(404, 'Conversa não encontrada')
  }
  if (!canReply(scope, conversation)) {
    throw new AttendanceAccessError(403, 'Você não tem permissão para enviar mensagens nesta sala')
  }
}

/** Gestão de filas/membros: só DOCTOR/ADMIN. */
export function canManageQueues(scope: AttendanceScope): boolean {
  return scope.isDoctor
}

export interface EligibleAgent {
  id: string
  name: string
  role: Role
}

/**
 * Usuários que podem receber uma conversa (transferência para pessoa):
 * o médico + secretárias ativas do médico com canSendMessages na sala.
 * roomId null → secretárias com canSendMessages em qualquer sala do médico.
 */
export async function listEligibleAgents(doctorId: string, roomId: string | null): Promise<EligibleAgent[]> {
  const [doctor, secretaries] = await Promise.all([
    prisma.user.findFirst({
      where: { id: doctorId, active: true },
      select: { id: true, name: true, role: true },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: 'SECRETARY',
        secretaryOf: { some: { doctorId, active: true } },
        roomAssignments: {
          some: {
            active: true,
            canSendMessages: true,
            ...(roomId ? { roomId } : {}),
            room: { doctorId },
          },
        },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return doctor ? [doctor, ...secretaries] : secretaries
}

/** Verifica se o usuário-alvo pode atender conversas desta sala (transferência para pessoa). */
export async function isEligibleAgent(doctorId: string, roomId: string | null, userId: string): Promise<boolean> {
  const agents = await listEligibleAgents(doctorId, roomId)
  return agents.some((a) => a.id === userId)
}

// ─── Filas ────────────────────────────────────────────────────────────────────

const DEFAULT_QUEUES: Array<{ name: string; kind: AttendanceQueueKind; isDefault: boolean; color: string; sortOrder: number }> = [
  { name: 'Recepção', kind: 'RECEPTION', isDefault: true, color: '#3b82f6', sortOrder: 0 },
  { name: 'Médico', kind: 'DOCTOR', isDefault: false, color: '#10b981', sortOrder: 1 },
]

/**
 * Seed lazy das filas padrão. Idempotente e seguro contra corrida: só semeia
 * quando o médico não tem nenhuma fila, e o unique (doctorId, kind, name) +
 * skipDuplicates impede duplicar se duas requisições chegarem juntas.
 */
export async function ensureDefaultQueues(doctorId: string): Promise<void> {
  const count = await prisma.attendanceQueue.count({ where: { doctorId } })
  if (count > 0) return
  await prisma.attendanceQueue.createMany({
    data: DEFAULT_QUEUES.map((q) => ({ ...q, doctorId })),
    skipDuplicates: true,
  })
}

/**
 * Fila de entrada/handoff do médico: a default ativa; senão a primeira ativa;
 * senão (re)cria a "Recepção" padrão. Nunca retorna null.
 */
export async function getDefaultQueue(doctorId: string): Promise<AttendanceQueue> {
  await ensureDefaultQueues(doctorId)

  const queue =
    (await prisma.attendanceQueue.findFirst({
      where: { doctorId, isDefault: true, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })) ??
    (await prisma.attendanceQueue.findFirst({
      where: { doctorId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }))
  if (queue) return queue

  const reception = DEFAULT_QUEUES[0]
  return prisma.attendanceQueue.upsert({
    where: { doctorId_kind_name: { doctorId, kind: reception.kind, name: reception.name } },
    update: { active: true, isDefault: true },
    create: { ...reception, doctorId },
  })
}

/** Fila do médico pelo id (garante que pertence ao médico do escopo). */
export async function getScopedQueue(scope: AttendanceScope, queueId: string): Promise<AttendanceQueue | null> {
  if (!queueId) return null
  return prisma.attendanceQueue.findFirst({ where: { id: queueId, doctorId: scope.doctorId } })
}

// ─── Token do stream SSE ──────────────────────────────────────────────────────
// EventSource não envia header Authorization, então o front troca o access
// token por um token curto (60s) que vai na query string. A chave é DERIVADA
// do JWT_SECRET (HMAC com rótulo próprio): um token de stream não passa em
// verifyToken() (access token) e vice-versa, mesmo que o `purpose` fosse ignorado.

const STREAM_TOKEN_PURPOSE = 'attendance-stream'
const STREAM_TOKEN_TTL_SECONDS = 60
const STREAM_TOKEN_KEY = crypto.createHmac('sha256', JWT_SECRET).update(STREAM_TOKEN_PURPOSE).digest()

interface StreamTokenPayload {
  userId: string
  purpose: typeof STREAM_TOKEN_PURPOSE
}

export function signStreamToken(userId: string): string {
  const payload: StreamTokenPayload = { userId, purpose: STREAM_TOKEN_PURPOSE }
  return jwt.sign(payload, STREAM_TOKEN_KEY, { algorithm: 'HS256', expiresIn: STREAM_TOKEN_TTL_SECONDS })
}

/** Retorna { userId } se o token for válido, do propósito certo e não expirado; senão null. */
export function verifyStreamToken(token: string): { userId: string } | null {
  if (!token || typeof token !== 'string') return null
  try {
    const decoded = jwt.verify(token, STREAM_TOKEN_KEY, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const { userId, purpose } = decoded as Partial<StreamTokenPayload>
    if (purpose !== STREAM_TOKEN_PURPOSE || typeof userId !== 'string' || !userId) return null
    return { userId }
  } catch {
    return null
  }
}

/**
 * Valida o token do stream e recarrega o usuário do banco (ativo + role atual),
 * mesmo critério do middleware authenticate. Retorna null se inválido.
 */
export async function resolveStreamUser(token: string): Promise<AttendanceUser | null> {
  const verified = verifyStreamToken(token)
  if (!verified) return null
  const user = await prisma.user.findFirst({
    where: { id: verified.userId, active: true },
    select: { id: true, role: true },
  })
  return user ? { userId: user.id, role: user.role } : null
}
