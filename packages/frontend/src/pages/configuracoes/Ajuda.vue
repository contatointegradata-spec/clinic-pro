<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { HelpCircle, MessageCircle, Mail, Phone, ChevronDown, ArrowRight, Search } from 'lucide-vue-next'

const faqs = [
  { q: 'Como cadastrar um novo paciente?', a: 'Acesse "Pacientes" no menu lateral, clique em "Novo Paciente" e preencha os dados. Você pode vincular planos de saúde diretamente no cadastro.' },
  { q: 'Como agendar uma consulta?', a: 'Na tela de Agenda, clique em qualquer slot horário disponível ou no botão "Novo Agendamento". Selecione o paciente, médico, data e horário.' },
  { q: 'A secretária pode ver o financeiro?', a: 'Não. O módulo Financeiro é restrito a médicos e administradores. Secretárias têm acesso apenas à agenda e cadastro de pacientes.' },
  { q: 'Como cadastrar planos de convênio?', a: 'Acesse "Configurações > Planos de Saúde". Crie os planos com o tipo "Convênio". No cadastro do paciente, vincule o plano e informe o número da carteirinha.' },
  { q: 'Como criar um prontuário?', a: 'Acesse "Prontuário" no menu lateral, selecione um paciente, escolha o médico e clique em "Novo Registro". Preencha o tipo (Anamnese, Evolução, etc.) e o conteúdo.' },
  { q: 'Como alterar minha senha?', a: 'Acesse "Configurações > Meu Perfil" e preencha o campo "Nova Senha". Clique em "Salvar Alterações".' },
  { q: 'Posso ter mais de um médico cadastrado?', a: 'Sim. Um administrador pode cadastrar quantos médicos forem necessários em "Configurações > Usuários". Cada médico verá apenas sua própria agenda e financeiro.' },
]

const supportChannels = [
  { icon: MessageCircle, label: 'Chat ao vivo', desc: 'Suporte em tempo real', bg: 'bg-cyan-500/20 text-cyan-300', cta: 'Iniciar chat' },
  { icon: Mail, label: 'Email', desc: 'suporte@agendaclinica.com.br', bg: 'bg-emerald-500/20 text-emerald-300', cta: 'Enviar email' },
  { icon: Phone, label: 'Telefone', desc: '(11) 4004-0000 · Seg-Sex 8h-18h', bg: 'bg-violet-500/20 text-violet-300', cta: 'Ligar agora' },
]

const search = ref('')
const openMap = reactive<Record<string, boolean>>({})

function toggleOpen(q: string) {
  openMap[q] = !openMap[q]
}

const filtered = computed(() => faqs.filter(
  f => f.q.toLowerCase().includes(search.value.toLowerCase())
    || f.a.toLowerCase().includes(search.value.toLowerCase())
))
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 page-stagger">
    <div>
      <h1 class="page-title">Ajuda &amp; Suporte</h1>
      <p class="page-subtitle">Encontre respostas para suas dúvidas</p>
    </div>

    <!-- Search -->
    <div class="relative">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        v-model="search"
        placeholder="Buscar nas perguntas frequentes..."
        class="input-field pl-10"
      />
    </div>

    <!-- FAQ -->
    <div class="card space-y-2.5">
      <h2 class="font-semibold text-slate-900 flex items-center gap-2 mb-4">
        <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center">
          <HelpCircle class="w-4 h-4 text-primary-600" />
        </div>
        Perguntas Frequentes
        <span class="ml-auto text-xs text-slate-400 font-normal">{{ filtered.length }} resultado{{ filtered.length !== 1 ? 's' : '' }}</span>
      </h2>

      <div v-if="filtered.length === 0" class="text-center py-8 text-slate-400 text-sm">
        Nenhuma pergunta encontrada para "{{ search }}"
      </div>

      <div
        v-for="(item, i) in filtered" :key="item.q"
        :class="['rounded-xl border overflow-hidden transition-all duration-200', openMap[item.q] ? 'border-primary-200 shadow-sm' : 'border-slate-200 hover:border-slate-300']"
        :style="{ animationDelay: `${i * 0.04}s` }"
      >
        <button
          class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50/80 transition-colors"
          @click="toggleOpen(item.q)"
        >
          <span class="font-medium text-slate-900 text-sm pr-4">{{ item.q }}</span>
          <div :class="['w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0 transition-all duration-200', openMap[item.q] ? 'bg-primary-100 rotate-180' : 'hover:bg-slate-100']">
            <ChevronDown :class="['w-4 h-4', openMap[item.q] ? 'text-primary-600' : 'text-slate-400']" />
          </div>
        </button>
        <div v-if="openMap[item.q]" class="px-5 pb-4 bg-slate-50/60 border-t border-slate-100">
          <p class="text-sm text-slate-600 leading-relaxed pt-3">{{ item.a }}</p>
        </div>
      </div>
    </div>

    <!-- Support -->
    <div class="card bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
      <h2 class="font-semibold text-white mb-4">Ainda precisa de ajuda?</h2>
      <div class="space-y-3">
        <div
          v-for="c in supportChannels" :key="c.label"
          class="flex items-center gap-3 p-3.5 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 cursor-pointer transition-all duration-150 group"
        >
          <div :class="['w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', c.bg]">
            <component :is="c.icon" class="w-4 h-4" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-white text-sm">{{ c.label }}</p>
            <p class="text-xs text-slate-400">{{ c.desc }}</p>
          </div>
          <span class="text-xs text-slate-400 group-hover:text-white flex items-center gap-1 transition-colors">
            {{ c.cta }}
            <ArrowRight class="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
