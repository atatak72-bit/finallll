/*
# Create pricing_settings table for per-store pricing configuration

## Overview
Stores per-store pricing configuration: whether pricing is enabled, the eBay
fee percentage and fixed fee, and the default Amazon source price for the
live example calculator. The tiered markup ranges continue to live in
`pricing_rules` (one row per range, ordered by sort_order).

## New Table: pricing_settings
- id (uuid, primary key)
- store_id (text, not null, unique) — one settings row per store
- pricing_enabled (boolean, not null, default true) — master toggle
- ebay_percentage_fee (numeric, not null, default 13.25)
- ebay_fixed_fee (numeric, not null, default 0.30)
- example_source_price (numeric, not null, default 10)
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
RLS enabled. Single-tenant no-auth app: anon + authenticated CRUD allowed.
*/

CREATE TABLE IF NOT EXISTS pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  pricing_enabled boolean NOT NULL DEFAULT true,
  ebay_percentage_fee numeric NOT NULL DEFAULT 13.25,
  ebay_fixed_fee numeric NOT NULL DEFAULT 0.30,
  example_source_price numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_pricing_settings" ON pricing_settings;
CREATE POLICY "select_pricing_settings" ON pricing_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_pricing_settings" ON pricing_settings;
CREATE POLICY "insert_pricing_settings" ON pricing_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_pricing_settings" ON pricing_settings;
CREATE POLICY "update_pricing_settings" ON pricing_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_pricing_settings" ON pricing_settings;
CREATE POLICY "delete_pricing_settings" ON pricing_settings FOR DELETE
  TO anon, authenticated USING (true);
