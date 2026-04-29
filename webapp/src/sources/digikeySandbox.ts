// ── DigiKey sandbox adapter (Phase 19A.1 — diagnostic) ──────────────────────
// Connectivity-only adapter for the DigiKey **sandbox** API. This module:
//   - Authenticates via OAuth 2.0 client_credentials.
//   - Fetches product/price/inventory for a small set of MPNs.
//   - Never logs the client_id, client_secret, or access_token.
//   - Refuses to run unless DIGIKEY_ENV === 'sandbox'.
//   - Returns structured errors instead of throwing — the caller endpoint can
//     surface a graceful, sanitized status to the customer.
//   - **Phase 19A.1**: surfaces stage-level diagnostics so we can tell whether
//     a 4xx came from the OAuth token endpoint or from the product endpoint,
//     redacts secrets defensively from any echoed body, and falls back to the
//     V4 `/productdetails` GET endpoint if keyword-search rejects the request.
//
// IMPORTANT — Phase 19A.1 still does NOT:
//   - Store any DigiKey snapshot to KV.
//   - Modify combined evidence, source agreement, or trends.
//   - Run from page load. Probe is POST-only and auth-gated.

const SANDBOX_BASE_URL = 'https://sandbox-api.digikey.com'
const TOKEN_PATH = '/v1/oauth2/token'
const KEYWORD_SEARCH_PATH = '/products/v4/search/keyword'
const SANDBOX_LOCALE_SITE = 'US'
const SANDBOX_LOCALE_LANGUAGE = 'en'
const SANDBOX_LOCALE_CURRENCY = 'USD'

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

// ── Sanitization ────────────────────────────────────────────────────────────
// Remove anything that looks like a credential before echoing it back.

const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-]+/gi
const ACCESS_TOKEN_RE = /"access_token"\s*:\s*"[^"]*"/gi
const REFRESH_TOKEN_RE = /"refresh_token"\s*:\s*"[^"]*"/gi
// Generic JWT/long-token stripper (3+ base64-ish segments separated by dots,
// or 32+-char hex/base64 runs). Defensive; intentionally aggressive.
const LONG_TOKEN_RE = /([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{0,})?)/g
const HEX_OR_B64_RUN = /\b[A-Za-z0-9_-]{32,}\b/g

function sanitizeMessage(raw: string | null | undefined, env: DigiKeyEnv): string {
  if (!raw) return ''
  let s = String(raw).replace(/[\r\n]+/g, ' ')
  s = s.replace(BEARER_RE, 'Bearer [redacted]')
  s = s.replace(ACCESS_TOKEN_RE, '"access_token":"[redacted]"')
  s = s.replace(REFRESH_TOKEN_RE, '"refresh_token":"[redacted]"')
  s = s.replace(LONG_TOKEN_RE, '[redacted]')
  s = s.replace(HEX_OR_B64_RUN, '[redacted]')
  // If the actual env values somehow appeared in the body, strip them too —
  // DigiKey doesn't echo them in practice, but defense in depth.
  const cid = (env.DIGIKEY_CLIENT_ID ?? '').trim()
  const sec = (env.DIGIKEY_CLIENT_SECRET ?? '').trim()
  if (cid && cid.length >= 8) {
    s = s.split(cid).join('[redacted-client-id]')
  }
  if (sec && sec.length >= 8) {
    s = s.split(sec).join('[redacted-client-secret]')
  }
  return s.slice(0, 250)
}

