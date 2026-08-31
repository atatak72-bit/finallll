import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EBAY_CLIENT_ID = "tubakaya-supportk-PRD-2ed5b7066-12414844";
const EBAY_CLIENT_SECRET = "PRD-ed5b70667e5f-9812-483b-800e-75f3";
const EBAY_API_BASE = "https://api.ebay.com";
const EBAY_AUTH_BASE = "https://api.ebay.com";

interface StoreToken {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

interface AvailabilitySettings {
  store_id: string;
  auto_delist_enabled: boolean;
  days_without_sales: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const storeIdParam = url.searchParams.get("storeId") || (req.method === "POST" ? (await req.json().catch(() => ({}))).storeId : "");

    // Load availability settings for stores with auto-delist enabled
    let settingsQuery = supabase
      .from("store_availability_settings")
      .select("store_id, auto_delist_enabled, days_without_sales")
      .eq("auto_delist_enabled", true);
    if (storeIdParam) settingsQuery = settingsQuery.eq("store_id", storeIdParam);

    const { data: settingsData, error: settingsErr } = await settingsQuery;
    if (settingsErr) throw new Error(`Failed to load availability settings: ${settingsErr.message}`);
    const settings = (settingsData || []) as AvailabilitySettings[];

    if (settings.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No stores with auto-delist enabled.", delisted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settingsByStore = new Map<string, AvailabilitySettings>();
    for (const s of settings) settingsByStore.set(s.store_id, s);

    // Fetch tokens for these stores
    const storeIds = settings.map((s) => s.store_id);
    const { data: tokensData, error: tokensErr } = await supabase
      .from("ebay_tokens")
      .select("id, access_token, refresh_token, token_expires_at")
      .in("id", storeIds);
    if (tokensErr) throw new Error(`Failed to load store tokens: ${tokensErr.message}`);
    const tokens = (tokensData || []) as StoreToken[];

    const tokenByStore = new Map<string, StoreToken>();
    for (const t of tokens) tokenByStore.set(t.id, t);

    const now = Date.now();
    let delistedCount = 0;
    const results: Array<{ storeId: string; listingId: string; status: string }> = [];

    for (const setting of settings) {
      const token = tokenByStore.get(setting.store_id);
      if (!token) {
        results.push({ storeId: setting.store_id, listingId: "-", status: "no_token" });
        continue;
      }

      // Refresh token if expired
      let accessToken = token.access_token;
      const tokenExpired = new Date(token.token_expires_at).getTime() < now + 60000;
      if (tokenExpired) {
        if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
          results.push({ storeId: setting.store_id, listingId: "-", status: "no_credentials" });
          continue;
        }
        const authHeader = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);
        const refreshRes = await fetch(`${EBAY_AUTH_BASE}/identity/v1/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${authHeader}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: token.refresh_token,
            scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
          }),
        });
        if (!refreshRes.ok) {
          results.push({ storeId: setting.store_id, listingId: "-", status: "token_refresh_failed" });
          continue;
        }
        const newTokens = await refreshRes.json();
        accessToken = newTokens.access_token;
        const newExpiry = new Date(now + (newTokens.expires_in || 7200) * 1000).toISOString();
        await supabase
          .from("ebay_tokens")
          .update({ access_token: accessToken, token_expires_at: newExpiry, updated_at: new Date().toISOString() })
          .eq("id", token.id);
      }

      // Query active listings older than the cold threshold
      const thresholdMs = setting.days_without_sales * 86400000;
      const cutoffDate = new Date(now - thresholdMs).toISOString();

      const { data: coldListings, error: listingsErr } = await supabase
        .from("listings")
        .select("id, ebay_id, title, last_sold_at, listed_date, created_at")
        .eq("store_id", setting.store_id)
        .eq("status", "active")
        .or(`last_sold_at.is.null,last_sold_at.lt.${cutoffDate}`)
        .lt("listed_date", cutoffDate);

      if (listingsErr) {
        results.push({ storeId: setting.store_id, listingId: "-", status: "listings_query_failed" });
        continue;
      }

      for (const listing of coldListings || []) {
        const lastActivity = listing.last_sold_at || listing.listed_date || listing.created_at;
        if (!lastActivity) continue;
        const daysSince = (now - new Date(lastActivity).getTime()) / 86400000;
        if (daysSince < setting.days_without_sales) continue;

        // End the listing on eBay via Inventory API (withdrawOffer)
        let ebayStatus = "ended";
        if (listing.ebay_id) {
          try {
            const endRes = await fetch(
              `${EBAY_API_BASE}/sell/inventory/v1/offer/${listing.ebay_id}/withdraw`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                  "Content-Language": "en-US",
                },
              }
            );
            if (!endRes.ok && endRes.status !== 404) {
              ebayStatus = "ebay_end_failed";
            }
          } catch (_e) {
            ebayStatus = "ebay_end_failed";
          }
        }

        // Update local listing status
        const { error: updateErr } = await supabase
          .from("listings")
          .update({ status: "delisted_cold", updated_at: new Date().toISOString() })
          .eq("id", listing.id);

        if (!updateErr && ebayStatus === "ended") delistedCount++;
        results.push({ storeId: setting.store_id, listingId: listing.id, status: ebayStatus });
      }
    }

    return new Response(JSON.stringify({ success: true, delisted: delistedCount, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
