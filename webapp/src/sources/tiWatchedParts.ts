// ── Phase 20B — TI watched-parts master list & Product Info dashboard layer ─
// Investor-grade universe of Texas Instruments parts that we monitor via the
// Product Information API (approved). Inventory & pricing — gated behind the
// pending Store API approval — are intentionally absent from this module: we
// only call the Product Information adapter here, and the response carries
// whatever lifecycle / lead-time / inventory-status metadata TI exposes on
// that endpoint. The Store API remains disabled.
//
// Design notes:
//   - This file is imported by the SERVER (webapp/src/index.ts) only. It must
//     not be imported by the React app — its content is not secret, but the
//     /api/ti/watched-parts/product-info endpoint that consumes it IS gated
//     by SNAPSHOT_CAPTURE_SECRET, and we don't want the watched-list or
//     adapter logic ever traveling on the client.
//   - Each watched part declares both a `genericPartNumber` (GPN — what the
//     analyst usually types) and a `preferredOrderablePartNumber` (OPN — the
//     specific package/temperature variant that TI's Product Information API
//     returns 200 for). The fetcher tries the OPN first, falls back to the
//     GPN, and the response always carries both.
//   - Baskets group parts into the seven coverage areas the dashboard surfaces
//     to the investor audience. They map roughly onto TI's reporting segments
//     and the moats the company emphasises in its earnings disclosures.

import {
  fetchTiProductInfo,
  type TiEnv,
  type TiProductInfo,
} from './tiDirect'

export type WatchedBasket =
  | 'analog_signal_chain'
  | 'power_management'
  | 'embedded_processing'
  | 'automotive'
  | 'industrial'
  | 'data_center_server_power'
  | 'wireless_infra_rf'

export const WATCHED_BASKET_LABEL: Record<WatchedBasket, string> = {
  analog_signal_chain: 'Analog / Signal Chain',
  power_management: 'Power Management',
  embedded_processing: 'Embedded Processing',
  automotive: 'Automotive',
  industrial: 'Industrial',
  data_center_server_power: 'Data Center / Server Power',
  wireless_infra_rf: 'Wireless Infra / RF',
}

export type DashboardPriority = 'high' | 'medium' | 'low'

export type DemandProxyType =
  | 'industrial_capex'
  | 'auto_volume'
  | 'auto_adas'
  | 'data_center_capex'
  | 'wireless_5g_buildout'
  | 'consumer_iot'
  | 'embedded_lifecycle'
  | 'analog_franchise'
  | 'precision_instrumentation'
  | 'battery_management_ev'
  | 'general_purpose'

export type WatchedPart = {
  /** What an analyst usually types (TI's "Generic Product Identifier"). */
  genericPartNumber: string
  /** Canonical orderable variant (TI's "Identifier"). The Product Information
   *  API returns 200 for OPNs but commonly 404s on GPNs, so we try this first. */
  preferredOrderablePartNumber: string
  /** Investor-facing display label (concise, no package suffix). */
  displayName: string
  basket: WatchedBasket
  dashboardPriority: DashboardPriority
  /** One-line investment thesis tied to this specific part. */
  thesisReason: string
  demandProxyType: DemandProxyType
  /** Operator-facing notes — never customer-visible. */
  notes?: string
}

