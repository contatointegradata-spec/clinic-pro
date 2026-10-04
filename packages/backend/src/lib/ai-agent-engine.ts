import { prisma } from './prisma'
import { geminiChatCompletion } from './gemini-client'
import { AiMessage, AiTool } from './ai-client-types'
import { resolveChatbotLightSendTarget, sendRoomWhatsAppMessage, normalizeToWhatsAppJid, checkPhoneOnWhatsApp } from './room-whatsapp'
import { checkLunchOverlap } from '../routes/appointments'
import { getLocalDateInTz } from './chatbot-light-guided-engine'
import { findPatientByPhone, normalizePatientPhone } from './phone'

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
  phone: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  notes?: string
}

async function createAppointmentTool(
  doctorId: string,
  room: RoomForSchedule,
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

  const normalizedPhone = args.phone.replace(/\D/g, '')

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
      // placeholder. Agendar é a conversão de verdade: atualiza o nome real
      // e avança o card pro "Convertido" no kanban do CRM automaticamente.
      let patient = await findPatientByPhone(tx, doctorId, normalizedPhone)
      if (!patient) {
        patient = await tx.patient.create({
          data: {
            name: args.patientName,
            phone: normalizePatientPhone(normalizedPhone),
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

      await tx.appointment.create({
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

      return { success: true as const, message: `Consulta marcada com sucesso para ${args.date} às ${args.time}. Confirme isso pro paciente de forma natural.` }
    }, { isolationLevel: 'Serializable' })

    return result
  } catch (err) {
    console.error('[ai-agent-engine] createAppointmentTool transaction error:', err)
    return { success: false, message: 'Não consegui confirmar o agendamento agora — peça pro paciente tentar de novo em instantes.' }
  }
}

function buildTools(): AiTool[] {
  return [
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
        description: 'Cria de fato o agendamento da consulta depois que o paciente confirmou nome, data e horário.',
        parameters: {
          type: 'object',
          properties: {
            patientName: { type: 'string', description: 'Nome completo do paciente' },
            phone: { type: 'string', description: 'Telefone do paciente (com DDD)' },
            date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
            time: { type: 'string', description: 'Horário no formato HH:MM' },
            notes: { type: 'string', description: 'Observações adicionais (opcional)' },
          },
          required: ['patientName', 'phone', 'date', 'time'],
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
}): Promise<void> {
  const { chatbotId, doctorId, contactPhone, deliveryJid, messageText } = params
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
  if (!existingPatient) {
    await prisma.patient.create({
      data: {
        name: isUnresolvedLid ? 'Novo contato (WhatsApp)' : `Novo contato (${contactPhone})`,
        phone: normalizePatientPhone(normalizedPhone),
        doctorId,
        roomId: room?.id ?? null,
        status: 'PRE_CADASTRO',
        origin: 'CHATBOT',
        leadStatus: 'NOVO',
      },
    }).catch(err => console.error('[ai-agent-engine] falha ao criar lead no primeiro contato:', err))
  }

  let systemContent = chatbot.systemPrompt
  systemContent += `\n\n---\n# REGRAS DE CONVERSA (sempre válidas, independente do restante do prompt)\n- Leia o histórico da conversa antes de responder. Nunca repita uma pergunta, oferta ou instrução que o paciente já respondeu ou que já foi concluída (ex: depois de confirmar um agendamento, não volte a perguntar sobre horários).\n- Se a última mensagem do paciente for só um agradecimento ou encerramento (ex: "obrigado", "ok", "valeu"), responda de forma breve e natural, sem reabrir assuntos já resolvidos.\n- Mensagens curtas, no estilo de WhatsApp — evite blocos de texto longos. Uma pergunta por vez.`
  if (room) {
    systemContent += `\n\n---\n# HORÁRIO DE FUNCIONAMENTO DA CLÍNICA\n${describeRoomSchedule(room)}\nData e hora atual: ${getLocalDateInTz().toLocaleString('pt-BR')}\nUse a ferramenta check_availability antes de propor um horário, e create_appointment só depois que o paciente confirmar nome, data e horário. Nunca invente horários — use sempre o resultado da ferramenta.`
  }

  const history = await prisma.aiAgentMessage.findMany({
    where: { chatbotId, contactPhone: normalizedPhone },
    orderBy: { createdAt: 'desc' },
    take: CONTEXT_MESSAGE_LIMIT,
  })
  const historyMessages: AiMessage[] = history.reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  await prisma.aiAgentMessage.create({ data: { chatbotId, contactPhone: normalizedPhone, role: 'user', content: messageText } })

  const messages: AiMessage[] = [{ role: 'system', content: systemContent }, ...historyMessages, { role: 'user', content: messageText }]
  const tools = room ? buildTools() : undefined

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

          let toolResult = 'Ferramenta indisponível — sem sala vinculada a este agente.'
          if (room) {
            if (call.function.name === 'check_availability') {
              const slots = await checkAvailability(doctorId, room, String(args.date))
              toolResult = slots.length > 0
                ? `Horários disponíveis em ${args.date}: ${slots.join(', ')}`
                : `Nenhum horário disponível em ${args.date}. Sugira outra data ao paciente.`
            } else if (call.function.name === 'create_appointment') {
              const outcome = await createAppointmentTool(doctorId, room, args as unknown as CreateAppointmentArgs)
              toolResult = outcome.message
            }
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult })
        }
        continue
      }

      finalText = result.content || null
      break
    }
  } catch (err) {
    console.error('[ai-agent-engine] erro da IA:', err)
    finalText = FALLBACK_MESSAGE
  }

  if (!finalText) {
    console.warn('[ai-agent-engine] Loop de ferramentas esgotou sem resposta final — enviando fallback.', { chatbotId, contactPhone: normalizedPhone })
    finalText = FALLBACK_MESSAGE
  }

  await prisma.aiAgentMessage.create({ data: { chatbotId, contactPhone: normalizedPhone, role: 'assistant', content: finalText } })

  const target = await resolveChatbotLightSendTarget(chatbotId)
  if (!target) return

  if (chatbot.responseDelaySeconds > 0) {
    await new Promise(resolve => setTimeout(resolve, chatbot.responseDelaySeconds * 1000))
  }

  const phoneCheck = await checkPhoneOnWhatsApp(target.instanceKey, contactPhone).catch(() => null)
  const sendJid = phoneCheck?.jid ?? normalizeToWhatsAppJid(deliveryJid)
  await sendRoomWhatsAppMessage(target.instanceKey, sendJid, finalText)

  await prisma.lightMessageLog.create({
    data: {
      doctorId,
      chatbotId,
      phone: normalizedPhone,
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
