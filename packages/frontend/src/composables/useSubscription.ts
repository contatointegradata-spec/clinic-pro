import { computed } from 'vue'
import api from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useQuery } from './useQuery'

export type SubscriptionStatusValue = 'TRIAL' | 'ACTIVE' | 'PENDING_PAYMENT' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'

export interface SubscriptionPaymentRecord {
  id: string
  kiwifyOrderId: string
  status: string
  amountCents: number
  approvedAt?: string | null
  createdAt: string
}

export interface SubscriptionStatusResponse {
  product: string
  monthlyPrice: string
  status: SubscriptionStatusValue
  accessAllowed: boolean
  reason: string
  trialEndsAt: string | null
  trialDaysRemaining: number | null
  currentPeriodEndsAt: string | null
  lastPaymentAt: string | null
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
