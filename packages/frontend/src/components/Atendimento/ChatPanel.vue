<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowLeft, ArrowRightLeft, CheckCircle2, UserCheck, Bot, RotateCcw, PanelRightOpen, PanelRightClose,
  SendHorizontal, StickyNote, WifiOff, Lock, Loader2, ChevronDown, ArrowRight,
} from 'lucide-vue-next'
import { useAttendanceStore, type ChatMessage } from '../../stores/attendance'
import { useAuthStore } from '../../stores/auth'
import toast from '../../lib/toast'
import MessageBubble from './MessageBubble.vue'
import { STATUS_META, avatarColor, dayLabel, describeEvent, displayName, formatPhone, initials, clockTime } from './format'

defineProps<{ panelOpen: boolean }>()
const emit = defineEmits<{ back: []; togglePanel: []; transfer: [] }>()

const store = useAttendanceStore()
const auth = useAuthStore()
const conv = computed(() => store.detail!)

// ─── Ações do cabeçalho ──────────────────────────────────────────────
const busy = ref<string | null>(null)
async function run(action: 'assume' | 'return-to-bot' | 'resolve' | 'reopen') {
  busy.value = action
  const ok = await store.act(action)
  busy.value = null
  if (ok && action === 'resolve') toast.success('Atendimento resolvido')
}

const status = computed(() => conv.value.status)
const show = computed(() => ({
  assume: status.value === 'QUEUED' || status.value === 'BOT',
  transfer: status.value !== 'RESOLVED',
  resolve: status.value === 'IN_PROGRESS',
  returnToBot: conv.value.hasAiAgent && status.value !== 'BOT' && status.value !== 'RESOLVED',
  reopen: status.value === 'RESOLVED',
}))

// ─── Linha do tempo (mensagens + eventos + separadores de dia) ───────
type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: ChatMessage }
  | { kind: 'event'; key: string; text: string; time: string }

const rows = computed<Row[]>(() => {
  const msgs = store.messages
  const oldest = msgs.find(m => !m.localId)?.timestamp
  const evs = store.events
    .filter(e => e.type !== 'NOTE' && (!store.hasMore || (oldest && e.createdAt >= oldest)))
    .map(e => ({ at: e.createdAt, row: { kind: 'event' as const, key: `e-${e.id}`, text: describeEvent(e) + (e.note ? ` — “${e.note}”` : ''), time: clockTime(e.createdAt) } }))
  const all = [
    ...msgs.map(m => ({ at: m.timestamp, row: { kind: 'msg' as const, key: m.localId ?? m.id, msg: m } })),
    ...evs,
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const out: Row[] = []
  let lastDay = ''
  for (const item of all) {
    const day = new Date(item.at).toDateString()
    if (day !== lastDay) {
      out.push({ kind: 'day', key: `d-${day}`, label: dayLabel(item.at) })
      lastDay = day
    }
    out.push(item.row)
  }
  return out
})

// ─── Scroll ──────────────────────────────────────────────────────────
const scroller = ref<HTMLElement | null>(null)
const atBottom = ref(true)

function onScroll() {
  const el = scroller.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (el.scrollTop < 80) loadOlder()
}

async function loadOlder() {
  const el = scroller.value
  if (!el || !store.hasMore || store.loadingOlder) return
  const prevHeight = el.scrollHeight
  const prevTop = el.scrollTop
  await store.loadOlder()
  await nextTick()
  el.scrollTop = el.scrollHeight - prevHeight + prevTop
}

function scrollToBottom(smooth = false) {
  nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }))
}

watch(() => store.selectedId, () => { atBottom.value = true })
watch(
  () => store.messages[store.messages.length - 1]?.localId ?? store.messages[store.messages.length - 1]?.id,
  (now, before) => {
    if (!now) return
    const last = store.messages[store.messages.length - 1]
    if (!before) scrollToBottom()
    else if (atBottom.value || last.localId) scrollToBottom(true)
  },
)

// ─── Composer ────────────────────────────────────────────────────────
const MAX_LEN = 4096
const drafts = new Map<string, string>()
const text = ref('')
const noteMode = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)

watch(() => store.selectedId, (id, prev) => {
  if (prev) drafts.set(prev, text.value)
  text.value = (id && drafts.get(id)) || ''
  noteMode.value = false
  nextTick(autoGrow)
})

