/**
 * core/single-image/basic-tone-intelligence/basic-tone-guardrails.js
 *
 * EPIC 2E-P1F — Layer A safety net for the Basic Tone Plan. Every
 * individual planner function already clamps its own output to
 * basic-tone-schema.BOUNDS, but this module is the single, final,
 * independently-owned check applied to the assembled plan before it
 * becomes the Candidate's basic.* values -- the SAME "two-layer safety
 * net" convention this project already uses everywhere else (a tight
 * local bound, always checked again even though it "shouldn't" ever
 * fire). This is especially important for texture/clarity/dehaze,
 * which core/xmp-validator's quickSafetyClamp() does NOT clamp at all
 * (see P1F_BASIC_VALUE_LINEAGE_AUDIT.md's "known structural gap") --
 * for those three fields, this module is the ONLY safety net that
 * will ever run.
 */

import { clamp } from '../../color-engine/index.js';
import { BOUNDS } from './basic-tone-schema.js';

const FIELD_BOUNDS_MAP = {
  exposure: BOUNDS.exposure, contrast: BOUNDS.contrast, highlights: BOUNDS.highlights,
  shadows: BOUNDS.shadows, whites: BOUNDS.whites, blacks: BOUNDS.blacks,
  texture: BOUNDS.texture, clarity: BOUNDS.clarity, dehaze: BOUNDS.dehaze,
};

/**
 * @param {object} fields  { exposure, contrast, highlights, shadows, whites, blacks, texture, clarity, dehaze }
 * @param {{noiseRisk?: boolean}} [opts]  noiseRisk true further caps Texture/Clarity (shadow-lift risk of amplifying noise)
 * @returns {{values: object, adjustments: string[], noiseProtection: boolean}}
 */
export function applyBasicToneGuardrails(fields, { noiseRisk = false } = {}) {
  const values = {};
  const adjustments = [];

  for (const [key, bound] of Object.entries(FIELD_BOUNDS_MAP)) {
    const raw = Number.isFinite(fields[key]) ? Math.round(fields[key]) : 0;
    const clamped = clamp(raw, bound.lo, bound.hi);
    if (clamped !== raw) adjustments.push(`${key} (${raw}) outside Basic Tone bound [${bound.lo},${bound.hi}] -- clamped to ${clamped}.`);
    values[key] = clamped;
  }

  // Noise protection: when shadow-lift/underexposure risk is present,
  // further cap Texture/Clarity so amplified sensor noise in lifted
  // shadow regions is never sharpened.
  let noiseProtection = false;
  if (noiseRisk) {
    const capT = Math.round(BOUNDS.texture.hi * 0.5);
    const capC = Math.round(BOUNDS.clarity.hi * 0.5);
    if (values.texture > capT) { adjustments.push(`Texture (${values.texture}) reduced to ${capT} -- noise protection (shadow-lift risk).`); values.texture = capT; noiseProtection = true; }
    if (values.clarity > capC) { adjustments.push(`Clarity (${values.clarity}) reduced to ${capC} -- noise protection (shadow-lift risk).`); values.clarity = capC; noiseProtection = true; }
  }

  return { values, adjustments, noiseProtection };
}
