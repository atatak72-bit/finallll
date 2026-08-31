import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ProductData {
  asin: string;
  title: string;
  brand: string;
  description: string;
  bulletPoints: string[];
  images: string[];
  mainImage: string;
  price: number;
  currency: string;
  stock: string;
  rating: number;
  ratingsTotal: number;
  category: string;
  specs: Record<string, string | number>;
  variations: Array<{
    asin: string;
    value: string;
    available: boolean;
    price: number;
  }>;
  suggestedPrice: number;
  isFBA?: boolean;
  deliveryDays?: number | null;
  filteredOut?: string;
  defaultQuantity?: number;
}

interface FetchResult {
  success: boolean;
  product?: ProductData;
  error?: string;
}

interface FilterParams {
  min_rating?: number;
  min_review_count?: number;
  fba_only?: boolean;
  shipping_time_ranges?: string[];
  apply_tax?: boolean;
}

function passesFilters(
  rating: number,
  ratingsTotal: number,
  isFBA: boolean,
  deliveryDays: number | null,
  filters: FilterParams,
): { passed: boolean; reason?: string } {
  if (filters.min_rating != null && rating < filters.min_rating) {
    return { passed: false, reason: `Rating ${rating} below minimum ${filters.min_rating}` };
  }
  if (filters.min_review_count != null && ratingsTotal < filters.min_review_count) {
    return { passed: false, reason: `Reviews ${ratingsTotal} below minimum ${filters.min_review_count}` };
  }
  if (filters.fba_only && !isFBA) {
    return { passed: false, reason: "Not Fulfilled by Amazon (FBA-only enabled)" };
  }
  if (filters.shipping_time_ranges && filters.shipping_time_ranges.length > 0 && deliveryDays != null) {
    const matched = filters.shipping_time_ranges.some(range => {
      if (range === "0-2 days") return deliveryDays <= 2;
      if (range === "3-7 days") return deliveryDays >= 3 && deliveryDays <= 7;
      if (range === "8-13 days") return deliveryDays >= 8 && deliveryDays <= 13;
      if (range === "14 or more days") return deliveryDays >= 14;
      return false;
    });
    if (!matched) {
      return { passed: false, reason: `Delivery ${deliveryDays} days outside selected ranges` };
    }
  }
  return { passed: true };
}

function estimateTax(price: number): number {
  return Math.round(price * 0.07 * 100) / 100;
}

