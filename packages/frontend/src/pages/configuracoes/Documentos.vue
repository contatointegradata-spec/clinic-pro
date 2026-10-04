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

// ─── Emitir documento para paciente via WhatsApp ───────────────────────────────

const emitDoc = ref<DocumentTemplate | null>(null)
const patientSearch = ref('')
const selectedPatient = ref<Patient | null>(null)
const customVarValues = reactive<Record<string, string>>({})
const emitting = ref(false)

function openEmitModal(doc: DocumentTemplate) {
  emitDoc.value = doc
  selectedPatient.value = null
  patientSearch.value = ''
  for (const k of Object.keys(customVarValues)) delete customVarValues[k]
}

function closeEmitModal() {
  emitDoc.value = null
  selectedPatient.value = null
  patientSearch.value = ''
  for (const k of Object.keys(customVarValues)) delete customVarValues[k]
}

const { data: patientsData } = useQuery<Patient[]>({
  key: 'patients-list',
  queryFn: () => api.get('/patients').then(r => r.data),
  enabled: computed(() => !!emitDoc.value),
  staleTime: 60_000,
})
const patients = computed(() => patientsData.value ?? [])

const filteredPatients = computed(() => {
  if (patientSearch.value.length < 2) return []
  const term = patientSearch.value.toLowerCase()
  return patients.value
    .filter(p => p.name.toLowerCase().includes(term) || (p.phone ?? '').includes(patientSearch.value))
    .slice(0, 20)
})

function selectPatient(p: Patient) {
  selectedPatient.value = p
  patientSearch.value = p.name
}

watch(patientSearch, () => { selectedPatient.value = null })

interface VarsData { allVars: string[]; systemVars: string[]; customVars: string[] }

const { data: varsData, isLoading: varsFetching } = useQuery<VarsData>({
  key: computed(() => `doc-variables:${emitDoc.value?.id ?? ''}`),
  queryFn: () => api.get(`/documents/${emitDoc.value!.id}/variables`).then(r => r.data),
  enabled: computed(() => !!emitDoc.value),
})

const canSend = computed(() => !!selectedPatient.value?.phone && !emitting.value)
const canGenerate = computed(() => !!selectedPatient.value && !generating.value)

async function handleSendDoc() {
  if (!emitDoc.value || !selectedPatient.value) return
  emitting.value = true
  try {
    await api.post(`/documents/${emitDoc.value.id}/emit`, {
      patientId: selectedPatient.value.id,
      variables: { ...customVarValues },
    })
    toast.success('Documento enviado via WhatsApp!')
    closeEmitModal()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg ?? 'Erro ao enviar documento')
  } finally {
    emitting.value = false
  }
}

// Deixa o documento pronto pra o Agente de IA entregar depois, sob pedido do
// paciente pelo WhatsApp — não envia agora. Ver POST /documents/:id/generate.
const generating = ref(false)

