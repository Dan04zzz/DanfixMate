import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'

/** Pulsante a doppia conferma: il primo click arma, il secondo esegue (niente modali al banco). */
export function ConfirmButton({
  icon,
  label,
  confirmLabel = 'Conferma?',
  onConfirm,
  disabled,
  danger,
  className,
  title
}: {
  icon?: ReactNode
  label: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  danger?: boolean
  className?: string
  title?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  useEffect(() => {
    if (disabled) setArmed(false)
  }, [disabled])
  return (
    <button
      disabled={disabled}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
      className={clsx(
        'btn-ghost',
        className,
        armed &&
          (danger
            ? 'border-bad/60 bg-bad/10 text-bad hover:bg-bad/15'
            : 'border-warn/60 bg-warn/10 text-warn hover:bg-warn/15')
      )}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  )
}