function tryExtractDigiKeyError(text: string): { code: string | null; message: string | null } {
  // DigiKey error responses commonly look like:
  //   { "ErrorMessage": "...", "StatusCode": 403, "ErrorDetails": "...", "RequestId": "..." }
  // or for OAuth errors:
  //   { "error": "...", "error_description": "..." }
  try {
    const j = JSON.parse(text)
    const code =
      (typeof j?.error === 'string' && j.error) ||
      (typeof j?.ErrorCode === 'string' && j.ErrorCode) ||
      (typeof j?.errorCode === 'string' && j.errorCode) ||
      (typeof j?.statusCode === 'number' ? `status_${j.statusCode}` : null) ||
      null
    const message =
      (typeof j?.error_description === 'string' && j.error_description) ||
      (typeof j?.ErrorMessage === 'string' && j.ErrorMessage) ||
      (typeof j?.errorMessage === 'string' && j.errorMessage) ||
      (typeof j?.ErrorDetails === 'string' && j.ErrorDetails) ||
      (typeof j?.message === 'string' && j.message) ||
      null
    return { code, message }
  } catch {
    return { code: null, message: null }
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

let tokenCache: { token: string; expiresAtMs: number } | null = null

type TokenSuccess = {
  ok: true
  token: string
  httpStatus: number
}
type TokenFailure = {
  ok: false
  status: 'digikey_token_auth_failed' | 'digikey_token_unreachable' | 'digikey_token_invalid_response'
  httpStatus: number
  sanitizedCode: string | null
  sanitizedMessage: string
}

async function fetchSandboxToken(env: DigiKeyEnv): Promise<TokenSuccess | TokenFailure> {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAtMs > now + 5_000) {
    return { ok: true, token: tokenCache.token, httpStatus: 200 }
  }
  const clientId = (env.DIGIKEY_CLIENT_ID ?? '').trim()
  const clientSecret = (env.DIGIKEY_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 'digikey_token_auth_failed',
      httpStatus: 0,
      sanitizedCode: 'credentials_missing',
      sanitizedMessage: 'DigiKey credentials missing.',
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
      status: 'digikey_token_unreachable',
      httpStatus: 0,
      sanitizedCode: 'token_unreachable',
      sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env),
    }
  }

  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  const extracted = tryExtractDigiKeyError(bodyText)

  if (!res.ok) {
    return {
      ok: false,
      status: 'digikey_token_auth_failed',
      httpStatus: res.status,
      sanitizedCode: extracted.code,
      sanitizedMessage: sanitizeMessage(extracted.message ?? bodyText, env),
    }
  }

  let data: any
  try { data = JSON.parse(bodyText) } catch {
    return {
      ok: false,
      status: 'digikey_token_invalid_response',
      httpStatus: res.status,
      sanitizedCode: 'token_invalid_json',
      sanitizedMessage: 'Token response was not valid JSON.',
    }
  }
  const token = data?.access_token
  const expiresIn = typeof data?.expires_in === 'number' ? data.expires_in : 0
  if (!token || typeof token !== 'string') {
    return {
      ok: false,
      status: 'digikey_token_invalid_response',
      httpStatus: res.status,
      sanitizedCode: 'token_missing_access_token',
      sanitizedMessage: 'Token response missing access_token.',
    }
  }
  tokenCache = { token, expiresAtMs: now + Math.max(60_000, expiresIn * 1000 - 30_000) }
  return { ok: true, token, httpStatus: res.status }
}

// ── Product fetch (with fallback endpoint) ──────────────────────────────────

export type DigiKeyProductReadout = {
  mpn: string
  found: boolean
  rawStatus: 'ok' | 'no_match' | 'error' | 'auth_failed' | 'rate_limited' | 'token_failed'
  unitPrice: number | null
  availableInventory: number | null
  leadTimeDays: number | null
  currency: string | null
  distributor: 'DigiKey'
  warnings: string[]
  /** Diagnostic block — sanitized, never includes credentials. */
  diagnostics: {
    /** Where the failure (if any) happened. */
    stage: 'token' | 'product_search' | 'none'
    endpointUsed: string | null
    method: 'GET' | 'POST' | null
    tokenHttpStatus: number | null
    productHttpStatus: number | null
    sanitizedDigiKeyErrorCode: string | null
    sanitizedDigiKeyMessage: string
    failureClass:
      | 'digikey_token_auth_failed'
      | 'digikey_token_unreachable'
      | 'digikey_token_invalid_response'
      | 'digikey_product_unauthorized'
      | 'digikey_product_forbidden'
      | 'digikey_product_not_entitled'
      | 'digikey_product_bad_request'
      | 'digikey_product_rate_limited'
      | 'digikey_product_not_found'
      | 'digikey_unexpected_response_shape'
      | 'digikey_unreachable'
      | null
    /** Phase 19A.2 — which endpoint we tried first for this input. */
    primaryStrategy:
      | 'digikey_product_number_productdetails'
      | 'keyword_search'
      | null
    /** Phase 19A.2 — confirmation that the X-DIGIKEY-Customer-Id header is in
     *  every product call, matching the official sandbox sample. */
    customerIdHeaderSent: boolean
  }
}

/** DigiKey product numbers end in `-ND` (or variants like `-1-ND`, `-DKR-ND`).
 *  Manufacturer part numbers do not. We pick the primary endpoint based on
 *  this heuristic so the official `/productdetails` example path is exercised
 *  when the operator probes with `P5555-ND`. */
