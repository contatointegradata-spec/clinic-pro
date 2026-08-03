import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'
import { generateSystemPrompt } from '../lib/ai-agent-engine'
import { GroqApiError } from '../lib/groq-client'

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
    const existing = await prisma.lightChatbot.findFirst({ where: { doctorId, builderMode: 'ai_agent' } })
    if (existing) {
      res.status(409).json({
        message: `Você já tem um agente de IA. Pra ter mais de um, fale com a gente pelo WhatsApp ${UPSELL_PHONE}.`,
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
    if (err instanceof GroqApiError) {
      if (err.status === 'missing_key') {
        res.status(502).json({ message: 'A IA não está configurada no servidor (GROQ_API_KEY ausente). Contate o suporte.' })
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

    // Nome do contato: prioriza o nome real do paciente (dado no agendamento);
    // se ainda não agendou, cai pro nome do WhatsApp (pushName) já capturado
    // pela Conversation do inbox manual, que compartilha a mesma instância.
    const [patients, instance] = await Promise.all([
      prisma.patient.findMany({ where: { doctorId, phone: { in: phones } }, select: { phone: true, name: true } }),
      prisma.whatsAppInstance.findUnique({ where: { chatbotId: agent.id }, select: { id: true } }),
    ])
    const patientNameByPhone = new Map(patients.map(p => [p.phone, p.name]))

    let conversationNameByPhone = new Map<string, string>()
    if (instance) {
      const conversations = await prisma.conversation.findMany({
        where: { instanceId: instance.id, contactPhone: { in: phones } },
        select: { contactPhone: true, contactName: true },
      })
      conversationNameByPhone = new Map(
        conversations.filter(c => c.contactName).map(c => [c.contactPhone, c.contactName as string])
      )
    }

    const contacts = Array.from(byPhone.values())
      .map(c => ({ ...c, name: patientNameByPhone.get(c.phone) ?? conversationNameByPhone.get(c.phone) ?? null }))
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

    const messages = await prisma.aiAgentMessage.findMany({
      where: { chatbotId: agent.id, contactPhone: req.params.phone },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
