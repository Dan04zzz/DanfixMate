import { spawn } from 'node:child_process'
import { run, type ExecResult } from './exec'

/** Quoting sicuro per la shell del telefono: 'abc' con gli apici interni escapati. */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** Nomi pacchetto Android: impedisce qualsiasi iniezione nei comandi pm/am. */
export const isPackageName = (s: string): boolean => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(s)

export function adbShell(adb: string, serial: string, cmd: string, timeoutMs = 20_000): Promise<ExecResult> {
  return run(adb, ['-s', serial, 'shell', cmd], timeoutMs)
}

/**
 * adb con processo annullabile (pull/push/install possono durare minuti).
 * Ritorna la promise e la funzione per interromperlo.
 */
export function adbCancellable(adb: string, args: string[]): { promise: Promise<ExecResult>; kill: () => void } {
  const child = spawn(adb, args, { windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
  const promise = new Promise<ExecResult>((resolve) => {
    child.on('error', (e) => resolve({ stdout, stderr: stderr || e.message, code: 1 }))
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
  return { promise, kill: () => child.kill() }
}

/** Prima riga d'errore leggibile da un output adb */
export const adbError = (r: ExecResult, fallback: string): string =>
  (r.stderr || r.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /error|fail|denied|not found|no such/i.test(l)) ??
  ((r.stderr || r.stdout).trim().split(/\r?\n/).pop() || fallback)
