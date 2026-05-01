// ── Phase 20C.2 — TI part-signal merger ─────────────────────────────────────
// Combines the Product Information API (metadata, lifecycle, lead time) and
// the Store Inventory & Pricing API (live quantity, pricing, future supply)
// into a single dashboard-ready record per part number, plus a small set of
// derived signal flags so the UI doesn't have to re-implement the same
// thresholds on the client.
//
// Hard rules:
//   - DO NOT call any other TI endpoint from here.
//   - DO NOT return the OAuth token, client id, client secret, or any
//     Authorization header to the caller.
//   - DO NOT swallow individual sub-call failures: if one side fails, the
//     other side's data is still returned, with sourceConfidence reduced and
//     the failed side carrying a sanitized status.

import {
  fetchTiProductInfo,
  fetchTiInventoryPricing,
  type TiEnv,
  type TiProductInfo,
  type TiInventoryPricing,
} from './tiDirect'

export type PartSignalSupplyStatus =
  | 'in_stock'
  | 'limited'
  | 'out_of_stock'
  | 'pending_approval'
  | 'unknown'

export type PartSignalInventoryFlag = 'healthy' | 'thin' | 'critical' | 'out' | 'unknown'
export type PartSignalPricingFlag = 'available' | 'unavailable' | 'pending_approval' | 'unknown'
export type PartSignalLeadTimeFlag = 'normal' | 'extended' | 'critical' | 'unknown'
export type PartSignalSourceConfidence = 'high' | 'medium' | 'low' | 'none'

export type TiPartSignal = {
  /** Caller's input — preserved verbatim. */
  requestedPartNumber: string
  /** What the Product Info adapter actually queried (post GPN→OPN fallback). */
  resolvedPartNumber: string | null
  genericPartNumber: string | null
  description: string | null
  lifecycleStatus: string | null
  package: string | null
  datasheetUrl: string | null
  leadTimeWeeks: number | null
  inventoryStatus: string | null
  okayToOrder: boolean | null
  /** Live store-side quantity. Null when Store API hasn't returned a numeric. */
  quantityAvailable: number | null
  pricing: Array<{ breakQuantity: number; unitPrice: number; currency: string }> | null
  /** Top-of-quote currency, derived from the first pricing break. */
  currency: string | null
  orderLimit: number | null
  futureInventory: Array<{ forecastDate: string; forecastQuantity: number }> | null
  forecastDate: string | null
  forecastQuantity: number | null
  /** TI store deep-link — public, no secret. */
  buyNowUrl: string | null
  signals: {
    supplyStatus: PartSignalSupplyStatus
    inventorySignal: PartSignalInventoryFlag
    pricingSignal: PartSignalPricingFlag
    leadTimeSignal: PartSignalLeadTimeFlag
    sourceConfidence: PartSignalSourceConfidence
  }
  sources: {
    productInfo: {
      label: 'Texas Instruments Product Information API'
      status: TiProductInfo['status']
    }
    inventoryPricing: {
      label: 'Texas Instruments Store Inventory & Pricing API'
      status: TiInventoryPricing['status']
    }
  }
  warnings: string[]
  fetchedAt: string
}

const TI_STORE_PRODUCT_URL = 'https://www.ti.com/product/'

function classifyInventory(qty: number | null): PartSignalInventoryFlag {
  if (qty == null || !Number.isFinite(qty)) return 'unknown'
  if (qty <= 0) return 'out'
  if (qty < 100) return 'critical'
  if (qty < 1000) return 'thin'
  return 'healthy'
}

function classifyLeadTime(weeks: number | null): PartSignalLeadTimeFlag {
  if (weeks == null || !Number.isFinite(weeks)) return 'unknown'
  if (weeks <= 8) return 'normal'
  if (weeks <= 16) return 'extended'
  return 'critical'
}

function classifySupplyStatus(
  qty: number | null,
  invStatus: TiInventoryPricing['status'],
): PartSignalSupplyStatus {
  if (invStatus === 'pending_approval') return 'pending_approval'
  if (invStatus !== 'ok') return 'unknown'
  if (qty == null) return 'unknown'
  if (qty <= 0) return 'out_of_stock'
  if (qty < 100) return 'limited'
  return 'in_stock'
}

