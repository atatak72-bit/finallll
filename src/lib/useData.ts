import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, authHeaders } from './supabase'
import { buildTemplateDescription, proxyImageUrls, renderListingTemplate, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE, calculateEbayPrice, truncateTitleTo80, sanitizeAspects, extractBasicAspectsFromSpecs, numberOr } from './utils'
import type {
  EbayTokenRow, ListingRow, OrderRow,
  ConversationRow, MessageRow, RevisionRow, SettingsRow,
  BulkRunRow, BulkRunItemRow,
} from './supabase'
// Mock data removed — the app now shows real data from the database or empty states.
import type { Store, Listing, ListingStatus, Order, Conversation, Revision, Message } from '../data/types'

// How many bulk items are processed at the same time. amazon-fetch now scrapes through the
// Webshare proxy pool (AMAZON_PROXIES) instead of the old single-core VPS browser, so the old
// limit of 2 no longer applies.
const BULK_CONCURRENCY = 4

// Hard cap for one amazon-fetch or publish call. Without it a hung request froze a bulk worker
// forever.
const REQUEST_TIMEOUT_MS = 90_000

// Supabase returns at most 1000 rows per request, so bigger tables are read page by page.
const DB_PAGE_SIZE = 1000

// Only the non-secret ebay_tokens columns. Never select access_token / refresh_token /
// token_expires_at here — the browser has no access to those columns.
export const EBAY_TOKEN_SAFE_COLUMNS = 'id, store_nickname, ebay_username, connected, active, created_at, updated_at, sync_all_page, reconcile_page'

const LISTING_COLUMNS = 'id, store_id, ebay_id, title, asin, amazon_price, ebay_price, quantity, status, image, listed_date, sold_count, promoted, created_at, updated_at, last_stock_check, sku_hint'

export const DEFAULT_UPDATE_REASON = 'Tubika — manuel düzenleme'

// Statuses the DB can hold beyond the base ListingStatus type: 'untracked' = removed from
// automation (the server tracker only claims active/out_of_stock/unknown rows), 'delisted_cold'
// = set by the server.
export type AppListingStatus = ListingStatus | 'untracked' | 'delisted_cold'

// A listing as the app sees it: listedDate is '' when the DB has no listed_date (shown as "—"),
// skuHint is the SKU eBay has on file for the item ('' if unknown).
export type AppListing = Omit<Listing, 'status'> & { status: AppListingStatus; skuHint: string }

// The SKU of the eBay inventory item — the same rule the server tracker uses (sku_hint || asin).
// Never falls back to the eBay item ID: that is not a SKU.
export function listingSku(l: { asin?: string | null; skuHint?: string | null }): string {
  return (l.skuHint || l.asin || '').trim()
}

// Error from an edge-function call. status is the HTTP status, or 0 for network errors/timeouts.
export class RequestError extends Error {
  status: number
  timedOut: boolean
  constructor(message: string, status: number, timedOut = false) {
    super(message)
    this.name = 'RequestError'
    this.status = status
    this.timedOut = timedOut
  }
}

// POSTs JSON to an edge function as the signed-in user, aborting after timeoutMs.
async function postJson<T>(url: string, body: unknown, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<{ ok: boolean; status: number; data: T }> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const timeoutError = () => new RequestError(`İstek zaman aşımına uğradı (${Math.round(timeoutMs / 1000)} sn)`, 0, true)
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    const data = await res.json().catch(() => ({})) as T
    if (controller.signal.aborted) throw timeoutError()
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    if (err instanceof RequestError) throw err
    if (controller.signal.aborted) throw timeoutError()
    throw new RequestError(err instanceof Error ? err.message : 'Network error', 0)
  } finally {
    clearTimeout(timer)
  }
}

// Reads every row of a query in pages of DB_PAGE_SIZE using .range(), until a short page.
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await build(from, from + DB_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []) as T[]
    out.push(...rows)
    if (rows.length < DB_PAGE_SIZE) break
  }
  return out
}

export interface UpdateListingPayload {
  sku: string
  title?: string
  price?: number
  quantity?: number
  image?: string
  description?: string
  // Recorded in the revision history. Filled from the local listing when not given.
  oldPrice?: number
  oldQuantity?: number
  reason?: string
}

export interface UpdateListingOptions {
  // Bulk loops pass this and call refresh() once at the end.
  skipRefresh?: boolean
  // The listings row to update locally and in the DB after eBay accepts the change. When
  // omitted, the row is looked up by SKU.
  listingId?: string
}

export interface PublishListingPayload {
  sku: string
  title: string
  price: number
  quantity: number
  image: string
  images?: string[]
  description: string
  categoryId?: string
  policyOverrides?: {
    fulfillmentPolicyId?: string
    paymentPolicyId?: string
    returnPolicyId?: string
  }
  aspects?: Record<string, string[]>
  amazonPrice?: number
}

export interface BulkRunItem {
  id: string
  asin: string
  customTitle: string | null
  title: string | null
  // 'processing' = publish was started; on Resume it is checked against the listings table
  // before anything is published again.
  status: 'pending' | 'processing' | 'success' | 'failed'
  error: string | null
  image: string | null
  amazonPrice: number
  ebayPrice: number
}

export interface BulkRun {
  id: string
  storeId: string
  name: string
  type: 'one-time' | 'scheduled' | 'drip'
  status: 'running' | 'completed' | 'failed' | 'paused'
  total: number
  succeeded: number
  failed: number
  promoted: boolean
  draftOnly: boolean
  allowVero: boolean
  aiTitles: boolean
  adRate: number
  createdAt: string
  completedAt: string | null
  items: BulkRunItem[]
}

export interface CreateBulkRunInput {
  storeId: string
  name: string
  type: 'one-time' | 'scheduled' | 'drip'
  promoted: boolean
  draftOnly?: boolean
  allowVero?: boolean
  aiTitles?: boolean
  adRate?: number
  policyOverrides?: { fulfillmentPolicyId?: string; paymentPolicyId?: string; returnPolicyId?: string }
  categoryId?: string
  items: Array<{ asin: string; customTitle?: string }>
}

export interface AmazonProduct {
  asin: string
  title: string
  brand: string
  description: string
  bulletPoints: string[]
  images: string[]
  mainImage: string
  price: number
  currency: string
  stock: string
  rating: number
  ratingsTotal: number
  category: string
  specs: Record<string, string | number>
  variations: Array<{ asin: string; value: string; available: boolean; price: number }>
  suggestedPrice: number
  defaultQuantity?: number
}

