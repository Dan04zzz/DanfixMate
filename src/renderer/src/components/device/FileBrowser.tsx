import clsx from 'clsx'
import {
  ArrowUp,
  Check,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image,
  Loader2,
  Music,
  Package,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FileEntry, FileListing } from '@shared/types'
import { useHotkeys } from '../../hooks/useHotkeys'
import { act, api, errMsg, formatDateTime, formatSize } from '../../lib/api'
import { toast } from '../../store/toast'
import { ConfirmButton } from '../ConfirmButton'

const ROOTS = [
  { label: 'Memoria interna', path: '/sdcard' },
  { label: 'DCIM', path: '/sdcard/DCIM' },
  { label: 'Download', path: '/sdcard/Download' },
  { label: 'WhatsApp', path: '/sdcard/Android/media/com.whatsapp/WhatsApp' },
  { label: 'Radice /', path: '/' }
]

const EXT_ICON: [RegExp, typeof File][] = [
  [/\.(jpe?g|png|gif|webp|heic|heif|bmp|dng)$/i, Image],
  [/\.(mp4|mov|3gp|mkv|avi|webm)$/i, Film],
  [/\.(mp3|m4a|ogg|opus|wav|aac|amr|flac)$/i, Music],
  [/\.(pdf|docx?|xlsx?|pptx?|txt|odt|csv)$/i, FileText],
  [/\.(zip|rar|7z|tar|gz|crypt\d+)$/i, FileArchive],
  [/\.(apk|apks|xapk)$/i, Package]
]
const iconFor = (e: FileEntry) => (e.type === 'dir' ? Folder : (EXT_ICON.find(([re]) => re.test(e.name))?.[1] ?? File))

/** Le modifiche sono consentite solo nella memoria utente (come nel processo principale). */
const isWritable = (p: string) => /^\/(sdcard|storage\/emulated\/0|storage\/[0-9A-F]{4}-[0-9A-F]{4})\/.+/i.test(p)

const parentOf = (p: string) => (p === '/' ? '/' : p.replace(/\/[^/]+\/?$/, '') || '/')

