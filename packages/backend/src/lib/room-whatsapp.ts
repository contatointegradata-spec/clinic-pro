/**
 * room-whatsapp.ts
 * Manages WhatsApp sessions per Sala (room).
 * Each room can have its own WhatsApp connection via RoomWhatsAppConnection.
 * Uses the same Baileys infrastructure as whatsapp.ts but manages RoomWhatsAppConnection records.
 */
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  type WAMessage,
  proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'node:fs'
import path from 'node:path'
import NodeCache from 'node-cache'
import { prisma } from './prisma'
import pino from 'pino'
import { resolveTemplateVariables, TemplateContext } from './chatbot-light-variables'
import { resolveWhatsAppContactIdentity } from './whatsapp'
import { handleIncomingLightMessage } from './chatbot-light-engine'
import { createNotification, notifyAppointmentEvent, notifyClinicTeam } from './notifications'
import { getRoomBotTarget, ingestWhatsAppMessage, recordPlatformOutbound } from './attendance'

const SESSIONS_DIR = path.resolve(process.env.SESSIONS_DIR ?? path.join(process.cwd(), 'sessions'))
const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' })

// Room socket registry — keyed by instanceKey
const roomSockets = new Map<string, ReturnType<typeof makeWASocket>>()
const roomReconnectTimers = new Map<string, NodeJS.Timeout>()
const stoppingRoomKeys = new Set<string>()
// Tracks sessions currently in the connecting/authenticating phase (not yet open)
const roomConnecting = new Set<string>()

// ─── Retry infrastructure (CRITICAL for WhatsApp MD message delivery) ─────────
// Without getMessage + msgRetryCounterCache, recipients see "Aguardando mensagem"
// because Baileys can't answer the server's retry requests for the original ciphertext.
const roomMsgRetryCounterCache = new NodeCache({ stdTTL: 60, checkperiod: 10 })
const roomUserDevicesCache     = new NodeCache({ stdTTL: 300, checkperiod: 60 })
// messageId → proto.IMessage. Precisa sobreviver bem além de alguns minutos:
// o retry de decriptação do WhatsApp (que pede de novo o conteúdo original
// quando o aparelho do destinatário não consegue decifrar na hora) pode
// chegar bem depois do envio — celular bloqueado/em economia de bateria,
// sem internet por um tempo, etc. Com TTL curto (era 300s/5min), esse pedido
// chega depois do cache já ter expirado, getMessage devolve undefined, e o
// destinatário fica preso em "Aguardando mensagem" pra sempre, mesmo com
// toda a infraestrutura de retry correta. 24h cobre a esmagadora maioria
// dos casos reais sem pesar na memória (poucas centenas de msgs/dia).
const roomSentMsgCache         = new NodeCache({ stdTTL: 86400, checkperiod: 600 })

// ─── Pending Confirmations (SIM/NÃO interactive flow) ────────────────────────

export interface PendingConfirmationData {
  appointmentId: string
  doctorId: string
  patientName: string
  declineContent: string
  instanceKey: string
}

// TTL 24h — patient has a day to respond
const pendingConfirmations = new NodeCache({ stdTTL: 86400, checkperiod: 3600 })

export function registerRoomConfirmationPending(phone: string, data: PendingConfirmationData): void {
  const normalized = phone.replace(/\D/g, '')
  pendingConfirmations.set(normalized, data)
}

function normalizeConfirmText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

const SIM_WORDS = new Set(['sim', 's', '1', 'confirmar', 'confirmo', 'ok', 'quero', 'sim!', 'sim.'])
const NAO_WORDS = new Set(['nao', 'n', '2', 'nao quero', 'cancelar', 'recusar', 'nao confirmo', 'nao!', 'nao.'])

const MAX_ROOM_RECONNECT_ATTEMPTS = 5
// Quantos ciclos de "esgotou MAX_ROOM_RECONNECT_ATTEMPTS, watchdog tentou de
// novo" o watchdog aceita antes de desistir de reconectar com a sessão
// atual e colocar em quarentena (limpa sessão, pede novo QR code). Sem
// isso, uma sessão corrompida (erro de decriptação tipo "Bad MAC") entra
// num loop infinito — nunca reconecta de verdade, só consome CPU/log pra
// sempre.
const MAX_QUARANTINE_CYCLES = 3

function toLong(v: unknown): number {
  if (!v) return 0
  if (typeof v === 'number') return v
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (v as any).toNumber === 'function') return (v as any).toNumber()
  return Number(v) || 0
}

type ParsedContent = {
  content: string
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION'
  mediaUrl: string | null
}

