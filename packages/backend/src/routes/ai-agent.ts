import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'
import { generateSystemPrompt } from '../lib/ai-agent-engine'
import { displayPhone, phoneVariants } from '../lib/phone'
import { isGenericPatientName, normalizePersonName } from '../lib/patient-identity'
import { AiProviderError } from '../lib/ai-client-types'

const router = Router()
router.use(authenticate)

const UPSELL_PHONE = '5534992142504'

async function getTargetDoctorId(req: AuthRequest): Promise<string> {
  const effectiveId = await getEffectiveDoctorId(req)
  return effectiveId ?? req.user!.userId
}

async function ownedAgent(doctorId: string, chatbotId: string) {
  return prisma.lightChatbot.findFirst({ where: { id: chatbotId, doctorId } })
}

// ─── Agente (1 por médico) ────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await prisma.lightChatbot.findFirst({
      where: { doctorId, builderMode: 'ai_agent' },
      orderBy: { createdAt: 'asc' },
      include: {
        boundRoom: true,
        _count: { select: { ignoredNumbers: true } },
      },
    })
    res.json(agent)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const [doctorUser, agentCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: doctorId }, select: { aiAgentLimit: true } }),
      prisma.lightChatbot.count({ where: { doctorId, builderMode: 'ai_agent' } }),
    ])
    const limit = doctorUser?.aiAgentLimit ?? 1
    if (agentCount >= limit) {
      res.status(409).json({
        message: `Você já atingiu o limite de ${limit} agente(s) de IA da sua conta. Pra liberar mais, fale com a gente pelo WhatsApp ${UPSELL_PHONE}.`,
        upsellPhone: UPSELL_PHONE,
      })
      return
    }

    const data = z.object({ name: z.string().min(1).default('Agente de IA') }).parse(req.body ?? {})
    const agent = await prisma.lightChatbot.create({
      data: { doctorId, name: data.name, builderMode: 'ai_agent' },
      include: { boundRoom: true },
    })
    res.status(201).json(agent)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const promptConfigSchema = z.object({
  agentName: z.string().optional(),
  companyName: z.string().optional(),
  businessType: z.string().optional(),
  calendarUsage: z.string().optional(),
  agentProfession: z.string().optional(),
  personality: z.string().optional(),
  extraInfo: z.string().optional(),
})

router.put('/:id/prompt-config', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const data = promptConfigSchema.parse(req.body)
    const updated = await prisma.lightChatbot.update({ where: { id: agent.id }, data })
    res.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/:id/generate-prompt', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const systemPrompt = await generateSystemPrompt({
      agentName: agent.agentName,
      companyName: agent.companyName,
      businessType: agent.businessType,
      calendarUsage: agent.calendarUsage,
      agentProfession: agent.agentProfession,
      personality: agent.personality,
      extraInfo: agent.extraInfo,
    })

    if (!systemPrompt) {
      res.status(502).json({ message: 'Não foi possível gerar o prompt agora — tente novamente.' })
      return
    }

    const updated = await prisma.lightChatbot.update({ where: { id: agent.id }, data: { systemPrompt } })
    res.json(updated)
  } catch (err) {
    console.error('[ai-agent] generate-prompt error:', err)
    if (err instanceof AiProviderError) {
      if (err.status === 'missing_key') {
        res.status(502).json({ message: 'A IA não está configurada no servidor. Contate o suporte.' })
        return
      }
      if (err.status === 401 || err.status === 403) {
        res.status(502).json({ message: 'A chave de acesso à IA está inválida ou expirada. Contate o suporte.' })
        return
      }
      if (err.status === 429) {
        res.status(502).json({ message: 'A IA está sobrecarregada no momento. Tente novamente em instantes.' })
        return
      }
      if (err.status === 'timeout') {
        res.status(502).json({ message: 'A IA demorou demais para responder. Tente novamente.' })
        return
      }
      if (err.status === 404) {
        res.status(502).json({ message: `O modelo de IA configurado não foi encontrado (${err.message}). Verifique o nome do modelo em Admin > Integrações.` })
        return
      }
      // Status não mapeado (400 etc.) — devolve a mensagem real da Gemini em
      // vez de um erro genérico, já que não dá pra prever todo caso aqui.
      res.status(502).json({ message: `Erro ao gerar prompt com a IA: ${err.message}` })
      return
    }
    res.status(502).json({ message: 'Erro ao gerar prompt com a IA' })
  }
})

