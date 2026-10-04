<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue'
import { z } from 'zod'
import { format, differenceInYears, parseISO } from 'date-fns'
import { Plus, Trash2, CreditCard, ArrowRight, MapPin, ShieldCheck } from 'lucide-vue-next'
import api from '../../lib/api'
import type { Patient, HealthPlan } from '../../types'
import { useQuery } from '../../composables/useQuery'

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  phone: z.string().min(10, 'Telefone inválido'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  birthDate: z.string().optional(),
  cpf: z.string().optional(),
  rg: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  responsibleName: z.string().optional(),
  responsiblePhone: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface PlanEntry {
  healthPlanId: string
  value: number | undefined
  walletNumber: string
}

const props = defineProps<{
  patient: Patient | null
  loading: boolean
}>()

// LGPD — versão atual do termo exibido no checkbox de consentimento.
// Mudou o texto do termo? Sobe este valor (fica registrado por consentimento
// qual versão a pessoa aceitou).
const CURRENT_TERMS_VERSION = 'v1'

type ConsentChannel = 'PRESENCIAL' | 'TELEFONE' | 'WHATSAPP' | 'OUTRO'

const emit = defineEmits<{
  submit: [data: FormData & { plans: PlanEntry[]; consent?: { channel: ConsentChannel; termsVersion: string } }]
}>()

const typeLabel: Record<string, string> = {
  PARTICULAR: 'Particular',
  CONVENIO: 'Convênio',
  OUTROS: 'Outros',
}

function formatBrazilPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  // Telefone salvo vem com DDI (55) na frente — mesmo formato que o backend
  // usa pra casar com o telefone do WhatsApp (ver lib/phone.ts). Pra exibir/
  // editar, mostra só DDD+número, sem o 55.
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2)
  digits = digits.slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

const form = reactive<FormData>({
  name: '',
  phone: '',
  email: '',
  birthDate: '',
  cpf: '',
  rg: '',
  address: '',
  notes: '',
  responsibleName: '',
  responsiblePhone: '',
})

const errors = reactive<Partial<Record<keyof FormData, string>>>({})
const phoneDisplay = ref('')
const plans = ref<PlanEntry[]>([])
const consentGiven = ref(false)
const consentChannel = ref<ConsentChannel>('PRESENCIAL')
const consentError = ref('')

const { data: healthPlansData } = useQuery<HealthPlan[]>({
  key: 'health-plans',
  queryFn: () => api.get('/health-plans').then(r => r.data),
})
const healthPlans = computed(() => healthPlansData.value ?? [])

const isMinor = computed(() => {
  if (!form.birthDate) return false
  try {
    const parsedDate = parseISO(form.birthDate)
    if (!isNaN(parsedDate.getTime())) {
      return differenceInYears(new Date(), parsedDate) < 18
    }
  } catch (e) {
    console.error(e)
  }
  return false
})

watch(
  () => props.patient,
  (patient) => {
    if (patient) {
      form.name = patient.name
      const formattedPhone = formatBrazilPhone(patient.phone ?? '')
      phoneDisplay.value = formattedPhone
      form.phone = formattedPhone
      form.email = patient.email || ''
      form.cpf = patient.cpf || ''
      form.rg = patient.rg || ''
      form.address = patient.address || ''
      form.notes = patient.notes || ''
      form.responsibleName = patient.responsibleName || ''
      form.responsiblePhone = patient.responsiblePhone || ''
      if (patient.birthDate) form.birthDate = format(new Date(patient.birthDate), 'yyyy-MM-dd')

      if (patient.patientPlans) {
        plans.value = patient.patientPlans.map(pp => ({
          healthPlanId: pp.healthPlanId,
          value: pp.value ?? undefined,
          walletNumber: pp.walletNumber || '',
        }))
      }
    }
  },
  { immediate: true }
)

function onPhoneInput(e: Event) {
  const target = e.target as HTMLInputElement
  const formatted = formatBrazilPhone(target.value)
  phoneDisplay.value = formatted
  form.phone = formatted
}

function addPlan() {
  plans.value.push({ healthPlanId: '', value: undefined, walletNumber: '' })
}

function removePlan(i: number) {
  plans.value = plans.value.filter((_, idx) => idx !== i)
}

function updatePlan(i: number, field: keyof PlanEntry, value: string | number | undefined) {
  plans.value = plans.value.map((p, idx) => (idx === i ? { ...p, [field]: value } : p))
}

