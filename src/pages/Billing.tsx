import { CreditCard, Download, Sparkles, Check, Zap } from 'lucide-react'
import { invoices, plans } from '../data/mockData'
import { formatCurrency, formatDate, cn } from '../lib/utils'

export default function Billing() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Current plan */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Current Plan</h3>
        </div>
        <div className="card-body">
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-brand-50 to-brand-100 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" fill="white" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Pro Plan</p>
                <p className="text-sm text-slate-500">{formatCurrency(49)}/month · renews on {formatDate(new Date(Date.now() + 20 * 86400000).toISOString())}</p>
              </div>
            </div>
            <button className="btn-secondary">Manage Subscription</button>
          </div>
        </div>
      </div>

      {/* Billing history */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Billing History</h3>
          <p className="text-xs text-slate-500 mt-0.5">Every invoice Stripe has issued you.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                <th className="px-5 py-3 font-medium">Invoice</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium text-right">Amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Download</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-slate-100 table-row-hover">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{inv.id}</td>
                  <td className="px-5 py-3 text-slate-700">{formatDate(inv.date)}</td>
                  <td className="px-5 py-3 text-slate-700">{inv.plan}</td>
                  <td className="px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(inv.amount)}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      inv.status === 'paid' ? 'badge-success' : inv.status === 'open' ? 'badge-warning' : 'badge-neutral',
                    )}>{inv.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition">
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI credits */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent-500" />
          <h3 className="font-semibold text-slate-900">AI Credits</h3>
        </div>
        <div className="card-body">
          <p className="text-sm text-slate-500 mb-4">
            Spent on AI title generation — Bulk Lister's "AI titles" checkbox and the on-demand button in Single's Review step.
            2 credits per title generated. Non-expiring, on top of your plan.
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">Credits remaining</span>
                <span className="font-semibold text-slate-900">42 / 50</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-accent-500 rounded-full" style={{ width: '84%' }} />
              </div>
            </div>
            <button className="btn-primary">Buy More Credits</button>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Plans</h3>
        </div>
        <div className="card-body grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(plan => (
            <div key={plan.name} className={cn(
              'border rounded-lg p-5',
              plan.name === 'Pro' ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200',
            )}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-slate-900">{plan.name}</h4>
                {plan.name === 'Pro' && <span className="badge-info">Current</span>}
              </div>
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(plan.price)}<span className="text-sm font-normal text-slate-400">/mo</span></p>
              <ul className="mt-4 space-y-2">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                    <Check className="w-4 h-4 text-success-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button className={cn('w-full mt-5', plan.name === 'Pro' ? 'btn-secondary' : 'btn-primary')}>
                {plan.name === 'Pro' ? 'Current Plan' : `Upgrade to ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
