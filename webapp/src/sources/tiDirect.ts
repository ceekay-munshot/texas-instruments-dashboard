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

// Phase 20A.1 — defaults aligned to TI's official docs.
//   Token endpoint: https://transact.ti.com/v1/oauth/accesstoken
//   Product info:   https://transact.ti.com/v1/products/{partNumber}
//   Extended info:  https://transact.ti.com/v1/products-extended/{partNumber}?page=0
//
// Phase 20C.1 — Store Inventory & Pricing moved to the v2 production path.
// The v1 query-string variant returned 401 even after Store API approval;
// TI's published v2 endpoint puts the part number in the path:
//   Store I&P (v2):  https://transact.ti.com/v2/store/products/{partNumber}?currency=USD
//
// Each default can be overridden via env var (no redeploy needed). The
// templates use `{partNumber}` as a placeholder so a single env value covers
// the path without hand-coding URL building on the operator side.
const DEFAULT_TOKEN_URL = 'https://transact.ti.com/v1/oauth/accesstoken'
const DEFAULT_PRODUCT_INFO_TPL = 'https://transact.ti.com/v1/products/{partNumber}'
const DEFAULT_PRODUCT_INFO_EXT_TPL = 'https://transact.ti.com/v1/products-extended/{partNumber}?page=0'
const DEFAULT_INVENTORY_PRICING_TPL = 'https://transact.ti.com/v2/store/products/{partNumber}?currency=USD'
// Phase 23B — full-catalog probe endpoint. Default URL targets TI's catalog
// path under the same v2 store base; an env override lets the operator
// re-point without redeploy. NEVER called by daily capture; only the
// auth-gated /api/ti/universe/catalog/probe endpoint hits it, and at most
// once per operator-initiated probe.
const DEFAULT_CATALOG_URL = 'https://transact.ti.com/v2/store/products/catalog'

const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000 // 55 min, per spec

export type TiEnv = {
  TI_CLIENT_ID?: string
  TI_CLIENT_SECRET?: string
  TI_API_ENV?: string
  TI_STORE_API_ENABLED?: string
  /** Phase 20A.1 — operator-safe URL overrides. None of these are secrets;
   *  they're surfaced via /api/ti/status as host + path so the operator can
   *  confirm what's being called without redeploying. */
  TI_TOKEN_URL?: string
  TI_PRODUCT_INFO_URL_TEMPLATE?: string
  TI_PRODUCT_INFO_EXTENDED_URL_TEMPLATE?: string
  TI_INVENTORY_PRICING_URL_TEMPLATE?: string
  /** Phase 23B — full-catalog URL override for the auth-gated probe.
   *  Same operator-safe override pattern as the other URL templates;
   *  no secrets, surfaced in the probe diagnostic as host+path only. */
  TI_CATALOG_URL?: string
}

// Resolve URL helpers — operator env always wins over the default.
function resolveTokenUrl(env: TiEnv): string {
  return (env.TI_TOKEN_URL && env.TI_TOKEN_URL.trim()) || DEFAULT_TOKEN_URL
}
function resolveProductInfoUrl(env: TiEnv, partNumber: string): string {
  const tpl = (env.TI_PRODUCT_INFO_URL_TEMPLATE && env.TI_PRODUCT_INFO_URL_TEMPLATE.trim()) || DEFAULT_PRODUCT_INFO_TPL
  return tpl.split('{partNumber}').join(encodeURIComponent(partNumber))
}
function resolveProductInfoExtendedUrl(env: TiEnv, partNumber: string): string {
  const tpl = (env.TI_PRODUCT_INFO_EXTENDED_URL_TEMPLATE && env.TI_PRODUCT_INFO_EXTENDED_URL_TEMPLATE.trim()) || DEFAULT_PRODUCT_INFO_EXT_TPL
  return tpl.split('{partNumber}').join(encodeURIComponent(partNumber))
}
function resolveInventoryPricingUrl(env: TiEnv, partNumber: string): string {
  const tpl = (env.TI_INVENTORY_PRICING_URL_TEMPLATE && env.TI_INVENTORY_PRICING_URL_TEMPLATE.trim()) || DEFAULT_INVENTORY_PRICING_TPL
  return tpl.split('{partNumber}').join(encodeURIComponent(partNumber))
}
function resolveCatalogUrl(env: TiEnv): string {
  return (env.TI_CATALOG_URL && env.TI_CATALOG_URL.trim()) || DEFAULT_CATALOG_URL
}

/** Safe URL inspection: returns host and path only — never the query string,
 *  never any embedded secret. Used for /api/ti/status diagnostics. */
function safeUrlSummary(url: string): { host: string; path: string } {
  try {
    const u = new URL(url)
    return { host: u.host, path: u.pathname }
  } catch {
    return { host: '', path: '' }
  }
}

/** Phase 20C.1 — template-friendly URL summary for endpoints whose default
 *  carries `{partNumber}` directly in the path. Substitutes a sentinel before
 *  parsing so the URL constructor doesn't percent-encode the curly braces,
 *  then restores `{partNumber}` in the pathname so the diagnostic display
 *  reads `/v2/store/products/{partNumber}` instead of an opaque placeholder. */
