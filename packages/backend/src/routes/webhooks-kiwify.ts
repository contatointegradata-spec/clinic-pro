import { Router, Request } from 'express'
import crypto from 'crypto'
import { verifyKiwifyWebhookSignature } from '../integrations/kiwify/kiwify.client'
import { mapKiwifyWebhook } from '../integrations/kiwify/kiwify.mapper'
import { processKiwifyWebhookEvent, processIntegrationAddonWebhookEvent } from '../integrations/kiwify/kiwify.service'
import { KIWIFY_WEBHOOK_ENABLED, resolveIntegrationAddonType } from '../lib/billing-config'
import { getResolvedKiwifyConfig } from '../lib/kiwify-config'
import { prisma } from '../lib/prisma'

interface RequestWithRawBody extends Request {
  rawBody?: Buffer
}

const router = Router()

// Guarda no histórico (Admin > Integrações > webhooks recebidos) os eventos
// recusados antes do processamento, pra quem configura enxergar o motivo.
async function recordRejectedEvent(payload: unknown, reason: string, status: 'REJECTED' | 'IGNORED' = 'REJECTED'): Promise<void> {
  try {
    const body = (payload ?? {}) as { order_id?: unknown; webhook_event_type?: unknown; order_status?: unknown }
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')
    await prisma.kiwifyWebhookEvent.upsert({
      where: { eventKey: `kiwify:${status.toLowerCase()}:${hash}` },
      create: {
        eventKey: `kiwify:${status.toLowerCase()}:${hash}`,
        eventType: String(body.webhook_event_type ?? body.order_status ?? 'desconhecido'),
        kiwifyOrderId: typeof body.order_id === 'string' ? body.order_id : null,
        payload: (payload ?? {}) as object,
        processingStatus: status,
        processedAt: new Date(),
        errorMessage: reason,
        attempts: 1,
      },
      update: { attempts: { increment: 1 }, errorMessage: reason },
    })
  } catch (err) {
    console.error('[KIWIFY_WEBHOOK] Falha ao registrar evento recusado:', err)
  }
}

// POST /api/webhooks/kiwify — endpoint público, sem authenticate(). A
// validação é o segredo do webhook, não sessão de usuário.
router.post('/', async (req: RequestWithRawBody, res) => {
  // KIWIFY_WEBHOOK_ENABLED é um kill-switch de operação (env, precisa
  // redeploy); config.enabled é o toggle do admin em Admin > Integrações
  // (runtime, via banco). Os dois precisam estar ligados.
  if (!KIWIFY_WEBHOOK_ENABLED) {
    res.status(503).json({ message: 'Webhook desabilitado' })
    return
  }

  const config = await getResolvedKiwifyConfig()
  if (!config.enabled) {
    res.status(503).json({ message: 'Integração Kiwify desativada em Admin > Integrações' })
    return
  }

  const payload = req.body ?? {}
  const secret = config.webhookSecret
  if (!secret) {
    console.error('[KIWIFY_WEBHOOK] Token do webhook não configurado — recusando evento')
    await recordRejectedEvent(payload, 'Token do webhook não configurado em Admin > Integrações')
    res.status(401).json({ message: 'Webhook não configurado' })
    return
  }

  const querySignature = typeof req.query.signature === 'string' ? req.query.signature : undefined
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined

  const isValid = verifyKiwifyWebhookSignature({
    rawBody: req.rawBody,
    parsedBody: req.body,
    headerSignature: req.get('x-kiwify-signature') || undefined,
    querySignature,
    queryToken,
    secret,
  })

  if (!isValid) {
    console.error('[KIWIFY_WEBHOOK] Assinatura inválida')
    await recordRejectedEvent(
      payload,
      querySignature || queryToken
        ? 'Assinatura inválida — o token salvo em Admin > Integrações não é o mesmo do webhook na Kiwify'
        : 'Requisição sem assinatura (?signature=) — não veio da Kiwify'
    )
    res.status(401).json({ message: 'Assinatura inválida' })
    return
  }

  const productId = config.productId

  try {
    const event = mapKiwifyWebhook(payload)

    // Add-ons de integração usam produtos Kiwify próprios (um por tipo),
    // separados do produto único da assinatura principal — checa isso antes
    // da validação de produto abaixo, que é específica da assinatura.
    const addonType = event.providerProductId ? resolveIntegrationAddonType(event.providerProductId) : null
    if (addonType) {
      const addonEventKey = event.providerOrderId
        ? `kiwify:addon:${addonType}:${event.eventType}:${event.providerOrderId}:${event.eventDate.toISOString()}`
        : `kiwify:addon:${addonType}:unknown:${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`

      const addonResult = await processIntegrationAddonWebhookEvent(event, addonType, addonEventKey)
      res.status(200).json(addonResult)
      return
    }

    // Validação de produto: se KIWIFY_PRODUCT_ID estiver configurado, ignora
    // pagamentos de qualquer outro produto da mesma conta Kiwify.
    if (productId && event.providerProductId && event.providerProductId !== productId) {
      await recordRejectedEvent(payload, `Produto ${event.providerProductId} diferente do configurado (${productId})`, 'IGNORED')
      res.status(200).json({ received: true, ignored: 'product_mismatch' })
      return
    }

    const eventKey = event.providerOrderId
      ? `kiwify:${event.eventType}:${event.providerOrderId}:${event.eventDate.toISOString()}`
      : `kiwify:unknown:${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`

    const result = await processKiwifyWebhookEvent(event, eventKey)
    res.status(200).json(result)
  } catch (error) {
    console.error('[KIWIFY_WEBHOOK] Erro ao processar evento:', error)
    // Ainda assim responde 200 pra Kiwify não entrar em loop de retry agressivo
    // sobre um payload que provavelmente vai falhar de novo; o erro fica no log.
    res.status(200).json({ received: true, error: 'processing_failed' })
  }
})

export default router
