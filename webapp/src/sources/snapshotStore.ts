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
// Phase 16A: keys are now parameterized by (source, mode). The Nexar
// representative basket lives at:
//     source-snapshots/texas_instruments/octopart_nexar/representative_basket_preview/YYYY-MM-DD
// The Mouser full-category backbone lives at:
//     source-snapshots/texas_instruments/mouser_direct/full_mouser_category_snapshot/YYYY-MM-DD

const KEY_PREFIX = 'source-snapshots/texas_instruments/'
const PRIMARY_SOURCE = 'octopart_nexar'
const PRIMARY_MODE = 'representative_basket_preview'

export const MOUSER_SOURCE = 'mouser_direct'
export const MOUSER_MODE = 'full_mouser_category_snapshot'

export function snapshotKey(date: string): string {
  return snapshotKeyFor(PRIMARY_SOURCE, PRIMARY_MODE, date)
}

export function snapshotPrefix(): string {
  return snapshotPrefixFor(PRIMARY_SOURCE, PRIMARY_MODE)
}

export function snapshotKeyFor(source: string, mode: string, date: string): string {
  return `${KEY_PREFIX}${source}/${mode}/${date}`
}

export function snapshotPrefixFor(source: string, mode: string): string {
  return `${KEY_PREFIX}${source}/${mode}/`
}

export function mouserSnapshotKey(date: string): string {
  return snapshotKeyFor(MOUSER_SOURCE, MOUSER_MODE, date)
}

/** UTC date in YYYY-MM-DD form. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Generic read helpers (Phase 16A) ────────────────────────────────────────

export async function listSnapshotDatesFor(
  kv: SnapshotKV,
  source: string,
  mode: string,
): Promise<string[]> {
  const prefix = snapshotPrefixFor(source, mode)
  const all: string[] = []
  let cursor: string | undefined = undefined
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

export async function getSnapshotFor(
  kv: SnapshotKV,
  source: string,
  mode: string,
  date: string,
): Promise<Snapshot | null> {
  const raw = await kv.get(snapshotKeyFor(source, mode, date))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Snapshot
  } catch {
    return null
  }
}

export async function getLatestSnapshotFor(
  kv: SnapshotKV,
  source: string,
  mode: string,
): Promise<Snapshot | null> {
  const dates = await listSnapshotDatesFor(kv, source, mode)
  if (dates.length === 0) return null
  return getSnapshotFor(kv, source, mode, dates[dates.length - 1])
}

export async function getRecentSnapshotsFor(
  kv: SnapshotKV,
  source: string,
  mode: string,
  days: number,
): Promise<Snapshot[]> {
  const dates = await listSnapshotDatesFor(kv, source, mode)
  if (dates.length === 0) return []
  const cutoffMs = Date.now() - days * 86_400_000
  const cutoffStr = new Date(cutoffMs).toISOString().slice(0, 10)
  const wanted = dates.filter(d => d >= cutoffStr)
  const settled = await Promise.allSettled(wanted.map(d => getSnapshotFor(kv, source, mode, d)))
  const out: Snapshot[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) out.push(r.value)
  }
  return out
}

// ── Nexar-specific compatibility wrappers ───────────────────────────────────
// Existing callers use these — they delegate to the generic helpers with the
// Nexar source/mode pair. Kept named the same for backward compatibility.

export async function listSnapshotDates(kv: SnapshotKV): Promise<string[]> {
  return listSnapshotDatesFor(kv, PRIMARY_SOURCE, PRIMARY_MODE)
}

export async function getSnapshot(kv: SnapshotKV, date: string): Promise<Snapshot | null> {
  return getSnapshotFor(kv, PRIMARY_SOURCE, PRIMARY_MODE, date)
}

export async function getLatestSnapshot(kv: SnapshotKV): Promise<Snapshot | null> {
  return getLatestSnapshotFor(kv, PRIMARY_SOURCE, PRIMARY_MODE)
}

export async function getRecentSnapshots(kv: SnapshotKV, days: number): Promise<Snapshot[]> {
  return getRecentSnapshotsFor(kv, PRIMARY_SOURCE, PRIMARY_MODE, days)
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
    canonicalCategoryId: cat.canonicalCategoryId,
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

/**
 * Anchor primaries that failed in the most recent stored snapshot. Used by
 * capture to enable fallback substitution under the rotating sampling policy
 * — never to add Nexar calls beyond the maxCalls cap.
 */
export async function getRecentlyFailedAnchorMpns(kv: SnapshotKV | undefined): Promise<string[]> {
  if (!kv) return []
  const latest = await getLatestSnapshot(kv)
  if (!latest) return []
  const anchorIds = new Set(
    PHASE_8_BASKET_PREVIEW
      .filter(c => c.categoryRole === 'anchor')
      .map(c => c.categoryId),
  )
  const failed: string[] = []
  for (const cat of latest.categories) {
    if (!anchorIds.has(cat.categoryId)) continue
    for (const sku of cat.skus) {
      if (sku.status === 'error' || sku.status === 'no_match') failed.push(sku.mpn)
    }
  }
  return failed
}

export async function captureRepresentativeBasketSnapshot(opts: {
  clientId: string
  clientSecret: string
  /** Optional: when provided, capture reads the latest snapshot to detect anchor
   *  failures so the rotation policy can substitute a fallback for that slot. */
  kv?: SnapshotKV
  /** Optional override for snapshotDate (UTC YYYY-MM-DD); defaults to today. */
  snapshotDate?: string
}): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString()
  const snapshotDate = opts.snapshotDate ?? todayUtc()

  // Quota-safe SKU selection: anchor continuity + UTC-day rotation. Catalog can
  // grow without changing the cap; rotation cycles through the unsampled
  // categories so they build observed history over time. The unsampled
  // overflow is recorded in snapshot.metadata for visibility.
  const recentlyFailedMpns = await getRecentlyFailedAnchorMpns(opts.kv)
  const sampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    snapshotDate,
    policy: 'anchor_plus_rotation',
    recentlyFailedMpns,
  })
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
  // Phase 15B — store the full sampling plan (with rotation metadata and
  // forward-looking nextRotationPreview) so historical snapshots remember
  // exactly which subset was sampled and what was planned next.
  const coverage = summarizeSampling(sampling, {
    catalog: PHASE_8_BASKET_PREVIEW,
    previewDays: 7,
  })
  const snapshot: Snapshot = {
    snapshotDate,
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
      // Phase 15A/15B — coverage + rotation metadata. Optional fields; older
      // snapshots that pre-date these keys ignore safely.
      samplingPolicy: sampling.policy,
      rotationIndex: sampling.rotationIndex,
      estimatedFullCycleDays: sampling.estimatedFullCycleDays,
      ...coverage,
    } as any,
  }

  return { snapshot, callsUsed }
}
