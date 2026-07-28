/**
 * EPIC 2E-N1 — Signature Delta Engine
 *
 * Compares a REFERENCE signature with a TARGET signature. The result is a
 * semantic match requirement, not Lightroom values. N2 will translate this
 * bounded evidence into parameter recommendations after separate safety and
 * photographic compensation policies are verified.
 */
import {
  COLOR_MATCH_CHANNELS,
  COLOR_MATCH_DELTA_KIND,
  COLOR_MATCH_DELTA_SCHEMA_VERSION,
  COLOR_MATCH_MATCH_STATES,
  COLOR_MATCH_REASON_CODES,
  COLOR_MATCH_RISK_CODES,
  isColorMatchSignature,
} from './signature-schema.js';

const round = (value, digits = 3) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const diff = (reference, target) => round((Number(reference) || 0) - (Number(target) || 0), 3);

export function circularHueDifference(referenceHue, targetHue) {
  const a = ((Number(referenceHue) % 360) + 360) % 360;
  const b = ((Number(targetHue) % 360) + 360) % 360;
  return round(((a - b + 540) % 360) - 180, 3);
}

function requireSignature(value, role) {
  if (!isColorMatchSignature(value) || value.role !== role) {
    throw new TypeError(`Expected a valid ${role} color-match signature.`);
  }
}

function buildChannelDelta(reference, target) {
  const channels = {};
  let paletteDistanceSquared = 0;
  for (const channel of COLOR_MATCH_CHANNELS) {
    const ref = reference.color.channels[channel];
    const tgt = target.color.channels[channel];
    const weightDelta = diff(ref.weight, tgt.weight);
    const saturationDelta = diff(ref.meanSaturation, tgt.meanSaturation);
    const luminanceDelta = diff(ref.meanLuminance, tgt.meanLuminance);
    const hueDelta = ref.weight > 0.005 && tgt.weight > 0.005
      ? circularHueDifference(ref.meanHue, tgt.meanHue)
      : 0;
    channels[channel] = { weightDelta, hueDelta, saturationDelta, luminanceDelta };
    paletteDistanceSquared += (weightDelta * 100) ** 2 * 0.45;
    paletteDistanceSquared += saturationDelta ** 2 * 0.25;
    paletteDistanceSquared += luminanceDelta ** 2 * 0.15;
    paletteDistanceSquared += hueDelta ** 2 * 0.15;
  }
  return { channels, paletteDistance: round(Math.sqrt(paletteDistanceSquared) / 8, 3) };
}

function buildReasonCodes(delta) {
  const reasons = [];
  if (delta.whiteBalance.warmth > 2) reasons.push(COLOR_MATCH_REASON_CODES.WB_REFERENCE_WARMER);
  else if (delta.whiteBalance.warmth < -2) reasons.push(COLOR_MATCH_REASON_CODES.WB_REFERENCE_COOLER);
  if (delta.whiteBalance.tint > 2) reasons.push(COLOR_MATCH_REASON_CODES.TINT_REFERENCE_GREENER);
  else if (delta.whiteBalance.tint < -2) reasons.push(COLOR_MATCH_REASON_CODES.TINT_REFERENCE_MORE_MAGENTA);
  if (delta.tone.midtoneLuma > 3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_HIGHER_KEY);
  else if (delta.tone.midtoneLuma < -3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_LOWER_KEY);
  if (delta.tone.contrast > 3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_MORE_CONTRAST);
  else if (delta.tone.contrast < -3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_SOFTER_CONTRAST);
  if (delta.color.weightedSaturation > 3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_MORE_SATURATED);
  else if (delta.color.weightedSaturation < -3) reasons.push(COLOR_MATCH_REASON_CODES.REFERENCE_MORE_MUTED);
  if (delta.color.paletteDistance > 2.5) reasons.push(COLOR_MATCH_REASON_CODES.PALETTE_DISTRIBUTION_DIFFERS);
  if (!reasons.length) reasons.push(COLOR_MATCH_REASON_CODES.SIGNATURES_ALREADY_CLOSE);
  return reasons;
}

function buildRiskCodes(reference, target, delta) {
  const risks = [];
  if (reference.evidence.confidence < 0.55) risks.push(COLOR_MATCH_RISK_CODES.REFERENCE_EVIDENCE_LOW);
  if (target.evidence.confidence < 0.55) risks.push(COLOR_MATCH_RISK_CODES.TARGET_EVIDENCE_LOW);
  if (target.captureRisk.clipHiPct > 1 || delta.tone.highlightLuma > 18) risks.push(COLOR_MATCH_RISK_CODES.HIGHLIGHT_CLIP_RISK);
  if (target.captureRisk.clipLoPct > 1 || delta.tone.shadowLuma < -18) risks.push(COLOR_MATCH_RISK_CODES.SHADOW_CLIP_RISK);
  if (target.skin.detected) risks.push(COLOR_MATCH_RISK_CODES.SKIN_PROTECTION_REQUIRED);
  if (Math.abs(delta.whiteBalance.warmth) > 25 || Math.abs(delta.whiteBalance.tint) > 18) risks.push(COLOR_MATCH_RISK_CODES.LARGE_WHITE_BALANCE_SHIFT);
  if (Math.abs(delta.tone.midtoneLuma) > 30 || Math.abs(delta.tone.contrast) > 25) risks.push(COLOR_MATCH_RISK_CODES.LARGE_TONE_SHIFT);
  if (reference.color.totalWeight < 0.75 || target.color.totalWeight < 0.75) risks.push(COLOR_MATCH_RISK_CODES.PALETTE_COVERAGE_LOW);
  return [...new Set(risks)];
}

