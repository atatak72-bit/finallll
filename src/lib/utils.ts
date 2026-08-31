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

// Routes an Amazon CDN image URL through our own Supabase edge function so the URL a buyer
// (or anyone viewing image source) sees is our own domain, not m.media-amazon.com — the
// listing never visibly reveals it was sourced from Amazon.
export function proxyImageUrl(url: string): string {
  if (!url) return url
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  if (!supabaseUrl) return url
  return `${supabaseUrl}/functions/v1/amazon-image-proxy?url=${encodeURIComponent(url)}`
}

// Builds a polished, branded HTML listing description (banner, trust badges, key features,
// description, image, and About/Shipping/Returns/Satisfaction sections) from raw Amazon
// product data. Used by both the Single Add and Bulk Add flows so every listing gets the
// same professional look without the seller having to design it by hand each time.
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
  const mainImage = product?.images?.[0] || ''

  const bulletsHtml = bullets.length
    ? `<ul style="margin:0;padding-left:18px;line-height:1.6;">${bullets.map(b => `<li>${b}</li>`).join('')}</ul>`
    : ''

  return `<div style="max-width:800px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#222;border:1px solid #e2e2e2;border-radius:6px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1e3c72,#2a5298);padding:24px;text-align:center;color:#fff;">
    <div style="font-size:22px;font-weight:bold;letter-spacing:1px;">PREMIUM QUALITY &amp; FAST SHIPPING</div>
    <div style="font-size:13px;opacity:.85;margin-top:4px;">Dedicated Customer Support</div>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;"><tr>
    <td style="text-align:center;padding:14px 6px;font-size:12px;">🚚<br><b>Fast Shipping</b><br>On All Items</td>
    <td style="text-align:center;padding:14px 6px;font-size:12px;">↩️<br><b>30-Day Free Returns</b><br>Hassle-Free</td>
    <td style="text-align:center;padding:14px 6px;font-size:12px;">💬<br><b>Customer Support</b><br>Excellent Service</td>
    <td style="text-align:center;padding:14px 6px;font-size:12px;">✅<br><b>100% Satisfaction</b><br>Guaranteed</td>
  </tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;"><tr>
    <td style="vertical-align:top;width:60%;padding:0 16px 0 20px;">
      <h2 style="font-size:18px;color:#1e3c72;margin:0 0 10px;">${title}</h2>
      ${bullets.length ? `<h3 style="font-size:14px;color:#1e3c72;margin:0 0 6px;">Key Features</h3>${bulletsHtml}` : ''}
      ${description ? `<h3 style="font-size:14px;color:#1e3c72;margin:14px 0 6px;">Description</h3><p style="line-height:1.6;font-size:13px;">${description}</p>` : ''}
    </td>
    <td style="vertical-align:top;width:40%;text-align:center;padding-right:20px;">
      ${mainImage ? `<img src="${mainImage}" alt="${title}" style="max-width:100%;border-radius:8px;border:1px solid #e2e2e2;" />` : ''}
    </td>
  </tr></table>
  <div>
    <div style="background:#1e3c72;color:#fff;padding:10px 20px;font-weight:bold;font-size:13px;">ABOUT US</div>
    <div style="padding:10px 20px;font-size:12px;background:#fafafa;line-height:1.6;">We are committed to providing quality products and a great shopping experience. Our goal is to earn your trust with every order.</div>
    <div style="background:#1e3c72;color:#fff;padding:10px 20px;font-weight:bold;font-size:13px;">SHIPPING</div>
    <div style="padding:10px 20px;font-size:12px;background:#fafafa;line-height:1.6;">We work hard to get every order to you as quickly as possible. Orders are shipped within 1-2 business days.</div>
    <div style="background:#1e3c72;color:#fff;padding:10px 20px;font-weight:bold;font-size:13px;">RETURNS</div>
    <div style="padding:10px 20px;font-size:12px;background:#fafafa;line-height:1.6;">We offer a 30-day return policy. If you're not fully satisfied, contact us and we'll make it right.</div>
    <div style="background:#1e3c72;color:#fff;padding:10px 20px;font-weight:bold;font-size:13px;">CUSTOMER SATISFACTION</div>
    <div style="padding:10px 20px;font-size:12px;background:#fafafa;line-height:1.6;">Your satisfaction is our top priority. We want every customer to have a great experience from start to finish.</div>
  </div>
</div>`
}
