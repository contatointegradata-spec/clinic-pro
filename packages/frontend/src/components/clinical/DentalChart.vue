<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Trash2, Plus, History } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'
import { useAuthStore } from '../../stores/auth'
import {
  type DentalChartEntry, PERMANENT_UPPER, PERMANENT_LOWER, DECIDUOUS_UPPER, DECIDUOUS_LOWER,
  DENTAL_FACES, DENTAL_CONDITIONS, DENTAL_STATUS, dayLabel, todayInput,
} from '../../lib/clinical'

// compact: só o desenho (Visão geral da ficha) — sem planejados e histórico.
const props = defineProps<{ patientId: string; compact?: boolean }>()

const auth = useAuthStore()
const canEdit = computed(() => auth.user?.role !== 'SECRETARY')

const entries = ref<DentalChartEntry[]>([])
const loading = ref(true)
const dentition = ref<'permanente' | 'decidua'>('permanente')

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<DentalChartEntry[]>(`/clinical/patients/${props.patientId}/dental-chart`)
    entries.value = data
  } catch {
    toast.error('Não foi possível carregar o odontograma')
  } finally {
    loading.value = false
  }
}
load()

const upper = computed(() => (dentition.value === 'permanente' ? PERMANENT_UPPER : DECIDUOUS_UPPER))
const lower = computed(() => (dentition.value === 'permanente' ? PERMANENT_LOWER : DECIDUOUS_LOWER))

// Estado atual de cada dente: para cada face, o registro mais recente que a
// inclui; para o dente inteiro, o registro mais recente de condição "dente
// inteiro" (ausente, implante, coroa…). `entries` já vem do mais novo ao mais antigo.
interface ToothState { faces: Record<string, DentalChartEntry>; whole?: DentalChartEntry; count: number }
const toothStates = computed(() => {
  const map: Record<string, ToothState> = {}
  for (const e of entries.value) {
    const st = (map[e.tooth] ??= { faces: {}, count: 0 })
    st.count++
    const isWhole = DENTAL_CONDITIONS[e.condition]?.wholeTooth || e.faces.length === 0
    if (isWhole) {
      if (!st.whole) st.whole = e
    } else {
      for (const f of e.faces) if (!st.faces[f]) st.faces[f] = e
    }
  }
  return map
})

// Quadrantes 1, 4, 5 e 8 ficam à esquerda da tela: a face mesial (voltada à
// linha média) fica à direita do desenho; nos demais, à esquerda.
function sideFaces(tooth: string): { left: string; right: string } {
  const q = tooth[0]
  return ['1', '4', '5', '8'].includes(q) ? { left: 'D', right: 'M' } : { left: 'M', right: 'D' }
}
function isUpper(tooth: string) {
  return ['1', '2', '5', '6'].includes(tooth[0])
}
function faceAt(tooth: string, pos: 'top' | 'bottom' | 'left' | 'right' | 'center'): string {
  if (pos === 'center') return 'O'
  if (pos === 'left' || pos === 'right') return sideFaces(tooth)[pos]
  // Superiores: vestibular em cima; inferiores: vestibular embaixo.
  if (pos === 'top') return isUpper(tooth) ? 'V' : 'L'
  return isUpper(tooth) ? 'L' : 'V'
}

const FACE_POLYGONS: Record<'top' | 'bottom' | 'left' | 'right' | 'center', string> = {
  top: '0,0 40,0 28,12 12,12',
  bottom: '12,28 28,28 40,40 0,40',
  left: '0,0 12,12 12,28 0,40',
  right: '40,0 40,40 28,28 28,12',
  center: '12,12 28,12 28,28 12,28',
}

function faceFill(tooth: string, pos: keyof typeof FACE_POLYGONS): string {
  const st = toothStates.value[tooth]
  const entry = st?.faces[faceAt(tooth, pos)]
  if (!entry) return '#FFFFFF'
  return DENTAL_CONDITIONS[entry.condition]?.fill ?? '#FFFFFF'
}
function faceOpacity(tooth: string, pos: keyof typeof FACE_POLYGONS): number {
  const entry = toothStates.value[tooth]?.faces[faceAt(tooth, pos)]
  return entry?.status === 'PLANEJADO' ? 0.45 : 1
}
function wholeOf(tooth: string) {
  return toothStates.value[tooth]?.whole
}

