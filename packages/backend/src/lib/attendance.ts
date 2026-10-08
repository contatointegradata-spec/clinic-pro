import { AttendanceQueue, AttendanceStatus, ConversationEventType, MessageType, PatientStatus, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  AttendanceAccessError,
  AttendanceScope,
  ConversationScopeRef,
  assertCanReply,
  conversationScopeWhere,
  getAccessibleConversation,
  getDefaultQueue,
  getScopedQueue,
  isEligibleAgent,
  listEligibleAgents,
} from './attendance-access'
import { publish } from './attendance-events'
import { notifyUsers } from './notifications'
import { computePhoneKey, findPatientByPhone, findPatientsByPhone, isLidLike, normalizePatientPhone, phoneVariants } from './phone'
import { logAudit } from './secretaryAccess'
import { checkPhoneOnWhatsApp, getRoomConnectionInfo, sendRoomWhatsAppMessage } from './room-whatsapp'
import { lookupLidsByPhones, lookupPhoneByLid, onLidMappingLearned } from './whatsapp-identity'

// ─── Regras de negócio do módulo Atendimento ─────────────────────────────────
//
// MÁQUINA DE ESTADOS (Conversation.attendanceStatus)
//
//   BOT ......... Agente de IA atendendo (sem fila, sem responsável)
//   QUEUED ...... aguardando numa fila (queueId, queuedAt; sem responsável)
//   IN_PROGRESS . com uma pessoa (assignedUserId, assignedAt)
//   RESOLVED .... finalizada (resolvedAt, resolvedById; unread zerado)
//
//   Gatilho                         De                      → Para          Evento
//   ─────────────────────────────── ─────────────────────── ─ ───────────── ─────────────────
//   1ª msg do contato               (nova)                  → BOT | QUEUED  CREATED (+BOT_STARTED)
//                                    BOT se a sala tem agente ativo; senão fila padrão
//   msg do celular (fromMe) s/ conv (nova)                  → RESOLVED      CREATED
//   msg do contato                  RESOLVED                → BOT | QUEUED  REOPENED (+BOT_STARTED)
//   msg do contato                  BOT/QUEUED/IN_PROGRESS  → (igual)       — (QUEUED/IN_PROGRESS: IA não responde)
//   IA: transfer_to_human           BOT                     → QUEUED        HANDOFF_TO_HUMAN
//   assumir / enviar mensagem       BOT/QUEUED/RESOLVED     → IN_PROGRESS   ASSUMED | REOPENED
//   assumir com force (só médico)   IN_PROGRESS(outro)      → IN_PROGRESS   ASSUMED
//   transferir p/ fila              BOT/QUEUED/IN_PROGRESS  → QUEUED        TRANSFERRED_QUEUE
//   transferir p/ pessoa            BOT/QUEUED/IN_PROGRESS  → IN_PROGRESS   TRANSFERRED_USER
//   devolver à IA (sala c/ agente)  QUEUED/IN_PROGRESS      → BOT           RETURNED_TO_BOT
//   resolver                        BOT/QUEUED/IN_PROGRESS  → RESOLVED      RESOLVED
//   reabrir                         RESOLVED                → IN_PROGRESS   REOPENED
//
//   Ações SEM transição (geram evento + conversation.updated):
//   observação interna (NOTE / NOTE_EDITED / NOTE_DELETED), editar nome do
//   contato (CONTACT_UPDATED), vincular/desvincular paciente
//   (PATIENT_LINKED / PATIENT_UNLINKED), marcar como lida (sem evento).
//
// Regras transversais:
// - Toda transição usa updateMany condicionado ao estado lido (concorrência
//   otimista: status + responsável). count = 0 → 409 "alterada por outra pessoa".
// - Conversa IN_PROGRESS com OUTRA pessoa: secretária não transfere, resolve,
//   devolve à IA nem responde (409). Médico pode (e pode assumir com force).
// - Transições/ações de escrita exigem canSendMessages na sala (assertCanReply);
//   quem só tem canViewHistory acompanha, lê e registra observações.
// - Transição para o mesmo estado é idempotente (devolve o item, sem evento),
//   exceto transferências para o destino atual, que são recusadas (400).
// - Mensagens trocadas com o WhatsApp (recebidas, IA, humanas) são IMUTÁVEIS:
//   o WhatsApp não permite editar/apagar por aqui. Só observações internas
//   são editáveis/excluíveis (soft delete: deletedAt/deletedById; conteúdo
//   preservado no banco para auditoria, omitido na API).
// - Vínculo com paciente: automático pelo telefone (findPatientByPhone) até
//   alguém vincular/desvincular manualmente (patientLinkManual) — daí a
//   ingestão não re-vincula sozinha (mesmo telefone ≠ mesma pessoa).
// - Nome do contato editado pela equipe (contactNameLocked) não é mais
//   sobrescrito pelo pushName do WhatsApp.
// - Logs NUNCA incluem conteúdo de mensagem.

const LEAD_INITIAL_STATUS = 'NOVO'
// "Em contato" no CRM real é EM_ANALISE (routes/chatbot-light.ts LEAD_STATUSES).
const LEAD_IN_CONTACT_STATUS = 'EM_ANALISE'

export const HANDOFF_TRANSITION_MESSAGE = 'Vou te transferir para a nossa equipe, já já alguém te responde 🙂'

function log(event: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'ATTENDANCE', event, ...meta }))
}

// ─── Serialização ─────────────────────────────────────────────────────────────

export const conversationListInclude = {
  room: { select: { id: true, name: true, color: true } },
  queue: { select: { id: true, name: true, color: true } },
  assignedUser: { select: { id: true, name: true } },
  patient: { select: { id: true, name: true, leadStatus: true, status: true } },
} satisfies Prisma.ConversationInclude

export type ConversationWithList = Prisma.ConversationGetPayload<{ include: typeof conversationListInclude }>

export const messageInclude = {
  author: { select: { id: true, name: true } },
} satisfies Prisma.MessageInclude

type MessageWithAuthor = Prisma.MessageGetPayload<{ include: typeof messageInclude }>

const refSelect = { select: { id: true, name: true } } as const
export const eventInclude = {
  actor: refSelect,
  fromQueue: refSelect,
  toQueue: refSelect,
  fromUser: refSelect,
  toUser: refSelect,
} satisfies Prisma.ConversationEventInclude

type EventWithRefs = Prisma.ConversationEventGetPayload<{ include: typeof eventInclude }>

export interface ConversationListItem {
  id: string
  contactName: string | null
  contactPhone: string
  contactAvatar: string | null
  room: { id: string; name: string; color: string | null }
  status: AttendanceStatus
  queue: { id: string; name: string; color: string | null } | null
  assignedUser: { id: string; name: string } | null
  unreadCount: number
  lastMessage: string | null
  lastMessageAt: string | null
  lastMessageFromMe: boolean
  queuedAt: string | null
  patient: { id: string; name: string; leadStatus: string | null; status: PatientStatus } | null
}

export interface MessageItem {
  id: string
  conversationId: string
  fromMe: boolean
  isBot: boolean
  isInternalNote: boolean
  author: { id: string; name: string } | null
  // Vazio quando a observação foi excluída (deletedAt preenchido).
  content: string
  type: MessageType
  mediaUrl: string | null
  status: string
  timestamp: string
  editedAt: string | null
  deletedAt: string | null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function toListItem(c: ConversationWithList, lastFromMe: boolean): ConversationListItem {
  return {
    id: c.id,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    contactAvatar: c.contactAvatar,
    room: c.room ? { id: c.room.id, name: c.room.name, color: c.room.color } : { id: c.roomId ?? '', name: 'Sala', color: null },
    status: c.attendanceStatus,
    queue: c.queue ? { id: c.queue.id, name: c.queue.name, color: c.queue.color } : null,
    assignedUser: c.assignedUser ? { id: c.assignedUser.id, name: c.assignedUser.name } : null,
    unreadCount: c.unreadCount,
    lastMessage: c.lastMessage,
    lastMessageAt: iso(c.lastMessageAt),
    lastMessageFromMe: lastFromMe,
    queuedAt: iso(c.queuedAt),
    patient: c.patient ? { id: c.patient.id, name: c.patient.name, leadStatus: c.patient.leadStatus, status: c.patient.status } : null,
  }
}

/** fromMe da última mensagem (não-nota) de cada conversa — DISTINCT ON usa o índice (conversationId, timestamp). */
async function lastFromMeMap(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; fromMe: boolean }>>`
    SELECT DISTINCT ON ("conversationId") "conversationId", "fromMe"
    FROM "TBLMENSAGEM"
    WHERE "conversationId" IN (${Prisma.join(ids)}) AND "isInternalNote" = false
    ORDER BY "conversationId", "timestamp" DESC`
  return new Map(rows.map((r) => [r.conversationId, r.fromMe]))
}

export async function toListItems(conversations: ConversationWithList[]): Promise<ConversationListItem[]> {
  const fromMe = await lastFromMeMap(conversations.map((c) => c.id))
  return conversations.map((c) => toListItem(c, fromMe.get(c.id) ?? false))
}

export async function toListItemOne(c: ConversationWithList): Promise<ConversationListItem> {
  return (await toListItems([c]))[0]
}

