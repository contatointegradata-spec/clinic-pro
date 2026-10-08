<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Plus, Trash2, Package } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useAuthStore } from '../../stores/auth'
import {
  type AestheticApplication, FACE_AREAS, FACE_MAP_POINTS, APPLICATION_UNITS, PRODUCT_SUGGESTIONS,
  dayLabel, todayInput,
} from '../../lib/clinical'

const props = defineProps<{ patientId: string }>()

interface StockProduct { id: string; name: string; unit: string; quantity: number; active: boolean }

const auth = useAuthStore()
const canEdit = computed(() => auth.user?.role !== 'SECRETARY')

const apps = ref<AestheticApplication[]>([])
const products = ref<StockProduct[]>([])
const loading = ref(true)
const saving = ref(false)
const highlightArea = ref<string | null>(null)

const form = reactive({
  area: '',
  product: '',
  productId: '',
  quantity: '' as string | number,
  unit: 'U',
  lot: '',
  technique: '',
  notes: '',
  date: todayInput(),
  stockQty: 0,
})

async function load() {
  loading.value = true
  try {
    const [a, p] = await Promise.all([
      api.get<AestheticApplication[]>(`/clinical/patients/${props.patientId}/applications`),
      canEdit.value ? api.get<StockProduct[]>('/stock/products').catch(() => ({ data: [] as StockProduct[] })) : Promise.resolve({ data: [] as StockProduct[] }),
    ])
    apps.value = a.data
    products.value = p.data.filter(x => x.active)
  } catch {
    toast.error('Não foi possível carregar o mapa de aplicação')
  } finally {
    loading.value = false
  }
}
load()

const selectedProduct = computed(() => products.value.find(p => p.id === form.productId))

function onPickStock() {
  const p = selectedProduct.value
  if (p) {
    form.product = p.name
    form.stockQty = 1
  } else {
    form.stockQty = 0
  }
}

// Áreas já tratadas → bolinhas no desenho do rosto.
const areaCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const a of apps.value) counts[a.area] = (counts[a.area] ?? 0) + 1
  return counts
})
const mapMarkers = computed(() =>
  Object.entries(areaCounts.value)
    .filter(([area]) => FACE_MAP_POINTS[area])
    .map(([area, count]) => ({ area, count, ...FACE_MAP_POINTS[area] })),
)
const otherAreas = computed(() => Object.entries(areaCounts.value).filter(([area]) => !FACE_MAP_POINTS[area]))

const visibleApps = computed(() => (highlightArea.value ? apps.value.filter(a => a.area === highlightArea.value) : apps.value))

function pickArea(area: string) {
  form.area = area
  highlightArea.value = highlightArea.value === area ? null : area
}

async function save() {
  if (!form.area || !form.product) {
    toast.error('Informe a área e o produto')
    return
  }
  saving.value = true
  try {
    const { data } = await api.post<AestheticApplication>(`/clinical/patients/${props.patientId}/applications`, {
      area: form.area,
      product: form.product,
      productId: form.productId || null,
      quantity: form.quantity === '' ? null : Number(form.quantity),
      unit: form.unit || null,
      lot: form.lot || null,
      technique: form.technique || null,
      notes: form.notes || null,
      date: form.date,
      stockQty: form.productId ? form.stockQty : 0,
    })
    apps.value = [data, ...apps.value]
    if (form.productId && form.stockQty > 0) {
      const p = selectedProduct.value
      if (p) p.quantity -= form.stockQty
    }
    toast.success('Aplicação registrada')
    Object.assign(form, { area: '', quantity: '', lot: form.lot, technique: '', notes: '', stockQty: form.productId ? 1 : 0 })
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar')
  } finally {
    saving.value = false
  }
}

async function remove(a: AestheticApplication) {
  if (!confirm('Excluir este registro de aplicação? A baixa no estoque não é desfeita.')) return
  try {
    await api.delete(`/clinical/applications/${a.id}`)
    apps.value = apps.value.filter(x => x.id !== a.id)
  } catch {
    toast.error('Não foi possível excluir')
  }
}

