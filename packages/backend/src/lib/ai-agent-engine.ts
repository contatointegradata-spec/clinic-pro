import { prisma } from './prisma'
import { geminiChatCompletion } from './gemini-client'
import { AiMessage, AiTool } from './ai-client-types'
import { resolveChatbotLightSendTarget, sendRoomWhatsAppMessage, normalizeToWhatsAppJid, checkPhoneOnWhatsApp } from './room-whatsapp'
import { checkLunchOverlap } from '../routes/appointments'
import { getLocalDateInTz } from './chatbot-light-guided-engine'
import { findPatientByPhone, normalizePatientPhone } from './phone'
import { notifyAppointmentEvent } from './notifications'
import { handoffToHuman, isConversationWithBot, linkConversationPatient, HANDOFF_TRANSITION_MESSAGE, HandoffTarget } from './attendance'
import { logAudit } from './secretaryAccess'

const MAX_TOOL_ITERATIONS = 3
const CONTEXT_MESSAGE_LIMIT = 20

type RoomForSchedule = {
  id: string
  daysOfWeek: unknown
  startTime: string
  endTime: string
  breakStart: string | null
  breakEnd: string | null
  specialHours: unknown
  slotDurationMinutes: number
}

function parseLocalDateToUtcDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const localStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  return new Date(`${localStr}-03:00`)
}

function parseDaysOfWeek(raw: unknown): number[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? arr.map(Number).filter(n => !isNaN(n)) : []
  } catch {
    return []
  }
}

function getDayScheduleForRoom(room: RoomForSchedule, dayNum: number): { start: string; end: string } | null {
  const days = parseDaysOfWeek(room.daysOfWeek)
  if (!days.includes(dayNum)) return null
  const special = room.specialHours as Record<string, { start: string; end: string }> | null
  if (special?.[String(dayNum)]) return special[String(dayNum)]
  return { start: room.startTime, end: room.endTime }
}

function describeRoomSchedule(room: RoomForSchedule): string {
  const dayLabels = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
  const days = parseDaysOfWeek(room.daysOfWeek)
  const lines = days.map(d => {
    const sched = getDayScheduleForRoom(room, d)
    return sched ? `${dayLabels[d]}: ${sched.start} às ${sched.end}` : null
  }).filter(Boolean)
  const parts = [lines.join('; ')]
  if (room.breakStart && room.breakEnd) parts.push(`Intervalo diário: ${room.breakStart} às ${room.breakEnd}`)
  parts.push(`Duração de cada consulta: ${room.slotDurationMinutes} minutos`)
  return parts.join('\n')
}

// Dia da semana (1=Segunda..7=Domingo) a partir de uma data YYYY-MM-DD, sem
// depender do timezone do servidor (Date.UTC com os mesmos Y/M/D é seguro
// pra isso, já que só nos importa o dia do calendário, não um instante).
function dayOfWeekFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

async function getConflicts(doctorId: string, dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dayStart = parseLocalDateToUtcDate(y, m, d, 0, 0)
  const dayEnd = parseLocalDateToUtcDate(y, m, d, 23, 59)

  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: { doctorId, status: { not: 'CANCELLED' }, date: { gte: dayStart, lte: dayEnd } },
      select: { date: true, duration: true },
    }),
    prisma.appointmentBlock.findMany({
      where: { doctorId, date: { lte: dayEnd }, endDate: { gte: dayStart } },
      select: { date: true, endDate: true },
    }),
  ])
  return { appointments, blocks }
}

function isSlotFree(
  slotStart: Date,
  slotEnd: Date,
  appointments: { date: Date; duration: number }[],
  blocks: { date: Date; endDate: Date }[],
): boolean {
  const hasApptConflict = appointments.some(a => {
    const aStart = new Date(a.date)
    const aEnd = new Date(aStart.getTime() + (a.duration || 30) * 60_000)
    return aStart < slotEnd && aEnd > slotStart
  })
  if (hasApptConflict) return false
  return !blocks.some(b => new Date(b.date) < slotEnd && new Date(b.endDate) > slotStart)
}

async function checkAvailability(doctorId: string, room: RoomForSchedule, dateStr: string): Promise<string[]> {
  const dayNum = dayOfWeekFromDateStr(dateStr)
  const schedule = getDayScheduleForRoom(room, dayNum)
  if (!schedule) return []

  const [startH, startM] = schedule.start.split(':').map(Number)
  const [endH, endM] = schedule.end.split(':').map(Number)
  const [y, m, d] = dateStr.split('-').map(Number)
  const duration = room.slotDurationMinutes || 30

  let slotStart = parseLocalDateToUtcDate(y, m, d, startH, startM)
  const dayEnd = parseLocalDateToUtcDate(y, m, d, endH, endM)
  const breakStart = room.breakStart ? parseLocalDateToUtcDate(y, m, d, ...(room.breakStart.split(':').map(Number) as [number, number])) : null
  const breakEnd = room.breakEnd ? parseLocalDateToUtcDate(y, m, d, ...(room.breakEnd.split(':').map(Number) as [number, number])) : null

  const { appointments, blocks } = await getConflicts(doctorId, dateStr)
  const now = new Date()
  const available: string[] = []

  while (slotStart < dayEnd) {
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    if (slotEnd > dayEnd) break

    const withinBreak = breakStart && breakEnd && slotStart < breakEnd && slotEnd > breakStart
    if (!withinBreak && slotStart >= now && isSlotFree(slotStart, slotEnd, appointments, blocks)) {
      // slotStart foi construído com offset -03:00 (América/São Paulo), então
      // a hora local é sempre (getUTCHours() - 3 + 24) % 24.
      const hh = String((slotStart.getUTCHours() - 3 + 24) % 24).padStart(2, '0')
      const mm = String(slotStart.getUTCMinutes()).padStart(2, '0')
      available.push(`${hh}:${mm}`)
    }
    slotStart = slotEnd
  }
  return available
}

