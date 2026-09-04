import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  Search, Filter, Edit2, Pencil, CheckSquare,
  Square, ArrowUpDown, Tag, ShoppingBag, AlertCircle, Loader2, ChevronDown,
  ChevronLeft, ChevronRight, MoreVertical, XCircle, Unlink2, Trash2,
} from 'lucide-react'
import { StatusBadge } from '../components/Badges'
import { EmptyState } from '../components/UI'
import { useStoreData } from '../lib/DataContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'
import type { ListingStatus } from '../data/types'

const PAGE_SIZE = 100

function markupPct(ebayPrice: number, amazonPrice: number): string | null {
  if (!amazonPrice || amazonPrice <= 0) return null
  const pct = ((ebayPrice - amazonPrice) / amazonPrice) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

// "6 days ago" / "1 hour ago" style relative time, used for List Date.
function timeAgo(dateInput: string | number | Date): string {
  const date = new Date(dateInput)
  if (isNaN(date.getTime())) return '—'
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
}

// Same badge style as the shared StatusBadge, except "active" reads as "Synced" —
// only in this table, so other screens that use StatusBadge are untouched.
function ListingStatusPill({ status }: { status: ListingStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-success-50 text-success-700">
        <span className="w-1.5 h-1.5 rounded-full bg-success-500" /> Synced
      </span>
    )
  }
  return <StatusBadge status={status} />
}

