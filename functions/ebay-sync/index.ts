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

interface EbayTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  store_nickname: string;
  ebay_username: string | null;
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
    const body = req.method === "POST" ? await req.json() : {};
    // Prefer the URL sub-path, but fall back to a body field — some proxies/CDNs in front of
    // Supabase Edge Functions can drop extra path segments, so callers may send `route` instead.
    // Strip everything up to and including "/ebay-sync" — handles both possible incoming
    // URL shapes ("/functions/v1/ebay-sync/x" and just "/ebay-sync/x", which this Supabase
    // project's edge runtime uses) instead of assuming one fixed prefix.
    let path = url.pathname.replace(/^.*\/ebay-sync/, "");
    if (!path || path === "/") path = (body.route as string) || path;
    path = "/" + path.replace(/^\/+|\/+$/g, "").toLowerCase();
    if (path === "/") path = "";

    console.log(`[ebay-sync] raw pathname="${url.pathname}" resolved path="${path}" body.route="${body.route || ""}"`);

    const storeId: string = body.storeId || url.searchParams.get("storeId") || "";

    if (!storeId) {
      return new Response(JSON.stringify({ error: "Missing storeId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the store's tokens
    const { data: storeData, error: storeErr } = await supabase
      .from("ebay_tokens")
      .select("*")
      .eq("id", storeId)
      .single();

    if (storeErr || !storeData) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const store = storeData as EbayTokenRow;

    // Refresh token if expired
    let accessToken = store.access_token;
    const tokenExpired = new Date(store.token_expires_at).getTime() < Date.now() + 60000;

    if (tokenExpired) {
      if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: "Cannot refresh token: missing eBay credentials" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
          refresh_token: store.refresh_token,
          scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.account.readonly https://api.ebay.com/oauth/api_scope/sell.analytics.readonly https://api.ebay.com/oauth/api_scope/commerce.identity.readonly https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
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
      accessToken = newTokens.access_token;
      const newExpiry = new Date(Date.now() + (newTokens.expires_in || 7200) * 1000).toISOString();

      await supabase
        .from("ebay_tokens")
        .update({
          access_token: accessToken,
          token_expires_at: newExpiry,
          updated_at: new Date().toISOString(),
        })
        .eq("id", storeId);
    }

    // ---- SYNC LISTINGS ----
    if (path === "/listings" || path === "" || path === "/") {
      const ebayApiUrl = `${EBAY_API_BASE}/sell/inventory/v1/inventory_item?limit=100&offset=0`;
      const listingsRes = await fetch(ebayApiUrl, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      });

      if (!listingsRes.ok) {
        const errText = await listingsRes.text();
        return new Response(JSON.stringify({ error: `eBay listings fetch failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const listingsData = await listingsRes.json();
      const items = listingsData.inventoryItems || [];
      const results: Array<{ ebayId: string; status: string }> = [];

      for (const item of items) {
        const sku = item.sku || "";
        const title = item.product?.title || "Untitled";
        const image = item.product?.imageUrls?.[0] || "";
        const asin = item.product?.aspects?.asin?.[0] || "";
        const quantity = item.availability?.shipToLocationAvailability?.quantity || 0;
        const ebayPrice = item.pricingSummary?.price?.value || 0;
        const status = quantity > 0 ? "active" : "out_of_stock";

        // Upsert into listings table
        const { error: upsertErr } = await supabase
          .from("listings")
          .upsert(
            {
              store_id: storeId,
              ebay_id: sku,
              title,
              asin,
              amazon_price: 0,
              ebay_price: parseFloat(ebayPrice),
              quantity,
              status,
              image,
              listed_date: item.listedDate || new Date().toISOString(),
              sold_count: 0,
              promoted: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "store_id,ebay_id" }
          );

        results.push({ ebayId: sku, status: upsertErr ? "failed" : "success" });
      }

      return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SYNC *ALL* EXISTING EBAY LISTINGS (regardless of how they were created) ----
    // The modern Inventory API (/listings above) only sees items that were created through
    // that same API. Most real, pre-existing seller accounts have listings created the
    // classic way (Seller Hub, bulk upload tools, etc.) which never show up there. This uses
    // the older Trading API's GetMyeBaySelling call instead, which returns every currently
    // active listing on the account no matter how it was originally created. Items with no
    // known Amazon source are saved with status "unknown" and asin left blank — they show up
    // in the Listings page so they can be linked to their ASIN later (via Import), or just
    // tracked/edited as-is.
    if (path === "/sync-all-listings") {
      function extractTag(xml: string, tag: string): string {
        const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1] : "";
      }

      let allItems: string[] = [];
      let pageNumber = 1;
      let totalPages = 1;

      do {
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

        const tradingRes = await fetch("https://api.ebay.com/ws/api.dll", {
          method: "POST",
          headers: {
            "X-EBAY-API-SITEID": "0",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
            "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
            "X-EBAY-API-IAF-TOKEN": accessToken,
            "Content-Type": "text/xml",
          },
          body: xmlBody,
        });

        if (!tradingRes.ok) {
          const errText = await tradingRes.text();
          return new Response(JSON.stringify({ error: `eBay Trading API call failed: ${errText.slice(0, 500)}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const xml = await tradingRes.text();
        const ackMatch = xml.match(/<Ack>([^<]*)<\/Ack>/);
        if (ackMatch && ackMatch[1] === "Failure") {
          const errMsg = extractTag(xml, "LongMessage") || extractTag(xml, "ShortMessage") || "Unknown eBay error";
          return new Response(JSON.stringify({ error: `eBay rejected the request: ${errMsg}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Pull out each <Item>...</Item> block from the ActiveList section.
        const activeListMatch = xml.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/);
        const activeListXml = activeListMatch ? activeListMatch[1] : "";
        const itemBlocks = activeListXml.match(/<Item>[\s\S]*?<\/Item>/g) || [];
        allItems = allItems.concat(itemBlocks);

        const totalPagesMatch = activeListXml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
        totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;
        pageNumber++;
      } while (pageNumber <= totalPages && pageNumber <= 25); // hard safety cap: 25 pages (~5000 items) per call

      let synced = 0;
      let failed = 0;

      for (const itemXml of allItems) {
        const ebayItemId = extractTag(itemXml, "ItemID");
        if (!ebayItemId) continue;

        const title = extractTag(itemXml, "Title") || "Untitled";
        const sku = extractTag(itemXml, "SKU");
        const priceMatch = itemXml.match(/<CurrentPrice[^>]*>([^<]*)<\/CurrentPrice>/);
        const price = priceMatch ? parseFloat(priceMatch[1]) || 0 : 0;
        const qtyMatch = itemXml.match(/<QuantityAvailable>(\d+)<\/QuantityAvailable>/) || itemXml.match(/<Quantity>(\d+)<\/Quantity>/);
        const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
        const image = extractTag(itemXml, "GalleryURL");

        const { error: upsertErr } = await supabase
          .from("listings")
          .upsert(
            {
              store_id: storeId,
              ebay_id: ebayItemId,
              title,
              asin: null,
              sku_hint: sku || null,
              amazon_price: 0,
              ebay_price: price,
              quantity,
              status: "unknown",
              image,
              listed_date: new Date().toISOString(),
              sold_count: 0,
              promoted: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "store_id,ebay_id", ignoreDuplicates: false }
          );

        if (upsertErr) failed++; else synced++;
      }

      return new Response(JSON.stringify({ success: true, synced, failed, totalFound: allItems.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SYNC ORDERS ----
    if (path === "/orders") {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
      const filter = `creationdate:[${thirtyDaysAgo.toISOString()}..${now.toISOString()}]`;

      const ordersRes = await fetch(
        `${EBAY_API_BASE}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=100`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!ordersRes.ok) {
        const errText = await ordersRes.text();
        return new Response(JSON.stringify({ error: `eBay orders fetch failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ordersData = await ordersRes.json();
      const ebayOrders = ordersData.orders || [];
      const results: Array<{ orderId: string; status: string }> = [];

      for (const ord of ebayOrders) {
        const orderId = ord.orderId || "";
        const buyerName = ord.buyer?.checkoutSession?.buyerFirstName
          ? `${ord.buyer.checkoutSession.buyerFirstName} ${ord.buyer.checkoutSession.buyerLastName}`
          : "Unknown Buyer";
        const buyerUsername = ord.buyer?.username || "";
        const listingTitle = ord.lineItems?.[0]?.title || "";
        const listingImage = ord.lineItems?.[0]?.image?.imageUrl || "";
        const asin = ord.lineItems?.[0]?.lineItemCost?.value ? "" : "";
        const ebayPrice = parseFloat(ord.pricingSummary?.total?.value || "0");
        const amazonCost = 0;
        const profit = ebayPrice - amazonCost - ebayPrice * 0.13;
        const orderStatus = ord.orderFulfillmentStatus || "pending";

        const fulfillment = ord.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
        const shipToName = fulfillment?.fullName || "";
        const contactAddr = fulfillment?.contactAddress || {};
        const shipToStreet = contactAddr.addressLine1 || "";
        const shipToCity = contactAddr.city || "";
        const shipToState = contactAddr.stateOrProvince || "";
        const shipToZip = contactAddr.postalCode || "";
        const shipToCountry = contactAddr.countryCode || "";

        const tracking = ord.lineItems?.[0]?.deliveryCost?.shippingCarrierCode
          ? { number: ord.lineItems[0].deliveryCost.trackingNumber || "", carrier: ord.lineItems[0].deliveryCost.shippingCarrierCode || "" }
          : { number: null, carrier: null };

        const { error: upsertErr } = await supabase
          .from("orders")
          .upsert(
            {
              store_id: storeId,
              order_id: orderId,
              buyer_name: buyerName,
              buyer_username: buyerUsername,
              listing_title: listingTitle,
              listing_image: listingImage,
              asin,
              ebay_price: ebayPrice,
              amazon_cost: amazonCost,
              profit: Math.round(profit * 100) / 100,
              status: orderStatus,
              order_date: ord.creationDate || new Date().toISOString(),
              ship_to_name: shipToName,
              ship_to_street: shipToStreet,
              ship_to_city: shipToCity,
              ship_to_state: shipToState,
              ship_to_zip: shipToZip,
              ship_to_country: shipToCountry,
              tracking_number: tracking.number,
              tracking_carrier: tracking.carrier,
              notes: "",
            },
            { onConflict: "store_id,order_id" }
          );

        results.push({ orderId, status: upsertErr ? "failed" : "success" });
      }

      return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SYNC MESSAGES ----
    if (path === "/messages") {
      // eBay Messages API (getmyessages)
      const msgsRes = await fetch(
        `${EBAY_API_BASE}/buy/notifications/v1/getmyessages?limit=50`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!msgsRes.ok) {
        const errText = await msgsRes.text();
        return new Response(JSON.stringify({ error: `eBay messages fetch failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const msgsData = await msgsRes.json();
      const ebayMessages = msgsData.messages || [];
      const results: Array<{ messageId: string; status: string }> = [];

      for (const msg of ebayMessages) {
        const ebayMessageId = msg.messageId || "";
        const buyerName = msg.sender?.name || "Unknown Buyer";
        const buyerUsername = msg.sender?.username || "";
        const listingTitle = msg.listingTitle || "";
        const body = msg.body || "";
        const date = msg.date || new Date().toISOString();
        const from = msg.sender?.role === "BUYER" ? "buyer" : "seller";

        // Upsert conversation
        const { data: conv, error: convErr } = await supabase
          .from("conversations")
          .upsert(
            {
              store_id: storeId,
              buyer_name: buyerName,
              buyer_username: buyerUsername,
              listing_title: listingTitle,
              last_message: body,
              last_message_date: date,
              unread: from === "buyer",
              ebay_message_id: ebayMessageId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "store_id,ebay_message_id" }
          )
          .select()
          .single();

        if (conv && !convErr) {
          await supabase.from("messages").insert({
            conversation_id: conv.id,
            from,
            body,
            date,
          });
        }

        results.push({ messageId: ebayMessageId, status: "success" });
      }

      return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- UPDATE LISTING (stock + price push) ----
    if (path === "/update-listing") {
      const { sku, title, price, quantity, image, description } = body as {
        sku: string; title?: string; price?: number; quantity?: number;
        image?: string; description?: string;
      };

      if (!sku) {
        return new Response(JSON.stringify({ error: "Missing sku" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const inventoryBody: Record<string, unknown> = {};
      if (title !== undefined) {
        inventoryBody.product = { ...(inventoryBody.product || {}), title };
      }
      if (image !== undefined) {
        inventoryBody.product = { ...(inventoryBody.product || {}), imageUrls: [image] };
      }
      if (description !== undefined) {
        inventoryBody.product = { ...(inventoryBody.product || {}), description };
      }
      if (price !== undefined) {
        inventoryBody.pricingSummary = { price: { value: String(price), currency: "USD" } };
      }
      if (quantity !== undefined) {
        inventoryBody.availability = {
          shipToLocationAvailability: { quantity: Math.max(0, Math.floor(quantity)) },
        };
      }

      const putRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(inventoryBody),
      });

      if (!putRes.ok) {
        const errText = await putRes.text();
        return new Response(JSON.stringify({ error: `eBay inventory update failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log the revision
      const revisions: Array<{ field: string; old: string; new: string }> = [];
      if (price !== undefined) revisions.push({ field: "price", old: "", new: String(price) });
      if (quantity !== undefined) revisions.push({ field: "quantity", old: "", new: String(quantity) });

      for (const rev of revisions) {
        await supabase.from("revisions").insert({
          store_id: storeId,
          listing_title: title || sku,
          field: rev.field,
          old_value: rev.old,
          new_value: rev.new,
          reason: "Manual edit via Edit Listing",
          date: new Date().toISOString(),
        });
      }

      return new Response(JSON.stringify({ success: true, sku }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- PUBLISH NEW LISTING ----
    if (path === "/publish") {
      const { sku, title, price, quantity, image, images, description, categoryId, policyOverrides, aspects } = body as {
        sku: string; title: string; price: number; quantity: number;
        image: string; images?: string[]; description: string; categoryId?: string;
        policyOverrides?: { fulfillmentPolicyId?: string; paymentPolicyId?: string; returnPolicyId?: string };
        aspects?: Record<string, string[]>;
      };

      // eBay accepts up to 12 image URLs per listing. Accept either the new `images` array
      // or the older single `image` string (kept for backwards compatibility).
      const allImages = (images && images.length > 0 ? images : (image ? [image] : [])).slice(0, 12);

      if (!sku || !title || price === undefined || quantity === undefined) {
        return new Response(JSON.stringify({ error: "Missing required fields: sku, title, price, quantity" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Load this store's saved business policies + location (set in Settings page).
      // eBay REQUIRES all of these to create/publish an offer.
      const { data: storePolicies, error: policiesErr } = await supabase
        .from("store_policies")
        .select("fulfillment_policy_id, payment_policy_id, return_policy_id, location_key, default_category_id")
        .eq("store_id", storeId)
        .maybeSingle();

      if (policiesErr || !storePolicies || !storePolicies.location_key) {
        return new Response(JSON.stringify({
          error: "Missing eBay location for this store. Go to Settings and fill in your inventory location before publishing.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // A per-batch override (from Bulk Add) takes priority over the store's saved default policy.
      const effectiveFulfillmentId = policyOverrides?.fulfillmentPolicyId || storePolicies.fulfillment_policy_id;
      const effectivePaymentId = policyOverrides?.paymentPolicyId || storePolicies.payment_policy_id;
      const effectiveReturnId = policyOverrides?.returnPolicyId || storePolicies.return_policy_id;

      if (!effectiveFulfillmentId || !effectivePaymentId || !effectiveReturnId) {
        return new Response(JSON.stringify({
          error: "Missing eBay business policies. Select shipping, payment, and return policies in Settings, or per-batch in Bulk Add.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Category priority: first, explicitly passed by the caller; second, auto-detected from
      // the product's own title via eBay's own category-suggestion API (so a phone case and a
      // kitchen gadget don't end up in the same category); third, the store's default category
      // as a last resort if eBay couldn't suggest anything.
      let effectiveCategoryId = categoryId || "";
      let categorySource: "explicit" | "auto" | "default" | "none" = categoryId ? "explicit" : "none";

      if (!effectiveCategoryId && title) {
        try {
          const suggestRes = await fetch(
            `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title.slice(0, 100))}`,
            {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
            },
          );
          if (suggestRes.ok) {
            const suggestData = await suggestRes.json();
            const topSuggestion = suggestData.categorySuggestions?.[0]?.category?.categoryId;
            if (topSuggestion) {
              effectiveCategoryId = topSuggestion;
              categorySource = "auto";
            }
          }
        } catch {
          // Auto-detection is best-effort — fall through to the store default below.
        }
      }

      if (!effectiveCategoryId && storePolicies.default_category_id) {
        effectiveCategoryId = storePolicies.default_category_id;
        categorySource = "default";
      }

      if (!effectiveCategoryId) {
        return new Response(JSON.stringify({
          error: "Could not determine an eBay category for this product (auto-detection failed and no default category is set in Settings → eBay Policies).",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 1: Create or replace inventory item
      const inventoryPayload = {
        product: {
          title,
          description: description || "",
          imageUrls: allImages,
          aspects: aspects || {},
        },
        pricingSummary: { price: { value: String(price), currency: "USD" } },
        availability: {
          shipToLocationAvailability: { quantity: Math.max(0, Math.floor(quantity)) },
        },
      };

      const invRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(inventoryPayload),
      });

      if (!invRes.ok) {
        const errText = await invRes.text();
        return new Response(JSON.stringify({ error: `Create inventory item failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 2: Create offer
      const offerPayload = {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        categoryId: effectiveCategoryId,
        merchantLocationKey: storePolicies.location_key,
        pricingSummary: { price: { value: String(price), currency: "USD" } },
        listingPolicies: {
          fulfillmentPolicyId: effectiveFulfillmentId,
          paymentPolicyId: effectivePaymentId,
          returnPolicyId: effectiveReturnId,
        },
      };

      const offerRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(offerPayload),
      });

      if (!offerRes.ok) {
        const errText = await offerRes.text();
        return new Response(JSON.stringify({ error: `Create offer failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const offerData = await offerRes.json();
      const offerId = offerData.offerId;

      if (!offerId) {
        return new Response(JSON.stringify({ error: "No offerId returned from eBay" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 3: Publish the offer
      const pubRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      });

      if (!pubRes.ok) {
        const errText = await pubRes.text();
        return new Response(JSON.stringify({ error: `Publish offer failed: ${errText}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pubData = await pubRes.json();
      const listingId = pubData.listingId || "";

      // Upsert into local listings table
      const { error: localUpsertErr } = await supabase.from("listings").upsert({
        store_id: storeId,
        ebay_id: listingId || sku,
        title,
        asin: sku,
        amazon_price: 0,
        ebay_price: price,
        quantity,
        status: "active",
        image: allImages[0] || image || "",
        listed_date: new Date().toISOString(),
        sold_count: 0,
        promoted: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "store_id,ebay_id" });

      if (localUpsertErr) {
        // The eBay listing itself was created successfully at this point — don't fail the
        // request, but surface the local sync problem so it's visible instead of silent.
        console.error("Local listings upsert failed after successful eBay publish:", localUpsertErr.message);
      }

      return new Response(JSON.stringify({ success: true, sku, offerId, listingId, categoryId: effectiveCategoryId, categorySource }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- END LISTING (withdraw offer on eBay + delete from DB) ----
    if (path === "/end-listing") {
      const { listingId, sku } = body as { listingId?: string; sku?: string };

      if (!listingId && !sku) {
        return new Response(JSON.stringify({ error: "Missing listingId or sku" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Look up the listing row to get the eBay offer ID (stored as ebay_id)
      let offerId = sku || "";
      let dbListingId = listingId || "";

      if (listingId) {
        const { data: listingRow, error: lookupErr } = await supabase
          .from("listings")
          .select("id, ebay_id, store_id")
          .eq("id", listingId)
          .single();

        if (lookupErr || !listingRow) {
          return new Response(JSON.stringify({ error: "Listing not found in database" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        offerId = listingRow.ebay_id || offerId;
        dbListingId = listingRow.id;
      }

      // Withdraw the offer on eBay (end the listing)
      if (offerId) {
        try {
          const withdrawRes = await fetch(
            `${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "Content-Language": "en-US",
              },
            }
          );
          // 404 is fine — listing already ended/removed on eBay
          if (!withdrawRes.ok && withdrawRes.status !== 404) {
            const errText = await withdrawRes.text();
            return new Response(JSON.stringify({ error: `eBay withdraw failed: ${errText}` }), {
              status: 502,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (e) {
          return new Response(JSON.stringify({ error: `eBay withdraw request failed: ${e instanceof Error ? e.message : "unknown"}` }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Delete the listing from the database
      if (dbListingId) {
        const { error: delErr } = await supabase
          .from("listings")
          .delete()
          .eq("id", dbListingId);

        if (delErr) {
          return new Response(JSON.stringify({ error: `Database delete failed: ${delErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ success: true, listingId: dbListingId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      error: "Unknown route. Use /listings, /orders, /messages, /update-listing, /publish, or /end-listing",
      debug_rawPathname: url.pathname,
      debug_resolvedPath: path,
      debug_bodyRoute: body.route || null,
    }), {
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
