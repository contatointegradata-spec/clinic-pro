<script setup lang="ts">
// Ficha completa da paciente — o ponto central do atendimento. Reúne o que
// antes ficava espalhado em menus: prontuário, odontograma, harmonização,
// orçamentos, pagamentos, documentos, fotos e retornos.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { differenceInMonths, parseISO, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowLeft, CalendarPlus, Pencil, MessageCircle, AlertTriangle, Cake, MoreHorizontal, Download, ShieldOff,
  LayoutGrid, ClipboardList, Smile, Sparkles, FileText, Wallet, FileSignature, Camera, Plus, CalendarClock, ChevronRight,
} from 'lucide-vue-next'
import api from '../lib/api'
import toast from '../lib/toast'
import type { Patient } from '../types'
import { useAuthStore } from '../stores/auth'
import { brl, dayLabel, whatsappLink, daysUntil, PLAN_STATUS } from '../lib/clinical'
import Modal from '../components/ui/Modal.vue'
import PatientForm from '../components/Patients/PatientForm.vue'
import PatientRecords from '../components/patient/PatientRecords.vue'
import PatientPayments from '../components/patient/PatientPayments.vue'
import PatientDocuments from '../components/patient/PatientDocuments.vue'
import DentalChart from '../components/clinical/DentalChart.vue'
import AestheticMap from '../components/clinical/AestheticMap.vue'
import PhotoGallery from '../components/clinical/PhotoGallery.vue'
import PatientPlans from '../components/clinical/PatientPlans.vue'
import PatientReturns from '../components/clinical/PatientReturns.vue'

type TabKey = 'geral' | 'prontuario' | 'odontograma' | 'harmonizacao' | 'orcamentos' | 'pagamentos' | 'documentos' | 'fotos' | 'retornos'

