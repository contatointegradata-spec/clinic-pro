<script setup lang="ts">
import { ref, watch } from 'vue'
import { Plus, Trash2, Users, Loader2, Star } from 'lucide-vue-next'
import Modal from '../ui/Modal.vue'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useAttendanceStore } from '../../stores/attendance'
import { errorMessage } from './format'
import type { AttendanceAgent, AttendanceQueue } from '../../types'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useAttendanceStore()
const agents = ref<AttendanceAgent[]>([])
const expanded = ref<string | null>(null)
const memberDraft = ref<string[]>([])
const newName = ref('')
const busy = ref(false)

watch(() => props.isOpen, async open => {
  if (!open) return
  expanded.value = null
  store.fetchQueues()
  try {
    agents.value = (await api.get<AttendanceAgent[]>('/attendance/agents')).data
  } catch { agents.value = [] }
})

async function guard(fn: () => Promise<unknown>, fallback: string) {
  busy.value = true
  try {
    await fn()
    await store.fetchQueues()
    return true
  } catch (e) {
    toast.error(errorMessage(e, fallback))
    return false
  } finally {
    busy.value = false
  }
}

async function create() {
  const name = newName.value.trim()
  if (!name) return
  if (await guard(() => api.post('/attendance/queues', { name, kind: 'CUSTOM' }), 'Erro ao criar fila')) newName.value = ''
}

function patch(q: AttendanceQueue, body: Partial<Pick<AttendanceQueue, 'name' | 'color'>>) {
  if (body.name !== undefined && (!body.name.trim() || body.name.trim() === q.name)) return
  if (body.color !== undefined && body.color === q.color) return
  guard(() => api.patch(`/attendance/queues/${q.id}`, body), 'Erro ao atualizar fila')
}

function remove(q: AttendanceQueue) {
  if (!confirm(`Excluir a fila "${q.name}"? As conversas dela vão para a fila padrão.`)) return
  guard(() => api.delete(`/attendance/queues/${q.id}`), 'Erro ao excluir fila')
}

function toggleMembers(q: AttendanceQueue) {
  if (expanded.value === q.id) { expanded.value = null; return }
  expanded.value = q.id
  memberDraft.value = q.members.map(m => m.id)
}

async function saveMembers(q: AttendanceQueue) {
  if (await guard(() => api.put(`/attendance/queues/${q.id}/members`, { userIds: memberDraft.value }), 'Erro ao salvar membros')) {
    expanded.value = null
    toast.success('Membros atualizados')
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Filas de atendimento" subtitle="Organize quem recebe cada tipo de conversa" size="md" @close="emit('close')">
    <ul class="divide-y divide-slate-100 -my-2">
      <li v-for="q in store.queues" :key="q.id" class="py-3">
        <div class="flex items-center gap-2.5">
          <input
            type="color"
            :value="q.color || '#94a3b8'"
            class="w-6 h-6 rounded-full border-0 p-0 cursor-pointer bg-transparent flex-shrink-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
            :aria-label="`Cor da fila ${q.name}`"
            @change="patch(q, { color: ($event.target as HTMLInputElement).value })"
          />
          <input
            :value="q.name"
            maxlength="40"
            class="flex-1 min-w-0 text-sm text-slate-800 bg-transparent px-2 py-1 -mx-2 rounded-lg hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            :aria-label="`Nome da fila ${q.name}`"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @blur="patch(q, { name: ($event.target as HTMLInputElement).value })"
          />
          <span v-if="q.isDefault" class="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md flex-shrink-0" title="Fila de entrada padrão">
            <Star class="w-3 h-3" /> Padrão
          </span>
          <button class="btn-ghost px-2 py-1 text-xs flex-shrink-0" :aria-expanded="expanded === q.id" @click="toggleMembers(q)">
            <Users class="w-3.5 h-3.5" /> {{ q.members.length }}
          </button>
          <button v-if="!q.isDefault" class="btn-icon w-8 h-8 hover:text-red-600 hover:bg-red-50 flex-shrink-0" :aria-label="`Excluir fila ${q.name}`" :disabled="busy" @click="remove(q)">
            <Trash2 class="w-4 h-4" />
          </button>
          <span v-else class="w-8 flex-shrink-0" />
        </div>

        <div v-if="expanded === q.id" class="mt-3 ml-8 p-3 rounded-xl bg-slate-50">
          <p class="text-xs text-slate-500 mb-2">Quem recebe as conversas desta fila (o especialista sempre vê todas):</p>
          <p v-if="!agents.length" class="text-xs text-slate-400">Nenhum membro da equipe encontrado.</p>
          <label v-for="a in agents" :key="a.id" class="flex items-center gap-2 py-1 text-sm text-slate-700 cursor-pointer">
            <input v-model="memberDraft" type="checkbox" :value="a.id" class="rounded border-slate-300 text-primary-600 focus:ring-primary-200" />
            {{ a.name }}
          </label>
          <div class="flex justify-end mt-2">
            <button class="btn-primary px-3 py-1.5 text-xs" :disabled="busy" @click="saveMembers(q)">
              <Loader2 v-if="busy" class="w-3.5 h-3.5 animate-spin" /> Salvar membros
            </button>
          </div>
        </div>
      </li>
    </ul>

    <template #footer>
      <form class="flex gap-2" @submit.prevent="create">
        <input v-model="newName" maxlength="40" class="input-field py-2" placeholder="Nova fila (ex.: Financeiro)" aria-label="Nome da nova fila" />
        <button type="submit" class="btn-primary py-2 flex-shrink-0" :disabled="!newName.trim() || busy">
          <Plus class="w-4 h-4" /> Criar
        </button>
      </form>
    </template>
  </Modal>
</template>
