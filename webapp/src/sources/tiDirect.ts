// ── Texas Instruments direct API adapter (Phase 20A) ────────────────────────
// Direct integration with TI's Product Information API (approved today) and
// the Store API suite (Inventory & Pricing — approval pending). The adapter
// authenticates via OAuth 2.0 client credentials, caches tokens for 55
// minutes, and never logs or echoes credentials back to the client.
//
// Hard rules enforced by this module:
//   - DO NOT hardcode the key/secret. They come from env vars only.
//   - DO NOT return the token to the caller (or to the frontend).
//   - DO NOT log the client id, client secret, or access token.
//   - DO NOT call TI from page load except through GET /api/ti/status, which
//     is bounded to one cached OAuth round trip per 55 min.
//   - The Store API endpoints refuse to call TI unless `TI_STORE_API_ENABLED`
//     is exactly `'true'` AND the Product Information API works first.

const TOKEN_URL = 'https://transact.ti.com/v2/oauth/token'
// Product Information API — primary entry point. Path may be different in TI's
// final docs; the adapter is defensive so unexpected shapes don't crash.
const PRODUCT_INFO_URL = (partNumber: string) =>
  `https://transact.ti.com/v2/productinformation/products/${encodeURIComponent(partNumber)}`
// Store API — Inventory & Pricing. Used only when the operator flips
// TI_STORE_API_ENABLED=true after TI's Store suite approval lands.
const INVENTORY_PRICING_URL = (partNumber: string) =>
  `https://transact.ti.com/v2/store/products/inventory-pricing?partNumber=${encodeURIComponent(partNumber)}`

const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000 // 55 min, per spec

export type TiEnv = {
  TI_CLIENT_ID?: string
  TI_CLIENT_SECRET?: string
  TI_API_ENV?: string
  TI_STORE_API_ENABLED?: string
}

export type TiStatus = {
  configured: boolean
  env: 'production' | 'missing' | 'unsupported'
  clientIdConfigured: boolean
  clientSecretConfigured: boolean
  productInfoApiReady: boolean
  /** Phase 20A: 'pending_approval' until the operator flips TI_STORE_API_ENABLED. */
  storeApiReady: boolean
  storeApiState: 'pending_approval' | 'enabled' | 'disabled'
}

export function checkTiConfigured(env: TiEnv): TiStatus {
  const clientIdConfigured = !!(env.TI_CLIENT_ID && env.TI_CLIENT_ID.trim())
  const clientSecretConfigured = !!(env.TI_CLIENT_SECRET && env.TI_CLIENT_SECRET.trim())
  const apiEnv = (env.TI_API_ENV ?? '').trim().toLowerCase()
  const envState: TiStatus['env'] =
    !apiEnv ? 'missing' : apiEnv === 'production' ? 'production' : 'unsupported'
  const configured = clientIdConfigured && clientSecretConfigured && envState === 'production'
  const storeFlag = (env.TI_STORE_API_ENABLED ?? '').trim().toLowerCase()
  const storeApiState: TiStatus['storeApiState'] =
    storeFlag === 'true' ? 'enabled' : storeFlag === 'false' ? 'disabled' : 'pending_approval'
  return {
    configured,
    env: envState,
    clientIdConfigured,
    clientSecretConfigured,
    productInfoApiReady: configured,
    storeApiReady: configured && storeApiState === 'enabled',
    storeApiState,
  }
}

// ── Sanitization ────────────────────────────────────────────────────────────
// Same defensive approach as the DigiKey adapter — strip anything that looks
// like a credential before echoing TI error bodies back to the caller.

const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-]+/gi
const ACCESS_TOKEN_RE = /"access_token"\s*:\s*"[^"]*"/gi
const REFRESH_TOKEN_RE = /"refresh_token"\s*:\s*"[^"]*"/gi
const LONG_TOKEN_RE = /([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{0,})?)/g
const HEX_OR_B64_RUN = /\b[A-Za-z0-9_-]{32,}\b/g

