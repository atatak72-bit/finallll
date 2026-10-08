import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Bell, HelpCircle, Package, MessageSquare, AlertTriangle, RefreshCw } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'

// ---- Notifications ----
// Built only from data the app already loads (orders, conversations, revisions, bulk runs),
// so this adds no new requests and touches nothing on eBay or in the database.
type NotificationItem = {
  id: string
  icon: 'order' | 'message' | 'bulk' | 'revision'
  title: string
  detail: string
  date: string
  to: string
}

const SEEN_KEY = 'tubika_notifications_seen_at'
const DAY_MS = 24 * 60 * 60 * 1000

function readSeenAt(): number {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? Number(raw) || 0 : 0
  } catch {
    return 0
  }
}

function writeSeenAt(value: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(value))
  } catch {
    // storage unavailable (private mode etc.) — the dot simply won't be remembered
  }
}

function timeOf(date: string | null | undefined): number {
  const t = date ? new Date(date).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

function timeAgo(date: string): string {
  const diff = Date.now() - timeOf(date)
  if (diff < 60 * 1000) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// eBay sends raw fulfillment statuses (e.g. NOT_STARTED, IN_PROGRESS, FULFILLED); anything
// that isn't clearly shipped/finished/cancelled still needs the seller's attention.
function needsShipping(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase()
  return !/(shipped|delivered|fulfilled|cancel)/.test(s)
}

const ICONS = {
  order: Package,
  message: MessageSquare,
  bulk: AlertTriangle,
  revision: RefreshCw,
}

// Closes a dropdown when the user clicks outside it or presses Escape.
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const HELP_LINKS: Array<{ label: string; desc: string; to: string }> = [
  { label: 'Add a single product', desc: 'List Items → Single: paste an ASIN, review, publish.', to: '/list-items' },
  { label: 'Bulk listing & status', desc: 'List Items → Bulk to queue many ASINs, Bulk Status to see results.', to: '/list-items' },
  { label: 'Pricing & profit rules', desc: 'Settings → General: eBay fees and profit margin tiers.', to: '/settings' },
  { label: 'Business policies & location', desc: 'Settings → eBay Policies: required before publishing.', to: '/settings' },
  { label: 'VeRO & blocked words', desc: 'Settings → Advanced: keywords and ASINs that must never be listed.', to: '/settings' },
  { label: 'Price & stock history', desc: 'Revisions: every automatic price/quantity change.', to: '/revisions' },
]

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { orders, conversations, revisions, bulkRuns } = useStoreData()
  const [bellOpen, setBellOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [seenAt, setSeenAt] = useState<number>(() => readSeenAt())

  const pendingSeen = useRef<number | null>(null)
  const closeBell = () => {
    setBellOpen(false)
    // Items opened in the panel stay highlighted while it is open; they count as seen once it closes.
    if (pendingSeen.current !== null) {
      setSeenAt(pendingSeen.current)
      pendingSeen.current = null
    }
  }
  const closeHelp = () => setHelpOpen(false)
  const bellRef = useDismiss(bellOpen, closeBell)
  const helpRef = useDismiss(helpOpen, closeHelp)

  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = []
    const now = Date.now()

    for (const o of orders || []) {
      if (!needsShipping(o.status)) continue
      items.push({
        id: `order-${o.id}`,
        icon: 'order',
        title: 'Order waiting to be shipped',
        detail: `${o.orderId} · ${o.listingTitle || 'eBay order'}`,
        date: o.orderDate,
        to: `/orders/${o.id}`,
      })
    }

    for (const c of conversations || []) {
      if (!c.unread) continue
      items.push({
        id: `msg-${c.id}`,
        icon: 'message',
        title: `New message from ${c.buyerUsername || c.buyerName || 'a buyer'}`,
        detail: c.lastMessage || c.listingTitle || '',
        date: c.lastMessageDate,
        to: `/messages/${c.id}`,
      })
    }

    for (const r of bulkRuns || []) {
      const runDate = r.completedAt || r.createdAt
      if (!r.failed || now - timeOf(runDate) > 7 * DAY_MS) continue
      items.push({
        id: `bulk-${r.id}`,
        icon: 'bulk',
        title: `${r.failed} item${r.failed === 1 ? '' : 's'} failed in a bulk run`,
        detail: r.name || 'Bulk run',
        date: runDate,
        to: '/list-items',
      })
    }

    const recentRevisions = (revisions || []).filter(r => now - timeOf(r.date) <= DAY_MS)
    if (recentRevisions.length > 0) {
      const newest = recentRevisions.reduce((a, b) => (timeOf(b.date) > timeOf(a.date) ? b : a))
      items.push({
        id: `revisions-${timeOf(newest.date)}`,
        icon: 'revision',
        title: `${recentRevisions.length}${recentRevisions.length >= 50 ? '+' : ''} automatic price/stock updates`,
        detail: 'In the last 24 hours — see Revisions for details.',
        date: newest.date,
        to: '/revisions',
      })
    }

    return items.sort((a, b) => timeOf(b.date) - timeOf(a.date)).slice(0, 20)
  }, [orders, conversations, revisions, bulkRuns])

  const hasUnseen = !bellOpen && notifications.some(n => timeOf(n.date) > seenAt)

  function toggleBell() {
    setHelpOpen(false)
    if (bellOpen) {
      closeBell()
      return
    }
    const now = Date.now()
    pendingSeen.current = now
    writeSeenAt(now)
    setBellOpen(true)
  }

  function toggleHelp() {
    setHelpOpen(!helpOpen)
    setBellOpen(false)
  }

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-slate-900 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 truncate">{subtitle}</p>}
      </div>

      <div className="relative hidden md:block">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search listings, orders, ASINs…"
          className="w-64 pl-9 pr-3 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition"
        />
      </div>

      {/* Help */}
      <div className="relative" ref={helpRef}>
        <button
          type="button"
          onClick={toggleHelp}
          aria-label="Help"
          aria-expanded={helpOpen}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
        {helpOpen && (
          <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">Quick help</p>
              <p className="text-xs text-slate-500">Where to find the most-used features.</p>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {HELP_LINKS.map(link => (
                <Link
                  key={link.label}
                  to={link.to}
                  onClick={closeHelp}
                  className="block px-4 py-2.5 hover:bg-slate-50"
                >
                  <p className="text-sm font-medium text-slate-800">{link.label}</p>
                  <p className="text-xs text-slate-500">{link.desc}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative" ref={bellRef}>
        <button
          type="button"
          onClick={toggleBell}
          aria-label="Notifications"
          aria-expanded={bellOpen}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition relative"
        >
          <Bell className="w-5 h-5" />
          {hasUnseen && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error-500 rounded-full ring-2 ring-white" />
          )}
        </button>
        {bellOpen && (
          <div className="absolute right-0 mt-2 w-96 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <span className="text-xs text-slate-400">{notifications.length} item{notifications.length === 1 ? '' : 's'}</span>
            </div>
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {notifications.map(n => {
                  const Icon = ICONS[n.icon]
                  const isNew = timeOf(n.date) > seenAt
                  return (
                    <Link
                      key={n.id}
                      to={n.to}
                      onClick={closeBell}
                      className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${isNew ? 'bg-brand-50/40' : ''}`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${n.icon === 'bulk' ? 'text-amber-500' : 'text-brand-600'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{n.title}</p>
                        {n.detail && <p className="text-xs text-slate-500 truncate">{n.detail}</p>}
                        <p className="text-[11px] text-slate-400 mt-0.5">{n.date ? timeAgo(n.date) : ''}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
