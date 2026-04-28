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

export type BasketSku = {
  mpn: string
  manufacturer: string
  role: SkuRole
  notes?: string
  /** Why this SKU is a representative for the category — investor-facing prose. */
  representativeReason?: string
  importanceTier?: SkuImportanceTier
  sourceCoverageTarget?: SkuSourceTarget[]
}

export type BasketCategory = {
  categoryId: string
  categoryLabel: string
  groupId: string
  groupLabel: string
  skus: BasketSku[]
}

/** The preview basket. EXACTLY 4 SKUs — never expand here without first
 *  raising BASKET_PREVIEW_MAX_CALLS and confirming Nexar quota headroom. */
export const PHASE_8_BASKET_PREVIEW: BasketCategory[] = [
  {
    categoryId: 'pm_ldo',
    categoryLabel: 'LDO Regulators',
    groupId: 'power_management',
    groupLabel: 'Power Management',
    skus: [
      {
        mpn: 'TPS7A8300RGWR',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Anchor SKU for the LDO Regulators category in the existing dashboard.',
        representativeReason: 'High-PSRR low-noise LDO; widely designed-in across analog, RF, and instrumentation. Liquid across all major distributors which makes it a clean cross-source pricing reference.',
        importanceTier: 'primary',
        sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future', 'ti_future'],
      },
      {
        mpn: 'TPS7A4501DCQR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_ldo.',
        representativeReason: 'High-current adjustable LDO; used as a secondary corroboration point for the LDO category — different package/form factor smooths idiosyncratic SKU moves.',
        importanceTier: 'secondary',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
  {
    categoryId: 'pm_batt',
    categoryLabel: 'Battery Management',
    groupId: 'power_management',
    groupLabel: 'Power Management',
    skus: [
      {
        mpn: 'BQ25896RTWT',
        manufacturer: 'Texas Instruments',
        role: 'primary',
        notes: 'Anchor SKU for the Battery Mgmt category in the existing dashboard.',
        representativeReason: 'Switch-mode single-cell Li-ion charger with NVDC; mainstream mobile/portable design-in. Stable demand profile makes it a clean primary reference for the category.',
        importanceTier: 'primary',
        sourceCoverageTarget: ['mouser', 'octopart_nexar', 'digikey_future', 'arrow_future'],
      },
      {
        mpn: 'BQ76952PFBR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_batt.',
        representativeReason: 'Multi-cell battery monitor (3-16S); energy-storage / e-mobility design-in. Higher ASP and lower volume — secondary anchor to balance the consumer-charger primary.',
        importanceTier: 'secondary',
        sourceCoverageTarget: ['mouser', 'octopart_nexar'],
      },
    ],
  },
]

/** Hard cap enforced by the basket-preview endpoint. The endpoint refuses to
 *  fire if the basket size exceeds this value — guards against accidental
 *  expansion that would over-spend the evaluation quota. */
export const BASKET_PREVIEW_MAX_CALLS = 4

/** Coverage marker: this preview is intentionally undersized. Full production
 *  basket capture is gated on a paid/approved Nexar supply plan. */
export const BASKET_STATUS = 'needs_expansion' as const

export const BASKET_PREVIEW_QUOTA_NOTE =
  'Evaluation app is limited; do not run full basket until paid/approved plan.'
