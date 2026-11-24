import clsx from 'clsx'
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  Database,
  DownloadCloud,
  FolderTree,
  KeyRound,
  MessageCircle,
  Package,
  Phone,
  ShieldCheck,
  Smartphone,
  User,
  Usb
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatCents } from '@shared/money'
import {
  DATA_POLICY_LABEL,
  REPAIR_STATUSES,
  REPAIR_STATUS_LABEL,
  type BackupRecord,
  type DiagnosticPhase,
  type DiagnosticSession,
  type RepairListItem,
  type RepairStatus
} from '@shared/types'
import { STATUS_DOT, StatusPill } from '../components/StatusPill'
import { api, formatDate, formatDateTime, formatSize, toWhatsAppNumber } from '../lib/api'
import { findLiveDevice } from '../lib/diagnostics'
import { useDevices } from '../store/devices'
import { toast } from '../store/toast'

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="text-ink-400">{label}</span>
      <span className={clsx('text-right', mono && 'font-mono text-[13px]')}>{children ?? '—'}</span>
    </div>
  )
}

const buildWhatsAppMessage = (r: RepairListItem): string => {
  const firstName = r.customerName.split(' ')[0] || ''
  const due = Math.max(0, r.quoteCents - r.depositCents)
  const lines = [
    `Ciao ${firstName}, aggiornamento sulla riparazione ${r.ticketNumber}:`,
    `📱 ${r.deviceLabel}`,
    ...(r.services.length ? [`🛠 ${r.services.map((s) => s.label).join(', ')}`] : []),
    `🔧 Stato: *${REPAIR_STATUS_LABEL[r.status]}*`
  ]
  if (r.quoteCents > 0)
    lines.push(`💶 Importo: ${formatCents(r.quoteCents)}${r.depositCents ? ` (saldo ${formatCents(due)})` : ''}`)
  if (r.status === 'ready') lines.push('Puoi passare a ritirarlo quando vuoi. Grazie!')
  return lines.join('\n')
}