export function FileBrowser({ serial }: { serial: string }) {
  const [path, setPath] = useState('/sdcard')
  const [listing, setListing] = useState<FileListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)

  const load = useCallback(
    async (p: string) => {
      setLoading(true)
      try {
        const l = await api.invoke('files:list', serial, p)
        setListing(l)
        setPath(l.path)
        setSelected(new Set())
        setFilter('')
      } catch (e) {
        toast.error(errMsg(e))
      } finally {
        setLoading(false)
      }
    },
    [serial]
  )

  useEffect(() => void load('/sdcard'), [load])

  // dopo un caricamento sul telefono ricarica la cartella
  useEffect(() => {
    const onDone = (ev: Event) => {
      const j = (ev as CustomEvent).detail as { kind: string; serial: string }
      if (j.kind === 'push' && j.serial === serial) void load(path)
    }
    window.addEventListener('danfixmate:job-finished', onDone)
    return () => window.removeEventListener('danfixmate:job-finished', onDone)
  }, [serial, path, load])

  const entries = useMemo(() => {
    const all = listing?.entries ?? []
    const f = filter.trim().toLowerCase()
    return f ? all.filter((e) => e.name.toLowerCase().includes(f)) : all
  }, [listing, filter])

  const writable = isWritable(path + '/x')
  const selection = entries.filter((e) => selected.has(e.path))
  const selectionSize = selection.filter((e) => e.type !== 'dir').reduce((a, e) => a + e.size, 0)
  const crumbs = path === '/' ? [] : path.split('/').filter(Boolean)

  const toggle = (p: string, only = false) =>
    setSelected((prev) => {
      const next = new Set(only ? [] : prev)
      if (prev.has(p) && !only) next.delete(p)
      else next.add(p)
      return next
    })

  const remove = async () => {
    const r = await act(api.invoke('files:delete', serial, [...selected]), toast)
    if (r?.ok) void load(path)
  }
  const createDir = async () => {
    const name = creating?.trim()
    if (!name) return setCreating(null)
    const r = await act(api.invoke('files:mkdir', serial, `${path}/${name}`), toast)
    setCreating(null)
    if (r?.ok) void load(path)
  }
  const doRename = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    const original = renaming.path.split('/').pop()
    if (!name || name === original) return setRenaming(null)
    const r = await act(api.invoke('files:rename', serial, renaming.path, `${parentOf(renaming.path)}/${name}`), toast)
    setRenaming(null)
    if (r?.ok) void load(path)
  }

  useHotkeys(
    useMemo(
      () => [
        { combo: 'f5', handler: () => void load(path) },
        { combo: 'backspace', handler: () => path !== '/' && void load(parentOf(path)) },
        { combo: 'ctrl+a', handler: () => setSelected(new Set(entries.map((e) => e.path))), noInputs: true }
      ],
      [load, path, entries]
    )
  )

  return (
    <div className="flex flex-col gap-4">
      {/* scorciatoie cartelle */}
      <div className="flex flex-wrap items-center gap-2">
        {ROOTS.map((r) => (
          <button
            key={r.path}
            onClick={() => void load(r.path)}
            className={clsx(
              'btn border py-1.5 text-xs',
              path === r.path
                ? 'border-signal/60 bg-signal/10 text-signal'
                : 'border-ink-700 bg-ink-800 text-ink-300 hover:text-ink-100'
            )}
          >
            {r.path === '/' ? <HardDrive className="size-3.5" /> : <Folder className="size-3.5" />}
            {r.label}
          </button>
        ))}
      </div>

      <div className="panel overflow-hidden">
        {/* barra percorso + azioni */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
          <button
            className="btn-ghost px-2"
            title="Cartella superiore (Backspace)"
            disabled={path === '/'}
            onClick={() => void load(parentOf(path))}
          >
            <ArrowUp className="size-4" />
          </button>
          <button className="btn-ghost px-2" title="Aggiorna (F5)" onClick={() => void load(path)}>
            <RefreshCw className={clsx('size-4', loading && 'animate-spin')} />
          </button>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-[13px]">
            <button
              className="rounded px-1.5 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
              onClick={() => void load('/')}
            >
              /
            </button>
            {crumbs.map((c, i) => {
              const p = '/' + crumbs.slice(0, i + 1).join('/')
              return (
                <span key={p} className="flex items-center">
                  <ChevronRight className="size-3.5 text-ink-600" />
                  <button
                    className={clsx(
                      'rounded px-1.5 py-1 whitespace-nowrap hover:bg-ink-800',
                      i === crumbs.length - 1 ? 'text-ink-100' : 'text-ink-300 hover:text-ink-100'
                    )}
                    onClick={() => void load(p)}
                  >
                    {c}
                  </button>
                </span>
              )
            })}
          </nav>
          <input
            className="field w-48 py-1.5 text-sm"
            placeholder="Filtra…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn-ghost"
            disabled={!writable}
            onClick={() => setCreating('')}
            title={writable ? '' : 'Solo nella memoria utente'}
          >
            <FolderPlus className="size-4" /> Cartella
          </button>
          <button
            className="btn-ghost"
            disabled={!writable}
            title={writable ? '' : 'Solo nella memoria utente'}
            onClick={() => void act(api.invoke('files:push', serial, path), toast)}
          >
            <Upload className="size-4" /> Carica
          </button>
        </div>

        {/* barra selezione */}
        {selection.length > 0 && (
          <div className="flex items-center gap-3 border-b border-ink-700 bg-signal/5 px-4 py-2 text-sm">
            <span className="text-signal">
              {selection.length} selezionati{selectionSize > 0 && ` · ${formatSize(selectionSize)}`}
            </span>
            <button
              className="btn-primary ml-auto py-1.5"
              onClick={() => void act(api.invoke('files:pull', serial, [...selected]), toast)}
            >
              <Download className="size-4" /> Scarica sul PC
            </button>
            {selection.length === 1 && isWritable(selection[0].path) && (
              <button
                className="btn-ghost py-1.5"
                onClick={() => setRenaming({ path: selection[0].path, name: selection[0].name })}
              >
                <Pencil className="size-4" /> Rinomina
              </button>
            )}
            <ConfirmButton
              danger
              className="py-1.5"
              icon={<Trash2 className="size-4" />}
              label="Elimina"
              confirmLabel={`Elimina ${selection.length} definitivamente?`}
              disabled={!selection.every((e) => isWritable(e.path))}
              title={
                selection.every((e) => isWritable(e.path)) ? '' : 'Eliminazione consentita solo nella memoria utente'
              }
              onConfirm={() => void remove()}
            />
            <button
              className="text-ink-400 hover:text-ink-100"
              onClick={() => setSelected(new Set())}
              title="Deseleziona"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* intestazione */}
        <div className="grid grid-cols-[32px_1fr_110px_150px] gap-3 border-b border-ink-700 px-4 py-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-signal)]"
            checked={entries.length > 0 && selection.length === entries.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(entries.map((x) => x.path)) : new Set())}
          />
          <span className="label">Nome</span>
          <span className="label text-right">Dimensione</span>
          <span className="label">Modificato</span>
        </div>

        <div className="max-h-[calc(100vh-380px)] min-h-64 overflow-y-auto">
          {creating !== null && (
            <div className="grid grid-cols-[32px_1fr] items-center gap-3 border-b border-ink-700/60 bg-ink-800/50 px-4 py-2">
              <FolderPlus className="size-4 text-signal" />
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="field py-1 text-sm"
                  placeholder="Nome nuova cartella"
                  value={creating}
                  onChange={(e) => setCreating(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createDir()
                    if (e.key === 'Escape') setCreating(null)
                  }}
                />
                <button className="btn-primary py-1" onClick={() => void createDir()}>
                  <Check className="size-4" />
                </button>
              </div>
            </div>
          )}

          {loading && !listing && (
            <div className="grid place-items-center py-16 text-ink-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          )}
          {listing?.error && <p className="px-4 py-10 text-center text-sm text-warn">{listing.error}</p>}
          {listing && !listing.error && entries.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-ink-400">
              {filter ? 'Nessun risultato' : 'Cartella vuota'}
            </p>
          )}

          {entries.map((e) => {
            const Icon = iconFor(e)
            const isSel = selected.has(e.path)
            return (
              <div
                key={e.path}
                onClick={(ev) => toggle(e.path, !(ev.ctrlKey || ev.metaKey))}
                onDoubleClick={() => e.type === 'dir' && void load(e.path)}
                className={clsx(
                  'grid cursor-default grid-cols-[32px_1fr_110px_150px] items-center gap-3 border-b border-ink-700/40 px-4 py-1.5 text-sm select-none',
                  isSel ? 'bg-signal/10' : 'hover:bg-ink-800/60'
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-signal)]"
                  checked={isSel}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => toggle(e.path)}
                />
                {renaming?.path === e.path ? (
                  <input
                    autoFocus
                    className="field py-1 text-sm"
                    value={renaming.name}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => setRenaming({ ...renaming, name: ev.target.value })}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') void doRename()
                      if (ev.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => void doRename()}
                  />
                ) : (
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon className={clsx('size-4 shrink-0', e.type === 'dir' ? 'text-signal' : 'text-ink-400')} />
                    <span className={clsx('truncate', e.name.startsWith('.') && 'text-ink-400')}>{e.name}</span>
                  </span>
                )}
                <span className="text-right font-mono text-xs text-ink-300 tabular-nums">
                  {e.type === 'dir' ? '' : formatSize(e.size)}
                </span>
                <span className="text-xs text-ink-400">{formatDateTime(e.modified)}</span>
              </div>
            )
          })}
        </div>
        <div className="border-t border-ink-700 px-4 py-2 text-xs text-ink-400">
          {listing ? `${entries.length} elementi` : ''} · doppio clic per aprire · Ctrl+clic per selezione multipla ·
          Backspace per salire
        </div>
      </div>
    </div>
  )
}
