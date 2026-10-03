import { defineStore } from 'pinia'
import api from '../lib/api'
import type { AuthUser } from '../types'

interface AuthState {
  user: AuthUser | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
  }),
  actions: {
    setAuth(user: AuthUser, token: string, refreshToken: string) {
      localStorage.setItem('token', token)
      localStorage.setItem('refreshToken', refreshToken)
      this.user = user
      this.token = token
      this.refreshToken = refreshToken
      this.isAuthenticated = true
    },
    // Usado pelo interceptor do axios ao renovar o access token em segundo
    // plano — não mexe no usuário logado.
    setTokens(token: string, refreshToken: string) {
      localStorage.setItem('token', token)
      localStorage.setItem('refreshToken', refreshToken)
      this.token = token
      this.refreshToken = refreshToken
    },
    // `skipBackendCall` é usado quando o próprio interceptor já descobriu
    // que a sessão é inválida (refresh falhou) — nesse caso não faz sentido
    // tentar mais uma chamada autenticada só para revogar um token que o
    // servidor já não reconhece.
    async logout(skipBackendCall = false) {
      // Limpa o estado local de forma síncrona primeiro — o componente que
      // chama logout() tipicamente navega pro /login logo em seguida sem
      // aguardar esta função, então isAuthenticated precisa já estar false
      // antes do primeiro `await` (senão o guard de rota do /login ainda
      // veria uma sessão "autenticada" por uma fração de segundo e
      // redirecionaria de volta pro dashboard).
      const pendingRefreshToken = this.refreshToken
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('user')
      this.user = null
      this.token = null
      this.refreshToken = null
      this.isAuthenticated = false

      if (!skipBackendCall && pendingRefreshToken) {
        try {
          await api.post('/auth/logout', { refreshToken: pendingRefreshToken })
        } catch {
          // Mesmo se a revogação falhar (rede, servidor fora), a sessão
          // local já está limpa — o refresh token vai expirar sozinho.
        }
      }
    },
    updateUser(partialUser: Partial<AuthUser>) {
      if (this.user) {
        this.user = { ...this.user, ...partialUser }
      }
    },
  },
  persist: {
    key: 'cliniq-auth',
    paths: ['user', 'token', 'refreshToken', 'isAuthenticated'],
  },
})
