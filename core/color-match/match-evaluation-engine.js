/**
 * EPIC 2E-N4/N5 — Match Evaluation and Explainability
 *
 * Evaluates signature distance before/after, preview clipping, reviewer
 * decision and XMP fidelity evidence. It never activates Production.
 */
import { compareColorMatchSignatures } from './signature-delta-engine.js';
import { buildColorMatchSignature } from './reference-target-signature-engine.js';

export const COLOR_MATCH_EVALUATION_KIND = 'LUMIXA_COLOR_MATCH_EVALUATION';
export const COLOR_MATCH_EVALUATION_SCHEMA_VERSION = 2;

const round = (value, digits = 3) => {
  const p = 10 ** digits;
  return Math.round((Number(value) || 0) * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const circularHueAbs = (a, b) => Math.abs((((Number(a) || 0) - (Number(b) || 0) + 540) % 360) - 180);

/**
 * Distance of photographic characteristics that can reasonably transfer
 * between different scenes. Palette population/scene-object distribution is
 * reported separately and receives only a small diagnostic weight.
 */
export function computePhotographicStyleDistance(reference, target) {
  const sharedZones = ['shadow', 'midtone', 'highlight'].filter(zone =>
    (Number(reference.tone.zoneShares?.[zone]) || 0) > 0.015 &&
    (Number(target.tone.zoneShares?.[zone]) || 0) > 0.015
  );
  const wbOverall = Math.hypot(
    (reference.whiteBalance.warmth - target.whiteBalance.warmth) * 0.9,
    (reference.whiteBalance.tint - target.whiteBalance.tint) * 1.15,
  );
  const wbZone = sharedZones.length
    ? sharedZones.reduce((sum, zone) => sum + Math.hypot(
      (reference.whiteBalance.zones[zone].warmth - target.whiteBalance.zones[zone].warmth) * 0.8,
      (reference.whiteBalance.zones[zone].tint - target.whiteBalance.zones[zone].tint) * 1.05,
    ), 0) / sharedZones.length
    : wbOverall;
  const wbDistance = clamp((wbOverall * 0.65 + wbZone * 0.35) / 55, 0, 1);

  const toneDistance = clamp(
    Math.abs(reference.tone.midtoneLuma - target.tone.midtoneLuma) / 90 * 0.38 +
    Math.abs(reference.tone.contrast - target.tone.contrast) / 80 * 0.24 +
    Math.abs(reference.tone.tonalSpan - target.tone.tonalSpan) / 140 * 0.22 +
    Math.abs(reference.tone.shadowLuma - target.tone.shadowLuma) / 120 * 0.08 +
    Math.abs(reference.tone.highlightLuma - target.tone.highlightLuma) / 120 * 0.08,
    0,
    1,
  );

  let sharedWeight = 0;
  let sharedColor = 0;
  let distributionDistance = 0;
  for (const channel of CHANNELS) {
    const ref = reference.color.channels[channel];
    const tgt = target.color.channels[channel];
    const overlap = Math.min(ref.weight, tgt.weight);
    sharedWeight += overlap;
    if (overlap > 0.005) {
      const local = clamp(
        circularHueAbs(ref.meanHue, tgt.meanHue) / 45 * 0.45 +
        Math.abs(ref.meanSaturation - tgt.meanSaturation) / 60 * 0.32 +
        Math.abs(ref.meanLuminance - tgt.meanLuminance) / 70 * 0.23,
        0,
        1,
      );
      sharedColor += local * overlap;
    }
    distributionDistance += Math.abs(ref.weight - tgt.weight);
  }
  const sharedChannelDistance = sharedWeight > 0.02 ? sharedColor / sharedWeight : 0;
  const globalColorDistance = clamp(
    Math.abs(reference.color.weightedSaturation - target.color.weightedSaturation) / 55 * 0.5 +
    Math.abs(reference.color.weightedLuminance - target.color.weightedLuminance) / 70 * 0.35 +
    Math.abs(reference.color.neutralShare - target.color.neutralShare) * 0.15,
    0,
    1,
  );
  // Object distribution is intentionally diagnostic-only. Color Match must
  // not recolor a blue shirt merely because the reference scene contains an
  // orange wall.
  const objectDistributionDistance = clamp(distributionDistance / 2, 0, 1);
  const colorDistance = clamp(globalColorDistance * 0.58 + sharedChannelDistance * 0.37 + objectDistributionDistance * 0.05, 0, 1);

  let skinDistance = 0;
  let skinComparable = false;
  if (reference.skin.detected && target.skin.detected) {
    skinComparable = true;
    skinDistance = clamp(
      circularHueAbs(reference.skin.meanHue, target.skin.meanHue) / 24 * 0.5 +
      Math.abs(reference.skin.meanSaturation - target.skin.meanSaturation) / 35 * 0.3 +
      Math.abs(reference.skin.meanLuminance - target.skin.meanLuminance) / 35 * 0.2,
      0,
      1,
    );
  }

  const weights = skinComparable
    ? { wb: 0.32, tone: 0.28, color: 0.25, skin: 0.15 }
    : { wb: 0.4, tone: 0.32, color: 0.28, skin: 0 };
  const total = clamp(
    wbDistance * weights.wb + toneDistance * weights.tone + colorDistance * weights.color + skinDistance * weights.skin,
    0,
    1,
  ) * 100;
  return {
    total: round(total, 3),
    whiteBalance: round(wbDistance * 100, 3),
    tone: round(toneDistance * 100, 3),
    transferableColor: round(colorDistance * 100, 3),
    skin: round(skinDistance * 100, 3),
    skinComparable,
    sharedPaletteWeight: round(sharedWeight, 4),
    objectDistributionDistance: round(objectDistributionDistance * 100, 3),
    sharedZoneCount: sharedZones.length,
  };
}


function computeProtectionDiagnostics(target, matched) {
  const targetHighKeyEvidence = clamp(
    (Number(target.color.neutralShare) || 0) * 1.15 +
    (Number(target.tone.zoneShares?.highlight) || 0) * 0.8 +
    Math.max(0, (Number(target.tone.whitePoint) || 0) - 238) / 45,
    0,
    1,
  );
  const cast = signature => Math.hypot(
    Number(signature.whiteBalance.zones?.highlight?.warmth) || 0,
    (Number(signature.whiteBalance.zones?.highlight?.tint) || 0) * 1.15,
  );
  const neutralCastBefore = cast(target);
  const neutralCastAfter = cast(matched);
  const neutralCastIncrease = Math.max(0, neutralCastAfter - neutralCastBefore);
  const highlightLumaIncrease = Math.max(0, (Number(matched.tone.highlightLuma) || 0) - (Number(target.tone.highlightLuma) || 0));
  const whitePointIncrease = Math.max(0, (Number(matched.tone.whitePoint) || 0) - (Number(target.tone.whitePoint) || 0));
  const neutralWhiteRegressionRisk = clamp(
    targetHighKeyEvidence * (
      neutralCastIncrease / 22 * 0.55 +
      highlightLumaIncrease / 28 * 0.3 +
      whitePointIncrease / 18 * 0.15
    ),
    0,
    1,
  );
  const skinRisk = signature => {
    if (!signature.skin.detected) return 0;
    const hueDistance = circularHueAbs(signature.skin.meanHue, 30);
    return clamp(
      Math.max(0, hueDistance - 18) / 28 * 0.45 +
      Math.max(0, signature.skin.meanSaturation - 52) / 30 * 0.4 +
      Math.max(0, 12 - signature.skin.meanSaturation) / 18 * 0.15,
      0,
      1,
    );
  };
  const skinRiskBefore = skinRisk(target);
  const skinRiskAfter = skinRisk(matched);
  const skinRegressionRisk = Math.max(0, skinRiskAfter - skinRiskBefore);
  return {
    targetHighKeyEvidence: round(targetHighKeyEvidence),
    neutralCastBefore: round(neutralCastBefore, 2),
    neutralCastAfter: round(neutralCastAfter, 2),
    neutralCastIncrease: round(neutralCastIncrease, 2),
    highlightLumaIncrease: round(highlightLumaIncrease, 2),
    whitePointIncrease: round(whitePointIncrease, 2),
    neutralWhiteRegressionRisk: round(neutralWhiteRegressionRisk),
    skinRiskBefore: round(skinRiskBefore),
    skinRiskAfter: round(skinRiskAfter),
    skinRegressionRisk: round(skinRegressionRisk),
  };
}
export function evaluateMatchedSignature({ referenceSignature, targetSignature, matchedSignature, previewMetrics = null, candidate = null } = {}) {
  const before = compareColorMatchSignatures({ referenceSignature, targetSignature });
  const after = compareColorMatchSignatures({ referenceSignature, targetSignature: matchedSignature });
  const styleBefore = computePhotographicStyleDistance(referenceSignature, targetSignature);
  const styleAfter = computePhotographicStyleDistance(referenceSignature, matchedSignature);
  const reduction = styleBefore.total > 0 ? (styleBefore.total - styleAfter.total) / styleBefore.total : 1;
  const wbReduction = styleBefore.whiteBalance > 0
    ? (styleBefore.whiteBalance - styleAfter.whiteBalance) / styleBefore.whiteBalance : 1;
  const toneReduction = styleBefore.tone > 0
    ? (styleBefore.tone - styleAfter.tone) / styleBefore.tone : 1;
  const colorReduction = styleBefore.transferableColor > 0
    ? (styleBefore.transferableColor - styleAfter.transferableColor) / styleBefore.transferableColor : 1;
  const clippingPenalty = clamp(
    (previewMetrics?.newlyClippedHighlightPct ?? previewMetrics?.clippedHighlightPct ?? 0) / 2 +
    (previewMetrics?.newlyClippedShadowPct ?? previewMetrics?.clippedShadowPct ?? 0) / 2,
    0,
    1,
  );
  const protectionDiagnostics = computeProtectionDiagnostics(targetSignature, matchedSignature);
  const protectionPenalty = protectionDiagnostics.neutralWhiteRegressionRisk * 28 + protectionDiagnostics.skinRegressionRisk * 35;
  const regressionPenalty = reduction < 0 ? Math.abs(reduction) * 30 : 0;
  const fidelityScore = round(clamp(
    reduction * 62 + wbReduction * 16 + toneReduction * 12 + colorReduction * 10
      + (styleAfter.total <= 12 ? 12 : 0) - clippingPenalty * 22 - regressionPenalty - protectionPenalty,
    0,
    100,
  ), 2);
  const severeProtectionRegression = protectionDiagnostics.neutralWhiteRegressionRisk >= 0.42 || protectionDiagnostics.skinRegressionRisk >= 0.35;
  const status = severeProtectionRegression
    ? 'MATCH_CANDIDATE_PROTECTION_REGRESSION'
    : fidelityScore >= 72 && styleAfter.total <= 14
      ? 'MATCH_CANDIDATE_STRONG'
      : fidelityScore >= 42 && styleAfter.total < styleBefore.total
        ? 'MATCH_CANDIDATE_IMPROVED'
        : styleAfter.total >= styleBefore.total
          ? 'MATCH_CANDIDATE_REGRESSION'
          : 'MATCH_CANDIDATE_PARTIAL';
  return {
    kind: COLOR_MATCH_EVALUATION_KIND,
    schemaVersion: COLOR_MATCH_EVALUATION_SCHEMA_VERSION,
    stage: 'N4_MATCH_FIDELITY_EVALUATION',
    status,
    before: {
      matchNeedScore: before.matchNeedScore,
      photographicStyleDistance: styleBefore.total,
      paletteDistance: before.color.paletteDistance,
      wbMagnitude: round(Math.hypot(before.whiteBalance.warmth, before.whiteBalance.tint), 3),
      toneMagnitude: round(Math.hypot(before.tone.shadowLuma, before.tone.midtoneLuma, before.tone.highlightLuma), 3),
      components: styleBefore,
    },
    after: {
      matchNeedScore: after.matchNeedScore,
      photographicStyleDistance: styleAfter.total,
      paletteDistance: after.color.paletteDistance,
      wbMagnitude: round(Math.hypot(after.whiteBalance.warmth, after.whiteBalance.tint), 3),
      toneMagnitude: round(Math.hypot(after.tone.shadowLuma, after.tone.midtoneLuma, after.tone.highlightLuma), 3),
      components: styleAfter,
    },
    improvement: {
      overallReductionPct: round(reduction * 100, 2),
      whiteBalanceReductionPct: round(wbReduction * 100, 2),
      toneReductionPct: round(toneReduction * 100, 2),
      paletteReductionPct: round(colorReduction * 100, 2),
      fidelityScore,
    },
    diagnostics: {
      rawN1MatchNeedBefore: before.matchNeedScore,
      rawN1MatchNeedAfter: after.matchNeedScore,
      objectDistributionDistanceBefore: styleBefore.objectDistributionDistance,
      objectDistributionDistanceAfter: styleAfter.objectDistributionDistance,
      objectDistributionExcludedFromPrimaryDecision: true,
      protectionDiagnostics,
      protectionPenalty: round(protectionPenalty, 2),
    },
    previewMetrics,
    xmpFidelity: {
      previewUsesSafePreset: Boolean(candidate?.fidelityContract?.previewUsesSafePreset),
      xmpUsesSafePreset: Boolean(candidate?.fidelityContract?.xmpUsesSafePreset),
      sameSourceOfTruth: Boolean(candidate?.fidelityContract?.presetAndXmpSingleSourceOfTruth),
      candidateXmpLength: candidate?.candidateXmpLength ?? 0,
    },
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
    },
  };
}
export function buildMatchedSignatureFromAnalysis({ palette, toneZones, hslAnalysis = null, skinAnalysis = null, histogram = null, analysisGenerationId = null } = {}) {
  return buildColorMatchSignature({
    role: 'TARGET', palette, toneZones, hslAnalysis, skinAnalysis, histogram, analysisGenerationId,
  });
}

export function createColorMatchEvaluationRecord({ analysis, compensation, candidate, evaluation, roundTripFidelity = null, reviewerDecision = 'NOT_REVIEWED', issueCodes = [], notes = '' } = {}) {
  const allowed = ['MATCH_ACCEPTED', 'MATCH_NEEDS_ADJUSTMENT', 'MATCH_REJECTED', 'NOT_SURE', 'NOT_REVIEWED'];
  if (!allowed.includes(reviewerDecision)) throw new TypeError(`Unsupported reviewerDecision: ${reviewerDecision}`);
  return {
    kind: 'LUMIXA_COLOR_MATCH_EVALUATION_RECORD',
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    analysisGenerationId: analysis?.referenceSignature?.analysisGenerationId ?? null,
    referenceSignature: analysis?.referenceSignature ?? null,
    targetSignature: analysis?.targetSignature ?? null,
    delta: analysis?.delta ?? null,
    compensation,
    lightroomCandidate: candidate ? {
      kind: candidate.kind,
      schemaVersion: candidate.schemaVersion,
      candidateState: candidate.candidateState,
      safePreset: candidate.safePreset,
      safetyAdjustments: candidate.safetyAdjustments,
      reasonTrace: candidate.reasonTrace,
      candidateXmpLength: candidate.candidateXmpLength,
      compatibilityProfile: candidate.compatibilityProfile ?? null,
    } : null,
    evaluation,
    roundTripFidelity,
    reviewerDecision,
    issueCodes: [...new Set(issueCodes.map(String))],
    notes: String(notes || '').slice(0, 2000),
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      productionActivationAllowed: false,
    },
  };
}
