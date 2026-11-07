<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard, CalendarDays, Users2, CircleDollarSign, UserCog, LogOut,
  Settings, Bot, Database, PanelLeftClose, PanelLeft,
  ShieldCheck, Building2, CreditCard, Webhook, FolderKanban, Boxes, MessagesSquare,
} from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import { useAttendanceStore } from '../../stores/attendance'
import { useSecretaryPermissions } from '../../composables/useSecretaryPermissions'
import { useQuery } from '../../composables/useQuery'
import api from '../../lib/api'
import ClinicLogo from '../ui/ClinicLogo.vue'
import NotificationBell from '../NotificationBell.vue'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const authStore = useAuthStore()
const { can } = useSecretaryPermissions()
const route = useRoute()
const router = useRouter()

// Badge de não lidas "minhas" do Atendimento — polling leve; na própria
// tela de Atendimento o stream em tempo real também atualiza o summary.
const attendance = useAttendanceStore()
const attendanceUnread = computed(() => attendance.summary?.unreadMine ?? 0)
let attendanceTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  attendance.fetchSummary(10000)
  attendanceTimer = setInterval(() => attendance.fetchSummary(10000), 30000)
})
onBeforeUnmount(() => clearInterval(attendanceTimer))

const { data: preRegistrations } = useQuery<unknown[]>({
  key: 'pre-registrations-count',
  queryFn: () => api.get('/patients/pre-registrations').then(r => r.data),
  staleTime: 2 * 60 * 1000,
})
const pendingCount = computed(() => preRegistrations.value?.length ?? 0)

const roleLabel: Record<string, string> = { ADMIN: 'Administrador', DOCTOR: 'Especialista', SECRETARY: 'Secretária' }

type NavItem = {
  to: string
  icon: unknown
  label: string
  /** Rota ativa quando o caminho começa com este prefixo (padrão: o próprio `to`). */
  match?: string
  badge?: number
  badgeTone?: 'amber' | 'sage'
  dot?: boolean
}
type NavSection = { label: string; items: NavItem[] }