function parseMessageContent(msg: WAMessage): ParsedContent | null {
  let mc = msg.message ?? {}
  // Mensagens temporárias / visualização única vêm embrulhadas.
  mc = mc.ephemeralMessage?.message ?? mc.viewOnceMessage?.message ?? mc.viewOnceMessageV2?.message ?? mc

  if (mc.conversation) return { content: mc.conversation, type: 'TEXT', mediaUrl: null }
  if (mc.extendedTextMessage?.text) return { content: mc.extendedTextMessage.text, type: 'TEXT', mediaUrl: null }
  if (mc.imageMessage) return { content: mc.imageMessage.caption ?? '', type: 'IMAGE', mediaUrl: mc.imageMessage.url ?? null }
  if (mc.audioMessage) return { content: '[Áudio]', type: 'AUDIO', mediaUrl: null }
  if (mc.videoMessage) return { content: mc.videoMessage.caption ?? '[Vídeo]', type: 'VIDEO', mediaUrl: null }
  if (mc.documentMessage) return { content: mc.documentMessage.fileName ?? '[Documento]', type: 'DOCUMENT', mediaUrl: mc.documentMessage.url ?? null }
  if (mc.stickerMessage) return { content: '[Sticker]', type: 'STICKER', mediaUrl: null }
  if (mc.locationMessage) {
    const loc = mc.locationMessage
    return { content: `[Localização] Lat: ${loc.degreesLatitude}, Lng: ${loc.degreesLongitude}`, type: 'LOCATION', mediaUrl: null }
  }
  if (mc.buttonsResponseMessage?.selectedButtonId) return { content: mc.buttonsResponseMessage.selectedButtonId, type: 'TEXT', mediaUrl: null }
  if (mc.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return { content: mc.listResponseMessage.singleSelectReply.selectedRowId, type: 'TEXT', mediaUrl: null }
  }
  return null // tipo desconhecido (reação, protocolo, edição...) — ignora
}

/** Só conversas individuais: ignora grupos, Status (@broadcast) e canais (@newsletter). */
function isIndividualJid(jid: string | null | undefined): jid is string {
  return !!jid && !jid.endsWith('@g.us') && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter')
}

interface RoomConnectionRef {
  roomId: string
  doctorId: string
  instanceKey: string
}

/**
 * Ponto único de ingestão de TODA conexão de Sala (com ou sem Agente de IA):
 * resolve a identidade do contato e grava Conversation/Message via módulo
 * Atendimento (lib/attendance.ts), que também decide o roteamento
 * (BOT x fila). Retorna o resultado da ingestão (null se ignorada).
 */
async function handleIncomingMessage(
  connection: RoomConnectionRef,
  msg: WAMessage,
  options: { skipRouting?: boolean } = {},
): Promise<{ conversationId: string; dispatchToBot: boolean; identity: Awaited<ReturnType<typeof resolveWhatsAppContactIdentity>>; parsed: ParsedContent } | null> {
  const remoteJid = msg.key.remoteJid
  if (!isIndividualJid(remoteJid)) return null
  const parsed = parseMessageContent(msg)
  if (!parsed) return null

  const fromMe = msg.key.fromMe ?? false
  // Em mensagens fromMe o senderPn/pushName são do PRÓPRIO número — não servem
  // pra identificar o contato; a identidade vem do remoteJid/conversa existente.
  const identity = await resolveWhatsAppContactIdentity({ roomId: connection.roomId }, remoteJid, fromMe ? undefined : msg)
  const contactPhone = identity.normalizedPhone || identity.lidJid || remoteJid

  const timestamp = msg.messageTimestamp ? new Date(toLong(msg.messageTimestamp) * 1000) : new Date()

  const result = await ingestWhatsAppMessage({
    roomId: connection.roomId,
    doctorId: connection.doctorId,
    contactPhone,
    pushName: fromMe ? null : (msg.pushName || null),
    identity,
    waMessageId: msg.key.id ?? null,
    fromMe,
    content: parsed.content,
    type: parsed.type,
    mediaUrl: parsed.mediaUrl,
    timestamp,
    skipRouting: options.skipRouting,
  })
  if (!result || result.duplicate) return null

  return { conversationId: result.conversationId, dispatchToBot: result.dispatchToBot, identity, parsed }
}

/**
 * Encaminha a mensagem do contato para o Chatbot/Agente de IA vinculado à
 * sala (LightChatbot.boundRoomId). Só é chamado quando a conversa está em
 * status BOT — com humano no controle (QUEUED/IN_PROGRESS) o bot não responde.
 */
async function dispatchToRoomBot(
  connection: RoomConnectionRef,
  msg: WAMessage,
  ingested: NonNullable<Awaited<ReturnType<typeof handleIncomingMessage>>>,
): Promise<void> {
  const target = await getRoomBotTarget(connection.roomId)
  if (!target) return

  logRoom('info', connection.instanceKey, 'whatsapp.message.light_engine_called', {
    messageId: msg.key.id,
    conversationId: ingested.conversationId,
  })
  await handleIncomingLightMessage({
    socketInstanceKey: connection.instanceKey,
    whatsappInstanceId: target.instanceId,
    roomId: connection.roomId,
    conversationId: ingested.conversationId,
    remoteJid: ingested.identity.remoteJid,
    deliveryJid: ingested.identity.deliveryJid,
    lidJid: ingested.identity.lidJid,
    phoneJid: ingested.identity.phoneJid,
    normalizedPhone: ingested.identity.normalizedPhone,
    messageId: msg.key.id!,
    messageText: ingested.parsed.content,
    msgRaw: msg,
  })
}

// IDs de mensagens enviadas pela própria plataforma (bot/humano/lembretes) —
// o eco delas no messages.upsert (fromMe) não pode ser espelhado de novo como
// "enviada pelo celular". TTL generoso pra cobrir eco atrasado/offline.
const platformSentIds = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600 })

