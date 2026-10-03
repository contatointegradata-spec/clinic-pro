<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import { Clock, Monitor, CalendarDays, Coffee } from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import { useAgendaPreferences } from '../../composables/useAgendaPreferences'
import api from '../../lib/api'
import toast from '../../lib/toast'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const authStore = useAuthStore()
const { preferences, setPreferences } = useAgendaPreferences()

const lunchStart = ref(authStore.user?.lunchStart || '')
const lunchEnd = ref(authStore.user?.lunchEnd || '')
const saving = ref(false)

watch(() => props.isOpen, (isOpen) => {
  if (isOpen && authStore.user) {
    lunchStart.value = authStore.user.lunchStart || ''
    lunchEnd.value = authStore.user.lunchEnd || ''
  }
})

function handlePresetChange(preset: 'commercial' | 'extended') {
  if (preset === 'commercial') {
    setPreferences({ startHour: 6, endHour: 19 })
  } else if (preset === 'extended') {
    setPreferences({ startHour: 1, endHour: 23 })
  }
}

function onIntervalHoursChange(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  const h = Math.max(0, Math.min(23, value))
  const m = preferences.interval % 60
  const total = h * 60 + m
  setPreferences({ interval: total > 0 ? total : 30 })
}

function onIntervalMinutesChange(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  const h = Math.floor(preferences.interval / 60)
  const m = Math.max(0, Math.min(59, value))
  const total = h * 60 + m
  setPreferences({ interval: total > 0 ? total : 30 })
}

