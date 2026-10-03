<script setup lang="ts">
import { computed } from 'vue'
import { History } from 'lucide-vue-next'
import api from '../../lib/api'
import type { Room } from '../../types'
import { useQuery } from '../../composables/useQuery'

interface AuditLog {
  id: string
  action: string
  description?: string
  createdAt: string
}

const props = defineProps<{ room: Room }>()

const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
  key: `room-audit:${props.room.id}`,
  queryFn: () => api.get(`/rooms/${props.room.id}/audit`).then(r => r.data),
})

const actionLabels: Record<string, string> = {
  ROOM_CREATE: '🏠 Sala criada',
  ROOM_UPDATE: '✏️ Sala atualizada',
  WHATSAPP_CONNECT: '🔗 WhatsApp conectado',
  WHATSAPP_RECONNECT: '🔄 WhatsApp reconectado',
  WHATSAPP_DISCONNECT: '🔌 WhatsApp desconectado',
  ROOM_PERMISSIONS_UPDATE: '🔒 Permissões atualizadas',
}

const logs = computed(() => data.value?.logs ?? [])
</script>

<template>
  <div v-if="isLoading" class="py-8 text-center text-slate-400 text-sm">Carregando...</div>
  <div v-else-if="logs.length === 0" class="py-8 text-center">
    <History class="w-8 h-8 text-slate-300 mx-auto mb-2" />
    <p class="text-slate-400 text-sm">Nenhuma ação registrada ainda.</p>
  </div>
  <div v-else class="space-y-2">
    <div v-for="log in logs" :key="log.id" class="flex items-start gap-3 p-3 border border-slate-100 rounded-xl hover:bg-slate-50">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-slate-900">{{ actionLabels[log.action] ?? log.action }}</p>
        <p v-if="log.description" class="text-xs text-slate-500 mt-0.5">{{ log.description }}</p>
      </div>
      <p class="text-xs text-slate-400 flex-shrink-0">{{ new Date(log.createdAt).toLocaleString('pt-BR') }}</p>
    </div>
  </div>
</template>
