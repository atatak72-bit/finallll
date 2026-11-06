import { useEffect, useState, useRef, type ReactNode } from 'react'
import {
  DollarSign, Tag, Filter, MessageSquare, Users,
  Store, Save, Plus, Trash2, Info, Mail, ChevronDown,
  CreditCard, RotateCcw, Truck, CheckCircle2, Loader2, MapPin,
  RefreshCw, AlertCircle, CircleCheck, CircleDot,
  Clock, Star, MessageSquareText, Package, Percent, HelpCircle, Check,
  X, Search, Copy, Clipboard, Pencil, Sparkles, AlertTriangle,
} from 'lucide-react'
import { Toggle } from '../components/UI'
import StoreConnectionSection from './StoreConnectionSection'
import { ConnectStoreModal } from '../components/ConnectStoreModal'
import { useStoreData } from '../lib/DataContext'
import { formatCurrency, formatDate, cn, calculateEbayPrice, renderListingTemplate, fitDescriptionToBudget, DEFAULT_LISTING_TEMPLATE } from '../lib/utils'
import { supabase, authHeaders } from '../lib/supabase'

// Team tab removed: it only ever showed mock data (no real team/roles backend exists yet).
type Section = 'general' | 'ebay-policies' | 'filters' | 'templates' | 'auto-messages' | 'auto-ordering' | 'tracking' | 'advanced'

const sections: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ebay-policies', label: 'eBay Policies' },
  { id: 'filters', label: 'Filters' },
  { id: 'templates', label: 'Templates' },
  { id: 'auto-messages', label: 'Auto Messages' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'advanced', label: 'Advanced' },
]

// ---- Shared helpers ----

type Notice = { type: 'success' | 'error'; text: string } | null

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return fallback
}

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null
  return notice.type === 'success'
    ? <span className="flex items-center gap-1 text-sm text-success-600"><CheckCircle2 className="h-4 w-4 shrink-0" /> {notice.text}</span>
    : <span className="flex items-center gap-1 text-sm text-error-600"><AlertCircle className="h-4 w-4 shrink-0" /> {notice.text}</span>
}

// Shown instead of a section's form when loading its saved values failed. Saving is blocked
// in that state, because the form would otherwise hold blank/default values and a save would
// overwrite what is really stored.
function LoadErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Could not load the saved settings.</p>
        <p className="text-xs mt-0.5 break-words">{text}</p>
        <p className="text-xs mt-0.5">Saving is disabled until they load, so nothing gets overwritten with blank values.</p>
      </div>
      <button className="btn-secondary text-sm" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Retry</button>
    </div>
  )
}

