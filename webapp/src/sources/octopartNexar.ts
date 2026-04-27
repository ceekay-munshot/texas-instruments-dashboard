// ── Nexar / Octopart single-SKU fetch + normalize ───────────────────────────
// OAuth2 client_credentials → GraphQL `supSearchMpn` → typed normalized output.
// Credentials never leave this module; errors are sanitized before being
// returned to callers. Token is cached in module scope (per-Worker-isolate)
// for reuse within a single isolate's lifetime.

import { classifyDistributor, canonicalDistributorName, type DistributorTier } from '../data/sourceTypes'

const TOKEN_URL = 'https://identity.nexar.com/connect/token'
const GRAPHQL_URL = 'https://api.nexar.com/graphql'

// Per-isolate token cache. Cloudflare Workers isolates are short-lived (~5 min
// idle) so this is a best-effort speedup, not durable storage.
let cachedToken: { token: string; expiresAt: number } | null = null

async function getNexarToken(clientId: string, clientSecret: string): Promise<string> {
  // 60-second safety margin so we don't ride a token to its last second.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    // Don't echo body — could include error detail with sensitive context.
    throw new Error(`token endpoint returned HTTP ${res.status}`)
  }
  const data: any = await res.json()
  const token = data?.access_token
  if (!token || typeof token !== 'string') {
    throw new Error('token endpoint did not return access_token')
  }
  const expiresInSec = Number(data?.expires_in) || 1800
  cachedToken = { token, expiresAt: Date.now() + expiresInSec * 1000 }
  return token
}

// Standard Nexar supSearchMpn query covering exactly the fields the user
// validated in the Nexar playground.
const SEARCH_MPN_QUERY = `
query SupSearchMpn($mpn: String!) {
  supSearchMpn(q: $mpn, limit: 1) {
    hits
    results {
      part {
        mpn
        manufacturer { name }
        shortDescription
        sellers {
          company { name }
          offers {
            inventoryLevel
            moq
            packaging
            clickUrl
            prices {
              quantity
              price
              currency
            }
          }
        }
      }
    }
  }
}
`.trim()

export async function fetchNexarPart(opts: {
  clientId: string
  clientSecret: string
  mpn: string
}): Promise<unknown> {
  const token = await getNexarToken(opts.clientId, opts.clientSecret)
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: SEARCH_MPN_QUERY,
      variables: { mpn: opts.mpn },
    }),
  })
  if (!res.ok) {
    throw new Error(`graphql endpoint returned HTTP ${res.status}`)
  }
  const data: any = await res.json()
  if (data?.errors && Array.isArray(data.errors) && data.errors.length > 0) {
    const firstMsg = String(data.errors[0]?.message || 'unspecified GraphQL error').slice(0, 160)
    throw new Error(`graphql error: ${firstMsg}`)
  }
  return data
}

// ── Normalized output types ──────────────────────────────────────────────────

export type NexarPriceBreak = { quantity: number; price: number; currency: string }

export type NexarOffer = {
  distributor: string | null
  distributorTier: DistributorTier
  inventory: number
  moq: number | null
  packaging: string | null
  unitPrice: number | null
  unitPriceQty: number | null
  currency: string | null
  priceBreaks: NexarPriceBreak[]
  clickUrl: string | null
  /** True when the chosen unit price comes from a price break with quantity > 10
   * (i.e. the seller has no qty=1 break — comparison basis differs from default). */
  quantityBasisWarning?: boolean
}

