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
export const DEFAULT_LISTING_TEMPLATE = `<div style="max-width:820px;margin:0 auto;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1e293b;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;user-select:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;">

  <div style="background:#0f172a;padding:16px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">
        <span style="font-size:14px;color:#5eead4;margin-right:6px;">&#9733;</span>
        <span style="font-size:15px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">{{store_name}}</span>
      </td>
      <td style="text-align:right;vertical-align:middle;">
        <a href="https://www.ebay.com/sch/i.html?_ssn={{store_name}}&_sop=10" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">New Arrivals</a>
        <a href="https://www.ebay.com/fdbk/feedback_profile/{{store_name}}" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">Feedback</a>
        <a href="https://contact.ebay.com/ws/eBayISAPI.dll?ContactUserNextGen&requested={{store_name}}" target="_blank" rel="noopener" style="font-size:11px;color:#cbd5e1;text-decoration:none;padding:4px 10px;border:1px solid #334155;border-radius:20px;margin-left:6px;">Contact</a>
      </td>
    </tr></table>
  </div>

  <div style="height:4px;background:linear-gradient(90deg,#0f766e,#14b8a6,#5eead4);"></div>

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

  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr>
    <td style="vertical-align:top;width:58%;padding-right:20px;">
      <h2 style="font-size:19px;color:#0f172a;margin:0 0 14px;line-height:1.35;">{{title}}</h2>
      {{#feature_bullets}}
      <div style="font-size:12px;font-weight:700;color:#0f766e;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Key Features</div>
      <table cellpadding="0" cellspacing="0"><tr>
        <td width="24" style="vertical-align:top;padding:4px 8px 4px 0;">
          <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#0f766e;text-align:center;line-height:16px;color:#fff;font-size:11px;font-weight:bold;">&#10003;</span>
        </td>
        <td style="vertical-align:top;padding:4px 0;font-size:13px;line-height:1.6;color:#334155;">{{.}}</td>
      </tr></table>
      {{/feature_bullets}}
      {{#product_description}}
      <div style="font-size:12px;font-weight:700;color:#0f766e;letter-spacing:0.5px;text-transform:uppercase;margin:18px 0 8px;">Description</div>
      <p style="line-height:1.7;font-size:13px;color:#334155;margin:0;">{{.}}</p>
      {{/product_description}}
    </td>
    <td style="vertical-align:top;width:42%;">
      {{#main_image}}
      <img src="{{.}}" alt="{{title}}" style="width:100%;border-radius:10px;border:1px solid #e2e8f0;display:block;" />
      {{/main_image}}
    </td>
  </tr></table>

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


// eBay's inventory item "description" field has a hard 4000-character limit. Our branded
// template's fixed markup (header, badges, footer cards, etc.) already uses a meaningful
// chunk of that budget, so instead of letting the whole render blow past the limit (and
// risk eBay rejecting the listing, or worse, truncating raw HTML mid-tag), this measures
// the template's fixed overhead first and trims only the flexible part — the actual
// product_description text — to whatever room is left. Bullets/title/images stay intact.
export function fitDescriptionToBudget(
  template: string,
  data: Record<string, unknown>,
  maxTotal = 4000,
): string {
  const withoutDesc = renderListingTemplate(template, { ...data, product_description: '' })
  const margin = 50
  const budget = Math.max(0, maxTotal - withoutDesc.length - margin)
  const rawDesc = String(data.product_description || '')
  let trimmedDesc = rawDesc
  if (rawDesc.length > budget) {
    trimmedDesc = rawDesc.slice(0, budget)
    const lastSpace = trimmedDesc.lastIndexOf(' ')
    if (lastSpace > budget * 0.7) trimmedDesc = trimmedDesc.slice(0, lastSpace)
    trimmedDesc = trimmedDesc.trim()
  }
  return renderListingTemplate(template, { ...data, product_description: trimmedDesc })
}
