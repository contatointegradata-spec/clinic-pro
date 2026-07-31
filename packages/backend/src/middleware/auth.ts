import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../utils/jwt'
import { prisma } from '../lib/prisma'

export interface AuthRequest extends Request {
  user?: {
    userId: string
    email: string
    role: string
    name: string
    isPlatformDeveloper: boolean
    notificationsAccess: boolean
    integrationsAccess: boolean
  }
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token não fornecido' })
    return
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = verifyToken(token)

    // Verify user still exists and is active in the current DB, and pull
    // fresh role/permission flags — reading these from the DB (instead of
    // trusting the JWT payload) means a permission grant/revoke by the
    // platform developer takes effect immediately, without a new login.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId, active: true },
      select: {
        id: true,
        role: true,
        isPlatformDeveloper: true,
        notificationsAccess: true,
        integrationsAccess: true,
      },
    })

    if (!user) {
      res.status(401).json({ message: 'Sessão expirada. Faça login novamente.' })
      return
    }

    req.user = {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: user.role,
      isPlatformDeveloper: user.isPlatformDeveloper,
      notificationsAccess: user.notificationsAccess,
      integrationsAccess: user.integrationsAccess,
    }
    next()
  } catch {
    res.status(401).json({ message: 'Token inválido ou expirado' })
  }
}

export function requirePlatformDeveloper(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ message: 'Não autenticado' })
    return
  }

  if (!req.user.isPlatformDeveloper) {
    res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' })
    return
  }

  next()
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Não autenticado' })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Acesso negado. Permissão insuficiente.' })
      return
    }

    next()
  }
}

