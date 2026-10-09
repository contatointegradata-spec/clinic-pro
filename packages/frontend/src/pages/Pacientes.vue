<script setup lang="ts">
import { ref, reactive, computed, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { format, differenceInYears, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Plus, Search, Phone, Users, UserCircle2, AlertTriangle, CheckCircle2, Clock, UserX, CheckCheck,
  ChevronRight, GitMerge, MessageCircle, FileSpreadsheet, Cake, CalendarClock, FileText,
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import type { Patient, PatientStatus, PatientDuplicateGroup } from '../types'
import Modal from '../components/ui/Modal.vue'
import PatientForm from '../components/Patients/PatientForm.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import BirthdaysPanel from '../components/patient/BirthdaysPanel.vue'
import ReturnsPanel from '../components/clinical/ReturnsPanel.vue'
import PlansPanel from '../components/clinical/PlansPanel.vue'
import { useQuery } from '../composables/useQuery'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PatientStatus, string> = {
  PRE_CADASTRO: 'Pré-cadastro',
  ATIVO: 'Ativo',
  INCOMPLETO: 'Incompleto',
  INATIVO: 'Inativo',
}

const STATUS_COLORS: Record<PatientStatus, string> = {
  PRE_CADASTRO: 'bg-amber-100 text-amber-700 border-amber-200',
  ATIVO: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  INCOMPLETO: 'bg-orange-100 text-orange-700 border-orange-200',
  INATIVO: 'bg-slate-100 text-slate-500 border-slate-200',
}

const STATUS_ICONS: Record<PatientStatus, Component> = {
  PRE_CADASTRO: AlertTriangle,
  ATIVO: CheckCircle2,
  INCOMPLETO: Clock,
  INATIVO: UserX,
}

function calcProgress(p: Patient): number {
  const fields = [p.name, p.phone, p.email, p.birthDate, p.cpf, p.rg, p.address, p.responsibleName]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

function progressColor(value: number): string {
  return value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-400'
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function ageOf(p: Patient): number | null {
  return p.birthDate ? differenceInYears(new Date(), parseISO(p.birthDate)) : null
}

// LGPD — mascarar CPF/telefone na listagem. O valor completo continua
// disponível no cadastro/edição do paciente, pra quem precisa ligar ou
// confirmar o documento — aqui é só pra não deixar exposto numa tela que
// pode ficar aberta/visível pra quem passa pela recepção.
function maskCpf(cpf?: string | null): string {
  if (!cpf) return '–'
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return '***'
  return `***.***.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function maskPhone(phone?: string | null): string {
  if (!phone) return '–'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `•••••${digits.slice(-4)}`
}

// Lead criado só com o LID do WhatsApp: o "phone" não é um telefone de verdade.
function maskPatientPhone(p: Patient): string {
  if (p.whatsappLid && !p.phoneKey) return 'WhatsApp (sem nº)'
  return maskPhone(p.phone)
}

function lastVisitText(p: Patient): string | null {
  const last = (p as Patient & { appointments?: Array<{ date: string }> }).appointments?.[0]?.date
  if (!last) return null
  return `${format(new Date(last), 'dd/MM/yyyy')} · ${formatDistanceToNow(new Date(last), { locale: ptBR, addSuffix: true })}`
}

function whatsappHref(p: Patient): string | null {
  if (p.whatsappLid && !p.phoneKey) return null
  let d = (p.phone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  if (d.length <= 11) d = `55${d}`
  return `https://wa.me/${d}`
}

function isPreCad(p: Patient): boolean {
  return p.status === 'PRE_CADASTRO' || p.status === 'INCOMPLETO'
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterKey = 'TODOS' | PatientStatus

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'ATIVO', label: 'Ativos' },
  { key: 'PRE_CADASTRO', label: 'Pré-cadastro' },
  { key: 'INCOMPLETO', label: 'Incompletos' },
  { key: 'INATIVO', label: 'Inativos' },
]

// ─── State ────────────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()

type ListTab = 'pacientes' | 'aniversariantes' | 'retornos' | 'orcamentos'
const LIST_TABS: { key: ListTab; label: string; icon: Component }[] = [
  { key: 'pacientes', label: 'Pacientes', icon: Users },
  { key: 'aniversariantes', label: 'Aniversariantes', icon: Cake },
  { key: 'retornos', label: 'Retornos', icon: CalendarClock },
  { key: 'orcamentos', label: 'Orçamentos', icon: FileText },
]
const listTab = ref<ListTab>(LIST_TABS.some(t => t.key === route.query.aba) ? route.query.aba as ListTab : 'pacientes')
watch(listTab, v => router.replace({ query: { ...route.query, aba: v === 'pacientes' ? undefined : v } }))

const modalOpen = ref(false)
const editPatient = ref<Patient | null>(null)
const completePatient = ref<Patient | null>(null)
const search = ref('')
const statusFilter = ref<FilterKey>('TODOS')
const saving = ref(false)

const queryKey = computed(() => `patients:${search.value}:${statusFilter.value}`)

const { data: patientsData, isLoading, refetch } = useQuery<Patient[]>({
  key: queryKey,
  queryFn: () => api.get('/patients', {
    params: {
      ...(search.value ? { search: search.value } : {}),
      ...(statusFilter.value !== 'TODOS' ? { status: statusFilter.value } : {}),
    },
  }).then(r => r.data),
})
const patients = computed(() => patientsData.value ?? [])

const counts = computed(() => {
  const all = patients.value
  return {
    PRE_CADASTRO: all.filter(p => p.status === 'PRE_CADASTRO').length,
    INCOMPLETO: all.filter(p => p.status === 'INCOMPLETO').length,
  }
})

function handleNew() {
  editPatient.value = null
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editPatient.value = null
}

// ─── Duplicidade por telefone ────────────────────────────────────────────────
// Backend devolve 409 PATIENT_DUPLICATE quando já existe alguém com o mesmo
// telefone e nome parecido. Telefone igual com nome diferente (família) é
// permitido — só vem `sharedPhoneWith` pra avisar.

type DuplicateBrief = { id: string; name: string; phone: string; status: PatientStatus }
type ApiError = { response?: { status?: number; data?: { message?: string; code?: string; duplicateOf?: DuplicateBrief; canMerge?: boolean } } }

const duplicatePrompt = ref<{
  duplicateOf: DuplicateBrief
  mode: 'form' | 'complete'
  retry: () => Promise<void>
} | null>(null)
const duplicateBusy = ref(false)

function getDuplicate(err: unknown): DuplicateBrief | null {
  const e = err as ApiError
  if (e.response?.status === 409 && e.response.data?.code === 'PATIENT_DUPLICATE' && e.response.data.duplicateOf) {
    return e.response.data.duplicateOf
  }
  return null
}

function warnSharedPhone(res: { data?: { sharedPhoneWith?: Array<{ name: string }> } }) {
  const shared = res.data?.sharedPhoneWith ?? []
  if (shared.length) toast(`Telefone compartilhado com ${shared.map(s => s.name).join(', ')}.`, { duration: 6000 })
}

async function openPatientById(id: string) {
  try {
    const { data } = await api.get<Patient>(`/patients/${id}`)
    if (isPreCad(data)) openCompleteModal(data)
    else router.push(`/pacientes/${id}`)
  } catch {
    toast.error('Paciente não encontrado')
  }
}

function openPatient(p: Patient) {
  router.push(`/pacientes/${p.id}`)
}

async function useExistingDuplicate() {
  const dup = duplicatePrompt.value?.duplicateOf
  duplicatePrompt.value = null
  closeModal()
  closeCompleteModal()
  if (dup) await openPatientById(dup.id)
}

async function confirmDuplicateAnyway() {
  const prompt = duplicatePrompt.value
  if (!prompt) return
  duplicateBusy.value = true
  try {
    await prompt.retry()
    duplicatePrompt.value = null
  } finally {
    duplicateBusy.value = false
  }
}

// "Finalizar" um pré-cadastro que é de alguém já cadastrado → mescla no existente
async function mergeIntoDuplicate() {
  const prompt = duplicatePrompt.value
  const drop = completePatient.value
  if (!prompt || !drop) return
  duplicateBusy.value = true
  try {
    await api.post(`/patients/${prompt.duplicateOf.id}/merge`, { dropId: drop.id })
    toast.success(`Pré-cadastro mesclado em ${prompt.duplicateOf.name}`)
    duplicatePrompt.value = null
    closeCompleteModal()
    await refetch()
  } catch (err: unknown) {
    toast.error((err as ApiError).response?.data?.message || 'Erro ao mesclar pacientes')
  } finally {
    duplicateBusy.value = false
  }
}

async function handleFormSubmit(data: Record<string, unknown>, confirmDuplicate = false) {
  saving.value = true
  try {
    const { consent, ...rest } = data as Record<string, unknown> & {
      consent?: { channel: string; termsVersion: string }
    }
    const patientData = confirmDuplicate ? { ...rest, confirmDuplicate: true } : rest

    if (editPatient.value) {
      const res = await api.put(`/patients/${editPatient.value.id}`, patientData)
      warnSharedPhone(res)
    } else {
      const res = await api.post('/patients', patientData)
      warnSharedPhone(res)
      // Consentimento é um registro à parte (histórico próprio) — só faz
      // sentido no cadastro, quando a tela pergunta o canal.
      if (consent) {
        await api.post(`/patients/${res.data.id}/consent`, consent).catch(err => {
          console.error('[consent] falha ao registrar consentimento:', err)
          toast.error('Paciente salvo, mas houve um erro ao registrar o consentimento LGPD.')
        })
      }
    }
    toast.success(editPatient.value ? 'Paciente atualizado!' : 'Paciente cadastrado!')
    closeModal()
    await refetch()
  } catch (err: unknown) {
    const dup = getDuplicate(err)
    if (dup && !confirmDuplicate) {
      duplicatePrompt.value = { duplicateOf: dup, mode: 'form', retry: () => handleFormSubmit(data, true) }
      return
    }
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao salvar paciente')
  } finally {
    saving.value = false
  }
}

// ─── Complete registration ─────────────────────────────────────────────────────

const completeForm = reactive({
  email: '',
  birthDate: '',
  cpf: '',
  rg: '',
  address: '',
  responsibleName: '',
  responsiblePhone: '',
  notes: '',
})
const completeSaving = ref(false)

function openCompleteModal(p: Patient) {
  completePatient.value = p
  completeForm.email = p.email ?? ''
  completeForm.birthDate = p.birthDate ? p.birthDate.substring(0, 10) : ''
  completeForm.cpf = p.cpf ?? ''
  completeForm.rg = p.rg ?? ''
  completeForm.address = p.address ?? ''
  completeForm.responsibleName = p.responsibleName ?? ''
  completeForm.responsiblePhone = p.responsiblePhone ?? ''
  completeForm.notes = p.notes ?? ''
}

function closeCompleteModal() {
  completePatient.value = null
}

const completePending = computed(() => {
  const p = completePatient.value
  if (!p) return []
  return [
    !p.email && 'E-mail',
    !p.birthDate && 'Data de nascimento',
    !p.cpf && 'CPF',
    !p.rg && 'RG',
    !p.address && 'Endereço',
  ].filter(Boolean) as string[]
})

const completeProgress = computed(() => (completePatient.value ? calcProgress(completePatient.value) : 0))

async function handleCompleteSubmit(confirmDuplicate = false) {
  if (!completePatient.value) return
  completeSaving.value = true
  try {
    await api.post(`/patients/${completePatient.value.id}/complete-registration`, {
      ...completeForm,
      email: completeForm.email || undefined,
      cpf: completeForm.cpf || undefined,
      birthDate: completeForm.birthDate || undefined,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
    })
    toast.success('Cadastro finalizado! Paciente agora ATIVO.')
    await refetch()
    closeCompleteModal()
  } catch (err: unknown) {
    const dup = getDuplicate(err)
    if (dup && !confirmDuplicate) {
      duplicatePrompt.value = { duplicateOf: dup, mode: 'complete', retry: () => handleCompleteSubmit(true) }
      return
    }
    const error = err as { response?: { data?: { message?: string } } }
    toast.error(error.response?.data?.message || 'Erro ao finalizar cadastro')
  } finally {
    completeSaving.value = false
  }
}

// ─── Possíveis duplicados (mesmo telefone + nome parecido) ───────────────────

const duplicatesOpen = ref(false)
const { data: duplicatesData, refetch: refetchDuplicates } = useQuery<PatientDuplicateGroup[]>({
  key: 'patients-duplicates',
  queryFn: () => api.get('/patients/duplicates', { params: { kind: 'same_name' } }).then(r => r.data),
})
const duplicateGroups = computed(() => duplicatesData.value ?? [])
const keepChoice = reactive<Record<string, string>>({})
const mergingId = ref<string | null>(null)

function keepIdFor(g: PatientDuplicateGroup): string {
  return keepChoice[g.phoneKey] ?? g.patients[0]?.id
}

async function mergeFromGroup(g: PatientDuplicateGroup, dropId: string) {
  const keepId = keepIdFor(g)
  const keep = g.patients.find(p => p.id === keepId)
  const drop = g.patients.find(p => p.id === dropId)
  if (!keep || !drop) return
  if (!window.confirm(`Mesclar "${drop.name}" em "${keep.name}"? Consultas, prontuário, financeiro e conversas passam para "${keep.name}" e o outro cadastro é removido.`)) return
  mergingId.value = dropId
  try {
    await api.post(`/patients/${keepId}/merge`, { dropId })
    toast.success('Pacientes mesclados')
    await Promise.all([refetchDuplicates(), refetch()])
  } catch (err: unknown) {
    toast.error((err as ApiError).response?.data?.message || 'Erro ao mesclar pacientes')
  } finally {
    mergingId.value = null
  }
}

// ─── /pacientes?patient=<id> (links do Atendimento) ─────────────────────────
// Abre direto o paciente: pré-cadastro → "Finalizar cadastro"; senão a edição.

watch(
  () => route.query.patient,
  async (id) => {
    if (typeof id !== 'string' || !id) return
    await openPatientById(id)
    const { patient: _omit, ...query } = route.query
    router.replace({ query })
  },
  { immediate: true },
)

// ─── Exportar lista (Excel / CSV) ──────────────────────────────────────────

function exportRows() {
  return patients.value.map(p => ({
    Nome: p.name,
    Telefone: p.phone ?? '',
    'E-mail': p.email ?? '',
    CPF: p.cpf ?? '',
    Nascimento: p.birthDate ? format(parseISO(p.birthDate), 'dd/MM/yyyy') : '',
    Status: STATUS_LABELS[p.status ?? 'ATIVO'],
    'Última consulta': (p as Patient & { appointments?: Array<{ date: string }> }).appointments?.[0]?.date
      ? format(new Date((p as Patient & { appointments: Array<{ date: string }> }).appointments[0].date), 'dd/MM/yyyy')
      : '',
    'Cadastrado em': format(new Date(p.createdAt), 'dd/MM/yyyy'),
  }))
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportCsv() {
  const rows = exportRows()
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [headers.map(esc).join(';'), ...rows.map(r => headers.map(h => esc((r as Record<string, string>)[h])).join(';'))].join('\r\n')
  download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `pacientes-${format(new Date(), 'yyyy-MM-dd')}.csv`)
}

const exporting = ref(false)
async function exportXlsx() {
  const rows = exportRows()
  if (!rows.length) return
  exporting.value = true
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Pacientes')
    const headers = Object.keys(rows[0])
    ws.columns = headers.map(h => ({ header: h, key: h, width: Math.max(14, h.length + 4) }))
    ws.addRows(rows)
    ws.getRow(1).font = { bold: true }
    const buf = await wb.xlsx.writeBuffer()
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `pacientes-${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  } catch {
    toast.error('Não foi possível gerar o Excel')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <PageHeader title="Pacientes">
      <template #actions>
        <button
          v-if="duplicateGroups.length > 0"
          class="btn-secondary"
          title="Pacientes com o mesmo telefone e nome parecido"
          @click="duplicatesOpen = true"
        >
          <GitMerge class="w-4 h-4" />
          <span class="hidden sm:inline">Possíveis duplicados</span> ({{ duplicateGroups.length }})
        </button>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Cadastrar paciente
        </button>
      </template>
    </PageHeader>

    <div class="card p-0">
      <!-- Abas -->
      <nav class="px-3 sm:px-5 border-b border-slate-100 overflow-x-auto scrollbar-none" role="tablist">
        <div class="flex gap-1 min-w-max">
          <button
            v-for="t in LIST_TABS" :key="t.key" role="tab" :aria-selected="listTab === t.key"
            :class="['relative inline-flex items-center gap-2 px-3.5 py-3.5 text-sm font-medium transition-colors', listTab === t.key ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800']"
            @click="listTab = t.key"
          >
            <component :is="t.icon" class="w-4 h-4" />
            {{ t.label }}
            <span v-if="listTab === t.key" class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />
          </button>
        </div>
      </nav>

      <div class="p-4 sm:p-6">
        <!-- ── PACIENTES ── -->
        <template v-if="listTab === 'pacientes'">
          <div class="flex flex-col sm:flex-row gap-3">
            <div class="relative flex-1">
              <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input v-model="search" placeholder="Busque por nome, telefone, CPF ou e-mail" class="input-field pl-10 py-3" autocomplete="off" />
            </div>
            <select v-model="statusFilter" class="input-field sm:w-52 py-3" aria-label="Filtrar por situação">
              <option v-for="tab in FILTER_TABS" :key="tab.key" :value="tab.key">
                {{ tab.key === 'TODOS' ? 'Todas as situações' : tab.label }}{{ tab.key === 'PRE_CADASTRO' && counts.PRE_CADASTRO ? ` (${counts.PRE_CADASTRO})` : '' }}
              </option>
            </select>
          </div>

          <!-- Lista -->
          <div class="mt-5">
            <div class="hidden md:grid grid-cols-[minmax(0,1fr)_150px_190px_28px] gap-4 px-4 pb-2 text-xs font-semibold text-slate-500">
              <span>Nome</span><span>CPF</span><span>Telefone</span><span />
            </div>

            <div v-if="isLoading && !patients.length" class="space-y-2"><div v-for="i in 5" :key="i" class="h-[72px] skeleton" /></div>

            <div v-else-if="patients.length === 0" class="py-14 text-center">
              <UserCircle2 class="w-12 h-12 mx-auto text-slate-200 mb-3" />
              <p class="text-slate-600 font-medium">{{ search ? 'Nenhuma paciente encontrada' : 'Nenhuma paciente cadastrada' }}</p>
              <button v-if="!search" class="mt-4 btn-primary text-sm" @click="handleNew"><Plus class="w-4 h-4" /> Cadastrar paciente</button>
            </div>

            <ul v-else class="space-y-2">
              <li
                v-for="p in patients" :key="p.id"
                class="group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_150px_190px_28px] items-center gap-4 rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 cursor-pointer transition-all hover:border-primary-200 hover:shadow-sm"
                role="link" tabindex="0"
                @click="openPatient(p)" @keydown.enter="openPatient(p)"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <div :class="['w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-semibold', isPreCad(p) ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700']">
                    {{ initials(p.name) }}
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-slate-900 truncate flex items-center gap-2">
                      {{ p.name }}
                      <span v-if="p.status !== 'ATIVO'" :class="['text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', STATUS_COLORS[p.status ?? 'ATIVO']]">{{ STATUS_LABELS[p.status ?? 'ATIVO'] }}</span>
                    </p>
                    <p class="text-xs text-slate-500 truncate">
                      <template v-if="lastVisitText(p)">Última consulta: {{ lastVisitText(p) }}</template>
                      <template v-else-if="ageOf(p) !== null">{{ ageOf(p) }} anos · sem consultas concluídas</template>
                      <template v-else>Sem consultas concluídas</template>
                    </p>
                  </div>
                </div>
                <span class="hidden md:block text-sm text-slate-600 tabular-nums">{{ maskCpf(p.cpf) }}</span>
                <div class="hidden md:flex items-center gap-2 text-sm text-slate-600" @click.stop>
                  <a v-if="whatsappHref(p)" :href="whatsappHref(p)!" target="_blank" rel="noopener" class="p-1 -m-1 rounded text-emerald-600 hover:bg-emerald-50" title="Abrir no WhatsApp"><MessageCircle class="w-4 h-4" /></a>
                  <Phone v-else class="w-4 h-4 text-slate-300" />
                  <span class="tabular-nums">{{ maskPatientPhone(p) }}</span>
                </div>
                <div class="flex items-center justify-end">
                  <button
                    v-if="isPreCad(p)"
                    class="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1"
                    title="Finalizar cadastro"
                    @click.stop="openCompleteModal(p)"
                  >
                    <CheckCheck class="w-3 h-3" /> Finalizar
                  </button>
                  <ChevronRight v-else class="w-4 h-4 text-slate-300 group-hover:text-primary-500 transition-colors" />
                </div>
              </li>
            </ul>

            <div v-if="patients.length" class="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-slate-500">
              <span>Mostrando {{ patients.length }} paciente{{ patients.length !== 1 ? 's' : '' }}</span>
              <span class="flex items-center gap-3">
                Baixar lista:
                <button class="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline" :disabled="exporting" @click="exportXlsx"><FileSpreadsheet class="w-4 h-4" /> Excel</button>
                <button class="inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline" @click="exportCsv"><FileSpreadsheet class="w-4 h-4" /> CSV</button>
              </span>
            </div>
          </div>
        </template>

        <BirthdaysPanel v-else-if="listTab === 'aniversariantes'" />
        <ReturnsPanel v-else-if="listTab === 'retornos'" />
        <PlansPanel v-else-if="listTab === 'orcamentos'" />
      </div>
    </div>

    <!-- ── Edit/New Modal ── -->
    <Modal
      :is-open="modalOpen"
      :title="editPatient ? 'Editar paciente' : 'Cadastrar paciente'"
      size="lg"
      @close="closeModal"
    >
      <PatientForm
        :patient="editPatient"
        :loading="saving"
        @submit="(d) => handleFormSubmit(d)"
      />
    </Modal>

    <!-- ── Complete Registration Modal ── -->
    <Modal
      :is-open="!!completePatient"
      :title="`Finalizar Cadastro — ${completePatient?.name}`"
      size="lg"
      @close="closeCompleteModal"
    >
      <form v-if="completePatient" class="space-y-4" @submit.prevent="handleCompleteSubmit()">
        <div class="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-4 h-4 text-amber-600" />
            <p class="text-sm font-semibold text-amber-800">Cadastro incompleto — {{ completeProgress }}% preenchido</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all" :class="progressColor(completeProgress)" :style="{ width: `${completeProgress}%` }" />
            </div>
            <span class="text-xs text-slate-500 tabular-nums w-8 text-right">{{ completeProgress }}%</span>
          </div>
          <p v-if="completePending.length > 0" class="text-xs text-amber-700">Campos pendentes: {{ completePending.join(', ') }}</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">E-mail</label>
            <input v-model="completeForm.email" class="input-field" type="email" placeholder="email@exemplo.com" />
          </div>
          <div>
            <label class="label">Nascimento</label>
            <input v-model="completeForm.birthDate" class="input-field" type="date" />
          </div>
          <div>
            <label class="label">CPF</label>
            <input v-model="completeForm.cpf" class="input-field" placeholder="000.000.000-00" />
          </div>
          <div>
            <label class="label">RG</label>
            <input v-model="completeForm.rg" class="input-field" placeholder="RG" />
          </div>
        </div>
        <div>
          <label class="label">Endereço</label>
          <input v-model="completeForm.address" class="input-field" placeholder="Rua, número, bairro..." />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Responsável</label>
            <input v-model="completeForm.responsibleName" class="input-field" placeholder="Nome do responsável" />
          </div>
          <div>
            <label class="label">Tel. responsável</label>
            <input v-model="completeForm.responsiblePhone" class="input-field" placeholder="(11) 99999-9999" />
          </div>
        </div>
        <div>
          <label class="label">Observações</label>
          <textarea v-model="completeForm.notes" class="input-field resize-none" rows="2" />
        </div>
        <div class="flex gap-3 pt-2">
          <button type="submit" :disabled="completeSaving" class="btn-primary flex-1">
            <template v-if="completeSaving">Finalizando...</template>
            <template v-else>
              <CheckCheck class="w-4 h-4" /> Finalizar Cadastro
            </template>
          </button>
          <button type="button" class="btn-secondary" @click="closeCompleteModal">Cancelar</button>
        </div>
      </form>
    </Modal>

    <!-- ── Aviso de duplicidade (409) ── -->
    <Modal
      :is-open="!!duplicatePrompt"
      title="Paciente já cadastrado?"
      size="sm"
      @close="duplicatePrompt = null"
    >
      <div v-if="duplicatePrompt" class="space-y-2 text-sm text-slate-600">
        <p>
          Já existe <strong>{{ duplicatePrompt.duplicateOf.name }}</strong>
          ({{ STATUS_LABELS[duplicatePrompt.duplicateOf.status] ?? duplicatePrompt.duplicateOf.status }})
          com esse telefone.
        </p>
        <p class="text-xs text-slate-400">
          Se for outra pessoa que usa o mesmo número (ex.: filho, cônjuge), continue mesmo assim.
        </p>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            v-if="duplicatePrompt?.mode === 'complete'"
            class="btn-primary"
            :disabled="duplicateBusy"
            @click="mergeIntoDuplicate"
          >
            <GitMerge class="w-4 h-4" /> Mesclar com o existente
          </button>
          <button v-else class="btn-primary" :disabled="duplicateBusy" @click="useExistingDuplicate">
            Usar existente
          </button>
          <button class="btn-secondary" :disabled="duplicateBusy" @click="confirmDuplicateAnyway">
            {{ duplicatePrompt?.mode === 'complete' ? 'Finalizar mesmo assim' : 'Cadastrar mesmo assim' }}
          </button>
        </div>
      </template>
    </Modal>

    <!-- ── Possíveis duplicados ── -->
    <Modal
      :is-open="duplicatesOpen"
      title="Possíveis duplicados"
      subtitle="Mesmo telefone e nome parecido — escolha o cadastro que fica e mescle os outros"
      size="lg"
      @close="duplicatesOpen = false"
    >
      <div v-if="duplicateGroups.length === 0" class="text-sm text-slate-500 py-6 text-center">
        Nenhum possível duplicado encontrado.
      </div>
      <div v-else class="space-y-4">
        <div v-for="g in duplicateGroups" :key="g.phoneKey" class="border border-slate-200 rounded-xl overflow-hidden">
          <div class="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex items-center gap-1.5">
            <Phone class="w-3 h-3" /> {{ maskPhone(g.patients[0]?.phone) }}
          </div>
          <div class="divide-y divide-slate-100">
            <label
              v-for="p in g.patients" :key="p.id"
              class="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
            >
              <input
                type="radio"
                :name="`keep-${g.phoneKey}`"
                :checked="keepIdFor(g) === p.id"
                class="text-primary-600"
                @change="keepChoice[g.phoneKey] = p.id"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">{{ p.name }}</p>
                <p class="text-xs text-slate-400">
                  {{ STATUS_LABELS[p.status] }} · {{ p.appointments }} consulta(s) ·
                  desde {{ format(new Date(p.createdAt), 'dd/MM/yyyy', { locale: ptBR }) }}
                </p>
              </div>
              <span v-if="keepIdFor(g) === p.id" class="text-xs font-medium text-emerald-700">Manter</span>
              <button
                v-else
                type="button"
                class="px-2 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg flex items-center gap-1"
                :disabled="mergingId === p.id"
                @click.prevent="mergeFromGroup(g, p.id)"
              >
                <GitMerge class="w-3 h-3" />
                {{ mergingId === p.id ? 'Mesclando...' : 'Mesclar' }}
              </button>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>
