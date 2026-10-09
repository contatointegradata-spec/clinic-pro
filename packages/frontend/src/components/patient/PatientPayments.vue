<script setup lang="ts">
import { ref, computed } from 'vue'
import { Wallet, Receipt } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { brl } from '../../lib/clinical'

const props = defineProps<{ patientId: string }>()

interface Tx {
  id: string
  type: 'INCOME' | 'EXPENSE'
  amount: number
  description: string
  date: string
  status: 'PENDING' | 'PAID' | 'CANCELLED'
  paidAt: string | null
  paymentMethod: string | null
  paymentMethodRef: { name: string } | null
  nfse: { status: string; numeroNfse: string | null } | null
}

const STATUS: Record<Tx['status'], { label: string; chip: string }> = {
  PAID: { label: 'Pago', chip: 'bg-emerald-50 text-emerald-700' },
  PENDING: { label: 'Em aberto', chip: 'bg-amber-50 text-amber-700' },
  CANCELLED: { label: 'Cancelado', chip: 'bg-slate-100 text-slate-400' },
}

const items = ref<Tx[]>([])
const summary = ref({ paid: 0, pending: 0 })
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ transactions: Tx[]; summary: { paid: number; pending: number } }>(`/clinical/patients/${props.patientId}/payments`)
    items.value = data.transactions
    summary.value = data.summary
  } catch {
    toast.error('Não foi possível carregar os pagamentos')
  } finally {
    loading.value = false
  }
}
load()

const income = computed(() => items.value.filter(t => t.type === 'INCOME'))
// O lançamento guarda a data do atendimento; "dayLabel" usa UTC, aqui é data/hora real.
function day(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR')
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid sm:grid-cols-2 gap-3">
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total pago</p>
        <p class="mt-1 font-display text-2xl font-semibold text-emerald-700 tabular-nums">{{ brl(summary.paid) }}</p>
      </div>
      <div class="card p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Em aberto</p>
        <p :class="['mt-1 font-display text-2xl font-semibold tabular-nums', summary.pending > 0 ? 'text-amber-700' : 'text-slate-900']">{{ brl(summary.pending) }}</p>
      </div>
    </div>

    <div v-if="loading" class="h-32 skeleton" />
    <div v-else-if="income.length === 0" class="card text-center py-10">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><Wallet class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum pagamento registrado</p>
      <p class="text-xs text-slate-500 mt-1">Cobranças da agenda e do prontuário aparecem aqui automaticamente.</p>
    </div>
    <div v-else class="card p-0 divide-y divide-slate-100">
      <div v-for="t in income" :key="t.id" class="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-800 truncate">{{ t.description }}</p>
          <p class="text-xs text-slate-500">
            {{ day(t.date) }}
            <template v-if="t.paymentMethodRef?.name || t.paymentMethod"> · {{ t.paymentMethodRef?.name || t.paymentMethod }}</template>
            <template v-if="t.paidAt && t.status === 'PAID'"> · pago em {{ day(t.paidAt) }}</template>
          </p>
        </div>
        <span v-if="t.nfse" class="inline-flex items-center gap-1 text-[11px] text-slate-500"><Receipt class="w-3 h-3" /> NFS-e {{ t.nfse.numeroNfse ?? t.nfse.status.toLowerCase() }}</span>
        <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', STATUS[t.status].chip]">{{ STATUS[t.status].label }}</span>
        <span class="text-sm font-semibold tabular-nums w-28 text-right">{{ brl(t.amount) }}</span>
      </div>
    </div>
    <p class="text-xs text-slate-400">Para dar baixa, estornar ou emitir nota fiscal, use o Financeiro.</p>
  </div>
</template>