// ── Master watched-parts universe (32 parts across 7 baskets) ───────────────
// Curated from the existing TI basket catalog (tiBasket.ts), TI's published
// product family pages, and the company's Q1-26 segment commentary. OPNs are
// the canonical orderable variants TI's catalog returns 200 for; if any of
// these 404s after deploy, the server-side fetcher logs the warning and
// passes the raw GPN to the adapter so the existing GPN→OPN fallback map
// (tiDirect.ts) can rescue the call.
export const TI_WATCHED_PARTS: WatchedPart[] = [
  // ── Analog / Signal Chain ────────────────────────────────────────────────
  {
    genericPartNumber: 'OPA376',
    preferredOrderablePartNumber: 'OPA376AIDBVR',
    displayName: 'OPA376 Precision Op-Amp',
    basket: 'analog_signal_chain',
    dashboardPriority: 'high',
    thesisReason: 'Flagship low-noise precision op-amp; broad design-in across instrumentation and medical reads as a clean proxy for TI\'s analog franchise discipline.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'INA226',
    preferredOrderablePartNumber: 'INA226AIDGSR',
    displayName: 'INA226 Current/Power Monitor',
    basket: 'analog_signal_chain',
    dashboardPriority: 'high',
    thesisReason: 'Bidirectional digital current monitor — designed into server, telecom, and battery rails. Lead-time movement here tracks data-center and industrial power monitoring demand.',
    demandProxyType: 'precision_instrumentation',
  },
  {
    genericPartNumber: 'ADS1115',
    preferredOrderablePartNumber: 'ADS1115IRUGR',
    displayName: 'ADS1115 16-bit Delta-Sigma ADC',
    basket: 'analog_signal_chain',
    dashboardPriority: 'medium',
    thesisReason: 'Workhorse 16-bit ADC for sensor signal chains; long-cycle TI part, useful counterpoint to high-speed converters.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'ADS8685',
    preferredOrderablePartNumber: 'ADS8685IPW',
    displayName: 'ADS8685 16-bit SAR ADC',
    basket: 'analog_signal_chain',
    dashboardPriority: 'medium',
    thesisReason: 'Mid-range SAR ADC popular in factory automation and test equipment — a useful precision-analog demand signal.',
    demandProxyType: 'precision_instrumentation',
  },
  {
    genericPartNumber: 'TLV2372',
    preferredOrderablePartNumber: 'TLV2372IDGKR',
    displayName: 'TLV2372 Dual Rail-to-Rail Op-Amp',
    basket: 'analog_signal_chain',
    dashboardPriority: 'low',
    thesisReason: 'Cost-sensitive dual op-amp; used as a low-priority breadth check for the broad analog category.',
    demandProxyType: 'general_purpose',
  },

  // ── Power Management ─────────────────────────────────────────────────────
  {
    genericPartNumber: 'TPS7A8300',
    preferredOrderablePartNumber: 'TPS7A8300RGWR',
    displayName: 'TPS7A8300 LDO Regulator',
    basket: 'power_management',
    dashboardPriority: 'high',
    thesisReason: 'High-PSRR low-noise LDO; distributor-liquid anchor SKU and the canonical reference for the dashboard\'s LDO category.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'TPS7A4501',
    preferredOrderablePartNumber: 'TPS7A4501DCQR',
    displayName: 'TPS7A4501 1.5A LDO',
    basket: 'power_management',
    dashboardPriority: 'medium',
    thesisReason: 'Higher-current adjustable LDO; secondary corroboration point for the LDO category — different package and form factor.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'TPS54360',
    preferredOrderablePartNumber: 'TPS54360BDDA',
    displayName: 'TPS54360B Buck Converter',
    basket: 'power_management',
    dashboardPriority: 'high',
    thesisReason: 'Industry-standard 3.5A 60V buck; ubiquitous in industrial and automotive 24V/48V rails. A primary read on industrial DC-DC pricing power.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'LM5176',
    preferredOrderablePartNumber: 'LM5176PWPR',
    displayName: 'LM5176 Buck-Boost Controller',
    basket: 'power_management',
    dashboardPriority: 'medium',
    thesisReason: 'Wide-VIN buck-boost — designed into industrial and automotive transient-tolerant rails.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'UCC28180',
    preferredOrderablePartNumber: 'UCC28180D',
    displayName: 'UCC28180 PFC Controller',
    basket: 'power_management',
    dashboardPriority: 'medium',
    thesisReason: 'Active PFC controller; AC-DC bridge component for white-goods and industrial PSUs.',
    demandProxyType: 'industrial_capex',
  },

  // ── Embedded Processing ──────────────────────────────────────────────────
  {
    genericPartNumber: 'MSP430FR2355',
    preferredOrderablePartNumber: 'MSP430FR2355TRHAT',
    displayName: 'MSP430FR2355 FRAM MCU',
    basket: 'embedded_processing',
    dashboardPriority: 'high',
    thesisReason: 'Flagship FRAM low-power MCU; reads as a current-generation TI MCU signal.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'MSP430G2553',
    preferredOrderablePartNumber: 'MSP430G2553IPW28R',
    displayName: 'MSP430G2553 Legacy MCU',
    basket: 'embedded_processing',
    dashboardPriority: 'low',
    thesisReason: 'Long-tail legacy MSP430; lifecycle stage signal — useful counterpoint to the FR2355 line.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'TM4C123GH6PM',
    preferredOrderablePartNumber: 'TM4C123GH6PMI',
    displayName: 'TM4C123 ARM Cortex-M4',
    basket: 'embedded_processing',
    dashboardPriority: 'medium',
    thesisReason: 'Tiva-C ARM Cortex-M4 — bridge between the legacy MSP430 and TI\'s newer Cortex lines.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'AM3358',
    preferredOrderablePartNumber: 'AM3358BZCZA80',
    displayName: 'AM3358 Sitara Processor',
    basket: 'embedded_processing',
    dashboardPriority: 'medium',
    thesisReason: 'Sitara ARM Cortex-A8 processor; widely used in HMI / industrial gateways. A read on TI\'s industrial embedded platform persistence.',
    demandProxyType: 'industrial_capex',
  },

  // ── Automotive ───────────────────────────────────────────────────────────
  {
    genericPartNumber: 'TCAN1042',
    preferredOrderablePartNumber: 'TCAN1042DRBTQ1',
    displayName: 'TCAN1042-Q1 CAN FD Transceiver',
    basket: 'automotive',
    dashboardPriority: 'high',
    thesisReason: 'AEC-Q100 CAN FD transceiver — designed into virtually every modern ECU. A direct read on auto production volume.',
    demandProxyType: 'auto_volume',
  },
  {
    genericPartNumber: 'TCAN1051',
    preferredOrderablePartNumber: 'TCAN1051DRQ1',
    displayName: 'TCAN1051-Q1 CAN Transceiver',
    basket: 'automotive',
    dashboardPriority: 'medium',
    thesisReason: 'High-speed automotive CAN transceiver; secondary corroboration point for the auto-volume signal alongside TCAN1042.',
    demandProxyType: 'auto_volume',
  },
  {
    genericPartNumber: 'BQ76952',
    preferredOrderablePartNumber: 'BQ76952PFBR',
    displayName: 'BQ76952 16S Battery Monitor',
    basket: 'automotive',
    dashboardPriority: 'high',
    thesisReason: 'Up-to-16S Li-ion battery monitor; 48V mild-hybrid and EV pack designs. A direct EV-electrification signal.',
    demandProxyType: 'battery_management_ev',
  },
  {
    genericPartNumber: 'TPS65381',
    preferredOrderablePartNumber: 'TPS65381AQDAPRQ1',
    displayName: 'TPS65381-Q1 Safety PMIC',
    basket: 'automotive',
    dashboardPriority: 'high',
    thesisReason: 'AEC-Q100 functional-safety PMIC for ADAS and powertrain; widely-cited TI ADAS attach part.',
    demandProxyType: 'auto_adas',
  },
  {
    genericPartNumber: 'TPS92691',
    preferredOrderablePartNumber: 'TPS92691QPWPRQ1',
    displayName: 'TPS92691-Q1 LED Driver',
    basket: 'automotive',
    dashboardPriority: 'medium',
    thesisReason: 'Automotive LED headlamp/matrix-light driver — reads as an exterior-lighting attach signal.',
    demandProxyType: 'auto_volume',
  },

  // ── Industrial ───────────────────────────────────────────────────────────
  {
    genericPartNumber: 'BQ25896',
    preferredOrderablePartNumber: 'BQ25896RTWT',
    displayName: 'BQ25896 USB Battery Charger',
    basket: 'industrial',
    dashboardPriority: 'medium',
    thesisReason: 'Single-cell USB-PD battery charger; portable industrial instruments and handheld terminals.',
    demandProxyType: 'consumer_iot',
  },
  {
    genericPartNumber: 'DRV8323',
    preferredOrderablePartNumber: 'DRV8323HRTAR',
    displayName: 'DRV8323 BLDC Gate Driver',
    basket: 'industrial',
    dashboardPriority: 'high',
    thesisReason: 'Three-phase BLDC gate driver for cordless tools, drones, and industrial motor control. A clean motor-electrification signal.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'ISO1042',
    preferredOrderablePartNumber: 'ISO1042BQDWVRQ1',
    displayName: 'ISO1042 Isolated CAN Transceiver',
    basket: 'industrial',
    dashboardPriority: 'medium',
    thesisReason: 'Galvanically-isolated CAN transceiver for industrial and EV charging — TI\'s isolation franchise read.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'AMC1311',
    preferredOrderablePartNumber: 'AMC1311BDWVR',
    displayName: 'AMC1311 Isolated Amplifier',
    basket: 'industrial',
    dashboardPriority: 'medium',
    thesisReason: 'Reinforced-isolation amplifier for solar inverters, motor drives, EV chargers — clean industrial-electrification read.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'SN65HVD75',
    preferredOrderablePartNumber: 'SN65HVD75DR',
    displayName: 'SN65HVD75 RS-485 Transceiver',
    basket: 'industrial',
    dashboardPriority: 'low',
    thesisReason: 'RS-485 transceiver — long-cycle factory-floor fieldbus part, breadth corroboration for the industrial basket.',
    demandProxyType: 'industrial_capex',
  },

  // ── Data Center / Server Power ───────────────────────────────────────────
  {
    genericPartNumber: 'TPS546D24',
    preferredOrderablePartNumber: 'TPS546D24ARVFR',
    displayName: 'TPS546D24A 40A SWIFT Buck',
    basket: 'data_center_server_power',
    dashboardPriority: 'high',
    thesisReason: 'High-density 40A point-of-load for server VRM and accelerator power planes. A direct read on data-center capex through TI\'s server-power franchise.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'TPS53679',
    preferredOrderablePartNumber: 'TPS53679RSBR',
    displayName: 'TPS53679 Multiphase VR Controller',
    basket: 'data_center_server_power',
    dashboardPriority: 'high',
    thesisReason: 'Multiphase D-CAP+ controller for CPU/GPU core rails. Reads as a hyperscaler / accelerator buildout signal.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'LMG3522R030',
    preferredOrderablePartNumber: 'LMG3522R030RQSR',
    displayName: 'LMG3522R030 GaN Power Stage',
    basket: 'data_center_server_power',
    dashboardPriority: 'medium',
    thesisReason: 'GaN integrated power stage — flagship of TI\'s GaN franchise; reads as the high-efficiency server-PSU and AI-power signal.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'CSD17578Q5A',
    preferredOrderablePartNumber: 'CSD17578Q5A',
    displayName: 'CSD17578Q5A NexFET MOSFET',
    basket: 'data_center_server_power',
    dashboardPriority: 'low',
    thesisReason: 'NexFET 30V power MOSFET — sync-buck workhorse for server POL stages. Low priority but useful breadth for the basket.',
    demandProxyType: 'data_center_capex',
  },

  // ── Wireless Infra / RF ──────────────────────────────────────────────────
  {
    genericPartNumber: 'AFE7799',
    preferredOrderablePartNumber: 'AFE7799IABJ',
    displayName: 'AFE7799 Wireless Infra AFE',
    basket: 'wireless_infra_rf',
    dashboardPriority: 'high',
    thesisReason: 'Quad-channel transceiver AFE — purpose-built for 5G massive-MIMO radios. Direct read on wireless infra capex through TI.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'LMX2820',
    preferredOrderablePartNumber: 'LMX2820RTCR',
    displayName: 'LMX2820 RF Synthesizer',
    basket: 'wireless_infra_rf',
    dashboardPriority: 'medium',
    thesisReason: 'Wideband RF PLL/VCO synthesizer — used in test-equipment and wireless infra LO chains. Captures TI\'s precision-RF franchise.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'LMK04832',
    preferredOrderablePartNumber: 'LMK04832NKDT',
    displayName: 'LMK04832 Clock Jitter Cleaner',
    basket: 'wireless_infra_rf',
    dashboardPriority: 'medium',
    thesisReason: 'JESD204B/C clock jitter cleaner; data-converter and radio reference clock for 5G and high-speed instrumentation.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'CC1352P',
    preferredOrderablePartNumber: 'CC1352P1F3RGZR',
    displayName: 'CC1352P Sub-1GHz/2.4GHz Wireless MCU',
    basket: 'wireless_infra_rf',
    dashboardPriority: 'low',
    thesisReason: 'Multi-protocol wireless MCU — IoT and smart-meter end markets, breadth corroboration for the wireless basket.',
    demandProxyType: 'consumer_iot',
  },
]

