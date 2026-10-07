import type { KiwifyWebhookPayload, NormalizedBillingEvent, NormalizedBillingEventType } from './kiwify.types'

// Mapeia o evento bruto da Kiwify para o nosso tipo interno. A regra de
// negócio (kiwify.service) nunca depende dos nomes da Kiwify — só deste tipo.
// `webhook_event_type` é o campo principal; `order_status` é fallback.
const EVENT_MAP: Record<string, NormalizedBillingEventType> = {
  // webhook_event_type (formato atual)
  order_approved: 'PAYMENT_APPROVED',
  subscription_renewed: 'SUBSCRIPTION_RENEWED',
  subscription_late: 'PAYMENT_LATE',
  subscription_canceled: 'SUBSCRIPTION_CANCELED',
  order_refunded: 'PAYMENT_REFUNDED',
  chargeback: 'CHARGEBACK',
  order_rejected: 'PAYMENT_REFUSED',
  billet_created: 'PAYMENT_PENDING',
  pix_created: 'PAYMENT_PENDING',
  // nomes em português (gatilhos do painel/API de webhooks)
  compra_aprovada: 'PAYMENT_APPROVED',
  compra_reembolsada: 'PAYMENT_REFUNDED',
  compra_recusada: 'PAYMENT_REFUSED',
  boleto_gerado: 'PAYMENT_PENDING',
  pix_gerado: 'PAYMENT_PENDING',
  // order_status (fallback)
  paid: 'PAYMENT_APPROVED',
  approved: 'PAYMENT_APPROVED',
  renewed: 'SUBSCRIPTION_RENEWED',
  late: 'PAYMENT_LATE',
  past_due: 'PAYMENT_LATE',
  overdue: 'PAYMENT_LATE',
  canceled: 'SUBSCRIPTION_CANCELED',
  cancelled: 'SUBSCRIPTION_CANCELED',
  refunded: 'PAYMENT_REFUNDED',
  chargedback: 'CHARGEBACK',
  refused: 'PAYMENT_REFUSED',
  rejected: 'PAYMENT_REFUSED',
  waiting_payment: 'PAYMENT_PENDING',
  pending: 'PAYMENT_PENDING',
}

function toCents(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.round(Number(value))
  return undefined
}

// A Kiwify manda datas como "2026-10-07 11:57" (horário de Brasília, sem
// fuso) ou ISO. Sem fuso explícito, interpreta como -03:00.
function parseKiwifyDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const value = raw.trim()
  let normalized = value
  const hasTime = /\d{2}:\d{2}/.test(value)
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  if (hasTime && !hasZone) {
    normalized = value.replace(' ', 'T')
    if (/T\d{2}:\d{2}$/.test(normalized)) normalized += ':00'
    normalized += '-03:00'
  }
  const date = new Date(normalized)
  if (!Number.isNaN(date.getTime())) return date
  const fallback = new Date(value)
  return Number.isNaN(fallback.getTime()) ? undefined : fallback
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function mapKiwifyWebhook(payload: KiwifyWebhookPayload): NormalizedBillingEvent {
  const rawEventName = (cleanString(payload.webhook_event_type) || cleanString(payload.order_status) || cleanString(payload.Subscription?.status) || '').toLowerCase()
  let eventType = EVENT_MAP[rawEventName] ?? 'UNKNOWN'

  // Se o tipo do evento não for reconhecido, tenta o order_status.
  if (eventType === 'UNKNOWN' && payload.order_status) {
    eventType = EVENT_MAP[payload.order_status.toLowerCase()] ?? 'UNKNOWN'
  }

  const amountCents =
    toCents(payload.Commissions?.charge_amount) ??
    toCents(payload.charge_amount) ??
    toCents(payload.Commissions?.product_base_price) ??
    toCents(payload.product_base_price)

  const eventDate =
    parseKiwifyDate(payload.approved_date) && eventType === 'PAYMENT_APPROVED'
      ? parseKiwifyDate(payload.approved_date)!
      : parseKiwifyDate(payload.updated_at) ?? parseKiwifyDate(payload.created_at) ?? new Date()

  return {
    eventType,
    rawEventName,
    providerOrderId: cleanString(payload.order_id) || cleanString(payload.order_ref) || '',
    providerSubscriptionId: cleanString(payload.subscription_id) || cleanString(payload.Subscription?.id),
    providerProductId: cleanString(payload.Product?.product_id) || cleanString(payload.product?.product_id),
    customerEmail: cleanString(payload.Customer?.email)?.toLowerCase(),
    doctorId: cleanString(payload.TrackingParameters?.s1),
    userId: cleanString(payload.TrackingParameters?.s2),
    checkoutAttemptId: cleanString(payload.TrackingParameters?.s3),
    amountCents,
    nextPaymentAt: parseKiwifyDate(payload.Subscription?.next_payment),
    eventDate,
    rawPayload: payload,
  }
}
