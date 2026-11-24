import clsx from 'clsx'
import { Apple, ArrowLeft, DownloadCloud, FolderTree, Package, Plug, Smartphone } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppManager } from '../components/device/AppManager'
import { BackupPanel } from '../components/device/BackupPanel'
import { FileBrowser } from '../components/device/FileBrowser'
import { useDevices } from '../store/devices'

const TABS = [
  { id: 'files', label: 'File', icon: FolderTree },
  { id: 'apps', label: 'App', icon: Package },
  { id: 'backup', label: 'Backup dati', icon: DownloadCloud }
] as const
type TabId = (typeof TABS)[number]['id']

export function DeviceWorkspace() {
  const { serial = '', tab = 'files' } = useParams()
  const navigate = useNavigate()
  const device = useDevices((s) => s.devices.find((d) => d.serial === serial))
  const active = (TABS.some((t) => t.id === tab) ? tab : 'files') as TabId

  const title = device ? device.marketName || [device.brand, device.model].filter(Boolean).join(' ') || serial : serial

  return (
    <>
      <Link to="/devices" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-signal">
        <ArrowLeft className="size-4" /> Dispositivi USB
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-ink-800 ring-1 ring-ink-700">
            {device?.platform === 'ios' ? <Apple className="size-5" /> : <Smartphone className="size-5 text-ok" />}
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-ink-300">
              {device
                ? [device.osVersion, device.hardwareSerial ?? serial].filter(Boolean).join(' · ')
                : 'Non collegato'}
            </p>
          </div>
        </div>
        <div className="flex rounded-xl border border-ink-700 bg-ink-850 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/devices/${encodeURIComponent(serial)}/${t.id}`, { replace: true })}
              className={clsx(
                'btn px-4',
                active === t.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'
              )}
            >
              <t.icon className={clsx('size-4', active === t.id && 'text-signal')} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!device || device.state !== 'device' ? (
        <div className="panel grid place-items-center gap-3 border-dashed px-6 py-20 text-center">
          <Plug className="size-9 text-ink-400" />
          <div className="text-lg font-medium">
            {device?.state === 'unauthorized' ? 'Autorizza il Debug USB sul telefono' : 'Dispositivo non collegato'}
          </div>
          <p className="max-w-sm text-sm text-ink-400">Ricollega il telefono: la pagina si aggiorna da sola.</p>
        </div>
      ) : device.platform === 'ios' ? (
        <div className="panel grid place-items-center gap-3 px-6 py-20 text-center">
          <Apple className="size-9 text-ink-400" />
          <div className="text-lg font-medium">File, app e backup per iPhone non sono ancora disponibili</div>
          <p className="max-w-md text-sm text-ink-400">
            Queste funzioni usano adb e valgono per Android. Per iPhone il backup completo passa da idevicebackup2: è
            previsto nella prossima fase.
          </p>
        </div>
      ) : active === 'files' ? (
        <FileBrowser key={serial} serial={serial} />
      ) : active === 'apps' ? (
        <AppManager key={serial} serial={serial} />
      ) : (
        <BackupPanel key={serial} device={device} />
      )}
    </>
  )
}
