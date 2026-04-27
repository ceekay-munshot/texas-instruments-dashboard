# TI Product Price Intelligence Dashboard

## Project Overview
- **Name**: TI Price Intelligence Dashboard
- **Goal**: Monitor Texas Instruments semiconductor component pricing across 28 product categories, tracking QoQ % changes from Jun-22 to present with live Mouser Electronics API integration
- **Features**: 16 quarters of verified historical QoQ % data, live Mouser API pricing row, group visibility toggles, CSV export, interactive tooltips with part-level detail

## URLs
- **Production (V1)**: https://texas-instruments-dashboard-final.pages.dev

## V1 Status
- Production verified
- Mouser live API working
- 28 categories supported
- CSV export working
- Refresh button working
- Production commit: `ada3fda`
- Last verified: 2026-04-27

## Data Architecture
- **Historical Data**: Verified QoQ % observations Jun-22 → Mar-26 (16 quarters, 28 categories, hard-coded ground truth in `public/index.html`)
- **Live Data**: Mouser Electronics Search API — real-time unit prices fetched for 2-3 representative TI part numbers per category, averaged and compared against Feb-26 baselines to compute current-quarter QoQ %
- **Baselines**: Actual Mouser prices captured 27-Feb-2026 (USD), stored in `src/index.ts`
- **Storage**: In-memory cache at Worker instance level (6-hour TTL); secrets managed via Cloudflare Pages environment variables
- **Currency**: INR→USD conversion at ₹83.5/$ for Mouser India API responses

### Categories Covered (28 total across 8 groups)
| Group | Categories |
|-------|-----------|
| Power Management | LDO Regulators, AC/DC Switching, DC/DC Switching, Supervisor & Reset, Battery Mgmt |
| Amplifiers | Op-Amps, Instrumentation, Audio Amps |
| Data Converters | ADC, DAC |
| Interface ICs | CAN Transceivers, LIN Transceivers, Ethernet PHYs |
| Isolation | Digital Isolators, Reinforced Isolators |
| Microcontrollers | MSP430, C2000, MSPM0, SimpleLink, Sitara MPU |
| GaN Power | LMG342x (600V), LMG3650 (TOLL), LMG5200 (80V) |
| Data Center Power | 48V Bus Converters, Smart Power Stages, eFuses, Hot-Swap Controllers, TPS536xx (AI Power) |

## User Guide
1. Visit https://texas-instruments-dashboard-final.pages.dev
2. Historical rows (Jun-22 → Mar-26) show verified QoQ % changes — green = price increase, red (brackets) = decrease, bold = ≥5% magnitude
3. Click **⟳ REFRESH LIVE** to fetch current Mouser prices for the live Jun-26 row (takes ~45s for all 28 categories)
4. Hover any live cell (★ Jun-26 row) to see part numbers, exact USD prices, and stock availability
5. Use group toggle buttons to filter categories
6. Click **↓ CSV** to export the full dataset

## Technical Architecture
- **Backend**: Hono Worker (`src/index.ts`) compiled by esbuild → `dist/_worker.js`
- **Frontend (production)**: React app in `src/app.jsx`, compiled by esbuild → `dist/app.js` and referenced from the patched `dist/index.html`. Production ships `src/app.jsx`, **not** the inline JSX block in `public/index.html` — that block is dev-only fallback and is stripped by `build.mjs` on every build.
- **Build**: `node build.mjs` — esbuild compiles Worker + React app, copies static files, patches `index.html`, writes `_routes.json`
- **Routing**: `_routes.json` sends `/api/*` to the Worker; all other paths served as static files by Cloudflare CDN
- **API**: `GET /api/prices` (cached), `GET /api/prices?refresh=true` (force fetch), `GET /api/status`

## Methodology

The dashboard is primarily a **quarter-over-quarter (QoQ) product price monitor** for TI semiconductor categories, with a live row used as an early-warning leading indicator.

