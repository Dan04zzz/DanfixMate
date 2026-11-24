import clsx from 'clsx'
import { ArrowLeft, CheckCheck, FileDown, Loader2, RotateCcw, Save, Usb, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  DIAGNOSTIC_RESULT_LABEL,
  type DiagnosticEntry,
  type DiagnosticPhase,
  type DiagnosticResultValue,
  type DiagnosticSession,
  type ReportHeader,
  type RepairListItem
} from '@shared/types'
import { headerFromSettings } from '@shared/report-header'
import { SignaturePad } from '../components/SignaturePad'
import { useHotkeys } from '../hooks/useHotkeys'
import { api, errMsg, formatDateTime } from '../lib/api'
import { autoFill, findLiveDevice } from '../lib/diagnostics'
import { useDevices } from '../store/devices'
import { toast } from '../store/toast'

const CHOICES: { value: Exclude<DiagnosticResultValue, 'pending'>; tone: string }[] = [
  { value: 'ok', tone: 'bg-ok/15 text-ok border-ok/40' },
  { value: 'faulty', tone: 'bg-bad/15 text-bad border-bad/40' },
  { value: 'not_testable', tone: 'bg-ink-600 text-ink-100 border-ink-500' }
]

type Row = { result: DiagnosticResultValue; note: string }

const HEADER_FIELDS: [keyof ReportHeader, string, boolean?][] = [
  ['labName', 'Laboratorio', true],
  ['address', 'Indirizzo', true],
  ['phone', 'Telefono'],
  ['email', 'Email'],
  ['vat', 'Partita IVA'],
  ['technician', 'Tecnico']
]

