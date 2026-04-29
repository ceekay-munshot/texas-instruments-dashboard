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
//   Store I&P:      https://transact.ti.com/v1/store/products/inventory-pricing?partNumber={pn}
//
// Each default can be overridden via env var (no redeploy needed). The
// templates use `{partNumber}` as a placeholder so a single env value covers
// the path without hand-coding URL building on the operator side.
const DEFAULT_TOKEN_URL = 'https://transact.ti.com/v1/oauth/accesstoken'
const DEFAULT_PRODUCT_INFO_TPL = 'https://transact.ti.com/v1/products/{partNumber}'
const DEFAULT_PRODUCT_INFO_EXT_TPL = 'https://transact.ti.com/v1/products-extended/{partNumber}?page=0'
const DEFAULT_INVENTORY_PRICING_TPL = 'https://transact.ti.com/v1/store/products/inventory-pricing?partNumber={partNumber}'

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
  const inv = safeUrlSummary(resolveInventoryPricingUrl(env, '_placeholder_'))
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
