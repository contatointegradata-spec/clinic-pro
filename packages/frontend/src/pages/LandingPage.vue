<script setup lang="ts">
import { ref } from 'vue'
import {
  Calendar, BellRing, Users, FileText, Wallet, Package, KanbanSquare, MapPin, FileSignature,
  ArrowRight, Check, ChevronDown, Menu, X, Clock, CircleX, Sparkles, ShieldCheck, LockKeyhole,
  Stethoscope, Brain, Smile, Activity, Apple, HeartPulse, UserPlus, Zap, TrendingUp, Smartphone,
  MessageSquare, Calculator, Gift, Receipt, UserCheck,
} from 'lucide-vue-next'
import ClinicLogo from '../components/ui/ClinicLogo.vue'

// Mantenha em sincronia com packages/backend/src/lib/billing-config.ts
const PRICE = '49,90'
const TRIAL_DAYS = 3

const mobileMenuOpen = ref(false)
const openFaq = ref<number | null>(0)

const NAV = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#preco', label: 'Preço' },
  { href: '#duvidas', label: 'Dúvidas' },
]

const PAINS = [
  { title: 'Horas perdidas no WhatsApp', desc: 'Responder paciente, confirmar consulta, remarcar cancelamento. São horas por semana que você poderia estar atendendo — ou descansando.' },
  { title: 'Consultas vazias por falta', desc: 'O paciente esquece ou cancela em cima da hora, e você não tem tempo de encaixar outra pessoa no horário.' },
  { title: 'Paciente que desiste de esperar', desc: 'Ele escreve às 15h enquanto você atende. Quando você responde, ele já marcou com outro profissional.' },
  { title: 'Financeiro no escuro', desc: 'Agenda num lugar, pagamentos em outro, prontuário no papel. No fim do mês, ninguém sabe ao certo quanto entrou.' },
]

const HIGHLIGHTS = [
  {
    icon: MessageSquare,
    title: 'Atendimento no WhatsApp 24 horas',
    desc: 'O chatbot da clínica responde o paciente na hora: mostra os horários livres, agenda, confirma ou cancela a consulta — mesmo enquanto você atende ou dorme.',
    note: 'Você só acompanha tudo pela agenda.',
  },
  {
    icon: BellRing,
    title: 'Lembretes automáticos que reduzem faltas',
    desc: 'Mensagem automática no WhatsApp 24 horas e 2 horas antes de cada consulta, com data, horário e endereço. O paciente confirma ou avisa se não puder ir.',
    note: 'Horário cancelado volta a ficar livre na agenda.',
  },
  {
    icon: Wallet,
    title: 'A clínica inteira em um só sistema',
    desc: 'Agenda, pacientes, prontuário eletrônico, financeiro, estoque e CRM conversando entre si. Nada de planilha, caderno ou cinco aplicativos diferentes.',
    note: 'Saiba exatamente quanto a clínica faturou no mês.',
  },
]

const AUTOMATIONS = [
  { icon: BellRing, label: 'Lembrete 24h antes da consulta' },
  { icon: Clock, label: 'Lembrete 2h antes da consulta' },
  { icon: Receipt, label: 'Aviso de pagamento em atraso' },
  { icon: UserCheck, label: 'Reativação de pacientes sumidos' },
  { icon: Gift, label: 'Mensagem de aniversário' },
]

