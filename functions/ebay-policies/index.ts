import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EBAY_CLIENT_ID = "tubakaya-supportk-PRD-2ed5b7066-12414844";
const EBAY_CLIENT_SECRET = "PRD-ed5b70667e5f-9812-483b-800e-75f3";
const EBAY_API_BASE = "https://api.ebay.com";
const MARKETPLACE = "EBAY_US";

const OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
].join(" ");

interface EbayTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
): Promise<string> {
  const { data: storeData, error: storeErr } = await supabase
    .from("ebay_tokens")
    .select("access_token, refresh_token, token_expires_at")
    .eq("id", storeId)
    .single();

  if (storeErr || !storeData) throw new Error("Store not found");

  let accessToken = storeData.access_token;
  const tokenExpired = new Date(storeData.token_expires_at).getTime() <
    Date.now() + 60000;

  if (tokenExpired) {
    const authHeader = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);
    const refreshRes = await fetch(
      `${EBAY_API_BASE}/identity/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: storeData.refresh_token,
          scope: OAUTH_SCOPES,
        }),
      },
    );

    if (!refreshRes.ok) {
      const errText = await refreshRes.text();
      throw new Error(`Token refresh failed: ${errText}`);
    }

    const newTokens = await refreshRes.json();
    accessToken = newTokens.access_token;
    const newExpiry = new Date(
      Date.now() + (newTokens.expires_in || 7200) * 1000,
    ).toISOString();

    await supabase
      .from("ebay_tokens")
      .update({
        access_token: accessToken,
        token_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", storeId);
  }

  return accessToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = (body.action as string) || "";
    const storeId = (body.store_id as string) ||
      (body.storeId as string) || "";

    if (!storeId) {
      return new Response(
        JSON.stringify({ error: "Missing store_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- action: getPolicies ---
    // Fetch all business policies from eBay Account API for the selected store.
    // Returns empty arrays (never throws) so the UI can render gracefully.
    if (action === "getPolicies") {
      try {
        const accessToken = await getValidAccessToken(supabase, storeId);

        const mkHeaders = () => ({
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        });

        const [fulfillmentRes, paymentRes, returnRes] = await Promise.all([
          fetch(
            `${EBAY_API_BASE}/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`,
            { headers: mkHeaders() },
          ),
          fetch(
            `${EBAY_API_BASE}/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`,
            { headers: mkHeaders() },
          ),
          fetch(
            `${EBAY_API_BASE}/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`,
            { headers: mkHeaders() },
          ),
        ]);

        const safeJson = async (res: Response, key: string) => {
          if (!res.ok) return [];
          try {
            const data = await res.json();
            return data[key] || [];
          } catch {
            return [];
          }
        };

        const [fulfillmentPolicies, paymentPolicies, returnPolicies] = await Promise.all([
          safeJson(fulfillmentRes, "fulfillmentPolicies"),
          safeJson(paymentRes, "paymentPolicies"),
          safeJson(returnRes, "returnPolicies"),
        ]);

        return new Response(
          JSON.stringify({
            fulfillmentPolicies,
            paymentPolicies,
            returnPolicies,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (err) {
        // Never crash the UI — return empty arrays on any error.
        return new Response(
          JSON.stringify({
            fulfillmentPolicies: [],
            paymentPolicies: [],
            returnPolicies: [],
            error: err instanceof Error ? err.message : "Failed to fetch policies",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // --- action: searchCategory ---
    // Suggests eBay leaf categories for a free-text query (e.g. "wireless earbuds"),
    // so the user never has to know eBay's numeric category IDs.
    if (action === "searchCategory") {
      const query = (body.query as string || "").trim();
      if (!query) {
        return new Response(
          JSON.stringify({ error: "Missing query" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      try {
        const accessToken = await getValidAccessToken(supabase, storeId);
        const res = await fetch(
          `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`,
          {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
          },
        );
        if (!res.ok) {
          const errText = await res.text();
          return new Response(
            JSON.stringify({ error: `eBay category search failed: ${errText}`, suggestions: [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const data = await res.json();
        const suggestions = (data.categorySuggestions || []).map((s: any) => ({
          categoryId: s.category?.categoryId || "",
          categoryName: s.category?.categoryName || "",
          path: (s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName).reverse().join(" > "),
        }));
        return new Response(
          JSON.stringify({ suggestions }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : "Category search failed", suggestions: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // --- action: getSettings ---
    // Load saved policy IDs + location from the database (no eBay API needed).
    if (action === "getSettings") {
      const { data: row, error: dbErr } = await supabase
        .from("store_policies")
        .select("*")
        .eq("store_id", storeId)
        .maybeSingle();

      if (dbErr) {
        return new Response(
          JSON.stringify({ error: dbErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ settings: row || null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- action: saveSettings ---
    // Persist policy IDs + location. If a real address was entered, this also creates (or
    // updates) an actual eBay merchant inventory location — eBay REQUIRES one to exist before
    // any offer can be published, so this can no longer be a purely local, eBay-unaware save.
    if (action === "saveSettings") {
      const locationCountry = (body.locationCountry as string) || "";
      const locationCity = (body.locationCity as string) || "";
      const locationState = (body.locationState as string) || "";
      const locationZip = (body.locationZip as string) || "";

      let locationKey = (body.locationKey as string) || "";
      let locationError: string | null = null;

      if (locationCountry && locationCity && locationZip) {
        // Reuse the existing key for this store if we have one, otherwise mint a stable one.
        if (!locationKey) {
          locationKey = `loc-${storeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;
        }

        try {
          const accessToken = await getValidAccessToken(supabase, storeId);
          const locRes = await fetch(
            `${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(locationKey)}`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US",
              },
              body: JSON.stringify({
                location: {
                  address: {
                    country: locationCountry,
                    city: locationCity,
                    stateOrProvince: locationState || undefined,
                    postalCode: locationZip,
                  },
                },
                name: `${locationCity} warehouse`,
                merchantLocationStatus: "ENABLED",
                locationTypes: ["WAREHOUSE"],
              }),
            },
          );

          // eBay returns 204 on create, 409 if it already exists (fine — it's already there
          // from a previous save), anything else is a real problem worth surfacing.
          if (!locRes.ok && locRes.status !== 409 && locRes.status !== 204) {
            const errText = await locRes.text();
            locationError = `Could not create eBay location: ${errText}`;
          }
        } catch (err) {
          locationError = err instanceof Error ? err.message : "Could not reach eBay to create the location.";
        }
      }

      const payload = {
        payment_policy_id: (body.paymentPolicyId as string) || "",
        return_policy_id: (body.returnPolicyId as string) || "",
        fulfillment_policy_id: (body.fulfillmentPolicyId as string) || "",
        location_country: locationCountry,
        location_city: locationCity,
        location_state: locationState,
        location_zip: locationZip,
        location_key: locationError ? "" : locationKey,
        default_category_id: (body.defaultCategoryId as string) || "",
        default_category_name: (body.defaultCategoryName as string) || "",
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("store_policies")
        .select("id")
        .eq("store_id", storeId)
        .maybeSingle();

      let dbError: string | null = null;

      if (existing) {
        const { error } = await supabase
          .from("store_policies")
          .update(payload)
          .eq("store_id", storeId);
        dbError = error?.message || null;
      } else {
        const { error } = await supabase
          .from("store_policies")
          .insert({ store_id: storeId, ...payload });
        dbError = error?.message || null;
      }

      if (dbError) {
        return new Response(
          JSON.stringify({ error: dbError }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (locationError) {
        return new Response(
          JSON.stringify({ success: true, warning: locationError }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Unknown action. Use action: getPolicies | getSettings | saveSettings | searchCategory",
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
