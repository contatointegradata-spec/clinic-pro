<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { Camera, Trash2, Columns2, X, ImagePlus, Loader2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'
import {
  type PatientPhoto, PHOTO_CATEGORIES, FACE_AREAS, prepareClinicalPhoto, dayLabel, todayInput,
} from '../../lib/clinical'

const props = defineProps<{ patientId: string }>()

const photos = ref<PatientPhoto[]>([])
const loading = ref(true)
const uploading = ref(0)
const filterCategory = ref<'' | PatientPhoto['category']>('')
const filterArea = ref('')

const uploadForm = reactive({
  category: 'ANTES' as PatientPhoto['category'],
  area: '',
  procedure: '',
  takenAt: todayInput(),
})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<PatientPhoto[]>(`/clinical/patients/${props.patientId}/photos`)
    photos.value = data
  } catch {
    toast.error('Não foi possível carregar as fotos')
  } finally {
    loading.value = false
  }
}
load()

const fileInput = ref<HTMLInputElement | null>(null)

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  for (const file of files) {
    uploading.value++
    try {
      const prepared = await prepareClinicalPhoto(file)
      const { data } = await api.post<PatientPhoto>(`/clinical/patients/${props.patientId}/photos`, {
        ...prepared,
        category: uploadForm.category,
        area: uploadForm.area || null,
        procedure: uploadForm.procedure || null,
        takenAt: uploadForm.takenAt,
      })
      photos.value = [data, ...photos.value].sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || `Falha ao enviar ${file.name}`)
    } finally {
      uploading.value--
    }
  }
  if (files.length) toast.success(files.length === 1 ? 'Foto adicionada' : `${files.length} fotos adicionadas`)
}

