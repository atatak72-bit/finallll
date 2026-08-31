/*
# Add sku_hint to listings

## Overview
When syncing pre-existing eBay listings that weren't created through this app
(via the new /sync-all-listings route), we don't know the Amazon ASIN yet.
If the listing already had a SKU set on eBay, it's saved here as a hint —
useful context when manually linking the listing to its Amazon source later.

## Modified Tables
1. `listings`
   - `sku_hint` (text) — the SKU eBay already had on file for this item, if any
*/

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS sku_hint text;