function sanitizeMessage(raw: string | null | undefined, env: TiEnv): string {
  if (!raw) return ''
  let s = String(raw).replace(/[\r\n]+/g, ' ')
  s = s.replace(BEARER_RE, 'Bearer [redacted]')
  s = s.replace(ACCESS_TOKEN_RE, '"access_token":"[redacted]"')
  s = s.replace(REFRESH_TOKEN_RE, '"refresh_token":"[redacted]"')
  s = s.replace(LONG_TOKEN_RE, '[redacted]')
  s = s.replace(HEX_OR_B64_RUN, '[redacted]')
  const cid = (env.TI_CLIENT_ID ?? '').trim()
  const sec = (env.TI_CLIENT_SECRET ?? '').trim()
  if (cid && cid.length >= 8) s = s.split(cid).join('[redacted-client-id]')
  if (sec && sec.length >= 8) s = s.split(sec).join('[redacted-client-secret]')
  return s.slice(0, 250)
}

function tryExtractTiError(text: string): { code: string | null; message: string | null } {
  try {
    const j = JSON.parse(text)
    const code =
      (typeof j?.error === 'string' && j.error) ||
      (typeof j?.errorCode === 'string' && j.errorCode) ||
      (typeof j?.code === 'string' && j.code) ||
      null
    const message =
      (typeof j?.error_description === 'string' && j.error_description) ||
      (typeof j?.errorMessage === 'string' && j.errorMessage) ||
      (typeof j?.message === 'string' && j.message) ||
      null
    return { code, message }
  } catch {
    return { code: null, message: null }
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

let tokenCache: { token: string; expiresAtMs: number; fetchedAtMs: number } | null = null

export type TiTokenSuccess = {
  ok: true
  token: string
  fetchedAtMs: number
  expiresAtMs: number
  fromCache: boolean
}
export type TiTokenFailure = {
  ok: false
  status: 'ti_token_auth_failed' | 'ti_token_unreachable' | 'ti_token_invalid_response' | 'ti_not_configured'
  httpStatus: number
  sanitizedCode: string | null
  sanitizedMessage: string
}

export async function fetchTiToken(env: TiEnv): Promise<TiTokenSuccess | TiTokenFailure> {
  const status = checkTiConfigured(env)
  if (!status.configured) {
    return {
      ok: false,
      status: 'ti_not_configured',
      httpStatus: 0,
      sanitizedCode: 'not_configured',
      sanitizedMessage: 'TI adapter not configured (env or credentials missing).',
    }
  }
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return {
      ok: true,
      token: tokenCache.token,
      fetchedAtMs: tokenCache.fetchedAtMs,
      expiresAtMs: tokenCache.expiresAtMs,
      fromCache: true,
    }
  }
  const clientId = (env.TI_CLIENT_ID ?? '').trim()
  const clientSecret = (env.TI_CLIENT_SECRET ?? '').trim()
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString()
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
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
      status: 'ti_token_unreachable',
      httpStatus: 0,
      sanitizedCode: 'token_unreachable',
      sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env),
    }
  }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  const extracted = tryExtractTiError(bodyText)
  if (!res.ok) {
    return {
      ok: false,
      status: 'ti_token_auth_failed',
      httpStatus: res.status,
      sanitizedCode: extracted.code,
      sanitizedMessage: sanitizeMessage(extracted.message ?? bodyText, env),
    }
  }
  let data: any
  try { data = JSON.parse(bodyText) } catch {
    return {
      ok: false,
      status: 'ti_token_invalid_response',
      httpStatus: res.status,
      sanitizedCode: 'token_invalid_json',
      sanitizedMessage: 'Token response was not valid JSON.',
    }
  }
  const token = data?.access_token
  if (!token || typeof token !== 'string') {
    return {
      ok: false,
      status: 'ti_token_invalid_response',
      httpStatus: res.status,
      sanitizedCode: 'token_missing_access_token',
      sanitizedMessage: 'Token response missing access_token.',
    }
  }
  // Cache for the smaller of TI's reported expiry or our 55-min ceiling.
  const expiresInMs = typeof data?.expires_in === 'number' ? data.expires_in * 1000 : TOKEN_CACHE_TTL_MS
  const ttl = Math.min(TOKEN_CACHE_TTL_MS, Math.max(60_000, expiresInMs - 30_000))
  tokenCache = { token, expiresAtMs: now + ttl, fetchedAtMs: now }
  return { ok: true, token, fetchedAtMs: now, expiresAtMs: now + ttl, fromCache: false }
}

// ── Product Information API ─────────────────────────────────────────────────

