<script setup lang="ts">
import { reactive, watch } from 'vue'
import { z } from 'zod'
import { format } from 'date-fns'
import type { Transaction, User, AuthUser, Patient, TransactionType, TransactionStatus } from '../../types'

const schema = z.object({
  doctorId: z.string().min(1, 'Selecione um médico'),
  patientId: z.string().optional(),
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().min(2, 'Descrição muito curta'),
  date: z.string().min(1, 'Data obrigatória'),
  status: z.enum(['PENDING', 'PAID', 'CANCELLED']),
  category: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const props = defineProps<{
  transaction: Transaction | null
  doctors: User[]
  patients: Patient[]
  currentUser: AuthUser | null
  loading: boolean
}>()

const emit = defineEmits<{ submit: [data: FormData] }>()

const CATEGORIES: Record<TransactionType, string[]> = {
  INCOME: ['Consulta', 'Retorno', 'Exame', 'Procedimento', 'Plano de Saúde', 'Outros'],
  EXPENSE: ['Material', 'Equipamento', 'Aluguel', 'Salário', 'Impostos', 'Marketing', 'Outros'],
}

const TYPE_OPTIONS: Array<{ value: TransactionType; label: string; active: string }> = [
  { value: 'INCOME', label: 'Receita', active: 'bg-emerald-500 text-white' },
  { value: 'EXPENSE', label: 'Despesa', active: 'bg-red-500 text-white' },
]

const form = reactive<{
  doctorId: string
  patientId: string
  type: TransactionType
  amount: number | string
  description: string
  date: string
  status: TransactionStatus
  category: string
}>({
  doctorId: props.currentUser?.role === 'DOCTOR' ? props.currentUser.id : '',
  patientId: '',
  type: 'INCOME',
  amount: '',
  description: '',
  date: format(new Date(), 'yyyy-MM-dd'),
  status: 'PENDING',
  category: '',
})

const errors = reactive<Partial<Record<keyof FormData, string>>>({})

// Mirrors the original react-hook-form `useEffect` that resets the form
// whenever the `transaction` prop changes (edit vs. new).
watch(
  () => props.transaction,
  (transaction) => {
    if (transaction) {
      form.doctorId = transaction.doctorId
      form.patientId = transaction.patientId || ''
      form.type = transaction.type
      form.amount = transaction.amount
      form.description = transaction.description
      form.date = format(new Date(transaction.date), 'yyyy-MM-dd')
      form.status = transaction.status
      form.category = transaction.category || ''
    } else {
      form.date = format(new Date(), 'yyyy-MM-dd')
    }
  },
  { immediate: true }
)

function setType(value: TransactionType) {
  form.type = value
}

function clearErrors() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    delete errors[key]
  }
}

function handleSubmit() {
  clearErrors()
  const parsed = schema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }
  emit('submit', parsed.data)
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Tipo *</label>
        <div class="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            v-for="opt in TYPE_OPTIONS"
            :key="opt.value"
            type="button"
            :class="['flex-1 py-2.5 text-sm font-medium transition-colors', form.type === opt.value ? opt.active : 'text-slate-500 hover:bg-slate-50']"
            @click="setType(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div>
        <label class="label">Valor (R$) *</label>
        <input v-model="form.amount" type="number" step="0.01" min="0" class="input-field" placeholder="0,00" />
        <p v-if="errors.amount" class="text-xs text-red-500 mt-1">{{ errors.amount }}</p>
      </div>
    </div>

    <div v-if="props.currentUser?.role === 'ADMIN'">
      <label class="label">Médico *</label>
      <select v-model="form.doctorId" class="input-field">
        <option value="">Selecione o médico</option>
        <option v-for="d in props.doctors" :key="d.id" :value="d.id">Dr(a). {{ d.name }}</option>
      </select>
      <p v-if="errors.doctorId" class="text-xs text-red-500 mt-1">{{ errors.doctorId }}</p>
    </div>

    <div v-if="form.type === 'INCOME'">
      <label class="label">Paciente (opcional)</label>
      <select v-model="form.patientId" class="input-field">
        <option value="">Não informado</option>
        <option v-for="p in props.patients" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div>
      <label class="label">Descrição *</label>
      <input v-model="form.description" class="input-field" placeholder="Ex: Consulta - João Silva" />
      <p v-if="errors.description" class="text-xs text-red-500 mt-1">{{ errors.description }}</p>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Data *</label>
        <input v-model="form.date" type="date" class="input-field" />
        <p v-if="errors.date" class="text-xs text-red-500 mt-1">{{ errors.date }}</p>
      </div>

      <div>
        <label class="label">Categoria</label>
        <select v-model="form.category" class="input-field">
          <option value="">Selecione</option>
          <option v-for="c in CATEGORIES[form.type]" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
    </div>

    <div>
      <label class="label">Status *</label>
      <select v-model="form.status" class="input-field">
        <option value="PENDING">Pendente</option>
        <option value="PAID">Pago</option>
        <option value="CANCELLED">Cancelado</option>
      </select>
    </div>

    <button type="submit" :disabled="props.loading" class="btn-primary w-full mt-2">
      <span v-if="props.loading" class="flex items-center gap-2 justify-center">
        <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        Salvando...
      </span>
      <template v-else>{{ props.transaction ? 'Atualizar Transação' : 'Adicionar Transação' }}</template>
    </button>
  </form>
</template>
