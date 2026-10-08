<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2, Search, UserPlus, Check } from 'lucide-vue-next'
import Modal from '../ui/Modal.vue'
import toast from '../../lib/toast'
import { useAttendanceStore } from '../../stores/attendance'
import { errorMessage, formatPhone } from './format'
import type { PatientCandidate, PatientCandidates } from '../../types'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useAttendanceStore()

const loading = ref(false)
const candidates = ref<PatientCandidates | null>(null)
const search = ref('')
const searching = ref(false)
const newName = ref('')
const saving = ref<string | null>(null)
const duplicate = ref<{ id: string; name: string } | null>(null)

const GENERIC = /^(contato whatsapp|novo contato)/i

watch(() => props.isOpen, async open => {
  if (!open) return
  search.value = ''
  duplicate.value = null
  const d = store.detail
  newName.value = d?.contactName && !GENERIC.test(d.contactName) ? d.contactName : ''
  loading.value = true
  candidates.value = await store.fetchCandidates()
  loading.value = false
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, term => {
  clearTimeout(searchTimer)
  if (term.trim().length < 2) {
    if (candidates.value) candidates.value.results = []
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    const data = await store.fetchCandidates(term.trim())
    if (data && search.value === term) candidates.value = data
    searching.value = false
  }, 300)
})

const results = computed(() => candidates.value?.results ?? [])
const samePhone = computed(() => candidates.value?.samePhone ?? [])

async function link(p: PatientCandidate) {
  if (p.linked) return
  saving.value = p.id
  try {
    await store.linkPatient({ patientId: p.id })
    toast.success(`Conversa vinculada a ${p.name}`)
    emit('close')
  } catch (e) {
    toast.error(errorMessage(e, 'Não foi possível vincular'))
  } finally {
    saving.value = null
  }
}

async function create(confirmDuplicate = false) {
  const name = newName.value.trim()
  if (name.length < 2) return
  saving.value = 'create'
  try {
    await store.linkPatient({ create: { name, confirmDuplicate } })
    toast.success('Pré-cadastro criado e vinculado')
    emit('close')
  } catch (e) {
    const res = (e as { response?: { status?: number; data?: { duplicateOf?: { id: string; name: string } } } })?.response
    if (res?.status === 409 && res.data?.duplicateOf) duplicate.value = res.data.duplicateOf
    else toast.error(errorMessage(e, 'Não foi possível criar o pré-cadastro'))
  } finally {
    saving.value = null
  }
}

async function useDuplicate() {
  if (!duplicate.value) return
  await link({ id: duplicate.value.id, name: duplicate.value.name } as PatientCandidate)
}

const STATUS_LABEL: Record<string, string> = { PRE_CADASTRO: 'Pré-cadastro', INCOMPLETO: 'Incompleto', INATIVO: 'Inativo' }
</script>

<template>
  <Modal :is-open="isOpen" title="Vincular paciente" subtitle="Escolha quem é o paciente desta conversa" size="md" @close="emit('close')">
    <div class="space-y-5">
      <!-- Mesmo telefone -->
      <section>
        <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2">
          Com este telefone<template v-if="candidates?.phone"> · {{ formatPhone(candidates.phone) }}</template>
        </p>
        <div v-if="loading" class="flex justify-center py-4"><Loader2 class="w-4 h-4 text-slate-400 animate-spin" /></div>
        <p v-else-if="!samePhone.length" class="text-xs text-slate-400">Nenhum paciente com este telefone.</p>
        <template v-else>
          <p v-if="samePhone.length > 1" class="text-xs text-slate-500 mb-2">O mesmo número pode ser de pessoas diferentes (ex.: mãe e filhos).</p>
          <ul class="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            <li v-for="p in samePhone" :key="p.id" class="flex items-center gap-3 px-3 py-2.5">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-slate-800 truncate">{{ p.name }}</p>
                <p class="text-[11px] text-slate-400">{{ STATUS_LABEL[p.status] ?? 'Cadastro completo' }}</p>
              </div>
              <span v-if="p.linked" class="inline-flex items-center gap-1 text-xs text-emerald-600"><Check class="w-3.5 h-3.5" />Vinculado</span>
              <button v-else class="btn-secondary px-3 py-1.5 text-xs rounded-lg" :disabled="!!saving" @click="link(p)">
                <Loader2 v-if="saving === p.id" class="w-3.5 h-3.5 animate-spin" />Vincular
              </button>
            </li>
          </ul>
        </template>
      </section>

      <!-- Busca -->
      <section>
        <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2">Buscar outro paciente</p>
        <div class="relative">
          <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input v-model="search" type="search" class="input-field pl-9" placeholder="Nome, telefone ou CPF" aria-label="Buscar paciente" />
          <Loader2 v-if="searching" class="w-4 h-4 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
        <ul v-if="results.length" class="mt-2 divide-y divide-slate-100 border border-slate-100 rounded-xl max-h-56 overflow-y-auto">
          <li v-for="p in results" :key="p.id" class="flex items-center gap-3 px-3 py-2.5">
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-800 truncate">{{ p.name }}</p>
              <p class="text-[11px] text-slate-400">{{ formatPhone(p.phone) }}<template v-if="STATUS_LABEL[p.status]"> · {{ STATUS_LABEL[p.status] }}</template></p>
            </div>
            <span v-if="p.linked" class="inline-flex items-center gap-1 text-xs text-emerald-600"><Check class="w-3.5 h-3.5" />Vinculado</span>
            <button v-else class="btn-secondary px-3 py-1.5 text-xs rounded-lg" :disabled="!!saving" @click="link(p)">
              <Loader2 v-if="saving === p.id" class="w-3.5 h-3.5 animate-spin" />Vincular
            </button>
          </li>
        </ul>
        <p v-else-if="search.trim().length >= 2 && !searching" class="text-xs text-slate-400 mt-2">Nenhum paciente encontrado.</p>
      </section>

      <!-- Novo pré-cadastro -->
      <section class="pt-4 border-t border-slate-100">
        <p class="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2">Novo pré-cadastro</p>
        <p v-if="candidates && !candidates.phone" class="text-xs text-slate-500">
          O telefone deste contato ainda não foi identificado pelo WhatsApp — vincule a um paciente existente.
        </p>
        <form v-else class="flex gap-2" @submit.prevent="create()">
          <input v-model="newName" class="input-field flex-1" maxlength="120" placeholder="Nome do paciente" aria-label="Nome do paciente" @input="duplicate = null" />
          <button type="submit" class="btn-primary px-3 text-sm whitespace-nowrap" :disabled="newName.trim().length < 2 || !!saving">
            <Loader2 v-if="saving === 'create'" class="w-4 h-4 animate-spin" /><UserPlus v-else class="w-4 h-4" />Criar e vincular
          </button>
        </form>
        <div v-if="duplicate" class="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-2">
          <p>Já existe <strong>{{ duplicate.name }}</strong> com este telefone.</p>
          <div class="flex gap-3">
            <button class="font-medium text-amber-900 hover:underline" :disabled="!!saving" @click="useDuplicate">Usar existente</button>
            <button class="text-amber-700 hover:underline" :disabled="!!saving" @click="create(true)">Cadastrar mesmo assim</button>
          </div>
        </div>
      </section>
    </div>
  </Modal>
</template>
