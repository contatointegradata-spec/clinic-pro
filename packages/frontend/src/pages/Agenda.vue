<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  format, startOfWeek, addDays, addWeeks, subWeeks, subDays, isSameDay, parseISO,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, Plus, Calendar, Clock, Lock, X, MapPin,
  User as UserIcon, CalendarDays, LayoutList, AlertTriangle, Coffee, Settings,
} from 'lucide-vue-next'
import toast from '../lib/toast'
import api from '../lib/api'
import { useAuthStore } from '../stores/auth'
import type { Appointment, AppointmentBlock, User, Patient, AppointmentType, Room, AppointmentStatus } from '../types'
import StatusBadge from '../components/ui/StatusBadge.vue'
import Modal from '../components/ui/Modal.vue'
import AppointmentForm from '../components/Agenda/AppointmentForm.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import { useAgendaPreferences } from '../composables/useAgendaPreferences'
import AgendaSettingsModal from '../components/Agenda/AgendaSettingsModal.vue'
import { useQuery } from '../composables/useQuery'

interface AppointmentSubmitData {
  patientId: string
  doctorId: string
  title: string
  date: string
  duration: number
  status: AppointmentStatus
  notes?: string
  roomId?: string | null
  repeatCount?: number
}

function getApptColor(status: string) {
  const map: Record<string, string> = {
    SCHEDULED: 'bg-primary-50 text-primary-700 border-primary-500',
    CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-500',
    COMPLETED: 'bg-slate-100 text-slate-700 border-slate-500',
    CANCELLED: 'bg-red-50 text-red-700 border-red-500',
    NO_SHOW: 'bg-orange-50 text-orange-700 border-orange-500',
  }
  return map[status] || map.SCHEDULED
}

const dotColors: Record<string, string> = {
  SCHEDULED: 'bg-primary-500',
  CONFIRMED: 'bg-emerald-500',
  COMPLETED: 'bg-slate-400',
  CANCELLED: 'bg-red-500',
  NO_SHOW: 'bg-orange-500',
}

const rowStyles: Record<string, string> = {
  SCHEDULED: 'bg-primary-50/50 hover:bg-primary-100/60 text-primary-700 border-primary-100/70',
  CONFIRMED: 'bg-emerald-50/50 hover:bg-emerald-100/60 text-emerald-700 border-emerald-100/70',
  COMPLETED: 'bg-slate-100/50 hover:bg-slate-200/60 text-slate-600 border-slate-200/70',
  CANCELLED: 'bg-red-50/50 hover:bg-red-100/60 text-red-700 border-red-100/70',
  NO_SHOW: 'bg-orange-50/50 hover:bg-orange-100/60 text-orange-700 border-orange-100/70',
}

const legend = [
  { label: 'Agendado', color: 'bg-primary-500' },
  { label: 'Confirmado', color: 'bg-emerald-500' },
  { label: 'Concluído', color: 'bg-slate-400' },
  { label: 'Cancelado', color: 'bg-red-400' },
  { label: 'Bloqueado', color: 'bg-amber-500' },
]

interface TooltipState {
  appt: Appointment
  x: number
  y: number
}

interface ListRow {
  key: string
  type: 'appt' | 'block' | 'lunch' | 'free'
  slotStart: Date
  appt?: Appointment
  block?: AppointmentBlock
}

function buildTimeSlots(
  startHour: number,
  endHour: number,
  interval: number,
  lunchStart?: string | null,
  lunchEnd?: string | null
) {
  const slots: { h: number; m: number; label: string }[] = []
  const startMins = startHour * 60
  const endMins = endHour * 60

  let lunchStartMins: number | null = null
  let lunchEndMins: number | null = null
  if (lunchStart && lunchEnd) {
    const [lsH, lsM] = lunchStart.split(':').map(Number)
    const [leH, leM] = lunchEnd.split(':').map(Number)
    if (!isNaN(lsH) && !isNaN(lsM) && !isNaN(leH) && !isNaN(leM)) {
      lunchStartMins = lsH * 60 + lsM
      lunchEndMins = leH * 60 + leM
    }
  }

  const addSlot = (totalMins: number) => {
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    if (!slots.some(s => s.h === h && s.m === m)) {
      slots.push({ h, m, label })
    }
  }

  if (lunchStartMins !== null && lunchEndMins !== null && lunchStartMins >= startMins && lunchEndMins <= endMins) {
    let current = startMins
    while (current < lunchStartMins) {
      addSlot(current)
      current += interval
    }
    addSlot(lunchStartMins)

    current = lunchEndMins
    while (current < endMins) {
      addSlot(current)
      current += interval
    }
  } else {
    let current = startMins
    while (current < endMins) {
      addSlot(current)
      current += interval
    }
  }

  slots.sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m))
  return slots
}

const authStore = useAuthStore()
const { preferences } = useAgendaPreferences()

const currentWeek = ref(new Date())
const modalOpen = ref(false)
const blockModalOpen = ref(false)
const settingsModalOpen = ref(false)
const selectedAppt = ref<Appointment | null>(null)
const selectedSlot = ref<{ date: Date } | null>(null)
const calendarMode = ref<'week' | 'day'>('week')
const filterDoctorId = ref('')
const viewMode = ref<'calendar' | 'list'>('calendar')
const overlapWarning = ref<{ message: string; variables: Record<string, unknown> } | null>(null)
const tooltip = ref<TooltipState | null>(null)
const tooltipRef = ref<HTMLDivElement | null>(null)
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
const mouseCoords = { x: 0, y: 0 }

const savingAppt = ref(false)
const blockSaving = ref(false)

const SLOT_HEIGHT = computed(() => (preferences.compactMode ? 24 : 40))
const INTERVAL = computed(() => preferences.interval)

const weekStart = computed(() => startOfWeek(currentWeek.value, { weekStartsOn: preferences.weekStartsOn }))
const weekDays = computed(() => {
  if (calendarMode.value === 'week') {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)).filter(day => {
      if (preferences.hideWeekends) {
        const dayOfWeek = day.getDay()
        return dayOfWeek !== 0 && dayOfWeek !== 6
      }
      return true
    })
  }
  return [currentWeek.value]
})

