import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProductInput {
  store_id: string;
  asin: string;
  title: string;
  amazon_price: number;
  category?: string;
  in_stock?: boolean;
  is_prime?: boolean;
  profit_margin?: number;
  ebay_fee?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing Supabase configuration." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: ProductInput = await req.json();
    const {
      store_id,
      asin,
      title,
      amazon_price,
      category,
      in_stock,
      is_prime,
      profit_margin,
      ebay_fee,
    } = body;

    if (!store_id) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing store_id." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!asin) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing ASIN." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanTitle = (title || "").trim();
    const cleanCategory = typeof category === "string" ? category.trim() : "";
    const sourcePrice = typeof amazon_price === "number" && !isNaN(amazon_price) ? amazon_price : 0;

    // ---- VeRO / keyword validation ----
    const { data: veroSettings } = await supabase
      .from("store_vero_settings")
      .select("block_keywords, block_asins, block_in_title, block_in_brand")
      .eq("store_id", store_id)
      .single();

    if (veroSettings) {
      const blockKeywords: string[] = veroSettings.block_keywords || [];
      const blockAsins: string[] = veroSettings.block_asins || [];
      const blockInTitle: boolean = veroSettings.block_in_title ?? true;
      const blockInBrand: boolean = veroSettings.block_in_brand ?? true;

      if (blockAsins.includes(asin)) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `ASIN ${asin} is on the VeRO block list.`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const titleLower = cleanTitle.toLowerCase();
      for (const kw of blockKeywords) {
        const kwLower = kw.toLowerCase();
        if (blockInTitle && titleLower.includes(kwLower)) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `Title contains blocked keyword "${kw}" (VeRO).`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (blockInBrand && cleanCategory.toLowerCase().includes(kwLower)) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `Brand/category contains blocked keyword "${kw}" (VeRO).`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // ---- Availability filter ----
    const { data: availSettings } = await supabase
      .from("store_availability_settings")
      .select("prime_filter, allow_out_of_stock, default_quantity")
      .eq("store_id", store_id)
      .single();

    if (availSettings) {
      if (availSettings.prime_filter && is_prime === false) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Item is not Prime-eligible; Prime filter is active.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!availSettings.allow_out_of_stock && in_stock === false) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Item is out of stock and OOS items are not allowed.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Pricing calculation ----
    let calculatedEbayPrice = 0;

    const { data: pricingSettings } = await supabase
      .from("pricing_settings")
      .select("pricing_enabled, ebay_percentage_fee, ebay_fixed_fee")
      .eq("store_id", store_id)
      .single();

    const { data: pricingRules } = await supabase
      .from("pricing_rules")
      .select("min_price, max_price, profit_pct, fixed_profit, sort_order")
      .eq("store_id", store_id)
      .order("sort_order", { ascending: true });

    const pctFee = pricingSettings?.ebay_percentage_fee ?? 13.25;
    const fixedFee = pricingSettings?.ebay_fixed_fee ?? 0.30;
    const pricingEnabled = pricingSettings?.pricing_enabled ?? true;

    if (pricingEnabled && pricingRules && pricingRules.length > 0) {
      const rule = pricingRules.find(
        (r: any) => sourcePrice >= Number(r.min_price) && sourcePrice <= Number(r.max_price)
      );
      if (rule) {
        const profitPct = Number(rule.profit_pct) || 0;
        const fixedProfit = Number(rule.fixed_profit) || 0;
        const base = sourcePrice * (1 + profitPct / 100) + fixedProfit;
        calculatedEbayPrice = base / (1 - pctFee / 100) + fixedFee;
      } else {
        calculatedEbayPrice = sourcePrice * (1 + (profit_margin ?? 15) / 100);
        calculatedEbayPrice = calculatedEbayPrice / (1 - pctFee / 100) + fixedFee;
      }
    } else {
      calculatedEbayPrice = sourcePrice * (1 + (profit_margin ?? 15) / 100);
      calculatedEbayPrice = calculatedEbayPrice / (1 - (ebay_fee ?? pctFee) / 100) + fixedFee;
    }

    calculatedEbayPrice = Math.round(calculatedEbayPrice * 100) / 100;

    // ---- Insert into listings ----
    const defaultQty = availSettings?.default_quantity ?? 3;
    const status = in_stock === false ? "out_of_stock" : "draft";

    const { data: inserted, error: insertErr } = await supabase
      .from("listings")
      .insert({
        store_id,
        asin,
        title: cleanTitle,
        amazon_price: sourcePrice,
        ebay_price: calculatedEbayPrice,
        quantity: defaultQty,
        status,
        listed_date: new Date().toISOString(),
        sold_count: 0,
        promoted: false,
      })
      .select()
      .single();

    if (insertErr) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Database insert failed: ${insertErr.message}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Diagnostic: try exchanging eBay refresh token for access token ----
    try {
      const EBAY_CLIENT_ID = Deno.env.get("EBAY_CLIENT_ID") || "";
      const EBAY_CLIENT_SECRET = Deno.env.get("EBAY_CLIENT_SECRET") || "";
      const EBAY_REFRESH_TOKEN = Deno.env.get("EBAY_REFRESH_TOKEN") || "";
      const EBAY_ENV = (Deno.env.get("EBAY_ENV") || "sandbox").toLowerCase();

      const tokenUrl =
        EBAY_ENV === "production"
          ? "https://api.ebay.com/identity/v1/oauth2/token"
          : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

      if (EBAY_CLIENT_ID && EBAY_CLIENT_SECRET && EBAY_REFRESH_TOKEN) {
        const basic = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`);
        const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(
          EBAY_REFRESH_TOKEN
        )}&scope=https://api.ebay.com/oauth/api_scope`;

        const tokRes = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });

        if (tokRes.ok) {
          const tokJson = await tokRes.json();
          const resultData = {
            success: true,
            message: "Product added successfully. eBay token exchange OK.",
            calculated_ebay_price: calculatedEbayPrice,
            listing_id: inserted?.id || null,
            ebay_token_ok: true,
            ebay_token_expires_in: tokJson.expires_in ?? null,
          };
          return new Response(JSON.stringify(resultData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          const errText = await tokRes.text();
          const resultData = {
            success: true,
            message: "Product added, but eBay token exchange failed.",
            calculated_ebay_price: calculatedEbayPrice,
            listing_id: inserted?.id || null,
            ebay_token_ok: false,
            ebay_token_error: errText.slice(0, 400),
          };
          return new Response(JSON.stringify(resultData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const resultData = {
          success: true,
          message: "Product added, but eBay secrets not configured.",
          calculated_ebay_price: calculatedEbayPrice,
          listing_id: inserted?.id || null,
          ebay_token_ok: false,
          ebay_token_error: "Missing EBAY_CLIENT_ID/SECRET/REFRESH_TOKEN",
        };
        return new Response(JSON.stringify(resultData), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      const resultData = {
        success: true,
        message: "Product added, but eBay token check threw error.",
        calculated_ebay_price: calculatedEbayPrice,
        listing_id: inserted?.id || null,
        ebay_token_ok: false,
        ebay_token_error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
      };
      return new Response(JSON.stringify(resultData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    console.error("process-product error:", err);
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});