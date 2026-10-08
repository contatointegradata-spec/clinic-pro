// Saúde operacional: backup do banco e conexões de WhatsApp. Alimenta
// GET /api/health/details e o alerta periódico de backup para administradores.
import fs from 'fs'
import { prisma } from './prisma'
import { createNotification } from './notifications'

const BACKUP_STATUS_FILE = process.env.BACKUP_STATUS_FILE || '/backups/status.json'
const BACKUP_MAX_AGE_HOURS = Number(process.env.BACKUP_MAX_AGE_HOURS) || 36

export interface BackupStatus {
  available: boolean
  status: 'ok' | 'error' | 'unknown'
  lastSuccessAt: string | null
  checkedAt: string | null
  ageHours: number | null
  healthy: boolean
  bytes: number | null
  backupsKept: number | null
  message: string
}

export function readBackupStatus(): BackupStatus {
  try {
    const raw = JSON.parse(fs.readFileSync(BACKUP_STATUS_FILE, 'utf8')) as Record<string, unknown>
    const lastSuccessAt = typeof raw.lastSuccessAt === 'string' ? raw.lastSuccessAt : null
    const ageHours = lastSuccessAt ? (Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000 : null
    const status = raw.status === 'ok' ? 'ok' : raw.status === 'error' ? 'error' : 'unknown'
    return {
      available: true,
      status,
      lastSuccessAt,
      checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : null,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      healthy: status === 'ok' && ageHours !== null && ageHours <= BACKUP_MAX_AGE_HOURS,
      bytes: typeof raw.bytes === 'number' ? raw.bytes : null,
      backupsKept: typeof raw.backupsKept === 'number' ? raw.backupsKept : null,
      message: typeof raw.message === 'string' ? raw.message : '',
    }
  } catch {
    return {
      available: false, status: 'unknown', lastSuccessAt: null, checkedAt: null, ageHours: null,
      healthy: false, bytes: null, backupsKept: null, message: 'status do backup não encontrado',
    }
  }
}

export async function whatsappHealth() {
  const rows = await prisma.roomWhatsAppConnection.groupBy({ by: ['status'], _count: { _all: true } })
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r._count._all])) as Record<string, number>
  const downLong = await prisma.roomWhatsAppConnection.count({
    where: { status: { in: ['DISCONNECTED', 'QUARANTINED'] }, reconnectAttempts: { gt: 0 }, disconnectedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
  })
  return { byStatus, droppedAndNotRecovered: downLong }
}

// Alerta os administradores da plataforma quando o backup falhou ou está
// velho. Sem status.json (ex.: ambiente local) não alerta — só aparece no
// /api/health/details. Deduplicado por dia.
export async function checkBackupFreshness(): Promise<void> {
  const backup = readBackupStatus()
  if (!backup.available || backup.healthy) return
  const admins = await prisma.user.findMany({
    where: { active: true, OR: [{ role: 'ADMIN' }, { isPlatformDeveloper: true }] },
    select: { id: true },
  })
  const day = new Date().toISOString().slice(0, 10)
  const detail = backup.status === 'error'
    ? `A última tentativa falhou (${backup.message}).`
    : `O último backup válido tem ${backup.ageHours ?? '?'} horas.`
  for (const admin of admins) {
    await createNotification({
      userId: admin.id,
      title: 'Backup do banco precisa de atenção',
      message: `${detail} Verifique o serviço "backup" na VPS (docker compose logs backup).`,
      type: 'ALERT',
      category: 'SYSTEM',
      dedupeKey: `backup-alert:${day}:${admin.id}`,
    })
  }
}

let backupTimer: NodeJS.Timeout | null = null
export function startBackupWatch(): void {
  if (backupTimer) return
  backupTimer = setInterval(() => {
    checkBackupFreshness().catch(err => console.error('[backup-watch]', err))
  }, 60 * 60_000)
  checkBackupFreshness().catch(err => console.error('[backup-watch]', err))
}
