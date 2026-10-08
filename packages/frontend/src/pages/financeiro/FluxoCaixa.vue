<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Search, Trash2, Pencil, Download, DollarSign, TrendingUp, TrendingDown, FileText, FileCheck2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useAuthStore } from '../../stores/auth'
import { useQuery } from '../../composables/useQuery'
import type { Transaction, FinancialResponse, User, Patient } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import TransactionForm from '../../components/Financial/TransactionForm.vue'
import EmitirNotaModal from '../../components/Financial/EmitirNotaModal.vue'
import { NFSE_STATUS, apiError, currency } from '../../components/Financial/nfse'

// Fluxo de caixa = movimentações (antigo Extrato/Receitas/Despesas) + evolução
// do saldo no período. Receitas pagas podem gerar NFS-e direto da linha.

interface CashFlowEntry { date: string; income: number; expense: number; balance: number; cumulativeBalance: number }

const PAGE_SIZE = 50
const authStore = useAuthStore()
const router = useRouter()

const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
const filterType = ref('')
const filterStatus = ref('')
const search = ref('')
const page = ref(0)

const range = computed(() => ({
  start: new Date(`${startDate.value}T00:00:00`).toISOString(),
  end: new Date(`${endDate.value}T23:59:59`).toISOString(),
}))

const { data: financialData, isLoading, refetch: refetchFinancial } = useQuery<FinancialResponse>({
  key: computed(() => `financial-flow-${startDate.value}-${endDate.value}-${filterType.value}-${filterStatus.value}`),
  queryFn: () =>
    api.get('/financial', {
      params: {
        startDate: range.value.start,
        endDate: range.value.end,
        ...(filterType.value && { type: filterType.value }),
        ...(filterStatus.value && { status: filterStatus.value }),
      },
    }).then(r => r.data),
})

