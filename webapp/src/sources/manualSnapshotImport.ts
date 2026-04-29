// ── Manual distributor evidence import (Phase 18A) ──────────────────────────
// Operator-supplied source rows ingested as a normalized Snapshot. This is
// **not** scraping and **not** synthesized history — every row is observed
// data the operator copied or exported from a distributor and uploaded with
// explicit provenance metadata.
//
// Design constraints (from the spec):
//   - No paid API dependency. No external calls. No page-load capture.
//   - One snapshot per (manual source × UTC date).
//   - Explicit, conservative validation. Never silently drop rows; flag
//     unmappable categories under categoryId='manual_unmapped' with a warning.
//   - Confidence on each observation is fixed to 'manual_operator_import' so
//     it never blends into the trusted (authorized_or_core) signal pool.

import { canonicalCategoryId } from '../data/tiTaxonomy'
import { PART_MAP } from '../data/mouserCatalog'
import {
  SNAPSHOT_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotCategory,
  type SnapshotSku,
  type SnapshotSourceObservation,
} from '../data/snapshotSchema'

export type ManualSource =
  | 'digikey_manual'
  | 'arrow_manual'
  | 'ti_manual'
  | 'other_manual'

export const ALLOWED_MANUAL_SOURCES: ManualSource[] = [
  'digikey_manual',
  'arrow_manual',
  'ti_manual',
  'other_manual',
]

export const MANUAL_MODE = 'manual_distributor_snapshot' as const

const MAX_ROWS_PER_IMPORT = 500
const MANUAL_UNMAPPED_CATEGORY_ID = 'manual_unmapped'
const MANUAL_UNMAPPED_CATEGORY_LABEL = 'Manual — unmapped category'

export type ManualImportRow = {
  canonicalCategoryId?: string
  legacyPartMapId?: string
  categoryLabel?: string
  mpn: string
  distributor: string
  unitPrice: number | null
  availableInventory: number | null
  leadTimeDays: number | null
  currency?: string
  observedAt?: string
  confidence?: 'authorized_or_core' | 'manual_operator_import'
}

export type ManualImportProvenance = {
  importedBy?: string
  sourceUrl?: string
  sourceFileName?: string
  notes?: string
}

export type ManualImportPayload = {
  source: ManualSource | string
  snapshotDate?: string
  capturedAt?: string
  provenance?: ManualImportProvenance
  rows: ManualImportRow[]
}

export type ManualImportError = {
  code: string
  message: string
}

export type NormalizedManualPayload = {
  source: ManualSource
  snapshotDate: string
  capturedAt: string
  provenance: Required<Pick<ManualImportProvenance, 'importedBy'>> & ManualImportProvenance
  rows: ManualImportRow[]
  warnings: string[]
}

// ── Validation ──────────────────────────────────────────────────────────────

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function isFiniteNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

function inferCanonicalCategoryFromMpn(mpn: string): string | null {
  // PART_MAP is keyed by legacy id; values list the primary + fallback MPNs.
  const upper = (mpn || '').toUpperCase()
  for (const [legacyId, entry] of Object.entries(PART_MAP)) {
    for (const part of entry.parts) {
      if (part.toUpperCase() === upper) return canonicalCategoryId(legacyId)
    }
  }
  return null
}

/** Strict row validation. Returns errors per row (rejected) and a list of
 *  acceptable rows ready for snapshot construction. Per spec: never silently
 *  drop. Unmappable rows go through with a `manual_unmapped` category. */
