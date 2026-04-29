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

type Bindings = {
  MOUSER_API_KEY: string
  NEXAR_CLIENT_ID?: string
  NEXAR_CLIENT_SECRET?: string
  /** Shared secret for POST /api/snapshots/capture. */
  SNAPSHOT_CAPTURE_SECRET?: string
  /** Cloudflare KV binding for durable source-memory snapshots. */
  SOURCE_SNAPSHOTS_KV?: SnapshotKV
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
      qoqPct: baseline > 0 ? Math.round(((r.price - baseline) / baseline) * 1000) / 10 : null,
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

// ── Phase 16A — combined Mouser + Nexar evidence ─────────────────────────────
// Reads BOTH the latest Mouser full snapshot and the latest Nexar rotating
// snapshot; computes a per-canonical-subcategory agreement table. Read-only,
// never calls Nexar, never triggers capture.
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
      notes: COMBINED_EVIDENCE_NOTES,
      ...base,
    })
  }

  // Phase 17A — fetch RECENT snapshots (windowed) so we can compute trends in
  // the same call. Two KV list-and-fetch round trips total; no Nexar calls.
  const TREND_WINDOW_DAYS = 30
  const [mouserSnaps, nexarSnaps] = await Promise.all([
    getRecentSnapshotsFor(env.SOURCE_SNAPSHOTS_KV, MOUSER_SOURCE, MOUSER_MODE, TREND_WINDOW_DAYS),
    getRecentSnapshotsFor(env.SOURCE_SNAPSHOTS_KV, 'octopart_nexar', 'representative_basket_preview', TREND_WINDOW_DAYS),
  ])
  const mouserSnap: Snapshot | null = mouserSnaps.length > 0 ? mouserSnaps[mouserSnaps.length - 1] : null
  const nexarSnap: Snapshot | null = nexarSnaps.length > 0 ? nexarSnaps[nexarSnaps.length - 1] : null

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

  const sourceAgreement = TI_TAXONOMY_FLAT.map(sub => {
    const m = mouserByCanonical.get(sub.categoryId) ?? null
    const n = nexarByCanonical.get(sub.categoryId) ?? null
    let priceDeltaPct: number | null = null
    if (m?.price != null && n?.price != null && m.price > 0) {
      priceDeltaPct = Math.round(((n.price - m.price) / m.price) * 1000) / 10
    }
    let inventoryDeltaPct: number | null = null
    if (m && n && m.inventory > 0) {
      inventoryDeltaPct = Math.round(((n.inventory - m.inventory) / m.inventory) * 1000) / 10
    }
    let agreementStatus:
      | 'strong_agreement'
      | 'moderate_agreement'
      | 'divergent'
      | 'single_source_only'
      | 'insufficient_data' = 'insufficient_data'
    if (m && n && m.price != null && n.price != null) {
      const absPct = Math.abs(priceDeltaPct ?? 0)
      if (absPct <= 5) agreementStatus = 'strong_agreement'
      else if (absPct <= 15) agreementStatus = 'moderate_agreement'
      else agreementStatus = 'divergent'
    } else if ((m && m.price != null) || (n && n.price != null)) {
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

  // Phase 17B — top-level confidence histogram for the summary line above the table.
  const trendConfidenceCounts = sourceAgreementWithTrend.reduce(
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
    taxonomyCoverage,
    mouserCoverage,
    nexarCoverage,
    combinedCoverage,
    sourceAgreement: sourceAgreementWithTrend,
    trendReadiness,
    sourceTrendStatus,
    trendConfidenceCounts,
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

export default app
