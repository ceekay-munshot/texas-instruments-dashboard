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

// Like-for-like move over the thin daily panel. The panel is dominated by a
// few expensive parts, so we EQUAL-WEIGHT per part (mean of each part's price
// relative) — a 20% move in a $2 part counts the same as in an $800 part. Two
// guards keep the thin basket honest:
//   • per-part outlier cap (±50%): a single part's implausible jump (list
//     reset / capture glitch) is excluded, not allowed to define the category.
//   • require ≥2 like-for-like parts: single-part subcategories (e.g. a lone
//     GaN SKU) fall through to the stopgap instead of showing a raw step.
function dailyMove(sub: Record<string, PricePoint[]> | undefined, startDate: string, endDate: string): Move | null {
  if (!sub) return null
  const rels: number[] = []
  let startPriceSum = 0
  for (const part of Object.keys(sub)) {
    const a = pointAtOrBefore(sub[part], startDate)
    const b = pointAtOrBefore(sub[part], endDate)
    if (!a || !b || a.price <= 0) continue // like-for-like: priced at both ends
    const rel = b.price / a.price
    if (rel < 0.5 || rel > 1.5) continue // per-part outlier guard
    rels.push(rel)
    startPriceSum += a.price
  }
  if (rels.length < 2) return null // need ≥2 parts; else keep the stopgap
  const meanRel = rels.reduce((s, r) => s + r, 0) / rels.length
  const startUSD = startPriceSum / rels.length
  const endUSD = startUSD * meanRel // keeps the receipt's (end−start)/start == pct
  return { pct: (meanRel - 1) * 100, startUSD, endUSD }
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
