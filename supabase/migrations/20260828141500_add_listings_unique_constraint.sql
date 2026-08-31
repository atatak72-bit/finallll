/*
# Add missing unique constraint on listings(store_id, ebay_id)

## Overview
`ebay-sync`'s publish handler (and the new Import feature) upsert into
`listings` using `onConflict: "store_id,ebay_id"`, but no matching unique
constraint existed. In Postgres, upsert with onConflict silently errors
without a matching unique/exclusion constraint — and since the calling code
didn't check the error, some successfully-published-to-eBay listings may
never have been saved locally. This adds the missing constraint.

Rows with a NULL ebay_id (drafts) are unaffected — Postgres treats each NULL
as distinct for uniqueness purposes, so multiple drafts can coexist.
*/

-- Defensive: if duplicate (store_id, ebay_id) rows already exist from the
-- silent-failure bug, keep only the most recently updated one per pair
-- before adding the constraint (otherwise CREATE UNIQUE INDEX would fail).
DELETE FROM listings a USING listings b
WHERE a.ebay_id IS NOT NULL
  AND a.store_id = b.store_id
  AND a.ebay_id = b.ebay_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS listings_store_ebay_id_unique
  ON listings (store_id, ebay_id);
