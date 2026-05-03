-- Phase 23C.4 — TI catalog quota ledger.
--
-- Records every real_catalog attempt against the rate-limited
-- /v2/store/products/catalog endpoint so the quota helper can decide
-- whether the next attempt is safe BEFORE the runner touches TI.
-- synthetic_chunk and per-OPN store calls (ti-inventory-capture)
-- never write here — only the chunked full-catalog ingest pipeline
-- (preflight/complete) and the legacy single-shot capture path do.
--
-- Lifecycle:
--   1. preflight  → INSERT row with status='in_flight', attempted_at=now
--   2. complete   → UPDATE same row to status=success / rate_limited /
--                   failed_*; set finished_at + diagnostics. The
--                   in-flight check during preflight prevents two
--                   concurrent runs from racing.
--
-- Index choices:
--   - attempted_at DESC for fast "last attempt" / "attempts in window"
--     reads.
--   - (status, attempted_at DESC) for fast in-flight detection and
--     last-success / last-429 lookups without scanning the whole table.

CREATE TABLE IF NOT EXISTS ti_catalog_quota_ledger (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  ti_error_code TEXT,
  products_parsed INTEGER,
  opn_rows_upserted INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_quota_attempted_at
  ON ti_catalog_quota_ledger (attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_quota_status_attempted_at
  ON ti_catalog_quota_ledger (status, attempted_at DESC);