interface CreateAppointmentArgs {
  patientName: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  notes?: string
}

async function createAppointmentTool(
  doctorId: string,
  room: RoomForSchedule,
  patientId: string | null,
  canonicalPhone: string,
  args: CreateAppointmentArgs,
): Promise<{ success: boolean; message: string }> {
  const [y, m, d] = args.date.split('-').map(Number)
  const [h, min] = args.time.split(':').map(Number)
  if (!y || !m || !d || isNaN(h) || isNaN(min)) {
    return { success: false, message: 'Data ou horário em formato inválido — peça pro paciente confirmar dia e hora novamente.' }
  }

  const duration = room.slotDurationMinutes || 30
  const slotStart = parseLocalDateToUtcDate(y, m, d, h, min)
  const slotEnd = new Date(slotStart.getTime() + duration * 60_000)

  const dayNum = dayOfWeekFromDateStr(args.date)
  if (!getDayScheduleForRoom(room, dayNum)) {
    return { success: false, message: 'Esse dia não tem atendimento — sugira ao paciente outro dia dentro do horário de funcionamento.' }
  }

  if (await checkLunchOverlap(doctorId, slotStart, duration)) {
    return { success: false, message: 'Esse horário cai no intervalo de almoço do profissional — sugira outro horário.' }
  }

  // A checagem de conflito + criação da consulta rodam na mesma transação
  // (isolation Serializable) pra fechar a janela de corrida entre "confirmei
  // que tá livre" e "criei a consulta" — sem isso, duas mensagens quase
  // simultâneas de pacientes diferentes pedindo o mesmo horário podiam
  // resultar em dois agendamentos sobrepostos.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const [dayStart, dayEnd] = [
        parseLocalDateToUtcDate(y, m, d, 0, 0),
        parseLocalDateToUtcDate(y, m, d, 23, 59),
      ]
      const [conflictingAppointments, conflictingBlocks] = await Promise.all([
        tx.appointment.findMany({
          where: { doctorId, status: { not: 'CANCELLED' }, date: { gte: dayStart, lte: dayEnd } },
          select: { date: true, duration: true },
        }),
        tx.appointmentBlock.findMany({
          where: { doctorId, date: { lte: dayEnd }, endDate: { gte: dayStart } },
          select: { date: true, endDate: true },
        }),
      ])

      if (!isSlotFree(slotStart, slotEnd, conflictingAppointments, conflictingBlocks)) {
        return { success: false as const, message: 'Esse horário acabou de ficar indisponível — peça pro paciente escolher outro horário (use check_availability de novo).' }
      }

      // Normalmente já existe um Patient aqui — handleAiAgentMessage cria um
      // lead (leadStatus NOVO) desde a primeira mensagem, com nome
      // placeholder, e resolve esse MESMO patientId pelo telefone de quem
      // está mandando a mensagem (nunca por um telefone que o modelo tenha
      // digitado/extraído da conversa — isso já causou lead duplicado no
      // CRM, com o agendamento "convertendo" um Patient diferente do lead
      // original). Agendar é a conversão de verdade: atualiza o nome real
      // e avança o card pro "Convertido" no kanban do CRM automaticamente.
      let patient = patientId ? await tx.patient.findUnique({ where: { id: patientId } }) : null
      if (!patient) {
        patient = await tx.patient.create({
          data: {
            name: args.patientName,
            phone: canonicalPhone,
            doctorId,
            roomId: room.id,
            status: 'PRE_CADASTRO',
            origin: 'CHATBOT',
            leadStatus: 'CONVERTIDO',
          },
        })
      } else {
        patient = await tx.patient.update({
          where: { id: patient.id },
          data: {
            name: args.patientName,
            ...(patient.leadStatus && patient.leadStatus !== 'CONVERTIDO' ? { leadStatus: 'CONVERTIDO' as const } : {}),
          },
        })
      }

      const appointment = await tx.appointment.create({
        data: {
          patientId: patient.id,
          doctorId,
          createdById: doctorId,
          roomId: room.id,
          title: `Consulta - ${patient.name}`,
          date: slotStart,
          duration,
          status: 'SCHEDULED',
          notes: args.notes || null,
        },
      })

      return {
        success: true as const,
        message: `Consulta marcada com sucesso para ${args.date} às ${args.time}. Confirme isso pro paciente de forma natural.`,
        appointmentId: appointment.id,
        patientName: patient.name,
      }
    }, { isolationLevel: 'Serializable' })

    if (result.success) {
      await notifyAppointmentEvent({
        kind: 'created',
        appointmentId: result.appointmentId,
        doctorId,
        roomId: room.id,
        patientName: result.patientName,
        date: slotStart,
        actorLabel: 'pelo Agente de IA',
      }).catch(() => {})
    }
    return { success: result.success, message: result.message }
  } catch (err) {
    console.error('[ai-agent-engine] createAppointmentTool transaction error:', err)
    return { success: false, message: 'Não consegui confirmar o agendamento agora — peça pro paciente tentar de novo em instantes.' }
  }
}

