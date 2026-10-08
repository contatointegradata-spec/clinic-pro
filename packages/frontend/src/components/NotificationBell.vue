<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, CheckCheck, X, CalendarDays, CalendarX2, Clock, Filter, MessageCircle, AlertTriangle } from 'lucide-vue-next'
import type { Component } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import api from '../lib/api'
import type { Notification, NotificationCategory } from '../types'

const props = defineProps<{ collapsed?: boolean }>()

// Ícone/cor por categoria — notificações antigas (sem category) caem em SYSTEM.
const CATEGORY_STYLE: Record<NotificationCategory, { icon: Component; color: string }> = {
  AGENDAMENTO: { icon: CalendarDays, color: 'text-primary-600 bg-primary-50' },
  CANCELAMENTO: { icon: CalendarX2, color: 'text-red-600 bg-red-50' },
  FOLLOW_UP: { icon: Clock, color: 'text-amber-600 bg-amber-50' },
  CRM: { icon: Filter, color: 'text-violet-600 bg-violet-50' },
  ATENDIMENTO: { icon: MessageCircle, color: 'text-emerald-600 bg-emerald-50' },
  SYSTEM: { icon: AlertTriangle, color: 'text-orange-600 bg-orange-50' },
}
function styleOf(n: Notification) {
  return CATEGORY_STYLE[n.category ?? 'SYSTEM'] ?? CATEGORY_STYLE.SYSTEM
}

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const notifications = ref<Notification[]>([])
const unreadCount = ref(0)
const router = useRouter()
let interval: ReturnType<typeof setInterval> | undefined

// O painel é teleportado pro <body> — as sidebars onde este botão mora têm
// overflow-hidden (pra conter a animação de recolher/expandir), então um
// dropdown posicionado só com CSS absolute ficaria cortado. Calculamos a
// posição em px a partir do botão toda vez que o painel abre.
const panelStyle = ref({ top: '0px', left: '0px' })
const PANEL_WIDTH = 320

function openPanel() {
  const rect = triggerRef.value?.getBoundingClientRect()
  if (rect) {
    const left = Math.min(rect.right + 8, window.innerWidth - PANEL_WIDTH - 8)
    const top = Math.min(rect.top, window.innerHeight - 420)
    panelStyle.value = { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` }
  }
  open.value = true
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node
  if (triggerRef.value?.contains(target)) return
  if (panelRef.value?.contains(target)) return
  open.value = false
}

async function load() {
  try {
    const [list, count] = await Promise.all([
      api.get('/notifications').then(r => r.data),
      api.get('/notifications/unread-count').then(r => r.data),
    ])
    notifications.value = list
    unreadCount.value = count?.count ?? 0
  } catch {
    // silencioso — o sino não deve travar o resto da UI
  }
}

onMounted(() => {
  load()
  interval = setInterval(load, 30000)
  document.addEventListener('mousedown', onClickOutside)
})
onBeforeUnmount(() => {
  if (interval) clearInterval(interval)
  document.removeEventListener('mousedown', onClickOutside)
})

async function markRead(n: Notification) {
  if (n.link) {
    open.value = false
    router.push(n.link)
  }
  if (!n.read) {
    // Otimista: some o destaque na hora, sincroniza em seguida.
    n.read = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
    try { await api.patch(`/notifications/${n.id}/read`) } catch { /* recarrega abaixo */ }
    await load()
  }
}

async function markAllRead() {
  await api.patch('/notifications/read-all')
  await load()
}

async function removeNotification(n: Notification) {
  await api.delete(`/notifications/${n.id}`)
  await load()
}
</script>

<template>
  <div>
    <button
      ref="triggerRef"
      :class="[
        'w-full flex items-center gap-2.5 px-3 py-2 text-slate-500 hover:text-primary-700 hover:bg-primary-50 rounded-xl transition-all duration-200 text-sm relative',
        collapsed ? 'justify-center' : '',
      ]"
      :aria-label="unreadCount > 0 ? `Notificações (${unreadCount} não lidas)` : 'Notificações'"
      :aria-expanded="open"
      @click="open ? (open = false) : openPanel()"
    >
      <Bell class="w-4 h-4 flex-shrink-0" />
      <span v-if="!collapsed" class="flex-1 text-left">Notificações</span>
      <span
        v-if="unreadCount > 0"
        :class="[
          'flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none',
          collapsed ? 'absolute top-1 right-1.5 w-4 h-4' : 'min-w-[18px] h-[18px] px-1',
        ]"
      >
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="fixed w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden"
        :style="panelStyle"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 class="font-semibold text-slate-900 text-sm">
            Notificações
            <span v-if="unreadCount > 0" class="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full ml-1">{{ unreadCount }} novas</span>
          </h3>
          <button v-if="unreadCount > 0" class="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1" @click="markAllRead">
            <CheckCheck class="w-3.5 h-3.5" />
            Marcar todas
          </button>
        </div>

        <div class="max-h-80 overflow-y-auto divide-y divide-slate-50">
          <div v-if="notifications.length === 0" class="text-center py-8">
            <Bell class="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p class="text-sm text-slate-400">Nenhuma notificação</p>
          </div>
          <div
            v-for="n in notifications"
            :key="n.id"
            :class="['flex gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors', !n.read ? 'bg-primary-50/40' : '']"
            @click="markRead(n)"
          >
            <div :class="['w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', styleOf(n).color]">
              <component :is="styleOf(n).icon" class="w-4 h-4" />
            </div>
            <div class="flex-1 min-w-0">
              <p :class="['text-sm text-slate-900', !n.read ? 'font-semibold' : 'font-medium']">{{ n.title }}</p>
              <p class="text-xs text-slate-500 mt-0.5 leading-relaxed">{{ n.message }}</p>
              <p class="text-xs text-slate-400 mt-1">{{ formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ptBR }) }}</p>
            </div>
            <div v-if="!n.read" class="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0 mt-2" />
            <button class="p-0.5 text-slate-300 hover:text-red-400 flex-shrink-0 mt-0.5" aria-label="Remover notificação" @click.stop="removeNotification(n)">
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
