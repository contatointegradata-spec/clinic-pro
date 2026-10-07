import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import {
  getKiwifyConfigView,
  updateKiwifyConfig,
  regenerateWebhookSecret,
  getWebhookSecretPlain,
} from '../lib/kiwify-config'
import { getAiConfigView, updateAiConfig } from '../lib/ai-integration-config'
import { mapKiwifyWebhook } from '../integrations/kiwify/kiwify.mapper'
import { processKiwifyWebhookEvent } from '../integrations/kiwify/kiwify.service'
import type { KiwifyWebhookPayload } from '../integrations/kiwify/kiwify.types'
import { logAudit } from '../lib/secretaryAccess'
import { geminiChatCompletion } from '../lib/gemini-client'
import { AiProviderError } from '../lib/ai-client-types'

const router = Router()
router.use(authenticate)
router.use(requireRole('ADMIN'))

// GET /api/admin/integrations/kiwify — status atual da integração (segredos mascarados)
router.get('/kiwify', async (_req: AuthRequest, res) => {
  try {
    const view = await getKiwifyConfigView()
    res.json(view)
  } catch (error) {
    console.error('[admin/integrations/kiwify] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  checkoutUrl: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().trim().max(500).url('URL inválida').nullable().optional()
  ),
  productId: z.string().trim().max(200).nullable().optional(),
  accountId: z.string().trim().max(200).nullable().optional(),
  clientId: z.string().trim().max(200).nullable().optional(),
  clientSecret: z.string().trim().max(500).nullable().optional(),
  // Token gerado pela Kiwify no cadastro do webhook (campo "Token").
  webhookSecret: z.string().trim().max(200).nullable().optional(),
  enforceSubscription: z.boolean().optional(),
})

// PUT /api/admin/integrations/kiwify — atualiza checkout/produto/credenciais/toggle
router.put('/kiwify', async (req: AuthRequest, res) => {
  try {
    const input = updateSchema.parse(req.body)
    const view = await updateKiwifyConfig(input, req.user!.userId)
    res.json(view)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    console.error('[admin/integrations/kiwify PUT] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// POST /api/admin/integrations/kiwify/webhook-secret/regenerate — gera novo
// segredo e devolve em texto puro (única vez) pro admin colar no painel Kiwify
router.post('/kiwify/webhook-secret/regenerate', async (req: AuthRequest, res) => {
  try {
    const webhookSecret = await regenerateWebhookSecret(req.user!.userId)
    res.json({ webhookSecret })
  } catch (error) {
    console.error('[admin/integrations/kiwify regenerate] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/integrations/kiwify/webhook-secret — revela o segredo atual (auditado)
router.get('/kiwify/webhook-secret', async (req: AuthRequest, res) => {
  try {
    const webhookSecret = await getWebhookSecretPlain(req.user!.userId)
    if (!webhookSecret) {
      res.status(404).json({ message: 'Nenhum segredo gerado ainda' })
      return
    }
    res.json({ webhookSecret })
  } catch (error) {
    console.error('[admin/integrations/kiwify secret] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/integrations/kiwify/events — últimos webhooks recebidos (auditoria/debug)
router.get('/kiwify/events', async (req: AuthRequest, res) => {
  try {
    const take = Math.min(Math.max(Number(req.query.take) || 20, 1), 100)
    const events = await prisma.kiwifyWebhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take,
      select: {
        id: true,
        eventType: true,
        kiwifyOrderId: true,
        processingStatus: true,
        receivedAt: true,
        processedAt: true,
        errorMessage: true,
        attempts: true,
        payload: true,
      },
    })
    res.json(events.map(({ payload, ...ev }) => {
      const p = (payload ?? {}) as { Customer?: { email?: string; full_name?: string }; webhook_event_type?: string }
      return { ...ev, rawEventName: p.webhook_event_type ?? null, customerEmail: p.Customer?.email ?? null, customerName: p.Customer?.full_name ?? null }
    }))
  } catch (error) {
    console.error('[admin/integrations/kiwify events] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const assignSchema = z.object({ doctorId: z.string().min(1) })

// POST /api/admin/integrations/kiwify/events/:id/assign — vincula manualmente
// a um médico um pagamento que chegou sem identificação (ex.: comprou com
// outro e-mail, por um link aberto fora do sistema) e processa o evento.
router.post('/kiwify/events/:id/assign', async (req: AuthRequest, res) => {
  try {
    const { doctorId } = assignSchema.parse(req.body)
    const record = await prisma.kiwifyWebhookEvent.findUnique({ where: { id: req.params.id } })
    if (!record) {
      res.status(404).json({ message: 'Evento não encontrado' })
      return
    }
    if (record.processingStatus === 'PROCESSED') {
      res.status(409).json({ message: 'Este evento já foi processado' })
      return
    }
    if (record.processingStatus === 'REJECTED') {
      res.status(409).json({ message: 'Evento recusado por assinatura inválida não pode ser vinculado — corrija o token e reenvie pela Kiwify' })
      return
    }
    const doctor = await prisma.user.findFirst({ where: { id: doctorId, role: 'DOCTOR' }, select: { id: true, email: true } })
    if (!doctor) {
      res.status(404).json({ message: 'Médico não encontrado' })
      return
    }

    const event = mapKiwifyWebhook(record.payload as KiwifyWebhookPayload)
    const result = await processKiwifyWebhookEvent(event, record.eventKey, doctor.id)

    await logAudit({
      userId: req.user!.userId,
      action: 'KIWIFY_EVENT_ASSIGNED',
      description: `Admin vinculou o pedido ${record.kiwifyOrderId ?? record.id} a ${doctor.email}`,
    })

    const updated = await prisma.kiwifyWebhookEvent.findUnique({ where: { id: record.id } })
    res.json({ result, event: updated })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    console.error('[admin/integrations/kiwify assign] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/admin/integrations/ai — status atual do motor do Agente de IA (chave mascarada)
router.get('/ai', async (_req: AuthRequest, res) => {
  try {
    const view = await getAiConfigView()
    res.json(view)
  } catch (error) {
    console.error('[admin/integrations/ai] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const updateAiSchema = z.object({
  apiKey: z.string().trim().max(500).nullable().optional(),
  model: z.string().trim().max(100).nullable().optional(),
})

// PUT /api/admin/integrations/ai — atualiza a chave/modelo da IA (hoje Gemini)
router.put('/ai', async (req: AuthRequest, res) => {
  try {
    const input = updateAiSchema.parse(req.body)
    const view = await updateAiConfig(input, req.user!.userId)
    res.json(view)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    console.error('[admin/integrations/ai PUT] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// POST /api/admin/integrations/ai/test — chama a IA de verdade com a config
// salva (chave/modelo) e devolve sucesso ou o erro real, pra quem configura
// não precisar ir até o Agente de IA só pra descobrir se a chave funciona.
function describeAiTestError(error: unknown): string {
  if (error instanceof AiProviderError) {
    return error.status === 'missing_key' ? 'Nenhuma chave configurada.' : error.message
  }
  return error instanceof Error ? error.message : 'Erro inesperado'
}

// Testa os três formatos de chamada que o Agente de IA realmente usa, nessa
// ordem:
// 1) simples (sem prompt de sistema/tools) — igual "Gerar e Ativar Prompt
//    Personalizado";
// 2) com prompt de sistema + tools declaradas, mas sem forçar o uso — só
//    confirma que a Gemini aceita o formato da declaração;
// 3) o ciclo completo de verdade: a IA chama a ferramenta, a gente manda o
//    resultado de volta (functionResponse) e pede a resposta final — isso é
//    exatamente o que handleAiAgentMessage faz no WhatsApp quando o paciente
//    pede um agendamento. Os testes (1) e (2) passarem não garante que (3)
//    funciona — é um request diferente (o 2º turno, com o resultado da
//    ferramenta), e é onde o atendimento real está travando.
const testTool = {
  type: 'function' as const,
  function: {
    name: 'ferramenta_de_teste',
    description: 'Ferramenta de teste — sempre chame com x="teste" quando pedirem.',
    parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  },
}

router.post('/ai/test', async (_req: AuthRequest, res) => {
  const result: { basic?: string; toolsDeclared?: string; toolRoundTrip?: string } = {}
  let success = true

  try {
    const basic = await geminiChatCompletion([{ role: 'user', content: 'Responda apenas "ok".' }])
    result.basic = basic.content?.trim() || '(sem texto)'
  } catch (error) {
    success = false
    result.basic = `ERRO: ${describeAiTestError(error)}`
  }

  try {
    const messages: Parameters<typeof geminiChatCompletion>[0] = [
      { role: 'system', content: 'Você é um assistente de teste com acesso a ferramentas.' },
      { role: 'user', content: 'Chame agora a ferramenta ferramenta_de_teste com x="teste".' },
    ]
    const first = await geminiChatCompletion(messages, [testTool], 0.2)
    result.toolsDeclared = 'OK (chamada aceita)'

    const call = first.tool_calls?.[0]
    if (!call) {
      result.toolRoundTrip = `(a IA não chamou a ferramenta — respondeu texto: "${first.content?.trim() || '(vazio)'}" — não dá pra testar o 2º turno)`
    } else {
      messages.push({ role: 'assistant', content: first.content ?? '', tool_calls: first.tool_calls })
      messages.push({ role: 'tool', tool_call_id: call.id, content: 'ok' })
      const second = await geminiChatCompletion(messages, [testTool], 0.2)
      result.toolRoundTrip = `OK — resposta final: "${second.content?.trim() || '(sem texto)'}"`
    }
  } catch (error) {
    success = false
    const detail = describeAiTestError(error)
    result.toolsDeclared = result.toolsDeclared ?? `ERRO: ${detail}`
    result.toolRoundTrip = result.toolRoundTrip ?? `ERRO: ${detail}`
  }

  if (!success) console.error('[admin/integrations/ai/test] falha:', result)

  const message = [
    `Chamada simples: ${result.basic}`,
    `Declaração de tools: ${result.toolsDeclared}`,
    `Ciclo completo da ferramenta (2º turno): ${result.toolRoundTrip}`,
  ].join(' · ')

  res.json({ success, message })
})

export default router
