import { computed } from 'vue'
import api from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useQuery } from './useQuery'

export type SubscriptionStatusValue = 'TRIAL' | 'ACTIVE' | 'PENDING_PAYMENT' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'

// Status calculado em tempo real pelo backend — é o que as telas devem exibir
// (o `status` gravado no banco pode estar defasado, ex.: trial já vencido).
export type SubscriptionDisplayStatus =
  | 'TRIAL' | 'TRIAL_EXPIRED' | 'ACTIVE' | 'COURTESY' | 'CANCELED_ACTIVE'
  | 'PENDING_PAYMENT' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'

export interface SubscriptionPaymentRecord {
  id: string
  kiwifyOrderId: string
  status: string
  amountCents: number
  paymentMethod?: string | null
  approvedAt?: string | null
  createdAt: string
}

export interface SubscriptionStatusResponse {
  product: string
  monthlyPrice: string
  trialDays: number
  status: SubscriptionStatusValue
  displayStatus: SubscriptionDisplayStatus
  accessAllowed: boolean
  subscriptionValid: boolean
  enforced: boolean
  reason: string
  trialEndsAt: string | null
  trialDaysRemaining: number | null
  currentPeriodEndsAt: string | null
  lastPaymentAt: string | null
  canceledAt: string | null
  checkoutAvailable: boolean
  payments: SubscriptionPaymentRecord[]
  isPlatformAdmin?: boolean
}

export function useSubscription() {
  const authStore = useAuthStore()
  const enabled = computed(() => !!authStore.user)

  const { data, isLoading, refetch } = useQuery<SubscriptionStatusResponse>({
    key: 'subscription-status',
    queryFn: () => api.get('/subscription/status').then(r => r.data),
    enabled,
    staleTime: 60 * 1000,
  })

  return {
    subscription: computed(() => data.value ?? null),
    isLoading,
    accessAllowed: computed(() => data.value?.accessAllowed ?? true),
    isPlatformAdmin: computed(() => data.value?.isPlatformAdmin ?? false),
    canManageBilling: computed(() => authStore.user?.role === 'DOCTOR'),
    refreshSubscription: refetch,
  }
}
