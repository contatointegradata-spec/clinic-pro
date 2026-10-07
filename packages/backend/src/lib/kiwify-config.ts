import crypto from 'crypto'
import { prisma } from './prisma'
import { logAudit } from './secretaryAccess'
import { SUBSCRIPTION_ENFORCEMENT_ENABLED } from './billing-config'

const SINGLETON_ID = 'kiwify'

export interface ResolvedKiwifyConfig {
  enabled: boolean
  checkoutUrl: string | null
  productId: string | null
  accountId: string | null
  clientId: string | null
  clientSecret: string | null
  webhookSecret: string | null
  apiBaseUrl: string | null
  enforceSubscription: boolean
}

export interface KiwifyIntegrationConfigView {
  enabled: boolean
  checkoutUrl: string | null
  productId: string | null
  accountId: string | null
  clientId: string | null
  hasClientSecret: boolean
  hasWebhookSecret: boolean
  webhookSecretPreview: string | null
  webhookUrl: string
  enforceSubscription: boolean
  enforcementForcedByEnv: boolean
  updatedAt: Date | null
}

const CANONICAL_PUBLIC_URL = 'https://cliniqpro.integradata.app.br'

// A Kiwify só entrega webhooks pra URLs públicas HTTPS — um BACKEND_URL
// apontando pro IP da VPS (http://2.25.185.223) geraria um endpoint inútil.
export function kiwifyWebhookUrl(): string {
  const candidates = [process.env.PUBLIC_APP_URL, process.env.FRONTEND_URL, process.env.BACKEND_URL]
  const base = candidates.find(u => u && /^https:\/\//i.test(u)) || CANONICAL_PUBLIC_URL
  return `${base.replace(/\/$/, '')}/api/webhooks/kiwify`
}

// O middleware de assinatura roda em toda requisição operacional — cacheia o
// interruptor por alguns segundos pra não consultar o banco a cada chamada.
let enforcementCache: { value: boolean; expiresAt: number } | null = null
const ENFORCEMENT_CACHE_MS = 30_000

export async function isSubscriptionEnforced(): Promise<boolean> {
  if (SUBSCRIPTION_ENFORCEMENT_ENABLED) return true
  if (enforcementCache && enforcementCache.expiresAt > Date.now()) return enforcementCache.value

  try {
    const row = await prisma.kiwifyIntegrationConfig.findUnique({
      where: { id: SINGLETON_ID },
      select: { enforceSubscription: true },
    })
    const value = row?.enforceSubscription ?? false
    enforcementCache = { value, expiresAt: Date.now() + ENFORCEMENT_CACHE_MS }
    return value
  } catch (err) {
    console.error('[KIWIFY_CONFIG] Falha ao ler interruptor de bloqueio:', err)
    return enforcementCache?.value ?? false
  }
}

// Config efetiva da integração: valores salvos no banco (editáveis pelo admin
// em runtime, via menu Admin > Integrações) têm prioridade; as variáveis de
// ambiente KIWIFY_* só entram como fallback pra quem ainda configura via
// .env/redeploy. Isso deixa o rollout seguro: nada muda pra quem já usa env vars.
export async function getResolvedKiwifyConfig(): Promise<ResolvedKiwifyConfig> {
  const row = await prisma.kiwifyIntegrationConfig.findUnique({ where: { id: SINGLETON_ID } })

  return {
    // Enquanto o admin nunca salvou configuração pelo menu (row inexistente),
    // mantém o comportamento legado (ligado por padrão via env, ver
    // billing-config.ts). Assim que existir uma linha salva, o toggle da UI
    // manda — o admin precisa ativar explicitamente após configurar.
    enabled: row ? row.enabled : process.env.KIWIFY_WEBHOOK_ENABLED !== 'false',
    checkoutUrl: row?.checkoutUrl || process.env.KIWIFY_CHECKOUT_URL || null,
    productId: row?.productId || process.env.KIWIFY_PRODUCT_ID || null,
    accountId: row?.accountId || process.env.KIWIFY_ACCOUNT_ID || null,
    clientId: row?.clientId || process.env.KIWIFY_CLIENT_ID || null,
    clientSecret: row?.clientSecret || process.env.KIWIFY_CLIENT_SECRET || null,
    webhookSecret: row?.webhookSecret || process.env.KIWIFY_WEBHOOK_SECRET || null,
    apiBaseUrl: process.env.KIWIFY_API_BASE_URL || null,
    enforceSubscription: SUBSCRIPTION_ENFORCEMENT_ENABLED || (row?.enforceSubscription ?? false),
  }
}

export async function getKiwifyConfigView(): Promise<KiwifyIntegrationConfigView> {
  const [row, resolved] = await Promise.all([
    prisma.kiwifyIntegrationConfig.findUnique({ where: { id: SINGLETON_ID } }),
    getResolvedKiwifyConfig(),
  ])

  return {
    enabled: resolved.enabled,
    checkoutUrl: resolved.checkoutUrl,
    productId: resolved.productId,
    accountId: resolved.accountId,
    clientId: resolved.clientId,
    hasClientSecret: !!resolved.clientSecret,
    hasWebhookSecret: !!resolved.webhookSecret,
    webhookSecretPreview: resolved.webhookSecret ? `••••${resolved.webhookSecret.slice(-4)}` : null,
    webhookUrl: kiwifyWebhookUrl(),
    enforceSubscription: resolved.enforceSubscription,
    enforcementForcedByEnv: SUBSCRIPTION_ENFORCEMENT_ENABLED,
    updatedAt: row?.updatedAt ?? null,
  }
}

export interface UpdateKiwifyConfigInput {
  enabled?: boolean
  checkoutUrl?: string | null
  productId?: string | null
  accountId?: string | null
  clientId?: string | null
  clientSecret?: string | null
  webhookSecret?: string | null
  enforceSubscription?: boolean
}

export async function updateKiwifyConfig(input: UpdateKiwifyConfigInput, adminUserId: string): Promise<KiwifyIntegrationConfigView> {
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.checkoutUrl !== undefined ? { checkoutUrl: input.checkoutUrl || null } : {}),
    ...(input.productId !== undefined ? { productId: input.productId || null } : {}),
    ...(input.accountId !== undefined ? { accountId: input.accountId || null } : {}),
    ...(input.clientId !== undefined ? { clientId: input.clientId || null } : {}),
    ...(input.clientSecret !== undefined ? { clientSecret: input.clientSecret || null } : {}),
    ...(input.webhookSecret !== undefined ? { webhookSecret: input.webhookSecret || null } : {}),
    ...(input.enforceSubscription !== undefined ? { enforceSubscription: input.enforceSubscription } : {}),
    updatedByUserId: adminUserId,
  }

  await prisma.kiwifyIntegrationConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  })

  enforcementCache = null

  await logAudit({
    userId: adminUserId,
    action: 'KIWIFY_INTEGRATION_UPDATED',
    description: input.enforceSubscription !== undefined
      ? `Admin atualizou a integração Kiwify (bloqueio por assinatura ${input.enforceSubscription ? 'LIGADO' : 'DESLIGADO'})`
      : 'Admin atualizou a configuração da integração Kiwify',
  })

  return getKiwifyConfigView()
}

// Legado: gera um segredo aleatório. Na prática a Kiwify gera o token do
// webhook ela mesma (campo "Token", não editável no painel dela) — o fluxo
// correto é colar esse token em Admin > Integrações (updateKiwifyConfig).
export async function regenerateWebhookSecret(adminUserId: string): Promise<string> {
  const secret = crypto.randomBytes(24).toString('hex')

  await prisma.kiwifyIntegrationConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, webhookSecret: secret, updatedByUserId: adminUserId },
    update: { webhookSecret: secret, updatedByUserId: adminUserId },
  })

  await logAudit({
    userId: adminUserId,
    action: 'KIWIFY_WEBHOOK_SECRET_REGENERATED',
    description: 'Admin gerou um novo segredo do webhook Kiwify',
  })

  return secret
}

export async function getWebhookSecretPlain(adminUserId: string): Promise<string | null> {
  const resolved = await getResolvedKiwifyConfig()
  if (!resolved.webhookSecret) return null

  await logAudit({
    userId: adminUserId,
    action: 'KIWIFY_WEBHOOK_SECRET_REVEALED',
    description: 'Admin visualizou o segredo do webhook Kiwify',
  })

  return resolved.webhookSecret
}
