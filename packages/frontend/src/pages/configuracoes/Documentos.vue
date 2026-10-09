<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { z } from 'zod'
import {
  Plus, Edit2, FileText, Upload, CheckCircle, XCircle, Download,
  Send, Search, User, Info, ChevronRight, Loader2, Bot,
} from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { DocumentTemplate, Patient } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

const DOC_TYPES = [
  { value: 'ATESTADO', label: 'Atestado Médico', icon: '📋', color: 'text-primary-700', bg: 'bg-primary-50' },
  { value: 'DECLARACAO', label: 'Declaração', icon: '📄', color: 'text-purple-700', bg: 'bg-purple-50' },
  { value: 'RECIBO', label: 'Recibo', icon: '🧾', color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { value: 'COMPROVANTE', label: 'Comprovante', icon: '✅', color: 'text-amber-700', bg: 'bg-amber-50' },
  { value: 'OUTROS', label: 'Outros', icon: '📁', color: 'text-slate-700', bg: 'bg-slate-50' },
] as const

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  type: z.enum(['ATESTADO', 'DECLARACAO', 'RECIBO', 'COMPROVANTE', 'OUTROS']),
  content: z.string(),
})

type FormData = z.infer<typeof schema>

// Variáveis fixas que podem ser inseridas manualmente no editor de template
const TEMPLATE_VARIABLES = [
  { key: '{{paciente}}', label: 'Nome do Paciente' },
  { key: '{{medico}}', label: 'Nome do Médico' },
  { key: '{{crm}}', label: 'CRM / CRP' },
  { key: '{{especialidade}}', label: 'Especialidade' },
  { key: '{{data_hoje}}', label: 'Data Atual' },
  { key: '{{cpf_contratante}}', label: 'CPF do Paciente' },
  { key: '{{rg_contratante}}', label: 'RG do Paciente' },
  { key: '{{endereco_contratante}}', label: 'Endereço do Paciente' },
]

function wrapVar(key: string): string {
  return '{{' + key + '}}'
}

function varLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Lista de documentos ───────────────────────────────────────────────────────

const modalOpen = ref(false)
const editDoc = ref<DocumentTemplate | null>(null)
const filterType = ref('')
const saving = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const contentTextarea = ref<HTMLTextAreaElement | null>(null)

const { data: docsData, refetch: refetchDocs } = useQuery<DocumentTemplate[]>({
  key: 'documents',
  queryFn: () => api.get('/documents').then(r => r.data),
})
const docs = computed(() => docsData.value ?? [])
const displayed = computed(() => docs.value.filter(d => !filterType.value || d.type === filterType.value))

const form = reactive<FormData>({ name: '', type: 'ATESTADO', content: '' })
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editDoc, (d) => {
  form.name = d?.name || ''
  form.type = d?.type || 'ATESTADO'
  form.content = d?.content || ''
  errors.name = undefined
}, { immediate: true })

function handleNew() { editDoc.value = null; modalOpen.value = true }
function handleEdit(d: DocumentTemplate) { editDoc.value = d; modalOpen.value = true }
function closeModal() { modalOpen.value = false; editDoc.value = null }

function handleImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => { form.content = (ev.target?.result as string) || '' }
  reader.readAsText(file)
  toast.success(`Arquivo "${file.name}" importado`)
}

function insertVar(v: string) {
  const ta = contentTextarea.value
  if (!ta) return
  const start = ta.selectionStart
  const current = form.content
  form.content = current.slice(0, start) + v + current.slice(start)
  setTimeout(() => { ta.focus(); ta.setSelectionRange(start + v.length, start + v.length) }, 0)
}

async function handleSubmit() {
  errors.name = undefined
  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  saving.value = true
  try {
    if (editDoc.value) {
      await api.put(`/documents/${editDoc.value.id}`, result.data)
    } else {
      await api.post('/documents', result.data)
    }
    toast.success(editDoc.value ? 'Documento atualizado!' : 'Documento criado!')
    closeModal()
    await refetchDocs()
  } catch {
    toast.error('Erro ao salvar documento')
  } finally {
    saving.value = false
  }
}

const toggling = ref(false)
async function handleToggle(id: string) {
  toggling.value = true
  try {
    await api.patch(`/documents/${id}/toggle`)
    toast.success('Status alterado')
    await refetchDocs()
  } finally {
    toggling.value = false
  }
}

