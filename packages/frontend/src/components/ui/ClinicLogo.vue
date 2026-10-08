<script setup lang="ts">
withDefaults(defineProps<{
  iconOnly?: boolean
  size?: 'sm' | 'md' | 'lg'
  dark?: boolean
}>(), {
  iconOnly: false,
  size: 'md',
  dark: false,
})

const boxSizes = { sm: 'w-7 h-7 rounded-lg', md: 'w-9 h-9 rounded-xl', lg: 'w-11 h-11 rounded-2xl' }
const iconSizes = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' }
const titleSizes = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' }
</script>

<template>
  <div class="flex items-center gap-3">
    <div
      :class="[boxSizes[size], 'bg-gradient-to-br from-primary-400 via-primary-500 to-primary-700 flex items-center justify-center shadow-md shadow-primary-600/25 flex-shrink-0 transition-transform duration-200 hover:scale-105']"
    >
      <svg :class="iconSizes[size]" class="text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="7.3" stroke="currentColor" stroke-width="2" fill="none" />
        <path d="M5.5 12 H9 L10.6 8 L13.2 16 L14.8 12 H18.5" stroke="#EBDAB6" stroke-width="1.7" fill="none"
          stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="18.7" cy="6.3" r="2.1" fill="currentColor" />
      </svg>
    </div>

    <div v-if="!iconOnly" class="overflow-hidden whitespace-nowrap select-none">
      <div class="flex items-center gap-1.5 leading-none">
        <span :class="[titleSizes[size], dark ? 'text-slate-900' : 'text-white']" class="font-display font-semibold tracking-tight">ClinIQ</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-md font-extrabold bg-gold-50 text-gold-700 border border-gold-200 uppercase tracking-wider">
          PRO
        </span>
      </div>
      <p :class="dark ? 'text-slate-400' : 'text-slate-400'" class="text-[10.5px] font-medium tracking-wide mt-1">Odontologia &amp; Estética</p>
    </div>
  </div>
</template>
