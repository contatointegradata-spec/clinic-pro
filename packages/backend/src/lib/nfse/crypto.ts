import crypto from 'node:crypto'
import { JWT_SECRET } from '../../utils/jwt'

// ─── Cifra em repouso do certificado A1 e da senha ───────────────────────────
// AES-256-GCM. Chave: NFSE_ENCRYPTION_KEY (32 bytes em hex ou base64) ou,
// na falta dela, derivada do JWT_SECRET via scrypt. ATENÇÃO: trocar a chave
// (ou o JWT_SECRET, no modo derivado) torna os certificados salvos ilegíveis —
// o médico precisa reenviar o .pfx. Formato: "v1:<iv>:<tag>:<dados>" (base64).

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.NFSE_ENCRYPTION_KEY?.trim()
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new Error('NFSE_ENCRYPTION_KEY deve ter 32 bytes (64 hex ou base64)')
    cachedKey = key
  } else {
    cachedKey = crypto.scryptSync(JWT_SECRET, 'cliniq-nfse-cert-v1', 32)
  }
  return cachedKey
}

export function encryptSecret(plain: Buffer | string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const data = Buffer.concat([cipher.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':')
}

export function decryptSecret(payload: string): Buffer {
  const [version, iv, tag, data] = payload.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de segredo inválido')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()])
}
