import { RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, History } from 'lucide-react'
import { EmptyState } from '../components/UI'
import { useStoreData } from '../lib/DataContext'
import { formatDateTime, cn } from '../lib/utils'

export default function Revisions() {
  const { revisions, loading, refresh } = useStoreData()
  const fieldIcon = {
    price: TrendingUp,
    quantity: Minus,
    status: TrendingDown,
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Full History</h3>
            <p className="text-xs text-slate-500 mt-0.5">Price/quantity/status changes a background recheck made to an active listing, in the last 24 hours.</p>
          </div>
          <button className="btn-secondary text-sm"><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
        ) : revisions.length === 0 ? (
          <EmptyState icon={History} title="No revisions yet" subtitle="Price, quantity, and status changes made to your listings will appear here." />
        ) : (
        <div className="divide-y divide-slate-100">
          {revisions.map(rev => {
            const Icon = fieldIcon[rev.field]
            const isPriceUp = rev.field === 'price' && parseFloat(rev.newValue.replace('$', '')) > parseFloat(rev.oldValue.replace('$', ''))
            return (
              <div key={rev.id} className="flex items-center gap-4 p-4 hover:bg-slate-50 transition">
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  rev.field === 'price' ? 'bg-brand-50 text-brand-600' :
                  rev.field === 'quantity' ? 'bg-accent-50 text-accent-600' :
                  'bg-error-50 text-error-600',
                )}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{rev.listingTitle}</p>
                  <p className="text-xs text-slate-500">
                    <span className="capitalize">{rev.field}</span> changed from{' '}
                    <span className="font-medium text-slate-700">{rev.oldValue}</span> to{' '}
                    <span className={cn('font-medium', isPriceUp ? 'text-success-600' : 'text-error-600')}>{rev.newValue}</span>
                    {' '}— {rev.reason}
                  </p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{formatDateTime(rev.date)}</span>
              </div>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}
