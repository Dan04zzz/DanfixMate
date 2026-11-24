import clsx from 'clsx'
import { CalendarClock, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatCents } from '@shared/money'
import { REPAIR_STATUSES, REPAIR_STATUS_LABEL, type RepairListItem, type RepairStatus } from '@shared/types'
import { PageHeader } from '../components/PageHeader'
import { STATUS_DOT } from '../components/StatusPill'
import { api, errMsg } from '../lib/api'
import { toast } from '../store/toast'

const PRIORITY_BAR: Record<RepairListItem['priority'], string> = {
  low: 'bg-ink-600',
  normal: 'bg-transparent',
  high: 'bg-warn',
  urgent: 'bg-bad'
}

/** Consegnati: solo gli ultimi, la colonna serve come archivio rapido */
const DELIVERED_LIMIT = 20

interface DropTarget {
  status: RepairStatus
  index: number
}

export function Board() {
  const navigate = useNavigate()
  const [items, setItems] = useState<RepairListItem[]>([])
  const [search, setSearch] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)

  const load = useCallback(() => void api.invoke('repairs:list', { search }).then(setItems), [search])
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [load])

  const columns = useMemo(() => {
    const by = Object.fromEntries(REPAIR_STATUSES.map((s) => [s, [] as RepairListItem[]])) as Record<
      RepairStatus,
      RepairListItem[]
    >
    for (const r of items) by[r.status].push(r)
    for (const s of REPAIR_STATUSES) by[s].sort((a, b) => a.kanbanOrder - b.kanbanOrder || a.id - b.id)
    by.delivered = by.delivered
      .sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''))
      .slice(0, DELIVERED_LIMIT)
    return by
  }, [items])

  /** Indice di inserimento (escludendo la scheda trascinata) in base alla posizione del mouse. */
  const onCardOver = (e: DragEvent, status: RepairStatus, idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    const col = columns[status].filter((r) => r.id !== dragId)
    const visualIdx = columns[status].slice(0, idx + (after ? 1 : 0)).filter((r) => r.id !== dragId).length
    setDrop({ status, index: Math.min(visualIdx, col.length) })
  }
  const onColumnOver = (e: DragEvent, status: RepairStatus) => {
    e.preventDefault()
    if (drop?.status !== status) setDrop({ status, index: columns[status].filter((r) => r.id !== dragId).length })
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    const id = dragId
    const target = drop
    setDragId(null)
    setDrop(null)
    if (id == null || !target) return
    const card = items.find((r) => r.id === id)
    if (!card) return

    // aggiornamento ottimistico: la scheda si sposta subito
    const siblings = columns[target.status].filter((r) => r.id !== id)
    const before = siblings[target.index - 1]?.kanbanOrder
    const after = siblings[target.index]?.kanbanOrder
    const order =
      before === undefined && after === undefined
        ? 1
        : before === undefined
          ? after! - 1
          : after === undefined
            ? before + 1
            : (before + after) / 2
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: target.status, kanbanOrder: order } : r)))

    try {
      await api.invoke('repairs:move', id, target.status, target.index)
      if (card.status !== target.status) {
        toast.ok(`${card.ticketNumber} → ${REPAIR_STATUS_LABEL[target.status]}`)
        if (target.status === 'ready') toast.info('Ricordati di avvisare il cliente su WhatsApp dalla scheda')
      }
    } catch (err) {
      toast.error(errMsg(err))
    }
    load()
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Bacheca"
        subtitle="Trascina le schede tra le colonne per cambiare stato"
        actions={
          <>
            <div className="relative w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
              <input
                className="field pl-9"
                placeholder="Filtra schede…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="btn-primary" onClick={() => navigate('/repairs/new')}>
              <Plus className="size-4" /> Nuova scheda
            </button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-6 gap-3 pb-2" onDragEnd={() => (setDragId(null), setDrop(null))}>
        {REPAIR_STATUSES.map((status) => {
          const col = columns[status]
          const active = drop?.status === status
          let visible = 0
          return (
            <section
              key={status}
              onDragOver={(e) => onColumnOver(e, status)}
              onDrop={(e) => void onDrop(e)}
              className={clsx(
                'flex min-h-0 min-w-0 flex-col rounded-xl border bg-ink-900/60 transition-colors',
                active ? 'border-signal/50 bg-signal/5' : 'border-ink-700'
              )}
            >
              <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2.5">
                <span className={clsx('size-2 rounded-full', STATUS_DOT[status])} />
                <span className="truncate text-sm font-medium">{REPAIR_STATUS_LABEL[status]}</span>
                <span className="ml-auto rounded-full bg-ink-800 px-2 font-mono text-xs text-ink-300">
                  {col.length}
                </span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {col.map((r, idx) => {
                  const showLine = active && drop.index === visible && r.id !== dragId
                  if (r.id !== dragId) visible++
                  const overdue =
                    r.estimatedReadyAt && r.status !== 'delivered' && r.estimatedReadyAt.slice(0, 10) < today
                  return (
                    <div key={r.id}>
                      {showLine && <div className="mb-2 h-0.5 rounded-full bg-signal" />}
                      <article
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', String(r.id))
                          setDragId(r.id)
                        }}
                        onDragOver={(e) => onCardOver(e, status, idx)}
                        onClick={() => navigate(`/repairs/${r.id}`)}
                        className={clsx(
                          'group relative cursor-grab overflow-hidden rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm shadow-sm transition-all hover:border-ink-600 active:cursor-grabbing',
                          dragId === r.id && 'opacity-40'
                        )}
                      >
                        <span className={clsx('absolute inset-y-0 left-0 w-0.5', PRIORITY_BAR[r.priority])} />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-ink-400">{r.ticketNumber}</span>
                          {r.quoteCents > 0 && (
                            <span className="font-mono text-[11px] text-ink-300">{formatCents(r.quoteCents)}</span>
                          )}
                        </div>
                        <div className="mt-1 truncate font-medium">{r.deviceLabel}</div>
                        <div className="truncate text-xs text-ink-300">{r.customerName}</div>
                        {r.services.length > 0 && (
                          <div
                            className="mt-2 truncate text-xs text-ink-400"
                            title={r.services.map((s) => s.label).join(', ')}
                          >
                            {r.services[0].label}
                            {r.services.length > 1 && ` +${r.services.length - 1}`}
                          </div>
                        )}
                        {r.estimatedReadyAt && r.status !== 'delivered' && (
                          <div
                            className={clsx(
                              'mt-2 inline-flex items-center gap-1 text-[11px]',
                              overdue ? 'text-bad' : 'text-ink-400'
                            )}
                          >
                            <CalendarClock className="size-3" />
                            {new Date(r.estimatedReadyAt).toLocaleDateString('it-IT', {
                              day: '2-digit',
                              month: 'short'
                            })}
                          </div>
                        )}
                      </article>
                    </div>
                  )
                })}
                {active && drop.index >= visible && <div className="h-0.5 rounded-full bg-signal" />}
                {col.length === 0 && !active && (
                  <div className="grid flex-1 place-items-center py-6 text-xs text-ink-600">Vuota</div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
