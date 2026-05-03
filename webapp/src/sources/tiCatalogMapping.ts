// ── Phase 24C — Deterministic OPN/GPN/description → canonical subcategory ───
// Maps TI catalog rows to the 28 canonical subcategories in tiTaxonomy.ts
// using rule-based pattern matching. Pure JS — no LLM, no external API
// calls, no runtime dependencies beyond the rule list itself.
//
// Rules are evaluated in order; the first match wins. Each rule emits a
// canonical_group, canonical_subcategory, mapping_confidence, and a
// stable rule_id so downstream tooling can answer "which rule mapped
// this OPN" without re-running the matcher.
//
// To make the rebuilder cheap, the same rule list is also rendered into
// a single SQL CASE expression by buildSqlMappingCase() so the entire
// mapping + aggregation can run inside one D1 statement.
//
// Confidence scale:
//   high    — TI part-number prefix matches a known canonical family
//             (e.g. "MSP430*" → mcu_msp430). Very low false-positive
//             risk; safe for customer-facing badges.
//   medium  — broader prefix match that covers the right family but may
//             include some adjacent variants (e.g. "INA*" current/power
//             monitors are surfaced under amp_opamps because the
//             taxonomy doesn't have a separate current-monitor bucket).
//   low     — description keyword fallback only; weakest; excluded from
//             confident customer-facing surfaces unless the operator
//             opts into low-confidence display.

export type MappingConfidence = 'high' | 'medium' | 'low'

export type MappingRule = {
  ruleId: string
  /** SQL fragment that matches against ti_catalog_latest_opn. May
   *  reference generic_part_number, ti_part_number, description.
   *  No bound parameters — the literals are baked in so a single
   *  CASE expression can be assembled at startup. Keep operands
   *  ASCII-safe and quoted. */
  sql: string
  /** JS predicate equivalent of `sql`. Used by the in-Worker matcher
   *  for any callers that want to map a single row without round-
   *  tripping through D1 (currently only the test path). */
  match: (gpn: string, opn: string, description: string) => boolean
  canonicalGroup: string
  canonicalSubcategory: string
  confidence: MappingConfidence
}

const upper = (s: unknown) => (typeof s === 'string' ? s.toUpperCase() : '')

/** Helper that turns an array of OPN/GPN prefixes into both a SQL OR
 *  clause and a matching JS predicate. We always uppercase before
 *  comparing so 'msp430' and 'MSP430' both hit. */
function gpnPrefix(prefixes: string[]): { sql: string; match: MappingRule['match'] } {
  const ups = prefixes.map(p => p.toUpperCase())
  const sql = ups.map(p => `UPPER(generic_part_number) LIKE '${p}%'`).join(' OR ')
  return {
    sql,
    match: (gpn /*, opn, desc */) => {
      const g = upper(gpn)
      return ups.some(p => g.startsWith(p))
    },
  }
}

function descKeyword(patterns: RegExp[]): { sql: string; match: MappingRule['match'] } {
  // SQL only supports LIKE, not regex. Lower the regex to a simple
  // case-insensitive LIKE keyword for the SQL side.
  const sqlClauses = patterns.map(p => {
    const literal = p.source.replace(/[\\\\^$|?*+\\[\\](){}]/g, '').replace(/\\\\b/g, '')
    return `description LIKE '%${literal.toUpperCase()}%' COLLATE NOCASE`
  }).join(' OR ')
  return {
    sql: sqlClauses,
    match: (gpn, opn, desc) => patterns.some(p => p.test(desc || '')),
  }
}

function rule(
  ruleId: string,
  test: { sql: string; match: MappingRule['match'] },
  canonicalGroup: string,
  canonicalSubcategory: string,
  confidence: MappingConfidence,
): MappingRule {
  return { ruleId, sql: test.sql, match: test.match, canonicalGroup, canonicalSubcategory, confidence }
}

