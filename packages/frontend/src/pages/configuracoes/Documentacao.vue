<script setup lang="ts">
import { BookOpen, Calendar, Users, DollarSign, ClipboardList, Shield, Settings, Webhook, ExternalLink } from 'lucide-vue-next'

const modules = [
  {
    icon: Calendar,
    title: 'Agenda',
    color: 'text-primary-600',
    bg: 'bg-primary-50',
    border: 'border-primary-200',
    desc: 'Gerencie todos os agendamentos da clínica.',
    items: [
      'Visualize a agenda semanal com slots de 30 minutos',
      'Clique em qualquer horário para criar uma consulta',
      'Edite status: Agendado, Confirmado, Concluído, Cancelado, Faltou',
      'Filtre por médico (admin/secretária)',
      'Consultas com horários exatos (ex: 7:50, 8:35)',
    ],
  },
  {
    icon: Users,
    title: 'Pacientes',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    desc: 'Cadastro completo com dados pessoais e planos de saúde.',
    items: [
      'Dados pessoais: nome, CPF, RG, data de nascimento, endereço',
      'Contato: telefone e email',
      'Vincule planos de saúde com valor e carteirinha',
      'Histórico de consultas e prontuários',
      'Busca por nome, CPF, RG ou telefone',
    ],
  },
  {
    icon: ClipboardList,
    title: 'Prontuário',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    desc: 'Registros médicos organizados por paciente e médico.',
    items: [
      'Tipos: Anamnese, Evolução, Prescrição, Exame, Atestado, Outros',
      'Registros agrupados por médico atendente',
      'Múltiplos médicos podem ter prontuários do mesmo paciente',
      'Histórico completo com datas e conteúdo',
    ],
  },
  {
    icon: DollarSign,
    title: 'Financeiro',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    desc: 'Controle financeiro — acesso restrito a médicos e admins.',
    items: [
      'Registre receitas e despesas',
      'Gráfico anual de receitas vs despesas',
      'Categorias personalizáveis',
      'Status: Pendente, Pago, Cancelado',
      'Filtros por médico, tipo e período',
    ],
  },
  {
    icon: Shield,
    title: 'Controle de Acesso',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    desc: 'Permissões por perfil de usuário.',
    items: [
      'ADMIN: acesso total ao sistema',
      'MÉDICO: agenda própria, pacientes e financeiro pessoal',
      'SECRETÁRIA: agenda e pacientes — sem acesso ao financeiro',
      'Troque perfis a qualquer momento (admin)',
      'Usuários inativos não conseguem fazer login',
    ],
  },
  {
    icon: Settings,
    title: 'Configurações',
    color: 'text-slate-600',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    desc: 'Personalize o sistema para sua clínica.',
    items: [
      'Meu Perfil: altere dados pessoais e senha',
      'Planos de Saúde: cadastre convênios e formas de pagamento',
      'Usuários: crie e gerencie usuários do sistema',
      'Ajuda: suporte e perguntas frequentes',
    ],
  },
]

const integrationItems = [
  'Webhooks outgoing: envie dados para n8n, Make.com, Zapier ou qualquer URL',
  'Cada evento (consulta agendada, concluída, paciente criado...) dispara uma requisição POST',
  'Assinatura HMAC-SHA256 via header X-ClinIQ-Signature para segurança',
  'Google Calendar: sincronize agendamentos automaticamente',
  'Gmail: envie confirmações de consulta por email',
  'WhatsApp: integração via Evolution API (WhatsApp Business)',
  'Agente de IA: conecte OpenAI, Gemini ou qualquer chatbot via webhook',
  'Logs de entrega em tempo real com status HTTP, duração e resposta',
]

const integrationLinks = [
  { label: 'n8n', url: 'https://n8n.io' },
  { label: 'Make.com', url: 'https://make.com' },
  { label: 'Evolution API', url: 'https://doc.evolution-api.com' },
  { label: 'Flowise AI', url: 'https://flowiseai.com' },
]

const payloadExample = `{
  "event": "appointment.created",
  "timestamp": "2025-06-06T10:30:00.000Z",
  "data": {
    "id": "appt_abc123",
    "patientName": "João Silva",
    "patientPhone": "(11) 99999-9999",
    "date": "2025-06-10T14:00:00.000Z",
    "type": "Consulta",
    "status": "SCHEDULED",
    "value": 200.00
  }
}`
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div>
      <h1 class="page-title">Documentação</h1>
      <p class="page-subtitle">Guia completo de uso do sistema</p>
    </div>

    <div class="card bg-gradient-to-r from-primary-600 to-primary-700 text-white border-0">
      <div class="flex items-start gap-4">
        <BookOpen class="w-8 h-8 opacity-80 flex-shrink-0 mt-0.5" />
        <div>
          <h2 class="font-bold text-lg">Agenda Clínica — v1.0</h2>
          <p class="text-primary-200 text-sm mt-1">
            Sistema completo de gestão médica com agendamento, prontuário eletrônico, controle de pacientes e financeiro integrado.
          </p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div v-for="mod in modules" :key="mod.title" :class="['card border', mod.border]">
        <div class="flex items-start gap-4">
          <div :class="['w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', mod.bg]">
            <component :is="mod.icon" :class="['w-5 h-5', mod.color]" />
          </div>
          <div class="flex-1">
            <h3 class="font-bold text-slate-900 mb-1">{{ mod.title }}</h3>
            <p class="text-sm text-slate-500 mb-3">{{ mod.desc }}</p>
            <ul class="space-y-1.5">
              <li v-for="item in mod.items" :key="item" class="flex items-start gap-2 text-sm text-slate-600">
                <div :class="['w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', mod.color.replace('text-', 'bg-')]" />
                {{ item }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Integrações -->
    <div class="card border border-primary-200">
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-50">
          <Webhook class="w-5 h-5 text-primary-600" />
        </div>
        <div class="flex-1">
          <h3 class="font-bold text-slate-900 mb-1">Integrações e Webhooks</h3>
          <p class="text-sm text-slate-500 mb-3">Conecte o ClinIQ Pro a qualquer plataforma externa usando webhooks, Google ou IA.</p>
          <ul class="space-y-1.5 mb-4">
            <li v-for="item in integrationItems" :key="item" class="flex items-start gap-2 text-sm text-slate-600">
              <div class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-primary-500" />
              {{ item }}
            </li>
          </ul>

          <div class="bg-slate-900 rounded-xl overflow-hidden mb-4">
            <div class="px-3 py-2 border-b border-white/10 text-xs text-slate-400 font-mono">Exemplo de payload (appointment.created)</div>
            <pre class="px-4 py-3 text-xs text-emerald-400 overflow-x-auto leading-relaxed">{{ payloadExample }}</pre>
          </div>

          <div class="flex flex-wrap gap-2">
            <a
              v-for="link in integrationLinks" :key="link.url"
              :href="link.url" target="_blank" rel="noopener noreferrer"
              class="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-lg text-xs font-medium transition-colors"
            >
              <ExternalLink class="w-3 h-3" />
              {{ link.label }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
