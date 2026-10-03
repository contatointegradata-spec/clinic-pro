<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { z } from 'zod'
import {
  Eye, EyeOff, Lock, Mail, AlertCircle, LogIn,
  Send, MessageSquare, CalendarCheck,
  DollarSign, BarChart3, FileText, MapPin,
  Shield, Sparkles,
} from 'lucide-vue-next'
import api from '../lib/api'
import toast from '../lib/toast'
import { useAuthStore } from '../stores/auth'
import ClinicLogo from '../components/ui/ClinicLogo.vue'
import Modal from '../components/ui/Modal.vue'

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

function getGreeting(name: string) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  return `${greeting}, ${name.split(' ')[0]}!`
}

const FLOATING_CARDS = [
  { icon: BarChart3, title: 'Dashboard', subtitle: 'Visão geral em tempo real', accentBg: 'bg-violet-500/15', accentText: 'text-violet-300' },
  { icon: CalendarCheck, title: 'Agenda', subtitle: 'Consultas organizadas', accentBg: 'bg-sky-500/15', accentText: 'text-sky-300' },
  { icon: FileText, title: 'Prontuário', subtitle: 'Histórico completo do paciente', accentBg: 'bg-emerald-500/15', accentText: 'text-emerald-300' },
  { icon: DollarSign, title: 'Financeiro', subtitle: 'Controle de pagamentos', accentBg: 'bg-teal-500/15', accentText: 'text-teal-300' },
  { icon: MessageSquare, title: 'WhatsApp', subtitle: 'Atendimento integrado', accentBg: 'bg-green-500/15', accentText: 'text-green-300' },
  { icon: MapPin, title: 'Gestão de Salas', subtitle: 'Múltiplos consultórios', accentBg: 'bg-amber-500/15', accentText: 'text-amber-300' },
]

const authStore = useAuthStore()
const router = useRouter()

const showPassword = ref(false)
const loading = ref(false)
const loginPhase = ref<'idle' | 'loading' | 'preparing'>('idle')
const showForgotModal = ref(false)
const forgotEmail = ref('')
const forgotLoading = ref(false)
const forgotSuccess = ref(false)
const mounted = ref(false)

const form = reactive({ email: '', password: '' })
const errors = reactive<{ email?: string; password?: string }>({})

onMounted(() => {
  setTimeout(() => { mounted.value = true }, 50)
})

async function onLogin() {
  errors.email = undefined
  errors.password = undefined
  const parsed = loginSchema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as 'email' | 'password'
      errors[key] = issue.message
    }
    return
  }

  loading.value = true
  loginPhase.value = 'loading'
  try {
    await new Promise(r => setTimeout(r, 800))
    loginPhase.value = 'preparing'

    const res = await api.post('/auth/login', form)
    const { token, refreshToken, user } = res.data
    authStore.setAuth(user, token, refreshToken)

    await new Promise(r => setTimeout(r, 1200))

    toast.success(getGreeting(user.name), { duration: 4000 })
    router.push('/dashboard')
  } catch (error: any) {
    loginPhase.value = 'idle'
    errors.email = error?.response?.data?.message || 'Erro ao fazer login'
  } finally {
    loading.value = false
  }
}

async function onForgotPassword() {
  if (!forgotEmail.value) return
  forgotLoading.value = true
  try {
    await api.post('/auth/forgot-password', { email: forgotEmail.value })
    forgotSuccess.value = true
  } catch {
    forgotSuccess.value = true
  } finally {
    forgotLoading.value = false
  }
}

function closeForgotModal() {
  showForgotModal.value = false
  forgotEmail.value = ''
  forgotSuccess.value = false
  forgotLoading.value = false
}
</script>

