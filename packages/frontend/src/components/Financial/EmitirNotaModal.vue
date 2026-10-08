<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FileCheck2, AlertTriangle } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'
import type { Nfse, NfseConfig, Patient, Transaction } from '../../types'
import { apiError, centsToBRL } from './nfse'

// Emissão de NFS-e — a partir de uma receita (transaction) ou avulsa.
// O tomador vem do paciente (nome/CPF/e-mail) e pode ser ajustado aqui.

const props = defineProps<{
  isOpen: boolean
  transaction?: Transaction | null
  patients: Patient[]
}>()
const emit = defineEmits<{ close: []; issued: [nfse: Nfse] }>()
const router = useRouter()

const config = ref<NfseConfig | null>(null)
const loadingConfig = ref(false)
const sending = ref(false)

const patientId = ref('')
const nome = ref('')
const documento = ref('')
const email = ref('')
const valor = ref('')
const descricao = ref('')
const competencia = ref('')

function today() {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}

function fillFromPatient(id: string) {
  const p = props.patients.find(x => x.id === id)
  if (!p) return
  nome.value = p.name
  documento.value = p.cpf ?? ''
  email.value = p.email ?? ''
}

watch(() => props.isOpen, async open => {
  if (!open) return
  const tx = props.transaction
  const txPatientId = tx?.patientId ?? tx?.appointment?.patient.id ?? tx?.patient?.id ?? ''
  patientId.value = txPatientId
  nome.value = ''
  documento.value = ''
  email.value = ''
  if (txPatientId) fillFromPatient(txPatientId)
  else if (tx?.appointment?.patient) nome.value = tx.appointment.patient.name
  valor.value = tx ? tx.amount.toFixed(2).replace('.', ',') : ''
  competencia.value = tx ? tx.date.slice(0, 10) : today()
  descricao.value = ''
  loadingConfig.value = true
  try {
    config.value = (await api.get<NfseConfig>('/nfse/config')).data
    descricao.value = config.value.descricaoServicoPadrao
  } catch {
    config.value = null
  } finally {
    loadingConfig.value = false
  }
})

watch(patientId, id => { if (id) fillFromPatient(id) })

const valorCents = computed(() => {
  const n = Number(valor.value.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
})
const ready = computed(() => (config.value?.missing.length ?? 1) === 0)
const canSubmit = computed(() => ready.value && valorCents.value > 0 && nome.value.trim().length > 1 && descricao.value.trim().length > 2 && !sending.value)

function goToConfig() {
  emit('close')
  router.push({ path: '/financeiro/notas-fiscais', query: { tab: 'config' } })
}

async function submit() {
  if (!canSubmit.value) return
  sending.value = true
  try {
    const { data } = await api.post<Nfse>('/nfse/invoices', {
      ...(props.transaction ? { transactionId: props.transaction.id } : {}),
      ...(patientId.value ? { patientId: patientId.value } : {}),
      tomador: { nome: nome.value.trim(), documento: documento.value || null, email: email.value || null },
      valorCents: valorCents.value,
      descricao: descricao.value.trim(),
      competencia: competencia.value,
    })
    if (data.status === 'AUTHORIZED') toast.success(`NFS-e ${data.numeroNfse ?? ''} autorizada!`)
    else if (data.status === 'PROCESSING') toast('Nota enviada — aguardando confirmação da Sefin.')
    emit('issued', data)
    emit('close')
  } catch (e) {
    const resp = (e as { response?: { status?: number; data?: Nfse & { message?: string } } }).response
    // 422 = DPS rejeitada pela Sefin: a nota fica registrada com os erros.
    if (resp?.status === 422 && resp.data?.id) {
      const first = resp.data.mensagens?.[0]
      toast.error(`Nota rejeitada pela Sefin${first ? `: ${first.descricao}` : ''}`)
      emit('issued', resp.data)
      emit('close')
    } else {
      toast.error(apiError(e, 'Não foi possível emitir a nota'))
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Emitir nota fiscal (NFS-e)" :subtitle="transaction ? transaction.description : 'Nota avulsa'" size="lg" @close="emit('close')">
    <div v-if="loadingConfig" class="py-10 flex justify-center">
      <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
    </div>

    <div v-else-if="!ready" class="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-800">
      <div class="flex items-center gap-2 font-semibold"><AlertTriangle class="w-4 h-4" /> Configuração fiscal incompleta</div>
      <ul class="list-disc ml-6 mt-2 space-y-0.5">
        <li v-for="m in config?.missing ?? ['Configuração indisponível']" :key="m">{{ m }}</li>
      </ul>
      <button class="btn-primary mt-3 text-xs" @click="goToConfig">Configurar emissão</button>
    </div>

    <form v-else class="space-y-4" @submit.prevent="submit">
      <div v-if="config?.ambiente === 'HOMOLOGACAO'" class="text-xs rounded-lg bg-sky-50 text-sky-700 px-3 py-2 ring-1 ring-sky-100">
        Ambiente de <b>homologação</b> (Produção Restrita): a nota não tem valor fiscal e não é cobrada.
      </div>

      <div>
        <label class="label">Paciente (tomador)</label>
        <select v-model="patientId" class="input-field">
          <option value="">— Informar manualmente —</option>
          <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="label">Nome do tomador *</label>
          <input v-model="nome" class="input-field" maxlength="300" required />
        </div>
        <div>
          <label class="label">CPF/CNPJ</label>
          <input v-model="documento" class="input-field" inputmode="numeric" placeholder="Opcional, recomendado" />
        </div>
        <div>
          <label class="label">E-mail</label>
          <input v-model="email" type="email" class="input-field" placeholder="Opcional" />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="label">Valor do serviço (R$) *</label>
          <input v-model="valor" class="input-field tabular-nums" inputmode="decimal" placeholder="0,00" required />
        </div>
        <div>
          <label class="label">Competência *</label>
          <input v-model="competencia" type="date" class="input-field" :max="today()" required />
        </div>
      </div>

      <div>
        <label class="label">Descrição do serviço *</label>
        <textarea v-model="descricao" class="input-field min-h-[80px]" maxlength="2000" required />
      </div>

      <div class="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <p class="text-xs text-slate-500">
          <template v-if="config?.ambiente === 'PRODUCAO'">Custo da emissão: <b>{{ centsToBRL(config.unitPriceCents) }}</b> por nota autorizada.</template>
          <template v-else>Sem custo em homologação.</template>
        </p>
        <button type="submit" class="btn-primary" :disabled="!canSubmit">
          <FileCheck2 class="w-4 h-4" />
          {{ sending ? 'Emitindo…' : `Emitir ${valorCents > 0 ? centsToBRL(valorCents) : ''}` }}
        </button>
      </div>
    </form>
  </Modal>
</template>
