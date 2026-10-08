import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { INTEGRATION_PERMISSION_KEYS } from '../composables/useSecretaryPermissions'

const AppShell = () => import('../components/layout/AppShell.vue')
const Login = () => import('../pages/Login.vue')
const Cadastro = () => import('../pages/Cadastro.vue')
const LandingPage = () => import('../pages/LandingPage.vue')
const Dashboard = () => import('../pages/Dashboard.vue')
const Agenda = () => import('../pages/Agenda.vue')
const Pacientes = () => import('../pages/Pacientes.vue')
const Prontuario = () => import('../pages/Prontuario.vue')
const Usuarios = () => import('../pages/Usuarios.vue')
const MinhasSalas = () => import('../pages/MinhasSalas.vue')
const WhatsappChatbot = () => import('../pages/WhatsappChatbot.vue')
const CRM = () => import('../pages/CRM.vue')
const Atendimento = () => import('../pages/Atendimento.vue')
const Estoque = () => import('../pages/Estoque.vue')

const FinanceiroResumo = () => import('../pages/financeiro/Resumo.vue')
const FluxoCaixa = () => import('../pages/financeiro/FluxoCaixa.vue')
const Extrato = () => import('../pages/financeiro/Extrato.vue')
const Receitas = () => import('../pages/financeiro/Receitas.vue')
const Despesas = () => import('../pages/financeiro/Despesas.vue')
const AnaliseReceitas = () => import('../pages/financeiro/AnaliseReceitas.vue')
const AnaliseDespesas = () => import('../pages/financeiro/AnaliseDespesas.vue')
const AnaliseAvancada = () => import('../pages/financeiro/AnaliseAvancada.vue')
const FormasPagamento = () => import('../pages/configuracoes/FormasPagamento.vue')
const ContasBancarias = () => import('../pages/financeiro/ContasBancarias.vue')
const CentrosCusto = () => import('../pages/financeiro/CentrosCusto.vue')

const AdminGestao = () => import('../pages/AdminGestao.vue')
const AdminPlanos = () => import('../pages/AdminPlanos.vue')
const AdminSQL = () => import('../pages/AdminSQL.vue')
const AdminIntegracoes = () => import('../pages/AdminIntegracoes.vue')
const AdminDesenvolvedor = () => import('../pages/AdminDesenvolvedor.vue')

const Perfil = () => import('../pages/configuracoes/Perfil.vue')
const PlanoFinanceiro = () => import('../pages/configuracoes/PlanoFinanceiro.vue')
const Equipe = () => import('../pages/configuracoes/Equipe.vue')
const Ajuda = () => import('../pages/configuracoes/Ajuda.vue')
const Documentacao = () => import('../pages/configuracoes/Documentacao.vue')
const TiposAtendimento = () => import('../pages/configuracoes/TiposAtendimento.vue')
const Salas = () => import('../pages/configuracoes/Salas.vue')
const Documentos = () => import('../pages/configuracoes/Documentos.vue')
const Integracoes = () => import('../pages/configuracoes/Integracoes.vue')
const Assinatura = () => import('../pages/configuracoes/Assinatura.vue')
const AssinaturaPendente = () => import('../pages/configuracoes/AssinaturaPendente.vue')
const ConfigNotificacoes = () => import('../pages/configuracoes/ConfigNotificacoes.vue')

