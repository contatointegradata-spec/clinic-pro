<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Search, Trash2, Pencil, Download, DollarSign, TrendingUp, TrendingDown } from 'lucide-vue-next'
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
const defaultType = ref<'INCOME' | 'EXPENSE'>('INCOME')
const page = ref(0)
const search = ref('')
const filterType = ref('')
const filterStatus = ref('')
const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
const saving = ref(false)

const { data: financialData, isLoading, refetch: refetchFinancial } = useQuery<FinancialResponse>({
  key: computed(() => `financial-extrato-${startDate.value}-${endDate.value}-${filterType.value}-${filterStatus.value}`),
  queryFn: () =>
    api
      .get('/financial', {
        params: {
          startDate: new Date(startDate.value).toISOString(),
          endDate: new Date(`${endDate.value}T23:59:59`).toISOString(),
          ...(filterType.value && { type: filterType.value }),
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
    tx.description.toLowerCase().includes(q) ||
    (tx.category?.toLowerCase().includes(q) ?? false) ||
    tx.doctor.name.toLowerCase().includes(q)
  )
})

const totalPages = computed(() => Math.ceil(filtered.value.length / PAGE_SIZE))
const paged = computed(() => filtered.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))

const summary = computed(() => financialData.value?.summary)

function resetPage() {
  page.value = 0
}

function handleNew(type: 'INCOME' | 'EXPENSE') {
  editTx.value = null
  defaultType.value = type
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
    if (editTx.value) {
      await api.put(`/financial/${editTx.value.id}`, data)
    } else {
      await api.post('/financial', data)
    }
    await refetchFinancial()
    toast.success(editTx.value ? 'Transação atualizada!' : 'Transação adicionada!')
    closeModal()
  } catch {
    toast.error('Erro ao salvar transação')
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('Remover esta transação?')) return
  try {
    await api.delete(`/financial/${id}`)
    await refetchFinancial()
    toast.success('Transação removida')
  } catch {
    toast.error('Erro ao remover transação')
  }
}

function exportCSV() {
  const rows = [
    ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Status', 'Médico'].join(';'),
    ...filtered.value.map(tx => [
      format(new Date(tx.date), 'dd/MM/yyyy'),
      `"${tx.description}"`,
      tx.category ?? '',
      tx.type === 'INCOME' ? 'Receita' : 'Despesa',
      tx.amount.toFixed(2).replace('.', ','),
      tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado',
      tx.doctor.name,
    ].join(';')),
  ].join('\n')

  const blob = new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `extrato-${startDate.value}-${endDate.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Extrato" subtitle="Todas as movimentações financeiras">
      <template #actions>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" @click="exportCSV">
            <Download class="w-4 h-4" />
            Exportar CSV
          </button>
          <button class="btn-secondary" @click="handleNew('EXPENSE')">
            <TrendingDown class="w-4 h-4" />
            Lançar Despesa
          </button>
          <button class="btn-primary" @click="handleNew('INCOME')">
            <TrendingUp class="w-4 h-4" />
            Lançar Receita
          </button>
        </div>
      </template>
    </PageHeader>

    <!-- Summary mini cards -->
    <div class="grid grid-cols-3 gap-3">
      <div class="card py-3">
        <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Receitas</p>
        <p class="text-lg font-bold text-emerald-600 tabular-nums">{{ currency(summary?.income ?? 0) }}</p>
      </div>
      <div class="card py-3">
        <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Despesas</p>
        <p class="text-lg font-bold text-red-600 tabular-nums">{{ currency(summary?.expense ?? 0) }}</p>
      </div>
      <div class="card py-3">
        <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Saldo</p>
        <p class="text-lg font-bold tabular-nums" :class="(summary?.balance ?? 0) >= 0 ? 'text-primary-600' : 'text-red-600'">
          {{ currency(summary?.balance ?? 0) }}
        </p>
      </div>
    </div>

    <!-- Filters -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[200px]">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            v-model="search"
            type="text"
            placeholder="Buscar por descrição, categoria ou médico..."
            class="input-field pl-9"
            @input="resetPage"
          />
        </div>

        <input v-model="startDate" type="date" class="input-field py-2 text-sm" @change="resetPage" />
        <span class="text-slate-400 text-sm">até</span>
        <input v-model="endDate" type="date" class="input-field py-2 text-sm" @change="resetPage" />

        <select v-model="filterType" class="input-field py-2 text-sm" @change="resetPage">
          <option value="">Tipo: Todos</option>
          <option value="INCOME">Receitas</option>
          <option value="EXPENSE">Despesas</option>
        </select>

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
          <h2 class="font-semibold text-slate-900">Transações</h2>
          <p class="text-xs text-slate-400 mt-0.5 tabular-nums">
            {{ filtered.length }} registro{{ filtered.length !== 1 ? 's' : '' }} encontrado{{ filtered.length !== 1 ? 's' : '' }}
          </p>
        </div>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page === 0" @click="page = Math.max(0, page - 1)">
            Anterior
          </button>
          <span class="text-xs text-slate-500">{{ page + 1 }} / {{ totalPages }}</span>
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page >= totalPages - 1" @click="page = Math.min(totalPages - 1, page + 1)">
            Próxima
          </button>
        </div>
      </div>

      <div v-if="isLoading" class="py-16 flex items-center justify-center">
        <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Data</th>
              <th class="table-head-cell">Descrição</th>
              <th class="table-head-cell hidden lg:table-cell">Categoria</th>
              <th class="table-head-cell hidden md:table-cell">Tipo</th>
              <th class="table-head-cell text-right">Valor</th>
              <th class="table-head-cell">Status</th>
              <th class="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="paged.length === 0">
              <td colspan="7">
                <div class="empty-state py-12">
                  <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                    <DollarSign class="w-7 h-7 text-slate-300" />
                  </div>
                  <p class="text-slate-500 font-semibold">Nenhuma transação encontrada</p>
                  <p class="text-slate-400 text-sm mt-1">Ajuste os filtros ou adicione uma nova transação</p>
                  <button class="mt-4 btn-primary text-xs" @click="handleNew('INCOME')">
                    <Plus class="w-3.5 h-3.5" />
                    Nova Transação
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
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full flex-shrink-0" :class="tx.type === 'INCOME' ? 'bg-emerald-500' : 'bg-red-500'" />
                  <p class="text-sm font-medium text-slate-900 truncate">{{ tx.description }}</p>
                </div>
                <p v-if="tx.appointment?.patient" class="text-xs text-slate-400 ml-4 mt-0.5 truncate">{{ tx.appointment.patient.name }}</p>
              </td>
              <td class="table-cell hidden lg:table-cell">
                <span v-if="tx.category" class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
                  {{ tx.category }}
                </span>
              </td>
              <td class="table-cell hidden md:table-cell">
                <span class="text-xs px-2.5 py-1 rounded-full font-medium" :class="tx.type === 'INCOME' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'">
                  {{ tx.type === 'INCOME' ? 'Receita' : 'Despesa' }}
                </span>
              </td>
              <td class="table-cell font-bold text-right tabular-nums whitespace-nowrap" :class="tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'">
                {{ tx.type === 'INCOME' ? '+' : '−' }}{{ currency(tx.amount) }}
              </td>
              <td class="table-cell">
                <span
                  class="status-badge gap-1.5"
                  :class="tx.status === 'PAID'
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : tx.status === 'PENDING'
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
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

    <Modal
      :is-open="modalOpen"
      :title="editTx ? 'Editar Transação' : defaultType === 'INCOME' ? 'Lançar Receita' : 'Lançar Despesa'"
      @close="closeModal"
    >
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
