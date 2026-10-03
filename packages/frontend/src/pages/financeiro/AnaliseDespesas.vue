<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { TrendingDown, Tag, AlertTriangle } from 'lucide-vue-next'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import type { FinancialResponse } from '../../types'
import { useQuery } from '../../composables/useQuery'

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#84cc16']

function pct(value: number, max: number) {
  return max > 0 ? Math.round((value / max) * 100) : 0
}

interface CategoryGroup {
  category: string
  total: number
  count: number
}

const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

const { data: financialDataRaw, isLoading } = useQuery<FinancialResponse>({
  key: computed(() => `financial-analise-despesas-${startDate.value}-${endDate.value}`),
  queryFn: () =>
    api
      .get('/financial', {
        params: {
          startDate: new Date(startDate.value).toISOString(),
          endDate: new Date(endDate.value + 'T23:59:59').toISOString(),
          type: 'EXPENSE',
        },
      })
      .then(r => r.data),
})

const expenses = computed(() => financialDataRaw.value?.transactions ?? [])
const totalExpense = computed(() => financialDataRaw.value?.summary?.expense ?? 0)

// Group by category
const categoryList = computed<CategoryGroup[]>(() => {
  const byCategory = expenses.value.reduce<Record<string, CategoryGroup>>((acc, tx) => {
    const cat = tx.category ?? 'Sem categoria'
    if (!acc[cat]) acc[cat] = { category: cat, total: 0, count: 0 }
    acc[cat].total += tx.amount
    acc[cat].count += 1
    return acc
  }, {})
  return Object.values(byCategory).sort((a, b) => b.total - a.total)
})

const biggestCat = computed(() => categoryList.value[0])

// Top largest individual expenses
const topExpenses = computed(() => [...expenses.value].sort((a, b) => b.amount - a.amount).slice(0, 5))

// ── Simplified CSS bar lists (recharts is not available in the Vue app; see Resumo.vue) ──

const categoryBars = computed(() => {
  const list = categoryList.value
  const max = list[0]?.total ?? 0
  const total = list.reduce((s, c) => s + c.total, 0)
  return list.slice(0, 8).map((cat, i) => ({
    key: cat.category,
    label: cat.category,
    value: cat.total,
    pct: pct(cat.total, max),
    color: COLORS[i % COLORS.length],
    sub: total > 0 ? `${cat.count} lançamento${cat.count !== 1 ? 's' : ''} · ${Math.round((cat.total / total) * 100)}% do total` : '',
  }))
})
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Análise de Despesas" subtitle="Distribuição e concentração das despesas por categoria" />

    <!-- Date filter -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-slate-600 font-medium">Período:</span>
        <input v-model="startDate" type="date" class="input-field py-2 text-sm" />
        <span class="text-slate-400 text-sm">até</span>
        <input v-model="endDate" type="date" class="input-field py-2 text-sm" />
      </div>
    </div>

    <div v-if="isLoading" class="py-20 flex items-center justify-center">
      <div class="w-8 h-8 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
    </div>

    <template v-else>
      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center flex-shrink-0">
              <TrendingDown class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Total Despesas</p>
              <p class="text-xl font-bold text-red-600 mt-1">{{ currency(totalExpense) }}</p>
            </div>
          </div>
        </div>
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center flex-shrink-0">
              <Tag class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Maior Categoria</p>
              <p class="text-sm font-bold text-orange-700 mt-1 truncate">{{ biggestCat?.category ?? '—' }}</p>
              <p v-if="biggestCat" class="text-xs text-slate-400">{{ currency(biggestCat.total) }}</p>
            </div>
          </div>
        </div>
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center flex-shrink-0">
              <AlertTriangle class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Total de Lançamentos</p>
              <p class="text-xl font-bold text-slate-700 mt-1">{{ expenses.length }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Bars by category -->
        <div class="card">
          <div class="flex items-center gap-2 mb-5">
            <div class="w-8 h-8 bg-red-100 rounded-xl flex items-center justify-center">
              <TrendingDown class="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-slate-900">Despesas por Categoria</h3>
              <p class="text-xs text-slate-400">Top 8 categorias</p>
            </div>
          </div>
          <div v-if="categoryBars.length === 0" class="py-10 text-center">
            <p class="text-slate-400 text-sm">Sem despesas no período</p>
          </div>
          <div v-else class="space-y-3">
            <div v-for="bar in categoryBars" :key="bar.key">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
                <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
              </div>
              <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                <div class="h-full rounded-full transition-all duration-700" :style="{ width: `${bar.pct}%`, backgroundColor: bar.color }" />
              </div>
            </div>
          </div>
        </div>

        <!-- Distribution -->
        <div class="card">
          <div class="flex items-center gap-2 mb-5">
            <div class="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
              <Tag class="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-slate-900">Distribuição por Categoria</h3>
              <p class="text-xs text-slate-400">Proporção do total de despesas</p>
            </div>
          </div>
          <div v-if="categoryBars.length === 0" class="py-10 text-center">
            <p class="text-slate-400 text-sm">Sem dados no período</p>
          </div>
          <div v-else class="space-y-3">
            <div v-for="bar in categoryBars" :key="bar.key">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-700 font-medium truncate max-w-[60%] flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: bar.color }" />
                  {{ bar.label }}
                </span>
                <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
              </div>
              <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                <div class="h-full rounded-full transition-all duration-700" :style="{ width: `${bar.pct}%`, backgroundColor: bar.color }" />
              </div>
              <p class="text-xs text-slate-400 mt-0.5">{{ bar.sub }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Top individual expenses -->
      <div v-if="topExpenses.length > 0" class="card p-0 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-100">
          <h3 class="font-semibold text-slate-900">Maiores Despesas do Período</h3>
          <p class="text-xs text-slate-400 mt-0.5">Top 5 lançamentos individuais</p>
        </div>
        <div class="divide-y divide-slate-50">
          <div v-for="(tx, i) in topExpenses" :key="tx.id" class="flex items-center gap-4 px-6 py-3">
            <span class="w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
              {{ i + 1 }}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-900 truncate">{{ tx.description }}</p>
              <p class="text-xs text-slate-400">
                {{ format(new Date(tx.date), 'dd/MM/yyyy', { locale: ptBR }) }}
                <template v-if="tx.category"> · {{ tx.category }}</template>
              </p>
            </div>
            <p class="text-sm font-bold text-red-600 tabular-nums flex-shrink-0">−{{ currency(tx.amount) }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
