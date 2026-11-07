import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, PackagePlus, Upload, Save, Link2,
  AlertCircle, CheckCircle2, Sparkles, Layers, FileText, Loader2,
  ShieldAlert, ListChecks, Plus, Trash2, Wand2, X,
  Download, ChevronLeft, ChevronRight, Circle, Ban, Clock,
} from 'lucide-react'
import { cn, formatCurrency, calculateEbayPrice, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE, extractBasicAspectsFromSpecs, sanitizeAspects, type PricingTierInput } from '../lib/utils'
import { useStoreData } from '../lib/DataContext'
import { supabase } from '../lib/supabase'
import type { AmazonProduct, PublishListingPayload } from '../lib/useData'
import type { BulkRun, BulkRunItem } from '../lib/useData'
import { isBlockedBulkError } from '../lib/useData'

type Tab = 'single' | 'bulk' | 'bulk-status' | 'drafts' | 'import'

interface ItemSpecific {
  key: string
  value: string
}

// Always blocked, whatever the store's VeRO settings say — the same list the bulk pipeline uses.
// Matched as whole words only ("prime" is deliberately not here: it blocked ordinary titles
// such as "Prime Rib Seasoning").
const HARDCODED_BLOCKS = ['amazon', 'amazon basics', 'amazonbasics', 'fulfilled by amazon']

function truncateTitleTo80(title: string) {
  if (!title) return ''
  let t = title.trim()
  if (t.length <= 80) return t
  t = t.slice(0, 80)
  const lastSpace = t.lastIndexOf(' ')
  if (lastSpace > 60) {
    t = t.slice(0, lastSpace)
  }
  return t.trim()
}

// ---- VeRO helpers (same whole-word rules as amazon-fetch and the bulk pipeline) ----

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whole-word, case-insensitive ("Anua" must not match "January", "Active" not "Inactive").
function wordRegex(word: string, flags = 'iu'): RegExp | null {
  const w = (word || '').trim()
  if (!w) return null
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(w)}(?![\\p{L}\\p{N}])`, flags)
  } catch {
    return null
  }
}

function findBlockedWord(text: string, words: string[]): string | null {
  if (!text) return null
  for (const w of words) {
    const re = wordRegex(w)
    if (re && re.test(text)) return w.trim()
  }
  return null
}

function stripWords(text: string, words: string[]): string {
  if (!text) return text
  let out = text
  for (const w of words) {
    const re = wordRegex(w, 'giu')
    if (re) out = out.replace(re, '')
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/^[ \t,\-–|]+/gm, '')
    .trim()
}

// Amazon's byline often looks like "Visit the Anker Store" or "Brand: Anker" — reduce it to "Anker".
function cleanBrandName(brand: string): string {
  return (brand || '')
    .replace(/^\s*(brand:\s*|visit the\s+)/i, '')
    .replace(/\s+store\s*$/i, '')
    .trim()
}

// ---- Item specifics: same approach as the bulk pipeline ----

// eBay treats any listing that carries an "EPA Registration Number" item specific as a
// pesticide and rejects it outside pesticide categories (errorId 25019). Drop that field unless
// it holds a real registration number. (Local copy of the bulk pipeline's helper.)
function withoutPlaceholderEpa(aspects: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, values] of Object.entries(aspects)) {
    if (/^epa registration n/i.test(name.trim())) {
      const real = (values || []).filter(v => v && !/^(n\/?a|none|does not apply|not applicable|unknown)$/i.test(String(v).trim()))
      if (real.length === 0) continue
      out[name] = real
      continue
    }
    out[name] = values
  }
  return out
}

// Builds publish-ready aspects from the live amazon-fetch product (`specs`), exactly like bulk.
function productAspects(product: AmazonProduct): Record<string, string[]> | undefined {
  return sanitizeAspects(withoutPlaceholderEpa(extractBasicAspectsFromSpecs(product.specs)))
}

function extractItemSpecifics(product: AmazonProduct): ItemSpecific[] {
  const aspects = productAspects(product) || {}
  return Object.entries(aspects).map(([key, values]) => ({ key, value: values[0] || '' }))
}

// Only a numeric id is an eBay category. Anything else (an Amazon category name or path) is
// left out so the publish route auto-detects the eBay category itself.
function isNumericCategoryId(v: string | null | undefined): boolean {
  return /^\d+$/.test((v || '').trim())
}

// ---- Store settings loaders ----

function numOr(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// "$12", "1,299.00", " 12.5 " → number; null when it isn't a usable price.
function parsePriceInput(raw: string): number | null {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '')
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

interface StorePricing {
  enabled: boolean
  feePct: number
  fixedFee: number
  tiers: PricingTierInput[]
}

const DEFAULT_PRICING: StorePricing = { enabled: true, feePct: 13.25, fixedFee: 0.30, tiers: [] }

async function loadStorePricing(storeId: string): Promise<StorePricing> {
  const [settingsRes, tiersRes] = await Promise.all([
    supabase.from('pricing_settings').select('pricing_enabled, ebay_percentage_fee, ebay_fixed_fee').eq('store_id', storeId).maybeSingle(),
    supabase.from('pricing_rules').select('min_price, max_price, profit_pct, fixed_profit, sort_order').eq('store_id', storeId).order('sort_order', { ascending: true }),
  ])
  if (settingsRes.error) throw new Error(`Could not load pricing settings: ${settingsRes.error.message}`)
  if (tiersRes.error) throw new Error(`Could not load pricing rules: ${tiersRes.error.message}`)
  const s = (settingsRes.data || null) as { pricing_enabled: boolean | null; ebay_percentage_fee: unknown; ebay_fixed_fee: unknown } | null
  const rules = (tiersRes.data || []) as Array<{ min_price: unknown; max_price: unknown; profit_pct: unknown; fixed_profit: unknown }>
  return {
    enabled: s?.pricing_enabled ?? DEFAULT_PRICING.enabled,
    feePct: numOr(s?.ebay_percentage_fee, DEFAULT_PRICING.feePct),
    fixedFee: numOr(s?.ebay_fixed_fee, DEFAULT_PRICING.fixedFee),
    tiers: rules.map(r => ({
      min: numOr(r.min_price, 0),
      max: numOr(r.max_price, 999999),
      profitPct: numOr(r.profit_pct, 20),
      fixProfit: numOr(r.fixed_profit, 0),
    })),
  }
}

// Pricing off → eBay price = Amazon price (what Settings says). Pricing on but no rules →
// amazon-fetch's suggested price (same fallback as bulk). Otherwise the store's rules.
function computeListPrice(amazonPrice: number, suggestedPrice: number, p: StorePricing): number {
  if (!p.enabled) return amazonPrice
  if (p.tiers.length === 0) return suggestedPrice > 0 ? suggestedPrice : amazonPrice
  return calculateEbayPrice(amazonPrice, p.tiers, p.feePct, p.fixedFee, true).finalPrice
}

interface StoreVero {
  blockKeywords: string[]
  removeKeywords: string[]
  blockInBrand: boolean
  blockInTitle: boolean
  blockInDescription: boolean
  autoRemoveBrand: boolean
}

const DEFAULT_VERO: StoreVero = { blockKeywords: [], removeKeywords: [], blockInBrand: true, blockInTitle: true, blockInDescription: true, autoRemoveBrand: false }

async function loadStoreVero(storeId: string): Promise<StoreVero> {
  const { data, error } = await supabase
    .from('store_vero_settings')
    .select('block_keywords, remove_keywords, block_in_brand, block_in_title, block_in_description, auto_remove_brand')
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(`Could not load VeRO settings: ${error.message}`)
  const row = (data || null) as {
    block_keywords: string[] | null; remove_keywords: string[] | null
    block_in_brand: boolean | null; block_in_title: boolean | null; block_in_description: boolean | null
    auto_remove_brand: boolean | null
  } | null
  if (!row) return DEFAULT_VERO
  return {
    blockKeywords: (row.block_keywords || []).filter(Boolean),
    removeKeywords: (row.remove_keywords || []).filter(Boolean),
    blockInBrand: row.block_in_brand ?? true,
    blockInTitle: row.block_in_title ?? true,
    blockInDescription: row.block_in_description ?? true,
    autoRemoveBrand: row.auto_remove_brand ?? false,
  }
}

async function loadPromotedDefaults(storeId: string): Promise<{ autoPromote: boolean; adRate: number }> {
  const { data, error } = await supabase
    .from('store_promoted_settings')
    .select('auto_promote_enabled, default_ad_rate')
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(`Could not load promoted listing settings: ${error.message}`)
  const row = (data || null) as { auto_promote_enabled: boolean | null; default_ad_rate: unknown } | null
  const rate = numOr(row?.default_ad_rate, 3)
  return { autoPromote: row?.auto_promote_enabled ?? false, adRate: rate > 0 ? rate : 3 }
}

async function loadActiveTemplate(storeId: string): Promise<string> {
  const { data } = await supabase
    .from('listing_templates')
    .select('template')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .maybeSingle()
  const row = (data || null) as { template: string | null } | null
  return row?.template || DEFAULT_LISTING_TEMPLATE
}

// supabase.functions.invoke does not throw: a non-2xx response comes back as `error`, whose
// `context` is the Response — read the function's own { error } message from it when possible.
async function functionErrorMessage(err: unknown): Promise<string> {
  const ctx = (err as { context?: unknown } | null)?.context
  if (typeof Response !== 'undefined' && ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error) return body.error
    } catch {
      // not JSON — fall through to the generic message
    }
  }
  return err instanceof Error ? err.message : String(err ?? '')
}

// Adds a just-published listing to Promoted Listings. ebay-promote-listing answers 200 with
// success:false when eBay declines, so the body is checked, not just the call. On success the
// listing row (store_id + asin, never the draft row) is flagged promoted.
async function promoteListing(storeId: string, ebayListingId: string, asin: string, adRate: number): Promise<{ ok: boolean; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('ebay-promote-listing', {
      body: { storeId, listingId: ebayListingId, adRate },
    })
    const result = (data || {}) as { success?: boolean; error?: string }
    if (error || !result.success) {
      const msg = result.error || (error ? await functionErrorMessage(error) : '')
      return { ok: false, message: msg || 'eBay did not accept the promotion.' }
    }
    const { error: updErr } = await supabase
      .from('listings')
      .update({ promoted: true })
      .eq('store_id', storeId)
      .eq('asin', asin)
      .neq('status', 'draft')
    if (updErr) return { ok: true, message: `Promoted at ${adRate}% ad rate, but the listing could not be marked as promoted here: ${updErr.message}` }
    return { ok: true, message: `Promoted at ${adRate}% ad rate.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Promotion request failed.' }
  }
}

// ---- Bulk runs being processed by this browser tab ----
// Kept at module level (not in page state) so leaving List Items and coming back keeps the
// "Processing…" state and the close-tab warning: processBulkRun lives in the app-wide data
// context and keeps running while you are on another page. A reload really does stop the
// processing, and this list is (correctly) empty again after one — unlike sessionStorage,
// which would survive the reload and show a run as processing forever.
let activeRunIdsGlobal: string[] = []
const activeRunListeners = new Set<() => void>()

function onActiveRunsBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

function updateActiveRunIds(update: (prev: string[]) => string[]) {
  const next = update(activeRunIdsGlobal)
  if (next === activeRunIdsGlobal) return
  const wasActive = activeRunIdsGlobal.length > 0
  activeRunIdsGlobal = next
  const isActive = next.length > 0
  // Warn before the tab is closed or reloaded while a batch is still running — on every page,
  // not only while List Items is open.
  if (isActive && !wasActive) window.addEventListener('beforeunload', onActiveRunsBeforeUnload)
  if (!isActive && wasActive) window.removeEventListener('beforeunload', onActiveRunsBeforeUnload)
  activeRunListeners.forEach(l => l())
}

function useActiveRunIds(): string[] {
  return useSyncExternalStore(
    (cb: () => void) => {
      activeRunListeners.add(cb)
      return () => { activeRunListeners.delete(cb) }
    },
    () => activeRunIdsGlobal,
  )
}

interface DraftRow {
  id: string
  title: string
  image: string | null
  ebay_price: number
  amazon_price: number | null
  asin: string | null
  quantity: number
  promoted: boolean | null
}

// ---- Bulk run detail modal ----
// Opened by clicking a batch row in Bulk Status. Shows every item in that run with its real
// outcome, split into tabs (All / Success / Blocked / Failed / In progress). "Blocked" is
// derived purely for display from the error text of a 'failed' item (VeRO/Prime/FBA-only
// rejections) — the underlying data model (BulkRunItem.status) is untouched, so this is a
// display-only distinction and carries zero risk to the working publish/retry logic.
// The rules for what counts as "Blocked" live in useData (isBlockedBulkError) so this screen
// and Resume always agree: Prime/FBA, rating, VeRO, out-of-stock, duplicate and eBay policy blocks.

type DetailTab = 'all' | 'success' | 'blocked' | 'failed' | 'pending'

function classifyItem(item: BulkRunItem): DetailTab {
  if (item.status === 'success') return 'success'
  if (item.status === 'pending' || item.status === 'processing') return 'pending'
  if (isBlockedBulkError(item.error)) return 'blocked'
  return 'failed'
}

