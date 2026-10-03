<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Webhook, Copy, Eye, EyeOff, RotateCcw, CheckCircle2,
  XCircle, Clock, AlertTriangle, Save, ChevronDown, ChevronUp, Bot, Zap,
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
}

const EVENT_STATUS_LABEL: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  PROCESSED: { label: 'Processado', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  IGNORED: { label: 'Ignorado', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: AlertTriangle },
  RECEIVED: { label: 'Recebido', color: 'bg-primary-50 text-primary-700 border-primary-200', icon: Clock },
}

async function copyToClipboard(value: string, label: string) {
  await navigator.clipboard.writeText(value)
  toast.success(`${label} copiado`)
}

const showAdvanced = ref(false)
const showRegenerateConfirm = ref(false)
const revealedSecret = ref<string | null>(null)

const form = reactive({
  enabled: false,
  checkoutUrl: '',
  productId: '',
  accountId: '',
  clientId: '',
  clientSecret: '',
})

const saving = ref(false)
const regenerating = ref(false)
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
}, { immediate: true })

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
    })
    toast.success('Configuração salva')
    form.clientSecret = ''
    await refetchConfig()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

async function handleRegenerate() {
  regenerating.value = true
  try {
    const { data } = await api.post<{ webhookSecret: string }>('/admin/integrations/kiwify/webhook-secret/regenerate')
    revealedSecret.value = data.webhookSecret
    showRegenerateConfirm.value = false
    toast.success('Novo segredo gerado — copie e atualize no painel da Kiwify')
    await refetchConfig()
  } catch {
    toast.error('Não foi possível gerar o segredo')
  } finally {
    regenerating.value = false
  }
}

async function handleReveal() {
  revealing.value = true
  try {
    const { data } = await api.get<{ webhookSecret: string }>('/admin/integrations/kiwify/webhook-secret')
    revealedSecret.value = data.webhookSecret
  } catch {
    toast.error('Não foi possível revelar o segredo')
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
        após o pagamento ou os 7 dias de teste grátis).
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
          <p class="text-sm font-medium text-slate-900">Integração {{ config.enabled ? 'ativa' : 'inativa' }}</p>
          <p class="text-xs text-slate-400">
            {{ config.hasWebhookSecret ? 'Segredo do webhook configurado' : 'Segredo do webhook ainda não gerado' }}
            <template v-if="config.updatedAt"> · atualizado {{ format(new Date(config.updatedAt), "d MMM yyyy 'às' HH:mm", { locale: ptBR }) }}</template>
          </p>
        </div>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
        <input v-model="form.enabled" type="checkbox" />
        Integração ativa
      </label>
    </div>

    <!-- Endpoint + secret -->
    <div class="card p-4 space-y-4">
      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Endpoint do webhook</p>
        <p class="text-xs text-slate-400 mb-2">Cole esta URL no painel da Kiwify em Configurações do produto → Webhooks.</p>
        <div class="flex items-center gap-2">
          <input readonly :value="config.webhookUrl" class="input-field w-full font-mono text-xs bg-slate-50" />
          <button class="btn-icon flex-shrink-0" title="Copiar endpoint" @click="copyToClipboard(config.webhookUrl, 'Endpoint')">
            <Copy class="w-4 h-4" />
          </button>
        </div>
      </div>

      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Segredo do webhook</p>
        <p class="text-xs text-slate-400 mb-2">
          Cole este valor no campo de token/assinatura do webhook, no painel da Kiwify. Gerar um novo segredo invalida o anterior.
        </p>
        <div class="flex items-center gap-2">
          <input
            readonly
            :value="revealedSecret ?? config.webhookSecretPreview ?? 'Nenhum segredo gerado'"
            class="input-field w-full font-mono text-xs bg-slate-50"
          />
          <button
            v-if="config.hasWebhookSecret"
            class="btn-icon flex-shrink-0"
            :title="revealedSecret ? 'Ocultar' : 'Revelar'"
            :disabled="revealing"
            @click="toggleReveal"
          >
            <EyeOff v-if="revealedSecret" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
          <button v-if="revealedSecret" class="btn-icon flex-shrink-0" title="Copiar segredo" @click="copyToClipboard(revealedSecret, 'Segredo')">
            <Copy class="w-4 h-4" />
          </button>
          <button class="btn-icon flex-shrink-0 text-amber-600" title="Gerar novo segredo" @click="showRegenerateConfirm = true">
            <RotateCcw class="w-4 h-4" />
          </button>
        </div>
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

    <!-- Eventos recentes -->
    <div class="card p-0 overflow-hidden table-responsive">
      <div class="px-4 py-3 border-b border-slate-100">
        <p class="text-sm font-medium text-slate-900">Últimos webhooks recebidos</p>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left">
            <th class="table-head-cell">Evento</th>
            <th class="table-head-cell">Pedido</th>
            <th class="table-head-cell">Status</th>
            <th class="table-head-cell">Recebido</th>
            <th class="table-head-cell">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="(eventsData ?? []).length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-400">Nenhum webhook recebido ainda</td>
          </tr>
          <tr v-for="ev in eventsData ?? []" :key="ev.id" class="table-row">
            <td class="table-cell font-medium text-slate-900">{{ ev.eventType }}</td>
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
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :is-open="showRegenerateConfirm"
      title="Gerar novo segredo do webhook"
      subtitle="O segredo anterior deixa de funcionar imediatamente — você precisa atualizar o valor no painel da Kiwify também, ou os próximos pagamentos deixam de ser confirmados automaticamente."
      @close="showRegenerateConfirm = false"
    >
      <p class="text-sm text-slate-600">
        Confirma a geração de um novo segredo? Copie o novo valor e cole no painel da Kiwify assim que terminar.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="showRegenerateConfirm = false">Cancelar</button>
          <button class="px-4 py-2 rounded-xl text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5" :disabled="regenerating" @click="handleRegenerate">
            <XCircle class="w-4 h-4" />
            Gerar novo segredo
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>
