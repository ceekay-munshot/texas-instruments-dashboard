// Phase 27.4 — weighted-ASP time series + WoW/MoM/QoQ from period-boundary diffs.
//
// The fix to "everything reads 0%": stop anchoring to a single fixed point.
// Instead keep a weighted-ASP TIME SERIES per subcategory and compute each
// period's move as (weighted @ period-end − weighted @ period-start) / start.
//
// Two sources, auto-switched per subcategory:
//   • weekly — the broad 72k catalog (ti_catalog_rollup_history.asp_stock_weighted),
//              one point per Sunday ingest. Preferred once it has ≥ 2 points
//              (the going-forward source).
//   • daily  — the 74-part watched panel (ti_inventory_price_snapshot),
//              stock-weighted per subcategory per day. The bridge that makes
//              WoW/MoM move TODAY until the weekly series is deep enough.
//
// Periods whose start predates the series are left untouched, so the
// UBS-derived historical rows keep their existing (correct) values — the
// blend happens automatically at the data edge.

import { mapOpnToCanonical } from './tiCatalogMapping'

export type SeriesPoint = { date: string; asp: number }
export type WeightedSeries = Record<string, SeriesPoint[]> // subcat -> points ascending by date

type D1Like = { prepare: (sql: string) => any } | null

// ── Daily series from the 74-part watched panel ─────────────────────────────
export async function buildDailyWeightedSeries(d1: D1Like): Promise<WeightedSeries> {
  const out: WeightedSeries = {}
  if (!d1) return out
  let rows: any[] = []
  try {
    const res: any = await d1.prepare(
      `SELECT orderable_part_number AS opn, generic_part_number AS gpn,
              substr(captured_at,1,10) AS day,
              normalized_unit_price AS price, quantity_available AS qty
         FROM ti_inventory_price_snapshot
        WHERE normalized_unit_price IS NOT NULL
        ORDER BY captured_at ASC`,
    ).all()
    rows = res?.results ?? []
  } catch { return out }

  // One (price, qty) per (part, day) — last capture of the day wins (asc order).
  const perPartDay = new Map<string, { subcat: string; price: number; qty: number }>()
  for (const r of rows) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const subcat = mapOpnToCanonical({ gpn: r.gpn, opn: r.opn })?.canonicalSubcategory
    if (!subcat) continue
    perPartDay.set(`${r.opn}|${r.day}`, { subcat, price, qty: Number(r.qty) || 0 })
  }

  // Aggregate per (subcat, day): stock-weighted; equal-weight fallback when the
  // day's parts are all out of stock (so a flat-but-zero-stock day still posts).
  const acc: Record<string, Record<string, { pq: number; q: number; sum: number; n: number }>> = {}
  for (const [key, v] of perPartDay) {
    const day = key.split('|')[1]
    const byDay = (acc[v.subcat] ||= {})
    const a = (byDay[day] ||= { pq: 0, q: 0, sum: 0, n: 0 })
    a.pq += v.price * v.qty
    a.q += v.qty
    a.sum += v.price
    a.n += 1
  }
  for (const subcat of Object.keys(acc)) {
    const pts: SeriesPoint[] = []
    for (const day of Object.keys(acc[subcat]).sort()) {
      const a = acc[subcat][day]
      const asp = a.q > 0 ? a.pq / a.q : a.n > 0 ? a.sum / a.n : NaN
      if (Number.isFinite(asp) && asp > 0) pts.push({ date: day, asp: Math.round(asp * 10000) / 10000 })
    }
    if (pts.length) out[subcat] = pts
  }
  return out
}

// ── Weekly series from the broad 72k catalog rollups ────────────────────────
export async function buildWeeklyWeightedSeries(d1: D1Like): Promise<WeightedSeries> {
  const out: WeightedSeries = {}
  if (!d1) return out
  try {
    const res: any = await d1.prepare(
      `SELECT canonical_subcategory AS subcat, substr(captured_at,1,10) AS date,
              asp_stock_weighted AS asp
         FROM ti_catalog_rollup_history
        WHERE asp_stock_weighted IS NOT NULL
        ORDER BY captured_at ASC`,
    ).all()
    for (const r of res?.results ?? []) {
      const asp = Number(r.asp)
      if (!Number.isFinite(asp) || asp <= 0) continue
      ;(out[r.subcat] ||= []).push({ date: r.date, asp })
    }
  } catch { /* leave empty */ }
  return out
}

/** Weighted ASP at-or-before `date` (series sorted ascending). */
export function weightedAt(pts: SeriesPoint[] | undefined, date: string): number | null {
  if (!pts || !pts.length) return null
  let ans: number | null = null
  for (const p of pts) {
    if (p.date <= date) ans = p.asp
    else break
  }
  return ans
}

/** Override each cell's pct with the weighted-series move between consecutive
 *  period boundaries. Auto-switches to the weekly 72k series once it has ≥2
 *  points; otherwise uses the daily 74-part panel. Cells whose period-start
 *  predates the chosen series are left untouched (keep the historical value). */
export function applyWeightedSeriesOverride(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  daily: WeightedSeries,
  weekly: WeightedSeries,
  liveAsOf: string,
): { overridden: number; sourceBySub: Record<string, 'weekly' | 'daily'> } {
  let overridden = 0
  const sourceBySub: Record<string, 'weekly' | 'daily'> = {}
  for (const col of result.columns) {
    const sub = col.canonicalId
    const useWeekly = !!(weekly[sub] && weekly[sub].length >= 2)
    const series = useWeekly ? weekly[sub] : daily[sub]
    if (!series || series.length < 1) continue
    sourceBySub[sub] = useWeekly ? 'weekly' : 'daily'
    const label = useWeekly ? 'Stock-weighted ASP (72k catalog)' : 'Stock-weighted ASP (daily panel)'
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = i > 0 ? result.rows[i - 1].periodEnd : null
      if (!startDate) continue
      const wEnd = weightedAt(series, endDate)
      const wStart = weightedAt(series, startDate)
      if (wEnd == null || wStart == null || wStart <= 0) continue
      const pct = ((wEnd - wStart) / wStart) * 100
      row.cells[sub] = {
        ...row.cells[sub],
        pct,
        breakdown: {
          todayUSD: wEnd,
          todayDate: endDate,
          todayLabel: 'Latest capture',
          anchorUSD: wStart,
          anchorDate: startDate,
          anchorLabel: 'Historical baseline',
          latestSource: 'ti_inventory',
          representativePartUsed: label,
        },
      }
      overridden += 1
    }
  }
  return { overridden, sourceBySub }
}
