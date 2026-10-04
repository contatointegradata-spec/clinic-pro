<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import { format } from 'date-fns'
import { Trash2, Info, RefreshCw, Check, X, Search, Bell, DollarSign, Package, Plus } from 'lucide-vue-next'
import type { Appointment, User, Patient, AppointmentType, Room, AuthUser, AppointmentStatus, Product } from '../../types'
import PreRegisterModal from './PreRegisterModal.vue'
import NotificarPacienteModal from './NotificarPacienteModal.vue'
import CobrancaModal from '../Financial/CobrancaModal.vue'
import api from '../../lib/api'
import { useQuery } from '../../composables/useQuery'

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
  stockItems: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
  })).optional(),
})

export type AppointmentFormData = z.infer<typeof schema>

const props = defineProps<{
  appointment: Appointment | null
  defaultDate?: Date
  doctors: User[]
  patients: Patient[]
  appointmentTypes: AppointmentType[]
  rooms: Room[]
  currentUser: AuthUser | null
  loading: boolean
}>()

const emit = defineEmits<{
  submit: [data: AppointmentFormData]
  delete: []
  patientCreated: [patient: Patient]
  charged: []
}>()

const formData = reactive<{
  patientId: string
  doctorId: string
  title: string
  date: string
  duration: number
  status: AppointmentStatus
  notes: string
  roomId: string
  repeatCount: number
}>({
  patientId: '',
  doctorId: props.currentUser?.role === 'DOCTOR' ? props.currentUser.id : '',
  title: '',
  date: '',
  duration: 50,
  status: 'SCHEDULED',
  notes: '',
  roomId: '',
  repeatCount: 1,
})

const errors = ref<Partial<Record<keyof AppointmentFormData, string>>>({})

const showNotifyModal = ref(false)
const showCobrancaModal = ref(false)

// ── Produtos usados (baixa de estoque ao concluir) ──
// Só faz sentido oferecer quando o status está sendo mudado PRA concluído
// agora — se já estava concluído, o backend ignora stockItems de qualquer
// forma (não reprocessa baixa de uma consulta já finalizada).
const canUseStock = computed(() => formData.status === 'COMPLETED' && props.appointment?.status !== 'COMPLETED')

const { data: productsData } = useQuery<Product[]>({
  key: 'stock-products',
  queryFn: () => api.get('/stock/products').then(r => r.data),
  enabled: canUseStock,
})
const activeProducts = computed(() => (productsData.value ?? []).filter(p => p.active))

const stockRows = ref<{ productId: string; quantity: number }[]>([])

function addStockRow() {
  stockRows.value.push({ productId: '', quantity: 1 })
}
function removeStockRow(index: number) {
  stockRows.value.splice(index, 1)
}
function unitFor(productId: string): string {
  return activeProducts.value.find(p => p.id === productId)?.unit ?? ''
}

// Returns flow state
const wantsReturns = ref<boolean | null>(null)
const returnsCount = ref(5)

// Patient search + pre-registration state
const patientSearch = ref('')
const showPreRegModal = ref(false)
const selectedPatient = ref<Patient | null>(null)
const showDropdown = ref(false)
const extraPatients = ref<Patient[]>([])

const allPatients = computed(() => [...props.patients, ...extraPatients.value])

const filteredPatients = computed(() => {
  const term = patientSearch.value
  if (term.length < 2) return []
  const lower = term.toLowerCase()
  return allPatients.value
    .filter(p =>
      p.name.toLowerCase().includes(lower) ||
      p.phone.includes(term) ||
      (p.cpf && p.cpf.includes(term))
    )
    .slice(0, 8)
})

function onPatientSearchBlur() {
  setTimeout(() => { showDropdown.value = false }, 150)
}

function handleSelectPatient(p: Patient) {
  selectedPatient.value = p
  formData.patientId = p.id
  patientSearch.value = ''
  showDropdown.value = false
  showPreRegModal.value = false
}

function handleClearPatient() {
  selectedPatient.value = null
  formData.patientId = ''
  patientSearch.value = ''
}

function handlePatientCreated(p: Patient) {
  extraPatients.value = [...extraPatients.value.filter(ep => ep.id !== p.id), p]
  handleSelectPatient(p)
  emit('patientCreated', p)
}