function getPlanType(planId: string) {
  return healthPlans.value.find(p => p.id === planId)?.type || ''
}

function getRepasse(plan: PlanEntry): { base: number; repasse: number; discount: number } | null {
  const hp = healthPlans.value.find(p => p.id === plan.healthPlanId)
  if (!hp) return null
  const discount = hp.discountPercent ?? 0
  const base = plan.value ?? hp.defaultValue ?? null
  if (base === null) return null
  return { base, repasse: base * (1 - discount / 100), discount }
}

function getRoom(planId: string) {
  return healthPlans.value.find(p => p.id === planId)?.room ?? null
}

function handleSubmit() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    errors[key] = undefined
  }
  consentError.value = ''

  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  // Consentimento só é obrigatório no cadastro — editar um paciente já
  // cadastrado não reabre a pergunta aqui.
  if (!props.patient && !consentGiven.value) {
    consentError.value = 'Confirme que o paciente consentiu com o tratamento de dados antes de salvar.'
    return
  }

  const validPlans = plans.value.filter(p => p.healthPlanId)
  const consent = !props.patient
    ? { channel: consentChannel.value, termsVersion: CURRENT_TERMS_VERSION }
    : undefined
  emit('submit', { ...result.data, plans: validPlans, consent })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleSubmit">
    <!-- Personal data -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="sm:col-span-2">
        <label class="label">Nome completo *</label>
        <input v-model="form.name" class="input-field" placeholder="Nome do paciente" />
        <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
      </div>

      <div>
        <label class="label">Celular *</label>
        <input
          :value="phoneDisplay"
          class="input-field"
          placeholder="(34) 99999-0000"
          inputmode="numeric"
          @input="onPhoneInput"
        />
        <p v-if="errors.phone" class="text-xs text-red-500 mt-1">{{ errors.phone }}</p>
      </div>

      <div>
        <label class="label">Email</label>
        <input v-model="form.email" type="email" class="input-field" placeholder="email@exemplo.com" />
        <p v-if="errors.email" class="text-xs text-red-500 mt-1">{{ errors.email }}</p>
      </div>

      <div>
        <label class="label">CPF</label>
        <input v-model="form.cpf" class="input-field font-mono" placeholder="000.000.000-00" />
      </div>

      <div>
        <label class="label">RG</label>
        <input v-model="form.rg" class="input-field font-mono" placeholder="00.000.000-0" />
      </div>

      <div>
        <label class="label">Data de Nascimento</label>
        <input v-model="form.birthDate" type="date" class="input-field" />
      </div>

      <template v-if="isMinor">
        <div>
          <label class="label">Nome do Responsável</label>
          <input v-model="form.responsibleName" class="input-field" placeholder="Nome do responsável" />
          <p v-if="errors.responsibleName" class="text-xs text-red-500 mt-1">{{ errors.responsibleName }}</p>
        </div>

        <div>
          <label class="label">Telefone do Responsável</label>
          <input v-model="form.responsiblePhone" class="input-field" placeholder="(11) 99999-0000" />
          <p v-if="errors.responsiblePhone" class="text-xs text-red-500 mt-1">{{ errors.responsiblePhone }}</p>
        </div>
      </template>
    </div>

    <div>
      <label class="label">Endereço</label>
      <input v-model="form.address" class="input-field" placeholder="Rua, número, bairro - Cidade/UF" />
    </div>

    <div>
      <label class="label">Observações</label>
      <textarea v-model="form.notes" rows="2" class="input-field resize-none" placeholder="Informações relevantes..." />
    </div>

    <!-- Health plans section -->
    <div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div class="flex items-center gap-2">
          <CreditCard class="w-4 h-4 text-primary-600" />
          <span class="font-semibold text-slate-900 text-sm">Planos de Saúde</span>
          <span v-if="plans.length > 0" class="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">{{ plans.length }}</span>
        </div>
        <button type="button" class="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium" @click="addPlan">
          <Plus class="w-3.5 h-3.5" />
          Adicionar plano
        </button>
      </div>

      <div v-if="plans.length === 0" class="px-4 py-4 text-center">
        <p class="text-sm text-slate-400">Nenhum plano vinculado</p>
        <button type="button" class="text-primary-600 text-xs font-medium mt-1 hover:underline" @click="addPlan">
          + Vincular plano de saúde
        </button>
      </div>
      <div v-else class="divide-y divide-slate-100">
        <div v-for="(plan, i) in plans" :key="i" class="p-4 space-y-3">
          <div class="flex items-center gap-2">
            <div class="flex-1 grid grid-cols-2 gap-3">
              <div>
                <label class="label">Plano</label>
                <select
                  :value="plan.healthPlanId"
                  class="input-field text-sm"
                  @change="updatePlan(i, 'healthPlanId', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Selecione o plano</option>
                  <option v-for="hp in healthPlans" :key="hp.id" :value="hp.id">
                    {{ hp.name }} ({{ typeLabel[hp.type] }})
                  </option>
                </select>
              </div>

              <div>
                <label class="label">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  :value="plan.value ?? ''"
                  class="input-field text-sm"
                  placeholder="0,00"
                  @input="updatePlan(i, 'value', ($event.target as HTMLInputElement).value ? parseFloat(($event.target as HTMLInputElement).value) : undefined)"
                />
              </div>
            </div>

            <button
              type="button"
              class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-5 flex-shrink-0"
              @click="removePlan(i)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>

          <div v-if="getRepasse(plan)" class="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div class="flex items-center gap-1.5 text-xs text-slate-500 flex-1">
              <span>R$ {{ getRepasse(plan)!.base.toFixed(2).replace('.', ',') }}</span>
              <template v-if="getRepasse(plan)!.discount > 0">
                <span class="text-slate-400">−{{ getRepasse(plan)!.discount }}%</span>
                <ArrowRight class="w-3 h-3 text-slate-400" />
              </template>
            </div>
            <div class="text-right">
              <p class="text-xs text-emerald-700 font-medium">Valor de repasse</p>
              <p class="text-sm font-bold text-emerald-800">
                R$ {{ getRepasse(plan)!.repasse.toFixed(2).replace('.', ',') }}
              </p>
            </div>
          </div>

          <!-- Room info linked to this plan -->
          <div v-if="getRoom(plan.healthPlanId)" class="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
            <MapPin class="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-indigo-800">Atendimento em: {{ getRoom(plan.healthPlanId)!.name }}</p>
              <p v-if="getRoom(plan.healthPlanId)!.logradouro || getRoom(plan.healthPlanId)!.cidade" class="text-xs text-indigo-600 truncate">
                {{ [getRoom(plan.healthPlanId)!.logradouro, getRoom(plan.healthPlanId)!.cidade].filter(Boolean).join(' — ') }}
              </p>
            </div>
          </div>

          <div v-if="getPlanType(plan.healthPlanId) === 'CONVENIO'">
            <label class="label flex items-center gap-1">
              <CreditCard class="w-3.5 h-3.5 text-emerald-600" />
              Número da Carteirinha
            </label>
            <input
              type="text"
              :value="plan.walletNumber"
              class="input-field text-sm font-mono"
              placeholder="Número da carteira do convênio"
              @input="updatePlan(i, 'walletNumber', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- LGPD — consentimento (só no cadastro) -->
    <div v-if="!patient" class="border border-slate-200 rounded-xl p-4 bg-slate-50/60">
      <label class="flex items-start gap-2.5 cursor-pointer">
        <input v-model="consentGiven" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
        <span class="text-sm text-slate-700">
          <span class="flex items-center gap-1.5 font-medium text-slate-900">
            <ShieldCheck class="w-3.5 h-3.5 text-primary-600" />
            Paciente consentiu com o tratamento de dados (LGPD)
          </span>
          <span class="text-xs text-slate-500">Confirme que o paciente foi informado e concordou antes de salvar o cadastro.</span>
        </span>
      </label>

      <div v-if="consentGiven" class="mt-3">
        <label class="label text-xs">Canal do consentimento</label>
        <select v-model="consentChannel" class="input-field text-sm">
          <option value="PRESENCIAL">Presencial</option>
          <option value="TELEFONE">Telefone</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="OUTRO">Outro</option>
        </select>
      </div>

      <p v-if="consentError" class="text-xs text-red-500 mt-2">{{ consentError }}</p>
    </div>

    <button type="submit" :disabled="loading" class="btn-primary w-full mt-2">
      <span v-if="loading" class="flex items-center gap-2 justify-center">
        <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        Salvando...
      </span>
      <template v-else>{{ patient ? 'Atualizar Paciente' : 'Cadastrar Paciente' }}</template>
    </button>
  </form>
</template>
