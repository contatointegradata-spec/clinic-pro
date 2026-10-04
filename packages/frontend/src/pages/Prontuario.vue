<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import PageHeader from '../components/ui/PageHeader.vue'
import { useAuthStore } from '../stores/auth'
import type { Patient, User as UserType, GroupedMedicalRecord, MedicalRecord, AppointmentType, HealthPlan } from '../types'
import Modal from '../components/ui/Modal.vue'
import SpecialtyRecordView from '../components/prontuario/SpecialtyRecordView.vue'
import LancarFinanceiroModal from '../components/prontuario/LancarFinanceiroModal.vue'
import { useQuery } from '../composables/useQuery'

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
  queixaPrincipal: z.string().optional(),
  historiaDoencaAtual: z.string().optional(),
  antecedentesPessoais: z.string().optional(),
  antecedentesFamiliares: z.string().optional(),
  habitosVida: z.string().optional(),
  exameFisico: z.string().optional(),
  hipoteseDiagnostica: z.string().optional(),
})

type FormData = z.infer<typeof schema>

// Seções do formulário de Anamnese — mesma ordem usada na exibição.
const ANAMNESE_SECTIONS: { key: keyof FormData; label: string; placeholder: string }[] = [
  { key: 'queixaPrincipal', label: 'Queixa Principal', placeholder: 'Motivo da consulta, nas palavras do paciente...' },
  { key: 'historiaDoencaAtual', label: 'História da Doença Atual', placeholder: 'Evolução dos sintomas, início, características...' },
  { key: 'antecedentesPessoais', label: 'Antecedentes Pessoais', placeholder: 'Doenças prévias, cirurgias, alergias, medicações em uso...' },
  { key: 'antecedentesFamiliares', label: 'Antecedentes Familiares', placeholder: 'Doenças relevantes na família...' },
  { key: 'habitosVida', label: 'Hábitos de Vida', placeholder: 'Tabagismo, álcool, atividade física, sono...' },
  { key: 'exameFisico', label: 'Exame Físico', placeholder: 'Achados do exame físico...' },
  { key: 'hipoteseDiagnostica', label: 'Hipótese Diagnóstica / Conduta', placeholder: 'Hipóteses e conduta inicial...' },
]

interface ProcedureEntry {
  appointmentTypeId?: string
  name: string
  valorTabelado: number
  valorPago: number
}

function typeConfigFor(type: string) {
  return recordTypeConfig[type] || recordTypeConfig.OUTROS
}

