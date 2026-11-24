import clsx from 'clsx'
import { MessageCircle, Plus, Save, Search, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { formatCents } from '@shared/money'
import type { CustomerWithStats, RepairListItem } from '@shared/types'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { api, errMsg, formatDate, toWhatsAppNumber } from '../lib/api'
import { toast } from '../store/toast'

export function Customers() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const selectedId = Number(params.get('id')) || null
  const [query, setQuery] = useState('')
  const [list, setList] = useState<CustomerWithStats[]>([])
  const [form, setForm] = useState<CustomerWithStats | null>(null)
  const [repairs, setRepairs] = useState<RepairListItem[]>([])
  const [dirty, setDirty] = useState(false)

  const load = useCallback(() => void api.invoke('customers:list', query).then(setList), [query])
  useEffect(() => {
    const t = setTimeout(load, 150)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    const c = list.find((x) => x.id === selectedId) ?? null
    if (c && (!form || form.id !== c.id)) {
      setForm(c)
      setDirty(false)
    }
    if (!selectedId) setForm(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, list])

  useEffect(() => {
    if (!selectedId) return setRepairs([])
    void api.invoke('repairs:list', { customerId: selectedId }).then(setRepairs)
  }, [selectedId])

  const save = async () => {
    if (!form) return
    try {
      await api.invoke('customers:update', {
        id: form.id,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        notes: form.notes
      })
      toast.ok('Cliente aggiornato')
      setDirty(false)
      load()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const set = (k: 'firstName' | 'lastName' | 'phone' | 'email' | 'notes') => (e: { target: { value: string } }) => {
    if (!form) return
    setForm({ ...form, [k]: e.target.value })
    setDirty(true)
  }

  return (
    <>
      <PageHeader
        title="Clienti"
        subtitle={`${list.length} clienti`}
        actions={
          <div className="relative w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            <input
              className="field pl-9"
              placeholder="Nome, telefono o email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1fr_90px_110px_110px] gap-4 border-b border-ink-700 px-5 py-2.5">
            {['Cliente', 'Telefono', 'Schede', 'Ultima', 'Speso'].map((h) => (
              <span key={h} className="label">
                {h}
              </span>
            ))}
          </div>
          {list.length === 0 && <p className="px-5 py-10 text-center text-sm text-ink-400">Nessun cliente.</p>}
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setParams({ id: String(c.id) }, { replace: true })}
              className={clsx(
                'grid w-full grid-cols-[1.4fr_1fr_90px_110px_110px] items-center gap-4 border-b border-ink-700/50 px-5 py-2.5 text-left text-sm last:border-0',
                selectedId === c.id ? 'bg-signal/10' : 'hover:bg-ink-800/60'
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {c.firstName} {c.lastName}
                </span>
                {c.email && <span className="block truncate text-xs text-ink-400">{c.email}</span>}
              </span>
              <span className="truncate font-mono text-xs text-ink-300">{c.phone ?? '—'}</span>
              <span className="font-mono text-xs">
                {c.repairsCount}
                {c.openRepairs > 0 && <span className="text-signal"> · {c.openRepairs} aperte</span>}
              </span>
              <span className="text-xs text-ink-400">{formatDate(c.lastRepairAt)}</span>
              <span className="font-mono text-xs">{formatCents(c.totalSpentCents)}</span>
            </button>
          ))}
        </div>

        <aside className="xl:sticky xl:top-0 xl:self-start">
          {!form ? (
            <div className="panel grid place-items-center gap-2 px-6 py-16 text-center text-sm text-ink-400">
              <User className="size-7" />
              Seleziona un cliente per vederne la scheda
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <section className="panel p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-[15px] font-semibold">Anagrafica</h2>
                  {form.phone && (
                    <button
                      className="btn px-2 py-1 text-xs text-[#25D366] hover:bg-ink-800"
                      onClick={() => window.open(`https://wa.me/${toWhatsAppNumber(form.phone!)}`, '_blank')}
                    >
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="label">Nome</span>
                    <input className="field" value={form.firstName} onChange={set('firstName')} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="label">Cognome</span>
                    <input className="field" value={form.lastName} onChange={set('lastName')} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="label">Telefono</span>
                    <input className="field font-mono" value={form.phone ?? ''} onChange={set('phone')} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="label">Email</span>
                    <input className="field" value={form.email ?? ''} onChange={set('email')} />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1.5">
                    <span className="label">Note</span>
                    <textarea rows={3} className="field resize-none" value={form.notes ?? ''} onChange={set('notes')} />
                  </label>
                </div>
                <button className="btn-primary mt-4" disabled={!dirty} onClick={() => void save()}>
                  <Save className="size-4" /> Salva
                </button>
              </section>

              <section className="panel">
                <div className="flex items-center justify-between p-5 pb-3">
                  <h2 className="font-display text-[15px] font-semibold">Schede</h2>
                  <button className="btn-ghost py-1 text-xs" onClick={() => navigate('/repairs/new')}>
                    <Plus className="size-3.5" /> Nuova
                  </button>
                </div>
                {repairs.length === 0 ? (
                  <p className="px-5 pb-5 text-sm text-ink-400">Nessuna scheda.</p>
                ) : (
                  <ul className="divide-y divide-ink-700/60">
                    {repairs.map((r) => (
                      <li key={r.id}>
                        <Link
                          to={`/repairs/${r.id}`}
                          className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-ink-800/60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{r.deviceLabel}</span>
                            <span className="font-mono text-xs text-ink-400">
                              {r.ticketNumber} · {formatDate(r.createdAt)}
                            </span>
                          </span>
                          <StatusPill status={r.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
