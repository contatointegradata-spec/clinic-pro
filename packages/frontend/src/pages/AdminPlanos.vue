<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Zap, Lock, RotateCcw, Users2, Search, Gift, ShieldAlert, ShieldCheck, Link2 } from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import Modal from '../components/ui/Modal.vue'
import { useQuery } from '../composables/useQuery'

type DisplayStatus =
  | 'TRIAL' | 'TRIAL_EXPIRED' | 'ACTIVE' | 'COURTESY' | 'CANCELED_ACTIVE'
  | 'PENDING_PAYMENT' | 'PAST_DUE' | 'CANCELED' | 'BLOCKED'

interface DoctorSubscriptionRow {
  id: string
  name: string
  email: string
  specialty: string | null
  createdAt: string
  _count: { doctorTeam: number }
  subscription: {
    status: string
    trialStartedAt: string | null
    trialEndsAt: string | null
    currentPeriodEndsAt: string | null
    lastPaymentAt: string | null
    blockedAt: string | null
    canceledAt: string | null
    adminNote: string | null
    kiwifySubscriptionId: string | null
    lastKiwifyOrderId: string | null
    updatedAt: string
    _count: { payments: number }
  } | null
  access: {
    allowed: boolean
    reason: string
    displayStatus: DisplayStatus
    trialDaysRemaining: number | null
  }
}

interface SubscriptionsResponse {
  enforced: boolean
  trialDays: number
  doctors: DoctorSubscriptionRow[]
}

