// Phase 28.2 — daily-panel like-for-like overlay for the capture-gap period.
//
// THE PROBLEM THIS SOLVES (Jun-11 audit): the broad weighted series has only
// sparse points (May-4 seed, Jun-3 partial), so any move between two points
// gets attributed to whichever ROW happens to straddle them — the real May-8
// TI list-price hike (~+10%, verified per-part, held 5+ weeks) displayed as
// "May 30–Jun 5 +6.4%" / "MTD Jun-26 +6.4%" while "May 2–8" and "May-26" read
// 0.00%. Wrong dating, right move.
//
// THE FIX: the 74-part daily panel captures real TI list prices EVERY DAY, so
// it can date moves to the day. For rows the broad series cannot resolve
// (bracketing broad points sit > SLACK days outside the row's boundaries), we
// override with the panel's matched-pairs equal-weight GEOMETRIC mean of price
// relatives — the same mix/stock-immune construction as the broad L4L, just on
// the smaller daily basket. Guards: ≥2 matched parts per subcategory, both
// boundaries priced (start may forward-snap ≤5d to the panel's first capture).
//
// SELF-RETIRING: once weekly catalog captures accumulate (post Phase 28.1
// schedule fix), broad points bracket every WoW/MoM row within SLACK days, the
// reliability test passes, and this overlay stops firing — "everything from
// the 72k catalog going forward", panel only bridges the bootstrap gap.

import { mapOpnToCanonical } from './tiCatalogMapping'
import { broadOwnsRow, dayNum, OVERLAY_EARLIEST, type WeightedSeries } from './weightedSeries'

type D1Like = { prepare: (sql: string) => any } | null

// Panel prices are trusted from May-4 (= the HANDOFF date), not the very first
// May-2 capture: the May-2/3 readings carried a settling artifact (live-verified:
// TPS53688 read +21% from May-2 but +10% from May-4, pushing dc_tps536xx's May
// to +12.65% vs the true +10.0% and breaking month×month≈quarter coherence).
const PANEL_TRUSTED_FIRST = '2026-05-04'
const START_SNAP_DAYS = 5 // a row-start ≤5d before the panel's first price may snap forward to it
// If the daily capture feed dies, carried-forward prices must NOT keep
// producing confident 0.00% rows forever — measurements whose row-end is more
// than this many days past the last real capture return null ("—") instead.
const PANEL_MAX_STALE_DAYS = 3
const MIN_PARTS = 2
const CACHE_TTL_MS = 300_000 // panel grows once a day; rebuilding per request burned WoW's CPU budget

export type PanelPoint = { date: string; price: number }
export type PanelLfl = {
  subs: Record<string, Record<string, PanelPoint[]>> // sub -> opn -> points asc
  lastDate: string | null // most recent capture date — staleness bound for measurements
}

const dayMs = 86400000
function daysBetween(a: string, b: string): number {
  return Math.round((dayNum(b) - dayNum(a)) / dayMs)
}

let _panelCache: { at: number; data: PanelLfl } | null = null
const EMPTY_PANEL: PanelLfl = { subs: {}, lastDate: null }

export async function buildPanelLfl(d1: D1Like): Promise<PanelLfl> {
  if (_panelCache && Date.now() - _panelCache.at < CACHE_TTL_MS) return _panelCache.data
  if (!d1) return EMPTY_PANEL
  let rows: any[] = []
  try {
    const res: any = await d1.prepare(
      `SELECT orderable_part_number AS opn, generic_part_number AS gpn,
              substr(captured_at,1,10) AS date, normalized_unit_price AS price
         FROM ti_inventory_price_snapshot
        WHERE captured_at >= ? AND normalized_unit_price IS NOT NULL AND normalized_unit_price > 0
        ORDER BY captured_at ASC`,
    ).bind(PANEL_TRUSTED_FIRST).all()
    rows = res?.results ?? []
  } catch { return EMPTY_PANEL }
  // Last price per (opn, date); ascending order means later captures overwrite.
  const byPart: Record<string, { gpn: string | null; days: Record<string, number> }> = {}
  let lastDate: string | null = null
  for (const r of rows) {
    const price = Number(r.price)
    if (!r.opn || !r.date || !(price > 0)) continue
    const p = (byPart[r.opn] ||= { gpn: r.gpn ?? null, days: {} })
    p.days[r.date] = price
    if (!lastDate || r.date > lastDate) lastDate = r.date
  }
  // Hydrate descriptions from the 72k catalog so the canonical mapping matches
  // the broad pipeline exactly. The panel table has no description column, and
  // mapping with description:null misfiled every reinforced isolator into
  // isolation_digital (the only description-gated rule can never fire).
  const opns = Object.keys(byPart)
  const descByOpn: Record<string, string | null> = {}
  if (opns.length) {
    try {
      const placeholders = opns.map(() => '?').join(',')
      const dres: any = await d1.prepare(
        `SELECT ti_part_number AS opn, description FROM ti_catalog_latest_opn
          WHERE ti_part_number IN (${placeholders})`,
      ).bind(...opns).all()
      for (const r of dres?.results ?? []) descByOpn[r.opn] = r.description ?? null
    } catch { /* descriptions unavailable → mapping falls back to gpn/opn rules */ }
  }
  const subs: PanelLfl['subs'] = {}
  for (const opn of opns) {
    const sub = mapOpnToCanonical({ gpn: byPart[opn].gpn, opn, description: descByOpn[opn] ?? null })?.canonicalSubcategory
    if (!sub) continue
    const pts = Object.keys(byPart[opn].days).sort().map(date => ({ date, price: byPart[opn].days[date] }))
    if (pts.length) ((subs[sub] ||= {})[opn] = pts)
  }
  const out: PanelLfl = { subs, lastDate }
  _panelCache = { at: Date.now(), data: out }
  return out
}

