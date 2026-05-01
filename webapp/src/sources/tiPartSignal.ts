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
  /** Phase 20D.1 — sub-source diagnostics propagated from the underlying
   *  adapters. Contains only sanitized codes and HTTP status numbers — never
   *  raw response bodies, headers, or token-bearing fields. */
  sourceDiagnostics: {
    productInfo: { httpStatus: number | null; sanitizedCode: string | null }
    inventoryPricing: { httpStatus: number | null; sanitizedCode: string | null }
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
    sourceDiagnostics: {
      productInfo: {
        httpStatus: productInfo.diagnostics?.httpStatus ?? null,
        sanitizedCode: productInfo.diagnostics?.sanitizedCode ?? null,
      },
      inventoryPricing: {
        httpStatus: inventoryPricing.diagnostics?.httpStatus ?? null,
        sanitizedCode: inventoryPricing.diagnostics?.sanitizedCode ?? null,
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
export type CaptureFailureStage =
  | 'product_info'
  | 'inventory_pricing'
  | 'worker_limit'
  | 'unknown'
  | null

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
  /** Phase 20D — provenance of the displayed values: the captureStatus from
   *  the capture that produced these field values. When a refresh fails but
   *  we kept the prior good values, this stays at the prior 'ok' / 'partial'
   *  while latestCaptureStatus flips to 'failed'. */
  captureStatus: WatchedPartCaptureStatus
  /** Phase 20D.1 — outcome of the most recent capture attempt for this row.
   *  Equals captureStatus when the row is fresh; differs when the row is
   *  stale (latest attempt failed but prior good values are kept). */
  latestCaptureStatus: WatchedPartCaptureStatus
  /** Phase 20D.1 — true when the displayed numeric values are from a prior
   *  successful capture and the most recent attempt failed. */
  stale: boolean
  /** Phase 20D.1 — when the displayed values were observed; equal to
   *  fetchedAt for fresh rows, older than fetchedAt for stale rows. */
  lastGoodFetchedAt: string | null
  /** Phase 20D — sanitized per-row warnings, prefixed by sub-source. Never
   *  contains tokens, secrets, or raw response bodies. */
  captureWarnings: string[]
  /** Phase 20D.1 — sanitized per-row failure diagnostics. Populated only
   *  when the most recent attempt did not succeed. */
  failureStage: CaptureFailureStage
  httpStatus: number | null
  warningCode: string | null
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

function classifyFailureStage(signal: TiPartSignal): CaptureFailureStage {
  const ps = signal.sources.productInfo.status
  const is = signal.sources.inventoryPricing.status
  if (ps !== 'ok') return 'product_info'
  if (is !== 'ok' && is !== 'pending_approval') return 'inventory_pricing'
  return null
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
  const captureStatus = classifyCaptureStatus(signal)
  const failureStage = classifyFailureStage(signal)
  // Surface only the most relevant sub-source's HTTP status / sanitized code,
  // never any raw body or token-bearing field.
  let httpStatus: number | null = null
  let warningCode: string | null = null
  if (failureStage === 'product_info') {
    httpStatus = signal.sourceDiagnostics?.productInfo.httpStatus ?? null
    warningCode = signal.sourceDiagnostics?.productInfo.sanitizedCode ?? null
  } else if (failureStage === 'inventory_pricing') {
    httpStatus = signal.sourceDiagnostics?.inventoryPricing.httpStatus ?? null
    warningCode = signal.sourceDiagnostics?.inventoryPricing.sanitizedCode ?? null
  }
  const fetchedAt = signal.fetchedAt
  const lastGoodFetchedAt = captureStatus === 'failed' ? null : fetchedAt
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
    captureStatus,
    latestCaptureStatus: captureStatus,
    stale: false,
    lastGoodFetchedAt,
    captureWarnings: signal.warnings ?? [],
    failureStage,
    httpStatus,
    warningCode,
    fetchedAt,
    sources: signal.sources,
  }
}

/** Phase 20D.1 — when a fresh capture for `key` failed but a prior successful
 *  row exists, return a public row that keeps the prior numeric values and
 *  marks the row as stale. The latest-attempt diagnostics from `freshFailure`
 *  are surfaced so the UI can show why the refresh failed. */
function buildStaleRowFromPriorGood(
  prior: TiPartSignalPublic,
  freshFailure: TiPartSignalPublic,
  attemptedAt: string,
): TiPartSignalPublic {
  return {
    ...prior,
    captureStatus: prior.captureStatus, // provenance of displayed values
    latestCaptureStatus: 'failed',
    stale: true,
    lastGoodFetchedAt: prior.fetchedAt,
    fetchedAt: attemptedAt,
    failureStage: freshFailure.failureStage ?? 'unknown',
    httpStatus: freshFailure.httpStatus,
    warningCode: freshFailure.warningCode,
    captureWarnings: freshFailure.captureWarnings,
    sources: freshFailure.sources,
  }
}

function buildExceptionRow(
  input: WatchedPartCaptureInput,
  message: string,
  attemptedAt: string,
): TiPartSignalPublic {
  return {
    partNumber: input.partNumber,
    genericPartNumber: input.genericPartNumberHint ?? null,
    description: null,
    basket: input.basket ?? null,
    displayName: input.displayName ?? null,
    thesisReason: input.thesisReason ?? null,
    demandProxyType: input.demandProxyType ?? null,
    dashboardPriority: input.dashboardPriority ?? null,
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
    latestCaptureStatus: 'failed',
    stale: false,
    lastGoodFetchedAt: null,
    captureWarnings: [`exception:${message.slice(0, 120)}`],
    failureStage: 'worker_limit',
    httpStatus: null,
    warningCode: 'exception',
    fetchedAt: attemptedAt,
    sources: {
      productInfo: { label: 'Texas Instruments Product Information API', status: 'error' },
      inventoryPricing: { label: 'Texas Instruments Store Inventory & Pricing API', status: 'error' },
    },
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

export type CaptureBatchResult = {
  totalParts: number
  attemptedThisBatch: number
  capturedThisBatch: number
  failedThisBatch: number
  staleThisBatch: number
  offset: number
  limit: number
  nextOffset: number | null
  done: boolean
  capturedAt: string
}

/** Phase 20D.1 — capture a batch of watched parts and merge the result with
 *  any prior snapshot. Worker subrequest budgets cap a single invocation at
 *  ~50–100 calls; with 4 subrequests per part-signal merger this batches the
 *  32-part universe into 4×8 chunks. Per-row failures never abort the batch.
 *  When a fresh capture fails for a row we already have good data for, the
 *  prior values are preserved and the row is marked stale. */
export async function captureWatchedPartsBatch(
  env: TiEnv,
  kv: InventorySnapshotKV,
  allParts: WatchedPartCaptureInput[],
  offset: number,
  limit: number,
): Promise<CaptureBatchResult> {
  const totalParts = allParts.length
  const safeOffset = Math.max(0, Math.min(offset | 0, totalParts))
  const safeLimit = Math.max(1, Math.min(limit | 0 || 8, 32))
  const slice = allParts.slice(safeOffset, safeOffset + safeLimit)

  // Read prior snapshot and index it by partNumber for the merge step.
  const prior = await readLatestInventorySnapshot(kv)
  const priorByPartNumber = new Map<string, TiPartSignalPublic>()
  if (prior?.parts) {
    for (const p of prior.parts) {
      if (p.partNumber) priorByPartNumber.set(p.partNumber.toUpperCase(), p)
    }
  }

  // Inter-call gap: small enough to stay snappy, large enough to give the
  // shared OAuth token cache and TI's per-app rate budget some breathing room.
  const INTER_CALL_DELAY_MS = 60
  const attemptedAt = new Date().toISOString()
  const newRows = new Map<string, TiPartSignalPublic>()
  let capturedThisBatch = 0
  let failedThisBatch = 0
  let staleThisBatch = 0
  for (let i = 0; i < slice.length; i++) {
    if (i > 0 && INTER_CALL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS))
    }
    const input = slice[i]
    let publicRow: TiPartSignalPublic
    try {
      const signal = await fetchTiPartSignal(env, input.partNumber)
      publicRow = toPublicPartSignal(signal, input)
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : 'capture exception'
      publicRow = buildExceptionRow(input, message, attemptedAt)
    }
    // Merge with prior good values when the fresh attempt failed but a prior
    // captureStatus !== 'failed' row exists for the same part number.
    const key = (input.partNumber || '').toUpperCase()
    if (publicRow.latestCaptureStatus === 'failed') {
      const priorRow = priorByPartNumber.get(key)
      if (priorRow && priorRow.captureStatus !== 'failed' && !priorRow.stale) {
        publicRow = buildStaleRowFromPriorGood(priorRow, publicRow, attemptedAt)
        staleThisBatch += 1
      } else if (priorRow && priorRow.captureStatus !== 'failed' && priorRow.stale) {
        // Preserve the original good values; just refresh the latest-attempt
        // diagnostics. lastGoodFetchedAt remains anchored to the original good
        // capture so customers still see how old the displayed values are.
        publicRow = buildStaleRowFromPriorGood(
          { ...priorRow, fetchedAt: priorRow.lastGoodFetchedAt ?? priorRow.fetchedAt },
          publicRow,
          attemptedAt,
        )
        staleThisBatch += 1
      }
      failedThisBatch += 1
    } else {
      capturedThisBatch += 1
    }
    newRows.set(key, publicRow)
  }

  // Compose the merged snapshot: every prior row stays unless a new capture
  // for the same partNumber is in this batch (in which case the new row wins).
  const merged: TiPartSignalPublic[] = []
  // Walk allParts so the row order matches the watched universe order, even
  // when a prior capture used a different ordering.
  for (const p of allParts) {
    const key = (p.partNumber || '').toUpperCase()
    if (newRows.has(key)) {
      merged.push(newRows.get(key)!)
    } else if (priorByPartNumber.has(key)) {
      merged.push(priorByPartNumber.get(key)!)
    }
  }
  // Carry over any prior rows whose part numbers aren't in the current
  // watched-parts list — defensive, normally empty.
  for (const [key, row] of priorByPartNumber.entries()) {
    if (!merged.some(m => (m.partNumber || '').toUpperCase() === key)
        && !newRows.has(key)
        && !allParts.some(p => (p.partNumber || '').toUpperCase() === key)) {
      merged.push(row)
    }
  }

  const entry: InventorySnapshotEntry = {
    capturedAt: attemptedAt,
    parts: merged,
  }
  await writeLatestInventorySnapshot(kv, entry)

  const nextOffset = safeOffset + slice.length
  const done = nextOffset >= totalParts
  return {
    totalParts,
    attemptedThisBatch: slice.length,
    capturedThisBatch,
    failedThisBatch,
    staleThisBatch,
    offset: safeOffset,
    limit: safeLimit,
    nextOffset: done ? null : nextOffset,
    done,
    capturedAt: attemptedAt,
  }
}

/** Phase 20D.1 — orchestrate sequential batches inside a single Worker
 *  invocation. Worker subrequest budgets vary by plan, so this caps the
 *  number of internal batches to keep a wide margin. Returns cumulative
 *  progress and the final summary. The frontend can also call the single
 *  batched endpoint repeatedly if the platform refuses the larger run. */
export async function captureAllWatchedPartsInternal(
  env: TiEnv,
  kv: InventorySnapshotKV,
  allParts: WatchedPartCaptureInput[],
  opts: { batchLimit?: number; maxBatches?: number } = {},
): Promise<{
  batches: CaptureBatchResult[]
  done: boolean
  nextOffset: number | null
  totalParts: number
  capturedAt: string
}> {
  const batchLimit = Math.max(1, Math.min(opts.batchLimit ?? 8, 16))
  const maxBatches = Math.max(1, opts.maxBatches ?? 4)
  const batches: CaptureBatchResult[] = []
  let offset = 0
  let lastResult: CaptureBatchResult | null = null
  for (let b = 0; b < maxBatches; b++) {
    if (offset >= allParts.length) break
    let result: CaptureBatchResult
    try {
      result = await captureWatchedPartsBatch(env, kv, allParts, offset, batchLimit)
    } catch (e: any) {
      // Treat any thrown error here as a worker-limit signal and stop early
      // so the operator UI can pick up where we left off via explicit batches.
      // Return what we have rather than crashing the whole call.
      break
    }
    batches.push(result)
    lastResult = result
    if (result.done || result.nextOffset == null) break
    offset = result.nextOffset
  }
  const totalParts = allParts.length
  const done = lastResult?.done ?? false
  return {
    batches,
    done,
    nextOffset: lastResult?.nextOffset ?? offset,
    totalParts,
    capturedAt: lastResult?.capturedAt ?? new Date().toISOString(),
  }
}

// ── Phase 20D — public snapshot summary ─────────────────────────────────────

export type InventorySnapshotSummary = {
  totalParts: number
  capturedParts: number
  failedParts: number
  /** Phase 20D.1 — rows where the latest attempt failed but the displayed
   *  values come from a prior successful capture. */
  staleParts: number
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
  let staleParts = 0
  let inStockParts = 0
  let outOfStockParts = 0
  let activeParts = 0
  const leadTimes: number[] = []
  let longest: { partNumber: string; leadTimeWeeks: number } | null = null
  const baskets = new Set<string>()
  let latestFetchedAt: string | null = null
  for (const p of parts) {
    // failedParts now reflects the LATEST attempt (Phase 20D.1). A stale row
    // with latestCaptureStatus='failed' counts as failed even though it
    // displays prior good values, which matches what the operator should
    // act on.
    const latest = p.latestCaptureStatus ?? p.captureStatus
    if (latest === 'failed') failedParts += 1
    else capturedParts += 1
    if (p.stale) staleParts += 1
    if (p.signals?.supplyStatus === 'in_stock') inStockParts += 1
    if (p.signals?.supplyStatus === 'out_of_stock') outOfStockParts += 1
    if (isActiveLifecycle(p.lifecycleStatus)) activeParts += 1
    // Lead-time aggregates use the displayed values, so stale rows still
    // contribute their last known good lead time.
    if (typeof p.leadTimeWeeks === 'number' && Number.isFinite(p.leadTimeWeeks)) {
      leadTimes.push(p.leadTimeWeeks)
      if (!longest || p.leadTimeWeeks > longest.leadTimeWeeks) {
        longest = { partNumber: p.partNumber, leadTimeWeeks: p.leadTimeWeeks }
      }
    }
    if (p.basket) baskets.add(p.basket)
    const observed = p.lastGoodFetchedAt ?? p.fetchedAt
    if (observed && (!latestFetchedAt || observed > latestFetchedAt)) {
      latestFetchedAt = observed
    }
  }
  return {
    totalParts,
    capturedParts,
    failedParts,
    staleParts,
    inStockParts,
    outOfStockParts,
    activeParts,
    medianLeadTimeWeeks: median(leadTimes),
    longestLeadTimePart: longest,
    basketsCovered: baskets.size,
    latestFetchedAt,
  }
}
