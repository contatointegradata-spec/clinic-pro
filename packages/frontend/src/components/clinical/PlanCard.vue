<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Send, Check, X, Pencil, Trash2, Link2, MessageCircle, Minus, Plus, ExternalLink, MoreHorizontal, RotateCcw,
} from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import Modal from '../ui/Modal.vue'
import {
  type TreatmentPlan, PLAN_STATUS, APPROVAL_CHANNEL, brl, dayLabel, whatsappLink,
} from '../../lib/clinical'

const props = defineProps<{ plan: TreatmentPlan; showPatient?: boolean }>()
const emit = defineEmits<{ updated: [plan: TreatmentPlan]; deleted: [id: string]; edit: [plan: TreatmentPlan] }>()

const busy = ref(false)
const menuOpen = ref(false)
const approveOpen = ref(false)
const approveChannel = ref<'PRESENCIAL' | 'WHATSAPP' | 'TELEFONE' | 'OUTRO'>('PRESENCIAL')

const editable = computed(() => ['RASCUNHO', 'ENVIADO', 'RECUSADO'].includes(props.plan.status))
const inProgress = computed(() => ['APROVADO', 'CONCLUIDO'].includes(props.plan.status))
const progress = computed(() => (props.plan.sessions ? Math.round((props.plan.sessionsDone / props.plan.sessions) * 100) : 0))

async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  busy.value = true
  menuOpen.value = false
  try {
    const result = await fn()
    if (success) toast.success(success)
    return result
  } catch (e: any) {
    toast.error(e?.response?.data?.message || 'Não foi possível concluir a ação')
  } finally {
    busy.value = false
  }
}

async function send() {
  // Abre a aba já no clique (antes do await) — senão o bloqueador de pop-up barra.
  const popup = props.plan.patient.phone ? window.open('about:blank', '_blank') : null
  const data = await run(async () => (await api.post<TreatmentPlan>(`/clinical/treatment-plans/${props.plan.id}/send`)).data)
  if (!data) { popup?.close(); return }
  emit('updated', data)
  if (popup && data.whatsappMessage) {
    popup.opener = null
    popup.location.href = whatsappLink(data.patient.phone, data.whatsappMessage)
    toast.success('Orçamento marcado como enviado')
  } else {
    popup?.close()
    await copyLink()
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(props.plan.publicUrl)
    toast.success('Link do orçamento copiado')
  } catch {
    window.prompt('Copie o link do orçamento:', props.plan.publicUrl)
  }
  menuOpen.value = false
}

async function approve() {
  const data = await run(async () => (await api.post<TreatmentPlan>(`/clinical/treatment-plans/${props.plan.id}/approve`, { channel: approveChannel.value })).data, 'Orçamento aprovado')
  if (data) { emit('updated', data); approveOpen.value = false }
}

async function setStatus(status: 'RECUSADO' | 'CANCELADO' | 'RASCUNHO' | 'CONCLUIDO' | 'APROVADO', confirmText?: string) {
  if (confirmText && !confirm(confirmText)) return
  const data = await run(async () => (await api.patch<TreatmentPlan>(`/clinical/treatment-plans/${props.plan.id}/status`, { status })).data, 'Status atualizado')
  if (data) emit('updated', data)
}

async function session(itemId: string, delta: 1 | -1) {
  const data = await run(async () => (await api.post<TreatmentPlan>(`/clinical/treatment-plan-items/${itemId}/sessions`, { delta })).data)
  if (data) {
    emit('updated', data)
    if (data.status === 'CONCLUIDO' && props.plan.status !== 'CONCLUIDO') toast.success('Tratamento concluído! 🎉')
  }
}

async function remove() {
  if (!confirm(`Excluir o orçamento "${props.plan.title}"?`)) return
  const ok = await run(async () => { await api.delete(`/clinical/treatment-plans/${props.plan.id}`); return true }, 'Orçamento excluído')
  if (ok) emit('deleted', props.plan.id)
}
</script>

