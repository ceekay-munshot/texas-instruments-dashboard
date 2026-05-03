// Phase 23C — TI full-catalog snapshot ingest.
//
// One-shot, auth-gated. Fetches /v2/store/products/catalog (~50 MB,
// ~72k products), R2-archives the raw body, parses it, upserts the
// latest per-OPN + per-GPN state into D1, and inserts a snapshot-run
// summary row. NEVER expands the active 64-part watched universe;
// NEVER touches the daily-capture pipeline (those endpoints stay on
// /v2/store/products/{partNumber}). NEVER returns the raw response
// body, the OAuth token, or the Authorization header.
//
// Memory profile: the worker peaks at ~150 MB during the parse step
// (50 MB raw text + 100 MB parsed object). The Cloudflare Workers
// memory cap is 128 MB on the bundled-worker tier — this endpoint
// may OOM on the very first run if the catalog grows substantially.
// The endpoint surfaces that as `errors: ["worker_oom"]` rather than
// crashing the deploy.

import {
  fetchTiToken,
  checkTiConfigured,
  chooseNormalizedPriceBreak,
  extractTiPriceBreaks,
  sanitizeMessage,
  type TiEnv,
} from './tiDirect'

const DEFAULT_CATALOG_URL = 'https://transact.ti.com/v2/store/products/catalog'

// Minimal D1 + R2 type stubs so this module doesn't depend on
// @cloudflare/workers-types at compile time. The runtime objects are
// the real Cloudflare ones; the stub only narrows what we actually use.
export interface CatalogD1 {
  prepare(sql: string): CatalogD1Statement
  batch(statements: CatalogD1Statement[]): Promise<unknown>
}
export interface CatalogD1Statement {
  bind(...args: unknown[]): CatalogD1Statement
  run(): Promise<unknown>
  all<T = unknown>(): Promise<{ results?: T[] }>
}
export interface CatalogR2 {
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
}

export type CatalogIngestResult = {
  success: boolean
  capturedAt: string
  source: string
  totalOpns: number
  totalGpns: number
  pricedOpns: number
  inStockOpns: number
  outOfStockOpns: number
  rawR2Key: string | null
  bodyByteSize: number | null
  d1RowsUpserted: number
  gpnRowsUpserted: number
  parsedOk: boolean
  errors: string[]
  warnings: string[]
  /** Sanitized HTTP / parser diagnostics (no token, no body). */
  diagnostics: {
    httpStatus: number | null
    sanitizedCode: string | null
    sanitizedMessage: string
    contentType: string | null
    productsArrayPath: string | null
  }
}

function isoNow(): string {
  return new Date().toISOString()
}

function emptyResult(extras: Partial<CatalogIngestResult> = {}): CatalogIngestResult {
  return {
    success: false,
    capturedAt: isoNow(),
    source: 'ti_store_v2_catalog',
    totalOpns: 0,
    totalGpns: 0,
    pricedOpns: 0,
    inStockOpns: 0,
    outOfStockOpns: 0,
    rawR2Key: null,
    bodyByteSize: null,
    d1RowsUpserted: 0,
    gpnRowsUpserted: 0,
    parsedOk: false,
    errors: [],
    warnings: [],
    diagnostics: {
      httpStatus: null,
      sanitizedCode: null,
      sanitizedMessage: '',
      contentType: null,
      productsArrayPath: null,
    },
    ...extras,
  }
}

// Locate the products array in the catalog response. The probe in
// Phase 23B confirmed TI uses the top-level `catalog` key, but defend
// against minor shape changes (e.g. wrapped under `data`).
const PRODUCTS_PATHS = ['catalog', 'products', 'items', 'results', 'skus', 'data']

function locateProducts(data: unknown): { path: string | null; products: unknown[] | null } {
  if (!data || typeof data !== 'object') return { path: null, products: null }
  const obj = data as Record<string, unknown>
  for (const path of PRODUCTS_PATHS) {
    const v = obj[path]
    if (Array.isArray(v)) return { path, products: v }
  }
  if (obj.data && typeof obj.data === 'object') {
    const inner = obj.data as Record<string, unknown>
    for (const path of PRODUCTS_PATHS) {
      const v = inner[path]
      if (Array.isArray(v)) return { path: `data.${path}`, products: v }
    }
  }
  return { path: null, products: null }
}