// ── Aggregate metadata ──────────────────────────────────────────────────────

export type WatchedBasketSummary = {
  basket: WatchedBasket
  basketLabel: string
  partCount: number
  highPriorityCount: number
}

export function summarizeWatchedBaskets(): WatchedBasketSummary[] {
  const buckets = new Map<WatchedBasket, WatchedBasketSummary>()
  for (const part of TI_WATCHED_PARTS) {
    const existing = buckets.get(part.basket)
    if (existing) {
      existing.partCount += 1
      if (part.dashboardPriority === 'high') existing.highPriorityCount += 1
    } else {
      buckets.set(part.basket, {
        basket: part.basket,
        basketLabel: WATCHED_BASKET_LABEL[part.basket],
        partCount: 1,
        highPriorityCount: part.dashboardPriority === 'high' ? 1 : 0,
      })
    }
  }
  return Array.from(buckets.values())
}

// ── Phase 20D — Inventory snapshot capture adapter ──────────────────────────
// Translates the static watched-parts universe into the input shape consumed
// by the public-inventory snapshot capture in tiPartSignal.ts. Kept thin so
// the capture pipeline remains the single source of truth for sanitization.

export type WatchedPartCaptureSeed = {
  partNumber: string
  basket: string
  displayName: string
  thesisReason: string
  demandProxyType: string
  dashboardPriority: DashboardPriority
  genericPartNumberHint: string
}

