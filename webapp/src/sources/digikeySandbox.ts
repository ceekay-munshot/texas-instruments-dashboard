// ── DigiKey sandbox adapter (Phase 19A) ──────────────────────────────────────
// Connectivity-only adapter for the DigiKey **sandbox** API. This module:
//   - Authenticates via OAuth 2.0 client_credentials.
//   - Fetches product/price/inventory for a small set of MPNs.
//   - Never logs the client_id, client_secret, or access_token.
//   - Refuses to run unless DIGIKEY_ENV === 'sandbox'.
//   - Returns structured errors instead of throwing — the caller endpoint can
//     surface a graceful status to the customer.
//
// IMPORTANT — Phase 19A does NOT:
//   - Store any DigiKey snapshot to KV.
//   - Modify combined evidence, source agreement, or trends.
//   - Run from page load. Probe is POST-only and auth-gated.
//
// We treat the DigiKey response shape defensively. The exact field names below
// reflect DigiKey's documented v3/v4 product search responses; if a future
// API revision returns a different shape we surface `rawStatus` and `warnings`
// rather than crash.

const SANDBOX_BASE_URL = 'https://sandbox-api.digikey.com'
const TOKEN_PATH = '/v1/oauth2/token'
const PRODUCT_DETAILS_PATH_V4 = '/products/v4/search'
const SANDBOX_LOCALE_SITE = 'US'
const SANDBOX_LOCALE_LANGUAGE = 'en'
const SANDBOX_LOCALE_CURRENCY = 'USD'
const SANDBOX_CUSTOMER_ID = '0'

export type DigiKeyEnv = {
  DIGIKEY_CLIENT_ID?: string
  DIGIKEY_CLIENT_SECRET?: string
  DIGIKEY_ENV?: string
}

export type DigiKeyStatus = {
  configured: boolean
  env: 'sandbox' | 'missing' | 'unsupported'
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  sandboxOnly: true
}

export function checkDigiKeySandboxConfigured(env: DigiKeyEnv): DigiKeyStatus {
  const clientIdConfigured = !!(env.DIGIKEY_CLIENT_ID && env.DIGIKEY_CLIENT_ID.trim())
  const clientSecretConfigured = !!(env.DIGIKEY_CLIENT_SECRET && env.DIGIKEY_CLIENT_SECRET.trim())
  let envState: 'sandbox' | 'missing' | 'unsupported'
  if (!env.DIGIKEY_ENV || !env.DIGIKEY_ENV.trim()) {
    envState = 'missing'
  } else if (env.DIGIKEY_ENV.trim().toLowerCase() === 'sandbox') {
    envState = 'sandbox'
  } else {
    envState = 'unsupported'
  }
  return {
    configured: clientIdConfigured && clientSecretConfigured && envState === 'sandbox',
    env: envState,
    clientIdConfigured,
    clientSecretConfigured,
    sandboxOnly: true,
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────
// Tiny in-memory token cache scoped to the worker invocation. Cloudflare
// Workers re-instantiate per request, so this is effectively per-request, but
// we keep it because a probe loops through ≤ 3 MPNs and reusing the token
// avoids 3× auth round-trips.

let tokenCache: { token: string; expiresAtMs: number } | null = null

type TokenSuccess = { ok: true; token: string }
type TokenFailure = {
  ok: false
  status: 'digikey_auth_failed'
  httpStatus: number
  message: string
}

async function fetchSandboxToken(
  env: DigiKeyEnv,
): Promise<TokenSuccess | TokenFailure> {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAtMs > now + 5_000) {
    return { ok: true, token: tokenCache.token }
  }
  const clientId = (env.DIGIKEY_CLIENT_ID ?? '').trim()
  const clientSecret = (env.DIGIKEY_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 'digikey_auth_failed',
      httpStatus: 0,
      message: 'DigiKey credentials missing.',
    }
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  }).toString()

  let res: Response
  try {
    res = await fetch(SANDBOX_BASE_URL + TOKEN_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    })
  } catch (e: any) {
    return {
      ok: false,
      status: 'digikey_auth_failed',
      httpStatus: 0,
      message: 'Token endpoint unreachable: ' + String(e?.message || 'unknown error').slice(0, 200),
    }
  }

  if (!res.ok) {
    // Read response body for diagnostics, but DO NOT echo any echoed
    // credential values back to the client. DigiKey error bodies typically
    // include `error_description` strings only.
    let errMessage = `HTTP ${res.status}`
    try {
      const text = await res.text()
      // Intentionally truncate to 200 chars and do not pass through anything
      // that could include the client secret. Token endpoint never echoes the
      // secret in practice; this trim is defense-in-depth.
      errMessage = text.replace(/[\r\n]+/g, ' ').slice(0, 200)
    } catch { /* ignore */ }
    return {
      ok: false,
      status: 'digikey_auth_failed',
      httpStatus: res.status,
      message: errMessage,
    }
  }

  let data: any
  try {
    data = await res.json()
  } catch (e: any) {
    return {
      ok: false,
      status: 'digikey_auth_failed',
      httpStatus: res.status,
      message: 'Token response was not valid JSON.',
    }
  }
  const token = data?.access_token
  const expiresIn = typeof data?.expires_in === 'number' ? data.expires_in : 0
  if (!token || typeof token !== 'string') {
    return {
      ok: false,
      status: 'digikey_auth_failed',
      httpStatus: res.status,
      message: 'Token response missing access_token.',
    }
  }
  // Cache slightly under the reported expiry to be safe.
  tokenCache = { token, expiresAtMs: now + Math.max(60_000, expiresIn * 1000 - 30_000) }
  return { ok: true, token }
}

