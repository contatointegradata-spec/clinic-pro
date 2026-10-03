<script setup lang="ts">
import { ref, computed } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Search, UserCheck, UserX, Edit2, Shield } from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import type { User } from '../types'
import Modal from '../components/ui/Modal.vue'
import UserForm from '../components/Users/UserForm.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { SkeletonTable } from '../components/ui'
import { useQuery } from '../composables/useQuery'

const roleConfig: Record<string, { label: string; className: string }> = {
  ADMIN: { label: 'Admin', className: 'bg-purple-100 text-purple-700' },
  DOCTOR: { label: 'Médico', className: 'bg-primary-100 text-primary-700' },
  SECRETARY: { label: 'Secretária', className: 'bg-emerald-100 text-emerald-700' },
}

const modalOpen = ref(false)
const editUser = ref<User | null>(null)
const search = ref('')
const saving = ref(false)

const { data: usersData, isLoading, refetch } = useQuery<User[]>({
  key: 'users',
  queryFn: () => api.get('/users').then(r => r.data),
})
const users = computed(() => usersData.value ?? [])

const filtered = computed(() => users.value.filter(u =>
  u.name.toLowerCase().includes(search.value.toLowerCase()) ||
  u.email.toLowerCase().includes(search.value.toLowerCase())
))

const stats = computed(() => ({
  total: users.value.length,
  doctors: users.value.filter(u => u.role === 'DOCTOR').length,
  secretaries: users.value.filter(u => u.role === 'SECRETARY').length,
  inactive: users.value.filter(u => !u.active).length,
}))

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function handleEdit(u: User) {
  editUser.value = u
  modalOpen.value = true
}

function handleNew() {
  editUser.value = null
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editUser.value = null
}

async function handleFormSubmit(data: Record<string, unknown>) {
  saving.value = true
  try {
    if (editUser.value) {
      await api.put(`/users/${editUser.value.id}`, data)
    } else {
      await api.post('/users', data)
    }
    toast.success(editUser.value ? 'Usuário atualizado!' : 'Usuário criado!')
    closeModal()
    await refetch()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao salvar usuário')
  } finally {
    saving.value = false
  }
}

