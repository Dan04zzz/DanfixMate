import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ActionResult, LiveDevice, RebootMode } from '@shared/types'
import { run } from './exec'
import {
  parseBattery,
  parseDeviceList,
  parseDf,
  parseGetprop,
  parseImeiParcel,
  parseSoftware,
  splitTrackFrames,
  type AdbListEntry
} from './adb-parsers'

const DETAIL_REFRESH_MS = 15_000

/**
 * Monitor Android via `adb track-devices -l`:
 * - il server adb notifica ogni cambio (collegato/scollegato/autorizzato) senza polling;
 * - per ogni dispositivo autorizzato leggiamo getprop + batteria + storage;
 * - batteria e storage vengono aggiornati ogni 15s finché il telefono resta collegato.
 */
export class AdbService extends EventEmitter {
  private tracker: ChildProcess | null = null
  private devices = new Map<string, LiveDevice>()
  private refreshTimer: NodeJS.Timeout | null = null
  private restartDelay = 1000
  private stopped = false

  constructor(readonly adbPath: string) {
    super()
  }

  async start(): Promise<void> {
    this.stopped = false
    await run(this.adbPath, ['start-server'], 15_000)
    this.spawnTracker()
    this.refreshTimer = setInterval(() => void this.refreshDetails(), DETAIL_REFRESH_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.tracker?.kill()
    this.tracker = null
  }

  list(): LiveDevice[] {
    return [...this.devices.values()]
  }

  get(serial: string): LiveDevice | undefined {
    return this.devices.get(serial)
  }

  /** Rilettura completa forzata (pulsante "Aggiorna"). */
  async forceRefresh(): Promise<LiveDevice[]> {
    const r = await run(this.adbPath, ['devices', '-l'])
    await this.applyList(parseDeviceList(r.stdout))
    await this.refreshDetails(true)
    return this.list()
  }

  // ---------- tracking ----------

  private spawnTracker(): void {
    if (this.stopped) return
    const child = spawn(this.adbPath, ['track-devices', '-l'], { windowsHide: true })
    this.tracker = child
    let buffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.restartDelay = 1000
      const { frames, rest } = splitTrackFrames(buffer + chunk)
      buffer = rest
      const last = frames.at(-1)
      if (last !== undefined) void this.applyList(parseDeviceList(last))
    })
    child.on('error', (err) => this.emit('error', err))
    child.on('exit', () => {
      this.tracker = null
      if (this.stopped) return
      // il server adb può essere riavviato da altri tool (Android Studio…): riprova con backoff
      setTimeout(() => this.spawnTracker(), this.restartDelay)
      this.restartDelay = Math.min(this.restartDelay * 2, 15_000)
    })
  }

  private async applyList(entries: AdbListEntry[]): Promise<void> {
    const seen = new Set<string>()
    let changed = false
    const now = new Date().toISOString()

    for (const e of entries) {
      seen.add(e.serial)
      const prev = this.devices.get(e.serial)
      if (!prev) {
        this.devices.set(e.serial, this.skeleton(e, now))
        changed = true
      } else if (prev.state !== e.state) {
        prev.state = e.state
        prev.debugEnabled = e.state === 'device' || e.state === 'unauthorized'
        prev.lastUpdate = now
        changed = true
      }
    }
    for (const serial of [...this.devices.keys()]) {
      if (!seen.has(serial)) {
        this.devices.delete(serial)
        changed = true
      }
    }
    if (changed) this.emitChange()

    // Arricchisci in parallelo i dispositivi autorizzati non ancora letti
    const toEnrich = [...this.devices.values()].filter((d) => d.state === 'device' && !d.osVersion)
    await Promise.all(toEnrich.map((d) => this.enrich(d.serial)))
  }

  private skeleton(e: AdbListEntry, now: string): LiveDevice {
    return {
      serial: e.serial,
      platform: 'android',
      state: e.state,
      transport: e.transport,
      brand: null,
      manufacturer: null,
      model: e.props.model?.replace(/_/g, ' ') ?? null,
      marketName: null,
      osVersion: null,
      sdkLevel: null,
      securityPatch: null,
      hardwareSerial: null,
      imei: null,
      battery: null,
      storage: null,
      software: null,
      debugEnabled: e.state === 'device' || e.state === 'unauthorized',
      connectedAt: now,
      lastUpdate: now
    }
  }

  // ---------- lettura dettagli ----------

  private shell(serial: string, cmd: string, timeoutMs = 6000) {
    return run(this.adbPath, ['-s', serial, 'shell', cmd], timeoutMs)
  }

  private enriching = new Set<string>()

  private async enrich(serial: string): Promise<void> {
    if (this.enriching.has(serial)) return
    this.enriching.add(serial)
    try {
      await this.enrichNow(serial)
    } finally {
      this.enriching.delete(serial)
    }
  }

  private async enrichNow(serial: string): Promise<void> {
    const [props, battery, df, imei, accounts, packages, su] = await Promise.all([
      this.shell(serial, 'getprop'),
      this.shell(serial, 'dumpsys battery'),
      this.shell(serial, 'df -k /data'),
      this.shell(serial, 'service call iphonesubinfo 1 s16 com.android.shell', 4000),
      this.shell(serial, 'dumpsys account'),
      this.shell(serial, 'pm list packages -3'),
      // `command -v` esce con 1 se su non esiste: lo normalizziamo a exit 0
      this.shell(serial, 'command -v su || true')
    ])
    const d = this.devices.get(serial)
    if (!d) return // scollegato nel frattempo

    const p = parseGetprop(props.stdout)
    const brand = p['ro.product.brand'] || p['ro.product.vendor.brand'] || null
    d.brand = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : null
    d.manufacturer = p['ro.product.manufacturer'] || null
    d.model = p['ro.product.model'] || d.model
    d.marketName =
      p['ro.product.marketname'] ||
      p['ro.vendor.product.display'] ||
      p['ro.config.marketing_name'] ||
      p['ro.product.vendor.marketname'] ||
      null
    d.osVersion = p['ro.build.version.release'] ? `Android ${p['ro.build.version.release']}` : 'Android'
    d.sdkLevel = Number.parseInt(p['ro.build.version.sdk'] ?? '', 10) || null
    d.securityPatch = p['ro.build.version.security_patch'] || null
    d.hardwareSerial = p['ro.serialno'] || p['ro.boot.serialno'] || serial
    d.imei = parseImeiParcel(imei.stdout)
    d.battery = parseBattery(battery.stdout)
    d.storage = parseDf(df.stdout)
    d.software = parseSoftware(
      p,
      accounts.code === 0 ? accounts.stdout : null,
      packages.code === 0 ? packages.stdout : null,
      su.code === 0 ? su.stdout : null
    )
    d.lastUpdate = new Date().toISOString()
    this.emitChange()
  }

  private async refreshDetails(all = false): Promise<void> {
    const ready = [...this.devices.values()].filter((d) => d.state === 'device')
    if (!ready.length) return
    await Promise.all(
      ready.map(async (d) => {
        if (all || !d.osVersion) return this.enrich(d.serial)
        const [b, df] = await Promise.all([
          this.shell(d.serial, 'dumpsys battery'),
          this.shell(d.serial, 'df -k /data')
        ])
        d.battery = parseBattery(b.stdout) ?? d.battery
        d.storage = parseDf(df.stdout) ?? d.storage
        d.lastUpdate = new Date().toISOString()
      })
    )
    this.emitChange()
  }

  private emitChange(): void {
    this.emit('changed', this.list())
  }

  // ---------- azioni toolbox ----------

  async reboot(serial: string, mode: RebootMode): Promise<ActionResult> {
    const dev = this.devices.get(serial)
    if (!dev) return { ok: false, message: 'Dispositivo non collegato' }
    if (dev.state === 'unauthorized') return { ok: false, message: 'Autorizza il Debug USB sul telefono' }
    const args = ['-s', serial, 'reboot', ...(mode === 'system' ? [] : [mode])]
    const r = await run(this.adbPath, args, 10_000)
    const label = { system: 'normale', recovery: 'Recovery', bootloader: 'Bootloader/Fastboot' }[mode]
    return r.code === 0
      ? { ok: true, message: `Riavvio ${label} inviato` }
      : { ok: false, message: r.stderr.trim() || `Riavvio ${label} fallito` }
  }

  /** Avvia scrcpy staccato dal processo principale (resta aperto anche se DanfixMate si chiude). */
  mirror(serial: string, scrcpyPath: string | null): ActionResult {
    if (!scrcpyPath) return { ok: false, message: 'scrcpy non trovato: copialo in resources/bin/scrcpy' }
    const dev = this.devices.get(serial)
    if (!dev || dev.state !== 'device') return { ok: false, message: 'Dispositivo non pronto' }
    const title = `DanfixMate · ${dev.marketName ?? dev.model ?? serial}`
    const child = spawn(scrcpyPath, ['-s', serial, '--window-title', title, '--stay-awake'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: { ...process.env, ADB: this.adbPath } // scrcpy usa lo stesso adb (evita conflitti di versione)
    })
    child.on('error', () => undefined)
    child.unref()
    return { ok: true, message: 'Mirroring avviato' }
  }
}
