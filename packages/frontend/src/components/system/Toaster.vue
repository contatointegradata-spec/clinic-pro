<script setup lang="ts">
import { CheckCircle2, XCircle, Info } from 'lucide-vue-next'
import { toasts } from '../../lib/toast'

const icon = { success: CheckCircle2, error: XCircle, default: Info } as const
const iconColor = { success: 'text-emerald-400', error: 'text-red-400', default: 'text-primary-400' } as const
</script>

<template>
  <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-center gap-2.5 bg-slate-800 text-slate-50 rounded-xl shadow-xl px-4 py-3 text-sm font-medium max-w-sm"
      >
        <component :is="icon[t.type]" :class="['w-4 h-4 flex-shrink-0', iconColor[t.type]]" />
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
