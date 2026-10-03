<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Menu, X, ChevronRight, Home, Settings, LogOut, User as UserIcon } from 'lucide-vue-next'
import Sidebar from './Sidebar.vue'
import SettingsSidebar from './SettingsSidebar.vue'
import FinanceiroSidebar from './FinanceiroSidebar.vue'
import SettingsMobileNav from './SettingsMobileNav.vue'
import NotificationBell from '../NotificationBell.vue'
import SubscriptionGate from '../SubscriptionGate.vue'
import { VersionUpdateBanner } from '../system'
import { TrialBanner } from '../ui'
import { SecretaryGate } from '../ui'
import { useAuthStore } from '../../stores/auth'
import { useUnsavedChangesGuard } from '../../composables/useUnsavedChangesGuard'
import type { SecretaryPermissionKey } from '../../composables/useSecretaryPermissions'

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', agenda: 'Agenda', pacientes: 'Pacientes', prontuario: 'Prontuário',
  financeiro: 'Financeiro', resumo: 'Resumo', 'fluxo-caixa': 'Fluxo de Caixa', extrato: 'Extrato',
  receitas: 'Receitas', despesas: 'Despesas', 'analise-receitas': 'Análise de Receitas',
  'analise-despesas': 'Análise de Despesas', 'analise-avancada': 'Análise Avançada',
  'contas-bancarias': 'Contas Bancárias', 'centros-custo': 'Centros de Custo', usuarios: 'Usuários',
  configuracoes: 'Configurações', perfil: 'Perfil', 'plano-financeiro': 'Plano', equipe: 'Equipe',
  ajuda: 'Ajuda', documentacao: 'Documentação', 'tipos-atendimento': 'Tipos de Atendimento',
  salas: 'Salas', documentos: 'Documentos', 'formas-pagamento': 'Formas de Pagamento',
  notificacoes: 'Notificações', integracoes: 'Integrações', assinatura: 'Assinatura',
  pendente: 'Pagamento Pendente', chatbot: 'Chatbot IA', agente: 'Agente de IA', admin: 'Admin',
  sql: 'SQL Admin', gestao: 'Gestão', planos: 'Planos', 'minhas-salas': 'Minhas Salas',
  desenvolvedor: 'Admin Desenvolvedor',
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
useUnsavedChangesGuard()

const isSettings = computed(() => route.path.startsWith('/configuracoes'))
const isFinanceiro = computed(() => route.path.startsWith('/financeiro'))

const sidebarCollapsed = ref(localStorage.getItem('clinic_sidebar_collapsed') === 'true')
const mobileOpen = ref(false)
const userMenuOpen = ref(false)

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('clinic_sidebar_collapsed', String(sidebarCollapsed.value))
}

watch(() => route.path, () => { mobileOpen.value = false })

const crumbs = computed(() => {
  const parts = route.path.split('/').filter(Boolean)
  return parts.map((part, i) => ({
    label: ROUTE_LABELS[part] || part,
    path: '/' + parts.slice(0, i + 1).join('/'),
    isLast: i === parts.length - 1,
  }))
})

const mobileTitle = computed(() => {
  const last = route.path.split('/').filter(Boolean).pop() || ''
  return ROUTE_LABELS[last] || 'ClinIQ Pro'
})

const initials = computed(() => authStore.user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U')
const roleLabel: Record<string, string> = { ADMIN: 'Administrador', DOCTOR: 'Especialista', SECRETARY: 'Secretária' }

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

const userMenuRef = ref<HTMLElement | null>(null)
function onClickOutside(e: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) userMenuOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))

const secretaryPermission = computed(() => route.meta.secretaryPermission as SecretaryPermissionKey | SecretaryPermissionKey[] | undefined)
</script>

