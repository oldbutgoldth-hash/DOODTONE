/**
 * EPIC 2E-N2 — Photographic Compensation Engine
 *
 * Separates likely illuminant change from scene/object colour bias, then
 * applies skin and dynamic-range protection before any Lightroom mapping.
 * It consumes only N1 signatures/delta and emits bounded semantic intents.
 * No XMP, preset serialization, Production write, or browser APIs.
 */
import { COLOR_MATCH_CHANNELS, isColorMatchDelta, isColorMatchSignature } from './signature-schema.js';
import { buildTargetAwareProtection } from './target-aware-protection-engine.js';

export const PHOTOGRAPHIC_COMPENSATION_KIND = 'LUMIXA_PHOTOGRAPHIC_COMPENSATION';
export const PHOTOGRAPHIC_COMPENSATION_SCHEMA_VERSION = 1;

export const COMPENSATION_STATES = Object.freeze({
  BLOCKED_INSUFFICIENT_EVIDENCE: 'BLOCKED_INSUFFICIENT_EVIDENCE',
  SAFE_IDENTITY: 'SAFE_IDENTITY',
  SAFE_BOUNDED_MATCH: 'SAFE_BOUNDED_MATCH',
  REVIEW_LARGE_ADJUSTMENT: 'REVIEW_LARGE_ADJUSTMENT',
});

export const COMPENSATION_REASON_CODES = Object.freeze({
  ZONE_CONSISTENT_ILLUMINANT: 'ZONE_CONSISTENT_ILLUMINANT',
  ZONE_INCONSISTENT_OBJECT_BIAS: 'ZONE_INCONSISTENT_OBJECT_BIAS',
  NEUTRAL_EVIDENCE_SUPPORTS_WB: 'NEUTRAL_EVIDENCE_SUPPORTS_WB',
  LOW_NEUTRAL_EVIDENCE_DAMPENS_WB: 'LOW_NEUTRAL_EVIDENCE_DAMPENS_WB',
  SKIN_PROTECTION_APPLIED: 'SKIN_PROTECTION_APPLIED',
  HIGHLIGHT_HEADROOM_PROTECTED: 'HIGHLIGHT_HEADROOM_PROTECTED',
  SHADOW_HEADROOM_PROTECTED: 'SHADOW_HEADROOM_PROTECTED',
  LARGE_SHIFT_DAMPENED: 'LARGE_SHIFT_DAMPENED',
  ALREADY_CLOSE_IDENTITY: 'ALREADY_CLOSE_IDENTITY',
  TARGET_HIGH_KEY_PROTECTED: 'TARGET_HIGH_KEY_PROTECTED',
  NEUTRAL_WHITE_PROTECTION_APPLIED: 'NEUTRAL_WHITE_PROTECTION_APPLIED',
  TARGET_SKIN_WARMTH_DAMPENED: 'TARGET_SKIN_WARMTH_DAMPENED',
  SCENE_CHANNEL_TRANSFER_DAMPENED: 'SCENE_CHANNEL_TRANSFER_DAMPENED',
});

const round = (value, digits = 3) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const stddev = values => {
  const avg = mean(values);
  return Math.sqrt(mean(values.map(value => (value - avg) ** 2)));
};

function requireInputs(analysis) {
  if (!analysis || !isColorMatchSignature(analysis.referenceSignature) || !isColorMatchSignature(analysis.targetSignature) || !isColorMatchDelta(analysis.delta)) {
    throw new TypeError('N2 requires a valid N1 core color-match analysis.');
  }
}

