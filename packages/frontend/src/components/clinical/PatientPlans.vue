<script setup lang="ts">
import { ref } from 'vue'
import { Plus, FileText } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import PlanCard from './PlanCard.vue'
import PlanEditor from './PlanEditor.vue'
import type { TreatmentPlan } from '../../lib/clinical'

const props = defineProps<{ patientId: string }>()

const plans = ref<TreatmentPlan[]>([])
const loading = ref(true)
const editorOpen = ref(false)
const editing = ref<TreatmentPlan | null>(null)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<TreatmentPlan[]>(`/clinical/patients/${props.patientId}/treatment-plans`)
    plans.value = data
  } catch {
    toast.error('Não foi possível carregar os orçamentos')
  } finally {
    loading.value = false
  }
}
load()

function openNew() {
  editing.value = null
  editorOpen.value = true
}
function openEdit(plan: TreatmentPlan) {
  editing.value = plan
  editorOpen.value = true
}
function onSaved(plan: TreatmentPlan) {
  editorOpen.value = false
  const idx = plans.value.findIndex(p => p.id === plan.id)
  if (idx >= 0) plans.value[idx] = plan
  else plans.value = [plan, ...plans.value]
}
function onUpdated(plan: TreatmentPlan) {
  const idx = plans.value.findIndex(p => p.id === plan.id)
  if (idx >= 0) plans.value[idx] = plan
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="font-display text-lg font-semibold text-slate-900">Orçamentos e planos de tratamento</h3>
        <p class="text-sm text-slate-500">Envie o link para a paciente aprovar e acompanhe as sessões de cada pacote.</p>
      </div>
      <button class="btn-primary" @click="openNew"><Plus class="w-4 h-4" /> Novo orçamento</button>
    </div>

    <div v-if="loading" class="space-y-3"><div v-for="i in 2" :key="i" class="h-40 skeleton" /></div>
    <div v-else-if="plans.length === 0" class="card text-center py-10">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><FileText class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum orçamento para esta paciente</p>
      <p class="text-xs text-slate-500 mt-1">Monte o plano com os procedimentos da sua tabela e envie pelo WhatsApp.</p>
      <button class="mt-4 btn-primary text-sm" @click="openNew"><Plus class="w-4 h-4" /> Criar orçamento</button>
    </div>
    <div v-else class="space-y-4">
      <PlanCard
        v-for="plan in plans" :key="plan.id" :plan="plan"
        @updated="onUpdated" @edit="openEdit" @deleted="id => (plans = plans.filter(p => p.id !== id))"
      />
    </div>

    <PlanEditor :is-open="editorOpen" :patient-id="patientId" :plan="editing" @close="editorOpen = false" @saved="onSaved" />
  </div>
</template>
