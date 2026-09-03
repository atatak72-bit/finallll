import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import {
  Search, PackagePlus, Upload, Save, Link2,
  AlertCircle, CheckCircle2, Sparkles, Layers, FileText, Loader2,
  ShieldAlert, ListChecks, Plus, Trash2, Wand2, X
} from 'lucide-react'
import { cn, formatCurrency, calculateEbayPrice, renderListingTemplate, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE, type PricingTierInput } from '../lib/utils'
import { useStoreData } from '../lib/DataContext'
import { supabase } from '../lib/supabase'
import type { AmazonProduct } from '../lib/useData'

type Tab = 'single' | 'bulk' | 'bulk-status' | 'drafts' | 'import'

interface ItemSpecific {
  key: string
  value: string
}

const HARDCODED_BLOCKS = ['amazon', 'amazon basics', 'amazonbasics', 'prime', 'fulfilled by amazon']

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

function stripHtml(html: string) {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.body.textContent || ''
  } catch {
    return html.replace(/<\/?[^>]+(>|$)/g, '')
  }
}

function buildDetailedDescription(product: any) {
  const descCandidates: string[] = []
  const htmlFields = ['description', 'product_description', 'long_description', 'editorial_review']
  for (const f of htmlFields) {
    if (product?.[f] && typeof product[f] === 'string' && product[f].trim().length > 30) {
      descCandidates.push(stripHtml(product[f]).trim())
    }
  }
  if (Array.isArray(product?.about_this_item) && product.about_this_item.length) {
    descCandidates.push(product.about_this_item.map((b: any) => stripHtml(String(b))).join('\n'))
  }
  const bullets = product?.bullet_points ?? product?.feature_bullets ?? product?.features
  if (Array.isArray(bullets) && bullets.length) {
    const cleaned = bullets.map((b: any) => typeof b === 'string' ? stripHtml(b).trim() : '').filter(Boolean)
    if (cleaned.length) descCandidates.push('Key Features:\n• ' + cleaned.join('\n• '))
  }
  const textFields = ['product_overview', 'product_information', 'details']
  for (const f of textFields) {
    if (product?.[f] && (typeof product[f] === 'string' || Array.isArray(product[f]))) {
      if (Array.isArray(product[f])) {
        descCandidates.push(product[f].map((x: any) => stripHtml(String(x))).join('\n'))
      } else {
        descCandidates.push(stripHtml(product[f]))
      }
    }
  }
  if (product?.specifications) {
    const specsLines: string[] = []
    if (Array.isArray(product.specifications)) {
      product.specifications.forEach((s: any) => {
        if (s && (s.key || s.name) && (s.value || s.val)) specsLines.push(`${s.key ?? s.name}: ${s.value ?? s.val}`)
        else if (typeof s === 'string') specsLines.push(stripHtml(s))
      })
    } else if (typeof product.specifications === 'object') {
      Object.entries(product.specifications).forEach(([k, v]) => specsLines.push(`${k}: ${v}`))
    }
    if (specsLines.length) descCandidates.push('Specifications:\n' + specsLines.join('\n'))
  }
  const joined = Array.from(new Set(descCandidates)).join('\n\n').trim()
  if (joined.length > 30) return joined
  const fallbackParts: string[] = []
  if (product?.title) fallbackParts.push(product.title)
  if (Array.isArray(bullets) && bullets.length) fallbackParts.push('Key Features:\n• ' + bullets.join('\n• '))
  if (product?.brand) fallbackParts.push(`Brand: ${product.brand}`)
  return fallbackParts.join('\n\n').trim()
}

const KNOWN_KEYS_MAP: Record<string, string> = {
  brand: 'Brand',
  manufacturer: 'Brand',
  mpn: 'MPN',
  model: 'Model',
  color: 'Color',
  size: 'Size',
  material: 'Material',
  dimensions: 'Dimensions',
  weight: 'Weight',
  asin: 'ASIN',
  ean: 'EAN',
  upc: 'UPC'
}