function looksLikeDigikeyProductNumber(input: string): boolean {
  return /-nd$/i.test((input || '').trim())
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

/** Map a 4xx HTTP status from the product endpoint into a structured class. */
function classifyProductHttp(status: number, code: string | null): DigiKeyProductReadout['diagnostics']['failureClass'] {
  if (status === 401) return 'digikey_product_unauthorized'
  if (status === 403) {
    // ProductInformation V4 entitlement issues commonly come back as 403 with
    // a body indicating `not_subscribed` / `not_entitled` / `unauthorized_client`.
    const c = (code ?? '').toLowerCase()
    if (
      c.includes('not_subscribed') ||
      c.includes('not_entitled') ||
      c.includes('unauthorized_client') ||
      c.includes('not_authorized') ||
      c.includes('unauthorized') ||
      c.includes('subscriptionrequired')
    ) {
      return 'digikey_product_not_entitled'
    }
    return 'digikey_product_forbidden'
  }
  if (status === 400) return 'digikey_product_bad_request'
  if (status === 429) return 'digikey_product_rate_limited'
  if (status === 404) return 'digikey_product_not_found'
  return 'digikey_unexpected_response_shape'
}

// Phase 19A.2: Header set aligned exactly with DigiKey's official sandbox
// ProductSearch sample. Restoring X-DIGIKEY-Customer-Id: 0 — its absence was
// the most likely cause of the 403 we saw in 19A.1. Header casing matches
// DigiKey docs verbatim; some gateways are case-sensitive on these names.
const SANDBOX_CUSTOMER_ID = '0'

function digikeyHeaders(env: DigiKeyEnv, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-DIGIKEY-Client-Id': (env.DIGIKEY_CLIENT_ID ?? '').trim(),
    'X-DIGIKEY-Customer-Id': SANDBOX_CUSTOMER_ID,
    'X-DIGIKEY-Locale-Site': SANDBOX_LOCALE_SITE,
    'X-DIGIKEY-Locale-Language': SANDBOX_LOCALE_LANGUAGE,
    'X-DIGIKEY-Locale-Currency': SANDBOX_LOCALE_CURRENCY,
    Accept: 'application/json',
  }
}

/** Extract product fields from a v4 keyword-search OR productdetails response. */
function extractProductFields(p: any): {
  matchedMpn: string | null
  unitPrice: number | null
  availableInventory: number | null
  leadTimeDays: number | null
  currency: string
} {
  const matchedMpn =
    (typeof p?.ManufacturerProductNumber === 'string' && p.ManufacturerProductNumber) ||
    (typeof p?.ManufacturerPartNumber === 'string' && p.ManufacturerPartNumber) ||
    null

  let unitPrice: number | null = safeParseFloat(p?.UnitPrice)
  if (unitPrice == null && Array.isArray(p?.StandardPricing) && p.StandardPricing.length > 0) {
    const breaks = p.StandardPricing.slice().sort(
      (a: any, b: any) => (safeParseInt(a.BreakQuantity) ?? 0) - (safeParseInt(b.BreakQuantity) ?? 0),
    )
    unitPrice = safeParseFloat(breaks[0]?.UnitPrice)
  }
  if (unitPrice == null && Array.isArray(p?.ProductVariations)) {
    const v0 = p.ProductVariations[0]
    if (v0?.StandardPricing?.length > 0) {
      const breaks = v0.StandardPricing.slice().sort(
        (a: any, b: any) => (safeParseInt(a.BreakQuantity) ?? 0) - (safeParseInt(b.BreakQuantity) ?? 0),
      )
      unitPrice = safeParseFloat(breaks[0]?.UnitPrice)
    }
  }

  let availableInventory: number | null = safeParseInt(p?.QuantityAvailable)
  if (availableInventory == null && Array.isArray(p?.ProductVariations)) {
    const v0 = p.ProductVariations[0]
    availableInventory = safeParseInt(v0?.QuantityAvailableforPackageType ?? v0?.QuantityAvailable)
  }

  let leadTimeDays: number | null = null
  const lwRaw = p?.ManufacturerLeadWeeks
  if (typeof lwRaw === 'number' && Number.isFinite(lwRaw)) leadTimeDays = Math.trunc(lwRaw * 7)
  else if (typeof lwRaw === 'string') {
    const m = lwRaw.match(/(\d+)/)
    if (m) leadTimeDays = parseInt(m[1], 10) * 7
  }

  const currency = (typeof p?.Currency === 'string' && p.Currency) || SANDBOX_LOCALE_CURRENCY
  return { matchedMpn, unitPrice, availableInventory, leadTimeDays, currency }
}

type ProductCallResult =
  | { kind: 'ok'; product: any; httpStatus: number; endpoint: string; method: 'GET' | 'POST' }
  | { kind: 'no_products'; httpStatus: number; endpoint: string; method: 'GET' | 'POST' }
  | { kind: 'http_error'; httpStatus: number; bodyText: string; endpoint: string; method: 'GET' | 'POST' }
  | { kind: 'unreachable'; message: string; endpoint: string; method: 'GET' | 'POST' }
  | { kind: 'invalid_json'; httpStatus: number; endpoint: string; method: 'GET' | 'POST' }

