import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  ArrowLeft, Save, Trash2,
  Plus, ExternalLink, Sparkles, Loader2, AlertCircle,
} from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { EmptyState } from '../components/UI'
import { formatCurrency, numberOr, cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { listingSku, type UpdateListingPayload } from '../lib/useData'

const COMING_SOON = 'Yakında'

export default function EditListing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { stores, listings: liveListings, updateListing, endListing } = useStoreData()
  const listing = liveListings.find(l => l.id === id)
  const [title, setTitle] = useState(listing?.title || '')
  const [price, setPrice] = useState(listing ? String(listing.ebayPrice) : '')
  const [quantity, setQuantity] = useState(listing ? String(listing.quantity) : '')
  const [description, setDescription] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(listing ? listing.id : null)
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // This store's own eBay fee settings (Settings → Profit & fees); null until loaded.
  const [fees, setFees] = useState<{ pctFee: number; fixedFee: number } | null>(null)
  const [feeError, setFeeError] = useState<string | null>(null)

  const activeStore = stores.find(s => s.active) || stores[0]
  const listingStoreId = listing?.storeId || activeStore?.id || ''

  useEffect(() => {
    if (!listingStoreId) return
    let cancelled = false
    ;(async () => {
      const { data, error: feeErr } = await supabase
        .from('pricing_settings')
        .select('ebay_percentage_fee, ebay_fixed_fee')
        .eq('store_id', listingStoreId)
        .maybeSingle()
      if (cancelled) return
      if (feeErr) {
        setFeeError(feeErr.message)
        return
      }
      const row = (data || null) as { ebay_percentage_fee?: number | string | null; ebay_fixed_fee?: number | string | null } | null
      setFeeError(null)
      setFees({
        pctFee: numberOr(row?.ebay_percentage_fee, 13.25),
        fixedFee: numberOr(row?.ebay_fixed_fee, 0.30),
      })
    })()
    return () => { cancelled = true }
  }, [listingStoreId])

  // FIX: listings are loaded asynchronously. When this page is opened directly (or the data
  // arrives a moment after the page renders), the fields above were initialised while
  // `listing` was still undefined and stayed empty forever. Fill them in once, as soon as the
  // listing becomes available — and only once per listing, so it never overwrites what the
  // user is typing when the listings data refreshes in the background.
  useEffect(() => {
    if (listing && loadedId !== listing.id) {
      setTitle(listing.title || '')
      setPrice(String(listing.ebayPrice ?? ''))
      setQuantity(String(listing.quantity ?? ''))
      setLoadedId(listing.id)
    }
  }, [listing, loadedId])

  if (!listing) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back</button>
          <h2 className="text-lg font-semibold text-slate-900">Edit Listing</h2>
        </div>
        <div className="card">
          <EmptyState icon={AlertCircle} title="Listing not found" subtitle="This listing may have been ended or removed. Try going back to your listings." />
        </div>
      </div>
    )
  }

  const ebayUrl = listing.ebayId ? `https://www.ebay.com/itm/${listing.ebayId}` : ''

  const handleEndListing = async () => {
    if (!listing) return
    if (!window.confirm('End this listing? It will be removed from eBay and your store.')) return
    setEnding(true); setError(null)
    try {
      await endListing(listing.storeId || activeStore?.id || '', listing.id, listingSku(listing) || undefined)
      navigate('/listings')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end listing')
    } finally {
      setEnding(false)
    }
  }

  const handleSave = async () => {
    const storeId = listing.storeId || activeStore?.id
    if (!storeId) { setError('No connected store found.'); return }
    if (loadedId !== listing.id) { setError('Listing details are still loading — please wait a moment and try again.'); return }

    // FIX: only send what actually changed, and never send an empty/invalid value.
    // Previously every save pushed title, price and quantity — even when the form was
    // empty — which could overwrite the live eBay listing with blank or NaN values.
    const trimmedTitle = title.trim()
    const newPrice = parseFloat(price)
    const newQuantity = parseInt(quantity, 10)

    if (!trimmedTitle) { setError('Title cannot be empty.'); return }
    if (trimmedTitle.length > 80) { setError('eBay titles can be at most 80 characters.'); return }
    if (!Number.isFinite(newPrice) || newPrice <= 0) { setError('Enter a valid eBay price greater than 0.'); return }
    if (!Number.isInteger(newQuantity) || newQuantity < 0) { setError('Enter a valid quantity (0 or more).'); return }

    // The eBay inventory SKU (sku_hint, else ASIN). The eBay item ID is NOT a SKU, so there is
    // no fallback to it — sending it would update nothing or the wrong item.
    const sku = listingSku(listing)
    if (!sku) { setError('Bu ilanın SKU bilgisi yok (ASIN veya eBay SKU) — eBay güncellenemez. Önce ASIN ekleyin.'); return }

    const changes: UpdateListingPayload = { sku }
    let changed = false
    if (trimmedTitle !== (listing.title || '').trim()) { changes.title = trimmedTitle; changed = true }
    if (Math.abs(newPrice - Number(listing.ebayPrice)) > 0.001) { changes.price = newPrice; changes.oldPrice = listing.ebayPrice; changed = true }
    if (newQuantity !== Number(listing.quantity)) { changes.quantity = newQuantity; changes.oldQuantity = listing.quantity; changed = true }
    if (description.trim()) { changes.description = description; changed = true }

    if (!changed) {
      setError('Nothing changed — there is nothing to push to eBay.')
      return
    }

    setSaving(true); setError(null); setSuccess(false)
    try {
      await updateListing(storeId, changes, { listingId: listing.id })
      setSuccess(true)
      setTimeout(() => navigate(-1), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back</button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">Edit Listing</h2>
          <p className="text-sm text-slate-500">Changes here push straight to the live eBay listing.</p>
        </div>
        <button onClick={handleEndListing} disabled={ending} className="btn-danger">
          {ending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {ending ? 'Ending...' : 'End Listing'}
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
      {error && <div className="text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">{error}</div>}
      {success && <div className="text-sm text-success-600 bg-success-50 rounded-lg px-4 py-2">Changes pushed to eBay successfully.</div>}

      <div className="card">
        <div className="card-body flex gap-6">
          <img src={listing.image} alt="" className="w-32 h-32 rounded-lg object-cover border border-slate-200" />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="badge-neutral">eBay ID: {listing.ebayId}</span>
              <span className="badge-neutral">ASIN: {listing.asin}</span>
              {ebayUrl && (
                <a href={ebayUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                  View on eBay <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <h3 className="font-semibold text-slate-900">{listing.title}</h3>
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Title</h3></div>
        <div className="card-body">
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">Listing Title</label>
            <button
              type="button"
              disabled
              title={COMING_SOON}
              className="text-xs text-slate-400 font-medium flex items-center gap-1 cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" /> Generate AI Title ({COMING_SOON.toLowerCase()})
            </button>
          </div>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
          <p className="text-xs text-slate-400 mt-1">{title.length}/80 characters</p>
        </div>
      </div>

      {/* Price & Quantity */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Price & Quantity</h3></div>
        <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">eBay Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input className="input pl-7" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Amazon Source Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input className="input pl-7" value={String(listing.amazonPrice ?? '')} disabled readOnly />
            </div>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="md:col-span-3 p-3 bg-slate-50 rounded-lg text-sm">
            {(() => {
              if (feeError) return <span className="text-error-600">eBay ücret ayarları yüklenemedi: {feeError}</span>
              if (!fees) return <span className="text-slate-400">Loading fee settings…</span>
              if (!listing.amazonPrice || listing.amazonPrice <= 0) return <span className="text-slate-400">No Amazon price yet — profit can't be estimated.</span>
              const typedPrice = parseFloat(price)
              const salePrice = Number.isFinite(typedPrice) && typedPrice > 0 ? typedPrice : listing.ebayPrice
              const profit = salePrice - listing.amazonPrice - (salePrice * (fees.pctFee / 100) + fees.fixedFee)
              return (
                <>
                  <span className="text-slate-500">Estimated profit per sale: </span>
                  <span className={cn('font-semibold', profit >= 0 ? 'text-success-600' : 'text-error-600')}>{formatCurrency(profit)}</span>
                  <span className="text-slate-400"> (after {fees.pctFee}% + {formatCurrency(fees.fixedFee)} eBay fees)</span>
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Description</h3></div>
        <div className="card-body">
          <textarea
            className="input min-h-[150px] resize-y"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Leave empty to keep the current eBay description unchanged."
          />
        </div>
      </div>

      {/* Preview */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Preview</h3></div>
        <div className="card-body">
          <div className="border border-slate-200 rounded-lg p-4">
            <div className="flex gap-4">
              <img src={listing.image} alt="" className="w-24 h-24 rounded-lg object-cover border border-slate-200" />
              <div className="flex-1">
                <h4 className="font-semibold text-slate-900">{listing.title}</h4>
                <p className="text-lg font-bold text-slate-900 mt-1">{formatCurrency(listing.ebayPrice)}</p>
                <p className="text-sm text-slate-500 mt-1">Free shipping · Quantity: {listing.quantity}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Images */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Images</h3></div>
        <div className="card-body">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {listing.image && (
              <div className="relative group">
                <img src={listing.image} alt="" className="w-full aspect-square rounded-lg object-cover border border-slate-200" />
              </div>
            )}
            <button
              type="button"
              disabled
              title={COMING_SOON}
              className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 cursor-not-allowed"
            >
              <Plus className="w-6 h-6" />
              <span className="text-xs mt-1">Add Image ({COMING_SOON.toLowerCase()})</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pb-4">
        <button onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
