<script setup lang="ts">
import { ref } from 'vue'
import { Bell, Calendar, CheckCircle, DollarSign, Info, Smartphone } from 'lucide-vue-next'

const NOTIFICATION_TYPES = [
  { icon: Calendar, label: 'Novo agendamento', description: 'Quando um novo agendamento é criado na sua agenda', color: 'text-primary-600', bg: 'bg-primary-50' },
  { icon: CheckCircle, label: 'Atendimento concluído', description: 'Quando um atendimento é marcado como concluído', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { icon: DollarSign, label: 'Lançamento financeiro', description: 'Quando um valor é lançado no módulo financeiro', color: 'text-amber-600', bg: 'bg-amber-50' },
]

const enabled = ref([true, true, false])

function toggle(idx: number) {
  enabled.value = enabled.value.map((v, i) => (i === idx ? !v : v))
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 page-stagger">
    <div>
      <h1 class="page-title">Notificações</h1>
      <p class="page-subtitle">Gerencie seus alertas e notificações do sistema</p>
    </div>

    <div class="card space-y-5">
      <div class="flex items-center gap-3 pb-4 border-b border-slate-100">
        <div class="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center">
          <Bell class="w-5 h-5 text-primary-600" />
        </div>
        <div>
          <h3 class="font-semibold text-slate-900">Notificações in-app</h3>
          <p class="text-sm text-slate-500">Alertas visíveis no ícone do sininho no topo da tela</p>
        </div>
      </div>

      <div class="space-y-3">
        <div
          v-for="(n, idx) in NOTIFICATION_TYPES" :key="n.label"
          :class="['flex items-center gap-4 p-4 rounded-xl border transition-all duration-150 cursor-pointer',
            enabled[idx] ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-100']"
          @click="toggle(idx)"
        >
          <div :class="['w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', n.bg]">
            <component :is="n.icon" :class="['w-4 h-4', n.color]" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-800">{{ n.label }}</p>
            <p class="text-xs text-slate-400 mt-0.5">{{ n.description }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="enabled[idx]"
            class="relative inline-flex items-center rounded-full transition-all duration-200 ease-spring flex-shrink-0"
            :class="enabled[idx] ? 'bg-primary-600' : 'bg-slate-200'"
            :style="{ width: '40px', height: '22px' }"
            @click.stop="toggle(idx)"
          >
            <span
              class="block w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-spring"
              :style="{ transform: enabled[idx] ? 'translateX(20px)' : 'translateX(2px)' }"
            />
          </button>
        </div>
      </div>
    </div>

    <div class="card bg-primary-50 border-primary-200 flex items-start gap-3">
      <div class="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <Smartphone class="w-4 h-4 text-primary-600" />
      </div>
      <div class="text-sm text-primary-700">
        <p class="font-semibold mb-1">Notificações para pacientes</p>
        <p class="leading-relaxed">Notificações automáticas para pacientes via SMS ou email estarão disponíveis em breve. Acompanhe as atualizações da plataforma.</p>
      </div>
      <div class="ml-auto flex-shrink-0">
        <Info class="w-4 h-4 text-primary-400" />
      </div>
    </div>
  </div>
</template>
