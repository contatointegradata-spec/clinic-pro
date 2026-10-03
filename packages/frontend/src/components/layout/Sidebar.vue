<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard, Calendar, Users, DollarSign, UserCog, LogOut, ChevronRight,
  Settings, ClipboardList, MessageSquare, Database, PanelLeftClose, PanelLeft,
  ShieldCheck, Building2, CreditCard, Webhook,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import { useSecretaryPermissions } from '../../composables/useSecretaryPermissions'
import { useQuery } from '../../composables/useQuery'
import api from '../../lib/api'
import ClinicLogo from '../ui/ClinicLogo.vue'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const authStore = useAuthStore()
const { can } = useSecretaryPermissions()
const route = useRoute()
const router = useRouter()

const isChatbotRoute = computed(() => route.path.startsWith('/agente/chatbot'))

const { data: preRegistrations } = useQuery<unknown[]>({
  key: 'pre-registrations-count',
  queryFn: () => api.get('/patients/pre-registrations').then(r => r.data),
  staleTime: 2 * 60 * 1000,
})
const pendingCount = computed(() => preRegistrations.value?.length ?? 0)

const roleLabel: Record<string, string> = { ADMIN: 'Administrador', DOCTOR: 'Especialista', SECRETARY: 'Secretária' }
const roleColor: Record<string, string> = {
  ADMIN: 'bg-violet-50 text-violet-700 border border-violet-100',
  DOCTOR: 'bg-primary-50 text-primary-700 border border-primary-100',
  SECRETARY: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: undefined as string | undefined },
  { to: '/agenda', icon: Calendar, label: 'Agenda', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: undefined },
  { to: '/pacientes', icon: Users, label: 'Pacientes', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: undefined },
  { to: '/prontuario', icon: ClipboardList, label: 'Prontuário', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: undefined },
  { to: '/financeiro', icon: DollarSign, label: 'Financeiro', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'financeiro' },
  { to: '/usuarios', icon: UserCog, label: 'Usuários', roles: ['ADMIN'], secretaryPermission: undefined },
]

const visibleItems = computed(() => navItems.filter(item => {
  const role = authStore.user?.role
  if (!role) return false
  if (!item.roles.includes(role)) return false
  if (role === 'SECRETARY' && item.secretaryPermission) return can(item.secretaryPermission as any)
  return true
}))

