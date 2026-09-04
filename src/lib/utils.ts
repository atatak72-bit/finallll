export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export interface PricingTierInput {
  min: number
  max: number
  profitPct: number
  fixProfit: number
}

/**
 * Pricing engine — calculates the final eBay list price from an Amazon source cost.
 *
 * 1. Find the active tier where amazonCost >= from AND amazonCost < to.
 * 2. NetTarget = (amazonCost * (1 + profitPct/100)) + fixProfit
 * 3. FinalEbayPrice = (NetTarget + ebayFixedFee) / (1 - ebayPercentageFee/100)
 *
 * When pricing is disabled, returns the raw amazon cost unchanged.
 */
export function calculateEbayPrice(
  amazonCost: number,
  tiers: PricingTierInput[],
  ebayPercentageFee: number,
  ebayFixedFee: number,
  pricingEnabled: boolean,
): { finalPrice: number; profit: number; netTarget: number; tier: PricingTierInput | null } {
  if (!pricingEnabled || !tiers.length) {
    return { finalPrice: amazonCost, profit: 0, netTarget: amazonCost, tier: null }
  }

  const tier = tiers.find(t => amazonCost >= t.min && amazonCost < t.max) || tiers[tiers.length - 1]
  const netTarget = (amazonCost * (1 + tier.profitPct / 100)) + tier.fixProfit
  const finalPrice = (netTarget + ebayFixedFee) / (1 - ebayPercentageFee / 100)
  const profit = netTarget - amazonCost

  return {
    finalPrice: Math.round(finalPrice * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    netTarget: Math.round(netTarget * 100) / 100,
    tier,
  }
}

// Strip HTML tags, returning plain readable text.
export function stripHtml(html: string): string {
  if (!html) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.body.textContent || ''
  } catch {
    return html.replace(/<\/?[^>]+(>|$)/g, '')
  }
}

