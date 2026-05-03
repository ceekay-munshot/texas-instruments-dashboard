import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fetchNexarPart, normalizeNexarPart, notConfiguredResponse, errorResponse } from './sources/octopartNexar'
import { TRUSTED_DISTRIBUTOR_LIST } from './data/sourceTypes'
import { PHASE_8_BASKET_PREVIEW, BASKET_PREVIEW_MAX_CALLS, BASKET_PREVIEW_QUOTA_NOTE, BASKET_STATUS, selectSampledSkus, summarizeSampling, previewRotation, type BasketCategory } from './data/tiBasket'
import {
  captureRepresentativeBasketSnapshot,
  getLatestSnapshot,
  getRecentSnapshots,
  listSnapshotDates,
  snapshotKey,
  todayUtc,
  MOUSER_SOURCE,
  MOUSER_MODE,
  mouserSnapshotKey,
  getLatestSnapshotFor,
  getRecentSnapshotsFor,
  listSnapshotDatesFor,
  type SnapshotKV,
} from './sources/snapshotStore'
import { computeTrends } from './sources/snapshotTrends'
import { deriveSnapshotEvidence } from './sources/snapshotEvidence'
import { SNAPSHOT_SCHEMA_VERSION, type Snapshot } from './data/snapshotSchema'
import {
  PART_MAP,
  BASELINES,
  BASELINE_DATE,
  BASELINE_PERIOD_LABEL,
  BASELINE_LABEL,
  BASELINE_DISPLAY,
  BASELINE_DESCRIPTION,
  BASELINE_ROLLOVER_POLICY,
  BASELINE_REVIEW_AFTER_DAYS,
} from './data/mouserCatalog'
import {
  TI_TAXONOMY,
  TI_TAXONOMY_FLAT,
  TI_TAXONOMY_GROUP_COUNT,
  TI_TAXONOMY_SUBCATEGORY_COUNT,
  TI_TAXONOMY_VERSION,
  canonicalCategoryId,
  summarizeTaxonomyCoverage,
} from './data/tiTaxonomy'
import { captureMouserSnapshot } from './sources/mouserSnapshotCapture'
import {
  ALLOWED_MANUAL_SOURCES,
  MANUAL_MODE,
  buildManualSnapshot,
  manualSnapshotKey,
  normalizeManualSourceInput,
  parseManualSourceParam,
  type ManualSource,
} from './sources/manualSnapshotImport'
import {
  checkDigiKeySandboxConfigured,
  probeDigiKeySandbox,
  DIGIKEY_PROBE_MAX_MPNS,
} from './sources/digikeySandbox'
import {
  checkTiConfigured,
  fetchTiToken,
  fetchTiProductInfo,
  fetchTiProductInfoDebug,
  fetchTiInventoryPricing,
  fetchTiInventoryPricingDebug,
  fetchTiCatalogProbe,
  tokenCacheSnapshot as tiTokenCacheSnapshot,
  tiAttemptedEndpoints,
} from './sources/tiDirect'
import {
  captureTiCatalogSnapshot,
  ingestCatalogChunk,
  rebuildGpnFromOpn,
  rebuildGpnEnrichment,
  clearLatestRollups,
  listSubcategoryPredicates,
  pendingSubcategoryPredicates,
  rebuildOneSubcategory,
  readRollupStatus,
  appendRollupHistory,
  readSnapshotCounts,
  readLatestSnapshotRun,
  insertSnapshotRunRow,
  computeRollupQuality,
} from './sources/tiCatalogIngest'
import type { SubcategoryPredicate } from './sources/tiCatalogMapping'
import {
  readQuotaStatus,
  preflightAndReserve,
  completeRun,
  repairRun,
  isAllowedCompleteStatus,
  MAX_ATTEMPTS_PER_24H,
  MIN_HOURS_BETWEEN_CATALOG_CALLS,
  SAFETY_BUFFER_MINUTES,
} from './sources/tiCatalogQuotaLedger'
import {
  fetchWatchedPartsProductInfo,
  TI_WATCHED_PARTS,
  summarizeWatchedBaskets,
  getWatchedPartsCaptureInputs,
  getValidatedWatchedParts,
  getStagedWatchedParts,
  WATCHED_BASKET_LABEL,
  WATCHED_PARTS_FALLBACK_SEED,
} from './sources/tiWatchedParts'
import {
  fetchTiPartSignal,
  readLatestInventorySnapshot,
  captureWatchedPartsBatch,
  captureAllWatchedPartsInternal,
  summarizeInventorySnapshot,
  buildCurrentOrderableSet,
  filterSnapshotByOrderableSet,
} from './sources/tiPartSignal'
import {
  type D1Database,
  type HistoryKV,
  appendInventoryHistory,
  toHistoryRow,
  readPartHistory,
  readUniverseHistoryByPart,
  computeWatchedSignals,
  computeInventoryPriceSignal,
  summarizeSignals,
  type HistoryRow,
  recomputeAndPersistSignals,
  getLatestSignalsFromD1,
  getInventoryHistorySummary,
} from './sources/tiInventoryHistory'

type Bindings = {
  MOUSER_API_KEY: string
  NEXAR_CLIENT_ID?: string
  NEXAR_CLIENT_SECRET?: string
  /** Shared secret for POST /api/snapshots/capture. */
  SNAPSHOT_CAPTURE_SECRET?: string
  /** Cloudflare KV binding for durable source-memory snapshots. */
  SOURCE_SNAPSHOTS_KV?: SnapshotKV
  /** Phase 19A — DigiKey sandbox app credentials. SANDBOX ONLY. */
  DIGIKEY_CLIENT_ID?: string
  DIGIKEY_CLIENT_SECRET?: string
  /** Must be exactly 'sandbox' to enable the adapter. Anything else is treated as unsupported. */
  DIGIKEY_ENV?: string
  /** Phase 20A — Texas Instruments direct API credentials.
   *  Product Information API suite is approved; Store API suite is pending. */
  TI_CLIENT_ID?: string
  TI_CLIENT_SECRET?: string
  /** Expected: 'production'. Anything else disables the adapter. */
  TI_API_ENV?: string
  /** Operator flag — flip to 'true' once TI Store API suite approval lands. */
  TI_STORE_API_ENABLED?: string
  /** Phase 21A — D1 history database binding. When unbound the runtime
   *  falls back to a per-day KV history tier so the dashboard still works
   *  end-to-end on a fresh deploy. */
  TI_INVENTORY_HISTORY_DB?: D1Database
  /** Phase 23C — optional R2 binding for full-catalog raw-snapshot
   *  archival. When unbound, /api/ti/universe/catalog/capture skips the
   *  R2 PUT, returns rawR2Key: null + a warning, and still populates the
   *  D1 latest tables. See wrangler.jsonc for the dashboard setup steps. */
  TI_CATALOG_SNAPSHOTS_R2?: R2Bucket
}

// Phase 23C — minimal R2Bucket type sufficient for the catalog-archive
// PUT we do here. The full Cloudflare R2 type is exported from
// @cloudflare/workers-types; we only need the put() / head() surface.
type R2Bucket = {
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  head(key: string): Promise<unknown>
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ── PART_MAP / BASELINES live in webapp/src/data/mouserCatalog.ts ────────────
// Both the live /api/prices row and the new Mouser daily-snapshot backbone
// (Phase 16A) read from the same constants there. Keeping that data in a
// dedicated module avoids duplicate sources of truth.

function getBaselineMeta() {
  const baselineMs = Date.parse(BASELINE_DATE)
  const ageDays = Number.isFinite(baselineMs)
    ? Math.max(0, Math.floor((Date.now() - baselineMs) / 86_400_000))
    : 0
  return {
    baselineDate: BASELINE_DATE,
    baselinePeriodLabel: BASELINE_PERIOD_LABEL,
    baselineLabel: BASELINE_LABEL,
    baselineDisplay: BASELINE_DISPLAY,
    baselineDescription: BASELINE_DESCRIPTION,
    baselineAgeDays: ageDays,
    baselineReviewAfterDays: BASELINE_REVIEW_AFTER_DAYS,
    baselineIsStale: ageDays > BASELINE_REVIEW_AFTER_DAYS,
    baselineRolloverPolicy: BASELINE_ROLLOVER_POLICY,
    comparisonMode: 'live_spot_vs_latest_baseline' as const,
  }
}

const INR_TO_USD = 1 / 83.5
const CONCURRENCY = 3              // halved from 6 — keeps peak QPS under Mouser's burst threshold
const PER_BATCH_DELAY = 400        // doubled from 200ms — wider inter-batch gap
const RETRY_DELAY_MS = 2500        // wait this long after pass 1 before re-fetching the few that failed
const RETRY_MAX_FAILURES = 4       // skip retry if more than this many failed (likely true global rate-limit; let frontend auto-retry instead)

type RateLimitError = { rateLimited: true; retryAfterMs: number; message: string }
type PriceResult    = { price: number; partNumber: string; availability: string }

// ── Fetch a single part number from Mouser ────────────────────────────────────
async function fetchPartPrice(
  apiKey: string,
  partNumber: string
): Promise<PriceResult | RateLimitError | null> {
  try {
    const res = await fetch(
      `https://api.mouser.com/api/v1/search/partnumber?apiKey=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          SearchByPartRequest: { mouserPartNumber: partNumber, partSearchOptions: 'Exact' }
        })
      }
    )

    // Mouser uses BOTH 429 and 403 for rate limiting
    if (res.status === 429 || res.status === 403) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '60') * 1000
      // Try to parse body for more info, but treat any 403/429 as rate limit
      try {
        const errData: any = await res.json()
        const errList = errData.Errors || (Array.isArray(errData) ? errData : [])
        const code = (errList[0]?.Code || errList[0]?.ErrorCode || '').toLowerCase()
        const msg  = (errList[0]?.Message || '').toLowerCase()
        // 403 that is NOT a rate limit (e.g. invalid key) — surface as real error
        if (res.status === 403 && !code.includes('toomany') && !msg.includes('maximum') && !msg.includes('rate') && !msg.includes('limit')) {
          return null  // genuine auth error, not rate limit
        }
        return { rateLimited: true, retryAfterMs: retryAfter || 60_000, message: errList[0]?.Message || `HTTP ${res.status}` }
      } catch {
        return { rateLimited: true, retryAfterMs: retryAfter || 60_000, message: `HTTP ${res.status}` }
      }
    }

    const data: any = await res.json()

    // ── PRIORITY: check SearchResults FIRST ──────────────────────────────────
    // Mouser sometimes returns BOTH valid SearchResults AND a rate-limit warning
    // in the Errors array (HTTP 200 with partial data). If we have usable prices,
    // return them — do NOT discard valid data just because Errors is also populated.
    const parts = (data.SearchResults?.Parts || []) as any[]
    const withPrice = parts.filter((p: any) => p.PriceBreaks?.length > 0)

    // Only fall through to error-checking if we got no usable price data
    if (!withPrice.length) {
      if (data.Errors?.length) {
        const code = (data.Errors[0]?.Code || data.Errors[0]?.ErrorCode || '').toLowerCase()
        const msg  = (data.Errors[0]?.Message || '').toLowerCase()
        if (code.includes('toomany') || msg.includes('maximum') || msg.includes('rate') || msg.includes('429') || msg.includes('limit') || msg.includes('throttl')) {
          return { rateLimited: true, retryAfterMs: 60_000, message: data.Errors[0]?.Message || 'Rate limited' }
        }
        return null
      }
      return null
    }

    const unitParts = withPrice.filter((p: any) => parseInt(p.Min || '9999') <= 10)
    const target = unitParts.length > 0 ? unitParts[0] : withPrice[0]
    const breaks = [...target.PriceBreaks].sort((a: any, b: any) => a.Quantity - b.Quantity)
    const pb = breaks.find((b: any) => b.Quantity <= 10) || breaks[0]

    const numStr = (pb.Price as string).replace(/[^0-9.]/g, '')
    let price = parseFloat(numStr)
    if (isNaN(price) || price <= 0) return null
    if (pb.Currency === 'INR') price *= INR_TO_USD
    if (price > 200) return null  // reel/kit outlier

    return {
      price: Math.round(price * 10000) / 10000,
      partNumber: target.ManufacturerPartNumber || partNumber,
      availability: target.Availability || '—'
    }
  } catch (e: any) {
    // Surface the error in diag endpoint for debugging
    return { _error: e?.message || String(e) } as any
  }
}

// ── Fetch one category: try primary, then fallback ────────────────────────────
async function fetchCategory(
  apiKey: string,
  catId: string,
  catData: { label: string; parts: string[] }
): Promise<{ catId: string; result: PriceResult | null; rateLimited: boolean; retryAfterMs: number; error?: string }> {
  for (const partNum of catData.parts) {
    const r = await fetchPartPrice(apiKey, partNum)
    if (!r) continue
    if ('rateLimited' in r) {
      return { catId, result: null, rateLimited: true, retryAfterMs: r.retryAfterMs }
    }
    if ('_error' in r) {
      return { catId, result: null, rateLimited: false, retryAfterMs: 0, error: (r as any)._error }
    }
    return { catId, result: r, rateLimited: false, retryAfterMs: 0 }
  }
  return { catId, result: null, rateLimited: false, retryAfterMs: 0 }
}

// ── Fetch all 28 categories — two-pass: parallel batches + bounded retry ─────
// Pass 1: parallel batches of CONCURRENCY with PER_BATCH_DELAY between them.
// Pass 2: if a small number (1..RETRY_MAX_FAILURES) of categories failed in
// pass 1, wait RETRY_DELAY_MS and re-fetch them in parallel. This recovers
// the common transient-rate-limit case (e.g. 26-27/28) without burning
// extra quota when the failure mode is a true global rate limit.
type CatData = { label: string; parts: string[] }

async function fetchAllPrices(apiKey: string) {
  const fetchedAt = new Date().toISOString()
  const categories = Object.entries(PART_MAP)
  const results: Record<string, any> = {}
  const failed: Array<{ catId: string; catData: CatData; rateLimited: boolean }> = []
  let maxRetryAfterMs = 60_000
  let fetchedCount = 0

  function writeSuccess(catId: string, catData: CatData, r: PriceResult) {
    const baseline = BASELINES[catId] ?? 0
    results[catId] = {
      label: catData.label,
      avgPriceUSD: r.price,
      baselinePriceUSD: baseline,
      // Phase 23C.4 — preserve 2 decimal places. Previous /10 rounding
      // truncated sub-0.05% movements to 0.0, hiding small but real
      // changes. Live row now shows e.g. +0.03% instead of "flat".
      qoqPct: baseline > 0 ? Math.round(((r.price - baseline) / baseline) * 10000) / 100 : null,
      parts: [{ part: r.partNumber, price: r.price, availability: r.availability }],
      fetchedAt,
      live: true
    }
    fetchedCount++
  }

  function writeFailure(catId: string, catData: CatData, rateLimited: boolean) {
    const baseline = BASELINES[catId] ?? 0
    results[catId] = {
      label: catData.label,
      avgPriceUSD: baseline,
      baselinePriceUSD: baseline,
      qoqPct: null,
      parts: [],
      fetchedAt,
      live: false,
      error: rateLimited ? 'Rate limit — pending retry' : 'No pricing data available'
    }
  }

  // Pass 1: parallel batches at lower concurrency
  for (let i = 0; i < categories.length; i += CONCURRENCY) {
    const batch = categories.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(([catId, catData]) => fetchCategory(apiKey, catId, catData))
    )
    for (const { catId, result, rateLimited, retryAfterMs } of batchResults) {
      if (result && !rateLimited) {
        writeSuccess(catId, PART_MAP[catId], result)
      } else {
        if (rateLimited) maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs)
        failed.push({ catId, catData: PART_MAP[catId], rateLimited })
      }
    }
    if (i + CONCURRENCY < categories.length) {
      await new Promise(r => setTimeout(r, PER_BATCH_DELAY))
    }
  }

  // Pass 2: bounded retry — only when a small number of categories failed.
  // If too many failed, treat it as a real global rate-limit and let the
  // frontend's countdown handle the retry instead of burning more quota now.
  if (failed.length > 0 && failed.length <= RETRY_MAX_FAILURES) {
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    const retrying = failed.splice(0, failed.length)
    const retryResults = await Promise.all(
      retrying.map(({ catId, catData }) => fetchCategory(apiKey, catId, catData))
    )
    for (let i = 0; i < retryResults.length; i++) {
      const orig = retrying[i]
      const { result, rateLimited, retryAfterMs } = retryResults[i]
      if (result && !rateLimited) {
        writeSuccess(orig.catId, orig.catData, result)
      } else {
        if (rateLimited) maxRetryAfterMs = Math.max(maxRetryAfterMs, retryAfterMs)
        failed.push({ ...orig, rateLimited: rateLimited || orig.rateLimited })
      }
    }
  }

  // Write failure records for whatever is still missing.
  for (const f of failed) writeFailure(f.catId, f.catData, f.rateLimited)

  // Final rate-limited state reflects what's still missing after retry.
  const finalRateLimited = failed.some(f => f.rateLimited)
  const failedCategories = failed.map(f => f.catId)

  return {
    results,
    rateLimited: finalRateLimited,
    rateLimitedAt: finalRateLimited ? new Date().toISOString() : null,
    retryAfterMs: maxRetryAfterMs,
    fetchedCount,
    totalCount: categories.length,
    failedCategories
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
// NOTE: CF Workers are stateless — each edge PoP is a separate instance.
// In-memory cache (_cache) only persists within one instance's lifetime.
// We use CF's HTTP Cache API for cross-instance caching instead.

const CACHE_KEY = 'https://ti-price-dashboard-cache/prices'
const CACHE_TTL_SECONDS = 6 * 60 * 60  // 6 hours

app.get('/api/prices', async (c) => {
  const force = c.req.query('refresh') === 'true'

  // Try CF HTTP cache first (shared across all edge instances)
  if (!force) {
    const cache = caches.default
    const cached = await cache.match(CACHE_KEY)
    if (cached) {
      const data = await cached.json()
      return c.json({ source: 'cache', cachedAt: data._cachedAt, fetchedCount: data._fetchedCount, totalCount: data._totalCount, data: data._results, nextRefreshMs: data._nextRefreshMs, ...getBaselineMeta() })
    }
  }

  const apiKey = c.env.MOUSER_API_KEY
  if (!apiKey) return c.json({ error: 'MOUSER_API_KEY not configured' }, 500)

  const { results, rateLimited, rateLimitedAt, retryAfterMs, fetchedCount, totalCount, failedCategories } =
    await fetchAllPrices(apiKey)

  const now = new Date().toISOString()
  const payload = { _results: results, _cachedAt: now, _fetchedCount: fetchedCount, _totalCount: totalCount, _nextRefreshMs: CACHE_TTL_SECONDS * 1000 }

  // Only cache successful (or partial-but-not-rate-limited) fetches.
  // Rate-limited responses are intentionally not cached so the next refresh
  // gets a fresh attempt instead of being trapped on stale partial data.
  if (!rateLimited && fetchedCount > 0) {
    const cache = caches.default
    const cacheResponse = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`
      }
    })
    await cache.put(CACHE_KEY, cacheResponse)
  }

  return c.json({
    source: 'live',
    fetchedAt: now,
    fetchedCount,
    totalCount,
    rateLimited,
    rateLimitedAt,
    retryAfterMs: rateLimited ? retryAfterMs : 0,
    retryAfterSeconds: rateLimited ? Math.ceil(retryAfterMs / 1000) : 0,
    retryAt: rateLimited ? new Date(Date.now() + retryAfterMs).toISOString() : null,
    failedCategories: failedCategories.length > 0 ? failedCategories : undefined,
    data: results,
    ...getBaselineMeta(),
  })
})

