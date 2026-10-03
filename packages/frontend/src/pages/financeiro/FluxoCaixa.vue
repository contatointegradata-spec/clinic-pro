<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth, subDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { TrendingUp, TrendingDown, DollarSign, CalendarDays } from 'lucide-vue-next'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import { useQuery } from '../../composables/useQuery'

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

type PeriodPreset = 'month' | 'last30' | 'custom'
type Granularity = 'daily' | 'monthly'

interface CashFlowEntry {
  date: string
  income: number
  expense: number
  balance: number
  cumulativeBalance: number
}

interface CashFlowResponse {
  entries: CashFlowEntry[]
  totals: {
    income: number
    expense: number
    net: number
  }
}

const preset = ref<PeriodPreset>('month')
const granularity = ref<Granularity>('daily')
const customStart = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const customEnd = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

const presetOptions: Array<{ key: PeriodPreset; label: string }> = [
  { key: 'month', label: 'Este mês' },
  { key: 'last30', label: 'Últimos 30 dias' },
  { key: 'custom', label: 'Personalizado' },
]

const granularityOptions: Array<{ key: Granularity; label: string }> = [
  { key: 'daily', label: 'Diário' },
  { key: 'monthly', label: 'Mensal' },
]

const range = computed(() => {
  const now = new Date()
  if (preset.value === 'month') {
    return { start: startOfMonth(now), end: endOfMonth(now) }
  }
  if (preset.value === 'last30') {
    return { start: subDays(now, 30), end: now }
  }
  return { start: new Date(customStart.value), end: new Date(customEnd.value) }
})

const { data, isLoading } = useQuery<CashFlowResponse>({
  key: computed(() => `cash-flow-${preset.value}-${granularity.value}-${customStart.value}-${customEnd.value}`),
  queryFn: () =>
    api
      .get('/financial/cash-flow', {
        params: {
          startDate: range.value.start.toISOString(),
          endDate: range.value.end.toISOString(),
          period: granularity.value,
        },
      })
      .then(r => r.data),
})

const entries = computed(() => data.value?.entries ?? [])
const totals = computed(() => data.value?.totals)

function entryLabel(e: CashFlowEntry, short = true) {
  const d = new Date(e.date)
  if (granularity.value === 'daily') {
    return format(d, short ? 'dd/MM' : 'dd/MM/yyyy', { locale: ptBR })
  }
  return format(d, short ? 'MMM/yy' : 'MMMM yyyy', { locale: ptBR })
}

// Simplified CSS bar chart (recharts' AreaChart is not available in the Vue
// app) — income/expense/cumulative-balance bars sharing one scale, following
// the convention set in Resumo.vue's "Visão Anual" chart.
const chartMax = computed(() =>
  Math.max(
    1,
    ...entries.value.flatMap(e => [e.income, e.expense, Math.abs(e.cumulativeBalance)])
  )
)