type ParsedOpn = {
  opn: string
  gpn: string | null
  description: string | null
  quantity: number | null
  limitQty: number | null
  pricingJson: string | null
  normalizedUnitPrice: number | null
  normalizedPriceQty: number | null
  currency: string | null
  futureInventoryJson: string | null
  minimumOrderQuantity: number | null
  standardPackQuantity: number | null
  lifecycle: string | null
  buyNowUrl: string | null
}

export function parseProduct(p: unknown): ParsedOpn | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const opn = typeof o.tiPartNumber === 'string' ? o.tiPartNumber.trim()
    : typeof o.partNumber === 'string' ? o.partNumber.trim()
    : ''
  if (!opn) return null
  const gpn = typeof o.genericPartNumber === 'string' ? o.genericPartNumber.trim() : null
  const description = typeof o.description === 'string' ? o.description : null
  const quantity = typeof o.quantity === 'number' && Number.isFinite(o.quantity) ? Math.trunc(o.quantity) : null
  const limitQty = typeof o.limit === 'number' && Number.isFinite(o.limit) ? Math.trunc(o.limit)
    : typeof o.orderLimit === 'number' && Number.isFinite(o.orderLimit) ? Math.trunc(o.orderLimit) : null
  const moq = typeof o.minimumOrderQuantity === 'number' && Number.isFinite(o.minimumOrderQuantity) ? Math.trunc(o.minimumOrderQuantity) : null
  const spq = typeof o.standardPackQuantity === 'number' && Number.isFinite(o.standardPackQuantity) ? Math.trunc(o.standardPackQuantity) : null
  const lifecycle = typeof o.lifeCycle === 'string' ? o.lifeCycle
    : typeof o.lifecycleStatus === 'string' ? o.lifecycleStatus : null
  const buyNowUrl = typeof o.buyNowUrl === 'string' ? o.buyNowUrl : null
  // Pricing — reuse the production parser so the catalog row matches
  // what the per-OPN snapshot row would have stored.
  const breaks = extractTiPriceBreaks(o, 'USD')
  const chosen = chooseNormalizedPriceBreak(breaks)
  const pricingArr = Array.isArray(o.pricing) ? o.pricing : null
  const pricingJson = pricingArr && pricingArr.length > 0 ? JSON.stringify(pricingArr) : null
  const futureArr = Array.isArray(o.futureInventory) ? o.futureInventory : null
  const futureInventoryJson = futureArr && futureArr.length > 0 ? JSON.stringify(futureArr) : null
  return {
    opn,
    gpn,
    description,
    quantity,
    limitQty,
    pricingJson,
    normalizedUnitPrice: chosen?.unitPrice ?? null,
    normalizedPriceQty: chosen?.breakQuantity ?? null,
    currency: chosen?.currency ?? null,
    futureInventoryJson,
    minimumOrderQuantity: moq,
    standardPackQuantity: spq,
    lifecycle,
    buyNowUrl,
  }
}

type GpnAggregate = {
  gpn: string
  opnCount: number
  stockedOpnCount: number
  totalQuantity: number
  prices: number[]                    // normalizedUnitPrice values across OPNs (for min/median)
  cheapestOpn: string | null
  cheapestPrice: number | null
  highestInventoryOpn: string | null
  highestInventory: number | null
  lifecycleSummary: Map<string, number>
}