async function toggleActive(u: User) {
  const wasActive = u.active
  try {
    await api.patch(`/users/${u.id}/toggle`)
    toast.success(`Usuário ${wasActive ? 'desativado' : 'ativado'}`)
    await refetch()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao atualizar usuário')
  }
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Usuários" subtitle="Gerencie usuários e permissões de acesso">
      <template #actions>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Novo Usuário
        </button>
      </template>
    </PageHeader>

    <!-- Stats -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      <div class="card text-center py-4">
        <p class="text-3xl font-bold text-slate-900">{{ stats.total }}</p>
        <p class="text-sm text-slate-500 mt-1">Total</p>
      </div>
      <div class="card text-center py-4">
        <p class="text-3xl font-bold text-primary-700">{{ stats.doctors }}</p>
        <p class="text-sm text-slate-500 mt-1">Médicos</p>
      </div>
      <div class="card text-center py-4">
        <p class="text-3xl font-bold text-emerald-700">{{ stats.secretaries }}</p>
        <p class="text-sm text-slate-500 mt-1">Secretárias</p>
      </div>
      <div class="card text-center py-4">
        <p class="text-3xl font-bold text-red-700">{{ stats.inactive }}</p>
        <p class="text-sm text-slate-500 mt-1">Inativos</p>
      </div>
    </div>

    <!-- Search — mobile -->
    <div class="sm:hidden card py-3">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          v-model="search"
          placeholder="Buscar usuários..."
          class="input-field pl-9 py-2"
        />
      </div>
    </div>

    <!-- Mobile cards -->
    <div class="sm:hidden space-y-3">
      <div v-if="isLoading" class="card py-12 text-center text-slate-400">Carregando...</div>
      <div v-else-if="filtered.length === 0" class="card py-12 text-center text-slate-400">Nenhum usuário encontrado</div>
      <template v-else>
        <div
          v-for="u in filtered" :key="u.id"
          class="card p-4" :class="!u.active ? 'opacity-60' : ''"
        >
          <div class="flex items-start gap-3">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              :class="u.active ? 'bg-primary-600' : 'bg-slate-300'"
            >
              <span class="text-white text-sm font-bold">{{ initials(u.name) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-slate-900 truncate">{{ u.name }}</p>
              <p class="text-xs text-slate-500 truncate">{{ u.email }}</p>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                <span class="status-badge" :class="roleConfig[u.role].className">{{ roleConfig[u.role].label }}</span>
                <span class="status-badge" :class="u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'">
                  {{ u.active ? 'Ativo' : 'Inativo' }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button class="btn-icon" title="Editar" @click="handleEdit(u)">
                <Edit2 class="w-4 h-4" />
              </button>
              <button
                class="btn-icon"
                :title="u.active ? 'Desativar' : 'Ativar'"
                @click="toggleActive(u)"
              >
                <UserX v-if="u.active" class="w-4 h-4" />
                <UserCheck v-else class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Table -->
    <div class="card p-0 overflow-hidden hidden sm:block">
      <div class="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
        <div class="relative flex-1 sm:max-w-sm">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            v-model="search"
            placeholder="Buscar usuários..."
            class="input-field pl-9 py-2"
          />
        </div>
        <Shield class="w-4 h-4 text-slate-400" />
        <span class="text-sm text-slate-500">{{ filtered.length }} usuários</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
              <th class="table-head-cell">Usuário</th>
              <th class="table-head-cell">Perfil</th>
              <th class="table-head-cell">Especialidade</th>
              <th class="table-head-cell">Telefone</th>
              <th class="table-head-cell">Cadastro</th>
              <th class="table-head-cell">Status</th>
              <th class="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td colspan="7" class="p-0">
                <SkeletonTable :rows="5" :cols="6" />
              </td>
            </tr>
            <tr v-else-if="filtered.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-slate-400">Nenhum usuário encontrado</td>
            </tr>
            <template v-else>
              <tr
                v-for="u in filtered" :key="u.id"
                class="table-row" :class="!u.active ? 'opacity-60' : ''"
              >
                <td class="table-cell">
                  <div class="flex items-center gap-3">
                    <div
                      class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                      :class="u.active ? 'bg-primary-600' : 'bg-slate-300'"
                    >
                      <span class="text-white text-sm font-bold">{{ initials(u.name) }}</span>
                    </div>
                    <div>
                      <p class="font-medium text-slate-900 text-sm">{{ u.name }}</p>
                      <p class="text-xs text-slate-500">{{ u.email }}</p>
                    </div>
                  </div>
                </td>
                <td class="table-cell">
                  <span class="status-badge" :class="roleConfig[u.role].className">{{ roleConfig[u.role].label }}</span>
                </td>
                <td class="table-cell text-slate-600">
                  {{ u.specialty || '–' }}
                  <span v-if="u.crm" class="text-xs text-slate-400 block">{{ u.crm }}</span>
                </td>
                <td class="table-cell text-slate-600">{{ u.phone || '–' }}</td>
                <td class="table-cell text-slate-500">
                  {{ u.createdAt ? format(new Date(u.createdAt), 'dd/MM/yyyy', { locale: ptBR }) : '–' }}
                </td>
                <td class="table-cell">
                  <span class="status-badge" :class="u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'">
                    {{ u.active ? 'Ativo' : 'Inativo' }}
                  </span>
                </td>
                <td class="table-cell">
                  <div class="flex items-center gap-1 justify-end">
                    <button
                      class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      title="Editar"
                      @click="handleEdit(u)"
                    >
                      <Edit2 class="w-3.5 h-3.5" />
                    </button>
                    <button
                      class="p-1.5 rounded-lg transition-colors"
                      :class="u.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
                      :title="u.active ? 'Desativar' : 'Ativar'"
                      @click="toggleActive(u)"
                    >
                      <UserX v-if="u.active" class="w-3.5 h-3.5" />
                      <UserCheck v-else class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <Modal
      :is-open="modalOpen"
      :title="editUser ? 'Editar Usuário' : 'Novo Usuário'"
      @close="closeModal"
    >
      <UserForm
        :user="editUser"
        :loading="saving"
        @submit="handleFormSubmit"
      />
    </Modal>
  </div>
</template>