export type NexarNormalized = {
  configured: boolean
  status: 'ok' | 'no_match' | 'not_configured' | 'error'
  source: 'octopart_nexar'
  requestedMpn: string
  matchedMpn: string | null
  manufacturer: string | null
  description: string | null
  fetchedAt: string
  sellerCount: number
  offerCount: number
  trustedOfferCount: number
  brokerOfferCount: number

  // ── Inventory aggregations ─────────────────────────────────────────────────
  /** Sum of inventory across trusted/core offers (existing field, kept for
   * backward compatibility). Equivalent to *Available* when no negative-stock
   * values are reported. */
  totalTrustedInventory: number
  totalBrokerInventory: number
  /** Sum of inventory across trusted/core offers with `inventory > 0` only.
   * This is the intent-clear name for shortage monitoring. */
  totalTrustedAvailableInventory: number
  totalBrokerAvailableInventory: number

  // ── Price metrics ──────────────────────────────────────────────────────────
  /** Primary signal: lowest trusted/core unit price among offers that are
   * actually buyable (inventory > 0), preferring qty≤10 + no qty-basis warning;
   * falls back to any in-stock trusted offer if no preferred match exists. */
  bestTrustedAvailableUnitPrice: number | null
  bestTrustedAvailableDistributor: string | null
  bestTrustedAvailableInventory: number | null
  bestTrustedAvailableQtyBasis: number | null

  /** Reference / debug: lowest trusted/core unit price across ALL trusted
   * offers regardless of inventory or MOQ. Intentionally unfiltered so a
   * consumer can see the floor quote even when it's a high-MOQ reel quote. */
  bestTrustedQuotedUnitPrice: number | null
  bestTrustedQuotedDistributor: string | null
  bestTrustedQuotedInventory: number | null
  bestTrustedQuotedQtyBasis: number | null

  /** Backward-compatible alias. Equals bestTrustedAvailableUnitPrice if any
   * trusted offer is buyable; otherwise falls back to bestTrustedQuotedUnitPrice
   * (the warnings array will indicate the fallback condition). */
  bestTrustedUnitPrice: number | null

  /** Lowest unit price across ALL offers including brokers — *not* an
   * investor-grade signal. Use as a market-floor / debug reference only. */
  bestAnyUnitPrice: number | null

  trustedDistributors: string[]
  allOffers: NexarOffer[]

  /** Top-level methodology / quality flags. Possible values:
   *  - "best_trusted_quote_requires_high_moq"
   *  - "best_trusted_quote_zero_inventory"
   *  - "best_any_price_from_broker"
   *  - "broker_inventory_excluded_from_core_signal" */
  warnings: string[]

  /** Optional sanitized error message — only set when status === 'error'. */
  message?: string
}

function asNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── Best-offer selection helpers ─────────────────────────────────────────────

/** Tiered selection: prefer in-stock trusted offers with qty≤10 and no
 * quantityBasisWarning; fall back to any in-stock trusted offer; else null. */
function pickBestTrustedAvailable(offers: NexarOffer[]): NexarOffer | null {
  const inStock = offers.filter(o => o.inventory > 0 && o.unitPrice != null && o.unitPrice > 0)
  if (inStock.length === 0) return null
  // Tier 1: qty ≤ 10 AND no quantity-basis warning
  const tier1 = inStock.filter(o =>
    o.unitPriceQty != null && o.unitPriceQty <= 10 && !o.quantityBasisWarning
  )
  const pool = tier1.length > 0 ? tier1 : inStock
  // Lowest unit price wins
  return pool.slice().sort((a, b) => (a.unitPrice as number) - (b.unitPrice as number))[0]
}

/** Cheapest unit price across the offer set, regardless of inventory or MOQ. */
function pickBestQuoted(offers: NexarOffer[]): NexarOffer | null {
  const candidates = offers.filter(o => o.unitPrice != null && o.unitPrice > 0)
  if (candidates.length === 0) return null
  return candidates.slice().sort((a, b) => (a.unitPrice as number) - (b.unitPrice as number))[0]
}

