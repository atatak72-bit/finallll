/*
# Extend bulk_runs with per-batch overrides

## Overview
Adds the fields needed for the enhanced Bulk Add screen: per-batch business
policy overrides, a per-batch VeRO bypass, a draft-only mode, and a
completed_at timestamp so Bulk Status can show real completion times.

## Modified Tables
1. `bulk_runs`
   - `fulfillment_policy_id` (text) — overrides the store default for this batch only
   - `payment_policy_id` (text)
   - `return_policy_id` (text)
   - `category_id` (text) — overrides the store's default eBay category for this batch
   - `allow_vero` (boolean) — if true, skip VeRO keyword filtering for this batch
   - `draft_only` (boolean) — if true, items are saved as drafts instead of published live
   - `completed_at` (timestamptz)
*/

ALTER TABLE bulk_runs
  ADD COLUMN IF NOT EXISTS fulfillment_policy_id text,
  ADD COLUMN IF NOT EXISTS payment_policy_id text,
  ADD COLUMN IF NOT EXISTS return_policy_id text,
  ADD COLUMN IF NOT EXISTS category_id text,
  ADD COLUMN IF NOT EXISTS allow_vero boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS draft_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
