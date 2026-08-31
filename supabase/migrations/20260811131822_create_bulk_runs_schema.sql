/*
# Create bulk run tables for batch Amazon product fetching and publishing

## Overview
Adds two new tables to support the bulk add feature in the app:
- `bulk_runs` tracks each batch operation (name, type, status, progress)
- `bulk_run_items` tracks each individual ASIN within a batch run

## New Tables

1. `bulk_runs` — A batch of ASINs to fetch from Amazon and publish to eBay
   - `id` (uuid, PK)
   - `store_id` (uuid, FK to ebay_tokens)
   - `name` (text) — user-given or auto-generated run name
   - `type` (text) — one-time / scheduled / drip
   - `status` (text) — running / completed / failed / paused
   - `total` (integer) — total number of items in the run
   - `succeeded` (integer, default 0)
   - `failed` (integer, default 0)
   - `promoted` (boolean, default false) — whether to add items to eBay Promoted Listings
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

2. `bulk_run_items` — Individual ASINs within a bulk run
   - `id` (uuid, PK)
   - `run_id` (uuid, FK to bulk_runs, ON DELETE CASCADE)
   - `asin` (text) — Amazon ASIN to fetch
   - `custom_title` (text, nullable) — optional title override
   - `title` (text, nullable) — fetched product title
   - `status` (text) — pending / success / failed
   - `error` (text, nullable) — failure reason
   - `image` (text, nullable) — fetched product image
   - `amazon_price` (numeric, default 0)
   - `ebay_price` (numeric, default 0)
   - `created_at` (timestamptz)

## Security
- RLS enabled on both tables
- Single-tenant (no auth) — policies use `TO anon, authenticated` with `USING (true)`
- All CRUD operations allowed for anon + authenticated roles
*/

CREATE TABLE IF NOT EXISTS bulk_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES ebay_tokens(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Bulk Run',
  type text NOT NULL DEFAULT 'one-time',
  status text NOT NULL DEFAULT 'running',
  total integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  promoted boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bulk_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_bulk_runs" ON bulk_runs;
CREATE POLICY "anon_select_bulk_runs" ON bulk_runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_bulk_runs" ON bulk_runs;
CREATE POLICY "anon_insert_bulk_runs" ON bulk_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_bulk_runs" ON bulk_runs;
CREATE POLICY "anon_update_bulk_runs" ON bulk_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_bulk_runs" ON bulk_runs;
CREATE POLICY "anon_delete_bulk_runs" ON bulk_runs FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS bulk_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,
  asin text NOT NULL,
  custom_title text,
  title text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  image text,
  amazon_price numeric DEFAULT 0,
  ebay_price numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bulk_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_bulk_run_items" ON bulk_run_items;
CREATE POLICY "anon_select_bulk_run_items" ON bulk_run_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_bulk_run_items" ON bulk_run_items;
CREATE POLICY "anon_insert_bulk_run_items" ON bulk_run_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_bulk_run_items" ON bulk_run_items;
CREATE POLICY "anon_update_bulk_run_items" ON bulk_run_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_bulk_run_items" ON bulk_run_items;
CREATE POLICY "anon_delete_bulk_run_items" ON bulk_run_items FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_bulk_runs_store_id ON bulk_runs(store_id);
CREATE INDEX IF NOT EXISTS idx_bulk_run_items_run_id ON bulk_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_bulk_runs_created_at ON bulk_runs(created_at);
