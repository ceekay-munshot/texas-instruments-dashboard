// Multi-resolution trend series builder.
//
// Produces three views — WoW (weekly), MoM (monthly), QoQ (quarterly) — for
// all 28 canonical TI subcategories, stitching:
//   • historical baseline series (Sept-2021 → Apr-11-2026, weekly)
//   • carry-forward bridge (Apr-11 → May-2-2026)
//   • live captures (May-2-2026 onward)
//
// Each view returns rows ordered chronologically. The most recent row is the
// current incomplete period (WTD / MTD / QTD) — same shape as a closed row,
// just labelled `liveToDate: true`.

import {
  resolveHistoricalIndex,
  indexFromLiveUSD,
  SUB_TO_BASELINE,
  HISTORICAL_SERIES_FIRST_DATE,
  OWN_CAPTURE_FIRST_DATE,
} from '../data/historicalBaseline'
import { TI_TAXONOMY_FLAT } from '../data/tiTaxonomy'

export type ViewKind = 'wow' | 'mom' | 'qoq'

/** Receipt payload attached to live-row cells only. Powers the click-to-
 *  explain popover. Closed-row cells leave this undefined.
 *  When no valid anchor exists (subcategory has no own-capture and no
 *  historical baseline), the live cell omits `breakdown` entirely and
 *  renders blank — the cell is not clickable. */
export type LiveCellBreakdown = {
  todayUSD: number
  todayDate: string
  todayLabel: 'Latest capture'
  anchorUSD: number
  anchorDate: string
  anchorLabel: 'TI capture' | 'Historical baseline'
  /** Internal/debug-only — never rendered in the customer-facing receipt.
   *  Tells us which input fed the live USD: own captured TI inventory data
   *  (`ti_inventory`) or the /api/prices distributor mirror used when no TI
   *  inventory row exists for the representative SKU (`prices_fallback`). */
  latestSource?: 'ti_inventory' | 'prices_fallback'
  /** Internal/debug-only — the representative SKU actually used for this
   *  cell's USD math (today + splice + anchor lookups all use the same SKU). */
  representativePartUsed?: string
  /** Internal/debug-only — the ordered list of PART_MAP candidate SKUs the
   *  handler scanned for this subcategory. */
  candidatePartsChecked?: string[]
}

export type TrendCell = {
  /** Index value at this period boundary. */
  index: number | null
  /** % change vs the previous period boundary (or vs anchor for to-date rows). */
  pct: number | null
  /** Present only on the live to-date row. */
  breakdown?: LiveCellBreakdown
}

export type TrendRow = {
  /** Period-end ISO date. */
  periodEnd: string
  /** Display label, e.g. "Jun-22", "May-26", "Q2-26", "Wk Apr 28-May 2". */
  label: string
  /** True when this row represents the live, still-open period. */
  liveToDate: boolean
  /** True when both period boundaries fall in the carry-forward bridge window
   *  (between the last historical pulse Apr-11-2026 and our first own
   *  capture May-2-2026). Bridge rows render as 0% across all cells. */
  bridgeRow: boolean
  /** Cell per subcategory, keyed by canonical id. */
  cells: Record<string, TrendCell>
}

export type TrendView = {
  view: ViewKind
  /** Subcategory column order (canonical ids), grouped by parent. */
  columns: { canonicalId: string; label: string; groupId: string; groupLabel: string }[]
  rows: TrendRow[]
  /** When the live data was sampled (top-of-page timestamp). */
  liveAsOf: string
}

// ── Period boundary helpers ─────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}

/** Friday on or before the given UTC date — used as the WoW close. */
function fridayOnOrBefore(d: Date): Date {
  const out = new Date(d)
  const dow = out.getUTCDay() // 0=Sun..5=Fri..6=Sat
  const delta = dow >= 5 ? dow - 5 : dow + 2 // 5→0, 6→1, 0→2, 1→3..4→4
  out.setUTCDate(out.getUTCDate() - delta)
  return out
}

