<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type Component } from 'vue'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Webhook, Calendar, Mail, MessageCircle, Bot,
  Plus, Trash2, Power, FlaskConical, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Info, Copy, ExternalLink,
  Shield, Zap, Activity, Lock, ShoppingCart,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { Integration, WebhookLog, IntegrationType } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import SecretaryGate from '../../components/ui/SecretaryGate.vue'
import { useAuthStore } from '../../stores/auth'
import { useQuery } from '../../composables/useQuery'
import {
  useSecretaryPermissions, INTEGRATION_PERMISSION_KEYS, PERMISSION_KEY_TO_INTEGRATION_TYPE,
  type SecretaryPermissionKey,
} from '../../composables/useSecretaryPermissions'

// ─── addon status ──────────────────────────────────────────────────────────────

interface IntegrationAddonStatus {
  type: IntegrationType
  label: string
  priceCents: number
  status: 'INACTIVE' | 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'
  currentPeriodEndsAt: string | null
}

const ADDON_STATUS_LABEL: Record<IntegrationAddonStatus['status'], { label: string; className: string }> = {
  INACTIVE: { label: 'Não contratado', className: 'bg-slate-100 text-slate-500' },
  PENDING_PAYMENT: { label: 'Pagamento pendente', className: 'bg-amber-100 text-amber-700' },
  ACTIVE: { label: 'Contratado', className: 'bg-emerald-100 text-emerald-700' },
  PAST_DUE: { label: 'Pagamento atrasado', className: 'bg-amber-100 text-amber-700' },
  CANCELED: { label: 'Cancelado', className: 'bg-slate-100 text-slate-500' },
  BLOCKED: { label: 'Bloqueado', className: 'bg-red-100 text-red-700' },
}

// ─── integration meta ──────────────────────────────────────────────────────────

const INTEGRATION_META: Record<IntegrationType, {
  label: string
  description: string
  icon: Component
  color: string
  bg: string
  border: string
  badge: string
  docsUrl?: string
}> = {
  WEBHOOK: {
    label: 'Webhook',
    description: 'Envie dados para qualquer URL ao ocorrer eventos (n8n, Make, Zapier, chatbots, IA)',
    icon: Webhook,
    color: 'text-primary-600',
    bg: 'bg-primary-50',
    border: 'border-primary-200',
    badge: 'bg-primary-100 text-primary-700',
  },
  GOOGLE_CALENDAR: {
    label: 'Google Calendar',
    description: 'Sincronize agendamentos com sua agenda do Google Calendar automaticamente',
    icon: Calendar,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
  },
  GOOGLE_GMAIL: {
    label: 'Gmail',
    description: 'Envie confirmações e lembretes de consulta via Gmail automaticamente',
    icon: Mail,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700',
    docsUrl: 'https://developers.google.com/gmail/api/guides',
  },
  WHATSAPP: {
    label: 'WhatsApp',
    description: 'Envie mensagens via WhatsApp Business API (Evolution API / Baileys)',
    icon: MessageCircle,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    badge: 'bg-green-100 text-green-700',
    docsUrl: 'https://doc.evolution-api.com',
  },
  AI_AGENT: {
    label: 'Agente de IA',
    description: 'Conecte um agente de IA (OpenAI, Gemini, ou webhook de chatbot personalizado)',
    icon: Bot,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    badge: 'bg-purple-100 text-purple-700',
    docsUrl: 'https://platform.openai.com/docs/overview',
  },
}

const INTEGRATION_TYPES = Object.keys(INTEGRATION_META) as IntegrationType[]

const WEBHOOK_EVENTS = [
  { value: 'appointment.created', label: 'Consulta agendada' },
  { value: 'appointment.updated', label: 'Consulta atualizada' },
  { value: 'appointment.completed', label: 'Consulta concluída' },
  { value: 'appointment.cancelled', label: 'Consulta cancelada' },
  { value: 'patient.created', label: 'Novo paciente cadastrado' },
  { value: 'transaction.created', label: 'Transação financeira criada' },
]

