import { NotificationCategory, Prisma } from '@prisma/client'
import { prisma } from './prisma'

// ─── Notificações ─────────────────────────────────────────────────────────────
// Só entram aqui: agendamentos (novo/remarcado/confirmado), cancelamentos,
// follow-up de leads, pendências do CRM, atendimento (fila/transferência) e
// alertas críticos de sistema. Mensagens de WhatsApp NÃO geram notificação —
// isso é papel do módulo Atendimento.

export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT'

export interface NotificationInput {
  userId: string
  title: string
  message: string
  type?: NotificationType
  link?: string | null
  category?: NotificationCategory
  entityType?: string | null
  entityId?: string | null
  // Chave de deduplicação GLOBAL (o índice é único na tabela inteira) — quem
  // notifica vários usuários deve incluir o userId na chave (notifyClinicTeam faz isso).
  dedupeKey?: string | null
}

export type NotificationPayload = Omit<NotificationInput, 'userId'>

/**
 * Cria uma notificação. Nunca lança — notificação não é crítica.
 * Retorna true se criou, false se já existia (dedupeKey) ou falhou.
 */
export async function createNotification(input: NotificationInput): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        message: input.message,
        type: input.type ?? 'INFO',
        link: input.link ?? null,
        category: input.category ?? 'SYSTEM',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    console.error('[notifications] falha ao criar notificação:', (err as Error)?.message)
    return false
  }
}

/**
 * Usuários da "equipe" do médico que devem receber avisos de uma sala:
 * o médico + secretárias com vínculo ativo; se roomId for informado, só as
 * secretárias com RoomSecretary ativo naquela sala.
 */
export async function getClinicTeamUserIds(doctorId: string, roomId: string | null): Promise<string[]> {
  const secretaries = await prisma.user.findMany({
    where: {
      active: true,
      role: 'SECRETARY',
      secretaryOf: { some: { doctorId, active: true } },
      ...(roomId ? { roomAssignments: { some: { roomId, active: true } } } : {}),
    },
    select: { id: true },
  })
  return Array.from(new Set([doctorId, ...secretaries.map((s) => s.id)]))
}

/**
 * Notifica o médico + secretárias com acesso à sala. dedupeKey (se houver)
 * vira `${dedupeKey}:${userId}` por destinatário.
 */
export async function notifyClinicTeam(
  doctorId: string,
  roomId: string | null,
  payload: NotificationPayload,
  options: { excludeUserIds?: string[] } = {},
): Promise<void> {
  try {
    const exclude = new Set(options.excludeUserIds ?? [])
    const userIds = (await getClinicTeamUserIds(doctorId, roomId)).filter((id) => !exclude.has(id))
    await notifyUsers(userIds, payload)
  } catch (err) {
    console.error('[notifications] notifyClinicTeam falhou:', (err as Error)?.message)
  }
}

/** Notifica uma lista de usuários com o mesmo payload (dedupeKey por usuário). */
export async function notifyUsers(userIds: string[], payload: NotificationPayload): Promise<void> {
  await Promise.all(
    Array.from(new Set(userIds)).map((userId) =>
      createNotification({
        ...payload,
        userId,
        dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${userId}` : null,
      }),
    ),
  )
}

// Datas de consulta sempre no fuso da clínica (o servidor roda em UTC: às
// 22h de Brasília ele já está no dia seguinte). Com dia da semana pra a
// equipe bater o olho e conferir ("sex., 09/10/2026 às 14:00").
const CLINIC_TZ = 'America/Sao_Paulo'

function fmtDateTime(date: Date): string {
  const wd = date.toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ, weekday: 'short' })
  const d = date.toLocaleDateString('pt-BR', { timeZone: CLINIC_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
  const t = date.toLocaleTimeString('pt-BR', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit' })
  return `${wd}, ${d} às ${t}`
}

export type AppointmentNotificationKind = 'created' | 'rescheduled' | 'confirmed' | 'cancelled'

/** Aviso padronizado de agendamento para a equipe da sala. */
export async function notifyAppointmentEvent(params: {
  kind: AppointmentNotificationKind
  appointmentId: string
  doctorId: string
  roomId: string | null
  patientName: string
  date: Date
  actorLabel?: string // ex.: "pelo Agente de IA", "pelo WhatsApp"
  extra?: string
  count?: number
  excludeUserIds?: string[]
}): Promise<void> {
  const { kind, patientName, date, actorLabel, extra } = params
  const by = actorLabel ? ` ${actorLabel}` : ''
  const when = fmtDateTime(date)
  const map: Record<AppointmentNotificationKind, { title: string; message: string; type: NotificationType; category: NotificationCategory }> = {
    created: {
      title: params.count && params.count > 1 ? `${params.count} agendamentos criados` : 'Novo agendamento',
      message: params.count && params.count > 1
        ? `${patientName} – ${params.count} sessões semanais a partir de ${when}${by}.`
        : `${patientName} agendado para ${when}${by}.`,
      type: 'INFO',
      category: 'AGENDAMENTO',
    },
    rescheduled: { title: 'Consulta remarcada', message: `Consulta de ${patientName} remarcada para ${when}${by}.`, type: 'INFO', category: 'AGENDAMENTO' },
    confirmed: { title: 'Consulta confirmada', message: `${patientName} confirmou a consulta de ${when}${by}.`, type: 'SUCCESS', category: 'AGENDAMENTO' },
    cancelled: { title: 'Consulta cancelada', message: `Consulta de ${patientName} (${when}) cancelada${by}.`, type: 'WARNING', category: 'CANCELAMENTO' },
  }
  const n = map[kind]
  await notifyClinicTeam(
    params.doctorId,
    params.roomId,
    {
      title: n.title,
      message: extra ? `${n.message} ${extra}` : n.message,
      type: n.type,
      category: n.category,
      link: '/agenda',
      entityType: 'appointment',
      entityId: params.appointmentId,
    },
    { excludeUserIds: params.excludeUserIds },
  )
}