// ── Master rule list ────────────────────────────────────────────────────────
// Order matters — most specific first. Tested in the same order both in
// JS and in the assembled SQL CASE.
export const CANONICAL_MAPPING_RULES: MappingRule[] = [
  // ── GaN Power (very specific OPN families) ──────────────────────────────
  rule('gan_lmg342x',  gpnPrefix(['LMG3422', 'LMG3425', 'LMG3424']), 'gan_power',         'gan_lmg342x', 'high'),
  rule('gan_lmg3650',  gpnPrefix(['LMG3650']),                       'gan_power',         'gan_lmg3650', 'high'),
  rule('gan_lmg5200',  gpnPrefix(['LMG5200']),                       'gan_power',         'gan_lmg5200', 'high'),

  // ── Microcontrollers ────────────────────────────────────────────────────
  rule('mcu_msp430',   gpnPrefix(['MSP430']),                        'microcontrollers',  'mcu_msp430',     'high'),
  rule('mcu_mspm0',    gpnPrefix(['MSPM0']),                         'microcontrollers',  'mcu_mspm0',      'high'),
  rule('mcu_c2000',    gpnPrefix(['TMS320F28', 'TMS320C28', 'F2837', 'F28P']), 'microcontrollers', 'mcu_c2000', 'high'),
  rule('mcu_simplelink', gpnPrefix(['CC13', 'CC26', 'CC23', 'CC32', 'CC65']), 'microcontrollers', 'mcu_simplelink', 'high'),
  rule('mcu_sitara',   gpnPrefix(['AM335', 'AM437', 'AM572', 'AM625', 'AM62', 'AM64', 'AM65']), 'microcontrollers', 'mcu_sitara', 'high'),

  // ── Data Center Power (must come BEFORE generic TPS5x DC-DC bucket) ─────
  rule('dc_tps536xx',  gpnPrefix(['TPS536']),                        'data_center_power', 'dc_tps536xx_ai_power',   'high'),
  rule('dc_efuses',    gpnPrefix(['TPS25', 'TPS26', 'TPS27', 'TPS65981', 'TPS65987']), 'data_center_power', 'dc_efuses', 'high'),
  rule('dc_hotswap',   gpnPrefix(['LM5066', 'TPS241', 'TPS2480', 'TPS2490']), 'data_center_power', 'dc_hotswap',   'high'),
  rule('dc_smart_power_stages', gpnPrefix(['CSD9', 'TPS546', 'TPS547']), 'data_center_power', 'dc_smart_power_stages', 'high'),
  rule('dc_48v_bus',   gpnPrefix(['LMQ', 'LMR16030', 'LMG2611']),    'data_center_power', 'dc_48v_bus',     'medium'),

  // ── Data Converters ─────────────────────────────────────────────────────
  rule('conv_adc',     gpnPrefix(['ADC', 'ADS']),                    'data_converters',   'conv_adc',       'high'),
  rule('conv_dac',     gpnPrefix(['DAC']),                           'data_converters',   'conv_dac',       'high'),

  // ── Isolation ───────────────────────────────────────────────────────────
  // Reinforced first (more specific keyword in description); fall back to
  // digital isolators for everything else with the ISO prefix.
  rule('isolation_reinforced', { sql: `(UPPER(generic_part_number) LIKE 'ISO%') AND description LIKE '%REINFORCED%' COLLATE NOCASE`,
    match: (g, o, d) => upper(g).startsWith('ISO') && /reinforced/i.test(d || '') },
    'isolation', 'isolation_reinforced', 'high'),
  rule('isolation_digital', gpnPrefix(['ISO', 'ISO77', 'ISO78']),    'isolation',         'isolation_digital', 'medium'),

  // ── Interface ICs ───────────────────────────────────────────────────────
  rule('interface_ethernet_phy', gpnPrefix(['DP83']),                'interface_ics',     'interface_ethernet_phy', 'high'),
  rule('interface_can',  gpnPrefix(['TJA10', 'TCAN', 'SN65HVD2', 'SN65HVD3']), 'interface_ics', 'interface_can', 'high'),
  rule('interface_lin',  gpnPrefix(['TLIN', 'SN65HVDA', 'TJA1024']), 'interface_ics',    'interface_lin',  'high'),

  // ── Amplifiers ──────────────────────────────────────────────────────────
  rule('amp_opamps',    gpnPrefix(['OPA']),                          'amplifiers',        'amp_opamps',     'high'),
  rule('amp_instrumentation', gpnPrefix(['INA1', 'INA8', 'INA12', 'INA82', 'INA826']), 'amplifiers', 'amp_instrumentation', 'high'),
  // Generic INA* (current/power monitors) — bucket under op-amps with
  // medium confidence since the taxonomy doesn't have a dedicated
  // current-monitor subcategory.
  rule('amp_ina_currentmon', gpnPrefix(['INA']),                     'amplifiers',        'amp_opamps',     'medium'),
  rule('amp_audio',     gpnPrefix(['TPA', 'TAS']),                   'amplifiers',        'amp_audio',      'high'),

  // ── Power Management (after data-center / GaN to avoid clobber) ─────────
  rule('power_battery_mgmt', gpnPrefix(['BQ24', 'BQ25', 'BQ27', 'BQ40', 'BQ34', 'BQ76']), 'power_management', 'power_battery_mgmt', 'high'),
  rule('power_acdc_switching', gpnPrefix(['UCC28', 'UCC25']),        'power_management',  'power_acdc_switching', 'high'),
  // Phase 24C.1 — load switches (TPS22*) bucket under supervisor/reset
  // since the canonical taxonomy doesn't have a dedicated load-switch
  // subcategory; medium confidence flags this for the operator.
  rule('power_load_switch_tps22', gpnPrefix(['TPS22']),              'power_management',  'power_supervisor_reset', 'medium'),
  rule('power_supervisor_reset', gpnPrefix(['TPS3', 'TPS779', 'TLV803', 'TLV810']), 'power_management', 'power_supervisor_reset', 'medium'),
  // Phase 24C.1 — TPS7A* LDOs explicitly (TPS779 already covered by
  // existing list; TPS7A* is a wider TI LDO family seen in unmapped
  // samples).
  rule('power_ldo_tps7a', gpnPrefix(['TPS7A']),                      'power_management',  'power_ldo',              'high'),
  rule('power_ldo',     gpnPrefix(['TLV7', 'TLV8', 'TLV9', 'TPS779', 'LP590', 'TLV767', 'TPS73', 'TPS74']), 'power_management', 'power_ldo', 'high'),
  // Phase 24C.1 — motor drivers (DRV8/3/5) bucket under DC-DC switching
  // since the taxonomy doesn't have a dedicated motor-driver bucket.
  // Phase 24C.2 — removed `power_led_driver` (LM3*/TPS9*/TLC59*) because
  // the LM3* prefix matched LM358 op-amps and other unrelated parts;
  // also removed analog_voltage_ref, analog_temp_sensor, interface_logic_switch,
  // interface_esd_protection, and all desc_* keyword fallbacks because
  // production verification (interface_can opnCount=12842, low=12458;
  // amp_opamps highest-inv=TMP113AIYBGR; isolation_digital
  // highest-inv=TLV61046 boost converter) showed they were placing
  // unrelated parts into customer-facing categories. Better to leave
  // them unmapped and surface that honestly than to ship contaminated
  // rollups. Operator can re-add narrower rules later.
  rule('power_motor_driver', gpnPrefix(['DRV8', 'DRV3', 'DRV5']),    'power_management',  'power_dcdc_switching',   'medium'),
  // Catch-all DC-DC AFTER the more specific TPS546 / TPS25xx rules above.
  rule('power_dcdc_switching', gpnPrefix(['TPS54', 'TPS55', 'TPS56', 'TPS57', 'TPS61', 'TPS62', 'TPS63', 'LMR1', 'LMR2', 'LMR3', 'LM5145', 'LM5146']), 'power_management', 'power_dcdc_switching', 'high'),

  // ── Phase 24C.2 — desc_* keyword fallbacks intentionally absent ────────
  // The Phase 24C low-confidence keyword fallbacks (`desc_ldo`,
  // `desc_buck`, `desc_opamp`, `desc_adc`, `desc_dac`, `desc_can`,
  // `desc_isolator`) generated the bulk of the mapping contamination
  // observed on production: free-form description keywords matched
  // unrelated parts ("isolation" appears in many non-isolator
  // descriptions, including TLV61046 boost converters). Removing them
  // drops mappingCoveragePct from ~57% to ~25–30% but the remaining
  // mapped rows are clean enough to drive Prices tab evidence.

  // Description keyword fallbacks intentionally removed — see Phase 24C.2
  // comment block above. The descKeyword() helper is kept defined for
  // future narrow rules that combine a tight prefix + a description
  // qualifier; no current rules use it.
]