export function toMessageItem(m: MessageWithAuthor): MessageItem {
  return {
    id: m.id,
    conversationId: m.conversationId,
    fromMe: m.fromMe,
    isBot: m.isBot,
    isInternalNote: m.isInternalNote,
    author: m.author ? { id: m.author.id, name: m.author.name } : null,
    content: m.deletedAt ? '' : m.content,
    type: m.type,
    mediaUrl: m.deletedAt ? null : m.mediaUrl,
    status: m.status,
    timestamp: m.timestamp.toISOString(),
    editedAt: iso(m.editedAt),
    deletedAt: iso(m.deletedAt),
  }
}

export function toEventItem(e: EventWithRefs) {
  return {
    id: e.id,
    type: e.type,
    actor: e.actor,
    fromQueue: e.fromQueue,
    toQueue: e.toQueue,
    fromUser: e.fromUser,
    toUser: e.toUser,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }
}

// ─── Publicação (SSE) ─────────────────────────────────────────────────────────

export async function publishConversationUpdate(conversationId: string): Promise<ConversationListItem | null> {
  try {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: conversationListInclude })
    if (!conv || !conv.doctorId || !conv.roomId) return null
    const item = await toListItemOne(conv)
    publish({ doctorId: conv.doctorId, roomId: conv.roomId }, 'conversation.updated', item)
    return item
  } catch (err) {
    console.error('[attendance] publishConversationUpdate falhou:', (err as Error)?.message)
    return null
  }
}

function publishMessage(ref: ConversationScopeRef, message: MessageWithAuthor) {
  publish(ref, 'message.created', toMessageItem(message))
}

function publishMessageUpdate(ref: ConversationScopeRef, message: MessageWithAuthor) {
  publish(ref, 'message.updated', toMessageItem(message))
}

async function recordEvent(
  client: Prisma.TransactionClient | typeof prisma,
  conversationId: string,
  type: ConversationEventType,
  data: Partial<Pick<Prisma.ConversationEventUncheckedCreateInput, 'actorUserId' | 'fromQueueId' | 'toQueueId' | 'fromUserId' | 'toUserId' | 'note'>> = {},
) {
  await client.conversationEvent.create({ data: { conversationId, type, ...data } })
}

// ─── Agente de IA / Chatbot da sala ───────────────────────────────────────────

export interface RoomBotTarget {
  chatbotId: string
  instanceId: string
  builderMode: string
}

/**
 * Chatbot ativo vinculado à sala que responde automaticamente. Agente de IA
 * (builderMode ai_agent) exige systemPrompt; chatbots legados (legacy /
 * visual_builder) ainda vinculados continuam respondendo como antes.
 * Também exige a WhatsAppInstance do chatbot (o motor depende dela).
 */
export async function getRoomBotTarget(roomId: string | null): Promise<RoomBotTarget | null> {
  if (!roomId) return null
  const chatbot = await prisma.lightChatbot.findUnique({
    where: { boundRoomId: roomId },
    select: { id: true, active: true, builderMode: true, systemPrompt: true, instance: { select: { id: true } } },
  })
  if (!chatbot || !chatbot.active || !chatbot.instance) return null
  if (chatbot.builderMode === 'ai_agent' && !chatbot.systemPrompt?.trim()) return null
  return { chatbotId: chatbot.id, instanceId: chatbot.instance.id, builderMode: chatbot.builderMode }
}

export async function roomHasActiveBot(roomId: string | null): Promise<boolean> {
  return !!(await getRoomBotTarget(roomId))
}

// ─── Notificações de atendimento ──────────────────────────────────────────────

function attendanceLink(conversationId: string) {
  return `/atendimento?c=${conversationId}`
}

/** Destinatários de uma fila: membros com acesso de resposta à sala; fila sem membros → todos os elegíveis da sala. */
async function queueRecipients(doctorId: string, roomId: string | null, queueId: string | null): Promise<string[]> {
  const eligible = await listEligibleAgents(doctorId, roomId)
  const eligibleIds = eligible.map((a) => a.id)
  if (!queueId) return eligibleIds
  const members = await prisma.attendanceQueueMember.findMany({ where: { queueId }, select: { userId: true } })
  if (members.length === 0) return eligibleIds
  const memberIds = new Set(members.map((m) => m.userId))
  const filtered = eligibleIds.filter((id) => memberIds.has(id))
  return filtered.length > 0 ? filtered : eligibleIds
}

export async function notifyQueueWaiting(params: {
  conversationId: string
  doctorId: string
  roomId: string | null
  queueId: string | null
  title: string
  message: string
  excludeUserIds?: string[]
  dedupeKey?: string
}) {
  try {
    const exclude = new Set(params.excludeUserIds ?? [])
    const recipients = (await queueRecipients(params.doctorId, params.roomId, params.queueId)).filter((id) => !exclude.has(id))
    await notifyUsers(recipients, {
      title: params.title,
      message: params.message,
      type: 'INFO',
      category: 'ATENDIMENTO',
      link: attendanceLink(params.conversationId),
      entityType: 'conversation',
      entityId: params.conversationId,
      dedupeKey: params.dedupeKey ?? null,
    })
  } catch (err) {
    console.error('[attendance] notifyQueueWaiting falhou:', (err as Error)?.message)
  }
}

function contactLabel(c: { contactName: string | null; contactPhone: string; patient?: { name: string } | null }) {
  return c.patient?.name || c.contactName || c.contactPhone.replace(/@.*$/, '')
}

// ─── Ingestão de mensagens do WhatsApp ────────────────────────────────────────

export interface IngestInput {
  roomId: string
  doctorId: string
  contactPhone: string
  pushName: string | null
  identity: {
    remoteJid: string
    deliveryJid: string
    lidJid?: string
    phoneJid?: string
    normalizedPhone?: string
  }
  waMessageId: string | null
  fromMe: boolean
  content: string
  type: MessageType
  mediaUrl: string | null
  timestamp: Date
  // Mensagem do contato que foi consumida por um fluxo automático (ex.: SIM/NÃO
  // de confirmação) — grava, mas não roteia para bot/fila.
  skipRouting?: boolean
}

export interface IngestResult {
  conversationId: string
  duplicate: boolean
  // true → a mensagem deve seguir para o Agente de IA / Chatbot da sala
  dispatchToBot: boolean
}

function previewOf(content: string, type: MessageType): string {
  if (content) return content.slice(0, 500)
  const labels: Record<MessageType, string> = {
    TEXT: '', IMAGE: '[Imagem]', AUDIO: '[Áudio]', VIDEO: '[Vídeo]', DOCUMENT: '[Documento]', STICKER: '[Sticker]', LOCATION: '[Localização]',
  }
  return labels[type] || '[Mensagem]'
}

// ─── Identidade única do contato (LID ↔ telefone) ────────────────────────────
// A mesma pessoa pode chegar como @lid ou pelo número. O telefone é a chave
// canônica; conversas que se revelarem do mesmo contato são FUNDIDAS numa só,
// e o estado humano sempre vence (uma conversa em atendimento nunca volta
// para a IA só porque a mensagem chegou pelo outro identificador).

const STATUS_RANK: Record<AttendanceStatus, number> = { IN_PROGRESS: 4, QUEUED: 3, BOT: 2, RESOLVED: 1 }

function isPhoneKey(contactPhone: string): boolean {
  return /^\d{10,15}$/.test(contactPhone)
}

/** Ordem de preferência da conversa que sobrevive a uma fusão. */
function survivorOrder(a: Prisma.ConversationGetPayload<object>, b: Prisma.ConversationGetPayload<object>): number {
  const phoneA = isPhoneKey(a.contactPhone) ? 1 : 0
  const phoneB = isPhoneKey(b.contactPhone) ? 1 : 0
  if (phoneA !== phoneB) return phoneB - phoneA
  const rank = STATUS_RANK[b.attendanceStatus] - STATUS_RANK[a.attendanceStatus]
  if (rank !== 0) return rank
  return a.createdAt.getTime() - b.createdAt.getTime()
}

/**
 * Funde `dropId` em `keepId` (mesma sala, mesmo contato): move mensagens e
 * eventos, soma não lidas, preenche identidade/paciente e adota o estado de
 * atendimento de maior prioridade (IN_PROGRESS > QUEUED > BOT > RESOLVED).
 */
