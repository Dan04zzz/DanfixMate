import clsx from 'clsx'
import { REPAIR_STATUS_LABEL, type RepairStatus } from '@shared/types'

export const STATUS_COLOR: Record<RepairStatus, string> = {
  intake: 'text-ink-300 bg-ink-700/60 border-ink-600',
  diagnosis: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
  in_progress: 'text-signal bg-signal/10 border-signal/30',
  waiting_customer: 'text-warn bg-warn/10 border-warn/30',
  ready: 'text-ok bg-ok/10 border-ok/30',
  delivered: 'text-ink-400 bg-transparent border-ink-700'
}

export const STATUS_DOT: Record<RepairStatus, string> = {
  intake: 'bg-ink-300',
  diagnosis: 'bg-violet-400',
  in_progress: 'bg-signal',
  waiting_customer: 'bg-warn',
  ready: 'bg-ok',
  delivered: 'bg-ink-600'
}

export function StatusPill({ status }: { status: RepairStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_COLOR[status]
      )}
    >
      <span className={clsx('size-1.5 rounded-full', STATUS_DOT[status])} />
      {REPAIR_STATUS_LABEL[status]}
    </span>
  )
}
