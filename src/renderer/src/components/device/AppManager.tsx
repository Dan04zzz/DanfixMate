import clsx from 'clsx'
import {
  AlertTriangle,
  Ban,
  CircleStop,
  Eraser,
  FileDown,
  Loader2,
  PackagePlus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppAction, AppDetails, AppEntry, AppFilter } from '@shared/types'
import { act, api, errMsg, formatDate } from '../../lib/api'
import { toast } from '../../store/toast'
import { ConfirmButton } from '../ConfirmButton'

const FILTERS: { id: AppFilter; label: string }[] = [
  { id: 'user', label: 'Installate' },
  { id: 'system', label: 'Di sistema' },
  { id: 'disabled', label: 'Disattivate' },
  { id: 'removed', label: 'Rimosse' }
]

const STORES: Record<string, string> = {
  'com.android.vending': 'Play Store',
  'com.sec.android.app.samsungapps': 'Galaxy Store',
  'com.huawei.appmarket': 'AppGallery',
  'com.xiaomi.market': 'GetApps',
  'com.xiaomi.mipicks': 'GetApps',
  'com.amazon.venezia': 'Amazon',
  'com.heytap.market': 'App Market',
  'com.oppo.market': 'App Market'
}
const SIDELOAD = new Set(['com.google.android.packageinstaller', 'com.android.packageinstaller', 'com.android.shell'])

/** Origine dell'installazione: le app installate a mano sono le prime da controllare per malware. */
function origin(a: AppEntry): { label: string; risky: boolean } {
  if (a.installer && STORES[a.installer]) return { label: STORES[a.installer], risky: false }
  if (a.system) return { label: 'Di sistema', risky: false }
  if (!a.installer || SIDELOAD.has(a.installer)) return { label: 'Installata manualmente', risky: true }
  return { label: a.installer, risky: false }
}

const SENSITIVE: Record<string, string> = {
  'android.permission.READ_SMS': 'Legge gli SMS',
  'android.permission.RECEIVE_SMS': 'Riceve SMS',
  'android.permission.SEND_SMS': 'Invia SMS',
  'android.permission.READ_CALL_LOG': 'Registro chiamate',
  'android.permission.READ_CONTACTS': 'Contatti',
  'android.permission.RECORD_AUDIO': 'Microfono',
  'android.permission.CAMERA': 'Fotocamera',
  'android.permission.ACCESS_FINE_LOCATION': 'Posizione precisa',
  'android.permission.ACCESS_BACKGROUND_LOCATION': 'Posizione in background',
  'android.permission.SYSTEM_ALERT_WINDOW': 'Sovrapposizione ad altre app',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'Installa altre app',
  'android.permission.READ_PHONE_STATE': 'Stato telefono',
  'android.permission.QUERY_ALL_PACKAGES': 'Vede tutte le app',
  'android.permission.MANAGE_EXTERNAL_STORAGE': 'Accesso a tutti i file'
}

