<script setup lang="ts">
import { ref, computed } from 'vue'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import type {
  PaymentMethodAnalytics,
  HourAnalytics,
  DayOfWeekAnalytics,
  ConvenioAnalytics,
  ProcedureAnalytics,
  PatientAnalytics,
  RoomAnalytics,
  CourtesyAnalytics,
} from '../../types'
import { useQuery } from '../../composables/useQuery'

const CHART_COLORS = ['#0e7490', '#0891b2', '#06b6d4', '#22d3ee', '#67e8f9', '#a5f3fc', '#f97316', '#fb923c']

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function pct(value: number, max: number) {
  return max > 0 ? Math.round((value / max) * 100) : 0
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const startDate = ref(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
const endDate = ref(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

const params = computed(() => ({
  startDate: new Date(startDate.value).toISOString(),
  endDate: new Date(endDate.value + 'T23:59:59').toISOString(),
}))
const queryKeySuffix = computed(() => `${startDate.value}-${endDate.value}`)

const { data: byPaymentRaw, isLoading: loadingPayment } = useQuery<PaymentMethodAnalytics[]>({
  key: computed(() => `analytics-payment-method-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-payment-method', { params: params.value }).then(r => r.data),
})
const byPayment = computed(() => byPaymentRaw.value ?? [])

const { data: byHourRaw, isLoading: loadingHour } = useQuery<HourAnalytics[]>({
  key: computed(() => `analytics-by-hour-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-hour', { params: params.value }).then(r => r.data),
})
const byHour = computed(() => byHourRaw.value ?? [])

const { data: byDowRaw, isLoading: loadingDow } = useQuery<DayOfWeekAnalytics[]>({
  key: computed(() => `analytics-by-dow-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-day-of-week', { params: params.value }).then(r => r.data),
})
const byDow = computed(() => byDowRaw.value ?? [])

const { data: byConvenioRaw, isLoading: loadingConvenio } = useQuery<ConvenioAnalytics[]>({
  key: computed(() => `analytics-by-convenio-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-convenio', { params: params.value }).then(r => r.data),
})
const byConvenio = computed(() => byConvenioRaw.value ?? [])

const { data: byProcedureRaw, isLoading: loadingProcedure } = useQuery<ProcedureAnalytics[]>({
  key: computed(() => `analytics-by-procedure-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-procedure', { params: params.value }).then(r => r.data),
})
const byProcedure = computed(() => byProcedureRaw.value ?? [])

const { data: byPatientRaw, isLoading: loadingPatient } = useQuery<PatientAnalytics[]>({
  key: computed(() => `analytics-by-patient-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-patient', { params: params.value }).then(r => r.data),
})
const byPatient = computed(() => byPatientRaw.value ?? [])

const { data: byRoomRaw, isLoading: loadingRoom } = useQuery<RoomAnalytics[]>({
  key: computed(() => `analytics-by-room-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/by-room', { params: params.value }).then(r => r.data),
})
const byRoom = computed(() => byRoomRaw.value ?? [])

const { data: courtesies } = useQuery<CourtesyAnalytics>({
  key: computed(() => `analytics-courtesies-${queryKeySuffix.value}`),
  queryFn: () => api.get('/financial/analytics/courtesies', { params: params.value }).then(r => r.data),
})

const totalFaturado = computed(() => byPayment.value.reduce((s, r) => s + r.total, 0))
const totalTransacoes = computed(() => byPayment.value.reduce((s, r) => s + r.count, 0))
const ticketMedio = computed(() => (totalTransacoes.value > 0 ? totalFaturado.value / totalTransacoes.value : 0))

// ── Simplified CSS chart data (recharts is not available in the Vue app; see Resumo.vue) ──

// Pie → horizontal bar list with color dot + known percent from API
const paymentBars = computed(() =>
  byPayment.value.map((p, i) => ({
    key: p.method,
    label: p.method,
    value: p.total,
    pct: Math.round(p.percent),
    color: CHART_COLORS[i % CHART_COLORS.length],
    sub: `${p.count} transação${p.count !== 1 ? 'ões' : ''}`,
  }))
)

// Column bar charts → vertical CSS bars (categorical sequences, same pattern as Resumo.vue)
const maxHourTotal = computed(() => Math.max(1, ...byHour.value.map(h => h.total)))
const hourColumns = computed(() =>
  byHour.value.map(h => ({
    key: h.hour,
    label: h.label,
    value: h.total,
    heightPct: pct(h.total, maxHourTotal.value),
    isMax: h.total === maxHourTotal.value && h.total > 0,
  }))
)

const maxDowTotal = computed(() => Math.max(1, ...byDow.value.map(d => d.total)))
const dowColumns = computed(() =>
  byDow.value.map((d, i) => ({
    key: d.dayOfWeek,
    label: d.label,
    value: d.total,
    heightPct: pct(d.total, maxDowTotal.value),
    color: CHART_COLORS[i % 4],
  }))
)

// Horizontal bar charts → AnalyticsBar-style lists
const convenioBars = computed(() => {
  const list = byConvenio.value.slice(0, 8)
  const max = Math.max(1, ...list.map(c => c.total))
  return list.map(c => ({
    key: c.convenio,
    label: truncate(c.convenio, 24),
    value: c.total,
    pct: pct(c.total, max),
  }))
})

const procedureBars = computed(() => {
  const list = byProcedure.value.slice(0, 8)
  const max = Math.max(1, ...list.map(p => p.total))
  return list.map(p => ({
    key: p.procedure,
    label: truncate(p.procedure, 28),
    value: p.total,
    pct: pct(p.total, max),
  }))
})

const patientBars = computed(() => {
  const list = byPatient.value.slice(0, 8)
  const max = Math.max(1, ...list.map(p => p.total))
  return list.map(p => ({
    key: p.id,
    label: truncate(p.name, 24),
    value: p.total,
    pct: pct(p.total, max),
  }))
})

const roomBars = computed(() => {
  const list = byRoom.value.slice(0, 8)
  const max = Math.max(1, ...list.map(r => r.total))
  return list.map(r => ({
    key: r.id,
    label: truncate(r.name, 24),
    value: r.total,
    pct: pct(r.total, max),
  }))
})
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Análise Avançada" subtitle="Faturamento por forma de pagamento, horário, dia e procedimento" />

    <!-- Filtros -->
    <div class="card py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2">
          <label class="text-xs font-medium text-slate-600">De</label>
          <input v-model="startDate" type="date" class="input-field py-1.5 text-sm w-36" />
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs font-medium text-slate-600">Até</label>
          <input v-model="endDate" type="date" class="input-field py-1.5 text-sm w-36" />
        </div>
      </div>
    </div>

    <!-- KPI tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div class="card text-center">
        <p class="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Total faturado</p>
        <p class="text-xl font-bold text-slate-900">{{ currency(totalFaturado) }}</p>
      </div>
      <div class="card text-center">
        <p class="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Transações</p>
        <p class="text-xl font-bold text-slate-900">{{ totalTransacoes }}</p>
      </div>
      <div class="card text-center">
        <p class="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Ticket médio</p>
        <p class="text-xl font-bold text-slate-900">{{ currency(ticketMedio) }}</p>
      </div>
      <div class="card text-center">
        <p class="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Cortesias fechadas</p>
        <p class="text-xl font-bold text-slate-900">{{ courtesies?.count ?? 0 }}</p>
      </div>
    </div>

    <!-- Row 1: Forma de Pagamento + Hora do Dia -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Forma de Pagamento</h3>
        <div v-if="loadingPayment" class="h-[280px] skeleton" />
        <div v-else-if="paymentBars.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="space-y-3">
          <div v-for="bar in paymentBars" :key="bar.key">
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
            <p class="text-xs text-slate-400 mt-0.5">{{ bar.pct }}% · {{ bar.sub }}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Hora do Dia</h3>
        <div v-if="loadingHour" class="h-[280px] skeleton" />
        <div v-else-if="hourColumns.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="flex items-end gap-1 h-[240px]">
          <div v-for="col in hourColumns" :key="col.key" class="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full justify-end">
            <div class="flex items-end justify-center flex-1 w-full">
              <div
                class="w-full max-w-[14px] rounded-t-md transition-all duration-700"
                :class="col.isMax ? 'bg-primary-600' : 'bg-cyan-400'"
                :style="{ height: `${col.heightPct}%` }"
                :title="`${col.label}: ${currency(col.value)}`"
              />
            </div>
            <span class="text-[10px] text-slate-400 truncate w-full text-center">{{ col.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 2: Dia da Semana + Convênio -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Dia da Semana</h3>
        <div v-if="loadingDow" class="h-[280px] skeleton" />
        <div v-else-if="dowColumns.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="flex items-end gap-2 h-[240px]">
          <div v-for="col in dowColumns" :key="col.key" class="flex-1 flex flex-col items-center gap-1.5 min-w-0 h-full justify-end">
            <div class="flex items-end justify-center flex-1 w-full">
              <div
                class="w-full max-w-[36px] rounded-t-md transition-all duration-700"
                :style="{ height: `${col.heightPct}%`, backgroundColor: col.color }"
                :title="`${col.label}: ${currency(col.value)}`"
              />
            </div>
            <span class="text-[11px] text-slate-400 truncate w-full text-center">{{ col.label }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Convênio</h3>
        <div v-if="loadingConvenio" class="h-[280px] skeleton" />
        <div v-else-if="convenioBars.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="space-y-3">
          <div v-for="bar in convenioBars" :key="bar.key">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
              <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div class="h-full rounded-full bg-cyan-600 transition-all duration-700" :style="{ width: `${bar.pct}%` }" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 3: Procedimento (full width) -->
    <div class="card">
      <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Procedimento</h3>
      <div v-if="loadingProcedure" class="h-[280px] skeleton" />
      <div v-else-if="procedureBars.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
      <div v-else class="space-y-3">
        <div v-for="bar in procedureBars" :key="bar.key">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-700 font-medium truncate max-w-[70%]">{{ bar.label }}</span>
            <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
          </div>
          <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
            <div class="h-full rounded-full bg-primary-600 transition-all duration-700" :style="{ width: `${bar.pct}%` }" />
          </div>
        </div>
      </div>
    </div>

    <!-- Row 4: Paciente + Local -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Paciente</h3>
        <div v-if="loadingPatient" class="h-[280px] skeleton" />
        <div v-else-if="patientBars.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="space-y-3">
          <div v-for="bar in patientBars" :key="bar.key">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
              <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div class="h-full rounded-full bg-cyan-600 transition-all duration-700" :style="{ width: `${bar.pct}%` }" />
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="text-sm font-semibold text-slate-900 mb-4">Faturamento por Local</h3>
        <div v-if="loadingRoom" class="h-[280px] skeleton" />
        <div v-else-if="roomBars.length === 0" class="flex items-center justify-center h-[280px] text-slate-400 text-sm">Sem dados no período</div>
        <div v-else class="space-y-3">
          <div v-for="bar in roomBars" :key="bar.key">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-700 font-medium truncate max-w-[60%]">{{ bar.label }}</span>
              <span class="text-slate-500 tabular-nums font-semibold">{{ currency(bar.value) }}</span>
            </div>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div class="h-full rounded-full bg-cyan-400 transition-all duration-700" :style="{ width: `${bar.pct}%` }" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
