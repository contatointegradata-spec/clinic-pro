<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { z } from 'zod'
import {
  Plus, Edit2, CreditCard, Users, CheckCircle, XCircle, Percent, DollarSign, Info, MapPin, Stethoscope, Trash2,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { HealthPlan, Room, AppointmentType, PlanType } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import { useQuery } from '../../composables/useQuery'

const PLAN_TYPES: { value: PlanType; label: string; description: string; icon: string; color: string; bg: string; border: string }[] = [
  { value: 'PARTICULAR', label: 'Particular', description: 'Sem convênio', icon: '💳', color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-300' },
  { value: 'CONVENIO', label: 'Convênio', description: 'Plano de saúde', icon: '🏥', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300' },
  { value: 'OUTROS', label: 'Outros', description: 'Tipo personalizado', icon: '✨', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-300' },
]

const typeConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  PARTICULAR: { label: 'Particular', color: 'text-primary-700', bg: 'bg-primary-100', icon: '💳' },
  CONVENIO: { label: 'Convênio', color: 'text-emerald-700', bg: 'bg-emerald-100', icon: '🏥' },
  OUTROS: { label: 'Outros', color: 'text-purple-700', bg: 'bg-purple-100', icon: '✨' },
}

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  type: z.enum(['PARTICULAR', 'CONVENIO', 'OUTROS']),
  customTypeName: z.string().optional(),
  description: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional().or(z.literal('')),
  defaultValue: z.coerce.number().min(0).optional().or(z.literal('')),
  roomId: z.string().optional().nullable(),
})

type FormData = z.infer<typeof schema>
type ProcedureEntry = { appointmentTypeId: string; value: number }

// ─── Data ─────────────────────────────────────────────────────────────────

const { data: plansData, refetch: refetchPlans } = useQuery<HealthPlan[]>({
  key: 'health-plans-all',
  queryFn: () => api.get('/health-plans/all').then(r => r.data),
})
const plans = computed(() => plansData.value ?? [])

const { data: roomsData } = useQuery<Room[]>({
  key: 'rooms',
  queryFn: () => api.get('/rooms').then(r => r.data),
})
const rooms = computed(() => roomsData.value ?? [])

const { data: appointmentTypesData } = useQuery<AppointmentType[]>({
  key: 'appointment-types',
  queryFn: () => api.get('/appointment-types').then(r => r.data),
})
const appointmentTypes = computed(() => appointmentTypesData.value ?? [])

// ─── Modal / form state ─────────────────────────────────────────────────────

const modalOpen = ref(false)
const editPlan = ref<HealthPlan | null>(null)
const showAll = ref(false)
const saving = ref(false)

const form = reactive<{
  name: string
  type: PlanType
  customTypeName: string
  description: string
  discountPercent: number | string
  defaultValue: number | string
  roomId: string
}>({
  name: '',
  type: 'PARTICULAR',
  customTypeName: '',
  description: '',
  discountPercent: '',
  defaultValue: '',
  roomId: '',
})
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

const procedures = ref<ProcedureEntry[]>([])
const procSelectedTypeId = ref('')
const procValue = ref('')

const availableTypes = computed(() => appointmentTypes.value.filter(
  t => !procedures.value.some(p => p.appointmentTypeId === t.id)
))

function addProcedure() {
  const numericValue = parseFloat(procValue.value)
  if (!procSelectedTypeId.value || isNaN(numericValue) || numericValue < 0) return
  procedures.value.push({ appointmentTypeId: procSelectedTypeId.value, value: numericValue })
  procSelectedTypeId.value = ''
  procValue.value = ''
}

function removeProcedure(appointmentTypeId: string) {
  procedures.value = procedures.value.filter(p => p.appointmentTypeId !== appointmentTypeId)
}

function procedureTypeName(appointmentTypeId: string) {
  return appointmentTypes.value.find(t => t.id === appointmentTypeId)?.name ?? 'Procedimento'
}

function getRoomName(roomId: string) {
  const r = rooms.value.find(room => room.id === roomId)
  return r ? `${r.name}${r.cidade ? ` — ${r.cidade}` : ''}` : ''
}

function resetForm(plan: HealthPlan | null) {
  form.name = plan?.name || ''
  form.type = plan?.type || 'PARTICULAR'
  form.customTypeName = plan?.customTypeName || ''
  form.description = plan?.description || ''
  form.discountPercent = plan?.discountPercent ?? ''
  form.defaultValue = plan?.defaultValue ?? ''
  form.roomId = plan?.roomId || ''
  procedures.value = (plan?.procedures ?? []).map(p => ({ appointmentTypeId: p.appointmentTypeId, value: p.value }))
  procSelectedTypeId.value = ''
  procValue.value = ''
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    errors[key] = undefined
  }
}