function logRoom(level: 'info' | 'warn' | 'error', instanceKey: string, event: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ ts, level, module: 'ROOM_WA', instanceKey, event, ...meta }))
}

// ─── Baileys version cache ────────────────────────────────────────────────────
// fetchLatestBaileysVersion() faz uma chamada de rede ao GitHub sem timeout.
// Sem cache, toda tentativa de conectar/reconectar pagava esse round-trip de
// novo, atrasando o aparecimento do QR Code. Cacheia por algumas horas e usa
// timeout curto + último valor bom conhecido como fallback.
const baileysVersionCache = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600 })
const BAILEYS_VERSION_CACHE_KEY = 'version'
let lastKnownBaileysVersion: [number, number, number] | null = null

async function getCachedBaileysVersion(): Promise<[number, number, number]> {
  const cached = baileysVersionCache.get<[number, number, number]>(BAILEYS_VERSION_CACHE_KEY)
  if (cached) return cached

  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    const { version } = await Promise.race([fetchLatestBaileysVersion(), timeout])
    const v = version as [number, number, number]
    baileysVersionCache.set(BAILEYS_VERSION_CACHE_KEY, v)
    lastKnownBaileysVersion = v
    return v
  } catch (err) {
    logRoom('warn', 'system', 'baileys_version.fetch_failed', { error: String(err) })
    if (lastKnownBaileysVersion) return lastKnownBaileysVersion
    // Fallback fixo conhecido — evita travar a conexão caso a rede/GitHub estejam fora.
    return [2, 3000, 1023223821]
  }
}

/** Processa a resposta SIM/NÃO de uma confirmação de consulta pendente. */
async function processConfirmationReply(
  instanceKey: string,
  fromJid: string,
  pending: PendingConfirmationData,
  isSim: boolean,
): Promise<void> {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: pending.appointmentId },
      select: { id: true, date: true, roomId: true, doctorId: true },
    })
    if (isSim) {
      await prisma.appointment.update({ where: { id: pending.appointmentId }, data: { status: 'CONFIRMED' } })
      await sendRoomWhatsAppMessage(instanceKey, fromJid, `Perfeito, ${pending.patientName}! Sua consulta foi confirmada. Até logo! 😊`)
      if (appointment) {
        await notifyAppointmentEvent({
          kind: 'confirmed',
          appointmentId: appointment.id,
          doctorId: appointment.doctorId,
          roomId: appointment.roomId,
          patientName: pending.patientName,
          date: appointment.date,
          actorLabel: 'pelo WhatsApp',
        })
      }
      logRoom('info', instanceKey, 'confirmation.sim', { appointmentId: pending.appointmentId })
    } else {
      await sendRoomWhatsAppMessage(instanceKey, fromJid, pending.declineContent)
      await notifyClinicTeam(appointment?.doctorId ?? pending.doctorId, appointment?.roomId ?? null, {
        title: 'Consulta não confirmada',
        message: `${pending.patientName} não confirmou a consulta. Entre em contato para reagendar.`,
        type: 'WARNING',
        category: 'AGENDAMENTO',
        link: '/agenda',
        entityType: 'appointment',
        entityId: pending.appointmentId,
      })
      logRoom('info', instanceKey, 'confirmation.nao', { appointmentId: pending.appointmentId })
    }
  } catch (err) {
    logRoom('error', instanceKey, 'confirmation.process_error', { error: String(err) })
  }
}

/**
 * Start a WhatsApp session for a room.
 * Creates/updates the RoomWhatsAppConnection record as the session progresses.
 */
