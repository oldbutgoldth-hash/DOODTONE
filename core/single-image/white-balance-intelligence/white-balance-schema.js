/**
 * core/single-image/white-balance-intelligence/white-balance-schema.js
 *
 * EPIC 2E-P1H — White Balance Intelligence & Illuminant Separation.
 *
 * Schema for the White Balance Plan, adapted from the EPIC 2E-P1H spec
 * to this repo's real contracts (see P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md
 * and P1H_WB_PLAN_SCHEMA_MAPPING.md for the field-by-field rationale).
 * Mirrors the P1F basic-tone-schema.js / P1G detail-schema.js convention:
 * one schemaVersion constant, one createEmptyPlan() factory, enums as
 * frozen objects, never a class.
 */

export const WB_PLAN_SCHEMA_VERSION = '1.0.0';

export const STRENGTH_MODE = Object.freeze({
  CONSERVATIVE: 'CONSERVATIVE',
  BALANCED: 'BALANCED',
  CORRECTIVE: 'CORRECTIVE',
});
export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

export const CONFIDENCE_TIER = Object.freeze({ HIGH: 'high', MODERATE: 'moderate', LOW: 'low' });

// Ten cast classes required by the spec. Multiple flags may be set at
// once (classification.flags); classification.primaryCast is always
// exactly one of these, chosen by priority (see cast-classifier.js).
export const CAST_CLASS = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  WARM_CAST: 'WARM_CAST',
  COOL_CAST: 'COOL_CAST',
  GREEN_CAST: 'GREEN_CAST',
  MAGENTA_CAST: 'MAGENTA_CAST',
  MIXED_LIGHT: 'MIXED_LIGHT',
  INTENTIONAL_WARM_LIGHT: 'INTENTIONAL_WARM_LIGHT',
  INTENTIONAL_COLORED_LIGHT: 'INTENTIONAL_COLORED_LIGHT',
  OBJECT_COLOR_BIAS: 'OBJECT_COLOR_BIAS',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
});

export const WB_PLAN_STATUS = Object.freeze({
  OK: 'OK',                 // real evidence, plan computed normally
  NO_EVIDENCE: 'NO_EVIDENCE', // wb evidence missing/failed -- plan is a safe no-op
  DEGRADED: 'DEGRADED',      // partial evidence (e.g. no colorCast) -- plan computed with reduced confidence
});

/** Safe, all-zero plan used whenever real evidence is unavailable. */
export function createEmptyPlan() {
  return {
    schemaVersion: WB_PLAN_SCHEMA_VERSION,
    status: WB_PLAN_STATUS.NO_EVIDENCE,
    strengthMode: DEFAULT_STRENGTH_MODE,
    confidence: 0,
    confidenceTier: CONFIDENCE_TIER.LOW,
    evidence: null,
    classification: {
      primaryCast: CAST_CLASS.LOW_CONFIDENCE,
      flags: [CAST_CLASS.LOW_CONFIDENCE],
      isIntentional: false,
      mixedLightDetected: false,
      objectColorBiasScore: 0,
    },
    correction: { temperature: 0, tint: 0 },
    protections: {
      neutralReferenceTrusted: false,
      skinValidationApplied: false,
      objectColorBiasGuard: false,
      mixedLightGuard: false,
      intentionalLightPreserved: false,
    },
    finalValues: { temperature: 0, tint: 0 },
    lineage: { source: 'none', reasons: ['no White Balance evidence available'] },
    diagnostics: { engaged: false, reasons: ['no White Balance evidence available'], warnings: [], mixedLightMessage: null },
  };
}
