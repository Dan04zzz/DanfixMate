import { net } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { ToolId, ToolInstallProgress } from '@shared/types'
import { run } from './exec'
import { managedBinDir, resolveTools } from './tools'

/** Fonti ufficiali */
const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
const SCRCPY_RELEASE_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest'

/**
 * Scarica automaticamente adb (platform-tools) e scrcpy se mancano.
 * Non lancia mai eccezioni: gli errori finiscono nell'evento 'progress' con phase = 'error'.
 */
export class ToolInstaller extends EventEmitter {
  private state: ToolInstallProgress = { phase: 'idle', tool: null, percent: null, message: '' }
  private running: Promise<void> | null = null

  get progress(): ToolInstallProgress {
    return this.state
  }

  ensure(): Promise<void> {
    this.running ??= this.doEnsure().finally(() => (this.running = null))
    return this.running
  }

  private set(p: Partial<ToolInstallProgress>): void {
    this.state = { ...this.state, ...p }
    this.emit('progress', this.state)
  }

  private async doEnsure(): Promise<void> {
    if (process.platform !== 'win32') {
      this.set({
        phase: 'error',
        tool: null,
        percent: null,
        message: 'Download automatico disponibile solo su Windows'
      })
      return
    }
    this.set({ phase: 'checking', tool: null, percent: null, message: 'Verifico gli strumenti…' })
    const current = await resolveTools(true)
    const missing: ToolId[] = []
    if (!current.adb) missing.push('adb')
    if (!current.scrcpy) missing.push('scrcpy')
    if (!missing.length) {
      this.set({ phase: 'done', message: 'Strumenti pronti' })
      return
    }

    mkdirSync(managedBinDir(), { recursive: true })
    try {
      // scrcpy per primo: il suo pacchetto contiene anche adb.exe, utile se Google non è raggiungibile
      if (missing.includes('scrcpy')) await this.installScrcpy()
      if (missing.includes('adb') && !(await resolveTools(true)).adb) {
        try {
          await this.installPlatformTools()
        } catch (e) {
          if (!(await resolveTools(true)).adb) throw e
        }
      }
      const after = await resolveTools(true)
      if (!after.adb || !after.scrcpy)
        throw new Error('Installazione completata ma gli eseguibili non sono stati trovati')
      this.set({ phase: 'done', tool: null, percent: 100, message: 'Strumenti installati' })
    } catch (e) {
      this.set({ phase: 'error', percent: null, message: (e as Error).message || String(e) })
    }
  }

  // ---------- platform-tools ----------

  private async installPlatformTools(): Promise<void> {
    const bin = managedBinDir()
    const zip = join(bin, 'platform-tools.zip')
    await this.download('adb', PLATFORM_TOOLS_URL, zip, 'Scarico Android platform-tools (adb)')
    this.set({ phase: 'extracting', tool: 'adb', percent: null, message: 'Estraggo platform-tools…' })
    // lo zip contiene già la cartella "platform-tools/"
    rmSync(join(bin, 'platform-tools'), { recursive: true, force: true })
    await extractZip(zip, bin)
    rmSync(zip, { force: true })
  }

  // ---------- scrcpy ----------

  private async installScrcpy(): Promise<void> {
    this.set({ phase: 'checking', tool: 'scrcpy', percent: null, message: 'Cerco l’ultima versione di scrcpy…' })
    const res = await net.fetch(SCRCPY_RELEASE_API, {
      headers: { 'User-Agent': 'DanfixMate', Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(`GitHub non raggiungibile (HTTP ${res.status})`)
    const release = (await res.json()) as {
      tag_name: string
      assets: { name: string; browser_download_url: string }[]
    }
    const asset = release.assets.find((a) => /^scrcpy-win64-v[\d.]+\.zip$/i.test(a.name))
    if (!asset) throw new Error('Pacchetto scrcpy per Windows non trovato nella release')

    const bin = managedBinDir()
    const zip = join(bin, asset.name)
    await this.download('scrcpy', asset.browser_download_url, zip, `Scarico scrcpy ${release.tag_name}`)
    this.set({ phase: 'extracting', tool: 'scrcpy', percent: null, message: 'Estraggo scrcpy…' })

    // lo zip contiene "scrcpy-win64-vX.Y/": estrai in una cartella temporanea e rinomina in "scrcpy"
    const tmp = join(bin, '_scrcpy_tmp')
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    await extractZip(zip, tmp)
    const inner = readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory())
    const source = inner ? join(tmp, inner.name) : tmp
    const target = join(bin, 'scrcpy')
    rmSync(target, { recursive: true, force: true })
    renameSync(source, target)
    rmSync(tmp, { recursive: true, force: true })
    rmSync(zip, { force: true })
  }

  // ---------- utilità ----------

  /** Download in streaming con avanzamento (net.fetch usa il proxy di sistema). */
  private async download(tool: ToolId, url: string, dest: string, label: string): Promise<void> {
    this.set({ phase: 'downloading', tool, percent: 0, message: label })
    const res = await net.fetch(url, { headers: { 'User-Agent': 'DanfixMate' } })
    if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status}`)

    const total = Number(res.headers.get('content-length')) || 0
    const out = createWriteStream(dest)
    const reader = res.body.getReader()
    let received = 0
    let lastPct = -1
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        const pct = total ? Math.floor((received / total) * 100) : null
        if (pct !== null && pct !== lastPct) {
          lastPct = pct
          this.set({ percent: pct, message: `${label} · ${(received / 1048576).toFixed(1)} MB` })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    }
    if (total && received !== total) throw new Error(`${label}: download incompleto`)
  }
}

/** Estrae uno zip con tar.exe (incluso in Windows 10+), con fallback a PowerShell. */
async function extractZip(zip: string, dest: string): Promise<void> {
  const sysTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const tar = await run(existsSync(sysTar) ? sysTar : 'tar', ['-xf', zip, '-C', dest], 180_000)
  if (tar.code === 0) return
  const ps = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`
    ],
    300_000
  )
  if (ps.code !== 0) throw new Error(`Estrazione fallita: ${(ps.stderr || tar.stderr).trim().slice(0, 200)}`)
}