function deriveIlluminantModel(reference, target, delta) {
  const validZones = ['shadow', 'midtone', 'highlight'].filter(zone => {
    const refShare = Number(reference.tone.zoneShares?.[zone]) || 0;
    const tgtShare = Number(target.tone.zoneShares?.[zone]) || 0;
    // A zone must contain real sampled pixels in both images. Empty-zone
    // neutral defaults are not evidence and must never lower consistency.
    return refShare > 0.015 && tgtShare > 0.015;
  });
  const evidenceZones = validZones.length ? validZones : ['midtone'];
  const warmthZones = evidenceZones.map(zone => delta.whiteBalance.zones[zone].warmth);
  const tintZones = evidenceZones.map(zone => delta.whiteBalance.zones[zone].tint);
  const warmthSpread = evidenceZones.length > 1 ? stddev(warmthZones) : 0;
  const tintSpread = evidenceZones.length > 1 ? stddev(tintZones) : 0;
  const zoneConsistency = clamp(1 - (warmthSpread / 28 + tintSpread / 22) / 2, 0, 1);

  const neutralEvidence = clamp(Math.max(reference.color.neutralShare, target.color.neutralShare) * 2.4, 0, 1);
  const evidenceConfidence = clamp(delta.evidence.combinedConfidence, 0, 1);
  const dominantWeight = Math.max(
    ...COLOR_MATCH_CHANNELS.map(channel => reference.color.channels[channel].weight),
    ...COLOR_MATCH_CHANNELS.map(channel => target.color.channels[channel].weight),
  );
  const dominantSceneBias = clamp((dominantWeight - 0.34) / 0.42, 0, 1);
  const paletteBias = clamp(delta.color.paletteDistance / 18, 0, 1);

  // Dominant scene colour is only a strong object-bias warning when the cast
  // is not consistent across real tone zones. A global cast on a low-diversity
  // image can legitimately move every populated zone in the same direction.
  const inconsistency = 1 - zoneConsistency;
  const objectBiasScore = clamp(
    inconsistency * 0.56
      + dominantSceneBias * (0.08 + inconsistency * 0.22)
      + paletteBias * (0.05 + inconsistency * 0.18),
    0,
    1,
  );
  const singleZonePenalty = validZones.length === 1 ? 0.08 : validZones.length === 0 ? 0.2 : 0;
  const illuminantConfidence = clamp(
    zoneConsistency * 0.6 + neutralEvidence * 0.12 + evidenceConfidence * 0.28 - singleZonePenalty,
    0,
    1,
  );
  const transferStrength = clamp(
    illuminantConfidence * (1 - objectBiasScore * 0.72),
    delta.matchNeedScore < 5 ? 0 : 0.12,
    0.94,
  );

  return {
    validZoneCount: validZones.length,
    validZones,
    warmthSpread: round(warmthSpread, 2),
    tintSpread: round(tintSpread, 2),
    zoneConsistency: round(zoneConsistency, 3),
    neutralEvidence: round(neutralEvidence, 3),
    dominantSceneBias: round(dominantSceneBias, 3),
    paletteBias: round(paletteBias, 3),
    objectBiasScore: round(objectBiasScore, 3),
    illuminantConfidence: round(illuminantConfidence, 3),
    transferStrength: round(transferStrength, 3),
    semanticWarmthIntent: round(delta.whiteBalance.warmth * transferStrength, 3),
    semanticTintIntent: round(delta.whiteBalance.tint * transferStrength, 3),
  };
}
function deriveDynamicRangeModel(reference, target, delta) {
  const hiRisk = clamp(
    (target.captureRisk.clipHiPct / 3) + Math.max(0, delta.tone.highlightLuma) / 45,
    0,
    1,
  );
  const loRisk = clamp(
    (target.captureRisk.clipLoPct / 3) + Math.max(0, -delta.tone.shadowLuma) / 45,
    0,
    1,
  );
  const targetDr = Number(target.captureRisk.dynamicRangeStops) || 0;
  const referenceDr = Number(reference.captureRisk.dynamicRangeStops) || 0;
  const lowDrPenalty = targetDr > 0 && targetDr < 7 ? clamp((7 - targetDr) / 4, 0, 1) : 0;
  const highDrMismatch = targetDr > 0 && referenceDr > 0 ? clamp(Math.abs(referenceDr - targetDr) / 8, 0, 1) : 0;
  return {
    highlightRisk: round(hiRisk, 3),
    shadowRisk: round(loRisk, 3),
    lowDynamicRangePenalty: round(lowDrPenalty, 3),
    dynamicRangeMismatch: round(highDrMismatch, 3),
    highlightTransferStrength: round(clamp(1 - hiRisk * 0.72 - lowDrPenalty * 0.25, 0.18, 1), 3),
    shadowTransferStrength: round(clamp(1 - loRisk * 0.72 - lowDrPenalty * 0.25, 0.18, 1), 3),
    globalToneStrength: round(clamp(1 - Math.max(hiRisk, loRisk) * 0.42 - highDrMismatch * 0.18, 0.35, 1), 3),
  };
}