// ── Diagnostic: test parallel fetches from within CF Worker ──────────────────
app.get('/api/diag', async (c) => {
  const apiKey = c.env.MOUSER_API_KEY
  if (!apiKey) return c.json({ error: 'no key' }, 500)

  // Fire 3 requests in parallel (like the batch does) and capture all results
  const testParts = ['TPS7A8300RGWR', 'UCC28180D', 'TPS54360BDDA']
  const parallelResults = await Promise.all(
    testParts.map(async (partNum) => {
      try {
        const res = await fetch(
          `https://api.mouser.com/api/v1/search/partnumber?apiKey=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              SearchByPartRequest: { mouserPartNumber: partNum, partSearchOptions: 'Exact' }
            })
          }
        )
        const body = await res.text()
        let parsed: any = null
        try { parsed = JSON.parse(body) } catch {}
        const errors = parsed?.Errors ?? []
        const parts = parsed?.SearchResults?.Parts ?? []
        const firstPrice = parts[0]?.PriceBreaks?.[0] ?? null
        return {
          part: partNum,
          httpStatus: res.status,
          errors: errors.length ? errors[0] : null,
          partsFound: parts.length,
          price: firstPrice,
          parseResult: await fetchPartPrice(apiKey, partNum)
        }
      } catch (e: any) {
        return { part: partNum, fetchError: e?.message || String(e) }
      }
    })
  )

  return c.json({ parallelResults, ts: new Date().toISOString() })
})

app.get('/api/status', async (c) => {
  const cache = caches.default
  const cached = await cache.match(CACHE_KEY)
  const meta = getBaselineMeta()
  return c.json({
    cached: !!cached,
    categories: Object.keys(PART_MAP).length,
    cacheTtlHours: CACHE_TTL_SECONDS / 3600,
    hint: cached ? 'Cache hit — serving from CF edge cache' : 'No cache — next /api/prices will fetch live',
    baselineDate: meta.baselineDate,
    baselinePeriodLabel: meta.baselinePeriodLabel,
    baselineDisplay: meta.baselineDisplay,
    baselineAgeDays: meta.baselineAgeDays,
    baselineIsStale: meta.baselineIsStale,
    comparisonMode: meta.comparisonMode,
  })
})

// ── Multi-source roadmap status — never exposes secret values ────────────────
app.get('/api/sources/status', (c) => {
  const env = c.env
  const mouserConfigured = !!env.MOUSER_API_KEY
  const nexarClientIdPresent = !!env.NEXAR_CLIENT_ID
  const nexarClientSecretPresent = !!env.NEXAR_CLIENT_SECRET
  const nexarConfigured = nexarClientIdPresent && nexarClientSecretPresent
  return c.json({
    phase: 'nexar_single_sku_test',
    sources: {
      mouser: {
        configured: mouserConfigured,
        usage: 'core-live-row (existing dashboard)',
      },
      octopart_nexar: {
        configured: nexarConfigured,
        clientIdPresent: nexarClientIdPresent,
        clientSecretPresent: nexarClientSecretPresent,
        testEndpoint: '/api/nexar/test?mpn=TPS7A8300RGWR',
        defaultMpn: 'TPS7A8300RGWR',
        trustedDistributors: TRUSTED_DISTRIBUTOR_LIST,
        notes: 'Authorized/core distributor signal is not blended with broker/marketplace signal.',
      },
    },
  })
})

// ── Single-SKU Nexar test endpoint ───────────────────────────────────────────
// GET /api/nexar/test?mpn=TPS7A8300RGWR (mpn defaults to TPS7A8300RGWR)
// Returns the normalized contract from src/sources/octopartNexar.ts. When
// secrets are missing, returns { configured: false, status: 'not_configured' }.
// Errors are sanitized — credentials, raw GraphQL bodies, and stack traces are
// never echoed to the client.
// ── Phase 16A — canonical TI taxonomy (read-only) ────────────────────────────
// Single source of truth for the 8 major TI groups and 28 customer-facing
// subcategories. No external calls; no Nexar; safe for page-load fetch.
app.get('/api/ti/taxonomy', (c) => {
  // Subcategories the rotating Nexar basket recognizes today (canonical IDs).
  const repBasketCanonicalIds = Array.from(
    new Set(
      PHASE_8_BASKET_PREVIEW.map(b =>
        b.canonicalCategoryId ?? canonicalCategoryId(b.categoryId),
      ),
    ),
  )
  const coverageSummary = summarizeTaxonomyCoverage({
    representativeBasketSubcategories: repBasketCanonicalIds,
  })
  return c.json({
    taxonomyVersion: TI_TAXONOMY_VERSION,
    groupCount: TI_TAXONOMY_GROUP_COUNT,
    subcategoryCount: TI_TAXONOMY_SUBCATEGORY_COUNT,
    groups: TI_TAXONOMY,
    coverageSummary,
    notes: [
      'Mouser is the full free backbone — no paid quota required.',
      'Nexar is sparse rotating corroboration, capped at 4 calls/day.',
      'TI Direct, DigiKey Direct, and Arrow Direct are roadmap (future).',
      'Broker inventory is excluded from the core trust signal.',
    ],
  })
})

// ── Phase 15A/15B — basket coverage (read-only catalog reflection) ───────────
// Returns the full representative TI basket catalog plus today's sampling
// plan and a 7-day forward rotation preview. Never calls Nexar, never
// triggers capture. Cheap to call; safe for page-load fetch.
app.get('/api/nexar/basket-coverage', (c) => {
  const sampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    policy: 'anchor_plus_rotation',
  })
  const preview = previewRotation(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    days: 7,
    policy: 'anchor_plus_rotation',
    startDate: sampling.snapshotDate,
  })
  const sampledByCat = new Map<string, typeof sampling.sampled>()
  const unsampledByCat = new Map<string, typeof sampling.unsampled>()
  for (const r of sampling.sampled) {
    const arr = sampledByCat.get(r.category.categoryId) || []
    arr.push(r); sampledByCat.set(r.category.categoryId, arr)
  }
  for (const r of sampling.unsampled) {
    const arr = unsampledByCat.get(r.category.categoryId) || []
    arr.push(r); unsampledByCat.set(r.category.categoryId, arr)
  }
  // For each category, find the next preview day that samples it (when known).
  const nextSampleByCat = new Map<string, string | null>()
  for (const cat of PHASE_8_BASKET_PREVIEW) {
    if (sampledByCat.has(cat.categoryId)) {
      nextSampleByCat.set(cat.categoryId, sampling.snapshotDate) // sampled today
      continue
    }
    let next: string | null = null
    for (const day of preview) {
      if (day.sampledSkus.some(s => s.categoryId === cat.categoryId)) {
        next = day.snapshotDate
        break
      }
    }
    nextSampleByCat.set(cat.categoryId, next)
  }
  const categories = PHASE_8_BASKET_PREVIEW.map(cat => {
    const sampled = sampledByCat.get(cat.categoryId) || []
    const unsampled = unsampledByCat.get(cat.categoryId) || []
    return {
      categoryId: cat.categoryId,
      categoryLabel: cat.categoryLabel,
      groupId: cat.groupId,
      groupLabel: cat.groupLabel,
      categoryRole: cat.categoryRole ?? null,
      whyItMatters: cat.whyItMatters ?? null,
      sourceCoverageTarget: cat.sourceCoverageTarget ?? [],
      skuCount: cat.skus.length,
      sampledSkuCount: sampled.length,
      unsampledSkuCount: unsampled.length,
      sampledToday: sampled.length > 0,
      nextExpectedSampleDate: nextSampleByCat.get(cat.categoryId) ?? null,
      sampledSkus: sampled.map(r => ({
        mpn: r.sku.mpn,
        role: r.sku.role,
        importanceTier: r.sku.importanceTier ?? null,
        samplingPriority: r.sku.samplingPriority ?? null,
        representativeReason: r.sku.representativeReason ?? null,
        fallbackFor: r.sku.fallbackFor ?? null,
        reason: r.reason ?? null,
      })),
      unsampledSkus: unsampled.map(r => ({
        mpn: r.sku.mpn,
        role: r.sku.role,
        importanceTier: r.sku.importanceTier ?? null,
        samplingPriority: r.sku.samplingPriority ?? null,
        representativeReason: r.sku.representativeReason ?? null,
        fallbackFor: r.sku.fallbackFor ?? null,
        reason: r.reason ?? 'quota_limit',
      })),
    }
  })
  // Phase 16A — taxonomyCoverage block: how the representative basket maps to
  // the canonical 28-subcategory taxonomy. No external calls.
  const repBasketCanonicalIds = Array.from(
    new Set(
      PHASE_8_BASKET_PREVIEW.map(b =>
        b.canonicalCategoryId ?? canonicalCategoryId(b.categoryId),
      ),
    ),
  )
  const taxonomyCanonicalIds = TI_TAXONOMY_FLAT.map(s => s.categoryId)
  const coveredCanonicalSubcategories = repBasketCanonicalIds.filter(id =>
    taxonomyCanonicalIds.includes(id),
  )
  const uncoveredCanonicalSubcategories = taxonomyCanonicalIds.filter(
    id => !coveredCanonicalSubcategories.includes(id),
  )
  const taxonomyCoverage = {
    canonicalSubcategoryCount: TI_TAXONOMY_SUBCATEGORY_COUNT,
    representativeBasketSubcategoryCount: coveredCanonicalSubcategories.length,
    representativeBasketCoveragePct: TI_TAXONOMY_SUBCATEGORY_COUNT > 0
      ? Math.round((coveredCanonicalSubcategories.length / TI_TAXONOMY_SUBCATEGORY_COUNT) * 1000) / 10
      : 0,
    coveredCanonicalSubcategories,
    uncoveredCanonicalSubcategories,
  }
  return c.json({
    configured: true,
    status: 'ok' as const,
    source: 'octopart_nexar',
    mode: 'representative_basket_preview',
    categoryCount: categories.length,
    basketCatalogSkuCount: sampling.basketCatalogSkuCount,
    currentSampleLimit: sampling.sampleLimit,
    sampleLimitReason: sampling.sampleLimitReason,
    sampledSkuCount: sampling.sampledSkuCount,
    unsampledSkuCount: sampling.unsampledSkuCount,
    samplingPolicy: sampling.policy,
    snapshotDate: sampling.snapshotDate,
    rotationIndex: sampling.rotationIndex,
    rotationPoolSize: sampling.rotationPoolSize,
    rotationSlots: sampling.rotationSlots,
    anchorSlots: sampling.anchorSlots,
    estimatedFullCycleDays: sampling.estimatedFullCycleDays,
    nextRotationPreview: preview,
    taxonomyCoverage,
    taxonomyVersion: TI_TAXONOMY_VERSION,
    quotaNote: BASKET_PREVIEW_QUOTA_NOTE,
    expansionNote: 'Daily cap stays at 4 to respect the Nexar Evaluation quota. Anchor SKUs are sampled every day for continuity; the remaining slots rotate through secondary/watchlist categories deterministically by UTC date so unsampled categories build observed history over time. nextRotationPreview is a planned simulation only — not observed data.',
    categories,
  })
})

// ── Phase 8/9 — tiny multi-SKU basket preview (24h CF-cached) ────────────────
// Hard-bounded to BASKET_PREVIEW_MAX_CALLS (=4) MPN fetches. Cache key is
// shared across CF edge instances; only ok/partial responses are cached.
// not_configured / error responses are NEVER cached so the next request
// re-attempts cleanly. Use ?refresh=true to bypass cache (manual operation).
const BASKET_CACHE_KEY = 'https://ti-price-dashboard-cache/nexar-basket-preview'
const BASKET_CACHE_TTL_HOURS = 24
const BASKET_CACHE_TTL_SECONDS = BASKET_CACHE_TTL_HOURS * 60 * 60

app.get('/api/nexar/basket-preview', async (c) => {
  const force = c.req.query('refresh') === 'true'
  const fetchedAt = new Date().toISOString()
  const clientId = c.env.NEXAR_CLIENT_ID
  const clientSecret = c.env.NEXAR_CLIENT_SECRET
  // Phase 15A/15B: catalog is larger than the maxCalls cap. Use the same
  // sampling helper the daily capture uses (anchor + UTC-day rotation), so the
  // live preview shows exactly the SKUs that would be captured today.
  const sampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    policy: 'anchor_plus_rotation',
  })
  const allSkus = sampling.sampled
  const sampledCatIds = new Set(allSkus.map(r => r.category.categoryId))

  // Serve from cache when available and not forcing refresh.
  if (!force) {
    const cache = caches.default
    const cached = await cache.match(BASKET_CACHE_KEY)
    if (cached) {
      const data: any = await cached.json()
      return c.json({ ...data, cached: true })
    }
  }

  // Defensive guard — should never trip with the sampling helper, but kept as
  // a belt-and-braces check in case someone bypasses the helper later.
  if (allSkus.length > BASKET_PREVIEW_MAX_CALLS) {
    return c.json({
      configured: true,
      status: 'error' as const,
      source: 'octopart_nexar',
      mode: 'tiny_basket_preview',
      fetchedAt,
      cached: false,
      cacheTtlHours: BASKET_CACHE_TTL_HOURS,
      categoryCount: PHASE_8_BASKET_PREVIEW.length,
      skuCount: allSkus.length,
      quotedSkuCount: 0,
      maxCalls: BASKET_PREVIEW_MAX_CALLS,
      callsUsed: 0,
      basketStatus: BASKET_STATUS,
      remainingEvaluationQuotaNote: BASKET_PREVIEW_QUOTA_NOTE,
      categories: [],
      message: `Refusing to run: basket has ${allSkus.length} SKUs > maxCalls=${BASKET_PREVIEW_MAX_CALLS}.`,
    }, 500)
  }

  if (!clientId || !clientSecret) {
    return c.json({
      configured: false,
      status: 'not_configured' as const,
      source: 'octopart_nexar',
      mode: 'tiny_basket_preview',
      fetchedAt,
      coverage: summarizeSampling(sampling),
      cached: false,
      cacheTtlHours: BASKET_CACHE_TTL_HOURS,
      categoryCount: PHASE_8_BASKET_PREVIEW.length,
      skuCount: allSkus.length,
      quotedSkuCount: 0,
      maxCalls: BASKET_PREVIEW_MAX_CALLS,
      callsUsed: 0,
      basketStatus: BASKET_STATUS,
      remainingEvaluationQuotaNote: BASKET_PREVIEW_QUOTA_NOTE,
      categories: PHASE_8_BASKET_PREVIEW.map(cat => ({
        categoryId: cat.categoryId,
        categoryLabel: cat.categoryLabel,
        groupId: cat.groupId,
        groupLabel: cat.groupLabel,
        skuCount: cat.skus.length,
        quotedSkuCount: 0,
        avgBestTrustedAvailableUnitPrice: null,
        medianBestTrustedAvailableUnitPrice: null,
        totalTrustedAvailableInventory: 0,
        totalBrokerAvailableInventory: 0,
        trustedDistributorCoverage: [],
        warnings: [],
        sampleCoverage: 'limited' as const,
        skus: cat.skus.map(sku => ({
          mpn: sku.mpn,
          role: sku.role,
          categoryId: cat.categoryId,
          categoryLabel: cat.categoryLabel,
          status: 'not_configured' as const,
          trustedDistributors: [],
          bestTrustedAvailableUnitPrice: null,
          bestTrustedAvailableDistributor: null,
          bestTrustedAvailableInventory: null,
          bestTrustedQuotedUnitPrice: null,
          bestAnyUnitPrice: null,
          totalTrustedAvailableInventory: 0,
          totalBrokerAvailableInventory: 0,
          warnings: [],
        })),
      })),
      message: 'Set NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET to enable.',
    })
  }

  // Fire all (≤4) calls in parallel; a single quota failure must not kill the
  // whole basket. Token cache inside fetchNexarPart amortizes auth across them.
  const settled = await Promise.allSettled(
    allSkus.map(({ sku }) => fetchNexarPart({ clientId, clientSecret, mpn: sku.mpn }))
  )
  const callsUsed = settled.length

  // Per-SKU normalization (or sanitized error stub on rejection)
  const perSku = settled.map((res, i) => {
    const { category, sku } = allSkus[i]
    if (res.status === 'fulfilled') {
      const norm = normalizeNexarPart(res.value, sku.mpn)
      return {
        mpn: sku.mpn,
        role: sku.role,
        categoryId: category.categoryId,
        categoryLabel: category.categoryLabel,
        status: norm.status,
        trustedDistributors: norm.trustedDistributors,
        bestTrustedAvailableUnitPrice: norm.bestTrustedAvailableUnitPrice,
        bestTrustedAvailableDistributor: norm.bestTrustedAvailableDistributor,
        bestTrustedAvailableInventory: norm.bestTrustedAvailableInventory,
        bestTrustedQuotedUnitPrice: norm.bestTrustedQuotedUnitPrice,
        bestAnyUnitPrice: norm.bestAnyUnitPrice,
        totalTrustedAvailableInventory: norm.totalTrustedAvailableInventory,
        totalBrokerAvailableInventory: norm.totalBrokerAvailableInventory,
        warnings: norm.warnings,
      }
    } else {
      const message = String((res.reason as any)?.message || 'unknown error').slice(0, 200)
      return {
        mpn: sku.mpn,
        role: sku.role,
        categoryId: category.categoryId,
        categoryLabel: category.categoryLabel,
        status: 'error' as const,
        trustedDistributors: [],
        bestTrustedAvailableUnitPrice: null,
        bestTrustedAvailableDistributor: null,
        bestTrustedAvailableInventory: null,
        bestTrustedQuotedUnitPrice: null,
        bestAnyUnitPrice: null,
        totalTrustedAvailableInventory: 0,
        totalBrokerAvailableInventory: 0,
        warnings: [],
        message,
      }
    }
  })

  // Per-category aggregation — only categories that had at least one SKU
  // sampled this run get a record. Catalogued-but-unsampled categories live
  // separately in /api/nexar/basket-coverage.
  const categories = PHASE_8_BASKET_PREVIEW
    .filter(cat => sampledCatIds.has(cat.categoryId))
    .map(cat => {
    const skus = perSku.filter(s => s.categoryId === cat.categoryId)
    const availablePrices = skus
      .map(s => s.bestTrustedAvailableUnitPrice)
      .filter((p): p is number => typeof p === 'number' && p > 0)
    const quotedPrices = skus
      .map(s => s.bestTrustedQuotedUnitPrice)
      .filter((p): p is number => typeof p === 'number' && p > 0)

    let avg: number | null = null
    let median: number | null = null
    let usedQuotedFallback = false

    const computeAvgMedian = (vals: number[]) => {
      const sorted = vals.slice().sort((a, b) => a - b)
      const a = sorted.reduce((s, v) => s + v, 0) / sorted.length
      const m = sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      return { a, m }
    }

    if (availablePrices.length > 0) {
      const r = computeAvgMedian(availablePrices)
      avg = Math.round(r.a * 10000) / 10000
      median = Math.round(r.m * 10000) / 10000
    } else if (quotedPrices.length > 0) {
      const r = computeAvgMedian(quotedPrices)
      avg = Math.round(r.a * 10000) / 10000
      median = Math.round(r.m * 10000) / 10000
      usedQuotedFallback = true
    }

    const totalTrustedAvailableInventory = skus.reduce((s, x) => s + (x.totalTrustedAvailableInventory || 0), 0)
    const totalBrokerAvailableInventory = skus.reduce((s, x) => s + (x.totalBrokerAvailableInventory || 0), 0)

    const distSet = new Set<string>()
    for (const s of skus) {
      for (const d of s.trustedDistributors) distSet.add(d)
    }
    const trustedDistributorCoverage = Array.from(distSet)

    const warnings: string[] = []
    if (usedQuotedFallback) warnings.push('category_average_uses_quoted_fallback')
    if (availablePrices.length === 0 && quotedPrices.length === 0) warnings.push('no_priced_skus_in_category')
    if (skus.some(s => s.status === 'error')) warnings.push('one_or_more_skus_failed_fetch')
    if (skus.some(s => s.status === 'no_match')) warnings.push('one_or_more_skus_returned_no_match')

    return {
      categoryId: cat.categoryId,
      categoryLabel: cat.categoryLabel,
      groupId: cat.groupId,
      groupLabel: cat.groupLabel,
      skuCount: skus.length,
      quotedSkuCount: availablePrices.length,
      avgBestTrustedAvailableUnitPrice: avg,
      medianBestTrustedAvailableUnitPrice: median,
      totalTrustedAvailableInventory,
      totalBrokerAvailableInventory,
      trustedDistributorCoverage,
      warnings,
      sampleCoverage: 'limited' as const,
      skus,
    }
  })

  const skuCount = perSku.length
  const quotedSkuCount = perSku.filter(s => s.bestTrustedAvailableUnitPrice != null).length
  const errored = perSku.filter(s => s.status === 'error').length
  const status: 'ok' | 'partial' | 'error' =
    errored === skuCount ? 'error' : errored > 0 ? 'partial' : 'ok'

  const payload = {
    configured: true,
    status,
    source: 'octopart_nexar' as const,
    mode: 'tiny_basket_preview' as const,
    fetchedAt,
    coverage: summarizeSampling(sampling),
    cached: false,
    cacheTtlHours: BASKET_CACHE_TTL_HOURS,
    categoryCount: PHASE_8_BASKET_PREVIEW.length,
    skuCount,
    quotedSkuCount,
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    callsUsed,
    basketStatus: BASKET_STATUS,
    remainingEvaluationQuotaNote: BASKET_PREVIEW_QUOTA_NOTE,
    categories,
  }

  // Cache only ok/partial. Never cache not_configured or error states so the
  // next request gets a fresh attempt instead of being trapped on stale failure.
  if (status === 'ok' || status === 'partial') {
    const cache = caches.default
    const cacheResponse = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${BASKET_CACHE_TTL_SECONDS}`,
      },
    })
    await cache.put(BASKET_CACHE_KEY, cacheResponse)
  }

  return c.json(payload)
})

app.get('/api/nexar/test', async (c) => {
  const mpn = (c.req.query('mpn') || 'TPS7A8300RGWR').trim()
  const clientId = c.env.NEXAR_CLIENT_ID
  const clientSecret = c.env.NEXAR_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.json(notConfiguredResponse(mpn))
  }
  try {
    const raw = await fetchNexarPart({ clientId, clientSecret, mpn })
    return c.json(normalizeNexarPart(raw, mpn))
  } catch (e: any) {
    const message = String(e?.message || 'unknown error').slice(0, 200)
    return c.json(errorResponse(mpn, message), 502)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — persistent source-memory endpoints
// ─────────────────────────────────────────────────────────────────────────────
// All four endpoints degrade gracefully when KV is not bound and never crash
// the page. Read endpoints never trigger Nexar/Mouser fetches. Capture is
// auth-gated and is the *only* path that calls Nexar fresh for a snapshot.

const SNAPSHOT_HISTORY_MAX_DAYS = 90
const SNAPSHOT_HISTORY_DEFAULT_DAYS = 30

function clampHistoryDays(raw: string | undefined): number {
  const parsed = parseInt(raw || `${SNAPSHOT_HISTORY_DEFAULT_DAYS}`, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return SNAPSHOT_HISTORY_DEFAULT_DAYS
  return Math.min(SNAPSHOT_HISTORY_MAX_DAYS, parsed)
}

function snapshotMemoryBaseEnv(env: Bindings) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    storageConfigured: !!env.SOURCE_SNAPSHOTS_KV,
    captureSecretConfigured: !!env.SNAPSHOT_CAPTURE_SECRET,
    nexarConfigured: !!(env.NEXAR_CLIENT_ID && env.NEXAR_CLIENT_SECRET),
  }
}

// POST /api/snapshots/capture — gated by SNAPSHOT_CAPTURE_SECRET header or query.
// One snapshot per UTC date by default. ?overwrite=true allows replacement.
app.post('/api/snapshots/capture', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const overwrite = c.req.query('overwrite') === 'true'

  // Storage missing → graceful not_configured (no auth check yet — there's
  // nothing to write into).
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      success: false,
      configured: false,
      status: 'snapshot_storage_not_configured',
      message: 'Bind SOURCE_SNAPSHOTS_KV in Cloudflare Pages → Settings → Functions → KV namespace bindings.',
      ...base,
    })
  }

  // Capture secret must be configured AND must match the request.
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      configured: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking capture.',
      ...base,
    })
  }
  // Hono's c.req.header() is case-insensitive on the lookup name, so we only
  // need one variant. We also tolerate a trailing newline / surrounding
  // whitespace on either side — Cloudflare Pages' env var UI silently keeps
  // pasted trailing newlines, which would otherwise break strict equality
  // against a cleanly-typed local value. Trim is applied to both sides; the
  // mismatch path is unchanged so missing-vs-wrong stays indistinguishable.
  const providedRaw =
    c.req.header('x-capture-secret') ||
    c.req.query('secret') ||
    ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }

  if (!env.NEXAR_CLIENT_ID || !env.NEXAR_CLIENT_SECRET) {
    return c.json({
      success: false,
      configured: true,
      status: 'nexar_not_configured',
      message: 'Capture requires NEXAR_CLIENT_ID and NEXAR_CLIENT_SECRET to be set.',
      ...base,
    }, 502)
  }

  const date = todayUtc()
  const key = snapshotKey(date)

  if (!overwrite) {
    const existing = await env.SOURCE_SNAPSHOTS_KV.get(key)
    if (existing) {
      return c.json({
        success: false,
        configured: true,
        status: 'already_exists_for_today',
        message: 'A snapshot already exists for today; pass ?overwrite=true to replace.',
        snapshotDate: date,
        key,
        ...base,
      })
    }
  }

  let result
  try {
    result = await captureRepresentativeBasketSnapshot({
      clientId: env.NEXAR_CLIENT_ID,
      clientSecret: env.NEXAR_CLIENT_SECRET,
      kv: env.SOURCE_SNAPSHOTS_KV,
    })
  } catch (e: any) {
    return c.json({
      success: false,
      configured: true,
      status: 'capture_failed',
      message: String(e?.message || 'unknown error').slice(0, 200),
      ...base,
    }, 502)
  }

  const { snapshot, callsUsed } = result
  await env.SOURCE_SNAPSHOTS_KV.put(key, JSON.stringify(snapshot))

  return c.json({
    success: true,
    configured: true,
    status: 'stored',
    snapshotDate: snapshot.snapshotDate,
    stored: true,
    overwritten: overwrite,
    key,
    categoryCount: snapshot.categoryCount,
    skuCount: snapshot.skuCount,
    callsUsed,
    maxCalls: snapshot.maxCalls,
    ...base,
  })
})

// GET /api/snapshots/latest
app.get('/api/snapshots/latest', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      latestSnapshotDate: null,
      snapshot: null,
      ...base,
    })
  }
  const snap = await getLatestSnapshot(env.SOURCE_SNAPSHOTS_KV)
  if (!snap) {
    return c.json({
      configured: true,
      status: 'no_snapshots',
      latestSnapshotDate: null,
      snapshot: null,
      ...base,
    })
  }
  return c.json({
    configured: true,
    status: 'ok',
    latestSnapshotDate: snap.snapshotDate,
    snapshot: snap,
    ...base,
  })
})

// GET /api/snapshots/history?days=30  (max 90)
app.get('/api/snapshots/history', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const days = clampHistoryDays(c.req.query('days'))
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      windowDays: days,
      snapshotCount: 0,
      snapshots: [],
      ...base,
    })
  }
  const snaps = await getRecentSnapshots(env.SOURCE_SNAPSHOTS_KV, days)
  return c.json({
    configured: true,
    status: snaps.length > 0 ? 'ok' : 'no_snapshots',
    windowDays: days,
    snapshotCount: snaps.length,
    snapshots: snaps,
    ...base,
  })
})

// GET /api/snapshots/trends?days=30
app.get('/api/snapshots/trends', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const days = clampHistoryDays(c.req.query('days'))
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      windowDays: days,
      observationCount: 0,
      categoryTrends: [],
      ...base,
    })
  }
  const snaps = await getRecentSnapshots(env.SOURCE_SNAPSHOTS_KV, days)
  const trends = computeTrends(snaps, days)
  return c.json({
    configured: true,
    status: trends.status,
    windowDays: days,
    observationCount: trends.observationCount,
    firstDate: trends.firstDate,
    latestDate: trends.latestDate,
    categoryTrends: trends.categoryTrends,
    ...base,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 16A — Mouser daily-snapshot backbone (free, no paid quota required)
// ─────────────────────────────────────────────────────────────────────────────

function mouserCanonicalCoverageSummary(snap: Snapshot | null) {
  if (!snap) return null
  const ok = (snap.categories || []).filter(c => (c.quotedSkuCount ?? 0) > 0)
  const okCanonical = Array.from(
    new Set(
      ok.map(c => c.canonicalCategoryId ?? canonicalCategoryId(c.categoryId)),
    ),
  )
  const missingCanonical = TI_TAXONOMY_FLAT.map(s => s.categoryId).filter(
    id => !okCanonical.includes(id),
  )
  return {
    canonicalSubcategoryCount: TI_TAXONOMY_SUBCATEGORY_COUNT,
    mouserCoveredCanonicalSubcategories: okCanonical,
    mouserCoveredCount: okCanonical.length,
    mouserMissingCanonicalSubcategories: missingCanonical,
    mouserMissingCount: missingCanonical.length,
  }
}

// POST /api/snapshots/mouser/capture — gated by SNAPSHOT_CAPTURE_SECRET (same secret as Nexar).
// One Mouser snapshot per UTC date; ?overwrite=true allows replacement.
// Stores under: source-snapshots/texas_instruments/mouser_direct/full_mouser_category_snapshot/YYYY-MM-DD
app.post('/api/snapshots/mouser/capture', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const overwrite = c.req.query('overwrite') === 'true'

  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      success: false,
      configured: false,
      status: 'snapshot_storage_not_configured',
      message: 'Bind SOURCE_SNAPSHOTS_KV before invoking Mouser capture.',
      ...base,
    })
  }
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      configured: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking capture.',
      ...base,
    })
  }
  const providedRaw =
    c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.MOUSER_API_KEY) {
    return c.json({
      success: false,
      configured: true,
      status: 'mouser_not_configured',
      message: 'Mouser capture requires MOUSER_API_KEY to be set.',
      ...base,
    }, 502)
  }

  const date = todayUtc()
  const key = mouserSnapshotKey(date)

  if (!overwrite) {
    const existing = await env.SOURCE_SNAPSHOTS_KV.get(key)
    if (existing) {
      let parsed: Snapshot | null = null
      try { parsed = JSON.parse(existing) } catch { parsed = null }
      return c.json({
        success: true, // idempotent — same as Nexar
        configured: true,
        status: 'already_exists_for_today',
        message: 'A Mouser snapshot already exists for today; pass ?overwrite=true to replace.',
        snapshotDate: date,
        key,
        source: MOUSER_SOURCE,
        noPaidQuotaRequired: true,
        canonicalCoverageSummary: mouserCanonicalCoverageSummary(parsed),
        ...base,
      })
    }
  }

  let result
  try {
    result = await captureMouserSnapshot({
      apiKey: env.MOUSER_API_KEY,
      snapshotDate: date,
    })
  } catch (e: any) {
    return c.json({
      success: false,
      configured: true,
      status: 'capture_failed',
      message: String(e?.message || 'unknown error').slice(0, 200),
      ...base,
    }, 502)
  }

  const { snapshot, callsUsed, okCategoryCount, rateLimitedCategoryCount, errorCategoryCount } = result
  await env.SOURCE_SNAPSHOTS_KV.put(key, JSON.stringify(snapshot))

  return c.json({
    success: true,
    configured: true,
    status: 'stored',
    snapshotDate: snapshot.snapshotDate,
    stored: true,
    overwritten: overwrite,
    key,
    source: MOUSER_SOURCE,
    mode: MOUSER_MODE,
    noPaidQuotaRequired: true,
    categoryCount: snapshot.categoryCount,
    skuCount: snapshot.skuCount,
    callsUsed,
    okCategoryCount,
    rateLimitedCategoryCount,
    errorCategoryCount,
    canonicalCoverageSummary: mouserCanonicalCoverageSummary(snapshot),
    ...base,
  })
})

// GET /api/snapshots/mouser/latest
app.get('/api/snapshots/mouser/latest', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      latestSnapshotDate: null,
      snapshot: null,
      source: MOUSER_SOURCE,
      ...base,
    })
  }
  const snap = await getLatestSnapshotFor(
    env.SOURCE_SNAPSHOTS_KV,
    MOUSER_SOURCE,
    MOUSER_MODE,
  )
  if (!snap) {
    return c.json({
      configured: true,
      status: 'no_snapshots',
      latestSnapshotDate: null,
      snapshot: null,
      source: MOUSER_SOURCE,
      ...base,
    })
  }
  return c.json({
    configured: true,
    status: 'ok',
    latestSnapshotDate: snap.snapshotDate,
    snapshot: snap,
    source: MOUSER_SOURCE,
    canonicalCoverageSummary: mouserCanonicalCoverageSummary(snap),
    ...base,
  })
})

// GET /api/snapshots/mouser/history?days=30 (max 90)
app.get('/api/snapshots/mouser/history', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const days = clampHistoryDays(c.req.query('days'))
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      windowDays: days,
      snapshotCount: 0,
      snapshots: [],
      source: MOUSER_SOURCE,
      ...base,
    })
  }
  const snaps = await getRecentSnapshotsFor(
    env.SOURCE_SNAPSHOTS_KV,
    MOUSER_SOURCE,
    MOUSER_MODE,
    days,
  )
  return c.json({
    configured: true,
    status: snaps.length > 0 ? 'ok' : 'no_snapshots',
    windowDays: days,
    snapshotCount: snaps.length,
    snapshots: snaps,
    source: MOUSER_SOURCE,
    ...base,
  })
})

// GET /api/snapshots/mouser/trends?days=30
app.get('/api/snapshots/mouser/trends', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const days = clampHistoryDays(c.req.query('days'))
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      windowDays: days,
      observationCount: 0,
      categoryTrends: [],
      source: MOUSER_SOURCE,
      ...base,
    })
  }
  const snaps = await getRecentSnapshotsFor(
    env.SOURCE_SNAPSHOTS_KV,
    MOUSER_SOURCE,
    MOUSER_MODE,
    days,
  )
  const trends = computeTrends(snaps, days)
  return c.json({
    configured: true,
    status: trends.status,
    windowDays: days,
    observationCount: trends.observationCount,
    firstDate: trends.firstDate,
    latestDate: trends.latestDate,
    categoryTrends: trends.categoryTrends,
    source: MOUSER_SOURCE,
    ...base,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 18A — Manual distributor evidence import (operator-supplied data)
// ─────────────────────────────────────────────────────────────────────────────
// Allows operators to POST distributor data (DigiKey/Arrow/TI/other) as JSON.
// One snapshot per (manual source × UTC date). Never called from the browser.
// Auth: same SNAPSHOT_CAPTURE_SECRET as the Mouser/Nexar capture endpoints.

// POST /api/snapshots/manual/import
app.post('/api/snapshots/manual/import', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const overwrite = c.req.query('overwrite') === 'true'

  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      success: false,
      configured: false,
      status: 'snapshot_storage_not_configured',
      message: 'Bind SOURCE_SNAPSHOTS_KV before invoking manual import.',
      ...base,
    })
  }
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      configured: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking manual import.',
      ...base,
    })
  }
  const providedRaw =
    c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }

  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (e: any) {
    return c.json({
      success: false,
      status: 'invalid_json',
      errors: [{ code: 'invalid_json', message: 'Body must be valid JSON.' }],
    }, 400)
  }

  const { errors, normalized } = normalizeManualSourceInput(payload)
  if (errors.length > 0 || !normalized) {
    return c.json({
      success: false,
      status: 'validation_failed',
      errors,
    }, 400)
  }

  const built = buildManualSnapshot(normalized)
  const key = manualSnapshotKey(normalized.source, normalized.snapshotDate)

  if (!overwrite) {
    const existing = await env.SOURCE_SNAPSHOTS_KV.get(key)
    if (existing) {
      return c.json({
        success: false,
        configured: true,
        status: 'already_exists_for_today',
        message: 'A manual snapshot already exists for that source + date; pass ?overwrite=true to replace.',
        source: normalized.source,
        snapshotDate: normalized.snapshotDate,
        key,
        ...base,
      })
    }
  }

  await env.SOURCE_SNAPSHOTS_KV.put(key, JSON.stringify(built.snapshot))

  return c.json({
    success: true,
    configured: true,
    status: 'stored',
    source: normalized.source,
    snapshotDate: normalized.snapshotDate,
    stored: true,
    overwritten: overwrite,
    key,
    categoryCount: built.snapshot.categoryCount,
    skuCount: built.snapshot.skuCount,
    rowCount: built.rowCount,
    unmappedRowCount: built.unmappedRowCount,
    warnings: built.warnings,
    noPaidQuotaRequired: true,
    ...base,
  })
})

// GET /api/snapshots/manual/latest?source=digikey_manual
app.get('/api/snapshots/manual/latest', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const source = parseManualSourceParam(c.req.query('source'))
  if (!source) {
    return c.json({
      configured: !!env.SOURCE_SNAPSHOTS_KV,
      status: 'invalid_source',
      message: `source query param required; allowed: ${ALLOWED_MANUAL_SOURCES.join(', ')}.`,
      ...base,
    }, 400)
  }
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      source,
      latestSnapshotDate: null,
      snapshot: null,
      ...base,
    })
  }
  const snap = await getLatestSnapshotFor(env.SOURCE_SNAPSHOTS_KV, source, MANUAL_MODE)
  if (!snap) {
    return c.json({
      configured: true,
      status: 'no_snapshots',
      source,
      latestSnapshotDate: null,
      snapshot: null,
      ...base,
    })
  }
  return c.json({
    configured: true,
    status: 'ok',
    source,
    latestSnapshotDate: snap.snapshotDate,
    snapshot: snap,
    ...base,
  })
})

// GET /api/snapshots/manual/history?source=digikey_manual&days=30
app.get('/api/snapshots/manual/history', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  const source = parseManualSourceParam(c.req.query('source'))
  if (!source) {
    return c.json({
      configured: !!env.SOURCE_SNAPSHOTS_KV,
      status: 'invalid_source',
      message: `source query param required; allowed: ${ALLOWED_MANUAL_SOURCES.join(', ')}.`,
      ...base,
    }, 400)
  }
  const days = clampHistoryDays(c.req.query('days'))
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      source,
      windowDays: days,
      snapshotCount: 0,
      snapshots: [],
      ...base,
    })
  }
  const snaps = await getRecentSnapshotsFor(env.SOURCE_SNAPSHOTS_KV, source, MANUAL_MODE, days)
  return c.json({
    configured: true,
    status: snaps.length > 0 ? 'ok' : 'no_snapshots',
    source,
    windowDays: days,
    snapshotCount: snaps.length,
    snapshots: snaps,
    ...base,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 19A — DigiKey sandbox connectivity adapter (NOT customer-facing yet)
// ─────────────────────────────────────────────────────────────────────────────
// Read-only status + auth-gated probe. No KV writes, no combined evidence
// changes, no UI. Exists only to verify the DigiKey sandbox app works before
// we build a real DigiKey snapshot pipeline in a later phase.

// GET /api/digikey/status — returns whether the adapter is configured.
// Never returns secret values; only booleans + the env tag.
app.get('/api/digikey/status', (c) => {
  const status = checkDigiKeySandboxConfigured(c.env)
  return c.json({
    ...status,
    probeEndpoint: '/api/digikey/sandbox/probe',
    probeMaxMpns: DIGIKEY_PROBE_MAX_MPNS,
    notes: [
      'Sandbox-only adapter. Production DigiKey endpoints are not used.',
      'Probe is auth-gated by SNAPSHOT_CAPTURE_SECRET; no new secret was added.',
      'No KV writes in this phase.',
    ],
  })
})

// POST /api/digikey/sandbox/probe — auth-gated. Hits DigiKey sandbox for up to
// 3 MPNs and returns a normalized result. Never stores anything.
app.post('/api/digikey/sandbox/probe', async (c) => {
  const env = c.env

  // Auth — same shared SNAPSHOT_CAPTURE_SECRET as Mouser/Nexar/manual capture.
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking probe.',
    })
  }
  const providedRaw =
    c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }

  let payload: any
  try {
    payload = await c.req.json()
  } catch {
    return c.json({
      success: false,
      status: 'invalid_json',
      errors: [{ code: 'invalid_json', message: 'Body must be valid JSON.' }],
    }, 400)
  }

  const mpns = Array.isArray(payload?.mpns) ? payload.mpns : []
  // The probe driver does its own validation (length cap, env check, etc.).
  const result = await probeDigiKeySandbox(env, mpns)
  // 401-style auth failures from DigiKey itself surface as success=false with
  // status=digikey_auth_failed; payload validation errors return 400.
  if (result.status === 'invalid_payload' || result.status === 'too_many_mpns') {
    return c.json(result, 400)
  }
  return c.json(result)
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20A — Texas Instruments direct API integration
// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 (live): Product Information API suite — approved.
// Stage 2 (gated): Store API suite — approval pending. Endpoint exists but
//                  refuses to hit TI until TI_STORE_API_ENABLED=true.
//
// NEVER returns the OAuth token to callers. NEVER logs the client id, the
// client secret, or the token. NEVER ships secrets in the frontend bundle.

