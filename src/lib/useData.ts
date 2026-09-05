import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { buildTemplateDescription, proxyImageUrls, renderListingTemplate, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE } from './utils'
import type {
  EbayTokenRow, ListingRow, OrderRow,
  ConversationRow, MessageRow, RevisionRow, SettingsRow,
  BulkRunRow, BulkRunItemRow,
} from './supabase'
// Mock data removed — the app now shows real data from the database or empty states.
import type { Store, Listing, Order, Conversation, Revision, Message } from '../data/types'

export interface UpdateListingPayload {
  sku: string
  title?: string
  price?: number
  quantity?: number
  image?: string
  description?: string
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
  status: 'pending' | 'success' | 'failed'
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
  listings: Listing[]
  orders: Order[]
  conversations: Conversation[]
  revisions: Revision[]
  loading: boolean
  connected: boolean
  oauthProcessing: boolean
  oauthError: string | null
  refresh: () => void
  syncStore: (storeId: string) => Promise<void>
  disconnectStore: (storeId: string) => Promise<void>
  updateListing: (storeId: string, payload: UpdateListingPayload) => Promise<void>
  publishListing: (storeId: string, payload: PublishListingPayload) => Promise<string>
  fetchAmazonProduct: (input: string, storeId?: string) => Promise<AmazonProduct>
  bulkRuns: BulkRun[]
  createBulkRun: (input: CreateBulkRunInput) => Promise<BulkRun>
  processBulkRun: (runId: string) => Promise<void>
  deleteBulkRun: (runId: string) => Promise<void>
  linkExistingListings: (storeId: string, pairs: Array<{ ebayId: string; asin: string }>) => Promise<{ linked: number; failed: Array<{ ebayId: string; asin: string; error: string }> }>
  endListing: (storeId: string, listingId: string, sku?: string) => Promise<void>
  removeListingLocal: (listingId: string) => Promise<void>
  syncAllEbayListings: (storeId: string) => Promise<{ synced: number; failed: number; totalFound: number }>
  updateOrderNotes: (orderId: string, notes: string) => Promise<void>
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

function mapListingRow(l: ListingRow): Listing {
  return {
    id: l.id,
    ebayId: l.ebay_id || '',
    title: l.title,
    asin: l.asin || '',
    amazonPrice: Number(l.amazon_price) || 0,
    ebayPrice: Number(l.ebay_price) || 0,
    quantity: l.quantity || 0,
    status: (l.status as Listing['status']) || 'unknown',
    image: l.image || '',
    storeId: l.store_id,
    listedDate: l.listed_date || new Date().toISOString(),
    soldCount: l.sold_count || 0,
    promoted: l.promoted || false,
    // last_stock_check comes from ebay-stock-sync's periodic price/quantity checks.
    // Cast used in case the local ListingRow type hasn't been updated to declare this
    // column yet — the column itself already exists on the table (select('*') returns it).
    checkedDate: (l as unknown as { last_stock_check?: string | null }).last_stock_check || null,
  }
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
    status: (o.status as Order['status']) || 'pending',
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
  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [bulkRuns, setBulkRuns] = useState<BulkRun[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [oauthProcessing, setOauthProcessing] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)

    const { data: tokenRows } = await supabase.from('ebay_tokens').select('*').order('created_at', { ascending: true })
    if (tokenRows && tokenRows.length > 0) {
      setConnected(true)
      const mappedStores = tokenRows.map(mapTokenToStore)
      setStores(mappedStores)

      const activeStore = mappedStores.find(s => s.active) || mappedStores[0]
      const storeId = activeStore.id

      const [listingsRes, ordersRes, convRes, revRes] = await Promise.all([
        supabase.from('listings').select('*').eq('store_id', storeId).order('listed_date', { ascending: false }),
        supabase.from('orders').select('*').eq('store_id', storeId).order('order_date', { ascending: false }),
        supabase.from('conversations').select('*').eq('store_id', storeId).order('last_message_date', { ascending: false }),
        supabase.from('revisions').select('*').eq('store_id', storeId).order('date', { ascending: false }).limit(50),
      ])

      // Match each order back to the listing it belongs to via the eBay item ID (not ASIN —
      // many listings have no ASIN at all, e.g. ones synced in from eBay rather than published
      // through this app, but every listing does have an ebay_id). This gives Sold count and
      // Last Sale date without depending on listings.sold_count, which nothing ever updates.
      const rawOrders = ordersRes.data || []
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

      const mappedListings = (listingsRes.data || []).map(mapListingRow).map(l => {
        const sale = l.ebayId ? salesByItemId.get(l.ebayId) : undefined
        return sale ? { ...l, soldCount: sale.count, lastSaleDate: sale.lastDate } : l
      })

      setListings(mappedListings)
      setOrders(rawOrders.map(mapOrderRow))

      const bulkRunsRes = await supabase.from('bulk_runs').select('*').eq('store_id', storeId).order('created_at', { ascending: false })
      const bulkRunRows = bulkRunsRes.data || []
      const bulkRunsWithItems = await Promise.all(
        bulkRunRows.map(async (run) => {
          const { data: items } = await supabase.from('bulk_run_items').select('*').eq('run_id', run.id).order('created_at', { ascending: true })
          return mapBulkRunRow(run, items || [])
        })
      )
      setBulkRuns(bulkRunsWithItems)

      const convsWithMessages = await Promise.all(
        (convRes.data || []).map(async (conv) => {
          const { data: msgs } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conv.id)
            .order('date', { ascending: true })
          return mapConversationRow(conv, msgs || [])
        })
      )
      setConversations(convsWithMessages)
      setRevisions((revRes.data || []).map(mapRevisionRow))
    } else {
      setConnected(false)
      setStores([])
      setListings([])
      setOrders([])
      setConversations([])
      setRevisions([])
      setBulkRuns([])
    }

