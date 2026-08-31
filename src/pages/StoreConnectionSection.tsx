import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Store, Unplug } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'

export default function StoreConnectionSection() {
  const { stores, disconnectStore } = useStoreData()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const connectedStores = stores.filter(store => store.connected)

  async function handleDisconnect(storeId: string) {
    setDisconnectingId(storeId)
    setMessage(null)
    try {
      await disconnectStore(storeId)
      setConfirmingId(null)
      setMessage('The eBay store was disconnected successfully.')
    } catch {
      setMessage('The store could not be disconnected. Your connection is still active.')
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
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />
          {message}
        </div>
      )}

      {connectedStores.length === 0 ? (
        <div className="card p-8 text-center">
          <Store className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-semibold text-slate-900 mt-3">No connected stores</h3>
          <p className="text-sm text-slate-500 mt-1">Connect an eBay store from the store switcher to start syncing.</p>
        </div>
      ) : (
        connectedStores.map(store => {
          const isConfirming = confirmingId === store.id
          const isDisconnecting = disconnectingId === store.id
          return (
            <div key={store.id} className="card">
              <div className="card-body flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success-50 flex items-center justify-center">
                    <Store className="w-5 h-5 text-success-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{store.nickname}</p>
                    <p className="text-sm text-slate-500">{store.ebayUsername || 'eBay account'} · Connected</p>
                  </div>
                </div>

                {isConfirming ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-warning-50 border border-warning-200 p-3">
                    <div className="flex items-start gap-2 text-sm text-warning-800">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Disconnecting revokes eBay access and removes synced store data.</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="btn-ghost text-sm" onClick={() => setConfirmingId(null)} disabled={isDisconnecting}>Cancel</button>
                      <button className="btn-danger text-sm" onClick={() => handleDisconnect(store.id)} disabled={isDisconnecting}>
                        {isDisconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                        {isDisconnecting ? 'Disconnecting…' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn-secondary text-error-600 border-error-200 hover:bg-error-50" onClick={() => setConfirmingId(store.id)}>
                    <Unplug className="w-4 h-4" /> Disconnect Store
                  </button>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
