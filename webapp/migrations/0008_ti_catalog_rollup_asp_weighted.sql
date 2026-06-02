-- Phase 27 — stock-weighted ASP on the catalog rollups.
--
-- Adds asp_stock_weighted to both rollup tables. This is the
-- UBS-grade price level: SUM(price * quantity) / SUM(quantity) across
-- every in-stock, priced OPN in the canonical subcategory — i.e. UBS's
-- `Dollar Inventory / Unit Inventory`. It replaces the single
-- representative-part price the trend index reads today (e.g. LDO shows
-- one $7.21 part; the real stock-weighted ASP across 2,447 LDO parts is
-- ~$0.72, matching UBS's $0.73).
--
-- Additive ALTERs only. SQLite ADD COLUMN defaults existing rows to
-- NULL; the next rollup rebuild populates ti_catalog_rollup_latest, and
-- ti_catalog_rollup_history accumulates one weighted-ASP point per
-- weekly catalog snapshot from here forward.
--
-- NOTE: past history rows stay NULL. Per-OPN price/quantity for prior
-- snapshots is not retained (ti_catalog_latest_opn is overwritten each
-- ingest), so historical weighted ASP is unrecoverable — the series
-- builds forward. The WoW/MoM/QoQ rewire and like-for-like index depend
-- on >= 2 weighted-ASP points existing in history.
--
-- Apply once via the D1 Console (ti-inventory-history). ADD COLUMN has
-- no IF NOT EXISTS in SQLite; do not re-run.

ALTER TABLE ti_catalog_rollup_latest  ADD COLUMN asp_stock_weighted REAL;
ALTER TABLE ti_catalog_rollup_history ADD COLUMN asp_stock_weighted REAL;