export const WATCHED_PARTS_FALLBACK_SEED: WatchedPartCaptureSeed = {
  partNumber: 'AFE7799IABJ',
  basket: WATCHED_BASKET_LABEL.wireless_infra_rf,
  displayName: 'AFE7799 Wireless Infra AFE',
  thesisReason: 'Quad-channel transceiver AFE — purpose-built for 5G massive-MIMO radios. Direct read on wireless infra capex through TI.',
  demandProxyType: 'wireless_5g_buildout',
  dashboardPriority: 'high',
  genericPartNumberHint: 'AFE7799',
}

export function getWatchedPartsCaptureInputs(): WatchedPartCaptureSeed[] {
  if (!Array.isArray(TI_WATCHED_PARTS) || TI_WATCHED_PARTS.length === 0) {
    return [WATCHED_PARTS_FALLBACK_SEED]
  }
  return TI_WATCHED_PARTS.map(p => ({
    partNumber: p.preferredOrderablePartNumber,
    basket: WATCHED_BASKET_LABEL[p.basket],
    displayName: p.displayName,
    thesisReason: p.thesisReason,
    demandProxyType: p.demandProxyType,
    dashboardPriority: p.dashboardPriority,
    genericPartNumberHint: p.genericPartNumber,
  }))
}

// ── Normalized product metadata response shape ──────────────────────────────
// One row per watched part. Mirrors the spec in the Phase 20B brief: only
// the public, non-pricing fields exposed by the Product Information API.