// ─── Listar/remarcar/cancelar consulta existente ───────────────────────────
// Antes só existia create_appointment — pedir pra "mudar" a consulta fazia
// o modelo criar uma SEGUNDA consulta em vez de atualizar a primeira (bug
// real encontrado em produção: duas consultas pro mesmo paciente). Essas
// ferramentas sempre operam sobre o `patientId` já resolvido pelo telefone
// de quem está mandando mensagem — nunca confiam num id vindo "cru" da
// conversa sem confirmar que pertence a esse paciente+médico.

async function findUpcomingAppointments(doctorId: string, patientId: string) {
  return prisma.appointment.findMany({
    where: { doctorId, patientId, status: { notIn: ['CANCELLED', 'COMPLETED'] }, date: { gte: new Date() } },
    orderBy: { date: 'asc' },
  })
}

function formatAppointmentList(appts: { id: string; date: Date }[]): string {
  return appts.map(a => {
    const d = new Date(a.date)
    const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const timeStr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    return `- id: ${a.id} | ${dateStr} às ${timeStr}`
  }).join('\n')
}

async function listAppointmentsTool(doctorId: string, patientId: string): Promise<string> {
  const appts = await findUpcomingAppointments(doctorId, patientId)
  if (appts.length === 0) return 'O paciente não tem nenhuma consulta futura agendada.'
  return `Consultas futuras do paciente:\n${formatAppointmentList(appts)}`
}

type ResolvedAppointment = { id: string; date: Date; duration: number }
type ResolveApptResult =
  | { kind: 'found'; appointment: ResolvedAppointment }
  | { kind: 'none' }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'not_owned' }

// id opcional: se o modelo já chamou list_my_appointments e tem o id, usa
// direto (mas sempre reconfirma doctorId+patientId — nunca confia cego). Sem
// id: 0 consultas → avisa, 1 → usa, >1 → devolve a lista e pede pro modelo
// perguntar ao paciente antes de agir.
async function resolveTargetAppointment(doctorId: string, patientId: string, appointmentId?: string): Promise<ResolveApptResult> {
  if (appointmentId) {
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
    if (!appt || appt.doctorId !== doctorId || appt.patientId !== patientId) return { kind: 'not_owned' }
    return { kind: 'found', appointment: appt }
  }
  const appts = await findUpcomingAppointments(doctorId, patientId)
  if (appts.length === 0) return { kind: 'none' }
  if (appts.length === 1) return { kind: 'found', appointment: appts[0] }
  return { kind: 'ambiguous', message: `O paciente tem mais de uma consulta futura — pergunte qual ele quer alterar antes de continuar:\n${formatAppointmentList(appts)}` }
}

interface RescheduleArgs { newDate: string; newTime: string; appointmentId?: string }

