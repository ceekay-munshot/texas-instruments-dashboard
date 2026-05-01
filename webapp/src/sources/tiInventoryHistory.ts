// ── Phase 21A/21G — TI inventory & price history + signal engine ───────────
// Persists per-capture snapshots so the Inventory tab can compute trend and
// shortage/oversupply signals over time. Two backends are supported:
//
//   1. Cloudflare D1 (preferred). Bind TI_INVENTORY_HISTORY_DB in
//      wrangler.jsonc and apply migrations/0001_inventory_history.sql.
//   2. Cloudflare KV fallback (so the dashboard works the moment Phase 21
//      ships, even before D1 is provisioned). History rows are bucketed by
//      capture date under a known prefix. KV's eventual consistency is fine
//      here because we only need approximate daily granularity; the customer
//      view continues to come from the existing latest-snapshot KV key.
//
// Hard rules:
//   - DO NOT persist OAuth tokens, client id/secret, or capture secrets.
//   - DO NOT persist raw TI response bodies — only the sanitized public-row
//     shape produced by toPublicPartSignal().
//   - Failed captures still get a row so the signal engine can detect gaps,
//     but the signal classification skips them and never treats them as
//     out_of_stock.

import type { TiPartSignalPublic, WatchedPartCaptureStatus } from './tiPartSignal'

// ── Bindings ────────────────────────────────────────────────────────────────

/** Minimal D1 surface we actually call. Matches the Cloudflare Workers D1
 *  binding shape. Defined inline so this module doesn't depend on the
 *  workers-types build chain when run from Node. */
export type D1Database = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: unknown }>
      first<T = unknown>(): Promise<T | null>
      all<T = unknown>(): Promise<{ results?: T[] }>
    }
    run?(): Promise<{ success?: boolean }>
  }
  exec?(query: string): Promise<unknown>
  batch?(stmts: unknown[]): Promise<unknown[]>
}

/** Minimal KV surface (subset of Cloudflare KVNamespace). */
export type HistoryKV = {
  get(key: string, type?: 'json' | 'text'): Promise<string | null | unknown>
  put(key: string, value: string): Promise<void>
  list(opts: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>
    list_complete?: boolean
    cursor?: string
  }>
}

const KV_HISTORY_PREFIX = 'source-snapshots/texas_instruments/ti_direct_inventory/history/'

function kvHistoryKey(date: string): string {
  return `${KV_HISTORY_PREFIX}${date}`
}

function isoDay(iso: string | null | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10)
  return iso.slice(0, 10)
}

// ── History row shape ───────────────────────────────────────────────────────
// Compact subset of TiPartSignalPublic that captures everything the signal
// engine needs. Stored as JSON in the KV fallback; mapped to columns in D1.

export type HistoryRow = {
  capturedAt: string
  orderablePartNumber: string
  genericPartNumber: string | null
  basket: string | null
  category: string | null
  subcategory: string | null
  /** Phase 21A — investor-facing context propagated from watched-parts catalog. */
  displayName: string | null
  demandProxyType: string | null
  dashboardPriority: 'high' | 'medium' | 'low' | null
  quantityAvailable: number | null
  pricingAvailability: 'available' | 'unavailable' | 'pending_approval' | 'unknown'
  priceAvailable: boolean
  currency: string | null
  normalizedUnitPrice: number | null
  normalizedPriceQty: number | null
  orderLimit: number | null
  leadTimeWeeks: number | null
  lifecycleStatus: string | null
  okayToOrder: boolean | null
  /** Phase 21A — derived signal flags persisted alongside the raw row so a
   *  per-part history read can show how the supply / inventory / pricing /
   *  lead-time / source-confidence flags moved over time. */
  supplyStatus: string | null
  inventorySignal: string | null
  pricingSignal: string | null
  leadTimeSignal: string | null
  sourceConfidence: string | null
  captureStatus: WatchedPartCaptureStatus
  sourceInventory: string
  sourcePricing: 'direct_ti_store_price' | 'unavailable'
  warnings: string[]
}

export function toHistoryRow(p: TiPartSignalPublic, capturedAt: string): HistoryRow {
  // Phase 21F pricing hierarchy: Store I&P returns price breaks in
  // `pricing` on the merged signal, but the sanitized public shape only
  // carries `pricingAvailability`. When direct breaks are present a future
  // phase will fill normalizedUnitPrice / normalizedPriceQty here; for now
  // we never invent a number — pricingAvailability=unavailable means the
  // signal engine treats price as missing, not zero.
  const priceAvailable = p.pricingAvailability === 'available'
  return {
    capturedAt,
    orderablePartNumber: p.partNumber,
    genericPartNumber: p.genericPartNumber ?? null,
    basket: p.basket ?? null,
    category: null,
    subcategory: null,
    displayName: p.displayName ?? null,
    demandProxyType: p.demandProxyType ?? null,
    dashboardPriority: p.dashboardPriority ?? null,
    quantityAvailable: p.quantityAvailable ?? null,
    pricingAvailability: p.pricingAvailability,
    priceAvailable,
    currency: priceAvailable ? 'USD' : null,
    normalizedUnitPrice: null,
    normalizedPriceQty: null,
    orderLimit: p.orderLimit ?? null,
    leadTimeWeeks: p.leadTimeWeeks ?? null,
    lifecycleStatus: p.lifecycleStatus ?? null,
    okayToOrder: p.okayToOrder ?? null,
    supplyStatus: p.signals?.supplyStatus ?? null,
    inventorySignal: p.signals?.inventorySignal ?? null,
    pricingSignal: p.signals?.pricingSignal ?? null,
    leadTimeSignal: p.signals?.leadTimeSignal ?? null,
    sourceConfidence: p.signals?.sourceConfidence ?? null,
    captureStatus: p.latestCaptureStatus ?? p.captureStatus,
    sourceInventory: 'Texas Instruments Store Inventory & Pricing API',
    sourcePricing: priceAvailable ? 'direct_ti_store_price' : 'unavailable',
    warnings: p.captureWarnings ?? [],
  }
}