export async function startRoomSession(connectionId: string, instanceKey: string): Promise<void> {
  if (stoppingRoomKeys.has(instanceKey)) return
  if (roomSockets.has(instanceKey) || roomConnecting.has(instanceKey)) {
    logRoom('info', instanceKey, 'session.start_ignored_active')
    return
  }

  // Cancel any pending reconnect
  const oldTimer = roomReconnectTimers.get(instanceKey)
  if (oldTimer) { clearTimeout(oldTimer); roomReconnectTimers.delete(instanceKey) }

  logRoom('info', instanceKey, 'session.start')

  const sessDir = path.join(SESSIONS_DIR, 'room_' + instanceKey)
  fs.mkdirSync(sessDir, { recursive: true })

  roomConnecting.add(instanceKey)

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessDir)
    const version = await getCachedBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['ClinIQ-Room', 'Chrome', '120.0.0'],
      // Required for WhatsApp MD: answer server retry requests with the original
      // message ciphertext, otherwise recipients see "Aguardando mensagem" forever.
      getMessage: async (key) => {
        const id = key.id
        if (!id) return undefined
        return roomSentMsgCache.get<proto.IMessage>(id)
      },
      msgRetryCounterCache: roomMsgRetryCounterCache,
      userDevicesCache: roomUserDevicesCache,
      syncFullHistory: false,
      // As "init queries" do Baileys (abprops, blocklist, privacidade) não são
      // usadas aqui e o WhatsApp frequentemente não responde ao fetchProps,
      // gerando "Timed Out" (408) 60s após conectar. Desativamos para evitar o erro.
      fireInitQueries: false,
      defaultQueryTimeoutMs: 60_000,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      markOnlineOnConnect: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr)
          await prisma.roomWhatsAppConnection.update({
            where: { id: connectionId },
            data: {
              qrCode: qrDataUrl,
              qrCodeExpiresAt: new Date(Date.now() + 55_000),
              status: 'CONNECTING',
            },
          })
          logRoom('info', instanceKey, 'qr.generated')
        } catch (e) {
          logRoom('error', instanceKey, 'qr.save_failed', { error: String(e) })
        }
      }

      if (connection === 'open') {
        roomConnecting.delete(instanceKey)
        roomSockets.set(instanceKey, sock)
        const phoneRaw = sock.user?.id ?? ''
        const phone = phoneRaw.split(':')[0].split('@')[0]
        try {
          await prisma.roomWhatsAppConnection.update({
            where: { id: connectionId },
            data: {
              status: 'CONNECTED',
              qrCode: null,
              qrCodeExpiresAt: null,
              phoneNumber: phone || null,
              displayName: sock.user?.name ?? null,
              connectedAt: new Date(),
              lastSyncAt: new Date(),
              reconnectAttempts: 0,
              failureCycles: 0,
            },
          })
          logRoom('info', instanceKey, 'session.connected', { phone })
        } catch (e) {
          logRoom('error', instanceKey, 'connected.update_failed', { error: String(e) })
        }
      }

      if (connection === 'close') {
        roomConnecting.delete(instanceKey)
        roomSockets.delete(instanceKey)
        const boom = lastDisconnect?.error as Boom | undefined
        const code = boom?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut

        logRoom('warn', instanceKey, 'session.closed', { code, loggedOut })

        try {
          const conn = await prisma.roomWhatsAppConnection.findUnique({ where: { id: connectionId } })
          if (!conn) return

          const attempts = (conn.reconnectAttempts ?? 0) + 1
          await prisma.roomWhatsAppConnection.update({
            where: { id: connectionId },
            data: {
              status: 'DISCONNECTED',
              qrCode: null,
              disconnectedAt: new Date(),
              reconnectAttempts: attempts,
            },
          })

          if (!loggedOut && !stoppingRoomKeys.has(instanceKey) && attempts <= MAX_ROOM_RECONNECT_ATTEMPTS) {
            const delay = Math.min(5000 * attempts, 30_000)
            logRoom('info', instanceKey, 'reconnect.scheduled', { delay, attempts })
            const timer = setTimeout(() => {
              roomReconnectTimers.delete(instanceKey)
              startRoomSession(connectionId, instanceKey).catch(err =>
                logRoom('error', instanceKey, 'reconnect.failed', { error: String(err) })
              )
            }, delay)
            roomReconnectTimers.set(instanceKey, timer)
          }
        } catch (e) {
          logRoom('error', instanceKey, 'close.update_failed', { error: String(e) })
        }
      }
    })

    // ── Ingestão (Atendimento) + SIM/NÃO de confirmação + Agente de IA ───────
    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      let connection: RoomConnectionRef | null = null
      for (const msg of msgs) {
        try {
          if (!msg.message) continue
          const fromJid = msg.key.remoteJid
          // @g.us = grupo; status@broadcast = Status/Stories de contatos salvos
          // (a WhatsApp expõe isso como "mensagem" normal em messages.upsert) —
          // sem esse filtro, o agente respondia à legenda de status de qualquer
          // contato salvo no número conectado.
          if (!isIndividualJid(fromJid)) continue

          const fromMe = !!msg.key.fromMe
          // Recebidas: só 'notify' (tempo real). Enviadas pelo celular: 'notify'
          // (online) ou 'append' (sincronizadas depois) — dedupe por waMessageId.
          if (!fromMe && type !== 'notify') continue
          if (fromMe && msg.key.id && platformSentIds.has(msg.key.id)) continue

          if (!connection) {
            connection = await prisma.roomWhatsAppConnection.findUnique({
              where: { instanceKey },
              select: { roomId: true, doctorId: true, instanceKey: true },
            })
            if (!connection) return
          }

          if (fromMe) {
            await handleIncomingMessage(connection, msg)
            continue
          }

          const textContent = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim()
          const phone = fromJid.split('@')[0].split(':')[0]
          const pending = textContent ? pendingConfirmations.get<PendingConfirmationData>(phone) : undefined
          const normalized = pending ? normalizeConfirmText(textContent) : ''
          const isSim = !!pending && SIM_WORDS.has(normalized)
          const isNao = !!pending && NAO_WORDS.has(normalized)
          const consumedByConfirmation = isSim || isNao

          // Grava SEMPRE (histórico do Atendimento); resposta de confirmação não
          // abre atendimento nem vai pro bot.
          const ingested = await handleIncomingMessage(connection, msg, { skipRouting: consumedByConfirmation })
          if (!ingested) continue // duplicada / tipo ignorado

          if (consumedByConfirmation && pending) {
            pendingConfirmations.del(phone)
            await processConfirmationReply(instanceKey, fromJid, pending, isSim)
            continue
          }

          if (ingested.dispatchToBot) {
            await dispatchToRoomBot(connection, msg, ingested)
          }
        } catch (err) {
          logRoom('error', instanceKey, 'message.ingest_failed', { messageId: msg.key.id, error: String(err) })
        }
      }
    })

  } catch (err) {
    roomConnecting.delete(instanceKey)
    logRoom('error', instanceKey, 'session.start_failed', { error: String(err) })
    await prisma.roomWhatsAppConnection.update({
      where: { id: connectionId },
      data: { status: 'DISCONNECTED' },
    }).catch(() => {})
    throw err
  }
}