function extractAsin(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Z0-9]{10}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:\/dp\/|\/gp\/product\/|\/exec\/obidos\/ASIN\/|asin=)([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

function calculateSuggestedPrice(price: number): number {
  const marked = price * 1.3;
  return Math.round(marked) - 0.01;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return str(obj.name ?? obj.label ?? obj.title ?? obj.value ?? fallback, fallback);
  }
  return String(v);
}

function imageUrl(image: string | { url?: string; link?: string; src?: string }): string {
  return typeof image === "string" ? image : str(image.url || image.link || image.src);
}

interface OxylabsVariation {
  asin?: string;
  value?: string;
  is_available?: boolean;
  price?: number | string;
}

interface OxylabsProduct {
  title?: string;
  asin?: string;
  brand?: string;
  description?: string;
  bullets?: Array<string | { text?: string }>;
  images?: Array<string | { url?: string; link?: string; src?: string }>;
  price?: number | string;
  currency?: string;
  stock?: string | { status?: string; quantity?: number | string };
  rating?: number;
  ratings_total?: number;
  category?: string | { name?: string; id?: string; path?: Array<{ name?: string }> };
  variations?: OxylabsVariation[];
  attributes?: Record<string, string | number>;
  specs?: Record<string, string | number>;
}

interface OxylabsResponse {
  results?: Array<{ content?: OxylabsProduct; error?: string }>;
}

async function callOxylabs(username: string, password: string, asin: string): Promise<Response> {
  const payload = {
    source: "amazon_product",
    query: asin,
    domain: "com",
    geo_location: "90210",
    parse: true,
    render: "html",
  };

  const auth = btoa(`${username}:${password}`);

  return fetch("https://realtime.oxylabs.io/v1/queries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });
}

function jsonResult(data: FetchResult, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---- ScraperAPI fallback (used only if Oxylabs fails) ----
async function callScraperApi(apiKey: string, asin: string): Promise<OxylabsProduct | null> {
  const targetUrl = `https://www.amazon.com/dp/${asin}`;
  const apiUrl = `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}&autoparse=true&country_code=us`;

  const res = await fetch(apiUrl);
  if (!res.ok) return null;

  let data: any;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  // ScraperAPI's autoparse response shape for Amazon product pages.
  // Field names are mapped defensively since ScraperAPI can adjust naming over time.
  const title = data.name || data.title || "";
  const priceRaw = data.pricing || data.price || data.full_price || "";
  const images: string[] = Array.isArray(data.images) ? data.images : (data.image ? [data.image] : []);
  const bullets: string[] = Array.isArray(data.feature_bullets) ? data.feature_bullets : (Array.isArray(data.about_this_item) ? data.about_this_item : []);
  const availability = data.availability_status || data.full_availability_status || data.availability || "";

  const mapped: OxylabsProduct = {
    title,
    asin: data.asin || asin,
    brand: data.brand || data.manufacturer || "",
    description: data.full_description || data.description || "",
    bullets,
    images,
    price: priceRaw,
    currency: "USD",
    stock: availability,
    rating: data.average_rating || data.rating || 0,
    ratings_total: data.total_reviews || data.reviews_total || 0,
    category: data.category || (Array.isArray(data.categories) ? data.categories[data.categories.length - 1] : ""),
    variations: [],
    attributes: data.product_information || {},
  };

  return mapped;
}

// ---- Direct scrape fallback (free, no proxy — used only if both Oxylabs and ScraperAPI fail) ----
// HONEST LIMITATION: without a proxy pool, Amazon will block this quickly at any real volume.
// This exists as a last-resort, occasional-use fallback, not as the primary data source.
async function callDirectScrape(asin: string): Promise<OxylabsProduct | null> {
  const targetUrl = `https://www.amazon.com/dp/${asin}`;

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;

  const html = await res.text();
  // Amazon serves a CAPTCHA/robot-check page instead of the product when it blocks a request —
  // detect that explicitly rather than trying (and failing) to parse it as a product.
  if (html.includes("api-services-support@amazon.com") || html.includes("Enter the characters you see below")) {
    return null;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return null;

  const title = doc.querySelector("#productTitle")?.textContent?.trim() || "";
  if (!title) return null; // didn't get a real product page

  const priceText =
    doc.querySelector("#corePrice_feature_div .a-price .a-offscreen")?.textContent?.trim() ||
    doc.querySelector(".a-price .a-offscreen")?.textContent?.trim() ||
    "";

  const mainImage =
    doc.querySelector("#landingImage")?.getAttribute("src") ||
    doc.querySelector("#imgBlkFront")?.getAttribute("src") ||
    "";

  // Additional photos from the thumbnail strip. Amazon's thumbnails are small versions —
  // swapping "._SX38_" / "._SS40_" etc size suffixes for a blank one gives the full-size image.
  const thumbImages = Array.from(doc.querySelectorAll("#altImages img"))
    .map(el => el.getAttribute("src") || "")
    .filter(Boolean)
    .map(src => src.replace(/\._[A-Z]{2}\d+(_[A-Z]{2}\d+)*_\./, "."))
    .filter(src => !src.includes("play-icon") && !src.includes("video"));

  const allImages = Array.from(new Set([mainImage, ...thumbImages].filter(Boolean)));

  const bullets = Array.from(doc.querySelectorAll("#feature-bullets li span.a-list-item"))
    .map(el => el.textContent?.trim() || "")
    .filter(Boolean);

  const availability = doc.querySelector("#availability span")?.textContent?.trim() || "";
  const brand = doc.querySelector("#bylineInfo")?.textContent?.trim().replace(/^(Brand:|Visit the|Store)/i, "").trim() || "";

  const ratingText = doc.querySelector("#acrPopover")?.getAttribute("title") || "";
  const ratingMatch = ratingText.match(/([\d.]+)\s*out of/);
  const reviewsText = doc.querySelector("#acrCustomerReviewText")?.textContent || "";
  const reviewsMatch = reviewsText.match(/([\d,]+)/);

  return {
    title,
    asin,
    brand,
    description: "",
    bullets,
    images: allImages,
    price: priceText,
    currency: "USD",
    stock: availability,
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
    ratings_total: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ""), 10) : 0,
    category: "",
    variations: [],
    attributes: {},
  };
}

const SCRAPE_ERROR = "Failed to scrape live Amazon data for this ASIN. Please check scraper API key / proxy settings.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const username = Deno.env.get("OXYLABS_USERNAME") || "bilal_5MJM7";
    const primaryPassword = Deno.env.get("OXYLABS_PASSWORD") || "2124620+Kaya";
    const backupPassword = "2124620_Kaya";

    const body = await req.json() as { asin?: string; url?: string; filters?: FilterParams; store_id?: string };
    const input = body.asin || body.url || "";
    const asin = extractAsin(input);
    let filters: FilterParams = body.filters || {};
    let defaultQuantity = 1;
    let allowOutOfStock = true;
    let allowDuplicateAsins = true;
    let primeFilter = false;

    // Look up this store's saved Filters (sourcing criteria) and Availability settings so they're
    // always enforced consistently in one place, regardless of which screen triggered the fetch.
    if (body.store_id) {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

          if (!body.filters) {
            const { data: filterRow } = await supabase
              .from("filter_settings")
              .select("min_rating, min_review_count, fba_only, shipping_time_ranges, apply_tax")
              .eq("store_id", body.store_id)
              .maybeSingle();
            if (filterRow) filters = filterRow as FilterParams;
          }

          const { data: availRow } = await supabase
            .from("store_availability_settings")
            .select("default_quantity, prime_filter, allow_out_of_stock, allow_duplicate_asins")
            .eq("store_id", body.store_id)
            .maybeSingle();
          if (availRow) {
            defaultQuantity = Number(availRow.default_quantity) || 1;
            primeFilter = !!availRow.prime_filter;
            allowOutOfStock = availRow.allow_out_of_stock ?? true;
            allowDuplicateAsins = availRow.allow_duplicate_asins ?? true;
          }

          if (!allowDuplicateAsins && asin) {
            const { data: existing } = await supabase
              .from("listings")
              .select("id")
              .eq("store_id", body.store_id)
              .eq("asin", asin)
              .neq("status", "deleted")
              .maybeSingle();
            if (existing) {
              return jsonResult({
                success: false,
                error: `This ASIN is already listed for this store, and "Allow duplicate ASINs" is off in Settings → Availability.`,
              }, 200);
            }
          }
        }
      } catch {
        // Settings lookups are best-effort — never block a fetch because settings couldn't load.
      }
    }

    if (!asin) {
      return jsonResult({
        success: false,
        error: "Could not extract a valid ASIN. Enter a 10-character ASIN or a full Amazon product URL.",
      }, 400);
    }

    const scraperApiKey = Deno.env.get("SCRAPERAPI_KEY") || "";

    let p: OxylabsProduct | null = null;
    let sourceUsed = "oxylabs";
    let oxylabsErrorNote = "";

    try {
      let apiRes = await callOxylabs(username, primaryPassword, asin);
      if (apiRes.status === 401) {
        apiRes = await callOxylabs(username, backupPassword, asin);
      }

      if (apiRes.ok) {
        const apiData = await apiRes.json().catch(() => null) as OxylabsResponse | null;
        const firstResult = apiData?.results?.[0];
        if (firstResult?.content) {
          p = firstResult.content;
        } else {
          oxylabsErrorNote = firstResult?.error || "Oxylabs returned no content";
        }
      } else {
        const errText = await apiRes.text().catch(() => "");
        oxylabsErrorNote = `Oxylabs returned HTTP ${apiRes.status}${errText ? ": " + errText.slice(0, 200) : ""}`;
      }
    } catch (fetchErr) {
      oxylabsErrorNote = `Oxylabs network error: ${fetchErr instanceof Error ? fetchErr.message : "unknown"}`;
    }

    // Fallback to ScraperAPI if Oxylabs failed or returned incomplete data, and a key is configured.
    if ((!p || !str(p.title) || num(p.price) <= 0) && scraperApiKey) {
      try {
        const fallback = await callScraperApi(scraperApiKey, asin);
        if (fallback && str(fallback.title) && num(fallback.price) > 0) {
          p = fallback;
          sourceUsed = "scraperapi";
        }
      } catch {
        // fallback failed silently — we'll report the original Oxylabs error below
      }
    }

    // Last resort: free, no-proxy direct scrape. Honest expectation — this is likely to get
    // blocked by Amazon at any real volume, but it costs nothing so it's worth a try before
    // giving up entirely.
    if (!p || !str(p.title) || num(p.price) <= 0) {
      try {
        const fallback = await callDirectScrape(asin);
        if (fallback && str(fallback.title) && num(fallback.price) > 0) {
          p = fallback;
          sourceUsed = "direct-scrape";
        }
      } catch {
        // fallback failed silently — we'll report the original Oxylabs error below
      }
    }

    if (!p) {
      return jsonResult({
        success: false,
        error: `${SCRAPE_ERROR}${oxylabsErrorNote ? " (" + oxylabsErrorNote + ")" : ""}`,
      }, 502);
    }
    const title = str(p.title, "").trim();
    const price = num(p.price);
    const images = (p.images || []).map(imageUrl).filter(Boolean);
    const mainImage = images[0] || "";
    const bulletPoints = (p.bullets || []).map(bullet => typeof bullet === "string" ? bullet : str(bullet.text)).filter(Boolean);
    const descParts: string[] = [];
    if (p.description) descParts.push(p.description);
    if (bulletPoints.length > 0) descParts.push(bulletPoints.join("\n"));
    const description = descParts.join("\n\n");

    const rating = num(p.rating, 0);
    const ratingsTotal = num(p.ratings_total, 0);

    const isFBA = (() => {
      // Different scrapers (and even different Oxylabs response versions) put this signal
      // in different places. Check every plausible location instead of just one nested spec
      // field, so real Prime/FBA products don't get incorrectly rejected.
      if (p.is_prime === true || p.isPrime === true || p.prime === true) return true;
      if (p.fulfilled_by_amazon === true || p.is_fba === true) return true;

      const badges = Array.isArray(p.badges) ? p.badges : [];
      if (badges.some((b: unknown) => typeof b === "string" && /prime|fulfilled by amazon/i.test(b))) return true;

      const topLevelFulfillment = str(p.fulfillment || p.fulfilled_by || "").toLowerCase();
      if (topLevelFulfillment.includes("amazon") || topLevelFulfillment.includes("fba") || topLevelFulfillment.includes("prime")) return true;

      const availabilityText = str(typeof p.stock === "object" ? p.stock?.status : p.stock, "").toLowerCase();
      if (availabilityText.includes("prime")) return true;

      const allSpecs = { ...(p.attributes || {}), ...(p.specs || {}) } as Record<string, string | number>;
      const fulfillment = str(allSpecs["fulfillment"] || allSpecs["Fulfillment"] || allSpecs["fulfilled_by"] || "").toLowerCase();
      return fulfillment.includes("amazon") || fulfillment.includes("fba") || fulfillment.includes("prime");
    })();

    const deliveryDays: number | null = (() => {
      const allSpecs = { ...(p.attributes || {}), ...(p.specs || {}) } as Record<string, string | number>;
      const delivery = str(allSpecs["delivery"] || allSpecs["shipping"] || "").toLowerCase();
      const match = delivery.match(/(\d+)\s*(?:to|-|–)\s*(\d+)\s*day/);
      if (match) return parseInt(match[2], 10);
      const single = delivery.match(/(\d+)\s*day/);
      return single ? parseInt(single[1], 10) : null;
    })();

    // Validate that we got real data — reject empty/incomplete responses.
    if (!title || price <= 0) {
      return jsonResult({
        success: false,
        error: `${SCRAPE_ERROR} (Received incomplete data — title: "${title || "empty"}", price: ${price})`,
      }, 502);
    }

    let effectivePrice = price;
    if (filters.apply_tax && price > 0) {
      effectivePrice = price + estimateTax(price);
    }

    const product: ProductData = {
      asin: str(p.asin, asin),
      title,
      brand: str(p.brand),
      description,
      bulletPoints,
      images,
      mainImage,
      price: effectivePrice,
      currency: str(p.currency, "USD"),
      stock: typeof p.stock === "object" ? str(p.stock.status, "Unknown") : str(p.stock, "Unknown"),
      rating,
      ratingsTotal,
      category: str(p.category),
      specs: { ...(p.attributes || {}), ...(p.specs || {}) },
      variations: (p.variations || []).map(v => ({
        asin: str(v.asin),
        value: str(v.value),
        available: v.is_available ?? true,
        price: num(v.price, 0),
      })),
      suggestedPrice: effectivePrice > 0 ? calculateSuggestedPrice(effectivePrice) : 0,
      isFBA,
      deliveryDays,
      defaultQuantity,
    };

    // Apply Filters-tab criteria (rating, reviews, FBA-only, shipping time).
    if (Object.keys(filters).length > 0) {
      const filterResult = passesFilters(rating, ratingsTotal, isFBA, deliveryDays, filters);
      if (!filterResult.passed) {
        return jsonResult({
          success: false,
          error: `Product filtered out: ${filterResult.reason}`,
        }, 200);
      }
    }

    // Apply Availability-tab criteria (Prime-only, out-of-stock).
    const stockLower = product.stock.toLowerCase();
    const isOutOfStock = stockLower.includes("out of stock") || stockLower.includes("unavailable") || stockLower.includes("currently unavailable");
    if (!allowOutOfStock && isOutOfStock) {
      return jsonResult({
        success: false,
        error: `Product is out of stock, and "Allow out-of-stock items" is off in Settings → Availability.`,
      }, 200);
    }
    if (primeFilter && !isFBA) {
      return jsonResult({
        success: false,
        error: `Product is not Prime/FBA-fulfilled, and "Prime only" is on in Settings → Availability.`,
        debug_isFBA: isFBA,
        debug_stock: p.stock,
        debug_badges: p.badges,
        debug_fulfillment: p.fulfillment,
        debug_isPrimeField: p.is_prime,
      }, 200);
    }

    return jsonResult({ success: true, product });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResult({ success: false, error: `${SCRAPE_ERROR} (${message})` }, 500);
  }
});
