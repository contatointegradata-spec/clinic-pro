<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Layers } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader.vue'
import Modal from '../../components/ui/Modal.vue'
import { useQuery } from '../../composables/useQuery'

interface CostCenter {
  id: string
  name: string
  description?: string | null
  createdAt: string
}

const schema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório'),
  description: z.string().trim().optional(),
})

type FormData = z.infer<typeof schema>

const { data: centersRaw, isLoading, refetch } = useQuery<CostCenter[]>({
  key: 'cost-centers',
  queryFn: () => api.get('/financial/cost-centers').then(r => r.data),
})
const centers = computed(() => centersRaw.value ?? [])

const modalOpen = ref(false)
const editItem = ref<CostCenter | null>(null)
const saving = ref(false)

const form = reactive<FormData>({ name: '', description: '' })
const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(editItem, (item) => {
  form.name = item?.name ?? ''
  form.description = item?.description ?? ''
  for (const key of Object.keys(errors) as (keyof FormData)[]) errors[key] = undefined
})

function handleNew() {
  editItem.value = null
  form.name = ''
  form.description = ''
  modalOpen.value = true
}

function handleEdit(center: CostCenter) {
  editItem.value = center
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
    description: result.data.description || undefined,
  }

  saving.value = true
  try {
    if (editItem.value) {
      await api.put(`/financial/cost-centers/${editItem.value.id}`, payload)
    } else {
      await api.post('/financial/cost-centers', payload)
    }
    toast.success(editItem.value ? 'Centro atualizado!' : 'Centro criado!')
    closeModal()
    await refetch()
  } catch {
    toast.error('Erro ao salvar centro de custo')
  } finally {
    saving.value = false
  }
}

async function handleDelete(center: CostCenter) {
  if (!confirm('Remover este centro de custo?')) return
  try {
    await api.delete(`/financial/cost-centers/${center.id}`)
    toast.success('Centro de custo removido')
    await refetch()
  } catch {
    toast.error('Erro ao remover centro de custo')
  }
}
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Centros de Custo" subtitle="Agrupe despesas por departamento ou área de responsabilidade">
      <template #actions>
        <button class="btn-primary" @click="handleNew">
          <Plus class="w-4 h-4" />
          Novo Centro de Custo
        </button>
      </template>
    </PageHeader>

    <div v-if="isLoading" class="py-20 flex items-center justify-center">
      <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
    </div>

    <div v-else-if="centers.length === 0" class="card">
      <div class="empty-state py-12">
        <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
          <Layers class="w-7 h-7 text-slate-300" />
        </div>
        <p class="text-slate-500 font-semibold">Nenhum centro de custo cadastrado</p>
        <p class="text-slate-400 text-sm mt-1">Crie centros de custo para classificar suas despesas</p>
        <button class="mt-4 btn-primary text-xs" @click="handleNew">
          <Plus class="w-3.5 h-3.5" />
          Novo Centro de Custo
        </button>
      </div>
    </div>

    <div v-else class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th class="table-head-cell">Nome</th>
              <th class="table-head-cell hidden md:table-cell">Descrição</th>
              <th class="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(center, idx) in centers" :key="center.id" class="table-row group" :style="{ animationDelay: `${idx * 0.03}s` }">
              <td class="table-cell">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <Layers class="w-4 h-4 text-violet-600" />
                  </div>
                  <p class="text-sm font-medium text-slate-900">{{ center.name }}</p>
                </div>
              </td>
              <td class="table-cell text-slate-500 text-sm hidden md:table-cell max-w-[300px]">
                <p class="truncate">{{ center.description ?? 'Sem descrição' }}</p>
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <button class="btn-icon w-7 h-7 hover:text-primary-600 hover:bg-primary-50" @click="handleEdit(center)">
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-icon w-7 h-7 hover:text-red-600 hover:bg-red-50" @click="handleDelete(center)">
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Modal :is-open="modalOpen" :title="editItem ? 'Editar Centro de Custo' : 'Novo Centro de Custo'" @close="closeModal">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="label">Nome *</label>
          <input v-model="form.name" class="input-field" placeholder="Ex: Administrativo, Clínico, Marketing" autofocus />
          <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
        </div>

        <div>
          <label class="label">Descrição</label>
          <textarea v-model="form.description" class="input-field resize-none" rows="3" placeholder="Descrição opcional do centro de custo..." />
        </div>

        <button type="submit" :disabled="saving" class="btn-primary w-full mt-2">
          <span v-if="saving" class="flex items-center gap-2 justify-center">
            <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>{{ editItem ? 'Atualizar Centro de Custo' : 'Criar Centro de Custo' }}</template>
        </button>
      </form>
    </Modal>
  </div>
</template>
