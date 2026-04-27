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
- **Baselines**: Actual Mouser prices captured 20-Feb-2026 (USD), stored in `src/index.ts`
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
- **Frontend**: Vanilla HTML + React (CDN) + Babel (in-browser) in `public/index.html`
- **Build**: `node build.mjs` — esbuild compiles Worker, copies static files, writes `_routes.json`
- **Routing**: `_routes.json` sends `/api/*` to the Worker; all other paths served as static files by Cloudflare CDN
- **API**: `GET /api/prices` (cached), `GET /api/prices?refresh=true` (force fetch), `GET /api/status`

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
