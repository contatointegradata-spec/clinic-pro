import NodeCache from 'node-cache'
import { prisma } from './prisma'
import { normalizePatientPhone } from './phone'

// ─── Vínculo LID ↔ telefone (identidade única do contato) ────────────────────
// A WhatsApp identifica a mesma pessoa ora pelo LID anônimo (NNN@lid), ora
// pelo número (55DDDNUMERO@s.whatsapp.net). Este módulo guarda o par de forma
// persistente (TBLWHATSAPPLID) com cache em memória, para que toda a
// plataforma — ingestão do Atendimento, Agente de IA, envios da equipe —
// trate os dois como o MESMO contato, com o telefone como chave canônica.
//
// Quando um par novo é aprendido, os ouvintes registrados (ex.: o Atendimento,
// que funde conversas duplicadas) são avisados.

const cache = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600, useClones: false })
const MISS = '__miss__'

type MappingListener = (lidJid: string, phone: string) => Promise<void> | void
const listeners: MappingListener[] = []

export function onLidMappingLearned(listener: MappingListener): void {
  listeners.push(listener)
}

function toLidJid(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (!raw.endsWith('@lid')) return null
  // Remove sufixo de dispositivo (NNN:12@lid → NNN@lid)
  const user = raw.split('@')[0].split(':')[0]
  return user ? `${user}@lid` : null
}

function toPhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (raw.endsWith('@lid') || raw.endsWith('@g.us') || raw.endsWith('@broadcast')) return null
  const digits = raw.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return normalizePatientPhone(digits)
}

/** Telefone canônico conhecido para um LID (cache → banco), ou null. */
export async function lookupPhoneByLid(rawLid: string): Promise<string | null> {
  const lidJid = toLidJid(rawLid)
  if (!lidJid) return null
  const key = `lid:${lidJid}`
  const cached = cache.get<string>(key)
  if (cached !== undefined) return cached === MISS ? null : cached

  const row = await prisma.whatsAppLidMapping.findUnique({ where: { lidJid }, select: { phone: true } }).catch(() => null)
  // Miss com TTL curto: o par pode ser aprendido a qualquer momento.
  if (row) cache.set(key, row.phone)
  else cache.set(key, MISS, 60)
  return row?.phone ?? null
}

/** LIDs conhecidos para um telefone (qualquer variante com/sem 9º dígito). */
export async function lookupLidsByPhones(phones: string[]): Promise<string[]> {
  if (phones.length === 0) return []
  const rows = await prisma.whatsAppLidMapping.findMany({
    where: { phone: { in: phones.map(normalizePatientPhone) } },
    select: { lidJid: true },
  }).catch(() => [])
  return rows.map(r => r.lidJid)
}

/**
 * Registra (ou confirma) o par LID ↔ telefone. Idempotente e barato quando o
 * par já é conhecido (só cache). Nunca lança — identidade é melhoria, não
 * pode derrubar a ingestão de mensagens.
 */
export async function rememberLidMapping(rawLid: string | null | undefined, rawPhone: string | null | undefined, source: string): Promise<void> {
  const lidJid = toLidJid(rawLid)
  const phone = toPhone(rawPhone)
  if (!lidJid || !phone) return
  // Proteção: os dígitos do LID nunca são o telefone.
  if (phone === lidJid.split('@')[0]) return

  const key = `lid:${lidJid}`
  if (cache.get<string>(key) === phone) return

  try {
    const existing = await prisma.whatsAppLidMapping.findUnique({ where: { lidJid } })
    if (existing?.phone === phone) {
      cache.set(key, phone)
      return
    }
    await prisma.whatsAppLidMapping.upsert({
      where: { lidJid },
      create: { lidJid, phone, source },
      update: { phone, source },
    })
    cache.set(key, phone)
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'WA', event: 'identity.lid_mapping_learned', lidJid, source, changed: Boolean(existing) }))
  } catch (err) {
    console.error('[whatsapp-identity] falha ao gravar vínculo LID:', (err as Error)?.message)
    return
  }

  for (const listener of listeners) {
    try {
      await listener(lidJid, phone)
    } catch (err) {
      console.error('[whatsapp-identity] listener falhou:', (err as Error)?.message)
    }
  }
}

/**
 * Extrai e memoriza pares LID ↔ telefone presentes na chave de uma mensagem
 * Baileys (remoteJid/senderPn/senderLid/participant*). Retorna o par em
 * conversa 1:1, se houver.
 */
export async function learnFromMessageKey(key: {
  remoteJid?: string | null
  senderPn?: string | null
  senderLid?: string | null
  participant?: string | null
  participantPn?: string | null
  participantLid?: string | null
} | null | undefined): Promise<void> {
  if (!key) return
  const remote = key.remoteJid ?? ''
  if (remote.endsWith('@g.us')) {
    await rememberLidMapping(key.participantLid || key.participant, key.participantPn || key.participant, 'participant')
    return
  }
  if (remote.endsWith('@lid')) await rememberLidMapping(remote, key.senderPn, 'senderPn')
  else if (remote.endsWith('@s.whatsapp.net')) await rememberLidMapping(key.senderLid, remote, 'senderLid')
}