export type MappingResult = {
  canonicalGroup: string
  canonicalSubcategory: string
  mappingConfidence: MappingConfidence
  ruleId: string
} | null

/** In-Worker single-row matcher. Returns null if no rule fires. */
export function mapOpnToCanonical(args: { gpn?: string | null; opn?: string | null; description?: string | null }): MappingResult {
  const gpn = upper(args.gpn ?? '')
  const opn = upper(args.opn ?? '')
  const description = (args.description ?? '') as string
  for (const r of CANONICAL_MAPPING_RULES) {
    if (r.match(gpn, opn, description)) {
      return {
        canonicalGroup: r.canonicalGroup,
        canonicalSubcategory: r.canonicalSubcategory,
        mappingConfidence: r.confidence,
        ruleId: r.ruleId,
      }
    }
  }
  return null
}

/** Renders the rule list into a single SQL CASE expression that returns
 *  the canonical_subcategory for each row in ti_catalog_latest_opn.
 *  Returns NULL when no rule fires. Rules are emitted in the same order
 *  as CANONICAL_MAPPING_RULES — first WHEN that matches wins, mirroring
 *  the JS matcher exactly. */
export function buildSqlSubcategoryCase(): string {
  const whens = CANONICAL_MAPPING_RULES
    .map(r => `WHEN (${r.sql}) THEN '${r.canonicalSubcategory}'`)
    .join('\n      ')
  return `CASE\n      ${whens}\n      ELSE NULL\n    END`
}