// ─── Edição ────────────────────────────────────────────────────────────────
const selectedTooth = ref<string | null>(null)
const saving = ref(false)
const form = reactive({
  faces: [] as string[],
  condition: 'CARIE',
  status: 'EXISTENTE' as DentalChartEntry['status'],
  notes: '',
  date: todayInput(),
})

const toothHistory = computed(() => entries.value.filter(e => e.tooth === selectedTooth.value))
const selectedIsWhole = computed(() => !!DENTAL_CONDITIONS[form.condition]?.wholeTooth)

function openTooth(tooth: string) {
  selectedTooth.value = tooth
  form.faces = []
  form.condition = 'CARIE'
  form.status = 'EXISTENTE'
  form.notes = ''
  form.date = todayInput()
}

function toggleFace(f: string) {
  form.faces = form.faces.includes(f) ? form.faces.filter(x => x !== f) : [...form.faces, f]
}

async function save() {
  if (!selectedTooth.value) return
  if (!selectedIsWhole.value && form.faces.length === 0 && form.condition !== 'HIGIDO') {
    toast.error('Selecione ao menos uma face do dente')
    return
  }
  saving.value = true
  try {
    const { data } = await api.post<DentalChartEntry>(`/clinical/patients/${props.patientId}/dental-chart`, {
      tooth: selectedTooth.value,
      faces: selectedIsWhole.value ? [] : form.faces,
      condition: form.condition,
      status: form.status,
      notes: form.notes || null,
      date: form.date,
    })
    entries.value = [data, ...entries.value]
    toast.success(`Dente ${selectedTooth.value} atualizado`)
    form.faces = []
    form.notes = ''
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

async function remove(entry: DentalChartEntry) {
  if (!confirm('Excluir este registro do odontograma?')) return
  try {
    await api.delete(`/clinical/dental-chart/${entry.id}`)
    entries.value = entries.value.filter(e => e.id !== entry.id)
  } catch {
    toast.error('Não foi possível excluir')
  }
}

async function markDone(entry: DentalChartEntry) {
  try {
    const { data } = await api.put<DentalChartEntry>(`/clinical/dental-chart/${entry.id}`, { status: 'REALIZADO' })
    entries.value = entries.value.map(e => (e.id === entry.id ? data : e))
    toast.success('Procedimento marcado como realizado')
  } catch {
    toast.error('Não foi possível atualizar')
  }
}

const planned = computed(() => entries.value.filter(e => e.status === 'PLANEJADO'))
const legend = Object.entries(DENTAL_CONDITIONS).filter(([k]) => k !== 'HIGIDO')
function facesLabel(e: DentalChartEntry) {
  return e.faces.length ? e.faces.join(', ') : 'Dente inteiro'
}
</script>

<template>
  <div class="space-y-5">
    <div class="card">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h3 class="font-display text-lg font-semibold text-slate-900">Odontograma</h3>
          <p class="text-sm text-slate-500">Clique em um dente para registrar condições e procedimentos.</p>
        </div>
        <div class="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
          <button
            v-for="d in (['permanente', 'decidua'] as const)" :key="d"
            :class="['px-3 py-1.5 rounded-lg font-medium transition-colors', dentition === d ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700']"
            @click="dentition = d"
          >
            {{ d === 'permanente' ? 'Permanente' : 'Decídua' }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="h-48 skeleton" />
      <div v-else class="overflow-x-auto -mx-2 px-2 pb-2">
        <div class="w-max mx-auto space-y-6">
          <div v-for="(row, ri) in [upper, lower]" :key="ri">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{{ ri === 0 ? 'Superior' : 'Inferior' }}</p>
            <div :class="['flex justify-center', compact ? 'gap-0.5' : 'gap-1.5']">
              <button
                v-for="(t, ti) in row" :key="t"
                type="button"
                :class="[
                  'group flex flex-col items-center gap-1 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                  compact ? 'p-0.5' : 'p-1',
                  ti === row.length / 2 ? (compact ? 'ml-2' : 'ml-3') : '',
                  selectedTooth === t ? 'bg-primary-50' : 'hover:bg-slate-50',
                ]"
                :aria-label="`Dente ${t}`"
                @click="openTooth(t)"
              >
                <span v-if="ri === 0" class="text-[11px] font-semibold text-slate-500 tabular-nums">{{ t }}</span>
                <svg viewBox="-2 -2 44 44" :class="compact ? 'w-7 h-7' : 'w-9 h-9'">
                  <g :opacity="wholeOf(t)?.condition === 'AUSENTE' ? 0.35 : 1">
                    <polygon
                      v-for="(pts, pos) in FACE_POLYGONS" :key="pos"
                      :points="pts"
                      :fill="faceFill(t, pos)"
                      :fill-opacity="faceOpacity(t, pos)"
                      stroke="#A99D93" stroke-width="1"
                    />
                  </g>
                  <template v-if="wholeOf(t)">
                    <line v-if="['AUSENTE', 'EXTRACAO_INDICADA'].includes(wholeOf(t)!.condition)" x1="-1" y1="-1" x2="41" y2="41" :stroke="DENTAL_CONDITIONS[wholeOf(t)!.condition].fill === '#E8E0D8' ? '#7D736C' : DENTAL_CONDITIONS[wholeOf(t)!.condition].fill" stroke-width="3" />
                    <line v-if="['AUSENTE', 'EXTRACAO_INDICADA'].includes(wholeOf(t)!.condition)" x1="41" y1="-1" x2="-1" y2="41" :stroke="DENTAL_CONDITIONS[wholeOf(t)!.condition].fill === '#E8E0D8' ? '#7D736C' : DENTAL_CONDITIONS[wholeOf(t)!.condition].fill" stroke-width="3" />
                    <rect
                      v-else x="-1.5" y="-1.5" width="43" height="43" rx="4" fill="none"
                      :stroke="DENTAL_CONDITIONS[wholeOf(t)!.condition]?.fill"
                      stroke-width="3.5"
                      :stroke-dasharray="wholeOf(t)!.status === 'PLANEJADO' ? '5 3' : undefined"
                    />
                  </template>
                </svg>
                <span v-if="ri === 1" class="text-[11px] font-semibold text-slate-500 tabular-nums">{{ t }}</span>
                <span v-if="toothStates[t]?.count" class="w-1.5 h-1.5 rounded-full bg-primary-400" aria-hidden="true" />
                <span v-else class="w-1.5 h-1.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2">
        <span v-for="[key, c] in legend" :key="key" class="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span class="w-3 h-3 rounded-sm border border-slate-300" :style="{ background: c.fill }" />
          {{ c.label }}
        </span>
        <span class="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span class="w-3 h-3 rounded-sm border border-dashed border-slate-400 bg-slate-100" />
          Tracejado/claro = planejado
        </span>
      </div>
    </div>

    <!-- Planejados -->
    <div v-if="!compact" class="card">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="font-semibold text-slate-900">Procedimentos planejados</h3>
        <span class="text-xs text-slate-400">{{ planned.length }} pendente(s)</span>
      </div>
      <p v-if="planned.length === 0" class="text-sm text-slate-500">Nenhum procedimento planejado. Marque o status "Planejado" ao registrar um dente.</p>
      <ul v-else class="divide-y divide-slate-100">
        <li v-for="e in planned" :key="e.id" class="py-2.5 flex flex-wrap items-center gap-3">
          <span class="w-10 text-sm font-bold text-slate-700 tabular-nums">{{ e.tooth }}</span>
          <span :class="['text-xs font-semibold px-2 py-0.5 rounded-full border', DENTAL_CONDITIONS[e.condition]?.chip]">{{ DENTAL_CONDITIONS[e.condition]?.label ?? e.condition }}</span>
          <span class="text-xs text-slate-500">{{ facesLabel(e) }}</span>
          <span v-if="e.notes" class="text-xs text-slate-400 truncate max-w-[16rem]">{{ e.notes }}</span>
          <button v-if="canEdit" class="ml-auto text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg px-2.5 py-1" @click="markDone(e)">Marcar realizado</button>
        </li>
      </ul>
    </div>

    <!-- Histórico completo -->
    <div v-if="!compact" class="card">
      <h3 class="font-semibold text-slate-900 mb-3 flex items-center gap-2"><History class="w-4 h-4 text-slate-400" /> Histórico</h3>
      <p v-if="entries.length === 0 && !loading" class="text-sm text-slate-500">Nenhum registro ainda.</p>
      <div v-else class="table-responsive">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="table-head-cell">Data</th>
              <th class="table-head-cell">Dente</th>
              <th class="table-head-cell">Condição</th>
              <th class="table-head-cell">Faces</th>
              <th class="table-head-cell">Status</th>
              <th class="table-head-cell">Observações</th>
              <th class="table-head-cell" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in entries" :key="e.id" class="table-row">
              <td class="table-cell tabular-nums whitespace-nowrap">{{ dayLabel(e.date) }}</td>
              <td class="table-cell font-semibold tabular-nums">{{ e.tooth }}</td>
              <td class="table-cell">{{ DENTAL_CONDITIONS[e.condition]?.label ?? e.condition }}</td>
              <td class="table-cell text-slate-500">{{ facesLabel(e) }}</td>
              <td class="table-cell"><span :class="['text-xs font-semibold px-2 py-0.5 rounded-full', DENTAL_STATUS[e.status].chip]">{{ DENTAL_STATUS[e.status].label }}</span></td>
              <td class="table-cell text-slate-500 max-w-[18rem] truncate">{{ e.notes || '—' }}</td>
              <td class="table-cell text-right">
                <button v-if="canEdit" class="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Excluir" @click="remove(e)"><Trash2 class="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :is-open="!!selectedTooth" :title="`Dente ${selectedTooth ?? ''}`" subtitle="Registrar condição ou procedimento" size="lg" @close="selectedTooth = null">
      <div class="space-y-5">
        <form v-if="canEdit" class="space-y-4" @submit.prevent="save">
          <div>
            <label class="label">Condição / procedimento</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="(c, key) in DENTAL_CONDITIONS" :key="key" type="button"
                :class="['inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all', form.condition === key ? 'ring-2 ring-primary-400 border-primary-300 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50']"
                @click="form.condition = key"
              >
                <span class="w-2.5 h-2.5 rounded-sm border border-slate-300" :style="{ background: c.fill }" />
                {{ c.label }}
              </button>
            </div>
          </div>

          <div v-if="!selectedIsWhole">
            <label class="label">Faces</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="f in DENTAL_FACES" :key="f.key" type="button"
                :class="['px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors', form.faces.includes(f.key) ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50']"
                @click="toggleFace(f.key)"
              >
                {{ f.key }} <span class="text-xs opacity-75">· {{ f.label }}</span>
              </button>
            </div>
          </div>
          <p v-else class="text-xs text-slate-500">Esta condição vale para o dente inteiro.</p>

          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="label">Status</label>
              <select v-model="form.status" class="input-field">
                <option value="EXISTENTE">Existente (já estava assim)</option>
                <option value="PLANEJADO">Planejado (a fazer)</option>
                <option value="REALIZADO">Realizado (feito aqui)</option>
              </select>
            </div>
            <div>
              <label class="label">Data</label>
              <input v-model="form.date" type="date" class="input-field" />
            </div>
          </div>
          <div>
            <label class="label">Observações</label>
            <textarea v-model="form.notes" rows="2" class="input-field" placeholder="Material, profundidade, sensibilidade…" />
          </div>
          <div class="flex justify-end">
            <button type="submit" class="btn-primary" :disabled="saving"><Plus class="w-4 h-4" /> {{ saving ? 'Salvando…' : 'Adicionar registro' }}</button>
          </div>
        </form>
        <p v-else class="text-sm text-slate-500">Somente o profissional pode alterar o odontograma.</p>

        <div>
          <p class="text-sm font-semibold text-slate-700 mb-2">Histórico deste dente</p>
          <p v-if="toothHistory.length === 0" class="text-sm text-slate-400">Sem registros.</p>
          <ul v-else class="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            <li v-for="e in toothHistory" :key="e.id" class="px-3 py-2.5 flex flex-wrap items-center gap-2 text-sm">
              <span class="text-slate-400 tabular-nums text-xs w-20">{{ dayLabel(e.date) }}</span>
              <span class="font-medium text-slate-700">{{ DENTAL_CONDITIONS[e.condition]?.label ?? e.condition }}</span>
              <span class="text-xs text-slate-500">{{ facesLabel(e) }}</span>
              <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', DENTAL_STATUS[e.status].chip]">{{ DENTAL_STATUS[e.status].label }}</span>
              <button v-if="canEdit" class="ml-auto p-1 text-slate-300 hover:text-red-500" title="Excluir" @click="remove(e)"><Trash2 class="w-3.5 h-3.5" /></button>
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  </div>
</template>
