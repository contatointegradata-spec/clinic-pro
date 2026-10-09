<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { CalendarClock, Settings2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import ReturnRow from './ReturnRow.vue'
import { type ScheduledReturn, daysUntil } from '../../lib/clinical'

const items = ref<ScheduledReturn[]>([])
const loading = ref(true)
const view = ref<'abertos' | 'agendados' | 'todos'>('abertos')

const STATUS_PARAM = { abertos: 'PENDENTE,AVISADO', agendados: 'AGENDADO', todos: 'PENDENTE,AVISADO,AGENDADO,CONCLUIDO,DESCARTADO' }

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<ScheduledReturn[]>('/clinical/returns', { params: { status: STATUS_PARAM[view.value] } })
    items.value = data
  } catch {
    toast.error('Não foi possível carregar os retornos')
  } finally {
    loading.value = false
  }
}
watch(view, load, { immediate: true })

const groups = computed(() => {
  const overdue: ScheduledReturn[] = []
  const week: ScheduledReturn[] = []
  const month: ScheduledReturn[] = []
  const later: ScheduledReturn[] = []
  for (const r of items.value) {
    const d = daysUntil(r.dueDate)
    if (d < 0) overdue.push(r)
    else if (d <= 7) week.push(r)
    else if (d <= 30) month.push(r)
    else later.push(r)
  }
  return [
    { key: 'overdue', label: 'Vencidos', hint: 'Avise a paciente e ofereça horários', items: overdue },
    { key: 'week', label: 'Próximos 7 dias', hint: '', items: week },
    { key: 'month', label: 'Próximos 30 dias', hint: '', items: month },
    { key: 'later', label: 'Mais adiante', hint: '', items: later },
  ].filter(g => g.items.length > 0)
})

function onUpdated(r: ScheduledReturn) {
  const i = items.value.findIndex(x => x.id === r.id)
  if (i < 0) return
  const stillVisible = STATUS_PARAM[view.value].split(',').includes(r.status)
  if (stillVisible) items.value[i] = r
  else items.value.splice(i, 1)
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-2">
    <div class="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
      <button v-for="v in (['abertos', 'agendados', 'todos'] as const)" :key="v" :class="['px-3 py-1.5 rounded-lg font-medium', view === v ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-700']" @click="view = v">
        {{ v === 'abertos' ? 'A avisar' : v === 'agendados' ? 'Agendados' : 'Todos' }}
      </button>
    </div>
      <router-link to="/configuracoes/tipos-atendimento" class="ml-auto btn-secondary text-sm"><Settings2 class="w-4 h-4" /> Intervalos de retorno</router-link>
    </div>

    <div v-if="loading" class="space-y-3"><div v-for="i in 3" :key="i" class="h-16 skeleton" /></div>
    <div v-else-if="items.length === 0" class="card text-center py-12">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><CalendarClock class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum retorno {{ view === 'abertos' ? 'para avisar' : 'aqui' }}</p>
      <p class="text-xs text-slate-500 mt-1 max-w-md mx-auto">
        Defina um intervalo de retorno nos tipos de atendimento (ex.: toxina 120 dias, limpeza 180 dias). Ao concluir o atendimento na agenda, o retorno é criado automaticamente.
      </p>
    </div>
    <div v-else class="space-y-5">
      <section v-for="g in groups" :key="g.key">
        <div class="flex items-baseline gap-2 mb-2">
          <h2 :class="['font-semibold', g.key === 'overdue' ? 'text-amber-700' : 'text-slate-800']">{{ g.label }}</h2>
          <span class="text-xs text-slate-400">{{ g.items.length }}</span>
          <span v-if="g.hint" class="text-xs text-slate-500">· {{ g.hint }}</span>
        </div>
        <div class="card p-0 divide-y divide-slate-100">
          <ReturnRow v-for="r in g.items" :key="r.id" :item="r" show-patient @updated="onUpdated" />
        </div>
      </section>
    </div>
  </div>
</template>
