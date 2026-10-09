<script setup lang="ts">
// Prontuário da paciente (evoluções, anamneses, prescrições…) — antes era a
// página /prontuario com lista de pacientes ao lado; agora vive na ficha.
import { computed, reactive, ref } from 'vue'
import { z } from 'zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, FileText, Trash2, ChevronDown, Pencil, DollarSign, CheckCircle2, Stethoscope } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import type { User as UserType, GroupedMedicalRecord, MedicalRecord, AppointmentType, HealthPlan } from '../../types'
import Modal from '../ui/Modal.vue'
import SpecialtyRecordView from '../prontuario/SpecialtyRecordView.vue'
import LancarFinanceiroModal from '../prontuario/LancarFinanceiroModal.vue'
import { useQuery } from '../../composables/useQuery'

const props = defineProps<{ patientId: string; healthPlanId?: string | null }>()
const emit = defineEmits<{ changed: [] }>()

const RECORD_TYPES: Record<string, { label: string; chip: string }> = {
  ANAMNESE: { label: 'Anamnese', chip: 'bg-gold-50 text-gold-800' },
  EVOLUCAO: { label: 'Evolução', chip: 'bg-emerald-50 text-emerald-700' },
  PRESCRICAO: { label: 'Prescrição', chip: 'bg-mauve-50 text-mauve-700' },
  EXAME: { label: 'Exame', chip: 'bg-sand-100 text-sand-800' },
  ATESTADO: { label: 'Atestado', chip: 'bg-primary-50 text-primary-700' },
  OUTROS: { label: 'Outros', chip: 'bg-slate-100 text-slate-600' },
  SISTEMA: { label: 'Sistema', chip: 'bg-slate-100 text-slate-500' },
}
const MANUAL_TYPES = Object.entries(RECORD_TYPES).filter(([k]) => k !== 'SISTEMA')

const FILTERS = [
  { key: 'clinicos', label: 'Clínicos' },
  { key: 'ANAMNESE', label: 'Anamneses' },
  { key: 'EVOLUCAO', label: 'Evoluções' },
  { key: 'todos', label: 'Tudo (inclui agenda)' },
] as const
const filter = ref<(typeof FILTERS)[number]['key']>('clinicos')

const schema = z.object({
  doctorId: z.string().min(1, 'Selecione o profissional'),
  type: z.enum(['ANAMNESE', 'EVOLUCAO', 'PRESCRICAO', 'EXAME', 'ATESTADO', 'OUTROS']),
  title: z.string().min(2, 'Título obrigatório'),
  date: z.string(),
  objetivoClinico: z.string().optional(),
  sintese: z.string().optional(),
  encaminhamento: z.string().optional(),
  queixaPrincipal: z.string().optional(),
  historiaDoencaAtual: z.string().optional(),
  antecedentesPessoais: z.string().optional(),
  antecedentesFamiliares: z.string().optional(),
  habitosVida: z.string().optional(),
  exameFisico: z.string().optional(),
  hipoteseDiagnostica: z.string().optional(),
})
type FormData = z.infer<typeof schema>

// Rótulos pensados para odontologia/estética; as chaves continuam as mesmas do
// backend (e dos registros antigos).
const ANAMNESE_SECTIONS: { key: keyof FormData; label: string; placeholder: string }[] = [
  { key: 'queixaPrincipal', label: 'Queixa principal / expectativa', placeholder: 'O que a paciente deseja tratar ou melhorar…' },
  { key: 'historiaDoencaAtual', label: 'Histórico da queixa', placeholder: 'Desde quando, tratamentos anteriores, resultados…' },
  { key: 'antecedentesPessoais', label: 'Saúde geral, alergias e medicamentos', placeholder: 'Alergias, anticoagulantes, gestação/amamentação, diabetes, hipertensão, doenças autoimunes…' },
  { key: 'antecedentesFamiliares', label: 'Procedimentos anteriores', placeholder: 'Toxina, preenchedores, fios, cirurgias, implantes, ortodontia… e intercorrências' },
  { key: 'habitosVida', label: 'Hábitos', placeholder: 'Tabagismo, exposição solar, bruxismo, higiene oral, cuidados com a pele…' },
  { key: 'exameFisico', label: 'Exame clínico', placeholder: 'Achados do exame clínico / facial / intraoral…' },
  { key: 'hipoteseDiagnostica', label: 'Diagnóstico e plano', placeholder: 'Diagnóstico e conduta proposta…' },
]

interface ProcedureEntry { appointmentTypeId?: string; name: string; valorTabelado: number; valorPago: number }

const auth = useAuthStore()
const user = computed(() => auth.user)
const canEdit = computed(() => user.value?.role === 'ADMIN' || user.value?.role === 'DOCTOR')

