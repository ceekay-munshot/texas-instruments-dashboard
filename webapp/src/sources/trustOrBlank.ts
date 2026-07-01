// Phase 28.3 — trust-or-blank: a post-handoff cell shows a number ONLY when a
// trustworthy source can measure that exact period; otherwise "—".
//
// Trusted sources, in the order the overlays apply them:
//   1. broad 72k weighted series — when a successful-capture point sits within
//      BROAD_SLACK_DAYS of BOTH row boundaries (broadOwnsRow);
//   2. daily-panel matched-pairs like-for-like — ≥2 panel parts priced at both
//      boundaries (panelLflMove);
//   3. broad 72k constant-basket L4L — applied AFTER this stage, so once its
//      part-level history covers a row it overwrites the blank automatically.
//
// Everything else was the audit's garbage parade: the resurfaced gan_lmg5200
// +147% frozen cell, stale 0.00% May cells diluting UBS bucket means, May-4-
// anchored "MTD" cells importing the whole May hike (+39% smart power stages,
// -22% MSPM0), and mix-driven QTD values (battery -0.35% across a verified
// +10% hike). Blank beats plausible-but-wrong.
//
// Special case — the QoQ live row starts pre-handoff (Mar-31), which no
// per-part source can reach. Its existing value chains hist(Q1→May-4) with
// the raw stock-weighted broad leg — the mix-contaminated part. We keep the
// hist leg (recovered from the cell's own anchorUSD vs the May-4 seed, the
// audit verified this reconstruction to 4 decimals) and replace the broad leg
// with the panel's like-for-like May-4→today move. No panel coverage → blank.

import { HANDOFF_WEIGHTED_ASP, histLegFromBaseline } from '../data/historicalBaseline'
import { broadOwnsRow, type WeightedSeries } from './weightedSeries'
import { panelLflMove, type PanelLfl } from './panelLflSeries'

const HANDOFF_DATE = '2026-05-04'

export function applyTrustOrBlank(
  result: { columns: { canonicalId: string }[]; rows: any[] },
  series: WeightedSeries,
  panel: PanelLfl,
  liveAsOf: string,
): { blanked: number; composed: number } {
  let blanked = 0
  let composed = 0
  for (const col of result.columns) {
    const sub = col.canonicalId
    for (let i = 1; i < result.rows.length; i++) {
      const row = result.rows[i]
      const endDate = row.liveToDate ? liveAsOf : row.periodEnd
      const startDate = result.rows[i - 1].periodEnd
      if (!startDate || !endDate) continue
      if (endDate < HANDOFF_DATE) continue // pre-handoff history stays as-is
      if (broadOwnsRow(series[sub], startDate, endDate)) continue // overlay 1 wrote it
      if (panelLflMove(panel, sub, startDate, endDate)) continue // overlay 2 wrote it
      const srcLabel = String(row.cells[sub]?.breakdown?.representativePartUsed || '')
      // A frozen composed value (written by the period-close snapshot) IS the
      // trusted record for a closed straddle row — without this, the Q2-26
      // row would blank dashboard-wide the day the quarter closes.
      if (srcLabel.startsWith('Hist baseline × Like-for-like')) continue
      if (startDate < HANDOFF_DATE) {
        // Straddle row (the QoQ Q2-2026 seam quarter — the only row whose start
        // predates all our captured data): compose hist leg × panel leg.
        //   histLeg = pre-handoff move (Q1 close → our first capture), a PURE
        //             historical-baseline ratio — NOT read from the cell, so it
        //             works on the CLOSED row too (this is the whole fix: the
        //             old code read anchorUSD/srcLabel that only the LIVE row
        //             carried, so the cell blanked the instant the quarter closed).
        //   panelLeg = daily-panel like-for-like May-4 → endDate.
        // No provenance guard needed: histLeg is intrinsically in the same units
        // as the seed, so the legacy mis-unit risk that guard protected is gone.
        const histLeg = histLegFromBaseline(sub, startDate)
        const mv = panelLflMove(panel, sub, HANDOFF_DATE, endDate)
        const seed = HANDOFF_WEIGHTED_ASP[sub]
        if (histLeg != null && mv) {
          const pctVal = ((1 + histLeg) * (1 + mv.pct / 100) - 1) * 100
          // Implied Q1-close weighted-ASP level (seed rolled back through the
          // hist leg) so the click-receipt shows real dollars, not "$0.0000".
          const anchorLevel = seed > 0 ? seed / (1 + histLeg) : null
          row.cells[sub] = {
            ...row.cells[sub],
            pct: pctVal,
            breakdown: {
              ...row.cells[sub]?.breakdown,
              anchorUSD: anchorLevel, anchorDate: startDate, anchorLabel: 'Historical baseline',
              todayUSD: anchorLevel != null ? anchorLevel * (1 + pctVal / 100) : null,
              todayDate: endDate, todayLabel: 'Implied level · mix held constant',
              latestSource: 'ti_inventory',
              representativePartUsed: `Hist baseline × Like-for-like · ${mv.n} daily-tracked parts`,
            },
          }
          composed += 1
          continue
        }
      }
      if (row.cells[sub]?.pct == null) continue // already blank
      row.cells[sub] = { ...row.cells[sub], pct: null, breakdown: undefined }
      blanked += 1
    }
  }
  return { blanked, composed }
}