/** Last day of the month containing `d`. */
function monthEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

/** Last day of the quarter containing `d` (Mar-31, Jun-30, Sep-30, Dec-31). */
function quarterEnd(d: Date): Date {
  const m = d.getUTCMonth()
  const qEndMonth = Math.floor(m / 3) * 3 + 2
  return new Date(Date.UTC(d.getUTCFullYear(), qEndMonth + 1, 0))
}

function addDaysISO(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}

function fmtMonthShort(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`
}

function fmtQuarter(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `Q${q}-${String(d.getUTCFullYear()).slice(2)}`
}

function fmtWeek(end: Date): string {
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 6)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${months[start.getUTCMonth()]} ${start.getUTCDate()}–${end.getUTCDate()}`
  }
  return `${months[start.getUTCMonth()]} ${start.getUTCDate()}–${months[end.getUTCMonth()]} ${end.getUTCDate()}`
}

// ── Boundary generators ─────────────────────────────────────────────────────

/** All weekly period-ends from the first historical date through `today`. */
function weeklyBoundaries(today: Date, firstISO: string): Date[] {
  const out: Date[] = []
  // Anchor on the first weekly historical date (a Saturday in UBS data — but
  // we use Friday-on-or-before convention going forward for our schedule).
  let cur = fridayOnOrBefore(parseISO(firstISO))
  const end = fridayOnOrBefore(today)
  while (cur <= end) {
    out.push(new Date(cur))
    cur.setUTCDate(cur.getUTCDate() + 7)
  }
  return out
}