<template>
  <div class="flex h-screen bg-transparent overflow-hidden">
    <div v-if="mobileOpen" class="overlay lg:hidden" @click="mobileOpen = false" />

    <div class="relative hidden lg:block flex-shrink-0" :style="{ width: `${sidebarCollapsed ? 68 : 256}px`, transition: 'width 0.3s cubic-bezier(.22,1,.36,1)' }">
      <div :class="['absolute inset-0 transition-all duration-300', (isSettings || isFinanceiro) ? 'opacity-0 pointer-events-none -translate-x-2' : 'opacity-100 translate-x-0']">
        <Sidebar :collapsed="sidebarCollapsed" @toggle-collapse="toggleSidebar" />
      </div>
      <div :class="['absolute inset-0 transition-all duration-300', isSettings ? 'opacity-100 translate-x-0' : 'opacity-0 pointer-events-none translate-x-2']">
        <SettingsSidebar :collapsed="sidebarCollapsed" @toggle-collapse="toggleSidebar" />
      </div>
      <div :class="['absolute inset-0 transition-all duration-300', isFinanceiro ? 'opacity-100 translate-x-0' : 'opacity-0 pointer-events-none translate-x-2']">
        <FinanceiroSidebar :collapsed="sidebarCollapsed" @toggle-collapse="toggleSidebar" />
      </div>
    </div>

    <div :class="['fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-300', mobileOpen ? 'translate-x-0' : '-translate-x-full']" style="width: 256px">
      <SettingsSidebar v-if="isSettings" :collapsed="false" @toggle-collapse="mobileOpen = false" />
      <FinanceiroSidebar v-else-if="isFinanceiro" :collapsed="false" @toggle-collapse="mobileOpen = false" />
      <Sidebar v-else :collapsed="false" @toggle-collapse="mobileOpen = false" />
    </div>

    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      <header class="h-14 header-glass flex items-center px-4 gap-3 flex-shrink-0 z-30">
        <button class="lg:hidden btn-icon" :aria-label="mobileOpen ? 'Fechar menu' : 'Abrir menu'" @click="mobileOpen = !mobileOpen">
          <X v-if="mobileOpen" class="w-5 h-5" />
          <Menu v-else class="w-5 h-5" />
        </button>

        <div class="flex-1 min-w-0 hidden sm:block">
          <nav class="flex items-center gap-1 text-sm min-w-0">
            <router-link to="/dashboard" class="text-slate-400 hover:text-primary-600 transition-colors flex-shrink-0 p-0.5 rounded-md hover:bg-primary-50">
              <Home class="w-3.5 h-3.5" />
            </router-link>
            <span v-for="c in crumbs" :key="c.path" class="flex items-center gap-1 min-w-0">
              <ChevronRight class="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
              <span v-if="c.isLast" class="font-semibold text-slate-700 truncate max-w-[180px]">{{ c.label }}</span>
              <router-link v-else :to="c.path" class="text-slate-400 hover:text-primary-600 transition-colors truncate hover:underline underline-offset-2 max-w-[120px]">
                {{ c.label }}
              </router-link>
            </span>
          </nav>
        </div>

        <div class="flex-1 sm:hidden">
          <p class="text-sm font-semibold text-slate-900 truncate">{{ mobileTitle }}</p>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          <NotificationBell />
          <div ref="userMenuRef" class="relative">
            <button class="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-all duration-150 group" @click="userMenuOpen = !userMenuOpen">
              <div :class="['w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shadow shadow-primary-600/20', userMenuOpen ? 'ring-2 ring-primary-300 ring-offset-1' : '']">
                <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" :alt="authStore.user.name" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
                  <span class="text-white text-xs font-bold leading-none">{{ initials }}</span>
                </div>
              </div>
              <span class="hidden md:block text-sm font-medium text-slate-700 max-w-[100px] truncate">{{ authStore.user?.name?.split(' ')[0] }}</span>
            </button>

            <div v-if="userMenuOpen" class="dropdown-menu w-56">
              <div class="px-4 py-3 border-b border-slate-100">
                <p class="text-sm font-semibold text-slate-900 truncate">{{ authStore.user?.name }}</p>
                <p class="text-xs text-slate-400 mt-0.5 capitalize">{{ authStore.user?.role ? roleLabel[authStore.user.role] : '' }}</p>
              </div>
              <div class="py-1.5">
                <button class="dropdown-item w-full" @click="router.push('/configuracoes/perfil'); userMenuOpen = false">
                  <UserIcon class="w-4 h-4 text-slate-400" />
                  Meu Perfil
                </button>
                <button class="dropdown-item w-full" @click="router.push('/configuracoes/perfil'); userMenuOpen = false">
                  <Settings class="w-4 h-4 text-slate-400" />
                  Configurações
                </button>
              </div>
              <div class="border-t border-slate-100 py-1.5">
                <button class="dropdown-item danger w-full" @click="handleLogout(); userMenuOpen = false">
                  <LogOut class="w-4 h-4" />
                  Sair do sistema
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <VersionUpdateBanner />
      <TrialBanner />

      <main class="flex-1 overflow-y-auto overflow-x-hidden">
        <div class="p-4 sm:p-6 max-w-screen-2xl mx-auto w-full">
          <SettingsMobileNav v-if="isSettings" />
          <SubscriptionGate>
            <div :key="route.path" class="page-enter">
              <SecretaryGate v-if="secretaryPermission" :permission="secretaryPermission">
                <router-view />
              </SecretaryGate>
              <router-view v-else />
            </div>
          </SubscriptionGate>
        </div>
      </main>
    </div>
  </div>
</template>
