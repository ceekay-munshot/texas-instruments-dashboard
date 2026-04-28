// ── Mouser daily snapshot capture (Phase 16A) ────────────────────────────────
// Builds a normalized Snapshot from the existing 28-category Mouser PART_MAP.
// This is the **free full backbone**: no paid quota, no Nexar calls, just a
// daily Mouser-direct point-in-time read so the dashboard has full taxonomy
// coverage without depending on quota-limited corroboration.
//
// We deliberately do NOT call /api/prices via HTTP — we share the same Mouser
// API surface but query it directly with a richer parser that captures
// inventory and lead time alongside qty=1 USD price.

import { PART_MAP, type MouserCatalogEntry } from '../data/mouserCatalog'
import { canonicalCategoryId } from '../data/tiTaxonomy'
import {
  SNAPSHOT_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotCategory,
  type SnapshotSku,
  type SnapshotSourceObservation,
} from '../data/snapshotSchema'

const INR_TO_USD = 1 / 83.5
// Mouser-direct request pacing — same shape as /api/prices but a slightly
// gentler concurrency since the snapshot path runs once per day, not on user
// hover. It does NOT short-circuit early on rate limits — partial coverage is
// acceptable in a snapshot (fewer-than-28 categories is recorded as warnings).
const CONCURRENCY = 3
const PER_BATCH_DELAY_MS = 400
const RETRY_DELAY_MS = 2500
const RETRY_MAX_FAILURES = 4

const MOUSER_SOURCE = 'mouser_direct'
const MOUSER_DISTRIBUTOR = 'Mouser'
const MOUSER_MODE = 'full_mouser_category_snapshot'

export type MouserPartReadout = {
  status: 'ok' | 'no_match' | 'rate_limited' | 'error'
  matchedMpn: string | null
  unitPriceUsd: number | null
  currency: string | null
  availabilityInStock: number | null
  availabilityText: string | null
  leadTimeDays: number | null
  message?: string
}