const WEBHOOK_PAYLOAD_EXAMPLE = `{
  "event": "appointment.created",
  "timestamp": "2025-06-06T10:30:00.000Z",
  "data": {
    "id": "appt_abc123",
    "patientName": "João Silva",
    "patientPhone": "(11) 99999-9999",
    "doctorName": "Dr. Ana Costa",
    "date": "2025-06-10T14:00:00.000Z",
    "type": "Consulta",
    "status": "SCHEDULED",
    "value": 200.00
  }
}`

const WEBHOOK_HEADERS_EXAMPLE = `Content-Type: application/json
User-Agent: ClinIQ-Pro/1.0
X-ClinIQ-Event: appointment.created
X-ClinIQ-Timestamp: 2025-06-06T10:30:00.000Z
X-ClinIQ-Signature: sha256=<hmac-sha256-do-corpo>  ← apenas se secret configurado`

// ─── tutorials ──────────────────────────────────────────────────────────────

const TUTORIALS = [
  {
    title: 'Conectar ao n8n (automação gratuita)',
    icon: Zap,
    color: 'text-orange-600',
    steps: [
      'Instale o n8n (n8n.io) em seu servidor ou use n8n.cloud',
      'Crie um novo Workflow e adicione o nó "Webhook"',
      'Copie a URL gerada pelo n8n',
      'No ClinIQ Pro, crie uma integração do tipo Webhook e cole a URL',
      'Ative a integração e selecione os eventos desejados',
      'No n8n, adicione ações após o webhook (enviar email, WhatsApp, Google Calendar, etc.)',
    ],
  },
  {
    title: 'Conectar ao Make.com (ex-Integromat)',
    icon: Activity,
    color: 'text-violet-600',
    steps: [
      'Crie uma conta em make.com',
      'Clique em "+ Create a new scenario"',
      'Adicione o módulo "Webhooks > Custom Webhook"',
      'Copie a URL do webhook gerada',
      'No ClinIQ Pro, crie uma integração Webhook com essa URL',
      'Configure os módulos seguintes (Google Sheets, Calendar, WhatsApp, etc.)',
    ],
  },
  {
    title: 'Segurança: verificar assinatura HMAC',
    icon: Shield,
    color: 'text-primary-600',
    steps: [
      'Configure um "Secret" na sua integração Webhook',
      'Cada requisição terá o header X-ClinIQ-Signature: sha256=<hash>',
      'No seu servidor, calcule HMAC-SHA256 do corpo da requisição usando o mesmo secret',
      'Compare o hash calculado com o do header para garantir autenticidade',
      'Rejeite requisições com assinatura inválida (status 401)',
    ],
  },
  {
    title: 'Google Calendar via n8n (sem OAuth manual)',
    icon: Calendar,
    color: 'text-emerald-600',
    steps: [
      'No n8n, crie um workflow com trigger Webhook',
      'Adicione o nó "Google Calendar > Create Event"',
      'Autentique com sua conta Google no n8n (processo guiado)',
      'Mapeie os campos: patientName → title, date → start, etc.',
      'Configure a URL desse workflow no ClinIQ Pro como Webhook',
      'Ative o evento "appointment.created"',
    ],
  },
]

const openTutorial = ref<number | null>(null)
function toggleTutorial(i: number) {
  openTutorial.value = openTutorial.value === i ? null : i
}

const EXTERNAL_LINKS = [
  { label: 'n8n.io', desc: 'Automação open-source', url: 'https://n8n.io', color: 'text-orange-600' },
  { label: 'Make.com', desc: 'Automação visual', url: 'https://make.com', color: 'text-violet-600' },
  { label: 'Evolution API', desc: 'WhatsApp API', url: 'https://doc.evolution-api.com', color: 'text-green-600' },
  { label: 'Flowise', desc: 'Chatbot com IA', url: 'https://flowiseai.com', color: 'text-primary-600' },
]

// ─── auth / secretary permissions ──────────────────────────────────────────────

const authStore = useAuthStore()
const isManager = computed(() => authStore.user?.role === 'DOCTOR' || authStore.user?.role === 'ADMIN')
const { isSecretary, can } = useSecretaryPermissions()

const TYPE_TO_PERMISSION_KEY = Object.entries(PERMISSION_KEY_TO_INTEGRATION_TYPE).reduce((acc, [key, t]) => {
  if (t) acc[t as IntegrationType] = key as SecretaryPermissionKey
  return acc
}, {} as Partial<Record<IntegrationType, SecretaryPermissionKey>>)

