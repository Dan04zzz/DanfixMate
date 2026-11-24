import clsx from 'clsx'
import {
  BookUser,
  Check,
  FileText,
  FolderOpen,
  Image,
  Loader2,
  MessageCircle,
  Music,
  Play,
  RefreshCw,
  type LucideIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackupCategoryId, BackupCategoryScan, BackupRecord, LiveDevice, RepairListItem } from '@shared/types'
import { act, api, errMsg, formatDateTime, formatSize } from '../../lib/api'
import { useJobs } from '../../store/jobs'
import { toast } from '../../store/toast'

const ICONS: Record<BackupCategoryId, LucideIcon> = {
  photos: Image,
  documents: FileText,
  audio: Music,
  whatsapp: MessageCircle,
  contacts: BookUser
}

const STATUS: Record<BackupRecord['status'], { label: string; tone: string }> = {
  running: { label: 'In corso', tone: 'text-signal' },
  done: { label: 'Completato', tone: 'text-ok' },
  cancelled: { label: 'Annullato', tone: 'text-ink-400' },
  error: { label: 'Errore', tone: 'text-bad' }
}

export function BackupPanel({ device }: { device: LiveDevice }) {
  const serial = device.serial
  const [scan, setScan] = useState<BackupCategoryScan[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [chosen, setChosen] = useState<Set<BackupCategoryId>>(new Set(['photos', 'documents', 'whatsapp', 'contacts']))
  const [dest, setDest] = useState<string | null>(null)
  const [repairs, setRepairs] = useState<RepairListItem[]>([])
  const [repairId, setRepairId] = useState<number | ''>('')
  const [history, setHistory] = useState<BackupRecord[]>([])
  const running = useJobs((s) =>
    s.jobs.some((j) => j.kind === 'backup' && j.serial === serial && j.status === 'running')
  )

  const doScan = useCallback(async () => {
    setScanning(true)
    try {
      setScan(await api.invoke('backup:scan', serial))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setScanning(false)
    }
  }, [serial])

  const loadHistory = useCallback(() => void api.invoke('backup:history').then(setHistory), [])

  useEffect(() => {
    void doScan()
    loadHistory()
    void api.invoke('repairs:list').then((list) => {
      const open = list.filter((r) => r.status !== 'delivered')
      setRepairs(open)
      // collega in automatico alla scheda aperta dello stesso telefono
      const hw = device.hardwareSerial ?? device.serial
      const match = open.find((r) => r.deviceSerial && (r.deviceSerial === hw || r.deviceSerial === device.serial))
      if (match) setRepairId(match.id)
    })
  }, [doScan, loadHistory, device.hardwareSerial, device.serial])

  useEffect(() => {
    const onDone = (ev: Event) => {
      if ((ev as CustomEvent).detail?.kind === 'backup') setTimeout(loadHistory, 300)
    }
    window.addEventListener('danfixmate:job-finished', onDone)
    return () => window.removeEventListener('danfixmate:job-finished', onDone)
  }, [loadHistory])

  const total = useMemo(
    () => (scan ?? []).filter((c) => chosen.has(c.id)).reduce((a, c) => a + (c.bytes ?? 0), 0),
    [scan, chosen]
  )

  const toggle = (id: BackupCategoryId) =>
    setChosen((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const start = async () => {
    const r = await act(
      api.invoke('backup:start', {
        serial,
        categories: [...chosen],
        destinationDir: dest ?? '',
        repairId: repairId === '' ? undefined : repairId
      }),
      toast
    )
    if (r?.ok) setTimeout(loadHistory, 300)
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-5">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold">Cosa salvare</h2>
            <button className="btn-ghost py-1.5 text-xs" onClick={() => void doScan()} disabled={scanning}>
              <RefreshCw className={clsx('size-3.5', scanning && 'animate-spin')} /> Ricalcola
            </button>
          </div>
          {!scan ? (
            <div className="flex items-center gap-3 py-10 text-sm text-ink-400">
              <Loader2 className="size-5 animate-spin" /> Analizzo la memoria del telefono…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {scan.map((c) => {
                const Icon = ICONS[c.id]
                const empty = c.id === 'contacts' ? c.items === 0 : c.paths.length === 0
                const on = chosen.has(c.id) && !empty
                return (
                  <button
                    key={c.id}
                    disabled={empty}
                    onClick={() => toggle(c.id)}
                    className={clsx(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-40',
                      on ? 'border-signal/60 bg-signal/5' : 'border-ink-700 bg-ink-800/40 hover:border-ink-600'
                    )}
                  >
                    <div
                      className={clsx(
                        'grid size-9 shrink-0 place-items-center rounded-lg',
                        on ? 'bg-signal/15 text-signal' : 'bg-ink-800 text-ink-300'
                      )}
                    >
                      <Icon className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.label}</span>
                        {on && <Check className="size-4 text-signal" />}
                      </div>
                      <div className="mt-0.5 text-sm text-ink-300">
                        {c.id === 'contacts'
                          ? c.items == null
                            ? 'Lettura via USB non consentita da questo telefono'
                            : `${c.items} contatti`
                          : empty
                            ? 'Nessuna cartella trovata'
                            : `${formatSize(c.bytes)} · ${c.items?.toLocaleString('it-IT')} file`}
                      </div>
                      {c.paths.length > 0 && (
                        <div className="mt-1 truncate font-mono text-[11px] text-ink-400">{c.paths.join('  ')}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="p-5 pb-3 font-display text-[15px] font-semibold">Backup recenti</h2>
          {history.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-400">Nessun backup eseguito.</p>
          ) : (
            <ul className="divide-y divide-ink-700/70">
              {history.slice(0, 12).map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{b.deviceLabel || 'Dispositivo'}</span>
                      {b.ticketNumber && <span className="font-mono text-xs text-ink-400">{b.ticketNumber}</span>}
                    </div>
                    <div className="truncate text-xs text-ink-400">
                      {formatDateTime(b.startedAt)} · {formatSize(b.bytes)} · {b.files.toLocaleString('it-IT')} file
                      {b.message && b.status !== 'done' ? ` · ${b.message}` : ''}
                    </div>
                  </div>
                  <span className={clsx('text-xs', STATUS[b.status].tone)}>{STATUS[b.status].label}</span>
                  <button
                    className="text-ink-300 hover:text-signal"
                    title={b.destPath}
                    onClick={() => void act(api.invoke('shell:openPath', b.destPath), toast)}
                  >
                    <FolderOpen className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="xl:sticky xl:top-0 xl:self-start">
        <section className="panel p-5">
          <h2 className="mb-4 font-display text-[15px] font-semibold">Avvia backup</h2>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="label">Destinazione sul PC</span>
              <div className="flex gap-2">
                <div className="field truncate py-2 font-mono text-xs text-ink-300" title={dest ?? ''}>
                  {dest ?? 'Documenti\\DanfixMate\\Backup'}
                </div>
                <button
                  className="btn-ghost shrink-0"
                  onClick={() => void api.invoke('backup:chooseDir').then((d) => d && setDest(d))}
                >
                  Cambia…
                </button>
              </div>
              <span className="text-xs text-ink-400">Verrà creata una sottocartella con modello e data.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="label">Collega a una scheda</span>
              <select
                className="field"
                value={repairId}
                onChange={(e) => setRepairId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Nessuna</option>
                {repairs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ticketNumber} · {r.customerName} · {r.deviceLabel}
                  </option>
                ))}
              </select>
              <span className="text-xs text-ink-400">A fine backup l’intervento “Backup dati” viene spuntato.</span>
            </label>

            <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <div className="label">Totale stimato</div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {scan ? formatSize(total) : '—'}
              </div>
              <div className="mt-1 text-xs text-ink-400">Serve almeno altrettanto spazio libero sul PC.</div>
            </div>

            <button
              className="btn-primary py-2.5"
              disabled={!scan || chosen.size === 0 || running}
              onClick={() => void start()}
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {running ? 'Backup in corso…' : 'Avvia backup'}
            </button>
            <p className="text-xs text-ink-400">
              L’avanzamento compare in basso a sinistra; puoi continuare a lavorare. Lascia il telefono collegato e
              sbloccato fino alla fine.
            </p>
          </div>
        </section>
      </aside>
    </div>
  )
}