async function mergeConversations(keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) return
  const merged = await prisma.$transaction(async tx => {
    const [keep, drop] = await Promise.all([
      tx.conversation.findUnique({ where: { id: keepId } }),
      tx.conversation.findUnique({ where: { id: dropId } }),
    ])
    if (!keep || !drop || keep.roomId !== drop.roomId) return null

    // Mensagens já presentes na conversa mantida (mesmo waMessageId) são descartadas.
    const keepWaIds = await tx.message.findMany({
      where: { conversationId: keep.id, waMessageId: { not: null } },
      select: { waMessageId: true },
    })
    const ids = keepWaIds.map(m => m.waMessageId!).filter(Boolean)
    if (ids.length > 0) {
      await tx.message.deleteMany({ where: { conversationId: drop.id, waMessageId: { in: ids } } })
    }
    await tx.message.updateMany({ where: { conversationId: drop.id }, data: { conversationId: keep.id } })
    await tx.conversationEvent.updateMany({ where: { conversationId: drop.id }, data: { conversationId: keep.id } })

    const winner = STATUS_RANK[drop.attendanceStatus] > STATUS_RANK[keep.attendanceStatus] ? drop : keep
    const dropIsNewer = (drop.lastMessageAt?.getTime() ?? 0) > (keep.lastMessageAt?.getTime() ?? 0)
    const genericName = (n: string | null) => !n || n === 'Contato WhatsApp'

    await tx.conversation.delete({ where: { id: drop.id } })
    await tx.conversation.update({
      where: { id: keep.id },
      data: {
        attendanceStatus: winner.attendanceStatus,
        queueId: winner.queueId,
        queuedAt: winner.queuedAt,
        assignedUserId: winner.assignedUserId,
        assignedAt: winner.assignedAt,
        resolvedAt: winner.resolvedAt,
        resolvedById: winner.resolvedById,
        firstHumanResponseAt: winner.firstHumanResponseAt,
        unreadCount: keep.unreadCount + drop.unreadCount,
        lastInboundAt: [keep.lastInboundAt, drop.lastInboundAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
        ...(dropIsNewer ? { lastMessage: drop.lastMessage, lastMessageAt: drop.lastMessageAt, lastMessageSender: drop.lastMessageSender } : {}),
        // Nome editado pela equipe vence o pushName; vínculo manual vence o automático.
        ...(keep.contactNameLocked || !drop.contactNameLocked
          ? { contactName: !keep.contactNameLocked && genericName(keep.contactName) ? (drop.contactName ?? keep.contactName) : keep.contactName }
          : { contactName: drop.contactName, contactNameLocked: true }),
        contactAvatar: keep.contactAvatar ?? drop.contactAvatar,
        ...(keep.patientLinkManual || !drop.patientLinkManual
          ? { patientId: keep.patientLinkManual ? keep.patientId : (keep.patientId ?? drop.patientId) }
          : { patientId: drop.patientId, patientLinkManual: true }),
        lidJid: keep.lidJid ?? drop.lidJid,
        phoneJid: keep.phoneJid ?? drop.phoneJid,
        normalizedPhone: keep.normalizedPhone ?? drop.normalizedPhone,
        instanceId: keep.instanceId ?? drop.instanceId,
      },
    })
    await recordEvent(tx, keep.id, 'NOTE', { note: 'Conversas do mesmo contato unificadas (número e identificador do WhatsApp).' })
    return { keep, drop }
  })
  if (!merged) return

  log('conversation.merged', { intoId: keepId, fromId: dropId, roomId: merged.keep.roomId })
  const ref = { doctorId: merged.keep.doctorId, roomId: merged.keep.roomId }
  publish(ref, 'conversation.merged', { fromId: dropId, intoId: keepId })
  await publishConversationUpdate(keepId)
}

/**
 * Busca a conversa do contato na sala por TODOS os identificadores conhecidos
 * (variantes do telefone, LID, e LIDs/telefone do vínculo persistente). Se
 * houver mais de uma, funde tudo na canônica (chave = telefone) e a retorna.
 */
async function findRoomConversation(roomId: string, contactPhone: string, lidJid?: string | null, phone?: string | null) {
  const phoneDigits = phone || (isPhoneKey(contactPhone) ? contactPhone : null)
  const variants = phoneDigits ? phoneVariants(phoneDigits) : []
  const lids = new Set<string>()
  if (lidJid) lids.add(lidJid)
  if (contactPhone.endsWith('@lid')) lids.add(contactPhone)
  if (variants.length > 0) for (const l of await lookupLidsByPhones(variants)) lids.add(l)
  const lidList = [...lids]

  const candidates = await prisma.conversation.findMany({
    where: {
      roomId,
      isGroup: false,
      OR: [
        { contactPhone: { in: [contactPhone, ...variants, ...lidList] } },
        ...(lidList.length > 0 ? [{ lidJid: { in: lidList } }] : []),
        ...(variants.length > 0 ? [{ normalizedPhone: { in: variants } }] : []),
      ],
    },
  })
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const [keep, ...rest] = [...candidates].sort(survivorOrder)
  for (const drop of rest) {
    try {
      await mergeConversations(keep.id, drop.id)
    } catch (err) {
      console.error('[attendance] fusão de conversas falhou:', (err as Error)?.message)
    }
  }
  return prisma.conversation.findUnique({ where: { id: keep.id } })
}

/**
 * Chamado quando um vínculo LID ↔ telefone é aprendido: em cada sala onde o
 * contato existe, funde as conversas duplicadas e promove a chave da conversa
 * para o telefone (se ainda estiver no @lid).
 */
export async function reconcileLidConversations(lidJid: string, phone: string): Promise<void> {
  const rooms = await prisma.conversation.findMany({
    where: { isGroup: false, roomId: { not: null }, OR: [{ lidJid }, { contactPhone: lidJid }] },
    select: { roomId: true },
    distinct: ['roomId'],
  })
  for (const { roomId } of rooms) {
    const conv = await findRoomConversation(roomId!, phone, lidJid, phone)
    if (!conv) continue
    const data: Prisma.ConversationUpdateInput = {}
    if (!conv.lidJid) data.lidJid = lidJid
    if (!conv.normalizedPhone || !isPhoneKey(conv.normalizedPhone)) data.normalizedPhone = phone
    if (!conv.phoneJid) data.phoneJid = `${phone}@s.whatsapp.net`
    if (!isPhoneKey(conv.contactPhone)) data.contactPhone = phone
    if (Object.keys(data).length === 0) continue
    try {
      await prisma.conversation.update({ where: { id: conv.id }, data })
    } catch (err) {
      // Unique (roomId, contactPhone): mantém a chave antiga, só a identidade foi atualizada.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        delete data.contactPhone
        if (Object.keys(data).length > 0) await prisma.conversation.update({ where: { id: conv.id }, data }).catch(() => {})
      } else {
        throw err
      }
    }
    if (!conv.patientId && !conv.patientLinkManual && conv.doctorId) {
      const patient = await findPatientByPhone(prisma, conv.doctorId, phone).catch(() => null)
      if (patient) {
        await prisma.conversation
          .updateMany({ where: { id: conv.id, patientId: null, patientLinkManual: false }, data: { patientId: patient.id } })
          .catch(() => {})
      }
    }
    await publishConversationUpdate(conv.id)
  }
}

onLidMappingLearned((lidJid, phone) => reconcileLidConversations(lidJid, phone))

/**
 * Varredura de inicialização: unifica conversas duplicadas já existentes
 * (criadas antes do vínculo LID ↔ telefone existir). Idempotente.
 */
export async function reconcileAllLidConversations(): Promise<void> {
  try {
    const convs = await prisma.conversation.findMany({
      where: { isGroup: false, roomId: { not: null }, OR: [{ lidJid: { not: null } }, { contactPhone: { endsWith: '@lid' } }] },
      select: { lidJid: true, contactPhone: true },
    })
    const lids = new Set<string>()
    for (const c of convs) {
      if (c.lidJid?.endsWith('@lid')) lids.add(c.lidJid)
      if (c.contactPhone.endsWith('@lid')) lids.add(c.contactPhone)
    }
    let reconciled = 0
    for (const lid of lids) {
      const phone = await lookupPhoneByLid(lid)
      if (!phone) continue
      await reconcileLidConversations(lid, phone)
      reconciled++
    }
    log('identity.startup_reconcile', { lids: lids.size, reconciled })
  } catch (err) {
    console.error('[attendance] reconcileAllLidConversations falhou:', (err as Error)?.message)
  }
}

/**
 * Grava a mensagem (recebida ou enviada pelo celular) na conversa da sala,
 * aplicando as regras de roteamento:
 * - conversa nova/RESOLVED + mensagem do contato → BOT (sala com agente ativo) ou QUEUED (fila padrão);
 * - QUEUED/IN_PROGRESS → humano no controle, bot não responde;
 * - BOT → segue para o bot.
 */
