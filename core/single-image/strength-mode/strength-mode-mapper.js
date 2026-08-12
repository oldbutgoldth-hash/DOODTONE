/**
 * core/single-image/strength-mode/strength-mode-mapper.js
 *
 * EPIC 2E-P1M — Strength-mode UI (Natural/Balanced/Dramatic).
 *
 * Pure translation layer: takes the ONE canonical UI-facing strength
 * choice (strength-mode-schema.js's NATURAL/BALANCED/DRAMATIC) and
 * returns the string each target module's OWN STRENGTH_MODE enum
 * expects. No module's existing schema is renamed or altered -- this
 * is the additive adapter P1M_STRENGTH_MODE_AUDIT.md concluded was
 * required once it confirmed the six modules do not share one
 * vocabulary (see strength-mode-schema.js's header comment for the
 * full per-module enum listing).
 *
 * Every downstream plan-builder already does
 * `STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS[DEFAULT_STRENGTH_MODE]`
 * (or the equivalent `STRENGTH_MULTIPLIER[...] ?? 1.0` in
 * wb-guardrails.js) -- so even in the hypothetical case of an unknown
 * moduleKey being passed here, mapUiStrengthModeToModule() itself
 * fails closed to BALANCED (never throws, never returns undefined),
 * and each module's own already-existing fallback provides a second,
 * independent safety net.
 */

import { UI_STRENGTH_MODE, DEFAULT_UI_STRENGTH_MODE, isValidUiStrengthMode } from './strength-mode-schema.js';

/** One key per Intelligence layer that owns its own STRENGTH_MODE enum. */
export const MODULE_KEY = Object.freeze({
  BASIC_TONE: 'BASIC_TONE',
  TONE_CURVE: 'TONE_CURVE',
  PARAMETRIC_TONE: 'PARAMETRIC_TONE',
  DETAIL: 'DETAIL',
  COLOR: 'COLOR',
  WHITE_BALANCE: 'WHITE_BALANCE',
});

// moduleKey -> { NATURAL: <module string>, BALANCED: <module string>, DRAMATIC: <module string> }
const _MAP = Object.freeze({
  // basic-tone-schema.js / tone-curve-schema.js / parametric-tone-schema.js
  // already use the exact NATURAL/BALANCED/DRAMATIC vocabulary -- passthrough.
  [MODULE_KEY.BASIC_TONE]: Object.freeze({ NATURAL: 'NATURAL', BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' }),
  [MODULE_KEY.TONE_CURVE]: Object.freeze({ NATURAL: 'NATURAL', BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' }),
  [MODULE_KEY.PARAMETRIC_TONE]: Object.freeze({ NATURAL: 'NATURAL', BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' }),
  // detail-schema.js's strongest tier is named CRISP (not DRAMATIC) --
  // chosen deliberately in P1G because it stays skin-safe/halo-safe
  // (see detail-schema.js's own header comment); DRAMATIC maps to it.
  [MODULE_KEY.DETAIL]: Object.freeze({ NATURAL: 'NATURAL', BALANCED: 'BALANCED', DRAMATIC: 'CRISP' }),
  // color-intelligence-schema.js has FOUR tiers (NATURAL/BALANCED/
  // CINEMATIC/STRONG); its own header comment names STRONG as exactly
  // the tier a "future user-facing intensity control" should reach --
  // DRAMATIC maps to STRONG. CINEMATIC remains reachable only via a
  // direct API call (unchanged from before P1M), never from this UI.
  [MODULE_KEY.COLOR]: Object.freeze({ NATURAL: 'NATURAL', BALANCED: 'BALANCED', DRAMATIC: 'STRONG' }),
  // white-balance-schema.js uses an entirely different vocabulary
  // (CONSERVATIVE/BALANCED/CORRECTIVE, no NATURAL/DRAMATIC at all).
  [MODULE_KEY.WHITE_BALANCE]: Object.freeze({ NATURAL: 'CONSERVATIVE', BALANCED: 'BALANCED', DRAMATIC: 'CORRECTIVE' }),
});

/**
 * @param {string} uiStrengthMode  One of UI_STRENGTH_MODE (NATURAL/BALANCED/DRAMATIC).
 * @param {string} moduleKey       One of MODULE_KEY.
 * @returns {string} The strength-mode string the target module's own schema expects.
 *   Fails closed to that module's BALANCED-equivalent string for any
 *   unrecognized uiStrengthMode or moduleKey -- never throws, never
 *   returns undefined/null.
 */
export function mapUiStrengthModeToModule(uiStrengthMode, moduleKey) {
  const table = _MAP[moduleKey];
  if (!table) return _MAP[MODULE_KEY.BASIC_TONE].BALANCED; // unknown moduleKey -- safe generic fallback
  const key = isValidUiStrengthMode(uiStrengthMode) ? uiStrengthMode : DEFAULT_UI_STRENGTH_MODE;
  return table[key] ?? table[UI_STRENGTH_MODE.BALANCED];
}