// GET /api/ti/status — page-load callable. Performs at most one cached OAuth
// round-trip per 55 minutes. Token is never returned to the client.
app.get('/api/ti/status', async (c) => {
  const env = c.env
  const status = checkTiConfigured(env)
  // Snapshot token cache state BEFORE we call fetchTiToken so the response
  // can show whether the token came from cache.
  const cacheBefore = tiTokenCacheSnapshot()
  let tokenOk = false
  let tokenHttpStatus: number | null = null
  let tokenSanitizedCode: string | null = null
  let tokenSanitizedMessage = ''
  let tokenFromCache = false
  let lastSuccessfulRefresh: string | null = null
  if (status.configured) {
    const tok = await fetchTiToken(env)
    if (tok.ok) {
      tokenOk = true
      tokenFromCache = tok.fromCache
      lastSuccessfulRefresh = new Date(tok.fetchedAtMs).toISOString()
    } else {
      tokenHttpStatus = tok.httpStatus
      tokenSanitizedCode = tok.sanitizedCode
      tokenSanitizedMessage = tok.sanitizedMessage
    }
  }
  const endpoints = tiAttemptedEndpoints(env)
  return c.json({
    configured: status.configured,
    env: status.env,
    clientIdConfigured: status.clientIdConfigured,
    clientSecretConfigured: status.clientSecretConfigured,
    productInfoApi: {
      ready: status.productInfoApiReady && tokenOk,
      label: 'Texas Instruments Product Information API',
      state: status.productInfoApiReady && tokenOk ? 'ready' : status.configured ? 'auth_failed' : 'not_configured',
    },
    storeApi: {
      ready: status.storeApiReady && tokenOk,
      label: 'Texas Instruments Store API',
      state:
        status.storeApiState === 'pending_approval'
          ? 'pending_approval'
          : status.storeApiState === 'enabled'
            ? (tokenOk ? 'ready' : 'auth_failed')
            : 'disabled',
      pendingApprovalNote:
        status.storeApiState === 'pending_approval'
          ? 'TI Store API approval pending — Product Information API active.'
          : null,
    },
    tokenOk,
    tokenFromCache,
    tokenCachedBefore: cacheBefore.hasCache,
    lastSuccessfulRefresh,
    diagnostics: {
      tokenHttpStatus,
      sanitizedCode: tokenSanitizedCode,
      sanitizedMessage: tokenSanitizedMessage,
      // Phase 20A.1 — host + path only. No query strings, no secrets, ever.
      attemptedTokenHost: endpoints.attemptedTokenHost,
      attemptedTokenPath: endpoints.attemptedTokenPath,
      attemptedProductInfoHost: endpoints.attemptedProductInfoHost,
      attemptedProductInfoPath: endpoints.attemptedProductInfoPath,
      attemptedInventoryPricingHost: endpoints.attemptedInventoryPricingHost,
      attemptedInventoryPricingPath: endpoints.attemptedInventoryPricingPath,
      tokenUrlOverridden: endpoints.tokenUrlOverridden,
      productInfoUrlOverridden: endpoints.productInfoUrlOverridden,
      inventoryPricingUrlOverridden: endpoints.inventoryPricingUrlOverridden,
    },
    notes: [
      'OAuth token is cached in-memory for up to 55 minutes and is never returned.',
      'Store API endpoints refuse to call TI until TI_STORE_API_ENABLED=true.',
      'Endpoint URLs can be overridden via TI_TOKEN_URL / TI_PRODUCT_INFO_URL_TEMPLATE / TI_INVENTORY_PRICING_URL_TEMPLATE. Templates use {partNumber}.',
    ],
  })
})

// GET /api/ti/product-info?partNumber=XYZ — auth-gated.
// Hits TI Product Information API and returns a normalized product record.
// No KV writes. No token in the response.
app.get('/api/ti/product-info', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const result = await fetchTiProductInfo(env, partNumber)
  return c.json({ success: result.status === 'ok', ...result })
})

// GET /api/ti/product-info-debug?partNumber=XYZ — auth-gated. Returns
// SANITIZED shape information for both the basic and extended TI product
// endpoints. Never returns the raw response body, the OAuth token, the
// Authorization header, or the client id/secret. Used to diagnose parser
// gaps without exposing the production TI payload.
app.get('/api/ti/product-info-debug', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const report = await fetchTiProductInfoDebug(env, partNumber)
  return c.json({ success: report.basic.success || report.extended.success, ...report })
})

// GET /api/ti/watched-parts/product-info — auth-gated (Phase 20B).
// Iterates the TI watched-parts universe (webapp/src/sources/tiWatchedParts.ts),
// calling the Product Information API for each part and returning a normalized
// dashboard-ready bundle. Does NOT call the Store API — that suite remains
// pending approval and disabled. Token, secrets, and raw TI bodies never
// reach the response.
app.get('/api/ti/watched-parts/product-info', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const bundle = await fetchWatchedPartsProductInfo(env)
  return c.json({
    success: bundle.configured && bundle.parts.length > 0,
    storeApiState: 'pending_approval',
    storeApiNote: 'TI Store API approval pending — inventory and pricing signals are intentionally not fetched.',
    ...bundle,
  })
})

// GET /api/ti/watched-parts/catalog — public, secret-free metadata about the
// watched-parts universe. Useful for the UI to show basket counts before any
// authenticated fetch. NEVER returns TI data — only the static config.
// Phase 22.1 — only validated parts are exposed publicly. Staged 'pending'
// parts live in the same TI_WATCHED_PARTS array but are surfaced only via
// the auth-gated validation endpoint (Phase 22.2).
app.get('/api/ti/watched-parts/catalog', (c) => {
  const eligible = getValidatedWatchedParts()
  return c.json({
    totalParts: eligible.length,
    baskets: summarizeWatchedBaskets(),
    parts: eligible.map(p => ({
      genericPartNumber: p.genericPartNumber,
      preferredOrderablePartNumber: p.preferredOrderablePartNumber,
      displayName: p.displayName,
      basket: p.basket,
      subcategory: p.subcategory ?? null,
      dashboardPriority: p.dashboardPriority,
      thesisReason: p.thesisReason,
      demandProxyType: p.demandProxyType,
    })),
  })
})

// GET /api/ti/part-signal?partNumber=XYZ — auth-gated (Phase 20C.2).
// Single-round-trip merge of the Product Information API + Store Inventory &
// Pricing API for one part. Returns dashboard-ready metadata + live supply
// signals + derived signal flags. NEVER returns the OAuth token, the client
// id/secret, or the capture secret. NEVER fans out to the watched-parts
// catalog — this endpoint is one-part-at-a-time.
app.get('/api/ti/part-signal', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const signal = await fetchTiPartSignal(env, partNumber)
  const productOk = signal.sources.productInfo.status === 'ok'
  const inventoryOk = signal.sources.inventoryPricing.status === 'ok'
  return c.json({
    success: productOk || inventoryOk,
    ...signal,
  })
})

// POST /api/ti/inventory/capture — auth-gated (Phase 20D.1, batched).
// Iterates a SLICE of the watched-parts universe and merges the result into
// the existing snapshot. Cloudflare Workers cap each invocation at ~50–100
// outbound subrequests, and the part-signal merger can spend up to four
// subrequests per part (token, product info basic, product info extended,
// store inventory). 32 parts × 4 ≈ 128 subrequests, comfortably over the
// budget — so this endpoint defaults to limit=8 and the operator UI calls
// it sequentially with offset=0,8,16,24 to cover the full universe.
//
// Per-row failures never abort the batch. When a row's most recent attempt
// fails but a prior good row exists in KV, the prior values are preserved
// and the row is marked stale so customers still see the last known state.
//
// NEVER returns the OAuth token, client id/secret, capture secret, or raw
// Authorization headers. Per-row diagnostics expose only sanitized HTTP
// status numbers, sanitized failure codes, and a coarse failureStage tag.
app.post('/api/ti/inventory/capture', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      success: false,
      status: 'snapshot_storage_not_configured',
      message: 'SOURCE_SNAPSHOTS_KV binding not set on this deployment.',
    })
  }
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]

  // Accept both `offset`+`limit` and `cursor` for forward-compat.
  const offsetParam = c.req.query('offset') ?? c.req.query('cursor') ?? '0'
  const limitParam = c.req.query('limit') ?? '8'
  const offset = Math.max(0, parseInt(offsetParam, 10) || 0)
  const limit = Math.max(1, Math.min(parseInt(limitParam, 10) || 8, 16))

  const batch = await captureWatchedPartsBatch(env, env.SOURCE_SNAPSHOTS_KV, inputs, offset, limit)
  const merged = await readLatestInventorySnapshot(env.SOURCE_SNAPSHOTS_KV)
  // Phase 20D.4 — defensive filter on read so even a stale snapshot pre-cleanup
  // never surfaces orphan rows.
  const orderableSet = buildCurrentOrderableSet(inputs)
  const filtered = filterSnapshotByOrderableSet(merged?.parts ?? [], orderableSet)
  const summary = summarizeInventorySnapshot(filtered.kept, inputs.length)

  // Phase 21A — append the rows captured in THIS batch to the history table
  // so trend / signal computation has per-capture observations to work with.
  const slice = inputs.slice(batch.offset, batch.offset + batch.attemptedThisBatch)
  const sliceSet = new Set(slice.map(p => p.partNumber.toUpperCase()))
  const historyRows: HistoryRow[] = filtered.kept
    .filter(p => sliceSet.has((p.partNumber || '').toUpperCase()))
    .map(p => toHistoryRow(p, batch.capturedAt))
  const history = await appendInventoryHistory(historyRows, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
  })

  // Phase 21A — recompute and persist signals for THIS batch's parts.
  // Reads the just-written history rows back via D1, classifies each
  // part, and writes one row per part to ti_inventory_price_signal so
  // /api/ti/inventory/signals/latest can serve fast reads. Uses the same
  // signal classification rules as /api/ti/inventory/signals (which
  // continues to compute on the fly for parity).
  const partsThisBatch = slice.map(p => p.partNumber)
  const hintMap = new Map<string, { displayName: string | null; basket: string | null }>()
  for (const p of slice) {
    hintMap.set(p.partNumber.toUpperCase(), {
      displayName: (p as any).displayName ?? null,
      basket: p.basket ?? null,
    })
  }
  const signalRecompute = await recomputeAndPersistSignals(
    env.TI_INVENTORY_HISTORY_DB ?? null,
    env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
    partsThisBatch,
    hintMap,
    30,
  )

  // Phase 21K.2 — record this external capture (GitHub Actions or operator
  // UI) into the same KV state /api/ti/inventory/schedule/status reads from,
  // so cumulativeRowsInserted reflects total D1 history inserts regardless
  // of which path drove them. Best-effort; KV failures never affect the
  // capture response below.
  await recordExternalCapture(env, {
    source: classifyCaptureCallerSource(c.req.header('user-agent')),
    finishedAt: batch.capturedAt,
    offset: batch.offset,
    limit: batch.limit,
    attempted: batch.attemptedThisBatch,
    captured: batch.capturedThisBatch,
    failed: batch.failedThisBatch,
    stale: batch.staleThisBatch,
    rowsInsertedToHistory: history.rowsAppended,
    historyBackend: history.backend,
    signalsPersisted: signalRecompute.persisted,
    status: batch.failedThisBatch === 0 ? 'ok' : 'partial',
  })

  return c.json({
    success: true,
    totalParts: batch.totalParts,
    attemptedThisBatch: batch.attemptedThisBatch,
    capturedThisBatch: batch.capturedThisBatch,
    failedThisBatch: batch.failedThisBatch,
    staleThisBatch: batch.staleThisBatch,
    offset: batch.offset,
    limit: batch.limit,
    nextOffset: batch.nextOffset,
    done: batch.done,
    capturedAt: batch.capturedAt,
    summary,
    diagnostics: {
      snapshotRowsBeforeFilter: batch.snapshotRowsBeforeFilter,
      snapshotRowsAfterFilter: batch.snapshotRowsAfterFilter,
      orphanRowsDropped: batch.orphanRowsDropped,
      orphanPartNumbersDropped: batch.orphanPartNumbersDropped,
      history: {
        backend: history.backend,
        rowsAppended: history.rowsAppended,
        errors: history.errors,
      },
      signals: {
        computed: signalRecompute.computed,
        persisted: signalRecompute.persisted,
        errors: signalRecompute.errors,
      },
    },
  })
})

// POST /api/ti/inventory/capture-all — auth-gated (Phase 20D.1).
// Convenience wrapper that orchestrates sequential batches inside a single
// Worker invocation when subrequest budget allows. If the platform throws
// (subrequest cap, CPU time, etc.) we stop early and return the cumulative
// progress; the operator UI then continues with explicit batched calls
// from `nextOffset`. NEVER exposes secrets or raw TI bodies.
app.post('/api/ti/inventory/capture-all', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false,
      status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      success: false,
      status: 'snapshot_storage_not_configured',
      message: 'SOURCE_SNAPSHOTS_KV binding not set on this deployment.',
    })
  }
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  // Conservative defaults so we stay well under the Worker subrequest cap on
  // every plan tier. 4 batches × 8 parts × ~4 subrequests = ~128 subrequests
  // total; if that's still too much for this deployment, the orchestrator
  // returns early and the operator UI continues with explicit batched calls.
  const limitParam = c.req.query('limit') ?? '8'
  const maxBatchesParam = c.req.query('maxBatches') ?? '4'
  const limit = Math.max(1, Math.min(parseInt(limitParam, 10) || 8, 16))
  const maxBatches = Math.max(1, Math.min(parseInt(maxBatchesParam, 10) || 4, 8))
  const result = await captureAllWatchedPartsInternal(env, env.SOURCE_SNAPSHOTS_KV, inputs, {
    batchLimit: limit,
    maxBatches,
  })
  const merged = await readLatestInventorySnapshot(env.SOURCE_SNAPSHOTS_KV)
  const orderableSet = buildCurrentOrderableSet(inputs)
  const filtered = filterSnapshotByOrderableSet(merged?.parts ?? [], orderableSet)
  const summary = summarizeInventorySnapshot(filtered.kept, inputs.length)
  // Phase 21A — append every part captured in this orchestrated run.
  const capturedAtForHistory = result.capturedAt
  const historyRows: HistoryRow[] = filtered.kept.map(p => toHistoryRow(p, capturedAtForHistory))
  const history = await appendInventoryHistory(historyRows, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
  })
  // Aggregate orphan diagnostics across all batches in this run.
  const orphanRowsDropped = result.batches.reduce((sum, b) => sum + (b.orphanRowsDropped || 0), 0)
  const orphanPartNumbersDropped = Array.from(new Set(result.batches.flatMap(b => b.orphanPartNumbersDropped || [])))
  return c.json({
    success: true,
    totalParts: result.totalParts,
    batches: result.batches,
    nextOffset: result.nextOffset,
    done: result.done,
    capturedAt: result.capturedAt,
    summary,
    diagnostics: {
      snapshotRowsBeforeFilter: result.batches.length > 0 ? result.batches[0].snapshotRowsBeforeFilter : 0,
      snapshotRowsAfterFilter: filtered.kept.length,
      orphanRowsDropped,
      orphanPartNumbersDropped,
      history: {
        backend: history.backend,
        rowsAppended: history.rowsAppended,
        errors: history.errors,
      },
    },
    note: result.done
      ? 'Watched-parts universe captured in a single Worker invocation.'
      : 'Worker stopped early to stay under platform limits — call /api/ti/inventory/capture with the returned nextOffset to continue.',
  })
})

// GET /api/ti/inventory/latest — public, no secret required (Phase 20D).
// Serves the sanitized watched-parts inventory snapshot for the customer-
// facing Inventory tab. Returns ONLY the public shape — no datasheet URL,
// no raw quality/parametric blobs, no pricing-break numbers, no tokens,
// no secrets, no Authorization headers. The capture endpoint is the only
// writer; this endpoint only reads from KV and computes the summary.
//
// Phase 20D.4 — applies a defensive filter against the current watched-
// universe OPN set, so even an unrefreshed KV snapshot containing rows for
// retired OPNs never surfaces in the response. The filter is idempotent
// with the capture-write filter, so the moment the operator runs a fresh
// capture the KV state is also cleaned.
app.get('/api/ti/inventory/latest', async (c) => {
  const env = c.env
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  const orderableSet = buildCurrentOrderableSet(inputs)
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      capturedAt: null,
      parts: [],
      summary: summarizeInventorySnapshot([], inputs.length),
      diagnostics: {
        snapshotRowsBeforeFilter: 0,
        snapshotRowsAfterFilter: 0,
        orphanRowsDropped: 0,
        orphanPartNumbersDropped: [],
      },
    })
  }
  const entry = await readLatestInventorySnapshot(env.SOURCE_SNAPSHOTS_KV)
  if (!entry) {
    return c.json({
      configured: true,
      status: 'no_snapshot',
      capturedAt: null,
      parts: [],
      summary: summarizeInventorySnapshot([], inputs.length),
      diagnostics: {
        snapshotRowsBeforeFilter: 0,
        snapshotRowsAfterFilter: 0,
        orphanRowsDropped: 0,
        orphanPartNumbersDropped: [],
      },
      note: 'Inventory snapshot has not been captured yet. Operator: POST /api/ti/inventory/capture with X-Capture-Secret.',
    })
  }
  const beforeCount = entry.parts.length
  const { kept, dropped } = filterSnapshotByOrderableSet(entry.parts, orderableSet)
  const summary = summarizeInventorySnapshot(kept, inputs.length)
  return c.json({
    configured: true,
    status: 'ok',
    capturedAt: entry.capturedAt,
    parts: kept,
    summary,
    diagnostics: {
      snapshotRowsBeforeFilter: beforeCount,
      snapshotRowsAfterFilter: kept.length,
      orphanRowsDropped: dropped.length,
      orphanPartNumbersDropped: dropped,
    },
  })
})

// GET /api/ti/inventory/history?partNumber=XYZ&days=30 — public, sanitized.
// Returns per-capture history rows for a single watched part. Powers the
// "trend" / "part detail" view in the Inventory tab. Reads from D1 when
// bound, otherwise from the KV-history fallback. Never exposes raw TI
// response bodies, tokens, secrets, or Authorization headers.
app.get('/api/ti/inventory/history', async (c) => {
  const env = c.env
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const days = Math.max(1, Math.min(parseInt(c.req.query('days') || '30', 10) || 30, 90))
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  const orderableSet = buildCurrentOrderableSet(inputs)
  // Defensive: only allow history reads for watched parts. Stops a casual
  // probe from using this endpoint to harvest arbitrary OPN inventory data.
  if (!orderableSet.has(partNumber.toUpperCase())) {
    return c.json({
      success: false,
      status: 'not_in_universe',
      message: 'Part is not in the current watched universe.',
    }, 404)
  }
  const rows = await readPartHistory(partNumber, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
    days,
  })
  const backend: 'd1' | 'kv' | 'none' = env.TI_INVENTORY_HISTORY_DB ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'
  return c.json({
    success: true,
    partNumber,
    days,
    observationCount: rows.length,
    backend,
    rows,
  })
})

// Phase 23A — GET /api/ti/inventory/trends?scope=universe|basket|subcategory|part
// Public, sanitized, read-only. One endpoint feeds the four drill-down
// scopes the Trends sub-tab supports. Server-side aggregates so the UI
// doesn't have to re-derive medians / top-movers / time-series buckets
// for 64 parts on every render.
//
// Query params:
//   scope         universe | basket | subcategory | part   (required)
//   basket        WatchedBasket key   (required when scope=basket|subcategory)
//   subcategory   string              (required when scope=subcategory)
//   partNumber    string              (required when scope=part)
//   window        7d | 30d | 90d | all  (default 30d; 'all' clamps to 90d
//                 since that's the per-part history endpoint's max)
//
// Aggregate scopes return: trackedParts, capturedParts, pricedParts,
// inStockParts, outOfStockParts, stockoutRate, medianLeadTimeWeeks,
// medianInventoryPctChange, medianPricePctChange, signal counts (from
// persisted /signals/latest), timeSeries grouped by 5-minute bucket of
// capturedAt, and four topMovers lists (largest inventory drops/builds,
// largest price increases/decreases — top 5 each).
//
// Part scope returns: identifier metadata + latest/previous/delta for
// inventory and price + the per-capture series so the UI can render an
// exact line chart. The existing /history?partNumber=X endpoint stays
// the simpler raw-rows feed; this one carries the derived deltas + the
// persisted-signal explanation in one round trip.
app.get('/api/ti/inventory/trends', async (c) => {
  const env = c.env
  const scope = (c.req.query('scope') || '').toLowerCase()
  if (!['universe', 'basket', 'subcategory', 'part'].includes(scope)) {
    return c.json({
      success: false, status: 'invalid_payload',
      message: 'scope must be one of: universe, basket, subcategory, part',
    }, 400)
  }
  const windowParam = (c.req.query('window') || '30d').toLowerCase()
  const days = windowParam === '7d' ? 7
    : windowParam === '90d' ? 90
    : windowParam === 'all' ? 90
    : 30
  const watched = getValidatedWatchedParts()
  const basketLabelToKey = Object.fromEntries(
    Object.entries(WATCHED_BASKET_LABEL).map(([key, label]) => [label, key]),
  ) as Record<string, string>
  const basketParam = (c.req.query('basket') || '').trim()
  // Accept either the basket key (e.g. 'power_management') OR the human
  // label (e.g. 'Power Management') so the UI doesn't have to translate.
  const basketKey = basketParam in WATCHED_BASKET_LABEL
    ? basketParam
    : (basketLabelToKey[basketParam] ?? basketParam)
  const subcategoryParam = (c.req.query('subcategory') || '').trim()
  const partNumberParam = (c.req.query('partNumber') || '').trim()
  // Resolve scope → in-scope WatchedPart subset.
  let inScope = watched
  if (scope === 'basket') {
    if (!basketKey) {
      return c.json({ success: false, status: 'invalid_payload', message: 'basket query param required for scope=basket' }, 400)
    }
    inScope = watched.filter(p => p.basket === basketKey)
  } else if (scope === 'subcategory') {
    if (!basketKey || !subcategoryParam) {
      return c.json({ success: false, status: 'invalid_payload', message: 'basket and subcategory query params required for scope=subcategory' }, 400)
    }
    inScope = watched.filter(p => p.basket === basketKey && (p.subcategory ?? null) === subcategoryParam)
  } else if (scope === 'part') {
    if (!partNumberParam) {
      return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required for scope=part' }, 400)
    }
    inScope = watched.filter(p => p.preferredOrderablePartNumber.toUpperCase() === partNumberParam.toUpperCase())
    if (inScope.length === 0) {
      return c.json({ success: false, status: 'not_in_universe', message: 'Part is not in the validated watched universe.' }, 404)
    }
  }
  if (inScope.length === 0) {
    return c.json({
      success: true,
      scope, basket: basketParam || null, subcategory: subcategoryParam || null,
      partNumber: partNumberParam || null,
      window: windowParam, windowDays: days,
      backend: 'd1',
      message: 'No watched parts matched the requested scope.',
    })
  }
  // Read history for the in-scope OPNs in a single D1 round-trip.
  const partNumbers = inScope.map(p => p.preferredOrderablePartNumber)
  const history = await readUniverseHistoryByPart(partNumbers, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
    days,
  })
  // Pull persisted signals once; filter per-scope below.
  const allPersisted = await getLatestSignalsFromD1(env.TI_INVENTORY_HISTORY_DB ?? null)
  const persistedByOpn = new Map(allPersisted.map(s => [s.orderablePartNumber.toUpperCase(), s]))
  const backend: 'd1' | 'kv' | 'none' = env.TI_INVENTORY_HISTORY_DB
    ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'

  // ── Part scope ────────────────────────────────────────────────────────
  if (scope === 'part') {
    const part = inScope[0]
    const opn = part.preferredOrderablePartNumber
    const rows = (history.get(opn.toUpperCase()) ?? []).slice()
    // Server side already returns rows ascending by capturedAt; double-sort defensively.
    rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const latest = rows[rows.length - 1] ?? null
    const previous = rows.length >= 2 ? rows[rows.length - 2] : null
    const sig = persistedByOpn.get(opn.toUpperCase()) ?? null
    const series = rows.map(r => ({
      capturedAt: r.capturedAt,
      quantityAvailable: r.quantityAvailable,
      normalizedUnitPrice: r.normalizedUnitPrice,
      currency: r.currency,
      leadTimeWeeks: r.leadTimeWeeks,
      pricingAvailability: r.pricingAvailability,
    }))
    const invDelta = (latest?.quantityAvailable != null && previous?.quantityAvailable != null)
      ? latest.quantityAvailable - previous.quantityAvailable : null
    const invPctDelta = (latest?.quantityAvailable != null && previous?.quantityAvailable != null && previous.quantityAvailable !== 0)
      ? ((latest.quantityAvailable - previous.quantityAvailable) / Math.abs(previous.quantityAvailable)) * 100
      : (latest?.quantityAvailable === 0 && previous?.quantityAvailable === 0 ? 0 : null)
    const priceDelta = (latest?.normalizedUnitPrice != null && previous?.normalizedUnitPrice != null)
      ? latest.normalizedUnitPrice - previous.normalizedUnitPrice : null
    const pricePctDelta = (latest?.normalizedUnitPrice != null && previous?.normalizedUnitPrice != null && previous.normalizedUnitPrice !== 0)
      ? ((latest.normalizedUnitPrice - previous.normalizedUnitPrice) / Math.abs(previous.normalizedUnitPrice)) * 100
      : null
    return c.json({
      success: true,
      scope: 'part',
      window: windowParam, windowDays: days,
      backend,
      partNumber: opn,
      genericPartNumber: part.genericPartNumber,
      displayName: part.displayName,
      basket: WATCHED_BASKET_LABEL[part.basket],
      subcategory: part.subcategory ?? null,
      latestQuantityAvailable: latest?.quantityAvailable ?? null,
      previousQuantityAvailable: previous?.quantityAvailable ?? null,
      inventoryDelta: invDelta,
      inventoryPctDelta: invPctDelta,
      latestNormalizedUnitPrice: latest?.normalizedUnitPrice ?? null,
      previousNormalizedUnitPrice: previous?.normalizedUnitPrice ?? null,
      currency: latest?.currency ?? null,
      priceDelta,
      pricePctDelta,
      leadTimeWeeks: latest?.leadTimeWeeks ?? null,
      signalType: sig?.signalType ?? 'insufficient_history',
      explanation: sig?.explanation ?? '',
      observationsCount: rows.length,
      latestCapturedAt: latest?.capturedAt ?? null,
      series,
    })
  }

  // ── Aggregate scopes (universe | basket | subcategory) ───────────────
  const inScopeOpnSet = new Set(partNumbers.map(p => p.toUpperCase()))
  // Latest row per part inside the window (for in-stock / lead-time medians).
  type LatestRow = {
    opn: string; qty: number | null; price: number | null;
    leadTimeWeeks: number | null; firstQty: number | null;
    firstPrice: number | null; rowsCount: number;
  }
  const latestByOpn: LatestRow[] = []
  for (const opn of partNumbers) {
    const rows = history.get(opn.toUpperCase()) ?? []
    if (rows.length === 0) {
      latestByOpn.push({ opn, qty: null, price: null, leadTimeWeeks: null, firstQty: null, firstPrice: null, rowsCount: 0 })
      continue
    }
    const sorted = rows.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const first = sorted[0]
    const latest = sorted[sorted.length - 1]
    latestByOpn.push({
      opn,
      qty: latest.quantityAvailable ?? null,
      price: latest.normalizedUnitPrice ?? null,
      leadTimeWeeks: latest.leadTimeWeeks ?? null,
      firstQty: first.quantityAvailable ?? null,
      firstPrice: first.normalizedUnitPrice ?? null,
      rowsCount: sorted.length,
    })
  }
  const trackedParts = inScope.length
  const capturedParts = latestByOpn.filter(r => r.rowsCount > 0).length
  const pricedParts = latestByOpn.filter(r => r.price != null).length
  const inStockParts = latestByOpn.filter(r => r.qty != null && r.qty > 0).length
  const outOfStockParts = latestByOpn.filter(r => r.qty === 0).length
  const stockoutRate = capturedParts > 0 ? outOfStockParts / capturedParts : null
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null
    const sorted = xs.slice().sort((a, b) => a - b)
    const m = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
  }
  const medianLeadTimeWeeks = median(latestByOpn.map(r => r.leadTimeWeeks).filter((v): v is number => Number.isFinite(v as number)))
  const invPctChanges = latestByOpn
    .filter(r => r.qty != null && r.firstQty != null && r.firstQty !== 0)
    .map(r => ((r.qty! - r.firstQty!) / Math.abs(r.firstQty!)) * 100)
  const medianInventoryPctChange = median(invPctChanges)
  const pricePctChanges = latestByOpn
    .filter(r => r.price != null && r.firstPrice != null && r.firstPrice !== 0)
    .map(r => ((r.price! - r.firstPrice!) / Math.abs(r.firstPrice!)) * 100)
  const medianPricePctChange = median(pricePctChanges)

  // Persisted-signal counts for the in-scope subset.
  const inScopeSignals = allPersisted.filter(s => inScopeOpnSet.has(s.orderablePartNumber.toUpperCase()))
  const signalCount = (t: string) => inScopeSignals.filter(s => s.signalType === t).length
  const shortagePressureCount = signalCount('shortage_pressure')
  const oversupplyPressureCount = signalCount('oversupply_pressure')
  const inventoryTighteningCount = signalCount('inventory_tightening')
  const supplyEasingCount = signalCount('supply_easing')

  // Time series — bucket by 5-minute window of capturedAt so all batches
  // of one capture cycle group together.
  const BUCKET_MS = 5 * 60 * 1000
  type BucketRow = { ts: number; qtys: number[]; prices: number[]; partsCaptured: number }
  const buckets = new Map<number, BucketRow>()
  for (const opn of partNumbers) {
    const rows = history.get(opn.toUpperCase()) ?? []
    for (const r of rows) {
      const t = Date.parse(r.capturedAt)
      if (!Number.isFinite(t)) continue
      const bucket = Math.floor(t / BUCKET_MS) * BUCKET_MS
      let row = buckets.get(bucket)
      if (!row) { row = { ts: bucket, qtys: [], prices: [], partsCaptured: 0 }; buckets.set(bucket, row) }
      row.partsCaptured += 1
      if (r.quantityAvailable != null) row.qtys.push(r.quantityAvailable)
      if (r.normalizedUnitPrice != null) row.prices.push(r.normalizedUnitPrice)
    }
  }
  const timeSeries = Array.from(buckets.values())
    .sort((a, b) => a.ts - b.ts)
    .map(b => ({
      bucketAt: new Date(b.ts).toISOString(),
      partsCaptured: b.partsCaptured,
      medianQuantity: median(b.qtys),
      medianNormalizedPrice: median(b.prices),
    }))

  // Top movers — derived from persisted signals (latest-vs-previous
  // delta), filtered to in-scope OPNs. Top 5 each direction.
  const sigByOpn = new Map(inScopeSignals.map(s => [s.orderablePartNumber.toUpperCase(), s]))
  type Mover = {
    partNumber: string; displayName: string | null; basket: string | null;
    subcategory: string | null;
    latestQuantityAvailable: number | null; previousQuantityAvailable: number | null;
    inventoryPctDelta: number | null;
    latestNormalizedUnitPrice: number | null; previousNormalizedUnitPrice: number | null;
    pricePctDelta: number | null;
  }
  const moverFromPart = (p: typeof watched[number]): Mover | null => {
    const sig = sigByOpn.get(p.preferredOrderablePartNumber.toUpperCase())
    if (!sig) return null
    return {
      partNumber: p.preferredOrderablePartNumber,
      displayName: p.displayName ?? null,
      basket: WATCHED_BASKET_LABEL[p.basket],
      subcategory: p.subcategory ?? null,
      latestQuantityAvailable: sig.latestQuantityAvailable,
      previousQuantityAvailable: sig.previousQuantityAvailable,
      inventoryPctDelta: sig.inventoryPctDelta,
      latestNormalizedUnitPrice: sig.latestNormalizedUnitPrice,
      previousNormalizedUnitPrice: sig.previousNormalizedUnitPrice,
      pricePctDelta: sig.pricePctDelta,
    }
  }
  const moverPool = inScope.map(moverFromPart).filter((m): m is Mover => m !== null)
  const topInventoryDrops = moverPool
    .filter(m => m.inventoryPctDelta != null && m.inventoryPctDelta < 0)
    .sort((a, b) => (a.inventoryPctDelta ?? 0) - (b.inventoryPctDelta ?? 0))
    .slice(0, 5)
  const topInventoryBuilds = moverPool
    .filter(m => m.inventoryPctDelta != null && m.inventoryPctDelta > 0)
    .sort((a, b) => (b.inventoryPctDelta ?? 0) - (a.inventoryPctDelta ?? 0))
    .slice(0, 5)
  const topPriceIncreases = moverPool
    .filter(m => m.pricePctDelta != null && m.pricePctDelta > 0)
    .sort((a, b) => (b.pricePctDelta ?? 0) - (a.pricePctDelta ?? 0))
    .slice(0, 5)
  const topPriceDecreases = moverPool
    .filter(m => m.pricePctDelta != null && m.pricePctDelta < 0)
    .sort((a, b) => (a.pricePctDelta ?? 0) - (b.pricePctDelta ?? 0))
    .slice(0, 5)

  return c.json({
    success: true,
    scope,
    basket: scope === 'basket' || scope === 'subcategory' ? (WATCHED_BASKET_LABEL[basketKey as keyof typeof WATCHED_BASKET_LABEL] ?? basketKey) : null,
    subcategory: scope === 'subcategory' ? subcategoryParam : null,
    window: windowParam, windowDays: days,
    backend,
    trackedParts,
    capturedParts,
    pricedParts,
    inStockParts,
    outOfStockParts,
    stockoutRate,
    medianLeadTimeWeeks,
    medianInventoryPctChange,
    medianPricePctChange,
    shortagePressureCount,
    oversupplyPressureCount,
    inventoryTighteningCount,
    supplyEasingCount,
    timeSeries,
    topMovers: {
      inventoryDrops: topInventoryDrops,
      inventoryBuilds: topInventoryBuilds,
      priceIncreases: topPriceIncreases,
      priceDecreases: topPriceDecreases,
    },
  })
})