const areas = computed(() => [...new Set(photos.value.map(p => p.area).filter(Boolean) as string[])].sort())
const filtered = computed(() => photos.value.filter(p =>
  (!filterCategory.value || p.category === filterCategory.value) && (!filterArea.value || p.area === filterArea.value),
))
const grouped = computed(() => {
  const groups: Array<{ day: string; items: PatientPhoto[] }> = []
  for (const p of filtered.value) {
    const day = dayLabel(p.takenAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(p)
    else groups.push({ day, items: [p] })
  }
  return groups
})

// ─── Visualização e comparação ─────────────────────────────────────────────
const fullCache = new Map<string, string>()
async function fullImage(id: string): Promise<string> {
  const cached = fullCache.get(id)
  if (cached) return cached
  const { data } = await api.get<{ imageUrl: string }>(`/clinical/photos/${id}`)
  fullCache.set(id, data.imageUrl)
  return data.imageUrl
}

const viewing = ref<PatientPhoto | null>(null)
const viewingUrl = ref('')
async function openPhoto(p: PatientPhoto) {
  if (compareMode.value) { toggleCompare(p); return }
  viewing.value = p
  viewingUrl.value = p.thumbnailUrl
  try { viewingUrl.value = await fullImage(p.id) } catch { toast.error('Não foi possível abrir a foto') }
}

const compareMode = ref(false)
const compareIds = ref<string[]>([])
function toggleCompare(p: PatientPhoto) {
  if (compareIds.value.includes(p.id)) compareIds.value = compareIds.value.filter(id => id !== p.id)
  else compareIds.value = [...compareIds.value, p.id].slice(-2)
}
function startCompare() {
  compareMode.value = !compareMode.value
  compareIds.value = []
}

const comparing = ref(false)
const compareUrls = ref<[string, string]>(['', ''])
const comparePhotos = computed(() => {
  // Mais antiga à esquerda (antes), mais recente à direita (depois).
  // Na mesma data, desempata pelo momento (antes → durante → depois).
  const order = { ANTES: 0, DURANTE: 1, DEPOIS: 2, OUTRO: 3 }
  const sel = photos.value.filter(p => compareIds.value.includes(p.id))
  return sel.sort((a, b) =>
    a.takenAt.localeCompare(b.takenAt) || order[a.category] - order[b.category] || a.createdAt.localeCompare(b.createdAt))
})
const sliderPos = ref(50)
const compareView = ref<'slider' | 'lado'>('slider')
async function openCompare() {
  if (comparePhotos.value.length !== 2) return
  const [a, b] = comparePhotos.value
  compareUrls.value = [a.thumbnailUrl, b.thumbnailUrl]
  sliderPos.value = 50
  comparing.value = true
  try {
    compareUrls.value = [await fullImage(a.id), await fullImage(b.id)]
  } catch {
    toast.error('Não foi possível carregar as fotos em alta resolução')
  }
}

async function remove(p: PatientPhoto) {
  if (!confirm('Excluir esta foto definitivamente?')) return
  try {
    await api.delete(`/clinical/photos/${p.id}`)
    photos.value = photos.value.filter(x => x.id !== p.id)
    viewing.value = null
  } catch {
    toast.error('Não foi possível excluir')
  }
}

async function updateCategory(p: PatientPhoto, category: PatientPhoto['category']) {
  try {
    await api.put(`/clinical/photos/${p.id}`, { category })
    p.category = category
  } catch {
    toast.error('Não foi possível atualizar')
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- Envio -->
    <div class="card">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-display text-lg font-semibold text-slate-900">Fotos de antes e depois</h3>
          <p class="text-sm text-slate-500">As fotos são comprimidas no seu aparelho e ficam no prontuário da paciente.</p>
        </div>
        <button :class="['btn-secondary', compareMode && 'ring-2 ring-primary-300 border-primary-300 text-primary-700']" @click="startCompare">
          <Columns2 class="w-4 h-4" /> {{ compareMode ? 'Cancelar comparação' : 'Comparar fotos' }}
        </button>
      </div>
      <div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label class="label">Momento</label>
          <select v-model="uploadForm.category" class="input-field">
            <option v-for="(c, key) in PHOTO_CATEGORIES" :key="key" :value="key">{{ c.label }}</option>
          </select>
        </div>
        <div>
          <label class="label">Área / região</label>
          <input v-model="uploadForm.area" list="photo-areas" class="input-field" placeholder="Ex.: Lábios, Sorriso" />
          <datalist id="photo-areas"><option v-for="a in [...FACE_AREAS, 'Sorriso', 'Arcada superior', 'Arcada inferior', 'Perfil']" :key="a" :value="a" /></datalist>
        </div>
        <div>
          <label class="label">Procedimento</label>
          <input v-model="uploadForm.procedure" class="input-field" placeholder="Ex.: Preenchimento labial" />
        </div>
        <div>
          <label class="label">Data da foto</label>
          <input v-model="uploadForm.takenAt" type="date" class="input-field" />
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFiles" />
        <button class="btn-primary" :disabled="uploading > 0" @click="fileInput?.click()">
          <Loader2 v-if="uploading > 0" class="w-4 h-4 animate-spin" />
          <ImagePlus v-else class="w-4 h-4" />
          {{ uploading > 0 ? `Enviando ${uploading}…` : 'Adicionar fotos' }}
        </button>
        <span class="text-xs text-slate-400 flex items-center gap-1"><Camera class="w-3.5 h-3.5" /> No celular, abre a câmera ou a galeria.</span>
      </div>
    </div>

    <!-- Barra de comparação -->
    <div v-if="compareMode" class="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 flex flex-wrap items-center gap-3">
      <p class="text-sm text-primary-800 flex-1">Selecione <strong>duas fotos</strong> para comparar ({{ compareIds.length }}/2).</p>
      <button class="btn-primary" :disabled="compareIds.length !== 2" @click="openCompare"><Columns2 class="w-4 h-4" /> Comparar</button>
    </div>

    <!-- Filtros + galeria -->
    <div class="card">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <button
          v-for="opt in [{ key: '', label: 'Todas' }, ...Object.entries(PHOTO_CATEGORIES).map(([key, c]) => ({ key, label: c.label }))]" :key="opt.key"
          :class="['text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors', filterCategory === opt.key ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50']"
          @click="filterCategory = opt.key as typeof filterCategory"
        >{{ opt.label }}</button>
        <select v-if="areas.length" v-model="filterArea" class="input-field w-auto py-1.5 text-xs ml-auto">
          <option value="">Todas as áreas</option>
          <option v-for="a in areas" :key="a" :value="a">{{ a }}</option>
        </select>
      </div>

      <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-4 gap-3"><div v-for="i in 4" :key="i" class="aspect-square skeleton" /></div>
      <div v-else-if="filtered.length === 0" class="py-10 text-center">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><Camera class="w-6 h-6 text-primary-500" /></div>
        <p class="text-sm font-medium text-slate-700">Nenhuma foto ainda</p>
        <p class="text-xs text-slate-500 mt-1">Registre o "antes" na avaliação e o "depois" no retorno.</p>
      </div>
      <div v-else class="space-y-5">
        <div v-for="g in grouped" :key="g.day">
          <p class="text-xs font-semibold text-slate-500 mb-2">{{ g.day }}</p>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <button
              v-for="p in g.items" :key="p.id" type="button"
              :class="['group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400', compareIds.includes(p.id) ? 'ring-4 ring-primary-400 border-primary-400' : 'border-slate-200 hover:shadow-md']"
              @click="openPhoto(p)"
            >
              <img :src="p.thumbnailUrl" :alt="`${PHOTO_CATEGORIES[p.category].label}${p.area ? ' · ' + p.area : ''}`" class="w-full h-full object-cover" loading="lazy" />
              <span :class="['absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full', PHOTO_CATEGORIES[p.category].chip]">{{ PHOTO_CATEGORIES[p.category].label }}</span>
              <span v-if="compareIds.includes(p.id)" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">{{ compareIds.indexOf(p.id) + 1 }}</span>
              <span v-if="p.area || p.procedure" class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pt-5 pb-1.5 text-left text-[11px] text-white truncate">{{ [p.area, p.procedure].filter(Boolean).join(' · ') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Foto ampliada -->
    <Modal :is-open="!!viewing" :title="viewing ? `${PHOTO_CATEGORIES[viewing.category].label} · ${dayLabel(viewing.takenAt)}` : ''" :subtitle="viewing ? [viewing.area, viewing.procedure].filter(Boolean).join(' · ') : ''" size="xl" @close="viewing = null">
      <div v-if="viewing" class="space-y-4">
        <img :src="viewingUrl" alt="Foto clínica ampliada" class="w-full max-h-[70vh] object-contain rounded-xl bg-slate-900" />
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-slate-500">Momento:</span>
          <button
            v-for="(c, key) in PHOTO_CATEGORIES" :key="key"
            :class="['text-xs font-semibold px-2.5 py-1 rounded-full', viewing.category === key ? c.chip + ' ring-2 ring-offset-1 ring-primary-300' : 'bg-slate-100 text-slate-500 hover:bg-slate-200']"
            @click="updateCategory(viewing, key)"
          >{{ c.label }}</button>
          <button class="ml-auto btn-secondary text-red-600 hover:text-red-700" @click="remove(viewing)"><Trash2 class="w-4 h-4" /> Excluir</button>
        </div>
      </div>
    </Modal>

    <!-- Comparação -->
    <Modal :is-open="comparing" title="Antes e depois" :subtitle="comparePhotos.length === 2 ? `${dayLabel(comparePhotos[0].takenAt)} → ${dayLabel(comparePhotos[1].takenAt)}` : ''" size="xl" @close="comparing = false">
      <div v-if="comparePhotos.length === 2" class="space-y-4">
        <div class="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
          <button v-for="v in (['slider', 'lado'] as const)" :key="v" :class="['px-3 py-1.5 rounded-lg font-medium', compareView === v ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500']" @click="compareView = v">
            {{ v === 'slider' ? 'Deslizar' : 'Lado a lado' }}
          </button>
        </div>
        <div v-if="compareView === 'slider'" class="relative w-full overflow-hidden rounded-xl bg-slate-900 select-none" style="aspect-ratio: 3 / 4; max-height: 70vh">
          <img :src="compareUrls[1]" alt="Depois" class="absolute inset-0 w-full h-full object-contain" />
          <div class="absolute inset-0 overflow-hidden" :style="{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }">
            <img :src="compareUrls[0]" alt="Antes" class="absolute inset-0 w-full h-full object-contain bg-slate-900" />
          </div>
          <div class="absolute inset-y-0 w-0.5 bg-white shadow" :style="{ left: `${sliderPos}%` }" />
          <span class="absolute top-3 left-3 text-xs font-bold bg-white/90 text-slate-800 px-2 py-1 rounded-full">Antes · {{ dayLabel(comparePhotos[0].takenAt) }}</span>
          <span class="absolute top-3 right-3 text-xs font-bold bg-white/90 text-slate-800 px-2 py-1 rounded-full">Depois · {{ dayLabel(comparePhotos[1].takenAt) }}</span>
          <input v-model.number="sliderPos" type="range" min="0" max="100" class="absolute inset-x-6 bottom-4 accent-primary-500" aria-label="Deslizar comparação" />
        </div>
        <div v-else class="grid grid-cols-2 gap-3">
          <figure v-for="(p, i) in comparePhotos" :key="p.id" class="space-y-1.5">
            <img :src="compareUrls[i]" :alt="i === 0 ? 'Antes' : 'Depois'" class="w-full max-h-[65vh] object-contain rounded-xl bg-slate-900" />
            <figcaption class="text-xs text-slate-500 text-center">{{ i === 0 ? 'Antes' : 'Depois' }} · {{ dayLabel(p.takenAt) }}</figcaption>
          </figure>
        </div>
        <div class="flex justify-end">
          <button class="btn-secondary" @click="comparing = false; compareMode = false; compareIds = []"><X class="w-4 h-4" /> Fechar</button>
        </div>
      </div>
    </Modal>
  </div>
</template>