function deriveSkinModel(reference, target, delta) {
  const detected = Boolean(target.skin.detected);
  const targetConfidence = clamp(target.skin.confidence, 0, 1);
  const pairedSkin = detected && reference.skin.detected;
  const hueRisk = pairedSkin ? clamp(Math.abs(delta.skin.hueDelta) / 24, 0, 1) : 0;
  const saturationRisk = pairedSkin ? clamp(Math.abs(delta.skin.saturationDelta) / 30, 0, 1) : 0;
  const coverage = clamp(target.skin.coveragePct / 55, 0, 1);
  const protectionStrength = detected
    ? clamp(0.42 + targetConfidence * 0.28 + coverage * 0.2 + Math.max(hueRisk, saturationRisk) * 0.1, 0.45, 0.9)
    : 0;
  return {
    active: detected,
    pairedSkinEvidence: pairedSkin,
    targetConfidence: round(targetConfidence, 3),
    coverageFactor: round(coverage, 3),
    hueRisk: round(hueRisk, 3),
    saturationRisk: round(saturationRisk, 3),
    protectionStrength: round(protectionStrength, 3),
    skinChannelTransferStrength: round(detected ? 1 - protectionStrength * 0.72 : 1, 3),
    globalWbTransferStrength: round(detected ? 1 - protectionStrength * 0.2 : 1, 3),
  };
}

