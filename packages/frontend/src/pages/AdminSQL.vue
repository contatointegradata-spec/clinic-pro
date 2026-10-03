<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { AxiosError } from 'axios'
import {
  Database, Play, Clock, CheckCircle, XCircle, History, AlertTriangle,
  Table2, Eye, Code2, Briefcase, ChevronRight, ChevronDown, RefreshCw,
  Search, Info,
} from 'lucide-vue-next'
import api from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useQuery } from '../composables/useQuery'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SQLResult {
  rows: Record<string, unknown>[]
  columns: string[]
  rowCount: number
  durationMs: number
}

interface SQLError {
  message: string
  durationMs?: number
}

interface HistoryEntry {
  id: string
  query: string
  rowCount: number | null
  durationMs: number | null
  success: boolean
  error: string | null
  createdAt: string
}

interface SchemaFunction {
  name: string
  type: string
}

interface SchemaData {
  tables: string[]
  views: string[]
  functions: SchemaFunction[]
}

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
}

// ─── Guard: ADMIN only (route guard also enforces this; kept as defense in depth) ──

const router = useRouter()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.user?.role === 'ADMIN')
if (!isAdmin.value) {
  router.replace('/dashboard')
}

// ─── Schema sidebar state ───────────────────────────────────────────────────────

const expandedSections = ref<Set<string>>(new Set(['tables']))
const expandedTables = ref<Set<string>>(new Set())
const tableColumns = ref<Record<string, ColumnInfo[]>>({})
const schemaSearch = ref('')

// Note: staleTime intentionally omitted here (unlike the original's 60s staleTime).
// This composable's staleTime gates *manual* refetch() calls too (not just
// auto-refetch-on-focus like react-query), so keeping it would make the
// "reload schema" button a no-op for 60s after the initial load.
const {
  data: schema,
  isLoading: schemaLoading,
  refetch: refetchSchema,
} = useQuery<SchemaData>({
  key: 'admin-sql-schema',
  queryFn: () => api.get('/admin/sql/schema').then(r => r.data),
})

function toggleSection(section: string) {
  const next = new Set(expandedSections.value)
  if (next.has(section)) next.delete(section)
  else next.add(section)
  expandedSections.value = next
}

async function handleTableExpand(tableName: string) {
  if (expandedTables.value.has(tableName)) {
    const next = new Set(expandedTables.value)
    next.delete(tableName)
    expandedTables.value = next
    return
  }
  if (!tableColumns.value[tableName]) {
    try {
      const res = await api.get(`/admin/sql/schema/${encodeURIComponent(tableName)}/columns`)
      tableColumns.value = { ...tableColumns.value, [tableName]: res.data }
    } catch {
      // ignore column fetch errors
    }
  }
  expandedTables.value = new Set(expandedTables.value).add(tableName)
}

function handleTableClick(tableName: string) {
  query.value = `SELECT * FROM "${tableName}" LIMIT 50;`
}

function handleViewClick(viewName: string) {
  query.value = `SELECT * FROM "${viewName}" LIMIT 50;`
}

function handleFunctionClick(fn: SchemaFunction) {
  query.value = `-- Function: ${fn.name}\nSELECT routine_definition FROM information_schema.routines WHERE routine_name = '${fn.name}';`
}

const schemaSearchLower = computed(() => schemaSearch.value.toLowerCase())
const filteredTables = computed(() => (schema.value?.tables ?? []).filter(t => t.toLowerCase().includes(schemaSearchLower.value)))
const filteredViews = computed(() => (schema.value?.views ?? []).filter(v => v.toLowerCase().includes(schemaSearchLower.value)))
const filteredFunctions = computed(() => (schema.value?.functions ?? []).filter(f => f.name.toLowerCase().includes(schemaSearchLower.value)))

function skeletonWidth(i: number): string {
  return `${50 + (i * 23) % 40}%`
}

// ─── Main editor / execute / history ───────────────────────────────────────────

const query = ref('')
const allowWrites = ref(false)
const historyOpen = ref(false)
const result = ref<SQLResult | null>(null)
const execError = ref<SQLError | null>(null)
const executing = ref(false)

