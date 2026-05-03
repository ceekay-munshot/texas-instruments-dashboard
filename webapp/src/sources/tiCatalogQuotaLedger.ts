// ── Phase 23C.4 — TI catalog quota ledger ───────────────────────────────────
// Self-governing quota guard for the rate-limited TI Store full-catalog
// endpoint (/v2/store/products/catalog: 1 call / 4 hours, 6 / 24 hours).
//
// Operators do NOT have to remember the safe window. The ledger records
// every real_catalog attempt; the helper computes whether the next call
// is safe; the workflow's preflight step blocks unsafe runs BEFORE the
// runner ever touches TI. synthetic_chunk runs never write here.
//
// Hard rules:
//   - Do NOT log or persist secrets, OAuth tokens, raw TI bodies, or
//     X-Capture-Secret values.
//   - Do NOT count synthetic_chunk attempts toward the quota — they
//     skip the ledger entirely (workflow does not call preflight).
//   - Do NOT create more than one in_flight row at a time. Concurrent
//     real_catalog runs are blocked at the preflight stage.

import type { CatalogD1 } from './tiCatalogIngest'

/** Per spec: 1 call / 4h with a 10-minute safety buffer baked in, plus a
 *  hard 6/24h cap. Both are enforced in readQuotaStatus. */
export const MIN_HOURS_BETWEEN_CATALOG_CALLS = 4
export const SAFETY_BUFFER_MINUTES = 10
export const MAX_ATTEMPTS_PER_24H = 6
const MIN_GAP_MS = (MIN_HOURS_BETWEEN_CATALOG_CALLS * 60 + SAFETY_BUFFER_MINUTES) * 60_000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60_000

/** TI quota gives 6 calls per rolling 24h. After a 429 we wait 24h
 *  before recommending a retry — unless a later success shows the
 *  cooldown already cleared. */
const POST_429_COOLDOWN_MS = 24 * 60 * 60_000

export type QuotaLedgerStatus =
  | 'in_flight'
  | 'success'
  | 'rate_limited'
  | 'failed_before_fetch'
  | 'failed_after_fetch'
  | 'failed_chunk_write'
  | 'failed_validation'

const ALLOWED_COMPLETE_STATUSES: ReadonlyArray<QuotaLedgerStatus> = [
  'success',
  'rate_limited',
  'failed_before_fetch',
  'failed_after_fetch',
  'failed_chunk_write',
  'failed_validation',
]

export function isAllowedCompleteStatus(s: string): s is Exclude<QuotaLedgerStatus, 'in_flight'> {
  return (ALLOWED_COMPLETE_STATUSES as readonly string[]).includes(s)
}

export type QuotaLedgerRow = {
  id: string
  source: string
  mode: string
  attempted_at: string
  started_at: string | null
  finished_at: string | null
  status: QuotaLedgerStatus
  http_status: number | null
  ti_error_code: string | null
  products_parsed: number | null
  opn_rows_upserted: number | null
  notes: string | null
  created_at: string
}

export type QuotaStatus = {
  safeToRun: boolean
  reason: string
  lastCatalogAttemptAt: string | null
  lastSuccessfulFetchAt: string | null
  last429At: string | null
  attemptsLast24h: number
  maxAttemptsPer24h: number
  minimumHoursBetweenCatalogCalls: number
  safetyBufferMinutes: number
  nextSafeRunAt: string | null
  minutesUntilSafe: number
  inFlight: boolean
  currentServerTime: string
}

function isoNow(): string {
  return new Date().toISOString()
}

