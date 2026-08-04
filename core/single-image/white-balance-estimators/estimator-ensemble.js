/**
 * core/single-image/white-balance-estimators/estimator-ensemble.js
 *
 * EPIC 2E-P1I — combines all six individual estimator results into one
 * bundle: preserves every result (never silently discards
 * disagreement), computes a weighted consensus with outlier
 * down-weighting, cross-estimator agreement, object-color-bias
 * evidence, and mixed-light evidence. This is P1I's TOP-LEVEL public
 * entrypoint (`runWhiteBalanceEstimators()`) — the only function
 * P1H's integration point calls.
 *
 * IMPORTANT — ownership boundary: this module produces EVIDENCE only.
 * It never writes to session.candidate and never makes the final
 * Temperature/Tint decision — that remains
 * core/single-image/white-balance-intelligence/wb-plan-builder.js's
 * (P1H's) sole responsibility. See P1I_P1H_INTEGRATION_POLICY.md.
 */

import { sampleFromBuffer, sampleFromImage } from './wb-pixel-sampler.js';
import { estimateGrayWorld } from './gray-world-estimator.js';
import { estimateWhitePatch } from './white-patch-estimator.js';
import { estimateShadesOfGray } from './shades-of-gray-estimator.js';
import { estimateNeutralRegion } from './neutral-region-estimator.js';
import { estimateHighlightIlluminant, estimateShadowIlluminant, compareIlluminants } from './highlight-shadow-illuminant-estimator.js';
import { agreementScore } from './estimator-confidence.js';
import { safeClamp, hueDegreesToFamily } from './wb-color-math.js';
import {
  ESTIMATOR_ID, ESTIMATOR_STATUS, WB_ESTIMATOR_SCHEMA_VERSION,
  WB_ESTIMATOR_BUNDLE_STATUS, createEmptyBundle,
} from './wb-estimator-schema.js';

// Suggested hierarchy (spec): 1) valid neutral-region, 2) valid non-
// clipped white patch, 3) shades of gray, 4) gray world. Implemented
// as a base weight multiplier applied ON TOP OF each estimator's own
// confidence — so hierarchy sets the DEFAULT priority, but a
// low-confidence higher-priority estimator still loses to a
// high-confidence lower-priority one, matching "confidence and scene
// conditions may alter weighting."
const HIERARCHY_WEIGHT = Object.freeze({
  [ESTIMATOR_ID.NEUTRAL_REGION]: 1.4,
  [ESTIMATOR_ID.WHITE_PATCH]: 1.2,
  [ESTIMATOR_ID.SHADES_OF_GRAY]: 1.0,
  [ESTIMATOR_ID.GRAY_WORLD]: 0.9,
  [ESTIMATOR_ID.HIGHLIGHT]: 0.5,
  [ESTIMATOR_ID.SHADOW]: 0.5,
});

const MIN_USABLE_CONFIDENCE = 0.05;
const OUTLIER_VECTOR_DISTANCE = 30; // Candidate slider units
const OUTLIER_DOWNWEIGHT = 0.3;

function _isUsable(result) {
  return !!result && !!result.estimate && result.confidence >= MIN_USABLE_CONFIDENCE
    && (result.status === ESTIMATOR_STATUS.OK || result.status === ESTIMATOR_STATUS.DEGRADED);
}

function _weightedConsensus(entries) {
  // entries: [{ id, result, weight }]
  let tW = 0, tT = 0, tN = 0;
  for (const { result, weight } of entries) {
    tW += weight;
    tT += result.estimate.temperatureIntent * weight;
    tN += result.estimate.tintIntent * weight;
  }
  return { temperature: tW > 0 ? tT / tW : 0, tint: tW > 0 ? tN / tW : 0 };
}

/**
 * @param {Record<string, import('./wb-estimator-schema.js').EstimatorResult>} estimators
 * @returns {object} the consensus + agreement + outlier + object-bias + mixed-light bundle
 */