const STATUS_LABEL: Record<DisplayStatus, { label: string; color: string }> = {
  TRIAL: { label: 'Teste grátis', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  TRIAL_EXPIRED: { label: 'Teste encerrado', color: 'bg-red-50 text-red-700 border-red-200' },
  ACTIVE: { label: 'Paga', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  COURTESY: { label: 'Liberada (cortesia)', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  CANCELED_ACTIVE: { label: 'Cancelada (em vigor)', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_PAYMENT: { label: 'Pag. pendente', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAST_DUE: { label: 'Atrasada', color: 'bg-red-50 text-red-700 border-red-200' },
  CANCELED: { label: 'Cancelada', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  BLOCKED: { label: 'Bloqueada', color: 'bg-red-50 text-red-700 border-red-200' },
}

type Filter = 'all' | 'with_access' | 'without_access' | 'paying' | 'trial'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'paying', label: 'Pagantes' },
  { key: 'trial', label: 'Em teste' },
  { key: 'with_access', label: 'Com acesso' },
  { key: 'without_access', label: 'Sem acesso' },
]

const router = useRouter()
const search = ref('')
const filter = ref<Filter>('all')
const grantTarget = ref<DoctorSubscriptionRow | null>(null)
const blockTarget = ref<DoctorSubscriptionRow | null>(null)
const showBulkTrial = ref(false)
const unlimited = ref(false)
const days = ref(30)
const note = ref('')

const grantSaving = ref(false)
const blockSaving = ref(false)
const bulkSaving = ref(false)
const resettingId = ref<string | null>(null)

const { data, isLoading, refetch } = useQuery<SubscriptionsResponse>({
  key: 'admin-subscriptions',
  queryFn: () => api.get('/admin/subscriptions').then(r => r.data),
})
const doctors = computed(() => data.value?.doctors ?? [])
const trialDays = computed(() => data.value?.trialDays ?? 3)

const counts = computed(() => {
  const list = doctors.value
  return {
    total: list.length,
    paying: list.filter(d => d.access.displayStatus === 'ACTIVE').length,
    trial: list.filter(d => d.access.displayStatus === 'TRIAL').length,
    courtesy: list.filter(d => d.access.displayStatus === 'COURTESY').length,
    withoutAccess: list.filter(d => !d.access.allowed).length,
  }
})

const filtered = computed(() => {
  const term = search.value.toLowerCase()
  return doctors.value.filter(d => {
    if (term && !d.name.toLowerCase().includes(term) && !d.email.toLowerCase().includes(term)) return false
    switch (filter.value) {
      case 'paying': return d.access.displayStatus === 'ACTIVE'
      case 'trial': return d.access.displayStatus === 'TRIAL'
      case 'with_access': return d.access.allowed
      case 'without_access': return !d.access.allowed
      default: return true
    }
  })
})

function openGrant(doctor: DoctorSubscriptionRow) {
  grantTarget.value = doctor
  unlimited.value = false
  days.value = 30
  note.value = ''
}

function openBlock(doctor: DoctorSubscriptionRow) {
  blockTarget.value = doctor
  note.value = ''
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback
}

async function confirmGrant() {
  if (!grantTarget.value) return
  grantSaving.value = true
  try {
    await api.post(`/admin/subscriptions/${grantTarget.value.id}/grant`, {
      unlimited: unlimited.value,
      days: unlimited.value ? undefined : days.value,
      note: note.value || undefined,
    })
    toast.success('Acesso liberado')
    grantTarget.value = null
    note.value = ''
    await refetch()
  } catch (err) {
    toast.error(errorMessage(err, 'Não foi possível liberar o acesso'))
  } finally {
    grantSaving.value = false
  }
}

async function confirmBlock() {
  if (!blockTarget.value) return
  blockSaving.value = true
  try {
    await api.post(`/admin/subscriptions/${blockTarget.value.id}/block`, { note: note.value || undefined })
    toast.success('Acesso bloqueado')
    blockTarget.value = null
    note.value = ''
    await refetch()
  } catch (err) {
    toast.error(errorMessage(err, 'Não foi possível bloquear o acesso'))
  } finally {
    blockSaving.value = false
  }
}

async function resetTrial(doctorId: string) {
  resettingId.value = doctorId
  try {
    await api.post(`/admin/subscriptions/${doctorId}/reset-trial`, {})
    toast.success(`Teste grátis de ${trialDays.value} dias concedido`)
    await refetch()
  } catch (err) {
    toast.error(errorMessage(err, 'Não foi possível conceder o teste grátis'))
  } finally {
    resettingId.value = null
  }
}

async function confirmBulkTrial() {
  bulkSaving.value = true
  try {
    const { data: result } = await api.post<{ updated: number }>('/admin/subscriptions/bulk-trial', { note: note.value || undefined })
    toast.success(result.updated === 0
      ? 'Nenhum médico estava sem acesso'
      : `${result.updated} médico(s) receberam ${trialDays.value} dias de teste grátis`)
    showBulkTrial.value = false
    note.value = ''
    await refetch()
  } catch (err) {
    toast.error(errorMessage(err, 'Não foi possível conceder o teste em lote'))
  } finally {
    bulkSaving.value = false
  }
}

function formatDate(value: string | null | undefined): string {
  return value ? format(new Date(value), 'd MMM yyyy', { locale: ptBR }) : '—'
}

function validityOf(doctor: DoctorSubscriptionRow): string {
  const sub = doctor.subscription
  if (!sub) return '—'
  switch (doctor.access.displayStatus) {
    case 'COURTESY': return 'Sem prazo'
    case 'TRIAL': return `até ${formatDate(sub.trialEndsAt)} (${doctor.access.trialDaysRemaining ?? 0}d)`
    case 'TRIAL_EXPIRED': return `teste acabou ${formatDate(sub.trialEndsAt)}`
    case 'ACTIVE':
    case 'CANCELED_ACTIVE': return `até ${formatDate(sub.currentPeriodEndsAt)}`
    case 'PAST_DUE': return `venceu ${formatDate(sub.currentPeriodEndsAt)}`
    default: return '—'
  }
}
</script>

<template>
  <div class="space-y-4 animate-fade-in">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 class="page-title">Gestão de Planos</h1>
        <p class="page-subtitle">
          Assinaturas de cada médico/especialista — liberar, bloquear ou conceder teste vale automaticamente para toda a equipe vinculada.
        </p>
      </div>
      <button class="btn-secondary flex items-center gap-1.5" @click="showBulkTrial = true; note = ''">
        <Gift class="w-4 h-4" />
        Teste grátis para quem está sem acesso
      </button>
    </div>

    <!-- Bloqueio ligado/desligado -->
    <div
      v-if="data"
      :class="['rounded-xl border px-4 py-3 text-sm flex items-start gap-2', data.enforced ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800']"
    >
      <ShieldCheck v-if="data.enforced" class="w-4 h-4 flex-shrink-0 mt-0.5" />
      <ShieldAlert v-else class="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span v-if="data.enforced">
        Bloqueio por assinatura <strong>ligado</strong>: quem está "sem acesso" não consegue usar o sistema até pagar.
      </span>
      <span v-else>
        Bloqueio por assinatura <strong>desligado</strong>: ninguém é bloqueado ainda, mesmo com o teste vencido
        ({{ counts.withoutAccess }} médico(s) seriam bloqueados hoje). Ligue em
        <button class="underline font-medium" @click="router.push('/admin/integracoes')">Admin › Integrações</button>
        depois de validar a Kiwify.
      </span>
    </div>

    <!-- Contadores -->
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div class="card p-3"><p class="text-xs text-slate-400">Médicos</p><p class="text-xl font-bold text-slate-900">{{ counts.total }}</p></div>
      <div class="card p-3"><p class="text-xs text-slate-400">Pagantes</p><p class="text-xl font-bold text-emerald-600">{{ counts.paying }}</p></div>
      <div class="card p-3"><p class="text-xs text-slate-400">Em teste</p><p class="text-xl font-bold text-primary-600">{{ counts.trial }}</p></div>
      <div class="card p-3"><p class="text-xs text-slate-400">Cortesia</p><p class="text-xl font-bold text-teal-600">{{ counts.courtesy }}</p></div>
      <div class="card p-3"><p class="text-xs text-slate-400">Sem acesso</p><p class="text-xl font-bold text-red-600">{{ counts.withoutAccess }}</p></div>
    </div>

    <div class="flex items-center gap-3 flex-wrap">
      <div class="relative max-w-sm flex-1 min-w-[220px]">
        <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input v-model="search" placeholder="Buscar por nome ou email..." class="input-field w-full pl-9" />
      </div>
      <div class="flex gap-1 flex-wrap">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          :class="['px-3 py-1.5 rounded-lg text-xs font-medium border', filter === f.key ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50']"
          @click="filter = f.key"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <div class="card p-0 overflow-hidden table-responsive">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left">
            <th class="table-head-cell">Médico</th>
            <th class="table-head-cell">Equipe</th>
            <th class="table-head-cell">Status</th>
            <th class="table-head-cell">Validade</th>
            <th class="table-head-cell">Kiwify</th>
            <th class="table-head-cell">Nota admin</th>
            <th class="table-head-cell text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="7" class="px-4 py-8 text-center text-slate-400">Carregando...</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="7" class="px-4 py-8 text-center text-slate-400">Nenhum médico encontrado</td>
          </tr>
          <tr v-for="doctor in filtered" :key="doctor.id" class="table-row">
            <td class="table-cell">
              <p class="font-medium text-slate-900">{{ doctor.name }}</p>
              <p class="text-xs text-slate-400">{{ doctor.email }}</p>
            </td>
            <td class="table-cell">
              <span class="flex items-center gap-1 text-slate-500">
                <Users2 class="w-3.5 h-3.5" />
                {{ doctor._count.doctorTeam }}
              </span>
            </td>
            <td class="table-cell">
              <span
                class="px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap"
                :class="(STATUS_LABEL[doctor.access.displayStatus] ?? STATUS_LABEL.BLOCKED).color"
              >
                {{ (STATUS_LABEL[doctor.access.displayStatus] ?? STATUS_LABEL.BLOCKED).label }}
              </span>
            </td>
            <td class="table-cell text-slate-500 text-xs whitespace-nowrap">{{ validityOf(doctor) }}</td>
            <td class="table-cell text-xs">
              <span v-if="doctor.subscription?.kiwifySubscriptionId || doctor.subscription?._count.payments" class="flex items-center gap-1 text-emerald-600" :title="`Pedido ${doctor.subscription?.lastKiwifyOrderId ?? '—'}`">
                <Link2 class="w-3.5 h-3.5" />
                {{ doctor.subscription?._count.payments ?? 0 }} pag.
                <span v-if="doctor.subscription?.lastPaymentAt" class="text-slate-400">· {{ formatDate(doctor.subscription.lastPaymentAt) }}</span>
              </span>
              <span v-else class="text-slate-300">—</span>
            </td>
            <td class="table-cell text-slate-400 text-xs max-w-[200px] truncate" :title="doctor.subscription?.adminNote ?? ''">
              {{ doctor.subscription?.adminNote ?? '—' }}
            </td>
            <td class="table-cell">
              <div class="flex items-center justify-end gap-1.5">
                <button class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Liberar acesso manualmente" @click="openGrant(doctor)">
                  <Zap class="w-4 h-4" />
                </button>
                <button
                  class="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg disabled:opacity-50"
                  :title="`Conceder novo teste grátis (${trialDays} dias)`"
                  :disabled="resettingId === doctor.id"
                  @click="resetTrial(doctor.id)"
                >
                  <RotateCcw class="w-4 h-4" />
                </button>
                <button class="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Bloquear acesso" @click="openBlock(doctor)">
                  <Lock class="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal
      :is-open="!!grantTarget"
      :title="`Liberar acesso — ${grantTarget?.name ?? ''}`"
      subtitle="Libera manualmente, sem pagamento na Kiwify. Vale para toda a equipe vinculada a este médico."
      @close="grantTarget = null"
    >
      <div class="space-y-4">
        <div v-if="!unlimited">
          <label class="label">Dias de acesso</label>
          <input v-model.number="days" type="number" min="1" class="input-field w-full" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="unlimited" type="checkbox" />
          Sem prazo de expiração (cortesia permanente)
        </label>
        <div>
          <label class="label">Nota (opcional — ex.: "usuário de teste", "pagou por Pix direto")</label>
          <textarea v-model="note" class="input-field w-full" rows="2" />
        </div>
        <p class="text-xs text-slate-400">Se o médico pagar pela Kiwify depois, o pagamento substitui esta liberação automaticamente.</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="grantTarget = null">Cancelar</button>
          <button class="btn-primary" :disabled="grantSaving" @click="confirmGrant">Liberar acesso</button>
        </div>
      </template>
    </Modal>

    <Modal
      :is-open="!!blockTarget"
      :title="`Bloquear acesso — ${blockTarget?.name ?? ''}`"
      subtitle="Isso bloqueia toda a equipe vinculada a este médico (quando o bloqueio por assinatura estiver ligado)."
      @close="blockTarget = null"
    >
      <div>
        <label class="label">Motivo (opcional)</label>
        <textarea v-model="note" class="input-field w-full" rows="2" />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="blockTarget = null">Cancelar</button>
          <button class="btn-danger" :disabled="blockSaving" @click="confirmBlock">Bloquear acesso</button>
        </div>
      </template>
    </Modal>

    <Modal
      :is-open="showBulkTrial"
      title="Teste grátis para quem está sem acesso"
      :subtitle="`Concede ${trialDays} dias de teste, a partir de agora, a cada médico que hoje estaria bloqueado (${counts.withoutAccess}). Quem já tem acesso (pagante, cortesia ou em teste) não é alterado.`"
      @close="showBulkTrial = false"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-600">
          Recomendado logo antes de ligar o bloqueio por assinatura: quem já usava o sistema ganha alguns dias para assinar em vez de ser bloqueado na hora.
        </p>
        <div>
          <label class="label">Nota (opcional)</label>
          <input v-model="note" class="input-field w-full" placeholder="Teste grátis concedido em lote" />
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary" @click="showBulkTrial = false">Cancelar</button>
          <button class="btn-primary" :disabled="bulkSaving || counts.withoutAccess === 0" @click="confirmBulkTrial">
            Conceder a {{ counts.withoutAccess }} médico(s)
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>