const FEATURES = [
  { icon: Calendar, title: 'Agenda inteligente', desc: 'Dia, semana ou mês. Consultas organizadas por sala, profissional e tipo de atendimento, sem conflitos de horário.' },
  { icon: MessageSquare, title: 'Chatbot de WhatsApp', desc: 'Fluxos de atendimento automáticos que agendam, confirmam e cancelam consultas pelo WhatsApp da clínica.' },
  { icon: Users, title: 'Cadastro de pacientes', desc: 'Ficha completa, histórico de atendimentos e pré-cadastro rápido direto da agenda.' },
  { icon: FileText, title: 'Prontuário eletrônico', desc: 'Anamneses, evoluções e registros de cada atendimento em um histórico seguro e fácil de consultar.' },
  { icon: Wallet, title: 'Gestão financeira', desc: 'Receitas, despesas, extrato, fluxo de caixa, contas bancárias, centros de custo e análises por período.' },
  { icon: KanbanSquare, title: 'CRM de pacientes', desc: 'Acompanhe cada contato em um funil visual, do primeiro “oi” até a consulta agendada.' },
  { icon: Package, title: 'Controle de estoque', desc: 'Materiais e insumos com entradas, saídas e alerta de estoque baixo.' },
  { icon: MapPin, title: 'Salas e equipe', desc: 'Vários consultórios na mesma conta, com secretárias e permissões de acesso por função.' },
  { icon: FileSignature, title: 'Documentos e relatórios', desc: 'Modelos de documentos e relatórios exportáveis em PDF e Excel.' },
]

const AUDIENCE = [
  { icon: Stethoscope, label: 'Médicos' },
  { icon: Brain, label: 'Psicólogos' },
  { icon: Smile, label: 'Dentistas' },
  { icon: Activity, label: 'Fisioterapeutas' },
  { icon: Apple, label: 'Nutricionistas' },
  { icon: HeartPulse, label: 'Clínicas multiprofissionais' },
]

const FOR_YOU = [
  'Você atende sozinho(a) ou com uma secretária e quer parar de perder tempo com tarefas manuais',
  'Tem consultório próprio ou divide salas e precisa de uma agenda única e organizada',
  'Usa caderno, Google Agenda e WhatsApp e já percebeu que isso não escala',
  'Quer saber quanto entra e quanto sai da clínica sem montar planilha',
]

const VS_SIMPLE = [
  { item: 'Agenda online', simple: true, us: true },
  { item: 'Lembretes automáticos no WhatsApp', simple: true, us: true },
  { item: 'Chatbot que agenda pelo WhatsApp', simple: false, us: true },
  { item: 'Prontuário eletrônico', simple: false, us: true },
  { item: 'Financeiro e fluxo de caixa', simple: false, us: true },
  { item: 'CRM e controle de estoque', simple: false, us: true },
  { item: 'Múltiplas salas e secretárias', simple: false, us: true },
]

const STEPS = [
  { icon: UserPlus, title: 'Crie sua conta', time: '2 minutos', desc: `Cadastro rápido, sem cartão de crédito. Você começa na hora com ${TRIAL_DAYS} dias grátis.` },
  { icon: Zap, title: 'Configure sua clínica', time: '10 minutos', desc: 'Cadastre salas, horários e tipos de atendimento, e conecte o WhatsApp da clínica lendo um QR Code.' },
  { icon: TrendingUp, title: 'A plataforma trabalha por você', time: '0 minutos seus', desc: 'Lembretes saem sozinhos, o chatbot atende os pacientes e o financeiro se atualiza a cada consulta.' },
]

const PLAN_ITEMS = [
  'Consultas e pacientes ilimitados',
  'Agenda com múltiplas salas',
  'Lembretes automáticos no WhatsApp (24h e 2h antes)',
  'Chatbot de atendimento no WhatsApp',
  'Prontuário eletrônico',
  'Gestão financeira completa',
  'CRM de pacientes e controle de estoque',
  'Secretárias com permissões de acesso',
  'Relatórios em PDF e Excel',
  'Atualizações e suporte incluídos',
]

