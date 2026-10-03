import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import api from '../lib/api'
import { APP_VERSION, VERSION_CHECK_INTERVAL_MS, VERSION_UPDATE_ENABLED } from '../lib/version'

interface VersionResponse {
  version: string
  buildDate: string
  environment: string
}

export function useAppVersion() {
  const latestVersion = ref<string | null>(null)
  let interval: ReturnType<typeof setInterval> | undefined

  async function check() {
    if (!VERSION_UPDATE_ENABLED) return
    try {
      const res = await api.get<VersionResponse>('/version')
      latestVersion.value = res.data.version
    } catch {
      // ignora — checagem de versão é best-effort
    }
  }

  onMounted(() => {
    check()
    if (VERSION_UPDATE_ENABLED) {
      interval = setInterval(check, VERSION_CHECK_INTERVAL_MS)
      window.addEventListener('focus', check)
    }
  })
  onBeforeUnmount(() => {
    if (interval) clearInterval(interval)
    window.removeEventListener('focus', check)
  })

  const updateAvailable = computed(() =>
    Boolean(VERSION_UPDATE_ENABLED && latestVersion.value && APP_VERSION && latestVersion.value !== APP_VERSION)
  )

  return { currentVersion: APP_VERSION, latestVersion, updateAvailable }
}
