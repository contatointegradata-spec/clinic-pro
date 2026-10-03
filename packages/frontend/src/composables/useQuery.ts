import { ref, watch, isRef, type Ref } from 'vue'

interface CacheEntry {
  data: unknown
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

interface UseQueryOptions<T> {
  key: string | Ref<string>
  queryFn: () => Promise<T>
  enabled?: boolean | Ref<boolean>
  staleTime?: number
  initialData?: T
}

/**
 * Composable leve inspirado no @tanstack/react-query, só com o que as
 * telas da ClinIQ Pro precisam: cache em memória por chave + staleTime,
 * refetch manual e reatividade a troca de `key`/`enabled`.
 */
export function useQuery<T>(options: UseQueryOptions<T>) {
  const { queryFn, staleTime = 0, initialData } = options
  const data = ref<T | undefined>(initialData) as Ref<T | undefined>
  const isLoading = ref(false)
  const error = ref<unknown>(null)

  const getKey = () => (isRef(options.key) ? options.key.value : options.key)
  const getEnabled = () => {
    const e = options.enabled
    if (e === undefined) return true
    return isRef(e) ? e.value : e
  }

  async function refetch() {
    if (!getEnabled()) return
    const key = getKey()
    const cached = cache.get(key)
    if (cached && Date.now() - cached.fetchedAt < staleTime) {
      data.value = cached.data as T
      return
    }
    isLoading.value = true
    try {
      const result = await queryFn()
      data.value = result
      error.value = null
      cache.set(key, { data: result, fetchedAt: Date.now() })
    } catch (e) {
      error.value = e
    } finally {
      isLoading.value = false
    }
  }

  if (getEnabled()) refetch()

  if (isRef(options.key)) {
    watch(options.key, () => refetch())
  }
  if (isRef(options.enabled)) {
    watch(options.enabled, (v) => { if (v) refetch() })
  }

  return { data, isLoading, error, refetch }
}
