/*
# Create store_promoted_settings table

## Overview
Stores per-store Promoted Listings configuration: whether auto-promote is
enabled and the default ad rate percentage applied to every newly published
listing. One row per store, linked by store_id.

## New Table: store_promoted_settings
- id (uuid, primary key)
- store_id (text, not null, unique) — one settings row per store
- auto_promote_enabled (boolean, not null, default true) — master toggle
- default_ad_rate (numeric, not null, default 2.5) — ad rate percentage (1-100)
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
RLS enabled on store_promoted_settings. Single-tenant no-auth app:
anon + authenticated CRUD allowed (matches pricing_settings / availability pattern).
*/

CREATE TABLE IF NOT EXISTS store_promoted_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  auto_promote_enabled boolean NOT NULL DEFAULT true,
  default_ad_rate numeric NOT NULL DEFAULT 2.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_promoted_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_store_promoted_settings" ON store_promoted_settings;
CREATE POLICY "select_store_promoted_settings" ON store_promoted_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_store_promoted_settings" ON store_promoted_settings;
CREATE POLICY "insert_store_promoted_settings" ON store_promoted_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_store_promoted_settings" ON store_promoted_settings;
CREATE POLICY "update_store_promoted_settings" ON store_promoted_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_store_promoted_settings" ON store_promoted_settings;
CREATE POLICY "delete_store_promoted_settings" ON store_promoted_settings FOR DELETE
  TO anon, authenticated USING (true);