function buildSemanticIntents(delta, illuminant, dynamicRange, skin, targetProtection, intensity) {
  const amount = clamp(intensity, 0, 100) / 100;
  const largeShiftDampen = delta.matchNeedScore >= 55 ? 0.78 : delta.matchNeedScore >= 28 ? 0.9 : 1;
  const toneStrength = dynamicRange.globalToneStrength * amount * largeShiftDampen;
  const wbStrength = illuminant.transferStrength * skin.globalWbTransferStrength * amount * largeShiftDampen;
  const neutral = targetProtection.neutralWhite;
  const targetSkin = targetProtection.skin;
  const channels = {};
  for (const channel of COLOR_MATCH_CHANNELS) {
    const source = delta.color.channels[channel];
    const isSkinChannel = ['red', 'orange', 'yellow'].includes(channel);
    const legacySkinScale = isSkinChannel ? skin.skinChannelTransferStrength : 1;
    const targetSkinScale = isSkinChannel ? targetSkin.skinChannelScale : 1;
    const sceneScale = targetProtection.sceneColor.channels[channel].transferStrength;
    // Transfer only colour characteristics that exist in both scenes. A large
    // population difference is object-distribution evidence, not permission
    // to force a missing colour family into the target.
    const evidenceWeight = clamp(0.2 + sceneScale * 0.8, 0.08, 1);
    const saturationProtection = isSkinChannel ? targetSkin.warmSaturationScale : neutral.globalSaturationScale;
    channels[channel] = {
      hue: round(clamp(source.hueDelta * 0.32 * amount * legacySkinScale * targetSkinScale * evidenceWeight, -18, 18), 3),
      saturation: round(clamp(source.saturationDelta * 0.45 * amount * legacySkinScale * targetSkinScale * evidenceWeight * saturationProtection, -28, 28), 3),
      luminance: round(clamp(source.luminanceDelta * 0.38 * amount * legacySkinScale * targetSkinScale * evidenceWeight, -22, 22), 3),
      sourceWeightDelta: source.weightDelta,
      transferability: sceneScale,
    };
  }

  const rawExposure = delta.tone.midtoneLuma / 85 * toneStrength;
  const rawHighlights = delta.tone.highlightLuma * 0.42 * dynamicRange.highlightTransferStrength * amount;
  const rawWhites = delta.tone.whitePoint * 0.25 * dynamicRange.highlightTransferStrength * amount;
  const exposureScale = rawExposure > 0 ? neutral.positiveExposureScale : 1;
  const highlightScale = rawHighlights > 0 ? neutral.positiveHighlightScale : 1;
  const whitesScale = rawWhites > 0 ? neutral.positiveWhitesScale : 1;

  const rawWarmthIntent = delta.whiteBalance.warmth * wbStrength * neutral.whiteBalanceScale * targetSkin.globalWarmthScale;
  const consistentIlluminant = illuminant.zoneConsistency >= 0.72 && illuminant.illuminantConfidence >= 0.55;
  const warmthFloorScale = targetSkin.targetAlreadyWarm ? 0.18 : 0.30;
  const warmthFloor = consistentIlluminant && Math.abs(delta.whiteBalance.warmth) >= 8
    ? delta.whiteBalance.warmth * amount * warmthFloorScale
    : 0;
  const finalWarmthIntent = Math.abs(rawWarmthIntent) < Math.abs(warmthFloor) && Math.sign(rawWarmthIntent || warmthFloor) === Math.sign(warmthFloor)
    ? warmthFloor
    : rawWarmthIntent;
  const rawTintIntent = delta.whiteBalance.tint * wbStrength * neutral.tintScale * targetSkin.globalTintScale;

  return {
    whiteBalance: {
      warmth: round(clamp(finalWarmthIntent, -45, 45), 3),
      tint: round(clamp(rawTintIntent, -30, 30), 3),
      transferFloorApplied: Math.abs(finalWarmthIntent) > Math.abs(rawWarmthIntent) + 0.001,
    },
    tone: {
      exposureEv: round(clamp(rawExposure * exposureScale, -1.35, 1.35), 4),
      contrast: round(clamp(delta.tone.contrast * 0.46 * toneStrength, -28, 28), 3),
      highlights: round(clamp(rawHighlights * highlightScale, -38, 38), 3),
      shadows: round(clamp(delta.tone.shadowLuma * 0.42 * dynamicRange.shadowTransferStrength * amount, -38, 38), 3),
      whites: round(clamp(rawWhites * whitesScale, -24, 24), 3),
      blacks: round(clamp(delta.tone.blackPoint * 0.25 * dynamicRange.shadowTransferStrength * amount, -24, 24), 3),
      tonalSpan: round(clamp(delta.tone.tonalSpan * 0.2 * toneStrength, -18, 18), 3),
    },
    presence: {
      vibrance: round(clamp(delta.color.weightedSaturation * 0.48 * amount * neutral.globalSaturationScale * targetSkin.warmSaturationScale, -30, 30), 3),
      saturation: round(clamp(delta.color.weightedSaturation * 0.22 * amount * neutral.globalSaturationScale * targetSkin.warmSaturationScale, -16, 16), 3),
      clarity: round(clamp(delta.tone.contrast * 0.12 * amount, -12, 12), 3),
      dehaze: round(clamp(delta.tone.tonalSpan * 0.06 * amount, -8, 8), 3),
      texture: 0,
    },
    hsl: channels,
  };
}

