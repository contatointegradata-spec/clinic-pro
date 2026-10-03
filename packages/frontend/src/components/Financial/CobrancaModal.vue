<script setup lang="ts">
import { ref, computed } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { DollarSign, CreditCard, HeartPulse, Plus, Trash2 } from 'lucide-vue-next'
import api from '../../lib/api'
import { useQuery } from '../../composables/useQuery'
import toast from '../../lib/toast'
import type { Appointment, PaymentMethod, PatientPlan, AppointmentType } from '../../types'
import Modal from '../ui/Modal.vue'

interface ChargeItem {
  name: string
  value: number
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  appointment: Appointment
  patientPlan?: PatientPlan | null
  discountPercent?: number
}>(), {
  patientPlan: null,
  discountPercent: 0,
})

const emit = defineEmits<{ close: []; charged: [] }>()

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const planName = props.patientPlan?.healthPlan?.name
const baseValue = props.patientPlan?.value ?? props.patientPlan?.healthPlan?.defaultValue ?? props.appointment.value ?? 0

const items = ref<ChargeItem[]>([
  { name: planName ? `Consulta — ${planName}` : 'Consulta', value: baseValue },
])
const selectedProcedureId = ref('')
const selectedMethodId = ref('')
const notes = ref('')
const loading = ref(false)

const valor = computed(() => items.value.reduce((sum, item) => sum + (item.value || 0), 0))
const repasseValue = computed(() => Math.floor(valor.value * (1 - props.discountPercent / 100) * 100) / 100)

const { data: methodsRaw } = useQuery<PaymentMethod[]>({
  key: 'financial-payment-methods',
  queryFn: () => api.get('/financial/payment-methods').then(r => r.data),
  enabled: computed(() => props.isOpen),
})
const methods = computed<PaymentMethod[]>(() => methodsRaw.value ?? [])

const { data: appointmentTypesRaw } = useQuery<AppointmentType[]>({
  key: 'appointment-types',
  queryFn: () => api.get('/appointment-types').then(r => r.data),
  enabled: computed(() => props.isOpen),
})
const appointmentTypes = computed<AppointmentType[]>(() => appointmentTypesRaw.value ?? [])

const selectedMethod = computed(() => methods.value.find(m => m.id === selectedMethodId.value))

function suggestedValueFor(typeId: string) {
  const override = props.patientPlan?.healthPlan?.procedures?.find(p => p.appointmentTypeId === typeId)
  if (override) return override.value
  const type = appointmentTypes.value.find(t => t.id === typeId)
  return type?.baseValue ?? 0
}

function handleAddProcedure() {
  if (!selectedProcedureId.value) return
  const type = appointmentTypes.value.find(t => t.id === selectedProcedureId.value)
  if (!type) return
  items.value = [...items.value, { name: type.name, value: suggestedValueFor(selectedProcedureId.value) }]
  selectedProcedureId.value = ''
}

function handleItemValueChange(index: number, newValue: number) {
  items.value = items.value.map((item, i) => (i === index ? { ...item, value: newValue } : item))
}

function handleRemoveItem(index: number) {
  items.value = items.value.filter((_, i) => i !== index)
}

