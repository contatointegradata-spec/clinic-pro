<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import {
  User, Mail, Phone, Award, Shield, EyeOff, Eye, Save, CheckCircle2, LockKeyhole, Camera,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import type { AuthUser } from '../../types'
import PageHeader from '../../components/ui/PageHeader.vue'
import { useQuery } from '../../composables/useQuery'

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
  bio: z.string().optional(),
  specialty: z.string().optional(),
  crm: z.string().optional(),
  avatarUrl: z.string().optional().nullable(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  if (data.newPassword && data.newPassword.length > 0) {
    return data.newPassword.length >= 6
  }
  return true
}, {
  message: 'A nova senha deve ter no mínimo 6 caracteres',
  path: ['newPassword'],
}).refine((data) => {
  if (data.newPassword && data.newPassword.length > 0) {
    return data.newPassword === data.confirmPassword
  }
  return true
}, {
  message: 'A confirmação de senha deve ser idêntica à nova senha',
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

const roleLabels: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ADMIN: { label: 'Administrador', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  DOCTOR: { label: 'Médico', color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
  SECRETARY: { label: 'Secretária', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
}

const avatarGradients: Record<string, string> = {
  ADMIN: 'from-purple-500 to-purple-700',
  DOCTOR: 'from-primary-500 to-primary-700',
  SECRETARY: 'from-emerald-500 to-emerald-700',
}

const authStore = useAuthStore()

const showNewPass = ref(false)
const showConfirmPass = ref(false)
const previewAvatar = ref<string | null>(null)
const saved = ref(false)
const saving = ref(false)

const form = reactive<FormData>({
  name: '',
  email: '',
  phone: '',
  bio: '',
  specialty: '',
  crm: '',
  avatarUrl: null,
  newPassword: '',
  confirmPassword: '',
})
const errors = reactive<Partial<Record<keyof FormData, string>>>({})
const initialSnapshot = ref('')

const { data: profileData } = useQuery<AuthUser>({
  key: 'me',
  queryFn: () => api.get('/auth/me').then(r => r.data),
})

watch(profileData, (profile) => {
  if (profile) {
    form.name = profile.name
    form.email = profile.email
    form.phone = profile.phone || ''
    form.specialty = profile.specialty || ''
    form.crm = profile.crm || ''
    form.avatarUrl = profile.avatarUrl || null
    previewAvatar.value = profile.avatarUrl || null
    initialSnapshot.value = JSON.stringify(form)
  }
}, { immediate: true })

const isDirty = computed(() => initialSnapshot.value !== '' && JSON.stringify(form) !== initialSnapshot.value)

function handleAvatarUpload(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (file.size > 5 * 1024 * 1024) {
    toast.error('A imagem deve ter no máximo 5MB')
    return
  }

  const reader = new FileReader()
  reader.onload = (event) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 150
      canvas.width = size
      canvas.height = size

      const ctx = canvas.getContext('2d')
      if (ctx) {
        const minDim = Math.min(img.width, img.height)
        const sx = (img.width - minDim) / 2
        const sy = (img.height - minDim) / 2

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size)

        const base64 = canvas.toDataURL('image/jpeg', 0.85)
        form.avatarUrl = base64
        previewAvatar.value = base64
      }
    }
    img.src = event.target?.result as string
  }
  reader.readAsDataURL(file)
}

async function onSubmit() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    errors[key] = undefined
  }

  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: result.data.name,
      email: result.data.email,
      phone: result.data.phone,
      bio: result.data.bio,
      specialty: result.data.specialty,
      crm: result.data.crm,
      avatarUrl: result.data.avatarUrl,
    }
    if (result.data.newPassword) {
      payload.password = result.data.newPassword
    }
    const res = await api.put(`/users/${authStore.user?.id}`, payload)
    authStore.updateUser({
      name: res.data.name,
      phone: res.data.phone,
      avatarUrl: res.data.avatarUrl,
    })
    toast.success('Perfil atualizado com sucesso!')
    saved.value = true
    setTimeout(() => { saved.value = false }, 2500)
  } catch {
    toast.error('Erro ao atualizar perfil')
  } finally {
    saving.value = false
  }
}

const roleInfo = computed(() => (authStore.user?.role ? roleLabels[authStore.user.role] : null))
const gradient = computed(() => (authStore.user?.role ? avatarGradients[authStore.user.role] : 'from-primary-500 to-primary-700'))
const initials = computed(() => authStore.user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase())

