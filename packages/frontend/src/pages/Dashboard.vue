<script setup lang="ts">
import { computed } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Calendar, Users, CheckCircle2, Clock, Activity,
  ArrowRight, Zap, Stethoscope, BarChart3, Cake, MessageCircle, CalendarClock,
} from 'lucide-vue-next'
import api from '../lib/api'
import { greetingName } from '../lib/firstName'
import { type ScheduledReturn, daysUntil } from '../lib/clinical'
import { useAuthStore } from '../stores/auth'
import type { Appointment, AppointmentStats, Patient } from '../types'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { SkeletonStats } from '../components/ui'
import { useQuery } from '../composables/useQuery'

const authStore = useAuthStore()
const today = new Date()

const { data: stats, isLoading: statsLoading } = useQuery<AppointmentStats>({
  key: 'appointment-stats',
  queryFn: () => api.get('/appointments/stats').then(r => r.data),
})

const { data: todayAppointmentsData, isLoading: apptLoading } = useQuery<Appointment[]>({
  key: 'today-appointments',
  queryFn: () => api.get('/appointments/today').then(r => r.data),
})
const todayAppointments = computed(() => todayAppointmentsData.value ?? [])

const { data: birthdaysData } = useQuery<Patient[]>({
  key: 'birthdays-today',
  queryFn: () => api.get('/patients/birthdays-today').then(r => r.data),
})
const birthdays = computed(() => birthdaysData.value ?? [])

// Retornos programados que vencem nos próximos 7 dias (ou já venceram).
const { data: returnsData } = useQuery<ScheduledReturn[]>({
  key: 'returns-due-week',
  queryFn: () => api.get('/clinical/returns', { params: { status: 'PENDENTE,AVISADO', withinDays: 7 } }).then(r => r.data),
  staleTime: 60 * 1000,
})
const dueReturns = computed(() => returnsData.value ?? [])
function returnDueLabel(r: ScheduledReturn) {
  const d = daysUntil(r.dueDate)
  if (d < 0) return `venceu há ${-d} dia(s)`
  if (d === 0) return 'vence hoje'
  return `em ${d} dia(s)`
}

function ageOf(birthDate?: string | null): number | null {
  if (!birthDate) return null
  const bd = new Date(birthDate)
  let age = today.getFullYear() - bd.getUTCFullYear()
  const beforeBirthdayThisYear = (today.getMonth() + 1) < (bd.getUTCMonth() + 1) ||
    ((today.getMonth() + 1) === (bd.getUTCMonth() + 1) && today.getDate() < bd.getUTCDate())
  if (beforeBirthdayThisYear) age -= 1
  return age
}

