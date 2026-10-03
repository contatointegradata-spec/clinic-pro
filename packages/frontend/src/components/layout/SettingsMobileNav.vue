<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { getVisibleSettingsNav } from '../../config/settingsNav'
import { useSecretaryPermissions } from '../../composables/useSecretaryPermissions'

const authStore = useAuthStore()
const route = useRoute()
const { permissions } = useSecretaryPermissions()

const items = computed(() => getVisibleSettingsNav(authStore.user ?? undefined, permissions.value as Record<string, boolean>))

function isActive(to: string) {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <nav v-if="items.length > 0" class="lg:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 mb-4 border-b border-slate-200/80 bg-white/80 backdrop-blur-sm sticky top-0 z-20" aria-label="Navegação de configurações">
    <div class="flex gap-1.5 overflow-x-auto py-2.5 scrollbar-none">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="['flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all duration-200',
          isActive(item.to) ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/25' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800']"
      >
        <component :is="item.icon" class="w-3.5 h-3.5 flex-shrink-0" />
        <span>{{ item.shortLabel || item.label }}</span>
      </router-link>
    </div>
  </nav>
</template>
