import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate, requireRole, AuthRequest } from '../middleware/auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'
import { calculateClinicAccess, getDisplayStatus, ensureTrialSubscription } from '../lib/subscription-access'
import { getResolvedKiwifyConfig, isSubscriptionEnforced } from '../lib/kiwify-config'
import { buildKiwifyCheckoutUrl, getKiwifySale } from '../integrations/kiwify/kiwify.client'
import { CLINIC_PRO_SUBSCRIPTION, monthlyPriceLabel } from '../lib/billing-config'

const router = Router()
router.use(authenticate)

// GET /api/subscription/status — qualquer papel autenticado.
router.get('/status', async (req: AuthRequest, res) => {
  try {
    if (req.user?.role === 'ADMIN') {
      res.json({ status: 'ACTIVE', accessAllowed: true, isPlatformAdmin: true })
      return
    }

    const doctorId = await getEffectiveDoctorId(req)
    if (!doctorId) {
      res.status(404).json({ message: 'Clínica não encontrada' })
      return
    }

    // Nunca deixa um médico sem linha de assinatura (contas antigas).
    await ensureTrialSubscription(doctorId).catch(() => undefined)

    const [subscription, enforced, kiwify] = await Promise.all([
      prisma.doctorSubscription.findUnique({
        where: { doctorId },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 10 } },
      }),
      isSubscriptionEnforced(),
      getResolvedKiwifyConfig(),
    ])

    const access = calculateClinicAccess(subscription, new Date())

    res.json({
      product: CLINIC_PRO_SUBSCRIPTION.name,
      monthlyPrice: monthlyPriceLabel(),
      trialDays: CLINIC_PRO_SUBSCRIPTION.trialDays,
      status: subscription?.status ?? 'BLOCKED',
      displayStatus: getDisplayStatus(subscription, access),
      // Com o bloqueio desligado o sistema não barra ninguém — a tela não
      // pode bloquear o que a API libera.
      accessAllowed: enforced ? access.allowed : true,
      subscriptionValid: access.allowed,
      enforced,
      reason: access.reason,
      trialEndsAt: subscription?.trialEndsAt ?? null,
      trialDaysRemaining: access.trialDaysRemaining ?? null,
      currentPeriodEndsAt: subscription?.currentPeriodEndsAt ?? null,
      lastPaymentAt: subscription?.lastPaymentAt ?? null,
      canceledAt: subscription?.canceledAt ?? null,
      checkoutAvailable: !!kiwify.checkoutUrl,
      payments: subscription?.payments ?? [],
    })
  } catch (error) {
    console.error('[subscription/status] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// POST /api/subscription/checkout — só o médico dono da clínica.
router.post('/checkout', requireRole('DOCTOR'), async (req: AuthRequest, res) => {
  try {
    const doctorId = req.user!.userId

    await ensureTrialSubscription(doctorId).catch(() => undefined)
    const subscription = await prisma.doctorSubscription.findUnique({ where: { doctorId } })
    if (!subscription) {
      res.status(404).json({ message: 'Assinatura não encontrada' })
      return
    }

    // Evita cobrança em dobro: assinatura paga e vigente não abre novo checkout.
    const access = calculateClinicAccess(subscription, new Date())
    if (subscription.status === 'ACTIVE' && access.reason === 'SUBSCRIPTION_ACTIVE') {
      res.status(409).json({ message: 'Sua assinatura já está ativa — não é preciso pagar novamente.' })
      return
    }

    const checkoutAttempt = await prisma.subscriptionCheckoutAttempt.create({
      data: {
        doctorId,
        userId: req.user!.userId,
        status: 'CREATED',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    const checkoutUrl = await buildKiwifyCheckoutUrl({
      doctorId,
      userId: req.user!.userId,
      checkoutAttemptId: checkoutAttempt.id,
    })

    await prisma.subscriptionCheckoutAttempt.update({
      where: { id: checkoutAttempt.id },
      data: { checkoutUrl },
    })

    res.json({ checkoutUrl })
  } catch (error) {
    console.error('[subscription/checkout] erro:', error)
    res.status(500).json({ message: error instanceof Error ? error.message : 'Erro interno do servidor' })
  }
})

// POST /api/subscription/reconcile — "Já realizei o pagamento". Rate-limited
// em memória (1 tentativa a cada 15s por médico) — best-effort, consulta a
// API da Kiwify quando as credenciais estiverem configuradas.
const lastReconcileAttempt = new Map<string, number>()
const RECONCILE_MIN_INTERVAL_MS = 15_000

router.post('/reconcile', requireRole('DOCTOR'), async (req: AuthRequest, res) => {
  const doctorId = req.user!.userId
  const lastAttempt = lastReconcileAttempt.get(doctorId) ?? 0

  if (Date.now() - lastAttempt < RECONCILE_MIN_INTERVAL_MS) {
    res.status(429).json({ message: 'Aguarde alguns segundos antes de tentar novamente' })
    return
  }
  lastReconcileAttempt.set(doctorId, Date.now())

  try {
    const subscription = await prisma.doctorSubscription.findUnique({ where: { doctorId } })
    if (!subscription) {
      res.status(404).json({ message: 'Assinatura não encontrada' })
      return
    }

    if (subscription.lastKiwifyOrderId) {
      const sale = await getKiwifySale(subscription.lastKiwifyOrderId)
      if (sale && ['paid', 'approved'].includes(sale.status.toLowerCase()) && subscription.status !== 'ACTIVE') {
        // A consulta confirmou o pagamento antes do webhook chegar — o próprio
        // webhook, quando chegar, é quem efetivamente ativa (idempotente).
        res.json({ status: subscription.status, reconciled: false, message: 'Pagamento identificado, aguardando confirmação automática.' })
        return
      }
    }

    const access = calculateClinicAccess(subscription, new Date())
    res.json({ status: subscription.status, accessAllowed: access.allowed, reconciled: false })
  } catch (error) {
    console.error('[subscription/reconcile] erro:', error)
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

export default router