export function normalizeNexarPart(raw: any, requestedMpn: string): NexarNormalized {
  const fetchedAt = new Date().toISOString()
  const result = raw?.data?.supSearchMpn?.results?.[0]
  const part = result?.part

  if (!part) {
    return emptyNormalized({ status: 'no_match', requestedMpn, fetchedAt })
  }

  const matchedMpn = part.mpn || requestedMpn
  const manufacturer = part.manufacturer?.name || null
  const description = part.shortDescription || null
  const sellers: any[] = Array.isArray(part.sellers) ? part.sellers : []

  const allOffers: NexarOffer[] = []
  for (const seller of sellers) {
    const distributor: string | null = seller?.company?.name || null
    const tier = classifyDistributor(distributor)
    const offers: any[] = Array.isArray(seller?.offers) ? seller.offers : []
    for (const off of offers) {
      const breaks: NexarPriceBreak[] = (Array.isArray(off?.prices) ? off.prices : [])
        .map((p: any) => ({
          quantity: asNumber(p?.quantity),
          price: asNumber(p?.price),
          currency: String(p?.currency || ''),
        }))
        .filter((p: NexarPriceBreak) => p.quantity > 0 && p.price > 0)
        .sort((a: NexarPriceBreak, b: NexarPriceBreak) => a.quantity - b.quantity)

      // Prefer the lowest qty break with quantity ≤ 10. Otherwise use the
      // lowest-available quantity break and flag quantityBasisWarning.
      const unitOrSmall = breaks.find(b => b.quantity <= 10) || breaks[0] || null
      const quantityBasisWarning = !!(unitOrSmall && unitOrSmall.quantity > 10)

      const offer: NexarOffer = {
        distributor,
        distributorTier: tier,
        inventory: asNumber(off?.inventoryLevel),
        moq: off?.moq != null ? asNumber(off.moq) : null,
        packaging: off?.packaging || null,
        unitPrice: unitOrSmall ? unitOrSmall.price : null,
        unitPriceQty: unitOrSmall ? unitOrSmall.quantity : null,
        currency: unitOrSmall ? unitOrSmall.currency : null,
        priceBreaks: breaks,
        clickUrl: off?.clickUrl || null,
      }
      if (quantityBasisWarning) offer.quantityBasisWarning = true
      allOffers.push(offer)
    }
  }

  const trustedOffers = allOffers.filter(o => o.distributorTier === 'authorized_or_core')
  const brokerOffers = allOffers.filter(o => o.distributorTier === 'marketplace_or_broker')

  // Inventory aggregations
  const totalTrustedInventory = trustedOffers.reduce((s, o) => s + (o.inventory || 0), 0)
  const totalBrokerInventory = brokerOffers.reduce((s, o) => s + (o.inventory || 0), 0)
  const totalTrustedAvailableInventory = trustedOffers
    .filter(o => o.inventory > 0)
    .reduce((s, o) => s + o.inventory, 0)
  const totalBrokerAvailableInventory = brokerOffers
    .filter(o => o.inventory > 0)
    .reduce((s, o) => s + o.inventory, 0)

  // ── Price metrics: tiered Available + reference Quoted + market-floor Any ─
  const bestAvailableOffer = pickBestTrustedAvailable(trustedOffers)
  const bestQuotedTrustedOffer = pickBestQuoted(trustedOffers)
  const bestAnyOffer = pickBestQuoted(allOffers)

  const bestTrustedAvailableUnitPrice = bestAvailableOffer?.unitPrice ?? null
  const bestTrustedAvailableDistributor = bestAvailableOffer?.distributor ?? null
  const bestTrustedAvailableInventory = bestAvailableOffer ? bestAvailableOffer.inventory : null
  const bestTrustedAvailableQtyBasis = bestAvailableOffer?.unitPriceQty ?? null

  const bestTrustedQuotedUnitPrice = bestQuotedTrustedOffer?.unitPrice ?? null
  const bestTrustedQuotedDistributor = bestQuotedTrustedOffer?.distributor ?? null
  const bestTrustedQuotedInventory = bestQuotedTrustedOffer ? bestQuotedTrustedOffer.inventory : null
  const bestTrustedQuotedQtyBasis = bestQuotedTrustedOffer?.unitPriceQty ?? null

  // Backward-compatible alias: prefer Available, fall back to Quoted.
  const bestTrustedUnitPrice = bestTrustedAvailableUnitPrice ?? bestTrustedQuotedUnitPrice

  const bestAnyUnitPrice = bestAnyOffer?.unitPrice ?? null

  // ── Warnings ────────────────────────────────────────────────────────────────
  const warnings: string[] = []
  if (bestQuotedTrustedOffer?.quantityBasisWarning) {
    warnings.push('best_trusted_quote_requires_high_moq')
  }
  if (bestQuotedTrustedOffer && bestQuotedTrustedOffer.inventory <= 0) {
    warnings.push('best_trusted_quote_zero_inventory')
  }
  if (bestAnyOffer && bestAnyOffer.distributorTier === 'marketplace_or_broker') {
    warnings.push('best_any_price_from_broker')
  }
  if (brokerOffers.length > 0) {
    warnings.push('broker_inventory_excluded_from_core_signal')
  }

  // Distinct trusted distributors using canonical names so DigiKey Cut Tape /
  // Tape & Reel / Custom Reel collapse to one bucket.
  const seen = new Set<string>()
  const trustedDistributors: string[] = []
  for (const o of trustedOffers) {
    const canon = canonicalDistributorName(o.distributor)
    if (canon && !seen.has(canon)) {
      seen.add(canon)
      trustedDistributors.push(canon)
    }
  }

  return {
    configured: true,
    status: 'ok',
    source: 'octopart_nexar',
    requestedMpn,
    matchedMpn,
    manufacturer,
    description,
    fetchedAt,
    sellerCount: sellers.length,
    offerCount: allOffers.length,
    trustedOfferCount: trustedOffers.length,
    brokerOfferCount: brokerOffers.length,
    totalTrustedInventory,
    totalBrokerInventory,
    totalTrustedAvailableInventory,
    totalBrokerAvailableInventory,
    bestTrustedAvailableUnitPrice,
    bestTrustedAvailableDistributor,
    bestTrustedAvailableInventory,
    bestTrustedAvailableQtyBasis,
    bestTrustedQuotedUnitPrice,
    bestTrustedQuotedDistributor,
    bestTrustedQuotedInventory,
    bestTrustedQuotedQtyBasis,
    bestTrustedUnitPrice,
    bestAnyUnitPrice,
    trustedDistributors,
    allOffers,
    warnings,
  }
}

