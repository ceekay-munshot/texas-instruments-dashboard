// ── Mouser catalog (Phase 16A) ───────────────────────────────────────────────
// Single source of truth for the 28-category Mouser-backed dashboard.
// Both /api/prices (live row) and /api/snapshots/mouser/* (full daily snapshot
// backbone) read from these constants. Pure data; no fetch logic.
//
// Each PART_MAP entry has a primary MPN and a fallback MPN. The Mouser fetch
// path tries the primary first and falls back if it returns no pricing.

import { canonicalCategoryId } from './tiTaxonomy'

export type MouserCatalogEntry = {
  /** Existing legacy id (kept for backward-compat with snapshots/baselines). */
  label: string
  parts: string[]
}

export const PART_MAP: Record<string, MouserCatalogEntry> = {
  pm_ldo:    { label: 'LDO Regulators',       parts: ['TPS7A8300RGWR','TPS7A4501DCQR'] },
  pm_acdc:   { label: 'AC/DC Switching',      parts: ['UCC28180D','UCC28C40DR'] },
  pm_dcdc:   { label: 'DC/DC Switching',      parts: ['TPS54360BDDA','LM5176PWPR'] },
  pm_super:  { label: 'Supervisor & Reset',   parts: ['TPS3839G33DQNR','TPS3700DDCR2'] },
  pm_batt:   { label: 'Battery Mgmt',         parts: ['BQ25896RTWT','BQ76952PFBR'] },
  amp_op:    { label: 'Op-Amps',              parts: ['OPA376AIDBVR','TLV2372IDGKR'] },
  amp_instr: { label: 'Instrumentation',      parts: ['INA826AIDR','INA333AIDR'] },
  amp_audio: { label: 'Audio Amps',           parts: ['TPA3118D2DAPR','LM4871M/NOPB'] },
  dac_adc:   { label: 'ADC',                  parts: ['ADS1115IRUGR','ADS8685IPW'] },
  dac_dac:   { label: 'DAC',                  parts: ['DAC8552IDGK','DAC60508ZCRTET'] },
  if_can:    { label: 'CAN Transceivers',     parts: ['TCAN1042DRBTQ1','TCAN1051DRQ1'] },
  if_lin:    { label: 'LIN Transceivers',     parts: ['TLIN1021DRBRQ1','SN65HVDA100DR'] },
  if_eth:    { label: 'Ethernet PHYs',        parts: ['DP83867IRRGZR','DP83826ERHBR'] },
  iso_dig:   { label: 'Digital Isolators',    parts: ['ISO7742DWR','ISO1541DWR'] },
  iso_rein:  { label: 'Reinforced Isolators', parts: ['ISO7042CDWR','ISO5852SQDWRQ1'] },
  mcu_msp:   { label: 'MSP430',               parts: ['MSP430FR2355TRHAT','MSP430G2553IPW28R'] },
  mcu_c2k:   { label: 'C2000 Real-Time',      parts: ['TMS320F28035PNT','TMS320F280049CPMS'] },
  mcu_m0:    { label: 'MSPM0',                parts: ['MSPM0G3507SPTR','MSPM0L1306SRHAR'] },
  mcu_cc:    { label: 'SimpleLink',           parts: ['CC2652R1FRGZR','CC2640R2FRGZR'] },
  mcu_sit:   { label: 'Sitara MPU',           parts: ['AM3352BZCZD80','AM3359BZCZD80'] },
  gan_342:   { label: 'LMG342x (600V)',       parts: ['LMG3422R030RQZT','LMG3410R070RJZR'] },
  gan_365:   { label: 'LMG3650 (TOLL)',       parts: ['LMG3652R070KLAR','LMG3650R070KLAR'] },
  gan_520:   { label: 'LMG5200 (80V)',        parts: ['LMG5200MOFT','LMG5350R070YFFT'] },
  dc_48v:    { label: '48V Bus Converters',   parts: ['LM5180NGUR','LM25180RNXR'] },
  dc_sps:    { label: 'Smart Power Stages',   parts: ['TPS53688RSBT','TPS53689RSBR'] },
  dc_efuse:  { label: 'eFuses',               parts: ['TPS2595DRCR','TPS25940ARVCR'] },
  dc_hswap:  { label: 'Hot-Swap Controllers', parts: ['TPS23861PW','TPS2484PWR'] },
  dc_tps:    { label: 'TPS536xx (AI Power)',  parts: ['TPS53622RSLR','TPS53681RSBT'] },
}

// Q1-26 close baselines — Mouser qty=1 USD prices captured 28-Apr-2026.
// Methodology: qty=1 price break, INR→USD at ₹83.5, verified via direct API call.
export const BASELINES: Record<string, number> = {
  pm_ldo:    7.0861,
  pm_acdc:   2.0086,
  pm_dcdc:   5.9368,
  pm_super:  0.8704,
  pm_batt:   5.4346,
  amp_op:    2.1983,
  amp_instr: 3.7607,
  amp_audio: 1.9305,
  dac_adc:   5.7135,
  dac_dac:   22.2963,
  if_can:    2.7898,
  if_lin:    1.7966,
  if_eth:    8.0459,
  iso_dig:   3.4036,
  iso_rein:  7.5326,
  mcu_msp:   4.9770,
  mcu_c2k:   16.1921,
  mcu_m0:    2.7451,
  mcu_cc:    10.0545,
  mcu_sit:   14.8976,
  gan_342:   30.2640,
  gan_365:   9.4743,
  gan_520:   18.9485,
  dc_48v:    5.0552,
  dc_sps:    14.8307,
  dc_efuse:  2.7898,
  dc_hswap:  5.1222,
  dc_tps:    13.4134,
}

export const BASELINE_DATE = '2026-04-28'
export const BASELINE_PERIOD_LABEL = 'Q1-26 close'
export const BASELINE_LABEL = 'Latest baseline'
export const BASELINE_DISPLAY = 'Q1-26 close · captured 28-Apr-26'
export const BASELINE_DESCRIPTION =
  'Q1-26 close baseline used for live spot-price comparison; live row tracks Q2-26 movement vs this anchor'
export const BASELINE_ROLLOVER_POLICY =
  'Manual rollover after controlled quarterly baseline capture'
export const BASELINE_REVIEW_AFTER_DAYS = 90

/** Return the canonical taxonomy id for a Mouser PART_MAP legacy id. */
export function canonicalForLegacy(legacyId: string): string {
  return canonicalCategoryId(legacyId)
}