function normalizeKey(k: string) {
  const key = k.toLowerCase().replace(/[_\s]+/g, ' ').trim()
  return KNOWN_KEYS_MAP[key] ?? k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function extractItemSpecifics(product: any): { key: string; value: string }[] {
  const seen = new Map<string, string>()
  function add(k: string, v: any) {
    if (!k || v == null) return
    const nk = normalizeKey(k)
    const nv = String(v).trim()
    if (!nv) return
    const keyLower = nk.toLowerCase()
    if (!seen.has(keyLower)) {
      seen.set(keyLower, nv)
    } else {
      const prev = seen.get(keyLower)!
      if (prev.length < nv.length) seen.set(keyLower, nv)
    }
  }
  // Brand is deliberately never populated with the real brand name here — set to a safe
  // placeholder instead, consistently with the AI-generated specifics (see ai-generate-content).
  seen.set('brand', 'Does not apply')
  add('MPN', product?.mpn ?? product?.manufacturerPartNumber)
  add('Model', product?.model)
  const sources = [product?.specifications, product?.attributes, product?.product_information, product?.details, product?.product_overview]
  for (const src of sources) {
    if (!src) continue
    if (Array.isArray(src)) {
      src.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const k = item.key ?? item.name ?? item.label
          const v = item.value ?? item.val ?? item.content
          add(k, v)
        } else if (typeof item === 'string') {
          const [k, ...rest] = item.split(':')
          if (rest.length) add(k, rest.join(':').trim())
        }
      })
    } else if (typeof src === 'object') {
      Object.entries(src).forEach(([k, v]) => {
        if (typeof v === 'string' || typeof v === 'number') add(k, v)
        else if (Array.isArray(v)) add(k, v.join(', '))
      })
    } else if (typeof src === 'string') {
      src.split('\n').forEach(line => {
        const [k, ...rest] = line.split(':')
        if (rest.length) add(k, rest.join(':').trim())
      })
    }
  }
  const bullets = product?.bullet_points ?? product?.feature_bullets ?? product?.features
  if (Array.isArray(bullets)) {
    bullets.forEach((b: any) => {
      if (typeof b !== 'string') return
      const [k, ...rest] = b.split(':')
      if (!rest.length) return
      add(k, rest.join(':').trim())
    })
  }
  const result: { key: string; value: string }[] = []
  for (const [k, v] of seen.entries()) {
    result.push({ key: k.replace(/\b\w/g, c => c.toUpperCase()), value: v })
  }
  return result
}

function detectCategorySuggestion(product: any) {
  if (product?.category && typeof product.category === 'string' && product.category.length > 2) {
    return product.category
  }
  if (Array.isArray(product?.browse_nodes) && product.browse_nodes.length) {
    const labels = product.browse_nodes.map((n: any) => n?.name || n?.label).filter(Boolean)
    if (labels.length) return labels.join(' > ')
  }
  const title = (product?.title ?? '').toLowerCase()
  if (title.includes('wire') || title.includes('cable')) return 'Electronics > Accessories > Cables & Interconnects'
  if (title.includes('shirt') || title.includes('t-shirt')) return 'Clothing, Shoes & Accessories > Men'
  return ''
}

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
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
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field); field = ''
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && clean[i + 1] === '\n') i++
        row.push(field); field = ''
        rows.push(row); row = []
      } else {
        field += c
      }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

interface CsvMatchRow {
  ebayId: string
  ebayTitle: string
  status: 'pending' | 'searching' | 'found' | 'not_found' | 'error'
  matchAsin: string
  matchTitle: string
  matchImage: string
  include: boolean
}

