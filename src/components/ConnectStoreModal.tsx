import { useState, useEffect } from 'react'
import { X, Store, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'

export function ConnectStoreModal({ open, onClose, onConnected }: {
  open: boolean
  onClose: () => void
  onConnected: () => void
}) {
  const { oauthProcessing, oauthError } = useStoreData()
  const [step, setStep] = useState<'name' | 'connecting' | 'done' | 'error'>('name')

  useEffect(() => {
    if (!open) {
      setStep('name')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (oauthProcessing) {
      setStep('connecting')
    } else if (oauthError) {
      setStep('error')
    }
  }, [oauthProcessing, oauthError, open])

  async function startOAuth() {
    setStep('connecting')
    sessionStorage.setItem('ebay_store_nickname', 'My Store')
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ebay-oauth/auth-url`, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      })
      const data = await res.json() as { authUrl?: string; error?: string; clientId?: string; envClientId?: string }
      console.log('ebay-oauth response:', data)
      if (!res.ok || typeof data.authUrl !== 'string') {
        throw new Error(data.error || 'Failed to get eBay authorization URL')
      }
      window.location.href = data.authUrl
    } catch (err) {
      setStep('error')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-brand-600" />
            <h3 className="font-semibold text-slate-900">Connect eBay Store</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'name' && (
            <>
              <p className="text-sm text-slate-600">Continue to eBay to authorize your store connection.</p>
              <button onClick={startOAuth} className="btn-primary w-full">
                Continue to eBay <ExternalLink className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 'connecting' && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
              <p className="text-sm font-medium text-slate-700 mt-3">Connecting to eBay…</p>
              <p className="text-xs text-slate-500 mt-1">You will return here automatically after approving the connection on eBay.</p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-success-500 mb-3" />
              <p className="text-sm font-medium text-slate-900">Store connected successfully!</p>
              <p className="text-xs text-slate-500 mt-1">Your eBay listings, orders, and messages will start syncing.</p>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center py-4 text-center">
              <AlertCircle className="w-12 h-12 text-error-500 mb-3" />
              <p className="text-sm font-medium text-slate-900">Connection failed</p>
              <p className="text-xs text-slate-500 mt-1">{oauthError || 'Something went wrong. Please try again.'}</p>
              <button onClick={() => setStep('name')} className="btn-secondary mt-4">
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