function BulkRunDetailModal({
  run,
  ebayIdByAsin,
  onClose,
}: {
  run: BulkRun
  ebayIdByAsin: Map<string, string>
  onClose: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  const classified = useMemo(() => run.items.map(item => ({ item, cls: classifyItem(item) })), [run.items])

  const counts = useMemo(() => {
    const c = { all: classified.length, success: 0, blocked: 0, failed: 0, pending: 0 }
    for (const { cls } of classified) c[cls]++
    return c
  }, [classified])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return classified
      .filter(({ cls }) => tab === 'all' || cls === tab)
      .filter(({ item }) => !q || item.asin.toLowerCase().includes(q) || (item.title || '').toLowerCase().includes(q))
      .map(({ item }) => item)
  }, [classified, tab, search])

  useEffect(() => { setPage(1) }, [tab, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const tabs: { id: DetailTab; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
    { id: 'all', label: 'All', icon: Circle, color: 'text-slate-500' },
    { id: 'success', label: 'Success', icon: CheckCircle2, color: 'text-success-600' },
    { id: 'blocked', label: 'Blocked', icon: Ban, color: 'text-amber-600' },
    { id: 'failed', label: 'Failed', icon: AlertCircle, color: 'text-error-600' },
    { id: 'pending', label: 'In progress', icon: Clock, color: 'text-brand-600' },
  ]

  function exportCsv() {
    const rows = [['ASIN', 'Title', 'eBay Item', 'Status', 'Error']]
    for (const { item, cls } of classified) {
      rows.push([
        item.asin,
        item.title || '',
        ebayIdByAsin.get(item.asin) || '',
        cls,
        (item.error || '').replace(/\s+/g, ' '),
      ])
    }
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${run.name.replace(/[^a-z0-9]+/gi, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-900">Bulk run — {run.name}</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{run.id.slice(0, 8)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="btn-secondary text-sm">
              <Download className="w-3.5 h-3.5" /> Export to CSV
            </button>
            <button onClick={onClose} className="btn-secondary text-sm">Close</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-100 shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              <t.icon className={cn('w-3.5 h-3.5', tab === t.id ? 'text-brand-600' : t.color)} />
              {t.label} <span className="text-slate-400">({counts[t.id]})</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search ASIN or title…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {paged.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">No items match this filter.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-2 font-medium">ASIN</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">eBay Item</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(item => {
                  const cls = classifyItem(item)
                  const ebayId = ebayIdByAsin.get(item.asin)
                  return (
                    <tr key={item.id} className="border-b border-slate-50 align-top">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center shrink-0">a</span>
                          <a
                            href={`https://www.amazon.com/dp/${item.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-slate-700 hover:text-brand-600"
                          >
                            {item.asin}
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 max-w-[240px]">
                        <p className="text-slate-800 truncate">{item.title || '—'}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {ebayId ? (
                          <a
                            href={`https://www.ebay.com/itm/${ebayId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-brand-600 hover:text-brand-700"
                          >
                            {ebayId.slice(0, 12)}
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {cls === 'success' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700 bg-success-50 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                          </span>
                        )}
                        {cls === 'blocked' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                            <Ban className="w-3 h-3" /> Blocked
                          </span>
                        )}
                        {cls === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-error-700 bg-error-50 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" /> Failed
                          </span>
                        )}
                        {cls === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                            <Loader2 className="w-3 h-3 animate-spin" /> In progress
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[280px]">
                        <p className="text-xs text-slate-500 line-clamp-2">{item.error || ''}</p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer / pagination */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              disabled={currentPage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
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
    </div>,
    document.body,
  )
}

export default function ListItems() {
  const { stores, listings, fetchAmazonProduct, publishListing, bulkRuns, createBulkRun, processBulkRun, deleteBulkRun, refresh } = useStoreData()
  const [tab, setTab] = useState<Tab>('single')
  const [asin, setAsin] = useState('')
  const [product, setProduct] = useState<AmazonProduct | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null)
  // Outcome of the Promoted Listings call after a Single publish (eBay can decline it).
  const [promoteNotice, setPromoteNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [aiTitleError, setAiTitleError] = useState<string | null>(null)
  const [currentListingTemplate, setCurrentListingTemplate] = useState('')
  // Defaults come from Settings → Promoted listings (auto_promote_enabled / default_ad_rate).
  const [promoted, setPromoted] = useState(false)
  const [promoteAdRate, setPromoteAdRate] = useState(3)

  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewDescription, setReviewDescription] = useState('')
  const [reviewPrice, setReviewPrice] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('')

  const [itemSpecifics, setItemSpecifics] = useState<ItemSpecific[]>([])

  const [pricing, setPricing] = useState<StorePricing>(DEFAULT_PRICING)
  const [vero, setVero] = useState<StoreVero>(DEFAULT_VERO)

  const [bulkStoreId, setBulkStoreId] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkRunName, setBulkRunName] = useState('')
  const [bulkPromoted, setBulkPromoted] = useState(false)
  const [bulkAdRate, setBulkAdRate] = useState(3)
  const [bulkAiTitles, setBulkAiTitles] = useState(false)
  const [bulkAllowVero, setBulkAllowVero] = useState(false)
  const [bulkStarting, setBulkStarting] = useState<'live' | 'draft' | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // Which bulk runs are currently being processed in the background — a list, not a
  // single id, since multiple runs can now process concurrently (starting a new batch no
  // longer waits for a previous one to finish). Module-level, see useActiveRunIds.
  const activeRunIds = useActiveRunIds()
  const [batchPolicies, setBatchPolicies] = useState<{
    payment: { id: string; name: string }[]
    fulfillment: { id: string; name: string }[]
    return: { id: string; name: string }[]
  }>({ payment: [], fulfillment: [], return: [] })
  const [batchPaymentId, setBatchPaymentId] = useState('')
  const [batchFulfillmentId, setBatchFulfillmentId] = useState('')
  const [batchReturnId, setBatchReturnId] = useState('')

  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all')
  const [statusPage, setStatusPage] = useState(1)
  const STATUS_PAGE_SIZE = 20
  // Which batch's detail modal is open (Bulk Status → click a row). Purely a UI-selection
  // state — doesn't touch bulkRuns data itself.
  const [openRunId, setOpenRunId] = useState<string | null>(null)

  const [draftListings, setDraftListings] = useState<DraftRow[]>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)

  const activeStore = stores.find(s => s.active) || stores[0]
  const [singleStoreId, setSingleStoreId] = useState('')
  const singleStore = stores.find(s => s.id === singleStoreId) || activeStore

  // The store switcher at the top decides the store: when it changes, every tab follows it.
  useEffect(() => {
    setSingleStoreId('')
    setBulkStoreId('')
  }, [activeStore?.id])

  useEffect(() => {
    if (!singleStore?.id) return
    const storeId = singleStore.id
    let cancelled = false

    async function loadSettings() {
      // Each store's own settings — reset to defaults first so a store without a settings row
      // never inherits the previously selected store's values.
      const [pricingRes, veroRes, promoRes] = await Promise.allSettled([
        loadStorePricing(storeId),
        loadStoreVero(storeId),
        loadPromotedDefaults(storeId),
      ])
      if (cancelled) return

      if (pricingRes.status === 'fulfilled') setPricing(pricingRes.value)
      else { console.error('pricing settings error', pricingRes.reason); setPricing(DEFAULT_PRICING) }

      if (veroRes.status === 'fulfilled') setVero(veroRes.value)
      else { console.error('store_vero_settings error', veroRes.reason); setVero(DEFAULT_VERO) }

      if (promoRes.status === 'fulfilled') {
        setPromoted(promoRes.value.autoPromote)
        setPromoteAdRate(promoRes.value.adRate)
      } else {
        console.error('store_promoted_settings error', promoRes.reason)
        setPromoted(false)
        setPromoteAdRate(3)
      }
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [singleStore?.id])

  // Store keywords are checked only where Settings → VeRO says to (brand / title / description),
  // whole-word and case-insensitive. The hard-coded Amazon words are always checked.
  const storeBlockWords = useMemo(() => vero.blockKeywords.map(k => (k || '').trim()).filter(Boolean), [vero.blockKeywords])

  const titleViolation = useMemo(
    () => findBlockedWord(reviewTitle, vero.blockInTitle ? [...HARDCODED_BLOCKS, ...storeBlockWords] : HARDCODED_BLOCKS),
    [reviewTitle, vero.blockInTitle, storeBlockWords],
  )
  const descViolation = useMemo(
    () => findBlockedWord(reviewDescription, vero.blockInDescription ? [...HARDCODED_BLOCKS, ...storeBlockWords] : HARDCODED_BLOCKS),
    [reviewDescription, vero.blockInDescription, storeBlockWords],
  )
  // Item specifics: the Brand / Manufacturer values are brand text (checked when "block in brand"
  // is on); every value is checked against the hard-coded Amazon words.
  const specificsViolation = useMemo(() => {
    const brandText = itemSpecifics
      .filter(s => /^(brand|manufacturer)$/i.test(s.key.trim()))
      .map(s => s.value)
      .join(' | ')
    const allText = itemSpecifics.map(s => `${s.key}: ${s.value}`).join(' | ')
    return (vero.blockInBrand ? findBlockedWord(brandText, storeBlockWords) : null) || findBlockedWord(allText, HARDCODED_BLOCKS)
  }, [itemSpecifics, vero.blockInBrand, storeBlockWords])

  const activeViolation = titleViolation
    ? `Title contains restricted word: "${titleViolation}"`
    : descViolation
    ? `Description contains restricted word: "${descViolation}"`
    : specificsViolation
    ? `Item Specifics contains restricted word: "${specificsViolation}"`
    : null

  const handleFetch = async () => {
    if (!asin.trim()) return
    setFetching(true)
    setFetchError(null)
    setPublishError(null)
    setPublishSuccess(null)
    setPromoteNotice(null)
    setProduct(null)
    try {
      const fetched: AmazonProduct = await fetchAmazonProduct(asin, singleStore?.id)

      const rawPrice = numOr(fetched?.price, 0)
      const calcPrice = computeListPrice(rawPrice, numOr(fetched?.suggestedPrice, 0), pricing)

      setProduct(fetched)
      setReviewTitle(truncateTitleTo80(fetched?.title || ''))
      setReviewPrice(Number.isFinite(calcPrice) ? calcPrice.toFixed(2) : '')

      const isOut = String(fetched?.stock ?? '').toLowerCase().includes('out')
      setQuantity(isOut ? 0 : (Number(fetched?.defaultQuantity) || 1))

      const listingTemplate = singleStore?.id ? await loadActiveTemplate(singleStore.id) : DEFAULT_LISTING_TEMPLATE
      setCurrentListingTemplate(listingTemplate)
      const storeName = singleStore?.ebayUsername || singleStore?.nickname || 'Our Store'
      const builtDesc = fitDescriptionToBudget(listingTemplate, {
        title: fetched?.title || '',
        store_name: storeName,
        main_image: fetched?.mainImage || fetched?.images?.[0] || '',
        // Extra product photos beyond the main one, for templates that show a supporting
        // gallery strip (e.g. Settings > Templates custom designs). Static only — eBay's
        // Active Content Policy blocks JavaScript in listing descriptions, so these can't be
        // click-to-swap; eBay's own native gallery above the description already covers that.
        gallery: (fetched?.images || []).slice(1, 6),
        product_description: fetched?.description || '',
        feature_bullets: fetched?.bulletPoints || [],
      })
      setReviewDescription(builtDesc)

      const specs = extractItemSpecifics(fetched)
      setItemSpecifics(specs)

      // Amazon's category is a name/path, not an eBay category id — start on auto-detect.
      // "Generate AI Title" can fill in a real (numeric) eBay category id.
      setSelectedCategory('')
      setSelectedCategoryName('')

    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch ASIN.')
    } finally {
      setFetching(false)
    }
  }

  const handleAddSpecific = () => {
    setItemSpecifics([...itemSpecifics, { key: '', value: '' }])
  }

  const handleRemoveSpecific = (index: number) => {
    setItemSpecifics(itemSpecifics.filter((_, i) => i !== index))
  }

  const handleSpecificChange = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...itemSpecifics]
    updated[index][field] = val
    setItemSpecifics(updated)
  }

  const handleGenerateTitle = async () => {
    if (!product) return
    setGeneratingTitle(true)
    setAiTitleError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ai-generate-content', {
        body: {
          title: product.title,
          bullets: product.bulletPoints,
          brand: product.brand,
          category: product.category,
          description: product.description,
          specs: product.specs,
          storeId: singleStore?.id,
        },
      })
      if (invokeError) {
        setAiTitleError(invokeError.message || 'AI request failed')
        return
      }
      const result = (data || {}) as { title?: string; description?: string; aspects?: Record<string, string[]>; aiUsed?: boolean; error?: string; categoryId?: string; categoryName?: string }
      if (result.error) {
        setAiTitleError(result.error)
      }
      if (!result.aiUsed) {
        setAiTitleError(prev => prev || 'AI did not return usable data (check that ANTHROPIC_API_KEY is set in Supabase secrets).')
      }
      if (result.title) {
        setReviewTitle(truncateTitleTo80(result.title))
      }
      if (result.categoryId && isNumericCategoryId(String(result.categoryId))) {
        const catId = String(result.categoryId).trim()
        setSelectedCategory(catId)
        setSelectedCategoryName(result.categoryName ? `${result.categoryName} (${catId})` : catId)
      }
      if (result.aspects && Object.keys(result.aspects).length > 0) {
        setItemSpecifics(
          Object.entries(result.aspects).map(([key, value]) => ({
            key,
            value: Array.isArray(value) ? (value[0] || '') : String(value),
          }))
        )
      }
      const template = currentListingTemplate || DEFAULT_LISTING_TEMPLATE
      const storeName = singleStore?.ebayUsername || singleStore?.nickname || 'Our Store'
      const rebuilt = fitDescriptionToBudget(template, {
        title: result.title || product.title || '',
        store_name: storeName,
        main_image: product.mainImage || product.images?.[0] || '',
        gallery: (product.images || []).slice(1, 6),
        product_description: result.description || product.description || '',
        feature_bullets: product.bulletPoints || [],
      })
      setReviewDescription(rebuilt)
    } catch (err) {
      setAiTitleError(err instanceof Error ? err.message : 'AI request failed')
    } finally {
      setGeneratingTitle(false)
    }
  }

  // Builds the Single tab's publish data from what is on screen. Returns an error message
  // instead when the typed price is not a usable number (no silent fallback to another price).
  const buildSinglePayload = (): { payload: PublishListingPayload; price: number } | { error: string } => {
    if (!product) return { error: 'Fetch a product first.' }
    const price = parsePriceInput(reviewPrice)
    if (price === null) return { error: `"${reviewPrice}" is not a valid eBay price. Enter a number such as 12.99.` }
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty < 0) return { error: 'Quantity must be a whole number of 0 or more.' }
    const mainImage = product.mainImage || (product.images && product.images[0]) || ''

    const rawAspects: Record<string, string[]> = {}
    for (const spec of itemSpecifics) {
      const k = spec.key.trim()
      const v = spec.value.trim()
      if (k && v) rawAspects[k] = [v]
    }
    const aspects = sanitizeAspects(withoutPlaceholderEpa(rawAspects))

    return {
      price,
      payload: {
        sku: product.asin,
        title: reviewTitle || truncateTitleTo80(product.title || ''),
        price,
        quantity: qty,
        image: mainImage,
        images: (product.images && product.images.length > 0) ? product.images : (mainImage ? [mainImage] : []),
        description: reviewDescription,
        // Only a real (numeric) eBay category id; otherwise the publish route auto-detects.
        categoryId: isNumericCategoryId(selectedCategory) ? selectedCategory.trim() : undefined,
        aspects,
        amazonPrice: numOr(product.price, 0) || undefined,
      },
    }
  }

  const handlePublish = async () => {
    if (!singleStore || !product || activeViolation) return
    setPublishError(null)
    setPublishSuccess(null)
    setPromoteNotice(null)
    const built = buildSinglePayload()
    if ('error' in built) { setPublishError(built.error); return }
    const { payload, price: priceToUse } = built
    const storeId = singleStore.id
    setPublishing(true)

    try {
      const listingId = await publishListing(storeId, payload, { skipRefresh: true })

      // Promoted Listings: eBay's own eligibility can still decline this, so a failure here
      // never fails the publish (the listing is already live) — but the outcome is shown.
      if (promoted) {
        if (listingId) {
          const res = await promoteListing(storeId, listingId, payload.sku, promoteAdRate > 0 ? promoteAdRate : 3)
          setPromoteNotice({ ok: res.ok, text: res.ok ? res.message : `Listed, but not promoted: ${res.message}` })
        } else {
          setPromoteNotice({ ok: false, text: 'Listed, but not promoted: eBay did not return a listing id.' })
        }
      }

      setPublishSuccess(`Listed on eBay at ${formatCurrency(priceToUse)}`)
      // One reload after publish (and the promoted flag) instead of one inside publishListing.
      refresh()

      setTimeout(() => {
        setProduct(null)
        setAsin('')
        setItemSpecifics([])
      }, 2500)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  // Saves the reviewed product as a draft row, shaped exactly like the bulk "Add & Save as
  // Drafts" rows (status 'draft', no ebay_id) so it shows up under Drafts. Publishing a draft
  // later re-fetches the product and rebuilds description/specifics from Amazon, like bulk drafts.
  const handleSaveDraft = async () => {
    if (!singleStore || !product || activeViolation) return
    setPublishError(null)
    setPublishSuccess(null)
    setPromoteNotice(null)
    const built = buildSinglePayload()
    if ('error' in built) { setPublishError(built.error); return }
    const { payload } = built
    const storeId = singleStore.id
    setSavingDraft(true)
    try {
      const row = {
        store_id: storeId,
        ebay_id: null,
        title: payload.title,
        asin: payload.sku,
        amazon_price: numOr(product.price, 0),
        ebay_price: payload.price,
        quantity: payload.quantity,
        status: 'draft',
        image: payload.image || null,
        promoted,
      }
      const { data: existing, error: findErr } = await supabase
        .from('listings')
        .select('id')
        .eq('store_id', storeId)
        .eq('asin', payload.sku)
        .eq('status', 'draft')
        .limit(1)
      if (findErr) throw new Error(findErr.message)
      const existingId = ((existing || []) as Array<{ id: string }>)[0]?.id
      const { error } = existingId
        ? await supabase.from('listings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', existingId)
        : await supabase.from('listings').insert(row)
      if (error) throw new Error(error.message)
      setPublishSuccess(existingId ? 'Draft updated — find it under the Drafts tab.' : 'Saved as draft — find it under the Drafts tab.')
      setTimeout(() => {
        setProduct(null)
        setAsin('')
        setItemSpecifics([])
      }, 2500)
    } catch (err) {
      setPublishError(err instanceof Error ? `Could not save the draft: ${err.message}` : 'Could not save the draft')
    } finally {
      setSavingDraft(false)
    }
  }

  const bulkParse = useMemo(() => {
    const all = bulkText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const sepIndex = line.search(/[,;]/)
        const asinPart = sepIndex === -1 ? line : line.slice(0, sepIndex)
        const rest = sepIndex === -1 ? '' : line.slice(sepIndex + 1)
        const asinCandidate = asinPart.trim()
        const m = asinCandidate.match(/(?:\/dp\/|\/gp\/product\/|asin=)?([A-Z0-9]{10})/i)
        const cleanAsin = (m ? m[1] : asinCandidate).toUpperCase()
        const customTitle = rest.trim()
        return { asin: cleanAsin, customTitle: customTitle || undefined }
      })
      .filter(i => /^[A-Z0-9]{10}$/.test(i.asin))
    // The same ASIN pasted twice would either be listed twice or fail as "already listed" —
    // keep only its first occurrence (and its custom title, if that line had one).
    const seen = new Set<string>()
    const items = all.filter(i => {
      if (seen.has(i.asin)) return false
      seen.add(i.asin)
      return true
    })
    return { items, duplicates: all.length - items.length }
  }, [bulkText])
  const parsedBulkItems = bulkParse.items

  const bulkStore = stores.find(s => s.id === bulkStoreId) || activeStore

  useEffect(() => {
    if (!bulkStore?.id || tab !== 'bulk') return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.functions.invoke('ebay-policies', {
          body: { action: 'getPolicies', store_id: bulkStore.id },
        })
        if (cancelled) return
        const result = (data || {}) as { fulfillmentPolicies?: any[]; paymentPolicies?: any[]; returnPolicies?: any[] }
        setBatchPolicies({
          payment: (result.paymentPolicies || []).map((p: any) => ({ id: p.paymentPolicyId, name: p.name })),
          fulfillment: (result.fulfillmentPolicies || []).map((p: any) => ({ id: p.fulfillmentPolicyId, name: p.name })),
          return: (result.returnPolicies || []).map((p: any) => ({ id: p.returnPolicyId, name: p.name })),
        })
      } catch {
        // Policies are optional per-batch — fail silently
      }
    })()
    return () => { cancelled = true }
  }, [bulkStore?.id, tab])

  useEffect(() => {
    if (!bulkStore?.id || tab !== 'bulk') return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('store_promoted_settings')
        .select('auto_promote_enabled, default_ad_rate')
        .eq('store_id', bulkStore.id)
        .maybeSingle()
      if (cancelled || !data) return
      setBulkPromoted(data.auto_promote_enabled ?? false)
      setBulkAdRate(Number(data.default_ad_rate) || 3)
    })()
    return () => { cancelled = true }
  }, [bulkStore?.id, tab])

  const handleStartBulkRun = async (mode: 'live' | 'draft') => {
    if (!bulkStore || parsedBulkItems.length === 0) return
    setBulkStarting(mode)
    setBulkError(null)
    try {
      const run = await createBulkRun({
        storeId: bulkStore.id,
        name: bulkRunName.trim() || `Bulk run ${new Date().toLocaleString()}`,
        type: 'one-time',
        promoted: bulkPromoted,
        adRate: bulkAdRate,
        draftOnly: mode === 'draft',
        allowVero: bulkAllowVero,
        aiTitles: bulkAiTitles,
        policyOverrides: {
          paymentPolicyId: batchPaymentId || undefined,
          fulfillmentPolicyId: batchFulfillmentId || undefined,
          returnPolicyId: batchReturnId || undefined,
        },
        items: parsedBulkItems,
      })
      setBulkText('')
      setBulkRunName('')
      // Jump straight to Bulk Status and open this run's detail modal — the user watches
      // this exact batch progress live instead of landing on the flat summary table first.
      setTab('bulk-status')
      setOpenRunId(run.id)
      updateActiveRunIds(prev => [...prev, run.id])
      // Deliberately NOT awaited: processing continues in the background so the "Add & List
      // All" button on the Bulk tab is usable again immediately, letting another batch be
      // queued right away instead of waiting for this one to finish. Runs process
      // concurrently — each is scoped to its own run's items in the database, so they don't
      // interfere with each other.
      void processBulkRun(run.id)
        .catch(err => setBulkError(err instanceof Error ? err.message : 'Failed to process bulk run'))
        .finally(() => updateActiveRunIds(prev => prev.filter(id => id !== run.id)))
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to start bulk run')
    } finally {
      setBulkStarting(null)
    }
  }

  const handleResumeBulkRun = async (runId: string) => {
    setBulkError(null)
    updateActiveRunIds(prev => prev.includes(runId) ? prev : [...prev, runId])
    try {
      await processBulkRun(runId, { resume: true })
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to process bulk run')
    } finally {
      updateActiveRunIds(prev => prev.filter(id => id !== runId))
    }
  }

  const handleDeleteBulkRun = async (run: BulkRun) => {
    if (activeRunIds.includes(run.id)) return
    if (!window.confirm(`Delete the history of "${run.name}"? Listings that were already published stay live on eBay.`)) return
    try {
      await deleteBulkRun(run.id)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to delete bulk run')
    }
  }

  // Bulk runs are processed by this browser tab. The warning before the tab is closed or
  // reloaded while a batch is still running is registered by updateActiveRunIds (module level),
  // so it stays active even after leaving this page.

  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return bulkRuns
    if (statusFilter === 'running') return bulkRuns.filter(r => r.status === 'running' || r.status === 'paused')
    return bulkRuns.filter(r => r.status === statusFilter)
  }, [bulkRuns, statusFilter])
  const pagedRuns = filteredRuns.slice((statusPage - 1) * STATUS_PAGE_SIZE, statusPage * STATUS_PAGE_SIZE)
  const totalStatusPages = Math.max(1, Math.ceil(filteredRuns.length / STATUS_PAGE_SIZE))

  // Looks up each successfully-published item's real eBay listing ID by ASIN, from the store's
  // already-loaded listings — used only to display it in the detail modal (Export CSV / table),
  // no extra network calls and no changes to how bulk runs are processed or stored.
  const ebayIdByAsin = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of listings) {
      if (l.asin && l.ebayId) map.set(l.asin, l.ebayId)
    }
    return map
  }, [listings])

  const openRun = openRunId ? bulkRuns.find(r => r.id === openRunId) || null : null

  // Drafts belong to a store: they are shown (and published) for the store selected on the
  // Single / Drafts tab, not whichever store happens to be "active".
  const draftsStore = singleStore
  const draftsRequestRef = useRef(0)

  const loadDrafts = async () => {
    if (!draftsStore?.id) return
    const storeId = draftsStore.id
    const requestId = ++draftsRequestRef.current
    setDraftsLoading(true)
    setDraftError(null)
    try {
      const { data, error } = await supabase
        .from('listings')
        .select('id, title, image, ebay_price, amazon_price, asin, quantity, promoted')
        .eq('store_id', storeId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
      if (requestId !== draftsRequestRef.current) return
      if (error) throw new Error(error.message)
      setDraftListings((data || []) as DraftRow[])
    } catch (err) {
      if (requestId === draftsRequestRef.current) {
        setDraftListings([])
        setDraftError(err instanceof Error ? `Could not load drafts: ${err.message}` : 'Could not load drafts')
      }
    } finally {
      if (requestId === draftsRequestRef.current) setDraftsLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'drafts') void loadDrafts()
  }, [tab, draftsStore?.id])

  // A bulk "Save as Drafts" run remembers its business policies, category, VeRO choice and ad
  // rate on the bulk_runs row — reuse them when that draft is published.
  const loadDraftRunSettings = async (storeId: string, asin: string): Promise<{
    categoryId: string | null
    allowVero: boolean
    adRate: number | null
    policyOverrides?: PublishListingPayload['policyOverrides']
  } | null> => {
    const run = bulkRuns
      .filter(r => r.storeId === storeId && r.draftOnly && r.items.some(i => i.asin === asin && i.status === 'success'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!run) return null
    const { data, error } = await supabase
      .from('bulk_runs')
      .select('fulfillment_policy_id, payment_policy_id, return_policy_id, category_id, allow_vero, ad_rate')
      .eq('id', run.id)
      .maybeSingle()
    if (error || !data) return null
    const row = data as {
      fulfillment_policy_id: string | null; payment_policy_id: string | null; return_policy_id: string | null
      category_id: string | null; allow_vero: boolean | null; ad_rate: unknown
    }
    const hasPolicy = !!(row.fulfillment_policy_id || row.payment_policy_id || row.return_policy_id)
    const rate = numOr(row.ad_rate, 0)
    return {
      categoryId: row.category_id,
      allowVero: !!row.allow_vero,
      adRate: rate > 0 ? rate : null,
      policyOverrides: hasPolicy
        ? {
            fulfillmentPolicyId: row.fulfillment_policy_id || undefined,
            paymentPolicyId: row.payment_policy_id || undefined,
            returnPolicyId: row.return_policy_id || undefined,
          }
        : undefined,
    }
  }

  // Publishing a draft rebuilds the whole listing the way the Single tab / bulk do: fresh Amazon
  // data, the store's CURRENT pricing rules (not the price saved with the draft), images, item
  // specifics, template description, business policies and amazonPrice. The publish route
  // creates its own listings row for the new eBay item, so the draft row is removed afterwards.
  const handlePublishDraft = async (draft: DraftRow) => {
    const store = draftsStore
    if (!store || !draft.asin) return
    const storeId = store.id
    const asin = draft.asin
    setPublishingDraftId(draft.id)
    setDraftError(null)
    setDraftNotice(null)
    try {
      // The draft row itself carries this ASIN, so amazon-fetch's "already listed" guard has to
      // be skipped. In that mode amazon-fetch also skips its VeRO keyword block and word
      // stripping, so both are re-applied below with the store's VeRO settings.
      const [product, storePricing, storeVero, promoDefaults, template, runSettings] = await Promise.all([
        fetchAmazonProduct(asin, storeId, { skipDuplicateCheck: true }),
        loadStorePricing(storeId),
        loadStoreVero(storeId),
        loadPromotedDefaults(storeId),
        loadActiveTemplate(storeId),
        loadDraftRunSettings(storeId, asin),
      ])

      if (String(product.stock || '').toLowerCase().includes('out')) {
        throw new Error('This product is out of stock on Amazon right now — the draft was kept.')
      }

      const brandName = cleanBrandName(product.brand || '')
      const wordsToStrip = [...storeVero.removeKeywords, ...(storeVero.autoRemoveBrand && brandName ? [brandName] : [])]
      const baseTitle = draft.title || product.title || ''
      const title = truncateTitleTo80(stripWords(baseTitle, wordsToStrip) || baseTitle)
      const productDescription = stripWords(product.description || '', wordsToStrip)
      const bullets = (product.bulletPoints || []).map(b => stripWords(b, wordsToStrip)).filter(Boolean)

      if (!runSettings?.allowVero) {
        const blockWords = storeVero.blockKeywords
        const checks: Array<{ where: string; text: string; words: string[] }> = [
          { where: 'title', text: title, words: storeVero.blockInTitle ? [...HARDCODED_BLOCKS, ...blockWords] : HARDCODED_BLOCKS },
          { where: 'brand', text: `${product.brand || ''} ${brandName}`, words: storeVero.blockInBrand ? blockWords : [] },
          { where: 'description', text: productDescription, words: storeVero.blockInDescription ? blockWords : [] },
        ]
        for (const c of checks) {
          const hit = findBlockedWord(c.text, c.words)
          if (hit) throw new Error(`Blocked by VeRO filter: "${hit}" found in the ${c.where} — the draft was kept.`)
        }
      }

      const amazonPrice = numOr(product.price, 0)
      const price = computeListPrice(amazonPrice, numOr(product.suggestedPrice, 0), storePricing)
      if (!(price > 0)) throw new Error('Could not work out an eBay price (Amazon returned no price) — the draft was kept.')

      const image = product.mainImage || product.images[0] || draft.image || ''
      const quantity = draft.quantity > 0 ? draft.quantity : (product.defaultQuantity || 1)
      const description = fitDescriptionToBudget(template, {
        title,
        store_name: store.ebayUsername || store.nickname || 'Our Store',
        main_image: image,
        gallery: (product.images || []).slice(1, 6),
        product_description: productDescription,
        feature_bullets: bullets,
      })

      const payload: PublishListingPayload = {
        sku: asin,
        title,
        price,
        quantity,
        image,
        images: product.images && product.images.length > 0 ? product.images : (image ? [image] : []),
        description,
        categoryId: isNumericCategoryId(runSettings?.categoryId) ? String(runSettings?.categoryId).trim() : undefined,
        policyOverrides: runSettings?.policyOverrides,
        aspects: productAspects(product),
        amazonPrice: amazonPrice || undefined,
      }

      const listingId = await publishListing(storeId, payload, { skipRefresh: true })

      const notes: string[] = [`Published "${title}" at ${formatCurrency(price)}.`]

      const { error: delErr } = await supabase.from('listings').delete().eq('id', draft.id)
      if (delErr) {
        setDraftError(`Published on eBay, but the draft row could not be removed (${delErr.message}). Delete it here so it is not published twice.`)
      } else {
        setDraftListings(prev => prev.filter(d => d.id !== draft.id))
      }

      if (draft.promoted ?? promoDefaults.autoPromote) {
        if (listingId) {
          const res = await promoteListing(storeId, listingId, asin, runSettings?.adRate ?? promoDefaults.adRate)
          notes.push(res.ok ? res.message : `Not promoted: ${res.message}`)
        } else {
          notes.push('Not promoted: eBay did not return a listing id.')
        }
      }
      setDraftNotice(notes.join(' '))
      refresh()
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to publish draft')
    } finally {
      setPublishingDraftId(null)
    }
  }

  const handleDeleteDraft = async (draftId: string) => {
    setDraftError(null)
    setDraftNotice(null)
    const { error } = await supabase.from('listings').delete().eq('id', draftId)
    if (error) {
      setDraftError(`Could not delete the draft: ${error.message}`)
      return
    }
    setDraftListings(prev => prev.filter(d => d.id !== draftId))
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'single', label: 'Single', icon: PackagePlus },
    { id: 'bulk', label: 'Bulk', icon: Layers },
    { id: 'bulk-status', label: 'Bulk Status', icon: Upload },
    { id: 'drafts', label: 'Drafts', icon: FileText },
    { id: 'import', label: 'Import', icon: Link2 },
  ]

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'single' && (
        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm font-semibold">1</span>
                <h3 className="font-semibold text-slate-900">Add from Amazon</h3>
              </div>
            </div>
            <div className="card-body">
              {stores.length > 1 && (
                <div className="mb-4 max-w-xs">
                  <label className="label">Store</label>
                  <select className="input" value={singleStore?.id || ''} onChange={e => setSingleStoreId(e.target.value)}>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.nickname}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={asin}
                    onChange={e => setAsin(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleFetch() }}
                    placeholder="Paste an Amazon URL or enter an ASIN"
                    className="input pl-9"
                  />
                </div>
                <button onClick={() => void handleFetch()} className="btn-primary" disabled={!asin.trim() || fetching}>
                  {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {fetching ? 'Fetching...' : 'Fetch Product'}
                </button>
              </div>
              {fetchError && <div className="mt-3 flex items-center gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2"><AlertCircle className="w-4 h-4 shrink-0" />{fetchError}</div>}
            </div>
          </div>

          {product && (
            <div className="card bg-slate-50/50 border border-slate-200">
              <div className="p-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Amazon Snapshot</h4>
                <div className="flex gap-4 items-start">
                  {product.images?.[0] && (
                    <img src={product.images[0]} alt={product.title || 'Product image'} className="w-20 h-20 object-cover rounded-lg border border-slate-200 bg-white" />
                  )}
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-slate-900">{product.title}</p>
                    <p className="text-xs text-slate-500">ASIN: <span className="font-mono">{product.asin}</span> | Brand: <span className="font-medium">{product.brand || 'N/A'}</span></p>
                    <p className="text-xs text-slate-500">Amazon Price: <span className="font-semibold text-slate-700">${Number(product.price ?? 0).toFixed(2)}</span> | Stock: <span className="text-emerald-600 font-medium">{product.stock || 'In Stock'}</span></p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 mt-1">
                      <CheckCircle2 className="w-3 h-3" /> Product fetched successfully
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {product && (
            <div className="card">
              <div className="card-header">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm font-semibold">2</span>
                  <h3 className="font-semibold text-slate-900">Review before listing</h3>
                </div>
              </div>
              <div className="card-body space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="label mb-0">Title</label>
                      <button onClick={() => void handleGenerateTitle()} disabled={generatingTitle} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 disabled:opacity-50">
                        {generatingTitle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generate AI Title
                      </button>
                    </div>
                    {aiTitleError && (
                      <p className="text-xs text-error-600 bg-error-50 rounded px-2 py-1 mb-2">{aiTitleError}</p>
                    )}
                    <input
                      className={cn("input", titleViolation && "border-red-500 bg-red-50 focus:ring-red-500 text-red-900")}
                      value={reviewTitle}
                      onChange={e => setReviewTitle(truncateTitleTo80(e.target.value))}
                    />
                    <p className="mt-1 text-xs text-slate-400">eBay titles allow up to 80 characters</p>
                  </div>
                  <div>
                    <label className="label">eBay Price</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                      <input
                        className="input pl-7"
                        value={reviewPrice}
                        onChange={e => setReviewPrice(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Quantity</label>
                    <input
                      className="input"
                      type="number"
                      value={quantity}
                      onChange={e => setQuantity(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label">Category</label>
                    <div className="flex gap-2">
                      <select className="input flex-1" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
                        <option value="">Auto-detect eBay category</option>
                        {selectedCategory && <option value={selectedCategory}>{selectedCategoryName || selectedCategory}</option>}
                      </select>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {product.category ? <>Amazon category: {product.category}. </> : null}
                      eBay picks the category automatically unless "Generate AI Title" suggests one.
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="label mb-0 flex items-center gap-2">
                      <ListChecks className="w-4 h-4 text-brand-600" /> Item Specifics ({itemSpecifics.length})
                    </label>
                    <button onClick={handleAddSpecific} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Add Specific
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {itemSpecifics.map((spec, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          placeholder="Name"
                          className="input text-xs w-1/3"
                          value={spec.key}
                          onChange={e => handleSpecificChange(idx, 'key', e.target.value)}
                        />
                        <input
                          placeholder="Value"
                          className="input text-xs flex-1"
                          value={spec.value}
                          onChange={e => handleSpecificChange(idx, 'value', e.target.value)}
                        />
                        <button onClick={() => handleRemoveSpecific(idx)} className="p-1 text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    id="promoted"
                    checked={promoted}
                    onChange={e => setPromoted(e.target.checked)}
                    className="w-4 h-4 text-brand-600 rounded border-slate-300"
                  />
                  <label htmlFor="promoted" className="text-sm font-medium text-slate-700 cursor-pointer">
                    Add to eBay Promoted Listings
                  </label>
                  {promoted && (
                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                      <span className="text-xs text-slate-500">Ad rate</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step={0.5}
                        value={promoteAdRate}
                        onChange={e => setPromoteAdRate(Number(e.target.value))}
                        className="w-16 input py-1 text-sm text-center"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="label">Description</label>
                  <textarea
                    rows={8}
                    className={cn("input min-h-[160px] resize-y text-sm leading-relaxed font-sans", descViolation && "border-red-500 bg-red-50 focus:ring-red-500 text-red-900")}
                    value={reviewDescription}
                    onChange={e => setReviewDescription(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-400">This is the raw HTML sent to eBay — see how it actually renders below.</p>
                </div>

                <div>
                  <label className="label">Description Preview</label>
                  <div
                    className="border border-slate-200 rounded-lg p-4 bg-white overflow-x-auto"
                    dangerouslySetInnerHTML={{ __html: reviewDescription }}
                  />
                </div>

                {product.images && product.images.length > 0 && (
                  <div>
                    <label className="label">Product Images</label>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {product.images.map((image, idx) => (
                        <img key={idx} src={image} alt={product.title || `Image ${idx + 1}`} className="aspect-square w-full rounded-lg object-cover border border-slate-200" />
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-4 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Preview</span>
                  <div className="flex gap-3 mt-2 items-center">
                    {product.images?.[0] && <img src={product.images[0]} alt={product.title || 'Preview image'} className="w-12 h-12 object-cover rounded border" />}
                    <div>
                      <p className="text-xs font-semibold text-slate-800 line-clamp-1">{reviewTitle || 'No title'}</p>
                      <p className="text-xs text-slate-600 font-bold mt-0.5">${reviewPrice}</p>
                    </div>
                  </div>
                </div>

                {activeViolation && (
                  <div className="flex items-center gap-3 p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">
                    <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-red-800">VeRO Violation Detected</p>
                      <p className="text-xs text-red-600 mt-0.5">{activeViolation}. Remove restricted words to enable listing.</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => void handlePublish()}
                    disabled={publishing || savingDraft || !!activeViolation}
                    className="btn-primary disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                  >
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {publishing ? 'Publishing...' : 'List It'}
                  </button>
                  <button
                    onClick={() => void handleSaveDraft()}
                    disabled={publishing || savingDraft || !!activeViolation}
                    className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {savingDraft ? 'Saving...' : 'Save as Draft'}
                  </button>
                </div>

                {publishError && <div className="text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{publishError}</div>}
              </div>
            </div>
          )}

          {/* Outside the product card so the result stays visible after the form resets. */}
          {publishSuccess && <div className="flex items-center gap-2 text-sm text-success-600 bg-success-50 rounded-lg px-4 py-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{publishSuccess}</div>}
          {promoteNotice && (
            <div className={cn('flex items-center gap-2 text-sm rounded-lg px-4 py-2', promoteNotice.ok ? 'text-success-600 bg-success-50' : 'text-amber-700 bg-amber-50')}>
              {promoteNotice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {promoteNotice.text}
            </div>
          )}
        </div>
      )}

      {tab === 'bulk' && (
        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-slate-900">Bulk add from Amazon</h3>
            </div>
            <div className="card-body space-y-4">
              {stores.length > 1 && (
                <div>
                  <label className="label">Store</label>
                  <select className="input max-w-sm" value={bulkStore?.id || ''} onChange={e => setBulkStoreId(e.target.value)}>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.nickname}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Batch name (optional)</label>
                <input className="input max-w-sm" value={bulkRunName} onChange={e => setBulkRunName(e.target.value)} placeholder="e.g. Kitchen restock 08/28" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">One per line — ASIN or ASIN;Custom Title. Submitting queues this whole run — track progress and any failures under Bulk Status.</p>
                <textarea
                  rows={8}
                  className="input font-mono text-sm"
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  placeholder={'B0ABCDE123\nB0FGHIJ456;Custom title for this one\nB0KLMNO789'}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {parsedBulkItems.length} valid ASIN{parsedBulkItems.length === 1 ? '' : 's'} detected
                  {bulkParse.duplicates > 0 && (
                    <span className="text-amber-600"> · {bulkParse.duplicates} duplicate{bulkParse.duplicates === 1 ? '' : 's'} removed</span>
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Business policies for this batch</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Shipping policy</label>
                    <select className="input" value={batchFulfillmentId} onChange={e => setBatchFulfillmentId(e.target.value)}>
                      <option value="">Use store default</option>
                      {batchPolicies.fulfillment.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Payment policy</label>
                    <select className="input" value={batchPaymentId} onChange={e => setBatchPaymentId(e.target.value)}>
                      <option value="">Use store default</option>
                      {batchPolicies.payment.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Return policy</label>
                    <select className="input" value={batchReturnId} onChange={e => setBatchReturnId(e.target.value)}>
                      <option value="">Use store default</option>
                      {batchPolicies.return.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={bulkAiTitles} onChange={e => setBulkAiTitles(e.target.checked)} className="w-4 h-4 text-brand-600 rounded border-slate-300" />
                <div>
                  <span className="text-sm font-medium text-indigo-800">AI Titles</span>
                  <span className="text-xs text-indigo-700"> — generate optimized eBay titles and item specifics for this batch instead of using the raw Amazon title. Items with a custom title in the list above keep that title.</span>
                </div>
              </label>

              <label className="flex items-center justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={bulkPromoted} onChange={e => setBulkPromoted(e.target.checked)} className="w-4 h-4 text-brand-600 rounded border-slate-300" />
                  <div>
                    <span className="text-sm font-medium text-emerald-800">Promoted Listings</span>
                    <span className="text-xs text-emerald-700"> — add every listing in this batch to your eBay ad campaign</span>
                  </div>
                </div>
                {bulkPromoted && (
                  <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-emerald-700">Ad rate</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={0.5}
                      value={bulkAdRate}
                      onChange={e => setBulkAdRate(Number(e.target.value))}
                      className="w-16 input py-1 text-sm text-center"
                    />
                    <span className="text-xs text-emerald-700">%</span>
                  </div>
                )}
              </label>
              {bulkPromoted && (
                <p className="text-xs text-slate-400 -mt-2">
                  Whether this actually runs depends on eBay's own Promoted Listings eligibility (an established sales history, among other factors) — not something this toggle controls. If eBay declines, the listing still publishes normally.
                </p>
              )}

              <label className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={bulkAllowVero} onChange={e => setBulkAllowVero(e.target.checked)} className="w-4 h-4 text-brand-600 rounded border-slate-300" />
                <div>
                  <span className="text-sm font-medium text-purple-800">Allow VeRO</span>
                  <span className="text-xs text-purple-700"> — ignore your VeRO brand block list for this batch only. Use with caution.</span>
                </div>
              </label>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => void handleStartBulkRun('live')}
                  disabled={!!bulkStarting || parsedBulkItems.length === 0 || !bulkStore}
                  className="btn-primary disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                >
                  {bulkStarting === 'live' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {bulkStarting === 'live' ? 'Running...' : `Add & List All (${parsedBulkItems.length})`}
                </button>
                <button
                  onClick={() => void handleStartBulkRun('draft')}
                  disabled={!!bulkStarting || parsedBulkItems.length === 0 || !bulkStore}
                  className="btn-secondary disabled:cursor-not-allowed"
                >
                  {bulkStarting === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {bulkStarting === 'draft' ? 'Saving...' : 'Add & Save as Drafts'}
                </button>
              </div>
              {bulkError && <div className="text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{bulkError}</div>}
              <p className="text-xs text-slate-400">Each ASIN is fetched from Amazon, priced using your saved profit rules, checked against your VeRO list, and either published live or saved as a draft. Large batches take a while — track progress under "Bulk Status".</p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Keep this browser tab open while a batch is running — batches are processed by this page. If the tab is closed, open Bulk Status later and press <span className="font-medium">Resume</span> to continue where it stopped.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'bulk-status' && (
        <div className="card">
          <div className="card-header flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Bulk listings</h3>
              <p className="text-xs text-slate-500 mt-0.5">Every bulk run. Click a batch to see which ASINs completed, were blocked, or failed — and why.</p>
            </div>
            <select
              className="input w-auto text-sm"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setStatusPage(1) }}
            >
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="card-body p-0">
            {filteredRuns.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No bulk runs yet. Start one from the "Bulk" tab.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                        <th className="py-2 pl-4 pr-2">Batch</th>
                        <th className="py-2 px-2">Store</th>
                        <th className="py-2 px-2">Created</th>
                        <th className="py-2 px-2">Completed</th>
                        <th className="py-2 px-2">Progress</th>
                        <th className="py-2 px-2">Success</th>
                        <th className="py-2 px-2">Failed</th>
                        <th className="py-2 px-2">Status</th>
                        <th className="py-2 pr-4 pl-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {pagedRuns.map(run => (
                        <tr
                          key={run.id}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => setOpenRunId(run.id)}
                          title="Click to see per-item results"
                        >
                          <td className="py-2.5 pl-4 pr-2">
                            <p className="font-medium text-slate-800">{run.name}</p>
                            <p className="text-xs text-slate-400 font-mono">{run.id.slice(0, 8)}</p>
                          </td>
                          <td className="py-2.5 px-2 text-slate-600 whitespace-nowrap">{stores.find(s => s.id === run.storeId)?.nickname || '—'}</td>
                          <td className="py-2.5 px-2 text-slate-500 whitespace-nowrap">{new Date(run.createdAt).toLocaleString()}</td>
                          <td className="py-2.5 px-2 text-slate-500 whitespace-nowrap">{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</td>
                          <td className="py-2.5 px-2 text-slate-600 whitespace-nowrap">{run.succeeded + run.failed} / {run.total}</td>
                          <td className="py-2.5 px-2 text-emerald-600 font-medium">{run.succeeded}</td>
                          <td className="py-2.5 px-2 text-red-500 font-medium">{run.failed}</td>
                          <td className="py-2.5 px-2">
                            <span className={cn(
                              'text-xs font-medium px-2 py-0.5 rounded-full',
                              run.status === 'completed' && 'bg-emerald-50 text-emerald-700',
                              run.status === 'failed' && 'bg-red-50 text-red-700',
                              (run.status === 'running' || run.status === 'paused') && 'bg-amber-50 text-amber-700',
                            )}>{run.status}</span>
                          </td>
                          <td className="py-2.5 pr-4 pl-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            {run.status !== 'completed' && (
                              <button
                                onClick={() => void handleResumeBulkRun(run.id)}
                                disabled={activeRunIds.includes(run.id)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 mr-3"
                              >
                                {activeRunIds.includes(run.id) ? 'Processing…' : 'Resume'}
                              </button>
                            )}
                            <button
                              onClick={() => void handleDeleteBulkRun(run)}
                              disabled={activeRunIds.includes(run.id)}
                              className="text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                              title={activeRunIds.includes(run.id) ? 'Wait until this batch finishes' : 'Delete run history'}
                            >
                              <Trash2 className="w-4 h-4 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalStatusPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
                    <span>Page {statusPage} of {totalStatusPages}</span>
                    <div className="flex gap-2">
                      <button disabled={statusPage <= 1} onClick={() => setStatusPage(p => p - 1)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Prev</button>
                      <button disabled={statusPage >= totalStatusPages} onClick={() => setStatusPage(p => p + 1)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'drafts' && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Drafts</h3>
            <p className="text-xs text-slate-500 mt-0.5">Saved but not yet live on eBay. Publishing re-checks Amazon and prices the item with your current pricing rules.</p>
            {stores.length > 1 && (
              <div className="mt-3 max-w-xs">
                <label className="label">Store</label>
                <select className="input" value={draftsStore?.id || ''} onChange={e => setSingleStoreId(e.target.value)}>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.nickname}</option>)}
                </select>
              </div>
            )}
          </div>
          {(draftError || draftNotice) && (
            <div className="px-4 pt-3 space-y-2">
              {draftError && <div className="flex items-start gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{draftError}</div>}
              {draftNotice && <div className="flex items-start gap-2 text-sm text-success-600 bg-success-50 rounded-lg px-4 py-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />{draftNotice}</div>}
            </div>
          )}
          <div className="card-body p-0">
            {draftsLoading ? (
              <div className="p-8 text-center text-sm text-slate-500"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading drafts…</div>
            ) : draftListings.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No drafts. Save some from the "Bulk" or "Single" tab.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {draftListings.map(d => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    {d.image ? (
                      <img src={d.image} alt={d.title} className="w-10 h-10 object-cover rounded border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{d.title}</p>
                      <p className="text-xs text-slate-400 font-mono">{d.asin}</p>
                    </div>
                    <span className="text-sm font-medium text-slate-700 shrink-0">{formatCurrency(d.ebay_price)}</span>
                    <button
                      onClick={() => void handlePublishDraft(d)}
                      disabled={publishingDraftId !== null}
                      className="btn-primary text-xs shrink-0"
                    >
                      {publishingDraftId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      Publish
                    </button>
                    <button onClick={() => void handleDeleteDraft(d.id)} disabled={publishingDraftId === d.id} className="p-1.5 text-slate-400 hover:text-red-500 shrink-0 disabled:opacity-30" title="Delete draft">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'import' && <ImportPanel />}

      {openRun && (
        <BulkRunDetailModal
          run={openRun}
          ebayIdByAsin={ebayIdByAsin}
          onClose={() => setOpenRunId(null)}
        />
      )}
    </div>
  )
}

// ---- Import: link listings that are already live on eBay to their Amazon ASIN ----
// Nothing is created or changed on eBay here. The only database change is setting the ASIN on
// a listing row that eBay itself already reported for the chosen store (rows are created when
// the store's eBay listings are synced, e.g. with "Sync from eBay"). An eBay item ID that does
// not belong to the chosen store is therefore never linked — no row is ever inserted here.

type ImportRowState =
  | 'invalid' | 'duplicate'            // problems in the file itself
  | 'unchecked' | 'ready' | 'already' | 'conflict' | 'missing' // after checking the store
  | 'linked' | 'failed'                // after linking

interface ImportRow {
  line: number
  ebayId: string
  asin: string
  csvTitle: string
  state: ImportRowState
  problem: string
  currentAsin: string
  storeTitle: string
  include: boolean
}

const ASIN_RE = /^[A-Z0-9]{10}$/
const EBAY_ID_HEADERS = ['ebay item id', 'item number', 'item id', 'itemid', 'ebay id', 'ebay_item_id', 'ebay item number', 'listing id', 'ebay listing id', 'ebay_id']
const ASIN_HEADERS = ['asin', 'amazon asin', 'source asin', 'source id', 'amazon id', 'source_id']
const SKU_HEADERS = ['custom label (sku)', 'custom label', 'sku', 'sku_hint']
const TITLE_HEADERS = ['title', 'ebay title', 'listing title', 'item title']

function normHeader(h: string): string {
  return h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Accepts "B0ABC12345", lower case, or an Amazon link (…/dp/B0ABC12345).
function cleanAsin(raw: string): string {
  const v = String(raw || '').trim()
  const fromUrl = v.match(/(?:\/dp\/|\/gp\/product\/|asin=)([A-Z0-9]{10})/i)
  return (fromUrl ? fromUrl[1] : v).toUpperCase()
}

// eBay item numbers are 9–19 digits. Excel turns long numbers into "1.47557E+11", which loses
// digits for good — such a value is reported instead of being guessed.
function cleanEbayId(raw: string): { id: string; problem: string } {
  const v = String(raw || '').trim().replace(/^'/, '').replace(/\.0+$/, '')
  if (!v) return { id: '', problem: 'Missing eBay item ID' }
  if (/e\+?\d+$/i.test(v)) return { id: v, problem: 'eBay item ID was damaged by Excel (scientific notation) — export the file again without opening it in Excel' }
  if (!/^\d{9,19}$/.test(v)) return { id: v, problem: 'Not a valid eBay item ID' }
  return { id: v, problem: '' }
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim()) || ''
  const counts = [',', ';', '\t'].map(d => ({ d, n: firstLine.split(d).length - 1 }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

// Standard CSV quoting rules, with a configurable delimiter (Excel in many
// locales, including Turkish, saves CSV files with ";").
function parseDelimited(text: string, delimiter: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function share(rows: string[][], idx: number, test: (v: string) => boolean): number {
  const vals = rows.map(r => (r[idx] || '').trim()).filter(Boolean)
  if (vals.length === 0) return 0
  return vals.filter(test).length / vals.length
}

// Finds the header row (some exports start with a few lines of notes) and the columns holding
// the eBay item ID, the ASIN and the title. Returns an error message when it can't.
function detectImportColumns(rows: string[][]): { headerRow: number; idIdx: number; asinIdx: number; titleIdx: number } | { error: string } {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const header = rows[h].map(normHeader)
    const sample = rows.slice(h + 1, h + 201)
    let idIdx = header.findIndex(x => EBAY_ID_HEADERS.includes(x))
    if (idIdx === -1) continue
    let asinIdx = header.findIndex(x => ASIN_HEADERS.includes(x))
    if (asinIdx === -1) {
      // Many listing tools store the ASIN as the eBay SKU ("Custom label (SKU)").
      const skuIdx = header.findIndex(x => SKU_HEADERS.includes(x))
      if (skuIdx !== -1 && share(sample, skuIdx, v => ASIN_RE.test(cleanAsin(v))) >= 0.5) asinIdx = skuIdx
    }
    if (asinIdx === -1) {
      return { error: `Found the eBay item ID column ("${rows[h][idIdx].trim()}") but no ASIN column. The file needs a column named "ASIN" (or a SKU column that contains the ASINs).` }
    }
    if (idIdx === asinIdx) idIdx = -1
    if (idIdx === -1) continue
    const titleIdx = header.findIndex(x => TITLE_HEADERS.includes(x))
    return { headerRow: h, idIdx, asinIdx, titleIdx }
  }
  return { error: 'Could not find an eBay item ID column. The file needs a column named "eBay Item ID" or "Item number", plus an "ASIN" column.' }
}

function buildImportRows(entries: Array<{ line: number; ebayId: string; asin: string; title: string }>): ImportRow[] {
  const seen = new Set<string>()
  return entries.map(e => {
    const { id, problem: idProblem } = cleanEbayId(e.ebayId)
    const asin = cleanAsin(e.asin)
    let state: ImportRowState = 'unchecked'
    let problem = ''
    if (idProblem) { state = 'invalid'; problem = idProblem }
    else if (!asin) { state = 'invalid'; problem = 'Missing ASIN' }
    else if (!ASIN_RE.test(asin)) { state = 'invalid'; problem = `"${e.asin.trim()}" is not a valid ASIN` }
    else if (seen.has(id)) { state = 'duplicate'; problem = 'Same eBay item ID appears earlier in the file' }
    if (state === 'unchecked') seen.add(id)
    return { line: e.line, ebayId: id, asin, csvTitle: e.title.trim(), state, problem, currentAsin: '', storeTitle: '', include: false }
  })
}

function parseImportFile(text: string): { rows: ImportRow[] } | { error: string } {
  const table = parseDelimited(text, detectDelimiter(text))
  if (table.length < 2) return { error: 'The file is empty or has no data rows.' }
  const cols = detectImportColumns(table)
  if ('error' in cols) return cols
  const entries = table.slice(cols.headerRow + 1).map((r, i) => ({
    line: i + 1,
    ebayId: r[cols.idIdx] || '',
    asin: r[cols.asinIdx] || '',
    title: cols.titleIdx >= 0 ? r[cols.titleIdx] || '' : '',
  }))
  return { rows: buildImportRows(entries) }
}

// Manual box: one pair per line, "ebay_item_id,asin" — either order, separated by comma,
// semicolon, tab or spaces.
function parseManualPairs(text: string): ImportRow[] {
  const entries = text.split(/\r?\n/).map((raw, i) => ({ raw: raw.trim(), line: i + 1 })).filter(x => x.raw)
    // A header line ("ebay_item_id,asin") has no long number in it — skip it.
    .filter((x, i) => !(i === 0 && !/\d{9,}/.test(x.raw)))
    .map(({ raw, line }) => {
      const parts = raw.split(/[,;\t ]+/).map(p => p.trim()).filter(Boolean)
      if (parts.length === 2 && ASIN_RE.test(cleanAsin(parts[0])) && /^\d+$/.test(parts[1])) {
        return { line, ebayId: parts[1], asin: parts[0], title: '' }
      }
      return { line, ebayId: parts[0] || '', asin: parts[1] || '', title: '' }
    })
  return buildImportRows(entries)
}

const IMPORT_STATE_INFO: Record<ImportRowState, { label: string; cls: string }> = {
  unchecked: { label: 'Checking…', cls: 'text-slate-400' },
  ready: { label: 'Ready to link', cls: 'text-brand-600' },
  already: { label: 'Already linked', cls: 'text-emerald-600' },
  conflict: { label: 'Linked to a different ASIN', cls: 'text-amber-600' },
  missing: { label: 'Not in this store', cls: 'text-amber-600' },
  invalid: { label: 'Invalid row', cls: 'text-red-500' },
  duplicate: { label: 'Duplicate', cls: 'text-slate-500' },
  linked: { label: 'Linked', cls: 'text-emerald-600' },
  failed: { label: 'Failed', cls: 'text-red-500' },
}
const IMPORT_FILTER_ORDER: ImportRowState[] = ['ready', 'conflict', 'missing', 'already', 'linked', 'failed', 'invalid', 'duplicate', 'unchecked']
const IMPORT_TABLE_LIMIT = 300

const sleepMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  }))
}

function ImportPanel() {
  const { stores, refresh, syncAllEbayListings } = useStoreData()
  const [storeId, setStoreId] = useState('')
  const [mode, setMode] = useState<'csv' | 'manual'>('csv')
  const [manualText, setManualText] = useState('')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [phase, setPhase] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState<ImportRowState | 'all'>('all')
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const store = stores.find(s => s.id === storeId) || null

  // Starts on the store chosen in the store switcher, and follows it when it changes.
  const activeStoreId = (stores.find(s => s.active) || stores[0])?.id || ''
  useEffect(() => {
    if (activeStoreId) setStoreId(activeStoreId)
  }, [activeStoreId])

  // Closing the tab mid-way would leave only part of the file linked — warn first.
  useEffect(() => {
    if (!linking && !syncing) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [linking, syncing])

  // Reads the chosen store's own listing rows for these eBay item IDs and sorts every row into
  // ready / already linked / linked to another ASIN / not in this store.
  async function checkAgainstStore(input: ImportRow[], sid: string) {
    setChecking(true)
    setCheckError(null)
    try {
      const ids = Array.from(new Set(input.filter(r => r.state !== 'invalid' && r.state !== 'duplicate').map(r => r.ebayId)))
      const found = new Map<string, { asin: string; title: string }>()
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150)
        const { data, error } = await supabase.from('listings').select('ebay_id, asin, title').eq('store_id', sid).in('ebay_id', chunk)
        if (error) throw new Error(error.message)
        for (const r of (data || []) as Array<{ ebay_id: string | null; asin: string | null; title: string | null }>) {
          if (r.ebay_id) found.set(r.ebay_id, { asin: (r.asin || '').toUpperCase(), title: r.title || '' })
        }
      }
      setRows(input.map(r => {
        if (r.state === 'invalid' || r.state === 'duplicate') return { ...r, include: false }
        const hit = found.get(r.ebayId)
        if (!hit) return { ...r, state: 'missing', problem: 'This eBay item ID is not in this store. Connect the eBay account it belongs to, then press "Sync from eBay".', currentAsin: '', storeTitle: '', include: false }
        if (hit.asin === r.asin) return { ...r, state: 'already', problem: '', currentAsin: hit.asin, storeTitle: hit.title, include: false }
        if (hit.asin) return { ...r, state: 'conflict', problem: `Currently linked to ${hit.asin}. Tick the row to replace it with ${r.asin}.`, currentAsin: hit.asin, storeTitle: hit.title, include: false }
        return { ...r, state: 'ready', problem: '', currentAsin: '', storeTitle: hit.title, include: true }
      }))
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Could not check the store')
      setRows(input)
    } finally {
      setChecking(false)
    }
  }

  function loadRows(next: ImportRow[]) {
    setResultMessage(null)
    setFilter('all')
    setRows(next)
    if (storeId) void checkAgainstStore(next, storeId)
  }

  function handleFile(file: File) {
    setParseError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImportFile(String(reader.result || ''))
      if ('error' in parsed) { setParseError(parsed.error); setRows([]); return }
      if (parsed.rows.length === 0) { setParseError('No data rows were found in this file.'); setRows([]); return }
      loadRows(parsed.rows)
    }
    reader.onerror = () => setParseError('This file could not be read.')
    reader.readAsText(file)
  }

  function handleManualLoad() {
    setParseError(null)
    const parsed = parseManualPairs(manualText)
    if (parsed.length === 0) { setParseError('No pairs found. Use one "ebay_item_id,asin" pair per line.'); return }
    loadRows(parsed)
  }

  function handleStoreChange(sid: string) {
    setStoreId(sid)
    setResultMessage(null)
    if (rows.length > 0 && sid) void checkAgainstStore(rows.map(r => ({ ...r, state: r.state === 'invalid' || r.state === 'duplicate' ? r.state : 'unchecked' })), sid)
  }

  function handleClear() {
    setRows([]); setFileName(''); setParseError(null); setCheckError(null); setResultMessage(null); setSyncMessage(null); setFilter('all')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function toggleRow(row: ImportRow) {
    if (row.state !== 'ready' && row.state !== 'conflict' && row.state !== 'failed') return
    setRows(prev => prev.map(r => r === row ? { ...r, include: !r.include } : r))
  }

  async function handleSyncFromEbay() {
    if (!storeId) return
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await syncAllEbayListings(storeId)
      setSyncMessage(`Synced ${result.synced} listing${result.synced === 1 ? '' : 's'} from eBay.`)
      await checkAgainstStore(rows.map(r => ({ ...r, state: r.state === 'invalid' || r.state === 'duplicate' ? r.state : 'unchecked' })), storeId)
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync from eBay failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleLink() {
    if (!storeId) return
    const targets: ImportRow[] = rows.filter(r => r.include && (r.state === 'ready' || r.state === 'conflict' || r.state === 'failed'))
    if (targets.length === 0) return
    setLinking(true)
    setResultMessage(null)
    setProgress({ done: 0, total: targets.length })
    setPhase('Linking')
    const outcome = new Map<string, { ok: boolean; error: string }>()
    let done = 0
    try {
      // 1) Set the ASIN on the store's existing row. amazon_price / last_stock_check are reset so
      //    the next stock check reads the real price for this ASIN.
      await runPool(targets, 6, async (row: ImportRow) => {
        try {
          const { data, error } = await supabase
            .from('listings')
            .update({ asin: row.asin, amazon_price: 0, last_stock_check: null })
            .eq('store_id', storeId)
            .eq('ebay_id', row.ebayId)
            .select('id')
          if (error) throw new Error(error.message)
          if (!data || data.length === 0) throw new Error('This listing is no longer in this store')
          outcome.set(row.ebayId, { ok: true, error: '' })
        } catch (err) {
          outcome.set(row.ebayId, { ok: false, error: err instanceof Error ? err.message : 'Update failed' })
        }
        done++
        setProgress({ done, total: targets.length })
      })

      // 2) Verify. An eBay listing sync running at the same moment can rewrite these rows and
      //    put back the old, empty ASIN. Read the rows back a few times over ~1.5 minutes and
      //    re-apply any ASIN that didn't stick.
      const okIds = targets.filter(t => outcome.get(t.ebayId)?.ok).map(t => t.ebayId)
      const wanted = new Map(targets.map(t => [t.ebayId, t.asin]))
      for (const [round, waitMs] of [5000, 40000, 45000].entries()) {
        setPhase(`Verifying (${round + 1}/3)`)
        await sleepMs(waitMs)
        const mismatched: string[] = []
        for (let i = 0; i < okIds.length; i += 150) {
          const chunk = okIds.slice(i, i + 150)
          const { data, error } = await supabase.from('listings').select('ebay_id, asin').eq('store_id', storeId).in('ebay_id', chunk)
          if (error) throw new Error(error.message)
          const got = new Map(((data || []) as Array<{ ebay_id: string; asin: string | null }>).map(r => [r.ebay_id, (r.asin || '').toUpperCase()]))
          for (const id of chunk) if (got.get(id) !== wanted.get(id)) mismatched.push(id)
        }
        await runPool(mismatched, 6, async (id: string) => {
          const { error } = await supabase.from('listings').update({ asin: wanted.get(id) }).eq('store_id', storeId).eq('ebay_id', id)
          if (error) outcome.set(id, { ok: false, error: error.message })
        })
      }
    } catch (err) {
      setResultMessage(err instanceof Error ? `Stopped: ${err.message}` : 'Linking stopped unexpectedly')
    } finally {
      const linkedCount = Array.from(outcome.values()).filter(o => o.ok).length
      const failedCount = targets.length - linkedCount
      setRows(prev => prev.map(r => {
        const o = outcome.get(r.ebayId)
        if (!o || !targets.includes(r)) return r
        return o.ok
          ? { ...r, state: 'linked', problem: '', currentAsin: r.asin, include: false }
          : { ...r, state: 'failed', problem: o.error, include: true }
      }))
      setResultMessage(prev => prev || `${linkedCount} linked${failedCount ? `, ${failedCount} failed — they stay ticked so you can retry` : ''}.`)
      setLinking(false)
      setPhase('')
      refresh()
    }
  }

  function downloadProblems() {
    const problems = rows.filter(r => ['missing', 'invalid', 'duplicate', 'failed', 'conflict'].includes(r.state))
    const csv = [['Row', 'eBay Item ID', 'ASIN', 'Status', 'Details']]
      .concat(problems.map(r => [String(r.line), r.ebayId, r.asin, IMPORT_STATE_INFO[r.state].label, r.problem]))
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-problems.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const counts = useMemo(() => {
    const c = {} as Record<ImportRowState, number>
    for (const s of IMPORT_FILTER_ORDER) c[s] = 0
    for (const r of rows) c[r.state]++
    return c
  }, [rows])
  const selectedCount = rows.filter(r => r.include && (r.state === 'ready' || r.state === 'conflict' || r.state === 'failed')).length
  const visibleRows = filter === 'all' ? rows : rows.filter(r => r.state === filter)
  const busy = checking || linking || syncing

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Link listings that are already live on eBay</h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload a CSV with each listing's eBay item ID and Amazon ASIN (for example an export from your previous listing tool).
            Nothing is created or changed on eBay — this only tells the app which Amazon product each existing eBay listing belongs to.
            Only eBay item IDs that belong to the selected store can be linked.
          </p>
        </div>
        <div className="card-body space-y-4">
          <div className="max-w-xs">
            <label className="label">eBay store the listings are on</label>
            <select className="input" value={storeId} onChange={e => handleStoreChange(e.target.value)} disabled={busy}>
              <option value="">Choose a store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.nickname}</option>)}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setMode('csv')}
              disabled={busy}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', mode === 'csv' ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-600 hover:bg-slate-100 border border-transparent')}
            >
              <Upload className="w-4 h-4" /> CSV file
            </button>
            <button
              onClick={() => setMode('manual')}
              disabled={busy}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', mode === 'manual' ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-600 hover:bg-slate-100 border border-transparent')}
            >
              <Link2 className="w-4 h-4" /> Manual pairs
            </button>
          </div>

          {mode === 'csv' ? (
            <div>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 text-sm text-slate-600 border-2 border-dashed border-slate-300 rounded-lg py-6 hover:border-brand-400 hover:bg-brand-50/30 transition disabled:opacity-50"
              >
                <Upload className="w-5 h-5" /> {fileName ? `${fileName} — choose another file` : 'Choose CSV file'}
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Needed columns: <span className="font-mono">eBay Item ID</span> (or <span className="font-mono">Item number</span>) and <span className="font-mono">ASIN</span> (or a SKU column holding the ASIN). Comma or semicolon separated.
              </p>
            </div>
          ) : (
            <div>
              <textarea
                rows={6}
                className="input font-mono text-sm"
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder={'ebay_item_id,asin\n147556637636,B0DFPWNMQT'}
                disabled={busy}
              />
              <button onClick={handleManualLoad} disabled={busy || !manualText.trim()} className="btn-secondary text-sm mt-2 disabled:opacity-50">
                <ListChecks className="w-4 h-4" /> Check pairs
              </button>
            </div>
          )}

          {parseError && <div className="flex items-start gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{parseError}</div>}
          {checkError && <div className="flex items-start gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />Could not check the store: {checkError}</div>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="card-body space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{rows.length}</span> row{rows.length === 1 ? '' : 's'} loaded
                {store ? <> · store <span className="font-semibold">{store.nickname}</span></> : <span className="text-amber-600"> · choose a store above</span>}
                {checking && <span className="text-slate-400"> · checking…</span>}
              </p>
              <div className="flex items-center gap-2">
                {(counts.missing + counts.invalid + counts.duplicate + counts.failed + counts.conflict) > 0 && (
                  <button onClick={downloadProblems} disabled={busy} className="btn-secondary text-sm"><Download className="w-4 h-4" /> Download problem rows</button>
                )}
                <button onClick={handleClear} disabled={busy} className="btn-ghost text-sm text-slate-500"><X className="w-4 h-4" /> Clear</button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => setFilter('all')} className={cn('px-3 py-1 rounded-full text-xs border', filter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>All {rows.length}</button>
              {IMPORT_FILTER_ORDER.filter(s => counts[s] > 0).map(s => (
                <button key={s} onClick={() => setFilter(s)} className={cn('px-3 py-1 rounded-full text-xs border', filter === s ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 hover:bg-slate-50', filter === s ? '' : IMPORT_STATE_INFO[s].cls)}>
                  {IMPORT_STATE_INFO[s].label} {counts[s]}
                </button>
              ))}
            </div>

            {counts.missing > 0 && store && !checking && (
              <div className="text-sm bg-amber-50 text-amber-800 rounded-lg px-4 py-3 space-y-2">
                <p>
                  {counts.missing} eBay item ID{counts.missing === 1 ? ' is' : 's are'} not in <b>{store.nickname}</b>. Either they belong to another eBay account
                  (connect that account and choose it above), or they haven't been synced from eBay yet — eBay listings appear here after they are synced.
                </p>
                <button onClick={() => void handleSyncFromEbay()} disabled={busy} className="btn-secondary text-sm">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {syncing ? 'Syncing from eBay…' : `Sync from eBay for ${store.nickname}, then re-check`}
                </button>
                {syncMessage && <p className="text-xs">{syncMessage}</p>}
              </div>
            )}

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                    <th className="px-3 py-2 w-10"></th>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">eBay item</th>
                    <th className="px-3 py-2 font-medium">ASIN</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, IMPORT_TABLE_LIMIT).map(row => {
                    const selectable = row.state === 'ready' || row.state === 'conflict' || row.state === 'failed'
                    return (
                      <tr key={row.line} className="border-b border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={row.include} disabled={!selectable || busy} onChange={() => toggleRow(row)} className="w-4 h-4 text-brand-600 rounded border-slate-300 disabled:opacity-30" />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">{row.line}</td>
                        <td className="px-3 py-2 max-w-sm">
                          <p className="text-slate-800 truncate">{row.storeTitle || row.csvTitle || '—'}</p>
                          <p className="text-xs text-slate-400 font-mono">{row.ebayId || '—'}</p>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.asin || '—'}
                          {row.state === 'conflict' && <p className="text-amber-600">now: {row.currentAsin}</p>}
                        </td>
                        <td className="px-3 py-2 max-w-xs">
                          <p className={cn('text-xs font-medium', IMPORT_STATE_INFO[row.state].cls)}>{IMPORT_STATE_INFO[row.state].label}</p>
                          {row.problem && <p className="text-xs text-slate-500">{row.problem}</p>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {visibleRows.length > IMPORT_TABLE_LIMIT && (
              <p className="text-xs text-slate-400">Showing the first {IMPORT_TABLE_LIMIT} of {visibleRows.length} rows. Use the filters above to see the rest; every row is processed.</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
              <p className="text-xs text-slate-500">
                {linking
                  ? `${phase}… ${phase === 'Linking' ? `${progress.done}/${progress.total}` : 'making sure every link was saved'} — keep this tab open`
                  : `${selectedCount} row${selectedCount === 1 ? '' : 's'} selected to link`}
              </p>
              <button
                onClick={() => void handleLink()}
                disabled={busy || !storeId || selectedCount === 0}
                className="btn-primary text-sm disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
              >
                {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {linking ? 'Linking…' : `Link ${selectedCount} listing${selectedCount === 1 ? '' : 's'}`}
              </button>
            </div>

            {resultMessage && (
              <div className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-4 py-3 text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> {resultMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
