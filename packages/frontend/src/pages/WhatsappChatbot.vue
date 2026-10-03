<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue'
import {
  Wifi, Bot, Bell, Plus, Trash2, Sparkles, Search, MessageSquare,
  Pencil, ToggleLeft, ToggleRight, Loader2, ShieldOff, CalendarClock,
  ExternalLink,
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import PageHeader from '../components/ui/PageHeader.vue'
import Modal from '../components/ui/Modal.vue'
import WhatsAppTab from '../components/Salas/WhatsAppTab.vue'
import { useAuthStore } from '../stores/auth'
import { useQuery } from '../composables/useQuery'
import type { AiAgent, AiAgentIgnoredNumber, AiAgentMessage, Room, LightNotificationTemplate } from '../types'

const UPSELL_PHONE = '5534992142504'
const DAY_LABELS: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' }

type Panel = 'conectar' | 'agente' | 'notificacoes'
type AgentTab = 'prompt' | 'agenda' | 'pass' | 'conversas' | 'ia'

function describeSchedule(room: Room): string[] {
  const lines = room.daysOfWeek.map(d => {
    const special = room.specialHours?.[String(d)]
    const { start, end } = special ?? { start: room.startTime, end: room.endTime }
    return `${DAY_LABELS[d] ?? d}: ${start} às ${end}`
  })
  if (room.breakStart && room.breakEnd) lines.push(`Intervalo: ${room.breakStart} às ${room.breakEnd}`)
  lines.push(`Duração de cada consulta: ${room.slotDurationMinutes ?? 30} min`)
  return lines
}

const authStore = useAuthStore()

// ─── Dados globais da página ───────────────────────────────────────────────

// A secretária não configura o agente, mas precisa saber qual sala está
// vinculada a ele pra abrir a conexão certa em "Conectar" (leitura, sem
// acesso de escrita — a rota /ai-agent já permite GET pra qualquer papel
// vinculado ao médico).
const { data: agentData, isLoading: loadingAgent, refetch: refetchAgent } = useQuery<AiAgent | null>({
  key: 'ai-agent',
  queryFn: () => api.get('/ai-agent').then(r => r.data),
})
const agent = computed(() => agentData.value ?? null)

const { data: roomsData } = useQuery<Room[]>({
  key: 'rooms',
  queryFn: () => api.get('/rooms').then(r => r.data),
})
const rooms = computed(() => roomsData.value ?? [])

const MENU: { key: Panel; label: string; icon: typeof Wifi }[] = [
  { key: 'conectar', label: 'Conectar', icon: Wifi },
  { key: 'agente', label: 'Agente de IA', icon: Bot },
  { key: 'notificacoes', label: 'Notificações', icon: Bell },
]

const panel = ref<Panel>('conectar')

// Configuração do Agente de IA (prompt, agenda, número pass) é restrita a
// médico/admin — a secretária só conecta o WhatsApp e vê notificações.
const menu = computed(() => authStore.user?.role === 'SECRETARY' ? MENU.filter(m => m.key !== 'agente') : MENU)

// ─── Conectar ──────────────────────────────────────────────────────────────

const boundRoom = computed(() => rooms.value.find(r => r.id === agent.value?.boundRoomId))

// ─── Agente de IA (container) ──────────────────────────────────────────────

const AGENT_TABS: { key: AgentTab; label: string }[] = [
  { key: 'prompt', label: 'Personalizar seu Prompt' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'pass', label: 'Número Pass' },
  { key: 'conversas', label: 'Conversas' },
  { key: 'ia', label: 'Prompt de IA' },
]

const agentTab = ref<AgentTab>('prompt')

const creatingAgent = ref(false)
async function createAgent() {
  creatingAgent.value = true
  try {
    await api.post('/ai-agent', {})
    await refetchAgent()
    toast.success('Agente criado!')
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Erro ao criar agente')
  } finally {
    creatingAgent.value = false
  }
}

// ─── Personalizar seu Prompt ────────────────────────────────────────────────

interface PromptConfigForm {
  agentName: string
  companyName: string
  businessType: string
  calendarUsage: string
  agentProfession: string
  personality: string
  extraInfo: string
}

const promptForm = reactive<PromptConfigForm>({
  agentName: agent.value?.agentName ?? '',
  companyName: agent.value?.companyName ?? '',
  businessType: agent.value?.businessType ?? '',
  calendarUsage: agent.value?.calendarUsage ?? '',
  agentProfession: agent.value?.agentProfession ?? '',
  personality: agent.value?.personality ?? '',
  extraInfo: agent.value?.extraInfo ?? '',
})

function resetPromptForm() {
  promptForm.agentName = agent.value?.agentName ?? ''
  promptForm.companyName = agent.value?.companyName ?? ''
  promptForm.businessType = agent.value?.businessType ?? ''
  promptForm.calendarUsage = agent.value?.calendarUsage ?? ''
  promptForm.agentProfession = agent.value?.agentProfession ?? ''
  promptForm.personality = agent.value?.personality ?? ''
  promptForm.extraInfo = agent.value?.extraInfo ?? ''
}

const savingPromptConfig = ref(false)
async function savePromptConfig() {
  if (!agent.value) return
  savingPromptConfig.value = true
  try {
    await api.put(`/ai-agent/${agent.value.id}/prompt-config`, { ...promptForm })
    await refetchAgent()
    toast.success('Configuração salva!')
  } catch {
    toast.error('Erro ao salvar')
  } finally {
    savingPromptConfig.value = false
  }
}

const generatingPrompt = ref(false)
async function generatePrompt() {
  if (!agent.value) return
  generatingPrompt.value = true
  try {
    await api.post(`/ai-agent/${agent.value.id}/generate-prompt`)
    await refetchAgent()
    toast.success('Prompt gerado! Veja e ajuste em "Prompt de IA".')
    agentTab.value = 'ia'
    resetPromptIaFromAgent()
  } catch (e: any) {
    toast.error(e?.response?.data?.message ?? 'Erro ao gerar prompt com IA')
  } finally {
    generatingPrompt.value = false
  }
}

// ─── Agenda ────────────────────────────────────────────────────────────────

const selectedRoomId = ref(agent.value?.boundRoomId ?? '')
const agendaRoom = computed(() => rooms.value.find(r => r.id === selectedRoomId.value))

const savingAgentRoom = ref(false)
async function saveAgentRoom() {
  if (!agent.value) return
  savingAgentRoom.value = true
  try {
    await api.put(`/ai-agent/${agent.value.id}/room`, { roomId: selectedRoomId.value })
    await refetchAgent()
    toast.success('Configuração salva!')
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Erro ao salvar')
  } finally {
    savingAgentRoom.value = false
  }
}

// ─── Número Pass ───────────────────────────────────────────────────────────

const ignoredPhone = ref('')
const ignoredName = ref('')

const ignoredNumbersKey = computed(() => `ai-agent-ignored-${agent.value?.id ?? ''}`)
const { data: ignoredNumbersData, refetch: refetchIgnoredNumbers } = useQuery<AiAgentIgnoredNumber[]>({
  key: ignoredNumbersKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/ignored-numbers`).then(r => r.data),
  enabled: computed(() => !!agent.value?.id),
})
const ignoredNumbers = computed(() => ignoredNumbersData.value ?? [])

const addingIgnored = ref(false)
async function addIgnoredNumber() {
  if (!agent.value) return
  addingIgnored.value = true
  try {
    await api.post(`/ai-agent/${agent.value.id}/ignored-numbers`, {
      phone: ignoredPhone.value,
      name: ignoredName.value || undefined,
    })
    await refetchIgnoredNumbers()
    ignoredPhone.value = ''
    ignoredName.value = ''
    toast.success('Número adicionado')
  } catch {
    toast.error('Erro ao adicionar número')
  } finally {
    addingIgnored.value = false
  }
}

async function removeIgnoredNumber(id: string) {
  if (!agent.value) return
  try {
    await api.delete(`/ai-agent/${agent.value.id}/ignored-numbers/${id}`)
    await refetchIgnoredNumbers()
    toast.success('Número removido')
  } catch {
    toast.error('Erro ao remover número')
  }
}

// ─── Conversas ─────────────────────────────────────────────────────────────

interface ConversationContact { phone: string; name: string | null; lastMessage: string; lastMessageAt: string; count: number }

const conversationSearch = ref('')
const selectedPhone = ref<string | null>(null)

const conversationsKey = computed(() => `ai-agent-conversations-${agent.value?.id ?? ''}`)
const { data: contactsData, refetch: refetchContacts, isLoading: isFetchingContacts } = useQuery<ConversationContact[]>({
  key: conversationsKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/conversations`).then(r => r.data),
  enabled: computed(() => !!agent.value?.id),
})
const contacts = computed(() => contactsData.value ?? [])

