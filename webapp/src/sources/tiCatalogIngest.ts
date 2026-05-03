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

// ── Phase 24A.1 — GPN enrichment rebuild ─────────────────────────────────────
// Backfills the four GPN aggregate fields the v1 finalize path explicitly
// left NULL (median_normalized_unit_price, cheapest_opn,
// highest_inventory_opn, lifecycle_summary). Uses pure SQL — no TI calls,
// no Worker memory pressure. Each field is one UPDATE-FROM-CTE statement,
// so the whole rebuild is 4 D1 subrequests for the entire table.
//
// Tie-breakers (per Phase 24A.1 spec):
//   cheapest_opn         : lowest normalized_unit_price; ties broken by HIGHEST quantity.
//   highest_inventory_opn: highest quantity; ties broken by LOWEST normalized_unit_price.
//   lifecycle_summary    : compact JSON object {lifecycle: count}; only non-null lifecycles count.
//   median_normalized_unit_price : true median of non-null prices via the
//                                  classic window-function trick (average
//                                  of the middle 1 row when N is odd, the
//                                  middle 2 rows when N is even).

export type GpnEnrichmentResult = {
  totalGpns: number
  enrichedGpns: number
  rowsUpdated: number
  changesByField: {
    median: number
    cheapest: number
    highestInventory: number
    lifecycleSummary: number
  }
  nullMedianCount: number
  nullCheapestCount: number
  nullHighestInventoryCount: number
  nullLifecycleSummaryCount: number
  sampleRows: Array<{
    genericPartNumber: string
    medianNormalizedUnitPrice: number | null
    cheapestOpn: string | null
    highestInventoryOpn: string | null
    lifecycleSummary: unknown
  }>
  errors: string[]
}

function metaChanges(res: unknown): number {
  const r = res as { meta?: { changes?: number }; changes?: number } | null
  if (!r) return 0
  if (typeof r.meta?.changes === 'number') return r.meta.changes
  if (typeof r.changes === 'number') return r.changes
  return 0
}

