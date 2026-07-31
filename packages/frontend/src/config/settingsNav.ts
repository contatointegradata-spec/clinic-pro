import type { LucideIcon } from 'lucide-react'
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
} from 'lucide-react'
import { INTEGRATION_PERMISSION_KEYS } from '../hooks/useSecretaryPermissions'

export interface SettingsNavUser {
  role?: string
  isPlatformDeveloper?: boolean
  notificationsAccess?: boolean
  integrationsAccess?: boolean
}

export interface SettingsNavItem {
  to: string
  icon: LucideIcon
  label: string
  shortLabel?: string
  roles: string[]
  /**
   * Para SECRETARY, exige além do role que o médico tenha liberado esta
   * permissão em "Gestão de Acessos". Um array significa "pelo menos uma
   * das chaves" (ex.: Integrações, liberada por tipo individual).
   */
  secretaryPermission?: string | string[]
  /**
   * Item restrito ao desenvolvedor da plataforma: só aparece se
   * `user.isPlatformDeveloper` ou se o desenvolvedor liberou o acesso
   * individualmente para este usuário (`user[platformGate + 'Access']`).
   * Ver painel Admin Desenvolvedor (routes/platform-admin.ts).
   */
  platformGate?: 'notifications' | 'integrations'
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { to: '/configuracoes/perfil', icon: User, label: 'Meu Perfil', shortLabel: 'Perfil', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/configuracoes/plano-financeiro', icon: CreditCard, label: 'Convênio', shortLabel: 'Convênio', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/configuracoes/tipos-atendimento', icon: Stethoscope, label: 'Procedimento', shortLabel: 'Procedimento', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/configuracoes/salas', icon: MapPin, label: 'Clínica', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'salas' },
  { to: '/configuracoes/documentos', icon: FileText, label: 'Documentos', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: 'documentos' },
  { to: '/configuracoes/formas-pagamento', icon: Wallet, label: 'Formas de Pagamento', shortLabel: 'Pagamento', roles: ['ADMIN', 'DOCTOR'] },
  { to: '/configuracoes/notificacoes', icon: Bell, label: 'Notificações', shortLabel: 'Alertas', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], platformGate: 'notifications' },
  { to: '/configuracoes/integracoes', icon: Webhook, label: 'Integrações', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'], secretaryPermission: INTEGRATION_PERMISSION_KEYS, platformGate: 'integrations' },
  { to: '/configuracoes/assinatura', icon: Sparkles, label: 'Assinatura', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/configuracoes/equipe', icon: Users, label: 'Minha Equipe', shortLabel: 'Equipe', roles: ['DOCTOR'] },
  { to: '/configuracoes/ajuda', icon: HelpCircle, label: 'Ajuda & Suporte', shortLabel: 'Ajuda', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/configuracoes/documentacao', icon: BookOpen, label: 'Documentação', shortLabel: 'Docs', roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { to: '/usuarios', icon: UserCog, label: 'Usuários', roles: ['ADMIN'] },
  { to: '/admin/gestao', icon: Shield, label: 'Gestão de Dados', shortLabel: 'Gestão', roles: ['ADMIN'] },
  { to: '/admin/planos', icon: CreditCard, label: 'Gestão de Planos', shortLabel: 'Planos', roles: ['ADMIN'] },
  { to: '/admin/desenvolvedor', icon: Code2, label: 'Admin Desenvolvedor', shortLabel: 'Dev', roles: ['ADMIN'] },
]

export function getVisibleSettingsNav(user?: SettingsNavUser, secretaryPermissions?: Record<string, boolean>) {
  const role = user?.role
  if (!role) return []
  return SETTINGS_NAV_ITEMS.filter(item => {
    if (!item.roles.includes(role)) return false

    // "Admin Desenvolvedor" só aparece pro desenvolvedor da plataforma —
    // mesmo entre ADMINs (donos de clínica não têm acesso).
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
