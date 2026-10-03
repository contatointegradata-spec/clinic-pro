import rateLimit from 'express-rate-limit'

// Login/registro/recuperação de senha são os alvos clássicos de brute-force
// e enumeração de e-mail — limite estrito por IP.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' },
})

// Rede de proteção geral para toda a API — bem mais frouxo, só pra conter
// abuso/flood básico sem incomodar uso normal do sistema.
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas requisições. Tente novamente em instantes.' },
})
