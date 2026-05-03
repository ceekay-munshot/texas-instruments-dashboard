-- Phase 24C — Per-canonical-subcategory rollup tables.
--
-- Purely additive. Every statement uses CREATE … IF NOT EXISTS so
-- re-applying is safe. No DROPs, no ALTERs, no data mutations against
-- ti_catalog_latest_opn / ti_catalog_latest_gpn. The rollup tables
-- are downstream/derived data — the rebuild endpoint can re-create
-- them at any time from the existing OPN/GPN tables.
--
-- Apply via the Cloudflare D1 Console (Workers & Pages → D1 →
-- ti-inventory-history → Console). Migrations 0001–0005 must already
-- be applied.
--
-- Two tables:
--   ti_catalog_rollup_latest   — current state, one row per canonical
--                                subcategory (≤ 28 rows in steady
--                                state). UPSERT on every rebuild.
--   ti_catalog_rollup_history  — append-only audit log; one row per
--                                (snapshot, canonical subcategory).
--                                Only written when finalize lands a
--                                fresh real_catalog snapshot. Stays
--                                empty until at least one new snapshot
--                                is captured after Phase 24C ships.

CREATE TABLE IF NOT EXISTS ti_catalog_rollup_latest (
  canonical_subcategory       TEXT PRIMARY KEY,
  canonical_group             TEXT NOT NULL,
  opn_count                   INTEGER NOT NULL,
  gpn_count                   INTEGER NOT NULL,
  priced_opn_count            INTEGER NOT NULL,
  stocked_opn_count           INTEGER NOT NULL,
  out_of_stock_opn_count      INTEGER NOT NULL,
  stocked_pct                 REAL,
  total_quantity              INTEGER,
  median_normalized_unit_price REAL,
  min_normalized_unit_price   REAL,
  max_normalized_unit_price   REAL,
  cheapest_opn                TEXT,
  highest_inventory_opn       TEXT,
  lifecycle_summary           TEXT,
  mapping_confidence_summary  TEXT,
  latest_captured_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rollup_latest_group
  ON ti_catalog_rollup_latest (canonical_group);

CREATE TABLE IF NOT EXISTS ti_catalog_rollup_history (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at                 TEXT NOT NULL,
  snapshot_run_id             INTEGER,
  canonical_subcategory       TEXT NOT NULL,
  canonical_group             TEXT NOT NULL,
  opn_count                   INTEGER NOT NULL,
  gpn_count                   INTEGER NOT NULL,
  priced_opn_count            INTEGER NOT NULL,
  stocked_opn_count           INTEGER NOT NULL,
  out_of_stock_opn_count      INTEGER NOT NULL,
  stocked_pct                 REAL,
  total_quantity              INTEGER,
  median_normalized_unit_price REAL,
  min_normalized_unit_price   REAL,
  max_normalized_unit_price   REAL,
  cheapest_opn                TEXT,
  highest_inventory_opn       TEXT,
  lifecycle_summary           TEXT,
  mapping_confidence_summary  TEXT
);

CREATE INDEX IF NOT EXISTS idx_rollup_history_capturedat
  ON ti_catalog_rollup_history (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_rollup_history_subcat_capturedat
  ON ti_catalog_rollup_history (canonical_subcategory, captured_at DESC);