export interface DataContextValue {
  stores: Store[]
  listings: AppListing[]
  orders: Order[]
  conversations: Conversation[]
  revisions: Revision[]
  loading: boolean
  // Set when the last refresh() could not load (part of) the data — show it instead of an
  // empty list.
  loadError: string | null
  connected: boolean
  oauthProcessing: boolean
  oauthError: string | null
  refresh: () => void
  syncStore: (storeId: string) => Promise<void>
  disconnectStore: (storeId: string) => Promise<void>
  updateListing: (storeId: string, payload: UpdateListingPayload, opts?: UpdateListingOptions) => Promise<void>
  publishListing: (storeId: string, payload: PublishListingPayload, opts?: { skipRefresh?: boolean; timeoutMs?: number }) => Promise<string>
  fetchAmazonProduct: (input: string, storeId?: string, opts?: { allowVero?: boolean; skipDuplicateCheck?: boolean; timeoutMs?: number }) => Promise<AmazonProduct>
  bulkRuns: BulkRun[]
  createBulkRun: (input: CreateBulkRunInput) => Promise<BulkRun>
  processBulkRun: (runId: string, opts?: { resume?: boolean }) => Promise<void>
  deleteBulkRun: (runId: string) => Promise<void>
  linkExistingListings: (storeId: string, pairs: Array<{ ebayId: string; asin: string }>) => Promise<{ linked: number; failed: Array<{ ebayId: string; asin: string; error: string }> }>
  endListing: (storeId: string, listingId: string, sku?: string, opts?: { skipRefresh?: boolean }) => Promise<void>
  removeListingLocal: (listingId: string) => Promise<void>
  syncAllEbayListings: (storeId: string) => Promise<{ synced: number; failed: number; totalFound: number }>
  updateOrderNotes: (orderId: string, notes: string) => Promise<void>
  // Makes this store the active one (ebay_tokens.active) for every page, then reloads the data.
  setActiveStore: (storeId: string) => Promise<void>
}

function mapTokenToStore(t: EbayTokenRow): Store {
  return {
    id: t.id,
    nickname: t.ebay_username || t.store_nickname,
    ebayUsername: t.ebay_username || '',
    connected: t.connected,
    active: t.active,
  }
}

function mapListingRow(l: ListingRow): AppListing {
  return {
    id: l.id,
    ebayId: l.ebay_id || '',
    title: l.title,
    asin: l.asin || '',
    amazonPrice: Number(l.amazon_price) || 0,
    ebayPrice: Number(l.ebay_price) || 0,
    quantity: l.quantity || 0,
    status: (l.status || 'unknown') as AppListingStatus,
    image: l.image || '',
    storeId: l.store_id,
    // No listed_date stays empty (shown as "—", sorted last) instead of pretending it's "now".
    listedDate: l.listed_date || '',
    soldCount: l.sold_count || 0,
    promoted: l.promoted || false,
    // last_stock_check is written by the server tracker (Webshare proxy scraper) every time it
    // checks this listing's Amazon price/stock.
    checkedDate: l.last_stock_check || null,
    skuHint: l.sku_hint || '',
  }
}

// eBay's Fulfillment API sends its own raw statuses (NOT_STARTED, IN_PROGRESS, FULFILLED),
// while the rest of the app (Orders filter, Dashboard counts, badges) works with
// pending / shipped / delivered / cancelled. Translate once here so every page agrees.
function normalizeOrderStatus(raw: string | null | undefined): Order['status'] {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'shipped' || s === 'delivered' || s === 'cancelled' || s === 'pending') return s
  if (s === 'fulfilled') return 'shipped'
  if (s === 'canceled' || s.includes('cancel')) return 'cancelled'
  return 'pending' // not_started, in_progress, empty, or anything unknown still needs shipping
}

function mapOrderRow(o: OrderRow): Order {
  return {
    id: o.id,
    storeId: o.store_id,
    orderId: o.order_id || '',
    buyerName: o.buyer_name || '',
    buyerUsername: o.buyer_username || '',
    listingTitle: o.listing_title || '',
    listingImage: o.listing_image || '',
    asin: o.asin || '',
    ebayItemId: (o as unknown as { ebay_item_id?: string | null }).ebay_item_id || '',
    quantity: (o as unknown as { quantity?: number | null }).quantity || 1,
    ebayPrice: Number(o.ebay_price) || 0,
    amazonCost: Number(o.amazon_cost) || 0,
    orderEarnings: Number((o as unknown as { order_earnings?: number | null }).order_earnings) || 0,
    profit: Number(o.profit) || 0,
    status: normalizeOrderStatus(o.status),
    orderDate: o.order_date || new Date().toISOString(),
    shipToName: o.ship_to_name || '',
    shipToStreet: o.ship_to_street || '',
    shipToCity: o.ship_to_city || '',
    shipToState: o.ship_to_state || '',
    shipToZip: o.ship_to_zip || '',
    shipToCountry: o.ship_to_country || '',
    trackingNumber: o.tracking_number,
    trackingCarrier: o.tracking_carrier,
    notes: o.notes || '',
  }
}

function mapConversationRow(c: ConversationRow, messages: MessageRow[]): Conversation {
  return {
    id: c.id,
    buyerName: c.buyer_name || '',
    buyerUsername: c.buyer_username || '',
    listingTitle: c.listing_title || '',
    lastMessage: c.last_message || '',
    lastMessageDate: c.last_message_date || new Date().toISOString(),
    unread: c.unread || false,
    messages: messages.map(m => ({
      id: m.id,
      from: m.from as Message['from'],
      body: m.body,
      date: m.date,
    })),
  }
}

function mapRevisionRow(r: RevisionRow): Revision {
  return {
    id: r.id,
    listingTitle: r.listing_title || '',
    field: r.field as Revision['field'],
    oldValue: r.old_value || '',
    newValue: r.new_value || '',
    reason: r.reason || '',
    date: r.date,
  }
}

// ---- Bulk helpers ----
// Errors that mean "a rule worked as intended" (VeRO, Prime/FBA, rating, stock, duplicate,
// eBay policy blocks) rather than a technical failure. Shared by the Bulk Status screen (to put
// these under "Blocked") and by Resume (which no longer re-fetches items that will only be
// blocked again — that just burned proxy time).
const BLOCKED_ERROR_PATTERN = /blocked by vero|filtered out|not fulfilled by amazon|fba-only|not prime|prime only|prime filter|not prime-eligible|out of stock|already listed|allow duplicate|errorId":25019|improper words|violation of ebay policy|not permitted to be listed/i

export function isBlockedBulkError(error: string | null | undefined): boolean {
  return !!error && BLOCKED_ERROR_PATTERN.test(error)
}