- **Historical rows (Jun-22 → Mar-26)** show **QoQ price change vs the previous quarter / prior comparable captured period**. They are pre-computed and hardcoded in `webapp/src/app.jsx` (`HIST` constant). Adding a new quarter requires a code change. The Mar-26 row carries a small `est` superscript because it was captured mid-quarter (27-Feb-26) and may be revised when a finalized snapshot is taken.
- **Live row (★)** is a **live price monitor — not a finalized quarterly row**. It is computed as: current Mouser qty=1 spot price vs the **latest baseline**, expressed as a percentage. Same part number, same quantity break on both ends of the comparison.
- **Latest baseline** is currently the **Q1-26 snapshot captured 2026-02-27**. Baseline values are hardcoded in `webapp/src/index.ts` (`BASELINES`). Comparison framing is exposed under the constant set `BASELINE_DATE`, `BASELINE_PERIOD_LABEL`, `BASELINE_LABEL`, `BASELINE_DISPLAY`, `BASELINE_DESCRIPTION`, `BASELINE_ROLLOVER_POLICY`, `BASELINE_REVIEW_AFTER_DAYS`.
- **Live row is not formal company guidance.** It is an early-warning monitor used to spot abnormal up/down moves before the next finalized quarterly baseline is captured.
- **Baseline rollover is manual.** It is *not* automatic. To roll forward (e.g. capture Q2-26):
  1. Run a controlled live fetch at the chosen end-of-quarter cutoff (`/api/prices?refresh=true`).
  2. Update `BASELINES` in `src/index.ts` with the new prices.
  3. Update `BASELINE_DATE`, `BASELINE_PERIOD_LABEL`, and `BASELINE_DISPLAY` in the same file.
  4. Add a new column to `HIST` in `src/app.jsx` reflecting the QoQ change for the closing quarter.
  5. Commit and deploy.
- **Default pricing basis** is qty=1 unit price for all parts. One documented exception: **LMG3650 (TOLL)** has no unit pricing on Mouser and is tracked at its reel/2000 price. The tooltip on that category surfaces a `⚠ reel/2000 price — no unit break` note.
- **Currency**: USD throughout. Mouser India (INR) responses are converted at ₹83.5 / USD before comparison.
- **`L` superscript** on a live cell means the value came from a successful live Mouser fetch in the current request. A cell without `L` (showing `—` or `…`) means that category did not return live data this fetch (rate-limit, no parts, etc.).
- **Live data update cadence**: prices update through the Cloudflare cached API (6 h TTL) — there is no continuous tick-by-tick streaming.
  - The frontend runs a **30-minute auto-check while the tab is visible**, using the cached path only (`/api/prices`, no `refresh=true`). It also performs one cached check whenever the tab becomes visible after being hidden. This never burns Mouser quota.
  - The manual **⟳ Refresh Live** button still bypasses cache (`/api/prices?refresh=true`) and fetches fresh from Mouser.
- **Baseline staleness watch**: the API returns `baselineAgeDays` (computed at request time) and `baselineIsStale = baselineAgeDays > BASELINE_REVIEW_AFTER_DAYS` (default 90 days). When stale, the UI shows a subtle amber "Baseline review due" note. This is informational only — the baseline values do not auto-roll.

### Signal Summary (above the table)

A compact panel that derives a price-monitor signal layer from the live row only — it is **not company guidance** and not a reported financial metric.

- **Source data**: live Mouser qty=1 spot prices vs the 27-Feb-26 anchor for the categories that returned successfully in the current fetch.
- **Tone**: one of `Broad inflation`, `Selective inflation`, `Mixed`, `Broad deflation`, or `Insufficient live data` (when fewer than 50% of categories are live). Determined from breadth (% of basket positive) and median % change.
- **Breadth**: count and percentage of live categories with a positive change vs anchor.
- **Median / Average**: across the live categories only.
- **Top 5 movers** in each direction, plus **strongest / weakest product group** by group-average change.
- **Anomaly flags** (thresholds applied to the absolute live % change vs anchor):
  - `⚡ inflation flag` — change ≥ **+5%**
  - `⬇ deflation flag` — change ≤ **−5%**
  - `◆ major outlier` — `|change| ≥ 10%`
