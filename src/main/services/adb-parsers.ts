// Parser puri (senza I/O) per l'output di adb: testabili in isolamento.
import type { BatteryInfo, ConnectionState, SoftwareInfo, StorageInfo } from '@shared/types'

export interface AdbListEntry {
  serial: string
  state: ConnectionState
  transport: 'usb' | 'tcp'
  props: Record<string, string> // product:, model:, device:, transport_id:
}

const STATE_MAP: Record<string, ConnectionState> = {
  device: 'device',
  unauthorized: 'unauthorized',
  offline: 'offline',
  recovery: 'recovery',
  sideload: 'sideload',
  bootloader: 'bootloader',
  authorizing: 'unauthorized',
  connecting: 'offline'
}

/** Righe di `adb devices -l` / payload di `track-devices -l` */
export function parseDeviceList(text: string): AdbListEntry[] {
  const out: AdbListEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const [serial, state, ...rest] = line.split(/\s+/)
    if (!serial || !state) continue
    const props: Record<string, string> = {}
    for (const tok of rest) {
      const i = tok.indexOf(':')
      if (i > 0) props[tok.slice(0, i)] = tok.slice(i + 1)
    }
    out.push({
      serial,
      state: STATE_MAP[state] ?? 'unknown',
      transport: /:\d+$/.test(serial) || serial.includes('._adb-tls-') ? 'tcp' : 'usb',
      props
    })
  }
  return out
}

/**
 * Il protocollo `track-devices` invia blocchi "<4 cifre hex lunghezza><payload>".
 * Ritorna i payload completi e il residuo non ancora completo.
 */
export function splitTrackFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let buf = buffer
  while (buf.length >= 4) {
    const len = Number.parseInt(buf.slice(0, 4), 16)
    if (Number.isNaN(len)) {
      // flusso corrotto: scarta fino al prossimo possibile header
      buf = buf.slice(1)
      continue
    }
    if (buf.length < 4 + len) break
    frames.push(buf.slice(4, 4 + len))
    buf = buf.slice(4 + len)
  }
  return { frames, rest: buf }
}

/** Output di `adb shell getprop`: righe "[chiave]: [valore]" */
export function parseGetprop(text: string): Record<string, string> {
  const props: Record<string, string> = {}
  const re = /^\[([^\]]+)\]:\s*\[(.*)\]\s*$/
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line.trim())
    if (m) props[m[1]] = m[2]
  }
  return props
}

const HEALTH: Record<string, string> = {
  '1': 'Sconosciuta',
  '2': 'Buona',
  '3': 'Surriscaldata',
  '4': 'Esaurita',
  '5': 'Sovratensione',
  '6': 'Guasto',
  '7': 'Fredda'
}
const STATUS: Record<string, string> = {
  '1': 'Sconosciuto',
  '2': 'In carica',
  '3': 'In scarica',
  '4': 'Non in carica',
  '5': 'Carica completa'
}

/** Output di `adb shell dumpsys battery` */
export function parseBattery(text: string): BatteryInfo | null {
  if (!text.includes('level')) return null
  const kv: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) kv[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  const num = (k: string): number | null => {
    const n = Number.parseInt(kv[k] ?? '', 10)
    return Number.isFinite(n) ? n : null
  }
  const level = num('level')
  const scale = num('scale') ?? 100
  const temp = num('temperature')
  const cycles = num('cycle count') ?? num('charge cycle count')
  return {
    level: level !== null ? Math.round((level / (scale || 100)) * 100) : null,
    health: kv['health'] ? (HEALTH[kv['health']] ?? kv['health']) : null,
    status: kv['status'] ? (STATUS[kv['status']] ?? kv['status']) : null,
    temperatureC: temp !== null ? temp / 10 : null,
    cycleCount: cycles
  }
}

/** Output di `adb shell df -k /data` (toybox): blocchi da 1K */
export function parseDf(text: string): StorageInfo | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^Filesystem/i.test(l))
  for (const line of lines) {
    const cols = line.trim().split(/\s+/)
    // Filesystem 1K-blocks Used Available Use% Mounted
    if (cols.length >= 6) {
      const total = Number(cols[1])
      const used = Number(cols[2])
      const avail = Number(cols[3])
      if ([total, used, avail].every(Number.isFinite)) {
        return { totalBytes: total * 1024, usedBytes: used * 1024, freeBytes: avail * 1024 }
      }
    }
  }
  return null
}

/**
 * Output di `service call iphonesubinfo 1` (Parcel). Funziona solo su alcune
 * versioni/ROM: da Android 10 serve READ_PRIVILEGED_PHONE_STATE, quindi spesso null.
 */
export function parseImeiParcel(text: string): string | null {
  const chunks = [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('')
  const digits = chunks.replace(/[^0-9]/g, '')
  return /^\d{15}$/.test(digits.slice(0, 15)) && digits.length >= 15 ? digits.slice(0, 15) : null
}

/**
 * Stato software da getprop + output ausiliari.
 * - accountsDump: `dumpsys account` (contiamo solo gli account Google, senza conservare gli indirizzi)
 * - packages: `pm list packages -3`
 * - suPath: `command -v su`
 */
export function parseSoftware(
  props: Record<string, string>,
  accountsDump: string | null,
  packages: string | null,
  suPath: string | null
): SoftwareInfo {
  const vbs = (props['ro.boot.verifiedbootstate'] || '').toLowerCase()
  const verifiedBoot = (['green', 'yellow', 'orange', 'red'] as const).find((v) => v === vbs) ?? null

  let bootloaderLocked: boolean | null = null
  if (props['ro.boot.flash.locked'] === '1') bootloaderLocked = true
  else if (props['ro.boot.flash.locked'] === '0') bootloaderLocked = false
  else if (props['ro.boot.vbmeta.device_state']) bootloaderLocked = props['ro.boot.vbmeta.device_state'] === 'locked'
  else if (verifiedBoot === 'orange') bootloaderLocked = false
  else if (verifiedBoot === 'green') bootloaderLocked = true

  const crypto = props['ro.crypto.state']
  const encrypted = crypto === 'encrypted' ? true : crypto === 'unencrypted' ? false : null

  let googleAccounts: number | null = null
  if (accountsDump !== null) {
    const google = new Set<string>()
    for (const m of accountsDump.matchAll(/Account \{name=([^,]+), type=com\.google\}/g)) google.add(m[1])
    googleAccounts = google.size
  }

  const thirdPartyApps =
    packages === null ? null : packages.split(/\r?\n/).filter((l) => l.startsWith('package:')).length

  // `command -v su` stampa il percorso se esiste, niente altrimenti; null = comando non eseguibile
  const rooted = suPath === null ? null : /\/su$/m.test(suPath.trim())

  return {
    buildNumber: props['ro.build.display.id'] || null,
    bootloaderLocked,
    verifiedBoot,
    rooted,
    encrypted,
    googleAccounts,
    thirdPartyApps,
    activationLocked: null
  }
}