function newGpnAggregate(gpn: string): GpnAggregate {
  return {
    gpn,
    opnCount: 0,
    stockedOpnCount: 0,
    totalQuantity: 0,
    prices: [],
    cheapestOpn: null,
    cheapestPrice: null,
    highestInventoryOpn: null,
    highestInventory: null,
    lifecycleSummary: new Map(),
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

// Phase 23C.3 — D1 micro-batching. Cloudflare D1's effective bound-parameter
// cap per prepared statement is ~100 (the D1 v3 client raises "too many SQL
// variables at offset N" once a statement exceeds it, even though SQLite's
// own SQLITE_MAX_VARIABLE_NUMBER is 999). Phase 23C's first chunked pass
// used 50 rows × 16 cols = 800 binds per OPN statement, which always fails
// against the live D1. Cap conservatively and run multiple small INSERT OR
// REPLACE statements per chunk instead of one giant multi-row INSERT.
const MAX_D1_BIND_PARAMS = 90
const MAX_ROWS_PER_STATEMENT_CAP = 5

const UPSERT_OPN_COLS = [
  'ti_part_number', 'generic_part_number', 'description', 'quantity', 'limit_qty',
  'pricing_json', 'normalized_unit_price', 'normalized_price_qty', 'currency',
  'future_inventory_json', 'minimum_order_quantity', 'standard_pack_quantity',
  'lifecycle', 'buy_now_url', 'latest_captured_at', 'source',
]

const UPSERT_GPN_COLS = [
  'generic_part_number', 'opn_count', 'stocked_opn_count', 'total_quantity',
  'min_normalized_unit_price', 'median_normalized_unit_price',
  'cheapest_opn', 'highest_inventory_opn', 'lifecycle_summary',
  'latest_captured_at',
]

function buildMultiRowInsertSql(table: string, cols: string[], rowCount: number): string {
  const tuple = '(' + cols.map(() => '?').join(', ') + ')'
  const tuples = Array.from({ length: rowCount }, () => tuple).join(', ')
  return `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES ${tuples}`
}

/** Phase 23C.3 — derive the safe rows-per-statement count from a column
 *  list. Caller passes the actual UPSERT_*_COLS so the math always matches
 *  reality. Floor of (90 / paramsPerRow), clamped to [1, 5]. */
export function computeRowsPerStatement(paramsPerRow: number): number {
  if (!Number.isFinite(paramsPerRow) || paramsPerRow <= 0) return 1
  const raw = Math.floor(MAX_D1_BIND_PARAMS / paramsPerRow)
  return Math.max(1, Math.min(MAX_ROWS_PER_STATEMENT_CAP, raw))
}

/** Phase 23C.3 — sub-batch error shape returned in chunk diagnostics. Never
 *  exposes raw product payload, OAuth tokens, the capture secret, or D1
 *  bind values. The sanitizedError is the first 160 chars of err.message. */
export type SubBatchError = {
  table: 'ti_catalog_latest_opn' | 'ti_catalog_latest_gpn'
  subBatchStart: number
  subBatchEnd: number
  rowsInSubBatch: number
  sanitizedError: string
}

function sanitizeErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string') {
    return (e as any).message.slice(0, 160)
  }
  if (typeof e === 'string') return e.slice(0, 160)
  return fallback
}

/** Phase 23C.3 — micro-batched OPN upsert. Returns the number of rows
 *  successfully written and a sub-batch error list. paramsPerRow and
 *  rowsPerStatement are returned to the caller via the wrapping diagnostic. */
async function upsertOpnRows(
  d1: CatalogD1,
  rows: ParsedOpn[],
  capturedAt: string,
  source: string,
  subBatchErrors: SubBatchError[],
): Promise<{ upserted: number; sqlStatementsExecuted: number; rowsPerStatement: number }> {
  const paramsPerRow = UPSERT_OPN_COLS.length
  const rowsPerStatement = computeRowsPerStatement(paramsPerRow)
  let upserted = 0
  let sqlStatementsExecuted = 0
  for (let i = 0; i < rows.length; i += rowsPerStatement) {
    const subBatchStart = i
    const subBatchEnd = Math.min(i + rowsPerStatement, rows.length)
    const chunk = rows.slice(subBatchStart, subBatchEnd)
    const sql = buildMultiRowInsertSql('ti_catalog_latest_opn', UPSERT_OPN_COLS, chunk.length)
    const binds: unknown[] = []
    for (const r of chunk) {
      binds.push(
        r.opn,
        r.gpn,
        r.description,
        r.quantity,
        r.limitQty,
        r.pricingJson,
        r.normalizedUnitPrice,
        r.normalizedPriceQty,
        r.currency,
        r.futureInventoryJson,
        r.minimumOrderQuantity,
        r.standardPackQuantity,
        r.lifecycle,
        r.buyNowUrl,
        capturedAt,
        source,
      )
    }
    try {
      await d1.prepare(sql).bind(...binds).run()
      upserted += chunk.length
      sqlStatementsExecuted += 1
    } catch (e) {
      subBatchErrors.push({
        table: 'ti_catalog_latest_opn',
        subBatchStart,
        subBatchEnd,
        rowsInSubBatch: chunk.length,
        sanitizedError: sanitizeErrorMessage(e, 'd1 opn micro-batch failed'),
      })
    }
  }
  return { upserted, sqlStatementsExecuted, rowsPerStatement }
}