export function AppManager({ serial }: { serial: string }) {
  const [filter, setFilter] = useState<AppFilter>('user')
  const [apps, setApps] = useState<AppEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyRisky, setOnlyRisky] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<AppDetails | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setApps(await api.invoke('apps:list', serial, filter))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [serial, filter])

  useEffect(() => {
    setSelected(null)
    void load()
  }, [load])

  useEffect(() => {
    setDetails(null)
    if (!selected) return
    let alive = true
    api
      .invoke('apps:details', serial, selected)
      .then((d) => alive && setDetails(d))
      .catch((e) => toast.error(errMsg(e)))
    return () => {
      alive = false
    }
  }, [serial, selected])

  // al termine di un'installazione ricarica l'elenco
  useEffect(() => {
    const onDone = (ev: Event) => {
      const j = (ev as CustomEvent).detail as { kind: string; serial: string }
      if (j.kind === 'install' && j.serial === serial) void load()
    }
    window.addEventListener('danfixmate:job-finished', onDone)
    return () => window.removeEventListener('danfixmate:job-finished', onDone)
  }, [serial, load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return apps.filter((a) => (!q || a.packageName.toLowerCase().includes(q)) && (!onlyRisky || origin(a).risky))
  }, [apps, query, onlyRisky])
  const riskyCount = useMemo(() => apps.filter((a) => origin(a).risky).length, [apps])
  const app = apps.find((a) => a.packageName === selected) ?? null

  const run = async (action: AppAction) => {
    if (!app) return
    setBusy(true)
    const r = await act(api.invoke('apps:action', serial, app.packageName, action), toast)
    setBusy(false)
    if (r?.ok && action !== 'force_stop' && action !== 'clear_data') {
      if (action === 'uninstall' || action === 'restore') setSelected(null)
      void load()
    }
  }

  const sensitive = details?.grantedPermissions.filter((p) => SENSITIVE[p]) ?? []

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_400px]">
      <div className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
          <div className="flex rounded-lg border border-ink-700 bg-ink-800 p-0.5 text-sm">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={clsx(
                  'rounded-md px-3 py-1',
                  filter === f.id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
            <input
              className="field py-1.5 pl-9 text-sm"
              placeholder="Cerca pacchetto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filter === 'user' && riskyCount > 0 && (
            <button
              onClick={() => setOnlyRisky(!onlyRisky)}
              className={clsx(
                'btn border py-1.5 text-xs',
                onlyRisky ? 'border-warn/60 bg-warn/10 text-warn' : 'border-ink-700 bg-ink-800 text-ink-300'
              )}
            >
              <ShieldAlert className="size-3.5" /> {riskyCount} installate a mano
            </button>
          )}
          <button className="btn-ghost px-2" title="Aggiorna" onClick={() => void load()}>
            <RefreshCw className={clsx('size-4', loading && 'animate-spin')} />
          </button>
          <button className="btn-primary" onClick={() => void act(api.invoke('apps:install', serial), toast)}>
            <PackagePlus className="size-4" /> Installa APK
          </button>
        </div>

        <div className="max-h-[calc(100vh-320px)] min-h-64 overflow-y-auto">
          {loading && !apps.length && (
            <div className="grid place-items-center py-16 text-ink-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          )}
          {!loading && visible.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-ink-400">Nessuna app</p>
          )}
          {visible.map((a) => {
            const o = origin(a)
            return (
              <button
                key={a.packageName}
                onClick={() => setSelected(a.packageName)}
                className={clsx(
                  'flex w-full items-center gap-3 border-b border-ink-700/40 px-4 py-2 text-left text-sm',
                  selected === a.packageName ? 'bg-signal/10' : 'hover:bg-ink-800/60'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={clsx('block truncate font-mono text-[13px]', a.disabled && 'text-ink-400 line-through')}
                  >
                    {a.packageName}
                  </span>
                  <span className="text-xs text-ink-400">{a.versionCode ? `build ${a.versionCode}` : ''}</span>
                </span>
                {a.disabled && (
                  <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300">disattivata</span>
                )}
                <span
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap',
                    o.risky ? 'bg-warn/10 text-warn' : 'bg-ink-800 text-ink-400'
                  )}
                >
                  {o.label}
                </span>
              </button>
            )
          })}
        </div>
        <div className="border-t border-ink-700 px-4 py-2 text-xs text-ink-400">{visible.length} app</div>
      </div>

      {/* dettaglio */}
      <aside className="xl:sticky xl:top-0 xl:self-start">
        {!app ? (
          <div className="panel grid place-items-center px-6 py-16 text-center text-sm text-ink-400">
            Seleziona un’app per vedere dettagli e azioni
          </div>
        ) : (
          <div className="panel p-5">
            <h3 className="font-mono text-sm break-all">{app.packageName}</h3>
            <p className="mt-1 text-xs text-ink-400">
              {origin(app).label}
              {app.system && ' · app di sistema'}
            </p>

            {details ? (
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-ink-400">Versione</dt>
                <dd className="text-right font-mono">{details.versionName ?? '—'}</dd>
                <dt className="text-ink-400">Installata</dt>
                <dd className="text-right">{formatDate(details.firstInstall)}</dd>
                <dt className="text-ink-400">Aggiornata</dt>
                <dd className="text-right">{formatDate(details.lastUpdate)}</dd>
                <dt className="text-ink-400">Target SDK</dt>
                <dd className="text-right font-mono">{details.targetSdk ?? '—'}</dd>
              </dl>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm text-ink-400">
                <Loader2 className="size-4 animate-spin" /> Leggo i dettagli…
              </div>
            )}

            {sensitive.length > 0 && (
              <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-warn">
                  <AlertTriangle className="size-3.5" /> Permessi sensibili concessi
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sensitive.map((p) => (
                    <span key={p} className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-100">
                      {SENSITIVE[p]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {details && (
              <p className="mt-2 text-xs text-ink-400">
                {details.grantedPermissions.length} permessi concessi in totale
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              {app.removedForUser ? (
                <button className="btn-primary col-span-2" disabled={busy} onClick={() => void run('restore')}>
                  <RotateCcw className="size-4" /> Ripristina app
                </button>
              ) : (
                <>
                  <button className="btn-ghost justify-start" disabled={busy} onClick={() => void run('force_stop')}>
                    <CircleStop className="size-4" /> Forza arresto
                  </button>
                  {app.disabled ? (
                    <button className="btn-ghost justify-start" disabled={busy} onClick={() => void run('enable')}>
                      <Power className="size-4" /> Riattiva
                    </button>
                  ) : (
                    <ConfirmButton
                      className="justify-start"
                      disabled={busy}
                      icon={<Ban className="size-4" />}
                      label="Disattiva"
                      onConfirm={() => void run('disable')}
                    />
                  )}
                  <ConfirmButton
                    danger
                    className="justify-start"
                    disabled={busy}
                    icon={<Eraser className="size-4" />}
                    label="Cancella dati"
                    confirmLabel="Cancella tutto?"
                    onConfirm={() => void run('clear_data')}
                  />
                  <button
                    className="btn-ghost justify-start"
                    disabled={busy}
                    onClick={() => void act(api.invoke('apps:extract', serial, app.packageName), toast)}
                  >
                    <FileDown className="size-4" /> Estrai APK
                  </button>
                  <ConfirmButton
                    danger
                    className="col-span-2"
                    disabled={busy}
                    icon={<Trash2 className="size-4" />}
                    label={app.system ? 'Rimuovi per l’utente' : 'Disinstalla'}
                    confirmLabel={app.system ? 'Rimuovere? (ripristinabile)' : 'Disinstallare definitivamente?'}
                    onConfirm={() => void run('uninstall')}
                  />
                </>
              )}
            </div>
            {app.system && !app.removedForUser && (
              <p className="mt-3 text-xs text-ink-400">
                Le app di sistema non vengono cancellate dal telefono: si rimuovono solo per l’utente e si possono
                ripristinare dalla scheda “Rimosse”. Prima di togliere app di sistema verifica che non servano
                all’avvio.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