const appointmentsKey = computed(() => `appointments-${format(weekStart.value, 'yyyy-MM-dd')}-${filterDoctorId.value}`)
const { data: appointmentsData, refetch: refetchAppointments } = useQuery<Appointment[]>({
  key: appointmentsKey,
  queryFn: () =>
    api.get('/appointments', {
      params: {
        startDate: weekStart.value.toISOString(),
        endDate: addDays(weekStart.value, 7).toISOString(),
        ...(filterDoctorId.value && { doctorId: filterDoctorId.value }),
      },
    }).then(r => r.data),
})
const appointments = computed(() => appointmentsData.value ?? [])

const blocksKey = computed(() => `appointment-blocks-${format(weekStart.value, 'yyyy-MM-dd')}-${filterDoctorId.value}`)
const { data: blocksData, refetch: refetchBlocks } = useQuery<AppointmentBlock[]>({
  key: blocksKey,
  queryFn: () =>
    api.get('/appointment-blocks', {
      params: {
        startDate: weekStart.value.toISOString(),
        endDate: addDays(weekStart.value, 7).toISOString(),
        ...(filterDoctorId.value && { doctorId: filterDoctorId.value }),
      },
    }).then(r => r.data),
})
const blocks = computed(() => blocksData.value ?? [])

const { data: doctorsData } = useQuery<User[]>({
  key: 'doctors',
  queryFn: () => api.get('/doctors').then(r => r.data),
})
const doctors = computed(() => doctorsData.value ?? [])

const { data: patientsData, refetch: refetchPatients } = useQuery<Patient[]>({
  key: 'patients',
  queryFn: () => api.get('/patients').then(r => r.data),
})
const patients = computed(() => patientsData.value ?? [])

const { data: appointmentTypesData } = useQuery<AppointmentType[]>({
  key: 'appointment-types',
  queryFn: () => api.get('/appointment-types').then(r => r.data),
})
const appointmentTypes = computed(() => appointmentTypesData.value ?? [])

const { data: myRoomsData } = useQuery<Room[]>({
  key: 'rooms',
  queryFn: () => api.get('/rooms').then(r => r.data),
})
const myRooms = computed(() => myRoomsData.value ?? [])

const { data: wsStatus, refetch: refetchWsStatus } = useQuery<{ status?: string } | null>({
  key: 'whatsapp-status',
  queryFn: () => api.get('/chatbot-light/instance/status').then(r => r.data).catch(() => null),
})

let wsStatusInterval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  wsStatusInterval = setInterval(() => refetchWsStatus(), 30000)
})
onBeforeUnmount(() => {
  if (wsStatusInterval) clearInterval(wsStatusInterval)
  if (tooltipTimer) clearTimeout(tooltipTimer)
})

// Combine chatbot-light status with room WhatsApp connections
const roomWaConnected = computed(() => myRooms.value.some(r => r.whatsappConnection?.status === 'CONNECTED'))
const chatbotWaActive = computed(() => !!(wsStatus.value?.status && wsStatus.value.status !== 'NONE'))
const isWaConnected = computed(() => roomWaConnected.value || wsStatus.value?.status === 'CONNECTED')
const hasAnyWaConfig = computed(() => roomWaConnected.value || chatbotWaActive.value)

// Resolve current active doctor's lunch hours
const activeDoctor = computed(() => {
  const user = authStore.user
  if (user?.role === 'DOCTOR') return user
  if (filterDoctorId.value) return doctors.value.find(d => d.id === filterDoctorId.value)
  if (user?.role === 'SECRETARY' && doctors.value.length === 1) return doctors.value[0]
  return undefined
})

const activeLunchStart = computed(() => activeDoctor.value?.lunchStart)
const activeLunchEnd = computed(() => activeDoctor.value?.lunchEnd)

const activeRoomsForSchedule = computed(() => (
  filterDoctorId.value ? myRooms.value.filter(r => r.doctorId === filterDoctorId.value) : myRooms.value
))

const roomSchedule = computed(() => {
  const user = authStore.user
  if (!((user?.role === 'SECRETARY' || user?.role === 'DOCTOR') && activeRoomsForSchedule.value.length > 0)) {
    return null
  }
  const startHours = activeRoomsForSchedule.value.map(r => {
    const parts = (r.startTime || '').split(':')
    const h = parseInt(parts[0])
    return isNaN(h) ? preferences.startHour : h
  })
  const endHours = activeRoomsForSchedule.value.map(r => {
    const parts = (r.endTime || '').split(':')
    const h = parseInt(parts[0])
    return isNaN(h) ? preferences.endHour : h
  })
  const days = activeRoomsForSchedule.value.flatMap(r => Array.isArray(r.daysOfWeek) ? r.daysOfWeek : [])
  const effectiveDays = days.length > 0 ? Array.from(new Set(days)) : [1, 2, 3, 4, 5, 6, 7]

  return {
    startHour: startHours.length > 0 ? Math.min(...startHours) : preferences.startHour,
    endHour: endHours.length > 0 ? Math.max(...endHours) : preferences.endHour,
    days: effectiveDays,
  }
})

const scheduleHours = computed(() => {
  let start = roomSchedule.value ? roomSchedule.value.startHour : preferences.startHour
  let end = roomSchedule.value ? roomSchedule.value.endHour : preferences.endHour

  if (activeLunchStart.value) {
    const h = parseInt(activeLunchStart.value.split(':')[0])
    if (!isNaN(h) && h < start) start = h
  }
  if (activeLunchEnd.value) {
    const h = Math.ceil(parseInt(activeLunchEnd.value.split(':')[0]))
    if (!isNaN(h) && h > end) end = h
  }

  appointments.value.forEach(appt => {
    if (appt.status === 'CANCELLED') return
    const apptDate = parseISO(appt.date)
    const startH = apptDate.getHours()
    const endH = Math.ceil(startH + appt.duration / 60)
    if (startH < start) start = startH
    if (endH > end) end = endH
  })

  blocks.value.forEach(block => {
    const blockStart = parseISO(block.date)
    const blockEnd = parseISO(block.endDate)
    const startH = blockStart.getHours()
    const endH = Math.ceil(blockEnd.getHours() + blockEnd.getMinutes() / 60)
    if (startH < start) start = startH
    if (endH > end) end = endH
  })

  return { start, end }
})