<template>
  <article class="card p-0 overflow-hidden">
    <header class="px-5 pt-4 pb-3 flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h4 class="font-semibold text-slate-900 truncate">{{ plan.title }}</h4>
          <span :class="['text-[11px] font-semibold px-2 py-0.5 rounded-full', PLAN_STATUS[plan.status].chip]">{{ PLAN_STATUS[plan.status].label }}</span>
        </div>
        <p class="text-xs text-slate-500 mt-0.5">
          <router-link v-if="showPatient" :to="`/pacientes/${plan.patient.id}/clinico?aba=orcamentos`" class="font-medium text-primary-700 hover:underline">{{ plan.patient.name }}</router-link>
          <span v-if="showPatient"> · </span>
          Criado em {{ dayLabel(plan.createdAt) }}
          <template v-if="plan.validUntil && editable"> · válido até {{ dayLabel(plan.validUntil) }}</template>
          <template v-if="plan.approvedAt"> · aprovado em {{ dayLabel(plan.approvedAt) }} {{ APPROVAL_CHANNEL[plan.approvalChannel ?? ''] ?? '' }}<template v-if="plan.approvedName"> por {{ plan.approvedName }}</template></template>
          <template v-if="plan.rejectedAt"> · recusado em {{ dayLabel(plan.rejectedAt) }}</template>
        </p>
      </div>
      <div class="text-right">
        <p class="font-display text-xl font-semibold text-slate-900 tabular-nums">{{ brl(plan.total) }}</p>
        <p v-if="plan.discount > 0" class="text-xs text-slate-400 tabular-nums"><span class="line-through">{{ brl(plan.subtotal) }}</span> · desconto {{ brl(plan.discount) }}</p>
      </div>
    </header>

    <ul class="border-t border-slate-100 divide-y divide-slate-100">
      <li v-for="item in plan.items" :key="item.id" class="px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <div class="min-w-0 flex-1">
          <p class="text-slate-800 font-medium truncate">{{ item.name }}</p>
          <p class="text-xs text-slate-500">
            <template v-if="item.region">{{ item.region }} · </template>
            {{ item.quantity }} × {{ brl(item.unitPrice) }}
          </p>
        </div>
        <div v-if="inProgress" class="flex items-center gap-2">
          <button class="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center" :disabled="busy || item.completedQty === 0" title="Desfazer sessão" @click="session(item.id, -1)"><Minus class="w-3.5 h-3.5" /></button>
          <span :class="['text-xs font-semibold tabular-nums w-24 text-center', item.completedQty >= item.quantity ? 'text-emerald-700' : 'text-slate-600']">
            {{ item.completedQty }}/{{ item.quantity }} {{ item.quantity > 1 ? 'sessões' : 'realizado' }}
          </span>
          <button class="w-7 h-7 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 flex items-center justify-center" :disabled="busy || item.completedQty >= item.quantity" title="Registrar sessão" @click="session(item.id, 1)"><Plus class="w-3.5 h-3.5" /></button>
        </div>
        <span v-else class="text-sm font-semibold text-slate-700 tabular-nums">{{ brl(item.quantity * item.unitPrice) }}</span>
      </li>
    </ul>

    <div v-if="inProgress" class="px-5 py-3 border-t border-slate-100 flex items-center gap-3">
      <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full bg-emerald-500 transition-all" :style="{ width: `${progress}%` }" />
      </div>
      <span class="text-xs font-semibold text-slate-600 tabular-nums">{{ plan.sessionsDone }}/{{ plan.sessions }} · {{ progress }}%</span>
    </div>

    <p v-if="plan.notes" class="px-5 pb-3 text-xs text-slate-500 whitespace-pre-line">{{ plan.notes }}</p>

    <footer class="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center gap-2">
      <template v-if="editable">
        <button class="btn-primary text-sm py-2" :disabled="busy" @click="send"><Send class="w-4 h-4" /> {{ plan.status === 'ENVIADO' ? 'Reenviar' : 'Enviar para aprovação' }}</button>
        <button class="btn-secondary text-sm py-2" :disabled="busy" @click="approveOpen = true"><Check class="w-4 h-4" /> Aprovar</button>
        <button class="btn-secondary text-sm py-2" :disabled="busy" @click="emit('edit', plan)"><Pencil class="w-4 h-4" /> Editar</button>
      </template>
      <a :href="plan.publicUrl" target="_blank" rel="noopener" class="btn-secondary text-sm py-2"><ExternalLink class="w-4 h-4" /> Ver / imprimir</a>
      <div class="relative ml-auto">
        <button class="p-2 rounded-lg text-slate-500 hover:bg-white border border-transparent hover:border-slate-200" aria-label="Mais ações" @click="menuOpen = !menuOpen"><MoreHorizontal class="w-4 h-4" /></button>
        <div v-if="menuOpen" class="absolute right-0 bottom-full mb-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-20 text-sm">
          <button class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="copyLink"><Link2 class="w-4 h-4 text-slate-400" /> Copiar link de aprovação</button>
          <a v-if="plan.patient.phone" :href="whatsappLink(plan.patient.phone, `Olá, ${plan.patient.name.split(' ')[0]}! Segue o seu orçamento: ${plan.publicUrl}`)" target="_blank" rel="noopener" class="w-full px-3 py-2 hover:bg-slate-50 flex items-center gap-2"><MessageCircle class="w-4 h-4 text-slate-400" /> Abrir no WhatsApp</a>
          <button v-if="editable" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="setStatus('RECUSADO')"><X class="w-4 h-4 text-slate-400" /> Marcar como recusado</button>
          <button v-if="plan.status === 'CONCLUIDO'" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="setStatus('APROVADO')"><RotateCcw class="w-4 h-4 text-slate-400" /> Reabrir tratamento</button>
          <button v-if="plan.status === 'APROVADO'" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="setStatus('CONCLUIDO', 'Marcar o tratamento como concluído?')"><Check class="w-4 h-4 text-slate-400" /> Concluir tratamento</button>
          <button v-if="!['CANCELADO', 'CONCLUIDO'].includes(plan.status)" class="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2" @click="setStatus('CANCELADO', 'Cancelar este orçamento? O link deixa de funcionar.')"><X class="w-4 h-4 text-slate-400" /> Cancelar orçamento</button>
          <button class="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2" @click="remove"><Trash2 class="w-4 h-4" /> Excluir</button>
        </div>
      </div>
    </footer>

    <Modal :is-open="approveOpen" title="Registrar aprovação" subtitle="Quando a paciente aprova fora do link" size="sm" @close="approveOpen = false">
      <div class="space-y-4">
        <div>
          <label class="label">Como a paciente aprovou?</label>
          <select v-model="approveChannel" class="input-field">
            <option value="PRESENCIAL">Presencialmente</option>
            <option value="WHATSAPP">Pelo WhatsApp</option>
            <option value="TELEFONE">Por telefone</option>
            <option value="OUTRO">Outro</option>
          </select>
        </div>
        <p class="text-sm text-slate-500">Depois de aprovado, você registra as sessões realizadas de cada procedimento.</p>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="approveOpen = false">Cancelar</button>
          <button class="btn-primary" :disabled="busy" @click="approve"><Check class="w-4 h-4" /> Aprovar orçamento</button>
        </div>
      </div>
    </Modal>
  </article>
</template>
