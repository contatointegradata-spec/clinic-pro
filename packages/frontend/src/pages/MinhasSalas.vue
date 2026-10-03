<script setup lang="ts">
/**
 * MinhasSalas.vue — Visão operacional da secretária
 * Exibe apenas as salas nas quais a secretária foi vinculada.
 * A conexão WhatsApp não é mais gerenciada aqui — fica em Agente de IA → Conectar.
 */
import { ref, computed } from 'vue'
import {
  Building2, MapPin, Clock, History, Shield, MessageSquare, ChevronRight, ArrowLeft,
  Users, CheckCircle, XCircle,
} from 'lucide-vue-next'
import api from '../lib/api'
import type { Room, RoomPermissions } from '../types'
import { useQuery } from '../composables/useQuery'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MyRoom extends Room {
  myPermissions: RoomPermissions
}

interface HistoryLog {
  id: string
  action: string
  description?: string
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

function dayLabel(days: number[]) {
  return DAYS.filter(d => days.includes(d.value)).map(d => d.label).join(', ')
}

function addressLine(room: Room) {
  const parts = [room.logradouro, room.numero].filter(Boolean).join(', ')
  const city = room.cidade || ''
  return [parts, city].filter(Boolean).join(' — ') || null
}

const actionLabels: Record<string, string> = {
  WHATSAPP_CONNECT: '🔗 WhatsApp conectado',
  WHATSAPP_RECONNECT: '🔄 WhatsApp reconectado',
  WHATSAPP_DISCONNECT: '🔌 WhatsApp desconectado',
  ROOM_UPDATE: '✏️ Sala atualizada',
  ROOM_PERMISSIONS_UPDATE: '🔒 Permissões atualizadas',
}

const permissionBadges: { key: keyof RoomPermissions; label: string }[] = [
  { key: 'canViewSchedule', label: 'Ver agenda' },
  { key: 'canSendMessages', label: 'Enviar mensagens' },
  { key: 'canUseTemplates', label: 'Usar templates' },
  { key: 'canViewHistory', label: 'Ver histórico' },
]

// ─── Lista de salas ────────────────────────────────────────────────────────────

const { data: roomsData, isLoading } = useQuery<MyRoom[]>({
  key: 'my-rooms',
  queryFn: () => api.get('/my/rooms').then(r => r.data),
})
const rooms = computed(() => roomsData.value ?? [])

// ─── Sala selecionada / histórico ─────────────────────────────────────────────

const selectedRoom = ref<MyRoom | null>(null)

const historyKey = computed(() => `my-room-history:${selectedRoom.value?.id ?? ''}`)
const historyEnabled = computed(() => !!selectedRoom.value?.myPermissions.canViewHistory)

const { data: historyData } = useQuery<{ logs: HistoryLog[] }>({
  key: historyKey,
  queryFn: () => api.get(`/my/rooms/${selectedRoom.value!.id}/history`).then(r => r.data),
  enabled: historyEnabled,
})
const historyLogs = computed(() => historyData.value?.logs ?? [])

function selectRoom(room: MyRoom) {
  selectedRoom.value = room
}

function backToList() {
  selectedRoom.value = null
}
</script>

<template>
  <div v-if="selectedRoom" class="max-w-2xl space-y-4">
    <!-- ── Cabeçalho ── -->
    <div class="flex items-start gap-3">
      <button class="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors mt-0.5" @click="backToList">
        <ArrowLeft class="w-4 h-4" />
      </button>
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-bold text-slate-900">{{ selectedRoom.name }}</h2>
        <div class="flex flex-wrap items-center gap-3 mt-1 text-sm text-slate-500">
          <span v-if="addressLine(selectedRoom)" class="flex items-center gap-1">
            <MapPin class="w-3.5 h-3.5" /> {{ addressLine(selectedRoom) }}
          </span>
          <span class="flex items-center gap-1">
            <Clock class="w-3.5 h-3.5" /> {{ selectedRoom.startTime }} – {{ selectedRoom.endTime }}
          </span>
          <span>{{ dayLabel(selectedRoom.daysOfWeek) }}</span>
        </div>
      </div>
    </div>

    <!-- ── Resumo de permissões ── -->
    <div class="card bg-primary-50 border-primary-200 p-3">
      <p class="text-xs font-semibold text-primary-900 mb-2">Minhas permissões nesta sala</p>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="perm in permissionBadges" :key="perm.key"
          class="flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium"
          :class="selectedRoom.myPermissions[perm.key]
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-slate-100 text-slate-400 border border-slate-200'"
        >
          <CheckCircle v-if="selectedRoom.myPermissions[perm.key]" class="w-3 h-3" />
          <XCircle v-else class="w-3 h-3" />
          {{ perm.label }}
        </span>
      </div>
    </div>

