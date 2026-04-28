// ── Snapshot store: KV reads + capture builder ──────────────────────────────
// All KV operations go through this module so the rest of the codebase can
// stay agnostic to the binding. Capture is intentionally separate from the
// basket-preview cache: a daily snapshot must be a fresh point-in-time
// observation, not a 24h-cached aggregate.

import {
  fetchNexarPart,
  normalizeNexarPart,
  type NexarNormalized,
  type NexarOffer,
} from './octopartNexar'
import { canonicalDistributorName } from '../data/sourceTypes'
import {
  PHASE_8_BASKET_PREVIEW,
  BASKET_PREVIEW_MAX_CALLS,
  BASKET_PREVIEW_QUOTA_NOTE,
  selectSampledSkus,
  summarizeSampling,
  type BasketCategory,
  type BasketSku,
} from '../data/tiBasket'
import {
  SNAPSHOT_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotCategory,
  type SnapshotSku,
  type SnapshotSourceObservation,
} from '../data/snapshotSchema'

// Minimal KV interface — matches Cloudflare KVNamespace surface we use.
export type SnapshotKV = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  list(opts: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>
    list_complete?: boolean
    cursor?: string
  }>
}

// ── Key utilities ───────────────────────────────────────────────────────────

const KEY_PREFIX = 'source-snapshots/texas_instruments/'
const PRIMARY_SOURCE = 'octopart_nexar'
const PRIMARY_MODE = 'representative_basket_preview'

export function snapshotKey(date: string): string {
  return `${KEY_PREFIX}${PRIMARY_SOURCE}/${PRIMARY_MODE}/${date}`
}

export function snapshotPrefix(): string {
  return `${KEY_PREFIX}${PRIMARY_SOURCE}/${PRIMARY_MODE}/`
}

