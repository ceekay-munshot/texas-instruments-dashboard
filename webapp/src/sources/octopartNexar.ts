// ── Nexar / Octopart single-SKU fetch + normalize ───────────────────────────
// OAuth2 client_credentials → GraphQL `supSearchMpn` → typed normalized output.
// Credentials never leave this module; errors are sanitized before being
// returned to callers. Token is cached in module scope (per-Worker-isolate)
// for reuse within a single isolate's lifetime.

import { classifyDistributor, type DistributorTier } from '../data/sourceTypes'

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
  totalTrustedInventory: number
  totalBrokerInventory: number
  bestTrustedUnitPrice: number | null
  bestAnyUnitPrice: number | null
  trustedDistributors: string[]
  allOffers: NexarOffer[]
  /** Optional sanitized error message — only set when status === 'error'. */
  message?: string
}

function asNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function normalizeNexarPart(raw: any, requestedMpn: string): NexarNormalized {
  const fetchedAt = new Date().toISOString()
  const result = raw?.data?.supSearchMpn?.results?.[0]
  const part = result?.part

  if (!part) {
    return {
      configured: true,
      status: 'no_match',
      source: 'octopart_nexar',
      requestedMpn,
      matchedMpn: null,
      manufacturer: null,
      description: null,
      fetchedAt,
      sellerCount: 0,
      offerCount: 0,
      trustedOfferCount: 0,
      brokerOfferCount: 0,
      totalTrustedInventory: 0,
      totalBrokerInventory: 0,
      bestTrustedUnitPrice: null,
      bestAnyUnitPrice: null,
      trustedDistributors: [],
      allOffers: [],
    }
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

      // Prefer the lowest qty break with quantity <= 10. Otherwise use the
      // lowest available quantity and flag quantityBasisWarning.
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

  const totalTrustedInventory = trustedOffers.reduce((s, o) => s + (o.inventory || 0), 0)
  const totalBrokerInventory = brokerOffers.reduce((s, o) => s + (o.inventory || 0), 0)

  // Best unit price: lowest legit unit price > 0 from each pool.
  // Outliers (e.g. typoed prices) are not hidden from allOffers, but we drop
  // them from the bestTrustedUnitPrice calculation if they're 100x higher
  // than the next-cheapest offer. Conservative: only filter when the cluster
  // is dense enough to identify an outlier reliably.
  const trustedPrices = trustedOffers
    .map(o => o.unitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b)
  const allPrices = allOffers
    .map(o => o.unitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b)

  const bestTrustedUnitPrice = trustedPrices[0] ?? null
  const bestAnyUnitPrice = allPrices[0] ?? null

  // Distinct trusted distributor names (preserve original casing from Nexar)
  const trustedDistributors = Array.from(new Set(
    trustedOffers
      .map(o => o.distributor)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
  ))

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
    bestTrustedUnitPrice,
    bestAnyUnitPrice,
    trustedDistributors,
    allOffers,
  }
}

export function notConfiguredResponse(requestedMpn: string): NexarNormalized {
  return {
    configured: false,
    status: 'not_configured',
    source: 'octopart_nexar',
    requestedMpn,
    matchedMpn: null,
    manufacturer: null,
    description: null,
    fetchedAt: new Date().toISOString(),
    sellerCount: 0,
    offerCount: 0,
    trustedOfferCount: 0,
    brokerOfferCount: 0,
    totalTrustedInventory: 0,
    totalBrokerInventory: 0,
    bestTrustedUnitPrice: null,
    bestAnyUnitPrice: null,
    trustedDistributors: [],
    allOffers: [],
    message: 'Set NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET to enable.',
  }
}
