<script setup lang="ts">
import { ref, computed } from 'vue'
import { FileText, Search } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import PlanCard from './PlanCard.vue'
import PlanEditor from './PlanEditor.vue'
import { type TreatmentPlan, type PlanStatus, PLAN_STATUS, brl } from '../../lib/clinical'

const plans = ref<TreatmentPlan[]>([])
const loading = ref(true)
const filter = ref<'' | PlanStatus>('')
const search = ref('')
const editing = ref<TreatmentPlan | null>(null)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<TreatmentPlan[]>('/clinical/treatment-plans')
    plans.value = data
  } catch {
    toast.error('Não foi possível carregar os orçamentos')
  } finally {
    loading.value = false
  }
}
load()

const counts = computed(() => {
  const c: Record<string, number> = {}
  for (const p of plans.value) c[p.status] = (c[p.status] ?? 0) + 1
  return c
})
const pendingValue = computed(() => plans.value.filter(p => p.status === 'ENVIADO').reduce((s, p) => s + p.total, 0))
const approvedValue = computed(() => plans.value.filter(p => ['APROVADO', 'CONCLUIDO'].includes(p.status)).reduce((s, p) => s + p.total, 0))
const conversion = computed(() => {
  const decided = plans.value.filter(p => ['APROVADO', 'CONCLUIDO', 'RECUSADO'].includes(p.status)).length
  if (!decided) return null
  return Math.round(((counts.value.APROVADO ?? 0) + (counts.value.CONCLUIDO ?? 0)) / decided * 100)
})

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  return plans.value.filter(p =>
    (!filter.value || p.status === filter.value) &&
    (!term || p.patient.name.toLowerCase().includes(term) || p.title.toLowerCase().includes(term)),
  )
})

function onUpdated(plan: TreatmentPlan) {
  const i = plans.value.findIndex(p => p.id === plan.id)
  if (i >= 0) plans.value[i] = plan
}
function onSaved(plan: TreatmentPlan) {
  onUpdated(plan)
  editing.value = null
}
</script>

<template>
  <div class="space-y-5">
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Aguardando aprovação</p>
        <p class="mt-1 font-display text-2xl font-semibold tabular-nums">{{ counts.ENVIADO ?? 0 }}</p>
        <p class="text-xs text-slate-500 tabular-nums">{{ brl(pendingValue) }}</p>
      </div>
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Em tratamento</p>
        <p class="mt-1 font-display text-2xl font-semibold tabular-nums">{{ counts.APROVADO ?? 0 }}</p>
        <p class="text-xs text-slate-500">aprovados, com sessões a fazer</p>
      </div>
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Valor aprovado</p>
        <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-emerald-700">{{ brl(approvedValue) }}</p>
        <p class="text-xs text-slate-500">aprovados + concluídos</p>
      </div>
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Taxa de aprovação</p>
        <p class="mt-1 font-display text-2xl font-semibold tabular-nums">{{ conversion === null ? '—' : `${conversion}%` }}</p>
        <p class="text-xs text-slate-500">entre os orçamentos respondidos</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="opt in [{ key: '', label: 'Todos' }, ...Object.entries(PLAN_STATUS).map(([key, s]) => ({ key, label: s.label }))]" :key="opt.key"
        :class="['text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors', filter === opt.key ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 text-slate-600 hover:bg-white']"
        @click="filter = opt.key as typeof filter"
      >
        {{ opt.label }}<span v-if="opt.key && counts[opt.key]" class="ml-1 opacity-75">{{ counts[opt.key] }}</span>
      </button>
      <div class="relative ml-auto w-full sm:w-64">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input v-model="search" class="input-field pl-9" placeholder="Buscar paciente ou título" />
      </div>
    </div>

    <div v-if="loading" class="space-y-3"><div v-for="i in 3" :key="i" class="h-40 skeleton" /></div>
    <div v-else-if="visible.length === 0" class="card text-center py-12">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><FileText class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum orçamento {{ filter ? 'neste status' : 'ainda' }}</p>
      <p class="text-xs text-slate-500 mt-1">Crie orçamentos pela ficha da paciente, na aba Orçamentos.</p>
    </div>
    <div v-else class="grid xl:grid-cols-2 gap-4 items-start">
      <PlanCard
        v-for="plan in visible" :key="plan.id" :plan="plan" show-patient
        @updated="onUpdated" @edit="p => (editing = p)" @deleted="id => (plans = plans.filter(p => p.id !== id))"
      />
    </div>

    <PlanEditor :is-open="!!editing" :patient-id="editing?.patientId ?? ''" :plan="editing" @close="editing = null" @saved="onSaved" />
  </div>
</template>
