import { cn } from '../lib/utils'
import type { ListingStatus } from '../data/types'

const LISTING_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'badge-success' },
  draft: { label: 'Draft', cls: 'badge-neutral' },
  ended: { label: 'Ended', cls: 'badge-error' },
  unknown: { label: 'Unknown', cls: 'badge-warning' },
  out_of_stock: { label: 'Out of Stock', cls: 'badge-error' },
  untracked: { label: 'Untracked', cls: 'badge-neutral' },
  delisted_cold: { label: 'Delisted (cold)', cls: 'badge-neutral' },
}

// Accepts any string: the database can hold statuses this UI doesn't know yet, and an unknown
// one must show as a plain badge with its raw value instead of crashing the whole page.
export function StatusBadge({ status }: { status: ListingStatus | (string & {}) | null | undefined }) {
  const raw = String(status ?? '').trim()
  const known = LISTING_STATUS_BADGES[raw]
  if (known) return <span className={cn(known.cls)}>{known.label}</span>
  return <span className={cn('badge-neutral')} title="Unrecognized status">{raw || '—'}</span>
}

export function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'badge-warning',
    shipped: 'badge-info',
    delivered: 'badge-success',
    cancelled: 'badge-error',
  }
  return <span className={cn(map[status] || 'badge-neutral')}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
}

export function BulkStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'badge-info',
    completed: 'badge-success',
    failed: 'badge-error',
    paused: 'badge-warning',
  }
  return <span className={cn(map[status] || 'badge-neutral')}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
}
