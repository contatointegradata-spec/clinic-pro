<script setup lang="ts">
/**
 * Aba/painel de conexão WhatsApp de uma sala. Extraído de Salas.vue porque
 * também é consumido pela página do Agente de IA (WhatsappChatbot.vue) —
 * mantenha a prop `room` como única entrada pública (igual ao componente
 * React original `WhatsAppTab({ room })`) para que esse import continue
 * funcionando dos dois lugares.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Wifi, WifiOff, QrCode, RefreshCw, Phone } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import type { Room, RoomWhatsAppConnection, RoomWhatsAppStatus } from '../../types'
import { useQuery } from '../../composables/useQuery'

const props = defineProps<{ room: Room }>()

const authStore = useAuthStore()

// Janela de polling rápido após clicar em Conectar/Reconectar — cobre o
// intervalo entre o clique e o status realmente virar CONNECTING/CONNECTED,
// pra não depender do que a primeira resposta trouxe (evita cair pro
// polling de 15s só porque o refetch imediato ainda pegou "DISCONNECTED").
const FAST_POLL_WINDOW_MS = 45_000

const awaitingSince = ref<number | null>(null)

// Médico/admin usa /rooms, secretária usa /my/rooms (mesma sala, endpoints
// diferentes por causa das regras de acesso de cada papel).
const basePath = computed(() =>
  authStore.user?.role === 'SECRETARY' ? `/my/rooms/${props.room.id}` : `/rooms/${props.room.id}`
)

const { data: waStatus, isLoading, refetch: refetchWaStatus } = useQuery<RoomWhatsAppConnection>({
  key: computed(() => `room-wa-status:${props.room.id}`),
  queryFn: () => api.get(`${basePath.value}/whatsapp/status`).then(r => r.data),
})

watch(() => waStatus.value?.status, (s) => {
  if (s === 'CONNECTED' || s === 'CONNECTING') awaitingSince.value = null
})

// Polling dinâmico: 2s enquanto conectando/reconectando (ou pouco depois de
// clicar em conectar/reconectar), 15s em repouso.
let pollTimer: ReturnType<typeof setTimeout> | undefined

function nextPollDelay(): number {
  const s = waStatus.value?.status
  if (s === 'CONNECTING' || s === 'RECONNECTING') return 2000
  if (awaitingSince.value && Date.now() - awaitingSince.value < FAST_POLL_WINDOW_MS) return 2000
  return 15000
}

function schedulePoll() {
  pollTimer = setTimeout(async () => {
    await refetchWaStatus()
    schedulePoll()
  }, nextPollDelay())
}

onMounted(() => { schedulePoll() })
onBeforeUnmount(() => { if (pollTimer) clearTimeout(pollTimer) })

// ─── Ações ────────────────────────────────────────────────────────────────────

const connecting = ref(false)
async function handleConnect() {
  awaitingSince.value = Date.now()
  connecting.value = true
  try {
    await api.post(`${basePath.value}/whatsapp/connect`)
    await refetchWaStatus()
    toast.success('Aguardando QR Code...')
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao conectar')
  } finally {
    connecting.value = false
  }
}

const reconnecting = ref(false)
async function handleReconnect() {
  awaitingSince.value = Date.now()
  reconnecting.value = true
  try {
    await api.post(`${basePath.value}/whatsapp/reconnect`)
    await refetchWaStatus()
    toast.success('Reconectando...')
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao reconectar')
  } finally {
    reconnecting.value = false
  }
}

const disconnecting = ref(false)
async function handleDisconnect() {
  disconnecting.value = true
  try {
    await api.post(`${basePath.value}/whatsapp/disconnect`)
    await refetchWaStatus()
    toast.success('WhatsApp desconectado')
  } catch {
    toast.error('Erro ao desconectar')
  } finally {
    disconnecting.value = false
  }
}

// Só oferece "Reconectar" quando não há handshake ativo com QR ainda
// válido — clicar durante uma leitura de QR em andamento derrubava a
// sessão no meio do processo e gerava um QR novo sem necessidade.
const qrStillValid = computed(() => {
  const s = waStatus.value
  return s?.status === 'CONNECTING' && !!s.qrCode &&
    (!s.qrCodeExpiresAt || new Date(s.qrCodeExpiresAt) > new Date())
})
// QUARANTINED se comporta como "sem sessão" pro botão — a sessão em disco já
// foi apagada automaticamente (ver watchdog no backend), então não há nada
// pra "reconectar" de verdade, só pareamento novo via "Conectar WhatsApp".
const canShowReconnect = computed(() =>
  !!waStatus.value && waStatus.value.status !== 'DISCONNECTED' && waStatus.value.status !== 'QUARANTINED' && !qrStillValid.value
)

const badgeColors: Record<RoomWhatsAppStatus, string> = {
  CONNECTED: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  CONNECTING: 'text-amber-600 bg-amber-50 border-amber-200',
  RECONNECTING: 'text-primary-600 bg-primary-50 border-primary-200',
  DISCONNECTED: 'text-slate-500 bg-slate-50 border-slate-200',
  QUARANTINED: 'text-red-600 bg-red-50 border-red-200',
}
const badgeLabels: Record<RoomWhatsAppStatus, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando...',
  RECONNECTING: 'Reconectando...',
  DISCONNECTED: 'Desconectado',
  QUARANTINED: 'Quarentena',
}
</script>

<template>
  <div v-if="isLoading" class="py-8 text-center text-slate-400 text-sm">Carregando...</div>
  <div v-else class="space-y-5">
    <!-- Status -->
    <div class="bg-slate-50 rounded-xl p-4 space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-slate-700">Status da conexão</p>
        <span
          v-if="waStatus"
          class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium"
          :class="badgeColors[waStatus.status] ?? badgeColors.DISCONNECTED"
        >
          <Wifi v-if="waStatus.status === 'CONNECTED'" class="w-3 h-3" />
          <WifiOff v-else class="w-3 h-3" />
          {{ badgeLabels[waStatus.status] ?? waStatus.status }}
          <template v-if="waStatus.phoneNumber"> · {{ waStatus.phoneNumber }}</template>
        </span>
        <span v-else class="inline-flex items-center gap-1 text-xs text-slate-400">
          <WifiOff class="w-3 h-3" /> Sem conexão
        </span>
      </div>
      <div v-if="waStatus?.phoneNumber" class="flex items-center gap-2 text-sm text-slate-600">
        <Phone class="w-4 h-4 text-slate-400" />
        <span v-if="waStatus.displayName" class="font-medium">{{ waStatus.displayName }}</span>
        <span class="text-slate-400">·</span>
        <span>{{ waStatus.phoneNumber }}</span>
      </div>
      <p v-if="waStatus?.connectedAt" class="text-xs text-slate-400">
        Conectado em {{ new Date(waStatus.connectedAt).toLocaleString('pt-BR') }}
      </p>
    </div>

    <!-- Reconectando -->
    <div v-if="waStatus?.status === 'RECONNECTING'" class="flex items-center gap-3 p-4 bg-primary-50 border border-primary-200 rounded-xl">
      <RefreshCw class="w-5 h-5 text-primary-600 animate-spin flex-shrink-0" />
      <div>
        <p class="text-sm font-semibold text-primary-800">Reconectando WhatsApp...</p>
        <p class="text-xs text-primary-600 mt-0.5">A sessão está sendo restaurada automaticamente. Aguarde alguns instantes.</p>
      </div>
    </div>

    <!-- QR Code -->
    <div v-if="waStatus?.status === 'CONNECTING'" class="flex flex-col items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
      <QrCode class="w-5 h-5 text-amber-600" />
      <p class="text-sm font-semibold text-amber-800">Escaneie o QR Code no WhatsApp</p>
      <img
        v-if="waStatus.qrCode && (!waStatus.qrCodeExpiresAt || new Date(waStatus.qrCodeExpiresAt) > new Date())"
        :src="waStatus.qrCode"
        alt="QR Code WhatsApp"
        class="w-52 h-52 rounded-xl border-4 border-white shadow-md"
      />
      <div v-else class="w-52 h-52 flex flex-col items-center justify-center bg-white rounded-xl border-4 border-white shadow-md gap-2">
        <RefreshCw class="w-8 h-8 text-amber-400 animate-spin" />
        <p class="text-xs text-amber-600 text-center">Gerando novo QR Code...</p>
      </div>
      <p class="text-xs text-amber-600">Abra o WhatsApp → Menu → Dispositivos vinculados → Vincular dispositivo</p>
    </div>

    <!-- Quarentena: sessão corrompida foi resetada automaticamente -->
    <div v-if="waStatus?.status === 'QUARANTINED'" class="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
      <WifiOff class="w-5 h-5 text-red-600 flex-shrink-0" />
      <div>
        <p class="text-sm font-semibold text-red-800">Conexão em quarentena</p>
        <p class="text-xs text-red-600 mt-0.5">
          Não foi possível recuperar a sessão automaticamente e ela foi reiniciada por segurança.
          Clique em "Conectar WhatsApp" e escaneie o QR Code novamente.
        </p>
      </div>
    </div>

    <!-- Ações -->
    <div class="flex flex-wrap gap-2">
      <button
        v-if="!waStatus || waStatus.status === 'DISCONNECTED' || waStatus.status === 'QUARANTINED'"
        :disabled="connecting"
        class="btn-primary flex items-center gap-2"
        @click="handleConnect"
      >
        <Wifi class="w-4 h-4" />
        {{ connecting ? 'Conectando...' : 'Conectar WhatsApp' }}
      </button>

      <button
        v-if="canShowReconnect"
        :disabled="reconnecting"
        class="btn-secondary flex items-center gap-2"
        @click="handleReconnect"
      >
        <RefreshCw class="w-4 h-4" :class="reconnecting ? 'animate-spin' : ''" />
        Reconectar
      </button>

      <button
        v-if="waStatus?.status === 'CONNECTED'"
        :disabled="disconnecting"
        class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
        @click="handleDisconnect"
      >
        <WifiOff class="w-4 h-4" />
        {{ disconnecting ? 'Desconectando...' : 'Desconectar' }}
      </button>
    </div>

    <div class="bg-primary-50 border border-primary-200 rounded-xl p-3 text-xs text-primary-700 space-y-1">
      <p class="font-semibold text-primary-900">Como funciona</p>
      <p>• Cada sala pode ter sua própria conexão WhatsApp independente</p>
      <p>• Mensagens automáticas serão enviadas pelo número desta sala</p>
      <p>• Gerencie na aba Permissões quem pode conectar/desconectar</p>
    </div>
  </div>
</template>
