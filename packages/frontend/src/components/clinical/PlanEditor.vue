<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'
import { type TreatmentPlan, brl, toDateInput } from '../../lib/clinical'

const props = defineProps<{ isOpen: boolean; patientId: string; plan?: TreatmentPlan | null }>()
const emit = defineEmits<{ close: []; saved: [plan: TreatmentPlan] }>()

interface AppointmentType { id: string; name: string; baseValue: number | null }
interface ItemForm { appointmentTypeId: string; name: string; region: string; quantity: number; unitPrice: number }

const types = ref<AppointmentType[]>([])
const saving = ref(false)
const form = reactive({
  title: '',
  notes: '',
  discount: 0,
  validUntil: '',
  items: [] as ItemForm[],
})

function defaultValidity(): string {
  const d = new Date()
  d.setDate(d.getDate() + 15)
  return d.toISOString().slice(0, 10)
}

function emptyItem(): ItemForm {
  return { appointmentTypeId: '', name: '', region: '', quantity: 1, unitPrice: 0 }
}

watch(() => props.isOpen, async (open) => {
  if (!open) return
  if (props.plan) {
    form.title = props.plan.title
    form.notes = props.plan.notes ?? ''
    form.discount = props.plan.discount
    form.validUntil = toDateInput(props.plan.validUntil)
    form.items = props.plan.items.map(i => ({
      appointmentTypeId: i.appointmentTypeId ?? '',
      name: i.name,
      region: i.region ?? '',
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }))
  } else {
    form.title = 'Plano de tratamento'
    form.notes = ''
    form.discount = 0
    form.validUntil = defaultValidity()
    form.items = [emptyItem()]
  }
  if (types.value.length === 0) {
    try {
      const { data } = await api.get<AppointmentType[]>('/appointment-types')
      types.value = data
    } catch { /* catálogo é opcional — dá para digitar o procedimento */ }
  }
}, { immediate: true })

function onPickType(item: ItemForm) {
  const t = types.value.find(x => x.id === item.appointmentTypeId)
  if (!t) return
  item.name = t.name
  if (t.baseValue != null) item.unitPrice = t.baseValue
}

const subtotal = computed(() => form.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0))
const total = computed(() => Math.max(0, subtotal.value - (Number(form.discount) || 0)))

async function save() {
  const items = form.items.filter(i => i.name.trim())
  if (items.length === 0) { toast.error('Adicione pelo menos um procedimento'); return }
  saving.value = true
  try {
    const payload = {
      title: form.title,
      notes: form.notes || null,
      discount: Number(form.discount) || 0,
      validUntil: form.validUntil || null,
      items: items.map(i => ({
        appointmentTypeId: i.appointmentTypeId || null,
        name: i.name.trim(),
        region: i.region || null,
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice) || 0,
      })),
    }
    const { data } = props.plan
      ? await api.put<TreatmentPlan>(`/clinical/treatment-plans/${props.plan.id}`, payload)
      : await api.post<TreatmentPlan>(`/clinical/patients/${props.patientId}/treatment-plans`, payload)
    toast.success(props.plan ? 'Orçamento atualizado' : 'Orçamento criado')
    emit('saved', data)
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível salvar o orçamento')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" :title="plan ? 'Editar orçamento' : 'Novo orçamento'" subtitle="Procedimentos, sessões e valores" size="xl" @close="emit('close')">
    <form class="space-y-5" @submit.prevent="save">
      <div class="grid sm:grid-cols-[1fr_180px] gap-4">
        <div>
          <label class="label">Título</label>
          <input v-model="form.title" class="input-field" placeholder="Ex.: Harmonização completa, Reabilitação oral" />
        </div>
        <div>
          <label class="label">Válido até</label>
          <input v-model="form.validUntil" type="date" class="input-field" />
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="label mb-0">Procedimentos</label>
          <span class="text-xs text-slate-400">Quantidade &gt; 1 = pacote de sessões</span>
        </div>
        <div class="space-y-3">
          <div v-for="(item, i) in form.items" :key="i" class="rounded-xl border border-slate-200 bg-slate-50/60 p-3 grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-end">
            <div class="col-span-2 sm:col-span-4">
              <label class="text-xs font-medium text-slate-500">Procedimento</label>
              <select v-if="types.length" v-model="item.appointmentTypeId" class="input-field py-2 mb-1.5" @change="onPickType(item)">
                <option value="">— Da sua tabela (opcional) —</option>
                <option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }}{{ t.baseValue != null ? ` · ${brl(t.baseValue)}` : '' }}</option>
              </select>
              <input v-model="item.name" class="input-field py-2" placeholder="Ex.: Toxina botulínica — terço superior" />
            </div>
            <div class="col-span-2 sm:col-span-3">
              <label class="text-xs font-medium text-slate-500">Dente / área</label>
              <input v-model="item.region" class="input-field py-2" placeholder="Ex.: 36, Lábios" />
            </div>
            <div class="sm:col-span-1">
              <label class="text-xs font-medium text-slate-500">Qtd.</label>
              <input v-model.number="item.quantity" type="number" min="1" class="input-field py-2" />
            </div>
            <div class="sm:col-span-2">
              <label class="text-xs font-medium text-slate-500">Valor unit. (R$)</label>
              <input v-model.number="item.unitPrice" type="number" min="0" step="0.01" class="input-field py-2" />
            </div>
            <div class="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ brl((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)) }}</span>
              <button type="button" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Remover" :disabled="form.items.length === 1" @click="form.items.splice(i, 1)"><Trash2 class="w-4 h-4" /></button>
            </div>
          </div>
        </div>
        <button type="button" class="mt-3 btn-secondary text-sm" @click="form.items.push(emptyItem())"><Plus class="w-4 h-4" /> Adicionar procedimento</button>
      </div>

      <div class="grid sm:grid-cols-[1fr_240px] gap-4 items-start">
        <div>
          <label class="label">Observações para a paciente</label>
          <textarea v-model="form.notes" rows="3" class="input-field" placeholder="Formas de pagamento, condições, orientações…" />
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-sm">
          <div class="flex justify-between text-slate-600"><span>Subtotal</span><span class="tabular-nums">{{ brl(subtotal) }}</span></div>
          <div class="flex justify-between items-center gap-2 text-slate-600">
            <span>Desconto (R$)</span>
            <input v-model.number="form.discount" type="number" min="0" step="0.01" class="input-field w-28 py-1.5 text-right" />
          </div>
          <div class="flex justify-between pt-2 border-t border-slate-100 font-semibold text-slate-900"><span>Total</span><span class="tabular-nums text-lg">{{ brl(total) }}</span></div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Salvando…' : 'Salvar orçamento' }}</button>
      </div>
    </form>
  </Modal>
</template>
