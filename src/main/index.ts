import { app, BrowserWindow, shell } from 'electron'
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { openDatabase } from './db/connection'
import { createRepositories } from './db/repositories'
import { broadcast, registerIpc } from './ipc'
import { DeviceManager } from './services/device-manager'
import { JobManager } from './services/jobs'
import { ToolInstaller } from './services/tool-installer'
import { resolveTools, toolStatus } from './services/tools'

/**
 * L'app si chiamava BenchMate: al primo avvio come DanfixMate copia database e strumenti
 * dalla vecchia cartella (%APPDATA%\BenchMate). La vecchia cartella non viene toccata.
 */
function importLegacyData(dbPath: string): void {
  if (existsSync(dbPath)) return
  const legacyRoot = join(app.getPath('appData'), 'BenchMate')
  const legacyDb = join(legacyRoot, 'data', 'benchmate.sqlite')
  try {
    if (existsSync(legacyDb)) {
      mkdirSync(dirname(dbPath), { recursive: true })
      // file principale + journal WAL insieme, altrimenti si perdono le ultime scritture
      for (const ext of ['', '-wal', '-shm']) {
        if (existsSync(legacyDb + ext)) copyFileSync(legacyDb + ext, dbPath + ext)
      }
      console.log('[migrazione nome] database importato da', legacyDb)
    }
    const legacyBin = join(legacyRoot, 'bin')
    const newBin = join(app.getPath('userData'), 'bin')
    if (existsSync(legacyBin) && !existsSync(newBin)) cpSync(legacyBin, newBin, { recursive: true })
  } catch (e) {
    console.error('[migrazione nome] import non riuscito', e)
  }
}

const devices = new DeviceManager()
const installer = new ToolInstaller()
const jobs = new JobManager()

/** Scarica adb/scrcpy se mancano, poi (ri)avvia il monitor USB e aggiorna la UI. */
async function installToolsAndRestart(): Promise<void> {
  const before = await resolveTools(true)
  await installer.ensure()
  const after = await resolveTools(true)
  if (after.adb !== before.adb || after.scrcpy !== before.scrcpy || after.ideviceId !== before.ideviceId) {
    await devices.restart()
  }
  broadcast('tools:changed', await toolStatus())
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#07090d',
    title: 'DanfixMate',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07090d', symbolColor: '#8b98a9', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  // Link esterni (es. WhatsApp) -> browser/app di sistema, mai dentro l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|whatsapp):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// Una sola istanza: un secondo avvio porta in primo piano la finestra esistente
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('it.danfixmate.app')
    app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

    // DB in %APPDATA%\DanfixMate\data\danfixmate.sqlite
    const dbPath = join(app.getPath('userData'), 'data', 'danfixmate.sqlite')
    importLegacyData(dbPath)
    const db = openDatabase(dbPath)
    const repos = createRepositories(db)

    registerIpc({ db, repos, devices, jobs, installer, installTools: installToolsAndRestart })
    jobs.on('changed', (list) => broadcast('jobs:changed', list))
    devices.on('changed', (list) => broadcast('devices:changed', list))
    installer.on('progress', (p) => broadcast('tools:progress', p))

    createWindow()
    // Avvia subito con ciò che c'è, poi scarica in background gli strumenti mancanti
    void devices
      .start()
      .catch((e) => console.error('[devices] avvio fallito', e))
      .then(() => installToolsAndRestart())
      .catch((e) => console.error('[tools] installazione fallita', e))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => devices.stop())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