const FAQ = [
  { q: 'Como funciona o teste grátis?', a: `Ao criar sua conta você tem ${TRIAL_DAYS} dias de acesso completo à plataforma, sem cadastrar cartão de crédito. Se gostar, é só assinar para continuar. Se não, não paga nada.` },
  { q: 'Quanto custa depois do teste?', a: `Plano único de R$ ${PRICE} por mês, com todas as funcionalidades principais incluídas. Sem taxa de adesão e sem cobrança por paciente.` },
  { q: 'Tenho fidelidade ou multa para cancelar?', a: 'Não. A assinatura é mensal e você cancela quando quiser, sem multa e sem contrato anual.' },
  { q: 'Meus pacientes precisam instalar algum aplicativo?', a: 'Não. Eles conversam com a clínica pelo próprio WhatsApp que já usam. Você também não instala nada: a ClinIQ Pro funciona no navegador do computador, tablet ou celular.' },
  { q: 'Já uso Google Agenda e WhatsApp. Por que pagar?', a: 'Porque eles não enviam lembretes sozinhos, não respondem o paciente quando você está ocupado, não guardam prontuário e não mostram quanto a clínica faturou. A ClinIQ Pro faz tudo isso em um só lugar.' },
  { q: 'Posso cadastrar minha secretária?', a: 'Sim. Adicione secretárias à equipe e defina exatamente o que cada uma pode ver e fazer — agenda, pacientes, financeiro e mais.' },
  { q: 'Os dados dos meus pacientes ficam seguros?', a: 'Sim. O acesso é protegido por login e permissões por função, a conexão é criptografada e cada clínica só enxerga os próprios dados.' },
  { q: 'Existem recursos adicionais?', a: 'Sim. Integrações avançadas — Agente de IA para atendimento no WhatsApp, Google Agenda, Gmail e webhooks — podem ser contratadas à parte, quando a sua clínica precisar.' },
]

const PREVIEW_APPOINTMENTS = [
  { time: '08:30', name: 'Mariana S.', type: 'Primeira consulta', status: 'Confirmado', tone: 'bg-emerald-50 text-emerald-700' },
  { time: '09:30', name: 'Carlos M.', type: 'Retorno', status: 'Lembrete enviado', tone: 'bg-sky-50 text-sky-700' },
  { time: '10:30', name: 'Juliana R.', type: 'Avaliação', status: 'Agendado pelo WhatsApp', tone: 'bg-violet-50 text-violet-700' },
  { time: '11:30', name: 'Pedro A.', type: 'Retorno', status: 'Confirmado', tone: 'bg-emerald-50 text-emerald-700' },
]

function toggleFaq(i: number) {
  openFaq.value = openFaq.value === i ? null : i
}
</script>

