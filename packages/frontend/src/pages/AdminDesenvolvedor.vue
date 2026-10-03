<script setup lang="ts">
import { ref, computed } from 'vue'
import { Code2, Search, Bell, Webhook, Bot, Minus, Plus } from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import { useQuery } from '../composables/useQuery'

interface PlatformUserRow {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'DOCTOR' | 'SECRETARY'
  active: boolean
  isPlatformDeveloper: boolean
  notificationsAccess: boolean
  integrationsAccess: boolean
  aiAgentLimit: number
}

const roleLabel: Record<string, string> = {
  ADMIN: 'Administrador',
  DOCTOR: 'Especialista',
  SECRETARY: 'Secretária',
}

const search = ref('')
const updatingId = ref<string | null>(null)

const { data: usersData, isLoading, refetch } = useQuery<PlatformUserRow[]>({
  key: 'platform-admin-users',
  queryFn: () => api.get('/platform-admin/users').then(r => r.data),
})
const users = computed(() => usersData.value ?? [])

const filtered = computed(() => users.value.filter(u =>
  u.name.toLowerCase().includes(search.value.toLowerCase()) ||
  u.email.toLowerCase().includes(search.value.toLowerCase())
))

async function updateAccess(user: PlatformUserRow, data: Partial<Pick<PlatformUserRow, 'notificationsAccess' | 'integrationsAccess'>>) {
  updatingId.value = user.id
  try {
    await api.patch(`/platform-admin/users/${user.id}/access`, data)
    toast.success('Acesso atualizado')
    await refetch()
  } catch {
    toast.error('Não foi possível atualizar o acesso')
  } finally {
    updatingId.value = null
  }
}

async function updateAiAgentLimit(user: PlatformUserRow, delta: number) {
  const next = user.aiAgentLimit + delta
  if (next < 0 || next > 20) return
  updatingId.value = user.id
  try {
    await api.patch(`/platform-admin/users/${user.id}/access`, { aiAgentLimit: next })
    toast.success('Limite de agentes atualizado')
    await refetch()
  } catch {
    toast.error('Não foi possível atualizar o limite')
  } finally {
    updatingId.value = null
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 page-stagger">
    <div class="animate-stagger-1">
      <h1 class="page-title flex items-center gap-2">
        <Code2 class="w-6 h-6 text-primary-600" />
        Admin Desenvolvedor
      </h1>
      <p class="page-subtitle">
        Libere Notificações e Integrações individualmente, por usuário, em qualquer clínica da plataforma.
        Ajuste também quantos Agentes de IA cada médico pode ter (padrão: 1 grátis).
      </p>
    </div>

    <div class="relative animate-stagger-2">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input v-model="search" class="input-field pl-9 max-w-sm" placeholder="Buscar por nome ou e-mail..." />
    </div>

    <div class="card p-0 overflow-hidden animate-stagger-3">
      <div v-if="isLoading" class="text-center py-14 text-slate-400">Carregando...</div>
      <div v-else-if="filtered.length === 0" class="text-center py-14 text-slate-400">Nenhum usuário encontrado</div>
      <div v-else class="divide-y divide-slate-100">
        <div v-for="u in filtered" :key="u.id" class="flex items-center gap-4 px-5 py-4 flex-wrap sm:flex-nowrap">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900 truncate">{{ u.name }}</p>
              <span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{{ roleLabel[u.role] ?? u.role }}</span>
              <span v-if="u.isPlatformDeveloper" class="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Desenvolvedor</span>
              <span v-if="!u.active" class="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">Inativo</span>
            </div>
            <p class="text-xs text-slate-400 truncate mt-0.5">{{ u.email }}</p>
          </div>

          <!-- Notificações toggle -->
          <div class="flex items-center gap-2" title="Notificações">
            <Bell class="w-4 h-4 text-slate-400" />
            <button
              type="button"
              class="w-10 h-6 rounded-full relative transition-colors flex-shrink-0"
              :class="[
                (u.isPlatformDeveloper || u.notificationsAccess) ? 'bg-primary-600' : 'bg-slate-300',
                (u.isPlatformDeveloper || updatingId === u.id) ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="u.isPlatformDeveloper || updatingId === u.id"
              @click="updateAccess(u, { notificationsAccess: !u.notificationsAccess })"
            >
              <div
                class="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
                :class="(u.isPlatformDeveloper || u.notificationsAccess) ? 'left-4' : 'left-0.5'"
              />
            </button>
          </div>

          <!-- Integrações toggle -->
          <div class="flex items-center gap-2" title="Integrações">
            <Webhook class="w-4 h-4 text-slate-400" />
            <button
              type="button"
              class="w-10 h-6 rounded-full relative transition-colors flex-shrink-0"
              :class="[
                (u.isPlatformDeveloper || u.integrationsAccess) ? 'bg-primary-600' : 'bg-slate-300',
                (u.isPlatformDeveloper || updatingId === u.id) ? 'opacity-50 cursor-not-allowed' : '',
              ]"
              :disabled="u.isPlatformDeveloper || updatingId === u.id"
              @click="updateAccess(u, { integrationsAccess: !u.integrationsAccess })"
            >
              <div
                class="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all"
                :class="(u.isPlatformDeveloper || u.integrationsAccess) ? 'left-4' : 'left-0.5'"
              />
            </button>
          </div>

          <!-- Limite de Agentes de IA (só pra médicos) -->
          <div v-if="u.role === 'DOCTOR'" class="flex items-center gap-1.5" title="Agentes de IA liberados">
            <Bot class="w-4 h-4 text-slate-400" />
            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="updatingId === u.id || u.aiAgentLimit <= 0"
              @click="updateAiAgentLimit(u, -1)"
            >
              <Minus class="w-3 h-3" />
            </button>
            <span class="w-5 text-center text-sm font-semibold text-slate-700">{{ u.aiAgentLimit }}</span>
            <button
              type="button"
              class="w-6 h-6 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="updatingId === u.id || u.aiAgentLimit >= 20"
              @click="updateAiAgentLimit(u, 1)"
            >
              <Plus class="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
