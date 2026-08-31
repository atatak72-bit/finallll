/*
# eBay API Integration Schema

## Overview
Creates the full database schema to support real eBay API integration:
- Stores eBay OAuth tokens securely
- Stores synced eBay listings, orders, conversations, and messages
- Tracks price/quantity/status revisions made by the system
- Stores user pricing/filter settings

## New Tables

1. `ebay_tokens` — Stores OAuth access/refresh tokens for each eBay store connection
   - `id` (uuid, PK)
   - `store_nickname` (text) — user-friendly name for the store
   - `ebay_username` (text) — eBay seller account username
   - `access_token` (text) — eBay API access token
   - `refresh_token` (text) — eBay API refresh token (long-lived)
   - `token_expires_at` (timestamptz) — when access_token expires
   - `refresh_token_expires_at` (timestamptz) — when refresh_token expires
   - `connected` (boolean, default true) — whether this store is currently connected
   - `active` (boolean, default false) — whether this store is currently selected for operations
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

2. `listings` — Synced eBay listings
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens)
   - `ebay_id` (text) — eBay listing ID
   - `title` (text)
   - `asin` (text) — Amazon ASIN for sourcing
   - `amazon_price` (numeric) — current Amazon source price
   - `ebay_price` (numeric) — current eBay listing price
   - `quantity` (integer)
   - `status` (text) — active/draft/ended/out_of_stock/unknown
   - `image` (text) — image URL
   - `listed_date` (timestamptz)
   - `sold_count` (integer, default 0)
   - `promoted` (boolean, default false)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

3. `orders` — Synced eBay orders
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens)
   - `order_id` (text) — eBay order ID
   - `buyer_name` (text)
   - `buyer_username` (text)
   - `listing_title` (text)
   - `listing_image` (text)
   - `asin` (text)
   - `ebay_price` (numeric)
   - `amazon_cost` (numeric)
   - `profit` (numeric)
   - `status` (text) — pending/shipped/delivered/cancelled
   - `order_date` (timestamptz)
   - `ship_to_name` (text)
   - `ship_to_street` (text)
   - `ship_to_city` (text)
   - `ship_to_state` (text)
   - `ship_to_zip` (text)
   - `ship_to_country` (text)
   - `tracking_number` (text, nullable)
   - `tracking_carrier` (text, nullable)
   - `notes` (text, default '')
   - `created_at` (timestamptz)

4. `conversations` — eBay buyer-seller message threads
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens)
   - `buyer_name` (text)
   - `buyer_username` (text)
   - `listing_title` (text)
   - `last_message` (text)
   - `last_message_date` (timestamptz)
   - `unread` (boolean, default false)
   - `ebay_message_id` (text) — eBay's message thread ID
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

5. `messages` — Individual messages within conversations
   - `id` (uuid, PK)
   - `conversation_id` (uuid, FK to conversations)
   - `from` (text) — 'buyer' or 'seller'
   - `body` (text)
   - `date` (timestamptz)
   - `created_at` (timestamptz)

6. `revisions` — Price/quantity/status change log
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens)
   - `listing_title` (text)
   - `field` (text) — price/quantity/status
   - `old_value` (text)
   - `new_value` (text)
   - `reason` (text)
   - `date` (timestamptz)
   - `created_at` (timestamptz)

7. `settings` — User-level app settings (pricing, filters, templates)
   - `id` (uuid, PK, default gen_random_uuid())
   - `tier1_markup` (numeric, default 15)
   - `tier2_markup` (numeric, default 25)
   - `tier3_markup` (numeric, default 35)
   - `tier1_threshold` (numeric, default 25)
   - `tier2_threshold` (numeric, default 100)
   - `ebay_final_value_fee` (numeric, default 13.25)
   - `ebay_payment_fee` (numeric, default 0.30)
   - `auto_list_enabled` (boolean, default true)
   - `auto_reprice_enabled` (boolean, default true)
   - `auto_reprice_interval` (integer, default 30)
   - `description_template` (text, default '')
   - `message_template` (text, default '')
   - `keyword_filter_mode` (text, default 'exclude')
   - `keyword_filters` (text, default '')
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Security
- RLS enabled on all tables
- Single-tenant (no auth) — all policies use `TO anon, authenticated` with `USING (true)` since this is a no-auth app
- All CRUD operations allowed for anon + authenticated roles
*/

-- ebay_tokens
CREATE TABLE IF NOT EXISTS ebay_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_nickname text NOT NULL DEFAULT 'My Store',
  ebay_username text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE ebay_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_ebay_tokens" ON ebay_tokens;
