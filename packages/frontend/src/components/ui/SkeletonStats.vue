<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 4 })
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
    <div v-for="i in count" :key="i" :class="`card animate-stagger-${Math.min(i, 4)}`">
      <div class="flex items-start gap-4">
        <div class="skeleton w-12 h-12 rounded-xl flex-shrink-0" />
        <div class="flex-1 space-y-2.5">
          <div class="skeleton-text w-3/4" />
          <div class="skeleton w-16 h-7 rounded-lg" />
          <div class="skeleton-text w-1/2" />
        </div>
      </div>
    </div>
  </div>
</template>
