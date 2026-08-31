import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Filter, Package, ArrowUpDown, Loader2 } from 'lucide-react'
import { OrderStatusBadge } from '../components/Badges'
import { EmptyState } from '../components/UI'
import { useStoreData } from '../lib/DataContext'
import { formatCurrency, formatDate } from '../lib/utils'

export default function Orders() {
  const { orders, loading } = useStoreData()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    return orders.filter(o => {
      const matchSearch =
        o.orderId.toLowerCase().includes(search.toLowerCase()) ||
        o.buyerName.toLowerCase().includes(search.toLowerCase()) ||
        o.listingTitle.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || o.status === statusFilter
      return matchSearch && matchStatus
    }).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
  }, [orders, search, statusFilter])

  const totalProfit = filtered.reduce((s, o) => s + o.profit, 0)
  const pendingCount = orders.filter(o => o.status === 'pending').length

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-sm text-slate-500">Total Orders (30d)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{orders.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-500">Pending Shipment</p>
          <p className="text-2xl font-bold text-warning-600 mt-1">{pendingCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-500">Total Profit</p>
          <p className="text-2xl font-bold text-success-600 mt-1">{formatCurrency(totalProfit)}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-slate-500">Avg Profit / Order</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalProfit / (filtered.length || 1))}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by order ID, buyer, or item…"
            className="input pl-9"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Package} title="No orders found" subtitle="Connect a store and sync to pull real eBay orders." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                  <th className="px-4 py-3 font-medium">Order ID</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                  <th className="px-4 py-3 font-medium text-right">Profit</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tracking</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(order => (
                  <tr key={order.id} className="border-b border-slate-100 table-row-hover">
                    <td className="px-4 py-3">
                      <Link to={`/orders/${order.id}`} className="text-brand-600 hover:text-brand-700 font-medium">{order.orderId}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 max-w-xs">
                        <img src={order.listingImage} alt="" className="w-8 h-8 rounded object-cover border border-slate-200 shrink-0" />
                        <span className="truncate text-slate-700">{order.listingTitle}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{order.buyerName}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrency(order.ebayPrice)}</td>
                    <td className="px-4 py-3 text-right font-medium text-success-600">{formatCurrency(order.profit)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(order.orderDate)}</td>
                    <td className="px-4 py-3"><OrderStatusBadge status={order.status} /></td>
                    <td className="px-4 py-3">
                      {order.trackingNumber ? (
                        <span className="text-xs font-mono text-slate-600">{order.trackingCarrier}</span>
                      ) : (
                        <span className="text-xs text-warning-600">Not shipped</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500">
          Showing {filtered.length} of {orders.length} orders
        </div>
      </div>
    </div>
  )
}
