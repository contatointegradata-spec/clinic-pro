<script setup lang="ts">
import { ref, computed } from 'vue'
import { Users, Shield, ChevronDown, ChevronUp } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { Room, RoomSecretary, RoomPermissions } from '../../types'
import { useQuery } from '../../composables/useQuery'

const ROOM_PERM_LABELS: { key: keyof RoomPermissions; label: string; description: string }[] = [
  { key: 'canViewSchedule', label: 'Ver agenda', description: 'Visualizar agendamentos da sala' },
  { key: 'canManageWhatsapp', label: 'Gerenciar WhatsApp', description: 'Acesso ao painel WhatsApp da sala' },
  { key: 'canDisconnectWhatsapp', label: 'Desconectar WhatsApp', description: 'Encerrar sessão ativa' },
  { key: 'canSendMessages', label: 'Enviar mensagens', description: 'Enviar mensagens via WhatsApp da sala' },
  { key: 'canUseTemplates', label: 'Usar templates', description: 'Utilizar templates liberados para a sala' },
  { key: 'canUseAutomaticMessages', label: 'Mensagens automáticas', description: 'Ver e acionar mensagens automáticas' },
  { key: 'canViewHistory', label: 'Ver histórico', description: 'Visualizar histórico de ações da sala' },
]

const props = defineProps<{ room: Room }>()

const { data: roomUsersData, isLoading, refetch: refetchRoomUsers } = useQuery<RoomSecretary[]>({
  key: `room-users:${props.room.id}`,
  queryFn: () => api.get(`/rooms/${props.room.id}/users`).then(r => r.data),
})
const roomUsers = computed(() => (roomUsersData.value ?? []).filter(u => u.active))

const updating = ref(false)
async function updatePermission(userId: string, key: keyof RoomPermissions, checked: boolean) {
  updating.value = true
  try {
    await api.put(`/rooms/${props.room.id}/users/${userId}/permissions`, { [key]: checked })
    toast.success('Permissões salvas!')
    await refetchRoomUsers()
  } catch {
    toast.error('Erro ao salvar permissões')
  } finally {
    updating.value = false
  }
}

const removing = ref(false)
async function removeUser(userId: string) {
  removing.value = true
  try {
    await api.delete(`/rooms/${props.room.id}/users/${userId}`)
    toast.success('Secretária desvinculada da sala')
    await refetchRoomUsers()
  } catch {
    toast.error('Erro ao desvincular secretária')
  } finally {
    removing.value = false
  }
}

const expandedUser = ref<string | null>(null)

function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}
</script>

<template>
  <div v-if="isLoading" class="py-8 text-center text-slate-400 text-sm">Carregando...</div>
  <div v-else-if="roomUsers.length === 0" class="py-8 text-center">
    <Users class="w-8 h-8 text-slate-300 mx-auto mb-2" />
    <p class="text-slate-400 text-sm">Nenhuma secretária vinculada a esta sala.</p>
    <p class="text-slate-400 text-xs mt-1">Vincule secretárias na aba Dados e gerencie as permissões aqui.</p>
  </div>
  <div v-else class="space-y-3">
    <div v-for="u in roomUsers" :key="u.id" class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="flex items-center gap-3 p-4 bg-slate-50">
        <div class="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
          <span class="text-primary-700 font-bold text-sm">{{ initials(u.secretary.name) }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-slate-900 text-sm">{{ u.secretary.name }}</p>
          <p class="text-xs text-slate-500">{{ u.secretary.email }}</p>
        </div>
        <button
          class="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
          @click="expandedUser = expandedUser === u.id ? null : u.id"
        >
          <Shield class="w-3.5 h-3.5" />
          Permissões
          <ChevronUp v-if="expandedUser === u.id" class="w-3 h-3" />
          <ChevronDown v-else class="w-3 h-3" />
        </button>
      </div>

      <div v-if="expandedUser === u.id" class="p-4 border-t border-slate-100 space-y-3">
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Permissões para esta sala</p>
        <div class="grid grid-cols-1 gap-2">
          <label
            v-for="perm in ROOM_PERM_LABELS" :key="perm.key"
            class="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              :checked="u[perm.key]"
              :disabled="updating"
              class="w-4 h-4 text-primary-600 mt-0.5 flex-shrink-0"
              @change="updatePermission(u.secretaryId, perm.key, ($event.target as HTMLInputElement).checked)"
            />
            <div>
              <p class="text-sm font-medium text-slate-900">{{ perm.label }}</p>
              <p class="text-xs text-slate-500">{{ perm.description }}</p>
            </div>
          </label>
        </div>
        <div class="pt-2 border-t border-slate-100">
          <button
            :disabled="removing"
            class="text-xs text-red-500 hover:text-red-700 font-medium"
            @click="removeUser(u.secretaryId)"
          >
            Remover desta sala
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
