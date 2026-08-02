import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  Wifi, Bot, Bell, Plus, Trash2, Sparkles, Search, MessageSquare,
  Pencil, ToggleLeft, ToggleRight, Loader2, ShieldOff, CalendarClock,
  ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { WhatsAppTab } from './configuracoes/Salas'
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

// ─── Conectar ──────────────────────────────────────────────────────────────

function ConectarPanel({ agent, rooms }: { agent?: AiAgent | null; rooms: Room[] }) {
  const boundRoom = rooms.find(r => r.id === agent?.boundRoomId)

  if (!agent) {
    return (
      <div className="empty-state py-16">
        <Wifi className="w-10 h-10 text-slate-200 mb-3" />
        <p className="text-slate-500 font-medium text-sm">Crie o Agente de IA primeiro</p>
        <p className="text-slate-400 text-xs mt-1">Depois escolha a clínica/sala na aba Agenda pra conectar o WhatsApp aqui.</p>
      </div>
    )
  }

  if (!boundRoom) {
    return (
      <div className="empty-state py-16">
        <Wifi className="w-10 h-10 text-slate-200 mb-3" />
        <p className="text-slate-500 font-medium text-sm">Nenhuma sala vinculada ao agente ainda</p>
        <p className="text-slate-400 text-xs mt-1">Vá em Agente de IA → Agenda e escolha a clínica/sala pra poder conectar o WhatsApp.</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto">
      <WhatsAppTab room={boundRoom} />
    </div>
  )
}

// ─── Personalizar seu Prompt ──────────────────────────────────────────────────

interface PromptConfigForm {
  agentName: string
  companyName: string
  businessType: string
  calendarUsage: string
  agentProfession: string
  personality: string
  extraInfo: string
}

function PersonalizarPromptTab({ agent, onGenerated }: { agent: AiAgent; onGenerated: () => void }) {
  const qc = useQueryClient()
  const { register, handleSubmit } = useForm<PromptConfigForm>({
    defaultValues: {
      agentName: agent.agentName ?? '',
      companyName: agent.companyName ?? '',
      businessType: agent.businessType ?? '',
      calendarUsage: agent.calendarUsage ?? '',
      agentProfession: agent.agentProfession ?? '',
      personality: agent.personality ?? '',
      extraInfo: agent.extraInfo ?? '',
    },
  })

  const saveMutation = useMutation({
    mutationFn: (data: PromptConfigForm) => api.put(`/ai-agent/${agent.id}/prompt-config`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent'] })
      toast.success('Configuração salva!')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/ai-agent/${agent.id}/generate-prompt`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent'] })
      toast.success('Prompt gerado! Veja e ajuste em "Prompt de IA".')
      onGenerated()
    },
    onError: () => toast.error('Erro ao gerar prompt com IA'),
  })

  return (
    <form onSubmit={handleSubmit(d => saveMutation.mutate(d))} className="space-y-4 max-w-2xl">
      <div>
        <label className="label">Nome do(a) Agente</label>
        <input {...register('agentName')} className="input-field" placeholder="Ex: Kelven Silva" />
      </div>
      <div>
        <label className="label">Nome da sua empresa</label>
        <input {...register('companyName')} className="input-field" placeholder="Ex: Integradata" />
      </div>
      <div>
        <label className="label">Ramo do seu negócio</label>
        <input {...register('businessType')} className="input-field" placeholder="Ex: Desenvolvimento de Software" />
      </div>
      <div>
        <label className="label">Uso do calendário / Agendamentos</label>
        <textarea {...register('calendarUsage')} rows={2} className="input-field resize-none" placeholder="Descreva como o agente deve usar o calendário..." />
      </div>
      <div>
        <label className="label">Profissão do(a) Agente</label>
        <input {...register('agentProfession')} className="input-field" placeholder="Ex: Consultor" />
      </div>
      <div>
        <label className="label">Personalidade e Tom</label>
        <textarea {...register('personality')} rows={4} className="input-field resize-none" placeholder="Descreva como o agente deve se comportar e se comunicar" />
      </div>
      <div>
        <label className="label">Complemento (informações adicionais)</label>
        <textarea {...register('extraInfo')} rows={3} className="input-field resize-none" placeholder="Adicione informações extras que você gostaria que o agente soubesse..." />
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saveMutation.isPending} className="btn-secondary flex-1">
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Configuração'}
        </button>
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="btn-primary flex-1"
        >
          {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Gerar e Ativar Prompt Personalizado</>}
        </button>
      </div>
    </form>
  )
}

// ─── Agenda ────────────────────────────────────────────────────────────────

function AgendaTab({ agent, rooms }: { agent: AiAgent; rooms: Room[] }) {
  const qc = useQueryClient()
  const [selectedRoomId, setSelectedRoomId] = useState(agent.boundRoomId ?? '')
  const room = rooms.find(r => r.id === selectedRoomId)

  const saveMutation = useMutation({
    mutationFn: (roomId: string) => api.put(`/ai-agent/${agent.id}/room`, { roomId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent'] })
      toast.success('Configuração salva!')
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Erro ao salvar'),
  })

  if (rooms.length === 0) {
    return (
      <div className="empty-state py-16">
        <CalendarClock className="w-10 h-10 text-slate-200 mb-3" />
        <p className="text-slate-500 font-medium text-sm">Nenhuma clínica/sala cadastrada</p>
        <p className="text-slate-400 text-xs mt-1">Cadastre em Configurações → Clínica antes de vincular ao agente.</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <label className="label">Clínica / Sala</label>
        <select value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="input-field">
          <option value="">Selecione</option>
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <p className="text-xs text-slate-400 mt-1">O agente usa o horário de funcionamento dessa sala pra saber quando marcar consultas.</p>
      </div>

      {room && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Horário de funcionamento</p>
          {describeSchedule(room).map((line, i) => (
            <p key={i} className="text-sm text-slate-700">{line}</p>
          ))}
          <p className="text-xs text-slate-400 mt-2">Pra alterar o horário, edite a sala em Configurações → Clínica.</p>
        </div>
      )}

      <button
        onClick={() => saveMutation.mutate(selectedRoomId)}
        disabled={saveMutation.isPending || !selectedRoomId}
        className="btn-primary"
      >
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Configuração'}
      </button>
    </div>
  )
}

// ─── Número Pass ───────────────────────────────────────────────────────────

function NumeroPassTab({ agent }: { agent: AiAgent }) {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')

  const { data: numbers = [] } = useQuery<AiAgentIgnoredNumber[]>({
    queryKey: ['ai-agent-ignored', agent.id],
    queryFn: () => api.get(`/ai-agent/${agent.id}/ignored-numbers`).then(r => r.data),
  })

  const addMutation = useMutation({
    mutationFn: () => api.post(`/ai-agent/${agent.id}/ignored-numbers`, { phone, name: name || undefined }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent-ignored', agent.id] })
      setPhone(''); setName('')
      toast.success('Número adicionado')
    },
    onError: () => toast.error('Erro ao adicionar número'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/ai-agent/${agent.id}/ignored-numbers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent-ignored', agent.id] })
      toast.success('Número removido')
    },
  })

  return (
    <div className="max-w-xl space-y-4">
      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-sm text-cyan-800 flex items-start gap-2">
        <ShieldOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>Números nesta lista são <strong>ignorados pela IA</strong> — mensagens recebidas não terão resposta automática.</p>
      </div>

      <div className="flex gap-2">
        <input value={phone} onChange={e => setPhone(e.target.value)} className="input-field flex-1" placeholder="Telefone (ex: 5527999999999)" />
        <input value={name} onChange={e => setName(e.target.value)} className="input-field flex-1" placeholder="Nome (opcional)" />
        <button onClick={() => addMutation.mutate()} disabled={!phone || addMutation.isPending} className="btn-primary whitespace-nowrap">
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {numbers.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Nenhum número na lista</p>
        ) : numbers.map(n => (
          <div key={n.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{n.phone}</p>
              {n.name && <p className="text-xs text-slate-400">{n.name}</p>}
            </div>
            <button onClick={() => removeMutation.mutate(n.id)} className="text-slate-400 hover:text-red-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Conversas ─────────────────────────────────────────────────────────────

interface ConversationContact { phone: string; lastMessage: string; lastMessageAt: string; count: number }

function ConversasTab({ agent }: { agent: AiAgent }) {
  const [search, setSearch] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const { data: contacts = [], refetch, isFetching } = useQuery<ConversationContact[]>({
    queryKey: ['ai-agent-conversations', agent.id],
    queryFn: () => api.get(`/ai-agent/${agent.id}/conversations`).then(r => r.data),
  })

  const { data: messages = [] } = useQuery<AiAgentMessage[]>({
    queryKey: ['ai-agent-conversation', agent.id, selectedPhone],
    queryFn: () => api.get(`/ai-agent/${agent.id}/conversations/${selectedPhone}`).then(r => r.data),
    enabled: !!selectedPhone,
  })

  const filtered = contacts.filter(c => c.phone.includes(search) || c.lastMessage.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9" placeholder="Buscar por telefone ou nome..." />
        </div>
        <button onClick={() => refetch()} className="btn-secondary whitespace-nowrap">
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Atualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[500px]">
        <div className="card p-0 overflow-y-auto">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-4 pt-4 pb-2">Contatos</p>
          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-8 px-4">Nenhuma conversa encontrada</p>
          ) : filtered.map(c => (
            <button
              key={c.phone}
              onClick={() => setSelectedPhone(c.phone)}
              className={`w-full text-left px-4 py-3 border-t border-slate-100 hover:bg-slate-50 ${selectedPhone === c.phone ? 'bg-blue-50' : ''}`}
            >
              <p className="text-sm font-semibold text-slate-800">{c.phone}</p>
              <p className="text-xs text-slate-400 truncate">{c.lastMessage}</p>
            </button>
          ))}
        </div>

        <div className="md:col-span-2 card p-0 flex flex-col overflow-hidden">
          {!selectedPhone ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <MessageSquare className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">Nenhuma conversa selecionada</p>
              <p className="text-xs">Selecione um contato à esquerda para visualizar as mensagens</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.role === 'assistant' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Prompt de IA ──────────────────────────────────────────────────────────

function PromptIaTab({ agent }: { agent: AiAgent }) {
  const qc = useQueryClient()
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? '')
  const [delay, setDelay] = useState(agent.responseDelaySeconds)

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/ai-agent/${agent.id}/system-prompt`, { systemPrompt, responseDelaySeconds: delay }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent'] })
      toast.success('Prompt salvo!')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <label className="label">Prompt do sistema (personalidade do bot)</label>
        <textarea
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={14}
          className="input-field resize-y font-mono text-sm"
          placeholder="Gere o prompt na aba Personalizar seu Prompt, ou escreva/ajuste aqui manualmente..."
        />
      </div>

      <div>
        <label className="label flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-slate-400" /> Tempo de resposta (segundos)</label>
        <input
          type="number" min={0} max={60}
          value={delay}
          onChange={e => setDelay(parseInt(e.target.value) || 0)}
          className="input-field max-w-[160px]"
        />
        <p className="text-xs text-slate-400 mt-1">Simula o tempo de digitação humana. A IA aguardará este tempo antes de enviar a resposta. Recomendado: 2-5 segundos.</p>
      </div>

      <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="btn-primary">
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Prompt e Tempo de Resposta'}
      </button>
    </div>
  )
}

// ─── Agente de IA (container) ─────────────────────────────────────────────────

const AGENT_TABS: { key: AgentTab; label: string }[] = [
  { key: 'prompt', label: 'Personalizar seu Prompt' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'pass', label: 'Número Pass' },
  { key: 'conversas', label: 'Conversas' },
  { key: 'ia', label: 'Prompt de IA' },
]

function AgentePanel({ agent, rooms, isLoading }: { agent?: AiAgent | null; rooms: Room[]; isLoading: boolean }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<AgentTab>('prompt')

  const createMutation = useMutation({
    mutationFn: () => api.post('/ai-agent', {}).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agent'] })
      toast.success('Agente criado!')
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Erro ao criar agente'),
  })

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
  }

  if (!agent) {
    return (
      <div className="empty-state py-16">
        <Bot className="w-12 h-12 text-slate-200 mb-4" />
        <p className="text-slate-500 font-semibold">Você ainda não tem um Agente de IA</p>
        <p className="text-slate-400 text-sm mt-1 mb-5">Crie seu agente e personalize o atendimento automático do WhatsApp.</p>
        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="btn-primary">
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Criar Agente</>}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-700">
        <span>Cada médico tem direito a 1 agente de IA.</span>
        <a
          href={`https://wa.me/${UPSELL_PHONE}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-blue-800 hover:underline"
        >
          Precisa de mais um? Fale conosco <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {AGENT_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {tab === 'prompt' && <PersonalizarPromptTab agent={agent} onGenerated={() => setTab('ia')} />}
        {tab === 'agenda' && <AgendaTab agent={agent} rooms={rooms} />}
        {tab === 'pass' && <NumeroPassTab agent={agent} />}
        {tab === 'conversas' && <ConversasTab agent={agent} />}
        {tab === 'ia' && <PromptIaTab agent={agent} />}
      </div>
    </div>
  )
}

// ─── Notificações (mantida como antes) ────────────────────────────────────────

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

function NotificacoesPanel() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<LightNotificationTemplate | null>(null)
  const msgRef = useRef<HTMLTextAreaElement>(null)

  const { data: templates = [], isLoading } = useQuery<LightNotificationTemplate[]>({
    queryKey: ['light-notif-templates'],
    queryFn: () => api.get('/chatbot-light/notification-templates').then(r => r.data),
  })

  const { register, handleSubmit, reset, setValue, watch } = useForm<{ name: string; message: string; active: boolean }>({
    defaultValues: { name: '', message: '', active: true },
  })
  const messageValue = watch('message', '')

  const openNew = () => { setEditing(null); reset({ name: '', message: '', active: true }); setModalOpen(true) }
  const openEdit = (t: LightNotificationTemplate) => { setEditing(t); reset({ name: t.name, message: t.message, active: t.active }); setModalOpen(true) }

  const insertVariable = (v: string) => {
    const el = msgRef.current
    if (!el) { setValue('message', messageValue + v); return }
    const start = el.selectionStart ?? messageValue.length
    const end = el.selectionEnd ?? messageValue.length
    const next = messageValue.slice(0, start) + v + messageValue.slice(end)
    setValue('message', next)
    setTimeout(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length) }, 0)
  }

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; message: string; active: boolean }) =>
      editing
        ? api.put(`/chatbot-light/notification-templates/${editing.id}`, data).then(r => r.data)
        : api.post('/chatbot-light/notification-templates', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['light-notif-templates'] })
      setModalOpen(false)
      toast.success(editing ? 'Notificação atualizada' : 'Notificação criada')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/chatbot-light/notification-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['light-notif-templates'] }); toast.success('Notificação removida') },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/chatbot-light/notification-templates/${id}`, { active }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['light-notif-templates'] }),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Notificações</h2>
          <p className="text-sm text-slate-500 mt-0.5">Templates de mensagem enviados ao agendar uma consulta</p>
        </div>
        <button onClick={openNew} className="btn-primary text-sm">
          <Plus className="w-4 h-4" /> Nova notificação
        </button>
      </div>

      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-sm text-cyan-800">
        <p className="font-medium mb-1 flex items-center gap-1.5"><Bell className="w-4 h-4" /> Como funciona</p>
        <p>Crie templates com variáveis dinâmicas (ex: <code className="bg-cyan-100 px-1 rounded">{'{nome}'}</code>, <code className="bg-cyan-100 px-1 rounded">{'{data}'}</code>). Na agenda, ao abrir um agendamento, clique em <strong>Notificar Paciente</strong> e escolha qual enviar via WhatsApp.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-cyan-500" /></div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center">
          <Bell className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 font-medium text-sm mb-1">Nenhuma notificação criada ainda</p>
          <p className="text-slate-400 text-xs mb-5">Crie templates para enviar ao paciente ao agendar uma consulta.</p>
          <button onClick={openNew} className="btn-primary text-sm mx-auto">
            <Plus className="w-4 h-4" /> Criar primeira notificação
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-slate-900 text-sm truncate">{t.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {t.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-2">{t.message}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => toggleMutation.mutate({ id: t.id, active: !t.active })} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title={t.active ? 'Desativar' : 'Ativar'}>
                    {t.active ? <ToggleRight className="w-4 h-4 text-cyan-500" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm('Remover esta notificação?')) deleteMutation.mutate(t.id) }} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Notificação' : 'Nova Notificação'} size="md">
        <form onSubmit={handleSubmit(d => saveMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Nome da notificação *</label>
            <input {...register('name', { required: true })} className="input-field" placeholder="Ex: Confirmação de agendamento" />
          </div>
          <div>
            <label className="label">Variáveis disponíveis</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {NOTIF_VARIABLE_CHIPS.map(v => (
                <button key={v.key} type="button" onClick={() => insertVariable(v.key)} className="text-[11px] px-2 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100 font-mono transition-colors">
                  {v.key}
                </button>
              ))}
            </div>
            <label className="label">Mensagem *</label>
            <textarea
              {...register('message', { required: true })}
              ref={(el) => {
                (register('message').ref as (el: HTMLTextAreaElement | null) => void)(el)
                ;(msgRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
              }}
              rows={6}
              className="input-field resize-none font-mono text-sm"
              placeholder="Olá {nome}! Sua consulta foi agendada para {data} às {hora} com {medico}. Local: {clinica}. Qualquer dúvida estamos à disposição!"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" {...register('active')} id="notif-active" className="w-4 h-4 accent-cyan-600" />
            <label htmlFor="notif-active" className="text-sm text-slate-700">Ativo</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-ghost flex-1">Cancelar</button>
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary flex-1">
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

const MENU: { key: Panel; label: string; icon: typeof Wifi }[] = [
  { key: 'conectar', label: 'Conectar', icon: Wifi },
  { key: 'agente', label: 'Agente de IA', icon: Bot },
  { key: 'notificacoes', label: 'Notificações', icon: Bell },
]

export default function WhatsappChatbot() {
  const [panel, setPanel] = useState<Panel>('conectar')

  const { data: agent, isLoading: loadingAgent } = useQuery<AiAgent | null>({
    queryKey: ['ai-agent'],
    queryFn: () => api.get('/ai-agent').then(r => r.data),
  })

  const { data: rooms = [] } = useQuery<Room[]>({
    queryKey: ['rooms'],
    queryFn: () => api.get('/rooms').then(r => r.data),
  })

  return (
    <div className="space-y-4 page-stagger">
      <PageHeader title="WhatsApp" subtitle="Conexão, agente de IA e notificações" />

      <div className="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-4">
        <nav className="card p-2 flex lg:flex-col gap-1 h-fit">
          {MENU.map(item => {
            const Icon = item.icon
            const active = panel === item.key
            return (
              <button
                key={item.key}
                onClick={() => setPanel(item.key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="card">
          {panel === 'conectar' && <ConectarPanel agent={agent} rooms={rooms} />}
          {panel === 'agente' && <AgentePanel agent={agent} rooms={rooms} isLoading={loadingAgent} />}
          {panel === 'notificacoes' && <NotificacoesPanel />}
        </div>
      </div>
    </div>
  )
}
