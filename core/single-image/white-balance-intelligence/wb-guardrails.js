/**
 * core/single-image/white-balance-intelligence/wb-guardrails.js
 *
 * EPIC 2E-P1H — P1H's own planning ranges (guardrails, NOT the fixed
 * export ceiling). These are deliberately kept comfortably inside the
 * existing, independent core/xmp-validator HARD_LIMITS.wb safety net
 * (tempCap=40, tint in [-12,30] normally / [-25,30] when fingerprint
 * confirms intentional green) -- the SAME "planner stays well inside
 * the validator's ceiling" pattern EPIC 2E-P1G R2 established for
 * Sharpening/Noise Reduction (planner max 35 vs validator ceiling 40).
 * quickSafetyClamp() remains the final, authoritative safety net and
 * is never bypassed or duplicated here.
 */

import { STRENGTH_MODE, CONFIDENCE_TIER } from './white-balance-schema.js';

// P1H planning ranges at BALANCED strength, per confidence tier (spec
// §"Temperature model"/"Tint model"): high ±35/±18, moderate ±20/±10,
// low ±8/±4.
const BASE_RANGE = Object.freeze({
  [CONFIDENCE_TIER.HIGH]:     { temp: 35, tint: 18 },
  [CONFIDENCE_TIER.MODERATE]: { temp: 20, tint: 10 },
  [CONFIDENCE_TIER.LOW]:      { temp: 8,  tint: 4  },
});

const STRENGTH_MULTIPLIER = Object.freeze({
  [STRENGTH_MODE.CONSERVATIVE]: 0.6,
  [STRENGTH_MODE.BALANCED]: 1.0,
  [STRENGTH_MODE.CORRECTIVE]: 1.3,
});

// Comfortably inside core/xmp-validator HARD_LIMITS.wb (tempCap=40,
// tintGreenFloor=-12, tintMagentaCeil=30) -- never emit at or above
// these regardless of strength mode, exactly mirroring P1G R2's
// "planner ceiling < validator ceiling" convention.
const SAFETY_TEMP_CEILING = 38;
const SAFETY_TINT_FLOOR = -11;
const SAFETY_TINT_CEILING = 29;

/**
 * @param {string} confidenceTier  one of CONFIDENCE_TIER
 * @param {string} strengthMode    one of STRENGTH_MODE
 * @returns {{tempCap:number, tintCap:number}}
 */
export function getGuardrailCaps(confidenceTier, strengthMode = STRENGTH_MODE.BALANCED) {
  const base = BASE_RANGE[confidenceTier] ?? BASE_RANGE[CONFIDENCE_TIER.LOW];
  const mult = STRENGTH_MULTIPLIER[strengthMode] ?? 1.0;
  const tempCap = Math.min(SAFETY_TEMP_CEILING, Math.round(base.temp * mult));
  const tintCap = Math.min(SAFETY_TINT_CEILING, Math.round(base.tint * mult));
  return { tempCap, tintCap };
}

export function clampTemp(v) { return Math.max(-SAFETY_TEMP_CEILING, Math.min(SAFETY_TEMP_CEILING, v)); }
export function clampTint(v) { return Math.max(SAFETY_TINT_FLOOR, Math.min(SAFETY_TINT_CEILING, v)); }

export { SAFETY_TEMP_CEILING, SAFETY_TINT_FLOOR, SAFETY_TINT_CEILING };