// GET /api/ti/inventory/signals — public, sanitized.
// Computes shortage / oversupply / tightening signals for every watched part
// from the persisted history. Returns insufficient_history per part until at
// least 3 captures have accumulated. Never exposes secrets.
app.get('/api/ti/inventory/signals', async (c) => {
  const env = c.env
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  const partNumbers = inputs.map(p => p.partNumber)
  const days = Math.max(1, Math.min(parseInt(c.req.query('days') || '30', 10) || 30, 90))
  const history = await readUniverseHistoryByPart(partNumbers, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
    days,
  })
  // Make sure every watched part has an entry, even if history is empty —
  // the UI then shows insufficient_history rather than dropping the row.
  for (const p of inputs) {
    const key = p.partNumber.toUpperCase()
    if (!history.has(key)) history.set(key, [])
  }
  const signals = computeWatchedSignals(history)
  // Decorate with display name + basket from the watched-parts catalog so
  // the UI can render without an extra fetch.
  const inputByOpn = new Map(inputs.map(p => [p.partNumber.toUpperCase(), p]))
  const decorated = signals.map(s => {
    const w = inputByOpn.get(s.orderablePartNumber.toUpperCase())
    return {
      ...s,
      basket: s.basket ?? (w?.basket ?? null),
      displayName: w?.displayName ?? null,
    }
  })
  // Add empty rows for any watched part the signal engine didn't emit (i.e.
  // no history at all yet) so the dashboard summary counts every part.
  const haveOpn = new Set(decorated.map(s => s.orderablePartNumber.toUpperCase()))
  for (const p of inputs) {
    const key = p.partNumber.toUpperCase()
    if (!haveOpn.has(key)) {
      decorated.push({
        orderablePartNumber: p.partNumber,
        genericPartNumber: p.genericPartNumberHint ?? null,
        basket: p.basket ?? null,
        asOf: new Date().toISOString(),
        observationCount: 0,
        inventoryDelta1d: null,
        inventoryDelta7d: null,
        inventoryDelta30d: null,
        inventoryPctDelta1d: null,
        inventoryPctDelta7d: null,
        inventoryPctDelta30d: null,
        priceDelta1d: null,
        priceDelta7d: null,
        priceDelta30d: null,
        pricePctDelta1d: null,
        pricePctDelta7d: null,
        pricePctDelta30d: null,
        leadTimeDelta: null,
        signalType: 'insufficient_history',
        signalStrength: 'none',
        explanation: 'No captures recorded yet for this part.',
        confidence: 0,
        displayName: p.displayName ?? null,
      })
    }
  }
  const summary = summarizeSignals(decorated as any)
  const backend: 'd1' | 'kv' | 'none' = env.TI_INVENTORY_HISTORY_DB ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'
  return c.json({
    success: true,
    days,
    backend,
    summary,
    signals: decorated,
  })
})

// GET /api/ti/inventory/signals/latest — Phase 21A public, sanitized.
// Reads the persisted ti_inventory_price_signal table and returns one row
// per watched part — synthesizing insufficient_history rows for parts that
// haven't accumulated enough history yet to be classified. Differs from
// /api/ti/inventory/signals only in that this path reads from the
// persisted signal table (one D1 query) instead of recomputing from raw
// history on each call. Both paths agree on the classification rules.
app.get('/api/ti/inventory/signals/latest', async (c) => {
  const env = c.env
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  const persisted = await getLatestSignalsFromD1(env.TI_INVENTORY_HISTORY_DB ?? null)
  const persistedByOpn = new Map(persisted.map(s => [s.orderablePartNumber.toUpperCase(), s]))
  const inputByOpn = new Map(inputs.map(p => [p.partNumber.toUpperCase(), p]))
  const decorated = inputs.map(p => {
    const key = p.partNumber.toUpperCase()
    const sig = persistedByOpn.get(key)
    if (sig) {
      return {
        signalType: sig.signalType,
        signalStrength: sig.signalStrength,
        partNumber: sig.orderablePartNumber,
        genericPartNumber: sig.genericPartNumber ?? p.genericPartNumberHint ?? null,
        basket: sig.basket ?? p.basket ?? null,
        displayName: sig.displayName ?? p.displayName ?? null,
        latestQuantityAvailable: sig.latestQuantityAvailable,
        previousQuantityAvailable: sig.previousQuantityAvailable,
        inventoryDelta: sig.inventoryDelta,
        inventoryPctDelta: sig.inventoryPctDelta,
        latestNormalizedUnitPrice: sig.latestNormalizedUnitPrice,
        previousNormalizedUnitPrice: sig.previousNormalizedUnitPrice,
        priceDelta: sig.priceDelta,
        pricePctDelta: sig.pricePctDelta,
        observationsCount: sig.observationsCount,
        explanation: sig.explanation,
        confidence: sig.confidence,
        asOf: sig.asOf,
      }
    }
    return {
      signalType: 'insufficient_history' as const,
      signalStrength: 'none' as const,
      partNumber: p.partNumber,
      genericPartNumber: p.genericPartNumberHint ?? null,
      basket: p.basket ?? null,
      displayName: p.displayName ?? null,
      latestQuantityAvailable: null,
      previousQuantityAvailable: null,
      inventoryDelta: null,
      inventoryPctDelta: null,
      latestNormalizedUnitPrice: null,
      previousNormalizedUnitPrice: null,
      priceDelta: null,
      pricePctDelta: null,
      observationsCount: 0,
      explanation: 'No persisted signal yet for this part.',
      confidence: 0,
      asOf: new Date().toISOString(),
    }
  })
  // Sort meaningful signals first.
  const order: Record<string, number> = {
    shortage_pressure: 0,
    oversupply_pressure: 1,
    inventory_tightening: 2,
    supply_easing: 3,
    price_only_pressure: 4,
    normal: 5,
    insufficient_history: 6,
  }
  decorated.sort((a, b) => (order[a.signalType] ?? 9) - (order[b.signalType] ?? 9) || a.partNumber.localeCompare(b.partNumber))
  // Summary using same shape as /api/ti/inventory/signals so the UI can
  // share render code. Phase 21A.3 — pass the full row shape so the
  // summary can compute priceUnavailableCount + inventoryOnlySignalCount.
  const summary = summarizeSignals(decorated)
  const backend: 'd1' | 'kv' | 'none' = env.TI_INVENTORY_HISTORY_DB ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'
  return c.json({
    success: true,
    backend,
    summary,
    signals: decorated,
  })
})

// GET /api/ti/inventory/history/summary — Phase 21A public, sanitized.
// Universe-level history depth + signal counts. Powers the dashboard
// header that tells the customer "X observations per part — Y more needed
// before signals fire". One D1 round-trip aggregates per-part observation
// counts; signal counts come from the persisted signal table.
app.get('/api/ti/inventory/history/summary', async (c) => {
  const env = c.env
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  const summary = await getInventoryHistorySummary(
    env.TI_INVENTORY_HISTORY_DB ?? null,
    env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
    inputs.map(p => p.partNumber),
  )
  return c.json({
    success: true,
    ...summary,
  })
})

// Phase 21D — GET /api/ti/inventory/pricing-diagnostic?partNumber=XYZ
// Auth-gated diagnostic that returns SANITIZED shape evidence about the
// TI Store Inventory & Pricing response: response top-level keys, the
// product-level keys, a candidate-key probe over alternate field names
// (priceBreaks / prices / priceList / priceTier / priceTiers /
// productPricing / priceBreakdowns / unitPrices), the parsed pricing-array
// length, the first-break field names, and the parser's normalized output.
// Never returns the raw TI body, the OAuth token, the Authorization header,
// or the client id/secret. Lets the operator distinguish "TI returned no
// pricing for this part" from "our parser is looking under the wrong key".
app.get('/api/ti/inventory/pricing-diagnostic', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const report = await fetchTiInventoryPricingDebug(env, partNumber)
  return c.json({ success: report.status === 'ok', ...report })
})

// Phase 21E — GET /api/ti/inventory/signal-simulator
// Auth-gated, READ-ONLY. Runs the production computeInventoryPriceSignal
// classifier against five SYNTHETIC scenarios so the operator can prove
// shortage/oversupply/tightening/easing/price-only logic works end-to-end
// without waiting for real-world movement and without writing anything
// to D1 or KV. The response is clearly labelled `synthetic: true` and
// every row carries scenario / inputs / expected vs actual classification.
//
// Hard restrictions: never persists, never calls TI Store, never returns
// any TI body or token. The "data" is hard-coded inside this handler.
app.get('/api/ti/inventory/signal-simulator', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  // Build a 3-row HistoryRow trace per scenario so the rolling-window
  // classifier (uses r7d) has something to compare against. Times are
  // anchored to "now" so the latest row is at t=0, the prior baseline
  // sits ≥ 7 days back, and a middle row keeps the t-1d window populated.
  const now = Date.now()
  const ms = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString()
  type Scenario = {
    id: string
    label: string
    expectedSignalType: string
    rationale: string
    previousInventory: number
    latestInventory: number
    previousPrice: number | null
    latestPrice: number | null
  }
  const scenarios: Scenario[] = [
    { id: 'A', label: 'Shortage pressure',     expectedSignalType: 'shortage_pressure',     rationale: 'Inventory down 80%, price up 30% — likely shortage.',         previousInventory: 100, latestInventory: 20,   previousPrice: 10, latestPrice: 13 },
    { id: 'B', label: 'Oversupply pressure',   expectedSignalType: 'oversupply_pressure',   rationale: 'Inventory up 10×, price down 20% — likely oversupply.',      previousInventory: 100, latestInventory: 1000, previousPrice: 10, latestPrice: 8 },
    { id: 'C', label: 'Inventory tightening',  expectedSignalType: 'inventory_tightening',  rationale: 'Inventory down 80% with price flat — tightening, no clear price pressure.', previousInventory: 100, latestInventory: 20,   previousPrice: 10, latestPrice: 10 },
    { id: 'D', label: 'Supply easing',         expectedSignalType: 'supply_easing',         rationale: 'Inventory up 5× with price flat — supply easing.',           previousInventory: 100, latestInventory: 500,  previousPrice: 10, latestPrice: 10 },
    { id: 'E', label: 'Price-only pressure',   expectedSignalType: 'price_only_pressure',   rationale: 'Inventory unchanged, price up 20% — price-led signal only.', previousInventory: 100, latestInventory: 100,  previousPrice: 10, latestPrice: 12 },
  ]
  const buildRow = (qty: number, price: number | null, capturedAt: string): HistoryRow => ({
    capturedAt,
    orderablePartNumber: '__SYNTHETIC__',
    genericPartNumber: null,
    basket: null,
    category: null,
    subcategory: null,
    displayName: null,
    demandProxyType: null,
    dashboardPriority: null,
    quantityAvailable: qty,
    pricingAvailability: price != null ? 'available' : 'unavailable',
    priceAvailable: price != null,
    currency: price != null ? 'USD' : null,
    normalizedUnitPrice: price,
    normalizedPriceQty: price != null ? 1000 : null,
    priceBreaks: price != null ? [{ breakQuantity: 1000, unitPrice: price, currency: 'USD' }] : null,
    orderLimit: null,
    leadTimeWeeks: null,
    lifecycleStatus: null,
    okayToOrder: null,
    supplyStatus: null,
    inventorySignal: null,
    pricingSignal: null,
    leadTimeSignal: null,
    sourceConfidence: null,
    captureStatus: 'ok',
    sourceInventory: 'synthetic_simulator',
    sourcePricing: price != null ? 'direct_ti_store_price' : 'unavailable',
    warnings: [],
  })
  const results = scenarios.map(s => {
    // Three captures: t-8d (baseline), t-1d (mid; mirrors baseline so the
    // 1d window has data without polluting the 7d delta), t-0 (latest).
    const rows: HistoryRow[] = [
      buildRow(s.previousInventory, s.previousPrice, ms(8)),
      buildRow(s.previousInventory, s.previousPrice, ms(1)),
      buildRow(s.latestInventory,  s.latestPrice,  ms(0)),
    ]
    const sig = computeInventoryPriceSignal(rows)
    const matches = sig.signalType === s.expectedSignalType
    return {
      scenario: s.id,
      label: s.label,
      previousInventory: s.previousInventory,
      latestInventory: s.latestInventory,
      previousPrice: s.previousPrice,
      latestPrice: s.latestPrice,
      inventoryPctDelta: sig.inventoryPctDelta7d,
      pricePctDelta: sig.pricePctDelta7d,
      expectedSignalType: s.expectedSignalType,
      actualSignalType: sig.signalType,
      actualSignalStrength: sig.signalStrength,
      actualConfidence: sig.confidence,
      explanation: sig.explanation,
      rationale: s.rationale,
      matches,
    }
  })
  return c.json({
    success: true,
    synthetic: true,
    note: 'Hard-coded synthetic scenarios — no TI Store call, no D1/KV write. For QA / customer demo only.',
    scenarios: results,
    summary: {
      total: results.length,
      matches: results.filter(r => r.matches).length,
    },
  })
})

// Phase 23B — GET /api/ti/universe/catalog/probe
// Auth-gated ONE-SHOT diagnostic against the TI Store full-catalog
// endpoint. Returns sanitized shape evidence only (top-level keys,
// pagination probe, sample-product field-presence flags, totalCount-
// like values, support recommendations); NEVER returns the raw response
// body, the OAuth token, the Authorization header, or the client id /
// client secret. Used to decide whether full-universe scaling should
// use catalog snapshots or stick with the OPN-level batch path.
//
// Hard restrictions: never mutates D1 / KV / R2; never expands the
// active 64-part watched universe; never writes capture history.
// Operator runs at most once per probe — daily capture continues to use
// /api/ti/inventory/capture against the validated 64 parts only.
app.get('/api/ti/universe/catalog/probe', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const probe = await fetchTiCatalogProbe(env)
  return c.json({
    success: probe.status === 'ok',
    note: 'One-shot diagnostic. Not production ingestion. Does not expand the active 64-part watched universe. Does not mutate D1 / KV / R2. Used to decide whether full-universe scaling should be catalog-driven or OPN-batch-driven.',
    ...probe,
  })
})

// Phase 23C — POST /api/ti/universe/catalog/capture
// **EXPERIMENTAL — DO NOT USE** (Phase 23C.1).
//
// Reason: TI rate-limits the /v2/store/products/catalog endpoint
// aggressively (HTTP 429 after a single probe + capture pair). A retry
// burns scarce quota without recovering, and even when the fetch
// succeeds the Worker memory footprint during parse is tight (~150MB
// peak vs the 128MB Workers limit). Use the chunked-ingest path
// instead — see the three endpoints below this one.
//
// Original behaviour (still implemented for reference): one-shot
// full-catalog ingest. Fetches /v2/store/products/catalog (~50MB / ~72k
// products), R2-archives the raw body if the binding is bound, parses
// the catalog, upserts the latest per-OPN + per-GPN state into D1, and
// inserts one snapshot-run summary row.
//
// Hard restrictions (matched in tiCatalogIngest.ts):
//   - NEVER expands the active 64-part watched universe; the daily
//     /inventory/capture endpoint stays on /v2/store/products/{partNumber}.
//   - NEVER calls Product Info or any per-OPN endpoint; catalog only.
//   - NEVER returns the raw response body, the OAuth token, or the
//     Authorization header.
//   - Operator-only — must not be scheduled yet, must not be called
//     repeatedly. Designed for an explicit one-shot run.
//
// Pre-flight requirements:
//   - SNAPSHOT_CAPTURE_SECRET set + provided in X-Capture-Secret header.
//   - TI Product Information + Store API entitlement
//     (TI_STORE_API_ENABLED='true').
//   - D1 binding TI_INVENTORY_HISTORY_DB present + migration 0003
//     applied (creates ti_catalog_snapshot_run, ti_catalog_latest_opn,
//     ti_catalog_latest_gpn).
//   - R2 binding TI_CATALOG_SNAPSHOTS_R2 OPTIONAL — endpoint degrades
//     gracefully and returns rawR2Key: null + a warning when absent.
app.post('/api/ti/universe/catalog/capture', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const result = await captureTiCatalogSnapshot(env as any)
  return c.json({
    success: result.success,
    note: 'One-shot full-catalog ingest. NOT scheduled. Does not change the 64-part watched universe; daily capture continues unchanged.',
    capturedAt: result.capturedAt,
    source: result.source,
    totalOpns: result.totalOpns,
    totalGpns: result.totalGpns,
    pricedOpns: result.pricedOpns,
    inStockOpns: result.inStockOpns,
    outOfStockOpns: result.outOfStockOpns,
    rawR2Key: result.rawR2Key,
    bodyByteSize: result.bodyByteSize,
    d1RowsUpserted: result.d1RowsUpserted,
    gpnRowsUpserted: result.gpnRowsUpserted,
    parsedOk: result.parsedOk,
    errors: result.errors,
    warnings: result.warnings,
    diagnostics: result.diagnostics,
  })
})

// ────────────────────────────────────────────────────────────────────────
// Phase 23C.1 — chunked catalog-ingest endpoints
//
// The TI catalog endpoint (/v2/store/products/catalog) is aggressively
// rate-limited (HTTP 429 after even a single probe + capture pair).
// Fetching the catalog from a Worker AND parsing it AND upserting 72k
// rows in one invocation also flirts with the 128MB Worker memory cap.
//
// New architecture: a GitHub Action runner (.github/workflows/
// ti-catalog-universe-ingest.yml) fetches the catalog ONCE, parses
// the 50MB JSON locally (no Worker memory pressure), splits it into
// 500-product chunks, POSTs each chunk to /api/ti/universe/catalog/
// ingest-chunk, then calls /finalize and /status. Worker stays small.
// ────────────────────────────────────────────────────────────────────────

// POST /api/ti/universe/catalog/ingest-chunk — auth-gated.
// Accepts a single pre-parsed chunk of products (≤500) and upserts
// them into ti_catalog_latest_opn. Does NOT call TI; relies on the
// chunk that was already fetched + parsed by the GH Action runner.
app.post('/api/ti/universe/catalog/ingest-chunk', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({ success: false, status: 'capture_secret_not_configured', message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.' })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot upsert catalog rows.' }, 500)
  }
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, status: 'invalid_payload', message: 'Body must be JSON: { runId, capturedAt, chunkIndex, totalChunks, products[] }' }, 400)
  }
  const runId = typeof body?.runId === 'string' ? body.runId : ''
  const capturedAt = typeof body?.capturedAt === 'string' ? body.capturedAt : ''
  const chunkIndex = Number.isFinite(body?.chunkIndex) ? Math.trunc(body.chunkIndex) : -1
  const totalChunks = Number.isFinite(body?.totalChunks) ? Math.trunc(body.totalChunks) : -1
  const products = Array.isArray(body?.products) ? body.products : null
  if (!runId || !capturedAt || chunkIndex < 0 || totalChunks <= 0 || !products) {
    return c.json({ success: false, status: 'invalid_payload', message: 'Missing or invalid runId / capturedAt / chunkIndex / totalChunks / products[].' }, 400)
  }
  // Phase 23C.4 — tighten the chunk-size cap from 1000 to 200 to keep
  // every Worker invocation comfortably inside D1 free-tier per-call
  // budgets and the ~128MB memory ceiling. Operators can opt past the
  // cap with `?allow_large_chunk=1` (or { allowLargeChunk: true } in
  // the body) when knowingly testing on a paid tier; the workflow
  // never sets that flag.
  const allowLarge = c.req.query('allow_large_chunk') === '1' || body?.allowLargeChunk === true
  const chunkCap = allowLarge ? 1000 : 200
  if (products.length > chunkCap) {
    return c.json({
      success: false,
      status: 'chunk_too_large',
      message: `Chunk size ${products.length} exceeds the ${chunkCap}-product safety cap.${allowLarge ? '' : ' Set allow_large_chunk=1 (paid tier) to bypass.'}`,
      cap: chunkCap,
      allowLargeChunk: allowLarge,
    }, 413)
  }
  const result = await ingestCatalogChunk(env.TI_INVENTORY_HISTORY_DB as any, {
    runId, capturedAt, chunkIndex, totalChunks, products,
  })
  return c.json(result)
})

// POST /api/ti/universe/catalog/finalize — auth-gated.
// Rebuilds ti_catalog_latest_gpn from ti_catalog_latest_opn (in-SQL
// GROUP BY — never pulls 72k rows into Worker memory) and inserts one
// ti_catalog_snapshot_run summary row. Called by the GH Action after
// all chunks finish ingesting.
app.post('/api/ti/universe/catalog/finalize', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({ success: false, status: 'capture_secret_not_configured', message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.' })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot finalize.' }, 500)
  }
  // Optional metadata for the snapshot_run row — the GH Action passes
  // bodyByteSize and rawR2Key so the operator can correlate the run with
  // the raw archive (if any) and the local download size.
  let body: any = {}
  try { body = await c.req.json() } catch { /* allow empty body */ }
  const capturedAt = typeof body?.capturedAt === 'string' ? body.capturedAt : new Date().toISOString()
  const source = typeof body?.source === 'string' ? body.source : 'ti_store_v2_catalog_chunked'
  const rawR2Key = typeof body?.rawR2Key === 'string' ? body.rawR2Key : null
  const bodyByteSize = Number.isFinite(body?.bodyByteSize) ? Math.trunc(body.bodyByteSize) : null

  const errors: string[] = []
  const gpnRowsUpserted = await rebuildGpnFromOpn(env.TI_INVENTORY_HISTORY_DB as any, capturedAt, errors)
  // Phase 24A.1 — chain the enrichment rebuild so future captures land
  // with cheapest_opn / highest_inventory_opn / lifecycle_summary / median
  // already populated. Pure SQL, four UPDATE-FROM-CTE statements; failures
  // here roll into the same errors[] array but do not block finalize from
  // returning, so the operator can also call /gpn/rebuild-enrichment
  // standalone if the chain failed.
  const enrichment = await rebuildGpnEnrichment(env.TI_INVENTORY_HISTORY_DB as any)
  for (const e of enrichment.errors) errors.push(e)
  // Phase 24C.1 — rebuild rollups per-subcategory (CPU-safe, resumable).
  // Loop sequentially through every canonical subcategory; failures on
  // one don't block the next. Operator can finish with the standalone
  // /rollups/rebuild?mode=run endpoint if any subcategory failed here.
  const rollupErrors: string[] = []
  let rollupRebuiltRows = 0
  let rollupSubcatsProcessed = 0
  try {
    const predicates = listSubcategoryPredicates()
    await clearLatestRollups(env.TI_INVENTORY_HISTORY_DB as any)
    for (const p of predicates) {
      const r = await rebuildOneSubcategory(env.TI_INVENTORY_HISTORY_DB as any, p)
      rollupSubcatsProcessed += 1
      if (r.upserted) rollupRebuiltRows += 1
      for (const e of r.errors) rollupErrors.push(e)
    }
  } catch (e: any) {
    rollupErrors.push(`rollup_loop:${(e?.message || 'failed').slice(0, 150)}`)
  }
  for (const e of rollupErrors) errors.push(e)
  // Append a history snapshot row per subcategory just landed.
  const rollupHistory = await appendRollupHistory(env.TI_INVENTORY_HISTORY_DB as any, { snapshotRunId: null })
  for (const e of rollupHistory.errors) errors.push(e)
  const counts = await readSnapshotCounts(env.TI_INVENTORY_HISTORY_DB as any)
  const summary = {
    totalOpns: counts.totalOpns,
    totalGpns: counts.totalGpns,
    pricedOpns: counts.pricedOpns,
    inStockOpns: counts.inStockOpns,
    outOfStockOpns: counts.outOfStockOpns,
    parsedOk: errors.length === 0,
    errors,
  }
  await insertSnapshotRunRow(env.TI_INVENTORY_HISTORY_DB as any, {
    capturedAt, source, rawR2Key, bodyByteSize, summary,
  })
  return c.json({
    success: errors.length === 0,
    capturedAt,
    source,
    gpnRowsUpserted,
    enrichment: {
      enrichedGpns: enrichment.enrichedGpns,
      rowsUpdated: enrichment.rowsUpdated,
      changesByField: enrichment.changesByField,
      nullMedianCount: enrichment.nullMedianCount,
      nullCheapestCount: enrichment.nullCheapestCount,
      nullHighestInventoryCount: enrichment.nullHighestInventoryCount,
      nullLifecycleSummaryCount: enrichment.nullLifecycleSummaryCount,
    },
    rollups: {
      subcategoriesProcessed: rollupSubcatsProcessed,
      rollupRowsWritten: rollupRebuiltRows,
      appendedHistoryRows: rollupHistory.appendedRows,
      errorCount: rollupErrors.length,
    },
    ...summary,
    note: 'Phase 24C — finalize chains: GPN GROUP BY → GPN enrichment (UPDATE-FROM-CTE) → canonical-subcategory rollup rebuild + history append. No TI calls beyond the chunked-ingest fetch already performed.',
  })
})

