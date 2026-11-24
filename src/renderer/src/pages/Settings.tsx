import clsx from 'clsx'
import { Building2, ImagePlus, ListChecks, Plus, Save, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { parseEuroToCents } from '@shared/money'
import {
  SERVICE_CATEGORY_LABEL,
  type LabSettings,
  type ServiceCatalogAdminItem,
  type ServiceCatalogEdit,
  type ServiceCategory
} from '@shared/types'
import { PageHeader } from '../components/PageHeader'
import { api, errMsg } from '../lib/api'
import { toast } from '../store/toast'

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <label className={clsx('flex flex-col gap-1.5', className)}>
    <span className="label">{label}</span>
    {children}
  </label>
)

function LabForm() {
  const [s, setS] = useState<LabSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => void api.invoke('settings:get').then(setS), [])
  if (!s) return null

  const set = (k: keyof LabSettings) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value })
  const save = async () => {
    setSaving(true)
    try {
      const { logoDataUrl: _logo, ...rest } = s
      setS(await api.invoke('settings:save', rest))
      toast.ok('Impostazioni salvate')
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
      <section className="panel p-5">
        <h2 className="mb-4 font-display text-[15px] font-semibold">Dati del laboratorio</h2>
        <p className="mb-4 text-sm text-ink-400">
          Dati predefiniti della parte destra dell’intestazione dei report (a sinistra c’è sempre DanfixMate). Si
          possono modificare anche report per report, dalla pagina di diagnostica.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nome" className="col-span-2">
            <input className="field" value={s.name} onChange={set('name')} />
          </Field>
          <Field label="Indirizzo" className="col-span-2">
            <input className="field" value={s.address} onChange={set('address')} placeholder="Via Roma 1, 00100 Roma" />
          </Field>
          <Field label="Telefono">
            <input className="field" value={s.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input className="field" value={s.email} onChange={set('email')} />
          </Field>
          <Field label="Partita IVA">
            <input className="field font-mono" value={s.vat} onChange={set('vat')} />
          </Field>
          <Field label="Tecnico">
            <input
              className="field"
              value={s.technician}
              onChange={set('technician')}
              placeholder="Nome di chi firma i report"
            />
          </Field>
          <Field label="Prefisso ticket">
            <input
              className="field font-mono uppercase"
              maxLength={6}
              value={s.ticketPrefix}
              onChange={set('ticketPrefix')}
            />
          </Field>
          <Field label="Testo a piè di pagina del report" className="col-span-2">
            <textarea rows={3} className="field resize-none" value={s.reportFooter} onChange={set('reportFooter')} />
          </Field>
        </div>
        <button className="btn-primary mt-5" disabled={saving} onClick={() => void save()}>
          <Save className="size-4" /> Salva
        </button>
      </section>

      <section className="panel self-start p-5">
        <h2 className="mb-4 font-display text-[15px] font-semibold">Logo</h2>
        <div className="grid h-32 place-items-center rounded-lg border border-dashed border-ink-600 bg-white/95 p-4">
          {s.logoDataUrl ? (
            <img src={s.logoDataUrl} alt="Logo" className="max-h-24 max-w-full object-contain" />
          ) : (
            <span className="text-sm text-slate-400">Nessun logo</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => void api.invoke('settings:chooseLogo').then(setS)}>
            <ImagePlus className="size-4" /> Scegli…
          </button>
          {s.logoDataUrl && (
            <button className="btn-ghost" onClick={() => void api.invoke('settings:clearLogo').then(setS)}>
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-400">PNG o SVG con sfondo trasparente rendono meglio sul report.</p>
      </section>
    </div>
  )
}

interface Draft extends ServiceCatalogEdit {
  price: string
  dirty: boolean
}

const toDraft = (s: ServiceCatalogAdminItem): Draft => ({
  code: s.code,
  label: s.label,
  category: s.category,
  defaultPriceCents: s.defaultPriceCents,
  price: (s.defaultPriceCents / 100).toFixed(2).replace('.', ','),
  requiresOwnership: s.requiresOwnership,
  mayWipeData: s.mayWipeData,
  active: s.active,
  dirty: false
})

const NEW_DRAFT: Draft = {
  label: '',
  category: 'firmware',
  defaultPriceCents: 0,
  price: '',
  requiresOwnership: false,
  mayWipeData: false,
  active: true,
  dirty: true
}

function PriceList() {
  const [rows, setRows] = useState<Draft[]>([])
  const [adding, setAdding] = useState<Draft | null>(null)
  useEffect(() => void api.invoke('services:admin').then((l) => setRows(l.map(toDraft))), [])

  const save = async (d: Draft, idx?: number) => {
    try {
      const saved = await api.invoke('services:save', {
        code: d.code,
        label: d.label,
        category: d.category,
        defaultPriceCents: parseEuroToCents(d.price),
        requiresOwnership: d.requiresOwnership,
        mayWipeData: d.mayWipeData,
        active: d.active
      })
      if (idx === undefined) {
        setRows((r) => [...r, toDraft(saved)])
        setAdding(null)
        toast.ok('Intervento aggiunto')
      } else {
        setRows((r) => r.map((x, i) => (i === idx ? toDraft(saved) : x)))
        toast.ok('Salvato')
      }
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const editor = (d: Draft, onChange: (d: Draft) => void, onSave: () => void, isNew = false) => (
    <div
      className={clsx(
        'grid grid-cols-[1fr_120px_130px_auto_auto_auto_90px] items-center gap-3 border-b border-ink-700/50 px-4 py-2 text-sm',
        !d.active && 'opacity-50',
        isNew && 'bg-signal/5'
      )}
    >
      <input
        className="field py-1.5"
        value={d.label}
        placeholder="Nome intervento"
        autoFocus={isNew}
        onChange={(e) => onChange({ ...d, label: e.target.value, dirty: true })}
      />
      <select
        className="field py-1.5"
        value={d.category}
        onChange={(e) => onChange({ ...d, category: e.target.value as ServiceCategory, dirty: true })}
      >
        {(Object.keys(SERVICE_CATEGORY_LABEL) as ServiceCategory[]).map((c) => (
          <option key={c} value={c}>
            {SERVICE_CATEGORY_LABEL[c].split(' ')[0]}
          </option>
        ))}
      </select>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400">€</span>
        <input
          className="field py-1.5 pl-7 text-right font-mono"
          inputMode="decimal"
          value={d.price}
          onChange={(e) => onChange({ ...d, price: e.target.value, dirty: true })}
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-ink-300" title="Richiede la verifica della proprietà">
        <input
          type="checkbox"
          className="accent-[var(--color-signal)]"
          checked={d.requiresOwnership}
          onChange={(e) => onChange({ ...d, requiresOwnership: e.target.checked, dirty: true })}
        />
        <ShieldCheck className="size-3.5" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-300" title="Può cancellare i dati del cliente">
        <input
          type="checkbox"
          className="accent-[var(--color-signal)]"
          checked={d.mayWipeData}
          onChange={(e) => onChange({ ...d, mayWipeData: e.target.checked, dirty: true })}
        />
        <TriangleAlert className="size-3.5" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-300" title="Visibile nelle nuove schede">
        <input
          type="checkbox"
          className="accent-[var(--color-signal)]"
          checked={d.active}
          onChange={(e) => onChange({ ...d, active: e.target.checked, dirty: true })}
        />
        attivo
      </label>
      <button className="btn-primary py-1.5" disabled={!d.dirty || !d.label.trim()} onClick={onSave}>
        <Save className="size-3.5" /> {isNew ? 'Aggiungi' : 'Salva'}
      </button>
    </div>
  )

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 p-4">
        <div>
          <h2 className="font-display text-[15px] font-semibold">Listino interventi</h2>
          <p className="text-sm text-ink-400">
            I prezzi sono quelli proposti nelle nuove schede. Le schede già create mantengono il loro prezzo.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding({ ...NEW_DRAFT })} disabled={!!adding}>
          <Plus className="size-4" /> Nuovo intervento
        </button>
      </div>
      <div className="grid grid-cols-[1fr_120px_130px_auto_auto_auto_90px] gap-3 border-b border-ink-700 px-4 py-2">
        {['Intervento', 'Categoria', 'Prezzo base', 'Proprietà', 'Cancella dati', 'Stato', ''].map((h) => (
          <span key={h} className="label">
            {h}
          </span>
        ))}
      </div>
      {adding && editor(adding, setAdding, () => void save(adding), true)}
      {rows.map((d, i) => (
        <div key={d.code}>
          {editor(
            d,
            (nd) => setRows((r) => r.map((x, j) => (j === i ? nd : x))),
            () => void save(d, i)
          )}
        </div>
      ))}
      <p className="px-4 py-3 text-xs text-ink-400">
        Gli interventi non si eliminano (restano nello storico delle schede): disattivali per toglierli dalle nuove
        schede.
      </p>
    </section>
  )
}

export function Settings() {
  const { tab = 'lab' } = useParams()
  const navigate = useNavigate()
  const tabs = [
    { id: 'lab', label: 'Laboratorio', icon: Building2 },
    { id: 'services', label: 'Listino', icon: ListChecks }
  ]
  return (
    <>
      <PageHeader
        title="Impostazioni"
        actions={
          <div className="flex rounded-xl border border-ink-700 bg-ink-850 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`/settings/${t.id}`, { replace: true })}
                className={clsx(
                  'btn px-4',
                  tab === t.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                )}
              >
                <t.icon className={clsx('size-4', tab === t.id && 'text-signal')} /> {t.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'services' ? <PriceList /> : <LabForm />}
    </>
  )
}
