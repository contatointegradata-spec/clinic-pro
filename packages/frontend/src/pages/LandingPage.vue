<script setup lang="ts">
import { Calendar, Users, FileText, DollarSign, MessageSquare, MapPin, ArrowRight, ShieldCheck } from 'lucide-vue-next'
import ClinicLogo from '../components/ui/ClinicLogo.vue'

const FEATURES = [
  { icon: Calendar, title: 'Agenda inteligente', desc: 'Consultas organizadas por sala, horário e especialidade, sem conflitos.' },
  { icon: Users, title: 'Pacientes', desc: 'Cadastro completo, histórico e pré-agendamentos em um só lugar.' },
  { icon: FileText, title: 'Prontuário eletrônico', desc: 'Evoluções, anamneses e laudos organizados por especialidade.' },
  { icon: DollarSign, title: 'Financeiro', desc: 'Receitas, despesas e repasses com relatórios automáticos.' },
  { icon: MessageSquare, title: 'Agente de IA no WhatsApp', desc: 'Atendimento e agendamento automatizado para seus pacientes.' },
  { icon: MapPin, title: 'Múltiplas salas', desc: 'Gerencie mais de um consultório com equipe e permissões próprias.' },
]
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-white to-primary-50/40">
    <header class="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
      <ClinicLogo dark />
      <router-link to="/login" class="btn-primary">
        Entrar
        <ArrowRight class="w-4 h-4" />
      </router-link>
    </header>

    <section class="max-w-4xl mx-auto px-6 pt-10 pb-16 text-center">
      <span class="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 border border-primary-100 px-3 py-1.5 rounded-full text-xs font-semibold mb-6">
        <ShieldCheck class="w-3.5 h-3.5" />
        Plataforma para clínicas e consultórios
      </span>
      <h1 class="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight leading-[1.1]">
        Sua clínica organizada
        <span class="text-gradient-blue">do WhatsApp ao financeiro</span>
      </h1>
      <p class="text-slate-500 text-lg mt-5 max-w-2xl mx-auto leading-relaxed">
        Centralize agenda, pacientes, prontuário, financeiro e atendimento em uma
        única plataforma, pensada para quem cuida de pessoas.
      </p>
      <div class="mt-8 flex items-center justify-center gap-3">
        <router-link to="/login" class="btn-primary px-6 py-3 text-base">
          Acessar plataforma
          <ArrowRight class="w-4 h-4" />
        </router-link>
      </div>
    </section>

    <section class="max-w-6xl mx-auto px-6 pb-20">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div v-for="f in FEATURES" :key="f.title" class="card">
          <div class="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center mb-4">
            <component :is="f.icon" class="w-5 h-5 text-primary-600" />
          </div>
          <h3 class="font-semibold text-slate-900">{{ f.title }}</h3>
          <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">{{ f.desc }}</p>
        </div>
      </div>
    </section>

    <footer class="border-t border-slate-200 py-8 text-center text-sm text-slate-400">
      © {{ new Date().getFullYear() }} ClinIQ Pro · Gestão Clínica Inteligente
    </footer>
  </div>
</template>
