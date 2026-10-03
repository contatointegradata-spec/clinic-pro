import { reactive } from 'vue'

export interface AgendaPreferences {
  startHour: number
  endHour: number
  interval: number
  hideWeekends: boolean
  compactMode: boolean
  weekStartsOn: 0 | 1
}

const DEFAULT_PREFERENCES: AgendaPreferences = {
  startHour: 6,
  endHour: 19,
  interval: 30,
  hideWeekends: false,
  compactMode: false,
  weekStartsOn: 1,
}

function loadInitial(): AgendaPreferences {
  try {
    const stored = localStorage.getItem('agenda_preferences')
    if (stored) return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) }
  } catch (err) {
    console.error('Error parsing agenda preferences:', err)
  }
  return { ...DEFAULT_PREFERENCES }
}

const preferences = reactive<AgendaPreferences>(loadInitial())

export function useAgendaPreferences() {
  function setPreferences(newPrefs: Partial<AgendaPreferences>) {
    Object.assign(preferences, newPrefs)
    localStorage.setItem('agenda_preferences', JSON.stringify(preferences))
  }

  return { preferences, setPreferences }
}
