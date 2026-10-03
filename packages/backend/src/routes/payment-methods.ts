import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.use(requireRole('ADMIN', 'DOCTOR'))

const methodSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  type: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CHEQUE', 'DINHEIRO', 'TRANSFERENCIA', 'OUTROS']),
  instructions: z.string().optional(),
})

router.get('/', async (req: AuthRequest, res) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { doctorId: req.user!.userId },
      orderBy: { name: 'asc' },
    })
    res.json(methods)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = methodSchema.parse(req.body)
    const method = await prisma.paymentMethod.create({
      data: { ...data, doctorId: req.user!.userId },
    })
    res.status(201).json(method)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// where composto (id + doctorId quando o papel é DOCTOR) em todo mutator
// abaixo — sem isso, qualquer DOCTOR autenticado conseguia editar/desativar
// forma de pagamento de outro médico só sabendo o id. ADMIN mantém acesso
// irrestrito, consistente com os outros painéis administrativos.
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const data = methodSchema.partial().parse(req.body)
    const { count } = await prisma.paymentMethod.updateMany({
      where: { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId: req.user!.userId } : {}) },
      data,
    })
    if (count === 0) { res.status(404).json({ message: 'Forma de pagamento não encontrada' }); return }
    const method = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } })
    res.json(method)
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ message: 'Dados inválidos', errors: error.errors }); return }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.patch('/:id/toggle', async (req: AuthRequest, res) => {
  try {
    const scope = { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId: req.user!.userId } : {}) }
    const current = await prisma.paymentMethod.findFirst({ where: scope })
    if (!current) { res.status(404).json({ message: 'Forma de pagamento não encontrada' }); return }
    const method = await prisma.paymentMethod.update({
      where: { id: req.params.id },
      data: { active: !current.active },
    })
    res.json(method)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { count } = await prisma.paymentMethod.deleteMany({
      where: { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId: req.user!.userId } : {}) },
    })
    if (count === 0) { res.status(404).json({ message: 'Forma de pagamento não encontrada' }); return }
    res.json({ message: 'Forma de pagamento removida' })
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
