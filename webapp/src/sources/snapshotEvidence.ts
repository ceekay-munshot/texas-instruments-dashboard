// ── Current-source evidence layer (Phase 14A) ───────────────────────────────
// Pure derivation from a single stored Snapshot. Does NOT call Nexar, does NOT
// modify stored snapshots. Read-only consumer of the persistent source memory.
//
// What this module produces and what it does not:
//   - Source-confidence and distributor transparency from the LATEST snapshot.
//   - Dedup of source observations in the *derived* output only — raw stored
//     snapshots are unchanged.
//   - "Current evidence" labels (strong / moderate / weak / insufficient).
//   - It deliberately DOES NOT compute shortage/easing trend signals — those
//     require ≥2 dated snapshots and live in src/sources/snapshotTrends.ts.

import { canonicalDistributorName } from '../data/sourceTypes'
import type {
  Snapshot,
  SnapshotCategory,
  SnapshotSku,
  SnapshotSourceObservation,
} from '../data/snapshotSchema'

// ── Types ───────────────────────────────────────────────────────────────────

export type EvidenceStatus =
  | 'strong_current_evidence'
  | 'moderate_current_evidence'
  | 'weak_current_evidence'
  | 'insufficient_current_evidence'

export type SkuEvidence = {
  mpn: string
  status: string
  importanceTier?: 'primary' | 'secondary' | 'watchlist'
  representativeReason?: string
  trustedDistributorCount: number
  trustedDistributors: string[]
  bestTrustedAvailableUnitPrice: number | null
  bestTrustedAvailableDistributor: string | null
  bestTrustedAvailableInventory: number | null
  totalTrustedAvailableInventory: number
  totalBrokerAvailableInventory: number
  brokerInventoryExcluded: true
  duplicateObservationCount: number
  cleanedObservationCount: number
  sourceConfidenceScore: number
  evidenceStatus: EvidenceStatus
  warnings: string[]
}

export type CategoryEvidence = {
  categoryId: string
  categoryLabel: string
  snapshotDate: string
  representativeSkuCount: number
  quotedSkuCount: number
  validSkuCount: number
  failedSkuCount: number
  trustedDistributorCount: number
  trustedDistributors: string[]
  avgTrustedPrice: number | null
  medianTrustedPrice: number | null
  totalTrustedInventory: number
  totalBrokerInventory: number
  /** Broker share of total available inventory. 0..1. null if both pools empty. */
  brokerInventoryRatio: number | null
  sourceConfidenceScore: number
  evidenceStatus: EvidenceStatus
  warnings: string[]
  skus: SkuEvidence[]
}

export type SnapshotEvidence = {
  snapshotDate: string
  capturedAt: string
  source: Snapshot['source']
  mode: Snapshot['mode']
  /** Worst-case status across categories — conservative top-level label. */
  overallEvidenceStatus: EvidenceStatus
  /** Mean of category scores, rounded — for one-glance display in the legend. */
  overallSourceConfidenceScore: number
  categoryCount: number
  skuCount: number
  categories: CategoryEvidence[]
}

// ── Score → status thresholds (kept simple and explainable) ─────────────────

export function mapScoreToStatus(score: number): EvidenceStatus {
  if (score >= 80) return 'strong_current_evidence'
  if (score >= 60) return 'moderate_current_evidence'
  if (score >= 40) return 'weak_current_evidence'
  return 'insufficient_current_evidence'
}

const STATUS_RANK: Record<EvidenceStatus, number> = {
  insufficient_current_evidence: 0,
  weak_current_evidence: 1,
  moderate_current_evidence: 2,
  strong_current_evidence: 3,
}

function worseStatus(a: EvidenceStatus, b: EvidenceStatus): EvidenceStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ── Observation dedup ───────────────────────────────────────────────────────

export type DedupResult = {
  cleaned: SnapshotSourceObservation[]
  /** Number of duplicates removed. */
  duplicateCount: number
}

