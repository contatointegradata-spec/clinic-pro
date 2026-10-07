import crypto from 'crypto'
import { getResolvedKiwifyConfig } from '../../lib/kiwify-config'
import { INTEGRATION_ADDON_PRICING } from '../../lib/billing-config'

// Verificação de assinatura do webhook. Formato oficial da Kiwify: o token
// do webhook é gerado pela própria Kiwify (campo "Token" no painel, não
// editável) e cada entrega chega em `POST <url>?signature=<hex>`, onde
// signature = HMAC-SHA1(corpo JSON, token). Aceitamos também, por
// compatibilidade: HMAC-SHA256, header `x-kiwify-signature`, e o token puro
// na query (`?token=`), caso a URL tenha sido cadastrada com ele.
function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toLowerCase())
  const right = Buffer.from(b.trim().toLowerCase())
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function verifyKiwifyWebhookSignature(params: {
  rawBody?: Buffer
  parsedBody?: unknown
  headerSignature?: string
  querySignature?: string
  queryToken?: string
  secret: string
}): boolean {
  const { rawBody, parsedBody, headerSignature, querySignature, queryToken, secret } = params
  if (!secret) return false

  // A Kiwify assina JSON.stringify(body); o corpo bruto costuma ser idêntico,
  // mas testamos os dois pra não depender de espaçamento/ordem de serialização.
  const bodies: Buffer[] = []
  if (rawBody?.length) bodies.push(rawBody)
  if (parsedBody !== undefined) bodies.push(Buffer.from(JSON.stringify(parsedBody)))

  const candidates = [querySignature, headerSignature].filter((v): v is string => !!v)
  for (const signature of candidates) {
    const provided = signature.replace(/^sha(1|256)=/i, '')
    for (const body of bodies) {
      for (const algo of ['sha1', 'sha256'] as const) {
        const expected = crypto.createHmac(algo, secret).update(body).digest('hex')
        if (safeEqualHex(expected, provided)) return true
      }
    }
  }

  if (queryToken) {
    const a = Buffer.from(queryToken)
    const b = Buffer.from(secret)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  }

  return false
}

export async function buildKiwifyCheckoutUrl(params: {
  doctorId: string
  userId: string
  checkoutAttemptId: string
}): Promise<string> {
  const config = await getResolvedKiwifyConfig()
  const baseUrl = config.checkoutUrl
  if (!baseUrl) {
    throw new Error('URL de checkout da Kiwify não configurada — configure em Admin > Integrações')
  }

  const url = new URL(baseUrl)
  url.searchParams.set('s1', params.doctorId)
  url.searchParams.set('s2', params.userId)
  url.searchParams.set('s3', params.checkoutAttemptId)
  url.searchParams.set('utm_source', 'clinic-pro')
  url.searchParams.set('utm_medium', 'subscription')

  return url.toString()
}

// Checkout de um add-on de integração (ver INTEGRATION_ADDON_PRICING). Cada
// tipo tem seu próprio produto/checkout na Kiwify — configurado via env var
// específica (kiwifyCheckoutUrlEnvKey), já que ainda não existem produtos
// reais criados. `s4` carrega o tipo pra o webhook saber qual addon ativar.
export function buildAddonCheckoutUrl(params: {
  doctorId: string
  userId: string
  addonId: string
  type: string
}): string {
  const pricing = INTEGRATION_ADDON_PRICING[params.type]
  if (!pricing) {
    throw new Error(`Tipo de integração desconhecido: ${params.type}`)
  }

  const baseUrl = process.env[pricing.kiwifyCheckoutUrlEnvKey]
  if (!baseUrl) {
    throw new Error(`Produto Kiwify ainda não configurado para "${pricing.label}" (defina ${pricing.kiwifyCheckoutUrlEnvKey})`)
  }

  const url = new URL(baseUrl)
  url.searchParams.set('s1', params.doctorId)
  url.searchParams.set('s2', params.userId)
  url.searchParams.set('s3', params.addonId)
  url.searchParams.set('s4', params.type)
  url.searchParams.set('utm_source', 'clinic-pro')
  url.searchParams.set('utm_medium', 'integration-addon')

  return url.toString()
}

interface KiwifySaleResult {
  status: string
  productId?: string
  amountCents?: number
}

// Consulta best-effort de uma venda diretamente na API da Kiwify, usada pela
// reconciliação manual ("Já realizei o pagamento"). Requer client_id/secret
// válidos (OAuth client credentials) — o endpoint exato e o formato de
// resposta devem ser confirmados com a documentação da conta Kiwify antes de
// depender disso em produção; por ora falha de forma segura (retorna null) se
// as credenciais não estiverem configuradas.
let cachedToken: { token: string; expiresAt: number } | null = null

async function getKiwifyAccessToken(): Promise<string | null> {
  const config = await getResolvedKiwifyConfig()
  const { clientId, clientSecret, apiBaseUrl: apiBase } = config

  if (!clientId || !clientSecret || !apiBase) return null

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(`${apiBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const data = await res.json() as { access_token?: string; expires_in?: number }
    if (!data.access_token) return null

    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 30_000 }
    return cachedToken.token
  } catch (err) {
    console.error('[KIWIFY_CLIENT] Falha ao obter token OAuth:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function getKiwifySale(orderId: string): Promise<KiwifySaleResult | null> {
  const config = await getResolvedKiwifyConfig()
  const { apiBaseUrl: apiBase, accountId } = config
  if (!apiBase) return null

  const token = await getKiwifyAccessToken()
  if (!token) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(`${apiBase}/sales/${orderId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(accountId ? { 'x-kiwify-account-id': accountId } : {}),
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const data = await res.json() as { status?: string; product_id?: string; charge_amount?: number }
    return { status: data.status ?? 'unknown', productId: data.product_id, amountCents: data.charge_amount }
  } catch (err) {
    console.error('[KIWIFY_CLIENT] Falha ao consultar venda:', err instanceof Error ? err.message : err)
    return null
  }
}
