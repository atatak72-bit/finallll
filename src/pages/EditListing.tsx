import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import {
  ArrowLeft, Save, Trash2, Image as ImageIcon,
  Plus, X, ExternalLink, Sparkles, Loader2, AlertCircle,
} from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { EmptyState } from '../components/UI'
import { formatCurrency, cn } from '../lib/utils'

export default function EditListing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { stores, listings: liveListings, updateListing, endListing } = useStoreData()
  const listing = liveListings.find(l => l.id === id)
  const [specs, setSpecs] = useState([
    { name: 'Brand', value: '' },
    { name: 'MPN', value: '' },
    { name: 'UPC', value: '' },
    { name: 'Color', value: '' },
  ])
  const [title, setTitle] = useState(listing?.title || '')
  const [price, setPrice] = useState(listing ? String(listing.ebayPrice) : '')
  const [quantity, setQuantity] = useState(listing ? String(listing.quantity) : '')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const activeStore = stores.find(s => s.active) || stores[0]

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

  const handleEndListing = async () => {
    if (!listing) return
    if (!window.confirm('End this listing? It will be removed from eBay and your store.')) return
    setEnding(true); setError(null)
    try {
      await endListing(activeStore?.id || '', listing.id, listing.asin || listing.ebayId)
      navigate('/listings')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end listing')
    } finally {
      setEnding(false)
    }
  }

  const handleSave = async () => {
    if (!activeStore) { setError('No connected store found.'); return }
    setSaving(true); setError(null); setSuccess(false)
    try {
      await updateListing(activeStore.id, {
        sku: listing.asin || listing.ebayId,
        title,
        price: parseFloat(price),
        quantity: parseInt(quantity, 10),
        description: description || undefined,
      })
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
              <a href="#" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                View on eBay <ExternalLink className="w-3 h-3" />
              </a>
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
            <button className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Generate AI Title
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
              <input className="input pl-7" defaultValue={listing.amazonPrice} disabled />
            </div>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div className="md:col-span-3 p-3 bg-slate-50 rounded-lg text-sm">
            <span className="text-slate-500">Estimated profit per sale: </span>
            <span className="font-semibold text-success-600">{formatCurrency(listing.ebayPrice - listing.amazonPrice - listing.ebayPrice * 0.13)}</span>
            <span className="text-slate-400"> (after 13% eBay fees)</span>
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
            placeholder="Enter listing description..."
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
            {[listing.image, listing.image, listing.image].map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} alt="" className="w-full aspect-square rounded-lg object-cover border border-slate-200" />
                <button className="absolute top-1 right-1 p-1 bg-white/80 rounded-lg opacity-0 group-hover:opacity-100 transition text-error-500 hover:bg-error-50">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button className="aspect-square rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 transition">
              <Plus className="w-6 h-6" />
              <span className="text-xs mt-1">Add Image</span>
            </button>
          </div>
        </div>
      </div>

      {/* Item specifics */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Item specifics</h3>
          <p className="text-xs text-slate-500 mt-0.5">Includes Brand/MPN/UPC/EAN if eBay has them for this listing — they're just specifics with those names, not a separate thing.</p>
        </div>
        <div className="card-body space-y-3">
          {specs.map((spec, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <input className="input" defaultValue={spec.name} placeholder="Name" />
              <div className="flex gap-2">
                <input className="input" defaultValue={spec.value} placeholder="Value" />
                <button onClick={() => setSpecs(specs.filter((_, idx) => idx !== i))} className="btn-ghost text-error-600 hover:bg-error-50">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          <button onClick={() => setSpecs([...specs, { name: '', value: '' }])} className="btn-secondary text-sm">
            <Plus className="w-4 h-4" /> Add Specific
          </button>
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
