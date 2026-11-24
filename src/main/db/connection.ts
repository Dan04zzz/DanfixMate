import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrations } from './migrations'

export type DB = Database.Database

let instance: DB | null = null

export function openDatabase(filePath: string): DB {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL') // letture concorrenti + resistenza ai crash
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  snapshotBeforeMigration(db, filePath)
  migrate(db)
  instance = db
  return db
}

/** Se ci sono migrazioni da applicare a un DB esistente, ne salva prima una copia accanto. */
function snapshotBeforeMigration(db: DB, filePath: string): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current === 0 || current >= migrations.length) return
  const dest = join(dirname(filePath), `danfixmate.pre-v${migrations.length}.${Date.now()}.sqlite`)
  db.prepare('VACUUM INTO ?').run(dest)
}

export function getDb(): DB {
  if (!instance) throw new Error('Database non inizializzato')
  return instance
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= migrations.length) return
  // Procedura SQLite per modificare lo schema: FK spente (fuori transazione),
  // ogni migrazione nella sua transazione, poi controllo di integrità.
  db.pragma('foreign_keys = OFF')
  try {
    for (let v = current; v < migrations.length; v++) {
      db.transaction(() => {
        db.exec(migrations[v])
        const broken = db.pragma('foreign_key_check') as unknown[]
        if (broken.length) throw new Error(`Migrazione v${v + 1}: ${broken.length} riferimenti non validi`)
        db.pragma(`user_version = ${v + 1}`)
      })()
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/** Backup a caldo consistente (API nativa SQLite, sicura anche con WAL). */
export async function backupTo(db: DB, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true })
  await db.backup(destination)
}