export type TiProductInfo = {
  source: 'Texas Instruments Product Information API'
  status: 'ok' | 'no_match' | 'error' | 'auth_failed' | 'rate_limited' | 'token_failed' | 'not_configured'
  partNumber: string
  genericPartNumber: string | null
  description: string | null
  lifecycleStatus: string | null
  package: string | null
  datasheetUrl: string | null
  qualityReliability: Record<string, unknown> | null
  fetchedAt: string
  warnings: string[]
  diagnostics: {
    httpStatus: number | null
    sanitizedCode: string | null
    sanitizedMessage: string
  }
}

function buildProductError(
  partNumber: string,
  status: TiProductInfo['status'],
  diag: TiProductInfo['diagnostics'],
  warnings: string[],
): TiProductInfo {
  return {
    source: 'Texas Instruments Product Information API',
    status,
    partNumber,
    genericPartNumber: null,
    description: null,
    lifecycleStatus: null,
    package: null,
    datasheetUrl: null,
    qualityReliability: null,
    fetchedAt: new Date().toISOString(),
    warnings,
    diagnostics: diag,
  }
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export async function fetchTiProductInfo(
  env: TiEnv,
  partNumber: string,
): Promise<TiProductInfo> {
  const cleaned = (partNumber || '').trim()
  if (!cleaned) {
    return buildProductError('', 'error', {
      httpStatus: null,
      sanitizedCode: 'invalid_partnumber',
      sanitizedMessage: 'partNumber is required.',
    }, ['ti_invalid_partnumber'])
  }
  const config = checkTiConfigured(env)
  if (!config.configured) {
    return buildProductError(cleaned, 'not_configured', {
      httpStatus: null,
      sanitizedCode: 'not_configured',
      sanitizedMessage: 'TI adapter not configured.',
    }, ['ti_not_configured'])
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    return buildProductError(cleaned, 'token_failed', {
      httpStatus: tok.httpStatus,
      sanitizedCode: tok.sanitizedCode,
      sanitizedMessage: tok.sanitizedMessage,
    }, [tok.status])
  }
  let res: Response
  try {
    res = await fetch(PRODUCT_INFO_URL(cleaned), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        Accept: 'application/json',
      },
    })
  } catch (e: any) {
    return buildProductError(cleaned, 'error', {
      httpStatus: null,
      sanitizedCode: 'unreachable',
      sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env),
    }, ['ti_unreachable'])
  }
  if (res.status === 429) {
    return buildProductError(cleaned, 'rate_limited', {
      httpStatus: 429,
      sanitizedCode: 'rate_limited',
      sanitizedMessage: 'TI API rate limit hit.',
    }, ['ti_rate_limited'])
  }
  if (res.status === 401 || res.status === 403) {
    return buildProductError(cleaned, 'auth_failed', {
      httpStatus: res.status,
      sanitizedCode: 'unauthorized',
      sanitizedMessage:
        res.status === 401
          ? 'TI rejected the token. Re-check credentials and that Product Information API access is approved.'
          : 'TI returned 403. Verify the app is entitled for the Product Information API suite.',
    }, [`ti_http_${res.status}`])
  }
  if (res.status === 404) {
    return buildProductError(cleaned, 'no_match', {
      httpStatus: 404,
      sanitizedCode: 'not_found',
      sanitizedMessage: 'TI Product Information API returned 404 for that part number.',
    }, ['ti_not_found'])
  }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  if (!res.ok) {
    const ext = tryExtractTiError(bodyText)
    return buildProductError(cleaned, 'error', {
      httpStatus: res.status,
      sanitizedCode: ext.code ?? `http_${res.status}`,
      sanitizedMessage: sanitizeMessage(ext.message ?? bodyText, env),
    }, [`ti_http_${res.status}`])
  }
  let data: any
  try { data = JSON.parse(bodyText) } catch {
    return buildProductError(cleaned, 'error', {
      httpStatus: res.status,
      sanitizedCode: 'invalid_json',
      sanitizedMessage: 'Product response was not valid JSON.',
    }, ['ti_invalid_json'])
  }
  // TI response shape: defensive — accept several plausible field names. The
  // payload may be the product object itself or wrapped under `product` / `data`.
  const p = data?.product ?? data?.data ?? data
  const matchedPartNumber =
    pickString(p?.tiPartNumber, p?.partNumber, p?.opn, p?.productId) ?? cleaned
  const warnings: string[] = []
  if (!p || typeof p !== 'object') {
    warnings.push('ti_unexpected_response_shape')
  }
  const out: TiProductInfo = {
    source: 'Texas Instruments Product Information API',
    status: 'ok',
    partNumber: matchedPartNumber,
    genericPartNumber: pickString(p?.genericPartNumber, p?.genericProductId, p?.familyName, p?.productFamily),
    description: pickString(p?.description, p?.productDescription, p?.shortDescription),
    lifecycleStatus: pickString(p?.lifecycleStatus, p?.lifecycle, p?.productStatus),
    package: pickString(p?.package, p?.packageType, p?.packagingType, p?.packageName),
    datasheetUrl: pickString(p?.datasheetUrl, p?.dataSheetUrl, p?.datasheet),
    qualityReliability:
      p?.qualityReliability && typeof p.qualityReliability === 'object'
        ? (p.qualityReliability as Record<string, unknown>)
        : p?.quality && typeof p.quality === 'object'
          ? (p.quality as Record<string, unknown>)
          : null,
    fetchedAt: new Date().toISOString(),
    warnings,
    diagnostics: {
      httpStatus: res.status,
      sanitizedCode: null,
      sanitizedMessage: '',
    },
  }
  return out
}

