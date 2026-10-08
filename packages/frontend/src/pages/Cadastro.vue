<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { z } from 'zod'
import { Eye, EyeOff, Lock, Mail, User, Phone, Stethoscope, AlertCircle, ArrowRight, Check } from 'lucide-vue-next'
import api from '../lib/api'
import { greetingName } from '../lib/firstName'
import toast from '../lib/toast'
import { useAuthStore } from '../stores/auth'
import ClinicLogo from '../components/ui/ClinicLogo.vue'

// Mantenha em sincronia com packages/backend/src/lib/billing-config.ts
const PRICE = '49,90'
const TRIAL_DAYS = 3

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome completo'),
  email: z.string().trim().email('E-mail inválido'),
  phone: z.string().trim().min(10, 'Informe um WhatsApp com DDD'),
  specialty: z.string().trim().optional(),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})

type Field = keyof z.infer<typeof signupSchema>

const BENEFITS = [
  `${TRIAL_DAYS} dias de acesso completo, sem cartão de crédito`,
  'Lembretes e convites de retorno automáticos no WhatsApp',
  'Procedimentos, insumos e financeiro em um só lugar',
  `Depois, apenas R$ ${PRICE}/mês — cancele quando quiser`,
]

const authStore = useAuthStore()
const router = useRouter()

const form = reactive({ name: '', email: '', phone: '', specialty: '', password: '' })
const errors = reactive<Partial<Record<Field, string>>>({})
const formError = ref('')
const showPassword = ref(false)
const loading = ref(false)

const inputClass = (field: Field) => [
  'w-full py-3 pl-11 pr-4 bg-slate-50 border rounded-xl text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-200 focus:bg-white focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 focus:outline-none hover:border-slate-300',
  errors[field] ? 'border-red-300 bg-red-50/50' : 'border-slate-200',
]