/** UTC date in YYYY-MM-DD form. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Read helpers ────────────────────────────────────────────────────────────

export async function listSnapshotDates(kv: SnapshotKV): Promise<string[]> {
  const prefix = snapshotPrefix()
  const all: string[] = []
  let cursor: string | undefined = undefined
  // Defensive paging cap; we'll never legitimately exceed a few hundred keys.
  for (let i = 0; i < 10; i++) {
    const page = await kv.list({ prefix, cursor })
    for (const k of page.keys) {
      const date = k.name.slice(prefix.length)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) all.push(date)
    }
    if (page.list_complete || !page.cursor) break
    cursor = page.cursor
  }
  return all.sort()
}

export async function getSnapshot(kv: SnapshotKV, date: string): Promise<Snapshot | null> {
  const raw = await kv.get(snapshotKey(date))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Snapshot
  } catch {
    return null
  }
}

export async function getLatestSnapshot(kv: SnapshotKV): Promise<Snapshot | null> {
  const dates = await listSnapshotDates(kv)
  if (dates.length === 0) return null
  const latest = dates[dates.length - 1]
  return getSnapshot(kv, latest)
}

export async function getRecentSnapshots(
  kv: SnapshotKV,
  days: number,
): Promise<Snapshot[]> {
  const dates = await listSnapshotDates(kv)
  if (dates.length === 0) return []
  const cutoffMs = Date.now() - days * 86_400_000
  const cutoffStr = new Date(cutoffMs).toISOString().slice(0, 10)
  const wanted = dates.filter(d => d >= cutoffStr)
  const settled = await Promise.allSettled(wanted.map(d => getSnapshot(kv, d)))
  const out: Snapshot[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) out.push(r.value)
  }
  return out
}

// ── Capture builder ─────────────────────────────────────────────────────────
// Mirrors the basket-preview aggregation but keeps per-distributor offers so
// we can record `sourceObservations[]`. Fresh fetches only — never reads the
// basket-preview cache.

export type CaptureResult = {
  snapshot: Snapshot
  callsUsed: number
}

function buildSourceObservations(
  norm: NexarNormalized,
  observedAt: string,
): SnapshotSourceObservation[] {
  if (!norm.allOffers || norm.allOffers.length === 0) return []
  return norm.allOffers.map((o: NexarOffer) => ({
    source: PRIMARY_SOURCE,
    distributor: o.distributor,
    unitPrice: o.unitPrice,
    availableInventory: typeof o.inventory === 'number' ? o.inventory : null,
    leadTimeDays: null, // not exposed in current Nexar query — null until added
    currency: o.currency,
    observedAt,
    confidence: o.distributorTier,
  }))
}

function aggregateMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}

function buildSkuRecord(
  sku: BasketSku,
  norm: NexarNormalized,
  observedAt: string,
): SnapshotSku {
  return {
    mpn: sku.mpn,
    representativeReason: sku.representativeReason,
    importanceTier: sku.importanceTier,
    status: norm.status,
    bestTrustedAvailableUnitPrice: norm.bestTrustedAvailableUnitPrice,
    bestTrustedAvailableDistributor: norm.bestTrustedAvailableDistributor,
    bestTrustedAvailableInventory: norm.bestTrustedAvailableInventory,
    bestTrustedQuotedUnitPrice: norm.bestTrustedQuotedUnitPrice,
    bestAnyUnitPrice: norm.bestAnyUnitPrice,
    totalTrustedAvailableInventory: norm.totalTrustedAvailableInventory,
    totalBrokerAvailableInventory: norm.totalBrokerAvailableInventory,
    trustedDistributors: norm.trustedDistributors,
    sourceObservations: buildSourceObservations(norm, observedAt),
    warnings: norm.warnings,
  }
}

function aggregateCategory(
  cat: BasketCategory,
  skuRecords: SnapshotSku[],
): SnapshotCategory {
  const availablePrices = skuRecords
    .map(s => s.bestTrustedAvailableUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
  const quotedPrices = skuRecords
    .map(s => s.bestTrustedQuotedUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)

  let avg: number | null = null
  let median: number | null = null
  let usedQuotedFallback = false
  if (availablePrices.length > 0) {
    avg = round4(availablePrices.reduce((s, v) => s + v, 0) / availablePrices.length)
    median = round4(aggregateMedian(availablePrices)!)
  } else if (quotedPrices.length > 0) {
    avg = round4(quotedPrices.reduce((s, v) => s + v, 0) / quotedPrices.length)
    median = round4(aggregateMedian(quotedPrices)!)
    usedQuotedFallback = true
  }

  const totalTrustedAvailableInventory = skuRecords.reduce(
    (s, x) => s + (x.totalTrustedAvailableInventory || 0),
    0,
  )
  const totalBrokerAvailableInventory = skuRecords.reduce(
    (s, x) => s + (x.totalBrokerAvailableInventory || 0),
    0,
  )

  const distSet = new Set<string>()
  for (const s of skuRecords) {
    for (const d of s.trustedDistributors) {
      const c = canonicalDistributorName(d)
      if (c) distSet.add(c)
    }
  }

  const warnings: string[] = []
  if (usedQuotedFallback) warnings.push('category_average_uses_quoted_fallback')
  if (availablePrices.length === 0 && quotedPrices.length === 0)
    warnings.push('no_priced_skus_in_category')
  if (skuRecords.some(s => s.status === 'error')) warnings.push('one_or_more_skus_failed_fetch')
  if (skuRecords.some(s => s.status === 'no_match'))
    warnings.push('one_or_more_skus_returned_no_match')

  return {
    categoryId: cat.categoryId,
    categoryLabel: cat.categoryLabel,
    representativeSkuCount: cat.skus.length,
    quotedSkuCount: availablePrices.length,
    avgBestTrustedAvailableUnitPrice: avg,
    medianBestTrustedAvailableUnitPrice: median,
    totalTrustedAvailableInventory,
    totalBrokerAvailableInventory,
    trustedDistributorCoverage: Array.from(distSet),
    sampleCoverage: 'limited',
    warnings,
    skus: skuRecords,
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export async function captureRepresentativeBasketSnapshot(opts: {
  clientId: string
  clientSecret: string
}): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString()

  // Quota-safe SKU selection: take the top-N from the basket catalog under the
  // existing maxCalls cap. Catalog can grow without changing the cap; the
  // unsampled overflow is recorded in snapshot.metadata for visibility.
  const sampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, BASKET_PREVIEW_MAX_CALLS)
  const allSkus = sampling.sampled // already capped at BASKET_PREVIEW_MAX_CALLS

  const settled = await Promise.allSettled(
    allSkus.map(({ sku }) =>
      fetchNexarPart({ clientId: opts.clientId, clientSecret: opts.clientSecret, mpn: sku.mpn }),
    ),
  )
  const callsUsed = settled.length

  const perSkuByCat: Record<string, SnapshotSku[]> = {}
  for (let i = 0; i < settled.length; i++) {
    const { category, sku } = allSkus[i]
    const r = settled[i]
    let norm: NexarNormalized
    if (r.status === 'fulfilled') {
      norm = normalizeNexarPart(r.value, sku.mpn)
    } else {
      norm = {
        configured: true,
        status: 'error',
        source: 'octopart_nexar',
        requestedMpn: sku.mpn,
        matchedMpn: null,
        manufacturer: null,
        description: null,
        fetchedAt: capturedAt,
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
        message: String((r.reason as any)?.message || 'unknown error').slice(0, 200),
      }
    }
    const skuRec = buildSkuRecord(sku, norm, capturedAt)
    ;(perSkuByCat[category.categoryId] ??= []).push(skuRec)
  }

  // Only categories that actually had at least one SKU sampled get aggregated.
  // Catalogued-but-unsampled categories live in snapshot.metadata.coverage.
  const sampledCatIds = new Set(allSkus.map(r => r.category.categoryId))
  const categories: SnapshotCategory[] = PHASE_8_BASKET_PREVIEW
    .filter(cat => sampledCatIds.has(cat.categoryId))
    .map(cat => aggregateCategory(cat, perSkuByCat[cat.categoryId] || []))

  const skuCount = categories.reduce((s, c) => s + c.skus.length, 0)
  const coverage = summarizeSampling(sampling)
  const snapshot: Snapshot = {
    snapshotDate: todayUtc(),
    capturedAt,
    dashboard: 'texas_instruments',
    source: PRIMARY_SOURCE,
    mode: PRIMARY_MODE,
    categoryCount: categories.length,
    skuCount,
    callsUsed,
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    categories,
    metadata: {
      cacheTtlHours: 24,
      quotaNote: BASKET_PREVIEW_QUOTA_NOTE,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      // Phase 15A — basket coverage (which SKUs were sampled vs unsampled).
      // Optional fields; consumers that don't know about them ignore safely.
      ...coverage,
    } as any,
  }

  return { snapshot, callsUsed }
}
