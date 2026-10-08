<script setup lang="ts">
import { ref, computed } from 'vue'
import { MessageCircle, CalendarPlus, Check, X, RotateCcw } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { type ScheduledReturn, type ReturnStatus, RETURN_STATUS, dayLabel, daysUntil, whatsappLink } from '../../lib/clinical'

const props = defineProps<{ item: ScheduledReturn; showPatient?: boolean }>()
const emit = defineEmits<{ updated: [item: ScheduledReturn] }>()

const busy = ref(false)
const open = computed(() => ['PENDENTE', 'AVISADO'].includes(props.item.status))
const diff = computed(() => daysUntil(props.item.dueDate))
const dueText = computed(() => {
  if (!open.value) return dayLabel(props.item.dueDate)
  if (diff.value === 0) return 'Vence hoje'
  if (diff.value < 0) return `Venceu há ${-diff.value} dia(s)`
  return `Em ${diff.value} dia(s) · ${dayLabel(props.item.dueDate)}`
})

const message = computed(() => {
  const first = props.item.patient.name.split(' ')[0]
  return `Olá, ${first}! Tudo bem? Já está chegando a hora do seu retorno de ${props.item.procedureName}. Vamos agendar? É só me dizer o melhor dia e horário. 😊`
})

async function setStatus(status: ReturnStatus) {
  busy.value = true
  try {
    const { data } = await api.patch<ScheduledReturn>(`/clinical/returns/${props.item.id}`, { status })
    emit('updated', data)
  } catch {
    toast.error('Não foi possível atualizar o retorno')
  } finally {
    busy.value = false
  }
}

function notifyWhatsApp() {
  window.open(whatsappLink(props.item.patient.phone, message.value), '_blank', 'noopener')
  if (props.item.status === 'PENDENTE') setStatus('AVISADO')
}
</script>

<template>
  <div class="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold text-slate-800 truncate">
        <router-link v-if="showPatient" :to="`/pacientes/${item.patient.id}/clinico?aba=retornos`" class="hover:text-primary-700 hover:underline">{{ item.patient.name }}</router-link>
        <template v-if="showPatient"> · </template>{{ item.procedureName }}
      </p>
      <p :class="['text-xs', open && diff < 0 ? 'text-amber-700 font-medium' : 'text-slate-500']">
        {{ dueText }}<template v-if="item.notes"> · {{ item.notes }}</template>
      </p>
    </div>
    <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', RETURN_STATUS[item.status].chip]">{{ RETURN_STATUS[item.status].label }}</span>
    <div class="flex items-center gap-1.5">
      <template v-if="open">
        <button v-if="item.patient.phone" class="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2.5 py-1.5" :disabled="busy" @click="notifyWhatsApp"><MessageCircle class="w-3.5 h-3.5" /> Avisar</button>
        <router-link :to="`/agenda?paciente=${item.patient.id}`" class="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg px-2.5 py-1.5"><CalendarPlus class="w-3.5 h-3.5" /> Agendar</router-link>
        <button class="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Marcar como agendado" :disabled="busy" @click="setStatus('AGENDADO')"><Check class="w-4 h-4" /></button>
        <button class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Descartar" :disabled="busy" @click="setStatus('DESCARTADO')"><X class="w-4 h-4" /></button>
      </template>
      <button v-else class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Reabrir" :disabled="busy" @click="setStatus('PENDENTE')"><RotateCcw class="w-4 h-4" /></button>
    </div>
  </div>
</template>