function canSeeType(t: IntegrationType) {
  const key = TYPE_TO_PERMISSION_KEY[t]
  return key ? can(key) : true
}

// ─── modal / form state ────────────────────────────────────────────────────────

type ModalMode = 'create' | 'edit'
const modalOpen = ref(false)
const modalMode = ref<ModalMode>('create')
const editingIntegration = ref<Integration | null>(null)
const logsFor = ref<string | null>(null)

const type = ref<IntegrationType>('WEBHOOK')
const name = ref('')
const config = ref<Record<string, any>>({})
const events = ref<string[]>([])

// AIAgentForm fields that have a visual default before the user commits a value,
// matching the original React behaviour (default is shown but not written to config
// until changed).
const aiProvider = computed({
  get: () => (config.value.provider as string) || 'webhook',
  set: (v: string) => { config.value.provider = v },
})
const aiModel = computed({
  get: () => (config.value.model as string) || 'gpt-4o-mini',
  set: (v: string) => { config.value.model = v },
})

function toggleEvent(ev: string) {
  events.value = events.value.includes(ev) ? events.value.filter(e => e !== ev) : [...events.value, ev]
}

// ─── queries ────────────────────────────────────────────────────────────────────

const { data: integrationsData, refetch: refetchIntegrations } = useQuery<Integration[]>({
  key: 'integrations',
  queryFn: () => api.get('/integrations').then(r => r.data),
})
const integrations = computed(() => integrationsData.value ?? [])

const visibleIntegrations = computed(() => (
  isSecretary.value ? integrations.value.filter(i => canSeeType(i.type)) : integrations.value
))

const { data: addonsData, refetch: refetchAddons } = useQuery<IntegrationAddonStatus[]>({
  key: 'integration-addons',
  queryFn: () => api.get('/integration-addons').then(r => r.data),
  enabled: isManager,
})
const addons = computed(() => addonsData.value ?? [])
const addonByType = computed(() => new Map(addons.value.map(a => [a.type, a])))

const logsKey = computed(() => `webhook-logs:${logsFor.value ?? 'none'}`)
const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery<WebhookLog[]>({
  key: logsKey,
  queryFn: () => api.get(`/integrations/${logsFor.value}/logs`).then(r => r.data),
  enabled: computed(() => !!logsFor.value),
})
const logs = computed(() => logsData.value ?? [])

let logsInterval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  logsInterval = setInterval(() => { if (logsFor.value) refetchLogs() }, 10000)
})
onBeforeUnmount(() => {
  if (logsInterval) clearInterval(logsInterval)
})

// ─── actions (manual async, payloads identical to the original mutations) ──────

const checkoutLoadingType = ref<IntegrationType | null>(null)
async function checkout(t: IntegrationType) {
  checkoutLoadingType.value = t
  try {
    const { data } = await api.post(`/integration-addons/${t}/checkout`)
    window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer')
    await refetchAddons()
  } catch (err: unknown) {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(message || 'Erro ao gerar checkout do add-on')
  } finally {
    checkoutLoadingType.value = null
  }
}

const saving = ref(false)
async function handleSave() {
  if (!name.value.trim()) { toast.error('Informe um nome'); return }
  const payload = { type: type.value, name: name.value, config: config.value, events: events.value, active: false }
  saving.value = true
  try {
    if (modalMode.value === 'edit' && editingIntegration.value) {
      await api.put(`/integrations/${editingIntegration.value.id}`, payload)
      toast.success('Integração atualizada!')
    } else {
      await api.post('/integrations', payload)
      toast.success('Integração criada!')
    }
    await refetchIntegrations()
    modalOpen.value = false
  } catch {
    toast.error(modalMode.value === 'edit' ? 'Erro ao salvar' : 'Erro ao criar integração')
  } finally {
    saving.value = false
  }
}

const togglingId = ref<string | null>(null)
async function toggleIntegration(id: string) {
  togglingId.value = id
  try {
    await api.patch(`/integrations/${id}/toggle`)
    await refetchIntegrations()
  } catch {
    toast.error('Erro ao alterar status')
  } finally {
    togglingId.value = null
  }
}

