import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, TrendingUp, DollarSign, ShoppingBag, ArrowRight,
  Store, AlertCircle, CheckCircle2, Activity, RefreshCw, Loader2, HelpCircle, PackageX,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { StatCard } from '../components/UI'
import { ConnectStoreModal } from '../components/ConnectStoreModal'
import { useStoreData } from '../lib/DataContext'
import { formatCurrency, formatDate } from '../lib/utils'

export default function Dashboard() {
  const { stores, listings, orders, loading, connected, oauthProcessing, oauthError, refresh } = useStoreData()
  const [connectOpen, setConnectOpen] = useState(false)
  const [trendMetric, setTrendMetric] = useState<'profit' | 'revenue' | 'orders'>('profit')

  // Trend chart: last 7 days of profit/revenue/orders, grouped by day
  const trendData = useMemo(() => {
    const days: { key: string; label: string; profit: number; revenue: number; orders: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days.push({ key, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), profit: 0, revenue: 0, orders: 0 })
    }
    const byKey = Object.fromEntries(days.map(d => [d.key, d]))
    for (const o of orders) {
      const key = (o.orderDate || '').slice(0, 10)
      const bucket = byKey[key]
      if (bucket) {
        bucket.profit += o.profit
        bucket.revenue += o.ebayPrice
        bucket.orders += 1
      }
    }
    return days
  }, [orders])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    )
  }

  const activeListings = listings.filter(l => l.status === 'active').length
  const outOfStockListings = listings.filter(l => l.status === 'out_of_stock').length
  const unknownListings = listings.filter(l => l.status === 'unknown').length
  const draftListings = listings.filter(l => l.status === 'draft').length
  const totalListings = listings.length
  const totalUnitsSold = listings.reduce((sum, l) => sum + l.soldCount, 0)
  const totalOrders = orders.length
  const pendingOrders = orders.filter(o => o.status === 'pending').length
  const totalProfit = orders.reduce((sum, o) => sum + o.profit, 0)
  const connectedStores = stores.filter(s => s.connected).length

  const recentOrders = [...orders].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()).slice(0, 5)
  const soldListings = listings.reduce((sum, listing) => sum + listing.soldCount, 0)
  const fulfillmentRate = totalOrders > 0 ? Math.round((orders.filter(o => o.status === 'delivered' || o.status === 'shipped').length / totalOrders) * 100) : 0
  const promotedRate = listings.length > 0 ? Math.round((listings.filter(l => l.promoted).length / listings.length) * 100) : 0

  // Per-store breakdown for the currently active store (mirrors the account-wide stats above, scoped to one store)
  const activeStore = stores.find(s => s.active) || stores[0]
  const storeListings = listings.filter(l => l.storeId === activeStore?.id)
  const storeOrders = orders.filter(o => o.storeId === activeStore?.id)
  const storeActiveListings = storeListings.filter(l => l.status === 'active').length
  const storeOutOfStock = storeListings.filter(l => l.status === 'out_of_stock').length
  const storeUnknown = storeListings.filter(l => l.status === 'unknown').length
  const storeProfit = storeOrders.reduce((sum, o) => sum + o.profit, 0)
  const storePendingOrders = storeOrders.filter(o => o.status === 'pending')
  const storePendingValue = storePendingOrders.reduce((sum, o) => sum + o.ebayPrice, 0)

  const trendTotal = trendData.reduce((sum, d) => sum + d[trendMetric], 0)

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Welcome banner */}
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-white text-lg font-semibold">Welcome back! Here's your store at a glance.</h2>
            <p className="text-brand-100 text-sm mt-1">You have {pendingOrders} orders waiting to be shipped and {activeListings} active listings.</p>
          </div>
          <button onClick={refresh} className="text-white/80 hover:text-white transition flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Estimated Profit" value={formatCurrency(totalProfit)} icon={DollarSign} trend="last 30 days" color="success" />
        <StatCard label="Total Orders (30d)" value={String(totalOrders)} icon={ShoppingBag} trend={`${pendingOrders} pending shipment`} color="warning" />
        <StatCard label="Total Listings" value={String(totalListings)} icon={Package} trend="across all stores" color="brand" />
        <StatCard label="Connected Stores" value={`${connectedStores}/${stores.length}`} icon={Store} trend="eBay stores linked" color="brand" />
      </div>

      {/* Listing status + units-sold breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Listings" value={String(activeListings)} icon={CheckCircle2} trend="currently live on eBay" color="success" />
        <StatCard label="Out of Stock" value={String(outOfStockListings)} icon={PackageX} trend="paused, source out of stock" color="warning" />
        <StatCard label="Unknown Listings" value={String(unknownListings)} icon={HelpCircle} trend="not yet linked to an ASIN" color="brand" />
        <StatCard label="Total Units Sold" value={String(totalUnitsSold)} icon={TrendingUp} trend="all-time, across all stores" color="success" />
      </div>

      {oauthProcessing && (
        <div className="card border-brand-200 bg-brand-50">
          <div className="card-body flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-brand-600 shrink-0 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium text-brand-800">Connecting to eBay…</p>
              <p className="text-xs text-brand-700">Completing the authorization. Your store will appear here shortly.</p>
            </div>
          </div>
        </div>
      )}

      {oauthError && !oauthProcessing && (
        <div className="card border-error-200 bg-error-50">
          <div className="card-body flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-error-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-error-800">eBay connection failed</p>
              <p className="text-xs text-error-700">{oauthError}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store management */}
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Stores Management</h3>
            <Link to="/settings" className="text-sm text-brand-600 hover:text-brand-700 font-medium">Manage</Link>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stores.filter(store => store.connected).map(store => (
                <div key={store.id} className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 transition">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                    <Store className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 text-sm">{store.nickname}</span>
                      {store.active && <span className="badge-info">Active</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{store.ebayUsername}</p>
                  </div>
                  <span className="badge-success shrink-0"><CheckCircle2 className="w-3 h-3" /> Connected</span>
                </div>
              ))}
              <button
                onClick={() => setConnectOpen(true)}
                className="group flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 hover:bg-brand-50 hover:border-brand-500 transition-all duration-200 min-h-[88px]"
              >
                <span className="w-9 h-9 rounded-full border-2 border-brand-400 group-hover:border-brand-600 flex items-center justify-center text-xl font-light text-brand-600 group-hover:text-brand-700 transition-colors leading-none">
                  +
                </span>
                <span className="text-sm font-semibold text-brand-700 group-hover:text-brand-800">Add store</span>
              </button>
            </div>
          </div>
        </div>

        {/* Account performance */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Account Performance</h3>
          </div>
          <div className="card-body space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-600">Listings sold this month</span>
                <span className="font-semibold text-slate-900">{soldListings}</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full">
                <div className="h-full bg-success-500 rounded-full" style={{ width: `${soldListings > 0 ? Math.min(soldListings, 100) : 0}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-600">Order fulfillment rate</span>
                <span className="font-semibold text-slate-900">{fulfillmentRate}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${fulfillmentRate}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-600">Promoted listings rate</span>
                <span className="font-semibold text-slate-900">{promotedRate}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full">
                <div className="h-full bg-accent-500 rounded-full" style={{ width: `${listings.length > 0 ? (listings.filter(l => l.promoted).length / listings.length) * 100 : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Store performance — scoped to the currently active store */}
      {activeStore && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Store performance — {activeStore.nickname}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Same metrics as above, filtered to this one store.</p>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Active Listings" value={String(storeActiveListings)} icon={CheckCircle2} trend="live on eBay" color="success" />
              <StatCard label="Out of Stock" value={String(storeOutOfStock)} icon={PackageX} trend="source out of stock" color="warning" />
              <StatCard label="Unknown Listings" value={String(storeUnknown)} icon={HelpCircle} trend="not linked to an ASIN" color="brand" />
              <StatCard label="Profit" value={formatCurrency(storeProfit)} icon={DollarSign} trend="last 30 days" color="success" />
              <StatCard label="Orders" value={String(storeOrders.length)} icon={ShoppingBag} trend="last 30 days" color="warning" />
              <StatCard label="Pending Orders" value={String(storePendingOrders.length)} icon={Activity} trend="awaiting shipment" color="warning" />
              <StatCard label="Value of Pending Orders" value={formatCurrency(storePendingValue)} icon={DollarSign} trend="not yet shipped" color="brand" />
              <StatCard label="Total Listings" value={String(storeListings.length)} icon={Package} trend="in this store" color="brand" />
            </div>
          </div>
        </div>
      )}

      {/* Recent orders + trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Recent Orders</h3>
            <Link to="/orders" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            {recentOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">No orders yet. Connect a store and sync to see real eBay orders.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3 font-medium">Order</th>
                    <th className="px-5 py-3 font-medium">Buyer</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium text-right">Profit</th>
                    <th className="px-5 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(order => (
                    <tr key={order.id} className="border-b border-slate-100 table-row-hover">
                      <td className="px-5 py-3">
                        <Link to={`/orders/${order.id}`} className="text-brand-600 hover:text-brand-700 font-medium">{order.orderId}</Link>
                      </td>
                      <td className="px-5 py-3 text-slate-700">{order.buyerName}</td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(order.orderDate)}</td>
                      <td className="px-5 py-3 text-right font-medium text-success-600">{formatCurrency(order.profit)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={
                          order.status === 'delivered' ? 'badge-success' :
                          order.status === 'shipped' ? 'badge-info' :
                          order.status === 'pending' ? 'badge-warning' : 'badge-error'
                        }>{order.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Trend chart */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Trend</h3>
              <p className="text-xs text-slate-500 mt-0.5">Last 7 days</p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {(['profit', 'revenue', 'orders'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setTrendMetric(m)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition ${trendMetric === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="card-body">
            {orders.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-center text-sm text-slate-400">
                Sales trends will appear after your first order.
              </div>
            ) : (
              <>
                <div className="mb-2">
                  <p className="text-2xl font-bold text-slate-900">
                    {trendMetric === 'orders' ? trendTotal : formatCurrency(trendTotal)}
                  </p>
                  <p className="text-xs text-slate-500">Total {trendMetric}, last 7 days</p>
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        formatter={(value: number) => trendMetric === 'orders' ? value : formatCurrency(value)}
                        labelStyle={{ fontSize: 12 }}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey={trendMetric} radius={[4, 4, 0, 0]} fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConnectStoreModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={refresh} />
    </div>
  )
}
