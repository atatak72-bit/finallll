/*
# Create store_availability_settings table + last_sold_at on listings

## Overview
Adds per-store availability/stock rules: default listing quantity, Prime-only
filter, cross-store ASIN dedup, out-of-stock behavior, and auto-delist for cold
products. Also adds a `last_sold_at` column to `listings` so the cold-product
cron can compute days-without-sales from the last sale (falling back to
listed_date when a listing has never sold).

## New Table: store_availability_settings
- id (uuid, primary key)
- store_id (text, not null, unique) — one settings row per store
- default_quantity (integer, not null, default 3) — initial eBay stock per listing
- prime_filter (boolean, not null, default false) — only allow Amazon Prime/FBA items
- allow_duplicate_asins (boolean, not null, default false) — same ASIN across stores
- allow_out_of_stock (boolean, not null, default true) — set stock 0 vs delete on Amazon OOS
- auto_delist_enabled (boolean, not null, default false) — master toggle for cold-product delist
- days_without_sales (integer, not null, default 30) — cold threshold in days
- created_at (timestamptz)
- updated_at (timestamptz)

## Modified Table: listings
- last_sold_at (timestamptz, nullable) — timestamp of most recent sale; null if never sold

## Security
RLS enabled on store_availability_settings. Single-tenant no-auth app:
anon + authenticated CRUD allowed (matches pricing_settings pattern).
*/

CREATE TABLE IF NOT EXISTS store_availability_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  default_quantity integer NOT NULL DEFAULT 3,
  prime_filter boolean NOT NULL DEFAULT false,
  allow_duplicate_asins boolean NOT NULL DEFAULT false,
  allow_out_of_stock boolean NOT NULL DEFAULT true,
  auto_delist_enabled boolean NOT NULL DEFAULT false,
  days_without_sales integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_availability_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_store_availability_settings" ON store_availability_settings;
CREATE POLICY "select_store_availability_settings" ON store_availability_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_store_availability_settings" ON store_availability_settings;
CREATE POLICY "insert_store_availability_settings" ON store_availability_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_store_availability_settings" ON store_availability_settings;
CREATE POLICY "update_store_availability_settings" ON store_availability_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_store_availability_settings" ON store_availability_settings;
CREATE POLICY "delete_store_availability_settings" ON store_availability_settings FOR DELETE
  TO anon, authenticated USING (true);

-- Add last_sold_at to listings (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'last_sold_at'
  ) THEN
    ALTER TABLE listings ADD COLUMN last_sold_at timestamptz;
  END IF;
END $$;

-- Index for the cold-product cron query
CREATE INDEX IF NOT EXISTS idx_listings_status_store ON listings (status, store_id);
