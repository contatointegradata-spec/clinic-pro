import { format, isToday, isYesterday, differenceInCalendarDays, isSameYear } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { AttendanceStatus, ConversationEvent } from '../../types'

export function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

const AVATAR_COLORS = [
  'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700', 'bg-orange-100 text-orange-700',
]

/** Cor estável por contato (hash simples do texto). */
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function formatPhone(phone: string | null | undefined): string {
  const d = (phone || '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4)
    const rest = d.slice(4)
    const split = rest.length === 9 ? 5 : 4
    return `+55 (${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
  }
  return d ? `+${d}` : ''
}

export function displayName(c: { contactName: string | null; contactPhone: string; patient?: { name: string } | null }): string {
  return c.patient?.name || c.contactName || formatPhone(c.contactPhone)
}

/** Hora curta estilo WhatsApp: 14:32 · Ontem · seg · 12/03/24 */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ontem'
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE', { locale: ptBR }).replace('.', '')
  return format(d, 'dd/MM/yy')
}

export function clockTime(iso: string): string {
  return format(new Date(iso), 'HH:mm')
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return 'Hoje'
  if (isYesterday(d)) return 'Ontem'
  return format(d, isSameYear(d, new Date()) ? "d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", { locale: ptBR })
}

export function waitingFor(iso: string | null): string {
  if (!iso) return ''
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`
}

export const STATUS_META: Record<AttendanceStatus, { label: string; chip: string }> = {
  BOT: { label: 'Agente IA', chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  QUEUED: { label: 'Na fila', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  IN_PROGRESS: { label: 'Em atendimento', chip: 'bg-primary-50 text-primary-700 ring-primary-200' },
  RESOLVED: { label: 'Resolvida', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

export const LEAD_STATUS_META: Record<string, { label: string; chip: string }> = {
  NOVO: { label: 'Lead novo', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  EM_ANALISE: { label: 'Em análise', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  EM_CONTATO: { label: 'Em contato', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  CONVERTIDO: { label: 'Paciente', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  DESCARTADO: { label: 'Descartado', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

export const PATIENT_STATUS_META: Record<string, { label: string; chip: string }> = {
  PRE_CADASTRO: { label: 'Pré-cadastro', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  INCOMPLETO: { label: 'Cadastro incompleto', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  INATIVO: { label: 'Inativo', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

export function describeEvent(e: ConversationEvent): string {
  const by = e.actor ? ` por ${e.actor.name}` : ''
  switch (e.type) {
    case 'CREATED': return 'Conversa iniciada'
    case 'BOT_STARTED': return 'Agente de IA assumiu o atendimento'
    case 'HANDOFF_TO_HUMAN': return `Agente de IA transferiu para ${e.toQueue?.name ?? 'atendimento humano'}`
    case 'ASSUMED': return `${e.actor?.name ?? 'Alguém'} assumiu o atendimento`
    case 'TRANSFERRED_QUEUE': return `Transferido para ${e.toQueue?.name ?? 'fila'}${by}`
    case 'TRANSFERRED_USER': return `Transferido para ${e.toUser?.name ?? 'outro atendente'}${by}`
    case 'RETURNED_TO_BOT': return `Devolvido ao Agente de IA${by}`
    case 'RESOLVED': return `Resolvido${by}`
    case 'REOPENED': return `Reaberto${by}`
    case 'NOTE': return `Observação${by}`
    case 'NOTE_EDITED': return `Observação editada${by}`
    case 'NOTE_DELETED': return `Observação excluída${by}`
    case 'CONTACT_UPDATED': return `Nome do contato alterado${by}`
    case 'PATIENT_LINKED': return `Paciente vinculado${by}`
    case 'PATIENT_UNLINKED': return `Paciente desvinculado${by}`
    default: return 'Atualização'
  }
}

export function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } } }
  return err?.response?.data?.message || fallback
}
