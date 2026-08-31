import { useEffect, useState } from 'react'
import {
  DollarSign, Tag, Filter, MessageSquare, Users,
  Store, Save, Plus, Trash2, Info, Mail, ChevronDown,
  CreditCard, RotateCcw, Truck, CheckCircle2, Loader2, MapPin,
  RefreshCw, AlertCircle, CircleCheck, CircleDot,
  Clock, Star, MessageSquareText, Package, Percent, HelpCircle, Check,
  X, Search, Copy, Clipboard, Pencil, Sparkles,
} from 'lucide-react'
import { Toggle } from '../components/UI'
import { teamMembers } from '../data/mockData'
import StoreConnectionSection from './StoreConnectionSection'
import { ConnectStoreModal } from '../components/ConnectStoreModal'
import { useStoreData } from '../lib/DataContext'
import { formatCurrency, formatDate, cn, calculateEbayPrice } from '../lib/utils'
import { supabase } from '../lib/supabase'

type Section = 'general' | 'ebay-policies' | 'filters' | 'templates' | 'auto-messages' | 'auto-ordering' | 'tracking' | 'advanced' | 'team'

const sections: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ebay-policies', label: 'eBay Policies' },
  { id: 'filters', label: 'Filters' },
  { id: 'templates', label: 'Templates' },
  { id: 'auto-messages', label: 'Auto Messages' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'team', label: 'Team' },
]

export default function Settings() {
  const [section, setSection] = useState<Section>('general')
  const { stores } = useStoreData()
  const activeStore = stores.find(store => store.active) || stores[0]
  const activeStoreName = activeStore?.ebayUsername || activeStore?.nickname || 'No store connected'

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="text-xs text-slate-400">Home › Settings</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Everything that shapes how items get priced, filtered, and listed.</p>
      </div>
      <div className="border-b border-slate-200 overflow-x-auto">
        <div className="flex min-w-max gap-6">
          {sections.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)} className={cn(
              'border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors',
              section === item.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-900',
            )}>{item.label}</button>
          ))}
        </div>
      </div>
      <p className="mt-5 text-xs text-slate-500">Editing settings for <span className="font-medium text-slate-700">{activeStoreName}</span></p>
      <div className="mt-3">
        {section === 'general' && <GeneralSettings />}
        {section === 'ebay-policies' && <EbayPoliciesSection />}
        {section === 'filters' && <AmazonFiltersSection />}
        {section === 'templates' && <ListingTemplateSection />}
        {section === 'auto-messages' && <MessagesSection />}
        {section === 'tracking' && <AvailabilitySection />}
        {section === 'advanced' && (
          <div className="space-y-3">
            <StoreConnectionSection />
            <SettingsAccordion title="VeRO & words filter" open><VeroSection /></SettingsAccordion>
          </div>
        )}
        {section === 'team' && <TeamSection />}
      </div>
    </div>
  )
}

function SettingsAccordion({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200 p-5">{children}</div>
    </details>
  )
}

function GeneralSettings() {
  return (
    <div className="space-y-3">
      <SettingsAccordion title="Profit & fees" open><PricingSection /></SettingsAccordion>
      <SettingsAccordion title="Availability" open><AvailabilitySection /></SettingsAccordion>
      <SettingsAccordion title="Promoted Listings" open><PromotedSection /></SettingsAccordion>
    </div>
  )
}

type EbayPolicy = {
  paymentPolicyId?: string
  fulfillmentPolicyId?: string
  returnPolicyId?: string
  name: string
  description?: string
}
function policyId(p: EbayPolicy): string {
  return p.paymentPolicyId || p.fulfillmentPolicyId || p.returnPolicyId || ''
}
type PoliciesResponse = {
  paymentPolicies: EbayPolicy[]
  returnPolicies: EbayPolicy[]
  fulfillmentPolicies: EbayPolicy[]
}
type StoreSettings = {
  payment_policy_id: string | null
  return_policy_id: string | null
  fulfillment_policy_id: string | null
  location_country: string | null
  location_city: string | null
  location_state: string | null
  location_zip: string | null
  location_key: string | null
  default_category_id: string | null
  default_category_name: string | null
}
type CategorySuggestion = { categoryId: string; categoryName: string; path: string }

