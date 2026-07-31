import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requirePlatformDeveloper, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.use(requirePlatformDeveloper)

// ─── GET /api/platform-admin/users ────────────────────────────────────────────
// Lista todos os usuários da plataforma (qualquer clínica) para o
// desenvolvedor liberar/revogar acesso a Notificações e Integrações.
router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        isPlatformDeveloper: true,
        notificationsAccess: true,
        integrationsAccess: true,
      },
      orderBy: { name: 'asc' },
    })
    res.json(users)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const accessSchema = z.object({
  notificationsAccess: z.boolean().optional(),
  integrationsAccess: z.boolean().optional(),
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

export default router
