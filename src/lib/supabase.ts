import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface EbayTokenRow {
  id: string
  store_nickname: string
  ebay_username: string | null
  connected: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface ListingRow {
  id: string
  store_id: string
  ebay_id: string | null
  title: string
  asin: string | null
  amazon_price: number
  ebay_price: number
  quantity: number
  status: string
  image: string | null
  listed_date: string | null
  sold_count: number
  promoted: boolean
  created_at: string
  updated_at: string
}

export interface OrderRow {
  id: string
  store_id: string
  order_id: string | null
  buyer_name: string | null
  buyer_username: string | null
  listing_title: string | null
  listing_image: string | null
  asin: string | null
  ebay_price: number
  amazon_cost: number
  profit: number
  status: string
  order_date: string | null
  ship_to_name: string | null
  ship_to_street: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  ship_to_zip: string | null
  ship_to_country: string | null
  tracking_number: string | null
  tracking_carrier: string | null
  notes: string
  created_at: string
}

export interface ConversationRow {
  id: string
  store_id: string
  buyer_name: string | null
  buyer_username: string | null
  listing_title: string | null
  last_message: string | null
  last_message_date: string | null
  unread: boolean
  ebay_message_id: string | null
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  conversation_id: string
  from: string
  body: string
  date: string
  created_at: string
}

export interface RevisionRow {
  id: string
  store_id: string
  listing_title: string | null
  field: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  date: string
  created_at: string
}

export interface SettingsRow {
  id: string
  tier1_markup: number
  tier2_markup: number
  tier3_markup: number
  tier1_threshold: number
  tier2_threshold: number
  ebay_final_value_fee: number
  ebay_payment_fee: number
  auto_list_enabled: boolean
  auto_reprice_enabled: boolean
  auto_reprice_interval: number
  description_template: string
  message_template: string
  keyword_filter_mode: string
  keyword_filters: string
  created_at: string
  updated_at: string
}

export interface BulkRunRow {
  id: string
  store_id: string
  name: string
  type: string
  status: string
  total: number
  succeeded: number
  failed: number
  promoted: boolean
  draft_only: boolean
  allow_vero: boolean
  fulfillment_policy_id: string | null
  payment_policy_id: string | null
  return_policy_id: string | null
  category_id: string | null
  ai_titles: boolean
  ad_rate: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface BulkRunItemRow {
  id: string
  run_id: string
  asin: string
  custom_title: string | null
  title: string | null
  status: string
  error: string | null
  image: string | null
  amazon_price: number
  ebay_price: number
  created_at: string
}
