<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight, Cake, MessageCircle, Gift } from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { whatsappLink } from '../../lib/clinical'
import { greetingName } from '../../lib/firstName'

interface Birthday { id: string; name: string; phone: string; birthDate: string; day: number; turning: number; daysUntil: number }

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const currentMonth = new Date().getMonth() + 1

const month = ref(currentMonth)
const list = ref<Birthday[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get<{ month: number; patients: Birthday[] }>('/clinical/birthdays', { params: { month: month.value } })
    list.value = data.patients
  } catch {
    toast.error('Não foi possível carregar os aniversariantes')
  } finally {
    loading.value = false
  }
}
watch(month, load, { immediate: true })

function shift(delta: number) {
  month.value = ((month.value - 1 + delta + 12) % 12) + 1
}

const isCurrent = computed(() => month.value === currentMonth)
const today = computed(() => (isCurrent.value ? list.value.filter(b => b.daysUntil === 0) : []))
const others = computed(() => (isCurrent.value ? list.value.filter(b => b.daysUntil !== 0) : list.value))

function whenLabel(b: Birthday) {
  if (!isCurrent.value) return `dia ${b.day}`
  if (b.daysUntil === 0) return 'hoje'
  if (b.daysUntil === 1) return 'amanhã'
  if (b.daysUntil > 1) return `em ${b.daysUntil} dias`
  return 'já passou'
}

function message(b: Birthday) {
  return `Feliz aniversário, ${greetingName(b.name)}! 🎉 Toda a equipe deseja um dia lindo para você. Que tal comemorar se cuidando? Temos uma condição especial no mês do seu aniversário. 💕`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <button class="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Mês anterior" @click="shift(-1)"><ChevronLeft class="w-4 h-4" /></button>
      <p class="font-display text-lg font-semibold text-slate-900 w-36 text-center">{{ MONTHS[month - 1] }}</p>
      <button class="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Próximo mês" @click="shift(1)"><ChevronRight class="w-4 h-4" /></button>
      <button v-if="!isCurrent" class="text-xs font-semibold text-primary-700 hover:underline ml-1" @click="month = currentMonth">Mês atual</button>
      <span class="ml-auto text-sm text-slate-500">{{ list.length }} aniversariante(s)</span>
    </div>

    <div v-if="loading" class="space-y-2"><div v-for="i in 3" :key="i" class="h-14 skeleton" /></div>
    <div v-else-if="list.length === 0" class="py-12 text-center">
      <div class="w-12 h-12 mx-auto rounded-2xl bg-primary-50 flex items-center justify-center mb-3"><Cake class="w-6 h-6 text-primary-500" /></div>
      <p class="text-sm font-medium text-slate-700">Nenhum aniversariante em {{ MONTHS[month - 1].toLowerCase() }}</p>
      <p class="text-xs text-slate-500 mt-1">Preencha a data de nascimento no cadastro das pacientes para aparecerem aqui.</p>
    </div>
    <template v-else>
      <div v-if="today.length" class="rounded-2xl border border-gold-200 bg-gold-50/60 p-3 space-y-1">
        <p class="text-xs font-bold uppercase tracking-wider text-gold-800 px-2 flex items-center gap-1.5"><Gift class="w-3.5 h-3.5" /> Hoje</p>
        <div v-for="b in today" :key="b.id" class="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5">
          <router-link :to="`/pacientes/${b.id}`" class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-900 truncate">{{ b.name }}</p>
            <p class="text-xs text-slate-500">Completa {{ b.turning }} anos</p>
          </router-link>
          <a :href="whatsappLink(b.phone, message(b))" target="_blank" rel="noopener" class="btn-primary text-xs py-1.5"><MessageCircle class="w-3.5 h-3.5" /> Dar parabéns</a>
        </div>
      </div>

      <div class="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        <div v-for="b in others" :key="b.id" :class="['flex items-center gap-3 px-4 py-3', isCurrent && b.daysUntil < 0 && 'opacity-60']">
          <div class="w-11 text-center">
            <p class="font-display text-lg font-semibold text-slate-800 leading-none">{{ b.day }}</p>
            <p class="text-[10px] uppercase text-slate-400">{{ MONTHS[month - 1].slice(0, 3) }}</p>
          </div>
          <router-link :to="`/pacientes/${b.id}`" class="flex-1 min-w-0">
            <p class="text-sm font-medium text-slate-800 truncate hover:text-primary-700">{{ b.name }}</p>
            <p class="text-xs text-slate-500">Completa {{ b.turning }} anos · {{ whenLabel(b) }}</p>
          </router-link>
          <a v-if="b.phone" :href="whatsappLink(b.phone, message(b))" target="_blank" rel="noopener" class="p-2 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100" title="Mensagem pelo WhatsApp"><MessageCircle class="w-4 h-4" /></a>
        </div>
      </div>
      <p class="text-xs text-slate-400">Dica: ative a mensagem automática de aniversário em Configurações › Mensagens automáticas.</p>
    </template>
  </div>
</template>
