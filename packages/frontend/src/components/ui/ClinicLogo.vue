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

const boxSizes = { sm: 'w-8 h-8 rounded-[10px]', md: 'w-10 h-10 rounded-xl', lg: 'w-12 h-12 rounded-2xl' }
const iconSizes = { sm: 'w-[18px] h-[18px]', md: 'w-[22px] h-[22px]', lg: 'w-7 h-7' }
const titleSizes = { sm: 'text-[15px]', md: 'text-[19px]', lg: 'text-2xl' }
</script>

<template>
  <div class="flex items-center gap-2.5">
    <!-- Marca: dente estilizado (odontologia) com brilho dourado (estética) -->
    <div
      :class="[boxSizes[size], 'relative flex items-center justify-center flex-shrink-0 overflow-hidden shadow-md shadow-primary-700/25']"
      style="background: linear-gradient(145deg, #CB8D97 0%, #A05B66 55%, #6C3D44 100%)"
    >
      <span class="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" aria-hidden="true" />
      <svg :class="iconSizes[size]" class="relative" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M8 4.2c-2.3 0-3.9 1.8-3.9 4.4 0 2.3.9 3.8 1.5 5.7.5 1.6.7 3.1 1.1 4.6.3 1.2.9 2 1.7 2 1 0 1.3-1.1 1.6-2.6.3-1.6.6-3 2-3s1.7 1.4 2 3c.3 1.5.6 2.6 1.6 2.6.8 0 1.4-.8 1.7-2 .4-1.5.6-3 1.1-4.6.6-1.9 1.5-3.4 1.5-5.7 0-2.6-1.6-4.4-3.9-4.4-1.6 0-2.4.9-4 .9s-2.4-.9-4-.9Z"
          fill="#FFFFFF"
        />
        <path d="M9 9.6c.9.9 1.9 1.3 3 1.3s2.1-.4 3-1.3" stroke="#A05B66" stroke-width="1.3" stroke-linecap="round" />
        <path d="M19.3 1.8l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z" fill="#EBDAB6" />
      </svg>
    </div>

    <div v-if="!iconOnly" class="overflow-hidden whitespace-nowrap select-none">
      <div class="flex items-baseline gap-1.5 leading-none">
        <span :class="[titleSizes[size], dark ? 'text-slate-900' : 'text-white']" class="font-display font-semibold tracking-tight">
          Clin<span :class="dark ? 'text-primary-600' : 'text-primary-200'">IQ</span>
        </span>
        <span class="text-[9px] font-bold uppercase tracking-[0.18em] text-gold-600">Pro</span>
      </div>
      <p :class="dark ? 'text-slate-400' : 'text-white/70'" class="text-[10.5px] font-medium tracking-wide mt-1">Odontologia &amp; Estética</p>
    </div>
  </div>
</template>