/**
 * Stop a room WhatsApp session (logout or graceful stop).
 */
export async function stopRoomSession(instanceKey: string, logout = false): Promise<void> {
  stoppingRoomKeys.add(instanceKey)

  const timer = roomReconnectTimers.get(instanceKey)
  if (timer) { clearTimeout(timer); roomReconnectTimers.delete(instanceKey) }

  roomConnecting.delete(instanceKey)

  const sock = roomSockets.get(instanceKey)
  if (sock) {
    try {
      if (logout) await sock.logout()
      sock.end(undefined)
    } catch { /* ignore */ }
    roomSockets.delete(instanceKey)
  }

  stoppingRoomKeys.delete(instanceKey)
  logRoom('info', instanceKey, 'session.stopped', { logout })
}

/**
 * Faz um polling curto (limitado por timeoutMs) no registro da conexão até o
 * `status` sair do valor que tinha no momento da chamada (normalmente vira
 * 'CONNECTING' assim que o Baileys começa o handshake) ou até já ter QR Code
 * gravado. Usado pelas rotas de connect/reconnect pra responder já com o
 * estado atualizado — em vez do estado estático de antes da tentativa —
 * sem bloquear a requisição HTTP por muito tempo.
 */
export async function waitForConnectionProgress(connectionId: string, timeoutMs = 4000) {
  const initial = await prisma.roomWhatsAppConnection.findUnique({ where: { id: connectionId } })
  if (!initial) return null

  let current = initial
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && current.status === initial.status && !current.qrCode) {
    await new Promise(resolve => setTimeout(resolve, 300))
    const fresh = await prisma.roomWhatsAppConnection.findUnique({ where: { id: connectionId } })
    if (!fresh) break
    current = fresh
  }
  return current
}

/**
 * Reset session files to force new QR code on next connect.
 */
export function resetRoomSessionFiles(instanceKey: string): void {
  const sessDir = path.join(SESSIONS_DIR, 'room_' + instanceKey)
  if (fs.existsSync(sessDir)) {
    fs.rmSync(sessDir, { recursive: true, force: true })
    logRoom('info', instanceKey, 'session.files_reset')
  }
}

export function isRoomSessionActive(instanceKey: string): boolean {
  return roomSockets.has(instanceKey)
}

// Sessão em handshake ativo (socket ainda não estabelecido, mas já em
// andamento) — usado pelas rotas de connect/reconnect pra recusar uma nova
// tentativa concorrente em vez de resetar os arquivos de sessão no meio de
// um handshake já em curso (isso corrompia o QR/handshake ativo).
export function isRoomSessionConnecting(instanceKey: string): boolean {
  return roomConnecting.has(instanceKey)
}

export function getRoomSocket(instanceKey: string) {
  return roomSockets.get(instanceKey)
}

/**
 * Normaliza um número de telefone para o formato JID do WhatsApp.
 * Adiciona o código do país 55 para números brasileiros (10-11 dígitos sem CC).
 */
export function normalizeToWhatsAppJid(input: string): string {
  if (input.endsWith('@s.whatsapp.net') || input.endsWith('@lid') || input.endsWith('@g.us')) return input
  const rawDigits = input.replace(/\D/g, '')
  const normalized = (rawDigits.length === 10 || rawDigits.length === 11) ? `55${rawDigits}` : rawDigits
  return `${normalized}@s.whatsapp.net`
}

/**
 * Verifica se um número existe no WhatsApp via onWhatsApp() do Baileys.
 * Retorna o JID correto retornado pelo servidor, ou null se não encontrado/erro.
 */
// Evita reconsultar os servidores do WhatsApp (onWhatsApp()) pro mesmo número
// a cada mensagem enviada pelo bot num mesmo atendimento — era a principal
// causa de delay perceptível nas respostas em turnos com várias mensagens.
const phoneCheckCache = new NodeCache({ stdTTL: 600, checkperiod: 120 })

export async function checkPhoneOnWhatsApp(
  instanceKey: string,
  phone: string,
): Promise<{ exists: boolean; jid: string } | null> {
  const sock = roomSockets.get(instanceKey)
  if (!sock) return null

  const jid = normalizeToWhatsAppJid(phone)
  const numberOnly = jid.replace('@s.whatsapp.net', '')

  const cacheKey = `${instanceKey}:${numberOnly}`
  const cached = phoneCheckCache.get<{ exists: boolean; jid: string }>(cacheKey)
  if (cached) return cached

  try {
    const result = await (sock as any).onWhatsApp(numberOnly)
    const resolved = (!result || result.length === 0)
      ? { exists: false, jid }
      : { exists: result[0].exists, jid: result[0].jid ?? jid }
    phoneCheckCache.set(cacheKey, resolved)
    return resolved
  } catch (err) {
    logRoom('warn', instanceKey, 'phone.check_failed', { phone, error: String(err) })
    return null
  }
}