async function handleSubmit() {
  if (valor.value <= 0) {
    toast.error('Informe um valor válido')
    return
  }
  loading.value = true
  try {
    await api.post(`/appointments/${props.appointment.id}/charge`, {
      amount: valor.value,
      repasseValue: repasseValue.value,
      items: items.value,
      paymentMethodId: selectedMethodId.value || undefined,
      paymentMethodName: selectedMethod.value?.name || undefined,
      notes: notes.value || undefined,
    })
    toast.success('Lançado no financeiro!')
    emit('charged')
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    if (msg === 'Este agendamento já foi cobrado') {
      toast.error('Este agendamento já foi cobrado')
    } else {
      toast.error('Erro ao lançar cobrança')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Cobrar Consulta" :subtitle="appointment.patient.name" size="md" @close="emit('close')">
    <div class="space-y-5">
      <!-- Info card -->
      <div class="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2.5">
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-500">Data</span>
          <span class="font-medium text-slate-800">
            {{ format(new Date(appointment.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) }}
          </span>
        </div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-500">Paciente</span>
          <span class="font-medium text-slate-800">{{ appointment.patient.name }}</span>
        </div>
        <div v-if="planName" class="flex items-center justify-between text-sm">
          <span class="flex items-center gap-1.5 text-slate-500">
            <HeartPulse class="w-3.5 h-3.5" />
            Convênio
          </span>
          <span class="font-medium text-primary-700">{{ planName }}</span>
        </div>
      </div>

      <!-- Itens cobrados -->
      <div>
        <label class="label flex items-center gap-1.5">
          <DollarSign class="w-3.5 h-3.5 text-slate-400" />
          Itens cobrados
        </label>
        <div class="space-y-2">
          <div v-for="(item, idx) in items" :key="idx" class="flex items-center gap-2">
            <span class="flex-1 text-sm text-slate-700 truncate">{{ item.name }}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              :value="item.value"
              class="input-field w-28 text-right font-medium"
              @input="handleItemValueChange(idx, parseFloat(($event.target as HTMLInputElement).value) || 0)"
            />
            <button type="button" class="text-slate-400 hover:text-red-600 flex-shrink-0" @click="handleRemoveItem(idx)">
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="flex gap-2 mt-3">
          <select v-model="selectedProcedureId" class="input-field flex-1">
            <option value="">Adicionar procedimento...</option>
            <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <button
            type="button"
            class="btn-secondary px-3 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!selectedProcedureId"
            @click="handleAddProcedure"
          >
            <Plus class="w-4 h-4" />
          </button>
        </div>

        <div class="flex items-center justify-between mt-3 px-1">
          <span class="text-sm font-semibold text-slate-600">Valor cobrado</span>
          <span class="text-lg font-bold text-slate-900">{{ currency(valor) }}</span>
        </div>
      </div>

      <!-- Breakdown repasse — mostra sempre que há desconto configurado -->
      <div v-if="discountPercent > 0" class="rounded-xl border border-slate-200 overflow-hidden text-sm">
        <div class="flex items-center justify-between px-4 py-2.5 bg-slate-50">
          <span class="text-slate-500">Valor do paciente</span>
          <span class="font-medium text-slate-700">{{ currency(valor) }}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-200">
          <span class="text-slate-500">Comissão clínica ({{ discountPercent }}%)</span>
          <span class="font-medium text-red-600">−{{ currency(valor - repasseValue) }}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-3 bg-emerald-50 border-t border-emerald-200">
          <span class="text-emerald-700 font-semibold">Repasse médico ({{ 100 - discountPercent }}%)</span>
          <span class="text-base font-bold text-emerald-800">{{ currency(repasseValue) }}</span>
        </div>
      </div>

      <!-- Forma de pagamento -->
      <div>
        <label class="label flex items-center gap-1.5">
          <CreditCard class="w-3.5 h-3.5 text-slate-400" />
          Forma de pagamento
        </label>
        <select v-model="selectedMethodId" class="input-field">
          <option value="">Não informado</option>
          <option v-for="m in methods" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>

      <!-- Observações -->
      <div>
        <label class="label">Observações (opcional)</label>
        <textarea
          v-model="notes"
          rows="2"
          class="input-field resize-none"
          placeholder="Informações adicionais sobre este pagamento..."
        />
      </div>

      <!-- Submit -->
      <button
        type="button"
        class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        :disabled="loading || valor <= 0"
        @click="handleSubmit"
      >
        <template v-if="loading">
          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Lançando...
        </template>
        <template v-else>
          <DollarSign class="w-4 h-4" />
          Lançar no Financeiro — {{ currency(discountPercent > 0 ? repasseValue : valor) }}
        </template>
      </button>
    </div>
  </Modal>
</template>
