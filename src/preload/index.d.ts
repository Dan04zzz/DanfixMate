import type { DanfixMateApi } from '../shared/ipc'

declare global {
  interface Window {
    danfixmate: DanfixMateApi
  }
}

export {}