const conversationKey = computed(() => `ai-agent-conversation-${agent.value?.id ?? ''}-${selectedPhone.value ?? ''}`)
const { data: messagesData } = useQuery<AiAgentMessage[]>({
  key: conversationKey,
  queryFn: () => api.get(`/ai-agent/${agent.value!.id}/conversations/${selectedPhone.value}`).then(r => r.data),
  enabled: computed(() => !!agent.value?.id && !!selectedPhone.value),
})
const messages = computed(() => messagesData.value ?? [])

const filteredContacts = computed(() => contacts.value.filter(c =>
  c.phone.includes(conversationSearch.value) ||
  (c.name?.toLowerCase().includes(conversationSearch.value.toLowerCase()) ?? false) ||
  c.lastMessage.toLowerCase().includes(conversationSearch.value.toLowerCase())
))

const selectedContact = computed(() => contacts.value.find(c => c.phone === selectedPhone.value))

// ─── Prompt de IA ──────────────────────────────────────────────────────────

const DEFAULT_PROMPT_SUGGESTION = `# [IDENTIDADE]

Eu sou o assistente virtual da **[SUA EMPRESA]**, empresa especializada em [RAMO DO NEGÓCIO]. Me chamo **[NOME DO AGENTE]** e atuo como **[PROFISSÃO DO AGENTE]** da marca.

Hoje, quem está conversando com você sou eu — não sou um robô distante, sou a pessoa que vai te receber, entender o que você precisa e te direcionar para a melhor solução. Se fizer sentido, inclusive, eu mesmo posso te atender em uma reunião online.

---

# [PERSONALIDADE]

Sou um consultor **[PERSONALIDADE]**, **[PERSONALIDADE]** e **[PERSONALIDADE]**. Tenho paciência de sobra, escuto com atenção e falo de um jeito simples — mesmo quando o assunto é tecnologia.

Minhas principais características:

- **[PERSONALIDADE]:** crio proximidade com quem está do outro lado. Ninguém é "só mais um número" pra mim.`