async function handleSave() {
  try {
    saving.value = true
    const user = authStore.user
    if (user && user.role !== 'SECRETARY') {
      await api.put(`/users/${user.id}`, {
        lunchStart: lunchStart.value || null,
        lunchEnd: lunchEnd.value || null,
      })
      authStore.updateUser({
        lunchStart: lunchStart.value || null,
        lunchEnd: lunchEnd.value || null,
      })
    }
    toast.success('Configurações salvas!')
    emit('close')
  } catch (error) {
    toast.error('Erro ao salvar configurações')
    console.error(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :is-open="isOpen" title="Personalizar Agenda" size="md" @close="emit('close')">
    <div class="space-y-6">
      <!-- Horário de Exibição -->
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
          <Clock class="w-4 h-4 text-primary-600" />
          <h3>Horário de Exibição</h3>
        </div>

        <div class="flex gap-2">
          <button
            class="flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors"
            :class="preferences.startHour === 6 && preferences.endHour === 19
              ? 'bg-primary-50 border-primary-200 text-primary-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'"
            @click="handlePresetChange('commercial')"
          >
            Comercial
            <span class="block text-xs font-normal opacity-70">06:00 às 19:00</span>
          </button>
          <button
            class="flex-1 py-2 px-3 rounded-xl border text-sm font-medium transition-colors"
            :class="preferences.startHour === 1 && preferences.endHour === 23
              ? 'bg-primary-50 border-primary-200 text-primary-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'"
            @click="handlePresetChange('extended')"
          >
            Estendido
            <span class="block text-xs font-normal opacity-70">01:00 às 23:00</span>
          </button>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <div class="flex-1">
            <label class="text-xs font-medium text-slate-500 mb-1 block">Início (Personalizado)</label>
            <select
              :value="preferences.startHour"
              class="input-field py-1.5"
              @change="setPreferences({ startHour: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="i in 24" :key="i - 1" :value="i - 1">{{ String(i - 1).padStart(2, '0') }}:00</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="text-xs font-medium text-slate-500 mb-1 block">Fim (Personalizado)</label>
            <select
              :value="preferences.endHour"
              class="input-field py-1.5"
              @change="setPreferences({ endHour: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="i in 24" :key="i - 1" :value="i - 1">{{ String(i - 1).padStart(2, '0') }}:00</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Formatação da Grade -->
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
          <CalendarDays class="w-4 h-4 text-primary-600" />
          <h3>Formatação da Grade</h3>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700 mb-1.5 block">
            Intervalo de horários
          </label>
          <div class="flex gap-3">
            <div class="flex-1">
              <label class="text-xs font-medium text-slate-500 mb-1 block">Horas</label>
              <input
                type="number"
                :min="0"
                :max="23"
                :value="Math.floor(preferences.interval / 60)"
                class="input-field py-1.5"
                @change="onIntervalHoursChange"
              />
            </div>
            <div class="flex-1">
              <label class="text-xs font-medium text-slate-500 mb-1 block">Minutos</label>
              <input
                type="number"
                :min="0"
                :max="59"
                :value="preferences.interval % 60"
                class="input-field py-1.5"
                @change="onIntervalMinutesChange"
              />
            </div>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700 mb-1.5 block">
            Início da Semana
          </label>
          <select
            :value="preferences.weekStartsOn"
            class="input-field"
            @change="setPreferences({ weekStartsOn: Number(($event.target as HTMLSelectElement).value) as 0 | 1 })"
          >
            <option :value="1">Segunda-feira</option>
            <option :value="0">Domingo</option>
          </select>
        </div>
      </div>

      <!-- Horário de Almoço — apenas para médico/admin -->
      <div v-if="authStore.user?.role !== 'SECRETARY'" class="space-y-3">
        <div class="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
          <Coffee class="w-4 h-4 text-primary-600" />
          <h3>Definir Horário de Almoço</h3>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="text-xs font-medium text-slate-500 mb-1 block">Início do Almoço</label>
            <input v-model="lunchStart" type="time" class="input-field py-1.5" />
          </div>
          <div class="flex-1">
            <label class="text-xs font-medium text-slate-500 mb-1 block">Fim do Almoço</label>
            <input v-model="lunchEnd" type="time" class="input-field py-1.5" />
          </div>
        </div>
        <p class="text-xs text-slate-500">
          A agenda será automaticamente bloqueada e sinalizada como período de almoço durante este intervalo.
        </p>
      </div>

      <!-- Visualização -->
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
          <Monitor class="w-4 h-4 text-primary-600" />
          <h3>Visualização</h3>
        </div>

        <label class="flex items-center gap-3 cursor-pointer group">
          <div class="relative flex items-center justify-center">
            <input
              type="checkbox"
              :checked="preferences.hideWeekends"
              class="peer appearance-none w-5 h-5 border-2 border-slate-300 rounded checked:bg-primary-600 checked:border-primary-600 transition-colors"
              @change="setPreferences({ hideWeekends: ($event.target as HTMLInputElement).checked })"
            />
            <svg class="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 14 10" fill="none">
              <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">Ocultar finais de semana</span>
            <span class="text-xs text-slate-500">Exibir apenas de Segunda a Sexta</span>
          </div>
        </label>

        <label class="flex items-center gap-3 cursor-pointer group pt-2">
          <div class="relative flex items-center justify-center">
            <input
              type="checkbox"
              :checked="preferences.compactMode"
              class="peer appearance-none w-5 h-5 border-2 border-slate-300 rounded checked:bg-primary-600 checked:border-primary-600 transition-colors"
              @change="setPreferences({ compactMode: ($event.target as HTMLInputElement).checked })"
            />
            <svg class="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100" viewBox="0 0 14 10" fill="none">
              <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="flex flex-col">
            <span class="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">Modo Compacto</span>
            <span class="text-xs text-slate-500">Reduz a altura das linhas para mostrar mais horários</span>
          </div>
        </label>
      </div>

      <div class="pt-4 border-t border-slate-100 flex justify-end">
        <button :disabled="saving" class="btn-primary px-6" @click="handleSave">
          {{ saving ? 'Salvando...' : 'Concluir' }}
        </button>
      </div>
    </div>
  </Modal>
</template>
