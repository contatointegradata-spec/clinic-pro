<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { z } from 'zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Plus, Package, PackagePlus, Edit2, CheckCircle, XCircle, AlertTriangle, History, ArrowDownCircle, ArrowUpCircle } from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import type { Product, StockMovement } from '../types'
import Modal from '../components/ui/Modal.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { useQuery } from '../composables/useQuery'

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  unit: z.string().min(1, 'Unidade obrigatória'),
  minQuantity: z.coerce.number().int().min(0).optional(),
})
type FormData = z.infer<typeof schema>

const { data: productsData, refetch: refetchProducts } = useQuery<Product[]>({
  key: 'stock-products',
  queryFn: () => api.get('/stock/products').then(r => r.data),
})
const products = computed(() => productsData.value ?? [])
const activeCount = computed(() => products.value.filter(p => p.active).length)
const lowStockCount = computed(() => products.value.filter(p => isLowStock(p)).length)

function isLowStock(p: Product): boolean {
  return p.minQuantity != null && p.quantity <= p.minQuantity
}

// ─── Criar/editar produto ───────────────────────────────────────────────────

const modalOpen = ref(false)
const editProduct = ref<Product | null>(null)
const saving = ref(false)
const form = reactive<FormData>({ name: '', unit: '', minQuantity: undefined })
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editProduct, (p) => {
  form.name = p?.name || ''
  form.unit = p?.unit || ''
  form.minQuantity = p?.minQuantity ?? undefined
  errors.name = undefined
  errors.unit = undefined
}, { immediate: true })

function handleNew() { editProduct.value = null; modalOpen.value = true }
function handleEdit(p: Product) { editProduct.value = p; modalOpen.value = true }
function closeModal() { modalOpen.value = false; editProduct.value = null }

async function handleSubmit() {
  errors.name = undefined
  errors.unit = undefined
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
    if (editProduct.value) {
      await api.put(`/stock/products/${editProduct.value.id}`, result.data)
    } else {
      await api.post('/stock/products', result.data)
    }
    toast.success(editProduct.value ? 'Produto atualizado!' : 'Produto cadastrado!')
    closeModal()
    await refetchProducts()
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
    await api.patch(`/stock/products/${id}/toggle`)
    toast.success('Status alterado')
    await refetchProducts()
  } finally {
    toggling.value = false
  }
}

// ─── Entrada manual ──────────────────────────────────────────────────────────

const entryModalOpen = ref(false)
const entryProduct = ref<Product | null>(null)
const entryQuantity = ref<number>(1)
const entryReason = ref('')
const entrying = ref(false)

function openEntry(p: Product) {
  entryProduct.value = p
  entryQuantity.value = 1
  entryReason.value = ''
  entryModalOpen.value = true
}

async function submitEntry() {
  if (!entryProduct.value || entryQuantity.value <= 0) return
  entrying.value = true
  try {
    await api.post(`/stock/products/${entryProduct.value.id}/entry`, {
      quantity: entryQuantity.value,
      reason: entryReason.value || undefined,
    })
    toast.success('Entrada registrada!')
    entryModalOpen.value = false
    await Promise.all([refetchProducts(), refetchMovements()])
  } catch {
    toast.error('Erro ao registrar entrada')
  } finally {
    entrying.value = false
  }
}

// ─── Histórico ───────────────────────────────────────────────────────────────

