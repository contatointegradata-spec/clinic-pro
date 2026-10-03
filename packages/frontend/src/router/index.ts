import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { INTEGRATION_PERMISSION_KEYS } from '../composables/useSecretaryPermissions'

const AppShell = () => import('../components/layout/AppShell.vue')
const Login = () => import('../pages/Login.vue')
const LandingPage = () => import('../pages/LandingPage.vue')
const Dashboard = () => import('../pages/Dashboard.vue')
const Agenda = () => import('../pages/Agenda.vue')
const Pacientes = () => import('../pages/Pacientes.vue')
const Prontuario = () => import('../pages/Prontuario.vue')
const FinanceiroResumo = () => import('../pages/financeiro/Resumo.vue')
const ComingSoon = () => import('../pages/ComingSoon.vue')

interface RouteMeta {
  requiresAuth?: boolean
  guestOnly?: boolean
  roles?: Array<'ADMIN' | 'DOCTOR' | 'SECRETARY'>
  secretaryPermission?: string | string[]
  platformAccess?: 'notifications' | 'integrations'
  label?: string
  comingSoon?: { description: string }
}

function comingSoonRoute(path: string, label: string, description: string, meta: RouteMeta = {}): RouteRecordRaw {
  return {
    path,
    component: ComingSoon,
    props: { title: label, description },
    meta: { requiresAuth: true, label, comingSoon: { description }, ...meta },
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: Login,
    meta: { guestOnly: true },
  },
  {
    path: '/',
    component: LandingPage,
    meta: { guestOnly: true },
  },
  { path: '/chatbot', redirect: '/agente/chatbot' },
  { path: '/chatbot/:pathMatch(.*)*', redirect: '/agente/chatbot' },
  { path: '/whatsapp/chatbot', redirect: '/agente/chatbot' },
  { path: '/whatsapp/chatbot/:pathMatch(.*)*', redirect: '/agente/chatbot' },

  {
    path: '/',
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      { path: 'dashboard', component: Dashboard, meta: { label: 'Dashboard' } },
      { path: 'agenda', component: Agenda, meta: { label: 'Agenda' } },
      { path: 'pacientes', component: Pacientes, meta: { label: 'Pacientes' } },
      { path: 'prontuario', component: Prontuario, meta: { label: 'Prontuário' } },

      { path: 'financeiro', redirect: '/financeiro/resumo' },
      { path: 'financeiro/resumo', component: FinanceiroResumo, meta: { label: 'Resumo', secretaryPermission: 'financeiro' } },
      comingSoonRoute('financeiro/fluxo-caixa', 'Fluxo de Caixa', 'A visão completa de fluxo de caixa está sendo migrada para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/extrato', 'Extrato', 'O extrato financeiro está sendo migrado para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/receitas', 'Receitas', 'O módulo de receitas está sendo migrado para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/despesas', 'Despesas', 'O módulo de despesas está sendo migrado para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/analise-receitas', 'Análise de Receitas', 'A análise de receitas está sendo migrada para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/analise-despesas', 'Análise de Despesas', 'A análise de despesas está sendo migrada para o novo design.', { secretaryPermission: 'financeiro' }),
      comingSoonRoute('financeiro/analise-avancada', 'Análise Avançada', 'A análise avançada está sendo migrada para o novo design.', { roles: ['ADMIN', 'DOCTOR'] }),
      comingSoonRoute('financeiro/formas-pagamento', 'Formas de Pagamento', 'O cadastro de formas de pagamento está sendo migrado para o novo design.', { roles: ['ADMIN', 'DOCTOR'] }),
      comingSoonRoute('financeiro/contas-bancarias', 'Contas Bancárias', 'O cadastro de contas bancárias está sendo migrado para o novo design.', { roles: ['ADMIN', 'DOCTOR'] }),
      comingSoonRoute('financeiro/centros-custo', 'Centros de Custo', 'O cadastro de centros de custo está sendo migrado para o novo design.', { roles: ['ADMIN', 'DOCTOR'] }),

      comingSoonRoute('usuarios', 'Usuários', 'A gestão de usuários está sendo migrada para o novo design.', { roles: ['ADMIN'] }),
      comingSoonRoute('admin/gestao', 'Gestão', 'O painel de gestão administrativa está sendo migrado para o novo design.', { roles: ['ADMIN'] }),
      comingSoonRoute('admin/planos', 'Planos', 'O painel de planos está sendo migrado para o novo design.', { roles: ['ADMIN'] }),
      comingSoonRoute('admin/sql', 'SQL Admin', 'O console SQL administrativo está sendo migrado para o novo design.', { roles: ['ADMIN'] }),
      comingSoonRoute('admin/integracoes', 'Integrações (Admin)', 'O painel de integrações administrativas está sendo migrado para o novo design.', { roles: ['ADMIN'] }),
      comingSoonRoute('admin/desenvolvedor', 'Admin Desenvolvedor', 'O painel do desenvolvedor da plataforma está sendo migrado para o novo design.', { roles: ['ADMIN'] }),

      comingSoonRoute('minhas-salas', 'Minhas Salas', 'A tela de salas está sendo migrada para o novo design.', { roles: ['SECRETARY'] }),
      comingSoonRoute('agente/chatbot', 'Agente de IA', 'O construtor de fluxos do Agente de IA está sendo migrado para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] }),

      { path: 'configuracoes', redirect: '/configuracoes/perfil' },
      comingSoonRoute('configuracoes/perfil', 'Perfil', 'A tela de perfil está sendo migrada para o novo design.'),
      comingSoonRoute('configuracoes/plano-financeiro', 'Plano', 'A tela de plano e assinatura está sendo migrada para o novo design.'),
      comingSoonRoute('configuracoes/equipe', 'Equipe', 'A gestão de equipe está sendo migrada para o novo design.', { roles: ['DOCTOR', 'ADMIN'] }),
      comingSoonRoute('configuracoes/ajuda', 'Ajuda', 'A central de ajuda está sendo migrada para o novo design.'),
      comingSoonRoute('configuracoes/documentacao', 'Documentação', 'A documentação está sendo migrada para o novo design.'),
      comingSoonRoute('configuracoes/tipos-atendimento', 'Tipos de Atendimento', 'Os tipos de atendimento estão sendo migrados para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] }),
      comingSoonRoute('configuracoes/salas', 'Salas', 'A gestão de salas está sendo migrada para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'salas' }),
      comingSoonRoute('configuracoes/documentos', 'Documentos', 'A gestão de documentos está sendo migrada para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'documentos' }),
      comingSoonRoute('configuracoes/formas-pagamento', 'Formas de Pagamento', 'O cadastro de formas de pagamento está sendo migrado para o novo design.', { roles: ['ADMIN', 'DOCTOR'] }),
      comingSoonRoute('configuracoes/notificacoes', 'Notificações', 'As configurações de notificações estão sendo migradas para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], platformAccess: 'notifications' }),
      comingSoonRoute('configuracoes/integracoes', 'Integrações', 'As integrações estão sendo migradas para o novo design.', { roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], platformAccess: 'integrations', secretaryPermission: INTEGRATION_PERMISSION_KEYS }),
      comingSoonRoute('configuracoes/assinatura', 'Assinatura', 'A tela de assinatura está sendo migrada para o novo design.'),
      comingSoonRoute('configuracoes/assinatura/pendente', 'Pagamento Pendente', 'A tela de pagamento pendente está sendo migrada para o novo design.'),
    ],
  },

  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  const meta = to.meta as RouteMeta

  if (meta.guestOnly && authStore.isAuthenticated) {
    return '/dashboard'
  }

  if (meta.requiresAuth && !authStore.isAuthenticated) {
    return '/login'
  }

  if (meta.roles && authStore.user && !meta.roles.includes(authStore.user.role)) {
    return '/dashboard'
  }

  if (meta.platformAccess) {
    const user = authStore.user
    const hasAccess = !!user?.isPlatformDeveloper
      || (meta.platformAccess === 'notifications' ? !!user?.notificationsAccess : !!user?.integrationsAccess)
    if (!hasAccess) return '/dashboard'
  }

  return true
})

export default router
