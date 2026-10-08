<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagesSquare } from 'lucide-vue-next'
import { useAttendanceStore } from '../stores/attendance'
import { useAttendanceStream } from '../composables/useAttendanceStream'
import ConversationList from '../components/Atendimento/ConversationList.vue'
import ChatPanel from '../components/Atendimento/ChatPanel.vue'
import ContactSidePanel from '../components/Atendimento/ContactSidePanel.vue'
import TransferModal from '../components/Atendimento/TransferModal.vue'
import QueuesModal from '../components/Atendimento/QueuesModal.vue'

const store = useAttendanceStore()
const route = useRoute()
const router = useRouter()

const panelOpen = ref(window.innerWidth >= 1280)
const transferOpen = ref(false)
const queuesOpen = ref(false)

// ─── Altura útil: ocupa o resto da tela sem scroll da página ─────────
const root = ref<HTMLElement | null>(null)
const height = ref('calc(100dvh - 6rem)')
function measure() {
  const el = root.value
  if (!el) return
  const bottomGap = window.innerWidth >= 640 ? 24 : 16
  height.value = `${Math.max(420, window.innerHeight - el.getBoundingClientRect().top - bottomGap)}px`
}
let measureTimer: ReturnType<typeof setTimeout> | undefined

// ─── Tempo real ──────────────────────────────────────────────────────
const { state: streamState } = useAttendanceStream({
  onConversation: c => store.upsertConversation(c),
  onMessage: m => store.applyMessage(m),
  onSummary: s => { store.summary = s },
  onMerged: ({ fromId, intoId }) => {
    store.removeConversation(fromId)
    // A conversa aberta foi unificada: abre a que ficou (mensagens das duas).
    if (store.selectedId === fromId || store.selectedId === intoId) {
      if (store.selectedId === fromId) select(intoId)
      else store.select(intoId)
    }
    store.fetchSummary()
  },
  onResync: () => store.resync(),
})

// Timeline do painel/chat acompanha mudanças da conversa aberta (debounce leve).
let eventsTimer: ReturnType<typeof setTimeout> | undefined
watch(() => [store.detail?.status, store.detail?.queue?.id, store.detail?.assignedUser?.id], (now, before) => {
  if (!before[0] || !store.detail) return
  clearTimeout(eventsTimer)
  eventsTimer = setTimeout(() => store.fetchEvents(), 300)
})

// ─── Lista / seleção ─────────────────────────────────────────────────
watch(() => [store.tab, store.queueId, store.search], () => store.fetchList())

function select(id: string) {
  router.replace({ query: { ...route.query, c: id } })
}
function back() {
  const { c: _c, ...rest } = route.query
  router.replace({ query: rest })
}
watch(() => route.query.c, id => {
  const next = typeof id === 'string' ? id : null
  if (next !== store.selectedId) store.select(next)
}, { immediate: true })

onMounted(() => {
  measure()
  measureTimer = setTimeout(measure, 450) // depois da transição de página
  window.addEventListener('resize', measure)
  store.fetchList()
  store.fetchSummary()
  store.fetchQueues()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  clearTimeout(measureTimer)
  clearTimeout(eventsTimer)
  store.reset()
})
</script>

<template>
  <div
    ref="root"
    class="flex bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden"
    :style="{ height }"
  >
    <!-- Lista -->
    <div
      :class="[
        'w-full md:w-[320px] md:flex-shrink-0 border-r border-slate-100 min-h-0',
        store.selectedId ? 'hidden md:flex md:flex-col' : 'flex flex-col',
      ]"
    >
      <ConversationList :stream-state="streamState" @select="select" @manage-queues="queuesOpen = true" />
    </div>

    <!-- Chat + painel -->
    <div :class="['relative flex-1 min-w-0 min-h-0', store.selectedId ? 'flex' : 'hidden md:flex']">
      <template v-if="store.detail">
        <div class="flex-1 min-w-0 min-h-0">
          <ChatPanel :panel-open="panelOpen" @back="back" @toggle-panel="panelOpen = !panelOpen" @transfer="transferOpen = true" />
        </div>
        <div
          v-if="panelOpen"
          class="absolute inset-y-0 right-0 z-20 w-[300px] max-w-full border-l border-slate-100 shadow-xl xl:static xl:shadow-none xl:flex-shrink-0 animate-slide-left xl:animate-none"
        >
          <ContactSidePanel @close="panelOpen = false" />
        </div>
      </template>

      <div v-else-if="store.selectedId && store.detailLoading" class="flex-1 flex items-center justify-center bg-[#f5f3ef]">
        <div class="skeleton-circle w-10 h-10" />
      </div>

      <div v-else class="flex-1 flex flex-col items-center justify-center text-center px-8 bg-slate-50/60">
        <div class="w-16 h-16 rounded-3xl bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-4">
          <MessagesSquare class="w-7 h-7 text-emerald-500" />
        </div>
        <p class="text-sm font-semibold text-slate-800">{{ store.selectedId ? 'Conversa não encontrada' : 'Selecione uma conversa' }}</p>
        <p class="text-xs text-slate-500 mt-1 max-w-xs">
          As mensagens do WhatsApp das suas salas chegam aqui em tempo real. Responda, transfira ou resolva sem sair da plataforma.
        </p>
      </div>
    </div>

    <TransferModal :is-open="transferOpen" @close="transferOpen = false" />
    <QueuesModal :is-open="queuesOpen" @close="queuesOpen = false" />
  </div>
</template>
