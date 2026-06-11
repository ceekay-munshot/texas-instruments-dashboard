// Phase 27.6 — broad weighted-ASP series engine (automatic, self-building).
//
// Reads the per-subcategory weighted-ASP TIME SERIES from
// ti_catalog_rollup_history (one point per weekly 72k-catalog capture) and
// computes WoW/MoM/QoQ as the move between each period's two boundaries:
//   pct = (weighted @ period-end − weighted @ period-start) / period-start
//
// Fully automatic: every weekly catalog ingest's `finalize` step rebuilds the
// rollups (computing asp_stock_weighted) AND appends a fresh history point — so
// the series, and therefore the displayed moves, grow on their own with zero
// manual steps. As more weekly points land, more cells fill in.
//
// Auto-blend: a row is only overridden when BOTH its boundaries fall on real
// series points. Rows whose start predates the series (e.g. pre-May-2026 closed
// quarters) keep their existing UBS-derived historical value, so the seam at
// the data edge is invisible.
//
// Broad-only by design: this uses the full 72k stock-weighted catalog, not the
// thin 74-part daily panel (which was too dominated by single parts to be
// trustworthy). The trade-off is that movement only appears once two captures
// span a period — which, for sticky list prices, is the honest behaviour.

import { HANDOFF_WEIGHTED_ASP } from '../data/historicalBaseline'

export type SeriesPoint = { date: string; asp: number }
export type WeightedSeries = Record<string, SeriesPoint[]> // subcat -> points ascending by date
type D1Like = { prepare: (sql: string) => any } | null

// The May-4-2026 catalog snapshot the handoff seed was computed from. We inject
// it as the series' first point IN CODE — the asp_stock_weighted column was
// added after that capture, so the DB never stored a complete May-4 baseline,
// but we saved the computed values in HANDOFF_WEIGHTED_ASP. No DB mutation
// needed; every capture from here on appends real points to rollup_history.
const HANDOFF_DATE = '2026-05-04'

// Phase 28.4 — per-isolate result cache. The series changes at most weekly
// (one capture appends one point) but was rebuilt from D1 on EVERY request;
// on the 250-row WoW view that work helped push the Worker over its CPU
// limit (Cloudflare 1102). 5-minute TTL bounds staleness after a capture.
const CACHE_TTL_MS = 300_000
let _seriesCache: { at: number; data: WeightedSeries } | null = null

export async function buildWeightedSeries(d1: D1Like): Promise<WeightedSeries> {
  if (_seriesCache && Date.now() - _seriesCache.at < CACHE_TTL_MS) return _seriesCache.data
  const byDate: Record<string, Record<string, number>> = {}
  if (d1) {
    try {
      // Phase 28.3 — only history points BACKED BY A SUCCESSFUL CAPTURE count.
      // The 2026-06-03 point was rebuilt from a timed-out partial capture
      // (mostly stale May-4 prices, no snapshot_run row) and smeared 5 weeks
      // of moves into whichever row straddled it. parsed_ok runs only.
      const res: any = await d1.prepare(
        `SELECT canonical_subcategory AS sub, substr(captured_at,1,10) AS date,
                asp_stock_weighted AS asp
           FROM ti_catalog_rollup_history
          WHERE asp_stock_weighted IS NOT NULL
            AND substr(captured_at,1,10) IN (
              SELECT substr(captured_at,1,10) FROM ti_catalog_snapshot_run WHERE parsed_ok = 1)
          ORDER BY captured_at ASC`,
      ).all()
      for (const r of res?.results ?? []) {
        const asp = Number(r.asp)
        if (Number.isFinite(asp) && asp > 0) (byDate[r.sub] ||= {})[r.date] = asp
      }
    } catch { /* leave empty → no override */ }
  }
  // Seed the saved May-4 baseline (overrides any incomplete DB May-4 value).
  for (const sub of Object.keys(HANDOFF_WEIGHTED_ASP)) {
    const v = HANDOFF_WEIGHTED_ASP[sub]
    if (v > 0) (byDate[sub] ||= {})[HANDOFF_DATE] = v
  }
  const out: WeightedSeries = {}
  for (const sub of Object.keys(byDate)) {
    out[sub] = Object.keys(byDate[sub]).sort().map(date => ({ date, asp: byDate[sub][date] }))
  }
  _seriesCache = { at: Date.now(), data: out }
  return out
}

