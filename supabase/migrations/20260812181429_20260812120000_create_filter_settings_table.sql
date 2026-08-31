/*
# Create filter_settings table

## Overview
Per-store Amazon product filter preferences: shipping time ranges, minimum
rating, minimum review count, FBA-only toggle, and tax-in-profit toggle.

## Security
RLS enabled with anon+authenticated CRUD (no-auth app pattern).
*/

CREATE TABLE IF NOT EXISTS filter_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  shipping_time_ranges text[] NOT NULL DEFAULT '{}',
  min_rating numeric NOT NULL DEFAULT 4.0,
  min_review_count integer NOT NULL DEFAULT 1,
  fba_only boolean NOT NULL DEFAULT false,
  apply_tax boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE filter_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_filter_settings" ON filter_settings FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "insert_filter_settings" ON filter_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_filter_settings" ON filter_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_filter_settings" ON filter_settings FOR DELETE
  TO anon, authenticated USING (true);
