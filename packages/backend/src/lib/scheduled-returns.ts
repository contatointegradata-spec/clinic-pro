import { prisma } from './prisma'
import { triggerLightAutomatedMessage } from './chatbot-light-engine'
import { resolveChatbotLightSendTarget } from './room-whatsapp'

const DAY_MS = 24 * 60 * 60 * 1000

// Status possíveis de um ScheduledReturn.
export const RETURN_STATUSES = ['PENDENTE', 'AVISADO', 'AGENDADO', 'CONCLUIDO', 'DESCARTADO'] as const

// Retornos são "só data": guardamos meio-dia UTC do dia local (America/Sao_Paulo)
// do atendimento + N dias — mesmo formato das datas escolhidas na tela.
function dueDateFrom(date: Date, days: number): Date {
  const local = date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD
  const base = new Date(`${local}T12:00:00.000Z`)
  return new Date(base.getTime() + days * DAY_MS)
}

// Ao concluir um atendimento: se o tipo (Appointment.type = nome do
// AppointmentType) tem intervalo de retorno, agenda o retorno. Idempotente
// por sourceAppointmentId (concluir 2x não duplica).
export async function onAppointmentCompleted(appt: {
  id: string
  patientId: string
  doctorId: string
  date: Date
  type: string | null
}): Promise<void> {
  if (!appt.type) return
  const appType = await prisma.appointmentType.findFirst({
    where: { name: appt.type, doctorId: appt.doctorId, returnIntervalDays: { not: null } },
    select: { id: true, name: true, returnIntervalDays: true },
  })

  // Um retorno pendente deste mesmo procedimento foi cumprido por este atendimento.
  await prisma.scheduledReturn.updateMany({
    where: {
      patientId: appt.patientId,
      status: { in: ['PENDENTE', 'AVISADO', 'AGENDADO'] },
      procedureName: appt.type,
      dueDate: { lte: new Date(appt.date.getTime() + 30 * DAY_MS) },
      NOT: { sourceAppointmentId: appt.id },
    },
    data: { status: 'CONCLUIDO' },
  })

  if (!appType?.returnIntervalDays) return
  const dueDate = dueDateFrom(appt.date, appType.returnIntervalDays)
  await prisma.scheduledReturn.upsert({
    where: { sourceAppointmentId: appt.id },
    update: {},
    create: {
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      appointmentTypeId: appType.id,
      procedureName: appType.name,
      dueDate,
      sourceAppointmentId: appt.id,
    },
  })
}

// Ao criar um agendamento: retornos em aberto do mesmo procedimento passam a
// AGENDADO (a paciente já marcou — não precisa mais ser lembrada).
export async function onAppointmentScheduled(appt: { patientId: string; type: string | null }): Promise<void> {
  if (!appt.type) return
  await prisma.scheduledReturn.updateMany({
    where: { patientId: appt.patientId, procedureName: appt.type, status: { in: ['PENDENTE', 'AVISADO'] } },
    data: { status: 'AGENDADO' },
  })
}

// Chamado pelo scheduler de lembretes: retornos que venceram (até 30 dias
// atrás — não dispara um lote antigo de uma vez) recebem a mensagem
// automática PROCEDURE_RETURN_DUE, se a clínica tiver essa automação ativa.
// Sem automação, o retorno continua PENDENTE na tela de Retornos para a
// equipe avisar manualmente.
export async function processDueReturns(now = Date.now()): Promise<void> {
  const due = await prisma.scheduledReturn.findMany({
    where: {
      status: 'PENDENTE',
      notifiedAt: null,
      dueDate: { lte: new Date(now), gte: new Date(now - 30 * DAY_MS) },
    },
    include: {
      patient: { select: { name: true, phone: true, cpf: true, status: true, anonymizedAt: true } },
    },
    take: 200,
  })
  if (due.length === 0) return

  const doctorIds = [...new Set(due.map(r => r.doctorId))]
  const configs = await prisma.lightIntegrationConfig.findMany({
    where: { doctorId: { in: doctorIds }, triggerEvent: 'PROCEDURE_RETURN_DUE', enabled: true, chatbotId: { not: null } },
    select: { doctorId: true, chatbotId: true, template: { select: { active: true } } },
  })
  // Só conta como "avisado" se a mensagem tem por onde sair agora (WhatsApp
  // da sala conectado). Caso contrário o retorno fica PENDENTE para a equipe.
  const enabledDoctors = new Set<string>()
  for (const c of configs) {
    if (!c.template?.active || !c.chatbotId || enabledDoctors.has(c.doctorId)) continue
    if (await resolveChatbotLightSendTarget(c.chatbotId)) enabledDoctors.add(c.doctorId)
  }
  if (enabledDoctors.size === 0) return

  const doctors = await prisma.user.findMany({
    where: { id: { in: [...enabledDoctors] } },
    select: { id: true, name: true, specialty: true, crm: true },
  })
  const doctorById = new Map(doctors.map(d => [d.id, d]))

  for (const ret of due) {
    if (!enabledDoctors.has(ret.doctorId)) continue
    if (ret.patient.anonymizedAt || ret.patient.status !== 'ATIVO' || !ret.patient.phone) continue
    const doctor = doctorById.get(ret.doctorId)
    // Marca antes de enviar: se o envio falhar, não reenvia em loop a cada ciclo.
    await prisma.scheduledReturn.update({
      where: { id: ret.id },
      data: { status: 'AVISADO', notifiedAt: new Date() },
    })
    await triggerLightAutomatedMessage(ret.doctorId, 'PROCEDURE_RETURN_DUE', {
      patientName: ret.patient.name,
      patientPhone: ret.patient.phone,
      patientCpf: ret.patient.cpf ?? undefined,
      appointmentType: ret.procedureName,
      doctorName: doctor?.name,
      doctorSpecialty: doctor?.specialty ?? undefined,
      doctorCrm: doctor?.crm ?? undefined,
    })
  }
}
