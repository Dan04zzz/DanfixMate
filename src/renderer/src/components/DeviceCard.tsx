import clsx from 'clsx'
import {
  Apple,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Cast,
  ClipboardPlus,
  Copy,
  Cpu,
  DownloadCloud,
  FolderTree,
  HardDrive,
  Package,
  Power,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Thermometer
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LiveDevice, RebootMode, SoftwareInfo } from '@shared/types'
import { api, formatBytes } from '../lib/api'
import { ConfirmButton } from './ConfirmButton'
import { toast } from '../store/toast'

const STATE_INFO: Record<LiveDevice['state'], { label: string; tone: string }> = {
  device: { label: 'Connesso', tone: 'text-ok border-ok/30 bg-ok/10' },
  unauthorized: { label: 'Non autorizzato', tone: 'text-warn border-warn/30 bg-warn/10' },
  offline: { label: 'Offline', tone: 'text-bad border-bad/30 bg-bad/10' },
  recovery: { label: 'Recovery', tone: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  sideload: { label: 'Sideload', tone: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  bootloader: { label: 'Fastboot', tone: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  unknown: { label: 'Sconosciuto', tone: 'text-ink-300 border-ink-600 bg-ink-800' }
}

function Meter({ value, tone }: { value: number | null; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={clsx('h-full rounded-full transition-all', tone)} style={{ width: `${value ?? 0}%` }} />
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral'
const TONE: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-ink-300'
}

/** Riga "etichetta → valore colorato" per lo stato software */
function SwItem({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-800/60 px-3 py-2 text-sm">
      <span className="text-ink-300">{label}</span>
      <span className={clsx('font-medium', TONE[tone])}>{value}</span>
    </div>
  )
}

function softwareRows(sw: SoftwareInfo, isAndroid: boolean): { label: string; value: string; tone: Tone }[] {
  const rows: { label: string; value: string; tone: Tone }[] = []
  const yesNo = (v: boolean | null, yes: string, no: string, goodWhen: boolean) =>
    v === null
      ? { value: 'Non rilevabile', tone: 'neutral' as Tone }
      : { value: v ? yes : no, tone: (v === goodWhen ? 'ok' : 'warn') as Tone }

  if (isAndroid) {
    rows.push({ label: 'Bootloader', ...yesNo(sw.bootloaderLocked, 'Bloccato', 'Sbloccato', true) })
    const vb = {
      green: { value: 'Integro (green)', tone: 'ok' as Tone },
      yellow: { value: 'Chiave custom (yellow)', tone: 'warn' as Tone },
      orange: { value: 'Non verificato (orange)', tone: 'warn' as Tone },
      red: { value: 'Corrotto (red)', tone: 'bad' as Tone }
    }
    rows.push({
      label: 'Verified boot',
      ...(sw.verifiedBoot ? vb[sw.verifiedBoot] : { value: 'Non rilevabile', tone: 'neutral' })
    })
    rows.push({ label: 'Root', ...yesNo(sw.rooted, 'Rilevato', 'Non rilevato', false) })
    rows.push({
      label: 'Account Google',
      value:
        sw.googleAccounts === null
          ? 'Non rilevabile'
          : sw.googleAccounts === 0
            ? 'Nessuno'
            : `${sw.googleAccounts} presente/i`,
      tone: sw.googleAccounts === null ? 'neutral' : sw.googleAccounts === 0 ? 'ok' : 'warn'
    })
    rows.push({
      label: 'App installate',
      value: sw.thirdPartyApps === null ? '—' : String(sw.thirdPartyApps),
      tone: (sw.thirdPartyApps ?? 0) > 150 ? 'warn' : 'neutral'
    })
  }
  rows.push({ label: 'Crittografia', ...yesNo(sw.encrypted, 'Attiva', 'Non attiva', true) })
  return rows
}

function Stat({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1">{label}</div>
      <div className={clsx('truncate text-sm', mono && 'font-mono text-[13px]')}>{children}</div>
    </div>
  )
}

function CopyValue({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-400">Non leggibile</span>
  return (
    <button
      className="group inline-flex max-w-full items-center gap-1.5 hover:text-signal"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        toast.info('Copiato negli appunti')
      }}
      title="Copia"
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
    </button>
  )
}

export function DeviceCard({ device, compact = false }: { device: LiveDevice; compact?: boolean }) {
  const navigate = useNavigate()
  const ready = device.state === 'device'
  const isAndroid = device.platform === 'android'
  const st = STATE_INFO[device.state]
  const b = device.battery
  const s = device.storage
  const usedPct = s?.totalBytes && s.usedBytes != null ? Math.round((s.usedBytes / s.totalBytes) * 100) : null

  const BatteryIcon =
    b?.status === 'In carica'
      ? BatteryCharging
      : (b?.level ?? 0) > 60
        ? BatteryFull
        : (b?.level ?? 0) > 25
          ? BatteryMedium
          : BatteryLow

  const reboot = async (mode: RebootMode) => {
    const r = await api.invoke('devices:reboot', device.serial, mode)
    r.ok ? toast.ok(r.message) : toast.error(r.message)
  }
  const mirror = async () => {
    const r = await api.invoke('devices:mirror', device.serial)
    r.ok ? toast.ok(r.message) : toast.error(r.message)
  }

  const title = device.marketName || [device.brand, device.model].filter(Boolean).join(' ') || device.serial

  return (
    <article className={clsx('panel relative overflow-hidden', ready && 'border-signal/25')}>
      {ready && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal to-transparent" />
      )}

      <header className="flex items-start gap-4 p-5 pb-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-ink-800 ring-1 ring-ink-700">
          {isAndroid ? <Smartphone className="size-6 text-ok" /> : <Apple className="size-6 text-ink-100" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {ready && <span className="live-dot size-2 rounded-full bg-signal" />}
            <h3 className="truncate font-display text-lg font-semibold">{title}</h3>
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-300">
            {[device.brand, device.model, device.osVersion].filter(Boolean).join(' · ') || 'Lettura in corso…'}
          </p>
        </div>
        <span className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', st.tone)}>{st.label}</span>
      </header>

      {device.state === 'unauthorized' && (
        <div className="mx-5 mb-4 flex gap-3 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
          <ShieldAlert className="size-5 shrink-0" />
          {isAndroid
            ? 'Sblocca il telefono e accetta "Consenti debug USB" (spunta "Consenti sempre da questo computer").'
            : 'Sblocca l’iPhone e tocca "Autorizza" sul popup "Vuoi autorizzare questo computer?".'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-ink-700 px-5 py-4 xl:grid-cols-4">
        <Stat label="Seriale" mono>
          <CopyValue value={device.hardwareSerial ?? device.serial} />
        </Stat>
        <Stat label="IMEI" mono>
          <CopyValue value={device.imei} />
        </Stat>
        <Stat label={isAndroid ? 'Debug USB' : 'Trust'}>
          <span className={clsx('inline-flex items-center gap-1.5', ready ? 'text-ok' : 'text-warn')}>
            {ready ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
            {ready ? 'Autorizzato' : 'In attesa'}
          </span>
        </Stat>
        <Stat label="Patch sicurezza">{device.securityPatch ?? '—'}</Stat>

        <div className="col-span-2">
          <div className="label mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <BatteryIcon className="size-3.5" /> Batteria
            </span>
            <span className="font-mono text-ink-100 normal-case tracking-normal">
              {b?.level != null ? `${b.level}%` : '—'}
            </span>
          </div>
          <Meter
            value={b?.level ?? null}
            tone={(b?.level ?? 0) > 50 ? 'bg-ok' : (b?.level ?? 0) > 20 ? 'bg-warn' : 'bg-bad'}
          />
          <div className="mt-1.5 flex gap-4 text-xs text-ink-300">
            <span>Salute: {b?.health ?? '—'}</span>
            {b?.temperatureC != null && (
              <span className="inline-flex items-center gap-1">
                <Thermometer className="size-3" />
                {b.temperatureC.toFixed(1)}°C
              </span>
            )}
            {b?.cycleCount != null && <span>Cicli: {b.cycleCount}</span>}
            {b?.status && <span className="ml-auto">{b.status}</span>}
          </div>
        </div>

        <div className="col-span-2">
          <div className="label mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <HardDrive className="size-3.5" /> Archiviazione
            </span>
            <span className="font-mono text-ink-100 normal-case tracking-normal">
              {s ? `${formatBytes(s.usedBytes)} / ${formatBytes(s.totalBytes)}` : '—'}
            </span>
          </div>
          <Meter value={usedPct} tone={(usedPct ?? 0) > 90 ? 'bg-bad' : 'bg-volt'} />
          <div className="mt-1.5 text-xs text-ink-300">Libero: {formatBytes(s?.freeBytes)}</div>
        </div>
      </div>

      {device.software && (
        <div className="border-t border-ink-700 px-5 py-4">
          <div className="label mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3.5" /> Stato software
            </span>
            {device.software.buildNumber && (
              <span className="truncate pl-4 font-mono normal-case tracking-normal text-ink-400">
                {device.software.buildNumber}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {softwareRows(device.software, isAndroid).map((r) => (
              <SwItem key={r.label} {...r} />
            ))}
          </div>
          {(device.software.googleAccounts ?? 0) > 0 && (
            <div className="mt-3 flex gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
              <ShieldAlert className="size-4 shrink-0" />
              Account Google presente: dopo un reset o un flash servirà la password del proprietario (protezione FRP).
              Prima di intervenire fai rimuovere l’account al cliente o verifica che ricordi le credenziali.
            </div>
          )}
        </div>
      )}

      {!compact && (
        <footer className="border-t border-ink-700 bg-ink-900/50 p-4">
          <div className="label mb-2.5">1-Click Toolbox</div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <ConfirmButton
              className="justify-start"
              icon={<Power className="size-4" />}
              label="Riavvia"
              disabled={!ready || !isAndroid}
              onConfirm={() => void reboot('system')}
            />
            <button className="btn-ghost justify-start" disabled={!ready || !isAndroid} onClick={() => void mirror()}>
              <Cast className="size-4" /> Mirroring
            </button>
            <button
              className="btn-ghost justify-start"
              disabled={!ready || !isAndroid}
              onClick={() => navigate(`/devices/${encodeURIComponent(device.serial)}/backup`)}
            >
              <DownloadCloud className="size-4" /> Backup dati
            </button>
            <button
              className="btn-ghost justify-start"
              disabled={!ready || !isAndroid}
              onClick={() => navigate(`/devices/${encodeURIComponent(device.serial)}/apps`)}
            >
              <Package className="size-4" /> Gestione app
            </button>
            <button
              className="btn-ghost justify-start"
              disabled={!ready || !isAndroid}
              onClick={() => navigate(`/devices/${encodeURIComponent(device.serial)}/files`)}
            >
              <FolderTree className="size-4" /> Gestione file
            </button>
            <button
              className="btn-primary justify-start"
              onClick={() => navigate(`/repairs/new?serial=${encodeURIComponent(device.serial)}`)}
            >
              <ClipboardPlus className="size-4" /> Crea scheda
            </button>
          </div>
        </footer>
      )}
    </article>
  )
}