export interface SendRoomMessageOptions {
  // true (padrão) → grava a mensagem enviada como bot (isBot) na conversa da
  // sala, se existir, e emite no stream do Atendimento. O envio humano do
  // Atendimento passa false e grava por conta própria (com authorUserId).
  mirror?: boolean
  // Conversa alvo, quando o chamador já sabe (evita busca por telefone).
  conversationId?: string | null
  isBot?: boolean
}

/**
 * Envia uma mensagem de texto pelo socket de uma sala (Chatbot Light, Agente
 * de IA, lembretes automáticos e respostas humanas do Atendimento).
 */
export async function sendRoomWhatsAppMessage(
  instanceKey: string,
  jid: string,
  content: string,
  options: SendRoomMessageOptions = {},
): Promise<{ waMessageId: string; resolvedJid: string } | null> {
  const sock = roomSockets.get(instanceKey)
  if (!sock) {
    logRoom('warn', instanceKey, 'message.no_socket')
    return null
  }

  const resolvedJid = normalizeToWhatsAppJid(jid)
  // ID gerado antes do envio e registrado como "enviado pela plataforma" —
  // o eco fromMe que o Baileys emite no messages.upsert é ignorado pela
  // ingestão (senão viraria uma 2ª mensagem "enviada pelo celular").
  const messageId = generateMessageIDV2(sock.user?.id)
  platformSentIds.set(messageId, true)
  try {
    logRoom('info', instanceKey, 'message.sending', { resolvedJid })
    const result = await sock.sendMessage(resolvedJid, { text: content }, { messageId })
    if (!result?.key.id) return null
    if (result.key.id !== messageId) platformSentIds.set(result.key.id, true)

    // Cache the sent message so Baileys can answer WhatsApp MD retry requests.
    // Without this, recipients see "Aguardando mensagem" when the server retries.
    if (result.message) {
      roomSentMsgCache.set(result.key.id, result.message as proto.IMessage)
    }

    logRoom('info', instanceKey, 'message.sent', { messageId: result.key.id, resolvedJid })

    if (options.mirror !== false) {
      const connection = await prisma.roomWhatsAppConnection.findUnique({
        where: { instanceKey },
        select: { roomId: true, doctorId: true },
      }).catch(() => null)
      if (connection) {
        await recordPlatformOutbound({
          roomId: connection.roomId,
          doctorId: connection.doctorId,
          conversationId: options.conversationId ?? null,
          jid: resolvedJid,
          content,
          waMessageId: result.key.id,
          isBot: options.isBot ?? true,
        })
      }
    }
    return { waMessageId: result.key.id, resolvedJid }
  } catch (err) {
    logRoom('error', instanceKey, 'message.send_failed', { resolvedJid, error: String(err) })
    return null
  }
}

/** Conexão WhatsApp da sala e se está realmente conectada (socket vivo). */
export async function getRoomConnectionInfo(roomId: string | null): Promise<{ instanceKey: string; connected: boolean } | null> {
  if (!roomId) return null
  const connection = await prisma.roomWhatsAppConnection.findUnique({
    where: { roomId },
    select: { instanceKey: true, status: true },
  })
  if (!connection) return null
  return {
    instanceKey: connection.instanceKey,
    connected: connection.status === 'CONNECTED' && roomSockets.has(connection.instanceKey),
  }
}

/**
 * Resolve a conexão WhatsApp da Sala vinculada a um chatbot específico
 * (via LightChatbot.boundRoomId — cada chatbot tem sua própria sala/número,
 * multi-chatbot jul/2026). Retorna null se não houver vínculo ou a sala não
 * estiver conectada.
 */
export async function resolveChatbotLightBinding(chatbotId: string): Promise<{
  roomId: string
  instanceKey: string
  connected: boolean
} | null> {
  const chatbot = await prisma.lightChatbot.findUnique({
    where: { id: chatbotId },
    select: { boundRoomId: true },
  })
  if (!chatbot?.boundRoomId) return null

  const connection = await prisma.roomWhatsAppConnection.findUnique({
    where: { roomId: chatbot.boundRoomId },
  })
  if (!connection) return null

  return {
    roomId: chatbot.boundRoomId,
    instanceKey: connection.instanceKey,
    connected: connection.status === 'CONNECTED' && roomSockets.has(connection.instanceKey),
  }
}

/**
 * Resolve o alvo de envio para mensagens automáticas de um chatbot.
 * Retorna null se não houver Sala vinculada ou a conexão não estiver ativa.
 */
export async function resolveChatbotLightSendTarget(chatbotId: string): Promise<{ instanceKey: string } | null> {
  const binding = await resolveChatbotLightBinding(chatbotId)
  if (!binding || !binding.connected) return null
  return { instanceKey: binding.instanceKey }
}

/**
 * Restore active room sessions on server startup.
 */
