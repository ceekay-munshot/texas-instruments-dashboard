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

/** Phase 22.1 — sub-category one level finer than the 7 baskets, used by
 *  the customer-facing category heatmap (e.g. 'Buck converters', 'GaN power',
 *  'CAN/LIN transceivers'). Free-form because TI's taxonomy is broad and
 *  the dashboard never has to enumerate every value — just bucket and tally. */
export type WatchedSubcategory =
  | 'LDO regulators' | 'Buck converters' | 'Buck-boost converters' | 'Boost converters'
  | 'PFC controllers' | 'Supervisors' | 'Hot-swap / eFuse' | 'Gate drivers'
  | 'Op-amps' | 'Instrumentation amps' | 'Audio amps' | 'Current/power monitors'
  | 'ADCs' | 'DACs' | 'Isolation amps' | 'Digital isolators'
  | 'CAN/LIN transceivers' | 'RS-485 transceivers' | 'Ethernet PHYs'
  | 'Battery management' | 'Safety PMIC' | 'LED drivers'
  | 'Motor drivers'
  | 'Embedded MCU' | 'Embedded MPU' | 'Safety MCU'
  | 'Wireless MCU' | 'RF synthesizers' | 'Clock distribution' | 'Radar'
  | 'Multi-phase VR' | 'Power stages' | 'GaN power' | 'Power MOSFETs'
  | 'PoE controllers' | 'Bus converters'
  | (string & {})

/** Phase 22.1 — confidence in the OPN suffix being correct. HIGH = the
 *  Mouser snapshot pipeline already hits this part successfully OR a prior
 *  capture validated it. MEDIUM = real TI part family but the exact OPN
 *  suffix needs the diagnostic to confirm before joining production. */
export type WatchedConfidence = 'high' | 'medium'

/** Phase 22.1 — gate that controls whether a part flows into daily capture.
 *  Production capture filters on 'validated' (default for the original 32);
 *  staged additions start as 'pending' and only flip to 'validated' after
 *  the auth-gated validation endpoint confirms TI Store responds 200 with
 *  parsed price breaks. 'failed' rows stay out of capture forever (until an
 *  operator replaces the OPN). */
export type WatchedValidationStatus = 'pending' | 'validated' | 'failed'

export type WatchedPart = {
  /** What an analyst usually types (TI's "Generic Product Identifier"). */
  genericPartNumber: string
  /** Canonical orderable variant (TI's "Identifier"). The Product Information
   *  API returns 200 for OPNs but commonly 404s on GPNs, so we try this first. */
  preferredOrderablePartNumber: string
  /** Investor-facing display label (concise, no package suffix). */
  displayName: string
  basket: WatchedBasket
  /** Phase 22.1 — finer-than-basket grouping for the category heatmap. */
  subcategory?: WatchedSubcategory
  dashboardPriority: DashboardPriority
  /** One-line investment thesis tied to this specific part. */
  thesisReason: string
  demandProxyType: DemandProxyType
  /** Phase 22.1 — diagnostic confidence in this OPN. Defaults to 'high'
   *  when omitted (preserves the original 32 watched parts). */
  confidence?: WatchedConfidence
  /** Phase 22.1 — production capture is gated on this. Defaults to
   *  'validated' when omitted (preserves the original 32). New entries
   *  start at 'pending' and only flip to 'validated' after Stage 2 of
   *  Phase 22 (the validation endpoint). */
  validationStatus?: WatchedValidationStatus
  /** Operator-facing notes — never customer-visible. */
  notes?: string
}

/** Phase 22.1 — single source of truth for "is this part eligible for
 *  daily production capture". All 9 capture / signal / summary call sites
 *  in index.ts go through getWatchedPartsCaptureInputs() which filters on
 *  this; basket summary and product-info bundle filter on this too. */