export async function rebuildGpnEnrichment(d1: CatalogD1): Promise<GpnEnrichmentResult> {
  const errors: string[] = []
  const changes = { median: 0, cheapest: 0, highestInventory: 0, lifecycleSummary: 0 }

  // 1. cheapest_opn — lowest price, tie -> highest quantity.
  try {
    const res = await d1.prepare(
      `WITH cheapest AS (
         SELECT generic_part_number, ti_part_number AS opn
         FROM (
           SELECT generic_part_number, ti_part_number,
                  ROW_NUMBER() OVER (
                    PARTITION BY generic_part_number
                    ORDER BY normalized_unit_price ASC,
                             COALESCE(quantity, -1) DESC,
                             ti_part_number ASC
                  ) AS rn
           FROM ti_catalog_latest_opn
           WHERE normalized_unit_price IS NOT NULL
             AND generic_part_number IS NOT NULL
         )
         WHERE rn = 1
       )
       UPDATE ti_catalog_latest_gpn
       SET cheapest_opn = cheapest.opn
       FROM cheapest
       WHERE ti_catalog_latest_gpn.generic_part_number = cheapest.generic_part_number`,
    ).run()
    changes.cheapest = metaChanges(res)
  } catch (e: any) {
    errors.push(`gpn_enrich_cheapest:${(e?.message || 'failed').slice(0, 120)}`)
  }

  // 2. highest_inventory_opn — highest quantity, tie -> lowest price.
  try {
    const res = await d1.prepare(
      `WITH highest AS (
         SELECT generic_part_number, ti_part_number AS opn
         FROM (
           SELECT generic_part_number, ti_part_number,
                  ROW_NUMBER() OVER (
                    PARTITION BY generic_part_number
                    ORDER BY quantity DESC,
                             COALESCE(normalized_unit_price, 1e18) ASC,
                             ti_part_number ASC
                  ) AS rn
           FROM ti_catalog_latest_opn
           WHERE quantity IS NOT NULL
             AND generic_part_number IS NOT NULL
         )
         WHERE rn = 1
       )
       UPDATE ti_catalog_latest_gpn
       SET highest_inventory_opn = highest.opn
       FROM highest
       WHERE ti_catalog_latest_gpn.generic_part_number = highest.generic_part_number`,
    ).run()
    changes.highestInventory = metaChanges(res)
  } catch (e: any) {
    errors.push(`gpn_enrich_highest:${(e?.message || 'failed').slice(0, 120)}`)
  }

  // 3. lifecycle_summary — JSON object {lifecycle: count}. Cloudflare D1
  //    bundles the SQLite json1 extension so json_group_object works.
  try {
    const res = await d1.prepare(
      `WITH lifecycle_counts AS (
         SELECT generic_part_number,
                json_group_object(lifecycle, cnt) AS summary_json
         FROM (
           SELECT generic_part_number, lifecycle, COUNT(*) AS cnt
           FROM ti_catalog_latest_opn
           WHERE lifecycle IS NOT NULL
             AND TRIM(lifecycle) != ''
             AND generic_part_number IS NOT NULL
           GROUP BY generic_part_number, lifecycle
         )
         GROUP BY generic_part_number
       )
       UPDATE ti_catalog_latest_gpn
       SET lifecycle_summary = lifecycle_counts.summary_json
       FROM lifecycle_counts
       WHERE ti_catalog_latest_gpn.generic_part_number = lifecycle_counts.generic_part_number`,
    ).run()
    changes.lifecycleSummary = metaChanges(res)
  } catch (e: any) {
    errors.push(`gpn_enrich_lifecycle:${(e?.message || 'failed').slice(0, 120)}`)
  }

  // 4. median_normalized_unit_price — true median via window function.
  //    For odd N pick the middle row; for even N average the two middle
  //    rows. AVG of one row equals the row itself, so the same expression
  //    handles both cases.
  try {
    const res = await d1.prepare(
      `WITH ranked AS (
         SELECT generic_part_number, normalized_unit_price,
                ROW_NUMBER() OVER (
                  PARTITION BY generic_part_number
                  ORDER BY normalized_unit_price
                ) AS rn,
                COUNT(*) OVER (PARTITION BY generic_part_number) AS cnt
         FROM ti_catalog_latest_opn
         WHERE normalized_unit_price IS NOT NULL
           AND generic_part_number IS NOT NULL
       ),
       medians AS (
         SELECT generic_part_number,
                AVG(normalized_unit_price) AS median_norm
         FROM ranked
         WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
         GROUP BY generic_part_number
       )
       UPDATE ti_catalog_latest_gpn
       SET median_normalized_unit_price = medians.median_norm
       FROM medians
       WHERE ti_catalog_latest_gpn.generic_part_number = medians.generic_part_number`,
    ).run()
    changes.median = metaChanges(res)
  } catch (e: any) {
    errors.push(`gpn_enrich_median:${(e?.message || 'failed').slice(0, 120)}`)
  }

  // ── Diagnostics: counts + a small sample. One small SELECT each.
  let totalGpns = 0
  let nullMedianCount = 0
  let nullCheapestCount = 0
  let nullHighestInventoryCount = 0
  let nullLifecycleSummaryCount = 0
  let enrichedGpns = 0
  type SampleRow = {
    generic_part_number: string
    median_normalized_unit_price: number | null
    cheapest_opn: string | null
    highest_inventory_opn: string | null
    lifecycle_summary: string | null
  }
  let sampleRowsRaw: SampleRow[] = []
  try {
    const counts = await d1.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN median_normalized_unit_price IS NULL THEN 1 ELSE 0 END) AS null_median,
         SUM(CASE WHEN cheapest_opn IS NULL THEN 1 ELSE 0 END) AS null_cheapest,
         SUM(CASE WHEN highest_inventory_opn IS NULL THEN 1 ELSE 0 END) AS null_highest,
         SUM(CASE WHEN lifecycle_summary IS NULL THEN 1 ELSE 0 END) AS null_lifecycle,
         SUM(CASE WHEN median_normalized_unit_price IS NOT NULL
                   AND cheapest_opn IS NOT NULL
                   AND highest_inventory_opn IS NOT NULL
                   AND lifecycle_summary IS NOT NULL
                  THEN 1 ELSE 0 END) AS enriched
       FROM ti_catalog_latest_gpn`,
    ).first<{
      total: number; null_median: number; null_cheapest: number;
      null_highest: number; null_lifecycle: number; enriched: number;
    }>()
    if (counts) {
      totalGpns = Number(counts.total) || 0
      nullMedianCount = Number(counts.null_median) || 0
      nullCheapestCount = Number(counts.null_cheapest) || 0
      nullHighestInventoryCount = Number(counts.null_highest) || 0
      nullLifecycleSummaryCount = Number(counts.null_lifecycle) || 0
      enrichedGpns = Number(counts.enriched) || 0
    }
    const sample = await d1.prepare(
      `SELECT generic_part_number,
              median_normalized_unit_price,
              cheapest_opn, highest_inventory_opn, lifecycle_summary
         FROM ti_catalog_latest_gpn
         WHERE median_normalized_unit_price IS NOT NULL
           AND cheapest_opn IS NOT NULL
           AND highest_inventory_opn IS NOT NULL
           AND lifecycle_summary IS NOT NULL
         ORDER BY total_quantity DESC NULLS LAST
         LIMIT 5`,
    ).all<SampleRow>()
    sampleRowsRaw = sample.results ?? []
  } catch (e: any) {
    errors.push(`gpn_enrich_diag:${(e?.message || 'failed').slice(0, 120)}`)
  }

  const sampleRows = sampleRowsRaw.map(r => {
    let lifecycleParsed: unknown = r.lifecycle_summary
    if (typeof r.lifecycle_summary === 'string') {
      try { lifecycleParsed = JSON.parse(r.lifecycle_summary) } catch { /* leave as string */ }
    }
    return {
      genericPartNumber: r.generic_part_number,
      medianNormalizedUnitPrice: r.median_normalized_unit_price,
      cheapestOpn: r.cheapest_opn,
      highestInventoryOpn: r.highest_inventory_opn,
      lifecycleSummary: lifecycleParsed,
    }
  })

  const rowsUpdated = changes.median + changes.cheapest + changes.highestInventory + changes.lifecycleSummary

  return {
    totalGpns,
    enrichedGpns,
    rowsUpdated,
    changesByField: changes,
    nullMedianCount,
    nullCheapestCount,
    nullHighestInventoryCount,
    nullLifecycleSummaryCount,
    sampleRows,
    errors,
  }
}

// ── Phase 24C / 24C.1 — TI catalog rollup rebuild ──────────────────────────
// Phase 24C used a single mega-statement that ran the full mapping CASE
// + GROUP BY + json_group_object subqueries against all 72k OPNs in one
// pass; D1 hit its per-statement CPU budget and aborted with rollupRows=0.
//
// Phase 24C.1 replaces that with a per-subcategory rebuild: for each of
// the (≤28) canonical subcategories, a small SQL pass scoped via the
// subcategory's own rule predicate computes its aggregates and upserts
// one row. Each pass touches at most a few thousand rows and runs in
// well under D1's per-statement budget. The endpoint exposes mode=reset/
// step/run so the operator can drive the rebuild from Terminal without
// blowing past D1 limits — never via the D1 Console directly.
//
// Helpers exposed by this file:
//   clearLatestRollups(d1)               — DELETE FROM ti_catalog_rollup_latest
//   listSubcategoryPredicates()           — { canonical, where, ownRules }[]
//   pendingSubcategories(d1)              — predicates without a row in latest
//   rebuildOneSubcategory(d1, predicate)  — small per-subcategory rebuild
//   readRollupStatus(d1)                  — completion + coverage diagnostics

import {
  CANONICAL_MAPPING_RULES,
  buildSubcategoryPredicates,
  type SubcategoryPredicate,
  type MappingConfidence,
} from './tiCatalogMapping'

export type RebuildOneSubcategoryResult = {
  canonicalGroup: string
  canonicalSubcategory: string
  ruleIds: string[]
  /** True when the subcategory had at least one matching OPN and the
   *  upsert wrote a row to ti_catalog_rollup_latest. */
  upserted: boolean
  /** Diagnostic — number of OPN rows that matched this subcategory's
   *  predicate (predict from the WHERE clause, computed via COUNT). */
  matchedOpns: number
  /** Number of distinct generic_part_number values inside the matched
   *  set; mirrors gpn_count in the upserted row. */
  matchedGpns: number
  errors: string[]
}

export type RollupStatusResult = {
  totalCanonicalSubcategories: number
  completedSubcategories: number
  pendingSubcategories: string[]
  latestRows: number
  lastUpdatedAt: string | null
  /** Best-effort latest error string parked from a recent rebuild step
   *  (we don't keep a separate errors table — this is just the latest
   *  error encountered while rebuilding, captured by the endpoint and
   *  surfaced for the operator). */
  lastError: string | null
  mappedOpns: number | null
  unmappedOpns: number | null
  mappingCoveragePct: number | null
}

/** Build the per-subcategory predicate list once at module load. The
 *  shape is purely derived from the rule list and never changes at
 *  runtime, so cache it. */
let _subcategoryPredicates: SubcategoryPredicate[] | null = null
export function listSubcategoryPredicates(): SubcategoryPredicate[] {
  if (!_subcategoryPredicates) _subcategoryPredicates = buildSubcategoryPredicates()
  return _subcategoryPredicates
}

/** Tiny single-statement clear. Used by mode=reset. Never touches
 *  ti_catalog_latest_opn / ti_catalog_latest_gpn. */
export async function clearLatestRollups(d1: CatalogD1): Promise<void> {
  await d1.prepare('DELETE FROM ti_catalog_rollup_latest').run()
}

/** Pending = canonical subcategories with no row in ti_catalog_rollup_latest.
 *  Cheap — single SELECT + a small JS diff. */
export async function pendingSubcategoryPredicates(d1: CatalogD1): Promise<SubcategoryPredicate[]> {
  const all = listSubcategoryPredicates()
  let completed = new Set<string>()
  try {
    const res = await d1
      .prepare('SELECT canonical_subcategory FROM ti_catalog_rollup_latest')
      .all<{ canonical_subcategory: string }>()
    completed = new Set((res.results ?? []).map(r => r.canonical_subcategory))
  } catch {
    // Table missing or unreadable — treat as nothing completed.
  }
  return all.filter(p => !completed.has(p.canonicalSubcategory))
}

/** Rebuild ONE canonical subcategory.
 *
 *  Pipeline (4 small SQL statements, each scoped via this subcategory's
 *  WHERE clause so the row counts are bounded by the subcategory's size,
 *  not the full 72k OPNs):
 *
 *    1. Pre-flight COUNT — establish how many OPNs match. If 0, skip
 *       the upsert; return upserted=false. The /step endpoint still
 *       counts this subcategory as "completed" so it doesn't loop back
 *       on it forever.
 *    2. INSERT OR REPLACE — main aggregates + lifecycle_summary +
 *       mapping_confidence_summary. The confidence summary uses ordered
 *       per-rule CASE so the first own-rule that matches a row gets the
 *       count (mirrors the JS first-match-wins matcher).
 *    3. UPDATE cheapest_opn via correlated SELECT … LIMIT 1.
 *    4. UPDATE highest_inventory_opn similarly.
 *    5. UPDATE median_normalized_unit_price via window-function median.
 *
 *  Errors from any step roll into the returned errors[] but do not
 *  abort later steps — partial enrichment is better than no row. */
export async function rebuildOneSubcategory(
  d1: CatalogD1,
  predicate: SubcategoryPredicate,
): Promise<RebuildOneSubcategoryResult> {
  const errors: string[] = []
  const where = predicate.whereClause
  // Step 1 — pre-flight COUNT. Cheap; lets us skip empty subcategories.
  let matchedOpns = 0
  let matchedGpns = 0
  try {
    const c = await d1.prepare(
      `SELECT COUNT(*) AS n_opns,
              COUNT(DISTINCT generic_part_number) AS n_gpns
         FROM ti_catalog_latest_opn
         WHERE ${where}`,
    ).first<{ n_opns: number; n_gpns: number }>()
    matchedOpns = Number(c?.n_opns ?? 0) || 0
    matchedGpns = Number(c?.n_gpns ?? 0) || 0
  } catch (e: any) {
    errors.push(`rollup_count[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 140)}`)
  }
  if (matchedOpns === 0) {
    // Phase 24C.1 — empty subcategories still get a zero-count row so
    // the resumable loop knows to skip them. Without this, the
    // pendingSubcategoryPredicates() check would keep returning them
    // and the loop would never terminate. The zero-count row is
    // self-explanatory in the dashboard tooltip ("0 OPNs in this
    // canonical subcategory").
    const emptyAt = new Date().toISOString()
    try {
      await d1.prepare(
        `INSERT OR REPLACE INTO ti_catalog_rollup_latest (
           canonical_subcategory, canonical_group,
           opn_count, gpn_count, priced_opn_count,
           stocked_opn_count, out_of_stock_opn_count, stocked_pct,
           total_quantity,
           median_normalized_unit_price, min_normalized_unit_price, max_normalized_unit_price,
           cheapest_opn, highest_inventory_opn,
           lifecycle_summary, mapping_confidence_summary,
           latest_captured_at)
         VALUES (?, ?, 0, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      ).bind(predicate.canonicalSubcategory, predicate.canonicalGroup, emptyAt).run()
      return {
        canonicalGroup: predicate.canonicalGroup,
        canonicalSubcategory: predicate.canonicalSubcategory,
        ruleIds: predicate.ruleIds,
        upserted: true,
        matchedOpns: 0,
        matchedGpns: 0,
        errors,
      }
    } catch (e: any) {
      errors.push(`rollup_empty_upsert[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 140)}`)
      return {
        canonicalGroup: predicate.canonicalGroup,
        canonicalSubcategory: predicate.canonicalSubcategory,
        ruleIds: predicate.ruleIds,
        upserted: false,
        matchedOpns: 0,
        matchedGpns: 0,
        errors,
      }
    }
  }

  // Build the confidence-summary CASE: the first own-rule whose SQL
  // matches a row determines that row's confidence label. We render an
  // ordered nested CASE so SQLite picks the first match.
  const ownRulesOrdered = predicate.ownRules
  const confidenceCase = (() => {
    if (ownRulesOrdered.length === 0) return `'unknown'`
    const whens = ownRulesOrdered.map(r => `WHEN (${r.sql}) THEN '${r.confidence}'`).join('\n             ')
    return `CASE\n             ${whens}\n             ELSE 'unknown'\n           END`
  })()

  // Step 2 — main aggregates upsert. INSERT OR REPLACE so re-running a
  // step over a previously-completed subcategory just reasserts the
  // same row.
  try {
    await d1.prepare(
      `INSERT OR REPLACE INTO ti_catalog_rollup_latest (
         canonical_subcategory, canonical_group,
         opn_count, gpn_count, priced_opn_count,
         stocked_opn_count, out_of_stock_opn_count, stocked_pct,
         total_quantity,
         median_normalized_unit_price, min_normalized_unit_price, max_normalized_unit_price,
         cheapest_opn, highest_inventory_opn,
         lifecycle_summary, mapping_confidence_summary,
         latest_captured_at)
       SELECT
         ?, ?,
         COUNT(*),
         COUNT(DISTINCT generic_part_number),
         SUM(CASE WHEN normalized_unit_price IS NOT NULL THEN 1 ELSE 0 END),
         SUM(CASE WHEN quantity IS NOT NULL AND quantity > 0 THEN 1 ELSE 0 END),
         SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END),
         ROUND(SUM(CASE WHEN quantity IS NOT NULL AND quantity > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2),
         SUM(COALESCE(quantity, 0)),
         NULL,
         MIN(normalized_unit_price),
         MAX(normalized_unit_price),
         NULL,
         NULL,
         (SELECT json_group_object(lifecycle, cnt) FROM (
            SELECT lifecycle, COUNT(*) AS cnt
              FROM ti_catalog_latest_opn lc_inner
             WHERE lc_inner.lifecycle IS NOT NULL
               AND TRIM(lc_inner.lifecycle) != ''
               AND ${replaceColRefs(where, 'lc_inner')}
             GROUP BY lifecycle)) AS lifecycle_summary,
         (SELECT json_group_object(confidence, cnt) FROM (
            SELECT (${replaceColRefs(confidenceCase, 'cf_inner')}) AS confidence, COUNT(*) AS cnt
              FROM ti_catalog_latest_opn cf_inner
             WHERE ${replaceColRefs(where, 'cf_inner')}
             GROUP BY confidence)) AS mapping_confidence_summary,
         MAX(latest_captured_at)
       FROM ti_catalog_latest_opn
       WHERE ${where}`,
    ).bind(predicate.canonicalSubcategory, predicate.canonicalGroup).run()
  } catch (e: any) {
    errors.push(`rollup_upsert[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 200)}`)
    return {
      canonicalGroup: predicate.canonicalGroup,
      canonicalSubcategory: predicate.canonicalSubcategory,
      ruleIds: predicate.ruleIds,
      upserted: false,
      matchedOpns,
      matchedGpns,
      errors,
    }
  }

  // Step 3 — cheapest_opn (lowest price; tie → highest qty → smallest id).
  try {
    await d1.prepare(
      `UPDATE ti_catalog_rollup_latest
          SET cheapest_opn = (
            SELECT ti_part_number FROM ti_catalog_latest_opn cheapest_inner
             WHERE normalized_unit_price IS NOT NULL
               AND ${replaceColRefs(where, 'cheapest_inner')}
             ORDER BY normalized_unit_price ASC,
                      COALESCE(quantity, -1) DESC,
                      ti_part_number ASC
             LIMIT 1)
        WHERE canonical_subcategory = ?`,
    ).bind(predicate.canonicalSubcategory).run()
  } catch (e: any) {
    errors.push(`rollup_cheapest[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 140)}`)
  }

  // Step 4 — highest_inventory_opn.
  try {
    await d1.prepare(
      `UPDATE ti_catalog_rollup_latest
          SET highest_inventory_opn = (
            SELECT ti_part_number FROM ti_catalog_latest_opn highest_inner
             WHERE quantity IS NOT NULL
               AND ${replaceColRefs(where, 'highest_inner')}
             ORDER BY quantity DESC,
                      COALESCE(normalized_unit_price, 1e18) ASC,
                      ti_part_number ASC
             LIMIT 1)
        WHERE canonical_subcategory = ?`,
    ).bind(predicate.canonicalSubcategory).run()
  } catch (e: any) {
    errors.push(`rollup_highest[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 140)}`)
  }

  // Step 5 — true median via window-function trick, scoped to this
  // subcategory's matched rows.
  try {
    await d1.prepare(
      `UPDATE ti_catalog_rollup_latest
          SET median_normalized_unit_price = (
            WITH ranked AS (
              SELECT normalized_unit_price,
                     ROW_NUMBER() OVER (ORDER BY normalized_unit_price) AS rn,
                     COUNT(*)    OVER ()                                 AS cnt
                FROM ti_catalog_latest_opn median_inner
               WHERE normalized_unit_price IS NOT NULL
                 AND ${replaceColRefs(where, 'median_inner')}
            )
            SELECT AVG(normalized_unit_price)
              FROM ranked
             WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2))
        WHERE canonical_subcategory = ?`,
    ).bind(predicate.canonicalSubcategory).run()
  } catch (e: any) {
    errors.push(`rollup_median[${predicate.canonicalSubcategory}]:${(e?.message || 'failed').slice(0, 140)}`)
  }

  return {
    canonicalGroup: predicate.canonicalGroup,
    canonicalSubcategory: predicate.canonicalSubcategory,
    ruleIds: predicate.ruleIds,
    upserted: true,
    matchedOpns,
    matchedGpns,
    errors,
  }
}

