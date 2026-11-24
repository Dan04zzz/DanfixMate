import { BrowserWindow } from 'electron'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { formatCents } from '@shared/money'
import { headerFromSettings } from '@shared/report-header'
import {
  DATA_POLICY_LABEL,
  DIAGNOSTIC_RESULT_LABEL,
  type DiagnosticSession,
  type LabSettings,
  type RepairListItem
} from '@shared/types'

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const RESULT_COLOR: Record<string, string> = {
  ok: '#047857',
  faulty: '#b91c1c',
  not_testable: '#6b7280',
  pending: '#b45309'
}

export function buildReportHtml(lab: LabSettings, repair: RepairListItem, s: DiagnosticSession): string {
  const phaseLabel = s.phase === 'pre' ? 'Accettazione' : 'Riconsegna'
  // intestazione salvata con la diagnostica, altrimenti quella predefinita delle Impostazioni
  const h = s.reportHeader ?? headerFromSettings(lab)
  const snap = s.deviceSnapshot
  const sw = snap?.software
  const results = new Map(s.results.map((r) => [r.testId, r]))
  const categories = [...new Set(s.tests.map((t) => t.category))]
  const counts = { ok: 0, faulty: 0, not_testable: 0, pending: 0 }
  for (const t of s.tests) counts[results.get(t.id)?.result ?? 'pending']++

  const kv = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v ?? '—') || '—'}</td></tr>`
  const bool = (v: boolean | null | undefined, yes: string, no: string) => (v == null ? '—' : v ? yes : no)

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 9.5pt/1.4 "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #0e7490; padding-bottom: 10px; }
  .brand { font-size: 20pt; font-weight: 700; letter-spacing: -.02em; line-height: 1; }
  .brand span { color: #0891b2; }
  .lab { display: flex; gap: 12px; align-items: flex-start; text-align: right; font-size: 9pt; color: #374151; }
  .lab img { max-height: 52px; max-width: 140px; }
  .lab b { font-size: 11pt; color: #111827; }
  h1 { font-size: 15pt; margin: 14px 0 2px; }
  .sub { color: #4b5563; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .box { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .box h2 { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 500; color: #6b7280; width: 42%; padding: 2px 0; vertical-align: top; }
  td { padding: 2px 0; vertical-align: top; }
  .mono { font-family: Consolas, monospace; }
  .checks { margin-top: 12px; }
  .checks table { border: 1px solid #d1d5db; }
  .checks th, .checks td { border-bottom: 1px solid #e5e7eb; padding: 2.5px 8px; width: auto; color: #111827; font-weight: 400; }
  .checks tr.cat td { padding-top: 3px; padding-bottom: 3px; background: #f3f4f6; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .06em; color: #374151; }
  .res { font-weight: 600; white-space: nowrap; }
  .summary { margin-top: 6px; font-size: 9pt; color: #374151; }
  .services td { padding: 3px 0; }
  .services td:last-child { text-align: right; }
  .total td { border-top: 1px solid #d1d5db; font-weight: 600; padding-top: 4px; }
  .notes { white-space: pre-wrap; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 16px; break-inside: avoid; }
  .slot { height: 64px; border-bottom: 1px solid #9ca3af; position: relative; }
  .slot img { position: absolute; bottom: 2px; left: 0; max-height: 62px; max-width: 100%; }
  .cap { font-size: 8.5pt; color: #4b5563; padding-top: 3px; }
  footer { margin-top: 14px; font-size: 8pt; color: #6b7280; }
  .pill { display:inline-block; padding: 1px 6px; border-radius: 4px; background:#ecfeff; color:#0e7490; font-size: 8.5pt; }
  </style></head><body>
  <header>
    <div class="brand">Danfix<span>Mate</span></div>
    <div class="lab">
      <div>${[
        h.labName && `<b>${esc(h.labName)}</b>`,
        h.address && esc(h.address),
        [h.phone, h.email].filter(Boolean).map(esc).join(' · '),
        h.vat && `P.IVA ${esc(h.vat)}`,
        h.technician && `Tecnico: ${esc(h.technician)}`
      ]
        .filter(Boolean)
        .join('<br>')}</div>
      ${lab.logoDataUrl ? `<img src="${lab.logoDataUrl}">` : ''}
    </div>
  </header>

  <h1>Report diagnostico — ${phaseLabel}</h1>
  <div class="sub">Scheda <b class="mono">${esc(repair.ticketNumber)}</b> · ${fmtDate(s.savedAt ?? new Date().toISOString())}</div>

  <div class="grid">
    <div class="box"><h2>Cliente</h2><table>
      ${kv('Nome', repair.customerName)}${kv('Telefono', repair.customerPhone)}
    </table></div>
    <div class="box"><h2>Dispositivo</h2><table>
      ${kv('Modello', repair.deviceLabel)}
      <tr><th>Seriale</th><td class="mono">${esc(snap?.hardwareSerial ?? repair.deviceSerial ?? '—')}</td></tr>
      <tr><th>IMEI</th><td class="mono">${esc(snap?.imei ?? repair.deviceImei ?? '—')}</td></tr>
      ${kv('Sistema', snap?.osVersion)}${snap?.securityPatch ? kv('Patch sicurezza', snap.securityPatch) : ''}
      ${sw?.buildNumber ? `<tr><th>Build</th><td class="mono">${esc(sw.buildNumber)}</td></tr>` : ''}
      ${snap?.battery?.level != null ? kv('Batteria', `${snap.battery.level}%${snap.battery.health ? ` · ${snap.battery.health}` : ''}`) : ''}
    </table></div>
    <div class="box"><h2>Interventi</h2><table class="services">
      ${repair.services.map((x) => `<tr><td>${esc(x.label)}</td><td class="mono">${formatCents(x.priceCents)}</td></tr>`).join('')}
      <tr class="total"><td>Preventivo</td><td class="mono">${formatCents(repair.quoteCents)}</td></tr>
      ${repair.depositCents ? `<tr><td>Acconto</td><td class="mono">${formatCents(repair.depositCents)}</td></tr>` : ''}
    </table></div>
    <div class="box"><h2>Condizioni</h2><table>
      ${kv('Dati del cliente', DATA_POLICY_LABEL[repair.dataPolicy])}
      ${repair.ownershipVerified ? kv('Proprietà verificata', repair.ownershipProof) : ''}
      ${sw ? kv('Bootloader', bool(sw.bootloaderLocked, 'Bloccato', 'Sbloccato')) : ''}
      ${sw ? kv('Root', bool(sw.rooted, 'Rilevato', 'Non rilevato')) : ''}
      ${sw?.googleAccounts != null ? kv('Account Google', sw.googleAccounts ? `${sw.googleAccounts} presente/i` : 'Nessuno') : ''}
      ${kv('Problema segnalato', repair.reportedIssue)}
    </table></div>
  </div>

  <div class="checks">
    <table>
      ${categories
        .map(
          (cat) =>
            `<tr class="cat"><td colspan="3">${esc(cat)}</td></tr>` +
            s.tests
              .filter((t) => t.category === cat)
              .map((t) => {
                const r = results.get(t.id)
                const v = r?.result ?? 'pending'
                return `<tr><td>${esc(t.label)}</td><td class="res" style="color:${RESULT_COLOR[v]}">${DIAGNOSTIC_RESULT_LABEL[v]}</td><td>${esc(r?.note ?? '')}</td></tr>`
              })
              .join('')
        )
        .join('')}
    </table>
    <div class="summary">
      <span class="pill">${counts.ok} funzionanti</span> · ${counts.faulty} difettosi · ${counts.not_testable} non testabili${counts.pending ? ` · ${counts.pending} da verificare` : ''}
    </div>
  </div>

  ${s.notes ? `<div class="box" style="margin-top:12px"><h2>Note del tecnico</h2><div class="notes">${esc(s.notes)}</div></div>` : ''}

  <div class="sign">
    <div><div class="slot">${s.signaturePng ? `<img src="${s.signaturePng}">` : ''}</div><div class="cap">Firma del cliente</div></div>
    <div><div class="slot"></div><div class="cap">Firma del tecnico</div></div>
  </div>
  <footer>${esc(lab.reportFooter)}</footer>
  </body></html>`
}

/** Stampa l'HTML in PDF con una finestra nascosta di Electron. */
export async function renderPdf(html: string, destination: string): Promise<void> {
  const tmp = join(tmpdir(), `danfixmate-report-${Date.now()}.html`)
  await writeFile(tmp, html, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, pdf)
  } finally {
    win.destroy()
    await rm(tmp, { force: true })
  }
}