const effectiveStartHour = computed(() => scheduleHours.value.start)
const effectiveEndHour = computed(() => scheduleHours.value.end)

const activeSlots = computed(() => buildTimeSlots(
  effectiveStartHour.value, effectiveEndHour.value, INTERVAL.value, activeLunchStart.value, activeLunchEnd.value
))

function getTimePosition(date: Date) {
  const timeMins = date.getHours() * 60 + date.getMinutes()
  const slots = activeSlots.value
  const slotHeight = SLOT_HEIGHT.value
  const interval = INTERVAL.value

  const slotsWithTimes = slots.map((slot, idx) => {
    const startMins = slot.h * 60 + slot.m
    let duration = interval
    if (idx < slots.length - 1) {
      const nextSlot = slots[idx + 1]
      duration = (nextSlot.h * 60 + nextSlot.m) - startMins
    }
    return { startMins, duration, endMins: startMins + duration }
  })

  if (slotsWithTimes.length === 0) return 0
  if (timeMins < slotsWithTimes[0].startMins) return 0

  for (let i = 0; i < slotsWithTimes.length; i++) {
    const s = slotsWithTimes[i]
    if (timeMins >= s.startMins && timeMins < s.endMins) {
      const fraction = (timeMins - s.startMins) / s.duration
      return (i + fraction) * slotHeight
    }
  }

  const lastSlot = slotsWithTimes[slotsWithTimes.length - 1]
  if (timeMins >= lastSlot.endMins) return slotsWithTimes.length * slotHeight

  return 0
}

function getApptPosition(date: Date) {
  return getTimePosition(date)
}

function getApptHeight(date: Date, duration: number) {
  const end = new Date(date.getTime() + duration * 60000)
  return Math.max(getTimePosition(end) - getTimePosition(date), SLOT_HEIGHT.value)
}

function getBlockPosition(date: Date) {
  return getTimePosition(date)
}

function getBlockHeight(start: Date, end: Date) {
  return Math.max(getTimePosition(end) - getTimePosition(start), SLOT_HEIGHT.value)
}

const totalGridHeight = computed(() => activeSlots.value.length * SLOT_HEIGHT.value)

function isAllowedDay(day: Date) {
  if (!roomSchedule.value) return true
  const isoDay = day.getDay() === 0 ? 7 : day.getDay()
  return roomSchedule.value.days.includes(isoDay)
}

function getApptsByDay(day: Date) {
  return appointments.value.filter(a => isSameDay(parseISO(a.date), day))
}
function getBlocksByDay(day: Date) {
  return blocks.value.filter(b => isSameDay(parseISO(b.date), day))
}

// ── Mutations (manual, matching original payloads) ──
async function saveAppointment(payload: Record<string, unknown>) {
  savingAppt.value = true
  try {
    if (selectedAppt.value) {
      await api.put(`/appointments/${selectedAppt.value.id}`, payload)
    } else {
      await api.post('/appointments', payload)
    }
  } catch (err: any) {
    savingAppt.value = false
    if (err.response?.data?.code === 'OVERLAP_WARNING') {
      overlapWarning.value = { message: err.response.data.message, variables: payload }
    } else {
      toast.error(err.response?.data?.message || 'Erro ao salvar consulta')
    }
    return
  }
  savingAppt.value = false
  await refetchAppointments()
  toast.success(selectedAppt.value ? 'Consulta atualizada!' : 'Consulta agendada!')
  modalOpen.value = false
  selectedAppt.value = null
}

async function deleteAppointment(id: string) {
  try {
    await api.delete(`/appointments/${id}`)
    await refetchAppointments()
    toast.success('Consulta removida')
    modalOpen.value = false
    selectedAppt.value = null
  } catch {
    // sem handler de erro específico na versão original
  }
}

async function createBlock(data: Record<string, unknown>) {
  blockSaving.value = true
  try {
    await api.post('/appointment-blocks', data)
    await refetchBlocks()
    toast.success('Horário bloqueado!')
    blockModalOpen.value = false
  } catch {
    toast.error('Erro ao bloquear horário')
  } finally {
    blockSaving.value = false
  }
}

async function deleteBlockFn(id: string) {
  try {
    await api.delete(`/appointment-blocks/${id}`)
    await refetchBlocks()
    toast.success('Bloqueio removido')
  } catch {
    // sem handler de erro específico na versão original
  }
}

function canDeleteBlock(block: AppointmentBlock) {
  return authStore.user?.role === 'ADMIN' || authStore.user?.id === block.doctorId
}

// ── Slot / appointment interactions ──
function handleSlotClick(day: Date, slot: { h: number; m: number }) {
  if (activeLunchStart.value && activeLunchEnd.value) {
    const [lStartH, lStartM] = activeLunchStart.value.split(':').map(Number)
    const [lEndH, lEndM] = activeLunchEnd.value.split(':').map(Number)
    const slotMinutes = slot.h * 60 + slot.m
    const startMinutes = lStartH * 60 + lStartM
    const endMinutes = lEndH * 60 + lEndM
    if (slotMinutes >= startMinutes && slotMinutes < endMinutes) {
      toast.error('Este horário está reservado para o almoço do profissional.')
      return
    }
  }

  const d = new Date(day)
  d.setHours(slot.h, slot.m, 0, 0)
  selectedAppt.value = null
  selectedSlot.value = { date: d }
  modalOpen.value = true
}

function handleApptClick(e: MouseEvent, appt: Appointment) {
  e.stopPropagation()
  tooltip.value = null
  selectedAppt.value = appt
  selectedSlot.value = null
  modalOpen.value = true
}

function handleApptMouseEnter(e: MouseEvent, appt: Appointment) {
  if (tooltipTimer) clearTimeout(tooltipTimer)
  mouseCoords.x = e.clientX
  mouseCoords.y = e.clientY
  tooltipTimer = setTimeout(() => {
    tooltip.value = { appt, x: mouseCoords.x, y: mouseCoords.y }
  }, 300)
}