const selectedPatientFull = computed(() => allPatients.value.find(p => p.id === formData.patientId))
const primaryPlan = computed(() => selectedPatientFull.value?.patientPlans?.[0] ?? null)

// ── Sync form with appointment / defaultDate ──
watch(
  () => [props.appointment, props.defaultDate] as const,
  ([appointment, defaultDate]) => {
    if (appointment) {
      formData.patientId = appointment.patientId
      formData.doctorId = appointment.doctorId
      formData.title = appointment.title
      formData.date = format(new Date(appointment.date), "yyyy-MM-dd'T'HH:mm")
      formData.duration = appointment.duration
      formData.status = appointment.status
      formData.notes = appointment.notes || ''
      formData.roomId = appointment.roomId || ''
      const p = allPatients.value.find(pt => pt.id === appointment.patientId)
      if (p) selectedPatient.value = p
    } else if (defaultDate) {
      formData.date = format(defaultDate, "yyyy-MM-dd'T'HH:mm")
    } else {
      const now = new Date()
      now.setMinutes(0, 0, 0)
      formData.date = format(now, "yyyy-MM-dd'T'HH:mm")
    }
  },
  { immediate: true }
)

// Auto-fill doctorId for SECRETARY
watch(
  () => props.doctors,
  (doctors) => {
    if (!props.appointment && props.currentUser?.role === 'SECRETARY' && doctors.length === 1) {
      formData.doctorId = doctors[0].id
    }
  },
  { immediate: true }
)

watch(selectedPatientFull, (patient) => {
  if (patient && !props.appointment) {
    formData.title = `Consulta - ${patient.name}`
  }
})

// Sync repeatCount with returns flow
watch([wantsReturns, returnsCount], ([wants, count]) => {
  formData.repeatCount = wants === true ? count : 1
}, { immediate: true })

// Retornos automáticos: perguntado sempre em consulta nova, independente de procedimento.
const showReturnsFlow = computed(() => !props.appointment)

function handleReturnsCountInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value)
  if (!isNaN(v) && v >= 1 && v <= 50) returnsCount.value = v
}

function handleSubmit(e: Event) {
  e.preventDefault()
  const validRows = canUseStock.value
    ? stockRows.value.filter(r => r.productId && r.quantity > 0)
    : []
  const result = schema.safeParse({ ...formData, stockItems: validRows.length > 0 ? validRows : undefined })
  if (!result.success) {
    const fieldErrors: Partial<Record<keyof AppointmentFormData, string>> = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof AppointmentFormData
      fieldErrors[key] = issue.message
    }
    errors.value = fieldErrors
    return
  }
  errors.value = {}
  emit('submit', result.data)
}
</script>