function deriveMatchNeed(delta) {
  const wb = Math.hypot(delta.whiteBalance.warmth * 0.8, delta.whiteBalance.tint * 1.1);
  const tone = Math.hypot(
    delta.tone.shadowLuma * 0.25,
    delta.tone.midtoneLuma * 0.35,
    delta.tone.highlightLuma * 0.25,
    delta.tone.contrast * 0.5,
  );
  const color = Math.hypot(delta.color.weightedSaturation * 0.5, delta.color.paletteDistance * 1.6);
  return round(clamp(wb * 0.35 + tone * 0.35 + color * 0.3, 0, 100), 2);
}

export function compareColorMatchSignatures({ referenceSignature, targetSignature } = {}) {
  requireSignature(referenceSignature, 'REFERENCE');
  requireSignature(targetSignature, 'TARGET');

  const channelDelta = buildChannelDelta(referenceSignature, targetSignature);
  const delta = {
    kind: COLOR_MATCH_DELTA_KIND,
    schemaVersion: COLOR_MATCH_DELTA_SCHEMA_VERSION,
    stage: 'SIGNATURE_COMPARISON_ONLY',
    whiteBalance: {
      warmth: diff(referenceSignature.whiteBalance.warmth, targetSignature.whiteBalance.warmth),
      tint: diff(referenceSignature.whiteBalance.tint, targetSignature.whiteBalance.tint),
      zones: {
        shadow: {
          warmth: diff(referenceSignature.whiteBalance.zones.shadow.warmth, targetSignature.whiteBalance.zones.shadow.warmth),
          tint: diff(referenceSignature.whiteBalance.zones.shadow.tint, targetSignature.whiteBalance.zones.shadow.tint),
        },
        midtone: {
          warmth: diff(referenceSignature.whiteBalance.zones.midtone.warmth, targetSignature.whiteBalance.zones.midtone.warmth),
          tint: diff(referenceSignature.whiteBalance.zones.midtone.tint, targetSignature.whiteBalance.zones.midtone.tint),
        },
        highlight: {
          warmth: diff(referenceSignature.whiteBalance.zones.highlight.warmth, targetSignature.whiteBalance.zones.highlight.warmth),
          tint: diff(referenceSignature.whiteBalance.zones.highlight.tint, targetSignature.whiteBalance.zones.highlight.tint),
        },
      },
    },
    tone: {
      shadowLuma: diff(referenceSignature.tone.shadowLuma, targetSignature.tone.shadowLuma),
      midtoneLuma: diff(referenceSignature.tone.midtoneLuma, targetSignature.tone.midtoneLuma),
      highlightLuma: diff(referenceSignature.tone.highlightLuma, targetSignature.tone.highlightLuma),
      tonalSpan: diff(referenceSignature.tone.tonalSpan, targetSignature.tone.tonalSpan),
      contrast: diff(referenceSignature.tone.contrast, targetSignature.tone.contrast),
      blackPoint: diff(referenceSignature.tone.blackPoint, targetSignature.tone.blackPoint),
      whitePoint: diff(referenceSignature.tone.whitePoint, targetSignature.tone.whitePoint),
    },
    color: {
      weightedSaturation: diff(referenceSignature.color.weightedSaturation, targetSignature.color.weightedSaturation),
      weightedLuminance: diff(referenceSignature.color.weightedLuminance, targetSignature.color.weightedLuminance),
      neutralShare: diff(referenceSignature.color.neutralShare, targetSignature.color.neutralShare),
      paletteDistance: channelDelta.paletteDistance,
      channels: channelDelta.channels,
    },
    skin: {
      targetDetected: targetSignature.skin.detected,
      referenceDetected: referenceSignature.skin.detected,
      hueDelta: referenceSignature.skin.detected && targetSignature.skin.detected
        ? circularHueDifference(referenceSignature.skin.meanHue, targetSignature.skin.meanHue)
        : 0,
      saturationDelta: referenceSignature.skin.detected && targetSignature.skin.detected
        ? diff(referenceSignature.skin.meanSaturation, targetSignature.skin.meanSaturation)
        : 0,
      luminanceDelta: referenceSignature.skin.detected && targetSignature.skin.detected
        ? diff(referenceSignature.skin.meanLuminance, targetSignature.skin.meanLuminance)
        : 0,
    },
    evidence: {
      referenceConfidence: referenceSignature.evidence.confidence,
      targetConfidence: targetSignature.evidence.confidence,
      combinedConfidence: round(Math.min(referenceSignature.evidence.confidence, targetSignature.evidence.confidence), 3),
    },
  };

  delta.matchNeedScore = deriveMatchNeed(delta);
  delta.reasonCodes = buildReasonCodes(delta);
  delta.riskCodes = buildRiskCodes(referenceSignature, targetSignature, delta);
  if (delta.evidence.combinedConfidence < 0.45) delta.matchState = COLOR_MATCH_MATCH_STATES.INSUFFICIENT_EVIDENCE;
  else if (delta.matchNeedScore < 5) delta.matchState = COLOR_MATCH_MATCH_STATES.ALREADY_CLOSE;
  else if (delta.matchNeedScore >= 28 || delta.riskCodes.includes(COLOR_MATCH_RISK_CODES.LARGE_WHITE_BALANCE_SHIFT) || delta.riskCodes.includes(COLOR_MATCH_RISK_CODES.LARGE_TONE_SHIFT)) {
    delta.matchState = COLOR_MATCH_MATCH_STATES.LARGE_ADJUSTMENT_REVIEW_REQUIRED;
  } else delta.matchState = COLOR_MATCH_MATCH_STATES.MATCH_ADJUSTMENT_NEEDED;

  delta.production = {
    productionSource: 'legacy',
    productionWrite: false,
    xmpWriteAllowed: false,
    lightroomMappingAllowed: false,
  };
  return delta;
}
