import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type DanfixMateApi, type EventChannel, type InvokeChannel } from '@shared/ipc'

// Allow-list esplicita: il renderer non può invocare canali arbitrari
const INVOKE = new Set<string>(INVOKE_CHANNELS)
const EVENTS = new Set<string>(EVENT_CHANNELS)

const api: DanfixMateApi = {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Canale non consentito: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: EventChannel, listener: (payload: unknown) => void) {
    if (!EVENTS.has(channel)) throw new Error(`Evento non consentito: ${channel}`)
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
} as DanfixMateApi

contextBridge.exposeInMainWorld('danfixmate', api)
