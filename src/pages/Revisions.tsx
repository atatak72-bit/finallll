import { useState, useEffect } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, History, ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState } from '../components/UI'
import { useStoreData } from '../lib/DataContext'
import { supabase } from '../lib/supabase'
import { formatDateTime, cn } from '../lib/utils'
import type { Revision } from '../data/types'

const PAGE_SIZE = 50

export default function Revisions() {
  const { stores } = useStoreData()
  const activeStore = stores.find(s => s.active) || stores[0]

  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const fieldIcon = {
    price: TrendingUp,
    quantity: Minus,
    status: TrendingDown,
  }

  async function load() {
    if (!activeStore?.id) { setRevisions([]); setTotalCount(0); setLoading(false); return }
    setLoading(true)
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, count, error } = await supabase
      .from('revisions')
      .select('*', { count: 'exact' })
      .eq('store_id', activeStore.id)
      .order('date', { ascending: false })
      .range(from, to)

    if (!error) {
      setRevisions((data || []).map((r: { id: string; listing_title: string; field: string; old_value: string; new_value: string; reason: string; date: string }) => ({
        id: r.id,
        listingTitle: r.listing_title,
        field: r.field as Revision['field'],
        oldValue: r.old_value,
        newValue: r.new_value,
        reason: r.reason,
        date: r.date,
      })))
      setTotalCount(count || 0)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore?.id, page])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="max-w-5xl space-y-4">
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Full History</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every price, quantity, and status change the system has made to your listings — automatic checks and manual edits alike.
            </p>
          </div>
          <button className="btn-secondary text-sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
        ) : revisions.length === 0 ? (
          <EmptyState icon={History} title="No revisions yet" subtitle="Price, quantity, and status changes made to your listings will appear here." />
        ) : (
          <div className="divide-y divide-slate-100">
            {revisions.map(rev => {
              const Icon = fieldIcon[rev.field as keyof typeof fieldIcon] || Minus
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
                      <span className="font-medium text-slate-700">{rev.oldValue || '—'}</span> to{' '}
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
        <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between flex-wrap gap-2">
          <span>
            Showing {totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} revisions
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <span className="text-slate-400">Page {page} of {totalPages}</span>
            <button
              className="btn-ghost text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