export function validateManualRows(
  rows: ManualImportRow[],
): { errors: ManualImportError[]; ok: ManualImportRow[]; warnings: string[] } {
  const errors: ManualImportError[] = []
  const ok: ManualImportRow[] = []
  const warnings: string[] = []
  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push({ code: 'rows_required', message: 'rows[] must be a non-empty array.' })
    return { errors, ok, warnings }
  }
  if (rows.length > MAX_ROWS_PER_IMPORT) {
    errors.push({
      code: 'rows_exceed_cap',
      message: `Import capped at ${MAX_ROWS_PER_IMPORT} rows; payload had ${rows.length}.`,
    })
    return { errors, ok, warnings }
  }
  rows.forEach((r, i) => {
    const where = `rows[${i}]`
    if (!r || typeof r !== 'object') {
      errors.push({ code: 'row_not_object', message: `${where}: row must be an object.` })
      return
    }
    if (!r.mpn || typeof r.mpn !== 'string' || r.mpn.trim() === '') {
      errors.push({ code: 'mpn_required', message: `${where}: mpn (string) is required.` })
      return
    }
    if (!r.distributor || typeof r.distributor !== 'string' || r.distributor.trim() === '') {
      errors.push({ code: 'distributor_required', message: `${where}: distributor (string) is required.` })
      return
    }
    if (!isFiniteNumberOrNull(r.unitPrice)) {
      errors.push({ code: 'unit_price_invalid', message: `${where}: unitPrice must be a number or null.` })
      return
    }
    if (!isFiniteNumberOrNull(r.availableInventory)) {
      errors.push({ code: 'inventory_invalid', message: `${where}: availableInventory must be a number or null.` })
      return
    }
    if (!isFiniteNumberOrNull(r.leadTimeDays)) {
      errors.push({ code: 'lead_time_invalid', message: `${where}: leadTimeDays must be a number or null.` })
      return
    }
    if (typeof r.unitPrice === 'number' && r.unitPrice < 0) {
      errors.push({ code: 'unit_price_negative', message: `${where}: unitPrice cannot be negative.` })
      return
    }
    if (typeof r.availableInventory === 'number' && r.availableInventory < 0) {
      errors.push({ code: 'inventory_negative', message: `${where}: availableInventory cannot be negative.` })
      return
    }
    if (typeof r.leadTimeDays === 'number' && r.leadTimeDays < 0) {
      errors.push({ code: 'lead_time_negative', message: `${where}: leadTimeDays cannot be negative.` })
      return
    }
    ok.push({
      ...r,
      mpn: r.mpn.trim(),
      distributor: r.distributor.trim(),
      currency: (r.currency ?? 'USD').toString().trim() || 'USD',
      confidence: r.confidence === 'authorized_or_core' ? 'authorized_or_core' : 'manual_operator_import',
    })
  })
  return { errors, ok, warnings }
}

/** Validate the envelope (source, snapshotDate, etc.) and the rows. Returns
 *  a normalized payload ready for `buildManualSnapshot()`, or a list of errors. */
export function normalizeManualSourceInput(
  payload: ManualImportPayload | unknown,
): { errors: ManualImportError[]; normalized: NormalizedManualPayload | null } {
  const errors: ManualImportError[] = []
  if (!payload || typeof payload !== 'object') {
    errors.push({ code: 'payload_required', message: 'JSON object body required.' })
    return { errors, normalized: null }
  }
  const p = payload as Record<string, any>
  const src = (p.source ?? '').toString().trim()
  if (!ALLOWED_MANUAL_SOURCES.includes(src as ManualSource)) {
    errors.push({
      code: 'source_invalid',
      message: `source must be one of: ${ALLOWED_MANUAL_SOURCES.join(', ')}.`,
    })
    return { errors, normalized: null }
  }
  const snapshotDate = (p.snapshotDate ?? '').toString().trim() || todayUtcDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    errors.push({ code: 'snapshot_date_invalid', message: 'snapshotDate must be YYYY-MM-DD.' })
    return { errors, normalized: null }
  }
  const capturedAt = (p.capturedAt ?? '').toString().trim() || new Date().toISOString()
  // Defensive parse — bad ISO values fall back to now() rather than 502'ing.
  const ts = Date.parse(capturedAt)
  const safeCapturedAt = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString()

  const provIn = (p.provenance && typeof p.provenance === 'object' ? p.provenance : {}) as ManualImportProvenance
  const provenance = {
    importedBy: (provIn.importedBy ?? '').toString().trim() || 'operator',
    sourceUrl: provIn.sourceUrl ? String(provIn.sourceUrl).slice(0, 500) : undefined,
    sourceFileName: provIn.sourceFileName ? String(provIn.sourceFileName).slice(0, 200) : undefined,
    notes: provIn.notes ? String(provIn.notes).slice(0, 1000) : undefined,
  }

  const { errors: rowErrors, ok: rows, warnings } = validateManualRows(p.rows)
  if (rowErrors.length > 0) {
    return { errors: rowErrors, normalized: null }
  }

  return {
    errors: [],
    normalized: {
      source: src as ManualSource,
      snapshotDate,
      capturedAt: safeCapturedAt,
      provenance,
      rows,
      warnings,
    },
  }
}

// ── Snapshot construction ───────────────────────────────────────────────────

