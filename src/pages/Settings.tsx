import { useEffect, useState, useRef } from 'react'
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
import { formatCurrency, formatDate, cn, calculateEbayPrice, renderListingTemplate, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE } from '../lib/utils'
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

const FEE_PRESETS: Record<string, { pct: number; fixed: number; label: string }> = {
  US: { pct: 13.25, fixed: 0.30, label: 'United States' },
  GB: { pct: 12.8, fixed: 0.30, label: 'United Kingdom' },
  DE: { pct: 12.5, fixed: 0.35, label: 'Germany' },
}

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

type PricingTierRow = { id: string; min: string; max: string; profitPct: string; fixProfit: string }

function PricingSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [pricingEnabled, setPricingEnabled] = useState(true)
  const [pctFee, setPctFee] = useState('13.25')
  const [fixedFee, setFixedFee] = useState('0.30')
  const [tiers, setTiers] = useState<PricingTierRow[]>([
    { id: genId(), min: '0', max: '25', profitPct: '30', fixProfit: '0' },
    { id: genId(), min: '25', max: '100', profitPct: '20', fixProfit: '0' },
    { id: genId(), min: '100', max: '999999', profitPct: '15', fixProfit: '0' },
  ])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const [settingsRes, tiersRes] = await Promise.all([
        supabase.from('pricing_settings').select('*').eq('store_id', activeStore!.id).maybeSingle(),
        supabase.from('pricing_rules').select('*').eq('store_id', activeStore!.id).order('sort_order', { ascending: true }),
      ])
      if (cancelled) return
      if (settingsRes.data) {
        setPricingEnabled(settingsRes.data.pricing_enabled ?? true)
        setPctFee(String(settingsRes.data.ebay_percentage_fee ?? '13.25'))
        setFixedFee(String(settingsRes.data.ebay_fixed_fee ?? '0.30'))
      }
      if (tiersRes.data && tiersRes.data.length > 0) {
        setTiers(tiersRes.data.map(t => ({
          id: t.id,
          min: String(t.min_price),
          max: String(t.max_price),
          profitPct: String(t.profit_pct),
          fixProfit: String(t.fixed_profit),
        })))
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function applyPreset(code: string) {
    const preset = FEE_PRESETS[code]
    if (!preset) return
    setPctFee(String(preset.pct))
    setFixedFee(String(preset.fixed))
  }

  function addTier() {
    setTiers(prev => [...prev, { id: genId(), min: '0', max: '0', profitPct: '20', fixProfit: '0' }])
  }
  function removeTier(id: string) {
    setTiers(prev => prev.filter(t => t.id !== id))
  }
  function updateTier(id: string, field: keyof PricingTierRow, value: string) {
    setTiers(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  async function saveAll() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const { error: settingsErr } = await supabase.from('pricing_settings').upsert({
        store_id: activeStore.id,
        pricing_enabled: pricingEnabled,
        ebay_percentage_fee: Number(pctFee) || 0,
        ebay_fixed_fee: Number(fixedFee) || 0,
      }, { onConflict: 'store_id' })
      if (settingsErr) throw new Error(settingsErr.message)

      await supabase.from('pricing_rules').delete().eq('store_id', activeStore.id)
      if (tiers.length > 0) {
        const { error: tiersErr } = await supabase.from('pricing_rules').insert(
          tiers.map((t, idx) => ({
            store_id: activeStore.id,
            min_price: Number(t.min) || 0,
            max_price: Number(t.max) || 0,
            profit_pct: Number(t.profitPct) || 0,
            fixed_profit: Number(t.fixProfit) || 0,
            sort_order: idx,
          }))
        )
        if (tiersErr) throw new Error(tiersErr.message)
      }
      setMessage('Pricing rules saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing rules')
    } finally {
      setSaving(false)
    }
  }

  const previewPrice = tiers.length > 0 ? (() => {
    const sample = 50
    const mapped = tiers.map(t => ({ min: Number(t.min) || 0, max: Number(t.max) || 0, profitPct: Number(t.profitPct) || 0, fixProfit: Number(t.fixProfit) || 0 }))
    return calculateEbayPrice(sample, mapped, Number(pctFee) || 0, Number(fixedFee) || 0, pricingEnabled)
  })() : null

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading pricing…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Enable automatic pricing</p>
          <p className="text-xs text-slate-500">When off, eBay price defaults to the Amazon price with no markup.</p>
        </div>
        <Toggle checked={pricingEnabled} onChange={setPricingEnabled} />
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-900 mb-2">eBay Fees</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {Object.entries(FEE_PRESETS).map(([code, preset]) => (
            <button key={code} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50" onClick={() => applyPreset(code)}>
              {preset.label} — {preset.pct}% + {formatCurrency(preset.fixed)}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3">
          <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">Percentage fee is eBay's own cut of the sale — double-check you're editing the right box below, not the profit margin tiers.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">Percentage fee (%)
            <input className="input mt-1" value={pctFee} onChange={e => setPctFee(e.target.value)} />
          </label>
          <label className="label">Fixed fee ($)
            <input className="input mt-1" value={fixedFee} onChange={e => setFixedFee(e.target.value)} />
          </label>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-slate-900">Profit margin tiers</p>
          <button className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1" onClick={addTier}>
            <Plus className="h-3.5 w-3.5" /> Add tier
          </button>
        </div>
        <div className="space-y-2">
          {tiers.map(t => (
            <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center">
              <input className="input text-sm" placeholder="Min $" value={t.min} onChange={e => updateTier(t.id, 'min', e.target.value)} />
              <input className="input text-sm" placeholder="Max $" value={t.max} onChange={e => updateTier(t.id, 'max', e.target.value)} />
              <input className="input text-sm" placeholder="Profit %" value={t.profitPct} onChange={e => updateTier(t.id, 'profitPct', e.target.value)} />
              <input className="input text-sm" placeholder="Fixed +$" value={t.fixProfit} onChange={e => updateTier(t.id, 'fixProfit', e.target.value)} />
              <button onClick={() => removeTier(t.id)} className="text-slate-300 hover:text-error-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>

      {previewPrice && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
          <p className="text-slate-500 text-xs mb-1">Preview: a $50.00 Amazon item becomes</p>
          <p className="font-semibold text-slate-900">{formatCurrency(previewPrice.finalPrice)} on eBay</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void saveAll()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
        {message && <span className="flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="h-4 w-4" /> {message}</span>}
        {error && <span className="text-sm text-error-600">{error}</span>}
      </div>
    </div>
  )
}

function AvailabilitySection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [defaultQuantity, setDefaultQuantity] = useState('1')
  const [primeFilter, setPrimeFilter] = useState(false)
  const [allowOutOfStock, setAllowOutOfStock] = useState(true)
  const [allowDuplicateAsins, setAllowDuplicateAsins] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data } = await supabase.from('store_availability_settings').select('*').eq('store_id', activeStore!.id).maybeSingle()
      if (cancelled) return
      if (data) {
        setDefaultQuantity(String(data.default_quantity ?? '1'))
        setPrimeFilter(!!data.prime_filter)
        setAllowOutOfStock(data.allow_out_of_stock ?? true)
        setAllowDuplicateAsins(data.allow_duplicate_asins ?? true)
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  async function save() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('store_availability_settings').upsert({
        store_id: activeStore.id,
        default_quantity: Number(defaultQuantity) || 1,
        prime_filter: primeFilter,
        allow_out_of_stock: allowOutOfStock,
        allow_duplicate_asins: allowDuplicateAsins,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setMessage('Availability settings saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-5">
      <label className="label">Default quantity for new listings
        <input className="input mt-1 max-w-xs" value={defaultQuantity} onChange={e => setDefaultQuantity(e.target.value)} />
      </label>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Prime filter</p>
          <p className="text-xs text-slate-500">Only list products that are Prime/Fulfilled-by-Amazon.</p>
        </div>
        <Toggle checked={primeFilter} onChange={setPrimeFilter} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Allow out-of-stock listings</p>
          <p className="text-xs text-slate-500">When off, an out-of-stock product is skipped entirely instead of being added at 0 quantity.</p>
        </div>
        <Toggle checked={allowOutOfStock} onChange={setAllowOutOfStock} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Allow duplicate ASINs</p>
          <p className="text-xs text-slate-500">When off, the same ASIN can't be added twice to this store.</p>
        </div>
        <Toggle checked={allowDuplicateAsins} onChange={setAllowDuplicateAsins} />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-sm text-success-600">{message}</span>}
      </div>
    </div>
  )
}

function PromotedSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [autoPromote, setAutoPromote] = useState(false)
  const [adRate, setAdRate] = useState('3')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data } = await supabase.from('store_promoted_settings').select('*').eq('store_id', activeStore!.id).maybeSingle()
      if (cancelled) return
      if (data) {
        setAutoPromote(data.auto_promote_enabled ?? false)
        setAdRate(String(data.default_ad_rate ?? '3'))
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  async function save() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('store_promoted_settings').upsert({
        store_id: activeStore.id,
        auto_promote_enabled: autoPromote,
        default_ad_rate: Number(adRate) || 3,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setMessage('Promoted Listings settings saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Auto-promote new listings</p>
          <p className="text-xs text-slate-500">Every new listing is automatically added to your eBay ad campaign.</p>
        </div>
        <Toggle checked={autoPromote} onChange={setAutoPromote} />
      </div>
      <label className="label">Default ad rate (%)
        <input className="input mt-1 max-w-xs" value={adRate} onChange={e => setAdRate(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-sm text-success-600">{message}</span>}
      </div>
    </div>
  )
}

function VeroSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [keywords, setKeywords] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data } = await supabase.from('store_vero_settings').select('block_keywords').eq('store_id', activeStore!.id).maybeSingle()
      if (cancelled) return
      setKeywords((data?.block_keywords as string[]) || [])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function addKeyword() {
    const trimmed = newKeyword.trim()
    if (!trimmed || keywords.includes(trimmed)) return
    setKeywords(prev => [...prev, trimmed])
    setNewKeyword('')
  }
  function removeKeyword(kw: string) {
    setKeywords(prev => prev.filter(k => k !== kw))
  }

  async function save() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('store_vero_settings').upsert({
        store_id: activeStore.id,
        block_keywords: keywords,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setMessage('VeRO keyword list saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Products whose title, description, or specifics contain any of these words are blocked from listing. Amazon/AmazonBasics/Prime/Fulfilled-by-Amazon are always blocked, even if not listed here.</p>
      <div className="flex flex-wrap gap-2">
        {keywords.map(kw => (
          <span key={kw} className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs text-red-700">
            {kw}
            <button onClick={() => removeKeyword(kw)}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {keywords.length === 0 && <p className="text-xs text-slate-400">No custom blocked words yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addKeyword() }}
          placeholder="Add a word or brand to block"
        />
        <button className="btn-secondary shrink-0" onClick={addKeyword}><Plus className="h-4 w-4" /> Add</button>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save list'}
        </button>
        {message && <span className="text-sm text-success-600">{message}</span>}
      </div>
    </div>
  )
}

// ---- Listing Templates: multiple named templates per store, one marked active ----
// "Active" is what every new listing (Single tab fetch, Bulk run) actually uses to build its
// description — enforced by useData.ts / ListItems.tsx filtering on is_active=true when they
// load the template. Saving a template here never touches which one is active; that's a
// separate, explicit action so switching designs is never accidental.
type TemplateRow = { id: string; name: string; template: string; is_active: boolean }

function ListingTemplateSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]
  const activeStoreName = activeStore?.ebayUsername || activeStore?.nickname || 'Our Store'

  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selectedId, setSelectedId] = useState<string | 'new'>('new')
  const [draftName, setDraftName] = useState('Template 1')
  const [draftTemplate, setDraftTemplate] = useState(DEFAULT_LISTING_TEMPLATE)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [settingActiveId, setSettingActiveId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [fullView, setFullView] = useState(false)
  const gutterRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const variables = [
    { name: '{{title}}', desc: 'Product title' },
    { name: '{{store_name}}', desc: 'Your store name' },
    { name: '{{#main_image}}...{{/main_image}}', desc: 'Main product photo' },
    { name: '{{#gallery}}...{{/gallery}}', desc: 'Extra product photos (loop)' },
    { name: '{{#product_description}}...{{/product_description}}', desc: 'Description text' },
    { name: '{{#feature_bullets}}...{{/feature_bullets}}', desc: 'Feature bullet list (loop)' },
  ]

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data, error } = await supabase
        .from('listing_templates')
        .select('id, name, template, is_active')
        .eq('store_id', activeStore!.id)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) {
        setToast({ type: 'error', msg: 'Failed to load your templates.' })
        setLoading(false)
        return
      }
      const rows = (data || []) as TemplateRow[]
      setTemplates(rows)
      if (rows.length > 0) {
        const active = rows.find(r => r.is_active) || rows[0]
        setSelectedId(active.id)
        setDraftName(active.name)
        setDraftTemplate(active.template)
      } else {
        setSelectedId('new')
        setDraftName('Template 1')
        setDraftTemplate(DEFAULT_LISTING_TEMPLATE)
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function selectTemplate(row: TemplateRow) {
    setSelectedId(row.id)
    setDraftName(row.name)
    setDraftTemplate(row.template)
  }

  function handleDropdownChange(value: string) {
    if (value === 'new') {
      startNewTemplate()
      return
    }
    const row = templates.find(t => t.id === value)
    if (row) selectTemplate(row)
  }

  function startNewTemplate() {
    setSelectedId('new')
    setDraftName(`Template ${templates.length + 1}`)
    setDraftTemplate(DEFAULT_LISTING_TEMPLATE)
  }

  function insertVariable(token: string) {
    setDraftTemplate(prev => `${prev}\n${token}`)
  }

  async function saveTemplate() {
    if (!activeStore?.id) return
    setSaving(true)
    setToast(null)
    try {
      if (selectedId === 'new') {
        // The very first template for a store becomes active automatically — every store
        // needs exactly one active template to actually list anything, so a brand-new store
        // shouldn't be left with zero.
        const makeActive = templates.length === 0
        const { data, error } = await supabase
          .from('listing_templates')
          .insert({
            store_id: activeStore.id,
            name: draftName.trim() || `Template ${templates.length + 1}`,
            template: draftTemplate,
            is_active: makeActive,
          })
          .select('id, name, template, is_active')
          .single()
        if (error) throw new Error(error.message)
        const row = data as TemplateRow
        setTemplates(prev => [...prev, row])
        setSelectedId(row.id)
      } else {
        const { error } = await supabase
          .from('listing_templates')
          .update({
            name: draftName.trim() || 'Untitled',
            template: draftTemplate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedId)
        if (error) throw new Error(error.message)
        setTemplates(prev => prev.map(t => t.id === selectedId ? { ...t, name: draftName.trim() || 'Untitled', template: draftTemplate } : t))
      }
      setToast({ type: 'success', msg: 'Template saved.' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save template.' })
    } finally {
      setSaving(false)
    }
  }

  // Pushes the CURRENTLY EDITED template's content to every other connected store: if that
  // store already has an active template, its content is overwritten (its own name is left
  // untouched); if the store has no templates at all yet, a new one is created for it, named
  // and set active immediately so that store always ends up with a usable active template too.
  async function copyToAllStores() {
    if (!activeStore?.id) return
    const others = connectedStores.filter(s => s.id !== activeStore.id)
    if (others.length === 0) {
      setToast({ type: 'error', msg: 'No other connected stores to copy to.' })
      return
    }
    setCopying(true)
    setToast(null)
    try {
      for (const store of others) {
        const { data: existingActive } = await supabase
          .from('listing_templates')
          .select('id')
          .eq('store_id', store.id)
          .eq('is_active', true)
          .maybeSingle()
        if (existingActive?.id) {
          const { error } = await supabase
            .from('listing_templates')
            .update({ template: draftTemplate, updated_at: new Date().toISOString() })
            .eq('id', existingActive.id)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase
            .from('listing_templates')
            .insert({ store_id: store.id, name: draftName.trim() || 'Template 1', template: draftTemplate, is_active: true })
          if (error) throw new Error(error.message)
        }
      }
      setToast({ type: 'success', msg: `Copied to ${others.length} other store${others.length === 1 ? '' : 's'} as their active template.` })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to copy to other stores.' })
    } finally {
      setCopying(false)
    }
  }

  async function setActive(id: string) {
    if (!activeStore?.id) return
    setSettingActiveId(id)
    setToast(null)
    try {
      const { error: offErr } = await supabase.from('listing_templates').update({ is_active: false }).eq('store_id', activeStore.id)
      if (offErr) throw new Error(offErr.message)
      const { error: onErr } = await supabase.from('listing_templates').update({ is_active: true }).eq('id', id)
      if (onErr) throw new Error(onErr.message)
      setTemplates(prev => prev.map(t => ({ ...t, is_active: t.id === id })))
      setToast({ type: 'success', msg: 'Active template updated — every new listing from now on uses it.' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to set active template.' })
    } finally {
      setSettingActiveId(null)
    }
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm('Delete this template? This cannot be undone.')) return
    setDeletingId(id)
    setToast(null)
    try {
      const { error } = await supabase.from('listing_templates').delete().eq('id', id)
      if (error) throw new Error(error.message)
      const remaining = templates.filter(t => t.id !== id)
      setTemplates(remaining)
      if (selectedId === id) {
        if (remaining.length > 0) {
          selectTemplate(remaining.find(t => t.is_active) || remaining[0])
        } else {
          startNewTemplate()
        }
      }
      setToast({ type: 'success', msg: 'Template deleted.' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to delete template.' })
    } finally {
      setDeletingId(null)
    }
  }

  const isNew = selectedId === 'new'
  const currentIsActive = !isNew && !!templates.find(t => t.id === selectedId)?.is_active
  const lineCount = draftTemplate.split('\n').length

  function syncGutterScroll() {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  const previewHtml = fitDescriptionToBudget(draftTemplate, {
    title: 'Wireless Bluetooth Earbuds Pro Max',
    store_name: activeStoreName,
    main_image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500',
    gallery: [
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200',
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200',
      'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200',
    ],
    product_description: 'Experience premium sound with these Wireless Bluetooth Earbuds Pro Max, featuring industry-leading noise cancellation and a comfortable, secure fit for all-day wear.',
    feature_bullets: ['Active Noise Cancelling', '30-Hour Playtime', 'Wireless Charging Case', 'IPX5 Water Resistant'],
  })

  if (connectedStores.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-500">Connect an eBay store first to set up listing templates.</div>
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="font-semibold text-slate-900">Listing template</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            For <span className="font-medium text-slate-700">{activeStoreName}</span>. The template marked Active is what every new listing uses automatically.
          </p>
        </div>
      </div>
      <div className="card-body space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="input flex-1 min-w-[220px] max-w-sm"
            value={selectedId}
            onChange={e => handleDropdownChange(e.target.value)}
          >
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.is_active ? ' (Active)' : ''}</option>
            ))}
            <option value="new">+ New template…</option>
          </select>
          {!isNew && !currentIsActive && (
            <button onClick={() => void setActive(selectedId as string)} className="btn-secondary text-sm">
              {settingActiveId === selectedId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Set as active
            </button>
          )}
          {currentIsActive && (
            <span className="inline-flex items-center gap-1 text-xs text-success-700 bg-success-50 px-2.5 py-1.5 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" /> Active
            </span>
          )}
          <button onClick={() => setDraftTemplate(DEFAULT_LISTING_TEMPLATE)} className="btn-ghost text-sm text-slate-500">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
          {!isNew && (
            <button onClick={() => void deleteTemplate(selectedId as string)} className="btn-ghost text-sm text-error-600" disabled={deletingId === selectedId}>
              {deletingId === selectedId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        <input
          className="input"
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="Template name"
        />

        <div className={cn('grid gap-4', fullView ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
          {(!fullView || fullView) && (
            <div className={cn(fullView && 'hidden lg:block')}>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Listing template</p>
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <div
                  ref={gutterRef}
                  className="bg-slate-50 text-right text-[11px] leading-5 font-mono text-slate-400 py-2 px-2 select-none overflow-hidden shrink-0"
                  style={{ height: 320 }}
                >
                  {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
                </div>
                <textarea
                  ref={textareaRef}
                  className="flex-1 font-mono text-[11px] leading-5 p-2 outline-none resize-none"
                  style={{ height: 320 }}
                  value={draftTemplate}
                  onChange={e => setDraftTemplate(e.target.value)}
                  onScroll={syncGutterScroll}
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-500">Preview</p>
              <button onClick={() => setFullView(v => !v)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                {fullView ? 'Split view' : 'Full view'}
              </button>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 bg-white overflow-auto" style={{ height: 320 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5">Variables you can use:</p>
          <ul className="text-xs text-slate-500 space-y-1">
            {variables.map(v => (
              <li key={v.name}><code className="font-mono text-slate-700 bg-slate-100 px-1 rounded">{v.name}</code> — {v.desc}</li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button className="btn-primary" onClick={() => void saveTemplate()} disabled={saving || loading}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : isNew ? 'Save as new template' : 'Save'}
          </button>
          <button className="text-sm text-brand-600 hover:text-brand-700 font-medium" onClick={() => void copyToAllStores()} disabled={copying || connectedStores.length < 2}>
            {copying ? 'Copying…' : 'Copy to all stores'}
          </button>
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
    </div>
  )
}

const MESSAGE_TRIGGERS = [
  { id: 'order_placed', label: 'Order placed', icon: Package },
  { id: 'order_shipped', label: 'Order shipped', icon: Truck },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle2 },
  { id: 'feedback_request', label: 'Feedback request', icon: Star },
]

function MessagesSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [messages, setMessages] = useState<Record<string, { enabled: boolean; text: string }>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data } = await supabase.from('store_auto_messages').select('*').eq('store_id', activeStore!.id)
      if (cancelled) return
      const map: Record<string, { enabled: boolean; text: string }> = {}
      for (const trigger of MESSAGE_TRIGGERS) {
        const row = data?.find(r => r.trigger === trigger.id)
        map[trigger.id] = { enabled: row?.enabled ?? false, text: row?.message_text ?? '' }
      }
      setMessages(map)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  async function save() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    try {
      for (const trigger of MESSAGE_TRIGGERS) {
        const row = messages[trigger.id]
        const { error } = await supabase.from('store_auto_messages').upsert({
          store_id: activeStore.id,
          trigger: trigger.id,
          enabled: row?.enabled ?? false,
          message_text: row?.text ?? '',
        }, { onConflict: 'store_id,trigger' })
        if (error) throw new Error(error.message)
      }
      setMessage('Auto messages saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-3">
      {MESSAGE_TRIGGERS.map(trigger => (
        <SettingsAccordion key={trigger.id} title={trigger.label}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <trigger.icon className="h-4 w-4 text-brand-600" />
                <p className="text-sm font-medium text-slate-900">Send automatically</p>
              </div>
              <Toggle
                checked={messages[trigger.id]?.enabled ?? false}
                onChange={v => setMessages(prev => ({ ...prev, [trigger.id]: { enabled: v, text: prev[trigger.id]?.text ?? '' } }))}
              />
            </div>
            <textarea
              className="input min-h-[100px]"
              value={messages[trigger.id]?.text ?? ''}
              onChange={e => setMessages(prev => ({ ...prev, [trigger.id]: { enabled: prev[trigger.id]?.enabled ?? false, text: e.target.value } }))}
              placeholder="Message text — use {{buyer_name}}, {{item_title}}, {{tracking_number}}"
            />
          </div>
        </SettingsAccordion>
      ))}
      <div className="flex items-center gap-3 pt-2">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save all messages'}
        </button>
        {message && <span className="text-sm text-success-600">{message}</span>}
      </div>
    </div>
  )
}

const SHIPPING_RANGES = ['0-2 days', '3-7 days', '8-13 days', '14 or more days']

function AmazonFiltersSection() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]

  const [minRating, setMinRating] = useState('')
  const [minReviewCount, setMinReviewCount] = useState('')
  const [fbaOnly, setFbaOnly] = useState(false)
  const [shippingRanges, setShippingRanges] = useState<string[]>([])
  const [applyTax, setApplyTax] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    let cancelled = false
    setLoading(true)
    async function load() {
      const { data } = await supabase.from('filter_settings').select('*').eq('store_id', activeStore!.id).maybeSingle()
      if (cancelled) return
      if (data) {
        setMinRating(data.min_rating != null ? String(data.min_rating) : '')
        setMinReviewCount(data.min_review_count != null ? String(data.min_review_count) : '')
        setFbaOnly(!!data.fba_only)
        setShippingRanges((data.shipping_time_ranges as string[]) || [])
        setApplyTax(!!data.apply_tax)
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id])

  function toggleRange(range: string) {
    setShippingRanges(prev => prev.includes(range) ? prev.filter(r => r !== range) : [...prev, range])
  }

  async function save() {
    if (!activeStore?.id) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('filter_settings').upsert({
        store_id: activeStore.id,
        min_rating: minRating ? Number(minRating) : null,
        min_review_count: minReviewCount ? Number(minReviewCount) : null,
        fba_only: fbaOnly,
        shipping_time_ranges: shippingRanges,
        apply_tax: applyTax,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setMessage('Filters saved.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="card">
      <div className="card-body space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="label">Minimum rating
            <input className="input mt-1" value={minRating} onChange={e => setMinRating(e.target.value)} placeholder="e.g. 4" />
          </label>
          <label className="label">Minimum review count
            <input className="input mt-1" value={minReviewCount} onChange={e => setMinReviewCount(e.target.value)} placeholder="e.g. 50" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Accept only FBA offers</p>
            <p className="text-xs text-slate-500">Skip products that Amazon doesn't fulfill itself.</p>
          </div>
          <Toggle checked={fbaOnly} onChange={setFbaOnly} />
        </div>

        <div>
          <p className="text-sm font-medium text-slate-900 mb-2">Acceptable shipping time</p>
          <div className="flex flex-wrap gap-2">
            {SHIPPING_RANGES.map(range => (
              <button
                key={range}
                onClick={() => toggleRange(range)}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border',
                  shippingRanges.includes(range) ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >{range}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Apply estimated tax to cost</p>
            <p className="text-xs text-slate-500">Adds ~7% to the Amazon cost before calculating the eBay price.</p>
          </div>
          <Toggle checked={applyTax} onChange={setApplyTax} />
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save filters'}
          </button>
          {message && <span className="text-sm text-success-600">{message}</span>}
        </div>
      </div>
    </div>
  )
}

function TeamSection() {
  return (
    <div className="card">
      <div className="card-body">
        <div className="divide-y divide-slate-100">
          {teamMembers.map(member => (
            <div key={member.id} className="flex items-center gap-3 py-3">
              <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold shrink-0">
                {member.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{member.name}</p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
              <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">{member.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
