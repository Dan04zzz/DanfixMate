import { execFile } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/** execFile con timeout, senza finestra console su Windows, mai rifiuta: ritorna il codice. */
export function run(file: string, args: string[], timeoutMs = 8000, env?: NodeJS.ProcessEnv): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: env ?? process.env },
      (err, stdout, stderr) => {
        const code = err
          ? typeof (err as NodeJS.ErrnoException).code === 'number'
            ? Number((err as NodeJS.ErrnoException).code)
            : 1
          : 0
        resolve({ stdout: stdout ?? '', stderr: stderr ?? err?.message ?? '', code })
      }
    )
  })
}
