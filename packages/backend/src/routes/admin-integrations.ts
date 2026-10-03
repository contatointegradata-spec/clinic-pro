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
      },
    })
    res.json(events)
  } catch (error) {
    console.error('[admin/integrations/kiwify events] erro:', error)
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

// Testa os dois formatos de chamada que o Agente de IA realmente usa:
// 1) simples (sem prompt de sistema/tools) — igual "Gerar e Ativar Prompt
//    Personalizado"; 2) com prompt de sistema + tools — igual o atendimento
// de verdade no WhatsApp (check_availability/create_appointment). Testar só
// o formato (1) não pega problema que só aparece no formato (2).
router.post('/ai/test', async (_req: AuthRequest, res) => {
  const result: { basic?: string; withToolsAndSystem?: string } = {}
  let success = true

  try {
    const basic = await geminiChatCompletion([{ role: 'user', content: 'Responda apenas "ok".' }])
    result.basic = basic.content?.trim() || '(sem texto)'
  } catch (error) {
    success = false
    result.basic = `ERRO: ${describeAiTestError(error)}`
  }

  try {
    const withTools = await geminiChatCompletion(
      [
        { role: 'system', content: 'Você é um assistente de teste. Nunca chame nenhuma ferramenta — apenas responda com texto.' },
        { role: 'user', content: 'Responda apenas "ok".' },
      ],
      [{
        type: 'function',
        function: {
          name: 'ferramenta_de_teste',
          description: 'Ferramenta só pra validar que a IA aceita o formato de tools — não deve ser chamada.',
          parameters: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
        },
      }],
      0.4,
    )
    result.withToolsAndSystem = withTools.content?.trim() || (withTools.tool_calls ? '(a IA chamou a ferramenta de teste)' : '(sem texto)')
  } catch (error) {
    success = false
    result.withToolsAndSystem = `ERRO: ${describeAiTestError(error)}`
  }

  if (!success) console.error('[admin/integrations/ai/test] falha:', result)

  const message = success
    ? `Conexão OK nos dois formatos — chamada simples: "${result.basic}" · com prompt de sistema e tools: "${result.withToolsAndSystem}"`
    : `Chamada simples: ${result.basic} · Com prompt de sistema e tools: ${result.withToolsAndSystem}`

  res.json({ success, message })
})

export default router