export async function ingestWhatsAppMessage(input: IngestInput): Promise<IngestResult | null> {
  const now = new Date()
  const inbound = !input.fromMe
  const { identity } = input

  let conversation = await findRoomConversation(input.roomId, input.contactPhone, identity.lidJid, identity.normalizedPhone)
  let createdNow = false

  if (!conversation) {
    // Contato novo. Mensagem do contato → roteia; mensagem do celular (fromMe)
    // em conversa inexistente → já nasce RESOLVED (equipe iniciou pelo app;
    // quando o contato responder, o roteamento normal acontece).
    const bot = inbound && !input.skipRouting ? await getRoomBotTarget(input.roomId) : null
    let status: AttendanceStatus = 'RESOLVED'
    let queue: AttendanceQueue | null = null
    if (inbound && !input.skipRouting) {
      if (bot) status = 'BOT'
      else {
        status = 'QUEUED'
        queue = await getDefaultQueue(input.doctorId)
      }
    }
    const patient = identity.normalizedPhone
      ? await findPatientByPhone(prisma, input.doctorId, identity.normalizedPhone).catch(() => null)
      : null

    try {
      conversation = await prisma.conversation.create({
        data: {
          roomId: input.roomId,
          doctorId: input.doctorId,
          contactPhone: input.contactPhone,
          contactName: inbound ? (input.pushName || (identity.lidJid ? 'Contato WhatsApp' : null)) : null,
          isGroup: false,
          status: inbound ? 'WAITING' : 'OPEN',
          category: inbound ? 'AGUARDANDO' : 'ATENDIMENTO',
          attendanceStatus: status,
          queueId: queue?.id ?? null,
          queuedAt: status === 'QUEUED' ? now : null,
          resolvedAt: status === 'RESOLVED' ? now : null,
          patientId: patient?.id ?? null,
          remoteJid: identity.remoteJid,
          deliveryJid: identity.deliveryJid,
          lidJid: identity.lidJid || null,
          phoneJid: identity.phoneJid || null,
          normalizedPhone: identity.normalizedPhone || null,
        },
      })
      createdNow = true
      await recordEvent(prisma, conversation.id, 'CREATED', { toQueueId: queue?.id ?? null })
      if (status === 'BOT') await recordEvent(prisma, conversation.id, 'BOT_STARTED')
    } catch (err) {
      // Corrida: outra mensagem do mesmo contato criou a conversa ao mesmo tempo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        conversation = await prisma.conversation.findUnique({
          where: { roomId_contactPhone: { roomId: input.roomId, contactPhone: input.contactPhone } },
        })
        if (!conversation) throw err
      } else {
        throw err
      }
    }
  }

  // Dedupe por waMessageId antes de qualquer efeito colateral (unique conversationId+waMessageId).
  let message: MessageWithAuthor
  try {
    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: input.waMessageId,
        fromMe: input.fromMe,
        content: input.content,
        type: input.type,
        mediaUrl: input.mediaUrl,
        status: input.fromMe ? 'SENT' : 'DELIVERED',
        isBot: false,
        timestamp: input.timestamp,
      },
      include: messageInclude,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { conversationId: conversation.id, duplicate: true, dispatchToBot: false }
    }
    throw err
  }

  // Reabertura pelo contato: RESOLVED → BOT/QUEUED (novo ciclo de atendimento).
  if (!createdNow && inbound && !input.skipRouting && conversation.attendanceStatus === 'RESOLVED') {
    const bot = await getRoomBotTarget(input.roomId)
    const queue = bot ? null : await getDefaultQueue(input.doctorId)
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversation.id, attendanceStatus: 'RESOLVED' },
      data: {
        attendanceStatus: bot ? 'BOT' : 'QUEUED',
        queueId: queue?.id ?? null,
        queuedAt: bot ? null : now,
        assignedUserId: null,
        assignedAt: null,
        resolvedAt: null,
        resolvedById: null,
        firstHumanResponseAt: null,
      },
    })
    if (count > 0) {
      await recordEvent(prisma, conversation.id, 'REOPENED', { toQueueId: queue?.id ?? null, note: 'Contato enviou nova mensagem' })
      if (bot) await recordEvent(prisma, conversation.id, 'BOT_STARTED')
    }
  }

  // Vincula paciente (CRM) se ainda não vinculado — e nunca por cima de uma
  // decisão manual da equipe (vincular/desvincular).
  // updateMany condicionado: não atropela um vínculo manual feito no meio.
  if (!conversation.patientId && !conversation.patientLinkManual && identity.normalizedPhone) {
    const patient = await findPatientByPhone(prisma, input.doctorId, identity.normalizedPhone).catch(() => null)
    if (patient) {
      await prisma.conversation.updateMany({
        where: { id: conversation.id, patientId: null, patientLinkManual: false },
        data: { patientId: patient.id },
      })
    }
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessage: previewOf(input.content, input.type),
      lastMessageSender: null,
      lastMessageAt: input.timestamp > (conversation.lastMessageAt ?? new Date(0)) ? input.timestamp : conversation.lastMessageAt,
      doctorId: input.doctorId,
      ...(inbound
        ? {
            unreadCount: { increment: 1 },
            lastInboundAt: now,
            ...(input.pushName && !conversation.contactNameLocked ? { contactName: input.pushName } : {}),
            remoteJid: identity.remoteJid,
            deliveryJid: identity.deliveryJid,
            lidJid: identity.lidJid || conversation.lidJid || null,
            phoneJid: identity.phoneJid || conversation.phoneJid || null,
            normalizedPhone: identity.normalizedPhone || conversation.normalizedPhone || null,
          }
        : {}),
    },
    include: conversationListInclude,
  })

  const ref = { doctorId: updated.doctorId, roomId: updated.roomId }
  publishMessage(ref, message)
  publish(ref, 'conversation.updated', await toListItemOne(updated))

  log('message.ingested', {
    conversationId: updated.id,
    roomId: input.roomId,
    fromMe: input.fromMe,
    status: updated.attendanceStatus,
    created: createdNow,
  })

  // Conversa que acabou de entrar na fila padrão (nova ou reaberta) → avisa quem atende.
  if (inbound && !input.skipRouting && updated.attendanceStatus === 'QUEUED' && (createdNow || conversation.attendanceStatus === 'RESOLVED')) {
    notifyQueueWaiting({
      conversationId: updated.id,
      doctorId: input.doctorId,
      roomId: input.roomId,
      queueId: updated.queueId,
      title: 'Nova conversa na fila',
      message: `${contactLabel(updated)} está aguardando atendimento${updated.queue ? ` na fila ${updated.queue.name}` : ''}.`,
    }).catch(() => {})
  }

  return {
    conversationId: updated.id,
    duplicate: false,
    dispatchToBot: inbound && !input.skipRouting && updated.attendanceStatus === 'BOT',
  }
}

/**
 * Grava uma mensagem enviada pela PLATAFORMA (Agente de IA, chatbot,
 * lembretes automáticos) na conversa da sala, se ela existir. Nunca cria
 * conversa — lembrete para quem nunca falou com a sala não abre atendimento.
 */
export async function recordPlatformOutbound(params: {
  roomId: string
  doctorId: string
  conversationId?: string | null
  jid: string
  content: string
  waMessageId: string
  isBot: boolean
}): Promise<void> {
  try {
    let conversation = params.conversationId
      ? await prisma.conversation.findFirst({ where: { id: params.conversationId, roomId: params.roomId } })
      : null
    if (!conversation) {
      const isLid = params.jid.endsWith('@lid')
      const digits = params.jid.replace(/@.*$/, '').replace(/\D/g, '')
      conversation = await prisma.conversation.findFirst({
        where: {
          roomId: params.roomId,
          OR: isLid
            ? [{ lidJid: params.jid }, { contactPhone: params.jid }, { deliveryJid: params.jid }]
            : [{ contactPhone: { in: phoneVariants(digits) } }, { deliveryJid: params.jid }, { phoneJid: params.jid }],
        },
      })
    }
    if (!conversation) return

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: params.waMessageId,
        fromMe: true,
        content: params.content,
        type: 'TEXT',
        status: 'SENT',
        isBot: params.isBot,
      },
      include: messageInclude,
    })
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: previewOf(params.content, 'TEXT'), lastMessageSender: null, lastMessageAt: message.timestamp },
      include: conversationListInclude,
    })
    const ref = { doctorId: updated.doctorId, roomId: updated.roomId }
    publishMessage(ref, message)
    publish(ref, 'conversation.updated', await toListItemOne(updated))
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return
    console.error('[attendance] recordPlatformOutbound falhou:', (err as Error)?.message)
  }
}

/** A conversa ainda está com o bot? (checagem anti-corrida antes de chamar/responder pela IA) */
export async function isConversationWithBot(conversationId: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { attendanceStatus: true } })
  return conv?.attendanceStatus === 'BOT'
}

/** Vincula o paciente (lead) à conversa se ainda não houver vínculo. */
export async function linkConversationPatient(conversationId: string, patientId: string): Promise<void> {
  const { count } = await prisma.conversation.updateMany({ where: { id: conversationId, patientId: null }, data: { patientId } })
  if (count > 0) await publishConversationUpdate(conversationId)
}

// ─── Handoff IA → humano ──────────────────────────────────────────────────────

export type HandoffTarget = 'reception' | 'doctor'

/**
 * Agente de IA transfere a conversa para a equipe: BOT → QUEUED (fila padrão,
 * ou fila DOCTOR quando target = 'doctor' e existir). Retorna false se a
 * conversa já não estava com o bot (corrida com humano).
 */
export async function handoffToHuman(conversationId: string, reason: string, target: HandoffTarget = 'reception'): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } })
  if (!conv || !conv.doctorId || conv.attendanceStatus !== 'BOT') return false

  let queue: AttendanceQueue | null = null
  if (target === 'doctor') {
    await getDefaultQueue(conv.doctorId) // garante seed
    queue = await prisma.attendanceQueue.findFirst({
      where: { doctorId: conv.doctorId, kind: 'DOCTOR', active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  }
  if (!queue) queue = await getDefaultQueue(conv.doctorId)

  const now = new Date()
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, attendanceStatus: 'BOT' },
    data: { attendanceStatus: 'QUEUED', queueId: queue.id, queuedAt: now, assignedUserId: null, assignedAt: null },
  })
  if (count === 0) return false

  const note = reason.trim().slice(0, 500) || null
  await recordEvent(prisma, conversationId, 'HANDOFF_TO_HUMAN', { toQueueId: queue.id, note })
  const item = await publishConversationUpdate(conversationId)
  log('handoff.to_human', { conversationId, queueId: queue.id, target })

  await notifyQueueWaiting({
    conversationId,
    doctorId: conv.doctorId,
    roomId: conv.roomId,
    queueId: queue.id,
    title: 'Atendimento transferido pela IA',
    message: `${item ? contactLabel({ contactName: item.contactName, contactPhone: item.contactPhone, patient: item.patient }) : 'Contato'} precisa de atendimento humano (fila ${queue.name})${note ? `: ${note}` : ''}.`,
  })
  return true
}

