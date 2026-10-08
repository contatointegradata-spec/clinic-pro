<script setup lang="ts">
import { ref, reactive } from 'vue'
import { Plus, CalendarClock, Trash2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import ReturnRow from './ReturnRow.vue'
import { type ScheduledReturn, todayInput } from '../../lib/clinical'

const props = defineProps<{ patientId: string }>()

const items = ref<ScheduledReturn[]>([])
const loading = ref(true)
const adding = ref(false)
const saving = ref(false)
const form = reactive({ procedureName: '', dueDate: todayInput(), notes: '' })

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<ScheduledReturn[]>(`/clinical/patients/${props.patientId}/returns`)
    items.value = data
  } catch {
    toast.error('Não foi possível carregar os retornos')
  } finally {
    loading.value = false
  }
}
load()

async function add() {
  if (!form.procedureName) { toast.error('Informe o procedimento'); return }
  saving.value = true
  try {
    const { data } = await api.post<ScheduledReturn>(`/clinical/patients/${props.patientId}/returns`, {
      procedureName: form.procedureName,
      dueDate: form.dueDate,
      notes: form.notes || null,
    })
    items.value = [data, ...items.value].sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    adding.value = false
    form.procedureName = ''
    form.notes = ''
    toast.success('Retorno programado')
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

async function remove(r: ScheduledReturn) {
  if (!confirm('Excluir este retorno?')) return
  try {
    await api.delete(`/clinical/returns/${r.id}`)
    items.value = items.value.filter(x => x.id !== r.id)
  } catch {
    toast.error('Não foi possível excluir')
  }
}
function onUpdated(r: ScheduledReturn) {
  const i = items.value.findIndex(x => x.id === r.id)
  if (i >= 0) items.value[i] = r
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="font-display text-lg font-semibold text-slate-900">Retornos programados</h3>
        <p class="text-sm text-slate-500">Criados ao concluir procedimentos com intervalo de retorno (ex.: toxina, limpeza) ou manualmente.</p>
      </div>
      <button class="btn-primary" @click="adding = !adding"><Plus class="w-4 h-4" /> Programar retorno</button>
    </div>

    <form v-if="adding" class="card grid sm:grid-cols-[1fr_180px] gap-4" @submit.prevent="add">
      <div>
        <label class="label">Procedimento</label>
        <input v-model="form.procedureName" class="input-field" placeholder="Ex.: Reaplicação de toxina, Manutenção do aparelho" />
      </div>
      <div>
        <label class="label">Data do retorno</label>
        <input v-model="form.dueDate" type="date" class="input-field" />
      </div>
      <div class="sm:col-span-2">
        <label class="label">Observações</label>
        <input v-model="form.notes" class="input-field" placeholder="Opcional" />
      </div>
      <div class="sm:col-span-2 flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="adding = false">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Salvando…' : 'Salvar retorno' }}</button>
      </div>
    </form>

    <div v-if="loading" class="h-24 skeleton" />
    <div v-else-if="items.length === 0" class="card text-center py-10">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><CalendarClock class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum retorno programado</p>
      <p class="text-xs text-slate-500 mt-1">Configure o intervalo de retorno em Configurações › Tipos de atendimento.</p>
    </div>
    <div v-else class="card p-0 divide-y divide-slate-100">
      <div v-for="r in items" :key="r.id" class="flex items-center">
        <ReturnRow :item="r" class="flex-1 min-w-0" @updated="onUpdated" />
        <button class="mr-3 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Excluir" @click="remove(r)"><Trash2 class="w-3.5 h-3.5" /></button>
      </div>
    </div>
  </div>
</template>
