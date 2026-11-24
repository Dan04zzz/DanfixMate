import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { EventChannel, IpcEventMap, IpcInvokeMap, InvokeChannel } from '@shared/ipc'
import type { LabSettings } from '@shared/types'
import type { DB } from './db/connection'
import { backupTo } from './db/connection'
import type { Repositories } from './db/repositories'
import { AdbApps } from './services/adb-apps'
import { AdbFiles } from './services/adb-files'
import { BackupService } from './services/backup'
import type { DeviceManager } from './services/device-manager'
import type { JobManager } from './services/jobs'
import { buildReportHtml, renderPdf } from './services/report'
import type { ToolInstaller } from './services/tool-installer'
import { toolStatus } from './services/tools'

type Handler<C extends InvokeChannel> = (
  ...args: Parameters<IpcInvokeMap[C]>
) => ReturnType<IpcInvokeMap[C]> | Promise<ReturnType<IpcInvokeMap[C]>>

function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, async (_e, ...args) => fn(...(args as Parameters<IpcInvokeMap[C]>)))
}

export function broadcast<E extends EventChannel>(channel: E, payload: IpcEventMap[E]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

async function openDialog(opts: OpenDialogOptions): Promise<string[]> {
  const win = focused()
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? [] : r.filePaths
}

/** Cartelle predefinite in Documenti\DanfixMate */
const docsDir = (...sub: string[]) => join(app.getPath('documents'), 'DanfixMate', ...sub)

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

export interface IpcDeps {
  db: DB
  repos: Repositories
  devices: DeviceManager
  jobs: JobManager
  installer: ToolInstaller
  installTools: () => Promise<void>
}

export function registerIpc({ db, repos, devices, jobs, installer, installTools }: IpcDeps): void {
  const files = (serial: string) => {
    const { adb } = devices.android(serial)
    return new AdbFiles(adb, serial, jobs)
  }
  const apps = (serial: string) => {
    const { adb } = devices.android(serial)
    return new AdbApps(adb, serial, jobs)
  }

  // ---------- impostazioni ----------
  async function labSettings(): Promise<LabSettings> {
    const s = repos.settings.all()
    let logoDataUrl: string | null = null
    const logo = s['lab.logo_path']
    if (logo && existsSync(logo)) {
      const mime = MIME[extname(logo).toLowerCase()] ?? 'image/png'
      logoDataUrl = `data:${mime};base64,${(await readFile(logo)).toString('base64')}`
    }
    return {
      name: s['lab.name'] ?? '',
      address: s['lab.address'] ?? '',
      phone: s['lab.phone'] ?? '',
      vat: s['lab.vat'] ?? '',
      email: s['lab.email'] ?? '',
      technician: s['lab.technician'] ?? '',
      logoDataUrl,
      ticketPrefix: s['ticket.prefix'] || 'BM',
      reportFooter: s['report.footer'] ?? ''
    }
  }

  // ---------- dispositivi ----------
  handle('devices:list', () => devices.list())
  handle('devices:refresh', () => devices.refresh())
  handle('devices:reboot', (serial, mode) => devices.reboot(serial, mode))
  handle('devices:mirror', (serial) => devices.mirror(serial))
  handle('tools:status', () => toolStatus())
  handle('tools:progress', () => installer.progress)
  handle('tools:install', async () => {
    await installTools()
    return toolStatus()
  })

  // ---------- file ----------
  handle('files:list', (serial, path) => files(serial).list(path))
  handle('files:pull', async (serial, paths) => {
    const [dest] = await openDialog({
      title: 'Scegli dove salvare sul PC',
      defaultPath: docsDir('Scaricati'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (!dest) return { ok: false, message: 'Annullato' }
    files(serial).pull(paths, dest)
    return { ok: true, message: 'Download avviato' }
  })
  handle('files:push', async (serial, remoteDir) => {
    const picked = await openDialog({
      title: 'File da caricare sul telefono',
      properties: ['openFile', 'multiSelections']
    })
    if (!picked.length) return { ok: false, message: 'Annullato' }
    files(serial).push(picked, remoteDir)
    return { ok: true, message: 'Caricamento avviato' }
  })
  handle('files:delete', (serial, paths) => files(serial).remove(paths))
  handle('files:mkdir', (serial, path) => files(serial).mkdir(path))
  handle('files:rename', (serial, from, to) => files(serial).rename(from, to))

  // ---------- app ----------
  handle('apps:list', (serial, filter) => apps(serial).list(filter))
  handle('apps:details', (serial, pkg) => apps(serial).details(pkg))
  handle('apps:action', (serial, pkg, action) => apps(serial).action(pkg, action))
  handle('apps:install', async (serial) => {
    const picked = await openDialog({
      title: 'APK da installare',
      filters: [{ name: 'Pacchetti Android', extensions: ['apk'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (!picked.length) return { ok: false, message: 'Annullato' }
    apps(serial).install(picked)
    return { ok: true, message: 'Installazione avviata' }
  })
  handle('apps:extract', async (serial, pkg) => {
    const [dest] = await openDialog({
      title: 'Dove salvare l’APK',
      defaultPath: docsDir('APK'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (!dest) return { ok: false, message: 'Annullato' }
    apps(serial).extract(pkg, dest)
    return { ok: true, message: 'Estrazione avviata' }
  })

  // ---------- backup ----------
  handle('backup:scan', (serial) => {
    const { adb } = devices.android(serial)
    return new BackupService(adb, serial, jobs).scan()
  })
  handle('backup:chooseDir', async () => {
    await mkdir(docsDir('Backup'), { recursive: true })
    const [dir] = await openDialog({
      title: 'Cartella dei backup',
      defaultPath: docsDir('Backup'),
      properties: ['openDirectory', 'createDirectory']
    })
    return dir ?? null
  })
  handle('backup:start', async (req) => {
    if (!req.categories.length) return { ok: false, message: 'Seleziona almeno una categoria' }
    const { adb, device } = devices.android(req.serial)
    const dest = req.destinationDir || docsDir('Backup')
    let backupId = 0
    const service = new BackupService(adb, req.serial, jobs)
    void service
      .run(req.categories, dest, device, (destPath) => {
        backupId = repos.backups.start({
          repairId: req.repairId,
          serial: device.hardwareSerial ?? req.serial,
          deviceLabel: device.marketName ?? [device.brand, device.model].filter(Boolean).join(' '),
          destPath,
          categories: req.categories
        })
      })
      .then((out) => {
        repos.backups.finish(backupId, out)
        if (out.status === 'done' && req.repairId) {
          repos.repairs.markServiceDone(req.repairId, 'data_backup')
          if (req.categories.includes('whatsapp')) repos.repairs.markServiceDone(req.repairId, 'chat_backup')
        }
      })
    return { ok: true, message: 'Backup avviato' }
  })
  handle('backup:history', (repairId) => repos.backups.history(repairId))

  // ---------- job / sistema ----------
  handle('jobs:list', () => jobs.list())
  handle('jobs:cancel', (id) =>
    jobs.cancel(id) ? { ok: true, message: 'Annullato' } : { ok: false, message: 'Operazione già terminata' }
  )
  handle('shell:openPath', async (path) => {
    const err = await shell.openPath(path)
    return err ? { ok: false, message: err } : { ok: true, message: 'Aperto' }
  })

  // ---------- clienti / listino / riparazioni ----------
  handle('customers:search', (q) => repos.customers.search(q))
  handle('customers:list', (q) => repos.customers.list(q))
  handle('customers:update', (input) => repos.customers.update(input))
  handle('services:catalog', () => repos.services.catalog())
  handle('services:admin', () => repos.services.admin())
  handle('services:save', (input) => repos.services.save(input))
  handle('repairs:list', (filter) => repos.repairs.list(filter))
  handle('repairs:get', (id) => repos.repairs.get(id))
  handle('repairs:create', (input) => repos.repairs.create(input))
  handle('repairs:setStatus', (id, status, note) => repos.repairs.setStatus(id, status, note))
  handle('repairs:move', (id, status, index) => repos.repairs.move(id, status, index))
  handle('repairs:toggleService', (id, done) => {
    repos.repairs.toggleService(id, done)
    return { ok: true, message: done ? 'Intervento completato' : 'Intervento riaperto' }
  })

  // ---------- diagnostica ----------
  handle('diagnostic:get', (repairId, phase) => repos.diagnostics.get(repairId, phase))
  handle('diagnostic:save', (input) => {
    repos.diagnostics.save(input)
    return repos.diagnostics.get(input.repairId, input.phase)
  })
  handle('diagnostic:pdf', async (repairId, phase) => {
    const repair = repos.repairs.get(repairId)
    if (!repair) return { ok: false, message: 'Scheda non trovata' }
    const session = repos.diagnostics.get(repairId, phase)
    if (!session.savedAt) return { ok: false, message: 'Salva prima la diagnostica' }
    const dest = docsDir('Report', `${repair.ticketNumber}-${phase === 'pre' ? 'accettazione' : 'riconsegna'}.pdf`)
    await renderPdf(buildReportHtml(await labSettings(), repair, session), dest)
    repos.diagnostics.setPdfPath(repairId, phase, dest)
    void shell.openPath(dest)
    return { ok: true, message: 'Report creato', path: dest }
  })

  // ---------- impostazioni ----------
  handle('settings:get', () => labSettings())
  handle('settings:save', async (s) => {
    repos.settings.set({
      'lab.name': s.name.trim(),
      'lab.address': s.address.trim(),
      'lab.phone': s.phone.trim(),
      'lab.vat': s.vat.trim(),
      'lab.email': s.email.trim(),
      'lab.technician': s.technician.trim(),
      'ticket.prefix':
        (s.ticketPrefix.trim() || 'BM')
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 6)
          .toUpperCase() || 'BM',
      'report.footer': s.reportFooter.trim()
    })
    return labSettings()
  })
  handle('settings:chooseLogo', async () => {
    const [file] = await openDialog({
      title: 'Logo del laboratorio',
      filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
      properties: ['openFile']
    })
    if (file) {
      const dir = join(app.getPath('userData'), 'branding')
      await mkdir(dir, { recursive: true })
      const dest = join(dir, `logo${extname(file).toLowerCase()}`)
      await copyFile(file, dest)
      repos.settings.set({ 'lab.logo_path': dest })
    }
    return labSettings()
  })
  handle('settings:clearLogo', () => {
    repos.settings.set({ 'lab.logo_path': '' })
    return labSettings()
  })

  // ---------- dashboard / backup DB ----------
  handle('dashboard:stats', () => repos.dashboard.stats())
  handle('db:backup', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const win = focused()
    const opts = {
      title: 'Esporta backup database',
      defaultPath: join(app.getPath('documents'), `DanfixMate-backup-${stamp}.sqlite`),
      filters: [{ name: 'Database SQLite', extensions: ['sqlite', 'db'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, message: 'Backup annullato' }
    await backupTo(db, res.filePath)
    return { ok: true, message: 'Backup completato', path: res.filePath }
  })
}
