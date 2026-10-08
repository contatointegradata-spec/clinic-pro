<script setup lang="ts">
import { computed } from 'vue'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { X, Phone, Building2, CalendarDays, UserRound, FolderKanban, ChevronRight } from 'lucide-vue-next'
import { useAttendanceStore } from '../../stores/attendance'
import { LEAD_STATUS_META, avatarColor, describeEvent, displayName, formatPhone, initials } from './format'

const emit = defineEmits<{ close: [] }>()
const store = useAttendanceStore()
const conv = computed(() => store.detail!)
const lead = computed(() => {
  const s = conv.value.patient?.leadStatus
  return s ? LEAD_STATUS_META[s] ?? { label: s, chip: 'bg-slate-100 text-slate-600 ring-slate-200' } : null
})
const nextAppt = computed(() => {
  const a = conv.value.patient?.nextAppointment
  return a ? format(new Date(a.date), "EEE, d 'de' MMM · HH:mm", { locale: ptBR }) : null
})
const timeline = computed(() => [...store.events].reverse())

function ago(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
}
</script>

<template>
  <aside class="flex flex-col h-full min-h-0 bg-white" aria-label="Detalhes do contato">
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <p class="text-sm font-semibold text-slate-900">Detalhes</p>
      <button class="btn-icon w-8 h-8" aria-label="Fechar detalhes" @click="emit('close')">
        <X class="w-4 h-4" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Contato -->
      <section class="px-4 py-5 text-center border-b border-slate-100">
        <img v-if="conv.contactAvatar" :src="conv.contactAvatar" alt="" class="w-14 h-14 rounded-full object-cover mx-auto" />
        <div v-else :class="['w-14 h-14 rounded-full flex items-center justify-center text-base font-semibold mx-auto', avatarColor(conv.contactPhone)]">
          {{ initials(displayName(conv)) }}
        </div>
        <p class="text-sm font-semibold text-slate-900 mt-3">{{ displayName(conv) }}</p>
        <span v-if="lead" :class="['inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1', lead.chip]">{{ lead.label }}</span>
        <div class="mt-3 space-y-1.5 text-xs text-slate-500">
          <p class="flex items-center justify-center gap-1.5"><Phone class="w-3.5 h-3.5" />{{ formatPhone(conv.contactPhone) }}</p>
          <p class="flex items-center justify-center gap-1.5"><Building2 class="w-3.5 h-3.5" />{{ conv.room.name }}</p>
        </div>
      </section>

      <!-- Paciente / atalhos -->
      <section class="px-4 py-4 border-b border-slate-100 space-y-3">
        <div class="flex items-start gap-2.5">
          <CalendarDays class="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium">Próxima consulta</p>
            <p class="text-sm text-slate-700 mt-0.5 capitalize-first">{{ nextAppt ?? 'Nenhuma agendada' }}</p>
          </div>
        </div>
        <p v-if="!conv.patient" class="text-xs text-slate-400">Contato ainda não vinculado a um paciente.</p>

        <nav class="space-y-1 pt-1">
          <router-link v-if="conv.patient" to="/pacientes" class="flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <UserRound class="w-4 h-4 text-slate-400" /><span class="flex-1">Ver paciente</span><ChevronRight class="w-4 h-4 text-slate-300" />
          </router-link>
          <router-link to="/agente/crm" class="flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <FolderKanban class="w-4 h-4 text-slate-400" /><span class="flex-1">Abrir no CRM</span><ChevronRight class="w-4 h-4 text-slate-300" />
          </router-link>
          <router-link to="/agenda" class="flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <CalendarDays class="w-4 h-4 text-slate-400" /><span class="flex-1">Agendar consulta</span><ChevronRight class="w-4 h-4 text-slate-300" />
          </router-link>
        </nav>
      </section>

      <!-- Histórico -->
      <section class="px-4 py-4">
        <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-3">Histórico</p>
        <p v-if="!timeline.length" class="text-xs text-slate-400">Sem eventos.</p>
        <ol v-else class="relative border-l border-slate-200 ml-1 space-y-4">
          <li v-for="e in timeline" :key="e.id" class="pl-4 relative">
            <span class="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-slate-300 ring-2 ring-white" />
            <p class="text-xs text-slate-700 leading-snug">{{ describeEvent(e) }}</p>
            <p v-if="e.note" class="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg px-2 py-1.5 whitespace-pre-wrap break-words">{{ e.note }}</p>
            <p class="text-[11px] text-slate-400 mt-0.5">{{ ago(e.createdAt) }}</p>
          </li>
        </ol>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.capitalize-first::first-letter { text-transform: uppercase; }
</style>
