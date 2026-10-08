<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { Search, Settings2, Loader2, MessagesSquare, Bot, CheckCheck } from 'lucide-vue-next'
import { useAttendanceStore } from '../../stores/attendance'
import { useAuthStore } from '../../stores/auth'
import type { AttendanceTab, ConversationListItem } from '../../types'
import type { StreamState } from '../../composables/useAttendanceStream'
import { avatarColor, displayName, initials, shortTime, waitingFor } from './format'

defineProps<{ streamState: StreamState }>()
const emit = defineEmits<{ select: [id: string]; manageQueues: [] }>()

const store = useAttendanceStore()
const auth = useAuthStore()
const canManage = computed(() => auth.user?.role === 'DOCTOR' || auth.user?.role === 'ADMIN')

const tabs = computed<{ key: AttendanceTab; label: string; count?: number }[]>(() => [
  { key: 'mine', label: 'Minhas', count: store.summary?.mine },
  { key: 'queue', label: 'Fila', count: store.summary?.queued },
  { key: 'bot', label: 'Agente IA', count: store.summary?.bot },
  { key: 'all', label: 'Todas' },
  { key: 'resolved', label: 'Resolvidas' },
])

const searchInput = ref(store.search)
watchDebounced(searchInput, v => { store.search = v }, { debounce: 350 })
watch(() => store.search, v => { if (v !== searchInput.value) searchInput.value = v })

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) store.loadMore()
}

function preview(c: ConversationListItem) {
  if (!c.lastMessage) return 'Sem mensagens'
  return c.lastMessageFromMe ? `Você: ${c.lastMessage}` : c.lastMessage
}