async function callKeywordSearch(env: DigiKeyEnv, token: string, mpn: string): Promise<ProductCallResult> {
  const endpoint = SANDBOX_BASE_URL + KEYWORD_SEARCH_PATH
  const method: 'POST' = 'POST'
  let res: Response
  try {
    res = await fetch(endpoint, {
      method,
      headers: { ...digikeyHeaders(env, token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Keywords: mpn,
        Limit: 1,
        Offset: 0,
        FilterOptionsRequest: {},
        SortOptions: { Field: 'None', SortOrder: 'Ascending' },
      }),
    })
  } catch (e: any) {
    return { kind: 'unreachable', message: String(e?.message || 'unknown'), endpoint, method }
  }
  let text = ''
  try { text = await res.text() } catch { text = '' }
  if (!res.ok) {
    return { kind: 'http_error', httpStatus: res.status, bodyText: text, endpoint, method }
  }
  let data: any
  try { data = JSON.parse(text) } catch {
    return { kind: 'invalid_json', httpStatus: res.status, endpoint, method }
  }
  const products: any[] =
    Array.isArray(data?.Products) ? data.Products
    : Array.isArray(data?.ExactManufacturerProducts) ? data.ExactManufacturerProducts
    : Array.isArray(data?.ExactMatches) ? data.ExactMatches
    : data?.Product ? [data.Product]
    : []
  if (products.length === 0) {
    return { kind: 'no_products', httpStatus: res.status, endpoint, method }
  }
  return { kind: 'ok', product: products[0], httpStatus: res.status, endpoint, method }
}

async function callProductDetails(env: DigiKeyEnv, token: string, mpn: string): Promise<ProductCallResult> {
  // GET /products/v4/search/{manufacturerProductNumber}/productdetails
  // No body. Documented as the simplest endpoint to fetch a single product
  // by exact MPN. Used as a fallback when keyword search returns 4xx.
  const endpoint = SANDBOX_BASE_URL + '/products/v4/search/' + encodeURIComponent(mpn) + '/productdetails'
  const method: 'GET' = 'GET'
  let res: Response
  try {
    res = await fetch(endpoint, { method, headers: digikeyHeaders(env, token) })
  } catch (e: any) {
    return { kind: 'unreachable', message: String(e?.message || 'unknown'), endpoint, method }
  }
  let text = ''
  try { text = await res.text() } catch { text = '' }
  if (!res.ok) {
    return { kind: 'http_error', httpStatus: res.status, bodyText: text, endpoint, method }
  }
  let data: any
  try { data = JSON.parse(text) } catch {
    return { kind: 'invalid_json', httpStatus: res.status, endpoint, method }
  }
  // V4 productdetails response: { Product: {...}, RequestId, ... }
  const product = data?.Product ?? data?.product ?? null
  if (!product) {
    return { kind: 'no_products', httpStatus: res.status, endpoint, method }
  }
  return { kind: 'ok', product, httpStatus: res.status, endpoint, method }
}

function buildErrorReadout(
  mpn: string,
  rawStatus: DigiKeyProductReadout['rawStatus'],
  diagnostics: DigiKeyProductReadout['diagnostics'],
  warnings: string[],
): DigiKeyProductReadout {
  return {
    mpn,
    found: false,
    rawStatus,
    unitPrice: null,
    availableInventory: null,
    leadTimeDays: null,
    currency: null,
    distributor: 'DigiKey',
    warnings,
    diagnostics,
  }
}

/**
 * Fetch one input (MPN or DigiKey product number). Order:
 *
 *   When input ends in '-ND' (DigiKey product number, like P5555-ND):
 *     1) GET  /products/v4/search/{input}/productdetails   (matches official
 *                                                           sandbox sample)
 *     2) POST /products/v4/search/keyword                  (fallback)
 *
 *   When input is a manufacturer MPN (e.g. TPS7A8300RGWR):
 *     1) POST /products/v4/search/keyword                  (primary)
 *     2) GET  /products/v4/search/{input}/productdetails   (fallback)
 *
 * Phase 19A.2 — `X-DIGIKEY-Customer-Id: 0` is now sent on every product call
 * (was missing in 19A.1, likely contributed to the 403). Returns a structured
 * readout with sanitized diagnostics; never throws.
 */
