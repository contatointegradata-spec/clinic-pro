<script setup lang="ts">
// Documentos da paciente — antes a emissão ficava em Configurações ›
// Documentos (com busca de paciente). Os modelos continuam lá; emitir,
// imprimir e enviar acontecem aqui, na ficha.
import { ref, reactive, computed, watch } from 'vue'
import { FilePlus2, Printer, Send, FileText, Eye, Settings2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'

const props = defineProps<{ patientId: string; patientName: string; patientPhone?: string | null }>()

interface GeneratedDoc { id: string; name: string; content: string; status: 'READY' | 'SENT'; createdAt: string; sentAt: string | null; createdBy: { name: string } | null }
interface Template { id: string; name: string; type?: string; active: boolean }

const docs = ref<GeneratedDoc[]>([])
const templates = ref<Template[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const [d, t] = await Promise.all([
      api.get<GeneratedDoc[]>(`/clinical/patients/${props.patientId}/documents`),
      api.get<Template[]>('/documents').catch(() => ({ data: [] as Template[] })),
    ])
    docs.value = d.data
    templates.value = t.data.filter(x => x.active)
  } catch {
    toast.error('Não foi possível carregar os documentos')
  } finally {
    loading.value = false
  }
}
load()

// ─── Emitir ────────────────────────────────────────────────────────────────
const emitOpen = ref(false)
const templateId = ref('')
const customVars = ref<string[]>([])
const values = reactive<Record<string, string>>({})
const busy = ref<'' | 'save' | 'send'>('')

function openEmit() {
  templateId.value = templates.value[0]?.id ?? ''
  emitOpen.value = true
}

watch(templateId, async (id) => {
  customVars.value = []
  for (const k of Object.keys(values)) delete values[k]
  if (!id) return
  try {
    const { data } = await api.get<{ customVars: string[] }>(`/documents/${id}/variables`)
    customVars.value = data.customVars ?? []
  } catch { /* sem variáveis extras */ }
})

function varLabel(key: string) {
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

async function generate(print: boolean) {
  if (!templateId.value) return
  // Abre a janela já no clique — depois do await o navegador bloqueia o pop-up.
  const win = print ? window.open('', '_blank') : null
  busy.value = 'save'
  try {
    const { data } = await api.post<GeneratedDoc>(`/documents/${templateId.value}/generate`, { patientId: props.patientId, variables: { ...values } })
    docs.value = [{ ...data, createdBy: null }, ...docs.value]
    emitOpen.value = false
    toast.success('Documento salvo na ficha')
    if (print) printDoc(data, win)
  } catch (e: any) {
    win?.close()
    toast.error(e?.response?.data?.message || 'Não foi possível gerar o documento')
  } finally {
    busy.value = ''
  }
}

async function send() {
  if (!templateId.value) return
  busy.value = 'send'
  try {
    await api.post(`/documents/${templateId.value}/emit`, { patientId: props.patientId, variables: { ...values } })
    toast.success('Documento enviado pelo WhatsApp')
    emitOpen.value = false
    await load()
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível enviar o documento')
  } finally {
    busy.value = ''
  }
}

// ─── Ver / imprimir ──────────────────────────────────────────────────────────
const viewing = ref<GeneratedDoc | null>(null)

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
function printDoc(doc: { name: string; content: string }, existing?: Window | null) {
  const w = existing ?? window.open('', '_blank')
  if (!w) { toast.error('Permita pop-ups para imprimir'); return }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:48px auto;padding:0 24px;color:#2B2B2B;line-height:1.6}
h1{font-size:20px;text-align:center;margin-bottom:32px}pre{white-space:pre-wrap;font-family:inherit;font-size:15px}</style></head>
<body><h1>${escapeHtml(doc.name)}</h1><pre>${escapeHtml(doc.content)}</pre></body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

const hasTemplates = computed(() => templates.value.length > 0)
function when(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-slate-500">Termos de consentimento, atestados, receitas e orientações emitidos para {{ patientName.split(' ')[0] }}.</p>
      <button class="btn-primary text-sm" :disabled="!hasTemplates" @click="openEmit"><FilePlus2 class="w-4 h-4" /> Emitir documento</button>
    </div>

    <div v-if="!loading && !hasTemplates" class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-3">
      <span class="flex-1">Você ainda não tem modelos de documento. Crie seus modelos (termo de consentimento, atestado, orientações pós-procedimento…) uma vez e emita para qualquer paciente.</span>
      <router-link to="/configuracoes/documentos" class="btn-secondary text-xs py-1.5"><Settings2 class="w-3.5 h-3.5" /> Criar modelos</router-link>
    </div>

    <div v-if="loading" class="h-24 skeleton" />
    <div v-else-if="docs.length === 0" class="card text-center py-10">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><FileText class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum documento emitido</p>
    </div>
    <div v-else class="card p-0 divide-y divide-slate-100">
      <div v-for="d in docs" :key="d.id" class="px-4 py-3 flex flex-wrap items-center gap-3">
        <FileText class="w-5 h-5 text-slate-400" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-800 truncate">{{ d.name }}</p>
          <p class="text-xs text-slate-500">{{ when(d.createdAt) }}<template v-if="d.createdBy"> · {{ d.createdBy.name }}</template></p>
        </div>
        <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', d.status === 'SENT' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600']">{{ d.status === 'SENT' ? 'Enviado pelo WhatsApp' : 'Na ficha' }}</span>
        <button class="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50" title="Ver" @click="viewing = d"><Eye class="w-4 h-4" /></button>
        <button class="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50" title="Imprimir" @click="printDoc(d)"><Printer class="w-4 h-4" /></button>
      </div>
    </div>

    <Modal :is-open="emitOpen" title="Emitir documento" :subtitle="patientName" size="lg" @close="emitOpen = false">
      <div class="space-y-4">
        <div>
          <label class="label">Modelo</label>
          <select v-model="templateId" class="input-field">
            <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <p class="text-xs text-slate-400 mt-1">Nome, CPF, RG, endereço, profissional e data são preenchidos automaticamente.</p>
        </div>
        <div v-if="customVars.length" class="grid sm:grid-cols-2 gap-3">
          <div v-for="v in customVars" :key="v">
            <label class="label">{{ varLabel(v) }}</label>
            <input v-model="values[v]" class="input-field" />
          </div>
        </div>
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <button class="btn-secondary" :disabled="!!busy || !patientPhone" :title="patientPhone ? '' : 'Paciente sem telefone'" @click="send"><Send class="w-4 h-4" /> {{ busy === 'send' ? 'Enviando…' : 'Enviar pelo WhatsApp' }}</button>
          <button class="btn-secondary" :disabled="!!busy" @click="generate(false)">Salvar na ficha</button>
          <button class="btn-primary" :disabled="!!busy" @click="generate(true)"><Printer class="w-4 h-4" /> {{ busy === 'save' ? 'Gerando…' : 'Salvar e imprimir' }}</button>
        </div>
      </div>
    </Modal>

    <Modal :is-open="!!viewing" :title="viewing?.name ?? ''" size="lg" @close="viewing = null">
      <div v-if="viewing" class="space-y-4">
        <pre class="whitespace-pre-wrap font-sans text-sm text-slate-800 bg-slate-50 rounded-xl p-4 max-h-[60vh] overflow-y-auto">{{ viewing.content }}</pre>
        <div class="flex justify-end"><button class="btn-primary" @click="printDoc(viewing)"><Printer class="w-4 h-4" /> Imprimir</button></div>
      </div>
    </Modal>
  </div>
</template>