// Renders a small, polished action menu anchored to a trigger button, drawn via a portal
// at a fixed screen position — this avoids a real browser quirk where position:absolute
// dropdowns inside a <table> cell get clipped/misplaced by the table's own layout box.
function ActionMenu({
  anchorRect,
  onClose,
  items,
}: {
  anchorRect: DOMRect
  onClose: () => void
  items: Array<{ label: string; description?: string; onClick: () => void; danger?: boolean; icon: React.ComponentType<{ className?: string }> }>
}) {
  const menuWidth = 280
  const top = anchorRect.bottom + 8
  const left = Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8)

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5"
        style={{ top, left: Math.max(left, 8), width: menuWidth }}
      >
        {items.map((item, idx) => (
          <button
            key={idx}
            onClick={() => { item.onClick(); onClose() }}
            className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-slate-50 transition-colors"
          >
            <span className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
              item.danger ? 'bg-error-50 text-error-600' : 'bg-slate-100 text-slate-500',
            )}>
              <item.icon className="w-4 h-4" />
            </span>
            <span className="flex flex-col">
              <span className={cn('text-sm font-medium', item.danger ? 'text-error-700' : 'text-slate-800')}>{item.label}</span>
              {item.description && <span className="text-xs text-slate-400 mt-0.5 leading-snug">{item.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}

export default function Listings() {
  const { listings, loading, endListing, removeListingLocal, updateListing, stores, syncAllEbayListings } = useStoreData()
  const activeStore = stores.find(s => s.active) || stores[0]
  const [syncingFromEbay, setSyncingFromEbay] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  async function handleSyncFromEbay() {
    if (!activeStore) return
    setSyncingFromEbay(true)
    setSyncMessage(null)
    try {
      const result = await syncAllEbayListings(activeStore.id)
      setSyncMessage(`Found ${result.totalFound} listing${result.totalFound === 1 ? '' : 's'} on eBay — ${result.synced} synced${result.failed > 0 ? `, ${result.failed} failed` : ''}.`)
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingFromEbay(false)
    }
  }

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ListingStatus | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [sortField, setSortField] = useState<'title' | 'ebayPrice' | 'soldCount' | 'listedDate'>('listedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let result = listings.filter(l => {
      const matchSearch = l.title.toLowerCase().includes(search.toLowerCase()) || l.asin.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || l.status === statusFilter
      return matchSearch && matchStatus
    })
    result = [...result].sort((a, b) => {
      let av = a[sortField] as string | number
      let bv = b[sortField] as string | number
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return result
  }, [listings, search, statusFilter, sortField, sortDir])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  )

  const allSelected = paged.length > 0 && paged.every(l => selected.includes(l.id))

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(prev => prev.filter(id => !paged.some(l => l.id === id)))
    } else {
      setSelected(prev => Array.from(new Set([...prev, ...paged.map(l => l.id)])))
    }
  }

  async function handleDeleteOne(listing: typeof listings[number], mode: 'ebay' | 'local') {
    const confirmMsg = mode === 'ebay'
      ? `End "${listing.title}" on eBay and remove it? This cannot be undone.`
      : `Remove "${listing.title}" from this app only? The listing on eBay (if any) will stay untouched.`
    if (!window.confirm(confirmMsg)) return

    setActionError(null)
    setDeletingId(listing.id)
    try {
      if (mode === 'ebay') {
        await endListing(listing.storeId, listing.id, listing.asin || undefined)
      } else {
        await removeListingLocal(listing.id)
      }
      setSelected(prev => prev.filter(id => id !== listing.id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete listing')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleBulkEnd(mode: 'ebay' | 'local') {
    setBulkMenuOpen(false)
    const targets = listings.filter(l => selected.includes(l.id))
    if (targets.length === 0) return
    const confirmMsg = mode === 'ebay'
      ? `End ${targets.length} listing${targets.length === 1 ? '' : 's'} on eBay? This cannot be undone.`
      : `Remove ${targets.length} listing${targets.length === 1 ? '' : 's'} from this app only? Nothing changes on eBay.`
    if (!window.confirm(confirmMsg)) return

    setActionError(null)
    setBulkRunning(true)
    const failures: string[] = []
    for (const l of targets) {
      try {
        if (mode === 'ebay') {
          await endListing(l.storeId, l.id, l.asin || undefined)
        } else {
          await removeListingLocal(l.id)
        }
      } catch (err) {
        failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    setBulkRunning(false)
    setSelected([])
    if (failures.length > 0) setActionError(failures.slice(0, 3).join(' | '))
  }

  async function handleBulkEditQuantity() {
    const targets = listings.filter(l => selected.includes(l.id))
    if (targets.length === 0) return
    const input = window.prompt(`Set quantity for ${targets.length} listing${targets.length === 1 ? '' : 's'}:`, String(targets[0].quantity))
    if (input === null) return
    const qty = Math.max(0, Math.floor(Number(input)))
    if (!Number.isFinite(qty)) return

    setActionError(null)
    setBulkRunning(true)
    const failures: string[] = []
    for (const l of targets) {
      try {
        if (l.ebayId) {
          await updateListing(l.storeId, { sku: l.asin, quantity: qty })
        } else {
          const { error } = await supabase.from('listings').update({ quantity: qty }).eq('id', l.id)
          if (error) throw new Error(error.message)
        }
      } catch (err) {
        failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    setBulkRunning(false)
    setSelected([])
    if (failures.length > 0) setActionError(failures.slice(0, 3).join(' | '))
  }

  async function handleBulkSetMargin() {
    const targets = listings.filter(l => selected.includes(l.id))
    if (targets.length === 0) return
    const input = window.prompt(`Set profit margin % (over Amazon cost) for ${targets.length} listing${targets.length === 1 ? '' : 's'}:`, '20')
    if (input === null) return
    const marginPct = Number(input)
    if (!Number.isFinite(marginPct)) return

    setActionError(null)
    setBulkRunning(true)
    const failures: string[] = []
    for (const l of targets) {
      try {
        const newPrice = Math.round(l.amazonPrice * (1 + marginPct / 100) * 100) / 100
        if (l.ebayId) {
          await updateListing(l.storeId, { sku: l.asin, price: newPrice })
        } else {
          const { error } = await supabase.from('listings').update({ ebay_price: newPrice }).eq('id', l.id)
          if (error) throw new Error(error.message)
        }
      } catch (err) {
        failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    setBulkRunning(false)
    setSelected([])
    if (failures.length > 0) setActionError(failures.slice(0, 3).join(' | '))
  }

  const statusOptions: { value: ListingStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'draft', label: 'Drafts' },
    { value: 'ended', label: 'Ended' },
    { value: 'out_of_stock', label: 'Out of Stock' },
    { value: 'unknown', label: 'Unknown' },
  ]

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or ASIN…"
            className="input pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ListingStatus | 'all')}
            className="input w-auto"
          >
            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => void handleSyncFromEbay()}
          disabled={syncingFromEbay || !activeStore}
          className="btn-secondary shrink-0 disabled:opacity-50"
        >
          {syncingFromEbay ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpDown className="w-4 h-4" />}
          {syncingFromEbay ? 'Syncing…' : 'Sync from eBay'}
        </button>
      </div>
      {syncMessage && (
        <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-4 py-2">{syncMessage}</div>
      )}

      {selected.length > 0 && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-2">
          <span className="text-sm font-medium text-brand-700">{selected.length} selected</span>
          <div className="flex-1" />
          <button onClick={() => void handleBulkEditQuantity()} disabled={bulkRunning} className="btn-ghost text-sm disabled:opacity-50">
            {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />} Edit Quantity
          </button>
          <button onClick={() => void handleBulkSetMargin()} disabled={bulkRunning} className="btn-ghost text-sm disabled:opacity-50">
            {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />} Set Margin %
          </button>
          <div className="relative">
            <button
              onClick={() => setBulkMenuOpen(o => !o)}
              disabled={bulkRunning}
              className="btn-ghost text-sm text-error-600 hover:bg-error-50 disabled:opacity-50"
            >
              {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remove <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {bulkMenuOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg border border-slate-200 shadow-lg z-10 py-1">
                <button
                  onClick={() => void handleBulkEnd('ebay')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex flex-col"
                >
                  <span className="font-medium">End on eBay</span>
                  <span className="text-xs text-slate-400">Ends the real eBay listing, then removes it here</span>
                </button>
                <button
                  onClick={() => void handleBulkEnd('local')}
                  className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex flex-col"
                >
                  <span className="font-medium">Remove from automation only</span>
                  <span className="text-xs text-slate-400">Stops tracking here — eBay is untouched. Use if your eBay connection is broken.</span>
                </button>
              </div>
            )}
          </div>
          <button className="btn-ghost text-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No listings found" subtitle="Try adjusting your filters or connect a store and sync." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                  <th className="px-4 py-3 w-10">
                    <button onClick={toggleSelectAll}>
                      {allSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">
                    <button onClick={() => toggleSort('title')} className="flex items-center gap-1 hover:text-slate-700">
                      Listing <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Listing</th>
                  <th className="px-4 py-3 font-medium text-right">Amazon</th>
                  <th className="px-4 py-3 font-medium text-right">
                    <button onClick={() => toggleSort('ebayPrice')} className="flex items-center gap-1 hover:text-slate-700 ml-auto">
                      eBay <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium text-right">
                    <button onClick={() => toggleSort('soldCount')} className="flex items-center gap-1 hover:text-slate-700 ml-auto">
                      Sold <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">
                    <button onClick={() => toggleSort('listedDate')} className="flex items-center gap-1 hover:text-slate-700">
                      List Date <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">Last Sale</th>
                  <th className="px-4 py-3 font-medium">Checked</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(listing => {
                  const pct = markupPct(listing.ebayPrice, listing.amazonPrice)
                  return (
                  <tr key={listing.id} className="border-b border-slate-100 table-row-hover">
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSelect(listing.id)}>
                        {selected.includes(listing.id) ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img src={listing.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                        <Link to={`/listings/${listing.id}`} className="font-medium text-slate-900 hover:text-brand-600 truncate max-w-xs">
                          {listing.title}
                        </Link>
                        {listing.promoted && <span className="badge-info text-xs">Promoted</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {listing.asin ? (
                        <a
                          href={`https://www.amazon.com/dp/${listing.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="font-mono text-xs text-brand-600 hover:underline"
                        >
                          {listing.asin}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {listing.ebayId ? (
                        <a
                          href={`https://www.ebay.com/itm/${listing.ebayId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="font-mono text-xs text-brand-600 hover:underline"
                        >
                          {listing.ebayId}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(listing.amazonPrice)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-medium text-slate-900">
                        {formatCurrency(listing.ebayPrice)}
                        {pct && <span className="ml-1 text-xs font-medium text-success-600">({pct})</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{listing.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{listing.soldCount}</td>
                    <td className="px-4 py-3"><ListingStatusPill status={listing.status} /></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{timeAgo(listing.listedDate)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">Never</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {listing.checkedDate ? timeAgo(listing.checkedDate) : <span className="text-slate-400">Not yet</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/listings/${listing.id}`} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition">
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setMenuAnchorRect(rect)
                            setOpenMenuId(openMenuId === listing.id ? null : listing.id)
                          }}
                          disabled={deletingId === listing.id}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition disabled:opacity-50"
                        >
                          {deletingId === listing.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between flex-wrap gap-2">
          <span>
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} listings
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              disabled={currentPage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-slate-400">Page {currentPage} of {totalPages}</span>
            <button
              className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {openMenuId && menuAnchorRect && (() => {
        const listing = listings.find(l => l.id === openMenuId)
        if (!listing) return null
        return (
          <ActionMenu
            anchorRect={menuAnchorRect}
            onClose={() => setOpenMenuId(null)}
            items={[
              {
                label: 'End on eBay',
                description: 'Ends the real eBay listing, then removes it here',
                onClick: () => void handleDeleteOne(listing, 'ebay'),
                icon: XCircle,
                danger: true,
              },
              {
                label: 'Remove from automation only',
                description: "Stops tracking here — eBay is untouched. Use if your eBay connection is broken.",
                onClick: () => void handleDeleteOne(listing, 'local'),
                icon: Unlink2,
              },
            ]}
          />
        )
      })()}
    </div>
  )
}
