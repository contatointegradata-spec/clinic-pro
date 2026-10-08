<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import AppointmentForm, { type AppointmentFormData } from '../Agenda/AppointmentForm.vue'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useQuery } from '../../composables/useQuery'
import { useAuthStore } from '../../stores/auth'
import { useAttendanceStore } from '../../stores/attendance'
import { errorMessage } from './format'
import type { AppointmentType, Patient, Room, User } from '../../types'

// "Agendar consulta" pelo Atendimento: o mesmo formulário da Agenda, já com
// o paciente vinculado à conversa selecionado.

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const store = useAttendanceStore()
const enabled = computed(() => props.isOpen)

// Mesmas chaves de cache da Agenda (useQuery compartilha o cache).
const { data: doctorsData } = useQuery<User[]>({ key: 'doctors', queryFn: () => api.get('/doctors').then(r => r.data), enabled })
const { data: patientsData, refetch: refetchPatients } = useQuery<Patient[]>({ key: 'patients', queryFn: () => api.get('/patients').then(r => r.data), enabled })
const { data: typesData } = useQuery<AppointmentType[]>({ key: 'appointment-types', queryFn: () => api.get('/appointment-types').then(r => r.data), enabled })
const { data: roomsData } = useQuery<Room[]>({ key: 'rooms', queryFn: () => api.get('/rooms').then(r => r.data), enabled })

// O paciente vinculado pode não vir na lista (ex.: inativo) — garante que esteja.
const linked = ref<Patient | null>(null)
const patients = computed(() => {
  const list = patientsData.value ?? []
  return linked.value && !list.some(p => p.id === linked.value!.id) ? [...list, linked.value] : list
})

const patientId = computed(() => store.detail?.patient?.id ?? null)
const defaultDate = ref<Date>(new Date())
const saving = ref(false)

watch(() => props.isOpen, async open => {
  if (!open) return
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0) // próxima hora cheia (nunca no passado)
  defaultDate.value = d
  linked.value = null
  refetchPatients()
  if (patientId.value) {
    try { linked.value = (await api.get<Patient>(`/patients/${patientId.value}`)).data } catch { /* a lista resolve */ }
  }
})

async function save(payload: Record<string, unknown>) {
  saving.value = true
  try {
    await api.post('/appointments', payload)
  } catch (e) {
    saving.value = false
    const data = (e as { response?: { data?: { code?: string; message?: string } } })?.response?.data
    if (data?.code === 'OVERLAP_WARNING') {
      if (window.confirm(`${data.message ?? 'Este horário conflita com outro atendimento.'}\n\nAgendar mesmo assim?`)) {
        return save({ ...payload, forceOverlap: true })
      }
      return
    }
    toast.error(errorMessage(e, 'Erro ao agendar consulta'))
    return
  }
  saving.value = false
  toast.success('Consulta agendada!')
  store.refreshDetail()
  store.fetchEvents()
  emit('close')
}

function onSubmit(data: AppointmentFormData) {
  save({ ...data, date: new Date(data.date).toISOString() })
}

function onPatientCreated() {
  refetchPatients()
}
</script>

<template>
  <Modal :is-open="isOpen" title="Agendar consulta" :subtitle="store.detail?.patient?.name" size="lg" @close="emit('close')">
    <AppointmentForm
      v-if="isOpen"
      :appointment="null"
      :default-date="defaultDate"
      :default-patient-id="patientId"
      :doctors="doctorsData ?? []"
      :patients="patients"
      :appointment-types="typesData ?? []"
      :rooms="roomsData ?? []"
      :current-user="auth.user"
      :loading="saving"
      @submit="onSubmit"
      @patient-created="onPatientCreated"
    />
  </Modal>
</template>
