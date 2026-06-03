-- Phase 28 — part-level price history for the broad like-for-like index.
--
-- One row per orderable part per weekly 72k-catalog capture. The lfl/snapshot
-- endpoint (called by the catalog ingest workflow after finalize) appends a
-- snapshot of ti_catalog_latest_opn here, stamped with a single capture date.
-- The like-for-like engine reads this to compute a fixed-weight constant-basket
-- price index: the geometric mean of per-part price relatives over parts
-- present in both periods, so mix shifts and stock swings cannot move it.
--
-- NOTE: the worker also runs this DDL via ensureLflSchema() (CREATE TABLE IF
-- NOT EXISTS) on first snapshot, so the table self-creates in prod without a
-- separate migration run. This file is the canonical repo record.

CREATE TABLE IF NOT EXISTS ti_catalog_opn_price_history (
  ti_part_number TEXT NOT NULL,
  captured_date TEXT NOT NULL,            -- YYYY-MM-DD, one snapshot per capture
  canonical_subcategory TEXT,             -- computed via per-subcategory predicate at snapshot time
  normalized_unit_price REAL NOT NULL,
  quantity INTEGER,
  PRIMARY KEY (ti_part_number, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_opn_price_hist_sub_date
  ON ti_catalog_opn_price_history (canonical_subcategory, captured_date);
CREATE INDEX IF NOT EXISTS idx_opn_price_hist_date
  ON ti_catalog_opn_price_history (captured_date);