<template>
  <div>
    <form class="space-y-4" @submit="handleSubmit">
      <div v-if="patients.length === 0 && !selectedPatient" class="p-3 bg-primary-50 border border-primary-100 rounded-xl text-primary-800 text-sm flex gap-2 items-start">
        <Info class="w-5 h-5 flex-shrink-0" />
        <div>
          <p class="font-semibold">Nenhum paciente cadastrado</p>
          <p>Use a opção "Criar pré-cadastro rápido" abaixo para agendar sem cadastro completo.</p>
        </div>
      </div>

      <div v-if="currentUser?.role === 'SECRETARY' && doctors.length === 0" class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex gap-2 items-start">
        <Info class="w-5 h-5 flex-shrink-0" />
        <div>
          <p class="font-semibold">Nenhum profissional vinculado</p>
          <p>Você não está vinculada a nenhum médico ativo. Contate o administrador.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="label">Paciente *</label>
          <div v-if="selectedPatient" class="flex items-center gap-2 p-2.5 bg-primary-50 border border-primary-200 rounded-xl">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-primary-900 truncate">{{ selectedPatient.name }}</p>
              <p class="text-xs text-primary-600">{{ selectedPatient.phone }}</p>
            </div>
            <span v-if="selectedPatient.status === 'PRE_CADASTRO'" class="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
              Pré-cadastro
            </span>
            <button v-if="!appointment" type="button" class="text-slate-400 hover:text-slate-600 flex-shrink-0" @click="handleClearPatient">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div v-else class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              v-model="patientSearch"
              class="input-field pl-9"
              placeholder="Pesquisar paciente..."
              @focus="showDropdown = true"
              @blur="onPatientSearchBlur"
            />
            <div v-if="showDropdown && filteredPatients.length > 0" class="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
              <button
                v-for="p in filteredPatients"
                :key="p.id"
                type="button"
                class="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
                @mousedown="handleSelectPatient(p)"
              >
                <span class="font-medium text-slate-800 truncate">{{ p.name }}</span>
                <span class="text-xs text-slate-400 flex-shrink-0">{{ p.phone }}</span>
              </button>
            </div>
          </div>
          <p v-if="errors.patientId" class="text-xs text-red-500 mt-1">{{ errors.patientId }}</p>
          <p v-if="!selectedPatient" class="text-xs text-slate-400 mt-1.5">
            Não encontrou?
            <button type="button" class="text-primary-600 hover:text-primary-700 underline font-medium" @click="showPreRegModal = true">
              Criar pré-cadastro rápido
            </button>
          </p>
        </div>

        <div>
          <label class="label">Profissional *</label>
          <select
            v-model="formData.doctorId"
            class="input-field"
            :disabled="currentUser?.role === 'DOCTOR' || (currentUser?.role === 'SECRETARY' && doctors.length <= 1)"
          >
            <option value="">Selecione</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.name }}{{ d.specialty ? ` — ${d.specialty}` : '' }}
            </option>
          </select>
          <p v-if="errors.doctorId" class="text-xs text-red-500 mt-1">{{ errors.doctorId }}</p>
        </div>
      </div>

      <div>
        <label class="label">Título da consulta *</label>
        <input v-model="formData.title" class="input-field" placeholder="Ex: Consulta de rotina" />
        <p v-if="errors.title" class="text-xs text-red-500 mt-1">{{ errors.title }}</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="sm:col-span-2">
          <label class="label">Data e Hora *</label>
          <input v-model="formData.date" type="datetime-local" class="input-field" />
          <p v-if="errors.date" class="text-xs text-red-500 mt-1">{{ errors.date }}</p>
        </div>

        <div>
          <label class="label">Duração</label>
          <select v-model.number="formData.duration" class="input-field">
            <option v-for="d in DURATIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
      </div>

      <div>
        <label class="label">Status</label>
        <select v-model="formData.status" class="input-field">
          <option value="SCHEDULED">Agendado</option>
          <option value="CONFIRMED">Confirmado</option>
          <option value="COMPLETED">Concluído</option>
          <option value="CANCELLED">Cancelado</option>
          <option value="NO_SHOW">Faltou</option>
        </select>
      </div>

      <!-- ── Produtos usados (baixa de estoque, opcional) ── -->
      <div v-if="canUseStock" class="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
        <p class="label flex items-center gap-1.5 mb-1">
          <Package class="w-3.5 h-3.5 text-slate-400" />
          Produtos usados (opcional)
        </p>
        <p v-if="activeProducts.length === 0" class="text-xs text-slate-400">Nenhum produto cadastrado no estoque.</p>
        <div v-for="(row, idx) in stockRows" :key="idx" class="flex items-center gap-2">
          <select v-model="row.productId" class="input-field flex-1 text-sm">
            <option value="">Selecione um produto</option>
            <option v-for="p in activeProducts" :key="p.id" :value="p.id">{{ p.name }} (saldo: {{ p.quantity }} {{ p.unit }})</option>
          </select>
          <input v-model.number="row.quantity" type="number" min="1" class="input-field w-20 text-sm" />
          <span class="text-xs text-slate-400 w-10">{{ unitFor(row.productId) }}</span>
          <button type="button" class="p-1.5 text-slate-400 hover:text-red-500" @click="removeStockRow(idx)">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          v-if="activeProducts.length > 0"
          type="button"
          class="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
          @click="addStockRow"
        >
          <Plus class="w-3.5 h-3.5" /> Adicionar produto
        </button>
      </div>

      <!-- ── Returns flow ── -->
      <div v-if="showReturnsFlow" class="rounded-xl border-2 border-violet-300 bg-violet-50 overflow-hidden">
        <div class="flex items-center gap-3 px-4 py-3 bg-violet-100 border-b border-violet-200">
          <RefreshCw class="w-4 h-4 text-violet-600 flex-shrink-0" />
          <p class="text-sm font-semibold text-violet-800">
            Deseja agendar retornos semanalmente?
          </p>
        </div>

        <div class="px-4 py-3 space-y-3">
          <div class="flex gap-2">
            <button
              type="button"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all"
              :class="wantsReturns === true
                ? 'bg-violet-600 border-violet-600 text-white shadow-md'
                : 'bg-white border-violet-300 text-violet-700 hover:border-violet-500'"
              @click="wantsReturns = true"
            >
              <Check class="w-3.5 h-3.5" />
              SIM
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all"
              :class="wantsReturns === false
                ? 'bg-slate-600 border-slate-600 text-white shadow-md'
                : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'"
              @click="wantsReturns = false"
            >
              <X class="w-3.5 h-3.5" />
              NÃO
            </button>
          </div>

          <div v-if="wantsReturns === true" class="space-y-2 pt-1">
            <p class="text-xs font-semibold text-violet-700">
              Quantos retornos o paciente tem direito?
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="n in RETURN_OPTIONS"
                :key="n"
                type="button"
                class="w-14 h-10 rounded-xl text-sm font-bold border-2 transition-all"
                :class="returnsCount === n
                  ? 'bg-violet-600 border-violet-600 text-white shadow-md scale-105'
                  : 'bg-white border-violet-200 text-violet-700 hover:border-violet-400'"
                @click="returnsCount = n"
              >
                {{ n }}
              </button>
              <input
                type="number"
                :min="1"
                :max="50"
                placeholder="Outro"
                :value="RETURN_OPTIONS.includes(returnsCount) ? '' : returnsCount"
                class="w-20 h-10 rounded-xl border-2 border-violet-200 text-sm text-center font-semibold text-violet-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                @input="handleReturnsCountInput"
              />
            </div>
            <div class="flex items-center gap-2 p-2.5 bg-violet-100 rounded-lg">
              <RefreshCw class="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
              <p class="text-xs text-violet-700">
                Serão criados <strong>{{ returnsCount }} agendamentos</strong> semanais a partir da data selecionada.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <label class="label">Observações</label>
        <textarea
          v-model="formData.notes"
          rows="3"
          class="input-field resize-none"
          placeholder="Anotações sobre a consulta..."
        />
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          v-if="appointment"
          type="button"
          class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2"
          @click="showNotifyModal = true"
        >
          <Bell class="w-4 h-4" />
          Notificar
        </button>
        <button
          v-if="appointment && !appointment.billedAt && !appointment.transaction"
          type="button"
          class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2"
          @click="showCobrancaModal = true"
        >
          <DollarSign class="w-4 h-4" />
          Cobrar
        </button>
        <button type="submit" :disabled="loading" class="btn-primary flex-1">
          <span v-if="loading" class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>
            {{ appointment
              ? 'Atualizar Consulta'
              : wantsReturns === true
                ? `Agendar ${returnsCount} Consultas`
                : 'Agendar Consulta' }}
          </template>
        </button>
        <button v-if="appointment" type="button" class="btn-danger" @click="emit('delete')">
          <Trash2 class="w-4 h-4" />
        </button>
      </div>
    </form>

    <PreRegisterModal
      :is-open="showPreRegModal"
      @close="showPreRegModal = false"
      @created="handlePatientCreated"
    />

    <NotificarPacienteModal
      v-if="appointment && showNotifyModal"
      :is-open="showNotifyModal"
      :appointment-id="appointment.id"
      :patient-name="appointment.patient.name"
      :patient-phone="appointment.patient.phone ?? undefined"
      @close="showNotifyModal = false"
    />

    <CobrancaModal
      v-if="appointment && showCobrancaModal"
      :is-open="showCobrancaModal"
      :appointment="appointment"
      :patient-plan="primaryPlan"
      :discount-percent="primaryPlan?.healthPlan?.discountPercent ?? 0"
      @close="showCobrancaModal = false"
      @charged="() => { showCobrancaModal = false; emit('charged') }"
    />
  </div>
</template>