const showHistory = ref(false)
const { data: movementsData, refetch: refetchMovements } = useQuery<StockMovement[]>({
  key: 'stock-movements',
  queryFn: () => api.get('/stock/movements').then(r => r.data),
})
const movements = computed(() => movementsData.value ?? [])
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 page-stagger">
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <PageHeader title="Estoque" subtitle="Produtos e medicamentos da clínica" />
      <button class="btn-primary self-start" @click="handleNew">
        <Plus class="w-4 h-4" />
        Novo produto
      </button>
    </div>

    <div v-if="products.length > 0" class="flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-sm">
        <Package class="w-4 h-4 text-slate-400" />
        <span><strong class="font-bold tabular-nums">{{ products.length }}</strong> produto{{ products.length !== 1 ? 's' : '' }}</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
        <CheckCircle class="w-4 h-4 text-emerald-500" />
        <span><strong class="font-bold tabular-nums">{{ activeCount }}</strong> ativo{{ activeCount !== 1 ? 's' : '' }}</span>
      </div>
      <div v-if="lowStockCount > 0" class="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl">
        <AlertTriangle class="w-4 h-4 text-amber-500" />
        <span><strong class="font-bold tabular-nums">{{ lowStockCount }}</strong> com estoque baixo</span>
      </div>
    </div>

    <div v-if="products.length === 0" class="card text-center py-14">
      <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Package class="w-7 h-7 text-slate-300" />
      </div>
      <p class="text-slate-500 font-medium">Nenhum produto cadastrado</p>
      <p class="text-slate-400 text-sm mt-1">Cadastre produtos/medicamentos pra começar a controlar o estoque</p>
      <button class="mt-4 btn-primary text-sm" @click="handleNew">
        <Plus class="w-3.5 h-3.5" />
        Cadastrar primeiro produto
      </button>
    </div>
    <div v-else class="card p-0 overflow-hidden">
      <div class="divide-y divide-slate-100">
        <div
          v-for="p in products" :key="p.id"
          class="flex items-center gap-4 px-5 py-4 group hover:bg-slate-50 transition-colors duration-150"
          :class="!p.active ? 'opacity-60' : ''"
        >
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
            :class="isLowStock(p) ? 'bg-amber-50 border-amber-200' : 'bg-primary-50 border-primary-100'"
          >
            <AlertTriangle v-if="isLowStock(p)" class="w-4.5 h-4.5 text-amber-500" />
            <Package v-else class="w-4.5 h-4.5 text-primary-600" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="font-semibold text-slate-900 group-hover:text-primary-700 transition-colors duration-150">{{ p.name }}</p>
              <span v-if="!p.active" class="text-xs bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full">Inativo</span>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">
              <span class="font-semibold tabular-nums" :class="isLowStock(p) ? 'text-amber-600' : 'text-slate-600'">{{ p.quantity }} {{ p.unit }}</span>
              <span v-if="p.minQuantity != null"> · mínimo {{ p.minQuantity }} {{ p.unit }}</span>
            </p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button class="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Entrada de estoque" @click="openEntry(p)">
              <PackagePlus class="w-4 h-4" />
            </button>
            <button class="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Editar" @click="handleEdit(p)">
              <Edit2 class="w-4 h-4" />
            </button>
            <button
              :disabled="toggling"
              class="p-1.5 rounded-lg transition-colors"
              :class="p.active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'"
              :title="p.active ? 'Desativar' : 'Ativar'"
              @click="handleToggle(p.id)"
            >
              <XCircle v-if="p.active" class="w-4 h-4" />
              <CheckCircle v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Histórico -->
    <div class="card p-0 overflow-hidden">
      <button class="w-full flex items-center justify-between px-5 py-4 text-left" @click="showHistory = !showHistory">
        <span class="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <History class="w-4 h-4 text-slate-400" />
          Histórico de movimentações
        </span>
        <span class="text-xs text-slate-400">{{ showHistory ? 'Ocultar' : 'Mostrar' }}</span>
      </button>
      <div v-if="showHistory" class="border-t border-slate-100">
        <p v-if="movements.length === 0" class="text-center text-slate-400 text-sm py-8">Nenhuma movimentação registrada ainda</p>
        <div v-else class="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          <div v-for="m in movements" :key="m.id" class="flex items-center gap-3 px-5 py-3">
            <ArrowUpCircle v-if="m.type === 'ENTRADA'" class="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <ArrowDownCircle v-else class="w-4 h-4 text-red-500 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-800">
                <strong>{{ m.product?.name }}</strong>
                — {{ m.type === 'ENTRADA' ? '+' : '-' }}{{ m.quantity }} {{ m.product?.unit }}
              </p>
              <p class="text-xs text-slate-400">
                {{ format(new Date(m.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) }}
                <template v-if="m.user"> · {{ m.user.name }}</template>
                <template v-if="m.reason"> · {{ m.reason }}</template>
                <template v-if="m.appointmentId"> · baixa automática (consulta)</template>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Modal :is-open="modalOpen" :title="editProduct ? 'Editar Produto' : 'Novo Produto'" @close="closeModal">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Seringa 5ml, Dipirona injetável..." />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>
        <div>
          <label class="label">Unidade *</label>
          <input v-model="form.unit" class="input-field" placeholder="Ex: un, ml, caixa..." />
          <p v-if="errors.unit" class="text-xs text-red-500 mt-1">{{ errors.unit }}</p>
        </div>
        <div>
          <label class="label">Estoque mínimo (opcional)</label>
          <input v-model.number="form.minQuantity" type="number" min="0" class="input-field" placeholder="Avisa quando o saldo chegar aqui" />
        </div>
        <button type="submit" :disabled="saving" class="btn-primary w-full">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editProduct ? 'Atualizar Produto' : 'Cadastrar Produto' }}</template>
        </button>
      </form>
    </Modal>

    <Modal :is-open="entryModalOpen" :title="`Entrada — ${entryProduct?.name ?? ''}`" size="sm" @close="entryModalOpen = false">
      <form class="space-y-4" @submit.prevent="submitEntry">
        <div>
          <label class="label">Quantidade a adicionar *</label>
          <input v-model.number="entryQuantity" type="number" min="1" class="input-field" />
        </div>
        <div>
          <label class="label">Motivo (opcional)</label>
          <input v-model="entryReason" class="input-field" placeholder="Ex: Compra, reposição..." />
        </div>
        <button type="submit" :disabled="entrying || entryQuantity <= 0" class="btn-primary w-full">
          {{ entrying ? 'Registrando...' : 'Registrar entrada' }}
        </button>
      </form>
    </Modal>
  </div>
</template>
