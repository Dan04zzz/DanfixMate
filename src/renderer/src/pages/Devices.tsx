import clsx from 'clsx'
import { Plug, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { DeviceCard } from '../components/DeviceCard'
import { PageHeader } from '../components/PageHeader'
import { ToolsBanner } from '../components/ToolsBanner'
import { useHotkeys } from '../hooks/useHotkeys'
import { useDevices } from '../store/devices'

export function Devices() {
  const { devices, tools, refresh, refreshing } = useDevices()
  useHotkeys(useMemo(() => [{ combo: 'f5', handler: () => void refresh() }], [refresh]))

  return (
    <>
      <PageHeader
        title="Dispositivi USB"
        subtitle={
          <>
            adb {tools?.adb.version ?? (tools?.adb.available ? '' : 'non trovato')}
            {' · '}scrcpy {tools?.scrcpy.available ? 'ok' : 'non trovato'}
            {' · '}iOS {tools?.libimobiledevice.available ? 'ok' : 'non attivo'}
          </>
        }
        actions={
          <button className="btn-ghost" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={clsx('size-4', refreshing && 'animate-spin')} /> Aggiorna
            <span className="kbd">F5</span>
          </button>
        }
      />
      <ToolsBanner />
      {devices.length === 0 ? (
        <div className="panel grid place-items-center gap-3 border-dashed px-6 py-20 text-center">
          <Plug className="size-10 text-ink-400" />
          <div className="text-lg font-medium">In attesa di un dispositivo…</div>
          <ol className="max-w-md list-decimal space-y-1 pl-5 text-left text-sm text-ink-400">
            <li>Android: Impostazioni → Info telefono → tocca 7 volte “Numero build”.</li>
            <li>Opzioni sviluppatore → attiva “Debug USB”.</li>
            <li>Collega il cavo e accetta l’impronta RSA sul telefono.</li>
          </ol>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          {devices.map((d) => (
            <DeviceCard key={d.serial} device={d} />
          ))}
        </div>
      )}
    </>
  )
}
