<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2, Users, UserRound } from 'lucide-vue-next'
import Modal from '../ui/Modal.vue'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useAttendanceStore } from '../../stores/attendance'
import { useAuthStore } from '../../stores/auth'
import type { AttendanceAgent } from '../../types'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useAttendanceStore()
const auth = useAuthStore()

const mode = ref<'queue' | 'user'>('queue')
const target = ref('')
const note = ref('')
const agents = ref<AttendanceAgent[]>([])
const loadingAgents = ref(false)
const saving = ref(false)

const ROLE_LABEL: Record<string, string> = { DOCTOR: 'Especialista', SECRETARY: 'Secretária', ADMIN: 'Administrador' }
const activeQueues = computed(() => store.queues.filter(q => q.active))

watch(() => props.isOpen, async open => {
  if (!open) return
  mode.value = 'queue'
  target.value = ''
  note.value = ''
  store.fetchQueues()
  const roomId = store.detail?.room.id
  loadingAgents.value = true
  try {
    agents.value = (await api.get<AttendanceAgent[]>('/attendance/agents', { params: { roomId } })).data
  } catch {
    agents.value = []
  } finally {
    loadingAgents.value = false
  }
})

watch(mode, () => { target.value = '' })

async function confirm() {
  if (!target.value) return
  saving.value = true
  const body = mode.value === 'queue'
    ? { queueId: target.value, note: note.value.trim() || undefined }
    : { userId: target.value, note: note.value.trim() || undefined }
  const ok = await store.act('transfer', body)
  saving.value = false
  if (ok) {
    toast.success('Conversa transferida')
    emit('close')
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Transferir conversa" subtitle="Envie para uma fila ou direto para alguém da equipe" size="sm" @close="emit('close')">
    <div class="space-y-4">
      <div class="seg-control" role="tablist">
        <button :class="['seg-btn', mode === 'queue' ? 'active' : '']" role="tab" :aria-selected="mode === 'queue'" @click="mode = 'queue'">
          <Users class="w-4 h-4" /> Fila
        </button>
        <button :class="['seg-btn', mode === 'user' ? 'active' : '']" role="tab" :aria-selected="mode === 'user'" @click="mode = 'user'">
          <UserRound class="w-4 h-4" /> Pessoa
        </button>
      </div>

      <div class="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
        <template v-if="mode === 'queue'">
          <p v-if="!activeQueues.length" class="text-sm text-slate-400 text-center py-6">Nenhuma fila disponível.</p>
          <label
            v-for="q in activeQueues"
            :key="q.id"
            :class="['flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors', target === q.id ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200 hover:bg-slate-50']"
          >
            <input v-model="target" type="radio" name="transfer-target" :value="q.id" class="sr-only" />
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ background: q.color || '#94a3b8' }" />
            <span class="flex-1 text-sm text-slate-800">{{ q.name }}</span>
            <span v-if="store.detail?.queue?.id === q.id" class="text-[11px] text-slate-400">atual</span>
            <span v-else-if="q.waitingCount" class="text-[11px] text-slate-400">{{ q.waitingCount }} aguardando</span>
          </label>
        </template>

        <template v-else>
          <div v-if="loadingAgents" class="flex justify-center py-6"><Loader2 class="w-4 h-4 text-slate-400 animate-spin" /></div>
          <p v-else-if="!agents.length" class="text-sm text-slate-400 text-center py-6">Ninguém com acesso a esta sala.</p>
          <template v-else>
          <label
            v-for="a in agents"
            :key="a.id"
            :class="['flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors', target === a.id ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200 hover:bg-slate-50']"
          >
            <input v-model="target" type="radio" name="transfer-target" :value="a.id" class="sr-only" />
            <span class="flex-1 text-sm text-slate-800">{{ a.name }}<span v-if="a.id === auth.user?.id" class="text-slate-400"> (você)</span></span>
            <span class="text-[11px] text-slate-400">{{ ROLE_LABEL[a.role] ?? a.role }}</span>
          </label>
          </template>
        </template>
      </div>

      <div>
        <label class="label" for="transfer-note">Nota <span class="text-slate-400 font-normal">(opcional)</span></label>
        <textarea id="transfer-note" v-model="note" rows="2" maxlength="500" class="input-field resize-none" placeholder="Contexto para quem vai receber" />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button class="btn-secondary" @click="emit('close')">Cancelar</button>
        <button
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          :disabled="!target || saving"
          @click="confirm"
        >
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
          Transferir
        </button>
      </div>
    </template>
  </Modal>
</template>
