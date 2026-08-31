/*
# Add default eBay category to store_policies

## Overview
eBay requires a valid categoryId to publish any offer. The app had no way to
select or store one, which would make every publish call fail. This adds a
per-store "default category" that is used automatically whenever a listing
is published without an explicit category.

## Modified Tables
1. `store_policies`
   - `default_category_id` (text) — eBay leaf category ID used for publishing
   - `default_category_name` (text) — human-readable label shown in the UI

## Security
- No security changes — RLS already enabled with existing policies.
- New columns are nullable/optional with safe defaults.
*/

ALTER TABLE store_policies
  ADD COLUMN IF NOT EXISTS default_category_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_category_name text DEFAULT '';
