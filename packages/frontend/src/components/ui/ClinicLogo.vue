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
      :class="[boxSizes[size], 'bg-gradient-to-br from-primary-500 via-primary-600 to-sky-600 flex items-center justify-center shadow-md shadow-primary-600/25 flex-shrink-0 transition-transform duration-200 hover:scale-105']"
    >
      <svg :class="iconSizes[size]" class="text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M9.5 2H14.5C15.3284 2 16 2.67157 16 3.5V8H20.5C21.3284 8 22 8.67157 22 9.5V14.5C22 15.3284 21.3284 16 20.5 16H16V20.5C16 21.3284 15.3284 22 14.5 22H9.5C8.67157 22 8 21.3284 8 20.5V16H3.5C2.67157 16 2 15.3284 2 14.5V9.5C2 8.67157 2.67157 8 3.5 8H8V3.5C8 2.67157 8.67157 2 9.5 2Z"
          fill="currentColor" fill-opacity="0.25" />
        <path d="M10.5 4H13.5V9.5H19V12.5H13.5V18H10.5V12.5H5V9.5H10.5V4Z" fill="currentColor" />
        <path d="M3 11H6.5L8.5 7L11.5 15L14.5 9.5L16 11H21" stroke="#38bdf8" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>

    <div v-if="!iconOnly" class="overflow-hidden whitespace-nowrap select-none">
      <div class="flex items-center gap-1.5 leading-none">
        <span :class="[titleSizes[size], dark ? 'text-slate-900' : 'text-white']" class="font-bold tracking-tight">ClinIQ</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-md font-extrabold bg-primary-50 text-primary-600 border border-primary-100 uppercase tracking-wider">
          PRO
        </span>
      </div>
      <p :class="dark ? 'text-slate-400' : 'text-slate-400'" class="text-[10.5px] font-medium tracking-wide mt-1">Gestão Clínica</p>
    </div>
  </div>
</template>
