<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Plus,
  BarChart3,
  ArrowUpRight,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import type { Transaction, FinancialResponse, MonthlyData, User, Patient } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import TransactionForm from '../../components/Financial/TransactionForm.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import { useQuery } from '../../composables/useQuery'

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function pct(value: number, max: number) {
  return max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0
}

const authStore = useAuthStore()

const modalOpen = ref(false)
const editTx = ref<Transaction | null>(null)
const defaultType = ref<'INCOME' | 'EXPENSE'>('INCOME')
const period = ref<'current' | 'last'>('current')
const saving = ref(false)

const dateRange = computed(() => {
  const now = new Date()
  if (period.value === 'current') return { startDate: startOfMonth(now), endDate: endOfMonth(now) }
  const last = subMonths(now, 1)
  return { startDate: startOfMonth(last), endDate: endOfMonth(last) }
})

const currentYear = new Date().getFullYear()

const { data: financialData, refetch: refetchFinancial } = useQuery<FinancialResponse>({
  key: computed(() => `financial-${period.value}`),
  queryFn: () =>
    api
      .get('/financial', {
        params: {
          startDate: dateRange.value.startDate.toISOString(),
          endDate: dateRange.value.endDate.toISOString(),
        },
      })
      .then(r => r.data),
})

const { data: monthlyDataRaw, refetch: refetchMonthly } = useQuery<MonthlyData[]>({
  key: `financial-monthly-${currentYear}`,
  queryFn: () =>
    api.get('/financial/monthly', { params: { year: currentYear } }).then(r => r.data),
})
const monthlyData = computed<MonthlyData[]>(() => monthlyDataRaw.value ?? [])

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

const chartData = computed(() =>
  monthlyData.value.map(d => ({ name: MONTH_NAMES[d.month - 1], income: d.income, expense: d.expense }))
)
const chartMax = computed(() =>
  Math.max(1, ...monthlyData.value.flatMap(d => [d.income, d.expense]))
)

const summary = computed(() => financialData.value?.summary)

const summaryCards = computed(() => [
  {
    icon: TrendingUp,
    label: 'Receitas',
    value: summary.value?.income ?? 0,
    color: 'text-emerald-600',
    iconBg: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
  },
  {
    icon: TrendingDown,
    label: 'Despesas',
    value: summary.value?.expense ?? 0,
    color: 'text-red-600',
    iconBg: 'bg-gradient-to-br from-red-400 to-red-600',
  },
  {
    icon: DollarSign,
    label: 'Saldo',
    value: summary.value?.balance ?? 0,
    color: (summary.value?.balance ?? 0) >= 0 ? 'text-primary-600' : 'text-red-600',
    iconBg: 'bg-gradient-to-br from-primary-500 to-primary-700',
  },
  {
    icon: Clock,
    label: 'Pendentes',
    value: summary.value?.pending ?? 0,
    color: 'text-amber-600',
    iconBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
  },
])

const periodOptions: Array<{ key: 'current' | 'last'; label: string }> = [
  { key: 'current', label: 'Mês Atual' },
  { key: 'last', label: 'Mês Anterior' },
]

const recentTransactions = computed(() => (financialData.value?.transactions ?? []).slice(0, 8))

