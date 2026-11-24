import { EventEmitter } from 'node:events'
import type { LiveDevice } from '@shared/types'
import { run } from './exec'

const POLL_MS = 3000

/** "Chiave: Valore" di ideviceinfo */
export function parseIdeviceInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/**
 * Monitor iOS via libimobiledevice (sperimentale in Fase 1).
 * Su Windows richiede il driver Apple Mobile Device (installato con iTunes / Apple Devices).
 * Non esiste un equivalente di track-devices, quindi polling leggero di `idevice_id -l`.
 */
export class IosService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private devices = new Map<string, LiveDevice>()

  constructor(
    private readonly ideviceId: string,
    private readonly ideviceInfo: string
  ) {
    super()
  }

  start(): void {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  list(): LiveDevice[] {
    return [...this.devices.values()]
  }

  private async poll(): Promise<void> {
    const r = await run(this.ideviceId, ['-l'], 4000)
    const udids = new Set(
      r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
    let changed = false

    for (const udid of [...this.devices.keys()]) {
      if (!udids.has(udid)) {
        this.devices.delete(udid)
        changed = true
      }
    }
    for (const udid of udids) {
      const prev = this.devices.get(udid)
      if (!prev || prev.state !== 'device') {
        const dev = await this.read(udid, prev)
        if (!prev || dev.state !== prev.state || dev.model !== prev.model) changed = true
        this.devices.set(udid, dev)
      }
    }
    if (changed) this.emit('changed', this.list())
  }

  private async read(udid: string, prev?: LiveDevice): Promise<LiveDevice> {
    const now = new Date().toISOString()
    const info = await run(this.ideviceInfo, ['-u', udid], 6000)
    const base: LiveDevice = prev ?? {
      serial: udid,
      platform: 'ios',
      state: 'unknown',
      transport: 'usb',
      brand: 'Apple',
      manufacturer: 'Apple',
      model: null,
      marketName: null,
      osVersion: null,
      sdkLevel: null,
      securityPatch: null,
      hardwareSerial: null,
      imei: null,
      battery: null,
      storage: null,
      software: null,
      debugEnabled: false,
      connectedAt: now,
      lastUpdate: now
    }
    if (info.code !== 0) {
      // Tipicamente: "Please accept the trust dialog" / lockdownd pairing
      return { ...base, state: 'unauthorized', debugEnabled: false, lastUpdate: now }
    }
    const kv = parseIdeviceInfo(info.stdout)
    const bat = parseIdeviceInfo(
      (await run(this.ideviceInfo, ['-u', udid, '-q', 'com.apple.mobile.battery'], 4000)).stdout
    )
    const disk = parseIdeviceInfo(
      (await run(this.ideviceInfo, ['-u', udid, '-q', 'com.apple.disk_usage'], 4000)).stdout
    )
    const total = Number(disk.TotalDataCapacity ?? disk.TotalDiskCapacity)
    const free = Number(disk.TotalDataAvailable)
    return {
      ...base,
      state: 'device',
      debugEnabled: true, // "Trust" accettato
      model: kv.ProductType ?? null, // es. iPhone14,5 — mappatura nome commerciale in Fase 2
      marketName: kv.DeviceName ?? null,
      osVersion: kv.ProductVersion ? `iOS ${kv.ProductVersion}` : null,
      hardwareSerial: kv.SerialNumber ?? null,
      imei: kv.InternationalMobileEquipmentIdentity ?? null,
      battery: bat.BatteryCurrentCapacity
        ? {
            level: Number(bat.BatteryCurrentCapacity),
            status: bat.BatteryIsCharging === 'true' ? 'In carica' : 'In scarica',
            health: null, // la salute richiede diagnostics relay (Fase 2)
            temperatureC: null,
            cycleCount: null
          }
        : null,
      storage: Number.isFinite(total)
        ? {
            totalBytes: total,
            freeBytes: Number.isFinite(free) ? free : null,
            usedBytes: Number.isFinite(free) ? total - free : null
          }
        : null,
      software: {
        buildNumber: kv.BuildVersion ?? null,
        bootloaderLocked: null,
        verifiedBoot: null,
        rooted: null, // rilevamento jailbreak: Fase 2
        encrypted: kv.PasswordProtected ? kv.PasswordProtected === 'true' : null,
        googleAccounts: null,
        thirdPartyApps: null,
        activationLocked: null // stato "Dov'è": Fase 2
      },
      lastUpdate: now
    }
  }
}