// ── Product fetch ───────────────────────────────────────────────────────────

export type DigiKeyProductReadout = {
  mpn: string
  found: boolean
  rawStatus: 'ok' | 'no_match' | 'error' | 'auth_failed' | 'rate_limited'
  unitPrice: number | null
  availableInventory: number | null
  leadTimeDays: number | null
  currency: string | null
  distributor: 'DigiKey'
  warnings: string[]
  /** When the API responded but with an unexpected/empty shape, surface the
   *  HTTP status for diagnostics — never the body. */
  httpStatus?: number
}

function safeParseInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9-]/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function safeParseFloat(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Fetch a single MPN from the DigiKey sandbox via v4 product search.
 * Defensive: any unexpected shape is reported as `no_match` or `error` with
 * a warning. Never throws.
 */
export async function fetchDigiKeySandboxProductByMpn(
  env: DigiKeyEnv,
  mpn: string,
): Promise<DigiKeyProductReadout> {
  const status = checkDigiKeySandboxConfigured(env)
  if (!status.configured) {
    return {
      mpn,
      found: false,
      rawStatus: 'auth_failed',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_not_configured'],
    }
  }

  const tok = await fetchSandboxToken(env)
  if (!tok.ok) {
    return {
      mpn,
      found: false,
      rawStatus: 'auth_failed',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: [tok.status, `http:${tok.httpStatus}`],
      httpStatus: tok.httpStatus,
    }
  }

  // v4 keyword search by MPN. Sandbox accepts the same shape as production.
  const url =
    SANDBOX_BASE_URL +
    PRODUCT_DETAILS_PATH_V4 +
    '/keyword'
  const requestBody = JSON.stringify({
    Keywords: mpn,
    RecordCount: 1,
    RecordStartPosition: 0,
    Filters: {},
    Sort: { Option: 'SortByUnitPrice', Direction: 'Ascending', SortParameterId: 0 },
    RequestedQuantity: 1,
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        'X-DIGIKEY-Client-Id': (env.DIGIKEY_CLIENT_ID ?? '').trim(),
        'X-DIGIKEY-Locale-Site': SANDBOX_LOCALE_SITE,
        'X-DIGIKEY-Locale-Language': SANDBOX_LOCALE_LANGUAGE,
        'X-DIGIKEY-Locale-Currency': SANDBOX_LOCALE_CURRENCY,
        'X-DIGIKEY-Customer-Id': SANDBOX_CUSTOMER_ID,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: requestBody,
    })
  } catch (e: any) {
    return {
      mpn,
      found: false,
      rawStatus: 'error',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_unreachable', String(e?.message || 'unknown').slice(0, 200)],
    }
  }

  if (res.status === 429) {
    return {
      mpn,
      found: false,
      rawStatus: 'rate_limited',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_rate_limited'],
      httpStatus: 429,
    }
  }
  if (res.status === 401 || res.status === 403) {
    return {
      mpn,
      found: false,
      rawStatus: 'auth_failed',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_unauthorized'],
      httpStatus: res.status,
    }
  }
  if (!res.ok) {
    return {
      mpn,
      found: false,
      rawStatus: 'error',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: [`digikey_http_${res.status}`],
      httpStatus: res.status,
    }
  }

  let data: any
  try {
    data = await res.json()
  } catch {
    return {
      mpn,
      found: false,
      rawStatus: 'error',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_invalid_json'],
      httpStatus: res.status,
    }
  }

  // DigiKey v4 keyword-search response shape:
  //   { Products: [{ ManufacturerPartNumber, QuantityAvailable, UnitPrice,
  //                  StandardPricing: [{ BreakQuantity, UnitPrice }],
  //                  ProductVariations: [{ StandardPricing: [...] }],
  //                  ManufacturerLeadWeeks, ... }],
  //     ProductsCount: N, ... }
  //
  // We accept several plausible shapes (`Products` array OR `Product` single)
  // because sandbox vs prod responses can vary. Any unexpected shape produces
  // `no_match` with a warning rather than crashing.
  const products: any[] = Array.isArray(data?.Products)
    ? data.Products
    : Array.isArray(data?.ExactManufacturerProducts)
      ? data.ExactManufacturerProducts
      : data?.Product
        ? [data.Product]
        : []
  if (products.length === 0) {
    return {
      mpn,
      found: false,
      rawStatus: 'no_match',
      unitPrice: null,
      availableInventory: null,
      leadTimeDays: null,
      currency: null,
      distributor: 'DigiKey',
      warnings: ['digikey_no_products_in_response'],
      httpStatus: res.status,
    }
  }
  const p = products[0]
  // Price: prefer unit-price field, then min break in StandardPricing, then
  // ProductVariations[0].StandardPricing[0].UnitPrice. None → null.
  let unitPrice: number | null = null
  unitPrice = safeParseFloat(p?.UnitPrice)
  if (unitPrice == null && Array.isArray(p?.StandardPricing) && p.StandardPricing.length > 0) {
    // Pick the lowest-quantity break.
    const breaks = p.StandardPricing.slice().sort((a: any, b: any) => safeParseInt(a.BreakQuantity) ?? 0 - (safeParseInt(b.BreakQuantity) ?? 0))
    unitPrice = safeParseFloat(breaks[0]?.UnitPrice)
  }
  if (unitPrice == null && Array.isArray(p?.ProductVariations)) {
    const v0 = p.ProductVariations[0]
    if (v0?.StandardPricing?.length > 0) {
      const breaks = v0.StandardPricing.slice().sort((a: any, b: any) => (safeParseInt(a.BreakQuantity) ?? 0) - (safeParseInt(b.BreakQuantity) ?? 0))
      unitPrice = safeParseFloat(breaks[0]?.UnitPrice)
    }
  }
  // Inventory: QuantityAvailable (number); fall back to ProductVariations[0].QuantityAvailableforPackageType.
  let availableInventory: number | null = safeParseInt(p?.QuantityAvailable)
  if (availableInventory == null && Array.isArray(p?.ProductVariations)) {
    const v0 = p.ProductVariations[0]
    availableInventory = safeParseInt(v0?.QuantityAvailableforPackageType ?? v0?.QuantityAvailable)
  }
  // Lead time: ManufacturerLeadWeeks ("12 Weeks" or number) → days.
  let leadTimeDays: number | null = null
  const lwRaw = p?.ManufacturerLeadWeeks
  if (typeof lwRaw === 'number' && Number.isFinite(lwRaw)) leadTimeDays = Math.trunc(lwRaw * 7)
  else if (typeof lwRaw === 'string') {
    const m = lwRaw.match(/(\d+)/)
    if (m) leadTimeDays = parseInt(m[1], 10) * 7
  }
  // Currency: response field varies. Sandbox commonly returns the request locale.
  const currency = (typeof p?.Currency === 'string' && p.Currency) || SANDBOX_LOCALE_CURRENCY

  // ManufacturerPartNumber may live at p.ManufacturerProductNumber on v4.
  const matchedMpn =
    typeof p?.ManufacturerProductNumber === 'string'
      ? p.ManufacturerProductNumber
      : typeof p?.ManufacturerPartNumber === 'string'
        ? p.ManufacturerPartNumber
        : mpn

  const warnings: string[] = []
  if (unitPrice == null) warnings.push('digikey_no_price_in_response')
  if (availableInventory == null) warnings.push('digikey_no_inventory_in_response')

  return {
    mpn: matchedMpn,
    found: true,
    rawStatus: 'ok',
    unitPrice,
    availableInventory,
    leadTimeDays,
    currency,
    distributor: 'DigiKey',
    warnings,
    httpStatus: res.status,
  }
}

