/**
 * core/single-image/basic-tone-intelligence/black-white-point-planner.js
 *
 * EPIC 2E-P1F — Whites/Blacks endpoint planning. Establishes tonal
 * endpoints without crushing or washing out the image; coordinates
 * with highlight/skin protection (whiteClothingProtection flag) and
 * with scene class (never deepens an already-intentional matte/faded
 * black point, never lifts an intentional moody-dark black point
 * unless real crushing is present).
 */

import { clamp } from '../../color-engine/index.js';
import { SCENE_CLASS, BOUNDS } from './basic-tone-schema.js';

/**
 * @param {object} params
 * @param {boolean} [params.whiteClothingProtection]  true when skin-heavy AND
 *   bright evidence suggests real risk of blowing out white clothing/dress detail.
 */
export function computeWhitesRecommendation({ stats, sceneClass, strengthScalar = 1, whiteClothingProtection = false } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient evidence -- Whites kept at 0.' };
  }
  const { whitePoint = 255, clipHiPct = 0, confidence = 0.5 } = stats;
  let value = 0;
  let reason = 'White point already well-placed -- kept at 0.';

  if (clipHiPct > 3) {
    value = -clamp(Math.round(8 + clipHiPct * 4), 8, -BOUNDS.whites.lo);
    reason = `${clipHiPct}% highlight clipping -- Whites pulled back ${value} to reduce data loss.`;
  } else if (clipHiPct > 1) {
    value = -clamp(Math.round(clipHiPct * 6), 5, 14);
    reason = `Minor clipping (${clipHiPct}%) -- small ${value} Whites pullback for headroom.`;
  } else if (whitePoint < 240) {
    value = clamp(Math.round((240 - whitePoint) * 0.15), 4, BOUNDS.whites.hi);
    reason = `Highlight headroom available (whitePoint=${whitePoint}) -- +${value} brilliance.`;
  }

  if (whiteClothingProtection && value > 0) {
    value = Math.round(value * 0.4);
    reason += ' White-clothing/skin-highlight protection engaged -- brilliance boost reduced.';
  }
  if (confidence < 0.6) { value = Math.round(value * 0.6); reason += ` Low confidence (${confidence}) -- move reduced.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.whites.lo, BOUNDS.whites.hi);
  return { value, confidence, reason };
}

export function computeBlacksRecommendation({ stats, sceneClass, strengthScalar = 1 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient evidence -- Blacks kept at 0.' };
  }
  const { blackPoint = 0, clipLoPct = 0, confidence = 0.5 } = stats;
  let value = 0;
  let reason = 'Black point already well-anchored -- kept at 0.';

  if (clipLoPct > 4) {
    value = clamp(Math.round(10 + clipLoPct * 3), 10, BOUNDS.blacks.hi);
    reason = `${clipLoPct}% crushed shadows -- Blacks lifted +${value} to recover texture.`;
  } else if (sceneClass === SCENE_CLASS.LOW_KEY || sceneClass === SCENE_CLASS.HIGH_KEY) {
    // Matte/faded (elevated bp) and intentional moody (low bp) looks
    // are both preserved -- coordinating with Contrast/Shadows instead
    // of deepening/lifting the black point itself.
    reason = `${sceneClass} scene -- black point treated as intentional, not adjusted.`;
  } else if (blackPoint > 15) {
    value = -clamp(Math.round((blackPoint - 15) * 0.4), 4, -BOUNDS.blacks.lo);
    reason = `Black point lacks a real anchor (blackPoint=${blackPoint}) -- ${value} deepen for definition.`;
  }

  if (confidence < 0.6) { value = Math.round(value * 0.6); reason += ` Low confidence (${confidence}) -- move reduced.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.blacks.lo, BOUNDS.blacks.hi);
  return { value, confidence, reason };
}
