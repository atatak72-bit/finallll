/*
# Add last_stock_check to listings

## Overview
Needed for the new automatic stock/price sync job — lets it pick the listings
that haven't been checked in the longest time, batch by batch, instead of
re-checking everything (or the same items) every run.

## Modified Tables
1. `listings`
   - `last_stock_check` (timestamptz) — when this listing's Amazon source was last re-checked
*/

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS last_stock_check timestamptz;

CREATE INDEX IF NOT EXISTS idx_listings_last_stock_check ON listings (last_stock_check NULLS FIRST);
