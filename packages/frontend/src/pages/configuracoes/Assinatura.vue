<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Zap, CheckCircle2, Clock, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useSubscription } from '../../composables/useSubscription'

const INCLUDED_FEATURES = [
  'Agenda', 'Prontuário', 'Financeiro', 'WhatsApp', 'Chatbot Light', 'Relatórios', 'Configurações',
]

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  TRIAL: { label: 'Período gratuito', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  ACTIVE: { label: 'Ativa', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING_PAYMENT: { label: 'Pagamento pendente', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAST_DUE: { label: 'Pagamento atrasado', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  CANCELED: { label: 'Cancelada', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  BLOCKED: { label: 'Bloqueada', color: 'bg-red-50 text-red-700 border-red-200' },
}

const { subscription, isLoading, canManageBilling, refreshSubscription } = useSubscription()
const router = useRouter()

const opening = ref(false)
const reconciling = ref(false)

async function openCheckout() {
  opening.value = true
  try {
    const { data } = await api.post('/subscription/checkout')
    window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer')
    router.push('/configuracoes/assinatura/pendente')
  } catch {
    toast.error('Não foi possível abrir o checkout. Tente novamente.')
  } finally {
    opening.value = false
  }
}

async function reconcile() {
  reconciling.value = true
  try {
    const { data } = await api.post('/subscription/reconcile')
    toast.success(data.message || 'Verificação concluída.')
    refreshSubscription()
  } catch (err: unknown) {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(message || 'Não foi possível verificar o pagamento agora.')
  } finally {
    reconciling.value = false
  }
}
</script>

<template>
  <div v-if="isLoading || !subscription" class="animate-pulse text-slate-400 text-sm">Carregando...</div>
  <div v-else class="max-w-2xl mx-auto space-y-6 animate-page-enter">
    <div class="card p-6">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 class="text-lg font-semibold text-slate-900">{{ subscription.product }}</h1>
          <p class="text-2xl font-bold text-slate-900 mt-1">
            R$ {{ subscription.monthlyPrice }}<span class="text-sm font-normal text-slate-400">/mês</span>
          </p>
        </div>
        <span :class="['px-3 py-1 rounded-full text-xs font-semibold border', (STATUS_LABEL[subscription.status] ?? STATUS_LABEL.BLOCKED).color]">
          {{ (STATUS_LABEL[subscription.status] ?? STATUS_LABEL.BLOCKED).label }}
        </span>
      </div>

      <ul class="grid grid-cols-2 gap-2 mb-6">
        <li v-for="f in INCLUDED_FEATURES" :key="f" class="flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0" />
          {{ f }}
        </li>
      </ul>

      <div v-if="subscription.status === 'TRIAL'" class="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-xl px-4 py-3 mb-4 text-sm text-primary-700">
        <Clock class="w-4 h-4 flex-shrink-0" />
        {{ subscription.trialDaysRemaining === 0
          ? 'Último dia do seu período gratuito.'
          : `Restam ${subscription.trialDaysRemaining} dia${subscription.trialDaysRemaining !== 1 ? 's' : ''} do seu período gratuito.` }}
        <span v-if="subscription.trialEndsAt" class="text-primary-400">
          (até {{ format(new Date(subscription.trialEndsAt), "d 'de' MMMM", { locale: ptBR }) }})
        </span>
      </div>

      <div v-if="subscription.status === 'PENDING_PAYMENT'" class="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
        <Clock class="w-4 h-4 flex-shrink-0" />
        Aguardando confirmação do pagamento (Pix/boleto). O acesso é liberado automaticamente assim que for confirmado.
      </div>

      <div v-if="subscription.status === 'BLOCKED' || subscription.status === 'PAST_DUE'" class="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
        <AlertTriangle class="w-4 h-4 flex-shrink-0" />
        {{ subscription.status === 'PAST_DUE'
          ? 'Identificamos um problema no pagamento. Regularize para manter o acesso.'
          : 'Assinatura bloqueada. Assine para restaurar o acesso completo.' }}
      </div>

      <p v-if="subscription.currentPeriodEndsAt && subscription.status === 'ACTIVE'" class="text-sm text-slate-500 mb-4">
        Próxima renovação em {{ format(new Date(subscription.currentPeriodEndsAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR }) }}.
      </p>

      <div v-if="canManageBilling" class="flex flex-col sm:flex-row gap-3">
        <button
          :disabled="opening"
          class="btn-primary flex-1 justify-center"
          @click="openCheckout"
        >
          <Zap class="w-4 h-4" />
          Assinar por R$ {{ subscription.monthlyPrice }}/mês
          <ExternalLink class="w-3.5 h-3.5" />
        </button>

        <button
          :disabled="reconciling"
          class="btn-secondary flex-1 justify-center"
          @click="reconcile"
        >
          <RefreshCw :class="['w-4 h-4', reconciling ? 'animate-spin' : '']" />
          Já realizei o pagamento
        </button>
      </div>
      <p v-else class="text-sm text-slate-400">
        Somente o administrador da clínica pode gerenciar a assinatura.
      </p>
    </div>

    <div v-if="subscription.payments.length > 0" class="card p-6">
      <h2 class="text-sm font-semibold text-slate-700 mb-3">Histórico de pagamentos</h2>
      <div class="space-y-2">
        <div v-for="p in subscription.payments" :key="p.id" class="flex items-center justify-between text-sm border-b border-slate-50 pb-2 last:border-0">
          <span class="text-slate-500">
            {{ format(new Date(p.approvedAt ?? p.createdAt), "d MMM yyyy", { locale: ptBR }) }}
          </span>
          <span class="text-slate-700 font-medium">R$ {{ (p.amountCents / 100).toFixed(2).replace('.', ',') }}</span>
          <span class="text-xs text-slate-400">{{ p.status }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
