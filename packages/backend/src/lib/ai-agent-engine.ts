import type { Patient, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { geminiChatCompletion } from './gemini-client'
import { AiMessage, AiTool } from './ai-client-types'
import { resolveChatbotLightSendTarget, sendRoomWhatsAppMessage, normalizeToWhatsAppJid, checkPhoneOnWhatsApp } from './room-whatsapp'
import { checkLunchOverlap } from '../routes/appointments'
import { findPatientsByPhone, normalizePatientPhone, toLidJid } from './phone'
import { isGenericPatientName } from './patient-identity'
import { notifyAppointmentEvent } from './notifications'
import { handoffToHuman, isConversationWithBot, linkConversationPatient, HANDOFF_TRANSITION_MESSAGE, HandoffTarget, addSystemNote } from './attendance'
import { lookupPhoneByLid } from './whatsapp-identity'
import { logAudit } from './secretaryAccess'

// 5 (era 3): com as validações de data a ferramenta pode devolver um erro
// corrigível ("09/10/2026 é sexta-feira") e o modelo precisa de mais uma volta.
const MAX_TOOL_ITERATIONS = 5
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

// ─── Datas no fuso da clínica ───────────────────────────────────────────────
// Toda a agenda do Agente de IA é calculada em America/Sao_Paulo (UTC-3 fixo
// desde o fim do horário de verão em 2019 — mesmo pressuposto de
// parseLocalDateToUtcDate e de lib/chatbot-light-guided-engine.ts). Nunca use
// o timezone do servidor (normalmente UTC) pra decidir "hoje": às 22h de
// Brasília o servidor já está no dia seguinte.
//
// Bug real (07/10/2026): o prompt só tinha "07/10/2026 22:10:00" sem dia da
// semana; o modelo (Gemini) calculou "sexta" por conta própria, ofereceu
// "sexta 09/10" e depois criou a consulta em 2025-10-10 (ano do treino dele,
// 10/10/2025 caiu numa sexta). As ferramentas aceitavam qualquer data, inclusive
// no passado. Agora: calendário explícito no prompt + validação de data
// (passado, horizonte, dia da semana, expediente) em todas as ferramentas.
const CLINIC_TZ = 'America/Sao_Paulo'
// Antecedência mínima pra marcar/remarcar (evita oferecer "daqui a 5 minutos").
const MIN_LEAD_MINUTES = 30
// Horizonte máximo de agendamento pelo Agente de IA.
const MAX_BOOKING_DAYS_AHEAD = 180
// Quantos dias aparecem na tabela-calendário do prompt.
const PROMPT_CALENDAR_DAYS = 21

const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function parseLocalDateToUtcDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const localStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  return new Date(`${localStr}-03:00`)
}

/** Partes de data/hora "agora" (ou de `at`) no fuso da clínica. */
function clinicNowParts(at: Date = new Date()): { ymd: string; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const hh = map.hour === '24' ? '00' : map.hour
  return { ymd: `${map.year}-${map.month}-${map.day}`, hh, mm: map.minute }
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function addDaysYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * 86_400_000).toISOString().slice(0, 10)
}

function diffDaysYmd(from: string, to: string): number {
  return Math.round((ymdToUtcMs(to) - ymdToUtcMs(from)) / 86_400_000)
}

/** 0=domingo..6=sábado (dia de calendário, independente de fuso). */
function jsWeekdayFromYmd(ymd: string): number {
  return new Date(ymdToUtcMs(ymd)).getUTCDay()
}

