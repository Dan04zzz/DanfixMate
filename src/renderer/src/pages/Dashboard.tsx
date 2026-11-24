import clsx from 'clsx'
import { ArrowRight, CircleDollarSign, Hourglass, PackageCheck, Plug, TrendingUp, Wrench } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatCents } from '@shared/money'
import { REPAIR_STATUSES, REPAIR_STATUS_LABEL, type DashboardStats, type RepairListItem } from '@shared/types'
import { DeviceCard } from '../components/DeviceCard'
import { PageHeader } from '../components/PageHeader'
import { STATUS_DOT, StatusPill } from '../components/StatusPill'
import { ToolsBanner } from '../components/ToolsBanner'
import { api, formatDateTime } from '../lib/api'
import { useDevices } from '../store/devices'

function Tile({
  icon,
  label,
  value,
  hint,
  accent
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: ReactNode
  accent?: boolean
}) {
  return (
    <div className={clsx('panel p-5', accent && 'border-signal/30')}>
      <div className="label flex items-center gap-2">
        {icon}
        {label}
      </div>
      <div className={clsx('mt-3 font-display text-3xl font-semibold tabular-nums', accent && 'text-signal')}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
    </div>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const devices = useDevices((s) => s.devices)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recent, setRecent] = useState<RepairListItem[]>([])

  useEffect(() => {
    void api.invoke('dashboard:stats').then(setStats)
    void api
      .invoke('repairs:list')
      .then((list) => setRecent([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)))
  }, [])

  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
  const maxCol = stats ? Math.max(1, ...REPAIR_STATUSES.map((s) => stats.byStatus[s])) : 1

  return (
    <>
      <PageHeader title="Mission Control" subtitle={<span className="capitalize">{today}</span>} />
      <ToolsBanner />

      <section className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Tile
          icon={<Wrench className="size-3.5" />}
          label="Riparazioni aperte"
          value={stats?.openRepairs ?? '—'}
          accent
        />
        <Tile
          icon={<PackageCheck className="size-3.5" />}
          label="Pronte al ritiro"
          value={stats?.readyForPickup ?? '—'}
          hint="Da notificare al cliente"
        />
        <Tile
          icon={<CircleDollarSign className="size-3.5" />}
          label="Incasso del mese"
          value={stats ? formatCents(stats.revenueThisMonthCents) : '—'}
          hint={stats ? `${stats.deliveredThisMonth} consegne` : undefined}
        />
        <Tile
          icon={<TrendingUp className="size-3.5" />}
          label="Margine del mese"
          value={stats ? formatCents(stats.marginThisMonthCents) : '—'}
          hint={
            stats?.waitingCustomer ? (
              <span className="inline-flex items-center gap-1 text-warn">
                <Hourglass className="size-3" /> {stats.waitingCustomer} in attesa del cliente
              </span>
            ) : (
              'Preventivo − costi esterni − manodopera'
            )
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
        {/* Dispositivi live */}
        <div className="2xl:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label">Banco USB · live</h2>
            <Link to="/devices" className="text-xs text-ink-300 hover:text-signal">
              Tutti i dispositivi →
            </Link>
          </div>
          {devices.length === 0 ? (
            <div className="panel grid place-items-center gap-3 border-dashed px-6 py-14 text-center">
              <Plug className="size-8 text-ink-400" />
              <div className="font-medium">Nessun dispositivo collegato</div>
              <p className="max-w-sm text-sm text-ink-400">
                Collega un telefono via USB con il Debug USB attivo: la scheda apparirà qui in automatico.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {devices.slice(0, 2).map((d) => (
                <DeviceCard key={d.serial} device={d} />
              ))}
            </div>
          )}
        </div>

        {/* Pipeline + recenti */}
        <div className="flex flex-col gap-6 2xl:col-span-2">
          <div className="panel p-5">
            <h2 className="label mb-4">Pipeline</h2>
            <div className="flex flex-col gap-2.5">
              {REPAIR_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => navigate(`/repairs?status=${s}`)}
                  className="group grid grid-cols-[140px_1fr_32px] items-center gap-3 text-left text-sm"
                >
                  <span className="flex items-center gap-2 text-ink-300 group-hover:text-ink-100">
                    <span className={clsx('size-2 rounded-full', STATUS_DOT[s])} />
                    {REPAIR_STATUS_LABEL[s]}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-ink-800">
                    <span
                      className={clsx('block h-full rounded-full', STATUS_DOT[s])}
                      style={{ width: `${((stats?.byStatus[s] ?? 0) / maxCol) * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-mono tabular-nums">{stats?.byStatus[s] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="flex items-center justify-between p-5 pb-3">
              <h2 className="label">Attività recente</h2>
              <Link to="/repairs" className="text-xs text-ink-300 hover:text-signal">
                Elenco →
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-400">
                Ancora nessuna scheda. Premi <span className="kbd">Ctrl N</span> per crearne una.
              </p>
            ) : (
              <ul className="divide-y divide-ink-700/70">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/repairs/${r.id}`}
                      className="group flex items-center gap-3 px-5 py-3 hover:bg-ink-800/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-ink-400">{r.ticketNumber}</span>
                          <span className="truncate font-medium">{r.deviceLabel}</span>
                        </div>
                        <div className="truncate text-xs text-ink-400">
                          {r.customerName} · {formatDateTime(r.updatedAt)}
                        </div>
                      </div>
                      <StatusPill status={r.status} />
                      <ArrowRight className="size-4 text-ink-600 group-hover:text-signal" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
