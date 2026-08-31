import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import {
  ArrowLeft, Save, MapPin, Package, DollarSign,
  Truck, ExternalLink, MessageSquare, StickyNote, Loader2,
} from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { OrderStatusBadge } from '../components/Badges'
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils'

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { orders, listings, loading } = useStoreData()
  const order = orders.find(o => o.id === id)
  const [tracking, setTracking] = useState(order?.trackingNumber || '')
  const [carrier, setCarrier] = useState(order?.trackingCarrier || 'USPS')
  const [notes, setNotes] = useState(order?.notes || '')

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  if (!order) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20">
        <p className="text-sm text-slate-500">Order not found.</p>
        <button onClick={() => navigate('/orders')} className="btn-secondary mt-4">Back to Orders</button>
      </div>
    )
  }

  const listing = listings.find(l => l.asin === order.asin)
  const fees = order.ebayPrice * 0.13
  const profit = order.ebayPrice - order.amazonCost - fees

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back</button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{order.orderId}</h2>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-sm text-slate-500">Ordered {formatDateTime(order.orderDate)}</p>
        </div>
        <Link to={`/messages/${order.id}`} className="btn-secondary">
          <MessageSquare className="w-4 h-4" /> Message Buyer
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Listing & source */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Listing & Source</h3>
            </div>
            <div className="card-body">
              <div className="flex gap-4">
                <img src={order.listingImage} alt="" className="w-20 h-20 rounded-lg object-cover border border-slate-200" />
                <div className="flex-1">
                  <Link to={listing ? `/listings/${listing.id}` : '#'} className="font-medium text-slate-900 hover:text-brand-600">{order.listingTitle}</Link>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    {listing && <span>eBay ID: {listing.ebayId}</span>}
                    <span>·</span>
                    <span>ASIN: <span className="font-mono">{order.asin}</span></span>
                    <a href="#" className="text-brand-600 hover:text-brand-700 flex items-center gap-1">
                      View on Amazon <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing breakdown */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Pricing Breakdown</h3>
            </div>
            <div className="card-body space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">eBay Sale Price</span>
                <span className="font-medium text-slate-900">{formatCurrency(order.ebayPrice)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Amazon Source Cost</span>
                <span className="font-medium text-slate-900">-{formatCurrency(order.amazonCost)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">eBay Fees (est. 13%)</span>
                <span className="font-medium text-slate-900">-{formatCurrency(fees)}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between">
                <span className="font-semibold text-slate-900">Estimated Profit</span>
                <span className="font-bold text-success-600">{formatCurrency(profit)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Notes</h3>
            </div>
            <div className="card-body">
              <textarea
                className="input min-h-[80px] resize-y"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add internal notes about this order…"
              />
            </div>
          </div>

          {/* Tracking */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <Truck className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Tracking</h3>
            </div>
            <div className="card-body space-y-4">
              {order.trackingNumber ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="badge-success">Shipped</span>
                    <span className="text-sm text-slate-500">via {order.trackingCarrier}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-500">Tracking Number</p>
                    <p className="font-mono text-sm text-slate-900 mt-1">{order.trackingNumber}</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">Ship the item yourself, then add the tracking number here.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Carrier</label>
                      <select value={carrier} onChange={e => setCarrier(e.target.value)} className="input">
                        <option>USPS</option>
                        <option>UPS</option>
                        <option>FedEx</option>
                        <option>Amazon Logistics</option>
                        <option>DHL</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Tracking Number</label>
                      <input className="input" value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Enter tracking number…" />
                    </div>
                  </div>
                  <button className="btn-primary"><Save className="w-4 h-4" /> Add Tracking</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right column — Shipping address */}
        <div className="space-y-6">
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">Shipping Address</h3>
            </div>
            <div className="card-body space-y-1 text-sm">
              <p className="font-medium text-slate-900">{order.shipToName}</p>
              <p className="text-slate-600">{order.shipToStreet}</p>
              <p className="text-slate-600">{order.shipToCity}, {order.shipToState} {order.shipToZip}</p>
              <p className="text-slate-600">{order.shipToCountry}</p>
              <div className="pt-3 mt-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">Buyer</p>
                <p className="text-sm text-slate-700">{order.buyerName}</p>
                <p className="text-xs text-slate-400">{order.buyerUsername}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-slate-900">Order Info</h3></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Order Date</span>
                <span className="text-slate-900">{formatDate(order.orderDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Order ID</span>
                <span className="font-mono text-xs text-slate-900">{order.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sale Price</span>
                <span className="font-medium text-slate-900">{formatCurrency(order.ebayPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Est. Profit</span>
                <span className="font-medium text-success-600">{formatCurrency(order.profit)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
