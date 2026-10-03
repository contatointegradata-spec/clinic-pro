<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import { RefreshCw, Home } from 'lucide-vue-next'
import { handlePossibleChunkError } from '../../lib/chunkErrorRecovery'

const hasError = ref(false)

onErrorCaptured((err) => {
  console.error('[ErrorBoundary] Erro capturado:', err)
  handlePossibleChunkError(err instanceof Error ? err.message : String(err))
  hasError.value = true
  return false
})

function reload() {
  window.location.reload()
}

function goHome() {
  window.location.href = '/'
}
</script>

<template>
  <slot v-if="!hasError" />
  <div v-else class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <div class="max-w-md w-full text-center">
      <h1 class="text-lg font-semibold text-slate-900 mb-2">
        A ClinIQ Pro recebeu uma atualização e precisa recarregar alguns recursos
      </h1>
      <p class="text-sm text-slate-500 mb-6">
        Clique em atualizar para continuar. Caso o problema persista, entre em contato com o suporte.
      </p>
      <div class="flex items-center justify-center gap-3">
        <button class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors" @click="reload">
          <RefreshCw class="w-4 h-4" />
          Atualizar página
        </button>
        <button class="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors" @click="goHome">
          <Home class="w-4 h-4" />
          Voltar para o início
        </button>
      </div>
    </div>
  </div>
</template>
