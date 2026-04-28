// ── Trend signal engine ──────────────────────────────────────────────────────
// Compares the earliest and latest snapshot in a window. Per-category and
// per-SKU classification. Coverage-confidence framing: this is a signal of
// what the data shows, not a prediction.

import type {
  CategoryTrend,
  Snapshot,
  SnapshotTrendSignal,
  SkuTrend,
} from '../data/snapshotSchema'

// Material-change thresholds. Tuned conservatively so a single noisy
// observation doesn't flip the signal.
const PRICE_UP_PCT = 1
const PRICE_DOWN_PCT = -1
const INV_UP_PCT = 5
const INV_DOWN_PCT = -5
const INV_DOWN_MATERIAL_PCT = -10

function pctChange(latest: number | null, earliest: number | null): number | null {
  if (latest == null || earliest == null) return null
  if (!isFinite(latest) || !isFinite(earliest)) return null
  if (earliest === 0) return null
  return Math.round(((latest - earliest) / earliest) * 1000) / 10
}

export function classifySignal(
  priceChangePct: number | null,
  inventoryChangePct: number | null,
): SnapshotTrendSignal {
  // If either signal can't be computed, we can't classify confidently.
  if (priceChangePct == null || inventoryChangePct == null) return 'mixed'

  const priceUp = priceChangePct > PRICE_UP_PCT
  const priceDown = priceChangePct < PRICE_DOWN_PCT
  const invUp = inventoryChangePct > INV_UP_PCT
  const invDown = inventoryChangePct < INV_DOWN_PCT
  const invDownMaterial = inventoryChangePct < INV_DOWN_MATERIAL_PCT

  // Most informative combinations first; ordering matters.
  if (priceUp && invDown) return 'possible_shortage'
  if (priceDown && invUp) return 'easing_supply'
  if (!priceUp && invDownMaterial) return 'tight_but_unpriced'
  if (priceUp && !invDown) return 'price_pressure_without_stock_signal'
  return 'mixed'
}

export type TrendsResult = {
  status: 'ok' | 'insufficient_history' | 'no_data'
  observationCount: number
  windowDays: number
  firstDate: string | null
  latestDate: string | null
  categoryTrends: CategoryTrend[]
}

export function computeTrends(snapshots: Snapshot[], windowDays: number): TrendsResult {
  if (snapshots.length === 0) {
    return {
      status: 'no_data',
      observationCount: 0,
      windowDays,
      firstDate: null,
      latestDate: null,
      categoryTrends: [],
    }
  }

  // Sort ascending by snapshotDate, defensively.
  const sorted = snapshots.slice().sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
  const earliest = sorted[0]
  const latest = sorted[sorted.length - 1]

  // Need ≥ 2 distinct dates for a real trend.
  if (sorted.length < 2 || earliest.snapshotDate === latest.snapshotDate) {
    return {
      status: 'insufficient_history',
      observationCount: sorted.length,
      windowDays,
      firstDate: earliest.snapshotDate,
      latestDate: latest.snapshotDate,
      categoryTrends: [],
    }
  }

  const earlyByCat = new Map(earliest.categories.map(c => [c.categoryId, c]))
  const latestByCat = new Map(latest.categories.map(c => [c.categoryId, c]))
  const allCatIds = new Set<string>([...earlyByCat.keys(), ...latestByCat.keys()])

  const categoryTrends: CategoryTrend[] = []
  for (const catId of allCatIds) {
    const e = earlyByCat.get(catId)
    const l = latestByCat.get(catId) ?? e
    if (!l) continue

    const priceEarliest = e?.avgBestTrustedAvailableUnitPrice ?? null
    const priceLatest = l.avgBestTrustedAvailableUnitPrice ?? null
    const inventoryEarliest = e?.totalTrustedAvailableInventory ?? null
    const inventoryLatest = l.totalTrustedAvailableInventory ?? null

    const priceChangePct = pctChange(priceLatest, priceEarliest)
    const inventoryChangePct = pctChange(inventoryLatest, inventoryEarliest)
    const signal = e == null
      ? ('insufficient_history' as SnapshotTrendSignal)
      : classifySignal(priceChangePct, inventoryChangePct)

    // Per-SKU sub-trends — only when we have both early and late records.
    const skuTrends: SkuTrend[] = []
    if (e) {
      const earlySkus = new Map(e.skus.map(s => [s.mpn, s]))
      for (const lSku of l.skus) {
        const eSku = earlySkus.get(lSku.mpn)
        if (!eSku) {
          skuTrends.push({
            mpn: lSku.mpn,
            observationCount: 1,
            firstDate: latest.snapshotDate,
            latestDate: latest.snapshotDate,
            priceEarliest: null,
            priceLatest: lSku.bestTrustedAvailableUnitPrice ?? null,
            priceChangePct: null,
            inventoryEarliest: null,
            inventoryLatest: lSku.totalTrustedAvailableInventory ?? null,
            inventoryChangePct: null,
            signal: 'insufficient_history',
          })
          continue
        }
        const sp = pctChange(
          lSku.bestTrustedAvailableUnitPrice ?? null,
          eSku.bestTrustedAvailableUnitPrice ?? null,
        )
        const si = pctChange(
          lSku.totalTrustedAvailableInventory ?? null,
          eSku.totalTrustedAvailableInventory ?? null,
        )
        skuTrends.push({
          mpn: lSku.mpn,
          observationCount: sorted.length,
          firstDate: earliest.snapshotDate,
          latestDate: latest.snapshotDate,
          priceEarliest: eSku.bestTrustedAvailableUnitPrice ?? null,
          priceLatest: lSku.bestTrustedAvailableUnitPrice ?? null,
          priceChangePct: sp,
          inventoryEarliest: eSku.totalTrustedAvailableInventory ?? null,
          inventoryLatest: lSku.totalTrustedAvailableInventory ?? null,
          inventoryChangePct: si,
          signal: classifySignal(sp, si),
        })
      }
    }

    categoryTrends.push({
      categoryId: catId,
      categoryLabel: l.categoryLabel,
      observationCount: sorted.length,
      firstDate: earliest.snapshotDate,
      latestDate: latest.snapshotDate,
      priceEarliest,
      priceLatest,
      priceChangePct,
      inventoryEarliest,
      inventoryLatest,
      inventoryChangePct,
      signal,
      skuTrends,
    })
  }

  return {
    status: 'ok',
    observationCount: sorted.length,
    windowDays,
    firstDate: earliest.snapshotDate,
    latestDate: latest.snapshotDate,
    categoryTrends,
  }
}
