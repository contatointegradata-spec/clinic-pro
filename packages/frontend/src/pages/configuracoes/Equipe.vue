<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { z } from 'zod'
import {
  Users, UserPlus, Link2, Trash2, Mail, Phone, ShieldCheck, ShieldOff,
  X, Plus, UserCircle2, Settings2,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { DoctorSecretary } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import {
  SECRETARY_PERMISSION_KEYS, SECRETARY_PERMISSION_LABELS, PERMISSION_KEY_TO_INTEGRATION_TYPE,
  type SecretaryPermissionKey, type SecretaryPermissions,
} from '../../composables/useSecretaryPermissions'
import { useQuery } from '../../composables/useQuery'

const createSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  phone: z.string().optional(),
})
const linkSchema = z.object({
  email: z.string().email('Email inválido'),
})

type CreateForm = z.infer<typeof createSchema>
type LinkForm = z.infer<typeof linkSchema>

const AVATAR_COLORS = [
  'from-primary-500 to-primary-700',
  'from-violet-500 to-violet-700',
  'from-cyan-500 to-cyan-700',
  'from-emerald-500 to-emerald-700',
  'from-rose-500 to-rose-700',
]

// ─── State ────────────────────────────────────────────────────────────────────

const mode = ref<'list' | 'create' | 'link'>('list')
const accessLink = ref<DoctorSecretary | null>(null)

// ─── Queries ──────────────────────────────────────────────────────────────────

const { data: activeAddonTypesData } = useQuery<{ type: string; status: string }[]>({
  key: 'integration-addons',
  queryFn: () => api.get('/integration-addons').then(r => r.data),
})
const activeTypeSet = computed(() => new Set(
  (activeAddonTypesData.value ?? []).filter(a => a.status === 'ACTIVE').map(a => a.type)
))
const visiblePermissionKeys = computed(() => SECRETARY_PERMISSION_KEYS.filter(key => {
  const integrationType = PERMISSION_KEY_TO_INTEGRATION_TYPE[key]
  return !integrationType || activeTypeSet.value.has(integrationType)
}))

const { data: teamData, refetch: refetchTeam } = useQuery<DoctorSecretary[]>({
  key: 'team',
  queryFn: () => api.get('/team').then(r => r.data),
})
const team = computed(() => teamData.value ?? [])
const activeCount = computed(() => team.value.filter(t => t.active).length)

// ─── Create form ──────────────────────────────────────────────────────────────

const createForm = reactive<CreateForm>({ name: '', email: '', password: '', phone: '' })
const createErrors = reactive<Partial<Record<keyof CreateForm, string>>>({})
const creating = ref(false)

function resetCreateForm() {
  createForm.name = ''
  createForm.email = ''
  createForm.password = ''
  createForm.phone = ''
  createErrors.name = undefined
  createErrors.email = undefined
  createErrors.password = undefined
  createErrors.phone = undefined
}

async function handleCreateSubmit() {
  createErrors.name = undefined
  createErrors.email = undefined
  createErrors.password = undefined
  createErrors.phone = undefined

  const result = createSchema.safeParse(createForm)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof CreateForm
      createErrors[key] = issue.message
    }
    return
  }

  creating.value = true
  try {
    await api.post('/team/secretary', result.data)
    toast.success('Secretaria criada e vinculada com sucesso!')
    resetCreateForm()
    mode.value = 'list'
    await refetchTeam()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao criar secretaria')
  } finally {
    creating.value = false
  }
}

// ─── Link form ────────────────────────────────────────────────────────────────

const linkForm = reactive<LinkForm>({ email: '' })
const linkErrors = reactive<Partial<Record<keyof LinkForm, string>>>({})
const linking = ref(false)

async function handleLinkSubmit() {
  linkErrors.email = undefined

  const result = linkSchema.safeParse(linkForm)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof LinkForm
      linkErrors[key] = issue.message
    }
    return
  }

  linking.value = true
  try {
    await api.post('/team/link', result.data)
    toast.success('Secretaria vinculada com sucesso!')
    linkForm.email = ''
    mode.value = 'list'
    await refetchTeam()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao vincular secretaria')
  } finally {
    linking.value = false
  }
}

