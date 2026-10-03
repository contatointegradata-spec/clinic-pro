import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'default'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
  duration: number
}

type ToastOpts = number | { duration?: number }

function resolveDuration(opts?: ToastOpts): number {
  if (typeof opts === 'number') return opts
  return opts?.duration ?? 4000
}

let nextId = 1
export const toasts = reactive<ToastItem[]>([])

function push(message: string, type: ToastType, opts?: ToastOpts) {
  const id = nextId++
  const duration = resolveDuration(opts)
  toasts.push({ id, message, type, duration })
  setTimeout(() => {
    const idx = toasts.findIndex(t => t.id === id)
    if (idx !== -1) toasts.splice(idx, 1)
  }, duration)
  return id
}

function toast(message: string, opts?: ToastOpts) {
  return push(message, 'default', opts)
}
toast.success = (message: string, opts?: ToastOpts) => push(message, 'success', opts)
toast.error = (message: string, opts?: ToastOpts) => push(message, 'error', opts)

export default toast
