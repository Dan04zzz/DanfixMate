import clsx from 'clsx'
import { CheckCircle2, FolderOpen, Loader2, X, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import { act, api, formatSize } from '../lib/api'
import { useJobs } from '../store/jobs'
import { toast } from '../store/toast'

/** Pannellino in basso a sinistra con le operazioni lunghe in corso e appena concluse. */
export function JobsDock() {
  const { jobs, dismissed, dismiss } = useJobs()

  // i job riusciti si chiudono da soli; errori e annullati restano finché non li chiudi
  useEffect(() => {
    const timers = jobs
      .filter((j) => j.status === 'done' && !dismissed.has(j.id))
      .map((j) => setTimeout(() => dismiss(j.id), 8000))
    return () => timers.forEach(clearTimeout)
  }, [jobs, dismissed, dismiss])

  const visible = jobs.filter((j) => !dismissed.has(j.id)).slice(0, 4)
  if (!visible.length) return null

  return (
    <div className="fixed bottom-5 left-64 z-40 flex w-96 flex-col gap-2">
      {visible.map((j) => {
        const running = j.status === 'running'
        return (
          <div
            key={j.id}
            className={clsx(
              'panel p-3 text-sm shadow-2xl shadow-black/60',
              j.status === 'done' && 'border-ok/40',
              j.status === 'error' && 'border-bad/40'
            )}
          >
            <div className="flex items-center gap-2.5">
              {running ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-signal" />
              ) : j.status === 'done' ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" />
              ) : (
                <XCircle className={clsx('size-4 shrink-0', j.status === 'error' ? 'text-bad' : 'text-ink-400')} />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{j.label}</span>
              {j.resultPath && !running && (
                <button
                  className="text-ink-300 hover:text-signal"
                  title="Apri cartella"
                  onClick={() => void act(api.invoke('shell:openPath', j.resultPath!), toast)}
                >
                  <FolderOpen className="size-4" />
                </button>
              )}
              {running ? (
                <button
                  className="text-xs text-ink-400 hover:text-bad"
                  onClick={() => void api.invoke('jobs:cancel', j.id)}
                >
                  Annulla
                </button>
              ) : (
                <button className="text-ink-400 hover:text-ink-100" onClick={() => dismiss(j.id)} title="Chiudi">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="mt-1 flex justify-between gap-3 text-xs text-ink-400">
              <span className="truncate">{j.message}</span>
              {j.kind !== 'install' && j.kind !== 'apk_extract' && j.bytesDone > 0 && (
                <span className="shrink-0 font-mono">
                  {formatSize(j.bytesDone)}
                  {j.bytesTotal ? ` / ${formatSize(j.bytesTotal)}` : ''}
                </span>
              )}
            </div>
            {running && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-700">
                <div
                  className={clsx(
                    'h-full rounded-full bg-signal transition-all',
                    j.percent == null && 'w-1/3 animate-pulse'
                  )}
                  style={j.percent != null ? { width: `${j.percent}%` } : undefined}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