const systemPromptSchema = z.object({
  systemPrompt: z.string().optional(),
  responseDelaySeconds: z.coerce.number().int().min(0).max(60).optional(),
})

router.put('/:id/system-prompt', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const data = systemPromptSchema.parse(req.body)
    const updated = await prisma.lightChatbot.update({ where: { id: agent.id }, data })
    res.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.put('/:id/room', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const { roomId } = z.object({ roomId: z.string().min(1) }).parse(req.body)
    const room = await prisma.room.findFirst({ where: { id: roomId, doctorId } })
    if (!room) { res.status(404).json({ message: 'Sala não encontrada' }); return }

    // Salas podem ter ficado vinculadas a um chatbot do sistema antigo
    // (Fluxos/Construtor de Blocos, hoje sem tela). Como essa amarração não
    // é mais visível/gerenciável em lugar nenhum, ela é liberada
    // automaticamente pro novo Agente de IA poder usar a sala — os dados do
    // chatbot antigo continuam intactos, só o vínculo com a sala é solto.
    const staleBinding = await prisma.lightChatbot.findFirst({ where: { boundRoomId: roomId, id: { not: agent.id } } })
    if (staleBinding) {
      await prisma.lightChatbot.update({ where: { id: staleBinding.id }, data: { boundRoomId: null } })
    }

    await prisma.whatsAppInstance.upsert({
      where: { chatbotId: agent.id },
      create: { doctorId, type: 'CHATBOT_LIGHT', status: 'DISCONNECTED', chatbotId: agent.id },
      update: {},
    })

    const updated = await prisma.lightChatbot.update({
      where: { id: agent.id },
      data: { boundRoomId: roomId },
      include: { boundRoom: true },
    })
    res.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── Número Pass (ignorados pela IA) ──────────────────────────────────────────

router.get('/:id/ignored-numbers', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const numbers = await prisma.lightIgnoredNumber.findMany({
      where: { chatbotId: agent.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json(numbers)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/:id/ignored-numbers', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const data = z.object({ phone: z.string().min(8), name: z.string().optional() }).parse(req.body)
    const phone = data.phone.replace(/\D/g, '')

    const created = await prisma.lightIgnoredNumber.upsert({
      where: { chatbotId_phone: { chatbotId: agent.id, phone } },
      create: { chatbotId: agent.id, phone, name: data.name || null },
      update: { name: data.name || null },
    })
    res.status(201).json(created)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.delete('/:id/ignored-numbers/:numberId', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    await prisma.lightIgnoredNumber.deleteMany({ where: { id: req.params.numberId, chatbotId: agent.id } })
    res.json({ message: 'Número removido' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── Conversas ─────────────────────────────────────────────────────────────────

router.get('/:id/conversations', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const messages = await prisma.aiAgentMessage.findMany({
      where: { chatbotId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const byPhone = new Map<string, { phone: string; lastMessage: string; lastMessageAt: Date; count: number }>()
    for (const m of messages) {
      const prev = byPhone.get(m.contactPhone)
      if (!prev) {
        byPhone.set(m.contactPhone, { phone: m.contactPhone, lastMessage: m.content, lastMessageAt: m.createdAt, count: 1 })
      } else {
        prev.count += 1
      }
    }

    const phones = Array.from(byPhone.keys())
    // Mensagens antigas podem ter o contactPhone gravado numa variante
    // (com/sem o 9º dígito) diferente da que ficou no cadastro do paciente —
    // expande a busca pras duas pra não perder o nome/vínculo nesse caso.
    const expandedPhones = Array.from(new Set(phones.flatMap(phoneVariants)))

    // Nome do contato: prioriza o nome real do paciente (dado no agendamento);
    // se ainda não agendou, cai pro nome do WhatsApp (pushName) já capturado
    // pela Conversation do inbox manual, que compartilha a mesma instância.
    const patients = await prisma.patient.findMany({ where: { doctorId, phone: { in: expandedPhones } }, select: { phone: true, name: true } })
    const patientNameByPhone = new Map<string, string>()
    for (const p of patients) {
      for (const variant of phoneVariants(p.phone)) patientNameByPhone.set(variant, p.name)
    }

    let conversationNameByPhone = new Map<string, string>()
    // Conversas agora são por sala (roomId, contactPhone) — usa a sala vinculada ao agente.
    if (agent.boundRoomId) {
      const conversations = await prisma.conversation.findMany({
        where: { roomId: agent.boundRoomId, contactPhone: { in: phones } },
        select: { contactPhone: true, contactName: true },
      })
      conversationNameByPhone = new Map(
        conversations.filter(c => c.contactName).map(c => [c.contactPhone, c.contactName as string])
      )
    }

    const contacts = Array.from(byPhone.values())
      .map(c => ({
        ...c,
        // phoneDisplay null = contato identificado só pelo LID do WhatsApp (não é telefone)
        phoneDisplay: displayPhone(c.phone),
        name: patientNameByPhone.get(c.phone) ?? conversationNameByPhone.get(c.phone) ?? (displayPhone(c.phone) ? null : 'Contato WhatsApp'),
      }))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
    res.json(contacts)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.get('/:id/conversations/:phone', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    // Variantes com/sem o 9º dígito — mensagens antigas podem ter sido
    // gravadas com um contactPhone que não bate byte a byte com o telefone
    // canônico do Patient (ver lib/phone.ts), então o match exato sozinho
    // pode voltar vazio mesmo quando a conversa existe.
    const messages = await prisma.aiAgentMessage.findMany({
      where: { chatbotId: agent.id, contactPhone: { in: phoneVariants(req.params.phone) } },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// ─── CRM — métricas agregadas (novos leads, conversão, cancelamentos) ────────

const PERIOD_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, all: null }

router.get('/:id/crm-metrics', async (req: AuthRequest, res: Response) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const agent = await ownedAgent(doctorId, req.params.id)
    if (!agent) { res.status(404).json({ message: 'Agente não encontrado' }); return }

    const periodParam = typeof req.query.period === 'string' ? req.query.period : '30d'
    const periodDays = periodParam in PERIOD_DAYS ? PERIOD_DAYS[periodParam] : 30
    const since = periodDays != null ? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000) : undefined

    const leadWhere = { doctorId, origin: 'CHATBOT' as const, ...(since ? { createdAt: { gte: since } } : {}) }

    const [leadRows, cancellations, recentMessages] = await Promise.all([
      prisma.patient.findMany({ where: leadWhere, select: { id: true, name: true, phoneKey: true, leadStatus: true } }),
      prisma.appointment.count({
        where: {
          doctorId,
          status: { in: ['CANCELLED', 'NO_SHOW'] },
          ...(since ? { date: { gte: since } } : {}),
          patient: { origin: 'CHATBOT' },
        },
      }),
      prisma.aiAgentMessage.findMany({
        where: { chatbotId: agent.id, createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
        select: { contactPhone: true },
        distinct: ['contactPhone'],
      }),
    ])

    // Leads = PESSOAS distintas, não cadastros: mesmo telefone (phoneKey) +
    // mesmo nome conta uma vez só, e um lead genérico ("Novo contato (...)")
    // com o telefone de alguém já contado não soma de novo. Telefone
    // compartilhado com nomes diferentes (família) continua contando cada um.
    // Duplicados de verdade já são fundidos por lib/patient-identity.ts;
    // isso só garante que a taxa não infla enquanto a fusão não roda.
    const namedKeys = new Set(
      leadRows.filter(l => l.phoneKey && !isGenericPatientName(l.name)).map(l => l.phoneKey as string),
    )
    const people = new Map<string, boolean>() // identidade → convertido?
    for (const l of leadRows) {
      let identity: string
      if (!l.phoneKey) identity = `id:${l.id}`
      else if (isGenericPatientName(l.name)) identity = namedKeys.has(l.phoneKey) ? '' : `${l.phoneKey}|*`
      else identity = `${l.phoneKey}|${normalizePersonName(l.name)}`
      if (!identity) {
        // genérico absorvido por um lead com nome real do mesmo telefone: se
        // ele estiver convertido, converte quem tem o nome (mesma pessoa)
        if (l.leadStatus === 'CONVERTIDO') {
          const named = leadRows.find(o => o.phoneKey === l.phoneKey && !isGenericPatientName(o.name))
          if (named) people.set(`${named.phoneKey}|${normalizePersonName(named.name)}`, true)
        }
        continue
      }
      people.set(identity, (people.get(identity) ?? false) || l.leadStatus === 'CONVERTIDO')
    }
    const totalLeads = people.size
    const convertedLeads = Array.from(people.values()).filter(Boolean).length

    res.json({
      period: periodParam,
      newLeads: totalLeads,
      conversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 1000) / 10 : 0,
      convertedLeads,
      cancellations,
      ongoingConversations: recentMessages.length,
    })
  } catch (err) {
    console.error('[ai-agent/crm-metrics] erro:', err)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
