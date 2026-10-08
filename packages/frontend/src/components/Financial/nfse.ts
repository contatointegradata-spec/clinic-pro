import type { NfseStatus } from '../../types'

export function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

export const centsToBRL = (cents: number) => currency(cents / 100)

export const NFSE_STATUS: Record<NfseStatus, { label: string; cls: string; dot: string }> = {
  PROCESSING: { label: 'Processando', cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200', dot: 'bg-sky-500' },
  AUTHORIZED: { label: 'Autorizada', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Rejeitada', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelada', cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200', dot: 'bg-slate-400' },
  ERROR: { label: 'Não gerada', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', dot: 'bg-amber-500' },
}

export function formatDoc(doc: string | null | undefined) {
  const d = (doc ?? '').replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc ?? ''
}

/** Mensagem de erro da API (axios) com fallback. */
export function apiError(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
  return msg || fallback
}