const { data: historyData, isLoading: historyLoading, refetch: refetchHistory } = useQuery<HistoryEntry[]>({
  key: 'admin-sql-history',
  queryFn: () => api.get('/admin/sql/history').then(r => r.data),
})
const history = computed(() => historyData.value ?? [])

async function handleExecute() {
  const trimmed = query.value.trim()
  if (!trimmed) return
  executing.value = true
  try {
    const { data } = await api.post<SQLResult>('/admin/sql/execute', { query: trimmed, allowWrites: allowWrites.value })
    result.value = data
    execError.value = null
  } catch (err) {
    result.value = null
    const errData = (err as AxiosError<SQLError>).response?.data
    execError.value = errData ?? { message: 'Erro desconhecido ao executar query.' }
  } finally {
    executing.value = false
    // History is refreshed regardless of success/failure, mirroring the original
    // onSuccess/onError handlers which both invalidated the history query.
    refetchHistory()
  }
}

function handleKeyDown(e: KeyboardEvent) {
  // Ctrl+Enter or Cmd+Enter to execute
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    handleExecute()
  }
  // Tab inserts spaces instead of switching focus
  if (e.key === 'Tab') {
    e.preventDefault()
    const el = e.currentTarget as HTMLTextAreaElement
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = query.value.substring(0, start) + '  ' + query.value.substring(end)
    query.value = newVal
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2
    })
  }
}