<template>
  <div class="min-h-screen bg-white text-slate-900">
    <!-- HEADER -->
    <header class="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-slate-100">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="#" aria-label="ClinIQ Pro"><ClinicLogo dark /></a>
        <nav class="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a v-for="n in NAV" :key="n.href" :href="n.href" class="hover:text-primary-600 transition-colors">{{ n.label }}</a>
        </nav>
        <div class="hidden md:flex items-center gap-2">
          <router-link to="/login" class="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-primary-600">Entrar</router-link>
          <router-link to="/cadastro" class="btn-primary text-sm">
            Teste grátis
            <ArrowRight class="w-4 h-4" />
          </router-link>
        </div>
        <button class="md:hidden p-2 -mr-2 text-slate-700" aria-label="Abrir menu" @click="mobileMenuOpen = !mobileMenuOpen">
          <X v-if="mobileMenuOpen" class="w-6 h-6" />
          <Menu v-else class="w-6 h-6" />
        </button>
      </div>
      <div v-if="mobileMenuOpen" class="md:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-1">
        <a v-for="n in NAV" :key="n.href" :href="n.href" class="block py-2 text-slate-700 font-medium" @click="mobileMenuOpen = false">{{ n.label }}</a>
        <div class="pt-3 flex flex-col gap-2">
          <router-link to="/login" class="btn-secondary justify-center">Entrar</router-link>
          <router-link to="/cadastro" class="btn-primary justify-center">Começar teste grátis</router-link>
        </div>
      </div>
    </header>

    <!-- HERO -->
    <section class="relative overflow-hidden bg-gradient-to-b from-primary-50/70 via-white to-white">
      <div class="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-sky-200/30 blur-3xl pointer-events-none" />
      <div class="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-20 lg:pt-20 lg:pb-24 grid lg:grid-cols-2 gap-12 items-center relative">
        <div>
          <span class="inline-flex items-center gap-1.5 bg-white text-primary-700 border border-primary-100 px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm">
            <Sparkles class="w-3.5 h-3.5" />
            Para consultórios e clínicas · {{ TRIAL_DAYS }} dias grátis
          </span>
          <h1 class="mt-6 text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1]">
            Menos faltas, agenda cheia e
            <span class="text-gradient-blue">sua clínica funcionando 24 horas</span>
          </h1>
          <p class="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            Lembretes automáticos e atendimento pelo WhatsApp, agenda, prontuário eletrônico e financeiro
            em uma única plataforma. Você atende — a ClinIQ Pro cuida da gestão.
          </p>
          <div class="mt-8 flex flex-col sm:flex-row gap-3">
            <router-link to="/cadastro" class="btn-primary justify-center px-6 py-3 text-base">
              Testar grátis por {{ TRIAL_DAYS }} dias
              <ArrowRight class="w-4 h-4" />
            </router-link>
            <a href="#como-funciona" class="btn-secondary justify-center px-6 py-3 text-base">Ver como funciona</a>
          </div>
          <ul class="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
            <li class="flex items-center gap-1.5"><Check class="w-4 h-4 text-emerald-500" /> Sem cartão de crédito</li>
            <li class="flex items-center gap-1.5"><Check class="w-4 h-4 text-emerald-500" /> Sem fidelidade</li>
            <li class="flex items-center gap-1.5"><Check class="w-4 h-4 text-emerald-500" /> Depois, R$ {{ PRICE }}/mês</li>
          </ul>
        </div>

        <!-- Prévia ilustrativa da agenda -->
        <div class="relative sm:py-12">
          <div class="bg-white rounded-2xl shadow-xl shadow-primary-900/10 border border-slate-200/80 overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p class="text-xs text-slate-400 font-medium">Agenda de hoje</p>
                <p class="font-semibold text-slate-800">Sala 1 · Consultório</p>
              </div>
              <span class="text-xs font-semibold bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full">Agenda cheia</span>
            </div>
            <ul class="divide-y divide-slate-100">
              <li v-for="a in PREVIEW_APPOINTMENTS" :key="a.time" class="px-5 py-3.5 flex items-center gap-4">
                <span class="text-sm font-semibold text-slate-500 w-12">{{ a.time }}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-800 truncate">{{ a.name }}</p>
                  <p class="text-xs text-slate-400">{{ a.type }}</p>
                </div>
                <span :class="[a.tone, 'text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap']">{{ a.status }}</span>
              </li>
            </ul>
          </div>
          <div class="hidden sm:flex absolute bottom-0 -left-4 bg-white rounded-xl shadow-lg border border-slate-200/80 px-4 py-3 items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Smartphone class="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p class="text-xs text-slate-400">WhatsApp · 22:14</p>
              <p class="text-sm font-semibold text-slate-800">Consulta agendada pelo paciente</p>
            </div>
          </div>
          <div class="hidden sm:flex absolute top-0 -right-4 bg-white rounded-xl shadow-lg border border-slate-200/80 px-4 py-3 items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
              <BellRing class="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p class="text-xs text-slate-400">Lembrete automático</p>
              <p class="text-sm font-semibold text-slate-800">Enviado 24h antes</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- PARA QUEM É -->
    <section class="border-y border-slate-100 bg-slate-50/60">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <p class="text-center text-sm font-medium text-slate-500 mb-5">Feita para profissionais da saúde que atendem com hora marcada</p>
        <div class="flex flex-wrap justify-center gap-3">
          <span v-for="a in AUDIENCE" :key="a.label" class="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-2 text-sm font-medium text-slate-700">
            <component :is="a.icon" class="w-4 h-4 text-primary-600" />
            {{ a.label }}
          </span>
        </div>
      </div>
    </section>

    <!-- DOR -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div class="text-center max-w-2xl mx-auto">
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">Quanto custa gerenciar a clínica no improviso?</h2>
        <p class="mt-4 text-slate-600 text-lg">Se você se reconhece em algum desses pontos, está deixando dinheiro na mesa todo mês.</p>
      </div>
      <div class="mt-12 grid sm:grid-cols-2 gap-5">
        <div v-for="p in PAINS" :key="p.title" class="rounded-2xl border border-rose-100 bg-rose-50/40 p-6 flex gap-4">
          <CircleX class="w-6 h-6 text-rose-400 flex-shrink-0" />
          <div>
            <h3 class="font-semibold text-slate-900">{{ p.title }}</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ p.desc }}</p>
          </div>
        </div>
      </div>

      <!-- A conta -->
      <div class="mt-10 rounded-3xl bg-slate-900 text-white p-8 sm:p-10">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Calculator class="w-5 h-5 text-sky-300" />
          </div>
          <p class="font-semibold text-lg">Faça a conta</p>
        </div>
        <div class="mt-6 grid md:grid-cols-3 gap-6">
          <div>
            <p class="text-slate-400 text-sm">Faltas</p>
            <p class="mt-1 text-slate-200">2 consultas perdidas por semana × R$ 200 × 4 semanas</p>
            <p class="mt-2 text-2xl font-bold text-rose-300">R$ 1.600/mês</p>
          </div>
          <div>
            <p class="text-slate-400 text-sm">Tempo no WhatsApp</p>
            <p class="mt-1 text-slate-200">4 horas por semana confirmando e remarcando = 16 horas/mês</p>
            <p class="mt-2 text-2xl font-bold text-rose-300">16 horas/mês</p>
          </div>
          <div>
            <p class="text-slate-400 text-sm">Secretária meio período</p>
            <p class="mt-1 text-slate-200">Custo fixo só para confirmar e remarcar consultas</p>
            <p class="mt-2 text-2xl font-bold text-rose-300">R$ 2.000+/mês</p>
          </div>
        </div>
        <div class="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p class="text-slate-300">
            ClinIQ Pro: <span class="text-white font-bold text-xl">R$ {{ PRICE }}/mês</span>
            <span class="text-slate-400 text-sm"> — menos de R$ 1,70 por dia. Recuperar uma única consulta já paga o mês.</span>
          </p>
          <router-link to="/cadastro" class="inline-flex items-center justify-center gap-2 bg-white text-slate-900 hover:bg-slate-100 font-semibold px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap">
            Testar grátis
            <ArrowRight class="w-4 h-4" />
          </router-link>
        </div>
        <p class="mt-4 text-xs text-slate-500">Valores ilustrativos. Use o preço da sua consulta para fazer a sua conta.</p>
      </div>
    </section>

    <!-- 3 COISAS QUE MUDAM -->
    <section id="como-funciona" class="bg-slate-50/70 border-y border-slate-100 scroll-mt-16">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div class="text-center max-w-2xl mx-auto">
          <p class="text-sm font-semibold text-primary-600 uppercase tracking-wider">O que muda na sua rotina</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Três coisas que acontecem quando você ativa a ClinIQ Pro</h2>
        </div>
        <div class="mt-12 grid md:grid-cols-3 gap-6">
          <div v-for="(h, i) in HIGHLIGHTS" :key="h.title" class="card flex flex-col">
            <div class="flex items-center justify-between">
              <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-sky-600 flex items-center justify-center shadow-md shadow-primary-600/25">
                <component :is="h.icon" class="w-6 h-6 text-white" />
              </div>
              <span class="text-4xl font-bold text-slate-100">{{ i + 1 }}</span>
            </div>
            <h3 class="mt-5 font-semibold text-lg">{{ h.title }}</h3>
            <p class="mt-2 text-sm text-slate-600 leading-relaxed flex-1">{{ h.desc }}</p>
            <p class="mt-4 text-sm font-medium text-primary-700">{{ h.note }}</p>
          </div>
        </div>

        <div class="mt-10 card">
          <p class="font-semibold text-slate-900">Automações no WhatsApp incluídas no plano</p>
          <div class="mt-4 flex flex-wrap gap-3">
            <span v-for="a in AUTOMATIONS" :key="a.label" class="inline-flex items-center gap-2 bg-primary-50 text-primary-800 rounded-full px-4 py-2 text-sm font-medium">
              <component :is="a.icon" class="w-4 h-4" />
              {{ a.label }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- PASSOS -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div class="text-center max-w-2xl mx-auto">
        <p class="text-sm font-semibold text-primary-600 uppercase tracking-wider">Comece hoje</p>
        <h2 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Da agenda caótica à clínica organizada em minutos</h2>
      </div>
      <div class="mt-12 grid md:grid-cols-3 gap-6">
        <div v-for="(s, i) in STEPS" :key="s.title" class="relative rounded-2xl border border-slate-200 p-6">
          <div class="flex items-center gap-3">
            <span class="w-9 h-9 rounded-full bg-primary-600 text-white font-bold flex items-center justify-center">{{ i + 1 }}</span>
            <span class="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{{ s.time }}</span>
          </div>
          <h3 class="mt-4 font-semibold text-lg flex items-center gap-2">
            <component :is="s.icon" class="w-5 h-5 text-primary-600" />
            {{ s.title }}
          </h3>
          <p class="mt-2 text-sm text-slate-600 leading-relaxed">{{ s.desc }}</p>
        </div>
      </div>
    </section>

    <!-- FUNCIONALIDADES -->
    <section id="funcionalidades" class="bg-slate-50/70 border-y border-slate-100 scroll-mt-16">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div class="text-center max-w-2xl mx-auto">
          <p class="text-sm font-semibold text-primary-600 uppercase tracking-wider">Funcionalidades</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Muito mais do que uma agenda online</h2>
          <p class="mt-4 text-slate-600 text-lg">Do primeiro contato do paciente ao fechamento do caixa, tudo em um só lugar.</p>
        </div>
        <div class="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div v-for="f in FEATURES" :key="f.title" class="card hover:shadow-md hover:-translate-y-0.5">
            <div class="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center mb-4">
              <component :is="f.icon" class="w-5 h-5 text-primary-600" />
            </div>
            <h3 class="font-semibold text-slate-900">{{ f.title }}</h3>
            <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- PARA VOCÊ / COMPARATIVO -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid lg:grid-cols-2 gap-10 items-start">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">A ClinIQ Pro é para você se…</h2>
        <ul class="mt-6 space-y-4">
          <li v-for="f in FOR_YOU" :key="f" class="flex gap-3 text-slate-700">
            <Check class="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            {{ f }}
          </li>
        </ul>
      </div>
      <div class="card p-0 overflow-hidden">
        <div class="grid grid-cols-[1fr_auto_auto] text-sm">
          <div class="px-5 py-3 font-semibold text-slate-500 bg-slate-50">Recurso</div>
          <div class="px-4 py-3 font-semibold text-slate-500 bg-slate-50 text-center">Agenda simples</div>
          <div class="px-4 py-3 font-semibold text-primary-700 bg-primary-50 text-center">ClinIQ Pro</div>
          <template v-for="r in VS_SIMPLE" :key="r.item">
            <div class="px-5 py-3 border-t border-slate-100 text-slate-700">{{ r.item }}</div>
            <div class="px-4 py-3 border-t border-slate-100 flex justify-center">
              <Check v-if="r.simple" class="w-5 h-5 text-slate-400" />
              <X v-else class="w-5 h-5 text-slate-300" />
            </div>
            <div class="px-4 py-3 border-t border-primary-100 bg-primary-50/50 flex justify-center">
              <Check v-if="r.us" class="w-5 h-5 text-emerald-500" />
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- PREÇO -->
    <section id="preco" class="bg-gradient-to-b from-primary-50/60 to-white border-t border-slate-100 scroll-mt-16">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div class="text-center max-w-2xl mx-auto">
          <p class="text-sm font-semibold text-primary-600 uppercase tracking-wider">Preço</p>
          <h2 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Um plano simples, com tudo incluído</h2>
          <p class="mt-4 text-slate-600 text-lg">Sem taxa de adesão, sem fidelidade, sem cobrança por paciente.</p>
        </div>
        <div class="mt-12 grid lg:grid-cols-[1fr_1.2fr] gap-8 items-center max-w-4xl mx-auto">
          <div class="space-y-4">
            <div class="rounded-2xl border border-slate-200 bg-white p-6">
              <p class="text-sm text-slate-500">Secretária meio período</p>
              <p class="mt-1 text-2xl font-bold text-slate-400 line-through">R$ 2.000+/mês</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-white p-6">
              <p class="text-sm text-slate-500">Agenda + lembretes + financeiro + prontuário em sistemas separados</p>
              <p class="mt-1 text-2xl font-bold text-slate-400 line-through">Vários boletos por mês</p>
            </div>
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <p class="text-sm text-emerald-700">ClinIQ Pro, tudo junto</p>
              <p class="mt-1 text-2xl font-bold text-emerald-700">R$ {{ PRICE }}/mês</p>
            </div>
          </div>

          <div class="bg-white rounded-3xl border-2 border-primary-500 shadow-xl shadow-primary-900/10 p-8 relative">
            <span class="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary-600 to-sky-500 text-white text-xs font-semibold px-4 py-1.5 rounded-full whitespace-nowrap">
              {{ TRIAL_DAYS }} dias grátis para testar
            </span>
            <p class="text-center font-semibold text-slate-700">ClinIQ Pro</p>
            <div class="mt-3 flex items-end justify-center gap-1">
              <span class="text-lg font-semibold text-slate-500 mb-2">R$</span>
              <span class="text-5xl font-bold tracking-tight">{{ PRICE }}</span>
              <span class="text-slate-500 mb-2">/mês</span>
            </div>
            <p class="text-center text-sm text-slate-500 mt-1">Menos de R$ 1,70 por dia</p>
            <ul class="mt-7 space-y-3">
              <li v-for="item in PLAN_ITEMS" :key="item" class="flex gap-3 text-slate-700 text-sm">
                <Check class="w-5 h-5 text-emerald-500 flex-shrink-0" />
                {{ item }}
              </li>
            </ul>
            <router-link to="/cadastro" class="btn-primary w-full justify-center mt-8 py-3 text-base">
              Começar meu teste grátis
              <ArrowRight class="w-4 h-4" />
            </router-link>
            <p class="mt-3 text-center text-xs text-slate-400">Sem cartão de crédito no teste. Cancele quando quiser.</p>
          </div>
        </div>
        <div class="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
          <span class="flex items-center gap-1.5"><ShieldCheck class="w-4 h-4 text-primary-500" /> Dados isolados por clínica</span>
          <span class="flex items-center gap-1.5"><LockKeyhole class="w-4 h-4 text-primary-500" /> Conexão criptografada</span>
          <span class="flex items-center gap-1.5"><Clock class="w-4 h-4 text-primary-500" /> Acesso 24h, de qualquer dispositivo</span>
        </div>
      </div>
    </section>

    <!-- DAQUI A 30 DIAS -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-20">
      <div class="text-center max-w-2xl mx-auto">
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">Daqui a 30 dias, você estará em uma de duas situações</h2>
      </div>
      <div class="mt-12 grid md:grid-cols-2 gap-6">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-7">
          <p class="font-semibold text-slate-500">Sem a ClinIQ Pro</p>
          <p class="mt-3 text-slate-600 leading-relaxed">
            O mesmo caos de sempre: horas no WhatsApp, pacientes que esquecem a consulta, horários vazios
            e o financeiro anotado em algum lugar. E a sensação de que deveria existir um jeito mais fácil.
          </p>
        </div>
        <div class="rounded-2xl border-2 border-primary-200 bg-primary-50/50 p-7">
          <p class="font-semibold text-primary-700">Com a ClinIQ Pro</p>
          <p class="mt-3 text-slate-700 leading-relaxed">
            Lembretes saindo sozinhos, pacientes agendando pelo WhatsApp a qualquer hora, prontuário organizado
            e o faturamento do mês na tela. Você atendendo — não administrando.
          </p>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section id="duvidas" class="max-w-3xl mx-auto px-4 sm:px-6 pb-20 scroll-mt-16">
      <div class="text-center">
        <p class="text-sm font-semibold text-primary-600 uppercase tracking-wider">Dúvidas frequentes</p>
        <h2 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Respostas diretas, sem rodeios</h2>
      </div>
      <div class="mt-10 divide-y divide-slate-200 border-y border-slate-200">
        <div v-for="(f, i) in FAQ" :key="f.q">
          <button class="w-full flex items-center justify-between gap-4 py-5 text-left" :aria-expanded="openFaq === i" @click="toggleFaq(i)">
            <span class="font-semibold text-slate-800">{{ f.q }}</span>
            <ChevronDown :class="['w-5 h-5 text-slate-400 flex-shrink-0 transition-transform', openFaq === i && 'rotate-180']" />
          </button>
          <p v-show="openFaq === i" class="pb-5 -mt-1 text-slate-600 leading-relaxed">{{ f.a }}</p>
        </div>
      </div>
    </section>

    <!-- CTA FINAL -->
    <section class="px-4 sm:px-6 pb-20">
      <div class="max-w-6xl mx-auto rounded-3xl px-6 py-14 sm:px-12 text-center text-white" style="background: linear-gradient(145deg, #0d2847 0%, #0a3a6e 40%, #0c4a8f 100%)">
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">Quanto custa continuar no manual?</h2>
        <p class="mt-4 text-primary-100 text-lg max-w-2xl mx-auto">
          Teste a ClinIQ Pro por {{ TRIAL_DAYS }} dias, sem cartão e sem compromisso.
          Se fizer diferença na sua rotina, são apenas R$ {{ PRICE }} por mês.
        </p>
        <router-link to="/cadastro" class="mt-8 inline-flex items-center gap-2 bg-white text-primary-700 hover:bg-primary-50 font-semibold px-7 py-3.5 rounded-xl transition-colors">
          Criar minha conta grátis
          <ArrowRight class="w-4 h-4" />
        </router-link>
        <div class="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-primary-100">
          <span class="flex items-center gap-1.5"><Check class="w-4 h-4" /> {{ TRIAL_DAYS }} dias grátis</span>
          <span class="flex items-center gap-1.5"><Check class="w-4 h-4" /> Sem cartão de crédito</span>
          <span class="flex items-center gap-1.5"><Check class="w-4 h-4" /> Cancele quando quiser</span>
        </div>
      </div>
    </section>

    <footer class="border-t border-slate-200">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
        <ClinicLogo dark size="sm" />
        <p>© {{ new Date().getFullYear() }} ClinIQ Pro · Gestão Clínica Inteligente</p>
        <router-link to="/login" class="hover:text-primary-600">Área do cliente</router-link>
      </div>
    </footer>
  </div>
</template>