async function upsertGpnRows(
  d1: CatalogD1,
  aggregates: GpnAggregate[],
  capturedAt: string,
  subBatchErrors: SubBatchError[],
): Promise<{ upserted: number; sqlStatementsExecuted: number; rowsPerStatement: number }> {
  const paramsPerRow = UPSERT_GPN_COLS.length
  const rowsPerStatement = computeRowsPerStatement(paramsPerRow)
  let upserted = 0
  let sqlStatementsExecuted = 0
  for (let i = 0; i < aggregates.length; i += rowsPerStatement) {
    const subBatchStart = i
    const subBatchEnd = Math.min(i + rowsPerStatement, aggregates.length)
    const chunk = aggregates.slice(subBatchStart, subBatchEnd)
    const sql = buildMultiRowInsertSql('ti_catalog_latest_gpn', UPSERT_GPN_COLS, chunk.length)
    const binds: unknown[] = []
    for (const a of chunk) {
      const lifecycleSummaryJson = a.lifecycleSummary.size > 0
        ? JSON.stringify(Object.fromEntries(a.lifecycleSummary.entries()))
        : null
      binds.push(
        a.gpn,
        a.opnCount,
        a.stockedOpnCount,
        a.totalQuantity || 0,
        a.cheapestPrice,
        median(a.prices),
        a.cheapestOpn,
        a.highestInventoryOpn,
        lifecycleSummaryJson,
        capturedAt,
      )
    }
    try {
      await d1.prepare(sql).bind(...binds).run()
      upserted += chunk.length
      sqlStatementsExecuted += 1
    } catch (e) {
      subBatchErrors.push({
        table: 'ti_catalog_latest_gpn',
        subBatchStart,
        subBatchEnd,
        rowsInSubBatch: chunk.length,
        sanitizedError: sanitizeErrorMessage(e, 'd1 gpn micro-batch failed'),
      })
    }
  }
  return { upserted, sqlStatementsExecuted, rowsPerStatement }
}

