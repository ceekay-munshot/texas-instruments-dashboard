// Phase 28 — broad like-for-like (constant-basket) price index.
//
// UBS publishes TWO price series per category: stock-weighted ASP (mix+price,
// volatile — UBS's own swings ±8-24%/qtr) and Like-for-Like (constant basket,
// pure price — the ~1% headline). Our weightedSeries engine matches the
// former; this builds the latter from our own 72k catalog.
//
// Method: a fixed-weight Jevons index — the equal-weight GEOMETRIC MEAN of
// per-part price relatives over parts present in BOTH periods. Because weights
// are frozen and only matched parts count, neither mix shifts nor stock swings
// can move it — only real per-part list-price changes do. (That is exactly why
// the earlier stock-WEIGHTED panel attempts produced -52%/+147% garbage and
// this cannot: those used time-varying stock as weights; this uses none.)
//
// Data: ti_catalog_opn_price_history — one part-level price row per OPN per
// weekly capture, appended by the lfl/snapshot endpoint the catalog workflow
// calls after finalize. The first capture is the basket's base; each later
// capture's matched-pair move vs an earlier one is that period's pure price move.
//
// Prospective by design: May-4 part-level prices were never archived
// (raw_r2_key null) and the 74-part panel had an early-May normalization
// artifact, so a trustworthy broad L4L can only accumulate forward. Until two
// clean captures span a period the move is 0% (no new info), and rows whose
// period starts before our first capture keep the UBS-derived historical L4L
// already in the trend view — an invisible seam at the data edge.

import { buildSubcategoryPredicates, type SubcategoryPredicate } from './tiCatalogMapping'

type D1Like = { prepare: (sql: string) => any } | null

const HIST_TABLE = 'ti_catalog_opn_price_history'
const MIN_PARTS = 5 // a real basket, not a handful, before we call it a category move

export type LflPoint = { date: string; price: number }
export type BroadLfl = Record<string, Record<string, LflPoint[]>> // sub -> opn -> points asc by date

let _preds: SubcategoryPredicate[] | null = null
function predicates(): SubcategoryPredicate[] {
  if (!_preds) _preds = buildSubcategoryPredicates()
  return _preds
}

// Non-IC exclusion mirrors the ASP hygiene so EVM/eval/board/kit SKUs never
// enter the basket. References ti_catalog_latest_opn columns directly.
const NON_IC_EXCLUSION =
  `NOT (UPPER(ti_part_number) LIKE '%EVM%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%EVALUATION%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%MODULE%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%BOARD%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%KIT%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%BUNDLE%'` +
  ` OR UPPER(COALESCE(description,'')) LIKE '%DAQ%')`

export async function ensureLflSchema(d1: D1Like): Promise<void> {
  if (!d1) return
  await d1.prepare(
    `CREATE TABLE IF NOT EXISTS ${HIST_TABLE} (
       ti_part_number TEXT NOT NULL,
       captured_date TEXT NOT NULL,
       canonical_subcategory TEXT,
       normalized_unit_price REAL NOT NULL,
       quantity INTEGER,
       PRIMARY KEY (ti_part_number, captured_date)
     )`,
  ).run()
  await d1.prepare(`CREATE INDEX IF NOT EXISTS idx_opn_price_hist_sub_date ON ${HIST_TABLE} (canonical_subcategory, captured_date)`).run()
  await d1.prepare(`CREATE INDEX IF NOT EXISTS idx_opn_price_hist_date ON ${HIST_TABLE} (captured_date)`).run()
}

/** Append a part-level price snapshot of the current ti_catalog_latest_opn,
 *  stamped with ONE date, computing canonical per-subcategory predicate (the
 *  same scoped approach the rollup rebuild uses — a single 72k-row CASE blows
 *  the D1 per-statement CPU budget). Idempotent per (opn, date). */
export async function snapshotOpnPriceHistory(
  d1: D1Like,
  captureDate: string,
): Promise<{ inserted: number; subcats: number; errors: string[] }> {
  const errors: string[] = []
  if (!d1) return { inserted: 0, subcats: 0, errors: ['no d1'] }
  await ensureLflSchema(d1)
  let inserted = 0
  let subcats = 0
  for (const p of predicates()) {
    try {
      const res: any = await d1.prepare(
        `INSERT OR REPLACE INTO ${HIST_TABLE}
           (ti_part_number, captured_date, canonical_subcategory, normalized_unit_price, quantity)
         SELECT ti_part_number, ?, ?, normalized_unit_price, quantity
           FROM ti_catalog_latest_opn
          WHERE (${p.whereClause})
            AND normalized_unit_price IS NOT NULL AND normalized_unit_price > 0
            AND ${NON_IC_EXCLUSION}`,
      ).bind(captureDate, p.canonicalSubcategory).run()
      inserted += Number(res?.meta?.changes ?? 0) || 0
      subcats += 1
    } catch (e: any) {
      errors.push(`${p.canonicalSubcategory}:${(e?.message || 'failed').slice(0, 120)}`)
    }
  }
  return { inserted, subcats, errors }
}