const systemPrompt = ref(agent.value?.systemPrompt ?? DEFAULT_PROMPT_SUGGESTION)
const responseDelay = ref(agent.value?.responseDelaySeconds ?? 0)

function resetPromptIaFromAgent() {
  systemPrompt.value = agent.value?.systemPrompt ?? DEFAULT_PROMPT_SUGGESTION
  responseDelay.value = agent.value?.responseDelaySeconds ?? 0
}

const savingSystemPrompt = ref(false)
async function saveSystemPrompt() {
  if (!agent.value) return
  savingSystemPrompt.value = true
  try {
    await api.put(`/ai-agent/${agent.value.id}/system-prompt`, {
      systemPrompt: systemPrompt.value,
      responseDelaySeconds: responseDelay.value,
    })
    await refetchAgent()
    toast.success('Prompt salvo!')
  } catch {
    toast.error('Erro ao salvar')
  } finally {
    savingSystemPrompt.value = false
  }
}

function onDelayInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value)
  responseDelay.value = Number.isNaN(v) ? 0 : v
}

// ─── Notificações ──────────────────────────────────────────────────────────

const NOTIF_VARIABLE_CHIPS = [
  { key: '{nome}', label: 'Nome' },
  { key: '{data}', label: 'Data' },
  { key: '{hora}', label: 'Hora' },
  { key: '{medico}', label: 'Médico' },
  { key: '{clinica}', label: 'Clínica' },
  { key: '{tipo_atendimento}', label: 'Tipo' },
  { key: '{status}', label: 'Status' },
  { key: '{valor}', label: 'Valor' },
  { key: '{endereco}', label: 'Endereço' },
]