function safeTemplateUrlSummary(tpl: string): { host: string; path: string } {
  const SENTINEL = '__TI_PARTNUMBER_TPL__'
  try {
    const u = new URL(tpl.split('{partNumber}').join(SENTINEL))
    return {
      host: u.host,
      path: u.pathname.split(SENTINEL).join('{partNumber}'),
    }
  } catch {
    return { host: '', path: '' }
  }
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

export function sanitizeMessage(raw: string | null | undefined, env: TiEnv): string {
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
  const tokenUrl = resolveTokenUrl(env)
  try {
    res = await fetch(tokenUrl, {
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
  /** What the caller asked for (may be a generic part number / GPN). */
  requestedPartNumber: string
  /** What we actually queried — may differ from `requestedPartNumber` if a
   *  GPN→OPN fallback was used. */
  resolvedPartNumber: string | null
  /** True iff `requestedPartNumber` was mapped to a different OPN before the call. */
  fallbackUsed: boolean
  partNumber: string
  genericPartNumber: string | null
  description: string | null
  lifecycleStatus: string | null
  package: string | null
  datasheetUrl: string | null
  /** Phase 20A.2 — surfaced when TI returns them. */
  leadTimeWeeks: number | null
  inventoryStatus: string | null
  okayToOrder: boolean | null
  qualityReliability: Record<string, unknown> | null
  parametric: Record<string, unknown> | null
  fetchedAt: string
  warnings: string[]
  diagnostics: {
    httpStatus: number | null
    sanitizedCode: string | null
    sanitizedMessage: string
    /** Which TI endpoints actually got hit during this call. */
    basicEndpointHit: boolean
    extendedEndpointHit: boolean
    /** True when the extended call filled in fields the basic call left null. */
    extendedFilledGaps: boolean
  }
}

function buildProductError(
  requestedPartNumber: string,
  resolvedPartNumber: string | null,
  fallbackUsed: boolean,
  status: TiProductInfo['status'],
  diag: TiProductInfo['diagnostics'],
  warnings: string[],
): TiProductInfo {
  return {
    source: 'Texas Instruments Product Information API',
    status,
    requestedPartNumber,
    resolvedPartNumber,
    fallbackUsed,
    partNumber: resolvedPartNumber ?? requestedPartNumber,
    genericPartNumber: null,
    description: null,
    lifecycleStatus: null,
    package: null,
    datasheetUrl: null,
    leadTimeWeeks: null,
    inventoryStatus: null,
    okayToOrder: null,
    qualityReliability: null,
    parametric: null,
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

function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function pickBool(...vals: unknown[]): boolean | null {
  for (const v of vals) {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (s === 'true' || s === 'yes' || s === 'y') return true
      if (s === 'false' || s === 'no' || s === 'n') return false
    }
  }
  return null
}

function pickObject(...vals: unknown[]): Record<string, unknown> | null {
  for (const v of vals) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  }
  return null
}

// ── GPN → OPN fallback map (Phase 20A.2) ────────────────────────────────────
// TI's Product Information API returns 404 for generic part numbers. The
// frontend / customer often only knows the GPN. We hold a small static map
// from GPN to one canonical OPN so a 404 can be retried automatically with
// the resolved OPN. Add more entries here as we discover them.
const GPN_TO_OPN: Record<string, string> = {
  AFE7799: 'AFE7799IABJ',
}

function resolveOpnFromGpn(input: string): { opn: string; mapped: boolean } {
  const upper = (input || '').trim().toUpperCase()
  const opn = GPN_TO_OPN[upper]
  if (opn) return { opn, mapped: true }
  return { opn: input, mapped: false }
}

// ── Response shape resolver (Phase 20A.2) ───────────────────────────────────
// TI's response can land in any of five shapes (A–E from the spec). Resolve
// to a canonical { product, quality, parametric } trio so the field extractor
// only has to know one shape.
function extractProductObject(data: any): {
  product: Record<string, unknown> | null
  quality: Record<string, unknown> | null
  parametric: Record<string, unknown> | null
} {
  if (!data) return { product: null, quality: null, parametric: null }
  // E) bare array → first element
  if (Array.isArray(data)) {
    return {
      product: (data[0] && typeof data[0] === 'object') ? data[0] : null,
      quality: null,
      parametric: null,
    }
  }
  if (typeof data !== 'object') return { product: null, quality: null, parametric: null }
  // D) wrapper with products[]
  if (Array.isArray((data as any).products) && (data as any).products.length > 0) {
    const p = (data as any).products[0]
    return {
      product: p && typeof p === 'object' ? p : null,
      quality: pickObject((data as any).Quality, (data as any).ProductQuality, (data as any).QualityReliability),
      parametric: pickObject((data as any).Parametric, (data as any).Parameters),
    }
  }
  if (Array.isArray((data as any).Products) && (data as any).Products.length > 0) {
    const p = (data as any).Products[0]
    return {
      product: p && typeof p === 'object' ? p : null,
      quality: pickObject((data as any).Quality, (data as any).ProductQuality, (data as any).QualityReliability),
      parametric: pickObject((data as any).Parametric, (data as any).Parameters),
    }
  }
  // C) wrapper with `data` — recurse one level
  if ((data as any).data && typeof (data as any).data === 'object' && !Array.isArray((data as any).data)) {
    const inner = (data as any).data
    if (inner.Product || inner.product) {
      return {
        product: pickObject(inner.Product, inner.product),
        quality: pickObject(inner.Quality, inner.ProductQuality, inner.QualityReliability),
        parametric: pickObject(inner.Parametric, inner.Parameters),
      }
    }
    return {
      product: inner,
      quality: pickObject(inner.Quality, inner.ProductQuality, inner.QualityReliability),
      parametric: pickObject(inner.Parametric, inner.Parameters),
    }
  }
  // B) wrapper with `Product` + sibling Quality/Parametric
  if ((data as any).Product || (data as any).product) {
    return {
      product: pickObject((data as any).Product, (data as any).product),
      quality: pickObject((data as any).Quality, (data as any).ProductQuality, (data as any).QualityReliability),
      parametric: pickObject((data as any).Parametric, (data as any).Parameters),
    }
  }
  // `productDetails` wrapper sometimes appears
  if ((data as any).productDetails && typeof (data as any).productDetails === 'object') {
    return {
      product: (data as any).productDetails as Record<string, unknown>,
      quality: pickObject((data as any).Quality, (data as any).ProductQuality, (data as any).QualityReliability),
      parametric: pickObject((data as any).Parametric, (data as any).Parameters),
    }
  }
  // A) the data object IS the product
  return {
    product: data as Record<string, unknown>,
    quality: pickObject((data as any).Quality, (data as any).ProductQuality, (data as any).QualityReliability),
    parametric: pickObject((data as any).Parametric, (data as any).Parameters),
  }
}

type ExtractedFields = {
  partNumber: string | null
  genericPartNumber: string | null
  description: string | null
  lifecycleStatus: string | null
  package: string | null
  datasheetUrl: string | null
  leadTimeWeeks: number | null
  inventoryStatus: string | null
  okayToOrder: boolean | null
}

function extractFields(p: Record<string, unknown> | null): ExtractedFields {
  if (!p) {
    return {
      partNumber: null, genericPartNumber: null, description: null, lifecycleStatus: null,
      package: null, datasheetUrl: null, leadTimeWeeks: null, inventoryStatus: null, okayToOrder: null,
    }
  }
  const a: any = p
  // Package: prefer IndustryPackageType; otherwise compose from PackageGroup + PackageType.
  let pkg = pickString(a.IndustryPackageType, a.industryPackageType, a.Package, a.package)
  const grp = pickString(a.PackageGroup, a.packageGroup)
  const typ = pickString(a.PackageType, a.packageType, a.PackageName, a.packageName)
  if (!pkg && grp && typ) pkg = `${grp}/${typ}`
  else if (!pkg && (grp || typ)) pkg = grp || typ
  // Datasheet URL: prefer DatasheetUrl; only accept Url if it looks like a datasheet.
  let datasheetUrl = pickString(a.DatasheetUrl, a.datasheetUrl, a.dataSheetUrl, a.datasheet)
  if (!datasheetUrl) {
    const u = pickString(a.Url, a.url)
    if (u && /datasheet|\.pdf(\?|$)/i.test(u)) datasheetUrl = u
  }
  return {
    partNumber: pickString(a.Identifier, a.identifier, a.tiPartNumber, a.partNumber, a.opn, a.OPN, a.productId),
    genericPartNumber: pickString(
      a.GenericProductIdentifier,
      a.genericProductIdentifier,
      a.genericPartNumber,
      a.GenericPartNumber,
      a.baseProductNumber,
      a.BaseProductNumber,
      a.familyName,
      a.productFamily,
    ),
    description: pickString(a.Description, a.description, a.productDescription, a.shortDescription, a.LongDescription),
    lifecycleStatus: pickString(
      a.LifeCycleStatus,
      a.lifeCycleStatus,
      a.lifecycleStatus,
      a.lifecycle,
      a.productStatus,
      a.ProductStatus,
    ),
    package: pkg,
    datasheetUrl,
    leadTimeWeeks: pickNumber(a.LeadTimeWeeks, a.leadTimeWeeks),
    inventoryStatus: pickString(a.InventoryStatus, a.inventoryStatus),
    okayToOrder: pickBool(a.OkayToOrder, a.okayToOrder),
  }
}

function fieldsHaveGaps(f: ExtractedFields): boolean {
  // Considered "sparse" if the most-customer-visible fields are still null.
  return !f.description || !f.lifecycleStatus || !f.package || !f.datasheetUrl
}

function mergeFields(base: ExtractedFields, extra: ExtractedFields): ExtractedFields {
  return {
    partNumber: base.partNumber ?? extra.partNumber,
    genericPartNumber: base.genericPartNumber ?? extra.genericPartNumber,
    description: base.description ?? extra.description,
    lifecycleStatus: base.lifecycleStatus ?? extra.lifecycleStatus,
    package: base.package ?? extra.package,
    datasheetUrl: base.datasheetUrl ?? extra.datasheetUrl,
    leadTimeWeeks: base.leadTimeWeeks ?? extra.leadTimeWeeks,
    inventoryStatus: base.inventoryStatus ?? extra.inventoryStatus,
    okayToOrder: base.okayToOrder ?? extra.okayToOrder,
  }
}

// ── Single product GET — used by both fetcher and debug endpoint ────────────

type ProductCallResult =
  | { kind: 'ok'; data: any; httpStatus: number; url: string }
  | { kind: 'no_match'; httpStatus: number; url: string }
  | { kind: 'http_error'; httpStatus: number; bodyText: string; url: string }
  | { kind: 'unreachable'; message: string; url: string }
  | { kind: 'invalid_json'; httpStatus: number; url: string }

async function fetchProductJson(token: string, url: string): Promise<ProductCallResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  } catch (e: any) {
    return { kind: 'unreachable', message: String(e?.message || 'unknown error'), url }
  }
  if (res.status === 404) return { kind: 'no_match', httpStatus: 404, url }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  if (!res.ok) return { kind: 'http_error', httpStatus: res.status, bodyText, url }
  try {
    const data = JSON.parse(bodyText)
    return { kind: 'ok', data, httpStatus: res.status, url }
  } catch {
    return { kind: 'invalid_json', httpStatus: res.status, url }
  }
}

export async function fetchTiProductInfo(
  env: TiEnv,
  partNumber: string,
): Promise<TiProductInfo> {
  const requested = (partNumber || '').trim()
  if (!requested) {
    return buildProductError('', null, false, 'error', {
      httpStatus: null, sanitizedCode: 'invalid_partnumber',
      sanitizedMessage: 'partNumber is required.',
      basicEndpointHit: false, extendedEndpointHit: false, extendedFilledGaps: false,
    }, ['ti_invalid_partnumber'])
  }
  const config = checkTiConfigured(env)
  if (!config.configured) {
    return buildProductError(requested, null, false, 'not_configured', {
      httpStatus: null, sanitizedCode: 'not_configured',
      sanitizedMessage: 'TI adapter not configured.',
      basicEndpointHit: false, extendedEndpointHit: false, extendedFilledGaps: false,
    }, ['ti_not_configured'])
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    return buildProductError(requested, null, false, 'token_failed', {
      httpStatus: tok.httpStatus, sanitizedCode: tok.sanitizedCode,
      sanitizedMessage: tok.sanitizedMessage,
      basicEndpointHit: false, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [tok.status])
  }

  // Try the basic endpoint with the input as-is first. If it 404s, try the
  // GPN→OPN fallback map and retry once.
  const warnings: string[] = []
  let resolved = requested
  let fallbackUsed = false

  let basic = await fetchProductJson(tok.token, resolveProductInfoUrl(env, resolved))
  if (basic.kind === 'no_match') {
    const { opn, mapped } = resolveOpnFromGpn(requested)
    if (mapped && opn !== resolved) {
      warnings.push(`ti_gpn_to_opn_fallback:${requested}=>${opn}`)
      resolved = opn
      fallbackUsed = true
      basic = await fetchProductJson(tok.token, resolveProductInfoUrl(env, resolved))
    }
  }

  // Map basic-call results to outcomes. We may either:
  //  - Return early on hard failures (auth, rate-limit, unreachable, etc.)
  //  - Continue to extended-merge on a 200 result.
  if (basic.kind === 'http_error' && basic.httpStatus === 429) {
    return buildProductError(requested, resolved, fallbackUsed, 'rate_limited', {
      httpStatus: 429, sanitizedCode: 'rate_limited',
      sanitizedMessage: 'TI API rate limit hit.',
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, 'ti_rate_limited'])
  }
  if (basic.kind === 'http_error' && (basic.httpStatus === 401 || basic.httpStatus === 403)) {
    return buildProductError(requested, resolved, fallbackUsed, 'auth_failed', {
      httpStatus: basic.httpStatus, sanitizedCode: 'unauthorized',
      sanitizedMessage:
        basic.httpStatus === 401
          ? 'TI rejected the token. Re-check credentials and that Product Information API access is approved.'
          : 'TI returned 403. Verify the app is entitled for the Product Information API suite.',
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, `ti_http_${basic.httpStatus}`])
  }
  if (basic.kind === 'http_error') {
    const ext = tryExtractTiError(basic.bodyText)
    return buildProductError(requested, resolved, fallbackUsed, 'error', {
      httpStatus: basic.httpStatus,
      sanitizedCode: ext.code ?? `http_${basic.httpStatus}`,
      sanitizedMessage: sanitizeMessage(ext.message ?? basic.bodyText, env),
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, `ti_http_${basic.httpStatus}`])
  }
  if (basic.kind === 'unreachable') {
    return buildProductError(requested, resolved, fallbackUsed, 'error', {
      httpStatus: null, sanitizedCode: 'unreachable',
      sanitizedMessage: sanitizeMessage(basic.message, env),
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, 'ti_unreachable'])
  }
  if (basic.kind === 'invalid_json') {
    return buildProductError(requested, resolved, fallbackUsed, 'error', {
      httpStatus: basic.httpStatus, sanitizedCode: 'invalid_json',
      sanitizedMessage: 'Product response was not valid JSON.',
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, 'ti_invalid_json'])
  }
  if (basic.kind === 'no_match') {
    return buildProductError(requested, resolved, fallbackUsed, 'no_match', {
      httpStatus: 404, sanitizedCode: 'not_found',
      sanitizedMessage: fallbackUsed
        ? 'TI Product Information API returned 404 for the input and the GPN→OPN fallback.'
        : 'TI Product Information API returned 404 for that part number.',
      basicEndpointHit: true, extendedEndpointHit: false, extendedFilledGaps: false,
    }, [...warnings, 'ti_not_found'])
  }

  // basic.kind === 'ok'. Parse + extract.
  const basicResolved = extractProductObject(basic.data)
  let fields = extractFields(basicResolved.product)
  let quality = basicResolved.quality
  let parametric = basicResolved.parametric
  let extendedEndpointHit = false
  let extendedFilledGaps = false

  // If important fields are still missing, try the extended endpoint and
  // merge whatever new fields it provides.
  if (fieldsHaveGaps(fields) || !quality || !parametric) {
    const ext = await fetchProductJson(tok.token, resolveProductInfoExtendedUrl(env, resolved))
    extendedEndpointHit = true
    if (ext.kind === 'ok') {
      const extResolved = extractProductObject(ext.data)
      const extFields = extractFields(extResolved.product)
      const merged = mergeFields(fields, extFields)
      // Did extended actually add anything?
      const filled =
        (!fields.description && !!merged.description) ||
        (!fields.lifecycleStatus && !!merged.lifecycleStatus) ||
        (!fields.package && !!merged.package) ||
        (!fields.datasheetUrl && !!merged.datasheetUrl) ||
        (!fields.genericPartNumber && !!merged.genericPartNumber)
      if (filled) extendedFilledGaps = true
      fields = merged
      quality = quality ?? extResolved.quality
      parametric = parametric ?? extResolved.parametric
    } else if (ext.kind === 'http_error' && (ext.httpStatus === 401 || ext.httpStatus === 403)) {
      // Don't fail the call — extended is best-effort.
      warnings.push(`ti_extended_http_${ext.httpStatus}`)
    } else if (ext.kind === 'http_error') {
      warnings.push(`ti_extended_http_${ext.httpStatus}`)
    } else if (ext.kind !== 'no_match') {
      warnings.push(`ti_extended_${ext.kind}`)
    }
  }

  return {
    source: 'Texas Instruments Product Information API',
    status: 'ok',
    requestedPartNumber: requested,
    resolvedPartNumber: resolved,
    fallbackUsed,
    partNumber: fields.partNumber ?? resolved,
    genericPartNumber: fields.genericPartNumber,
    description: fields.description,
    lifecycleStatus: fields.lifecycleStatus,
    package: fields.package,
    datasheetUrl: fields.datasheetUrl,
    leadTimeWeeks: fields.leadTimeWeeks,
    inventoryStatus: fields.inventoryStatus,
    okayToOrder: fields.okayToOrder,
    qualityReliability: quality,
    parametric,
    fetchedAt: new Date().toISOString(),
    warnings,
    diagnostics: {
      httpStatus: basic.httpStatus,
      sanitizedCode: null,
      sanitizedMessage: '',
      basicEndpointHit: true,
      extendedEndpointHit,
      extendedFilledGaps,
    },
  }
}

// ── Debug endpoint helper (Phase 20A.2) ─────────────────────────────────────
// Returns sanitized shape information for both the basic and extended TI
// product endpoints so the operator can see exactly which paths exist in
// TI's response without ever leaking the raw body, the token, or the headers.

export type TiProductDebugReport = {
  label: 'basic' | 'extended'
  attemptedHost: string
  attemptedPath: string
  httpStatus: number | null
  success: boolean
  topLevelKeys: string[]
  /** First-level child keys for objects directly under the root. */
  nestedKeys: Record<string, string[]>
  /** Length for any first-level array on the root. */
  arrayLengths: Record<string, number>
  /** For each well-known field path, whether a non-empty value exists. */
  sampleFieldPaths: Record<string, 'present' | 'absent'>
  /** Whether the canonical extractor could find a product object at all. */
  productResolved: boolean
  sanitizedCode: string | null
  sanitizedMessage: string
}

const SAMPLE_FIELD_PATHS = [
  'Identifier',
  'Description',
  'GenericProductIdentifier',
  'LifeCycleStatus',
  'DatasheetUrl',
  'Url',
  'IndustryPackageType',
  'PackageGroup',
  'PackageType',
  'OkayToOrder',
  'LeadTimeWeeks',
  'InventoryStatus',
  'Product.Identifier',
  'Product.Description',
  'Product.GenericProductIdentifier',
  'Product.LifeCycleStatus',
  'Product.DatasheetUrl',
  'Product.IndustryPackageType',
  'Product.PackageGroup',
  'Product.PackageType',
  'Quality',
  'Parametric',
  'data.Identifier',
  'data.Description',
  'data.Product.Identifier',
  'products[0].Identifier',
  'products[0].Description',
  'productDetails.Identifier',
  'productDetails.Description',
] as const

function getPath(obj: any, path: string): unknown {
  if (obj == null) return undefined
  // Support tokens like 'products[0]' and 'data.Product'
  let cursor: any = obj
  const parts = path.split('.')
  for (const part of parts) {
    if (cursor == null) return undefined
    const m = part.match(/^([^\[\]]+)\[(\d+)\]$/)
    if (m) {
      const key = m[1]
      const idx = parseInt(m[2], 10)
      cursor = cursor[key]
      if (!Array.isArray(cursor)) return undefined
      cursor = cursor[idx]
    } else {
      cursor = cursor[part]
    }
  }
  return cursor
}

function summarizeShape(label: 'basic' | 'extended', url: string, call: ProductCallResult, env: TiEnv): TiProductDebugReport {
  const summary = safeUrlSummary(url)
  const base: TiProductDebugReport = {
    label,
    attemptedHost: summary.host,
    attemptedPath: summary.path,
    httpStatus: null,
    success: false,
    topLevelKeys: [],
    nestedKeys: {},
    arrayLengths: {},
    sampleFieldPaths: {},
    productResolved: false,
    sanitizedCode: null,
    sanitizedMessage: '',
  }
  if (call.kind === 'unreachable') {
    return { ...base, sanitizedCode: 'unreachable', sanitizedMessage: sanitizeMessage(call.message, env) }
  }
  if (call.kind === 'no_match') {
    return { ...base, httpStatus: 404, sanitizedCode: 'not_found', sanitizedMessage: 'TI returned 404.' }
  }
  if (call.kind === 'http_error') {
    const ext = tryExtractTiError(call.bodyText)
    return {
      ...base,
      httpStatus: call.httpStatus,
      sanitizedCode: ext.code ?? `http_${call.httpStatus}`,
      sanitizedMessage: sanitizeMessage(ext.message ?? call.bodyText, env),
    }
  }
  if (call.kind === 'invalid_json') {
    return { ...base, httpStatus: call.httpStatus, sanitizedCode: 'invalid_json', sanitizedMessage: 'Response was not valid JSON.' }
  }
  // ok
  const data = call.data
  const topLevelKeys = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.keys(data)
    : Array.isArray(data) ? ['(array)']
      : []
  const nestedKeys: Record<string, string[]> = {}
  const arrayLengths: Record<string, number> = {}
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of topLevelKeys) {
      const v = (data as any)[k]
      if (Array.isArray(v)) {
        arrayLengths[k] = v.length
        if (v.length > 0 && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) {
          nestedKeys[`${k}[0]`] = Object.keys(v[0]).slice(0, 50)
        }
      } else if (v && typeof v === 'object') {
        nestedKeys[k] = Object.keys(v).slice(0, 50)
      }
    }
  } else if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === 'object') {
    arrayLengths['(root)'] = data.length
    nestedKeys['[0]'] = Object.keys(data[0]).slice(0, 50)
  }
  const sampleFieldPaths: Record<string, 'present' | 'absent'> = {}
  for (const path of SAMPLE_FIELD_PATHS) {
    const v = getPath(data, path)
    sampleFieldPaths[path] = (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''))
      ? 'absent' : 'present'
  }
  const resolved = extractProductObject(data)
  return {
    ...base,
    httpStatus: call.httpStatus,
    success: true,
    topLevelKeys,
    nestedKeys,
    arrayLengths,
    sampleFieldPaths,
    productResolved: !!resolved.product,
  }
}