const { data: cashFlow, refetch: refetchCashFlow } = useQuery<{ entries: CashFlowEntry[] }>({
  key: computed(() => `cash-flow-${startDate.value}-${endDate.value}`),
  queryFn: () => api.get('/financial/cash-flow', { params: { startDate: range.value.start, endDate: range.value.end, period: 'daily' } }).then(r => r.data),
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

const summary = computed(() => financialData.value?.summary)
const entries = computed(() => cashFlow.value?.entries ?? [])
const chartMax = computed(() => Math.max(1, ...entries.value.flatMap(e => [e.income, e.expense, Math.abs(e.cumulativeBalance)])))
const pct = (v: number) => Math.min((Math.abs(v) / chartMax.value) * 100, 100)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const all = financialData.value?.transactions ?? []
  if (!q) return all
  return all.filter(tx =>
    tx.description.toLowerCase().includes(q)
    || (tx.category?.toLowerCase().includes(q) ?? false)
    || (tx.appointment?.patient.name.toLowerCase().includes(q) ?? false)
    || (tx.patient?.name.toLowerCase().includes(q) ?? false))
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const paged = computed(() => filtered.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))

function patientName(tx: Transaction) {
  return tx.patient?.name ?? tx.appointment?.patient.name ?? null
}

// ─── Lançamentos ─────────────────────────────────────────────────────
const modalOpen = ref(false)
const editTx = ref<Transaction | null>(null)
const defaultType = ref<'INCOME' | 'EXPENSE'>('INCOME')
const saving = ref(false)

function handleNew(type: 'INCOME' | 'EXPENSE') {
  editTx.value = null
  defaultType.value = type
  modalOpen.value = true
}

async function refresh() {
  await Promise.all([refetchFinancial(), refetchCashFlow()])
}

async function handleSave(data: Record<string, unknown>) {
  saving.value = true
  try {
    if (editTx.value) await api.put(`/financial/${editTx.value.id}`, data)
    else await api.post('/financial', data)
    await refresh()
    toast.success(editTx.value ? 'Lançamento atualizado!' : 'Lançamento adicionado!')
    modalOpen.value = false
    editTx.value = null
  } catch (e) {
    toast.error(apiError(e, 'Erro ao salvar lançamento'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(tx: Transaction) {
  if (!confirm(`Remover "${tx.description}"?`)) return
  try {
    await api.delete(`/financial/${tx.id}`)
    await refresh()
    toast.success('Lançamento removido')
  } catch (e) {
    toast.error(apiError(e, 'Erro ao remover lançamento'))
  }
}

// ─── NFS-e ───────────────────────────────────────────────────────────
const nfseTx = ref<Transaction | null>(null)
const canIssue = (tx: Transaction) => tx.type === 'INCOME' && tx.status !== 'CANCELLED' && (!tx.nfse || ['REJECTED', 'ERROR', 'CANCELLED'].includes(tx.nfse.status))

function openNfse(tx: Transaction) {
  if (tx.nfse && !canIssue(tx)) router.push({ path: '/financeiro/notas-fiscais', query: { nota: tx.nfse.id } })
  else nfseTx.value = tx
}

function exportCSV() {
  const rows = [
    ['Data', 'Descrição', 'Paciente', 'Categoria', 'Tipo', 'Valor', 'Status', 'NFS-e'].join(';'),
    ...filtered.value.map(tx => [
      format(new Date(tx.date), 'dd/MM/yyyy'),
      `"${tx.description.replace(/"/g, '""')}"`,
      `"${patientName(tx) ?? ''}"`,
      tx.category ?? '',
      tx.type === 'INCOME' ? 'Receita' : 'Despesa',
      tx.amount.toFixed(2).replace('.', ','),
      tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado',
      tx.nfse ? `${NFSE_STATUS[tx.nfse.status].label}${tx.nfse.numeroNfse ? ` nº ${tx.nfse.numeroNfse}` : ''}` : '',
    ].join(';')),
  ].join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `fluxo-caixa-${startDate.value}-${endDate.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Fluxo de caixa" subtitle="Entradas, saídas e saldo do período">
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn-secondary" @click="exportCSV"><Download class="w-4 h-4" /> CSV</button>
          <button class="btn-secondary" @click="handleNew('EXPENSE')"><TrendingDown class="w-4 h-4" /> Despesa</button>
          <button class="btn-primary" @click="handleNew('INCOME')"><TrendingUp class="w-4 h-4" /> Receita</button>
        </div>
      </template>
    </PageHeader>

    <!-- Filtros -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[200px]">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input v-model="search" type="text" placeholder="Buscar descrição, paciente ou categoria" class="input-field pl-9" @input="page = 0" />
        </div>
        <input v-model="startDate" type="date" class="input-field py-2 text-sm w-auto" @change="page = 0" />
        <span class="text-slate-400 text-sm">até</span>
        <input v-model="endDate" type="date" class="input-field py-2 text-sm w-auto" @change="page = 0" />
        <select v-model="filterType" class="input-field py-2 text-sm w-auto" @change="page = 0">
          <option value="">Tipo: todos</option>
          <option value="INCOME">Receitas</option>
          <option value="EXPENSE">Despesas</option>
        </select>
        <select v-model="filterStatus" class="input-field py-2 text-sm w-auto" @change="page = 0">
          <option value="">Status: todos</option>
          <option value="PAID">Pago</option>
          <option value="PENDING">Pendente</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
      </div>
    </div>

    <!-- Resumo + evolução -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="grid grid-cols-2 lg:grid-cols-1 gap-3">
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Entradas</p>
          <p class="text-lg font-bold text-emerald-600 tabular-nums">{{ currency(summary?.income ?? 0) }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Saídas</p>
          <p class="text-lg font-bold text-red-600 tabular-nums">{{ currency(summary?.expense ?? 0) }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Saldo</p>
          <p class="text-lg font-bold tabular-nums" :class="(summary?.balance ?? 0) >= 0 ? 'text-primary-600' : 'text-red-600'">{{ currency(summary?.balance ?? 0) }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">A receber/pagar</p>
          <p class="text-lg font-bold text-amber-600 tabular-nums">{{ currency(summary?.pending ?? 0) }}</p>
        </div>
      </div>

      <div class="card lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-slate-900">Evolução diária (pagos)</h2>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500" />Entradas</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400" />Saídas</span>
            <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-primary-500" />Saldo acumulado</span>
          </div>
        </div>
        <div v-if="entries.length === 0" class="h-44 flex items-center justify-center text-sm text-slate-400">Sem movimentações pagas no período</div>
        <div v-else class="flex items-end gap-1 h-44 overflow-x-auto">
          <div v-for="e in entries" :key="e.date" class="flex-1 min-w-[12px] flex flex-col items-center gap-1 h-full justify-end" :title="`${format(new Date(`${e.date}T12:00:00`), 'dd/MM')} · entradas ${currency(e.income)} · saídas ${currency(e.expense)} · saldo ${currency(e.cumulativeBalance)}`">
            <div class="flex items-end justify-center gap-px flex-1 w-full">
              <div class="w-1.5 rounded-t-sm bg-emerald-500" :style="{ height: `${pct(e.income)}%` }" />
              <div class="w-1.5 rounded-t-sm bg-red-400" :style="{ height: `${pct(e.expense)}%` }" />
              <div class="w-1.5 rounded-t-sm" :class="e.cumulativeBalance >= 0 ? 'bg-primary-500' : 'bg-red-600'" :style="{ height: `${pct(e.cumulativeBalance)}%` }" />
            </div>
            <span class="text-[10px] text-slate-400">{{ e.date.slice(8, 10) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Movimentações -->
    <div class="card p-0 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 class="font-semibold text-slate-900">Movimentações</h2>
          <p class="text-xs text-slate-400 mt-0.5 tabular-nums">{{ filtered.length }} registro{{ filtered.length !== 1 ? 's' : '' }}</p>
        </div>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page === 0" @click="page--">Anterior</button>
          <span class="text-xs text-slate-500">{{ page + 1 }} / {{ totalPages }}</span>
          <button class="btn-secondary py-1 px-3 text-xs disabled:opacity-40" :disabled="page >= totalPages - 1" @click="page++">Próxima</button>
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
              <th class="table-head-cell text-right">Valor</th>
              <th class="table-head-cell">Status</th>
              <th class="table-head-cell hidden md:table-cell">Nota fiscal</th>
              <th class="px-4 py-3 w-28" />
            </tr>
          </thead>
          <tbody>
            <tr v-if="paged.length === 0">
              <td colspan="6">
                <div class="empty-state py-12">
                  <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3"><DollarSign class="w-7 h-7 text-slate-300" /></div>
                  <p class="text-slate-500 font-semibold">Nenhuma movimentação no período</p>
                </div>
              </td>
            </tr>
            <tr v-for="tx in paged" v-else :key="tx.id" class="table-row group">
              <td class="table-cell text-slate-600 tabular-nums whitespace-nowrap">{{ format(new Date(tx.date), 'dd/MM/yyyy', { locale: ptBR }) }}</td>
              <td class="table-cell max-w-[260px]">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full flex-shrink-0" :class="tx.type === 'INCOME' ? 'bg-emerald-500' : 'bg-red-500'" />
                  <p class="text-sm font-medium text-slate-900 truncate">{{ tx.description }}</p>
                </div>
                <p v-if="patientName(tx) || tx.category" class="text-xs text-slate-400 ml-4 mt-0.5 truncate">{{ [patientName(tx), tx.category].filter(Boolean).join(' · ') }}</p>
              </td>
              <td class="table-cell font-bold text-right tabular-nums whitespace-nowrap" :class="tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'">
                {{ tx.type === 'INCOME' ? '+' : '−' }}{{ currency(tx.amount) }}
              </td>
              <td class="table-cell">
                <span class="status-badge" :class="tx.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : tx.status === 'PENDING' ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'">
                  {{ tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado' }}
                </span>
              </td>
              <td class="table-cell hidden md:table-cell">
                <button v-if="tx.nfse" class="status-badge gap-1.5" :class="NFSE_STATUS[tx.nfse.status].cls" @click="openNfse(tx)">
                  <span class="w-1.5 h-1.5 rounded-full" :class="NFSE_STATUS[tx.nfse.status].dot" />
                  {{ NFSE_STATUS[tx.nfse.status].label }}<template v-if="tx.nfse.numeroNfse"> · nº {{ tx.nfse.numeroNfse }}</template>
                </button>
                <span v-else-if="tx.type === 'INCOME'" class="text-xs text-slate-300">—</span>
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-1 justify-end">
                  <button
                    v-if="canIssue(tx)"
                    class="btn-icon w-7 h-7 text-primary-600 hover:bg-primary-50"
                    :title="tx.nfse ? 'Emitir nota novamente' : 'Emitir nota fiscal'"
                    :aria-label="`Emitir nota fiscal de ${tx.description}`"
                    @click="openNfse(tx)"
                  >
                    <FileCheck2 class="w-3.5 h-3.5" />
                  </button>
                  <button v-else-if="tx.nfse" class="btn-icon w-7 h-7 hover:text-primary-600 hover:bg-primary-50" title="Ver nota" aria-label="Ver nota fiscal" @click="openNfse(tx)">
                    <FileText class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-icon w-7 h-7 opacity-0 group-hover:opacity-100 hover:text-primary-600 hover:bg-primary-50" aria-label="Editar" @click="editTx = tx; modalOpen = true">
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-icon w-7 h-7 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50" aria-label="Excluir" @click="handleDelete(tx)">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :is-open="modalOpen" :title="editTx ? 'Editar lançamento' : defaultType === 'INCOME' ? 'Nova receita' : 'Nova despesa'" @close="modalOpen = false; editTx = null">
      <TransactionForm
        :transaction="editTx"
        :default-type="defaultType"
        :doctors="doctors"
        :patients="patients"
        :current-user="authStore.user"
        :loading="saving"
        @submit="handleSave"
      />
    </Modal>

    <EmitirNotaModal :is-open="!!nfseTx" :transaction="nfseTx" :patients="patients" @close="nfseTx = null" @issued="refresh" />
  </div>
</template>