function classifyPricing(
  pricing: TiInventoryPricing['pricing'],
  invStatus: TiInventoryPricing['status'],
): PartSignalPricingFlag {
  if (invStatus === 'pending_approval') return 'pending_approval'
  if (invStatus !== 'ok') return 'unknown'
  return Array.isArray(pricing) && pricing.length > 0 ? 'available' : 'unavailable'
}

function classifySourceConfidence(
  productStatus: TiProductInfo['status'],
  invStatus: TiInventoryPricing['status'],
): PartSignalSourceConfidence {
  const productOk = productStatus === 'ok'
  const invOk = invStatus === 'ok'
  if (productOk && invOk) return 'high'
  if (productOk && invStatus === 'pending_approval') return 'medium'
  if (productOk) return 'medium'
  if (invOk) return 'medium'
  if (productStatus === 'not_configured' && invStatus === 'not_configured') return 'none'
  return 'low'
}

export async function fetchTiPartSignal(env: TiEnv, partNumber: string): Promise<TiPartSignal> {
  const requested = (partNumber || '').trim()
  // Run both fetches in parallel — Product Info and Inventory & Pricing are
  // independent and we want the whole signal in roughly one round-trip's time.
  const [productInfo, inventoryPricing] = await Promise.all([
    fetchTiProductInfo(env, requested),
    fetchTiInventoryPricing(env, requested),
  ])
  const resolvedPartNumber = productInfo.resolvedPartNumber ?? null
  const buyNowKey = (resolvedPartNumber || requested || '').trim()
  const buyNowUrl = buyNowKey ? TI_STORE_PRODUCT_URL + encodeURIComponent(buyNowKey) : null

  const pricing = inventoryPricing.pricing
  const currency = Array.isArray(pricing) && pricing.length > 0 && typeof pricing[0]?.currency === 'string'
    ? pricing[0].currency
    : (inventoryPricing.status === 'ok' ? 'USD' : null)

  const warnings: string[] = []
  if (productInfo.warnings && productInfo.warnings.length > 0) {
    for (const w of productInfo.warnings) warnings.push(`product:${w}`)
  }
  if (inventoryPricing.warnings && inventoryPricing.warnings.length > 0) {
    for (const w of inventoryPricing.warnings) warnings.push(`inventory:${w}`)
  }

  return {
    requestedPartNumber: requested,
    resolvedPartNumber,
    genericPartNumber: productInfo.genericPartNumber,
    description: productInfo.description,
    lifecycleStatus: productInfo.lifecycleStatus,
    package: productInfo.package,
    datasheetUrl: productInfo.datasheetUrl,
    leadTimeWeeks: productInfo.leadTimeWeeks,
    inventoryStatus: productInfo.inventoryStatus,
    okayToOrder: productInfo.okayToOrder,
    quantityAvailable: inventoryPricing.quantity,
    pricing,
    currency,
    orderLimit: inventoryPricing.orderLimit,
    futureInventory: inventoryPricing.futureInventory,
    forecastDate: inventoryPricing.forecastDate,
    forecastQuantity: inventoryPricing.forecastQuantity,
    buyNowUrl,
    signals: {
      supplyStatus: classifySupplyStatus(inventoryPricing.quantity, inventoryPricing.status),
      inventorySignal: classifyInventory(inventoryPricing.quantity),
      pricingSignal: classifyPricing(inventoryPricing.pricing, inventoryPricing.status),
      leadTimeSignal: classifyLeadTime(productInfo.leadTimeWeeks),
      sourceConfidence: classifySourceConfidence(productInfo.status, inventoryPricing.status),
    },
    sources: {
      productInfo: {
        label: 'Texas Instruments Product Information API',
        status: productInfo.status,
      },
      inventoryPricing: {
        label: 'Texas Instruments Store Inventory & Pricing API',
        status: inventoryPricing.status,
      },
    },
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}

// ── Phase 20C.3 — public sanitized snapshot shape ───────────────────────────
// The customer-facing /api/ti/inventory/latest endpoint serves this shape.
// Strips internal warnings, raw quality/parametric blobs, datasheet URLs, and
// anything that could leak adapter internals or secrets. Pricing is kept as a
// boolean availability flag rather than the price-break array — pricing
// numbers are commercially sensitive and stay behind the auth-gated
// /api/ti/part-signal endpoint.

export type TiPartSignalPublic = {
  partNumber: string
  genericPartNumber: string | null
  description: string | null
  basket: string | null
  quantityAvailable: number | null
  pricingAvailability: 'available' | 'unavailable' | 'pending_approval' | 'unknown'
  orderLimit: number | null
  futureInventoryVisibility: {
    forecastCount: number
    nextForecastDate: string | null
    nextForecastQuantity: number | null
  }
  leadTimeWeeks: number | null
  lifecycleStatus: string | null
  okayToOrder: boolean | null
  signals: {
    supplyStatus: PartSignalSupplyStatus
    inventorySignal: PartSignalInventoryFlag
    pricingSignal: PartSignalPricingFlag
    leadTimeSignal: PartSignalLeadTimeFlag
    sourceConfidence: PartSignalSourceConfidence
  }
  fetchedAt: string
  sources: {
    productInfo: { label: string; status: TiProductInfo['status'] }
    inventoryPricing: { label: string; status: TiInventoryPricing['status'] }
  }
}

/** Build the public snapshot shape from the merged signal. `basket` is taken
 *  from a caller-supplied catalog hint (the watched-parts module) since the
 *  Product Information API does not return a basket label. */
export function toPublicPartSignal(
  signal: TiPartSignal,
  basket: string | null = null,
): TiPartSignalPublic {
  const futureRows = signal.futureInventory ?? []
  return {
    partNumber: signal.resolvedPartNumber ?? signal.requestedPartNumber,
    genericPartNumber: signal.genericPartNumber,
    description: signal.description,
    basket,
    quantityAvailable: signal.quantityAvailable,
    pricingAvailability: signal.signals.pricingSignal,
    orderLimit: signal.orderLimit,
    futureInventoryVisibility: {
      forecastCount: futureRows.length,
      nextForecastDate: signal.forecastDate,
      nextForecastQuantity: signal.forecastQuantity,
    },
    leadTimeWeeks: signal.leadTimeWeeks,
    lifecycleStatus: signal.lifecycleStatus,
    okayToOrder: signal.okayToOrder,
    signals: signal.signals,
    fetchedAt: signal.fetchedAt,
    sources: signal.sources,
  }
}

// ── KV inventory snapshot ───────────────────────────────────────────────────

export type InventorySnapshotKV = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

const INVENTORY_LATEST_KEY = 'source-snapshots/texas_instruments/ti_direct_inventory/store_inventory_pricing/latest'

export type InventorySnapshotEntry = {
  capturedAt: string
  parts: TiPartSignalPublic[]
}

export async function readLatestInventorySnapshot(
  kv: InventorySnapshotKV,
): Promise<InventorySnapshotEntry | null> {
  const raw = await kv.get(INVENTORY_LATEST_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.parts)) return null
    return parsed as InventorySnapshotEntry
  } catch {
    return null
  }
}

export async function writeLatestInventorySnapshot(
  kv: InventorySnapshotKV,
  entry: InventorySnapshotEntry,
): Promise<void> {
  await kv.put(INVENTORY_LATEST_KEY, JSON.stringify(entry))
}

/** Captures the customer-facing demo set: a small list of OPNs (currently
 *  just AFE7799IABJ per Phase 20C.3 spec). Each part is fetched through the
 *  authenticated part-signal merger, sanitized into the public shape, and
 *  the bundle is written to KV under a single "latest" key. The capture
 *  result is also returned so the operator endpoint can echo the outcome. */
export async function capturePublicInventorySnapshot(
  env: TiEnv,
  kv: InventorySnapshotKV,
  parts: Array<{ partNumber: string; basket: string | null }>,
): Promise<InventorySnapshotEntry> {
  const collected: TiPartSignalPublic[] = []
  for (const p of parts) {
    const signal = await fetchTiPartSignal(env, p.partNumber)
    collected.push(toPublicPartSignal(signal, p.basket))
  }
  const entry: InventorySnapshotEntry = {
    capturedAt: new Date().toISOString(),
    parts: collected,
  }
  await writeLatestInventorySnapshot(kv, entry)
  return entry
}
