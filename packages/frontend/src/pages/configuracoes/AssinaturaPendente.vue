<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Clock, ArrowLeft } from 'lucide-vue-next'
import toast from '../../lib/toast'
import { useSubscription } from '../../composables/useSubscription'

const POLL_INTERVAL_MS = 7_000

const router = useRouter()
const { subscription, refreshSubscription } = useSubscription()

// Quem está no teste grátis já tem acesso — então "acesso liberado" não
// significa "pagou". Só considera confirmado quando chega um pagamento novo.
const initialLastPaymentAt = subscription.value?.lastPaymentAt ?? null

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => { refreshSubscription() }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

watch(subscription, (sub) => {
  if (sub?.displayStatus === 'ACTIVE' && sub.lastPaymentAt && sub.lastPaymentAt !== initialLastPaymentAt) {
    toast.success('Pagamento confirmado — assinatura ativa!')
    router.replace('/configuracoes/assinatura')
  }
})
</script>

<template>
  <div class="max-w-md mx-auto text-center py-16 animate-page-enter">
    <div class="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
      <Clock class="w-8 h-8 text-primary-500 animate-pulse" />
    </div>
    <h1 class="text-lg font-semibold text-slate-900 mb-2">Aguardando confirmação do pagamento</h1>
    <p class="text-slate-500 text-sm leading-relaxed">
      Conclua o pagamento na aba da Kiwify. Assim que ela confirmar a compra, o acesso é liberado
      automaticamente — não é preciso atualizar esta página. Cartão e Pix costumam confirmar em poucos
      minutos; boleto pode levar até 3 dias úteis.
    </p>
    <button class="btn-secondary mx-auto mt-6" @click="router.push('/configuracoes/assinatura')">
      <ArrowLeft class="w-4 h-4" />
      Voltar para Assinatura
    </button>
  </div>
</template>
