/*
# Create store_policies table

## Overview
Adds a new table to store eBay business policy settings per connected store.
Each connected eBay store can have its own payment, return, and shipping policy
configuration. This lets the eBay Policies settings tab reflect the actual
connected account name and persist policy selections per store.

## New Tables
1. `store_policies`
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens, unique) — one policy row per store
   - `payment_policy_name` (text) — eBay payment policy name/ID
   - `return_policy_name` (text) — eBay return policy name/ID
   - `shipping_policy_name` (text) — eBay shipping policy name/ID
   - `return_days` (integer, default 30) — accepted return window in days
   - `restocking_fee_pct` (numeric, default 0) — restocking fee percentage
   - `buyer_pays_return_shipping` (boolean, default true) — who pays return shipping
   - `domestic_shipping_service` (text) — default domestic shipping service
   - `domestic_shipping_cost` (numeric, default 0) — default domestic shipping cost
   - `international_shipping_enabled` (boolean, default false)
   - `international_shipping_service` (text) — default international shipping service
   - `international_shipping_cost` (numeric, default 0)
   - `handling_time_days` (integer, default 1) — dispatch/handling time
   - `cash_on_delivery` (boolean, default false)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## Security
- RLS enabled on `store_policies`.
- Single-tenant (no auth) — all policies use `TO anon, authenticated` with `USING (true)`.
- All CRUD operations allowed for anon + authenticated roles.

## Important Notes
1. One row per store (unique constraint on `store_id`).
2. When a new store is connected via the Add Store flow, a policy row is not
   automatically created — it is created on first save from the UI.
3. The `store_id` foreign key cascades on delete — disconnecting a store
   removes its policy row.
*/

CREATE TABLE IF NOT EXISTS store_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid UNIQUE REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  payment_policy_name text DEFAULT '',
  return_policy_name text DEFAULT '',
  shipping_policy_name text DEFAULT '',
  return_days integer DEFAULT 30,
  restocking_fee_pct numeric DEFAULT 0,
  buyer_pays_return_shipping boolean DEFAULT true,
  domestic_shipping_service text DEFAULT 'USPS Ground Advantage',
  domestic_shipping_cost numeric DEFAULT 0,
  international_shipping_enabled boolean DEFAULT false,
  international_shipping_service text DEFAULT '',
  international_shipping_cost numeric DEFAULT 0,
  handling_time_days integer DEFAULT 1,
  cash_on_delivery boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE store_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_store_policies" ON store_policies;
CREATE POLICY "anon_select_store_policies" ON store_policies FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_store_policies" ON store_policies;
CREATE POLICY "anon_insert_store_policies" ON store_policies FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_store_policies" ON store_policies;
CREATE POLICY "anon_update_store_policies" ON store_policies FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_store_policies" ON store_policies;
CREATE POLICY "anon_delete_store_policies" ON store_policies FOR DELETE
  TO anon, authenticated USING (true);