export type WatchedPartProductInfo = {
  basket: WatchedBasket
  basketLabel: string
  genericPartNumber: string
  preferredOrderablePartNumber: string
  /** What the adapter actually queried successfully (may equal preferredOPN
   *  or — if a fallback path was needed — the GPN/OPN that resolved). */
  resolvedPartNumber: string | null
  displayName: string
  dashboardPriority: DashboardPriority
  thesisReason: string
  demandProxyType: DemandProxyType
  description: string | null
  lifecycleStatus: string | null
  package: string | null
  leadTimeWeeks: number | null
  inventoryStatus: string | null
  okayToOrder: boolean | null
  qualityReliability: Record<string, unknown> | null
  parametric: Record<string, unknown> | null
  source: 'Texas Instruments Product Information API'
  status: TiProductInfo['status']
  warnings: string[]
  fetchedAt: string
}

export type WatchedPartsProductInfoBundle = {
  generatedAt: string
  totalParts: number
  configured: boolean
  parts: WatchedPartProductInfo[]
  baskets: WatchedBasketSummary[]
  summary: {
    totalWatchedParts: number
    activeParts: number
    longestLeadTimeWeeks: number | null
    longestLeadTimePart: string | null
    partsOkayToOrder: number
    basketsCovered: number
    failedFetches: number
  }
  /** When the adapter is not configured, parts is empty and this carries the
   *  reason the operator can fix without reading server logs. */
  notConfiguredReason?: string
}

