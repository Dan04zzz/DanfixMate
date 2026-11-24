import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ActionResult, AppAction, AppDetails, AppEntry, AppFilter } from '@shared/types'
import { adbCancellable, adbError, adbShell, isPackageName, shQuote } from './adb-run'
import type { JobManager } from './jobs'

export interface ParsedPackage {
  packageName: string
  apkPath: string | null
  versionCode: number | null
  installer: string | null
}

/**
 * Output di `pm list packages [-f] [-i] [--show-versioncode]`, es.:
 * package:/data/app/~~Ab==/com.foo-x==/base.apk=com.foo versionCode:12 installer=com.android.vending
 * Il percorso può contenere '=' (base64): il nome pacchetto è dopo l'ULTIMO '=' del primo token.
 */
export function parsePackageList(out: string): ParsedPackage[] {
  const list: ParsedPackage[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('package:')) continue
    const [first, ...extras] = line.slice('package:'.length).split(/\s+/)
    const eq = first.lastIndexOf('=')
    const apkPath = eq > 0 ? first.slice(0, eq) : null
    const packageName = eq > 0 ? first.slice(eq + 1) : first
    if (!packageName) continue
    let versionCode: number | null = null
    let installer: string | null = null
    for (const e of extras) {
      if (e.startsWith('versionCode:')) versionCode = Number(e.slice(12)) || null
      else if (e.startsWith('installer=')) installer = e.slice(10) === 'null' ? null : e.slice(10)
    }
    list.push({ packageName, apkPath, versionCode, installer })
  }
  return list
}

const names = (out: string): Set<string> => new Set(parsePackageList(out).map((p) => p.packageName))

