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

export type BasketSku = {
  mpn: string
  manufacturer: string
  role: SkuRole
  notes?: string
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
      },
      {
        mpn: 'TPS7A4501DCQR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_ldo.',
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
      },
      {
        mpn: 'BQ76952PFBR',
        manufacturer: 'Texas Instruments',
        role: 'legacy_fallback',
        notes: 'Existing fallback in PART_MAP for pm_batt.',
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