/** Same shape, returns the canonical_group. Used so the rebuilder can
 *  emit both columns from a single GROUP BY without a second join. */
export function buildSqlGroupCase(): string {
  const whens = CANONICAL_MAPPING_RULES
    .map(r => `WHEN (${r.sql}) THEN '${r.canonicalGroup}'`)
    .join('\n      ')
  return `CASE\n      ${whens}\n      ELSE NULL\n    END`
}

/** And the confidence label. */
export function buildSqlConfidenceCase(): string {
  const whens = CANONICAL_MAPPING_RULES
    .map(r => `WHEN (${r.sql}) THEN '${r.confidence}'`)
    .join('\n      ')
  return `CASE\n      ${whens}\n      ELSE NULL\n    END`
}

/** Stable list of (subcategory, group) pairs for clients that want to
 *  enumerate the mapping's coverage without re-running it. */
export function listCanonicalSubcategories(): Array<{ canonicalGroup: string; canonicalSubcategory: string; ruleIds: string[] }> {
  const map = new Map<string, { canonicalGroup: string; canonicalSubcategory: string; ruleIds: string[] }>()
  for (const r of CANONICAL_MAPPING_RULES) {
    const existing = map.get(r.canonicalSubcategory)
    if (existing) {
      existing.ruleIds.push(r.ruleId)
    } else {
      map.set(r.canonicalSubcategory, {
        canonicalGroup: r.canonicalGroup,
        canonicalSubcategory: r.canonicalSubcategory,
        ruleIds: [r.ruleId],
      })
    }
  }
  return Array.from(map.values())
}

