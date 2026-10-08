import { EventEmitter } from 'events'
import type { ConversationScopeRef } from './attendance-access'

// ─── Barramento in-process do Atendimento (alimenta o SSE) ───────────────────
// Um canal por médico: cada conexão SSE só escuta o canal do médico do seu
// escopo e ainda filtra cada evento com canSeeConversation (sala acessível).
// In-process: com mais de uma réplica do backend seria preciso trocar por
// Redis pub/sub — hoje o deploy roda um único processo.

export type AttendanceEventName = 'conversation.updated' | 'conversation.merged' | 'message.created' | 'summary'

export interface AttendanceEnvelope {
  ref: ConversationScopeRef
  event: AttendanceEventName
  data: unknown
  // Opcional: restringe o evento a usuários específicos (ex.: summary pessoal).
  onlyUserIds?: string[]
}

const emitter = new EventEmitter()
// Uma conexão SSE = um listener; não há limite útil aqui.
emitter.setMaxListeners(0)

function channel(doctorId: string): string {
  return `doctor:${doctorId}`
}

export function publish(ref: ConversationScopeRef, event: AttendanceEventName, data: unknown, onlyUserIds?: string[]): void {
  if (!ref.doctorId) return
  try {
    emitter.emit(channel(ref.doctorId), { ref, event, data, onlyUserIds } satisfies AttendanceEnvelope)
  } catch (err) {
    console.error('[attendance-events] listener error:', (err as Error)?.message)
  }
}

export function subscribe(doctorId: string, listener: (envelope: AttendanceEnvelope) => void): () => void {
  const ch = channel(doctorId)
  emitter.on(ch, listener)
  return () => emitter.off(ch, listener)
}
