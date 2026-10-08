import { Router } from 'express'
import { NotificationCategory } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

export { createNotification, notifyClinicTeam } from '../lib/notifications'

const router = Router()
router.use(authenticate)

const CATEGORIES = Object.values(NotificationCategory) as string[]

router.get('/', async (req: AuthRequest, res) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    if (category && !CATEGORIES.includes(category)) {
      res.status(400).json({ message: 'Categoria inválida' })
      return
    }
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user!.userId,
        ...(category ? { category: category as NotificationCategory } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json(notifications)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.get('/unread-count', async (req: AuthRequest, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user!.userId, read: false },
    })
    res.json({ count })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.patch('/:id/read', async (req: AuthRequest, res) => {
  try {
    // updateMany + where composto (id + userId) em vez de update({where:{id}})
    // — sem isso, qualquer usuário autenticado conseguiria marcar como lida
    // uma notificação de outra conta só sabendo o id.
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.userId },
      data: { read: true },
    })
    if (count === 0) {
      res.status(404).json({ message: 'Notificação não encontrada' })
      return
    }
    res.json({ message: 'Notificação marcada como lida' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.patch('/read-all', async (req: AuthRequest, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, read: false },
      data: { read: true },
    })
    res.json({ message: 'Todas as notificações foram marcadas como lidas' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    // Mesmo motivo do /:id/read acima: where composto pra não deixar
    // apagar notificação de outro usuário.
    const { count } = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (count === 0) {
      res.status(404).json({ message: 'Notificação não encontrada' })
      return
    }
    res.json({ message: 'Notificação removida' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
