/*
# Extend store_policies with policy IDs and item location

## Overview
Adds columns to store_policies so the eBay Policies settings tab can:
- Store the selected eBay business policy IDs (payment, return, fulfillment/shipping)
  separately from their display names.
- Store item location fields (country, city, state, zip) per store so bulk
  listing operations can adopt the selected store's location automatically.

## Modified Tables
1. `store_policies`
   - `payment_policy_id` (text) — eBay payment policy ID
   - `return_policy_id` (text) — eBay return policy ID
   - `fulfillment_policy_id` (text) — eBay fulfillment (shipping) policy ID
   - `location_country` (text) — item location country code
   - `location_city` (text) — item location city
   - `location_state` (text) — item location state/province
   - `location_zip` (text) — item location postal code
   - `location_key` (text) — eBay merchantLocationKey for the stored location

## Security
- No security changes — RLS already enabled with anon+authenticated CRUD policies.
- All new columns are nullable/optional with safe defaults.

## Important Notes
1. Existing rows are not affected — new columns default to empty strings.
2. The old *_policy_name columns remain for backward compatibility but the UI
   will now use *_policy_id as the source of truth for selection.
*/

ALTER TABLE store_policies
  ADD COLUMN IF NOT EXISTS payment_policy_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS return_policy_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS fulfillment_policy_id text DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_country text DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_city text DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_state text DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_zip text DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_key text DEFAULT '';
