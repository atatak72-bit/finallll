import { Plus, Trash2, ShoppingBag, Shield, AlertCircle, CheckCircle2 } from 'lucide-react'
import { amazonAccounts } from '../data/mockData'
import { cn } from '../lib/utils'

export default function Fulfillment() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Connect an Amazon Account</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Connect the Amazon accounts orders will be purchased through once Auto Order ships.
          </p>
        </div>
        <div className="card-body space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 p-3 bg-warning-50 border border-warning-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-warning-600 shrink-0 mt-0.5" />
            <p className="text-sm text-warning-800">
              Only the authenticator-app setup key works here — not a phone number, not a one-time code.
            </p>
          </div>

          {/* Connected accounts */}
          {amazonAccounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-slate-700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{acc.email}</p>
                <p className="text-xs text-slate-500">Region: {acc.region}</p>
              </div>
              {acc.status === 'connected' ? (
                <>
                  <span className="badge-success"><CheckCircle2 className="w-3 h-3" /> Connected</span>
                  <button className="btn-ghost text-error-600 hover:bg-error-50"><Trash2 className="w-4 h-4" /></button>
                </>
              ) : (
                <button className="btn-secondary text-sm">Reconnect</button>
              )}
            </div>
          ))}

          {/* Add new account form */}
          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Shield className="w-4 h-4 text-slate-400" />
              Add Amazon Account
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Amazon Email</label>
                <input className="input" placeholder="buyer@amazon.com" />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" placeholder="••••••••" />
              </div>
              <div className="md:col-span-2">
                <label className="label">2FA Setup Key (Authenticator App)</label>
                <input className="input font-mono" placeholder="e.g. JBSWY3DPEHPK3PXP" />
                <p className="text-xs text-slate-400 mt-1">Found in your Amazon account → Login & security → 2-Step Verification → Authenticator App → "Can't scan the barcode?"</p>
              </div>
            </div>
            <button className="btn-primary"><Plus className="w-4 h-4" /> Connect Account</button>
          </div>
        </div>
      </div>
    </div>
  )
}