// ─── Toggle / unlink / permissions ────────────────────────────────────────────

const toggling = ref(false)
async function handleToggle(linkId: string) {
  toggling.value = true
  try {
    await api.patch(`/team/${linkId}/toggle`)
    await refetchTeam()
  } catch {
    toast.error('Erro ao alterar status')
  } finally {
    toggling.value = false
  }
}

const unlinking = ref(false)
async function handleUnlink(link: DoctorSecretary) {
  if (!confirm(`Desvincular ${link.secretary.name}?`)) return
  unlinking.value = true
  try {
    await api.delete(`/team/${link.id}`)
    toast.success('Secretaria desvinculada')
    await refetchTeam()
  } catch {
    toast.error('Erro ao desvincular')
  } finally {
    unlinking.value = false
  }
}

const updatingPermissions = ref(false)
async function handlePermissionChange(key: SecretaryPermissionKey, checked: boolean) {
  if (!accessLink.value) return
  updatingPermissions.value = true
  try {
    const partial: SecretaryPermissions = { [key]: checked }
    const { data: updated } = await api.patch(`/team/${accessLink.value.id}/permissions`, partial)
    accessLink.value = updated
    await refetchTeam()
    toast.success('Acessos atualizados')
  } catch {
    toast.error('Erro ao atualizar acessos')
  } finally {
    updatingPermissions.value = false
  }
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 page-stagger">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-stagger-1">
      <div>
        <h1 class="page-title flex items-center gap-2">
          <Users class="w-6 h-6 text-primary-600" />
          Minha Equipe
        </h1>
        <p class="page-subtitle">Gerencie as secretarias vinculadas à sua agenda</p>
      </div>
      <div v-if="mode === 'list'" class="flex gap-2 self-start sm:self-auto">
        <button class="btn-secondary" @click="mode = 'link'">
          <Link2 class="w-3.5 h-3.5" />
          Vincular
        </button>
        <button class="btn-primary" @click="mode = 'create'">
          <UserPlus class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Nova secretaria</span>
          <span class="sm:hidden">Nova</span>
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div v-if="mode === 'list'" class="grid grid-cols-2 gap-4 animate-stagger-2">
      <div class="card flex items-center gap-4">
        <div class="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center border border-primary-100 flex-shrink-0">
          <Users class="w-5 h-5 text-primary-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-900 tabular-nums">{{ team.length }}</p>
          <p class="text-xs text-slate-500 uppercase tracking-wider">Vinculadas</p>
        </div>
      </div>
      <div class="card flex items-center gap-4">
        <div class="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 flex-shrink-0">
          <ShieldCheck class="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <p class="text-2xl font-bold text-emerald-600 tabular-nums">{{ activeCount }}</p>
          <p class="text-xs text-slate-500 uppercase tracking-wider">Ativas</p>
        </div>
      </div>
    </div>

    <!-- Create form -->
    <div v-if="mode === 'create'" class="card animate-scale-in">
      <div class="flex items-center justify-between mb-5 pb-4 border-b border-slate-100">
        <h3 class="text-slate-900 font-bold flex items-center gap-2">
          <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
            <Plus class="w-4 h-4 text-primary-600" />
          </div>
          Criar nova secretaria
        </h3>
        <button class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" @click="mode = 'list'">
          <X class="w-4 h-4" />
        </button>
      </div>
      <form class="space-y-4" @submit.prevent="handleCreateSubmit">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Nome completo *</label>
            <input v-model="createForm.name" placeholder="Nome da secretaria" class="input-field w-full" />
            <p v-if="createErrors.name" class="text-red-500 text-xs mt-1">{{ createErrors.name }}</p>
          </div>
          <div>
            <label class="label">Telefone</label>
            <input v-model="createForm.phone" placeholder="(00) 00000-0000" class="input-field w-full" />
          </div>
        </div>
        <div>
          <label class="label">Email de acesso *</label>
          <input v-model="createForm.email" type="email" placeholder="secretaria@email.com" class="input-field w-full" />
          <p v-if="createErrors.email" class="text-red-500 text-xs mt-1">{{ createErrors.email }}</p>
        </div>
        <div>
          <label class="label">Senha de acesso *</label>
          <input v-model="createForm.password" type="password" placeholder="Mínimo 6 caracteres" class="input-field w-full" />
          <p v-if="createErrors.password" class="text-red-500 text-xs mt-1">{{ createErrors.password }}</p>
        </div>
        <div class="bg-primary-50 border border-primary-200 rounded-xl p-4 text-xs text-primary-800 space-y-1.5">
          <p class="font-semibold text-primary-900">Regras da Conta:</p>
          <p>A secretaria poderá acessar a agenda, pacientes e prontuários. Ela <strong class="text-primary-950">não terá acesso</strong> ao financeiro e nem aos laudos.</p>
          <p>Horários bloqueados aparecerão como <strong class="text-primary-950">"Bloqueado"</strong> para ela.</p>
        </div>
        <div class="flex gap-3 justify-end pt-2 border-t border-slate-100">
          <button type="button" class="btn-secondary" @click="mode = 'list'">Cancelar</button>
          <button type="submit" :disabled="creating" class="btn-primary">
            <template v-if="creating">
              <div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Criando...
            </template>
            <template v-else>Criar e vincular</template>
          </button>
        </div>
      </form>
    </div>

    <!-- Link form -->
    <div v-if="mode === 'link'" class="card animate-scale-in">
      <div class="flex items-center justify-between mb-5 pb-4 border-b border-slate-100">
        <h3 class="text-slate-900 font-bold flex items-center gap-2">
          <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100">
            <Link2 class="w-4 h-4 text-primary-600" />
          </div>
          Vincular secretaria existente
        </h3>
        <button class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" @click="mode = 'list'">
          <X class="w-4 h-4" />
        </button>
      </div>
      <form class="space-y-4" @submit.prevent="handleLinkSubmit">
        <div>
          <label class="label">Email da secretaria *</label>
          <input v-model="linkForm.email" type="email" placeholder="Digite o email da secretaria cadastrada" class="input-field w-full" />
          <p v-if="linkErrors.email" class="text-red-500 text-xs mt-1">{{ linkErrors.email }}</p>
        </div>
        <p class="text-xs text-slate-500">
          A secretaria deve já ter um cadastro com perfil "Secretaria" no sistema.
        </p>
        <div class="flex gap-3 justify-end pt-2 border-t border-slate-100">
          <button type="button" class="btn-secondary" @click="mode = 'list'">Cancelar</button>
          <button type="submit" :disabled="linking" class="btn-primary">
            <template v-if="linking">
              <div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Vinculando...
            </template>
            <template v-else>Vincular</template>
          </button>
        </div>
      </form>
    </div>

    <!-- Team list -->
    <div v-if="mode === 'list'" class="space-y-3 animate-stagger-3">
      <div v-if="team.length === 0" class="card border-2 border-dashed border-slate-200 bg-slate-50/40 p-12 text-center">
        <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float">
          <UserCircle2 class="w-8 h-8 text-slate-300" />
        </div>
        <p class="text-slate-600 font-semibold">Nenhuma secretaria vinculada</p>
        <p class="text-slate-400 text-sm mt-1">
          Crie um acesso ou vincule uma secretaria já cadastrada
        </p>
        <div class="flex gap-3 justify-center mt-5">
          <button class="btn-secondary" @click="mode = 'link'">
            <Link2 class="w-3.5 h-3.5" />
            Vincular existente
          </button>
          <button class="btn-primary" @click="mode = 'create'">
            <UserPlus class="w-3.5 h-3.5" />
            Criar nova
          </button>
        </div>
      </div>

      <div
        v-for="(link, idx) in team" :key="link.id"
        class="card p-4 flex items-center gap-4 group transition-all duration-200 hover:border-slate-300 hover:shadow-md"
        :class="link.active ? 'border-slate-200' : 'opacity-60 bg-slate-50'"
        :style="{ animationDelay: `${idx * 0.05}s` }"
      >
        <div
          class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm shadow-sm"
          :class="link.active ? `bg-gradient-to-br ${AVATAR_COLORS[idx % AVATAR_COLORS.length]} text-white` : 'bg-slate-200 text-slate-400'"
        >
          {{ initials(link.secretary.name) }}
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-slate-900 font-semibold">{{ link.secretary.name }}</p>
            <span
              class="text-xs px-2 py-0.5 rounded-full font-medium border"
              :class="link.active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'"
            >
              {{ link.active ? 'Ativa' : 'Inativa' }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            <span class="flex items-center gap-1 text-xs text-slate-500">
              <Mail class="w-3 h-3 text-slate-400" />
              {{ link.secretary.email }}
            </span>
            <span v-if="link.secretary.phone" class="flex items-center gap-1 text-xs text-slate-500">
              <Phone class="w-3 h-3 text-slate-400" />
              {{ link.secretary.phone }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 flex-shrink-0">
          <button
            title="Gestão de acessos"
            class="p-2 rounded-lg hover:bg-primary-50 text-slate-400 hover:text-primary-600 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-100"
            @click="accessLink = link"
          >
            <Settings2 class="w-4 h-4" />
          </button>
          <button
            :disabled="toggling"
            :title="link.active ? 'Desativar acesso' : 'Ativar acesso'"
            class="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-100"
            @click="handleToggle(link.id)"
          >
            <ShieldCheck v-if="link.active" class="w-4 h-4 text-emerald-600" />
            <ShieldOff v-else class="w-4 h-4" />
          </button>
          <button
            :disabled="unlinking"
            title="Desvincular secretaria"
            class="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 sm:opacity-100"
            @click="handleUnlink(link)"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Access rules note -->
    <div v-if="mode === 'list' && team.length > 0" class="card bg-primary-50 border-primary-200 p-5 animate-stagger-4">
      <p class="text-xs text-primary-900 font-bold uppercase tracking-wider mb-3">
        Regras de acesso da secretaria
      </p>
      <ul class="space-y-2">
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
          Visualiza a agenda apenas do médico vinculado
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
          Pode agendar, confirmar e cancelar consultas
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0 mt-1.5" />
          Pode criar pré-cadastros e finalizar cadastros pendentes
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" />
          Acesso ao Financeiro configurável em "Gestão de Acessos"
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 mt-1.5" />
          Não acessa laudos e avaliações
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 mt-1.5" />
          Configurações financeiras (categorias, contas) são exclusivas do médico
        </li>
        <li class="flex items-start gap-2 text-sm text-primary-700">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 mt-1.5" />
          Horários bloqueados pelo médico aparecem como "Bloqueado"
        </li>
      </ul>
    </div>

    <!-- Access management modal -->
    <Modal
      :is-open="!!accessLink"
      title="Gestão de Acessos"
      :subtitle="accessLink ? accessLink.secretary.name : undefined"
      @close="accessLink = null"
    >
      <div v-if="accessLink" class="space-y-4">
        <p class="text-xs text-slate-500">
          Marque as telas e funcionalidades que <strong>{{ accessLink.secretary.name }}</strong> pode acessar.
          Agenda, Pacientes e Prontuário já estão sempre liberados. Avaliações e agendas de outros médicos/salas continuam sempre bloqueados.
        </p>
        <div class="space-y-2">
          <label
            v-for="key in visiblePermissionKeys" :key="key"
            class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-primary-200 hover:bg-primary-50/40 cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              :checked="!!accessLink.permissions?.[key]"
              :disabled="updatingPermissions"
              class="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              @change="handlePermissionChange(key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="text-sm font-medium text-slate-700">{{ SECRETARY_PERMISSION_LABELS[key] }}</span>
          </label>
        </div>
        <p v-if="activeTypeSet.size === 0" class="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          Nenhuma integração contratada ainda — contrate em Configurações → Integrações para liberar o acesso de secretárias a elas.
        </p>
        <div class="flex justify-end pt-2 border-t border-slate-100">
          <button type="button" class="btn-secondary" @click="accessLink = null">
            Concluído
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>