    <!-- ── Histórico ── -->
    <div>
      <p class="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
        <History class="w-4 h-4" /> Histórico
      </p>
      <div class="space-y-2">
        <div v-if="!selectedRoom.myPermissions.canViewHistory" class="py-6 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <Shield class="w-4 h-4" /> Sem permissão para ver histórico
        </div>
        <div v-else-if="historyLogs.length === 0" class="py-6 text-center">
          <History class="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p class="text-slate-400 text-sm">Nenhuma ação registrada.</p>
        </div>
        <template v-else>
          <div v-for="log in historyLogs" :key="log.id" class="flex items-start gap-3 p-3 border border-slate-100 rounded-xl">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-900">{{ actionLabels[log.action] ?? log.action }}</p>
              <p v-if="log.description" class="text-xs text-slate-500 mt-0.5">{{ log.description }}</p>
            </div>
            <p class="text-xs text-slate-400 flex-shrink-0">{{ new Date(log.createdAt).toLocaleString('pt-BR') }}</p>
          </div>
        </template>
      </div>
    </div>
  </div>

  <!-- ── Página Principal ── -->
  <div v-else class="max-w-2xl space-y-6 page-stagger">
    <div class="animate-stagger-1">
      <h1 class="page-title">Minhas Salas</h1>
      <p class="page-subtitle">Salas nas quais você está vinculada como responsável</p>
    </div>

    <div v-if="isLoading" class="space-y-3">
      <div v-for="i in 2" :key="i" class="card animate-pulse">
        <div class="h-4 bg-slate-200 rounded w-1/3 mb-2" />
        <div class="h-3 bg-slate-100 rounded w-1/2" />
      </div>
    </div>

    <div v-else-if="rooms.length === 0" class="card text-center py-12 animate-stagger-2">
      <Building2 class="w-10 h-10 text-slate-300 mx-auto mb-3 animate-float" />
      <p class="text-slate-500 font-medium">Nenhuma sala vinculada</p>
      <p class="text-slate-400 text-sm mt-1">
        O médico responsável precisa vincular você a uma sala nas configurações.
      </p>
    </div>

    <div v-else class="space-y-3 animate-stagger-2">
      <div
        v-for="room in rooms" :key="room.id"
        class="card hover:border-primary-200 transition-colors cursor-pointer group"
        :class="!room.active ? 'opacity-60' : ''"
        @click="selectRoom(room)"
      >
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 bg-primary-50 border border-primary-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
            <Building2 class="w-5 h-5 text-primary-600" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900 group-hover:text-primary-700 transition-colors">{{ room.name }}</p>
              <span v-if="!room.active" class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativa</span>
            </div>
            <div class="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500">
              <span v-if="addressLine(room)" class="flex items-center gap-1">
                <MapPin class="w-3 h-3" /> {{ addressLine(room) }}
              </span>
              <span class="flex items-center gap-1">
                <Clock class="w-3 h-3" /> {{ room.startTime }} – {{ room.endTime }}
              </span>
              <span>{{ dayLabel(room.daysOfWeek) }}</span>
            </div>

            <!-- Mini badge de permissões -->
            <div class="flex flex-wrap gap-1.5 mt-2">
              <span v-if="room.myPermissions.canViewSchedule" class="flex items-center gap-0.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-full">
                <Users class="w-2.5 h-2.5" /> Agenda
              </span>
              <span v-if="room.myPermissions.canUseTemplates" class="flex items-center gap-0.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-full">
                <MessageSquare class="w-2.5 h-2.5" /> Templates
              </span>
            </div>
          </div>
          <ChevronRight class="w-4 h-4 text-slate-400 group-hover:text-primary-500 flex-shrink-0 mt-1 transition-colors" />
        </div>
      </div>
    </div>

    <div class="card bg-primary-50 border-primary-200 text-sm text-primary-700 space-y-1 animate-stagger-3">
      <p class="font-semibold text-primary-900">Minhas Salas</p>
      <p>• Aqui você vê apenas as salas nas quais foi vinculada pelo médico responsável</p>
      <p>• A conexão do WhatsApp fica em Agente de IA → Conectar</p>
      <p>• Em caso de dúvidas, entre em contato com o responsável da clínica</p>
    </div>
  </div>
</template>
