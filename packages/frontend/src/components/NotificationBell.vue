<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, CheckCheck, X, Info, CheckCircle, AlertTriangle } from 'lucide-vue-next'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import api from '../lib/api'
import type { Notification } from '../types'

const TYPE_ICONS: Record<string, any> = { INFO: Info, SUCCESS: CheckCircle, WARNING: AlertTriangle, ALERT: AlertTriangle }
const TYPE_COLORS: Record<string, string> = {
  INFO: 'text-primary-600 bg-primary-50',
  SUCCESS: 'text-emerald-600 bg-emerald-50',
  WARNING: 'text-amber-600 bg-amber-50',
  ALERT: 'text-red-600 bg-red-50',
}

const open = ref(false)
const panelRef = ref<HTMLElement | null>(null)
const notifications = ref<Notification[]>([])
const unreadCount = ref(0)
const router = useRouter()
let interval: ReturnType<typeof setInterval> | undefined

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

function onClickOutside(e: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) open.value = false
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
  if (!n.read) {
    await api.patch(`/notifications/${n.id}/read`)
    await load()
  }
  if (n.link) {
    router.push(n.link)
    open.value = false
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
  <div ref="panelRef" class="relative">
    <button
      class="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      @click="open = !open"
    >
      <Bell class="w-5 h-5" />
      <span v-if="unreadCount > 0" class="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <div v-if="open" class="absolute right-0 top-11 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
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
          <div :class="['w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', TYPE_COLORS[n.type] || TYPE_COLORS.INFO]">
            <component :is="TYPE_ICONS[n.type] || Info" class="w-4 h-4" />
          </div>
          <div class="flex-1 min-w-0">
            <p :class="['text-sm text-slate-900', !n.read ? 'font-semibold' : 'font-medium']">{{ n.title }}</p>
            <p class="text-xs text-slate-500 mt-0.5 leading-relaxed">{{ n.message }}</p>
            <p class="text-xs text-slate-400 mt-1">{{ formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ptBR }) }}</p>
          </div>
          <div v-if="!n.read" class="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0 mt-2" />
          <button class="p-0.5 text-slate-300 hover:text-red-400 flex-shrink-0 mt-0.5" @click.stop="removeNotification(n)">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