// Helper to keep no_match / not_configured / error responses in sync with the
// expanded NexarNormalized shape.
function emptyNormalized(opts: {
  status: NexarNormalized['status']
  requestedMpn: string
  fetchedAt?: string
  configured?: boolean
  message?: string
}): NexarNormalized {
  return {
    configured: opts.configured ?? true,
    status: opts.status,
    source: 'octopart_nexar',
    requestedMpn: opts.requestedMpn,
    matchedMpn: null,
    manufacturer: null,
    description: null,
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
    sellerCount: 0,
    offerCount: 0,
    trustedOfferCount: 0,
    brokerOfferCount: 0,
    totalTrustedInventory: 0,
    totalBrokerInventory: 0,
    totalTrustedAvailableInventory: 0,
    totalBrokerAvailableInventory: 0,
    bestTrustedAvailableUnitPrice: null,
    bestTrustedAvailableDistributor: null,
    bestTrustedAvailableInventory: null,
    bestTrustedAvailableQtyBasis: null,
    bestTrustedQuotedUnitPrice: null,
    bestTrustedQuotedDistributor: null,
    bestTrustedQuotedInventory: null,
    bestTrustedQuotedQtyBasis: null,
    bestTrustedUnitPrice: null,
    bestAnyUnitPrice: null,
    trustedDistributors: [],
    allOffers: [],
    warnings: [],
    ...(opts.message != null ? { message: opts.message } : {}),
  }
}

export function notConfiguredResponse(requestedMpn: string): NexarNormalized {
  return emptyNormalized({
    status: 'not_configured',
    requestedMpn,
    configured: false,
    message: 'Set NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET to enable.',
  })
}

export function errorResponse(requestedMpn: string, sanitizedMessage: string): NexarNormalized {
  return emptyNormalized({
    status: 'error',
    requestedMpn,
    configured: true,
    message: sanitizedMessage,
  })
}