function handleNew() {
  editPlan.value = null
  resetForm(null)
  modalOpen.value = true
}

function handleEdit(p: HealthPlan) {
  editPlan.value = p
  resetForm(p)
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editPlan.value = null
}

async function handleSubmit() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    errors[key] = undefined
  }

  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  saving.value = true
  try {
    const payload = { ...result.data, procedures: procedures.value.filter(p => p.appointmentTypeId) }
    if (editPlan.value) {
      await api.put(`/health-plans/${editPlan.value.id}`, payload)
    } else {
      await api.post('/health-plans', payload)
    }
    toast.success(editPlan.value ? 'Plano atualizado!' : 'Plano criado!')
    closeModal()
    await refetchPlans()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao salvar plano')
  } finally {
    saving.value = false
  }
}

async function toggleActive(id: string) {
  try {
    await api.patch(`/health-plans/${id}/toggle`)
    toast.success('Status do plano alterado')
    await refetchPlans()
  } catch {
    toast.error('Erro ao alterar status do plano')
  }
}

// ─── Derived ──────────────────────────────────────────────────────────────

const displayedPlans = computed(() => (showAll.value ? plans.value : plans.value.filter(p => p.active)))

const stats = computed(() => ({
  total: plans.value.length,
  active: plans.value.filter(p => p.active).length,
  convenio: plans.value.filter(p => p.type === 'CONVENIO').length,
  totalPatients: plans.value.reduce((acc, p) => acc + (p._count?.patientPlans ?? 0), 0),
}))