function safeUuid(): string {
  // crypto.randomUUID is available in Workers and modern Node; fall back
  // to a low-quality but unique-enough id otherwise so the ledger row
  // can still be inserted (the ledger is an ops/audit log, not a key).
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Read the latest real_catalog attempt + counts and turn them into the
 *  same QuotaStatus shape /quota/status returns and /quota/preflight
 *  uses to decide. mode IN ('real_catalog') filters synthetic out. */
export async function readQuotaStatus(d1: CatalogD1): Promise<QuotaStatus> {
  const now = Date.now()
  const currentServerTime = new Date(now).toISOString()

  let lastAttempt: { attempted_at: string; status: QuotaLedgerStatus } | null = null
  let lastSuccess: { attempted_at: string } | null = null
  let last429: { attempted_at: string } | null = null
  let attemptsLast24h = 0
  let inFlight = false

  try {
    const lastRow = await d1
      .prepare(
        `SELECT attempted_at, status FROM ti_catalog_quota_ledger
         WHERE mode = 'real_catalog'
         ORDER BY attempted_at DESC LIMIT 1`,
      )
      .all<{ attempted_at: string; status: QuotaLedgerStatus }>()
    const r = lastRow.results?.[0]
    if (r) lastAttempt = { attempted_at: r.attempted_at, status: r.status }

    const lastSuccessRow = await d1
      .prepare(
        `SELECT attempted_at FROM ti_catalog_quota_ledger
         WHERE mode = 'real_catalog' AND status = 'success'
         ORDER BY attempted_at DESC LIMIT 1`,
      )
      .all<{ attempted_at: string }>()
    if (lastSuccessRow.results?.[0]) lastSuccess = { attempted_at: lastSuccessRow.results[0].attempted_at }

    const last429Row = await d1
      .prepare(
        `SELECT attempted_at FROM ti_catalog_quota_ledger
         WHERE mode = 'real_catalog' AND status = 'rate_limited'
         ORDER BY attempted_at DESC LIMIT 1`,
      )
      .all<{ attempted_at: string }>()
    if (last429Row.results?.[0]) last429 = { attempted_at: last429Row.results[0].attempted_at }

    const since24h = new Date(now - TWENTY_FOUR_HOURS_MS).toISOString()
    const countRow = await d1
      .prepare(
        `SELECT COUNT(*) AS cnt FROM ti_catalog_quota_ledger
         WHERE mode = 'real_catalog' AND attempted_at >= ?`,
      )
      .bind(since24h)
      .all<{ cnt: number }>()
    attemptsLast24h = Number(countRow.results?.[0]?.cnt ?? 0)

    const inFlightRow = await d1
      .prepare(
        `SELECT 1 AS yes FROM ti_catalog_quota_ledger
         WHERE mode = 'real_catalog' AND status = 'in_flight'
         LIMIT 1`,
      )
      .all<{ yes: number }>()
    inFlight = Boolean(inFlightRow.results?.[0]?.yes)
  } catch {
    // Backend reachable but query failed (e.g. table not migrated yet).
    // Surface as conservative 'unsafe' rather than 'safe-by-default'.
    return {
      safeToRun: false,
      reason: 'quota_ledger_unreadable',
      lastCatalogAttemptAt: null,
      lastSuccessfulFetchAt: null,
      last429At: null,
      attemptsLast24h: 0,
      maxAttemptsPer24h: MAX_ATTEMPTS_PER_24H,
      minimumHoursBetweenCatalogCalls: MIN_HOURS_BETWEEN_CATALOG_CALLS,
      safetyBufferMinutes: SAFETY_BUFFER_MINUTES,
      nextSafeRunAt: null,
      minutesUntilSafe: 0,
      inFlight: false,
      currentServerTime,
    }
  }

  let safeToRun = true
  let reason = 'safe'
  let nextSafeRunAt: string | null = null
  let minutesUntilSafe = 0

  if (inFlight) {
    safeToRun = false
    reason = 'in_flight_run_exists'
  } else if (lastAttempt) {
    const lastAttemptMs = new Date(lastAttempt.attempted_at).getTime()
    const elapsed = now - lastAttemptMs
    if (elapsed < MIN_GAP_MS) {
      safeToRun = false
      reason = 'min_gap_not_elapsed'
      const safeMs = lastAttemptMs + MIN_GAP_MS
      nextSafeRunAt = new Date(safeMs).toISOString()
      minutesUntilSafe = Math.max(0, Math.ceil((safeMs - now) / 60_000))
    }
  }

  if (safeToRun && attemptsLast24h >= MAX_ATTEMPTS_PER_24H) {
    safeToRun = false
    reason = 'daily_attempt_cap_reached'
    // Nearest safe time is when the oldest attempt in the window ages
    // out — but we don't have its timestamp readily here without
    // another query. Use the conservative "wait at least 4h+buffer"
    // figure as a floor.
    const safeMs = now + MIN_GAP_MS
    nextSafeRunAt = new Date(safeMs).toISOString()
    minutesUntilSafe = Math.max(minutesUntilSafe, Math.ceil((safeMs - now) / 60_000))
  }

  if (safeToRun && last429) {
    const last429Ms = new Date(last429.attempted_at).getTime()
    const lastSuccessMs = lastSuccess ? new Date(lastSuccess.attempted_at).getTime() : 0
    // Only honor the post-429 cooldown when no later success cleared it.
    if (lastSuccessMs <= last429Ms) {
      const elapsed = now - last429Ms
      if (elapsed < POST_429_COOLDOWN_MS) {
        safeToRun = false
        reason = 'post_429_cooldown_active'
        const safeMs = last429Ms + POST_429_COOLDOWN_MS
        nextSafeRunAt = new Date(safeMs).toISOString()
        minutesUntilSafe = Math.ceil((safeMs - now) / 60_000)
      }
    }
  }

  return {
    safeToRun,
    reason,
    lastCatalogAttemptAt: lastAttempt?.attempted_at ?? null,
    lastSuccessfulFetchAt: lastSuccess?.attempted_at ?? null,
    last429At: last429?.attempted_at ?? null,
    attemptsLast24h,
    maxAttemptsPer24h: MAX_ATTEMPTS_PER_24H,
    minimumHoursBetweenCatalogCalls: MIN_HOURS_BETWEEN_CATALOG_CALLS,
    safetyBufferMinutes: SAFETY_BUFFER_MINUTES,
    nextSafeRunAt,
    minutesUntilSafe,
    inFlight,
    currentServerTime,
  }
}

export type PreflightResult =
  | { safeToRun: true; runId: string; status: QuotaStatus }
  | { safeToRun: false; status: QuotaStatus }

export async function preflightAndReserve(
  d1: CatalogD1,
  args: { source: string; notes?: string | null },
): Promise<PreflightResult> {
  const status = await readQuotaStatus(d1)
  if (!status.safeToRun) return { safeToRun: false, status }
  const runId = safeUuid()
  const attemptedAt = isoNow()
  try {
    await d1
      .prepare(
        `INSERT INTO ti_catalog_quota_ledger
         (id, source, mode, attempted_at, started_at, finished_at,
          status, http_status, ti_error_code, products_parsed,
          opn_rows_upserted, notes, created_at)
         VALUES (?, ?, 'real_catalog', ?, ?, NULL,
                 'in_flight', NULL, NULL, NULL,
                 NULL, ?, ?)`,
      )
      .bind(runId, args.source, attemptedAt, attemptedAt, args.notes ?? null, attemptedAt)
      .run()
  } catch (e) {
    // Preflight insert failed — surface as not-safe so the caller does
    // not proceed without an audit row.
    const failedStatus: QuotaStatus = {
      ...status,
      safeToRun: false,
      reason: 'quota_ledger_write_failed',
    }
    return { safeToRun: false, status: failedStatus }
  }
  // Re-read after insert so the returned status reflects inFlight=true.
  const fresh = await readQuotaStatus(d1)
  return { safeToRun: true, runId, status: fresh }
}

export type CompleteRunArgs = {
  runId: string
  status: Exclude<QuotaLedgerStatus, 'in_flight'>
  httpStatus?: number | null
  tiErrorCode?: string | null
  productsParsed?: number | null
  opnRowsUpserted?: number | null
  notes?: string | null
}

export type CompleteRunResult = {
  updated: boolean
  reason: string | null
}

export async function completeRun(d1: CatalogD1, args: CompleteRunArgs): Promise<CompleteRunResult> {
  if (!args.runId) return { updated: false, reason: 'missing_run_id' }
  if (!isAllowedCompleteStatus(args.status)) return { updated: false, reason: 'invalid_status' }
  const finishedAt = isoNow()
  try {
    const stmt = d1
      .prepare(
        `UPDATE ti_catalog_quota_ledger
         SET status = ?, finished_at = ?, http_status = ?, ti_error_code = ?,
             products_parsed = ?, opn_rows_upserted = ?, notes = COALESCE(?, notes)
         WHERE id = ? AND status = 'in_flight'`,
      )
      .bind(
        args.status,
        finishedAt,
        Number.isFinite(args.httpStatus as number) ? args.httpStatus : null,
        typeof args.tiErrorCode === 'string' ? args.tiErrorCode.slice(0, 64) : null,
        Number.isFinite(args.productsParsed as number) ? args.productsParsed : null,
        Number.isFinite(args.opnRowsUpserted as number) ? args.opnRowsUpserted : null,
        typeof args.notes === 'string' ? args.notes.slice(0, 512) : null,
        args.runId,
      )
    const res: any = await stmt.run()
    const changes = res?.meta?.changes ?? res?.changes
    if (typeof changes === 'number' && changes <= 0) {
      return { updated: false, reason: 'no_in_flight_row_for_id' }
    }
    return { updated: true, reason: null }
  } catch (e) {
    return { updated: false, reason: 'd1_update_failed' }
  }
}