function handleApptMouseMove(e: MouseEvent) {
  mouseCoords.x = e.clientX
  mouseCoords.y = e.clientY
  if (tooltipRef.value) {
    const left = Math.min(e.clientX + 14, window.innerWidth - 260)
    const top = Math.min(e.clientY + 10, window.innerHeight - 260)
    tooltipRef.value.style.left = `${left}px`
    tooltipRef.value.style.top = `${top}px`
  }
}

function handleApptMouseLeave() {
  if (tooltipTimer) clearTimeout(tooltipTimer)
  tooltipTimer = setTimeout(() => { tooltip.value = null }, 150)
}

function cancelTooltipHide() {
  if (tooltipTimer) clearTimeout(tooltipTimer)
}

const tooltipStyle = computed(() => {
  if (!tooltip.value) return {}
  return {
    left: `${Math.min(tooltip.value.x + 14, window.innerWidth - 260)}px`,
    top: `${Math.min(tooltip.value.y + 10, window.innerHeight - 260)}px`,
  }
})

function getLunchStyle(day: Date) {
  if (!activeLunchStart.value || !activeLunchEnd.value) return {}
  const [lStartH, lStartM] = activeLunchStart.value.split(':').map(Number)
  const [lEndH, lEndM] = activeLunchEnd.value.split(':').map(Number)
  const lunchStartD = new Date(day)
  lunchStartD.setHours(lStartH, lStartM, 0, 0)
  const lunchEndD = new Date(day)
  lunchEndD.setHours(lEndH, lEndM, 0, 0)
  const top = getBlockPosition(lunchStartD)
  const height = getBlockHeight(lunchStartD, lunchEndD)
  return { top: `${top + 1}px`, height: `${height - 2}px`, left: '2px', right: '2px' }
}

// ── Appointment form wiring ──
function handleFormSubmit(data: AppointmentSubmitData) {
  const apptDate = new Date(data.date)
  const duration = Number(data.duration) || 30

  if (activeLunchStart.value && activeLunchEnd.value) {
    const [lStartH, lStartM] = activeLunchStart.value.split(':').map(Number)
    const [lEndH, lEndM] = activeLunchEnd.value.split(':').map(Number)

    const apptStartMins = apptDate.getHours() * 60 + apptDate.getMinutes()
    const apptEndMins = apptStartMins + duration
    const lunchStartMins = lStartH * 60 + lStartM
    const lunchEndMins = lEndH * 60 + lEndM

    if (apptStartMins < lunchEndMins && apptEndMins > lunchStartMins) {
      toast.error('Este horário está reservado para o almoço do profissional.')
      return
    }
  }

  const payload = {
    ...data,
    date: apptDate.toISOString(),
  }
  saveAppointment(payload as Record<string, unknown>)
}

function handleFormDelete() {
  if (selectedAppt.value) deleteAppointment(selectedAppt.value.id)
}

function handlePatientCreated() {
  refetchPatients()
}

function handleCharged() {
  refetchAppointments()
  toast.success('Consulta cobrada com sucesso!')
}

function openNewAppointment() {
  selectedAppt.value = null
  selectedSlot.value = null
  modalOpen.value = true
}

function closeAppointmentModal() {
  modalOpen.value = false
  selectedAppt.value = null
}

function forceSaveOverlap() {
  if (overlapWarning.value) {
    saveAppointment({ ...overlapWarning.value.variables, forceOverlap: true })
    overlapWarning.value = null
  }
}

// ── Block form (ported from BlockForm sub-component) ──
const blockDate = ref(format(new Date(), 'yyyy-MM-dd'))
const blockStartTime = ref('08:00')
const blockEndTime = ref('09:00')
const blockReason = ref('')
const blockDoctorId = ref(authStore.user?.id || '')

watch(blockModalOpen, (open) => {
  if (open) {
    blockDate.value = format(new Date(), 'yyyy-MM-dd')
    blockStartTime.value = '08:00'
    blockEndTime.value = '09:00'
    blockReason.value = ''
    blockDoctorId.value = authStore.user?.id || ''
  }
})

function handleBlockSubmit(e: Event) {
  e.preventDefault()
  const dateStr = `${blockDate.value}T${blockStartTime.value}:00`
  const endDateStr = `${blockDate.value}T${blockEndTime.value}:00`
  createBlock({
    date: new Date(dateStr).toISOString(),
    endDate: new Date(endDateStr).toISOString(),
    reason: blockReason.value,
    doctorId: authStore.user?.role === 'ADMIN' ? blockDoctorId.value : undefined,
  })
}

// ── List view rows (flattened equivalent of the original nested day/slot loop) ──
const listRows = computed<{ day: Date; rows: ListRow[] }[]>(() => {
  const result: { day: Date; rows: ListRow[] }[] = []

  for (const day of weekDays.value) {
    if (!isAllowedDay(day)) continue

    const dayAppts = getApptsByDay(day)
    const dayBlocks = getBlocksByDay(day)
    const rows: ListRow[] = []
    let skipUntil: Date | null = null

    for (const slot of activeSlots.value) {
      const slotStart = new Date(day)
      slotStart.setHours(slot.h, slot.m, 0, 0)

      if (skipUntil && slotStart < skipUntil) continue

      const activeAppt = dayAppts.find(a => {
        const aStart = parseISO(a.date)
        const aEnd = new Date(aStart.getTime() + a.duration * 60000)
        return slotStart >= aStart && slotStart < aEnd
      })

      if (activeAppt) {
        const aStart = parseISO(activeAppt.date)
        skipUntil = new Date(aStart.getTime() + activeAppt.duration * 60000)
        rows.push({ key: `appt-${activeAppt.id}`, type: 'appt', slotStart, appt: activeAppt })
        continue
      }

      const activeBlock = dayBlocks.find(b => {
        const bStart = parseISO(b.date)
        const bEnd = parseISO(b.endDate)
        return slotStart >= bStart && slotStart < bEnd
      })

      if (activeBlock) {
        skipUntil = parseISO(activeBlock.endDate)
        rows.push({ key: `block-${activeBlock.id}-${slot.h}-${slot.m}`, type: 'block', slotStart, block: activeBlock })
        continue
      }

      let isLunch = false
      if (activeLunchStart.value && activeLunchEnd.value) {
        const [lStartH, lStartM] = activeLunchStart.value.split(':').map(Number)
        const [lEndH, lEndM] = activeLunchEnd.value.split(':').map(Number)
        const slotMinutes = slot.h * 60 + slot.m
        const startMinutes = lStartH * 60 + lStartM
        const endMinutes = lEndH * 60 + lEndM
        isLunch = slotMinutes >= startMinutes && slotMinutes < endMinutes
      }

      if (isLunch) {
        rows.push({ key: `lunch-${day.toISOString()}-${slot.h}-${slot.m}`, type: 'lunch', slotStart })
        continue
      }

      rows.push({ key: `free-${day.toISOString()}-${slot.h}-${slot.m}`, type: 'free', slotStart })
    }

    result.push({ day, rows })
  }

  return result
})
</script>

