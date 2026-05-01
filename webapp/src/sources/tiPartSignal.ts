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

export type WatchedPartCaptureStatus = 'ok' | 'partial' | 'failed' | 'pending_approval'

export type TiPartSignalPublic = {
  partNumber: string
  genericPartNumber: string | null
  description: string | null
  basket: string | null
  /** Phase 20D — investor-facing fields propagated from the watched-parts catalog. */
  displayName?: string | null
  thesisReason?: string | null
  demandProxyType?: string | null
  dashboardPriority?: 'high' | 'medium' | 'low' | null
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
  /** Phase 20D — per-row capture outcome. `ok` = both APIs returned; `partial`
   *  = one side ok, the other not; `failed` = both failed; `pending_approval`
   *  = Store API not yet enabled for this deployment. */
  captureStatus: WatchedPartCaptureStatus
  /** Phase 20D — sanitized per-row warnings, prefixed by sub-source. Never
   *  contains tokens, secrets, or raw response bodies. */
  captureWarnings: string[]
  fetchedAt: string
  sources: {
    productInfo: { label: string; status: TiProductInfo['status'] }
    inventoryPricing: { label: string; status: TiInventoryPricing['status'] }
  }
}

export type WatchedPartCatalogHint = {
  basket: string | null
  displayName?: string | null
  thesisReason?: string | null
  demandProxyType?: string | null
  dashboardPriority?: 'high' | 'medium' | 'low' | null
  /** When the watched-parts catalog has a generic part number for this entry,
   *  surface it on the public row even if Product Info itself didn't return
   *  one. This makes generic-part filtering robust. */
  genericPartNumberHint?: string | null
}

function classifyCaptureStatus(signal: TiPartSignal): WatchedPartCaptureStatus {
  const productOk = signal.sources.productInfo.status === 'ok'
  const invOk = signal.sources.inventoryPricing.status === 'ok'
  const invPending = signal.sources.inventoryPricing.status === 'pending_approval'
  if (productOk && invOk) return 'ok'
  if (productOk && invPending) return 'pending_approval'
  if (productOk || invOk) return 'partial'
  return 'failed'
}

/** Build the public snapshot shape from the merged signal. `basket` and the
 *  optional investor-thesis fields are taken from the caller-supplied catalog
 *  hint (the watched-parts module) since the TI Product Information API does
 *  not return any basket / thesis / priority metadata. */
export function toPublicPartSignal(
  signal: TiPartSignal,
  hint: WatchedPartCatalogHint | string | null = null,
): TiPartSignalPublic {
  const futureRows = signal.futureInventory ?? []
  const h: WatchedPartCatalogHint = typeof hint === 'string' || hint === null
    ? { basket: hint as string | null }
    : hint
  return {
    partNumber: signal.resolvedPartNumber ?? signal.requestedPartNumber,
    genericPartNumber: signal.genericPartNumber ?? h.genericPartNumberHint ?? null,
    description: signal.description,
    basket: h.basket ?? null,
    displayName: h.displayName ?? null,
    thesisReason: h.thesisReason ?? null,
    demandProxyType: h.demandProxyType ?? null,
    dashboardPriority: h.dashboardPriority ?? null,
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
    captureStatus: classifyCaptureStatus(signal),
    captureWarnings: signal.warnings ?? [],
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

export type WatchedPartCaptureInput = {
  partNumber: string
} & WatchedPartCatalogHint

/** Captures the customer-facing watched-parts universe (Phase 20D). Each
 *  part is fetched through the authenticated part-signal merger, sanitized
 *  into the public shape, and the bundle is written to KV under a single
 *  "latest" key. Per-row failures never abort the run — every input
 *  contributes a row carrying its captureStatus and warnings. */
export async function capturePublicInventorySnapshot(
  env: TiEnv,
  kv: InventorySnapshotKV,
  parts: WatchedPartCaptureInput[],
): Promise<InventorySnapshotEntry> {
  const collected: TiPartSignalPublic[] = []
  // Sequential fetch keeps us comfortably under TI's per-app rate budget.
  // The watched universe is currently 32 parts; a small inter-call gap also
  // gives the OAuth token cache time to settle on retries.
  const INTER_CALL_DELAY_MS = 100
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && INTER_CALL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS))
    }
    const p = parts[i]
    let publicRow: TiPartSignalPublic
    try {
      const signal = await fetchTiPartSignal(env, p.partNumber)
      publicRow = toPublicPartSignal(signal, p)
    } catch (e: any) {
      // Defensive — fetchTiPartSignal already returns sanitized failures
      // on its own, so this branch should be rare. Convert anything thrown
      // into a synthetic failed row so the snapshot stays uniform.
      const message = typeof e?.message === 'string' ? e.message : 'capture exception'
      publicRow = {
        partNumber: p.partNumber,
        genericPartNumber: p.genericPartNumberHint ?? null,
        description: null,
        basket: p.basket ?? null,
        displayName: p.displayName ?? null,
        thesisReason: p.thesisReason ?? null,
        demandProxyType: p.demandProxyType ?? null,
        dashboardPriority: p.dashboardPriority ?? null,
        quantityAvailable: null,
        pricingAvailability: 'unknown',
        orderLimit: null,
        futureInventoryVisibility: { forecastCount: 0, nextForecastDate: null, nextForecastQuantity: null },
        leadTimeWeeks: null,
        lifecycleStatus: null,
        okayToOrder: null,
        signals: {
          supplyStatus: 'unknown',
          inventorySignal: 'unknown',
          pricingSignal: 'unknown',
          leadTimeSignal: 'unknown',
          sourceConfidence: 'none',
        },
        captureStatus: 'failed',
        captureWarnings: [`exception:${message.slice(0, 120)}`],
        fetchedAt: new Date().toISOString(),
        sources: {
          productInfo: { label: 'Texas Instruments Product Information API', status: 'error' },
          inventoryPricing: { label: 'Texas Instruments Store Inventory & Pricing API', status: 'error' },
        },
      }
    }
    collected.push(publicRow)
  }
  const entry: InventorySnapshotEntry = {
    capturedAt: new Date().toISOString(),
    parts: collected,
  }
  await writeLatestInventorySnapshot(kv, entry)
  return entry
}

