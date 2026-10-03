<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Edit2, MapPin, Clock, Users, CheckCircle, XCircle, Building2 } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { Room, DoctorSecretary } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import RoomForm from '../../components/Salas/RoomForm.vue'
import RoomDetailModal from '../../components/Salas/RoomDetailModal.vue'
import { useQuery } from '../../composables/useQuery'

const DAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

const createModalOpen = ref(false)
const detailRoom = ref<Room | null>(null)
const creating = ref(false)

const { data: roomsData, refetch: refetchRooms } = useQuery<Room[]>({
  key: 'rooms',
  queryFn: () => api.get('/rooms').then(r => r.data),
})
const rooms = computed(() => roomsData.value ?? [])

const { data: teamData } = useQuery<DoctorSecretary[]>({
  key: 'team',
  queryFn: () => api.get('/team').then(r => r.data),
})
const secretaries = computed(() => (teamData.value ?? []).filter(t => t.active))

async function handleCreate(data: Record<string, unknown>) {
  creating.value = true
  try {
    await api.post('/rooms', data)
    toast.success('Sala criada!')
    createModalOpen.value = false
    await refetchRooms()
  } catch {
    toast.error('Erro ao criar sala')
  } finally {
    creating.value = false
  }
}

const toggling = ref(false)
async function handleToggle(id: string) {
  toggling.value = true
  try {
    await api.patch(`/rooms/${id}/toggle`)
    toast.success('Status alterado')
    await refetchRooms()
  } finally {
    toggling.value = false
  }
}

function dayLabel(days: number[]) {
  return DAYS.filter(d => days.includes(d.value)).map(d => d.label).join(', ')
}

function addressLine(room: Room): string | null {
  const parts = [room.logradouro, room.numero, (room as unknown as { bairro?: string }).bairro].filter(Boolean).join(', ')
  const city = room.cidade || ''
  return [parts, city].filter(Boolean).join(' — ') || null
}

async function handleDetailSaved() {
  await refetchRooms()
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div class="flex items-start justify-between">
      <div class="animate-stagger-1">
        <h1 class="page-title">Clínica</h1>
        <p class="page-subtitle">Configure locais e equipe por sala</p>
      </div>
      <button class="btn-primary animate-stagger-1" @click="createModalOpen = true">
        <Plus class="w-4 h-4" /> Nova Sala
      </button>
    </div>

    <div v-if="rooms.length === 0" class="card text-center py-12 animate-stagger-2">
      <Building2 class="w-10 h-10 text-slate-300 mx-auto mb-3 animate-float" />
      <p class="text-slate-400">Nenhuma sala cadastrada</p>
      <button class="text-primary-600 text-sm font-medium mt-2 hover:underline" @click="createModalOpen = true">
        Criar primeira sala
      </button>
    </div>
    <div v-else class="space-y-3">
      <div v-for="room in rooms" :key="room.id" class="card flex items-start gap-4" :class="!room.active ? 'opacity-60' : ''">
        <div class="w-10 h-10 bg-primary-50 border border-primary-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
          <Building2 class="w-5 h-5 text-primary-600" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-semibold text-slate-900">{{ room.name }}</p>
            <span v-if="!room.active" class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativa</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500">
            <span v-if="addressLine(room)" class="flex items-center gap-1">
              <MapPin class="w-3 h-3" />
              {{ addressLine(room) }}
            </span>
            <span class="flex items-center gap-1">
              <Clock class="w-3 h-3" />
              {{ room.startTime }} – {{ room.endTime }}
            </span>
            <span>{{ dayLabel(room.daysOfWeek) }}</span>
            <span v-if="room.secretaries && room.secretaries.filter(s => s.active).length > 0" class="flex items-center gap-1 text-primary-600">
              <Users class="w-3 h-3" />
              {{ room.secretaries.filter(s => s.active).map(s => s.secretary.name).join(', ') }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button
            class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
            title="Configurar sala"
            @click="detailRoom = room"
          >
            <Edit2 class="w-4 h-4" />
          </button>
          <button
            :disabled="toggling"
            class="p-1.5 rounded-lg transition-colors"
            :class="room.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
            :title="room.active ? 'Desativar' : 'Ativar'"
            @click="handleToggle(room.id)"
          >
            <XCircle v-if="room.active" class="w-4 h-4" />
            <CheckCircle v-else class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <div class="card bg-primary-50 border-primary-200 text-sm text-primary-700 space-y-1">
      <p class="font-semibold text-primary-900">Como funciona</p>
      <p>• Cada sala tem seus próprios dias, horários, endereço e WhatsApp</p>
      <p>• Vincule secretárias e configure permissões individuais por sala</p>
      <p>• Mensagens automáticas respeitam a conexão WhatsApp da sala</p>
    </div>

    <!-- Modal criar sala -->
    <Modal :is-open="createModalOpen" title="Nova Sala de Atendimento" size="lg" @close="createModalOpen = false">
      <RoomForm :room="null" :secretaries="secretaries" :loading="creating" @submit="handleCreate" />
    </Modal>

    <!-- Modal detalhes/edição com abas -->
    <RoomDetailModal
      v-if="detailRoom"
      :room="detailRoom"
      :secretaries="secretaries"
      @close="detailRoom = null"
      @saved="handleDetailSaved"
    />
  </div>
</template>
