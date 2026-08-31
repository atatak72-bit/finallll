import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EBAY_CLIENT_ID = "tubakaya-supportk-PRD-2ed5b7066-12414844";
const EBAY_CLIENT_SECRET = "PRD-ed5b70667e5f-9812-483b-800e-75f3";
const EBAY_API_BASE = "https://api.ebay.com";
const FULL_SCOPE = "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.marketing.readonly";

interface EbayTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

async function getValidAccessToken(supabase: any, storeId: string): Promise<string> {
  const { data: storeData, error } = await supabase.from("ebay_tokens").select("*").eq("id", storeId).single();
  if (error || !storeData) throw new Error("Store not found");
  const store = storeData as EbayTokenRow;

  let accessToken = store.access_token;
  const expired = new Date(store.token_expires_at).getTime() < Date.now() + 60000;

  if (expired) {
    const authHeader = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);
    const refreshRes = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${authHeader}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: store.refresh_token, scope: FULL_SCOPE }),
    });
    if (!refreshRes.ok) throw new Error(`Token refresh failed: ${await refreshRes.text()}`);
    const newTokens = await refreshRes.json();
    accessToken = newTokens.access_token;
    await supabase.from("ebay_tokens").update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + (newTokens.expires_in || 7200) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", storeId);
  }

  return accessToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { storeId, listingId, adRate } = body as { storeId: string; listingId: string; adRate: number };

    if (!storeId || !listingId) {
      return new Response(JSON.stringify({ success: false, error: "Missing storeId or listingId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bidPercentage = String(adRate && adRate > 0 ? adRate : 3);
    const accessToken = await getValidAccessToken(supabase, storeId);
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    };

    // Step 1: Find an existing running Promoted Listings Standard campaign for this marketplace,
    //    or create one if none exists yet.
    let campaignId: string | null = null;

    const listRes = await fetch(`${EBAY_API_BASE}/sell/marketing/v1/ad_campaign?campaign_status=RUNNING&limit=10`, { headers });
    if (listRes.ok) {
      const listData = await listRes.json();
      const campaigns = listData.campaigns || [];
      const existing = campaigns.find((c: any) => c.marketplaceId === "EBAY_US" && c.fundingStrategy?.fundingModel === "COST_PER_SALE");
      if (existing) campaignId = existing.campaignId;
    }

    if (!campaignId) {
      const createRes = await fetch(`${EBAY_API_BASE}/sell/marketing/v1/ad_campaign`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          campaignName: `Auto Promoted Listings ${new Date().toISOString().slice(0, 10)}`,
          marketplaceId: "EBAY_US",
          fundingStrategy: { fundingModel: "COST_PER_SALE" },
          startDate: new Date().toISOString(),
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        return new Response(JSON.stringify({ success: false, error: `Could not create ad campaign: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // eBay returns the new campaign location in a header, not always in the body
      const location = createRes.headers.get("Location") || "";
      campaignId = location.split("/").pop() || null;
      if (!campaignId) {
        const createData = await createRes.json().catch(() => ({}));
        campaignId = createData.campaignId || null;
      }
    }

    if (!campaignId) {
      return new Response(JSON.stringify({ success: false, error: "Could not determine ad campaign ID" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: Add this listing to the campaign at the requested bid percentage
    const adRes = await fetch(`${EBAY_API_BASE}/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad`, {
      method: "POST",
      headers,
      body: JSON.stringify({ listingId, bidPercentage }),
    });

    if (!adRes.ok) {
      const errText = await adRes.text();
      // eBay eligibility rules (sales history, category, etc.) commonly reject this — surface
      // it clearly but as a normal failure, not a crash.
      return new Response(JSON.stringify({ success: false, error: `eBay declined to promote this listing: ${errText}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, campaignId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("ebay-promote-listing error:", err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