function buildSourceObservation(
  source: ManualSource,
  row: ManualImportRow,
  fallbackObservedAt: string,
): SnapshotSourceObservation {
  return {
    source,
    distributor: row.distributor || null,
    unitPrice: row.unitPrice,
    availableInventory: row.availableInventory,
    leadTimeDays: row.leadTimeDays,
    currency: row.currency || 'USD',
    observedAt: row.observedAt && Date.parse(row.observedAt)
      ? new Date(Date.parse(row.observedAt)).toISOString()
      : fallbackObservedAt,
    // Manual rows are always tagged 'manual_operator_import' unless the
    // operator explicitly marked them as authorized_or_core (e.g. they
    // pasted the row directly from an authorized distributor portal).
    confidence: row.confidence === 'authorized_or_core' ? 'authorized_or_core' : 'manual_operator_import',
  }
}

function resolveCanonicalForRow(row: ManualImportRow): {
  canonical: string
  legacyId: string | null
  inferred: 'explicit' | 'legacy_alias' | 'mpn_lookup' | 'unmapped'
} {
  if (row.canonicalCategoryId && row.canonicalCategoryId.trim()) {
    return { canonical: row.canonicalCategoryId.trim(), legacyId: row.legacyPartMapId ?? null, inferred: 'explicit' }
  }
  if (row.legacyPartMapId && row.legacyPartMapId.trim()) {
    const c = canonicalCategoryId(row.legacyPartMapId.trim())
    if (c) return { canonical: c, legacyId: row.legacyPartMapId.trim(), inferred: 'legacy_alias' }
  }
  const inferred = inferCanonicalCategoryFromMpn(row.mpn)
  if (inferred) {
    // Find the legacy id whose primary or fallback matches this MPN.
    const upper = row.mpn.toUpperCase()
    let legacyId: string | null = null
    for (const [legacy, entry] of Object.entries(PART_MAP)) {
      if (entry.parts.some(p => p.toUpperCase() === upper)) { legacyId = legacy; break }
    }
    return { canonical: inferred, legacyId, inferred: 'mpn_lookup' }
  }
  return { canonical: MANUAL_UNMAPPED_CATEGORY_ID, legacyId: null, inferred: 'unmapped' }
}

function buildSkuRecord(
  source: ManualSource,
  row: ManualImportRow,
  fallbackObservedAt: string,
): SnapshotSku {
  const isAuthorized = row.confidence === 'authorized_or_core'
  const inventory = typeof row.availableInventory === 'number' && row.availableInventory > 0 ? row.availableInventory : 0
  return {
    mpn: row.mpn,
    representativeReason: undefined,
    importanceTier: 'primary',
    status: row.unitPrice != null && Number.isFinite(row.unitPrice) ? 'ok' : 'no_match',
    // Manual evidence is not blended into the trusted-available signal pool
    // unless the operator marked it authorized. Default: keep it as a
    // separate corroboration source via sourceObservations only.
    bestTrustedAvailableUnitPrice: isAuthorized && inventory > 0 ? row.unitPrice : null,
    bestTrustedAvailableDistributor: isAuthorized && inventory > 0 ? row.distributor : null,
    bestTrustedAvailableInventory: isAuthorized && inventory > 0 ? row.availableInventory : null,
    bestTrustedQuotedUnitPrice: isAuthorized ? row.unitPrice : null,
    bestAnyUnitPrice: row.unitPrice ?? null,
    totalTrustedAvailableInventory: isAuthorized ? inventory : 0,
    totalBrokerAvailableInventory: 0,
    trustedDistributors: isAuthorized && row.distributor ? [row.distributor] : [],
    sourceObservations: [buildSourceObservation(source, row, fallbackObservedAt)],
    warnings: [],
  }
}

