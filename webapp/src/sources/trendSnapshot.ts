// Phase 26 — trend_period_snapshot helpers.
//
// Two read paths and one write path. The trend API reads these snapshots
// to render closed (historical) WoW/MoM/QoQ rows with the same receipt
// format as the live row; the snapshot writer (cron + manual endpoint)
// freezes the live cascade's output at the moment a period closes.

import type { D1Database } from '@cloudflare/workers-types'

export type SnapshotRow = {
  view: 'wow' | 'mom' | 'qoq'
  periodEndDate: string
  canonicalId: string
  todayUSD: number
  todayDate: string
  anchorUSD: number
  anchorDate: string
  anchorLabel: string
  pct: number
  representativePart: string | null
  latestSource: string | null
  snapshottedAt: string
}

/** Bundle the breakdown shape the live-row receipt expects. The trend
 *  builder will attach this directly to the closed cell. Keep field names
 *  aligned with LiveCellBreakdown in tiTrendSeries.ts. */
export type SnapshotBreakdown = {
  todayUSD: number
  todayDate: string
  todayLabel: 'Latest capture'
  anchorUSD: number
  anchorDate: string
  anchorLabel: string
  latestSource?: string
  representativePartUsed?: string
}

/** Read all snapshot rows for a single view, keyed by periodEnd → canonicalId. */
export async function readSnapshotsByView(
  d1: D1Database | null | undefined,
  view: 'wow' | 'mom' | 'qoq',
): Promise<Record<string, Record<string, SnapshotBreakdown & { pct: number }>>> {
  if (!d1) return {}
  try {
    const result = await d1
      .prepare(
        `SELECT view, period_end_date, canonical_id,
                today_usd, today_date, anchor_usd, anchor_date,
                anchor_label, pct, representative_part, latest_source
         FROM trend_period_snapshot
         WHERE view = ?`,
      )
      .bind(view)
      .all<{
        view: string
        period_end_date: string
        canonical_id: string
        today_usd: number
        today_date: string
        anchor_usd: number
        anchor_date: string
        anchor_label: string
        pct: number
        representative_part: string | null
        latest_source: string | null
      }>()
    const out: Record<string, Record<string, SnapshotBreakdown & { pct: number }>> = {}
    for (const row of result.results ?? []) {
      const dateKey = String(row.period_end_date)
      if (!out[dateKey]) out[dateKey] = {}
      out[dateKey][String(row.canonical_id)] = {
        pct: Number(row.pct),
        todayUSD: Number(row.today_usd),
        todayDate: String(row.today_date),
        todayLabel: 'Latest capture',
        anchorUSD: Number(row.anchor_usd),
        anchorDate: String(row.anchor_date),
        anchorLabel: String(row.anchor_label),
        latestSource: row.latest_source ?? undefined,
        representativePartUsed: row.representative_part ?? undefined,
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Write a batch of snapshot rows. Idempotent via PK (INSERT OR REPLACE). */
export async function writeSnapshotsBatch(
  d1: D1Database | null | undefined,
  rows: SnapshotRow[],
): Promise<{ written: number; errors: string[] }> {
  if (!d1 || rows.length === 0) return { written: 0, errors: [] }
  const errors: string[] = []
  try {
    const stmts = rows.map(r =>
      d1
        .prepare(
          `INSERT OR REPLACE INTO trend_period_snapshot
             (view, period_end_date, canonical_id,
              today_usd, today_date, anchor_usd, anchor_date,
              anchor_label, pct, representative_part, latest_source, snapshotted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          r.view,
          r.periodEndDate,
          r.canonicalId,
          r.todayUSD,
          r.todayDate,
          r.anchorUSD,
          r.anchorDate,
          r.anchorLabel,
          r.pct,
          r.representativePart,
          r.latestSource,
          r.snapshottedAt,
        ),
    )
    await d1.batch(stmts)
    return { written: rows.length, errors }
  } catch (e) {
    errors.push(String(e instanceof Error ? e.message : e))
    return { written: 0, errors }
  }
}

/** True if `d` is the last calendar day of its month (UTC). */
export function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.getUTCMonth() !== d.getUTCMonth()
}

/** True if `d` is the last calendar day of a quarter (Mar 31, Jun 30, Sep 30, Dec 31). */
export function isLastDayOfQuarter(d: Date): boolean {
  return isLastDayOfMonth(d) && [2, 5, 8, 11].includes(d.getUTCMonth())
}

/** Pick the views whose period boundary closes on the given UTC date. */
export function viewsClosingOn(d: Date): ('wow' | 'mom' | 'qoq')[] {
  const out: ('wow' | 'mom' | 'qoq')[] = []
  if (d.getUTCDay() === 5) out.push('wow') // Friday close
  if (isLastDayOfMonth(d)) out.push('mom')
  if (isLastDayOfQuarter(d)) out.push('qoq')
  return out
}
