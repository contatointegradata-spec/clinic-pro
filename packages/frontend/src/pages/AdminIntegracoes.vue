<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Webhook, Copy, Eye, EyeOff, CheckCircle2,
  Clock, AlertTriangle, Save, ChevronDown, ChevronUp, Bot, Zap,
  ShieldCheck, ShieldAlert, XCircle, Link2, Circle,
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import Modal from '../components/ui/Modal.vue'
import { useQuery } from '../composables/useQuery'

interface KiwifyConfigView {
  enabled: boolean
  checkoutUrl: string | null
  productId: string | null
  accountId: string | null
  clientId: string | null
  hasClientSecret: boolean
  hasWebhookSecret: boolean
  webhookSecretPreview: string | null
  webhookUrl: string
  enforceSubscription: boolean
  enforcementForcedByEnv: boolean
  updatedAt: string | null
}

interface AiConfigView {
  provider: string
  model: string
  hasApiKey: boolean
  apiKeyPreview: string | null
  updatedAt: string | null
}

interface KiwifyEvent {
  id: string
  eventType: string
  kiwifyOrderId: string | null
  processingStatus: string
  receivedAt: string
  processedAt: string | null
  errorMessage: string | null
  attempts: number
  rawEventName: string | null
  customerEmail: string | null
  customerName: string | null
}

interface DoctorOption {
  id: string
  name: string
  email: string
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  PAYMENT_APPROVED: 'Compra aprovada',
  SUBSCRIPTION_RENEWED: 'Assinatura renovada',
  PAYMENT_LATE: 'Assinatura atrasada',
  SUBSCRIPTION_CANCELED: 'Assinatura cancelada',
  PAYMENT_REFUNDED: 'Reembolso',
  CHARGEBACK: 'Chargeback',
  PAYMENT_REFUSED: 'Compra recusada',
  PAYMENT_PENDING: 'Pix/boleto gerado',
  UNKNOWN: 'Não tratado',
}