export async function restoreRoomSessions(): Promise<void> {
  try {
    const connections = await prisma.roomWhatsAppConnection.findMany({
      where: { status: { in: ['CONNECTED', 'CONNECTING'] } },
    })

    logRoom('info', 'startup', 'restore.begin', { count: connections.length })

    for (const conn of connections) {
      startRoomSession(conn.id, conn.instanceKey).catch(err =>
        logRoom('error', conn.instanceKey, 'restore.failed', { error: String(err) })
      )
    }
  } catch (err) {
    logRoom('error', 'startup', 'restore.error', { error: String(err) })
  }
}

let roomWatchdogInterval: NodeJS.Timeout | null = null

/**
 * Watchdog for room WhatsApp connections — mirrors startHealthWatchdog from whatsapp.ts.
 * Every 60s it checks for connections that the DB marks CONNECTED but have no active
 * socket in memory (zombie state), and attempts to restore them. Also resets the
 * reconnect attempt counter so connections with valid session files can recover after
 * hitting the MAX_ROOM_RECONNECT_ATTEMPTS cap.
 */
export function startRoomHealthWatchdog(): void {
  if (roomWatchdogInterval) return

  const WATCHDOG_INTERVAL_MS = 60_000

  roomWatchdogInterval = setInterval(async () => {
    try {
      // 1. CONNECTED in DB but socket not in memory and not connecting → zombie, restore
      const connectedConns = await prisma.roomWhatsAppConnection.findMany({
        where: { status: 'CONNECTED' },
        select: { id: true, instanceKey: true },
      }).catch(() => [] as { id: string; instanceKey: string }[])

      for (const conn of connectedConns) {
        if (!roomSockets.has(conn.instanceKey) && !roomConnecting.has(conn.instanceKey)) {
          const sessDir = path.join(SESSIONS_DIR, 'room_' + conn.instanceKey)
          if (fs.existsSync(sessDir)) {
            logRoom('warn', conn.instanceKey, 'watchdog.zombie_detected_restoring')
            startRoomSession(conn.id, conn.instanceKey).catch(err =>
              logRoom('error', conn.instanceKey, 'watchdog.restore_failed', { error: String(err) })
            )
          } else {
            logRoom('warn', conn.instanceKey, 'watchdog.zombie_no_files_disconnecting')
            await prisma.roomWhatsAppConnection.update({
              where: { id: conn.id },
              data: { status: 'DISCONNECTED', disconnectedAt: new Date() },
            }).catch(() => {})
          }
        }
      }

      // 2. DISCONNECTED with session files and reconnect cap exhausted →
      //    retry a limited number of full cycles; past that, the session is
      //    almost certainly corrupted (not a transient network blip) —
      //    quarantine it instead of retrying forever.
      const disconnectedConns = await prisma.roomWhatsAppConnection.findMany({
        where: {
          status: 'DISCONNECTED',
          disconnectedAt: { lt: new Date(Date.now() - 120_000) },
          reconnectAttempts: { gt: MAX_ROOM_RECONNECT_ATTEMPTS },
        },
        select: {
          id: true,
          instanceKey: true,
          doctorId: true,
          failureCycles: true,
          room: { select: { name: true } },
        },
      }).catch(() => [] as Array<{ id: string; instanceKey: string; doctorId: string; failureCycles: number; room: { name: string } | null }>)

      for (const conn of disconnectedConns) {
        if (roomSockets.has(conn.instanceKey) || roomConnecting.has(conn.instanceKey)) continue
        const sessDir = path.join(SESSIONS_DIR, 'room_' + conn.instanceKey)
        if (!fs.existsSync(sessDir)) continue

        const nextCycle = conn.failureCycles + 1
        if (nextCycle > MAX_QUARANTINE_CYCLES) {
          logRoom('warn', conn.instanceKey, 'watchdog.quarantined', { failureCycles: nextCycle })
          resetRoomSessionFiles(conn.instanceKey)
          await prisma.roomWhatsAppConnection.update({
            where: { id: conn.id },
            data: { status: 'QUARANTINED', failureCycles: nextCycle, reconnectAttempts: 0 },
          }).catch(() => {})
          await createNotification({
            userId: conn.doctorId,
            title: 'WhatsApp desconectado',
            message: `A conexão do WhatsApp${conn.room ? ` da sala "${conn.room.name}"` : ''} não conseguiu se recuperar sozinha e foi colocada em quarentena. Escaneie o QR code novamente para reconectar.`,
            type: 'ALERT',
            link: '/configuracoes/salas',
            category: 'SYSTEM',
            entityType: 'room',
            entityId: conn.id,
          })
          continue
        }

        logRoom('info', conn.instanceKey, 'watchdog.retrying_after_cap', { cycle: nextCycle })
        await prisma.roomWhatsAppConnection.update({
          where: { id: conn.id },
          data: { reconnectAttempts: 0, failureCycles: nextCycle },
        }).catch(() => {})
        startRoomSession(conn.id, conn.instanceKey).catch(err =>
          logRoom('error', conn.instanceKey, 'watchdog.retry_failed', { error: String(err) })
        )
      }
    } catch (e) {
      logRoom('error', 'global', 'room_watchdog.error', { error: String(e) })
    }
  }, WATCHDOG_INTERVAL_MS)

  logRoom('info', 'global', 'room_watchdog.started', { intervalMs: WATCHDOG_INTERVAL_MS })
}

