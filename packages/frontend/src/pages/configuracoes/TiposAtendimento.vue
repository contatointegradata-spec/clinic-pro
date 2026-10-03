<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { z } from 'zod'
import { Plus, Edit2, Stethoscope, DollarSign, CheckCircle, XCircle, RefreshCw } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { AppointmentType } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import { useAuthStore } from '../../stores/auth'
import { useQuery } from '../../composables/useQuery'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  baseValue: z.coerce.number().min(0).optional().or(z.literal('')),
  hasReturns: z.boolean().default(false),
})

type FormData = z.infer<typeof schema>

const authStore = useAuthStore()
const canManage = computed(() => authStore.user?.role !== 'SECRETARY')

const modalOpen = ref(false)
const editType = ref<AppointmentType | null>(null)
const showAll = ref(false)
const saving = ref(false)

const { data: typesData, refetch: refetchTypes } = useQuery<AppointmentType[]>({
  key: 'appointment-types-all',
  queryFn: () => api.get('/appointment-types/all').then(r => r.data),
})
const types = computed(() => typesData.value ?? [])
const displayed = computed(() => showAll.value ? types.value : types.value.filter(t => t.active))

// ─── Form (reactive) ──────────────────────────────────────────────────────────

const form = reactive({
  name: '',
  baseValue: '' as number | '',
  hasReturns: false,
})
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editType, (t) => {
  form.name = t?.name || ''
  form.baseValue = t?.baseValue ?? ''
  form.hasReturns = t?.hasReturns ?? false
  errors.name = undefined
  errors.baseValue = undefined
}, { immediate: true })

function handleNew() { editType.value = null; modalOpen.value = true }
function handleEdit(t: AppointmentType) { editType.value = t; modalOpen.value = true }
function closeModal() { modalOpen.value = false; editType.value = null }

async function handleSubmit() {
  errors.name = undefined
  errors.baseValue = undefined

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
    if (editType.value) {
      await api.put(`/appointment-types/${editType.value.id}`, result.data)
    } else {
      await api.post('/appointment-types', result.data)
    }
    toast.success(editType.value ? 'Tipo atualizado!' : 'Tipo criado!')
    closeModal()
    await refetchTypes()
  } catch {
    toast.error('Erro ao salvar tipo de atendimento')
  } finally {
    saving.value = false
  }
}

const toggling = ref(false)
async function handleToggle(id: string) {
  toggling.value = true
  try {
    await api.patch(`/appointment-types/${id}/toggle`)
    toast.success('Status alterado')
    await refetchTypes()
  } finally {
    toggling.value = false
  }
}

