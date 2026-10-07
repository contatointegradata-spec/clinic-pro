// Payload cru do webhook de vendas da Kiwify. Formato real (2026):
// - `webhook_event_type`: order_approved, order_refunded, order_rejected,
//   billet_created, pix_created, chargeback, subscription_canceled,
//   subscription_late, subscription_renewed (carrinho abandonado vem num
//   formato totalmente diferente, sem order_id — é ignorado).
// - `order_status`: paid, waiting_payment, refused, refunded, chargedback.
// - valores em centavos ficam dentro de `Commissions`.
// - `TrackingParameters.s1/s2/s3` são os parâmetros que a Clinic Pro injeta
//   na URL do checkout (doctorId, userId, checkoutAttemptId).
export interface KiwifyWebhookPayload {
  order_id?: string
  order_ref?: string
  order_status?: string
  webhook_event_type?: string
  payment_method?: string
  product_type?: string
  created_at?: string
  updated_at?: string
  approved_date?: string
  subscription_id?: string
  product?: {
    product_id?: string
    product_name?: string
  }
  Product?: {
    product_id?: string
    product_name?: string
  }
  Customer?: {
    email?: string
    full_name?: string
    mobile?: string
  }
  Commissions?: {
    charge_amount?: number | string
    product_base_price?: number | string
  }
  Subscription?: {
    id?: string
    status?: string
    start_date?: string
    next_payment?: string
    plan?: { id?: string; name?: string; frequency?: string }
  }
  // Formato antigo/alternativo — mantido por compatibilidade.
  charge_amount?: number | string
  product_base_price?: number | string
  TrackingParameters?: {
    s1?: string | null // doctorId
    s2?: string | null // userId (quem abriu o checkout)
    s3?: string | null // checkoutAttemptId
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type NormalizedBillingEventType =
  | 'PAYMENT_APPROVED'
  | 'SUBSCRIPTION_RENEWED'
  | 'PAYMENT_LATE'
  | 'SUBSCRIPTION_CANCELED'
  | 'PAYMENT_REFUNDED'
  | 'CHARGEBACK'
  | 'PAYMENT_REFUSED'
  | 'PAYMENT_PENDING'
  | 'UNKNOWN'

export interface NormalizedBillingEvent {
  eventType: NormalizedBillingEventType
  rawEventName: string
  providerOrderId: string
  providerSubscriptionId?: string
  providerProductId?: string
  customerEmail?: string
  doctorId?: string
  userId?: string
  checkoutAttemptId?: string
  amountCents?: number
  nextPaymentAt?: Date
  eventDate: Date
  rawPayload: unknown
}
