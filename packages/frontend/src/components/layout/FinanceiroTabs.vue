<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutDashboard, ArrowLeftRight, FileCheck2 } from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'

// O Financeiro não tem mais menu lateral próprio: clicar em "Financeiro" no
// menu principal já abre o Painel, e as outras telas ficam nestas abas.
const authStore = useAuthStore()
const route = useRoute()

const tabs = computed(() => [
  { to: '/financeiro/painel', label: 'Painel', icon: LayoutDashboard },
  { to: '/financeiro/fluxo-caixa', label: 'Fluxo de caixa', icon: ArrowLeftRight },
  ...(authStore.user?.role === 'SECRETARY' ? [] : [{ to: '/financeiro/notas-fiscais', label: 'Notas fiscais', icon: FileCheck2 }]),
])
</script>

<template>
  <nav class="mb-5 -mt-1 flex gap-1 overflow-x-auto scrollbar-none border-b border-slate-200/80" aria-label="Seções do financeiro">
    <router-link
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      :class="['relative flex items-center gap-2 px-2.5 sm:px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150',
        route.path === tab.to ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800']"
      :aria-current="route.path === tab.to ? 'page' : undefined"
    >
      <component :is="tab.icon" class="w-4 h-4 flex-shrink-0" />
      {{ tab.label }}
      <span v-if="route.path === tab.to" class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />
    </router-link>
  </nav>
</template>