const { data: templatesData, isLoading: loadingTemplates, refetch: refetchTemplates } = useQuery<LightNotificationTemplate[]>({
  key: 'light-notif-templates',
  queryFn: () => api.get('/chatbot-light/notification-templates').then(r => r.data),
})
const templates = computed(() => templatesData.value ?? [])

const notifModalOpen = ref(false)
const editingTemplate = ref<LightNotificationTemplate | null>(null)
const notifMsgRef = ref<HTMLTextAreaElement | null>(null)

const notifForm = reactive({ name: '', message: '', active: true })

function openNewNotif() {
  editingTemplate.value = null
  notifForm.name = ''
  notifForm.message = ''
  notifForm.active = true
  notifModalOpen.value = true
}

function openEditNotif(t: LightNotificationTemplate) {
  editingTemplate.value = t
  notifForm.name = t.name
  notifForm.message = t.message
  notifForm.active = t.active
  notifModalOpen.value = true
}

function insertVariable(v: string) {
  const el = notifMsgRef.value
  if (!el) {
    notifForm.message += v
    return
  }
  const start = el.selectionStart ?? notifForm.message.length
  const end = el.selectionEnd ?? notifForm.message.length
  notifForm.message = notifForm.message.slice(0, start) + v + notifForm.message.slice(end)
  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + v.length, start + v.length)
  })
}

const savingTemplate = ref(false)
async function saveNotifTemplate() {
  savingTemplate.value = true
  try {
    const payload = { name: notifForm.name, message: notifForm.message, active: notifForm.active }
    if (editingTemplate.value) {
      await api.put(`/chatbot-light/notification-templates/${editingTemplate.value.id}`, payload)
    } else {
      await api.post('/chatbot-light/notification-templates', payload)
    }
    await refetchTemplates()
    notifModalOpen.value = false
    toast.success(editingTemplate.value ? 'Notificação atualizada' : 'Notificação criada')
  } catch {
    toast.error('Erro ao salvar')
  } finally {
    savingTemplate.value = false
  }
}

async function deleteNotifTemplate(id: string) {
  if (!confirm('Remover esta notificação?')) return
  try {
    await api.delete(`/chatbot-light/notification-templates/${id}`)
    await refetchTemplates()
    toast.success('Notificação removida')
  } catch {
    toast.error('Erro ao remover notificação')
  }
}

async function toggleNotifTemplate(t: LightNotificationTemplate) {
  try {
    await api.put(`/chatbot-light/notification-templates/${t.id}`, { active: !t.active })
    await refetchTemplates()
  } catch {
    toast.error('Erro ao atualizar notificação')
  }
}

// ─── Sincronização dos formulários locais com os dados do agente ───────────
// No original (React), cada aba era um componente próprio que recebia `agent`
// via props e inicializava seu estado local (useState/useForm defaultValues)
// a cada *mount* — ou seja, toda vez que o usuário trocava de aba. Aqui,
// como as abas vivem no mesmo componente, replicamos esse comportamento:
// os campos são (re)carregados a partir do agente quando ele é carregado
// pela primeira vez, e novamente sempre que o usuário entra em cada aba.
watch(agent, (newAgent, oldAgent) => {
  if (newAgent && !oldAgent) {
    resetPromptForm()
    resetPromptIaFromAgent()
    selectedRoomId.value = newAgent.boundRoomId ?? ''
  }
}, { immediate: true })

watch(agentTab, (tab) => {
  if (tab === 'prompt') resetPromptForm()
  else if (tab === 'agenda') selectedRoomId.value = agent.value?.boundRoomId ?? ''
  else if (tab === 'ia') resetPromptIaFromAgent()
})
</script>