const EVENT_STATUS_LABEL: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  PROCESSED: { label: 'Processado', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  IGNORED: { label: 'Ignorado', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  REJECTED: { label: 'Recusado', color: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
  RECEIVED: { label: 'Recebido', color: 'bg-primary-50 text-primary-700 border-primary-200', icon: Clock },
}

async function copyToClipboard(value: string, label: string) {
  await navigator.clipboard.writeText(value)
  toast.success(`${label} copiado`)
}

const showAdvanced = ref(false)
const revealedSecret = ref<string | null>(null)
const showEnforceConfirm = ref(false)
const savingEnforce = ref(false)

const form = reactive({
  enabled: false,
  webhookSecret: '',
  checkoutUrl: '',
  productId: '',
  accountId: '',
  clientId: '',
  clientSecret: '',
})

const saving = ref(false)
const revealing = ref(false)

const { data: config, isLoading, refetch: refetchConfig } = useQuery<KiwifyConfigView>({
  key: 'admin-integrations-kiwify',
  queryFn: () => api.get('/admin/integrations/kiwify').then(r => r.data),
})

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

const aiForm = reactive({ apiKey: '', model: '' })
const savingAi = ref(false)
const testingAi = ref(false)

const { data: aiConfig, refetch: refetchAiConfig } = useQuery<AiConfigView>({
  key: 'admin-integrations-ai',
  queryFn: () => api.get('/admin/integrations/ai').then(r => r.data),
})

watch(aiConfig, (c) => {
  if (!c) return
  aiForm.apiKey = ''
  aiForm.model = c.model || DEFAULT_GEMINI_MODEL
}, { immediate: true })

async function handleSaveAi() {
  savingAi.value = true
  try {
    await api.put('/admin/integrations/ai', {
      model: aiForm.model || null,
      ...(aiForm.apiKey ? { apiKey: aiForm.apiKey } : {}),
    })
    toast.success('Configuração do Agente de IA salva')
    aiForm.apiKey = ''
    await refetchAiConfig()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Não foi possível salvar')
  } finally {
    savingAi.value = false
  }
}

async function handleTestAi() {
  testingAi.value = true
  try {
    // Salva o que estiver no formulário antes de testar — senão o teste
    // valida a config antiga do banco, não o que a pessoa acabou de digitar.
    await api.put('/admin/integrations/ai', {
      model: aiForm.model || null,
      ...(aiForm.apiKey ? { apiKey: aiForm.apiKey } : {}),
    })
    aiForm.apiKey = ''
    await refetchAiConfig()

    const { data } = await api.post<{ success: boolean; message: string }>('/admin/integrations/ai/test')
    if (data.success) toast.success(data.message)
    else toast.error(data.message)
  } catch {
    toast.error('Não foi possível testar a conexão')
  } finally {
    testingAi.value = false
  }
}

const { data: eventsData, refetch: refetchEvents } = useQuery<KiwifyEvent[]>({
  key: 'admin-integrations-kiwify-events',
  queryFn: () => api.get('/admin/integrations/kiwify/events', { params: { take: 20 } }).then(r => r.data),
})

// Mirrors original refetchInterval: 30000 — poll events every 30s
const eventsPollTimer = setInterval(() => { refetchEvents() }, 30000)
onBeforeUnmount(() => clearInterval(eventsPollTimer))

watch(config, (c) => {
  if (!c) return
  form.enabled = c.enabled
  form.checkoutUrl = c.checkoutUrl ?? ''
  form.productId = c.productId ?? ''
  form.accountId = c.accountId ?? ''
  form.clientId = c.clientId ?? ''
  form.clientSecret = ''
  form.webhookSecret = ''
}, { immediate: true })

// Checklist do que falta pra integração funcionar de ponta a ponta.
const setupSteps = computed(() => {
  const c = config.value
  const events = eventsData.value ?? []
  return [
    { done: !!c?.checkoutUrl, label: 'URL de checkout da Kiwify salva' },
    { done: !!c?.hasWebhookSecret, label: 'Token do webhook (copiado da Kiwify) salvo' },
    { done: !!c?.enabled, label: 'Integração ativa' },
    { done: events.some(e => e.processingStatus !== 'REJECTED'), label: 'Primeiro webhook recebido com assinatura válida (use "Testar Webhook" na Kiwify)' },
    { done: !!c?.enforceSubscription, label: 'Bloqueio por assinatura ligado (último passo)' },
  ]
})

async function handleSave() {
  saving.value = true
  try {
    await api.put('/admin/integrations/kiwify', {
      enabled: form.enabled,
      checkoutUrl: form.checkoutUrl || null,
      productId: form.productId || null,
      accountId: form.accountId || null,
      clientId: form.clientId || null,
      ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
      ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret.trim() } : {}),
    })
    toast.success('Configuração salva')
    form.clientSecret = ''
    form.webhookSecret = ''
    revealedSecret.value = null
    await refetchConfig()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

async function setEnforcement(value: boolean) {
  savingEnforce.value = true
  try {
    await api.put('/admin/integrations/kiwify', { enforceSubscription: value })
    toast.success(value ? 'Bloqueio por assinatura ligado' : 'Bloqueio por assinatura desligado')
    showEnforceConfirm.value = false
    await refetchConfig()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Não foi possível alterar o bloqueio')
  } finally {
    savingEnforce.value = false
  }
}

// Vínculo manual de pagamento sem médico identificado.
const assignTarget = ref<KiwifyEvent | null>(null)
const assignDoctorId = ref('')
const assignSearch = ref('')
const assigning = ref(false)
const doctorOptions = ref<DoctorOption[]>([])

async function openAssign(ev: KiwifyEvent) {
  assignTarget.value = ev
  assignDoctorId.value = ''
  assignSearch.value = ev.customerEmail ?? ''
  if (doctorOptions.value.length === 0) {
    try {
      const { data } = await api.get<{ doctors: DoctorOption[] }>('/admin/subscriptions')
      doctorOptions.value = data.doctors.map(d => ({ id: d.id, name: d.name, email: d.email }))
    } catch {
      toast.error('Não foi possível carregar os médicos')
    }
  }
}

const filteredDoctorOptions = computed(() => {
  const term = assignSearch.value.trim().toLowerCase()
  if (!term) return doctorOptions.value
  return doctorOptions.value.filter(d => d.name.toLowerCase().includes(term) || d.email.toLowerCase().includes(term))
})

async function confirmAssign() {
  if (!assignTarget.value || !assignDoctorId.value) return
  assigning.value = true
  try {
    await api.post(`/admin/integrations/kiwify/events/${assignTarget.value.id}/assign`, { doctorId: assignDoctorId.value })
    toast.success('Pagamento vinculado e processado')
    assignTarget.value = null
    await refetchEvents()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Não foi possível vincular o pagamento')
  } finally {
    assigning.value = false
  }
}

function canAssign(ev: KiwifyEvent): boolean {
  return ev.processingStatus === 'IGNORED' && !!ev.kiwifyOrderId && ev.eventType !== 'UNKNOWN'
}

async function handleReveal() {
  revealing.value = true
  try {
    const { data } = await api.get<{ webhookSecret: string }>('/admin/integrations/kiwify/webhook-secret')
    revealedSecret.value = data.webhookSecret
  } catch {
    toast.error('Não foi possível revelar o token')
  } finally {
    revealing.value = false
  }
}

function toggleReveal() {
  if (revealedSecret.value) {
    revealedSecret.value = null
  } else {
    handleReveal()
  }
}

function eventStatusInfo(status: string) {
  return EVENT_STATUS_LABEL[status] ?? EVENT_STATUS_LABEL.RECEIVED
}
</script>

<template>
  <div v-if="isLoading || !config" class="py-12 text-center text-slate-400">Carregando...</div>
  <div v-else class="space-y-4 animate-fade-in">
    <div>
      <h1 class="page-title">Integrações</h1>
      <p class="page-subtitle">
        Configure o motor de IA do Agente de IA e o webhook que a Kiwify usa para avisar a Clinic Pro sobre
        pagamentos, renovações e cancelamentos (libera automaticamente o acesso de cada médico/especialista
        após o pagamento e bloqueia quando o teste grátis acaba sem pagamento).
      </p>
    </div>

    <!-- Agente de IA (Gemini) -->
    <div class="card p-4 space-y-4">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center" :class="aiConfig?.hasApiKey ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'">
          <Bot class="w-4.5 h-4.5" />
        </div>
        <div>
          <p class="text-sm font-medium text-slate-900">Agente de IA (Gemini) {{ aiConfig?.hasApiKey ? 'configurado' : 'sem chave configurada' }}</p>
          <p class="text-xs text-slate-400">
            Usado pra gerar o prompt personalizado e responder pacientes pelo WhatsApp.
            <template v-if="aiConfig?.updatedAt"> · atualizado {{ format(new Date(aiConfig.updatedAt), "d MMM yyyy 'às' HH:mm", { locale: ptBR }) }}</template>
          </p>
        </div>
      </div>

      <div class="bg-primary-50 border border-primary-200 rounded-xl p-3 text-xs text-primary-800">
        Gere a chave em <strong>aistudio.google.com/apikey</strong> (Google AI Studio) — não é a mesma coisa
        que uma conta ou sessão do app Gemini (gemini.google.com). A chave da API Studio começa com "AIza".
      </div>

      <div>
        <label class="label">
          Chave de API (Google AI Studio / Gemini)
          <span v-if="aiConfig?.hasApiKey" class="text-slate-400">(já configurada — deixe em branco pra manter: {{ aiConfig.apiKeyPreview }})</span>
        </label>
        <input v-model="aiForm.apiKey" type="password" class="input-field w-full" placeholder="Cole a chave aqui" autocomplete="off" />
      </div>

      <div>
        <label class="label">Modelo</label>
        <input v-model="aiForm.model" class="input-field w-full" :placeholder="DEFAULT_GEMINI_MODEL" />
        <p class="text-xs text-slate-400 mt-1">Padrão: {{ DEFAULT_GEMINI_MODEL }}. Só altere se souber o nome exato de outro modelo da Gemini.</p>
      </div>

      <div class="flex justify-end gap-2">
        <button class="btn-secondary flex items-center gap-1.5" :disabled="testingAi" @click="handleTestAi">
          <Zap class="w-4 h-4" />
          {{ testingAi ? 'Testando...' : 'Testar conexão' }}
        </button>
        <button class="btn-primary flex items-center gap-1.5" :disabled="savingAi" @click="handleSaveAi">
          <Save class="w-4 h-4" />
          Salvar configuração da IA
        </button>
      </div>
    </div>

    <!-- Kiwify: passo a passo -->
    <div class="card p-4 space-y-3">
      <p class="text-sm font-medium text-slate-900">Assinaturas via Kiwify — passo a passo</p>
      <ol class="text-xs text-slate-500 space-y-1.5 list-decimal pl-4">
        <li>Na Kiwify, em <strong>Apps › Webhooks</strong>, edite (ou crie) o webhook do produto Clinic Pro e cole em <strong>URL do Webhook</strong> o endpoint abaixo — não o link de pagamento.</li>
        <li>Em <strong>Eventos</strong>, clique em <strong>Selecionar todos</strong> e salve.</li>
        <li>Copie o <strong>Token</strong> que a Kiwify mostra nesse webhook e cole no campo "Token do webhook" abaixo.</li>
        <li>Cole a URL de checkout (link do tipo <em>Checkout</em> em Produto › Links, ex.: pay.kiwify.com.br/…), marque "Integração ativa" e salve.</li>
        <li>Volte na Kiwify e clique em <strong>Testar Webhook</strong> — o evento deve aparecer em "Últimos webhooks recebidos" (Ignorado = chegou certo, só não era de um médico real; Recusado = token errado).</li>
        <li>Faça uma compra real de teste com o e-mail de um médico de teste e confira a liberação em Admin › Planos. Só então ligue o bloqueio.</li>
      </ol>
      <div class="flex flex-col gap-1.5 pt-1">
        <div v-for="step in setupSteps" :key="step.label" class="flex items-center gap-2 text-xs" :class="step.done ? 'text-emerald-700' : 'text-slate-400'">
          <CheckCircle2 v-if="step.done" class="w-3.5 h-3.5 flex-shrink-0" />
          <Circle v-else class="w-3.5 h-3.5 flex-shrink-0" />
          {{ step.label }}
        </div>
      </div>
    </div>

    <!-- Status -->
    <div class="card p-4 flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-3">
        <div
          class="w-9 h-9 rounded-xl flex items-center justify-center"
          :class="config.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'"
        >
          <Webhook class="w-4.5 h-4.5" />
        </div>
        <div>
          <p class="text-sm font-medium text-slate-900">Integração Kiwify {{ config.enabled ? 'ativa' : 'inativa' }}</p>
          <p class="text-xs text-slate-400">
            {{ config.hasWebhookSecret ? 'Token do webhook configurado' : 'Token do webhook ainda não configurado — webhooks serão recusados' }}
            <template v-if="config.updatedAt"> · atualizado {{ format(new Date(config.updatedAt), "d MMM yyyy 'às' HH:mm", { locale: ptBR }) }}</template>
          </p>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
        <input v-model="form.enabled" type="checkbox" />
        Integração ativa <span class="text-xs text-slate-400">(salve abaixo)</span>
      </label>
    </div>

    <!-- Endpoint + token -->
    <div class="card p-4 space-y-4">
      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Endpoint do webhook</p>
        <p class="text-xs text-slate-400 mb-2">Cole esta URL no campo "URL do Webhook" da Kiwify (Apps › Webhooks).</p>
        <div class="flex items-center gap-2">
          <input readonly :value="config.webhookUrl" class="input-field w-full font-mono text-xs bg-slate-50" />
          <button class="btn-icon flex-shrink-0" title="Copiar endpoint" @click="copyToClipboard(config.webhookUrl, 'Endpoint')">
            <Copy class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Token do webhook</p>
        <p class="text-xs text-slate-400 mb-2">
          A Kiwify gera esse token sozinha (campo "Token" no webhook, não editável lá). Copie de lá e cole aqui —
          é com ele que a Clinic Pro confere que cada aviso de pagamento veio mesmo da Kiwify.
        </p>
        <div v-if="config.hasWebhookSecret" class="flex items-center gap-2 mb-2">
          <input
            readonly
            :value="revealedSecret ?? config.webhookSecretPreview ?? ''"
            class="input-field w-full font-mono text-xs bg-slate-50"
          />
          <button
            class="btn-icon flex-shrink-0"
            :title="revealedSecret ? 'Ocultar' : 'Revelar'"
            :disabled="revealing"
            @click="toggleReveal"
          >
            <EyeOff v-if="revealedSecret" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <input
          v-model="form.webhookSecret"
          class="input-field w-full font-mono text-xs"
          :placeholder="config.hasWebhookSecret ? 'Cole um novo token só se ele mudou na Kiwify' : 'Cole aqui o token do webhook da Kiwify'"
          autocomplete="off"
        />
      </div>
    </div>

    <!-- Produto / checkout -->
    <div class="card p-4 space-y-4">
      <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Produto e checkout</p>

      <div>
        <label class="label">URL de checkout da Kiwify</label>
        <input v-model="form.checkoutUrl" placeholder="https://pay.kiwify.com.br/xxxxxxx" class="input-field w-full" />
        <p class="text-xs text-slate-400 mt-1">
          Use o link de checkout direto (pay.kiwify.com.br), não o link da página do produto — só o de checkout aceita os parâmetros de rastreamento que identificam o médico.
        </p>
      </div>

      <div>
        <label class="label">ID do produto (opcional)</label>
        <input
          v-model="form.productId"
          placeholder="Deixe em branco para aceitar pagamentos de qualquer produto da conta"
          class="input-field w-full"
        />
      </div>

      <button class="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700" @click="showAdvanced = !showAdvanced">
        <ChevronUp v-if="showAdvanced" class="w-3.5 h-3.5" />
        <ChevronDown v-else class="w-3.5 h-3.5" />
        Configuração avançada (reconciliação via API Kiwify)
      </button>

      <div v-if="showAdvanced" class="space-y-3 pl-1 border-l-2 border-slate-100">
        <div class="pl-3">
          <label class="label">Account ID</label>
          <input v-model="form.accountId" class="input-field w-full" />
        </div>
        <div class="pl-3">
          <label class="label">Client ID</label>
          <input v-model="form.clientId" class="input-field w-full" />
        </div>
        <div class="pl-3">
          <label class="label">
            Client Secret
            <span v-if="config.hasClientSecret" class="text-slate-400">(já configurado — deixe em branco para manter)</span>
          </label>
          <input v-model="form.clientSecret" type="password" class="input-field w-full" />
        </div>
      </div>

      <div class="flex justify-end pt-1">
        <button class="btn-primary flex items-center gap-1.5" :disabled="saving" @click="handleSave">
          <Save class="w-4 h-4" />
          Salvar configuração
        </button>
      </div>
    </div>

    <!-- Bloqueio por assinatura -->
    <div
      :class="['card p-4 flex items-center justify-between flex-wrap gap-3 border', config.enforceSubscription ? 'border-emerald-200' : 'border-amber-200']"
    >
      <div class="flex items-start gap-3">
        <div :class="['w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', config.enforceSubscription ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600']">
          <ShieldCheck v-if="config.enforceSubscription" class="w-4.5 h-4.5" />
          <ShieldAlert v-else class="w-4.5 h-4.5" />
        </div>
        <div>
          <p class="text-sm font-medium text-slate-900">Bloqueio por assinatura {{ config.enforceSubscription ? 'ligado' : 'desligado' }}</p>
          <p class="text-xs text-slate-400 max-w-xl">
            <template v-if="config.enforceSubscription">Quem não está no teste grátis nem tem pagamento confirmado não consegue usar o sistema até assinar.</template>
            <template v-else>Ninguém é bloqueado ainda — pagamentos e testes são registrados normalmente. Ligue depois de validar a Kiwify.</template>
            <template v-if="config.enforcementForcedByEnv"> (forçado por SUBSCRIPTION_ENFORCEMENT_ENABLED no servidor)</template>
          </p>
        </div>
      </div>
      <button
        v-if="!config.enforcementForcedByEnv"
        :class="config.enforceSubscription ? 'btn-secondary' : 'btn-primary'"
        :disabled="savingEnforce"
        @click="config.enforceSubscription ? setEnforcement(false) : (showEnforceConfirm = true)"
      >
        {{ config.enforceSubscription ? 'Desligar bloqueio' : 'Ligar bloqueio' }}
      </button>
    </div>

    <!-- Eventos recentes -->
    <div class="card p-0 overflow-hidden table-responsive">
      <div class="px-4 py-3 border-b border-slate-100">
        <p class="text-sm font-medium text-slate-900">Últimos webhooks recebidos</p>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left">
            <th class="table-head-cell">Evento</th>
            <th class="table-head-cell">Comprador</th>
            <th class="table-head-cell">Pedido</th>
            <th class="table-head-cell">Status</th>
            <th class="table-head-cell">Recebido</th>
            <th class="table-head-cell">Detalhe</th>
            <th class="table-head-cell"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="(eventsData ?? []).length === 0">
            <td colspan="7" class="px-4 py-8 text-center text-slate-400">Nenhum webhook recebido ainda</td>
          </tr>
          <tr v-for="ev in eventsData ?? []" :key="ev.id" class="table-row">
            <td class="table-cell">
              <p class="font-medium text-slate-900">{{ EVENT_TYPE_LABEL[ev.eventType] ?? ev.eventType }}</p>
              <p v-if="ev.rawEventName" class="text-[11px] text-slate-400 font-mono">{{ ev.rawEventName }}</p>
            </td>
            <td class="table-cell text-xs">
              <p class="text-slate-700">{{ ev.customerName ?? '—' }}</p>
              <p class="text-slate-400">{{ ev.customerEmail ?? '' }}</p>
            </td>
            <td class="table-cell text-slate-500 text-xs font-mono">{{ ev.kiwifyOrderId ?? '—' }}</td>
            <td class="table-cell">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
                :class="eventStatusInfo(ev.processingStatus).color"
              >
                <component :is="eventStatusInfo(ev.processingStatus).icon" class="w-3 h-3" />
                {{ eventStatusInfo(ev.processingStatus).label }}
              </span>
            </td>
            <td class="table-cell text-slate-500 text-xs">{{ format(new Date(ev.receivedAt), 'd MMM yyyy HH:mm', { locale: ptBR }) }}</td>
            <td class="table-cell text-slate-400 text-xs max-w-[240px] truncate" :title="ev.errorMessage ?? ''">{{ ev.errorMessage ?? '—' }}</td>
            <td class="table-cell text-right">
              <button
                v-if="canAssign(ev)"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                title="Vincular este pagamento a um médico"
                @click="openAssign(ev)"
              >
                <Link2 class="w-3.5 h-3.5" />
                Vincular
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :is-open="showEnforceConfirm"
      title="Ligar o bloqueio por assinatura"
      subtitle="A partir daqui, médicos sem teste grátis vigente e sem pagamento confirmado (e as equipes deles) ficam sem acesso às telas operacionais até assinar."
      @close="showEnforceConfirm = false"
    >
      <div class="space-y-2 text-sm text-slate-600">
        <p>Antes de ligar, confira:</p>
        <ul class="list-disc pl-5 space-y-1 text-xs">
          <li>Um webhook de teste da Kiwify apareceu abaixo sem ser "Recusado".</li>
          <li>Uma compra de teste liberou o acesso do médico em Admin › Planos.</li>
          <li>Quem já usava o sistema recebeu teste grátis ou cortesia (Admin › Planos › "Teste grátis para quem está sem acesso").</li>
        </ul>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="showEnforceConfirm = false">Cancelar</button>
          <button class="btn-primary" :disabled="savingEnforce" @click="setEnforcement(true)">Ligar bloqueio</button>
        </div>
      </template>
    </Modal>

    <Modal
      :is-open="!!assignTarget"
      title="Vincular pagamento a um médico"
      :subtitle="`Pedido ${assignTarget?.kiwifyOrderId ?? ''} — ${assignTarget?.customerName ?? ''} ${assignTarget?.customerEmail ? '(' + assignTarget.customerEmail + ')' : ''}. O evento é processado como se tivesse chegado identificado.`"
      @close="assignTarget = null"
    >
      <div class="space-y-3">
        <input v-model="assignSearch" class="input-field w-full" placeholder="Buscar médico por nome ou e-mail" />
        <div class="max-h-64 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
          <label
            v-for="d in filteredDoctorOptions"
            :key="d.id"
            class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
          >
            <input v-model="assignDoctorId" type="radio" :value="d.id" />
            <span class="text-slate-800">{{ d.name }}</span>
            <span class="text-xs text-slate-400">{{ d.email }}</span>
          </label>
          <p v-if="filteredDoctorOptions.length === 0" class="px-3 py-4 text-center text-xs text-slate-400">Nenhum médico encontrado</p>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="assignTarget = null">Cancelar</button>
          <button class="btn-primary" :disabled="assigning || !assignDoctorId" @click="confirmAssign">Vincular e processar</button>
        </div>
      </template>
    </Modal>
  </div>
</template>
