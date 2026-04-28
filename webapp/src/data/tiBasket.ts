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

// ── Quota-safe sampling selector (Phase 15B — anchor + UTC-day rotation) ─────
// Deterministic, date-driven selection. Capture pulls up to `maxCalls` SKUs:
// anchors stay every day for continuity, and the remaining slots rotate
// through the secondary/watchlist categories so unsampled categories build
// observed history over time. No fetches happen in this module.

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

/** Why a given SKU was sampled today. Unsampled rows always carry `quota_limit`. */
export type SamplingReason =
  | 'anchor_continuity'
  | 'rotation_slot'
  | 'fallback_for_failed_primary'
  | 'quota_limit'

export type SamplingPolicy = 'anchor_plus_rotation' | 'priority_topn'

export type BasketSkuRef = {
  category: BasketCategory
  sku: BasketSku
  /** Composite sort key; lower = picked earlier in the day's plan. */
  rank: number
  /** Reason this SKU is in `sampled[]` or `unsampled[]`. */
  reason?: SamplingReason
}

export type BasketSamplingResult = {
  sampled: BasketSkuRef[]
  unsampled: BasketSkuRef[]
  policy: SamplingPolicy
  /** UTC date this plan corresponds to (YYYY-MM-DD). */
  snapshotDate: string
  /** Days-since-1970-01-01 UTC; deterministic seed for the rotation. */
  rotationIndex: number
  /** How many secondary/watchlist categories sit in the rotation pool. */
  rotationPoolSize: number
  /** How many of `maxCalls` are spent on rotation slots today. */
  rotationSlots: number
  /** How many of `maxCalls` are spent on anchor continuity today. */
  anchorSlots: number
  sampleLimit: number
  sampleLimitReason: 'nexar_quota_cap'
  basketCatalogSkuCount: number
  sampledSkuCount: number
  unsampledSkuCount: number
  /** Approximate days under current cap to touch every rotation-pool category at least once. */
  estimatedFullCycleDays: number | null
}

