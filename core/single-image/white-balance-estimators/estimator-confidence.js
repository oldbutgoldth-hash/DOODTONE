/**
 * core/single-image/white-balance-estimators/estimator-confidence.js
 *
 * EPIC 2E-P1I — shared confidence-term building blocks used by every
 * estimator. Each estimator still composes its OWN weighted blend
 * (documented in its own model doc) — some inputs matter more for
 * Gray World than for White Patch — but the individual TERMS (sample
 * count, spatial coverage, hue-dominance penalty, cross-estimator
 * agreement) are computed identically everywhere they're used, closing
 * the "duplicated formulas across modules" risk the spec calls out.
 *
 * Confidence is NEVER a fixed number anywhere in this file or its
 * callers — every exported function is a real function of the
 * estimator's actual sample.
 */

import { safeClamp } from './wb-color-math.js';

/** How much accepted-sample count alone supports confidence. Saturates at `sufficientAt`. */
export function sampleCountFactor(acceptedCount, sufficientAt) {
  return safeClamp((acceptedCount ?? 0) / Math.max(1, sufficientAt), 0, 1);
}

/**
 * Multiplicative confidence penalty from hue-bucket dominance
 * (`hueDominance()` in wb-color-math.js). Same two-tier severity curve
 * shared by every mean-based estimator — this IS the mechanism behind
 * "dominant green/pink objects reduce Gray World[/SOG] confidence."
 *
 * @param {number} dominanceRatio  0-1
 * @param {{warnRatio?:number, severeRatio?:number, warnMultiplier?:number, severeMultiplier?:number}} [opts]
 */
export function dominancePenaltyMultiplier(dominanceRatio, opts = {}) {
  const warnRatio = opts.warnRatio ?? 0.45;
  const severeRatio = opts.severeRatio ?? 0.65;
  const warnMultiplier = opts.warnMultiplier ?? 0.7;
  const severeMultiplier = opts.severeMultiplier ?? 0.4;
  if (dominanceRatio >= severeRatio) return severeMultiplier;
  if (dominanceRatio >= warnRatio) return warnMultiplier;
  return 1;
}

/** Weighted blend of {value, weight} terms, each value pre-clamped 0-1, result clamped 0-1. */
export function combineWeighted(terms) {
  let sum = 0, totalWeight = 0;
  for (const { value, weight } of terms) {
    sum += safeClamp(value, 0, 1) * weight;
    totalWeight += weight;
  }
  return safeClamp(totalWeight > 0 ? sum / totalWeight : 0, 0, 1);
}

/**
 * Cross-estimator agreement score — how tightly a set of {temperature,
 * tint} estimates cluster. Used by the ensemble (estimator-ensemble.js)
 * to compute consensus confidence, and exposed here so it is the SAME
 * spread computation everywhere it's needed rather than re-derived.
 *
 * @param {{temperature:number, tint:number, weight?:number}[]} points
 * @returns {{agreement:number, tempSpread:number, tintSpread:number}}
 */
export function agreementScore(points) {
  const valid = (points ?? []).filter(p => Number.isFinite(p?.temperature) && Number.isFinite(p?.tint));
  if (valid.length < 2) return { agreement: valid.length ? 1 : 0, tempSpread: 0, tintSpread: 0 };
  const meanT = valid.reduce((s, p) => s + p.temperature, 0) / valid.length;
  const meanN = valid.reduce((s, p) => s + p.tint, 0) / valid.length;
  const tempSpread = Math.sqrt(valid.reduce((s, p) => s + (p.temperature - meanT) ** 2, 0) / valid.length);
  const tintSpread = Math.sqrt(valid.reduce((s, p) => s + (p.tint - meanN) ** 2, 0) / valid.length);
  const agreement = safeClamp(1 - (0.5 * Math.min(1, tempSpread / 25) + 0.5 * Math.min(1, tintSpread / 15)), 0, 1);
  return { agreement: +agreement.toFixed(3), tempSpread: +tempSpread.toFixed(2), tintSpread: +tintSpread.toFixed(2) };
}
