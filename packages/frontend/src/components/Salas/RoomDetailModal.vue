<script setup lang="ts">
import { ref } from 'vue'
import { Building2, Users, History, Wifi } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { Room, DoctorSecretary } from '../../types'
import Modal from '../ui/Modal.vue'
import RoomForm from './RoomForm.vue'
import PermissionsTab from './PermissionsTab.vue'
import HistoryTab from './HistoryTab.vue'
import WhatsAppTab from './WhatsAppTab.vue'

type TabId = 'dados' | 'equipe' | 'whatsapp' | 'historico'

const props = defineProps<{
  room: Room
  secretaries: DoctorSecretary[]
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const tab = ref<TabId>('dados')
const saving = ref(false)

const tabs: { id: TabId; label: string; icon: typeof Building2 }[] = [
  { id: 'dados', label: 'Dados', icon: Building2 },
  { id: 'equipe', label: 'Equipe', icon: Users },
  { id: 'whatsapp', label: 'WhatsApp', icon: Wifi },
  { id: 'historico', label: 'Histórico', icon: History },
]

async function handleSave(data: Record<string, unknown>) {
  saving.value = true
  try {
    await api.put(`/rooms/${props.room.id}`, data)
    toast.success('Sala atualizada!')
    tab.value = 'dados'
    emit('saved')
  } catch {
    toast.error('Erro ao atualizar sala')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :is-open="true" :title="`Sala: ${room.name}`" size="lg" @close="emit('close')">
    <div class="flex gap-1 mb-5 border-b border-slate-100 -mx-1 px-1 overflow-x-auto">
      <button
        v-for="t in tabs" :key="t.id"
        class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap border-b-2"
        :class="tab === t.id ? 'border-primary-600 text-primary-700 bg-primary-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'"
        @click="tab = t.id"
      >
        <component :is="t.icon" class="w-3.5 h-3.5" />
        {{ t.label }}
      </button>
    </div>

    <RoomForm v-if="tab === 'dados'" :room="room" :secretaries="secretaries" :loading="saving" @submit="handleSave" />
    <PermissionsTab v-else-if="tab === 'equipe'" :room="room" />
    <WhatsAppTab v-else-if="tab === 'whatsapp'" :room="room" />
    <HistoryTab v-else-if="tab === 'historico'" :room="room" />
  </Modal>
</template>
