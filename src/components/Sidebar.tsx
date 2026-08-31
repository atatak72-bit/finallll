import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, PackagePlus, ListOrdered, ShoppingBag,
  MessageSquare, RefreshCw, User, CreditCard,
  Truck, Settings, Store, ChevronDown, Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useStoreData } from '../lib/DataContext'
import { ConnectStoreModal } from './ConnectStoreModal'
import { cn } from '../lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/list-items', label: 'List Items', icon: PackagePlus },
  { to: '/listings', label: 'Listings', icon: ShoppingBag },
  { to: '/orders', label: 'Orders', icon: ListOrdered },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/revisions', label: 'Revisions', icon: RefreshCw },
]

const accountItems = [
  { to: '/account', label: 'Account', icon: User },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/fulfillment', label: 'Fulfillment', icon: Truck },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const [storeOpen, setStoreOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const { stores, refresh } = useStoreData()
  const activeStore = stores.find(s => s.active) || stores[0]

  return (
    <>
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-200">
          <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" fill="white" />
          </div>
          <div>
            <span className="text-lg font-bold text-slate-900">Tubika</span>
            <span className="text-xs text-slate-400 block leading-none">Amazon → eBay</span>
          </div>
        </div>

        {/* Store Switcher */}
        <div className="px-3 py-3 border-b border-slate-200 relative">
          <button
            onClick={() => setStoreOpen(!storeOpen)}
            className="w-full flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition"
          >
            <Store className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 flex-1 text-left truncate">{activeStore?.nickname || 'No store'}</span>
            <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', storeOpen && 'rotate-180')} />
          </button>
          {storeOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
              {stores.map(s => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer rounded-lg',
                    s.id === activeStore?.id && 'bg-brand-50 text-brand-700',
                    !s.connected && 'opacity-50',
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full', s.connected ? 'bg-success-500' : 'bg-slate-300')} />
                  <span className="flex-1 truncate">{s.nickname}</span>
                  {!s.connected && <span className="text-xs text-slate-400">offline</span>}
                </div>
              ))}
              <div className="border-t border-slate-200 px-3 py-2">
                <button onClick={() => { setConnectOpen(true); setStoreOpen(false) }} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Connect a store</button>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}

          <div className="pt-4 pb-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Account</div>
          {accountItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-slate-200">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50">
            <div className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm font-semibold">A</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-700 truncate">owner@tubika.com</div>
              <div className="text-xs text-slate-400">Pro plan</div>
            </div>
          </div>
        </div>
      </aside>

      <ConnectStoreModal open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={refresh} />
    </>
  )
}