const infoItems = [
  'Cadastre todos os convênios e formas de atendimento que sua clínica aceita',
  'Defina o valor padrão e o percentual de desconto por plano',
  'No cadastro do paciente, vincule os planos com número da carteirinha (Convênio)',
  'Tipos personalizados: use "Outros" e defina o nome do tipo',
]
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <PageHeader title="Convênio" subtitle="Cadastre convênios e formas de atendimento">
      <template #actions>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Novo Plano
        </button>
      </template>
    </PageHeader>

    <!-- Stats -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="card flex items-center gap-3 py-4">
        <div class="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center border border-primary-100 flex-shrink-0">
          <CreditCard class="w-5 h-5 text-primary-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-primary-600 tabular-nums">{{ stats.total }}</p>
          <p class="text-xs text-slate-500">Total</p>
        </div>
      </div>
      <div class="card flex items-center gap-3 py-4">
        <div class="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 flex-shrink-0">
          <CheckCircle class="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-emerald-600 tabular-nums">{{ stats.active }}</p>
          <p class="text-xs text-slate-500">Ativos</p>
        </div>
      </div>
      <div class="card flex items-center gap-3 py-4">
        <div class="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center border border-purple-100 flex-shrink-0">
          <CreditCard class="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-purple-600 tabular-nums">{{ stats.convenio }}</p>
          <p class="text-xs text-slate-500">Convênios</p>
        </div>
      </div>
      <div class="card flex items-center gap-3 py-4">
        <div class="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100 flex-shrink-0">
          <Users class="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-amber-600 tabular-nums">{{ stats.totalPatients }}</p>
          <p class="text-xs text-slate-500">Vínculos</p>
        </div>
      </div>
    </div>

    <!-- Plans list -->
    <div class="card p-0 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900 flex items-center gap-2">
          <span v-if="displayedPlans.length > 0" class="w-5 h-5 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center font-bold tabular-nums">
            {{ displayedPlans.length }}
          </span>
          Planos {{ !showAll ? 'ativos' : '' }}
        </h2>
        <button
          v-if="plans.length > 0"
          class="text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors px-2 py-1 rounded-lg hover:bg-primary-50"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Apenas ativos' : 'Ver todos' }}
        </button>
      </div>

      <div v-if="displayedPlans.length === 0" class="text-center py-14">
        <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float">
          <CreditCard class="w-7 h-7 text-slate-300" />
        </div>
        <p class="text-slate-500 font-medium">Nenhum plano cadastrado</p>
        <p class="text-slate-400 text-sm mt-1">Comece criando um plano de atendimento</p>
        <button class="mt-4 btn-primary text-sm" @click="handleNew">
          <Plus class="w-3.5 h-3.5" />
          Criar primeiro plano
        </button>
      </div>

      <div v-else class="divide-y divide-slate-100">
        <div
          v-for="(plan, idx) in displayedPlans" :key="plan.id"
          :class="['flex items-center gap-4 px-5 py-4 group hover:bg-slate-50 transition-colors duration-150', !plan.active ? 'opacity-60' : '']"
          :style="{ animationDelay: `${idx * 0.04}s` }"
        >
          <div :class="['w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0', (typeConfig[plan.type] || typeConfig.OUTROS).bg]">
            {{ (typeConfig[plan.type] || typeConfig.OUTROS).icon }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900 group-hover:text-primary-700 transition-colors duration-150">
                {{ plan.name }}
              </p>
              <span :class="['text-xs px-2 py-0.5 rounded-full font-medium', (typeConfig[plan.type] || typeConfig.OUTROS).bg, (typeConfig[plan.type] || typeConfig.OUTROS).color]">
                {{ plan.customTypeName || (typeConfig[plan.type] || typeConfig.OUTROS).label }}
              </span>
              <span v-if="!plan.active" class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativo</span>
            </div>
            <div class="flex items-center gap-3 mt-1 flex-wrap">
              <span v-if="plan.defaultValue != null && plan.defaultValue > 0" class="text-xs text-slate-500 flex items-center gap-1">
                <DollarSign class="w-3 h-3" />
                R$ {{ plan.defaultValue.toFixed(2) }}
              </span>
              <span v-if="plan.discountPercent != null && plan.discountPercent > 0" class="text-xs text-emerald-600 flex items-center gap-1">
                <Percent class="w-3 h-3" />
                {{ plan.discountPercent }}% desconto
              </span>
              <span class="text-xs text-slate-400 flex items-center gap-1">
                <Users class="w-3 h-3" />
                {{ plan._count?.patientPlans ?? 0 }} vínculos
              </span>
              <span v-if="plan.room" class="text-xs text-indigo-600 flex items-center gap-1">
                <MapPin class="w-3 h-3" />
                {{ plan.room.name }}
              </span>
            </div>
          </div>
          <div class="hidden sm:flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button
              class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="Editar"
              @click="handleEdit(plan)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              :class="['p-1.5 rounded-lg transition-colors', plan.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50']"
              :title="plan.active ? 'Desativar' : 'Ativar'"
              @click="toggleActive(plan.id)"
            >
              <XCircle v-if="plan.active" class="w-4 h-4" />
              <CheckCircle v-else class="w-4 h-4" />
            </button>
          </div>
          <!-- Mobile always-visible actions -->
          <div class="flex items-center gap-1 flex-shrink-0 sm:hidden">
            <button
              class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              @click="handleEdit(plan)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Info banner -->
    <div class="card bg-primary-50 border-primary-200">
      <h3 class="font-semibold text-primary-900 mb-3 flex items-center gap-2">
        <div class="w-7 h-7 bg-primary-100 rounded-lg flex items-center justify-center border border-primary-200">
          <Info class="w-3.5 h-3.5 text-primary-600" />
        </div>
        Como usar os Convênios
      </h3>
      <ul class="text-sm text-primary-700 space-y-2">
        <li v-for="item in infoItems" :key="item" class="flex items-start gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0 mt-1.5" />
          {{ item }}
        </li>
      </ul>
    </div>

    <!-- Create / Edit Modal -->
    <Modal
      :is-open="modalOpen"
      :title="editPlan ? 'Editar Plano de Saúde' : 'Novo Plano de Saúde'"
      size="lg"
      @close="closeModal"
    >
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome do Plano *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Unimed Empresarial, Particular Premium..." />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div>
          <label class="label mb-2">Tipo de Plano *</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label
              v-for="type in PLAN_TYPES" :key="type.value"
              :class="['relative flex flex-col items-center p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-150',
                form.type === type.value ? [type.border, type.bg, 'shadow-sm'] : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50']"
            >
              <input v-model="form.type" type="radio" :value="type.value" class="sr-only" />
              <span class="text-2xl mb-1.5">{{ type.icon }}</span>
              <span :class="['text-sm font-semibold', form.type === type.value ? type.color : 'text-slate-600']">
                {{ type.label }}
              </span>
              <span class="text-xs text-slate-400 text-center mt-0.5 leading-tight">{{ type.description }}</span>
              <div v-if="form.type === type.value" :class="['absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center', type.border.replace('border-', 'bg-')]">
                <div class="w-2 h-2 bg-white rounded-full" />
              </div>
            </label>
          </div>
        </div>

        <div v-if="form.type === 'OUTROS'">
          <label class="label">Nome do Tipo Personalizado</label>
          <input v-model="form.customTypeName" class="input-field" placeholder="Ex: Cooperativa Médica, IPO, DPVAT..." />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label flex items-center gap-1">
              <DollarSign class="w-3.5 h-3.5 text-slate-400" />
              Valor Padrão (R$)
            </label>
            <input v-model="form.defaultValue" type="number" step="0.01" min="0" class="input-field" placeholder="0,00" />
            <p class="text-xs text-slate-400 mt-1">Valor base da consulta</p>
          </div>

          <div>
            <label class="label flex items-center gap-1">
              <Percent class="w-3.5 h-3.5 text-slate-400" />
              Desconto (%)
            </label>
            <div class="relative">
              <input v-model="form.discountPercent" type="number" step="0.1" min="0" max="100" class="input-field pr-8" placeholder="0" />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">Percentual de desconto</p>
          </div>
        </div>

        <div v-if="form.type === 'CONVENIO'" class="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-start gap-2">
          <CreditCard class="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>No cadastro do paciente, você pode informar o número da carteirinha para este convênio.</p>
        </div>

        <div v-if="rooms.length > 0">
          <label class="label flex items-center gap-1">
            <MapPin class="w-3.5 h-3.5 text-slate-400" />
            Sala vinculada
          </label>
          <select v-model="form.roomId" class="input-field">
            <option value="">Sem sala vinculada (todas as salas)</option>
            <option v-for="r in rooms" :key="r.id" :value="r.id">{{ getRoomName(r.id) }}</option>
          </select>
          <p class="text-xs text-slate-400 mt-1">
            Selecione a sala onde este plano é aceito. O paciente verá a sala ao escolher este plano.
          </p>
        </div>

        <!-- Procedures linker -->
        <div>
          <label class="label flex items-center gap-1">
            <Stethoscope class="w-3.5 h-3.5 text-slate-400" />
            Procedimentos vinculados
          </label>
          <p class="text-xs text-slate-400 mb-2">
            Valor deste procedimento quando cobrado sob este convênio. Some ao valor da consulta no modal Cobrar.
          </p>

          <div v-if="procedures.length > 0" class="space-y-1.5 mb-2">
            <div v-for="p in procedures" :key="p.appointmentTypeId" class="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <span class="flex-1 text-sm text-slate-700">{{ procedureTypeName(p.appointmentTypeId) }}</span>
              <span class="text-sm font-semibold text-slate-800">R$ {{ p.value.toFixed(2).replace('.', ',') }}</span>
              <button type="button" class="text-slate-400 hover:text-red-600" @click="removeProcedure(p.appointmentTypeId)">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div v-if="availableTypes.length > 0" class="flex gap-2">
            <select v-model="procSelectedTypeId" class="input-field flex-1">
              <option value="">Selecione um procedimento</option>
              <option v-for="t in availableTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
            <input v-model="procValue" type="number" step="0.01" min="0" placeholder="R$" class="input-field w-28" />
            <button type="button" class="btn-secondary px-3" @click="addProcedure">
              <Plus class="w-4 h-4" />
            </button>
          </div>
          <p v-else-if="appointmentTypes.length === 0" class="text-xs text-slate-400">
            Cadastre procedimentos em Configurações → Procedimento para vinculá-los aqui.
          </p>
        </div>

        <div>
          <label class="label">Descrição do Plano</label>
          <textarea v-model="form.description" rows="3" class="input-field resize-none" placeholder="Coberturas, procedimentos aceitos, observações..." />
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editPlan ? 'Atualizar Plano' : 'Criar Plano de Saúde' }}</template>
        </button>
      </form>
    </Modal>
  </div>
</template>
