import clsx from 'clsx'
import {
  Apple,
  Check,
  ClipboardCheck,
  Database,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  UserPlus,
  UserSearch,
  Usb,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { computeMarginCents, formatCents, parseEuroToCents } from '@shared/money'
import {
  DATA_POLICY_LABEL,
  OWNERSHIP_PROOFS,
  SERVICE_CATEGORY_LABEL,
  type CreateRepairInput,
  type Customer,
  type DataPolicy,
  type LiveDevice,
  type Platform,
  type RepairPriority,
  type ServiceCatalogItem,
  type ServiceCategory
} from '@shared/types'
import { PageHeader } from '../components/PageHeader'
import { useHotkeys } from '../hooks/useHotkeys'
import { api } from '../lib/api'
import { useDevices } from '../store/devices'
import { toast } from '../store/toast'

function Section({
  title,
  icon,
  children,
  aside,
  tone
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  aside?: ReactNode
  tone?: 'warn'
}) {
  return (
    <section className={clsx('panel p-5', tone === 'warn' && 'border-warn/40')}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <span className={tone === 'warn' ? 'text-warn' : 'text-signal'}>{icon}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1.5', className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

const PRIORITIES: { value: RepairPriority; label: string }[] = [
  { value: 'low', label: 'Bassa' },
  { value: 'normal', label: 'Normale' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' }
]

const DATA_POLICIES: DataPolicy[] = ['keep', 'backup_then_wipe', 'wipe_ok']
const CATEGORIES: ServiceCategory[] = ['firmware', 'data', 'unlock', 'cleanup', 'generic']

interface DeviceForm {
  platform: Platform
  brand: string
  model: string
  serial: string
  imei: string
  color: string
  osVersion: string
}

const emptyDevice: DeviceForm = {
  platform: 'android',
  brand: '',
  model: '',
  serial: '',
  imei: '',
  color: '',
  osVersion: ''
}

const fromLive = (d: LiveDevice): DeviceForm => ({
  platform: d.platform,
  brand: d.brand ?? '',
  model: d.marketName
    ? `${d.marketName}${d.model && d.model !== d.marketName ? ` (${d.model})` : ''}`
    : (d.model ?? ''),
  serial: d.hardwareSerial ?? d.serial,
  imei: d.imei ?? '',
  color: '',
  osVersion: d.osVersion ?? ''
})

const centsToField = (c: number): string => (c / 100).toFixed(2).replace('.', ',')

export function NewRepair() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const liveDevices = useDevices((s) => s.devices).filter((d) => d.state === 'device')

  const [linkedSerial, setLinkedSerial] = useState<string | null>(null)
  const [device, setDevice] = useState<DeviceForm>(emptyDevice)

  const [customerMode, setCustomerMode] = useState<'new' | 'existing'>('new')
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', phone: '', email: '' })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [picked, setPicked] = useState<Customer | null>(null)

  // Interventi: codice -> prezzo (stringa del campo)
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  // descrizione libera degli interventi "Generico"
  const [descr, setDescr] = useState<Record<string, string>>({})

  const [issue, setIssue] = useState('')
  const [dataPolicy, setDataPolicy] = useState<DataPolicy>('keep')
  const [ownershipVerified, setOwnershipVerified] = useState(false)
  const [ownershipProof, setOwnershipProof] = useState('')
  const [notes, setNotes] = useState('')
  const [passcode, setPasscode] = useState('')
  const [priority, setPriority] = useState<RepairPriority>('normal')
  const [eta, setEta] = useState('')

  // quote vuoto = automatico (somma degli interventi)
  const [money, setMoney] = useState({ quote: '', external: '', labor: '', deposit: '' })
  const [saving, setSaving] = useState(false)
  const issueRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => void api.invoke('services:catalog').then(setCatalog), [])

  // Precompila dal dispositivo USB (?serial=… dalla card, oppure l'unico collegato)
  useEffect(() => {
    const serial = params.get('serial')
    const target = serial
      ? liveDevices.find((d) => d.serial === serial)
      : liveDevices.length === 1
        ? liveDevices[0]
        : undefined
    if (target && !linkedSerial) {
      setLinkedSerial(target.serial)
      setDevice(fromLive(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, liveDevices.length])

  useEffect(() => issueRef.current?.focus(), [])

  useEffect(() => {
    if (customerMode !== 'existing' || query.trim().length < 2) return setResults([])
    const t = setTimeout(() => void api.invoke('customers:search', query).then(setResults), 150)
    return () => clearTimeout(t)
  }, [query, customerMode])

  const chosen = useMemo(() => catalog.filter((c) => c.code in selected), [catalog, selected])
  const needsOwnership = chosen.some((c) => c.requiresOwnership)
  const wipeServices = chosen.filter((c) => c.mayWipeData)
  const policyConflict = wipeServices.length > 0 && dataPolicy === 'keep'
  const linkedLive = liveDevices.find((d) => d.serial === linkedSerial)
  const frpRisk = wipeServices.length > 0 && (linkedLive?.software?.googleAccounts ?? 0) > 0

  const servicesTotal = chosen.reduce((a, c) => a + parseEuroToCents(selected[c.code] ?? '0'), 0)
  const quoteAuto = money.quote.trim() === ''
  const cents = {
    quote: quoteAuto ? servicesTotal : parseEuroToCents(money.quote),
    external: parseEuroToCents(money.external),
    labor: parseEuroToCents(money.labor),
    deposit: parseEuroToCents(money.deposit)
  }
  const margin = computeMarginCents(cents.quote, cents.external, cents.labor)
  const marginPct = cents.quote > 0 ? Math.round((margin / cents.quote) * 100) : null

  const missing: string[] = []
  if (!(device.model.trim() || device.brand.trim())) missing.push('modello o marca')
  if (customerMode === 'existing' ? !picked : !customer.firstName.trim()) missing.push('cliente')
  if (!chosen.length) missing.push('almeno un intervento')
  if (!issue.trim()) missing.push('problema segnalato')
  if (needsOwnership && (!ownershipVerified || !ownershipProof)) missing.push('verifica della proprietà')
  if (policyConflict) missing.push('criterio sui dati compatibile')
  const canSave = missing.length === 0

  const toggleService = (c: ServiceCatalogItem) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (c.code in next) delete next[c.code]
      else next[c.code] = centsToField(c.defaultPriceCents)
      return next
    })
  }

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    const input: CreateRepairInput = {
      customer:
        customerMode === 'existing' && picked ? { mode: 'existing', id: picked.id } : { mode: 'new', ...customer },
      device,
      services: chosen.map((c) => ({
        code: c.code,
        priceCents: parseEuroToCents(selected[c.code] ?? '0'),
        label: c.category === 'generic' ? descr[c.code] : undefined
      })),
      reportedIssue: issue,
      dataPolicy,
      ownershipVerified: needsOwnership ? ownershipVerified : false,
      ownershipProof: needsOwnership ? ownershipProof : undefined,
      intakeNotes: notes,
      devicePasscode: passcode,
      priority,
      estimatedReadyAt: eta || undefined,
      quoteCents: cents.quote,
      externalCostCents: cents.external,
      laborCents: cents.labor,
      depositCents: cents.deposit
    }
    try {
      const repair = await api.invoke('repairs:create', input)
      toast.ok(`Scheda ${repair.ticketNumber} creata`)
      navigate(`/repairs/${repair.id}`)
    } catch (e) {
      toast.error((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSaving(false)
    }
  }

  // ref sempre aggiornato: le scorciatoie non devono ricrearsi a ogni tasto
  const saveRef = useRef(save)
  saveRef.current = save
  useHotkeys(
    useMemo(
      () => [
        { combo: 'ctrl+enter', handler: () => void saveRef.current(), allowInInputs: true },
        { combo: 'escape', handler: () => navigate(-1) }
      ],
      [navigate]
    )
  )

  const setD = (k: keyof DeviceForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setDevice({ ...device, [k]: e.target.value })

  return (
    <>
      <PageHeader
        title="Nuova scheda"
        subtitle="Accettazione al banco · intervento software"
        actions={
          <>
            <button className="btn-ghost" onClick={() => navigate(-1)}>
              Annulla <span className="kbd">Esc</span>
            </button>
            <button className="btn-primary" disabled={!canSave || saving} onClick={() => void save()}>
              <Check className="size-4" /> Crea scheda <span className="font-mono text-[10px] opacity-70">Ctrl ↵</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          {/* --- Dispositivo --- */}
          <Section
            title="Dispositivo"
            icon={<Smartphone className="size-4" />}
            aside={
              linkedSerial && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-2.5 py-0.5 text-xs text-signal">
                  <Usb className="size-3" /> Letto via USB
                  <button
                    title="Scollega"
                    onClick={() => {
                      setLinkedSerial(null)
                      setDevice(emptyDevice)
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )
            }
          >
            {liveDevices.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {liveDevices.map((d) => (
                  <button
                    key={d.serial}
                    onClick={() => {
                      setLinkedSerial(d.serial)
                      setDevice(fromLive(d))
                    }}
                    className={clsx(
                      'btn-ghost py-1.5 text-xs',
                      linkedSerial === d.serial && 'border-signal/60 text-signal'
                    )}
                  >
                    <Usb className="size-3.5" />
                    {d.marketName ?? d.model ?? d.serial}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-6 gap-4">
              <Field label="Piattaforma" className="col-span-2">
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1">
                  {(['android', 'ios'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDevice({ ...device, platform: p, brand: p === 'ios' ? 'Apple' : device.brand })}
                      className={clsx(
                        'btn py-1.5',
                        device.platform === p ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                      )}
                    >
                      {p === 'android' ? <Smartphone className="size-4" /> : <Apple className="size-4" />}
                      {p === 'android' ? 'Android' : 'iOS'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Marca" className="col-span-2">
                <input className="field" value={device.brand} onChange={setD('brand')} placeholder="Samsung" />
              </Field>
              <Field label="Colore" className="col-span-2">
                <input className="field" value={device.color} onChange={setD('color')} placeholder="Nero" />
              </Field>
              <Field label="Modello" className="col-span-3">
                <input
                  className="field"
                  value={device.model}
                  onChange={setD('model')}
                  placeholder="Galaxy S23 (SM-S911B)"
                />
              </Field>
              <Field label="Versione OS" className="col-span-3">
                <input
                  className="field"
                  value={device.osVersion}
                  onChange={setD('osVersion')}
                  placeholder="Android 14"
                />
              </Field>
              <Field label="Seriale" className="col-span-3">
                <input className="field font-mono" value={device.serial} onChange={setD('serial')} />
              </Field>
              <Field label="IMEI" className="col-span-3">
                <input
                  className="field font-mono"
                  value={device.imei}
                  onChange={setD('imei')}
                  placeholder="*#06# sul telefono"
                  inputMode="numeric"
                />
              </Field>
            </div>
          </Section>

          {/* --- Interventi --- */}
          <Section
            title="Interventi"
            icon={<ListChecks className="size-4" />}
            aside={
              chosen.length > 0 && <span className="font-mono text-sm text-ink-300">{formatCents(servicesTotal)}</span>
            }
          >
            <div className="flex flex-col gap-4">
              {CATEGORIES.map((cat) => {
                const items = catalog.filter((c) => c.category === cat)
                if (!items.length) return null
                return (
                  <div key={cat}>
                    <div className="label mb-2">{SERVICE_CATEGORY_LABEL[cat]}</div>
                    <div className="flex flex-wrap gap-2">
                      {items.map((c) => {
                        const on = c.code in selected
                        return (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => toggleService(c)}
                            className={clsx(
                              'btn border py-1.5 text-[13px]',
                              on
                                ? 'border-signal/60 bg-signal/10 text-signal'
                                : 'border-ink-700 bg-ink-800 text-ink-300 hover:border-ink-600 hover:text-ink-100'
                            )}
                          >
                            {on && <Check className="size-3.5" />}
                            {c.label}
                            {c.requiresOwnership && <ShieldCheck className="size-3.5 opacity-60" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {chosen.length > 0 && (
              <div className="mt-5 divide-y divide-ink-700 rounded-lg border border-ink-700">
                {chosen.map((c) => (
                  <div key={c.code} className="flex items-center gap-3 px-3 py-2">
                    {c.category === 'generic' ? (
                      <input
                        autoFocus
                        className="field flex-1 py-1.5 text-sm"
                        placeholder="Descrivi l’intervento (es. configurazione email aziendale)"
                        value={descr[c.code] ?? ''}
                        onChange={(e) => setDescr({ ...descr, [c.code]: e.target.value })}
                      />
                    ) : (
                      <span className="flex-1 text-sm">
                        {c.label}
                        {c.mayWipeData && (
                          <span className="ml-2 rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">
                            può cancellare i dati
                          </span>
                        )}
                      </span>
                    )}
                    <div className="relative w-32">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400">
                        €
                      </span>
                      <input
                        className="field py-1.5 pl-7 text-right font-mono tabular-nums"
                        inputMode="decimal"
                        value={selected[c.code]}
                        onChange={(e) => setSelected({ ...selected, [c.code]: e.target.value })}
                      />
                    </div>
                    <button className="text-ink-400 hover:text-bad" title="Rimuovi" onClick={() => toggleService(c)}>
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* --- Verifica proprietà (solo per sblocchi/account) --- */}
          {needsOwnership && (
            <Section title="Verifica proprietà" icon={<ShieldCheck className="size-4" />} tone="warn">
              <p className="mb-4 text-sm text-ink-300">
                Sblocchi e rimozione account si fanno solo per il legittimo proprietario. Registra quale prova hai
                visionato: resta nella scheda e nel report.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prova visionata">
                  <select className="field" value={ownershipProof} onChange={(e) => setOwnershipProof(e.target.value)}>
                    <option value="">Seleziona…</option>
                    {OWNERSHIP_PROOFS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="flex cursor-pointer items-center gap-3 self-end rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-signal)]"
                    checked={ownershipVerified}
                    onChange={(e) => setOwnershipVerified(e.target.checked)}
                  />
                  Ho verificato che il cliente è il proprietario
                </label>
              </div>
            </Section>
          )}

          {/* --- Cliente --- */}
          <Section
            title="Cliente"
            icon={customerMode === 'new' ? <UserPlus className="size-4" /> : <UserSearch className="size-4" />}
            aside={
              <div className="flex rounded-lg border border-ink-700 bg-ink-800 p-0.5 text-xs">
                {(['new', 'existing'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCustomerMode(m)}
                    className={clsx(
                      'rounded-md px-3 py-1',
                      customerMode === m ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                    )}
                  >
                    {m === 'new' ? 'Nuovo' : 'Esistente'}
                  </button>
                ))}
              </div>
            }
          >
            {customerMode === 'new' ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nome *">
                  <input
                    className="field"
                    value={customer.firstName}
                    onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })}
                  />
                </Field>
                <Field label="Cognome">
                  <input
                    className="field"
                    value={customer.lastName}
                    onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })}
                  />
                </Field>
                <Field label="Telefono (WhatsApp)">
                  <input
                    className="field font-mono"
                    value={customer.phone}
                    onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                    placeholder="+39 333 1234567"
                    inputMode="tel"
                  />
                </Field>
                <Field label="Email">
                  <input
                    className="field"
                    type="email"
                    value={customer.email}
                    onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  />
                </Field>
              </div>
            ) : picked ? (
              <div className="flex items-center justify-between rounded-lg border border-signal/30 bg-signal/5 px-4 py-3">
                <div>
                  <div className="font-medium">
                    {picked.firstName} {picked.lastName}
                  </div>
                  <div className="font-mono text-xs text-ink-300">{picked.phone ?? picked.email ?? '—'}</div>
                </div>
                <button className="btn-ghost py-1 text-xs" onClick={() => setPicked(null)}>
                  Cambia
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  className="field"
                  autoFocus
                  placeholder="Nome, cognome o telefono…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {results.length > 0 && (
                  <ul className="panel absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto shadow-2xl shadow-black/60">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink-800"
                          onClick={() => setPicked(c)}
                        >
                          <span>
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="font-mono text-xs text-ink-400">{c.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && results.length === 0 && (
                  <p className="mt-2 text-xs text-ink-400">Nessun cliente trovato.</p>
                )}
              </div>
            )}
          </Section>

          {/* --- Problema e dati --- */}
          <Section title="Problema e dati del cliente" icon={<ClipboardCheck className="size-4" />}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Problema segnalato dal cliente *" className="col-span-2">
                <textarea
                  ref={issueRef}
                  rows={3}
                  className="field resize-none"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  placeholder="Es. si blocca sul logo Samsung dopo un aggiornamento, non entra in Android"
                />
              </Field>

              <Field label="Dati del cliente" className="col-span-2">
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1">
                  {DATA_POLICIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDataPolicy(p)}
                      className={clsx(
                        'btn py-1.5',
                        dataPolicy === p ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100'
                      )}
                    >
                      <Database className="size-3.5" />
                      {DATA_POLICY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </Field>
              {policyConflict && (
                <div className="col-span-2 flex gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
                  <TriangleAlert className="size-4 shrink-0" />
                  {wipeServices.map((w) => `"${w.label}"`).join(', ')} può cancellare i dati. Concorda con il cliente un
                  backup prima, oppure conferma che i dati non servono.
                </div>
              )}
              {frpRisk && (
                <div className="col-span-2 flex gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">
                  <TriangleAlert className="size-4 shrink-0" />
                  Sul telefono c’è un account Google: dopo il reset servirà la sua password (FRP). Verifica che il
                  cliente la ricordi o fagli rimuovere l’account prima.
                </div>
              )}

              <Field label="Note accettazione" className="col-span-2">
                <textarea
                  rows={2}
                  className="field resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Es. consegnato senza SIM, cover lasciata al cliente, ricorda la password Google"
                />
              </Field>
              <Field label="Codice sblocco fornito dal cliente">
                <input
                  className="field font-mono"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label="Pronto previsto">
                <input
                  type="date"
                  className="field [color-scheme:dark]"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                />
              </Field>
              <Field label="Priorità" className="col-span-2">
                <div className="grid grid-cols-4 gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={clsx(
                        'btn py-1.5',
                        priority === p.value
                          ? p.value === 'urgent'
                            ? 'bg-bad/20 text-bad'
                            : p.value === 'high'
                              ? 'bg-warn/20 text-warn'
                              : 'bg-ink-600 text-ink-100'
                          : 'text-ink-400 hover:text-ink-100'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>
        </div>

        {/* --- Economia (sticky) --- */}
        <aside className="xl:sticky xl:top-0 xl:self-start">
          <section className="panel p-5">
            <h2 className="mb-4 font-display text-[15px] font-semibold">Preventivo & margine</h2>
            <div className="flex flex-col gap-3">
              <Field label="Preventivo al cliente">
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400">€</span>
                  <input
                    className="field pr-20 pl-7 text-right font-mono tabular-nums"
                    inputMode="decimal"
                    placeholder={centsToField(servicesTotal)}
                    value={money.quote}
                    onChange={(e) => setMoney({ ...money, quote: e.target.value })}
                  />
                  {quoteAuto ? (
                    <span className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded bg-signal/10 px-1.5 py-0.5 text-[10px] text-signal">
                      auto
                    </span>
                  ) : (
                    <button
                      title="Torna alla somma degli interventi"
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-400 hover:text-signal"
                      onClick={() => setMoney({ ...money, quote: '' })}
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  )}
                </div>
              </Field>
              {(
                [
                  ['external', 'Costi esterni (crediti, licenze)'],
                  ['labor', 'Costo manodopera (interno)'],
                  ['deposit', 'Acconto ricevuto']
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400">€</span>
                    <input
                      className="field pl-7 text-right font-mono tabular-nums"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={money[k]}
                      onChange={(e) => setMoney({ ...money, [k]: e.target.value })}
                    />
                  </div>
                </Field>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-ink-700 bg-ink-900 p-4">
              <div className="flex items-baseline justify-between">
                <span className="label">Margine</span>
                {marginPct !== null && <span className="font-mono text-xs text-ink-400">{marginPct}%</span>}
              </div>
              <div
                className={clsx(
                  'mt-1 font-display text-3xl font-semibold tabular-nums',
                  margin < 0 ? 'text-bad' : margin > 0 ? 'text-ok' : 'text-ink-300'
                )}
              >
                {formatCents(margin)}
              </div>
              <div className="mt-3 flex justify-between border-t border-ink-700 pt-3 text-sm">
                <span className="text-ink-300">Da incassare al ritiro</span>
                <span className="font-mono tabular-nums">{formatCents(Math.max(0, cents.quote - cents.deposit))}</span>
              </div>
            </div>

            <button
              className="btn-primary mt-5 w-full py-2.5"
              disabled={!canSave || saving}
              onClick={() => void save()}
            >
              <Check className="size-4" /> {saving ? 'Salvataggio…' : 'Crea scheda'}
            </button>
            {!canSave && <p className="mt-2 text-center text-xs text-ink-400">Manca: {missing.join(', ')}.</p>}
          </section>
        </aside>
      </div>
    </>
  )
}