// eBay-side hiccups that usually succeed on a second try (eBay's own "system error", the
// "Availability/Offer not found" timing issue right after creating an item, network blips).
// Real data problems (25002 missing item specifics, 25019 policy blocks) are NOT retried.
function isTransientPublishError(message: string): boolean {
  // eBay sometimes wraps its own outage in 25002 ("A user error has occurred. System error.
  // Unable to process your request. Please try again later.") — that one IS temporary.
  if (/system error|try again later/i.test(message)) return true
  if (/errorId":(25002|25019)/.test(message)) return false
  return /errorId":(25001|25604)|internal server error|not found\.|failed to fetch|networkerror|unexpected end of json/i.test(message)
}

// Whole-word, case-insensitive keyword match ("Anua" must not match "January", "Active" must
// not match "Inactive") — the same rule amazon-fetch uses on the server.
function findBlockedWord(text: string, words: string[]): string | null {
  for (const raw of words) {
    const w = (raw || '').trim()
    if (!w) continue
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    try {
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)) return w
    } catch {
      if (text.toLowerCase().includes(w.toLowerCase())) return w
    }
  }
  return null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// amazon-fetch failures worth one more try: network errors, timeouts, 5xx and scrape problems
// (captcha, proxy, page didn't load). Filter / VeRO / duplicate rejections are final.
const NON_RETRYABLE_AMAZON_ERROR = /vero|filter|duplicate|already listed|blocked|prime|fba|rating|review|out of stock|oturum/i
const SCRAPE_AMAZON_ERROR = /scrap|captcha|robot|proxy|timeout|timed out|zaman aşımı|network|failed to fetch|could not be fetched|econn|socket|502|503|504/i

function isRetryableAmazonError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (isBlockedBulkError(msg) || NON_RETRYABLE_AMAZON_ERROR.test(msg)) return false
  if (err instanceof RequestError && (err.timedOut || err.status === 0 || err.status >= 500)) return true
  return SCRAPE_AMAZON_ERROR.test(msg)
}

// eBay treats any listing that carries an "EPA Registration Number" item specific as a
// pesticide and rejects it outside pesticide categories (errorId 25019). Drop that field unless
// it holds a real registration number (e.g. AI filled it with "Does not apply").
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

function mapBulkRunRow(r: BulkRunRow, items: BulkRunItemRow[] = []): BulkRun {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    type: r.type as BulkRun['type'],
    status: r.status as BulkRun['status'],
    total: r.total,
    succeeded: r.succeeded,
    failed: r.failed,
    promoted: r.promoted,
    draftOnly: r.draft_only,
    allowVero: r.allow_vero,
    aiTitles: r.ai_titles,
    adRate: Number(r.ad_rate) || 3,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    items: items.map(mapBulkRunItemRow),
  }
}

function mapBulkRunItemRow(i: BulkRunItemRow): BulkRunItem {
  return {
    id: i.id,
    asin: i.asin,
    customTitle: i.custom_title,
    title: i.title,
    status: i.status as BulkRunItem['status'],
    error: i.error,
    image: i.image,
    amazonPrice: Number(i.amazon_price) || 0,
    ebayPrice: Number(i.ebay_price) || 0,
  }
}

