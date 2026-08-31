const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Uses the Anthropic API to turn raw Amazon product data into an eBay-optimized
// title (<=80 chars) plus a set of item specifics (aspects) eBay can display.
// Requires the ANTHROPIC_API_KEY secret to be set in Supabase — if it's missing,
// this returns the original title untouched so callers can safely fall back.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-5-haiku-20241022";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const body = await req.json();
    const { title, bullets, brand, category, description } = body as {
      title: string; bullets?: string[]; brand?: string; category?: string; description?: string;
    };

    if (!title) {
      return new Response(JSON.stringify({ error: "Missing title" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!apiKey) {
      // No key configured — fall back to the original title, no aspects. Not an error;
      // callers should treat this as "AI titles unavailable" and proceed normally.
      return new Response(JSON.stringify({ title, aspects: {}, aiUsed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You write eBay listing titles and item specifics from Amazon product data.

Amazon title: ${title}
Brand: ${brand || "unknown"}
Category: ${category || "unknown"}
Bullet points:
${(bullets || []).slice(0, 6).map(b => `- ${b}`).join("\n") || "(none)"}
Description: ${(description || "").slice(0, 500)}

Return ONLY a JSON object, no other text, in this exact shape:
{"title": "<eBay title, keyword-rich, under 80 characters, no ALL CAPS spam>", "aspects": {"Brand": "<value>", "Color": "<value or omit>", "Material": "<value or omit>", "Type": "<value or omit>"}}

Only include aspect keys you can confidently infer from the data above. Omit any you're unsure about. The title must be 80 characters or fewer.`;

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Fail soft — the batch shouldn't break because AI titling is down.
      console.error("Anthropic API error:", errText);
      return new Response(JSON.stringify({ title, aspects: {}, aiUsed: false, error: errText.slice(0, 200) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const text = (data.content || []).map((b: any) => b.text || "").join("").trim();

    let parsed: { title?: string; aspects?: Record<string, string> } = {};
    try {
      const cleaned = text.replace(/^```json\s*|```\s*$/g, "");
      parsed = JSON.parse(cleaned);
    } catch {
      // Model didn't return clean JSON — fall back to original title.
      return new Response(JSON.stringify({ title, aspects: {}, aiUsed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiTitle = (parsed.title || title).slice(0, 80);
    const aspectsRaw = parsed.aspects || {};
    const aspects: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(aspectsRaw)) {
      if (typeof v === "string" && v.trim()) aspects[k] = [v.trim()];
    }

    return new Response(JSON.stringify({ title: aiTitle, aspects, aiUsed: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("ai-generate-content error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
