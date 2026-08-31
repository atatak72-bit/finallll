import { Routes, Route, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './pages/Dashboard'
import ListItems from './pages/ListItems'
import Listings from './pages/Listings'
import EditListing from './pages/EditListing'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Messages from './pages/Messages'
import Conversation from './pages/Conversation'
import Revisions from './pages/Revisions'
import Account from './pages/Account'
import Billing from './pages/Billing'
import Fulfillment from './pages/Fulfillment'
import Settings from './pages/Settings'
import { DataProvider } from './lib/DataContext'

const pageMeta: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Your account at a glance.' },
  '/list-items': { title: 'List Items', subtitle: 'Pull a product from Amazon and publish it to eBay.' },
  '/listings': { title: 'Listings', subtitle: 'All your live eBay listings in one place.' },
  '/orders': { title: 'Orders', subtitle: 'Real eBay orders, synced on a rolling 30-day window.' },
  '/messages': { title: 'Messages', subtitle: 'Real buyer-seller correspondence, synced from eBay.' },
  '/revisions': { title: 'Revisions', subtitle: 'Price/quantity/status changes in the last 24 hours.' },
  '/account': { title: 'Account', subtitle: 'Your personal login details.' },
  '/billing': { title: 'Billing', subtitle: 'Your plan, invoices, and AI credits.' },
  '/fulfillment': { title: 'Fulfillment', subtitle: 'Connect the Amazon accounts orders will be purchased through.' },
  '/settings': { title: 'Settings', subtitle: 'Everything that shapes how items get priced, filtered, and listed.' },
}

export default function App() {
  const location = useLocation()
  const meta = pageMeta[location.pathname] || { title: 'Tubika' }

  return (
    <DataProvider>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title={meta.title} subtitle={meta.subtitle} />
          <main className="flex-1 p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/list-items" element={<ListItems />} />
              <Route path="/listings" element={<Listings />} />
              <Route path="/listings/:id" element={<EditListing />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/messages/:id" element={<Conversation />} />
              <Route path="/revisions" element={<Revisions />} />
              <Route path="/account" element={<Account />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/fulfillment" element={<Fulfillment />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
    </DataProvider>
  )
}
