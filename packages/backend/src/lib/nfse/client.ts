import https from 'node:https'

// ─── Cliente HTTP da Sefin Nacional NFS-e (mTLS com o certificado A1) ────────
// Toda chamada autentica com o certificado do prestador (TLS mútuo). URLs
// sobrescrevíveis por env para o caso de mudança de endpoint pela Receita.

export type Ambiente = 'PRODUCAO' | 'HOMOLOGACAO'

const SEFIN_URL: Record<Ambiente, string> = {
  PRODUCAO: process.env.NFSE_SEFIN_URL_PRODUCAO || 'https://sefin.nfse.gov.br/SefinNacional',
  HOMOLOGACAO: process.env.NFSE_SEFIN_URL_HOMOLOGACAO || 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
}

const ADN_URL: Record<Ambiente, string> = {
  PRODUCAO: process.env.NFSE_ADN_URL_PRODUCAO || 'https://adn.nfse.gov.br',
  HOMOLOGACAO: process.env.NFSE_ADN_URL_HOMOLOGACAO || 'https://adn.producaorestrita.nfse.gov.br',
}

const TIMEOUT_MS = 45_000

export interface SefinCredentials {
  ambiente: Ambiente
  pfx: Buffer
  passphrase: string
}

export interface SefinMessage {
  codigo: string | null
  descricao: string
  complemento: string | null
}

export interface SefinResponse<T = Record<string, unknown>> {
  status: number
  body: T | null
  raw: Buffer
  contentType: string
}

/** Erro de transporte (timeout, TLS, DNS) — o resultado da emissão é DESCONHECIDO. */
export class SefinTransportError extends Error {}

function request<T>(cred: SefinCredentials, base: string, method: string, path: string, payload?: unknown, accept = 'application/json'): Promise<SefinResponse<T>> {
  const url = new URL(base + path)
  const data = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), 'utf8')
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      pfx: cred.pfx,
      passphrase: cred.passphrase,
      minVersion: 'TLSv1.2',
      timeout: TIMEOUT_MS,
      headers: {
        Accept: accept,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks)
        const contentType = String(res.headers['content-type'] || '')
        let body: T | null = null
        if (contentType.includes('json') && raw.length > 0) {
          try { body = JSON.parse(raw.toString('utf8')) as T } catch { body = null }
        }
        resolve({ status: res.statusCode ?? 0, body, raw, contentType })
      })
    })
    req.on('timeout', () => req.destroy(new SefinTransportError('Tempo esgotado aguardando a Sefin Nacional')))
    req.on('error', err => reject(err instanceof SefinTransportError ? err : new SefinTransportError(err.message)))
    if (data) req.write(data)
    req.end()
  })
}

/** Lê um campo ignorando caixa (a API mistura "chaveAcesso"/"ChaveAcesso"). */
export function field<T = unknown>(body: unknown, name: string): T | undefined {
  if (!body || typeof body !== 'object') return undefined
  const key = Object.keys(body).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? (body as Record<string, T>)[key] : undefined
}

/** Normaliza a lista de erros/alertas de retorno da Sefin. */
export function extractMessages(body: unknown, listName: 'erros' | 'alertas' = 'erros'): SefinMessage[] {
  const list = field<unknown[]>(body, listName) ?? field<unknown[]>(body, listName === 'erros' ? 'erro' : 'alerta')
  const arr = Array.isArray(list) ? list : list ? [list] : []
  return arr.map(item => ({
    codigo: (field<string>(item, 'codigo') ?? null) as string | null,
    descricao: String(field(item, 'descricao') ?? field(item, 'mensagem') ?? 'Erro sem descrição'),
    complemento: (field<string>(item, 'complemento') ?? null) as string | null,
  }))
}

export const sefin = {
  /** POST /nfse — geração síncrona da NFS-e a partir da DPS assinada. */
  emitir: (cred: SefinCredentials, dpsXmlGZipB64: string) =>
    request(cred, SEFIN_URL[cred.ambiente], 'POST', '/nfse', { dpsXmlGZipB64 }),
  /** GET /nfse/{chave} — consulta a NFS-e. */
  consultarNfse: (cred: SefinCredentials, chave: string) =>
    request(cred, SEFIN_URL[cred.ambiente], 'GET', `/nfse/${encodeURIComponent(chave)}`),
  /** GET /dps/{id} — recupera a chave da NFS-e gerada a partir da DPS (reconciliação). */
  consultarDps: (cred: SefinCredentials, idDps: string) =>
    request(cred, SEFIN_URL[cred.ambiente], 'GET', `/dps/${encodeURIComponent(idDps)}`),
  /** POST /nfse/{chave}/eventos — pedido de registro de evento (cancelamento). */
  registrarEvento: (cred: SefinCredentials, chave: string, pedidoRegistroEventoXmlGZipB64: string) =>
    request(cred, SEFIN_URL[cred.ambiente], 'POST', `/nfse/${encodeURIComponent(chave)}/eventos`, { pedidoRegistroEventoXmlGZipB64 }),
  /** GET /parametros_municipais/{cMun}/convenio — usado como teste de conexão/convênio. */
  convenioMunicipio: (cred: SefinCredentials, codigoMunicipio: string) =>
    request(cred, SEFIN_URL[cred.ambiente], 'GET', `/parametros_municipais/${encodeURIComponent(codigoMunicipio)}/convenio`),
  /** DANFSe (PDF) no Ambiente de Dados Nacional. */
  danfse: (cred: SefinCredentials, chave: string) =>
    request(cred, ADN_URL[cred.ambiente], 'GET', `/danfse/${encodeURIComponent(chave)}`, undefined, 'application/pdf'),
}
