const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const imageUrl = url.searchParams.get("url");

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allowedHosts = [
      "m.media-amazon.com",
      "images-na.ssl-images-amazon.com",
      "ecx.images-amazon.com",
      "images.amazon.com",
      "m.media-amazon.co.uk",
      "m.media-amazon.de",
      "m.media-amazon.fr",
      "m.media-amazon.co.jp",
      "m.media-amazon.ca",
      "m.media-amazon.com.au",
      "m.media-amazon.in",
      "m.media-amazon.it",
      "m.media-amazon.es",
      "m.media-amazon.com.mx",
      "m.media-amazon.com.br",
    ];

    if (!allowedHosts.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith("." + h))) {
      return new Response(JSON.stringify({ error: "Domain not allowed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imgRes = await fetch(parsedUrl.toString(), {
      headers: {
        "Accept": "image/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });

    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: `Image fetch failed (${imgRes.status})` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const cacheControl = imgRes.headers.get("cache-control") || "public, max-age=86400, immutable";

    const buf = await imgRes.arrayBuffer();

    return new Response(buf, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
