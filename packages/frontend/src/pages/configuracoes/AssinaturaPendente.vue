<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Clock } from 'lucide-vue-next'
import { useSubscription } from '../../composables/useSubscription'

const POLL_INTERVAL_MS = 7_000

const router = useRouter()
const { subscription, refreshSubscription } = useSubscription()

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => { refreshSubscription() }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

watch(subscription, (sub) => {
  if (sub?.accessAllowed) {
    router.replace('/dashboard')
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
      Estamos aguardando a confirmação do seu pagamento. Assim que a Kiwify confirmar a compra,
      o acesso será liberado automaticamente — não é preciso atualizar a página.
    </p>
  </div>
</template>
