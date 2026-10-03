<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import { z } from 'zod'
import { MapPin } from 'lucide-vue-next'
import type { Room, DoctorSecretary } from '../../types'

const DAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

const SLOT_DURATIONS = [15, 20, 30, 40, 45, 60, 90]

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  logradouro: z.string().optional(),
  bairro: z.string().optional(),
  cep: z.string().optional(),
  numero: z.string().optional(),
  cidade: z.string().optional(),
  daysOfWeek: z.array(z.number()).min(1, 'Selecione ao menos um dia'),
  startTime: z.string().min(1, 'Horário inicial obrigatório'),
  endTime: z.string().min(1, 'Horário final obrigatório'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  specialHours: z.record(z.object({ start: z.string(), end: z.string() })).optional(),
  slotDurationMinutes: z.coerce.number().min(5).max(240).default(30),
  secretaryIds: z.array(z.string()).optional(),
})

type FormData = z.infer<typeof schema>

const props = defineProps<{
  room: Room | null
  secretaries: DoctorSecretary[]
  loading: boolean
}>()

const emit = defineEmits<{ submit: [data: FormData] }>()

const form = reactive<FormData>({
  name: '',
  logradouro: '',
  bairro: '',
  cep: '',
  numero: '',
  cidade: '',
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: '07:00',
  endTime: '18:00',
  breakStart: '',
  breakEnd: '',
  specialHours: {},
  slotDurationMinutes: 30,
  secretaryIds: [],
})

const errors = reactive<Partial<Record<keyof FormData, string>>>({})

watch(() => props.room, (room) => {
  form.name = room?.name || ''
  form.logradouro = room?.logradouro || ''
  form.bairro = (room as unknown as { bairro?: string })?.bairro || ''
  form.cep = room?.cep || ''
  form.numero = room?.numero || ''
  form.cidade = room?.cidade || ''
  form.daysOfWeek = room?.daysOfWeek?.length ? [...room.daysOfWeek] : [1, 2, 3, 4, 5]
  form.startTime = room?.startTime || '07:00'
  form.endTime = room?.endTime || '18:00'
  form.breakStart = room?.breakStart || ''
  form.breakEnd = room?.breakEnd || ''
  form.specialHours = room?.specialHours ? { ...room.specialHours } : {}
  form.slotDurationMinutes = room?.slotDurationMinutes || 30
  form.secretaryIds = room?.secretaries?.filter(s => s.active).map(s => s.secretaryId) || []
}, { immediate: true })

const weekendDays = DAYS.filter(d => d.value === 6 || d.value === 7)

function toggleDay(day: number) {
  form.daysOfWeek = form.daysOfWeek.includes(day)
    ? form.daysOfWeek.filter(d => d !== day)
    : [...form.daysOfWeek, day].sort((a, b) => a - b)
}

function toggleSpecialHours(day: number) {
  const key = String(day)
  const next = { ...(form.specialHours ?? {}) }
  if (next[key]) {
    delete next[key]
  } else {
    next[key] = { start: form.startTime || '08:00', end: form.endTime || '18:00' }
  }
  form.specialHours = next
}

function updateSpecialHours(day: number, field: 'start' | 'end', value: string) {
  const key = String(day)
  const current = form.specialHours?.[key] ?? { start: '08:00', end: '18:00' }
  form.specialHours = { ...(form.specialHours ?? {}), [key]: { ...current, [field]: value } }
}

function toggleSecretary(id: string) {
  const current = form.secretaryIds ?? []
  form.secretaryIds = current.includes(id) ? current.filter(s => s !== id) : [...current, id]
}

const secretaryIdsSet = computed(() => new Set(form.secretaryIds ?? []))

