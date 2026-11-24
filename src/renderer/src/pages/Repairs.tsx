import clsx from 'clsx'
import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { formatCents } from '@shared/money'
import { REPAIR_STATUSES, REPAIR_STATUS_LABEL, type RepairListItem, type RepairStatus } from '@shared/types'
import { PageHeader } from '../components/PageHeader'
import { STATUS_DOT, StatusPill } from '../components/StatusPill'
import { useHotkeys } from '../hooks/useHotkeys'
import { api, formatDate } from '../lib/api'

export function Repairs() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') as RepairStatus | null) ?? undefined
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<RepairListItem[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useHotkeys(useMemo(() => [{ combo: 'ctrl+k', handler: () => searchRef.current?.focus() }], []))

  useEffect(() => {
    const t = setTimeout(() => void api.invoke('repairs:list', { status, search }).then(setItems), 150)
    return () => clearTimeout(t)
  }, [status, search])

  const setStatus = (s?: RepairStatus) => {
    if (s) params.set('status', s)
    else params.delete('status')
    setParams(params, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Riparazioni"
        subtitle={`${items.length} schede${status ? ` · ${REPAIR_STATUS_LABEL[status]}` : ''}`}
        actions={
          <button className="btn-primary" onClick={() => navigate('/repairs/new')}>
            <Plus className="size-4" /> Nuova scheda
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-96">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <input
            ref={searchRef}
            className="field pl-9"
            placeholder="Cerca ticket, cliente, telefono, modello, IMEI, intervento…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="kbd absolute top-1/2 right-2.5 -translate-y-1/2">Ctrl K</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatus(undefined)}
            className={clsx('btn px-3 py-1.5', !status ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-850')}
          >
            Tutte
          </button>
          {REPAIR_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                'btn px-3 py-1.5',
                status === s ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-850'
              )}
            >
              <span className={clsx('size-1.5 rounded-full', STATUS_DOT[s])} />
              {REPAIR_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[130px_1.4fr_1.2fr_1.6fr_150px_110px_110px] gap-4 border-b border-ink-700 px-5 py-2.5">
          {['Ticket', 'Dispositivo', 'Cliente', 'Interventi', 'Stato', 'Preventivo', 'Margine'].map((h) => (
            <span key={h} className="label">
              {h}
            </span>
          ))}
        </div>
        {items.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink-400">Nessuna scheda trovata.</p>}
        {items.map((r) => (
          <Link
            key={r.id}
            to={`/repairs/${r.id}`}
            className="grid grid-cols-[130px_1.4fr_1.2fr_1.6fr_150px_110px_110px] items-center gap-4 border-b border-ink-700/60 px-5 py-3 text-sm last:border-0 hover:bg-ink-800/60"
          >
            <span>
              <div className="font-mono text-[13px]">{r.ticketNumber}</div>
              <div className="text-xs text-ink-400">{formatDate(r.createdAt)}</div>
            </span>
            <span className="truncate font-medium">{r.deviceLabel}</span>
            <span className="min-w-0">
              <div className="truncate">{r.customerName}</div>
              <div className="truncate font-mono text-xs text-ink-400">{r.customerPhone ?? ''}</div>
            </span>
            <span className="min-w-0">
              <div className="truncate">{r.services.map((s) => s.label).join(' · ') || '—'}</div>
              <div className="truncate text-xs text-ink-400">{r.reportedIssue}</div>
            </span>
            <span>
              <StatusPill status={r.status} />
            </span>
            <span className="font-mono tabular-nums">{formatCents(r.quoteCents)}</span>
            <span className={clsx('font-mono tabular-nums', r.marginCents < 0 ? 'text-bad' : 'text-ok')}>
              {formatCents(r.marginCents)}
            </span>
          </Link>
        ))}
      </div>
    </>
  )
}