// POST /api/ti/universe/catalog/gpn/rebuild-enrichment — auth-gated.
//
// Phase 24A.1 — backfill GPN aggregate enrichment fields
// (cheapest_opn, highest_inventory_opn, lifecycle_summary,
// median_normalized_unit_price) from existing ti_catalog_latest_opn
// rows without re-fetching TI. Useful when a prior catalog snapshot
// landed under the v1 finalize path that explicitly NULL'd these
// columns. Idempotent — re-running on already-enriched rows simply
// reasserts the same values and is cheap.
app.post('/api/ti/universe/catalog/gpn/rebuild-enrichment', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot rebuild GPN enrichment.' }, 500)
  }
  const result = await rebuildGpnEnrichment(env.TI_INVENTORY_HISTORY_DB as any)
  return c.json({
    success: result.errors.length === 0,
    totalGpns: result.totalGpns,
    enrichedGpns: result.enrichedGpns,
    rowsUpdated: result.rowsUpdated,
    changesByField: result.changesByField,
    nullMedianCount: result.nullMedianCount,
    nullCheapestCount: result.nullCheapestCount,
    nullHighestInventoryCount: result.nullHighestInventoryCount,
    nullLifecycleSummaryCount: result.nullLifecycleSummaryCount,
    sampleRows: result.sampleRows,
    errors: result.errors,
    note: 'Phase 24A.1 — pure SQL UPDATE-FROM-CTE rebuild. No TI calls. Idempotent.',
  })
})

// ── Phase 24C — TI catalog rollups (canonical-subcategory aggregates) ───────

// POST /api/ti/universe/catalog/rollups/rebuild — auth-gated, resumable.
//
// Phase 24C.1 — replaces the Phase 24C one-shot rebuild that hit D1's
// per-statement CPU limit on the 72k-OPN production catalog. Instead of
// one mega-statement, the rebuild is split per canonical subcategory.
// The operator drives it from Terminal with one of three modes:
//
//   ?mode=reset
//     - Auth-gated. Truncates ti_catalog_rollup_latest (single small
//       DELETE). Returns the canonical-subcategory list so the caller
//       knows what's pending. Never scans the OPN table heavily.
//
//   ?mode=step[&subcategory=...&limit=1..5]
//     - Auth-gated. Rebuilds 1..limit pending subcategories (or the
//       single requested one if `subcategory` is given). Each pass is
//       small (≤ a few thousand OPNs) so D1's per-statement CPU
//       budget is never under pressure.
//
//   ?mode=run[&limit=1..5]
//     - Same as step but loops internally up to `limit` (default 3,
//       capped at 5) within one HTTP request. Safe to call repeatedly
//       until /rollups/rebuild/status reports pending = 0.
//
// Never calls TI. Never mutates ti_catalog_latest_opn /
// ti_catalog_latest_gpn / catalog snapshot rows.
app.post('/api/ti/universe/catalog/rollups/rebuild', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot rebuild rollups.' }, 500)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as any
  const modeRaw = (c.req.query('mode') || 'step').toLowerCase().trim()
  const mode = (modeRaw === 'reset' || modeRaw === 'step' || modeRaw === 'run') ? modeRaw : 'step'
  const subcatFilter = (c.req.query('subcategory') || '').trim() || null
  const limitRaw = parseInt(c.req.query('limit') || '3', 10) || 3
  const limit = Math.max(1, Math.min(5, limitRaw))

  if (mode === 'reset') {
    const errors: string[] = []
    try { await clearLatestRollups(d1) } catch (e: any) {
      errors.push(`reset_clear:${(e?.message || 'failed').slice(0, 140)}`)
    }
    const all = listSubcategoryPredicates()
    return c.json({
      success: errors.length === 0,
      mode: 'reset',
      totalCanonicalSubcategories: all.length,
      pendingSubcategories: all.map(p => p.canonicalSubcategory),
      completedSubcategories: 0,
      errors,
      note: 'Phase 24C.1 — ti_catalog_rollup_latest cleared. Operator: loop POST .../rollups/rebuild?mode=run until /status reports pending = 0.',
    })
  }

  // mode = step | run — pick the next batch of subcategories.
  // When `?subcategory=...` is supplied, target that one explicitly even
  // if it's already been built (lets the operator force-rebuild a
  // single subcategory in place). Otherwise, pull only pending ones.
  let candidates: SubcategoryPredicate[]
  if (subcatFilter) {
    candidates = listSubcategoryPredicates().filter(p => p.canonicalSubcategory === subcatFilter)
    if (candidates.length === 0) {
      return c.json({
        success: false,
        mode,
        status: 'unknown_subcategory',
        message: `Subcategory '${subcatFilter}' is not in the canonical mapping list.`,
      }, 404)
    }
  } else {
    candidates = await pendingSubcategoryPredicates(d1)
  }

  const targets = candidates.slice(0, limit)
  const processed: Array<{
    canonicalSubcategory: string;
    canonicalGroup: string;
    upserted: boolean;
    matchedOpns: number;
    matchedGpns: number;
    errors: string[];
  }> = []
  for (const p of targets) {
    const r = await rebuildOneSubcategory(d1, p)
    processed.push({
      canonicalSubcategory: r.canonicalSubcategory,
      canonicalGroup: r.canonicalGroup,
      upserted: r.upserted,
      matchedOpns: r.matchedOpns,
      matchedGpns: r.matchedGpns,
      errors: r.errors,
    })
  }
  // Re-read pending after the batch so the response is accurate.
  const pendingAfter = await pendingSubcategoryPredicates(d1)
  const all = listSubcategoryPredicates()
  const errors = processed.flatMap(p => p.errors)
  return c.json({
    success: errors.length === 0,
    mode,
    limit,
    processed,
    completedSubcategories: all.length - pendingAfter.length,
    pendingSubcategories: pendingAfter.map(p => p.canonicalSubcategory),
    totalCanonicalSubcategories: all.length,
    errors,
    note: `Phase 24C.1 — ${processed.length} subcategor${processed.length === 1 ? 'y' : 'ies'} processed. Repeat until pending = 0.`,
  })
})

// GET /api/ti/universe/catalog/rollups/rebuild/status — public, sanitized.
//
// Phase 24C.1 progress check. Tells the operator how many of the (≤28)
// canonical subcategories have a row in ti_catalog_rollup_latest, which
// are still pending, and (when fully complete) the cumulative
// mapped/unmapped OPN counts. Cheap — at most two small SELECTs.
app.get('/api/ti/universe/catalog/rollups/rebuild/status', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({
      success: false, status: 'd1_not_bound',
      message: 'TI_INVENTORY_HISTORY_DB not bound; rollup status unavailable.',
    }, 503)
  }
  const status = await readRollupStatus(env.TI_INVENTORY_HISTORY_DB as any)
  return c.json({
    success: true,
    backend: 'd1',
    ...status,
    note: status.pendingSubcategories.length === 0
      ? 'All canonical subcategories rebuilt.'
      : 'Loop POST /rollups/rebuild?mode=run until pendingSubcategories is empty.',
  })
})

// GET /api/ti/universe/catalog/rollups/latest — public, sanitized.
//
// Returns the per-canonical-subcategory rollup rows the rebuild produced.
// Filters: ?group=<canonical_group>, ?subcategory=<canonical_subcategory>,
// ?confidence=<high|medium|low> (matches when that bucket has > 0 OPNs in
// the row's mapping_confidence_summary), ?limit=1..200 default 100.
app.get('/api/ti/universe/catalog/rollups/latest', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; rollup table unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as any
  const group = (c.req.query('group') || '').trim() || null
  const subcategory = (c.req.query('subcategory') || '').trim() || null
  const confidenceRaw = (c.req.query('confidence') || '').toLowerCase().trim()
  const confidence = (confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low') ? confidenceRaw : null
  const limitRaw = parseInt(c.req.query('limit') || '100', 10) || 100
  const limit = Math.max(1, Math.min(200, limitRaw))

  const where: string[] = []
  const binds: unknown[] = []
  if (group) {
    where.push('canonical_group = ?')
    binds.push(group)
  }
  if (subcategory) {
    where.push('canonical_subcategory = ?')
    binds.push(subcategory)
  }
  if (confidence) {
    // mapping_confidence_summary is JSON like {"high":42,"medium":3}.
    // Use json_extract to filter rows that have at least one OPN in
    // the requested bucket.
    where.push(`COALESCE(json_extract(mapping_confidence_summary, '$.${confidence}'), 0) > 0`)
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  binds.push(limit)
  const sql =
    `SELECT canonical_group, canonical_subcategory,
            opn_count, gpn_count, priced_opn_count,
            stocked_opn_count, out_of_stock_opn_count, stocked_pct,
            total_quantity, median_normalized_unit_price,
            min_normalized_unit_price, max_normalized_unit_price,
            cheapest_opn, highest_inventory_opn,
            lifecycle_summary, mapping_confidence_summary,
            latest_captured_at
       FROM ti_catalog_rollup_latest
       ${whereClause}
       ORDER BY total_quantity DESC NULLS LAST
       LIMIT ?`

  type Row = {
    canonical_group: string;
    canonical_subcategory: string;
    opn_count: number; gpn_count: number; priced_opn_count: number;
    stocked_opn_count: number; out_of_stock_opn_count: number;
    stocked_pct: number | null; total_quantity: number | null;
    median_normalized_unit_price: number | null;
    min_normalized_unit_price: number | null;
    max_normalized_unit_price: number | null;
    cheapest_opn: string | null; highest_inventory_opn: string | null;
    lifecycle_summary: string | null; mapping_confidence_summary: string | null;
    latest_captured_at: string;
  }
  const result = await d1.prepare(sql).bind(...binds).all<Row>()
  const parseJson = (s: string | null) => {
    if (typeof s !== 'string') return s ?? null
    try { return JSON.parse(s) } catch { return s }
  }
  const rows = (result.results ?? []).map((r: Row) => {
    const mappingConfidenceSummary = parseJson(r.mapping_confidence_summary)
    // Phase 24C.2 — derive mapping-quality flags so the Prices tab can
    // visually distinguish clean (high/medium) from contaminated
    // (low/mixed) rollups. Quality fields never alter the underlying
    // counts; they're advisory.
    const quality = computeRollupQuality({
      opnCount: r.opn_count,
      mappingConfidenceSummary,
    })
    return {
      canonicalGroup: r.canonical_group,
      canonicalSubcategory: r.canonical_subcategory,
      opnCount: r.opn_count,
      gpnCount: r.gpn_count,
      pricedOpnCount: r.priced_opn_count,
      stockedOpnCount: r.stocked_opn_count,
      outOfStockOpnCount: r.out_of_stock_opn_count,
      stockedPct: r.stocked_pct,
      totalQuantity: r.total_quantity,
      medianNormalizedUnitPrice: r.median_normalized_unit_price,
      minNormalizedUnitPrice: r.min_normalized_unit_price,
      maxNormalizedUnitPrice: r.max_normalized_unit_price,
      cheapestOpn: r.cheapest_opn,
      highestInventoryOpn: r.highest_inventory_opn,
      lifecycleSummary: parseJson(r.lifecycle_summary),
      mappingConfidenceSummary,
      latestCapturedAt: r.latest_captured_at,
      ...quality,
    }
  })
  return c.json({
    success: true,
    backend: 'd1',
    filters: { group, subcategory, confidence, limit },
    rows,
    note: 'Phase 24C / 24C.2 — TI Direct evidence is the latest catalog snapshot only; quality fields advise whether each row is clean enough for live signal. Historical trend requires at least two TI catalog snapshots.',
  })
})

// GET /api/ti/universe/catalog/rollups/detail — public, sanitized.
//
// Phase 24D — drives the "click a Prices Live cell → see exact mapped
// TI parts behind that subcategory" workflow. Returns:
//   - The full ti_catalog_rollup_latest row (with quality fields).
//   - Top GPN families that mapped into this subcategory (aggregated
//     from the same OPN predicate that built the rollup).
//   - Top OPNs in the subcategory, with per-row mapping_confidence
//     resolved by walking the subcategory's own-rules in order
//     (mirrors first-match-wins).
//
// Filters / limits:
//   ?subcategory=<canonical_subcategory>  required
//   ?gpnLimit=1..200  default 50
//   ?opnLimit=1..500  default 100
//
// Never calls TI; never mutates anything.
app.get('/api/ti/universe/catalog/rollups/detail', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; rollup detail unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as any
  const subcategory = (c.req.query('subcategory') || '').trim()
  if (!subcategory) {
    return c.json({ success: false, status: 'invalid_payload', message: '?subcategory=<canonical_subcategory> is required.' }, 400)
  }
  const predicate = listSubcategoryPredicates().find(p => p.canonicalSubcategory === subcategory)
  if (!predicate) {
    return c.json({ success: false, status: 'unknown_subcategory', message: `Subcategory '${subcategory}' is not in the canonical mapping list.` }, 404)
  }
  const gpnLimitRaw = parseInt(c.req.query('gpnLimit') || '50', 10) || 50
  const gpnLimit = Math.max(1, Math.min(200, gpnLimitRaw))
  const opnLimitRaw = parseInt(c.req.query('opnLimit') || '100', 10) || 100
  const opnLimit = Math.max(1, Math.min(500, opnLimitRaw))

  // 1. Read the rollup row (with quality fields derived in JS so older
  //    backfills that predate Phase 24C.2 still surface them).
  type RollupRaw = {
    canonical_group: string;
    canonical_subcategory: string;
    opn_count: number; gpn_count: number;
    priced_opn_count: number; stocked_opn_count: number; out_of_stock_opn_count: number;
    stocked_pct: number | null; total_quantity: number | null;
    median_normalized_unit_price: number | null;
    min_normalized_unit_price: number | null;
    max_normalized_unit_price: number | null;
    cheapest_opn: string | null; highest_inventory_opn: string | null;
    lifecycle_summary: string | null; mapping_confidence_summary: string | null;
    latest_captured_at: string;
  }
  const rollupRow = await d1.prepare(
    `SELECT canonical_group, canonical_subcategory,
            opn_count, gpn_count, priced_opn_count,
            stocked_opn_count, out_of_stock_opn_count, stocked_pct,
            total_quantity, median_normalized_unit_price,
            min_normalized_unit_price, max_normalized_unit_price,
            cheapest_opn, highest_inventory_opn,
            lifecycle_summary, mapping_confidence_summary,
            latest_captured_at
       FROM ti_catalog_rollup_latest
       WHERE canonical_subcategory = ?
       LIMIT 1`,
  ).bind(subcategory).first<RollupRaw>()
  if (!rollupRow) {
    return c.json({ success: false, status: 'rollup_not_built', message: `Rollup row for '${subcategory}' has not been built yet. Operator: POST /rollups/rebuild?mode=run.` }, 404)
  }
  const parseJson = (s: string | null) => {
    if (typeof s !== 'string') return s ?? null
    try { return JSON.parse(s) } catch { return s }
  }
  const mappingConfidenceSummary = parseJson(rollupRow.mapping_confidence_summary)
  const quality = computeRollupQuality({ opnCount: rollupRow.opn_count, mappingConfidenceSummary })
  const rollup = {
    canonicalGroup: rollupRow.canonical_group,
    canonicalSubcategory: rollupRow.canonical_subcategory,
    opnCount: rollupRow.opn_count,
    gpnCount: rollupRow.gpn_count,
    pricedOpnCount: rollupRow.priced_opn_count,
    stockedOpnCount: rollupRow.stocked_opn_count,
    outOfStockOpnCount: rollupRow.out_of_stock_opn_count,
    stockedPct: rollupRow.stocked_pct,
    totalQuantity: rollupRow.total_quantity,
    medianNormalizedUnitPrice: rollupRow.median_normalized_unit_price,
    minNormalizedUnitPrice: rollupRow.min_normalized_unit_price,
    maxNormalizedUnitPrice: rollupRow.max_normalized_unit_price,
    cheapestOpn: rollupRow.cheapest_opn,
    highestInventoryOpn: rollupRow.highest_inventory_opn,
    lifecycleSummary: parseJson(rollupRow.lifecycle_summary),
    mappingConfidenceSummary,
    latestCapturedAt: rollupRow.latest_captured_at,
    ...quality,
  }

  // 2. Top GPN families inside the subcategory predicate. Aggregate from
  //    OPN matches so the gpn_count + total_qty here line up exactly
  //    with the rollup's own counts (the GPN aggregate table is unaware
  //    of canonical subcategories — it groups across the whole catalog).
  const where = predicate.whereClause
  type GpnAggRow = {
    gpn: string;
    opn_count: number;
    stocked_opn_count: number;
    total_quantity: number;
    min_normalized_unit_price: number | null;
    median_normalized_unit_price: number | null;
    cheapest_opn: string | null;
    highest_inventory_opn: string | null;
    lifecycle_summary: string | null;
  }
  const gpnRows = await d1.prepare(
    `SELECT generic_part_number AS gpn,
            COUNT(*) AS opn_count,
            SUM(CASE WHEN quantity IS NOT NULL AND quantity > 0 THEN 1 ELSE 0 END) AS stocked_opn_count,
            SUM(COALESCE(quantity, 0)) AS total_quantity,
            MIN(normalized_unit_price) AS min_normalized_unit_price,
            NULL AS median_normalized_unit_price,
            NULL AS cheapest_opn,
            NULL AS highest_inventory_opn,
            (SELECT json_group_object(lifecycle, cnt) FROM (
              SELECT lifecycle, COUNT(*) AS cnt
                FROM ti_catalog_latest_opn lc_inner
               WHERE lc_inner.lifecycle IS NOT NULL
                 AND TRIM(lc_inner.lifecycle) != ''
                 AND lc_inner.generic_part_number = ti_catalog_latest_opn.generic_part_number
               GROUP BY lifecycle)) AS lifecycle_summary
       FROM ti_catalog_latest_opn
       WHERE generic_part_number IS NOT NULL
         AND ${where}
       GROUP BY generic_part_number
       ORDER BY total_quantity DESC NULLS LAST
       LIMIT ?`,
  ).bind(gpnLimit).all<GpnAggRow>()
  const topGpns = (gpnRows.results ?? []).map((g: GpnAggRow) => ({
    genericPartNumber: g.gpn,
    opnCount: g.opn_count,
    stockedOpnCount: g.stocked_opn_count,
    totalQuantity: g.total_quantity ?? 0,
    minNormalizedUnitPrice: g.min_normalized_unit_price,
    medianNormalizedUnitPrice: g.median_normalized_unit_price,
    cheapestOpn: g.cheapest_opn,
    highestInventoryOpn: g.highest_inventory_opn,
    lifecycleSummary: parseJson(g.lifecycle_summary),
  }))

  // 3. Top OPNs inside the subcategory. Per-OPN mapping_confidence is
  //    resolved by walking the subcategory's ownRules in global rule
  //    order — first WHEN that matches a row determines that row's
  //    confidence, mirroring the JS first-match-wins matcher.
  const ownRules = predicate.ownRules
  const confidenceCase = (() => {
    if (ownRules.length === 0) return `'unknown'`
    const whens = ownRules.map(r => `WHEN (${r.sql}) THEN '${r.confidence}'`).join('\n              ')
    return `CASE\n              ${whens}\n              ELSE 'unknown'\n            END`
  })()
  type OpnDetailRow = {
    ti_part_number: string;
    generic_part_number: string | null;
    description: string | null;
    quantity: number | null;
    normalized_unit_price: number | null;
    normalized_price_qty: number | null;
    currency: string | null;
    lifecycle: string | null;
    buy_now_url: string | null;
    mapping_confidence: string | null;
  }
  const opnRows = await d1.prepare(
    `SELECT ti_part_number, generic_part_number, description, quantity,
            normalized_unit_price, normalized_price_qty, currency,
            lifecycle, buy_now_url,
            (${confidenceCase}) AS mapping_confidence
       FROM ti_catalog_latest_opn
       WHERE ${where}
       ORDER BY quantity DESC NULLS LAST, ti_part_number ASC
       LIMIT ?`,
  ).bind(opnLimit).all<OpnDetailRow>()
  const topOpns = (opnRows.results ?? []).map((o: OpnDetailRow) => ({
    tiPartNumber: o.ti_part_number,
    genericPartNumber: o.generic_part_number,
    description: o.description,
    quantity: o.quantity,
    normalizedUnitPrice: o.normalized_unit_price,
    normalizedPriceQty: o.normalized_price_qty,
    currency: o.currency,
    lifeCycle: o.lifecycle,
    buyNowUrl: o.buy_now_url,
    mappingConfidence: o.mapping_confidence,
  }))

  return c.json({
    success: true,
    backend: 'd1',
    filter: {
      canonicalSubcategory: subcategory,
      canonicalGroup: rollup.canonicalGroup,
    },
    rollup,
    gpnLimit,
    opnLimit,
    topGpns,
    topOpns,
    mappingRuleIds: predicate.ruleIds,
    note: 'Phase 24D — TI Direct evidence is latest catalog snapshot only; trend requires ≥2 catalog snapshots. Click GPN/OPN to drill into family/part detail.',
  })
})

// GET /api/ti/universe/catalog/rollups/quality — public, sanitized.
//
// Phase 24C.2 — operator + customer-facing diagnostic that surfaces
// rollup-mapping quality at a glance: how many subcategories fall in
// each quality bucket, the worst 10 rows by lowConfidencePct, the
// largest 10 rows by absolute low-confidence OPN count, and example
// suspicious cheapest/highest OPNs from low/mixed rollups so the
// operator can see exactly what's contaminating the signal.
app.get('/api/ti/universe/catalog/rollups/quality', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; rollup quality unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as any
  type RawRow = {
    canonical_group: string;
    canonical_subcategory: string;
    opn_count: number; gpn_count: number;
    priced_opn_count: number; stocked_opn_count: number; out_of_stock_opn_count: number;
    stocked_pct: number | null; total_quantity: number | null;
    median_normalized_unit_price: number | null;
    min_normalized_unit_price: number | null;
    max_normalized_unit_price: number | null;
    cheapest_opn: string | null; highest_inventory_opn: string | null;
    lifecycle_summary: string | null; mapping_confidence_summary: string | null;
    latest_captured_at: string;
  }
  const all = await d1.prepare(
    `SELECT canonical_group, canonical_subcategory,
            opn_count, gpn_count, priced_opn_count,
            stocked_opn_count, out_of_stock_opn_count, stocked_pct,
            total_quantity, median_normalized_unit_price,
            min_normalized_unit_price, max_normalized_unit_price,
            cheapest_opn, highest_inventory_opn,
            lifecycle_summary, mapping_confidence_summary,
            latest_captured_at
       FROM ti_catalog_rollup_latest`,
  ).all<RawRow>()
  const parseJson = (s: string | null) => {
    if (typeof s !== 'string') return s ?? null
    try { return JSON.parse(s) } catch { return s }
  }
  const rows = (all.results ?? []).map((r: RawRow) => {
    const mappingConfidenceSummary = parseJson(r.mapping_confidence_summary)
    const quality = computeRollupQuality({ opnCount: r.opn_count, mappingConfidenceSummary })
    return {
      canonicalGroup: r.canonical_group,
      canonicalSubcategory: r.canonical_subcategory,
      opnCount: r.opn_count,
      cheapestOpn: r.cheapest_opn,
      highestInventoryOpn: r.highest_inventory_opn,
      mappingConfidenceSummary,
      ...quality,
    }
  })
  const byLabel: Record<string, typeof rows> = { high: [], medium: [], low: [], mixed: [] }
  for (const r of rows) byLabel[r.qualityLabel].push(r)
  const counts = {
    total: rows.length,
    high: byLabel.high.length,
    medium: byLabel.medium.length,
    low: byLabel.low.length,
    mixed: byLabel.mixed.length,
  }
  // Worst-by-low-percentage AND largest-by-absolute-low-count are useful
  // operator views: the first highlights subcategories that are mostly
  // junk, the second highlights subcategories where most parts are
  // clean but a few thousand low-confidence rows still swamp the count.
  const worstByLowPct = [...rows]
    .filter(r => r.opnCount >= 10) // exclude empty/tiny subcategories from the leaderboard
    .sort((a, b) => b.lowConfidencePct - a.lowConfidencePct)
    .slice(0, 10)
    .map(r => ({
      canonicalSubcategory: r.canonicalSubcategory,
      qualityLabel: r.qualityLabel,
      opnCount: r.opnCount,
      lowConfidencePct: r.lowConfidencePct,
      lowConfidenceOpnCount: r.lowConfidenceOpnCount,
      qualityWarning: r.qualityWarning,
    }))
  const largestLowCount = [...rows]
    .sort((a, b) => b.lowConfidenceOpnCount - a.lowConfidenceOpnCount)
    .slice(0, 10)
    .map(r => ({
      canonicalSubcategory: r.canonicalSubcategory,
      qualityLabel: r.qualityLabel,
      opnCount: r.opnCount,
      lowConfidenceOpnCount: r.lowConfidenceOpnCount,
      lowConfidencePct: r.lowConfidencePct,
    }))
  // Sample suspicious OPNs from low/mixed rollups: cheapest + highest-
  // inventory entries are the customer-visible names in the tooltip,
  // so flagging which ones came out of contaminated buckets is the
  // most useful single hint.
  const suspiciousOpns = rows
    .filter(r => r.qualityLabel === 'low' || r.qualityLabel === 'mixed')
    .filter(r => r.cheapestOpn || r.highestInventoryOpn)
    .slice(0, 10)
    .map(r => ({
      canonicalSubcategory: r.canonicalSubcategory,
      qualityLabel: r.qualityLabel,
      cheapestOpn: r.cheapestOpn,
      highestInventoryOpn: r.highestInventoryOpn,
      qualityWarning: r.qualityWarning,
    }))
  return c.json({
    success: true,
    backend: 'd1',
    counts,
    rows,
    worstByLowPct,
    largestLowCount,
    suspiciousOpns,
    note: 'Phase 24C.2 — Rollup quality flags. Use rows.qualityLabel + usableForPricesLiveEvidence to drive customer-facing UI gating. Operator: tighten mapping rules (tiCatalogMapping.ts) for any subcategory that lands in low/mixed; remove broad keyword fallbacks first.',
  })
})

// GET /api/ti/universe/catalog/status — public, sanitized.
// Returns the current state of the catalog tables + the most recent
// snapshot-run summary row. Read-only. Safe for the UI to call.
//
// Phase 23C.2 — every response carries a refreshPolicy reminder so any
// caller (UI, operator, downstream tooling) sees that catalog refresh is
// manual + quota-limited. The catalog endpoint itself is rate-limited
// to 1 call every 4 hours / 6 calls per day; the GitHub Action
// ti-catalog-universe-ingest.yml is the recommended (and quota-aware)
// path. The probe + experimental capture endpoints share the same
// quota.
const CATALOG_REFRESH_POLICY = {
  cadence: 'manual',
  workflow: '.github/workflows/ti-catalog-universe-ingest.yml',
  tiQuota: '1 catalog call every 4 hours, 6 per day (shared with /probe and /capture)',
  reminder: 'Catalog refresh is manual and quota-limited. Do not retry failed catalog fetches immediately — wait at least 4 hours, safer 24 hours.',
} as const
app.get('/api/ti/universe/catalog/status', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({
      success: true,
      backend: 'none',
      latestRun: null,
      opnCount: 0, gpnCount: 0,
      pricedOpnCount: 0, inStockOpnCount: 0, outOfStockOpnCount: 0,
      latestCapturedAt: null,
      // Phase 23C.4 — quota fields default to 'unavailable' when D1 isn't
      // bound. Operators / clients should treat that as 'do not run'.
      quotaStatus: null,
      nextSafeCatalogRunAt: null,
      minutesUntilSafe: 0,
      lastCatalogAttemptAt: null,
      lastSuccessfulFetchAt: null,
      attemptsLast24h: 0,
      refreshPolicy: CATALOG_REFRESH_POLICY,
      message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.',
    })
  }
  const [counts, latestRun, quota] = await Promise.all([
    readSnapshotCounts(env.TI_INVENTORY_HISTORY_DB as any),
    readLatestSnapshotRun(env.TI_INVENTORY_HISTORY_DB as any),
    readQuotaStatus(env.TI_INVENTORY_HISTORY_DB as any),
  ])
  return c.json({
    success: true,
    backend: 'd1',
    latestRun,
    opnCount: counts.totalOpns,
    gpnCount: counts.totalGpns,
    pricedOpnCount: counts.pricedOpns,
    inStockOpnCount: counts.inStockOpns,
    outOfStockOpnCount: counts.outOfStockOpns,
    latestCapturedAt: counts.latestCapturedAt,
    // Phase 23C.4 — embed the quota state directly so a single
    // /catalog/status read tells the operator both 'how full are the
    // catalog tables' and 'when can I safely refresh next'.
    quotaStatus: quota,
    nextSafeCatalogRunAt: quota.nextSafeRunAt,
    minutesUntilSafe: quota.minutesUntilSafe,
    lastCatalogAttemptAt: quota.lastCatalogAttemptAt,
    lastSuccessfulFetchAt: quota.lastSuccessfulFetchAt,
    attemptsLast24h: quota.attemptsLast24h,
    refreshPolicy: CATALOG_REFRESH_POLICY,
  })
})

// ── Phase 23C.4 — TI catalog quota self-governance ───────────────────────────
// Three endpoints back the workflow's preflight gate and operator visibility.
// Together they ensure the rate-limited TI /v2/store/products/catalog endpoint
// is never called outside its safe window:
//   GET  /catalog/quota/status     — public read; UI / dashboards / humans
//   POST /catalog/quota/preflight  — auth; reserve an in_flight ledger row
//   POST /catalog/quota/complete   — auth; close that row with the outcome
// synthetic_chunk runs do NOT call any of these — they don't touch TI.

// GET /api/ti/universe/catalog/quota/status — public, sanitized.
app.get('/api/ti/universe/catalog/quota/status', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({
      success: false,
      backend: 'none',
      message: 'TI_INVENTORY_HISTORY_DB not bound; quota ledger unavailable.',
      maxAttemptsPer24h: MAX_ATTEMPTS_PER_24H,
      minimumHoursBetweenCatalogCalls: MIN_HOURS_BETWEEN_CATALOG_CALLS,
      safetyBufferMinutes: SAFETY_BUFFER_MINUTES,
    })
  }
  const status = await readQuotaStatus(env.TI_INVENTORY_HISTORY_DB as any)
  return c.json({ success: true, backend: 'd1', ...status })
})

