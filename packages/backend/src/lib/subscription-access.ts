import { prisma } from './prisma'
import { CLINIC_PRO_SUBSCRIPTION } from './billing-config'
import { logAudit } from './secretaryAccess'
import type { DoctorSubscription } from '@prisma/client'

export type SubscriptionStatusValue = 'TRIAL' | 'ACTIVE' | 'PENDING_PAYMENT' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'
export type SubscriptionPaymentStatusValue = 'PENDING' | 'APPROVED' | 'REFUSED' | 'REFUNDED' | 'CHARGEBACK'

export type ClinicAccessReason =
  | 'TRIAL_ACTIVE'
  | 'SUBSCRIPTION_ACTIVE'
  | 'COURTESY_ACTIVE'
  | 'TRIAL_EXPIRED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_LATE'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_BLOCKED'

export interface ClinicAccessResult {
  allowed: boolean
  reason: ClinicAccessReason
  trialDaysRemaining?: number
  currentPeriodEndsAt?: Date | null
  redirectTo?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

// Transições de status válidas — usado pelo webhook para ignorar eventos que
// tentariam regredir uma assinatura de forma inconsistente.
export const VALID_SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatusValue, SubscriptionStatusValue[]> = {
  TRIAL: ['ACTIVE', 'PENDING_PAYMENT', 'BLOCKED'],
  ACTIVE: ['ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE', 'CANCELED', 'BLOCKED'],
  PENDING_PAYMENT: ['ACTIVE', 'PENDING_PAYMENT', 'PAST_DUE', 'BLOCKED'],
  PAST_DUE: ['ACTIVE', 'PENDING_PAYMENT', 'CANCELED', 'BLOCKED'],
  CANCELED: ['ACTIVE', 'PENDING_PAYMENT', 'BLOCKED'],
  BLOCKED: ['ACTIVE', 'PENDING_PAYMENT'],
}

export function isValidTransition(from: SubscriptionStatusValue, to: SubscriptionStatusValue): boolean {
  return VALID_SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false
}

// Fim efetivo do período pago, já com a tolerância (gracePeriodDays) que
// cobre o atraso entre a cobrança da renovação na Kiwify e a chegada do webhook.
function paidUntilWithGrace(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + CLINIC_PRO_SUBSCRIPTION.gracePeriodDays * DAY_MS)
}

export function calculateClinicAccess(
  subscription: Pick<DoctorSubscription, 'status' | 'trialEndsAt' | 'currentPeriodEndsAt'> | null,
  now: Date = new Date()
): ClinicAccessResult {
  if (!subscription) {
    return { allowed: false, reason: 'TRIAL_EXPIRED', redirectTo: '/configuracoes/assinatura' }
  }

  const status = subscription.status as SubscriptionStatusValue

  if (status === 'TRIAL' && subscription.trialEndsAt > now) {
    const msRemaining = subscription.trialEndsAt.getTime() - now.getTime()
    return {
      allowed: true,
      reason: 'TRIAL_ACTIVE',
      trialDaysRemaining: Math.max(0, Math.ceil(msRemaining / DAY_MS)),
    }
  }

  if (status === 'ACTIVE') {
    // Cortesia/grandfathering: liberado pelo admin sem data de expiração
    // (ver routes/admin.ts e scripts/backfill-subscriptions.ts).
    if (!subscription.currentPeriodEndsAt) {
      return { allowed: true, reason: 'COURTESY_ACTIVE' }
    }
    if (paidUntilWithGrace(subscription.currentPeriodEndsAt) > now) {
      return { allowed: true, reason: 'SUBSCRIPTION_ACTIVE', currentPeriodEndsAt: subscription.currentPeriodEndsAt }
    }
    // Período pago venceu e nenhuma renovação chegou.
    return { allowed: false, reason: 'PAYMENT_LATE', currentPeriodEndsAt: subscription.currentPeriodEndsAt, redirectTo: '/configuracoes/assinatura' }
  }

  // Cancelou na Kiwify, mas já pagou o mês corrente: mantém até o fim dele.
  if (status === 'CANCELED' && subscription.currentPeriodEndsAt && subscription.currentPeriodEndsAt > now) {
    return { allowed: true, reason: 'SUBSCRIPTION_ACTIVE', currentPeriodEndsAt: subscription.currentPeriodEndsAt }
  }

  if (status === 'PENDING_PAYMENT') {
    return { allowed: false, reason: 'PAYMENT_PENDING', redirectTo: '/configuracoes/assinatura' }
  }

  if (status === 'PAST_DUE') {
    return { allowed: false, reason: 'PAYMENT_LATE', redirectTo: '/configuracoes/assinatura' }
  }

  if (status === 'CANCELED') {
    return { allowed: false, reason: 'SUBSCRIPTION_CANCELED', redirectTo: '/configuracoes/assinatura' }
  }

  // BLOCKED vindo do fim do trial (watchdog) continua sendo "trial expirado"
  // pro usuário — só é "bloqueado" quando nunca houve pagamento e o trial não
  // venceu (bloqueio manual do admin, reembolso, chargeback).
  if (status === 'BLOCKED' && subscription.trialEndsAt > now) {
    return { allowed: false, reason: 'SUBSCRIPTION_BLOCKED', redirectTo: '/configuracoes/assinatura' }
  }
  if (status === 'BLOCKED' && subscription.currentPeriodEndsAt) {
    return { allowed: false, reason: 'SUBSCRIPTION_BLOCKED', redirectTo: '/configuracoes/assinatura' }
  }

  return { allowed: false, reason: 'TRIAL_EXPIRED', redirectTo: '/configuracoes/assinatura' }
}