const initials = computed(() => authStore.user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U')

function isActive(to: string) {
  return route.path === to || route.path.startsWith(to + '/')
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
  // Revogação no backend roda em paralelo à navegação — não precisa
  // bloquear a saída do usuário esperando a resposta da API.
}
</script>

<template>
  <aside
    class="bg-white border-r border-slate-200 flex flex-col h-screen flex-shrink-0 overflow-hidden select-none"
    :style="{ width: `${props.collapsed ? 68 : 256}px`, transition: 'width 0.32s cubic-bezier(.22,1,.36,1)' }"
  >
    <div class="px-2.5 py-3.5 border-b border-slate-100 flex-shrink-0">
      <div v-if="!props.collapsed" class="flex items-center justify-between min-w-0">
        <ClinicLogo size="md" dark />
        <button class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150 flex-shrink-0 ml-1" title="Recolher sidebar" @click="emit('toggleCollapse')">
          <PanelLeftClose class="w-4 h-4" />
        </button>
      </div>
      <div v-else class="flex items-center justify-between min-w-0">
        <ClinicLogo icon-only size="sm" dark />
        <button class="w-7 h-7 flex items-center justify-center text-primary-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150 flex-shrink-0" title="Expandir sidebar" @click="emit('toggleCollapse')">
          <PanelLeft class="w-4.5 h-4.5" />
        </button>
      </div>
    </div>

    <nav class="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-none">
      <p v-if="!props.collapsed" class="section-label mb-3">Menu Principal</p>
      <router-link
        v-for="item in visibleItems"
        :key="item.to"
        :to="item.to"
        :class="['sidebar-link group tooltip-trigger', isActive(item.to) ? 'active' : '']"
      >
        <component :is="item.icon" :class="['w-5 h-5 flex-shrink-0 transition-all duration-200', isActive(item.to) ? 'text-white' : 'text-slate-400 group-hover:text-primary-600 group-hover:scale-110']" />
        <span class="flex-1 overflow-hidden transition-all duration-300 whitespace-nowrap" :style="{ opacity: props.collapsed ? 0 : 1, maxWidth: props.collapsed ? '0' : '200px' }">
          {{ item.label }}
        </span>
        <span v-if="item.to === '/pacientes' && pendingCount > 0 && !props.collapsed" class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold bg-amber-500 text-white rounded-full leading-none">
          {{ pendingCount > 99 ? '99+' : pendingCount }}
        </span>
        <ChevronRight v-if="isActive(item.to) && !props.collapsed" class="w-4 h-4 opacity-60 flex-shrink-0" />
        <span v-if="props.collapsed" class="tooltip">{{ item.label }}</span>
      </router-link>

      <div v-if="can('chatbot_light_operar') || can('chatbot_light_configurar')" :class="[props.collapsed ? 'mt-3 pt-3' : 'mt-5 pt-4', 'border-t border-slate-100']">
        <router-link to="/agente/chatbot" :class="['sidebar-link group tooltip-trigger', isChatbotRoute ? 'active' : '']">
          <MessageSquare :class="['w-5 h-5 flex-shrink-0 transition-all duration-200', isChatbotRoute ? 'text-white' : 'text-slate-400 group-hover:text-primary-600 group-hover:scale-110']" />
          <span v-if="!props.collapsed" class="flex-1 overflow-hidden whitespace-nowrap">Agente de IA</span>
          <span v-else class="tooltip">Agente de IA</span>
        </router-link>
      </div>

      <div v-if="authStore.user?.role === 'SECRETARY'" :class="[props.collapsed ? 'mt-3 pt-3' : 'mt-4 pt-4', 'border-t border-slate-100']">
        <p v-if="!props.collapsed" class="section-label mb-2">Atendimento</p>
        <router-link to="/minhas-salas" :class="['sidebar-link group tooltip-trigger', isActive('/minhas-salas') ? 'active' : '']">
          <Building2 :class="['w-5 h-5 flex-shrink-0', isActive('/minhas-salas') ? 'text-white' : 'text-slate-400 group-hover:text-primary-600']" />
          <span v-if="!props.collapsed" class="flex-1">Minhas Salas</span>
        </router-link>
      </div>

      <div v-if="authStore.user?.role === 'ADMIN'" :class="[props.collapsed ? 'mt-3 pt-3' : 'mt-4 pt-4', 'border-t border-slate-100']">
        <p v-if="!props.collapsed" class="section-label mb-2">Admin</p>
        <router-link v-for="item in [
          { to: '/admin/gestao', icon: ShieldCheck, label: 'Gestão' },
          { to: '/admin/planos', icon: CreditCard, label: 'Planos' },
          { to: '/admin/integracoes', icon: Webhook, label: 'Integrações' },
          { to: '/admin/sql', icon: Database, label: 'SQL Admin' },
        ]" :key="item.to" :to="item.to" :class="['sidebar-link group tooltip-trigger', isActive(item.to) ? 'active' : '']">
          <component :is="item.icon" :class="['w-5 h-5 flex-shrink-0', isActive(item.to) ? 'text-white' : 'text-slate-400 group-hover:text-primary-600']" />
          <span v-if="!props.collapsed" class="flex-1">{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <div class="px-2 pb-2 border-t border-slate-100 pt-2">
      <router-link to="/configuracoes/perfil" :class="['sidebar-link group tooltip-trigger', route.path.startsWith('/configuracoes') ? 'active' : '']">
        <Settings :class="['w-5 h-5 flex-shrink-0', route.path.startsWith('/configuracoes') ? 'text-white' : 'text-slate-400 group-hover:text-primary-600']" />
        <span v-if="!props.collapsed" class="flex-1">Configurações</span>
      </router-link>
    </div>

    <div class="p-3 flex-shrink-0 border-t border-slate-100">
      <div :class="['flex items-center gap-3', props.collapsed ? 'justify-center' : 'mb-2.5']">
        <div class="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 shadow-sm shadow-primary-600/20 ring-2 ring-primary-50">
          <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" :alt="authStore.user.name" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <span class="text-white text-xs font-semibold">{{ initials }}</span>
          </div>
        </div>
        <div v-if="!props.collapsed" class="flex-1 min-w-0 overflow-hidden">
          <p class="text-slate-900 text-xs font-semibold truncate leading-tight">{{ authStore.user?.name }}</p>
          <span :class="['text-xs px-2 py-0.5 rounded-full font-medium', authStore.user?.role ? roleColor[authStore.user.role] : '']">
            {{ authStore.user?.role ? roleLabel[authStore.user.role] : '' }}
          </span>
        </div>
      </div>

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
