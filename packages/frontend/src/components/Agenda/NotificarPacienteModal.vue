<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bell, Send, Loader2, MessageSquare } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import Modal from '../ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

interface NotifTemplate {
  id: string
  name: string
  message: string
  active: boolean
}

const props = defineProps<{
  isOpen: boolean
  appointmentId: string
  patientName: string
  patientPhone?: string
}>()

const emit = defineEmits<{ close: [] }>()

const selectedId = ref('')
const loading = ref(false)

const isOpenRef = computed(() => props.isOpen)

const { data: templatesData, isLoading } = useQuery<NotifTemplate[]>({
  key: 'light-notif-templates',
  queryFn: () => api.get('/chatbot-light/notification-templates').then(r => r.data),
  enabled: isOpenRef,
})
const templates = computed(() => templatesData.value ?? [])

const previewKey = computed(() => `notify-preview-${props.appointmentId}-${selectedId.value}`)
const previewEnabled = computed(() => props.isOpen && !!selectedId.value)

const { data: previewData, isLoading: previewLoading } = useQuery<{ message: string }>({
  key: previewKey,
  queryFn: () =>
    api.get(`/appointments/${props.appointmentId}/notify-preview`, { params: { templateId: selectedId.value } }).then(r => r.data),
  enabled: previewEnabled,
  staleTime: 30_000,
})

const activeTemplates = computed(() => templates.value.filter(t => t.active))

async function handleSend() {
  if (!selectedId.value) {
    toast.error('Selecione uma notificação')
    return
  }
  loading.value = true
  try {
    await api.post(`/appointments/${props.appointmentId}/notify-patient`, { templateId: selectedId.value })
    toast.success('Mensagem enviada via WhatsApp!')
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg ?? 'Erro ao enviar notificação')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Notificar Paciente" :subtitle="patientName" size="md" @close="emit('close')">
    <div class="space-y-4">
      <div v-if="patientPhone" class="flex items-center gap-2 text-sm text-slate-500">
        <MessageSquare class="w-4 h-4 text-emerald-500" />
        Será enviado para <span class="font-medium text-slate-700">{{ patientPhone }}</span> via WhatsApp
      </div>

      <div v-if="isLoading" class="flex justify-center py-8">
        <Loader2 class="w-5 h-5 animate-spin text-primary-500" />
      </div>
      <div v-else-if="activeTemplates.length === 0" class="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p class="font-medium mb-1">Nenhuma notificação cadastrada</p>
        <p>Acesse <strong>Chatbot Light &rsaquo; Notificações</strong> para criar templates de mensagem.</p>
      </div>
      <div v-else class="space-y-2">
        <label class="label">Escolha a notificação</label>
        <button
          v-for="t in activeTemplates"
          :key="t.id"
          type="button"
          class="w-full text-left p-3.5 rounded-xl border transition-colors"
          :class="selectedId === t.id
            ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
          @click="selectedId = t.id"
        >
          <div class="flex items-center gap-2 mb-1">
            <Bell class="w-3.5 h-3.5 flex-shrink-0" :class="selectedId === t.id ? 'text-primary-600' : 'text-slate-400'" />
            <span class="text-sm font-semibold" :class="selectedId === t.id ? 'text-primary-800' : 'text-slate-800'">{{ t.name }}</span>
          </div>
          <p class="text-xs text-slate-400 line-clamp-1 pl-5 font-mono">{{ t.message }}</p>
        </button>
      </div>

      <!-- Preview com variáveis reais resolvidas pelo backend -->
      <div v-if="selectedId" class="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
        <div class="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <p class="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Pré-visualização</p>
          <Loader2 v-if="previewLoading" class="w-3 h-3 animate-spin text-slate-400" />
        </div>
        <div class="p-3">
          <p v-if="previewLoading" class="text-xs text-slate-400 italic">Carregando...</p>
          <p v-else class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {{ previewData?.message ?? '—' }}
          </p>
        </div>
      </div>

      <div class="flex gap-3 pt-2">
        <button type="button" class="btn-ghost flex-1" @click="emit('close')">Cancelar</button>
        <button
          type="button"
          :disabled="loading || !selectedId || activeTemplates.length === 0"
          class="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          @click="handleSend"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <Send v-else class="w-4 h-4" />
          {{ loading ? 'Enviando...' : 'Enviar' }}
        </button>
      </div>
    </div>
  </Modal>
</template>