// ── Append ─────────────────────────────────────────────────────────────────

export type AppendBackend = 'd1' | 'kv' | 'none'

export type AppendResult = {
  backend: AppendBackend
  rowsAppended: number
  errors: string[]
}

export async function appendInventoryHistory(
  rows: HistoryRow[],
  opts: { d1?: D1Database | null; kv?: HistoryKV | null },
): Promise<AppendResult> {
  if (rows.length === 0) {
    return { backend: 'none', rowsAppended: 0, errors: [] }
  }
  if (opts.d1) {
    return appendInventoryHistoryD1(opts.d1, rows)
  }
  if (opts.kv) {
    return appendInventoryHistoryKV(opts.kv, rows)
  }
  return { backend: 'none', rowsAppended: 0, errors: ['no_history_backend_bound'] }
}

async function appendInventoryHistoryD1(d1: D1Database, rows: HistoryRow[]): Promise<AppendResult> {
  const errors: string[] = []
  let appended = 0
  // Phase 21A — INSERT OR IGNORE relies on the unique index on
  // (orderable_part_number, captured_at) added in migration 0002. Re-running
  // a batch with the same capturedAt now silently no-ops instead of
  // duplicating rows. The new columns added in 0002 (display_name,
  // demand_proxy_type, dashboard_priority, supply_status, inventory_signal,
  // pricing_signal, lead_time_signal, source_confidence, created_at) are
  // populated here.
  const createdAt = new Date().toISOString()
  const stmt = d1.prepare(
    `INSERT OR IGNORE INTO ti_inventory_price_snapshot (
      orderable_part_number, generic_part_number, category, subcategory, basket,
      display_name, demand_proxy_type, dashboard_priority,
      captured_at, quantity_available, price_available, currency, price_breaks_json,
      normalized_unit_price, normalized_price_qty, order_limit, future_inventory_json,
      lead_time_weeks, lifecycle_status, okay_to_order,
      supply_status, inventory_signal, pricing_signal, lead_time_signal, source_confidence,
      source_inventory, source_pricing, capture_status, warnings_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) {
    try {
      await stmt
        .bind(
          r.orderablePartNumber,
          r.genericPartNumber,
          r.category,
          r.subcategory,
          r.basket,
          r.displayName,
          r.demandProxyType,
          r.dashboardPriority,
          r.capturedAt,
          r.quantityAvailable,
          r.priceAvailable ? 1 : 0,
          r.currency,
          null, // price_breaks_json — not exposed by the public shape today
          r.normalizedUnitPrice,
          r.normalizedPriceQty,
          r.orderLimit,
          null, // future_inventory_json — public shape carries summary only
          r.leadTimeWeeks,
          r.lifecycleStatus,
          r.okayToOrder == null ? null : r.okayToOrder ? 1 : 0,
          r.supplyStatus,
          r.inventorySignal,
          r.pricingSignal,
          r.leadTimeSignal,
          r.sourceConfidence,
          r.sourceInventory,
          r.sourcePricing,
          r.captureStatus,
          JSON.stringify(r.warnings ?? []),
          createdAt,
        )
        .run()
      appended += 1
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'd1 insert failed'
      errors.push(`d1:${msg.slice(0, 100)}`)
    }
  }
  return { backend: 'd1', rowsAppended: appended, errors }
}

async function appendInventoryHistoryKV(kv: HistoryKV, rows: HistoryRow[]): Promise<AppendResult> {
  // KV bucket per capture date; the customer view never reads these keys
  // directly, only the signal engine and the per-part history endpoint do.
  // We coalesce per-day so the number of KV keys stays bounded (one per day).
  const errors: string[] = []
  let appended = 0
  const byDay = new Map<string, HistoryRow[]>()
  for (const r of rows) {
    const day = isoDay(r.capturedAt)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(r)
  }
  for (const [day, dayRows] of byDay.entries()) {
    const key = kvHistoryKey(day)
    let existing: HistoryRow[] = []
    try {
      const raw = await kv.get(key)
      if (typeof raw === 'string' && raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.rows)) existing = parsed.rows
      }
    } catch (e: any) {
      errors.push(`kv_read:${e?.message || 'unknown'}`)
    }
    // De-dup within the same day on (orderablePartNumber, capturedAt).
    const seen = new Set<string>()
    const merged: HistoryRow[] = []
    for (const r of [...existing, ...dayRows]) {
      const key2 = `${r.orderablePartNumber}|${r.capturedAt}`
      if (seen.has(key2)) continue
      seen.add(key2)
      merged.push(r)
    }
    try {
      await kv.put(key, JSON.stringify({ day, rows: merged }))
      appended += dayRows.length
    } catch (e: any) {
      errors.push(`kv_write:${e?.message || 'unknown'}`)
    }
  }
  return { backend: 'kv', rowsAppended: appended, errors }
}

// ── Read ───────────────────────────────────────────────────────────────────

export async function readPartHistory(
  partNumber: string,
  opts: { d1?: D1Database | null; kv?: HistoryKV | null; days?: number },
): Promise<HistoryRow[]> {
  const days = Math.max(1, Math.min(opts.days ?? 30, 90))
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  if (opts.d1) {
    try {
      const result = await opts.d1
        .prepare(
          `SELECT orderable_part_number, generic_part_number, category, subcategory, basket,
                  display_name, demand_proxy_type, dashboard_priority,
                  captured_at, quantity_available, price_available, currency,
                  normalized_unit_price, normalized_price_qty, order_limit,
                  lead_time_weeks, lifecycle_status, okay_to_order,
                  supply_status, inventory_signal, pricing_signal, lead_time_signal, source_confidence,
                  source_inventory, source_pricing, capture_status, warnings_json
           FROM ti_inventory_price_snapshot
           WHERE UPPER(orderable_part_number) = UPPER(?) AND captured_at >= ?
           ORDER BY captured_at ASC`,
        )
        .bind(partNumber, cutoff)
        .all<any>()
      const rows = result.results ?? []
      return rows.map(rowFromD1)
    } catch {
      // Fall through to KV.
    }
  }
  if (opts.kv) {
    return readPartHistoryKV(opts.kv, partNumber, cutoff)
  }
  return []
}

export async function readUniverseHistoryByPart(
  partNumbers: string[],
  opts: { d1?: D1Database | null; kv?: HistoryKV | null; days?: number },
): Promise<Map<string, HistoryRow[]>> {
  const result = new Map<string, HistoryRow[]>()
  if (partNumbers.length === 0) return result
  const days = Math.max(1, Math.min(opts.days ?? 30, 90))
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  // Phase 21J.1 bugfix — D1 must take precedence over KV in the universe
  // read path. The previous order was inverted, so deployments with both
  // bindings (production) silently fell back to the empty KV history tier
  // and reported observationCount: 0 across the whole watchlist even though
  // D1 already had rows. Per-part history was unaffected because that path
  // already preferred D1.
  if (opts.d1) {
    // Single grouped query keeps the Worker subrequest count at 1 instead
    // of N regardless of universe size.
    try {
      const placeholders = partNumbers.map(() => '?').join(',')
      const sql = `SELECT orderable_part_number, generic_part_number, category, subcategory, basket,
                          captured_at, quantity_available, price_available, currency,
                          normalized_unit_price, normalized_price_qty, order_limit,
                          lead_time_weeks, lifecycle_status, okay_to_order,
                          source_inventory, source_pricing, capture_status, warnings_json
                   FROM ti_inventory_price_snapshot
                   WHERE captured_at >= ?
                     AND UPPER(orderable_part_number) IN (${placeholders})
                   ORDER BY orderable_part_number ASC, captured_at ASC`
      const stmt = opts.d1.prepare(sql).bind(cutoff, ...partNumbers.map(p => p.toUpperCase()))
      const res = await stmt.all<any>()
      const rows = res.results ?? []
      for (const r of rows) {
        const row = rowFromD1(r)
        const key = row.orderablePartNumber.toUpperCase()
        if (!result.has(key)) result.set(key, [])
        result.get(key)!.push(row)
      }
      return result
    } catch {
      // Fall through to KV if D1 query throws (e.g. binding misconfigured
      // mid-deploy). Empty result is preferable to crashing the endpoint.
    }
  }
  if (opts.kv) {
    const allRows = await readUniverseHistoryFromKV(opts.kv, cutoff)
    const wanted = new Set(partNumbers.map(p => p.toUpperCase()))
    for (const row of allRows) {
      const key = row.orderablePartNumber.toUpperCase()
      if (!wanted.has(key)) continue
      if (!result.has(key)) result.set(key, [])
      result.get(key)!.push(row)
    }
    for (const arr of result.values()) {
      arr.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    }
    return result
  }
  return result
}

async function readPartHistoryKV(kv: HistoryKV, partNumber: string, cutoff: string): Promise<HistoryRow[]> {
  const all = await readUniverseHistoryFromKV(kv, cutoff)
  const upper = partNumber.toUpperCase()
  return all
    .filter(r => r.orderablePartNumber.toUpperCase() === upper)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

async function readUniverseHistoryFromKV(kv: HistoryKV, cutoff: string): Promise<HistoryRow[]> {
  const out: HistoryRow[] = []
  let cursor: string | undefined = undefined
  let safetyCounter = 0
  while (safetyCounter < 90) {
    safetyCounter += 1
    const list = await kv.list({ prefix: KV_HISTORY_PREFIX, limit: 100, cursor })
    for (const k of list.keys) {
      const day = k.name.slice(KV_HISTORY_PREFIX.length)
      // Skip days that are entirely before the cutoff window.
      if (day < cutoff.slice(0, 10)) continue
      const raw = await kv.get(k.name)
      if (typeof raw !== 'string' || !raw) continue
      try {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.rows)) {
          for (const row of parsed.rows) {
            if (typeof row?.capturedAt === 'string' && row.capturedAt >= cutoff) {
              out.push(row as HistoryRow)
            }
          }
        }
      } catch {
        // Ignore corrupted day buckets.
      }
    }
    if (list.list_complete) break
    cursor = list.cursor
    if (!cursor) break
  }
  return out
}

function rowFromD1(r: any): HistoryRow {
  const priceAvailable = !!r.price_available
  return {
    orderablePartNumber: r.orderable_part_number,
    genericPartNumber: r.generic_part_number ?? null,
    category: r.category ?? null,
    subcategory: r.subcategory ?? null,
    basket: r.basket ?? null,
    displayName: r.display_name ?? null,
    demandProxyType: r.demand_proxy_type ?? null,
    dashboardPriority: (r.dashboard_priority ?? null) as HistoryRow['dashboardPriority'],
    capturedAt: r.captured_at,
    quantityAvailable: r.quantity_available ?? null,
    pricingAvailability: priceAvailable ? 'available' : 'unavailable',
    priceAvailable,
    currency: r.currency ?? null,
    normalizedUnitPrice: r.normalized_unit_price ?? null,
    normalizedPriceQty: r.normalized_price_qty ?? null,
    orderLimit: r.order_limit ?? null,
    leadTimeWeeks: r.lead_time_weeks ?? null,
    lifecycleStatus: r.lifecycle_status ?? null,
    okayToOrder: r.okay_to_order == null ? null : !!r.okay_to_order,
    supplyStatus: r.supply_status ?? null,
    inventorySignal: r.inventory_signal ?? null,
    pricingSignal: r.pricing_signal ?? null,
    leadTimeSignal: r.lead_time_signal ?? null,
    sourceConfidence: r.source_confidence ?? null,
    captureStatus: (r.capture_status ?? 'failed') as WatchedPartCaptureStatus,
    sourceInventory: r.source_inventory ?? 'Texas Instruments Store Inventory & Pricing API',
    sourcePricing: (r.source_pricing ?? 'unavailable') as 'direct_ti_store_price' | 'unavailable',
    warnings: tryParseArray(r.warnings_json),
  }
}

function tryParseArray(s: unknown): string[] {
  if (typeof s !== 'string' || !s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// ── Signal engine ──────────────────────────────────────────────────────────

export type InventorySignalType =
  | 'shortage_pressure'
  | 'inventory_tightening'
  | 'oversupply_pressure'
  | 'supply_easing'
  | 'price_only_pressure'
  | 'normal'
  | 'insufficient_history'

export type InventorySignalStrength = 'low' | 'medium' | 'high' | 'none'

export type InventorySignal = {
  orderablePartNumber: string
  genericPartNumber: string | null
  basket: string | null
  asOf: string
  observationCount: number
  inventoryDelta1d: number | null
  inventoryDelta7d: number | null
  inventoryDelta30d: number | null
  inventoryPctDelta1d: number | null
  inventoryPctDelta7d: number | null
  inventoryPctDelta30d: number | null
  priceDelta1d: number | null
  priceDelta7d: number | null
  priceDelta30d: number | null
  pricePctDelta1d: number | null
  pricePctDelta7d: number | null
  pricePctDelta30d: number | null
  leadTimeDelta: number | null
  signalType: InventorySignalType
  signalStrength: InventorySignalStrength
  explanation: string
  confidence: number
}

const DAY_MS = 86_400_000

function findRowAtOrBefore(rows: HistoryRow[], cutoffMs: number): HistoryRow | null {
  // rows assumed sorted ascending by capturedAt. Pick the latest row whose
  // capturedAt <= cutoff. Returns null if no row that old exists.
  let best: HistoryRow | null = null
  for (const r of rows) {
    const t = Date.parse(r.capturedAt)
    if (Number.isFinite(t) && t <= cutoffMs) best = r
    else break
  }
  return best
}

function pctDelta(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || !Number.isFinite(latest) || !Number.isFinite(prior)) return null
  if (prior === 0) {
    if (latest === 0) return 0
    return null
  }
  return Math.round(((latest - prior) / Math.abs(prior)) * 1000) / 10
}

function absDelta(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || !Number.isFinite(latest) || !Number.isFinite(prior)) return null
  return Math.round((latest - prior) * 100) / 100
}

export function computeInventoryPriceSignal(rows: HistoryRow[]): InventorySignal {
  // rows must be ascending by capturedAt. Must contain at least one row.
  const latest = rows[rows.length - 1]
  const baseline: InventorySignal = {
    orderablePartNumber: latest?.orderablePartNumber ?? '',
    genericPartNumber: latest?.genericPartNumber ?? null,
    basket: latest?.basket ?? null,
    asOf: latest?.capturedAt ?? new Date().toISOString(),
    observationCount: rows.length,
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
    explanation: 'Need at least 3 successful captures to classify trends.',
    confidence: 0,
  }
  if (!latest) return baseline
  if (rows.length < 3) {
    return {
      ...baseline,
      explanation: rows.length === 1
        ? 'Only one capture observed — at least 3 are required for trend classification.'
        : 'Two captures observed — at least 3 are required for trend classification.',
    }
  }

  const latestMs = Date.parse(latest.capturedAt)
  const r1d = findRowAtOrBefore(rows.slice(0, -1), latestMs - 1 * DAY_MS) ?? null
  const r7d = findRowAtOrBefore(rows.slice(0, -1), latestMs - 7 * DAY_MS) ?? null
  const r30d = findRowAtOrBefore(rows.slice(0, -1), latestMs - 30 * DAY_MS) ?? null

  const invLatest = latest.quantityAvailable
  const priceLatest = latest.normalizedUnitPrice
  const priceFlagLatest = latest.priceAvailable

  const inventoryPctDelta1d = pctDelta(invLatest, r1d?.quantityAvailable ?? null)
  const inventoryPctDelta7d = pctDelta(invLatest, r7d?.quantityAvailable ?? null)
  const inventoryPctDelta30d = pctDelta(invLatest, r30d?.quantityAvailable ?? null)
  const inventoryDelta1d = absDelta(invLatest, r1d?.quantityAvailable ?? null)
  const inventoryDelta7d = absDelta(invLatest, r7d?.quantityAvailable ?? null)
  const inventoryDelta30d = absDelta(invLatest, r30d?.quantityAvailable ?? null)

  const pricePctDelta1d = pctDelta(priceLatest, r1d?.normalizedUnitPrice ?? null)
  const pricePctDelta7d = pctDelta(priceLatest, r7d?.normalizedUnitPrice ?? null)
  const pricePctDelta30d = pctDelta(priceLatest, r30d?.normalizedUnitPrice ?? null)
  const priceDelta1d = absDelta(priceLatest, r1d?.normalizedUnitPrice ?? null)
  const priceDelta7d = absDelta(priceLatest, r7d?.normalizedUnitPrice ?? null)
  const priceDelta30d = absDelta(priceLatest, r30d?.normalizedUnitPrice ?? null)

  const leadTimeDelta = absDelta(latest.leadTimeWeeks ?? null, r7d?.leadTimeWeeks ?? null)

  // Classification — drives the dashboard's shortage/oversupply badges.
  const inv7 = inventoryPctDelta7d
  const price7 = pricePctDelta7d
  const priceMoves = price7 != null && Math.abs(price7) >= 1
  const priceFlat = price7 != null && !priceMoves
  const priceMissing = !priceFlagLatest && price7 == null

  let signalType: InventorySignalType = 'normal'
  let signalStrength: InventorySignalStrength = 'low'
  let explanation = 'Inventory and pricing within typical bounds.'
  let confidence = 0.3

  if (inv7 != null && inv7 <= -25 && price7 != null && price7 >= 5) {
    signalType = 'shortage_pressure'
    signalStrength = inv7 <= -50 || price7 >= 15 ? 'high' : 'medium'
    if ((leadTimeDelta ?? 0) > 0) signalStrength = 'high'
    explanation = `Inventory ${inv7.toFixed(1)}% over 7d while price ${price7.toFixed(1)}% — likely shortage.`
    confidence = signalStrength === 'high' ? 0.9 : 0.7
  } else if (inv7 != null && inv7 <= -25 && (priceFlat || priceMissing)) {
    signalType = 'inventory_tightening'
    signalStrength = inv7 <= -50 ? 'medium' : 'low'
    explanation = priceMissing
      ? `Inventory ${inv7.toFixed(1)}% over 7d; price unavailable so shortage status is provisional.`
      : `Inventory ${inv7.toFixed(1)}% over 7d with price flat — tightening but no clear price pressure yet.`
    confidence = priceMissing ? 0.4 : 0.55
  } else if (inv7 != null && inv7 >= 50 && price7 != null && price7 <= -5) {
    signalType = 'oversupply_pressure'
    signalStrength = inv7 >= 100 || price7 <= -10 ? 'high' : 'medium'
    explanation = `Inventory ${inv7.toFixed(1)}% over 7d while price ${price7.toFixed(1)}% — likely oversupply.`
    confidence = 0.75
  } else if (inv7 != null && inv7 >= 50 && (priceFlat || priceMissing)) {
    signalType = 'supply_easing'
    signalStrength = inv7 >= 100 ? 'medium' : 'low'
    explanation = priceMissing
      ? `Inventory ${inv7.toFixed(1)}% over 7d; price unavailable so easing status is provisional.`
      : `Inventory ${inv7.toFixed(1)}% over 7d with price flat — supply easing.`
    confidence = priceMissing ? 0.4 : 0.55
  } else if (price7 != null && price7 >= 5 && (inv7 == null || inv7 >= 0)) {
    signalType = 'price_only_pressure'
    signalStrength = price7 >= 15 ? 'medium' : 'low'
    explanation = `Price ${price7.toFixed(1)}% over 7d without inventory drop — price-led signal only.`
    confidence = 0.5
  }

  return {
    orderablePartNumber: latest.orderablePartNumber,
    genericPartNumber: latest.genericPartNumber ?? null,
    basket: latest.basket ?? null,
    asOf: latest.capturedAt,
    observationCount: rows.length,
    inventoryDelta1d,
    inventoryDelta7d,
    inventoryDelta30d,
    inventoryPctDelta1d,
    inventoryPctDelta7d,
    inventoryPctDelta30d,
    priceDelta1d,
    priceDelta7d,
    priceDelta30d,
    pricePctDelta1d,
    pricePctDelta7d,
    pricePctDelta30d,
    leadTimeDelta,
    signalType,
    signalStrength,
    explanation,
    confidence,
  }
}

export function computeWatchedSignals(history: Map<string, HistoryRow[]>): InventorySignal[] {
  const out: InventorySignal[] = []
  for (const rows of history.values()) {
    if (!rows || rows.length === 0) continue
    out.push(computeInventoryPriceSignal(rows))
  }
  return out.sort((a, b) => {
    // Surface meaningful signals first; insufficient_history sinks to bottom.
    const order: Record<InventorySignalType, number> = {
      shortage_pressure: 0,
      oversupply_pressure: 1,
      inventory_tightening: 2,
      supply_easing: 3,
      price_only_pressure: 4,
      normal: 5,
      insufficient_history: 6,
    }
    return (order[a.signalType] - order[b.signalType]) || a.orderablePartNumber.localeCompare(b.orderablePartNumber)
  })
}

export function summarizeSignals(signals: InventorySignal[]): {
  total: number
  shortagePressure: number
  oversupplyPressure: number
  inventoryTightening: number
  supplyEasing: number
  priceOnlyPressure: number
  normal: number
  insufficientHistory: number
} {
  const counts = {
    total: signals.length,
    shortagePressure: 0,
    oversupplyPressure: 0,
    inventoryTightening: 0,
    supplyEasing: 0,
    priceOnlyPressure: 0,
    normal: 0,
    insufficientHistory: 0,
  }
  for (const s of signals) {
    switch (s.signalType) {
      case 'shortage_pressure': counts.shortagePressure += 1; break
      case 'oversupply_pressure': counts.oversupplyPressure += 1; break
      case 'inventory_tightening': counts.inventoryTightening += 1; break
      case 'supply_easing': counts.supplyEasing += 1; break
      case 'price_only_pressure': counts.priceOnlyPressure += 1; break
      case 'normal': counts.normal += 1; break
      default: counts.insufficientHistory += 1; break
    }
  }
  return counts
}

// ── Phase 21A — persisted signals + summary helpers ─────────────────────────
// Computed signals are persisted to ti_inventory_price_signal (rewritten on
// every capture batch). The /api/ti/inventory/signals/latest endpoint reads
// from there for fast lookups; the existing /api/ti/inventory/signals route
// continues to compute on the fly so callers that only care about live
// state don't depend on a recompute step. Both paths agree on the signal
// classification rules.

export type PersistedSignalRow = {
  id: string
  orderablePartNumber: string
  genericPartNumber: string | null
  basket: string | null
  displayName: string | null
  asOf: string
  latestQuantityAvailable: number | null
  previousQuantityAvailable: number | null
  inventoryDelta: number | null
  inventoryPctDelta: number | null
  latestNormalizedUnitPrice: number | null
  previousNormalizedUnitPrice: number | null
  priceDelta: number | null
  pricePctDelta: number | null
  observationsCount: number
  signalType: InventorySignalType
  signalStrength: InventorySignalStrength
  explanation: string
  confidence: number | string
  createdAt: string
}

function signalRowFromCompute(
  s: InventorySignal,
  rows: HistoryRow[],
  hint: { displayName: string | null; basket: string | null } = { displayName: null, basket: null },
): PersistedSignalRow {
  const latest = rows[rows.length - 1] ?? null
  const previous = rows.length >= 2 ? rows[rows.length - 2] : null
  const id = `${s.orderablePartNumber}:${s.asOf}`
  return {
    id,
    orderablePartNumber: s.orderablePartNumber,
    genericPartNumber: s.genericPartNumber,
    basket: s.basket ?? hint.basket ?? null,
    displayName: hint.displayName ?? latest?.displayName ?? null,
    asOf: s.asOf,
    latestQuantityAvailable: latest?.quantityAvailable ?? null,
    previousQuantityAvailable: previous?.quantityAvailable ?? null,
    inventoryDelta: s.inventoryDelta1d ?? s.inventoryDelta7d ?? null,
    inventoryPctDelta: s.inventoryPctDelta1d ?? s.inventoryPctDelta7d ?? null,
    latestNormalizedUnitPrice: latest?.normalizedUnitPrice ?? null,
    previousNormalizedUnitPrice: previous?.normalizedUnitPrice ?? null,
    priceDelta: s.priceDelta1d ?? s.priceDelta7d ?? null,
    pricePctDelta: s.pricePctDelta1d ?? s.pricePctDelta7d ?? null,
    observationsCount: s.observationCount,
    signalType: s.signalType,
    signalStrength: s.signalStrength,
    explanation: s.explanation,
    confidence: s.confidence,
    createdAt: new Date().toISOString(),
  }
}

export async function persistSignalRows(
  d1: D1Database | null | undefined,
  rows: PersistedSignalRow[],
): Promise<{ persisted: number; errors: string[] }> {
  if (!d1 || rows.length === 0) return { persisted: 0, errors: rows.length === 0 ? [] : ['no_d1_binding'] }
  const errors: string[] = []
  let persisted = 0
  // Phase 21A — `id` uses the part:asOf scheme so re-running a recompute
  // for the same observation timestamp is idempotent. Using a plain
  // INSERT lets us see explicit duplicate errors during early dev; in
  // production we expect each capture to produce a unique asOf per part.
  // We delete any prior signal row for this part first so the table only
  // ever holds the latest classification per part.
  const deleteStmt = d1.prepare(`DELETE FROM ti_inventory_price_signal WHERE orderable_part_number = ?`)
  const insertStmt = d1.prepare(
    `INSERT OR REPLACE INTO ti_inventory_price_signal (
      id, orderable_part_number, generic_part_number, basket, display_name, as_of,
      latest_quantity_available, previous_quantity_available, inventory_delta, inventory_pct_delta,
      latest_normalized_unit_price, previous_normalized_unit_price, price_delta, price_pct_delta,
      observations_count, signal_type, signal_strength, explanation, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) {
    try {
      await deleteStmt.bind(r.orderablePartNumber).run()
      await insertStmt
        .bind(
          r.id,
          r.orderablePartNumber,
          r.genericPartNumber,
          r.basket,
          r.displayName,
          r.asOf,
          r.latestQuantityAvailable,
          r.previousQuantityAvailable,
          r.inventoryDelta,
          r.inventoryPctDelta,
          r.latestNormalizedUnitPrice,
          r.previousNormalizedUnitPrice,
          r.priceDelta,
          r.pricePctDelta,
          r.observationsCount,
          r.signalType,
          r.signalStrength,
          r.explanation,
          String(r.confidence),
          r.createdAt,
        )
        .run()
      persisted += 1
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'd1 signal insert failed'
      errors.push(`d1:${msg.slice(0, 100)}`)
    }
  }
  return { persisted, errors }
}

export async function recomputeAndPersistSignals(
  d1: D1Database | null | undefined,
  kv: HistoryKV | null | undefined,
  partNumbers: string[],
  hints: Map<string, { displayName: string | null; basket: string | null }>,
  days: number = 30,
): Promise<{ persisted: number; computed: number; errors: string[] }> {
  if (partNumbers.length === 0) return { persisted: 0, computed: 0, errors: [] }
  const history = await readUniverseHistoryByPart(partNumbers, { d1, kv, days })
  const rowsToWrite: PersistedSignalRow[] = []
  for (const pn of partNumbers) {
    const upper = pn.toUpperCase()
    const rows = history.get(upper) ?? []
    if (rows.length === 0) continue
    const signal = computeInventoryPriceSignal(rows)
    const hint = hints.get(upper) ?? { displayName: null, basket: null }
    rowsToWrite.push(signalRowFromCompute(signal, rows, hint))
  }
  const result = await persistSignalRows(d1, rowsToWrite)
  return { persisted: result.persisted, computed: rowsToWrite.length, errors: result.errors }
}

export type LatestSignalReadRow = PersistedSignalRow

/** Read the most recent persisted signal per part. Returns whatever is in
 *  the signal table — caller is responsible for synthesizing
 *  insufficient_history rows for parts that haven't accumulated enough
 *  history to be persisted yet. */
export async function getLatestSignalsFromD1(
  d1: D1Database | null | undefined,
): Promise<LatestSignalReadRow[]> {
  if (!d1) return []
  try {
    const result = await d1
      .prepare(
        `SELECT id, orderable_part_number, generic_part_number, basket, display_name, as_of,
                latest_quantity_available, previous_quantity_available, inventory_delta, inventory_pct_delta,
                latest_normalized_unit_price, previous_normalized_unit_price, price_delta, price_pct_delta,
                observations_count, signal_type, signal_strength, explanation, confidence, created_at
         FROM ti_inventory_price_signal
         ORDER BY as_of DESC`,
      )
      .bind()
      .all<any>()
    const rows = result.results ?? []
    return rows.map(r => ({
      id: r.id,
      orderablePartNumber: r.orderable_part_number,
      genericPartNumber: r.generic_part_number ?? null,
      basket: r.basket ?? null,
      displayName: r.display_name ?? null,
      asOf: r.as_of,
      latestQuantityAvailable: r.latest_quantity_available ?? null,
      previousQuantityAvailable: r.previous_quantity_available ?? null,
      inventoryDelta: r.inventory_delta ?? null,
      inventoryPctDelta: r.inventory_pct_delta ?? null,
      latestNormalizedUnitPrice: r.latest_normalized_unit_price ?? null,
      previousNormalizedUnitPrice: r.previous_normalized_unit_price ?? null,
      priceDelta: r.price_delta ?? null,
      pricePctDelta: r.price_pct_delta ?? null,
      observationsCount: r.observations_count ?? 0,
      signalType: (r.signal_type ?? 'insufficient_history') as InventorySignalType,
      signalStrength: (r.signal_strength ?? 'none') as InventorySignalStrength,
      explanation: r.explanation ?? '',
      confidence: r.confidence ?? 0,
      createdAt: r.created_at ?? '',
    }))
  } catch {
    return []
  }
}

export type InventoryHistorySummary = {
  totalTrackedParts: number
  partsWithHistory: number
  totalSnapshots: number
  latestCapturedAt: string | null
  partsWith2PlusObservations: number
  partsWith3PlusObservations: number
  shortagePressureCount: number
  oversupplyPressureCount: number
  inventoryTighteningCount: number
  supplyEasingCount: number
  priceOnlyPressureCount: number
  normalCount: number
  insufficientHistoryCount: number
  backend: 'd1' | 'kv' | 'none'
}

export async function getInventoryHistorySummary(
  d1: D1Database | null | undefined,
  kv: HistoryKV | null | undefined,
  trackedPartNumbers: string[],
): Promise<InventoryHistorySummary> {
  const summary: InventoryHistorySummary = {
    totalTrackedParts: trackedPartNumbers.length,
    partsWithHistory: 0,
    totalSnapshots: 0,
    latestCapturedAt: null,
    partsWith2PlusObservations: 0,
    partsWith3PlusObservations: 0,
    shortagePressureCount: 0,
    oversupplyPressureCount: 0,
    inventoryTighteningCount: 0,
    supplyEasingCount: 0,
    priceOnlyPressureCount: 0,
    normalCount: 0,
    insufficientHistoryCount: 0,
    backend: d1 ? 'd1' : kv ? 'kv' : 'none',
  }
  if (trackedPartNumbers.length === 0) return summary

  // Pull observation counts + latest capturedAt in one D1 round-trip when D1
  // is bound; fall back to KV otherwise.
  if (d1) {
    try {
      const placeholders = trackedPartNumbers.map(() => '?').join(',')
      const sql = `SELECT UPPER(orderable_part_number) AS opn,
                          COUNT(*) AS observations,
                          MAX(captured_at) AS latest_at
                   FROM ti_inventory_price_snapshot
                   WHERE UPPER(orderable_part_number) IN (${placeholders})
                   GROUP BY UPPER(orderable_part_number)`
      const stmt = d1.prepare(sql).bind(...trackedPartNumbers.map(p => p.toUpperCase()))
      const res = await stmt.all<any>()
      const groups = res.results ?? []
      let totalSnapshots = 0
      let latestAt: string | null = null
      for (const g of groups) {
        const obs = Number(g.observations) || 0
        totalSnapshots += obs
        if (obs >= 1) summary.partsWithHistory += 1
        if (obs >= 2) summary.partsWith2PlusObservations += 1
        if (obs >= 3) summary.partsWith3PlusObservations += 1
        if (g.latest_at && (!latestAt || g.latest_at > latestAt)) latestAt = g.latest_at
      }
      summary.totalSnapshots = totalSnapshots
      summary.latestCapturedAt = latestAt
    } catch {
      // Fall through to KV path.
    }
    // Read persisted signal counts.
    try {
      const sigs = await getLatestSignalsFromD1(d1)
      for (const s of sigs) {
        switch (s.signalType) {
          case 'shortage_pressure': summary.shortagePressureCount += 1; break
          case 'oversupply_pressure': summary.oversupplyPressureCount += 1; break
          case 'inventory_tightening': summary.inventoryTighteningCount += 1; break
          case 'supply_easing': summary.supplyEasingCount += 1; break
          case 'price_only_pressure': summary.priceOnlyPressureCount += 1; break
          case 'normal': summary.normalCount += 1; break
          default: summary.insufficientHistoryCount += 1
        }
      }
      // Count parts that don't have a persisted signal as insufficient_history.
      const persistedKeys = new Set(sigs.map(s => s.orderablePartNumber.toUpperCase()))
      for (const pn of trackedPartNumbers) {
        if (!persistedKeys.has(pn.toUpperCase())) summary.insufficientHistoryCount += 1
      }
      return summary
    } catch {
      // ignore
    }
  }

  // KV fallback: derive counts from history rows.
  if (kv) {
    const all = await readUniverseHistoryByPart(trackedPartNumbers, { kv, days: 30 })
    let totalSnapshots = 0
    let latestAt: string | null = null
    for (const [, rows] of all.entries()) {
      const n = rows.length
      totalSnapshots += n
      if (n >= 1) summary.partsWithHistory += 1
      if (n >= 2) summary.partsWith2PlusObservations += 1
      if (n >= 3) summary.partsWith3PlusObservations += 1
      const last = rows[rows.length - 1]
      if (last?.capturedAt && (!latestAt || last.capturedAt > latestAt)) latestAt = last.capturedAt
    }
    summary.totalSnapshots = totalSnapshots
    summary.latestCapturedAt = latestAt
    summary.insufficientHistoryCount = trackedPartNumbers.length
  }
  return summary
}
