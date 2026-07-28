/**
 * EPIC 2E-O — Preview ↔ Lightroom round-trip fidelity evaluation.
 *
 * Compares the in-browser matched preview with a JPEG/TIFF exported by
 * Lightroom after applying the exact Candidate XMP. No images are persisted.
 */
import { computePhotographicStyleDistance } from './match-evaluation-engine.js';
import { isColorMatchSignature } from './signature-schema.js';

export const LIGHTROOM_ROUNDTRIP_KIND = 'LUMIXA_LIGHTROOM_ROUNDTRIP_FIDELITY';
export const LIGHTROOM_ROUNDTRIP_SCHEMA_VERSION = 1;

const round = (value, digits = 3) => {
  const p = 10 ** digits;
  return Math.round((Number(value) || 0) * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function requireSignature(value, label) {
  if (!isColorMatchSignature(value)) throw new TypeError(`${label} must be a valid color-match signature.`);
}

export function evaluateLightroomRoundTrip({
  referenceSignature,
  targetSignature,
  previewSignature,
  lightroomSignature,
  candidate = null,
  compatibilityProfile = null,
} = {}) {
  requireSignature(referenceSignature, 'referenceSignature');
  requireSignature(targetSignature, 'targetSignature');
  requireSignature(previewSignature, 'previewSignature');
  requireSignature(lightroomSignature, 'lightroomSignature');

  const targetToReference = computePhotographicStyleDistance(referenceSignature, targetSignature);
  const previewToReference = computePhotographicStyleDistance(referenceSignature, previewSignature);
  const lightroomToReference = computePhotographicStyleDistance(referenceSignature, lightroomSignature);
  const previewToLightroom = computePhotographicStyleDistance(previewSignature, lightroomSignature);
  const previewImprovement = targetToReference.total > 0
    ? (targetToReference.total - previewToReference.total) / targetToReference.total : 1;
  const lightroomImprovement = targetToReference.total > 0
    ? (targetToReference.total - lightroomToReference.total) / targetToReference.total : 1;
  const previewDrift = previewToLightroom.total;
  const directionAgrees = (previewToReference.total < targetToReference.total) === (lightroomToReference.total < targetToReference.total);
  const xmpSingleSource = Boolean(
    candidate?.fidelityContract?.previewUsesSafePreset &&
    candidate?.fidelityContract?.xmpUsesSafePreset &&
    candidate?.fidelityContract?.presetAndXmpSingleSourceOfTruth
  );
  const rawScore = 100
    - previewDrift * 4.2
    - Math.abs(previewImprovement - lightroomImprovement) * 35
    - (directionAgrees ? 0 : 30)
    - (xmpSingleSource ? 0 : 20);
  const fidelityScore = round(clamp(rawScore, 0, 100), 2);
  let status = 'ROUND_TRIP_REVIEW_REQUIRED';
  if (!directionAgrees || lightroomToReference.total >= targetToReference.total) status = 'ROUND_TRIP_REGRESSION';
  else if (previewDrift <= 7 && fidelityScore >= 82) status = 'ROUND_TRIP_STRONG';
  else if (previewDrift <= 15 && fidelityScore >= 62) status = 'ROUND_TRIP_ACCEPTABLE';

  return {
    kind: LIGHTROOM_ROUNDTRIP_KIND,
    schemaVersion: LIGHTROOM_ROUNDTRIP_SCHEMA_VERSION,
    stage: '2E_O_LIGHTROOM_ROUNDTRIP_EVALUATION',
    status,
    fidelityScore,
    directionAgrees,
    xmpSingleSource,
    distances: {
      targetToReference,
      previewToReference,
      lightroomToReference,
      previewToLightroom,
    },
    improvement: {
      previewPct: round(previewImprovement * 100, 2),
      lightroomPct: round(lightroomImprovement * 100, 2),
      disagreementPct: round(Math.abs(previewImprovement - lightroomImprovement) * 100, 2),
    },
    drift: {
      total: round(previewDrift, 3),
      whiteBalance: previewToLightroom.whiteBalance,
      tone: previewToLightroom.tone,
      transferableColor: previewToLightroom.transferableColor,
      skin: previewToLightroom.skin,
    },
    compatibilityProfile,
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      productionActivationAllowed: false,
    },
  };
}
