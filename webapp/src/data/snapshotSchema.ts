// ── Persistent source-memory schema ──────────────────────────────────────────
// Daily normalized snapshots of representative-basket source observations.
// Designed to be source-agnostic: today only `octopart_nexar` is populated,
// but `source` is a string and `sourceObservations[]` is per-distributor so
// future Mouser-direct, DigiKey, Arrow, and TI.com observations slot in
// without a schema break.

export const SNAPSHOT_SCHEMA_VERSION = '1.0.0'

export type SnapshotSourceConfidence =
  | 'authorized_or_core'
  | 'marketplace_or_broker'
  | 'unknown'
  | 'manual_operator_import'

export type SnapshotSourceObservation = {
  /** Stable source id, e.g. 'octopart_nexar', 'mouser_direct', 'digikey_direct'. */
  source: string
  distributor: string | null
  unitPrice: number | null
  availableInventory: number | null
  /** Days. Null when the source did not report lead time. */
  leadTimeDays: number | null
  currency: string | null
  observedAt: string
  confidence: SnapshotSourceConfidence
}

export type SnapshotSku = {
  mpn: string
  representativeReason?: string
  importanceTier?: 'primary' | 'secondary' | 'watchlist'
  status: string
  bestTrustedAvailableUnitPrice: number | null
  bestTrustedAvailableDistributor: string | null
  bestTrustedAvailableInventory: number | null
  bestTrustedQuotedUnitPrice: number | null
  bestAnyUnitPrice: number | null
  totalTrustedAvailableInventory: number
  totalBrokerAvailableInventory: number
  trustedDistributors: string[]
  sourceObservations: SnapshotSourceObservation[]
  warnings: string[]
}

export type SnapshotCategory = {
  categoryId: string
  /** Canonical TI taxonomy id (Phase 16A). Optional for backward compat with
   *  pre-16A snapshots; resolve via canonicalCategoryId() in tiTaxonomy.ts. */
  canonicalCategoryId?: string
  categoryLabel: string
  representativeSkuCount: number
  quotedSkuCount: number
  avgBestTrustedAvailableUnitPrice: number | null
  medianBestTrustedAvailableUnitPrice: number | null
  totalTrustedAvailableInventory: number
  totalBrokerAvailableInventory: number
  trustedDistributorCoverage: string[]
  sampleCoverage: string
  warnings: string[]
  skus: SnapshotSku[]
}

export type Snapshot = {
  /** UTC date in YYYY-MM-DD form (also used as the KV key suffix). */
  snapshotDate: string
  /** Full ISO timestamp of capture. */
  capturedAt: string
  dashboard: 'texas_instruments'
  /** Source family for this row of snapshots. Today only octopart_nexar is
   * populated; future sources land as separate KV key prefixes. */
  source:
    | 'octopart_nexar'
    | 'mouser_direct'
    | 'digikey_direct'
    | 'arrow_direct'
    | 'ti_direct'
    // Phase 18A — operator-imported distributor evidence (no scraping, no paid API).
    | 'digikey_manual'
    | 'arrow_manual'
    | 'ti_manual'
    | 'other_manual'
  mode:
    | 'representative_basket_preview'
    | 'full_basket'
    | 'full_mouser_category_snapshot'
    | 'manual_distributor_snapshot'
  categoryCount: number
  skuCount: number
  callsUsed: number
  maxCalls: number
  categories: SnapshotCategory[]
  metadata: {
    cacheTtlHours: number
    quotaNote: string
    schemaVersion: string
  }
}

/** Derived structure returned by /api/snapshots/trends. */
export type SnapshotTrendSignal =
  | 'possible_shortage'
  | 'easing_supply'
  | 'tight_but_unpriced'
  | 'price_pressure_without_stock_signal'
  | 'mixed'
  | 'insufficient_history'

export type CategoryTrend = {
  categoryId: string
  /** Canonical TI taxonomy id (Phase 17A). Optional — pre-17A trend output omits it. */
  canonicalCategoryId?: string
  categoryLabel: string
  observationCount: number
  firstDate: string | null
  latestDate: string | null
  priceEarliest: number | null
  priceLatest: number | null
  priceChangePct: number | null
  inventoryEarliest: number | null
  inventoryLatest: number | null
  inventoryChangePct: number | null
  signal: SnapshotTrendSignal
  /** Per-SKU trends inside this category, when computable. */
  skuTrends: SkuTrend[]
}

export type SkuTrend = {
  mpn: string
  observationCount: number
  firstDate: string | null
  latestDate: string | null
  priceEarliest: number | null
  priceLatest: number | null
  priceChangePct: number | null
  inventoryEarliest: number | null
  inventoryLatest: number | null
  inventoryChangePct: number | null
  signal: SnapshotTrendSignal
}
