/**
 * core/single-image/white-balance-estimators/wb-estimator-schema.js
 *
 * EPIC 2E-P1I — the stable per-estimator result contract every module
 * in this family returns, and the ensemble bundle shape stored at
 * session.evidence.wbEstimators. Centralised here so the shape is
 * defined exactly once (additive-only; nothing here replaces or
 * narrows any P1H/P1C/P1E/P1F/P1G schema field).
 */

export const WB_ESTIMATOR_SCHEMA_VERSION = '1.0.0';

export const ESTIMATOR_ID = Object.freeze({
  GRAY_WORLD: 'grayWorld',
  WHITE_PATCH: 'whitePatch',
  SHADES_OF_GRAY: 'shadesOfGray',
  NEUTRAL_REGION: 'neutralRegion',
  HIGHLIGHT: 'highlightIlluminant',
  SHADOW: 'shadowIlluminant',
});

export const ESTIMATOR_STATUS = Object.freeze({
  OK: 'OK',
  REJECTED: 'REJECTED',
  DEGRADED: 'DEGRADED',       // ran, produced a low-confidence/low-support result
  UNAVAILABLE: 'UNAVAILABLE', // could not run at all (e.g. no pixel buffer)
});

export const REJECTION_REASON = Object.freeze({
  NO_VALID_HIGHLIGHT_REGION: 'NO_VALID_HIGHLIGHT_REGION',
  HIGHLIGHTS_CLIPPED: 'HIGHLIGHTS_CLIPPED',
  HIGHLIGHTS_TOO_SATURATED: 'HIGHLIGHTS_TOO_SATURATED',
  INSUFFICIENT_SPATIAL_COVERAGE: 'INSUFFICIENT_SPATIAL_COVERAGE',
  COLORED_LIGHT_SUSPECTED: 'COLORED_LIGHT_SUSPECTED',
  NO_ACCEPTED_PIXELS: 'NO_ACCEPTED_PIXELS',
  INSUFFICIENT_SAMPLE_COUNT: 'INSUFFICIENT_SAMPLE_COUNT',
  NO_NEUTRAL_CANDIDATES: 'NO_NEUTRAL_CANDIDATES',
  NO_NEUTRAL_REGIONS: 'NO_NEUTRAL_REGIONS',
  REGION_TOO_SMALL: 'REGION_TOO_SMALL',
  DOMINATED_BY_SKIN: 'DOMINATED_BY_SKIN',
  SPECULAR_ONLY: 'SPECULAR_ONLY',
  NOISY_SHADOWS: 'NOISY_SHADOWS',
  BUFFER_UNAVAILABLE: 'BUFFER_UNAVAILABLE',
});

/**
 * @typedef {Object} EstimatorEvidence
 * @property {number} sampleCount
 * @property {number} acceptedPixelCount
 * @property {number} rejectedPixelCount
 * @property {{min:number,max:number}} luminanceRange
 * @property {{min:number,max:number}} saturationRange
 * @property {number} clippingRate     0-1
 * @property {number} spatialCoverage  0-1, fraction of frame area the accepted samples span
 */

/**
 * @typedef {Object} EstimatorResult
 * @property {string} estimatorId
 * @property {string} status            one of ESTIMATOR_STATUS
 * @property {number} confidence        0-1
 * @property {{rgbGain:{r:number,g:number,b:number}, temperatureIntent:number, tintIntent:number, castAxis:string, castStrength:number}|null} estimate
 * @property {EstimatorEvidence} evidence
 * @property {{rejectionReason:string|null, warnings:string[]}} diagnostics
 */

/** Builds a safe UNAVAILABLE result — the universal fallback for any estimator that cannot run. */
export function unavailableResult(estimatorId, reason, evidenceOverrides = {}) {
  return {
    estimatorId,
    status: ESTIMATOR_STATUS.UNAVAILABLE,
    confidence: 0,
    estimate: null,
    evidence: {
      sampleCount: 0, acceptedPixelCount: 0, rejectedPixelCount: 0,
      luminanceRange: { min: 0, max: 0 }, saturationRange: { min: 0, max: 0 },
      clippingRate: 0, spatialCoverage: 0,
      ...evidenceOverrides,
    },
    diagnostics: { rejectionReason: reason ?? REJECTION_REASON.BUFFER_UNAVAILABLE, warnings: [] },
  };
}

export const WB_ESTIMATOR_BUNDLE_STATUS = Object.freeze({
  OK: 'OK',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** Safe empty bundle — used whenever the pixel pipeline cannot run at all. */
export function createEmptyBundle(reason) {
  return {
    schemaVersion: WB_ESTIMATOR_SCHEMA_VERSION,
    status: WB_ESTIMATOR_BUNDLE_STATUS.UNAVAILABLE,
    generationId: null,
    estimators: {},
    ensemble: null,
    objectBias: null,
    mixedLight: null,
    diagnostics: { reason: reason ?? 'estimator pipeline did not run', durationMs: 0, warnings: [] },
  };
}