function EbayPoliciesSection() {
  const { stores, refresh } = useStoreData()
  const connectedStores = stores.filter(store => store.connected)
  const [selectedStoreId, setSelectedStoreId] = useState(connectedStores[0]?.id || '')
  const [policies, setPolicies] = useState<PoliciesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addStoreOpen, setAddStoreOpen] = useState(false)

  const [selPaymentId, setSelPaymentId] = useState('')
  const [selReturnId, setSelReturnId] = useState('')
  const [selFulfillmentId, setSelFulfillmentId] = useState('')
  const [locCountry, setLocCountry] = useState('US')
  const [locCityState, setLocCityState] = useState('')
  const [locZip, setLocZip] = useState('')
  const [locKey, setLocKey] = useState<string | null>(null)
  const [defaultCategoryId, setDefaultCategoryId] = useState('')
  const [defaultCategoryName, setDefaultCategoryName] = useState('')
  const [categoryQuery, setCategoryQuery] = useState('')
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestion[]>([])
  const [categorySearching, setCategorySearching] = useState(false)
  const [savingLocation, setSavingLocation] = useState(false)
  const [savingCategory, setSavingCategory] = useState(false)
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)

  const selectedStore = connectedStores.find(store => store.id === selectedStoreId) || connectedStores[0]
  const selectedStoreName = selectedStore?.ebayUsername || selectedStore?.nickname || 'No store connected'

  useEffect(() => {
    if (!selectedStoreId && connectedStores[0]) setSelectedStoreId(connectedStores[0].id)
  }, [connectedStores, selectedStoreId])

  useEffect(() => {
    if (!selectedStore?.id) {
      setPolicies(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setMessage(null)
    setError(null)

    async function loadAll() {
      try {
        const [polResult, settingsResult] = await Promise.all([
          supabase.functions.invoke('ebay-policies', {
            body: { action: 'getPolicies', store_id: selectedStore!.id },
          }),
          supabase.functions.invoke('ebay-policies', {
            body: { action: 'getSettings', store_id: selectedStore!.id },
          }),
        ])
        if (cancelled) return

        // Policies: gracefully fall back to empty arrays on error so the UI never crashes.
        const polData = (polResult.data || {}) as Partial<PoliciesResponse> & { error?: string }
        if (polResult.error || polData.error) {
          setPolicies({ paymentPolicies: [], returnPolicies: [], fulfillmentPolicies: [] })
          if (polData.error) setError(polData.error)
        } else {
          setPolicies({
            paymentPolicies: polData.paymentPolicies || [],
            returnPolicies: polData.returnPolicies || [],
            fulfillmentPolicies: polData.fulfillmentPolicies || [],
          })
        }

        // Settings: load saved policy IDs + location from database.
        const settingsData = (settingsResult.data || {}) as { settings: StoreSettings | null }
        const s = settingsData.settings
        if (s) {
          setSelPaymentId(s.payment_policy_id || '')
          setSelReturnId(s.return_policy_id || '')
          setSelFulfillmentId(s.fulfillment_policy_id || '')
          setLocCountry(s.location_country || 'US')
          setLocCityState([s.location_city, s.location_state].filter(Boolean).join(', '))
          setLocZip(s.location_zip || '')
          setLocKey(s.location_key || null)
          setDefaultCategoryId(s.default_category_id || '')
          setDefaultCategoryName(s.default_category_name || '')
        } else {
          setSelPaymentId('')
          setSelReturnId('')
          setSelFulfillmentId('')
          setLocCountry('US')
          setLocCityState('')
          setLocZip('')
          setLocKey(null)
          setDefaultCategoryId('')
          setDefaultCategoryName('')
        }
      } catch (err) {
        if (!cancelled) {
          setPolicies({ paymentPolicies: [], returnPolicies: [], fulfillmentPolicies: [] })
          setError(err instanceof Error ? err.message : 'Failed to load eBay data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadAll()
    return () => { cancelled = true }
  }, [selectedStore?.id])

  async function reconnectStore(storeId: string) {
    setReconnecting(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ebay-oauth', {
        body: { action: 'refresh', store_id: storeId },
      })
      const result = (data || {}) as { success?: boolean; error?: string }
      if (invokeError || !result.success) throw new Error(result.error || (invokeError as Error)?.message || 'Failed to reconnect store')
      setMessage('Store reconnected successfully.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconnect')
    } finally {
      setReconnecting(false)
    }
  }

  async function searchCategory() {
    if (!selectedStore?.id || !categoryQuery.trim()) return
    setCategorySearching(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ebay-policies', {
        body: { action: 'searchCategory', store_id: selectedStore.id, query: categoryQuery },
      })
      const result = (data || {}) as { suggestions?: CategorySuggestion[]; error?: string }
      if (invokeError || result.error) throw new Error(result.error || (invokeError as Error)?.message || 'Category search failed')
      setCategorySuggestions(result.suggestions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Category search failed')
      setCategorySuggestions([])
    } finally {
      setCategorySearching(false)
    }
  }

  function pickCategory(s: CategorySuggestion) {
    setDefaultCategoryId(s.categoryId)
    setDefaultCategoryName(s.path ? `${s.path} > ${s.categoryName}` : s.categoryName)
    setCategorySuggestions([])
    setCategoryQuery('')
  }

  async function savePolicies() {
    if (!selectedStore?.id) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ebay-policies', {
        body: {
          action: 'saveSettings',
          store_id: selectedStore.id,
          paymentPolicyId: selPaymentId,
          returnPolicyId: selReturnId,
          fulfillmentPolicyId: selFulfillmentId,
          locationCountry: locCountry,
          locationCity: locCityState.split(',')[0]?.trim() || '',
          locationState: locCityState.split(',')[1]?.trim() || '',
          locationZip: locZip,
          locationKey: locKey,
          defaultCategoryId,
          defaultCategoryName,
        },
      })
      const result = (data || {}) as { success?: boolean; error?: string }
      if (invokeError || !result.success) throw new Error(result.error || (invokeError as Error)?.message || 'Failed to save policies')
      setMessage('Policies saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policies')
    } finally {
      setSaving(false)
    }
  }

  async function saveLocation() {
    if (!selectedStore?.id) return
    setSavingLocation(true)
    setLocationMessage(null)
    setLocationError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ebay-policies', {
        body: {
          action: 'saveSettings',
          store_id: selectedStore.id,
          paymentPolicyId: selPaymentId,
          returnPolicyId: selReturnId,
          fulfillmentPolicyId: selFulfillmentId,
          locationCountry: locCountry,
          locationCity: locCityState.split(',')[0]?.trim() || '',
          locationState: locCityState.split(',')[1]?.trim() || '',
          locationZip: locZip,
          locationKey: locKey,
          defaultCategoryId,
          defaultCategoryName,
        },
      })
      const result = (data || {}) as { success?: boolean; error?: string; warning?: string }
      if (invokeError || !result.success) throw new Error(result.error || (invokeError as Error)?.message || 'Failed to save location')
      if (result.warning) {
        setLocationError(result.warning)
      } else {
        setLocationMessage('Location saved and created on eBay.')
        const { data: refreshed } = await supabase.from('store_policies').select('location_key').eq('store_id', selectedStore.id).maybeSingle()
        if (refreshed?.location_key) setLocKey(refreshed.location_key)
      }
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Failed to save location')
    } finally {
      setSavingLocation(false)
    }
  }

  async function saveCategory() {
    if (!selectedStore?.id) return
    setSavingCategory(true)
    setMessage(null)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ebay-policies', {
        body: {
          action: 'saveSettings',
          store_id: selectedStore.id,
          paymentPolicyId: selPaymentId,
          returnPolicyId: selReturnId,
          fulfillmentPolicyId: selFulfillmentId,
          locationCountry: locCountry,
          locationCity: locCityState.split(',')[0]?.trim() || '',
          locationState: locCityState.split(',')[1]?.trim() || '',
          locationZip: locZip,
          locationKey: locKey,
          defaultCategoryId,
          defaultCategoryName,
        },
      })
      const result = (data || {}) as { success?: boolean; error?: string }
      if (invokeError || !result.success) throw new Error(result.error || (invokeError as Error)?.message || 'Failed to save category')
      setMessage('Default category saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save category')
    } finally {
      setSavingCategory(false)
    }
  }

  const allSet = !!(selPaymentId && selReturnId && selFulfillmentId && locCountry && locCityState && locZip)

  if (connectedStores.length === 0) {
    return (
      <>
        <div className="card p-8 text-center">
          <Store className="mx-auto h-9 w-9 text-slate-400" />
          <h2 className="mt-3 font-semibold text-slate-900">Connect an eBay store</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Add a store to manage its payment, return, and shipping policies here.</p>
          <button className="btn-primary mx-auto mt-5" onClick={() => setAddStoreOpen(true)}><Plus className="h-4 w-4" /> Add Store</button>
        </div>
        <ConnectStoreModal open={addStoreOpen} onClose={() => setAddStoreOpen(false)} onConnected={refresh} />
      </>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {/* Your stores */}
        <SettingsAccordion title="Your stores" open>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Connected eBay accounts.</p>
              <button className="btn-secondary" onClick={() => setAddStoreOpen(true)}><Plus className="h-4 w-4" /> Connect another store</button>
            </div>
            <div className="space-y-2">
              {connectedStores.map(store => (
                <div key={store.id} className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                  store.id === selectedStore?.id ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200',
                )}>
                  <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', store.connected ? 'bg-success-500' : 'bg-slate-300')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{store.ebayUsername || store.nickname}</p>
                    <p className="text-xs text-slate-500">{store.connected ? 'Connected' : 'Offline'}</p>
                  </div>
                  <button
                    className="text-xs font-medium px-2 py-1 rounded text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1"
                    onClick={() => void reconnectStore(store.id)}
                    disabled={reconnecting}
                    title="Refresh expired OAuth token"
                  >
                    {reconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Reconnect
                  </button>
                  <button
                    className={cn('text-xs font-medium px-2 py-1 rounded', store.id === selectedStore?.id ? 'bg-brand-100 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}
                    onClick={() => setSelectedStoreId(store.id)}
                  >{store.id === selectedStore?.id ? 'Active' : 'Select'}</button>
                </div>
              ))}
            </div>
          </div>
        </SettingsAccordion>

        {/* Business policies & location */}
        <SettingsAccordion title="Business policies & location" open>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Required before publishing: a Business Policies opt-in, a fulfillment/payment/return policy, and an inventory location. Applies to the active store above.
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <span className={cn('h-2 w-2 rounded-full', allSet ? 'bg-success-500' : 'bg-slate-300')} />
              <span className={allSet ? 'text-success-700 font-medium' : 'text-slate-400'}>
                {allSet ? 'Ready to publish' : 'Select all 3 policies and fill in location to be ready'}
              </span>
            </div>

            {loading ? (
              <div className="p-6 text-center text-sm text-slate-500">Loading policies from eBay…</div>
            ) : (
              <>
                {/* Policies row */}
                <div className="grid gap-3 md:grid-cols-3">
                  <PolicyDropdown
                    icon={Truck}
                    title="Fulfillment (shipping) policy"
                    policies={policies?.fulfillmentPolicies || []}
                    selectedId={selFulfillmentId}
                    onSelect={setSelFulfillmentId}
                  />
                  <PolicyDropdown
                    icon={CreditCard}
                    title="Payment policy"
                    policies={policies?.paymentPolicies || []}
                    selectedId={selPaymentId}
                    onSelect={setSelPaymentId}
                  />
                  <PolicyDropdown
                    icon={RotateCcw}
                    title="Return policy"
                    policies={policies?.returnPolicies || []}
                    selectedId={selReturnId}
                    onSelect={setSelReturnId}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button className="btn-secondary" onClick={() => void savePolicies()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {saving ? 'Saving…' : 'Use selected policies'}
                  </button>
                  {message && <span className="flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="h-4 w-4" /> {message}</span>}
                  {error && <span className="text-sm text-error-600">{error}</span>}
                </div>

                <hr className="border-slate-200" />

                {/* Item location */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-700">Item location</p>
                  <div>
                    <label className="label">Country</label>
                    <select className="input mt-1" value={locCountry} onChange={event => setLocCountry(event.target.value)}>
                      <option value="US">United States</option><option value="GB">United Kingdom</option><option value="DE">Germany</option><option value="TR">Turkey</option><option value="CA">Canada</option><option value="AU">Australia</option><option value="FR">France</option><option value="IT">Italy</option><option value="ES">Spain</option>
                    </select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="label">City, State
                      <input className="input mt-1" value={locCityState} onChange={event => setLocCityState(event.target.value)} placeholder="e.g. Sandpoint, Idaho" />
                    </label>
                    <label className="label">Zip code
                      <input className="input mt-1" value={locZip} onChange={event => setLocZip(event.target.value)} placeholder="Enter zip code" />
                    </label>
                  </div>
                  <button className="btn-primary" onClick={() => void saveLocation()} disabled={savingLocation}>
                    {savingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {savingLocation ? 'Saving…' : 'Save'}
                  </button>
                  {locationMessage && <p className="flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="h-4 w-4" /> {locationMessage}</p>}
                  {locationError && <p className="text-sm text-error-600">{locationError}</p>}
                </div>
              </>
            )}
          </div>
        </SettingsAccordion>

        {/* Default eBay category — a separate box since eBay still requires a category to publish,
            even though it isn't part of the reference layout above. */}
        <SettingsAccordion title="Default eBay category">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Used automatically whenever a product is listed without its own category. Search by product type (e.g. "wireless earbuds"). eBay requires a category to publish any listing.</p>
            {defaultCategoryId ? (
              <div className="flex items-center justify-between rounded-lg bg-brand-50 border border-brand-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{defaultCategoryName || defaultCategoryId}</p>
                  <p className="text-xs text-slate-500">Category ID: {defaultCategoryId}</p>
                </div>
                <button className="text-xs font-medium text-slate-500 hover:text-slate-900 shrink-0 ml-3" onClick={() => { setDefaultCategoryId(''); setDefaultCategoryName('') }}>
                  Change
                </button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={categoryQuery}
                onChange={e => setCategoryQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void searchCategory() }}
                placeholder="Search for a category, e.g. wireless earbuds"
              />
              <button className="btn-secondary shrink-0" onClick={() => void searchCategory()} disabled={categorySearching || !categoryQuery.trim()}>
                {categorySearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </button>
            </div>
            {categorySuggestions.length > 0 && (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 max-h-56 overflow-y-auto">
                {categorySuggestions.map(s => (
                  <button
                    key={s.categoryId}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                    onClick={() => pickCategory(s)}
                  >
                    <p className="text-sm text-slate-900">{s.categoryName}</p>
                    <p className="text-xs text-slate-500">{s.path}</p>
                  </button>
                ))}
              </div>
            )}
            <button className="btn-primary" onClick={() => void saveCategory()} disabled={savingCategory}>
              {savingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingCategory ? 'Saving…' : 'Save category'}
            </button>
          </div>
        </SettingsAccordion>
      </div>
      <ConnectStoreModal open={addStoreOpen} onClose={() => setAddStoreOpen(false)} onConnected={refresh} />
    </>
  )
}

function PolicyDropdown({
  icon: Icon,
  title,
  policies,
  selectedId,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  policies: EbayPolicy[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-brand-600" />
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        {selectedId && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-success-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Selected
          </span>
        )}
      </div>
      {policies.length > 0 ? (
        <select
          className="input"
          value={selectedId}
          onChange={e => onSelect(e.target.value)}
        >
          <option value="">— Select a {title.toLowerCase()} —</option>
          {policies.map(p => (
            <option key={policyId(p)} value={policyId(p)}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-slate-500">No {title.toLowerCase()} found on this eBay account. Create one in eBay Seller Hub first.</p>
      )}
    </div>
  )
}

interface PricingTier {
  id: string
  min: number
  max: number
  profitPct: number
  fixProfit: number
}

const DEFAULT_TIERS: Omit<PricingTier, 'id'>[] = [
  { min: 0, max: 25, profitPct: 27, fixProfit: 0.30 },
  { min: 25, max: 50, profitPct: 25, fixProfit: 0.30 },
  { min: 50, max: 100, profitPct: 23, fixProfit: 0.30 },
  { min: 100, max: 999999, profitPct: 20, fixProfit: 0.30 },
]

const FEE_PRESETS = [
  { label: 'United States', flag: 'US', pct: 13.25, fixed: 0.30 },
  { label: 'Turkey', flag: 'TR', pct: 17.88, fixed: 0.36 },
] as const

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tier-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function PricingSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [pricingEnabled, setPricingEnabled] = useState(true)
  const [tiers, setTiers] = useState<PricingTier[]>([])
  const [eBayFeePct, setEBayFeePct] = useState(13.25)
  const [eBayFixedFee, setEBayFixedFee] = useState(0.30)
  const [exampleSource, setExampleSource] = useState(10)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [activePreset, setActivePreset] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)

    async function loadSettings() {
      const [settingsRes, tiersRes] = await Promise.all([
        supabase.from('pricing_settings').select('*').eq('store_id', activeStore!.id).maybeSingle(),
        supabase.from('pricing_rules').select('*').eq('store_id', activeStore!.id).order('sort_order', { ascending: true }),
      ])
      if (cancelled) return

      if (settingsRes.data) {
        setPricingEnabled(settingsRes.data.pricing_enabled ?? true)
        setEBayFeePct(Number(settingsRes.data.ebay_percentage_fee) || 13.25)
        setEBayFixedFee(Number(settingsRes.data.ebay_fixed_fee) || 0.30)
        setExampleSource(Number(settingsRes.data.example_source_price) || 10)
      } else {
        setPricingEnabled(true)
        setEBayFeePct(13.25)
        setEBayFixedFee(0.30)
        setExampleSource(10)
      }

      if (tiersRes.data && tiersRes.data.length > 0) {
        setTiers(tiersRes.data.map(r => ({
          id: r.id,
          min: Number(r.min_price) || 0,
          max: Number(r.max_price) || 999999,
          profitPct: Number(r.profit_pct) || 20,
          fixProfit: Number(r.fixed_profit) || 0,
        })))
      } else {
        setTiers(DEFAULT_TIERS.map(t => ({ ...t, id: genId() })))
      }

      const matchedPreset = FEE_PRESETS.find(p =>
        Number(p.pct) === Number(settingsRes.data?.ebay_percentage_fee) &&
        Number(p.fixed) === Number(settingsRes.data?.ebay_fixed_fee),
      )
      setActivePreset(matchedPreset ? matchedPreset.label : null)

      setLoading(false)
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function updateTier(id: string, patch: Partial<PricingTier>) {
    setTiers(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...patch } : t)
      const idx = next.findIndex(t => t.id === id)
      if (idx !== -1 && patch.max !== undefined && idx < next.length - 1) {
        next[idx + 1] = { ...next[idx + 1], min: patch.max }
      }
      return next
    })
  }

  function deleteTier(id: string) {
    setTiers(prev => {
      const next = prev.filter(t => t.id !== id)
      for (let i = 1; i < next.length; i++) {
        next[i] = { ...next[i], min: next[i - 1].max }
      }
      return next
    })
  }

  function addTier() {
    setTiers(prev => {
      const lastMax = prev.length > 0 ? prev[prev.length - 1].max : 0
      return [...prev, { id: genId(), min: lastMax, max: 999999, profitPct: 20, fixProfit: 0.30 }]
    })
  }

  function applyPreset(preset: typeof FEE_PRESETS[number]) {
    setEBayFeePct(preset.pct)
    setEBayFixedFee(preset.fixed)
    setActivePreset(preset.label)
  }

  async function persistAll(storeIds: string[]) {
    const now = new Date().toISOString()
    const tierRows = tiers.map((t, i) => ({
      min_price: t.min,
      max_price: t.max,
      profit_pct: t.profitPct,
      fixed_profit: t.fixProfit,
      sort_order: i,
      updated_at: now,
    }))

    for (const sid of storeIds) {
      // Upsert pricing settings
      const { error: settingsErr } = await supabase.from('pricing_settings').upsert({
        store_id: sid,
        pricing_enabled: pricingEnabled,
        ebay_percentage_fee: eBayFeePct,
        ebay_fixed_fee: eBayFixedFee,
        example_source_price: exampleSource,
        updated_at: now,
      }, { onConflict: 'store_id' })
      if (settingsErr) throw new Error(settingsErr.message)

      // Delete existing tiers, then insert fresh set
      const { error: delErr } = await supabase.from('pricing_rules').delete().eq('store_id', sid)
      if (delErr) throw new Error(delErr.message)

      const insertRows = tierRows.map(r => ({ ...r, store_id: sid }))
      const { error: insErr } = await supabase.from('pricing_rules').insert(insertRows)
      if (insErr) throw new Error(insErr.message)
    }
  }

  async function saveSettings(forAllStores = false) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setToast(null)

    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      await persistAll(storeIds)
      setToast({
        type: 'success',
        msg: forAllStores
          ? `Pricing settings saved for all ${storeIds.length} connected stores.`
          : 'Pricing settings saved.',
      })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save pricing settings.' })
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  // Live calculator — uses the shared pricing engine
  const calc = calculateEbayPrice(
    exampleSource,
    tiers.map(t => ({ min: t.min, max: t.max, profitPct: t.profitPct, fixProfit: t.fixProfit })),
    eBayFeePct,
    eBayFixedFee,
    pricingEnabled,
  )

  return (
    <div className="space-y-6">
      {/* Toggle header */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-start gap-3">
            <Toggle checked={pricingEnabled} onChange={setPricingEnabled} />
            <div>
              <p className="text-sm font-medium text-slate-800">
                Pricing enabled {pricingEnabled ? '' : '— off lists at the raw Amazon price, no markup/fees/rounding'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {pricingEnabled
                  ? 'Every imported product is marked up using the ranges and fees below before being listed on eBay.'
                  : 'All markup formulas are bypassed. Items list at exactly the Amazon source price.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Range repricing matrix */}
      <div className={cn('card transition-opacity', !pricingEnabled && 'opacity-50 pointer-events-none')}>
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Range Repricing</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Tiered markup by Amazon source price. Each tier's "From" auto-fills from the previous tier's "To".
          </p>
        </div>
        <div className="card-body space-y-4">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-500">Loading pricing tiers…</div>
          ) : (
            <>
              {/* Header row (desktop) */}
              <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 px-1">
                <label className="label">From ($)</label>
                <label className="label">To ($)</label>
                <label className="label">Profit (%)</label>
                <label className="label">Fix profit ($)</label>
                <span className="w-9" />
              </div>

              {tiers.map((tier, i) => {
                const preview = calculateEbayPrice(
                  tier.min + (tier.max - tier.min) / 2,
                  [{ min: tier.min, max: tier.max, profitPct: tier.profitPct, fixProfit: tier.fixProfit }],
                  eBayFeePct,
                  eBayFixedFee,
                  pricingEnabled,
                )
                const previewCost = tier.min + (tier.max - tier.min) / 2

                return (
                  <div key={tier.id} className="space-y-1">
                    <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end">
                      <div>
                        <label className="label md:hidden">From ($)</label>
                        <input
                          className="input"
                          type="number"
                          value={tier.min}
                          disabled={i === 0}
                          onChange={e => updateTier(tier.id, { min: +e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label md:hidden">To ($)</label>
                        <input
                          className="input"
                          type="number"
                          value={tier.max}
                          onChange={e => updateTier(tier.id, { max: +e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label md:hidden">Profit (%)</label>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          value={tier.profitPct}
                          onChange={e => updateTier(tier.id, { profitPct: +e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label md:hidden">Fix profit ($)</label>
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          value={tier.fixProfit}
                          onChange={e => updateTier(tier.id, { fixProfit: +e.target.value })}
                        />
                      </div>
                      <button
                        onClick={() => deleteTier(tier.id)}
                        disabled={tiers.length <= 1}
                        className="btn-ghost text-error-600 hover:bg-error-50 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Remove range"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 pl-1">
                      ≈ a {formatCurrency(previewCost)} item in this range lists at {formatCurrency(preview.finalPrice)}
                    </p>
                  </div>
                )
              })}
              <button onClick={addTier} className="btn-secondary text-sm">
                <Plus className="w-4 h-4" /> Add range
              </button>
            </>
          )}
        </div>
      </div>

      {/* eBay fees & presets */}
      <div className={cn('card transition-opacity', !pricingEnabled && 'opacity-50 pointer-events-none')}>
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">eBay Fees</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Applied after profit: price = (source + profit) / (1 − fee% × 0.01) + fixed fee.
          </p>
        </div>
        <div className="card-body space-y-5">
          {/* Preset cards */}
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {FEE_PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => applyPreset(preset)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                  activePreset === preset.label
                    ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <span className="text-2xl">{preset.flag === 'US' ? '🇺🇸' : '🇹🇷'}</span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{preset.label}</p>
                  <p className="text-xs text-slate-500">{preset.pct}% + {formatCurrency(preset.fixed)}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Editable inputs */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="label">Percentage fee (%)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={eBayFeePct}
                onChange={e => { setEBayFeePct(+e.target.value); setActivePreset(null) }}
              />
            </div>
            <div>
              <label className="label">Fixed fee ($)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={eBayFixedFee}
                onChange={e => { setEBayFixedFee(+e.target.value); setActivePreset(null) }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Live example calculator */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Live Example</h3>
          <p className="text-xs text-slate-500 mt-0.5">See exactly what these settings produce before saving.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="max-w-xs">
            <label className="label">Amazon source price ($)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={exampleSource}
              onChange={e => setExampleSource(+e.target.value)}
            />
          </div>
          <div className="rounded-xl bg-gradient-to-br from-brand-50 to-slate-50 p-4">
            {pricingEnabled ? (
              <p className="text-sm text-slate-700">
                A <span className="font-semibold text-slate-900">{formatCurrency(exampleSource)}</span> Amazon item would list at{' '}
                <span className="text-lg font-bold text-brand-700">{formatCurrency(calc.finalPrice)}</span> on eBay — about{' '}
                <span className="font-semibold text-success-600">{formatCurrency(calc.profit)}</span> profit before eBay's own cut.
              </p>
            ) : (
              <p className="text-sm text-slate-700">
                Pricing is disabled. A <span className="font-semibold text-slate-900">{formatCurrency(exampleSource)}</span> Amazon item would list at{' '}
                <span className="text-lg font-bold text-slate-700">{formatCurrency(exampleSource)}</span> on eBay — no markup, no fees added.
              </p>
            )}
            {calc.tier && (
              <p className="mt-2 text-xs text-slate-400">
                Matched tier: {formatCurrency(calc.tier.min)}–{formatCurrency(calc.tier.max)} at {calc.tier.profitPct}% + {formatCurrency(calc.tier.fixProfit)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg transition-all',
          toast.type === 'success' ? 'bg-success-600 text-white' : 'bg-error-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void saveSettings(false)} disabled={saving || savingAll || loading}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => void saveSettings(true)}
          disabled={saving || savingAll || loading || connectedStores.length === 0}
        >
          {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {savingAll ? 'Saving…' : 'Save for all stores'}
        </button>
      </div>
    </div>
  )
}

function AvailabilitySection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [defaultQuantity, setDefaultQuantity] = useState(3)
  const [primeFilter, setPrimeFilter] = useState(false)
  const [allowDuplicateAsins, setAllowDuplicateAsins] = useState(false)
  const [allowOutOfStock, setAllowOutOfStock] = useState(true)
  const [autoDelist, setAutoDelist] = useState(false)
  const [delistDays, setDelistDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)

    async function loadSettings() {
      const { data, error: dbErr } = await supabase
        .from('store_availability_settings')
        .select('*')
        .eq('store_id', activeStore!.id)
        .maybeSingle()
      if (cancelled) return
      if (dbErr) { setToast({ type: 'error', msg: 'Failed to load availability settings.' }); setLoading(false); return }
      if (data) {
        setDefaultQuantity(data.default_quantity ?? 3)
        setPrimeFilter(data.prime_filter ?? false)
        setAllowDuplicateAsins(data.allow_duplicate_asins ?? false)
        setAllowOutOfStock(data.allow_out_of_stock ?? true)
        setAutoDelist(data.auto_delist_enabled ?? false)
        setDelistDays(data.days_without_sales ?? 30)
      } else {
        setDefaultQuantity(3)
        setPrimeFilter(false)
        setAllowDuplicateAsins(false)
        setAllowOutOfStock(true)
        setAutoDelist(false)
        setDelistDays(30)
      }
      setLoading(false)
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [activeStore?.id])

  async function persistAll(storeIds: string[]) {
    const now = new Date().toISOString()
    for (const sid of storeIds) {
      const { error: upsertErr } = await supabase.from('store_availability_settings').upsert({
        store_id: sid,
        default_quantity: defaultQuantity,
        prime_filter: primeFilter,
        allow_duplicate_asins: allowDuplicateAsins,
        allow_out_of_stock: allowOutOfStock,
        auto_delist_enabled: autoDelist,
        days_without_sales: delistDays,
        updated_at: now,
      }, { onConflict: 'store_id' })
      if (upsertErr) throw new Error(upsertErr.message)
    }
  }

  async function saveSettings(forAllStores = false) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setToast(null)
    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      await persistAll(storeIds)
      setToast({
        type: 'success',
        msg: forAllStores
          ? `Availability settings saved for all ${storeIds.length} connected stores.`
          : 'Availability settings saved.',
      })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save availability settings.' })
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading availability settings…</div>
  }

  return (
    <div className="space-y-6">
      {/* Availability rules */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Availability Rules</h3>
          <p className="text-xs text-slate-500 mt-0.5">Defaults applied when new items are listed on eBay.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="max-w-xs">
            <label className="label">Quantity in stock (default per listing)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={defaultQuantity}
              onChange={e => setDefaultQuantity(+e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">Sets initial available inventory when listing items on eBay.</p>
          </div>
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={primeFilter} onChange={setPrimeFilter} />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-700">Prime Filter</p>
                <span className="group relative">
                  <HelpCircle className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                  <span className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 w-48 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Only Amazon Prime / FBA items are allowed. Non-Prime or status drops automatically end the listing.
                  </span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Only allow Amazon Prime / FBA items; non-Prime items are skipped or ended.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Cross-store & stock behavior */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Cross-store & Stock Behavior</h3>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={allowDuplicateAsins} onChange={setAllowDuplicateAsins} />
            <div>
              <p className="text-sm font-medium text-slate-700">Allow duplicate ASINs across stores</p>
              <p className="text-xs text-slate-500 mt-0.5">Prevents or allows listing the same ASIN in multiple linked stores.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={allowOutOfStock} onChange={setAllowOutOfStock} />
            <div>
              <p className="text-sm font-medium text-slate-700">Allow out-of-stock listings</p>
              <p className="text-xs text-slate-500 mt-0.5">When Amazon stock drops to 0, sets eBay stock to 0 instead of immediately deleting the listing.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-delist cold products */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Auto-delist Cold Products</h3>
          <p className="text-xs text-slate-500 mt-0.5">Ends a listing automatically once it's gone this many days with zero sales (counted from the listing date if it's never sold).</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={autoDelist} onChange={setAutoDelist} />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-700">Enable</p>
              {autoDelist && (
                <div className="mt-3 max-w-xs">
                  <label className="label">Days with no sale before auto-delist</label>
                  <input className="input" type="number" min={1} value={delistDays} onChange={e => setDelistDays(+e.target.value)} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg transition-all',
          toast.type === 'success' ? 'bg-success-600 text-white' : 'bg-error-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void saveSettings(false)} disabled={saving || savingAll || loading}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => void saveSettings(true)}
          disabled={saving || savingAll || loading || connectedStores.length === 0}
        >
          {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {savingAll ? 'Saving…' : 'Save for all stores'}
        </button>
      </div>
    </div>
  )
}

function PromotedSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [autoPromote, setAutoPromote] = useState(true)
  const [adRate, setAdRate] = useState(2.5)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)

    async function loadSettings() {
      const { data, error: dbErr } = await supabase
        .from('store_promoted_settings')
        .select('*')
        .eq('store_id', activeStore!.id)
        .maybeSingle()
      if (cancelled) return
      if (dbErr) { setToast({ type: 'error', msg: 'Failed to load promoted settings.' }); setLoading(false); return }
      if (data) {
        setAutoPromote(data.auto_promote_enabled ?? true)
        setAdRate(Number(data.default_ad_rate) || 2.5)
      } else {
        setAutoPromote(true)
        setAdRate(2.5)
      }
      setLoading(false)
    }

    void loadSettings()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function clampAdRate(value: number) {
    if (Number.isNaN(value)) return 1
    return Math.min(100, Math.max(1, value))
  }

  async function persistAll(storeIds: string[]) {
    const now = new Date().toISOString()
    for (const sid of storeIds) {
      const { error: upsertErr } = await supabase.from('store_promoted_settings').upsert({
        store_id: sid,
        auto_promote_enabled: autoPromote,
        default_ad_rate: clampAdRate(adRate),
        updated_at: now,
      }, { onConflict: 'store_id' })
      if (upsertErr) throw new Error(upsertErr.message)
    }
  }

  async function saveSettings(forAllStores = false) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setToast(null)
    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      await persistAll(storeIds)
      setToast({
        type: 'success',
        msg: forAllStores
          ? `Promoted settings saved for all ${storeIds.length} connected stores.`
          : 'Promoted settings saved.',
      })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save promoted settings.' })
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading promoted settings…</div>
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Promoted Listings</h3>
          <p className="text-xs text-slate-500 mt-0.5">Automatically adds every new listing to eBay Promoted Listings at your default ad rate — no manual work per listing.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              Whether a listing actually gets a running ad is entirely up to eBay's own Promoted Listings eligibility bar (an established sales history, among other factors it sets, not us). This toggle can't override that — if your store isn't there yet, turning it on has no effect.
            </p>
          </div>

          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={autoPromote} onChange={setAutoPromote} />
            <div>
              <p className="text-sm font-medium text-slate-700">Auto-promote new listings</p>
              <p className="text-xs text-slate-500 mt-0.5">Adds every newly published listing to a Promoted Listings Standard campaign at the default ad rate.</p>
            </div>
          </div>

          {autoPromote && (
            <div className="max-w-xs">
              <label className="label">Default ad rate (%)</label>
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                step="0.1"
                value={adRate}
                onChange={e => setAdRate(clampAdRate(+e.target.value))}
              />
              <p className="text-xs text-slate-400 mt-1">Must be between 1% and 100%.</p>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg transition-all',
          toast.type === 'success' ? 'bg-success-600 text-white' : 'bg-error-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void saveSettings(false)} disabled={saving || savingAll || loading}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => void saveSettings(true)}
          disabled={saving || savingAll || loading || connectedStores.length === 0}
        >
          {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {savingAll ? 'Saving…' : 'Save for all stores'}
        </button>
      </div>
    </div>
  )
}

function VeroSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [removeKeywords, setRemoveKeywords] = useState<string[]>([])
  const [blockKeywords, setBlockKeywords] = useState<string[]>([])
  const [blockAsins, setBlockAsins] = useState<string[]>([])
  const [blockInBrand, setBlockInBrand] = useState(true)
  const [blockInTitle, setBlockInTitle] = useState(true)
  const [blockInDesc, setBlockInDesc] = useState(true)
  const [autoRemoveBrand, setAutoRemoveBrand] = useState(false)
  const [autoReplaceBrand, setAutoReplaceBrand] = useState(false)

  const [removeInput, setRemoveInput] = useState('')
  const [blockInput, setBlockInput] = useState('')
  const [asinInput, setAsinInput] = useState('')
  const [removeSearch, setRemoveSearch] = useState('')
  const [blockSearch, setBlockSearch] = useState('')
  const [asinSearch, setAsinSearch] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)

    async function loadSettings() {
      const { data, error: dbErr } = await supabase
        .from('store_vero_settings')
        .select('*')
        .eq('store_id', activeStore!.id)
        .maybeSingle()
      if (cancelled) return
      if (dbErr) { setToast({ type: 'error', msg: 'Failed to load VeRO settings.' }); setLoading(false); return }
      if (data) {
        setRemoveKeywords(data.remove_keywords || [])
        setBlockKeywords(data.block_keywords || [])
        setBlockAsins(data.block_asins || [])
        setBlockInBrand(data.block_in_brand ?? true)
        setBlockInTitle(data.block_in_title ?? true)
        setBlockInDesc(data.block_in_description ?? true)
        setAutoRemoveBrand(data.auto_remove_brand ?? false)
        setAutoReplaceBrand(data.auto_replace_brand ?? false)
      } else {
        setRemoveKeywords([]); setBlockKeywords([]); setBlockAsins([])
        setBlockInBrand(true); setBlockInTitle(true); setBlockInDesc(true)
        setAutoRemoveBrand(false); setAutoReplaceBrand(false)
      }
      setLoading(false)
    }
    void loadSettings()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function parseInput(raw: string): string[] {
    return raw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => s.toLowerCase())
  }

  function addRemove() {
    const words = parseInput(removeInput)
    if (!words.length) return
    setRemoveKeywords(prev => Array.from(new Set([...prev, ...words])))
    setRemoveInput('')
  }
  function addBlock() {
    const words = parseInput(blockInput)
    if (!words.length) return
    setBlockKeywords(prev => Array.from(new Set([...prev, ...words])))
    setBlockInput('')
  }
  function addAsin() {
    const words = parseInput(asinInput)
    if (!words.length) return
    setBlockAsins(prev => Array.from(new Set([...prev, ...words])))
    setAsinInput('')
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text)
    setToast({ type: 'success', msg: 'Copied to clipboard.' })
  }

  async function persistAll(storeIds: string[]) {
    const now = new Date().toISOString()
    for (const sid of storeIds) {
      const { error: upsertErr } = await supabase.from('store_vero_settings').upsert({
        store_id: sid,
        remove_keywords: removeKeywords,
        block_keywords: blockKeywords,
        block_in_brand: blockInBrand,
        block_in_title: blockInTitle,
        block_in_description: blockInDesc,
        block_asins: blockAsins,
        auto_remove_brand: autoRemoveBrand,
        auto_replace_brand: autoReplaceBrand,
        updated_at: now,
      }, { onConflict: 'store_id' })
      if (upsertErr) throw new Error(upsertErr.message)
    }
  }

  async function saveSettings(forAllStores = false) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setToast(null)
    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      await persistAll(storeIds)
      setToast({
        type: 'success',
        msg: forAllStores
          ? `VeRO settings saved for all ${storeIds.length} connected stores.`
          : 'VeRO settings saved.',
      })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save VeRO settings.' })
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading VeRO settings…</div>
  }

  const filteredRemove = removeKeywords.filter(w => w.includes(removeSearch.toLowerCase()))
  const filteredBlock = blockKeywords.filter(w => w.includes(blockSearch.toLowerCase()))
  const filteredAsins = blockAsins.filter(a => a.includes(asinSearch.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* 1. Remove Keywords */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Remove Keywords</h3>
          <p className="text-xs text-slate-500 mt-0.5">Remove specific keywords from item title &amp; description — doesn't block listing, just strips them.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add word (comma or newline separated for bulk)…"
              value={removeInput}
              onChange={e => setRemoveInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addRemove() }}
            />
            <button className="btn-primary shrink-0" onClick={addRemove}><Plus className="w-4 h-4" /> Add</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search word…"
              value={removeSearch}
              onChange={e => setRemoveSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 min-h-[2.5rem] p-3 bg-slate-50 rounded-lg border border-slate-200">
            {filteredRemove.length === 0 ? (
              <span className="text-xs text-slate-400 self-center">No keywords yet.</span>
            ) : filteredRemove.map(word => (
              <span key={word} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
                {word}
                <button onClick={() => setRemoveKeywords(prev => prev.filter(w => w !== word))} className="text-slate-400 hover:text-error-600">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => copyToClipboard(removeKeywords.join('\n'))} disabled={removeKeywords.length === 0}>
                <Copy className="w-3.5 h-3.5" /> Copy to clipboard
              </button>
              <button className="btn-ghost text-xs" onClick={() => setRemoveKeywords([])} disabled={removeKeywords.length === 0}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
            <span className="text-xs text-slate-500">Total: {removeKeywords.length} words</span>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={autoRemoveBrand} onChange={e => setAutoRemoveBrand(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-700">Auto-remove source's brand name from title &amp; description</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={autoReplaceBrand} onChange={e => setAutoReplaceBrand(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-700">Auto-replace brand with 'Does not apply'</span>
            </label>
          </div>
        </div>
      </div>

      {/* 2. Block by Keyword */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Block by Keyword (VeRO / Copyright Protection)</h3>
          <p className="text-xs text-slate-500 mt-0.5">Blocks items with these keywords during bulk listing / shows a warning in the auto-lister.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={blockInBrand} onChange={e => setBlockInBrand(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-700">When in brand</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={blockInTitle} onChange={e => setBlockInTitle(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-700">When in title</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={blockInDesc} onChange={e => setBlockInDesc(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm text-slate-700">When in description</span>
            </label>
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add word (comma or newline separated for bulk)…"
              value={blockInput}
              onChange={e => setBlockInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addBlock() }}
            />
            <button className="btn-primary shrink-0" onClick={addBlock}><Plus className="w-4 h-4" /> Add</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search word…"
              value={blockSearch}
              onChange={e => setBlockSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 min-h-[3rem] max-h-64 overflow-y-auto p-3 bg-slate-50 rounded-lg border border-slate-200">
            {filteredBlock.length === 0 ? (
              <span className="text-xs text-slate-400 self-center">No blocked keywords yet.</span>
            ) : filteredBlock.map(word => (
              <span key={word} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
                {word}
                <button onClick={() => setBlockKeywords(prev => prev.filter(w => w !== word))} className="text-slate-400 hover:text-error-600">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => copyToClipboard(blockKeywords.join('\n'))} disabled={blockKeywords.length === 0}>
                <Copy className="w-3.5 h-3.5" /> Copy to clipboard
              </button>
              <button className="btn-ghost text-xs" onClick={() => setBlockKeywords([])} disabled={blockKeywords.length === 0}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
            <span className="text-xs text-slate-500">Total: {blockKeywords.length} words</span>
          </div>
        </div>
      </div>

      {/* 3. Block by ASIN */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Block by ASIN</h3>
          <p className="text-xs text-slate-500 mt-0.5">Blocks these specific Amazon products outright, regardless of title/description matches.</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add ASIN (comma or newline separated for bulk)…"
              value={asinInput}
              onChange={e => setAsinInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAsin() }}
            />
            <button className="btn-primary shrink-0" onClick={addAsin}><Plus className="w-4 h-4" /> Add</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search ASIN…"
              value={asinSearch}
              onChange={e => setAsinSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 min-h-[2.5rem] max-h-64 overflow-y-auto p-3 bg-slate-50 rounded-lg border border-slate-200">
            {filteredAsins.length === 0 ? (
              <span className="text-xs text-slate-400 self-center">No blocked ASINs yet.</span>
            ) : filteredAsins.map(asin => (
              <span key={asin} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-mono font-medium text-slate-700 shadow-sm">
                {asin}
                <button onClick={() => setBlockAsins(prev => prev.filter(a => a !== asin))} className="text-slate-400 hover:text-error-600">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => copyToClipboard(blockAsins.join('\n'))} disabled={blockAsins.length === 0}>
                <Copy className="w-3.5 h-3.5" /> Copy to clipboard
              </button>
              <button className="btn-ghost text-xs" onClick={() => setBlockAsins([])} disabled={blockAsins.length === 0}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
            <span className="text-xs text-slate-500">Total: {blockAsins.length} ASINs</span>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg transition-all',
          toast.type === 'success' ? 'bg-success-600 text-white' : 'bg-error-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void saveSettings(false)} disabled={saving || savingAll || loading}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => void saveSettings(true)}
          disabled={saving || savingAll || loading || connectedStores.length === 0}
        >
          {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {savingAll ? 'Saving…' : 'Save for all stores'}
        </button>
      </div>
    </div>
  )
}

function ListingTemplateSection() {
  const [template, setTemplate] = useState(`{{title}}

Welcome to {{store_name}}!

{{#product_description}}
Product Description:
{{product_description}}
{{/product_description}}

{{#feature_bullets}}
• {{.}}
{{/feature_bullets}}

{{#product_details}}
Product Details:
{{.}}
{{/product_details}}

Thank you for shopping with us!`)

  const variables = [
    { name: '{{title}}', desc: 'Listing title' },
    { name: '{{store_name}}', desc: 'Your eBay store name' },
    { name: '{{main_image}}', desc: 'Main product image URL' },
    { name: '{{#product_description}}', desc: 'Product description block' },
    { name: '{{#feature_bullets}}', desc: 'Feature bullets block' },
    { name: '{{#product_details}}', desc: 'Product details block' },
  ]

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Listing Template</h3>
          <p className="text-xs text-slate-500 mt-0.5">Variables you can use:</p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex flex-wrap gap-2">
            {variables.map(v => (
              <button
                key={v.name}
                onClick={() => setTemplate(template + '\n' + v.name)}
                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-mono text-slate-700 transition"
                title={v.desc}
              >
                {v.name}
              </button>
            ))}
          </div>
          <textarea
            className="input min-h-[250px] resize-y font-mono text-sm"
            value={template}
            onChange={e => setTemplate(e.target.value)}
          />
        </div>
      </div>

      {/* Preview */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Preview</h3>
          <p className="text-xs text-slate-500 mt-0.5">Sample data — not a real listing.</p>
        </div>
        <div className="card-body">
          <div className="border border-slate-200 rounded-lg p-4 bg-white prose prose-sm max-w-none">
            <h4 className="font-semibold text-slate-900">Wireless Bluetooth Earbuds Pro Max</h4>
            <p>Welcome to Main Store!</p>
            <p>Product Description:<br />Experience premium sound with these Wireless Bluetooth Earbuds Pro Max.</p>
            <p>• Active Noise Cancelling<br />• 30H Playtime<br />• Wireless Charging Case</p>
            <p>Product Details:<br />Brand: SoundCore · Color: Black · Weight: 50g</p>
            <p>Thank you for shopping with us!</p>
          </div>
        </div>
      </div>

      <button className="btn-primary"><Save className="w-4 h-4" /> Save Template</button>
    </div>
  )
}

type MessageTemplate = {
  id: string
  name: string
  body: string
}

const TEMPLATE_VARIABLES = [
  { token: '{buyer_name}', desc: 'Buyer full name' },
  { token: '{item_title}', desc: 'Item title' },
  { token: '{tracking_number}', desc: 'Tracking number' },
  { token: '{tracking_carrier}', desc: 'Tracking carrier' },
  { token: '{store_name}', desc: 'Your store name' },
  { token: '{order_id}', desc: 'eBay order ID' },
]

const DEFAULT_TEMPLATES: Omit<MessageTemplate, 'id'>[] = [
  { name: 'Thank you for your order!', body: 'Hi {buyer_name}, thank you for your order of {item_title} from {store_name}! We\'re getting it ready to ship.' },
  { name: 'Your order has shipped!', body: 'Hi {buyer_name}, your order has shipped! Tracking: {tracking_carrier} {tracking_number}.' },
  { name: 'Your order has been delivered!', body: 'Hi {buyer_name}, your order of {item_title} has been delivered. Enjoy!' },
  { name: 'We\'d love your feedback!', body: 'Hi {buyer_name}, glad your order arrived! We\'d really appreciate it if you left us feedback on eBay.' },
]

type TriggerKey = 'new_order' | 'tracker_added' | 'order_delivered' | 'feedback_request'

const TRIGGER_LABELS: Record<TriggerKey, string> = {
  new_order: 'New order',
  tracker_added: 'Tracker added',
  order_delivered: 'Order delivered',
  feedback_request: 'Feedback request',
}

function MessagesSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [triggers, setTriggers] = useState<Record<TriggerKey, { enabled: boolean; templateId: string }>>({
    new_order: { enabled: false, templateId: '' },
    tracker_added: { enabled: false, templateId: '' },
    order_delivered: { enabled: false, templateId: '' },
    feedback_request: { enabled: false, templateId: '' },
  })
  const [feedbackDays, setFeedbackDays] = useState(3)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiKey, setAiKey] = useState('')

  const [editing, setEditing] = useState<MessageTemplate | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)

    async function load() {
      const { data: tplData, error: tplErr } = await supabase
        .from('message_templates')
        .select('*')
        .eq('store_id', activeStore!.id)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (tplErr) { setToast({ type: 'error', msg: 'Failed to load templates.' }); setLoading(false); return }

      let tpls: MessageTemplate[] = (tplData || []).map((t: { id: string; name: string; body: string }) => ({ id: t.id, name: t.name, body: t.body }))

      if (tpls.length === 0) {
        const inserts = DEFAULT_TEMPLATES.map(dt => ({ store_id: activeStore!.id, ...dt }))
        const { data: inserted, error: insErr } = await supabase.from('message_templates').insert(inserts).select('*')
        if (cancelled) return
        if (insErr) { setToast({ type: 'error', msg: 'Failed to seed default templates.' }); setLoading(false); return }
        tpls = (inserted || []).map((t: { id: string; name: string; body: string }) => ({ id: t.id, name: t.name, body: t.body }))
      }
      setTemplates(tpls)

      const { data: trigData, error: trigErr } = await supabase
        .from('auto_message_triggers')
        .select('*')
        .eq('store_id', activeStore!.id)
        .maybeSingle()
      if (cancelled) return
      if (trigErr) { setToast({ type: 'error', msg: 'Failed to load triggers.' }); setLoading(false); return }

      if (trigData) {
        setTriggers({
          new_order: { enabled: trigData.new_order_enabled ?? false, templateId: trigData.new_order_template_id ?? '' },
          tracker_added: { enabled: trigData.tracker_added_enabled ?? false, templateId: trigData.tracker_added_template_id ?? '' },
          order_delivered: { enabled: trigData.order_delivered_enabled ?? false, templateId: trigData.order_delivered_template_id ?? '' },
          feedback_request: { enabled: trigData.feedback_request_enabled ?? false, templateId: trigData.feedback_request_template_id ?? '' },
        })
        setFeedbackDays(Number(trigData.feedback_send_after_days) || 3)
        setAiEnabled(trigData.ai_auto_responder_enabled ?? false)
        setAiKey(trigData.ai_provider_api_key ?? '')
      } else {
        setTriggers({
          new_order: { enabled: false, templateId: '' },
          tracker_added: { enabled: false, templateId: '' },
          order_delivered: { enabled: false, templateId: '' },
          feedback_request: { enabled: false, templateId: '' },
        })
        setFeedbackDays(3)
        setAiEnabled(false)
        setAiKey('')
      }
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function startCreate() {
    setIsCreating(true)
    setEditing({ id: '', name: '', body: '' })
  }

  function saveTemplate() {
    if (!editing || !activeStore?.id) return
    const name = editing.name.trim()
    const body = editing.body.trim()
    if (!name || !body) { setToast({ type: 'error', msg: 'Template name and body are required.' }); return }

    async function persist() {
      if (isCreating) {
        const { data, error } = await supabase
          .from('message_templates')
          .insert({ store_id: activeStore!.id, name, body })
          .select('*')
          .single()
        if (error) { setToast({ type: 'error', msg: error.message }); return }
        setTemplates(prev => [...prev, { id: data.id, name: data.name, body: data.body }])
      } else {
        const { error } = await supabase
          .from('message_templates')
          .update({ name, body, updated_at: new Date().toISOString() })
          .eq('id', editing!.id)
        if (error) { setToast({ type: 'error', msg: error.message }); return }
        setTemplates(prev => prev.map(t => t.id === editing!.id ? { ...t, name, body } : t))
      }
      setToast({ type: 'success', msg: 'Template saved.' })
      setEditing(null)
      setIsCreating(false)
    }
    void persist()
  }

  function deleteTemplate(id: string) {
    async function del() {
      const { error } = await supabase.from('message_templates').delete().eq('id', id)
      if (error) { setToast({ type: 'error', msg: error.message }); return }
      setTemplates(prev => prev.filter(t => t.id !== id))
      setTriggers(prev => {
        const next = { ...prev }
        for (const k of Object.keys(next) as TriggerKey[]) {
          if (next[k].templateId === id) next[k] = { ...next[k], templateId: '' }
        }
        return next
      })
      setToast({ type: 'success', msg: 'Template removed.' })
    }
    void del()
  }

  async function persistTriggers(storeIds: string[]) {
    const now = new Date().toISOString()
    for (const sid of storeIds) {
      const payload = {
        store_id: sid,
        new_order_enabled: triggers.new_order.enabled,
        new_order_template_id: triggers.new_order.templateId || null,
        tracker_added_enabled: triggers.tracker_added.enabled,
        tracker_added_template_id: triggers.tracker_added.templateId || null,
        order_delivered_enabled: triggers.order_delivered.enabled,
        order_delivered_template_id: triggers.order_delivered.templateId || null,
        feedback_request_enabled: triggers.feedback_request.enabled,
        feedback_request_template_id: triggers.feedback_request.templateId || null,
        feedback_send_after_days: feedbackDays,
        ai_auto_responder_enabled: aiEnabled,
        ai_provider_api_key: aiKey || null,
        updated_at: now,
      }
      const { error } = await supabase.from('auto_message_triggers').upsert(payload, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
    }
  }

  async function saveTriggers(forAllStores = false) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setToast(null)
    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      await persistTriggers(storeIds)
      setToast({
        type: 'success',
        msg: forAllStores
          ? `Triggers saved for all ${storeIds.length} connected stores.`
          : 'Triggers saved.',
      })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save triggers.' })
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading auto messages…</div>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT PANEL — Templates */}
        <div className="card">
          <div className="card-header flex-row items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-900">Message Templates</h3>
              <p className="text-xs text-slate-500 mt-0.5">Reusable message snippets with dynamic placeholders.</p>
            </div>
            <button className="btn-primary text-sm" onClick={startCreate}>
              <Plus className="w-4 h-4" /> Add Template
            </button>
          </div>
          <div className="card-body space-y-2">
            {templates.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No templates yet.</p>
            ) : templates.map(tpl => (
              <div key={tpl.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{tpl.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{tpl.body}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="btn-ghost text-slate-500 hover:text-brand-600"
                    onClick={() => { setEditing({ ...tpl }); setIsCreating(false) }}
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn-ghost text-slate-500 hover:text-error-600"
                    onClick={() => deleteTemplate(tpl.id)}
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL — Triggers */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-slate-900">Triggers</h3>
            <p className="text-xs text-slate-500 mt-0.5">Automatically send a template when an order event fires.</p>
          </div>
          <div className="card-body space-y-3">
            {(Object.keys(TRIGGER_LABELS) as TriggerKey[]).map(key => (
              <div key={key} className="p-3 bg-slate-50 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Toggle
                      checked={triggers[key].enabled}
                      onChange={v => setTriggers(prev => ({ ...prev, [key]: { ...prev[key], enabled: v } }))}
                    />
                    <span className="text-sm font-medium text-slate-700">{TRIGGER_LABELS[key]}</span>
                    {key === 'order_delivered' && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Soon</span>
                    )}
                  </div>
                </div>
                {triggers[key].enabled && (
                  <select
                    className="input text-sm"
                    value={triggers[key].templateId}
                    onChange={e => setTriggers(prev => ({ ...prev, [key]: { ...prev[key], templateId: e.target.value } }))}
                  >
                    <option value="">— Select a template —</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                {key === 'feedback_request' && triggers[key].enabled && (
                  <div className="max-w-xs">
                    <label className="label">Send after (days)</label>
                    <input
                      type="number"
                      min={0}
                      className="input text-sm"
                      value={feedbackDays}
                      onChange={e => setFeedbackDays(Math.max(0, Number(e.target.value)))}
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <button className="btn-primary" onClick={() => void saveTriggers(false)} disabled={saving || savingAll}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => void saveTriggers(true)}
                disabled={saving || savingAll || connectedStores.length === 0}
              >
                {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {savingAll ? 'Saving…' : 'Save for all stores'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Auto-Responder */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-600" />
            <h3 className="font-semibold text-slate-900">AI Customer Support &amp; Inquiry Auto-Responder</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            When enabled, AI automatically analyzes incoming buyer product questions and responds based on Amazon product specs and store policy.
          </p>
        </div>
        <div className="card-body space-y-4">
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
            <Toggle checked={aiEnabled} onChange={setAiEnabled} />
            <div>
              <p className="text-sm font-medium text-slate-700">Enable AI Auto-Responder for Buyer Messages</p>
              <p className="text-xs text-slate-500 mt-0.5">Intercepts inbound buyer messages and drafts a response using your store context.</p>
            </div>
          </div>
          <div className="max-w-md">
            <label className="label">AI Provider API Key (OpenAI / Anthropic)</label>
            <input
              className="input"
              type="password"
              placeholder="sk-… (optional — disabled for now)"
              value={aiKey}
              onChange={e => setAiKey(e.target.value)}
              disabled
            />
            <p className="text-xs text-slate-400 mt-1">API key field is placeholder only until AI activation is released.</p>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg transition-all',
          toast.type === 'success' ? 'bg-success-600 text-white' : 'bg-error-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* Template editor modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">{isCreating ? 'New Template' : 'Edit Template'}</h3>
              <button className="btn-ghost text-slate-400" onClick={() => { setEditing(null); setIsCreating(false) }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Template name</label>
                <input
                  className="input"
                  placeholder="e.g. Order shipped"
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Message body</label>
                <textarea
                  className="input min-h-[120px] resize-y text-sm"
                  placeholder="Hi {buyer_name}, …"
                  value={editing.body}
                  onChange={e => setEditing({ ...editing, body: e.target.value })}
                />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Available placeholders:</p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_VARIABLES.map(v => (
                    <button
                      key={v.token}
                      type="button"
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-mono text-slate-700 transition-colors"
                      title={v.desc}
                      onClick={() => setEditing(prev => prev ? { ...prev, body: prev.body + ' ' + v.token } : prev)}
                    >
                      {v.token}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
              <button className="btn-secondary" onClick={() => { setEditing(null); setIsCreating(false) }}>Cancel</button>
              <button className="btn-primary" onClick={() => void saveTemplate()}>
                <Save className="w-4 h-4" /> Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SHIPPING_RANGES = ['0-2 days', '3-7 days'] as const
const RATING_OPTIONS = [3.0, 3.5, 4.0, 4.5, 5.0]

type FilterSettings = {
  shipping_time_ranges: string[]
  min_rating: number
  min_review_count: number
  fba_only: boolean
  apply_tax: boolean
}

function AmazonFiltersSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const [activeTab, setActiveTab] = useState<'amazon' | 'walmart' | 'aliexpress'>('amazon')
  const [shippingRanges, setShippingRanges] = useState<string[]>([])
  const [minRating, setMinRating] = useState(4.0)
  const [minReviewCount, setMinReviewCount] = useState(1)
  const [fbaOnly, setFbaOnly] = useState(false)
  const [applyTax, setApplyTax] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    setMessage(null)
    setError(null)

    async function load() {
      const { data, error: dbErr } = await supabase
        .from('filter_settings')
        .select('*')
        .eq('store_id', activeStore!.id)
        .maybeSingle()
      if (cancelled) return
      if (dbErr) { setError('Failed to load filter settings.'); setLoading(false); return }
      if (data) {
        setShippingRanges(data.shipping_time_ranges || [])
        setMinRating(Number(data.min_rating) || 4.0)
        setMinReviewCount(Number(data.min_review_count) || 1)
        setFbaOnly(data.fba_only ?? false)
        setApplyTax(data.apply_tax ?? false)
      } else {
        setShippingRanges([])
        setMinRating(4.0)
        setMinReviewCount(1)
        setFbaOnly(false)
        setApplyTax(false)
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function toggleRange(range: string) {
    setShippingRanges(prev =>
      prev.includes(range) ? prev.filter(r => r !== range) : [...prev, range]
    )
  }

  async function saveFilters(forAllStores: boolean) {
    if (!activeStore?.id) return
    if (forAllStores) setSavingAll(true); else setSaving(true)
    setMessage(null)
    setError(null)

    const payload = {
      shipping_time_ranges: shippingRanges,
      min_rating: minRating,
      min_review_count: minReviewCount,
      fba_only: fbaOnly,
      apply_tax: applyTax,
      updated_at: new Date().toISOString(),
    }

    try {
      const storeIds = forAllStores ? connectedStores.map(s => s.id) : [activeStore.id]
      for (const sid of storeIds) {
        const { data: existing } = await supabase
          .from('filter_settings')
          .select('id')
          .eq('store_id', sid)
          .maybeSingle()
        if (existing) {
          const { error: uErr } = await supabase
            .from('filter_settings')
            .update(payload)
            .eq('store_id', sid)
          if (uErr) throw new Error(uErr.message)
        } else {
          const { error: iErr } = await supabase
            .from('filter_settings')
            .insert({ store_id: sid, ...payload })
          if (iErr) throw new Error(iErr.message)
        }
      }
      setMessage(forAllStores
        ? `Filters applied to all ${storeIds.length} connected stores.`
        : 'Filters saved for this store.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save filters.')
    } finally {
      if (forAllStores) setSavingAll(false); else setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Source sub-tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('amazon')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'amazon'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50',
          )}
        >Amazon</button>
        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-400 bg-slate-100 cursor-not-allowed">
          Walmart
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">Soon</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-400 bg-slate-100 cursor-not-allowed">
          AliExpress
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">Soon</span>
        </span>
      </div>

      {/* Amazon filter card */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-brand-600" />
            <h3 className="font-semibold text-slate-900">Amazon Filters</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeStore?.ebayUsername || activeStore?.nickname || 'No store'}
            — These filters apply when sourcing products from Amazon.
          </p>
        </div>
        <div className="card-body space-y-5">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-500">Loading filter settings…</div>
          ) : (
            <>
              {/* Product Shipping Time */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  Product Shipping Time
                </label>
                <div className="relative mt-1">
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(o => !o)}
                    className="input flex items-center justify-between text-left"
                  >
                    <span className={cn(shippingRanges.length === 0 && 'text-slate-400')}>
                      {shippingRanges.length === 0
                        ? 'Select shipping times'
                        : shippingRanges.length === 1
                          ? shippingRanges[0]
                          : `${shippingRanges.length} ranges selected`}
                    </span>
                    <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', dropdownOpen && 'rotate-180')} />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                      {SHIPPING_RANGES.map(range => (
                        <label
                          key={range}
                          className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={shippingRanges.includes(range)}
                            onChange={() => toggleRange(range)}
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span className="text-slate-700">{range}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Minimum Product Rating */}
              <div className="max-w-xs">
                <label className="label flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-slate-400" />
                  Minimum Product Rating
                </label>
                <select
                  className="input mt-1"
                  value={minRating}
                  onChange={e => setMinRating(Number(e.target.value))}
                >
                  {RATING_OPTIONS.map(r => (
                    <option key={r} value={r}>{r.toFixed(1)} ★</option>
                  ))}
                </select>
              </div>

              {/* Minimum Review Count */}
              <div className="max-w-xs">
                <label className="label flex items-center gap-1.5">
                  <MessageSquareText className="h-3.5 w-3.5 text-slate-400" />
                  Product Minimum Review Count
                </label>
                <input
                  type="number"
                  min={0}
                  className="input mt-1"
                  value={minReviewCount}
                  onChange={e => setMinReviewCount(Math.max(0, Number(e.target.value)))}
                />
              </div>

              {/* FBA Only */}
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <Toggle checked={fbaOnly} onChange={setFbaOnly} />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-700">Accept Only Fulfilled By Amazon Offers</p>
                    <span className="group relative inline-flex">
                      <HelpCircle className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                      <span className="pointer-events-none absolute left-5 top-0 z-10 w-56 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        When enabled, only Prime / FBA seller offers are accepted. Non-FBA offers are filtered out during product sourcing.
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Ignores seller offers that are not Prime or Fulfilled by Amazon.</p>
                </div>
              </div>

              {/* Apply Tax */}
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <Toggle checked={applyTax} onChange={setApplyTax} />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-700">Apply Tax to Profit Calculations</p>
                    <span className="group relative inline-flex">
                      <HelpCircle className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                      <span className="pointer-events-none absolute left-5 top-0 z-10 w-56 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                        When enabled, estimated sales tax is included in cost calculations when computing profit margins.
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Includes estimated sales tax in cost calculations.</p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  className="btn-primary"
                  onClick={() => void saveFilters(false)}
                  disabled={saving || savingAll}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => void saveFilters(true)}
                  disabled={saving || savingAll || connectedStores.length === 0}
                >
                  {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {savingAll ? 'Saving…' : 'Save for all stores'}
                </button>
                {message && <span className="flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="h-4 w-4" /> {message}</span>}
                {error && <span className="flex items-center gap-1 text-sm text-error-600"><AlertCircle className="h-4 w-4" /> {error}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TeamSection() {
  const [inviteEmail, setInviteEmail] = useState('')

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-slate-900">Invite a Team Member</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            A VA can list, edit listings, message buyers, and add tracking — they can't see billing, connect/disconnect stores, or business-policy settings.
          </p>
        </div>
        <div className="card-body">
          <div className="flex gap-3 max-w-md">
            <div className="relative flex-1">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input pl-9"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="va@example.com"
              />
            </div>
            <button className="btn-primary"><Plus className="w-4 h-4" /> Invite</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Team Members</h3></div>
        <div className="divide-y divide-slate-100">
          {teamMembers.map(member => (
            <div key={member.id} className="flex items-center gap-4 p-4">
              <div className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center font-semibold">
                {member.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{member.name}</p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
              <span className={cn('badge', member.role === 'owner' ? 'badge-info' : 'badge-neutral')}>
                {member.role.toUpperCase()}
              </span>
              <span className="text-xs text-slate-400">Joined {formatDate(member.joinedDate)}</span>
              {member.role !== 'owner' && (
                <button className="btn-ghost text-error-600 hover:bg-error-50"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-slate-900">Team Access</h3></div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {['List items', 'Edit listings', 'Message buyers', 'Add tracking', 'View orders', 'View profit'].map(perm => (
              <div key={perm} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-success-500" />
                <span className="text-slate-700">{perm}</span>
              </div>
            ))}
            {['Billing', 'Connect/disconnect stores', 'Business policy settings'].map(perm => (
              <div key={perm} className="flex items-center gap-2 p-2 bg-error-50 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-error-500" />
                <span className="text-slate-700">{perm}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