export async function fetchTiProductInfoDebug(
  env: TiEnv,
  partNumber: string,
): Promise<{
  requestedPartNumber: string
  resolvedPartNumber: string
  fallbackUsed: boolean
  basic: TiProductDebugReport
  extended: TiProductDebugReport
}> {
  const requested = (partNumber || '').trim()
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    const fail: TiProductDebugReport = {
      label: 'basic',
      attemptedHost: '',
      attemptedPath: '',
      httpStatus: tok.httpStatus,
      success: false,
      topLevelKeys: [],
      nestedKeys: {},
      arrayLengths: {},
      sampleFieldPaths: {},
      productResolved: false,
      sanitizedCode: tok.sanitizedCode,
      sanitizedMessage: tok.sanitizedMessage,
    }
    return {
      requestedPartNumber: requested,
      resolvedPartNumber: requested,
      fallbackUsed: false,
      basic: { ...fail, label: 'basic' },
      extended: { ...fail, label: 'extended' },
    }
  }
  // Try requested first; if 404 and we have a GPN→OPN map, retry with the OPN.
  let resolved = requested
  let fallbackUsed = false
  let basicCall = await fetchProductJson(tok.token, resolveProductInfoUrl(env, resolved))
  if (basicCall.kind === 'no_match') {
    const { opn, mapped } = resolveOpnFromGpn(requested)
    if (mapped && opn !== resolved) {
      resolved = opn
      fallbackUsed = true
      basicCall = await fetchProductJson(tok.token, resolveProductInfoUrl(env, resolved))
    }
  }
  const extendedCall = await fetchProductJson(tok.token, resolveProductInfoExtendedUrl(env, resolved))
  return {
    requestedPartNumber: requested,
    resolvedPartNumber: resolved,
    fallbackUsed,
    basic: summarizeShape('basic', resolveProductInfoUrl(env, resolved), basicCall, env),
    extended: summarizeShape('extended', resolveProductInfoExtendedUrl(env, resolved), extendedCall, env),
  }
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
  const inventoryUrl = resolveInventoryPricingUrl(env, cleaned)
  try {
    res = await fetch(inventoryUrl, {
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
  // Phase 21D.1 — TI Store production shape is nested:
  //   pricing[] -> { currency, priceBreaks[] -> { priceBreakQuantity, price } }
  // extractTiPriceBreaks handles that AND the legacy flat shape; both come
  // back as a single flat normalized array so the rest of the pipeline can
  // stay shape-agnostic. Returns [] (not null) when nothing extractable.
  const extracted = extractTiPriceBreaks(p, 'USD')
  const pricing: Array<{ breakQuantity: number; unitPrice: number; currency: string }> | null =
    extracted.length > 0
      ? extracted.map(b => ({
          breakQuantity: b.breakQuantity,
          unitPrice: b.unitPrice,
          currency: b.currency ?? 'USD',
        }))
      : (Array.isArray(p?.pricing) ? [] : null)
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

// ── Phase 21D / 21D.1 — pricing normalization + diagnostic ─────────────────

/** Phase 21D.1 — robust extractor for TI Store price breaks. Handles two
 *  shapes that we've actually observed in the wild:
 *
 *  A) Nested (TI's current production shape):
 *       pricing: [
 *         { currency: "USD",
 *           priceBreaks: [
 *             { priceBreakQuantity: 1,  price: 2.03 },
 *             { priceBreakQuantity: 10, price: 1.43 },
 *             { priceBreakQuantity: 25, price: 1.35 } ] } ]
 *
 *  B) Legacy flat:
 *       pricing: [{ breakQuantity, unitPrice, currency }]
 *
 *  Quantity field aliases:  priceBreakQuantity, breakQuantity, quantity, qty,
 *                           minimumQuantity
 *  Price field aliases:     price, unitPrice, value, priceEach
 *  Currency aliases:        break.currency, container.currency, p.currency,
 *                           defaultCurrency fallback (caller-supplied; the
 *                           production parser passes 'USD' since the URL is
 *                           ?currency=USD).
 *
 *  Drops entries with non-finite breakQuantity ≤ 0 or unitPrice ≤ 0. Returns
 *  a flat normalized array with a `sourceShape` marker so diagnostics can
 *  report which path matched. */
export type ExtractedPriceBreak = {
  breakQuantity: number
  unitPrice: number
  currency: string | null
  sourceShape: 'ti_nested_priceBreaks' | 'flat_pricing'
}

const PRICE_BREAK_QTY_ALIASES = ['priceBreakQuantity', 'breakQuantity', 'quantity', 'qty', 'minimumQuantity'] as const
const PRICE_BREAK_PRICE_ALIASES = ['price', 'unitPrice', 'value', 'priceEach'] as const

function readNumberAlias(obj: any, keys: readonly string[]): number {
  if (!obj || typeof obj !== 'object') return NaN
  for (const k of keys) {
    const v = (obj as any)[k]
    if (v != null) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return NaN
}

export function extractTiPriceBreaks(
  productLike: any,
  defaultCurrency: string | null = 'USD',
): ExtractedPriceBreak[] {
  const out: ExtractedPriceBreak[] = []
  if (!productLike || typeof productLike !== 'object') return out
  const pricingArr = Array.isArray(productLike.pricing) ? productLike.pricing : []
  const productCurrency = typeof productLike.currency === 'string' ? productLike.currency : null
  for (const container of pricingArr) {
    if (!container || typeof container !== 'object') continue
    const containerCurrency =
      typeof (container as any).currency === 'string' ? (container as any).currency : null
    // Shape A — nested priceBreaks (current TI Store production shape).
    if (Array.isArray((container as any).priceBreaks)) {
      for (const br of (container as any).priceBreaks) {
        if (!br || typeof br !== 'object') continue
        const breakQuantity = readNumberAlias(br, PRICE_BREAK_QTY_ALIASES)
        const unitPrice = readNumberAlias(br, PRICE_BREAK_PRICE_ALIASES)
        if (!Number.isFinite(breakQuantity) || breakQuantity <= 0) continue
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue
        const breakCurrency =
          typeof (br as any).currency === 'string' ? (br as any).currency : null
        out.push({
          breakQuantity,
          unitPrice,
          currency: breakCurrency ?? containerCurrency ?? productCurrency ?? defaultCurrency,
          sourceShape: 'ti_nested_priceBreaks',
        })
      }
      continue
    }
    // Shape B — legacy flat pricing entries.
    const breakQuantity = readNumberAlias(container, PRICE_BREAK_QTY_ALIASES)
    const unitPrice = readNumberAlias(container, PRICE_BREAK_PRICE_ALIASES)
    if (!Number.isFinite(breakQuantity) || breakQuantity <= 0) continue
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue
    out.push({
      breakQuantity,
      unitPrice,
      currency: containerCurrency ?? productCurrency ?? defaultCurrency,
      sourceShape: 'flat_pricing',
    })
  }
  return out
}

/** Pick the price break that the dashboard uses as `normalizedUnitPrice`.
 *  Spec: prefer 1000-piece, then 100, then 1, then the largest break ≤ 1000,
 *  else the lowest available break. Returns null if no usable break exists. */
export function chooseNormalizedPriceBreak(
  pricing: TiInventoryPricing['pricing'] | ExtractedPriceBreak[] | null | undefined,
): { breakQuantity: number; unitPrice: number; currency: string } | null {
  if (!Array.isArray(pricing) || pricing.length === 0) return null
  const valid = pricing
    .filter(b =>
      Number.isFinite((b as any).breakQuantity) &&
      Number.isFinite((b as any).unitPrice) &&
      (b as any).unitPrice > 0,
    )
    .map(b => ({
      breakQuantity: Number((b as any).breakQuantity),
      unitPrice: Number((b as any).unitPrice),
      currency: typeof (b as any).currency === 'string' ? (b as any).currency : 'USD',
    }))
  if (valid.length === 0) return null
  const at = (q: number) => valid.find(b => b.breakQuantity === q) ?? null
  const at1000 = at(1000)
  if (at1000) return at1000
  const at100 = at(100)
  if (at100) return at100
  const at1 = at(1)
  if (at1) return at1
  // Largest break <= 1000; falls back to the lowest break if all > 1000.
  const sortedDesc = valid.slice().sort((a, b) => b.breakQuantity - a.breakQuantity)
  const leMax = sortedDesc.find(b => b.breakQuantity <= 1000)
  if (leMax) return leMax
  // All breaks > 1000 — return the smallest (cheapest fully-qualified break).
  return valid.slice().sort((a, b) => a.breakQuantity - b.breakQuantity)[0]
}

/** Sanitized debug shape used by the auth-gated pricing-diagnostic endpoint.
 *  Reports response-shape evidence without exposing tokens, headers, raw
 *  bodies, or the OAuth secret. The candidate-key probe surfaces alternate
 *  field names that TI might use (priceBreaks, prices, priceList, …) so we
 *  can tell "TI returned no pricing for this part" apart from "our parser is
 *  looking under the wrong key". */
export type TiInventoryPricingDebug = {
  partNumber: string
  source: string
  status: TiInventoryPricing['status']
  httpStatus: number | null
  sanitizedCode: string | null
  sanitizedMessage: string
  attemptedHost: string
  attemptedPath: string
  responseTopLevelKeys: string[]
  productLevelKeys: string[]
  productLevelKeysFound: 'product' | 'data' | 'top-level' | 'none'
  candidateKeyProbe: Array<{ key: string; type: string; arrayLength: number | null; firstItemKeys: string[] }>
  parsedPricingArrayLength: number
  parsedFutureInventoryLength: number
  pricingFirstBreakKeys: string[]
  pricingFirstBreakSample: { breakQuantity: number; unitPrice: number; currency: string } | null
  // Phase 21D.1 — nested-shape evidence so the diagnostic can prove that the
  // refactored extractor sees what TI actually returns.
  pricingContainerLength: number
  nestedPriceBreaksLength: number
  firstPriceBreakKeys: string[]
  extractedSourceShape: ExtractedPriceBreak['sourceShape'] | null
  parserOutput: {
    pricingAvailability: 'available' | 'unavailable' | 'pending_approval' | 'unknown'
    normalizedUnitPrice: number | null
    normalizedPriceQty: number | null
    normalizedCurrency: string | null
    priceBreaksCount: number
    quantityAvailable: number | null
    orderLimit: number | null
  }
  diagnosis: string
  warnings: string[]
}

/** Run fetchTiInventoryPricing then return a SANITIZED inspection of the
 *  parsed object. Never returns the raw TI body, the OAuth token, or any
 *  Authorization header. The candidateKeyProbe inspects the parsed JSON
 *  shape only — purely structural. */
export async function fetchTiInventoryPricingDebug(
  env: TiEnv,
  partNumber: string,
): Promise<TiInventoryPricingDebug> {
  const cleaned = (partNumber || '').trim()
  const baseEndpoints = tiAttemptedEndpoints(env)
  const baseDebug: TiInventoryPricingDebug = {
    partNumber: cleaned,
    source: 'Texas Instruments Store API',
    status: 'error',
    httpStatus: null,
    sanitizedCode: null,
    sanitizedMessage: '',
    attemptedHost: baseEndpoints.attemptedInventoryPricingHost,
    attemptedPath: baseEndpoints.attemptedInventoryPricingPath,
    responseTopLevelKeys: [],
    productLevelKeys: [],
    productLevelKeysFound: 'none',
    candidateKeyProbe: [],
    parsedPricingArrayLength: 0,
    parsedFutureInventoryLength: 0,
    pricingFirstBreakKeys: [],
    pricingFirstBreakSample: null,
    pricingContainerLength: 0,
    nestedPriceBreaksLength: 0,
    firstPriceBreakKeys: [],
    extractedSourceShape: null,
    parserOutput: {
      pricingAvailability: 'unknown',
      normalizedUnitPrice: null,
      normalizedPriceQty: null,
      normalizedCurrency: null,
      priceBreaksCount: 0,
      quantityAvailable: null,
      orderLimit: null,
    },
    diagnosis: '',
    warnings: [],
  }
  if (!cleaned) {
    return { ...baseDebug, status: 'error', sanitizedCode: 'invalid_partnumber', sanitizedMessage: 'partNumber is required.', diagnosis: 'partNumber missing.' }
  }
  // Re-issue the same fetch the production parser does, but capture the
  // raw body locally so we can inspect its shape. The parser path is
  // duplicated rather than refactored to keep the production hot path
  // unchanged for Phase 21D.
  const config = checkTiConfigured(env)
  if (!config.configured) {
    return { ...baseDebug, status: 'not_configured', sanitizedCode: 'not_configured', sanitizedMessage: 'TI adapter not configured.', diagnosis: 'TI credentials missing.' }
  }
  if (config.storeApiState !== 'enabled') {
    return { ...baseDebug, status: 'pending_approval', sanitizedCode: 'store_api_pending', sanitizedMessage: 'TI Store API approval pending.', diagnosis: 'TI Store API entitlement disabled (TI_STORE_API_ENABLED != true).' }
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    return { ...baseDebug, status: 'token_failed', httpStatus: tok.httpStatus, sanitizedCode: tok.sanitizedCode, sanitizedMessage: tok.sanitizedMessage, diagnosis: 'TI OAuth token fetch failed.' }
  }
  const inventoryUrl = resolveInventoryPricingUrl(env, cleaned)
  let res: Response
  try {
    res = await fetch(inventoryUrl, { method: 'GET', headers: { Authorization: `Bearer ${tok.token}`, Accept: 'application/json' } })
  } catch (e: any) {
    return { ...baseDebug, status: 'error', sanitizedCode: 'unreachable', sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env), diagnosis: 'TI Store endpoint unreachable.' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ...baseDebug, status: 'auth_failed', httpStatus: res.status, sanitizedCode: 'unauthorized', sanitizedMessage: 'TI rejected the request.', diagnosis: 'TI rejected the auth token for the Store API. Verify Store API suite approval and TI_STORE_API_ENABLED entitlement.' }
  }
  if (res.status === 404) {
    return { ...baseDebug, status: 'no_match', httpStatus: 404, sanitizedCode: 'not_found', sanitizedMessage: 'TI Store API returned 404.', diagnosis: 'Part not recognized by TI Store API.' }
  }
  if (res.status === 429) {
    return { ...baseDebug, status: 'rate_limited', httpStatus: 429, sanitizedCode: 'rate_limited', sanitizedMessage: 'TI Store API rate limit hit.', diagnosis: 'Rate limited; back off and retry.' }
  }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  if (!res.ok) {
    const ext = tryExtractTiError(bodyText)
    return { ...baseDebug, status: 'error', httpStatus: res.status, sanitizedCode: ext.code ?? `http_${res.status}`, sanitizedMessage: sanitizeMessage(ext.message ?? bodyText, env), diagnosis: `Non-2xx HTTP ${res.status} from TI Store.` }
  }
  let data: any
  try { data = JSON.parse(bodyText) } catch {
    return { ...baseDebug, status: 'error', httpStatus: res.status, sanitizedCode: 'invalid_json', sanitizedMessage: 'Store API response was not valid JSON.', diagnosis: 'TI Store returned non-JSON; parser cannot proceed.' }
  }
  // Walk the response shape — keys only; never report raw values to the
  // caller. The candidate-key probe is the bit that tells "TI returned no
  // pricing" apart from "our parser is looking under the wrong key".
  const responseTopLevelKeys = data && typeof data === 'object' ? Object.keys(data) : []
  let p: any = null
  let productLevelKeysFound: TiInventoryPricingDebug['productLevelKeysFound'] = 'none'
  if (data && typeof data === 'object') {
    if (data.product && typeof data.product === 'object') { p = data.product; productLevelKeysFound = 'product' }
    else if (data.data && typeof data.data === 'object') { p = data.data; productLevelKeysFound = 'data' }
    else { p = data; productLevelKeysFound = 'top-level' }
  }
  const productLevelKeys = p && typeof p === 'object' ? Object.keys(p) : []
  const PRICING_CANDIDATE_KEYS = ['pricing', 'prices', 'priceBreaks', 'priceList', 'priceTier', 'priceTiers', 'productPricing', 'priceBreakdowns', 'unitPrices']
  const candidateKeyProbe = PRICING_CANDIDATE_KEYS.map(key => {
    const v = p?.[key]
    let arrayLength: number | null = null
    let firstItemKeys: string[] = []
    if (Array.isArray(v)) {
      arrayLength = v.length
      const first = v[0]
      if (first && typeof first === 'object') firstItemKeys = Object.keys(first)
    }
    return { key, type: Array.isArray(v) ? 'array' : (v == null ? 'absent' : typeof v), arrayLength, firstItemKeys }
  })
  // Phase 21D.1 — route through the same extractor the production parser
  // uses (handles BOTH the nested TI Store shape and the legacy flat shape).
  const extracted = extractTiPriceBreaks(p, 'USD')
  const futureInventory: Array<any> | null =
    Array.isArray(p?.futureInventory)
      ? p.futureInventory.filter((r: any) => r && typeof r === 'object')
      : null
  const chosen = chooseNormalizedPriceBreak(extracted)
  const pricingAvailability = extracted.length > 0 ? 'available' : 'unavailable'
  const quantityAvailable = typeof p?.quantity === 'number' ? p.quantity : (typeof p?.availableQuantity === 'number' ? p.availableQuantity : null)
  const orderLimit = typeof p?.orderLimit === 'number' ? p.orderLimit : null
  // Nested-shape evidence for the diagnostic — counts that prove which
  // shape the extractor saw, without leaking raw prices.
  const pricingArr = Array.isArray(p?.pricing) ? p.pricing : []
  const pricingFirstBreakKeys = pricingArr[0] && typeof pricingArr[0] === 'object' ? Object.keys(pricingArr[0]) : []
  const nestedContainerWithBreaks = pricingArr.find((c: any) => c && Array.isArray(c.priceBreaks) && c.priceBreaks.length > 0)
  const nestedPriceBreaks = nestedContainerWithBreaks ? nestedContainerWithBreaks.priceBreaks : []
  const firstPriceBreakKeys = nestedPriceBreaks[0] && typeof nestedPriceBreaks[0] === 'object'
    ? Object.keys(nestedPriceBreaks[0])
    : []
  const extractedSourceShape: ExtractedPriceBreak['sourceShape'] | null = extracted[0]?.sourceShape ?? null
  const altCandidate = candidateKeyProbe.find(c => c.key !== 'pricing' && c.arrayLength != null && c.arrayLength > 0)
  let diagnosis = ''
  if (extracted.length > 0) {
    const shapeLabel = extractedSourceShape === 'ti_nested_priceBreaks'
      ? 'TI nested pricing[].priceBreaks[] (priceBreakQuantity/price)'
      : 'legacy flat pricing[] (breakQuantity/unitPrice)'
    diagnosis = `Parsed ${extracted.length} price break(s) via ${shapeLabel}; chosen normalized unit price = ${chosen?.unitPrice ?? 'n/a'} ${chosen?.currency ?? ''} at qty=${chosen?.breakQuantity ?? 'n/a'}.`
  } else if (altCandidate) {
    diagnosis = `Pricing not under "pricing" — TI returned data under "${altCandidate.key}" (length=${altCandidate.arrayLength}). First-item keys: ${altCandidate.firstItemKeys.join(',')}.`
  } else if (pricingArr.length > 0) {
    diagnosis = `TI returned a "pricing" container with ${pricingArr.length} entries, but no usable break (every priceBreaks entry filtered: non-finite/zero qty or price). first-item keys: ${pricingFirstBreakKeys.join(',')}.`
  } else {
    diagnosis = 'TI Store API returned the part successfully, but the response carries no pricing container under any known candidate key — pricing is genuinely unavailable for this part/account.'
  }
  return {
    ...baseDebug,
    status: 'ok',
    httpStatus: res.status,
    sanitizedCode: null,
    sanitizedMessage: '',
    responseTopLevelKeys,
    productLevelKeys,
    productLevelKeysFound,
    candidateKeyProbe,
    parsedPricingArrayLength: pricingArr.length,
    parsedFutureInventoryLength: Array.isArray(futureInventory) ? futureInventory.length : 0,
    pricingFirstBreakKeys,
    pricingFirstBreakSample: chosen,
    pricingContainerLength: pricingArr.length,
    nestedPriceBreaksLength: nestedPriceBreaks.length,
    firstPriceBreakKeys,
    extractedSourceShape,
    parserOutput: {
      pricingAvailability,
      normalizedUnitPrice: chosen?.unitPrice ?? null,
      normalizedPriceQty: chosen?.breakQuantity ?? null,
      normalizedCurrency: chosen?.currency ?? null,
      priceBreaksCount: extracted.length,
      quantityAvailable,
      orderLimit,
    },
    diagnosis,
    warnings: [],
  }
}

// ── Phase 23B — full-catalog probe (read-only diagnostic) ─────────────────
//
// This is a ONE-SHOT diagnostic. It is NOT production ingestion, NEVER
// expands the active watched universe, NEVER mutates D1 / KV / R2, and is
// only invoked from the auth-gated /api/ti/universe/catalog/probe endpoint.
// It exists so the operator can decide whether full-universe scaling
// should use catalog snapshots or stick with OPN-level batch calls.
//
// Sanitization rules (same as the per-part pricing diagnostic):
//   - Never returns the raw response body
//   - Never returns the OAuth token, the Authorization header, or the
//     client id / client secret
//   - Returns host + path only for the attempted endpoint
//   - Returns shape evidence (top-level keys, sample-product field
//     names, pagination candidates) without any underlying values that
//     could be sensitive

export type TiCatalogProbe = {
  attemptedHost: string
  attemptedPath: string
  attemptedQuery: string                 // sanitized: literal `currency=USD&size=10` etc., never tokens
  status:
    | 'ok'
    | 'no_match'
    | 'error'
    | 'auth_failed'
    | 'rate_limited'
    | 'token_failed'
    | 'not_configured'
    | 'pending_approval'
    | 'unreachable'
    | 'invalid_json'
  httpStatus: number | null
  sanitizedCode: string | null
  sanitizedMessage: string
  contentType: string | null
  bodyByteSize: number | null
  // Top-level shape evidence
  responseTopLevelKeys: string[]
  responseTopLevelTypes: Record<string, string>
  // Pagination probe — known-pattern keys and their type/value when present
  paginationProbe: Array<{ key: string; type: string; numericValue: number | null; stringValue: string | null }>
  totalProductsClaimed: number | null     // best-effort: total / totalCount / totalElements / totalProducts
  // Products array probe
  productsArrayPath: string | null        // 'products' | 'data.products' | 'items' | 'results' | 'skus' | 'catalog' | null
  productsArrayLength: number | null      // length of the first-page array
  // Sample product (first item) — keys only, never values
  sampleProductKeys: string[]
  sampleProductFieldsPresent: {
    orderablePartNumber: boolean
    genericPartNumber: boolean
    quantityAvailable: boolean
    pricingContainer: boolean
    nestedPriceBreaks: boolean
    currency: boolean
    category: boolean
    subcategory: boolean
    lifecycle: boolean
    leadTime: boolean
    package: boolean
  }
  // Recommendations (booleans + a one-line `diagnosis`)
  supports: {
    fullUniverseInventorySnapshot: boolean
    fullUniversePriceSnapshot: boolean
    categorySubcategoryAggregation: boolean
    partDrilldown: boolean
  }
  diagnosis: string
  warnings: string[]
}

// Field-name aliases the probe checks per-product. These are the same
// alias families the per-part parser already supports plus a couple of
// catalog-likely variants (e.g. `tiPartNumber` from the Store I&P shape).
const PROBE_OPN_KEYS    = ['orderablePartNumber', 'tiPartNumber', 'partNumber', 'opn', 'productId', 'id', 'sku']
const PROBE_GPN_KEYS    = ['genericPartNumber', 'gpn', 'genericPart']
const PROBE_QTY_KEYS    = ['quantityAvailable', 'quantity', 'availableQuantity', 'inStock', 'stockQuantity']
const PROBE_PRICING_KEYS = ['pricing', 'prices', 'priceList', 'productPricing', 'priceBreakdowns', 'unitPrices']
const PROBE_BREAKS_KEYS  = ['priceBreaks', 'breaks', 'tieredPricing']
const PROBE_CURRENCY_KEYS = ['currency', 'priceCurrency']
const PROBE_CATEGORY_KEYS    = ['category', 'productCategory', 'categoryName', 'topCategory']
const PROBE_SUBCATEGORY_KEYS = ['subcategory', 'subCategory', 'productSubcategory', 'subCategoryName']
const PROBE_LIFECYCLE_KEYS   = ['lifecycle', 'lifecycleStatus', 'lifeCycle', 'productLifecycleStatus', 'productStatus']
const PROBE_LEADTIME_KEYS    = ['leadTime', 'leadTimeWeeks', 'manufacturingLeadTime', 'leadTimeDays']
const PROBE_PACKAGE_KEYS     = ['package', 'packageName', 'packageType', 'packaging']
const PROBE_PAGINATION_KEYS  = [
  'totalCount', 'total', 'totalProducts', 'totalElements', 'totalRecords',
  'page', 'pageNumber', 'currentPage', 'pageSize', 'size', 'limit', 'count',
  'hasMore', 'hasNextPage', 'hasNext', 'next', 'nextUrl', 'nextPageToken', 'cursor',
] as const
const PROBE_PRODUCTS_PATHS = ['products', 'data', 'items', 'results', 'skus', 'catalog', 'productList']

function findFirstObject(v: unknown): Record<string, unknown> | null {
  if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
    return v[0] as Record<string, unknown>
  }
  return null
}
function hasAnyKey(obj: Record<string, unknown> | null, keys: readonly string[]): boolean {
  if (!obj) return false
  for (const k of keys) {
    if (k in obj && obj[k] != null) return true
  }
  return false
}
function hasNestedPriceBreaks(product: Record<string, unknown> | null): boolean {
  if (!product) return false
  for (const containerKey of PROBE_PRICING_KEYS) {
    const v = product[containerKey]
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0]
      if (first && typeof first === 'object') {
        for (const breaksKey of PROBE_BREAKS_KEYS) {
          if (Array.isArray((first as any)[breaksKey])) return true
        }
      }
    }
  }
  return false
}