const displayRole = computed(() => (
  authStore.user?.role === 'DOCTOR' && form.specialty
    ? form.specialty
    : roleInfo.value?.label
))
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <PageHeader
      title="Meu Perfil"
      subtitle="Gerencie suas informações pessoais e profissionais"
    />

    <!-- Avatar card -->
    <div class="card overflow-hidden relative">
      <div class="absolute inset-0 bg-gradient-to-br from-slate-50 to-white pointer-events-none" />
      <div class="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <!-- Avatar -->
        <div class="relative flex-shrink-0 self-start sm:self-auto">
          <div class="relative w-20 h-20 rounded-2xl overflow-hidden shadow-xl shadow-primary-600/20 transition-transform duration-300 hover:scale-105 group/avatar">
            <img v-if="previewAvatar" :src="previewAvatar" :alt="authStore.user?.name" class="w-full h-full object-cover" />
            <div v-else :class="['w-full h-full bg-gradient-to-br flex items-center justify-center', gradient]">
              <span class="text-white text-2xl font-bold tracking-tight">{{ initials }}</span>
            </div>
            <!-- Overlay edit button -->
            <label for="avatar-upload" class="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200 cursor-pointer">
              <Camera class="w-5 h-5 text-white" />
            </label>
            <input
              id="avatar-upload"
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleAvatarUpload"
            />
          </div>
          <div v-if="roleInfo" :class="['absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-lg border flex items-center justify-center shadow-sm z-10', roleInfo.bg, roleInfo.border]">
            <Shield :class="['w-3.5 h-3.5', roleInfo.color]" />
          </div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="text-xl font-bold text-slate-900 leading-tight">{{ authStore.user?.name }}</h2>
              <p class="text-slate-500 text-sm mt-0.5">{{ authStore.user?.email }}</p>
            </div>
            <span
              v-if="isDirty && !saved"
              class="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full font-medium animate-fade-in"
            >
              Alterações pendentes
            </span>
            <span
              v-if="saved"
              class="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-medium flex items-center gap-1 animate-fade-in"
            >
              <CheckCircle2 class="w-3 h-3" />
              Salvo
            </span>
          </div>
          <span
            v-if="roleInfo && displayRole"
            :class="['inline-flex items-center gap-1.5 mt-3 text-xs font-semibold px-3 py-1 rounded-full border', roleInfo.bg, roleInfo.border, roleInfo.color]"
          >
            <Shield class="w-3 h-3" />
            {{ displayRole }}
          </span>
        </div>
      </div>
    </div>

    <!-- Form -->
    <form class="space-y-5" @submit.prevent="onSubmit">
      <!-- Personal info -->
      <div class="card space-y-4">
        <h3 class="font-semibold text-slate-900 flex items-center gap-2.5 pb-1">
          <div class="w-8 h-8 bg-primary-50 rounded-xl flex items-center justify-center border border-primary-100">
            <User class="w-4 h-4 text-primary-600" />
          </div>
          Informações Pessoais
        </h3>

        <div>
          <label class="label">Nome completo *</label>
          <input v-model="form.name" class="input-field" placeholder="Seu nome completo" />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label flex items-center gap-1.5">
              <Mail class="w-3.5 h-3.5 text-slate-400" /> Email
            </label>
            <input v-model="form.email" type="email" class="input-field" />
            <p v-if="errors.email" class="text-xs text-red-500 mt-1">{{ errors.email }}</p>
          </div>
          <div>
            <label class="label flex items-center gap-1.5">
              <Phone class="w-3.5 h-3.5 text-slate-400" /> Telefone
            </label>
            <input v-model="form.phone" class="input-field" placeholder="(11) 99999-0000" />
          </div>
        </div>

        <div v-if="authStore.user?.role === 'DOCTOR'" class="space-y-4 pt-3 border-t border-slate-100">
          <h4 class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <div class="w-6 h-6 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
              <Award class="w-3.5 h-3.5 text-primary-600" />
            </div>
            Dados Profissionais
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="label">Especialidade</label>
              <input v-model="form.specialty" class="input-field" placeholder="Ex: Cardiologia" />
            </div>
            <div>
              <label class="label">Registro Profissional</label>
              <input v-model="form.crm" class="input-field" placeholder="Ex: CRM/SP 12345" />
            </div>
          </div>
        </div>
      </div>

      <!-- Password section -->
      <div class="card space-y-4">
        <h3 class="font-semibold text-slate-900 flex items-center gap-2.5 pb-1">
          <div class="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center border border-slate-200">
            <LockKeyhole class="w-4 h-4 text-slate-500" />
          </div>
          Alterar Senha
        </h3>
        <p class="text-sm text-slate-400">Deixe em branco para manter a senha atual</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Nova Senha</label>
            <div class="relative">
              <input
                v-model="form.newPassword"
                :type="showNewPass ? 'text' : 'password'"
                class="input-field pr-10"
                placeholder="Mínimo 6 caracteres"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                @click="showNewPass = !showNewPass"
              >
                <EyeOff v-if="showNewPass" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
            </div>
            <p v-if="errors.newPassword" class="text-xs text-red-500 mt-1">{{ errors.newPassword }}</p>
          </div>

          <div>
            <label class="label">Confirmar Senha</label>
            <div class="relative">
              <input
                v-model="form.confirmPassword"
                :type="showConfirmPass ? 'text' : 'password'"
                class="input-field pr-10"
                placeholder="Repita a nova senha"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                @click="showConfirmPass = !showConfirmPass"
              >
                <EyeOff v-if="showConfirmPass" class="w-4 h-4" />
                <Eye v-else class="w-4 h-4" />
              </button>
            </div>
            <p v-if="errors.confirmPassword" class="text-xs text-red-500 mt-1">{{ errors.confirmPassword }}</p>
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div>
        <button
          type="submit"
          :disabled="saving"
          class="btn-primary w-full sm:w-auto"
        >
          <template v-if="saving">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </template>
          <template v-else-if="saved">
            <CheckCircle2 class="w-4 h-4" />
            Salvo!
          </template>
          <template v-else>
            <Save class="w-4 h-4" />
            Salvar Alterações
          </template>
        </button>
      </div>
    </form>
  </div>
</template>