// Status "de exibição", sempre coerente com o acesso calculado em tempo real
// (o status gravado no banco pode estar até 1h atrasado em relação ao
// watchdog, ex.: TRIAL já vencido ainda gravado como TRIAL).
export type DisplayStatus =
  | 'TRIAL'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE'
  | 'COURTESY'
  | 'CANCELED_ACTIVE'
  | 'PENDING_PAYMENT'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'BLOCKED'

export function getDisplayStatus(
  subscription: Pick<DoctorSubscription, 'status' | 'trialEndsAt' | 'currentPeriodEndsAt'> | null,
  access: ClinicAccessResult
): DisplayStatus {
  if (!subscription) return 'TRIAL_EXPIRED'
  switch (access.reason) {
    case 'TRIAL_ACTIVE': return 'TRIAL'
    case 'COURTESY_ACTIVE': return 'COURTESY'
    case 'SUBSCRIPTION_ACTIVE': return subscription.status === 'CANCELED' ? 'CANCELED_ACTIVE' : 'ACTIVE'
    case 'PAYMENT_PENDING': return 'PENDING_PAYMENT'
    case 'PAYMENT_LATE': return 'PAST_DUE'
    case 'SUBSCRIPTION_CANCELED': return 'CANCELED'
    case 'SUBSCRIPTION_BLOCKED': return 'BLOCKED'
    default: return 'TRIAL_EXPIRED'
  }
}

export function buildTrialWindow(from: Date = new Date()): { trialStartedAt: Date; trialEndsAt: Date } {
  return { trialStartedAt: from, trialEndsAt: new Date(from.getTime() + CLINIC_PRO_SUBSCRIPTION.trialDays * DAY_MS) }
}

// Cria a assinatura TRIAL (CLINIC_PRO_TRIAL_DAYS, padrão 3 dias) — chamado na
// mesma transação do cadastro (auth.ts), na criação de médico pelo admin
// (users.ts) e pelo watchdog para qualquer médico que ainda esteja sem linha.
export async function ensureTrialSubscription(
  doctorId: string,
  tx: Pick<typeof prisma, 'doctorSubscription'> = prisma
): Promise<boolean> {
  const existing = await tx.doctorSubscription.findUnique({ where: { doctorId } })
  if (existing) return false

  await tx.doctorSubscription.create({
    data: { doctorId, status: 'TRIAL', ...buildTrialWindow() },
  })

  await logAudit({ userId: doctorId, action: 'TRIAL_CREATED', description: `Teste grátis de ${CLINIC_PRO_SUBSCRIPTION.trialDays} dias iniciado` })
  return true
}

// Garante que todo médico ativo tenha uma linha de assinatura — contas
// criadas antes da Kiwify ou por caminhos que não chamavam ensureTrial
// apareciam como "Bloqueada" sem nunca terem tido teste grátis.
export async function ensureAllDoctorsHaveSubscription(): Promise<number> {
  const missing = await prisma.user.findMany({
    where: { role: 'DOCTOR', active: true, subscription: { is: null } },
    select: { id: true },
  })
  let created = 0
  for (const doctor of missing) {
    try {
      if (await ensureTrialSubscription(doctor.id)) created++
    } catch (err) {
      console.error(`[SUBSCRIPTION] Falha ao criar trial para ${doctor.id}:`, err)
    }
  }
  return created
}

// Job periódico: mantém o status gravado coerente com o acesso real (telas
// administrativas leem o banco). calculateClinicAccess já bloqueia em tempo
// real por conta própria.
let expiryWatchdogInterval: NodeJS.Timeout | null = null

export async function runSubscriptionMaintenance(): Promise<void> {
  const now = new Date()

  const created = await ensureAllDoctorsHaveSubscription()
  if (created > 0) console.log(`[SUBSCRIPTION_WATCHDOG] ${created} médico(s) sem assinatura receberam teste grátis`)

  const expiredTrials = await prisma.doctorSubscription.findMany({
    where: { status: 'TRIAL', trialEndsAt: { lt: now } },
    select: { id: true, doctorId: true },
  })
  for (const sub of expiredTrials) {
    await prisma.doctorSubscription.update({ where: { id: sub.id }, data: { status: 'BLOCKED', blockedAt: now } })
    await logAudit({ userId: sub.doctorId, action: 'TRIAL_EXPIRED', description: 'Período de teste grátis encerrado' })
  }

  // Período pago vencido (+ tolerância) sem webhook de renovação.
  const overdueLimit = new Date(now.getTime() - CLINIC_PRO_SUBSCRIPTION.gracePeriodDays * DAY_MS)
  const overdue = await prisma.doctorSubscription.findMany({
    where: { status: 'ACTIVE', currentPeriodEndsAt: { not: null, lt: overdueLimit } },
    select: { id: true, doctorId: true },
  })
  for (const sub of overdue) {
    await prisma.doctorSubscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } })
    await logAudit({ userId: sub.doctorId, action: 'SUBSCRIPTION_PAST_DUE', description: 'Período pago venceu sem confirmação de renovação' })
  }
}

export function startSubscriptionExpiryWatchdog(): void {
  if (expiryWatchdogInterval) return

  const INTERVAL_MS = 60 * 60 * 1000 // 1 hora

  const run = () => runSubscriptionMaintenance().catch(err =>
    console.error('[SUBSCRIPTION_WATCHDOG] Erro na manutenção de assinaturas:', err)
  )

  expiryWatchdogInterval = setInterval(run, INTERVAL_MS)
  run()

  console.log('[SUBSCRIPTION_WATCHDOG] Verificação de assinaturas iniciada')
}
