<script setup lang="ts">
import { ref } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import Modal from '../ui/Modal.vue'
import { useAppVersion } from '../../composables/useAppVersion'
import { useUnsavedChangesStore } from '../../stores/unsavedChanges'

const { updateAvailable } = useAppVersion()
const unsavedChangesStore = useUnsavedChangesStore()
const dismissed = ref(false)
const confirmOpen = ref(false)

function reload() {
  window.location.reload()
}

function handleUpdateClick() {
  if (unsavedChangesStore.hasUnsavedChanges) {
    confirmOpen.value = true
    return
  }
  reload()
}
</script>

<template>
  <template v-if="updateAvailable && !dismissed">
    <div class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium flex-shrink-0 bg-primary-600 text-white">
      <Sparkles class="w-4 h-4 flex-shrink-0" />
      <span class="flex-1 text-center">
        Uma nova versão da ClinIQ Pro está disponível. Salve suas alterações e atualize para acessar as melhorias mais recentes.
      </span>
      <button class="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors text-xs font-bold whitespace-nowrap" @click="handleUpdateClick">
        Atualizar agora
      </button>
      <button class="p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0" aria-label="Lembrar depois" @click="dismissed = true">
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <Modal :is-open="confirmOpen" title="Existem informações que ainda não foram salvas" @close="confirmOpen = false">
      <p class="text-sm text-slate-600">Atualizar agora poderá descartar essas alterações. Deseja continuar?</p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors" @click="confirmOpen = false">
            Cancelar
          </button>
          <button class="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors" @click="reload">
            Atualizar mesmo assim
          </button>
        </div>
      </template>
    </Modal>
  </template>
</template>
