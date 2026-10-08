import { Prisma, PrismaClient } from '@prisma/client'
import { computePhoneKey, toLidJid } from './phone'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

// ─── Identidade do paciente: Patient.phoneKey / whatsappLid ──────────────────
// Toda escrita de Patient que mexe em `phone` recalcula a chave de comparação
// (phoneKey) aqui, num lugar só — pacientes são criados/alterados por vários
// caminhos (cadastro manual, pré-cadastro, Agente de IA, fluxo guiado do
// chatbot, ações do chatbot, admin, fusão de duplicados) e esquecer um deles
// é exatamente o que gera duplicidade. Se o "telefone" for na verdade um LID
// do WhatsApp, a chave fica nula e o LID vai pra whatsappLid. Nome contendo o
// LID (lead antigo "Novo contato (NNN@lid)") vira "Contato WhatsApp".
// Escritas aninhadas (patient: { create }) dentro de outros models não passam
// por aqui — hoje não existem; a rotina de inicialização em
// lib/patient-identity.ts (backfillPhoneKeys) cobre qualquer sobra.
function applyPatientIdentity(data: Record<string, unknown> | undefined | null, isCreate: boolean) {
  if (!data || typeof data !== 'object') return
  let phone: unknown = data.phone
  if (phone && typeof phone === 'object' && 'set' in (phone as Record<string, unknown>)) {
    phone = (phone as Record<string, unknown>).set
  }
  if (typeof phone !== 'string') return
  if (data.phoneKey === undefined) data.phoneKey = computePhoneKey(phone)
  const lid = toLidJid(phone)
  if (lid && data.whatsappLid === undefined) data.whatsappLid = lid
  if (isCreate && lid && typeof data.name === 'string' && /@lid|\d{14,}/.test(data.name)) {
    data.name = 'Contato WhatsApp'
  }
}

function patientIdentityMiddleware(): Prisma.Middleware {
  return async (params, next) => {
    if (params.model === 'Patient' && params.args) {
      const args = params.args as Record<string, unknown>
      switch (params.action) {
        case 'create':
          applyPatientIdentity(args.data as Record<string, unknown>, true)
          break
        case 'update':
        case 'updateMany':
          applyPatientIdentity(args.data as Record<string, unknown>, false)
          break
        case 'upsert':
          applyPatientIdentity(args.create as Record<string, unknown>, true)
          applyPatientIdentity(args.update as Record<string, unknown>, false)
          break
        case 'createMany': {
          const rows = Array.isArray(args.data) ? args.data : [args.data]
          for (const row of rows) applyPatientIdentity(row as Record<string, unknown>, true)
          break
        }
      }
    }
    return next(params)
  }
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: ['error'],
  })
  client.$use(patientIdentityMiddleware())
  return client
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