/**
 * Dedup rule (per spec):
 *   Same `source + canonical(distributor) + currency + unitPrice + availableInventory`
 *   → keep first, drop the rest. The canonical distributor name folds variants
 *   like "Digi-Key" / "DigiKey" / "Digi Key" into a single bucket while leaving
 *   genuinely different distributors alone.
 *
 *   Distinct prices or distinct stock counts from the same distributor are
 *   intentionally NOT collapsed — they are real, separately-informative data
 *   points (e.g. Cut Tape qty=1 vs Tape & Reel qty=3000 from DigiKey).
 */
export function dedupeObservations(
  observations: SnapshotSourceObservation[],
): DedupResult {
  const seen = new Set<string>()
  const cleaned: SnapshotSourceObservation[] = []
  for (const o of observations) {
    const canon = canonicalDistributorName(o.distributor) ?? '∅'
    const key = [
      o.source,
      canon,
      o.currency ?? '∅',
      o.unitPrice == null ? '∅' : String(o.unitPrice),
      o.availableInventory == null ? '∅' : String(o.availableInventory),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(o)
  }
  return { cleaned, duplicateCount: observations.length - cleaned.length }
}

// ── Per-SKU derivation ──────────────────────────────────────────────────────

function distinctTrustedDistributors(
  observations: SnapshotSourceObservation[],
): string[] {
  const set = new Set<string>()
  for (const o of observations) {
    if (o.confidence !== 'authorized_or_core') continue
    const canon = canonicalDistributorName(o.distributor)
    if (canon) set.add(canon)
  }
  return Array.from(set)
}

export function deriveSkuEvidence(sku: SnapshotSku): SkuEvidence {
  const dedup = dedupeObservations(sku.sourceObservations || [])
  const trustedDistributors = distinctTrustedDistributors(dedup.cleaned)

  const hasTrustedPrice = sku.bestTrustedAvailableUnitPrice != null && sku.bestTrustedAvailableUnitPrice > 0
  const hasTrustedInventory = (sku.totalTrustedAvailableInventory || 0) > 0

  let score = 0
  if (hasTrustedPrice) score += 25
  if (hasTrustedInventory) score += 25
  if (trustedDistributors.length >= 3) score += 20
  if (sku.status === 'ok') score += 15
  // Broker is always tracked separately in our schema (totalBrokerAvailableInventory
  // is a distinct field that never enters trusted aggregates) → +10 unconditional.
  score += 10
  if ((sku.warnings || []).length === 0) score += 5
  score = clamp(score, 0, 100)

  return {
    mpn: sku.mpn,
    status: sku.status,
    importanceTier: sku.importanceTier,
    representativeReason: sku.representativeReason,
    trustedDistributorCount: trustedDistributors.length,
    trustedDistributors,
    bestTrustedAvailableUnitPrice: sku.bestTrustedAvailableUnitPrice,
    bestTrustedAvailableDistributor: sku.bestTrustedAvailableDistributor,
    bestTrustedAvailableInventory: sku.bestTrustedAvailableInventory,
    totalTrustedAvailableInventory: sku.totalTrustedAvailableInventory ?? 0,
    totalBrokerAvailableInventory: sku.totalBrokerAvailableInventory ?? 0,
    brokerInventoryExcluded: true,
    duplicateObservationCount: dedup.duplicateCount,
    cleanedObservationCount: dedup.cleaned.length,
    sourceConfidenceScore: score,
    evidenceStatus: mapScoreToStatus(score),
    warnings: sku.warnings || [],
  }
}

// ── Per-category derivation ─────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length / 2
  return sorted.length % 2
    ? sorted[Math.floor(mid)]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export function deriveCategoryEvidence(
  cat: SnapshotCategory,
  snapshotDate: string,
): CategoryEvidence {
  const skus = (cat.skus || []).map(deriveSkuEvidence)

  const validSkuCount = skus.filter(s => s.status === 'ok').length
  const failedSkuCount = skus.filter(s => s.status !== 'ok').length

  // Aggregate trusted distributors across SKUs (canonical names already)
  const trustedSet = new Set<string>()
  for (const s of skus) for (const d of s.trustedDistributors) trustedSet.add(d)
  const trustedDistributors = Array.from(trustedSet)

  // Average / median of bestTrustedAvailableUnitPrice across the category's
  // priced SKUs. If no SKU is priced, both stay null.
  const trustedPrices = skus
    .map(s => s.bestTrustedAvailableUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
  const avgTrustedPrice = trustedPrices.length > 0
    ? round4(trustedPrices.reduce((a, b) => a + b, 0) / trustedPrices.length)
    : null
  const medianTrustedPrice = trustedPrices.length > 0
    ? round4(median(trustedPrices) as number)
    : null

  const totalTrustedInventory = cat.totalTrustedAvailableInventory ?? 0
  const totalBrokerInventory = cat.totalBrokerAvailableInventory ?? 0
  const totalAvailable = totalTrustedInventory + totalBrokerInventory
  const brokerInventoryRatio = totalAvailable > 0
    ? Math.round((totalBrokerInventory / totalAvailable) * 1000) / 1000
    : null

  const primarySkuOk = skus.some(s => s.importanceTier === 'primary' && s.status === 'ok')

  // Confidence (per spec — additive + clamp)
  let score = 0
  if (avgTrustedPrice != null) score += 25
  if (totalTrustedInventory > 0) score += 25
  if (trustedDistributors.length >= 3) score += 20
  if (primarySkuOk) score += 15
  // Broker is always tracked separately at the category level → +10 unconditional.
  score += 10
  if (failedSkuCount === 0) score += 5
  score = clamp(score, 0, 100)

  // Category-level warnings: thread through anything the snapshot itself recorded,
  // plus convenience flags derived here.
  const warnings: string[] = (cat.warnings || []).slice()
  if (failedSkuCount > 0 && !warnings.includes('one_or_more_skus_failed_fetch')) {
    warnings.push('one_or_more_skus_failed_fetch')
  }
  if (trustedDistributors.length === 0) warnings.push('no_trusted_distributor_observations')
  if (trustedPrices.length === 0) warnings.push('no_trusted_priced_skus')

  return {
    categoryId: cat.categoryId,
    categoryLabel: cat.categoryLabel,
    snapshotDate,
    representativeSkuCount: cat.representativeSkuCount ?? skus.length,
    quotedSkuCount: cat.quotedSkuCount ?? trustedPrices.length,
    validSkuCount,
    failedSkuCount,
    trustedDistributorCount: trustedDistributors.length,
    trustedDistributors,
    avgTrustedPrice,
    medianTrustedPrice,
    totalTrustedInventory,
    totalBrokerInventory,
    brokerInventoryRatio,
    sourceConfidenceScore: score,
    evidenceStatus: mapScoreToStatus(score),
    warnings,
    skus,
  }
}

// ── Top-level derivation ────────────────────────────────────────────────────

export function deriveSnapshotEvidence(snapshot: Snapshot): SnapshotEvidence {
  const categories = (snapshot.categories || []).map(c =>
    deriveCategoryEvidence(c, snapshot.snapshotDate),
  )

  // Top-level evidence status = worst (most-conservative) category status.
  const overallEvidenceStatus: EvidenceStatus = categories.length === 0
    ? 'insufficient_current_evidence'
    : categories.reduce<EvidenceStatus>(
        (worst, cat) => worseStatus(worst, cat.evidenceStatus),
        'strong_current_evidence',
      )

  const meanScore = categories.length === 0
    ? 0
    : Math.round(
        categories.reduce((s, c) => s + c.sourceConfidenceScore, 0) / categories.length,
      )

  const skuCount = categories.reduce((s, c) => s + c.skus.length, 0)

  return {
    snapshotDate: snapshot.snapshotDate,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    mode: snapshot.mode,
    overallEvidenceStatus,
    overallSourceConfidenceScore: meanScore,
    categoryCount: categories.length,
    skuCount,
    categories,
  }
}