async function removeIntegration(id: string) {
  if (!confirm('Remover integração?')) return
  try {
    await api.delete(`/integrations/${id}`)
    await refetchIntegrations()
    toast.success('Integração removida')
  } catch {
    toast.error('Erro ao remover')
  }
}

const testingId = ref<string | null>(null)
async function testIntegration(id: string) {
  testingId.value = id
  try {
    await api.post(`/integrations/${id}/test`)
    toast.success('Payload de teste enviado!')
    logsFor.value = id
    await refetchLogs()
  } catch {
    toast.error('Erro ao enviar teste')
  } finally {
    testingId.value = null
  }
}

function openCreate(t: IntegrationType) {
  modalMode.value = 'create'
  type.value = t
  name.value = INTEGRATION_META[t].label
  config.value = {}
  events.value = []
  editingIntegration.value = null
  modalOpen.value = true
}

function openEdit(intg: Integration) {
  modalMode.value = 'edit'
  type.value = intg.type
  name.value = intg.name
  config.value = { ...intg.config }
  events.value = [...intg.events]
  editingIntegration.value = intg
  modalOpen.value = true
}

function toggleLogsFor(id: string) {
  logsFor.value = logsFor.value === id ? null : id
}

function closeLogs() {
  logsFor.value = null
}

function copyToken(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copiado!')
}

const configured = computed(() => visibleIntegrations.value.filter(i => i.active).length)
const totalDeliveries = computed(() => visibleIntegrations.value.reduce((s, i) => s + (i._count?.webhookLogs ?? 0), 0))
</script>