// ── Probe driver ────────────────────────────────────────────────────────────

export type DigiKeyProbeResult = {
  success: boolean
  status: string
  env: 'sandbox' | 'missing' | 'unsupported'
  callsAttempted: number
  results: DigiKeyProductReadout[]
  errors: Array<{ code: string; message: string }>
}

export const DIGIKEY_PROBE_MAX_MPNS = 3

/** Run the probe. Sequential calls (not parallel) so the token cache amortizes
 *  one auth across all probed MPNs. Always returns a structured result. */
export async function probeDigiKeySandbox(
  env: DigiKeyEnv,
  mpns: string[],
): Promise<DigiKeyProbeResult> {
  const status = checkDigiKeySandboxConfigured(env)
  if (status.env !== 'sandbox') {
    return {
      success: false,
      status: 'digikey_env_not_sandbox',
      env: status.env,
      callsAttempted: 0,
      results: [],
      errors: [{ code: 'env_invalid', message: 'DIGIKEY_ENV must equal "sandbox" to enable the adapter.' }],
    }
  }
  if (!status.configured) {
    return {
      success: false,
      status: 'digikey_not_configured',
      env: status.env,
      callsAttempted: 0,
      results: [],
      errors: [{ code: 'credentials_missing', message: 'DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET are required.' }],
    }
  }
  if (!Array.isArray(mpns) || mpns.length === 0) {
    return {
      success: false,
      status: 'invalid_payload',
      env: status.env,
      callsAttempted: 0,
      results: [],
      errors: [{ code: 'mpns_required', message: 'mpns must be a non-empty array.' }],
    }
  }
  if (mpns.length > DIGIKEY_PROBE_MAX_MPNS) {
    return {
      success: false,
      status: 'too_many_mpns',
      env: status.env,
      callsAttempted: 0,
      results: [],
      errors: [{ code: 'mpns_exceed_cap', message: `Probe accepts at most ${DIGIKEY_PROBE_MAX_MPNS} MPNs.` }],
    }
  }
  const cleaned = mpns
    .map(m => (typeof m === 'string' ? m.trim() : ''))
    .filter(m => m.length > 0)
  if (cleaned.length === 0) {
    return {
      success: false,
      status: 'invalid_payload',
      env: status.env,
      callsAttempted: 0,
      results: [],
      errors: [{ code: 'mpns_empty', message: 'mpns must contain at least one non-empty string.' }],
    }
  }

  const results: DigiKeyProductReadout[] = []
  const errors: Array<{ code: string; message: string }> = []
  let anyAuthFailure = false
  for (const mpn of cleaned) {
    const r = await fetchDigiKeySandboxProductByMpn(env, mpn)
    results.push(r)
    if (r.rawStatus === 'auth_failed') {
      anyAuthFailure = true
      // No point continuing the loop if auth itself is failing — stop early.
      break
    }
  }

  const overallStatus =
    anyAuthFailure
      ? 'digikey_auth_failed'
      : results.every(r => r.rawStatus === 'ok')
        ? 'ok'
        : results.some(r => r.rawStatus === 'ok')
          ? 'partial'
          : 'no_results'

  return {
    success: overallStatus === 'ok' || overallStatus === 'partial',
    status: overallStatus,
    env: 'sandbox',
    callsAttempted: results.length,
    results,
    errors,
  }
}
