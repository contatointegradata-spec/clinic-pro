import type { Patient, Prisma, PrismaClient } from '@prisma/client'

// Formato canônico de armazenamento pra telefone de paciente: DDI(55) +
// DDD(2) + número, só dígitos — mesma regra que normalizeToWhatsAppJid
// (lib/room-whatsapp.ts) usa pra montar o JID. Manter os dois em sincronia é
// o que permite comparar o telefone cadastrado manualmente com o que chega
// via WhatsApp sem depender de nenhum dos dois lados "adivinhar" o formato
// do outro.
export function normalizePatientPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

// Celular brasileiro ganhou um 9º dígito extra (DDD + 9 + 8 dígitos) entre
// 2012-2016, mas nem todo cadastro antigo ou conta do WhatsApp tem esse 9 —
// então "5534991503110" (com 9) e "553491503110" (sem 9) podem ser o MESMO
// paciente. Gera a variante alternativa pra não perder essa correspondência.
function altNineDigitVariant(phone55: string): string | null {
  const rest = phone55.slice(4) // depois de "55" + DDD
  if (phone55.length === 13 && rest[0] === '9') return phone55.slice(0, 4) + rest.slice(1)
  if (phone55.length === 12) return phone55.slice(0, 4) + '9' + rest
  return null
}

// Todas as variantes de dígito (com/sem o 9º dígito) que correspondem ao
// mesmo telefone real — use pra montar filtros `in` que não percam contato
// por essa ambiguidade (ex: casar Patient.phone com AiAgentMessage.contactPhone
// gravados antes dessa normalização existir).
export function phoneVariants(raw: string): string[] {
  const primary = normalizePatientPhone(raw)
  const alt = altNineDigitVariant(primary)
  return alt ? [primary, alt] : [primary]
}

// ─── Chave de comparação (Patient.phoneKey) ──────────────────────────────────
// Telefone "de exibição/envio" (Patient.phone) continua no formato canônico
// acima; o phoneKey é só pra COMPARAR: DDD + últimos 8 dígitos, sem DDI e
// sem o 9º dígito. Assim "5534992142504", "553492142504", "(34) 99214-2504"
// e "34 9214-2504" viram todos "3492142504" — uma única coluna indexada,
// sem precisar montar variantes em cada busca. Número estrangeiro (não-BR)
// usa os dígitos completos. LID do WhatsApp (NNN@lid, ou 14+ dígitos sem o
// DDI 55) NUNCA vira chave: não é telefone, e casar por ele fundiria
// pessoas diferentes. Mesma regra em SQL na migration 20261008120000.
export function isLidLike(raw: string | null | undefined): boolean {
  if (!raw) return false
  if (raw.includes('@lid')) return true
  if (/[^\d\s()+\-.]/.test(raw)) return false
  const digits = raw.replace(/\D/g, '')
  return digits.length > 13 && !digits.startsWith('55')
}

export function computePhoneKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (raw.includes('@')) return null // JID (@lid, @g.us, @s.whatsapp.net) não é telefone digitado
  if (raw.startsWith('anon-')) return null // paciente anonimizado (LGPD)
  const digits = raw.replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2, 4) + digits.slice(-8)
  }
  if (digits.length === 10 || digits.length === 11) return digits.slice(0, 2) + digits.slice(-8)
  if (digits.length >= 8 && digits.length <= 13) return digits
  return null
}

/** `NNN@lid` a partir de um LID bruto (com ou sem sufixo/dispositivo) ou dos dígitos dele. */
export function toLidJid(raw: string | null | undefined): string | null {
  if (!raw || !isLidLike(raw)) return null
  const user = raw.split('@')[0].split(':')[0].replace(/\D/g, '')
  return user ? `${user}@lid` : null
}

/** Telefone exibível (null quando o "telefone" é um LID do WhatsApp ou paciente anonimizado). */
export function displayPhone(raw: string | null | undefined): string | null {
  if (!raw || raw.startsWith('anon-') || isLidLike(raw)) return null
  return raw
}

type PatientFindClient = PrismaClient | Prisma.TransactionClient

// Prioridade quando o mesmo telefone tem mais de um cadastro: o cadastro
// completo/ativo ganha do pré-cadastro, e entre iguais o mais antigo (o
// "original" — duplicados costumam ser criados depois).
const STATUS_RANK: Record<string, number> = { ATIVO: 0, INCOMPLETO: 1, PRE_CADASTRO: 2, INATIVO: 3 }

export function comparePatientsByPriority(
  a: { status: string; active: boolean; createdAt: Date },
  b: { status: string; active: boolean; createdAt: Date },
): number {
  const ra = (STATUS_RANK[a.status] ?? 9) + (a.active ? 0 : 10)
  const rb = (STATUS_RANK[b.status] ?? 9) + (b.active ? 0 : 10)
  if (ra !== rb) return ra - rb
  return a.createdAt.getTime() - b.createdAt.getTime()
}

/**
 * TODOS os pacientes (do médico) com o mesmo telefone — por phoneKey (ignora
 * DDI/9º dígito/formatação), com fallback por `phone` exato/variantes pra
 * linhas antigas ainda sem phoneKey. Para LID, busca por Patient.whatsappLid.
 * Ordenados por prioridade (ATIVO > INCOMPLETO > PRE_CADASTRO > INATIVO,
 * depois o mais antigo). Use pra desambiguação familiar (mãe que marca pros
 * filhos com o mesmo número). Ignora anonimizados.
 */
export async function findPatientsByPhone(client: PatientFindClient, doctorId: string | null, rawPhone: string): Promise<Patient[]> {
  if (!rawPhone) return []
  const scope = doctorId ? { doctorId } : {}
  let rows: Patient[]

  const lidJid = toLidJid(rawPhone)
  if (lidJid) {
    const digits = lidJid.split('@')[0]
    rows = await client.patient.findMany({
      where: { ...scope, anonymizedAt: null, OR: [{ whatsappLid: lidJid }, { phone: { in: [digits, lidJid] } }] },
    })
  } else {
    const key = computePhoneKey(rawPhone)
    if (!key) return []
    rows = await client.patient.findMany({
      where: {
        ...scope,
        anonymizedAt: null,
        OR: [
          { phoneKey: key },
          { phoneKey: null, phone: { in: [...phoneVariants(rawPhone), rawPhone] } },
        ],
      },
    })
  }
  return rows.sort(comparePatientsByPriority)
}

// Busca O paciente de um telefone (o de maior prioridade entre os que
// compartilham o número — ver findPatientsByPhone). Use isso em vez de
// `where: { phone }` direto em qualquer lugar que precise casar telefone de
// paciente (lead do Agente de IA, vínculo do Atendimento etc). Aceita `tx`
// (client de transação) ou o client normal.
export async function findPatientByPhone(client: PatientFindClient, doctorId: string | null, rawPhone: string) {
  const rows = await findPatientsByPhone(client, doctorId, rawPhone)
  return rows[0] ?? null
}
