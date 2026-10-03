<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  isOpen: boolean
  title: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
}>(), {
  size: 'md',
  closeOnBackdrop: true,
})

const emit = defineEmits<{ close: [] }>()

const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

const phase = ref<'hidden' | 'entering' | 'visible' | 'leaving'>('hidden')
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    phase.value = 'entering'
    requestAnimationFrame(() => requestAnimationFrame(() => { phase.value = 'visible' }))
    document.body.style.overflow = 'hidden'
  } else {
    phase.value = 'leaving'
    timer = setTimeout(() => {
      phase.value = 'hidden'
      document.body.style.overflow = ''
    }, 260)
  }
}, { immediate: true })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) emit('close')
}

window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (timer) clearTimeout(timer)
})

function close() {
  if (props.closeOnBackdrop) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="phase !== 'hidden'"
      class="fixed inset-0 z-50 overflow-y-auto"
      :style="{ transition: 'opacity 0.24s ease', opacity: phase === 'visible' ? 1 : 0 }"
    >
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" @click="close" />

      <div class="flex min-h-full items-end sm:items-center justify-center p-4 text-center">
        <div
          class="relative w-full bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl shadow-slate-900/25 max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden text-left"
          :class="sizes[size]"
          :style="{
            transition: 'opacity 0.24s ease, transform 0.3s cubic-bezier(.22,1,.36,1)',
            opacity: phase === 'visible' ? 1 : 0,
            transform: phase === 'visible' ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(12px)',
          }"
          @click.stop
        >
          <div class="sm:hidden flex justify-center pt-3 pb-1">
            <div class="w-10 h-1 bg-slate-200 rounded-full" />
          </div>

          <div class="flex items-start justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
            <div class="min-w-0 pr-2">
              <h2 class="text-base font-semibold text-slate-900 leading-snug">{{ title }}</h2>
              <p v-if="subtitle" class="text-xs text-slate-400 mt-0.5 leading-snug">{{ subtitle }}</p>
            </div>
            <button class="btn-icon flex-shrink-0 -mt-0.5 -mr-1" aria-label="Fechar" @click="emit('close')">
              <X class="w-4 h-4" />
            </button>
          </div>

          <div class="overflow-y-auto flex-1 px-6 py-5 scrollbar-none">
            <slot />
          </div>

          <div v-if="$slots.footer" class="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
