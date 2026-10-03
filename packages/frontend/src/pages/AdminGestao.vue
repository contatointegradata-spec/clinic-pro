<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  Users, UserCheck, UserX, Stethoscope, Search, RefreshCw, ChevronDown,
  CheckCircle, AlertCircle, Shield, ChevronLeft, ChevronRight, Loader2, X,
} from 'lucide-vue-next'
import api from '../lib/api'
import toast from '../lib/toast'
import PageHeader from '../components/ui/PageHeader.vue'
import { useQuery } from '../composables/useQuery'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Doctor {
  id: string
  name: string
  email: string
  specialty: string | null
  _count: { patients: number; doctorAppointments: number; doctorTeam: number }
}

interface Patient {
  id: string
  name: string
  phone: string
  email: string | null
  cpf: string | null
  doctorId: string | null
  createdAt: string
  doctor: { id: string; name: string; specialty: string | null } | null
  _count: { appointments: number }
}

interface Overview {
  totalPatients: number
  assignedPatients: number
  orphanPatients: number
  totalDoctors: number
  totalSecretaries: number
}

interface MigrateResult {
  total: number
  assigned: number
  unassigned: number
  message: string
}

interface PaginatedPatients {
  data: Patient[]
  total: number
  page: number
  totalPages: number
}

const PAGE_SIZE = 20

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

// ─── State ────────────────────────────────────────────────────────────────────

const filter = ref<string>('all')
const searchInput = ref('')
const search = ref('')
const migrateResult = ref<MigrateResult | null>(null)
const page = ref(1)
const pendingPatientId = ref<string | null>(null)
const migrating = ref(false)

// Debounce search — 400ms, mirrors original useDebounce hook
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { search.value = val }, 400)
})
onBeforeUnmount(() => { if (debounceTimer) clearTimeout(debounceTimer) })

// Resetar página ao mudar filtro ou busca
watch([filter, search], () => { page.value = 1 })

// ── Queries ──
const {
  data: overview,
  isLoading: loadingOverview,
  error: errorOverview,
  refetch: refetchOverview,
} = useQuery<Overview>({
  key: 'admin-overview',
  queryFn: () => api.get<Overview>('/admin/overview').then(r => r.data),
})

const {
  data: doctorsData,
  error: errorDoctors,
  refetch: refetchDoctors,
} = useQuery<Doctor[]>({
  key: 'admin-doctors',
  queryFn: () => api.get<Doctor[]>('/admin/doctors').then(r => r.data),
})
const doctors = computed(() => doctorsData.value ?? [])

const patientsKey = computed(() => `admin-patients:${filter.value}:${search.value}:${page.value}`)
const {
  data: patientsResponse,
  isLoading: loadingPatients,
  error: errorPatients,
  refetch: refetchPatients,
} = useQuery<PaginatedPatients>({
  key: patientsKey,
  queryFn: () => {
    const params = new URLSearchParams()
    if (filter.value === 'orphans') params.set('orphans', 'true')
    else if (filter.value !== 'all') params.set('doctorId', filter.value)
    if (search.value) params.set('search', search.value)
    params.set('page', String(page.value))
    params.set('limit', String(PAGE_SIZE))
    return api.get<PaginatedPatients>(`/admin/patients?${params}`).then(r => r.data)
  },
})

const patients = computed(() => patientsResponse.value?.data ?? [])
const patientsTotal = computed(() => patientsResponse.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(patientsTotal.value / PAGE_SIZE)))
const pageStart = computed(() => (page.value - 1) * PAGE_SIZE + 1)
const pageEnd = computed(() => Math.min(page.value * PAGE_SIZE, patientsTotal.value))

// ── Mutations (manual — no cache invalidation layer, refetch after) ──

