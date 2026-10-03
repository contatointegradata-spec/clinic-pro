<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Search, Trash2, Pencil, TrendingUp, Download, Clock } from 'lucide-vue-next'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import { useQuery } from '../../composables/useQuery'
import toast from '../../lib/toast'
import type { Transaction, FinancialResponse, User, Patient } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import TransactionForm from '../../components/Financial/TransactionForm.vue'
import PageHeader from '../../components/ui/PageHeader.vue'

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const PAGE_SIZE = 50

const authStore = useAuthStore()

const modalOpen = ref(false)
const editTx = ref<Transaction | null>(null)
const page = ref(0)
const search = ref('')
const filterStatus = ref('')
const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
const saving = ref(false)

const { data: financialData, isLoading, refetch: refetchFinancial } = useQuery<FinancialResponse>({
  key: computed(() => `financial-receitas-${startDate.value}-${endDate.value}-${filterStatus.value}`),
  queryFn: () =>
    api
      .get('/financial', {
        params: {
          startDate: new Date(startDate.value).toISOString(),
          endDate: new Date(`${endDate.value}T23:59:59`).toISOString(),
          type: 'INCOME',
          ...(filterStatus.value && { status: filterStatus.value }),
        },
      })
      .then(r => r.data),
})

const { data: doctorsRaw } = useQuery<User[]>({
  key: 'doctors',
  queryFn: () => api.get('/doctors').then(r => r.data),
  enabled: computed(() => authStore.user?.role === 'ADMIN'),
})
const doctors = computed<User[]>(() => doctorsRaw.value ?? [])

const { data: patientsRaw } = useQuery<Patient[]>({
  key: 'patients',
  queryFn: () => api.get('/patients').then(r => r.data),
})
const patients = computed<Patient[]>(() => patientsRaw.value ?? [])

const allTransactions = computed(() => financialData.value?.transactions ?? [])

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return allTransactions.value
  return allTransactions.value.filter(tx =>
    tx.description.toLowerCase().includes(q) || (tx.category?.toLowerCase().includes(q) ?? false)
  )
})

const totalReceived = computed(() =>
  allTransactions.value.filter(t => t.status === 'PAID').reduce((s, t) => s + t.amount, 0)
)
const totalPending = computed(() =>
  allTransactions.value.filter(t => t.status === 'PENDING').reduce((s, t) => s + t.amount, 0)
)

const totalPages = computed(() => Math.ceil(filtered.value.length / PAGE_SIZE))
const paged = computed(() => filtered.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))

function resetPage() {
  page.value = 0
}

function openNew() {
  editTx.value = null
  modalOpen.value = true
}

function handleEdit(tx: Transaction) {
  editTx.value = tx
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editTx.value = null
}

async function handleSave(data: Record<string, unknown>) {
  saving.value = true
  try {
    const payload = { ...data, type: 'INCOME' }
    if (editTx.value) {
      await api.put(`/financial/${editTx.value.id}`, payload)
    } else {
      await api.post('/financial', payload)
    }
    await refetchFinancial()
    toast.success(editTx.value ? 'Receita atualizada!' : 'Receita adicionada!')
    closeModal()
  } catch {
    toast.error('Erro ao salvar receita')
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('Remover esta receita?')) return
  await api.delete(`/financial/${id}`)
  await refetchFinancial()
  toast.success('Receita removida')
}