<template>
  <div class="space-y-4 page-stagger">
    <PageHeader title="Agente de IA" subtitle="Conexão, agente de IA e notificações" />

    <div class="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
      <nav class="card p-2 flex lg:flex-col gap-1 h-fit">
        <button
          v-for="item in menu"
          :key="item.key"
          @click="panel = item.key"
          :class="[
            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
            panel === item.key ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100',
          ]"
        >
          <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
          {{ item.label }}
        </button>
      </nav>

      <div class="card">
        <!-- ─── Conectar ─────────────────────────────────────────────── -->
        <div v-if="panel === 'conectar'">
          <div v-if="!agent" class="empty-state py-16">
            <Wifi class="w-10 h-10 text-slate-200 mb-3" />
            <p class="text-slate-500 font-medium text-sm">Crie o Agente de IA primeiro</p>
            <p class="text-slate-400 text-xs mt-1">Depois escolha a clínica/sala na aba Agenda pra conectar o WhatsApp aqui.</p>
          </div>
          <div v-else-if="!boundRoom" class="empty-state py-16">
            <Wifi class="w-10 h-10 text-slate-200 mb-3" />
            <p class="text-slate-500 font-medium text-sm">Nenhuma sala vinculada ao agente ainda</p>
            <p class="text-slate-400 text-xs mt-1">Vá em Agente de IA → Agenda e escolha a clínica/sala pra poder conectar o WhatsApp.</p>
          </div>
          <div v-else class="max-w-xl mx-auto">
            <WhatsAppTab :room="boundRoom!" />
          </div>
        </div>

        <!-- ─── Agente de IA ─────────────────────────────────────────── -->
        <div v-else-if="panel === 'agente'">
          <div v-if="loadingAgent" class="flex justify-center py-16">
            <Loader2 class="w-6 h-6 animate-spin text-primary-500" />
          </div>

          <div v-else-if="!agent" class="empty-state py-16">
            <Bot class="w-12 h-12 text-slate-200 mb-4" />
            <p class="text-slate-500 font-semibold">Você ainda não tem um Agente de IA</p>
            <p class="text-slate-400 text-sm mt-1 mb-5">Crie seu agente e personalize o atendimento automático do WhatsApp.</p>
            <button @click="createAgent" :disabled="creatingAgent" class="btn-primary">
              <Loader2 v-if="creatingAgent" class="w-4 h-4 animate-spin" />
              <template v-else><Plus class="w-4 h-4" /> Criar Agente</template>
            </button>
          </div>

          <div v-else class="space-y-4">
            <div class="flex items-center justify-between flex-wrap gap-2 bg-primary-50 border border-primary-200 rounded-xl px-4 py-2.5 text-sm text-primary-700">
              <span>Cada médico tem direito a 1 agente de IA.</span>
              <a
                :href="`https://wa.me/${UPSELL_PHONE}`"
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-1 font-semibold text-primary-800 hover:underline"
              >
                Precisa de mais um? Fale conosco <ExternalLink class="w-3.5 h-3.5" />
              </a>
            </div>

            <div class="flex flex-wrap gap-1 border-b border-slate-200">
              <button
                v-for="t in AGENT_TABS"
                :key="t.key"
                @click="agentTab = t.key"
                :class="[
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  agentTab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700',
                ]"
              >
                {{ t.label }}
              </button>
            </div>

            <div class="pt-2">
              <!-- Personalizar seu Prompt -->
              <form v-if="agentTab === 'prompt'" @submit.prevent="savePromptConfig" class="space-y-4 max-w-2xl">
                <div>
                  <label class="label">Nome do(a) Agente</label>
                  <input v-model="promptForm.agentName" class="input-field" placeholder="Ex: Kelven Silva" />
                </div>
                <div>
                  <label class="label">Nome da sua empresa</label>
                  <input v-model="promptForm.companyName" class="input-field" placeholder="Ex: Integradata" />
                </div>
                <div>
                  <label class="label">Ramo do seu negócio</label>
                  <input v-model="promptForm.businessType" class="input-field" placeholder="Ex: Desenvolvimento de Software" />
                </div>
                <div>
                  <label class="label">Uso do calendário / Agendamentos</label>
                  <textarea v-model="promptForm.calendarUsage" rows="2" class="input-field resize-none" placeholder="Descreva como o agente deve usar o calendário..." />
                </div>
                <div>
                  <label class="label">Profissão do(a) Agente</label>
                  <input v-model="promptForm.agentProfession" class="input-field" placeholder="Ex: Consultor" />
                </div>
                <div>
                  <label class="label">Personalidade e Tom</label>
                  <textarea v-model="promptForm.personality" rows="4" class="input-field resize-none" placeholder="Descreva como o agente deve se comportar e se comunicar" />
                </div>
                <div>
                  <label class="label">Complemento (informações adicionais)</label>
                  <textarea v-model="promptForm.extraInfo" rows="3" class="input-field resize-none" placeholder="Adicione informações extras que você gostaria que o agente soubesse..." />
                </div>

                <div class="flex gap-3 pt-2">
                  <button type="submit" :disabled="savingPromptConfig" class="btn-secondary flex-1">
                    <Loader2 v-if="savingPromptConfig" class="w-4 h-4 animate-spin" />
                    <template v-else>Salvar Configuração</template>
                  </button>
                  <button
                    type="button"
                    @click="generatePrompt"
                    :disabled="generatingPrompt"
                    class="btn-primary flex-1"
                  >
                    <Loader2 v-if="generatingPrompt" class="w-4 h-4 animate-spin" />
                    <template v-else><Sparkles class="w-4 h-4" /> Gerar e Ativar Prompt Personalizado</template>
                  </button>
                </div>
              </form>

              <!-- Agenda -->
              <div v-else-if="agentTab === 'agenda'">
                <div v-if="rooms.length === 0" class="empty-state py-16">
                  <CalendarClock class="w-10 h-10 text-slate-200 mb-3" />
                  <p class="text-slate-500 font-medium text-sm">Nenhuma clínica/sala cadastrada</p>
                  <p class="text-slate-400 text-xs mt-1">Cadastre em Configurações → Clínica antes de vincular ao agente.</p>
                </div>
                <div v-else class="max-w-xl space-y-5">
                  <div>
                    <label class="label">Clínica / Sala</label>
                    <select v-model="selectedRoomId" class="input-field">
                      <option value="">Selecione</option>
                      <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
                    </select>
                    <p class="text-xs text-slate-400 mt-1">O agente usa o horário de funcionamento dessa sala pra saber quando marcar consultas.</p>
                  </div>

                  <div v-if="agendaRoom" class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1">
                    <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Horário de funcionamento</p>
                    <p v-for="(line, i) in describeSchedule(agendaRoom)" :key="i" class="text-sm text-slate-700">{{ line }}</p>
                    <p class="text-xs text-slate-400 mt-2">Pra alterar o horário, edite a sala em Configurações → Clínica.</p>
                  </div>

                  <button
                    @click="saveAgentRoom"
                    :disabled="savingAgentRoom || !selectedRoomId"
                    class="btn-primary"
                  >
                    <Loader2 v-if="savingAgentRoom" class="w-4 h-4 animate-spin" />
                    <template v-else>Salvar Configuração</template>
                  </button>
                </div>
              </div>

              <!-- Número Pass -->
              <div v-else-if="agentTab === 'pass'" class="max-w-xl space-y-4">
                <div class="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-800 flex items-start gap-2">
                  <ShieldOff class="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Números nesta lista são <strong>ignorados pela IA</strong> — mensagens recebidas não terão resposta automática.</p>
                </div>

                <div class="flex gap-2">
                  <input v-model="ignoredPhone" class="input-field flex-1" placeholder="Telefone (ex: 5527999999999)" />
                  <input v-model="ignoredName" class="input-field flex-1" placeholder="Nome (opcional)" />
                  <button @click="addIgnoredNumber" :disabled="!ignoredPhone || addingIgnored" class="btn-primary whitespace-nowrap">
                    <Plus class="w-4 h-4" /> Adicionar
                  </button>
                </div>

                <div class="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                  <p v-if="ignoredNumbers.length === 0" class="text-center text-slate-400 text-sm py-8">Nenhum número na lista</p>
                  <div v-for="n in ignoredNumbers" :key="n.id" class="flex items-center justify-between px-4 py-3">
                    <div>
                      <p class="text-sm font-medium text-slate-800">{{ n.phone }}</p>
                      <p v-if="n.name" class="text-xs text-slate-400">{{ n.name }}</p>
                    </div>
                    <button @click="removeIgnoredNumber(n.id)" class="text-slate-400 hover:text-red-600">
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Conversas -->
              <div v-else-if="agentTab === 'conversas'" class="space-y-3">
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input v-model="conversationSearch" class="input-field pl-9" placeholder="Buscar por telefone ou nome..." />
                  </div>
                  <button @click="refetchContacts" class="btn-secondary whitespace-nowrap">
                    <Loader2 v-if="isFetchingContacts" class="w-4 h-4 animate-spin" />
                    <template v-else>Atualizar</template>
                  </button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4" style="height: 500px">
                  <div class="card p-0 overflow-y-auto">
                    <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 pt-4 pb-2">Contatos</p>
                    <p v-if="filteredContacts.length === 0" class="text-center text-slate-400 text-sm py-8 px-4">Nenhuma conversa encontrada</p>
                    <button
                      v-for="c in filteredContacts"
                      :key="c.phone"
                      @click="selectedPhone = c.phone"
                      :class="[
                        'w-full text-left px-4 py-3 border-t border-slate-100 hover:bg-slate-50',
                        selectedPhone === c.phone ? 'bg-primary-50' : '',
                      ]"
                    >
                      <p class="text-sm font-semibold text-slate-800">{{ c.name || c.phone }}</p>
                      <p v-if="c.name" class="text-xs text-slate-400">{{ c.phone }}</p>
                      <p class="text-xs text-slate-400 truncate">{{ c.lastMessage }}</p>
                    </button>
                  </div>

                  <div class="md:col-span-2 card p-0 flex flex-col overflow-hidden">
                    <div v-if="!selectedPhone" class="flex-1 flex flex-col items-center justify-center text-slate-400">
                      <MessageSquare class="w-8 h-8 mb-2" />
                      <p class="text-sm font-medium">Nenhuma conversa selecionada</p>
                      <p class="text-xs">Selecione um contato à esquerda para visualizar as mensagens</p>
                    </div>
                    <div v-else class="flex-1 flex flex-col overflow-hidden">
                      <div class="px-4 py-3 border-b border-slate-100 flex-shrink-0">
                        <p class="text-sm font-semibold text-slate-800">{{ selectedContact?.name || selectedPhone }}</p>
                        <p v-if="selectedContact?.name" class="text-xs text-slate-400">{{ selectedPhone }}</p>
                      </div>
                      <div class="flex-1 overflow-y-auto p-4 space-y-3">
                        <div v-for="m in messages" :key="m.id" :class="['flex', m.role === 'assistant' ? 'justify-end' : 'justify-start']">
                          <div :class="['max-w-[75%] rounded-2xl px-3 py-2 text-sm', m.role === 'assistant' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-800']">
                            {{ m.content }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Prompt de IA -->
              <div v-else-if="agentTab === 'ia'" class="max-w-2xl space-y-4">
                <div>
                  <label class="label">Prompt do sistema (personalidade do bot)</label>
                  <textarea
                    v-model="systemPrompt"
                    rows="14"
                    class="input-field resize-y font-mono text-sm"
                    placeholder="Gere o prompt na aba Personalizar seu Prompt, ou escreva/ajuste aqui manualmente..."
                  />
                </div>

                <div>
                  <label class="label flex items-center gap-1.5"><CalendarClock class="w-3.5 h-3.5 text-slate-400" /> Tempo de resposta (segundos)</label>
                  <input
                    type="number" min="0" max="60"
                    :value="responseDelay"
                    @input="onDelayInput"
                    class="input-field max-w-[160px]"
                  />
                  <p class="text-xs text-slate-400 mt-1">Simula o tempo de digitação humana. A IA aguardará este tempo antes de enviar a resposta. Recomendado: 2-5 segundos.</p>
                </div>

                <button @click="saveSystemPrompt" :disabled="savingSystemPrompt" class="btn-primary">
                  <Loader2 v-if="savingSystemPrompt" class="w-4 h-4 animate-spin" />
                  <template v-else>Salvar Prompt e Tempo de Resposta</template>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── Notificações ─────────────────────────────────────────── -->
        <div v-else-if="panel === 'notificacoes'" class="space-y-5">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold text-slate-900">Notificações</h2>
              <p class="text-sm text-slate-500 mt-0.5">Templates de mensagem enviados ao agendar uma consulta</p>
            </div>
            <button @click="openNewNotif" class="btn-primary text-sm">
              <Plus class="w-4 h-4" /> Nova notificação
            </button>
          </div>

          <div class="alert-info">
            <Bell class="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              Crie templates com variáveis dinâmicas (ex: <code class="bg-primary-100 px-1 rounded">{nome}</code>, <code class="bg-primary-100 px-1 rounded">{data}</code>). Na agenda, ao abrir um agendamento, clique em <strong>Notificar Paciente</strong> e escolha qual enviar via WhatsApp.
            </p>
          </div>

          <div v-if="loadingTemplates" class="flex justify-center py-8">
            <Loader2 class="w-5 h-5 animate-spin text-primary-500" />
          </div>
          <div v-else-if="templates.length === 0" class="bg-white rounded-2xl border border-slate-200 py-16 text-center">
            <Bell class="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p class="text-slate-500 font-medium text-sm mb-1">Nenhuma notificação criada ainda</p>
            <p class="text-slate-400 text-xs mb-5">Crie templates para enviar ao paciente ao agendar uma consulta.</p>
            <button @click="openNewNotif" class="btn-primary text-sm mx-auto">
              <Plus class="w-4 h-4" /> Criar primeira notificação
            </button>
          </div>
          <div v-else class="space-y-3">
            <div v-for="t in templates" :key="t.id" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <p class="font-semibold text-slate-900 text-sm truncate">{{ t.name }}</p>
                    <span :class="['text-[10px] px-2 py-0.5 rounded-full font-medium', t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500']">
                      {{ t.active ? 'Ativo' : 'Inativo' }}
                    </span>
                  </div>
                  <p class="text-xs text-slate-500 whitespace-pre-wrap line-clamp-2">{{ t.message }}</p>
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button @click="toggleNotifTemplate(t)" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" :title="t.active ? 'Desativar' : 'Ativar'">
                    <ToggleRight v-if="t.active" class="w-4 h-4 text-primary-500" />
                    <ToggleLeft v-else class="w-4 h-4" />
                  </button>
                  <button @click="openEditNotif(t)" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                    <Pencil class="w-4 h-4" />
                  </button>
                  <button @click="deleteNotifTemplate(t.id)" class="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <Modal :is-open="notifModalOpen" @close="notifModalOpen = false" :title="editingTemplate ? 'Editar Notificação' : 'Nova Notificação'" size="md">
            <form @submit.prevent="saveNotifTemplate" class="space-y-4">
              <div>
                <label class="label">Nome da notificação *</label>
                <input v-model="notifForm.name" required class="input-field" placeholder="Ex: Confirmação de agendamento" />
              </div>
              <div>
                <label class="label">Variáveis disponíveis</label>
                <div class="flex flex-wrap gap-1.5 mb-2">
                  <button
                    v-for="v in NOTIF_VARIABLE_CHIPS"
                    :key="v.key"
                    type="button"
                    @click="insertVariable(v.key)"
                    class="text-[11px] px-2 py-1 rounded-lg bg-primary-50 border border-primary-200 text-primary-700 hover:bg-primary-100 font-mono transition-colors"
                  >
                    {{ v.key }}
                  </button>
                </div>
                <label class="label">Mensagem *</label>
                <textarea
                  ref="notifMsgRef"
                  v-model="notifForm.message"
                  required
                  rows="6"
                  class="input-field resize-none font-mono text-sm"
                  placeholder="Olá {nome}! Sua consulta foi agendada para {data} às {hora} com {medico}. Local: {clinica}. Qualquer dúvida estamos à disposição!"
                />
              </div>
              <div class="flex items-center gap-2">
                <input type="checkbox" v-model="notifForm.active" id="notif-active" class="w-4 h-4 accent-primary-600" />
                <label for="notif-active" class="text-sm text-slate-700">Ativo</label>
              </div>
              <div class="flex gap-3 pt-2">
                <button type="button" @click="notifModalOpen = false" class="btn-ghost flex-1">Cancelar</button>
                <button type="submit" :disabled="savingTemplate" class="btn-primary flex-1">
                  <Loader2 v-if="savingTemplate" class="w-4 h-4 animate-spin" />
                  <template v-else>{{ editingTemplate ? 'Salvar' : 'Criar' }}</template>
                </button>
              </div>
            </form>
          </Modal>
        </div>
      </div>
    </div>
  </div>
</template>
