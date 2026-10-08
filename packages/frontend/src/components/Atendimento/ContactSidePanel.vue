<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  X, Phone, Building2, CalendarDays, UserRound, FolderKanban, ChevronRight, Pencil, Link2, Unlink, CalendarPlus, Check,
} from 'lucide-vue-next'
import { useAttendanceStore } from '../../stores/attendance'
import { LEAD_STATUS_META, PATIENT_STATUS_META, avatarColor, describeEvent, displayName, formatPhone, initials } from './format'
import LinkPatientModal from './LinkPatientModal.vue'
import ScheduleAppointmentModal from './ScheduleAppointmentModal.vue'
import toast from '../../lib/toast'

const emit = defineEmits<{ close: [] }>()
const store = useAttendanceStore()
const conv = computed(() => store.detail!)
const patient = computed(() => conv.value.patient)
const canEdit = computed(() => conv.value.canReply)

const lead = computed(() => {
  const s = patient.value?.leadStatus
  return s ? LEAD_STATUS_META[s] ?? { label: s, chip: 'bg-slate-100 text-slate-600 ring-slate-200' } : null
})
const patientStatus = computed(() => (patient.value ? PATIENT_STATUS_META[patient.value.status] ?? null : null))
const isPreRegistration = computed(() => patient.value?.status === 'PRE_CADASTRO')
const nextAppt = computed(() => {
  const a = patient.value?.nextAppointment
  return a ? format(new Date(a.date), "EEE, dd/MM/yyyy · HH:mm", { locale: ptBR }) : null
})
const timeline = computed(() => [...store.events].reverse())

function ago(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
}

// ─── Nome do contato ─────────────────────────────────────────────────
const editingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const savingName = ref(false)

function startEditName() {
  nameDraft.value = conv.value.contactName ?? ''
  editingName.value = true
  nextTick(() => nameInput.value?.select())
}
async function saveName() {
  if (savingName.value) return
  const value = nameDraft.value.trim()
  if (value === (conv.value.contactName ?? '')) { editingName.value = false; return }
  savingName.value = true
  const ok = await store.updateContactName(value || null)
  savingName.value = false
  if (ok) editingName.value = false
}
watch(() => store.selectedId, () => { editingName.value = false })

// ─── Paciente ────────────────────────────────────────────────────────
const linkOpen = ref(false)
const scheduleOpen = ref(false)

async function unlink() {
  if (!patient.value) return
  if (!confirm(`Desvincular ${patient.value.name} desta conversa? O cadastro do paciente não é alterado.`)) return
  if (await store.unlinkPatient()) toast.success('Paciente desvinculado')
}

