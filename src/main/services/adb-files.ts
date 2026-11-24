import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ActionResult, FileEntry, FileListing } from '@shared/types'
import { adbCancellable, adbError, adbShell, shQuote } from './adb-run'
import { localDirSize, withPolling, type JobManager } from './jobs'

const NO_ACCESS = '__BM_NOACCESS__'

/** Normalizza un percorso assoluto del telefono ("/sdcard/../x" non è ammesso). */
export function normalizeRemote(p: string): string {
  const parts = p.split('/').filter((x) => x && x !== '.')
  if (parts.includes('..')) throw new Error('Percorso non valido')
  return '/' + parts.join('/')
}

/** Output di `stat -L -c '%F|%s|%Y|%n'` eseguito dentro la cartella */
export function parseStatListing(dir: string, out: string): FileEntry[] {
  const entries: FileEntry[] = []
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue
    const [kind, size, mtime, ...rest] = line.split('|')
    const name = rest.join('|')
    if (!name || name === '.' || name === '..' || kind === undefined) continue
    const k = kind.toLowerCase()
    const type: FileEntry['type'] = k.startsWith('directory')
      ? 'dir'
      : k.includes('regular')
        ? 'file'
        : k.includes('link')
          ? 'link'
          : 'other'
    const secs = Number(mtime)
    entries.push({
      name,
      path: dir === '/' ? `/${name}` : `${dir}/${name}`,
      type,
      size: Number(size) || 0,
      modified: Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : null
    })
  }
  return entries.sort((a, b) =>
    a.type === 'dir' && b.type !== 'dir'
      ? -1
      : b.type === 'dir' && a.type !== 'dir'
        ? 1
        : a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' })
  )
}

/** Zone in cui si può modificare/eliminare: solo memoria utente, mai la radice né le cartelle di sistema. */
export function isWritableUserPath(p: string): boolean {
  const n = normalizeRemote(p)
  const m = /^\/(sdcard|storage\/emulated\/0|storage\/[0-9A-F]{4}-[0-9A-F]{4})\/(.+)$/i.exec(n)
  return !!m && m[2].length > 0
}

export class AdbFiles {
  constructor(
    private readonly adb: string,
    private readonly serial: string,
    private readonly jobs: JobManager
  ) {}

  async list(path: string): Promise<FileListing> {
    const dir = normalizeRemote(path)
    const q = shQuote(dir)
    // -L segue i link (es. /sdcard -> /storage/self/primary). I glob non corrispondenti restano
    // letterali e stat li scarta con un errore su stderr.
    const cmd = `if cd ${q} 2>/dev/null; then stat -L -c '%F|%s|%Y|%n' -- * .[!.]* ..?* 2>/dev/null; true; else echo ${NO_ACCESS}; fi`
    const r = await adbShell(this.adb, this.serial, cmd, 30_000)
    if (r.stdout.includes(NO_ACCESS)) return { path: dir, entries: [], error: 'Cartella non accessibile (permessi)' }
    if (r.code !== 0 && !r.stdout.trim()) return { path: dir, entries: [], error: adbError(r, 'Lettura non riuscita') }
    return { path: dir, entries: parseStatListing(dir, r.stdout), error: null }
  }

  /** Dimensione totale (byte) dei percorsi sul telefono, con `du -sk`. */
  async remoteSize(paths: string[]): Promise<number | null> {
    if (!paths.length) return 0
    const r = await adbShell(this.adb, this.serial, `du -sk -- ${paths.map(shQuote).join(' ')} 2>/dev/null`, 120_000)
    let kb = 0
    let found = false
    for (const line of r.stdout.split(/\r?\n/)) {
      const n = Number.parseInt(line.split(/\s+/)[0] ?? '', 10)
      if (Number.isFinite(n)) {
        kb += n
        found = true
      }
    }
    return found ? kb * 1024 : null
  }