const recordsQuery = useQuery<GroupedMedicalRecord[]>({
  key: computed(() => `prontuario-${props.patientId}`),
  queryFn: () => api.get(`/medical-records/by-patient/${props.patientId}`).then(r => r.data),
})
const allRecords = computed(() =>
  (recordsQuery.data.value ?? [])
    .flatMap(g => g.records.map(r => ({ ...r, doctorName: g.doctor.name })))
    .sort((a, b) => b.date.localeCompare(a.date)),
)
const records = computed(() => allRecords.value.filter(r => {
  if (filter.value === 'todos') return true
  if (filter.value === 'clinicos') return r.type !== 'SISTEMA'
  return r.type === filter.value
}))

const { data: doctorsData } = useQuery<UserType[]>({ key: 'doctors', queryFn: () => api.get('/doctors').then(r => r.data) })
const doctors = computed(() => doctorsData.value ?? [])
const { data: typesData } = useQuery<AppointmentType[]>({ key: 'appointment-types', queryFn: () => api.get('/appointment-types').then(r => r.data) })
const appointmentTypes = computed(() => typesData.value ?? [])
const { data: plansData } = useQuery<HealthPlan[]>({ key: 'health-plans', queryFn: () => api.get('/health-plans').then(r => r.data) })
const healthPlan = computed(() => (plansData.value ?? []).find(hp => hp.id === props.healthPlanId) ?? null)

const expanded = reactive(new Set<string>())
function toggle(id: string) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

function geral(r: MedicalRecord) {
  return r.specialtyData as { objetivoClinico?: string; sintese?: string; encaminhamento?: string } | null | undefined
}
function anamnese(r: MedicalRecord) {
  return r.specialtyData as Partial<Record<string, string>> | null | undefined
}

// ─── Formulário ───────────────────────────────────────────────────────────
function emptyForm(type: FormData['type'] = 'EVOLUCAO'): FormData {
  return {
    doctorId: user.value?.role === 'DOCTOR' ? user.value.id : '',
    type, title: type === 'ANAMNESE' ? 'Anamnese' : '', date: format(new Date(), 'yyyy-MM-dd'),
    objetivoClinico: '', sintese: '', encaminhamento: '',
    queixaPrincipal: '', historiaDoencaAtual: '', antecedentesPessoais: '', antecedentesFamiliares: '',
    habitosVida: '', exameFisico: '', hipoteseDiagnostica: '',
  }
}
const form = reactive<FormData>(emptyForm())
const errors = reactive<Partial<Record<keyof FormData, string>>>({})
const procedures = ref<ProcedureEntry[]>([])
const pickedType = ref('')
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)

function openCreate(type: FormData['type'] = 'EVOLUCAO') {
  editingId.value = null
  Object.assign(form, emptyForm(type))
  procedures.value = []
  for (const k of Object.keys(errors)) delete errors[k as keyof FormData]
  modalOpen.value = true
}
defineExpose({ openCreate })

function openEdit(r: MedicalRecord) {
  editingId.value = r.id
  const g = r.specialtyType === 'GERAL' ? geral(r) : null
  const a = r.specialtyType === 'ANAMNESE' ? anamnese(r) : null
  Object.assign(form, emptyForm(r.type === 'SISTEMA' ? 'OUTROS' : r.type as FormData['type']), {
    doctorId: r.doctorId, title: r.title, date: format(new Date(r.date), 'yyyy-MM-dd'),
    objetivoClinico: g?.objetivoClinico ?? '', sintese: g?.sintese ?? '', encaminhamento: g?.encaminhamento ?? '',
  })
  for (const s of ANAMNESE_SECTIONS) (form[s.key] as string) = a?.[s.key] ?? ''
  procedures.value = (r.procedures ?? []).map(p => ({ appointmentTypeId: p.appointmentTypeId ?? undefined, name: p.name, valorTabelado: p.valorTabelado, valorPago: p.valorPago }))
  for (const k of Object.keys(errors)) delete errors[k as keyof FormData]
  modalOpen.value = true
}

function suggestedValue(typeId: string) {
  const override = healthPlan.value?.procedures?.find(p => p.appointmentTypeId === typeId)
  if (override) return override.value
  return appointmentTypes.value.find(t => t.id === typeId)?.baseValue ?? 0
}
function addProcedure() {
  const t = appointmentTypes.value.find(x => x.id === pickedType.value)
  if (!t) return
  const v = suggestedValue(t.id)
  procedures.value.push({ appointmentTypeId: t.id, name: t.name, valorTabelado: v, valorPago: v })
  pickedType.value = ''
}