export function buildPhotographicCompensation({ analysis, intensity = 70, protectionOptions = {} } = {}) {
  requireInputs(analysis);
  const reference = analysis.referenceSignature;
  const target = analysis.targetSignature;
  const delta = analysis.delta;
  const reasonCodes = [];
  const warningCodes = [...delta.riskCodes];

  const illuminant = deriveIlluminantModel(reference, target, delta);
  const dynamicRange = deriveDynamicRangeModel(reference, target, delta);
  const skin = deriveSkinModel(reference, target, delta);
  const targetProtection = buildTargetAwareProtection({
    referenceSignature: reference, targetSignature: target, delta, options: protectionOptions,
  });
  if (illuminant.zoneConsistency >= 0.68) reasonCodes.push(COMPENSATION_REASON_CODES.ZONE_CONSISTENT_ILLUMINANT);
  else reasonCodes.push(COMPENSATION_REASON_CODES.ZONE_INCONSISTENT_OBJECT_BIAS);
  if (illuminant.neutralEvidence >= 0.35) reasonCodes.push(COMPENSATION_REASON_CODES.NEUTRAL_EVIDENCE_SUPPORTS_WB);
  else reasonCodes.push(COMPENSATION_REASON_CODES.LOW_NEUTRAL_EVIDENCE_DAMPENS_WB);
  if (skin.active) reasonCodes.push(COMPENSATION_REASON_CODES.SKIN_PROTECTION_APPLIED);
  if (dynamicRange.highlightRisk > 0.2) reasonCodes.push(COMPENSATION_REASON_CODES.HIGHLIGHT_HEADROOM_PROTECTED);
  if (dynamicRange.shadowRisk > 0.2) reasonCodes.push(COMPENSATION_REASON_CODES.SHADOW_HEADROOM_PROTECTED);
  if (delta.matchNeedScore >= 28) reasonCodes.push(COMPENSATION_REASON_CODES.LARGE_SHIFT_DAMPENED);
  if (delta.matchNeedScore < 5) reasonCodes.push(COMPENSATION_REASON_CODES.ALREADY_CLOSE_IDENTITY);
  if (targetProtection.neutralWhite.targetHighKeyScore >= 0.42) reasonCodes.push(COMPENSATION_REASON_CODES.TARGET_HIGH_KEY_PROTECTED);
  if (targetProtection.neutralWhite.active) reasonCodes.push(COMPENSATION_REASON_CODES.NEUTRAL_WHITE_PROTECTION_APPLIED);
  if (targetProtection.skin.targetAlreadyWarm || targetProtection.skin.targetAlreadySaturated) reasonCodes.push(COMPENSATION_REASON_CODES.TARGET_SKIN_WARMTH_DAMPENED);
  if (targetProtection.sceneColor.dampenedCount > 0) reasonCodes.push(COMPENSATION_REASON_CODES.SCENE_CHANNEL_TRANSFER_DAMPENED);

  let state = COMPENSATION_STATES.SAFE_BOUNDED_MATCH;
  if (delta.evidence.combinedConfidence < 0.45) state = COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE;
  else if (delta.matchNeedScore < 5) state = COMPENSATION_STATES.SAFE_IDENTITY;
  else if (delta.matchNeedScore >= 28) state = COMPENSATION_STATES.REVIEW_LARGE_ADJUSTMENT;

  const semanticIntents = state === COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE
    ? buildSemanticIntents(delta, { ...illuminant, transferStrength: 0 }, dynamicRange, skin, targetProtection, 0)
    : buildSemanticIntents(delta, illuminant, dynamicRange, skin, targetProtection, intensity);

  return {
    kind: PHOTOGRAPHIC_COMPENSATION_KIND,
    schemaVersion: PHOTOGRAPHIC_COMPENSATION_SCHEMA_VERSION,
    stage: 'N2_PHOTOGRAPHIC_COMPENSATION',
    state,
    analysisGenerationId: reference.analysisGenerationId,
    analysis,
    intensity: clamp(intensity, 0, 100),
    illuminant,
    objectColorBias: {
      score: illuminant.objectBiasScore,
      wbDampeningApplied: round(1 - illuminant.transferStrength, 3),
    },
    dynamicRange,
    skinProtection: skin,
    targetProtection,
    semanticIntents,
    reasonCodes: [...new Set(reasonCodes)],
    warningCodes: [...new Set(warningCodes)],
    evidence: {
      combinedConfidence: delta.evidence.combinedConfidence,
      matchNeedScore: delta.matchNeedScore,
      referenceConfidence: delta.evidence.referenceConfidence,
      targetConfidence: delta.evidence.targetConfidence,
    },
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      lightroomMappingAllowed: false,
    },
  };
}
