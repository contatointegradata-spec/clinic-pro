<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Landmark } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import Modal from '../../components/ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

interface BankAccount {
  id: string
  name: string
  bank?: string | null
  agency?: string | null
  account?: string | null
  type: 'CHECKING' | 'SAVINGS' | 'CASH'
  balance: number
  createdAt: string
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CHECKING: 'Conta Corrente',
  SAVINGS: 'Poupança',
  CASH: 'Caixa / Dinheiro',
}

function currency(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

const schema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH']),
  bank: z.string().trim().optional(),
  agency: z.string().trim().optional(),
  account: z.string().trim().optional(),
  balance: z.string().optional().refine(v => !v || !isNaN(parseFloat(v)), 'Saldo inválido'),
})

type FormData = z.infer<typeof schema>

const { data: accountsRaw, isLoading, refetch } = useQuery<BankAccount[]>({
  key: 'bank-accounts',
  queryFn: () => api.get('/financial/bank-accounts').then(r => r.data),
})
const accounts = computed(() => accountsRaw.value ?? [])

const modalOpen = ref(false)
const editItem = ref<BankAccount | null>(null)
const saving = ref(false)

const form = reactive<FormData>({
  name: '',
  type: 'CHECKING',
  bank: '',
  agency: '',
  account: '',
  balance: '0',
})
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editItem, (item) => {
  form.name = item?.name ?? ''
  form.type = item?.type ?? 'CHECKING'
  form.bank = item?.bank ?? ''
  form.agency = item?.agency ?? ''
  form.account = item?.account ?? ''
  form.balance = item ? String(item.balance ?? 0) : '0'
  for (const key of Object.keys(errors) as (keyof FormData)[]) errors[key] = undefined
})

function handleNew() {
  editItem.value = null
  form.name = ''
  form.type = 'CHECKING'
  form.bank = ''
  form.agency = ''
  form.account = ''
  form.balance = '0'
  modalOpen.value = true
}

function handleEdit(acc: BankAccount) {
  editItem.value = acc
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editItem.value = null
}

async function handleSubmit() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) errors[key] = undefined

  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  const payload = {
    name: result.data.name,
    type: result.data.type,
    bank: result.data.bank || undefined,
    agency: result.data.agency || undefined,
    account: result.data.account || undefined,
    balance: parseFloat(result.data.balance || '0') || 0,
  }

  saving.value = true
  try {
    if (editItem.value) {
      await api.put(`/financial/bank-accounts/${editItem.value.id}`, payload)
    } else {
      await api.post('/financial/bank-accounts', payload)
    }
    toast.success(editItem.value ? 'Conta atualizada!' : 'Conta criada!')
    closeModal()
    await refetch()
  } catch {
    toast.error('Erro ao salvar conta')
  } finally {
    saving.value = false
  }
}

async function handleDelete(acc: BankAccount) {
  if (!confirm('Remover esta conta?')) return
  try {
    await api.delete(`/financial/bank-accounts/${acc.id}`)
    toast.success('Conta removida')
    await refetch()
  } catch {
    toast.error('Erro ao remover conta')
  }
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Contas Bancárias" subtitle="Gerencie suas contas bancárias e saldos">
      <template #actions>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Nova Conta
        </button>
      </template>
    </PageHeader>

    <div v-if="isLoading" class="py-20 flex items-center justify-center">
      <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
    </div>

    <div v-else-if="accounts.length === 0" class="card">
      <div class="empty-state py-12">
        <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
          <Landmark class="w-7 h-7 text-slate-300" />
        </div>
        <p class="text-slate-500 font-semibold">Nenhuma conta bancária cadastrada</p>
        <p class="text-slate-400 text-sm mt-1">Adicione contas para controlar seus saldos</p>
        <button class="mt-4 btn-primary text-xs" @click="handleNew">
          <Plus class="w-3.5 h-3.5" />
          Nova Conta
        </button>
      </div>
    </div>

    <div v-else class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Nome</th>
              <th class="table-head-cell hidden md:table-cell">Banco</th>
              <th class="table-head-cell hidden lg:table-cell">Agência / Conta</th>
              <th class="table-head-cell">Tipo</th>
              <th class="table-head-cell text-right">Saldo</th>
              <th class="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(acc, idx) in accounts" :key="acc.id" class="table-row group" :style="{ animationDelay: `${idx * 0.03}s` }">
              <td class="table-cell">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <Landmark class="w-4 h-4 text-primary-600" />
                  </div>
                  <p class="text-sm font-medium text-slate-900">{{ acc.name }}</p>
                </div>
              </td>
              <td class="table-cell text-slate-600 hidden md:table-cell">
                {{ acc.bank ?? '—' }}
              </td>
              <td class="table-cell text-slate-500 text-xs hidden lg:table-cell">
                <template v-if="acc.agency && acc.account">Ag. {{ acc.agency }} / CC {{ acc.account }}</template>
                <template v-else>{{ acc.agency || acc.account || '—' }}</template>
              </td>
              <td class="table-cell">
                <span class="text-xs bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full font-medium">
                  {{ ACCOUNT_TYPE_LABEL[acc.type] }}
                </span>
              </td>
              <td class="table-cell text-right font-bold tabular-nums" :class="acc.balance >= 0 ? 'text-emerald-600' : 'text-red-600'">
                {{ currency(acc.balance) }}
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <button class="btn-icon w-7 h-7 hover:text-primary-600 hover:bg-primary-50" @click="handleEdit(acc)">
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-icon w-7 h-7 hover:text-red-600 hover:bg-red-50" @click="handleDelete(acc)">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :is-open="modalOpen" :title="editItem ? 'Editar Conta' : 'Nova Conta Bancária'" @close="closeModal">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome da Conta *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Conta Principal, Caixa Clínica" autofocus />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div>
          <label class="label">Tipo de Conta *</label>
          <select v-model="form.type" class="input-field">
            <option value="CHECKING">Conta Corrente</option>
            <option value="SAVINGS">Poupança</option>
            <option value="CASH">Caixa / Dinheiro</option>
          </select>
        </div>

        <template v-if="form.type !== 'CASH'">
          <div>
            <label class="label">Banco</label>
            <input v-model="form.bank" class="input-field" placeholder="Ex: Bradesco, Itaú, Nubank..." />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">Agência</label>
              <input v-model="form.agency" class="input-field" placeholder="0000" />
            </div>
            <div>
              <label class="label">Número da Conta</label>
              <input v-model="form.account" class="input-field" placeholder="00000-0" />
            </div>
          </div>
        </template>

        <div>
          <label class="label">Saldo Inicial (R$)</label>
          <input v-model="form.balance" type="number" step="0.01" class="input-field" placeholder="0,00" />
          <p v-if="errors.balance" class="text-xs text-red-500 mt-1">{{ errors.balance }}</p>
          <p v-else class="text-xs text-slate-400 mt-1">Saldo atual ou inicial da conta</p>
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full mt-2">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editItem ? 'Atualizar Conta' : 'Criar Conta' }}</template>
        </button>
      </form>
    </Modal>
  </div>
</template>
