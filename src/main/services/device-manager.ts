import { EventEmitter } from 'node:events'
import type { ActionResult, LiveDevice, RebootMode } from '@shared/types'
import { AdbService } from './adb'
import { IosService } from './ios'
import { resolveTools } from './tools'

/** Facciata unica Android + iOS per il resto dell'app. */
export class DeviceManager extends EventEmitter {
  private adb: AdbService | null = null
  private ios: IosService | null = null
  private scrcpy: string | null = null

  async start(): Promise<void> {
    const tools = await resolveTools()
    this.scrcpy = tools.scrcpy
    if (tools.adb) {
      this.adb = new AdbService(tools.adb)
      this.adb.on('changed', () => this.emit('changed', this.list()))
      this.adb.on('error', (e) => console.error('[adb]', e))
      await this.adb.start()
    } else {
      console.warn('[devices] adb non trovato: il monitor Android è disattivato')
    }
    if (tools.ideviceId && tools.ideviceInfo) {
      this.ios = new IosService(tools.ideviceId, tools.ideviceInfo)
      this.ios.on('changed', () => this.emit('changed', this.list()))
      this.ios.start()
    }
  }

  stop(): void {
    this.adb?.stop()
    this.ios?.stop()
    this.adb?.removeAllListeners()
    this.ios?.removeAllListeners()
    this.adb = null
    this.ios = null
  }

  /** Riavvia i monitor (es. dopo il download automatico di adb). */
  async restart(): Promise<void> {
    this.stop()
    await this.start()
    this.emit('changed', this.list())
  }

  list(): LiveDevice[] {
    return [...(this.adb?.list() ?? []), ...(this.ios?.list() ?? [])]
  }

  async refresh(): Promise<LiveDevice[]> {
    await this.adb?.forceRefresh()
    return this.list()
  }

  async reboot(serial: string, mode: RebootMode): Promise<ActionResult> {
    if (!this.adb) return { ok: false, message: 'adb non disponibile' }
    return this.adb.reboot(serial, mode)
  }

  /** adb + dispositivo Android pronto, oppure errore leggibile per l'utente. */
  android(serial: string): { adb: string; device: LiveDevice } {
    const device = this.adb?.get(serial)
    if (!this.adb || !device) throw new Error('Dispositivo non collegato')
    if (device.state === 'unauthorized') throw new Error('Autorizza il Debug USB sul telefono')
    if (device.state !== 'device') throw new Error('Dispositivo non pronto')
    return { adb: this.adb.adbPath, device }
  }

  mirror(serial: string): ActionResult {
    if (!this.adb) return { ok: false, message: 'adb non disponibile' }
    return this.adb.mirror(serial, this.scrcpy)
  }
}
