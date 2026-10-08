import jwt from 'jsonwebtoken'

// Exportado para tokens derivados (ex.: token curto do stream SSE em
// lib/attendance-access.ts), que usam uma chave derivada desta.
export const JWT_SECRET = process.env.JWT_SECRET || 'agenda-clinica-secret-fallback'
// Access token de vida curta — a sessão de fato é mantida pelo refresh token
// (revogável, ver utils/refresh-token.ts), não pelo JWT em si.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h'

export interface JwtPayload {
  userId: string
  email: string
  role: string
  name: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}
