import * as nodeCrypto from 'crypto'
import { prisma } from '../lib/prisma'

const REFRESH_TOKEN_EXPIRES_IN_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS) || 30

function hashToken(token: string): string {
  return nodeCrypto.createHash('sha256').update(token).digest('hex')
}

// Gera um novo refresh token, grava só o hash no banco (mesmo padrão do
// resetToken de senha) e devolve o valor em texto puro pra entregar ao
// cliente uma única vez.
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = nodeCrypto.randomBytes(40).toString('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  })

  return token
}

// Valida um refresh token (existe, não expirou, não foi revogado) e devolve
// o userId associado, ou null se inválido por qualquer motivo.
export async function verifyRefreshToken(token: string): Promise<{ id: string; userId: string } | null> {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } })

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    return null
  }

  return { id: record.id, userId: record.userId }
}

// Rotação: revoga o token usado e emite um novo — limita a janela de uso de
// um refresh token vazado a uma única troca.
export async function rotateRefreshToken(oldTokenId: string, userId: string): Promise<string> {
  await prisma.refreshToken.update({ where: { id: oldTokenId }, data: { revokedAt: new Date() } })
  return issueRefreshToken(userId)
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// Usado no logout "de todos os dispositivos" (ex.: troca de senha) — revoga
// todas as sessões ativas do usuário de uma vez.
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
