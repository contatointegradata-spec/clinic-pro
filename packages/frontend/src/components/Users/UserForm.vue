<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-vue-next'
import type { User, Role } from '../../types'

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres').optional().or(z.literal('')),
  confirmPassword: z.string().optional().or(z.literal('')),
  role: z.enum(['ADMIN', 'DOCTOR', 'SECRETARY']),
  specialty: z.string().optional(),
  crm: z.string().optional(),
  phone: z.string().optional(),
}).refine(
  data => !data.password || data.password === data.confirmPassword,
  { message: 'As senhas não conferem', path: ['confirmPassword'] }
)

type FormData = z.infer<typeof schema>

const props = defineProps<{
  user: User | null
  loading: boolean
}>()

const emit = defineEmits<{
  submit: [data: Omit<FormData, 'confirmPassword'>]
}>()

const rolePermissions: Record<string, string[]> = {
  ADMIN: ['Agenda', 'Pacientes', 'Financeiro', 'Usuários'],
  DOCTOR: ['Agenda', 'Pacientes', 'Financeiro (próprio)'],
  SECRETARY: ['Agenda', 'Pacientes'],
}

const showPass = ref(false)

const form = reactive<FormData>({
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'SECRETARY',
  specialty: '',
  crm: '',
  phone: '',
})

const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(
  () => props.user,
  (user) => {
    if (user) {
      form.name = user.name
      form.email = user.email
      form.role = user.role
      form.specialty = user.specialty || ''
      form.crm = user.crm || ''
      form.phone = user.phone || ''
      form.password = ''
      form.confirmPassword = ''
    }
  },
  { immediate: true }
)

const showConfirm = computed(() => !!form.password || !props.user)

function handleSubmit() {
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

  const { confirmPassword, ...payload } = result.data
  if (!payload.password) delete (payload as Partial<typeof payload>).password
  emit('submit', payload)
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <div>
      <label class="label">Nome completo *</label>
      <input v-model="form.name" class="input-field" placeholder="Nome do usuário" />
      <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
    </div>

    <div>
      <label class="label">Email *</label>
      <input v-model="form.email" type="email" class="input-field" placeholder="email@exemplo.com" />
      <p v-if="errors.email" class="text-xs text-red-500 mt-1">{{ errors.email }}</p>
    </div>

    <!-- Password + Confirm Password -->
    <div class="space-y-3">
      <div>
        <label class="label">
          {{ user ? 'Nova Senha (deixe em branco para manter)' : 'Senha *' }}
        </label>
        <div class="relative">
          <input
            v-model="form.password"
            :type="showPass ? 'text' : 'password'"
            class="input-field pr-10"
            placeholder="••••••••"
          />
          <button
            type="button"
            tabindex="-1"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            @click="showPass = !showPass"
          >
            <EyeOff v-if="showPass" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <p v-if="errors.password" class="text-xs text-red-500 mt-1">{{ errors.password }}</p>
      </div>

      <!-- Confirm password — só aparece quando senha foi digitada -->
      <div v-if="showConfirm">
        <label class="label">Confirmar Senha *</label>
        <div class="relative">
          <input
            v-model="form.confirmPassword"
            :type="showPass ? 'text' : 'password'"
            class="input-field pr-10"
            placeholder="••••••••"
          />
          <button
            type="button"
            tabindex="-1"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            @click="showPass = !showPass"
          >
            <EyeOff v-if="showPass" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <p v-if="errors.confirmPassword" class="text-xs text-red-500 mt-1">{{ errors.confirmPassword }}</p>
      </div>

      <!-- Checkbox exibir senha -->
      <label class="flex items-center gap-2 cursor-pointer select-none w-fit">
        <input
          v-model="showPass"
          type="checkbox"
          class="w-4 h-4 rounded border-slate-300 text-primary-600 accent-primary-600"
        />
        <span class="text-sm text-slate-600">Exibir senha</span>
      </label>
    </div>

    <div>
      <label class="label">Perfil de Acesso *</label>
      <select v-model="form.role" class="input-field">
        <option value="SECRETARY">Secretária</option>
        <option value="DOCTOR">Especialista (dentista, esteta…)</option>
        <option value="ADMIN">Administrador</option>
      </select>
      <div v-if="form.role" class="mt-2 p-3 bg-slate-50 rounded-lg">
        <p class="text-xs font-medium text-slate-600 mb-1.5">Acessos permitidos:</p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="p in rolePermissions[form.role as Role]"
            :key="p"
            class="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full"
          >
            {{ p }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="form.role === 'DOCTOR'" class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Especialidade</label>
        <input v-model="form.specialty" class="input-field" placeholder="Ex: Cardiologia" />
      </div>
      <div>
        <label class="label">Registro Profissional</label>
        <input v-model="form.crm" class="input-field" placeholder="Ex: CRM/SP 12345, CRP 67890" />
      </div>
    </div>

    <div>
      <label class="label">Telefone</label>
      <input v-model="form.phone" class="input-field" placeholder="(11) 99999-0000" />
    </div>

    <button type="submit" :disabled="loading" class="btn-primary w-full mt-2">
      <span v-if="loading" class="flex items-center gap-2 justify-center">
        <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        Salvando...
      </span>
      <template v-else>{{ user ? 'Atualizar Usuário' : 'Criar Usuário' }}</template>
    </button>
  </form>
</template>