export default function ListItems() {
  const { stores, fetchAmazonProduct, publishListing, bulkRuns, createBulkRun, processBulkRun, deleteBulkRun, linkExistingListings } = useStoreData()
  const [tab, setTab] = useState<Tab>('single')
  const [asin, setAsin] = useState('')
  const [product, setProduct] = useState<AmazonProduct | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null)
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [aiTitleError, setAiTitleError] = useState<string | null>(null)
  const [currentListingTemplate, setCurrentListingTemplate] = useState('')
  const [promoted, setPromoted] = useState(true)

  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewDescription, setReviewDescription] = useState('')
  const [reviewPrice, setReviewPrice] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('')

  const [itemSpecifics, setItemSpecifics] = useState<ItemSpecific[]>([])

  const [pricingTiers, setPricingTiers] = useState<PricingTierInput[]>([])
  const [ebayFeePct, setEbayFeePct] = useState(13.25)
  const [ebayFixedFee, setEbayFixedFee] = useState(0.30)
  const [pricingEnabled, setPricingEnabled] = useState(true)
  const [veroBlockKeywords, setVeroBlockKeywords] = useState<string[]>([])

  const [bulkStoreId, setBulkStoreId] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkRunName, setBulkRunName] = useState('')
  const [bulkPromoted, setBulkPromoted] = useState(false)
  const [bulkAdRate, setBulkAdRate] = useState(3)
  const [bulkAiTitles, setBulkAiTitles] = useState(false)
  const [bulkAllowVero, setBulkAllowVero] = useState(false)
  const [bulkStarting, setBulkStarting] = useState<'live' | 'draft' | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [processingRunId, setProcessingRunId] = useState<string | null>(null)
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

  const [importText, setImportText] = useState('')
  const [importRunning, setImportRunning] = useState(false)
  const [importResult, setImportResult] = useState<{ linked: number; failed: Array<{ ebayId: string; asin: string; error: string }> } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [manualFileName, setManualFileName] = useState<string | null>(null)
  const [showManualUpload, setShowManualUpload] = useState(false)
  const manualFileInputRef = useRef<HTMLInputElement>(null)

  const [importMode, setImportMode] = useState<'manual' | 'csv'>('csv')
  const [csvRows, setCsvRows] = useState<CsvMatchRow[]>([])
  const [csvParseError, setCsvParseError] = useState<string | null>(null)
  const [csvSearching, setCsvSearching] = useState(false)
  const [csvSearchProgress, setCsvSearchProgress] = useState(0)
  const [csvLinking, setCsvLinking] = useState(false)
  const [csvLinkResult, setCsvLinkResult] = useState<{ linked: number; failed: Array<{ ebayId: string; asin: string; error: string }> } | null>(null)

  const [draftListings, setDraftListings] = useState<Array<{ id: string; title: string; image: string | null; ebay_price: number; asin: string | null; quantity: number }>>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null)

  const activeStore = stores.find(s => s.active) || stores[0]
  const [singleStoreId, setSingleStoreId] = useState('')
  const singleStore = stores.find(s => s.id === singleStoreId) || activeStore

  useEffect(() => {
    if (!singleStore?.id) return
    let cancelled = false

    async function loadSettings() {
      const [settingsRes, tiersRes, veroRes] = await Promise.all([
        supabase.from('pricing_settings').select('pricing_enabled, ebay_percentage_fee, ebay_fixed_fee').eq('store_id', singleStore!.id).maybeSingle(),
        supabase.from('pricing_rules').select('min_price, max_price, profit_pct, fixed_profit, sort_order').eq('store_id', singleStore!.id).order('sort_order', { ascending: true }),
        supabase.from('store_vero_settings').select('block_keywords').eq('store_id', singleStore!.id).maybeSingle(),
      ])
      if (cancelled) return

      if (settingsRes.error) {
        console.error('pricing_settings error', settingsRes.error)
      } else if (settingsRes.data) {
        setPricingEnabled(settingsRes.data.pricing_enabled ?? true)
        setEbayFeePct(Number(settingsRes.data.ebay_percentage_fee) || 13.25)
        setEbayFixedFee(Number(settingsRes.data.ebay_fixed_fee) || 0.30)
      }

      if (tiersRes.error) {
        console.error('pricing_rules error', tiersRes.error)
      } else if (tiersRes.data) {
        setPricingTiers(tiersRes.data.map(r => ({
          min: Number(r.min_price) || 0,
          max: Number(r.max_price) || 999999,
          profitPct: Number(r.profit_pct) || 20,
          fixProfit: Number(r.fixed_profit) || 0,
        })))
      }

      if (veroRes.error) {
        console.error('store_vero_settings error', veroRes.error)
      } else if (veroRes.data) {
        setVeroBlockKeywords((veroRes.data.block_keywords as string[]) || [])
      }
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [singleStore?.id])

  const veroPatterns = useMemo(() => {
    const all = [...HARDCODED_BLOCKS, ...(veroBlockKeywords || [])]
      .map(k => (k || '').trim())
      .filter(Boolean)
      .map(k => k.toLowerCase())

    const regexes = all.map(k => {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const safe = /^[a-z0-9\s]+$/.test(k)
      return { keyword: k, re: safe ? new RegExp(`\\b${esc}\\b`, 'i') : null }
    })
    return { regexes, substrings: all }
  }, [veroBlockKeywords])

  const checkVeroViolation = (text: string): string | null => {
    if (!text) return null
    const lower = text.toLowerCase()
    for (const { keyword, re } of veroPatterns.regexes) {
      if (re && re.test(text)) return keyword
    }
    for (const k of veroPatterns.substrings) {
      if (!k) continue
      if (lower.includes(k)) return k
    }
    return null
  }

  const specificsText = useMemo(() => itemSpecifics.map(s => `${s.key} ${s.value}`).join(' '), [itemSpecifics])
  const titleViolation = useMemo(() => checkVeroViolation(reviewTitle), [reviewTitle, veroPatterns])
  const descViolation = useMemo(() => checkVeroViolation(reviewDescription), [reviewDescription, veroPatterns])
  const specificsViolation = useMemo(() => checkVeroViolation(specificsText), [specificsText, veroPatterns])

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
    setProduct(null)
    try {
      const fetched: any = await fetchAmazonProduct(asin, singleStore?.id)

      const rawPrice = Number(fetched?.price ?? fetched?.amazon_price ?? fetched?.suggestedPrice ?? 0)
      const calcPrice = pricingEnabled && pricingTiers.length > 0
        ? (calculateEbayPrice(rawPrice, pricingTiers, ebayFeePct, ebayFixedFee, pricingEnabled)?.finalPrice ?? rawPrice)
        : Number(fetched?.suggestedPrice ?? rawPrice)

      setProduct(fetched)
      setReviewTitle(truncateTitleTo80(fetched?.title || ''))
      setReviewPrice(!Number.isNaN(calcPrice) ? Number(calcPrice).toFixed(2) : '0.00')

      const isOut = String(fetched?.stock ?? '').toLowerCase().includes('out')
      setQuantity(isOut ? 0 : (Number(fetched?.defaultQuantity) || 1))

      const { data: templateRow } = await supabase
        .from('listing_templates')
        .select('template')
        .eq('store_id', singleStore?.id || '')
        .maybeSingle()
      const listingTemplate = templateRow?.template || DEFAULT_LISTING_TEMPLATE
      setCurrentListingTemplate(listingTemplate)
      const storeName = singleStore?.ebayUsername || singleStore?.nickname || 'Our Store'
      const builtDesc = fitDescriptionToBudget(listingTemplate, {
        title: fetched?.title || '',
        store_name: storeName,
        main_image: fetched?.mainImage || fetched?.images?.[0] || '',
        product_description: fetched?.description || '',
        feature_bullets: fetched?.bulletPoints || [],
      })
      setReviewDescription(builtDesc)

      const specs = extractItemSpecifics(fetched)
      setItemSpecifics(specs)

      const suggested = detectCategorySuggestion(fetched)
      setSelectedCategory(suggested || String(fetched?.category ?? ''))

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
      if (result.categoryId) {
        setSelectedCategory(result.categoryId)
        setSelectedCategoryName(result.categoryName || result.categoryId)
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

  const handlePublish = async () => {
    if (!singleStore || !product || activeViolation) return
    setPublishing(true)
    setPublishError(null)

    try {
      const priceToUse = Number(reviewPrice) || Number(product.suggestedPrice) || Number(product.price) || 0
      const mainImage = (product.images && product.images[0]) || (product as any)?.mainImage || ''

      const aspects: Record<string, string[]> | undefined = itemSpecifics.length > 0
        ? itemSpecifics.reduce((acc, spec) => {
            if (spec.key.trim() && spec.value.trim()) acc[spec.key.trim()] = [spec.value.trim()]
            return acc
          }, {} as Record<string, string[]>)
        : undefined

      const listingId = await publishListing(singleStore.id, {
        sku: product.asin,
        title: reviewTitle || truncateTitleTo80(product.title || ''),
        price: priceToUse,
        quantity: Number(quantity) || 0,
        image: mainImage,
        images: (product.images && product.images.length > 0) ? product.images : (mainImage ? [mainImage] : []),
        description: reviewDescription,
        categoryId: selectedCategory || undefined,
        aspects: aspects && Object.keys(aspects).length > 0 ? aspects : undefined,
      })

      setPublishSuccess(`Listed on eBay at ${formatCurrency(priceToUse)}`)

      setTimeout(() => {
        setPublishSuccess(null)
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

  const parsedBulkItems = useMemo(() => {
    return bulkText
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
  }, [bulkText])

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
      setProcessingRunId(run.id)
      await processBulkRun(run.id)
      setTab('bulk-status')
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to start bulk run')
    } finally {
      setProcessingRunId(null)
      setBulkStarting(null)
    }
  }

  const handleResumeBulkRun = async (runId: string) => {
    setProcessingRunId(runId)
    setBulkError(null)
    try {
      await processBulkRun(runId)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to process bulk run')
    } finally {
      setProcessingRunId(null)
    }
  }

  const filteredRuns = useMemo(() => {
    if (statusFilter === 'all') return bulkRuns
    if (statusFilter === 'running') return bulkRuns.filter(r => r.status === 'running' || r.status === 'paused')
    return bulkRuns.filter(r => r.status === statusFilter)
  }, [bulkRuns, statusFilter])
  const pagedRuns = filteredRuns.slice((statusPage - 1) * STATUS_PAGE_SIZE, statusPage * STATUS_PAGE_SIZE)
  const totalStatusPages = Math.max(1, Math.ceil(filteredRuns.length / STATUS_PAGE_SIZE))

  const loadDrafts = async () => {
    if (!activeStore?.id) return
    setDraftsLoading(true)
    try {
      const { data } = await supabase
        .from('listings')
        .select('id, title, image, ebay_price, asin, quantity')
        .eq('store_id', activeStore.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
      setDraftListings((data || []) as typeof draftListings)
    } finally {
      setDraftsLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'drafts') void loadDrafts()
  }, [tab, activeStore?.id])

  const handlePublishDraft = async (draft: typeof draftListings[number]) => {
    if (!activeStore || !draft.asin) return
    setPublishingDraftId(draft.id)
    try {
      const product = await fetchAmazonProduct(draft.asin, activeStore.id)
      await publishListing(activeStore.id, {
        sku: draft.asin,
        title: draft.title,
        price: draft.ebay_price,
        quantity: draft.quantity,
        image: draft.image || product.mainImage || '',
        description: product.description,
      })
      await supabase.from('listings').delete().eq('id', draft.id)
      setDraftListings(prev => prev.filter(d => d.id !== draft.id))
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to publish draft')
    } finally {
      setPublishingDraftId(null)
    }
  }

  const handleDeleteDraft = async (draftId: string) => {
    await supabase.from('listings').delete().eq('id', draftId)
    setDraftListings(prev => prev.filter(d => d.id !== draftId))
  }

  const parsedImportPairs = useMemo(() => {
    return importText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [ebayId, asin] = line.split(',').map(s => s.trim())
        return { ebayId, asin }
      })
      .filter(p => p.ebayId && p.asin)
  }, [importText])

  const handleImportSubmit = async () => {
    if (!activeStore || parsedImportPairs.length === 0) return
    setImportRunning(true)
    setImportError(null)
    setImportResult(null)
    try {
      const result = await linkExistingListings(activeStore.id, parsedImportPairs)
      setImportResult(result)
      if (result.failed.length === 0) setImportText('')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImportRunning(false)
    }
  }

  const handleImportFile = (file: File) => {
    setManualFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setImportText(String(reader.result || ''))
    reader.readAsText(file)
  }

  const handleCsvFile = (file: File) => {
    setCsvParseError(null)
    setCsvLinkResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const rows = parseCsv(text)
        if (rows.length < 2) {
          setCsvParseError('The file appears to be empty or has no data rows.')
          return
        }
        const header = rows[0].map(h => h.trim().toLowerCase())
        const idIdx = header.findIndex(h => h === 'item number' || h === 'item id' || h === 'custom label (sku)')
        const titleIdx = header.findIndex(h => h === 'title')
        if (idIdx === -1 || titleIdx === -1) {
          setCsvParseError('Could not find "Item number" and "Title" columns in this CSV. Make sure it\'s an unmodified eBay "All active listings" export.')
          return
        }
        const dataRows = rows.slice(1)
          .map(r => ({ ebayId: (r[idIdx] || '').trim(), ebayTitle: (r[titleIdx] || '').trim() }))
          .filter(r => r.ebayId && r.ebayTitle)
        const mapped: CsvMatchRow[] = dataRows.map(r => ({
          ebayId: r.ebayId,
          ebayTitle: r.ebayTitle,
          status: 'pending',
          matchAsin: '',
          matchTitle: '',
          matchImage: '',
          include: true,
        }))
        setCsvRows(mapped)
      } catch {
        setCsvParseError('Failed to read this file. Make sure it\'s a valid CSV.')
      }
    }
    reader.readAsText(file)
  }

  const handleFindAsins = async () => {
    if (csvRows.length === 0) return
    setCsvSearching(true)
    setCsvSearchProgress(0)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    for (let i = 0; i < csvRows.length; i++) {
      setCsvRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'searching' } : r))
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/amazon-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
          body: JSON.stringify({ title: csvRows[i].ebayTitle }),
        })
        const data = await res.json().catch(() => ({})) as { success?: boolean; matches?: Array<{ asin: string; title: string; image: string }> }
        const top = data.matches?.[0]
        setCsvRows(prev => prev.map((r, idx) => idx === i ? {
          ...r,
          status: top ? 'found' : 'not_found',
          matchAsin: top?.asin || '',
          matchTitle: top?.title || '',
          matchImage: top?.image || '',
        } : r))
      } catch {
        setCsvRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error' } : r))
      }
      setCsvSearchProgress(i + 1)
    }
    setCsvSearching(false)
  }

  const handleCsvRowAsinChange = (index: number, value: string) => {
    setCsvRows(prev => prev.map((r, idx) => idx === index ? { ...r, matchAsin: value.toUpperCase() } : r))
  }

  const handleCsvRowToggle = (index: number) => {
    setCsvRows(prev => prev.map((r, idx) => idx === index ? { ...r, include: !r.include } : r))
  }

  const csvLinkablePairs = useMemo(
    () => csvRows.filter(r => r.include && /^[A-Z0-9]{10}$/.test(r.matchAsin)).map(r => ({ ebayId: r.ebayId, asin: r.matchAsin })),
    [csvRows],
  )

  const handleCsvLinkSubmit = async () => {
    if (!activeStore || csvLinkablePairs.length === 0) return
    setCsvLinking(true)
    setCsvLinkResult(null)
    try {
      const result = await linkExistingListings(activeStore.id, csvLinkablePairs)
      setCsvLinkResult(result)
      if (result.failed.length === 0) {
        const linkedIds = new Set(csvLinkablePairs.map(p => p.ebayId))
        setCsvRows(prev => prev.filter(r => !linkedIds.has(r.ebayId)))
      }
    } catch (err) {
      setCsvLinkResult({ linked: 0, failed: [{ ebayId: '', asin: '', error: err instanceof Error ? err.message : 'Import failed' }] })
    } finally {
      setCsvLinking(false)
    }
  }

  const handleClearCsv = () => {
    setCsvRows([])
    setCsvParseError(null)
    setCsvLinkResult(null)
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'single', label: 'Single', icon: PackagePlus },
    { id: 'bulk', label: 'Bulk', icon: Layers },
    { id: 'bulk-status', label: 'Bulk Status', icon: Upload },
    { id: 'drafts', label: 'Drafts', icon: FileText },
    { id: 'import', label: 'Import', icon: Link2 },
  ]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
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
                        <option value="">{product.category || 'Choose an eBay category'}</option>
                        {selectedCategory && <option value={selectedCategory}>{selectedCategoryName || selectedCategory}</option>}
                      </select>
                      <button onClick={() => setSelectedCategory(detectCategorySuggestion(product))} className="btn-secondary text-xs">Suggest</button>
                    </div>
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
                    onClick={handlePublish}
                    disabled={publishing || !!activeViolation}
                    className="btn-primary disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                  >
                    {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {publishing ? 'Publishing...' : 'List It'}
                  </button>
                  <button className="btn-secondary"><Save className="w-4 h-4" /> Save as Draft</button>
                </div>

                {publishError && <div className="text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{publishError}</div>}
                {publishSuccess && <div className="flex items-center gap-2 text-sm text-success-600 bg-success-50 rounded-lg px-4 py-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{publishSuccess}</div>}
              </div>
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
                <p className="mt-1 text-xs text-slate-400">{parsedBulkItems.length} valid ASIN{parsedBulkItems.length === 1 ? '' : 's'} detected</p>
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
            </div>
          </div>
        </div>
      )}

      {tab === 'bulk-status' && (
        <div className="card">
          <div className="card-header flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Bulk listings</h3>
              <p className="text-xs text-slate-500 mt-0.5">Every bulk run, with live progress and per-item failure reasons.</p>
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
                        <Fragment key={run.id}>
                          <tr className="hover:bg-slate-50">
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
                            <td className="py-2.5 pr-4 pl-2 text-right whitespace-nowrap">
                              {run.status !== 'completed' && (
                                <button
                                  onClick={() => void handleResumeBulkRun(run.id)}
                                  disabled={processingRunId === run.id}
                                  className="text-xs font-medium text-brand-600 hover:text-brand-700 mr-3"
                                >
                                  {processingRunId === run.id ? 'Processing…' : 'Resume'}
                                </button>
                              )}
                              <button onClick={() => void deleteBulkRun(run.id)} className="text-slate-400 hover:text-red-500" title="Delete run">
                                <Trash2 className="w-4 h-4 inline" />
                              </button>
                            </td>
                          </tr>
                          {run.items.some(i => i.status === 'failed') && (
                            <tr>
                              <td colSpan={9} className="px-4 pb-3">
                                <div className="text-xs bg-red-50 rounded-lg p-2 space-y-1">
                                  {run.items.filter(i => i.status === 'failed').slice(0, 5).map(i => (
                                    <p key={i.id} className="text-red-600 truncate"><span className="font-mono">{i.asin}</span> — {i.error}</p>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
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
            <p className="text-xs text-slate-500 mt-0.5">Saved but not yet live on eBay. Publish when you're ready.</p>
          </div>
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
                      disabled={publishingDraftId === d.id}
                      className="btn-primary text-xs shrink-0"
                    >
                      {publishingDraftId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      Publish
                    </button>
                    <button onClick={() => void handleDeleteDraft(d.id)} className="p-1.5 text-slate-400 hover:text-red-500 shrink-0" title="Delete draft">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-6">
          <div className="flex gap-2">
            <button
              onClick={() => setImportMode('csv')}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', importMode === 'csv' ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-600 hover:bg-slate-100 border border-transparent')}
            >
              <Wand2 className="w-4 h-4" /> Auto-detect from CSV
            </button>
            <button
              onClick={() => setImportMode('manual')}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', importMode === 'manual' ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'text-slate-600 hover:bg-slate-100 border border-transparent')}
            >
              <Link2 className="w-4 h-4" /> Manual pairs
            </button>
          </div>

          {importMode === 'csv' && (
            <div className="card">
              <div className="card-header">
                <h3 className="font-semibold text-slate-900">Import from another tool's eBay export (auto-detect ASIN)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Upload an eBay "All active listings" CSV (Seller Hub → Reports → Downloads). For each row, we search Amazon by the listing title and suggest the closest matching ASIN.
                  Review and edit every match before confirming — automatic matching can be wrong, and a bad match will sync the wrong product's price/stock.
                </p>
              </div>
              <div className="card-body space-y-4">
                {csvRows.length === 0 ? (
                  <div>
                    <label className="flex items-center justify-center gap-2 text-sm text-slate-600 border-2 border-dashed border-slate-300 rounded-lg py-8 cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition">
                      <input type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f) }} />
                      <Upload className="w-5 h-5" /> Click to upload eBay listings CSV
                    </label>
                    {csvParseError && <div className="mt-3 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{csvParseError}</div>}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <p className="text-sm text-slate-600">{csvRows.length} listing{csvRows.length === 1 ? '' : 's'} loaded from CSV</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleFindAsins()}
                          disabled={csvSearching}
                          className="btn-primary text-sm disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                        >
                          {csvSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                          {csvSearching ? `Searching ${csvSearchProgress}/${csvRows.length}…` : 'Find ASINs'}
                        </button>
                        <button onClick={handleClearCsv} className="btn-ghost text-sm text-slate-500">
                          <X className="w-4 h-4" /> Clear
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                            <th className="px-3 py-2 w-10"></th>
                            <th className="px-3 py-2 font-medium">eBay Item</th>
                            <th className="px-3 py-2 font-medium">Suggested match</th>
                            <th className="px-3 py-2 font-medium">ASIN</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.map((row, idx) => (
                            <tr key={row.ebayId + idx} className="border-b border-slate-100">
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={row.include} onChange={() => handleCsvRowToggle(idx)} className="w-4 h-4 text-brand-600 rounded border-slate-300" />
                              </td>
                              <td className="px-3 py-2 max-w-xs">
                                <p className="text-slate-800 truncate">{row.ebayTitle}</p>
                                <p className="text-xs text-slate-400 font-mono">{row.ebayId}</p>
                              </td>
                              <td className="px-3 py-2 max-w-xs">
                                {row.matchTitle ? (
                                  <div className="flex items-center gap-2">
                                    {row.matchImage && <img src={row.matchImage} alt="" className="w-8 h-8 object-cover rounded border border-slate-200 shrink-0" />}
                                    <span className="text-xs text-slate-600 truncate">{row.matchTitle}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="input text-xs font-mono py-1 w-32"
                                  value={row.matchAsin}
                                  onChange={e => handleCsvRowAsinChange(idx, e.target.value)}
                                  placeholder="B0..."
                                />
                              </td>
                              <td className="px-3 py-2">
                                {row.status === 'pending' && <span className="text-xs text-slate-400">Not searched</span>}
                                {row.status === 'searching' && <span className="text-xs text-brand-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</span>}
                                {row.status === 'found' && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Found</span>}
                                {row.status === 'not_found' && <span className="text-xs text-amber-600">No match</span>}
                                {row.status === 'error' && <span className="text-xs text-red-500">Error</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <p className="text-xs text-slate-400">{csvLinkablePairs.length} row{csvLinkablePairs.length === 1 ? '' : 's'} ready to link (checked, with a valid 10-character ASIN)</p>
                      <button
                        onClick={() => void handleCsvLinkSubmit()}
                        disabled={csvLinking || csvLinkablePairs.length === 0 || !activeStore}
                        className="btn-primary text-sm disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                      >
                        {csvLinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                        {csvLinking ? 'Linking...' : `Link ${csvLinkablePairs.length} listing${csvLinkablePairs.length === 1 ? '' : 's'}`}
                      </button>
                    </div>

                    {csvLinkResult && (
                      <div className="text-sm bg-slate-50 rounded-lg px-4 py-3 space-y-2">
                        <p className="text-emerald-700 font-medium">{csvLinkResult.linked} linked successfully</p>
                        {csvLinkResult.failed.length > 0 && (
                          <div className="text-red-600 text-xs space-y-1">
                            {csvLinkResult.failed.map((f, idx) => (
                              <p key={idx}><span className="font-mono">{f.ebayId} / {f.asin}</span> — {f.error}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {importMode === 'manual' && (
            <div className="card">
              <div className="card-header">
                <h3 className="font-semibold text-slate-900">Link to Amazon (manual)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  For listings that already exist live on eBay (created in Seller Hub, another tool, or before you started using this app).
                  Pair each eBay listing ID with its Amazon ASIN so it becomes trackable here — stock checks, price sync, and drafts will start working for it.
                  This does not create anything new on eBay, it only links what's already there.
                </p>
              </div>
              <div className="card-body space-y-4">
                <div className="text-xs bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
                  Format: <span className="font-mono">ebay_item_id,asin</span> — one pair per line. Example: <span className="font-mono">222136387160,B00A850UVG</span>
                </div>

                <div>
                  <label className="label">Source market</label>
                  <select className="input max-w-xs" disabled value="amazon.com">
                    <option>amazon.com</option>
                  </select>
                </div>

                <div>
                  <input
                    ref={manualFileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f) }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowManualUpload(v => !v)}
                    className="flex items-center gap-2 text-sm text-slate-600 mb-2 cursor-pointer"
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      showManualUpload ? 'bg-brand-600 border-brand-600' : 'border-slate-300 bg-white',
                    )}>
                      {showManualUpload && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </span>
                    Upload CSV file
                  </button>

                  {showManualUpload && (
                    <button
                      type="button"
                      onClick={() => manualFileInputRef.current?.click()}
                      className="w-full flex items-center justify-center text-sm text-slate-500 border-2 border-dashed border-slate-300 rounded-lg py-3 mb-3 hover:border-brand-400 hover:bg-brand-50/30 transition"
                    >
                      {manualFileName ? manualFileName : 'Choose File'}
                    </button>
                  )}

                  <textarea
                    rows={8}
                    className="input font-mono text-sm"
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                    placeholder={'ebay_item_id,asin\n222136387160,B00A850UVG'}
                  />
                  <p className="mt-1 text-xs text-slate-400">{parsedImportPairs.length} valid pair{parsedImportPairs.length === 1 ? '' : 's'} detected</p>
                </div>

                <button
                  onClick={() => void handleImportSubmit()}
                  disabled={importRunning || parsedImportPairs.length === 0 || !activeStore}
                  className="btn-primary disabled:bg-slate-300 disabled:cursor-not-allowed disabled:border-slate-300"
                >
                  {importRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {importRunning ? 'Linking...' : `Submit (${parsedImportPairs.length})`}
                </button>

                {importError && <div className="text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{importError}</div>}
                {importResult && (
                  <div className="text-sm bg-slate-50 rounded-lg px-4 py-3 space-y-2">
                    <p className="text-emerald-700 font-medium">{importResult.linked} linked successfully</p>
                    {importResult.failed.length > 0 && (
                      <div className="text-red-600 text-xs space-y-1">
                        {importResult.failed.map((f, idx) => (
                          <p key={idx}><span className="font-mono">{f.ebayId} / {f.asin}</span> — {f.error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
