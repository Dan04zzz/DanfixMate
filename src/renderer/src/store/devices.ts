import { create } from 'zustand'
import type { LiveDevice, ToolInstallProgress, ToolStatus } from '@shared/types'
import { api } from '../lib/api'

interface DeviceState {
  devices: LiveDevice[]
  tools: ToolStatus | null
  install: ToolInstallProgress | null
  refreshing: boolean
  init: () => () => void
  refresh: () => Promise<void>
  installTools: () => Promise<void>
}

export const useDevices = create<DeviceState>((set) => ({
  devices: [],
  tools: null,
  install: null,
  refreshing: false,

  init: () => {
    void api.invoke('devices:list').then((devices) => set({ devices }))
    void api.invoke('tools:status').then((tools) => set({ tools }))
    void api.invoke('tools:progress').then((install) => set({ install }))
    const offs = [
      api.on('devices:changed', (devices) => set({ devices })),
      api.on('tools:changed', (tools) => set({ tools })),
      api.on('tools:progress', (install) => set({ install }))
    ]
    return () => offs.forEach((off) => off())
  },

  refresh: async () => {
    set({ refreshing: true })
    try {
      set({ devices: await api.invoke('devices:refresh') })
    } finally {
      set({ refreshing: false })
    }
  },

  installTools: async () => {
    set({ tools: await api.invoke('tools:install') })
  }
}))