// POST /api/ti/universe/catalog/quota/preflight — auth-gated.
// Never calls TI. Reads the ledger; if safe, inserts an in_flight row and
// returns runId. The workflow MUST call /quota/complete with that runId
// after the catalog fetch (success, 429, or any post-fetch failure) so
// the row never lingers as in_flight forever.
app.post('/api/ti/universe/catalog/quota/preflight', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot reserve quota row.' }, 500)
  }
  let body: any = {}
  try { body = await c.req.json() } catch { /* allow empty body */ }
  const source = typeof body?.source === 'string' && body.source.trim().length > 0
    ? body.source.trim().slice(0, 96)
    : 'github_actions_catalog_ingest'
  const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 256) : null
  const result = await preflightAndReserve(env.TI_INVENTORY_HISTORY_DB as any, { source, notes })
  if (!result.safeToRun) {
    return c.json({
      success: true,
      safeToRun: false,
      reason: result.status.reason,
      nextSafeRunAt: result.status.nextSafeRunAt,
      minutesUntilSafe: result.status.minutesUntilSafe,
      quotaStatus: result.status,
    })
  }
  return c.json({
    success: true,
    safeToRun: true,
    runId: result.runId,
    quotaStatus: result.status,
  })
})

// POST /api/ti/universe/catalog/quota/complete — auth-gated.
// Closes an in_flight ledger row with the run outcome. Allowed statuses:
// success | rate_limited | failed_before_fetch | failed_after_fetch |
// failed_chunk_write | failed_validation. Never echoes secrets, raw TI
// bodies, or OAuth tokens.
app.post('/api/ti/universe/catalog/quota/complete', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot complete quota row.' }, 500)
  }
  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ success: false, status: 'invalid_payload', message: 'Body must be JSON.' }, 400)
  }
  const runId = typeof body?.runId === 'string' ? body.runId.trim() : ''
  const statusStr = typeof body?.status === 'string' ? body.status.trim() : ''
  if (!runId || !statusStr) {
    return c.json({ success: false, status: 'invalid_payload', message: 'runId and status are required.' }, 400)
  }
  if (!isAllowedCompleteStatus(statusStr)) {
    return c.json({
      success: false, status: 'invalid_status',
      message: `status must be one of: success | rate_limited | failed_before_fetch | failed_after_fetch | failed_chunk_write | failed_validation. Got '${statusStr}'.`,
    }, 400)
  }
  const httpStatus = Number.isFinite(body?.httpStatus) ? Math.trunc(body.httpStatus) : null
  const tiErrorCode = typeof body?.tiErrorCode === 'string' ? body.tiErrorCode : null
  const productsParsed = Number.isFinite(body?.productsParsed) ? Math.trunc(body.productsParsed) : null
  const opnRowsUpserted = Number.isFinite(body?.opnRowsUpserted) ? Math.trunc(body.opnRowsUpserted) : null
  const notes = typeof body?.notes === 'string' ? body.notes : null
  const res = await completeRun(env.TI_INVENTORY_HISTORY_DB as any, {
    runId,
    status: statusStr,
    httpStatus,
    tiErrorCode,
    productsParsed,
    opnRowsUpserted,
    notes,
  })
  if (!res.updated) {
    return c.json({
      success: false,
      status: 'not_updated',
      reason: res.reason,
      message: res.reason === 'no_in_flight_row_for_id'
        ? 'No in_flight quota row matched the supplied runId. Either the row was already completed or the id is wrong.'
        : 'Quota ledger update did not apply; see reason.',
    }, 409)
  }
  return c.json({ success: true, runId, status: statusStr })
})

// POST /api/ti/universe/catalog/quota/repair — auth-gated.
//
// Phase 23C.5 — repair a previously-closed real_catalog ledger row
// without re-fetching TI. Use case: a run failed only at the
// post-finalize validation step (e.g. opnCount briefly inflated by
// leftover synthetic test rows) but the TI fetch itself was
// successful and the catalog data is correct. Without repair the
// row stays as failed_validation forever and the operator audit
// log misrepresents what actually happened.
//
// This endpoint NEVER calls TI. It only updates the ledger row.
// Repairable previous statuses: failed_validation,
// failed_chunk_write, failed_after_fetch. We refuse to repair
// in_flight (use /complete), success (already terminal), or
// rate_limited / failed_before_fetch (the TI fetch did not
// succeed, so they should not silently flip to success).
//
// Body:
//   { runId?, newStatus?, httpStatus?, productsParsed?,
//     opnRowsUpserted?, notes? }
// runId is optional; when omitted the helper picks the most recent
// repairable real_catalog row.
app.post('/api/ti/universe/catalog/quota/repair', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const provided = (c.req.header('x-capture-secret') || c.req.query('secret') || '').trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; cannot repair quota row.' }, 500)
  }
  let body: any = {}
  try { body = await c.req.json() } catch {
    return c.json({ success: false, status: 'invalid_payload', message: 'Body must be JSON.' }, 400)
  }
  const runIdRaw = typeof body?.runId === 'string' ? body.runId.trim() : ''
  const runId = runIdRaw.length > 0 ? runIdRaw : null
  const newStatusRaw = typeof body?.newStatus === 'string' ? body.newStatus.trim() : 'success'
  if (!isAllowedCompleteStatus(newStatusRaw)) {
    return c.json({
      success: false, status: 'invalid_status',
      message: `newStatus must be one of: success | rate_limited | failed_before_fetch | failed_after_fetch | failed_chunk_write | failed_validation. Got '${newStatusRaw}'.`,
    }, 400)
  }
  const httpStatus = Number.isFinite(body?.httpStatus) ? Math.trunc(body.httpStatus) : null
  const tiErrorCode = typeof body?.tiErrorCode === 'string' ? body.tiErrorCode : null
  const productsParsed = Number.isFinite(body?.productsParsed) ? Math.trunc(body.productsParsed) : null
  const opnRowsUpserted = Number.isFinite(body?.opnRowsUpserted) ? Math.trunc(body.opnRowsUpserted) : null
  const notes = typeof body?.notes === 'string' ? body.notes : null
  const res = await repairRun(env.TI_INVENTORY_HISTORY_DB as any, {
    runId,
    newStatus: newStatusRaw,
    httpStatus,
    tiErrorCode,
    productsParsed,
    opnRowsUpserted,
    notes,
  })
  if (!res.updated) {
    const code = res.reason === 'no_repairable_row_found' ? 404 : 409
    return c.json({
      success: false,
      status: 'not_repaired',
      reason: res.reason,
      repairedRunId: res.repairedRunId,
      previousStatus: res.previousStatus,
      message: res.reason === 'no_repairable_row_found'
        ? 'No repairable real_catalog ledger row found. Either the supplied runId is wrong, or no row currently has status IN (failed_validation, failed_chunk_write, failed_after_fetch).'
        : 'Quota ledger repair did not apply; see reason.',
    }, code)
  }
  return c.json({
    success: true,
    repairedRunId: res.repairedRunId,
    previousStatus: res.previousStatus,
    newStatus: newStatusRaw,
  })
})

// ── Phase 24A — TI catalog analytics read endpoints ─────────────────────────
// Five GET endpoints over the Phase 23C catalog tables. Read-only. NEVER call
// TI, NEVER fetch /v2/store/products/catalog, NEVER mutate any row. Sanitized
// shapes — pricing_json / future_inventory_json get parsed before return so
// the client doesn't have to re-parse, and lifecycle_summary on the GPN row
// likewise. Secrets and OAuth tokens are never read here.

/** Local D1 surface narrow enough to type-check without dragging in workers
 *  types. The runtime objects are the real Cloudflare ones. */
type CatalogReadD1 = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>
      first<T = unknown>(): Promise<T | null>
      all<T = unknown>(): Promise<{ results?: T[] }>
    }
    first<T = unknown>(): Promise<T | null>
    all<T = unknown>(): Promise<{ results?: T[] }>
  }
}

function tryParseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (raw == null) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

type OpnRow = {
  ti_part_number: string
  generic_part_number: string | null
  description: string | null
  quantity: number | null
  limit_qty: number | null
  pricing_json: string | null
  normalized_unit_price: number | null
  normalized_price_qty: number | null
  currency: string | null
  future_inventory_json: string | null
  minimum_order_quantity: number | null
  standard_pack_quantity: number | null
  lifecycle: string | null
  buy_now_url: string | null
  latest_captured_at: string
}

type GpnRow = {
  generic_part_number: string
  opn_count: number
  stocked_opn_count: number
  total_quantity: number | null
  min_normalized_unit_price: number | null
  median_normalized_unit_price: number | null
  // Phase 24E.1 — MAX(normalized_unit_price) per GPN. Not stored on the
  // ti_catalog_latest_gpn table; computed via subquery in the leaderboard
  // endpoint and may be undefined on rows from /family/:gpn (the GPN aggregate
  // row alone doesn't carry it). Treat absent === null === unknown.
  max_normalized_unit_price?: number | null
  cheapest_opn: string | null
  highest_inventory_opn: string | null
  lifecycle_summary: string | null
  latest_captured_at: string
}

function publicOpnRow(r: OpnRow) {
  return {
    tiPartNumber: r.ti_part_number,
    genericPartNumber: r.generic_part_number,
    description: r.description,
    quantity: r.quantity,
    limit: r.limit_qty,
    pricing: tryParseJson(r.pricing_json),
    normalizedUnitPrice: r.normalized_unit_price,
    normalizedPriceQty: r.normalized_price_qty,
    currency: r.currency,
    futureInventory: tryParseJson(r.future_inventory_json),
    minimumOrderQuantity: r.minimum_order_quantity,
    standardPackQuantity: r.standard_pack_quantity,
    lifeCycle: r.lifecycle,
    buyNowUrl: r.buy_now_url,
    latestCapturedAt: r.latest_captured_at,
  }
}

function publicGpnRow(r: GpnRow) {
  return {
    genericPartNumber: r.generic_part_number,
    opnCount: r.opn_count,
    stockedOpnCount: r.stocked_opn_count,
    totalQuantity: r.total_quantity ?? 0,
    minNormalizedUnitPrice: r.min_normalized_unit_price,
    medianNormalizedUnitPrice: r.median_normalized_unit_price,
    // Phase 24E.1 — only present on /gpn-leaderboard (computed via JOIN);
    // /family/:gpn omits it, leave null so the UI can fall back to median or
    // explicitly mark "—".
    maxNormalizedUnitPrice: r.max_normalized_unit_price ?? null,
    cheapestOpn: r.cheapest_opn,
    highestInventoryOpn: r.highest_inventory_opn,
    lifecycleSummary: tryParseJson<Record<string, number>>(r.lifecycle_summary),
    latestCapturedAt: r.latest_captured_at,
  }
}

// GET /api/ti/universe/catalog/overview — public, sanitized.
// Single-snapshot universe summary derived from ti_catalog_latest_opn +
// ti_catalog_snapshot_run + the quota helper. Cheap (~5 small SQL reads,
// all index-backed). Safe for the UI to call on page load.
app.get('/api/ti/universe/catalog/overview', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as unknown as CatalogReadD1
  // Single grouped query for the count + price aggregates so D1 only
  // walks the OPN table once. Median is approximated by the row at
  // ROW_NUMBER() = floor(N/2) over the priced subset — that's exact
  // for SQLite when N is even (lower-of-two-middle) and the customer
  // doesn't need IEEE-precise medians here.
  const [aggsRes, latestRunRes, medianRes, quota] = await Promise.all([
    d1.prepare(
      `SELECT
         COUNT(*) AS opn_count,
         SUM(CASE WHEN quantity IS NOT NULL AND quantity > 0 THEN 1 ELSE 0 END) AS in_stock,
         SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock,
         SUM(CASE WHEN normalized_unit_price IS NOT NULL THEN 1 ELSE 0 END) AS priced_opns,
         COALESCE(SUM(quantity), 0) AS total_quantity,
         MIN(normalized_unit_price) AS min_price,
         MAX(normalized_unit_price) AS max_price,
         MAX(latest_captured_at) AS latest_captured_at
       FROM ti_catalog_latest_opn`,
    ).first<{
      opn_count: number; in_stock: number; out_of_stock: number; priced_opns: number;
      total_quantity: number; min_price: number | null; max_price: number | null;
      latest_captured_at: string | null;
    }>(),
    d1.prepare(`SELECT COUNT(*) AS gpn_count FROM ti_catalog_latest_gpn`).first<{ gpn_count: number }>(),
    d1.prepare(
      `SELECT normalized_unit_price AS p
         FROM ti_catalog_latest_opn
         WHERE normalized_unit_price IS NOT NULL
         ORDER BY normalized_unit_price ASC
         LIMIT 1
         OFFSET (SELECT (COUNT(*) / 2) FROM ti_catalog_latest_opn WHERE normalized_unit_price IS NOT NULL)`,
    ).first<{ p: number | null }>(),
    readQuotaStatus(env.TI_INVENTORY_HISTORY_DB as any),
  ])
  const aggs = aggsRes ?? {
    opn_count: 0, in_stock: 0, out_of_stock: 0, priced_opns: 0,
    total_quantity: 0, min_price: null, max_price: null, latest_captured_at: null,
  }
  const opnCount = Number(aggs.opn_count) || 0
  const inStock = Number(aggs.in_stock) || 0
  const outOfStock = Number(aggs.out_of_stock) || 0
  return c.json({
    success: true,
    backend: 'd1',
    opnCount,
    gpnCount: Number(latestRunRes?.gpn_count ?? 0),
    pricedOpnCount: Number(aggs.priced_opns) || 0,
    inStockOpnCount: inStock,
    outOfStockOpnCount: outOfStock,
    inStockPct: opnCount > 0 ? Math.round((inStock / opnCount) * 10000) / 100 : 0,
    outOfStockPct: opnCount > 0 ? Math.round((outOfStock / opnCount) * 10000) / 100 : 0,
    totalQuantity: Number(aggs.total_quantity) || 0,
    medianNormalizedUnitPrice: medianRes?.p ?? null,
    minNormalizedUnitPrice: aggs.min_price,
    maxNormalizedUnitPrice: aggs.max_price,
    latestCapturedAt: aggs.latest_captured_at,
    nextSafeCatalogRunAt: quota.nextSafeRunAt,
    minutesUntilSafe: quota.minutesUntilSafe,
  })
})

// GET /api/ti/universe/catalog/gpn-leaderboard — public, sanitized.
// Sort options:
//   inventory_desc (default) — highest total stock first
//   price_asc                — cheapest entry-point first (min_normalized_unit_price ASC, NULLs last)
//   max_price_desc           — most expensive variant first (true MAX(normalized_unit_price) per
//                              GPN via subquery, NULLs last). Phase 24E.1 — replaces the prior
//                              `price_desc` (which actually sorted by min DESC, not max)
//                              so the dropdown can honestly label two distinct views as
//                              "Min price" and "Max price".
//   out_of_stock             — fully out-of-stock GPNs first (opn_count - stocked_opn_count DESC)
//   variants_desc            — by opn_count DESC (which families have the most variants)
const GPN_LEADERBOARD_SORTS: Record<string, string> = {
  inventory_desc: 'ORDER BY COALESCE(total_quantity, 0) DESC',
  price_asc:      'ORDER BY min_normalized_unit_price IS NULL, min_normalized_unit_price ASC',
  max_price_desc: 'ORDER BY max_normalized_unit_price IS NULL, max_normalized_unit_price DESC',
  out_of_stock:   'ORDER BY (opn_count - stocked_opn_count) DESC, opn_count DESC',
  variants_desc:  'ORDER BY opn_count DESC',
}
// Phase 24E.1 — keep `price_desc` as a quiet alias for `max_price_desc` so any
// pre-existing bookmarks / external callers that still pass `?sort=price_desc`
// keep working with the new (and more honest) max-price semantics.
const GPN_LEADERBOARD_SORT_ALIASES: Record<string, string> = {
  price_desc: 'max_price_desc',
}
app.get('/api/ti/universe/catalog/gpn-leaderboard', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as unknown as CatalogReadD1
  const sortInput = (c.req.query('sort') || 'inventory_desc').toLowerCase()
  const sortRaw = GPN_LEADERBOARD_SORT_ALIASES[sortInput] ?? sortInput
  const orderBy = GPN_LEADERBOARD_SORTS[sortRaw] ?? GPN_LEADERBOARD_SORTS.inventory_desc
  const limitRaw = parseInt(c.req.query('limit') || '50', 10) || 50
  const limit = Math.max(1, Math.min(200, limitRaw))
  // Phase 24E.1 — JOIN ti_catalog_latest_opn to surface the true MAX
  // normalized unit price per GPN. The subquery is one hash-aggregate
  // pass over the OPN table (~72k rows in production), then a hash join
  // against ti_catalog_latest_gpn (~26k rows). Comfortably inside D1's
  // per-statement CPU budget for a SELECT.
  const sql =
    `SELECT gpn.generic_part_number, gpn.opn_count, gpn.stocked_opn_count, gpn.total_quantity,
            gpn.min_normalized_unit_price, gpn.median_normalized_unit_price,
            opn_max.max_normalized_unit_price,
            gpn.cheapest_opn, gpn.highest_inventory_opn, gpn.lifecycle_summary, gpn.latest_captured_at
     FROM ti_catalog_latest_gpn gpn
     LEFT JOIN (
       SELECT generic_part_number,
              MAX(normalized_unit_price) AS max_normalized_unit_price
         FROM ti_catalog_latest_opn
        WHERE normalized_unit_price IS NOT NULL
          AND generic_part_number IS NOT NULL
        GROUP BY generic_part_number
     ) opn_max ON opn_max.generic_part_number = gpn.generic_part_number
     ${orderBy}
     LIMIT ?`
  const result = await d1.prepare(sql).bind(limit).all<GpnRow & { max_normalized_unit_price: number | null }>()
  return c.json({
    success: true,
    sort: sortRaw in GPN_LEADERBOARD_SORTS ? sortRaw : 'inventory_desc',
    limit,
    rows: (result.results ?? []).map(publicGpnRow),
  })
})

// GET /api/ti/universe/catalog/search?q= — public, sanitized.
// Substring search across ti_part_number, generic_part_number, description.
// Returns ≤50 OPN rows. Empty / very short queries return no results so a
// page-load auto-fire doesn't drag back the entire 72k-row table.
app.get('/api/ti/universe/catalog/search', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as unknown as CatalogReadD1
  const qRaw = (c.req.query('q') || '').trim()
  if (qRaw.length < 2) {
    return c.json({ success: true, query: qRaw, rows: [], note: 'query must be at least 2 characters' })
  }
  // Cap the query length so a runaway client can't push a multi-MB
  // pattern into LIKE. 100 chars is comfortably more than any TI
  // part-number or descriptive substring needs.
  const q = qRaw.slice(0, 100)
  const pattern = `%${q}%`
  const result = await d1.prepare(
    `SELECT ti_part_number, generic_part_number, description, quantity, limit_qty,
            pricing_json, normalized_unit_price, normalized_price_qty, currency,
            future_inventory_json, minimum_order_quantity, standard_pack_quantity,
            lifecycle, buy_now_url, latest_captured_at
     FROM ti_catalog_latest_opn
     WHERE ti_part_number      LIKE ? COLLATE NOCASE
        OR generic_part_number LIKE ? COLLATE NOCASE
        OR description         LIKE ? COLLATE NOCASE
     ORDER BY
       CASE WHEN ti_part_number = ? COLLATE NOCASE THEN 0
            WHEN ti_part_number LIKE ? COLLATE NOCASE THEN 1
            ELSE 2 END,
       quantity DESC NULLS LAST
     LIMIT 50`,
  ).bind(pattern, pattern, pattern, q, `${q}%`).all<OpnRow>()
  return c.json({
    success: true,
    query: q,
    rows: (result.results ?? []).map(publicOpnRow),
  })
})

// GET /api/ti/universe/catalog/part/:opn — public, sanitized.
// Exact-match OPN lookup. Returns 404 when the OPN isn't in the latest
// catalog snapshot.
app.get('/api/ti/universe/catalog/part/:opn', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as unknown as CatalogReadD1
  const opnRaw = c.req.param('opn') || ''
  const opn = decodeURIComponent(opnRaw).trim()
  if (!opn) {
    return c.json({ success: false, status: 'invalid_payload', message: 'opn path param required.' }, 400)
  }
  const row = await d1.prepare(
    `SELECT ti_part_number, generic_part_number, description, quantity, limit_qty,
            pricing_json, normalized_unit_price, normalized_price_qty, currency,
            future_inventory_json, minimum_order_quantity, standard_pack_quantity,
            lifecycle, buy_now_url, latest_captured_at
     FROM ti_catalog_latest_opn
     WHERE ti_part_number = ?
     LIMIT 1`,
  ).bind(opn).first<OpnRow>()
  if (!row) {
    return c.json({ success: false, status: 'not_found', tiPartNumber: opn, message: 'OPN not present in the latest catalog snapshot.' }, 404)
  }
  return c.json({ success: true, part: publicOpnRow(row) })
})

// GET /api/ti/universe/catalog/family/:gpn — public, sanitized.
// GPN aggregate row + every OPN variant under that family. Two reads,
// both index-backed.
app.get('/api/ti/universe/catalog/family/:gpn', async (c) => {
  const env = c.env
  if (!env.TI_INVENTORY_HISTORY_DB) {
    return c.json({ success: false, status: 'd1_not_bound', message: 'TI_INVENTORY_HISTORY_DB not bound; catalog tables unavailable.' }, 503)
  }
  const d1 = env.TI_INVENTORY_HISTORY_DB as unknown as CatalogReadD1
  const gpnRaw = c.req.param('gpn') || ''
  const gpn = decodeURIComponent(gpnRaw).trim()
  if (!gpn) {
    return c.json({ success: false, status: 'invalid_payload', message: 'gpn path param required.' }, 400)
  }
  const [aggRow, variantsResult] = await Promise.all([
    d1.prepare(
      `SELECT generic_part_number, opn_count, stocked_opn_count, total_quantity,
              min_normalized_unit_price, median_normalized_unit_price,
              cheapest_opn, highest_inventory_opn, lifecycle_summary, latest_captured_at
       FROM ti_catalog_latest_gpn
       WHERE generic_part_number = ?
       LIMIT 1`,
    ).bind(gpn).first<GpnRow>(),
    d1.prepare(
      `SELECT ti_part_number, generic_part_number, description, quantity, limit_qty,
              pricing_json, normalized_unit_price, normalized_price_qty, currency,
              future_inventory_json, minimum_order_quantity, standard_pack_quantity,
              lifecycle, buy_now_url, latest_captured_at
       FROM ti_catalog_latest_opn
       WHERE generic_part_number = ?
       ORDER BY quantity DESC NULLS LAST, ti_part_number ASC`,
    ).bind(gpn).all<OpnRow>(),
  ])
  if (!aggRow) {
    return c.json({ success: false, status: 'not_found', genericPartNumber: gpn, message: 'GPN not present in the latest catalog snapshot.' }, 404)
  }
  const variants = (variantsResult.results ?? []).map(publicOpnRow)
  // Derive on-the-fly counters that are nice for the UI (the GPN row
  // already carries stocked_opn_count, but the inverse + variant-level
  // diagnostics save the client another pass).
  const stocked = variants.filter(v => v.quantity != null && v.quantity > 0).length
  const outOfStock = variants.filter(v => v.quantity === 0).length
  const cheapest = variants.find(v => v.tiPartNumber === aggRow.cheapest_opn) ?? null
  const highest = variants.find(v => v.tiPartNumber === aggRow.highest_inventory_opn) ?? null
  return c.json({
    success: true,
    family: publicGpnRow(aggRow),
    variantCount: variants.length,
    stockedVariantCount: stocked,
    outOfStockVariantCount: outOfStock,
    cheapestVariant: cheapest,
    highestInventoryVariant: highest,
    variants,
  })
})

// Phase 22.2 — POST /api/ti/inventory/staged/validate
// Auth-gated batch validator for the staged 68 parts. Calls Product Info
// + Store Inventory & Pricing for each candidate OPN in the requested
// slice and returns a sanitized per-part validation row. Never writes to
// D1 or KV; never auto-promotes anything. Promotion happens via a code
// commit after the operator reviews the results.
//
// Query params:
//   subset = high | medium | all   (default 'high')
//   offset = 0 (default)           — index into the deterministic OPN-sorted slice
//   limit  = 1..8 (default 8)      — clamped to 8 to mirror the inventory-capture
//                                     batching budget.
//
// Per-part validation result:
//   'validated'         — Product Info ok AND Store Inventory ok AND a
//                         normalized unit price was parsed.
//   'failed'            — Product Info or Store Inventory returned an HTTP
//                         error (404, 401/403, 5xx, unreachable). The OPN
//                         is wrong or unauthorised; replacement needed.
//   'needs_replacement' — Both endpoints returned 200 but no usable price
//                         break could be parsed (TI doesn't carry pricing
//                         for this OPN — pick a similar SKU instead).
app.post('/api/ti/inventory/staged/validate', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const subsetRaw = (c.req.query('subset') || 'high').toLowerCase()
  const subset: 'high' | 'medium' | 'all' =
    subsetRaw === 'medium' ? 'medium' : subsetRaw === 'all' ? 'all' : 'high'
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
  const limitRaw = parseInt(c.req.query('limit') || '8', 10) || 8
  const limit = Math.max(1, Math.min(8, limitRaw))

  // Stable input list — sort by OPN so offset/limit pagination is
  // reproducible across calls (the operator can rely on the same 8 parts
  // appearing for the same offset).
  const allStaged = getStagedWatchedParts()
    .slice()
    .sort((a, b) => a.preferredOrderablePartNumber.localeCompare(b.preferredOrderablePartNumber))
  const filtered = subset === 'all'
    ? allStaged
    : allStaged.filter(p => (p.confidence ?? 'high') === subset)
  const slice = filtered.slice(offset, offset + limit)
  const nextOffset = offset + slice.length
  const done = nextOffset >= filtered.length

  type ValidationResult = 'validated' | 'failed' | 'needs_replacement'
  type Row = {
    opn: string
    genericPartNumber: string
    basket: string
    subcategory: string | null
    confidence: 'high' | 'medium'
    productInfoStatus: string
    inventoryStatus: string
    quantityAvailable: number | null
    pricingAvailability: string
    normalizedUnitPrice: number | null
    normalizedPriceQty: number | null
    currency: string | null
    lifecycleStatus: string | null
    validationStatus: ValidationResult
    issue: string | null
  }
  const results: Row[] = []
  for (const part of slice) {
    const opn = part.preferredOrderablePartNumber
    // Run Product Info + the sanitized inventory diagnostic in parallel.
    // The diagnostic re-implements the production parser path so it tells
    // us exactly what the next live capture would see for this OPN.
    const [productInfo, debug] = await Promise.all([
      fetchTiProductInfo(env, opn),
      fetchTiInventoryPricingDebug(env, opn),
    ])
    const productOk = productInfo.status === 'ok'
    const inventoryOk = debug.status === 'ok'
    const priced = inventoryOk && (debug.parserOutput.priceBreaksCount ?? 0) > 0
    let validationStatus: ValidationResult
    let issue: string | null = null
    if (!productOk) {
      validationStatus = 'failed'
      issue = `Product Info ${productInfo.status}` +
        (productInfo.diagnostics?.sanitizedMessage ? ` — ${productInfo.diagnostics.sanitizedMessage}` : '')
    } else if (!inventoryOk) {
      validationStatus = 'failed'
      issue = `Store Inventory ${debug.status}` +
        (debug.sanitizedMessage ? ` — ${debug.sanitizedMessage}` : '')
    } else if (!priced) {
      validationStatus = 'needs_replacement'
      issue = `TI Store returned 200 but no normalized price break parsed (${debug.diagnosis}).`
    } else {
      validationStatus = 'validated'
      issue = null
    }
    results.push({
      opn,
      genericPartNumber: part.genericPartNumber,
      basket: part.basket,
      subcategory: part.subcategory ?? null,
      confidence: part.confidence ?? 'high',
      productInfoStatus: productInfo.status,
      inventoryStatus: debug.status,
      quantityAvailable: debug.parserOutput.quantityAvailable,
      pricingAvailability: debug.parserOutput.pricingAvailability,
      normalizedUnitPrice: debug.parserOutput.normalizedUnitPrice,
      normalizedPriceQty: debug.parserOutput.normalizedPriceQty,
      currency: debug.parserOutput.normalizedCurrency,
      lifecycleStatus: productInfo.lifecycleStatus,
      validationStatus,
      issue,
    })
  }
  const summary = {
    subsetTotal: filtered.length,
    sliceSize: slice.length,
    validated: results.filter(r => r.validationStatus === 'validated').length,
    failed: results.filter(r => r.validationStatus === 'failed').length,
    needsReplacement: results.filter(r => r.validationStatus === 'needs_replacement').length,
  }
  return c.json({
    success: true,
    note: 'Read-only — never writes D1 or KV; never auto-promotes. Promotion happens via code commit after operator review.',
    subset,
    offset,
    limit,
    nextOffset,
    done,
    summary,
    results,
  })
})

// GET /api/ti/inventory-pricing?partNumber=XYZ — auth-gated.
// Until TI Store API approval lands AND operator flips TI_STORE_API_ENABLED,
// returns status: pending_approval without contacting TI.
app.get('/api/ti/inventory-pricing', async (c) => {
  const env = c.env
  if (!env.SNAPSHOT_CAPTURE_SECRET) {
    return c.json({
      success: false, status: 'capture_secret_not_configured',
      message: 'Set SNAPSHOT_CAPTURE_SECRET in Cloudflare Pages env vars before invoking.',
    })
  }
  const providedRaw = c.req.header('x-capture-secret') || c.req.query('secret') || ''
  const provided = providedRaw.trim()
  const expected = (env.SNAPSHOT_CAPTURE_SECRET || '').trim()
  if (!provided || !expected || provided !== expected) {
    return c.json({ success: false, status: 'unauthorized' }, 401)
  }
  const partNumber = (c.req.query('partNumber') || '').trim()
  if (!partNumber) {
    return c.json({ success: false, status: 'invalid_payload', message: 'partNumber query param required.' }, 400)
  }
  const result = await fetchTiInventoryPricing(env, partNumber)
  return c.json({ success: result.status === 'ok', ...result })
})

