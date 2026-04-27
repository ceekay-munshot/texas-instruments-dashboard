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

- **Historical rows (Jun-22 → Mar-26)** are verified QoQ percentage changes for each category. The Mar-26 row is marked with a small `est` superscript because it was captured mid-quarter (27-Feb-26) and may be revised once the quarter closes.
- **Live row (★)** is a **live price monitor**, not a reported financial-quarter metric. It is computed as: current Mouser qty=1 spot price ÷ baseline price captured 27-Feb-2026, expressed as a percentage. Same part number, same quantity break in both ends of the comparison.
- **Live row label** in the UI is "★ Live" / "Live vs 27-Feb-26 anchor" — wording chosen to avoid confusion with formal company-reported QTD/quarter metrics.
- **Default pricing basis** is qty=1 unit price for all parts. One exception: **LMG3650 (TOLL)** has no unit pricing on Mouser and is tracked at its reel/2000 price. The tooltip on that category shows a `⚠ reel/2000 price — no unit break` note.
- **Currency**: USD throughout. Mouser India (INR) responses are converted at ₹83.5 / USD before comparison.
- **`L` superscript** on a live cell means the value came from a successful live Mouser fetch in the current request. A cell without `L` (showing `—` or `…`) means that category did not return live data this fetch (rate-limit, no parts, etc.).

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