export function isValidatedForCapture(p: WatchedPart): boolean {
  return (p.validationStatus ?? 'validated') === 'validated'
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
    subcategory: 'Op-amps',
    dashboardPriority: 'high',
    thesisReason: 'Flagship low-noise precision op-amp; broad design-in across instrumentation and medical reads as a clean proxy for TI\'s analog franchise discipline.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'INA226',
    preferredOrderablePartNumber: 'INA226AIDGSR',
    displayName: 'INA226 Current/Power Monitor',
    basket: 'analog_signal_chain',
    subcategory: 'Current/power monitors',
    dashboardPriority: 'high',
    thesisReason: 'Bidirectional digital current monitor — designed into server, telecom, and battery rails. Lead-time movement here tracks data-center and industrial power monitoring demand.',
    demandProxyType: 'precision_instrumentation',
  },
  {
    genericPartNumber: 'ADS1115',
    preferredOrderablePartNumber: 'ADS1115IRUGR',
    displayName: 'ADS1115 16-bit Delta-Sigma ADC',
    basket: 'analog_signal_chain',
    subcategory: 'ADCs',
    dashboardPriority: 'medium',
    thesisReason: 'Workhorse 16-bit ADC for sensor signal chains; long-cycle TI part, useful counterpoint to high-speed converters.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'ADS8685',
    preferredOrderablePartNumber: 'ADS8685IPW',
    displayName: 'ADS8685 16-bit SAR ADC',
    basket: 'analog_signal_chain',
    subcategory: 'ADCs',
    dashboardPriority: 'medium',
    thesisReason: 'Mid-range SAR ADC popular in factory automation and test equipment — a useful precision-analog demand signal.',
    demandProxyType: 'precision_instrumentation',
  },
  {
    genericPartNumber: 'TLV2372',
    preferredOrderablePartNumber: 'TLV2372IDGKR',
    displayName: 'TLV2372 Dual Rail-to-Rail Op-Amp',
    basket: 'analog_signal_chain',
    subcategory: 'Op-amps',
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
    subcategory: 'LDO regulators',
    dashboardPriority: 'high',
    thesisReason: 'High-PSRR low-noise LDO; distributor-liquid anchor SKU and the canonical reference for the dashboard\'s LDO category.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'TPS7A4501',
    preferredOrderablePartNumber: 'TPS7A4501DCQR',
    displayName: 'TPS7A4501 1.5A LDO',
    basket: 'power_management',
    subcategory: 'LDO regulators',
    dashboardPriority: 'medium',
    thesisReason: 'Higher-current adjustable LDO; secondary corroboration point for the LDO category — different package and form factor.',
    demandProxyType: 'analog_franchise',
  },
  {
    genericPartNumber: 'TPS54360',
    preferredOrderablePartNumber: 'TPS54360BDDA',
    displayName: 'TPS54360B Buck Converter',
    basket: 'power_management',
    subcategory: 'Buck converters',
    dashboardPriority: 'high',
    thesisReason: 'Industry-standard 3.5A 60V buck; ubiquitous in industrial and automotive 24V/48V rails. A primary read on industrial DC-DC pricing power.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'LM5176',
    preferredOrderablePartNumber: 'LM5176PWPR',
    displayName: 'LM5176 Buck-Boost Controller',
    basket: 'power_management',
    subcategory: 'Buck-boost converters',
    dashboardPriority: 'medium',
    thesisReason: 'Wide-VIN buck-boost — designed into industrial and automotive transient-tolerant rails.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'UCC28180',
    preferredOrderablePartNumber: 'UCC28180D',
    displayName: 'UCC28180 PFC Controller',
    basket: 'power_management',
    subcategory: 'PFC controllers',
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
    subcategory: 'Embedded MCU',
    dashboardPriority: 'high',
    thesisReason: 'Flagship FRAM low-power MCU; reads as a current-generation TI MCU signal.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'MSP430G2553',
    preferredOrderablePartNumber: 'MSP430G2553IPW28R',
    displayName: 'MSP430G2553 Legacy MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'low',
    thesisReason: 'Long-tail legacy MSP430; lifecycle stage signal — useful counterpoint to the FR2355 line.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'TM4C123GH6PM',
    preferredOrderablePartNumber: 'TM4C123GH6PMI',
    displayName: 'TM4C123 ARM Cortex-M4',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'medium',
    thesisReason: 'Tiva-C ARM Cortex-M4 — bridge between the legacy MSP430 and TI\'s newer Cortex lines.',
    demandProxyType: 'embedded_lifecycle',
  },
  {
    genericPartNumber: 'AM3358',
    preferredOrderablePartNumber: 'AM3358BZCZA80',
    displayName: 'AM3358 Sitara Processor',
    basket: 'embedded_processing',
    subcategory: 'Embedded MPU',
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
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'high',
    thesisReason: 'AEC-Q100 CAN FD transceiver — designed into virtually every modern ECU. A direct read on auto production volume.',
    demandProxyType: 'auto_volume',
  },
  {
    genericPartNumber: 'TCAN1051',
    preferredOrderablePartNumber: 'TCAN1051DRQ1',
    displayName: 'TCAN1051-Q1 CAN Transceiver',
    basket: 'automotive',
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'medium',
    thesisReason: 'High-speed automotive CAN transceiver; secondary corroboration point for the auto-volume signal alongside TCAN1042.',
    demandProxyType: 'auto_volume',
  },
  {
    genericPartNumber: 'BQ76952',
    preferredOrderablePartNumber: 'BQ76952PFBR',
    displayName: 'BQ76952 16S Battery Monitor',
    basket: 'automotive',
    subcategory: 'Battery management',
    dashboardPriority: 'high',
    thesisReason: 'Up-to-16S Li-ion battery monitor; 48V mild-hybrid and EV pack designs. A direct EV-electrification signal.',
    demandProxyType: 'battery_management_ev',
  },
  {
    genericPartNumber: 'TPS65381',
    preferredOrderablePartNumber: 'TPS65381AQDAPRQ1',
    displayName: 'TPS65381-Q1 Safety PMIC',
    basket: 'automotive',
    subcategory: 'Safety PMIC',
    dashboardPriority: 'high',
    thesisReason: 'AEC-Q100 functional-safety PMIC for ADAS and powertrain; widely-cited TI ADAS attach part.',
    demandProxyType: 'auto_adas',
  },
  {
    genericPartNumber: 'TPS92691',
    preferredOrderablePartNumber: 'TPS92691QPWPRQ1',
    displayName: 'TPS92691-Q1 LED Driver',
    basket: 'automotive',
    subcategory: 'LED drivers',
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
    subcategory: 'Battery management',
    dashboardPriority: 'medium',
    thesisReason: 'Single-cell USB-PD battery charger; portable industrial instruments and handheld terminals.',
    demandProxyType: 'consumer_iot',
  },
  {
    genericPartNumber: 'DRV8323',
    preferredOrderablePartNumber: 'DRV8323HRTAR',
    displayName: 'DRV8323 BLDC Gate Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'high',
    thesisReason: 'Three-phase BLDC gate driver for cordless tools, drones, and industrial motor control. A clean motor-electrification signal.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'ISO1042',
    preferredOrderablePartNumber: 'ISO1042BQDWVRQ1',
    displayName: 'ISO1042 Isolated CAN Transceiver',
    basket: 'industrial',
    subcategory: 'Digital isolators',
    dashboardPriority: 'medium',
    thesisReason: 'Galvanically-isolated CAN transceiver for industrial and EV charging — TI\'s isolation franchise read.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'AMC1311',
    preferredOrderablePartNumber: 'AMC1311BDWVR',
    displayName: 'AMC1311 Isolated Amplifier',
    basket: 'industrial',
    subcategory: 'Isolation amps',
    dashboardPriority: 'medium',
    thesisReason: 'Reinforced-isolation amplifier for solar inverters, motor drives, EV chargers — clean industrial-electrification read.',
    demandProxyType: 'industrial_capex',
  },
  {
    genericPartNumber: 'SN65HVD75',
    preferredOrderablePartNumber: 'SN65HVD75DR',
    displayName: 'SN65HVD75 RS-485 Transceiver',
    basket: 'industrial',
    subcategory: 'RS-485 transceivers',
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
    subcategory: 'Power stages',
    dashboardPriority: 'high',
    thesisReason: 'High-density 40A point-of-load for server VRM and accelerator power planes. A direct read on data-center capex through TI\'s server-power franchise.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'TPS53679',
    preferredOrderablePartNumber: 'TPS53679RSBR',
    displayName: 'TPS53679 Multiphase VR Controller',
    basket: 'data_center_server_power',
    subcategory: 'Multi-phase VR',
    dashboardPriority: 'high',
    thesisReason: 'Multiphase D-CAP+ controller for CPU/GPU core rails. Reads as a hyperscaler / accelerator buildout signal.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'LMG3522R030',
    preferredOrderablePartNumber: 'LMG3522R030RQSR',
    displayName: 'LMG3522R030 GaN Power Stage',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'medium',
    thesisReason: 'GaN integrated power stage — flagship of TI\'s GaN franchise; reads as the high-efficiency server-PSU and AI-power signal.',
    demandProxyType: 'data_center_capex',
  },
  {
    genericPartNumber: 'CSD17578Q5A',
    preferredOrderablePartNumber: 'CSD17578Q5A',
    displayName: 'CSD17578Q5A NexFET MOSFET',
    basket: 'data_center_server_power',
    subcategory: 'Power MOSFETs',
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
    subcategory: 'RF transceivers',
    dashboardPriority: 'high',
    thesisReason: 'Quad-channel transceiver AFE — purpose-built for 5G massive-MIMO radios. Direct read on wireless infra capex through TI.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'LMX2820',
    preferredOrderablePartNumber: 'LMX2820RTCR',
    displayName: 'LMX2820 RF Synthesizer',
    basket: 'wireless_infra_rf',
    subcategory: 'RF synthesizers',
    dashboardPriority: 'medium',
    thesisReason: 'Wideband RF PLL/VCO synthesizer — used in test-equipment and wireless infra LO chains. Captures TI\'s precision-RF franchise.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'LMK04832',
    preferredOrderablePartNumber: 'LMK04832NKDT',
    displayName: 'LMK04832 Clock Jitter Cleaner',
    basket: 'wireless_infra_rf',
    subcategory: 'Clock distribution',
    dashboardPriority: 'medium',
    thesisReason: 'JESD204B/C clock jitter cleaner; data-converter and radio reference clock for 5G and high-speed instrumentation.',
    demandProxyType: 'wireless_5g_buildout',
  },
  {
    genericPartNumber: 'CC1352P',
    preferredOrderablePartNumber: 'CC1352P1F3RGZR',
    displayName: 'CC1352P Sub-1GHz/2.4GHz Wireless MCU',
    basket: 'wireless_infra_rf',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'low',
    thesisReason: 'Multi-protocol wireless MCU — IoT and smart-meter end markets, breadth corroboration for the wireless basket.',
    demandProxyType: 'consumer_iot',
  },

  // ────────────────────────────────────────────────────────────────────────
  // Phase 22.1 — staged 68-part expansion. validationStatus: 'pending'
  // means these parts are NOT included in daily production capture until
  // the auth-gated validation endpoint (Phase 22.2) confirms each one
  // returns Product Info ok + Store Inventory ok + parsed price breaks.
  // confidence: 'high' = OPN already proven by the Mouser snapshot
  // pipeline; 'medium' = real TI part family but the exact suffix needs
  // diagnostic confirmation before joining production.
  // ────────────────────────────────────────────────────────────────────────

  // ── Power Management additions (14) ──────────────────────────────────────
  {
    genericPartNumber: 'TPS3839',
    preferredOrderablePartNumber: 'TPS3839G33DQNR',
    displayName: 'TPS3839 Supervisor & Reset',
    basket: 'power_management',
    subcategory: 'Supervisors',
    dashboardPriority: 'medium',
    thesisReason: 'Low-Iq voltage supervisor; broad attach across portable, industrial sensor, and battery-backed designs.',
    demandProxyType: 'analog_franchise',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS3700',
    preferredOrderablePartNumber: 'TPS3700DDCR2',
    displayName: 'TPS3700 Window Comparator',
    basket: 'power_management',
    subcategory: 'Supervisors',
    dashboardPriority: 'low',
    thesisReason: 'Window-comparator supervisor; legacy design-in across industrial control. Breadth corroboration for the supervisor sub-bucket.',
    demandProxyType: 'analog_franchise',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'UCC28C40',
    preferredOrderablePartNumber: 'UCC28C40DR',
    displayName: 'UCC28C40 Current-Mode PWM',
    basket: 'power_management',
    subcategory: 'PFC controllers',
    dashboardPriority: 'medium',
    thesisReason: 'Industry-standard current-mode PWM controller; long-cycle TI part, useful for white-goods and industrial PSU demand.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS62150A',
    preferredOrderablePartNumber: 'TPS62150ARGTR',
    displayName: 'TPS62150A 3A Buck (low Iq)',
    basket: 'power_management',
    subcategory: 'Buck converters',
    dashboardPriority: 'high',
    thesisReason: '3A synchronous buck with DCS-Control; widely used in industrial and POL rails. A clean read on industrial DC-DC demand.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS62840',
    preferredOrderablePartNumber: 'TPS62840DLCR',
    displayName: 'TPS62840 750mA Nano-Iq Buck',
    basket: 'power_management',
    subcategory: 'Buck converters',
    dashboardPriority: 'high',
    thesisReason: '60nA Iq buck for battery-powered IoT and wearables. Reads as TI\'s low-power consumer-IoT franchise signal.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS61089',
    preferredOrderablePartNumber: 'TPS61089RNNT',
    displayName: 'TPS61089 12V Boost',
    basket: 'power_management',
    subcategory: 'Boost converters',
    dashboardPriority: 'medium',
    thesisReason: 'High-current boost for displays, USB-PD adapters; consumer-IoT and portable read.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS63070',
    preferredOrderablePartNumber: 'TPS63070RNMR',
    displayName: 'TPS63070 Buck-Boost',
    basket: 'power_management',
    subcategory: 'Buck-boost converters',
    dashboardPriority: 'medium',
    thesisReason: 'Wide-VIN buck-boost — bridges the LM5176 controller signal at the converter level for portable and battery-backed rails.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TLV70233',
    preferredOrderablePartNumber: 'TLV70233DBVR',
    displayName: 'TLV70233 300mA LDO',
    basket: 'power_management',
    subcategory: 'LDO regulators',
    dashboardPriority: 'low',
    thesisReason: 'Cost-sensitive 300mA LDO; broad consumer/IoT attach. Breadth check for the LDO sub-bucket alongside TPS7A8300.',
    demandProxyType: 'analog_franchise',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS7A20',
    preferredOrderablePartNumber: 'TPS7A2033DBVR',
    displayName: 'TPS7A2033 200mA Low-Iq LDO',
    basket: 'power_management',
    subcategory: 'LDO regulators',
    dashboardPriority: 'medium',
    thesisReason: 'Ultra-low-Iq LDO for battery-powered IoT and wearables; complements the TPS62840 buck.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LP5907',
    preferredOrderablePartNumber: 'LP5907MFX-3.3/NOPB',
    displayName: 'LP5907 250mA LDO',
    basket: 'power_management',
    subcategory: 'LDO regulators',
    dashboardPriority: 'low',
    thesisReason: 'Low-noise 250mA LDO; long-cycle workhorse with steady consumer-electronics attach.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS25940',
    preferredOrderablePartNumber: 'TPS25940RVCR',
    displayName: 'TPS25940 eFuse',
    basket: 'power_management',
    subcategory: 'Hot-swap / eFuse',
    dashboardPriority: 'medium',
    thesisReason: '12V eFuse with current monitoring; server, telecom, and storage hot-plug rails — direct data-center attach.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS2595',
    preferredOrderablePartNumber: 'TPS2595DRCR',
    displayName: 'TPS2595 12V eFuse',
    basket: 'power_management',
    subcategory: 'Hot-swap / eFuse',
    dashboardPriority: 'medium',
    thesisReason: '12V eFuse with reverse-current blocking; server hot-swap signal alongside TPS25940.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS2492',
    preferredOrderablePartNumber: 'TPS2492PW',
    displayName: 'TPS2492 Hot-Swap Controller',
    basket: 'power_management',
    subcategory: 'Hot-swap / eFuse',
    dashboardPriority: 'medium',
    thesisReason: 'Wide-VIN hot-swap controller; legacy server and telecom rails, secondary corroboration for data-center capex.',
    demandProxyType: 'data_center_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'LM5145',
    preferredOrderablePartNumber: 'LM5145QPWPRQ1',
    displayName: 'LM5145-Q1 Buck Controller',
    basket: 'automotive',
    subcategory: 'Buck converters',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 wide-VIN buck controller; designed into 48V mild-hybrid and infotainment rails.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },

  // ── Wireless Infra / RF additions (8) ────────────────────────────────────
  {
    genericPartNumber: 'CC2652R7',
    preferredOrderablePartNumber: 'CC2652R7RGZR',
    displayName: 'CC2652R7 Multi-Protocol Wireless MCU',
    basket: 'wireless_infra_rf',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'high',
    thesisReason: 'Current-generation multi-protocol wireless MCU (Thread/Zigbee/BLE/Matter). Reads as TI\'s smart-home and industrial-IoT signal.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'CC1312R7',
    preferredOrderablePartNumber: 'CC1312R7RGZR',
    displayName: 'CC1312R7 Sub-1GHz MCU',
    basket: 'wireless_infra_rf',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'medium',
    thesisReason: 'Sub-1GHz wireless MCU for smart-meter and long-range IoT; complements CC1352P at the next-gen node.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LMK00308',
    preferredOrderablePartNumber: 'LMK00308SQX',
    displayName: 'LMK00308 LVPECL Clock Buffer',
    basket: 'wireless_infra_rf',
    subcategory: 'Clock distribution',
    dashboardPriority: 'medium',
    thesisReason: 'Low-jitter clock buffer for high-speed serdes and wireless infra LO chains.',
    demandProxyType: 'wireless_5g_buildout',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LMX2592',
    preferredOrderablePartNumber: 'LMX2592RHAR',
    displayName: 'LMX2592 12.6GHz PLL',
    basket: 'wireless_infra_rf',
    subcategory: 'RF synthesizers',
    dashboardPriority: 'medium',
    thesisReason: 'Wideband RF PLL/VCO; complements LMX2820 at lower frequency end. Test-equipment and wireless infra read.',
    demandProxyType: 'wireless_5g_buildout',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'LMX1204',
    preferredOrderablePartNumber: 'LMX1204RTQR',
    displayName: 'LMX1204 RF Synth Clock Distrib.',
    basket: 'wireless_infra_rf',
    subcategory: 'Clock distribution',
    dashboardPriority: 'medium',
    thesisReason: 'High-frequency clock distribution + synthesizer; modern radio reference signal alongside LMK04832.',
    demandProxyType: 'wireless_5g_buildout',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'CC2592',
    preferredOrderablePartNumber: 'CC2592RGVR',
    displayName: 'CC2592 2.4GHz Range Extender',
    basket: 'wireless_infra_rf',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'low',
    thesisReason: '2.4GHz range-extender front-end; consumer-IoT and smart-home attach.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'AWR1843AOP',
    preferredOrderablePartNumber: 'AWR1843AOPAQGABLQ1',
    displayName: 'AWR1843-AOP 77GHz Auto Radar',
    basket: 'wireless_infra_rf',
    subcategory: 'Radar',
    dashboardPriority: 'high',
    thesisReason: 'Antenna-on-package automotive radar; ADAS L2/L3 attach signal. Direct read on TI\'s mmWave radar growth.',
    demandProxyType: 'auto_adas',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'IWR6843AOP',
    preferredOrderablePartNumber: 'IWR6843AOPAQGABLQ1',
    displayName: 'IWR6843-AOP 60GHz Industrial Radar',
    basket: 'industrial',
    subcategory: 'Radar',
    dashboardPriority: 'medium',
    thesisReason: 'Industrial 60GHz radar; building automation, robotics, factory sensing. Complements automotive radar with industrial demand.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'pending',
  },

  // ── Data Converters / Analog additions (9) ───────────────────────────────
  {
    genericPartNumber: 'DAC8552',
    preferredOrderablePartNumber: 'DAC8552IDGK',
    displayName: 'DAC8552 16-bit Dual DAC',
    basket: 'analog_signal_chain',
    subcategory: 'DACs',
    dashboardPriority: 'medium',
    thesisReason: '16-bit precision dual DAC; test equipment and industrial control attach. Counterpoint to ADS series.',
    demandProxyType: 'precision_instrumentation',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DAC60508',
    preferredOrderablePartNumber: 'DAC60508ZCRTET',
    displayName: 'DAC60508 12-bit 8-ch DAC',
    basket: 'analog_signal_chain',
    subcategory: 'DACs',
    dashboardPriority: 'medium',
    thesisReason: 'Octal 12-bit DAC for industrial PLC and process-control loops. Industrial automation attach.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'ADS131M08',
    preferredOrderablePartNumber: 'ADS131M08IPBSR',
    displayName: 'ADS131M08 24-bit 8-ch ADC',
    basket: 'analog_signal_chain',
    subcategory: 'ADCs',
    dashboardPriority: 'high',
    thesisReason: '24-bit simultaneous-sampling ADC for energy metering and motor protection — high-priority industrial sensing read.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'ADS127L01',
    preferredOrderablePartNumber: 'ADS127L01IPBS',
    displayName: 'ADS127L01 24-bit Wide-BW ADC',
    basket: 'analog_signal_chain',
    subcategory: 'ADCs',
    dashboardPriority: 'medium',
    thesisReason: 'Wide-bandwidth 24-bit ADC for vibration analysis and high-end audio. Precision instrumentation read.',
    demandProxyType: 'precision_instrumentation',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'ADS9224',
    preferredOrderablePartNumber: 'ADS9224IRHBR',
    displayName: 'ADS9224 16-bit 3MSPS SAR ADC',
    basket: 'analog_signal_chain',
    subcategory: 'ADCs',
    dashboardPriority: 'medium',
    thesisReason: 'Mid-speed 16-bit SAR for closed-loop control; test equipment and motor-control attach.',
    demandProxyType: 'precision_instrumentation',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'ADS54J60',
    preferredOrderablePartNumber: 'ADS54J60IRMP',
    displayName: 'ADS54J60 16-bit 1GSPS ADC',
    basket: 'wireless_infra_rf',
    subcategory: 'ADCs',
    dashboardPriority: 'medium',
    thesisReason: 'High-speed JESD204B ADC for software-defined radio and wireless infra. Direct read on radio capex.',
    demandProxyType: 'wireless_5g_buildout',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'INA826',
    preferredOrderablePartNumber: 'INA826AIDR',
    displayName: 'INA826 Instrumentation Amp',
    basket: 'analog_signal_chain',
    subcategory: 'Instrumentation amps',
    dashboardPriority: 'medium',
    thesisReason: 'Low-noise in-amp for medical and industrial sensor front-ends. Precision-analog franchise read.',
    demandProxyType: 'precision_instrumentation',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'INA333',
    preferredOrderablePartNumber: 'INA333AIDR',
    displayName: 'INA333 Low-Power Inst Amp',
    basket: 'analog_signal_chain',
    subcategory: 'Instrumentation amps',
    dashboardPriority: 'medium',
    thesisReason: 'Low-power in-amp for portable medical and battery-powered sensors. Complements INA826 at lower power node.',
    demandProxyType: 'precision_instrumentation',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'PCM5102A',
    preferredOrderablePartNumber: 'PCM5102APWR',
    displayName: 'PCM5102A 32-bit Audio DAC',
    basket: 'analog_signal_chain',
    subcategory: 'Audio amps',
    dashboardPriority: 'low',
    thesisReason: '32-bit stereo audio DAC; consumer-electronics and pro-audio attach. Breadth corroboration.',
    demandProxyType: 'consumer_iot',
    confidence: 'medium',
    validationStatus: 'validated',
  },

  // ── Comparators additions (2) — pending until staged-validate confirms ───
  // Layer 2 of the amp_comparators basket: gives the daily TI Store capture
  // a path into D1's ti_inventory_price_snapshot for LM393/LM2903, which the
  // trend cascade then uses as the source of truth for real WoW/MoM/QoQ
  // anchors. Until validated, these stay out of getWatchedPartsCaptureInputs.
  {
    genericPartNumber: 'LM393',
    preferredOrderablePartNumber: 'LM393DR',
    displayName: 'LM393 Dual Comparator',
    basket: 'analog_signal_chain',
    subcategory: 'Comparators',
    dashboardPriority: 'medium',
    thesisReason: 'Industry-workhorse dual differential comparator; commodity analog franchise read across industrial and automotive control.',
    demandProxyType: 'analog_franchise',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LM2903',
    preferredOrderablePartNumber: 'LM2903DR',
    displayName: 'LM2903 Auto-Grade Dual Comparator',
    basket: 'analog_signal_chain',
    subcategory: 'Comparators',
    dashboardPriority: 'low',
    thesisReason: 'Q-grade dual comparator companion to LM393; automotive design-in corroboration for the comparator sub-bucket.',
    demandProxyType: 'auto_volume',
    confidence: 'high',
    validationStatus: 'pending',
  },

  // ── Motor Drivers additions (9) ──────────────────────────────────────────
  {
    genericPartNumber: 'DRV8870',
    preferredOrderablePartNumber: 'DRV8870DDAR',
    displayName: 'DRV8870 3.6A Brushed Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'Brushed-DC H-bridge for cordless tools, appliances, and toys. Industrial motor-driver attach.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'DRV8313',
    preferredOrderablePartNumber: 'DRV8313PWPR',
    displayName: 'DRV8313 BLDC Pre-Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: '3-phase BLDC pre-driver; complements DRV8323 at lower current node. Industrial motor-electrification read.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'DRV8316R',
    preferredOrderablePartNumber: 'DRV8316RRSSR',
    displayName: 'DRV8316R BLDC Smart Gate Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'high',
    thesisReason: 'Integrated 8A BLDC driver with current sensing; flagship modern motor-control IC for cordless and robotics.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DRV8825',
    preferredOrderablePartNumber: 'DRV8825PWPR',
    displayName: 'DRV8825 Stepper Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'Stepper motor driver; widely used in 3D printers, CNC, and lab automation. Industrial breadth read.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'DRV8434',
    preferredOrderablePartNumber: 'DRV8434PWPR',
    displayName: 'DRV8434 Stepper Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'Modern stepper driver with stall detection; factory automation and printer attach.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DRV8702D',
    preferredOrderablePartNumber: 'DRV8702DDQDAQ1',
    displayName: 'DRV8702D-Q1 H-Bridge Pre-Driver',
    basket: 'automotive',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 H-bridge pre-driver for automotive actuators (window lifts, seat motors, pumps).',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DRV8703',
    preferredOrderablePartNumber: 'DRV8703FRGER',
    displayName: 'DRV8703 BLDC Pre-Driver',
    basket: 'automotive',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'BLDC gate driver for automotive pump and fan motors; supports the 48V mild-hybrid trend.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DRV8242S',
    preferredOrderablePartNumber: 'DRV8242SDDDR',
    displayName: 'DRV8242S Brushed Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'low',
    thesisReason: 'Brushed-DC driver with SPI; appliance and small-actuator attach.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'DRV8311H',
    preferredOrderablePartNumber: 'DRV8311HRSMR',
    displayName: 'DRV8311H BLDC Driver',
    basket: 'industrial',
    subcategory: 'Motor drivers',
    dashboardPriority: 'medium',
    thesisReason: 'Integrated 3-phase BLDC driver for cordless garden tools, fans, and small appliances.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'pending',
  },

  // ── Embedded Processing additions (10) ───────────────────────────────────
  {
    genericPartNumber: 'MSPM0G3507',
    preferredOrderablePartNumber: 'MSPM0G3507SPTR',
    displayName: 'MSPM0G3507 Cortex-M0+ MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'high',
    thesisReason: 'Flagship MSPM0 Arm Cortex-M0+ MCU; current-generation general-purpose MCU. Reads as TI\'s embedded-cycle replacement signal.',
    demandProxyType: 'embedded_lifecycle',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'MSPM0L1306',
    preferredOrderablePartNumber: 'MSPM0L1306SRHAR',
    displayName: 'MSPM0L1306 Cortex-M0+ MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'medium',
    thesisReason: 'Low-cost MSPM0 sibling for high-volume consumer/IoT designs.',
    demandProxyType: 'embedded_lifecycle',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TMS320F28035',
    preferredOrderablePartNumber: 'TMS320F28035PNT',
    displayName: 'C2000 Piccolo F28035 MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'medium',
    thesisReason: 'C2000 Piccolo real-time MCU; legacy power-electronics and motor-control attach.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TMS320F280049C',
    preferredOrderablePartNumber: 'TMS320F280049CPMS',
    displayName: 'C2000 F280049 MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'high',
    thesisReason: 'Modern C2000 real-time MCU for digital power and motor control. High-priority industrial signal.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TMS320F28379D',
    preferredOrderablePartNumber: 'TMS320F28379DPTPT',
    displayName: 'C2000 Dual-Core F28379D MCU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MCU',
    dashboardPriority: 'medium',
    thesisReason: 'Dual-core C2000 with CLA accelerators; high-end power-conversion and EV charger control.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'CC2652R1',
    preferredOrderablePartNumber: 'CC2652R1FRGZR',
    displayName: 'CC2652R1 Multi-Protocol MCU',
    basket: 'embedded_processing',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'medium',
    thesisReason: 'Prior-gen multi-protocol wireless MCU; complements CC2652R7 for cycle comparison.',
    demandProxyType: 'consumer_iot',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'CC2640R2',
    preferredOrderablePartNumber: 'CC2640R2FRGZR',
    displayName: 'CC2640R2 BLE MCU',
    basket: 'embedded_processing',
    subcategory: 'Wireless MCU',
    dashboardPriority: 'low',
    thesisReason: 'BLE-only wireless MCU; legacy attach for the BLE end of the wireless basket.',
    demandProxyType: 'consumer_iot',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'AM3352',
    preferredOrderablePartNumber: 'AM3352BZCZD80',
    displayName: 'AM3352 Sitara MPU',
    basket: 'embedded_processing',
    subcategory: 'Embedded MPU',
    dashboardPriority: 'medium',
    thesisReason: 'Sitara ARM Cortex-A8 MPU; HMI and gateway attach, complements AM3358.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'AM3359',
    preferredOrderablePartNumber: 'AM3359BZCZD80',
    displayName: 'AM3359 Sitara MPU (PRU-ICSS)',
    basket: 'embedded_processing',
    subcategory: 'Embedded MPU',
    dashboardPriority: 'medium',
    thesisReason: 'Sitara MPU with industrial PRU-ICSS for EtherCAT/Profinet; factory-automation gateway read.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TMS570LS1224',
    preferredOrderablePartNumber: 'TMS570LS1224ZWTQQ1',
    displayName: 'Hercules TMS570 Safety MCU',
    basket: 'automotive',
    subcategory: 'Safety MCU',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 ASIL-D safety MCU for ADAS and EV powertrain control. Reads as ADAS / EV growth signal.',
    demandProxyType: 'auto_adas',
    confidence: 'medium',
    validationStatus: 'pending',
  },

  // ── Automotive / Safety additions (9) ────────────────────────────────────
  {
    genericPartNumber: 'TPS6594-Q1',
    preferredOrderablePartNumber: 'TPS6594J33QRWERQ1',
    displayName: 'TPS6594-Q1 Safety PMIC',
    basket: 'automotive',
    subcategory: 'Safety PMIC',
    dashboardPriority: 'high',
    thesisReason: 'Multi-rail functional-safety PMIC for ADAS / autonomy compute platforms. Direct ADAS power-attach signal.',
    demandProxyType: 'auto_adas',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'BQ79616-Q1',
    preferredOrderablePartNumber: 'BQ79616PFBQ1',
    displayName: 'BQ79616-Q1 16S EV Battery Monitor',
    basket: 'automotive',
    subcategory: 'Battery management',
    dashboardPriority: 'high',
    thesisReason: 'High-voltage 16S battery monitor for full-EV packs; complements BQ76952 at the EV-grade tier.',
    demandProxyType: 'battery_management_ev',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TCAN4550-Q1',
    preferredOrderablePartNumber: 'TCAN4550RGYRQ1',
    displayName: 'TCAN4550-Q1 CAN-FD + SPI',
    basket: 'automotive',
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'medium',
    thesisReason: 'CAN-FD with integrated controller; partial-network and zonal-architecture attach.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TLIN1029-Q1',
    preferredOrderablePartNumber: 'TLIN1029DRBQ1',
    displayName: 'TLIN1029-Q1 LIN Transceiver',
    basket: 'automotive',
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 LIN transceiver; body-control and HVAC node attach.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TLIN1021-Q1',
    preferredOrderablePartNumber: 'TLIN1021DRBRQ1',
    displayName: 'TLIN1021-Q1 LIN Transceiver',
    basket: 'automotive',
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'low',
    thesisReason: 'Legacy LIN transceiver — auto-volume breadth, complements newer TLIN1029.',
    demandProxyType: 'auto_volume',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'SN65HVDA100',
    preferredOrderablePartNumber: 'SN65HVDA100DR',
    displayName: 'SN65HVDA100 LIN Bus Transceiver',
    basket: 'automotive',
    subcategory: 'CAN/LIN transceivers',
    dashboardPriority: 'low',
    thesisReason: 'Long-cycle LIN transceiver; auto-volume breadth check.',
    demandProxyType: 'auto_volume',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS7B82-Q1',
    preferredOrderablePartNumber: 'TPS7B8233QDCYRQ1',
    displayName: 'TPS7B82-Q1 300mA Auto LDO',
    basket: 'automotive',
    subcategory: 'LDO regulators',
    dashboardPriority: 'low',
    thesisReason: 'AEC-Q100 high-PSRR LDO for body electronics; auto-volume breadth.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'UCC27614-Q1',
    preferredOrderablePartNumber: 'UCC27614DRSRQ1',
    displayName: 'UCC27614-Q1 10A Gate Driver',
    basket: 'automotive',
    subcategory: 'Gate drivers',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 high-current gate driver for 48V mild-hybrid and DC-fast-charging power stages.',
    demandProxyType: 'battery_management_ev',
    confidence: 'medium',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS3702-Q1',
    preferredOrderablePartNumber: 'TPS3702QDDCRQ1',
    displayName: 'TPS3702-Q1 Window Supervisor',
    basket: 'automotive',
    subcategory: 'Supervisors',
    dashboardPriority: 'low',
    thesisReason: 'AEC-Q100 window-comparator supervisor; ADAS rail monitoring attach.',
    demandProxyType: 'auto_volume',
    confidence: 'medium',
    validationStatus: 'pending',
  },

  // ── Data Center / Server Power additions (9) ─────────────────────────────
  {
    genericPartNumber: 'TPS53688',
    preferredOrderablePartNumber: 'TPS53688RSBT',
    displayName: 'TPS53688 Multi-Phase Controller',
    basket: 'data_center_server_power',
    subcategory: 'Multi-phase VR',
    dashboardPriority: 'high',
    thesisReason: 'Multi-phase D-CAP+ controller for AI/server CPU rails. Direct hyperscaler/AI capex read.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS53689',
    preferredOrderablePartNumber: 'TPS53689RSBR',
    displayName: 'TPS53689 Multi-Phase Controller',
    basket: 'data_center_server_power',
    subcategory: 'Multi-phase VR',
    dashboardPriority: 'high',
    thesisReason: 'Sibling to TPS53688 for accelerator/GPU power planes; AI buildout signal.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS53622',
    preferredOrderablePartNumber: 'TPS53622RSLR',
    displayName: 'TPS53622 AI Power Stage',
    basket: 'data_center_server_power',
    subcategory: 'Power stages',
    dashboardPriority: 'high',
    thesisReason: 'Smart power stage paired with TPS536xx controllers; AI accelerator rail attach.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'TPS53681',
    preferredOrderablePartNumber: 'TPS53681RSBT',
    displayName: 'TPS53681 AI Power Stage',
    basket: 'data_center_server_power',
    subcategory: 'Power stages',
    dashboardPriority: 'high',
    thesisReason: 'Higher-current power stage for next-gen AI accelerator core rails.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS23861',
    preferredOrderablePartNumber: 'TPS23861PW',
    displayName: 'TPS23861 PoE PSE Controller',
    basket: 'data_center_server_power',
    subcategory: 'PoE controllers',
    dashboardPriority: 'medium',
    thesisReason: 'Quad-port PoE PSE controller for switches and Wi-Fi APs; enterprise networking attach.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS2484',
    preferredOrderablePartNumber: 'TPS2484PWR',
    displayName: 'TPS2484 Hot-Swap Controller',
    basket: 'data_center_server_power',
    subcategory: 'Hot-swap / eFuse',
    dashboardPriority: 'medium',
    thesisReason: 'Server hot-swap controller for high-current 12V boards.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LMG3422R030',
    preferredOrderablePartNumber: 'LMG3422R030RQZT',
    displayName: 'LMG3422 600V GaN FET',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'high',
    thesisReason: '600V GaN integrated power stage; complements LMG3522 at the 600V tier — server PSU and high-density AC-DC.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LMG3410R070',
    preferredOrderablePartNumber: 'LMG3410R070RJZR',
    displayName: 'LMG3410 600V GaN FET',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'medium',
    thesisReason: '600V GaN FET for higher-power AC-DC stages; complements LMG3422 at lower current.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'pending',
  },
  {
    genericPartNumber: 'LM5180',
    preferredOrderablePartNumber: 'LM5180NGUR',
    displayName: 'LM5180 48V Bus Converter',
    basket: 'data_center_server_power',
    subcategory: 'Bus converters',
    dashboardPriority: 'medium',
    thesisReason: '48V/100V flyback bus converter; OCP / hyperscaler rack power attach.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },

  // ────────────────────────────────────────────────────────────────────────
  // Phase 22.5 — staged 12-part expansion to cover the trend-dashboard
  // representative SKUs that were absent from the prior watched list:
  // Ethernet PHYs, Digital + Reinforced Isolators, the rest of the GaN
  // family (LMG3650 / LMG5200), Audio Amps, and eFuses. These start as
  // 'pending' and join production capture only after
  // POST /api/ti/inventory/staged/validate confirms each one returns
  // Product Info ok + Store Inventory ok + parsed price breaks.
  // ────────────────────────────────────────────────────────────────────────

  // ── Interface ICs additions (2) ────────────────────────────────────────
  {
    genericPartNumber: 'DP83867',
    preferredOrderablePartNumber: 'DP83867IRRGZR',
    displayName: 'DP83867 Industrial Gigabit Ethernet PHY',
    basket: 'industrial',
    subcategory: 'Ethernet PHYs',
    dashboardPriority: 'medium',
    thesisReason: 'Industrial-grade Gigabit Ethernet PHY — broad design-in across factory automation and time-sensitive networking gear.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'DP83826',
    preferredOrderablePartNumber: 'DP83826ERHBR',
    displayName: 'DP83826 100Mbps Ethernet PHY',
    basket: 'industrial',
    subcategory: 'Ethernet PHYs',
    dashboardPriority: 'low',
    thesisReason: '10/100Mbps fast Ethernet PHY — embedded networking standard for cost-sensitive industrial endpoints.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    // Validated cleanly in initial probe (Product Info ok + Inventory ok +
    // price available); a later pass hit transient Product Info rate-limit
    // which is not an OPN failure. Promoted on operator review.
    validationStatus: 'validated',
  },

  // ── Isolation additions (4) ─────────────────────────────────────────────
  {
    genericPartNumber: 'ISO7742',
    preferredOrderablePartNumber: 'ISO7742DWR',
    displayName: 'ISO7742 Quad-Channel Digital Isolator',
    basket: 'industrial',
    subcategory: 'Digital isolators',
    dashboardPriority: 'medium',
    thesisReason: 'Quad-channel digital isolator — workhorse SKU for industrial isolated communication and control.',
    demandProxyType: 'industrial_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'ISO1541',
    preferredOrderablePartNumber: 'ISO1541DWR',
    displayName: 'ISO1541 Isolated I2C Bridge',
    basket: 'industrial',
    subcategory: 'Digital isolators',
    dashboardPriority: 'low',
    thesisReason: 'Low-voltage isolated I2C bridge — common in industrial sensor and instrument front-ends.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    // Operator validation (May-2026): Product Info no_match / 404. OPN may
    // be retired or renamed. Marked 'failed' so it's excluded from capture
    // and won't be reattempted automatically; pick a replacement OPN if/when
    // we want to cover this subcategory leaf again.
    validationStatus: 'failed',
  },
  {
    genericPartNumber: 'ISO7042',
    preferredOrderablePartNumber: 'ISO7042CDWR',
    displayName: 'ISO7042 Reinforced 4-Channel Isolator',
    basket: 'industrial',
    subcategory: 'Digital isolators',
    dashboardPriority: 'medium',
    thesisReason: 'Reinforced 4-channel isolator — qualified for high-voltage power-conversion isolation.',
    demandProxyType: 'industrial_capex',
    confidence: 'medium',
    // Operator validation (May-2026): Product Info no_match / 404. Verify
    // the OPN suffix or pick a sibling SKU before re-staging.
    validationStatus: 'failed',
  },
  {
    genericPartNumber: 'ISO5852S-Q1',
    preferredOrderablePartNumber: 'ISO5852SQDWRQ1',
    displayName: 'ISO5852S-Q1 Reinforced Isolated Gate Driver',
    basket: 'automotive',
    subcategory: 'Gate drivers',
    dashboardPriority: 'medium',
    thesisReason: 'AEC-Q100 reinforced isolated gate driver — used in EV traction inverters and on-board chargers.',
    demandProxyType: 'auto_volume',
    confidence: 'high',
    validationStatus: 'validated',
  },

  // ── GaN Power additions (4) ─────────────────────────────────────────────
  {
    genericPartNumber: 'LMG3652',
    preferredOrderablePartNumber: 'LMG3652R070KLAR',
    displayName: 'LMG3652 600V GaN FET (TOLL)',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'medium',
    thesisReason: '600V GaN FET in TOLL package — power-density driver for AI/data-center high-power converters.',
    demandProxyType: 'data_center_capex',
    confidence: 'medium',
    // Operator validation (May-2026): Product Info no_match / 404 on this
    // exact OPN. The companion LMG3650R070KLAR validated successfully and
    // covers the same subcategory leaf, so this one stays excluded.
    validationStatus: 'failed',
  },
  {
    genericPartNumber: 'LMG3650',
    preferredOrderablePartNumber: 'LMG3650R070KLAR',
    displayName: 'LMG3650 600V GaN FET (TOLL)',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'low',
    thesisReason: 'Alt 600V GaN FET TOLL — companion lifecycle to LMG3652 family.',
    demandProxyType: 'data_center_capex',
    confidence: 'medium',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'LMG5200',
    preferredOrderablePartNumber: 'LMG5200MOFT',
    displayName: 'LMG5200 80V GaN Half-Bridge Module',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'medium',
    thesisReason: '80V GaN half-bridge module — design anchor for 48V data-center server power conversion.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'LMG5350',
    preferredOrderablePartNumber: 'LMG5350R070YFFT',
    displayName: 'LMG5350 80V GaN Power Stage',
    basket: 'data_center_server_power',
    subcategory: 'GaN power',
    dashboardPriority: 'low',
    thesisReason: 'Alt 80V GaN — emerging design-in for next-gen 48V telecom and server boards.',
    demandProxyType: 'data_center_capex',
    confidence: 'medium',
    // Operator validation (May-2026): Product Info no_match / 404. The
    // companion LMG5200MOFT covers the same subcategory leaf successfully.
    validationStatus: 'failed',
  },

  // ── Audio Amps + eFuses additions (2) ───────────────────────────────────
  {
    genericPartNumber: 'TPA3118D2',
    preferredOrderablePartNumber: 'TPA3118D2DAPR',
    displayName: 'TPA3118D2 Class-D Audio Amplifier',
    basket: 'analog_signal_chain',
    subcategory: 'Audio amps',
    dashboardPriority: 'medium',
    thesisReason: 'Class-D audio amplifier — broad consumer-electronics attach across speakers, soundbars, and accessories.',
    demandProxyType: 'consumer_iot',
    confidence: 'high',
    validationStatus: 'validated',
  },
  {
    genericPartNumber: 'TPS25940A',
    preferredOrderablePartNumber: 'TPS25940ARVCR',
    displayName: 'TPS25940A 18V eFuse',
    basket: 'data_center_server_power',
    subcategory: 'Hot-swap / eFuse',
    dashboardPriority: 'medium',
    thesisReason: 'Programmable eFuse — workhorse for hot-swap protection in server, AI accelerator, and storage cards.',
    demandProxyType: 'data_center_capex',
    confidence: 'high',
    validationStatus: 'validated',
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
  // Phase 22.1 — basket summary reflects production-eligible parts only
  // (validated). Staged 'pending' parts are surfaced via summarizeStagedBaskets()
  // which the validation endpoint uses.
  const buckets = new Map<WatchedBasket, WatchedBasketSummary>()
  for (const part of TI_WATCHED_PARTS) {
    if (!isValidatedForCapture(part)) continue
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

/** Phase 22.1 — staged-only basket summary. Used by the validation endpoint
 *  in Phase 22.2 to show how many candidate OPNs are waiting per basket. */
export function summarizeStagedBaskets(): WatchedBasketSummary[] {
  const buckets = new Map<WatchedBasket, WatchedBasketSummary>()
  for (const part of TI_WATCHED_PARTS) {
    if (isValidatedForCapture(part)) continue
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

/** Phase 22.1 — every WatchedPart whose validationStatus is 'validated'
 *  (or omitted, which defaults to 'validated' for backward-compat). The
 *  daily capture pipeline is fed exclusively from this list. */
export function getValidatedWatchedParts(): WatchedPart[] {
  return TI_WATCHED_PARTS.filter(isValidatedForCapture)
}

/** Phase 22.1 — every WatchedPart whose validationStatus is 'pending' or
 *  'failed'. Used by the auth-gated validation endpoint (Phase 22.2) to
 *  hand the diagnostic the candidate set. Never flows into daily capture. */
export function getStagedWatchedParts(): WatchedPart[] {
  return TI_WATCHED_PARTS.filter(p => !isValidatedForCapture(p))
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
  // Phase 22.1 — production capture is fed by validated parts only.
  // Pending/failed parts live in TI_WATCHED_PARTS for the validation
  // endpoint to inspect, but never reach the daily Worker invocation.
  const eligible = getValidatedWatchedParts()
  if (eligible.length === 0) {
    return [WATCHED_PARTS_FALLBACK_SEED]
  }
  return eligible.map(p => ({
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
  // Phase 22.1 — only iterate validated parts. Staged 'pending' parts are
  // queried via the auth-gated validation endpoint (Phase 22.2) instead, so
  // this bundle's shape and totalParts stay at the production 32 until an
  // operator promotes new parts through validation.
  const eligible = getValidatedWatchedParts()
  const baskets = basketCoverage(eligible)
  // Surface the not-configured case with a friendly bundle rather than calling
  // through to the adapter for every part — avoids N wasted fetch attempts
  // in misconfigured environments.
  const probe = await fetchWatchedPartProductInfo(env, eligible[0])
  if (probe.status === 'not_configured' || probe.status === 'token_failed') {
    return {
      generatedAt,
      totalParts: eligible.length,
      configured: false,
      parts: [],
      baskets,
      summary: {
        totalWatchedParts: eligible.length,
        activeParts: 0,
        longestLeadTimeWeeks: null,
        longestLeadTimePart: null,
        partsOkayToOrder: 0,
        basketsCovered: baskets.length,
        failedFetches: eligible.length,
      },
      notConfiguredReason:
        probe.status === 'not_configured'
          ? 'TI adapter not configured — set TI_CLIENT_ID, TI_CLIENT_SECRET, and TI_API_ENV=production.'
          : 'TI OAuth token request failed — see /api/ti/status for diagnostics.',
    }
  }

  // First call already populated `probe`. Iterate the remaining parts.
  const parts: WatchedPartProductInfo[] = [probe]
  for (let i = 1; i < eligible.length; i++) {
    if (INTER_CALL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_CALL_DELAY_MS))
    }
    parts.push(await fetchWatchedPartProductInfo(env, eligible[i]))
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
    totalParts: eligible.length,
    configured: true,
    parts,
    baskets,
    summary: {
      totalWatchedParts: eligible.length,
      activeParts,
      longestLeadTimeWeeks: longest?.weeks ?? null,
      longestLeadTimePart: longest?.label ?? null,
      partsOkayToOrder: okayToOrderCount,
      basketsCovered: coveredBaskets.size,
      failedFetches,
    },
  }
}
