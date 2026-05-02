-- Phase 23C — TI full-catalog snapshot tables (purely additive).
--
-- Apply via the Cloudflare D1 Console (Workers & Pages → D1 →
-- ti-inventory-history → Console). Migrations 0001 and 0002 are
-- already applied; this is purely additive — three new tables, no
-- ALTERs against existing tables.
--
-- ti_catalog_snapshot_run    : one row per /v2/store/products/catalog capture
-- ti_catalog_latest_opn      : current state per orderable part number (UPSERT each capture)
-- ti_catalog_latest_gpn      : current state per generic part number (UPSERT each capture)
--
-- Sizes after first capture (probe-confirmed): ~72,135 OPN rows; GPN
-- count is OPN-count grouped by genericPartNumber (typically much smaller).

-- ── Snapshot-run summary (one row per capture) ─────────────────────────────
CREATE TABLE IF NOT EXISTS ti_catalog_snapshot_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_r2_key TEXT,
  body_byte_size INTEGER,
  total_opns INTEGER,
  total_gpns INTEGER,
  priced_opns INTEGER,
  in_stock_opns INTEGER,
  out_of_stock_opns INTEGER,
  parsed_ok INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_snapshot_run_capturedat
  ON ti_catalog_snapshot_run (captured_at DESC);

-- ── Latest per OPN (replaces on each capture) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ti_catalog_latest_opn (
  ti_part_number TEXT PRIMARY KEY,
  generic_part_number TEXT,
  description TEXT,
  quantity INTEGER,
  limit_qty INTEGER,
  pricing_json TEXT,
  normalized_unit_price REAL,
  normalized_price_qty INTEGER,
  currency TEXT,
  future_inventory_json TEXT,
  minimum_order_quantity INTEGER,
  standard_pack_quantity INTEGER,
  lifecycle TEXT,
  buy_now_url TEXT,
  latest_captured_at TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_gpn
  ON ti_catalog_latest_opn (generic_part_number);
CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_lifecycle
  ON ti_catalog_latest_opn (lifecycle);
CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_quantity
  ON ti_catalog_latest_opn (quantity DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_capturedat
  ON ti_catalog_latest_opn (latest_captured_at DESC);

-- ── Latest per GPN — aggregate of OPNs in the family ──────────────────────
CREATE TABLE IF NOT EXISTS ti_catalog_latest_gpn (
  generic_part_number TEXT PRIMARY KEY,
  opn_count INTEGER NOT NULL,
  stocked_opn_count INTEGER NOT NULL,
  total_quantity INTEGER,
  min_normalized_unit_price REAL,
  median_normalized_unit_price REAL,
  cheapest_opn TEXT,
  highest_inventory_opn TEXT,
  lifecycle_summary TEXT,
  latest_captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_gpn_capturedat
  ON ti_catalog_latest_gpn (latest_captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_latest_gpn_total_quantity
  ON ti_catalog_latest_gpn (total_quantity DESC);