interface RouteMeta {
  requiresAuth?: boolean
  guestOnly?: boolean
  roles?: Array<'ADMIN' | 'DOCTOR' | 'SECRETARY'>
  secretaryPermission?: string | string[]
  platformAccess?: 'notifications' | 'integrations'
  label?: string
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: Login,
    meta: { guestOnly: true },
  },
  {
    path: '/cadastro',
    component: Cadastro,
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
      { path: 'estoque', component: Estoque, meta: { label: 'Estoque', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },

      { path: 'financeiro', redirect: '/financeiro/resumo' },
      { path: 'financeiro/resumo', component: FinanceiroResumo, meta: { label: 'Resumo', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/fluxo-caixa', component: FluxoCaixa, meta: { label: 'Fluxo de Caixa', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/extrato', component: Extrato, meta: { label: 'Extrato', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/receitas', component: Receitas, meta: { label: 'Receitas', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/despesas', component: Despesas, meta: { label: 'Despesas', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/analise-receitas', component: AnaliseReceitas, meta: { label: 'Análise de Receitas', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/analise-despesas', component: AnaliseDespesas, meta: { label: 'Análise de Despesas', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/analise-avancada', component: AnaliseAvancada, meta: { label: 'Análise Avançada', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'financeiro/formas-pagamento', component: FormasPagamento, meta: { label: 'Formas de Pagamento', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'financeiro/contas-bancarias', component: ContasBancarias, meta: { label: 'Contas Bancárias', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'financeiro/centros-custo', component: CentrosCusto, meta: { label: 'Centros de Custo', roles: ['ADMIN', 'DOCTOR'] } },

      { path: 'usuarios', component: Usuarios, meta: { label: 'Usuários', roles: ['ADMIN'] } },
      { path: 'admin/gestao', component: AdminGestao, meta: { label: 'Gestão', roles: ['ADMIN'] } },
      { path: 'admin/planos', component: AdminPlanos, meta: { label: 'Planos', roles: ['ADMIN'] } },
      { path: 'admin/sql', component: AdminSQL, meta: { label: 'SQL Admin', roles: ['ADMIN'] } },
      { path: 'admin/integracoes', component: AdminIntegracoes, meta: { label: 'Integrações (Admin)', roles: ['ADMIN'] } },
      { path: 'admin/desenvolvedor', component: AdminDesenvolvedor, meta: { label: 'Admin Desenvolvedor', roles: ['ADMIN'] } },

      { path: 'minhas-salas', component: MinhasSalas, meta: { label: 'Minhas Salas', roles: ['SECRETARY'] } },
      { path: 'agente/chatbot', component: WhatsappChatbot, meta: { label: 'Agente de IA', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },
      { path: 'agente/crm', component: CRM, meta: { label: 'CRM', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },
      { path: 'atendimento', component: Atendimento, meta: { label: 'Atendimento', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },

      { path: 'configuracoes', redirect: '/configuracoes/perfil' },
      { path: 'configuracoes/perfil', component: Perfil, meta: { label: 'Perfil' } },
      { path: 'configuracoes/plano-financeiro', component: PlanoFinanceiro, meta: { label: 'Plano' } },
      { path: 'configuracoes/equipe', component: Equipe, meta: { label: 'Equipe', roles: ['DOCTOR', 'ADMIN'] } },
      { path: 'configuracoes/ajuda', component: Ajuda, meta: { label: 'Ajuda' } },
      { path: 'configuracoes/documentacao', component: Documentacao, meta: { label: 'Documentação' } },
      { path: 'configuracoes/tipos-atendimento', component: TiposAtendimento, meta: { label: 'Tipos de Atendimento', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },
      { path: 'configuracoes/salas', component: Salas, meta: { label: 'Salas', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'salas' } },
      { path: 'configuracoes/documentos', component: Documentos, meta: { label: 'Documentos', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'documentos' } },
      { path: 'configuracoes/formas-pagamento', component: FormasPagamento, meta: { label: 'Formas de Pagamento', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'configuracoes/notificacoes', component: ConfigNotificacoes, meta: { label: 'Notificações', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], platformAccess: 'notifications' } },
      { path: 'configuracoes/integracoes', component: Integracoes, meta: { label: 'Integrações', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], platformAccess: 'integrations', secretaryPermission: INTEGRATION_PERMISSION_KEYS } },
      { path: 'configuracoes/assinatura', component: Assinatura, meta: { label: 'Assinatura' } },
      { path: 'configuracoes/assinatura/pendente', component: AssinaturaPendente, meta: { label: 'Pagamento Pendente' } },
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
