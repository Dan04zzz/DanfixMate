import type { DanfixMateApi } from '@shared/ipc'

export const api: DanfixMateApi = window.danfixmate

export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes == null) return '—'
  const gb = bytes / 1024 ** 3
  return gb >= 100 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`
}

export const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

/** Normalizza un numero italiano per wa.me (solo cifre, prefisso 39 se manca). */
export const toWhatsAppNumber = (phone: string): string => {
  let digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.length <= 10) digits = `39${digits}`
  return digits
}

/** Messaggio leggibile da un errore IPC ("Error invoking remote method 'x': Error: …") */
export const errMsg = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Esegue una chiamata mostrando il messaggio di esito o di errore. */
export async function act<T extends { ok: boolean; message: string }>(
  p: Promise<T>,
  toast: { ok: (t: string) => void; error: (t: string) => void },
  opts: { silentCancel?: boolean } = { silentCancel: true }
): Promise<T | null> {
  try {
    const r = await p
    if (r.ok) toast.ok(r.message)
    else if (!(opts.silentCancel && r.message === 'Annullato')) toast.error(r.message)
    return r
  } catch (e) {
    toast.error(errMsg(e))
    return null
  }
}

export const formatSize = (bytes: number | null | undefined): string => {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`.replace('.', ',')
}