  /** Copia file/cartelle dal telefono al PC in un job con avanzamento. */
  pull(paths: string[], destDir: string, label?: string): string {
    const clean = paths.map(normalizeRemote)
    const job = this.jobs.create(
      'pull',
      this.serial,
      label ?? (clean.length === 1 ? `Scarico ${basename(clean[0])}` : `Scarico ${clean.length} elementi`)
    )
    void (async () => {
      const total = await this.remoteSize(clean)
      job.update({ bytesTotal: total, message: 'Copia in corso…' })
      // adb crea destDir/<nome>: misuriamo solo quegli elementi
      const targets = clean.map((p) => join(destDir, basename(p)))
      const measure = async () => (await Promise.all(targets.map(localPathSize))).reduce((a, b) => a + b, 0)
      const start = await measure()
      const errors: string[] = []
      for (const p of clean) {
        if (job.cancelled) return
        const proc = adbCancellable(this.adb, ['-s', this.serial, 'pull', '-a', p, destDir])
        job.onCancel(proc.kill)
        const r = await withPolling(proc.promise, 1000, async () => {
          job.update({ bytesDone: (await measure()) - start, message: basename(p) })
        })
        if (r.code !== 0 && !job.cancelled) errors.push(`${basename(p)}: ${adbError(r, 'errore')}`)
      }
      if (job.cancelled) return
      job.update({ bytesDone: (await measure()) - start })
      if (errors.length === clean.length) job.fail(errors[0])
      else job.done(errors.length ? `Completato con ${errors.length} errori` : 'Completato', destDir)
    })().catch((e) => job.fail(String(e?.message ?? e)))
    return job.id
  }

  /** Carica file dal PC in una cartella del telefono. */
  push(localFiles: string[], remoteDir: string): string {
    const dir = normalizeRemote(remoteDir)
    const job = this.jobs.create(
      'push',
      this.serial,
      localFiles.length === 1 ? `Carico ${basename(localFiles[0])}` : `Carico ${localFiles.length} file`
    )
    void (async () => {
      const sizes = await Promise.all(localFiles.map(async (f) => (await stat(f)).size))
      job.update({ bytesTotal: sizes.reduce((a, b) => a + b, 0) })
      let done = 0
      const errors: string[] = []
      for (const [i, f] of localFiles.entries()) {
        if (job.cancelled) return
        job.update({ message: basename(f) })
        const proc = adbCancellable(this.adb, ['-s', this.serial, 'push', f, `${dir}/`])
        job.onCancel(proc.kill)
        const r = await proc.promise
        if (r.code !== 0) errors.push(`${basename(f)}: ${adbError(r, 'errore')}`)
        done += sizes[i]
        job.update({ bytesDone: done })
      }
      if (job.cancelled) return
      if (errors.length === localFiles.length) job.fail(errors[0])
      else job.done(errors.length ? `Completato con ${errors.length} errori` : `Caricati in ${dir}`)
    })().catch((e) => job.fail(String(e?.message ?? e)))
    return job.id
  }

  async remove(paths: string[]): Promise<ActionResult> {
    const clean = paths.map(normalizeRemote)
    const blocked = clean.filter((p) => !isWritableUserPath(p))
    if (blocked.length)
      return { ok: false, message: `Eliminazione consentita solo nella memoria utente: ${blocked[0]}` }
    const r = await adbShell(this.adb, this.serial, `rm -rf -- ${clean.map(shQuote).join(' ')}`, 120_000)
    return r.code === 0
      ? { ok: true, message: clean.length === 1 ? 'Eliminato' : `${clean.length} elementi eliminati` }
      : { ok: false, message: adbError(r, 'Eliminazione non riuscita') }
  }

  async mkdir(path: string): Promise<ActionResult> {
    const p = normalizeRemote(path)
    if (!isWritableUserPath(p)) return { ok: false, message: 'Puoi creare cartelle solo nella memoria utente' }
    const r = await adbShell(this.adb, this.serial, `mkdir -p -- ${shQuote(p)}`)
    return r.code === 0 ? { ok: true, message: 'Cartella creata' } : { ok: false, message: adbError(r, 'Errore') }
  }

  async rename(from: string, to: string): Promise<ActionResult> {
    const a = normalizeRemote(from)
    const b = normalizeRemote(to)
    if (!isWritableUserPath(a) || !isWritableUserPath(b))
      return { ok: false, message: 'Puoi rinominare solo nella memoria utente' }
    const r = await adbShell(this.adb, this.serial, `mv -n -- ${shQuote(a)} ${shQuote(b)}`)
    return r.code === 0 ? { ok: true, message: 'Rinominato' } : { ok: false, message: adbError(r, 'Errore') }
  }
}

/** Byte occupati da un file o da una cartella locale (0 se non esiste). */
export async function localPathSize(p: string): Promise<number> {
  try {
    const st = await stat(p)
    return st.isDirectory() ? (await localDirSize(p)).bytes : st.size
  } catch {
    return 0
  }
}
