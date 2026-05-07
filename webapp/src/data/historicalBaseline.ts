// Historical baseline series for the 28 TI subcategories.
//
// Two anchor strategies:
//  • "series" — subcategory has weekly historical data going back to Sept-2021.
//    Stored as normalized index values (base 100 ≈ 2021-09-04).
//  • "anchor" — subcategory has only a single Feb-27-2026 baseline price (USD).
//    The pre-May-2-2026 view is a flat carry-forward of that anchor.
//
// All 28 subcategories produce a `(date → indexValue)` series via
// `resolveHistoricalIndex`. % changes between any two dates are computed
// directly off the index values.

import historicalSeriesJson from './historicalSeries.json'

type SeriesPoint = [string, number]

const HISTORICAL_SERIES: Record<string, SeriesPoint[]> = (
  historicalSeriesJson as { series: Record<string, SeriesPoint[]> }
).series

export const HISTORICAL_SERIES_FIRST_DATE = (historicalSeriesJson as { baseDate: string }).baseDate
export const HISTORICAL_SERIES_LAST_DATE = '2026-04-11'
export const OWN_CAPTURE_FIRST_DATE = '2026-05-02'
export const FEB27_ANCHOR_DATE = '2026-02-27'

// Map each canonical subcategory id to its baseline source.
//   kind='series'   → look up index in HISTORICAL_SERIES[seriesId]
//   kind='anchor'   → flat anchor price (USD); pre-May-2 the index is 100,
//                     post-May-2 the index = 100 × (live_usd / anchor_usd).
export type BaselineMapping =
  | { kind: 'series'; seriesId: string }
  | { kind: 'anchor'; anchorUSD: number }

export const SUB_TO_BASELINE: Record<string, BaselineMapping> = {
  // — 6 direct subcategory matches —
  power_ldo:              { kind: 'series', seriesId: 'lin_vr' },
  amp_opamps:             { kind: 'series', seriesId: 'amp_op' },
  amp_audio:              { kind: 'series', seriesId: 'amp_audio' },
  conv_adc:               { kind: 'series', seriesId: 'adc' },
  conv_dac:               { kind: 'series', seriesId: 'dac' },
  mcu_msp430:             { kind: 'series', seriesId: 'mcu_16bit' },

  // — 13 lumped (share a broader bucket's series) —
  power_acdc_switching:   { kind: 'series', seriesId: 'switching_vr' },
  power_dcdc_switching:   { kind: 'series', seriesId: 'switching_vr' },
  mcu_c2000:              { kind: 'series', seriesId: 'mcu_32bit' },
  mcu_mspm0:              { kind: 'series', seriesId: 'mcu_32bit' },
  mcu_simplelink:         { kind: 'series', seriesId: 'mcu_32bit' },
  mcu_sitara:             { kind: 'series', seriesId: 'mcu_32bit' },
  power_supervisor_reset: { kind: 'series', seriesId: 'other_pm' },
  power_battery_mgmt:     { kind: 'series', seriesId: 'other_pm' },
  dc_48v_bus:             { kind: 'series', seriesId: 'other_pm' },
  dc_smart_power_stages:  { kind: 'series', seriesId: 'other_pm' },
  dc_efuses:              { kind: 'series', seriesId: 'other_pm' },
  dc_hotswap:             { kind: 'series', seriesId: 'other_pm' },
  dc_tps536xx_ai_power:   { kind: 'series', seriesId: 'other_pm' },

  // — 9 extras anchored to original Feb-27-2026 Mouser qty=1 baseline (USD) —
  amp_instrumentation:    { kind: 'anchor', anchorUSD: 3.6366 },
  interface_can:          { kind: 'anchor', anchorUSD: 2.6898 },
  interface_lin:          { kind: 'anchor', anchorUSD: 1.6784 },
  interface_ethernet_phy: { kind: 'anchor', anchorUSD: 7.7789 },
  isolation_digital:      { kind: 'anchor', anchorUSD: 3.2816 },
  isolation_reinforced:   { kind: 'anchor', anchorUSD: 7.2625 },
  gan_lmg342x:            { kind: 'anchor', anchorUSD: 29.1792 },
  gan_lmg3650:            { kind: 'anchor', anchorUSD: 9.5758 },
  gan_lmg5200:            { kind: 'anchor', anchorUSD: 18.2692 },
}

