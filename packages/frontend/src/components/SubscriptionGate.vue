<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock, Zap, Clock } from 'lucide-vue-next'
import { useSubscription } from '../composables/useSubscription'
import { useAuthStore } from '../stores/auth'

const ALWAYS_ALLOWED_PREFIXES = ['/configuracoes/assinatura', '/configuracoes/perfil', '/configuracoes/ajuda']

const BLOCKED_MESSAGES: Record<string, { title: string; body: string }> = {
  PAYMENT_PENDING: {
    title: 'Aguardando confirmação do pagamento',
    body: 'Identificamos um pagamento em processamento. Assim que for confirmado, o acesso é liberado automaticamente.',
  },
  PAYMENT_LATE: {
    title: 'Pagamento em atraso',
    body: 'Regularize a assinatura para continuar utilizando a Clinic Pro.',
  },
  SUBSCRIPTION_CANCELED: {
    title: 'Assinatura cancelada',
    body: 'Assine novamente para recuperar o acesso completo.',
  },
  TRIAL_EXPIRED: {
    title: 'Seu período gratuito terminou',
    body: 'Assine a Clinic Pro para continuar utilizando Agenda, Prontuário, Financeiro e Chatbot Light.',
  },
  SUBSCRIPTION_BLOCKED: {
    title: 'Acesso à Clinic Pro bloqueado',
    body: 'Regularize a assinatura para recuperar o acesso da sua equipe.',
  },
}

const { subscription, accessAllowed, isLoading, canManageBilling } = useSubscription()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const onAllowedPage = computed(() => ALWAYS_ALLOWED_PREFIXES.some(prefix => route.path.startsWith(prefix)))
const showGate = computed(() => !isLoading.value && !!authStore.user && !accessAllowed.value && !onAllowedPage.value)
const message = computed(() => BLOCKED_MESSAGES[subscription.value?.reason ?? ''] ?? BLOCKED_MESSAGES.SUBSCRIPTION_BLOCKED)
</script>

<template>
  <slot v-if="!showGate" />
  <div v-else class="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center animate-page-enter">
    <div class="max-w-md">
      <div class="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Clock v-if="subscription?.reason === 'PAYMENT_PENDING'" class="w-8 h-8 text-amber-500" />
        <Lock v-else class="w-8 h-8 text-red-500" />
      </div>

      <h2 class="text-xl font-bold text-slate-900 mb-2">{{ message.title }}</h2>

      <template v-if="canManageBilling">
        <p class="text-slate-500 text-sm mb-6 leading-relaxed">
          {{ message.body }}<template v-if="subscription"> — R$ {{ subscription.monthlyPrice }}/mês.</template>
        </p>
        <button class="btn-primary w-full justify-center" @click="router.push('/configuracoes/assinatura')">
          <Zap class="w-4 h-4" />
          Regularizar assinatura
        </button>
      </template>
      <p v-else class="text-slate-500 text-sm leading-relaxed">
        O acesso da equipe está temporariamente indisponível. A assinatura da Clinic Pro precisa ser
        regularizada pelo médico ou especialista responsável.
      </p>
    </div>
  </div>
</template>
