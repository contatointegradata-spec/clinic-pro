<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Home, ChevronRight, DollarSign, LayoutDashboard, ArrowLeftRight, Receipt,
  TrendingUp, TrendingDown, BarChart3, PieChart, LineChart, Wallet, Building2,
  FolderTree, PanelLeftClose, PanelLeft, LogOut,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import NotificationBell from '../NotificationBell.vue'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const PAINEL_SECTIONS = [
  {
    label: 'Painel',
    items: [
      { to: '/financeiro/resumo', label: 'Resumo', icon: LayoutDashboard },
      { to: '/financeiro/fluxo-caixa', label: 'Fluxo de caixa', icon: ArrowLeftRight },
    ],
  },
  {
    label: 'Transações',
    items: [
      { to: '/financeiro/extrato', label: 'Extrato', icon: Receipt },
      { to: '/financeiro/receitas', label: 'Receitas', icon: TrendingUp },
      { to: '/financeiro/despesas', label: 'Despesas', icon: TrendingDown },
    ],
  },
  {
    label: 'Relatórios',
    items: [
      { to: '/financeiro/analise-receitas', label: 'Análise de receitas', icon: BarChart3 },
      { to: '/financeiro/analise-despesas', label: 'Análise de despesas', icon: PieChart },
      { to: '/financeiro/analise-avancada', label: 'Análise avançada', icon: LineChart },
    ],
  },
]

const CONFIG_SECTION = {
  label: 'Configurações',
  items: [
    { to: '/financeiro/formas-pagamento', label: 'Formas de pagamento', icon: Wallet },
    { to: '/financeiro/contas-bancarias', label: 'Contas bancárias', icon: Building2 },
    { to: '/financeiro/centros-custo', label: 'Centros de custo', icon: FolderTree },
  ],
}

const sections = computed(() => authStore.user?.role === 'SECRETARY' ? PAINEL_SECTIONS : [...PAINEL_SECTIONS, CONFIG_SECTION])
const initials = computed(() => authStore.user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U')

function isActive(to: string) {
  return route.path === to
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <aside
    class="bg-white border-r border-slate-200 flex flex-col h-screen flex-shrink-0 select-none overflow-hidden"
    :style="{ width: `${props.collapsed ? 68 : 256}px`, transition: 'width 0.32s cubic-bezier(.22,1,.36,1)' }"
  >
    <div class="px-2.5 py-3.5 border-b border-slate-100 flex-shrink-0">
      <div v-if="!props.collapsed" class="flex items-center justify-between min-w-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 flex-shrink-0">
            <DollarSign class="w-4 h-4 text-emerald-600" />
          </div>
          <div class="min-w-0">
            <h1 class="text-slate-900 font-bold text-sm leading-tight truncate">Financeiro</h1>
            <p class="text-slate-400 text-[11px]">Painel Financeiro</p>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button class="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-primary-50 transition-all duration-150" title="Voltar ao Painel" @click="router.push('/dashboard')">
            <Home class="w-4 h-4" />
          </button>
          <button class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150" title="Recolher sidebar" @click="emit('toggleCollapse')">
            <PanelLeftClose class="w-4 h-4" />
          </button>
        </div>
      </div>
      <div v-else class="flex items-center justify-between min-w-0">
        <div class="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center border border-emerald-100 cursor-pointer hover:bg-emerald-100 transition-colors" title="Voltar ao Painel" @click="router.push('/dashboard')">
          <DollarSign class="w-4 h-4 text-emerald-600" />
        </div>
        <button class="w-7 h-7 flex items-center justify-center text-primary-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150" title="Expandir sidebar" @click="emit('toggleCollapse')">
          <PanelLeft class="w-4.5 h-4.5" />
        </button>
      </div>
    </div>

    <nav class="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-3 scrollbar-none">
      <div v-for="section in sections" :key="section.label">
        <p v-if="!props.collapsed" class="section-label mb-2">{{ section.label }}</p>
        <div class="space-y-0.5">
          <router-link
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            :class="['sidebar-link group tooltip-trigger', isActive(item.to) ? 'active' : '']"
          >
            <component :is="item.icon" :class="['w-4.5 h-4.5 flex-shrink-0 transition-all duration-200', isActive(item.to) ? 'text-primary-600 scale-105' : 'text-slate-400 group-hover:text-primary-600 group-hover:scale-105']" />
            <span class="flex-1 text-sm overflow-hidden transition-all duration-300 whitespace-nowrap" :style="{ opacity: props.collapsed ? 0 : 1, maxWidth: props.collapsed ? '0' : '200px' }">
              {{ item.label }}
            </span>
            <ChevronRight v-if="isActive(item.to) && !props.collapsed" class="w-3.5 h-3.5 text-primary-500/70 flex-shrink-0" />
            <span v-if="props.collapsed" class="tooltip">{{ item.label }}</span>
          </router-link>
        </div>
      </div>
    </nav>

    <div class="border-t border-slate-100 p-3 flex-shrink-0">
      <div :class="['flex items-center gap-3 px-2 py-2 rounded-xl', props.collapsed ? 'justify-center' : '']">
        <div class="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 shadow-sm shadow-emerald-600/20">
          <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" :alt="authStore.user.name" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <span class="text-white text-xs font-bold">{{ initials }}</span>
          </div>
        </div>
        <div v-if="!props.collapsed" class="min-w-0">
          <p class="text-slate-900 text-xs font-semibold truncate leading-snug">{{ authStore.user?.name }}</p>
          <p class="text-slate-400 text-xs truncate">{{ authStore.user?.email }}</p>
        </div>
      </div>

      <NotificationBell :collapsed="props.collapsed" />

      <button
        v-if="!props.collapsed"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200 text-sm group"
        @click="handleLogout"
      >
        <LogOut class="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
        <span>Sair do sistema</span>
      </button>
      <button v-else class="w-full flex items-center justify-center p-2 mt-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200" title="Sair" @click="handleLogout">
        <LogOut class="w-4 h-4" />
      </button>
    </div>
  </aside>
</template>