function aggregateCategory(
  legacyId: string | null,
  canonicalId: string,
  categoryLabel: string,
  skus: SnapshotSku[],
): SnapshotCategory {
  const availablePrices = skus
    .map(s => s.bestTrustedAvailableUnitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
  const sortedAvail = availablePrices.slice().sort((a, b) => a - b)
  const totalTrustedInventory = skus.reduce((s, x) => s + (x.totalTrustedAvailableInventory || 0), 0)
  const totalBrokerInventory = skus.reduce((s, x) => s + (x.totalBrokerAvailableInventory || 0), 0)
  const distSet = new Set<string>()
  for (const s of skus) for (const d of s.trustedDistributors) distSet.add(d)

  const med = (xs: number[]): number | null => {
    if (xs.length === 0) return null
    return xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
  }
  const round4 = (n: number) => Math.round(n * 10_000) / 10_000

  return {
    categoryId: legacyId ?? canonicalId,
    canonicalCategoryId: canonicalId,
    categoryLabel,
    representativeSkuCount: skus.length,
    quotedSkuCount: availablePrices.length,
    avgBestTrustedAvailableUnitPrice:
      sortedAvail.length > 0 ? round4(sortedAvail.reduce((s, v) => s + v, 0) / sortedAvail.length) : null,
    medianBestTrustedAvailableUnitPrice: sortedAvail.length > 0 ? round4(med(sortedAvail) as number) : null,
    totalTrustedAvailableInventory: totalTrustedInventory,
    totalBrokerAvailableInventory: totalBrokerInventory,
    trustedDistributorCoverage: Array.from(distSet),
    sampleCoverage: 'manual_operator_import',
    warnings: canonicalId === MANUAL_UNMAPPED_CATEGORY_ID ? ['manual_unmapped_category'] : [],
    skus,
  }
}

/** Build the normalized Snapshot record from a validated payload. */
export function buildManualSnapshot(payload: NormalizedManualPayload): {
  snapshot: Snapshot
  rowCount: number
  unmappedRowCount: number
  warnings: string[]
} {
  const fallbackObservedAt = payload.capturedAt
  // Group rows by canonical id so each category has its full SKU list.
  type Bucket = { legacyId: string | null; canonicalId: string; categoryLabel: string; skus: SnapshotSku[] }
  const buckets = new Map<string, Bucket>()
  let unmappedRowCount = 0
  const warnings: string[] = [...payload.warnings]

  for (const row of payload.rows) {
    const { canonical, legacyId, inferred } = resolveCanonicalForRow(row)
    if (inferred === 'unmapped') {
      unmappedRowCount++
    }
    const labelFromRow = row.categoryLabel?.trim()
    let label = labelFromRow ||
      (canonical === MANUAL_UNMAPPED_CATEGORY_ID
        ? MANUAL_UNMAPPED_CATEGORY_LABEL
        : canonical) // canonical id is human-readable enough as a fallback
    let bucket = buckets.get(canonical)
    if (!bucket) {
      bucket = { legacyId, canonicalId: canonical, categoryLabel: label, skus: [] }
      buckets.set(canonical, bucket)
    } else if (!bucket.legacyId && legacyId) {
      bucket.legacyId = legacyId
    } else if (labelFromRow && bucket.categoryLabel === bucket.canonicalId) {
      // Upgrade label if this row provided a friendlier one.
      bucket.categoryLabel = labelFromRow
    }
    bucket.skus.push(buildSkuRecord(payload.source, row, fallbackObservedAt))
  }

  if (unmappedRowCount > 0) {
    warnings.push(`manual_unmapped_rows:${unmappedRowCount}`)
  }

  const categories: SnapshotCategory[] = Array.from(buckets.values()).map(b =>
    aggregateCategory(b.legacyId, b.canonicalId, b.categoryLabel, b.skus),
  )
  const skuCount = categories.reduce((s, c) => s + c.skus.length, 0)

  const snapshot: Snapshot = {
    snapshotDate: payload.snapshotDate,
    capturedAt: payload.capturedAt,
    dashboard: 'texas_instruments',
    source: payload.source,
    mode: MANUAL_MODE,
    categoryCount: categories.length,
    skuCount,
    callsUsed: 0,
    maxCalls: 0,
    categories,
    metadata: {
      cacheTtlHours: 24,
      quotaNote: 'Manual operator-imported evidence — no paid quota required.',
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      sourceRole: 'manual_distributor_evidence',
      noPaidQuotaRequired: true,
      provenance: payload.provenance,
      rowCount: payload.rows.length,
      unmappedRowCount,
      validationWarningCount: warnings.length,
      warnings,
    } as any,
  }

  return { snapshot, rowCount: payload.rows.length, unmappedRowCount, warnings }
}

/** KV key for a given manual source + UTC date. */
export function manualSnapshotKey(source: ManualSource, date: string): string {
  return `source-snapshots/texas_instruments/${source}/${MANUAL_MODE}/${date}`
}

/** Helper for endpoint param parsing: validates ?source=… */
export function parseManualSourceParam(value: string | undefined | null): ManualSource | null {
  const v = (value ?? '').toString().trim()
  return ALLOWED_MANUAL_SOURCES.includes(v as ManualSource) ? (v as ManualSource) : null
}
