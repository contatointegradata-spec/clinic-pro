import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from './auth'
import { getEffectiveDoctorId } from '../lib/secretaryAccess'
import { calculateClinicAccess } from '../lib/subscription-access'
import { isSubscriptionEnforced } from '../lib/kiwify-config'

// Gate de assinatura — aplicado nos routers operacionais (agenda, pacientes,
// prontuário, financeiro, WhatsApp/chatbot etc). Roda depois de authenticate().
// Enquanto o bloqueio estiver desligado (interruptor em Admin > Integrações,
// ou SUBSCRIPTION_ENFORCEMENT_ENABLED=true no .env para forçar), não bloqueia
// nada — permite validar a Kiwify antes de ativar o bloqueio real.
export async function requireActiveSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!(await isSubscriptionEnforced())) {
    next()
    return
  }

  if (req.user?.role === 'ADMIN') {
    next()
    return
  }

  try {
    const doctorId = await getEffectiveDoctorId(req)
    if (!doctorId) {
      next()
      return
    }

    const subscription = await prisma.doctorSubscription.findUnique({ where: { doctorId } })
    const access = calculateClinicAccess(subscription, new Date())

    if (!access.allowed) {
      res.status(402).json({
        code: 'SUBSCRIPTION_REQUIRED',
        reason: access.reason,
        redirectTo: access.redirectTo ?? '/configuracoes/assinatura',
      })
      return
    }

    next()
  } catch (err) {
    console.error('[SUBSCRIPTION] Erro ao verificar assinatura:', err)
    next() // Falha no banco não pode derrubar a requisição
  }
}
