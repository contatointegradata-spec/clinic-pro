<script setup lang="ts">
import { ref, computed } from 'vue'
import { MessageCircle, Calendar, HeartHandshake, Wallet, AlertTriangle, CheckCircle2, ChevronDown, RotateCcw, Bell } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'

interface AutomationItem {
  event: string
  group: 'agenda' | 'relacionamento' | 'financeiro'
  label: string
  when: string
  variables: string[]
  defaultContent: string
  enabled: boolean
  content: string
  sent30d: number
  failed30d: number
}
interface Connection { state: 'CONNECTED' | 'DISCONNECTED' | 'NOT_BOUND' | 'NO_WHATSAPP'; roomName: string | null; phone: string | null }

const GROUPS = [
  { key: 'agenda', label: 'Agenda', hint: 'Menos faltas e menos tempo confirmando horários', icon: Calendar },
  { key: 'relacionamento', label: 'Relacionamento', hint: 'Pacientes que voltam: retornos, aniversários e reativação', icon: HeartHandshake },
  { key: 'financeiro', label: 'Financeiro', hint: 'Cobrança gentil de valores em aberto', icon: Wallet },
] as const

// Valores de exemplo só para a pré-visualização.
const SAMPLE: Record<string, string> = {
  '{nome}': 'Mariana', '{data}': '15/10/2026', '{hora}': '14:30', '{tipo_atendimento}': 'Toxina botulínica',
  '{medico}': 'Dra. Ana Souza', '{especialidade}': 'Harmonização orofacial', '{clinica}': 'Sala 1',
  '{endereco}': 'Rua das Flores, 120', '{telefone_clinica}': '(11) 99999-0000', '{valor}': '350,00', '{link}': 'https://…',
}

const items = ref<AutomationItem[]>([])
const connection = ref<Connection | null>(null)
const canEdit = ref(false)
const loading = ref(true)
const openEvent = ref<string | null>(null)
const drafts = ref<Record<string, string>>({})
const saving = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ items: AutomationItem[]; connection: Connection; canEdit: boolean }>('/automations')
    items.value = data.items
    connection.value = data.connection
    canEdit.value = data.canEdit
    drafts.value = Object.fromEntries(data.items.map(i => [i.event, i.content]))
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível carregar as mensagens automáticas')
  } finally {
    loading.value = false
  }
}
load()

const enabledCount = computed(() => items.value.filter(i => i.enabled).length)

function preview(text: string) {
  return text.replace(/\{[a-z_]+\}/g, m => SAMPLE[m] ?? m)
}

async function save(item: AutomationItem, enabled: boolean) {
  const content = drafts.value[item.event] ?? item.content
  saving.value = item.event
  try {
    const { data } = await api.put<{ enabled: boolean; content: string; connection: Connection }>(`/automations/${item.event}`, { enabled, content })
    item.enabled = data.enabled
    item.content = data.content
    connection.value = data.connection
    toast.success(enabled ? `"${item.label}" ativada` : `"${item.label}" desativada`)
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar')
  } finally {
    saving.value = null
  }
}

function insertVar(item: AutomationItem, v: string) {
  drafts.value[item.event] = `${drafts.value[item.event] ?? ''}${v}`
}

