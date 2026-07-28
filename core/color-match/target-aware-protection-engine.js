/**
 * EPIC 2E-O — Target-aware photographic protection.
 *
 * The reference describes a look; the target defines what can safely move.
 * This module protects high-key neutrals, skin and scene-specific object
 * colours before N2 semantic intents are translated into Lightroom values.
 * Pure data only: no DOM, XMP serialization or Production state mutation.
 */
import { COLOR_MATCH_CHANNELS, isColorMatchDelta, isColorMatchSignature } from './signature-schema.js';

export const TARGET_AWARE_PROTECTION_KIND = 'LUMIXA_TARGET_AWARE_PROTECTION';
export const TARGET_AWARE_PROTECTION_SCHEMA_VERSION = 1;
export const TARGET_PROTECTION_REASON_CODES = Object.freeze({
  HIGH_KEY_TARGET_PROTECTED: 'HIGH_KEY_TARGET_PROTECTED',
  NEUTRAL_WHITE_PROTECTED: 'NEUTRAL_WHITE_PROTECTED',
  POSITIVE_EXPOSURE_DAMPENED: 'POSITIVE_EXPOSURE_DAMPENED',
  HIGHLIGHT_WARMTH_DAMPENED: 'HIGHLIGHT_WARMTH_DAMPENED',
  TARGET_SKIN_ALREADY_WARM: 'TARGET_SKIN_ALREADY_WARM',
  TARGET_SKIN_SATURATION_PROTECTED: 'TARGET_SKIN_SATURATION_PROTECTED',
  SCENE_OBJECT_CHANNEL_DAMPENED: 'SCENE_OBJECT_CHANNEL_DAMPENED',
  SHARED_CHANNEL_TRANSFER_SUPPORTED: 'SHARED_CHANNEL_TRANSFER_SUPPORTED',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 3) => {
  const p = 10 ** digits;
  return Math.round((Number(value) || 0) * p) / p;
};
const smoothstep = (edge0, edge1, value) => {
  const x = clamp((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
};

function requireInputs(reference, target, delta) {
  if (!isColorMatchSignature(reference) || !isColorMatchSignature(target) || !isColorMatchDelta(delta)) {
    throw new TypeError('Target-aware protection requires valid Reference, Target and Delta evidence.');
  }
}

function highKeyScore(signature) {
  const highlightShare = clamp(signature.tone.zoneShares?.highlight, 0, 1);
  const midtone = clamp(signature.tone.midtoneLuma, 0, 255);
  const highlight = clamp(signature.tone.highlightLuma, 0, 255);
  const whitePoint = clamp(signature.tone.whitePoint, 0, 255);
  const neutral = clamp(signature.color.neutralShare, 0, 1);
  return clamp(
    smoothstep(0.24, 0.58, highlightShare) * 0.34
      + smoothstep(150, 215, midtone) * 0.18
      + smoothstep(220, 250, highlight) * 0.18
      + smoothstep(236, 252, whitePoint) * 0.14
      + smoothstep(0.14, 0.5, neutral) * 0.16,
    0,
    1,
  );
}

function deriveNeutralWhiteProtection(reference, target, delta, options) {
  const referenceHighKey = highKeyScore(reference);
  const targetHighKey = highKeyScore(target);
  const targetNeutral = clamp(target.color.neutralShare, 0, 1);
  const highKeyMismatch = clamp(targetHighKey - referenceHighKey, 0, 1);
  const highlightCast = Math.hypot(
    Number(target.whiteBalance.zones?.highlight?.warmth) || 0,
    (Number(target.whiteBalance.zones?.highlight?.tint) || 0) * 1.15,
  );
  const rawStrength = clamp(
    targetHighKey * 0.46
      + smoothstep(0.12, 0.48, targetNeutral) * 0.34
      + highKeyMismatch * 0.42
      + smoothstep(4, 18, highlightCast) * 0.08,
    0,
    0.96,
  );
  const enabled = options.protectHighlights !== false;
  const strength = enabled ? rawStrength : rawStrength * 0.25;
  const warmingRequested = delta.whiteBalance.warmth > 0;
  const tintRequested = Math.abs(delta.whiteBalance.tint) > 1;
  return {
    active: strength >= 0.18,
    enabled,
    strength: round(strength),
    referenceHighKeyScore: round(referenceHighKey),
    targetHighKeyScore: round(targetHighKey),
    highKeyMismatch: round(highKeyMismatch),
    targetNeutralShare: round(targetNeutral, 4),
    highlightCastMagnitude: round(highlightCast, 2),
    whiteBalanceScale: round(warmingRequested ? 1 - strength * 0.62 : 1 - strength * 0.42),
    tintScale: round(tintRequested ? 1 - strength * 0.72 : 1),
    positiveExposureScale: round(1 - strength * 0.9),
    positiveHighlightScale: round(1 - strength * 0.94),
    positiveWhitesScale: round(1 - strength * 0.96),
    highlightGradingScale: round(1 - strength * 0.82),
    globalSaturationScale: round(1 - strength * 0.25),
  };
}

function hueDistanceFromSkinCentre(hue) {
  const centre = 30;
  return Math.abs((((Number(hue) || 0) - centre + 540) % 360) - 180);
}

function deriveTargetSkinProtection(reference, target, delta, options) {
  const detected = Boolean(target.skin.detected);
  if (!detected || options.preserveSkinTone === false) {
    return {
      active: false,
      targetAlreadyWarm: false,
      targetAlreadySaturated: false,
      strength: 0,
      globalWarmthScale: 1,
      globalTintScale: 1,
      skinChannelScale: 1,
      warmSaturationScale: 1,
      gradingScale: 1,
    };
  }
  const confidence = clamp(target.skin.confidence, 0, 1);
  const coverage = clamp(target.skin.coveragePct / 42, 0, 1);
  const skinHueDistance = hueDistanceFromSkinCentre(target.skin.meanHue);
  const targetAlreadyWarm = skinHueDistance <= 18 && target.skin.meanSaturation >= 30 && delta.whiteBalance.warmth > 0;
  const targetAlreadySaturated = target.skin.meanSaturation >= 46 && (
    delta.skin.saturationDelta > 0 || delta.color.channels.orange.saturationDelta > 0 || delta.color.weightedSaturation > 0
  );
  const referenceSkinComparable = Boolean(reference.skin.detected);
  const referenceDistance = referenceSkinComparable ? hueDistanceFromSkinCentre(reference.skin.meanHue) : 0;
  const naturalityRisk = clamp(
    smoothstep(34, 62, target.skin.meanSaturation) * 0.45
      + smoothstep(0, 0.7, coverage) * 0.15
      + (targetAlreadyWarm ? 0.28 : 0)
      + (targetAlreadySaturated ? 0.3 : 0)
      + smoothstep(20, 45, skinHueDistance) * 0.12,
    0,
    1,
  );
  const strength = clamp(0.36 + confidence * 0.28 + coverage * 0.16 + naturalityRisk * 0.24, 0.42, 0.94);
  return {
    active: true,
    confidence: round(confidence),
    coverageFactor: round(coverage),
    targetHue: round(target.skin.meanHue, 2),
    targetSaturation: round(target.skin.meanSaturation, 2),
    referenceSkinComparable,
    referenceHueDistance: round(referenceDistance, 2),
    targetAlreadyWarm,
    targetAlreadySaturated,
    naturalityRisk: round(naturalityRisk),
    strength: round(strength),
    globalWarmthScale: round(targetAlreadyWarm ? 1 - strength * 0.48 : 1 - strength * 0.18),
    globalTintScale: round(1 - strength * 0.12),
    skinChannelScale: round(1 - strength * 0.7),
    warmSaturationScale: round(targetAlreadySaturated ? 1 - strength * 0.82 : 1 - strength * 0.48),
    gradingScale: round(1 - strength * 0.58),
  };
}

function deriveChannelTransferability(reference, target) {
  const channels = {};
  let dampenedCount = 0;
  let sharedCount = 0;
  for (const channel of COLOR_MATCH_CHANNELS) {
    const refWeight = clamp(reference.color.channels[channel].weight, 0, 1);
    const targetWeight = clamp(target.color.channels[channel].weight, 0, 1);
    const maximum = Math.max(refWeight, targetWeight);
    const overlap = Math.min(refWeight, targetWeight);
    const overlapRatio = maximum > 0.005 ? overlap / maximum : 0;
    const distributionMismatch = Math.abs(refWeight - targetWeight);
    const bothPresent = refWeight > 0.008 && targetWeight > 0.008;
    const transferStrength = bothPresent
      ? clamp(0.16 + overlapRatio * 0.76 - distributionMismatch * 0.62, 0.12, 1)
      : 0.06;
    if (transferStrength < 0.55) dampenedCount += 1;
    if (bothPresent && overlapRatio >= 0.5) sharedCount += 1;
    channels[channel] = {
      referenceWeight: round(refWeight, 4),
      targetWeight: round(targetWeight, 4),
      overlapRatio: round(overlapRatio),
      distributionMismatch: round(distributionMismatch, 4),
      bothPresent,
      transferStrength: round(transferStrength),
    };
  }
  return { channels, dampenedCount, sharedCount };
}

export function buildTargetAwareProtection({ referenceSignature, targetSignature, delta, options = {} } = {}) {
  requireInputs(referenceSignature, targetSignature, delta);
  const neutralWhite = deriveNeutralWhiteProtection(referenceSignature, targetSignature, delta, options);
  const skin = deriveTargetSkinProtection(referenceSignature, targetSignature, delta, options);
  const sceneColor = deriveChannelTransferability(referenceSignature, targetSignature);
  const reasonCodes = [];
  if (neutralWhite.targetHighKeyScore >= 0.42) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.HIGH_KEY_TARGET_PROTECTED);
  if (neutralWhite.active) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.NEUTRAL_WHITE_PROTECTED);
  if (neutralWhite.positiveExposureScale < 0.65) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.POSITIVE_EXPOSURE_DAMPENED);
  if (neutralWhite.highlightGradingScale < 0.72) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.HIGHLIGHT_WARMTH_DAMPENED);
  if (skin.targetAlreadyWarm) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.TARGET_SKIN_ALREADY_WARM);
  if (skin.targetAlreadySaturated) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.TARGET_SKIN_SATURATION_PROTECTED);
  if (sceneColor.dampenedCount > 0) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.SCENE_OBJECT_CHANNEL_DAMPENED);
  if (sceneColor.sharedCount > 0) reasonCodes.push(TARGET_PROTECTION_REASON_CODES.SHARED_CHANNEL_TRANSFER_SUPPORTED);

  return {
    kind: TARGET_AWARE_PROTECTION_KIND,
    schemaVersion: TARGET_AWARE_PROTECTION_SCHEMA_VERSION,
    stage: '2E_O_TARGET_AWARE_PROTECTION',
    neutralWhite,
    skin,
    sceneColor,
    reasonCodes: [...new Set(reasonCodes)],
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      productionActivationAllowed: false,
    },
  };
}