// ─── Ações humanas ────────────────────────────────────────────────────────────

type ConvWithAssignee = Prisma.ConversationGetPayload<{ include: { assignedUser: { select: { id: true; name: true } } } }>

async function loadForAction(scope: AttendanceScope, id: string, opts: { reply?: boolean } = { reply: true }): Promise<ConvWithAssignee> {
  const conv = await getAccessibleConversation(scope, id, { assignedUser: { select: { id: true, name: true } } })
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  if (opts.reply !== false) assertCanReply(scope, conv)
  return conv as ConvWithAssignee
}

function heldByOther(scope: AttendanceScope, conv: ConvWithAssignee): boolean {
  return conv.attendanceStatus === 'IN_PROGRESS' && !!conv.assignedUserId && conv.assignedUserId !== scope.userId
}

function heldByOtherError(conv: ConvWithAssignee): AttendanceAccessError {
  return new AttendanceAccessError(409, conv.assignedUser ? `Já está com ${conv.assignedUser.name}` : 'Esta conversa já está com outra pessoa')
}

/** Só o médico pode mexer numa conversa que está em atendimento com outra pessoa. */
function assertNotHeldByOther(scope: AttendanceScope, conv: ConvWithAssignee) {
  if (heldByOther(scope, conv) && !scope.isDoctor) throw heldByOtherError(conv)
}

async function staleConflict(id: string): Promise<AttendanceAccessError> {
  const fresh = await prisma.conversation.findUnique({ where: { id }, include: { assignedUser: { select: { name: true } } } })
  if (fresh?.attendanceStatus === 'IN_PROGRESS' && fresh.assignedUser) {
    return new AttendanceAccessError(409, `Já está com ${fresh.assignedUser.name}`)
  }
  return new AttendanceAccessError(409, 'A conversa foi alterada por outra pessoa. Atualize e tente novamente.')
}

/** where da concorrência otimista: o estado que lemos ainda é o atual. */
function expectedState(conv: ConvWithAssignee): Prisma.ConversationWhereInput {
  return { id: conv.id, attendanceStatus: conv.attendanceStatus, assignedUserId: conv.assignedUserId }
}

async function itemAfter(id: string): Promise<ConversationListItem> {
  const item = await publishConversationUpdate(id)
  if (!item) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  return item
}

export async function assumeConversation(scope: AttendanceScope, id: string, force = false): Promise<ConversationListItem> {
  const conv = await loadForAction(scope, id)
  if (conv.attendanceStatus === 'IN_PROGRESS' && conv.assignedUserId === scope.userId) return itemAfter(id)
  if (heldByOther(scope, conv) && !(force && scope.isDoctor)) throw heldByOtherError(conv)

  const now = new Date()
  const { count } = await prisma.conversation.updateMany({
    where: expectedState(conv),
    data: {
      attendanceStatus: 'IN_PROGRESS',
      assignedUserId: scope.userId,
      assignedAt: now,
      queuedAt: null,
      resolvedAt: null,
      resolvedById: null,
    },
  })
  if (count === 0) throw await staleConflict(id)

  await recordEvent(prisma, id, conv.attendanceStatus === 'RESOLVED' ? 'REOPENED' : 'ASSUMED', {
    actorUserId: scope.userId,
    fromUserId: conv.assignedUserId,
    toUserId: scope.userId,
    fromQueueId: conv.queueId,
  })
  log('conversation.assumed', { conversationId: id, userId: scope.userId, forced: heldByOther(scope, conv) })
  return itemAfter(id)
}

export async function transferConversation(
  scope: AttendanceScope,
  id: string,
  input: { queueId?: string; userId?: string; note?: string },
): Promise<ConversationListItem> {
  const conv = await loadForAction(scope, id)
  assertNotHeldByOther(scope, conv)
  if (conv.attendanceStatus === 'RESOLVED') throw new AttendanceAccessError(409, 'Reabra a conversa antes de transferir')
  const note = input.note?.trim() || null
  const now = new Date()

  if (input.queueId) {
    const queue = await getScopedQueue(scope, input.queueId)
    if (!queue || !queue.active) throw new AttendanceAccessError(400, 'Fila inválida ou inativa')
    if (conv.attendanceStatus === 'QUEUED' && conv.queueId === queue.id) {
      throw new AttendanceAccessError(400, `A conversa já está na fila ${queue.name}`)
    }
    const { count } = await prisma.conversation.updateMany({
      where: expectedState(conv),
      data: { attendanceStatus: 'QUEUED', queueId: queue.id, queuedAt: now, assignedUserId: null, assignedAt: null, resolvedAt: null, resolvedById: null },
    })
    if (count === 0) throw await staleConflict(id)
    await recordEvent(prisma, id, 'TRANSFERRED_QUEUE', {
      actorUserId: scope.userId,
      fromQueueId: conv.queueId,
      toQueueId: queue.id,
      fromUserId: conv.assignedUserId,
      note,
    })
    const item = await itemAfter(id)
    log('conversation.transferred_queue', { conversationId: id, queueId: queue.id, by: scope.userId })
    notifyQueueWaiting({
      conversationId: id,
      doctorId: scope.doctorId,
      roomId: conv.roomId,
      queueId: queue.id,
      title: 'Conversa transferida para a fila',
      message: `${contactLabel({ contactName: item.contactName, contactPhone: item.contactPhone, patient: item.patient })} foi transferido para a fila ${queue.name}${note ? `: ${note}` : '.'}`,
      excludeUserIds: [scope.userId],
    }).catch(() => {})
    return item
  }

  const targetUserId = input.userId!
  if (conv.attendanceStatus === 'IN_PROGRESS' && conv.assignedUserId === targetUserId) {
    throw new AttendanceAccessError(400, 'A conversa já está com essa pessoa')
  }
  if (!(await isEligibleAgent(scope.doctorId, conv.roomId, targetUserId))) {
    throw new AttendanceAccessError(400, 'Esta pessoa não pode atender conversas desta sala')
  }
  const { count } = await prisma.conversation.updateMany({
    where: expectedState(conv),
    data: { attendanceStatus: 'IN_PROGRESS', assignedUserId: targetUserId, assignedAt: now, queuedAt: null, resolvedAt: null, resolvedById: null },
  })
  if (count === 0) throw await staleConflict(id)
  await recordEvent(prisma, id, 'TRANSFERRED_USER', {
    actorUserId: scope.userId,
    fromUserId: conv.assignedUserId,
    toUserId: targetUserId,
    fromQueueId: conv.queueId,
    note,
  })
  const item = await itemAfter(id)
  log('conversation.transferred_user', { conversationId: id, toUserId: targetUserId, by: scope.userId })
  if (targetUserId !== scope.userId) {
    notifyUsers([targetUserId], {
      title: 'Conversa transferida para você',
      message: `${contactLabel({ contactName: item.contactName, contactPhone: item.contactPhone, patient: item.patient })} foi transferido para você${note ? `: ${note}` : '.'}`,
      type: 'INFO',
      category: 'ATENDIMENTO',
      link: attendanceLink(id),
      entityType: 'conversation',
      entityId: id,
    }).catch(() => {})
  }
  return item
}

export async function returnConversationToBot(scope: AttendanceScope, id: string): Promise<ConversationListItem> {
  const conv = await loadForAction(scope, id)
  assertNotHeldByOther(scope, conv)
  if (conv.attendanceStatus === 'BOT') return itemAfter(id)
  // Resolvida volta sozinha para a IA quando o contato escrever de novo.
  if (conv.attendanceStatus === 'RESOLVED') throw new AttendanceAccessError(409, 'Conversa resolvida: ela volta para a IA quando o contato escrever de novo')
  if (!(await roomHasActiveBot(conv.roomId))) {
    throw new AttendanceAccessError(400, 'Esta sala não tem um Agente de IA ativo')
  }
  const { count } = await prisma.conversation.updateMany({
    where: expectedState(conv),
    data: { attendanceStatus: 'BOT', queueId: null, queuedAt: null, assignedUserId: null, assignedAt: null, resolvedAt: null, resolvedById: null },
  })
  if (count === 0) throw await staleConflict(id)
  await recordEvent(prisma, id, 'RETURNED_TO_BOT', { actorUserId: scope.userId, fromUserId: conv.assignedUserId, fromQueueId: conv.queueId })
  log('conversation.returned_to_bot', { conversationId: id, by: scope.userId })
  return itemAfter(id)
}

export async function resolveConversation(scope: AttendanceScope, id: string): Promise<ConversationListItem> {
  const conv = await loadForAction(scope, id)
  assertNotHeldByOther(scope, conv)
  if (conv.attendanceStatus === 'RESOLVED') return itemAfter(id)
  const now = new Date()
  const { count } = await prisma.conversation.updateMany({
    where: expectedState(conv),
    data: { attendanceStatus: 'RESOLVED', resolvedAt: now, resolvedById: scope.userId, unreadCount: 0, lastReadAt: now, queuedAt: null },
  })
  if (count === 0) throw await staleConflict(id)
  await recordEvent(prisma, id, 'RESOLVED', { actorUserId: scope.userId, fromQueueId: conv.queueId, fromUserId: conv.assignedUserId })
  log('conversation.resolved', { conversationId: id, by: scope.userId })
  return itemAfter(id)
}

