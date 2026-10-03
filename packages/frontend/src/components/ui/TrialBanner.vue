<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, Clock, X, Zap } from 'lucide-vue-next'
import { useSubscription } from '../../composables/useSubscription'

const { subscription, accessAllowed, canManageBilling } = useSubscription()
const router = useRouter()
const dismissed = ref(false)

const daysRemaining = computed(() => subscription.value?.trialDaysRemaining)
const shouldShow = computed(() =>
  !dismissed.value
  && canManageBilling.value
  && accessAllowed.value
  && subscription.value?.status === 'TRIAL'
  && daysRemaining.value != null
  && daysRemaining.value <= 3
)
const isUrgent = computed(() => daysRemaining.value === 0)
</script>

<template>
  <div v-if="shouldShow" :class="['flex items-center gap-3 px-4 py-2.5 text-sm font-medium flex-shrink-0', isUrgent ? 'bg-red-600 text-white' : 'bg-amber-500 text-white']">
    <AlertTriangle v-if="isUrgent" class="w-4 h-4 flex-shrink-0 animate-pulse" />
    <Clock v-else class="w-4 h-4 flex-shrink-0" />

    <span class="flex-1 text-center">
      <template v-if="isUrgent">Último dia do período gratuito — assine hoje para não perder acesso</template>
      <template v-else>Seu período gratuito termina em {{ daysRemaining }} dia{{ daysRemaining !== 1 ? 's' : '' }}</template>
    </span>

    <button class="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors text-xs font-bold whitespace-nowrap" @click="router.push('/configuracoes/assinatura')">
      <Zap class="w-3 h-3" />
      Assinar por R$ {{ subscription?.monthlyPrice }}/mês
    </button>

    <button class="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0" aria-label="Fechar aviso" @click="dismissed = true">
      <X class="w-3.5 h-3.5" />
    </button>
  </div>
</template>
