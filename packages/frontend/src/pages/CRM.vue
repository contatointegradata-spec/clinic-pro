<script setup lang="ts">
import { ref, computed } from 'vue'
import draggable from 'vuedraggable'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  TrendingUp, UserPlus, XCircle, MessageCircle, Loader2, Phone, Clock,
} from 'lucide-vue-next'
import PageHeader from '../components/ui/PageHeader.vue'
import Modal from '../components/ui/Modal.vue'
import toast from '../lib/toast'
import api from '../lib/api'
import { useQuery } from '../composables/useQuery'
import type { AiAgent, AiAgentMessage, CrmLead, CrmMetrics, LeadStatus, AiAgentConversation } from '../types'

type Period = '7d' | '30d' | 'all'

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'all', label: 'Tudo' },
]

const COLUMNS: { key: LeadStatus; label: string }[] = [
  { key: 'NOVO', label: 'Novo' },
  { key: 'EM_ANALISE', label: 'Em Análise' },
  { key: 'CONVERTIDO', label: 'Convertido' },
  { key: 'DESCARTADO', label: 'Descartado' },
]

// ─── Agente (pra saber qual chatbotId usar nas conversas) ──────────────────

const { data: agentData, isLoading: loadingAgent } = useQuery<AiAgent | null>({
  key: 'ai-agent',
  queryFn: () => api.get('/ai-agent').then(r => r.data),
})
const agent = computed(() => agentData.value ?? null)

// ─── Métricas ───────────────────────────────────────────────────────────────

const period = ref<Period>('30d')
const metricsKey = computed(() => `crm-metrics-${agent.value?.id ?? ''}-${period.value}`)
const { data: metricsData, isLoading: loadingMetrics } = useQuery<CrmMetrics>({
  key: metricsKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/crm-metrics`, { params: { period: period.value } }).then(r => r.data),
  enabled: computed(() => !!agent.value?.id),
})
const metrics = computed(() => metricsData.value ?? null)

// ─── Kanban de leads ────────────────────────────────────────────────────────

const { data: leadsData, isLoading: loadingLeads, refetch: refetchLeads } = useQuery<CrmLead[]>({
  key: 'crm-leads',
  queryFn: () => api.get('/chatbot-light/pre-schedulings').then(r => r.data),
})
const leads = computed(() => leadsData.value ?? [])

const columnLeads = computed(() => {
  const map: Record<LeadStatus, CrmLead[]> = { NOVO: [], EM_ANALISE: [], CONVERTIDO: [], DESCARTADO: [] }
  for (const lead of leads.value) {
    const status = lead.leadStatus ?? 'NOVO'
    map[status]?.push(lead)
  }
  return map
})

const movingLeadId = ref<string | null>(null)
async function onCardMoved(newStatus: LeadStatus, evt: { added?: { element: CrmLead } }) {
  const lead = evt.added?.element
  if (!lead) return
  movingLeadId.value = lead.id
  try {
    await api.patch(`/chatbot-light/pre-schedulings/${lead.id}/lead-status`, { leadStatus: newStatus })
    toast.success(newStatus === 'CONVERTIDO' ? 'Lead convertido em paciente!' : 'Lead atualizado')
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Erro ao mover lead')
  } finally {
    movingLeadId.value = null
    await refetchLeads()
  }
}

function timeAgo(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
}

// ─── Conversas em andamento + transcrição ──────────────────────────────────

const conversationsKey = computed(() => `ai-agent-conversations-${agent.value?.id ?? ''}`)
const { data: contactsData, isLoading: loadingContacts } = useQuery<AiAgentConversation[]>({
  key: conversationsKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/conversations`).then(r => r.data),
  enabled: computed(() => !!agent.value?.id),
})
const contacts = computed(() => contactsData.value ?? [])

const transcriptOpen = ref(false)
const transcriptPhone = ref<string | null>(null)
const transcriptName = ref<string | null>(null)

