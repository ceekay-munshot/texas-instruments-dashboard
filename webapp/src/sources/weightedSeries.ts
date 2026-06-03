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

export async function buildWeightedSeries(d1: D1Like): Promise<WeightedSeries> {
  const byDate: Record<string, Record<string, number>> = {}
  if (d1) {
    try {
      const res: any = await d1.prepare(
        `SELECT canonical_subcategory AS sub, substr(captured_at,1,10) AS date,
                asp_stock_weighted AS asp
           FROM ti_catalog_rollup_history
          WHERE asp_stock_weighted IS NOT NULL
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
  return out
}

/** The series point at-or-before `date` (series is ascending). */
export function weightedAt(pts: SeriesPoint[] | undefined, date: string): SeriesPoint | null {
  if (!pts || !pts.length) return null
  let ans: SeriesPoint | null = null
  for (const p of pts) { if (p.date <= date) ans = p; else break }
  return ans
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
    const hasSeries = !!(pts && pts.length)
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = i > 0 ? result.rows[i - 1].periodEnd : null
      if (!startDate) continue
      if (hasSeries) {
        const e = weightedAt(pts, endDate)
        const s = weightedAt(pts, startDate)
        if (!e || !s || s.asp <= 0) continue // a boundary predates the series → keep existing value
        row.cells[sub] = {
          ...row.cells[sub],
          pct: ((e.asp - s.asp) / s.asp) * 100,
          breakdown: {
            todayUSD: e.asp, todayDate: e.date, todayLabel: 'Latest capture',
            anchorUSD: s.asp, anchorDate: s.date, anchorLabel: 'Historical baseline',
            latestSource: 'ti_inventory', representativePartUsed: 'Stock-weighted ASP (72k catalog)',
          },
        }
        overridden += 1
      } else if (endDate >= HANDOFF_DATE) {
        // No broad weighted series for this subcategory (e.g. a lone GaN SKU
        // the hygiene filter leaves unpriced). Its post-handoff cells come from
        // the untrustworthy single-part path — blank them ("—") rather than
        // surface a single SKU's step as a category move. Pre-handoff rows keep
        // their historical value.
        row.cells[sub] = { ...row.cells[sub], pct: null, breakdown: undefined }
      }
    }
  }
  return { overridden }
}