// ── Phase 24C.1 — per-subcategory SQL predicates for resumable rebuild ─────
// The Phase 24C one-shot rebuild evaluated the entire mapping CASE
// expression (~30 rules) against every one of 72k OPNs inside a single
// nested-subquery + GROUP BY + json_group_object pipeline. D1 hit its
// per-statement CPU limit and aborted with no rows written. The fix is
// to scope every SQL pass to ONE canonical subcategory at a time:
//
//   matchClause   — the OR of just this subcategory's rule SQL fragments.
//                   Filters the OPN table down to (typically) ≤ a few
//                   thousand rows in one pass.
//   excludeClause — the OR of every earlier rule that maps to a DIFFERENT
//                   subcategory. Mirrors "first match wins" so a row that
//                   would fall to a more-specific earlier rule is removed
//                   from this subcategory's bucket. Without this, e.g.
//                   `dc_tps536xx_ai_power` rows would also be counted in
//                   `power_dcdc_switching`.
//
// The combined `WHERE (matchClause) AND NOT (excludeClause)` exactly
// reproduces the JS first-match-wins semantics. Each emitted predicate
// is small (≤ ~30 OR'd LIKEs in the worst case) and safely sits inside
// D1's per-statement budget.

export type SubcategoryPredicate = {
  canonicalGroup: string
  canonicalSubcategory: string
  ruleIds: string[]
  /** SQL WHERE clause body (no leading 'WHERE') — combines the own-rules
   *  match with NOT-earlier-rules exclusion so first-match-wins holds. */
  whereClause: string
  /** ORDER-preserved per-rule SQL fragments for this subcategory. Used
   *  by the rebuilder to compute mapping_confidence_summary inside the
   *  same single-subcategory aggregation, with ROW_NUMBER()-style "first
   *  rule wins" logic via nested CASE. */
  ownRules: Array<{ ruleId: string; sql: string; confidence: MappingConfidence }>
}

export function buildSubcategoryPredicates(): SubcategoryPredicate[] {
  // Group rules by subcategory while keeping global rule order (for
  // first-match precedence). Walk the rule list once.
  type SubcatBucket = {
    canonicalGroup: string
    canonicalSubcategory: string
    ruleIds: string[]
    ownRuleSqls: string[]
    ownRuleConfidences: MappingConfidence[]
    excludingRuleSqls: string[]
  }
  const map = new Map<string, SubcatBucket>()
  // Maintain "rules seen so far per subcategory" so we can compute
  // excludingRuleSqls (rules with a DIFFERENT subcategory that appear
  // earlier in the global list) in a single pass.
  const earlierRulesGlobal: MappingRule[] = []
  for (const r of CANONICAL_MAPPING_RULES) {
    let bucket = map.get(r.canonicalSubcategory)
    if (!bucket) {
      // First time we've seen this subcategory — its `excludingRuleSqls`
      // are exactly the rules currently in earlierRulesGlobal that map
      // to a DIFFERENT subcategory. We freeze that list now; later own-
      // rules don't add to the exclusion set (they're own).
      bucket = {
        canonicalGroup: r.canonicalGroup,
        canonicalSubcategory: r.canonicalSubcategory,
        ruleIds: [],
        ownRuleSqls: [],
        ownRuleConfidences: [],
        excludingRuleSqls: earlierRulesGlobal
          .filter(er => er.canonicalSubcategory !== r.canonicalSubcategory)
          .map(er => er.sql),
      }
      map.set(r.canonicalSubcategory, bucket)
    }
    bucket.ruleIds.push(r.ruleId)
    bucket.ownRuleSqls.push(r.sql)
    bucket.ownRuleConfidences.push(r.confidence)
    earlierRulesGlobal.push(r)
  }
  // Render per-subcategory predicates.
  return Array.from(map.values()).map(b => {
    const matchClause = b.ownRuleSqls.map(s => `(${s})`).join(' OR ')
    const excludeClause = b.excludingRuleSqls.map(s => `(${s})`).join(' OR ')
    const whereClause = excludeClause
      ? `(${matchClause}) AND NOT (${excludeClause})`
      : `(${matchClause})`
    const ownRules = b.ruleIds.map((id, i) => ({
      ruleId: id,
      sql: b.ownRuleSqls[i],
      confidence: b.ownRuleConfidences[i],
    }))
    return {
      canonicalGroup: b.canonicalGroup,
      canonicalSubcategory: b.canonicalSubcategory,
      ruleIds: b.ruleIds,
      whereClause,
      ownRules,
    }
  })
}