async function submit() {
  for (const k of Object.keys(errors)) delete errors[k as keyof FormData]
  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path[0] as keyof FormData] = issue.message
    return
  }
  saving.value = true
  try {
    const payload = { ...parsed.data, patientId: props.patientId, procedures: procedures.value }
    if (editingId.value) await api.put(`/medical-records/${editingId.value}`, payload)
    else await api.post('/medical-records', payload)
    toast.success(editingId.value ? 'Registro atualizado' : 'Registro salvo no prontuário')
    modalOpen.value = false
    await recordsQuery.refetch()
    emit('changed')
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar o registro')
  } finally {
    saving.value = false
  }
}

const launching = ref<MedicalRecord | null>(null)
function canLaunch(r: MedicalRecord) {
  return canEdit.value && (r.procedures ?? []).length > 0 && !r.billedAt
}
async function onCharged() {
  launching.value = null
  await recordsQuery.refetch()
  emit('changed')
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="f in FILTERS" :key="f.key"
        :class="['text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors', filter === f.key ? 'bg-primary-600 text-white border-primary-600' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50']"
        @click="filter = f.key"
      >{{ f.label }}</button>
      <div v-if="canEdit" class="ml-auto flex gap-2">
        <button class="btn-secondary text-sm" @click="openCreate('ANAMNESE')"><Plus class="w-4 h-4" /> Anamnese</button>
        <button class="btn-primary text-sm" @click="openCreate('EVOLUCAO')"><Plus class="w-4 h-4" /> Evolução</button>
      </div>
    </div>

    <div v-if="recordsQuery.isLoading.value && !allRecords.length" class="space-y-2"><div v-for="i in 3" :key="i" class="h-16 skeleton" /></div>
    <div v-else-if="records.length === 0" class="card text-center py-10">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><FileText class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum registro {{ filter === 'ANAMNESE' ? 'de anamnese' : 'no prontuário' }}</p>
      <p v-if="canEdit" class="text-xs text-slate-500 mt-1">Comece pela anamnese na primeira consulta.</p>
    </div>

    <ol v-else class="relative space-y-3 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
      <li v-for="r in records" :key="r.id" class="relative pl-12">
        <div class="absolute left-0 top-2 w-10 text-center">
          <p class="text-sm font-bold text-slate-800 leading-none tabular-nums">{{ format(new Date(r.date), 'dd') }}</p>
          <p class="text-[10px] font-semibold uppercase text-slate-400">{{ format(new Date(r.date), 'MMM', { locale: ptBR }) }}</p>
        </div>
        <div :class="['card p-0 overflow-hidden transition-shadow', expanded.has(r.id) && 'shadow-md']">
          <button class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/70" @click="toggle(r.id)">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-slate-900 truncate">{{ r.title }}</p>
                <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', (RECORD_TYPES[r.type] ?? RECORD_TYPES.OUTROS).chip]">{{ (RECORD_TYPES[r.type] ?? RECORD_TYPES.OUTROS).label }}</span>
                <span v-if="r.billedAt" class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 class="w-3 h-3" /> Lançado</span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">
                {{ format(new Date(r.date), "dd/MM/yyyy", { locale: ptBR }) }} · {{ r.doctorName }}
                <template v-if="(r.procedures ?? []).length"> · {{ r.procedures!.map(p => p.name).join(', ') }}</template>
              </p>
            </div>
            <ChevronDown :class="['w-4 h-4 text-slate-400 transition-transform', expanded.has(r.id) && 'rotate-180']" />
          </button>

          <div v-if="expanded.has(r.id)" class="px-4 pb-4 pt-3 border-t border-slate-100 space-y-3">
            <template v-if="r.specialtyType === 'GERAL' && r.specialtyData">
              <div v-for="[k, label] in [['objetivoClinico', 'Objetivo'], ['sintese', 'Síntese / procedimento realizado'], ['encaminhamento', 'Orientações e próximos passos']]" :key="k">
                <template v-if="(geral(r) as any)?.[k]">
                  <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{{ label }}</p>
                  <p class="text-sm text-slate-800 whitespace-pre-wrap">{{ (geral(r) as any)[k] }}</p>
                </template>
              </div>
            </template>
            <template v-else-if="r.specialtyType === 'ANAMNESE' && r.specialtyData">
              <div v-for="s in ANAMNESE_SECTIONS" :key="s.key">
                <template v-if="anamnese(r)?.[s.key]">
                  <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{{ s.label }}</p>
                  <p class="text-sm text-slate-800 whitespace-pre-wrap">{{ anamnese(r)?.[s.key] }}</p>
                </template>
              </div>
            </template>
            <SpecialtyRecordView v-else-if="r.specialtyData && r.specialtyType" :specialty-type="r.specialtyType" :data="r.specialtyData" />
            <p v-else class="text-sm text-slate-700 whitespace-pre-wrap">{{ r.content }}</p>

            <div v-if="(r.procedures ?? []).length" class="pt-3 border-t border-slate-100 space-y-1">
              <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Procedimentos</p>
              <div v-for="p in r.procedures" :key="p.id" class="flex justify-between text-sm">
                <span class="text-slate-700">{{ p.name }} <span v-if="p.valorPago === 0" class="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">Cortesia</span></span>
                <span class="font-medium tabular-nums">{{ brl(p.valorPago) }}</span>
              </div>
            </div>

            <div v-if="canEdit && r.type !== 'SISTEMA'" class="flex justify-end gap-2">
              <button v-if="canLaunch(r)" class="btn-secondary text-xs py-1.5" @click="launching = r"><DollarSign class="w-3.5 h-3.5" /> Lançar no financeiro</button>
              <button class="btn-secondary text-xs py-1.5" @click="openEdit(r)"><Pencil class="w-3.5 h-3.5" /> Editar</button>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <Modal :is-open="modalOpen" :title="editingId ? 'Editar registro' : form.type === 'ANAMNESE' ? 'Nova anamnese' : 'Novo registro no prontuário'" size="lg" @close="modalOpen = false">
      <form class="space-y-4" @submit.prevent="submit">
        <div class="grid sm:grid-cols-3 gap-4">
          <div>
            <label class="label">Tipo</label>
            <select v-model="form.type" class="input-field">
              <option v-for="[value, cfg] in MANUAL_TYPES" :key="value" :value="value">{{ cfg.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">Data</label>
            <input v-model="form.date" type="date" class="input-field" />
          </div>
          <div>
            <label class="label">Profissional</label>
            <select v-model="form.doctorId" class="input-field" :disabled="user?.role === 'DOCTOR'">
              <option value="">Selecione</option>
              <option v-for="d in doctors" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <p v-if="errors.doctorId" class="text-xs text-red-500 mt-1">{{ errors.doctorId }}</p>
          </div>
        </div>
        <div>
          <label class="label">Título</label>
          <input v-model="form.title" class="input-field" placeholder="Ex.: Aplicação de toxina — terço superior, Restauração 36" />
          <p v-if="errors.title" class="text-xs text-red-500 mt-1">{{ errors.title }}</p>
        </div>

        <template v-if="form.type === 'ANAMNESE'">
          <div v-for="s in ANAMNESE_SECTIONS" :key="s.key">
            <label class="label">{{ s.label }}</label>
            <textarea v-model="(form[s.key] as string)" rows="2" class="input-field resize-none" :placeholder="s.placeholder" />
          </div>
        </template>
        <template v-else>
          <div>
            <label class="label">Objetivo</label>
            <textarea v-model="form.objetivoClinico" rows="2" class="input-field resize-none" placeholder="Objetivo do atendimento…" />
          </div>
          <div>
            <label class="label">Síntese / procedimento realizado</label>
            <textarea v-model="form.sintese" rows="3" class="input-field resize-none" placeholder="O que foi feito, materiais, intercorrências…" />
          </div>
          <div>
            <label class="label">Orientações e próximos passos</label>
            <textarea v-model="form.encaminhamento" rows="2" class="input-field resize-none" placeholder="Cuidados pós-procedimento, retorno…" />
          </div>
        </template>

        <div>
          <label class="label flex items-center gap-1"><Stethoscope class="w-3.5 h-3.5 text-slate-400" /> Procedimentos realizados</label>
          <div v-if="procedures.length" class="space-y-2 mb-3">
            <div v-for="(p, i) in procedures" :key="i" class="grid grid-cols-[1fr,100px,100px,24px] gap-2 items-center">
              <span class="text-sm text-slate-700 truncate">{{ p.name }}</span>
              <input v-model.number="p.valorTabelado" type="number" step="0.01" min="0" class="input-field text-sm py-1.5" title="Valor de tabela" />
              <input v-model.number="p.valorPago" type="number" step="0.01" min="0" class="input-field text-sm py-1.5" title="Valor cobrado (0 = cortesia)" />
              <button type="button" class="text-slate-400 hover:text-red-600" @click="procedures.splice(i, 1)"><Trash2 class="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div v-if="appointmentTypes.length" class="flex gap-2">
            <select v-model="pickedType" class="input-field flex-1">
              <option value="">Adicionar procedimento da tabela…</option>
              <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
            <button type="button" class="btn-secondary px-3" :disabled="!pickedType" @click="addProcedure"><Plus class="w-4 h-4" /></button>
          </div>
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full justify-center">{{ saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Salvar no prontuário' }}</button>
      </form>
    </Modal>

    <LancarFinanceiroModal v-if="launching" :is-open="!!launching" :record="launching" @close="launching = null" @charged="onCharged" />
  </div>
</template>
