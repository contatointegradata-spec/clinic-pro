<script setup lang="ts">
import { computed } from 'vue'
import { Check, CheckCheck, Clock, AlertCircle, Bot, StickyNote, Paperclip, RotateCw, X } from 'lucide-vue-next'
import type { ChatMessage } from '../../stores/attendance'
import { clockTime } from './format'

const props = defineProps<{ message: ChatMessage }>()
const emit = defineEmits<{ retry: [localId: string]; discard: [localId: string] }>()

const m = computed(() => props.message)
const kind = computed(() => (m.value.type || '').toLowerCase())
const isImage = computed(() => !!m.value.mediaUrl && kind.value.includes('image'))
const isAudio = computed(() => !!m.value.mediaUrl && (kind.value.includes('audio') || kind.value.includes('ptt')))
</script>

<template>
  <!-- Observação interna -->
  <div v-if="m.isInternalNote" class="flex justify-center my-1">
    <div class="w-full max-w-[85%] sm:max-w-[70%] bg-amber-50 border border-amber-200/80 rounded-xl px-3.5 py-2.5">
      <p class="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 mb-1">
        <StickyNote class="w-3.5 h-3.5" />
        Observação interna<template v-if="m.author"> · {{ m.author.name }}</template>
      </p>
      <p class="text-sm text-slate-800 whitespace-pre-wrap break-words">{{ m.content }}</p>
      <p class="flex items-center justify-end gap-1 text-[10px] text-amber-600/80 mt-1">
        <Clock v-if="m.status === 'PENDING'" class="w-3 h-3" aria-label="Enviando" />
        <AlertCircle v-else-if="m.status === 'FAILED'" class="w-3 h-3 text-red-500" aria-label="Falhou" />
        {{ clockTime(m.timestamp) }}
      </p>
      <div v-if="m.status === 'FAILED' && m.localId" class="flex justify-end gap-3 mt-1 text-[11px]">
        <button class="text-red-600 hover:underline inline-flex items-center gap-1" @click="emit('retry', m.localId)"><RotateCw class="w-3 h-3" />Tentar novamente</button>
        <button class="text-slate-400 hover:text-slate-600" aria-label="Descartar" @click="emit('discard', m.localId)"><X class="w-3 h-3" /></button>
      </div>
    </div>
  </div>

  <!-- Mensagem -->
  <div v-else :class="['flex', m.fromMe ? 'justify-end' : 'justify-start']">
    <div class="max-w-[85%] sm:max-w-[65%]">
      <div
        :class="[
          'relative rounded-2xl px-3 pt-2 pb-1.5 shadow-sm',
          m.fromMe ? 'bg-[#d9fdd3] rounded-tr-md' : 'bg-white rounded-tl-md',
          m.status === 'FAILED' ? 'ring-1 ring-red-300' : '',
          m.status === 'PENDING' ? 'opacity-80' : '',
        ]"
      >
        <p v-if="m.isBot" class="flex items-center gap-1 text-[11px] font-semibold text-violet-600 mb-0.5">
          <Bot class="w-3.5 h-3.5" /> IA
        </p>
        <p v-else-if="m.fromMe && m.author" class="text-[11px] font-semibold text-emerald-700 mb-0.5">{{ m.author.name }}</p>

        <img v-if="isImage" :src="m.mediaUrl!" alt="Imagem enviada" class="rounded-lg max-h-72 mb-1" loading="lazy" />
        <audio v-else-if="isAudio" :src="m.mediaUrl!" controls class="max-w-full mb-1" />
        <a v-else-if="m.mediaUrl" :href="m.mediaUrl" target="_blank" rel="noopener" class="flex items-center gap-1.5 text-sm text-primary-700 hover:underline mb-1">
          <Paperclip class="w-4 h-4" /> Abrir anexo
        </a>

        <p v-if="m.content" class="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{{ m.content }}</p>

        <p class="flex items-center justify-end gap-1 text-[10px] text-slate-500/80 mt-0.5 select-none">
          {{ clockTime(m.timestamp) }}
          <template v-if="m.fromMe">
            <Clock v-if="m.status === 'PENDING'" class="w-3 h-3" aria-label="Enviando" />
            <AlertCircle v-else-if="m.status === 'FAILED'" class="w-3.5 h-3.5 text-red-500" aria-label="Falhou" />
            <CheckCheck v-else-if="m.status === 'READ'" class="w-3.5 h-3.5 text-sky-500" aria-label="Lida" />
            <CheckCheck v-else-if="m.status === 'DELIVERED'" class="w-3.5 h-3.5" aria-label="Entregue" />
            <Check v-else class="w-3.5 h-3.5" aria-label="Enviada" />
          </template>
        </p>
      </div>

      <div v-if="m.status === 'FAILED' && m.localId" class="flex items-center justify-end gap-3 mt-1 text-[11px]">
        <span class="text-red-500 truncate">{{ m.error || 'Falha ao enviar' }}</span>
        <button class="text-red-600 font-medium hover:underline inline-flex items-center gap-1 flex-shrink-0" @click="emit('retry', m.localId)">
          <RotateCw class="w-3 h-3" />Tentar novamente
        </button>
        <button class="text-slate-400 hover:text-slate-600 flex-shrink-0" aria-label="Descartar mensagem" @click="emit('discard', m.localId)">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