// GET /api/snapshots/evidence/latest — current-source evidence layer (Phase 14A).
// Reads the latest snapshot only. Never calls Nexar, never triggers capture.
// Pairs with /api/snapshots/trends so the UI can show evidence today AND keep
// shortage/easing labels gated behind the 2-snapshot trend readiness signal.
app.get('/api/snapshots/evidence/latest', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)
  // Coverage is static catalog data — available regardless of KV state.
  const earlySampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    policy: 'anchor_plus_rotation',
  })
  const earlyCoverage = {
    basketCatalogSkuCount: earlySampling.basketCatalogSkuCount,
    sampledSkuCount: earlySampling.sampledSkuCount,
    unsampledSkuCount: earlySampling.unsampledSkuCount,
    sampleLimit: earlySampling.sampleLimit,
    sampleLimitReason: earlySampling.sampleLimitReason,
    samplingPolicy: earlySampling.policy,
    rotationIndex: earlySampling.rotationIndex,
    estimatedFullCycleDays: earlySampling.estimatedFullCycleDays,
  }
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      latestSnapshotDate: null,
      evidence: null,
      coverage: earlyCoverage,
      trendReadiness: {
        status: 'pending_until_two_snapshots',
        observationCount: 0,
        firstDate: null,
        latestDate: null,
      },
      ...base,
    })
  }

  const dates = await listSnapshotDates(env.SOURCE_SNAPSHOTS_KV)
  const trendReadiness = {
    status: dates.length >= 2 ? 'ready' as const : 'pending_until_two_snapshots' as const,
    observationCount: dates.length,
    firstDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
  }

  // Phase 15A/15B — basket-coverage is a static catalog reflection. Compute it
  // upfront so it's available on every branch (no_snapshots and ok alike).
  const sampling = selectSampledSkus(PHASE_8_BASKET_PREVIEW, {
    maxCalls: BASKET_PREVIEW_MAX_CALLS,
    policy: 'anchor_plus_rotation',
  })
  const coverage = {
    basketCatalogSkuCount: sampling.basketCatalogSkuCount,
    sampledSkuCount: sampling.sampledSkuCount,
    unsampledSkuCount: sampling.unsampledSkuCount,
    sampleLimit: sampling.sampleLimit,
    sampleLimitReason: sampling.sampleLimitReason,
    samplingPolicy: sampling.policy,
    rotationIndex: sampling.rotationIndex,
    estimatedFullCycleDays: sampling.estimatedFullCycleDays,
  }

  const snap = await getLatestSnapshot(env.SOURCE_SNAPSHOTS_KV)
  if (!snap) {
    return c.json({
      configured: true,
      status: 'no_snapshots',
      latestSnapshotDate: null,
      evidence: null,
      coverage,
      trendReadiness,
      ...base,
    })
  }

  const evidence = deriveSnapshotEvidence(snap)
  return c.json({
    configured: true,
    status: 'ok',
    latestSnapshotDate: snap.snapshotDate,
    evidence,
    coverage,
    trendReadiness,
    ...base,
  })
})

// ── Phase 23C.6 — TI watched-part subcategory → canonical taxonomy mapping ───
// Bridges the freeform `WatchedSubcategory` strings used in tiWatchedParts.ts
// (e.g. "Op-amps", "Buck converters") to the 28 canonical subcategory IDs
// the Mouser/Nexar evidence table is keyed on. Approximate where TI's labels
// are coarser than the canonical taxonomy — the goal is a directional TI
// data point alongside Mouser+Nexar, not pixel-perfect taxonomy alignment.
const TI_SUBCATEGORY_TO_CANONICAL: Record<string, string> = {
  // Power
  'LDO regulators': 'power_ldo',
  'Buck converters': 'power_dcdc_switching',
  'Buck-boost converters': 'power_dcdc_switching',
  'Boost converters': 'power_dcdc_switching',
  'PFC controllers': 'power_acdc_switching',
  'Supervisors': 'power_supervisor_reset',
  'Safety PMIC': 'power_supervisor_reset',
  'Battery management': 'power_battery_mgmt',
  'LED drivers': 'power_dcdc_switching',
  'Motor drivers': 'power_dcdc_switching',
  // Data center power
  'Hot-swap / eFuse': 'dc_efuses',
  'Gate drivers': 'dc_smart_power_stages',
  'Multi-phase VR': 'dc_tps536xx_ai_power',
  'Power stages': 'dc_smart_power_stages',
  'Bus converters': 'dc_48v_bus',
  // GaN / discrete
  'GaN power': 'gan_lmg342x',
  'Power MOSFETs': 'gan_lmg5200',
  // Amplifiers
  'Op-amps': 'amp_opamps',
  'Instrumentation amps': 'amp_instrumentation',
  'Audio amps': 'amp_audio',
  'Current/power monitors': 'amp_opamps',
  // Data converters
  'ADCs': 'conv_adc',
  'DACs': 'conv_dac',
  // Isolation
  'Isolation amps': 'isolation_reinforced',
  'Digital isolators': 'isolation_digital',
  // Interface
  'CAN/LIN transceivers': 'interface_can',
  'RS-485 transceivers': 'interface_can',
  'Ethernet PHYs': 'interface_ethernet_phy',
  'PoE controllers': 'interface_ethernet_phy',
  'Clock distribution': 'interface_ethernet_phy',
  // Microcontrollers / wireless
  'Embedded MCU': 'mcu_mspm0',
  'Safety MCU': 'mcu_c2000',
  'Embedded MPU': 'mcu_sitara',
  'Wireless MCU': 'mcu_simplelink',
  'RF transceivers': 'mcu_simplelink',
  'RF synthesizers': 'mcu_simplelink',
  'Radar': 'mcu_simplelink',
}

/** Build {partNumber|genericPartNumber → canonicalCategoryId} once per
 *  request. Uppercases both keys so lookups against the TI snapshot
 *  shape (which preserves whatever case TI returns) always hit. */
function buildTiPartToCanonical(): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of TI_WATCHED_PARTS) {
    const sub = part.subcategory
    if (!sub) continue
    const canonical = TI_SUBCATEGORY_TO_CANONICAL[sub]
    if (!canonical) continue
    if (part.preferredOrderablePartNumber) {
      map.set(part.preferredOrderablePartNumber.toUpperCase(), canonical)
    }
    if (part.genericPartNumber) {
      map.set(part.genericPartNumber.toUpperCase(), canonical)
    }
  }
  return map
}

// ── Phase 16A — combined Mouser + Nexar evidence ─────────────────────────────
// Reads BOTH the latest Mouser full snapshot and the latest Nexar rotating
// snapshot; computes a per-canonical-subcategory agreement table. Read-only,
// never calls Nexar, never triggers capture.
//
// Phase 23C.6 — also reads the latest TI direct-Store inventory snapshot and
// aggregates per-part `normalizedUnitPrice` + `quantityAvailable` into the
// same canonical buckets so the tooltip can show TI direct alongside Mouser
// and Nexar. Reuses the in-memory KV snapshot (no extra TI API calls).
app.get('/api/snapshots/evidence/combined', async (c) => {
  const env = c.env
  const base = snapshotMemoryBaseEnv(env)

  const repBasketCanonicalIds = Array.from(
    new Set(
      PHASE_8_BASKET_PREVIEW.map(b =>
        b.canonicalCategoryId ?? canonicalCategoryId(b.categoryId),
      ),
    ),
  )
  const taxonomyCoverage = summarizeTaxonomyCoverage({
    representativeBasketSubcategories: repBasketCanonicalIds,
  })

  if (!env.SOURCE_SNAPSHOTS_KV) {
    return c.json({
      configured: false,
      status: 'snapshot_storage_not_configured',
      latestMouserSnapshotDate: null,
      latestNexarSnapshotDate: null,
      taxonomyCoverage,
      mouserCoverage: null,
      nexarCoverage: null,
      combinedCoverage: null,
      sourceAgreement: [],
      trendReadiness: {
        mouser: { status: 'no_data', observationCount: 0, firstDate: null, latestDate: null },
        nexar: { status: 'no_data', observationCount: 0, firstDate: null, latestDate: null },
      },
      sourceTrendStatus: 'pending',
      manualSources: { digikey_manual: null, arrow_manual: null, ti_manual: null, other_manual: null },
      manualSourceStatus: 'no_manual_sources',
      notes: COMBINED_EVIDENCE_NOTES,
      ...base,
    })
  }

  // Phase 17A — fetch RECENT snapshots (windowed) so we can compute trends in
  // the same call. Two KV list-and-fetch round trips total; no Nexar calls.
  // Phase 18A — also pull the latest snapshot per manual source (one KV op
  // each via `getLatestSnapshotFor`'s internal list+get; KV is cheap).
  const TREND_WINDOW_DAYS = 30
  const [mouserSnaps, nexarSnaps, dkManualSnap, arManualSnap, tiManualSnap, otManualSnap, tiDirectSnap] = await Promise.all([
    getRecentSnapshotsFor(env.SOURCE_SNAPSHOTS_KV, MOUSER_SOURCE, MOUSER_MODE, TREND_WINDOW_DAYS),
    getRecentSnapshotsFor(env.SOURCE_SNAPSHOTS_KV, 'octopart_nexar', 'representative_basket_preview', TREND_WINDOW_DAYS),
    getLatestSnapshotFor(env.SOURCE_SNAPSHOTS_KV, 'digikey_manual', MANUAL_MODE),
    getLatestSnapshotFor(env.SOURCE_SNAPSHOTS_KV, 'arrow_manual', MANUAL_MODE),
    getLatestSnapshotFor(env.SOURCE_SNAPSHOTS_KV, 'ti_manual', MANUAL_MODE),
    getLatestSnapshotFor(env.SOURCE_SNAPSHOTS_KV, 'other_manual', MANUAL_MODE),
    // Phase 23C.6 — pull the latest TI direct-Store inventory snapshot
    // alongside the other source snapshots so we can fold direct TI
    // pricing into the same per-canonical agreement table. Reuses the
    // already-captured KV blob; no live TI API calls.
    readLatestInventorySnapshot(env.SOURCE_SNAPSHOTS_KV),
  ])
  const mouserSnap: Snapshot | null = mouserSnaps.length > 0 ? mouserSnaps[mouserSnaps.length - 1] : null
  const nexarSnap: Snapshot | null = nexarSnaps.length > 0 ? nexarSnaps[nexarSnaps.length - 1] : null
  const manualSnaps: Record<ManualSource, Snapshot | null> = {
    digikey_manual: dkManualSnap,
    arrow_manual: arManualSnap,
    ti_manual: tiManualSnap,
    other_manual: otManualSnap,
  }

  // Build per-canonical lookups.
  const mouserByCanonical = new Map<string, { categoryLabel: string; price: number | null; inventory: number }>()
  for (const cat of mouserSnap?.categories ?? []) {
    const id = cat.canonicalCategoryId ?? canonicalCategoryId(cat.categoryId)
    mouserByCanonical.set(id, {
      categoryLabel: cat.categoryLabel,
      price: cat.avgBestTrustedAvailableUnitPrice ?? cat.medianBestTrustedAvailableUnitPrice ?? null,
      inventory: cat.totalTrustedAvailableInventory ?? 0,
    })
  }
  const nexarByCanonical = new Map<string, { categoryLabel: string; price: number | null; inventory: number }>()
  for (const cat of nexarSnap?.categories ?? []) {
    const id = cat.canonicalCategoryId ?? canonicalCategoryId(cat.categoryId)
    nexarByCanonical.set(id, {
      categoryLabel: cat.categoryLabel,
      price: cat.avgBestTrustedAvailableUnitPrice ?? cat.medianBestTrustedAvailableUnitPrice ?? null,
      inventory: cat.totalTrustedAvailableInventory ?? 0,
    })
  }

  // Phase 23C.6 — aggregate TI direct-Store snapshot rows per canonical
  // subcategory. For each watched part with a usable normalizedUnitPrice
  // (qty=1 break parsed from TI Store), bucket by its mapped canonical id
  // and accumulate sum/count for averaging. Inventory is summed (not
  // averaged) so the TI line reflects total stock surfaced by TI direct
  // for that subcategory — directly comparable to Mouser's
  // totalTrustedAvailableInventory.
  const tiPartToCanonical = buildTiPartToCanonical()
  const tiAgg = new Map<string, { priceSum: number; priceCount: number; inventory: number; sampleSize: number }>()
  for (const part of tiDirectSnap?.parts ?? []) {
    const opn = part.partNumber?.toUpperCase()
    const gpn = part.genericPartNumber?.toUpperCase() ?? null
    const canonical = (opn && tiPartToCanonical.get(opn)) || (gpn && tiPartToCanonical.get(gpn)) || null
    if (!canonical) continue
    const bucket = tiAgg.get(canonical) ?? { priceSum: 0, priceCount: 0, inventory: 0, sampleSize: 0 }
    bucket.sampleSize += 1
    if (typeof part.normalizedUnitPrice === 'number' && part.normalizedUnitPrice > 0) {
      bucket.priceSum += part.normalizedUnitPrice
      bucket.priceCount += 1
    }
    if (typeof part.quantityAvailable === 'number' && part.quantityAvailable >= 0) {
      bucket.inventory += part.quantityAvailable
    }
    tiAgg.set(canonical, bucket)
  }
  const tiByCanonical = new Map<string, { price: number | null; inventory: number; sampleSize: number }>()
  for (const [canonical, b] of tiAgg.entries()) {
    tiByCanonical.set(canonical, {
      price: b.priceCount > 0 ? Math.round((b.priceSum / b.priceCount) * 10000) / 10000 : null,
      inventory: b.inventory,
      sampleSize: b.sampleSize,
    })
  }
  const latestTiDirectSnapshotDate = tiDirectSnap?.capturedAt ? tiDirectSnap.capturedAt.slice(0, 10) : null

  const sourceAgreement = TI_TAXONOMY_FLAT.map(sub => {
    const m = mouserByCanonical.get(sub.categoryId) ?? null
    const n = nexarByCanonical.get(sub.categoryId) ?? null
    const t = tiByCanonical.get(sub.categoryId) ?? null
    let priceDeltaPct: number | null = null
    if (m?.price != null && n?.price != null && m.price > 0) {
      priceDeltaPct = Math.round(((n.price - m.price) / m.price) * 1000) / 10
    }
    let inventoryDeltaPct: number | null = null
    if (m && n && m.inventory > 0) {
      inventoryDeltaPct = Math.round(((n.inventory - m.inventory) / m.inventory) * 1000) / 10
    }
    // Phase 23C.6 — TI direct deltas vs Mouser backbone. Mouser is the
    // anchor because it has full daily coverage; TI direct is a sparse
    // sample over the watched-parts universe. Δ %s use the same
    // formula as Mouser↔Nexar so the tooltip can compare them eyeball.
    let tiPriceDeltaPctVsMouser: number | null = null
    if (t?.price != null && m?.price != null && m.price > 0) {
      tiPriceDeltaPctVsMouser = Math.round(((t.price - m.price) / m.price) * 1000) / 10
    }
    let tiInventoryDeltaPctVsMouser: number | null = null
    if (t && m && m.inventory > 0) {
      tiInventoryDeltaPctVsMouser = Math.round(((t.inventory - m.inventory) / m.inventory) * 1000) / 10
    }
    // Phase 23C.6 — agreement classification now considers TI direct
    // when a usable price exists. Tolerance bands (±5% strong, ±15%
    // moderate) match the Mouser↔Nexar logic. With three sources we
    // count how many price points fall inside the strong band to pick
    // the headline status.
    let agreementStatus:
      | 'strong_agreement'
      | 'moderate_agreement'
      | 'divergent'
      | 'single_source_only'
      | 'insufficient_data' = 'insufficient_data'
    const pricedSources: Array<{ key: 'mouser' | 'nexar' | 'ti'; price: number }> = []
    if (m?.price != null) pricedSources.push({ key: 'mouser', price: m.price })
    if (n?.price != null) pricedSources.push({ key: 'nexar', price: n.price })
    if (t?.price != null) pricedSources.push({ key: 'ti', price: t.price })
    if (pricedSources.length >= 2) {
      // Pairwise % deltas vs Mouser anchor when present, else vs the first
      // priced source. Anything within ±5% counts as strong; ±15% moderate.
      const anchor = (pricedSources.find(p => p.key === 'mouser') ?? pricedSources[0]).price
      const deltas = pricedSources
        .filter(p => p.price !== anchor)
        .map(p => Math.abs(((p.price - anchor) / anchor) * 100))
      const allStrong = deltas.every(d => d <= 5)
      const allModerate = deltas.every(d => d <= 15)
      if (allStrong) agreementStatus = 'strong_agreement'
      else if (allModerate) agreementStatus = 'moderate_agreement'
      else agreementStatus = 'divergent'
    } else if (pricedSources.length === 1) {
      agreementStatus = 'single_source_only'
    }
    return {
      canonicalCategoryId: sub.categoryId,
      categoryLabel: sub.categoryLabel,
      groupId: sub.groupId,
      groupLabel: sub.groupLabel,
      mouserPrice: m?.price ?? null,
      nexarTrustedPrice: n?.price ?? null,
      priceDeltaPct,
      mouserInventory: m?.inventory ?? null,
      nexarTrustedInventory: n?.inventory ?? null,
      inventoryDeltaPct,
      // Phase 23C.6 — direct TI Store fields. Null when no watched part
      // with a parsed normalizedUnitPrice maps to this canonical bucket.
      tiDirectPrice: t?.price ?? null,
      tiDirectInventory: t?.inventory ?? null,
      tiDirectSampleSize: t?.sampleSize ?? 0,
      tiPriceDeltaPctVsMouser,
      tiInventoryDeltaPctVsMouser,
      agreementStatus,
    }
  })

  const mouserCoverage = mouserSnap
    ? mouserCanonicalCoverageSummary(mouserSnap)
    : null
  const nexarCoverage = nexarSnap
    ? {
        canonicalSubcategoryCount: TI_TAXONOMY_SUBCATEGORY_COUNT,
        nexarSampledCanonicalSubcategories: Array.from(
          new Set(
            (nexarSnap.categories ?? []).map(c =>
              c.canonicalCategoryId ?? canonicalCategoryId(c.categoryId),
            ),
          ),
        ),
      }
    : null

  const combinedCanonicalIds = Array.from(
    new Set([
      ...(mouserCoverage?.mouserCoveredCanonicalSubcategories ?? []),
      ...(nexarCoverage?.nexarSampledCanonicalSubcategories ?? []),
    ]),
  )
  const combinedCoverage = {
    canonicalSubcategoryCount: TI_TAXONOMY_SUBCATEGORY_COUNT,
    coveredAnySource: combinedCanonicalIds.length,
    coveredBothSources: sourceAgreement.filter(
      r => r.mouserPrice != null && r.nexarTrustedPrice != null,
    ).length,
    coveredCanonicalSubcategories: combinedCanonicalIds,
  }

  const status =
    !mouserSnap && !nexarSnap
      ? 'no_snapshots'
      : !mouserSnap
        ? 'nexar_only'
        : !nexarSnap
          ? 'mouser_only'
          : 'ok'

  // Embed the legacy → canonical map so clients can resolve cell IDs without
  // having to ship the taxonomy module to the browser.
  const legacyToCanonical: Record<string, string> = {}
  for (const id of Object.keys(PART_MAP)) {
    legacyToCanonical[id] = canonicalCategoryId(id)
  }
  for (const b of PHASE_8_BASKET_PREVIEW) {
    legacyToCanonical[b.categoryId] = b.canonicalCategoryId ?? canonicalCategoryId(b.categoryId)
  }

  // ── Phase 17A — trend computation per source + per-row resolution ────────
  // Run the existing trend engine over each source's window. Keys are
  // canonical-id → trend so the consumer (and the Source Agreement Table)
  // can join without consulting legacyToCanonical.
  const mouserTrendsRaw = computeTrends(mouserSnaps, TREND_WINDOW_DAYS)
  const nexarTrendsRaw = computeTrends(nexarSnaps, TREND_WINDOW_DAYS)
  const buildTrendMap = (trends: typeof mouserTrendsRaw) => {
    const m = new Map<string, typeof trends.categoryTrends[number]>()
    for (const t of trends.categoryTrends) {
      const id = t.canonicalCategoryId ?? canonicalCategoryId(t.categoryId)
      m.set(id, t)
    }
    return m
  }
  const mouserTrendByCanonical = buildTrendMap(mouserTrendsRaw)
  const nexarTrendByCanonical = buildTrendMap(nexarTrendsRaw)

  // A trend is "useful" only when both price AND inventory % changes were
  // computable from the trend engine (i.e. there were non-null comparable
  // values at both endpoints). 'insufficient_history' / null Δs are not used.
  const isTrendUseful = (t: typeof mouserTrendsRaw.categoryTrends[number] | undefined): boolean => {
    if (!t) return false
    if (t.signal === 'insufficient_history') return false
    return t.priceChangePct != null && t.inventoryChangePct != null
  }

  // "Disagree" only when both have a NON-mixed, NON-insufficient signal that
  // is materially different. mixed itself is not a disagreement marker.
  const trendsDisagree = (a: string, b: string): boolean => {
    const trivial = new Set(['mixed', 'insufficient_history'])
    if (trivial.has(a) || trivial.has(b)) return false
    return a !== b
  }

  type TrendConfidence = 'high' | 'medium' | 'low' | 'pending'
  type RowTrend = {
    signal: typeof mouserTrendsRaw.categoryTrends[number]['signal']
    source: 'mouser' | 'nexar' | null
    priceChangePct: number | null
    inventoryChangePct: number | null
    firstDate: string | null
    latestDate: string | null
    /** When both sources produced a usable trend, expose both for tooltip detail. */
    mouserSignal: string | null
    nexarSignal: string | null
    sourcesDisagree: boolean
    /** Number of dated snapshots powering the chosen source's trend. */
    observationCount: number
    /** Phase 17B — confidence framing for the chosen trend label. */
    trendConfidence: TrendConfidence
    trendConfidenceReason: string
    /** 0–100; pending 0–25, low 35–50, medium 60–75, high 80–95. */
    confidenceScore: number
  }

  // Resolve confidence for a row's trend. Trend logic itself is unchanged —
  // this only categorizes the existing signal + source picture.
  function resolveTrendConfidence(
    signal: string,
    sourcesDisagree: boolean,
    mUsefulHere: boolean,
    nUsefulHere: boolean,
    chosenObservationCount: number,
    mouserSignal: string | null,
    nexarSignal: string | null,
  ): { trendConfidence: TrendConfidence; trendConfidenceReason: string; confidenceScore: number } {
    if (signal === 'insufficient_history') {
      return {
        trendConfidence: 'pending',
        trendConfidenceReason: 'Needs 2 dated snapshots from at least one source.',
        confidenceScore: 10,
      }
    }
    if (sourcesDisagree) {
      // Both sources are useful but disagree on direction. Per spec, confidence
      // is medium or low depending on source coverage; keep at low so the
      // disagreement is visibly cautious.
      return {
        trendConfidence: 'low',
        trendConfidenceReason:
          `Sources disagree on direction (Mouser: ${mouserSignal ?? '—'}; Nexar: ${nexarSignal ?? '—'}). Treat as low-confidence.`,
        confidenceScore: 45,
      }
    }
    if (mUsefulHere && nUsefulHere) {
      return {
        trendConfidence: 'high',
        trendConfidenceReason: 'Both Mouser and Nexar trends agree on direction.',
        confidenceScore: 85,
      }
    }
    if (mUsefulHere) {
      return {
        trendConfidence: 'medium',
        trendConfidenceReason: 'Mouser backbone trend; Nexar corroboration not yet available for this category.',
        confidenceScore: 65,
      }
    }
    if (nUsefulHere) {
      if (chosenObservationCount >= 3) {
        return {
          trendConfidence: 'medium',
          trendConfidenceReason: 'Nexar trend with 3+ dated snapshots; Mouser corroboration not yet available.',
          confidenceScore: 65,
        }
      }
      return {
        trendConfidence: 'low',
        trendConfidenceReason: 'Early Nexar-only trend; Mouser backbone needs another dated snapshot.',
        confidenceScore: 40,
      }
    }
    return {
      trendConfidence: 'pending',
      trendConfidenceReason: 'No usable trend yet.',
      confidenceScore: 0,
    }
  }

  // Decorate each existing sourceAgreement row with a `trend` object.
  const sourceAgreementWithTrend = sourceAgreement.map(row => {
    const m = mouserTrendByCanonical.get(row.canonicalCategoryId)
    const n = nexarTrendByCanonical.get(row.canonicalCategoryId)
    const mUseful = isTrendUseful(m)
    const nUseful = isTrendUseful(n)
    let trend: RowTrend
    if (mUseful && nUseful) {
      const disagree = trendsDisagree(m!.signal, n!.signal)
      const conf = resolveTrendConfidence(
        disagree ? 'mixed' : m!.signal,
        disagree,
        true, true,
        m!.observationCount,
        m!.signal,
        n!.signal,
      )
      trend = {
        signal: disagree ? 'mixed' : m!.signal,
        source: 'mouser',
        priceChangePct: m!.priceChangePct,
        inventoryChangePct: m!.inventoryChangePct,
        firstDate: m!.firstDate,
        latestDate: m!.latestDate,
        mouserSignal: m!.signal,
        nexarSignal: n!.signal,
        sourcesDisagree: disagree,
        observationCount: m!.observationCount,
        ...conf,
      }
    } else if (mUseful) {
      const conf = resolveTrendConfidence(
        m!.signal, false, true, false,
        m!.observationCount,
        m!.signal, null,
      )
      trend = {
        signal: m!.signal,
        source: 'mouser',
        priceChangePct: m!.priceChangePct,
        inventoryChangePct: m!.inventoryChangePct,
        firstDate: m!.firstDate,
        latestDate: m!.latestDate,
        mouserSignal: m!.signal,
        nexarSignal: null,
        sourcesDisagree: false,
        observationCount: m!.observationCount,
        ...conf,
      }
    } else if (nUseful) {
      const conf = resolveTrendConfidence(
        n!.signal, false, false, true,
        n!.observationCount,
        null, n!.signal,
      )
      trend = {
        signal: n!.signal,
        source: 'nexar',
        priceChangePct: n!.priceChangePct,
        inventoryChangePct: n!.inventoryChangePct,
        firstDate: n!.firstDate,
        latestDate: n!.latestDate,
        mouserSignal: null,
        nexarSignal: n!.signal,
        sourcesDisagree: false,
        observationCount: n!.observationCount,
        ...conf,
      }
    } else {
      // No usable trend yet — needs ≥2 dated snapshots from at least one source.
      const conf = resolveTrendConfidence(
        'insufficient_history', false, false, false, 0,
        m?.signal ?? null, n?.signal ?? null,
      )
      trend = {
        signal: 'insufficient_history',
        source: null,
        priceChangePct: null,
        inventoryChangePct: null,
        firstDate: null,
        latestDate: null,
        mouserSignal: m?.signal ?? null,
        nexarSignal: n?.signal ?? null,
        sourcesDisagree: false,
        observationCount: 0,
        ...conf,
      }
    }
    return { ...row, trend }
  })

  // ── Phase 18A — manual evidence join + corroboration tags ────────────────
  // Manual sources are NOT used to override Mouser trend or change
  // agreementStatus — they only ADD context per row plus a top-level summary.
  type ManualEvidenceRow = {
    source: ManualSource
    distributor: string | null
    unitPrice: number | null
    availableInventory: number | null
    leadTimeDays: number | null
    observedAt: string | null
    priceDeltaVsMouserPct: number | null
    inventoryDeltaVsMouserPct: number | null
  }
  type AgreementCorroboration = {
    corroboratingSourceCount: number
    divergentManualSourceCount: number
    manualSourcesPresent: ManualSource[]
    warning: string | null
  }
  // Build per-canonical lookup tables for each manual source's category-level
  // price + inventory + first observation. We pick the category whose
  // canonicalCategoryId matches; manual snapshots already populate it via
  // `aggregateCategory` in manualSnapshotImport.ts.
  function manualByCanonical(snap: Snapshot | null): Map<string, { distributor: string | null; price: number | null; inventory: number; leadTimeDays: number | null; observedAt: string | null }> {
    const m = new Map<string, { distributor: string | null; price: number | null; inventory: number; leadTimeDays: number | null; observedAt: string | null }>()
    if (!snap) return m
    for (const cat of snap.categories ?? []) {
      const id = cat.canonicalCategoryId ?? canonicalCategoryId(cat.categoryId)
      // Pick first SKU's first observation for distributor + observedAt + lead time;
      // use the category's avg price as the row representative price.
      const sku0 = cat.skus?.[0]
      const obs0 = sku0?.sourceObservations?.[0] ?? null
      m.set(id, {
        distributor: obs0?.distributor ?? null,
        price: cat.avgBestTrustedAvailableUnitPrice ?? cat.medianBestTrustedAvailableUnitPrice ?? sku0?.bestAnyUnitPrice ?? obs0?.unitPrice ?? null,
        inventory: cat.totalTrustedAvailableInventory ?? 0,
        leadTimeDays: obs0?.leadTimeDays ?? null,
        observedAt: obs0?.observedAt ?? snap.capturedAt ?? null,
      })
    }
    return m
  }
  const manualLookups: Record<ManualSource, ReturnType<typeof manualByCanonical>> = {
    digikey_manual: manualByCanonical(manualSnaps.digikey_manual),
    arrow_manual: manualByCanonical(manualSnaps.arrow_manual),
    ti_manual: manualByCanonical(manualSnaps.ti_manual),
    other_manual: manualByCanonical(manualSnaps.other_manual),
  }

  const sourceAgreementWithManual = sourceAgreementWithTrend.map(row => {
    const mouserPrice = row.mouserPrice
    const mouserInventory = row.mouserInventory ?? 0
    const manualEvidence: ManualEvidenceRow[] = []
    let corroborating = 0
    let divergent = 0
    const presentSources: ManualSource[] = []
    for (const src of ALLOWED_MANUAL_SOURCES) {
      const hit = manualLookups[src].get(row.canonicalCategoryId)
      if (!hit) continue
      presentSources.push(src)
      let priceDelta: number | null = null
      if (mouserPrice != null && hit.price != null && mouserPrice > 0) {
        priceDelta = Math.round(((hit.price - mouserPrice) / mouserPrice) * 1000) / 10
      }
      let inventoryDelta: number | null = null
      if (mouserInventory > 0 && typeof hit.inventory === 'number') {
        inventoryDelta = Math.round(((hit.inventory - mouserInventory) / mouserInventory) * 1000) / 10
      }
      manualEvidence.push({
        source: src,
        distributor: hit.distributor,
        unitPrice: hit.price,
        availableInventory: hit.inventory,
        leadTimeDays: hit.leadTimeDays,
        observedAt: hit.observedAt,
        priceDeltaVsMouserPct: priceDelta,
        inventoryDeltaVsMouserPct: inventoryDelta,
      })
      // Corroboration tagging vs Mouser only — Nexar's sparse rotation
      // already has its own treatment in `agreementStatus`.
      if (priceDelta != null) {
        if (Math.abs(priceDelta) <= 5) corroborating++
        else if (Math.abs(priceDelta) > 15) divergent++
      }
    }
    const agreementCorroboration: AgreementCorroboration = {
      corroboratingSourceCount: corroborating,
      divergentManualSourceCount: divergent,
      manualSourcesPresent: presentSources,
      warning: divergent > 0 ? 'manual_source_divergence' : null,
    }
    return { ...row, manualEvidence, agreementCorroboration }
  })

  // Top-level summary block per manual source (latest dates + counts).
  const manualSources: Record<ManualSource, { latestSnapshotDate: string; categoryCount: number; skuCount: number } | null> = {
    digikey_manual: manualSnaps.digikey_manual ? {
      latestSnapshotDate: manualSnaps.digikey_manual.snapshotDate,
      categoryCount: manualSnaps.digikey_manual.categoryCount,
      skuCount: manualSnaps.digikey_manual.skuCount,
    } : null,
    arrow_manual: manualSnaps.arrow_manual ? {
      latestSnapshotDate: manualSnaps.arrow_manual.snapshotDate,
      categoryCount: manualSnaps.arrow_manual.categoryCount,
      skuCount: manualSnaps.arrow_manual.skuCount,
    } : null,
    ti_manual: manualSnaps.ti_manual ? {
      latestSnapshotDate: manualSnaps.ti_manual.snapshotDate,
      categoryCount: manualSnaps.ti_manual.categoryCount,
      skuCount: manualSnaps.ti_manual.skuCount,
    } : null,
    other_manual: manualSnaps.other_manual ? {
      latestSnapshotDate: manualSnaps.other_manual.snapshotDate,
      categoryCount: manualSnaps.other_manual.categoryCount,
      skuCount: manualSnaps.other_manual.skuCount,
    } : null,
  }
  const manualSourceStatus: 'manual_sources_available' | 'no_manual_sources' =
    Object.values(manualSources).some(v => v != null) ? 'manual_sources_available' : 'no_manual_sources'

  // Phase 17B — top-level confidence histogram for the summary line above the table.
  const trendConfidenceCounts = sourceAgreementWithManual.reduce(
    (acc, r) => {
      const c = r.trend?.trendConfidence ?? 'pending'
      acc[c] = (acc[c] ?? 0) + 1
      return acc
    },
    { high: 0, medium: 0, low: 0, pending: 0 } as Record<TrendConfidence, number>,
  )

  // Trend readiness per source — same shape /api/snapshots/trends already returns.
  const trendReadiness = {
    mouser: {
      status: mouserTrendsRaw.status,
      observationCount: mouserTrendsRaw.observationCount,
      firstDate: mouserTrendsRaw.firstDate,
      latestDate: mouserTrendsRaw.latestDate,
    },
    nexar: {
      status: nexarTrendsRaw.status,
      observationCount: nexarTrendsRaw.observationCount,
      firstDate: nexarTrendsRaw.firstDate,
      latestDate: nexarTrendsRaw.latestDate,
    },
  }
  const mReady = mouserTrendsRaw.status === 'ok'
  const nReady = nexarTrendsRaw.status === 'ok'
  const sourceTrendStatus: 'mouser_ready' | 'nexar_ready' | 'both_ready' | 'pending' =
    mReady && nReady ? 'both_ready'
      : mReady ? 'mouser_ready'
        : nReady ? 'nexar_ready'
          : 'pending'

  return c.json({
    configured: true,
    status,
    latestMouserSnapshotDate: mouserSnap?.snapshotDate ?? null,
    latestNexarSnapshotDate: nexarSnap?.snapshotDate ?? null,
    // Phase 23C.6 — date the TI direct-Store inventory snapshot was
    // captured (UTC day). Null when no TI capture has run yet. Drives
    // the "TI direct latest" line in the Combined source evidence
    // tooltip; the per-row tiDirectPrice/tiDirectInventory fields
    // surface the actual numbers.
    latestTiDirectSnapshotDate,
    taxonomyCoverage,
    mouserCoverage,
    nexarCoverage,
    combinedCoverage,
    sourceAgreement: sourceAgreementWithManual,
    trendReadiness,
    sourceTrendStatus,
    trendConfidenceCounts,
    manualSources,
    manualSourceStatus,
    legacyToCanonical,
    notes: COMBINED_EVIDENCE_NOTES,
    ...base,
  })
})

