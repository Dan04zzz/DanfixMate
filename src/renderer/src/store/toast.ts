import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'ok' | 'error' | 'info'
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = ++seq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismiss(id), 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const toast = {
  ok: (t: string) => useToast.getState().push('ok', t),
  error: (t: string) => useToast.getState().push('error', t),
  info: (t: string) => useToast.getState().push('info', t)
}
