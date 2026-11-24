import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupCategoryId, BackupCategoryScan, LiveDevice } from '@shared/types'
import { adbCancellable, adbError, adbShell, shQuote } from './adb-run'
import { localDirSize, withPolling, type JobManager } from './jobs'

interface CategoryDef {
  id: BackupCategoryId
  label: string
  paths: string[]
}

/** Cartelle standard della memoria utente Android */
export const BACKUP_CATEGORIES: CategoryDef[] = [
  { id: 'photos', label: 'Foto e video', paths: ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Movies'] },
  { id: 'documents', label: 'Documenti e download', paths: ['/sdcard/Documents', '/sdcard/Download'] },
  {
    id: 'audio',
    label: 'Musica e registrazioni',
    paths: ['/sdcard/Music', '/sdcard/Recordings', '/sdcard/Audiobooks']
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp (media e backup locali)',
    paths: ['/sdcard/Android/media/com.whatsapp/WhatsApp', '/sdcard/WhatsApp']
  },
  { id: 'contacts', label: 'Contatti (vCard)', paths: [] }
]

/** Righe "percorso|KB|numero file" prodotte dallo script di scansione */
export function parseScan(out: string): Map<string, { kb: number; files: number }> {
  const map = new Map<string, { kb: number; files: number }>()
  for (const line of out.split(/\r?\n/)) {
    const [path, kb, files] = line.trim().split('|')
    if (path?.startsWith('/')) map.set(path, { kb: Number(kb) || 0, files: Number(files) || 0 })
  }
  return map
}

// ---------- Contatti ----------

interface Contact {
  name: string
  phones: string[]
  emails: string[]
}

const CONTACT_KEYS = ['contact_id', 'display_name', 'mimetype', 'data1']

/**
 * Output di `content query --uri content://com.android.contacts/data --projection contact_id:display_name:mimetype:data1`
 * Es.: "Row: 0 contact_id=12, display_name=Rossi, Mario, mimetype=vnd.android.cursor.item/phone_v2, data1=+39 333…"
 * I valori possono contenere ", " quindi si divide solo davanti alle chiavi note.
 */
export function parseContacts(out: string): Contact[] {
  const byId = new Map<string, Contact>()
  const splitter = new RegExp(`, (?=(?:${CONTACT_KEYS.join('|')})=)`)
  for (const raw of out.split(/\r?\n/)) {
    const m = /^Row:\s*\d+\s+(.*)$/.exec(raw.trim())
    if (!m) continue
    const kv: Record<string, string> = {}
    for (const part of m[1].split(splitter)) {
      const i = part.indexOf('=')
      if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1)
    }
    const id = kv.contact_id
    if (!id) continue
    const c = byId.get(id) ?? { name: '', phones: [], emails: [] }
    if (kv.display_name && kv.display_name !== 'NULL') c.name = kv.display_name
    const v = kv.data1 && kv.data1 !== 'NULL' ? kv.data1.trim() : ''
    if (v && kv.mimetype?.endsWith('/phone_v2') && !c.phones.includes(v)) c.phones.push(v)
    if (v && kv.mimetype?.endsWith('/email_v2') && !c.emails.includes(v)) c.emails.push(v)
    byId.set(id, c)
  }
  return [...byId.values()].filter((c) => c.name || c.phones.length || c.emails.length)
}

const vEscape = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/[,;]/g, (x) => `\\${x}`)
    .replace(/\r?\n/g, '\\n')

