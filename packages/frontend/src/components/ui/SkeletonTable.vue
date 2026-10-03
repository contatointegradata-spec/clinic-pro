<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; cols?: number }>(), { rows: 5, cols: 5 })
</script>

<template>
  <div class="space-y-0">
    <div v-for="i in rows" :key="i" class="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
      <div class="skeleton-circle w-8 h-8 flex-shrink-0" />
      <div v-for="j in Math.max(cols - 1, 0)" :key="j" class="skeleton-text flex-1" :style="{ maxWidth: `${120 - (j - 1) * 10}px` }" />
    </div>
  </div>
</template>