/** Subqueries inside the main INSERT/UPDATE statements need to reference
 *  the inner table alias rather than the outer ti_catalog_latest_opn so
 *  ordering/ordinal references stay correct under SQLite. The mapping
 *  rule SQL is written in terms of the bare column names — this helper
 *  rewrites those occurrences to the inner alias. */
function replaceColRefs(sql: string, innerAlias: string): string {
  return sql.replace(/\b(generic_part_number|ti_part_number|description|lifecycle|quantity|normalized_unit_price|latest_captured_at)\b/g, m => {
    // Only rewrite identifiers that aren't already qualified.
    return `${innerAlias}.${m}`
  })
}

/** Read endpoint diagnostics: how many subcategories are completed,
 *  which are still pending, and (cheap) mapped/unmapped OPN counts.
 *
 *  Mapped/unmapped count is computed only when the rebuild is fully
 *  complete (no pending subcategories) — running it during a partial
 *  rebuild would double-count rows that fall under multiple rules.
 *  When the rebuild is partial we return null for the coverage fields
 *  and let the operator finish the rebuild first. */
export async function readRollupStatus(d1: CatalogD1): Promise<RollupStatusResult> {
  const all = listSubcategoryPredicates()
  let pendingSubcategories: string[] = []
  let latestRows = 0
  let lastUpdatedAt: string | null = null
  try {
    const res = await d1
      .prepare(
        `SELECT canonical_subcategory, latest_captured_at
           FROM ti_catalog_rollup_latest`,
      )
      .all<{ canonical_subcategory: string; latest_captured_at: string }>()
    const rows = res.results ?? []
    latestRows = rows.length
    const completedSet = new Set(rows.map(r => r.canonical_subcategory))
    pendingSubcategories = all.filter(p => !completedSet.has(p.canonicalSubcategory)).map(p => p.canonicalSubcategory)
    if (rows.length > 0) {
      // pick the max latest_captured_at as a proxy for "last updated".
      lastUpdatedAt = rows.reduce<string | null>((acc, r) => {
        if (!acc) return r.latest_captured_at
        return r.latest_captured_at > acc ? r.latest_captured_at : acc
      }, null)
    }
  } catch {
    // Table missing — treat all as pending.
    pendingSubcategories = all.map(p => p.canonicalSubcategory)
  }

  // Coverage scan only when fully complete.
  let mappedOpns: number | null = null
  let unmappedOpns: number | null = null
  let mappingCoveragePct: number | null = null
  if (pendingSubcategories.length === 0 && latestRows > 0) {
    try {
      const total = await d1.prepare('SELECT COUNT(*) AS n FROM ti_catalog_latest_opn').first<{ n: number }>()
      const totalOpns = Number(total?.n ?? 0) || 0
      const sumOpn = await d1.prepare('SELECT COALESCE(SUM(opn_count), 0) AS n FROM ti_catalog_rollup_latest').first<{ n: number }>()
      mappedOpns = Number(sumOpn?.n ?? 0) || 0
      unmappedOpns = Math.max(0, totalOpns - mappedOpns)
      mappingCoveragePct = totalOpns > 0 ? Math.round((mappedOpns / totalOpns) * 10000) / 100 : 0
    } catch {
      // leave nulls
    }
  }

  return {
    totalCanonicalSubcategories: all.length,
    completedSubcategories: latestRows,
    pendingSubcategories,
    latestRows,
    lastUpdatedAt,
    lastError: null,
    mappedOpns,
    unmappedOpns,
    mappingCoveragePct,
  }
}