const STREAM_DOT: Record<StreamState, { cls: string; label: string }> = {
  live: { cls: 'bg-emerald-500', label: 'Tempo real conectado' },
  connecting: { cls: 'bg-amber-400 animate-pulse-soft', label: 'Conectando…' },
  polling: { cls: 'bg-amber-500', label: 'Atualizando a cada 10s (tempo real indisponível)' },
  closed: { cls: 'bg-slate-300', label: 'Desconectado' },
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Cabeçalho -->
    <div class="px-4 pt-4 pb-3 space-y-3 border-b border-slate-100">
      <div class="flex items-center gap-2">
        <h1 class="text-base font-semibold text-slate-900 flex-1 flex items-center gap-2">
          Atendimento
          <span :class="['w-1.5 h-1.5 rounded-full', STREAM_DOT[streamState].cls]" :title="STREAM_DOT[streamState].label" role="status" :aria-label="STREAM_DOT[streamState].label" />
        </h1>
        <button v-if="canManage" class="btn-icon w-8 h-8" aria-label="Gerenciar filas" title="Gerenciar filas" @click="emit('manageQueues')">
          <Settings2 class="w-4 h-4" />
        </button>
      </div>

      <div class="flex gap-2">
        <label class="relative flex-1">
          <span class="sr-only">Buscar conversa</span>
          <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            v-model="searchInput"
            type="search"
            placeholder="Buscar nome ou telefone"
            class="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-transparent rounded-xl focus:bg-white focus:border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
          />
        </label>
        <select
          v-if="store.queues.length > 1"
          v-model="store.queueId"
          aria-label="Filtrar por fila"
          class="max-w-[96px] text-xs text-slate-600 bg-slate-50 border border-transparent rounded-xl px-2 focus:outline-none focus:ring-2 focus:ring-primary-100"
        >
          <option value="">Filas</option>
          <option v-for="q in store.queues" :key="q.id" :value="q.id">{{ q.name }}</option>
        </select>
      </div>

      <div class="flex gap-1 overflow-x-auto scrollbar-none -mx-1 px-1" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          role="tab"
          :aria-selected="store.tab === t.key"
          :class="[
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
            store.tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          ]"
          @click="store.tab = t.key"
        >
          {{ t.label }}
          <span
            v-if="t.count"
            :class="['min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 text-center', store.tab === t.key ? 'bg-white/20' : 'bg-slate-200/80 text-slate-600']"
          >{{ t.count > 99 ? '99+' : t.count }}</span>
        </button>
      </div>
    </div>

    <!-- Lista -->
    <div class="flex-1 overflow-y-auto min-h-0" @scroll.passive="onScroll">
      <div v-if="store.listLoading && !store.items.length" class="p-4 space-y-4">
        <div v-for="i in 6" :key="i" class="flex gap-3 items-center">
          <div class="skeleton-circle w-10 h-10 flex-shrink-0" />
          <div class="flex-1 space-y-2">
            <div class="skeleton-text w-2/3" />
            <div class="skeleton-text w-full h-3" />
          </div>
        </div>
      </div>

      <div v-else-if="!store.items.length" class="flex flex-col items-center justify-center text-center px-8 py-16">
        <div class="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
          <MessagesSquare class="w-5 h-5 text-slate-300" />
        </div>
        <p class="text-sm font-medium text-slate-600">Nenhuma conversa aqui</p>
        <p class="text-xs text-slate-400 mt-1">{{ store.search ? 'Tente outra busca.' : 'Novas mensagens aparecem automaticamente.' }}</p>
      </div>

      <ul v-else>
        <li v-for="c in store.items" :key="c.id">
          <button
            :class="[
              'w-full flex gap-3 px-4 py-3 text-left transition-colors border-l-2',
              store.selectedId === c.id ? 'bg-primary-50/60 border-primary-500' : 'border-transparent hover:bg-slate-50',
            ]"
            @click="emit('select', c.id)"
          >
            <div class="relative flex-shrink-0">
              <img v-if="c.contactAvatar" :src="c.contactAvatar" alt="" class="w-10 h-10 rounded-full object-cover" />
              <div v-else :class="['w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold', avatarColor(c.contactPhone)]">
                {{ initials(displayName(c)) }}
              </div>
              <span v-if="c.status === 'BOT'" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-violet-500 ring-2 ring-white flex items-center justify-center" title="Agente de IA">
                <Bot class="w-2.5 h-2.5 text-white" />
              </span>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <p :class="['flex-1 truncate text-sm', c.unreadCount ? 'font-semibold text-slate-900' : 'font-medium text-slate-800']">{{ displayName(c) }}</p>
                <span :class="['text-[11px] flex-shrink-0', c.unreadCount ? 'text-emerald-600 font-medium' : 'text-slate-400']">{{ shortTime(c.lastMessageAt) }}</span>
              </div>
              <div class="flex items-center gap-2 mt-0.5">
                <p class="flex-1 truncate text-xs text-slate-500">
                  <CheckCheck v-if="c.lastMessageFromMe" class="inline w-3.5 h-3.5 -mt-0.5 text-slate-400" />
                  {{ preview(c) }}
                </p>
                <span v-if="c.unreadCount" class="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-semibold leading-[18px] text-center flex-shrink-0">
                  {{ c.unreadCount > 99 ? '99+' : c.unreadCount }}
                </span>
              </div>
              <div class="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400 min-w-0">
                <span v-if="c.status === 'QUEUED'" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-medium flex-shrink-0">
                  <span class="w-1.5 h-1.5 rounded-full" :style="{ background: c.queue?.color || '#f59e0b' }" />
                  {{ c.queue?.name ?? 'Fila' }}<template v-if="c.queuedAt"> · {{ waitingFor(c.queuedAt) }}</template>
                </span>
                <span v-else-if="c.status === 'IN_PROGRESS'" class="px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-700 font-medium truncate max-w-[120px] flex-shrink-0">
                  {{ c.assignedUser?.id === auth.user?.id ? 'Comigo' : c.assignedUser?.name ?? 'Em atendimento' }}
                </span>
                <span v-else-if="c.status === 'BOT'" class="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 font-medium flex-shrink-0">Agente IA</span>
                <span v-else class="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium flex-shrink-0">Resolvida</span>
                <span class="truncate">{{ c.room.name }}</span>
              </div>
            </div>
          </button>
        </li>
      </ul>

      <div v-if="store.listLoadingMore" class="flex justify-center py-4">
        <Loader2 class="w-4 h-4 text-slate-400 animate-spin" />
      </div>
    </div>
  </div>
</template>
