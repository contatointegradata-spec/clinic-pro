<script setup lang="ts">
import { Construction } from 'lucide-vue-next'

withDefaults(defineProps<{ title: string; description?: string }>(), {
  description: 'Esta tela está sendo migrada para o novo visual da ClinIQ Pro e volta em breve com a funcionalidade completa.',
})
</script>

<template>
  <div class="page-wrapper">
    <div class="card empty-state max-w-xl mx-auto mt-6">
      <div class="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mb-4">
        <Construction class="w-8 h-8 text-primary-500" />
      </div>
      <h2 class="text-lg font-semibold text-slate-900">{{ title }}</h2>
      <p class="text-slate-500 text-sm mt-2 leading-relaxed">{{ description }}</p>
    </div>
  </div>
</template>
