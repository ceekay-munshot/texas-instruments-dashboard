// ── Phase 8 — TI basket preview (multi-SKU, quota-bounded) ──────────────────
// Tiny preview basket used by /api/nexar/basket-preview. We deliberately keep
// this very small while we are on the Nexar Evaluation app: the existing
// dashboard's PART_MAP carries 2 SKUs per category × 28 categories (= 56 MPN
// calls per refresh) which is far too many for the evaluation supply quota.
// This phase only validates that multi-SKU category averaging + per-category
// aggregation work end-to-end; it is *not* the full production basket.
//
// All MPNs here already exist as primary or fallback parts in
// `webapp/src/index.ts` PART_MAP — we are not introducing new SKUs.

export type SkuRole = 'primary' | 'representative' | 'legacy_fallback'

/** Investor-facing importance tier. `primary` = canonical reference SKU for
 * the category; `secondary` = useful corroboration; `watchlist` = monitored
 * but not yet weighted into the category aggregate. */
export type SkuImportanceTier = 'primary' | 'secondary' | 'watchlist'

/** Sources we either cover today (mouser, octopart_nexar) or want to cover
 * once auth/quota is in place (digikey_future, arrow_future, ti_future).
 * Surfaced in the basket so a future expansion can pick up only the SKUs
 * that already declared they want a given source. */
export type SkuSourceTarget =
  | 'mouser'
  | 'octopart_nexar'
  | 'digikey_future'
  | 'arrow_future'
  | 'ti_future'

/** Sampling priority for the daily capture — lower number = sampled first.
 * Used by selectSampledSkus() to honor the maxCalls cap deterministically. */
export type SkuSamplingPriority = 1 | 2 | 3

/** Category role for the representative monitoring set:
 *   anchor    — top-of-table reference category (always sampled today)
 *   secondary — important but not the anchor; sampled when quota expands
 *   watchlist — observed for catalog reasons, sampled last */
export type BasketCategoryRole = 'anchor' | 'secondary' | 'watchlist'

export type BasketSku = {
  mpn: string
  manufacturer: string
  role: SkuRole
  notes?: string
  /** Why this SKU is a representative for the category — investor-facing prose. */
  representativeReason?: string
  importanceTier?: SkuImportanceTier
  sourceCoverageTarget?: SkuSourceTarget[]
  /** 1 = capture first; 2 = capture next quota tier; 3 = watchlist only. */
  samplingPriority?: SkuSamplingPriority
  /** When this SKU is a fallback for a primary, the primary's mpn. */
  fallbackFor?: string
}

export type BasketCategory = {
  categoryId: string
  categoryLabel: string
  groupId: string
  groupLabel: string
  /** Investor framing: what role this category plays in the monitoring set. */
  categoryRole?: BasketCategoryRole
  /** Investor-facing prose: why this category matters as a price-signal proxy. */
  whyItMatters?: string
  /** Category-level coverage target (subset of, or aligned with, per-SKU). */
  sourceCoverageTarget?: SkuSourceTarget[]
  skus: BasketSku[]
}

/** Representative TI basket catalog (Phase 15A expansion).
 *
 * Two anchor categories (sampled today under the existing maxCalls=4 cap)
 * plus five additional categories that are catalogued and visible as
 * "monitored watchlist" but **not** sampled until the Nexar quota cap is
 * raised. All MPNs are SKUs already used by the existing 28-category Mouser
 * dashboard's PART_MAP — we are not introducing new SKUs, only annotating
 * which subset gets daily-captured today vs. which waits for higher quota.
 *
 * Sampling order is driven by `selectSampledSkus()` below using the rank:
 *     samplingPriority × 1000  +  categoryRole × 100  +  role
 * which deterministically picks the 4 anchor SKUs at samplingPriority=1
 * before any priority=2 SKU. New monitored-but-unsampled categories are at
 * priority=2 (primary) and priority=3 (fallback). */