function formatValue(v: number) {
  return v.toFixed(2).replace('.', ',')
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div class="flex items-start justify-between">
      <div class="animate-stagger-1">
        <h1 class="page-title">Procedimento</h1>
        <p class="page-subtitle">Cadastre os procedimentos com seus valores base</p>
      </div>
      <button v-if="canManage" class="btn-primary animate-stagger-1" @click="handleNew">
        <Plus class="w-4 h-4" />
        Novo Tipo
      </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
      <div class="card flex items-center gap-3 py-4 bg-primary-50 animate-stagger-1">
        <Stethoscope class="w-8 h-8 text-primary-600" />
        <div>
          <p class="text-2xl font-bold text-primary-600">{{ types.length }}</p>
          <p class="text-xs text-slate-500">Total de tipos</p>
        </div>
      </div>
      <div class="card flex items-center gap-3 py-4 bg-emerald-50 animate-stagger-2">
        <CheckCircle class="w-8 h-8 text-emerald-600" />
        <div>
          <p class="text-2xl font-bold text-emerald-600">{{ types.filter(t => t.active).length }}</p>
          <p class="text-xs text-slate-500">Tipos ativos</p>
        </div>
      </div>
      <div class="card flex items-center gap-3 py-4 bg-violet-50 animate-stagger-2">
        <RefreshCw class="w-8 h-8 text-violet-600" />
        <div>
          <p class="text-2xl font-bold text-violet-600">{{ types.filter(t => t.hasReturns).length }}</p>
          <p class="text-xs text-slate-500">Com retornos</p>
        </div>
      </div>
    </div>

    <!-- List -->
    <div class="card p-0 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900">
          {{ displayed.length }} tipos {{ !showAll ? 'ativos' : '' }}
        </h2>
        <button class="text-xs text-primary-600 hover:text-primary-700 font-medium" @click="showAll = !showAll">
          {{ showAll ? 'Mostrar apenas ativos' : 'Mostrar todos' }}
        </button>
      </div>

      <div v-if="displayed.length === 0" class="text-center py-12">
        <Stethoscope class="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p class="text-slate-400">Nenhum tipo cadastrado</p>
        <button v-if="canManage" class="text-primary-600 text-sm font-medium mt-2 hover:underline" @click="handleNew">
          Criar primeiro tipo
        </button>
      </div>
      <div v-else class="divide-y divide-slate-100">
        <div
          v-for="t in displayed" :key="t.id"
          class="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
          :class="!t.active ? 'opacity-60' : ''"
        >
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            :class="t.hasReturns ? 'bg-violet-50' : 'bg-primary-50'"
          >
            <RefreshCw v-if="t.hasReturns" class="w-5 h-5 text-violet-600" />
            <Stethoscope v-else class="w-5 h-5 text-primary-600" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900">{{ t.name }}</p>
              <span v-if="t.hasReturns" class="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">
                <RefreshCw class="w-3 h-3" />
                Disponibiliza Retornos
              </span>
              <span v-if="!t.active" class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativo</span>
            </div>
            <p v-if="t.baseValue != null && t.baseValue > 0" class="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
              <DollarSign class="w-3.5 h-3.5" />
              Valor base: <span class="font-semibold text-slate-700">R$ {{ formatValue(t.baseValue) }}</span>
            </p>
            <p v-else class="text-xs text-slate-400 mt-0.5">Sem valor base definido</p>
          </div>
          <div v-if="canManage" class="flex items-center gap-1 flex-shrink-0">
            <button
              class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="Editar"
              @click="handleEdit(t)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              :disabled="toggling"
              class="p-1.5 rounded-lg transition-colors"
              :class="t.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
              :title="t.active ? 'Desativar' : 'Ativar'"
              @click="handleToggle(t.id)"
            >
              <XCircle v-if="t.active" class="w-4 h-4" />
              <CheckCircle v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card bg-amber-50 border-amber-200">
      <h3 class="font-semibold text-amber-900 mb-2 flex items-center gap-2">
        <Stethoscope class="w-4 h-4" />
        Como usar os Procedimentos
      </h3>
      <ul class="text-sm text-amber-800 space-y-1.5">
        <li>• Cadastre os tipos de consulta praticados (Consulta, Retorno, Exame, etc.)</li>
        <li>• Defina o valor base de cada tipo de atendimento</li>
        <li>• Na agenda, ao selecionar o tipo, o valor é preenchido automaticamente</li>
        <li>• Ative <strong>Disponibiliza retornos</strong> para tipos que replicam semanalmente</li>
        <li>• Ao agendar esse tipo, o sistema perguntará quantos retornos criar (5, 7 ou 10)</li>
      </ul>
    </div>

    <Modal
      :is-open="modalOpen"
      :title="editType ? 'Editar Tipo de Atendimento' : 'Novo Tipo de Atendimento'"
      @close="closeModal"
    >
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome do Tipo *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Consulta, Retorno, Exame, Avaliação..." />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div>
          <label class="label flex items-center gap-1">
            <DollarSign class="w-3.5 h-3.5 text-slate-500" />
            Valor Base (R$)
          </label>
          <input v-model="form.baseValue" type="number" step="0.01" min="0" class="input-field" placeholder="0,00" />
          <p class="text-xs text-slate-400 mt-1">
            Valor padrão para este tipo de atendimento. O desconto do plano do paciente será aplicado automaticamente.
          </p>
        </div>

        <!-- Retornos recorrentes toggle -->
        <div
          class="flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all select-none"
          :class="form.hasReturns ? 'bg-violet-50 border-violet-400' : 'bg-slate-50 border-slate-200 hover:border-slate-300'"
          @click="form.hasReturns = !form.hasReturns"
        >
          <div
            class="mt-0.5 w-10 h-6 rounded-full relative flex-shrink-0 transition-colors"
            :class="form.hasReturns ? 'bg-violet-500' : 'bg-slate-300'"
          >
            <div
              class="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
              :class="form.hasReturns ? 'left-4' : 'left-0.5'"
            />
          </div>
          <div class="flex-1">
            <p class="font-semibold text-sm" :class="form.hasReturns ? 'text-violet-800' : 'text-slate-700'">
              Disponibiliza retornos recorrentes
            </p>
            <p class="text-xs text-slate-500 mt-0.5">
              Ao agendar este tipo, o sistema perguntará se deseja replicar a consulta nas próximas semanas (5, 7 ou 10 retornos).
            </p>
          </div>
          <input type="checkbox" :checked="form.hasReturns" class="sr-only" />
        </div>

        <div class="p-3 bg-primary-50 border border-primary-200 rounded-xl text-xs text-primary-700">
          <p class="font-medium mb-1">Como funciona o cálculo automático:</p>
          <p>Ao agendar uma consulta, o valor base será descontado pelo percentual do plano de saúde do paciente, gerando o valor de repasse automaticamente.</p>
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editType ? 'Atualizar Tipo' : 'Criar Tipo de Atendimento' }}</template>
        </button>
      </form>
    </Modal>
  </div>
</template>
