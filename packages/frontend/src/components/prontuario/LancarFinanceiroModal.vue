<script setup lang="ts">
import { computed, ref } from 'vue'
import { DollarSign, CreditCard } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { MedicalRecord, PaymentMethod } from '../../types'
import Modal from '../ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

const props = defineProps<{
  isOpen: boolean
  record: MedicalRecord
}>()

const emit = defineEmits<{ close: []; charged: [] }>()

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const selectedMethodId = ref('')
const notes = ref('')
const loading = ref(false)

const procedures = computed(() => props.record.procedures ?? [])
const total = computed(() => procedures.value.reduce((sum, p) => sum + p.valorPago, 0))

const isOpenRef = computed(() => props.isOpen)

const { data: methodsData } = useQuery<PaymentMethod[]>({
  key: 'financial-payment-methods',
  queryFn: () => api.get('/financial/payment-methods').then(r => r.data),
  enabled: isOpenRef,
})
const methods = computed(() => methodsData.value ?? [])

const selectedMethod = computed(() => methods.value.find(m => m.id === selectedMethodId.value))

async function handleSubmit() {
  if (total.value <= 0) {
    toast.error('Nenhum procedimento com valor a lançar')
    return
  }
  loading.value = true
  try {
    await api.post(`/medical-records/${props.record.id}/charge`, {
      paymentMethodId: selectedMethodId.value || undefined,
      paymentMethodName: selectedMethod.value?.name || undefined,
      notes: notes.value || undefined,
    })
    toast.success('Lançado no financeiro!')
    emit('charged')
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg || 'Erro ao lançar no financeiro')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Lançar Financeiro" :subtitle="record.patient?.name" size="md" @close="emit('close')">
    <div class="space-y-5">
      <div class="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
        <div v-for="p in procedures" :key="p.id" class="flex items-center justify-between px-4 py-2.5 text-sm">
          <span class="text-slate-700 flex items-center gap-2">
            {{ p.name }}
            <span v-if="p.valorPago === 0" class="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Cortesia</span>
          </span>
          <span class="font-medium text-slate-800">{{ currency(p.valorPago) }}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-3 bg-emerald-50">
          <span class="text-emerald-700 font-semibold text-sm">Total</span>
          <span class="text-base font-bold text-emerald-800">{{ currency(total) }}</span>
        </div>
      </div>

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

      <div>
        <label class="label">Observações (opcional)</label>
        <textarea
          v-model="notes"
          rows="2"
          class="input-field resize-none"
          placeholder="Informações adicionais sobre este pagamento..."
        />
      </div>

      <button
        type="button"
        :disabled="loading || total <= 0"
        class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        @click="handleSubmit"
      >
        <template v-if="loading">
          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Lançando...
        </template>
        <template v-else>
          <DollarSign class="w-4 h-4" />
          Lançar no Financeiro — {{ currency(total) }}
        </template>
      </button>
    </div>
  </Modal>
</template>
