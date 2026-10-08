import { prisma } from './prisma'
import { getClinicTeamUserIds, notifyUsers } from './notifications'
import { notifyQueueWaiting } from './attendance'

// ─── Job periódico de notificações (a cada 30 min) ───────────────────────────
// - FOLLOW_UP: leads do CRM (Patient origin CHATBOT, leadStatus NOVO/EM_ANALISE)
//   sem atualização há > 24h (e < 7 dias — depois disso o lead é considerado
//   frio e para de gerar aviso diário). Dedupe diário por paciente+usuário.
// - CRM: pré-agendamentos (leadStatus NOVO, status PRE_CADASTRO) aguardando
//   há > 2h (e < 24h — depois disso vira follow-up). Dedupe único por paciente+usuário.
// - ATENDIMENTO: conversas QUEUED há > 15 min sem responsável. Dedupe por
//   conversa+hora (+usuário).
// Todas as chaves usam o índice único dedupeKey → P2002 é ignorado em createNotification.

const INTERVAL_MS = 30 * 60 * 1000
const FIRST_RUN_DELAY_MS = 60 * 1000
const MAX_PER_KIND = 500

const HOUR = 60 * 60 * 1000

function spDateKey(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function spHourKey(d = new Date()): string {
  const hour = d.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
  return `${spDateKey(d)}T${hour}`
}

function createTeamCache() {
  const cache = new Map<string, Promise<string[]>>()
  return (doctorId: string, roomId: string | null) => {
    const key = `${doctorId}:${roomId ?? ''}`
    let hit = cache.get(key)
    if (!hit) {
      hit = getClinicTeamUserIds(doctorId, roomId)
      cache.set(key, hit)
    }
    return hit
  }
}

async function runFollowUps(team: ReturnType<typeof createTeamCache>, now: Date) {
  const leads = await prisma.patient.findMany({
    where: {
      origin: 'CHATBOT',
      active: true,
      anonymizedAt: null,
      doctorId: { not: null },
      leadStatus: { in: ['NOVO', 'EM_ANALISE'] },
      updatedAt: { lt: new Date(now.getTime() - 24 * HOUR), gt: new Date(now.getTime() - 7 * 24 * HOUR) },
    },
    select: { id: true, name: true, doctorId: true, roomId: true, leadStatus: true },
    orderBy: { updatedAt: 'asc' },
    take: MAX_PER_KIND,
  })
  const day = spDateKey(now)
  for (const lead of leads) {
    const userIds = await team(lead.doctorId!, lead.roomId)
    await notifyUsers(userIds, {
      title: 'Follow-up pendente',
      message: `${lead.name} está ${lead.leadStatus === 'NOVO' ? 'como novo lead' : 'em análise'} há mais de 24h sem atualização.`,
      type: 'WARNING',
      category: 'FOLLOW_UP',
      link: '/agente/crm',
      entityType: 'patient',
      entityId: lead.id,
      dedupeKey: `followup:${lead.id}:${day}`,
    })
  }
  return leads.length
}

async function runPendingPreSchedulings(team: ReturnType<typeof createTeamCache>, now: Date) {
  const pending = await prisma.patient.findMany({
    where: {
      origin: 'CHATBOT',
      active: true,
      anonymizedAt: null,
      doctorId: { not: null },
      leadStatus: 'NOVO',
      status: 'PRE_CADASTRO',
      createdAt: { lt: new Date(now.getTime() - 2 * HOUR), gt: new Date(now.getTime() - 24 * HOUR) },
    },
    select: { id: true, name: true, doctorId: true, roomId: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_KIND,
  })
  for (const p of pending) {
    const userIds = await team(p.doctorId!, p.roomId)
    await notifyUsers(userIds, {
      title: 'Pré-agendamento aguardando',
      message: `${p.name} aguarda contato da equipe há mais de 2h.`,
      type: 'INFO',
      category: 'CRM',
      link: '/agente/crm',
      entityType: 'patient',
      entityId: p.id,
      dedupeKey: `presched:${p.id}`,
    })
  }
  return pending.length
}

async function runQueuedConversations(now: Date) {
  const waiting = await prisma.conversation.findMany({
    where: {
      attendanceStatus: 'QUEUED',
      assignedUserId: null,
      doctorId: { not: null },
      roomId: { not: null },
      queuedAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) },
    },
    select: {
      id: true,
      doctorId: true,
      roomId: true,
      queueId: true,
      queuedAt: true,
      contactName: true,
      contactPhone: true,
      patient: { select: { name: true } },
      queue: { select: { name: true } },
    },
    orderBy: { queuedAt: 'asc' },
    take: MAX_PER_KIND,
  })
  const hour = spHourKey(now)
  for (const c of waiting) {
    const minutes = Math.round((now.getTime() - (c.queuedAt?.getTime() ?? now.getTime())) / 60000)
    const label = c.patient?.name || c.contactName || c.contactPhone.replace(/@.*$/, '')
    await notifyQueueWaiting({
      conversationId: c.id,
      doctorId: c.doctorId!,
      roomId: c.roomId,
      queueId: c.queueId,
      title: 'Conversa aguardando na fila',
      message: `${label} aguarda atendimento há ${minutes} min${c.queue ? ` na fila ${c.queue.name}` : ''}.`,
      dedupeKey: `queue-wait:${c.id}:${hour}`,
    })
  }
  return waiting.length
}

let running = false

export async function runNotificationJobs(): Promise<void> {
  if (running) return // proteção contra execução sobreposta
  running = true
  const startedAt = Date.now()
  try {
    const now = new Date()
    const team = createTeamCache()
    const followUps = await runFollowUps(team, now).catch((err) => {
      console.error('[notification-jobs] follow-up falhou:', err?.message)
      return 0
    })
    const preSchedulings = await runPendingPreSchedulings(team, now).catch((err) => {
      console.error('[notification-jobs] pré-agendamentos falhou:', err?.message)
      return 0
    })
    const queued = await runQueuedConversations(now).catch((err) => {
      console.error('[notification-jobs] fila de atendimento falhou:', err?.message)
      return 0
    })
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      module: 'NOTIFICATION_JOBS',
      event: 'run.completed',
      followUps,
      preSchedulings,
      queued,
      ms: Date.now() - startedAt,
    }))
  } finally {
    running = false
  }
}

let interval: NodeJS.Timeout | null = null

export function startNotificationJobs(): void {
  if (interval) return
  setTimeout(() => { runNotificationJobs().catch(() => {}) }, FIRST_RUN_DELAY_MS)
  interval = setInterval(() => { runNotificationJobs().catch(() => {}) }, INTERVAL_MS)
}
