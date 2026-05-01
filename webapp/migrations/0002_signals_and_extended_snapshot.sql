-- Phase 21A — extend the existing snapshot table and add a signal table.
--
-- Apply via the Cloudflare D1 Console (Workers & Pages → D1 →
-- ti-inventory-history → Console). Migration 0001 is already applied —
-- this is purely additive: ALTER TABLE adds nullable columns and a unique
-- index for idempotent INSERT OR IGNORE writes; CREATE TABLE adds the new
-- ti_inventory_price_signal table.

-- ── Extend ti_inventory_price_snapshot with investor-facing context plus
--    the supply / inventory / pricing / lead-time / source-confidence flags
--    that were previously only present on the public TiPartSignalPublic
--    shape but not persisted. All new columns are nullable so existing rows
--    stay valid.
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN display_name TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN demand_proxy_type TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN dashboard_priority TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN supply_status TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN inventory_signal TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN pricing_signal TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN lead_time_signal TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN source_confidence TEXT;
ALTER TABLE ti_inventory_price_snapshot ADD COLUMN created_at TEXT;

-- Idempotent inserts: with this UNIQUE index in place, INSERT OR IGNORE
-- silently no-ops when a row with the same (orderable_part_number,
-- captured_at) already exists. Lets us safely re-run a batch capture.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_part_capturedat
  ON ti_inventory_price_snapshot (orderable_part_number, captured_at);

-- ── New computed-signal table. One row per (part, asOf). Rewritten on
--    every capture batch so /api/ti/inventory/signals/latest can serve a
--    fast read without recomputing from history on each request.
CREATE TABLE IF NOT EXISTS ti_inventory_price_signal (
  id TEXT PRIMARY KEY,
  orderable_part_number TEXT NOT NULL,
  generic_part_number TEXT,
  basket TEXT,
  display_name TEXT,
  as_of TEXT NOT NULL,
  latest_quantity_available INTEGER,
  previous_quantity_available INTEGER,
  inventory_delta INTEGER,
  inventory_pct_delta REAL,
  latest_normalized_unit_price REAL,
  previous_normalized_unit_price REAL,
  price_delta REAL,
  price_pct_delta REAL,
  observations_count INTEGER NOT NULL DEFAULT 0,
  signal_type TEXT NOT NULL,
  signal_strength TEXT NOT NULL,
  explanation TEXT,
  confidence TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_part_asof
  ON ti_inventory_price_signal (orderable_part_number, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_signal_basket_asof
  ON ti_inventory_price_signal (basket, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_signal_type_asof
  ON ti_inventory_price_signal (signal_type, as_of DESC);
