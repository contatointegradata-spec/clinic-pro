<script setup lang="ts">
import { ref, reactive, computed, type Component } from 'vue'
import { format, differenceInYears, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Plus, Search, Phone, Mail, Edit2, Users, Calendar, UserCircle2,
  AlertTriangle, CheckCircle2, Clock, UserX, CheckCheck, ChevronRight,
  Download, ShieldOff,
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import type { Patient, PatientStatus } from '../types'
import Modal from '../components/ui/Modal.vue'
import PatientForm from '../components/Patients/PatientForm.vue'
import { SkeletonTable } from '../components/ui'
import PageHeader from '../components/ui/PageHeader.vue'
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

function handleEdit(p: Patient) {
  editPatient.value = p
  modalOpen.value = true
}

function handleNew() {
  editPatient.value = null
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editPatient.value = null
}

// ─── LGPD — exportar / anonimizar ──────────────────────────────────────────

async function exportPatient(p: Patient) {
  try {
    const res = await api.get(`/patients/${p.id}/export`)
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `paciente-${p.id}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Dados exportados')
  } catch {
    toast.error('Erro ao exportar dados do paciente')
  }
}

const anonymizeTarget = ref<Patient | null>(null)
const anonymizing = ref(false)

function confirmAnonymize(p: Patient) {
  anonymizeTarget.value = p
}

async function doAnonymize() {
  if (!anonymizeTarget.value) return
  anonymizing.value = true
  try {
    await api.post(`/patients/${anonymizeTarget.value.id}/anonymize`)
    toast.success('Dados pessoais do paciente foram anonimizados')
    anonymizeTarget.value = null
    await refetch()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao anonimizar paciente')
  } finally {
    anonymizing.value = false
  }
}

async function handleFormSubmit(data: Record<string, unknown>) {
  saving.value = true
  try {
    const { consent, ...patientData } = data as Record<string, unknown> & {
      consent?: { channel: string; termsVersion: string }
    }

    if (editPatient.value) {
      await api.put(`/patients/${editPatient.value.id}`, patientData)
    } else {
      const res = await api.post('/patients', patientData)
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

async function handleCompleteSubmit() {
  if (!completePatient.value) return
  completeSaving.value = true
  try {
    await api.post(`/patients/${completePatient.value.id}/complete-registration`, {
      ...completeForm,
      email: completeForm.email || undefined,
      cpf: completeForm.cpf || undefined,
      birthDate: completeForm.birthDate || undefined,
    })
    toast.success('Cadastro finalizado! Paciente agora ATIVO.')
    await refetch()
    closeCompleteModal()
  } catch (err: unknown) {
    const error = err as { response?: { data?: { message?: string } } }
    toast.error(error.response?.data?.message || 'Erro ao finalizar cadastro')
  } finally {
    completeSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Pacientes" subtitle="Gerencie o cadastro de pacientes">
      <template #actions>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Novo Paciente
        </button>
      </template>
    </PageHeader>

    <!-- ── Status filter tabs ── -->
    <div class="card py-3 px-4">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="tab in FILTER_TABS" :key="tab.key"
          class="px-3 py-1.5 rounded-xl text-sm font-medium transition-all border"
          :class="statusFilter === tab.key
            ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'"
          @click="statusFilter = tab.key"
        >
          {{ tab.label }}
          <span
            v-if="tab.key === 'PRE_CADASTRO' && counts.PRE_CADASTRO > 0"
            class="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-bold"
            :class="statusFilter === 'PRE_CADASTRO' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'"
          >
            {{ counts.PRE_CADASTRO }}
          </span>
          <span
            v-if="tab.key === 'INCOMPLETO' && counts.INCOMPLETO > 0"
            class="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-bold"
            :class="statusFilter === 'INCOMPLETO' ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700'"
          >
            {{ counts.INCOMPLETO }}
          </span>
        </button>
      </div>
    </div>

    <!-- ── Search + count ── -->
    <div class="card py-4">
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            v-model="search"
            placeholder="Buscar por nome, CPF ou telefone..."
            class="input-field pl-9"
            autocomplete="off"
          />
          <button
            v-if="search"
            class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                   bg-slate-200 hover:bg-slate-300 flex items-center justify-center
                   transition-colors duration-150 text-slate-500"
            @click="search = ''"
          >
            <span class="text-xs leading-none">×</span>
          </button>
        </div>
        <div class="flex items-center gap-2 text-sm text-slate-500 bg-slate-50
                    px-3 py-2 rounded-xl border border-slate-200 flex-shrink-0">
          <Users class="w-4 h-4 text-slate-400" />
          <span>
            <strong class="text-slate-800 font-bold tabular-nums">{{ patients.length }}</strong>
            paciente{{ patients.length !== 1 ? 's' : '' }}
          </span>
        </div>
      </div>
    </div>

    <!-- ── Desktop Table ── -->
    <div class="card p-0 overflow-hidden hidden sm:block animate-stagger-3">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Paciente</th>
              <th class="table-head-cell">Contato</th>
              <th class="table-head-cell hidden lg:table-cell">Status</th>
              <th class="table-head-cell hidden lg:table-cell">CPF</th>
              <th class="table-head-cell">Idade</th>
              <th class="table-head-cell">Consultas</th>
              <th class="table-head-cell hidden md:table-cell">Cadastro</th>
              <th class="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td colspan="8" class="p-0">
                <SkeletonTable :rows="6" :cols="7" />
              </td>
            </tr>
            <tr v-else-if="patients.length === 0">
              <td colspan="8">
                <div class="empty-state">
                  <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 animate-float">
                    <Users class="w-8 h-8 text-slate-300" />
                  </div>
                  <p class="text-slate-600 font-semibold">Nenhum paciente encontrado</p>
                  <p class="text-slate-400 text-sm mt-1">
                    {{ search ? `Sem resultados para "${search}"` : 'Comece cadastrando um paciente' }}
                  </p>
                  <button v-if="!search" class="mt-4 btn-primary text-xs" @click="handleNew">
                    <Plus class="w-3.5 h-3.5" />
                    Cadastrar Paciente
                  </button>
                </div>
              </td>
            </tr>
            <tr
              v-for="(p, idx) in patients" :key="p.id"
              class="table-row group cursor-pointer"
              :style="{ animationDelay: `${idx * 0.03}s` }"
              @click="handleEdit(p)"
            >
              <td class="table-cell">
                <div class="flex items-center gap-3">
                  <div
                    class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                    :class="isPreCad(p)
                      ? 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-amber-400/20'
                      : 'bg-gradient-to-br from-primary-400 to-primary-600 shadow-primary-400/20'"
                  >
                    <span class="text-white text-xs font-bold">{{ initials(p.name) }}</span>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <p class="font-semibold text-slate-900 text-sm group-hover:text-primary-700 transition-colors duration-150">
                        {{ p.name }}
                      </p>
                    </div>
                    <div v-if="isPreCad(p)" class="w-32 mt-1">
                      <div class="flex items-center gap-2">
                        <div class="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div class="h-full rounded-full transition-all" :class="progressColor(calcProgress(p))" :style="{ width: `${calcProgress(p)}%` }" />
                        </div>
                        <span class="text-xs text-slate-500 tabular-nums w-8 text-right">{{ calcProgress(p) }}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </td>
              <td class="table-cell">
                <div class="space-y-1">
                  <div class="flex items-center gap-1.5 text-sm text-slate-600">
                    <Phone class="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                    {{ maskPhone(p.phone) }}
                  </div>
                  <div v-if="p.email" class="flex items-center gap-1.5 text-xs text-slate-400">
                    <Mail class="w-3 h-3 text-slate-300 flex-shrink-0" />
                    <span class="truncate max-w-[140px]">{{ p.email }}</span>
                  </div>
                </div>
              </td>
              <td class="table-cell hidden lg:table-cell">
                <span
                  class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border"
                  :class="STATUS_COLORS[p.status ?? 'ATIVO']"
                >
                  <component :is="STATUS_ICONS[p.status ?? 'ATIVO']" class="w-3 h-3" />
                  {{ STATUS_LABELS[p.status ?? 'ATIVO'] }}
                </span>
              </td>
              <td class="table-cell font-mono text-slate-500 text-xs hidden lg:table-cell">
                {{ maskCpf(p.cpf) }}
              </td>
              <td class="table-cell">
                <span v-if="ageOf(p) !== null" class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                  {{ ageOf(p) }} anos
                </span>
                <template v-else>–</template>
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-1.5">
                  <Calendar class="w-3.5 h-3.5 text-slate-300" />
                  <span class="font-bold text-slate-700 tabular-nums">{{ p._count?.appointments ?? 0 }}</span>
                  <span class="text-slate-400 text-xs">consultas</span>
                </div>
              </td>
              <td class="table-cell text-slate-400 text-xs hidden md:table-cell tabular-nums">
                {{ format(new Date(p.createdAt), 'dd/MM/yyyy', { locale: ptBR }) }}
              </td>
              <td class="table-cell" @click.stop>
                <div class="flex items-center gap-1">
                  <button
                    v-if="isPreCad(p)"
                    class="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all flex items-center gap-1"
                    title="Finalizar cadastro"
                    @click="openCompleteModal(p)"
                  >
                    <CheckCheck class="w-3 h-3" />
                    Finalizar
                  </button>
                  <button
                    class="p-1.5 text-slate-300 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all duration-150 active:scale-90"
                    title="Editar"
                    @click="handleEdit(p)"
                  >
                    <Edit2 class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="p-1.5 text-slate-300 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all duration-150 active:scale-90"
                    title="Exportar dados (LGPD)"
                    @click="exportPatient(p)"
                  >
                    <Download class="w-3.5 h-3.5" />
                  </button>
                  <button
                    v-if="!p.anonymizedAt"
                    class="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-150 active:scale-90"
                    title="Anonimizar dados (LGPD)"
                    @click="confirmAnonymize(p)"
                  >
                    <ShieldOff class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- LGPD — confirmação de anonimização -->
    <Modal
      :is-open="!!anonymizeTarget"
      title="Anonimizar dados do paciente"
      subtitle="Essa ação não pode ser desfeita"
      size="sm"
      @close="anonymizeTarget = null"
    >
      <p class="text-sm text-slate-600 leading-relaxed">
        Nome, CPF, telefone, RG, endereço e dados do responsável de
        <strong>{{ anonymizeTarget?.name }}</strong> serão apagados e substituídos por
        dados anônimos. Agendamentos, prontuário e histórico financeiro
        <strong>continuam intactos</strong> (guarda clínica tem prazo legal próprio),
        só deixam de estar vinculados a um paciente identificável.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" :disabled="anonymizing" @click="anonymizeTarget = null">Cancelar</button>
          <button class="btn-danger" :disabled="anonymizing" @click="doAnonymize">
            {{ anonymizing ? 'Anonimizando...' : 'Confirmar anonimização' }}
          </button>
        </div>
      </template>
    </Modal>

    <!-- ── Mobile Cards ── -->
    <div class="sm:hidden space-y-3 animate-stagger-3">
      <template v-if="isLoading">
        <div v-for="i in 4" :key="i" class="card flex items-center gap-3 py-4" :style="{ animationDelay: `${(i - 1) * 0.05}s` }">
          <div class="skeleton-circle w-12 h-12 flex-shrink-0" />
          <div class="flex-1 space-y-2">
            <div class="skeleton-text w-3/4" />
            <div class="skeleton-text w-1/2" />
          </div>
        </div>
      </template>
      <div v-else-if="patients.length === 0" class="card empty-state">
        <UserCircle2 class="w-12 h-12 text-slate-200 mb-3" />
        <p class="text-slate-500 font-medium">Nenhum paciente encontrado</p>
        <button v-if="!search" class="mt-3 btn-primary text-xs" @click="handleNew">
          <Plus class="w-3.5 h-3.5" />
          Cadastrar
        </button>
      </div>
      <template v-else>
        <div
          v-for="(p, idx) in patients" :key="p.id"
          class="card-hover"
          :style="{ animationDelay: `${idx * 0.04}s` }"
          @click="handleEdit(p)"
        >
          <div class="flex items-start gap-3 py-1">
            <div
              class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
              :class="isPreCad(p)
                ? 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-amber-400/30'
                : 'bg-gradient-to-br from-primary-400 to-primary-600 shadow-primary-400/30'"
            >
              <span class="text-white text-sm font-bold">{{ initials(p.name) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-0.5">
                <p class="font-semibold text-slate-900 truncate">{{ p.name }}</p>
                <span
                  class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border"
                  :class="STATUS_COLORS[p.status ?? 'ATIVO']"
                >
                  <component :is="STATUS_ICONS[p.status ?? 'ATIVO']" class="w-3 h-3" />
                  {{ STATUS_LABELS[p.status ?? 'ATIVO'] }}
                </span>
              </div>
              <p class="text-xs text-slate-400 flex items-center gap-1">
                <Phone class="w-3 h-3" />
                {{ maskPhone(p.phone) }}
                <span v-if="ageOf(p) !== null" class="ml-1">· {{ ageOf(p) }} anos</span>
              </p>
              <div v-if="isPreCad(p)" class="mt-2 w-full">
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all" :class="progressColor(calcProgress(p))" :style="{ width: `${calcProgress(p)}%` }" />
                  </div>
                  <span class="text-xs text-slate-500 tabular-nums w-8 text-right">{{ calcProgress(p) }}%</span>
                </div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1 flex-shrink-0">
              <span class="text-xs text-slate-400 flex items-center gap-1">
                <Calendar class="w-3 h-3" />
                {{ p._count?.appointments ?? 0 }}
              </span>
              <ChevronRight class="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>
          <div v-if="isPreCad(p)" class="mt-2 pt-2 border-t border-slate-100" @click.stop>
            <button
              class="w-full text-center text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg py-1.5 transition-all flex items-center justify-center gap-1"
              @click="openCompleteModal(p)"
            >
              <CheckCheck class="w-3 h-3" />
              Finalizar Cadastro
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- ── Edit/New Modal ── -->
    <Modal
      :is-open="modalOpen"
      :title="editPatient ? 'Editar Paciente' : 'Novo Paciente'"
      size="lg"
      @close="closeModal"
    >
      <PatientForm
        :patient="editPatient"
        :loading="saving"
        @submit="handleFormSubmit"
      />
    </Modal>

    <!-- ── Complete Registration Modal ── -->
    <Modal
      :is-open="!!completePatient"
      :title="`Finalizar Cadastro — ${completePatient?.name}`"
      size="lg"
      @close="closeCompleteModal"
    >
      <form v-if="completePatient" class="space-y-4" @submit.prevent="handleCompleteSubmit">
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
  </div>
</template>
