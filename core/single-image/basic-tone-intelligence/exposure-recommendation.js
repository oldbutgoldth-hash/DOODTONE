/**
 * core/single-image/basic-tone-intelligence/exposure-recommendation.js
 *
 * EPIC 2E-P1F — conservative, evidence-driven Exposure recommendation.
 * Candidate unit note: `basic.exposure` is stored in the same
 * hundredths-of-an-EV integer scale the rest of this app already uses
 * (core/preset-engine/index.js::serializeXMP emits
 * `crs:Exposure2012="${(p.exp/100).toFixed(2)}"`) -- a value of 25
 * here becomes +0.25 EV in the exported XMP. This module never touches
 * that transform; it only ever produces an integer in that same scale.
 */

import { clamp } from '../../color-engine/index.js';
import { SCENE_CLASS, BOUNDS } from './basic-tone-schema.js';

/**
 * @param {object} params
 * @param {object} params.stats  histogram-engine result
 * @param {string} params.sceneClass  one of SCENE_CLASS
 * @param {number} [params.strengthScalar]
 * @param {number} [params.plannedShadowRecoveryValue]  the Shadows recommendation
 *   already computed for this same image -- used to avoid double-correcting
 *   the same dark-midtone problem with both Exposure and Shadows at full strength.
 * @returns {{value:number, confidence:number, reason:string}}
 */
export function computeExposureRecommendation({ stats, sceneClass, strengthScalar = 1, plannedShadowRecoveryValue = 0 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient/low-confidence evidence -- Exposure kept at 0 (conservative default).' };
  }

  const { avgLum, clipHiPct = 0, clipLoPct = 0, drStops = 5, confidence = 0.5 } = stats;
  let value = 0;
  let reason = 'No genuine exposure problem detected -- kept at 0.';

  if (sceneClass === SCENE_CLASS.UNDEREXPOSED) {
    value = clamp(Math.round((90 - avgLum) * 0.35), 8, 22);
    reason = `Genuinely dark midtones (avgLum=${Math.round(avgLum)}) with real shadow clipping -- bounded +${value} recovery lift.`;
  } else if (sceneClass === SCENE_CLASS.OVEREXPOSED) {
    value = -clamp(Math.round((avgLum - 165) * 0.3), 8, 20);
    reason = `Genuinely bright, clipped highlights (avgLum=${Math.round(avgLum)}) -- bounded ${value} recovery pullback.`;
  } else if (sceneClass === SCENE_CLASS.HIGH_KEY) {
    value = 0;
    reason = 'HIGH_KEY scene (bright but not clipped) -- softness preserved, not darkened.';
  } else if (sceneClass === SCENE_CLASS.LOW_KEY) {
    // Only the genuinely-broken-frame safety net applies here -- an
    // intentional dark/moody scene is preserved otherwise (matches
    // core/basic-panel-engine's own style-preservation convention).
    if (drStops < 1.2 && avgLum < 15) { value = 12; reason = 'Near-blank dark frame (capture defect, not moody intent) -- small +12 safety lift.'; }
    else reason = 'LOW_KEY scene -- intended darkness preserved, not lifted.';
  } else if (sceneClass === SCENE_CLASS.HIGH_DYNAMIC_RANGE) {
    reason = 'HIGH_DYNAMIC_RANGE scene -- handled by Highlight/Shadow recovery, global Exposure left at 0.';
  } else if (sceneClass === SCENE_CLASS.HAZY) {
    reason = 'HAZY scene -- Exposure left at 0, Dehaze/Contrast handle this scene class.';
  } else {
    // BALANCED / LOW_CONTRAST / HIGH_CONTRAST: only a small, conservative
    // move for genuinely dim/bright but UNCLIPPED midtones -- distinct
    // from the (already-handled) UNDEREXPOSED/OVEREXPOSED clipping cases.
    if (avgLum < 100 && clipLoPct <= 1) {
      value = clamp(Math.round((100 - avgLum) * 0.15), 0, 10);
      if (value > 0) reason = `Dim, unclipped midtones (avgLum=${Math.round(avgLum)}) -- small +${value} conservative lift.`;
    } else if (avgLum > 165 && clipHiPct <= 1) {
      value = -clamp(Math.round((avgLum - 165) * 0.12), 0, 10);
      if (value < 0) reason = `Bright, unclipped midtones (avgLum=${Math.round(avgLum)}) -- small ${value} conservative pullback.`;
    }
  }

  // Highlight protection: never let Exposure brighten further into real clipping.
  if (clipHiPct > 3 && value > 0) { value = 0; reason += ' Highlight clipping present -- brightening suppressed.'; }

  // Coordinate with Shadows: if Shadow recovery is already doing meaningful
  // work, halve Exposure's own contribution to avoid double-correcting.
  if (value > 0 && plannedShadowRecoveryValue >= 10) {
    value = Math.round(value * 0.5);
    reason += ` Shadow recovery (+${plannedShadowRecoveryValue}) already sufficient -- Exposure lift halved.`;
  }

  // Low-confidence evidence keeps Exposure conservative.
  if (confidence < 0.6) { value = Math.round(value * 0.5); reason += ` Evidence confidence ${confidence} < 0.6 -- move halved.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.exposure.lo, BOUNDS.exposure.hi);
  return { value, confidence, reason };
}