interface Overview {
  patient: Omit<Patient, 'patientPlans'> & { patientPlans: Array<{ walletNumber: string | null; healthPlanId: string; healthPlan: { name: string; type: string } }> }
  upcomingAppointments: Array<{ id: string; date: string; type: string | null; title: string; status: string; room: { name: string } | null; doctor: { name: string } }>
  lastVisit: { date: string; type: string | null } | null
  appointments: { total: number; completed: number; noShow: number; cancelled: number }
  recentRecords: Array<{ id: string; type: string; title: string; date: string; procedures: Array<{ name: string }> }>
  healthAlerts: string[]
  lastAnamneseAt: string | null
  openPlans: Array<{ id: string; title: string; status: 'ENVIADO' | 'APROVADO'; total: number; sessions: number; sessionsDone: number }>
  openReturns: Array<{ id: string; procedureName: string; dueDate: string; status: string }>
  financial: { paid: number; pending: number }
  counts: { photos: number; documents: number; dentalEntries: number; applications: number; records: number }
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const patientId = computed(() => String(route.params.id))
const data = ref<Overview | null>(null)
const loading = ref(true)

const isDental = computed(() => /odont|dent|ortod|implant|endod|periodon/i.test(auth.user?.specialty ?? ''))

const TABS = computed(() => {
  const c = data.value?.counts
  const all: Array<{ key: TabKey; label: string; icon: typeof Smile; badge?: number | string }> = [
    { key: 'geral', label: 'Visão geral', icon: LayoutGrid },
    { key: 'prontuario', label: 'Prontuário', icon: ClipboardList, badge: c?.records || undefined },
    { key: 'odontograma', label: 'Odontograma', icon: Smile },
    { key: 'harmonizacao', label: 'Harmonização', icon: Sparkles },
    { key: 'orcamentos', label: 'Orçamentos', icon: FileText, badge: data.value?.openPlans.length || undefined },
    { key: 'pagamentos', label: 'Pagamentos', icon: Wallet, badge: data.value && data.value.financial.pending > 0 ? '!' : undefined },
    { key: 'documentos', label: 'Documentos', icon: FileSignature },
    { key: 'fotos', label: 'Fotos', icon: Camera, badge: c?.photos || undefined },
    { key: 'retornos', label: 'Retornos', icon: CalendarClock, badge: data.value?.openReturns.filter(r => r.status !== 'AGENDADO').length || undefined },
  ]
  // Odontograma/harmonização na ordem da especialidade de quem usa.
  if (!isDental.value) {
    const i = all.findIndex(t => t.key === 'odontograma')
    const [odonto] = all.splice(i, 1)
    all.splice(all.findIndex(t => t.key === 'harmonizacao') + 1, 0, odonto)
  }
  return all
})

const tab = ref<TabKey>(((): TabKey => {
  const q = route.query.aba
  return typeof q === 'string' && ['geral', 'prontuario', 'odontograma', 'harmonizacao', 'orcamentos', 'pagamentos', 'documentos', 'fotos', 'retornos'].includes(q) ? q as TabKey : 'geral'
})())
watch(tab, (value) => router.replace({ query: { ...route.query, aba: value === 'geral' ? undefined : value } }))

async function load() {
  loading.value = true
  try {
    const res = await api.get<Overview>(`/clinical/patients/${patientId.value}/overview`)
    data.value = res.data
  } catch {
    toast.error('Paciente não encontrada')
    router.replace('/pacientes')
  } finally {
    loading.value = false
  }
}
watch(patientId, load, { immediate: true })

const p = computed(() => data.value?.patient)
const initials = computed(() => (p.value?.name ?? '').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase())

const ageText = computed(() => {
  if (!p.value?.birthDate) return null
  const months = differenceInMonths(new Date(), parseISO(p.value.birthDate))
  const y = Math.floor(months / 12)
  const m = months % 12
  return m ? `${y} anos e ${m} ${m === 1 ? 'mês' : 'meses'}` : `${y} anos`
})

// Aniversário: hoje / amanhã / em até 7 dias.
const birthdayBadge = computed(() => {
  if (!p.value?.birthDate) return null
  const bd = new Date(p.value.birthDate)
  const now = new Date()
  const next = new Date(now.getFullYear(), bd.getUTCMonth(), bd.getUTCDate())
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (next < start) next.setFullYear(next.getFullYear() + 1)
  const days = Math.round((next.getTime() - start.getTime()) / 86_400_000)
  if (days === 0) return 'Aniversário hoje 🎉'
  if (days === 1) return 'Aniversário amanhã'
  if (days <= 7) return `Aniversário em ${days} dias`
  return null
})

function formatPhone(phone?: string | null) {
  if (!phone) return '—'
  let d = phone.replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return phone
}
function formatCpf(cpf?: string | null) {
  const d = (cpf ?? '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf || '—'
}
function when(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABEL: Record<string, string> = { PRE_CADASTRO: 'Pré-cadastro', INCOMPLETO: 'Cadastro incompleto', INATIVO: 'Inativa' }

// ─── Editar ─────────────────────────────────────────────────────────────────
const editOpen = ref(false)
const editPatient = ref<Patient | null>(null)
const saving = ref(false)
async function openEdit() {
  try {
    const res = await api.get<Patient>(`/patients/${patientId.value}`)
    editPatient.value = res.data
    editOpen.value = true
  } catch {
    toast.error('Não foi possível abrir o cadastro')
  }
}
async function saveEdit(form: Record<string, unknown>) {
  saving.value = true
  try {
    const { consent: _c, ...rest } = form
    await api.put(`/patients/${patientId.value}`, { ...rest, confirmDuplicate: true })
    toast.success('Cadastro atualizado')
    editOpen.value = false
    await load()
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

// ─── LGPD ───────────────────────────────────────────────────────────────────
const menuOpen = ref(false)
async function exportData() {
  menuOpen.value = false
  try {
    const res = await api.get(`/patients/${patientId.value}/export`)
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paciente-${patientId.value}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Dados exportados')
  } catch {
    toast.error('Erro ao exportar dados')
  }
}
const anonymizeOpen = ref(false)
const anonymizing = ref(false)
async function anonymize() {
  anonymizing.value = true
  try {
    await api.post(`/patients/${patientId.value}/anonymize`)
    toast.success('Dados pessoais anonimizados')
    anonymizeOpen.value = false
    await load()
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Erro ao anonimizar')
  } finally {
    anonymizing.value = false
  }
}

const recordsRef = ref<InstanceType<typeof PatientRecords> | null>(null)
function openRecordForm(type: 'EVOLUCAO' | 'ANAMNESE') {
  tab.value = 'prontuario'
  // espera a aba montar o componente do prontuário
  setTimeout(() => recordsRef.value?.openCreate(type), 50)
}
const newEvolution = () => openRecordForm('EVOLUCAO')
const newAnamnese = () => openRecordForm('ANAMNESE')

const infoRows = computed(() => {
  const x = p.value
  if (!x) return []
  const plan = x.patientPlans?.[0]
  return [
    ['Celular', formatPhone(x.phone)],
    ['E-mail', x.email || '—'],
    ['CPF', formatCpf(x.cpf)],
    ['RG', x.rg || '—'],
    ['Data de nascimento', x.birthDate ? `${dayLabel(x.birthDate)}${ageText.value ? ` · ${ageText.value}` : ''}` : '—'],
    ['Endereço', x.address || '—'],
    ['Convênio', plan ? `${plan.healthPlan.name}${plan.walletNumber ? ` · ${plan.walletNumber}` : ''}` : 'Particular'],
    ['Responsável', x.responsibleName ? `${x.responsibleName}${x.responsiblePhone ? ` · ${formatPhone(x.responsiblePhone)}` : ''}` : '—'],
    ['Paciente desde', dayLabel(x.createdAt)],
  ] as Array<[string, string]>
})
</script>

<template>
  <div class="space-y-5">
    <button class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-700" @click="router.push('/pacientes')">
      <ArrowLeft class="w-4 h-4" /> Pacientes
    </button>

    <!-- Cabeçalho -->
    <header class="card p-0 overflow-hidden">
      <div class="p-5 sm:p-6 flex flex-wrap items-start gap-4">
        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-primary-300 to-primary-600 text-white font-display text-2xl font-semibold flex items-center justify-center shadow-md shadow-primary-600/20 flex-shrink-0">
          {{ initials || '·' }}
        </div>
        <div class="min-w-[12rem] flex-1">
          <div v-if="loading && !p" class="space-y-2"><div class="h-7 w-56 skeleton" /><div class="h-4 w-72 skeleton" /></div>
          <template v-else-if="p">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="font-display text-2xl sm:text-[1.7rem] font-semibold text-slate-900">{{ p.name }}</h1>
              <button v-if="data?.healthAlerts.length" class="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1" :title="data.healthAlerts.join(', ')" @click="tab = 'prontuario'">
                <AlertTriangle class="w-3.5 h-3.5" /> {{ data.healthAlerts.length }} alerta{{ data.healthAlerts.length > 1 ? 's' : '' }} de saúde
              </button>
              <span v-if="birthdayBadge" class="inline-flex items-center gap-1 text-xs font-semibold text-gold-800 bg-gold-50 border border-gold-200 rounded-full px-2.5 py-1"><Cake class="w-3.5 h-3.5" /> {{ birthdayBadge }}</span>
              <span v-if="STATUS_LABEL[p.status]" class="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">{{ STATUS_LABEL[p.status] }}</span>
            </div>
            <p class="mt-1.5 text-sm text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
              <a v-if="p.phone" :href="whatsappLink(p.phone, `Olá, ${p.name.split(' ')[0]}!`)" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 hover:text-emerald-700"><MessageCircle class="w-4 h-4" /> {{ formatPhone(p.phone) }}</a>
              <span v-if="p.cpf">CPF {{ formatCpf(p.cpf) }}</span>
              <span v-if="ageText">{{ ageText }}</span>
              <span v-if="data?.lastVisit">Última consulta {{ formatDistanceToNow(new Date(data.lastVisit.date), { locale: ptBR, addSuffix: true }) }}</span>
            </p>
          </template>
        </div>
        <div class="flex items-center gap-2 basis-full sm:basis-auto justify-end sm:justify-start">
          <router-link :to="`/agenda?paciente=${patientId}`" class="btn-secondary" title="Agendar"><CalendarPlus class="w-4 h-4" /> <span class="hidden sm:inline">Agendar</span></router-link>
          <button class="btn-secondary" @click="openEdit"><Pencil class="w-4 h-4" /> <span class="hidden sm:inline">Editar</span></button>
          <div class="relative">
            <button class="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" aria-label="Mais ações" @click="menuOpen = !menuOpen"><MoreHorizontal class="w-4 h-4" /></button>
            <div v-if="menuOpen" class="absolute right-0 top-full mt-1 w-60 rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-30 text-sm">
              <button class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="exportData"><Download class="w-4 h-4 text-slate-400" /> Exportar dados (LGPD)</button>
              <button class="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2" @click="menuOpen = false; anonymizeOpen = true"><ShieldOff class="w-4 h-4" /> Anonimizar dados (LGPD)</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Abas -->
      <nav class="px-3 sm:px-5 border-t border-slate-100 overflow-x-auto scrollbar-none" role="tablist">
        <div class="flex gap-1 min-w-max">
          <button
            v-for="t in TABS" :key="t.key" role="tab" :aria-selected="tab === t.key"
            :class="['relative inline-flex items-center gap-2 px-3.5 py-3 text-sm font-medium transition-colors', tab === t.key ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800']"
            @click="tab = t.key"
          >
            <component :is="t.icon" class="w-4 h-4" />
            {{ t.label }}
            <span v-if="t.badge" :class="['min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center', t.badge === '!' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700']">{{ t.badge }}</span>
            <span v-if="tab === t.key" class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />
          </button>
        </div>
      </nav>
    </header>

    <!-- Conteúdo -->
    <template v-if="data && p">
      <!-- VISÃO GERAL -->
      <div v-if="tab === 'geral'" class="grid lg:grid-cols-[minmax(0,340px)_1fr] gap-5 items-start">
        <div class="space-y-5">
          <section v-if="data.healthAlerts.length" class="rounded-2xl border border-red-200 bg-red-50/70 p-4">
            <p class="text-sm font-semibold text-red-800 flex items-center gap-1.5"><AlertTriangle class="w-4 h-4" /> Atenção na anamnese</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span v-for="a in data.healthAlerts" :key="a" class="text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-full px-2.5 py-0.5">{{ a }}</span>
            </div>
            <button class="mt-2 text-xs font-semibold text-red-700 hover:underline" @click="tab = 'prontuario'">Ver anamnese<template v-if="data.lastAnamneseAt"> de {{ new Date(data.lastAnamneseAt).toLocaleDateString('pt-BR') }}</template></button>
          </section>
          <section v-else-if="!data.lastAnamneseAt" class="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800">
            Nenhuma anamnese registrada.
            <button class="font-semibold hover:underline" @click="newAnamnese">Preencher agora</button>
          </section>

          <section class="card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-semibold text-slate-900">Informações</h2>
              <button class="text-xs font-semibold text-primary-700 hover:underline" @click="openEdit">Editar</button>
            </div>
            <dl class="space-y-3">
              <div v-for="[label, value] in infoRows" :key="label">
                <dt class="text-xs text-slate-400">{{ label }}</dt>
                <dd class="text-sm text-slate-800 break-words">{{ value }}</dd>
              </div>
              <div v-if="p.notes">
                <dt class="text-xs text-slate-400">Observações</dt>
                <dd class="text-sm text-slate-800 whitespace-pre-line">{{ p.notes }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="space-y-5 min-w-0">
          <!-- Números rápidos -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button class="card p-4 text-left hover:shadow-md transition-shadow" @click="tab = 'prontuario'">
              <p class="text-xs text-slate-400">Atendimentos</p>
              <p class="font-display text-2xl font-semibold tabular-nums">{{ data.appointments.completed }}</p>
              <p v-if="data.appointments.noShow" class="text-[11px] text-amber-700">{{ data.appointments.noShow }} falta(s)</p>
            </button>
            <button class="card p-4 text-left hover:shadow-md transition-shadow" @click="tab = 'pagamentos'">
              <p class="text-xs text-slate-400">Total pago</p>
              <p class="font-display text-xl font-semibold tabular-nums text-emerald-700">{{ brl(data.financial.paid) }}</p>
              <p v-if="data.financial.pending" class="text-[11px] text-amber-700">{{ brl(data.financial.pending) }} em aberto</p>
            </button>
            <button class="card p-4 text-left hover:shadow-md transition-shadow" @click="tab = 'orcamentos'">
              <p class="text-xs text-slate-400">Orçamentos ativos</p>
              <p class="font-display text-2xl font-semibold tabular-nums">{{ data.openPlans.length }}</p>
            </button>
            <button class="card p-4 text-left hover:shadow-md transition-shadow" @click="tab = 'fotos'">
              <p class="text-xs text-slate-400">Fotos</p>
              <p class="font-display text-2xl font-semibold tabular-nums">{{ data.counts.photos }}</p>
            </button>
          </div>

          <!-- Próximos horários -->
          <section class="card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-semibold text-slate-900">Próximos horários</h2>
              <router-link :to="`/agenda?paciente=${patientId}`" class="text-xs font-semibold text-primary-700 hover:underline">+ Agendar</router-link>
            </div>
            <p v-if="!data.upcomingAppointments.length" class="text-sm text-slate-500">Nenhum horário marcado.</p>
            <ul v-else class="divide-y divide-slate-100">
              <li v-for="a in data.upcomingAppointments" :key="a.id" class="py-2.5 flex items-center gap-3">
                <span class="text-sm font-semibold text-slate-800 tabular-nums w-40 capitalize">{{ when(a.date) }}</span>
                <span class="text-sm text-slate-600 flex-1 truncate">{{ a.type || a.title }}<template v-if="a.room"> · {{ a.room.name }}</template></span>
                <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', a.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600']">{{ a.status === 'CONFIRMED' ? 'Confirmado' : 'Agendado' }}</span>
              </li>
            </ul>
          </section>

          <!-- Odontograma resumido (dentistas ou quem já tem registros) -->
          <section v-if="isDental || data.counts.dentalEntries > 0">
            <DentalChart :key="`dc-${patientId}`" :patient-id="patientId" compact />
          </section>

          <!-- Retornos e orçamentos -->
          <div class="grid md:grid-cols-2 gap-5">
            <section class="card">
              <div class="flex items-center justify-between mb-3">
                <h2 class="font-semibold text-slate-900">Retornos</h2>
                <button class="text-xs font-semibold text-primary-700 hover:underline" @click="tab = 'retornos'">Ver todos</button>
              </div>
              <p v-if="!data.openReturns.length" class="text-sm text-slate-500">Nenhum retorno programado.</p>
              <ul v-else class="space-y-2">
                <li v-for="r in data.openReturns.slice(0, 4)" :key="r.id" class="flex items-center justify-between gap-2 text-sm">
                  <span class="truncate text-slate-700">{{ r.procedureName }}</span>
                  <span :class="['text-xs font-semibold whitespace-nowrap', r.status === 'AGENDADO' ? 'text-emerald-700' : daysUntil(r.dueDate) < 0 ? 'text-amber-700' : 'text-slate-500']">
                    {{ r.status === 'AGENDADO' ? 'agendado' : dayLabel(r.dueDate) }}
                  </span>
                </li>
              </ul>
            </section>
            <section class="card">
              <div class="flex items-center justify-between mb-3">
                <h2 class="font-semibold text-slate-900">Orçamentos e tratamentos</h2>
                <button class="text-xs font-semibold text-primary-700 hover:underline" @click="tab = 'orcamentos'">Abrir</button>
              </div>
              <p v-if="!data.openPlans.length" class="text-sm text-slate-500">Nenhum orçamento em andamento.</p>
              <ul v-else class="space-y-3">
                <li v-for="pl in data.openPlans.slice(0, 3)" :key="pl.id">
                  <div class="flex items-center justify-between gap-2 text-sm">
                    <span class="truncate text-slate-700">{{ pl.title }}</span>
                    <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', PLAN_STATUS[pl.status].chip]">{{ PLAN_STATUS[pl.status].label }}</span>
                  </div>
                  <div v-if="pl.status === 'APROVADO'" class="mt-1.5 flex items-center gap-2">
                    <div class="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-emerald-500" :style="{ width: `${pl.sessions ? (pl.sessionsDone / pl.sessions) * 100 : 0}%` }" /></div>
                    <span class="text-[11px] text-slate-500 tabular-nums">{{ pl.sessionsDone }}/{{ pl.sessions }}</span>
                  </div>
                </li>
              </ul>
            </section>
          </div>

          <!-- Últimas evoluções -->
          <section class="card">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-semibold text-slate-900">Últimas evoluções</h2>
              <button v-if="auth.user?.role !== 'SECRETARY'" class="btn-secondary text-xs py-1.5" @click="newEvolution"><Plus class="w-3.5 h-3.5" /> Adicionar</button>
            </div>
            <p v-if="!data.recentRecords.length" class="text-sm text-slate-500">Nada registrado ainda.</p>
            <ul v-else class="divide-y divide-slate-100">
              <li v-for="r in data.recentRecords" :key="r.id">
                <button class="w-full py-2.5 flex items-center gap-4 text-left group" @click="tab = 'prontuario'">
                  <div class="w-10 text-center">
                    <p class="text-sm font-bold text-slate-800 leading-none">{{ new Date(r.date).getDate() }}</p>
                    <p class="text-[10px] uppercase text-slate-400">{{ new Date(r.date).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate group-hover:text-primary-700">{{ r.title }}</p>
                    <p v-if="r.procedures.length" class="text-xs text-slate-500 truncate">{{ r.procedures.map(x => x.name).join(' · ') }}</p>
                  </div>
                  <ChevronRight class="w-4 h-4 text-slate-300" />
                </button>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <PatientRecords v-else-if="tab === 'prontuario'" ref="recordsRef" :key="`pr-${patientId}`" :patient-id="patientId" :health-plan-id="p.patientPlans?.[0]?.healthPlanId ?? null" @changed="load" />
      <DentalChart v-else-if="tab === 'odontograma'" :key="`od-${patientId}`" :patient-id="patientId" />
      <AestheticMap v-else-if="tab === 'harmonizacao'" :key="`hm-${patientId}`" :patient-id="patientId" />
      <PatientPlans v-else-if="tab === 'orcamentos'" :key="`or-${patientId}`" :patient-id="patientId" />
      <PatientPayments v-else-if="tab === 'pagamentos'" :key="`pg-${patientId}`" :patient-id="patientId" />
      <PatientDocuments v-else-if="tab === 'documentos'" :key="`dc2-${patientId}`" :patient-id="patientId" :patient-name="p.name" :patient-phone="p.phone" />
      <PhotoGallery v-else-if="tab === 'fotos'" :key="`ft-${patientId}`" :patient-id="patientId" />
      <PatientReturns v-else-if="tab === 'retornos'" :key="`rt-${patientId}`" :patient-id="patientId" />
    </template>

    <Modal :is-open="editOpen" title="Editar cadastro" size="lg" @close="editOpen = false">
      <PatientForm v-if="editPatient" :patient="editPatient" :loading="saving" @submit="saveEdit" />
    </Modal>

    <Modal :is-open="anonymizeOpen" title="Anonimizar dados da paciente" subtitle="Essa ação não pode ser desfeita" size="sm" @close="anonymizeOpen = false">
      <p class="text-sm text-slate-600 leading-relaxed">
        Nome, CPF, telefone, RG, endereço e dados do responsável serão substituídos por dados anônimos.
        Agendamentos, prontuário e financeiro continuam guardados (prazo legal), sem identificar a pessoa.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" :disabled="anonymizing" @click="anonymizeOpen = false">Cancelar</button>
          <button class="btn-danger" :disabled="anonymizing" @click="anonymize">{{ anonymizing ? 'Anonimizando…' : 'Confirmar' }}</button>
        </div>
      </template>
    </Modal>
  </div>
</template>