function monthlyBoundaries(today: Date, firstISO: string): Date[] {
  const out: Date[] = []
  let y = parseISO(firstISO).getUTCFullYear()
  let m = parseISO(firstISO).getUTCMonth()
  const endY = today.getUTCFullYear()
  const endM = today.getUTCMonth()
  while (y < endY || (y === endY && m <= endM)) {
    out.push(new Date(Date.UTC(y, m + 1, 0)))
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return out
}

function quarterlyBoundaries(today: Date, firstISO: string): Date[] {
  const out: Date[] = []
  const startD = parseISO(firstISO)
  let y = startD.getUTCFullYear()
  let qStart = Math.floor(startD.getUTCMonth() / 3) * 3
  const endY = today.getUTCFullYear()
  const endQ = Math.floor(today.getUTCMonth() / 3) * 3
  while (y < endY || (y === endY && qStart <= endQ)) {
    out.push(new Date(Date.UTC(y, qStart + 3, 0)))
    qStart += 3
    if (qStart > 9) { qStart = 0; y += 1 }
  }
  return out
}

// ── Index resolver across stitch ────────────────────────────────────────────

export type LiveSnapshot = Record<string, {
  canonicalId: string
  liveUSD: number
  /** ISO calendar date the live capture came from (e.g. "2026-05-07"). */
  liveDate: string
  /** Internal flag — see LiveCellBreakdown.latestSource. */
  latestSource?: 'ti_inventory' | 'prices_fallback'
  /** Internal — representative SKU used for the trend math this request. */
  representativePartUsed?: string
  /** Internal — candidate SKUs scanned, in PART_MAP order. */
  candidatePartsChecked?: string[]
}>

/** Anchor lookup result — what to compare today's price against. Provided
 *  by the caller (handler) so the trend module is DB-agnostic. Keyed by
 *  canonical subcategory id. Subcategories without a resolvable anchor are
 *  intentionally absent from this map; their live cells render blank. */
export type AnchorSnapshot = Record<string, {
  anchorUSD: number
  anchorDate: string
  anchorLabel: 'TI capture' | 'Historical baseline'
}>

/**
 * Resolve the index value for a subcategory at a given period-end date,
 * stitching historical → carry-forward → live.
 *
 * @param dateISO   period-end date
 * @param liveAsOf  date of the latest live capture (today)
 */
function resolveIndexAt(
  subId: string,
  dateISO: string,
  live: LiveSnapshot,
  liveAsOf: string,
): number | null {
  const liveEntry = live[subId]

  // Pre-historical floor: nothing.
  if (dateISO < HISTORICAL_SERIES_FIRST_DATE) {
    // For Feb-27 anchor subcategories, the floor is Feb-27; resolveHistoricalIndex
    // already returns null for earlier dates.
    return resolveHistoricalIndex(subId, dateISO)
  }

  // Within or after our own captures: blend.
  if (dateISO >= OWN_CAPTURE_FIRST_DATE) {
    if (!liveEntry) {
      // No live capture yet for this subcategory — fall back to the carried-
      // forward historical anchor.
      return resolveHistoricalIndex(subId, dateISO)
    }
    // Today (and any boundary on/after liveAsOf): use live USD.
    if (dateISO >= liveAsOf) {
      return indexFromLiveUSD(subId, liveEntry.liveUSD)
    }
    // Boundaries between OWN_CAPTURE_FIRST_DATE and today: in this v1 we
    // approximate with the latest live index (we don't yet retain per-day
    // captured prices at this layer). Once daily captures persist into D1
    // we can interpolate. For "to-date" rows the latest live is the right
    // value anyway.
    return indexFromLiveUSD(subId, liveEntry.liveUSD)
  }

  // Pre-capture period (historical or carry-forward bridge).
  return resolveHistoricalIndex(subId, dateISO)
}

// ── Public: build a view ────────────────────────────────────────────────────

export function buildTrendView(
  view: ViewKind,
  liveSnapshot: LiveSnapshot,
  liveAsOfISO: string,
  /** Per-canonical anchor data for the live row's USD math. Caller resolves
   *  via DB lookups + baseline cascade and passes the result. May be empty
   *  per-key — falls back to index-derived pct for that cell only. */
  anchorSnapshot: AnchorSnapshot = {},
  /** Phase 26 — frozen period snapshots keyed by `periodEnd → canonicalId`.
   *  When a closed-row cell has a matching snapshot, its `pct` and
   *  `breakdown` come from the snapshot instead of index math. This makes
   *  the closed cell clickable in the UI (same receipt as the live row)
   *  and freezes the value forever. */
  snapshotByPeriodCanonical: Record<string, Record<string, {
    pct: number
    todayUSD: number
    todayDate: string
    todayLabel: 'Latest capture'
    anchorUSD: number
    anchorDate: string
    anchorLabel: string
    latestSource?: string
    representativePartUsed?: string
  }>> = {},
): TrendView {
  const today = parseISO(liveAsOfISO)

  // Boundaries (closed periods): all but the last entry are closed; we then
  // append a synthetic "to-date" boundary at `today` for the live row.
  let boundaries: Date[]
  if (view === 'wow') boundaries = weeklyBoundaries(today, HISTORICAL_SERIES_FIRST_DATE)
  else if (view === 'mom') boundaries = monthlyBoundaries(today, HISTORICAL_SERIES_FIRST_DATE)
  else boundaries = quarterlyBoundaries(today, HISTORICAL_SERIES_FIRST_DATE)

  // Drop any boundary that lands in the future (after today).
  boundaries = boundaries.filter(d => d <= today)

  // For WoW: if today is itself a Friday, the boundary at today represents
  // the week that is about to close. Treat it as in-progress (not yet rolled
  // into history) so the live WTD row always renders. The prior Friday
  // becomes the most recently closed boundary.
  if (view === 'wow' && boundaries.length > 0 &&
      isoDate(boundaries[boundaries.length - 1]) === isoDate(today)) {
    boundaries.pop()
  }

  // The last boundary represents the most recently CLOSED period (e.g. last
  // Friday close, last month-end, last quarter-end). The live to-date row
  // always renders for WoW (when there's a prior closed boundary) so users
  // see "this week so far" regardless of which weekday it is.
  const lastClosed = boundaries[boundaries.length - 1]
  const isLiveOpen = !!lastClosed && (
    view === 'wow' ? true : isoDate(today) > isoDate(lastClosed)
  )

  const columns = TI_TAXONOMY_FLAT
    .filter(s => s.categoryId in SUB_TO_BASELINE)
    .map(s => ({
      canonicalId: s.categoryId,
      label: s.categoryLabel,
      groupId: s.groupId,
      groupLabel: s.groupLabel,
    }))

  const rows: TrendRow[] = []

  // Pre-compute index values at every boundary for every subcategory.
  const idxAt = (subId: string, d: Date) =>
    resolveIndexAt(subId, isoDate(d), liveSnapshot, liveAsOfISO)

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i]
    const prev = i > 0 ? boundaries[i - 1] : null
    const cells: Record<string, TrendCell> = {}
    const curISOForRow = isoDate(b)
    const snapshotForRow = snapshotByPeriodCanonical[curISOForRow] ?? {}
    for (const col of columns) {
      const cur = idxAt(col.canonicalId, b)
      const prevIdx = prev ? idxAt(col.canonicalId, prev) : null
      let pct: number | null = null
      if (cur != null && prevIdx != null && prevIdx > 0) {
        pct = ((cur - prevIdx) / prevIdx) * 100
      }
      // Phase 26 — if a frozen snapshot exists for this (period, sub),
      // it overrides both the pct and attaches a click-to-explain
      // breakdown so closed rows behave like the live row.
      const snap = snapshotForRow[col.canonicalId]
      if (snap) {
        cells[col.canonicalId] = {
          index: cur,
          pct: snap.pct,
          breakdown: {
            todayUSD: snap.todayUSD,
            todayDate: snap.todayDate,
            todayLabel: 'Latest capture',
            anchorUSD: snap.anchorUSD,
            anchorDate: snap.anchorDate,
            anchorLabel: snap.anchorLabel as LiveCellBreakdown['anchorLabel'],
            latestSource: snap.latestSource as LiveCellBreakdown['latestSource'],
            representativePartUsed: snap.representativePartUsed,
          },
        }
      } else {
        cells[col.canonicalId] = { index: cur, pct }
      }
    }
    // A "bridge" row is one where BOTH endpoints fall strictly inside the
    // carry-forward window (between the last historical pulse and our first
    // own capture). Such rows produce 0% movement on every cell because
    // both endpoints resolve to the same carried-forward anchor.
    const prevISO = prev ? isoDate(prev) : null
    const curISO = isoDate(b)
    const bridgeRow = !!(
      prevISO && prevISO > '2026-04-11' && curISO < '2026-05-02'
    )
    rows.push({
      periodEnd: curISO,
      label:
        view === 'wow' ? fmtWeek(b)
        : view === 'mom' ? fmtMonthShort(b)
        : fmtQuarter(b),
      liveToDate: false,
      bridgeRow,
      cells,
    })
  }

  // Append live to-date row if the current period is still open.
  // The live row's pct is computed in pure USD against caller-supplied anchors
  // (resolved via TI inventory cascade), and a `breakdown` is attached for
  // the click-to-explain receipt. Falls back to index math if no anchor is
  // available for a given subcategory.
  if (isLiveOpen) {
    const cells: Record<string, TrendCell> = {}
    for (const col of columns) {
      const live = liveSnapshot[col.canonicalId]
      const anchor = anchorSnapshot[col.canonicalId]
      let index: number | null = null
      let pct: number | null = null
      let breakdown: LiveCellBreakdown | undefined
      if (live && anchor && anchor.anchorUSD > 0) {
        // USD-first math (the user-facing path).
        pct = ((live.liveUSD - anchor.anchorUSD) / anchor.anchorUSD) * 100
        breakdown = {
          todayUSD: live.liveUSD,
          todayDate: live.liveDate,
          todayLabel: 'Latest capture',
          anchorUSD: anchor.anchorUSD,
          anchorDate: anchor.anchorDate,
          anchorLabel: anchor.anchorLabel,
          latestSource: live.latestSource,
          representativePartUsed: live.representativePartUsed,
          candidatePartsChecked: live.candidatePartsChecked,
        }
      }
      // If no anchor resolves, leave pct null — the live cell is blank and
      // not clickable. We deliberately do NOT fall back to Feb-27 or to
      // index-only math here (per revised spec).
      cells[col.canonicalId] = breakdown
        ? { index, pct, breakdown }
        : { index, pct }
    }
    // WTD label uses the CURRENT OPEN Sat-Fri week (anchored on the
    // upcoming Friday close), matching the calendar week convention used
    // by closed rows. fmtWeek(today) would render a rolling 7-day window
    // (e.g. "May 19-25" for today=Mon May 25), which doesn't align with
    // the closed rows (May 16-22, May 23-29 …) and confuses users.
    const wtdEnd = (() => {
      const d = new Date(today)
      const dow = d.getUTCDay() // 0=Sun..5=Fri..6=Sat
      const daysToFriday = (5 - dow + 7) % 7
      d.setUTCDate(d.getUTCDate() + daysToFriday)
      return d
    })()
    rows.push({
      periodEnd: isoDate(today),
      label:
        view === 'wow' ? `WTD · ${fmtWeek(wtdEnd)}`
        : view === 'mom' ? `MTD · ${fmtMonthShort(today)}`
        : `QTD · ${fmtQuarter(today)}`,
      liveToDate: true,
      bridgeRow: false,
      cells,
    })
  }

  return { view, columns, rows, liveAsOf: liveAsOfISO }
}

