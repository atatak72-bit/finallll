import { useEffect, useRef, useState } from 'react'
import { Store, ChevronDown, Loader2 } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { cn } from '../lib/utils'

/**
 * Compact "which store am I looking at" switcher for page headers (Listings, Orders, List Items).
 * Switching writes ebay_tokens.active, so every page and the sidebar follow the same store.
 */
export default function StoreSwitcher() {
  const { stores, setActiveStore } = useStoreData()
  const connected = stores.filter(s => s.connected)
  const activeStore = connected.find(s => s.active) || connected[0]
  const [open, setOpen] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function choose(id: string) {
    setOpen(false)
    if (id === activeStore?.id) return
    setSwitchingId(id)
    setError(null)
    try {
      await setActiveStore(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mağaza değiştirilemedi')
    } finally {
      setSwitchingId(null)
    }
  }

  if (connected.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 transition"
        title="Mağaza değiştir"
      >
        {switchingId ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <Store className="w-4 h-4 text-slate-500" />}
        <span className="font-medium text-slate-700 max-w-[10rem] truncate">{activeStore?.nickname || 'Mağaza'}</span>
        <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[12rem] bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
          {connected.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => { void choose(s.id) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50',
                s.id === activeStore?.id && 'bg-brand-50 text-brand-700 font-medium',
              )}
            >
              <span className="w-2 h-2 rounded-full bg-success-500" />
              <span className="flex-1 truncate">{s.nickname}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="absolute right-0 top-full mt-1 text-xs text-red-600 whitespace-nowrap">{error}</p>}
    </div>
  )
}