const CONNECTION_COPY: Record<Connection['state'], { title: string; text: string; tone: string }> = {
  CONNECTED: { title: 'WhatsApp conectado', text: 'As mensagens saem pelo número da sala abaixo.', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  DISCONNECTED: { title: 'WhatsApp desconectado', text: 'Nenhuma mensagem automática será enviada até você reconectar o QR code da sala.', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  NOT_BOUND: { title: 'Escolha o número de envio', text: 'Você tem mais de um WhatsApp conectado. Escolha qual sala envia as mensagens em Agente de IA.', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  NO_WHATSAPP: { title: 'Conecte o WhatsApp da clínica', text: 'As mensagens automáticas usam o WhatsApp de uma sala. Conecte em Configurações › Clínica.', tone: 'border-amber-200 bg-amber-50 text-amber-800' },
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div>
      <h1 class="page-title">Mensagens automáticas</h1>
      <p class="page-subtitle">Lembretes, retornos e relacionamento com as pacientes pelo WhatsApp — escolha o que enviar e com quais palavras.</p>
    </div>

    <!-- Estado do WhatsApp -->
    <div v-if="connection" :class="['rounded-2xl border px-4 py-3 flex items-start gap-3', CONNECTION_COPY[connection.state].tone]">
      <CheckCircle2 v-if="connection.state === 'CONNECTED'" class="w-5 h-5 flex-shrink-0 mt-0.5" />
      <AlertTriangle v-else class="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div class="text-sm flex-1">
        <p class="font-semibold">{{ CONNECTION_COPY[connection.state].title }}</p>
        <p class="opacity-90">
          {{ CONNECTION_COPY[connection.state].text }}
          <template v-if="connection.roomName"> Sala: <strong>{{ connection.roomName }}</strong><template v-if="connection.phone"> · {{ connection.phone }}</template>.</template>
        </p>
      </div>
      <router-link
        v-if="connection.state !== 'CONNECTED'"
        :to="connection.state === 'NOT_BOUND' ? '/agente/chatbot' : '/configuracoes/salas'"
        class="btn-secondary text-xs py-1.5 flex-shrink-0"
      >{{ connection.state === 'NOT_BOUND' ? 'Escolher sala' : 'Conectar WhatsApp' }}</router-link>
    </div>

    <p v-if="!loading && !canEdit" class="text-sm text-slate-500">Somente o profissional responsável pode ativar ou editar as mensagens. Você pode consultar o que está ativo.</p>

    <div v-if="loading" class="space-y-3"><div v-for="i in 4" :key="i" class="h-16 skeleton" /></div>

    <template v-else>
      <p class="text-sm text-slate-500"><strong class="text-slate-700">{{ enabledCount }}</strong> de {{ items.length }} mensagens ativas.</p>

      <section v-for="g in GROUPS" :key="g.key" class="card p-0 overflow-hidden">
        <header class="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center"><component :is="g.icon" class="w-4 h-4 text-primary-600" /></div>
          <div>
            <h2 class="font-semibold text-slate-900">{{ g.label }}</h2>
            <p class="text-xs text-slate-500">{{ g.hint }}</p>
          </div>
        </header>

        <div v-for="item in items.filter(i => i.group === g.key)" :key="item.event" class="border-b border-slate-100 last:border-0">
          <div class="px-5 py-3.5 flex items-center gap-3">
            <button class="flex-1 min-w-0 text-left" :aria-expanded="openEvent === item.event" @click="openEvent = openEvent === item.event ? null : item.event">
              <p class="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                {{ item.label }}
                <ChevronDown :class="['w-4 h-4 text-slate-400 transition-transform', openEvent === item.event && 'rotate-180']" />
              </p>
              <p class="text-xs text-slate-500">{{ item.when }}<template v-if="item.sent30d || item.failed30d"> · {{ item.sent30d }} enviada(s) em 30 dias<template v-if="item.failed30d">, {{ item.failed30d }} com falha</template></template></p>
            </button>
            <button
              type="button" role="switch" :aria-checked="item.enabled" :aria-label="`Ativar ${item.label}`"
              :disabled="!canEdit || saving === item.event"
              class="relative inline-flex items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
              :class="item.enabled ? 'bg-primary-600' : 'bg-slate-200'"
              :style="{ width: '42px', height: '24px' }"
              @click="save(item, !item.enabled)"
            >
              <span class="block w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform" :style="{ transform: item.enabled ? 'translateX(21px)' : 'translateX(3px)' }" />
            </button>
          </div>

          <div v-if="openEvent === item.event" class="px-5 pb-5 grid md:grid-cols-2 gap-4">
            <div>
              <label class="label" :for="`msg-${item.event}`">Mensagem</label>
              <textarea :id="`msg-${item.event}`" v-model="drafts[item.event]" rows="5" class="input-field" :disabled="!canEdit" />
              <div v-if="canEdit" class="mt-2 flex flex-wrap gap-1.5">
                <button v-for="v in item.variables" :key="v" type="button" class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 hover:bg-primary-50 hover:text-primary-700" @click="insertVar(item, v)">{{ v }}</button>
              </div>
              <div v-if="canEdit" class="mt-3 flex flex-wrap gap-2">
                <button class="btn-primary text-sm py-2" :disabled="saving === item.event" @click="save(item, item.enabled)">Salvar texto</button>
                <button class="btn-secondary text-sm py-2" @click="drafts[item.event] = item.defaultContent"><RotateCcw class="w-3.5 h-3.5" /> Texto sugerido</button>
              </div>
            </div>
            <div>
              <p class="label">Como a paciente recebe</p>
              <div class="rounded-2xl bg-[#efeae2] p-3 min-h-[8rem]">
                <div class="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-slate-800 shadow-sm whitespace-pre-line">
                  {{ preview(drafts[item.event] ?? item.content) }}
                </div>
              </div>
              <p class="mt-2 text-xs text-slate-400 flex items-center gap-1"><MessageCircle class="w-3.5 h-3.5" /> Exemplo com dados fictícios.</p>
            </div>
          </div>
        </div>
      </section>

      <div class="card flex items-start gap-3 bg-slate-50">
        <Bell class="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
        <p class="text-sm text-slate-600">
          Os avisos para a equipe (novos agendamentos, cancelamentos, orçamentos aprovados, follow-ups e alertas do WhatsApp)
          chegam pelo sininho no menu, sem configuração.
        </p>
      </div>
    </template>
  </div>
</template>