function handleSubmit() {
  for (const key of Object.keys(errors) as (keyof FormData)[]) {
    errors[key] = undefined
  }

  const result = schema.safeParse(form)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormData
      errors[key] = issue.message
    }
    return
  }

  emit('submit', {
    ...result.data,
    breakStart: result.data.breakStart || undefined,
    breakEnd: result.data.breakEnd || undefined,
  })
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="handleSubmit">
    <div>
      <label class="label">Nome da Sala / Local *</label>
      <input v-model="form.name" class="input-field" placeholder="Ex: Consultório 1, Sala Norte..." />
      <p v-if="errors.name" class="text-xs text-red-500 mt-1">{{ errors.name }}</p>
    </div>

    <div class="space-y-3">
      <label class="label flex items-center gap-1.5">
        <MapPin class="w-3.5 h-3.5 text-slate-400" /> Endereço
      </label>
      <input v-model="form.logradouro" class="input-field" placeholder="Logradouro (Rua, Av., Al...)" />
      <div class="grid grid-cols-2 gap-3">
        <input v-model="form.numero" class="input-field" placeholder="Número" />
        <input v-model="form.bairro" class="input-field" placeholder="Bairro" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <input v-model="form.cep" class="input-field" placeholder="CEP" maxlength="9" />
        <input v-model="form.cidade" class="input-field" placeholder="Cidade / UF" />
      </div>
    </div>

    <div>
      <label class="label">Dias de atendimento *</label>
      <div class="flex gap-2 flex-wrap mt-1">
        <button
          v-for="d in DAYS" :key="d.value" type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
          :class="form.daysOfWeek.includes(d.value) ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-200 text-slate-600 hover:border-primary-300'"
          @click="toggleDay(d.value)"
        >{{ d.label }}</button>
      </div>
      <p v-if="errors.daysOfWeek" class="text-xs text-red-500 mt-1">{{ errors.daysOfWeek }}</p>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Início do atendimento</label>
        <input v-model="form.startTime" type="time" class="input-field" />
      </div>
      <div>
        <label class="label">Fim do atendimento</label>
        <input v-model="form.endTime" type="time" class="input-field" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Início do intervalo <span class="text-slate-400 font-normal">(opcional)</span></label>
        <input v-model="form.breakStart" type="time" class="input-field" />
      </div>
      <div>
        <label class="label">Fim do intervalo <span class="text-slate-400 font-normal">(opcional)</span></label>
        <input v-model="form.breakEnd" type="time" class="input-field" />
      </div>
    </div>

    <div class="space-y-2">
      <label class="label">Horário especial <span class="text-slate-400 font-normal">(opcional — Sábado e Domingo)</span></label>
      <div
        v-for="d in weekendDays" :key="d.value"
        class="rounded-xl border p-3"
        :class="form.specialHours?.[String(d.value)] ? 'border-amber-300 bg-amber-50' : 'border-slate-200'"
      >
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            :checked="!!form.specialHours?.[String(d.value)]"
            class="w-4 h-4 text-amber-600"
            @change="toggleSpecialHours(d.value)"
          />
          <span class="text-sm font-medium text-slate-700">Horário especial — {{ d.label }}</span>
        </label>
        <div v-if="form.specialHours?.[String(d.value)]" class="grid grid-cols-2 gap-3 mt-2">
          <div>
            <label class="label">Início</label>
            <input
              type="time"
              :value="form.specialHours[String(d.value)].start"
              class="input-field"
              @input="updateSpecialHours(d.value, 'start', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div>
            <label class="label">Fim</label>
            <input
              type="time"
              :value="form.specialHours[String(d.value)].end"
              class="input-field"
              @input="updateSpecialHours(d.value, 'end', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <div>
      <label class="label">Duração de cada horário (minutos)</label>
      <select v-model.number="form.slotDurationMinutes" class="input-field">
        <option v-for="v in SLOT_DURATIONS" :key="v" :value="v">{{ v }} min</option>
      </select>
    </div>

    <div v-if="secretaries.length > 0">
      <label class="label">Secretárias vinculadas</label>
      <div class="space-y-2 mt-1">
        <label
          v-for="s in secretaries" :key="s.id"
          class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50"
        >
          <input
            type="checkbox"
            :checked="secretaryIdsSet.has(s.secretary.id)"
            class="w-4 h-4 text-primary-600"
            @change="toggleSecretary(s.secretary.id)"
          />
          <div>
            <p class="text-sm font-medium text-slate-900">{{ s.secretary.name }}</p>
            <p class="text-xs text-slate-500">{{ s.secretary.email }}</p>
          </div>
        </label>
      </div>
      <p class="text-xs text-slate-400 mt-2">Configure as permissões individuais na aba Permissões após salvar.</p>
    </div>

    <button type="submit" :disabled="loading" class="btn-primary w-full">
      <span v-if="loading" class="flex items-center gap-2 justify-center">
        <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        Salvando...
      </span>
      <template v-else>{{ room ? 'Atualizar Sala' : 'Criar Sala' }}</template>
    </button>
  </form>
</template>