async function rescheduleAppointmentTool(
  doctorId: string,
  room: RoomForSchedule,
  patientId: string,
  args: RescheduleArgs,
): Promise<{ success: boolean; message: string }> {
  const resolved = await resolveTargetAppointment(doctorId, patientId, args.appointmentId)
  if (resolved.kind === 'none') return { success: false, message: 'Não encontrei nenhuma consulta futura desse paciente pra alterar.' }
  if (resolved.kind === 'not_owned') return { success: false, message: 'Não encontrei essa consulta — use list_my_appointments pra confirmar qual o paciente quer alterar.' }
  if (resolved.kind === 'ambiguous') return { success: false, message: resolved.message }

  const [y, m, d] = args.newDate.split('-').map(Number)
  const [h, min] = args.newTime.split(':').map(Number)
  if (!y || !m || !d || isNaN(h) || isNaN(min)) {
    return { success: false, message: 'Data ou horário em formato inválido — peça pro paciente confirmar dia e hora novamente.' }
  }

  const duration = resolved.appointment.duration || room.slotDurationMinutes || 30
  const slotStart = parseLocalDateToUtcDate(y, m, d, h, min)
  const slotEnd = new Date(slotStart.getTime() + duration * 60_000)

  const dayNum = dayOfWeekFromDateStr(args.newDate)
  if (!getDayScheduleForRoom(room, dayNum)) {
    return { success: false, message: 'Esse dia não tem atendimento — sugira ao paciente outro dia dentro do horário de funcionamento.' }
  }
  if (await checkLunchOverlap(doctorId, slotStart, duration)) {
    return { success: false, message: 'Esse horário cai no intervalo de almoço do profissional — sugira outro horário.' }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [dayStart, dayEnd] = [parseLocalDateToUtcDate(y, m, d, 0, 0), parseLocalDateToUtcDate(y, m, d, 23, 59)]
      const [conflictingAppointments, conflictingBlocks] = await Promise.all([
        tx.appointment.findMany({
          where: { doctorId, status: { not: 'CANCELLED' }, date: { gte: dayStart, lte: dayEnd }, id: { not: resolved.appointment.id } },
          select: { date: true, duration: true },
        }),
        tx.appointmentBlock.findMany({
          where: { doctorId, date: { lte: dayEnd }, endDate: { gte: dayStart } },
          select: { date: true, endDate: true },
        }),
      ])
      if (!isSlotFree(slotStart, slotEnd, conflictingAppointments, conflictingBlocks)) {
        return { success: false as const, message: 'Esse horário acabou de ficar indisponível — peça pro paciente escolher outro horário (use check_availability de novo).' }
      }
      const updated = await tx.appointment.update({
        where: { id: resolved.appointment.id },
        data: { date: slotStart },
        include: { patient: { select: { name: true } } },
      })
      return { success: true as const, message: `Consulta remarcada com sucesso para ${args.newDate} às ${args.newTime}. Confirme isso pro paciente de forma natural.`, patientName: updated.patient.name }
    }, { isolationLevel: 'Serializable' })

    if (result.success) {
      await notifyAppointmentEvent({
        kind: 'rescheduled',
        appointmentId: resolved.appointment.id,
        doctorId,
        roomId: room.id,
        patientName: result.patientName,
        date: slotStart,
        actorLabel: 'pelo Agente de IA',
      }).catch(() => {})
      await logAudit({
        userId: doctorId,
        action: 'AI_AGENT_APPOINTMENT_RESCHEDULED',
        description: `Agente de IA remarcou consulta de ${result.patientName}`,
        metadata: { appointmentId: resolved.appointment.id, newDate: args.newDate, newTime: args.newTime },
      }).catch(() => {})
    }
    return result
  } catch (err) {
    console.error('[ai-agent-engine] rescheduleAppointmentTool error:', err)
    return { success: false, message: 'Não consegui remarcar agora — peça pro paciente tentar de novo em instantes.' }
  }
}

interface CancelArgs { appointmentId?: string; reason?: string }

async function cancelAppointmentTool(doctorId: string, patientId: string, args: CancelArgs): Promise<{ success: boolean; message: string }> {
  const resolved = await resolveTargetAppointment(doctorId, patientId, args.appointmentId)
  if (resolved.kind === 'none') return { success: false, message: 'Não encontrei nenhuma consulta futura desse paciente pra cancelar.' }
  if (resolved.kind === 'not_owned') return { success: false, message: 'Não encontrei essa consulta — use list_my_appointments pra confirmar qual o paciente quer cancelar.' }
  if (resolved.kind === 'ambiguous') return { success: false, message: resolved.message }

  try {
    const updated = await prisma.appointment.update({
      where: { id: resolved.appointment.id },
      data: { status: 'CANCELLED' },
      include: { patient: { select: { name: true } } },
    })
    await notifyAppointmentEvent({
      kind: 'cancelled',
      appointmentId: updated.id,
      doctorId,
      roomId: updated.roomId,
      patientName: updated.patient.name,
      date: updated.date,
      actorLabel: 'pelo paciente via Agente de IA',
      extra: args.reason ? `Motivo: ${args.reason}.` : undefined,
    }).catch(() => {})
    await logAudit({
      userId: doctorId,
      action: 'AI_AGENT_APPOINTMENT_CANCELLED',
      description: `Agente de IA cancelou consulta de ${updated.patient.name}`,
      metadata: { appointmentId: resolved.appointment.id, reason: args.reason },
    }).catch(() => {})
    return { success: true, message: 'Consulta cancelada com sucesso. Confirme isso pro paciente de forma natural.' }
  } catch (err) {
    console.error('[ai-agent-engine] cancelAppointmentTool error:', err)
    return { success: false, message: 'Não consegui cancelar agora — peça pro paciente tentar de novo em instantes.' }
  }
}

// ─── Entregar documento pré-gerado (nunca gera/edita conteúdo) ─────────────

