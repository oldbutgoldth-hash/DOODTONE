/**
 * core/single-image/strength-mode/strength-mode-schema.js
 *
 * EPIC 2E-P1M — Strength-mode UI (Natural/Balanced/Dramatic).
 *
 * ONE canonical, user-facing strength enum that the UI exposes as a
 * single 3-way control, shared across every Intelligence layer
 * (Basic Tone, White Balance, Tone Curve, Parametric Tone, Color,
 * Detail). This is deliberately a SEPARATE, new schema — not a
 * duplicate of any single module's own STRENGTH_MODE — because, per
 * P1M_STRENGTH_MODE_AUDIT.md, the six existing per-module schemas do
 * NOT share one vocabulary:
 *
 *   basic-tone-schema.js         NATURAL / BALANCED / DRAMATIC
 *   tone-curve-schema.js         NATURAL / BALANCED / DRAMATIC
 *   parametric-tone-schema.js    NATURAL / BALANCED / DRAMATIC
 *   detail-schema.js             NATURAL / BALANCED / CRISP
 *   color-intelligence-schema.js NATURAL / BALANCED / CINEMATIC / STRONG
 *   white-balance-schema.js      CONSERVATIVE / BALANCED / CORRECTIVE
 *     (white-balance-schema.js also has NO STRENGTH_SCALARS table at
 *     all -- wb-guardrails.js uses its own STRENGTH_MULTIPLIER map)
 *
 * color-intelligence-schema.js's own header comment even names this
 * exact gap: "CINEMATIC/STRONG exist for architectural extensibility
 * (e.g., a future user-facing intensity control)". This module is
 * that control's canonical vocabulary; strength-mode-mapper.js is the
 * per-module translation layer that makes ONE user choice apply
 * consistently everywhere without renaming or touching any of the six
 * existing schemas (additive-only, per this project's convention).
 */

export const UI_STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  DRAMATIC: 'DRAMATIC',
});

export const UI_STRENGTH_MODE_LIST = Object.freeze([
  UI_STRENGTH_MODE.NATURAL, UI_STRENGTH_MODE.BALANCED, UI_STRENGTH_MODE.DRAMATIC,
]);

export const DEFAULT_UI_STRENGTH_MODE = UI_STRENGTH_MODE.BALANCED;

export function isValidUiStrengthMode(value) {
  return UI_STRENGTH_MODE_LIST.includes(value);
}