async function handleGenerateForAgent() {
  if (!emitDoc.value || !selectedPatient.value) return
  generating.value = true
  try {
    await api.post(`/documents/${emitDoc.value.id}/generate`, {
      patientId: selectedPatient.value.id,
      variables: { ...customVarValues },
    })
    toast.success('Documento pronto — o paciente pode pedir pelo WhatsApp quando quiser.')
    closeEmitModal()
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg ?? 'Erro ao preparar documento')
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div class="flex items-start justify-between">
      <div class="animate-stagger-1">
        <h1 class="page-title">Documentos</h1>
        <p class="page-subtitle">Templates de atestados, declarações, recibos e comprovantes</p>
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
              class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="Enviar para Paciente via WhatsApp"
              @click="openEmitModal(doc)"
            >
              <Send class="w-4 h-4" />
            </button>
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

    <!-- Modal: Enviar documento para paciente via WhatsApp -->
    <Modal
      :is-open="!!emitDoc"
      title="Enviar Documento via WhatsApp"
      size="md"
      @close="closeEmitModal"
    >
      <div v-if="emitDoc" class="space-y-5">
        <!-- Info do documento -->
        <div class="flex items-center gap-3 p-3 bg-rose-50 rounded-xl border border-rose-100">
          <FileText class="w-5 h-5 text-rose-600 flex-shrink-0" />
          <div>
            <p class="font-semibold text-slate-900 text-sm">{{ emitDoc.name }}</p>
            <p class="text-xs text-slate-500 mt-0.5">
              O conteúdo completo do documento será enviado ao paciente via WhatsApp com as variáveis preenchidas.
            </p>
          </div>
        </div>

        <!-- Seleção de paciente -->
        <div>
          <label class="label">Paciente destinatário</label>
          <div class="relative">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              v-model="patientSearch"
              type="text"
              class="input-field pl-9"
              placeholder="Buscar por nome ou telefone (mín. 2 caracteres)"
              autofocus
            />
          </div>

          <div v-if="filteredPatients.length > 0" class="mt-1.5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto shadow-sm">
            <button
              v-for="p in filteredPatients" :key="p.id"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
              :class="selectedPatient?.id === p.id ? 'bg-rose-50' : ''"
              @click="selectPatient(p)"
            >
              <div class="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                <User class="w-3.5 h-3.5 text-rose-600" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-slate-900 text-sm truncate">{{ p.name }}</p>
                <p class="text-xs text-slate-400">{{ p.phone || 'Sem telefone' }}</p>
              </div>
              <CheckCircle v-if="selectedPatient?.id === p.id" class="w-4 h-4 text-rose-600 flex-shrink-0" />
            </button>
          </div>

          <p v-if="selectedPatient && !selectedPatient.phone" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">
            Este paciente não tem telefone cadastrado e não pode receber o documento.
          </p>
        </div>

        <!-- Variáveis de sistema (informativo) -->
        <div v-if="varsFetching" class="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 class="w-4 h-4 animate-spin" />
          Carregando variáveis do template...
        </div>

        <template v-if="varsData">
          <div v-if="varsData.systemVars.length > 0" class="p-3 bg-primary-50 rounded-xl border border-primary-100">
            <div class="flex items-center gap-2 mb-2">
              <Info class="w-4 h-4 text-primary-600" />
              <p class="text-xs font-semibold text-primary-700">Variáveis preenchidas automaticamente</p>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="v in varsData.systemVars" :key="v" class="text-xs bg-white border border-primary-200 text-primary-700 px-2 py-0.5 rounded-md font-mono">
                {{ wrapVar(v) }}
              </span>
            </div>
          </div>

          <!-- Variáveis custom que precisam de preenchimento -->
          <div v-if="varsData.customVars.length > 0" class="space-y-3">
            <div class="flex items-center gap-2">
              <ChevronRight class="w-4 h-4 text-amber-500" />
              <p class="text-sm font-semibold text-slate-700">
                Preencha as variáveis customizadas
              </p>
            </div>
            <div class="space-y-2.5">
              <div v-for="v in varsData.customVars" :key="v">
                <label class="label text-xs">
                  <code class="font-mono bg-slate-100 px-1 rounded">{{ wrapVar(v) }}</code>
                  — {{ varLabel(v) }}
                </label>
                <input
                  v-model="customVarValues[v]"
                  type="text"
                  class="input-field text-sm"
                  :placeholder="`Valor para ${varLabel(v)}`"
                />
              </div>
            </div>
          </div>

          <p v-if="varsData.customVars.length === 0 && varsData.systemVars.length === 0" class="text-xs text-slate-400 text-center py-1">
            Nenhuma variável detectada no template.
          </p>
        </template>

        <!-- Ações -->
        <div class="flex gap-3 pt-1">
          <button class="btn-secondary flex-1" @click="closeEmitModal">
            Cancelar
          </button>
          <button
            :disabled="!canGenerate"
            title="Prepara o documento e deixa disponível pro Agente de IA mandar quando o paciente pedir pelo WhatsApp — não envia agora"
            class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleGenerateForAgent"
          >
            <template v-if="generating">
              <Loader2 class="w-4 h-4 animate-spin" />Preparando...
            </template>
            <template v-else>
              <Bot class="w-4 h-4" />Deixar pronto pro Agente
            </template>
          </button>
          <button
            :disabled="!canSend"
            class="btn-primary flex-1 flex items-center justify-center gap-2"
            @click="handleSendDoc"
          >
            <template v-if="emitting">
              <Loader2 class="w-4 h-4 animate-spin" />Enviando...
            </template>
            <template v-else>
              <Send class="w-4 h-4" />Enviar agora
            </template>
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>