async function handleMigrate() {
  migrating.value = true
  try {
    const { data } = await api.post<MigrateResult>('/admin/migrate-patients')
    migrateResult.value = data
    await Promise.all([refetchOverview(), refetchPatients()])
    toast.success(`Migração concluída — ${data.assigned} paciente(s) atribuído(s).`)
  } catch {
    toast.error('Falha ao migrar pacientes. Tente novamente.')
  } finally {
    migrating.value = false
  }
}

async function handleAssign(patientId: string, doctorId: string | null) {
  pendingPatientId.value = patientId
  try {
    await api.patch(`/admin/patients/${patientId}/doctor`, { doctorId })
    await Promise.all([refetchPatients(), refetchOverview()])
    toast.success(doctorId ? 'Paciente atribuído com sucesso.' : 'Atribuição removida com sucesso.')
  } catch {
    toast.error('Falha ao atribuir paciente. Tente novamente.')
  } finally {
    pendingPatientId.value = null
  }
}

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
}

function clearFilters() {
  searchInput.value = ''
  search.value = ''
  filter.value = 'all'
}

// ── Nome do filtro ativo para badge ──
const activeFilterLabel = computed(() => {
  if (filter.value === 'all') return null
  if (filter.value === 'orphans') return 'Sem médico'
  return doctors.value.find(d => d.id === filter.value)?.name ?? null
})

function toggleDoctorFilter(doctorId: string) {
  filter.value = filter.value === doctorId ? 'all' : doctorId
}

// ── Assign dropdown (global single-open state, mirrors original fixed-position panel) ──

const openAssignPatientId = ref<string | null>(null)
const dropdownStyle = ref<Record<string, string>>({})
const PANEL_H = 260
const PANEL_W = 220

function positionDropdown(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom
  const top = spaceBelow >= PANEL_H ? r.bottom + 4 : Math.max(8, r.top - PANEL_H - 4)
  const right = window.innerWidth - r.right
  dropdownStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    right: `${Math.max(8, right)}px`,
    width: `${PANEL_W}px`,
    zIndex: '9999',
  }
}

function toggleAssignDropdown(patientId: string, e: MouseEvent) {
  if (openAssignPatientId.value === patientId) {
    openAssignPatientId.value = null
    return
  }
  positionDropdown(e.currentTarget as HTMLElement)
  openAssignPatientId.value = patientId
}

function onAssignPick(patientId: string, doctorId: string | null) {
  openAssignPatientId.value = null
  handleAssign(patientId, doctorId)
}

function handleDocumentMousedown(e: MouseEvent) {
  if (!openAssignPatientId.value) return
  const target = e.target as Node
  const panel = document.getElementById('admin-gestao-assign-panel')
  const trigger = document.getElementById(`admin-gestao-assign-trigger-${openAssignPatientId.value}`)
  if (panel?.contains(target) || trigger?.contains(target)) return
  openAssignPatientId.value = null
}

function handleWindowScroll() {
  if (openAssignPatientId.value) openAssignPatientId.value = null
}