export async function reopenConversation(scope: AttendanceScope, id: string): Promise<ConversationListItem> {
  const conv = await loadForAction(scope, id)
  if (conv.attendanceStatus !== 'RESOLVED') throw new AttendanceAccessError(409, 'Só é possível reabrir conversas resolvidas')
  const { count } = await prisma.conversation.updateMany({
    where: expectedState(conv),
    data: { attendanceStatus: 'IN_PROGRESS', assignedUserId: scope.userId, assignedAt: new Date(), resolvedAt: null, resolvedById: null, queuedAt: null },
  })
  if (count === 0) throw await staleConflict(id)
  await recordEvent(prisma, id, 'REOPENED', { actorUserId: scope.userId, toUserId: scope.userId })
  log('conversation.reopened', { conversationId: id, by: scope.userId })
  return itemAfter(id)
}

export async function markConversationRead(scope: AttendanceScope, id: string): Promise<void> {
  const conv = await getAccessibleConversation(scope, id)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0, lastReadAt: new Date() } })
  await publishConversationUpdate(id)
}

export async function addInternalNote(scope: AttendanceScope, id: string, content: string): Promise<MessageItem> {
  const conv = await getAccessibleConversation(scope, id)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const message = await prisma.message.create({
    data: {
      conversationId: id,
      fromMe: true,
      content,
      type: 'TEXT',
      status: 'SENT',
      isInternalNote: true,
      authorUserId: scope.userId,
    },
    include: messageInclude,
  })
  await recordEvent(prisma, id, 'NOTE', { actorUserId: scope.userId })
  publishMessage({ doctorId: conv.doctorId, roomId: conv.roomId }, message)
  log('conversation.note_added', { conversationId: id, by: scope.userId })
  return toMessageItem(message)
}

/**
 * Observação interna gerada pelo sistema (ex.: Agente de IA "note_for_team").
 * Sem autor humano, nunca vai ao WhatsApp. Publica message.created +
 * conversation.updated. Retorna null se a conversa não existir.
 */
export async function addSystemNote(
  conversationId: string,
  content: string,
  opts: { isBot?: boolean } = {},
): Promise<MessageItem | null> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true, doctorId: true, roomId: true } })
  if (!conv) return null
  const message = await prisma.message.create({
    data: {
      conversationId,
      fromMe: true,
      content: content.slice(0, 4096),
      type: 'TEXT',
      status: 'SENT',
      isInternalNote: true,
      isBot: !!opts.isBot,
    },
    include: messageInclude,
  })
  await recordEvent(prisma, conversationId, 'NOTE', { note: opts.isBot ? 'Observação do Agente de IA' : 'Observação do sistema' })
  publishMessage({ doctorId: conv.doctorId, roomId: conv.roomId }, message)
  await publishConversationUpdate(conversationId)
  log('conversation.system_note_added', { conversationId, isBot: !!opts.isBot })
  return toMessageItem(message)
}

// ─── Observações internas: editar / excluir ──────────────────────────────────
// Só observações (isInternalNote) — o que foi trocado com o WhatsApp não pode
// ser editado nem apagado por aqui. Autor ou médico; soft delete.

const IMMUTABLE_MESSAGE = 'Mensagens enviadas ou recebidas pelo WhatsApp não podem ser editadas nem apagadas'

async function loadEditableNote(scope: AttendanceScope, conversationId: string, messageId: string) {
  const conv = await getAccessibleConversation(scope, conversationId)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const msg = await prisma.message.findFirst({ where: { id: messageId, conversationId }, include: messageInclude })
  if (!msg) throw new AttendanceAccessError(404, 'Mensagem não encontrada')
  if (!msg.isInternalNote) throw new AttendanceAccessError(400, IMMUTABLE_MESSAGE)
  if (msg.deletedAt) throw new AttendanceAccessError(409, 'Esta observação já foi excluída')
  if (msg.authorUserId !== scope.userId && !scope.isDoctor) {
    throw new AttendanceAccessError(403, 'Só quem escreveu a observação (ou o médico) pode alterá-la')
  }
  return { conv, msg }
}

export async function editInternalNote(scope: AttendanceScope, conversationId: string, messageId: string, content: string): Promise<MessageItem> {
  const { conv, msg } = await loadEditableNote(scope, conversationId, messageId)
  if (msg.content === content) return toMessageItem(msg)
  // editedAt funciona como versão: duas edições simultâneas → a segunda recebe 409.
  const { count } = await prisma.message.updateMany({
    where: { id: msg.id, deletedAt: null, editedAt: msg.editedAt },
    data: { content, editedAt: new Date() },
  })
  if (count === 0) throw new AttendanceAccessError(409, 'A observação foi alterada por outra pessoa. Atualize e tente novamente.')
  const updated = await prisma.message.findUniqueOrThrow({ where: { id: msg.id }, include: messageInclude })
  await recordEvent(prisma, conversationId, 'NOTE_EDITED', { actorUserId: scope.userId })
  publishMessageUpdate({ doctorId: conv.doctorId, roomId: conv.roomId }, updated)
  log('conversation.note_edited', { conversationId, messageId: msg.id, by: scope.userId })
  return toMessageItem(updated)
}

export async function deleteInternalNote(scope: AttendanceScope, conversationId: string, messageId: string): Promise<MessageItem> {
  const { conv, msg } = await loadEditableNote(scope, conversationId, messageId)
  const { count } = await prisma.message.updateMany({
    where: { id: msg.id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: scope.userId },
  })
  if (count === 0) throw new AttendanceAccessError(409, 'Esta observação já foi excluída')
  const updated = await prisma.message.findUniqueOrThrow({ where: { id: msg.id }, include: messageInclude })
  await recordEvent(prisma, conversationId, 'NOTE_DELETED', { actorUserId: scope.userId })
  publishMessageUpdate({ doctorId: conv.doctorId, roomId: conv.roomId }, updated)
  log('conversation.note_deleted', { conversationId, messageId: msg.id, by: scope.userId })
  return toMessageItem(updated)
}

// ─── Contato: nome exibido ───────────────────────────────────────────────────

/**
 * Edita o nome do contato. Nome preenchido trava contra o pushName do
 * WhatsApp; vazio/null destrava (o próximo pushName volta a preencher).
 */
export async function updateConversationContact(scope: AttendanceScope, id: string, input: { contactName: string | null }) {
  const conv = await loadForAction(scope, id)
  const name = input.contactName?.trim() || null
  const locked = !!name
  if (name === conv.contactName && locked === conv.contactNameLocked) return getConversationDetail(scope, id)

  // Edição de cadastro (não é transição): última gravação vence — não
  // condiciona ao nome lido para um pushName chegando no meio não dar 409.
  await prisma.conversation.update({ where: { id }, data: { contactName: name, contactNameLocked: locked } })
  const before = conv.contactName || 'sem nome'
  await recordEvent(prisma, id, 'CONTACT_UPDATED', {
    actorUserId: scope.userId,
    note: name ? `Nome: “${before}” → “${name}”` : 'Nome volta a seguir o perfil do WhatsApp',
  })
  log('conversation.contact_updated', { conversationId: id, by: scope.userId })
  await publishConversationUpdate(id)
  return getConversationDetail(scope, id)
}

// ─── Vínculo com paciente ────────────────────────────────────────────────────

/** Telefone REAL do contato (nunca LID): normalizedPhone → contactPhone → phoneJid. */
function conversationRealPhone(conv: { normalizedPhone: string | null; contactPhone: string; phoneJid: string | null }): string | null {
  for (const raw of [conv.normalizedPhone, conv.contactPhone, conv.phoneJid]) {
    if (!raw || raw.includes('@lid')) continue
    const digits = normalizePatientPhone(raw.replace(/@.*$/, ''))
    if (digits.length >= 10 && digits.length <= 13 && !isLidLike(digits)) return digits
  }
  return null
}

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const candidateSelect = {
  id: true, name: true, phone: true, status: true, leadStatus: true, birthDate: true,
} satisfies Prisma.PatientSelect

type CandidateRow = Prisma.PatientGetPayload<{ select: typeof candidateSelect }>

function toCandidate(p: CandidateRow, linkedId: string | null) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    status: p.status,
    leadStatus: p.leadStatus,
    birthDate: iso(p.birthDate),
    linked: p.id === linkedId,
  }
}

/**
 * Candidatos para vincular: pacientes do médico com o mesmo telefone (todos —
 * pode ser uma família) + busca livre por nome/telefone/CPF.
 */
export async function listPatientCandidates(scope: AttendanceScope, id: string, search?: string) {
  const conv = await getAccessibleConversation(scope, id)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const realPhone = conversationRealPhone(conv)
  const lookup = realPhone ?? conv.lidJid ?? (conv.contactPhone.endsWith('@lid') ? conv.contactPhone : null)

  const samePhone = lookup ? await findPatientsByPhone(prisma, scope.doctorId, lookup).catch(() => []) : []
  const samePhoneIds = new Set(samePhone.map((p) => p.id))

  const term = search?.trim() ?? ''
  let results: CandidateRow[] = []
  if (term.length >= 2) {
    const digits = term.replace(/\D/g, '')
    results = await prisma.patient.findMany({
      where: {
        doctorId: scope.doctorId,
        anonymizedAt: null,
        id: { notIn: [...samePhoneIds] },
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }, { cpf: { contains: digits } }] : []),
        ],
      },
      select: candidateSelect,
      orderBy: { name: 'asc' },
      take: 10,
    })
  }

  return {
    phone: realPhone,
    samePhone: samePhone.map((p) => toCandidate(p, conv.patientId)),
    results: results.map((p) => toCandidate(p, conv.patientId)),
  }
}

