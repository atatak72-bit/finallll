import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  Search, Filter, Edit2, Pencil, CheckSquare,
  Square, ArrowUpDown, Tag, ShoppingBag, AlertCircle, Loader2, ChevronDown,
  ChevronLeft, ChevronRight, MoreVertical, XCircle, Unlink2, Trash2, Copy,
} from 'lucide-react'
import { StatusBadge } from '../components/Badges'
import { EmptyState } from '../components/UI'
import { useStoreData } from '../lib/DataContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn, calculateEbayPrice, numberOr } from '../lib/utils'
import { listingSku, type AppListing, type AppListingStatus, type AmazonProduct } from '../lib/useData'

const PAGE_SIZE_OPTIONS = [50, 100] as const

// Used only when a store has no saved pricing_settings row at all.
const DEFAULT_PCT_FEE = 13.25
const DEFAULT_FIXED_FEE = 0.30

type StatusFilter = AppListingStatus | 'all'

// Outcome of a bulk action, shown as "X / N başarısız" with the full failure list expandable.
interface BulkResult {
  action: string
  total: number
  failures: string[]
  skipped: string[]
}

// Real, net profit % after eBay's own cut — not just how much higher the eBay price is than
// the Amazon cost. eBay takes a percentage fee plus a fixed fee out of the sale price before
// any of it reaches the seller, so a listing marked up +80% can still net well under that once
// eBay's cut is subtracted. pctFee/fixedFee are each store's own saved eBay Fees settings
// (Settings → Profit & fees), never hardcoded, so this stays correct if those are ever changed.
function netProfitPct(ebayPrice: number, amazonPrice: number, pctFee: number, fixedFee: number): number | null {
  if (!amazonPrice || amazonPrice <= 0) return null
  const netProceeds = ebayPrice - (ebayPrice * (pctFee / 100) + fixedFee)
  const netProfit = netProceeds - amazonPrice
  return (netProfit / amazonPrice) * 100
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
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

// Same badge as the shared StatusBadge, with a dot for active listings.
function ListingStatusPill({ status }: { status: AppListingStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-success-50 text-success-700">
        <span className="w-1.5 h-1.5 rounded-full bg-success-500" /> Active
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
            className="w-full text-left px-2.5 py-2 flex items-start gap-3 hover:bg-slate-50 transition-colors"
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

// Small "a" badge mimicking Amazon's mark, and a colored "ebay" wordmark badge — used next to
// ASIN / eBay item IDs so Source/Listing read the same way as the reference design.
function AmazonBadge() {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-900 text-white text-[10px] font-bold leading-none shrink-0">
      a
    </span>
  )
}

function EbayBadge() {
  return (
    <span className="text-[10px] font-bold leading-none shrink-0 tracking-tight">
      <span style={{ color: '#e53238' }}>e</span>
      <span style={{ color: '#0064d2' }}>b</span>
      <span style={{ color: '#f5af02' }}>a</span>
      <span style={{ color: '#86b817' }}>y</span>
    </span>
  )
}

// A real drawn SVG flag instead of the 🇺🇸 emoji — emoji flags render as plain "US" letters on
// systems/fonts without regional-indicator support, which looked broken and not like an icon.
function UsFlagBadge() {
  return (
    <svg width="15" height="11" viewBox="0 0 20 14" className="shrink-0 rounded-[1.5px] ring-1 ring-black/5" aria-label="US">
      <rect width="20" height="14" fill="#B22234" />
      <rect y="1.08" width="20" height="1.08" fill="#fff" />
      <rect y="3.23" width="20" height="1.08" fill="#fff" />
      <rect y="5.38" width="20" height="1.08" fill="#fff" />
      <rect y="7.54" width="20" height="1.08" fill="#fff" />
      <rect y="9.69" width="20" height="1.08" fill="#fff" />
      <rect y="11.85" width="20" height="1.08" fill="#fff" />
      <rect width="8" height="7.54" fill="#3C3B6E" />
    </svg>
  )
}

// Renders an ID (ASIN or eBay item ID) as a bordered chip split into two zones: the ID text
// itself is a real link out to the Amazon/eBay product page, while the badge+flag portion is a
// separate button that opens the Copy ID / Change ID menu — so both actions stay reachable
// without one click target fighting the other.
function IdPill({
  value,
  href,
  badge,
  onCopy,
  onChange,
}: {
  value: string
  href: string | null
  badge: React.ReactNode
  onCopy: () => void
  onChange: () => void
}) {
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const display = value && value.length > 7 ? `${value.slice(0, 7)}...` : (value || '—')

  return (
    <span className="inline-flex items-stretch rounded-full border border-slate-200 bg-white shadow-sm overflow-hidden">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="font-mono text-xs text-slate-700 hover:text-brand-600 hover:bg-slate-50 pl-2.5 pr-1.5 py-1 flex items-center transition"
        >
          {display}
        </a>
      ) : (
        <span className="font-mono text-xs text-slate-400 pl-2.5 pr-1.5 py-1 flex items-center">{display}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setAnchorRect(e.currentTarget.getBoundingClientRect())
          setOpen(o => !o)
        }}
        className="flex items-center gap-1 pl-1.5 pr-2 border-l border-slate-200 hover:bg-slate-50 transition"
      >
        {badge}
        <UsFlagBadge />
      </button>
      {open && anchorRect && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-white rounded-lg border border-slate-200 shadow-xl py-1 w-40"
            style={{ top: anchorRect.bottom + 4, left: Math.min(anchorRect.left, window.innerWidth - 168) }}
          >
            <button
              onClick={() => { onCopy(); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Copy className="w-3.5 h-3.5 text-slate-400" /> Copy ID
            </button>
            <button
              onClick={() => { onChange(); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-400" /> Change ID
            </button>
          </div>
        </>,
        document.body,
      )}
    </span>
  )
}

export default function Listings() {
  const { listings, loading, endListing, removeListingLocal, updateListing, stores, syncAllEbayListings, refresh, fetchAmazonProduct } = useStoreData()
  const activeStore = stores.find(s => s.active) || stores[0]
  const [syncingFromEbay, setSyncingFromEbay] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Data is otherwise only fetched once, when the app first loads — so navigating away to
  // another page (e.g. List Items) and back here showed whatever was already in memory,
  // not what actually changed on eBay/the database in the meantime. Re-fetching every time
  // this page is landed on keeps it current without needing a full browser refresh.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each store's own saved eBay Fees (Settings → Profit & fees) — keyed by store_id, loaded
  // once for every store that appears in the current listings, so the net-profit % shown per
  // row always uses that row's OWN store's real fee settings rather than one hardcoded number.
  const [feeSettingsByStore, setFeeSettingsByStore] = useState<Record<string, { pctFee: number; fixedFee: number }>>({})
  const [feeLoadError, setFeeLoadError] = useState<string | null>(null)
  const storeIdsKey = useMemo(
    () => Array.from(new Set(listings.map(l => l.storeId).filter(Boolean))).sort().join(','),
    [listings],
  )

  useEffect(() => {
    const storeIds = storeIdsKey ? storeIdsKey.split(',') : []
    if (storeIds.length === 0) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('pricing_settings')
        .select('store_id, ebay_percentage_fee, ebay_fixed_fee')
        .in('store_id', storeIds)
      if (cancelled) return
      if (error) {
        setFeeLoadError(error.message)
        return
      }
      setFeeLoadError(null)
      const map: Record<string, { pctFee: number; fixedFee: number }> = {}
      for (const row of (data || []) as Array<{ store_id: string; ebay_percentage_fee: number | string | null; ebay_fixed_fee: number | string | null }>) {
        map[row.store_id] = {
          pctFee: numberOr(row.ebay_percentage_fee, DEFAULT_PCT_FEE),
          fixedFee: numberOr(row.ebay_fixed_fee, DEFAULT_FIXED_FEE),
        }
      }
      setFeeSettingsByStore(map)
    })()
    return () => { cancelled = true }
  }, [storeIdsKey])

  function feesFor(storeId: string): { pctFee: number; fixedFee: number } {
    return feeSettingsByStore[storeId] || { pctFee: DEFAULT_PCT_FEE, fixedFee: DEFAULT_FIXED_FEE }
  }

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [sortField, setSortField] = useState<'title' | 'ebayPrice' | 'soldCount' | 'listedDate'>('listedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<typeof PAGE_SIZE_OPTIONS[number]>(50)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let result = listings.filter(l => {
      const matchSearch = l.title.toLowerCase().includes(q) || l.asin.toLowerCase().includes(q) || l.skuHint.toLowerCase().includes(q)
      const matchStatus = statusFilter === 'all' || l.status === statusFilter
      return matchSearch && matchStatus
    })
    result = [...result].sort((a, b) => {
      const av = a[sortField] as string | number
      const bv = b[sortField] as string | number
      // Listings without a list date always go last, whichever way the column is sorted.
      if (sortField === 'listedDate') {
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return result
  }, [listings, search, statusFilter, sortField, sortDir])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, sortField, sortDir, pageSize])

  // A selection made under one search/filter must not silently carry over to rows that are no
  // longer visible — clear it whenever the search or status filter changes.
  useEffect(() => {
    setSelected([])
  }, [search, statusFilter])

  // Bulk actions only ever touch selected rows that are visible under the current filter.
  function selectedVisibleTargets(): AppListing[] {
    return filtered.filter(l => selected.includes(l.id))
  }

  function finishBulk(result: BulkResult) {
    setBulkResult(result)
    setSelected([])
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
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

  async function handleDeleteOne(listing: AppListing, mode: 'ebay' | 'local') {
    const confirmMsg = mode === 'ebay'
      ? `End "${listing.title}" on eBay and remove it? This cannot be undone.`
      : `Stop automation for "${listing.title}"? It stays in this list as "Untracked" and the tracker stops changing its price/stock. The listing on eBay (if any) stays untouched.`
    if (!window.confirm(confirmMsg)) return

    setActionError(null)
    setBulkResult(null)
    setDeletingId(listing.id)
    try {
      if (mode === 'ebay') {
        await endListing(listing.storeId, listing.id, listingSku(listing) || undefined)
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
    const targets = selectedVisibleTargets()
    if (targets.length === 0) return
    const confirmMsg = mode === 'ebay'
      ? `End ${targets.length} listing${targets.length === 1 ? '' : 's'} on eBay? This cannot be undone.`
      : `Stop automation for ${targets.length} listing${targets.length === 1 ? '' : 's'}? They stay here as "Untracked". Nothing changes on eBay.`
    if (!window.confirm(confirmMsg)) return

    setActionError(null)
    setBulkResult(null)
    setBulkRunning(true)
    const failures: string[] = []

    // Run several at once instead of strictly one-at-a-time — each still ends up making its
    // own real eBay call (there's no bulk "withdraw offer" endpoint to batch these into), but
    // this cuts the wall-clock time roughly by the concurrency factor instead of waiting for
    // each one to fully finish (including a whole-app data reload) before starting the next.
    const CONCURRENCY = 5
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async l => {
        try {
          if (mode === 'ebay') {
            await endListing(l.storeId, l.id, listingSku(l) || undefined, { skipRefresh: true })
          } else {
            await removeListingLocal(l.id)
          }
        } catch (err) {
          failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
        }
      }))
    }

    if (mode === 'ebay') await refresh()
    setBulkRunning(false)
    finishBulk({ action: mode === 'ebay' ? 'End on eBay' : 'Remove from automation', total: targets.length, failures, skipped: [] })
  }

  async function handleBulkEditQuantity() {
    const targets = selectedVisibleTargets()
    if (targets.length === 0) return
    const input = window.prompt(`Set quantity for ${targets.length} listing${targets.length === 1 ? '' : 's'}:`, String(targets[0].quantity))
    if (input === null) return
    const parsed = Number(input)
    if (input.trim() === '' || !Number.isFinite(parsed)) return
    const qty = Math.max(0, Math.floor(parsed))

    setActionError(null)
    setBulkResult(null)
    setBulkRunning(true)
    const failures: string[] = []
    const skipped: string[] = []
    try {
      for (const l of targets) {
        try {
          if (l.ebayId) {
            const sku = listingSku(l)
            if (!sku) { skipped.push(`${l.title}: SKU/ASIN yok`); continue }
            await updateListing(l.storeId, { sku, quantity: qty, oldQuantity: l.quantity }, { skipRefresh: true, listingId: l.id })
          } else {
            const { error } = await supabase.from('listings').update({ quantity: qty }).eq('id', l.id)
            if (error) throw new Error(error.message)
          }
        } catch (err) {
          failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
        }
      }
    } finally {
      await refresh()
      setBulkRunning(false)
    }
    finishBulk({ action: 'Edit Quantity', total: targets.length, failures, skipped })
  }

  async function handleBulkSetMargin() {
    const targets = selectedVisibleTargets()
    if (targets.length === 0) return
    const input = window.prompt(
      `Set NET profit margin % (over Amazon cost, after eBay fees) for ${targets.length} listing${targets.length === 1 ? '' : 's'}:`,
      '20',
    )
    if (input === null) return
    const marginPct = Number(input)
    if (input.trim() === '' || !Number.isFinite(marginPct)) return
    if (feeLoadError) {
      setActionError(`eBay ücret ayarları yüklenemedi, fiyat hesaplanamıyor: ${feeLoadError}`)
      return
    }

    setActionError(null)
    setBulkResult(null)
    setBulkRunning(true)
    const failures: string[] = []
    const skipped: string[] = []
    try {
      for (const l of targets) {
        if (!l.amazonPrice || l.amazonPrice <= 0) {
          skipped.push(`${l.title}: Amazon fiyatı yok`)
          continue
        }
        try {
          // Price so that what's left after eBay's % fee and fixed fee is cost × (1 + margin).
          const { pctFee, fixedFee } = feesFor(l.storeId)
          if (pctFee >= 100) throw new Error(`invalid eBay fee setting (${pctFee}%)`)
          const newPrice = Math.round(((l.amazonPrice * (1 + marginPct / 100) + fixedFee) / (1 - pctFee / 100)) * 100) / 100
          if (!Number.isFinite(newPrice) || newPrice <= 0) throw new Error(`computed price is invalid (${newPrice})`)
          if (l.ebayId) {
            const sku = listingSku(l)
            if (!sku) { skipped.push(`${l.title}: SKU/ASIN yok`); continue }
            await updateListing(l.storeId, { sku, price: newPrice, oldPrice: l.ebayPrice }, { skipRefresh: true, listingId: l.id })
          } else {
            const { error } = await supabase.from('listings').update({ ebay_price: newPrice }).eq('id', l.id)
            if (error) throw new Error(error.message)
          }
        } catch (err) {
          failures.push(`${l.title}: ${err instanceof Error ? err.message : 'failed'}`)
        }
      }
    } finally {
      await refresh()
      setBulkRunning(false)
    }
    finishBulk({ action: `Set Margin ${marginPct}%`, total: targets.length, failures, skipped })
  }

  async function handleCopyId(value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — nothing more to do here.
    }
  }

  async function handleChangeAsin(listing: AppListing) {
    const input = window.prompt('New ASIN for this listing:', listing.asin)
    if (input === null) return
    const newAsin = input.trim().toUpperCase()
    if (!newAsin || newAsin === listing.asin) return
    setActionError(null)
    setBulkResult(null)

    // The eBay inventory item keeps the SKU it was created with — changing the ASIN here does not
    // change it. Remember that SKU in sku_hint so later price/quantity updates still reach it.
    const originalSku = listingSku(listing)

    try {
      // Fetch the new product first (skip_duplicate_check: amazon-fetch's "already listed"
      // guard would otherwise flag this listing against itself). Filter / VeRO rejections and
      // scrape errors are shown instead of being silently ignored.
      let product: AmazonProduct | null = null
      try {
        product = await fetchAmazonProduct(newAsin, listing.storeId, { skipDuplicateCheck: true })
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        const saveAnyway = window.confirm(
          `Amazon ürünü alınamadı (${newAsin}):\n${msg}\n\nASIN yine de kaydedilsin mi? (Fiyat güncellenmez.)`,
        )
        if (!saveAnyway) {
          setActionError(`ASIN değiştirilmedi — Amazon: ${msg}`)
          return
        }
      }

      const amazonPrice = product ? Number(product.price) || 0 : 0
      const dbPatch: { asin: string; sku_hint?: string; amazon_price?: number } = { asin: newAsin }
      if (!listing.skuHint && originalSku) dbPatch.sku_hint = originalSku
      if (amazonPrice > 0) dbPatch.amazon_price = amazonPrice
      const { error: asinErr } = await supabase.from('listings').update(dbPatch).eq('id', listing.id)
      if (asinErr) throw new Error(`ASIN kaydedilemedi: ${asinErr.message}`)

      if (product && amazonPrice <= 0) {
        setActionError(`ASIN kaydedildi, ancak Amazon fiyatı okunamadı — eBay fiyatı değiştirilmedi.`)
      }

      if (amazonPrice > 0) {
        const [settingsRes, tiersRes] = await Promise.all([
          supabase.from('pricing_settings').select('pricing_enabled, ebay_percentage_fee, ebay_fixed_fee').eq('store_id', listing.storeId).maybeSingle(),
          supabase.from('pricing_rules').select('min_price, max_price, profit_pct, fixed_profit').eq('store_id', listing.storeId).order('sort_order', { ascending: true }),
        ])
        if (settingsRes.error) throw new Error(`ASIN kaydedildi, ancak fiyat ayarları yüklenemedi: ${settingsRes.error.message}`)
        if (tiersRes.error) throw new Error(`ASIN kaydedildi, ancak fiyat kuralları yüklenemedi: ${tiersRes.error.message}`)
        const settings = (settingsRes.data || null) as { pricing_enabled?: boolean | null; ebay_percentage_fee?: number | string | null; ebay_fixed_fee?: number | string | null } | null
        const pricingEnabled = settings?.pricing_enabled ?? true
        const pctFee = numberOr(settings?.ebay_percentage_fee, DEFAULT_PCT_FEE)
        const fixedFee = numberOr(settings?.ebay_fixed_fee, DEFAULT_FIXED_FEE)
        const tierRows = (tiersRes.data || []) as Array<{ min_price: number | string | null; max_price: number | string | null; profit_pct: number | string | null; fixed_profit: number | string | null }>
        const tiers = tierRows.map(t => ({
          min: numberOr(t.min_price, 0),
          max: numberOr(t.max_price, 999999),
          profitPct: numberOr(t.profit_pct, 0),
          fixProfit: numberOr(t.fixed_profit, 0),
        }))
        const newEbayPrice = calculateEbayPrice(amazonPrice, tiers, pctFee, fixedFee, pricingEnabled).finalPrice

        if (listing.ebayId) {
          if (!originalSku) throw new Error('ASIN kaydedildi, ancak bu ilanın eBay SKU\'su bilinmiyor — eBay fiyatı güncellenemedi.')
          // Push the new price live to eBay using the item's ORIGINAL SKU; on success
          // updateListing also writes ebay_price to our listings row.
          try {
            await updateListing(
              listing.storeId,
              { sku: originalSku, price: newEbayPrice, oldPrice: listing.ebayPrice, reason: `Tubika — ASIN değişti (${listing.asin || '—'} → ${newAsin})` },
              { skipRefresh: true, listingId: listing.id },
            )
          } catch (updErr) {
            throw new Error(`ASIN kaydedildi, ancak eBay fiyatı güncellenemedi: ${updErr instanceof Error ? updErr.message : String(updErr)}`)
          }
        } else {
          const { error: priceErr } = await supabase.from('listings').update({ ebay_price: newEbayPrice }).eq('id', listing.id)
          if (priceErr) throw new Error(`ASIN kaydedildi, ancak fiyat kaydedilemedi: ${priceErr.message}`)
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update ASIN')
    } finally {
      await refresh()
    }
  }

  async function handleChangeEbayId(listing: AppListing) {
    const input = window.prompt(
      'New eBay Item ID for this listing:\n\nNote: this only corrects the ID stored here — it does not move or recreate anything on eBay itself.',
      listing.ebayId,
    )
    if (input === null) return
    const newEbayId = input.trim()
    if (!newEbayId || newEbayId === listing.ebayId) return
    setActionError(null)
    try {
      const { error } = await supabase.from('listings').update({ ebay_id: newEbayId }).eq('id', listing.id)
      if (error) throw new Error(error.message)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update eBay Item ID')
    }
  }

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'draft', label: 'Drafts' },
    { value: 'ended', label: 'Ended' },
    { value: 'out_of_stock', label: 'Out of Stock' },
    { value: 'unknown', label: 'Unknown' },
    { value: 'untracked', label: 'Untracked' },
    { value: 'delisted_cold', label: 'Delisted (cold)' },
  ]

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  return (
    <div className="space-y-4 max-w-7xl">
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
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="input w-auto"
          >
            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value) as typeof PAGE_SIZE_OPTIONS[number])}
            className="input w-auto"
            title="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size} / page</option>)}
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
                  <span className="text-xs text-slate-400">Marks it "Untracked" — the tracker stops changing it. eBay is untouched.</span>
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

      {feeLoadError && (
        <div role="alert" className="flex items-start gap-2 text-sm text-error-700 bg-error-50 border border-error-200 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>eBay ücret ayarları yüklenemedi — kâr % değerleri varsayılan ücretlerle ({DEFAULT_PCT_FEE}% + {formatCurrency(DEFAULT_FIXED_FEE)}) gösteriliyor: {feeLoadError}</span>
        </div>
      )}

      {bulkResult && (
        <div
          role={bulkResult.failures.length > 0 ? 'alert' : 'status'}
          className={cn(
            'text-sm rounded-lg px-4 py-2 border',
            bulkResult.failures.length > 0 ? 'text-error-700 bg-error-50 border-error-200' : 'text-success-700 bg-success-50 border-success-200',
          )}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">
              <span className="font-medium">{bulkResult.action}:</span>{' '}
              {bulkResult.failures.length > 0
                ? `${bulkResult.failures.length} / ${bulkResult.total} başarısız`
                : `${bulkResult.total - bulkResult.skipped.length} / ${bulkResult.total} başarılı`}
              {bulkResult.skipped.length > 0 && ` · ${bulkResult.skipped.length} atlandı`}
            </span>
            <button type="button" className="text-xs underline hover:no-underline shrink-0" onClick={() => setBulkResult(null)}>Kapat</button>
          </div>
          {bulkResult.failures.length > 0 && (
            <details className="mt-1 ml-6">
              <summary className="cursor-pointer text-xs">Başarısız olanların tam listesi ({bulkResult.failures.length})</summary>
              <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5 max-h-64 overflow-y-auto">
                {bulkResult.failures.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </details>
          )}
          {bulkResult.skipped.length > 0 && (
            <details className="mt-1 ml-6">
              <summary className="cursor-pointer text-xs">Atlananlar ({bulkResult.skipped.length})</summary>
              <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5 max-h-64 overflow-y-auto">
                {bulkResult.skipped.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </details>
          )}
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
                  <th className="px-2.5 py-2 w-10">
                    <button onClick={toggleSelectAll}>
                      {allSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                    </button>
                  </th>
                  <th className="px-2.5 py-2 font-medium">
                    <button onClick={() => toggleSort('title')} className="flex items-center gap-1 hover:text-slate-700">
                      Listing <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2.5 py-2 font-medium">Source</th>
                  <th className="px-2.5 py-2 font-medium">Listing</th>
                  <th className="px-2.5 py-2 font-medium text-right">Amazon</th>
                  <th className="px-2.5 py-2 font-medium text-right">
                    <button onClick={() => toggleSort('ebayPrice')} className="flex items-center gap-1 hover:text-slate-700 ml-auto">
                      eBay <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2.5 py-2 font-medium text-right">Qty</th>
                  <th className="px-2.5 py-2 font-medium text-right">
                    <button onClick={() => toggleSort('soldCount')} className="flex items-center gap-1 hover:text-slate-700 ml-auto">
                      Sold <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2.5 py-2 font-medium">Status</th>
                  <th className="px-2.5 py-2 font-medium">
                    <button onClick={() => toggleSort('listedDate')} className="flex items-center gap-1 hover:text-slate-700">
                      List Date <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-2.5 py-2 font-medium">Last Sale</th>
                  <th className="px-2.5 py-2 font-medium">Checked</th>
                  <th className="px-2.5 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(listing => {
                  const fees = feesFor(listing.storeId)
                  const pct = netProfitPct(listing.ebayPrice, listing.amazonPrice, fees.pctFee, fees.fixedFee)
                  return (
                  <tr key={listing.id} className="border-b border-slate-100 table-row-hover">
                    <td className="px-2.5 py-2">
                      <button onClick={() => toggleSelect(listing.id)}>
                        {selected.includes(listing.id) ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <img src={listing.image} alt="" className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0" />
                        <Link to={`/listings/${listing.id}`} className="font-medium text-slate-900 hover:text-brand-600 truncate max-w-[260px]">
                          {listing.title}
                        </Link>
                        {listing.promoted && <span className="badge-info text-xs shrink-0">Promoted</span>}
                      </div>
                    </td>
                    <td className="px-2.5 py-2">
                      <IdPill
                        value={listing.asin}
                        href={listing.asin ? `https://www.amazon.com/dp/${listing.asin}` : null}
                        badge={<AmazonBadge />}
                        onCopy={() => void handleCopyId(listing.asin)}
                        onChange={() => void handleChangeAsin(listing)}
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      <IdPill
                        value={listing.ebayId}
                        href={listing.ebayId ? `https://www.ebay.com/itm/${listing.ebayId}` : null}
                        badge={<EbayBadge />}
                        onCopy={() => void handleCopyId(listing.ebayId)}
                        onChange={() => void handleChangeEbayId(listing)}
                      />
                    </td>
                    <td className="px-2.5 py-2 text-right text-slate-600">{formatCurrency(listing.amazonPrice)}</td>
                    <td className="px-2.5 py-2 text-right">
                      <div className="font-medium text-slate-900">
                        {formatCurrency(listing.ebayPrice)}
                        {pct !== null && (
                          <span
                            className={cn('ml-1 text-xs font-medium', pct > 0 ? 'text-success-600' : pct < 0 ? 'text-error-600' : 'text-slate-500')}
                            title="Net profit % after eBay fees"
                          >
                            ({formatPct(pct)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-right text-slate-700">{listing.quantity}</td>
                    <td className="px-2.5 py-2 text-right text-slate-700">{listing.soldCount}</td>
                    <td className="px-2.5 py-2"><ListingStatusPill status={listing.status} /></td>
                    <td className="px-2.5 py-2 text-slate-500 text-xs">{listing.listedDate ? timeAgo(listing.listedDate) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-2.5 py-2 text-slate-500 text-xs">
                      {listing.lastSaleDate ? timeAgo(listing.lastSaleDate) : <span className="text-slate-400">Never</span>}
                    </td>
                    <td className="px-2.5 py-2 text-slate-500 text-xs">
                      {listing.checkedDate
                        ? <span title="Last Amazon price/stock check by the server tracker (every listing roughly every 12 hours)">{timeAgo(listing.checkedDate)}</span>
                        : <span className="text-slate-400" title="The server tracker checks every listing roughly every 12 hours">Not yet</span>}
                    </td>
                    <td className="px-2.5 py-2">
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
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} listings
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
                description: 'Marks it "Untracked" — the tracker stops changing its price/stock. eBay is untouched.',
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
