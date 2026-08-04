/**
 * core/single-image/detail-intelligence/detail-guardrails.js
 *
 * EPIC 2E-P1G — Layer A safety net for the Detail Plan. This is the
 * SOLE safety net for detail.sharpening and detail.noiseReduction --
 * core/xmp-validator's quickSafetyClamp() (Layer B) has ZERO entries
 * for either field (see P1G_DETAIL_VALUE_LINEAGE_AUDIT.md §5). Every
 * value this module does not catch reaches the XMP export unchecked.
 *
 * Mirrors core/single-image/basic-tone-intelligence/
 * basic-tone-guardrails.js in structure and in its "always enforced,
 * even though it shouldn't ever fire" convention.
 */

import { clamp } from '../../color-engine/index.js';
import { BOUNDS, SKIN_HEAVY_COVERAGE_FRACTION } from './detail-schema.js';

/**
 * @param {{sharpening:number, noiseReductionLuminance:number}} fields
 * @param {{skinCoverage?:number|null, motionBlurRisk?:number, lowDetail?:boolean}} [opts]
 * @returns {{values:object, adjustments:string[], protections:object}}
 */
export function applyDetailGuardrails(fields, { skinCoverage = null, motionBlurRisk = 0, lowDetail = false } = {}) {
  const adjustments = [];
  const values = {};

  for (const [key, bound] of Object.entries(BOUNDS)) {
    const srcKey = key === 'noiseReduction' ? 'noiseReductionLuminance' : key;
    const rawInput = fields[srcKey];
    const wasNonFinite = !Number.isFinite(rawInput);
    const raw = wasNonFinite ? 0 : Math.round(rawInput);
    const clamped = clamp(raw, bound.lo, bound.hi);
    if (wasNonFinite) {
      adjustments.push(`${key} (${String(rawInput)}) was not a finite number -- fail-closed to 0 (never propagated as NaN/Infinity into the Candidate or export).`);
    } else if (clamped !== raw) {
      adjustments.push(`${key} (${raw}) outside Detail bound [${bound.lo},${bound.hi}] -- clamped to ${clamped}.`);
    }
    values[key] = clamped;
  }

  // Final defensive skin cap -- independent of whatever the planners
  // already did, this is the last check before the value becomes the
  // Candidate's detail.sharpening/.noiseReduction.
  const isSkinHeavy = typeof skinCoverage === 'number' && skinCoverage >= SKIN_HEAVY_COVERAGE_FRACTION;
  let skinProtectionApplied = false;
  if (isSkinHeavy) {
    const sharpCap = Math.round(BOUNDS.sharpening.hi * 0.65);
    if (values.sharpening > sharpCap) {
      adjustments.push(`Sharpening (${values.sharpening}) reduced to ${sharpCap} -- final skin-protection cap (high skin coverage).`);
      values.sharpening = sharpCap;
      skinProtectionApplied = true;
    }
  }

  // Motion-blur / soft-focus final cap -- never let sharpening exceed
  // the restrained bucket ceiling regardless of upstream arithmetic.
  let motionBlurProtection = false;
  if (motionBlurRisk >= 0.5) {
    const blurCap = 18;
    if (values.sharpening > blurCap) {
      adjustments.push(`Sharpening (${values.sharpening}) reduced to ${blurCap} -- final motion-blur/soft-focus protection.`);
      values.sharpening = blurCap;
      motionBlurProtection = true;
    }
  }

  let lowDetailProtection = false;
  if (lowDetail && values.sharpening > 12) {
    adjustments.push(`Sharpening (${values.sharpening}) reduced to 12 -- low-detail protection (no real detail to sharpen).`);
    values.sharpening = 12;
    lowDetailProtection = true;
  }

  const haloProtection = motionBlurProtection || (values.sharpening <= 18 && (motionBlurRisk >= 0.5 || lowDetail));

  return {
    values,
    adjustments,
    protections: {
      skinProtection: { applied: skinProtectionApplied, coveragePct: skinCoverage, scale: skinProtectionApplied ? 0.65 : 1.0 },
      haloProtection,
      lowDetailProtection,
      motionBlurProtection,
    },
  };
}