/**
 * Vincula a conversa a um paciente existente ({ patientId }) ou cria um
 * PRE_CADASTRO com o telefone da conversa ({ create: { name } }). Mesmo
 * telefone + nome igual a um paciente existente → 409 { duplicateOf } (a
 * menos que confirmDuplicate). Mesmo telefone com nome diferente é permitido
 * (família). O vínculo passa a ser manual (a ingestão não troca sozinha).
 */
export async function linkConversationPatientManual(
  scope: AttendanceScope,
  id: string,
  input: { patientId?: string; create?: { name: string; confirmDuplicate?: boolean } },
) {
  const conv = await loadForAction(scope, id)
  const previous = conv.patientId
    ? await prisma.patient.findUnique({ where: { id: conv.patientId }, select: { name: true } })
    : null

  if (input.patientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: input.patientId, doctorId: scope.doctorId, anonymizedAt: null },
      select: { id: true, name: true },
    })
    if (!patient) throw new AttendanceAccessError(404, 'Paciente não encontrado')
    if (conv.patientId === patient.id && conv.patientLinkManual) return getConversationDetail(scope, id)

    const { count } = await prisma.conversation.updateMany({
      where: { id, patientId: conv.patientId },
      data: { patientId: patient.id, patientLinkManual: true },
    })
    if (count === 0) throw new AttendanceAccessError(409, 'O vínculo foi alterado por outra pessoa. Atualize e tente novamente.')
    if (conv.patientId !== patient.id) {
      await recordEvent(prisma, id, 'PATIENT_LINKED', {
        actorUserId: scope.userId,
        note: previous ? `${patient.name} (antes: ${previous.name})` : patient.name,
      })
    }
    log('conversation.patient_linked', { conversationId: id, patientId: patient.id, by: scope.userId })
    await publishConversationUpdate(id)
    return getConversationDetail(scope, id)
  }

  const name = input.create?.name.trim() ?? ''
  if (name.length < 2) throw new AttendanceAccessError(400, 'Informe o nome do paciente')
  const phone = conversationRealPhone(conv)
  if (!phone) {
    throw new AttendanceAccessError(400, 'O telefone deste contato ainda não foi identificado pelo WhatsApp. Vincule a um paciente existente.')
  }

  if (!input.create?.confirmDuplicate) {
    const same = (await findPatientsByPhone(prisma, scope.doctorId, phone)).find((p) => normalizeName(p.name) === normalizeName(name))
    if (same) {
      throw new AttendanceAccessError(409, `Já existe ${same.name} com este telefone`, {
        code: 'PATIENT_DUPLICATE',
        duplicateOf: { id: same.id, name: same.name, status: same.status },
      })
    }
  }

  const patient = await prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: {
        name,
        phone,
        phoneKey: computePhoneKey(phone),
        doctorId: scope.doctorId,
        roomId: conv.roomId,
        status: 'PRE_CADASTRO',
        origin: 'MANUAL',
        createdByUserId: scope.userId,
      },
      select: { id: true, name: true },
    })
    const { count } = await tx.conversation.updateMany({
      where: { id, patientId: conv.patientId },
      data: { patientId: created.id, patientLinkManual: true },
    })
    if (count === 0) throw new AttendanceAccessError(409, 'O vínculo foi alterado por outra pessoa. Atualize e tente novamente.')
    return created
  })

  await recordEvent(prisma, id, 'PATIENT_LINKED', {
    actorUserId: scope.userId,
    note: `${patient.name} (novo pré-cadastro)${previous ? ` — antes: ${previous.name}` : ''}`,
  })
  await logAudit({
    clinicId: scope.doctorId,
    roomId: conv.roomId,
    userId: scope.userId,
    action: 'PATIENT_PRE_REGISTER',
    description: `Pré-cadastro criado para ${patient.name} pelo Atendimento`,
    metadata: { patientId: patient.id, origin: 'ATENDIMENTO', conversationId: id },
  })
  log('conversation.patient_created', { conversationId: id, patientId: patient.id, by: scope.userId })
  await publishConversationUpdate(id)
  return getConversationDetail(scope, id)
}

export async function unlinkConversationPatient(scope: AttendanceScope, id: string) {
  const conv = await loadForAction(scope, id)
  if (!conv.patientId) {
    if (!conv.patientLinkManual) await prisma.conversation.updateMany({ where: { id, patientId: null }, data: { patientLinkManual: true } })
    return getConversationDetail(scope, id)
  }
  const previous = await prisma.patient.findUnique({ where: { id: conv.patientId }, select: { name: true } })
  const { count } = await prisma.conversation.updateMany({
    where: { id, patientId: conv.patientId },
    data: { patientId: null, patientLinkManual: true },
  })
  if (count === 0) throw new AttendanceAccessError(409, 'O vínculo foi alterado por outra pessoa. Atualize e tente novamente.')
  await recordEvent(prisma, id, 'PATIENT_UNLINKED', { actorUserId: scope.userId, note: previous?.name ?? null })
  log('conversation.patient_unlinked', { conversationId: id, by: scope.userId })
  await publishConversationUpdate(id)
  return getConversationDetail(scope, id)
}

/** Avança lead NOVO → "em contato" (EM_ANALISE) após a primeira resposta humana. */
async function advanceLeadOnHumanContact(patientId: string | null) {
  if (!patientId) return
  await prisma.patient
    .updateMany({ where: { id: patientId, leadStatus: LEAD_INITIAL_STATUS }, data: { leadStatus: LEAD_IN_CONTACT_STATUS } })
    .catch(() => {})
}

const DISCONNECTED_MESSAGE = 'O WhatsApp desta sala está desconectado. Reconecte a sala para enviar mensagens.'

/**
 * Envio humano. Política de erro:
 * - sala desconectada (sem socket) → 409 e NADA é gravado;
 * - socket existe mas o envio falhou → grava a mensagem com status FAILED e
 *   devolve o item (200) para a UI mostrar a falha na bolha.
 */
export async function sendHumanMessage(scope: AttendanceScope, id: string, content: string): Promise<MessageItem> {
  let conv = await loadForAction(scope, id)

  // Não está comigo → assume automaticamente (se permitido).
  if (!(conv.attendanceStatus === 'IN_PROGRESS' && conv.assignedUserId === scope.userId)) {
    if (heldByOther(scope, conv)) {
      // Médico pode responder sem tomar a conversa; secretária não.
      if (!scope.isDoctor) throw heldByOtherError(conv)
    } else {
      await assumeConversation(scope, id)
      conv = await loadForAction(scope, id)
    }
  }

  const connection = await getRoomConnectionInfo(conv.roomId)
  if (!connection?.connected) throw new AttendanceAccessError(409, DISCONNECTED_MESSAGE)

  const jid = conv.deliveryJid || conv.remoteJid || conv.phoneJid || conv.contactPhone
  const result = await sendRoomWhatsAppMessage(connection.instanceKey, jid, content, { mirror: false })

  const now = new Date()
  const message = await prisma.message.create({
    data: {
      conversationId: id,
      waMessageId: result?.waMessageId ?? null,
      fromMe: true,
      content,
      type: 'TEXT',
      status: result ? 'SENT' : 'FAILED',
      isBot: false,
      authorUserId: scope.userId,
      timestamp: now,
    },
    include: messageInclude,
  })

  if (result) {
    await prisma.conversation.update({
      where: { id },
      data: { lastMessage: previewOf(content, 'TEXT'), lastMessageSender: null, lastMessageAt: now, unreadCount: 0, lastReadAt: now },
    })
    await prisma.conversation.updateMany({ where: { id, firstHumanResponseAt: null }, data: { firstHumanResponseAt: now } })
    await advanceLeadOnHumanContact(conv.patientId)
  }

  publishMessage({ doctorId: conv.doctorId, roomId: conv.roomId }, message)
  await publishConversationUpdate(id)
  log('message.human_sent', { conversationId: id, by: scope.userId, ok: !!result })
  return toMessageItem(message)
}

