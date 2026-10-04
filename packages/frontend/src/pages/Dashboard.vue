<script setup lang="ts">
import { computed } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Calendar, Users, CheckCircle2, Clock, TrendingUp, Activity,
  ArrowRight, Zap, Stethoscope, BarChart3, Cake, MessageCircle,
} from 'lucide-vue-next'
import api from '../lib/api'
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
  { to: '/agenda', icon: Calendar, label: 'Ver agenda completa', color: 'text-sky-300', bg: 'bg-sky-500/10' },
  { to: '/pacientes', icon: Users, label: 'Gerenciar pacientes', color: 'text-violet-300', bg: 'bg-violet-500/10' },
  { to: '/prontuario', icon: TrendingUp, label: 'Prontuários', color: 'text-emerald-300', bg: 'bg-emerald-500/10' },
  { to: '/financeiro', icon: Stethoscope, label: 'Financeiro', color: 'text-amber-300', bg: 'bg-amber-500/10' },
]
</script>

<template>
  <div class="space-y-6 page-stagger">
    <!-- Welcome banner -->
    <div class="bg-gradient-to-br from-primary-700 via-primary-600 to-sky-600 rounded-2xl p-5 sm:p-6 text-white shadow-xl shadow-primary-700/20 overflow-hidden relative">
      <div class="absolute -top-10 -right-10 w-52 h-52 bg-white/5 rounded-full blur-3xl pointer-events-none" />
      <div class="absolute bottom-0 left-1/3 w-40 h-40 bg-sky-300/10 rounded-full blur-2xl pointer-events-none" />

      <div class="relative flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <Zap class="w-4 h-4 text-sky-200" fill="currentColor" />
            <span class="text-sky-200 text-xs font-bold uppercase tracking-widest">ClinIQ Pro</span>
          </div>
          <h1 class="text-2xl sm:text-3xl font-bold mb-1 leading-tight">
            {{ getGreeting() }}, {{ authStore.user?.name?.split(' ')[0] }}! 👋
          </h1>
          <p class="text-blue-100 text-sm">{{ dateCapitalized }}</p>
          <div v-if="authStore.user?.specialty" class="mt-3 inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium border border-white/20">
            <Activity class="w-3.5 h-3.5 text-sky-200" />
            {{ authStore.user.specialty }}
            <template v-if="authStore.user.crm"> · {{ authStore.user.crm }}</template>
          </div>
        </div>
        <div class="hidden sm:flex items-center gap-2.5 bg-white/15 backdrop-blur-sm px-4 py-3 rounded-2xl border border-white/20 flex-shrink-0">
          <Calendar class="w-5 h-5 text-sky-200" />
          <div class="text-right">
            <p class="text-lg font-bold leading-none tabular-nums">{{ format(today, 'd MMM', { locale: ptBR }) }}</p>
            <p class="text-xs text-blue-100 mt-0.5">{{ format(today, 'yyyy') }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <SkeletonStats v-if="statsLoading" :count="4" />
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div class="stat-card">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
            <Calendar class="w-5 h-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Consultas Hoje</p>
            <p class="text-3xl font-bold text-slate-900 mt-1 leading-none tabular-nums">{{ stats?.todayTotal ?? 0 }}</p>
            <p class="text-xs text-slate-400 mt-1.5">agendamentos do dia</p>
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-sm">
            <CheckCircle2 class="w-5 h-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Concluídas</p>
            <p class="text-3xl font-bold text-slate-900 mt-1 leading-none tabular-nums">{{ stats?.todayCompleted ?? 0 }}</p>
            <p class="text-xs text-slate-400 mt-1.5">finalizadas hoje</p>
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-amber-500 to-amber-600 shadow-sm">
            <Clock class="w-5 h-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Pendentes</p>
            <p class="text-3xl font-bold text-slate-900 mt-1 leading-none tabular-nums">{{ stats?.todayScheduled ?? 0 }}</p>
            <p class="text-xs text-slate-400 mt-1.5">aguardando atendimento</p>
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
            <Users class="w-5 h-5 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Total de Pacientes</p>
            <p class="text-3xl font-bold text-slate-900 mt-1 leading-none tabular-nums">{{ stats?.totalPatients ?? 0 }}</p>
            <p class="text-xs text-slate-400 mt-1.5">cadastrados no sistema</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main grid -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div class="xl:col-span-2">
        <div class="card h-full flex flex-col">
          <div class="flex items-center justify-between mb-5">
            <div>
              <h2 class="text-base font-semibold text-slate-900">Agenda de Hoje</h2>
              <p class="text-xs text-slate-400 mt-0.5">{{ dateCapitalized }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="todayAppointments.length > 0" class="bg-primary-50 text-primary-700 text-xs font-bold px-3 py-1.5 rounded-full border border-primary-100 tabular-nums">
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
            <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <Calendar class="w-8 h-8 text-slate-300" />
            </div>
            <p class="text-slate-500 font-semibold">Nenhuma consulta hoje</p>
            <p class="text-slate-400 text-sm mt-1">Aproveite o dia tranquilo!</p>
            <router-link to="/agenda" class="mt-4 btn-primary text-xs">
              <Calendar class="w-3.5 h-3.5" />
              Ver agenda
            </router-link>
          </div>
          <div v-else class="space-y-2 max-h-72 overflow-y-auto pr-0.5 scrollbar-none flex-1">
            <div
              v-for="appt in todayAppointments" :key="appt.id"
              class="flex items-center gap-4 p-3.5 rounded-xl border transition-all duration-200 bg-slate-50 hover:bg-white hover:shadow-sm hover:border-slate-200 border-transparent cursor-pointer"
            >
              <div class="text-center min-w-[52px]">
                <p class="text-sm font-bold text-slate-900 tabular-nums">{{ format(new Date(appt.date), 'HH:mm') }}</p>
                <p class="text-xs text-slate-400">{{ appt.duration }}min</p>
              </div>
              <div class="w-px h-9 flex-shrink-0 bg-slate-200" />
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-slate-900 text-sm truncate">{{ appt.patient.name }}</p>
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
        <div class="card">
          <h3 class="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center">
              <BarChart3 class="w-3.5 h-3.5 text-primary-600" />
            </div>
            Resumo do Dia
          </h3>
          <div class="space-y-4">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-slate-500">Concluídas</span>
                <span class="text-xs font-bold text-emerald-600 tabular-nums">{{ conclusionRate }}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill bg-emerald-500" :style="{ width: `${pct(stats?.todayCompleted ?? 0, stats?.todayTotal ?? 0)}%` }" />
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-slate-500">Agendadas</span>
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

        <div v-if="birthdays.length > 0" class="card">
          <h3 class="font-semibold text-slate-900 mb-4 flex items-center gap-2 text-sm">
            <div class="w-7 h-7 bg-pink-50 rounded-lg flex items-center justify-center">
              <Cake class="w-3.5 h-3.5 text-pink-500" />
            </div>
            Aniversariantes de hoje
          </h3>
          <div class="space-y-2">
            <div
              v-for="p in birthdays" :key="p.id"
              class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div class="w-8 h-8 rounded-full bg-pink-50 text-pink-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
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

        <div class="card bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700/50">
          <h3 class="font-semibold text-white mb-1 flex items-center gap-2 text-sm">
            <Zap class="w-4 h-4 text-sky-300" fill="currentColor" />
            Acesso Rápido
          </h3>
          <p class="text-xs text-slate-400 mb-4">Ações mais usadas</p>
          <div class="space-y-1">
            <router-link
              v-for="link in quickLinks" :key="link.to" :to="link.to"
              class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 active:bg-white/5 text-slate-300 hover:text-white transition-all duration-150 group"
            >
              <div :class="['w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0', link.bg]">
                <component :is="link.icon" :class="['w-3.5 h-3.5', link.color]" />
              </div>
              <span class="text-sm font-medium flex-1">{{ link.label }}</span>
              <ArrowRight class="w-3.5 h-3.5 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-150" />
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
