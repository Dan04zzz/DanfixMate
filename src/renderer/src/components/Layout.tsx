import clsx from 'clsx'
import {
  Columns3,
  DatabaseBackup,
  LayoutDashboard,
  Plus,
  Settings as SettingsIcon,
  Smartphone,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useHotkeys } from '../hooks/useHotkeys'
import { api } from '../lib/api'
import { useDevices } from '../store/devices'
import { toast } from '../store/toast'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  key: string
  soon?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, key: '1' },
  { to: '/devices', label: 'Dispositivi USB', icon: Smartphone, key: '2' },
  { to: '/board', label: 'Bacheca', icon: Columns3, key: '3' },
  { to: '/repairs', label: 'Riparazioni', icon: Wrench, key: '4' },
  { to: '/customers', label: 'Clienti', icon: Users, key: '5' },
  { to: '/settings', label: 'Impostazioni', icon: SettingsIcon, key: '6' }
]

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const devices = useDevices((s) => s.devices)
  const ready = devices.filter((d) => d.state === 'device').length

  const backup = async () => {
    const r = await api.invoke('db:backup')
    if (r.ok) toast.ok(`Backup salvato: ${r.path}`)
    else if (r.message !== 'Backup annullato') toast.error(r.message)
  }

  const hotkeys = useMemo(
    () => [
      { combo: 'ctrl+n', handler: () => navigate('/repairs/new') },
      { combo: 'ctrl+shift+b', handler: () => void backup() },
      ...NAV.filter((n) => !n.soon).map((n) => ({ combo: `ctrl+${n.key}`, handler: () => navigate(n.to) }))
    ],
    [navigate]
  )
  useHotkeys(hotkeys)

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
        <div className="drag flex h-14 items-center gap-2.5 px-5">
          <div className="grid size-7 place-items-center rounded-md bg-signal/15 ring-1 ring-signal/40">
            <Wrench className="size-4 text-signal" strokeWidth={2.5} />
          </div>
          <span className="font-display text-[17px] font-semibold tracking-tight">
            Danfix<span className="text-signal">Mate</span>
          </span>
        </div>

        <div className="px-3 pt-2 pb-4">
          <button onClick={() => navigate('/repairs/new')} className="btn-primary w-full justify-between">
            <span className="flex items-center gap-2">
              <Plus className="size-4" strokeWidth={2.5} /> Nuova scheda
            </span>
            <span className="font-mono text-[10px] opacity-70">Ctrl N</span>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((n) =>
            n.soon ? (
              <div
                key={n.to}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400/70"
                title="Disponibile in Fase 2"
              >
                <n.icon className="size-4" />
                {n.label}
                <span className="ml-auto rounded bg-ink-800 px-1.5 py-0.5 text-[10px]">Fase 2</span>
              </div>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <n.icon className={clsx('size-4', isActive && 'text-signal')} />
                    {n.label}
                    {n.to === '/devices' && ready > 0 ? (
                      <span className="ml-auto rounded-full bg-signal/15 px-2 text-xs font-semibold text-signal">
                        {ready}
                      </span>
                    ) : (
                      <span className="kbd ml-auto opacity-0 group-hover:opacity-100">^{n.key}</span>
                    )}
                  </>
                )}
              </NavLink>
            )
          )}
        </nav>

        <div className="border-t border-ink-700 p-3">
          <button onClick={() => void backup()} className="btn w-full justify-start text-ink-300 hover:bg-ink-850">
            <DatabaseBackup className="size-4" /> Backup database
            <span className="kbd ml-auto">^⇧B</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* fascia trascinabile sotto i controlli finestra di Windows */}
        <div className="drag h-10 shrink-0" />
        <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">{children}</main>
      </div>
    </div>
  )
}
