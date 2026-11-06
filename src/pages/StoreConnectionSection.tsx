import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Store, Unplug } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'

export default function StoreConnectionSection() {
  const { stores, disconnectStore } = useStoreData()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const connectedStores = stores.filter(store => store.connected)

  function startConfirm(storeId: string) {
    setConfirmingId(storeId)
    setAcknowledged(false)
    setMessage(null)
  }

  async function handleDisconnect(storeId: string) {
    if (!acknowledged) return
    setDisconnectingId(storeId)
    setMessage(null)
    try {
      await disconnectStore(storeId)
      setConfirmingId(null)
      setAcknowledged(false)
      setMessage({ type: 'success', text: 'The eBay store was disconnected.' })
    } catch (err) {
      const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
      setMessage({ type: 'error', text: `The store could not be disconnected${detail}. Your connection is still active.` })
    } finally {
      setDisconnectingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Store Connection</h2>
        <p className="text-sm text-slate-500 mt-1">Manage the eBay stores connected to this workspace.</p>
      </div>

      {message && (
        <div className={message.type === 'success'
          ? 'flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700'
          : 'flex items-center gap-2 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700'}>
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />
            : <AlertTriangle className="w-4 h-4 text-error-600 shrink-0" />}
          {message.text}
        </div>
      )}

      {connectedStores.length === 0 ? (
        <div className="card p-8 text-center">
          <Store className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-semibold text-slate-900 mt-3">No connected stores</h3>
          <p className="text-sm text-slate-500 mt-1">Connect an eBay store from Settings → eBay Policies to start syncing.</p>
        </div>
      ) : (
        connectedStores.map(store => {
          const isConfirming = confirmingId === store.id
          const isDisconnecting = disconnectingId === store.id
          return (
            <div key={store.id} className="card">
              <div className="card-body flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success-50 flex items-center justify-center">
                    <Store className="w-5 h-5 text-success-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{store.nickname}</p>
                    <p className="text-sm text-slate-500">{store.ebayUsername || 'eBay account'} · Connected</p>
                  </div>
                </div>

                {!isConfirming && (
                  <button className="btn-secondary text-error-600 border-error-200 hover:bg-error-50" onClick={() => startConfirm(store.id)} disabled={!!disconnectingId}>
                    <Unplug className="w-4 h-4" /> Disconnect Store
                  </button>
                )}
                </div>

                {isConfirming && (
                  <div className="space-y-3 rounded-lg bg-error-50 border border-error-200 p-4">
                    <div className="flex items-start gap-2 text-sm text-error-800">
                      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-error-600" />
                      <div className="space-y-1.5">
                        <p className="font-semibold">Disconnect {store.ebayUsername || store.nickname}?</p>
                        <p>This revokes this app's eBay access for the store. Your listings stay live on eBay, but <span className="font-semibold">tracking stops for every eBay listing of this store</span>:
                          Amazon price and stock are no longer checked, and eBay prices/quantities are no longer updated — an item that goes out of stock or up in price on Amazon will keep selling on eBay.</p>
                        <p>The store's synced data in this app (listings, Amazon links/ASINs, orders, revisions) may be deleted and cannot be restored by reconnecting — listings would have to be re-linked to their ASINs.</p>
                        <p>If you want to stop selling, end the listings on eBay (or set them to 0 quantity) before disconnecting.</p>
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-sm text-error-800">
                      <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={isDisconnecting} />
                      <span>I understand that tracking stops for this store's eBay listings.</span>
                    </label>
                    <div className="flex justify-end gap-2">
                      <button className="btn-ghost text-sm" onClick={() => { setConfirmingId(null); setAcknowledged(false) }} disabled={isDisconnecting}>Cancel</button>
                      <button className="btn-danger text-sm" onClick={() => void handleDisconnect(store.id)} disabled={isDisconnecting || !acknowledged}>
                        {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                        {isDisconnecting ? 'Disconnecting…' : 'Disconnect store'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