document.addEventListener('mousedown', handleDocumentMousedown)
window.addEventListener('scroll', handleWindowScroll, true)
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMousedown)
  window.removeEventListener('scroll', handleWindowScroll, true)
})
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6 page-stagger">
    <PageHeader title="Gestão de Dados" subtitle="Controle de isolamento entre médicos e pacientes" />

    <!-- ── Stats cards ── -->
    <div v-if="errorOverview" class="alert-danger items-center justify-between gap-4">
      <div class="flex items-start gap-3">
        <AlertCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p>Não foi possível carregar o resumo. Verifique sua conexão.</p>
      </div>
      <button
        class="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        @click="refetchOverview"
      >
        <RefreshCw class="w-3.5 h-3.5" />
        Tentar novamente
      </button>
    </div>
    <div v-else class="grid grid-cols-2 md:grid-cols-5 gap-4">
      <template v-if="loadingOverview">
        <div v-for="i in 5" :key="i" class="card">
          <div class="skeleton w-8 h-8 rounded-lg mb-3" />
          <div class="skeleton-text w-12 h-7 mb-2" />
          <div class="skeleton-text w-20 h-3" />
        </div>
      </template>
      <template v-else>
        <div class="card">
          <div class="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center mb-3">
            <Users class="w-4 h-4 text-primary-600" />
          </div>
          <p class="text-2xl font-bold text-slate-900">{{ overview?.totalPatients ?? '—' }}</p>
          <p class="text-xs text-slate-400 mt-1">Total Pacientes</p>
        </div>
        <div class="card">
          <div class="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center mb-3">
            <UserCheck class="w-4 h-4 text-emerald-600" />
          </div>
          <p class="text-2xl font-bold text-slate-900">{{ overview?.assignedPatients ?? '—' }}</p>
          <p class="text-xs text-slate-400 mt-1">Atribuídos</p>
        </div>
        <div class="card">
          <div class="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center mb-3">
            <UserX class="w-4 h-4 text-amber-600" />
          </div>
          <p class="text-2xl font-bold text-slate-900">{{ overview?.orphanPatients ?? '—' }}</p>
          <p class="text-xs text-slate-400 mt-1">Sem médico</p>
        </div>
        <div class="card">
          <div class="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center mb-3">
            <Stethoscope class="w-4 h-4 text-violet-600" />
          </div>
          <p class="text-2xl font-bold text-slate-900">{{ overview?.totalDoctors ?? '—' }}</p>
          <p class="text-xs text-slate-400 mt-1">Médicos</p>
        </div>
        <div class="card">
          <div class="w-8 h-8 bg-cyan-50 rounded-lg flex items-center justify-center mb-3">
            <Users class="w-4 h-4 text-cyan-600" />
          </div>
          <p class="text-2xl font-bold text-slate-900">{{ overview?.totalSecretaries ?? '—' }}</p>
          <p class="text-xs text-slate-400 mt-1">Secretarias</p>
        </div>
      </template>
    </div>

    <!-- ── Migration banner ── -->
    <div v-if="(overview?.orphanPatients ?? 0) > 0 && !migrateResult" class="alert-warning items-center justify-between gap-4">
      <div class="flex items-start gap-3">
        <AlertCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <p class="font-medium">{{ overview?.orphanPatients }} paciente(s) sem médico vinculado</p>
          <p class="text-xs opacity-80 mt-1">
            Esses pacientes ficam invisíveis para todos os médicos. Migre automaticamente com base no histórico de agendamentos.
          </p>
        </div>
      </div>
      <button
        class="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
        :disabled="migrating"
        @click="handleMigrate"
      >
        <Loader2 v-if="migrating" class="w-4 h-4 animate-spin" />
        <RefreshCw v-else class="w-4 h-4" />
        Migrar automaticamente
      </button>
    </div>

    <!-- ── Migration result ── -->
    <div v-if="migrateResult" class="alert-success items-start gap-3">
      <CheckCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="font-medium">Migração concluída</p>
        <p class="text-xs opacity-80 mt-1">{{ migrateResult.message }}</p>
        <p v-if="migrateResult.unassigned > 0" class="text-xs text-amber-700 mt-1">
          {{ migrateResult.unassigned }} paciente(s) ainda sem médico — use a tabela abaixo para atribuição manual.
        </p>
      </div>
      <button class="opacity-50 hover:opacity-100 transition-opacity" @click="migrateResult = null">
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- ── Doctors section ── -->
    <section>
      <div class="flex items-center gap-2 mb-3 px-1">
        <Stethoscope class="w-4 h-4 text-violet-600" />
        <h2 class="text-sm font-semibold text-slate-900">Médicos Cadastrados</h2>
        <span class="ml-auto text-xs text-slate-400">{{ doctors.length }} médico(s)</span>
      </div>

      <div v-if="errorDoctors" class="alert-danger items-center justify-between gap-4">
        <p>Não foi possível carregar os médicos.</p>
        <button
          class="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          @click="refetchDoctors"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      </div>
      <div v-else class="card p-0 overflow-hidden">
        <div v-if="doctors.length === 0" class="empty-state">
          <p class="text-sm text-slate-400">Nenhum médico cadastrado</p>
        </div>
        <div v-else class="divide-y divide-slate-100">
          <div
            v-for="doc in doctors"
            :key="doc.id"
            class="px-5 py-3 flex items-center justify-between hover:bg-slate-50/80 transition-colors"
            :class="filter === doc.id ? 'bg-primary-50/50 border-l-2 border-l-primary-500' : ''"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-primary-50 rounded-full flex items-center justify-center flex-shrink-0">
                <span class="text-primary-600 text-xs font-bold">{{ initials(doc.name) }}</span>
              </div>
              <div>
                <p class="text-sm font-medium text-slate-900">{{ doc.name }}</p>
                <p class="text-xs text-slate-400">
                  {{ doc.email }}<template v-if="doc.specialty"> · {{ doc.specialty }}</template>
                </p>
              </div>
            </div>
            <div class="flex items-center gap-4 text-xs text-slate-500">
              <span class="hidden sm:flex items-center gap-1">
                <Users class="w-3.5 h-3.5" />
                {{ doc._count.patients }} pacientes
              </span>
              <span class="hidden md:flex items-center gap-1">
                <Stethoscope class="w-3.5 h-3.5" />
                {{ doc._count.doctorAppointments }} consultas
              </span>
              <span class="hidden md:flex items-center gap-1">
                <UserCheck class="w-3.5 h-3.5" />
                {{ doc._count.doctorTeam }} secret.
              </span>
              <button
                class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                :class="filter === doc.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                @click="toggleDoctorFilter(doc.id)"
              >
                {{ filter === doc.id ? 'Filtrado' : 'Filtrar' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Patients section ── -->
    <section>
      <div class="flex items-center gap-2 mb-3 px-1">
        <Users class="w-4 h-4 text-primary-600" />
        <h2 class="text-sm font-semibold text-slate-900">Pacientes</h2>
        <span v-if="activeFilterLabel" class="flex items-center gap-1 bg-primary-50 text-primary-700 text-xs font-medium px-2 py-0.5 rounded-full">
          {{ activeFilterLabel }}
          <button class="hover:text-primary-900 transition-colors ml-0.5" @click="filter = 'all'">
            <X class="w-3 h-3" />
          </button>
        </span>
        <span class="ml-auto text-xs text-slate-400">{{ patientsTotal }} resultado(s)</span>
      </div>

      <div class="card p-0 overflow-hidden">
        <!-- Toolbar -->
        <div class="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div class="relative flex-1 min-w-40">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <button
              v-if="searchInput"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
              @click="searchInput = ''"
            >
              <X class="w-3.5 h-3.5" />
            </button>
            <input
              v-model="searchInput"
              class="input-field pl-9 pr-8 py-1.5"
              placeholder="Buscar paciente…"
            />
          </div>
          <select v-model="filter" class="input-field w-auto py-1.5 text-sm">
            <option value="all">Todos</option>
            <option value="orphans">Sem médico</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>

        <!-- Body -->
        <div v-if="errorPatients" class="p-6">
          <div class="alert-danger items-center justify-between gap-4">
            <p>Não foi possível carregar os pacientes.</p>
            <button
              class="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              @click="refetchPatients"
            >
              <RefreshCw class="w-3.5 h-3.5" />
              Tentar novamente
            </button>
          </div>
        </div>
        <div v-else-if="loadingPatients" class="divide-y divide-slate-100">
          <div v-for="i in 8" :key="i" class="px-5 py-3 flex items-center justify-between">
            <div class="space-y-2">
              <div class="skeleton-text w-36 h-3.5" />
              <div class="skeleton-text w-52 h-2.5" />
            </div>
            <div class="flex items-center gap-3">
              <div class="skeleton w-24 h-5 rounded" />
              <div class="skeleton w-16 h-6 rounded-lg" />
            </div>
          </div>
        </div>
        <div v-else-if="patientsTotal === 0" class="empty-state">
          <Users class="w-8 h-8 text-slate-300 mb-3" />
          <p class="text-sm text-slate-400">Nenhum paciente encontrado</p>
          <button
            v-if="search || filter !== 'all'"
            class="mt-2 text-xs text-primary-600 hover:text-primary-700 underline transition-colors"
            @click="clearFilters"
          >
            Limpar filtros
          </button>
        </div>
        <template v-else>
          <div class="divide-y divide-slate-100">
            <div
              v-for="p in patients"
              :key="p.id"
              class="px-5 py-3 flex items-center justify-between hover:bg-slate-50/80 transition-colors gap-4"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900 truncate">{{ p.name }}</p>
                <p class="text-xs text-slate-400 truncate">
                  {{ p.phone }}<template v-if="p.cpf"> · CPF: {{ p.cpf }}</template>
                  ·
                  {{ p._count.appointments }} consulta(s)
                </p>
              </div>
              <div class="flex items-center gap-3 flex-shrink-0">
                <span v-if="p.doctor" class="text-xs text-emerald-600 flex items-center gap-1 max-w-36 truncate">
                  <CheckCircle class="w-3.5 h-3.5 flex-shrink-0" />
                  <span class="truncate">{{ p.doctor.name }}</span>
                </span>
                <span v-else class="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
                  Sem médico
                </span>

                <!-- Assign dropdown trigger -->
                <button
                  :id="`admin-gestao-assign-trigger-${p.id}`"
                  class="flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  :disabled="pendingPatientId === p.id"
                  @click="toggleAssignDropdown(p.id, $event)"
                >
                  <Loader2 v-if="pendingPatientId === p.id" class="w-3 h-3 animate-spin" />
                  <ChevronDown v-else class="w-3 h-3 transition-transform" :class="openAssignPatientId === p.id ? 'rotate-180' : ''" />
                  Atribuir
                </button>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <span class="text-xs text-slate-400">{{ pageStart }}–{{ pageEnd }} de {{ patientsTotal }} pacientes</span>
            <div class="flex items-center gap-2">
              <button
                class="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                :disabled="page === 1"
                @click="goToPage(page - 1)"
              >
                <ChevronLeft class="w-3.5 h-3.5" />
                Anterior
              </button>
              <span class="text-xs text-slate-400 px-1">Pág. {{ page }}/{{ totalPages }}</span>
              <button
                class="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                :disabled="page >= totalPages"
                @click="goToPage(page + 1)"
              >
                Próximo
                <ChevronRight class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- Floating assign dropdown panel (single instance, fixed-positioned next to its trigger) -->
    <Teleport to="body">
      <div
        v-if="openAssignPatientId"
        id="admin-gestao-assign-panel"
        class="bg-white border border-slate-200 rounded-xl shadow-2xl py-1"
        :style="dropdownStyle"
      >
        <div class="px-3 py-2 border-b border-slate-100">
          <p class="text-xs text-slate-500 font-medium truncate">
            {{ patients.find(p => p.id === openAssignPatientId)?.name }}
          </p>
        </div>
        <button
          class="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-slate-50 flex items-center gap-2 transition-colors"
          @click="onAssignPick(openAssignPatientId!, null)"
        >
          <UserX class="w-3.5 h-3.5" />
          Remover atribuição
        </button>
        <div class="border-t border-slate-100 my-1" />
        <div class="max-h-48 overflow-y-auto">
          <button
            v-for="d in doctors"
            :key="d.id"
            class="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors"
            :class="patients.find(p => p.id === openAssignPatientId)?.doctorId === d.id ? 'text-primary-600 font-semibold' : 'text-slate-600'"
            @click="onAssignPick(openAssignPatientId!, d.id)"
          >
            <span class="truncate">{{ d.name }}</span>
            <CheckCircle v-if="patients.find(p => p.id === openAssignPatientId)?.doctorId === d.id" class="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
