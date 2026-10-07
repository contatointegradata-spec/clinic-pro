<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Zap, CheckCircle2, Clock, AlertTriangle, ExternalLink, RefreshCw, ShieldCheck, Gift, Info } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import { useSubscription, type SubscriptionDisplayStatus } from '../../composables/useSubscription'

const INCLUDED_FEATURES = [
  'Agenda', 'Prontuário', 'Financeiro', 'WhatsApp', 'Chatbot Light', 'Relatórios', 'Configurações',
]

const STATUS_LABEL: Record<SubscriptionDisplayStatus, { label: string; color: string }> = {
  TRIAL: { label: 'Teste grátis', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  TRIAL_EXPIRED: { label: 'Teste encerrado', color: 'bg-red-50 text-red-700 border-red-200' },
  ACTIVE: { label: 'Ativa', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  COURTESY: { label: 'Liberada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELED_ACTIVE: { label: 'Cancelada', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_PAYMENT: { label: 'Pagamento pendente', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAST_DUE: { label: 'Pagamento atrasado', color: 'bg-red-50 text-red-700 border-red-200' },
  CANCELED: { label: 'Cancelada', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  BLOCKED: { label: 'Bloqueada', color: 'bg-red-50 text-red-700 border-red-200' },
}

const PAYMENT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  APPROVED: { label: 'Aprovado', color: 'text-emerald-600' },
  PENDING: { label: 'Aguardando', color: 'text-amber-600' },
  REFUSED: { label: 'Recusado', color: 'text-red-600' },
  REFUNDED: { label: 'Reembolsado', color: 'text-slate-500' },
  CHARGEBACK: { label: 'Contestado', color: 'text-red-600' },
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  credit_card: 'Cartão', pix: 'Pix', boleto: 'Boleto', billet: 'Boleto',
}

const { subscription, isLoading, canManageBilling, refreshSubscription } = useSubscription()
const authStore = useAuthStore()
const router = useRouter()

const opening = ref(false)
const reconciling = ref(false)

const display = computed(() => subscription.value?.displayStatus ?? 'TRIAL_EXPIRED')
const statusInfo = computed(() => STATUS_LABEL[display.value] ?? STATUS_LABEL.BLOCKED)

// Só oferece o checkout quando faz sentido pagar: nunca para quem já tem
// assinatura paga e vigente (evita cobrança em dobro).
const showSubscribeButton = computed(() => !['ACTIVE', 'PENDING_PAYMENT'].includes(display.value))
const showReconcileButton = computed(() => ['TRIAL', 'TRIAL_EXPIRED', 'PENDING_PAYMENT', 'PAST_DUE', 'CANCELED', 'BLOCKED'].includes(display.value))

const subscribeLabel = computed(() => {
  switch (display.value) {
    case 'PAST_DUE': return 'Regularizar pagamento'
    case 'CANCELED':
    case 'CANCELED_ACTIVE': return 'Reativar assinatura'
    case 'COURTESY': return 'Assinar agora'
    default: return `Assinar por R$ ${subscription.value?.monthlyPrice}/mês`
  }
})

function formatDate(value: string | null | undefined, pattern = "d 'de' MMMM 'de' yyyy"): string {
  return value ? format(new Date(value), pattern, { locale: ptBR }) : ''
}

async function openCheckout() {
  // Abre a aba já no clique (antes do await) — senão o navegador bloqueia o pop-up.
  const tab = window.open('', '_blank')
  opening.value = true
  try {
    const { data } = await api.post('/subscription/checkout')
    if (tab) {
      tab.opener = null
      tab.location.href = data.checkoutUrl
    } else {
      window.location.href = data.checkoutUrl
      return
    }
    router.push('/configuracoes/assinatura/pendente')
  } catch (err: unknown) {
    tab?.close()
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(message || 'Não foi possível abrir o checkout. Tente novamente.')
  } finally {
    opening.value = false
  }
}

async function reconcile() {
  reconciling.value = true
  try {
    const { data } = await api.post('/subscription/reconcile')
    await refreshSubscription()
    if (subscription.value?.displayStatus === 'ACTIVE') {
      toast.success('Pagamento confirmado — assinatura ativa!')
    } else {
      toast(data.message || 'Ainda não recebemos a confirmação da Kiwify. Cartão e Pix costumam confirmar em poucos minutos; boleto pode levar até 3 dias úteis.')
    }
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
        <span :class="['px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap', statusInfo.color]">
          {{ statusInfo.label }}
        </span>
      </div>

      <ul class="grid grid-cols-2 gap-2 mb-6">
        <li v-for="f in INCLUDED_FEATURES" :key="f" class="flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 class="w-4 h-4 text-emerald-500 flex-shrink-0" />
          {{ f }}
        </li>
      </ul>

      <!-- Situação atual -->
      <div v-if="display === 'TRIAL'" class="flex items-start gap-2 bg-primary-50 border border-primary-100 rounded-xl px-4 py-3 mb-4 text-sm text-primary-700">
        <Gift class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          {{ subscription.trialDaysRemaining === 0 || subscription.trialDaysRemaining === 1
            ? 'Último dia do seu teste grátis'
            : `Restam ${subscription.trialDaysRemaining} dias do seu teste grátis de ${subscription.trialDays} dias` }}
          <template v-if="subscription.trialEndsAt"> (até {{ formatDate(subscription.trialEndsAt, "d 'de' MMMM 'às' HH:mm") }})</template>.
          Assine antes do fim para não perder o acesso.
        </span>
      </div>

      <div v-else-if="display === 'TRIAL_EXPIRED'" class="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
        <AlertTriangle class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Seu teste grátis terminou<template v-if="subscription.trialEndsAt"> em {{ formatDate(subscription.trialEndsAt) }}</template>.
          Assine para continuar usando a {{ subscription.product }} — o acesso é liberado automaticamente após o pagamento.
        </span>
      </div>

      <div v-else-if="display === 'ACTIVE'" class="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">
        <ShieldCheck class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Assinatura ativa.
          <template v-if="subscription.currentPeriodEndsAt">Próxima cobrança em {{ formatDate(subscription.currentPeriodEndsAt) }} (renovação automática pela Kiwify).</template>
          <template v-if="subscription.lastPaymentAt"> Último pagamento em {{ formatDate(subscription.lastPaymentAt) }}.</template>
        </span>
      </div>

      <div v-else-if="display === 'COURTESY'" class="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 mb-4 text-sm text-emerald-700">
        <ShieldCheck class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Seu acesso foi liberado pela equipe ClinIQ Pro, sem data de expiração. Nenhum pagamento é necessário no momento.</span>
      </div>

      <div v-else-if="display === 'CANCELED_ACTIVE'" class="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
        <Info class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Assinatura cancelada. Você continua com acesso até {{ formatDate(subscription.currentPeriodEndsAt) }} — depois disso,
          é preciso assinar novamente.
        </span>
      </div>

      <div v-else-if="display === 'PENDING_PAYMENT'" class="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
        <Clock class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Aguardando a confirmação do pagamento (Pix/boleto). O acesso é liberado automaticamente assim que a Kiwify confirmar.</span>
      </div>

      <div v-else-if="display === 'PAST_DUE'" class="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
        <AlertTriangle class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Não conseguimos confirmar a renovação da sua assinatura. Regularize o pagamento para manter o acesso da sua equipe.</span>
      </div>

      <div v-else-if="display === 'CANCELED' || display === 'BLOCKED'" class="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
        <AlertTriangle class="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          {{ display === 'CANCELED' ? 'Assinatura cancelada.' : 'Acesso bloqueado.' }}
          Assine para restaurar o acesso completo. Em caso de dúvida, fale com o suporte.
        </span>
      </div>

      <template v-if="canManageBilling">
        <div v-if="showSubscribeButton || showReconcileButton" class="flex flex-col sm:flex-row gap-3">
          <button
            v-if="showSubscribeButton"
            :disabled="opening || !subscription.checkoutAvailable"
            class="btn-primary flex-1 justify-center"
            @click="openCheckout"
          >
            <Zap class="w-4 h-4" />
            {{ subscribeLabel }}
            <ExternalLink class="w-3.5 h-3.5" />
          </button>

          <button
            v-if="showReconcileButton"
            :disabled="reconciling"
            class="btn-secondary flex-1 justify-center"
            @click="reconcile"
          >
            <RefreshCw :class="['w-4 h-4', reconciling ? 'animate-spin' : '']" />
            Já realizei o pagamento
          </button>
        </div>

        <p v-if="showSubscribeButton && !subscription.checkoutAvailable" class="text-xs text-amber-600 mt-3">
          O pagamento online ainda não está disponível. Fale com o suporte.
        </p>
        <p v-else-if="showSubscribeButton" class="text-xs text-slate-400 mt-3">
          O pagamento é feito na Kiwify, em uma nova aba. Use o mesmo e-mail da sua conta
          (<strong>{{ authStore.user?.email }}</strong>) para a liberação ser automática.
        </p>
      </template>
      <p v-else class="text-sm text-slate-400">
        Somente o médico ou especialista responsável pela clínica pode gerenciar a assinatura.
      </p>
    </div>

    <div v-if="subscription.payments.length > 0" class="card p-6">
      <h2 class="text-sm font-semibold text-slate-700 mb-3">Histórico de pagamentos</h2>
      <div class="space-y-2">
        <div v-for="p in subscription.payments" :key="p.id" class="grid grid-cols-4 items-center gap-2 text-sm border-b border-slate-50 pb-2 last:border-0">
          <span class="text-slate-500">{{ formatDate(p.approvedAt ?? p.createdAt, 'd MMM yyyy') }}</span>
          <span class="text-slate-700 font-medium">R$ {{ (p.amountCents / 100).toFixed(2).replace('.', ',') }}</span>
          <span class="text-xs text-slate-400">{{ PAYMENT_METHOD_LABEL[p.paymentMethod ?? ''] ?? '—' }}</span>
          <span :class="['text-xs font-medium text-right', (PAYMENT_STATUS_LABEL[p.status] ?? { color: 'text-slate-400' }).color]">
            {{ (PAYMENT_STATUS_LABEL[p.status] ?? { label: p.status }).label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
