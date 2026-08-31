/*
# Create pricing_rules table for per-store range repricing tiers

## Overview
Replaces the fixed tier1/tier2/tier3 columns on the singleton `settings` table
with a flexible, per-store table of repricing tiers. Each row is one price
range with its own profit %, fixed profit, and min/max bounds. Tiers are
ordered by `sort_order` so the UI can add/remove/reorder rows freely.

## New Table: pricing_rules
- id (uuid, primary key)
- store_id (text, not null) — references ebay_tokens.id conceptually
- min_price (numeric, not null, default 0) — "From ($)"
- max_price (numeric, not null) — "To ($)"
- profit_pct (numeric, not null, default 20) — profit percentage
- fixed_profit (numeric, not null, default 0) — fixed dollar profit
- sort_order (integer, not null, default 0) — display/eval order
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
RLS enabled. This is a no-auth single-tenant app, so anon + authenticated
CRUD is allowed (data is intentionally shared across the operator's stores).
*/

CREATE TABLE IF NOT EXISTS pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  min_price numeric NOT NULL DEFAULT 0,
  max_price numeric NOT NULL,
  profit_pct numeric NOT NULL DEFAULT 20,
  fixed_profit numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_pricing_rules" ON pricing_rules;
CREATE POLICY "select_pricing_rules" ON pricing_rules FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_pricing_rules" ON pricing_rules;
CREATE POLICY "insert_pricing_rules" ON pricing_rules FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_pricing_rules" ON pricing_rules;
CREATE POLICY "update_pricing_rules" ON pricing_rules FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_pricing_rules" ON pricing_rules;
CREATE POLICY "delete_pricing_rules" ON pricing_rules FOR DELETE
  TO anon, authenticated USING (true);