function priceAt(pts: PanelPoint[], date: string): number | null {
  let ans: number | null = null
  for (const p of pts) { if (p.date <= date) ans = p.price; else break }
  return ans
}
/** Backward at-or-before; if the boundary predates the part's history by no
 *  more than START_SNAP_DAYS, snap forward to its first price (sticky list
 *  prices make a ≤5-day proxy safe). */
function priceAtStart(pts: PanelPoint[], date: string): number | null {
  const p = priceAt(pts, date)
  if (p != null) return p
  const first = pts[0]
  if (first && daysBetween(date, first.date) <= START_SNAP_DAYS) return first.price
  return null
}

/** Matched-pairs equal-weight geometric-mean move over panel parts priced at
 *  both boundaries. Mix/stock cannot move it; only real price changes do.
 *  Returns null when the panel feed is STALE for this row (row end more than
 *  PANEL_MAX_STALE_DAYS past the last capture) — a dead daily feed must
 *  surface as "—", never as a confident carried-forward 0.00%. */
export function panelLflMove(
  panel: PanelLfl, sub: string, startDate: string, endDate: string,
): { pct: number; n: number } | null {
  const parts = panel.subs[sub]
  if (!parts || !panel.lastDate) return null
  if ((dayNum(endDate) - dayNum(panel.lastDate)) / 86400000 > PANEL_MAX_STALE_DAYS) return null
  let sumLn = 0, n = 0
  for (const opn of Object.keys(parts)) {
    const s = priceAtStart(parts[opn], startDate)
    const e = priceAt(parts[opn], endDate)
    if (s == null || e == null || s <= 0 || e <= 0) continue
    sumLn += Math.log(e / s)
    n += 1
  }
  if (n < MIN_PARTS) return null
  return { pct: (Math.exp(sumLn / n) - 1) * 100, n }
}

/** Override cells whose row the broad weighted series cannot date: a broad
 *  point must sit within BROAD_SLACK_DAYS of BOTH boundaries for broad to own
 *  the row; otherwise the daily panel (if it has ≥2 matched parts) does. */
export function applyPanelGapOverride(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  panel: PanelLfl,
  broad: WeightedSeries,
  liveAsOf: string,
): { overridden: number } {
  let overridden = 0
  for (const col of result.columns) {
    const sub = col.canonicalId
    if (!panel.subs[sub]) continue
    for (let i = 1; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = result.rows[i - 1].periodEnd
      if (!startDate || !endDate) continue
      if (endDate < OVERLAY_EARLIEST) continue // pre-coverage history — skip cheaply
      if (broadOwnsRow(broad[sub], startDate, endDate)) continue // broad owns the row — panel never second-guesses it
      const mv = panelLflMove(panel, sub, startDate, endDate)
      if (!mv) continue
      row.cells[sub] = {
        ...row.cells[sub],
        pct: mv.pct,
        breakdown: {
          todayUSD: null, todayDate: endDate, todayLabel: 'Daily capture',
          anchorUSD: null, anchorDate: startDate, anchorLabel: 'Daily capture',
          latestSource: 'ti_inventory',
          representativePartUsed: `Like-for-like · ${mv.n} daily-tracked parts (bridges weeks the weekly catalog can't date yet)`,
        },
      }
      overridden += 1
    }
  }
  return { overridden }
}