export const PHASE_8_BASKET_PREVIEW: BasketCategory[] = [
  // ── ANCHOR CATEGORIES (sampled today) ───────────────────────────────────
  {
    categoryId: 'pm_ldo',
    categoryLabel: 'LDO Regulators',
    groupId: 'power_management',
    groupLabel: 'Power Management',
    categoryRole: 'anchor',
    whyItMatters: 'Low-noise LDOs power analog, RF, and instrumentation rails. Pricing leadership on this category is a direct read on TI analog supply discipline.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future', 'ti_future'],
    skus: [
      {
        mpn: 'TPS7A8300RGWR',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Anchor SKU for the LDO Regulators category in the existing dashboard.',
        representativeReason: 'High-PSRR low-noise LDO; widely designed-in across analog, RF, and instrumentation. Liquid across all major distributors which makes it a clean cross-source pricing reference.',
        importanceTier: 'primary',
        samplingPriority: 1,
        sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future', 'ti_future'],
      },
      {
        mpn: 'TPS7A4501DCQR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_ldo.',
        representativeReason: 'High-current adjustable LDO; used as a secondary corroboration point for the LDO category — different package/form factor smooths idiosyncratic SKU moves.',
        importanceTier: 'secondary',
        samplingPriority: 1,
        fallbackFor: 'TPS7A8300RGWR',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'pm_batt',
    categoryLabel: 'Battery Management',
    groupId: 'power_management',
    groupLabel: 'Power Management',
    categoryRole: 'anchor',
    whyItMatters: 'Battery-charging is a high-volume mobile/EV consumer indicator and one of TI\'s largest analog franchises. Inventory shifts here track end-market demand cycles closely.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future', 'ti_future'],
    skus: [
      {
        mpn: 'BQ25896RTWT',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Anchor SKU for the Battery Mgmt category in the existing dashboard.',
        representativeReason: 'Switch-mode single-cell Li-ion charger with NVDC; mainstream mobile/portable design-in. Stable demand profile makes it a clean primary reference for the category.',
        importanceTier: 'primary',
        samplingPriority: 1,
        sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future'],
      },
      {
        mpn: 'BQ76952PFBR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_batt.',
        representativeReason: 'Multi-cell battery monitor (3-16S); energy-storage / e-mobility design-in. Higher ASP and lower volume — secondary anchor to balance the consumer-charger primary.',
        importanceTier: 'secondary',
        samplingPriority: 1,
        fallbackFor: 'BQ25896RTWT',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },

  // ── SECONDARY CATEGORIES (catalogued, unsampled at maxCalls=4) ──────────
  {
    categoryId: 'pm_dcdc',
    categoryLabel: 'Buck / DC-DC Converters',
    groupId: 'power_management',
    groupLabel: 'Power Management',
    categoryRole: 'secondary',
    whyItMatters: 'Industrial-workhorse switching converters. Pricing here moves with industrial-equipment demand and is a leading indicator for broader analog TAM.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future'],
    skus: [
      {
        mpn: 'TPS54360BDDA',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Existing primary in PART_MAP for pm_dcdc.',
        representativeReason: 'SWIFT 3.5A buck regulator; broad mid-power industrial design-in.',
        importanceTier: 'primary',
        samplingPriority: 2,
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
      {
        mpn: 'LM5176PWPR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_dcdc.',
        representativeReason: 'Wide-Vin synchronous buck-boost; lower-volume, higher-spec proxy for industrial robustness.',
        importanceTier: 'secondary',
        samplingPriority: 3,
        fallbackFor: 'TPS54360BDDA',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'amp_op',
    categoryLabel: 'Precision Amplifiers',
    groupId: 'amplifiers',
    groupLabel: 'Amplifiers',
    categoryRole: 'secondary',
    whyItMatters: 'Precision op-amps signal precision-analog demand from instrumentation, medical, and test-and-measurement markets — long-cycle, high-margin TI franchise.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future'],
    skus: [
      {
        mpn: 'OPA376AIDBVR',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Existing primary in PART_MAP for amp_op.',
        representativeReason: 'Low-offset, low-noise CMOS op-amp; instrumentation and sensor-front-end staple.',
        importanceTier: 'primary',
        samplingPriority: 2,
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
      {
        mpn: 'TLV2372IDGKR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for amp_op.',
        representativeReason: 'Dual rail-to-rail general-purpose op-amp; broad-design-in workhorse used to corroborate the precision-op-amp primary.',
        importanceTier: 'secondary',
        samplingPriority: 3,
        fallbackFor: 'OPA376AIDBVR',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'dac_adc',
    categoryLabel: 'Data Converters / ADCs',
    groupId: 'data_converters',
    groupLabel: 'Data Converters',
    categoryRole: 'secondary',
    whyItMatters: 'ADCs sit on the sensor-pipeline path. Cross-segment sampling demand (industrial automation, medical, comms) shows up here before downstream processors.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future'],
    skus: [
      {
        mpn: 'ADS1115IRUGR',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Existing primary in PART_MAP for dac_adc.',
        representativeReason: '16-bit Σ-Δ ADC with PGA and I²C; one of TI\'s most broadly designed-in low-speed ADCs.',
        importanceTier: 'primary',
        samplingPriority: 2,
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
      {
        mpn: 'ADS8685IPW',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for dac_adc.',
        representativeReason: '16-bit SAR ADC; precision-industrial corroboration to the high-volume Σ-Δ primary.',
        importanceTier: 'secondary',
        samplingPriority: 3,
        fallbackFor: 'ADS1115IRUGR',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'if_can',
    categoryLabel: 'Interface / CAN Transceivers',
    groupId: 'interface',
    groupLabel: 'Interface ICs',
    categoryRole: 'watchlist',
    whyItMatters: 'CAN transceivers are an automotive / industrial-bus indicator. Tightening here often precedes broader industrial-electronics constraint signals.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar'],
    skus: [
      {
        mpn: 'TCAN1042DRBTQ1',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Existing primary in PART_MAP for if_can.',
        representativeReason: 'AEC-Q100 CAN FD transceiver; mainstream automotive/industrial communication.',
        importanceTier: 'primary',
        samplingPriority: 2,
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
      {
        mpn: 'TCAN1051DRQ1',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for if_can.',
        representativeReason: 'AEC-Q100 5V CAN transceiver — package and feature variant that backs up the primary.',
        importanceTier: 'secondary',
        samplingPriority: 3,
        fallbackFor: 'TCAN1042DRBTQ1',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'mcu_msp',
    categoryLabel: 'Embedded Processing / MSP430 MCUs',
    groupId: 'microcontrollers',
    groupLabel: 'Microcontrollers',
    categoryRole: 'watchlist',
    whyItMatters: 'MSP430 is a long-tail, mature TI MCU family. Demand on legacy MCU lines is a useful counterpoint to next-gen ARM Cortex MCUs and signals lifecycle-stage of TI\'s embedded portfolio.',
    sourceCoverageTarget: ['mouser', 'octopart_nexar'],
    skus: [
      {
        mpn: 'MSP430FR2355TRHAT',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Existing primary in PART_MAP for mcu_msp.',
        representativeReason: 'FRAM-based mixed-signal MSP430; modern flagship of the family.',
        importanceTier: 'primary',
        samplingPriority: 2,
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
      {
        mpn: 'MSP430G2553IPW28R',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for mcu_msp.',
        representativeReason: 'Long-running value-line MSP430; tracks sustained demand on mature MCU lifecycle.',
        importanceTier: 'watchlist',
        samplingPriority: 3,
        fallbackFor: 'MSP430FR2355TRHAT',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
]

/** Backward-compatible alias for the catalog. */
export const TI_REPRESENTATIVE_BASKET = PHASE_8_BASKET_PREVIEW

/** Hard cap enforced by the basket-preview endpoint. The endpoint refuses to
 *  fire if the basket size exceeds this value — guards against accidental
 *  expansion that would over-spend the evaluation quota. */
export const BASKET_PREVIEW_MAX_CALLS = 4

/** Coverage marker: this preview is intentionally undersized. Full production
 *  basket capture is gated on a paid/approved Nexar supply plan. */
export const BASKET_STATUS = 'needs_expansion' as const

export const BASKET_PREVIEW_QUOTA_NOTE =
  'Evaluation app is limited; do not run full basket until paid/approved plan.'

// ── Quota-safe sampling selector ─────────────────────────────────────────────
// Deterministic sort over the catalog. Capture pulls the top `maxCalls`; the
// rest stay catalogued as monitored watchlist. No fetches happen here.

const ROLE_RANK: Record<SkuRole, number> = {
  primary: 0,
  representative: 1,
  legacy_fallback: 2,
}

const CATEGORY_ROLE_RANK: Record<BasketCategoryRole, number> = {
  anchor: 0,
  secondary: 1,
  watchlist: 2,
}

export type BasketSkuRef = {
  category: BasketCategory
  sku: BasketSku
  /** Composite sort key; lower = sampled first. */
  rank: number
}

export type BasketSamplingResult = {
  sampled: BasketSkuRef[]
  unsampled: BasketSkuRef[]
  sampleLimit: number
  sampleLimitReason: 'nexar_quota_cap'
  basketCatalogSkuCount: number
  sampledSkuCount: number
  unsampledSkuCount: number
}

/**
 * Rank order:
 *   1. samplingPriority  (1 → sampled first; default 99 = last)
 *   2. categoryRole      (anchor < secondary < watchlist)
 *   3. role              (primary < representative < legacy_fallback)
 *
 * Stable: ties fall back on the order SKUs appear in the catalog array.
 */
export function selectSampledSkus(
  catalog: BasketCategory[],
  maxCalls: number,
): BasketSamplingResult {
  const refs: BasketSkuRef[] = []
  for (const cat of catalog) {
    const catRoleRank = CATEGORY_ROLE_RANK[cat.categoryRole ?? 'watchlist']
    for (const sku of cat.skus) {
      const samplingPriority = sku.samplingPriority ?? 99
      const roleRank = ROLE_RANK[sku.role] ?? 99
      const rank = samplingPriority * 1000 + catRoleRank * 100 + roleRank
      refs.push({ category: cat, sku, rank })
    }
  }
  // Stable sort by rank (preserves catalog order on ties).
  refs.sort((a, b) => a.rank - b.rank)

  const sampled = refs.slice(0, Math.max(0, maxCalls))
  const unsampled = refs.slice(Math.max(0, maxCalls))
  return {
    sampled,
    unsampled,
    sampleLimit: maxCalls,
    sampleLimitReason: 'nexar_quota_cap',
    basketCatalogSkuCount: refs.length,
    sampledSkuCount: sampled.length,
    unsampledSkuCount: unsampled.length,
  }
}

/** Compact summary for inclusion in API responses (snapshot.metadata + evidence). */
export function summarizeSampling(result: BasketSamplingResult) {
  return {
    basketCatalogSkuCount: result.basketCatalogSkuCount,
    sampledSkuCount: result.sampledSkuCount,
    unsampledSkuCount: result.unsampledSkuCount,
    sampleLimit: result.sampleLimit,
    sampleLimitReason: result.sampleLimitReason,
    sampledSkus: result.sampled.map(r => ({
      mpn: r.sku.mpn,
      categoryId: r.category.categoryId,
      categoryLabel: r.category.categoryLabel,
      role: r.sku.role,
      samplingPriority: r.sku.samplingPriority ?? null,
    })),
    unsampledSkus: result.unsampled.map(r => ({
      mpn: r.sku.mpn,
      categoryId: r.category.categoryId,
      categoryLabel: r.category.categoryLabel,
      role: r.sku.role,
      samplingPriority: r.sku.samplingPriority ?? null,
    })),
  }
}
