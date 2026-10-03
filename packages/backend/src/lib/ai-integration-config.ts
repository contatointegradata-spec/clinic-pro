import { prisma } from './prisma'
import { logAudit } from './secretaryAccess'

const SINGLETON_ID = 'ai-agent'
// gemini-2.5-flash foi descontinuado pra projetos novos — gemini-3.5-flash-lite
// é hoje o modelo mais rápido/barato da linha Gemini com suporte a
// function-calling, adequado pro atendimento curto via WhatsApp deste agente.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export interface ResolvedAiConfig {
  provider: string
  apiKey: string | null
  model: string
}

export interface AiIntegrationConfigView {
  provider: string
  model: string
  hasApiKey: boolean
  apiKeyPreview: string | null
  updatedAt: Date | null
}

// Config efetiva do motor do Agente de IA: valor salvo no banco (editável
// pelo admin em runtime, via menu Admin > Integrações) tem prioridade; as
// variáveis de ambiente GEMINI_* só entram como fallback pra quem ainda
// configura via .env/redeploy. Mesmo padrão de lib/kiwify-config.ts.
export async function getResolvedAiConfig(): Promise<ResolvedAiConfig> {
  const row = await prisma.aiIntegrationConfig.findUnique({ where: { id: SINGLETON_ID } })

  return {
    provider: row?.provider || 'gemini',
    apiKey: row?.apiKey || process.env.GEMINI_API_KEY || null,
    model: row?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  }
}

export async function getAiConfigView(): Promise<AiIntegrationConfigView> {
  const [row, resolved] = await Promise.all([
    prisma.aiIntegrationConfig.findUnique({ where: { id: SINGLETON_ID } }),
    getResolvedAiConfig(),
  ])

  return {
    provider: resolved.provider,
    model: resolved.model,
    hasApiKey: !!resolved.apiKey,
    apiKeyPreview: resolved.apiKey ? `••••${resolved.apiKey.slice(-4)}` : null,
    updatedAt: row?.updatedAt ?? null,
  }
}

export interface UpdateAiConfigInput {
  apiKey?: string | null
  model?: string | null
}

export async function updateAiConfig(input: UpdateAiConfigInput, adminUserId: string): Promise<AiIntegrationConfigView> {
  const data = {
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey || null } : {}),
    ...(input.model !== undefined ? { model: input.model || null } : {}),
    updatedByUserId: adminUserId,
  }

  await prisma.aiIntegrationConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, provider: 'gemini', ...data },
    update: data,
  })

  await logAudit({
    userId: adminUserId,
    action: 'AI_INTEGRATION_UPDATED',
    description: 'Admin atualizou a configuração do motor do Agente de IA',
  })

  return getAiConfigView()
}