/** "sexta-feira, 09/10/2026" */
function formatDateLong(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${WEEKDAY_LONG[jsWeekdayFromYmd(ymd)]}, ${d}/${m}/${y}`
}

/** "sexta-feira, 09/10/2026 às 14:00" a partir de um instante. */
function formatInstantLong(date: Date): string {
  const { ymd, hh, mm } = clinicNowParts(date)
  return `${formatDateLong(ymd)} às ${hh}:${mm}`
}

/** Valida e normaliza "YYYY-MM-DD" (data de calendário real). */
function parseYmd(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return s
}

/** Aceita "14:00", "9:30", "14h00", "14h" → "HH:MM". */
function parseHm(raw: unknown): { h: number; m: number; str: string } | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const match = /^(\d{1,2})(?:[:h](\d{2})?)?$/.exec(s)
  if (!match) return null
  const h = Number(match[1])
  const m = match[2] ? Number(match[2]) : 0
  if (h > 23 || m > 59) return null
  return { h, m, str: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** "sexta", "Sexta-feira", "sex", "sábado" → 0..6; null se não reconhecer. */
function parseWeekdayName(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const s = stripAccents(raw.trim().toLowerCase()).replace(/-?feira/, '').trim()
  const prefixes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
  const idx = prefixes.findIndex(p => s.startsWith(p))
  return idx >= 0 ? idx : null
}

/** Próxima data (a partir de hoje, inclusive) que cai no dia da semana pedido. */
function nextWeekdayOnOrAfter(fromYmd: string, jsWeekday: number): string {
  const delta = (jsWeekday - jsWeekdayFromYmd(fromYmd) + 7) % 7
  return addDaysYmd(fromYmd, delta)
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (m || 0)
}

type ValidatedDate = { ok: true; ymd: string; y: number; m: number; d: number; label: string; schedule: { start: string; end: string } }
type DateValidation = ValidatedDate | { ok: false; message: string }

/**
 * Validação comum de data pra check_availability / create_appointment /
 * reschedule_appointment. Sempre devolve mensagens com a data por extenso e o
 * "hoje" de referência, pro modelo conseguir se corrigir sozinho.
 */
function validateBookingDate(room: RoomForSchedule, rawDate: unknown, rawWeekday?: unknown): DateValidation {
  const today = clinicNowParts().ymd
  const todayLabel = formatDateLong(today)
  const ymd = parseYmd(rawDate)
  if (!ymd) {
    return { ok: false, message: `Data "${String(rawDate ?? '')}" inválida — use o formato YYYY-MM-DD com o ano correto, tirado da tabela de calendário (hoje é ${todayLabel}).` }
  }
  const label = formatDateLong(ymd)

  const requestedWeekday = rawWeekday != null && rawWeekday !== '' ? parseWeekdayName(rawWeekday) : null
  if (requestedWeekday != null && requestedWeekday !== jsWeekdayFromYmd(ymd)) {
    const correct = nextWeekdayOnOrAfter(today, requestedWeekday)
    return {
      ok: false,
      message: `Data não confere: ${ymd.split('-').reverse().join('/')} é ${WEEKDAY_LONG[jsWeekdayFromYmd(ymd)]}, não ${WEEKDAY_LONG[requestedWeekday]}. A próxima ${WEEKDAY_LONG[requestedWeekday]} é ${formatDateLong(correct)} (hoje é ${todayLabel}). Use a data certa da tabela de calendário.`,
    }
  }

  const ahead = diffDaysYmd(today, ymd)
  if (ahead < 0) {
    const sameWeekday = nextWeekdayOnOrAfter(today, jsWeekdayFromYmd(ymd))
    return {
      ok: false,
      message: `A data ${label} já passou — hoje é ${todayLabel} (ano ${today.slice(0, 4)}). Nunca use datas passadas. Se o paciente falou "${WEEKDAY_LONG[jsWeekdayFromYmd(ymd)]}", a próxima é ${formatDateLong(sameWeekday)}; confira na tabela de calendário.`,
    }
  }
  if (ahead > MAX_BOOKING_DAYS_AHEAD) {
    return { ok: false, message: `A data ${label} está a mais de ${MAX_BOOKING_DAYS_AHEAD} dias de hoje (${todayLabel}) — confira o ano/mês com o paciente ou sugira uma data mais próxima.` }
  }

  const schedule = getDayScheduleForRoom(room, dayOfWeekFromDateStr(ymd))
  if (!schedule) {
    return { ok: false, message: `Não há atendimento em ${label} (${WEEKDAY_LONG[jsWeekdayFromYmd(ymd)]} fora do expediente). Sugira ao paciente outro dia dentro do horário de funcionamento.` }
  }
  const [y, m, d] = ymd.split('-').map(Number)
  return { ok: true, ymd, y, m, d, label, schedule }
}

/** Valida o horário dentro do expediente/intervalo e com antecedência mínima. */
function validateBookingTime(
  room: RoomForSchedule,
  date: ValidatedDate,
  rawTime: unknown,
  duration: number,
): { ok: true; slotStart: Date; slotEnd: Date; time: string } | { ok: false; message: string } {
  const t = parseHm(rawTime)
  if (!t) return { ok: false, message: `Horário "${String(rawTime ?? '')}" inválido — use HH:MM (ex: 14:00), tirado do resultado de check_availability.` }

  const startMin = t.h * 60 + t.m
  const endMin = startMin + duration
  if (startMin < hmToMinutes(date.schedule.start) || endMin > hmToMinutes(date.schedule.end)) {
    return { ok: false, message: `${t.str} está fora do expediente de ${date.label} (${date.schedule.start} às ${date.schedule.end}). Use check_availability pra ver os horários livres.` }
  }
  if (room.breakStart && room.breakEnd && startMin < hmToMinutes(room.breakEnd) && endMin > hmToMinutes(room.breakStart)) {
    return { ok: false, message: `${t.str} cai no intervalo (${room.breakStart} às ${room.breakEnd}). Sugira outro horário.` }
  }

  const slotStart = parseLocalDateToUtcDate(date.y, date.m, date.d, t.h, t.m)
  if (slotStart.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) {
    const now = clinicNowParts()
    return { ok: false, message: `${date.label} às ${t.str} já passou ou está em cima da hora — agora são ${now.hh}:${now.mm} de ${formatDateLong(now.ymd)}. Ofereça um horário futuro (use check_availability).` }
  }
  return { ok: true, slotStart, slotEnd: new Date(slotStart.getTime() + duration * 60_000), time: t.str }
}

/** Tabela dos próximos dias pro prompt, com dia da semana e expediente. */
function buildCalendarTable(room: RoomForSchedule | null): string {
  const today = clinicNowParts().ymd
  const lines: string[] = []
  for (let i = 0; i < PROMPT_CALENDAR_DAYS; i++) {
    const ymd = addDaysYmd(today, i)
    const [y, m, d] = ymd.split('-')
    const tag = i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : ''
    let hours = ''
    if (room) {
      const sched = getDayScheduleForRoom(room, dayOfWeekFromDateStr(ymd))
      hours = sched ? ` — atendimento ${sched.start} às ${sched.end}` : ' — sem atendimento'
    }
    lines.push(`- ${WEEKDAY_SHORT[jsWeekdayFromYmd(ymd)]} ${d}/${m}/${y}${tag} = ${ymd}${hours}`)
  }
  return lines.join('\n')
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

async function getDoctorLunchMinutes(doctorId: string): Promise<[number, number] | null> {
  const doctor = await prisma.user.findUnique({ where: { id: doctorId }, select: { lunchStart: true, lunchEnd: true } })
  if (!doctor?.lunchStart || !doctor?.lunchEnd) return null
  return [hmToMinutes(doctor.lunchStart), hmToMinutes(doctor.lunchEnd)]
}

// Espera uma data já validada (validateBookingDate). Devolve só horários
// livres, dentro do expediente, fora do intervalo/almoço e no futuro (com a
// antecedência mínima) — então à noite, "hoje" volta vazio.
async function checkAvailability(doctorId: string, room: RoomForSchedule, dateStr: string): Promise<string[]> {
  const dayNum = dayOfWeekFromDateStr(dateStr)
  const schedule = getDayScheduleForRoom(room, dayNum)
  if (!schedule) return []

  const [y, m, d] = dateStr.split('-').map(Number)
  const duration = room.slotDurationMinutes || 30
  const dayStartMin = hmToMinutes(schedule.start)
  const dayEndMin = hmToMinutes(schedule.end)
  const breakMin = room.breakStart && room.breakEnd ? [hmToMinutes(room.breakStart), hmToMinutes(room.breakEnd)] : null

  const [{ appointments, blocks }, lunchMin] = await Promise.all([getConflicts(doctorId, dateStr), getDoctorLunchMinutes(doctorId)])
  // Horários de hoje que já passaram (ou estão em cima da hora) nunca são oferecidos.
  const earliest = new Date(Date.now() + MIN_LEAD_MINUTES * 60_000)
  const available: string[] = []

  for (let min = dayStartMin; min + duration <= dayEndMin; min += duration) {
    const slotStart = parseLocalDateToUtcDate(y, m, d, Math.floor(min / 60), min % 60)
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    const inBreak = breakMin && min < breakMin[1] && min + duration > breakMin[0]
    const inLunch = lunchMin && min < lunchMin[1] && min + duration > lunchMin[0]
    if (!inBreak && !inLunch && slotStart >= earliest && isSlotFree(slotStart, slotEnd, appointments, blocks)) {
      available.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
    }
  }
  return available
}

/** Quando a data pedida não tem vaga, sugere os próximos dias com horário livre. */
async function suggestNextAvailableDays(doctorId: string, room: RoomForSchedule, afterYmd: string, max = 3): Promise<string[]> {
  const today = clinicNowParts().ymd
  const start = diffDaysYmd(today, afterYmd) < 0 ? today : addDaysYmd(afterYmd, 1)
  const out: string[] = []
  for (let i = 0; i < 21 && out.length < max; i++) {
    const ymd = addDaysYmd(start, i)
    if (diffDaysYmd(today, ymd) > MAX_BOOKING_DAYS_AHEAD) break
    if (!getDayScheduleForRoom(room, dayOfWeekFromDateStr(ymd))) continue
    const slots = await checkAvailability(doctorId, room, ymd)
    if (slots.length > 0) out.push(`${formatDateLong(ymd)} (${ymd}): ${slots.slice(0, 6).join(', ')}${slots.length > 6 ? '…' : ''}`)
  }
  return out
}

async function checkAvailabilityTool(doctorId: string, room: RoomForSchedule, args: { date?: unknown; weekday?: unknown }): Promise<string> {
  const v = validateBookingDate(room, args.date, args.weekday)
  if (!v.ok) return v.message
  const slots = await checkAvailability(doctorId, room, v.ymd)
  if (slots.length > 0) {
    return `Horários disponíveis em ${v.label} (${v.ymd}): ${slots.join(', ')}. Ao oferecer, diga o dia da semana e a data assim: "${v.label.replace(/\/\d{4}$/, '')}".`
  }
  const isToday = v.ymd === clinicNowParts().ymd
  const next = await suggestNextAvailableDays(doctorId, room, v.ymd)
  return `Nenhum horário disponível em ${v.label}${isToday ? ' (os horários de hoje já passaram ou estão ocupados)' : ''}.` +
    (next.length ? ` Próximos dias com vaga:\n${next.map(n => `- ${n}`).join('\n')}` : ' Sugira outra data ao paciente.')
}

// ─── Paciente(s) do telefone (família no mesmo número) ─────────────────────
// Em clínica é comum o MESMO telefone ser de várias pessoas (mãe que marca
// pros filhos). Por isso as ferramentas de agenda trabalham com o "grupo" de
// pacientes daquele telefone (householdIds) e escolhem o paciente certo pelo
// nome dito na conversa — nunca renomeiam um paciente já cadastrado (ATIVO)
// com o nome que apareceu no chat, e nunca fundem pessoas diferentes.

interface PatientContext {
  // Paciente principal da conversa (vínculo do Atendimento ou lead do telefone).
  primaryPatientId: string | null
  // Todos os pacientes deste telefone (+ o vinculado à conversa).
  householdIds: string[]
  // Telefone gravado em pacientes novos. '' quando o contato chegou só com
  // LID (@lid) sem telefone real resolvido — nunca gravamos LID como telefone;
  // nesse caso o LID vai em whatsappLid (lib/patient-identity.ts troca pelo
  // telefone real quando o vínculo LID↔telefone for aprendido).
  phoneForNewPatient: string
  whatsappLid: string | null
}

const NAME_STOPWORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])

/** Nomes placeholder de lead ("Novo contato (...)", "Contato WhatsApp", vazio, LID) — mesma regra do Agente de identidade. */
function isGenericLeadName(name: string | null | undefined): boolean {
  return isGenericPatientName(name)
}

function normalizeName(n: string): string {
  return stripAccents(n.toLowerCase()).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function nameTokens(n: string): string[] {
  return normalizeName(n).split(' ').filter(t => t && !NAME_STOPWORDS.has(t))
}

/** 3 = mesmo nome; 2 = um é abreviação do outro (mesmo 1º nome, tokens contidos); 0 = outra pessoa. */
function nameMatchScore(stored: string, said: string): number {
  const a = normalizeName(stored)
  const b = normalizeName(said)
  if (!a || !b) return 0
  if (a === b) return 3
  const ta = nameTokens(stored)
  const tb = nameTokens(said)
  if (!ta.length || !tb.length || ta[0] !== tb[0]) return 0
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return short.every(t => long.includes(t)) ? 2 : 0
}

function patientStatusRank(status: string): number {
  return ({ ATIVO: 0, INCOMPLETO: 1, PRE_CADASTRO: 2, INATIVO: 3 } as Record<string, number>)[status] ?? 4
}

type BookingPatientResult = { kind: 'ok'; patient: Patient } | { kind: 'ask'; message: string }

async function resolveBookingPatient(
  tx: Prisma.TransactionClient,
  doctorId: string,
  room: RoomForSchedule,
  ctx: PatientContext,
  rawName: unknown,
  isNewPatient: boolean,
): Promise<BookingPatientResult> {
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 2 || isGenericLeadName(name)) {
    return { kind: 'ask', message: 'Falta o nome do paciente — pergunte o nome completo de quem vai ser atendido antes de agendar.' }
  }

  const candidates = ctx.householdIds.length
    ? await tx.patient.findMany({ where: { id: { in: ctx.householdIds } }, orderBy: { createdAt: 'asc' } })
    : []
  const real = candidates.filter(p => !isGenericLeadName(p.name))

  const scored = real
    .map(p => ({ p, score: nameMatchScore(p.name, name) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || patientStatusRank(a.p.status) - patientStatusRank(b.p.status) || a.p.createdAt.getTime() - b.p.createdAt.getTime())

  if (scored.length > 0) {
    const best = scored[0]
    const tie = scored.filter(s => s.score === best.score && normalizeName(s.p.name) !== normalizeName(best.p.name))
    if (best.score < 3 && tie.length > 0) {
      return { kind: 'ask', message: `Há mais de uma pessoa com esse nome neste telefone: ${[best, ...tie].map(s => s.p.name).join('; ')}. Pergunte ao paciente qual delas e chame de novo com o nome completo.` }
    }
    let patient = best.p
    // Completa o nome só de pré-cadastro e só se o dito for mais completo
    // ("Maria" → "Maria Souza"). Cadastro ATIVO/INCOMPLETO nunca é renomeado.
    if (patient.status === 'PRE_CADASTRO' && nameTokens(name).length > nameTokens(patient.name).length) {
      patient = await tx.patient.update({ where: { id: patient.id }, data: { name } })
    }
    return { kind: 'ok', patient }
  }

  if (real.length > 0 && !isNewPatient) {
    return {
      kind: 'ask',
      message: `Este telefone já está cadastrado para: ${real.map(p => p.name).join('; ')}. "${name}" é outra pessoa (ex.: filho(a), familiar)? Confirme com o paciente: se for outra pessoa, chame create_appointment de novo com isNewPatient=true; se for a mesma pessoa, use exatamente o nome do cadastro.`,
    }
  }

  // Lead placeholder (criado no 1º contato) vira o paciente de verdade.
  const generic =
    candidates.find(p => p.id === ctx.primaryPatientId && isGenericLeadName(p.name) && p.status === 'PRE_CADASTRO') ??
    candidates.find(p => isGenericLeadName(p.name) && p.status === 'PRE_CADASTRO')
  if (generic) {
    const patient = await tx.patient.update({ where: { id: generic.id }, data: { name } })
    return { kind: 'ok', patient }
  }

  const patient = await tx.patient.create({
    data: {
      name,
      phone: ctx.phoneForNewPatient,
      ...(ctx.phoneForNewPatient ? {} : { whatsappLid: ctx.whatsappLid }),
      doctorId,
      roomId: room.id,
      status: 'PRE_CADASTRO',
      origin: 'CHATBOT',
      leadStatus: 'CONVERTIDO',
    },
  })
  return { kind: 'ok', patient }
}

interface CreateAppointmentArgs {
  patientName: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  weekday?: string
  isNewPatient?: boolean
  notes?: string
}

async function createAppointmentTool(
  doctorId: string,
  room: RoomForSchedule,
  ctx: PatientContext,
  args: CreateAppointmentArgs,
  conversationId: string | null,
): Promise<{ success: boolean; message: string }> {
  const dateCheck = validateBookingDate(room, args.date, args.weekday)
  if (!dateCheck.ok) return { success: false, message: `${dateCheck.message} A consulta NÃO foi criada.` }
  const duration = room.slotDurationMinutes || 30
  const timeCheck = validateBookingTime(room, dateCheck, args.time, duration)
  if (!timeCheck.ok) return { success: false, message: `${timeCheck.message} A consulta NÃO foi criada.` }
  const { slotStart, slotEnd, time } = timeCheck
  const { y, m, d, label } = dateCheck

  if (await checkLunchOverlap(doctorId, slotStart, duration)) {
    return { success: false, message: 'Esse horário cai no intervalo de almoço do profissional — sugira outro horário. A consulta NÃO foi criada.' }
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
        return { success: false as const, message: `${label} às ${time} acabou de ficar indisponível — peça pro paciente escolher outro horário (use check_availability de novo). A consulta NÃO foi criada.` }
      }

      // O paciente é escolhido entre os cadastros DESTE telefone (resolvidos
      // em handleAiAgentMessage pelo telefone de quem manda a mensagem —
      // nunca por um telefone que o modelo tenha digitado). Agendar é a
      // conversão de verdade: o card do paciente certo vai pro "Convertido".
      const resolved = await resolveBookingPatient(tx, doctorId, room, ctx, args.patientName, args.isNewPatient === true)
      if (resolved.kind === 'ask') return { success: false as const, message: `${resolved.message} A consulta ainda NÃO foi criada.` }
      let patient = resolved.patient
      if (patient.leadStatus && patient.leadStatus !== 'CONVERTIDO') {
        patient = await tx.patient.update({ where: { id: patient.id }, data: { leadStatus: 'CONVERTIDO' } })
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
        message: `Consulta marcada com sucesso para ${patient.name} em ${label} às ${time}. Confirme pro paciente de forma natural, dizendo o dia da semana e a data (ex: "${label.replace(/\/\d{4}$/, '')} às ${time}").`,
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.name,
      }
    }, { isolationLevel: 'Serializable' })

    if (result.success) {
      if (!ctx.householdIds.includes(result.patientId)) ctx.householdIds.push(result.patientId)
      if (!ctx.primaryPatientId) ctx.primaryPatientId = result.patientId
      if (conversationId) await linkConversationPatient(conversationId, result.patientId).catch(() => {})
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
    return { success: false, message: 'Não consegui confirmar o agendamento agora — peça pro paciente tentar de novo em instantes. A consulta NÃO foi criada.' }
  }
}

// ─── Listar/remarcar/cancelar consulta existente ───────────────────────────
// Antes só existia create_appointment — pedir pra "mudar" a consulta fazia
// o modelo criar uma SEGUNDA consulta em vez de atualizar a primeira (bug
// real encontrado em produção: duas consultas pro mesmo paciente). Essas
// ferramentas sempre operam sobre os pacientes já resolvidos pelo telefone
// de quem está mandando mensagem (householdIds) — nunca confiam num id vindo
// "cru" da conversa sem confirmar que pertence a esse telefone+médico.

type UpcomingAppointment = { id: string; date: Date; duration: number; patientId: string; patient: { name: string } }

async function findUpcomingAppointments(doctorId: string, patientIds: string[], patientName?: string): Promise<UpcomingAppointment[]> {
  if (patientIds.length === 0) return []
  const appts = await prisma.appointment.findMany({
    where: { doctorId, patientId: { in: patientIds }, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] }, date: { gte: new Date() } },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, duration: true, patientId: true, patient: { select: { name: true } } },
  })
  if (!patientName || !patientName.trim()) return appts
  const filtered = appts.filter(a => nameMatchScore(a.patient.name, patientName) > 0)
  return filtered.length > 0 ? filtered : appts
}

function formatAppointmentList(appts: UpcomingAppointment[]): string {
  return appts.map(a => `- id: ${a.id} | ${a.patient.name} | ${formatInstantLong(new Date(a.date))}`).join('\n')
}

async function listAppointmentsTool(doctorId: string, ctx: PatientContext): Promise<string> {
  const appts = await findUpcomingAppointments(doctorId, ctx.householdIds)
  if (appts.length === 0) return 'Não há nenhuma consulta futura agendada para este telefone.'
  return `Consultas futuras (deste telefone):\n${formatAppointmentList(appts)}`
}

type ResolveApptResult =
  | { kind: 'found'; appointment: UpcomingAppointment }
  | { kind: 'none' }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'not_owned' }

// id opcional: se o modelo já chamou list_my_appointments e tem o id, usa
// direto (mas sempre reconfirma doctorId + paciente do telefone — nunca confia
// cego). Sem id: 0 consultas → avisa, 1 → usa, >1 → devolve a lista e pede
// pro modelo perguntar ao paciente antes de agir.
async function resolveTargetAppointment(doctorId: string, ctx: PatientContext, appointmentId?: string, patientName?: string): Promise<ResolveApptResult> {
  if (appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, date: true, duration: true, patientId: true, doctorId: true, status: true, patient: { select: { name: true } } },
    })
    if (!appt || appt.doctorId !== doctorId || !ctx.householdIds.includes(appt.patientId)) return { kind: 'not_owned' }
    if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(appt.status) || appt.date < new Date()) return { kind: 'not_owned' }
    return { kind: 'found', appointment: appt }
  }
  const appts = await findUpcomingAppointments(doctorId, ctx.householdIds, patientName)
  if (appts.length === 0) return { kind: 'none' }
  if (appts.length === 1) return { kind: 'found', appointment: appts[0] }
  return { kind: 'ambiguous', message: `Há mais de uma consulta futura — pergunte ao paciente qual ele quer alterar antes de continuar:\n${formatAppointmentList(appts)}` }
}

interface RescheduleArgs { newDate: string; newTime: string; weekday?: string; appointmentId?: string; patientName?: string }

async function rescheduleAppointmentTool(
  doctorId: string,
  room: RoomForSchedule,
  ctx: PatientContext,
  args: RescheduleArgs,
): Promise<{ success: boolean; message: string }> {
  const resolved = await resolveTargetAppointment(doctorId, ctx, args.appointmentId, args.patientName)
  if (resolved.kind === 'none') return { success: false, message: 'Não encontrei nenhuma consulta futura deste telefone pra alterar.' }
  if (resolved.kind === 'not_owned') return { success: false, message: 'Não encontrei essa consulta — use list_my_appointments pra confirmar qual o paciente quer alterar.' }
  if (resolved.kind === 'ambiguous') return { success: false, message: resolved.message }

  const dateCheck = validateBookingDate(room, args.newDate, args.weekday)
  if (!dateCheck.ok) return { success: false, message: `${dateCheck.message} A consulta NÃO foi remarcada.` }
  const duration = resolved.appointment.duration || room.slotDurationMinutes || 30
  const timeCheck = validateBookingTime(room, dateCheck, args.newTime, duration)
  if (!timeCheck.ok) return { success: false, message: `${timeCheck.message} A consulta NÃO foi remarcada.` }
  const { slotStart, slotEnd, time } = timeCheck
  const { y, m, d, label, ymd } = dateCheck

  if (await checkLunchOverlap(doctorId, slotStart, duration)) {
    return { success: false, message: 'Esse horário cai no intervalo de almoço do profissional — sugira outro horário. A consulta NÃO foi remarcada.' }
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
        return { success: false as const, message: `${label} às ${time} acabou de ficar indisponível — peça pro paciente escolher outro horário (use check_availability de novo). A consulta NÃO foi remarcada.` }
      }
      const updated = await tx.appointment.update({
        where: { id: resolved.appointment.id },
        // Data nova → lembretes automáticos (24h/2h) precisam disparar de novo.
        data: { date: slotStart, reminder24hSent: false, reminder2hSent: false },
        include: { patient: { select: { name: true } } },
      })
      return {
        success: true as const,
        message: `Consulta de ${updated.patient.name} remarcada com sucesso para ${label} às ${time}. Confirme pro paciente de forma natural, dizendo o dia da semana e a data.`,
        patientName: updated.patient.name,
      }
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
        metadata: { appointmentId: resolved.appointment.id, newDate: ymd, newTime: time },
      }).catch(() => {})
    }
    return { success: result.success, message: result.message }
  } catch (err) {
    console.error('[ai-agent-engine] rescheduleAppointmentTool error:', err)
    return { success: false, message: 'Não consegui remarcar agora — peça pro paciente tentar de novo em instantes.' }
  }
}

interface CancelArgs { appointmentId?: string; reason?: string; patientName?: string }

async function cancelAppointmentTool(doctorId: string, ctx: PatientContext, args: CancelArgs): Promise<{ success: boolean; message: string }> {
  const resolved = await resolveTargetAppointment(doctorId, ctx, args.appointmentId, args.patientName)
  if (resolved.kind === 'none') return { success: false, message: 'Não encontrei nenhuma consulta futura deste telefone pra cancelar.' }
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
    return { success: true, message: `Consulta de ${updated.patient.name} em ${formatInstantLong(updated.date)} cancelada com sucesso. Confirme isso pro paciente de forma natural.` }
  } catch (err) {
    console.error('[ai-agent-engine] cancelAppointmentTool error:', err)
    return { success: false, message: 'Não consegui cancelar agora — peça pro paciente tentar de novo em instantes.' }
  }
}

// ─── Lembretes e observações pra equipe (sem transferir) ───────────────────
// Lembretes de consulta são automáticos: checkScheduledReminders
// (lib/chatbot-light-engine.ts) dispara APPOINTMENT_REMINDER_24H/2H quando a
// automação está ativa (LightIntegrationConfig enabled + template ativo +
// chatbot) e marca reminder24hSent/reminder2hSent na consulta. Pedido de
// lembrete NÃO é motivo pra transferir pra um humano (bug real: "pode me
// relembrar pela manhã?" virou handoff).

const REMINDER_EVENTS: Record<string, string> = {
  APPOINTMENT_REMINDER_24H: '24 horas antes',
  APPOINTMENT_REMINDER_2H: '2 horas antes',
}

async function getActiveReminderLabels(doctorId: string): Promise<string[]> {
  const configs = await prisma.lightIntegrationConfig.findMany({
    where: { doctorId, triggerEvent: { in: Object.keys(REMINDER_EVENTS) }, enabled: true, chatbotId: { not: null } },
    select: { triggerEvent: true, template: { select: { active: true } } },
  }).catch(() => [])
  const active = new Set(configs.filter(c => c.template?.active).map(c => c.triggerEvent))
  return Object.keys(REMINDER_EVENTS).filter(e => active.has(e)).map(e => REMINDER_EVENTS[e])
}

/** Nota interna na conversa do Atendimento (não vai pro WhatsApp). */
async function addAiInternalNote(conversationId: string, content: string): Promise<boolean> {
  try {
    // addSystemNote publica message.created + conversation.updated (aparece ao vivo no chat).
    return (await addSystemNote(conversationId, content, { isBot: true })) !== null
  } catch (err) {
    console.error('[ai-agent-engine] falha ao registrar nota interna:', err)
    return false
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
    description: 'Transfere a conversa para a equipe humana da clínica e encerra a sua participação. Use SÓ quando o paciente pedir explicitamente para falar com uma pessoa/atendente/médico, fizer uma reclamação, trouxer dúvida clínica ou sintoma, ou pedir algo que nenhuma das suas ferramentas resolve e que não está no prompt. NÃO use para: pedido de lembrete, agradecimento, "ok", confirmação de consulta, dúvidas de horário/endereço/valores que estão no prompt, ou agendar/remarcar/cancelar (use as ferramentas de agenda).',
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

const NOTE_TOOL: AiTool = {
  type: 'function',
  function: {
    name: 'note_for_team',
    description: 'Registra um recado interno para a equipe da clínica na conversa (o paciente não vê) SEM transferir o atendimento. Use para pedidos que a equipe precisa saber mas que não exigem um humano agora (ex: "paciente pediu lembrete na manhã da consulta", "paciente avisou que vai chegar 10 min atrasado").',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Recado curto e objetivo para a equipe' } },
      required: ['note'],
    },
  },
}

const WEEKDAY_PARAM = {
  type: 'string',
  description: 'Dia da semana que o paciente falou (ex: "sexta"), se ele falou. A ferramenta confere se a data cai nesse dia.',
}

function buildTools(includeScheduling: boolean, includeTransfer: boolean): AiTool[] {
  const transferTools: AiTool[] = includeTransfer ? [TRANSFER_TOOL, NOTE_TOOL] : []
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
        description: 'Consulta os horários livres numa data. A data vem SEMPRE da tabela de calendário do prompt (ano atual). Não aceita datas passadas.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Data no formato YYYY-MM-DD, copiada da tabela de calendário' },
            weekday: WEEKDAY_PARAM,
          },
          required: ['date'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_appointment',
        description: 'Cria de fato uma consulta NOVA, só depois que o paciente confirmou o nome de quem será atendido e a data/horário no formato "sexta-feira, 09/10 às 14:00". Pra alterar ou cancelar uma consulta que já existe, use reschedule_appointment ou cancel_appointment — nunca crie uma nova no lugar.',
        parameters: {
          type: 'object',
          properties: {
            patientName: { type: 'string', description: 'Nome completo de quem será atendido (pode ser um familiar de quem está escrevendo)' },
            date: { type: 'string', description: 'Data no formato YYYY-MM-DD, copiada da tabela de calendário' },
            time: { type: 'string', description: 'Horário no formato HH:MM (um dos devolvidos por check_availability)' },
            weekday: WEEKDAY_PARAM,
            isNewPatient: { type: 'boolean', description: 'true só quando o paciente confirmou que a consulta é para OUTRA pessoa, ainda não cadastrada neste telefone (ex: filho)' },
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
        description: 'Lista as consultas futuras já agendadas deste telefone (de todas as pessoas cadastradas nele) — use antes de reagendar/cancelar se não tiver certeza de qual consulta o paciente quer alterar.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'reschedule_appointment',
        description: 'Altera a data/horário de uma consulta JÁ EXISTENTE (nunca cria uma nova), depois que o paciente confirmou a nova data/horário. Se houver mais de uma consulta futura, pergunte qual antes — ou chame sem appointmentId pra ferramenta te dizer se precisa perguntar.',
        parameters: {
          type: 'object',
          properties: {
            newDate: { type: 'string', description: 'Nova data no formato YYYY-MM-DD, copiada da tabela de calendário' },
            newTime: { type: 'string', description: 'Novo horário no formato HH:MM' },
            weekday: WEEKDAY_PARAM,
            appointmentId: { type: 'string', description: 'id da consulta a alterar, se já souber (de list_my_appointments)' },
            patientName: { type: 'string', description: 'Nome de quem é a consulta, se o telefone tiver mais de uma pessoa' },
          },
          required: ['newDate', 'newTime'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_appointment',
        description: 'Cancela uma consulta JÁ EXISTENTE. Se houver mais de uma consulta futura, pergunte qual antes.',
        parameters: {
          type: 'object',
          properties: {
            appointmentId: { type: 'string', description: 'id da consulta a cancelar, se já souber (de list_my_appointments)' },
            patientName: { type: 'string', description: 'Nome de quem é a consulta, se o telefone tiver mais de uma pessoa' },
            reason: { type: 'string', description: 'Motivo do cancelamento, se o paciente informar (opcional)' },
          },
          required: [],
        },
      },
    },
  ]
}

// Rede de segurança pro bug "pode me relembrar pela manhã?" → handoff. Só
// barra quando o MOTIVO é lembrete e o paciente NÃO pediu explicitamente uma
// pessoa — dúvida clínica (target doctor) nunca é barrada.
const REMINDER_REASON_RE = /lembrete|relembr|me lembr|lembrar/i
const EXPLICIT_HUMAN_REQUEST_RE = /atendente|pessoa|humano|secret[aá]ri|recep[cç][aã]o|falar com|reclama/i

function buildDateSection(room: RoomForSchedule | null): string {
  const now = clinicNowParts()
  return `\n\n---\n# DATA DE HOJE E CALENDÁRIO (horário de Brasília)\nAgora: ${formatDateLong(now.ymd)}, ${now.hh}:${now.mm}. Ano atual: ${now.ymd.slice(0, 4)}.\nPróximos ${PROMPT_CALENDAR_DAYS} dias — use SEMPRE esta tabela para transformar "hoje", "amanhã", "sexta", "semana que vem", "dia 15" em data:\n${buildCalendarTable(room)}\nRegras de data:\n- Nunca calcule datas de cabeça nem use outro ano: copie o YYYY-MM-DD da tabela. Datas e horários que já passaram não podem ser agendados.\n- "sexta" = a próxima sexta-feira da tabela (se hoje for sexta, pergunte se é hoje ou a da semana que vem). "dia 15" sem mês = o próximo dia 15 a partir de hoje.\n- Quando o paciente citar um dia da semana, passe também o parâmetro weekday (ex: "sexta") nas ferramentas de agenda — elas conferem se a data bate.\n- Com o paciente, fale sempre dia da semana + dd/mm, igual ao retorno das ferramentas (ex: "sexta-feira, 09/10 às 14:00"). Antes de create_appointment ou reschedule_appointment, confirme nesse formato e só chame a ferramenta depois do "sim".\n- Se uma ferramenta devolver erro de data, use a data correta que ela indicar e confirme de novo com o paciente. Nunca diga que agendou/remarcou se a ferramenta não retornou sucesso.`
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
  // telefone junto da mensagem (raro, ver lib/whatsapp.ts). Nesse caso tenta o
  // mapeamento LID→telefone já aprendido; se não houver, os dígitos do LID
  // NÃO são um telefone: servem só de chave interna do histórico e nunca são
  // gravados como telefone/nome de paciente.
  const isLidContact = contactPhone.endsWith('@lid')
  const lidJid = isLidContact ? toLidJid(contactPhone) : null
  const lidDigits = contactPhone.replace(/\D/g, '')
  const resolvedPhoneRaw = isLidContact ? await lookupPhoneByLid(contactPhone).catch(() => null) : lidDigits
  const resolvedPhone = resolvedPhoneRaw ? normalizePatientPhone(resolvedPhoneRaw) : null
  const isUnresolvedLid = !resolvedPhone

  const ignored = await prisma.lightIgnoredNumber.findFirst({
    where: { chatbotId, phone: { in: Array.from(new Set([lidDigits, ...(resolvedPhone ? [resolvedPhone] : [])])) } },
  }).catch(() => null)
  if (ignored) return

  const chatbot = await prisma.lightChatbot.findUnique({ where: { id: chatbotId }, include: { boundRoom: true } })
  if (!chatbot || !chatbot.active || !chatbot.systemPrompt) return

  const room = chatbot.boundRoom as RoomForSchedule | null

  if (isUnresolvedLid) {
    console.warn('[ai-agent-engine] telefone real não resolvido pra este contato (lid sem senderPn) — nenhum telefone será gravado.', { chatbotId, contactPhone })
  }

  // ── Quem é o paciente ──
  // 1) paciente já vinculado à conversa do Atendimento (vínculo feito pela
  //    equipe ou num agendamento anterior) — é o mais confiável;
  // 2) senão, pelo telefone (findPatientByPhone já ignora a variação do 9º dígito).
  // Todos os pacientes deste telefone formam o "household" (família no mesmo número).
  let linkedPatient: Patient | null = null
  if (conversationId) {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { patientId: true } }).catch(() => null)
    if (conv?.patientId) {
      linkedPatient = await prisma.patient.findFirst({ where: { id: conv.patientId, doctorId } }).catch(() => null)
    }
  }
  // findPatientsByPhone: todos os cadastros do número (ignora DDI/9º dígito),
  // em ordem de prioridade (ATIVO > ... > PRE_CADASTRO, depois o mais antigo).
  // Contato só com LID: busca o lead pelo whatsappLid.
  const phonePatients = await findPatientsByPhone(prisma, doctorId, resolvedPhone ?? contactPhone).catch((): Patient[] => [])
  const phoneMatch = phonePatients[0] ?? null
  const existingPatient = linkedPatient ?? phoneMatch

  // Telefone usado pra ENCADEAR a conversa (histórico + CRM) — sempre o
  // mesmo valor canônico do cadastro (Patient.phone), nunca o dígito bruto
  // desta mensagem (a WhatsApp reporta o mesmo contato com/sem o 9º dígito).
  const matchPhone = phoneMatch?.phone && !phoneMatch.phone.includes('@') ? phoneMatch.phone : null
  const canonicalPhone = matchPhone || resolvedPhone || lidDigits

  // CRM — todo contato novo vira um lead rastreável desde a primeira
  // mensagem (createAppointmentTool troca o nome placeholder pelo real e
  // marca CONVERTIDO). Contato só com LID não resolvido: nome genérico e
  // telefone vazio — o LID fica só em whatsappLid (é por ele que o lead é
  // reencontrado na próxima mensagem), nunca como telefone/nome.
  let createdLeadId: string | null = null
  if (!existingPatient && (!isUnresolvedLid || lidJid)) {
    try {
      const created = await prisma.patient.create({
        data: {
          name: isUnresolvedLid ? 'Contato WhatsApp' : `Novo contato (${canonicalPhone})`,
          phone: isUnresolvedLid ? '' : canonicalPhone,
          ...(isUnresolvedLid ? { whatsappLid: lidJid } : {}),
          doctorId,
          roomId: room?.id ?? null,
          status: 'PRE_CADASTRO',
          origin: 'CHATBOT',
          leadStatus: 'NOVO',
        },
      })
      createdLeadId = created.id
    } catch (err) {
      console.error('[ai-agent-engine] falha ao criar lead no primeiro contato:', err)
    }
  }

  const ctx: PatientContext = {
    primaryPatientId: existingPatient?.id ?? createdLeadId,
    householdIds: Array.from(new Set([existingPatient?.id, phoneMatch?.id, createdLeadId, ...phonePatients.map(p => p.id)].filter((id): id is string => !!id))),
    phoneForNewPatient: isUnresolvedLid ? '' : canonicalPhone,
    whatsappLid: isUnresolvedLid ? lidJid : null,
  }

  if (conversationId && ctx.primaryPatientId) {
    await linkConversationPatient(conversationId, ctx.primaryPatientId).catch(() => {})
  }

  const household = ctx.householdIds.length
    ? await prisma.patient.findMany({ where: { id: { in: ctx.householdIds } }, select: { name: true, status: true }, orderBy: { createdAt: 'asc' } })
    : []
  const knownNames = Array.from(new Set(household.filter(p => !isGenericLeadName(p.name)).map(p => p.name)))

  let systemContent = chatbot.systemPrompt
  systemContent += `\n\n---\n# REGRAS DE CONVERSA (sempre válidas, independente do restante do prompt)\n- Leia o histórico da conversa antes de responder. Nunca repita uma pergunta, oferta ou instrução que o paciente já respondeu ou que já foi concluída (ex: depois de confirmar um agendamento, não volte a perguntar sobre horários).\n- Se a última mensagem do paciente for só um agradecimento, confirmação ou encerramento (ex: "obrigado", "ok", "confirmado", "valeu"), responda de forma breve e natural, sem reabrir assuntos já resolvidos.\n- Mensagens curtas, no estilo de WhatsApp — evite blocos de texto longos. Uma pergunta por vez.\n- Pra entregar um documento (atestado, declaração etc), use só send_ready_document — nunca escreva ou invente o conteúdo de um documento você mesmo.`

  systemContent += buildDateSection(room)

  // Família no mesmo número: a IA precisa saber de quem é o telefone pra
  // perguntar "para quem é a consulta?" em vez de sobrescrever um cadastro.
  if (knownNames.length > 1) {
    systemContent += `\n\n---\n# PACIENTES DESTE TELEFONE\nEste número é compartilhado por mais de uma pessoa cadastrada: ${knownNames.join('; ')}.\nAntes de agendar, remarcar ou cancelar, pergunte para quem é a consulta e passe o nome em patientName. Se for para alguém que não está na lista (ex: outro filho), peça o nome completo e use isNewPatient=true. Não comente dados de uma pessoa com outra além do necessário.`
  } else if (knownNames.length === 1) {
    systemContent += `\n\n---\n# PACIENTE DESTE TELEFONE\nEste número está cadastrado para: ${knownNames[0]}.\nSe a consulta for para essa pessoa, use exatamente esse nome em patientName (não pergunte o nome de novo). Se o paciente disser que é para outra pessoa (filho, mãe etc.), peça o nome completo dela e use isNewPatient=true — nunca troque o nome do cadastro existente.`
  } else {
    systemContent += `\n\n---\n# PACIENTE DESTE TELEFONE\nAinda não sabemos o nome de quem está falando. Antes de agendar, pergunte o nome completo de quem vai ser atendido.`
  }

  // Lembretes: automáticos quando a automação está ativa — nunca motivo de transferência.
  const reminderLabels = await getActiveReminderLabels(doctorId)
  if (reminderLabels.length > 0) {
    systemContent += `\n\n---\n# LEMBRETES\nA clínica envia lembrete automático da consulta pelo WhatsApp ${reminderLabels.join(' e ')} do horário marcado. Se o paciente pedir para ser lembrado, responda que ele vai receber esse lembrete automaticamente. Não prometa lembrete em outro horário (ex: "pela manhã")${conversationId ? '; se ele insistir num horário específico, registre o pedido com note_for_team e diga que a equipe foi avisada' : ''}. Não transfira para humano por causa disso.`
  } else if (conversationId) {
    systemContent += `\n\n---\n# LEMBRETES\nA clínica não tem lembrete automático configurado. Se o paciente pedir para ser lembrado, registre o pedido com note_for_team (ex: "Paciente pediu lembrete na manhã da consulta de sexta-feira, 09/10") e responda que anotou e que a equipe foi avisada. Não transfira para humano por causa disso.`
  } else {
    systemContent += `\n\n---\n# LEMBRETES\nA clínica não tem lembrete automático configurado. Se o paciente pedir para ser lembrado, diga com gentileza que não conseguimos garantir um lembrete e reforce a data e o horário da consulta.`
  }

  if (conversationId) {
    systemContent += `\n\n---\n# TRANSFERÊNCIA PARA A EQUIPE HUMANA\nUse a ferramenta transfer_to_human (e não responda mais nada depois dela) SOMENTE quando:\n- o paciente pedir explicitamente para falar com uma pessoa, atendente, secretária ou com o médico;\n- o paciente fizer uma reclamação ou demonstrar insatisfação;\n- houver dúvida clínica, sintoma, pedido de orientação médica ou sobre resultado de exame (use target "doctor") — nunca dê orientação médica;\n- o pedido não puder ser resolvido por nenhuma das suas ferramentas e a resposta não estiver neste prompt;\n- você não conseguir resolver o pedido depois de tentar (ex: a ferramenta falhou mais de uma vez).\nNUNCA transfira por:\n- pedido de lembrete (veja LEMBRETES);\n- agradecimento, "ok", despedida ou emoji;\n- confirmação de presença ou de consulta ("confirmado", "estarei lá");\n- dúvidas sobre horário de funcionamento, endereço, valores ou convênios que estejam neste prompt;\n- agendar, remarcar, cancelar ou consultar consultas (use as ferramentas de agenda).\nPara deixar um recado à equipe sem transferir, use note_for_team.`
  }
  if (room) {
    systemContent += `\n\n---\n# HORÁRIO DE FUNCIONAMENTO DA CLÍNICA\n${describeRoomSchedule(room)}\nUse a ferramenta check_availability antes de propor um horário, e create_appointment só depois que o paciente confirmar o nome de quem será atendido e a data/horário (dia da semana + dd/mm + hora). Nunca invente horários — use sempre o resultado da ferramenta.\nSe o paciente quer ALTERAR ou CANCELAR uma consulta que já existe, use reschedule_appointment ou cancel_appointment — nunca create_appointment de novo (isso cria uma segunda consulta em vez de mudar a primeira). Se não tiver certeza de qual consulta ele quer mexer, use list_my_appointments primeiro.`
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
          const primaryPatientId = ctx.primaryPatientId
          const hasPatients = ctx.householdIds.length > 0
          let toolResult = 'Ferramenta desconhecida.'

          if (call.function.name === 'transfer_to_human') {
            const reason = typeof args.reason === 'string' ? args.reason : 'Transferência solicitada pelo Agente de IA'
            const target: HandoffTarget = args.target === 'doctor' ? 'doctor' : 'reception'
            if (!conversationId) {
              toolResult = 'Transferência indisponível neste canal.'
            } else if (target !== 'doctor' && REMINDER_REASON_RE.test(reason) && !EXPLICIT_HUMAN_REQUEST_RE.test(messageText)) {
              toolResult = 'Transferência NÃO realizada: pedido de lembrete não precisa de atendimento humano. Responda você mesmo seguindo a seção LEMBRETES do prompt (use note_for_team se precisar avisar a equipe).'
            } else {
              handedOff = await handoffToHuman(conversationId, reason, target)
              toolResult = handedOff ? 'Conversa transferida para a equipe.' : 'A conversa já está com a equipe humana.'
              if (!handedOff) {
                // Humano já no controle — encerra sem responder.
                return
              }
            }
          } else if (call.function.name === 'note_for_team') {
            const note = typeof args.note === 'string' ? args.note.trim().slice(0, 1000) : ''
            if (!conversationId) toolResult = 'Recados para a equipe indisponíveis neste canal.'
            else if (!note) toolResult = 'Recado vazio — escreva o que a equipe precisa saber.'
            else {
              const ok = await addAiInternalNote(conversationId, `[Agente de IA] ${note}`)
              toolResult = ok
                ? 'Recado registrado para a equipe (nota interna, o paciente não vê). Diga ao paciente que anotou e que a equipe foi avisada — sem transferir.'
                : 'Não consegui registrar o recado agora — apenas responda ao paciente normalmente.'
            }
          } else if (call.function.name === 'list_ready_documents') {
            toolResult = primaryPatientId ? await listReadyDocumentsTool(doctorId, primaryPatientId) : noPatientMsg
          } else if (call.function.name === 'send_ready_document') {
            toolResult = !primaryPatientId
              ? noPatientMsg
              : (await sendReadyDocumentTool(doctorId, primaryPatientId, chatbotId, contactPhone, deliveryJid, args as SendDocArgs, conversationId)).message
          } else if (!room) {
            toolResult = 'Ferramenta indisponível — sem sala vinculada a este agente.'
          } else if (call.function.name === 'check_availability') {
            toolResult = await checkAvailabilityTool(doctorId, room, args)
          } else if (call.function.name === 'create_appointment') {
            const outcome = await createAppointmentTool(doctorId, room, ctx, args as unknown as CreateAppointmentArgs, conversationId)
            toolResult = outcome.message
          } else if (call.function.name === 'list_my_appointments') {
            toolResult = hasPatients ? await listAppointmentsTool(doctorId, ctx) : noPatientMsg
          } else if (call.function.name === 'reschedule_appointment') {
            toolResult = !hasPatients
              ? noPatientMsg
              : (await rescheduleAppointmentTool(doctorId, room, ctx, args as unknown as RescheduleArgs)).message
          } else if (call.function.name === 'cancel_appointment') {
            toolResult = !hasPatients
              ? noPatientMsg
              : (await cancelAppointmentTool(doctorId, ctx, args as unknown as CancelArgs)).message
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
    console.warn('[ai-agent-engine] Loop de ferramentas esgotou sem resposta final — enviando fallback.', { chatbotId, contactPhone: canonicalPhone })
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
