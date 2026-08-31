import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Periodically re-checks a batch of already-published listings against their live Amazon
// source: if the price changed, the eBay price is recalculated using the store's profit
// rules and pushed to eBay; if stock ran out or came back, the eBay quantity/status follows.
//
// This function does the WORK for one batch per invocation (default 25 listings) — it is
// meant to be called repeatedly on a schedule (Supabase Cron / pg_cron), not run once for
// everything, since scraping thousands of ASINs in one HTTP request would time out and would
// burn through the Oxylabs/ScraperAPI quota too fast.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PricingTier {
  min_price: number;
  max_price: number;
  profit_pct: number;
  fixed_profit: number;
}

function calculateEbayPrice(
  amazonCost: number,
  tiers: PricingTier[],
  pctFee: number,
  fixedFee: number,
  pricingEnabled: boolean,
): number {
  if (!pricingEnabled || tiers.length === 0) return amazonCost;
  const tier = tiers.find(t => amazonCost >= t.min_price && amazonCost < t.max_price) || tiers[tiers.length - 1];
  const netTarget = amazonCost * (1 + tier.profit_pct / 100) + tier.fixed_profit;
  const finalPrice = (netTarget + fixedFee) / (1 - pctFee / 100);
  return Math.round(finalPrice * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = Math.min(300, Math.max(1, Number(body.batch_size) || 25));

    // Pick the listings that haven't been checked in the longest time (or never), across
    // all stores, so every product eventually gets revisited regardless of which store it's in.
    const { data: dueListings, error: fetchErr } = await supabase
      .from("listings")
      .select("id, store_id, asin, ebay_id, amazon_price, ebay_price, quantity, status")
      .in("status", ["active", "out_of_stock"])
      .not("ebay_id", "is", null)
      .not("asin", "is", null)
      .order("last_stock_check", { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (fetchErr) {
      return new Response(JSON.stringify({ success: false, error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listings = dueListings || [];
    if (listings.length === 0) {
      return new Response(JSON.stringify({ success: true, checked: 0, message: "No listings due for a check." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache pricing settings per store so we don't refetch them for every single item.
    const pricingCache = new Map<string, { tiers: PricingTier[]; pctFee: number; fixedFee: number; enabled: boolean }>();
    async function getPricing(storeId: string) {
      if (pricingCache.has(storeId)) return pricingCache.get(storeId)!;
      const [settingsRes, tiersRes] = await Promise.all([
        supabase.from("pricing_settings").select("pricing_enabled, ebay_percentage_fee, ebay_fixed_fee").eq("store_id", storeId).maybeSingle(),
        supabase.from("pricing_rules").select("min_price, max_price, profit_pct, fixed_profit").eq("store_id", storeId).order("sort_order", { ascending: true }),
      ]);
      const result = {
        enabled: settingsRes.data?.pricing_enabled ?? true,
        pctFee: Number(settingsRes.data?.ebay_percentage_fee) || 13.25,
        fixedFee: Number(settingsRes.data?.ebay_fixed_fee) || 0.30,
        tiers: (tiersRes.data || []) as PricingTier[],
      };
      pricingCache.set(storeId, result);
      return result;
    }

    const results = { checked: 0, priceUpdated: 0, wentOutOfStock: 0, backInStock: 0, errors: [] as string[] };

    // Process items in parallel groups instead of one at a time — this is what lets a single
    // invocation get through a large batch_size within the function's time limit.
    const CONCURRENCY = 8;

    async function processOne(listing: typeof listings[number]) {
      results.checked++;
      const now = new Date().toISOString();

      try {
        // Reuse amazon-fetch so filters/availability rules stay consistent everywhere.
        const fetchRes = await fetch(`${SUPABASE_URL}/functions/v1/amazon-fetch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ asin: listing.asin, store_id: listing.store_id }),
        });
        const fetchData = await fetchRes.json().catch(() => ({}));

        if (!fetchData.success || !fetchData.product) {
          // Could be a genuine scrape failure, or the product no longer passes this store's
          // Filters/Availability rules — either way, don't touch the live listing, just log it
          // and move on. We still stamp last_stock_check so this item doesn't get retried forever.
          await supabase.from("listings").update({ last_stock_check: now }).eq("id", listing.id);
          results.errors.push(`${listing.asin}: ${fetchData.error || "fetch failed"}`);
          return;
        }

        const p = fetchData.product;
        const isOutOfStock = String(p.stock || "").toLowerCase().includes("out");
        const newAmazonPrice = Number(p.price) || 0;
        const oldAmazonPrice = Number(listing.amazon_price) || 0;

        const updates: Record<string, unknown> = { last_stock_check: now };
        let needsEbayPriceUpdate = false;
        let newEbayPrice = Number(listing.ebay_price) || 0;

        // Price changed on Amazon — recalculate the eBay price using this store's profit rules.
        if (newAmazonPrice > 0 && Math.abs(newAmazonPrice - oldAmazonPrice) > 0.01) {
          const pricing = await getPricing(listing.store_id);
          newEbayPrice = calculateEbayPrice(newAmazonPrice, pricing.tiers, pricing.pctFee, pricing.fixedFee, pricing.enabled);
          updates.amazon_price = newAmazonPrice;
          updates.ebay_price = newEbayPrice;
          needsEbayPriceUpdate = true;
          results.priceUpdated++;
        }

        // Stock status changed.
        const wasOutOfStock = listing.status === "out_of_stock" || Number(listing.quantity) === 0;
        if (isOutOfStock && !wasOutOfStock) {
          updates.status = "out_of_stock";
          updates.quantity = 0;
          results.wentOutOfStock++;
        } else if (!isOutOfStock && wasOutOfStock) {
          updates.status = "active";
          updates.quantity = Number(p.defaultQuantity) || 1;
          results.backInStock++;
        }

        // Push price/quantity changes to eBay itself (not just our local database).
        if (needsEbayPriceUpdate || updates.quantity !== undefined) {
          const updateRes = await fetch(`${SUPABASE_URL}/functions/v1/ebay-sync/update-listing`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              storeId: listing.store_id,
              route: "update-listing",
              sku: listing.asin,
              price: needsEbayPriceUpdate ? newEbayPrice : undefined,
              quantity: updates.quantity as number | undefined,
            }),
          });
          if (!updateRes.ok) {
            const errText = await updateRes.text();
            results.errors.push(`${listing.asin}: eBay update failed — ${errText.slice(0, 150)}`);
          }
        }

        await supabase.from("listings").update(updates).eq("id", listing.id);
      } catch (err) {
        await supabase.from("listings").update({ last_stock_check: now }).eq("id", listing.id);
        results.errors.push(`${listing.asin}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    for (let i = 0; i < listings.length; i += CONCURRENCY) {
      const chunk = listings.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(processOne));
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("ebay-stock-sync error:", err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