export async function fetchDigiKeySandboxProductByMpn(
  env: DigiKeyEnv,
  mpn: string,
): Promise<DigiKeyProductReadout> {
  const isDigikeyPn = looksLikeDigikeyProductNumber(mpn)
  const primaryStrategy: 'digikey_product_number_productdetails' | 'keyword_search' =
    isDigikeyPn ? 'digikey_product_number_productdetails' : 'keyword_search'

  const status = checkDigiKeySandboxConfigured(env)
  if (!status.configured) {
    return buildErrorReadout(mpn, 'auth_failed', {
      stage: 'token',
      endpointUsed: null,
      method: null,
      tokenHttpStatus: null,
      productHttpStatus: null,
      sanitizedDigiKeyErrorCode: 'not_configured',
      sanitizedDigiKeyMessage: 'DigiKey adapter not configured (env or credentials missing).',
      failureClass: 'digikey_token_auth_failed',
      primaryStrategy,
      customerIdHeaderSent: false,
    }, ['digikey_not_configured'])
  }

  const tok = await fetchSandboxToken(env)
  if (!tok.ok) {
    return buildErrorReadout(mpn, 'token_failed', {
      stage: 'token',
      endpointUsed: SANDBOX_BASE_URL + TOKEN_PATH,
      method: 'POST',
      tokenHttpStatus: tok.httpStatus,
      productHttpStatus: null,
      sanitizedDigiKeyErrorCode: tok.sanitizedCode,
      sanitizedDigiKeyMessage: tok.sanitizedMessage,
      failureClass: tok.status,
      primaryStrategy,
      customerIdHeaderSent: false,
    }, [tok.status, `http:${tok.httpStatus}`])
  }

  // Pick primary + fallback callers based on input shape.
  const primaryCaller = isDigikeyPn ? callProductDetails : callKeywordSearch
  const fallbackCaller = isDigikeyPn ? callKeywordSearch : callProductDetails
  const primaryLabel = primaryStrategy
  const fallbackLabel: 'digikey_product_number_productdetails' | 'keyword_search' =
    isDigikeyPn ? 'keyword_search' : 'digikey_product_number_productdetails'

  // 1) Primary
  const primary = await primaryCaller(env, tok.token, mpn)
  if (primary.kind === 'ok') {
    const f = extractProductFields(primary.product)
    const warnings: string[] = []
    if (f.unitPrice == null) warnings.push('digikey_no_price_in_response')
    if (f.availableInventory == null) warnings.push('digikey_no_inventory_in_response')
    return {
      mpn: f.matchedMpn || mpn,
      found: true,
      rawStatus: 'ok',
      unitPrice: f.unitPrice,
      availableInventory: f.availableInventory,
      leadTimeDays: f.leadTimeDays,
      currency: f.currency,
      distributor: 'DigiKey',
      warnings,
      diagnostics: {
        stage: 'none',
        endpointUsed: primary.endpoint,
        method: primary.method,
        tokenHttpStatus: tok.httpStatus,
        productHttpStatus: primary.httpStatus,
        sanitizedDigiKeyErrorCode: null,
        sanitizedDigiKeyMessage: '',
        failureClass: null,
        primaryStrategy: primaryLabel,
        customerIdHeaderSent: true,
      },
    }
  }

  // Decide whether to try the fallback. We do for 400/403/404 (the most
  // common "wrong endpoint or wrong shape" classes) and for invalid_json /
  // no_products responses. Auth-class 401/429 we surface immediately.
  const shouldFallback = (() => {
    if (primary.kind === 'http_error') {
      return primary.httpStatus === 400 || primary.httpStatus === 403 || primary.httpStatus === 404
    }
    if (primary.kind === 'no_products' || primary.kind === 'invalid_json') return true
    return false
  })()

  // Build the primary failure readout we'll return if the fallback also fails.
  let primaryDiag: DigiKeyProductReadout['diagnostics']
  let primaryWarnings: string[] = []
  let primaryRawStatus: DigiKeyProductReadout['rawStatus'] = 'error'
  if (primary.kind === 'http_error') {
    const ext = tryExtractDigiKeyError(primary.bodyText)
    const cls = classifyProductHttp(primary.httpStatus, ext.code)
    primaryRawStatus = primary.httpStatus === 401 ? 'auth_failed'
      : primary.httpStatus === 429 ? 'rate_limited'
      : 'error'
    primaryDiag = {
      stage: 'product_search',
      endpointUsed: primary.endpoint,
      method: primary.method,
      tokenHttpStatus: tok.httpStatus,
      productHttpStatus: primary.httpStatus,
      sanitizedDigiKeyErrorCode: ext.code,
      sanitizedDigiKeyMessage: sanitizeMessage(ext.message ?? primary.bodyText, env),
      failureClass: cls,
      primaryStrategy: primaryLabel,
      customerIdHeaderSent: true,
    }
    primaryWarnings = [`digikey_http_${primary.httpStatus}`, cls ?? 'digikey_unknown']
  } else if (primary.kind === 'no_products') {
    primaryRawStatus = 'no_match'
    primaryDiag = {
      stage: 'product_search',
      endpointUsed: primary.endpoint,
      method: primary.method,
      tokenHttpStatus: tok.httpStatus,
      productHttpStatus: primary.httpStatus,
      sanitizedDigiKeyErrorCode: 'no_products',
      sanitizedDigiKeyMessage: 'Primary endpoint returned 0 products.',
      failureClass: 'digikey_unexpected_response_shape',
      primaryStrategy: primaryLabel,
      customerIdHeaderSent: true,
    }
    primaryWarnings = ['digikey_no_products_in_response']
  } else if (primary.kind === 'invalid_json') {
    primaryDiag = {
      stage: 'product_search',
      endpointUsed: primary.endpoint,
      method: primary.method,
      tokenHttpStatus: tok.httpStatus,
      productHttpStatus: primary.httpStatus,
      sanitizedDigiKeyErrorCode: 'invalid_json',
      sanitizedDigiKeyMessage: 'Product response was not valid JSON.',
      failureClass: 'digikey_unexpected_response_shape',
      primaryStrategy: primaryLabel,
      customerIdHeaderSent: true,
    }
    primaryWarnings = ['digikey_invalid_json']
  } else {
    // unreachable
    primaryDiag = {
      stage: 'product_search',
      endpointUsed: primary.endpoint,
      method: primary.method,
      tokenHttpStatus: tok.httpStatus,
      productHttpStatus: null,
      sanitizedDigiKeyErrorCode: 'unreachable',
      sanitizedDigiKeyMessage: sanitizeMessage(primary.message, env),
      failureClass: 'digikey_unreachable',
      primaryStrategy: primaryLabel,
      customerIdHeaderSent: true,
    }
    primaryWarnings = ['digikey_unreachable']
  }

  if (!shouldFallback) {
    return buildErrorReadout(mpn, primaryRawStatus, primaryDiag, primaryWarnings)
  }

  // 2) Fallback (the other endpoint)
  const fb = await fallbackCaller(env, tok.token, mpn)
  if (fb.kind === 'ok') {
    const f = extractProductFields(fb.product)
    const warnings: string[] = ['digikey_used_fallback_endpoint', `digikey_fallback_${fallbackLabel}`]
    if (f.unitPrice == null) warnings.push('digikey_no_price_in_response')
    if (f.availableInventory == null) warnings.push('digikey_no_inventory_in_response')
    return {
      mpn: f.matchedMpn || mpn,
      found: true,
      rawStatus: 'ok',
      unitPrice: f.unitPrice,
      availableInventory: f.availableInventory,
      leadTimeDays: f.leadTimeDays,
      currency: f.currency,
      distributor: 'DigiKey',
      warnings,
      diagnostics: {
        stage: 'none',
        endpointUsed: fb.endpoint,
        method: fb.method,
        tokenHttpStatus: tok.httpStatus,
        productHttpStatus: fb.httpStatus,
        sanitizedDigiKeyErrorCode: null,
        sanitizedDigiKeyMessage:
          `Primary (${primaryLabel}) failed (${primaryDiag.sanitizedDigiKeyErrorCode ?? 'unknown'}); fallback (${fallbackLabel}) succeeded.`,
        failureClass: null,
        primaryStrategy: primaryLabel,
        customerIdHeaderSent: true,
      },
    }
  }

  // Both endpoints failed — return the more informative one. If fallback
  // produced an http_error code, prefer those diagnostics; otherwise stick
  // with the primary's (since we know primary actually returned 4xx).
  if (fb.kind === 'http_error') {
    const ext = tryExtractDigiKeyError(fb.bodyText)
    const cls = classifyProductHttp(fb.httpStatus, ext.code)
    return buildErrorReadout(
      mpn,
      fb.httpStatus === 401 ? 'auth_failed' : fb.httpStatus === 429 ? 'rate_limited' : 'error',
      {
        stage: 'product_search',
        endpointUsed: fb.endpoint,
        method: fb.method,
        tokenHttpStatus: tok.httpStatus,
        productHttpStatus: fb.httpStatus,
        sanitizedDigiKeyErrorCode: ext.code,
        sanitizedDigiKeyMessage:
          `Primary (${primaryLabel}, ${primaryDiag.endpointUsed}) failed: ${primaryDiag.sanitizedDigiKeyMessage}. ` +
          `Fallback (${fallbackLabel}, ${fb.endpoint}) failed: ${sanitizeMessage(ext.message ?? fb.bodyText, env)}`.slice(0, 250),
        failureClass: cls,
        primaryStrategy: primaryLabel,
        customerIdHeaderSent: true,
      },
      [
        ...primaryWarnings,
        `digikey_fallback_http_${fb.httpStatus}`,
        cls ?? 'digikey_unknown',
      ],
    )
  }

  // Fallback unreachable / invalid_json / no_products — keep primary diag and
  // tag that fallback also failed with its kind.
  return buildErrorReadout(mpn, primaryRawStatus, {
    ...primaryDiag,
    sanitizedDigiKeyMessage:
      `${primaryDiag.sanitizedDigiKeyMessage} | fallback (${fallbackLabel}, ${fb.endpoint}) failed: ${
        fb.kind === 'unreachable' ? sanitizeMessage(fb.message, env)
        : fb.kind === 'invalid_json' ? 'invalid JSON'
        : 'no products in response'
      }`.slice(0, 250),
  }, [...primaryWarnings, `digikey_fallback_${fb.kind}`])
}

