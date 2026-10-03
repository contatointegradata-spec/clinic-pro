<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { z } from 'zod'
import { Plus, Edit2, Wallet, CheckCircle, XCircle } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import type { PaymentMethod } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

const PAYMENT_TYPES = [
  { value: 'PIX', label: 'Pix', icon: '⚡', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { value: 'CARTAO_CREDITO', label: 'Crédito', icon: '💳', color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
  { value: 'CARTAO_DEBITO', label: 'Débito', icon: '🏦', color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200' },
  { value: 'DINHEIRO', label: 'Dinheiro', icon: '💵', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  { value: 'CHEQUE', label: 'Cheque', icon: '📝', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  { value: 'TRANSFERENCIA', label: 'Transferência', icon: '🔄', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  { value: 'OUTROS', label: 'Outros', icon: '💰', color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
] as const

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  type: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CHEQUE', 'DINHEIRO', 'TRANSFERENCIA', 'OUTROS']),
  instructions: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const modalOpen = ref(false)
const editMethod = ref<PaymentMethod | null>(null)
const saving = ref(false)

const { data: methodsData, refetch: refetchMethods } = useQuery<PaymentMethod[]>({
  key: 'payment-methods',
  queryFn: () => api.get('/payment-methods').then(r => r.data),
})
const methods = computed(() => methodsData.value ?? [])
const activeCount = computed(() => methods.value.filter(m => m.active).length)

function typeConfig(type: string) {
  return PAYMENT_TYPES.find(t => t.value === type) ?? PAYMENT_TYPES[PAYMENT_TYPES.length - 1]
}

// ─── Form ─────────────────────────────────────────────────────────────────────

const form = reactive<FormData>({ name: '', type: 'PIX', instructions: '' })
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editMethod, (m) => {
  form.name = m?.name || ''
  form.type = m?.type || 'PIX'
  form.instructions = m?.instructions || ''
  errors.name = undefined
}, { immediate: true })

const placeholderText = computed(() => {
  if (form.type === 'PIX') return 'Ex: Chave Pix: 11999990000 (CPF ou email)'
  if (form.type === 'CARTAO_CREDITO') return 'Ex: Aceitamos até 12x sem juros'
  return `Instruções para pagamento via ${typeConfig(form.type).label}...`
})

function handleNew() { editMethod.value = null; modalOpen.value = true }
function handleEdit(m: PaymentMethod) { editMethod.value = m; modalOpen.value = true }
function closeModal() { modalOpen.value = false; editMethod.value = null }

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
    if (editMethod.value) {
      await api.put(`/payment-methods/${editMethod.value.id}`, result.data)
    } else {
      await api.post('/payment-methods', result.data)
    }
    toast.success(editMethod.value ? 'Atualizado!' : 'Forma de pagamento adicionada!')
    closeModal()
    await refetchMethods()
  } catch {
    toast.error('Erro ao salvar')
  } finally {
    saving.value = false
  }
}

const toggling = ref(false)
async function handleToggle(id: string) {
  toggling.value = true
  try {
    await api.patch(`/payment-methods/${id}/toggle`)
    toast.success('Status alterado')
    await refetchMethods()
  } finally {
    toggling.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 page-stagger">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div class="animate-stagger-1">
        <h1 class="page-title">Formas de Pagamento</h1>
        <p class="page-subtitle">Configure como você recebe dos pacientes</p>
      </div>
      <button class="btn-primary self-start animate-stagger-1" @click="handleNew">
        <Plus class="w-4 h-4" />
        Adicionar
      </button>
    </div>

    <!-- Stats chips -->
    <div v-if="methods.length > 0" class="flex items-center gap-3 animate-stagger-2">
      <div class="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-sm">
        <Wallet class="w-4 h-4 text-slate-400" />
        <span>
          <strong class="font-bold tabular-nums">{{ methods.length }}</strong>
          método{{ methods.length !== 1 ? 's' : '' }}
        </span>
      </div>
      <div class="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
        <CheckCircle class="w-4 h-4 text-emerald-500" />
        <span>
          <strong class="font-bold tabular-nums">{{ activeCount }}</strong>
          ativo{{ activeCount !== 1 ? 's' : '' }}
        </span>
      </div>
    </div>

    <!-- List -->
    <div v-if="methods.length === 0" class="card text-center py-14 animate-stagger-2">
      <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-float">
        <Wallet class="w-7 h-7 text-slate-300" />
      </div>
      <p class="text-slate-500 font-medium">Nenhuma forma de pagamento cadastrada</p>
      <p class="text-slate-400 text-sm mt-1">Adicione métodos para seus pacientes saberem como pagar</p>
      <button class="mt-4 btn-primary text-sm" @click="handleNew">
        <Plus class="w-3.5 h-3.5" />
        Adicionar primeira forma
      </button>
    </div>
    <div v-else class="card p-0 overflow-hidden animate-stagger-3">
      <div class="divide-y divide-slate-100">
        <div
          v-for="(m, idx) in methods" :key="m.id"
          class="flex items-center gap-4 px-5 py-4 group hover:bg-slate-50 transition-colors duration-150"
          :class="!m.active ? 'opacity-60' : ''"
          :style="{ animationDelay: `${idx * 0.04}s` }"
        >
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 border"
            :class="[typeConfig(m.type).bg, typeConfig(m.type).border]"
          >
            {{ typeConfig(m.type).icon }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900 group-hover:text-primary-700 transition-colors duration-150">
                {{ m.name }}
              </p>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium border" :class="[typeConfig(m.type).bg, typeConfig(m.type).color, typeConfig(m.type).border]">
                {{ typeConfig(m.type).label }}
              </span>
              <span v-if="!m.active" class="text-xs bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full">
                Inativo
              </span>
            </div>
            <p v-if="m.instructions" class="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{{ m.instructions }}</p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity duration-150">
            <button
              class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title="Editar"
              @click="handleEdit(m)"
            >
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              :disabled="toggling"
              class="p-1.5 rounded-lg transition-colors"
              :class="m.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
              :title="m.active ? 'Desativar' : 'Ativar'"
              @click="handleToggle(m.id)"
            >
              <XCircle v-if="m.active" class="w-4 h-4" />
              <CheckCircle v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <Modal
      :is-open="modalOpen"
      :title="editMethod ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento'"
      @close="closeModal"
    >
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Pix pessoal, Maquininha Cielo..." />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div>
          <label class="label mb-2">Tipo de pagamento *</label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label
              v-for="t in PAYMENT_TYPES" :key="t.value"
              class="flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all duration-150"
              :class="form.type === t.value ? `${t.bg} ${t.border} shadow-sm` : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'"
            >
              <input v-model="form.type" type="radio" :value="t.value" class="sr-only" />
              <span class="text-base">{{ t.icon }}</span>
              <span class="text-xs font-medium" :class="form.type === t.value ? t.color : 'text-slate-600'">
                {{ t.label }}
              </span>
            </label>
          </div>
        </div>

        <div>
          <label class="label">Instruções / Dados para pagamento</label>
          <textarea v-model="form.instructions" rows="3" class="input-field resize-none" :placeholder="placeholderText" />
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editMethod ? 'Atualizar Forma de Pagamento' : 'Adicionar Forma de Pagamento' }}</template>
        </button>
      </form>
    </Modal>
  </div>
</template>