async function onSubmit() {
  for (const key of Object.keys(errors) as Field[]) errors[key] = undefined
  formError.value = ''

  const parsed = signupSchema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as Field
      if (!errors[key]) errors[key] = issue.message
    }
    return
  }

  loading.value = true
  try {
    const { specialty, ...rest } = parsed.data
    const res = await api.post('/auth/register', { ...rest, ...(specialty ? { specialty } : {}) })
    const { token, refreshToken, user } = res.data
    authStore.setAuth(user, token, refreshToken)
    toast.success(`Bem-vindo(a), ${greetingName(user.name)}! Seu teste grátis de ${TRIAL_DAYS} dias começou.`, { duration: 5000 })
    router.push('/dashboard')
  } catch (error: any) {
    formError.value = error?.response?.data?.message || 'Não foi possível criar sua conta. Tente novamente.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col lg:flex-row bg-slate-50">
    <!-- LADO ESQUERDO -->
    <div class="hidden lg:flex lg:w-[46%] relative overflow-hidden flex-col text-white" style="background: linear-gradient(145deg, #2E1C20 0%, #4A2C32 35%, #6C3D44 65%, #4A2C32 100%)">
      <div class="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.12] pointer-events-none" style="background: radial-gradient(circle, #C9A96E, transparent 70%)" />
      <div class="relative z-10 flex flex-col h-full p-10 xl:p-14">
        <router-link to="/"><ClinicLogo /></router-link>
        <div class="my-auto">
          <h1 class="font-display text-3xl xl:text-4xl font-semibold tracking-tight leading-tight">
            Sua clínica de odontologia e estética organizada em minutos.
          </h1>
          <p class="mt-4 text-primary-100 text-lg">Crie sua conta e comece agora o seu teste grátis.</p>
          <ul class="mt-8 space-y-4">
            <li v-for="b in BENEFITS" :key="b" class="flex gap-3">
              <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
                <Check class="w-4 h-4 text-gold-300" />
              </span>
              <span class="text-primary-50">{{ b }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- FORMULÁRIO -->
    <div class="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10">
      <div class="w-full max-w-[440px]">
        <router-link to="/" class="lg:hidden flex justify-center mb-8"><ClinicLogo dark /></router-link>

        <div class="mb-7">
          <span class="inline-flex items-center bg-primary-50 text-primary-700 border border-primary-100 px-3 py-1 rounded-full text-xs font-semibold">
            {{ TRIAL_DAYS }} dias grátis · sem cartão
          </span>
          <h2 class="mt-4 font-display text-2xl sm:text-[1.8rem] font-semibold text-slate-900 tracking-tight">Crie sua conta grátis</h2>
          <p class="mt-1.5 text-slate-500 text-sm">Leva menos de 2 minutos.</p>
        </div>

        <form class="space-y-4" novalidate @submit.prevent="onSubmit">
          <div>
            <label for="signup-name" class="block text-sm font-medium text-slate-700 mb-1.5">Nome completo</label>
            <div class="relative group">
              <User class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500" />
              <input id="signup-name" v-model="form.name" type="text" autocomplete="name" placeholder="Dra. Ana Souza" :class="inputClass('name')" />
            </div>
            <p v-if="errors.name" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert"><AlertCircle class="w-3.5 h-3.5" />{{ errors.name }}</p>
          </div>

          <div>
            <label for="signup-email" class="block text-sm font-medium text-slate-700 mb-1.5">E-mail</label>
            <div class="relative group">
              <Mail class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500" />
              <input id="signup-email" v-model="form.email" type="email" autocomplete="email" placeholder="seu@email.com" :class="inputClass('email')" />
            </div>
            <p v-if="errors.email" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert"><AlertCircle class="w-3.5 h-3.5" />{{ errors.email }}</p>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label for="signup-phone" class="block text-sm font-medium text-slate-700 mb-1.5">WhatsApp</label>
              <div class="relative group">
                <Phone class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500" />
                <input id="signup-phone" v-model="form.phone" type="tel" autocomplete="tel" placeholder="(11) 99999-9999" :class="inputClass('phone')" />
              </div>
              <p v-if="errors.phone" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert"><AlertCircle class="w-3.5 h-3.5" />{{ errors.phone }}</p>
            </div>
            <div>
              <label for="signup-specialty" class="block text-sm font-medium text-slate-700 mb-1.5">Especialidade <span class="text-slate-400 font-normal">(opcional)</span></label>
              <div class="relative group">
                <Stethoscope class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500" />
                <input id="signup-specialty" v-model="form.specialty" type="text" placeholder="Ex.: Harmonização orofacial" :class="inputClass('specialty')" />
              </div>
            </div>
          </div>

          <div>
            <label for="signup-password" class="block text-sm font-medium text-slate-700 mb-1.5">Senha</label>
            <div class="relative group">
              <Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 group-focus-within:text-primary-500" />
              <input id="signup-password" v-model="form.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="Mínimo 6 caracteres" :class="[...inputClass('password'), 'pr-11']" />
              <button type="button" class="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" :aria-label="showPassword ? 'Ocultar senha' : 'Mostrar senha'" @click="showPassword = !showPassword">
                <EyeOff v-if="showPassword" class="w-[18px] h-[18px]" />
                <Eye v-else class="w-[18px] h-[18px]" />
              </button>
            </div>
            <p v-if="errors.password" class="flex items-center gap-1.5 mt-1.5 text-xs text-red-600" role="alert"><AlertCircle class="w-3.5 h-3.5" />{{ errors.password }}</p>
          </div>

          <p v-if="formError" class="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3" role="alert">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            {{ formError }}
          </p>

          <button
            type="submit" :disabled="loading"
            class="w-full py-3.5 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-lg shadow-primary-600/25 mt-2"
          >
            <template v-if="loading">
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Criando sua conta...
            </template>
            <template v-else>
              Começar meu teste grátis
              <ArrowRight class="w-4 h-4" />
            </template>
          </button>
          <p class="text-center text-xs text-slate-400">Sem cartão de crédito. Depois do teste, R$ {{ PRICE }}/mês.</p>
        </form>

        <p class="mt-8 text-center text-sm text-slate-500">
          Já tem conta?
          <router-link to="/login" class="font-semibold text-primary-600 hover:text-primary-700 hover:underline">Entrar</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
