import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { fetchNexarPart, normalizeNexarPart, notConfiguredResponse, errorResponse } from './sources/octopartNexar'
import { TRUSTED_DISTRIBUTOR_LIST } from './data/sourceTypes'
import { PHASE_8_BASKET_PREVIEW, BASKET_PREVIEW_MAX_CALLS, BASKET_PREVIEW_QUOTA_NOTE, BASKET_STATUS, type BasketCategory } from './data/tiBasket'

type Bindings = {
  MOUSER_API_KEY: string
  NEXAR_CLIENT_ID?: string
  NEXAR_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ── PART MAP — primary + fallback per category ────────────────────────────────
const PART_MAP: Record<string, { label: string; parts: string[] }> = {
  pm_ldo:    { label: 'LDO Regulators',       parts: ['TPS7A8300RGWR','TPS7A4501DCQR'] },
  pm_acdc:   { label: 'AC/DC Switching',       parts: ['UCC28180D','UCC28C40DR'] },
  pm_dcdc:   { label: 'DC/DC Switching',       parts: ['TPS54360BDDA','LM5176PWPR'] },
  pm_super:  { label: 'Supervisor & Reset',    parts: ['TPS3839G33DQNR','TPS3700DDCR2'] },
  pm_batt:   { label: 'Battery Mgmt',          parts: ['BQ25896RTWT','BQ76952PFBR'] },
  amp_op:    { label: 'Op-Amps',               parts: ['OPA376AIDBVR','TLV2372IDGKR'] },
  amp_instr: { label: 'Instrumentation',       parts: ['INA826AIDR','INA333AIDR'] },
  amp_audio: { label: 'Audio Amps',            parts: ['TPA3118D2DAPR','LM4871M/NOPB'] },
  dac_adc:   { label: 'ADC',                   parts: ['ADS1115IRUGR','ADS8685IPW'] },
  dac_dac:   { label: 'DAC',                   parts: ['DAC8552IDGK','DAC60508ZCRTET'] },
  if_can:    { label: 'CAN Transceivers',      parts: ['TCAN1042DRBTQ1','TCAN1051DRQ1'] },
  if_lin:    { label: 'LIN Transceivers',      parts: ['TLIN1021DRBRQ1','SN65HVDA100DR'] },
  if_eth:    { label: 'Ethernet PHYs',         parts: ['DP83867IRRGZR','DP83826ERHBR'] },
  iso_dig:   { label: 'Digital Isolators',     parts: ['ISO7742DWR','ISO1541DWR'] },
  iso_rein:  { label: 'Reinforced Isolators',  parts: ['ISO7042CDWR','ISO5852SQDWRQ1'] },
  mcu_msp:   { label: 'MSP430',                parts: ['MSP430FR2355TRHAT','MSP430G2553IPW28R'] },
  mcu_c2k:   { label: 'C2000 Real-Time',       parts: ['TMS320F28035PNT','TMS320F280049CPMS'] },
  mcu_m0:    { label: 'MSPM0',                 parts: ['MSPM0G3507SPTR','MSPM0L1306SRHAR'] },
  mcu_cc:    { label: 'SimpleLink',            parts: ['CC2652R1FRGZR','CC2640R2FRGZR'] },
  mcu_sit:   { label: 'Sitara MPU',            parts: ['AM3352BZCZD80','AM3359BZCZD80'] },
  gan_342:   { label: 'LMG342x (600V)',        parts: ['LMG3422R030RQZT','LMG3410R070RJZR'] },
  gan_365:   { label: 'LMG3650 (TOLL)',        parts: ['LMG3652R070KLAR','LMG3650R070KLAR'] },  // LMG3652 has unit pricing; LMG3650 is reel-only (min=2000)
  gan_520:   { label: 'LMG5200 (80V)',         parts: ['LMG5200MOFT','LMG5350R070YFFT'] },
  dc_48v:    { label: '48V Bus Converters',    parts: ['LM5180NGUR','LM25180RNXR'] },
  dc_sps:    { label: 'Smart Power Stages',    parts: ['TPS53688RSBT','TPS53689RSBR'] },
  dc_efuse:  { label: 'eFuses',                parts: ['TPS2595DRCR','TPS25940ARVCR'] },
  dc_hswap:  { label: 'Hot-Swap Controllers',  parts: ['TPS23861PW','TPS2484PWR'] },
  dc_tps:    { label: 'TPS536xx (AI Power)',   parts: ['TPS53622RSLR','TPS53681RSBT'] },
}

// ── BASELINES — Mouser qty=1 unit prices, clean anchor set 27-Feb-2026 (USD) ───
// Methodology: qty=1 price break, INR→USD at ₹83.5, verified via direct API call
// Anchor: 27-Feb-2026 (mid-Q1 2026). Label = "QTD vs 27-Feb-26"
// QoQ % = (live_price - baseline) / baseline * 100
// When Mar-26 quarter ends (31-Mar-2026), replace these with Mar-31 closing prices
// to compute a true QoQ for the Jun-26 column.
const BASELINES: Record<string, number> = {
  pm_ldo:    6.8752,   // TPS7A8300RGWR   qty=1  ₹574.08
  pm_acdc:   1.9582,   // UCC28180D        qty=1  ₹163.51
  pm_dcdc:   5.7562,   // TPS54360BDDA     qty=1  ₹480.64
  pm_super:  0.8177,   // TPS3839G33DQNR   qty=1  ₹68.28
  pm_batt:   5.2398,   // BQ25896RTWT      qty=1  ₹437.52
  amp_op:    2.1303,   // OPA376AIDBVR     qty=1  ₹177.88
  amp_instr: 3.6366,   // INA826AIDR       qty=1  ₹303.66
  amp_audio: 1.9366,   // TPA3118D2DAPR    qty=1  ₹161.71
  dac_adc:   5.5087,   // ADS1115IRUGR     qty=1  ₹459.98
  dac_dac:   21.4540,  // DAC60508ZCRTET   qty=1  ₹1791.41
  if_can:    2.6898,   // TCAN1042DRBTQ1   qty=1  ₹224.60
  if_lin:    1.6784,   // TLIN1021DRBRQ1   qty=1  ₹140.14
  if_eth:    7.7789,   // DP83867IRRGZR    qty=1  ₹649.54
  iso_dig:   3.2816,   // ISO7742DWR       qty=1  ₹274.01
  iso_rein:  7.2625,   // ISO5852SQDWRQ1   qty=1  ₹606.42
  mcu_msp:   4.7879,   // MSP430FR2355TRHAT qty=1  ₹399.89
  mcu_c2k:   15.6117,  // TMS320F28035PNT  qty=1  ₹1303.58
  mcu_m0:    2.5392,   // MSPM0G3507SPTR   qty=1  ₹212.02
  mcu_cc:    7.2841,   // CC2652R1FRGZR    qty=1  ₹608.22
  mcu_sit:   17.6667,  // AM3352BZCZD80    qty=1  ₹1475.17
  gan_342:   29.1792,  // LMG3422R030RQZT  qty=1  ₹2436.47
  gan_365:   9.5758,   // LMG3650R070KLAR  qty=2000 ₹799.58 (reel; no unit break)
  gan_520:   18.2692,  // LMG5200MOFT      qty=1  ₹1525.48
  dc_48v:    4.8740,   // LM5180NGUR       qty=1  ₹406.98
  dc_sps:    14.2990,  // TPS53688RSBT     qty=1  ₹1193.97
  dc_efuse:  2.6898,   // TPS25940ARVCR    qty=1  ₹224.60
  dc_hswap:  4.9492,   // TPS23861PW       qty=1  ₹413.26
  dc_tps:    12.9327,  // TPS53681RSBT     qty=1  ₹1079.88
}

// ── Baseline metadata ────────────────────────────────────────────────────────
// The dashboard is fundamentally a quarter-over-quarter monitor. The live row
// compares current Mouser spot prices against the "latest baseline" — the most
// recent controlled snapshot. Rolling the baseline forward at the end of a
// quarter is a manual operation: capture new prices, update BASELINES + the
// constants below in a single PR.
const BASELINE_DATE = '2026-02-27'
const BASELINE_PERIOD_LABEL = 'Q1-26 snapshot'
const BASELINE_LABEL = 'Latest baseline'
const BASELINE_DISPLAY = 'Q1-26 snapshot · captured 27-Feb-26'
const BASELINE_DESCRIPTION = 'Pre-quarter-close baseline used for live spot-price comparison'
const BASELINE_ROLLOVER_POLICY = 'Manual rollover after controlled quarterly baseline capture'
const BASELINE_REVIEW_AFTER_DAYS = 90

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
  const allSkus = PHASE_8_BASKET_PREVIEW.flatMap(cat =>
    cat.skus.map(sku => ({ category: cat, sku }))
  )

  // Serve from cache when available and not forcing refresh.
  if (!force) {
    const cache = caches.default
    const cached = await cache.match(BASKET_CACHE_KEY)
    if (cached) {
      const data: any = await cached.json()
      return c.json({ ...data, cached: true })
    }
  }

  // Hard guard against accidental basket expansion.
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

  // Per-category aggregation
  const categories = PHASE_8_BASKET_PREVIEW.map(cat => {
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

export default app
