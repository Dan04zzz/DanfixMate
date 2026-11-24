// Alcune versioni/configurazioni di npm non eseguono gli script di installazione
// delle dipendenze: senza questo, Electron resta senza binario ("Electron uninstall").
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const dir = join(__dirname, '..', 'node_modules', 'electron')
if (existsSync(join(dir, 'path.txt')) && existsSync(join(dir, 'dist'))) {
  console.log('[ensure-electron] binario Electron presente')
} else {
  console.log('[ensure-electron] scarico il binario di Electron…')
  execFileSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit', cwd: dir })
}
