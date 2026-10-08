// Mensagens automáticas para pacientes — liga/desliga e texto de cada evento
// do catálogo (lib/automations.ts). Reaproveita o motor existente: grava um
// LightTemplate + LightIntegrationConfig no chatbot padrão da clínica, que é
// exatamente o que triggerLightAutomatedMessage() procura ao disparar.
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireRole, AuthRequest } from '../middleware/auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'
import { AUTOMATIONS, findAutomation } from '../lib/automations'
import { resolveChatbotLightBinding } from '../lib/room-whatsapp'

const router = Router()

const TEMPLATE_PREFIX = 'Automação · '

async function getOrCreateDefaultChatbot(doctorId: string) {
  const existing = await prisma.lightChatbot.findFirst({ where: { doctorId }, orderBy: { createdAt: 'asc' } })
  if (existing) return existing
  return prisma.lightChatbot.create({ data: { doctorId, name: 'Chatbot Principal', active: true } })
}

// Sem sala vinculada ao chatbot padrão, as automações não têm por onde sair.
// Se a clínica tem exatamente uma sala com WhatsApp conectado e livre, vincula
// sozinho — é o caso comum (consultório com um número só).
async function ensureBinding(chatbot: { id: string; boundRoomId: string | null }, doctorId: string) {
  if (chatbot.boundRoomId) return chatbot.boundRoomId
  const candidates = await prisma.roomWhatsAppConnection.findMany({
    where: { doctorId, status: 'CONNECTED' },
    select: { roomId: true },
  })
  const bound = await prisma.lightChatbot.findMany({
    where: { boundRoomId: { in: candidates.map(c => c.roomId) } },
    select: { boundRoomId: true },
  })
  const free = candidates.filter(c => !bound.some(b => b.boundRoomId === c.roomId))
  if (free.length !== 1) return null
  await prisma.lightChatbot.update({ where: { id: chatbot.id }, data: { boundRoomId: free[0].roomId } })
  return free[0].roomId
}

async function connectionStatus(chatbotId: string, doctorId: string) {
  const binding = await resolveChatbotLightBinding(chatbotId)
  if (binding) {
    const room = await prisma.room.findUnique({ where: { id: binding.roomId }, select: { name: true } })
    const conn = await prisma.roomWhatsAppConnection.findUnique({ where: { roomId: binding.roomId }, select: { phoneNumber: true } })
    return { state: binding.connected ? 'CONNECTED' : 'DISCONNECTED', roomName: room?.name ?? null, phone: conn?.phoneNumber ?? null }
  }
  const anyConnected = await prisma.roomWhatsAppConnection.count({ where: { doctorId, status: 'CONNECTED' } })
  return { state: anyConnected > 0 ? 'NOT_BOUND' : 'NO_WHATSAPP', roomName: null, phone: null }
}

async function resolveDoctor(req: AuthRequest): Promise<string | null> {
  return getEffectiveDoctorId(req)
}

router.get('/', requireRole('DOCTOR', 'SECRETARY'), async (req: AuthRequest, res) => {
  try {
    const doctorId = await resolveDoctor(req)
    if (!doctorId) { res.status(400).json({ message: 'Nenhum profissional vinculado a este usuário.' }); return }
    const chatbot = await getOrCreateDefaultChatbot(doctorId)
    await ensureBinding(chatbot, doctorId)

    const configs = await prisma.lightIntegrationConfig.findMany({
      where: { doctorId, chatbotId: chatbot.id, triggerEvent: { in: AUTOMATIONS.map(a => a.event) } },
      include: { template: { select: { content: true, active: true } } },
    })
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sent = await prisma.lightMessageLog.groupBy({
      by: ['triggerEvent', 'status'],
      where: { doctorId, createdAt: { gte: since }, triggerEvent: { in: AUTOMATIONS.map(a => a.event) } },
      _count: { _all: true },
    })

    res.json({
      connection: await connectionStatus(chatbot.id, doctorId),
      canEdit: req.user!.role === 'DOCTOR',
      items: AUTOMATIONS.map(a => {
        const cfg = configs.find(c => c.triggerEvent === a.event)
        const stats = sent.filter(s => s.triggerEvent === a.event)
        return {
          event: a.event,
          group: a.group,
          label: a.label,
          when: a.when,
          variables: a.variables,
          defaultContent: a.defaultContent,
          enabled: !!cfg?.enabled && !!cfg.template?.active,
          content: cfg?.template?.content ?? a.defaultContent,
          sent30d: stats.filter(s => s.status === 'SENT').reduce((n, s) => n + s._count._all, 0),
          failed30d: stats.filter(s => s.status === 'FAILED').reduce((n, s) => n + s._count._all, 0),
        }
      }),
    })
  } catch (error) {
    console.error('[automations] list:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const updateSchema = z.object({
  enabled: z.boolean(),
  content: z.string().trim().min(5, 'Escreva a mensagem').max(1000, 'Mensagem muito longa (máx. 1000 caracteres)'),
})

router.put('/:event', requireRole('DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const def = findAutomation(req.params.event)
    if (!def) { res.status(404).json({ message: 'Automação desconhecida' }); return }
    const data = updateSchema.parse(req.body)
    const doctorId = req.user!.userId
    const chatbot = await getOrCreateDefaultChatbot(doctorId)
    if (data.enabled) await ensureBinding(chatbot, doctorId)

    const existing = await prisma.lightIntegrationConfig.findUnique({
      where: { doctorId_chatbotId_module_triggerEvent: { doctorId, chatbotId: chatbot.id, module: def.module, triggerEvent: def.event } },
      select: { templateId: true },
    })
    const variables = def.variables.filter(v => data.content.includes(v))
    const template = existing?.templateId
      ? await prisma.lightTemplate.update({
          where: { id: existing.templateId },
          data: { content: data.content, active: true, variables },
        })
      : await prisma.lightTemplate.create({
          data: { doctorId, name: `${TEMPLATE_PREFIX}${def.label}`, category: def.module, content: data.content, variables },
        })

    await prisma.lightIntegrationConfig.upsert({
      where: { doctorId_chatbotId_module_triggerEvent: { doctorId, chatbotId: chatbot.id, module: def.module, triggerEvent: def.event } },
      update: { enabled: data.enabled, templateId: template.id },
      create: { doctorId, chatbotId: chatbot.id, module: def.module, triggerEvent: def.event, enabled: data.enabled, templateId: template.id },
    })

    res.json({ event: def.event, enabled: data.enabled, content: template.content, connection: await connectionStatus(chatbot.id, doctorId) })
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ message: error.errors[0]?.message ?? 'Dados inválidos' }); return }
    console.error('[automations] update:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