function cellDisplay(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function isNullish(val: unknown): boolean {
  return val === null || val === undefined
}

function historyPreview(q: string): string {
  return q.length > 80 ? q.slice(0, 80) + '…' : q
}
</script>

<template>
  <div v-if="isAdmin" class="flex" style="height: calc(100vh - 64px)">

    <!-- ── Left Sidebar: Schema Explorer ── -->
    <div class="w-64 flex-shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-hidden">
      <!-- Fixed header -->
      <div class="flex-shrink-0 border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
        <Database class="w-4 h-4 text-violet-600 flex-shrink-0" />
        <span class="text-sm font-bold text-slate-900 flex-1">Schema</span>
        <button
          class="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
          :disabled="schemaLoading"
          title="Recarregar schema"
          @click="refetchSchema"
        >
          <RefreshCw class="w-3.5 h-3.5 text-slate-400" :class="schemaLoading ? 'animate-spin' : ''" />
        </button>
      </div>

      <!-- Search input -->
      <div class="flex-shrink-0 border-b border-slate-200 px-2 py-2">
        <div class="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1.5">
          <Search class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <input
            v-model="schemaSearch"
            type="text"
            placeholder="Filtrar..."
            class="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none min-w-0"
          />
          <button v-if="schemaSearch" class="text-slate-400 hover:text-slate-700 text-xs leading-none" @click="schemaSearch = ''">×</button>
        </div>
      </div>

      <!-- Scrollable sections -->
      <div class="flex-1 overflow-y-auto scrollbar-none">

        <!-- Tables -->
        <button class="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left" @click="toggleSection('tables')">
          <ChevronDown v-if="expandedSections.has('tables')" class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <ChevronRight v-else class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <Table2 class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span class="text-xs font-semibold text-slate-600 uppercase tracking-wider flex-1">Tabelas</span>
          <span class="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">{{ filteredTables.length }}</span>
        </button>
        <div v-if="expandedSections.has('tables')" class="pb-1">
          <template v-if="schemaLoading">
            <div v-for="i in 6" :key="i" class="flex items-center gap-2 px-3 py-1.5">
              <div class="w-3 h-3 rounded bg-slate-200 animate-pulse flex-shrink-0" />
              <div class="h-3 rounded bg-slate-200 animate-pulse" :style="{ width: skeletonWidth(i) }" />
            </div>
          </template>
          <p v-else-if="filteredTables.length === 0" class="px-3 py-2 text-xs text-slate-400 italic">Nenhuma tabela</p>
          <div v-else v-for="tableName in filteredTables" :key="tableName">
            <div class="flex items-center group hover:bg-slate-50 transition-colors">
              <button class="flex-shrink-0 pl-2 pr-1 py-1.5 text-slate-400 hover:text-slate-700" title="Expandir colunas" @click="handleTableExpand(tableName)">
                <ChevronDown v-if="expandedTables.has(tableName)" class="w-3 h-3" />
                <ChevronRight v-else class="w-3 h-3" />
              </button>
              <button
                class="flex-1 min-w-0 flex items-center gap-1.5 pr-2 py-1.5 text-left"
                :title="`SELECT * FROM &quot;${tableName}&quot; LIMIT 50;`"
                @click="handleTableClick(tableName)"
              >
                <Table2 class="w-3 h-3 text-slate-400 flex-shrink-0" />
                <span class="text-xs font-mono text-slate-700 group-hover:text-slate-900 truncate transition-colors">{{ tableName }}</span>
              </button>
            </div>
            <div v-if="expandedTables.has(tableName)" class="ml-3 border-l border-slate-200 pl-2 pb-1">
              <template v-if="tableColumns[tableName]">
                <div v-for="col in tableColumns[tableName]" :key="col.column_name" class="flex items-center gap-1.5 py-0.5 px-1">
                  <span class="text-xs font-mono text-slate-500 truncate flex-1">{{ col.column_name }}</span>
                  <span class="text-xs bg-slate-100 text-slate-500 px-1 py-0.5 rounded font-mono flex-shrink-0 max-w-[70px] truncate" :title="col.data_type">
                    {{ col.data_type }}
                  </span>
                </div>
              </template>
              <template v-else>
                <div v-for="i in 3" :key="i" class="flex items-center gap-2 px-3 py-1.5">
                  <div class="w-3 h-3 rounded bg-slate-200 animate-pulse flex-shrink-0" />
                  <div class="h-3 rounded bg-slate-200 animate-pulse" :style="{ width: skeletonWidth(i) }" />
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Views -->
        <button class="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left" @click="toggleSection('views')">
          <ChevronDown v-if="expandedSections.has('views')" class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <ChevronRight v-else class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <Eye class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span class="text-xs font-semibold text-slate-600 uppercase tracking-wider flex-1">Views</span>
          <span class="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">{{ filteredViews.length }}</span>
        </button>
        <div v-if="expandedSections.has('views')" class="pb-1">
          <template v-if="schemaLoading">
            <div v-for="i in 3" :key="i" class="flex items-center gap-2 px-3 py-1.5">
              <div class="w-3 h-3 rounded bg-slate-200 animate-pulse flex-shrink-0" />
              <div class="h-3 rounded bg-slate-200 animate-pulse" :style="{ width: skeletonWidth(i) }" />
            </div>
          </template>
          <p v-else-if="filteredViews.length === 0" class="px-3 py-2 text-xs text-slate-400 italic">Nenhuma view</p>
          <button
            v-else
            v-for="viewName in filteredViews"
            :key="viewName"
            class="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 transition-colors text-left group"
            :title="`SELECT * FROM &quot;${viewName}&quot; LIMIT 50;`"
            @click="handleViewClick(viewName)"
          >
            <Eye class="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span class="text-xs font-mono text-slate-600 group-hover:text-slate-900 truncate transition-colors">{{ viewName }}</span>
          </button>
        </div>

        <!-- Procedures / Functions -->
        <button class="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left" @click="toggleSection('procedures')">
          <ChevronDown v-if="expandedSections.has('procedures')" class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <ChevronRight v-else class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <Code2 class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span class="text-xs font-semibold text-slate-600 uppercase tracking-wider flex-1">Procedures</span>
          <span class="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">{{ filteredFunctions.length }}</span>
        </button>
        <div v-if="expandedSections.has('procedures')" class="pb-1">
          <template v-if="schemaLoading">
            <div v-for="i in 2" :key="i" class="flex items-center gap-2 px-3 py-1.5">
              <div class="w-3 h-3 rounded bg-slate-200 animate-pulse flex-shrink-0" />
              <div class="h-3 rounded bg-slate-200 animate-pulse" :style="{ width: skeletonWidth(i) }" />
            </div>
          </template>
          <p v-else-if="filteredFunctions.length === 0" class="px-3 py-2 text-xs text-slate-400 italic">Nenhuma function</p>
          <button
            v-else
            v-for="fn in filteredFunctions"
            :key="fn.name"
            class="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 transition-colors text-left group"
            :title="fn.name"
            @click="handleFunctionClick(fn)"
          >
            <Code2 class="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span class="text-xs font-mono text-slate-600 group-hover:text-slate-900 truncate transition-colors flex-1">{{ fn.name }}</span>
            <span class="text-xs text-slate-400 flex-shrink-0 uppercase">{{ fn.type === 'PROCEDURE' ? 'proc' : 'fn' }}</span>
          </button>
        </div>

        <!-- Jobs -->
        <button class="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left" @click="toggleSection('jobs')">
          <ChevronDown v-if="expandedSections.has('jobs')" class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <ChevronRight v-else class="w-3 h-3 text-slate-400 flex-shrink-0" />
          <Briefcase class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span class="text-xs font-semibold text-slate-600 uppercase tracking-wider flex-1">Jobs</span>
          <span class="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">0</span>
        </button>
        <div v-if="expandedSections.has('jobs')" class="px-3 py-3 flex items-start gap-2">
          <Info class="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-slate-400 leading-snug">Nenhum job configurado. Use pg_cron para agendar tarefas.</p>
        </div>

      </div>
    </div>

    <!-- ── Right Panel: Editor + Results + History ── -->
    <div class="flex-1 overflow-auto p-6 space-y-6">

      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <Database class="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h1 class="page-title">SQL Admin</h1>
          <p class="page-subtitle">Execute queries diretamente no banco de dados</p>
        </div>
      </div>

      <!-- Write-mode warning -->
      <div v-if="allowWrites" class="alert-danger">
        <AlertTriangle class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p class="font-medium">Modo escrita ativo — operações destrutivas serão executadas diretamente no banco</p>
      </div>

      <!-- Editor card -->
      <div class="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <!-- Editor header bar -->
        <div class="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center gap-3">
          <Database class="w-4 h-4 text-slate-400" />
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">SQL Editor</span>
          <span class="ml-auto text-xs text-slate-400">Ctrl+Enter para executar</span>
        </div>

        <!-- PostgreSQL tip -->
        <div class="border-b border-slate-200 px-4 py-2.5 bg-slate-50/60 flex items-start gap-2">
          <Info class="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-slate-500 leading-relaxed">
            Tabelas <span class="font-mono text-violet-600">TBL*</span> são auto-cotadas pelo servidor — escreva com ou sem aspas:
            <span class="font-mono text-emerald-700">SELECT * FROM TBLSALA</span>
            ou
            <span class="font-mono text-emerald-700">SELECT * FROM "TBLSALA"</span>
            · Clique na tabela na sidebar para gerar a query.
          </p>
        </div>

        <!-- Textarea -->
        <textarea
          v-model="query"
          spellcheck="false"
          placeholder='SELECT * FROM &quot;TBLUSUARIO&quot; LIMIT 10;'
          class="w-full bg-slate-900 text-slate-100 font-mono text-sm px-4 py-4 outline-none resize-vertical placeholder:text-slate-500 leading-relaxed"
          style="min-height: 160px"
          @keydown="handleKeyDown"
        />

        <!-- Editor footer / actions -->
        <div class="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-wrap items-center gap-4">
          <!-- Allow writes checkbox — the only safety gate before destructive queries run -->
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="allowWrites" type="checkbox" class="w-4 h-4 accent-red-500 cursor-pointer" />
            <span class="text-sm font-medium" :class="allowWrites ? 'text-red-600' : 'text-slate-500'">Permitir escrita</span>
          </label>

          <button
            class="ml-auto flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors"
            :disabled="executing || !query.trim()"
            @click="handleExecute"
          >
            <template v-if="executing">
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Executando...
            </template>
            <template v-else>
              <Play class="w-4 h-4" />
              Executar
            </template>
          </button>
        </div>
      </div>

      <!-- Error box -->
      <div v-if="execError" class="alert-danger">
        <XCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold mb-1">Erro na query</p>
          <pre class="text-xs whitespace-pre-wrap break-all font-mono">{{ execError.message }}</pre>
          <p v-if="execError.durationMs != null" class="text-xs mt-2 flex items-center gap-1 opacity-80">
            <Clock class="w-3 h-3" />
            {{ execError.durationMs }} ms
          </p>
        </div>
      </div>

      <!-- Results -->
      <div v-if="result" class="rounded-xl border border-slate-200 overflow-hidden">
        <!-- Results header -->
        <div class="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <CheckCircle class="w-4 h-4 text-emerald-600" />
            <span class="text-sm font-semibold text-emerald-700">Query executada com sucesso</span>
          </div>
          <div class="flex items-center gap-4 ml-auto text-xs text-slate-500">
            <span class="flex items-center gap-1">
              <Database class="w-3.5 h-3.5" />
              {{ result.rowCount }} {{ result.rowCount === 1 ? 'linha' : 'linhas' }}
            </span>
            <span class="flex items-center gap-1">
              <Clock class="w-3.5 h-3.5" />
              {{ result.durationMs }} ms
            </span>
          </div>
        </div>

        <!-- Table -->
        <div v-if="result.columns.length > 0" class="table-responsive">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200">
                <th v-for="col in result.columns" :key="col" class="table-head-cell whitespace-nowrap">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="result.rows.length === 0">
                <td :colspan="result.columns.length" class="px-4 py-6 text-center text-slate-400 italic">Nenhum resultado retornado</td>
              </tr>
              <tr v-for="(row, rowIdx) in result.rows" :key="rowIdx" :class="rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'">
                <td
                  v-for="col in result.columns"
                  :key="col"
                  class="px-4 py-2 font-mono whitespace-nowrap max-w-xs truncate"
                  :class="isNullish(row[col]) ? 'text-slate-400 italic' : 'text-slate-700'"
                  :title="cellDisplay(row[col])"
                >
                  {{ cellDisplay(row[col]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="px-4 py-4 text-sm text-slate-500 font-mono bg-white">
          {{ result.rowCount }} {{ result.rowCount === 1 ? 'linha afetada' : 'linhas afetadas' }}
        </div>
      </div>

      <!-- History -->
      <div class="rounded-xl border border-slate-200 overflow-hidden">
        <!-- History header (collapsible) -->
        <button class="w-full bg-slate-50 hover:bg-slate-100 transition-colors px-4 py-3 flex items-center gap-3 text-left" @click="historyOpen = !historyOpen">
          <History class="w-4 h-4 text-slate-400" />
          <span class="text-sm font-semibold text-slate-700">Histórico de queries</span>
          <span class="ml-auto flex items-center gap-2 text-xs text-slate-400">
            {{ history.length }} entr{{ history.length === 1 ? 'ada' : 'adas' }}
            <ChevronDown class="w-4 h-4 text-slate-400 transition-transform" :class="historyOpen ? 'rotate-180' : ''" />
          </span>
        </button>

        <div v-if="historyOpen" class="bg-white divide-y divide-slate-100">
          <div v-if="historyLoading" class="px-4 py-6 text-center text-slate-400 text-sm">Carregando histórico...</div>
          <div v-else-if="history.length === 0" class="px-4 py-6 text-center text-slate-400 text-sm">Nenhuma query executada ainda.</div>
          <button
            v-else
            v-for="entry in history"
            :key="entry.id"
            class="w-full px-4 py-3 flex flex-wrap items-start gap-3 text-left hover:bg-slate-50 transition-colors group"
            @click="query = entry.query"
          >
            <div class="flex-shrink-0 mt-0.5">
              <CheckCircle v-if="entry.success" class="w-3.5 h-3.5 text-emerald-600" />
              <XCircle v-else class="w-3.5 h-3.5 text-red-600" />
            </div>

            <span class="flex-1 min-w-0 font-mono text-xs text-slate-600 group-hover:text-slate-900 transition-colors truncate">
              {{ historyPreview(entry.query) }}
            </span>

            <div class="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0 ml-auto">
              <span v-if="entry.success" class="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-xs font-medium">OK</span>
              <span v-else class="bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-xs font-medium">ERRO</span>
              <span v-if="entry.rowCount != null" class="flex items-center gap-1">
                <Database class="w-3 h-3" />
                {{ entry.rowCount }}
              </span>
              <span v-if="entry.durationMs != null" class="flex items-center gap-1">
                <Clock class="w-3 h-3" />
                {{ entry.durationMs }} ms
              </span>
            </div>
          </button>
        </div>
      </div>

    </div>
  </div>
</template>