// In-app confirmation dialog (used instead of window.confirm for anything that overwrites data).
function ConfirmDialog({
  open, title, children, confirmLabel, danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4" onClick={() => { if (!busy) onCancel() }}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <AlertTriangle className={cn('h-5 w-5', danger ? 'text-error-600' : 'text-amber-500')} />
          <h3 className="font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm text-slate-600">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button className="btn-ghost text-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={cn(danger ? 'btn-danger' : 'btn-primary', 'text-sm')} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// The ONE store every Settings section edits: the store marked active in ebay_tokens
// (falls back to the first connected store if none is marked).
function useActiveStore() {
  const { stores } = useStoreData()
  const connectedStores = stores.filter(s => s.connected)
  const activeStore = connectedStores.find(s => s.active) || connectedStores[0]
  return { connectedStores, activeStore }
}

function storeLabel(store: { ebayUsername?: string; nickname?: string } | undefined): string {
  return store?.ebayUsername || store?.nickname || 'No store connected'
}

// Persists which store is active: active=true for the chosen store, active=false for every
// other store, then reloads the app data so every page switches to that store.
function useActivateStore() {
  const { stores, refresh } = useStoreData()
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  async function activate(storeId: string) {
    if (!storeId) return
    setSwitchingId(storeId)
    setSwitchError(null)
    try {
      const { data: onRows, error: onErr } = await supabase
        .from('ebay_tokens')
        .update({ active: true })
        .eq('id', storeId)
        .select('id')
      if (onErr) throw new Error(onErr.message)
      if (!onRows || onRows.length === 0) throw new Error('Not allowed to change the active store (0 rows updated).')
      const otherIds = stores.filter(s => s.id !== storeId).map(s => s.id)
      if (otherIds.length > 0) {
        const { error: offErr } = await supabase
          .from('ebay_tokens')
          .update({ active: false })
          .in('id', otherIds)
          .select('id')
        if (offErr) throw new Error(`The new store was activated, but the other stores could not be deactivated: ${offErr.message}`)
      }
    } catch (err) {
      setSwitchError(errorText(err, 'Failed to switch the active store'))
    } finally {
      try {
        await refresh()
      } catch (refreshErr) {
        setSwitchError(errorText(refreshErr, 'Switched, but reloading the data failed — reload the page.'))
      }
      setSwitchingId(null)
    }
  }

  return { activate, switchingId, switchError }
}

function ActiveStoreBar() {
  const { connectedStores, activeStore } = useActiveStore()
  const { activate, switchingId, switchError } = useActivateStore()

  if (connectedStores.length === 0) {
    return <p className="mt-5 text-xs text-slate-500">No eBay store connected yet — connect one in the eBay Policies tab.</p>
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <label className="text-xs text-slate-500" htmlFor="settings-active-store">Editing settings for</label>
      <select
        id="settings-active-store"
        className="input max-w-xs py-1.5 text-sm"
        value={activeStore?.id || ''}
        onChange={e => void activate(e.target.value)}
        disabled={!!switchingId || connectedStores.length < 2}
      >
        {connectedStores.map(s => <option key={s.id} value={s.id}>{storeLabel(s)}</option>)}
      </select>
      {switchingId && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Switching active store…</span>}
      {connectedStores.length > 1 && !switchingId && (
        <span className="text-xs text-slate-400">Changing this switches the active store for the whole app.</span>
      )}
      {switchError && <span className="text-xs text-error-600">{switchError}</span>}
    </div>
  )
}

export default function Settings() {
  const [section, setSection] = useState<Section>('general')

  return (
    <div className="max-w-6xl">
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
      <ActiveStoreBar />
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
            <SettingsAccordion title="Amazon proxy IPs (fallback)"><ProxySection /></SettingsAccordion>
          </div>
        )}
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
  const { refresh } = useStoreData()
  const { connectedStores, activeStore } = useActiveStore()
  const { activate, switchingId, switchError } = useActivateStore()
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
  const [categoryNotice, setCategoryNotice] = useState<Notice>(null)
  // Set when the saved policy/location/category settings could not be loaded. Every save here
  // sends ALL of these fields, so saving with blank fields would wipe the saved policy IDs.
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Policies always apply to the ONE active store chosen at the top of Settings.
  const selectedStore = activeStore

  useEffect(() => {
    if (!selectedStore?.id) {
      setPolicies(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setMessage(null)
    setError(null)
    setSettingsLoadError(null)
    setLocationMessage(null)
    setLocationError(null)
    setCategoryNotice(null)

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

        const settingsData = (settingsResult.data || {}) as { settings?: StoreSettings | null; error?: string }
        if (settingsResult.error || settingsData.error) {
          setSettingsLoadError(settingsData.error || errorText(settingsResult.error, 'Failed to load the saved policy settings'))
        }
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
          setSettingsLoadError(errorText(err, 'Failed to load eBay data'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadAll()
    return () => { cancelled = true }
  }, [selectedStore?.id, reloadKey])

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
    if (!selectedStore?.id || settingsLoadError) return
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
    if (!selectedStore?.id || settingsLoadError) return
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
    if (!selectedStore?.id || settingsLoadError) return
    setSavingCategory(true)
    setCategoryNotice(null)
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
      setCategoryNotice({ type: 'success', text: 'Default category saved.' })
    } catch (err) {
      setCategoryNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save category' })
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
              <p className="text-xs text-slate-500">Connected eBay accounts. The active store is the one every page and every Settings section works on.</p>
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
                  {store.id === selectedStore?.id ? (
                    <span className="text-xs font-medium px-2 py-1 rounded bg-brand-100 text-brand-700">Active</span>
                  ) : (
                    <button
                      className="text-xs font-medium px-2 py-1 rounded text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1"
                      onClick={() => void activate(store.id)}
                      disabled={!!switchingId}
                    >
                      {switchingId === store.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Make active
                    </button>
                  )}
                </div>
              ))}
            </div>
            {switchError && <p className="text-sm text-error-600">{switchError}</p>}
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

            {settingsLoadError && !loading && (
              <LoadErrorBox text={settingsLoadError} onRetry={() => setReloadKey(k => k + 1)} />
            )}
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
                  <button className="btn-secondary" onClick={() => void savePolicies()} disabled={saving || !!settingsLoadError}>
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
                  <button className="btn-primary" onClick={() => void saveLocation()} disabled={savingLocation || !!settingsLoadError}>
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
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={() => void saveCategory()} disabled={savingCategory || loading || !!settingsLoadError}>
                {savingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {savingCategory ? 'Saving…' : 'Save category'}
              </button>
              <NoticeText notice={categoryNotice} />
              {settingsLoadError && <span className="text-xs text-error-600">Saved settings failed to load — retry above before saving.</span>}
            </div>
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

// What the listing code uses when a store has NO pricing_settings row (pricing_enabled ?? true,
// fee 13.25 %, fixed fee $0.30) and NO pricing_rules rows (no tiers → eBay price = Amazon price).
const PRICING_DEFAULTS = { pricingEnabled: true, pctFee: '13.25', fixedFee: '0.30' }

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

type PricingTierRow = { id: string; min: string; max: string; profitPct: string; fixProfit: string }
type ValidTier = { id: string; min: number; max: number; profitPct: number; fixProfit: number }

// Strict number parsing: blank or garbage → null (a validation error), never silently 0.
// A single decimal comma ("1,5") is accepted as a decimal point.
function parseNumberInput(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, '').replace(/%$/, '').trim()
  if (!trimmed) return null
  const normalized = /^-?\d+,\d+$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

type PricingValidation =
  | { ok: true; pctFee: number; fixedFee: number; tiers: ValidTier[] }
  | { ok: false; error: string }

function validatePricing(pctFeeText: string, fixedFeeText: string, rows: PricingTierRow[]): PricingValidation {
  const pctFee = parseNumberInput(pctFeeText)
  if (pctFee === null) return { ok: false, error: 'Percentage fee must be a number (e.g. 13.25).' }
  if (pctFee < 0 || pctFee >= 100) return { ok: false, error: 'Percentage fee must be at least 0 and below 100.' }
  const fixedFee = parseNumberInput(fixedFeeText)
  if (fixedFee === null) return { ok: false, error: 'Fixed fee must be a number (e.g. 0.30).' }
  if (fixedFee < 0) return { ok: false, error: 'Fixed fee cannot be negative.' }
  if (rows.length === 0) return { ok: false, error: 'Add at least one profit tier before saving.' }

  const tiers: ValidTier[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const label = `Tier ${i + 1}`
    const min = parseNumberInput(row.min)
    const max = parseNumberInput(row.max)
    const profitPct = parseNumberInput(row.profitPct)
    const fixProfit = parseNumberInput(row.fixProfit)
    if (min === null) return { ok: false, error: `${label}: Min must be a number.` }
    if (max === null) return { ok: false, error: `${label}: Max must be a number.` }
    if (profitPct === null) return { ok: false, error: `${label}: Profit % must be a number.` }
    if (fixProfit === null) return { ok: false, error: `${label}: Fixed profit must be a number (use 0 for none).` }
    if (min < 0) return { ok: false, error: `${label}: Min cannot be negative.` }
    if (max <= min) return { ok: false, error: `${label}: Max (${max}) must be greater than Min (${min}).` }
    if (profitPct < 0) return { ok: false, error: `${label}: Profit % cannot be negative.` }
    if (fixProfit < 0) return { ok: false, error: `${label}: Fixed profit cannot be negative.` }
    tiers.push({ id: row.id, min, max, profitPct, fixProfit })
  }

  tiers.sort((a, b) => a.min - b.min || a.max - b.max)
  if (tiers[0].min !== 0) return { ok: false, error: `The first tier must start at $0 (it starts at $${tiers[0].min}).` }
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1]
    const cur = tiers[i]
    if (cur.min < prev.max) return { ok: false, error: `Tiers overlap: $${prev.min}–$${prev.max} and $${cur.min}–$${cur.max}. Each tier's Min must equal the previous tier's Max.` }
    if (cur.min > prev.max) return { ok: false, error: `Gap between tiers: nothing covers $${prev.max}–$${cur.min}. Each tier's Min must equal the previous tier's Max.` }
  }
  return { ok: true, pctFee, fixedFee, tiers }
}

function PricingSection() {
  const { activeStore } = useActiveStore()

  const [pricingEnabled, setPricingEnabled] = useState(PRICING_DEFAULTS.pricingEnabled)
  const [pctFee, setPctFee] = useState(PRICING_DEFAULTS.pctFee)
  const [fixedFee, setFixedFee] = useState(PRICING_DEFAULTS.fixedFee)
  const [tiers, setTiers] = useState<PricingTierRow[]>([])
  const [hasSavedSettings, setHasSavedSettings] = useState(false)
  const [adRate, setAdRate] = useState<number | null>(null)
  const [autoPromote, setAutoPromote] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    async function load() {
      try {
        const [settingsRes, tiersRes, promotedRes] = await Promise.all([
          supabase.from('pricing_settings').select('pricing_enabled, ebay_percentage_fee, ebay_fixed_fee').eq('store_id', storeId).maybeSingle(),
          supabase.from('pricing_rules').select('id, min_price, max_price, profit_pct, fixed_profit, sort_order').eq('store_id', storeId).order('sort_order', { ascending: true }),
          supabase.from('store_promoted_settings').select('auto_promote_enabled, default_ad_rate').eq('store_id', storeId).maybeSingle(),
        ])
        if (cancelled) return
        if (settingsRes.error) throw new Error(`pricing settings: ${settingsRes.error.message}`)
        if (tiersRes.error) throw new Error(`pricing rules: ${tiersRes.error.message}`)
        const settings = settingsRes.data as { pricing_enabled: boolean | null; ebay_percentage_fee: number | null; ebay_fixed_fee: number | null } | null
        if (settings) {
          setHasSavedSettings(true)
          setPricingEnabled(settings.pricing_enabled ?? PRICING_DEFAULTS.pricingEnabled)
          setPctFee(settings.ebay_percentage_fee != null ? String(settings.ebay_percentage_fee) : PRICING_DEFAULTS.pctFee)
          setFixedFee(settings.ebay_fixed_fee != null ? String(settings.ebay_fixed_fee) : PRICING_DEFAULTS.fixedFee)
        } else {
          setHasSavedSettings(false)
          setPricingEnabled(PRICING_DEFAULTS.pricingEnabled)
          setPctFee(PRICING_DEFAULTS.pctFee)
          setFixedFee(PRICING_DEFAULTS.fixedFee)
        }
        const ruleRows = (tiersRes.data || []) as Array<{ id: string; min_price: number | null; max_price: number | null; profit_pct: number | null; fixed_profit: number | null }>
        setTiers(ruleRows.map(t => ({
          id: t.id,
          min: t.min_price != null ? String(t.min_price) : '',
          max: t.max_price != null ? String(t.max_price) : '',
          profitPct: t.profit_pct != null ? String(t.profit_pct) : '',
          fixProfit: t.fixed_profit != null ? String(t.fixed_profit) : '0',
        })))
        // Promoted settings are only used for the fee breakdown preview — a failure here does not block saving.
        const promoted = promotedRes.error ? null : promotedRes.data as { auto_promote_enabled: boolean | null; default_ad_rate: number | null } | null
        setAutoPromote(promoted?.auto_promote_enabled ?? false)
        setAdRate(promoted?.default_ad_rate != null ? Number(promoted.default_ad_rate) : null)
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load pricing'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  function applyPreset(code: string) {
    const preset = FEE_PRESETS[code]
    if (!preset) return
    setPctFee(String(preset.pct))
    setFixedFee(String(preset.fixed))
  }

  function addTier() {
    setTiers(prev => {
      const last = prev[prev.length - 1]
      const start = last ? last.max : '0'
      return [...prev, { id: genId(), min: start, max: '', profitPct: '20', fixProfit: '0' }]
    })
  }
  function removeTier(id: string) {
    setTiers(prev => prev.filter(t => t.id !== id))
  }
  function updateTier(id: string, field: keyof PricingTierRow, value: string) {
    setTiers(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  const validation = validatePricing(pctFee, fixedFee, tiers)

  async function saveAll() {
    if (!activeStore?.id || loadError) return
    setNotice(null)
    const v = validatePricing(pctFee, fixedFee, tiers)
    if (!v.ok) {
      setNotice({ type: 'error', text: v.error })
      return
    }
    setSaving(true)
    try {
      // Rules first, in ONE transaction on the server (delete + insert inside the function), so a
      // failure can never leave the store with zero rules.
      const { error: rulesErr } = await supabase.rpc('replace_pricing_rules', {
        p_store_id: activeStore.id,
        p_rules: v.tiers.map(t => ({ min_price: t.min, max_price: t.max, profit_pct: t.profitPct, fixed_profit: t.fixProfit })),
      })
      if (rulesErr) {
        const missing = /replace_pricing_rules/.test(rulesErr.message) && /(find|exist)/i.test(rulesErr.message)
        throw new Error(missing
          ? 'The replace_pricing_rules database function is not installed yet — run replace_pricing_rules.sql in Supabase. Nothing was changed.'
          : `Pricing tiers not saved: ${rulesErr.message}`)
      }

      const { error: settingsErr } = await supabase.from('pricing_settings').upsert({
        store_id: activeStore.id,
        pricing_enabled: pricingEnabled,
        ebay_percentage_fee: v.pctFee,
        ebay_fixed_fee: v.fixedFee,
      }, { onConflict: 'store_id' })
      if (settingsErr) throw new Error(`Tiers were saved, but the fee settings were not: ${settingsErr.message}`)

      setHasSavedSettings(true)
      // Show the tiers in the order they were saved (sorted by Min).
      const byId = new Map(tiers.map(t => [t.id, t]))
      setTiers(v.tiers.map(t => byId.get(t.id) || { id: t.id, min: String(t.min), max: String(t.max), profitPct: String(t.profitPct), fixProfit: String(t.fixProfit) }))
      setNotice({ type: 'success', text: 'Pricing rules saved.' })
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err, 'Failed to save pricing rules') })
    } finally {
      setSaving(false)
    }
  }

  // Preview with a full breakdown. The % fee box is meant to hold eBay's final value fee PLUS
  // the promoted-listing ad rate, so the ad share is shown separately from the eBay share.
  const sampleCost = 50
  const preview = validation.ok ? (() => {
    const result = calculateEbayPrice(sampleCost, validation.tiers, validation.pctFee, validation.fixedFee, pricingEnabled)
    const sale = result.finalPrice
    const effectiveAdRate = autoPromote && adRate != null ? adRate : 0
    const ebayPctShare = Math.max(validation.pctFee - effectiveAdRate, 0)
    const ebayFees = sale * ebayPctShare / 100 + validation.fixedFee
    const adFee = sale * effectiveAdRate / 100
    const net = sale - ebayFees - adFee - sampleCost
    return { sale, ebayFees, adFee, net, effectiveAdRate, ebayPctShare }
  })() : null
  const pctFeeNumber = parseNumberInput(pctFee)
  const adRateNotCovered = autoPromote && adRate != null && pctFeeNumber != null && pctFeeNumber < adRate

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading pricing…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

  return (
    <div className="space-y-5">
      {!hasSavedSettings && (
        <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <Info className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-600">No pricing settings saved for this store yet — showing the defaults the listing code uses (automatic pricing on, 13.25% + $0.30).</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Enable automatic pricing</p>
          <p className="text-xs text-slate-500">When off, the eBay price is set equal to the Amazon price — no markup and no fees covered, so every sale loses at least the eBay fees.</p>
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
          <div className="text-xs text-amber-700 space-y-1">
            <p>
              The percentage box is everything eBay takes as a % of the sale: <span className="font-semibold">eBay's final value fee + your promoted-listing ad rate</span>.
              {' '}{adRate != null
                ? <>This store's default ad rate is <span className="font-semibold">{adRate}%</span>{autoPromote ? '' : ' (auto-promote is currently off)'}, so e.g. 13.25% final value fee + {adRate}% ad rate = {Math.round((13.25 + adRate) * 100) / 100}%.</>
                : <>No default ad rate is saved for this store (Promoted Listings below).</>}
            </p>
            <p>The presets fill in eBay's fee only — add your ad rate on top if you promote listings. This is not the profit margin; profit is set in the tiers below.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">Percentage fee (%) — final value fee + ad rate
            <input className="input mt-1" inputMode="decimal" value={pctFee} onChange={e => setPctFee(e.target.value)} />
          </label>
          <label className="label">Fixed fee per order ($)
            <input className="input mt-1" inputMode="decimal" value={fixedFee} onChange={e => setFixedFee(e.target.value)} />
          </label>
        </div>
        {adRateNotCovered && (
          <p className="mt-2 text-xs text-error-600">The percentage fee ({pctFeeNumber}%) is lower than the ad rate ({adRate}%) — promoted sales will not cover eBay's fees.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-slate-900">Profit margin tiers</p>
          <button className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1" onClick={addTier}>
            <Plus className="h-3.5 w-3.5" /> Add tier
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">
          A tier applies to Amazon prices from <span className="font-medium">Min (included)</span> up to but <span className="font-medium">not including Max</span> — e.g. 0–25 and 25–100: a $25.00 item uses the second tier.
          The first tier must start at 0 and each tier's Min must equal the previous tier's Max (no gaps or overlaps). Prices at or above the last tier's Max use the last tier.
        </p>
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 mb-1 text-[11px] font-medium text-slate-500">
          <span>Min $ (incl.)</span><span>Max $ (excl.)</span><span>Profit %</span><span>Fixed profit $</span><span className="w-4" />
        </div>
        <div className="space-y-2">
          {tiers.map(t => (
            <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center">
              <input className="input text-sm" inputMode="decimal" placeholder="Min $" value={t.min} onChange={e => updateTier(t.id, 'min', e.target.value)} />
              <input className="input text-sm" inputMode="decimal" placeholder="Max $" value={t.max} onChange={e => updateTier(t.id, 'max', e.target.value)} />
              <input className="input text-sm" inputMode="decimal" placeholder="Profit %" value={t.profitPct} onChange={e => updateTier(t.id, 'profitPct', e.target.value)} />
              <input className="input text-sm" inputMode="decimal" placeholder="Fixed +$" value={t.fixProfit} onChange={e => updateTier(t.id, 'fixProfit', e.target.value)} />
              <button onClick={() => removeTier(t.id)} className="text-slate-300 hover:text-error-600" title="Remove tier"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {tiers.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
              No tiers saved for this store — the eBay price currently equals the Amazon price. Add at least one tier (e.g. 0 – 999999) to save.
            </p>
          )}
        </div>
      </div>

      {preview && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
          <p className="text-slate-500 text-xs mb-1">Preview: a {formatCurrency(sampleCost)} Amazon item becomes</p>
          <p className="font-semibold text-slate-900">{formatCurrency(preview.sale)} on eBay</p>
          <dl className="mt-2 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Sale price</dt><dd className="text-right text-slate-900">{formatCurrency(preview.sale)}</dd>
            <dt className="text-slate-500">eBay fees ({Math.round(preview.ebayPctShare * 100) / 100}% + {formatCurrency(validation.ok ? validation.fixedFee : 0)})</dt><dd className="text-right text-slate-900">−{formatCurrency(preview.ebayFees)}</dd>
            <dt className="text-slate-500">Ad fee ({preview.effectiveAdRate}%{autoPromote ? '' : ', auto-promote off'})</dt><dd className="text-right text-slate-900">−{formatCurrency(preview.adFee)}</dd>
            <dt className="text-slate-500">Amazon cost</dt><dd className="text-right text-slate-900">−{formatCurrency(sampleCost)}</dd>
            <dt className="border-t border-slate-200 pt-0.5 font-medium text-slate-700">Net profit</dt>
            <dd className={cn('border-t border-slate-200 pt-0.5 text-right font-semibold', preview.net >= 0 ? 'text-success-700' : 'text-error-600')}>{formatCurrency(preview.net)}</dd>
          </dl>
          <p className="mt-1 text-[11px] text-slate-400">Excludes sales tax and Amazon tax (see Filters → Apply estimated tax).</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => void saveAll()} disabled={saving || !validation.ok}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
        {!validation.ok && <span className="text-xs text-error-600">{validation.error}</span>}
        <NoticeText notice={notice} />
      </div>
    </div>
  )
}

// Backend (amazon-fetch) behaviour when a store has NO store_availability_settings row.
const AVAILABILITY_DEFAULTS = { defaultQuantity: '1', primeFilter: false, allowOutOfStock: true, allowDuplicateAsins: true }

function AvailabilitySection() {
  const { activeStore } = useActiveStore()

  const [defaultQuantity, setDefaultQuantity] = useState(AVAILABILITY_DEFAULTS.defaultQuantity)
  const [primeFilter, setPrimeFilter] = useState(AVAILABILITY_DEFAULTS.primeFilter)
  const [allowOutOfStock, setAllowOutOfStock] = useState(AVAILABILITY_DEFAULTS.allowOutOfStock)
  const [allowDuplicateAsins, setAllowDuplicateAsins] = useState(AVAILABILITY_DEFAULTS.allowDuplicateAsins)
  const [hasRow, setHasRow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    async function load() {
      try {
        const { data, error } = await supabase
          .from('store_availability_settings')
          .select('default_quantity, prime_filter, allow_out_of_stock, allow_duplicate_asins')
          .eq('store_id', storeId)
          .maybeSingle()
        if (cancelled) return
        if (error) throw new Error(error.message)
        if (data) {
          setHasRow(true)
          setDefaultQuantity(data.default_quantity != null ? String(data.default_quantity) : AVAILABILITY_DEFAULTS.defaultQuantity)
          setPrimeFilter(!!data.prime_filter)
          setAllowOutOfStock(data.allow_out_of_stock ?? AVAILABILITY_DEFAULTS.allowOutOfStock)
          setAllowDuplicateAsins(data.allow_duplicate_asins ?? AVAILABILITY_DEFAULTS.allowDuplicateAsins)
        } else {
          setHasRow(false)
          setDefaultQuantity(AVAILABILITY_DEFAULTS.defaultQuantity)
          setPrimeFilter(AVAILABILITY_DEFAULTS.primeFilter)
          setAllowOutOfStock(AVAILABILITY_DEFAULTS.allowOutOfStock)
          setAllowDuplicateAsins(AVAILABILITY_DEFAULTS.allowDuplicateAsins)
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load availability settings'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  async function save() {
    if (!activeStore?.id || loadError) return
    setNotice(null)
    const qty = parseNumberInput(defaultQuantity)
    if (qty === null || !Number.isInteger(qty) || qty < 1) {
      setNotice({ type: 'error', text: 'Default quantity must be a whole number of at least 1.' })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('store_availability_settings').upsert({
        store_id: activeStore.id,
        default_quantity: qty,
        prime_filter: primeFilter,
        allow_out_of_stock: allowOutOfStock,
        allow_duplicate_asins: allowDuplicateAsins,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setHasRow(true)
      setNotice({ type: 'success', text: 'Availability settings saved.' })
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err, 'Failed to save') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

  return (
    <div className="space-y-5">
      {!hasRow && (
        <p className="text-xs text-slate-500">Nothing saved for this store yet — showing what the server uses without saved settings.</p>
      )}
      <label className="label">Default quantity for new listings
        <input className="input mt-1 max-w-xs" inputMode="numeric" value={defaultQuantity} onChange={e => setDefaultQuantity(e.target.value)} />
      </label>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Prime filter</p>
          <p className="text-xs text-slate-500">Only list products that are Prime/Fulfilled-by-Amazon.</p>
          <p className="text-xs text-slate-400">Note: this runs the same Prime/FBA check as "Accept only FBA offers" in the Filters tab — turning on either one has the same effect.</p>
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

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <NoticeText notice={notice} />
      </div>
    </div>
  )
}

// Used when a store has NO store_promoted_settings row (same fallbacks as the listing pages).
const PROMOTED_DEFAULTS = { autoPromote: false, adRate: '3' }

function PromotedSection() {
  const { activeStore } = useActiveStore()

  const [autoPromote, setAutoPromote] = useState(PROMOTED_DEFAULTS.autoPromote)
  const [adRate, setAdRate] = useState(PROMOTED_DEFAULTS.adRate)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    async function load() {
      try {
        const { data, error } = await supabase
          .from('store_promoted_settings')
          .select('auto_promote_enabled, default_ad_rate')
          .eq('store_id', storeId)
          .maybeSingle()
        if (cancelled) return
        if (error) throw new Error(error.message)
        if (data) {
          setAutoPromote(data.auto_promote_enabled ?? PROMOTED_DEFAULTS.autoPromote)
          setAdRate(data.default_ad_rate != null ? String(data.default_ad_rate) : PROMOTED_DEFAULTS.adRate)
        } else {
          setAutoPromote(PROMOTED_DEFAULTS.autoPromote)
          setAdRate(PROMOTED_DEFAULTS.adRate)
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load Promoted Listings settings'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  async function save() {
    if (!activeStore?.id || loadError) return
    setNotice(null)
    const rate = parseNumberInput(adRate)
    if (rate === null || rate < 0 || rate >= 100) {
      setNotice({ type: 'error', text: 'Ad rate must be a number from 0 to below 100.' })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('store_promoted_settings').upsert({
        store_id: activeStore.id,
        auto_promote_enabled: autoPromote,
        default_ad_rate: rate,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setNotice({ type: 'success', text: 'Promoted Listings settings saved.' })
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err, 'Failed to save') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

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
        <input className="input mt-1 max-w-xs" inputMode="decimal" value={adRate} onChange={e => setAdRate(e.target.value)} />
      </label>
      <p className="text-xs text-slate-500">Remember to include this ad rate in the percentage fee under Profit &amp; fees, otherwise the ad fee comes out of your profit.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <NoticeText notice={notice} />
      </div>
    </div>
  )
}

// Backend (amazon-fetch ~new2.ts:1262-1275) when a store has a row but a column is null:
// block_in_* ?? true, auto_remove_brand / auto_replace_brand ?? false. With NO row at all
// nothing is removed or blocked (empty lists, brand options off).
const VERO_DEFAULTS = { blockInBrand: true, blockInTitle: true, blockInDescription: true, autoRemoveBrand: false, autoReplaceBrand: false }

type VeroRow = {
  store_id: string
  remove_keywords: string[] | null
  block_keywords: string[] | null
  block_asins: string[] | null
  block_in_brand: boolean | null
  block_in_title: boolean | null
  block_in_description: boolean | null
  auto_remove_brand: boolean | null
  auto_replace_brand: boolean | null
}

// Union of two word lists, case-insensitive dedupe, keeps the first spelling seen.
function mergeWordLists(existing: string[] | null | undefined, incoming: string[], normalize: (w: string) => string = w => w.trim()): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...(existing || []), ...incoming]) {
    const word = normalize(String(raw ?? ''))
    if (!word) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

function VeroSection() {
  const { connectedStores, activeStore } = useActiveStore()

  const [removeKeywords, setRemoveKeywords] = useState<string[]>([])
  const [blockKeywords, setBlockKeywords] = useState<string[]>([])
  const [blockAsins, setBlockAsins] = useState<string[]>([])
  const [blockInBrand, setBlockInBrand] = useState(VERO_DEFAULTS.blockInBrand)
  const [blockInTitle, setBlockInTitle] = useState(VERO_DEFAULTS.blockInTitle)
  const [blockInDescription, setBlockInDescription] = useState(VERO_DEFAULTS.blockInDescription)
  const [autoRemoveBrand, setAutoRemoveBrand] = useState(VERO_DEFAULTS.autoRemoveBrand)
  const [autoReplaceBrand, setAutoReplaceBrand] = useState(VERO_DEFAULTS.autoReplaceBrand)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [confirmCopyOpen, setConfirmCopyOpen] = useState(false)
  const [copyOptionsToo, setCopyOptionsToo] = useState(false)
  const [message, setMessage] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setMessage(null)
    async function load() {
      try {
        const { data, error } = await supabase
          .from('store_vero_settings')
          .select('remove_keywords, block_keywords, block_asins, block_in_brand, block_in_title, block_in_description, auto_remove_brand, auto_replace_brand')
          .eq('store_id', storeId)
          .maybeSingle()
        if (cancelled) return
        if (error) throw new Error(error.message)
        const row = data as Omit<VeroRow, 'store_id'> | null
        setRemoveKeywords(row?.remove_keywords || [])
        setBlockKeywords(row?.block_keywords || [])
        setBlockAsins(row?.block_asins || [])
        setBlockInBrand(row?.block_in_brand ?? VERO_DEFAULTS.blockInBrand)
        setBlockInTitle(row?.block_in_title ?? VERO_DEFAULTS.blockInTitle)
        setBlockInDescription(row?.block_in_description ?? VERO_DEFAULTS.blockInDescription)
        setAutoRemoveBrand(row?.auto_remove_brand ?? VERO_DEFAULTS.autoRemoveBrand)
        setAutoReplaceBrand(row?.auto_replace_brand ?? VERO_DEFAULTS.autoReplaceBrand)
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load VeRO settings'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  function buildPayload(storeId: string) {
    return {
      store_id: storeId,
      remove_keywords: removeKeywords,
      block_keywords: blockKeywords,
      block_asins: blockAsins,
      block_in_brand: blockInBrand,
      block_in_title: blockInTitle,
      block_in_description: blockInDescription,
      auto_remove_brand: autoRemoveBrand,
      auto_replace_brand: autoReplaceBrand,
      updated_at: new Date().toISOString(),
    }
  }

  async function save() {
    if (!activeStore?.id || loadError) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('store_vero_settings').upsert(buildPayload(activeStore.id), { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setMessage({ type: 'success', text: 'VeRO & words filter saved.' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const otherStores = connectedStores.filter(s => s.id !== activeStore?.id)

  function requestCopyToAllStores() {
    setMessage(null)
    if (otherStores.length === 0) {
      setMessage({ type: 'error', text: 'No other connected stores to copy to.' })
      return
    }
    setCopyOptionsToo(false)
    setConfirmCopyOpen(true)
  }

  // MERGES this store's lists into every other store (union, case-insensitive) — never removes
  // words another store already has. On/off options are only copied when explicitly ticked
  // (or when the other store has no VeRO settings yet).
  async function copyToAllStores() {
    if (!activeStore?.id || otherStores.length === 0) return
    setCopying(true)
    setMessage(null)
    try {
      const ids = otherStores.map(s => s.id)
      const { data: existingRows, error: readErr } = await supabase
        .from('store_vero_settings')
        .select('store_id, remove_keywords, block_keywords, block_asins, block_in_brand, block_in_title, block_in_description, auto_remove_brand, auto_replace_brand')
        .in('store_id', ids)
      if (readErr) throw new Error(`Could not read the other stores' settings: ${readErr.message}`)
      const byStore = new Map<string, VeroRow>(((existingRows || []) as VeroRow[]).map(r => [String(r.store_id), r]))
      const asinNormalize = (w: string) => w.trim().toUpperCase()
      const payloads = otherStores.map(store => {
        const existing = byStore.get(store.id)
        const useMine = copyOptionsToo || !existing
        return {
          store_id: store.id,
          remove_keywords: mergeWordLists(existing?.remove_keywords, removeKeywords),
          block_keywords: mergeWordLists(existing?.block_keywords, blockKeywords),
          block_asins: mergeWordLists(existing?.block_asins, blockAsins, asinNormalize),
          block_in_brand: useMine ? blockInBrand : (existing?.block_in_brand ?? VERO_DEFAULTS.blockInBrand),
          block_in_title: useMine ? blockInTitle : (existing?.block_in_title ?? VERO_DEFAULTS.blockInTitle),
          block_in_description: useMine ? blockInDescription : (existing?.block_in_description ?? VERO_DEFAULTS.blockInDescription),
          auto_remove_brand: useMine ? autoRemoveBrand : (existing?.auto_remove_brand ?? VERO_DEFAULTS.autoRemoveBrand),
          auto_replace_brand: useMine ? autoReplaceBrand : (existing?.auto_replace_brand ?? VERO_DEFAULTS.autoReplaceBrand),
          updated_at: new Date().toISOString(),
        }
      })
      const { error } = await supabase.from('store_vero_settings').upsert(payloads, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setConfirmCopyOpen(false)
      setMessage({ type: 'success', text: `Merged into ${otherStores.length} other store${otherStores.length === 1 ? '' : 's'}.` })
    } catch (err) {
      setConfirmCopyOpen(false)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to copy' })
    } finally {
      setCopying(false)
    }
  }

  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />
  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Remove keywords</p>
          <p className="text-xs text-slate-500">Remove specific keywords from item title &amp; description — doesn't block listing, just strips them.</p>
        </div>
        <VeroWordList
          words={removeKeywords}
          onChange={setRemoveKeywords}
          placeholder="Add word"
          searchPlaceholder="Search word"
          hint="Separate words with new lines or commas (e.g. amazon,walmart,refund)"
        />
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          <VeroCheck
            checked={autoRemoveBrand}
            onChange={setAutoRemoveBrand}
            label="Auto-remove the brand name"
            desc="Strips the source brand out of the title and description."
          />
          <VeroCheck
            checked={autoReplaceBrand}
            onChange={setAutoReplaceBrand}
            label="Auto-replace the brand"
            desc={'Lists the item with "Does not apply" as its brand instead.'}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Block by keyword</p>
          <p className="text-xs text-slate-500">Blocks items with these keywords during bulk listing / shows a warning in the auto-lister</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <VeroPill checked={blockInBrand} onChange={setBlockInBrand} label="In the brand" />
          <VeroPill checked={blockInTitle} onChange={setBlockInTitle} label="In the title" />
          <VeroPill checked={blockInDescription} onChange={setBlockInDescription} label="In the description" />
        </div>
        <VeroWordList
          words={blockKeywords}
          onChange={setBlockKeywords}
          placeholder="Add word"
          searchPlaceholder="Search word"
          hint="Separate words with new lines or commas (e.g. patent,trademark,replica)"
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Block by ASIN</p>
          <p className="text-xs text-slate-500">Blocks these specific Amazon products outright, regardless of title/description matches.</p>
        </div>
        <VeroWordList
          words={blockAsins}
          onChange={setBlockAsins}
          placeholder="Add ASIN"
          searchPlaceholder="Search ASIN"
          hint="Separate ASINs with new lines or commas"
          normalize={w => w.trim().toUpperCase()}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">Saves all three word lists above, plus the two brand options.</p>
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            className="text-sm font-medium text-brand-600 underline hover:text-brand-700 disabled:opacity-50"
            onClick={requestCopyToAllStores}
            disabled={copying || connectedStores.length < 2}
          >
            {copying ? 'Copying…' : 'Copy to all stores'}
          </button>
          <NoticeText notice={message} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmCopyOpen}
        title="Copy VeRO lists to all other stores?"
        confirmLabel={copying ? 'Copying…' : `Merge into ${otherStores.length} store${otherStores.length === 1 ? '' : 's'}`}
        busy={copying}
        onCancel={() => setConfirmCopyOpen(false)}
        onConfirm={() => void copyToAllStores()}
      >
        <p>
          The three word lists shown here ({removeKeywords.length} remove keywords, {blockKeywords.length} block keywords, {blockAsins.length} blocked ASINs — including unsaved changes)
          will be <span className="font-medium text-slate-900">merged</span> into: {otherStores.map(s => storeLabel(s)).join(', ')}.
        </p>
        <p>Words those stores already have are kept; duplicates are skipped (case-insensitive). Nothing is removed.</p>
        <label className="flex items-start gap-2 pt-1">
          <input type="checkbox" className="mt-0.5" checked={copyOptionsToo} onChange={e => setCopyOptionsToo(e.target.checked)} />
          <span>Also overwrite their on/off options (block in brand/title/description, auto-remove/replace brand) with this store's.</span>
        </label>
      </ConfirmDialog>
    </div>
  )
}

function VeroWordList({
  words,
  onChange,
  placeholder,
  searchPlaceholder,
  hint,
  normalize = (w: string) => w.trim(),
}: {
  words: string[]
  onChange: (next: string[]) => void
  placeholder: string
  searchPlaceholder: string
  hint: string
  normalize?: (w: string) => string
}) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  function addWords() {
    const parts = input.split(/[\n,]+/).map(normalize).filter(Boolean)
    if (parts.length === 0) return
    const seen = new Set(words.map(w => w.toLowerCase()))
    const next = [...words]
    for (const part of parts) {
      const key = part.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        next.push(part)
      }
    }
    onChange(next)
    setInput('')
  }

  function removeWord(word: string) {
    onChange(words.filter(w => w !== word))
  }

  async function copyAll() {
    if (words.length === 0) return
    try {
      await navigator.clipboard.writeText(words.join(', '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard not available — ignore
    }
  }

  function clearAll() {
    if (words.length === 0) return
    if (!window.confirm('Remove all words from this list?')) return
    onChange([])
  }

  const q = search.trim().toLowerCase()
  const visible = q ? words.filter(w => w.toLowerCase().includes(q)) : words
  const smallBtn = 'rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50'

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <textarea
          className="input flex-1 resize-none"
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              addWords()
            }
          }}
          placeholder={placeholder}
        />
        <button className="btn-secondary shrink-0" onClick={addWords}>Add</button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-8"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">{hint}</p>
      <div className="flex min-h-[52px] max-h-[130px] flex-wrap content-start gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
        {visible.map(word => (
          <span key={word} className="inline-flex h-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-700">
            {word}
            <button onClick={() => removeWord(word)} className="text-slate-400 hover:text-error-600" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {q && visible.length === 0 && <p className="text-xs text-slate-400">No match.</p>}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button className={smallBtn} onClick={() => void copyAll()}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
          <button className={smallBtn} onClick={clearAll}>Clear</button>
        </div>
        <p className="text-xs text-slate-500">Total: {words.length} words</p>
      </div>
    </div>
  )
}

function VeroCheck({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
      <span className={cn(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
        checked ? 'border-success-600 bg-success-600 text-white' : 'border-slate-300 bg-white',
      )}>
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
    </button>
  )
}

function VeroPill({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
        checked ? 'border-success-300 bg-success-50 text-slate-700' : 'border-slate-200 bg-white text-slate-500',
      )}
    >
      <span className={cn(
        'flex h-4 w-4 items-center justify-center rounded border',
        checked ? 'border-success-600 bg-success-600 text-white' : 'border-slate-300 bg-white',
      )}>
        {checked && <Check className="h-3 w-3" />}
      </span>
      {label}
    </button>
  )
}

// ---- Listing Templates: multiple named templates per store, one marked active ----
// "Active" is what every new listing (Single tab fetch, Bulk run) actually uses to build its
// description — enforced by useData.ts / ListItems.tsx filtering on is_active=true when they
// load the template. Saving a template here never touches which one is active; that's a
// separate, explicit action so switching designs is never accidental.
type TemplateRow = { id: string; name: string; template: string; is_active: boolean }

function ListingTemplateSection() {
  const { connectedStores, activeStore } = useActiveStore()
  const activeStoreName = activeStore?.ebayUsername || activeStore?.nickname || 'Our Store'

  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selectedId, setSelectedId] = useState<string | 'new'>('new')
  const [draftName, setDraftName] = useState('Template 1')
  const [draftTemplate, setDraftTemplate] = useState(DEFAULT_LISTING_TEMPLATE)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [confirmCopyOpen, setConfirmCopyOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
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
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    async function load() {
      try {
        const { data, error } = await supabase
          .from('listing_templates')
          .select('id, name, template, is_active')
          .eq('store_id', storeId)
          .order('created_at', { ascending: true })
        if (cancelled) return
        if (error) throw new Error(error.message)
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
      } catch (err) {
        if (!cancelled) {
          // Don't let the user "save as new" over a list we failed to read (it would also make
          // a second active template). Saving is blocked until the retry succeeds.
          setTemplates([])
          setLoadError(errorText(err, 'Failed to load your templates.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

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
    if (!activeStore?.id || loadError) return
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

  const otherStores = connectedStores.filter(s => s.id !== activeStore?.id)

  function requestCopyToAllStores() {
    if (otherStores.length === 0) {
      setToast({ type: 'error', msg: 'No other connected stores to copy to.' })
      return
    }
    setConfirmCopyOpen(true)
  }

  // Pushes the CURRENTLY EDITED template's content to every other connected store (after the
  // in-app confirmation): every ACTIVE template of that store gets this content (its own name is
  // left untouched — and if a store somehow has several active rows, all of them are updated
  // rather than erroring and inserting a duplicate); if the store has no active template, a new
  // one is created for it and set active so that store always ends up with a usable template.
  async function copyToAllStores() {
    if (!activeStore?.id || otherStores.length === 0) return
    setCopying(true)
    setToast(null)
    try {
      for (const store of otherStores) {
        const { data: updatedRows, error: updateErr } = await supabase
          .from('listing_templates')
          .update({ template: draftTemplate, updated_at: new Date().toISOString() })
          .eq('store_id', store.id)
          .eq('is_active', true)
          .select('id')
        if (updateErr) throw new Error(`${storeLabel(store)}: ${updateErr.message}`)
        if (!updatedRows || updatedRows.length === 0) {
          const { error } = await supabase
            .from('listing_templates')
            .insert({ store_id: store.id, name: draftName.trim() || 'Template 1', template: draftTemplate, is_active: true })
          if (error) throw new Error(`${storeLabel(store)}: ${error.message}`)
        }
      }
      setToast({ type: 'success', msg: `Copied to ${otherStores.length} other store${otherStores.length === 1 ? '' : 's'} as their active template.` })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to copy to other stores.' })
    } finally {
      setCopying(false)
      setConfirmCopyOpen(false)
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
        {loadError && <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />}
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
          <button className="btn-primary" onClick={() => void saveTemplate()} disabled={saving || loading || !!loadError}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : isNew ? 'Save as new template' : 'Save'}
          </button>
          <button className="text-sm text-brand-600 hover:text-brand-700 font-medium" onClick={requestCopyToAllStores} disabled={copying || connectedStores.length < 2 || !!loadError}>
            {copying ? 'Copying…' : 'Copy to all stores'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCopyOpen}
        title="Overwrite the active template of other stores?"
        confirmLabel={copying ? 'Copying…' : 'Overwrite'}
        danger
        busy={copying}
        onCancel={() => setConfirmCopyOpen(false)}
        onConfirm={() => void copyToAllStores()}
      >
        <p>
          The template in the editor (including unsaved changes) will <span className="font-medium text-slate-900">replace the content of the active template</span> of:
          {' '}{otherStores.map(s => storeLabel(s)).join(', ')}.
        </p>
        <p>Their current template HTML is not kept anywhere — copy it first if you may need it. Stores without an active template get a new one.</p>
      </ConfirmDialog>

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
  const { activeStore } = useActiveStore()

  const [messages, setMessages] = useState<Record<string, { enabled: boolean; text: string }>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    async function load() {
      try {
        const { data, error } = await supabase.from('store_auto_messages').select('*').eq('store_id', storeId)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const rows = (data || []) as Array<{ trigger: string; enabled: boolean | null; message_text: string | null }>
        const map: Record<string, { enabled: boolean; text: string }> = {}
        for (const trigger of MESSAGE_TRIGGERS) {
          const row = rows.find(r => r.trigger === trigger.id)
          map[trigger.id] = { enabled: row?.enabled ?? false, text: row?.message_text ?? '' }
        }
        setMessages(map)
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load auto messages'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  async function save() {
    if (!activeStore?.id || loadError) return
    setSaving(true)
    setNotice(null)
    let savedCount = 0
    try {
      for (const trigger of MESSAGE_TRIGGERS) {
        const row = messages[trigger.id]
        const { error } = await supabase.from('store_auto_messages').upsert({
          store_id: activeStore.id,
          trigger: trigger.id,
          enabled: row?.enabled ?? false,
          message_text: row?.text ?? '',
        }, { onConflict: 'store_id,trigger' })
        if (error) throw new Error(`"${trigger.label}" not saved: ${error.message}`)
        savedCount++
      }
      setNotice({ type: 'success', text: 'Auto messages saved.' })
    } catch (err) {
      const base = errorText(err, 'Failed to save')
      setNotice({ type: 'error', text: savedCount > 0 ? `${base} (${savedCount} of ${MESSAGE_TRIGGERS.length} saved before the error)` : base })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

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
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save all messages'}
        </button>
        <NoticeText notice={notice} />
      </div>
    </div>
  )
}

const SHIPPING_RANGES = ['0-2 days', '3-7 days', '8-13 days', '14 or more days']

// Backend (amazon-fetch) with NO filter_settings row: no filters at all.
const FILTER_DEFAULTS = { minRating: '', minReviewCount: '', fbaOnly: false, shippingRanges: [] as string[], applyTax: false }

function AmazonFiltersSection() {
  const { activeStore } = useActiveStore()

  const [minRating, setMinRating] = useState(FILTER_DEFAULTS.minRating)
  const [minReviewCount, setMinReviewCount] = useState(FILTER_DEFAULTS.minReviewCount)
  const [fbaOnly, setFbaOnly] = useState(FILTER_DEFAULTS.fbaOnly)
  // Kept and saved back unchanged — the shipping-time filter is currently not applied (see below).
  const [shippingRanges, setShippingRanges] = useState<string[]>(FILTER_DEFAULTS.shippingRanges)
  const [applyTax, setApplyTax] = useState(FILTER_DEFAULTS.applyTax)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    if (!activeStore?.id) return
    const storeId = activeStore.id
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setNotice(null)
    async function load() {
      try {
        const { data, error } = await supabase
          .from('filter_settings')
          .select('min_rating, min_review_count, fba_only, shipping_time_ranges, apply_tax')
          .eq('store_id', storeId)
          .maybeSingle()
        if (cancelled) return
        if (error) throw new Error(error.message)
        if (data) {
          setMinRating(data.min_rating != null ? String(data.min_rating) : '')
          setMinReviewCount(data.min_review_count != null ? String(data.min_review_count) : '')
          setFbaOnly(!!data.fba_only)
          setShippingRanges((data.shipping_time_ranges as string[] | null) || [])
          setApplyTax(!!data.apply_tax)
        } else {
          setMinRating(FILTER_DEFAULTS.minRating)
          setMinReviewCount(FILTER_DEFAULTS.minReviewCount)
          setFbaOnly(FILTER_DEFAULTS.fbaOnly)
          setShippingRanges(FILTER_DEFAULTS.shippingRanges)
          setApplyTax(FILTER_DEFAULTS.applyTax)
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load filters'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [activeStore?.id, reloadKey])

  async function save() {
    if (!activeStore?.id || loadError) return
    setNotice(null)
    const rating = minRating.trim() ? parseNumberInput(minRating) : null
    if (minRating.trim() && (rating === null || rating < 0 || rating > 5)) {
      setNotice({ type: 'error', text: 'Minimum rating must be a number from 0 to 5 (or empty for no minimum).' })
      return
    }
    const reviews = minReviewCount.trim() ? parseNumberInput(minReviewCount) : null
    if (minReviewCount.trim() && (reviews === null || reviews < 0 || !Number.isInteger(reviews))) {
      setNotice({ type: 'error', text: 'Minimum review count must be a whole number (or empty for no minimum).' })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('filter_settings').upsert({
        store_id: activeStore.id,
        min_rating: rating,
        min_review_count: reviews,
        fba_only: fbaOnly,
        shipping_time_ranges: shippingRanges,
        apply_tax: applyTax,
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setNotice({ type: 'success', text: 'Filters saved.' })
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err, 'Failed to save') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

  return (
    <div className="card">
      <div className="card-body space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="label">Minimum rating
            <input className="input mt-1" inputMode="decimal" value={minRating} onChange={e => setMinRating(e.target.value)} placeholder="e.g. 4" />
          </label>
          <label className="label">Minimum review count
            <input className="input mt-1" inputMode="numeric" value={minReviewCount} onChange={e => setMinReviewCount(e.target.value)} placeholder="e.g. 50" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Accept only FBA offers</p>
            <p className="text-xs text-slate-500">Skip products that Amazon doesn't fulfill itself.</p>
            <p className="text-xs text-slate-400">Note: this runs the same Prime/FBA check as the "Prime filter" under General → Availability — turning on either one has the same effect.</p>
          </div>
          <Toggle checked={fbaOnly} onChange={setFbaOnly} />
        </div>

        <div>
          <p className="text-sm font-medium text-slate-900 mb-1">Acceptable shipping time</p>
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-2">
            <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Currently not applied: the Amazon fetcher does not read delivery times at the moment, so this filter is skipped for every product.
              Editing is disabled; the saved choice is kept as it is.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SHIPPING_RANGES.map(range => (
              <span
                key={range}
                aria-disabled="true"
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border cursor-not-allowed opacity-60',
                  shippingRanges.includes(range) ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-slate-200 text-slate-600',
                )}
              >{range}</span>
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

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save filters'}
          </button>
          <NoticeText notice={notice} />
        </div>
      </div>
    </div>
  )
}

// ---- Amazon proxy IPs (per store, FALLBACK only) ----
// Uploads and Amazon checks go through the Webshare proxy IPs configured on the server
// (AMAZON_PROXIES secret). This per-store list (store_proxy_settings) is only used by
// amazon-fetch's last-resort direct-scrape path, and only when enabled. Saved credentials are
// never shown back in full: lines are displayed masked, and the textarea only adds/replaces.

type ProxyProbe = { asin: string; outcome: string; status: number; ms: number; kb: number; location?: string }
type ProxyTestRow = { proxy: string; scheme: string; ip: string; ipError: string; probes: ProxyProbe[] }

// Mirrors the parser in amazon-fetch so the count shown here matches what the server will use.
function countValidProxyLines(text: string): { valid: number; invalid: string[] } {
  const invalid: string[] = []
  const seen = new Set<string>()
  let valid = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let rest = line.replace(/^(https?|socks5h?):\/\//i, '').replace(/\/+$/, '')
    let host = '', port = '', user = ''
    if (rest.includes('@')) {
      const at = rest.lastIndexOf('@')
      user = rest.slice(0, at).split(':')[0]
      rest = rest.slice(at + 1)
      const hi = rest.lastIndexOf(':')
      host = hi > 0 ? rest.slice(0, hi) : ''
      port = hi > 0 ? rest.slice(hi + 1) : ''
    } else {
      const parts = rest.split(':')
      if (parts.length === 2) [host, port] = parts
      else if (parts.length === 4 && !/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[3])) { user = parts[0]; host = parts[2]; port = parts[3] }
      else if (parts.length >= 4) { host = parts[0]; port = parts[1]; user = parts[2] }
    }
    if (!host || !/^[A-Za-z0-9.-]+$/.test(host.trim()) || !/^\d{2,5}$/.test(port.trim())) {
      invalid.push(line.length > 40 ? line.slice(0, 40) + '…' : line)
      continue
    }
    const key = `${host.trim()}:${port.trim()}:${user}`
    if (!seen.has(key)) { seen.add(key); valid++ }
  }
  return { valid, invalid }
}

// Masks the password of one proxy line for display: ip:port:user:•••• , user:••••@ip:port, …
function maskProxyLine(raw: string): string {
  const line = raw.trim()
  const schemeMatch = line.match(/^(https?|socks5h?):\/\//i)
  const scheme = schemeMatch ? schemeMatch[0] : ''
  const rest = line.slice(scheme.length)
  const mask = '••••'
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@')
    const user = rest.slice(0, at).split(':')[0]
    return `${scheme}${user}:${mask}@${rest.slice(at + 1)}`
  }
  const parts = rest.split(':')
  if (parts.length === 2) return `${scheme}${rest}`
  if (parts.length === 4 && !/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[3])) return `${scheme}${parts[0]}:${mask}:${parts[2]}:${parts[3]}`
  if (parts.length >= 4) return `${scheme}${parts[0]}:${parts[1]}:${parts[2]}:${mask}`
  if (parts.length === 3) return `${scheme}${parts[0]}:${parts[1]}:${parts[2]}`
  return line.length > 6 ? `${line.slice(0, 6)}${mask}` : mask
}

function proxyLines(text: string): string[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
}

const PROXY_OUTCOME_LABEL: Record<string, string> = {
  ok: 'OK', captcha: 'CAPTCHA', blocked: 'Blocked', wrong_country: 'Not a US IP', timeout: 'Timeout', error: 'Connection error', not_found: 'Page not found', other: 'Other',
}

function ProxySection() {
  const { connectedStores, activeStore } = useActiveStore()
  const storeId = activeStore?.id || ''
  // The saved list (plain text in the DB) is kept only in memory and shown masked.
  const [savedList, setSavedList] = useState('')
  const [savedEnabled, setSavedEnabled] = useState(false)
  const [newText, setNewText] = useState('')
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [message, setMessage] = useState<Notice>(null)
  const [testing, setTesting] = useState(false)
  const [testProgress, setTestProgress] = useState('')
  const [testRows, setTestRows] = useState<ProxyTestRow[]>([])
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setMessage(null)
    setTestRows([])
    setTestError(null)
    setNewText('')
    setConfirmClear(false)
    async function load() {
      try {
        const { data, error } = await supabase.from('store_proxy_settings').select('proxy_list, enabled').eq('store_id', storeId).maybeSingle()
        if (cancelled) return
        if (error) {
          throw new Error(/store_proxy_settings/.test(error.message)
            ? 'The proxy settings table does not exist yet — run store-proxy-settings.sql in Supabase first.'
            : error.message)
        }
        const row = data as { proxy_list: string | null; enabled: boolean | null } | null
        setSavedList(String(row?.proxy_list || ''))
        // amazon-fetch: no row → no list; a row is used unless enabled === false.
        const isOn = row ? row.enabled !== false : false
        setSavedEnabled(isOn)
        setEnabled(isOn)
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err, 'Failed to load proxy settings'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [storeId, reloadKey])

  const savedParsed = countValidProxyLines(savedList)
  const newParsed = countValidProxyLines(newText)
  const savedLines = proxyLines(savedList)
  const hasNewText = newText.trim().length > 0

  async function persist(proxyList: string, isEnabled: boolean, successText: string) {
    if (!storeId || loadError) return
    setSaving(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('store_proxy_settings').upsert({
        store_id: storeId,
        proxy_list: proxyList,
        enabled: isEnabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id' })
      if (error) throw new Error(error.message)
      setSavedList(proxyList)
      setSavedEnabled(isEnabled)
      setNewText('')
      setConfirmClear(false)
      setMessage({ type: 'success', text: successText })
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Failed to save') })
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (hasNewText && newParsed.valid === 0) {
      setMessage({ type: 'error', text: 'None of the new lines is a valid proxy — nothing was saved.' })
      return
    }
    // An empty textarea never touches the saved lines: only the on/off switch is saved.
    let nextList = savedList
    if (hasNewText) {
      if (mode === 'replace') {
        nextList = proxyLines(newText).join('\n')
      } else {
        const seen = new Set(savedLines)
        const merged = [...savedLines]
        for (const line of proxyLines(newText)) {
          if (!seen.has(line)) { seen.add(line); merged.push(line) }
        }
        nextList = merged.join('\n')
      }
    }
    const count = countValidProxyLines(nextList).valid
    await persist(nextList, enabled, `Saved. Fallback list: ${count} prox${count === 1 ? 'y' : 'ies'}, ${enabled ? 'enabled' : 'disabled'}.`)
  }

  async function clearList() {
    await persist('', enabled, 'Saved fallback proxy list cleared.')
  }

  // Runs up to 3 rounds (each up to 30 Amazon page loads spread over the proxies) against real
  // ASINs from this store's active listings. Nothing is saved or changed by the test. With an
  // empty textarea the server tests the SAVED list itself (credentials never leave the server).
  async function runTest() {
    const testCount = hasNewText ? newParsed.valid : savedParsed.valid
    if (!storeId || testCount === 0) return
    setTesting(true)
    setTestError(null)
    setTestRows([])
    try {
      const { data: rows, error: rowsErr } = await supabase
        .from('listings')
        .select('asin')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .not('asin', 'is', null)
        .limit(300)
      if (rowsErr) throw new Error(`Could not read listings for the test: ${rowsErr.message}`)
      const pool = Array.from(new Set(((rows || []) as Array<{ asin: string | null }>).map(r => String(r.asin || '').toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a))))
      const merged = new Map<string, ProxyTestRow>()
      const rounds = 3
      for (let round = 1; round <= rounds; round++) {
        setTestProgress(`Round ${round}/${rounds}…`)
        const sample = pool.sort(() => Math.random() - 0.5).slice(0, 10)
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/amazon-fetch`, {
          method: 'POST',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin: 'TEST_PROXY_LIST', store_id: storeId, proxies: hasNewText ? newText : '', test_asins: sample }),
        })
        const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; results?: ProxyTestRow[] }
        if (!res.ok || !data.success || !data.results) throw new Error(data.error || `Test failed (HTTP ${res.status}). Is the new amazon-fetch deployed?`)
        for (const r of data.results) {
          const prev = merged.get(r.proxy)
          merged.set(r.proxy, prev
            ? { ...prev, ip: prev.ip || r.ip, ipError: prev.ip ? '' : r.ipError, probes: prev.probes.concat(r.probes) }
            : r)
        }
        setTestRows(Array.from(merged.values()))
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTesting(false)
      setTestProgress('')
    }
  }

  const allProbes = testRows.flatMap(r => r.probes)
  const okCount = allProbes.filter(p => p.outcome === 'ok').length
  const captchaCount = allProbes.filter(p => p.outcome === 'captcha' || p.outcome === 'blocked').length
  const foreignCount = allProbes.filter(p => p.outcome === 'wrong_country').length
  const failCount = allProbes.length - okCount - captchaCount - foreignCount
  const okPct = allProbes.length ? Math.round((okCount / allProbes.length) * 100) : 0
  const okProbes = allProbes.filter(p => p.outcome === 'ok')
  const avgMs = okProbes.length ? Math.round(okProbes.reduce((a, p) => a + p.ms, 0) / okProbes.length) : 0

  if (connectedStores.length === 0) {
    return <p className="text-sm text-slate-500">Connect an eBay store first.</p>
  }
  if (loading) return <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
  if (loadError) return <LoadErrorBox text={loadError} onRetry={() => setReloadKey(k => k + 1)} />

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
        <Info className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600">
          Uploads and Amazon price/stock checks now use the Webshare proxy IPs configured on the server (the AMAZON_PROXIES secret) — nothing here is needed for that.
          This per-store list is only a <span className="font-medium">fallback</span> for the server's last-resort direct scrape, and it is currently
          {' '}<span className={cn('font-medium', savedEnabled ? 'text-success-700' : 'text-slate-900')}>{savedEnabled ? 'enabled' : 'disabled'}</span> for {storeLabel(activeStore)}.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={setEnabled} />
        <span className="text-sm text-slate-700">Use this fallback list for {storeLabel(activeStore)}</span>
        {enabled !== savedEnabled && <span className="text-xs text-amber-600">(unsaved)</span>}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="label">Saved proxies ({savedParsed.valid} valid)</p>
          {savedLines.length > 0 && !confirmClear && (
            <button className="text-xs font-medium text-error-600 hover:text-error-700" onClick={() => setConfirmClear(true)} disabled={saving}>Clear list</button>
          )}
        </div>
        {savedLines.length > 0 ? (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
            {savedLines.map((line, i) => <li key={`${i}-${line.length}`}>{maskProxyLine(line)}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-500">No proxies saved for this store.</p>
        )}
        {confirmClear && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs text-error-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">Delete all {savedLines.length} saved proxy line{savedLines.length === 1 ? '' : 's'} for this store? This cannot be undone.</span>
            <button className="btn-ghost text-xs" onClick={() => setConfirmClear(false)} disabled={saving}>Cancel</button>
            <button className="btn-danger text-xs" onClick={() => void clearList()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Clear list
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="label" htmlFor="proxy-new-lines">Add or replace proxies (one per line)</label>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <label className="inline-flex items-center gap-1"><input type="radio" name="proxy-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add to saved list</label>
            <label className="inline-flex items-center gap-1"><input type="radio" name="proxy-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace saved list</label>
          </div>
        </div>
        <textarea
          id="proxy-new-lines"
          rows={6}
          className="input font-mono text-xs"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder={'ip:port:username:password\n38.154.0.1:5868:myuser:mypass\nsocks5://myuser:mypass@38.154.0.2:6000'}
          spellCheck={false}
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-slate-500">
          {hasNewText ? <>{newParsed.valid} valid new prox{newParsed.valid === 1 ? 'y' : 'ies'}</> : 'Leave empty to keep the saved list as it is (Save then only stores the on/off switch).'}
          {newParsed.invalid.length > 0 && <span className="text-error-600"> · {newParsed.invalid.length} line{newParsed.invalid.length === 1 ? '' : 's'} not understood</span>}
          {' '}· Formats: ip:port:user:pass, user:pass@ip:port, http://… or socks5://…
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => void save()} disabled={saving || testing}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : hasNewText ? (mode === 'replace' ? 'Save (replace list)' : 'Save (add to list)') : 'Save'}
        </button>
        <button className="btn-secondary" onClick={() => void runTest()} disabled={testing || (hasNewText ? newParsed.valid === 0 : savedParsed.valid === 0)}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {testing ? `Testing… ${testProgress}` : hasNewText ? 'Test new proxies on Amazon' : 'Test saved proxies on Amazon'}
        </button>
        <NoticeText notice={message} />
      </div>
      <p className="text-xs text-slate-400">The test uses the new lines typed above, or the saved list when the box is empty (no need to save first), and loads real product pages from this store's listings. It takes about a minute. Use US proxies only.</p>

      {testError && (
        <div className="flex items-start gap-2 text-sm text-error-600 bg-error-50 rounded-lg px-4 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {testError}
        </div>
      )}

      {testRows.length > 0 && (
        <div className="space-y-3">
          <div className={cn('rounded-lg px-4 py-3 text-sm', okPct >= 90 ? 'bg-success-50 text-success-700' : okPct >= 60 ? 'bg-amber-50 text-amber-800' : 'bg-error-50 text-error-700')}>
            <p className="font-semibold">
              {okPct}% of {allProbes.length} Amazon pages loaded correctly
              {avgMs > 0 && <span className="font-normal"> · average {(avgMs / 1000).toFixed(1)}s</span>}
            </p>
            <p className="text-xs mt-0.5">
              {okCount} OK · {captchaCount} CAPTCHA/blocked{foreignCount > 0 ? ` · ${foreignCount} from non-US IPs` : ''} · {failCount} connection errors/timeouts.{' '}
              {okPct >= 90 ? 'These proxies work for Amazon.' : okPct >= 60 ? 'Usable, but expect retries.' : 'Not suitable for Amazon — try other proxies.'}
            </p>
            {foreignCount > 0 && (
              <p className="text-xs mt-1 font-medium">
                Remove the proxies marked "Not a US IP" — amazon.com shows other prices and hides Add to Cart for other countries, so they are never used for stock checks.
              </p>
            )}
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50">
                  <th className="px-3 py-2 font-medium">Proxy</th>
                  <th className="px-3 py-2 font-medium">Exit IP</th>
                  <th className="px-3 py-2 font-medium">Amazon delivers to</th>
                  <th className="px-3 py-2 font-medium">Amazon results</th>
                  <th className="px-3 py-2 font-medium">Avg time</th>
                </tr>
              </thead>
              <tbody>
                {testRows.map(r => {
                  const counts: Record<string, number> = {}
                  for (const p of r.probes) counts[p.outcome] = (counts[p.outcome] || 0) + 1
                  const ok = r.probes.filter(p => p.outcome === 'ok')
                  const avg = ok.length ? ok.reduce((a, p) => a + p.ms, 0) / ok.length : 0
                  return (
                    <tr key={r.proxy} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.proxy}<span className="text-slate-400"> · {r.scheme}</span></td>
                      <td className="px-3 py-2 font-mono text-xs">{r.ip || <span className="text-error-600">{r.ipError || 'no answer'}</span>}</td>
                      <td className="px-3 py-2 text-xs">{r.probes.find(p => p.location)?.location || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {Object.entries(counts).map(([k, n]) => (
                          <span key={k} className={cn('mr-2', k === 'ok' ? 'text-success-600' : 'text-error-600')}>{PROXY_OUTCOME_LABEL[k] || k} {n}</span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-xs">{avg ? `${(avg / 1000).toFixed(1)}s` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
