import type { Component } from 'vue'
import {
  User,
  CreditCard,
  HelpCircle,
  BookOpen,
  UserCog,
  Users,
  Stethoscope,
  MapPin,
  FileText,
  Bell,
  Wallet,
  Webhook,
  Shield,
  Sparkles,
  Code2,
  Building2,
  FolderTree,
} from 'lucide-vue-next'
import { INTEGRATION_PERMISSION_KEYS } from '../composables/useSecretaryPermissions'

export interface SettingsNavUser {
  role?: string
  isPlatformDeveloper?: boolean
  notificationsAccess?: boolean
  integrationsAccess?: boolean
}

export interface SettingsNavItem {
  to: string
  icon: Component
  label: string
  shortLabel?: string
  roles: string[]
  secretaryPermission?: string | string[]
  platformGate?: 'notifications' | 'integrations'
  group: 'clinica' | 'financeiro' | 'conta' | 'admin'
}

export const SETTINGS_GROUP_LABELS: Record<SettingsNavItem['group'], string> = {
  clinica: 'Clínica',
  financeiro: 'Financeiro',
  conta: 'Conta',
  admin: 'Administração',
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  // Clínica — como a clínica funciona
  { to: '/configuracoes/salas', icon: MapPin, label: 'Clínica e salas', shortLabel: 'Clínica', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'salas', group: 'clinica' },
  { to: '/configuracoes/tipos-atendimento', icon: Stethoscope, label: 'Procedimentos e retornos', shortLabel: 'Procedimentos', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'clinica' },
  { to: '/configuracoes/plano-financeiro', icon: CreditCard, label: 'Convênios', shortLabel: 'Convênios', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'clinica' },
  { to: '/configuracoes/documentos', icon: FileText, label: 'Modelos de documentos', shortLabel: 'Modelos', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'documentos', group: 'clinica' },
  { to: '/configuracoes/notificacoes', icon: Bell, label: 'Mensagens automáticas', shortLabel: 'Mensagens', roles: ['DOCTOR', 'SECRETARY'], group: 'clinica' },
  { to: '/configuracoes/equipe', icon: Users, label: 'Minha equipe', shortLabel: 'Equipe', roles: ['DOCTOR'], group: 'clinica' },
  // Financeiro — cadastros usados nos lançamentos
  { to: '/configuracoes/formas-pagamento', icon: Wallet, label: 'Formas de pagamento', shortLabel: 'Pagamento', roles: ['ADMIN', 'DOCTOR'], group: 'financeiro' },
  { to: '/configuracoes/contas-bancarias', icon: Building2, label: 'Contas bancárias', shortLabel: 'Contas', roles: ['ADMIN', 'DOCTOR'], group: 'financeiro' },
  { to: '/configuracoes/centros-custo', icon: FolderTree, label: 'Centros de custo', shortLabel: 'Centros', roles: ['ADMIN', 'DOCTOR'], group: 'financeiro' },
  // Conta
  { to: '/configuracoes/perfil', icon: User, label: 'Meu perfil', shortLabel: 'Perfil', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'conta' },
  { to: '/configuracoes/assinatura', icon: Sparkles, label: 'Assinatura', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'conta' },
  { to: '/configuracoes/integracoes', icon: Webhook, label: 'Integrações', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: INTEGRATION_PERMISSION_KEYS, platformGate: 'integrations', group: 'conta' },
  { to: '/configuracoes/ajuda', icon: HelpCircle, label: 'Ajuda e suporte', shortLabel: 'Ajuda', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'conta' },
  { to: '/configuracoes/documentacao', icon: BookOpen, label: 'Documentação', shortLabel: 'Docs', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], group: 'conta' },
  // Administração da plataforma
  { to: '/usuarios', icon: UserCog, label: 'Usuários', roles: ['ADMIN'], group: 'admin' },
  { to: '/admin/gestao', icon: Shield, label: 'Gestão de dados', shortLabel: 'Gestão', roles: ['ADMIN'], group: 'admin' },
  { to: '/admin/planos', icon: CreditCard, label: 'Gestão de planos', shortLabel: 'Planos', roles: ['ADMIN'], group: 'admin' },
  { to: '/admin/desenvolvedor', icon: Code2, label: 'Admin desenvolvedor', shortLabel: 'Dev', roles: ['ADMIN'], group: 'admin' },
]

export function getVisibleSettingsNav(user?: SettingsNavUser, secretaryPermissions?: Record<string, boolean>) {
  const role = user?.role
  if (!role) return []
  return SETTINGS_NAV_ITEMS.filter(item => {
    if (!item.roles.includes(role)) return false

    if (item.to === '/admin/desenvolvedor') {
      return !!user?.isPlatformDeveloper
    }

    if (item.platformGate) {
      const accessField = item.platformGate === 'notifications' ? 'notificationsAccess' : 'integrationsAccess'
      if (!user?.isPlatformDeveloper && !user?.[accessField]) return false
    }

    if (role === 'SECRETARY' && item.secretaryPermission) {
      const keys = Array.isArray(item.secretaryPermission) ? item.secretaryPermission : [item.secretaryPermission]
      return keys.some(key => !!secretaryPermissions?.[key])
    }
    return true
  })
}