function exportCSV() {
  const rows = [
    ['Data', 'Descrição', 'Categoria', 'Valor', 'Status'].join(';'),
    ...filtered.value.map(tx => [
      format(new Date(tx.date), 'dd/MM/yyyy'),
      `"${tx.description}"`,
      tx.category ?? '',
      tx.amount.toFixed(2).replace('.', ','),
      tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado',
    ].join(';')),
  ].join('\n')
  const blob = new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `receitas-${startDate.value}-${endDate.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Receitas" subtitle="Todas as entradas e receitas financeiras">
      <template #actions>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" @click="exportCSV">
            <Download class="w-4 h-4" />
            Exportar
          </button>
          <button class="btn-primary" @click="openNew">
            <Plus class="w-4 h-4" />
            Nova Receita
          </button>
        </div>
      </template>
    </PageHeader>

    <!-- Summary -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm">
            <TrendingUp class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Total do Período</p>
            <p class="text-xl font-bold text-emerald-600 mt-1 leading-none">{{ currency(financialData?.summary?.income ?? 0) }}</p>
          </div>
        </div>
      </div>
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <TrendingUp class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Recebido</p>
            <p class="text-xl font-bold text-emerald-600 mt-1 leading-none">{{ currency(totalReceived) }}</p>
          </div>
        </div>
      </div>
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-amber-400 to-amber-600 shadow-sm">
            <Clock class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">A Receber</p>
            <p class="text-xl font-bold text-amber-600 mt-1 leading-none">{{ currency(totalPending) }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[200px]">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input v-model="search" type="text" placeholder="Buscar receita..." class="input-field pl-9" @input="resetPage" />
        </div>
        <input v-model="startDate" type="date" class="input-field py-2 text-sm" @change="resetPage" />
        <span class="text-slate-400 text-sm">até</span>
        <input v-model="endDate" type="date" class="input-field py-2 text-sm" @change="resetPage" />
        <select v-model="filterStatus" class="input-field py-2 text-sm" @change="resetPage">
          <option value="">Status: Todos</option>
          <option value="PAID">Pago</option>
          <option value="PENDING">Pendente</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
      </div>
    </div>

    <!-- Table -->
    <div class="card p-0 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 class="font-semibold text-slate-900">Receitas</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ filtered.length }} registro{{ filtered.length !== 1 ? 's' : '' }}</p>
        </div>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page === 0" @click="page = Math.max(0, page - 1)">Anterior</button>
          <span class="text-xs text-slate-500">{{ page + 1 }} / {{ totalPages }}</span>
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page >= totalPages - 1" @click="page = Math.min(totalPages - 1, page + 1)">Próxima</button>
        </div>
      </div>

      <div v-if="isLoading" class="py-16 flex items-center justify-center">
        <div class="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Data</th>
              <th class="table-head-cell">Descrição</th>
              <th class="table-head-cell hidden lg:table-cell">Categoria</th>
              <th class="table-head-cell text-right">Valor</th>
              <th class="table-head-cell">Status</th>
              <th class="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="paged.length === 0">
              <td colspan="6">
                <div class="empty-state py-12">
                  <TrendingUp class="w-10 h-10 text-slate-300 mb-3" />
                  <p class="text-slate-500 font-semibold">Nenhuma receita encontrada</p>
                  <button class="mt-4 btn-primary text-xs" @click="openNew">
                    <Plus class="w-3.5 h-3.5" /> Nova Receita
                  </button>
                </div>
              </td>
            </tr>
            <tr
              v-for="(tx, idx) in paged"
              v-else
              :key="tx.id"
              class="table-row group"
              :style="{ animationDelay: `${idx * 0.02}s` }"
            >
              <td class="table-cell text-slate-600 tabular-nums whitespace-nowrap">
                {{ format(new Date(tx.date), 'dd/MM/yyyy', { locale: ptBR }) }}
              </td>
              <td class="table-cell max-w-[220px]">
                <p class="text-sm font-medium text-slate-900 truncate">{{ tx.description }}</p>
                <p v-if="tx.appointment?.patient" class="text-xs text-slate-400 mt-0.5 truncate">{{ tx.appointment.patient.name }}</p>
              </td>
              <td class="table-cell hidden lg:table-cell">
                <span v-if="tx.category" class="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium">
                  {{ tx.category }}
                </span>
              </td>
              <td class="table-cell font-bold text-right text-emerald-600 tabular-nums whitespace-nowrap">
                +{{ currency(tx.amount) }}
              </td>
              <td class="table-cell">
                <span
                  class="status-badge gap-1.5"
                  :class="tx.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : tx.status === 'PENDING' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :class="tx.status === 'PAID' ? 'bg-emerald-500' : tx.status === 'PENDING' ? 'bg-amber-400' : 'bg-slate-400'" />
                  {{ tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado' }}
                </span>
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <button class="btn-icon w-7 h-7 hover:text-primary-600 hover:bg-primary-50" @click="handleEdit(tx)">
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-icon w-7 h-7 hover:text-red-600 hover:bg-red-50" @click="handleDelete(tx.id)">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :is-open="modalOpen" :title="editTx ? 'Editar Receita' : 'Nova Receita'" @close="closeModal">
      <TransactionForm
        :transaction="editTx"
        :doctors="doctors"
        :patients="patients"
        :current-user="authStore.user"
        :loading="saving"
        @submit="handleSave"
      />
    </Modal>
  </div>
</template>