/** `dumpsys package <pkg>`: versione, date, permessi concessi */
export function parsePackageDetails(pkg: string, out: string): AppDetails {
  const pick = (re: RegExp) => re.exec(out)?.[1]?.trim() ?? null
  const toIso = (s: string | null) => {
    if (!s) return null
    const d = new Date(s.replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const granted = new Set<string>()
  for (const m of out.matchAll(/^\s+([\w.]+): granted=true/gm)) granted.add(m[1])
  return {
    packageName: pkg,
    versionName: pick(/versionName=([^\s]+)/),
    firstInstall: toIso(pick(/firstInstallTime=([\d-]+ [\d:]+)/)),
    lastUpdate: toIso(pick(/lastUpdateTime=([\d-]+ [\d:]+)/)),
    targetSdk: Number(pick(/targetSdk=(\d+)/)) || null,
    grantedPermissions: [...granted].sort()
  }
}

/** Esito di un comando pm/am: Android scrive "Success", "Failure [...]" oppure il nuovo stato. */
const pmOk = (out: string): boolean => /Success|new state: (disabled-user|enabled)|installed for user/i.test(out)

export class AdbApps {
  constructor(
    private readonly adb: string,
    private readonly serial: string,
    private readonly jobs: JobManager
  ) {}

  private sh(cmd: string, timeout = 30_000) {
    return adbShell(this.adb, this.serial, cmd, timeout)
  }

  /** `pm list packages` con fallback per Android < 9 (niente --show-versioncode) */
  private async pmList(flags: string): Promise<string> {
    const r = await this.sh(`pm list packages ${flags} -f -i --show-versioncode`)
    if (r.stdout.includes('package:')) return r.stdout
    return (await this.sh(`pm list packages ${flags} -f -i`)).stdout
  }

  async list(filter: AppFilter): Promise<AppEntry[]> {
    const [systemOut, disabledOut] = await Promise.all([this.sh('pm list packages -s'), this.sh('pm list packages -d')])
    const system = names(systemOut.stdout)
    const disabled = names(disabledOut.stdout)

    let pkgs: ParsedPackage[]
    let removed = new Set<string>()
    if (filter === 'removed') {
      // installati sul telefono ma rimossi per l'utente 0 (bloatware tolto con "uninstall --user 0")
      const [all, forUser] = await Promise.all([this.pmList('-u'), this.sh('pm list packages')])
      const present = names(forUser.stdout)
      pkgs = parsePackageList(all).filter((p) => !present.has(p.packageName))
      removed = new Set(pkgs.map((p) => p.packageName))
    } else {
      const flag = filter === 'user' ? '-3' : filter === 'system' ? '-s' : '-d'
      pkgs = parsePackageList(await this.pmList(flag))
    }

    return pkgs
      .map((p) => ({
        ...p,
        system: system.has(p.packageName),
        disabled: disabled.has(p.packageName),
        removedForUser: removed.has(p.packageName)
      }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName))
  }

  async details(pkg: string): Promise<AppDetails> {
    if (!isPackageName(pkg)) throw new Error('Nome pacchetto non valido')
    const r = await this.sh(`dumpsys package ${pkg}`)
    return parsePackageDetails(pkg, r.stdout)
  }

  async action(pkg: string, action: AppAction): Promise<ActionResult> {
    if (!isPackageName(pkg)) return { ok: false, message: 'Nome pacchetto non valido' }
    let cmd: string
    let okMsg: string
    switch (action) {
      case 'uninstall': {
        const isSystem = names((await this.sh(`pm list packages -s ${pkg}`)).stdout).has(pkg)
        // App di sistema: si rimuove solo per l'utente (reversibile con "Ripristina")
        cmd = isSystem ? `pm uninstall -k --user 0 ${pkg}` : `pm uninstall ${pkg}`
        okMsg = isSystem ? 'Rimossa per l’utente (ripristinabile)' : 'Disinstallata'
        break
      }
      case 'disable':
        cmd = `pm disable-user --user 0 ${pkg}`
        okMsg = 'Disattivata'
        break
      case 'enable':
        cmd = `pm enable ${pkg}`
        okMsg = 'Riattivata'
        break
      case 'force_stop': {
        const r = await this.sh(`am force-stop ${pkg}`)
        return r.code === 0 ? { ok: true, message: 'Arrestata' } : { ok: false, message: adbError(r, 'Errore') }
      }
      case 'clear_data':
        cmd = `pm clear ${pkg}`
        okMsg = 'Dati e cache cancellati'
        break
      case 'restore':
        cmd = `cmd package install-existing ${pkg} || pm install-existing ${pkg}`
        okMsg = 'Ripristinata'
        break
    }
    const r = await this.sh(cmd)
    const out = `${r.stdout}\n${r.stderr}`
    return pmOk(out) ? { ok: true, message: okMsg } : { ok: false, message: adbError(r, 'Operazione non riuscita') }
  }

  /** Installa uno o più APK (adb install -r) in un job. */
  install(apks: string[]): string {
    const job = this.jobs.create(
      'install',
      this.serial,
      apks.length === 1 ? `Installo ${basename(apks[0])}` : `Installo ${apks.length} APK`,
      apks.length
    )
    void (async () => {
      const errors: string[] = []
      for (const [i, apk] of apks.entries()) {
        if (job.cancelled) return
        job.update({ message: basename(apk) })
        const proc = adbCancellable(this.adb, ['-s', this.serial, 'install', '-r', apk])
        job.onCancel(proc.kill)
        const r = await proc.promise
        if (!pmOk(r.stdout + r.stderr)) errors.push(`${basename(apk)}: ${adbError(r, 'errore')}`)
        job.update({ bytesDone: i + 1 })
      }
      if (job.cancelled) return
      if (errors.length === apks.length) job.fail(errors[0])
      else
        job.done(
          errors.length
            ? `${apks.length - errors.length} installati, ${errors.length} errori`
            : 'Installazione completata'
        )
    })().catch((e) => job.fail(String(e?.message ?? e)))
    return job.id
  }

  /** Estrae l'APK (e gli split) di un'app installata. */
  extract(pkg: string, destDir: string): string {
    if (!isPackageName(pkg)) throw new Error('Nome pacchetto non valido')
    const job = this.jobs.create('apk_extract', this.serial, `Estraggo ${pkg}`)
    void (async () => {
      const paths = (await this.sh(`pm path ${pkg}`)).stdout
        .split(/\r?\n/)
        .filter((l) => l.startsWith('package:'))
        .map((l) => l.slice(8).trim())
      if (!paths.length) return job.fail('APK non trovato')
      const target = paths.length > 1 ? join(destDir, pkg) : destDir
      await mkdir(target, { recursive: true })
      job.update({ bytesTotal: paths.length })
      for (const [i, p] of paths.entries()) {
        if (job.cancelled) return
        const dest = paths.length > 1 ? join(target, basename(p)) : join(target, `${pkg}.apk`)
        const proc = adbCancellable(this.adb, ['-s', this.serial, 'pull', p, dest])
        job.onCancel(proc.kill)
        const r = await proc.promise
        if (r.code !== 0) return job.fail(adbError(r, 'Copia non riuscita'))
        job.update({ bytesDone: i + 1 })
      }
      job.done(paths.length > 1 ? `${paths.length} file APK (split)` : 'APK estratto', target)
    })().catch((e) => job.fail(String(e?.message ?? e)))
    return job.id
  }
}

export { shQuote }
