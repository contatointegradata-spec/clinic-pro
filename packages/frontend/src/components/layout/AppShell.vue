<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu, X } from 'lucide-vue-next'
import Sidebar from './Sidebar.vue'
import SettingsSidebar from './SettingsSidebar.vue'
import FinanceiroSidebar from './FinanceiroSidebar.vue'
import SettingsMobileNav from './SettingsMobileNav.vue'
import SubscriptionGate from '../SubscriptionGate.vue'
import { VersionUpdateBanner } from '../system'
import { TrialBanner } from '../ui'
import { SecretaryGate } from '../ui'
import { useUnsavedChangesGuard } from '../../composables/useUnsavedChangesGuard'
import type { SecretaryPermissionKey } from '../../composables/useSecretaryPermissions'

// Usado só pro título do header mobile (a sidebar completa — com breadcrumb
// implícito via destaque do item ativo — já cobre isso no desktop).
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
useUnsavedChangesGuard()

const isSettings = computed(() => route.path.startsWith('/configuracoes'))
const isFinanceiro = computed(() => route.path.startsWith('/financeiro'))

const sidebarCollapsed = ref(localStorage.getItem('clinic_sidebar_collapsed') === 'true')
const mobileOpen = ref(false)

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('clinic_sidebar_collapsed', String(sidebarCollapsed.value))
}

watch(() => route.path, () => { mobileOpen.value = false })

const mobileTitle = computed(() => {
  const last = route.path.split('/').filter(Boolean).pop() || ''
  return ROUTE_LABELS[last] || 'ClinIQ Pro'
})

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
      <!-- No desktop a sidebar já mostra logo, item ativo, notificações e
           usuário — esta barra só existe em telas pequenas, onde a sidebar
           fica escondida atrás do menu hambúrguer. -->
      <header class="h-14 header-glass flex items-center px-4 gap-3 flex-shrink-0 z-30 lg:hidden">
        <button class="btn-icon" :aria-label="mobileOpen ? 'Fechar menu' : 'Abrir menu'" @click="mobileOpen = !mobileOpen">
          <X v-if="mobileOpen" class="w-5 h-5" />
          <Menu v-else class="w-5 h-5" />
        </button>
        <p class="flex-1 text-sm font-semibold text-slate-900 truncate">{{ mobileTitle }}</p>
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
