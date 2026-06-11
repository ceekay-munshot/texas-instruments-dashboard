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

import { HANDOFF_WEIGHTED_ASP } from '../data/historicalBaseline'
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
        // Straddle row (live QTD, or closed quarter pre-freeze): hist leg ×
        // panel like-for-like leg. PROVENANCE GUARD: anchorUSD is only in
        // weighted-ASP units when the cascade's weighted stopgap wrote it —
        // composing the seed against a legacy single-SKU anchor would produce
        // a confidently-wrong number, so anything else falls through to "—".
        const seed = HANDOFF_WEIGHTED_ASP[sub]
        const anchorUSD = Number(row.cells[sub]?.breakdown?.anchorUSD)
        const mv = panelLflMove(panel, sub, HANDOFF_DATE, endDate)
        if (srcLabel === 'Stock-weighted ASP (catalog)' && seed > 0 && anchorUSD > 0 && mv) {
          const histLeg = seed / anchorUSD - 1
          const pctVal = ((1 + histLeg) * (1 + mv.pct / 100) - 1) * 100
          row.cells[sub] = {
            ...row.cells[sub],
            pct: pctVal,
            breakdown: {
              ...row.cells[sub]?.breakdown,
              // The implied level (= May-4 seed × the panel's pure-price move,
              // i.e. today's weighted ASP with the basket mix held constant).
              // Gives the click-receipt real, internally consistent arithmetic
              // — a null here rendered as "$0.0000 → −100.00%" in the popover.
              todayUSD: anchorUSD * (1 + pctVal / 100),
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