export function RepairDetail() {
  const { id } = useParams()
  const [repair, setRepair] = useState<RepairListItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [diag, setDiag] = useState<Record<DiagnosticPhase, DiagnosticSession | null>>({ pre: null, post: null })
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const devices = useDevices((s) => s.devices)

  const load = useCallback(() => {
    const rid = Number(id)
    void api.invoke('repairs:get', rid).then(setRepair)
    void Promise.all([api.invoke('diagnostic:get', rid, 'pre'), api.invoke('diagnostic:get', rid, 'post')]).then(
      ([pre, post]) => setDiag({ pre, post })
    )
    void api.invoke('backup:history', rid).then(setBackups)
  }, [id])
  useEffect(load, [load])

  if (!repair) return <p className="pt-10 text-ink-400">Caricamento…</p>
  const live = findLiveDevice(devices, repair.deviceSerial)

  const changeStatus = async (s: RepairStatus) => {
    if (s === repair.status || busy) return
    setBusy(true)
    try {
      await api.invoke('repairs:setStatus', repair.id, s)
      toast.ok(`Stato: ${REPAIR_STATUS_LABEL[s]}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  const notify = () => {
    if (!repair.customerPhone) return toast.error('Il cliente non ha un numero di telefono')
    const url = `https://wa.me/${toWhatsAppNumber(repair.customerPhone)}?text=${encodeURIComponent(buildWhatsAppMessage(repair))}`
    window.open(url, '_blank') // il main process lo apre in WhatsApp Desktop / browser
  }

  const currentIdx = REPAIR_STATUSES.indexOf(repair.status)
  const marginPct = repair.quoteCents > 0 ? Math.round((repair.marginCents / repair.quoteCents) * 100) : null

  return (
    <>
      <Link to="/repairs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-signal">
        <ArrowLeft className="size-4" /> Riparazioni
      </Link>

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{repair.ticketNumber}</h1>
            <StatusPill status={repair.status} />
            {repair.priority !== 'normal' && (
              <span
                className={clsx(
                  'rounded-full border px-2.5 py-0.5 text-xs',
                  repair.priority === 'urgent' && 'border-bad/40 text-bad',
                  repair.priority === 'high' && 'border-warn/40 text-warn',
                  repair.priority === 'low' && 'border-ink-600 text-ink-400'
                )}
              >
                {{ low: 'Bassa', high: 'Alta', urgent: 'Urgente', normal: '' }[repair.priority]}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-300">
            {repair.deviceLabel} · aperta il {formatDate(repair.createdAt)} · aggiornata{' '}
            {formatDateTime(repair.updatedAt)}
          </p>
        </div>
        <button className="btn bg-[#25D366] text-ink-950 hover:bg-[#3be37a]" onClick={notify}>
          <MessageCircle className="size-4" /> Notifica cliente WhatsApp
        </button>
      </div>

      {/* Stepper di stato cliccabile (base per il Kanban della Fase 2) */}
      <div className="panel mb-6 grid grid-cols-6 overflow-hidden">
        {REPAIR_STATUSES.map((s, i) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => void changeStatus(s)}
            className={clsx(
              'relative flex flex-col items-start gap-1 border-r border-ink-700 px-4 py-3 text-left text-sm last:border-r-0 transition-colors',
              i === currentIdx ? 'bg-ink-800' : 'hover:bg-ink-800/60',
              i > currentIdx && 'text-ink-400'
            )}
          >
            {i <= currentIdx && <span className={clsx('absolute inset-x-0 top-0 h-0.5', STATUS_DOT[s])} />}
            <span className="font-mono text-[10px] text-ink-400">0{i + 1}</span>
            <span className="flex items-center gap-1.5 font-medium">
              {i < currentIdx && <Check className="size-3.5 text-ok" />}
              {REPAIR_STATUS_LABEL[s]}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="panel p-5 xl:col-span-2">
          <h2 className="label mb-3">Interventi</h2>
          <ul className="mb-6 divide-y divide-ink-700 rounded-lg border border-ink-700">
            {repair.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <button
                  className="group flex items-center gap-2 text-left"
                  title={s.done ? 'Segna come da fare' : 'Segna come completato'}
                  onClick={() =>
                    void api.invoke('repairs:toggleService', s.id, !s.done).then(() => {
                      load()
                    })
                  }
                >
                  <span
                    className={clsx(
                      'grid size-5 place-items-center rounded border',
                      s.done
                        ? 'border-ok/60 bg-ok/15 text-ok'
                        : 'border-ink-600 text-transparent group-hover:text-ink-400'
                    )}
                  >
                    <Check className="size-3.5" />
                  </span>
                  <span className={clsx(s.done && 'text-ink-300 line-through decoration-ink-600')}>{s.label}</span>
                </button>
                <span className="font-mono tabular-nums">{formatCents(s.priceCents)}</span>
              </li>
            ))}
          </ul>

          <h2 className="label mb-3">Problema segnalato</h2>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{repair.reportedIssue}</p>

          <div className="mt-6 flex flex-wrap gap-2">
            <span
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                repair.dataPolicy === 'keep' ? 'border-signal/30 text-signal' : 'border-ink-700 text-ink-100'
              )}
            >
              <Database className="size-4" /> {DATA_POLICY_LABEL[repair.dataPolicy]}
            </span>
            {repair.ownershipVerified && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-ok/30 px-3 py-2 text-sm text-ok">
                <ShieldCheck className="size-4" /> Proprietà verificata · {repair.ownershipProof}
              </span>
            )}
          </div>
          {repair.intakeNotes && (
            <>
              <h2 className="label mt-6 mb-3">Note accettazione</h2>
              <p className="whitespace-pre-wrap text-sm text-ink-300">{repair.intakeNotes}</p>
            </>
          )}
          {repair.devicePasscode && (
            <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm">
              <KeyRound className="size-4 text-ink-400" /> Codice sblocco:
              <span className="font-mono">{repair.devicePasscode}</span>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5">
          <section className="panel p-5">
            <h2 className="label mb-3 flex items-center gap-2">
              <ClipboardCheck className="size-3.5" /> Diagnostica e report
            </h2>
            <div className="flex flex-col gap-2">
              {(['pre', 'post'] as const).map((p) => {
                const d = diag[p]
                const faulty = d?.results.filter((r) => r.result === 'faulty').length ?? 0
                return (
                  <Link
                    key={p}
                    to={`/repairs/${repair.id}/diagnostic/${p}`}
                    className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2.5 text-sm hover:border-ink-600"
                  >
                    <span>{p === 'pre' ? 'Accettazione (pre)' : 'Riconsegna (post)'}</span>
                    {d?.savedAt ? (
                      <span className={clsx('text-xs', faulty ? 'text-warn' : 'text-ok')}>
                        {faulty ? `${faulty} difetti` : 'Completata'}
                        {d.pdfPath && ' · PDF'}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-400">Da fare →</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </section>

          {(live || backups.length > 0) && (
            <section className="panel p-5">
              <h2 className="label mb-3 flex items-center gap-2">
                <Usb className="size-3.5" /> Dispositivo e backup
              </h2>
              {live && (
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {(
                    [
                      ['files', 'File', FolderTree],
                      ['apps', 'App', Package],
                      ['backup', 'Backup', DownloadCloud]
                    ] as const
                  ).map(([tab, label, Icon]) => (
                    <Link
                      key={tab}
                      to={`/devices/${encodeURIComponent(live.serial)}/${tab}`}
                      className="btn-ghost justify-center py-1.5 text-xs"
                    >
                      <Icon className="size-3.5" /> {label}
                    </Link>
                  ))}
                </div>
              )}
              {backups.map((b) => (
                <button
                  key={b.id}
                  onClick={() => void api.invoke('shell:openPath', b.destPath)}
                  className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-xs hover:text-signal"
                  title={b.destPath}
                >
                  <span className="truncate">
                    Backup {formatDateTime(b.startedAt)} · {formatSize(b.bytes)}
                  </span>
                  <span className={b.status === 'done' ? 'text-ok' : 'text-warn'}>
                    {b.status === 'done' ? 'ok' : b.status}
                  </span>
                </button>
              ))}
            </section>
          )}

          <section className="panel p-5">
            <h2 className="label mb-1 flex items-center gap-2">
              <User className="size-3.5" /> Cliente
            </h2>
            <Row label="Nome">{repair.customerName}</Row>
            <Row label="Telefono" mono>
              {repair.customerPhone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" />
                  {repair.customerPhone}
                </span>
              )}
            </Row>
            <h2 className="label mt-4 mb-1 flex items-center gap-2">
              <Smartphone className="size-3.5" /> Dispositivo
            </h2>
            <Row label="Modello">{repair.deviceLabel}</Row>
            <Row label="Pronto previsto">{repair.estimatedReadyAt ? formatDate(repair.estimatedReadyAt) : null}</Row>
          </section>

          <section className="panel p-5">
            <h2 className="label mb-1">Economia</h2>
            <Row label="Preventivo" mono>
              {formatCents(repair.quoteCents)}
            </Row>
            <Row label="Costi esterni" mono>
              − {formatCents(repair.externalCostCents)}
            </Row>
            <Row label="Manodopera interna" mono>
              − {formatCents(repair.laborCents)}
            </Row>
            <div className="mt-2 flex items-baseline justify-between border-t border-ink-700 pt-3">
              <span className="label">Margine</span>
              <span
                className={clsx(
                  'font-display text-2xl font-semibold tabular-nums',
                  repair.marginCents < 0 ? 'text-bad' : 'text-ok'
                )}
              >
                {formatCents(repair.marginCents)}
                {marginPct !== null && <span className="ml-2 font-mono text-xs text-ink-400">{marginPct}%</span>}
              </span>
            </div>
            <Row label="Acconto" mono>
              {formatCents(repair.depositCents)}
            </Row>
            <Row label="Saldo al ritiro" mono>
              {formatCents(Math.max(0, repair.quoteCents - repair.depositCents))}
            </Row>
          </section>
        </div>
      </div>
    </>
  )
}
