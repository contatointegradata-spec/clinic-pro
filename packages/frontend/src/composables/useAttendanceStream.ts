import { ref, onBeforeUnmount } from 'vue'
import api, { API_BASE_URL } from '../lib/api'
import type { AttendanceMessage, AttendanceSummary, ConversationListItem } from '../types'

export type StreamState = 'connecting' | 'live' | 'polling' | 'closed'

interface StreamHandlers {
  onConversation: (c: ConversationListItem) => void
  onMessage: (m: AttendanceMessage) => void
  onSummary?: (s: AttendanceSummary) => void
  /** Chamado a cada ciclo de polling e após reconectar (para recuperar o que se perdeu). */
  onResync: () => void
}

const POLL_INTERVAL = 10_000
const MAX_BACKOFF = 60_000
const FAILURES_BEFORE_POLLING = 3

/**
 * Tempo real do Atendimento via SSE. Cada (re)conexão pede um token curto
 * novo em /attendance/stream-token (EventSource não manda header Authorization).
 * Falhou 3 vezes seguidas → liga polling de 10s, mas continua tentando
 * reconectar com backoff exponencial; ao voltar, desliga o polling.
 */
export function useAttendanceStream(handlers: StreamHandlers) {
  const state = ref<StreamState>('connecting')
  let source: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let failures = 0
  let hadFailure = false
  let stopped = false

  function parse<T>(e: Event): T | null {
    try { return JSON.parse((e as MessageEvent<string>).data) as T } catch { return null }
  }

  function startPolling() {
    if (pollTimer) return
    state.value = 'polling'
    handlers.onResync()
    pollTimer = setInterval(handlers.onResync, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
  }

  function scheduleReconnect() {
    if (stopped) return
    failures++
    hadFailure = true
    if (failures >= FAILURES_BEFORE_POLLING) startPolling()
    else state.value = 'connecting'
    const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** (failures - 1)) + Math.random() * 500
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, delay)
  }

  async function connect() {
    if (stopped) return
    source?.close()
    source = null
    try {
      const { data } = await api.post<{ token: string }>('/attendance/stream-token')
      if (stopped) return
      const es = new EventSource(`${API_BASE_URL}/attendance/stream?token=${encodeURIComponent(data.token)}`)
      source = es
      es.onopen = () => {
        failures = 0
        state.value = 'live'
        stopPolling()
        if (hadFailure) { hadFailure = false; handlers.onResync() }
      }
      es.addEventListener('conversation.updated', e => {
        const c = parse<ConversationListItem>(e)
        if (c) handlers.onConversation(c)
      })
      es.addEventListener('message.created', e => {
        const m = parse<AttendanceMessage>(e)
        if (m) handlers.onMessage(m)
      })
      es.addEventListener('summary', e => {
        const s = parse<AttendanceSummary>(e)
        if (s) handlers.onSummary?.(s)
      })
      es.onerror = () => {
        // O token é de uso curto: em vez de deixar o EventSource tentar
        // sozinho com o mesmo token, fecha e reconecta com um novo.
        if (source !== es) return
        es.close()
        source = null
        scheduleReconnect()
      }
    } catch {
      scheduleReconnect()
    }
  }

  function stop() {
    stopped = true
    state.value = 'closed'
    clearTimeout(retryTimer)
    stopPolling()
    source?.close()
    source = null
  }

  connect()
  onBeforeUnmount(stop)

  return { state, stop }
}
