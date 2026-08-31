import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EBAY_CLIENT_ID = "tubakaya-supportk-PRD-2ed5b7066-12414844";
const EBAY_CLIENT_SECRET = "PRD-ed5b70667e5f-9812-483b-800e-75f3";
const EBAY_RU_NAME = "tuba_kaya-tubakaya-suppor-vyolmjslf";

const EBAY_API_BASE = "https://api.ebay.com";
const EBAY_AUTH_BASE = "https://auth.ebay.com";

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

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const isAuthUrlRoute = path === "" || path === "/" || path.endsWith("/auth-url");
    const isCallbackRoute = path.endsWith("/callback");
    const isRefreshRoute = path.endsWith("/refresh");
    const isDisconnectRoute = path.endsWith("/disconnect");

    // Parse body once — used for action-based routing (supabase.functions.invoke)
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({})) as Record<string, unknown>;
    }
    const action = (body.action as string) || "";
    const actionStoreId = (body.store_id as string) || (body.storeId as string) || "";

    // GET /auth-url — generate the eBay consent URL to redirect the user to
    if (isAuthUrlRoute && action !== "refresh" && action !== "disconnect") {
      const authUrl = `${EBAY_AUTH_BASE}/oauth2/authorize?client_id=${encodeURIComponent(EBAY_CLIENT_ID)}&redirect_uri=${encodeURIComponent(EBAY_RU_NAME)}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPES)}`;

      return new Response(JSON.stringify({
        authUrl,
        clientId: EBAY_CLIENT_ID,
        ruName: EBAY_RU_NAME,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /callback — exchange authorization code for tokens
    if (isCallbackRoute && req.method === "POST") {
      const { code, storeNickname } = body as { code: string; storeNickname?: string };

      if (!code) {
        return new Response(JSON.stringify({ error: "Missing authorization code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenUrl = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
      const authHeader = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: EBAY_RU_NAME,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return new Response(JSON.stringify({ error: `eBay token exchange failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokens = await tokenRes.json();

      // Fetch the eBay seller's username
      let ebayUsername: string | null = null;
      try {
        const userRes = await fetch(`${EBAY_API_BASE}/commerce/identity/v1/user/`, {
          headers: { "Authorization": `Bearer ${tokens.access_token}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          ebayUsername = userData.username || null;
        }
      } catch {
        // username fetch is best-effort
      }

      // Store tokens in Supabase
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const now = new Date();
      const tokenExpiresAt = new Date(now.getTime() + (tokens.expires_in || 7200) * 1000);
      const refreshExpiresAt = new Date(now.getTime() + (tokens.refresh_token_expires_in || 47304000) * 1000);

      const { data, error } = await supabase
        .from("ebay_tokens")
        .insert({
          store_nickname: storeNickname || "My Store",
          ebay_username: ebayUsername,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          refresh_token_expires_at: refreshExpiresAt.toISOString(),
          connected: true,
          active: true,
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: `Failed to store tokens: ${error.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, store: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /disconnect — revoke the eBay token and remove the local connection
    if (isDisconnectRoute && req.method === "POST") {
      const storeId = actionStoreId || (body.storeId as string) || "";

      if (!storeId || typeof storeId !== "string") {
        return new Response(JSON.stringify({ error: "Invalid store" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: store, error: storeErr } = await supabase
        .from("ebay_tokens")
        .select("refresh_token")
        .eq("id", storeId)
        .maybeSingle();

      if (storeErr || !store) {
        return new Response(JSON.stringify({ error: "Store not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Best-effort revoke on eBay — if this fails (expired token, network, etc.)
      // we still remove the local connection so the user is never stuck.
      if (store.refresh_token) {
        try {
          await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/revoke`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": `Basic ${btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`)}`,
            },
            body: new URLSearchParams({ token: store.refresh_token }),
          });
        } catch {
          // ignore — local cleanup is the source of truth
        }
      }

      // Delete the token row; ON DELETE CASCADE removes all related
      // listings, orders, conversations, messages, and revisions.
      const { error: deleteErr } = await supabase
        .from("ebay_tokens")
        .delete()
        .eq("id", storeId);

      if (deleteErr) {
        return new Response(JSON.stringify({ error: "Failed to remove the store connection" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /refresh — refresh an expired access token (path-based or action-based)
    if ((isRefreshRoute || action === "refresh") && req.method === "POST") {
      const storeId = actionStoreId || (body.storeId as string) || "";

      if (!storeId) {
        return new Response(JSON.stringify({ error: "Missing storeId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: store, error: storeErr } = await supabase
        .from("ebay_tokens")
        .select("refresh_token")
        .eq("id", storeId)
        .single();

      if (storeErr || !store) {
        return new Response(JSON.stringify({ error: "Store not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenUrl = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
      const authHeader = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);

      const refreshRes = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: store.refresh_token,
          scope: OAUTH_SCOPES,
        }),
      });

      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        return new Response(JSON.stringify({ error: `Token refresh failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newTokens = await refreshRes.json();
      const tokenExpiresAt = new Date(Date.now() + (newTokens.expires_in || 7200) * 1000);

      await supabase
        .from("ebay_tokens")
        .update({
          access_token: newTokens.access_token,
          token_expires_at: tokenExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", storeId);

      return new Response(JSON.stringify({ success: true, accessToken: newTokens.access_token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown route" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
