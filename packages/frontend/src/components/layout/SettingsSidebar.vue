<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Home, Settings, ChevronRight, PanelLeftClose, PanelLeft, LogOut } from 'lucide-vue-next'
import { useAuthStore } from '../../stores/auth'
import { getVisibleSettingsNav } from '../../config/settingsNav'
import { useSecretaryPermissions } from '../../composables/useSecretaryPermissions'
import NotificationBell from '../NotificationBell.vue'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const { permissions } = useSecretaryPermissions()

const visible = computed(() => getVisibleSettingsNav(authStore.user ?? undefined, permissions.value as Record<string, boolean>))
const initials = computed(() => authStore.user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || 'U')

function isActive(to: string) {
  return route.path === to
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <aside
    class="bg-white border-r border-slate-200 flex flex-col h-screen flex-shrink-0 select-none overflow-hidden"
    :style="{ width: `${props.collapsed ? 68 : 256}px`, transition: 'width 0.32s cubic-bezier(.22,1,.36,1)' }"
  >
    <div class="px-2.5 py-3.5 border-b border-slate-100 flex-shrink-0">
      <div v-if="!props.collapsed" class="flex items-center justify-between min-w-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 bg-primary-50 rounded-xl flex items-center justify-center border border-primary-100 flex-shrink-0">
            <Settings class="w-4 h-4 text-primary-600" />
          </div>
          <div class="min-w-0">
            <h1 class="text-slate-900 font-semibold text-sm leading-tight truncate">Configurações</h1>
            <p class="text-slate-400 text-[11px]">Preferências</p>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button class="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-primary-50 transition-all duration-150" title="Voltar ao Painel" @click="router.push('/dashboard')">
            <Home class="w-4 h-4" />
          </button>
          <button class="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150" title="Recolher sidebar" @click="emit('toggleCollapse')">
            <PanelLeftClose class="w-4 h-4" />
          </button>
        </div>
      </div>
      <div v-else class="flex items-center justify-between min-w-0">
        <div class="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center border border-primary-100 cursor-pointer hover:bg-primary-100 transition-colors" title="Voltar ao Painel" @click="router.push('/dashboard')">
          <Settings class="w-4 h-4 text-primary-600" />
        </div>
        <button class="w-7 h-7 flex items-center justify-center text-primary-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-all duration-150" title="Expandir sidebar" @click="emit('toggleCollapse')">
          <PanelLeft class="w-4.5 h-4.5" />
        </button>
      </div>
    </div>

    <nav class="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-0.5 scrollbar-none">
      <p v-if="!props.collapsed" class="section-label mb-3">Opções</p>
      <router-link
        v-for="item in visible"
        :key="item.to"
        :to="item.to"
        :class="['sidebar-link group tooltip-trigger', isActive(item.to) ? 'active' : '']"
      >
        <component :is="item.icon" :class="['w-4.5 h-4.5 flex-shrink-0 transition-all duration-200', isActive(item.to) ? 'text-primary-600 scale-105' : 'text-slate-400 group-hover:text-primary-600 group-hover:scale-105']" />
        <span class="flex-1 text-sm overflow-hidden transition-all duration-300 whitespace-nowrap" :style="{ opacity: props.collapsed ? 0 : 1, maxWidth: props.collapsed ? '0' : '200px' }">
          {{ item.label }}
        </span>
        <ChevronRight v-if="isActive(item.to) && !props.collapsed" class="w-3.5 h-3.5 text-primary-500/70 flex-shrink-0" />
        <span v-if="props.collapsed" class="tooltip">{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="border-t border-slate-100 p-3 flex-shrink-0">
      <div :class="['flex items-center gap-3 px-2 py-2 rounded-xl', props.collapsed ? 'justify-center' : '']">
        <div class="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 shadow-sm shadow-primary-600/20">
          <img v-if="authStore.user?.avatarUrl" :src="authStore.user.avatarUrl" :alt="authStore.user.name" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <span class="text-white text-xs font-semibold">{{ initials }}</span>
          </div>
        </div>
        <div v-if="!props.collapsed" class="min-w-0">
          <p class="text-slate-900 text-xs font-semibold truncate leading-snug">{{ authStore.user?.name }}</p>
          <p class="text-slate-400 text-xs truncate">{{ authStore.user?.email }}</p>
        </div>
      </div>

      <NotificationBell :collapsed="props.collapsed" />

      <button
        v-if="!props.collapsed"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200 text-sm group"
        @click="handleLogout"
      >
        <LogOut class="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
        <span>Sair do sistema</span>
      </button>
      <button v-else class="w-full flex items-center justify-center p-2 mt-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200" title="Sair" @click="handleLogout">
        <LogOut class="w-4 h-4" />
      </button>
    </div>
  </aside>
</template>