function exportDoc(doc: DocumentTemplate) {
  const blob = new Blob([doc.content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${doc.name}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div class="flex items-start justify-between">
      <div class="animate-stagger-1">
        <h1 class="page-title">Documentos</h1>
        <p class="page-subtitle">Modelos de termos, atestados, receitas e orientações. Para emitir, abra a ficha da paciente › Documentos.</p>
      </div>
      <button class="btn-primary animate-stagger-1" @click="handleNew">
        <Plus class="w-4 h-4" />
        Novo Documento
      </button>
    </div>

    <!-- Filtros por tipo -->
    <div class="flex gap-2 flex-wrap">
      <button
        class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
        :class="!filterType ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 text-slate-600 hover:border-primary-300'"
        @click="filterType = ''"
      >
        Todos ({{ docs.length }})
      </button>
      <template v-for="t in DOC_TYPES" :key="t.value">
        <button
          v-if="docs.filter(d => d.type === t.value).length > 0"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
          :class="filterType === t.value ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 text-slate-600 hover:border-primary-300'"
          @click="filterType = t.value"
        >
          {{ t.icon }} {{ t.label }} ({{ docs.filter(d => d.type === t.value).length }})
        </button>
      </template>
    </div>

    <div v-if="displayed.length === 0" class="card text-center py-12">
      <FileText class="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p class="text-slate-400">Nenhum documento cadastrado</p>
      <button class="text-primary-600 text-sm font-medium mt-2 hover:underline" @click="handleNew">
        Criar primeiro documento
      </button>
    </div>
    <div v-else class="card p-0 overflow-hidden">
      <div class="divide-y divide-slate-100">
        <div
          v-for="doc in displayed" :key="doc.id"
          class="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
          :class="!doc.active ? 'opacity-60' : ''"
        >
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
            :class="DOC_TYPES.find(t => t.value === doc.type)!.bg"
          >
            {{ DOC_TYPES.find(t => t.value === doc.type)!.icon }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900">{{ doc.name }}</p>
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="[DOC_TYPES.find(t => t.value === doc.type)!.bg, DOC_TYPES.find(t => t.value === doc.type)!.color]"
              >
                {{ DOC_TYPES.find(t => t.value === doc.type)!.label }}
              </span>
              <span v-if="!doc.active" class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativo</span>
            </div>
            <p class="text-xs text-slate-400 mt-0.5 truncate">{{ doc.content.slice(0, 80) }}...</p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              class="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Exportar .txt"
              @click="exportDoc(doc)"
            >
              <Download class="w-4 h-4" />
            </button>
            <button
              class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="Editar"
              @click="handleEdit(doc)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              :disabled="toggling"
              class="p-1.5 rounded-lg transition-colors"
              :class="doc.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
              @click="handleToggle(doc.id)"
            >
              <XCircle v-if="doc.active" class="w-4 h-4" />
              <CheckCircle v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Criar / Editar template -->
    <Modal
      :is-open="modalOpen"
      :title="editDoc ? 'Editar Documento' : 'Novo Documento'"
      size="lg"
      @close="closeModal"
    >
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Nome do documento *</label>
            <input v-model="form.name" class="input-field" placeholder="Ex: Atestado padrão 2 dias" />
            <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
          </div>
          <div>
            <label class="label">Tipo *</label>
            <select v-model="form.type" class="input-field">
              <option v-for="t in DOC_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="label mb-0">Conteúdo do documento</label>
            <button
              type="button"
              class="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
              @click="fileInput?.click()"
            >
              <Upload class="w-3.5 h-3.5" />
              Importar .txt
            </button>
            <input ref="fileInput" type="file" accept=".txt" class="hidden" @change="handleImport" />
          </div>

          <!-- Variáveis disponíveis para inserção -->
          <div class="mb-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p class="text-xs font-medium text-slate-500 mb-2">
              Variáveis automáticas (clique para inserir no cursor):
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="v in TEMPLATE_VARIABLES" :key="v.key"
                type="button"
                class="group flex items-center gap-1 text-xs bg-white hover:bg-primary-50 border border-slate-200 hover:border-primary-300 text-slate-600 hover:text-primary-700 px-2 py-1 rounded-lg font-mono transition-colors"
                :title="v.label"
                @click="insertVar(v.key)"
              >
                {{ v.key }}
                <span class="text-slate-400 group-hover:text-primary-400 font-sans text-[10px]">
                  {{ v.label }}
                </span>
              </button>
            </div>
            <p class="text-xs text-slate-400 mt-2">
              Você também pode criar variáveis customizadas usando
              <code class="bg-white border border-slate-200 px-1 rounded text-[11px]">&#123;&#123;nome_da_variavel&#125;&#125;</code>
              — o sistema vai pedir o valor ao enviar.
            </p>
          </div>

          <textarea
            ref="contentTextarea"
            v-model="form.content"
            rows="12"
            class="input-field resize-none font-mono text-sm"
            placeholder="Digite o conteúdo. Use {{variavel}} para campos dinâmicos.
Exemplo: Atesto que {{paciente}} esteve em consulta em {{data_hoje}}."
          />
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editDoc ? 'Atualizar Documento' : 'Salvar Documento' }}</template>
        </button>
      </form>
    </Modal>

  </div>
</template>