async function findReadyDocuments(doctorId: string, patientId: string, documentId?: string, documentName?: string) {
  if (documentId) {
    const doc = await prisma.generatedDocument.findUnique({ where: { id: documentId } })
    if (!doc || doc.doctorId !== doctorId || doc.patientId !== patientId || doc.status !== 'READY') return []
    return [doc]
  }
  return prisma.generatedDocument.findMany({
    where: {
      doctorId, patientId, status: 'READY',
      ...(documentName ? { name: { contains: documentName, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
}

async function listReadyDocumentsTool(doctorId: string, patientId: string): Promise<string> {
  const docs = await findReadyDocuments(doctorId, patientId)
  if (docs.length === 0) return 'Não há nenhum documento pronto pra esse paciente no momento — informe que ele precisa solicitar ao consultório.'
  return `Documentos disponíveis pra esse paciente:\n${docs.map(d => `- id: ${d.id} | ${d.name} (gerado em ${new Date(d.createdAt).toLocaleDateString('pt-BR')})`).join('\n')}`
}

interface SendDocArgs { documentId?: string; documentName?: string }

async function sendReadyDocumentTool(
  doctorId: string,
  patientId: string,
  chatbotId: string,
  contactPhone: string,
  deliveryJid: string,
  args: SendDocArgs,
  conversationId?: string | null,
): Promise<{ success: boolean; message: string }> {
  const docs = await findReadyDocuments(doctorId, patientId, args.documentId, args.documentName)
  if (docs.length === 0) return { success: false, message: 'Não encontrei nenhum documento pronto com esse nome pra esse paciente — use list_ready_documents pra ver o que está disponível.' }
  if (docs.length > 1) {
    return { success: false, message: `Tem mais de um documento disponível, pergunte qual o paciente quer antes de enviar:\n${docs.map(d => `- id: ${d.id} | ${d.name}`).join('\n')}` }
  }
  const doc = docs[0]

  const target = await resolveChatbotLightSendTarget(chatbotId)
  if (!target) return { success: false, message: 'Não consegui enviar o documento agora (WhatsApp desconectado) — avise que a equipe vai mandar manualmente.' }

  try {
    const phoneCheck = await checkPhoneOnWhatsApp(target.instanceKey, contactPhone).catch(() => null)
    const sendJid = phoneCheck?.jid ?? normalizeToWhatsAppJid(deliveryJid)
    const sent = await sendRoomWhatsAppMessage(target.instanceKey, sendJid, doc.content, { conversationId })
    if (!sent) throw new Error('send failed')
    await prisma.generatedDocument.update({ where: { id: doc.id }, data: { status: 'SENT', sentAt: new Date() } })
    return { success: true, message: `Documento "${doc.name}" enviado com sucesso. Confirme isso pro paciente de forma natural, sem repetir o conteúdo do documento.` }
  } catch (err) {
    console.error('[ai-agent-engine] sendReadyDocumentTool error:', err)
    return { success: false, message: 'Não consegui enviar o documento agora — avise que a equipe vai mandar manualmente.' }
  }
}

const TRANSFER_TOOL: AiTool = {
  type: 'function',
  function: {
    name: 'transfer_to_human',
    description: 'Transfere a conversa para a equipe humana da clínica e encerra a sua participação. Use quando o paciente pedir para falar com uma pessoa/atendente, fizer uma reclamação, trouxer dúvida clínica ou sintoma, pedir algo fora do seu escopo, ou quando você não conseguir resolver.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Motivo curto da transferência (ex: "paciente pediu atendente", "dúvida sobre sintoma")' },
        target: { type: 'string', enum: ['reception', 'doctor'], description: '"doctor" para dúvidas clínicas/sintomas/resultados de exame; "reception" para todo o resto' },
      },
      required: ['reason'],
    },
  },
}

function buildTools(includeScheduling: boolean, includeTransfer: boolean): AiTool[] {
  const transferTools: AiTool[] = includeTransfer ? [TRANSFER_TOOL] : []
  const documentTools: AiTool[] = [
    ...transferTools,
    {
      type: 'function',
      function: {
        name: 'list_ready_documents',
        description: 'Lista documentos (atestado, declaração, recibo etc) já preparados e prontos pra enviar a esse paciente.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_ready_document',
        description: 'Envia um documento já pronto ao paciente. NUNCA invente ou escreva conteúdo de documento você mesmo — só use essa ferramenta pra entregar o que já foi preparado. Use list_ready_documents antes se não souber o id.',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'id do documento, se já souber (de list_ready_documents)' },
            documentName: { type: 'string', description: 'nome/tipo do documento pedido (ex: "atestado"), se não souber o id' },
          },
          required: [],
        },
      },
    },
  ]

  if (!includeScheduling) return documentTools

  return [
    ...documentTools,
    {
      type: 'function',
      function: {
        name: 'check_availability',
        description: 'Consulta os horários disponíveis para consulta em uma data específica.',
        parameters: {
          type: 'object',
          properties: { date: { type: 'string', description: 'Data no formato YYYY-MM-DD' } },
          required: ['date'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_appointment',
        description: 'Cria de fato o agendamento de uma consulta NOVA, depois que o paciente confirmou nome, data e horário. Pra alterar ou cancelar uma consulta que já existe, use reschedule_appointment ou cancel_appointment — nunca crie uma nova no lugar.',
        parameters: {
          type: 'object',
          properties: {
            patientName: { type: 'string', description: 'Nome completo do paciente' },
            date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
            time: { type: 'string', description: 'Horário no formato HH:MM' },
            notes: { type: 'string', description: 'Observações adicionais (opcional)' },
          },
          required: ['patientName', 'date', 'time'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_my_appointments',
        description: 'Lista as consultas futuras já agendadas desse paciente — use antes de reagendar/cancelar se não tiver certeza de qual consulta o paciente quer alterar.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'reschedule_appointment',
        description: 'Altera a data/horário de uma consulta JÁ EXISTENTE desse paciente (nunca cria uma nova). Se o paciente tiver mais de uma consulta futura, pergunte qual antes de chamar — ou chame sem appointmentId pra ferramenta te dizer se precisa perguntar.',
        parameters: {
          type: 'object',
          properties: {
            newDate: { type: 'string', description: 'Nova data no formato YYYY-MM-DD' },
            newTime: { type: 'string', description: 'Novo horário no formato HH:MM' },
            appointmentId: { type: 'string', description: 'id da consulta a alterar, se já souber (de list_my_appointments)' },
          },
          required: ['newDate', 'newTime'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_appointment',
        description: 'Cancela uma consulta JÁ EXISTENTE desse paciente. Se o paciente tiver mais de uma consulta futura, pergunte qual antes.',
        parameters: {
          type: 'object',
          properties: {
            appointmentId: { type: 'string', description: 'id da consulta a cancelar, se já souber (de list_my_appointments)' },
            reason: { type: 'string', description: 'Motivo do cancelamento, se o paciente informar (opcional)' },
          },
          required: [],
        },
      },
    },
  ]
}

export async function handleAiAgentMessage(params: {
  chatbotId: string
  doctorId: string
  contactPhone: string
  deliveryJid: string
  messageText: string
  // Conversa do Atendimento — habilita transfer_to_human e a checagem de
  // status (humano no controle → IA não responde).
  conversationId?: string | null
}): Promise<void> {
  const { chatbotId, doctorId, contactPhone, deliveryJid, messageText } = params
  const conversationId = params.conversationId ?? null

  // Humano assumiu/transferiu enquanto a mensagem chegava → IA fica quieta.
  if (conversationId && !(await isConversationWithBot(conversationId))) return
  // contactPhone normalmente já é o telefone real (resolveWhatsAppContactIdentity
  // prioriza isso) — só cai pra "@lid" bruto quando a WhatsApp não mandou o
  // telefone junto da mensagem (raro, ver lib/whatsapp.ts). Nesse caso os
  // dígitos do lid não são um telefone de verdade; tratamos como identificador
  // interno só pra não quebrar o fluxo, mas sem fingir que é o telefone do
  // paciente na exibição (CRM, nome do lead).
  const isUnresolvedLid = contactPhone.endsWith('@lid')
  const normalizedPhone = contactPhone.replace(/\D/g, '')

  const ignored = await prisma.lightIgnoredNumber.findUnique({
    where: { chatbotId_phone: { chatbotId, phone: normalizedPhone } },
  }).catch(() => null)
  if (ignored) return

  const chatbot = await prisma.lightChatbot.findUnique({ where: { id: chatbotId }, include: { boundRoom: true } })
  if (!chatbot || !chatbot.active || !chatbot.systemPrompt) return

  const room = chatbot.boundRoom as RoomForSchedule | null

  // CRM — garante que todo contato novo vira um lead rastreável desde a
  // primeira mensagem, não só quando agenda (ver createAppointmentTool,
  // que atualiza o nome real e marca CONVERTIDO quando o agendamento
  // acontece de fato). Quem nunca evolui fica disponível pra ser marcado
  // "Descartado" manualmente no kanban do CRM.
  if (isUnresolvedLid) {
    console.warn('[ai-agent-engine] telefone real não resolvido pra este contato (lid sem senderPn) — lead criado sem telefone de verdade.', { chatbotId, contactPhone })
  }

  const existingPatient = await findPatientByPhone(prisma, doctorId, normalizedPhone)
  // Resolvido UMA vez aqui e reusado por todas as ferramentas de agenda/
  // documento abaixo — nenhuma delas re-resolve paciente por conta própria,
  // então nenhuma corre o risco de agir sobre o cadastro de outra pessoa.
  let patientId: string | null = existingPatient?.id ?? null
  // Telefone usado pra ENCADEAR a conversa (histórico + CRM) — sempre o
  // mesmo valor canônico do cadastro do paciente (Patient.phone), nunca o
  // dígito bruto que a WhatsApp reportou nesta mensagem específica. A
  // WhatsApp pode reportar o mesmo contato com ou sem o 9º dígito em
  // mensagens diferentes; se cada AiAgentMessage guardasse o que veio bruto,
  // a mesma conversa real se partiria em duas (histórico perdido pro
  // agente, e o CRM mostra "Nenhuma mensagem encontrada" num dos cartões).
  let canonicalPhone = existingPatient?.phone ?? normalizePatientPhone(normalizedPhone)
  if (!existingPatient) {
    try {
      const created = await prisma.patient.create({
        data: {
          name: isUnresolvedLid ? 'Novo contato (WhatsApp)' : `Novo contato (${contactPhone})`,
          phone: canonicalPhone,
          doctorId,
          roomId: room?.id ?? null,
          status: 'PRE_CADASTRO',
          origin: 'CHATBOT',
          leadStatus: 'NOVO',
        },
      })
      patientId = created.id
    } catch (err) {
      console.error('[ai-agent-engine] falha ao criar lead no primeiro contato:', err)
    }
  }

  if (conversationId && patientId) {
    await linkConversationPatient(conversationId, patientId).catch(() => {})
  }

  let systemContent = chatbot.systemPrompt
  systemContent += `\n\n---\n# REGRAS DE CONVERSA (sempre válidas, independente do restante do prompt)\n- Leia o histórico da conversa antes de responder. Nunca repita uma pergunta, oferta ou instrução que o paciente já respondeu ou que já foi concluída (ex: depois de confirmar um agendamento, não volte a perguntar sobre horários).\n- Se a última mensagem do paciente for só um agradecimento ou encerramento (ex: "obrigado", "ok", "valeu"), responda de forma breve e natural, sem reabrir assuntos já resolvidos.\n- Mensagens curtas, no estilo de WhatsApp — evite blocos de texto longos. Uma pergunta por vez.\n- Pra entregar um documento (atestado, declaração etc), use só send_ready_document — nunca escreva ou invente o conteúdo de um documento você mesmo.`
  if (conversationId) {
    systemContent += `\n\n---\n# TRANSFERÊNCIA PARA A EQUIPE HUMANA\nUse a ferramenta transfer_to_human (e não responda mais nada depois dela) quando:\n- o paciente pedir para falar com uma pessoa, atendente, secretária ou com o médico;\n- o paciente fizer uma reclamação ou demonstrar insatisfação;\n- houver dúvida clínica, sintoma, pedido de orientação médica ou sobre resultado de exame (use target "doctor") — nunca dê orientação médica;\n- o assunto estiver fora do que você sabe ou pode fazer;\n- você não conseguir resolver o pedido depois de tentar.\nNesses casos não tente resolver sozinho nem invente informações.`
  }
  if (room) {
    systemContent += `\n\n---\n# HORÁRIO DE FUNCIONAMENTO DA CLÍNICA\n${describeRoomSchedule(room)}\nData e hora atual: ${getLocalDateInTz().toLocaleString('pt-BR')}\nUse a ferramenta check_availability antes de propor um horário, e create_appointment só depois que o paciente confirmar nome, data e horário. Nunca invente horários — use sempre o resultado da ferramenta.\nSe o paciente quer ALTERAR ou CANCELAR uma consulta que já existe, use reschedule_appointment ou cancel_appointment — nunca create_appointment de novo (isso cria uma segunda consulta em vez de mudar a primeira). Se não tiver certeza de qual consulta ele quer mexer, use list_my_appointments primeiro.`
  }

  const history = await prisma.aiAgentMessage.findMany({
    where: { chatbotId, contactPhone: canonicalPhone },
    orderBy: { createdAt: 'desc' },
    take: CONTEXT_MESSAGE_LIMIT,
  })
  const historyMessages: AiMessage[] = history.reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  await prisma.aiAgentMessage.create({ data: { chatbotId, contactPhone: canonicalPhone, role: 'user', content: messageText } })

  const messages: AiMessage[] = [{ role: 'system', content: systemContent }, ...historyMessages, { role: 'user', content: messageText }]
  // Ferramentas de documento ficam disponíveis mesmo sem sala vinculada —
  // não dependem de agenda. As de agenda continuam exigindo `room`.
  const tools = buildTools(!!room, !!conversationId)
  let handedOff = false

  // Se a IA falhar ou o loop de ferramentas esgotar sem produzir uma
  // resposta final, o paciente não pode simplesmente ficar sem resposta
  // nenhuma — manda um fallback em vez de deixar a conversa morta no ar.
  const FALLBACK_MESSAGE = 'Desculpe, tive um problema técnico aqui. Pode repetir sua mensagem, por favor?'
  let finalText: string | null = null
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await geminiChatCompletion(messages, tools, 0.4)

      if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({ role: 'assistant', content: result.content ?? '', tool_calls: result.tool_calls })
        for (const call of result.tool_calls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(call.function.arguments || '{}') } catch { /* ignore */ }

          const noPatientMsg = 'Não consegui localizar o cadastro do paciente ainda — peça pra ele mandar outra mensagem em instantes.'
          let toolResult = 'Ferramenta desconhecida.'

          if (call.function.name === 'transfer_to_human') {
            if (!conversationId) {
              toolResult = 'Transferência indisponível neste canal.'
            } else {
              const reason = typeof args.reason === 'string' ? args.reason : 'Transferência solicitada pelo Agente de IA'
              const target: HandoffTarget = args.target === 'doctor' ? 'doctor' : 'reception'
              handedOff = await handoffToHuman(conversationId, reason, target)
              toolResult = handedOff ? 'Conversa transferida para a equipe.' : 'A conversa já está com a equipe humana.'
              if (!handedOff) {
                // Humano já no controle — encerra sem responder.
                return
              }
            }
          } else if (call.function.name === 'list_ready_documents') {
            toolResult = patientId ? await listReadyDocumentsTool(doctorId, patientId) : noPatientMsg
          } else if (call.function.name === 'send_ready_document') {
            toolResult = !patientId
              ? noPatientMsg
              : (await sendReadyDocumentTool(doctorId, patientId, chatbotId, contactPhone, deliveryJid, args as SendDocArgs, conversationId)).message
          } else if (!room) {
            toolResult = 'Ferramenta indisponível — sem sala vinculada a este agente.'
          } else if (call.function.name === 'check_availability') {
            const slots = await checkAvailability(doctorId, room, String(args.date))
            toolResult = slots.length > 0
              ? `Horários disponíveis em ${args.date}: ${slots.join(', ')}`
              : `Nenhum horário disponível em ${args.date}. Sugira outra data ao paciente.`
          } else if (call.function.name === 'create_appointment') {
            const outcome = await createAppointmentTool(doctorId, room, patientId, canonicalPhone, args as unknown as CreateAppointmentArgs)
            toolResult = outcome.message
          } else if (call.function.name === 'list_my_appointments') {
            toolResult = patientId ? await listAppointmentsTool(doctorId, patientId) : noPatientMsg
          } else if (call.function.name === 'reschedule_appointment') {
            toolResult = !patientId
              ? noPatientMsg
              : (await rescheduleAppointmentTool(doctorId, room, patientId, args as unknown as RescheduleArgs)).message
          } else if (call.function.name === 'cancel_appointment') {
            toolResult = !patientId
              ? noPatientMsg
              : (await cancelAppointmentTool(doctorId, patientId, args as unknown as CancelArgs)).message
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult })
        }
        if (handedOff) break
        continue
      }

      finalText = result.content || null
      break
    }
  } catch (err) {
    console.error('[ai-agent-engine] erro da IA:', err)
    finalText = FALLBACK_MESSAGE
  }

  if (handedOff) {
    // Mensagem de transição fixa — a IA para de responder a partir daqui.
    finalText = HANDOFF_TRANSITION_MESSAGE
  } else if (!finalText) {
    console.warn('[ai-agent-engine] Loop de ferramentas esgotou sem resposta final — enviando fallback.', { chatbotId, contactPhone: normalizedPhone })
    finalText = FALLBACK_MESSAGE
  }

  await prisma.aiAgentMessage.create({ data: { chatbotId, contactPhone: canonicalPhone, role: 'assistant', content: finalText } })

  const target = await resolveChatbotLightSendTarget(chatbotId)
  if (!target) return

  if (chatbot.responseDelaySeconds > 0 && !handedOff) {
    await new Promise(resolve => setTimeout(resolve, chatbot.responseDelaySeconds * 1000))
  }

  // Corrida: um humano pode ter assumido enquanto a IA pensava — aí a
  // resposta da IA é descartada (a de transição do handoff sempre vai).
  if (!handedOff && conversationId && !(await isConversationWithBot(conversationId))) return

  const phoneCheck = await checkPhoneOnWhatsApp(target.instanceKey, contactPhone).catch(() => null)
  const sendJid = phoneCheck?.jid ?? normalizeToWhatsAppJid(deliveryJid)
  await sendRoomWhatsAppMessage(target.instanceKey, sendJid, finalText, { conversationId })

  await prisma.lightMessageLog.create({
    data: {
      doctorId,
      chatbotId,
      phone: canonicalPhone,
      content: finalText,
      module: 'ai_agent',
      status: 'SENT',
      sentAt: new Date(),
    },
  }).catch(() => {})
}

export interface AgentPromptFields {
  agentName?: string | null
  companyName?: string | null
  businessType?: string | null
  calendarUsage?: string | null
  agentProfession?: string | null
  personality?: string | null
  extraInfo?: string | null
}

export async function generateSystemPrompt(fields: AgentPromptFields): Promise<string> {
  const metaPrompt = `Você é um redator especialista em criar prompts de sistema pra agentes de atendimento via WhatsApp. Escreva um prompt de sistema completo, em português, organizado em seções com cabeçalhos markdown (ex: # [IDENTIDADE], # [PERSONALIDADE], # [REGRAS], # [COMUNICAÇÃO]), na primeira pessoa (o agente falando de si mesmo). Não inclua explicações fora do prompt — devolva só o texto do prompt final.

Na seção de regras/comunicação, sempre inclua estas diretrizes de qualidade de conversa (adapte a redação ao tom do agente, mas mantenha o sentido):
- Mensagens curtas e diretas, no estilo de WhatsApp — nunca blocos de texto longos.
- Uma pergunta por vez; espere a resposta do paciente antes de seguir para a próxima informação.
- Nunca repetir uma pergunta ou oferta que o paciente já respondeu ou que já foi concluída na conversa (ex: depois de confirmar um agendamento, não voltar a perguntar sobre horários disponíveis).
- Nunca inventar horários disponíveis — sempre consultar a ferramenta de disponibilidade antes de sugerir um horário.
- Ao encerrar o assunto (ex: paciente agradece), responder de forma breve e natural, sem reabrir tópicos já resolvidos.`

  const userPrompt = [
    fields.agentName ? `Nome do agente: ${fields.agentName}` : null,
    fields.companyName ? `Empresa: ${fields.companyName}` : null,
    fields.businessType ? `Ramo do negócio: ${fields.businessType}` : null,
    fields.agentProfession ? `Profissão do agente: ${fields.agentProfession}` : null,
    fields.calendarUsage ? `Como usar o calendário/agendamentos: ${fields.calendarUsage}` : null,
    fields.personality ? `Personalidade e tom desejados: ${fields.personality}` : null,
    fields.extraInfo ? `Informações complementares: ${fields.extraInfo}` : null,
  ].filter(Boolean).join('\n')

  const result = await geminiChatCompletion([
    { role: 'system', content: metaPrompt },
    { role: 'user', content: userPrompt },
  ])

  return result.content ?? ''
}