function handleNew(type: 'INCOME' | 'EXPENSE' = 'INCOME') {
  editTx.value = null
  defaultType.value = type
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
    await Promise.all([refetchFinancial(), refetchMonthly()])
    toast.success(editTx.value ? 'Transação atualizada!' : 'Transação adicionada!')
    closeModal()
  } catch {
    toast.error('Erro ao salvar transação')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Resumo Financeiro" :subtitle="`${format(dateRange.startDate, 'MMM yyyy')} — visão geral do período`">
      <template #actions>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" @click="handleNew('EXPENSE')">
            <ArrowUpRight class="w-4 h-4 rotate-90" />
            Lançar Repasse
          </button>
          <button class="btn-primary" @click="handleNew('INCOME')">
            <Plus class="w-4 h-4" />
            Nova Transação
          </button>
        </div>
      </template>
    </PageHeader>

    <!-- Period toggle -->
    <div class="card py-3">
      <div class="seg-control">
        <button
          v-for="opt in periodOptions"
          :key="opt.key"
          class="seg-btn px-4"
          :class="{ active: period === opt.key }"
          @click="period = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div v-for="card in summaryCards" :key="card.label" class="card-hover">
        <div class="flex items-start gap-4">
          <div :class="['w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm', card.iconBg]">
            <component :is="card.icon" class="w-5 h-5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">{{ card.label }}</p>
            <p :class="['text-2xl font-bold mt-1 leading-none', card.color]">{{ currency(card.value) }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Annual chart -->
    <div class="card">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-primary-100 rounded-xl flex items-center justify-center">
            <BarChart3 class="w-4 h-4 text-primary-600" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-900">Visão Anual {{ currentYear }}</h2>
            <p class="text-xs text-slate-400">Receitas vs Despesas por mês</p>
          </div>
        </div>
      </div>

      <!-- Simplified CSS bar chart (recharts is not available in the Vue app) -->
      <div class="flex items-end gap-1.5 sm:gap-3 h-52">
        <div v-for="item in chartData" :key="item.name" class="flex-1 flex flex-col items-center gap-2 min-w-0 h-full justify-end">
          <div class="flex items-end justify-center gap-1 flex-1 w-full">
            <div
              class="w-2.5 sm:w-3 rounded-t-md bg-emerald-500 transition-all duration-700"
              :style="{ height: `${pct(item.income, chartMax)}%` }"
              :title="`Receitas: ${currency(item.income)}`"
            />
            <div
              class="w-2.5 sm:w-3 rounded-t-md bg-red-400 transition-all duration-700"
              :style="{ height: `${pct(item.expense, chartMax)}%` }"
              :title="`Despesas: ${currency(item.expense)}`"
            />
          </div>
          <span class="text-[11px] text-slate-400">{{ item.name }}</span>
        </div>
      </div>
      <div class="flex items-center justify-center gap-5 mt-4 text-xs text-slate-500">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500" />Receitas</span>
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-400" />Despesas</span>
      </div>
    </div>

    <!-- Recent transactions -->
    <div v-if="recentTransactions.length > 0" class="card p-0 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100">
        <h2 class="font-semibold text-slate-900">Transações Recentes</h2>
        <p class="text-xs text-slate-400 mt-0.5">Últimas {{ recentTransactions.length }} movimentações do período</p>
      </div>
      <div class="divide-y divide-slate-50">
        <div v-for="tx in recentTransactions" :key="tx.id" class="flex items-center gap-4 px-6 py-3 hover:bg-slate-50/60 transition-colors">
          <div :class="['w-2 h-2 rounded-full flex-shrink-0', tx.type === 'INCOME' ? 'bg-emerald-500' : 'bg-red-500']" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-900 truncate">{{ tx.description }}</p>
            <p v-if="tx.category" class="text-xs text-slate-400">{{ tx.category }}</p>
          </div>
          <div class="text-right flex-shrink-0">
            <p :class="['text-sm font-bold tabular-nums', tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600']">
              {{ tx.type === 'INCOME' ? '+' : '−' }}{{ currency(tx.amount) }}
            </p>
            <p class="text-xs text-slate-400">{{ format(new Date(tx.date), 'dd/MM') }}</p>
          </div>
          <span
            :class="['status-badge text-xs flex-shrink-0',
              tx.status === 'PAID'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : tx.status === 'PENDING'
                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200']"
          >
            {{ tx.status === 'PAID' ? 'Pago' : tx.status === 'PENDING' ? 'Pendente' : 'Cancelado' }}
          </span>
        </div>
      </div>
    </div>

    <Modal
      :is-open="modalOpen"
      :title="editTx ? 'Editar Transação' : defaultType === 'INCOME' ? 'Nova Receita' : 'Lançar Repasse'"
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