function birthdayWhatsAppLink(patient: Patient): string {
  const digits = (patient.phone || '').replace(/\D/g, '')
  const message = encodeURIComponent(`Olá ${patient.name.split(' ')[0]}! 🎉 Passando pra desejar um feliz aniversário! 🎂`)
  return `https://wa.me/${digits}?text=${message}`
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

const dateCapitalized = computed(() => {
  const formatted = format(today, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
})

const conclusionRate = computed(() => {
  const total = stats.value?.todayTotal
  return total ? Math.round(((stats.value?.todayCompleted ?? 0) / total) * 100) : 0
})

function pct(value: number, max: number) {
  return max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
}

const quickLinks = [
  { to: '/agenda', icon: Calendar, label: 'Ver agenda completa', color: 'text-primary-600', bg: 'bg-primary-50' },
  { to: '/pacientes', icon: Users, label: 'Gerenciar pacientes', color: 'text-violet-600', bg: 'bg-violet-50' },
  { to: '/pacientes?aba=aniversariantes', icon: Cake, label: 'Aniversariantes do mês', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { to: '/financeiro', icon: Stethoscope, label: 'Financeiro', color: 'text-amber-600', bg: 'bg-amber-50' },
]
</script>

<template>
  <div class="space-y-6 page-stagger">
    <!-- Header Executivo Minimalista e Sofisticado (Substitui a tarja pesada) -->
    <div class="bg-white/85 backdrop-blur-md rounded-2xl border border-slate-200/80 p-6 sm:p-7 shadow-[0_1px_3px_rgba(0,0,0,0.03)] relative overflow-hidden transition-all duration-300">
      <!-- Brilho ambiental sutil primário no topo/canto direito -->
      <div class="absolute top-0 right-0 w-96 h-48 bg-gradient-to-bl from-primary-50/70 via-sky-50/20 to-transparent pointer-events-none rounded-bl-full" />
      <div class="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary-500 via-primary-400 to-sky-300 opacity-60" />

      <div class="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div class="min-w-0">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary-50/80 text-primary-700 border border-primary-100 mb-2.5">
            <span class="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse-soft" />
            <span class="tracking-wide uppercase text-[10.5px]">ClinIQ Pro</span>
          </div>

          <h1 class="font-display text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight leading-tight">
            {{ getGreeting() }}, {{ greetingName(authStore.user?.name) }}! 👋
          </h1>
          <p class="text-slate-500 text-sm mt-1">
            {{ dateCapitalized }} · <span class="text-slate-400">Visão geral da sua clínica</span>
          </p>

          <div v-if="authStore.user?.specialty" class="mt-3.5 inline-flex items-center gap-2 bg-slate-50 border border-slate-200/70 px-3 py-1 rounded-full text-xs font-medium text-slate-700 shadow-sm">
            <Activity class="w-3.5 h-3.5 text-primary-600" />
            <span>{{ authStore.user.specialty }}</span>
            <span v-if="authStore.user.crm" class="text-slate-400">· {{ authStore.user.crm }}</span>
          </div>
        </div>

        <div class="hidden sm:flex items-center gap-3.5 bg-slate-50/80 border border-slate-200/70 px-4 py-3 rounded-2xl flex-shrink-0 shadow-sm">
          <div class="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center text-primary-600 shadow-sm">
            <Calendar class="w-5 h-5" />
          </div>
          <div class="text-right">
            <p class="text-base font-bold text-slate-900 leading-none tabular-nums">{{ format(today, 'd MMM', { locale: ptBR }) }}</p>
            <p class="text-xs text-slate-400 mt-1 font-medium">{{ format(today, 'yyyy') }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Cards de Métricas (Refinados, minimalistas com micro-interações) -->
    <SkeletonStats v-if="statsLoading" :count="4" />
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <!-- Consultas Hoje -->
      <div class="group relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-300 ease-spring">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Consultas Hoje</p>
            <p class="text-3xl font-bold text-slate-900 mt-2 mb-1 leading-none tabular-nums group-hover:text-primary-600 transition-colors">
              {{ stats?.todayTotal ?? 0 }}
            </p>
            <p class="text-xs text-slate-400">agendamentos do dia</p>
          </div>
          <div class="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 border border-primary-100/80 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-sm">
            <Calendar class="w-5 h-5" />
          </div>
        </div>
        <div class="absolute bottom-0 left-5 right-5 h-[2px] bg-primary-500/0 group-hover:bg-primary-500/50 rounded-full transition-all duration-300" />
      </div>

      <!-- Concluídas -->
      <div class="group relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-300 ease-spring">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Concluídas</p>
            <p class="text-3xl font-bold text-slate-900 mt-2 mb-1 leading-none tabular-nums group-hover:text-emerald-600 transition-colors">
              {{ stats?.todayCompleted ?? 0 }}
            </p>
            <p class="text-xs text-slate-400">finalizadas hoje</p>
          </div>
          <div class="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100/80 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-sm">
            <CheckCircle2 class="w-5 h-5" />
          </div>
        </div>
        <div class="absolute bottom-0 left-5 right-5 h-[2px] bg-emerald-500/0 group-hover:bg-emerald-500/50 rounded-full transition-all duration-300" />
      </div>

      <!-- Pendentes -->
      <div class="group relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-300 ease-spring">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pendentes</p>
            <p class="text-3xl font-bold text-slate-900 mt-2 mb-1 leading-none tabular-nums group-hover:text-amber-600 transition-colors">
              {{ stats?.todayScheduled ?? 0 }}
            </p>
            <p class="text-xs text-slate-400">aguardando atendimento</p>
          </div>
          <div class="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 border border-amber-100/80 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-sm">
            <Clock class="w-5 h-5" />
          </div>
        </div>
        <div class="absolute bottom-0 left-5 right-5 h-[2px] bg-amber-500/0 group-hover:bg-amber-500/50 rounded-full transition-all duration-300" />
      </div>

      <!-- Total de Pacientes -->
      <div class="group relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-300 ease-spring">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total de Pacientes</p>
            <p class="text-3xl font-bold text-slate-900 mt-2 mb-1 leading-none tabular-nums group-hover:text-primary-600 transition-colors">
              {{ stats?.totalPatients ?? 0 }}
            </p>
            <p class="text-xs text-slate-400">cadastrados no sistema</p>
          </div>
          <div class="w-11 h-11 rounded-xl bg-sky-50 text-sky-600 border border-sky-100/80 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-sm">
            <Users class="w-5 h-5" />
          </div>
        </div>
        <div class="absolute bottom-0 left-5 right-5 h-[2px] bg-primary-500/0 group-hover:bg-primary-500/50 rounded-full transition-all duration-300" />
      </div>
    </div>

    <!-- Main grid -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div class="xl:col-span-2">
        <div class="card h-full flex flex-col border border-slate-200/80">
          <div class="flex items-center justify-between mb-5">
            <div>
              <h2 class="text-base font-semibold text-slate-900">Agenda de Hoje</h2>
              <p class="text-xs text-slate-400 mt-0.5">{{ dateCapitalized }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="todayAppointments.length > 0" class="bg-primary-50 text-primary-700 text-xs font-semibold px-3 py-1 rounded-full border border-primary-100 tabular-nums">
                {{ todayAppointments.length }} consulta{{ todayAppointments.length !== 1 ? 's' : '' }}
              </span>
              <router-link to="/agenda" class="btn-icon" title="Ver agenda completa">
                <ArrowRight class="w-4 h-4" />
              </router-link>
            </div>
          </div>

          <div v-if="apptLoading" class="space-y-3">
            <div v-for="i in 3" :key="i" class="flex items-center gap-4 p-3.5 rounded-xl bg-slate-50">
              <div class="skeleton w-12 h-10 rounded-lg flex-shrink-0" />
              <div class="w-px h-8 bg-slate-200 flex-shrink-0" />
              <div class="flex-1 space-y-2">
                <div class="skeleton-text w-1/2" />
                <div class="skeleton-text w-1/3" />
              </div>
              <div class="skeleton w-20 h-6 rounded-full" />
            </div>
          </div>
          <div v-else-if="todayAppointments.length === 0" class="empty-state flex-1">
            <div class="w-14 h-14 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mb-3">
              <Calendar class="w-7 h-7 text-slate-300" />
            </div>
            <p class="text-slate-600 font-semibold text-sm">Nenhuma consulta hoje</p>
            <p class="text-slate-400 text-xs mt-1">Aproveite o dia tranquilo!</p>
            <router-link to="/agenda" class="mt-4 btn-primary text-xs">
              <Calendar class="w-3.5 h-3.5" />
              Ver agenda
            </router-link>
          </div>
          <div v-else class="space-y-2 max-h-72 overflow-y-auto pr-0.5 scrollbar-none flex-1">
            <div
              v-for="appt in todayAppointments" :key="appt.id"
              class="flex items-center gap-4 p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white hover:shadow-sm hover:border-slate-200 transition-all duration-200 cursor-pointer group"
            >
              <div class="text-center min-w-[52px]">
                <p class="text-sm font-bold text-slate-900 tabular-nums group-hover:text-primary-600 transition-colors">{{ format(new Date(appt.date), 'HH:mm') }}</p>
                <p class="text-xs text-slate-400">{{ appt.duration }}min</p>
              </div>
              <div class="w-px h-9 flex-shrink-0 bg-slate-200" />
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-slate-900 text-sm truncate group-hover:text-primary-700 transition-colors">{{ appt.patient.name }}</p>
                <p class="text-xs text-slate-400 truncate mt-0.5">
                  <template v-if="appt.type">{{ appt.type }} · </template>Dr(a). {{ appt.doctor.name }}
                </p>
              </div>
              <StatusBadge :status="appt.status" />
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <!-- Resumo do Dia -->
        <div class="card border border-slate-200/80">
          <h3 class="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
              <BarChart3 class="w-3.5 h-3.5 text-primary-600" />
            </div>
            Resumo do Dia
          </h3>
          <div class="space-y-4">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-slate-500 font-medium">Concluídas</span>
                <span class="text-xs font-bold text-emerald-600 tabular-nums">{{ conclusionRate }}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill bg-emerald-500" :style="{ width: `${pct(stats?.todayCompleted ?? 0, stats?.todayTotal ?? 0)}%` }" />
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-slate-500 font-medium">Agendadas</span>
                <span class="text-xs font-bold text-amber-600 tabular-nums">{{ stats?.todayScheduled ?? 0 }}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill bg-amber-400" :style="{ width: `${pct(stats?.todayScheduled ?? 0, stats?.todayTotal ?? 0)}%` }" />
              </div>
            </div>
            <div class="pt-3 border-t border-slate-100">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <Users class="w-3.5 h-3.5 text-slate-400" />
                  <span class="text-xs text-slate-500">Pacientes totais</span>
                </div>
                <span class="text-sm font-bold text-primary-600 tabular-nums">{{ stats?.totalPatients ?? 0 }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Aniversariantes -->
        <div v-if="birthdays.length > 0" class="card border border-slate-200/80">
          <h3 class="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <div class="w-7 h-7 bg-pink-50 rounded-lg flex items-center justify-center border border-pink-100">
              <Cake class="w-3.5 h-3.5 text-pink-500" />
            </div>
            Aniversariantes de hoje
          </h3>
          <div class="space-y-2">
            <div
              v-for="p in birthdays" :key="p.id"
              class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div class="w-8 h-8 rounded-full bg-pink-50 text-pink-600 flex items-center justify-center text-xs font-bold flex-shrink-0 border border-pink-100">
                {{ p.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">{{ p.name }}</p>
                <p v-if="ageOf(p.birthDate) !== null" class="text-xs text-slate-400">Completa {{ ageOf(p.birthDate) }} anos</p>
              </div>
              <a
                v-if="p.phone"
                :href="birthdayWhatsAppLink(p)"
                target="_blank"
                rel="noreferrer"
                class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 hover:bg-emerald-100 transition-colors"
                title="Mandar mensagem de parabéns"
              >
                <MessageCircle class="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        <!-- Retornos programados -->
        <div v-if="dueReturns.length > 0" class="card border border-slate-200/80">
          <div class="flex items-center justify-between gap-2 mb-4">
            <h3 class="font-semibold text-slate-900 flex items-center gap-2 text-sm">
              <div class="w-7 h-7 bg-gold-50 rounded-lg flex items-center justify-center border border-gold-100">
                <CalendarClock class="w-3.5 h-3.5 text-gold-600" />
              </div>
              Retornos da semana
            </h3>
            <router-link to="/pacientes?aba=retornos" class="text-xs font-semibold text-primary-700 hover:underline">Ver todos</router-link>
          </div>
          <div class="space-y-1">
            <router-link
              v-for="r in dueReturns.slice(0, 5)" :key="r.id"
              :to="`/pacientes/${r.patient.id}?aba=retornos`"
              class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">{{ r.patient.name }}</p>
                <p class="text-xs text-slate-400 truncate">{{ r.procedureName }}</p>
              </div>
              <span :class="['text-[11px] font-semibold whitespace-nowrap', daysUntil(r.dueDate) < 0 ? 'text-amber-700' : 'text-slate-500']">{{ returnDueLabel(r) }}</span>
            </router-link>
          </div>
          <p v-if="dueReturns.length > 5" class="mt-2 text-xs text-slate-400 px-3">+ {{ dueReturns.length - 5 }} retorno(s)</p>
        </div>

        <!-- Acesso Rápido Sofisticado (Em harmonia com o tema claro e minimalista) -->
        <div class="card border border-slate-200/80">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
              <Zap class="w-3.5 h-3.5 text-primary-600" />
            </div>
            <h3 class="font-semibold text-slate-900 text-sm">Acesso Rápido</h3>
          </div>
          <p class="text-xs text-slate-400 mb-3.5">Ações e atalhos mais usados</p>
          <div class="space-y-1">
            <router-link
              v-for="link in quickLinks" :key="link.to" :to="link.to"
              class="flex items-center gap-3 px-3 py-2 rounded-xl text-slate-600 hover:text-primary-700 hover:bg-primary-50/60 border border-transparent hover:border-primary-100/70 transition-all duration-200 group"
            >
              <div :class="['w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100', link.bg]">
                <component :is="link.icon" :class="['w-3.5 h-3.5', link.color]" />
              </div>
              <span class="text-sm font-medium flex-1">{{ link.label }}</span>
              <ArrowRight class="w-3.5 h-3.5 text-slate-400 group-hover:text-primary-600 group-hover:translate-x-1 transition-all duration-200" />
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
