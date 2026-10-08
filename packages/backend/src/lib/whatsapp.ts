import { prisma } from './prisma'
import { lookupLidsByPhones, lookupPhoneByLid } from './whatsapp-identity'
import { phoneVariants } from './phone'

// ─── Logger Estruturado ────────────────────────────────────────────────────────

function logWA(level: 'info' | 'warn' | 'error', instanceKey: string, event: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ ts, level, module: 'WA', instanceKey, event, ...meta }))
}

// ─── Resolução de JID de entrega ──────────────────────────────────────────────

export function resolveDeliveryJid(input: string): string {
  if (input.endsWith('@s.whatsapp.net')) return input
  if (input.endsWith('@lid')) return input
  if (input.endsWith('@g.us')) throw new Error('Não enviar chatbot para grupos')
  if (input === 'status@broadcast' || input.endsWith('@broadcast')) throw new Error('Não enviar para status')

  const digits = input.replace(/\D/g, '')
  // Add Brazil country code for 10-11 digit numbers (DDD + phone, no CC)
  const normalized = (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits
  return `${normalized}@s.whatsapp.net`
}

export interface WhatsAppContactIdentity {
  remoteJid: string;
  deliveryJid: string;
  lidJid?: string;
  phoneJid?: string;
  normalizedPhone?: string;
  displayName?: string;
}

// Escopo da busca de mapeamento LID → telefone: conversas da SALA (chave
// atual do Atendimento) e, se houver, sessões antigas do Chatbot Light da instância.
export interface ContactIdentityScope {
  roomId?: string | null
  instanceId?: string | null
}

export async function resolveWhatsAppContactIdentity(
  scope: ContactIdentityScope,
  remoteJid: string,
  msgRaw?: any
): Promise<WhatsAppContactIdentity> {
  const displayName = msgRaw?.pushName || null
  const deliveryJid = remoteJid
  let lidJid: string | undefined
  let phoneJid: string | undefined
  let normalizedPhone: string | undefined

  if (remoteJid.endsWith('@lid')) {
    lidJid = remoteJid
    logWA('info', 'global', 'whatsapp.contact_identity.lid_detected', { remoteJid })

    // 1º: vínculo LID ↔ telefone persistente (TBLWHATSAPPLID + cache).
    // Depois, fallbacks antigos (conversa da sala / sessão do Chatbot Light).
    try {
      const mapped = await lookupPhoneByLid(remoteJid)
      const existingConv = mapped ? { normalizedPhone: mapped, phoneJid: `${mapped}@s.whatsapp.net` } : scope.roomId ? await prisma.conversation.findFirst({
        where: {
          roomId: scope.roomId,
          lidJid: remoteJid,
          normalizedPhone: { not: null }
        },
        select: {
          normalizedPhone: true,
          phoneJid: true
        }
      }) : null
      if (existingConv && existingConv.normalizedPhone) {
        normalizedPhone = existingConv.normalizedPhone
        phoneJid = existingConv.phoneJid || `${normalizedPhone}@s.whatsapp.net`
      } else if (scope.instanceId) {
        const lastSession = await prisma.lightFlowSession.findFirst({
          where: {
            instanceId: scope.instanceId,
            contactPhone: remoteJid,
          },
          orderBy: { createdAt: 'desc' }
        })
        if (lastSession) {
          const collected = lastSession.collectedData ? (typeof lastSession.collectedData === 'string' ? JSON.parse(lastSession.collectedData) : lastSession.collectedData) as any : {}
          if (collected && collected.telefone) {
            normalizedPhone = collected.telefone.replace(/\D/g, '')
            phoneJid = `${normalizedPhone}@s.whatsapp.net`
          }
        }
      }
    } catch (err) {
      // ignore
    }
  } else if (remoteJid.endsWith('@s.whatsapp.net')) {
    phoneJid = remoteJid
    normalizedPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '')
    // Mensagem pelo número: anexa o LID (vindo na própria mensagem ou já
    // conhecido) — é ele que casa com uma conversa antiga aberta via @lid.
    const senderLid = msgRaw?.key?.senderLid
    if (typeof senderLid === 'string' && senderLid.endsWith('@lid')) {
      lidJid = `${senderLid.split('@')[0].split(':')[0]}@lid`
    } else {
      const lids = await lookupLidsByPhones(phoneVariants(normalizedPhone)).catch(() => [])
      if (lids.length > 0) lidJid = lids[0]
    }
  }

  // Se a WhatsApp mandou o telefone real junto da mensagem: em conversa 1:1
  // onde o remoteJid já vem como @lid, o campo é msg.key.senderPn; em grupo,
  // onde quem fala é identificado por @lid no participant, é participantPn.
  // Sem checar senderPn aqui, toda conversa direta via @lid ficava sem
  // telefone resolvido (mesmo com o contato já tendo mandado mensagem antes),
  // o que gerava "Novo contato (NNNN@lid)" e paciente duplicado no CRM.
  let phoneFromPn = msgRaw?.key?.senderPn || msgRaw?.key?.participantPn || msgRaw?.participantPn
  if (phoneFromPn && typeof phoneFromPn === 'string') {
    phoneFromPn = phoneFromPn.replace('@s.whatsapp.net', '').replace(/\D/g, '')
    if (phoneFromPn.length >= 10) {
      normalizedPhone = phoneFromPn
      phoneJid = `${phoneFromPn}@s.whatsapp.net`
    }
  }

  logWA('info', 'global', 'whatsapp.contact_identity.resolved', {
    remoteJid,
    deliveryJid,
    lidJid,
    phoneJid,
    normalizedPhone
  })

  return {
    remoteJid,
    deliveryJid,
    lidJid,
    phoneJid,
    normalizedPhone,
    displayName
  }
}