export function useData(): DataContextValue {
  const [stores, setStores] = useState<Store[]>([])
  const [listings, setListings] = useState<AppListing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [bulkRuns, setBulkRuns] = useState<BulkRun[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [oauthProcessing, setOauthProcessing] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  // Latest listings for callbacks that must not be re-created on every change (updateListing).
  const listingsRef = useRef<AppListing[]>([])
  useEffect(() => { listingsRef.current = listings }, [listings])

  const refresh = useCallback(async () => {
    setLoading(true)
    // Problems with secondary data (messages, revisions, bulk runs) are collected and shown;
    // a failure loading stores/listings/orders aborts the refresh and keeps the old data.
    const problems: string[] = []

    try {
      const { data: tokenData, error: tokenErr } = await supabase
        .from('ebay_tokens')
        .select(EBAY_TOKEN_SAFE_COLUMNS)
        .order('created_at', { ascending: true })
      if (tokenErr) throw new Error(`Mağazalar yüklenemedi: ${tokenErr.message}`)
      const tokenRows = (tokenData || []) as unknown as EbayTokenRow[]

      if (tokenRows.length > 0) {
        setConnected(true)
        const mappedStores = tokenRows.map(mapTokenToStore)
        setStores(mappedStores)

        const activeStore = mappedStores.find(s => s.active) || mappedStores[0]
        const storeId = activeStore.id

        const [listingRows, rawOrders, convRes, revRes] = await Promise.all([
          fetchAllRows<ListingRow>((from, to) => supabase
            .from('listings')
            .select(LISTING_COLUMNS)
            .eq('store_id', storeId)
            .order('listed_date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: true })
            .range(from, to))
            .catch((err: unknown) => { throw new Error(`İlanlar yüklenemedi: ${err instanceof Error ? err.message : String(err)}`) }),
          fetchAllRows<OrderRow>((from, to) => supabase
            .from('orders')
            .select('*')
            .eq('store_id', storeId)
            .order('order_date', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to))
            .catch((err: unknown) => { throw new Error(`Siparişler yüklenemedi: ${err instanceof Error ? err.message : String(err)}`) }),
          supabase.from('conversations').select('*').eq('store_id', storeId).order('last_message_date', { ascending: false }),
          supabase.from('revisions').select('*').eq('store_id', storeId).order('date', { ascending: false }).limit(50),
        ])

        // Match each order back to the listing it belongs to via the eBay item ID (not ASIN —
        // many listings have no ASIN at all, e.g. ones synced in from eBay rather than published
        // through this app, but every listing does have an ebay_id). This gives Sold count and
        // Last Sale date without depending on listings.sold_count, which nothing ever updates.
        const salesByItemId = new Map<string, { count: number; lastDate: string }>()
        for (const o of rawOrders) {
          const itemId = (o as unknown as { ebay_item_id?: string | null }).ebay_item_id
          if (!itemId) continue
          const date = o.order_date || ''
          const existing = salesByItemId.get(itemId)
          if (!existing) {
            salesByItemId.set(itemId, { count: 1, lastDate: date })
          } else {
            existing.count += 1
            if (date > existing.lastDate) existing.lastDate = date
          }
        }

        const mappedListings = listingRows.map(mapListingRow).map(l => {
          const sale = l.ebayId ? salesByItemId.get(l.ebayId) : undefined
          return sale ? { ...l, soldCount: sale.count, lastSaleDate: sale.lastDate } : l
        })

        setListings(mappedListings)
        setOrders(rawOrders.map(mapOrderRow))

        const bulkRunsRes = await supabase.from('bulk_runs').select('*').eq('store_id', storeId).order('created_at', { ascending: false })
        if (bulkRunsRes.error) problems.push(`Toplu işlemler yüklenemedi: ${bulkRunsRes.error.message}`)
        const bulkRunRows = (bulkRunsRes.data || []) as BulkRunRow[]
        let bulkItemsFailed = false
        const bulkRunsWithItems = await Promise.all(
          bulkRunRows.map(async (run) => {
            try {
              const items = await fetchAllRows<BulkRunItemRow>((from, to) => supabase
                .from('bulk_run_items')
                .select('*')
                .eq('run_id', run.id)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to))
              return mapBulkRunRow(run, items)
            } catch {
              bulkItemsFailed = true
              return mapBulkRunRow(run, [])
            }
          })
        )
        if (bulkItemsFailed) problems.push('Bazı toplu işlem kalemleri yüklenemedi.')
        setBulkRuns(bulkRunsWithItems)

        if (convRes.error) problems.push(`Mesajlar yüklenemedi: ${convRes.error.message}`)
        let messagesFailed = false
        const convsWithMessages = await Promise.all(
          ((convRes.data || []) as ConversationRow[]).map(async (conv) => {
            const { data: msgs, error: msgErr } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', conv.id)
              .order('date', { ascending: true })
            if (msgErr) messagesFailed = true
            return mapConversationRow(conv, (msgs || []) as MessageRow[])
          })
        )
        if (messagesFailed) problems.push('Bazı mesaj içerikleri yüklenemedi.')
        setConversations(convsWithMessages)
        if (revRes.error) problems.push(`Revizyonlar yüklenemedi: ${revRes.error.message}`)
        setRevisions(((revRes.data || []) as RevisionRow[]).map(mapRevisionRow))
      } else {
        setConnected(false)
        setStores([])
        setListings([])
        setOrders([])
        setConversations([])
        setRevisions([])
        setBulkRuns([])
      }
      setLoadError(problems.length > 0 ? problems.join(' · ') : null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Veriler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [])

  const syncStore = useCallback(async (storeId: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const syncUrl = `${supabaseUrl}/functions/v1/ebay-sync`
    const responses = await Promise.all([
      fetch(`${syncUrl}/listings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ storeId }) }),
      fetch(`${syncUrl}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ storeId }) }),
      fetch(`${syncUrl}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ storeId }) }),
    ])

    const failedResponse = responses.find(response => !response.ok)
    if (failedResponse) {
      const data = await failedResponse.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || 'Store sync failed')
    }

    await refresh()
  }, [refresh])

  const disconnectStore = useCallback(async (storeId: string) => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-oauth/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders()),
      },
      body: JSON.stringify({ storeId }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !data.success) throw new Error(data.error || 'Unable to disconnect store')
    setStores(prev => prev.filter(s => s.id !== storeId))
    setListings([])
    setOrders([])
    setConversations([])
    setRevisions([])
    setConnected(false)
    await refresh()
  }, [refresh])

  const fetchAmazonProduct = useCallback(async (input: string, storeId?: string, opts?: { allowVero?: boolean; skipDuplicateCheck?: boolean; timeoutMs?: number }): Promise<AmazonProduct> => {
    type AmazonFetchResponse = { success?: boolean; product?: AmazonProduct; error?: string }
    const res = await postJson<AmazonFetchResponse | null>(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/amazon-fetch`,
      { asin: input, store_id: storeId, ...(opts?.allowVero ? { allow_vero: true } : {}), ...(opts?.skipDuplicateCheck ? { skip_duplicate_check: true } : {}) },
      opts?.timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
    const data: AmazonFetchResponse = res.data ?? {}
    if (!res.ok || !data.success || !data.product) {
      throw new RequestError(data.error || `Amazon product could not be fetched (HTTP ${res.status})`, res.status)
    }
    const proxiedImages = await proxyImageUrls(data.product.images || [])
    return {
      ...data.product,
      images: proxiedImages,
      mainImage: proxiedImages[0] || '',
    }
  }, [])

  const publishListing = useCallback(async (storeId: string, payload: PublishListingPayload, opts?: { skipRefresh?: boolean; timeoutMs?: number }) => {
    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/publish`
    type PublishResponse = { success?: boolean; listingId?: string; error?: string }
    const res = await postJson<PublishResponse | null>(
      syncUrl,
      { storeId, ...payload, route: 'publish' },
      opts?.timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
    const data: PublishResponse = res.data ?? {}
    if (!res.ok || !data.success) throw new RequestError(data.error || `Failed to publish listing to eBay (HTTP ${res.status})`, res.status)
    // Bulk runs skip this and refresh once at the very end — reloading the whole app's data
    // (listings, orders, every conversation's messages, every bulk run's items) after EVERY
    // single published item was a large hidden delay per item.
    if (!opts?.skipRefresh) await refresh()
    return data.listingId || ''
  }, [refresh])

  const createBulkRun = useCallback(async (input: CreateBulkRunInput): Promise<BulkRun> => {
    const { data: runRow, error: runError } = await supabase
      .from('bulk_runs')
      .insert({
        store_id: input.storeId,
        name: input.name,
        type: input.type,
        status: 'running',
        total: input.items.length,
        succeeded: 0,
        failed: 0,
        promoted: input.promoted,
        draft_only: input.draftOnly || false,
        allow_vero: input.allowVero || false,
        fulfillment_policy_id: input.policyOverrides?.fulfillmentPolicyId || null,
        payment_policy_id: input.policyOverrides?.paymentPolicyId || null,
        return_policy_id: input.policyOverrides?.returnPolicyId || null,
        category_id: input.categoryId || null,
        ai_titles: input.aiTitles || false,
        ad_rate: input.adRate ?? 3,
      })
      .select('*')
      .single()
    if (runError || !runRow) throw new Error(runError?.message || 'Failed to create bulk run')

    const itemRows = input.items.map(item => ({
      run_id: runRow.id,
      asin: item.asin,
      custom_title: item.customTitle || null,
      status: 'pending',
    }))
    const { data: insertedItems, error: itemsError } = await supabase
      .from('bulk_run_items')
      .insert(itemRows)
      .select('*')
    if (itemsError) throw new Error(itemsError.message)

    const newRun = mapBulkRunRow(runRow as BulkRunRow, (insertedItems || []) as BulkRunItemRow[])
    // Add the new run to local state immediately, not just the database — otherwise the UI
    // (e.g. a "jump straight to this run's detail view" flow right after creating it) has
    // nothing to find until the next full refresh(), which previously only happened at the
    // very end of processBulkRun, making the detail view appear to do nothing until the whole
    // batch had already finished.
    setBulkRuns(prev => [newRun, ...prev])
    return newRun
  }, [])

  const processBulkRun = useCallback(async (runId: string, opts?: { resume?: boolean }): Promise<void> => {
    const { data: runRow } = await supabase.from('bulk_runs').select('*').eq('id', runId).single()
    if (!runRow) throw new Error('Bulk run not found')
    const run = runRow as BulkRunRow

    // Resume safety: a batch that was updated in the last few minutes is most likely still being
    // processed (in this tab after a refresh, or in another tab/device). Processing it twice at
    // the same time could publish the same ASIN twice, so refuse instead.
    if (opts?.resume && run.status === 'running' && Date.now() - new Date(run.updated_at).getTime() < 3 * 60 * 1000) {
      throw new Error('This batch is still being processed (maybe in another tab). Wait a few minutes, then press Resume again.')
    }

    const items = await fetchAllRows<BulkRunItemRow>((from, to) => supabase
      .from('bulk_run_items')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to))

    let blockKeywords: string[] = ['amazon', 'amazon basics', 'amazonbasics', 'fulfilled by amazon']
    if (!run.allow_vero) {
      const { data: veroSettings } = await supabase
        .from('store_vero_settings')
        .select('block_keywords')
        .eq('store_id', run.store_id)
        .maybeSingle()
      blockKeywords = [...blockKeywords, ...((veroSettings?.block_keywords as string[]) || [])]
    }

    const policyOverrides = (run.fulfillment_policy_id || run.payment_policy_id || run.return_policy_id)
      ? {
          fulfillmentPolicyId: run.fulfillment_policy_id || undefined,
          paymentPolicyId: run.payment_policy_id || undefined,
          returnPolicyId: run.return_policy_id || undefined,
        }
      : undefined

    const { data: templateRow } = await supabase
      .from('listing_templates')
      .select('template')
      .eq('store_id', run.store_id)
      .eq('is_active', true)
      .maybeSingle()
    const listingTemplate = templateRow?.template || DEFAULT_LISTING_TEMPLATE

    const { data: templateStoreRow } = await supabase
      .from('ebay_tokens')
      .select('ebay_username, store_nickname')
      .eq('id', run.store_id)
      .maybeSingle()
    const templateStoreName = templateStoreRow?.ebay_username || templateStoreRow?.store_nickname || 'Our Store'

    // Fetch this store's real profit-margin settings once for the whole run — the same
    // pricing_settings/pricing_rules and calculateEbayPrice engine the Single tab already
    // uses — instead of relying on amazon-fetch's suggestedPrice, which is always a flat 30%
    // markup baked into that function and ignores whatever margin the store actually has set.
    const [bulkPricingSettingsRes, bulkPricingRulesRes] = await Promise.all([
      supabase.from('pricing_settings').select('pricing_enabled, ebay_percentage_fee, ebay_fixed_fee').eq('store_id', run.store_id).maybeSingle(),
      supabase.from('pricing_rules').select('min_price, max_price, profit_pct, fixed_profit').eq('store_id', run.store_id).order('sort_order', { ascending: true }),
    ])
    const bulkPricingEnabled = bulkPricingSettingsRes.data?.pricing_enabled ?? true
    const bulkEbayFeePct = numberOr(bulkPricingSettingsRes.data?.ebay_percentage_fee, 13.25)
    const bulkEbayFixedFee = numberOr(bulkPricingSettingsRes.data?.ebay_fixed_fee, 0.30)
    const bulkPricingTiers = (bulkPricingRulesRes.data || []).map(r => ({
      min: Number(r.min_price) || 0,
      max: Number(r.max_price) || 999999,
      profitPct: Number(r.profit_pct) || 0,
      fixProfit: Number(r.fixed_profit) || 0,
    }))

    // Recomputed fresh from each item's current stored status every time this runs, rather
    // than trusting the run row's persisted succeeded/failed counts — this is what makes
    // "Resume" self-correcting: previously-failed items are retried below (not just
    // never-attempted ones), so their outcome needs to be counted fresh, not carried over
    // from a stale failure.
    let succeeded = items.filter(i => i.status === 'success').length
    let failed = 0

    // The eBay item ID of a listing for this ASIN that was published at/after this bulk item was
    // created (i.e. by this run), or null. Used when a publish's outcome is unknown (timeout,
    // network drop, a tab closed mid-publish) so the item is never published twice.
    const findPublishedListing = async (asin: string, since: string): Promise<string | null> => {
      const candidates = Array.from(new Set([asin, asin.toUpperCase()].filter(Boolean)))
      if (candidates.length === 0) return null
      const { data, error } = await supabase
        .from('listings')
        .select('ebay_id')
        .eq('store_id', run.store_id)
        .in('asin', candidates)
        .not('ebay_id', 'is', null)
        .gte('created_at', since)
        .limit(1)
      if (error || !Array.isArray(data) || data.length === 0) return null
      const ebayId = (data[0] as { ebay_id?: string | null }).ebay_id
      return ebayId || null
    }

    // amazon-fetch with one retry on network/timeout/5xx/scrape errors (never on filter, VeRO
    // or duplicate rejections — those would only be rejected again).
    const fetchProductWithRetry = async (asin: string): Promise<AmazonProduct> => {
      const fetchOpts = { allowVero: !!run.allow_vero, timeoutMs: REQUEST_TIMEOUT_MS }
      try {
        return await fetchAmazonProduct(asin, run.store_id, fetchOpts)
      } catch (err) {
        if (!isRetryableAmazonError(err)) throw err
        await sleep(3000)
        return await fetchAmazonProduct(asin, run.store_id, fetchOpts)
      }
    }

    const processItem = async (item: BulkRunItemRow): Promise<void> => {
      let processedStatus: BulkRunItem['status'] = 'failed'
      let processedTitle: string | null = item.title
      let processedImage: string | null = item.image
      let processedError: string | null = null
      let promoteNote: string | null = null

      try {
        const product = await fetchProductWithRetry(item.asin)
        // eBay item titles are capped at 80 characters — the bulk pipeline previously sent
        // the raw, often much longer, Amazon title straight through unlike the Single tab
        // (which already truncates). Apply the same word-safe cap here for both a custom
        // title override and the raw Amazon title.
        let title = truncateTitleTo80(item.custom_title || product.title)
        let aspects: Record<string, string[]> | undefined
        let aiDetectedCategoryId: string | undefined
        const rawAmazonPrice = Number(product.price) || 0
        const price = bulkPricingEnabled && bulkPricingTiers.length > 0
          ? calculateEbayPrice(rawAmazonPrice, bulkPricingTiers, bulkEbayFeePct, bulkEbayFixedFee, bulkPricingEnabled).finalPrice
          : (product.suggestedPrice || rawAmazonPrice)
        const quantity = product.stock.toLowerCase().includes('out') ? 0 : (product.defaultQuantity || 1)
        const image = product.mainImage || product.images[0] || ''
        processedTitle = title
        processedImage = image
        // AI Titles: only regenerate the title when the person didn't set a custom one for
        // this item — a custom title is an explicit override and should win either way.
        // Also sends the store's ID (so the function can pull an eBay access token and look
        // up that product's real category + official item-specifics list) and the raw Amazon
        // specs, so the AI fills fields with real data instead of guessing from just the title.
        let aiDescription: string | undefined
        // Check the VeRO list BEFORE spending an AI credit on an item that will be blocked anyway.
        if (!run.allow_vero) {
          const earlyHit = findBlockedWord(title, blockKeywords)
          if (earlyHit) throw new Error(`Blocked by VeRO filter (matched "${earlyHit}")`)
        }
        if (run.ai_titles && !item.custom_title) {
          try {
            const { data: aiData } = await supabase.functions.invoke('ai-generate-content', {
              body: {
                title: product.title,
                bullets: product.bulletPoints,
                brand: product.brand,
                category: product.category,
                description: product.description,
                specs: product.specs,
                storeId: run.store_id,
              },
            })
            const aiResult = (aiData || {}) as { title?: string; description?: string; aspects?: Record<string, string[]>; categoryId?: string }
            if (aiResult.title) title = truncateTitleTo80(aiResult.title)
            if (aiResult.description) aiDescription = aiResult.description
            if (aiResult.aspects && Object.keys(aiResult.aspects).length > 0) aspects = aiResult.aspects
            if (aiResult.categoryId) aiDetectedCategoryId = aiResult.categoryId
          } catch {
            // AI titling is best-effort — fall back silently to the raw Amazon title.
          }
        }

        const description = fitDescriptionToBudget(listingTemplate, {
          title,
          store_name: templateStoreName,
          main_image: product.mainImage || product.images[0] || '',
          // Extra product photos beyond the main one, for templates with a supporting gallery
          // strip. Static only — no click-to-swap, since eBay's Active Content Policy blocks
          // JavaScript in listing descriptions (eBay's own native gallery already covers that).
          gallery: (product.images || []).slice(1, 6),
          product_description: aiDescription || product.description,
          feature_bullets: product.bulletPoints,
        })

        processedTitle = title
        processedImage = image

        if (!run.allow_vero) {
          const hit = findBlockedWord(title, blockKeywords)
          if (hit) {
            throw new Error(`Blocked by VeRO filter (matched "${hit}")`)
          }
        }

        if (run.draft_only) {
          const { error: draftErr } = await supabase.from('listings').insert({
            store_id: run.store_id,
            ebay_id: null,
            title,
            asin: product.asin,
            amazon_price: product.price,
            ebay_price: price,
            quantity,
            status: 'draft',
            image,
            promoted: run.promoted,
          })
          if (draftErr) throw new Error(draftErr.message)
        } else {
          const publishPayload: PublishListingPayload = {
            sku: product.asin,
            title,
            price,
            quantity,
            image,
            images: product.images && product.images.length > 0 ? product.images : (image ? [image] : []),
            description,
            categoryId: run.category_id || aiDetectedCategoryId || undefined,
            policyOverrides,
            // eBay rejects any single item-specific value longer than ~65 characters — a
            // frequent cause is a comma-joined list (e.g. an AI-generated "Compatible Socket
            // Types" aspect) crammed into one string instead of separate array entries.
            // Sanitize right before publish so it's protected regardless of where the
            // oversized value came from. Also fill in Model/MPN from Amazon's raw spec table
            // (independent of the AI Titles toggle) without overwriting anything AI already
            // provided — many eBay categories require a Model value to publish at all, and
            // previously that only ever got filled in when AI Titles happened to be on.
            aspects: sanitizeAspects(withoutPlaceholderEpa({ ...extractBasicAspectsFromSpecs(product.specs), ...(aspects || {}) })),
            amazonPrice: product.price,
          }
          // Mark the item as being published. If this tab dies mid-publish, Resume sees
          // 'processing' and checks the listings table before publishing it again.
          await supabase.from('bulk_run_items').update({ status: 'processing', title, image }).eq('id', item.id)

          // eBay's temporary errors (25001 "system error", 25604 "... not found" right after the
          // item is created) usually clear within seconds. Retry those up to 2 more times; the
          // publish route reuses the offer it already created, so a retry never duplicates it.
          // A timeout / dropped connection means the outcome is unknown: check whether the
          // listing now exists before doing anything else.
          let ebayListingId = ''
          for (let attempt = 1; ; attempt++) {
            try {
              ebayListingId = await publishListing(run.store_id, publishPayload, { skipRefresh: true, timeoutMs: REQUEST_TIMEOUT_MS })
              break
            } catch (publishErr) {
              const msg = publishErr instanceof Error ? publishErr.message : String(publishErr)
              if (publishErr instanceof RequestError && (publishErr.timedOut || publishErr.status === 0)) {
                await sleep(5000)
                const existing = await findPublishedListing(product.asin || item.asin, item.created_at)
                if (existing) { ebayListingId = existing; break }
                if (publishErr.timedOut || attempt >= 3) throw publishErr
                await sleep(attempt * 4000)
                continue
              }
              if (attempt >= 3 || !isTransientPublishError(msg)) throw publishErr
              await sleep(attempt * 4000)
            }
          }

          // Promoted Listings: best-effort — eBay eligibility (sales history, category, etc.)
          // can reject this, so a failure never fails the item; it is noted in the item's error
          // text instead. functions.invoke doesn't throw on a failed call, so check the result.
          if (run.promoted && ebayListingId) {
            try {
              const { data: promoData, error: promoErr } = await supabase.functions.invoke('ebay-promote-listing', {
                body: { storeId: run.store_id, listingId: ebayListingId, adRate: Number(run.ad_rate) || 3 },
              })
              const promo = (promoData || {}) as { success?: boolean; error?: string }
              if (promoErr || !promo.success) {
                promoteNote = `Promote başarısız: ${promo.error || promoErr?.message || 'bilinmeyen hata'}`
              } else {
                const { error: flagErr } = await supabase
                  .from('listings')
                  .update({ promoted: true })
                  .eq('store_id', run.store_id)
                  .eq('ebay_id', ebayListingId)
                if (flagErr) promoteNote = `Promote edildi, ancak ilan kaydı güncellenemedi: ${flagErr.message}`
              }
            } catch (promoteErr) {
              promoteNote = `Promote başarısız: ${promoteErr instanceof Error ? promoteErr.message : String(promoteErr)}`
            }
          }
        }

        await supabase.from('bulk_run_items').update({
          status: 'success',
          title,
          image,
          amazon_price: product.price,
          ebay_price: price,
          error: promoteNote,
        }).eq('id', item.id)
        processedError = promoteNote

        succeeded++
        processedStatus = 'success'
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        processedError = errorMsg
        await supabase.from('bulk_run_items').update({
          status: 'failed',
          error: errorMsg,
          // Keep whatever we learned about the product so a failed row isn't just "—".
          ...(processedTitle ? { title: processedTitle } : {}),
          ...(processedImage ? { image: processedImage } : {}),
        }).eq('id', item.id)
        failed++
      }

      await supabase.from('bulk_runs').update({
        succeeded,
        failed,
        updated_at: new Date().toISOString(),
      }).eq('id', runId)

      setBulkRuns(prev => prev.map(r =>
        r.id === runId
          ? { ...r, succeeded, failed, items: r.items.map(i => i.id === item.id ? { ...i, status: processedStatus, title: processedTitle, image: processedImage, error: processedError } : i) }
          : r
      ))
    }

    // Worker pool: several items are processed at the same time instead of strictly one after
    // another. "Resume" retries BOTH never-attempted ('pending') items AND previously-failed
    // ('failed') ones — the old behavior of only picking up 'pending' items meant Resume did
    // nothing for a batch that had already failed once, even after the actual bug causing the
    // failures (a description/aspect validation issue, say) had been fixed in the meantime.
    // Items that were blocked by a rule (VeRO, Prime, rating, duplicate…) are left as they are —
    // retrying them only re-fetches Amazon to get blocked again. They still count as failed.
    const blockedCount = items.filter(i => i.status === 'failed' && isBlockedBulkError(i.error)).length
    failed = blockedCount
    // 'processing' items were mid-publish when an earlier run stopped: if the listing exists now,
    // they are marked success instead of being published a second time.
    const toRetry = items.filter(i => i.status === 'pending' || i.status === 'processing' || (i.status === 'failed' && !isBlockedBulkError(i.error)))
    const settleProcessingItem = async (item: BulkRunItemRow): Promise<boolean> => {
      const existing = await findPublishedListing(item.asin, item.created_at)
      if (!existing) return false
      const { error: settleErr } = await supabase.from('bulk_run_items').update({ status: 'success', error: null }).eq('id', item.id)
      if (settleErr) return false
      succeeded++
      setBulkRuns(prev => prev.map(r =>
        r.id === runId
          ? { ...r, succeeded, items: r.items.map(i => i.id === item.id ? { ...i, status: 'success' as const, error: null } : i) }
          : r
      ))
      return true
    }
    let cursor = 0
    const worker = async () => {
      while (cursor < toRetry.length) {
        const item = toRetry[cursor++]
        if ((item.status === 'processing' || (item.status === 'failed' && /zaman aşımı|timed out|timeout/i.test(item.error || ''))) && await settleProcessingItem(item)) continue
        await processItem(item)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, toRetry.length) }, () => worker())
    )

    const finalStatus = failed === items.length && items.length > 0 ? 'failed' : 'completed'
    const completedAt = new Date().toISOString()
    await supabase.from('bulk_runs').update({
      succeeded,
      failed,
      status: finalStatus,
      updated_at: completedAt,
      completed_at: completedAt,
    }).eq('id', runId)

    setBulkRuns(prev => prev.map(r => r.id === runId ? { ...r, status: finalStatus, succeeded, failed, completedAt } : r))
    await refresh()
  }, [fetchAmazonProduct, publishListing, refresh])

  const deleteBulkRun = useCallback(async (runId: string): Promise<void> => {
    const { error } = await supabase.from('bulk_runs').delete().eq('id', runId)
    if (error) throw new Error(error.message)
    setBulkRuns(prev => prev.filter(r => r.id !== runId))
  }, [])

  const linkExistingListings = useCallback(async (
    storeId: string,
    pairs: Array<{ ebayId: string; asin: string }>
  ): Promise<{ linked: number; failed: Array<{ ebayId: string; asin: string; error: string }> }> => {
    let linked = 0
    const failedList: Array<{ ebayId: string; asin: string; error: string }> = []

    for (const pair of pairs) {
      try {
        if (!pair.ebayId || !pair.asin) throw new Error('Missing eBay item ID or ASIN')

        let title = ''
        let price = 0
        let image = ''
        let quantity = 1
        try {
          const product = await fetchAmazonProduct(pair.asin)
          title = product.title
          price = product.suggestedPrice
          image = product.mainImage || product.images[0] || ''
          quantity = product.stock.toLowerCase().includes('out') ? 0 : 1
        } catch {
          title = `Linked item ${pair.asin}`
        }

        const { error: upsertErr } = await supabase.from('listings').upsert({
          store_id: storeId,
          ebay_id: pair.ebayId,
          asin: pair.asin,
          title,
          amazon_price: price,
          ebay_price: price,
          quantity,
          status: 'active',
          image,
          promoted: false,
        }, { onConflict: 'store_id,ebay_id' })

        if (upsertErr) throw new Error(upsertErr.message)
        linked++
      } catch (err) {
        failedList.push({ ebayId: pair.ebayId, asin: pair.asin, error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    await refresh()
    return { linked, failed: failedList }
  }, [fetchAmazonProduct, refresh])

  const endListing = useCallback(async (storeId: string, listingId: string, sku?: string, opts?: { skipRefresh?: boolean }) => {
    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/end-listing`
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()), },
      body: JSON.stringify({ storeId, listingId, sku, route: 'end-listing' }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to end listing on eBay')
    setListings(prev => prev.filter(l => l.id !== listingId))
    // Bulk callers (ending many listings at once) skip this and refresh a single time at the
    // end of the whole batch instead — refreshing the entire app's data after every single item
    // is what made deleting, say, 17 listings feel like it was happening one at a time.
    if (!opts?.skipRefresh) await refresh()
  }, [refresh])

  // "Remove from automation only": the row is kept but marked 'untracked'. Deleting it made the
  // next eBay sync import it again as a fresh, tracked listing; the server tracker only claims
  // rows whose status is active / out_of_stock / unknown, so 'untracked' rows are left alone.
  const removeListingLocal = useCallback(async (listingId: string) => {
    const { error } = await supabase.from('listings').update({ status: 'untracked' }).eq('id', listingId)
    if (error) throw new Error(error.message)
    setListings(prev => prev.map(l => l.id === listingId ? { ...l, status: 'untracked' as const } : l))
  }, [])

  const syncAllEbayListings = useCallback(async (storeId: string) => {
    // Each call only processes a bounded number of pages (to stay well inside Supabase's
    // per-invocation execution limit), so for a large catalog this keeps calling with the
    // returned cursor until the backend reports every page has been fetched.
    let page = 1
    let totalSynced = 0
    let totalFailed = 0
    let totalFound = 0
    let done = false
    let safetyCounter = 0

    while (!done && safetyCounter < 2000) {
      safetyCounter++
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/sync-all-listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()), },
        body: JSON.stringify({ storeId, route: 'sync-all-listings', startPage: page }),
      })
      const data = await res.json().catch(() => ({})) as {
        success?: boolean; synced?: number; failed?: number; totalFound?: number
        error?: string; nextPage?: number; done?: boolean
      }
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to sync listings from eBay')

      totalSynced += data.synced || 0
      totalFailed += data.failed || 0
      totalFound += data.totalFound || 0
      done = data.done ?? true
      page = data.nextPage || page + 1
    }

    await refresh()
    return { synced: totalSynced, failed: totalFailed, totalFound }
  }, [refresh])

  const updateOrderNotes = useCallback(async (orderId: string, notes: string) => {
    const { error } = await supabase.from('orders').update({ notes }).eq('id', orderId)
    if (error) throw new Error(error.message)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, notes } : o))
  }, [])

  const updateListing = useCallback(async (storeId: string, payload: UpdateListingPayload, opts?: UpdateListingOptions) => {
    // The local row this change is for: by ID when the caller knows it, else by SKU.
    const current = opts?.listingId
      ? listingsRef.current.find(l => l.id === opts.listingId)
      : listingsRef.current.find(l => l.storeId === storeId && !!payload.sku && listingSku(l) === payload.sku)

    const body: UpdateListingPayload = {
      ...payload,
      reason: payload.reason || DEFAULT_UPDATE_REASON,
      ...(payload.price !== undefined && payload.oldPrice === undefined && current ? { oldPrice: current.ebayPrice } : {}),
      ...(payload.quantity !== undefined && payload.oldQuantity === undefined && current ? { oldQuantity: current.quantity } : {}),
    }

    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/update-listing`
    const res = await postJson<{ success?: boolean; error?: string } | null>(syncUrl, { storeId, ...body, route: 'update-listing' })
    const data: { success?: boolean; error?: string } = res.data ?? {}
    if (!res.ok || !data.success) throw new RequestError(data.error || `Failed to update listing on eBay (HTTP ${res.status})`, res.status)

    // eBay accepted the change — mirror it locally and in our own listings row right away
    // instead of waiting for the next tracker cycle.
    const rowId = opts?.listingId || current?.id
    if (rowId) {
      const patch: { ebay_price?: number; quantity?: number; title?: string } = {}
      if (payload.price !== undefined) patch.ebay_price = payload.price
      if (payload.quantity !== undefined) patch.quantity = payload.quantity
      if (payload.title !== undefined) patch.title = payload.title
      setListings(prev => prev.map(l => l.id === rowId
        ? {
            ...l,
            ...(payload.price !== undefined ? { ebayPrice: payload.price } : {}),
            ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
            ...(payload.title !== undefined ? { title: payload.title } : {}),
          }
        : l))
      if (Object.keys(patch).length > 0) {
        const { error: dbErr } = await supabase.from('listings').update(patch).eq('id', rowId)
        if (dbErr) throw new Error(`eBay güncellendi, ancak veritabanı kaydı yazılamadı: ${dbErr.message}`)
      }
    }

    if (!opts?.skipRefresh) await refresh()
  }, [refresh])

  // Handle eBay OAuth redirect — runs on every page load, not just when modal is open
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const oauthErrorParam = params.get('error_description') || params.get('error')

    if (code) {
      const processed = sessionStorage.getItem('ebay_oauth_processed')
      if (processed === code) return

      sessionStorage.setItem('ebay_oauth_processed', code)
      window.history.replaceState({}, document.title, window.location.pathname)

      const nickname = sessionStorage.getItem('ebay_store_nickname') || 'My Store'
      setOauthProcessing(true)
      setOauthError(null)

      void (async () => {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-oauth/callback`, {
            method: 'POST',
            headers: {
              ...(await authHeaders()),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code, storeNickname: nickname }),
          })
          const data = await res.json() as { success?: boolean; store?: { id: string }; error?: string }
          if (!res.ok || !data.success || !data.store?.id) {
            throw new Error(data.error || 'Failed to connect store')
          }
          sessionStorage.removeItem('ebay_store_nickname')
          await refresh()

          void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/sync-all-listings`, {
            method: 'POST',
            headers: {
              ...(await authHeaders()),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ storeId: data.store!.id, route: 'sync-all-listings' }),
          }).then(() => refresh()).catch(() => {})
        } catch (err) {
          sessionStorage.removeItem('ebay_oauth_processed')
          setOauthError(err instanceof Error ? err.message : 'Failed to connect store')
        } finally {
          setOauthProcessing(false)
        }
      })()
    } else if (oauthErrorParam) {
      setOauthError(oauthErrorParam)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setActiveStore = useCallback(async (storeId: string) => {
    if (!storeId) return
    const { data: onRows, error: onErr } = await supabase
      .from('ebay_tokens')
      .update({ active: true })
      .eq('id', storeId)
      .select('id')
    if (onErr) throw new Error(onErr.message)
    if (!onRows || onRows.length === 0) throw new Error('Mağaza değiştirilemedi (izin yok).')
    const otherIds = stores.filter(s => s.id !== storeId).map(s => s.id)
    if (otherIds.length > 0) {
      const { error: offErr } = await supabase
        .from('ebay_tokens')
        .update({ active: false })
        .in('id', otherIds)
        .select('id')
      if (offErr) throw new Error(offErr.message)
    }
    await refresh()
  }, [stores, refresh])

  return { stores, listings, orders, conversations, revisions, loading, loadError, connected, oauthProcessing, oauthError, refresh, syncStore, disconnectStore, updateListing, endListing, removeListingLocal, publishListing, fetchAmazonProduct, bulkRuns, createBulkRun, processBulkRun, deleteBulkRun, linkExistingListings, syncAllEbayListings, updateOrderNotes, setActiveStore }
}