CREATE POLICY "anon_select_ebay_tokens" ON ebay_tokens FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ebay_tokens" ON ebay_tokens;
CREATE POLICY "anon_insert_ebay_tokens" ON ebay_tokens FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ebay_tokens" ON ebay_tokens;
CREATE POLICY "anon_update_ebay_tokens" ON ebay_tokens FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ebay_tokens" ON ebay_tokens;
CREATE POLICY "anon_delete_ebay_tokens" ON ebay_tokens FOR DELETE TO anon, authenticated USING (true);

-- listings
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  ebay_id text,
  title text NOT NULL,
  asin text,
  amazon_price numeric DEFAULT 0,
  ebay_price numeric DEFAULT 0,
  quantity integer DEFAULT 0,
  status text DEFAULT 'unknown',
  image text,
  listed_date timestamptz,
  sold_count integer DEFAULT 0,
  promoted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_listings" ON listings;
CREATE POLICY "anon_select_listings" ON listings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_listings" ON listings;
CREATE POLICY "anon_insert_listings" ON listings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_listings" ON listings;
CREATE POLICY "anon_update_listings" ON listings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_listings" ON listings;
CREATE POLICY "anon_delete_listings" ON listings FOR DELETE TO anon, authenticated USING (true);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  order_id text,
  buyer_name text,
  buyer_username text,
  listing_title text,
  listing_image text,
  asin text,
  ebay_price numeric DEFAULT 0,
  amazon_cost numeric DEFAULT 0,
  profit numeric DEFAULT 0,
  status text DEFAULT 'pending',
  order_date timestamptz,
  ship_to_name text,
  ship_to_street text,
  ship_to_city text,
  ship_to_state text,
  ship_to_zip text,
  ship_to_country text,
  tracking_number text,
  tracking_carrier text,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
CREATE POLICY "anon_select_orders" ON orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_orders" ON orders;
CREATE POLICY "anon_update_orders" ON orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_orders" ON orders;
CREATE POLICY "anon_delete_orders" ON orders FOR DELETE TO anon, authenticated USING (true);

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  buyer_name text,
  buyer_username text,
  listing_title text,
  last_message text,
  last_message_date timestamptz,
  unread boolean DEFAULT false,
  ebay_message_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_conversations" ON conversations;
CREATE POLICY "anon_delete_conversations" ON conversations FOR DELETE TO anon, authenticated USING (true);

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  "from" text NOT NULL,
  body text NOT NULL,
  date timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_messages" ON messages;
CREATE POLICY "anon_update_messages" ON messages FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_messages" ON messages;
CREATE POLICY "anon_delete_messages" ON messages FOR DELETE TO anon, authenticated USING (true);

-- revisions
CREATE TABLE IF NOT EXISTS revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  listing_title text,
  field text,
  old_value text,
  new_value text,
  reason text,
  date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_revisions" ON revisions;
CREATE POLICY "anon_select_revisions" ON revisions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_revisions" ON revisions;
CREATE POLICY "anon_insert_revisions" ON revisions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_revisions" ON revisions;
CREATE POLICY "anon_update_revisions" ON revisions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_revisions" ON revisions;
CREATE POLICY "anon_delete_revisions" ON revisions FOR DELETE TO anon, authenticated USING (true);

-- settings (single row)
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier1_markup numeric DEFAULT 15,
  tier2_markup numeric DEFAULT 25,
  tier3_markup numeric DEFAULT 35,
  tier1_threshold numeric DEFAULT 25,
  tier2_threshold numeric DEFAULT 100,
  ebay_final_value_fee numeric DEFAULT 13.25,
  ebay_payment_fee numeric DEFAULT 0.30,
  auto_list_enabled boolean DEFAULT true,
  auto_reprice_enabled boolean DEFAULT true,
  auto_reprice_interval integer DEFAULT 30,
  description_template text DEFAULT '',
  message_template text DEFAULT '',
  keyword_filter_mode text DEFAULT 'exclude',
  keyword_filters text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_settings" ON settings;
CREATE POLICY "anon_select_settings" ON settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_settings" ON settings;
CREATE POLICY "anon_insert_settings" ON settings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_settings" ON settings;
CREATE POLICY "anon_update_settings" ON settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_settings" ON settings;
CREATE POLICY "anon_delete_settings" ON settings FOR DELETE TO anon, authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listings_store_id ON listings(store_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_conversations_store_id ON conversations(store_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_revisions_store_id ON revisions(store_id);
CREATE INDEX IF NOT EXISTS idx_revisions_date ON revisions(date);
