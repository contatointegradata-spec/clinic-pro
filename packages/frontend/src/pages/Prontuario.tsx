import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Search,
  Plus,
  ClipboardList,
  User,
  ChevronRight,
  FileText,
  Stethoscope,
  Trash2,
  ChevronDown,
  AlertTriangle,
  Pencil,
  DollarSign,
  CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import PageHeader from '../components/ui/PageHeader'
import { useAuthStore } from '../store/authStore'
import type { Patient, User as UserType, GroupedMedicalRecord, MedicalRecord, AppointmentType, HealthPlan } from '../types'
import Modal from '../components/ui/Modal'
import { SpecialtyRecordView } from '../components/prontuario/SpecialtyRecordView'
import LancarFinanceiroModal from '../components/prontuario/LancarFinanceiroModal'

const recordTypeConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  ANAMNESE: { label: 'Anamnese', color: 'text-blue-700', bg: 'bg-blue-100', icon: '📋' },
  EVOLUCAO: { label: 'Evolução', color: 'text-emerald-700', bg: 'bg-emerald-100', icon: '📈' },
  PRESCRICAO: { label: 'Prescrição', color: 'text-purple-700', bg: 'bg-purple-100', icon: '💊' },
  EXAME: { label: 'Exame', color: 'text-amber-700', bg: 'bg-amber-100', icon: '🔬' },
  ATESTADO: { label: 'Atestado', color: 'text-red-700', bg: 'bg-red-100', icon: '📄' },
  OUTROS: { label: 'Outros', color: 'text-slate-700', bg: 'bg-slate-100', icon: '📝' },
  SISTEMA: { label: 'Sistema', color: 'text-indigo-700', bg: 'bg-indigo-100', icon: '⚙️' },
}

// Tipos que o médico pode escolher ao criar/editar manualmente. 'SISTEMA' é
// reservado para lançamentos automáticos (falta, remarcação, conclusão de
// consulta) e nunca aparece como opção nesse formulário.
const MANUAL_RECORD_TYPES = Object.entries(recordTypeConfig).filter(([value]) => value !== 'SISTEMA')

