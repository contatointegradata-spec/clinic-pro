/**
 * MinhasSalas.tsx — Visão operacional da secretária
 * Exibe apenas as salas nas quais a secretária foi vinculada.
 * A conexão WhatsApp não é mais gerenciada aqui — fica em Agente de IA → Conectar.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, MapPin, Clock, History, Shield, MessageSquare, ChevronRight, ArrowLeft,
  Users, CheckCircle, XCircle,
} from 'lucide-react'
import api from '../lib/api'
import type { Room, RoomPermissions } from '../types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MyRoom extends Room {
  myPermissions: RoomPermissions
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

function dayLabel(days: number[]) {
  return DAYS.filter(d => days.includes(d.value)).map(d => d.label).join(', ')
}

function addressLine(room: Room) {
  const parts = [room.logradouro, room.numero].filter(Boolean).join(', ')
  const city = room.cidade || ''
  return [parts, city].filter(Boolean).join(' — ') || null
}

// ─── Detalhe da sala ──────────────────────────────────────────────────────────

function RoomDetail({ room, onBack }: { room: MyRoom; onBack: () => void }) {
  const perms = room.myPermissions

  const { data: history } = useQuery<{ logs: { id: string; action: string; description?: string; createdAt: string }[] }>({
    queryKey: ['my-room-history', room.id],
    queryFn: () => api.get(`/my/rooms/${room.id}/history`).then(r => r.data),
    enabled: perms.canViewHistory,
  })

  const actionLabels: Record<string, string> = {
    WHATSAPP_CONNECT: '🔗 WhatsApp conectado',
    WHATSAPP_RECONNECT: '🔄 WhatsApp reconectado',
    WHATSAPP_DISCONNECT: '🔌 WhatsApp desconectado',
    ROOM_UPDATE: '✏️ Sala atualizada',
    ROOM_PERMISSIONS_UPDATE: '🔒 Permissões atualizadas',
  }

  const addr = addressLine(room)

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-slate-900">{room.name}</h2>
          <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-slate-500">
            {addr && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {addr}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {room.startTime} – {room.endTime}</span>
            <span>{dayLabel(room.daysOfWeek)}</span>
          </div>
        </div>
      </div>

      {/* Resumo de permissões */}
      <div className="card bg-blue-50 border-blue-200 p-3">
        <p className="text-xs font-semibold text-blue-900 mb-2">Minhas permissões nesta sala</p>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'canViewSchedule', label: 'Ver agenda' },
            { key: 'canSendMessages', label: 'Enviar mensagens' },
            { key: 'canUseTemplates', label: 'Usar templates' },
            { key: 'canViewHistory', label: 'Ver histórico' },
          ].map(({ key, label }) => {
            const has = perms[key as keyof RoomPermissions]
            return (
              <span key={key} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                has ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400 border border-slate-200'
              }`}>
                {has ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {label}
              </span>
            )
          })}
        </div>
      </div>

      {/* Histórico */}
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
          <History className="w-4 h-4" /> Histórico
        </p>
        <div className="space-y-2">
          {!perms.canViewHistory ? (
            <div className="py-6 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" /> Sem permissão para ver histórico
            </div>
          ) : !history?.logs.length ? (
            <div className="py-6 text-center">
              <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Nenhuma ação registrada.</p>
            </div>
          ) : (
            history.logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 p-3 border border-slate-100 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{actionLabels[log.action] ?? log.action}</p>
                  {log.description && <p className="text-xs text-slate-500 mt-0.5">{log.description}</p>}
                </div>
                <p className="text-xs text-slate-400 flex-shrink-0">{new Date(log.createdAt).toLocaleString('pt-BR')}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function MinhasSalas() {
  const [selectedRoom, setSelectedRoom] = useState<MyRoom | null>(null)

  const { data: rooms = [], isLoading } = useQuery<MyRoom[]>({
    queryKey: ['my-rooms'],
    queryFn: () => api.get('/my/rooms').then(r => r.data),
  })

  if (selectedRoom) {
    return (
      <div className="max-w-2xl space-y-4">
        <RoomDetail room={selectedRoom} onBack={() => setSelectedRoom(null)} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6 page-stagger">
      <div className="animate-stagger-1">
        <h1 className="page-title">Minhas Salas</h1>
        <p className="page-subtitle">Salas nas quais você está vinculada como responsável</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-slate-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="card text-center py-12 animate-stagger-2">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3 animate-float" />
          <p className="text-slate-500 font-medium">Nenhuma sala vinculada</p>
          <p className="text-slate-400 text-sm mt-1">
            O médico responsável precisa vincular você a uma sala nas configurações.
          </p>
        </div>
      ) : (
        <div className="space-y-3 animate-stagger-2">
          {rooms.map(room => {
            const perms = room.myPermissions

            return (
              <div key={room.id}
                className={`card hover:border-blue-200 transition-colors cursor-pointer group ${!room.active ? 'opacity-60' : ''}`}
                onClick={() => setSelectedRoom(room)}
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{room.name}</p>
                      {!room.active && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativa</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-500">
                      {addressLine(room) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {addressLine(room)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {room.startTime} – {room.endTime}
                      </span>
                      <span>{dayLabel(room.daysOfWeek)}</span>
                    </div>

                    {/* Mini badge de permissões */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {perms.canViewSchedule && (
                        <span className="flex items-center gap-0.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-full">
                          <Users className="w-2.5 h-2.5" /> Agenda
                        </span>
                      )}
                      {perms.canUseTemplates && (
                        <span className="flex items-center gap-0.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-full">
                          <MessageSquare className="w-2.5 h-2.5" /> Templates
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 flex-shrink-0 mt-1 transition-colors" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card bg-blue-50 border-blue-200 text-sm text-blue-700 space-y-1 animate-stagger-3">
        <p className="font-semibold text-blue-900">Minhas Salas</p>
        <p>• Aqui você vê apenas as salas nas quais foi vinculada pelo médico responsável</p>
        <p>• A conexão do WhatsApp fica em Agente de IA → Conectar</p>
        <p>• Em caso de dúvidas, entre em contato com o responsável da clínica</p>
      </div>
    </div>
  )
}
