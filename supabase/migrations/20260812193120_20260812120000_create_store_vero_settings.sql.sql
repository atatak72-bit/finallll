/*
# Create store_vero_settings table

## Overview
Per-store VeRO / keyword filter configuration: remove-keywords list,
block-keywords list with location toggles, block-ASIN list, and brand
auto-strip/replace toggles.

## New Table: store_vero_settings
- id (uuid, primary key)
- store_id (text, not null, unique)
- remove_keywords (text[], default '{}') — stripped from title/description
- block_keywords (text[], default '{}') — VeRO/copyright block list
- block_in_brand (boolean, default true)
- block_in_title (boolean, default true)
- block_in_description (boolean, default true)
- block_asins (text[], default '{}') — ASIN block list
- auto_remove_brand (boolean, default false)
- auto_replace_brand (boolean, default false)
- created_at, updated_at (timestamptz)

## Security
RLS enabled, anon+authenticated CRUD (no-auth pattern).
*/

CREATE TABLE IF NOT EXISTS store_vero_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  remove_keywords text[] NOT NULL DEFAULT '{}',
  block_keywords text[] NOT NULL DEFAULT '{}',
  block_in_brand boolean NOT NULL DEFAULT true,
  block_in_title boolean NOT NULL DEFAULT true,
  block_in_description boolean NOT NULL DEFAULT true,
  block_asins text[] NOT NULL DEFAULT '{}',
  auto_remove_brand boolean NOT NULL DEFAULT false,
  auto_replace_brand boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_vero_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_store_vero_settings" ON store_vero_settings;
CREATE POLICY "select_store_vero_settings" ON store_vero_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_store_vero_settings" ON store_vero_settings;
CREATE POLICY "insert_store_vero_settings" ON store_vero_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_store_vero_settings" ON store_vero_settings;
CREATE POLICY "update_store_vero_settings" ON store_vero_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_store_vero_settings" ON store_vero_settings;
CREATE POLICY "delete_store_vero_settings" ON store_vero_settings FOR DELETE
  TO anon, authenticated USING (true);
