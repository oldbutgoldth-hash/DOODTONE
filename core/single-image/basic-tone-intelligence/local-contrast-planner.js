/**
 * core/single-image/basic-tone-intelligence/local-contrast-planner.js
 *
 * EPIC 2E-P1F — Contrast (endpoint-coordinated tonal separation) and
 * Texture/Clarity/Dehaze (highly conservative "local contrast" trio).
 * Texture/Clarity are always scaled by `skinScale` (from
 * basic-tone-schema.skinCautionScale) so skin-heavy portraits never
 * get meaningful skin-texture sharpening. Dehaze is gated STRICTLY on
 * SCENE_CLASS.HAZY + a minimum haze confidence -- it must never act as
 * a generic contrast substitute for LOW_CONTRAST/HIGH_CONTRAST scenes.
 */

import { clamp } from '../../color-engine/index.js';
import { SCENE_CLASS, BOUNDS, HAZE_MIN_CONFIDENCE } from './basic-tone-schema.js';

export function computeContrastRecommendation({ stats, sceneClass, skinScale = 1, strengthScalar = 1 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient evidence -- Contrast kept at 0.' };
  }
  const { contrast: sigma = 50, confidence = 0.5 } = stats;
  let value = 0;
  let reason = `Contrast (sigma=${sigma}) already well-balanced -- kept at 0.`;

  if (sceneClass === SCENE_CLASS.LOW_CONTRAST || sigma < 38) {
    value = clamp(Math.round((38 - sigma) * 0.4), 0, BOUNDS.contrast.hi);
    if (value > 0) reason = `Low contrast (sigma=${sigma}) -- bounded +${value} lift.`;
  } else if (sceneClass === SCENE_CLASS.HIGH_CONTRAST || sigma > 68) {
    value = -clamp(Math.round((sigma - 68) * 0.25), 0, -BOUNDS.contrast.lo);
    if (value < 0) reason = `Already high-contrast (sigma=${sigma}) -- bounded ${value} ease, relying on Highlight/Shadow recovery instead.`;
  }

  // High-key stays soft; low-key retains its own tonal intent -- both
  // dampen (never null out) an otherwise-computed contrast move.
  if (sceneClass === SCENE_CLASS.HIGH_KEY && value > 0) { value = Math.round(value * 0.4); reason += ' HIGH_KEY -- softness preserved, contrast lift dampened.'; }
  if (sceneClass === SCENE_CLASS.LOW_KEY && value !== 0) { value = Math.round(value * 0.4); reason += ' LOW_KEY -- tonal intent preserved, contrast move dampened.'; }

  // Portraits: harsh global contrast harms skin transitions.
  value = Math.round(value * skinScale);
  if (skinScale < 1) reason += ` Skin-safe scaling (x${skinScale.toFixed(2)}) applied.`;

  if (confidence < 0.6) { value = Math.round(value * 0.6); reason += ` Low confidence (${confidence}) -- move reduced.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.contrast.lo, BOUNDS.contrast.hi);
  return { value, confidence, reason };
}

/**
 * @returns {{texture:{value,reason}, clarity:{value,reason}, dehaze:{value,reason,hazeConfidence}}}
 */
export function computeLocalContrastDetail({ stats, sceneClass, skinScale = 1, strengthScalar = 1 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return {
      texture: { value: 0, reason: 'Insufficient evidence -- Texture kept at 0.' },
      clarity: { value: 0, reason: 'Insufficient evidence -- Clarity kept at 0.' },
      dehaze: { value: 0, reason: 'Insufficient evidence -- Dehaze kept at 0.', hazeConfidence: 0 },
    };
  }
  const { contrastRatio = 4, avgSatPct = 30, confidence = 0.5 } = stats;

  // ── Texture -- useful for clothing/decoration/environment detail;
  //    lower strength for skin-heavy portraits (never sharpens skin). ──
  let textureVal = 0;
  let textureReason = 'No meaningful detail deficiency -- Texture kept at 0.';
  if (sceneClass === SCENE_CLASS.HIGH_CONTRAST || sceneClass === SCENE_CLASS.BALANCED) {
    textureVal = clamp(Math.round(8 * skinScale), 0, BOUNDS.texture.hi);
    if (textureVal > 0) textureReason = `Detailed scene (${sceneClass}) -- +${textureVal} Texture${skinScale < 1 ? ' (skin-scaled)' : ''}.`;
  }

  // ── Clarity -- local contrast deficiency only; kept subtle for
  //    portraits to avoid haloing around skin. ──
  let clarityVal = 0;
  let clarityReason = 'No local-contrast deficiency detected -- Clarity kept at 0.';
  if (sceneClass === SCENE_CLASS.LOW_CONTRAST || sceneClass === SCENE_CLASS.HAZY) {
    clarityVal = clamp(Math.round(7 * skinScale), 0, BOUNDS.clarity.hi);
    if (clarityVal > 0) clarityReason = `Local-contrast deficiency (${sceneClass}) -- +${clarityVal} Clarity${skinScale < 1 ? ' (skin-scaled, halo-safe)' : ''}.`;
  }

  // ── Dehaze -- STRICTLY gated on HAZY scene class + confidence;
  //    never a generic contrast substitute. ──
  let dehazeVal = 0;
  let hazeConfidence = 0;
  let dehazeReason = 'No haze evidence -- Dehaze kept at 0 (zero is the correct, honest default).';
  if (sceneClass === SCENE_CLASS.HAZY) {
    // contrastRatio/avgSatPct already gated this classification; derive
    // a haze confidence proxy from how far below threshold they sit.
    hazeConfidence = clamp(+((3.2 - contrastRatio) / 3.2 + (22 - avgSatPct) / 22).toFixed(2) / 2 + 0.5, 0, 1);
    if (hazeConfidence >= HAZE_MIN_CONFIDENCE) {
      dehazeVal = clamp(Math.round(hazeConfidence * 30), 8, BOUNDS.dehaze.hi);
      dehazeReason = `HAZY scene with haze confidence ${hazeConfidence} -- bounded +${dehazeVal} Dehaze.`;
    } else {
      dehazeReason = `HAZY classification but haze confidence ${hazeConfidence} below minimum ${HAZE_MIN_CONFIDENCE} -- Dehaze kept at 0.`;
    }
  }

  if (confidence < 0.6) {
    textureVal = Math.round(textureVal * 0.5);
    clarityVal = Math.round(clarityVal * 0.5);
    dehazeVal = Math.round(dehazeVal * 0.5);
  }

  return {
    texture: { value: clamp(Math.round(textureVal * strengthScalar), BOUNDS.texture.lo, BOUNDS.texture.hi), reason: textureReason },
    clarity: { value: clamp(Math.round(clarityVal * strengthScalar), BOUNDS.clarity.lo, BOUNDS.clarity.hi), reason: clarityReason },
    dehaze: { value: clamp(Math.round(dehazeVal * strengthScalar), BOUNDS.dehaze.lo, BOUNDS.dehaze.hi), reason: dehazeReason, hazeConfidence },
  };
}
