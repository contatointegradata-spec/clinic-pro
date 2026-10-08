import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../lib/api'
import toast from '../lib/toast'
import { useAuthStore } from './auth'
import { errorMessage } from '../components/Atendimento/format'
import type {
  AttendanceMessage, AttendanceQueue, AttendanceSummary, AttendanceTab,
  ConversationDetail, ConversationEvent, ConversationListItem,
} from '../types'

/** Mensagem na tela — `localId` só existe enquanto o envio otimista não foi confirmado. */
export type ChatMessage = AttendanceMessage & { localId?: string; error?: string }

type Paged<T> = { items: T[]; nextCursor: string | null }

const PAGE_SIZE = 30
let tempSeq = 0

function byRecent(a: ConversationListItem, b: ConversationListItem) {
  return (b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0) - (a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0)
}

/**
 * Estado do módulo Atendimento. Fica numa store (e não só na página) porque
 * a sidebar usa o mesmo `summary` para o badge de não lidas, e o stream em
 * tempo real aplica atualizações aqui sem refetch completo.
 */
export const useAttendanceStore = defineStore('attendance', () => {
  const auth = useAuthStore()

  const summary = ref<AttendanceSummary | null>(null)
  const queues = ref<AttendanceQueue[]>([])

  // ─── Lista ───────────────────────────────────────────────────────────
  const tab = ref<AttendanceTab>('mine')
  const search = ref('')
  const queueId = ref('')
  const items = ref<ConversationListItem[]>([])
  const nextCursor = ref<string | null>(null)
  const listLoading = ref(false)
  const listLoadingMore = ref(false)
  let listReq = 0

  // ─── Conversa aberta ─────────────────────────────────────────────────
  const selectedId = ref<string | null>(null)
  const detail = ref<ConversationDetail | null>(null)
  const detailLoading = ref(false)
  const messages = ref<ChatMessage[]>([])
  const hasMore = ref(false)
  const loadingOlder = ref(false)
  const events = ref<ConversationEvent[]>([])
  let selectReq = 0

  function listParams(cursor?: string | null) {
    return {
      tab: tab.value,
      search: search.value.trim() || undefined,
      queueId: queueId.value || undefined,
      cursor: cursor || undefined,
      limit: PAGE_SIZE,
    }
  }

  let summaryAt = 0
  /** `minAge` evita chamadas duplicadas (ex.: sidebar desktop + mobile montadas juntas). */
  async function fetchSummary(minAge = 0) {
    if (minAge && Date.now() - summaryAt < minAge) return
    summaryAt = Date.now()
    try {
      summary.value = (await api.get<AttendanceSummary>('/attendance/summary')).data
    } catch { /* silencioso — badge não pode travar a UI */ }
  }

  async function fetchQueues() {
    try {
      queues.value = (await api.get<AttendanceQueue[]>('/attendance/queues')).data
    } catch { /* idem */ }
  }

  async function fetchList() {
    const req = ++listReq
    listLoading.value = true
    try {
      const { data } = await api.get<Paged<ConversationListItem>>('/attendance/conversations', { params: listParams() })
      if (req !== listReq) return
      items.value = data.items
      nextCursor.value = data.nextCursor
    } catch (e) {
      if (req === listReq) toast.error(errorMessage(e, 'Erro ao carregar conversas'))
    } finally {
      if (req === listReq) listLoading.value = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value || listLoadingMore.value || listLoading.value) return
    const req = listReq
    listLoadingMore.value = true
    try {
      const { data } = await api.get<Paged<ConversationListItem>>('/attendance/conversations', { params: listParams(nextCursor.value) })
      if (req !== listReq) return
      const seen = new Set(items.value.map(i => i.id))
      items.value.push(...data.items.filter(i => !seen.has(i.id)))
      nextCursor.value = data.nextCursor
    } catch { /* tenta de novo no próximo scroll */ } finally {
      listLoadingMore.value = false
    }
  }

  function matchesFilters(c: ConversationListItem): boolean {
    const me = auth.user?.id
    const okTab = tab.value === 'mine' ? c.status === 'IN_PROGRESS' && c.assignedUser?.id === me
      : tab.value === 'queue' ? c.status === 'QUEUED'
      : tab.value === 'bot' ? c.status === 'BOT'
      : tab.value === 'resolved' ? c.status === 'RESOLVED'
      : c.status !== 'RESOLVED'
    if (!okTab) return false
    if (queueId.value && c.queue?.id !== queueId.value) return false
    const q = search.value.trim().toLowerCase()
    if (q) {
      const digits = q.replace(/\D/g, '')
      const hay = `${c.contactName ?? ''} ${c.patient?.name ?? ''}`.toLowerCase()
      if (!hay.includes(q) && !(digits && c.contactPhone.includes(digits))) return false
    }
    return true
  }

  /** Aplica uma conversa atualizada (stream, ação ou polling) na lista e no chat aberto. */
  function upsertConversation(c: ConversationListItem) {
    const idx = items.value.findIndex(i => i.id === c.id)
    if (matchesFilters(c)) {
      if (idx >= 0) items.value[idx] = c
      else items.value.push(c)
      items.value.sort(byRecent)
    } else if (idx >= 0) {
      items.value.splice(idx, 1)
    }

    if (detail.value && detail.value.id === c.id) {
      const prev = detail.value
      type DetailPatient = NonNullable<ConversationDetail['patient']>
      const p = c.patient as (NonNullable<ConversationListItem['patient']> & Partial<Pick<DetailPatient, 'nextAppointment'>>) | null
      const extra = c as Partial<ConversationDetail>
      detail.value = {
        ...prev,
        ...c,
        patient: p
          ? { ...p, nextAppointment: p.nextAppointment !== undefined ? p.nextAppointment : (prev.patient?.id === p.id ? prev.patient.nextAppointment : null) }
          : null,
        canReply: extra.canReply ?? prev.canReply,
        roomConnected: extra.roomConnected ?? prev.roomConnected,
        hasAiAgent: extra.hasAiAgent ?? prev.hasAiAgent,
      }
      // Conversa aberta e visível: o que chegar já está sendo lido.
      if (c.unreadCount > 0 && document.visibilityState === 'visible') markRead()
    }
  }

  function applyMessage(m: AttendanceMessage) {
    if (m.conversationId === selectedId.value) {
      const existing = messages.value.findIndex(x => x.id === m.id)
      if (existing >= 0) {
        messages.value[existing] = m
      } else {
        // O stream pode chegar antes da resposta do POST — troca a bolha otimista.
        const tmp = m.fromMe && !m.isBot
          ? messages.value.findIndex(x => x.localId && x.status === 'PENDING' && x.content === m.content && x.isInternalNote === m.isInternalNote)
          : -1
        if (tmp >= 0) messages.value.splice(tmp, 1, m)
        else messages.value.push(m)
      }
      if (!m.fromMe && !m.isInternalNote && document.visibilityState === 'visible') markRead()
    }

    const item = items.value.find(i => i.id === m.conversationId)
    if (item && !m.isInternalNote) {
      item.lastMessage = m.content || '[mídia]'
      item.lastMessageAt = m.timestamp
      item.lastMessageFromMe = m.fromMe
      items.value.sort(byRecent)
    }
  }

  // ─── Conversa ────────────────────────────────────────────────────────

  async function select(id: string | null) {
    const req = ++selectReq
    selectedId.value = id
    messages.value = []
    events.value = []
    hasMore.value = false
    if (!id) { detail.value = null; return }

    // Cabeçalho provisório com o que a lista já tem, pra não piscar vazio.
    const item = items.value.find(i => i.id === id)
    detail.value = item
      ? { ...item, patient: item.patient ? { ...item.patient, nextAppointment: null } : null, canReply: true, roomConnected: true, hasAiAgent: false }
      : null
    detailLoading.value = true

    const [d, m] = await Promise.allSettled([
      api.get<ConversationDetail>(`/attendance/conversations/${id}`),
      api.get<{ items: AttendanceMessage[]; hasMore: boolean }>(`/attendance/conversations/${id}/messages`, { params: { limit: 50 } }),
    ])
    if (req !== selectReq) return
    detailLoading.value = false
    if (d.status === 'fulfilled') detail.value = d.value.data
    else { toast.error(errorMessage(d.reason, 'Erro ao abrir conversa')); return }
    if (m.status === 'fulfilled') {
      messages.value = m.value.data.items
      hasMore.value = m.value.data.hasMore
    }
    fetchEvents()
    if (detail.value.unreadCount > 0 || item?.unreadCount) markRead()
  }

  async function fetchEvents() {
    const id = selectedId.value
    if (!id) return
    try {
      const { data } = await api.get<ConversationEvent[]>(`/attendance/conversations/${id}/events`)
      if (id === selectedId.value) events.value = data
    } catch { /* timeline é secundária */ }
  }

  async function loadOlder() {
    const id = selectedId.value
    const oldest = messages.value.find(x => !x.localId)
    if (!id || !oldest || !hasMore.value || loadingOlder.value) return
    loadingOlder.value = true
    try {
      const { data } = await api.get<{ items: AttendanceMessage[]; hasMore: boolean }>(
        `/attendance/conversations/${id}/messages`, { params: { before: oldest.timestamp, limit: 50 } },
      )
      if (id !== selectedId.value) return
      const seen = new Set(messages.value.map(x => x.id))
      messages.value.unshift(...data.items.filter(x => !seen.has(x.id)))
      hasMore.value = data.hasMore
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao carregar mensagens antigas'))
    } finally {
      loadingOlder.value = false
    }
  }

  let readTimer: ReturnType<typeof setTimeout> | undefined
  function markRead() {
    const id = selectedId.value
    if (!id) return
    const item = items.value.find(i => i.id === id)
    if (item) item.unreadCount = 0
    if (detail.value?.id === id) detail.value.unreadCount = 0
    clearTimeout(readTimer)
    readTimer = setTimeout(async () => {
      try {
        await api.post(`/attendance/conversations/${id}/read`)
        fetchSummary()
      } catch { /* ignora */ }
    }, 400)
  }

  // ─── Envio ───────────────────────────────────────────────────────────

  function send(content: string, asNote: boolean) {
    const id = selectedId.value
    if (!id || !content.trim()) return
    const localId = `tmp-${++tempSeq}`
    const msg: ChatMessage = {
      id: localId, localId, conversationId: id, fromMe: true, isBot: false, isInternalNote: asNote,
      author: auth.user ? { id: auth.user.id, name: auth.user.name } : null,
      content, type: 'text', mediaUrl: null, status: 'PENDING', timestamp: new Date().toISOString(),
    }
    messages.value.push(msg)
    deliver(localId)
  }

  async function deliver(localId: string) {
    const msg = messages.value.find(x => x.localId === localId)
    if (!msg) return
    msg.status = 'PENDING'
    msg.error = undefined
    const convId = msg.conversationId
    try {
      const path = msg.isInternalNote ? 'notes' : 'messages'
      const { data } = await api.post<AttendanceMessage>(`/attendance/conversations/${convId}/${path}`, { content: msg.content })
      const idx = messages.value.findIndex(x => x.localId === localId)
      if (idx >= 0) {
        if (messages.value.some(x => x.id === data.id)) messages.value.splice(idx, 1)
        else messages.value.splice(idx, 1, data)
      }
      if (!data.isInternalNote) {
        const item = items.value.find(i => i.id === convId)
        if (item) { item.lastMessage = data.content; item.lastMessageAt = data.timestamp; item.lastMessageFromMe = true; items.value.sort(byRecent) }
        // Enviar assume a conversa no backend; sem stream, sincroniza o cabeçalho.
        const d = detail.value
        if (d && d.id === convId && (d.status !== 'IN_PROGRESS' || d.assignedUser?.id !== auth.user?.id)) refreshDetail()
      } else if (detail.value?.id === convId) {
        fetchEvents()
      }
    } catch (e) {
      const target = messages.value.find(x => x.localId === localId)
      if (target) {
        target.status = 'FAILED'
        target.error = errorMessage(e, 'Falha ao enviar')
      }
      toast.error(errorMessage(e, 'Não foi possível enviar a mensagem'))
    }
  }

  function discard(localId: string) {
    const idx = messages.value.findIndex(x => x.localId === localId)
    if (idx >= 0) messages.value.splice(idx, 1)
  }

  async function refreshDetail() {
    const id = selectedId.value
    if (!id) return
    try {
      const { data } = await api.get<ConversationDetail>(`/attendance/conversations/${id}`)
      if (id === selectedId.value) { detail.value = data; upsertConversation(data) }
    } catch { /* ignora */ }
  }

  // ─── Ações ───────────────────────────────────────────────────────────

  type Action = 'assume' | 'transfer' | 'return-to-bot' | 'resolve' | 'reopen'

  async function act(action: Action, body?: Record<string, unknown>): Promise<boolean> {
    const id = selectedId.value
    if (!id) return false
    try {
      const { data } = await api.post<ConversationListItem>(`/attendance/conversations/${id}/${action}`, body ?? {})
      upsertConversation(data)
      fetchEvents()
      fetchSummary()
      return true
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (action === 'assume' && status === 409 && !body?.force && auth.user?.role !== 'SECRETARY') {
        if (confirm(`${errorMessage(e, 'Esta conversa já está com outra pessoa.')}\n\nAssumir mesmo assim?`)) {
          return act('assume', { force: true })
        }
        return false
      }
      toast.error(errorMessage(e, 'Não foi possível concluir a ação'))
      return false
    }
  }

  // ─── Resync (polling de fallback / após reconexão) ───────────────────

  async function resync() {
    fetchSummary()
    try {
      const { data } = await api.get<Paged<ConversationListItem>>('/attendance/conversations', { params: listParams() })
      if (items.value.length <= data.items.length) {
        items.value = data.items
        nextCursor.value = data.nextCursor
      } else {
        data.items.forEach(upsertConversation)
      }
    } catch { /* próxima rodada */ }

    const id = selectedId.value
    if (!id) return
    try {
      const [d, m] = await Promise.all([
        api.get<ConversationDetail>(`/attendance/conversations/${id}`),
        api.get<{ items: AttendanceMessage[]; hasMore: boolean }>(`/attendance/conversations/${id}/messages`, { params: { limit: 50 } }),
      ])
      if (id !== selectedId.value) return
      upsertConversation(d.data)
      detail.value = d.data
      m.data.items.forEach(applyMessage)
    } catch { /* idem */ }
  }

  function reset() {
    selectReq++
    listReq++
    selectedId.value = null
    detail.value = null
    messages.value = []
    events.value = []
  }

  return {
    summary, queues, tab, search, queueId, items, nextCursor, listLoading, listLoadingMore,
    selectedId, detail, detailLoading, messages, hasMore, loadingOlder, events,
    fetchSummary, fetchQueues, fetchList, loadMore, upsertConversation, applyMessage,
    select, fetchEvents, loadOlder, markRead, send, deliver, discard, refreshDetail, act, resync, reset,
  }
})
