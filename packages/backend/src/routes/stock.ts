import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'

const router = Router()
router.use(authenticate)

async function getTargetDoctorId(req: AuthRequest): Promise<string> {
  const effectiveId = await getEffectiveDoctorId(req)
  return effectiveId ?? req.user!.userId
}

const productSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  unit: z.string().min(1, 'Unidade obrigatória'),
  quantity: z.coerce.number().int().min(0).default(0),
  minQuantity: z.coerce.number().int().min(0).optional(),
})

// GET /api/stock/products — lista pro médico/secretária vinculada; também
// usado pelo seletor "Produtos usados" ao finalizar consulta na Agenda.
router.get('/products', async (req: AuthRequest, res) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const products = await prisma.product.findMany({
      where: { doctorId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    })
    res.json(products)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.post('/products', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = productSchema.parse(req.body)
    const doctorId = await getTargetDoctorId(req)
    const product = await prisma.product.create({ data: { ...data, doctorId } })
    res.status(201).json(product)
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Dados inválidos', errors: error.errors })
      return
    }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// where composto (id + doctorId quando o papel é DOCTOR) em todo mutator —
// mesmo padrão de payment-methods.ts. ADMIN mantém acesso irrestrito.
router.put('/products/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = productSchema.partial().parse(req.body)
    const doctorId = await getTargetDoctorId(req)
    const { count } = await prisma.product.updateMany({
      where: { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId } : {}) },
      data,
    })
    if (count === 0) { res.status(404).json({ message: 'Produto não encontrado' }); return }
    const product = await prisma.product.findUnique({ where: { id: req.params.id } })
    res.json(product)
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ message: 'Dados inválidos', errors: error.errors }); return }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

router.patch('/products/:id/toggle', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const scope = { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId } : {}) }
    const current = await prisma.product.findFirst({ where: scope })
    if (!current) { res.status(404).json({ message: 'Produto não encontrado' }); return }
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { active: !current.active },
    })
    res.json(product)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

const entrySchema = z.object({
  quantity: z.coerce.number().int().positive('Quantidade deve ser maior que zero'),
  reason: z.string().optional(),
})

// POST /api/stock/products/:id/entry — entrada manual (soma ao saldo atual).
router.post('/products/:id/entry', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const data = entrySchema.parse(req.body)
    const doctorId = await getTargetDoctorId(req)
    const scope = { id: req.params.id, ...(req.user!.role === 'DOCTOR' ? { doctorId } : {}) }
    const product = await prisma.product.findFirst({ where: scope })
    if (!product) { res.status(404).json({ message: 'Produto não encontrado' }); return }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.product.update({
        where: { id: product.id },
        data: { quantity: { increment: data.quantity } },
      })
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'ENTRADA',
          quantity: data.quantity,
          reason: data.reason || null,
          userId: req.user!.userId,
        },
      })
      return result
    })

    res.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ message: 'Dados inválidos', errors: error.errors }); return }
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// GET /api/stock/movements?productId= — histórico, pra auditoria.
router.get('/movements', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const doctorId = await getTargetDoctorId(req)
    const { productId } = req.query

    const movements = await prisma.stockMovement.findMany({
      where: {
        ...(req.user!.role === 'DOCTOR' ? { product: { doctorId } } : {}),
        ...(productId ? { productId: productId as string } : {}),
      },
      include: {
        product: { select: { id: true, name: true, unit: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json(movements)
  } catch {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