function pct(value: number) {
  const max = chartMax.value
  return max > 0 ? Math.min((Math.abs(value) / max) * 100, 100) : 0
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Fluxo de Caixa" subtitle="Evolução de receitas, despesas e saldo ao longo do tempo" />

    <!-- Controls -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="seg-control">
          <button
            v-for="opt in presetOptions"
            :key="opt.key"
            class="seg-btn px-3"
            :class="{ active: preset === opt.key }"
            @click="preset = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>

        <div v-if="preset === 'custom'" class="flex items-center gap-2">
          <input v-model="customStart" type="date" class="input-field py-2 text-sm" />
          <span class="text-slate-400 text-sm">até</span>
          <input v-model="customEnd" type="date" class="input-field py-2 text-sm" />
        </div>

        <div class="ml-auto seg-control">
          <button
            v-for="opt in granularityOptions"
            :key="opt.key"
            class="seg-btn px-3"
            :class="{ active: granularity === opt.key }"
            @click="granularity = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm">
            <TrendingUp class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Receitas</p>
            <p class="text-xl font-bold text-emerald-600 mt-1 leading-none">{{ currency(totals?.income ?? 0) }}</p>
          </div>
        </div>
      </div>
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-red-400 to-red-600 shadow-sm">
            <TrendingDown class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Despesas</p>
            <p class="text-xl font-bold text-red-600 mt-1 leading-none">{{ currency(totals?.expense ?? 0) }}</p>
          </div>
        </div>
      </div>
      <div class="card-hover">
        <div class="flex items-start gap-4">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
            :class="(totals?.net ?? 0) >= 0 ? 'bg-gradient-to-br from-primary-500 to-primary-700' : 'bg-gradient-to-br from-red-400 to-red-600'"
          >
            <DollarSign class="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <p class="text-xs text-slate-500 font-medium uppercase tracking-wide">Resultado Líquido</p>
            <p class="text-xl font-bold mt-1 leading-none" :class="(totals?.net ?? 0) >= 0 ? 'text-primary-600' : 'text-red-600'">
              {{ currency(totals?.net ?? 0) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Chart -->
    <div class="card">
      <div class="flex items-center gap-2 mb-6">
        <div class="w-8 h-8 bg-primary-100 rounded-xl flex items-center justify-center">
          <CalendarDays class="w-4 h-4 text-primary-600" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-slate-900">Evolução do Fluxo de Caixa</h2>
          <p class="text-xs text-slate-400">
            {{ format(range.start, 'dd/MM/yyyy', { locale: ptBR }) }} — {{ format(range.end, 'dd/MM/yyyy', { locale: ptBR }) }}
          </p>
        </div>
      </div>

      <div v-if="isLoading" class="h-64 flex items-center justify-center">
        <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
      </div>
      <div v-else-if="entries.length === 0" class="h-64 flex items-center justify-center">
        <p class="text-slate-400 text-sm">Nenhum dado no período selecionado</p>
      </div>
      <template v-else>
        <div class="flex items-end gap-1 sm:gap-2 h-64 overflow-x-auto">
          <div
            v-for="(e, i) in entries"
            :key="i"
            class="flex-1 min-w-[10px] flex flex-col items-center gap-2 h-full justify-end"
          >
            <div class="flex items-end justify-center gap-0.5 flex-1 w-full">
              <div
                class="w-1.5 sm:w-2 rounded-t-sm bg-emerald-500 transition-all duration-700"
                :style="{ height: `${pct(e.income)}%` }"
                :title="`Receitas: ${currency(e.income)}`"
              />
              <div
                class="w-1.5 sm:w-2 rounded-t-sm bg-red-400 transition-all duration-700"
                :style="{ height: `${pct(e.expense)}%` }"
                :title="`Despesas: ${currency(e.expense)}`"
              />
              <div
                class="w-1.5 sm:w-2 rounded-t-sm transition-all duration-700"
                :class="e.cumulativeBalance >= 0 ? 'bg-primary-500' : 'bg-red-600'"
                :style="{ height: `${pct(e.cumulativeBalance)}%` }"
                :title="`Saldo acumulado: ${currency(e.cumulativeBalance)}`"
              />
            </div>
            <span class="text-[10px] text-slate-400 whitespace-nowrap">{{ entryLabel(e) }}</span>
          </div>
        </div>
        <div class="flex items-center justify-center gap-5 mt-4 text-xs text-slate-500">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500" />Receitas</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-400" />Despesas</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-primary-500" />Saldo acumulado</span>
        </div>
      </template>
    </div>

    <!-- Detail table -->
    <div v-if="entries.length > 0" class="card p-0 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100">
        <h2 class="font-semibold text-slate-900">Detalhamento por Período</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Período</th>
              <th class="table-head-cell text-right">Receitas</th>
              <th class="table-head-cell text-right">Despesas</th>
              <th class="table-head-cell text-right">Saldo do Período</th>
              <th class="table-head-cell text-right">Saldo Acumulado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in entries" :key="i" class="table-row">
              <td class="table-cell font-medium text-slate-700">{{ entryLabel(e, false) }}</td>
              <td class="table-cell text-right text-emerald-600 font-medium tabular-nums">{{ currency(e.income) }}</td>
              <td class="table-cell text-right text-red-600 font-medium tabular-nums">{{ currency(e.expense) }}</td>
              <td class="table-cell text-right font-semibold tabular-nums" :class="e.balance >= 0 ? 'text-primary-600' : 'text-red-600'">
                {{ currency(e.balance) }}
              </td>
              <td class="table-cell text-right font-bold tabular-nums" :class="e.cumulativeBalance >= 0 ? 'text-slate-900' : 'text-red-600'">
                {{ currency(e.cumulativeBalance) }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="bg-slate-50 border-t-2 border-slate-200">
              <td class="table-cell font-bold text-slate-900">Total</td>
              <td class="table-cell text-right font-bold text-emerald-600 tabular-nums">{{ currency(totals?.income ?? 0) }}</td>
              <td class="table-cell text-right font-bold text-red-600 tabular-nums">{{ currency(totals?.expense ?? 0) }}</td>
              <td class="table-cell text-right font-bold tabular-nums" :class="(totals?.net ?? 0) >= 0 ? 'text-primary-700' : 'text-red-700'">
                {{ currency(totals?.net ?? 0) }}
              </td>
              <td class="table-cell" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>