const canSendMessage = computed(() => conv.value.roomConnected && conv.value.canReply)
const canSubmit = computed(() => !!text.value.trim() && (noteMode.value || canSendMessage.value))
const placeholder = computed(() => {
  if (noteMode.value) return 'Escreva uma observação interna — só a equipe vê'
  if (!conv.value.roomConnected) return 'WhatsApp da sala desconectado'
  if (!conv.value.canReply) return 'Sem permissão para responder nesta sala'
  return 'Digite uma mensagem para enviar'
})

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

function submit() {
  const value = text.value.trim()
  if (!value || !canSubmit.value) return
  if (value.length > MAX_LEN) {
    toast.error(`Mensagem muito longa (máx. ${MAX_LEN} caracteres)`)
    return
  }
  store.send(value, noteMode.value)
  text.value = ''
  noteMode.value = false
  nextTick(() => { autoGrow(); textarea.value?.focus() })
}

function toggleNote() {
  noteMode.value = !noteMode.value
  nextTick(() => textarea.value?.focus())
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Cabeçalho -->
    <header class="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-slate-100 bg-white">
      <button class="btn-icon w-8 h-8 md:hidden -ml-1" aria-label="Voltar para a lista" @click="emit('back')">
        <ArrowLeft class="w-4 h-4" />
      </button>

      <img v-if="conv.contactAvatar" :src="conv.contactAvatar" alt="" class="w-10 h-10 rounded-full object-cover flex-shrink-0" />
      <div v-else :class="['w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0', avatarColor(conv.contactPhone)]">
        {{ initials(displayName(conv)) }}
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <p class="text-sm font-semibold text-slate-900 truncate">{{ displayName(conv) }}</p>
          <span :class="['hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 flex-shrink-0', STATUS_META[conv.status].chip]">
            {{ STATUS_META[conv.status].label }}
          </span>
        </div>
        <p class="text-xs text-slate-500 truncate mt-0.5">
          {{ formatPhone(conv.contactPhone) }} · {{ conv.room.name }}
          <span class="hidden lg:inline-flex items-center gap-1 ml-2 text-slate-400">
            <span v-if="conv.patient?.leadStatus" class="text-slate-500">{{ conv.patient.leadStatus === 'CONVERTIDO' ? 'Paciente' : 'Lead' }} ·</span>
            <span class="inline-flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full" :style="{ background: conv.queue?.color || '#cbd5e1' }" />
              {{ conv.queue?.name ?? 'Sem fila' }}
            </span>
            <ArrowRight class="w-3 h-3" />
            <span :class="conv.assignedUser ? 'text-slate-600' : ''">{{ conv.assignedUser ? (conv.assignedUser.id === auth.user?.id ? 'Você' : conv.assignedUser.name) : 'Sem responsável' }}</span>
          </span>
        </p>
      </div>

      <div class="flex items-center gap-1.5 flex-shrink-0">
        <button v-if="show.returnToBot" class="btn-ghost px-2.5 py-1.5 text-xs" :disabled="!!busy" aria-label="Devolver ao Agente de IA" title="Devolver ao Agente de IA" @click="run('return-to-bot')">
          <Bot class="w-4 h-4" /><span class="hidden xl:inline">Devolver à IA</span>
        </button>
        <button v-if="show.assume" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors" :disabled="!!busy || !conv.canReply" aria-label="Assumir conversa" @click="run('assume')">
          <Loader2 v-if="busy === 'assume'" class="w-3.5 h-3.5 animate-spin" /><UserCheck v-else class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Assumir</span>
        </button>
        <button v-if="show.transfer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 transition-colors" :disabled="!!busy" aria-label="Transferir conversa" @click="emit('transfer')">
          <ArrowRightLeft class="w-3.5 h-3.5" /><span class="hidden sm:inline">Transferir</span>
        </button>
        <button v-if="show.resolve" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors" :disabled="!!busy" aria-label="Resolver conversa" @click="run('resolve')">
          <Loader2 v-if="busy === 'resolve'" class="w-3.5 h-3.5 animate-spin" /><CheckCircle2 v-else class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Resolver</span>
        </button>
        <button v-if="show.reopen" class="btn-secondary px-3 py-1.5 text-xs rounded-lg" :disabled="!!busy" aria-label="Reabrir conversa" @click="run('reopen')">
          <RotateCcw class="w-3.5 h-3.5" /><span class="hidden sm:inline">Reabrir</span>
        </button>
        <button class="btn-icon w-8 h-8" :aria-label="panelOpen ? 'Fechar detalhes' : 'Abrir detalhes'" :title="panelOpen ? 'Fechar detalhes' : 'Detalhes do contato'" @click="emit('togglePanel')">
          <PanelRightClose v-if="panelOpen" class="w-4 h-4" /><PanelRightOpen v-else class="w-4 h-4" />
        </button>
      </div>
    </header>

    <!-- Avisos -->
    <div v-if="!conv.roomConnected" class="flex items-center gap-2 px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
      <WifiOff class="w-3.5 h-3.5 flex-shrink-0" /> O WhatsApp da sala {{ conv.room.name }} está desconectado — não é possível enviar mensagens.
    </div>
    <div v-else-if="conv.status === 'BOT'" class="flex items-center gap-2 px-4 py-2 text-xs text-violet-800 bg-violet-50 border-b border-violet-100">
      <Bot class="w-3.5 h-3.5 flex-shrink-0" /> O Agente de IA está atendendo — envie uma mensagem para assumir.
    </div>
    <div v-else-if="!conv.canReply" class="flex items-center gap-2 px-4 py-2 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">
      <Lock class="w-3.5 h-3.5 flex-shrink-0" /> Você pode acompanhar, mas não tem permissão para responder nesta sala.
    </div>

    <!-- Mensagens -->
    <div class="relative flex-1 min-h-0">
      <div ref="scroller" class="absolute inset-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-1.5 bg-[#f5f3ef]" @scroll.passive="onScroll">
        <div v-if="store.loadingOlder" class="flex justify-center py-2"><Loader2 class="w-4 h-4 text-slate-400 animate-spin" /></div>
        <div v-if="store.detailLoading && !store.messages.length" class="flex justify-center py-10"><Loader2 class="w-5 h-5 text-slate-400 animate-spin" /></div>
        <p v-else-if="!store.messages.length" class="text-center text-xs text-slate-400 py-10">Nenhuma mensagem ainda.</p>

        <template v-for="row in rows" :key="row.key">
          <div v-if="row.kind === 'day'" class="flex justify-center py-2 sticky top-0 z-[1]">
            <span class="px-2.5 py-1 rounded-lg bg-white/90 shadow-sm text-[11px] font-medium text-slate-500">{{ row.label }}</span>
          </div>
          <p v-else-if="row.kind === 'event'" class="text-center text-[11px] text-slate-400 py-1">
            {{ row.text }} · {{ row.time }}
          </p>
          <MessageBubble v-else :message="row.msg" @retry="store.deliver" @discard="store.discard" />
        </template>
      </div>

      <button
        v-if="!atBottom"
        class="absolute bottom-3 right-4 w-9 h-9 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700"
        aria-label="Ir para a última mensagem"
        @click="scrollToBottom(true)"
      >
        <ChevronDown class="w-4 h-4" />
      </button>
    </div>

    <!-- Rodapé -->
    <footer :class="['px-3 sm:px-4 py-3 border-t transition-colors', noteMode ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100']">
      <div class="flex items-end gap-2">
        <textarea
          ref="textarea"
          v-model="text"
          rows="1"
          :maxlength="MAX_LEN"
          :placeholder="placeholder"
          :disabled="!noteMode && !canSendMessage"
          :aria-label="noteMode ? 'Observação interna' : 'Mensagem'"
          :class="[
            'flex-1 resize-none text-sm leading-relaxed px-3.5 py-2.5 rounded-xl border focus:outline-none focus:ring-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
            noteMode ? 'bg-white border-amber-200 focus:ring-amber-200' : 'bg-slate-50 border-transparent focus:bg-white focus:border-slate-200 focus:ring-primary-100',
          ]"
          @input="autoGrow"
          @keydown="onKeydown"
        />
        <button
          :class="[
            'w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95',
            noteMode ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700',
          ]"
          :disabled="!canSubmit"
          :aria-label="noteMode ? 'Salvar observação' : 'Enviar mensagem'"
          @click="submit"
        >
          <SendHorizontal class="w-4 h-4" />
        </button>
      </div>
      <div class="flex items-center justify-between mt-2">
        <button
          :class="['inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2 py-1 -ml-2 transition-colors', noteMode ? 'text-amber-700 bg-amber-100' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100']"
          :aria-pressed="noteMode"
          @click="toggleNote"
        >
          <StickyNote class="w-3.5 h-3.5" />
          {{ noteMode ? 'Observação interna ativa' : '+ Adicionar observação' }}
        </button>
        <span class="hidden sm:block text-[11px] text-slate-400">Enter envia · Shift+Enter quebra linha</span>
      </div>
    </footer>
  </div>
</template>