function formatRecordDate(date: string) {
  return format(new Date(date), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
}

function formatValorPago(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function specialtyGeral(record: MedicalRecord) {
  return record.specialtyData as { objetivoClinico?: string; sintese?: string; encaminhamento?: string } | null | undefined
}

type AnamneseData = Partial<Record<'queixaPrincipal' | 'historiaDoencaAtual' | 'antecedentesPessoais' | 'antecedentesFamiliares' | 'habitosVida' | 'exameFisico' | 'hipoteseDiagnostica', string>>

function specialtyAnamnese(record: MedicalRecord) {
  return record.specialtyData as AnamneseData | null | undefined
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

const authStore = useAuthStore()
const user = computed(() => authStore.user)
const canEdit = computed(() => user.value?.role === 'ADMIN' || user.value?.role === 'DOCTOR')

const search = ref('')
const selectedPatient = ref<Patient | null>(null)
const expandedIds = reactive(new Set<string>())

function toggleExpanded(id: string) {
  if (expandedIds.has(id)) expandedIds.delete(id)
  else expandedIds.add(id)
}

function selectPatient(p: Patient) {
  selectedPatient.value = p
}

// ─── Queries ────────────────────────────────────────────────────────────────

const patientsKey = computed(() => `patients:${search.value}`)
const { data: patientsData } = useQuery<Patient[]>({
  key: patientsKey,
  queryFn: () => api.get('/patients', { params: search.value ? { search: search.value } : {} }).then(r => r.data),
})
const patients = computed(() => patientsData.value ?? [])

const { data: doctorsData } = useQuery<UserType[]>({
  key: 'doctors',
  queryFn: () => api.get('/doctors').then(r => r.data),
})
const doctors = computed(() => doctorsData.value ?? [])

const { data: appointmentTypesData } = useQuery<AppointmentType[]>({
  key: 'appointment-types',
  queryFn: () => api.get('/appointment-types').then(r => r.data),
})
const appointmentTypes = computed(() => appointmentTypesData.value ?? [])

const { data: healthPlansData } = useQuery<HealthPlan[]>({
  key: 'health-plans',
  queryFn: () => api.get('/health-plans').then(r => r.data),
})
const healthPlans = computed(() => healthPlansData.value ?? [])

const groupedKey = computed(() => `prontuario-${selectedPatient.value?.id ?? ''}`)
const groupedEnabled = computed(() => !!selectedPatient.value)
const groupedQuery = useQuery<GroupedMedicalRecord[]>({
  key: groupedKey,
  queryFn: () => api.get(`/medical-records/by-patient/${selectedPatient.value!.id}`).then(r => r.data),
  enabled: groupedEnabled,
})
const grouped = computed(() => groupedQuery.data.value ?? [])

const totalRecords = computed(() => grouped.value.reduce((acc, g) => acc + g.records.length, 0))

// ─── Formulário único de registro (criação e edição) ────────────────────────

function defaultFormState(): FormData {
  return {
    patientId: '',
    doctorId: user.value?.role === 'DOCTOR' ? user.value.id : '',
    type: 'EVOLUCAO',
    date: format(new Date(), 'yyyy-MM-dd'),
    title: '',
    objetivoClinico: '',
    sintese: '',
    encaminhamento: '',
    queixaPrincipal: '',
    historiaDoencaAtual: '',
    antecedentesPessoais: '',
    antecedentesFamiliares: '',
    habitosVida: '',
    exameFisico: '',
    hipoteseDiagnostica: '',
  }
}

const form = reactive<FormData>(defaultFormState())
const errors = reactive<Partial<Record<keyof FormData, string>>>({})
const procedures = ref<ProcedureEntry[]>([])
const selectedProcedureTypeId = ref('')

const formModalOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingRecordId = ref<string | null>(null)
const savingRecord = ref(false)

function resetFormErrors() {
  errors.patientId = undefined
  errors.doctorId = undefined
  errors.type = undefined
  errors.title = undefined
  errors.date = undefined
  errors.objetivoClinico = undefined
  errors.sintese = undefined
  errors.encaminhamento = undefined
  for (const s of ANAMNESE_SECTIONS) errors[s.key] = undefined
}

function openCreateModal() {
  formMode.value = 'create'
  editingRecordId.value = null
  Object.assign(form, defaultFormState(), { patientId: selectedPatient.value?.id || '' })
  procedures.value = []
  selectedProcedureTypeId.value = ''
  resetFormErrors()
  formModalOpen.value = true
}

function openEditModal(record: MedicalRecord) {
  formMode.value = 'edit'
  editingRecordId.value = record.id
  const geral = record.specialtyType === 'GERAL' ? specialtyGeral(record) : null
  const anamnese = record.specialtyType === 'ANAMNESE' ? specialtyAnamnese(record) : null
  form.patientId = record.patientId
  form.doctorId = record.doctorId
  form.type = record.type === 'SISTEMA' ? 'OUTROS' : record.type
  form.date = format(new Date(record.date), 'yyyy-MM-dd')
  form.title = record.title
  form.objetivoClinico = geral?.objetivoClinico ?? ''
  form.sintese = geral?.sintese ?? ''
  form.encaminhamento = geral?.encaminhamento ?? ''
  for (const s of ANAMNESE_SECTIONS) (form[s.key] as string) = anamnese?.[s.key as keyof AnamneseData] ?? ''
  procedures.value = (record.procedures ?? []).map(p => ({
    appointmentTypeId: p.appointmentTypeId ?? undefined,
    name: p.name,
    valorTabelado: p.valorTabelado,
    valorPago: p.valorPago,
  }))
  selectedProcedureTypeId.value = ''
  resetFormErrors()
  formModalOpen.value = true
}

function closeFormModal() {
  formModalOpen.value = false
}

const selectedPatientForForm = computed(() => patients.value.find(p => p.id === form.patientId))
const healthPlanForForm = computed(() => {
  const primaryPlanId = selectedPatientForForm.value?.patientPlans?.[0]?.healthPlanId
  return healthPlans.value.find(hp => hp.id === primaryPlanId) ?? null
})

function suggestedValueFor(typeId: string) {
  const override = healthPlanForForm.value?.procedures?.find(p => p.appointmentTypeId === typeId)
  if (override) return override.value
  const type = appointmentTypes.value.find(t => t.id === typeId)
  return type?.baseValue ?? 0
}

function addProcedure() {
  const type = appointmentTypes.value.find(t => t.id === selectedProcedureTypeId.value)
  if (!type) return
  const value = suggestedValueFor(selectedProcedureTypeId.value)
  procedures.value.push({ appointmentTypeId: type.id, name: type.name, valorTabelado: value, valorPago: value })
  selectedProcedureTypeId.value = ''
}

function updateProcedureField(index: number, field: 'valorTabelado' | 'valorPago', value: number) {
  const entry = procedures.value[index]
  if (!entry) return
  entry[field] = value
}

function removeProcedure(index: number) {
  procedures.value.splice(index, 1)
}

function onProcedureInput(index: number, field: 'valorTabelado' | 'valorPago', event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value) || 0
  updateProcedureField(index, field, value)
}

async function submitForm() {
  resetFormErrors()
  const parsed = schema.safeParse({
    patientId: form.patientId,
    doctorId: form.doctorId,
    type: form.type,
    title: form.title,
    date: form.date,
    objetivoClinico: form.objetivoClinico,
    sintese: form.sintese,
    encaminhamento: form.encaminhamento,
    queixaPrincipal: form.queixaPrincipal,
    historiaDoencaAtual: form.historiaDoencaAtual,
    antecedentesPessoais: form.antecedentesPessoais,
    antecedentesFamiliares: form.antecedentesFamiliares,
    habitosVida: form.habitosVida,
    exameFisico: form.exameFisico,
    hipoteseDiagnostica: form.hipoteseDiagnostica,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  const payload = { ...parsed.data, procedures: procedures.value }
  savingRecord.value = true
  try {
    if (formMode.value === 'edit' && editingRecordId.value) {
      await api.put(`/medical-records/${editingRecordId.value}`, payload)
      toast.success('Prontuário atualizado!')
    } else {
      await api.post('/medical-records', payload)
      toast.success('Prontuário registrado!')
    }
    formModalOpen.value = false
    await groupedQuery.refetch()
  } catch {
    toast.error(formMode.value === 'edit' ? 'Erro ao atualizar prontuário' : 'Erro ao salvar prontuário')
  } finally {
    savingRecord.value = false
  }
}

// ─── Lançar financeiro ───────────────────────────────────────────────────────

const launchingRecord = ref<MedicalRecord | null>(null)

function canLaunchFinance(record: MedicalRecord) {
  const procs = record.procedures ?? []
  return canEdit.value && procs.length > 0 && !record.billedAt
}

async function handleCharged() {
  await groupedQuery.refetch()
  launchingRecord.value = null
}
</script>

<template>
  <div class="space-y-4 page-stagger">
    <PageHeader
      title="Prontuário Eletrônico"
      subtitle="Registros médicos organizados por paciente"
    />

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-[min(600px,70vh)]">
      <!-- Patient list -->
      <div class="card p-0 overflow-hidden flex flex-col">
        <div class="p-4 border-b border-slate-100">
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              v-model="search"
              placeholder="Buscar paciente..."
              class="input-field pl-9 py-2 text-sm"
            />
          </div>
        </div>
        <div class="overflow-y-auto flex-1 scrollbar-none">
          <div v-if="patients.length === 0" class="empty-state py-8">
            <User class="w-8 h-8 text-slate-200 mb-2" />
            <p class="text-slate-400 text-sm">Nenhum paciente encontrado</p>
          </div>
          <template v-else>
            <button
              v-for="p in patients"
              :key="p.id"
              class="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-100 transition-all duration-150 relative"
              :class="selectedPatient?.id === p.id ? 'bg-blue-50' : 'hover:bg-slate-50/70'"
              @click="selectPatient(p)"
            >
              <!-- Active indicator -->
              <div
                class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full transition-all duration-200"
                :class="selectedPatient?.id === p.id ? 'h-8 bg-blue-600' : 'h-0 bg-transparent'"
              />
              <div
                class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all duration-200"
                :class="selectedPatient?.id === p.id ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-105' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
              >
                {{ initials(p.name) }}
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm font-semibold truncate transition-colors duration-150"
                  :class="selectedPatient?.id === p.id ? 'text-blue-700' : 'text-slate-900'"
                >{{ p.name }}</p>
                <p class="text-xs text-slate-400 truncate">{{ p.phone }}</p>
              </div>
              <ChevronRight
                class="w-4 h-4 flex-shrink-0 transition-all duration-200"
                :class="selectedPatient?.id === p.id ? 'text-blue-500 translate-x-0 opacity-100' : 'text-slate-300 -translate-x-1 opacity-0'"
              />
            </button>
          </template>
        </div>
      </div>

      <!-- Records panel -->
      <div class="xl:col-span-2 card p-0 overflow-hidden flex flex-col">
        <div v-if="!selectedPatient" class="empty-state flex-1">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 animate-float">
            <ClipboardList class="w-8 h-8 text-slate-300" />
          </div>
          <p class="text-slate-500 font-semibold">Selecione um paciente</p>
          <p class="text-slate-400 text-sm mt-1">para visualizar seu prontuário</p>
        </div>

        <div v-else-if="selectedPatient.status === 'PRE_CADASTRO'" class="empty-state flex-1">
          <div class="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
            <AlertTriangle class="w-8 h-8 text-amber-400" />
          </div>
          <p class="text-slate-700 font-semibold">Cadastro pendente</p>
          <p class="text-slate-400 text-sm mt-1 text-center max-w-xs">
            O prontuário de <strong>{{ selectedPatient.name }}</strong> não está disponível enquanto o cadastro não for finalizado.
          </p>
          <p class="text-xs text-amber-600 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Finalize o cadastro em Pacientes → Finalizar Cadastro
          </p>
        </div>

        <template v-else>
          <!-- Patient header -->
          <div class="p-5 border-b border-slate-200 bg-slate-50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span class="text-white text-sm font-bold">{{ initials(selectedPatient.name) }}</span>
                </div>
                <div>
                  <p class="font-semibold text-slate-900">{{ selectedPatient.name }}</p>
                  <p class="text-xs text-slate-500">{{ selectedPatient.phone }} · {{ totalRecords }} registros</p>
                </div>
              </div>
              <button
                v-if="grouped.length > 0"
                class="btn-primary text-xs py-2 animate-fade-in"
                @click="openCreateModal"
              >
                <Plus class="w-3.5 h-3.5" />
                Novo Registro
              </button>
            </div>
          </div>

          <!-- Records grouped by doctor -->
          <div class="overflow-y-auto flex-1 p-5 space-y-6 scrollbar-none">
            <div v-if="grouped.length === 0" class="empty-state">
              <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3 animate-float">
                <FileText class="w-7 h-7 text-slate-300" />
              </div>
              <p class="text-slate-500 font-semibold">Nenhum prontuário registrado</p>
              <button class="mt-4 btn-primary text-xs" @click="openCreateModal">
                <Plus class="w-3.5 h-3.5" />
                Criar primeiro registro
              </button>
            </div>

            <div v-for="group in grouped" :key="group.doctor.id" class="animate-slide-up">
              <div class="flex items-center gap-2 mb-3">
                <div class="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Stethoscope class="w-3.5 h-3.5 text-blue-600" />
                </div>
                <h3 class="font-semibold text-slate-900 text-sm">Dr(a). {{ group.doctor.name }}</h3>
                <span v-if="group.doctor.specialty" class="text-xs text-slate-400">· {{ group.doctor.specialty }}</span>
                <span class="ml-auto text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-semibold border border-blue-100">
                  {{ group.records.length }} registro{{ group.records.length !== 1 ? 's' : '' }}
                </span>
              </div>

              <div class="space-y-2 pl-5 border-l-2 border-blue-100">
                <div
                  v-for="record in group.records"
                  :key="record.id"
                  class="border rounded-2xl overflow-hidden transition-all duration-250"
                  :class="expandedIds.has(record.id) ? 'border-blue-200 shadow-md shadow-blue-50' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'"
                >
                  <button
                    class="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150"
                    :class="expandedIds.has(record.id) ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'"
                    @click="toggleExpanded(record.id)"
                  >
                    <span
                      class="text-base w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200"
                      :class="[typeConfigFor(record.type).bg, expandedIds.has(record.id) ? 'scale-110' : '']"
                    >{{ typeConfigFor(record.type).icon }}</span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p
                          class="font-semibold text-sm transition-colors duration-150"
                          :class="expandedIds.has(record.id) ? 'text-blue-800' : 'text-slate-900'"
                        >{{ record.title }}</p>
                        <span
                          class="text-xs px-2 py-0.5 rounded-full font-semibold"
                          :class="[typeConfigFor(record.type).bg, typeConfigFor(record.type).color]"
                        >{{ typeConfigFor(record.type).label }}</span>
                        <span
                          v-if="record.billedAt"
                          class="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium"
                        >
                          <CheckCircle2 class="w-3 h-3" />
                          Lançado
                        </span>
                      </div>
                      <p class="text-xs text-slate-400 mt-0.5">{{ formatRecordDate(record.date) }}</p>
                    </div>
                    <div
                      class="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-250 ease-spring"
                      :class="expandedIds.has(record.id) ? 'bg-blue-100 text-blue-600 rotate-180' : 'bg-slate-100 text-slate-400'"
                    >
                      <ChevronDown class="w-3.5 h-3.5" />
                    </div>
                  </button>

                  <div v-if="expandedIds.has(record.id)" class="px-4 pb-4 pt-3 border-t border-blue-100/70 bg-blue-50/30 animate-slide-in">
                    <div v-if="record.specialtyType === 'GERAL' && record.specialtyData" class="space-y-3">
                      <div v-if="specialtyGeral(record)?.objetivoClinico">
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Objetivo Clínico</p>
                        <p class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{{ specialtyGeral(record)?.objetivoClinico }}</p>
                      </div>
                      <div v-if="specialtyGeral(record)?.sintese">
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Síntese</p>
                        <p class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{{ specialtyGeral(record)?.sintese }}</p>
                      </div>
                      <div v-if="specialtyGeral(record)?.encaminhamento">
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Encaminhamento</p>
                        <p class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{{ specialtyGeral(record)?.encaminhamento }}</p>
                      </div>
                    </div>
                    <div v-else-if="record.specialtyType === 'ANAMNESE' && record.specialtyData" class="space-y-3">
                      <template v-for="section in ANAMNESE_SECTIONS" :key="section.key">
                        <div v-if="specialtyAnamnese(record)?.[section.key as keyof AnamneseData]">
                          <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{{ section.label }}</p>
                          <p class="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{{ specialtyAnamnese(record)?.[section.key as keyof AnamneseData] }}</p>
                        </div>
                      </template>
                    </div>
                    <SpecialtyRecordView
                      v-else-if="record.specialtyData && record.specialtyType"
                      :specialty-type="record.specialtyType"
                      :data="record.specialtyData"
                    />
                    <p v-else class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{{ record.content }}</p>

                    <div v-if="(record.procedures ?? []).length > 0" class="mt-4 border-t border-blue-100 pt-3">
                      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Procedimentos</p>
                      <div class="space-y-1.5">
                        <div v-for="p in record.procedures" :key="p.id" class="flex items-center justify-between text-sm">
                          <span class="text-slate-700 flex items-center gap-2">
                            {{ p.name }}
                            <span v-if="p.valorPago === 0" class="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Cortesia</span>
                          </span>
                          <span class="font-medium text-slate-800">{{ formatValorPago(p.valorPago) }}</span>
                        </div>
                      </div>
                    </div>

                    <div v-if="canEdit" class="flex justify-end gap-2 mt-4">
                      <button
                        v-if="canLaunchFinance(record)"
                        class="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-95 border border-transparent hover:border-emerald-100"
                        @click="launchingRecord = record"
                      >
                        <DollarSign class="w-3.5 h-3.5" />
                        Lançar Financeiro
                      </button>
                      <button
                        class="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition-all duration-150 active:scale-95 border border-transparent hover:border-blue-100"
                        @click="openEditModal(record)"
                      >
                        <Pencil class="w-3.5 h-3.5" />
                        Editar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Modal de criação/edição de registro -->
    <Modal
      :is-open="formModalOpen"
      :title="formMode === 'create' ? 'Novo Registro de Prontuário' : 'Editar Registro de Prontuário'"
      size="lg"
      @close="closeFormModal"
    >
      <form class="space-y-4" @submit.prevent="submitForm">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Paciente *</label>
            <select v-model="form.patientId" class="input-field">
              <option value="">Selecione</option>
              <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <p v-if="errors.patientId" class="text-xs text-red-500 mt-1">{{ errors.patientId }}</p>
          </div>
          <div>
            <label class="label">Médico *</label>
            <select v-model="form.doctorId" class="input-field" :disabled="user?.role === 'DOCTOR'">
              <option value="">Selecione</option>
              <option v-for="d in doctors" :key="d.id" :value="d.id">Dr(a). {{ d.name }}</option>
            </select>
            <p v-if="errors.doctorId" class="text-xs text-red-500 mt-1">{{ errors.doctorId }}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Tipo *</label>
            <select v-model="form.type" class="input-field">
              <option v-for="[value, cfg] in MANUAL_RECORD_TYPES" :key="value" :value="value">{{ cfg.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">Data</label>
            <input v-model="form.date" type="date" class="input-field" />
          </div>
        </div>

        <div>
          <label class="label">Título *</label>
          <input v-model="form.title" class="input-field" placeholder="Ex: Consulta de retorno, Anamnese inicial..." />
          <p v-if="errors.title" class="text-xs text-red-500 mt-1">{{ errors.title }}</p>
        </div>

        <template v-if="form.type === 'ANAMNESE'">
          <div v-for="section in ANAMNESE_SECTIONS" :key="section.key">
            <label class="label">{{ section.label }}</label>
            <textarea
              v-model="(form[section.key] as string)"
              rows="3"
              class="input-field resize-none"
              :placeholder="section.placeholder"
            />
          </div>
        </template>
        <template v-else>
          <div>
            <label class="label">Objetivo Clínico</label>
            <textarea
              v-model="form.objetivoClinico"
              rows="3"
              class="input-field resize-none"
              placeholder="Objetivo do atendimento..."
            />
          </div>

          <div>
            <label class="label">Síntese</label>
            <textarea
              v-model="form.sintese"
              rows="3"
              class="input-field resize-none"
              placeholder="Síntese do que foi observado/discutido..."
            />
          </div>

          <div>
            <label class="label">Encaminhamento</label>
            <textarea
              v-model="form.encaminhamento"
              rows="2"
              class="input-field resize-none"
              placeholder="Encaminhamentos, orientações, próximos passos..."
            />
          </div>
        </template>

        <div>
          <label class="label flex items-center gap-1">
            <Stethoscope class="w-3.5 h-3.5 text-slate-400" />
            Procedimentos
          </label>

          <div v-if="procedures.length > 0" class="space-y-2 mb-3">
            <div class="grid grid-cols-[1fr,110px,110px,24px] gap-2 px-1">
              <span class="text-xs text-slate-400 font-medium">Procedimento</span>
              <span class="text-xs text-slate-400 font-medium">Valor tabelado</span>
              <span class="text-xs text-slate-400 font-medium">Valor pago</span>
              <span />
            </div>
            <div v-for="(p, idx) in procedures" :key="idx" class="grid grid-cols-[1fr,110px,110px,24px] gap-2 items-center">
              <span class="text-sm text-slate-700 truncate">{{ p.name }}</span>
              <input
                type="number" step="0.01" min="0"
                :value="p.valorTabelado"
                class="input-field text-sm py-1.5"
                @input="onProcedureInput(idx, 'valorTabelado', $event)"
              />
              <div>
                <input
                  type="number" step="0.01" min="0"
                  :value="p.valorPago"
                  class="input-field text-sm py-1.5"
                  @input="onProcedureInput(idx, 'valorPago', $event)"
                />
                <span v-if="p.valorPago === 0" class="text-[10px] text-amber-600 font-semibold">Cortesia</span>
              </div>
              <button type="button" class="text-slate-400 hover:text-red-600" @click="removeProcedure(idx)">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div v-if="appointmentTypes.length > 0" class="flex gap-2">
            <select v-model="selectedProcedureTypeId" class="input-field flex-1">
              <option value="">Selecione um procedimento</option>
              <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
            <button
              type="button"
              class="btn-secondary px-3 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              :disabled="!selectedProcedureTypeId"
              @click="addProcedure"
            >
              <Plus class="w-4 h-4" />
              Adicionar Procedimento
            </button>
          </div>
          <p v-else class="text-xs text-slate-400">Cadastre procedimentos em Configurações → Procedimento pra usá-los aqui.</p>
        </div>

        <button type="submit" :disabled="savingRecord" class="btn-primary w-full">
          <span v-if="savingRecord" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ formMode === 'create' ? 'Salvar Prontuário' : 'Salvar alterações' }}</template>
        </button>
      </form>
    </Modal>

    <LancarFinanceiroModal
      v-if="launchingRecord"
      :is-open="!!launchingRecord"
      :record="launchingRecord"
      @close="launchingRecord = null"
      @charged="handleCharged"
    />
  </div>
</template>