// ── Fetcher ─────────────────────────────────────────────────────────────────
// Iterates the watched-parts universe sequentially (with a small inter-call
// gap to keep us under any TI per-app rate limits), calling fetchTiProductInfo
// for each. Always returns a fully-populated bundle even if individual parts
// fail — a single 404 should never collapse the dashboard.

const INTER_CALL_DELAY_MS = 120

function basketCoverage(parts: WatchedPart[]): WatchedBasketSummary[] {
  const summaries = summarizeWatchedBaskets()
  // Filter to only the baskets that actually have entries; useful when we
  // ever short the list for testing.
  const watchedBaskets = new Set(parts.map(p => p.basket))
  return summaries.filter(s => watchedBaskets.has(s.basket))
}

/** Single-row fetch — exposed so unit tests / debug endpoints can call it. */
export async function fetchWatchedPartProductInfo(
  env: TiEnv,
  watched: WatchedPart,
): Promise<WatchedPartProductInfo> {
  // Try the preferred OPN first. The adapter has its own fallback table for
  // GPN → OPN, so if the OPN is wrong we can still recover by passing the
  // GPN on a second attempt.
  let result = await fetchTiProductInfo(env, watched.preferredOrderablePartNumber)
  const warnings = [...result.warnings]
  if (result.status === 'no_match' && watched.preferredOrderablePartNumber !== watched.genericPartNumber) {
    warnings.push('ti_watched_opn_404_retrying_with_gpn')
    const fallback = await fetchTiProductInfo(env, watched.genericPartNumber)
    if (fallback.status === 'ok') {
      result = fallback
      warnings.push(...fallback.warnings)
    } else {
      // Keep the OPN failure but record both warning streams.
      warnings.push(...fallback.warnings)
    }
  }
  return {
    basket: watched.basket,
    basketLabel: WATCHED_BASKET_LABEL[watched.basket],
    genericPartNumber: watched.genericPartNumber,
    preferredOrderablePartNumber: watched.preferredOrderablePartNumber,
    resolvedPartNumber: result.resolvedPartNumber ?? null,
    displayName: watched.displayName,
    dashboardPriority: watched.dashboardPriority,
    thesisReason: watched.thesisReason,
    demandProxyType: watched.demandProxyType,
    description: result.description,
    lifecycleStatus: result.lifecycleStatus,
    package: result.package,
    leadTimeWeeks: result.leadTimeWeeks,
    inventoryStatus: result.inventoryStatus,
    okayToOrder: result.okayToOrder,
    qualityReliability: result.qualityReliability,
    parametric: result.parametric,
    source: 'Texas Instruments Product Information API',
    status: result.status,
    warnings,
    fetchedAt: result.fetchedAt,
  }
}

