// ── Canonical TI taxonomy (Phase 16A) ────────────────────────────────────────
// Single source of truth for the 8 major TI groups and 28 customer-facing
// subcategories. The dashboard reflects this taxonomy; basket / Mouser / Nexar
// records reference it via stable `canonicalCategoryId`s.
//
// Coverage classification per source:
//   mouser:        covered | partial | missing
//   nexar:         sampled | rotating | watchlist | missing
//   tiDirect:      future
//   digikeyDirect: future
//   arrowDirect:   future
//
// Strategy: Mouser is the **free full backbone** (covers the 28 subcategories
// daily via /api/prices). Nexar is **sparse rotating corroboration** under a
// permanent 4-call/day evaluation cap. There is **no paid-quota assumption**
// anywhere in this taxonomy or its consumers.

export const TI_TAXONOMY_VERSION = '1.0.0'

export type TaxonomySourceState = {
  mouser: 'covered' | 'partial' | 'missing'
  nexar: 'sampled' | 'rotating' | 'watchlist' | 'missing'
  tiDirect: 'future'
  digikeyDirect: 'future'
  arrowDirect: 'future'
}

export type TaxonomySubcategory = {
  groupId: string
  groupLabel: string
  categoryId: string
  categoryLabel: string
  /** 1 = highest-priority anchor; higher numbers = lower priority. */
  priority: 1 | 2 | 3 | 4 | 5
  customerFacing: true
  currentCoverage: TaxonomySourceState
  notes?: string
}

export type TaxonomyGroup = {
  groupId: string
  groupLabel: string
  subcategories: TaxonomySubcategory[]
}

const t = (
  groupId: string,
  groupLabel: string,
  categoryId: string,
  categoryLabel: string,
  priority: TaxonomySubcategory['priority'],
  currentCoverage: TaxonomySourceState,
  notes?: string,
): TaxonomySubcategory => ({
  groupId,
  groupLabel,
  categoryId,
  categoryLabel,
  priority,
  customerFacing: true,
  currentCoverage,
  notes,
})