function qty(a: AestheticApplication) {
  if (a.quantity == null) return '—'
  return `${a.quantity.toLocaleString('pt-BR')} ${a.unit ?? ''}`.trim()
}
</script>

<template>
  <div class="grid lg:grid-cols-[minmax(0,320px)_1fr] gap-5">
    <!-- Mapa facial -->
    <div class="card">
      <h3 class="font-display text-lg font-semibold text-slate-900">Mapa facial</h3>
      <p class="text-sm text-slate-500 mb-4">Toque em uma área para filtrar o histórico e preencher o formulário.</p>
      <div class="relative mx-auto w-full max-w-[260px] aspect-[3/4]">
        <svg viewBox="0 0 300 400" class="absolute inset-0 w-full h-full" aria-hidden="true">
          <defs>
            <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#F6EDE5" />
              <stop offset="100%" stop-color="#E8D5C4" />
            </linearGradient>
          </defs>
          <path d="M150 22 C 82 22 52 80 54 150 C 56 205 64 250 88 292 C 110 330 130 352 150 356 C 170 352 190 330 212 292 C 236 250 244 205 246 150 C 248 80 218 22 150 22 Z" fill="url(#skin)" stroke="#C9A68A" stroke-width="2" />
          <path d="M84 118 Q 108 104 132 116" fill="none" stroke="#957157" stroke-width="3" stroke-linecap="round" />
          <path d="M168 116 Q 192 104 216 118" fill="none" stroke="#957157" stroke-width="3" stroke-linecap="round" />
          <ellipse cx="108" cy="150" rx="18" ry="8" fill="#FFFFFF" stroke="#957157" stroke-width="2" />
          <ellipse cx="192" cy="150" rx="18" ry="8" fill="#FFFFFF" stroke="#957157" stroke-width="2" />
          <circle cx="108" cy="150" r="4" fill="#48423E" />
          <circle cx="192" cy="150" r="4" fill="#48423E" />
          <path d="M150 150 L 142 212 Q 150 220 158 212" fill="none" stroke="#B38B6D" stroke-width="2.5" stroke-linecap="round" />
          <path d="M120 262 Q 150 250 180 262 Q 150 286 120 262 Z" fill="#DFAEB5" stroke="#B76E79" stroke-width="2" />
          <path d="M120 262 Q 150 268 180 262" fill="none" stroke="#B76E79" stroke-width="1.5" />
        </svg>
        <button
          v-for="m in mapMarkers" :key="m.area" type="button"
          :style="{ left: `${m.x}%`, top: `${m.y}%` }"
          :class="['absolute -translate-x-1/2 -translate-y-1/2 min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white transition-transform hover:scale-110', highlightArea === m.area ? 'bg-primary-700 scale-110' : 'bg-primary-500']"
          :title="`${m.area}: ${m.count} aplicação(ões)`"
          @click="pickArea(m.area)"
        >{{ m.count }}</button>
      </div>
      <div class="mt-4 flex flex-wrap gap-1.5">
        <button
          v-for="area in FACE_AREAS" :key="area" type="button"
          :class="['text-xs px-2.5 py-1 rounded-full border transition-colors', highlightArea === area ? 'bg-primary-600 text-white border-primary-600' : areaCounts[area] ? 'bg-primary-50 text-primary-800 border-primary-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50']"
          @click="pickArea(area)"
        >
          {{ area }}<span v-if="areaCounts[area]" class="ml-1 opacity-75">· {{ areaCounts[area] }}</span>
        </button>
      </div>
      <p v-if="otherAreas.length" class="mt-3 text-xs text-slate-500">
        Outras áreas: {{ otherAreas.map(([a, c]) => `${a} (${c})`).join(', ') }}
      </p>
    </div>

    <div class="space-y-5 min-w-0">
      <!-- Novo registro -->
      <form v-if="canEdit" class="card space-y-4" @submit.prevent="save">
        <h3 class="font-semibold text-slate-900">Registrar aplicação</h3>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Área</label>
            <input v-model="form.area" list="face-areas" class="input-field" placeholder="Ex.: Glabela" />
            <datalist id="face-areas"><option v-for="a in FACE_AREAS" :key="a" :value="a" /></datalist>
          </div>
          <div>
            <label class="label">Data</label>
            <input v-model="form.date" type="date" class="input-field" />
          </div>
          <div v-if="products.length" class="sm:col-span-2">
            <label class="label">Produto do estoque <span class="text-slate-400 font-normal">(opcional)</span></label>
            <select v-model="form.productId" class="input-field" @change="onPickStock">
              <option value="">— Não vincular ao estoque —</option>
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} · {{ p.quantity }} {{ p.unit }} em estoque</option>
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="label">Produto</label>
            <input v-model="form.product" list="product-suggestions" class="input-field" placeholder="Ex.: Toxina botulínica (marca)" />
            <datalist id="product-suggestions"><option v-for="p in PRODUCT_SUGGESTIONS" :key="p" :value="p" /></datalist>
          </div>
          <div class="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label class="label">Quantidade</label>
              <input v-model="form.quantity" type="number" min="0" step="0.1" class="input-field" placeholder="Ex.: 20" />
            </div>
            <div>
              <label class="label">Unidade</label>
              <select v-model="form.unit" class="input-field w-28">
                <option v-for="u in APPLICATION_UNITS" :key="u" :value="u">{{ u }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="label">Lote</label>
            <input v-model="form.lot" class="input-field" placeholder="Lote / validade" />
          </div>
          <div class="sm:col-span-2">
            <label class="label">Técnica</label>
            <input v-model="form.technique" class="input-field" placeholder="Ex.: 5 pontos, cânula 22G, retroinjeção" />
          </div>
          <div class="sm:col-span-2">
            <label class="label">Observações</label>
            <textarea v-model="form.notes" rows="2" class="input-field" placeholder="Intercorrências, orientações, retorno…" />
          </div>
          <div v-if="selectedProduct" class="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
            <Package class="w-4 h-4 text-slate-500" />
            <span class="text-sm text-slate-700">Baixar do estoque</span>
            <input v-model.number="form.stockQty" type="number" min="0" :max="selectedProduct.quantity" class="input-field w-24 py-1.5" />
            <span class="text-sm text-slate-500">{{ selectedProduct.unit }} (disponível: {{ selectedProduct.quantity }})</span>
          </div>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn-primary" :disabled="saving"><Plus class="w-4 h-4" /> {{ saving ? 'Salvando…' : 'Registrar' }}</button>
        </div>
      </form>

      <!-- Histórico -->
      <div class="card">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 class="font-semibold text-slate-900">Histórico de aplicações</h3>
          <button v-if="highlightArea" class="text-xs font-semibold text-primary-700 hover:underline" @click="highlightArea = null">Mostrar todas as áreas</button>
        </div>
        <div v-if="loading" class="h-24 skeleton" />
        <p v-else-if="visibleApps.length === 0" class="text-sm text-slate-500">Nenhuma aplicação registrada{{ highlightArea ? ` em ${highlightArea}` : '' }}.</p>
        <div v-else class="table-responsive">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200">
                <th class="table-head-cell">Data</th>
                <th class="table-head-cell">Área</th>
                <th class="table-head-cell">Produto</th>
                <th class="table-head-cell">Qtd.</th>
                <th class="table-head-cell">Lote</th>
                <th class="table-head-cell">Técnica / obs.</th>
                <th class="table-head-cell" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in visibleApps" :key="a.id" class="table-row">
                <td class="table-cell tabular-nums whitespace-nowrap">{{ dayLabel(a.date) }}</td>
                <td class="table-cell font-medium">{{ a.area }}</td>
                <td class="table-cell">{{ a.product }}</td>
                <td class="table-cell tabular-nums whitespace-nowrap">{{ qty(a) }}</td>
                <td class="table-cell text-slate-500">{{ a.lot || '—' }}</td>
                <td class="table-cell text-slate-500 max-w-[16rem]">
                  <span class="block truncate">{{ [a.technique, a.notes].filter(Boolean).join(' · ') || '—' }}</span>
                </td>
                <td class="table-cell text-right">
                  <button v-if="canEdit" class="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Excluir" @click="remove(a)"><Trash2 class="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