async function insertSnapshotRunSummary(
  d1: CatalogD1,
  result: CatalogIngestResult,
): Promise<void> {
  try {
    await d1.prepare(
      `INSERT INTO ti_catalog_snapshot_run (
        captured_at, source, raw_r2_key, body_byte_size,
        total_opns, total_gpns, priced_opns, in_stock_opns, out_of_stock_opns,
        parsed_ok, errors_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      result.capturedAt,
      result.source,
      result.rawR2Key,
      result.bodyByteSize,
      result.totalOpns,
      result.totalGpns,
      result.pricedOpns,
      result.inStockOpns,
      result.outOfStockOpns,
      result.parsedOk ? 1 : 0,
      result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      isoNow(),
    ).run()
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'd1 snapshot run insert failed'
    result.errors.push(`d1_run_summary:${msg.slice(0, 100)}`)
  }
}

// ── Phase 23C.1 — chunked-ingest helpers ──────────────────────────────────
// Used by POST /api/ti/universe/catalog/ingest-chunk + /finalize + /status.
// Each Worker invocation only sees ~500 products at a time, so memory
// stays bounded. The TI catalog fetch happens in the GitHub Action
// runner (7GB RAM, can handle 50MB JSON trivially).

export type IngestChunkResult = {
  success: boolean
  runId: string
  chunkIndex: number
  totalChunks: number
  capturedAt: string
  attempted: number
  opnRowsUpserted: number
  pricedOpns: number
  inStockOpns: number
  outOfStockOpns: number
  /** Phase 23C.3 — D1 micro-batching diagnostics. paramsPerRow is the
   *  number of bound params each row contributes (= UPSERT_OPN_COLS.length);
   *  rowsPerStatement is what the writer derived from MAX_D1_BIND_PARAMS;
   *  sqlStatementsExecuted is the actual count of INSERT OR REPLACE
   *  statements run for this chunk. subBatchErrors is the structured
   *  per-failed-statement list (never includes raw product payload). */
  paramsPerRow: number
  rowsPerStatement: number
  sqlStatementsExecuted: number
  subBatchErrors: SubBatchError[]
  errors: string[]
}

export async function ingestCatalogChunk(
  d1: CatalogD1,
  args: {
    runId: string
    capturedAt: string
    chunkIndex: number
    totalChunks: number
    products: unknown[]
  },
): Promise<IngestChunkResult> {
  const paramsPerRow = UPSERT_OPN_COLS.length
  const rowsPerStatement = computeRowsPerStatement(paramsPerRow)
  const result: IngestChunkResult = {
    success: false,
    runId: args.runId,
    chunkIndex: args.chunkIndex,
    totalChunks: args.totalChunks,
    capturedAt: args.capturedAt,
    attempted: args.products.length,
    opnRowsUpserted: 0,
    pricedOpns: 0,
    inStockOpns: 0,
    outOfStockOpns: 0,
    paramsPerRow,
    rowsPerStatement,
    sqlStatementsExecuted: 0,
    subBatchErrors: [],
    errors: [],
  }
  if (!Array.isArray(args.products) || args.products.length === 0) {
    result.errors.push('empty_products_array')
    return result
  }
  const opnRows: ParsedOpn[] = []
  for (const p of args.products) {
    const parsed = parseProduct(p)
    if (!parsed) continue
    opnRows.push(parsed)
    if (parsed.normalizedUnitPrice != null) result.pricedOpns += 1
    if (parsed.quantity != null) {
      if (parsed.quantity > 0) result.inStockOpns += 1
      else if (parsed.quantity === 0) result.outOfStockOpns += 1
    }
  }
  const upsert = await upsertOpnRows(d1, opnRows, args.capturedAt, 'ti_store_v2_catalog_chunked', result.subBatchErrors)
  result.opnRowsUpserted = upsert.upserted
  result.sqlStatementsExecuted = upsert.sqlStatementsExecuted
  // Mirror sub-batch errors into the legacy `errors[]` (sanitized) so
  // existing GH Actions log parsing keeps working.
  for (const sb of result.subBatchErrors) {
    result.errors.push(`d1_opn[${sb.subBatchStart}-${sb.subBatchEnd}]:${sb.sanitizedError}`)
  }
  // success requires every parsed row to have landed AND zero sub-batch
  // failures. Previous criterion (errors.length === 0) silently succeeded
  // when an empty errors array hid a partial write.
  result.success = result.subBatchErrors.length === 0 && result.opnRowsUpserted === opnRows.length
  return result
}

// SQL-only GPN rebuild — does NOT pull 72k OPN rows into Worker memory.
// Computes the basic aggregates (opn_count, stocked_opn_count,
// total_quantity, min_normalized_unit_price) in a single GROUP BY.
// median / cheapest_opn / highest_inventory_opn / lifecycle_summary are
// left NULL in v1; can be filled by a follow-up secondary pass if the
// customer needs them.
export async function rebuildGpnFromOpn(
  d1: CatalogD1,
  capturedAt: string,
  errors: string[],
): Promise<number> {
  let upserted = 0
  try {
    await d1.prepare('DELETE FROM ti_catalog_latest_gpn').run()
  } catch (e: any) {
    errors.push(`gpn_delete:${(e?.message || 'failed').slice(0, 100)}`)
    return 0
  }
  try {
    const stmt = d1.prepare(
      `INSERT INTO ti_catalog_latest_gpn (
        generic_part_number, opn_count, stocked_opn_count, total_quantity,
        min_normalized_unit_price, median_normalized_unit_price,
        cheapest_opn, highest_inventory_opn, lifecycle_summary,
        latest_captured_at
      )
      SELECT
        generic_part_number,
        COUNT(*) AS opn_count,
        SUM(CASE WHEN quantity IS NOT NULL AND quantity > 0 THEN 1 ELSE 0 END) AS stocked_opn_count,
        SUM(COALESCE(quantity, 0)) AS total_quantity,
        MIN(normalized_unit_price) AS min_normalized_unit_price,
        NULL AS median_normalized_unit_price,
        NULL AS cheapest_opn,
        NULL AS highest_inventory_opn,
        NULL AS lifecycle_summary,
        ? AS latest_captured_at
      FROM ti_catalog_latest_opn
      WHERE generic_part_number IS NOT NULL AND TRIM(generic_part_number) != ''
      GROUP BY generic_part_number`,
    ).bind(capturedAt)
    await stmt.run()
    // Read back the count for the response. SQLite doesn't return rows-
    // affected on INSERT...SELECT, so do a follow-up COUNT.
    const res = await d1.prepare(
      'SELECT COUNT(*) AS n FROM ti_catalog_latest_gpn',
    ).all<{ n: number }>()
    upserted = res.results?.[0]?.n ?? 0
  } catch (e: any) {
    errors.push(`gpn_insert:${(e?.message || 'failed').slice(0, 100)}`)
  }
  return upserted
}

export type SnapshotRunSummary = {
  totalOpns: number
  totalGpns: number
  pricedOpns: number
  inStockOpns: number
  outOfStockOpns: number
  parsedOk: boolean
  errors: string[]
}

export async function readSnapshotCounts(d1: CatalogD1): Promise<{
  totalOpns: number; totalGpns: number;
  pricedOpns: number; inStockOpns: number; outOfStockOpns: number;
  latestCapturedAt: string | null;
}> {
  const out = {
    totalOpns: 0, totalGpns: 0,
    pricedOpns: 0, inStockOpns: 0, outOfStockOpns: 0,
    latestCapturedAt: null as string | null,
  }
  try {
    const r = await d1.prepare(
      `SELECT
        (SELECT COUNT(*) FROM ti_catalog_latest_opn) AS total_opns,
        (SELECT COUNT(*) FROM ti_catalog_latest_gpn) AS total_gpns,
        (SELECT COUNT(*) FROM ti_catalog_latest_opn WHERE normalized_unit_price IS NOT NULL) AS priced_opns,
        (SELECT COUNT(*) FROM ti_catalog_latest_opn WHERE quantity IS NOT NULL AND quantity > 0) AS in_stock_opns,
        (SELECT COUNT(*) FROM ti_catalog_latest_opn WHERE quantity = 0) AS out_of_stock_opns,
        (SELECT MAX(latest_captured_at) FROM ti_catalog_latest_opn) AS latest_captured_at
      `,
    ).all<any>()
    const row = r.results?.[0] ?? {}
    out.totalOpns = Number(row.total_opns) || 0
    out.totalGpns = Number(row.total_gpns) || 0
    out.pricedOpns = Number(row.priced_opns) || 0
    out.inStockOpns = Number(row.in_stock_opns) || 0
    out.outOfStockOpns = Number(row.out_of_stock_opns) || 0
    out.latestCapturedAt = typeof row.latest_captured_at === 'string' ? row.latest_captured_at : null
  } catch { /* swallow — return zeros */ }
  return out
}

export async function readLatestSnapshotRun(d1: CatalogD1): Promise<unknown | null> {
  try {
    const r = await d1.prepare(
      `SELECT id, captured_at, source, raw_r2_key, body_byte_size,
              total_opns, total_gpns, priced_opns, in_stock_opns, out_of_stock_opns,
              parsed_ok, errors_json, created_at
       FROM ti_catalog_snapshot_run ORDER BY captured_at DESC LIMIT 1`,
    ).all<any>()
    return r.results?.[0] ?? null
  } catch {
    return null
  }
}

export async function insertSnapshotRunRow(
  d1: CatalogD1,
  args: {
    capturedAt: string;
    source: string;
    rawR2Key: string | null;
    bodyByteSize: number | null;
    summary: SnapshotRunSummary;
  },
): Promise<void> {
  try {
    await d1.prepare(
      `INSERT INTO ti_catalog_snapshot_run (
        captured_at, source, raw_r2_key, body_byte_size,
        total_opns, total_gpns, priced_opns, in_stock_opns, out_of_stock_opns,
        parsed_ok, errors_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      args.capturedAt,
      args.source,
      args.rawR2Key,
      args.bodyByteSize,
      args.summary.totalOpns,
      args.summary.totalGpns,
      args.summary.pricedOpns,
      args.summary.inStockOpns,
      args.summary.outOfStockOpns,
      args.summary.parsedOk ? 1 : 0,
      args.summary.errors.length > 0 ? JSON.stringify(args.summary.errors) : null,
      isoNow(),
    ).run()
  } catch (e: any) {
    args.summary.errors.push(`snapshot_run_insert:${(e?.message || 'failed').slice(0, 100)}`)
  }
}

// ── Phase 23C — original single-shot capture (now experimental) ───────────

export async function captureTiCatalogSnapshot(
  env: TiEnv & { TI_INVENTORY_HISTORY_DB?: CatalogD1; TI_CATALOG_SNAPSHOTS_R2?: CatalogR2 },
  catalogUrlOverride?: string,
): Promise<CatalogIngestResult> {
  const result = emptyResult()
  // ── Pre-flight ─────────────────────────────────────────────────────────
  const config = checkTiConfigured(env)
  if (!config.configured) {
    result.diagnostics.sanitizedCode = 'not_configured'
    result.diagnostics.sanitizedMessage = 'TI adapter not configured.'
    result.errors.push('not_configured')
    return result
  }
  if (config.storeApiState !== 'enabled') {
    result.diagnostics.sanitizedCode = 'store_api_pending'
    result.diagnostics.sanitizedMessage = 'TI Store API approval pending; flip TI_STORE_API_ENABLED=true to proceed.'
    result.errors.push('store_api_pending')
    return result
  }
  if (!env.TI_INVENTORY_HISTORY_DB) {
    result.diagnostics.sanitizedCode = 'd1_not_bound'
    result.diagnostics.sanitizedMessage = 'TI_INVENTORY_HISTORY_DB binding missing; cannot upsert catalog tables.'
    result.errors.push('d1_not_bound')
    return result
  }
  if (!env.TI_CATALOG_SNAPSHOTS_R2) {
    result.warnings.push('R2 binding missing; raw snapshot not archived.')
  }
  const tok = await fetchTiToken(env)
  if (!tok.ok) {
    result.diagnostics.httpStatus = tok.httpStatus
    result.diagnostics.sanitizedCode = tok.sanitizedCode
    result.diagnostics.sanitizedMessage = tok.sanitizedMessage
    result.errors.push('token_failed')
    return result
  }
  // ── Fetch catalog ──────────────────────────────────────────────────────
  const url = (catalogUrlOverride && catalogUrlOverride.trim())
    || (env.TI_CATALOG_URL && env.TI_CATALOG_URL.trim())
    || DEFAULT_CATALOG_URL
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tok.token}`, Accept: 'application/json' },
    })
  } catch (e: any) {
    result.diagnostics.sanitizedCode = 'unreachable'
    result.diagnostics.sanitizedMessage = sanitizeMessage(e?.message || 'unknown error', env)
    result.errors.push('unreachable')
    return result
  }
  result.diagnostics.httpStatus = res.status
  result.diagnostics.contentType = res.headers.get('content-type')
  if (!res.ok) {
    result.diagnostics.sanitizedCode = `http_${res.status}`
    result.diagnostics.sanitizedMessage = `TI catalog returned HTTP ${res.status}.`
    result.errors.push(`http_${res.status}`)
    return result
  }
  // Read once as text. We'll R2-PUT the same string after parsing so we
  // don't keep two body copies in memory simultaneously.
  let bodyText: string
  try {
    bodyText = await res.text()
  } catch (e: any) {
    result.diagnostics.sanitizedCode = 'body_read_failed'
    result.diagnostics.sanitizedMessage = sanitizeMessage(e?.message || 'body read failed', env)
    result.errors.push('body_read_failed')
    return result
  }
  result.bodyByteSize = bodyText.length
  let data: unknown
  try {
    data = JSON.parse(bodyText)
  } catch (e: any) {
    result.diagnostics.sanitizedCode = 'invalid_json'
    result.diagnostics.sanitizedMessage = sanitizeMessage(e?.message || 'invalid JSON', env)
    result.errors.push('invalid_json')
    return result
  }
  const located = locateProducts(data)
  result.diagnostics.productsArrayPath = located.path
  if (!located.products) {
    result.diagnostics.sanitizedCode = 'products_array_missing'
    result.diagnostics.sanitizedMessage = `No products array found in catalog response (probed paths: ${PRODUCTS_PATHS.join(', ')}).`
    result.errors.push('products_array_missing')
    return result
  }
  // ── R2 PUT (best-effort, before we drop the bodyText reference) ────────
  if (env.TI_CATALOG_SNAPSHOTS_R2) {
    const r2Key = `ti-catalog/${result.capturedAt}.json`
    try {
      await env.TI_CATALOG_SNAPSHOTS_R2.put(r2Key, bodyText, {
        httpMetadata: { contentType: 'application/json' },
      })
      result.rawR2Key = r2Key
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'r2 put failed'
      result.warnings.push(`r2_put_failed:${msg.slice(0, 100)}`)
    }
  }
  // Drop the parsed-data and body-text references the moment we've
  // finished both steps that need them; the GC may then reclaim the
  // ~150 MB peak before we start D1 batching.
  // NOTE: V8 GC is non-deterministic; this is best-effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(data as any) = null
  // ── Parse products into ParsedOpn[] + GPN aggregates ───────────────────
  const opnRows: ParsedOpn[] = []
  const gpnAggregates = new Map<string, GpnAggregate>()
  let pricedOpns = 0
  let inStockOpns = 0
  let outOfStockOpns = 0
  for (const p of located.products) {
    const parsed = parseProduct(p)
    if (!parsed) continue
    opnRows.push(parsed)
    if (parsed.normalizedUnitPrice != null) pricedOpns += 1
    if (parsed.quantity != null) {
      if (parsed.quantity > 0) inStockOpns += 1
      else if (parsed.quantity === 0) outOfStockOpns += 1
    }
    if (parsed.gpn) {
      let agg = gpnAggregates.get(parsed.gpn)
      if (!agg) { agg = newGpnAggregate(parsed.gpn); gpnAggregates.set(parsed.gpn, agg) }
      agg.opnCount += 1
      if ((parsed.quantity ?? 0) > 0) agg.stockedOpnCount += 1
      if (parsed.quantity != null && Number.isFinite(parsed.quantity)) {
        agg.totalQuantity += parsed.quantity
        if (agg.highestInventory == null || parsed.quantity > agg.highestInventory) {
          agg.highestInventory = parsed.quantity
          agg.highestInventoryOpn = parsed.opn
        }
      }
      if (parsed.normalizedUnitPrice != null) {
        agg.prices.push(parsed.normalizedUnitPrice)
        if (agg.cheapestPrice == null || parsed.normalizedUnitPrice < agg.cheapestPrice) {
          agg.cheapestPrice = parsed.normalizedUnitPrice
          agg.cheapestOpn = parsed.opn
        }
      }
      if (parsed.lifecycle) {
        agg.lifecycleSummary.set(parsed.lifecycle, (agg.lifecycleSummary.get(parsed.lifecycle) ?? 0) + 1)
      }
    }
  }
  result.totalOpns = opnRows.length
  result.totalGpns = gpnAggregates.size
  result.pricedOpns = pricedOpns
  result.inStockOpns = inStockOpns
  result.outOfStockOpns = outOfStockOpns
  result.parsedOk = true
  // ── D1 upserts ────────────────────────────────────────────────────────
  // Phase 23C.3 — helper signatures now return structured diagnostics +
  // a SubBatchError list. Bridge them back into the legacy errors[]
  // string array so the existing /capture endpoint shape is preserved.
  const opnSubBatchErrors: SubBatchError[] = []
  const opnUpsert = await upsertOpnRows(env.TI_INVENTORY_HISTORY_DB!, opnRows, result.capturedAt, result.source, opnSubBatchErrors)
  result.d1RowsUpserted = opnUpsert.upserted
  for (const sb of opnSubBatchErrors) {
    result.errors.push(`d1_opn[${sb.subBatchStart}-${sb.subBatchEnd}]:${sb.sanitizedError}`)
  }
  const gpnSubBatchErrors: SubBatchError[] = []
  const gpnUpsert = await upsertGpnRows(env.TI_INVENTORY_HISTORY_DB!, Array.from(gpnAggregates.values()), result.capturedAt, gpnSubBatchErrors)
  result.gpnRowsUpserted = gpnUpsert.upserted
  for (const sb of gpnSubBatchErrors) {
    result.errors.push(`d1_gpn[${sb.subBatchStart}-${sb.subBatchEnd}]:${sb.sanitizedError}`)
  }
  // ── Snapshot-run summary row ───────────────────────────────────────────
  await insertSnapshotRunSummary(env.TI_INVENTORY_HISTORY_DB!, result)
  result.success = result.errors.length === 0
  return result
}
