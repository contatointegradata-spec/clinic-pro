<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Check, X, Printer, CircleCheck, CircleX, Clock } from 'lucide-vue-next'
import api from '../lib/api'
import ClinicLogo from '../components/ui/ClinicLogo.vue'
import { brl, dayLabel } from '../lib/clinical'

interface PublicPlan {
  title: string
  status: string
  notes: string | null
  validUntil: string | null
  expired: boolean
  createdAt: string
  approvedAt: string | null
  approvedName: string | null
  rejectedAt: string | null
  patientFirstName: string
  professional: { name: string; specialty: string | null } | null
  discount: number
  items: Array<{ name: string; region: string | null; quantity: number; unitPrice: number }>
  subtotal: number
  total: number
  sessions: number
}

const route = useRoute()
const token = String(route.params.token)

const plan = ref<PublicPlan | null>(null)
const loading = ref(true)
const error = ref('')
const name = ref('')
const accepted = ref(false)
const submitting = ref<'' | 'APROVAR' | 'RECUSAR'>('')
const formError = ref('')

async function load() {
  try {
    const { data } = await api.get<PublicPlan>(`/public/treatment-plans/${encodeURIComponent(token)}`)
    plan.value = data
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'Não foi possível abrir o orçamento.'
  } finally {
    loading.value = false
  }
}
load()

const awaiting = computed(() => plan.value && ['RASCUNHO', 'ENVIADO'].includes(plan.value.status) && !plan.value.expired)
const approved = computed(() => plan.value && ['APROVADO', 'CONCLUIDO'].includes(plan.value.status))

function printPage() {
  window.print()
}

