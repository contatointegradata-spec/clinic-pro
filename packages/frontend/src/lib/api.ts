import axios from 'axios'
import { useAuthStore } from '../stores/auth'

function resolveApiBaseUrl(): string {
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim()

  if (typeof window !== 'undefined') {
    // 1. Se a página foi carregada sobre HTTPS (ex: https://cliniqpro.integradata.app.br),
    // qualquer requisição para http:// é sumariamente bloqueada pelo navegador como Mixed Content.
    // Usamos '/api' relativo na mesma origem segura.
    if (window.location.protocol === 'https:') {
      if (!envUrl || envUrl.startsWith('http://') || !envUrl.startsWith('https://')) {
        return '/api'
      }
    }

    // 2. Se estiver sendo acessado por um domínio (não localhost e não o IP direto),
    // sempre priorizar a rota relativa '/api' para evitar CORS e falha de certificado SSL.
    if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      if (envUrl && (envUrl.includes('2.25.185.223') || !envUrl.includes(window.location.hostname))) {
        return '/api'
      }
    }
  }

  return envUrl || '/api'
}

export const API_BASE_URL = resolveApiBaseUrl()

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// O access token dura pouco (ver JWT_EXPIRES_IN no backend) — quando uma
// requisição volta 401 por token expirado, tentamos renovar em segundo
// plano com o refresh token antes de jogar o usuário pro login. Uma única
// renovação em voo por vez (requisições simultâneas compartilham a mesma
// promise) evita disparar vários /auth/refresh ao mesmo tempo.
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return null

  try {
    const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken })
    const { token, refreshToken: newRefreshToken } = response.data
    useAuthStore().setTokens(token, newRefreshToken)
    return token
  } catch {
    return null
  }
}

api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config
    const isAuthEndpoint = typeof originalRequest?.url === 'string' && originalRequest.url.includes('/auth/')

    if (error.response?.status === 401 && originalRequest && !originalRequest._retried && !isAuthEndpoint) {
      originalRequest._retried = true

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
      }
      const newToken = await refreshPromise

      if (newToken) {
        originalRequest.headers = originalRequest.headers ?? {}
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      }

      useAuthStore().logout(true)
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }

    if (error.response?.status === 402 && error.response?.data?.code === 'SUBSCRIPTION_REQUIRED') {
      const billingPath = '/configuracoes/assinatura'
      if (!window.location.pathname.startsWith(billingPath)) {
        window.location.href = error.response.data.redirectTo || billingPath
      }
    }

    return Promise.reject(error)
  }
)

export default api
