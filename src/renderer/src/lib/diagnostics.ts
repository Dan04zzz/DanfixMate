import type { DiagnosticEntry, DiagnosticTest, LiveDevice } from '@shared/types'

const monthsSince = (isoDate: string): number => {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return Number.NaN
  return (Date.now() - d.getTime()) / (30.44 * 24 * 3600 * 1000)
}

/**
 * Proposta di esito per i controlli con `autoSource`, a partire dal dispositivo collegato.
 * Restituisce solo i controlli per cui il dato è disponibile: il tecnico conferma o corregge.
 */
export function autoFill(tests: DiagnosticTest[], d: LiveDevice): DiagnosticEntry[] {
  const out: DiagnosticEntry[] = []
  const sw = d.software
  for (const t of tests) {
    const add = (result: DiagnosticEntry['result'], note: string | null = null) =>
      out.push({ testId: t.id, result, note })
    switch (t.autoSource) {
      case 'state':
        if (d.state === 'device') add('ok', 'Sistema avviato, debug USB attivo')
        break
      case 'software.verifiedBoot':
        if (sw?.verifiedBoot) add(sw.verifiedBoot === 'green' ? 'ok' : 'faulty', `Verified boot: ${sw.verifiedBoot}`)
        break
      case 'software.bootloaderLocked':
        if (sw?.bootloaderLocked != null)
          add(sw.bootloaderLocked ? 'ok' : 'faulty', sw.bootloaderLocked ? 'Bloccato' : 'Sbloccato')
        break
      case 'software.rooted':
        if (sw?.rooted != null)
          add(sw.rooted ? 'faulty' : 'ok', sw.rooted ? 'Binario su presente' : 'Nessun root rilevato')
        break
      case 'securityPatch':
        if (d.securityPatch) {
          const m = monthsSince(d.securityPatch)
          if (Number.isFinite(m))
            add(m <= 12 ? 'ok' : 'faulty', `Patch ${d.securityPatch}${m > 12 ? ` (${Math.floor(m)} mesi)` : ''}`)
        }
        break
      case 'software.googleAccounts':
        // la presenza di un account non dice se è del proprietario: si annota e si lascia da verificare
        if (sw?.googleAccounts != null)
          add(
            'pending',
            sw.googleAccounts ? `${sw.googleAccounts} account Google sul telefono` : 'Nessun account Google'
          )
        break
      case 'software.encrypted':
        if (sw?.encrypted != null) add(sw.encrypted ? 'ok' : 'faulty', sw.encrypted ? 'Attiva' : 'Non attiva')
        break
      case 'storage':
        if (d.storage?.totalBytes && d.storage.freeBytes != null) {
          const pct = Math.round((d.storage.freeBytes / d.storage.totalBytes) * 100)
          add(pct >= 10 ? 'ok' : 'faulty', `${pct}% libero`)
        }
        break
      case 'battery':
        if (d.battery?.level != null)
          add(
            'pending',
            `Livello ${d.battery.level}%${d.battery.temperatureC != null ? `, ${d.battery.temperatureC.toFixed(1)}°C` : ''}`
          )
        break
      case 'software.thirdPartyApps':
        if (sw?.thirdPartyApps != null) add('pending', `${sw.thirdPartyApps} app installate`)
        break
    }
  }
  return out
}

/** Il dispositivo collegato che corrisponde alla scheda (seriale hardware o seriale adb). */
export function findLiveDevice(devices: LiveDevice[], serial: string | null): LiveDevice | undefined {
  if (!serial) return undefined
  return devices.find((d) => d.state === 'device' && (d.hardwareSerial === serial || d.serial === serial))
}