    setLoading(false)
  }, [])

  const syncStore = useCallback(async (storeId: string) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const syncUrl = `${supabaseUrl}/functions/v1/ebay-sync`
    const responses = await Promise.all([
      fetch(`${syncUrl}/listings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) }),
      fetch(`${syncUrl}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) }),
      fetch(`${syncUrl}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) }),
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
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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

  const fetchAmazonProduct = useCallback(async (input: string, storeId?: string): Promise<AmazonProduct> => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/amazon-fetch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ asin: input, store_id: storeId }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; product?: AmazonProduct; error?: string }
    if (!res.ok || !data.success || !data.product) {
      throw new Error(data.error || 'Amazon product could not be fetched')
    }
    const proxiedImages = await proxyImageUrls(data.product.images || [])
    return {
      ...data.product,
      images: proxiedImages,
      mainImage: proxiedImages[0] || '',
    }
  }, [])

  const publishListing = useCallback(async (storeId: string, payload: PublishListingPayload) => {
    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/publish`
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ storeId, ...payload, route: 'publish' }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; listingId?: string; error?: string }
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to publish listing to eBay')
    await refresh()
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

    return mapBulkRunRow(runRow as BulkRunRow, (insertedItems || []) as BulkRunItemRow[])
  }, [])

  const processBulkRun = useCallback(async (runId: string): Promise<void> => {
    const { data: runRow } = await supabase.from('bulk_runs').select('*').eq('id', runId).single()
    if (!runRow) throw new Error('Bulk run not found')
    const run = runRow as BulkRunRow

    const { data: itemRows } = await supabase.from('bulk_run_items').select('*').eq('run_id', runId).order('created_at', { ascending: true })
    const items = (itemRows || []) as BulkRunItemRow[]

    let blockKeywords: string[] = ['amazon', 'amazon basics', 'amazonbasics', 'prime', 'fulfilled by amazon']
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
      .maybeSingle()
    const listingTemplate = templateRow?.template || DEFAULT_LISTING_TEMPLATE

    const { data: templateStoreRow } = await supabase
      .from('ebay_tokens')
      .select('ebay_username, store_nickname')
      .eq('id', run.store_id)
      .maybeSingle()
    const templateStoreName = templateStoreRow?.ebay_username || templateStoreRow?.store_nickname || 'Our Store'

    let succeeded = 0
    let failed = 0

    for (const item of items) {
      if (item.status !== 'pending') continue

      let processedStatus: BulkRunItem['status'] = 'failed'
      let processedTitle: string | null = item.title
      let processedImage: string | null = item.image

      try {
        const product = await fetchAmazonProduct(item.asin, run.store_id)
        let title = item.custom_title || product.title
        let aspects: Record<string, string[]> | undefined
        let aiDetectedCategoryId: string | undefined
        const price = product.suggestedPrice
        const quantity = product.stock.toLowerCase().includes('out') ? 0 : (product.defaultQuantity || 1)
        const image = product.mainImage || product.images[0] || ''
        // AI Titles: only regenerate the title when the person didn't set a custom one for
        // this item — a custom title is an explicit override and should win either way.
        // Also sends the store's ID (so the function can pull an eBay access token and look
        // up that product's real category + official item-specifics list) and the raw Amazon
        // specs, so the AI fills fields with real data instead of guessing from just the title.
        let aiDescription: string | undefined
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
            if (aiResult.title) title = aiResult.title
            if (aiResult.description) aiDescription = aiResult.description
            if (aiResult.aspects && Object.keys(aiResult.aspects).length > 0) aspects = aiResult.aspects
            if (aiResult.categoryId) aiDetectedCategoryId = aiResult.categoryId
          } catch {
            // AI titling is best-effort — fall back silently to the raw Amazon title.
          }
        }

        let description = fitDescriptionToBudget(listingTemplate, {
          title,
          store_name: templateStoreName,
          main_image: product.mainImage || product.images[0] || '',
          product_description: aiDescription || product.description,
          feature_bullets: product.bulletPoints,
        })

        processedTitle = title
        processedImage = image

        if (!run.allow_vero) {
          const titleLower = title.toLowerCase()
          const hit = blockKeywords.find(kw => kw && titleLower.includes(kw.toLowerCase()))
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
          const ebayListingId = await publishListing(run.store_id, {
            sku: product.asin,
            title,
            price,
            quantity,
            image,
            images: product.images && product.images.length > 0 ? product.images : (image ? [image] : []),
            description,
            categoryId: run.category_id || aiDetectedCategoryId || undefined,
            policyOverrides,
            aspects,
            amazonPrice: product.price,
          })

          // Promoted Listings: best-effort — eBay eligibility (sales history, category, etc.)
          // can reject this even when the call itself succeeds, so failures here never fail the item.
          if (run.promoted && ebayListingId) {
            try {
              await supabase.functions.invoke('ebay-promote-listing', {
                body: { storeId: run.store_id, listingId: ebayListingId, adRate: Number(run.ad_rate) || 3 },
              })
            } catch {
              // Non-fatal — the listing itself published successfully.
            }
          }
        }

        await supabase.from('bulk_run_items').update({
          status: 'success',
          title,
          image,
          amazon_price: product.price,
          ebay_price: price,
        }).eq('id', item.id)

        succeeded++
        processedStatus = 'success'
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        await supabase.from('bulk_run_items').update({
          status: 'failed',
          error: errorMsg,
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
          ? { ...r, succeeded, failed, items: r.items.map(i => i.id === item.id ? { ...i, status: processedStatus, title: processedTitle, image: processedImage } : i) }
          : r
      ))
    }

    const finalStatus = failed === items.length && items.length > 0 ? 'failed' : 'completed'
    const completedAt = new Date().toISOString()
    await supabase.from('bulk_runs').update({
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

  const endListing = useCallback(async (storeId: string, listingId: string, sku?: string) => {
    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/end-listing`
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ storeId, listingId, sku, route: 'end-listing' }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to end listing on eBay')
    setListings(prev => prev.filter(l => l.id !== listingId))
    await refresh()
  }, [refresh])

  const removeListingLocal = useCallback(async (listingId: string) => {
    const { error } = await supabase.from('listings').delete().eq('id', listingId)
    if (error) throw new Error(error.message)
    setListings(prev => prev.filter(l => l.id !== listingId))
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
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

  const updateListing = useCallback(async (storeId: string, payload: UpdateListingPayload) => {
    const syncUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ebay-sync/update-listing`
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ storeId, ...payload, route: 'update-listing' }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update listing on eBay')
    await refresh()
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
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
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

  return { stores, listings, orders, conversations, revisions, loading, connected, oauthProcessing, oauthError, refresh, syncStore, disconnectStore, updateListing, endListing, removeListingLocal, publishListing, fetchAmazonProduct, bulkRuns, createBulkRun, processBulkRun, deleteBulkRun, linkExistingListings, syncAllEbayListings, updateOrderNotes }
}