export async function fetchTiCatalogProbe(env: TiEnv): Promise<TiCatalogProbe> {
  const fullUrl = resolveCatalogUrl(env)
  const summary = safeUrlSummary(fullUrl)
  // Capture the literal query string (already free of tokens — we never
  // append the Authorization there). If the operator overrode TI_CATALOG_URL
  // with a query, this surfaces it as-is so the diagnostic is actionable.
  let attemptedQuery = ''
  try {
    const u = new URL(fullUrl)
    attemptedQuery = u.search.replace(/^\?/, '')
  } catch { /* swallow */ }

  const baseDiag: TiCatalogProbe = {
    attemptedHost: summary.host,
    attemptedPath: summary.path,
    attemptedQuery,
    status: 'error',
    httpStatus: null,
    sanitizedCode: null,
    sanitizedMessage: '',
    contentType: null,
    bodyByteSize: null,
    responseTopLevelKeys: [],
    responseTopLevelTypes: {},
    paginationProbe: [],
    totalProductsClaimed: null,
    productsArrayPath: null,
    productsArrayLength: null,
    sampleProductKeys: [],
    sampleProductFieldsPresent: {
      orderablePartNumber: false,
      genericPartNumber: false,
      quantityAvailable: false,
      pricingContainer: false,
      nestedPriceBreaks: false,
      currency: false,
      category: false,
      subcategory: false,
      lifecycle: false,
      leadTime: false,
      package: false,
    },
    supports: {
      fullUniverseInventorySnapshot: false,
      fullUniversePriceSnapshot: false,
      categorySubcategoryAggregation: false,
      partDrilldown: false,
    },
    diagnosis: '',
    warnings: [],
  }
  const config = checkTiConfigured(env)
  if (!config.configured) {
    return { ...baseDiag, status: 'not_configured', sanitizedCode: 'not_configured', sanitizedMessage: 'TI adapter not configured.', diagnosis: 'TI credentials missing.' }
  }
  if (config.storeApiState !== 'enabled') {
    return { ...baseDiag, status: 'pending_approval', sanitizedCode: 'store_api_pending', sanitizedMessage: 'TI Store API approval pending.', diagnosis: 'TI Store API entitlement disabled (TI_STORE_API_ENABLED != true).' }
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    return { ...baseDiag, status: 'token_failed', httpStatus: tok.httpStatus, sanitizedCode: tok.sanitizedCode, sanitizedMessage: tok.sanitizedMessage, diagnosis: 'TI OAuth token fetch failed.' }
  }
  let res: Response
  try {
    res = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        Accept: 'application/json',
      },
    })
  } catch (e: any) {
    return { ...baseDiag, status: 'unreachable', sanitizedCode: 'unreachable', sanitizedMessage: sanitizeMessage(e?.message || 'unknown error', env), diagnosis: 'TI catalog endpoint unreachable.' }
  }
  const contentType = res.headers.get('content-type')
  if (res.status === 401 || res.status === 403) {
    return {
      ...baseDiag,
      status: 'auth_failed', httpStatus: res.status, contentType,
      sanitizedCode: 'unauthorized',
      sanitizedMessage: 'TI rejected the catalog request.',
      diagnosis: `TI rejected the auth token for the catalog endpoint (HTTP ${res.status}). The Store API entitlement may not include catalog access — check the TI developer-portal product list for "catalog" alongside "Store Inventory & Pricing".`,
    }
  }
  if (res.status === 404) {
    return { ...baseDiag, status: 'no_match', httpStatus: 404, contentType, sanitizedCode: 'not_found', sanitizedMessage: 'TI catalog endpoint returned 404.', diagnosis: 'Catalog URL returned 404 — try a different path (set TI_CATALOG_URL env var).' }
  }
  if (res.status === 429) {
    return { ...baseDiag, status: 'rate_limited', httpStatus: 429, contentType, sanitizedCode: 'rate_limited', sanitizedMessage: 'TI catalog rate limit hit.', diagnosis: 'Rate limited; back off and retry.' }
  }
  let bodyText = ''
  try { bodyText = await res.text() } catch { bodyText = '' }
  const bodyByteSize = bodyText.length
  if (!res.ok) {
    const ext = tryExtractTiError(bodyText)
    return {
      ...baseDiag,
      status: 'error', httpStatus: res.status, contentType, bodyByteSize,
      sanitizedCode: ext.code ?? `http_${res.status}`,
      sanitizedMessage: sanitizeMessage(ext.message ?? bodyText, env),
      diagnosis: `Non-2xx HTTP ${res.status} from TI catalog endpoint.`,
    }
  }
  let data: unknown
  try { data = JSON.parse(bodyText) } catch {
    return { ...baseDiag, status: 'invalid_json', httpStatus: res.status, contentType, bodyByteSize, sanitizedCode: 'invalid_json', sanitizedMessage: 'TI catalog response was not valid JSON.', diagnosis: 'TI catalog returned non-JSON; cannot inspect shape.' }
  }
  // ── Shape inspection ──────────────────────────────────────────────────
  const obj = (data && typeof data === 'object') ? data as Record<string, unknown> : null
  const responseTopLevelKeys = obj ? Object.keys(obj) : []
  const responseTopLevelTypes: Record<string, string> = {}
  if (obj) {
    for (const k of responseTopLevelKeys) {
      const v = obj[k]
      responseTopLevelTypes[k] = Array.isArray(v) ? 'array' : (v == null ? 'null' : typeof v)
    }
  }
  // Pagination probe
  const paginationProbe = PROBE_PAGINATION_KEYS
    .filter(k => obj != null && k in obj)
    .map(k => {
      const v = obj![k]
      const numericValue = typeof v === 'number' && Number.isFinite(v) ? v : null
      const stringValue = typeof v === 'string' ? v : null
      return { key: k, type: Array.isArray(v) ? 'array' : (v == null ? 'null' : typeof v), numericValue, stringValue }
    })
  // Best-effort total
  let totalProductsClaimed: number | null = null
  for (const k of ['totalCount', 'total', 'totalProducts', 'totalElements', 'totalRecords']) {
    if (obj && typeof obj[k] === 'number' && Number.isFinite(obj[k] as number)) {
      totalProductsClaimed = obj[k] as number
      break
    }
  }
  // Products array probe
  let productsArrayPath: string | null = null
  let productsArr: unknown[] | null = null
  if (obj) {
    for (const path of PROBE_PRODUCTS_PATHS) {
      const v = obj[path]
      if (Array.isArray(v)) { productsArrayPath = path; productsArr = v as unknown[]; break }
    }
    // Try nested data.products etc.
    if (!productsArr && obj.data && typeof obj.data === 'object') {
      const inner = obj.data as Record<string, unknown>
      for (const path of PROBE_PRODUCTS_PATHS) {
        const v = inner[path]
        if (Array.isArray(v)) { productsArrayPath = `data.${path}`; productsArr = v as unknown[]; break }
      }
    }
  }
  const productsArrayLength = productsArr ? productsArr.length : null
  const sample = findFirstObject(productsArr)
  const sampleProductKeys = sample ? Object.keys(sample) : []
  const sampleProductFieldsPresent = {
    orderablePartNumber: hasAnyKey(sample, PROBE_OPN_KEYS),
    genericPartNumber: hasAnyKey(sample, PROBE_GPN_KEYS),
    quantityAvailable: hasAnyKey(sample, PROBE_QTY_KEYS),
    pricingContainer: hasAnyKey(sample, PROBE_PRICING_KEYS),
    nestedPriceBreaks: hasNestedPriceBreaks(sample),
    currency: hasAnyKey(sample, PROBE_CURRENCY_KEYS),
    category: hasAnyKey(sample, PROBE_CATEGORY_KEYS),
    subcategory: hasAnyKey(sample, PROBE_SUBCATEGORY_KEYS),
    lifecycle: hasAnyKey(sample, PROBE_LIFECYCLE_KEYS),
    leadTime: hasAnyKey(sample, PROBE_LEADTIME_KEYS),
    package: hasAnyKey(sample, PROBE_PACKAGE_KEYS),
  }
  const f = sampleProductFieldsPresent
  const supports = {
    fullUniverseInventorySnapshot: f.orderablePartNumber && f.quantityAvailable,
    fullUniversePriceSnapshot: f.orderablePartNumber && (f.pricingContainer || f.nestedPriceBreaks),
    categorySubcategoryAggregation: f.category, // subcategory is a bonus
    partDrilldown: f.orderablePartNumber,
  }
  // Diagnosis
  let diagnosis: string
  if (!productsArr) {
    diagnosis = obj
      ? `Catalog endpoint returned 200 but no products array found under any candidate key (${PROBE_PRODUCTS_PATHS.join(', ')}). Top-level keys: ${responseTopLevelKeys.join(', ')}.`
      : 'Catalog endpoint returned 200 but body was not a JSON object.'
  } else if (productsArr.length === 0) {
    diagnosis = `Catalog endpoint returned 200 with an empty "${productsArrayPath}" array (no products in this page; pagination may need explicit page params).`
  } else {
    const supportsList: string[] = []
    if (supports.fullUniverseInventorySnapshot) supportsList.push('full-universe inventory snapshot')
    if (supports.fullUniversePriceSnapshot) supportsList.push('full-universe price snapshot')
    if (supports.categorySubcategoryAggregation) supportsList.push('category aggregation')
    if (supports.partDrilldown) supportsList.push('part drilldown')
    diagnosis = `Catalog returned ${productsArr.length} products on this page${totalProductsClaimed != null ? ` (claimed total ${totalProductsClaimed})` : ''}. Sample product keys: ${sampleProductKeys.slice(0, 10).join(', ')}${sampleProductKeys.length > 10 ? '…' : ''}. Supports: ${supportsList.length > 0 ? supportsList.join(', ') : 'none of the four scaling paths (fields missing — see sampleProductFieldsPresent)'}.`
  }
  return {
    ...baseDiag,
    status: 'ok',
    httpStatus: res.status,
    contentType,
    bodyByteSize,
    sanitizedCode: null,
    sanitizedMessage: '',
    responseTopLevelKeys,
    responseTopLevelTypes,
    paginationProbe,
    totalProductsClaimed,
    productsArrayPath,
    productsArrayLength,
    sampleProductKeys,
    sampleProductFieldsPresent,
    supports,
    diagnosis,
    warnings: [],
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

/** Phase 20A.1 — return the host + path the adapter would call, for safe
 *  display in /api/ti/status diagnostics. Never includes query strings (which
 *  could carry secrets in a misconfigured override) or anything secret-bearing. */
export function tiAttemptedEndpoints(env: TiEnv): {
  attemptedTokenHost: string
  attemptedTokenPath: string
  attemptedProductInfoHost: string
  attemptedProductInfoPath: string
  attemptedInventoryPricingHost: string
  attemptedInventoryPricingPath: string
  tokenUrlOverridden: boolean
  productInfoUrlOverridden: boolean
  inventoryPricingUrlOverridden: boolean
} {
  const tok = safeUrlSummary(resolveTokenUrl(env))
  // Substitute a placeholder so the resolved URL has a real path shape but
  // never carries a real part number (no risk in this case, but keeps the
  // shape stable for display).
  const prod = safeUrlSummary(resolveProductInfoUrl(env, '_placeholder_'))
  // Phase 20C.1 — inventory template carries `{partNumber}` directly in the
  // path. Use the template-friendly summary so the diagnostic shows
  // `/v2/store/products/{partNumber}` rather than a substituted placeholder.
  const invTpl = (env.TI_INVENTORY_PRICING_URL_TEMPLATE && env.TI_INVENTORY_PRICING_URL_TEMPLATE.trim()) || DEFAULT_INVENTORY_PRICING_TPL
  const inv = safeTemplateUrlSummary(invTpl)
  return {
    attemptedTokenHost: tok.host,
    attemptedTokenPath: tok.path,
    attemptedProductInfoHost: prod.host,
    attemptedProductInfoPath: prod.path,
    attemptedInventoryPricingHost: inv.host,
    attemptedInventoryPricingPath: inv.path,
    tokenUrlOverridden: !!(env.TI_TOKEN_URL && env.TI_TOKEN_URL.trim()),
    productInfoUrlOverridden: !!(env.TI_PRODUCT_INFO_URL_TEMPLATE && env.TI_PRODUCT_INFO_URL_TEMPLATE.trim()),
    inventoryPricingUrlOverridden: !!(env.TI_INVENTORY_PRICING_URL_TEMPLATE && env.TI_INVENTORY_PRICING_URL_TEMPLATE.trim()),
  }
}