export function toVCard(contacts: Contact[]): string {
  return contacts
    .map((c) =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${vEscape(c.name || c.phones[0] || c.emails[0])}`,
        `N:${vEscape(c.name)};;;;`,
        ...c.phones.map((p) => `TEL;TYPE=CELL:${vEscape(p)}`),
        ...c.emails.map((e) => `EMAIL:${vEscape(e)}`),
        'END:VCARD'
      ].join('\r\n')
    )
    .join('\r\n')
}

const CONTACTS_QUERY =
  'content query --uri content://com.android.contacts/data --projection contact_id:display_name:mimetype:data1'

// ---------- Servizio ----------

export interface BackupOutcome {
  status: 'done' | 'cancelled' | 'error'
  bytes: number
  files: number
  message: string
  destPath: string
}

export class BackupService {
  constructor(
    private readonly adb: string,
    private readonly serial: string,
    private readonly jobs: JobManager
  ) {}

  async scan(): Promise<BackupCategoryScan[]> {
    const all = BACKUP_CATEGORIES.flatMap((c) => c.paths)
    const script = `for p in ${all.map(shQuote).join(' ')}; do if [ -d "$p" ]; then s=$(du -sk "$p" 2>/dev/null | cut -f1); n=$(find "$p" -type f 2>/dev/null | wc -l); echo "$p|$s|$n"; fi; done`
    const [r, contacts] = await Promise.all([
      adbShell(this.adb, this.serial, script, 180_000),
      adbShell(this.adb, this.serial, CONTACTS_QUERY, 60_000)
    ])
    const found = parseScan(r.stdout)
    const contactCount = contacts.stdout.includes('Row:') ? parseContacts(contacts.stdout).length : null

    return BACKUP_CATEGORIES.map((c) => {
      if (c.id === 'contacts') return { id: c.id, label: c.label, paths: [], bytes: null, items: contactCount }
      const paths = c.paths.filter((p) => found.has(p))
      return {
        id: c.id,
        label: c.label,
        paths,
        bytes: paths.reduce((a, p) => a + found.get(p)!.kb * 1024, 0),
        items: paths.reduce((a, p) => a + found.get(p)!.files, 0)
      }
    })
  }

  /**
   * Copia le categorie scelte in <destinationDir>/<dispositivo>_<data>/<categoria>/…
   * e scrive un manifest JSON. L'avanzamento si misura sui byte arrivati sul PC.
   */
  async run(
    categories: BackupCategoryId[],
    destinationDir: string,
    device: LiveDevice,
    onStart: (destPath: string, jobId: string) => void
  ): Promise<BackupOutcome> {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const label = (device.marketName || device.model || device.serial).replace(/[^\w\- ]+/g, '').trim() || 'telefono'
    const destPath = join(destinationDir, `${label}_${stamp}`)
    const job = this.jobs.create('backup', this.serial, `Backup ${label}`)
    onStart(destPath, job.id)

    try {
      await mkdir(destPath, { recursive: true })
      job.update({ message: 'Calcolo dimensioni…' })
      const scan = await this.scan()
      const chosen = scan.filter((s) => categories.includes(s.id))
      job.update({ bytesTotal: chosen.reduce((a, s) => a + (s.bytes ?? 0), 0) || null })

      const warnings: string[] = []
      const summary: Record<string, unknown> = {}

      for (const cat of chosen) {
        if (job.cancelled) break
        if (cat.id === 'contacts') {
          job.update({ message: 'Esporto i contatti…' })
          const r = await adbShell(this.adb, this.serial, CONTACTS_QUERY, 120_000)
          const contacts = r.stdout.includes('Row:') ? parseContacts(r.stdout) : []
          if (contacts.length) {
            await writeFile(join(destPath, 'contatti.vcf'), toVCard(contacts), 'utf8')
            summary.contacts = contacts.length
          } else {
            warnings.push('Contatti non leggibili via USB su questo telefono: esportali dall’app Contatti')
          }
          continue
        }
        const catDir = join(destPath, cat.id)
        await mkdir(catDir, { recursive: true })
        for (const p of cat.paths) {
          if (job.cancelled) break
          const proc = adbCancellable(this.adb, ['-s', this.serial, 'pull', '-a', p, catDir])
          job.onCancel(proc.kill)
          const r = await withPolling(proc.promise, 1500, async () => {
            job.update({ bytesDone: (await localDirSize(destPath)).bytes, message: `${cat.label} · ${p}` })
          })
          if (r.code !== 0 && !job.cancelled) warnings.push(`${p}: ${adbError(r, 'copia incompleta')}`)
        }
        summary[cat.id] = { paths: cat.paths, expectedBytes: cat.bytes, expectedFiles: cat.items }
      }

      const final = await localDirSize(destPath)
      job.update({ bytesDone: final.bytes })
      await writeFile(
        join(destPath, 'DanfixMate-backup.json'),
        JSON.stringify(
          {
            app: 'DanfixMate',
            createdAt: new Date().toISOString(),
            device: {
              brand: device.brand,
              model: device.model,
              marketName: device.marketName,
              serial: device.hardwareSerial ?? device.serial,
              osVersion: device.osVersion
            },
            categories,
            summary,
            copied: final,
            warnings
          },
          null,
          2
        ),
        'utf8'
      )

      if (job.cancelled) {
        return { status: 'cancelled', bytes: final.bytes, files: final.files, message: 'Annullato', destPath }
      }
      const message = warnings.length ? `Completato con avvisi: ${warnings.join(' · ')}` : 'Completato'
      const status = final.files === 0 && warnings.length ? 'error' : 'done'
      if (status === 'done') job.done(message, destPath)
      else job.fail(message)
      return { status, bytes: final.bytes, files: final.files, message, destPath }
    } catch (e) {
      const message = String((e as Error)?.message ?? e)
      job.fail(message)
      return { status: 'error', bytes: 0, files: 0, message, destPath }
    }
  }
}