const schema = z.object({
  patientId: z.string().min(1, 'Selecione um paciente'),
  doctorId: z.string().min(1, 'Selecione um médico'),
  type: z.enum(['ANAMNESE', 'EVOLUCAO', 'PRESCRICAO', 'EXAME', 'ATESTADO', 'OUTROS']),
  title: z.string().min(2, 'Título obrigatório'),
  date: z.string(),
  objetivoClinico: z.string().optional(),
  sintese: z.string().optional(),
  encaminhamento: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface ProcedureEntry {
  appointmentTypeId?: string
  name: string
  valorTabelado: number
  valorPago: number
}

// ─── Seção de Procedimentos (dentro do formulário de prontuário) ──────────────

function ProceduresSection({
  appointmentTypes,
  healthPlan,
  procedures,
  onChange,
}: {
  appointmentTypes: AppointmentType[]
  healthPlan?: HealthPlan | null
  procedures: ProcedureEntry[]
  onChange: (next: ProcedureEntry[]) => void
}) {
  const [selectedTypeId, setSelectedTypeId] = useState('')

  const suggestedValueFor = (typeId: string) => {
    const override = healthPlan?.procedures?.find(p => p.appointmentTypeId === typeId)
    if (override) return override.value
    const type = appointmentTypes.find(t => t.id === typeId)
    return type?.baseValue ?? 0
  }

  const handleAdd = () => {
    const type = appointmentTypes.find(t => t.id === selectedTypeId)
    if (!type) return
    const value = suggestedValueFor(selectedTypeId)
    onChange([...procedures, { appointmentTypeId: type.id, name: type.name, valorTabelado: value, valorPago: value }])
    setSelectedTypeId('')
  }

  const handleFieldChange = (index: number, field: 'valorTabelado' | 'valorPago', value: number) => {
    onChange(procedures.map((p, i) => i === index ? { ...p, [field]: value } : p))
  }

  const handleRemove = (index: number) => {
    onChange(procedures.filter((_, i) => i !== index))
  }

  return (
    <div>
      <label className="label flex items-center gap-1">
        <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
        Procedimentos
      </label>

      {procedures.length > 0 && (
        <div className="space-y-2 mb-3">
          <div className="grid grid-cols-[1fr,110px,110px,24px] gap-2 px-1">
            <span className="text-xs text-slate-400 font-medium">Procedimento</span>
            <span className="text-xs text-slate-400 font-medium">Valor tabelado</span>
            <span className="text-xs text-slate-400 font-medium">Valor pago</span>
            <span />
          </div>
          {procedures.map((p, idx) => (
            <div key={idx} className="grid grid-cols-[1fr,110px,110px,24px] gap-2 items-center">
              <span className="text-sm text-slate-700 truncate">{p.name}</span>
              <input
                type="number" step="0.01" min="0"
                value={p.valorTabelado}
                onChange={e => handleFieldChange(idx, 'valorTabelado', parseFloat(e.target.value) || 0)}
                className="input-field text-sm py-1.5"
              />
              <div>
                <input
                  type="number" step="0.01" min="0"
                  value={p.valorPago}
                  onChange={e => handleFieldChange(idx, 'valorPago', parseFloat(e.target.value) || 0)}
                  className="input-field text-sm py-1.5"
                />
                {p.valorPago === 0 && (
                  <span className="text-[10px] text-amber-600 font-semibold">Cortesia</span>
                )}
              </div>
              <button type="button" onClick={() => handleRemove(idx)} className="text-slate-400 hover:text-red-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {appointmentTypes.length > 0 ? (
        <div className="flex gap-2">
          <select value={selectedTypeId} onChange={e => setSelectedTypeId(e.target.value)} className="input-field flex-1">
            <option value="">Selecione um procedimento</option>
            {appointmentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" onClick={handleAdd} disabled={!selectedTypeId} className="btn-secondary px-3 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
            <Plus className="w-4 h-4" />
            Adicionar Procedimento
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Cadastre procedimentos em Configurações → Procedimento pra usá-los aqui.</p>
      )}
    </div>
  )
}

// ─── Card de registro salvo ─────────────────────────────────────────────────

function RecordCard({
  record, onEdit, onLaunchFinance, canEdit,
}: {
  record: MedicalRecord
  onEdit: () => void
  onLaunchFinance: () => void
  canEdit: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const tc = recordTypeConfig[record.type] || recordTypeConfig.OUTROS
  const procedures = record.procedures ?? []
  const canLaunchFinance = canEdit && procedures.length > 0 && !record.billedAt
  const specialtyData = record.specialtyData as { objetivoClinico?: string; sintese?: string; encaminhamento?: string } | null | undefined

  return (
    <div
      className={`border rounded-2xl overflow-hidden transition-all duration-250 ${
        expanded
          ? 'border-blue-200 shadow-md shadow-blue-50'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <button
        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ${
          expanded ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-base w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tc.bg} transition-transform duration-200 ${expanded ? 'scale-110' : ''}`}>
          {tc.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-semibold text-sm transition-colors duration-150 ${expanded ? 'text-blue-800' : 'text-slate-900'}`}>
              {record.title}
            </p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tc.bg} ${tc.color}`}>
              {tc.label}
            </span>
            {record.billedAt && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Lançado
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {format(new Date(record.date), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
          </p>
        </div>
        <div
          className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0
                      transition-all duration-250 ease-spring ${
            expanded ? 'bg-blue-100 text-blue-600 rotate-180' : 'bg-slate-100 text-slate-400'
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-blue-100/70 bg-blue-50/30 animate-slide-in">
          {record.specialtyType === 'GERAL' && specialtyData ? (
            <div className="space-y-3">
              {specialtyData.objetivoClinico && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Objetivo Clínico</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{specialtyData.objetivoClinico}</p>
                </div>
              )}
              {specialtyData.sintese && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Síntese</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{specialtyData.sintese}</p>
                </div>
              )}
              {specialtyData.encaminhamento && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Encaminhamento</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{specialtyData.encaminhamento}</p>
                </div>
              )}
            </div>
          ) : record.specialtyData && record.specialtyType ? (
            <SpecialtyRecordView
              specialtyType={record.specialtyType}
              data={record.specialtyData}
            />
          ) : (
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{record.content}</p>
          )}

          {procedures.length > 0 && (
            <div className="mt-4 border-t border-blue-100 pt-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Procedimentos</p>
              <div className="space-y-1.5">
                {procedures.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 flex items-center gap-2">
                      {p.name}
                      {p.valorPago === 0 && (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Cortesia</span>
                      )}
                    </span>
                    <span className="font-medium text-slate-800">R$ {p.valorPago.toFixed(2).replace('.', ',')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end gap-2 mt-4">
              {canLaunchFinance && (
                <button
                  onClick={onLaunchFinance}
                  className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800
                             hover:bg-emerald-50 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-95
                             border border-transparent hover:border-emerald-100"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  Lançar Financeiro
                </button>
              )}
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800
                           hover:bg-blue-50 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-95
                           border border-transparent hover:border-blue-100"
              >
                <Pencil className="w-3.5 h-3.5" />
                Editar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Formulário único de registro (criação e edição) ───────────────────────────

function RecordForm({
  defaultPatientId,
  patients,
  doctors,
  appointmentTypes,
  healthPlans,
  currentUser,
  onSubmit,
  loading,
  initialValues,
  initialProcedures,
  submitLabel = 'Salvar Prontuário',
}: {
  defaultPatientId?: string
  patients: Patient[]
  doctors: UserType[]
  appointmentTypes: AppointmentType[]
  healthPlans: HealthPlan[]
  currentUser: { id: string; role: string } | null
  onSubmit: (data: FormData & { procedures: ProcedureEntry[] }) => void
  loading: boolean
  initialValues?: Partial<FormData>
  initialProcedures?: ProcedureEntry[]
  submitLabel?: string
}) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      patientId: defaultPatientId || '',
      doctorId: currentUser?.role === 'DOCTOR' ? currentUser.id : '',
      type: 'EVOLUCAO',
      date: format(new Date(), 'yyyy-MM-dd'),
      title: '',
      objetivoClinico: '',
      sintese: '',
      encaminhamento: '',
      ...initialValues,
    },
  })
  const [procedures, setProcedures] = useState<ProcedureEntry[]>(initialProcedures ?? [])

  const watchPatientId = watch('patientId')
  const selectedPatient = patients.find(p => p.id === watchPatientId)
  const primaryPlanId = selectedPatient?.patientPlans?.[0]?.healthPlanId
  const healthPlan = healthPlans.find(hp => hp.id === primaryPlanId) ?? null

  const submit = (data: FormData) => onSubmit({ ...data, procedures })

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Paciente *</label>
          <select {...register('patientId')} className="input-field">
            <option value="">Selecione</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.patientId && <p className="text-xs text-red-500 mt-1">{errors.patientId.message}</p>}
        </div>
        <div>
          <label className="label">Médico *</label>
          <select {...register('doctorId')} className="input-field" disabled={currentUser?.role === 'DOCTOR'}>
            <option value="">Selecione</option>
            {doctors.map(d => <option key={d.id} value={d.id}>Dr(a). {d.name}</option>)}
          </select>
          {errors.doctorId && <p className="text-xs text-red-500 mt-1">{errors.doctorId.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tipo *</label>
          <select {...register('type')} className="input-field">
            {MANUAL_RECORD_TYPES.map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Data</label>
          <input {...register('date')} type="date" className="input-field" />
        </div>
      </div>

      <div>
        <label className="label">Título *</label>
        <input {...register('title')} className="input-field" placeholder="Ex: Consulta de retorno, Anamnese inicial..." />
        {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
      </div>

      <div>
        <label className="label">Objetivo Clínico</label>
        <textarea
          {...register('objetivoClinico')}
          rows={3}
          className="input-field resize-none"
          placeholder="Objetivo do atendimento..."
        />
      </div>

      <div>
        <label className="label">Síntese</label>
        <textarea
          {...register('sintese')}
          rows={3}
          className="input-field resize-none"
          placeholder="Síntese do que foi observado/discutido..."
        />
      </div>

      <div>
        <label className="label">Encaminhamento</label>
        <textarea
          {...register('encaminhamento')}
          rows={2}
          className="input-field resize-none"
          placeholder="Encaminhamentos, orientações, próximos passos..."
        />
      </div>

      <ProceduresSection
        appointmentTypes={appointmentTypes}
        healthPlan={healthPlan}
        procedures={procedures}
        onChange={setProcedures}
      />

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? (
          <span className="flex items-center gap-2 justify-center">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
        ) : submitLabel}
      </button>
    </form>
  )
}

export default function Prontuario() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<MedicalRecord | null>(null)
  const [launchingRecord, setLaunchingRecord] = useState<MedicalRecord | null>(null)

  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ['patients', search],
    queryFn: () => api.get('/patients', { params: search ? { search } : {} }).then(r => r.data),
  })

  const { data: doctors = [] } = useQuery<UserType[]>({
    queryKey: ['doctors'],
    queryFn: () => api.get('/doctors').then(r => r.data),
  })

  const { data: appointmentTypes = [] } = useQuery<AppointmentType[]>({
    queryKey: ['appointment-types'],
    queryFn: () => api.get('/appointment-types').then(r => r.data),
  })

  const { data: healthPlans = [] } = useQuery<HealthPlan[]>({
    queryKey: ['health-plans'],
    queryFn: () => api.get('/health-plans').then(r => r.data),
  })

  const { data: grouped = [] } = useQuery<GroupedMedicalRecord[]>({
    queryKey: ['prontuario', selectedPatient?.id],
    queryFn: () => api.get(`/medical-records/by-patient/${selectedPatient!.id}`).then(r => r.data),
    enabled: !!selectedPatient,
  })

  const createMutation = useMutation({
    mutationFn: (data: FormData & { procedures: ProcedureEntry[] }) => api.post('/medical-records', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prontuario'] })
      toast.success('Prontuário registrado!')
      setModalOpen(false)
    },
    onError: () => toast.error('Erro ao salvar prontuário'),
  })

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; data: FormData & { procedures: ProcedureEntry[] } }) => api.put(`/medical-records/${vars.id}`, vars.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prontuario'] })
      toast.success('Prontuário atualizado!')
      setEditingRecord(null)
    },
    onError: () => toast.error('Erro ao atualizar prontuário'),
  })

  const totalRecords = grouped.reduce((acc, g) => acc + g.records.length, 0)

  return (
    <div className="space-y-4 page-stagger">
      <PageHeader
        title="Prontuário Eletrônico"
        subtitle="Registros médicos organizados por paciente"
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-[min(600px,70vh)]">
        {/* Patient list */}
        <div className="card p-0 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar paciente..."
                className="input-field pl-9 py-2 text-sm"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 scrollbar-none">
            {patients.length === 0 ? (
              <div className="empty-state py-8">
                <User className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-slate-400 text-sm">Nenhum paciente encontrado</p>
              </div>
            ) : (
              patients.map(p => {
                const isSelected = selectedPatient?.id === p.id
                const initials = p.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatient(p)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-100
                      transition-all duration-150 relative ${
                      isSelected
                        ? 'bg-blue-50'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    {/* Active indicator */}
                    <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full
                                    transition-all duration-200 ${
                      isSelected ? 'h-8 bg-blue-600' : 'h-0 bg-transparent'
                    }`} />
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                                    text-xs font-bold transition-all duration-200 ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-105'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate transition-colors duration-150 ${
                        isSelected ? 'text-blue-700' : 'text-slate-900'
                      }`}>{p.name}</p>
                      <p className="text-xs text-slate-400 truncate">{p.phone}</p>
                    </div>
                    <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-all duration-200 ${
                      isSelected ? 'text-blue-500 translate-x-0 opacity-100' : 'text-slate-300 -translate-x-1 opacity-0 group-hover:opacity-50'
                    }`} />
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Records panel */}
        <div className="xl:col-span-2 card p-0 overflow-hidden flex flex-col">
          {!selectedPatient ? (
            <div className="empty-state flex-1">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 animate-float">
                <ClipboardList className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-slate-500 font-semibold">Selecione um paciente</p>
              <p className="text-slate-400 text-sm mt-1">para visualizar seu prontuário</p>
            </div>
          ) : selectedPatient.status === 'PRE_CADASTRO' ? (
            <div className="empty-state flex-1">
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
              </div>
              <p className="text-slate-700 font-semibold">Cadastro pendente</p>
              <p className="text-slate-400 text-sm mt-1 text-center max-w-xs">
                O prontuário de <strong>{selectedPatient.name}</strong> não está disponível enquanto o cadastro não for finalizado.
              </p>
              <p className="text-xs text-amber-600 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Finalize o cadastro em Pacientes → Finalizar Cadastro
              </p>
            </div>
          ) : (
            <>
              {/* Patient header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-bold">
                        {selectedPatient.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{selectedPatient.name}</p>
                      <p className="text-xs text-slate-500">{selectedPatient.phone} · {totalRecords} registros</p>
                    </div>
                  </div>
                  {grouped.length > 0 && (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="btn-primary text-xs py-2 animate-fade-in"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Novo Registro
                    </button>
                  )}
                </div>
              </div>

              {/* Records grouped by doctor */}
              <div className="overflow-y-auto flex-1 p-5 space-y-6 scrollbar-none">
                {grouped.length === 0 ? (
                  <div className="empty-state">
                    <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3 animate-float">
                      <FileText className="w-7 h-7 text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-semibold">Nenhum prontuário registrado</p>
                    <button
                      onClick={() => setModalOpen(true)}
                      className="mt-4 btn-primary text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Criar primeiro registro
                    </button>
                  </div>
                ) : (
                  grouped.map(group => (
                    <div key={group.doctor.id} className="animate-slide-up">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Stethoscope className="w-3.5 h-3.5 text-blue-600" />
                        </div>
                        <h3 className="font-semibold text-slate-900 text-sm">Dr(a). {group.doctor.name}</h3>
                        {group.doctor.specialty && (
                          <span className="text-xs text-slate-400">· {group.doctor.specialty}</span>
                        )}
                        <span className="ml-auto text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-semibold border border-blue-100">
                          {group.records.length} registro{group.records.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-2 pl-5 border-l-2 border-blue-100">
                        {group.records.map(record => (
                          <RecordCard
                            key={record.id}
                            record={record}
                            canEdit={user?.role === 'ADMIN' || user?.role === 'DOCTOR'}
                            onEdit={() => setEditingRecord(record)}
                            onLaunchFinance={() => setLaunchingRecord(record)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Novo Registro de Prontuário"
        size="lg"
      >
        <RecordForm
          defaultPatientId={selectedPatient?.id}
          patients={patients}
          doctors={doctors}
          appointmentTypes={appointmentTypes}
          healthPlans={healthPlans}
          currentUser={user}
          onSubmit={(data) => createMutation.mutate(data)}
          loading={createMutation.isPending}
        />
      </Modal>

      <Modal
        isOpen={!!editingRecord}
        onClose={() => setEditingRecord(null)}
        title="Editar Registro de Prontuário"
        size="lg"
      >
        {editingRecord && (
          <RecordForm
            key={editingRecord.id}
            defaultPatientId={editingRecord.patientId}
            patients={patients}
            doctors={doctors}
            appointmentTypes={appointmentTypes}
            healthPlans={healthPlans}
            currentUser={user}
            submitLabel="Salvar alterações"
            initialValues={{
              patientId: editingRecord.patientId,
              doctorId: editingRecord.doctorId,
              type: editingRecord.type === 'SISTEMA' ? 'OUTROS' : editingRecord.type,
              date: format(new Date(editingRecord.date), 'yyyy-MM-dd'),
              title: editingRecord.title,
              objetivoClinico: editingRecord.specialtyType === 'GERAL'
                ? (editingRecord.specialtyData as { objetivoClinico?: string })?.objetivoClinico ?? ''
                : '',
              sintese: editingRecord.specialtyType === 'GERAL'
                ? (editingRecord.specialtyData as { sintese?: string })?.sintese ?? ''
                : '',
              encaminhamento: editingRecord.specialtyType === 'GERAL'
                ? (editingRecord.specialtyData as { encaminhamento?: string })?.encaminhamento ?? ''
                : '',
            }}
            initialProcedures={(editingRecord.procedures ?? []).map(p => ({
              appointmentTypeId: p.appointmentTypeId ?? undefined,
              name: p.name,
              valorTabelado: p.valorTabelado,
              valorPago: p.valorPago,
            }))}
            onSubmit={(data) => updateMutation.mutate({ id: editingRecord.id, data })}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {launchingRecord && (
        <LancarFinanceiroModal
          isOpen={!!launchingRecord}
          onClose={() => setLaunchingRecord(null)}
          record={launchingRecord}
          onCharged={() => {
            qc.invalidateQueries({ queryKey: ['prontuario'] })
            setLaunchingRecord(null)
          }}
        />
      )}
    </div>
  )
}