// Resolve the historical index value for a subcategory at a given date
// (calendar date in YYYY-MM-DD form). Returns null if the date predates the
// subcategory's first available baseline.
//
// Series subcategories: take the closest weekly point at-or-before `dateISO`,
// then carry forward up to OWN_CAPTURE_FIRST_DATE (the bridge).
// Anchor subcategories: index = 100 for any date ≥ FEB27_ANCHOR_DATE and
// < OWN_CAPTURE_FIRST_DATE; null before Feb-27.
export function resolveHistoricalIndex(subId: string, dateISO: string): number | null {
  const m = SUB_TO_BASELINE[subId]
  if (!m) return null

  if (m.kind === 'series') {
    const points = HISTORICAL_SERIES[m.seriesId]
    if (!points || points.length === 0) return null
    if (dateISO < points[0][0]) return null
    // For dates after the last weekly point but before our own captures begin,
    // carry forward the last historical value.
    if (dateISO >= HISTORICAL_SERIES_LAST_DATE) {
      return points[points.length - 1][1]
    }
    let lo = 0, hi = points.length - 1, ans = points[0][1]
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      if (points[mid][0] <= dateISO) { ans = points[mid][1]; lo = mid + 1 }
      else hi = mid - 1
    }
    return ans
  }

  // anchor kind — pre-Feb-27 we have no signal
  if (dateISO < FEB27_ANCHOR_DATE) return null
  return 100
}

// Original Feb-27-2026 Mouser qty=1 USD baseline prices for all 28 subs.
// These are the source-of-truth anchors that pin live USD captures to the
// historical index for both `series` and `anchor` subcategories.
export const FEB27_BASELINES_USD: Record<string, number> = {
  power_ldo:              6.8752,
  power_acdc_switching:   1.9582,
  power_dcdc_switching:   5.7562,
  power_supervisor_reset: 0.8177,
  power_battery_mgmt:     5.2398,
  amp_opamps:             2.1303,
  amp_instrumentation:    3.6366,
  amp_audio:              1.9366,
  conv_adc:               5.5087,
  conv_dac:              21.4540,
  interface_can:          2.6898,
  interface_lin:          1.6784,
  interface_ethernet_phy: 7.7789,
  isolation_digital:      3.2816,
  isolation_reinforced:   7.2625,
  mcu_msp430:             4.7879,
  mcu_c2000:             15.6117,
  mcu_mspm0:              2.5392,
  mcu_simplelink:         7.2841,
  mcu_sitara:            17.6667,
  gan_lmg342x:           29.1792,
  gan_lmg3650:            9.5758,
  gan_lmg5200:           18.2692,
  dc_48v_bus:             4.8740,
  dc_smart_power_stages: 14.2990,
  dc_efuses:              2.6898,
  dc_hotswap:             4.9492,
  dc_tps536xx_ai_power:  12.9327,
}

// Look up the historical series index value at-or-before Feb-27-2026 — the
// pivot point we use to convert live USD captures into index values.
export function indexAtFeb27(seriesId: string): number | null {
  const pts = HISTORICAL_SERIES[seriesId]
  if (!pts || pts.length === 0) return null
  let v = pts[0][1]
  for (const [d, val] of pts) {
    if (d <= FEB27_ANCHOR_DATE) v = val
    else break
  }
  return v
}

// Look up the historical baseline point at-or-before a given calendar date
// for a series-kind subcategory. Returns both the index value AND the actual
// data-point date — the receipt shows that date verbatim ("Historical baseline
// (Mar 28, 2026)" rather than the period-anchor target like "Mar 31").
//
// Returns null for anchor-kind subs (no baseline series) or for dates that
// predate the bundled series.
export function resolveHistoricalPoint(
  canonicalId: string,
  dateISO: string,
): { index: number; date: string } | null {
  const m = SUB_TO_BASELINE[canonicalId]
  if (!m || m.kind !== 'series') return null
  const points = HISTORICAL_SERIES[m.seriesId]
  if (!points || points.length === 0) return null
  if (dateISO < points[0][0]) return null
  let lo = 0
  let hi = points.length - 1
  let ans = points[0]
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid][0] <= dateISO) { ans = points[mid]; lo = mid + 1 }
    else hi = mid - 1
  }
  return { index: ans[1], date: ans[0] }
}

// Convert a captured live USD price for a subcategory to an index value
// continuous with the historical series.
//
// Strategy (same shape for both `series` and `anchor` subs):
//   index_live = anchorIndex × (liveUSD / anchorUSD_feb27)
//
// where:
//   • series subs:  anchorIndex = UBS index at Feb-27 (e.g. ~106.68 for LDO),
//                   anchorUSD   = Feb-27 Mouser qty=1 USD price.
//   • anchor subs:  anchorIndex = 100,
//                   anchorUSD   = Feb-27 Mouser qty=1 USD price.
//
// Result: live USD movement vs Feb-27 compounds off the historical anchor,
// so "today's index" reflects real captured price drift from late February.
export function indexFromLiveUSD(subId: string, liveUSD: number): number | null {
  const m = SUB_TO_BASELINE[subId]
  if (!m || liveUSD <= 0) return null
  const anchorUSD = FEB27_BASELINES_USD[subId]
  if (!anchorUSD || anchorUSD <= 0) return null

  if (m.kind === 'anchor') {
    return (liveUSD / anchorUSD) * 100
  }

  const anchorIdx = indexAtFeb27(m.seriesId)
  if (anchorIdx == null) return null
  return anchorIdx * (liveUSD / anchorUSD)
}
