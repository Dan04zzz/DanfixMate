import clsx from 'clsx'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToast } from '../store/toast'

export function Toaster() {
  const { toasts, dismiss } = useToast()
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === 'ok' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={clsx(
              'panel pointer-events-auto flex min-w-72 items-center gap-3 px-4 py-3 text-left text-sm shadow-2xl shadow-black/60',
              t.kind === 'ok' && 'border-ok/40',
              t.kind === 'error' && 'border-bad/40'
            )}
          >
            <Icon
              className={clsx(
                'size-4 shrink-0',
                t.kind === 'ok' ? 'text-ok' : t.kind === 'error' ? 'text-bad' : 'text-signal'
              )}
            />
            {t.text}
          </button>
        )
      })}
    </div>
  )
}