/** Small fast helper for /finalize so it can append a snapshot row to
 *  ti_catalog_rollup_history without re-running any heavy computation.
 *  Always called after rebuildOneSubcategory(...) has populated the
 *  per-subcategory rollup_latest rows. */
export async function appendRollupHistory(
  d1: CatalogD1,
  opts: { snapshotRunId?: number | null },
): Promise<{ appendedRows: number; errors: string[] }> {
  const errors: string[] = []
  let appendedRows = 0
  try {
    const res: any = await d1.prepare(
      `INSERT INTO ti_catalog_rollup_history (
         captured_at, snapshot_run_id,
         canonical_subcategory, canonical_group,
         opn_count, gpn_count, priced_opn_count,
         stocked_opn_count, out_of_stock_opn_count, stocked_pct,
         total_quantity, median_normalized_unit_price,
         min_normalized_unit_price, max_normalized_unit_price,
         cheapest_opn, highest_inventory_opn,
         lifecycle_summary, mapping_confidence_summary)
       SELECT latest_captured_at, ?,
              canonical_subcategory, canonical_group,
              opn_count, gpn_count, priced_opn_count,
              stocked_opn_count, out_of_stock_opn_count, stocked_pct,
              total_quantity, median_normalized_unit_price,
              min_normalized_unit_price, max_normalized_unit_price,
              cheapest_opn, highest_inventory_opn,
              lifecycle_summary, mapping_confidence_summary
         FROM ti_catalog_rollup_latest`,
    ).bind(opts.snapshotRunId ?? null).run()
    const c = res?.meta?.changes ?? res?.changes
    if (typeof c === 'number') appendedRows = c
  } catch (e: any) {
    errors.push(`rollup_history_append:${(e?.message || 'failed').slice(0, 150)}`)
  }
  return { appendedRows, errors }
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