/**
 * Tenta enviar uma mensagem de confirmação de agendamento via WhatsApp da sala.
 * Se houver uma configuração CONFIRM_APPOINTMENT ativa, envia o template SIM/NÃO
 * e registra a pendência. Caso contrário, usa o template APPOINTMENT_CONFIRMATION
 * ou uma mensagem padrão. Retorna true se enviada, false caso contrário.
 */
export async function tryRoomWhatsAppConfirmation(
  roomId: string,
  appointmentId: string,
  ctx: TemplateContext & { patientPhone: string; doctorId: string }
): Promise<boolean> {
  try {
    const connection = await prisma.roomWhatsAppConnection.findFirst({
      where: { roomId, status: 'CONNECTED' },
    })
    if (!connection) {
      logRoom('warn', 'room-wa', 'appointment.confirmation.no_connection', { roomId })
      return false
    }

    const sock = roomSockets.get(connection.instanceKey)
    if (!sock) {
      logRoom('warn', connection.instanceKey, 'appointment.confirmation.no_socket', { roomId, dbStatus: connection.status })
      return false
    }

    let content = ''
    let isPendingConfirm = false
    let declineContent = ''

    // 1. Check for active CONFIRM_APPOINTMENT system action (interactive SIM/NÃO)
    try {
      const chatbot = await prisma.lightChatbot.findUnique({
        where: { boundRoomId: roomId },
        select: { id: true },
      })
      const instance = chatbot
        ? await prisma.whatsAppInstance.findUnique({ where: { chatbotId: chatbot.id }, select: { id: true } })
        : null
      if (instance) {
        const confirmAction = await prisma.lightSystemActionConfig.findFirst({
          where: { instanceId: instance.id, actionKey: 'CONFIRM_APPOINTMENT', active: true },
        })
        if (confirmAction) {
          const cfg = confirmAction.config as Record<string, string>
          if (cfg?.confirmationMessage) {
            content = resolveTemplateVariables(cfg.confirmationMessage, ctx)
            declineContent = resolveTemplateVariables(
              cfg.declineMessage || 'Entendemos! Nossa equipe entrará em contato para encontrar um horário melhor para você.',
              ctx
            )
            isPendingConfirm = true
          }
        }
      }
    } catch { /* non-fatal — fall through to regular template */ }

    // 2. Check for active APPOINTMENT_CONFIRMATION integration template
    if (!content) {
      try {
        const config = await prisma.lightIntegrationConfig.findFirst({
          where: { doctorId: ctx.doctorId, triggerEvent: 'APPOINTMENT_CONFIRMATION', enabled: true },
          include: { template: { select: { content: true, active: true } } },
        })
        if (config?.template?.active && config.template.content) {
          content = resolveTemplateVariables(config.template.content, ctx)
        }
      } catch { /* non-fatal */ }
    }

    // 3. No active configuration found — do NOT send anything
    if (!content) {
      logRoom('info', connection.instanceKey, 'appointment.confirmation.skipped_no_config', { roomId, appointmentId })
      return false
    }

    // Resolve the canonical WhatsApp JID for the patient's phone.
    // Brazilian numbers may be registered on WhatsApp as 8-digit (old format) even
    // if stored with 9 digits — onWhatsApp() returns the server-side canonical JID
    // so the message is delivered to the right account and not silently dropped.
    const phoneCheck = await checkPhoneOnWhatsApp(connection.instanceKey, ctx.patientPhone).catch(() => null)
    const resolvedPhone = phoneCheck?.jid ?? normalizeToWhatsAppJid(ctx.patientPhone)
    if (phoneCheck && !phoneCheck.exists) {
      logRoom('warn', connection.instanceKey, 'appointment.confirmation.phone_not_on_whatsapp', {
        roomId,
        patientPhone: ctx.patientPhone,
        resolvedPhone,
      })
      return false
    }

    logRoom('info', connection.instanceKey, 'appointment.confirmation.attempt', {
      roomId,
      patientPhone: ctx.patientPhone,
      resolvedPhone,
      appointmentId,
      isPendingConfirm,
    })
    const result = await sendRoomWhatsAppMessage(connection.instanceKey, resolvedPhone, content)
    if (!result) {
      logRoom('error', connection.instanceKey, 'appointment.confirmation.send_failed', { roomId, patientPhone: ctx.patientPhone })
      return false
    }

    const phone = result.resolvedJid.replace('@s.whatsapp.net', '')

    if (isPendingConfirm) {
      registerRoomConfirmationPending(phone, {
        appointmentId,
        doctorId: ctx.doctorId,
        patientName: ctx.patientName ?? '',
        declineContent,
        instanceKey: connection.instanceKey,
      })
    }

    logRoom('info', connection.instanceKey, 'appointment.confirmation.sent', { roomId, resolvedJid: result.resolvedJid, interactive: isPendingConfirm })
    return true
  } catch (err) {
    logRoom('error', 'room-wa', 'appointment.confirmation.failed', { roomId, error: String(err) })
    return false
  }
}