export function buildEstimatorEnsemble(estimators) {
  const ids = Object.keys(estimators);
  const usable = ids
    .map(id => ({ id, result: estimators[id] }))
    .filter(({ result }) => _isUsable(result));

  if (usable.length === 0) {
    return {
      status: WB_ESTIMATOR_BUNDLE_STATUS.UNAVAILABLE,
      consensus: { temperature: 0, tint: 0 },
      confidence: 0,
      agreement: 0,
      usableEstimatorIds: [],
      outlierEstimatorIds: [],
      rejectedEstimatorIds: ids.filter(id => !_isUsable(estimators[id])),
      reason: 'no estimator produced a usable result — conservative zero-correction fallback',
    };
  }

  // Pass 1: unweighted-by-outlier consensus, to detect outliers against.
  const initialEntries = usable.map(({ id, result }) => ({
    id, result, weight: result.confidence * (HIERARCHY_WEIGHT[id] ?? 1),
  }));
  const provisional = _weightedConsensus(initialEntries);

  const outlierIds = [];
  const finalEntries = initialEntries.map(entry => {
    const dt = entry.result.estimate.temperatureIntent - provisional.temperature;
    const dn = entry.result.estimate.tintIntent - provisional.tint;
    const dist = Math.sqrt(dt ** 2 + dn ** 2);
    if (dist > OUTLIER_VECTOR_DISTANCE && usable.length > 1) {
      outlierIds.push(entry.id);
      return { ...entry, weight: entry.weight * OUTLIER_DOWNWEIGHT };
    }
    return entry;
  });

  const consensus = _weightedConsensus(finalEntries);
  const { agreement } = agreementScore(usable.map(({ result }) => ({ temperature: result.estimate.temperatureIntent, tint: result.estimate.tintIntent })));

  const meanOwnConfidence = usable.reduce((s, { result }) => s + result.confidence, 0) / usable.length;
  const coverageFactor = safeClamp(usable.length / 4, 0, 1); // 4+ usable estimators treated as "well corroborated"
  let confidence = safeClamp(0.40 * agreement + 0.35 * meanOwnConfidence + 0.25 * coverageFactor, 0, 1);
  if (outlierIds.length > 0) confidence = safeClamp(confidence * 0.85, 0, 1);

  return {
    status: outlierIds.length > 0 || agreement < 0.4 ? WB_ESTIMATOR_BUNDLE_STATUS.DEGRADED : WB_ESTIMATOR_BUNDLE_STATUS.OK,
    consensus: { temperature: Math.round(consensus.temperature), tint: Math.round(consensus.tint) },
    confidence: +confidence.toFixed(3),
    agreement: +agreement.toFixed(3),
    usableEstimatorIds: usable.map(u => u.id),
    outlierEstimatorIds: outlierIds,
    rejectedEstimatorIds: ids.filter(id => !_isUsable(estimators[id])),
    reason: outlierIds.length > 0 ? `${outlierIds.length} estimator(s) down-weighted as statistical outliers (>${OUTLIER_VECTOR_DISTANCE} unit distance from provisional consensus)` : null,
  };
}

/**
 * Object-color-bias evidence: does a dominant hue (Gray World/Shades
 * of Gray's own hue-bucket signal) disagree with a trustworthy,
 * spatially-isolated neutral reference (Neutral Region/White Patch)?
 */
export function computeObjectBiasEvidence(estimators) {
  const gw = estimators[ESTIMATOR_ID.GRAY_WORLD];
  const sog = estimators[ESTIMATOR_ID.SHADES_OF_GRAY];
  const nr = estimators[ESTIMATOR_ID.NEUTRAL_REGION];
  const wp = estimators[ESTIMATOR_ID.WHITE_PATCH];

  const dominanceSource = gw?.diagnostics?.dominanceRatio != null ? gw : sog;
  const dominanceRatio = dominanceSource?.diagnostics?.dominanceRatio ?? 0;
  const dominantHueDegrees = dominanceSource?.diagnostics?.dominantHueDegrees ?? null;
  const dominantHueFamily = dominanceSource?.diagnostics?.dominantHueFamily ?? hueDegreesToFamily(dominantHueDegrees);

  const biasedSubset = [gw, sog].filter(_isUsable);
  const referenceSubset = [nr, wp].filter(_isUsable);

  let estimatorDisagreement = 0;
  if (biasedSubset.length && referenceSubset.length) {
    const meanBiasedT = biasedSubset.reduce((s, r) => s + r.estimate.temperatureIntent, 0) / biasedSubset.length;
    const meanBiasedN = biasedSubset.reduce((s, r) => s + r.estimate.tintIntent, 0) / biasedSubset.length;
    const meanRefT = referenceSubset.reduce((s, r) => s + r.estimate.temperatureIntent, 0) / referenceSubset.length;
    const meanRefN = referenceSubset.reduce((s, r) => s + r.estimate.tintIntent, 0) / referenceSubset.length;
    const dist = Math.sqrt((meanBiasedT - meanRefT) ** 2 + (meanBiasedN - meanRefN) ** 2);
    estimatorDisagreement = safeClamp(dist / 40, 0, 1);
  }

  const neutralOverrideAvailable = !!(nr && nr.status !== ESTIMATOR_STATUS.UNAVAILABLE && nr.status !== ESTIMATOR_STATUS.REJECTED && nr.confidence >= 0.35);

  const objectBiasProbability = safeClamp(
    0.40 * dominanceRatio +
    0.35 * estimatorDisagreement +
    0.25 * (neutralOverrideAvailable ? 1 : 0),
    0, 1
  );

  const reasonCodes = [];
  if (dominanceRatio >= 0.45) reasonCodes.push('DOMINANT_HUE_DETECTED');
  if (estimatorDisagreement >= 0.4) reasonCodes.push('ESTIMATOR_DISAGREEMENT');
  if (neutralOverrideAvailable) reasonCodes.push('NEUTRAL_OVERRIDE_AVAILABLE');
  if (objectBiasProbability >= 0.55) reasonCodes.push('OBJECT_COLOR_BIAS_LIKELY');

  return {
    dominantHueFamily, dominanceRatio: +dominanceRatio.toFixed(3),
    estimatorDisagreement: +estimatorDisagreement.toFixed(3),
    neutralOverrideAvailable, objectBiasProbability: +objectBiasProbability.toFixed(3),
    reasonCodes,
  };
}