// ─── Limpeza de inicialização ─────────────────────────────────────────────────

export async function runStartupDatabaseCleanup() {
  try {
    console.log('[StartupCleanup] Iniciando limpeza de dados antigos de teste...')

    // 1. Expirar sessões ativas antigas
    const expiredSessions = await prisma.lightFlowSession.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'EXPIRED' }
    })
    console.log(`[StartupCleanup] Expiradas ${expiredSessions.count} sessões ativas antigas.`)

    // 2. Corrigir conversas antigas com o LID sem sufixo
    const oldLids = ['73444192432134']
    for (const oldLid of oldLids) {
      const lidWithSuffix = `${oldLid}@lid`

      const conversations = await prisma.conversation.findMany({
        where: { contactPhone: oldLid }
      })

      for (const conv of conversations) {
        // Chave da conversa agora é (roomId, contactPhone) — se já existe a
        // versão correta na mesma sala, descarta a antiga em vez de renomear
        // (renomear colidiria com o unique roomId_contactPhone).
        const existingCorrect = await prisma.conversation.findFirst({
          where: { roomId: conv.roomId, contactPhone: lidWithSuffix }
        })

        if (existingCorrect) {
          await prisma.message.deleteMany({ where: { conversationId: conv.id } })
          await prisma.conversation.delete({ where: { id: conv.id } })
        } else {
          await prisma.conversation.update({
            where: { id: conv.id },
            data: {
              contactPhone: lidWithSuffix,
              remoteJid: lidWithSuffix,
              lidJid: lidWithSuffix,
              deliveryJid: lidWithSuffix
            }
          }).catch(async (err: any) => {
            // Corrida/legado: outra conversa já usa essa chave → descarta a antiga.
            if (err?.code === 'P2002') {
              await prisma.message.deleteMany({ where: { conversationId: conv.id } })
              await prisma.conversation.delete({ where: { id: conv.id } })
              return
            }
            throw err
          })
        }
      }
    }
    console.log('[StartupCleanup] Limpeza de dados de teste concluída com sucesso.')
  } catch (err) {
    console.error('[StartupCleanup] Erro durante a limpeza de inicialização:', err)
  }
}
