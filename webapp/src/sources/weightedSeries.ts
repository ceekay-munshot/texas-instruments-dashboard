// Phase 27.5 — weighted-ASP period moves via LIKE-FOR-LIKE (fixed-weight) diffs.
//
// Why like-for-like: a plain stock-weighted ASP moves with BOTH price and
// stock/mix. In the thin 74-part panel one expensive, high-stock part
// dominates, so when its *stock* changes (not its price) the ASP swings wildly
// (e.g. ADS54J60 @ $832 dropping 625→300 units made ADC read −45% with zero
// repricing). That's noise, not a price move.
//
// Fix: for each period we compute the move over the parts present at BOTH
// boundary dates, using the START-date stock as a FIXED weight. So only
// genuine price changes move the number; stock/mix changes cancel out. This is
// the same idea as UBS's like-for-like index.
//
// Sources, auto-switched per subcategory:
//   • daily  — the 74-part watched panel (per-part price+qty), like-for-like.
//              The bridge that makes WoW/MoM move now.
//   • weekly — the broad 72k catalog ASP series (rollup_history). Preferred
//              once it has ≥2 points (going-forward). NOTE: weekly is the
//              aggregate ASP only (no per-OPN history yet), so its move is raw
//              ASP (mix-affected) until per-OPN catalog history exists — a
//              later upgrade. For QoQ-scale moves that's fine.
//
// Periods whose start predates the series are left untouched (keep the
// UBS-derived historical value), so the blend at the data edge is automatic.

import { mapOpnToCanonical } from './tiCatalogMapping'

type PricePoint = { date: string; price: number; qty: number }
export type DailyPartData = Record<string, Record<string, PricePoint[]>> // subcat -> part -> asc points
export type WeightedSeries = Record<string, { date: string; asp: number }[]>

type D1Like = { prepare: (sql: string) => any } | null

// ── Per-part daily data from the 74-part watched panel ──────────────────────
export async function buildDailyPartData(d1: D1Like): Promise<DailyPartData> {
  const out: DailyPartData = {}
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

  // One (price, qty) per (subcat, part, day) — last capture of the day wins.
  const tmp: Record<string, Record<string, Record<string, { price: number; qty: number }>>> = {}
  for (const r of rows) {
    const price = Number(r.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const subcat = mapOpnToCanonical({ gpn: r.gpn, opn: r.opn })?.canonicalSubcategory
    if (!subcat) continue
    const part = String(r.opn)
    ;((tmp[subcat] ||= {})[part] ||= {})[r.day] = { price, qty: Number(r.qty) || 0 }
  }
  for (const subcat of Object.keys(tmp)) {
    out[subcat] = {}
    for (const part of Object.keys(tmp[subcat])) {
      const pts: PricePoint[] = Object.keys(tmp[subcat][part]).sort()
        .map(day => ({ date: day, ...tmp[subcat][part][day] }))
      if (pts.length) out[subcat][part] = pts
    }
  }
  return out
}

// ── Weekly broad-catalog ASP series ─────────────────────────────────────────
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

function pointAtOrBefore(pts: PricePoint[] | undefined, date: string): PricePoint | null {
  if (!pts || !pts.length) return null
  let ans: PricePoint | null = null
  for (const p of pts) { if (p.date <= date) ans = p; else break }
  return ans
}

function aspAtOrBefore(pts: { date: string; asp: number }[] | undefined, date: string): number | null {
  if (!pts || !pts.length) return null
  let ans: number | null = null
  for (const p of pts) { if (p.date <= date) ans = p.asp; else break }
  return ans
}

type Move = { pct: number; startUSD: number; endUSD: number }

// Like-for-like move over the daily panel: fixed (start-date) weights, only
// parts priced at BOTH boundaries. Returns null if the basket is empty.
function dailyMove(sub: Record<string, PricePoint[]> | undefined, startDate: string, endDate: string): Move | null {
  if (!sub) return null
  let wNum = 0, wDen = 0, wTot = 0   // stock-weighted: Σ(p·w)
  let eStart = 0, eEnd = 0, n = 0    // equal-weight fallback: mean price
  for (const part of Object.keys(sub)) {
    const a = pointAtOrBefore(sub[part], startDate)
    const b = pointAtOrBefore(sub[part], endDate)
    if (!a || !b) continue // like-for-like: must exist at both ends
    const w = a.qty // FIXED weight = stock at the start boundary
    if (w > 0) { wNum += b.price * w; wDen += a.price * w; wTot += w }
    eStart += a.price; eEnd += b.price; n += 1
  }
  if (wTot > 0 && wDen > 0) {
    const endUSD = wNum / wTot, startUSD = wDen / wTot
    return { pct: (endUSD - startUSD) / startUSD * 100, startUSD, endUSD }
  }
  if (n > 0 && eStart > 0) {
    const startUSD = eStart / n, endUSD = eEnd / n
    return { pct: (endUSD - startUSD) / startUSD * 100, startUSD, endUSD }
  }
  return null
}

// Weekly broad move: raw ASP diff (mix-affected until per-OPN history exists).
function weeklyMove(series: { date: string; asp: number }[] | undefined, startDate: string, endDate: string): Move | null {
  const s = aspAtOrBefore(series, startDate), e = aspAtOrBefore(series, endDate)
  if (s == null || e == null || s <= 0) return null
  return { pct: (e - s) / s * 100, startUSD: s, endUSD: e }
}

export function applyWeightedSeriesOverride(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  daily: DailyPartData,
  weekly: WeightedSeries,
  liveAsOf: string,
): { overridden: number } {
  let overridden = 0
  for (const col of result.columns) {
    const sub = col.canonicalId
    const useWeekly = !!(weekly[sub] && weekly[sub].length >= 2)
    if (!useWeekly && !daily[sub]) continue
    const label = useWeekly ? 'Stock-weighted ASP (72k catalog)' : 'Like-for-like (daily panel)'
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = i > 0 ? result.rows[i - 1].periodEnd : null
      if (!startDate) continue
      const m = useWeekly ? weeklyMove(weekly[sub], startDate, endDate) : dailyMove(daily[sub], startDate, endDate)
      if (!m) continue
      row.cells[sub] = {
        ...row.cells[sub],
        pct: m.pct,
        breakdown: {
          todayUSD: m.endUSD, todayDate: endDate, todayLabel: 'Latest capture',
          anchorUSD: m.startUSD, anchorDate: startDate, anchorLabel: 'Historical baseline',
          latestSource: 'ti_inventory', representativePartUsed: label,
        },
      }
      overridden += 1
    }
  }
  return { overridden }
}
