import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth'
import userRoutes from './routes/users'
import appointmentRoutes from './routes/appointments'
import patientRoutes from './routes/patients'
import financialRoutes from './routes/financial'
import doctorRoutes from './routes/doctors'
import healthPlanRoutes from './routes/health-plans'
import medicalRecordRoutes from './routes/medical-records'
import appointmentBlockRoutes from './routes/appointment-blocks'
import teamRoutes from './routes/team'
import appointmentTypeRoutes from './routes/appointment-types'
import roomRoutes from './routes/rooms'
import documentRoutes from './routes/documents'
import notificationRoutes from './routes/notifications'
import paymentMethodRoutes from './routes/payment-methods'
import stockRoutes from './routes/stock'
import integrationRoutes from './routes/integrations'
import integrationAddonRoutes from './routes/integration-addons'
import chatbotLightRoutes from './routes/chatbot-light'
import aiAgentRoutes from './routes/ai-agent'
import myRoomsRoutes from './routes/my-rooms'
import attendanceRoutes, { attendanceStreamRouter } from './routes/attendance'
import nfseRoutes from './routes/nfse'
import { startNfseSyncJob } from './lib/nfse/service'
import { startNotificationJobs } from './lib/notification-jobs'
import { startPatientIdentityJobs } from './lib/patient-identity'
import { reconcileAllLidConversations } from './lib/attendance'
import { runStartupDatabaseCleanup } from './lib/whatsapp'
import { restoreRoomSessions, startRoomHealthWatchdog } from './lib/room-whatsapp'
import { startLightScheduler } from './lib/chatbot-light-engine'
import adminRoutes from './routes/admin'
import adminSqlRoutes from './routes/admin-sql'
import adminIntegrationsRoutes from './routes/admin-integrations'
import platformAdminRoutes from './routes/platform-admin'
import versionRoutes from './routes/version'
import readinessRoutes from './routes/readiness'
import subscriptionRoutes from './routes/subscriptions'
import kiwifyWebhookRoutes from './routes/webhooks-kiwify'
import { getAppVersion } from './lib/app-version'
import { authenticate } from './middleware/auth'
import { requireActiveSubscription } from './middleware/subscription'
import { startSubscriptionExpiryWatchdog } from './lib/subscription-access'
import { authRateLimiter, generalRateLimiter } from './middleware/rate-limit'

dotenv.config()

// ─── Boot-time guard: recusa subir em produção com segredos de exemplo ──────
// Evita o cenário "esqueci de trocar o .env" virar uma instância de produção
// rodando com JWT_SECRET/senha do banco previsíveis.
if (process.env.NODE_ENV === 'production') {
  const insecureJwtSecrets = ['change-this-secret-in-production', 'agenda-clinica-secret-fallback']
  if (!process.env.JWT_SECRET || insecureJwtSecrets.includes(process.env.JWT_SECRET)) {
    throw new Error(
      'JWT_SECRET não definido (ou usando o valor de exemplo). Configure um segredo forte no .env antes de subir em produção.'
    )
  }
  if (process.env.DATABASE_URL?.includes('clinicpass123')) {
    throw new Error(
      'DATABASE_URL está usando a senha de exemplo do Postgres. Configure POSTGRES_PASSWORD no .env antes de subir em produção.'
    )
  }
}

const app = express()
const PORT = process.env.PORT || 3001

// O backend roda atrás de um único nginx (nginx.conf) — confia em 1 salto de
// proxy pra req.ip ser o IP real do cliente. Sem isso o express-rate-limit
// enxerga todo mundo como o IP do nginx (limite compartilhado entre todos os
// usuários) e loga ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1))

// ─── CORS — allowlist explícita com suporte a subdomínios confiáveis ───────
const explicitAllowedOrigins = new Set<string>([
  'https://cliniqpro.integradata.app.br',
  'http://cliniqpro.integradata.app.br',
  'http://2.25.185.223',
  'https://2.25.185.223',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.DOMAIN ? [`https://${process.env.DOMAIN}`, `http://${process.env.DOMAIN}`] : []),
  ...(process.env.ADDITIONAL_ORIGINS ? process.env.ADDITIONAL_ORIGINS.split(',').map(s => s.trim()) : []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'] : []),
].filter(Boolean))

function isOriginAllowed(origin: string): boolean {
  if (explicitAllowedOrigins.has(origin)) {
    return true
  }

  try {
    const url = new URL(origin)
    const hostname = url.hostname.toLowerCase()

    // Permite o domínio principal e qualquer subdomínio do integradata.app.br
    if (hostname === 'integradata.app.br' || hostname.endsWith('.integradata.app.br')) {
      return true
    }

    // Permite domínios sslip.io do servidor
    if (hostname.endsWith('.sslip.io')) {
      return true
    }

    // Em ambiente de desenvolvimento, aceita localhost e 127.0.0.1
    if (process.env.NODE_ENV !== 'production' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      return true
    }
  } catch {
    return false
  }

  return false
}

app.use(cors({
  origin: (origin, callback) => {
    // Requisições sem header Origin (ex: chamadas server-to-server, curl,
    // health checks) continuam permitidas — autenticação é via Bearer token.
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true)
      return
    }

    console.warn(`[CORS] Origem não permitida bloqueada: ${origin}`)
    callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}))

