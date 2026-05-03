-- Phase 24A — Read-path indexes for the catalog analytics endpoints.
--
-- Purely additive. Every statement uses CREATE INDEX IF NOT EXISTS so
-- re-applying is safe. No DROPs, no ALTERs, no data mutations.
--
-- Apply via the Cloudflare D1 Console (Workers & Pages → D1 →
-- ti-inventory-history → Console). Migrations 0001–0004 must already
-- be applied.
--
-- Why these specific indexes:
--   - ti_part_number is already PRIMARY KEY; including the redundant
--     index keeps `EXPLAIN QUERY PLAN` happy on older SQLite builds and
--     documents that exact-OPN lookups are intentional (no scan).
--   - generic_part_number speeds up /catalog/family/:gpn (already in
--     0003 as idx_catalog_latest_opn_gpn — this is the redundant
--     IF NOT EXISTS guard for older DBs that may have skipped it).
--   - quantity DESC and normalized_unit_price ASC/DESC drive the
--     /gpn-leaderboard sort orders without full scans.

CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_tipart
  ON ti_catalog_latest_opn (ti_part_number);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_gpn
  ON ti_catalog_latest_opn (generic_part_number);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_quantity
  ON ti_catalog_latest_opn (quantity DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_opn_price
  ON ti_catalog_latest_opn (normalized_unit_price);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_gpn_gpn
  ON ti_catalog_latest_gpn (generic_part_number);

CREATE INDEX IF NOT EXISTS idx_catalog_latest_gpn_total_quantity
  ON ti_catalog_latest_gpn (total_quantity DESC);
