import type { IntegrationType } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logAudit } from '../../lib/secretaryAccess'
import { isValidTransition, calculateClinicAccess, ensureTrialSubscription, type SubscriptionStatusValue } from '../../lib/subscription-access'
import { CLINIC_PRO_SUBSCRIPTION } from '../../lib/billing-config'
import type { NormalizedBillingEvent } from './kiwify.types'

export async function processIntegrationAddonWebhookEvent(
  event: NormalizedBillingEvent,
  addonType: string,
  eventKey: string
): Promise<ProcessWebhookResult> {
  const existing = await prisma.kiwifyWebhookEvent.findUnique({ where: { eventKey } })
  if (existing?.processingStatus === 'PROCESSED') {
    return { received: true, duplicated: true }
  }

  const webhookRecord = existing
    ? await prisma.kiwifyWebhookEvent.update({
        where: { eventKey },
        data: { attempts: { increment: 1 } },
      })
    : await prisma.kiwifyWebhookEvent.create({
        data: {
          eventKey,
          eventType: event.eventType,
          kiwifyOrderId: event.providerOrderId || null,
          payload: event.rawPayload as object,
        },
      })

  if (event.eventType === 'UNKNOWN' || !event.providerOrderId) {
    await prisma.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'IGNORED', processedAt: new Date(), errorMessage: 'Evento não mapeado ou sem order_id' },
    })
    return { received: true, ignored: 'unmapped_event' }
  }

  const doctorId = event.doctorId
  if (!doctorId) {
    await prisma.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'IGNORED', processedAt: new Date(), errorMessage: 'Sem doctorId (TrackingParameters.s1) no payload' },
    })
    return { received: true, ignored: 'missing_doctor_id' }
  }

  const addon = await prisma.integrationAddon.findUnique({ where: { doctorId_type: { doctorId, type: addonType as IntegrationType } } })
  if (!addon) {
    await prisma.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'IGNORED', processedAt: new Date(), errorMessage: `Add-on não encontrado para doctorId=${doctorId} type=${addonType}` },
    })
    return { received: true, ignored: 'addon_not_found' }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    switch (event.eventType) {
      case 'PAYMENT_APPROVED':
      case 'SUBSCRIPTION_RENEWED': {
        await tx.integrationAddon.update({
          where: { id: addon.id },
          data: {
            status: 'ACTIVE',
            lastPaymentAt: now,
            currentPeriodEndsAt: addOneMonth(now),
            lastKiwifyOrderId: event.providerOrderId,
            kiwifySubscriptionId: event.providerSubscriptionId ?? addon.kiwifySubscriptionId,
            canceledAt: null,
          },
        })
        await logAudit({ userId: doctorId, action: 'INTEGRATION_ADDON_ACTIVATED', description: `${addonType} — pedido ${event.providerOrderId}` })
        break
      }

      case 'PAYMENT_LATE': {
        await tx.integrationAddon.update({ where: { id: addon.id }, data: { status: 'PAST_DUE' } })
        await logAudit({ userId: doctorId, action: 'INTEGRATION_ADDON_PAST_DUE', description: `${addonType} — pedido ${event.providerOrderId}` })
        break
      }

      case 'SUBSCRIPTION_CANCELED': {
        await tx.integrationAddon.update({ where: { id: addon.id }, data: { status: 'CANCELED', canceledAt: now } })
        await logAudit({ userId: doctorId, action: 'INTEGRATION_ADDON_CANCELED', description: `${addonType} — pedido ${event.providerOrderId}` })
        break
      }

      case 'PAYMENT_REFUNDED':
      case 'CHARGEBACK': {
        await tx.integrationAddon.update({ where: { id: addon.id }, data: { status: 'BLOCKED' } })
        await logAudit({ userId: doctorId, action: 'INTEGRATION_ADDON_BLOCKED', description: `${addonType} — pedido ${event.providerOrderId}` })
        break
      }

      // PAYMENT_REFUSED / PAYMENT_PENDING: mantém PENDING_PAYMENT já setado no
      // checkout, nada a atualizar além de marcar o webhook como processado.
    }

    await tx.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'PROCESSED', processedAt: now },
    })
  })

  return { received: true }
}