<template>
  <div class="space-y-4 page-stagger">
    <PageHeader title="Agenda" subtitle="Gerencie consultas e agendamentos">
      <template #actions>
        <div class="flex items-center gap-2 flex-wrap">
          <div
            v-if="hasAnyWaConfig"
            class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border mr-1"
            :class="isWaConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'"
          >
            <span class="w-2 h-2 rounded-full" :class="isWaConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'" />
            <span>WhatsApp {{ isWaConnected ? 'Conectado' : 'Desconectado' }}</span>
          </div>
          <button
            v-if="authStore.user?.role === 'DOCTOR' || authStore.user?.role === 'ADMIN' || authStore.user?.role === 'SECRETARY'"
            class="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 rounded-xl font-medium text-sm transition-all duration-150 shadow-sm"
            @click="settingsModalOpen = true"
          >
            <Settings class="w-4 h-4" />
            <span class="hidden sm:inline">Personalizar</span>
          </button>
          <button
            v-if="authStore.user?.role === 'DOCTOR' || authStore.user?.role === 'ADMIN'"
            class="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-95 text-white rounded-xl font-medium text-sm transition-all duration-150 shadow-sm shadow-amber-600/20"
            @click="blockModalOpen = true"
          >
            <Lock class="w-4 h-4" />
            <span class="hidden sm:inline">Bloquear</span>
          </button>
          <div class="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
              :class="calendarMode === 'day' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
              @click="calendarMode = 'day'"
            >
              Dia
            </button>
            <button
              class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
              :class="calendarMode === 'week' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
              @click="calendarMode = 'week'"
            >
              Semana
            </button>
          </div>
          <button
            class="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 rounded-xl font-medium text-sm transition-all duration-150 shadow-sm border border-slate-200 hover:border-slate-300"
            @click="viewMode = viewMode === 'calendar' ? 'list' : 'calendar'"
          >
            <template v-if="viewMode === 'calendar'">
              <LayoutList class="w-4 h-4" /><span class="hidden sm:inline">Lista</span>
            </template>
            <template v-else>
              <Calendar class="w-4 h-4" /><span class="hidden sm:inline">Calendário</span>
            </template>
          </button>
          <button class="btn-primary" @click="openNewAppointment">
            <Plus class="w-4 h-4" />
            <span class="hidden sm:inline">Novo Agendamento</span>
            <span class="sm:hidden">Agendar</span>
          </button>
        </div>
      </template>
    </PageHeader>

    <!-- ── Controls bar ── -->
    <div class="card py-3">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3">
        <!-- Week navigation -->
        <div class="flex items-center gap-2">
          <button
            class="w-8 h-8 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 hover:border-slate-300 active:scale-90 transition-all duration-150"
            aria-label="Anterior"
            @click="currentWeek = calendarMode === 'week' ? subWeeks(currentWeek, 1) : subDays(currentWeek, 1)"
          >
            <ChevronLeft class="w-4 h-4 text-slate-500" />
          </button>
          <p class="font-semibold text-slate-900 text-sm min-w-[190px] text-center">
            <template v-if="calendarMode === 'week'">
              {{ format(weekStart, "d 'de' MMM", { locale: ptBR }) }}
              –
              {{ format(addDays(weekStart, 6), "d 'de' MMM yyyy", { locale: ptBR }) }}
            </template>
            <template v-else>
              {{ format(currentWeek, "d 'de' MMMM 'de' yyyy", { locale: ptBR }) }}
            </template>
          </p>
          <button
            class="w-8 h-8 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-50 hover:border-slate-300 active:scale-90 transition-all duration-150"
            aria-label="Próximo"
            @click="currentWeek = calendarMode === 'week' ? addWeeks(currentWeek, 1) : addDays(currentWeek, 1)"
          >
            <ChevronRight class="w-4 h-4 text-slate-500" />
          </button>
          <button
            class="px-3 py-1.5 text-xs font-semibold text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-200 hover:border-primary-300 transition-all duration-150 active:scale-95"
            @click="currentWeek = new Date()"
          >
            Hoje
          </button>
        </div>

        <select
          v-if="authStore.user?.role === 'ADMIN' || authStore.user?.role === 'SECRETARY'"
          v-model="filterDoctorId"
          class="input-field py-2 sm:max-w-[200px] text-sm"
        >
          <option value="">Todos os profissionais</option>
          <option v-for="d in doctors" :key="d.id" :value="d.id">Dr(a). {{ d.name }}</option>
        </select>

        <!-- Legend -->
        <div class="flex items-center gap-3 sm:ml-auto flex-wrap">
          <div v-for="item in legend" :key="item.label" class="flex items-center gap-1.5 text-xs text-slate-500">
            <div class="w-2 h-2 rounded-full" :class="item.color" />
            {{ item.label }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── List view ── -->
    <div v-if="viewMode === 'list'" class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50/80 border-b border-slate-200">
              <th
                v-for="col in ['Data', 'Hora', 'Nome Paciente', 'Local de Atendimento', 'Valor Total', 'Agendado por', 'Profissional', 'Tipo', 'Status']"
                :key="col"
                class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap"
              >
                {{ col }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in listRows" :key="group.day.toISOString()">
              <template v-for="row in group.rows" :key="row.key">
                <tr
                  v-if="row.type === 'appt' && row.appt"
                  class="border-b transition-colors cursor-pointer"
                  :class="rowStyles[row.appt.status] || rowStyles.SCHEDULED"
                  @click="handleApptClick($event, row.appt)"
                >
                  <td class="px-4 py-3 font-medium whitespace-nowrap">{{ format(parseISO(row.appt.date), 'dd/MM/yyyy', { locale: ptBR }) }}</td>
                  <td class="px-4 py-3 font-semibold tabular-nums whitespace-nowrap">{{ format(parseISO(row.appt.date), 'HH:mm') }}</td>
                  <td class="px-4 py-3 font-semibold whitespace-nowrap">{{ row.appt.patient.name }}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-inherit opacity-90">{{ row.appt.room?.name || '—' }}</td>
                  <td class="px-4 py-3 font-medium tabular-nums whitespace-nowrap">
                    {{ row.appt.value != null ? row.appt.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—' }}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-inherit opacity-90">
                    {{ row.appt.createdBy ? (row.appt.createdById === row.appt.doctorId ? `Dr. ${row.appt.createdBy.name}` : row.appt.createdBy.name) : '—' }}
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-inherit opacity-90">{{ row.appt.doctor.name }}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-inherit opacity-90">{{ row.appt.type || 'Consulta' }}</td>
                  <td class="px-4 py-3 whitespace-nowrap"><StatusBadge :status="row.appt.status" /></td>
                </tr>

                <tr v-else-if="row.type === 'block' && row.block" class="border-b border-amber-100 bg-amber-50/30">
                  <td class="px-4 py-3 text-amber-700 font-medium whitespace-nowrap">{{ format(row.slotStart, 'dd/MM/yyyy', { locale: ptBR }) }}</td>
                  <td class="px-4 py-3 text-amber-700 font-semibold tabular-nums whitespace-nowrap">{{ format(row.slotStart, 'HH:mm') }}</td>
                  <td colspan="7" class="px-4 py-3 text-amber-700">
                    <div class="flex items-center gap-2">
                      <Lock class="w-4 h-4" />
                      <span class="font-semibold">Bloqueado</span>
                      <span v-if="row.block.reason" class="opacity-80">({{ row.block.reason }})</span>
                    </div>
                  </td>
                </tr>

                <tr v-else-if="row.type === 'lunch'" class="border-b border-slate-100 bg-slate-50/50">
                  <td class="px-4 py-3 text-slate-400 font-medium whitespace-nowrap">{{ format(row.slotStart, 'dd/MM/yyyy', { locale: ptBR }) }}</td>
                  <td class="px-4 py-3 text-slate-400 font-semibold tabular-nums whitespace-nowrap">{{ format(row.slotStart, 'HH:mm') }}</td>
                  <td colspan="7" class="px-4 py-3 text-slate-500 font-medium italic">
                    <span class="flex items-center gap-1.5">
                      <Coffee class="w-4 h-4 text-slate-400" />
                      {{ authStore.user?.role === 'DOCTOR' ? 'Horário de Almoço' : 'Médico em Almoço' }}
                    </span>
                  </td>
                </tr>

                <tr
                  v-else
                  class="border-b border-slate-100 bg-white hover:bg-slate-50 cursor-pointer group"
                  @click="handleSlotClick(group.day, { h: row.slotStart.getHours(), m: row.slotStart.getMinutes() })"
                >
                  <td class="px-4 py-3 text-slate-400 font-medium whitespace-nowrap group-hover:text-primary-600 transition-colors">{{ format(row.slotStart, 'dd/MM/yyyy', { locale: ptBR }) }}</td>
                  <td class="px-4 py-3 text-slate-400 font-semibold tabular-nums whitespace-nowrap group-hover:text-primary-600 transition-colors">{{ format(row.slotStart, 'HH:mm') }}</td>
                  <td colspan="7" class="px-4 py-3 text-slate-400 font-medium group-hover:text-primary-600 transition-colors">Livre</td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Calendar grid -->
    <div v-if="viewMode === 'calendar'" class="card p-0 overflow-hidden">
      <div class="overflow-y-auto" style="max-height: 640px">
        <!-- Headers (Sticky) -->
        <div
          class="grid border-b border-slate-200 bg-slate-50/90 sticky top-0 z-30 backdrop-blur-sm"
          :style="{ gridTemplateColumns: `56px repeat(${weekDays.length}, 1fr)` }"
        >
          <div class="border-r border-slate-200" />
          <div
            v-for="day in weekDays" :key="day.toISOString()"
            class="p-3 text-center border-r border-slate-200 last:border-r-0 transition-colors"
            :class="isSameDay(day, new Date()) ? 'bg-primary-50' : 'hover:bg-slate-100/60'"
          >
            <p class="text-xs font-bold uppercase tracking-wider" :class="isSameDay(day, new Date()) ? 'text-primary-600' : 'text-slate-400'">
              {{ format(day, 'EEE', { locale: ptBR }) }}
            </p>
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center mx-auto mt-1 transition-all"
              :class="isSameDay(day, new Date()) ? 'bg-primary-600 text-white shadow-md shadow-primary-600/30' : 'text-slate-600 hover:bg-slate-200'"
            >
              <span class="text-sm font-bold">{{ format(day, 'd') }}</span>
            </div>
            <div
              v-if="getApptsByDay(day).length > 0"
              class="w-1.5 h-1.5 rounded-full mx-auto mt-1.5"
              :class="isSameDay(day, new Date()) ? 'bg-primary-300' : 'bg-primary-400'"
            />
          </div>
        </div>

        <!-- Grid Body -->
        <div class="grid" :style="{ gridTemplateColumns: `56px repeat(${weekDays.length}, 1fr)` }">
          <!-- Time labels -->
          <div class="border-r border-slate-200">
            <div
              v-for="(slot, i) in activeSlots" :key="i"
              :style="{ height: `${SLOT_HEIGHT}px` }"
              class="border-b flex items-start justify-end pr-2 pt-1"
              :class="slot.m === 0 ? 'border-slate-200' : 'border-slate-100'"
            >
              <span v-if="slot.m === 0" class="text-xs font-semibold text-slate-500">{{ slot.label }}</span>
              <span v-else class="text-xs text-slate-300">{{ slot.label }}</span>
            </div>
          </div>

          <!-- Day columns -->
          <div
            v-for="day in weekDays" :key="day.toISOString()"
            class="relative border-r border-slate-200 last:border-r-0"
            :class="[isSameDay(day, new Date()) ? 'bg-primary-50/20' : '', !isAllowedDay(day) ? 'bg-slate-100/60' : '']"
            :style="{ height: `${totalGridHeight}px` }"
          >
            <div v-if="!isAllowedDay(day)" class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <p class="text-xs text-slate-400 font-medium rotate-90 whitespace-nowrap">Fora do horário</p>
            </div>

            <!-- Slot lines -->
            <div
              v-for="(slot, i) in activeSlots" :key="i"
              :style="{ top: `${i * SLOT_HEIGHT}px`, height: `${SLOT_HEIGHT}px` }"
              class="absolute left-0 right-0 border-b transition-colors"
              :class="[slot.m === 0 ? 'border-slate-200' : 'border-slate-100', isAllowedDay(day) ? 'cursor-pointer hover:bg-primary-50/50' : 'cursor-not-allowed']"
              @click="isAllowedDay(day) && handleSlotClick(day, slot)"
            />

            <!-- Appointment Blocks -->
            <div
              v-for="block in getBlocksByDay(day)" :key="block.id"
              :style="{ top: `${getBlockPosition(parseISO(block.date)) + 1}px`, height: `${getBlockHeight(parseISO(block.date), parseISO(block.endDate)) - 2}px`, left: '2px', right: '2px' }"
              class="absolute rounded-md border-l-4 border-amber-600 bg-amber-100/80 px-1.5 py-0.5 z-20 overflow-hidden group"
              @click.stop
            >
              <div class="flex items-center gap-1">
                <Lock class="w-3 h-3 text-amber-700 flex-shrink-0" />
                <p class="text-xs font-bold text-amber-800 truncate">Bloqueado</p>
                <button
                  v-if="canDeleteBlock(block)"
                  class="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-amber-200 rounded transition-all"
                  @click.stop="deleteBlockFn(block.id)"
                >
                  <X class="w-3 h-3 text-amber-700" />
                </button>
              </div>
              <p v-if="getBlockHeight(parseISO(block.date), parseISO(block.endDate)) > 36 && block.reason" class="text-xs text-amber-700 opacity-80 truncate">{{ block.reason }}</p>
            </div>

            <!-- Lunch Break Block -->
            <template v-if="activeLunchStart && activeLunchEnd">
              <div
                :style="getLunchStyle(day)"
                class="absolute rounded-md border-l-4 border-slate-500 bg-slate-100/90 px-1.5 py-0.5 z-20 overflow-hidden flex flex-col justify-center select-none"
              >
                <div class="flex items-center gap-1">
                  <Coffee class="w-3 h-3 text-slate-600 flex-shrink-0" />
                  <p class="text-xs font-bold text-slate-700 truncate">
                    {{ authStore.user?.role === 'DOCTOR' ? 'Horário de Almoço' : 'Médico em Almoço' }}
                  </p>
                </div>
                <p class="text-[10px] text-slate-500 truncate leading-tight">
                  {{ activeLunchStart }} - {{ activeLunchEnd }}
                </p>
              </div>
            </template>

            <!-- Appointments -->
            <div
              v-for="appt in getApptsByDay(day)" :key="appt.id"
              :style="{ top: `${getApptPosition(parseISO(appt.date)) + 1}px`, height: `${getApptHeight(parseISO(appt.date), appt.duration) - 2}px`, left: '2px', right: '2px' }"
              class="absolute rounded-md border-l-4 px-1.5 py-0.5 shadow-sm z-10 overflow-hidden transition-all cursor-pointer hover:brightness-95"
              :class="getApptColor(appt.status)"
              @click="handleApptClick($event, appt)"
              @mouseenter="handleApptMouseEnter($event, appt)"
              @mousemove="handleApptMouseMove"
              @mouseleave="handleApptMouseLeave"
            >
              <p class="text-xs font-bold leading-tight truncate">
                <span class="flex items-center gap-1">
                  <AlertTriangle v-if="appt.patient.status === 'PRE_CADASTRO'" class="w-3 h-3 text-amber-500 flex-shrink-0" />
                  {{ format(parseISO(appt.date), 'HH:mm') }} {{ appt.patient.name }}
                </span>
              </p>
              <p v-if="getApptHeight(parseISO(appt.date), appt.duration) > 36" class="text-xs opacity-80 truncate leading-tight">{{ appt.duration }}min · {{ appt.type || 'Consulta' }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Mobile list ── -->
    <div v-if="viewMode === 'calendar'" class="xl:hidden space-y-2 animate-stagger-3">
      <template v-if="appointments.length === 0">
        <div class="card text-center py-10">
          <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3 animate-float">
            <Calendar class="w-7 h-7 text-slate-300" />
          </div>
          <p class="text-slate-500 font-semibold">Nenhuma consulta esta semana</p>
          <p class="text-slate-400 text-sm mt-1">Clique em + para agendar</p>
        </div>
      </template>
      <template v-else>
        <div
          v-for="(appt, idx) in appointments" :key="appt.id"
          class="card-hover flex items-center gap-4 py-3 px-4"
          :style="{ animationDelay: `${idx * 0.04}s` }"
          @click="handleApptClick($event, appt)"
        >
          <div class="text-center min-w-[52px]">
            <p class="text-xs font-semibold text-slate-400 uppercase">{{ format(parseISO(appt.date), 'EEE', { locale: ptBR }) }}</p>
            <p class="text-xl font-bold text-slate-900 tabular-nums leading-tight">{{ format(parseISO(appt.date), 'd') }}</p>
            <p class="text-xs font-bold text-primary-600 tabular-nums">{{ format(parseISO(appt.date), 'HH:mm') }}</p>
          </div>
          <div class="w-px h-10 bg-slate-200 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-semibold text-sm text-slate-900 truncate">{{ appt.patient.name }}</p>
              <span v-if="appt.patient.status === 'PRE_CADASTRO'" class="flex-shrink-0 text-xs bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
                Pré-cad.
              </span>
            </div>
            <p class="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Clock class="w-3 h-3" />
              <span class="tabular-nums">{{ appt.duration }}min</span>
              ·
              <span class="truncate">{{ appt.doctor.name }}</span>
            </p>
          </div>
          <StatusBadge :status="appt.status" />
        </div>
      </template>
    </div>

    <!-- Hover tooltip — Teleport to escape transform/overflow ancestors -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        ref="tooltipRef"
        class="fixed z-[9999] pointer-events-none"
        :style="tooltipStyle"
      >
        <div
          class="w-60 bg-white border border-slate-200 rounded-xl shadow-xl p-3 space-y-2 pointer-events-auto"
          @mouseenter="cancelTooltipHide"
          @mouseleave="handleApptMouseLeave"
        >
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" :class="dotColors[tooltip.appt.status] || 'bg-primary-500'" />
            <p class="font-semibold text-slate-900 text-sm leading-tight truncate">{{ tooltip.appt.patient.name }}</p>
          </div>
          <div class="space-y-1.5 text-xs text-slate-500">
            <div class="flex items-center gap-1.5">
              <Clock class="w-3 h-3 flex-shrink-0 text-slate-400" />
              <span>{{ format(parseISO(tooltip.appt.date), 'HH:mm') }} · {{ tooltip.appt.duration }}min</span>
            </div>
            <div v-if="tooltip.appt.type" class="flex items-center gap-1.5">
              <UserIcon class="w-3 h-3 flex-shrink-0 text-slate-400" />
              <span class="truncate">{{ tooltip.appt.type }}</span>
            </div>
            <div v-if="tooltip.appt.room" class="flex items-center gap-1.5">
              <MapPin class="w-3 h-3 flex-shrink-0 text-slate-400" />
              <span class="truncate">
                {{ tooltip.appt.room.name }}{{ tooltip.appt.room.cidade ? ` — ${tooltip.appt.room.cidade}` : '' }}
              </span>
            </div>
            <div v-if="tooltip.appt.createdBy" class="flex items-center gap-1.5">
              <UserIcon class="w-3 h-3 flex-shrink-0 text-slate-400" />
              <span class="truncate">
                Agendado por
                <span class="font-medium text-slate-700">
                  {{ tooltip.appt.createdById === tooltip.appt.doctorId ? `Dr. ${tooltip.appt.createdBy.name}` : tooltip.appt.createdBy.name }}
                </span>
                <span v-if="tooltip.appt.createdById !== tooltip.appt.doctorId" class="text-slate-400"> (Sec.)</span>
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <CalendarDays class="w-3 h-3 flex-shrink-0 text-slate-400" />
              <span>{{ format(parseISO(tooltip.appt.createdAt), "dd/MM/yyyy 'às' HH:mm") }}</span>
            </div>
          </div>
          <StatusBadge :status="tooltip.appt.status" />
        </div>
      </div>
    </Teleport>

    <Modal
      :is-open="modalOpen"
      :title="selectedAppt ? 'Editar Consulta' : 'Novo Agendamento'"
      size="lg"
      @close="closeAppointmentModal"
    >
      <AppointmentForm
        :appointment="selectedAppt"
        :default-date="selectedSlot?.date"
        :doctors="doctors"
        :patients="patients"
        :appointment-types="appointmentTypes"
        :rooms="myRooms"
        :current-user="authStore.user"
        :loading="savingAppt"
        @submit="handleFormSubmit"
        @delete="handleFormDelete"
        @patient-created="handlePatientCreated"
        @charged="handleCharged"
      />
    </Modal>

    <Modal :is-open="blockModalOpen" title="Bloquear Horário" @close="blockModalOpen = false">
      <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
        <p class="text-xs text-amber-800 flex items-center gap-2">
          <Lock class="w-4 h-4 flex-shrink-0" />
          O horário bloqueado ficará visível para secretárias como indisponível.
        </p>
      </div>
      <form class="space-y-4" @submit="handleBlockSubmit">
        <div v-if="authStore.user?.role === 'ADMIN'">
          <label class="label">Médico</label>
          <select v-model="blockDoctorId" class="input-field">
            <option v-for="d in doctors" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>
        <div>
          <label class="label">Data</label>
          <input v-model="blockDate" type="date" class="input-field" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Início</label>
            <input v-model="blockStartTime" type="time" class="input-field" />
          </div>
          <div>
            <label class="label">Fim</label>
            <input v-model="blockEndTime" type="time" class="input-field" />
          </div>
        </div>
        <div>
          <label class="label">Motivo (opcional)</label>
          <input
            v-model="blockReason"
            class="input-field"
            placeholder="Ex: Comprometimento pessoal, Reunião..."
          />
        </div>
        <button type="submit" :disabled="blockSaving" class="btn-primary w-full">
          <span v-if="blockSaving" class="flex items-center gap-2 justify-center">
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Salvando...
          </span>
          <template v-else>
            <Lock class="w-4 h-4" />Bloquear Horário
          </template>
        </button>
      </form>
    </Modal>

    <AgendaSettingsModal :is-open="settingsModalOpen" @close="settingsModalOpen = false" />

    <Modal :is-open="!!overlapWarning" title="Atenção: Choque de Horários" @close="overlapWarning = null">
      <div class="p-4 space-y-4 text-slate-700">
        <div class="flex items-center gap-3 text-amber-700 bg-amber-50 p-4 rounded-xl border border-amber-200">
          <AlertTriangle class="w-6 h-6 flex-shrink-0" />
          <p class="font-medium text-[15px] leading-snug">
            {{ overlapWarning?.message }}
          </p>
        </div>
        <p class="text-sm text-slate-600 px-1">
          Deseja forçar e salvar o agendamento mesmo assim?
        </p>
        <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            class="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium"
            @click="overlapWarning = null"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors font-medium"
            @click="forceSaveOverlap"
          >
            Sim, Forçar Agendamento
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>