const sections = computed<NavSection[]>(() => {
  const role = authStore.user?.role
  if (!role) return []
  const isSecretary = role === 'SECRETARY'
  const allowed = (perm?: string) => !isSecretary || !perm || can(perm as any)

  const clinic: NavItem[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
    { to: '/pacientes', icon: Users2, label: 'Pacientes', badge: pendingCount.value, badgeTone: 'amber' },
    ...(allowed('financeiro') ? [{ to: '/financeiro', icon: CircleDollarSign, label: 'Financeiro' }] : []),
    { to: '/estoque', icon: Boxes, label: 'Estoque' },
    ...(role === 'ADMIN' ? [{ to: '/usuarios', icon: UserCog, label: 'Usuários' }] : []),
  ]

  const whatsapp: NavItem[] = [
    { to: '/atendimento', icon: MessagesSquare, label: 'Atendimento', badge: attendanceUnread.value, badgeTone: 'sage', dot: attendanceUnread.value > 0 },
    ...(can('chatbot_light_operar') || can('chatbot_light_configurar')
      ? [
          { to: '/agente/chatbot', icon: Bot, label: 'Agente de IA' },
          { to: '/agente/crm', icon: FolderKanban, label: 'CRM' },
        ]
      : []),
  ]

  const list: NavSection[] = [
    { label: 'Clínica', items: clinic },
    { label: 'WhatsApp', items: whatsapp },
  ]
  if (isSecretary) list.push({ label: 'Salas', items: [{ to: '/minhas-salas', icon: Building2, label: 'Minhas Salas' }] })
  if (role === 'ADMIN') {
    list.push({
      label: 'Admin',
      items: [
        { to: '/admin/gestao', icon: ShieldCheck, label: 'Gestão' },
        { to: '/admin/planos', icon: CreditCard, label: 'Planos' },
        { to: '/admin/integracoes', icon: Webhook, label: 'Integrações' },
        { to: '/admin/sql', icon: Database, label: 'SQL Admin' },
      ],
    })
  }
  return list
})

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
    class="sidebar-shell flex flex-col h-screen flex-shrink-0 overflow-hidden select-none"
    :style="{ width: `${props.collapsed ? 68 : 256}px`, transition: 'width 0.32s cubic-bezier(.22,1,.36,1)' }"
  >
    <!-- Marca + recolher -->
    <div :class="['flex items-center flex-shrink-0 h-16', props.collapsed ? 'flex-col justify-center gap-1.5 h-24 px-2' : 'justify-between px-4']">
      <router-link to="/dashboard" class="min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300" title="Ir para o Dashboard">
        <ClinicLogo :icon-only="props.collapsed" size="md" dark />
      </router-link>
      <button
        class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-white rounded-lg transition-all duration-150 flex-shrink-0"
        :title="props.collapsed ? 'Expandir menu' : 'Recolher menu'"
        :aria-label="props.collapsed ? 'Expandir menu' : 'Recolher menu'"
        @click="emit('toggleCollapse')"
      >
        <PanelLeft v-if="props.collapsed" class="w-4 h-4" />
        <PanelLeftClose v-else class="w-4 h-4" />
      </button>
    </div>

    <!-- Navegação -->
    <nav class="flex-1 min-h-0 overflow-y-auto scrollbar-none px-3 pb-3" aria-label="Menu principal">
      <div v-for="(section, i) in sections" :key="section.label" :class="i === 0 ? 'pt-1' : 'pt-4'">
        <p v-if="!props.collapsed" class="sidebar-section">{{ section.label }}</p>
        <div v-else-if="i > 0" class="mx-auto mb-2 h-px w-8 bg-slate-200/80" />
        <div class="space-y-0.5">
          <router-link
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            :class="['sidebar-link group', props.collapsed ? 'justify-center px-0' : '', isActive(item.match ?? item.to) ? 'active' : '']"
            :aria-current="isActive(item.match ?? item.to) ? 'page' : undefined"
            :title="props.collapsed ? item.label : undefined"
          >
            <span class="relative flex-shrink-0">
              <component :is="item.icon" class="sidebar-icon" />
              <span v-if="props.collapsed && (item.dot || (item.badge ?? 0) > 0)" class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-[#FBF8F5]" :class="item.badgeTone === 'amber' ? 'bg-amber-500' : 'bg-sage-500'" />
            </span>
            <span v-if="!props.collapsed" class="flex-1 truncate">{{ item.label }}</span>
            <span
              v-if="!props.collapsed && (item.badge ?? 0) > 0"
              :class="['inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10.5px] font-semibold rounded-full leading-none', item.badgeTone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-sage-500 text-white']"
              :aria-label="`${item.badge} pendentes`"
            >
              {{ (item.badge ?? 0) > 99 ? '99+' : item.badge }}
            </span>
          </router-link>
        </div>
      </div>
    </nav>

    <!-- Rodapé: configurações, notificações e usuário -->
    <div class="flex-shrink-0 px-3 pb-3 pt-2 border-t border-slate-200/70 space-y-0.5">
      <router-link
        to="/configuracoes/perfil"
        :class="['sidebar-link group', props.collapsed ? 'justify-center px-0' : '', route.path.startsWith('/configuracoes') ? 'active' : '']"
        :title="props.collapsed ? 'Configurações' : undefined"
      >
        <Settings class="sidebar-icon" />
        <span v-if="!props.collapsed" class="flex-1">Configurações</span>
      </router-link>

      <NotificationBell :collapsed="props.collapsed" />

      <div :class="['mt-2 flex items-center gap-2.5 rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm', props.collapsed ? 'flex-col p-1.5' : 'p-2']">
        <router-link to="/configuracoes/perfil" class="flex items-center gap-2.5 min-w-0 flex-1 rounded-xl" title="Meu perfil">
          <div class="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white shadow-sm">
            <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" :alt="authStore.user.name" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center">
              <span class="text-white text-xs font-semibold">{{ initials }}</span>
            </div>
          </div>
          <div v-if="!props.collapsed" class="min-w-0">
            <p class="text-slate-900 text-[13px] font-semibold truncate leading-tight">{{ authStore.user?.name }}</p>
            <p class="text-slate-400 text-[11.5px] truncate mt-0.5">{{ authStore.user?.role ? roleLabel[authStore.user.role] : '' }}</p>
          </div>
        </router-link>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
          title="Sair do sistema"
          aria-label="Sair do sistema"
          @click="handleLogout"
        >
          <LogOut class="w-4 h-4" />
        </button>
      </div>
    </div>
  </aside>
</template>
