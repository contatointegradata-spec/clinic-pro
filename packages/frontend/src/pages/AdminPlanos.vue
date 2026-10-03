<script setup lang="ts">
import { ref, computed } from 'vue'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Zap, Lock, RotateCcw, Users2, Search } from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import Modal from '../components/ui/Modal.vue'
import { useQuery } from '../composables/useQuery'

interface DoctorSubscriptionRow {
  id: string
  name: string
  email: string
  specialty: string | null
  createdAt: string
  _count: { doctorTeam: number }
  subscription: {
    status: string
    trialEndsAt: string | null
    currentPeriodEndsAt: string | null
    lastPaymentAt: string | null
    blockedAt: string | null
    canceledAt: string | null
    adminNote: string | null
    updatedAt: string
  } | null
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  TRIAL: { label: 'Trial', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  ACTIVE: { label: 'Ativa', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING_PAYMENT: { label: 'Pag. pendente', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  PAST_DUE: { label: 'Atrasada', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  CANCELED: { label: 'Cancelada', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  BLOCKED: { label: 'Bloqueada', color: 'bg-red-50 text-red-700 border-red-200' },
}

const search = ref('')
const grantTarget = ref<DoctorSubscriptionRow | null>(null)
const blockTarget = ref<DoctorSubscriptionRow | null>(null)
const unlimited = ref(true)
const days = ref(30)
const note = ref('')

const grantSaving = ref(false)
const blockSaving = ref(false)
const resettingId = ref<string | null>(null)

const { data: doctorsData, isLoading, refetch } = useQuery<DoctorSubscriptionRow[]>({
  key: 'admin-subscriptions',
  queryFn: () => api.get('/admin/subscriptions').then(r => r.data),
})
const doctors = computed(() => doctorsData.value ?? [])

const filtered = computed(() => doctors.value.filter(d =>
  d.name.toLowerCase().includes(search.value.toLowerCase()) || d.email.toLowerCase().includes(search.value.toLowerCase())
))

function openGrant(doctor: DoctorSubscriptionRow) {
  grantTarget.value = doctor
  unlimited.value = true
  days.value = 30
  note.value = ''
}

function openBlock(doctor: DoctorSubscriptionRow) {
  blockTarget.value = doctor
  note.value = ''
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
  } catch {
    toast.error('Não foi possível liberar o acesso')
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
  } catch {
    toast.error('Não foi possível bloquear o acesso')
  } finally {
    blockSaving.value = false
  }
}

async function resetTrial(doctorId: string) {
  resettingId.value = doctorId
  try {
    await api.post(`/admin/subscriptions/${doctorId}/reset-trial`, {})
    toast.success('Trial de 7 dias reiniciado')
    await refetch()
  } catch {
    toast.error('Não foi possível resetar o trial')
  } finally {
    resettingId.value = null
  }
}

function validUntilOf(doctor: DoctorSubscriptionRow): string | null {
  return doctor.subscription?.currentPeriodEndsAt ?? doctor.subscription?.trialEndsAt ?? null
}
</script>

<template>
  <div class="space-y-4 animate-fade-in">
    <div>
      <h1 class="page-title">Gestão de Planos</h1>
      <p class="page-subtitle">
        Libere, bloqueie ou reinicie o trial de qualquer médico manualmente — libera automaticamente toda a equipe vinculada.
      </p>
    </div>

    <div class="relative max-w-sm">
      <Search class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input v-model="search" placeholder="Buscar por nome ou email..." class="input-field w-full pl-9" />
    </div>

    <div class="card p-0 overflow-hidden table-responsive">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-left">
            <th class="table-head-cell">Médico</th>
            <th class="table-head-cell">Equipe</th>
            <th class="table-head-cell">Status</th>
            <th class="table-head-cell">Validade</th>
            <th class="table-head-cell">Nota admin</th>
            <th class="table-head-cell text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Carregando...</td>
          </tr>
          <tr v-else-if="filtered.length === 0">
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">Nenhum médico encontrado</td>
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
                class="px-2 py-0.5 rounded-full text-xs font-semibold border"
                :class="(STATUS_LABEL[doctor.subscription?.status ?? 'BLOCKED'] ?? STATUS_LABEL.BLOCKED).color"
              >
                {{ (STATUS_LABEL[doctor.subscription?.status ?? 'BLOCKED'] ?? STATUS_LABEL.BLOCKED).label }}
              </span>
            </td>
            <td class="table-cell text-slate-500 text-xs">
              {{ validUntilOf(doctor) ? format(new Date(validUntilOf(doctor)!), 'd MMM yyyy', { locale: ptBR }) : 'Sem prazo' }}
            </td>
            <td class="table-cell text-slate-400 text-xs max-w-[200px] truncate" :title="doctor.subscription?.adminNote ?? ''">
              {{ doctor.subscription?.adminNote ?? '—' }}
            </td>
            <td class="table-cell">
              <div class="flex items-center justify-end gap-1.5">
                <button class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Liberar acesso" @click="openGrant(doctor)">
                  <Zap class="w-4 h-4" />
                </button>
                <button
                  class="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg disabled:opacity-50"
                  title="Resetar trial (7 dias)"
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
      subtitle="Isso libera automaticamente toda a equipe vinculada a este médico."
      @close="grantTarget = null"
    >
      <div class="space-y-4">
        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input v-model="unlimited" type="checkbox" />
          Sem prazo de expiração (grandfathering)
        </label>
        <div v-if="!unlimited">
          <label class="label">Dias de acesso</label>
          <input v-model.number="days" type="number" min="1" class="input-field w-full" />
        </div>
        <div>
          <label class="label">Nota (opcional — ex.: "usuário de teste")</label>
          <textarea v-model="note" class="input-field w-full" rows="2" />
        </div>
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
      subtitle="Isso bloqueia automaticamente toda a equipe vinculada a este médico."
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
  </div>
</template>