function addOneMonth(from: Date): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + 1)
  return d
}

// Fim do período pago: usa a próxima cobrança informada pela Kiwify quando
// existir e for coerente (entre 1 e 40 dias à frente); senão, +1 mês.
function resolvePeriodEnd(event: NormalizedBillingEvent, now: Date): Date {
  const next = event.nextPaymentAt
  if (next) {
    const diffDays = (next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    if (diffDays >= 1 && diffDays <= 40) return next
  }
  return addOneMonth(now)
}

export interface ProcessWebhookResult {
  received: true
  duplicated?: boolean
  ignored?: string
  doctorId?: string
}

// Descobre de qual médico é o pagamento, nesta ordem:
// 1) s1 (doctorId) dos parâmetros de rastreamento do checkout gerado pela
//    Clinic Pro — validado contra o banco;
// 2) ID da assinatura recorrente na Kiwify já vinculado a um médico
//    (renovações podem não repetir os parâmetros de rastreamento);
// 3) e-mail do comprador igual ao e-mail de login de um médico (link de
//    checkout aberto fora do sistema).
async function resolveDoctorId(event: NormalizedBillingEvent): Promise<{ doctorId: string; via: string } | null> {
  if (event.doctorId) {
    const doctor = await prisma.user.findFirst({ where: { id: event.doctorId, role: 'DOCTOR' }, select: { id: true } })
    if (doctor) return { doctorId: doctor.id, via: 's1' }
  }

  if (event.providerSubscriptionId) {
    const sub = await prisma.doctorSubscription.findFirst({
      where: { kiwifySubscriptionId: event.providerSubscriptionId },
      select: { doctorId: true },
    })
    if (sub) return { doctorId: sub.doctorId, via: 'subscription_id' }
  }

  if (event.customerEmail) {
    const doctor = await prisma.user.findFirst({
      where: { email: { equals: event.customerEmail, mode: 'insensitive' }, role: 'DOCTOR' },
      select: { id: true },
    })
    if (doctor) return { doctorId: doctor.id, via: 'email' }
  }

  return null
}

// Processa um evento normalizado da Kiwify com idempotência (chave única na
// tabela TBLWEBHOOKKIWIFY) e transição de estado validada. Retorna sempre
// "received: true" mesmo em duplicidade/ignorado — o endpoint HTTP responde
// 200 nesses casos pra Kiwify não ficar reenviando o mesmo evento.
// `forcedDoctorId` é usado pelo admin pra vincular manualmente um pagamento
// que chegou sem identificação (Admin > Integrações > webhooks recebidos).
export async function processKiwifyWebhookEvent(
  event: NormalizedBillingEvent,
  eventKey: string,
  forcedDoctorId?: string
): Promise<ProcessWebhookResult> {
  const existing = await prisma.kiwifyWebhookEvent.findUnique({ where: { eventKey } })
  if (existing?.processingStatus === 'PROCESSED') {
    return { received: true, duplicated: true }
  }

  const webhookRecord = existing
    ? await prisma.kiwifyWebhookEvent.update({
        where: { eventKey },
        data: { attempts: { increment: 1 }, eventType: event.eventType },
      })
    : await prisma.kiwifyWebhookEvent.create({
        data: {
          eventKey,
          eventType: event.eventType,
          kiwifyOrderId: event.providerOrderId || null,
          payload: event.rawPayload as object,
          attempts: 1,
        },
      })

  const ignore = async (reason: string, message: string): Promise<ProcessWebhookResult> => {
    await prisma.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'IGNORED', processedAt: new Date(), errorMessage: message },
    })
    return { received: true, ignored: reason }
  }

  if (event.eventType === 'UNKNOWN' || !event.providerOrderId) {
    return ignore('unmapped_event', `Evento não tratado (${event.rawEventName || 'sem tipo'})${event.providerOrderId ? '' : ' ou sem order_id'}`)
  }

  const resolved = forcedDoctorId
    ? { doctorId: forcedDoctorId, via: 'admin' }
    : await resolveDoctorId(event)

  if (!resolved) {
    return ignore(
      'doctor_not_found',
      `Médico não identificado (s1=${event.doctorId ?? '—'}, assinatura=${event.providerSubscriptionId ?? '—'}, e-mail=${event.customerEmail ?? '—'}) — vincule manualmente`
    )
  }

  const doctorId = resolved.doctorId
  await ensureTrialSubscription(doctorId)
  const subscription = await prisma.doctorSubscription.findUnique({ where: { doctorId } })
  if (!subscription) {
    return ignore('subscription_not_found', `Assinatura não encontrada para doctorId=${doctorId}`)
  }

  // Evento fora de ordem: se o evento for mais antigo que a última atualização
  // registrada, não deixa ele regredir uma assinatura já mais atual.
  if (subscription.lastPaymentAt && event.eventDate < subscription.lastPaymentAt && event.eventType === 'PAYMENT_APPROVED') {
    await prisma.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processingStatus: 'IGNORED', processedAt: new Date(), errorMessage: 'Evento mais antigo que o último pagamento registrado' },
    })
    return { received: true, ignored: 'stale_event' }
  }

  const currentStatus = subscription.status as SubscriptionStatusValue
  const now = new Date()
  let transitionSkipped = false

  await prisma.$transaction(async (tx) => {
    switch (event.eventType) {
      case 'PAYMENT_APPROVED':
      case 'SUBSCRIPTION_RENEWED': {
        if (!isValidTransition(currentStatus, 'ACTIVE')) { transitionSkipped = true; break }

        await tx.subscriptionPayment.upsert({
          where: { kiwifyOrderId: event.providerOrderId },
          create: {
            doctorId,
            subscriptionId: subscription.id,
            kiwifyOrderId: event.providerOrderId,
            status: 'APPROVED',
            amountCents: event.amountCents ?? CLINIC_PRO_SUBSCRIPTION.monthlyPriceCents,
            paymentMethod: paymentMethodOf(event),
            approvedAt: now,
          },
          update: { status: 'APPROVED', approvedAt: now, paymentMethod: paymentMethodOf(event) },
        })

        await tx.doctorSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            lastPaymentAt: now,
            currentPeriodStartedAt: now,
            currentPeriodEndsAt: resolvePeriodEnd(event, now),
            lastKiwifyOrderId: event.providerOrderId,
            kiwifySubscriptionId: event.providerSubscriptionId ?? subscription.kiwifySubscriptionId,
            kiwifyCustomerId: event.customerEmail ?? subscription.kiwifyCustomerId,
            blockedAt: null,
            canceledAt: null,
            // Pagamento real substitui qualquer liberação manual anterior.
            adminNote: null,
          },
        })

        await logAudit({ userId: doctorId, action: event.eventType === 'PAYMENT_APPROVED' ? 'SUBSCRIPTION_ACTIVATED' : 'SUBSCRIPTION_RENEWED', description: `Pedido ${event.providerOrderId} (identificado via ${resolved.via})` })
        break
      }

      case 'PAYMENT_LATE': {
        if (!isValidTransition(currentStatus, 'PAST_DUE')) { transitionSkipped = true; break }
        await tx.doctorSubscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
        await logAudit({ userId: doctorId, action: 'SUBSCRIPTION_PAST_DUE', description: `Pedido ${event.providerOrderId}` })
        break
      }

      case 'SUBSCRIPTION_CANCELED': {
        if (!isValidTransition(currentStatus, 'CANCELED')) { transitionSkipped = true; break }
        await tx.doctorSubscription.update({ where: { id: subscription.id }, data: { status: 'CANCELED', canceledAt: now } })
        await logAudit({ userId: doctorId, action: 'SUBSCRIPTION_CANCELED', description: `Pedido ${event.providerOrderId}` })
        break
      }

      case 'PAYMENT_REFUNDED': {
        if (!isValidTransition(currentStatus, 'BLOCKED')) { transitionSkipped = true; break }
        await tx.subscriptionPayment.updateMany({ where: { kiwifyOrderId: event.providerOrderId }, data: { status: 'REFUNDED', refundedAt: now } })
        await tx.doctorSubscription.update({ where: { id: subscription.id }, data: { status: 'BLOCKED', blockedAt: now } })
        await logAudit({ userId: doctorId, action: 'PAYMENT_REFUNDED', description: `Pedido ${event.providerOrderId}` })
        break
      }

      case 'CHARGEBACK': {
        if (!isValidTransition(currentStatus, 'BLOCKED')) { transitionSkipped = true; break }
        await tx.subscriptionPayment.updateMany({ where: { kiwifyOrderId: event.providerOrderId }, data: { status: 'CHARGEBACK' } })
        await tx.doctorSubscription.update({ where: { id: subscription.id }, data: { status: 'BLOCKED', blockedAt: now } })
        await logAudit({ userId: doctorId, action: 'PAYMENT_CHARGEBACK', description: `Pedido ${event.providerOrderId}` })
        break
      }

      case 'PAYMENT_REFUSED': {
        await tx.subscriptionPayment.upsert({
          where: { kiwifyOrderId: event.providerOrderId },
          create: { doctorId, subscriptionId: subscription.id, kiwifyOrderId: event.providerOrderId, status: 'REFUSED', amountCents: event.amountCents ?? CLINIC_PRO_SUBSCRIPTION.monthlyPriceCents },
          update: { status: 'REFUSED' },
        })
        await logAudit({ userId: doctorId, action: 'PAYMENT_REFUSED', description: `Pedido ${event.providerOrderId}` })
        break
      }

      case 'PAYMENT_PENDING': {
        await tx.subscriptionPayment.upsert({
          where: { kiwifyOrderId: event.providerOrderId },
          create: { doctorId, subscriptionId: subscription.id, kiwifyOrderId: event.providerOrderId, status: 'PENDING', amountCents: event.amountCents ?? CLINIC_PRO_SUBSCRIPTION.monthlyPriceCents },
          update: { status: 'PENDING' },
        })

        // Pix/boleto gerado mas ainda não confirmado. Só rebaixa o status pra
        // PENDING_PAYMENT se o tenant já não tiver acesso garantido por outro
        // motivo agora mesmo (trial ou período pago ainda vigentes) — usa o
        // cálculo em tempo real, não o rótulo (possivelmente desatualizado)
        // gravado no banco.
        const currentlyAllowed = calculateClinicAccess(subscription, now).allowed
        if (!currentlyAllowed && isValidTransition(currentStatus, 'PENDING_PAYMENT')) {
          await tx.doctorSubscription.update({ where: { id: subscription.id }, data: { status: 'PENDING_PAYMENT' } })
        }
        break
      }
    }

    if (event.checkoutAttemptId) {
      await tx.subscriptionCheckoutAttempt.updateMany({
        where: { id: event.checkoutAttemptId, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', completedAt: now },
      }).catch(() => undefined)
    }

    await tx.kiwifyWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: 'PROCESSED',
        processedAt: now,
        errorMessage: transitionSkipped
          ? `Sem efeito: transição ${currentStatus} → ${event.eventType} não permitida`
          : `Médico ${doctorId} (via ${resolved.via})`,
      },
    })
  })

  return { received: true, doctorId }
}

function paymentMethodOf(event: NormalizedBillingEvent): string | null {
  const method = (event.rawPayload as { payment_method?: unknown } | null)?.payment_method
  return typeof method === 'string' ? method : null
}
