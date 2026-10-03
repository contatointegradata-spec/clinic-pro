<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { TrendingUp, MapPin, Tag, HeartPulse, Calculator } from 'lucide-vue-next'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import type { FinancialAnalytics } from '../../types'
import { useQuery } from '../../composables/useQuery'

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16']

function pct(value: number, max: number) {
  return max > 0 ? Math.round((value / max) * 100) : 0
}

const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

const { data: analyticsRaw, isLoading } = useQuery<FinancialAnalytics>({
  key: computed(() => `financial-analytics-${startDate.value}-${endDate.value}`),
  queryFn: () =>
    api
      .get('/financial/analytics', {
        params: {
          startDate: new Date(startDate.value).toISOString(),
          endDate: new Date(endDate.value + 'T23:59:59').toISOString(),
        },
      })
      .then(r => r.data),
})
const analytics = computed(() => analyticsRaw.value)

const totalIncome = computed(() => (analytics.value ? analytics.value.byType.reduce((s, t) => s + t.total, 0) : 0))

const topCategory = computed(() => analytics.value?.byType[0])

const avgPerConsultation = computed(() => {
  const a = analytics.value
  if (!a || a.byType.length === 0) return 0
  return totalIncome.value / a.byType.reduce((s, t) => s + t.count, 0)
})

// ── Simplified CSS bar lists (recharts is not available in the Vue app; see Resumo.vue) ──

const byTypeBars = computed(() => {
  const items = analytics.value?.byType ?? []
  const max = items[0]?.total ?? 0
  return items.slice(0, 6).map((item, i) => ({
    key: item.type ?? `type-${i}`,
    label: item.type ?? 'Sem tipo',
    value: item.total,
    pct: pct(item.total, max),
    color: COLORS[i % COLORS.length],
    sub: `${item.count} atendimento${item.count !== 1 ? 's' : ''} · ticket médio ${currency(item.total / Math.max(item.count, 1))}`,
  }))
})

const byHealthPlanBars = computed(() => {
  const items = analytics.value?.byHealthPlan ?? []
  const total = items.reduce((s, p) => s + p.total, 0)
  const max = Math.max(...items.map(p => p.total), 0)
  return items.slice(0, 6).map((item, i) => ({
    key: item.id,
    label: item.name,
    value: item.total,
    pct: pct(item.total, max),
    color: COLORS[i % COLORS.length],
    sub: total > 0 ? `${Math.round((item.total / total) * 100)}% do total` : '',
  }))
})

const byRoomBars = computed(() => {
  const items = analytics.value?.byRoom ?? []
  const max = Math.max(...items.map(r => r.total), 0)
  return items.slice(0, 8).map((item, i) => ({
    key: item.id,
    label: item.name,
    value: item.total,
    pct: pct(item.total, max),
    color: COLORS[i % COLORS.length],
    sub: `${item.count} atendimento${item.count !== 1 ? 's' : ''}`,
  }))
})
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Análise de Receitas" subtitle="Distribuição e performance das receitas por categoria, sala e plano" />

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
      <div class="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>

    <template v-else>
      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center flex-shrink-0">
              <TrendingUp class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Total do Período</p>
              <p class="text-xl font-bold text-emerald-600 mt-1">{{ currency(totalIncome) }}</p>
            </div>
          </div>
        </div>
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0">
              <Calculator class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Ticket Médio</p>
              <p class="text-xl font-bold text-primary-600 mt-1">{{ currency(avgPerConsultation) }}</p>
            </div>
          </div>
        </div>
        <div class="card-hover">
          <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Tag class="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase tracking-wide font-medium">Top Categoria</p>
              <p class="text-sm font-bold text-violet-700 mt-1 truncate">{{ topCategory?.type ?? '—' }}</p>
              <p v-if="topCategory" class="text-xs text-slate-400">{{ currency(topCategory.total) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- By type -->
        <div class="card">
          <div class="flex items-center gap-2 mb-5">
            <div class="w-8 h-8 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Tag class="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-slate-900">Por Tipo de Atendimento</h3>
              <p class="text-xs text-slate-400">Receita por procedimento / consulta</p>
            </div>
          </div>
          <div v-if="byTypeBars.length === 0" class="py-10 text-center">
            <p class="text-slate-400 text-sm">Sem dados no período</p>
          </div>
          <div v-else class="space-y-3">
            <div v-for="bar in byTypeBars" :key="bar.key">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
                <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
              </div>
              <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                <div class="h-full rounded-full transition-all duration-700" :style="{ width: `${bar.pct}%`, backgroundColor: bar.color }" />
              </div>
              <p class="text-xs text-slate-400 mt-0.5">{{ bar.sub }}</p>
            </div>
          </div>
        </div>

        <!-- By health plan -->
        <div class="card">
          <div class="flex items-center gap-2 mb-5">
            <div class="w-8 h-8 bg-rose-100 rounded-xl flex items-center justify-center">
              <HeartPulse class="w-4 h-4 text-rose-600" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-slate-900">Por Plano de Saúde</h3>
              <p class="text-xs text-slate-400">Particular vs. Convênios</p>
            </div>
          </div>
          <div v-if="byHealthPlanBars.length === 0" class="py-10 text-center">
            <p class="text-slate-400 text-sm">Sem dados no período</p>
          </div>
          <div v-else class="space-y-3">
            <div v-for="bar in byHealthPlanBars" :key="bar.key">
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

      <!-- By room -->
      <div v-if="byRoomBars.length > 0" class="card">
        <div class="flex items-center gap-2 mb-5">
          <div class="w-8 h-8 bg-primary-100 rounded-xl flex items-center justify-center">
            <MapPin class="w-4 h-4 text-primary-600" />
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Por Local de Atendimento</h3>
            <p class="text-xs text-slate-400">Receita por sala / consultório</p>
          </div>
        </div>
        <div class="space-y-3">
          <div v-for="bar in byRoomBars" :key="bar.key">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
              <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div class="h-full rounded-full transition-all duration-700" :style="{ width: `${bar.pct}%`, backgroundColor: bar.color }" />
            </div>
            <p class="text-xs text-slate-400 mt-0.5">{{ bar.sub }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
