<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { differenceInYears, parseISO } from 'date-fns'
import { ArrowLeft, Smile, Sparkles, Camera, FileText, CalendarClock, ClipboardList, Phone, MessageCircle } from 'lucide-vue-next'
import api from '../lib/api'
import toast from '../lib/toast'
import type { Patient } from '../types'
import { useAuthStore } from '../stores/auth'
import { whatsappLink } from '../lib/clinical'
import DentalChart from '../components/clinical/DentalChart.vue'
import AestheticMap from '../components/clinical/AestheticMap.vue'
import PhotoGallery from '../components/clinical/PhotoGallery.vue'
import PatientPlans from '../components/clinical/PatientPlans.vue'
import PatientReturns from '../components/clinical/PatientReturns.vue'

type TabKey = 'odontograma' | 'harmonizacao' | 'fotos' | 'orcamentos' | 'retornos'

const TABS: Array<{ key: TabKey; label: string; icon: typeof Smile }> = [
  { key: 'odontograma', label: 'Odontograma', icon: Smile },
  { key: 'harmonizacao', label: 'Harmonização', icon: Sparkles },
  { key: 'fotos', label: 'Antes e depois', icon: Camera },
  { key: 'orcamentos', label: 'Orçamentos', icon: FileText },
  { key: 'retornos', label: 'Retornos', icon: CalendarClock },
]

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const patientId = computed(() => String(route.params.id))
const patient = ref<Patient | null>(null)
const loading = ref(true)

// Aba inicial: a da URL; sem ela, odontograma para dentistas e harmonização
// para as demais especialidades.
function defaultTab(): TabKey {
  const fromUrl = route.query.aba
  if (typeof fromUrl === 'string' && TABS.some(t => t.key === fromUrl)) return fromUrl as TabKey
  const specialty = (auth.user?.specialty ?? '').toLowerCase()
  return /odont|dent|ortod|implant|endod|periodon/.test(specialty) ? 'odontograma' : 'harmonizacao'
}
const tab = ref<TabKey>(defaultTab())

watch(tab, (value) => {
  router.replace({ query: { ...route.query, aba: value } })
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<Patient>(`/patients/${patientId.value}`)
    patient.value = data
  } catch {
    toast.error('Paciente não encontrada')
    router.replace('/pacientes')
  } finally {
    loading.value = false
  }
}
watch(patientId, load, { immediate: true })

const age = computed(() => {
  if (!patient.value?.birthDate) return null
  try { return differenceInYears(new Date(), parseISO(patient.value.birthDate)) } catch { return null }
})
const initials = computed(() => (patient.value?.name ?? '').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase())
</script>

<template>
  <div class="space-y-5 animate-page-enter">
    <button class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-700" @click="router.back()">
      <ArrowLeft class="w-4 h-4" /> Voltar
    </button>

    <!-- Cabeçalho da paciente -->
    <div class="card flex flex-wrap items-center gap-4">
      <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white font-display text-xl font-semibold flex items-center justify-center shadow-md shadow-primary-600/20">
        {{ initials || '·' }}
      </div>
      <div class="min-w-0 flex-1">
        <div v-if="loading" class="h-6 w-48 skeleton" />
        <template v-else-if="patient">
          <h1 class="font-display text-2xl font-semibold text-slate-900 truncate">{{ patient.name }}</h1>
          <p class="text-sm text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
            <span v-if="age !== null">{{ age }} anos</span>
            <span v-if="patient.phone" class="inline-flex items-center gap-1"><Phone class="w-3.5 h-3.5" /> {{ patient.phone }}</span>
            <span>Ficha clínica</span>
          </p>
        </template>
      </div>
      <div v-if="patient" class="flex flex-wrap gap-2">
        <a v-if="patient.phone" :href="whatsappLink(patient.phone, `Olá, ${patient.name.split(' ')[0]}!`)" target="_blank" rel="noopener" class="btn-secondary text-sm"><MessageCircle class="w-4 h-4" /> WhatsApp</a>
        <router-link :to="`/prontuario?paciente=${patient.id}`" class="btn-secondary text-sm"><ClipboardList class="w-4 h-4" /> Prontuário</router-link>
      </div>
    </div>

    <!-- Abas -->
    <div class="overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
      <div class="inline-flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 min-w-max" role="tablist">
        <button
          v-for="t in TABS" :key="t.key"
          role="tab" :aria-selected="tab === t.key"
          :class="['inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors', tab === t.key ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50']"
          @click="tab = t.key"
        >
          <component :is="t.icon" class="w-4 h-4" />
          {{ t.label }}
        </button>
      </div>
    </div>

    <template v-if="patient">
      <DentalChart v-if="tab === 'odontograma'" :key="`d-${patient.id}`" :patient-id="patient.id" />
      <AestheticMap v-else-if="tab === 'harmonizacao'" :key="`a-${patient.id}`" :patient-id="patient.id" />
      <PhotoGallery v-else-if="tab === 'fotos'" :key="`f-${patient.id}`" :patient-id="patient.id" />
      <PatientPlans v-else-if="tab === 'orcamentos'" :key="`o-${patient.id}`" :patient-id="patient.id" />
      <PatientReturns v-else-if="tab === 'retornos'" :key="`r-${patient.id}`" :patient-id="patient.id" />
    </template>
  </div>
</template>