/** The series point at-or-before `date` (series is ascending). */
export function weightedAt(pts: SeriesPoint[] | undefined, date: string): SeriesPoint | null {
  if (!pts || !pts.length) return null
  let ans: SeriesPoint | null = null
  for (const p of pts) { if (p.date <= date) ans = p; else break }
  return ans
}

export const BROAD_SLACK_DAYS = 8 // a broad point within 8d of a boundary dates that boundary

// No overlay source reaches further back than this (panel starts 2026-05-02
// with a 5-day snap; the broad series starts 2026-05-04), so overlays skip
// older rows outright — on the 250-row WoW view that's ~97% of the grid.
export const OVERLAY_EARLIEST = '2026-04-20'

const dayMs = 86400000
// Date.parse memo — the same handful of boundary/point dates is parsed tens of
// thousands of times per WoW request; the map stays a few hundred entries.
const _dayNum = new Map<string, number>()
export function dayNum(d: string): number {
  let v = _dayNum.get(d)
  if (v === undefined) { v = Date.parse(d + 'T00:00:00Z'); _dayNum.set(d, v) }
  return v
}
function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((dayNum(b) - dayNum(a)) / dayMs))
}

/** True when the broad series can honestly MEASURE this row: a point sits
 *  within BROAD_SLACK_DAYS of BOTH boundaries. Without this, a sparse series
 *  attributes its whole inter-point move to whichever row straddles it (the
 *  May-8 hike showed as "May 30–Jun 5" / "MTD Jun"; the leftover showed as
 *  "WTD Jun 6–12"). Single source of truth for every overlay stage. */
export function broadOwnsRow(
  pts: SeriesPoint[] | undefined, startDate: string, endDate: string,
): { s: SeriesPoint; e: SeriesPoint } | null {
  const s = weightedAt(pts, startDate)
  const e = weightedAt(pts, endDate)
  if (!s || !e || s.asp <= 0) return null
  if (daysApart(s.date, startDate) > BROAD_SLACK_DAYS) return null
  if (daysApart(e.date, endDate) > BROAD_SLACK_DAYS) return null
  return { s, e }
}

/** Override each cell's % with the broad weighted move between its two period
 *  boundaries. Cells whose period-start predates the series are left untouched. */
export function applyWeightedSeriesOverride(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  series: WeightedSeries,
  liveAsOf: string,
): { overridden: number } {
  let overridden = 0
  for (const col of result.columns) {
    const sub = col.canonicalId
    const pts = series[sub]
    for (let i = 1; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = result.rows[i - 1].periodEnd
      if (!startDate) continue
      if (endDate < OVERLAY_EARLIEST) continue // pre-coverage history — skip cheaply
      // Phase 28.3 — only override rows the series can honestly MEASURE (a
      // point within BROAD_SLACK_DAYS of both boundaries). Rows it can't are
      // left for the daily-panel overlay or the trust-or-blank stage; rows
      // whose start predates the series keep their historical value there too.
      const own = broadOwnsRow(pts, startDate, endDate)
      if (!own) continue
      row.cells[sub] = {
        ...row.cells[sub],
        pct: ((own.e.asp - own.s.asp) / own.s.asp) * 100,
        breakdown: {
          todayUSD: own.e.asp, todayDate: own.e.date, todayLabel: 'Latest capture',
          anchorUSD: own.s.asp, anchorDate: own.s.date, anchorLabel: 'Historical baseline',
          latestSource: 'ti_inventory', representativePartUsed: 'Stock-weighted ASP (72k catalog)',
        },
      }
      overridden += 1
    }
  }
  return { overridden }
}
