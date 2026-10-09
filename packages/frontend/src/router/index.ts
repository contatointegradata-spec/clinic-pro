import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { INTEGRATION_PERMISSION_KEYS } from '../composables/useSecretaryPermissions'

const AppShell = () => import('../components/layout/AppShell.vue')
const Login = () => import('../pages/Login.vue')
const Cadastro = () => import('../pages/Cadastro.vue')
const OrcamentoPublico = () => import('../pages/OrcamentoPublico.vue')
const PacienteFicha = () => import('../pages/PacienteFicha.vue')
const LandingPage = () => import('../pages/LandingPage.vue')
const Dashboard = () => import('../pages/Dashboard.vue')
const Agenda = () => import('../pages/Agenda.vue')
const Pacientes = () => import('../pages/Pacientes.vue')
const Usuarios = () => import('../pages/Usuarios.vue')
const MinhasSalas = () => import('../pages/MinhasSalas.vue')
const WhatsappChatbot = () => import('../pages/WhatsappChatbot.vue')
const CRM = () => import('../pages/CRM.vue')
const Atendimento = () => import('../pages/Atendimento.vue')
const Estoque = () => import('../pages/Estoque.vue')

const FinanceiroResumo = () => import('../pages/financeiro/Resumo.vue')
const FluxoCaixa = () => import('../pages/financeiro/FluxoCaixa.vue')
const NotasFiscais = () => import('../pages/financeiro/NotasFiscais.vue')
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
  // Orçamento público — a paciente aprova pelo link, sem login.
  { path: '/orcamento/:token', component: OrcamentoPublico },
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
      { path: 'pacientes/:id', component: PacienteFicha, meta: { label: 'Ficha da paciente' } },
      // Telas antigas que viraram parte de Pacientes / ficha da paciente.
      { path: 'pacientes/:id/clinico', redirect: to => ({ path: `/pacientes/${to.params.id}`, query: to.query }) },
      { path: 'orcamentos', redirect: { path: '/pacientes', query: { aba: 'orcamentos' } } },
      { path: 'retornos', redirect: { path: '/pacientes', query: { aba: 'retornos' } } },
      {
        path: 'prontuario',
        redirect: to => typeof to.query.paciente === 'string'
          ? { path: `/pacientes/${to.query.paciente}`, query: { aba: 'prontuario' } }
          : { path: '/pacientes' },
      },
      { path: 'estoque', component: Estoque, meta: { label: 'Estoque', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] } },

      // Financeiro enxuto: Painel · Fluxo de caixa · Notas fiscais. Rotas antigas redirecionam.
      { path: 'financeiro', redirect: '/financeiro/painel' },
      { path: 'financeiro/painel', component: FinanceiroResumo, meta: { label: 'Painel financeiro', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/fluxo-caixa', component: FluxoCaixa, meta: { label: 'Fluxo de caixa', secretaryPermission: 'financeiro' } },
      { path: 'financeiro/notas-fiscais', component: NotasFiscais, meta: { label: 'Notas fiscais', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'financeiro/resumo', redirect: '/financeiro/painel' },
      { path: 'financeiro/analise-receitas', redirect: '/financeiro/painel' },
      { path: 'financeiro/analise-despesas', redirect: '/financeiro/painel' },
      { path: 'financeiro/analise-avancada', redirect: '/financeiro/painel' },
      { path: 'financeiro/extrato', redirect: '/financeiro/fluxo-caixa' },
      { path: 'financeiro/receitas', redirect: '/financeiro/fluxo-caixa' },
      { path: 'financeiro/despesas', redirect: '/financeiro/fluxo-caixa' },
      { path: 'financeiro/formas-pagamento', redirect: '/configuracoes/formas-pagamento' },
      { path: 'financeiro/contas-bancarias', redirect: '/configuracoes/contas-bancarias' },
      { path: 'financeiro/centros-custo', redirect: '/configuracoes/centros-custo' },

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
      { path: 'configuracoes/contas-bancarias', component: ContasBancarias, meta: { label: 'Contas Bancárias', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'configuracoes/centros-custo', component: CentrosCusto, meta: { label: 'Centros de Custo', roles: ['ADMIN', 'DOCTOR'] } },
      { path: 'configuracoes/notificacoes', component: ConfigNotificacoes, meta: { label: 'Mensagens automáticas', roles: ['DOCTOR', 'SECRETARY'] } },
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
