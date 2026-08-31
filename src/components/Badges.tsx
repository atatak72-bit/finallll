import { cn } from '../lib/utils'
import type { ListingStatus } from '../data/types'

export function StatusBadge({ status }: { status: ListingStatus }) {
  const map: Record<ListingStatus, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'badge-success' },
    draft: { label: 'Draft', cls: 'badge-neutral' },
    ended: { label: 'Ended', cls: 'badge-error' },
    unknown: { label: 'Unknown', cls: 'badge-warning' },
    out_of_stock: { label: 'Out of Stock', cls: 'badge-error' },
  }
  const { label, cls } = map[status]
  return <span className={cn(cls)}>{label}</span>
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