/** Mixed-light evidence: highlight/shadow comparison, corroborated by estimator-cluster disagreement. */
export function computeMixedLightEvidence(estimators, objectBiasEvidence) {
  const highlight = estimators[ESTIMATOR_ID.HIGHLIGHT];
  const shadow = estimators[ESTIMATOR_ID.SHADOW];
  const base = compareIlluminants(highlight, shadow);
  const corroboratedBySpatialDisagreement = (objectBiasEvidence?.estimatorDisagreement ?? 0) >= 0.4;
  return { ...base, corroboratedBySpatialDisagreement };
}

/**
 * Top-level orchestrator: samples pixels once, runs all six
 * estimators, builds the ensemble + object-bias + mixed-light
 * evidence, and returns the full bundle stored at
 * session.evidence.wbEstimators. Pure with respect to a supplied
 * `{data,width,height}` buffer (Node-testable); the `img` overload is
 * browser-only.
 *
 * @param {{data,width,height}|HTMLImageElement} pixelSource
 * @param {{generationId?:string}} [opts]
 */
export function runWhiteBalanceEstimators(pixelSource, opts = {}) {
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let sample;
  try {
    sample = (pixelSource && typeof pixelSource === 'object' && 'data' in pixelSource && 'width' in pixelSource)
      ? sampleFromBuffer(pixelSource)
      : sampleFromImage(pixelSource);
  } catch (error) {
    const bundle = createEmptyBundle(`pixel sampling failed: ${error?.message || error}`);
    bundle.generationId = opts.generationId ?? null;
    return bundle;
  }

  const estimators = {
    [ESTIMATOR_ID.GRAY_WORLD]: estimateGrayWorld(sample),
    [ESTIMATOR_ID.WHITE_PATCH]: estimateWhitePatch(sample),
    [ESTIMATOR_ID.SHADES_OF_GRAY]: estimateShadesOfGray(sample),
    [ESTIMATOR_ID.NEUTRAL_REGION]: estimateNeutralRegion(sample),
    [ESTIMATOR_ID.HIGHLIGHT]: estimateHighlightIlluminant(sample),
    [ESTIMATOR_ID.SHADOW]: estimateShadowIlluminant(sample),
  };

  const ensemble = buildEstimatorEnsemble(estimators);
  const objectBias = computeObjectBiasEvidence(estimators);
  const mixedLight = computeMixedLightEvidence(estimators, objectBias);

  const durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  const anyUsable = ensemble.usableEstimatorIds.length > 0;

  return {
    schemaVersion: WB_ESTIMATOR_SCHEMA_VERSION,
    status: anyUsable ? (ensemble.status) : WB_ESTIMATOR_BUNDLE_STATUS.UNAVAILABLE,
    generationId: opts.generationId ?? null,
    estimators,
    ensemble,
    objectBias,
    mixedLight,
    diagnostics: {
      reason: anyUsable ? null : ensemble.reason,
      durationMs,
      warnings: [],
      sampleSummary: { totalScanned: sample.totalScanned, accepted: sample.accepted.length, maxSamplesHit: sample.maxSamplesHit, maxScanHit: sample.maxScanHit },
    },
  };
}
