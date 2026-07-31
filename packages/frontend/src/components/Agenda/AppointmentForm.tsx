import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { Trash2, Info, RefreshCw, Check, X, Search, DollarSign, Bell } from 'lucide-react'
import type { Appointment, User, Patient, AuthUser, AppointmentType, Room } from '../../types'
import PreRegisterModal from './PreRegisterModal'
import CobrancaModal from '../Financial/CobrancaModal'
import NotificarPacienteModal from './NotificarPacienteModal'

const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 40, label: '40 min' },
  { value: 50, label: '50 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
]

const RETURN_OPTIONS = [5, 7, 10]

const schema = z.object({
  patientId: z.string().min(1, 'Selecione um paciente'),
  doctorId: z.string().min(1, 'Selecione um médico'),
  title: z.string().min(2, 'Título muito curto'),
  date: z.string().min(1, 'Data obrigatória'),
  duration: z.coerce.number().min(15),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  notes: z.string().optional(),
  roomId: z.string().optional().nullable(),
  repeatCount: z.coerce.number().int().min(1).max(50).optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  appointment: Appointment | null
  defaultDate?: Date
  doctors: User[]
  patients: Patient[]
  appointmentTypes: AppointmentType[]
  rooms: Room[]
  currentUser: AuthUser | null
  onSubmit: (data: FormData) => void
  onDelete?: () => void
  onPatientCreated?: (patient: Patient) => void
  onCharged?: () => void
  loading: boolean
}


export default function AppointmentForm({
  appointment,
  defaultDate,
  doctors,
  patients,
  currentUser,
  onSubmit,
  onDelete,
  onPatientCreated,
  onCharged,
  loading,
}: Props) {
  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      status: 'SCHEDULED',
      duration: 50,
      doctorId: currentUser?.role === 'DOCTOR' ? currentUser.id : '',
      repeatCount: 1,
      roomId: '',
    },
  })

  const [showCobrancaModal, setShowCobrancaModal] = useState(false)
  const [showNotifyModal, setShowNotifyModal] = useState(false)

  // Returns flow state
  const [wantsReturns, setWantsReturns] = useState<boolean | null>(null)
  const [returnsCount, setReturnsCount] = useState<number>(5)

  // Patient search + pre-registration state
  const [patientSearch, setPatientSearch] = useState('')
  const [showPreRegModal, setShowPreRegModal] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [extraPatients, setExtraPatients] = useState<Patient[]>([])

  const allPatients = [...patients, ...extraPatients]

  const filteredPatients = patientSearch.length >= 2
    ? allPatients.filter(p =>
        p.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
        p.phone.includes(patientSearch) ||
        (p.cpf && p.cpf.includes(patientSearch))
      ).slice(0, 8)
    : []

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p)
    setValue('patientId', p.id)
    setPatientSearch('')
    setShowDropdown(false)
    setShowPreRegModal(false)
  }

  const handleClearPatient = () => {
    setSelectedPatient(null)
    setValue('patientId', '')
    setPatientSearch('')
  }

  const handlePatientCreated = (p: Patient) => {
    setExtraPatients(prev => [...prev.filter(ep => ep.id !== p.id), p])
    handleSelectPatient(p)
    onPatientCreated?.(p)
  }

  const watchPatient = watch('patientId')

  useEffect(() => {
    if (appointment) {
      setValue('patientId', appointment.patientId)
      setValue('doctorId', appointment.doctorId)
      setValue('title', appointment.title)
      setValue('date', format(new Date(appointment.date), "yyyy-MM-dd'T'HH:mm"))
      setValue('duration', appointment.duration)
      setValue('status', appointment.status)
      setValue('notes', appointment.notes || '')
      setValue('roomId', appointment.roomId || '')
      // Pre-select patient display for edit mode
      const p = allPatients.find(pt => pt.id === appointment.patientId)
      if (p) setSelectedPatient(p)
    } else if (defaultDate) {
      setValue('date', format(defaultDate, "yyyy-MM-dd'T'HH:mm"))
    } else {
      const now = new Date()
      now.setMinutes(0, 0, 0)
      setValue('date', format(now, "yyyy-MM-dd'T'HH:mm"))
    }
  }, [appointment, defaultDate, setValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill doctorId for SECRETARY
  useEffect(() => {
    if (!appointment && currentUser?.role === 'SECRETARY' && doctors.length === 1) {
      setValue('doctorId', doctors[0].id)
    }
  }, [doctors, currentUser, appointment, setValue])

  const selectedPatientFull = allPatients.find(p => p.id === watchPatient)
  const primaryPlan = selectedPatientFull?.patientPlans?.[0]

  useEffect(() => {
    if (selectedPatientFull && !appointment) {
      setValue('title', `Consulta - ${selectedPatientFull.name}`)
    }
  }, [selectedPatientFull, appointment, setValue])

  // Sync repeatCount with returns flow
  useEffect(() => {
    if (wantsReturns === true) {
      setValue('repeatCount', returnsCount)
    } else {
      setValue('repeatCount', 1)
    }
  }, [wantsReturns, returnsCount, setValue])

  // Retornos automáticos: perguntado sempre em consulta nova, independente
  // de procedimento (antes dependia de um "Tipo" com hasReturns).
  const showReturnsFlow = !appointment

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {patients.length === 0 && !selectedPatient && (
        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl text-cyan-800 text-sm flex gap-2 items-start">
          <Info className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Nenhum paciente cadastrado</p>
            <p>Use a opção "Criar pré-cadastro rápido" abaixo para agendar sem cadastro completo.</p>
          </div>
        </div>
      )}

      {currentUser?.role === 'SECRETARY' && doctors.length === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex gap-2 items-start">
          <Info className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Nenhum profissional vinculado</p>
            <p>Você não está vinculada a nenhum médico ativo. Contate o administrador.</p>
          </div>
        </div>
      )}

      {/* Hidden patientId field for form validation */}
      <input {...register('patientId')} type="hidden" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Paciente *</label>
          {selectedPatient ? (
            <div className="flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-900 truncate">{selectedPatient.name}</p>
                <p className="text-xs text-blue-600">{selectedPatient.phone}</p>
              </div>
              {selectedPatient.status === 'PRE_CADASTRO' && (
                <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                  Pré-cadastro
                </span>
              )}
              {!appointment && (
                <button type="button" onClick={handleClearPatient} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                className="input-field pl-9"
                placeholder="Pesquisar paciente..."
                value={patientSearch}
                onChange={e => { setPatientSearch(e.target.value); setShowDropdown(true) }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              />
              {showDropdown && filteredPatients.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                  {filteredPatients.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={() => handleSelectPatient(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
                    >
                      <span className="font-medium text-slate-800 truncate">{p.name}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {errors.patientId && <p className="text-xs text-red-500 mt-1">{errors.patientId.message}</p>}
          {!selectedPatient && (
            <p className="text-xs text-slate-400 mt-1.5">
              Não encontrou?{' '}
              <button
                type="button"
                onClick={() => setShowPreRegModal(true)}
                className="text-cyan-600 hover:text-cyan-700 underline font-medium"
              >
                Criar pré-cadastro rápido
              </button>
            </p>
          )}
        </div>

        <div>
          <label className="label">Profissional *</label>
          <select
            {...register('doctorId')}
            className="input-field"
            disabled={
              currentUser?.role === 'DOCTOR' ||
              (currentUser?.role === 'SECRETARY' && doctors.length <= 1)
            }
          >
            <option value="">Selecione</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}{d.specialty ? ` — ${d.specialty}` : ''}
              </option>
            ))}
          </select>
          {errors.doctorId && <p className="text-xs text-red-500 mt-1">{errors.doctorId.message}</p>}
        </div>
      </div>

      <div>
        <label className="label">Título da consulta *</label>
        <input {...register('title')} className="input-field" placeholder="Ex: Consulta de rotina" />
        {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className="label">Data e Hora *</label>
          <input {...register('date')} type="datetime-local" className="input-field" />
          {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date.message}</p>}
        </div>

        <div>
          <label className="label">Duração</label>
          <select {...register('duration')} className="input-field">
            {DURATIONS.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Status</label>
        <select {...register('status')} className="input-field">
          <option value="SCHEDULED">Agendado</option>
          <option value="CONFIRMED">Confirmado</option>
          <option value="COMPLETED">Concluído</option>
          <option value="CANCELLED">Cancelado</option>
          <option value="NO_SHOW">Faltou</option>
        </select>
      </div>

      {/* ── Returns flow ── */}
      {showReturnsFlow && (
        <div className="rounded-xl border-2 border-violet-300 bg-violet-50 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-violet-100 border-b border-violet-200">
            <RefreshCw className="w-4 h-4 text-violet-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-violet-800">
              Deseja agendar retornos semanalmente?
            </p>
          </div>

          <div className="px-4 py-3 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setWantsReturns(true)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                  wantsReturns === true
                    ? 'bg-violet-600 border-violet-600 text-white shadow-md'
                    : 'bg-white border-violet-300 text-violet-700 hover:border-violet-500'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                SIM
              </button>
              <button
                type="button"
                onClick={() => setWantsReturns(false)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                  wantsReturns === false
                    ? 'bg-slate-600 border-slate-600 text-white shadow-md'
                    : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                <X className="w-3.5 h-3.5" />
                NÃO
              </button>
            </div>

            {wantsReturns === true && (
              <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-2 duration-200">
                <p className="text-xs font-semibold text-violet-700">
                  Quantos retornos o paciente tem direito?
                </p>
                <div className="flex flex-wrap gap-2">
                  {RETURN_OPTIONS.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReturnsCount(n)}
                      className={`w-14 h-10 rounded-xl text-sm font-bold border-2 transition-all ${
                        returnsCount === n
                          ? 'bg-violet-600 border-violet-600 text-white shadow-md scale-105'
                          : 'bg-white border-violet-200 text-violet-700 hover:border-violet-400'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    placeholder="Outro"
                    value={RETURN_OPTIONS.includes(returnsCount) ? '' : returnsCount}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      if (!isNaN(v) && v >= 1 && v <= 50) setReturnsCount(v)
                    }}
                    className="w-20 h-10 rounded-xl border-2 border-violet-200 text-sm text-center font-semibold text-violet-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-violet-100 rounded-lg">
                  <RefreshCw className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                  <p className="text-xs text-violet-700">
                    Serão criados <strong>{returnsCount} agendamentos</strong> semanais a partir da data selecionada.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="label">Observações</label>
        <textarea
          {...register('notes')}
          rows={3}
          className="input-field resize-none"
          placeholder="Anotações sobre a consulta..."
        />
      </div>

      {/* Hidden repeatCount field */}
      <input {...register('repeatCount')} type="hidden" />

      <div className="flex items-center gap-3 pt-2">
        {appointment && (
          <button
            type="button"
            onClick={() => setShowNotifyModal(true)}
            className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2"
          >
            <Bell className="w-4 h-4" />
            Notificar
          </button>
        )}
        {appointment && !appointment.billedAt && !appointment.transaction && (
          <button
            type="button"
            onClick={() => setShowCobrancaModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2"
          >
            <DollarSign className="w-4 h-4" />
            Cobrar
          </button>
        )}
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Salvando...
            </span>
          ) : appointment
            ? 'Atualizar Consulta'
            : wantsReturns === true
              ? `Agendar ${returnsCount} Consultas`
              : 'Agendar Consulta'
          }
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="btn-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </form>

    <PreRegisterModal
      isOpen={showPreRegModal}
      onClose={() => setShowPreRegModal(false)}
      onCreated={handlePatientCreated}
    />

    {appointment && showCobrancaModal && (
      <CobrancaModal
        isOpen={showCobrancaModal}
        onClose={() => setShowCobrancaModal(false)}
        appointment={appointment}
        patientPlan={primaryPlan}
        discountPercent={primaryPlan?.healthPlan?.discountPercent ?? 0}
        onCharged={() => {
          setShowCobrancaModal(false)
          onCharged?.()
        }}
      />
    )}
    {appointment && showNotifyModal && (
      <NotificarPacienteModal
        isOpen={showNotifyModal}
        onClose={() => setShowNotifyModal(false)}
        appointmentId={appointment.id}
        patientName={appointment.patient.name}
        patientPhone={appointment.patient.phone ?? undefined}
      />
    )}
    </>
  )
}