// ── Probe driver ────────────────────────────────────────────────────────────

export type DigiKeyProbeResult = {
  success: boolean
  status: string
  env: 'sandbox' | 'missing' | 'unsupported'
  callsAttempted: number
  results: DigiKeyProductReadout[]
  errors: Array<{ code: string; message: string }>
  /** Phase 19A.1 — top-level diagnostics summary. Sanitized, no secrets. */
  diagnostics: {
    tokenStage: {
      ok: boolean
      httpStatus: number | null
      sanitizedCode: string | null
      sanitizedMessage: string
    }
    productStage: {
      ok: boolean
      /** Phase 19A.2 — which endpoint was tried first for the input set. */
      primaryStrategy:
        | 'digikey_product_number_productdetails'
        | 'keyword_search'
        | 'mixed'
        | null
      /** Phase 19A.2 — confirms X-DIGIKEY-Customer-Id: 0 was on every product call. */
      customerIdHeaderSent: boolean
      endpointTried: string[]
      lastHttpStatus: number | null
      lastFailureClass: DigiKeyProductReadout['diagnostics']['failureClass']
      sanitizedCode: string | null
      sanitizedMessage: string
    }
  }
}

export const DIGIKEY_PROBE_MAX_MPNS = 3

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
      errors: [{ code: 'env_invalid', message: 'DIGIKEY_ENV must equal "sandbox".' }],
      diagnostics: {
        tokenStage: { ok: false, httpStatus: null, sanitizedCode: 'env_invalid', sanitizedMessage: 'DIGIKEY_ENV must equal "sandbox".' },
        productStage: { ok: false, primaryStrategy: null, customerIdHeaderSent: false, endpointTried: [], lastHttpStatus: null, lastFailureClass: null, sanitizedCode: null, sanitizedMessage: '' },
      },
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
      diagnostics: {
        tokenStage: { ok: false, httpStatus: null, sanitizedCode: 'credentials_missing', sanitizedMessage: 'DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET are required.' },
        productStage: { ok: false, primaryStrategy: null, customerIdHeaderSent: false, endpointTried: [], lastHttpStatus: null, lastFailureClass: null, sanitizedCode: null, sanitizedMessage: '' },
      },
    }
  }
  if (!Array.isArray(mpns) || mpns.length === 0) {
    return {
      success: false, status: 'invalid_payload', env: status.env, callsAttempted: 0, results: [],
      errors: [{ code: 'mpns_required', message: 'mpns must be a non-empty array.' }],
      diagnostics: {
        tokenStage: { ok: false, httpStatus: null, sanitizedCode: 'invalid_payload', sanitizedMessage: 'mpns required' },
        productStage: { ok: false, primaryStrategy: null, customerIdHeaderSent: false, endpointTried: [], lastHttpStatus: null, lastFailureClass: null, sanitizedCode: null, sanitizedMessage: '' },
      },
    }
  }
  if (mpns.length > DIGIKEY_PROBE_MAX_MPNS) {
    return {
      success: false, status: 'too_many_mpns', env: status.env, callsAttempted: 0, results: [],
      errors: [{ code: 'mpns_exceed_cap', message: `Probe accepts at most ${DIGIKEY_PROBE_MAX_MPNS} MPNs.` }],
      diagnostics: {
        tokenStage: { ok: false, httpStatus: null, sanitizedCode: 'too_many_mpns', sanitizedMessage: `Probe accepts at most ${DIGIKEY_PROBE_MAX_MPNS} MPNs.` },
        productStage: { ok: false, primaryStrategy: null, customerIdHeaderSent: false, endpointTried: [], lastHttpStatus: null, lastFailureClass: null, sanitizedCode: null, sanitizedMessage: '' },
      },
    }
  }
  const cleaned = mpns.map(m => (typeof m === 'string' ? m.trim() : '')).filter(m => m.length > 0)
  if (cleaned.length === 0) {
    return {
      success: false, status: 'invalid_payload', env: status.env, callsAttempted: 0, results: [],
      errors: [{ code: 'mpns_empty', message: 'mpns must contain at least one non-empty string.' }],
      diagnostics: {
        tokenStage: { ok: false, httpStatus: null, sanitizedCode: 'invalid_payload', sanitizedMessage: 'mpns empty' },
        productStage: { ok: false, primaryStrategy: null, customerIdHeaderSent: false, endpointTried: [], lastHttpStatus: null, lastFailureClass: null, sanitizedCode: null, sanitizedMessage: '' },
      },
    }
  }

  const results: DigiKeyProductReadout[] = []
  let anyAuthFailure = false
  let anyTokenFailure = false
  for (const mpn of cleaned) {
    const r = await fetchDigiKeySandboxProductByMpn(env, mpn)
    results.push(r)
    if (r.rawStatus === 'token_failed') { anyTokenFailure = true; break }
    if (r.rawStatus === 'auth_failed' && r.diagnostics.stage === 'product_search') anyAuthFailure = true
  }

  // Build top-level diagnostics from the most informative result.
  const firstFailure = results.find(r => r.rawStatus !== 'ok') ?? null
  const lastResult = results[results.length - 1] ?? null
  const tokenOk = !anyTokenFailure && (firstFailure?.diagnostics.stage !== 'token')
  const tokenSanitizedCode = anyTokenFailure ? firstFailure!.diagnostics.sanitizedDigiKeyErrorCode : null
  const tokenSanitizedMessage = anyTokenFailure ? firstFailure!.diagnostics.sanitizedDigiKeyMessage : ''
  const tokenHttpStatus = anyTokenFailure ? firstFailure!.diagnostics.tokenHttpStatus : (results[0]?.diagnostics.tokenHttpStatus ?? null)

  const productOk = results.some(r => r.rawStatus === 'ok')
  const endpointTried = Array.from(new Set(results.map(r => r.diagnostics.endpointUsed).filter((e): e is string => !!e)))
  const productSanitizedCode = productOk ? null : (firstFailure?.diagnostics.sanitizedDigiKeyErrorCode ?? null)
  const productSanitizedMessage = productOk ? '' : (firstFailure?.diagnostics.sanitizedDigiKeyMessage ?? '')
  const lastHttpStatus = lastResult?.diagnostics.productHttpStatus ?? null
  const lastFailureClass = firstFailure?.diagnostics.failureClass ?? null

  const overallStatus =
    anyTokenFailure ? 'digikey_token_auth_failed'
    : results.every(r => r.rawStatus === 'ok') ? 'ok'
    : results.some(r => r.rawStatus === 'ok') ? 'partial'
    : (firstFailure?.diagnostics.failureClass ?? 'digikey_unexpected_response_shape')

  return {
    success: overallStatus === 'ok' || overallStatus === 'partial',
    status: overallStatus,
    env: 'sandbox',
    callsAttempted: results.length,
    results,
    errors: [],
    diagnostics: {
      tokenStage: {
        ok: tokenOk,
        httpStatus: tokenHttpStatus,
        sanitizedCode: tokenSanitizedCode,
        sanitizedMessage: tokenSanitizedMessage,
      },
      productStage: {
        ok: productOk,
        // If every result chose the same primary strategy, surface it; if
        // inputs mixed (-ND and MPN in the same probe), report 'mixed'.
        primaryStrategy: (() => {
          const strategies = new Set(results.map(r => r.diagnostics.primaryStrategy).filter(Boolean) as string[])
          if (strategies.size === 0) return null
          if (strategies.size === 1) return Array.from(strategies)[0] as 'digikey_product_number_productdetails' | 'keyword_search'
          return 'mixed' as const
        })(),
        customerIdHeaderSent: results.length > 0 && results.every(r => r.diagnostics.customerIdHeaderSent),
        endpointTried,
        lastHttpStatus,
        lastFailureClass,
        sanitizedCode: productSanitizedCode,
        sanitizedMessage: productSanitizedMessage,
      },
    },
  }
}