<template>
  <div class="min-h-screen flex flex-col lg:flex-row bg-slate-50">
    <!-- LEFT COLUMN -->
    <div class="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col" style="background: linear-gradient(145deg, #0d2847 0%, #0a3a6e 35%, #0c4a8f 65%, #0a3a6e 100%)">
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div class="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.12]" style="background: radial-gradient(circle, #38bdf8, transparent 70%)" />
        <div class="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full opacity-[0.08]" style="background: radial-gradient(circle, #60a5fa, transparent 70%)" />
        <div class="absolute inset-0 opacity-[0.04]" style="background-image: linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px); background-size: 60px 60px" />
        <div class="absolute top-24 right-24 w-2 h-2 bg-sky-300/50 rounded-full animate-pulse-soft" />
        <div class="absolute bottom-32 left-1/4 w-1.5 h-1.5 bg-blue-300/40 rounded-full animate-float" />
      </div>

      <div class="relative z-10 flex flex-col justify-between h-full p-10 xl:p-14">
        <div>
          <div class="flex items-center gap-3.5 mb-14 transition-all duration-700" :class="mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'">
            <ClinicLogo icon-only size="lg" dark />
            <div>
              <h1 class="text-white font-bold text-2xl tracking-tight">ClinIQ <span class="text-sky-300 font-light">Pro</span></h1>
              <p class="text-blue-200/70 text-xs tracking-wide">Gestão Clínica Inteligente</p>
            </div>
          </div>

          <div class="max-w-lg mb-10 transition-all duration-700 delay-150" :class="mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'">
            <h2 class="text-white text-3xl xl:text-[2.5rem] font-bold leading-[1.15] mb-5">
              Sua clínica organizada
              <span class="bg-gradient-to-r from-sky-300 via-blue-200 to-emerald-300 bg-clip-text text-transparent">do WhatsApp ao financeiro</span>
            </h2>
            <p class="text-blue-100/70 text-base leading-relaxed max-w-md">
              Centralize agenda, atendimento, pacientes, equipe, pré-agendamentos,
              financeiro e relatórios em uma única plataforma inteligente.
            </p>
          </div>
        </div>

        <div class="flex-1 flex items-center">
          <div class="grid grid-cols-2 gap-3 w-full max-w-lg">
            <div
              v-for="(card, i) in FLOATING_CARDS" :key="card.title"
              class="group relative bg-white/[0.06] backdrop-blur-sm border border-white/[0.1] rounded-xl p-3.5 hover:bg-white/[0.1] hover:border-white/[0.18] transition-all duration-500"
              :class="mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'"
              :style="{ transitionDelay: `${300 + i * 120}ms` }"
            >
              <div class="flex items-start gap-3">
                <div :class="['w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300', card.accentBg]">
                  <component :is="card.icon" :class="['w-4.5 h-4.5', card.accentText]" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-white/90 text-[13px] font-medium truncate">{{ card.title }}</p>
                  <p class="text-blue-200/60 text-[11px]">{{ card.subtitle }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="transition-all duration-700" :class="mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'" style="transition-delay: 1000ms">
          <div class="flex items-center gap-2 mb-4">
            <Shield class="w-4 h-4 text-emerald-300/80" />
            <p class="text-blue-200/60 text-xs">Dados protegidos com criptografia de ponta a ponta</p>
          </div>
          <div class="border-t border-white/[0.08] pt-4">
            <p class="text-blue-300/40 text-xs">© {{ new Date().getFullYear() }} ClinIQ Pro · Todos os direitos reservados</p>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT COLUMN -->
    <div class="flex-1 flex flex-col items-center justify-center p-5 sm:p-8 lg:p-12 bg-white relative min-h-screen lg:min-h-0">
      <div class="w-full max-w-[420px] relative z-10 transition-all duration-700 delay-100" :class="mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'">
        <div class="flex items-center gap-3 mb-10 lg:hidden">
          <ClinicLogo icon-only size="lg" dark />
          <div>
            <h1 class="text-slate-900 font-bold text-xl tracking-tight">ClinIQ <span class="text-primary-600 font-light">Pro</span></h1>
            <p class="text-slate-400 text-xs tracking-wide">Gestão Clínica Inteligente</p>
          </div>
        </div>

        <div class="mb-8">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-8 h-8 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center">
              <Sparkles class="w-4 h-4 text-primary-600" />
            </div>
          </div>
          <h2 class="text-2xl sm:text-[1.7rem] font-bold text-slate-900 mb-1.5 tracking-tight">Bem-vindo(a) à ClinIQ Pro</h2>
          <p class="text-slate-500 text-sm">Acesse sua clínica e continue de onde parou.</p>
        </div>

        <form class="space-y-4" @submit.prevent="onLogin">
          <div>
            <label for="login-email" class="block text-sm font-medium text-slate-700 mb-1.5">E-mail</label>
            <div class="relative group">
              <Mail class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500 transition-colors duration-200" />
              <input
                v-model="form.email"
                type="email" id="login-email" placeholder="seu@email.com" autocomplete="email"
                :class="['w-full py-3 pl-11 pr-4 bg-slate-50 border rounded-xl text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-200 focus:bg-white focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 focus:outline-none hover:border-slate-300',
                  errors.email ? 'border-red-300 bg-red-50/50' : 'border-slate-200']"
              />
            </div>
            <p v-if="errors.email" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              {{ errors.email }}
            </p>
          </div>

          <div>
            <label for="login-password" class="block text-sm font-medium text-slate-700 mb-1.5">Senha</label>
            <div class="relative group">
              <Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500 transition-colors duration-200" />
              <input
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'" id="login-password" placeholder="••••••••" autocomplete="current-password"
                :class="['w-full py-3 pl-11 pr-11 bg-slate-50 border rounded-xl text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-200 focus:bg-white focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 focus:outline-none hover:border-slate-300',
                  errors.password ? 'border-red-300 bg-red-50/50' : 'border-slate-200']"
              />
              <button type="button" class="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors duration-200" @click="showPassword = !showPassword">
                <EyeOff v-if="showPassword" class="w-[18px] h-[18px]" />
                <Eye v-else class="w-[18px] h-[18px]" />
              </button>
            </div>
            <p v-if="errors.password" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert">
              <AlertCircle class="w-3.5 h-3.5 flex-shrink-0" />
              {{ errors.password }}
            </p>
            <div class="flex justify-end mt-2">
              <button type="button" class="text-xs text-primary-600 hover:text-primary-700 font-medium hover:underline transition-colors duration-200" @click="showForgotModal = true">
                Esqueci minha senha
              </button>
            </div>
          </div>

          <button
            type="submit" :disabled="loading"
            class="relative w-full py-3.5 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-lg shadow-primary-600/25 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 mt-3"
          >
            <template v-if="loginPhase === 'preparing'">
              <div class="w-4.5 h-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span class="animate-pulse">Preparando sua clínica...</span>
            </template>
            <template v-else-if="loginPhase === 'loading'">
              <div class="w-4.5 h-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Entrando...</span>
            </template>
            <template v-else>
              <LogIn class="w-4.5 h-4.5" />
              <span>Entrar na plataforma</span>
            </template>
          </button>
        </form>
      </div>

      <div class="mt-auto pt-8 w-full max-w-[420px] transition-all duration-700 delay-500" :class="mounted ? 'opacity-100' : 'opacity-0'">
        <div class="flex items-center justify-center gap-4 text-xs text-slate-400">
          <span>Termos de Uso</span>
          <span class="w-1 h-1 rounded-full bg-slate-300" />
          <span>Privacidade</span>
          <span class="w-1 h-1 rounded-full bg-slate-300" />
          <span>Suporte</span>
        </div>
      </div>
    </div>

    <!-- FORGOT PASSWORD MODAL -->
    <Modal :is-open="showForgotModal" title="Redefinir senha" subtitle="Recuperação de acesso" @close="closeForgotModal">
      <div v-if="forgotSuccess" class="flex flex-col items-center text-center py-4 gap-4">
        <div class="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center">
          <Mail class="w-7 h-7 text-emerald-500" />
        </div>
        <div>
          <p class="text-slate-900 font-semibold text-base mb-1">E-mail enviado!</p>
          <p class="text-slate-500 text-sm leading-relaxed">Verifique sua caixa de entrada e siga as instruções para redefinir sua senha.</p>
        </div>
        <button class="mt-2 w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-all duration-200 text-sm" @click="closeForgotModal">
          Fechar
        </button>
      </div>
      <form v-else class="space-y-5" @submit.prevent="onForgotPassword">
        <p class="text-slate-500 text-sm leading-relaxed">Digite seu e-mail e enviaremos as instruções para redefinir sua senha.</p>
        <div>
          <label for="forgot-email" class="block text-sm font-medium text-slate-700 mb-1.5">E-mail</label>
          <div class="relative">
            <Mail class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              v-model="forgotEmail" type="email" id="forgot-email" placeholder="seu@email.com" autocomplete="email" required
              class="w-full py-3 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 focus:outline-none"
            />
          </div>
        </div>
        <div class="flex gap-3 pt-1">
          <button type="button" class="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold rounded-lg transition-all duration-200 text-sm" @click="closeForgotModal">
            Cancelar
          </button>
          <button type="submit" :disabled="forgotLoading || !forgotEmail" class="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
            <template v-if="forgotLoading">
              <div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Enviando...
            </template>
            <template v-else>
              <Send class="w-3.5 h-3.5" />
              Enviar instruções
            </template>
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>