// Phase 28.4 — this table holds ~19k rows PER weekly snapshot, so loading it
// into the Worker on every request (and doubling weekly) is what tipped the
// 250-row WoW view over Cloudflare's CPU limit (1102). Three defenses:
// per-isolate TTL cache; a short-circuit while only one snapshot date exists
// (no matched pair is computable, so loading anything is pure waste); and,
// once moves ARE computable, loading only parts present on 2+ dates — parts
// seen once can never form a pair.
const CACHE_TTL_MS = 300_000
let _lflCache: { at: number; data: BroadLfl } | null = null

export async function buildBroadLfl(d1: D1Like): Promise<BroadLfl> {
  if (_lflCache && Date.now() - _lflCache.at < CACHE_TTL_MS) return _lflCache.data
  const out: BroadLfl = {}
  if (!d1) return out
  try {
    const dc: any = await d1.prepare(
      `SELECT COUNT(DISTINCT captured_date) AS d FROM ${HIST_TABLE}`,
    ).first()
    if (Number(dc?.d ?? 0) < 2) {
      _lflCache = { at: Date.now(), data: out }
      return out
    }
    const res: any = await d1.prepare(
      `SELECT canonical_subcategory AS sub, ti_part_number AS opn,
              captured_date AS date, normalized_unit_price AS price
         FROM ${HIST_TABLE}
        WHERE canonical_subcategory IS NOT NULL
          AND normalized_unit_price IS NOT NULL AND normalized_unit_price > 0
          AND ti_part_number IN (
            SELECT ti_part_number FROM ${HIST_TABLE}
             GROUP BY ti_part_number HAVING COUNT(DISTINCT captured_date) >= 2)
        ORDER BY captured_date ASC`,
    ).all()
    for (const r of res?.results ?? []) {
      const sub = r.sub as string
      const opn = r.opn as string
      const price = Number(r.price)
      if (!sub || !opn || !(price > 0)) continue
      ;((out[sub] ||= {})[opn] ||= []).push({ date: r.date as string, price })
    }
    _lflCache = { at: Date.now(), data: out }
  } catch { /* table may not exist yet → empty (no override) */ }
  return out
}

/** Price of a part at-or-before `date` (points ascending). */
function priceAt(points: LflPoint[], date: string): number | null {
  let ans: number | null = null
  for (const p of points) { if (p.date <= date) ans = p.price; else break }
  return ans
}

/** Matched-pairs equal-weight geometric-mean L4L move between two dates. Only
 *  parts priced at-or-before BOTH boundaries count, so mix/stock cannot move
 *  it — only real per-part price changes. Returns null below MIN_PARTS. */
export function broadLflMove(
  lfl: BroadLfl, sub: string, startDate: string, endDate: string,
): { pct: number; n: number } | null {
  const parts = lfl[sub]
  if (!parts) return null
  let sumLn = 0, n = 0
  for (const opn of Object.keys(parts)) {
    const s = priceAt(parts[opn], startDate)
    const e = priceAt(parts[opn], endDate)
    if (s == null || e == null || s <= 0 || e <= 0) continue
    sumLn += Math.log(e / s)
    n += 1
  }
  if (n < MIN_PARTS) return null
  return { pct: (Math.exp(sumLn / n) - 1) * 100, n }
}

/** Overlay broad L4L onto post-data rows. A row is overridden only when the
 *  series has a capture at-or-before its period START (so a matched basket can
 *  form); rows starting before our first capture keep their existing
 *  UBS-derived historical L4L — an invisible seam at the data edge. */
export function applyBroadLflOverride(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  lfl: BroadLfl,
  liveAsOf: string,
): { overridden: number } {
  let overridden = 0
  const minDate: Record<string, string> = {}
  for (const sub of Object.keys(lfl)) {
    let m: string | null = null
    for (const opn of Object.keys(lfl[sub])) {
      const first = lfl[sub][opn][0]?.date
      if (first && (m == null || first < m)) m = first
    }
    if (m) minDate[sub] = m
  }
  for (const col of result.columns) {
    const sub = col.canonicalId
    if (!lfl[sub] || !minDate[sub]) continue
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = i > 0 ? result.rows[i - 1].periodEnd : null
      if (!startDate) continue
      if (startDate < minDate[sub]) continue // period predates our basket → keep historical
      const mv = broadLflMove(lfl, sub, startDate, endDate)
      if (!mv) continue
      row.cells[sub] = {
        ...row.cells[sub],
        pct: mv.pct,
        breakdown: {
          todayUSD: null, todayDate: endDate, todayLabel: 'Latest capture',
          anchorUSD: null, anchorDate: startDate, anchorLabel: 'Constant-basket base',
          latestSource: 'ti_inventory',
          representativePartUsed: `Like-for-like · ${mv.n} repeat parts (72k catalog)`,
        },
      }
      overridden += 1
    }
  }
  return { overridden }
}