// ── Store API: Inventory & Pricing (gated until approval lands) ─────────────

export type TiInventoryPricing = {
  source: 'Texas Instruments Store API'
  status:
    | 'ok'
    | 'no_match'
    | 'error'
    | 'auth_failed'
    | 'rate_limited'
    | 'token_failed'
    | 'not_configured'
    | 'pending_approval'
  partNumber: string
  quantity: number | null
  pricing: Array<{ breakQuantity: number; unitPrice: number; currency: string }> | null
  orderLimit: number | null
  futureInventory: Array<{ forecastDate: string; forecastQuantity: number }> | null
  /** Earliest forecast row (convenience). */
  forecastDate: string | null
  forecastQuantity: number | null
  fetchedAt: string
  warnings: string[]
  diagnostics: {
    httpStatus: number | null
    sanitizedCode: string | null
    sanitizedMessage: string
  }
}

function buildInventoryStub(
  partNumber: string,
  status: TiInventoryPricing['status'],
  diag: TiInventoryPricing['diagnostics'],
  warnings: string[],
): TiInventoryPricing {
  return {
    source: 'Texas Instruments Store API',
    status,
    partNumber,
    quantity: null,
    pricing: null,
    orderLimit: null,
    futureInventory: null,
    forecastDate: null,
    forecastQuantity: null,
    fetchedAt: new Date().toISOString(),
    warnings,
    diagnostics: diag,
  }
}

