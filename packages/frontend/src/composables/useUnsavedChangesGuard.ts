import { watch } from 'vue'
import { useUnsavedChangesStore } from '../stores/unsavedChanges'

/**
 * Bloqueia o fechamento/recarregamento acidental da aba enquanto houver
 * alterações não salvas (formulário de paciente, prontuário, agendamento etc).
 */
export function useUnsavedChangesGuard() {
  const store = useUnsavedChangesStore()

  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }

  watch(
    () => store.hasUnsavedChanges,
    (has) => {
      window.removeEventListener('beforeunload', handler)
      if (has) window.addEventListener('beforeunload', handler)
    },
    { immediate: true }
  )
}
