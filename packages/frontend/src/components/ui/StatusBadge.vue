<script setup lang="ts">
import type { AppointmentStatus } from '../../types'

const props = defineProps<{ status: AppointmentStatus }>()

const config: Record<AppointmentStatus, { label: string; dot: string; className: string }> = {
  SCHEDULED: { label: 'Agendado', dot: 'bg-primary-500', className: 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' },
  CONFIRMED: { label: 'Confirmado', dot: 'bg-emerald-500', className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  COMPLETED: { label: 'Concluído', dot: 'bg-slate-400', className: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' },
  CANCELLED: { label: 'Cancelado', dot: 'bg-red-500', className: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  NO_SHOW: { label: 'Faltou', dot: 'bg-orange-500', className: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
}

const c = config[props.status] || config.SCHEDULED
</script>

<template>
  <span :class="['status-badge', c.className, 'gap-1.5']">
    <span :class="['w-1.5 h-1.5 rounded-full flex-shrink-0', c.dot]" />
    {{ c.label }}
  </span>
</template>
