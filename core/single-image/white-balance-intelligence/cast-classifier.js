/**
 * core/single-image/white-balance-intelligence/cast-classifier.js
 *
 * EPIC 2E-P1H — evidence-driven classification into the 10 required
 * cast classes. Multiple flags may be set simultaneously; exactly one
 * is chosen as `primaryCast` by a fixed priority order. Never reads a
 * filename or any user-supplied label -- every flag traces back to a
 * real evidence field (see cast-classifier-test cases in the P1H test
 * suite for the evidence->class mapping this file implements).
 */

import { CAST_CLASS } from './white-balance-schema.js';

const PRIORITY = [
  CAST_CLASS.OBJECT_COLOR_BIAS,
  CAST_CLASS.MIXED_LIGHT,
  CAST_CLASS.INTENTIONAL_WARM_LIGHT,
  CAST_CLASS.INTENTIONAL_COLORED_LIGHT,
  CAST_CLASS.GREEN_CAST,
  CAST_CLASS.MAGENTA_CAST,
  CAST_CLASS.WARM_CAST,
  CAST_CLASS.COOL_CAST,
  CAST_CLASS.NEUTRAL,
  CAST_CLASS.LOW_CONFIDENCE,
];

const BASE_CAST_TO_CLASS = {
  green: CAST_CLASS.GREEN_CAST,
  magenta: CAST_CLASS.MAGENTA_CAST,
  warm: CAST_CLASS.WARM_CAST,
  cool: CAST_CLASS.COOL_CAST,
  neutral: CAST_CLASS.NEUTRAL,
};

/**
 * @param {object} wbEvidence           output of extractWBEvidence().evidence
 * @param {{score:number,isObjectColorBias:boolean}} objectBias
 * @param {{isMixedLight:boolean}} mixedLight
 * @param {number} planConfidence        0-1, this plan's own overall confidence (not the raw engine confidence)
 * @returns {{primaryCast:string, flags:string[], isIntentional:boolean}}
 */
export function classifyCast(wbEvidence, objectBias, mixedLight, planConfidence) {
  const flags = new Set();
  const raw = wbEvidence?._raw ?? {};
  const baseCastLabel = raw.castLabel ?? 'neutral';
  const isLikelyDefect = raw.moodPreservation?.isLikelyDefect;
  const isIntentional = isLikelyDefect === false; // explicit false, not just falsy/unknown

  if (objectBias?.isObjectColorBias) flags.add(CAST_CLASS.OBJECT_COLOR_BIAS);
  if (mixedLight?.isMixedLight) flags.add(CAST_CLASS.MIXED_LIGHT);

  if (isIntentional && baseCastLabel === 'warm') flags.add(CAST_CLASS.INTENTIONAL_WARM_LIGHT);
  if (isIntentional && (baseCastLabel === 'magenta' || baseCastLabel === 'cool')) flags.add(CAST_CLASS.INTENTIONAL_COLORED_LIGHT);

  const baseClass = BASE_CAST_TO_CLASS[baseCastLabel] ?? CAST_CLASS.NEUTRAL;
  flags.add(baseClass);

  if (planConfidence < 0.3) flags.add(CAST_CLASS.LOW_CONFIDENCE);

  let primaryCast = CAST_CLASS.NEUTRAL;
  for (const c of PRIORITY) { if (flags.has(c)) { primaryCast = c; break; } }

  return { primaryCast, flags: [...flags], isIntentional };
}