// Sends a batch of real Amazon image URLs to the `img` edge function and gets back opaque
// tokens in the same order — used to build <img> URLs that reveal nothing about the source.
// Any URL that fails to register (bad host, network error) becomes an empty string, filtered
// out by the caller.
export async function proxyImageUrls(urls: string[]): Promise<string[]> {
  if (!urls.length) return []
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  if (!supabaseUrl) return urls

  try {
    // Note: this function is deployed under the slug "smart-worker" in Supabase (auto-assigned
    // by the function editor, distinct from its display name "img") — this must match that
    // exact route or every call 404s.
    const res = await fetch(`${supabaseUrl}/functions/v1/smart-worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ urls }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; ids?: (string | null)[] }
    if (!res.ok || !data.success || !data.ids) return urls
    return data.ids.map(id => id ? `${supabaseUrl}/functions/v1/smart-worker?id=${id}` : '').filter(Boolean)
  } catch {
    // If the proxy call itself fails, fall back to the original URLs rather than losing images.
    return urls
  }
}

// Builds a polished, distinctly-branded HTML listing description (header bar with store
// name, trust badge strip, key features checklist, image gallery, description, and a
// card-style footer with About/Shipping/Returns/Satisfaction) from raw Amazon product data.
// Used by both the Single Add and Bulk Add flows so every listing gets the same
// professional look without the seller having to design it by hand each time.
export function buildTemplateDescription(product: {
  title?: string
  bulletPoints?: string[]
  description?: string
  images?: string[]
}): string {
  const title = stripHtml(product?.title || '')
  const bullets = (product?.bulletPoints || []).map(b => stripHtml(String(b))).filter(Boolean)
  const description = stripHtml(product?.description || '').trim()
  // Images arrive here already proxied (see fetchAmazonProduct in useData.ts) — use as-is.
  const images = (product?.images || []).filter(Boolean)
  const mainImage = images[0] || ''
  const galleryImages = images.slice(1, 5)

  const featuresHtml = bullets.length
    ? bullets.map(b => `
        <tr>
          <td width="24" style="vertical-align:top;padding:4px 8px 4px 0;">
            <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#0f766e;text-align:center;line-height:16px;color:#fff;font-size:11px;font-weight:bold;">&#10003;</span>
          </td>
          <td style="vertical-align:top;padding:4px 0;font-size:13px;line-height:1.6;color:#334155;">${b}</td>
        </tr>`).join('')
    : ''

  const galleryHtml = galleryImages.length
    ? `<table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${galleryImages.map(img => `
          <td style="padding:4px;width:${Math.floor(100 / galleryImages.length)}%;">
            <img src="${img}" alt="${title}" style="width:100%;display:block;border-radius:8px;border:1px solid #e2e8f0;" />
          </td>`).join('')}
      </tr></table>`
    : ''

  return `<div style="max-width:820px;margin:0 auto;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1e293b;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;">

  <!-- Header bar -->
  <div style="background:#0f172a;padding:16px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">
        <span style="font-size:14px;color:#5eead4;margin-right:6px;">&#9733;</span>
        <span style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1px;text-transform:uppercase;">Trusted Seller</span>
      </td>
      <td style="text-align:right;vertical-align:middle;">
        <a href="https://www.ebay.com/sch/i.html?_ssn={{store_name}}&_sop=10" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">New Arrivals</a>
        <a href="https://www.ebay.com/fdbk/feedback_profile/{{store_name}}" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">Feedback</a>
        <a href="https://contact.ebay.com/ws/eBayISAPI.dll?ContactUserNextGen&requested={{store_name}}" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">Contact</a>
      </td>
    </tr></table>
  </div>

  <!-- Accent strip -->
  <div style="height:4px;background:linear-gradient(90deg,#0f766e,#14b8a6,#5eead4);"></div>

  <!-- Trust badges -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;"><tr>
    <td style="text-align:center;padding:16px 6px;font-size:11px;color:#475569;">
      <div style="font-size:20px;">&#128666;</div><b style="color:#0f172a;">Fast Shipping</b><br>We ship promptly
    </td>
    <td style="text-align:center;padding:16px 6px;font-size:11px;color:#475569;border-left:1px solid #e2e8f0;">
      <div style="font-size:20px;">&#8635;</div><b style="color:#0f172a;">30-Day Returns</b><br>No hassle
    </td>
    <td style="text-align:center;padding:16px 6px;font-size:11px;color:#475569;border-left:1px solid #e2e8f0;">
      <div style="font-size:20px;">&#128172;</div><b style="color:#0f172a;">Real Support</b><br>Fast responses
    </td>
    <td style="text-align:center;padding:16px 6px;font-size:11px;color:#475569;border-left:1px solid #e2e8f0;">
      <div style="font-size:20px;">&#9989;</div><b style="color:#0f172a;">Guaranteed</b><br>100% satisfaction
    </td>
  </tr></table>

  <!-- Main content -->
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr>
    <td style="vertical-align:top;width:58%;padding-right:20px;">
      <h2 style="font-size:19px;color:#0f172a;margin:0 0 14px;line-height:1.35;">${title}</h2>
      ${featuresHtml ? `
        <div style="font-size:12px;font-weight:700;color:#0f766e;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Key Features</div>
        <table cellpadding="0" cellspacing="0">${featuresHtml}</table>
      ` : ''}
      ${description ? `
        <div style="font-size:12px;font-weight:700;color:#0f766e;letter-spacing:0.5px;text-transform:uppercase;margin:18px 0 8px;">Description</div>
        <p style="line-height:1.7;font-size:13px;color:#334155;margin:0;">${description}</p>
      ` : ''}
    </td>
    <td style="vertical-align:top;width:42%;">
      ${mainImage ? `<img src="${mainImage}" alt="${title}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;display:block;margin-bottom:8px;" />` : ''}
      ${galleryHtml}
    </td>
  </tr></table>

  <!-- Footer info cards -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px;border-top:1px solid #e2e8f0;"><tr>
    <td style="width:50%;vertical-align:top;padding:8px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;">
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">&#127970; About Us</div>
        <div style="font-size:12px;color:#64748b;line-height:1.6;">We're committed to quality products and a great shopping experience — our goal is to earn your trust with every order.</div>
      </div>
    </td>
    <td style="width:50%;vertical-align:top;padding:8px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;">
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">&#128230; Shipping</div>
        <div style="font-size:12px;color:#64748b;line-height:1.6;">We work hard to get every order shipped and to you as quickly as possible.</div>
      </div>
    </td>
  </tr><tr>
    <td style="width:50%;vertical-align:top;padding:8px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;">
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">&#8635; Returns</div>
        <div style="font-size:12px;color:#64748b;line-height:1.6;">30-day return policy. Not fully satisfied? Contact us and we'll make it right.</div>
      </div>
    </td>
    <td style="width:50%;vertical-align:top;padding:8px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;">
        <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">&#9989; Satisfaction</div>
        <div style="font-size:12px;color:#64748b;line-height:1.6;">Your satisfaction is our top priority — every customer deserves a great experience start to finish.</div>
      </div>
    </td>
  </tr></table>
</div>`
}

// ---- Editable listing-description template engine (Settings > Templates) ----
// A tiny Mustache-style renderer: {{key}} does a plain substitution; {{#key}}...{{/key}}
// either loops (if data[key] is an array, with {{.}} referring to the current item) or
// shows the block once (if data[key] is a truthy string, with {{.}} referring to that
// string) — and is omitted entirely if data[key] is empty/falsy.
export function renderListingTemplate(template: string, data: Record<string, unknown>): string {
  let out = template.replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_match, key: string, inner: string) => {
    const value = data[key]
    if (Array.isArray(value)) {
      return value.map(item => renderListingTemplate(inner, { ...data, '.': item })).join('')
    }
    if (value) {
      return renderListingTemplate(inner, { ...data, '.': value })
    }
    return ''
  })
  out = out.replace(/{{\s*([.\w]+)\s*}}/g, (_match, key: string) => {
    const value = data[key]
    if (value === undefined || value === null || Array.isArray(value)) return ''
    return String(value)
  })
  return out
}

// The default template used for any store that hasn't saved a custom one yet in
// Settings > Templates. Uses {{store_name}} (never a hardcoded brand) so the exact same
// template produces a correctly-branded listing on every connected store automatically.
export const DEFAULT_LISTING_TEMPLATE = `<div style="user-select:none;-webkit-user-select:none;">
<style>.a{font-family:Arial,sans-serif;max-width:1000px;margin:0 auto;background:#fff;color:#333}.b{background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:18px;text-align:center;color:#fff}.b b{font-size:19px}.b span{display:block;font-size:11px;opacity:.85;margin-top:3px}.c{display:flex;flex-wrap:wrap;justify-content:center;background:#0d3f7a}.c a{padding:10px 14px;color:#fff;text-decoration:none;font-size:11px;font-weight:700;text-transform:uppercase}.d{display:flex;flex-wrap:wrap;justify-content:center;gap:18px;background:#f0fdfa;padding:10px;font-size:10px;color:#0f172a}.e{padding:20px}.f{display:flex;gap:24px;flex-wrap:wrap}.g{flex:1;min-width:240px}.h{flex:0 0 280px;border:1px solid #e2e2e2;border-radius:8px;padding:8px}.h img{display:block;width:100%;max-height:260px;object-fit:contain}.i{font-size:17px;font-weight:700;color:#17233f;margin:0 0 14px}.j{font-size:14px;font-weight:600;color:#17233f;border-bottom:1px solid #ddd;padding-bottom:6px;margin:14px 0 8px}.k{padding-left:18px;margin:0;font-size:12px;line-height:1.7}.l{font-size:12px;line-height:1.7}.m{background:#0d3f7a;color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;padding:8px 20px}.n{font-size:12px;line-height:1.6;color:#444;padding:12px 20px 18px}.o{text-align:center;padding:10px 0 0;font-size:11px;color:#666;border-top:1px solid #eee;margin:12px 20px}</style>
<div class="a">
<div class="b"><b>&#9733; {{store_name}}</b><span>Premium Quality &amp; Fast Shipping</span></div>
<div class="c">
<a  href="https://stores.ebay.com/{{store_name}}">Store</a>
<a  href="https://www.ebay.com/sch/i.html?_ssn={{store_name}}&_sop=10">New Arrivals</a>
<a  href="https://feedback.ebay.com/ws/eBayISAPI.dll?ViewFeedback2&userid={{store_name}}">Feedback</a>
<a  href="https://contact.ebay.com/ws/eBayISAPI.dll?FindAnswers&frm=284&requested={{store_name}}">Contact</a>
</div>
<div class="d">
<span>&#128666; Fast Shipping</span><span>&#8635; 30-Day Returns</span><span>&#128172; Real Support</span><span>&#9989; Guaranteed</span>
</div>
<div class="e">
<div class="f">
<div class="g">
<h1 class="i">{{title}}</h1>
<div class="j">Key Features</div><ul class="k">{{#feature_bullets}}<li>{{.}}</li>{{/feature_bullets}}</ul>
{{#product_description}}<div class="j">Description</div><div class="l">{{.}}</div>{{/product_description}}
</div>
<div class="h">{{#main_image}}<img src="{{.}}">{{/main_image}}</div>
</div>
</div>
<div class="m">About Us</div>
<div class="n">Welcome to {{store_name}}! We offer great prices on quality products across a wide range of categories. Our goal is a smooth experience from browsing to delivery — feel free to check out our other listings or reach out anytime with questions.</div>
<div class="m">Shipping</div>
<div class="n">We work hard to get every order to you as quickly as possible, with tracking provided on every order. International orders may be subject to customs duties depending on your country.</div>
<div class="m">Returns</div>
<div class="n">We offer a 30-day return policy on items you're not completely satisfied with. You have the option of a full refund or an exchange — just reach out to us to get started.</div>
<div class="m">Customer Satisfaction</div>
<div class="n">Your satisfaction is our top priority. If there's ever a problem with your order, please message us and we'll make it right as quickly as possible.</div>
<div class="o">Sold by {{store_name}}</div>
</div>
</div>`


// eBay's inventory item "description" field has a hard 4000-character limit. Our branded
// template's fixed markup (header, badges, footer cards, etc.) already uses a meaningful
// chunk of that budget, so instead of letting the whole render blow past the limit (and
// risk eBay rejecting the listing, or worse, truncating raw HTML mid-tag), this measures
// the template's fixed overhead first and trims only the flexible part — the actual
// product_description text — to whatever room is left. Bullets/title/images stay intact.
function truncateWordSafe(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  let t = text.slice(0, maxLen)
  const lastSpace = t.lastIndexOf(' ')
  if (lastSpace > maxLen * 0.6) t = t.slice(0, lastSpace)
  return t.trim()
}

export function fitDescriptionToBudget(
  template: string,
  data: Record<string, unknown>,
  maxTotal = 4000,
): string {
  const margin = 50

  // Bullets themselves (not just the description) can be arbitrarily long/numerous — real
  // Amazon feature bullets are often full sentences, and several of them can already exceed
  // eBay's 4000-char cap on their own, before any description text is even added. Cap them
  // first so the "fixed" part of the template (everything except the description) can never
  // run away on its own.
  const rawBullets = Array.isArray(data.feature_bullets) ? (data.feature_bullets as unknown[]).map(String) : []
  const cappedBullets = rawBullets.slice(0, 6).map(b => truncateWordSafe(b, 110))
  const safeData = { ...data, feature_bullets: cappedBullets }

  const withoutDesc = renderListingTemplate(template, { ...safeData, product_description: '' })
  const budget = Math.max(0, maxTotal - withoutDesc.length - margin)
  const rawDesc = String(data.product_description || '')
  const trimmedDesc = rawDesc.length > budget ? truncateWordSafe(rawDesc, budget) : rawDesc

  return renderListingTemplate(template, { ...safeData, product_description: trimmedDesc })
}