export async function fetchTiInventoryPricing(
  env: TiEnv,
  partNumber: string,
): Promise<TiInventoryPricing> {
  const cleaned = (partNumber || '').trim()
  if (!cleaned) {
    return buildInventoryStub('', 'error', {
      httpStatus: null,
      sanitizedCode: 'invalid_partnumber',
      sanitizedMessage: 'partNumber is required.',
    }, ['ti_invalid_partnumber'])
  }
  const config = checkTiConfigured(env)
  if (!config.configured) {
    return buildInventoryStub(cleaned, 'not_configured', {
      httpStatus: null,
      sanitizedCode: 'not_configured',
      sanitizedMessage: 'TI adapter not configured.',
    }, ['ti_not_configured'])
  }
  // Phase 20A spec — refuse to call TI Store endpoints unless the operator has
  // explicitly flipped TI_STORE_API_ENABLED=true after the Store API suite
  // approval lands. Default state is 'pending_approval'.
  if (config.storeApiState !== 'enabled') {
    return buildInventoryStub(cleaned, 'pending_approval', {
      httpStatus: null,
      sanitizedCode: 'store_api_pending',
      sanitizedMessage:
        'TI Store API approval pending. Set TI_STORE_API_ENABLED=true after the Store API suite is approved.',
    }, ['ti_store_api_pending_approval'])
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    return buildInventoryStub(cleaned, 'token_failed', {
      httpStatus: tok.httpStatus,
      sanitizedCode: tok.sanitizedCode,
      sanitizedMessage: tok.sanitizedMessage,
    }, [tok.status])
  }
  let res: Response
  try {
    res = await fetch(INVENTORY_PRICING_URL(cleaned), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        Accept: 'application/json',
      },
    })
  } catch (e: any) {
    return buildInventoryStub(cleaned, 'error', {
      httpStatus: null,
      sanitizedCode: 'unreachable',
      sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env),
    }, ['ti_unreachable'])
  }
  if (res.status === 429) {
    return buildInventoryStub(cleaned, 'rate_limited', {
      httpStatus: 429, sanitizedCode: 'rate_limited', sanitizedMessage: 'TI Store API rate limit hit.',
    }, ['ti_rate_limited'])
  }
  if (res.status === 401 || res.status === 403) {
    return buildInventoryStub(cleaned, 'auth_failed', {
      httpStatus: res.status,
      sanitizedCode: 'unauthorized',
      sanitizedMessage:
        'TI rejected the Store API request. Verify Store API suite approval and that TI_STORE_API_ENABLED=true reflects current entitlement.',
    }, [`ti_http_${res.status}`])
  }
  if (res.status === 404) {
    return buildInventoryStub(cleaned, 'no_match', {
      httpStatus: 404, sanitizedCode: 'not_found', sanitizedMessage: 'TI Store API returned 404 for that part number.',
    }, ['ti_not_found'])
  }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  if (!res.ok) {
    const ext = tryExtractTiError(bodyText)
    return buildInventoryStub(cleaned, 'error', {
      httpStatus: res.status,
      sanitizedCode: ext.code ?? `http_${res.status}`,
      sanitizedMessage: sanitizeMessage(ext.message ?? bodyText, env),
    }, [`ti_http_${res.status}`])
  }
  let data: any
  try { data = JSON.parse(bodyText) } catch {
    return buildInventoryStub(cleaned, 'error', {
      httpStatus: res.status, sanitizedCode: 'invalid_json', sanitizedMessage: 'Store API response was not valid JSON.',
    }, ['ti_invalid_json'])
  }
  const p = data?.product ?? data?.data ?? data
  // Defensive normalization — TI's exact field names will solidify with the
  // first successful Store API call. Each access is null-safe.
  const pricing: Array<{ breakQuantity: number; unitPrice: number; currency: string }> | null =
    Array.isArray(p?.pricing)
      ? p.pricing
          .map((b: any) => ({
            breakQuantity: Number(b?.breakQuantity ?? b?.quantity ?? 0),
            unitPrice: Number(b?.unitPrice ?? b?.price ?? 0),
            currency: typeof b?.currency === 'string' ? b.currency : 'USD',
          }))
          .filter((r: any) => Number.isFinite(r.breakQuantity) && Number.isFinite(r.unitPrice) && r.unitPrice > 0)
      : null
  const futureInventory: Array<{ forecastDate: string; forecastQuantity: number }> | null =
    Array.isArray(p?.futureInventory)
      ? p.futureInventory
          .map((r: any) => ({
            forecastDate: typeof r?.forecastDate === 'string' ? r.forecastDate : '',
            forecastQuantity: Number(r?.forecastQuantity ?? r?.quantity ?? 0),
          }))
          .filter((r: any) => r.forecastDate && Number.isFinite(r.forecastQuantity))
      : null
  const earliest = futureInventory && futureInventory.length > 0
    ? futureInventory.slice().sort((a, b) => a.forecastDate.localeCompare(b.forecastDate))[0]
    : null
  return {
    source: 'Texas Instruments Store API',
    status: 'ok',
    partNumber: typeof p?.partNumber === 'string' ? p.partNumber : cleaned,
    quantity: typeof p?.quantity === 'number' ? p.quantity : (typeof p?.availableQuantity === 'number' ? p.availableQuantity : null),
    pricing,
    orderLimit: typeof p?.orderLimit === 'number' ? p.orderLimit : null,
    futureInventory,
    forecastDate: earliest?.forecastDate ?? null,
    forecastQuantity: earliest?.forecastQuantity ?? null,
    fetchedAt: new Date().toISOString(),
    warnings: [],
    diagnostics: {
      httpStatus: res.status,
      sanitizedCode: null,
      sanitizedMessage: '',
    },
  }
}

// ── Cached freshness accessor ───────────────────────────────────────────────
// Used by /api/ti/status to surface "Last token refresh" without doing a fresh
// network round-trip when the cache is warm.
export function tokenCacheSnapshot():
  | { hasCache: true; fetchedAt: string; expiresAt: string }
  | { hasCache: false } {
  if (!tokenCache) return { hasCache: false }
  return {
    hasCache: true,
    fetchedAt: new Date(tokenCache.fetchedAtMs).toISOString(),
    expiresAt: new Date(tokenCache.expiresAtMs).toISOString(),
  }
}