function schedule() {
  if (!patient.value) {
    toast('Vincule ou crie o paciente antes de agendar')
    if (canEdit.value) linkOpen.value = true
    return
  }
  scheduleOpen.value = true
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

        <form v-if="editingName" class="mt-3 flex items-center gap-1.5" @submit.prevent="saveName">
          <input
            ref="nameInput"
            v-model="nameDraft"
            maxlength="120"
            class="input-field py-1.5 text-sm text-center"
            placeholder="Vazio = nome do WhatsApp"
            aria-label="Nome do contato"
            @keydown.esc.prevent="editingName = false"
          />
          <button type="submit" class="btn-icon w-8 h-8 flex-shrink-0" :disabled="savingName" aria-label="Salvar nome"><Check class="w-4 h-4" /></button>
          <button type="button" class="btn-icon w-8 h-8 flex-shrink-0" aria-label="Cancelar" @click="editingName = false"><X class="w-4 h-4" /></button>
        </form>
        <template v-else>
          <p class="text-sm font-semibold text-slate-900 mt-3 inline-flex items-center gap-1">
            {{ displayName(conv) }}
            <button v-if="canEdit && !patient" class="text-slate-300 hover:text-slate-600" aria-label="Editar nome do contato" title="Editar nome do contato" @click="startEditName">
              <Pencil class="w-3.5 h-3.5" />
            </button>
          </p>
          <p v-if="patient" class="text-[11px] text-slate-400 mt-0.5 inline-flex items-center justify-center gap-1 w-full">
            No WhatsApp: {{ conv.contactName || '—' }}
            <button v-if="canEdit" class="text-slate-300 hover:text-slate-600" aria-label="Editar nome do contato" title="Editar nome do contato" @click="startEditName">
              <Pencil class="w-3 h-3" />
            </button>
          </p>
        </template>

        <div class="mt-3 space-y-1.5 text-xs text-slate-500">
          <p class="flex items-center justify-center gap-1.5"><Phone class="w-3.5 h-3.5" />{{ formatPhone(conv.contactPhone) || 'Telefone não identificado' }}</p>
          <p class="flex items-center justify-center gap-1.5"><Building2 class="w-3.5 h-3.5" />{{ conv.room.name }}</p>
        </div>
      </section>

      <!-- Paciente -->
      <section class="px-4 py-4 border-b border-slate-100 space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium">Paciente</p>
          <div v-if="canEdit" class="flex items-center gap-1">
            <button class="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1" @click="linkOpen = true">
              <Link2 class="w-3 h-3" />{{ patient ? 'Trocar' : 'Vincular' }}
            </button>
            <button v-if="patient" class="text-[11px] text-slate-400 hover:text-red-600 inline-flex items-center gap-1 ml-2" @click="unlink">
              <Unlink class="w-3 h-3" />Desvincular
            </button>
          </div>
        </div>

        <div v-if="patient">
          <p class="text-sm text-slate-800">{{ patient.name }}</p>
          <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span v-if="patientStatus" :class="['inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1', patientStatus.chip]">{{ patientStatus.label }}</span>
            <span v-if="lead" :class="['inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1', lead.chip]">{{ lead.label }}</span>
          </div>
          <router-link
            v-if="isPreRegistration"
            :to="{ path: '/pacientes', query: { patient: patient.id } }"
            class="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline"
          >
            Completar cadastro <ChevronRight class="w-3.5 h-3.5" />
          </router-link>
        </div>
        <p v-else class="text-xs text-slate-400">
          Contato ainda não vinculado a um paciente.
          <button v-if="canEdit" class="text-primary-600 hover:underline" @click="linkOpen = true">Vincular ou criar</button>
        </p>

        <div class="flex items-start gap-2.5 pt-1">
          <CalendarDays class="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div class="min-w-0">
            <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium">Próxima consulta</p>
            <p class="text-sm text-slate-700 mt-0.5 capitalize-first">{{ nextAppt ?? (patient ? 'Nenhuma agendada' : '—') }}</p>
          </div>
        </div>

        <nav class="space-y-1 pt-1">
          <button class="w-full flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900" @click="schedule">
            <CalendarPlus class="w-4 h-4 text-slate-400" /><span class="flex-1 text-left">Agendar consulta</span><ChevronRight class="w-4 h-4 text-slate-300" />
          </button>
          <router-link v-if="patient" :to="{ path: '/pacientes', query: { patient: patient.id } }" class="flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <UserRound class="w-4 h-4 text-slate-400" /><span class="flex-1">Ver paciente</span><ChevronRight class="w-4 h-4 text-slate-300" />
          </router-link>
          <router-link to="/agente/crm" class="flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900">
            <FolderKanban class="w-4 h-4 text-slate-400" /><span class="flex-1">Abrir no CRM</span><ChevronRight class="w-4 h-4 text-slate-300" />
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

    <LinkPatientModal :is-open="linkOpen" @close="linkOpen = false" />
    <ScheduleAppointmentModal :is-open="scheduleOpen" @close="scheduleOpen = false" />
  </aside>
</template>

<style scoped>
.capitalize-first::first-letter { text-transform: uppercase; }
</style>