// ── Public: build a snapshot from /api/prices payload ───────────────────────

export function buildLiveSnapshot(
  pricesData: Record<string, any>,
  fallbackDateISO?: string,
): LiveSnapshot {
  const out: LiveSnapshot = {}
  for (const [legacyId, entry] of Object.entries(pricesData)) {
    if (!entry || typeof entry !== 'object') continue
    const usd = (entry as any).avgPriceUSD
    if (typeof usd !== 'number' || usd <= 0) continue
    const canonicalId = legacyToCanonical(legacyId)
    if (!(canonicalId in SUB_TO_BASELINE)) continue
    const fetchedAt: string | undefined = (entry as any).fetchedAt
    const liveDate = (fetchedAt ? String(fetchedAt).slice(0, 10) : null)
      ?? fallbackDateISO
      ?? new Date().toISOString().slice(0, 10)
    out[canonicalId] = {
      canonicalId,
      liveUSD: usd,
      liveDate,
    }
  }
  return out
}

// Local copy (avoid import cycle) — mirror of LEGACY_TO_CANONICAL keys we need.
function legacyToCanonical(id: string): string {
  const m: Record<string, string> = {
    pm_ldo: 'power_ldo',
    pm_acdc: 'power_acdc_switching',
    pm_dcdc: 'power_dcdc_switching',
    pm_super: 'power_supervisor_reset',
    pm_batt: 'power_battery_mgmt',
    amp_op: 'amp_opamps',
    amp_instr: 'amp_instrumentation',
    amp_audio: 'amp_audio',
    amp_cmp: 'amp_comparators',
    dac_adc: 'conv_adc',
    dac_dac: 'conv_dac',
    if_can: 'interface_can',
    if_lin: 'interface_lin',
    if_eth: 'interface_ethernet_phy',
    iso_dig: 'isolation_digital',
    iso_rein: 'isolation_reinforced',
    mcu_msp: 'mcu_msp430',
    mcu_c2k: 'mcu_c2000',
    mcu_m0: 'mcu_mspm0',
    mcu_cc: 'mcu_simplelink',
    mcu_sit: 'mcu_sitara',
    gan_342: 'gan_lmg342x',
    gan_365: 'gan_lmg3650',
    gan_520: 'gan_lmg5200',
    dc_48v: 'dc_48v_bus',
    dc_sps: 'dc_smart_power_stages',
    dc_efuse: 'dc_efuses',
    dc_hswap: 'dc_hotswap',
    dc_tps: 'dc_tps536xx_ai_power',
  }
  return m[id] ?? id
}
