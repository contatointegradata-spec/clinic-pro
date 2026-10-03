<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; showAvatar?: boolean }>(), { rows: 3, showAvatar: false })
</script>

<template>
  <div class="card animate-fade-in">
    <div class="flex items-start gap-3">
      <div v-if="showAvatar" class="skeleton-circle w-10 h-10 flex-shrink-0" />
      <div class="flex-1 space-y-3 min-w-0">
        <div class="skeleton-text w-2/3" />
        <div v-for="i in Math.max(rows - 1, 0)" :key="i" class="skeleton-text" :style="{ width: `${85 - (i - 1) * 15}%` }" />
      </div>
    </div>
  </div>
</template>