// Parse "1234 In Stock" / "Out of Stock" / "Factory Special Order" → number | null
function parseAvailabilityCount(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null
  const m = text.match(/(\d[\d,]*)/)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// Parse "26 Weeks" / "Stock" / "Inquire" → days | null
function parseLeadTimeDays(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null
  const lower = text.trim().toLowerCase()
  if (lower === '' || lower === 'inquire' || lower === 'n/a') return null
  if (lower.startsWith('stock')) return 0
  const wkMatch = lower.match(/(\d+)\s*week/)
  if (wkMatch) return parseInt(wkMatch[1], 10) * 7
  const dayMatch = lower.match(/(\d+)\s*day/)
  if (dayMatch) return parseInt(dayMatch[1], 10)
  return null
}

/** Fetch a single MPN from Mouser. Returns price + inventory + lead time. */
export async function fetchMouserPartForSnapshot(
  apiKey: string,
  partNumber: string,
): Promise<MouserPartReadout> {
  try {
    const res = await fetch(
      `https://api.mouser.com/api/v1/search/partnumber?apiKey=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SearchByPartRequest: {
            mouserPartNumber: partNumber,
            partSearchOptions: 'Exact',
          },
        }),
      },
    )

    if (res.status === 429 || res.status === 403) {
      return {
        status: 'rate_limited',
        matchedMpn: null,
        unitPriceUsd: null,
        currency: null,
        availabilityInStock: null,
        availabilityText: null,
        leadTimeDays: null,
        message: `HTTP ${res.status}`,
      }
    }

    const data: any = await res.json()
    const parts = (data?.SearchResults?.Parts || []) as any[]
    const withPrice = parts.filter((p: any) => p.PriceBreaks?.length > 0)

    if (!withPrice.length) {
      // Mouser sometimes returns 200 with a rate-limit error and no parts.
      const err = data?.Errors?.[0]
      const code = (err?.Code || err?.ErrorCode || '').toLowerCase()
      const msg = (err?.Message || '').toLowerCase()
      if (
        code.includes('toomany') ||
        msg.includes('rate') ||
        msg.includes('limit') ||
        msg.includes('throttl')
      ) {
        return {
          status: 'rate_limited',
          matchedMpn: null,
          unitPriceUsd: null,
          currency: null,
          availabilityInStock: null,
          availabilityText: null,
          leadTimeDays: null,
          message: err?.Message?.slice(0, 200),
        }
      }
      return {
        status: 'no_match',
        matchedMpn: null,
        unitPriceUsd: null,
        currency: null,
        availabilityInStock: null,
        availabilityText: null,
        leadTimeDays: null,
      }
    }

    // Prefer the part whose minimum order qty <= 10 (real qty=1 break).
    const unitParts = withPrice.filter((p: any) => parseInt(p.Min || '9999') <= 10)
    const target = unitParts.length > 0 ? unitParts[0] : withPrice[0]
    const breaks = [...target.PriceBreaks].sort(
      (a: any, b: any) => a.Quantity - b.Quantity,
    )
    const pb = breaks.find((b: any) => b.Quantity <= 10) || breaks[0]
    const numStr = String(pb.Price ?? '').replace(/[^0-9.]/g, '')
    let unitPrice = parseFloat(numStr)
    if (!isFinite(unitPrice) || unitPrice <= 0) {
      return {
        status: 'no_match',
        matchedMpn: target.ManufacturerPartNumber || partNumber,
        unitPriceUsd: null,
        currency: pb.Currency || null,
        availabilityInStock: parseAvailabilityCount(target.Availability),
        availabilityText: target.Availability ?? null,
        leadTimeDays: parseLeadTimeDays(target.LeadTime),
      }
    }
    if (pb.Currency === 'INR') unitPrice *= INR_TO_USD
    if (unitPrice > 200) {
      // Reel/kit outlier — same guard as /api/prices.
      return {
        status: 'no_match',
        matchedMpn: target.ManufacturerPartNumber || partNumber,
        unitPriceUsd: null,
        currency: pb.Currency || null,
        availabilityInStock: parseAvailabilityCount(target.Availability),
        availabilityText: target.Availability ?? null,
        leadTimeDays: parseLeadTimeDays(target.LeadTime),
        message: 'unit_price_above_outlier_threshold',
      }
    }

    const explicitInStock =
      typeof target.AvailabilityInStock === 'number'
        ? target.AvailabilityInStock
        : typeof target.AvailabilityInStock === 'string'
          ? parseInt(target.AvailabilityInStock, 10)
          : null

    return {
      status: 'ok',
      matchedMpn: target.ManufacturerPartNumber || partNumber,
      unitPriceUsd: Math.round(unitPrice * 10000) / 10000,
      currency: 'USD',
      availabilityInStock:
        Number.isFinite(explicitInStock as number)
          ? (explicitInStock as number)
          : parseAvailabilityCount(target.Availability),
      availabilityText: target.Availability ?? null,
      leadTimeDays: parseLeadTimeDays(target.LeadTime),
    }
  } catch (e: any) {
    return {
      status: 'error',
      matchedMpn: null,
      unitPriceUsd: null,
      currency: null,
      availabilityInStock: null,
      availabilityText: null,
      leadTimeDays: null,
      message: String(e?.message || 'unknown error').slice(0, 200),
    }
  }
}

// Try primary then fallback, like fetchCategory in /api/prices.
async function fetchCategoryForSnapshot(
  apiKey: string,
  catId: string,
  catData: MouserCatalogEntry,
): Promise<{
  catId: string
  picked: MouserPartReadout
  triedMpns: string[]
  rateLimited: boolean
}> {
  const triedMpns: string[] = []
  let rateLimited = false
  for (const partNum of catData.parts) {
    triedMpns.push(partNum)
    const r = await fetchMouserPartForSnapshot(apiKey, partNum)
    if (r.status === 'ok') return { catId, picked: r, triedMpns, rateLimited }
    if (r.status === 'rate_limited') {
      rateLimited = true
      // Don't keep hitting the API after a rate-limit signal — we'll record it.
      return { catId, picked: r, triedMpns, rateLimited: true }
    }
    // 'no_match' or 'error' — fall through to fallback MPN.
  }
  // Nothing worked; return the last result (which is no_match/error) and the
  // tried list so the snapshot records both attempts.
  const last: MouserPartReadout = {
    status: 'no_match',
    matchedMpn: null,
    unitPriceUsd: null,
    currency: null,
    availabilityInStock: null,
    availabilityText: null,
    leadTimeDays: null,
  }
  return { catId, picked: last, triedMpns, rateLimited }
}

// ── Snapshot builder ────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

function buildSourceObservations(
  readout: MouserPartReadout,
  observedAt: string,
): SnapshotSourceObservation[] {
  if (readout.status !== 'ok' || readout.unitPriceUsd == null) return []
  return [
    {
      source: MOUSER_SOURCE,
      distributor: MOUSER_DISTRIBUTOR,
      unitPrice: readout.unitPriceUsd,
      availableInventory:
        typeof readout.availabilityInStock === 'number'
          ? readout.availabilityInStock
          : null,
      leadTimeDays: readout.leadTimeDays,
      currency: readout.currency,
      observedAt,
      confidence: 'authorized_or_core',
    },
  ]
}

function buildSkuRecord(
  requestedMpn: string,
  readout: MouserPartReadout,
  observedAt: string,
): SnapshotSku {
  const inventory =
    typeof readout.availabilityInStock === 'number'
      ? readout.availabilityInStock
      : 0
  const warnings: string[] = []
  if (readout.status === 'rate_limited') warnings.push('mouser_rate_limited')
  if (readout.status === 'error') warnings.push('mouser_fetch_error')
  if (readout.status === 'no_match') warnings.push('mouser_no_match')
  if (readout.message) warnings.push(`mouser_message:${readout.message.slice(0, 80)}`)
  return {
    mpn: requestedMpn,
    representativeReason: undefined,
    importanceTier: 'primary',
    status: readout.status,
    bestTrustedAvailableUnitPrice:
      readout.status === 'ok' && (readout.availabilityInStock ?? 0) > 0
        ? readout.unitPriceUsd
        : null,
    bestTrustedAvailableDistributor:
      readout.status === 'ok' && (readout.availabilityInStock ?? 0) > 0
        ? MOUSER_DISTRIBUTOR
        : null,
    bestTrustedAvailableInventory:
      readout.status === 'ok' && (readout.availabilityInStock ?? 0) > 0
        ? readout.availabilityInStock
        : null,
    bestTrustedQuotedUnitPrice: readout.status === 'ok' ? readout.unitPriceUsd : null,
    bestAnyUnitPrice: readout.status === 'ok' ? readout.unitPriceUsd : null,
    totalTrustedAvailableInventory: inventory > 0 ? inventory : 0,
    totalBrokerAvailableInventory: 0,
    trustedDistributors:
      readout.status === 'ok' ? [MOUSER_DISTRIBUTOR] : [],
    sourceObservations: buildSourceObservations(readout, observedAt),
    warnings,
  }
}

function aggregateCategory(
  catId: string,
  catLabel: string,
  skus: SnapshotSku[],
): SnapshotCategory {
  const availablePrices = skus
    .map(s => s.bestTrustedAvailableUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
  const quotedPrices = skus
    .map(s => s.bestTrustedQuotedUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)

  const sortedAvail = availablePrices.slice().sort((a, b) => a - b)
  const sortedQuoted = quotedPrices.slice().sort((a, b) => a - b)
  const med = (xs: number[]): number | null =>
    xs.length === 0
      ? null
      : xs.length % 2
        ? xs[(xs.length - 1) / 2]
        : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2

  let avg: number | null = null
  let median: number | null = null
  let usedQuotedFallback = false
  if (sortedAvail.length > 0) {
    avg = round4(sortedAvail.reduce((s, v) => s + v, 0) / sortedAvail.length)
    median = round4(med(sortedAvail) as number)
  } else if (sortedQuoted.length > 0) {
    avg = round4(sortedQuoted.reduce((s, v) => s + v, 0) / sortedQuoted.length)
    median = round4(med(sortedQuoted) as number)
    usedQuotedFallback = true
  }

  const totalTrustedInventory = skus.reduce(
    (s, x) => s + (x.totalTrustedAvailableInventory || 0),
    0,
  )
  const warnings: string[] = []
  if (usedQuotedFallback) warnings.push('category_average_uses_quoted_fallback')
  if (skus.every(s => s.status !== 'ok')) warnings.push('mouser_no_priced_skus_in_category')

  return {
    categoryId: catId,
    canonicalCategoryId: canonicalCategoryId(catId),
    categoryLabel: catLabel,
    representativeSkuCount: skus.length,
    quotedSkuCount: availablePrices.length,
    avgBestTrustedAvailableUnitPrice: avg,
    medianBestTrustedAvailableUnitPrice: median,
    totalTrustedAvailableInventory: totalTrustedInventory,
    totalBrokerAvailableInventory: 0,
    trustedDistributorCoverage: skus.some(s => s.status === 'ok')
      ? [MOUSER_DISTRIBUTOR]
      : [],
    sampleCoverage: 'full_mouser_backbone',
    warnings,
    skus,
  }
}

export type MouserCaptureResult = {
  snapshot: Snapshot
  callsUsed: number
  okCategoryCount: number
  rateLimitedCategoryCount: number
  errorCategoryCount: number
}

/** Build a full Mouser snapshot for the 28-category taxonomy.
 *
 * Fetches each category's primary MPN; falls back to the secondary MPN if the
 * primary returns no_match or error. Stops trying further MPNs in a category
 * after a rate_limited result. Aggregates per category, builds a Snapshot.
 *
 * Does NOT use Nexar quota. Does NOT call /api/prices. Does NOT modify the
 * existing /api/prices behavior.
 */
export async function captureMouserSnapshot(opts: {
  apiKey: string
  snapshotDate: string
}): Promise<MouserCaptureResult> {
  const capturedAt = new Date().toISOString()
  const entries: Array<[string, MouserCatalogEntry]> = Object.entries(PART_MAP)

  const perCat: Record<string, MouserPartReadout> = {}
  const triedByCat: Record<string, string[]> = {}
  let callsUsed = 0
  const failed: Array<[string, MouserCatalogEntry]> = []

  // Pass 1 — parallel batches.
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      batch.map(([catId, catData]) =>
        fetchCategoryForSnapshot(opts.apiKey, catId, catData),
      ),
    )
    for (const r of settled) {
      callsUsed += r.triedMpns.length
      perCat[r.catId] = r.picked
      triedByCat[r.catId] = r.triedMpns
      if (r.picked.status !== 'ok') {
        failed.push([r.catId, PART_MAP[r.catId]])
      }
    }
    if (i + CONCURRENCY < entries.length) {
      await new Promise(r => setTimeout(r, PER_BATCH_DELAY_MS))
    }
  }

  // Pass 2 — bounded retry only when a small number failed (transient rate limit).
  if (failed.length > 0 && failed.length <= RETRY_MAX_FAILURES) {
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    const retrying = failed.splice(0, failed.length)
    const settled = await Promise.all(
      retrying.map(([catId, catData]) =>
        fetchCategoryForSnapshot(opts.apiKey, catId, catData),
      ),
    )
    for (const r of settled) {
      callsUsed += r.triedMpns.length
      if (r.picked.status === 'ok') {
        perCat[r.catId] = r.picked
        triedByCat[r.catId] = r.triedMpns
      }
    }
  }

  // Build category snapshots.
  const categories: SnapshotCategory[] = []
  let okCount = 0
  let rateLimitedCount = 0
  let errorCount = 0
  for (const [catId, catData] of entries) {
    const tried = triedByCat[catId] ?? catData.parts
    const readout = perCat[catId]
    // Each tried MPN gets a SKU record so the snapshot reflects what was tried.
    // The "winning" readout (if any) populates price/inventory; other tried
    // MPNs are recorded as no_match so trends and evidence have full lineage.
    const skus: SnapshotSku[] = []
    for (let i = 0; i < tried.length; i++) {
      const mpn = tried[i]
      // The first MPN that yielded the winning readout owns the readout fields.
      const useReadout =
        readout && (readout.matchedMpn === mpn || (i === 0 && readout.status !== 'ok'))
      skus.push(
        buildSkuRecord(
          mpn,
          useReadout
            ? readout
            : {
                status: 'no_match',
                matchedMpn: null,
                unitPriceUsd: null,
                currency: null,
                availabilityInStock: null,
                availabilityText: null,
                leadTimeDays: null,
              },
          capturedAt,
        ),
      )
    }
    const cat = aggregateCategory(catId, catData.label, skus)
    categories.push(cat)
    if (readout?.status === 'ok') okCount++
    else if (readout?.status === 'rate_limited') rateLimitedCount++
    else errorCount++
  }

  const skuCount = categories.reduce((s, c) => s + c.skus.length, 0)
  const snapshot: Snapshot = {
    snapshotDate: opts.snapshotDate,
    capturedAt,
    dashboard: 'texas_instruments',
    source: MOUSER_SOURCE,
    mode: MOUSER_MODE,
    categoryCount: categories.length,
    skuCount,
    callsUsed,
    maxCalls: callsUsed, // Mouser is the free backbone — no quota cap to print
    categories,
    metadata: {
      cacheTtlHours: 24,
      quotaNote:
        'Mouser is the free full backbone — no paid quota required. Run as often as Mouser permits.',
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      sourceRole: 'free_full_backbone',
      noPaidQuotaRequired: true,
      taxonomyVersion: '1.0.0',
      canonicalSubcategoryCount: 28,
      okCategoryCount: okCount,
      rateLimitedCategoryCount: rateLimitedCount,
      errorCategoryCount: errorCount,
    } as any,
  }

  return {
    snapshot,
    callsUsed,
    okCategoryCount: okCount,
    rateLimitedCategoryCount: rateLimitedCount,
    errorCategoryCount: errorCount,
  }
}
