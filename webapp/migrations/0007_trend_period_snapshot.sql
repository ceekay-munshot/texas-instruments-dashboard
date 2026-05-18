-- Phase 26 — frozen WoW/MoM/QoQ period snapshots.
--
-- A row here is the live-row receipt frozen at the moment a week/month/
-- quarter closed. The trend API reads these and uses them as the cell
-- value + breakdown for closed (historical) rows in the WoW/MoM/QoQ
-- tables, making those rows clickable with the same "Latest capture vs
-- TI capture" receipt the live row shows. Once written, values never
-- drift — re-renders read frozen rows, never recompute.
--
-- Population:
--   • Daily cron / GH Action calls POST /api/ti/trend/snapshot-period.
--     If today is Friday → snapshot WoW WTD row keyed to today (period
--     end = the Friday close). Same for last-day-of-month → MoM, and
--     last-day-of-quarter → QoQ. Re-runs are idempotent via PK.
--   • One-time backfill for already-closed periods in the own-capture
--     era (≥ 2026-05-02), e.g. WoW week ending 2026-05-15.
CREATE TABLE IF NOT EXISTS trend_period_snapshot (
  view                TEXT NOT NULL,       -- 'wow' | 'mom' | 'qoq'
  period_end_date     TEXT NOT NULL,       -- ISO date of the period close
  canonical_id        TEXT NOT NULL,       -- subcategory canonical id
  today_usd           REAL NOT NULL,
  today_date          TEXT NOT NULL,
  anchor_usd          REAL NOT NULL,
  anchor_date         TEXT NOT NULL,
  anchor_label        TEXT NOT NULL,       -- 'TI capture' | 'Historical baseline' | …
  pct                 REAL NOT NULL,
  representative_part TEXT,
  latest_source       TEXT,                -- 'ti_inventory' | 'prices_fallback'
  snapshotted_at      TEXT NOT NULL,
  PRIMARY KEY (view, period_end_date, canonical_id)
);
CREATE INDEX IF NOT EXISTS idx_trend_snap_view_period
  ON trend_period_snapshot (view, period_end_date);