/** Inicia uma conversa ativa (equipe → contato) já IN_PROGRESS comigo. */
export async function startConversation(
  scope: AttendanceScope,
  input: { roomId: string; patientId?: string; phone?: string; content: string },
): Promise<ConversationListItem> {
  if (!scope.roomIds.includes(input.roomId)) throw new AttendanceAccessError(404, 'Sala não encontrada')
  if (!scope.replyRoomIds.includes(input.roomId)) throw new AttendanceAccessError(403, 'Você não tem permissão para enviar mensagens nesta sala')

  let patient: { id: string; name: string; phone: string } | null = null
  if (input.patientId) {
    patient = await prisma.patient.findFirst({ where: { id: input.patientId, doctorId: scope.doctorId }, select: { id: true, name: true, phone: true } })
    if (!patient) throw new AttendanceAccessError(404, 'Paciente não encontrado')
  }
  const rawPhone = patient?.phone || input.phone || ''
  const phone = normalizePatientPhone(rawPhone)
  if (phone.length < 10) throw new AttendanceAccessError(400, 'Telefone inválido')

  const connection = await getRoomConnectionInfo(input.roomId)
  if (!connection?.connected) throw new AttendanceAccessError(409, DISCONNECTED_MESSAGE)

  const check = await checkPhoneOnWhatsApp(connection.instanceKey, phone).catch(() => null)
  if (check && !check.exists) throw new AttendanceAccessError(400, 'Este número não está no WhatsApp')
  const jid = check?.jid ?? `${phone}@s.whatsapp.net`
  const contactPhone = jid.replace(/@.*$/, '').replace(/\D/g, '') || phone

  if (!patient) {
    const found = await findPatientByPhone(prisma, scope.doctorId, contactPhone).catch(() => null)
    if (found) patient = { id: found.id, name: found.name, phone: found.phone }
  }

  let conversation = await findRoomConversation(input.roomId, contactPhone)
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: {
          roomId: input.roomId,
          doctorId: scope.doctorId,
          contactPhone,
          contactName: patient?.name ?? null,
          status: 'OPEN',
          category: 'ATENDIMENTO',
          attendanceStatus: 'IN_PROGRESS',
          assignedUserId: scope.userId,
          assignedAt: new Date(),
          patientId: patient?.id ?? null,
          remoteJid: jid,
          deliveryJid: jid,
          phoneJid: jid,
          normalizedPhone: contactPhone,
        },
      })
      await recordEvent(prisma, conversation.id, 'CREATED', { actorUserId: scope.userId, toUserId: scope.userId })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        conversation = await prisma.conversation.findUnique({ where: { roomId_contactPhone: { roomId: input.roomId, contactPhone } } })
        if (!conversation) throw err
      } else {
        throw err
      }
    }
  }

  // Paciente escolhido explicitamente → vínculo manual (se a conversa ainda não tinha).
  if (input.patientId && patient && !conversation.patientId) {
    const { count } = await prisma.conversation.updateMany({
      where: { id: conversation.id, patientId: null },
      data: { patientId: patient.id, patientLinkManual: true },
    })
    if (count > 0) await recordEvent(prisma, conversation.id, 'PATIENT_LINKED', { actorUserId: scope.userId, note: patient.name })
  }

  await sendHumanMessage(scope, conversation.id, input.content)
  return itemAfter(conversation.id)
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export type AttendanceTab = 'mine' | 'queue' | 'bot' | 'all' | 'resolved'

/**
 * Visibilidade da aba Fila para secretária: conversas QUEUED de filas em que
 * ela é membro OU de filas sem nenhum membro (fila "aberta"), além de
 * conversas sem fila. Médico vê todas. Nas abas "Todas"/"Agente IA" a
 * secretária continua vendo tudo das salas a que tem acesso.
 */
async function queueVisibilityWhere(scope: AttendanceScope): Promise<Prisma.ConversationWhereInput> {
  if (scope.isDoctor) return {}
  return {
    OR: [
      { queueId: null },
      { queue: { members: { some: { userId: scope.userId } } } },
      { queue: { members: { none: {} } } },
    ],
  }
}

async function tabWhere(scope: AttendanceScope, tab: AttendanceTab): Promise<Prisma.ConversationWhereInput> {
  switch (tab) {
    case 'mine':
      return { attendanceStatus: 'IN_PROGRESS', assignedUserId: scope.userId }
    case 'queue':
      return { AND: [{ attendanceStatus: 'QUEUED' }, await queueVisibilityWhere(scope)] }
    case 'bot':
      return { attendanceStatus: 'BOT' }
    case 'resolved':
      return { attendanceStatus: 'RESOLVED' }
    case 'all':
    default:
      return { attendanceStatus: { not: 'RESOLVED' } }
  }
}

function encodeCursor(c: { lastMessageAt: Date | null; id: string }): string {
  return Buffer.from(`${c.lastMessageAt ? c.lastMessageAt.toISOString() : ''}|${c.id}`, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): { lastMessageAt: Date | null; id: string } | null {
  try {
    const [ts, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (!id) return null
    if (!ts) return { lastMessageAt: null, id }
    const d = new Date(ts)
    return isNaN(d.getTime()) ? null : { lastMessageAt: d, id }
  } catch {
    return null
  }
}

export async function listConversations(
  scope: AttendanceScope,
  params: { tab: AttendanceTab; queueId?: string; roomId?: string; search?: string; cursor?: string; limit: number },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  if (scope.roomIds.length === 0) return { items: [], nextCursor: null }
  const and: Prisma.ConversationWhereInput[] = [conversationScopeWhere(scope), await tabWhere(scope, params.tab), { isGroup: false }]
  if (params.queueId) and.push({ queueId: params.queueId })
  if (params.roomId) and.push({ roomId: params.roomId })

  const search = params.search?.trim()
  if (search) {
    const digits = search.replace(/\D/g, '')
    and.push({
      OR: [
        { contactName: { contains: search, mode: 'insensitive' } },
        { patient: { name: { contains: search, mode: 'insensitive' } } },
        ...(digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : []),
      ],
    })
  }

  const cursor = params.cursor ? decodeCursor(params.cursor) : null
  if (cursor) {
    and.push(
      cursor.lastMessageAt
        ? {
            OR: [
              { lastMessageAt: { lt: cursor.lastMessageAt } },
              { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
              { lastMessageAt: null },
            ],
          }
        : { lastMessageAt: null, id: { lt: cursor.id } },
    )
  }

  const rows = await prisma.conversation.findMany({
    where: { AND: and },
    include: conversationListInclude,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: params.limit + 1,
  })
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows
  return {
    items: await toListItems(page),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  }
}

/**
 * Próxima consulta do paciente VINCULADO (não de outros com o mesmo
 * telefone): status ativo (agendada/confirmada), data >= agora.
 */
async function nextAppointmentOf(doctorId: string, patientId: string | null) {
  if (!patientId) return null
  const appt = await prisma.appointment.findFirst({
    where: { patientId, doctorId, date: { gte: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] } },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, status: true, title: true, duration: true },
  })
  return appt ? { id: appt.id, date: appt.date.toISOString(), status: appt.status, title: appt.title, duration: appt.duration } : null
}

export async function getConversationDetail(scope: AttendanceScope, id: string) {
  const conv = await getAccessibleConversation(scope, id, {
    ...conversationListInclude,
    patient: { select: { id: true, name: true, leadStatus: true, status: true, phone: true } },
  })
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const [item, nextAppointment, connection, hasAiAgent] = await Promise.all([
    toListItemOne(conv as ConversationWithList),
    nextAppointmentOf(scope.doctorId, conv.patientId),
    getRoomConnectionInfo(conv.roomId),
    roomHasActiveBot(conv.roomId),
  ])
  return {
    ...item,
    patient: item.patient && conv.patient ? { ...item.patient, phone: conv.patient.phone, nextAppointment } : null,
    contactNameLocked: conv.contactNameLocked,
    patientLinkManual: conv.patientLinkManual,
    canReply: !!conv.roomId && scope.replyRoomIds.includes(conv.roomId),
    roomConnected: !!connection?.connected,
    hasAiAgent,
  }
}

export async function listMessages(scope: AttendanceScope, id: string, params: { before?: Date; limit: number }) {
  const conv = await getAccessibleConversation(scope, id)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const rows = await prisma.message.findMany({
    where: { conversationId: id, ...(params.before ? { timestamp: { lt: params.before } } : {}) },
    include: messageInclude,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
  })
  const hasMore = rows.length > params.limit
  const page = (hasMore ? rows.slice(0, params.limit) : rows).reverse()
  return { items: page.map(toMessageItem), hasMore }
}

export async function listEvents(scope: AttendanceScope, id: string) {
  const conv = await getAccessibleConversation(scope, id)
  if (!conv) throw new AttendanceAccessError(404, 'Conversa não encontrada')
  const rows = await prisma.conversationEvent.findMany({
    where: { conversationId: id },
    include: eventInclude,
    orderBy: { createdAt: 'asc' },
    take: 300,
  })
  return rows.map(toEventItem)
}

function startOfTodaySaoPaulo(): Date {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return new Date(`${ymd}T00:00:00-03:00`)
}

export async function getSummary(scope: AttendanceScope) {
  if (scope.roomIds.length === 0) return { mine: 0, queued: 0, bot: 0, inProgress: 0, resolvedToday: 0, unreadMine: 0 }
  const base = conversationScopeWhere(scope)
  const queueVis = await queueVisibilityWhere(scope)
  const mineWhere: Prisma.ConversationWhereInput = { AND: [base, { attendanceStatus: 'IN_PROGRESS', assignedUserId: scope.userId }] }
  const [mine, queued, bot, inProgress, resolvedToday, unread] = await Promise.all([
    prisma.conversation.count({ where: mineWhere }),
    prisma.conversation.count({ where: { AND: [base, { attendanceStatus: 'QUEUED' }, queueVis] } }),
    prisma.conversation.count({ where: { AND: [base, { attendanceStatus: 'BOT' }] } }),
    prisma.conversation.count({ where: { AND: [base, { attendanceStatus: 'IN_PROGRESS' }] } }),
    prisma.conversation.count({ where: { AND: [base, { attendanceStatus: 'RESOLVED', resolvedAt: { gte: startOfTodaySaoPaulo() } }] } }),
    prisma.conversation.aggregate({ where: mineWhere, _sum: { unreadCount: true } }),
  ])
  return { mine, queued, bot, inProgress, resolvedToday, unreadMine: unread._sum.unreadCount ?? 0 }
}