async function decide(decision: 'APROVAR' | 'RECUSAR') {
  formError.value = ''
  if (name.value.trim().length < 3) { formError.value = 'Digite seu nome completo para confirmar.'; return }
  if (decision === 'APROVAR' && !accepted.value) { formError.value = 'Marque que você leu e concorda com o orçamento.'; return }
  if (decision === 'RECUSAR' && !confirm('Tem certeza que deseja recusar este orçamento?')) return
  submitting.value = decision
  try {
    const { data } = await api.post<PublicPlan>(`/public/treatment-plans/${encodeURIComponent(token)}/decision`, {
      decision,
      name: name.value.trim(),
      accepted: accepted.value,
    })
    plan.value = data
  } catch (e: any) {
    formError.value = e?.response?.data?.message || 'Não foi possível registrar sua resposta. Tente novamente.'
  } finally {
    submitting.value = ''
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 py-8 px-4 print:bg-white print:py-0">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6 print:mb-4">
        <ClinicLogo dark />
        <button v-if="plan" class="btn-secondary text-sm print:hidden" @click="printPage"><Printer class="w-4 h-4" /> Imprimir</button>
      </div>

      <div v-if="loading" class="card h-80 skeleton" />

      <div v-else-if="error" class="card text-center py-12">
        <CircleX class="w-10 h-10 mx-auto text-amber-500 mb-3" />
        <p class="font-semibold text-slate-800">{{ error }}</p>
        <p class="text-sm text-slate-500 mt-1">Confira o link recebido ou fale com a clínica.</p>
      </div>

      <article v-else-if="plan" class="card p-0 overflow-hidden print:shadow-none print:border-0">
        <header class="px-6 sm:px-8 pt-7 pb-5 border-b border-slate-100">
          <p class="text-sm text-slate-500">Olá, {{ plan.patientFirstName }}! Este é o seu orçamento</p>
          <h1 class="mt-1 font-display text-3xl font-semibold text-slate-900">{{ plan.title }}</h1>
          <p class="mt-2 text-sm text-slate-500">
            <template v-if="plan.professional">{{ plan.professional.name }}<template v-if="plan.professional.specialty"> · {{ plan.professional.specialty }}</template> · </template>
            Emitido em {{ dayLabel(plan.createdAt) }}
            <template v-if="plan.validUntil"> · válido até {{ dayLabel(plan.validUntil) }}</template>
          </p>
        </header>

        <div class="px-6 sm:px-8 py-5">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th class="py-2 font-semibold">Procedimento</th>
                <th class="py-2 font-semibold text-center w-16">Qtd.</th>
                <th class="py-2 font-semibold text-right w-28">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, i) in plan.items" :key="i" class="border-b border-slate-100 last:border-0">
                <td class="py-3 pr-3">
                  <p class="font-medium text-slate-800">{{ item.name }}</p>
                  <p v-if="item.region || item.quantity > 1" class="text-xs text-slate-500">
                    <template v-if="item.region">{{ item.region }}</template>
                    <template v-if="item.region && item.quantity > 1"> · </template>
                    <template v-if="item.quantity > 1">{{ item.quantity }} sessões de {{ brl(item.unitPrice) }}</template>
                  </p>
                </td>
                <td class="py-3 text-center tabular-nums text-slate-600">{{ item.quantity }}</td>
                <td class="py-3 text-right tabular-nums font-medium text-slate-800">{{ brl(item.quantity * item.unitPrice) }}</td>
              </tr>
            </tbody>
          </table>

          <div class="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
            <div v-if="plan.discount > 0" class="flex justify-between text-slate-500"><span>Subtotal</span><span class="tabular-nums">{{ brl(plan.subtotal) }}</span></div>
            <div v-if="plan.discount > 0" class="flex justify-between text-emerald-700"><span>Desconto</span><span class="tabular-nums">− {{ brl(plan.discount) }}</span></div>
            <div class="flex justify-between items-baseline pt-2 border-t border-slate-200">
              <span class="font-semibold text-slate-800">Total</span>
              <span class="font-display text-2xl font-semibold text-slate-900 tabular-nums">{{ brl(plan.total) }}</span>
            </div>
          </div>

          <p v-if="plan.notes" class="mt-6 text-sm text-slate-600 whitespace-pre-line rounded-xl bg-slate-50 border border-slate-100 p-4">{{ plan.notes }}</p>
        </div>

        <!-- Situação / decisão -->
        <footer class="px-6 sm:px-8 py-6 bg-slate-50/80 border-t border-slate-100 print:bg-white">
          <div v-if="approved" class="flex items-start gap-3">
            <CircleCheck class="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div>
              <p class="font-semibold text-slate-900">Orçamento aprovado</p>
              <p class="text-sm text-slate-600">
                Aprovado<template v-if="plan.approvedName"> por {{ plan.approvedName }}</template><template v-if="plan.approvedAt"> em {{ new Date(plan.approvedAt).toLocaleString('pt-BR') }}</template>.
                A clínica vai entrar em contato para agendar.
              </p>
            </div>
          </div>
          <div v-else-if="plan.status === 'RECUSADO'" class="flex items-start gap-3">
            <CircleX class="w-6 h-6 text-amber-600 flex-shrink-0" />
            <div>
              <p class="font-semibold text-slate-900">Orçamento recusado</p>
              <p class="text-sm text-slate-600">Se mudar de ideia ou quiser ajustar algo, é só falar com a clínica.</p>
            </div>
          </div>
          <div v-else-if="plan.expired" class="flex items-start gap-3">
            <Clock class="w-6 h-6 text-slate-500 flex-shrink-0" />
            <div>
              <p class="font-semibold text-slate-900">Orçamento expirado</p>
              <p class="text-sm text-slate-600">Fale com a clínica para receber um orçamento atualizado.</p>
            </div>
          </div>
          <form v-else-if="awaiting" class="space-y-4 print:hidden" @submit.prevent="decide('APROVAR')">
            <p class="font-semibold text-slate-900">Deseja aprovar este orçamento?</p>
            <div>
              <label for="approver" class="label">Seu nome completo</label>
              <input id="approver" v-model="name" class="input-field" autocomplete="name" placeholder="Digite seu nome para confirmar" />
            </div>
            <label class="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input v-model="accepted" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
              Li o orçamento acima e concordo com os procedimentos e valores.
            </label>
            <p v-if="formError" class="text-sm text-red-600" role="alert">{{ formError }}</p>
            <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" class="btn-secondary justify-center" :disabled="!!submitting" @click="decide('RECUSAR')"><X class="w-4 h-4" /> {{ submitting === 'RECUSAR' ? 'Enviando…' : 'Recusar' }}</button>
              <button type="submit" class="btn-primary justify-center px-6" :disabled="!!submitting"><Check class="w-4 h-4" /> {{ submitting === 'APROVAR' ? 'Enviando…' : 'Aprovar orçamento' }}</button>
            </div>
          </form>
        </footer>
      </article>

      <p class="mt-6 text-center text-xs text-slate-400 print:hidden">Orçamento gerado pela ClinIQ Pro · Gestão para Odontologia e Estética</p>
    </div>
  </div>
</template>