<template>
  <SecretaryGate :permission="INTEGRATION_PERMISSION_KEYS">
    <div class="max-w-4xl mx-auto space-y-6 page-stagger">
      <!-- Header -->
      <div class="animate-stagger-1">
        <PageHeader title="Integrações" subtitle="Conecte o ClinIQ Pro a outras plataformas via webhook, Google, WhatsApp e IA" />
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="card p-4 animate-stagger-1">
          <p class="text-xs text-slate-500 uppercase tracking-wider mb-1">Total</p>
          <p class="text-2xl font-bold text-slate-900">{{ visibleIntegrations.length }}</p>
        </div>
        <div class="card p-4 animate-stagger-2">
          <p class="text-xs text-slate-500 uppercase tracking-wider mb-1">Ativas</p>
          <p class="text-2xl font-bold text-emerald-600">{{ configured }}</p>
        </div>
        <div class="card p-4 animate-stagger-3">
          <p class="text-xs text-slate-500 uppercase tracking-wider mb-1">Entregas totais</p>
          <p class="text-2xl font-bold text-primary-600">{{ totalDeliveries }}</p>
        </div>
      </div>

      <!-- Add new integration -->
      <div v-if="isManager" class="card">
        <p class="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Plus class="w-4 h-4 text-primary-500" />
          Adicionar integração
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="t in INTEGRATION_TYPES" :key="t"
            class="flex flex-col gap-3 p-4 border-2 rounded-xl text-left transition-all"
            :class="[INTEGRATION_META[t].border, INTEGRATION_META[t].bg]"
          >
            <div class="flex items-start gap-3">
              <component :is="INTEGRATION_META[t].icon" class="w-5 h-5 flex-shrink-0 mt-0.5" :class="INTEGRATION_META[t].color" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-semibold text-sm" :class="INTEGRATION_META[t].color">{{ INTEGRATION_META[t].label }}</p>
                  <span
                    class="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                    :class="ADDON_STATUS_LABEL[addonByType.get(t)?.status ?? 'INACTIVE'].className"
                  >
                    {{ ADDON_STATUS_LABEL[addonByType.get(t)?.status ?? 'INACTIVE'].label }}
                  </span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5 leading-snug">{{ INTEGRATION_META[t].description }}</p>
                <p v-if="addonByType.get(t)" class="text-xs text-slate-400 mt-1">
                  R$ {{ ((addonByType.get(t)?.priceCents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) }}/mês
                </p>
              </div>
            </div>

            <div v-if="addonByType.get(t)?.status === 'ACTIVE'" class="flex items-center gap-2">
              <button
                class="flex-1 text-xs font-semibold py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors"
                @click="openCreate(t)"
              >
                Configurar
              </button>
              <router-link
                to="/configuracoes/equipe"
                class="text-[11px] text-slate-500 hover:text-primary-600 underline underline-offset-2"
                title="Liberar acesso a secretárias"
              >
                Gerenciar acessos
              </router-link>
            </div>
            <button
              v-else
              class="flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              :disabled="checkoutLoadingType === t"
              @click="checkout(t)"
            >
              <Lock v-if="addonByType.get(t)?.status === 'PENDING_PAYMENT'" class="w-3.5 h-3.5" />
              <ShoppingCart v-else class="w-3.5 h-3.5" />
              {{ addonByType.get(t)?.status === 'PENDING_PAYMENT' ? 'Finalizar pagamento' : 'Contratar' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Existing integrations -->
      <div v-if="visibleIntegrations.length > 0" class="space-y-3">
        <h2 class="text-sm font-semibold text-slate-700">Integrações configuradas</h2>
        <div v-for="intg in visibleIntegrations" :key="intg.id" class="card p-0 overflow-hidden">
          <div class="flex items-center gap-4 p-4">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
              :class="[INTEGRATION_META[intg.type].bg, INTEGRATION_META[intg.type].border]"
            >
              <component :is="INTEGRATION_META[intg.type].icon" class="w-5 h-5" :class="INTEGRATION_META[intg.type].color" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="font-semibold text-slate-900 text-sm">{{ intg.name }}</p>
                <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="INTEGRATION_META[intg.type].badge">
                  {{ INTEGRATION_META[intg.type].label }}
                </span>
                <span
                  class="text-xs px-2 py-0.5 rounded-full font-medium"
                  :class="intg.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'"
                >
                  {{ intg.active ? 'Ativa' : 'Inativa' }}
                </span>
              </div>
              <div class="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                <span v-if="intg.events.length > 0">{{ intg.events.length }} evento{{ intg.events.length !== 1 ? 's' : '' }}</span>
                <span v-if="intg._count && intg._count.webhookLogs > 0">{{ intg._count.webhookLogs }} entrega{{ intg._count.webhookLogs !== 1 ? 's' : '' }}</span>
                <span>{{ formatDistanceToNow(new Date(intg.createdAt), { addSuffix: true, locale: ptBR }) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <template v-if="isManager && intg.type === 'WEBHOOK'">
                <button
                  title="Ver logs"
                  class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                  @click="toggleLogsFor(intg.id)"
                >
                  <Activity class="w-4 h-4" />
                </button>
                <button
                  title="Enviar evento de teste"
                  class="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                  :disabled="testingId === intg.id"
                  @click="testIntegration(intg.id)"
                >
                  <FlaskConical class="w-4 h-4" />
                </button>
              </template>
              <template v-if="isManager">
                <button
                  title="Editar"
                  class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  @click="openEdit(intg)"
                >
                  <Zap class="w-4 h-4" />
                </button>
                <button
                  :title="intg.active ? 'Desativar' : 'Ativar'"
                  class="p-1.5 rounded-lg transition-colors"
                  :class="intg.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'"
                  :disabled="togglingId === intg.id"
                  @click="toggleIntegration(intg.id)"
                >
                  <Power class="w-4 h-4" />
                </button>
                <button
                  title="Remover"
                  class="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  @click="removeIntegration(intg.id)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </template>
            </div>
          </div>

          <div v-if="logsFor === intg.id" class="border-t border-slate-100 p-4 bg-slate-50">
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <p class="text-sm text-slate-500">Últimas 50 entregas · atualiza a cada 10s</p>
                <button class="text-xs text-primary-600 hover:underline" @click="closeLogs">Fechar</button>
              </div>

              <p v-if="logsLoading" class="text-sm text-slate-400 text-center py-4">Carregando...</p>
              <div v-else-if="logs.length === 0" class="text-center py-8 text-slate-400">
                <Activity class="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p class="text-sm">Nenhuma entrega ainda. Use o botão "Testar" para enviar um evento.</p>
              </div>
              <div v-else class="space-y-2 max-h-72 overflow-y-auto pr-1">
                <div
                  v-for="log in logs" :key="log.id"
                  class="border rounded-lg p-3 text-xs"
                  :class="log.success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                      <CheckCircle2 v-if="log.success" class="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <XCircle v-else class="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      <span class="font-mono font-semibold text-slate-700">{{ log.event }}</span>
                      <span
                        v-if="log.statusCode"
                        class="px-1.5 py-0.5 rounded font-bold"
                        :class="log.success ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'"
                      >
                        {{ log.statusCode }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 text-slate-400 flex-shrink-0">
                      <span v-if="log.duration" class="flex items-center gap-1"><Clock class="w-3 h-3" />{{ log.duration }}ms</span>
                      <span>{{ format(new Date(log.createdAt), 'dd/MM HH:mm:ss', { locale: ptBR }) }}</span>
                    </div>
                  </div>
                  <p v-if="log.error" class="mt-1 text-red-600 font-mono">{{ log.error }}</p>
                  <p v-if="log.responseBody" class="mt-1 text-slate-500 font-mono truncate">{{ log.responseBody }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Payload signature reference -->
      <div class="card bg-slate-900 text-white p-0 overflow-hidden">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Shield class="w-4 h-4 text-cyan-400" />
          <span class="text-sm font-semibold">Headers enviados em cada webhook</span>
          <button class="ml-auto text-slate-400 hover:text-white" @click="copyToken('X-ClinIQ-Signature')">
            <Copy class="w-3.5 h-3.5" />
          </button>
        </div>
        <pre class="px-4 py-3 text-xs text-emerald-400 leading-relaxed overflow-x-auto">{{ WEBHOOK_HEADERS_EXAMPLE }}</pre>
      </div>

      <!-- Tutorials -->
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Info class="w-4 h-4 text-primary-500" />
          Tutoriais de integração
        </h3>
        <div v-for="(t, i) in TUTORIALS" :key="t.title" class="border border-slate-200 rounded-xl overflow-hidden">
          <button
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
            @click="toggleTutorial(i)"
          >
            <component :is="t.icon" class="w-4 h-4 flex-shrink-0" :class="t.color" />
            <span class="flex-1 text-sm font-medium text-slate-800">{{ t.title }}</span>
            <ChevronUp v-if="openTutorial === i" class="w-4 h-4 text-slate-400" />
            <ChevronDown v-else class="w-4 h-4 text-slate-400" />
          </button>
          <div v-if="openTutorial === i" class="px-4 py-3 border-t border-slate-100 bg-slate-50">
            <ol class="space-y-2">
              <li v-for="(step, j) in t.steps" :key="j" class="flex items-start gap-2.5 text-sm text-slate-700">
                <span class="w-5 h-5 bg-primary-600 text-white rounded-full text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{{ j + 1 }}</span>
                {{ step }}
              </li>
            </ol>
          </div>
        </div>
      </div>

      <!-- External links -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <a
          v-for="link in EXTERNAL_LINKS" :key="link.url"
          :href="link.url" target="_blank" rel="noopener noreferrer"
          class="card flex items-start gap-3 p-3 hover:shadow-md transition-shadow group"
        >
          <ExternalLink class="w-4 h-4 flex-shrink-0 mt-0.5" :class="link.color" />
          <div>
            <p class="text-sm font-semibold" :class="link.color">{{ link.label }}</p>
            <p class="text-xs text-slate-400">{{ link.desc }}</p>
          </div>
        </a>
      </div>

      <!-- Create / edit modal -->
      <Modal
        :is-open="modalOpen"
        :title="modalMode === 'create' ? `Nova integração — ${INTEGRATION_META[type].label}` : `Editar — ${editingIntegration?.name}`"
        size="lg"
        @close="modalOpen = false"
      >
        <div class="space-y-5">
          <div>
            <label class="label">Nome da integração</label>
            <input
              v-model="name"
              class="input-field"
              placeholder="Ex: Webhook n8n Agenda, WhatsApp Confirmações..."
            />
          </div>

          <!-- Webhook form -->
          <div v-if="type === 'WEBHOOK'" class="space-y-4">
            <div>
              <label class="label">URL de destino *</label>
              <input v-model="config.url" class="input-field" placeholder="https://n8n.meuservidor.com/webhook/abc123" />
              <p class="text-xs text-slate-400 mt-1">Endpoint que receberá as requisições POST com payload JSON</p>
            </div>

            <div>
              <label class="label">Secret (opcional)</label>
              <input v-model="config.secret" class="input-field font-mono" placeholder="minha-chave-secreta" />
              <p class="text-xs text-slate-400 mt-1">
                Se preenchido, cada requisição terá o header <code class="bg-slate-100 px-1 rounded">X-ClinIQ-Signature: sha256=...</code>
              </p>
            </div>

            <div>
              <label class="label mb-2">Eventos que disparam este webhook</label>
              <div class="space-y-2">
                <label
                  v-for="ev in WEBHOOK_EVENTS" :key="ev.value"
                  class="flex items-center gap-3 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    class="w-4 h-4 text-primary-600"
                    :checked="events.includes(ev.value)"
                    @change="toggleEvent(ev.value)"
                  />
                  <div class="flex-1">
                    <p class="text-sm text-slate-800">{{ ev.label }}</p>
                    <p class="text-xs text-slate-400 font-mono">{{ ev.value }}</p>
                  </div>
                </label>
              </div>
              <p v-if="events.length === 0" class="text-xs text-amber-600 mt-2">Selecione ao menos um evento</p>
            </div>

            <details class="border border-slate-200 rounded-xl overflow-hidden">
              <summary class="px-4 py-3 bg-slate-50 cursor-pointer text-sm font-medium text-slate-700 select-none">
                Exemplo de payload recebido
              </summary>
              <pre class="px-4 py-3 bg-slate-900 text-emerald-400 text-xs overflow-x-auto leading-relaxed">{{ WEBHOOK_PAYLOAD_EXAMPLE }}</pre>
            </details>
          </div>

          <!-- Google Calendar form -->
          <div v-else-if="type === 'GOOGLE_CALENDAR'" class="space-y-4">
            <div class="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-800">
              <p class="font-semibold mb-1 flex items-center gap-1.5"><Info class="w-4 h-4" />Como configurar</p>
              <ol class="list-decimal list-inside space-y-1 text-primary-700 text-xs mt-2">
                <li>Acesse <strong>console.cloud.google.com</strong> e crie um projeto</li>
                <li>Ative a <strong>Google Calendar API</strong></li>
                <li>Crie credenciais OAuth 2.0 (tipo: aplicação web)</li>
                <li>Cole o Client ID e Client Secret abaixo</li>
                <li>Use <strong>Make.com ou n8n</strong> para automatizar sem OAuth se preferir</li>
              </ol>
            </div>
            <div>
              <label class="label">Calendar ID</label>
              <input v-model="config.calendarId" class="input-field" placeholder="seuemail@gmail.com ou ID da agenda" />
            </div>
            <div>
              <label class="label">OAuth Client ID</label>
              <input v-model="config.clientId" class="input-field font-mono text-xs" placeholder="xxxx.apps.googleusercontent.com" />
            </div>
            <div>
              <label class="label">OAuth Client Secret</label>
              <input v-model="config.clientSecret" type="password" class="input-field font-mono text-xs" placeholder="GOCSPX-..." />
            </div>
            <div>
              <label class="label">Refresh Token</label>
              <input v-model="config.refreshToken" type="password" class="input-field font-mono text-xs" placeholder="Token de atualização OAuth" />
              <p class="text-xs text-slate-400 mt-1">Obtenha em: OAuth Playground ou via fluxo de autorização</p>
            </div>
            <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <strong>Dica rápida:</strong> Use o <strong>n8n</strong> ou <strong>Make.com</strong> com um webhook do ClinIQ Pro para integrar ao Google Calendar sem precisar de OAuth — muito mais simples para começar.
            </div>
          </div>

          <!-- Gmail form -->
          <div v-else-if="type === 'GOOGLE_GMAIL'" class="space-y-4">
            <div class="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-800">
              <p class="font-semibold mb-1 flex items-center gap-1.5"><Info class="w-4 h-4" />Opções de configuração</p>
              <ul class="list-disc list-inside text-xs text-primary-700 space-y-1 mt-2">
                <li><strong>Gmail SMTP:</strong> crie uma senha de app em myaccount.google.com/apppasswords</li>
                <li><strong>Outro SMTP:</strong> qualquer servidor (Mailgun, SendGrid, etc.)</li>
              </ul>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label">Servidor SMTP</label>
                <input v-model="config.host" class="input-field" placeholder="smtp.gmail.com" />
              </div>
              <div>
                <label class="label">Porta</label>
                <input v-model="config.port" type="number" class="input-field" placeholder="587" />
              </div>
            </div>
            <div>
              <label class="label">Email remetente</label>
              <input v-model="config.from" class="input-field" placeholder="seuemail@gmail.com" />
            </div>
            <div>
              <label class="label">Usuário</label>
              <input v-model="config.user" class="input-field" placeholder="seuemail@gmail.com" />
            </div>
            <div>
              <label class="label">Senha / App Password</label>
              <input v-model="config.password" type="password" class="input-field" placeholder="Senha de app (não a senha da conta)" />
            </div>
          </div>

          <!-- WhatsApp form -->
          <div v-else-if="type === 'WHATSAPP'" class="space-y-4">
            <div class="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
              <p class="font-semibold mb-1 flex items-center gap-1.5"><Info class="w-4 h-4" />Evolution API</p>
              <p class="text-xs text-green-700 mt-1">
                A <strong>Evolution API</strong> é uma API não-oficial de WhatsApp Business compatível com Baileys.
                Hospede em seu servidor ou use um serviço gerenciado.
                <a href="https://doc.evolution-api.com" target="_blank" rel="noopener" class="underline">Ver documentação</a>
              </p>
            </div>
            <div>
              <label class="label">URL da Evolution API</label>
              <input v-model="config.apiUrl" class="input-field" placeholder="https://evolution.meuservidor.com" />
            </div>
            <div>
              <label class="label">API Key</label>
              <input v-model="config.apiKey" type="password" class="input-field font-mono" placeholder="sua-api-key" />
            </div>
            <div>
              <label class="label">Nome da Instância</label>
              <input v-model="config.instance" class="input-field" placeholder="clinica" />
            </div>
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
              <strong>Dica:</strong> Para usar a API oficial do WhatsApp Business (Meta), crie uma conta em <strong>business.whatsapp.com</strong> e use o webhook do ClinIQ Pro + n8n para enviar mensagens.
            </div>
          </div>

          <!-- AI agent form -->
          <div v-else-if="type === 'AI_AGENT'" class="space-y-4">
            <div>
              <label class="label">Tipo de agente</label>
              <select v-model="aiProvider" class="input-field">
                <option value="webhook">Webhook personalizado (n8n, Make, Flowise...)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>

            <template v-if="aiProvider === 'openai' || aiProvider === 'gemini'">
              <div>
                <label class="label">API Key</label>
                <input
                  v-model="config.apiKey"
                  type="password"
                  class="input-field font-mono text-xs"
                  :placeholder="aiProvider === 'openai' ? 'sk-...' : 'AIza...'"
                />
              </div>
              <div v-if="aiProvider === 'openai'">
                <label class="label">Modelo</label>
                <select v-model="aiModel" class="input-field">
                  <option value="gpt-4o-mini">GPT-4o Mini (econômico)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>
              </div>
              <div>
                <label class="label">Prompt do sistema</label>
                <textarea
                  v-model="config.systemPrompt"
                  class="input-field resize-none text-sm"
                  rows="4"
                  placeholder="Você é um assistente de uma clínica médica. Responda de forma educada e profissional..."
                />
              </div>
            </template>

            <div v-if="!aiProvider || aiProvider === 'webhook'">
              <label class="label">URL do webhook do agente</label>
              <input v-model="config.url" class="input-field" placeholder="https://flowise.meuservidor.com/api/v1/prediction/..." />
              <p class="text-xs text-slate-400 mt-1">O ClinIQ Pro enviará eventos para esta URL e aguardará resposta do agente</p>
            </div>

            <div class="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-800">
              <strong>Ferramentas recomendadas:</strong> Flowise, n8n, Botpress, ou Dify — todas suportam webhook e podem ser conectadas ao ClinIQ Pro sem código.
            </div>
          </div>

          <div class="flex gap-3 pt-2 justify-end">
            <button class="px-4 py-2 text-sm text-slate-500 hover:text-slate-700" @click="modalOpen = false">
              Cancelar
            </button>
            <button class="btn-primary" :disabled="saving" @click="handleSave">
              {{ saving ? 'Salvando...' : modalMode === 'create' ? 'Criar integração' : 'Salvar alterações' }}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  </SecretaryGate>
</template>
