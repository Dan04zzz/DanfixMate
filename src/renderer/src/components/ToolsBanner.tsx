import { AlertTriangle, CheckCircle2, DownloadCloud, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDevices } from '../store/devices'

/**
 * Stato degli strumenti esterni. Al primo avvio DanfixMate scarica da solo adb e scrcpy:
 * qui mostriamo l'avanzamento, un breve "pronto" e, se serve, il pulsante Riprova.
 */
export function ToolsBanner() {
  const { tools, install, installTools } = useDevices()
  const [showDone, setShowDone] = useState(false)

  const working = install && ['checking', 'downloading', 'extracting'].includes(install.phase)
  const missing = tools
    ? [!tools.adb.available && 'adb', !tools.scrcpy.available && 'scrcpy'].filter(Boolean).join(' e ')
    : ''

  // Mostra "installati" per qualche secondo solo se c'è stato davvero un download
  useEffect(() => {
    if (install?.phase === 'done' && install.message === 'Strumenti installati') {
      setShowDone(true)
      const t = setTimeout(() => setShowDone(false), 5000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [install?.phase, install?.message])

  if (working) {
    return (
      <div className="mb-6 rounded-xl border border-signal/30 bg-signal/5 p-4 text-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin text-signal" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-signal">Preparo gli strumenti del banco</div>
            <div className="truncate text-ink-300">{install.message}</div>
          </div>
          {install.percent != null && install.phase === 'downloading' && (
            <span className="font-mono text-ink-100 tabular-nums">{install.percent}%</span>
          )}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
          <div
            className={
              install.phase === 'downloading' && install.percent != null
                ? 'h-full rounded-full bg-signal transition-all'
                : 'h-full w-1/3 animate-pulse rounded-full bg-signal/60'
            }
            style={
              install.phase === 'downloading' && install.percent != null ? { width: `${install.percent}%` } : undefined
            }
          />
        </div>
      </div>
    )
  }

  if (install?.phase === 'error' && missing) {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-bad">Download automatico di {missing} non riuscito</div>
          <p className="mt-1 text-ink-300">{install.message}</p>
          <p className="mt-1 text-xs text-ink-400">
            Controlla la connessione (o il firewall/proxy) e riprova. In alternativa copia i binari in{' '}
            <code className="font-mono">resources/bin</code>.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={() => void installTools()}>
          <RotateCcw className="size-4" /> Riprova
        </button>
      </div>
    )
  }

  if (missing) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm">
        <DownloadCloud className="size-5 shrink-0 text-warn" />
        <div className="flex-1">
          <span className="font-medium text-warn">Mancano {missing}.</span>{' '}
          <span className="text-ink-300">DanfixMate può scaricarli dalle fonti ufficiali (Google e GitHub).</span>
        </div>
        <button className="btn-primary shrink-0" onClick={() => void installTools()}>
          <DownloadCloud className="size-4" /> Scarica ora
        </button>
      </div>
    )
  }

  if (showDone) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/5 p-4 text-sm text-ok">
        <CheckCircle2 className="size-5" /> adb e scrcpy installati: il monitor USB è attivo.
      </div>
    )
  }

  return null
}
