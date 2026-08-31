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