export async function fetchWatchedPartsProductInfo(
  env: TiEnv,
): Promise<WatchedPartsProductInfoBundle> {
  const generatedAt = new Date().toISOString()
  const baskets = basketCoverage(TI_WATCHED_PARTS)
  // Surface the not-configured case with a friendly bundle rather than calling
  // through to the adapter for every part — avoids 32 wasted fetch attempts
  // in misconfigured environments.
  const probe = await fetchWatchedPartProductInfo(env, TI_WATCHED_PARTS[0])
  if (probe.status === 'not_configured' || probe.status === 'token_failed') {
    return {
      generatedAt,
      totalParts: TI_WATCHED_PARTS.length,
      configured: false,
      parts: [],
      baskets,
      summary: {
        totalWatchedParts: TI_WATCHED_PARTS.length,
        activeParts: 0,
        longestLeadTimeWeeks: null,
        longestLeadTimePart: null,
        partsOkayToOrder: 0,
        basketsCovered: baskets.length,
        failedFetches: TI_WATCHED_PARTS.length,
      },
      notConfiguredReason:
        probe.status === 'not_configured'
          ? 'TI adapter not configured — set TI_CLIENT_ID, TI_CLIENT_SECRET, and TI_API_ENV=production.'
          : 'TI OAuth token request failed — see /api/ti/status for diagnostics.',
    }
  }

  // First call already populated `probe`. Iterate the remaining parts.
  const parts: WatchedPartProductInfo[] = [probe]
  for (let i = 1; i < TI_WATCHED_PARTS.length; i++) {
    if (INTER_CALL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS))
    }
    parts.push(await fetchWatchedPartProductInfo(env, TI_WATCHED_PARTS[i]))
  }

  // ── Summary cards ────────────────────────────────────────────────────────
  const ACTIVE_LIFECYCLE = new Set(['ACTIVE', 'PRODUCTION', 'PRODUCT', 'AVAILABLE'])
  const isActive = (lc: string | null) => {
    if (!lc) return false
    const upper = lc.trim().toUpperCase()
    if (ACTIVE_LIFECYCLE.has(upper)) return true
    return upper.startsWith('ACTIVE')
  }
  let activeParts = 0
  let okayToOrderCount = 0
  let longest: { weeks: number; label: string } | null = null
  let failedFetches = 0
  const coveredBaskets = new Set<WatchedBasket>()
  for (const row of parts) {
    if (row.status === 'ok') {
      coveredBaskets.add(row.basket)
      if (isActive(row.lifecycleStatus)) activeParts += 1
      if (row.okayToOrder === true) okayToOrderCount += 1
      if (typeof row.leadTimeWeeks === 'number' && Number.isFinite(row.leadTimeWeeks)) {
        if (!longest || row.leadTimeWeeks > longest.weeks) {
          longest = { weeks: row.leadTimeWeeks, label: row.displayName }
        }
      }
    } else {
      failedFetches += 1
    }
  }
  return {
    generatedAt,
    totalParts: TI_WATCHED_PARTS.length,
    configured: true,
    parts,
    baskets,
    summary: {
      totalWatchedParts: TI_WATCHED_PARTS.length,
      activeParts,
      longestLeadTimeWeeks: longest?.weeks ?? null,
      longestLeadTimePart: longest?.label ?? null,
      partsOkayToOrder: okayToOrderCount,
      basketsCovered: coveredBaskets.size,
      failedFetches,
    },
  }
}
