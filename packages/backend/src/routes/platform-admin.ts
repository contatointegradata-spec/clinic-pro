import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requirePlatformDeveloper, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.use(requirePlatformDeveloper)

// ─── GET /api/platform-admin/users ────────────────────────────────────────────
// Lista todos os usuários da plataforma (qualquer clínica) para o
// desenvolvedor liberar/revogar acesso a Notificações e Integrações, e
// gerenciar quantos Agentes de IA cada médico tem/pode ter.
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const [users, agentCounts] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          isPlatformDeveloper: true,
          notificationsAccess: true,
          integrationsAccess: true,
          aiAgentLimit: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.lightChatbot.groupBy({
        by: ['doctorId'],
        where: { builderMode: 'ai_agent' },
        _count: { _all: true },
      }),
    ])

    const countByDoctor = new Map(agentCounts.map(c => [c.doctorId, c._count._all]))
    const result = users.map(u => ({ ...u, aiAgentCount: countByDoctor.get(u.id) ?? 0 }))

    res.json(result)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const accessSchema = z.object({
  notificationsAccess: z.boolean().optional(),
  integrationsAccess: z.boolean().optional(),
  aiAgentLimit: z.coerce.number().int().min(0).max(20).optional(),
})

// ─── PATCH /api/platform-admin/users/:id/access ───────────────────────────────
router.patch('/users/:id/access', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const data = accessSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' })
      return
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        isPlatformDeveloper: true,
        notificationsAccess: true,
        integrationsAccess: true,
        aiAgentLimit: true,
      },
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

// ─── POST /api/platform-admin/users/:id/ai-agent ──────────────────────────────
// Cria um Agente de IA em nome de um médico — o desenvolvedor da plataforma
// provisiona diretamente em vez de depender do médico clicar em "Criar
// Agente" na tela dele. Respeita o mesmo limite (aiAgentLimit) usado em
// POST /api/ai-agent, pra não deixar o admin criar além do liberado.
router.post('/users/:id/ai-agent', async (req: AuthRequest, res: Response) => {
  try {
    const { id: doctorId } = req.params

    const doctor = await prisma.user.findUnique({ where: { id: doctorId }, select: { id: true, role: true, aiAgentLimit: true } })
    if (!doctor) {
      res.status(404).json({ message: 'Usuário não encontrado' })
      return
    }
    if (doctor.role !== 'DOCTOR') {
      res.status(400).json({ message: 'Agente de IA só pode ser criado para usuários com papel Especialista (DOCTOR)' })
      return
    }

    const agentCount = await prisma.lightChatbot.count({ where: { doctorId, builderMode: 'ai_agent' } })
    if (agentCount >= doctor.aiAgentLimit) {
      res.status(409).json({ message: `Este médico já atingiu o limite de ${doctor.aiAgentLimit} agente(s) de IA. Aumente o limite antes de criar outro.` })
      return
    }

    const agent = await prisma.lightChatbot.create({
      data: { doctorId, name: 'Agente de IA', builderMode: 'ai_agent' },
    })
    res.status(201).json(agent)
  } catch (error) {
    console.error('[platform-admin/users/:id/ai-agent] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
