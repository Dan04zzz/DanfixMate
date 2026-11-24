import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Job, JobKind } from '@shared/types'

const KEEP_FINISHED = 15

export interface JobHandle {
  readonly id: string
  update(p: Partial<Pick<Job, 'bytesDone' | 'bytesTotal' | 'message' | 'label'>>): void
  /** Registra la funzione che interrompe il processo in corso (es. kill di adb). */
  onCancel(fn: () => void): void
  readonly cancelled: boolean
  done(message: string, resultPath?: string | null): void
  fail(message: string): void
}

/** Operazioni lunghe con avanzamento, mostrate nel "dock" in basso a destra. */
export class JobManager extends EventEmitter {
  private jobs = new Map<string, Job>()
  private cancelFns = new Map<string, () => void>()
  private emitTimer: NodeJS.Timeout | null = null

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'running') return false
    job.status = 'cancelled'
    job.message = 'Annullato'
    this.cancelFns.get(id)?.()
    this.cancelFns.delete(id)
    this.flush()
    return true
  }

  create(kind: JobKind, serial: string, label: string, bytesTotal: number | null = null): JobHandle {
    const job: Job = {
      id: randomUUID(),
      kind,
      serial,
      label,
      status: 'running',
      bytesDone: 0,
      bytesTotal,
      percent: bytesTotal ? 0 : null,
      message: 'Avvio…',
      resultPath: null,
      startedAt: new Date().toISOString()
    }
    this.jobs.set(job.id, job)
    this.prune()
    this.flush()

    const finish = (status: Job['status'], message: string, resultPath: string | null = null) => {
      if (job.status !== 'running') return // già annullato
      job.status = status
      job.message = message
      job.resultPath = resultPath
      if (status === 'done') job.percent = 100
      this.cancelFns.delete(job.id)
      this.flush()
    }

    return {
      id: job.id,
      update: (p) => {
        if (job.status !== 'running') return
        Object.assign(job, p)
        job.percent =
          job.bytesTotal && job.bytesTotal > 0 ? Math.min(99, Math.floor((job.bytesDone / job.bytesTotal) * 100)) : null
        this.schedule()
      },
      onCancel: (fn) => this.cancelFns.set(job.id, fn),
      get cancelled() {
        return job.status === 'cancelled'
      },
      done: (message, resultPath = null) => finish('done', message, resultPath),
      fail: (message) => finish('error', message)
    }
  }

  private prune(): void {
    const finished = this.list().filter((j) => j.status !== 'running')
    for (const j of finished.slice(KEEP_FINISHED)) this.jobs.delete(j.id)
  }

  /** Aggiornamenti frequenti (byte copiati) raggruppati ogni 250 ms. */
  private schedule(): void {
    this.emitTimer ??= setTimeout(() => this.flush(), 250)
  }

  private flush(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    this.emit('changed', this.list())
  }
}

/** Dimensione e numero di file di una cartella locale (per l'avanzamento dei download). */
export async function localDirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const walk = async (d: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        files++
        try {
          bytes += (await stat(p)).size
        } catch {
          /* file in scrittura */
        }
      }
    }
  }
  await walk(dir)
  return { bytes, files }
}

/** Esegue `fn` ogni `ms` finché la promise non termina. */
export async function withPolling<T>(promise: Promise<T>, ms: number, fn: () => Promise<void>): Promise<T> {
  let stop = false
  const loop = (async () => {
    while (!stop) {
      await new Promise((r) => setTimeout(r, ms))
      if (!stop) await fn()
    }
  })()
  try {
    return await promise
  } finally {
    stop = true
    await loop
  }
}