export function Diagnostic() {
  const { id, phase: phaseParam } = useParams()
  const navigate = useNavigate()
  const repairId = Number(id)
  const phase: DiagnosticPhase = phaseParam === 'post' ? 'post' : 'pre'
  const devices = useDevices((s) => s.devices)

  const [repair, setRepair] = useState<RepairListItem | null>(null)
  const [session, setSession] = useState<DiagnosticSession | null>(null)
  const [rows, setRows] = useState<Record<number, Row>>({})
  const [notes, setNotes] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [header, setHeader] = useState<ReportHeader | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void api.invoke('repairs:get', repairId).then(setRepair)
    void api.invoke('diagnostic:get', repairId, phase).then((s) => {
      setSession(s)
      const saved = new Map(s.results.map((r) => [r.testId, r]))
      setRows(
        Object.fromEntries(
          s.tests.map((t) => [
            t.id,
            { result: saved.get(t.id)?.result ?? 'pending', note: saved.get(t.id)?.note ?? '' }
          ])
        )
      )
      setNotes(s.notes ?? '')
      setSignature(s.signaturePng)
      setDirty(false)
      // intestazione: quella salvata con questa diagnostica, altrimenti i predefiniti
      if (s.reportHeader) setHeader(s.reportHeader)
      else void api.invoke('settings:get').then((lab) => setHeader(headerFromSettings(lab)))
    })
  }, [repairId, phase])

  const live = findLiveDevice(devices, repair?.deviceSerial ?? null)

  const categories = useMemo(() => [...new Set(session?.tests.map((t) => t.category) ?? [])], [session])
  const counts = useMemo(() => {
    const c = { ok: 0, faulty: 0, not_testable: 0, pending: 0 }
    for (const r of Object.values(rows)) c[r.result]++
    return c
  }, [rows])

  const setRow = (testId: number, patch: Partial<Row>) => {
    setRows((prev) => ({ ...prev, [testId]: { ...prev[testId], ...patch } }))
    setDirty(true)
  }

  const prefill = () => {
    if (!live || !session) return
    const proposals = autoFill(session.tests, live)
    setRows((prev) => {
      const next = { ...prev }
      for (const p of proposals) {
        // non sovrascrive gli esiti già decisi dal tecnico, solo quelli ancora da verificare
        if (next[p.testId].result === 'pending')
          next[p.testId] = { result: p.result, note: p.note ?? next[p.testId].note }
      }
      return next
    })
    setDirty(true)
    toast.ok(`${proposals.length} controlli precompilati dal telefono: verifica e conferma`)
  }

  const allOk = () => {
    setRows((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, v.result === 'pending' ? { ...v, result: 'ok' as const } : v])
      )
    )
    setDirty(true)
  }

  const save = async (): Promise<boolean> => {
    if (!session) return false
    setSaving(true)
    try {
      const results: DiagnosticEntry[] = Object.entries(rows).map(([testId, r]) => ({
        testId: Number(testId),
        result: r.result,
        note: r.note || null
      }))
      const s = await api.invoke('diagnostic:save', {
        repairId,
        phase,
        results,
        notes,
        signaturePng: signature,
        deviceSnapshot: live ?? null,
        reportHeader: header
      })
      setSession(s)
      setDirty(false)
      toast.ok('Diagnostica salvata')
      return true
    } catch (e) {
      toast.error(errMsg(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  const exportPdf = async () => {
    if ((dirty || !session?.savedAt) && !(await save())) return
    try {
      const r = await api.invoke('diagnostic:pdf', repairId, phase)
      if (r.ok) toast.ok(`Report salvato: ${r.path}`)
      else toast.error(r.message)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const resetHeader = async () => {
    setHeader(headerFromSettings(await api.invoke('settings:get')))
    setDirty(true)
  }
  const headerAsDefault = async () => {
    if (!header) return
    try {
      const lab = await api.invoke('settings:get')
      const { logoDataUrl: _logo, ...rest } = lab
      await api.invoke('settings:save', {
        ...rest,
        name: header.labName,
        address: header.address,
        phone: header.phone,
        email: header.email,
        vat: header.vat,
        technician: header.technician
      })
      toast.ok('Salvati come dati predefiniti per i prossimi report')
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useHotkeys(useMemo(() => [{ combo: 'ctrl+s', handler: () => void saveRef.current(), allowInInputs: true }], []))

  if (!session || !repair) {
    return (
      <div className="flex items-center gap-2 pt-10 text-ink-400">
        <Loader2 className="size-5 animate-spin" /> Caricamento…
      </div>
    )
  }

  return (
    <>
      <Link
        to={`/repairs/${repairId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-signal"
      >
        <ArrowLeft className="size-4" /> {repair.ticketNumber}
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Diagnostica {phase === 'pre' ? 'in accettazione' : 'alla riconsegna'}
          </h1>
          <p className="mt-1 text-sm text-ink-300">
            {repair.deviceLabel} · {repair.customerName}
            {session.savedAt && ` · salvata ${formatDateTime(session.savedAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-ink-700 bg-ink-800 p-0.5 text-sm">
            {(['pre', 'post'] as const).map((p) => (
              <button
                key={p}
                onClick={() => navigate(`/repairs/${repairId}/diagnostic/${p}`, { replace: true })}
                className={clsx(
                  'rounded-md px-3 py-1',
                  phase === p ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                )}
              >
                {p === 'pre' ? 'Pre' : 'Post'}
              </button>
            ))}
          </div>
          <button className="btn-ghost" onClick={() => void save()} disabled={saving}>
            <Save className="size-4" /> Salva <span className="kbd">Ctrl S</span>
          </button>
          <button className="btn-primary" onClick={() => void exportPdf()} disabled={saving}>
            <FileDown className="size-4" /> Report PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <div className="panel flex flex-wrap items-center gap-3 p-4">
            {live ? (
              <button className="btn-primary" onClick={prefill}>
                <Wand2 className="size-4" /> Precompila dal telefono collegato
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-ink-400">
                <Usb className="size-4" /> Collega il telefono per precompilare i controlli automatici
              </span>
            )}
            <button className="btn-ghost" onClick={allOk} disabled={counts.pending === 0}>
              <CheckCheck className="size-4" /> Segna i restanti come funzionanti
            </button>
            <div className="ml-auto flex gap-3 font-mono text-xs">
              <span className="text-ok">{counts.ok} ok</span>
              <span className="text-bad">{counts.faulty} difettosi</span>
              <span className="text-ink-300">{counts.not_testable} n/t</span>
              <span className="text-warn">{counts.pending} da fare</span>
            </div>
          </div>

          {categories.map((cat) => (
            <section key={cat} className="panel overflow-hidden">
              <h2 className="label border-b border-ink-700 px-5 py-2.5">{cat}</h2>
              {session.tests
                .filter((t) => t.category === cat)
                .map((t) => {
                  const r = rows[t.id]
                  return (
                    <div
                      key={t.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-ink-700/50 px-5 py-3 last:border-0 lg:grid-cols-[1fr_auto_240px]"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        {t.label}
                        {t.autoSource && <Usb className="size-3.5 text-ink-400" aria-label="precompilabile via USB" />}
                      </div>
                      <div className="flex gap-1">
                        {CHOICES.map((c) => (
                          <button
                            key={c.value}
                            onClick={() => setRow(t.id, { result: r.result === c.value ? 'pending' : c.value })}
                            className={clsx(
                              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                              r.result === c.value ? c.tone : 'border-ink-700 text-ink-400 hover:text-ink-100'
                            )}
                          >
                            {DIAGNOSTIC_RESULT_LABEL[c.value]}
                          </button>
                        ))}
                      </div>
                      <input
                        className="field col-span-2 py-1 text-sm lg:col-span-1"
                        placeholder="Nota"
                        value={r.note}
                        onChange={(e) => setRow(t.id, { note: e.target.value })}
                      />
                    </div>
                  )
                })}
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-5 xl:self-start">
          {header && (
            <section className="panel p-5">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-display text-[15px] font-semibold">Intestazione del report</h2>
                <button
                  className="text-xs text-ink-400 hover:text-signal"
                  onClick={() => void resetHeader()}
                  title="Ricarica i dati dalle Impostazioni"
                >
                  <RotateCcw className="inline size-3.5" /> Predefiniti
                </button>
              </div>
              <p className="mb-3 text-xs text-ink-400">
                A sinistra c’è sempre DanfixMate; questi dati vanno a destra. Le modifiche valgono per questo report.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {HEADER_FIELDS.map(([k, label, span]) => (
                  <label key={k} className={clsx('flex flex-col gap-1', span && 'col-span-2')}>
                    <span className="label">{label}</span>
                    <input
                      className="field py-1.5 text-sm"
                      value={header[k]}
                      onChange={(e) => {
                        setHeader({ ...header, [k]: e.target.value })
                        setDirty(true)
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                className="btn mt-3 px-2 py-1 text-xs text-ink-300 hover:text-ink-100"
                onClick={() => void headerAsDefault()}
              >
                <Save className="size-3.5" /> Usa come predefiniti per i prossimi report
              </button>
            </section>
          )}
          <section className="panel p-5">
            <h2 className="mb-3 font-display text-[15px] font-semibold">Note del tecnico</h2>
            <textarea
              rows={5}
              className="field resize-none"
              value={notes}
              onChange={(e) => (setNotes(e.target.value), setDirty(true))}
              placeholder={phase === 'pre' ? 'Stato del telefono all’arrivo…' : 'Lavoro svolto, consigli al cliente…'}
            />
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 font-display text-[15px] font-semibold">Firma del cliente</h2>
            <SignaturePad
              key={`${repairId}-${phase}-${session.savedAt ?? 'new'}`}
              value={signature}
              onChange={(s) => (setSignature(s), setDirty(true))}
            />
          </section>
          {session.pdfPath && (
            <button
              className="btn-ghost justify-start text-xs"
              onClick={() => void api.invoke('shell:openPath', session.pdfPath!)}
              title={session.pdfPath}
            >
              <FileDown className="size-4" /> Apri l’ultimo report generato
            </button>
          )}
        </aside>
      </div>
    </>
  )
}