// All 28 subcategories grouped by the 8 major TI groups, in the order the
// product spec defines.
export const TI_TAXONOMY: TaxonomyGroup[] = [
  {
    groupId: 'power_management',
    groupLabel: 'Power Management',
    subcategories: [
      t('power_management', 'Power Management', 'power_ldo', 'LDO Regulators',
        1, { mouser: 'covered', nexar: 'sampled', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Anchor category — primary low-noise LDO is also a Nexar anchor SKU.'),
      t('power_management', 'Power Management', 'power_acdc_switching', 'AC/DC Switching',
        2, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today; not in the rotating Nexar pool.'),
      t('power_management', 'Power Management', 'power_dcdc_switching', 'DC/DC Switching',
        2, { mouser: 'covered', nexar: 'rotating', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser daily; Nexar visits this category on a deterministic UTC-day rotation.'),
      t('power_management', 'Power Management', 'power_supervisor_reset', 'Supervisor & Reset',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('power_management', 'Power Management', 'power_battery_mgmt', 'Battery Mgmt',
        1, { mouser: 'covered', nexar: 'sampled', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Anchor category — primary mobile-charger SKU is a Nexar anchor.'),
    ],
  },
  {
    groupId: 'amplifiers',
    groupLabel: 'Amplifiers',
    subcategories: [
      t('amplifiers', 'Amplifiers', 'amp_opamps', 'Op-Amps',
        2, { mouser: 'covered', nexar: 'rotating', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser daily; Nexar rotates corroboration.'),
      t('amplifiers', 'Amplifiers', 'amp_instrumentation', 'Instrumentation',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('amplifiers', 'Amplifiers', 'amp_audio', 'Audio Amps',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('amplifiers', 'Amplifiers', 'amp_comparators', 'Comparators',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Anchor-only comparator basket; no long historical series yet. TI general-purpose comparators (LM393 family, TLV320x/349x push-pull).'),
    ],
  },
  {
    groupId: 'data_converters',
    groupLabel: 'Data Converters',
    subcategories: [
      t('data_converters', 'Data Converters', 'conv_adc', 'ADC',
        2, { mouser: 'covered', nexar: 'rotating', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser daily; Nexar rotates corroboration.'),
      t('data_converters', 'Data Converters', 'conv_dac', 'DAC',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
  {
    groupId: 'interface_ics',
    groupLabel: 'Interface ICs',
    subcategories: [
      t('interface_ics', 'Interface ICs', 'interface_can', 'CAN Transceivers',
        2, { mouser: 'covered', nexar: 'rotating', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser daily; Nexar rotates corroboration.'),
      t('interface_ics', 'Interface ICs', 'interface_lin', 'LIN Transceivers',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('interface_ics', 'Interface ICs', 'interface_ethernet_phy', 'Ethernet PHYs',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
  {
    groupId: 'isolation',
    groupLabel: 'Isolation',
    subcategories: [
      t('isolation', 'Isolation', 'isolation_digital', 'Digital Isolators',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('isolation', 'Isolation', 'isolation_reinforced', 'Reinforced Isolators',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
  {
    groupId: 'microcontrollers',
    groupLabel: 'Microcontrollers',
    subcategories: [
      t('microcontrollers', 'Microcontrollers', 'mcu_msp430', 'MSP430',
        3, { mouser: 'covered', nexar: 'rotating', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser daily; Nexar rotates as a watchlist-tier sample.'),
      t('microcontrollers', 'Microcontrollers', 'mcu_c2000', 'C2000 Real-Time',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('microcontrollers', 'Microcontrollers', 'mcu_mspm0', 'MSPM0',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('microcontrollers', 'Microcontrollers', 'mcu_simplelink', 'SimpleLink',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('microcontrollers', 'Microcontrollers', 'mcu_sitara', 'Sitara MPU',
        4, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
  {
    groupId: 'gan_power',
    groupLabel: 'GaN Power',
    subcategories: [
      t('gan_power', 'GaN Power', 'gan_lmg342x', 'LMG342x (600V)',
        4, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('gan_power', 'GaN Power', 'gan_lmg3650', 'LMG3650 (TOLL)',
        4, { mouser: 'partial', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'LMG3650 is reel-only on Mouser (no qty=1 break) — price tracks the reel/2000 break.'),
      t('gan_power', 'GaN Power', 'gan_lmg5200', 'LMG5200 (80V)',
        4, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
  {
    groupId: 'data_center_power',
    groupLabel: 'Data Center Power',
    subcategories: [
      t('data_center_power', 'Data Center Power', 'dc_48v_bus', '48V Bus Converters',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('data_center_power', 'Data Center Power', 'dc_smart_power_stages', 'Smart Power Stages',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('data_center_power', 'Data Center Power', 'dc_efuses', 'eFuses',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('data_center_power', 'Data Center Power', 'dc_hotswap', 'Hot-Swap Controllers',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
      t('data_center_power', 'Data Center Power', 'dc_tps536xx_ai_power', 'TPS536xx (AI Power)',
        3, { mouser: 'covered', nexar: 'missing', tiDirect: 'future', digikeyDirect: 'future', arrowDirect: 'future' },
        'Mouser-only today.'),
    ],
  },
]

// Convenience flat list for filters / counts.
export const TI_TAXONOMY_FLAT: TaxonomySubcategory[] =
  TI_TAXONOMY.flatMap(g => g.subcategories)

export const TI_TAXONOMY_GROUP_COUNT = TI_TAXONOMY.length
export const TI_TAXONOMY_SUBCATEGORY_COUNT = TI_TAXONOMY_FLAT.length

// ── Aliases ─────────────────────────────────────────────────────────────────
// Existing categoryIds (Mouser PART_MAP + the representative Nexar basket) map
// to the canonical taxonomy via this table. We never delete old IDs — historical
// snapshots reference them — but every new record carries the canonical ID too.
export const LEGACY_TO_CANONICAL: Record<string, string> = {
  // Nexar representative basket (tiBasket.ts)
  pm_ldo: 'power_ldo',
  pm_batt: 'power_battery_mgmt',
  pm_dcdc: 'power_dcdc_switching',
  amp_op: 'amp_opamps',
  dac_adc: 'conv_adc',
  if_can: 'interface_can',
  mcu_msp: 'mcu_msp430',

  // Mouser PART_MAP (index.ts)
  pm_acdc: 'power_acdc_switching',
  pm_super: 'power_supervisor_reset',
  amp_instr: 'amp_instrumentation',
  amp_audio: 'amp_audio',
  amp_cmp: 'amp_comparators',
  dac_dac: 'conv_dac',
  if_lin: 'interface_lin',
  if_eth: 'interface_ethernet_phy',
  iso_dig: 'isolation_digital',
  iso_rein: 'isolation_reinforced',
  mcu_c2k: 'mcu_c2000',
  mcu_m0: 'mcu_mspm0',
  mcu_cc: 'mcu_simplelink',
  mcu_sit: 'mcu_sitara',
  gan_342: 'gan_lmg342x',
  gan_365: 'gan_lmg3650',
  gan_520: 'gan_lmg5200',
  dc_48v: 'dc_48v_bus',
  dc_sps: 'dc_smart_power_stages',
  dc_efuse: 'dc_efuses',
  dc_hswap: 'dc_hotswap',
  dc_tps: 'dc_tps536xx_ai_power',
}

/** Returns the canonical id for a legacy id, or the input itself if it is
 *  already canonical. Falls back to the input on unknown IDs so old snapshots
 *  keep working. */
export function canonicalCategoryId(id: string): string {
  return LEGACY_TO_CANONICAL[id] ?? id
}

export function findSubcategory(canonicalId: string): TaxonomySubcategory | null {
  return TI_TAXONOMY_FLAT.find(s => s.categoryId === canonicalId) ?? null
}

/** Coverage rollup used by /api/ti/taxonomy and basket-coverage. */
export function summarizeTaxonomyCoverage(opts?: {
  /** Canonical IDs that the representative Nexar basket recognizes. */
  representativeBasketSubcategories?: string[]
}) {
  const total = TI_TAXONOMY_FLAT.length
  const mouserCovered = TI_TAXONOMY_FLAT.filter(s => s.currentCoverage.mouser === 'covered').length
  const mouserPartial = TI_TAXONOMY_FLAT.filter(s => s.currentCoverage.mouser === 'partial').length
  const mouserMissing = TI_TAXONOMY_FLAT.filter(s => s.currentCoverage.mouser === 'missing').length
  const nexarSampledOrRotating = TI_TAXONOMY_FLAT.filter(s =>
    s.currentCoverage.nexar === 'sampled' || s.currentCoverage.nexar === 'rotating',
  ).length
  const nexarWatchlist = TI_TAXONOMY_FLAT.filter(s => s.currentCoverage.nexar === 'watchlist').length
  const nexarMissing = TI_TAXONOMY_FLAT.filter(s => s.currentCoverage.nexar === 'missing').length
  const missingOrFuture = TI_TAXONOMY_FLAT.filter(s =>
    s.currentCoverage.mouser === 'missing' && s.currentCoverage.nexar === 'missing',
  ).length
  const repSubs = opts?.representativeBasketSubcategories ?? []
  return {
    totalSubcategories: total,
    mouserCovered,
    mouserPartial,
    mouserMissing,
    nexarSampledOrRotating,
    nexarWatchlist,
    nexarMissing,
    missingOrFuture,
    currentRepresentativeBasketSubcategories: repSubs,
    representativeBasketSubcategoryCount: repSubs.length,
    representativeBasketCoveragePct: total > 0
      ? Math.round((repSubs.length / total) * 1000) / 10
      : 0,
  }
}