// ── Phase 20D — public snapshot summary ─────────────────────────────────────

export type InventorySnapshotSummary = {
  totalParts: number
  capturedParts: number
  failedParts: number
  inStockParts: number
  outOfStockParts: number
  activeParts: number
  medianLeadTimeWeeks: number | null
  longestLeadTimePart: { partNumber: string; leadTimeWeeks: number } | null
  basketsCovered: number
  latestFetchedAt: string | null
}

const ACTIVE_LIFECYCLE_LITERALS = new Set(['ACTIVE', 'PRODUCTION', 'PRODUCT', 'AVAILABLE'])
function isActiveLifecycle(lc: string | null | undefined): boolean {
  if (!lc) return false
  const u = String(lc).trim().toUpperCase()
  if (ACTIVE_LIFECYCLE_LITERALS.has(u)) return true
  return u.startsWith('ACTIVE')
}

function median(numbers: number[]): number | null {
  if (!numbers || numbers.length === 0) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
  }
  return sorted[mid]
}

export function summarizeInventorySnapshot(
  parts: TiPartSignalPublic[],
  totalWatched?: number,
): InventorySnapshotSummary {
  const totalParts = typeof totalWatched === 'number' ? totalWatched : parts.length
  let capturedParts = 0
  let failedParts = 0
  let inStockParts = 0
  let outOfStockParts = 0
  let activeParts = 0
  const leadTimes: number[] = []
  let longest: { partNumber: string; leadTimeWeeks: number } | null = null
  const baskets = new Set<string>()
  let latestFetchedAt: string | null = null
  for (const p of parts) {
    if (p.captureStatus === 'failed') failedParts += 1
    else capturedParts += 1
    if (p.signals?.supplyStatus === 'in_stock') inStockParts += 1
    if (p.signals?.supplyStatus === 'out_of_stock') outOfStockParts += 1
    if (isActiveLifecycle(p.lifecycleStatus)) activeParts += 1
    if (typeof p.leadTimeWeeks === 'number' && Number.isFinite(p.leadTimeWeeks)) {
      leadTimes.push(p.leadTimeWeeks)
      if (!longest || p.leadTimeWeeks > longest.leadTimeWeeks) {
        longest = { partNumber: p.partNumber, leadTimeWeeks: p.leadTimeWeeks }
      }
    }
    if (p.basket) baskets.add(p.basket)
    if (p.fetchedAt && (!latestFetchedAt || p.fetchedAt > latestFetchedAt)) {
      latestFetchedAt = p.fetchedAt
    }
  }
  return {
    totalParts,
    capturedParts,
    failedParts,
    inStockParts,
    outOfStockParts,
    activeParts,
    medianLeadTimeWeeks: median(leadTimes),
    longestLeadTimePart: longest,
    basketsCovered: baskets.size,
    latestFetchedAt,
  }
}