const transcriptKey = computed(() => `ai-agent-conversation-${agent.value?.id ?? ''}-${transcriptPhone.value ?? ''}`)
const { data: transcriptData, isLoading: loadingTranscript } = useQuery<AiAgentMessage[]>({
  key: transcriptKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/conversations/${transcriptPhone.value}`).then(r => r.data),
  enabled: computed(() => !!agent.value?.id && !!transcriptPhone.value && transcriptOpen.value),
})
const transcriptMessages = computed(() => transcriptData.value ?? [])

function openTranscript(phone: string, name?: string | null) {
  transcriptPhone.value = phone
  transcriptName.value = name ?? null
  transcriptOpen.value = true
}

function openLeadTranscript(lead: CrmLead) {
  openTranscript(lead.phone, lead.name)
}
</script>

<template>
  <div class="space-y-4 page-stagger">
    <PageHeader title="CRM" subtitle="Gestão de follow-up do Agente de IA — leads, conversas e conversão" />

    <div v-if="loadingAgent" class="flex justify-center py-16">
      <Loader2 class="w-6 h-6 animate-spin text-primary-500" />
    </div>

    <div v-else-if="!agent" class="empty-state py-16">
      <MessageCircle class="w-10 h-10 text-slate-200 mb-3" />
      <p class="text-slate-500 font-medium text-sm">Crie o Agente de IA primeiro</p>
      <p class="text-slate-400 text-xs mt-1">O CRM acompanha os leads capturados pelo Agente de IA — configure-o em "Agente de IA".</p>
    </div>

    <template v-else>
      <!-- ─── Métricas ──────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between flex-wrap gap-2">
        <p class="text-sm font-semibold text-slate-700">Métricas</p>
        <div class="inline-flex bg-slate-100 rounded-xl p-1">
          <button
            v-for="p in PERIOD_OPTIONS"
            :key="p.key"
            @click="period = p.key"
            :class="[
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              period === p.key ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            ]"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="card p-4">
          <div class="flex items-center gap-2 text-slate-400 mb-2">
            <UserPlus class="w-4 h-4" />
            <span class="text-xs font-semibold uppercase tracking-wide">Novos leads</span>
          </div>
          <p class="text-2xl font-bold text-slate-900">
            <Loader2 v-if="loadingMetrics" class="w-5 h-5 animate-spin text-slate-300" />
            <template v-else>{{ metrics?.newLeads ?? 0 }}</template>
          </p>
        </div>
        <div class="card p-4">
          <div class="flex items-center gap-2 text-slate-400 mb-2">
            <TrendingUp class="w-4 h-4" />
            <span class="text-xs font-semibold uppercase tracking-wide">Taxa de conversão</span>
          </div>
          <p class="text-2xl font-bold text-slate-900">
            <Loader2 v-if="loadingMetrics" class="w-5 h-5 animate-spin text-slate-300" />
            <template v-else>{{ metrics?.conversionRate ?? 0 }}%</template>
          </p>
          <p class="text-xs text-slate-400 mt-0.5">{{ metrics?.convertedLeads ?? 0 }} convertidos</p>
        </div>
        <div class="card p-4">
          <div class="flex items-center gap-2 text-slate-400 mb-2">
            <XCircle class="w-4 h-4" />
            <span class="text-xs font-semibold uppercase tracking-wide">Cancelamentos</span>
          </div>
          <p class="text-2xl font-bold text-slate-900">
            <Loader2 v-if="loadingMetrics" class="w-5 h-5 animate-spin text-slate-300" />
            <template v-else>{{ metrics?.cancellations ?? 0 }}</template>
          </p>
        </div>
        <div class="card p-4">
          <div class="flex items-center gap-2 text-slate-400 mb-2">
            <MessageCircle class="w-4 h-4" />
            <span class="text-xs font-semibold uppercase tracking-wide">Conversas em andamento</span>
          </div>
          <p class="text-2xl font-bold text-slate-900">
            <Loader2 v-if="loadingMetrics" class="w-5 h-5 animate-spin text-slate-300" />
            <template v-else>{{ metrics?.ongoingConversations ?? 0 }}</template>
          </p>
          <p class="text-xs text-slate-400 mt-0.5">últimas 48h</p>
        </div>
      </div>

      <!-- ─── Kanban ─────────────────────────────────────────────────────── -->
      <div>
        <p class="text-sm font-semibold text-slate-700 mb-2">Esteira de atendimento</p>
        <div v-if="loadingLeads" class="flex justify-center py-12">
          <Loader2 class="w-5 h-5 animate-spin text-primary-500" />
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div v-for="col in COLUMNS" :key="col.key" class="bg-slate-50 rounded-2xl border border-slate-200 flex flex-col">
            <div class="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <p class="text-xs font-semibold text-slate-600 uppercase tracking-wide">{{ col.label }}</p>
              <span class="text-[11px] text-slate-400 bg-white rounded-full px-1.5 py-0.5 border border-slate-200">
                {{ columnLeads[col.key].length }}
              </span>
            </div>
            <draggable
              :list="columnLeads[col.key]"
              :group="{ name: 'leads' }"
              item-key="id"
              class="flex-1 p-2 space-y-2 min-h-[120px]"
              @change="(evt: any) => onCardMoved(col.key, evt)"
            >
              <template #item="{ element: lead }: { element: CrmLead }">
                <div
                  @click="openLeadTranscript(lead)"
                  :class="[
                    'bg-white rounded-xl border border-slate-200 p-3 cursor-pointer hover:border-primary-300 hover:shadow-sm transition-all',
                    movingLeadId === lead.id ? 'opacity-50' : '',
                  ]"
                >
                  <p class="text-sm font-semibold text-slate-800 truncate">{{ lead.name }}</p>
                  <p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Phone class="w-3 h-3" /> {{ lead.phone }}
                  </p>
                  <p class="text-xs text-slate-400 flex items-center gap-1 mt-1">
                    <Clock class="w-3 h-3" /> {{ timeAgo(lead.createdAt) }}
                  </p>
                </div>
              </template>
            </draggable>
          </div>
        </div>
        <p class="text-xs text-slate-400 mt-2">Arraste os cards entre as colunas para atualizar o status do lead. Clique em um card para ver a conversa completa.</p>
      </div>

      <!-- ─── Conversas em andamento ─────────────────────────────────────── -->
      <div>
        <p class="text-sm font-semibold text-slate-700 mb-2">Conversas em andamento</p>
        <div v-if="loadingContacts" class="flex justify-center py-8">
          <Loader2 class="w-5 h-5 animate-spin text-primary-500" />
        </div>
        <div v-else-if="contacts.length === 0" class="card py-10 text-center">
          <MessageCircle class="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p class="text-slate-400 text-sm">Nenhuma conversa registrada ainda</p>
        </div>
        <div v-else class="card p-0 divide-y divide-slate-100">
          <button
            v-for="c in contacts"
            :key="c.phone"
            @click="openTranscript(c.phone, c.name)"
            class="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <p class="text-sm font-semibold text-slate-800 truncate">{{ c.name || c.phone }}</p>
              <p v-if="c.name" class="text-xs text-slate-400">{{ c.phone }}</p>
              <p class="text-xs text-slate-500 truncate mt-0.5">{{ c.lastMessage }}</p>
            </div>
            <span class="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">{{ timeAgo(c.lastMessageAt) }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- ─── Modal de transcrição ─────────────────────────────────────────── -->
    <Modal :is-open="transcriptOpen" @close="transcriptOpen = false" :title="transcriptName || transcriptPhone || ''" :subtitle="transcriptName ? transcriptPhone ?? undefined : undefined" size="lg">
      <div v-if="loadingTranscript" class="flex justify-center py-10">
        <Loader2 class="w-5 h-5 animate-spin text-primary-500" />
      </div>
      <div v-else-if="transcriptMessages.length === 0" class="text-center text-slate-400 text-sm py-10">
        Nenhuma mensagem encontrada para este contato.
      </div>
      <div v-else class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <div v-for="m in transcriptMessages" :key="m.id" :class="['flex', m.role === 'assistant' ? 'justify-end' : 'justify-start']">
          <div :class="['max-w-[75%] rounded-2xl px-3 py-2 text-sm', m.role === 'assistant' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-800']">
            {{ m.content }}
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