const COMBINED_EVIDENCE_NOTES = [
  'Mouser is the full free backbone.',
  'Nexar is quota-limited rotating corroboration.',
  'Broker inventory excluded from core signal.',
  'Canonical taxonomy has 28 subcategories.',
] as const

// ── Phase 21K — scheduled daily capture ─────────────────────────────────────
// One cron tick handles one batch of 8 parts. Four ticks spaced 15 min apart
// rotate through the watched universe so a single Worker invocation never
// exceeds the subrequest cap. The manual operator capture endpoint is
// untouched; the scheduled handler runs the exact same captureWatchedPartsBatch
// path. Diagnostics (last run, status, rows inserted, backend, failures) are
// persisted to KV under a known key so a public status endpoint can expose
// them without leaking secrets.

const SCHEDULED_CAPTURE_STATE_KEY = 'source-snapshots/texas_instruments/ti_direct_inventory/scheduled-capture/state'

const SCHEDULED_OFFSET_BY_CRON: Record<string, number> = {
  '0 4 * * *': 0,
  '15 4 * * *': 8,
  '30 4 * * *': 16,
  '45 4 * * *': 24,
}

const SCHEDULED_BATCH_LIMIT = 8

// Phase 21B.1 — number of distinct offsets that make up a complete daily
// cycle (matches the four-batch GitHub Actions workflow). Used by the
// schedule/status aggregator to decide when an external daily run is
// "complete" (offsetsCovered === this value).
const SCHEDULED_DAILY_OFFSET_COUNT = Object.keys(SCHEDULED_OFFSET_BY_CRON).length

type ScheduledCaptureRunRecord = {
  cron: string
  scheduledAt: string
  startedAt: string
  finishedAt: string
  offset: number
  limit: number
  attempted: number
  captured: number
  failed: number
  stale: number
  rowsInsertedToHistory: number
  historyBackend: 'd1' | 'kv' | 'none'
  historyErrors: string[]
  status: 'ok' | 'partial' | 'error' | 'no_kv' | 'no_secret'
  errorMessage: string | null
}

// Phase 21K.2 — external-runner capture record. The /api/ti/inventory/capture
// endpoint is invoked by the GitHub Actions daily workflow and the operator
// UI; both produce successful captures that should bump the cumulative row
// counter. Tracking those alongside scheduled() runs gives the schedule/status
// endpoint a complete picture of what's actually writing to D1.
export type ExternalCaptureRunRecord = {
  source: 'github_actions_daily' | 'operator_ui' | 'unknown_external'
  finishedAt: string
  offset: number
  limit: number
  attempted: number
  captured: number
  failed: number
  stale: number
  rowsInsertedToHistory: number
  historyBackend: 'd1' | 'kv' | 'none'
  /** Phase 21B — number of persisted signal rows rewritten by this batch.
   *  Lets schedule/status surface signal-pipeline health alongside the
   *  history-write counters. Older records (pre-21B) won't have this field;
   *  consumers should treat null/undefined as "not reported". */
  signalsPersisted?: number
  status: 'ok' | 'partial' | 'error'
}

// Phase 21B.1 — aggregate of all batches in a single multi-batch external
// daily run (e.g. the four offsets the GitHub Action POSTs sequentially).
// Holds running totals plus a per-batch trail for debug visibility. A new
// aggregate replaces the previous one for the same source whenever a batch
// arrives with offset === 0 (the daily-run reset signal).
export type ExternalDailyRunBatchSummary = {
  offset: number
  limit: number
  finishedAt: string
  attempted: number
  captured: number
  failed: number
  stale: number
  rowsInsertedToHistory: number
  signalsPersisted: number
  historyBackend: 'd1' | 'kv' | 'none'
  status: 'ok' | 'partial' | 'error'
}

export type ExternalDailyRunAggregate = {
  source: 'github_actions_daily' | 'operator_ui' | 'unknown_external'
  startedAt: string
  finishedAt: string
  offsetsCovered: number
  attempted: number
  captured: number
  failed: number
  stale: number
  rowsInsertedToHistory: number
  signalsPersisted: number
  historyBackend: 'd1' | 'kv' | 'none'
  status: 'ok' | 'partial' | 'error' | 'in_progress'
  batches: ExternalDailyRunBatchSummary[]
}

type ScheduledCaptureState = {
  lastRunByCron: Record<string, ScheduledCaptureRunRecord>
  lastRun: ScheduledCaptureRunRecord | null
  cumulativeRowsInserted: number
  /** Phase 21K.2 — most recent external-runner batch (GitHub Actions or
   *  operator UI). Kept for back-compat with pre-21B.1 readers; new code
   *  should prefer the aggregate below. */
  lastExternalRun: ExternalCaptureRunRecord | null
  /** Phase 21B.1 — per-source aggregate of the most recent multi-batch
   *  daily run. Replaces the prior single-batch lastExternalRunBySource
   *  semantic so the operator/customer view can see the full daily picture
   *  (4 batches × 8 parts = 32 captured) instead of just the final batch. */
  lastExternalRunBySource: Record<string, ExternalDailyRunAggregate>
}

async function readScheduledState(kv: SnapshotKV | undefined): Promise<ScheduledCaptureState> {
  const empty: ScheduledCaptureState = {
    lastRunByCron: {},
    lastRun: null,
    cumulativeRowsInserted: 0,
    lastExternalRun: null,
    lastExternalRunBySource: {},
  }
  if (!kv) return empty
  try {
    const raw = await kv.get(SCHEDULED_CAPTURE_STATE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        lastRunByCron: parsed.lastRunByCron && typeof parsed.lastRunByCron === 'object' ? parsed.lastRunByCron : {},
        lastRun: parsed.lastRun ?? null,
        cumulativeRowsInserted: typeof parsed.cumulativeRowsInserted === 'number' ? parsed.cumulativeRowsInserted : 0,
        lastExternalRun: parsed.lastExternalRun ?? null,
        lastExternalRunBySource: parsed.lastExternalRunBySource && typeof parsed.lastExternalRunBySource === 'object'
          // Phase 21B.1 — legacy entries here used to be a single
          // ExternalCaptureRunRecord per source. Wrap any such legacy entry
          // in a one-batch aggregate so the new readers don't see undefined
          // batches[]/offsetsCovered fields. Real aggregates already match
          // the new shape and pass through unchanged.
          ? coerceLastExternalRunBySource(parsed.lastExternalRunBySource)
          : {},
      }
    }
  } catch { /* ignore */ }
  return empty
}

function coerceLastExternalRunBySource(
  raw: Record<string, any>,
): Record<string, ExternalDailyRunAggregate> {
  const out: Record<string, ExternalDailyRunAggregate> = {}
  for (const [source, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value.batches)) {
      // Already an aggregate — accept verbatim.
      out[source] = value as ExternalDailyRunAggregate
    } else if (typeof value.offset === 'number' && typeof value.captured === 'number') {
      // Legacy single-batch record. Wrap it as a 1-batch aggregate so
      // pre-21B.1 KV state stays meaningful after the deploy.
      const batch: ExternalDailyRunBatchSummary = {
        offset: value.offset,
        limit: value.limit ?? SCHEDULED_BATCH_LIMIT,
        finishedAt: value.finishedAt ?? '',
        attempted: value.attempted ?? 0,
        captured: value.captured ?? 0,
        failed: value.failed ?? 0,
        stale: value.stale ?? 0,
        rowsInsertedToHistory: value.rowsInsertedToHistory ?? 0,
        signalsPersisted: typeof value.signalsPersisted === 'number' ? value.signalsPersisted : 0,
        historyBackend: value.historyBackend ?? 'none',
        status: value.status ?? 'ok',
      }
      out[source] = {
        source: (value.source ?? source) as ExternalDailyRunAggregate['source'],
        startedAt: batch.finishedAt,
        finishedAt: batch.finishedAt,
        offsetsCovered: 1,
        attempted: batch.attempted,
        captured: batch.captured,
        failed: batch.failed,
        stale: batch.stale,
        rowsInsertedToHistory: batch.rowsInsertedToHistory,
        signalsPersisted: batch.signalsPersisted,
        historyBackend: batch.historyBackend,
        status: batch.status === 'error' ? 'error' : (batch.status === 'partial' ? 'partial' : 'ok'),
        batches: [batch],
      }
    }
  }
  return out
}

async function writeScheduledState(kv: SnapshotKV, state: ScheduledCaptureState): Promise<void> {
  try {
    await kv.put(SCHEDULED_CAPTURE_STATE_KEY, JSON.stringify(state))
  } catch { /* swallow — diagnostics are best-effort */ }
}

/** Phase 21K.2 — record a successful external capture (GitHub Actions / UI)
 *  into the same KV state the scheduled handler uses, so cumulativeRowsInserted
 *  reflects total D1 history inserts regardless of which path drove them.
 *
 *  Phase 21B.1 — also maintain a per-source multi-batch aggregate so
 *  /schedule/status can show the full daily run (4 batches × 8 parts = 32
 *  captured) instead of just the most recent batch. A new aggregate starts
 *  when offset === 0 (the daily-run reset signal); subsequent batches in
 *  the same cycle append to it.
 *
 *  Best-effort: KV failures never break the capture response. */
async function recordExternalCapture(
  env: Bindings,
  record: ExternalCaptureRunRecord,
): Promise<void> {
  if (!env.SOURCE_SNAPSHOTS_KV) return
  try {
    const state = await readScheduledState(env.SOURCE_SNAPSHOTS_KV)
    const aggregate = mergeBatchIntoAggregate(state.lastExternalRunBySource[record.source], record)
    const next: ScheduledCaptureState = {
      ...state,
      cumulativeRowsInserted: (state.cumulativeRowsInserted || 0) + (record.rowsInsertedToHistory || 0),
      lastExternalRun: record,
      lastExternalRunBySource: { ...state.lastExternalRunBySource, [record.source]: aggregate },
    }
    await writeScheduledState(env.SOURCE_SNAPSHOTS_KV, next)
  } catch { /* swallow */ }
}

function mergeBatchIntoAggregate(
  prior: ExternalDailyRunAggregate | undefined,
  record: ExternalCaptureRunRecord,
): ExternalDailyRunAggregate {
  const batchSummary: ExternalDailyRunBatchSummary = {
    offset: record.offset,
    limit: record.limit,
    finishedAt: record.finishedAt,
    attempted: record.attempted,
    captured: record.captured,
    failed: record.failed,
    stale: record.stale,
    rowsInsertedToHistory: record.rowsInsertedToHistory,
    signalsPersisted: record.signalsPersisted ?? 0,
    historyBackend: record.historyBackend,
    status: record.status,
  }
  // offset === 0 is the daily-run reset signal. Without a prior aggregate,
  // also start fresh. Otherwise, append (replacing any prior entry for the
  // same offset so a re-run of one batch doesn't double-count).
  const isFreshCycle = !prior || record.offset === 0
  const batches = isFreshCycle
    ? [batchSummary]
    : [...prior!.batches.filter(b => b.offset !== record.offset), batchSummary]
  // Sort by offset so the operator sees the natural 0/8/16/24 order.
  batches.sort((a, b) => a.offset - b.offset)

  const sum = (key: keyof ExternalDailyRunBatchSummary) =>
    batches.reduce((acc, b) => acc + (typeof b[key] === 'number' ? (b[key] as number) : 0), 0)
  const distinctOffsets = new Set(batches.map(b => b.offset))
  const startedAt = batches[0]?.finishedAt ?? batchSummary.finishedAt
  const finishedAt = batches[batches.length - 1]?.finishedAt ?? batchSummary.finishedAt
  const anyError = batches.some(b => b.status === 'error') || sum('failed') > 0
  const anyStale = sum('stale') > 0
  const status: ExternalDailyRunAggregate['status'] = anyError
    ? 'error'
    : anyStale
      ? 'partial'
      : (distinctOffsets.size >= SCHEDULED_DAILY_OFFSET_COUNT ? 'ok' : 'in_progress')

  return {
    source: record.source,
    startedAt,
    finishedAt,
    offsetsCovered: distinctOffsets.size,
    attempted: sum('attempted'),
    captured: sum('captured'),
    failed: sum('failed'),
    stale: sum('stale'),
    rowsInsertedToHistory: sum('rowsInsertedToHistory'),
    signalsPersisted: sum('signalsPersisted'),
    historyBackend: record.historyBackend,
    status,
    batches,
  }
}

/** Phase 21K.2 — heuristic to label the caller of /api/ti/inventory/capture.
 *  GitHub Actions sets a recognizable User-Agent containing "GitHub-Hookshot"
 *  / "actions" / "curl"; browser POSTs from Operator Tools come from the
 *  app's fetch which has a Mozilla-style UA. Anything that doesn't match is
 *  filed under unknown_external. The label is purely diagnostic — every
 *  caller still has to satisfy the X-Capture-Secret check. */
function classifyCaptureCallerSource(userAgent: string | undefined): ExternalCaptureRunRecord['source'] {
  const ua = (userAgent || '').toLowerCase()
  if (ua.includes('github') || ua.includes('actions') || (ua.includes('curl') && !ua.includes('mozilla'))) {
    return 'github_actions_daily'
  }
  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox') || ua.includes('webkit')) {
    return 'operator_ui'
  }
  return 'unknown_external'
}

async function runScheduledCapture(env: Bindings, controller: { cron: string; scheduledTime: number }): Promise<ScheduledCaptureRunRecord> {
  const startedAt = new Date().toISOString()
  const offset = SCHEDULED_OFFSET_BY_CRON[controller.cron] ?? 0
  const baseRecord: ScheduledCaptureRunRecord = {
    cron: controller.cron,
    scheduledAt: new Date(controller.scheduledTime).toISOString(),
    startedAt,
    finishedAt: startedAt,
    offset,
    limit: SCHEDULED_BATCH_LIMIT,
    attempted: 0,
    captured: 0,
    failed: 0,
    stale: 0,
    rowsInsertedToHistory: 0,
    historyBackend: 'none',
    historyErrors: [],
    status: 'error',
    errorMessage: null,
  }
  if (!env.SOURCE_SNAPSHOTS_KV) {
    return { ...baseRecord, status: 'no_kv', errorMessage: 'SOURCE_SNAPSHOTS_KV binding missing.' }
  }
  // Reuse the existing watched-universe inputs and the exact same capture
  // path the operator UI uses — no new TI API surface, no new auth, no
  // capture-all behavior.
  const watchedInputs = getWatchedPartsCaptureInputs()
  const inputs = watchedInputs.length > 0 ? watchedInputs : [WATCHED_PARTS_FALLBACK_SEED]
  let batch
  try {
    batch = await captureWatchedPartsBatch(env, env.SOURCE_SNAPSHOTS_KV, inputs, offset, SCHEDULED_BATCH_LIMIT)
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message.slice(0, 200) : 'capture exception'
    return { ...baseRecord, status: 'error', errorMessage: msg }
  }
  const merged = await readLatestInventorySnapshot(env.SOURCE_SNAPSHOTS_KV)
  const orderableSet = buildCurrentOrderableSet(inputs)
  const filtered = filterSnapshotByOrderableSet(merged?.parts ?? [], orderableSet)
  const sliceSet = new Set(inputs.slice(batch.offset, batch.offset + batch.attemptedThisBatch).map(p => p.partNumber.toUpperCase()))
  const historyRows: HistoryRow[] = filtered.kept
    .filter(p => sliceSet.has((p.partNumber || '').toUpperCase()))
    .map(p => toHistoryRow(p, batch.capturedAt))
  const history = await appendInventoryHistory(historyRows, {
    d1: env.TI_INVENTORY_HISTORY_DB,
    kv: env.SOURCE_SNAPSHOTS_KV as unknown as HistoryKV,
  })
  const finishedAt = new Date().toISOString()
  return {
    ...baseRecord,
    finishedAt,
    attempted: batch.attemptedThisBatch,
    captured: batch.capturedThisBatch,
    failed: batch.failedThisBatch,
    stale: batch.staleThisBatch,
    rowsInsertedToHistory: history.rowsAppended,
    historyBackend: history.backend,
    historyErrors: history.errors,
    status: batch.failedThisBatch === 0 ? 'ok' : 'partial',
    errorMessage: null,
  }
}

// GET /api/ti/scheduled/status — Phase 21K backup route, also public.
// Mirrors the canonical /api/ti/inventory/schedule/status payload at a
// shorter path so the operator can quickly distinguish a deploy issue
// from a routing issue. If only one of the two returns 200 we know the
// router is fine; if both 404, the deploy itself didn't ship.
app.get('/api/ti/scheduled/status', async (c) => {
  const env = c.env
  const state = await readScheduledState(env.SOURCE_SNAPSHOTS_KV)
  const cronList = Object.keys(SCHEDULED_OFFSET_BY_CRON)
  // Phase 21B.1 — same aggregate-pick as the canonical endpoint so both
  // mirrors agree on the daily-run summary fields.
  const aggregates = Object.values(state.lastExternalRunBySource)
  const latestAggregate = aggregates.length === 0
    ? null
    : aggregates.reduce((a, b) => (a.finishedAt > b.finishedAt ? a : b))
  const scheduledAt = state.lastRun?.finishedAt ?? null
  const externalAt = latestAggregate?.finishedAt ?? state.lastExternalRun?.finishedAt ?? null
  const lastAt = scheduledAt && externalAt
    ? (scheduledAt > externalAt ? scheduledAt : externalAt)
    : (scheduledAt ?? externalAt)
  return c.json({
    ok: true,
    scheduledEnabled: true,
    backend: state.lastRun?.historyBackend
      ?? latestAggregate?.historyBackend
      ?? state.lastExternalRun?.historyBackend
      ?? (env.TI_INVENTORY_HISTORY_DB ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'),
    cronsConfigured: cronList,
    offsetsCovered: latestAggregate?.offsetsCovered ?? null,
    capturedParts: latestAggregate?.captured ?? null,
    failedParts: latestAggregate?.failed ?? null,
    staleParts: latestAggregate?.stale ?? null,
    rowsInsertedToHistory: latestAggregate?.rowsInsertedToHistory ?? null,
    signalsPersisted: latestAggregate?.signalsPersisted ?? null,
    lastCaptureAt: lastAt,
    lastScheduledCaptureAt: scheduledAt,
    lastScheduledCaptureStatus: state.lastRun?.status ?? null,
    lastExternalCaptureAt: externalAt,
    lastExternalCaptureStatus: latestAggregate?.status ?? state.lastExternalRun?.status ?? null,
    lastExternalCaptureSource: latestAggregate?.source ?? state.lastExternalRun?.source ?? null,
    cumulativeRowsInserted: state.cumulativeRowsInserted,
    note: 'Mirror of /api/ti/inventory/schedule/status. Cloudflare Pages cron is wired via .github/workflows/ti-inventory-capture.yml — wrangler.jsonc triggers.crons is Workers-only and is intentionally not set here. cumulativeRowsInserted counts D1 history inserts across all paths (scheduled handler + external runners).',
  })
})

// GET /api/ti/inventory/schedule/status — public, sanitized.
// Reports the most recent run of the daily scheduled capture per cron, plus
// a cumulative rows-inserted counter and the active history backend. No
// secrets, no token, no raw TI bodies. Operators can poll this to confirm
// the cron stack is firing without needing the operator-tools UI.
app.get('/api/ti/inventory/schedule/status', async (c) => {
  const env = c.env
  const state = await readScheduledState(env.SOURCE_SNAPSHOTS_KV)
  const cronList = Object.keys(SCHEDULED_OFFSET_BY_CRON)
  const lastRun = state.lastRun
  const lastByCron = cronList.map(cron => ({
    cron,
    offset: SCHEDULED_OFFSET_BY_CRON[cron],
    lastRun: state.lastRunByCron[cron] ?? null,
  }))
  // Phase 21B.1 — pick the most recent external daily-run aggregate across
  // all sources so the top-level fields describe the full daily cycle (4
  // batches × 8 parts = 32 captured) rather than just the latest single
  // batch. The per-source map below still exposes each source's aggregate
  // with its batches[] trail for debug visibility.
  const aggregates = Object.values(state.lastExternalRunBySource)
  const latestAggregate = aggregates.length === 0
    ? null
    : aggregates.reduce(
        (a, b) => (a.finishedAt > b.finishedAt ? a : b),
      )
  const scheduledAt = lastRun?.finishedAt ?? null
  const externalAt = latestAggregate?.finishedAt ?? state.lastExternalRun?.finishedAt ?? null
  const overallAt = scheduledAt && externalAt
    ? (scheduledAt > externalAt ? scheduledAt : externalAt)
    : (scheduledAt ?? externalAt)
  // offsetsCovered repurposed in Phase 21B.1: now reflects the most recent
  // external daily run if we have one (matches the 4-batch GH Actions
  // path), otherwise falls back to the legacy "scheduled crons that have
  // fired" meaning. lastRunByCron below still exposes cron-only state.
  const offsetsCovered = latestAggregate?.offsetsCovered
    ?? cronList.filter(k => !!state.lastRunByCron[k]).length
  // Phase 22.5 — surface the *active* scheduler so the UI doesn't conflate
  // the in-Cloudflare cron list (intentionally not wired in production)
  // with the GitHub Actions workflow that actually drives daily capture.
  // The cron schedule is also explicitly tagged as "not active in
  // production" so an operator reading the JSON doesn't get confused.
  const externalSource = latestAggregate?.source ?? state.lastExternalRun?.source ?? null
  const activeScheduler: 'github_actions_dynamic' | 'cloudflare_cron' | 'none' =
    externalSource === 'github_actions_daily'
      ? 'github_actions_dynamic'
      : (lastRun ? 'cloudflare_cron' : 'none')
  const activeSchedulerLabel = activeScheduler === 'github_actions_dynamic'
    ? 'GitHub Actions (dynamic batching, totalParts derived from /watched-parts/catalog)'
    : activeScheduler === 'cloudflare_cron'
      ? 'Cloudflare Pages cron (in-Cloudflare scheduled handler)'
      : 'No active scheduler — no captures recorded yet.'
  return c.json({
    success: true,
    // Phase 22.5 — top-level scheduler clarity.
    activeScheduler,
    activeSchedulerLabel,
    dynamicBatching: activeScheduler === 'github_actions_dynamic',
    cronSchedule: cronList,
    cronScheduleNote: 'In-Cloudflare cron entries — defined for reference, NOT the active scheduler when activeScheduler==="github_actions_dynamic". Daily capture is driven by the GitHub Actions workflow ti-inventory-capture.yml.',
    offsetsConfigured: cronList.length,
    offsetsCovered,
    // Phase 21B.1 — daily-run aggregate fields (most recent external run).
    // Null when no external runs have been recorded yet.
    capturedParts: latestAggregate?.captured ?? null,
    failedParts: latestAggregate?.failed ?? null,
    staleParts: latestAggregate?.stale ?? null,
    rowsInsertedToHistory: latestAggregate?.rowsInsertedToHistory ?? null,
    signalsPersisted: latestAggregate?.signalsPersisted ?? null,
    lastCaptureAt: overallAt,
    lastScheduledCaptureAt: scheduledAt,
    lastScheduledCaptureStatus: lastRun?.status ?? null,
    lastExternalCaptureAt: externalAt,
    lastExternalCaptureStatus: latestAggregate?.status ?? state.lastExternalRun?.status ?? null,
    lastExternalCaptureSource: latestAggregate?.source ?? state.lastExternalRun?.source ?? null,
    lastExternalRunBySource: state.lastExternalRunBySource,
    cumulativeRowsInserted: state.cumulativeRowsInserted,
    backend: lastRun?.historyBackend
      ?? latestAggregate?.historyBackend
      ?? state.lastExternalRun?.historyBackend
      ?? (env.TI_INVENTORY_HISTORY_DB ? 'd1' : env.SOURCE_SNAPSHOTS_KV ? 'kv' : 'none'),
    lastRunByCron: lastByCron,
  })
})

export default {
  fetch: app.fetch,
  // Cloudflare invokes scheduled() with a ScheduledController exposing
  // `cron` (the matched expression) and `scheduledTime` (epoch ms). We map
  // the cron expression to one of the four watched-universe offsets and
  // run a single batch — keeps the Worker invocation lean and never
  // approaches the subrequest cap.
  scheduled: async (
    controller: { cron: string; scheduledTime: number },
    env: Bindings,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ) => {
    const work = async () => {
      const record = await runScheduledCapture(env, controller)
      if (env.SOURCE_SNAPSHOTS_KV) {
        const state = await readScheduledState(env.SOURCE_SNAPSHOTS_KV)
        const next: ScheduledCaptureState = {
          lastRunByCron: { ...state.lastRunByCron, [record.cron]: record },
          lastRun: record,
          cumulativeRowsInserted: (state.cumulativeRowsInserted || 0) + (record.rowsInsertedToHistory || 0),
        }
        await writeScheduledState(env.SOURCE_SNAPSHOTS_KV, next)
      }
    }
    ctx.waitUntil(work())
  },
}