- **Signal sentence**: a one-line interpretation generated from the metrics above.

If `liveData` is missing the panel shows "Waiting for live Mouser data." If only a subset of categories returned live, the panel marks itself "partial coverage" and notes the count in the interpretation line.

## Deployment

**Platform**: Cloudflare Pages (Git integration with this repo's `main` branch)

| Setting | Value |
|---|---|
| Project name | `texas-instruments-dashboard-final` |
| Root directory | `webapp` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| Required production secret | `MOUSER_API_KEY` |
| Compatibility flags | `nodejs_compat` (declared in `wrangler.jsonc`) |

The `MOUSER_API_KEY` secret is set under **Settings → Variables and Secrets → Production** on the Pages project (encrypted, type: Secret). After adding or changing the secret, redeploy — Pages does not pick up new secret values on the existing deployment.

**Tech stack**: Hono 4.7 + TypeScript + esbuild + Mouser Electronics API.

## Security

- `.dev.vars` is **local only** and must **never** be committed. Both `webapp/.gitignore` and the repo root `.gitignore` exclude it.
- The `MOUSER_API_KEY` belongs only in one of two places:
  - `webapp/.dev.vars` for local development (gitignored), or
  - The Cloudflare Pages **Production** secret for the live deployment.
- Never commit the key to source, never paste it into PRs/issues/chat, never include it in build artifacts.
- The original `.tar.gz` import archive contained a copy of `.dev.vars`; the root `.gitignore` also excludes `*.tar.gz` to prevent accidental re-commit. Treat any key that has been distributed in such an archive as compromised — rotate before relying on it long-term.

## Multi-source roadmap (Phase 6 — Nexar single-SKU test)

The dashboard currently runs on a single source (Mouser). We are starting the work to add a second source — **Octopart / Nexar** — for cross-checking, broader distributor coverage, and inventory + price-break visibility. The current stage is **single-SKU validation only**: no full-basket fetches against Nexar yet, no UI integration of Nexar-derived numbers into the live row.

### Endpoints

- `GET /api/sources/status` — reports configuration state for each source (Mouser, Octopart/Nexar) without echoing secret values.
- `GET /api/nexar/test?mpn=TPS7A8300RGWR` — single-SKU Nexar test. Defaults to `TPS7A8300RGWR` if `mpn` is omitted. Returns a normalized JSON shape (see below). When secrets are missing, returns `{ configured: false, status: "not_configured" }` cleanly with no error.

### Required secrets

| Secret | Where it's used |
|---|---|
| `NEXAR_CLIENT_ID` | Nexar OAuth2 `client_credentials` token request |
| `NEXAR_CLIENT_SECRET` | Nexar OAuth2 `client_credentials` token request |

Set both locally in `webapp/.dev.vars` (gitignored) and on Cloudflare Pages as Secret-typed environment variables. Without them, `/api/nexar/test` always returns the `not_configured` payload — it never errors.

### Trusted distributor methodology

Nexar returns offers from many sellers — authorized distributors, regional resellers, marketplaces, and brokers. We **do not blindly average** these into the core pricing/inventory signal. Instead each offer is classified as:

- `authorized_or_core` — matches our trusted allowlist
- `marketplace_or_broker` — named seller that does not match the allowlist
- `unknown` — seller name is missing or empty

The trusted allowlist (`webapp/src/data/sourceTypes.ts`):
**Mouser, DigiKey, Texas Instruments, Arrow, Newark, Farnell, element14, RS, TME, Future Electronics, Avnet.**
Matching is case-insensitive with word-boundary regex; ambiguous bare codes like "RS" alone are not matched (only "RS Components", "RS Pro", etc.) to avoid false positives. Trusted distributor names are canonicalized for deduplication so the same distributor's Cut Tape / Tape & Reel / Custom Reel offers collapse into one entry in `trustedDistributors`.

### Price metric methodology (post-Phase 7 hardening)

Trusted distributors often quote multiple offers per part — qty=1 unit pricing on Cut Tape, plus high-MOQ pricing on Tape & Reel where the per-unit number drops at quantity ≥ 1000. Naive "lowest unit price" comparison lets the high-MOQ reel price win even when **inventory is zero and you would have to buy 3000 pieces**. That is wrong for shortage monitoring. Phase 7 separates price metrics into three intent-clear fields:

| Field | Definition | Use as |
|---|---|---|
| **`bestTrustedAvailableUnitPrice`** | Lowest trusted unit price among offers with `inventory > 0`, preferring qty ≤ 10 with no `quantityBasisWarning`; falls back to any in-stock trusted offer if no preferred match exists. | **Primary signal.** This is what to chart, what to alert on, and what to use for shortage monitoring. |
| `bestTrustedQuotedUnitPrice` | Lowest trusted unit price across **all** trusted offers regardless of inventory or MOQ. | Reference / floor quote. May be a 3000-piece reel with zero stock — accompanying warnings make this explicit. |
| `bestAnyUnitPrice` | Lowest unit price across **all** offers including brokers. | Market-floor / debug reference only. **Not** investor-grade. The `best_any_price_from_broker` warning flags when this came from a marketplace seller. |

`bestTrustedUnitPrice` is preserved as a backward-compat alias. It equals `bestTrustedAvailableUnitPrice` whenever any trusted offer is buyable; otherwise it falls back to `bestTrustedQuotedUnitPrice`, and the `warnings` array surfaces `best_trusted_quote_zero_inventory` / `best_trusted_quote_requires_high_moq` as appropriate.

Each best-* metric carries companion fields (`*Distributor`, `*Inventory`, `*QtyBasis`) so a consumer can immediately see which distributor/SKU/qty-break the price came from without re-scanning `allOffers[]`.

### Top-level warnings

The `warnings: string[]` array is methodology-explicit and meant to be surfaced verbatim. Possible values:

- `best_trusted_quote_requires_high_moq` — the cheapest trusted-quoted offer comes from a price break with quantity > 10 (e.g. a 3000-piece reel quote).
- `best_trusted_quote_zero_inventory` — the cheapest trusted-quoted offer is currently out of stock.
- `best_any_price_from_broker` — the lowest unit price across all offers comes from a marketplace/broker seller, not a trusted distributor.
- `broker_inventory_excluded_from_core_signal` — present whenever any broker offer is in the result. Reminds consumers that broker inventory and broker prices are **not** blended into trusted aggregates.

### Inventory aggregations

| Field | Definition |
|---|---|
| `totalTrustedInventory` | Sum of all trusted offer inventories (legacy field kept for backward compatibility). |
| **`totalTrustedAvailableInventory`** | Sum of trusted inventories where `inventory > 0` only — intent-clear name for shortage monitoring. |
| `totalBrokerInventory` / `totalBrokerAvailableInventory` | Same pair for broker / marketplace offers. Tracked separately and **never** blended into the trusted total. |

### Normalized response (success path)

```jsonc
{
  "configured": true,
  "status": "ok",
  "source": "octopart_nexar",
  "requestedMpn": "TPS7A8300RGWR",
  "matchedMpn": "TPS7A8300RGWR",
  "manufacturer": "Texas Instruments",
  "description": "…",
  "fetchedAt": "2026-04-28T…Z",
  "sellerCount": 12,
  "offerCount": 18,
  "trustedOfferCount": 4,
  "brokerOfferCount": 14,
  "totalTrustedInventory": 12345,
  "totalBrokerInventory": 678,
  "bestTrustedUnitPrice": 7.0861,
  "bestAnyUnitPrice": 6.92,
  "trustedDistributors": ["DigiKey", "Mouser", "Texas Instruments"],
  "allOffers": [
    {
      "distributor": "DigiKey",
      "distributorTier": "authorized_or_core",
      "inventory": 4123,
      "moq": 1,
      "packaging": "Cut Tape",
      "unitPrice": 7.12,
      "unitPriceQty": 1,
      "currency": "USD",
      "priceBreaks": [{ "quantity": 1, "price": 7.12, "currency": "USD" }, /* … */],
      "clickUrl": "https://…"
    }
  ]
}
```

`unitPrice` always prefers the lowest-quantity break with `quantity ≤ 10`. If a seller only quotes higher-MOQ pricing, the lowest-available break is used and `quantityBasisWarning: true` is set on that offer.

### What this does NOT do (intentionally)

- It does not run a full 28-category fetch against Nexar — that's the Phase 6+ next step after we've validated the response shape on real data.
- It does not feed Nexar prices into the live row, the Signal Summary, or the CSV. The existing Mouser flow is unchanged.
- It does not blend broker prices into the trusted average.

### Phase 8 — tiny basket preview

`GET /api/nexar/basket-preview` is a **quota-bounded multi-SKU validation endpoint**. It is **not** the full production multi-SKU system. It exists to prove that category-level averaging works end-to-end against real Nexar data without burning the Evaluation app's limited supply quota.

**Bounded behavior:**

- **Max 4 Nexar MPN calls per invocation**, enforced by `BASKET_PREVIEW_MAX_CALLS` in `webapp/src/data/tiBasket.ts`. The endpoint refuses to run if the configured basket exceeds that cap.
- **Tiny preview basket**: 2 categories × 2 SKUs = 4 MPNs total. All 4 SKUs already exist as primary/fallback parts in `PART_MAP`; we are not introducing new SKUs.
- **No daily jobs.** No cron, no background timers, no long-term cache. The endpoint runs only on direct request.
- **Quota errors isolated** via `Promise.allSettled`. A failure on one SKU returns a sanitized error stub for that SKU without blocking the others; the top-level `status` reports `ok` / `partial` / `error` accordingly.
- The response always includes `remainingEvaluationQuotaNote: "Evaluation app is limited; do not run full basket until paid/approved plan."` and `basketStatus: "needs_expansion"` to keep the constraint visible.

**Category-average methodology:**

- Per-category `avgBestTrustedAvailableUnitPrice` and `medianBestTrustedAvailableUnitPrice` are computed **only from the SKUs in that category whose `bestTrustedAvailableUnitPrice` is non-null** — i.e. they had at least one in-stock trusted offer with usable unit pricing.
- If every SKU in a category has null `bestTrustedAvailableUnitPrice` (e.g. all out of stock at trusted distributors), the average **falls back** to `bestTrustedQuotedUnitPrice` and the category emits the `category_average_uses_quoted_fallback` warning.
- Broker prices are **never blended** into category averages. Broker inventory is reported separately as `totalBrokerAvailableInventory` per SKU and per category.
- `sampleCoverage: "limited"` is always returned in this phase — 2 SKUs per category is below the threshold for production confidence.

**SKUs in the current preview basket:**

| Category | Group | SKU | Role |
|---|---|---|---|
| LDO Regulators | Power Management | `TPS7A8300RGWR` | primary |
| LDO Regulators | Power Management | `TPS7A4501DCQR` | legacy_fallback |
| Battery Management | Power Management | `BQ25896RTWT` | primary |
| Battery Management | Power Management | `BQ76952PFBR` | legacy_fallback |

**Full daily capture against the full 28-category basket requires a paid/approved Nexar supply plan.** Once that plan is in place, raise `BASKET_PREVIEW_MAX_CALLS` and expand `PHASE_8_BASKET_PREVIEW` (or replace it with a fuller config) — but do not change either constant under the Evaluation app.

## Local Development
```bash
npm install
npm run build          # esbuild compile + copy static assets to dist/
npm run dev            # wrangler pages dev on port 3000 (needs .dev.vars with MOUSER_API_KEY)
```

`.dev.vars` (never commit):
```
MOUSER_API_KEY=your-key-here
```
