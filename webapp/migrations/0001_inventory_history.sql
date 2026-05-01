-- Phase 21A — TI inventory & pricing history schema.
-- Append-only snapshot table; one row per (part, capture). Latest values are
-- still served from KV for the customer view; this table powers trend / signal
-- computation. To apply on Cloudflare D1:
--
--   wrangler d1 create ti-inventory-history
--   wrangler d1 execute ti-inventory-history --file=migrations/0001_inventory_history.sql --remote
--
-- The runtime falls back to a per-day KV history tier when this DB isn't
-- bound, so the dashboard works on day one and starts using D1 the moment
-- the operator finishes provisioning.

CREATE TABLE IF NOT EXISTS ti_inventory_price_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderable_part_number TEXT NOT NULL,
  generic_part_number TEXT,
  category TEXT,
  subcategory TEXT,
  basket TEXT,
  captured_at TEXT NOT NULL,
  quantity_available INTEGER,
  price_available INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  price_breaks_json TEXT,
  normalized_unit_price REAL,
  normalized_price_qty INTEGER,
  order_limit INTEGER,
  future_inventory_json TEXT,
  lead_time_weeks INTEGER,
  lifecycle_status TEXT,
  okay_to_order INTEGER,
  source_inventory TEXT,
  source_pricing TEXT,
  capture_status TEXT NOT NULL,
  warnings_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_part_capturedat
  ON ti_inventory_price_snapshot (orderable_part_number, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_capturedat
  ON ti_inventory_price_snapshot (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_basket_capturedat
  ON ti_inventory_price_snapshot (basket, captured_at DESC);

-- Companion universe table — populated lazily once a catalog sync exists.
-- Defined now so /api/ti/universe/summary in a later phase can join cleanly.
CREATE TABLE IF NOT EXISTS ti_part_universe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_part_number TEXT,
  orderable_part_number TEXT NOT NULL UNIQUE,
  display_name TEXT,
  category TEXT,
  subcategory TEXT,
  basket TEXT,
  source TEXT,
  lifecycle_status TEXT,
  package TEXT,
  dashboard_priority TEXT,
  is_tracked INTEGER NOT NULL DEFAULT 1,
  tracking_tier TEXT NOT NULL DEFAULT 'core',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_universe_basket
  ON ti_part_universe (basket);
CREATE INDEX IF NOT EXISTS idx_universe_tracking_tier
  ON ti_part_universe (tracking_tier);
