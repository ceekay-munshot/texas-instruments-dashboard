// ── Distributor source classification ────────────────────────────────────────
// Used by the Nexar/Octopart normalizer to separate authorized/core distributor
// signal from marketplace/broker signal. We deliberately do NOT blend these
// into a single average — the core pricing/inventory signal must come from
// authorized or known-major distributors, with broker offers tracked separately.
//
// Matching is conservative (word-boundary regex). When we cannot recognize a
// named seller we default to `marketplace_or_broker` rather than promoting it.
// `unknown` is reserved for offers with a missing or empty seller name.

export type DistributorTier =
  | 'authorized_or_core'
  | 'marketplace_or_broker'
  | 'unknown'

// Visible allowlist (used in API responses / UI captions).
export const TRUSTED_DISTRIBUTOR_LIST = [
  'Mouser',
  'DigiKey',
  'Texas Instruments',
  'Arrow',
  'Newark',
  'Farnell',
  'element14',
  'RS',
  'TME',
  'Future Electronics',
  'Avnet',
] as const

// Patterns matched (case-insensitive, word-boundary). Regional variants and
// common verbose forms are included; ambiguous bare codes (e.g. "RS" alone)
// are NOT matched — only known multi-word forms — to avoid false positives.
const TRUSTED_PATTERNS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bmouser\b/i,                                     canonical: 'Mouser' },
  { pattern: /\bdigi[\s-]?key\b/i,                              canonical: 'DigiKey' },
  { pattern: /\btexas\s+instruments?\b/i,                       canonical: 'Texas Instruments' },
  { pattern: /\bti\.com\b/i,                                    canonical: 'Texas Instruments' },
  { pattern: /\barrow\s+(?:electronics?|asia|emea|na|north)\b/i, canonical: 'Arrow' },
  { pattern: /^arrow$/i,                                        canonical: 'Arrow' },
  { pattern: /\bnewark\b/i,                                     canonical: 'Newark' },
  { pattern: /\bfarnell\b/i,                                    canonical: 'Farnell' },
  { pattern: /\belement\s*14\b/i,                               canonical: 'element14' },
  { pattern: /\brs\s+(?:components?|pro|online|americas?)\b/i,  canonical: 'RS' },
  { pattern: /\ballied\s+electronics\b/i,                       canonical: 'RS / Allied' },
  { pattern: /\btme\b/i,                                        canonical: 'TME' },
  { pattern: /\btransfer\s+multisort\b/i,                       canonical: 'TME' },
  { pattern: /\bfuture\s+electronics?\b/i,                      canonical: 'Future Electronics' },
  { pattern: /\bavnet\b/i,                                      canonical: 'Avnet' },
]

export function classifyDistributor(name?: string | null): DistributorTier {
  if (!name) return 'unknown'
  const n = String(name).trim()
  if (!n) return 'unknown'
  for (const p of TRUSTED_PATTERNS) {
    if (p.pattern.test(n)) return 'authorized_or_core'
  }
  return 'marketplace_or_broker'
}

/**
 * Returns a canonical (deduplication-friendly) distributor name. For trusted
 * matches this is the curated canonical form ("DigiKey", "Mouser", …) so that
 * Nexar variants like "Digi-Key", "Digi-Key Electronics", "Digi Key" all
 * collapse to a single bucket. For unrecognized names returns the trimmed
 * original. Returns null only when the input is empty/missing.
 */
export function canonicalDistributorName(name?: string | null): string | null {
  if (!name) return null
  const n = String(name).trim()
  if (!n) return null
  for (const p of TRUSTED_PATTERNS) {
    if (p.pattern.test(n)) return p.canonical
  }
  return n
}
