import type { Prisma, PrismaClient } from '@prisma/client'

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

type PatientFindClient = PrismaClient | Prisma.TransactionClient

// Busca um paciente pelo telefone tentando o formato exato e, se não achar,
// a variante com/sem o 9º dígito — use isso em vez de `where: { phone }`
// direto em qualquer lugar que precise casar telefone de paciente (lead do
// Agente de IA, detecção de duplicado no cadastro, etc). Aceita `tx` (client
// de transação) ou o client normal.
export async function findPatientByPhone(client: PatientFindClient, doctorId: string | null, rawPhone: string) {
  const primary = normalizePatientPhone(rawPhone)
  const scope = doctorId ? { doctorId } : {}
  const patient = await client.patient.findFirst({ where: { ...scope, phone: primary } })
  if (patient) return patient

  const alt = altNineDigitVariant(primary)
  if (!alt) return null
  return client.patient.findFirst({ where: { ...scope, phone: alt } })
}
