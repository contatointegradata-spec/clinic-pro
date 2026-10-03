import { defineStore } from 'pinia'
import type { AuthUser } from '../types'

interface AuthState {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
    isAuthenticated: false,
  }),
  actions: {
    setAuth(user: AuthUser, token: string) {
      localStorage.setItem('token', token)
      this.user = user
      this.token = token
      this.isAuthenticated = true
    },
    logout() {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      this.user = null
      this.token = null
      this.isAuthenticated = false
    },
    updateUser(partialUser: Partial<AuthUser>) {
      if (this.user) {
        this.user = { ...this.user, ...partialUser }
      }
    },
  },
  persist: {
    key: 'cliniq-auth',
    paths: ['user', 'token', 'isAuthenticated'],
  },
})