// Rede de proteção geral contra abuso/flood em toda a API.
app.use('/api', generalRateLimiter)

// Captura o corpo bruto da requisição (necessário pra validar a assinatura
// HMAC do webhook da Kiwify, que precisa dos bytes originais, não do JSON já
// reserializado). Custo desprezível para as demais rotas.
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf
  },
}))
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', authRateLimiter, authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/appointments', authenticate, requireActiveSubscription, appointmentRoutes)
app.use('/api/patients', authenticate, requireActiveSubscription, patientRoutes)
app.use('/api/financial', authenticate, requireActiveSubscription, financialRoutes)
app.use('/api/nfse', authenticate, requireActiveSubscription, nfseRoutes)
app.use('/api/doctors', doctorRoutes)
app.use('/api/health-plans', authenticate, requireActiveSubscription, healthPlanRoutes)
app.use('/api/medical-records', authenticate, requireActiveSubscription, medicalRecordRoutes)
app.use('/api/appointment-blocks', authenticate, requireActiveSubscription, appointmentBlockRoutes)
// Avaliações (NFe/Teleconsulta/Avaliação) removidas do produto — rota desmontada
// de propósito, mas o arquivo e o modelo Assessment continuam intactos caso
// precise ser reativado (ver docs/assinatura-kiwify.md).
app.use('/api/team', authenticate, requireActiveSubscription, teamRoutes)
app.use('/api/appointment-types', authenticate, requireActiveSubscription, appointmentTypeRoutes)
app.use('/api/rooms', authenticate, requireActiveSubscription, roomRoutes)
app.use('/api/documents', authenticate, requireActiveSubscription, documentRoutes)
app.use('/api/notifications', authenticate, requireActiveSubscription, notificationRoutes)
app.use('/api/payment-methods', authenticate, requireActiveSubscription, paymentMethodRoutes)
app.use('/api/stock', authenticate, requireActiveSubscription, stockRoutes)
app.use('/api/integrations', authenticate, requireActiveSubscription, integrationRoutes)
app.use('/api/integration-addons', authenticate, requireActiveSubscription, integrationAddonRoutes)
app.use('/api/chatbot-light', authenticate, requireActiveSubscription, chatbotLightRoutes)
app.use('/api/ai-agent', authenticate, requireActiveSubscription, aiAgentRoutes)
app.use('/api/my/rooms', authenticate, requireActiveSubscription, myRoomsRoutes)
// Atendimento: o SSE (/stream) autentica por token curto na query (EventSource
// não manda Authorization), então é montado ANTES do authenticate. O router
// do stream só trata GET /stream; o resto cai no router autenticado.
app.use('/api/attendance', attendanceStreamRouter)
app.use('/api/attendance', authenticate, requireActiveSubscription, attendanceRoutes)
app.use('/api/admin/sql', adminSqlRoutes)
app.use('/api/admin/integrations', adminIntegrationsRoutes)
app.use('/api/platform-admin', platformAdminRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/version', versionRoutes)
app.use('/api/readiness', readinessRoutes)
app.use('/api/subscription', subscriptionRoutes)
app.use('/api/webhooks/kiwify', kiwifyWebhookRoutes)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: getAppVersion(),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  })
})

// Global Express error handler — catches any error passed via next(err) in routes
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[EXPRESS] Unhandled route error:', err?.message || err)
  if (!res.headersSent) {
    res.status(500).json({ message: 'Erro interno do servidor' })
  }
})

// Keep the process alive — unhandled rejections and exceptions must never kill the server
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught Exception:', error?.message || error)
})

app.listen(PORT, () => {
  console.log('')
  console.log('  ⚡  ClinIQ Pro — API')
  console.log(`  🚀  Servidor: http://localhost:${PORT}`)
  console.log(`  🐘  Banco: PostgreSQL`)
  console.log(`  📡  Ambiente: ${process.env.NODE_ENV || 'development'}`)
  console.log('')

  // Limpeza de dados de inicialização e correção de LIDs antigos de teste
  runStartupDatabaseCleanup()
    .then(() => {
      // Restaura conexões WhatsApp por sala
      restoreRoomSessions().catch(err => console.error('[ROOM_WA] Erro ao restaurar sessões de sala:', err))
      // Unifica conversas duplicadas do mesmo contato (LID x telefone) já existentes
      reconcileAllLidConversations().catch(() => {})
    })
    .catch(err => console.error('[WA] Erro na limpeza inicial:', err))

  // Inicia watchdog que monitora e restaura sessões WhatsApp que morrem silenciosamente
  startRoomHealthWatchdog()

  // Inicia o scheduler do Chatbot Light para disparar avisos atrasados e lembretes periódicos
  startLightScheduler()

  // Verifica periodicamente trials expirados e marca a assinatura como bloqueada
  startSubscriptionExpiryWatchdog()

  // Notificações periódicas (follow-up de leads, pré-agendamentos, fila de atendimento)
  startNotificationJobs()

  // NFS-e: reconcilia emissões sem resposta conclusiva da Sefin
  startNfseSyncJob()

  // Identidade do paciente: phoneKey, leads com LID e fusão automática segura
  // de duplicados (inicialização + a cada 30 min) — ver lib/patient-identity.ts
  startPatientIdentityJobs()
})

export default app
