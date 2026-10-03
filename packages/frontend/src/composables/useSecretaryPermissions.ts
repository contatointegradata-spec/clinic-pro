import { computed } from 'vue'
import api from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useQuery } from './useQuery'

export const SECRETARY_PERMISSION_KEYS = [
  'financeiro',
  'chatbot_light_operar',
  'chatbot_light_configurar',
  'documentos',
  'salas',
  'integracao_webhook',
  'integracao_google_calendar',
  'integracao_gmail',
  'integracao_whatsapp',
  'integracao_ai_agent',
] as const

export type SecretaryPermissionKey = typeof SECRETARY_PERMISSION_KEYS[number]
export type SecretaryPermissions = Partial<Record<SecretaryPermissionKey, boolean>>

export const SECRETARY_PERMISSION_LABELS: Record<SecretaryPermissionKey, string> = {
  financeiro: 'Financeiro (Painel Financeiro)',
  chatbot_light_operar: 'Chatbot Light — Uso do dia a dia',
  chatbot_light_configurar: 'Chatbot Light — Configurações e Campanhas',
  documentos: 'Documentos',
  salas: 'Clínica (Salas)',
  integracao_webhook: 'Integração — Webhooks',
  integracao_google_calendar: 'Integração — Google Calendar',
  integracao_gmail: 'Integração — Gmail',
  integracao_whatsapp: 'Integração — WhatsApp',
  integracao_ai_agent: 'Integração — Agente de IA',
}

export const INTEGRATION_PERMISSION_KEYS: SecretaryPermissionKey[] = [
  'integracao_webhook',
  'integracao_google_calendar',
  'integracao_gmail',
  'integracao_whatsapp',
  'integracao_ai_agent',
]

export const PERMISSION_KEY_TO_INTEGRATION_TYPE: Partial<Record<SecretaryPermissionKey, string>> = {
  integracao_webhook: 'WEBHOOK',
  integracao_google_calendar: 'GOOGLE_CALENDAR',
  integracao_gmail: 'GOOGLE_GMAIL',
  integracao_whatsapp: 'WHATSAPP',
  integracao_ai_agent: 'AI_AGENT',
}

/**
 * DOCTOR e ADMIN não são afetados por esse sistema (sempre liberado).
 * SECRETARY só vê o que o médico marcou em "Gestão de Acessos".
 */
export function useSecretaryPermissions() {
  const authStore = useAuthStore()
  const isSecretary = computed(() => authStore.user?.role === 'SECRETARY')

  const { data, isLoading } = useQuery<SecretaryPermissions>({
    key: 'secretary-my-permissions',
    queryFn: () => api.get('/team/my-permissions').then(r => r.data),
    enabled: isSecretary,
    staleTime: 60 * 1000,
  })

  const can = (key: SecretaryPermissionKey) => {
    if (!isSecretary.value) return true
    return !!data.value?.[key]
  }

  return { isSecretary, permissions: computed(() => data.value ?? {}), isLoading: computed(() => isSecretary.value && isLoading.value), can }
}