export type SelectSampledSkusOptions = {
  /** Default: BASKET_PREVIEW_MAX_CALLS. Never exceeded. */
  maxCalls?: number
  /** UTC date in YYYY-MM-DD form. Default: today UTC. Drives the rotation. */
  snapshotDate?: string
  /** Default: 'anchor_plus_rotation'. */
  policy?: SamplingPolicy
  /**
   * MPNs that recently failed (e.g. status=error or no_match in the last
   * stored snapshot). When an anchor primary appears here and a fallback
   * exists in the same category, the fallback substitutes for the anchor
   * slot today. Other slots are unaffected.
   */
  recentlyFailedMpns?: string[]
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Days since 1970-01-01 UTC for a YYYY-MM-DD string. Stable across servers. */
export function utcDayOrdinal(snapshotDate: string): number {
  const y = parseInt(snapshotDate.slice(0, 4), 10)
  const m = parseInt(snapshotDate.slice(5, 7), 10)
  const d = parseInt(snapshotDate.slice(8, 10), 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function categorySortKey(cat: BasketCategory): string {
  const r = CATEGORY_ROLE_RANK[cat.categoryRole ?? 'watchlist']
  return `${r}:${cat.categoryId}`
}

function pickPrimarySku(cat: BasketCategory): BasketSku | null {
  let best: BasketSku | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const sku of cat.skus) {
    const sp = sku.samplingPriority ?? 99
    const rr = ROLE_RANK[sku.role] ?? 99
    const r = sp * 1000 + rr
    if (r < bestRank) { bestRank = r; best = sku }
  }
  return best
}

function pickFallbackSku(cat: BasketCategory, primaryMpn: string): BasketSku | null {
  for (const sku of cat.skus) {
    if (sku.mpn !== primaryMpn && sku.role === 'legacy_fallback') return sku
  }
  for (const sku of cat.skus) {
    if (sku.mpn !== primaryMpn) return sku
  }
  return null
}

/**
 * Quota-safe selection. Default policy ('anchor_plus_rotation'):
 *
 *   anchor slots   — one primary per anchor category, every day (continuity).
 *                    If `recentlyFailedMpns` includes the primary, swap in
 *                    the same category's fallback (reason: fallback_for_failed_primary).
 *   rotation slots — remaining maxCalls; cycle through the secondary/watchlist
 *                    categories using `rotationIndex = utcDayOrdinal(snapshotDate)`
 *                    so the same date deterministically picks the same SKUs.
 *
 * Never exceeds `maxCalls`. Unsampled rows are returned with `reason:'quota_limit'`.
 */
export function selectSampledSkus(
  catalog: BasketCategory[],
  options: SelectSampledSkusOptions = {},
): BasketSamplingResult {
  const maxCalls = Math.max(0, options.maxCalls ?? BASKET_PREVIEW_MAX_CALLS)
  const policy = options.policy ?? 'anchor_plus_rotation'
  const snapshotDate = options.snapshotDate ?? todayUtcDate()
  const rotationIndex = utcDayOrdinal(snapshotDate)
  const recentlyFailed = new Set(options.recentlyFailedMpns ?? [])

  // Deterministic catalog order: anchor → secondary → watchlist; ties → categoryId.
  const sortedCatalog = catalog.slice().sort((a, b) =>
    categorySortKey(a).localeCompare(categorySortKey(b)),
  )
  const anchorCats = sortedCatalog.filter(c => (c.categoryRole ?? 'watchlist') === 'anchor')
  const rotationCats = sortedCatalog.filter(c => (c.categoryRole ?? 'watchlist') !== 'anchor')

  const sampled: BasketSkuRef[] = []
  const sampledMpns = new Set<string>()

  if (policy === 'anchor_plus_rotation') {
    // 1) Anchor continuity slots.
    const anchorSlotsAvail = Math.min(anchorCats.length, maxCalls)
    for (let i = 0; i < anchorSlotsAvail; i++) {
      const cat = anchorCats[i]
      let pick = pickPrimarySku(cat)
      let reason: SamplingReason = 'anchor_continuity'
      if (pick && recentlyFailed.has(pick.mpn)) {
        const fb = pickFallbackSku(cat, pick.mpn)
        if (fb) { pick = fb; reason = 'fallback_for_failed_primary' }
      }
      if (!pick) continue
      sampled.push({ category: cat, sku: pick, rank: i, reason })
      sampledMpns.add(pick.mpn)
    }

    // 2) Rotation slots — one primary per rotation category, by date-driven index.
    const rotationSlotsAvail = Math.max(0, maxCalls - sampled.length)
    if (rotationSlotsAvail > 0 && rotationCats.length > 0) {
      const used = new Set<string>()
      for (let i = 0; i < rotationSlotsAvail; i++) {
        // Adjacent slot indices are always distinct mod pool.length, so this
        // never picks the same category twice within one day's plan.
        const idx = ((rotationIndex * rotationSlotsAvail) + i) % rotationCats.length
        const cat = rotationCats[idx]
        if (used.has(cat.categoryId)) continue
        used.add(cat.categoryId)
        const pick = pickPrimarySku(cat)
        if (!pick || sampledMpns.has(pick.mpn)) continue
        sampled.push({
          category: cat,
          sku: pick,
          rank: 1000 + i,
          reason: 'rotation_slot',
        })
        sampledMpns.add(pick.mpn)
      }
    }
  } else {
    // 'priority_topn' — legacy fallback. Sort by (samplingPriority, categoryRole, role).
    const refs: BasketSkuRef[] = []
    for (const cat of sortedCatalog) {
      const cr = CATEGORY_ROLE_RANK[cat.categoryRole ?? 'watchlist']
      for (const sku of cat.skus) {
        const sp = sku.samplingPriority ?? 99
        const rr = ROLE_RANK[sku.role] ?? 99
        refs.push({ category: cat, sku, rank: sp * 1000 + cr * 100 + rr })
      }
    }
    refs.sort((a, b) => a.rank - b.rank)
    for (const r of refs.slice(0, maxCalls)) {
      const reason: SamplingReason =
        (r.category.categoryRole ?? 'watchlist') === 'anchor'
          ? 'anchor_continuity'
          : 'rotation_slot'
      sampled.push({ ...r, reason })
      sampledMpns.add(r.sku.mpn)
    }
  }

  // Build unsampled list (everything in the catalog not picked today).
  const unsampled: BasketSkuRef[] = []
  for (const cat of sortedCatalog) {
    const cr = CATEGORY_ROLE_RANK[cat.categoryRole ?? 'watchlist']
    for (const sku of cat.skus) {
      if (sampledMpns.has(sku.mpn)) continue
      const sp = sku.samplingPriority ?? 99
      const rr = ROLE_RANK[sku.role] ?? 99
      unsampled.push({
        category: cat,
        sku,
        rank: sp * 1000 + cr * 100 + rr,
        reason: 'quota_limit',
      })
    }
  }
  unsampled.sort((a, b) => a.rank - b.rank)

  const basketCatalogSkuCount = sortedCatalog.reduce((s, c) => s + c.skus.length, 0)
  const anchorSlots = (policy === 'anchor_plus_rotation')
    ? Math.min(anchorCats.length, maxCalls)
    : sampled.filter(s => s.reason === 'anchor_continuity' || s.reason === 'fallback_for_failed_primary').length
  const rotationSlots = (policy === 'anchor_plus_rotation')
    ? Math.max(0, maxCalls - anchorSlots)
    : sampled.filter(s => s.reason === 'rotation_slot').length
  const rotationPoolSize = rotationCats.length
  const estimatedFullCycleDays =
    rotationSlots > 0 && rotationPoolSize > 0
      ? Math.ceil(rotationPoolSize / rotationSlots)
      : null

  return {
    sampled,
    unsampled,
    policy,
    snapshotDate,
    rotationIndex,
    rotationPoolSize,
    rotationSlots,
    anchorSlots,
    sampleLimit: maxCalls,
    sampleLimitReason: 'nexar_quota_cap',
    basketCatalogSkuCount,
    sampledSkuCount: sampled.length,
    unsampledSkuCount: unsampled.length,
    estimatedFullCycleDays,
  }
}

/**
 * Forward-looking rotation plan (no fetches; pure simulation of the policy).
 * Default: 7 days starting from the day AFTER `startDate` so the preview
 * shows what will be sampled on upcoming dates, not today.
 */
export function previewRotation(
  catalog: BasketCategory[],
  options: {
    maxCalls?: number
    days?: number
    policy?: SamplingPolicy
    /** YYYY-MM-DD; preview begins the next UTC day. Default: today. */
    startDate?: string
  } = {},
): Array<{
  snapshotDate: string
  rotationIndex: number
  sampledSkus: Array<{
    mpn: string
    categoryId: string
    categoryLabel: string
    reason: SamplingReason
  }>
}> {
  const days = Math.max(1, Math.min(31, options.days ?? 7))
  const startDate = options.startDate ?? todayUtcDate()
  const startMs = Date.parse(startDate + 'T00:00:00Z')
  const out: Array<{
    snapshotDate: string
    rotationIndex: number
    sampledSkus: Array<{ mpn: string; categoryId: string; categoryLabel: string; reason: SamplingReason }>
  }> = []
  for (let d = 1; d <= days; d++) {
    const dayMs = startMs + d * 86_400_000
    const ds = new Date(dayMs).toISOString().slice(0, 10)
    const r = selectSampledSkus(catalog, {
      maxCalls: options.maxCalls,
      snapshotDate: ds,
      policy: options.policy,
    })
    out.push({
      snapshotDate: ds,
      rotationIndex: r.rotationIndex,
      sampledSkus: r.sampled.map(s => ({
        mpn: s.sku.mpn,
        categoryId: s.category.categoryId,
        categoryLabel: s.category.categoryLabel,
        reason: s.reason ?? 'rotation_slot',
      })),
    })
  }
  return out
}

/** Compact summary for inclusion in API responses (snapshot.metadata + evidence). */
export function summarizeSampling(
  result: BasketSamplingResult,
  options: { catalog?: BasketCategory[]; previewDays?: number } = {},
) {
  const summary = {
    policy: result.policy,
    snapshotDate: result.snapshotDate,
    rotationIndex: result.rotationIndex,
    rotationPoolSize: result.rotationPoolSize,
    rotationSlots: result.rotationSlots,
    anchorSlots: result.anchorSlots,
    estimatedFullCycleDays: result.estimatedFullCycleDays,
    basketCatalogSkuCount: result.basketCatalogSkuCount,
    sampledSkuCount: result.sampledSkuCount,
    unsampledSkuCount: result.unsampledSkuCount,
    sampleLimit: result.sampleLimit,
    /** Spec-aligned alias for sampleLimit. */
    currentSampleLimit: result.sampleLimit,
    sampleLimitReason: result.sampleLimitReason,
    sampledSkus: result.sampled.map(r => ({
      mpn: r.sku.mpn,
      categoryId: r.category.categoryId,
      categoryLabel: r.category.categoryLabel,
      role: r.sku.role,
      samplingPriority: r.sku.samplingPriority ?? null,
      reason: r.reason ?? null,
    })),
    unsampledSkus: result.unsampled.map(r => ({
      mpn: r.sku.mpn,
      categoryId: r.category.categoryId,
      categoryLabel: r.category.categoryLabel,
      role: r.sku.role,
      samplingPriority: r.sku.samplingPriority ?? null,
      reason: r.reason ?? 'quota_limit',
    })),
  }
  if (options.catalog) {
    return {
      ...summary,
      nextRotationPreview: previewRotation(options.catalog, {
        maxCalls: result.sampleLimit,
        days: options.previewDays ?? 7,
        policy: result.policy,
        startDate: result.snapshotDate,
      }),
    }
  }
  return summary
}
