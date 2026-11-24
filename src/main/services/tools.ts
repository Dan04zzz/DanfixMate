import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolStatus } from '@shared/types'
import { run } from './exec'

const isWin = process.platform === 'win32'
const exe = (name: string): string => (isWin ? `${name}.exe` : name)

/** Cartella binari inclusi: resources/bin (dev) oppure <install>/resources/bin (packaged). */
export function bundledBinDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')
}

/** Cartella dove DanfixMate scarica da solo gli strumenti: %APPDATA%\DanfixMate\bin */
export const managedBinDir = (): string => join(app.getPath('userData'), 'bin')

async function whichOnPath(name: string): Promise<string | null> {
  const r = await run(isWin ? 'where' : 'which', [exe(name)], 3000)
  if (r.code !== 0) return null
  const first = r.stdout.split(/\r?\n/).find((l) => l.trim())
  return first?.trim() ?? null
}

async function locate(name: string, bundledSubdirs: string[], extraDirs: string[] = []): Promise<string | null> {
  // 1) binari inclusi nell'app  2) binari scaricati automaticamente
  for (const base of [bundledBinDir(), managedBinDir()]) {
    for (const sub of bundledSubdirs) {
      const p = join(base, sub, exe(name))
      if (existsSync(p)) return p
    }
  }
  for (const dir of extraDirs) {
    const p = join(dir, exe(name))
    if (existsSync(p)) return p
  }
  return whichOnPath(name)
}

export interface ResolvedTools {
  adb: string | null
  scrcpy: string | null
  ideviceId: string | null
  ideviceInfo: string | null
  adbVersion: string | null
}

let cache: ResolvedTools | null = null

export async function resolveTools(force = false): Promise<ResolvedTools> {
  if (cache && !force) return cache
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const localAppData = process.env.LOCALAPPDATA

  const adb = await locate(
    'adb',
    ['platform-tools', 'scrcpy'],
    [
      ...(sdk ? [join(sdk, 'platform-tools')] : []),
      ...(localAppData ? [join(localAppData, 'Android', 'Sdk', 'platform-tools')] : [])
    ]
  )
  const scrcpy = await locate('scrcpy', ['scrcpy'])
  const ideviceId = await locate('idevice_id', ['libimobiledevice'])
  const ideviceInfo = await locate('ideviceinfo', ['libimobiledevice'])

  let adbVersion: string | null = null
  if (adb) {
    const r = await run(adb, ['version'], 4000)
    adbVersion = r.stdout.match(/version\s+([\d.]+)/i)?.[1] ?? null
  }
  cache = { adb, scrcpy, ideviceId, ideviceInfo, adbVersion }
  return cache
}

export async function toolStatus(): Promise<ToolStatus> {
  const t = await resolveTools()
  return {
    adb: { available: !!t.adb, path: t.adb, version: t.adbVersion },
    scrcpy: { available: !!t.scrcpy, path: t.scrcpy },
    libimobiledevice: { available: !!(t.ideviceId && t.ideviceInfo), path: t.ideviceId }
  }
}
