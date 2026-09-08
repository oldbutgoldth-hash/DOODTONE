/**
 * EPIC 2E-N3 — Bounded Lightroom Candidate Mapper
 *
 * Translates N2 semantic intents into Lightroom-compatible candidate values.
 * This is a separate Reference Color Match candidate path. It may serialize
 * an in-memory candidate XMP for fidelity testing, but cannot mutate the main
 * Production preset, activate Controlled V2, or write Production state.
 */
import { quickSafetyClamp } from '../xmp-validator/index.js';
import { serializeCandidateXMP, verifyCandidateXmpReadback } from './candidate-xmp-codec.js';
import { evaluateColorMatchDirection } from './color-match-direction-gate.js';
import { buildXmpDataLineage } from './xmp-data-lineage.js';
import {
  PHOTOGRAPHIC_COMPENSATION_KIND,
  COMPENSATION_STATES,
} from './photographic-compensation-engine.js';
import { buildLightroomCompatibilityProfile } from './lightroom-compatibility-profile.js';
import { applyUnifiedFusionToPreset } from './unified-core-fusion-orchestrator.js';

export const LIGHTROOM_CANDIDATE_KIND = 'LUMIXA_LIGHTROOM_COLOR_MATCH_CANDIDATE';
export const LIGHTROOM_CANDIDATE_SCHEMA_VERSION = 4;
const CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const round = (value, digits = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function validate(compensation) {
  if (!compensation || compensation.kind !== PHOTOGRAPHIC_COMPENSATION_KIND) {
    throw new TypeError('N3 requires a valid N2 photographic compensation result.');
  }
}

function monotonicCurve(points) {
  const sorted = points.map(p => ({ x: round(clamp(p.x, 0, 255)), y: round(clamp(p.y, 0, 255)) }));
  for (let i = 1; i < sorted.length; i += 1) sorted[i].y = Math.max(sorted[i - 1].y, sorted[i].y);
  return sorted;
}

function buildToneCurves(intent) {
  const t = intent.tone;
  const exposureLift = clamp(t.exposureEv * 18, -24, 24);
  const contrast = clamp(t.contrast, -28, 28);
  const master = monotonicCurve([
    { x: 0, y: clamp(t.blacks * 0.28, 0, 18) },
    { x: 48, y: 48 + t.shadows * 0.28 - contrast * 0.10 },
    { x: 128, y: 128 + exposureLift },
    { x: 208, y: 208 + t.highlights * 0.20 + contrast * 0.10 },
    { x: 255, y: 255 + Math.min(0, t.whites * 0.18) },
  ]);
  const warmth = clamp(intent.whiteBalance.warmth, -45, 45);
  const tint = clamp(intent.whiteBalance.tint, -30, 30);
  const redMid = clamp(warmth * 0.18 - tint * 0.06, -8, 8);
  const greenMid = clamp(tint * 0.10, -6, 6);
  const blueMid = clamp(-warmth * 0.18 - tint * 0.04, -8, 8);
  const channel = mid => monotonicCurve([{ x: 0, y: 0 }, { x: 128, y: 128 + mid }, { x: 255, y: 255 }]);
  return { master, red: channel(redMid), green: channel(greenMid), blue: channel(blueMid) };
}


function validCurveSet(curves) {
  return ['master', 'red', 'green', 'blue'].every(ch => Array.isArray(curves?.[ch]) && curves[ch].length >= 2);
}
function blendCurveToIdentity(points, scale = 1) {
  const factor = clamp(scale, 0, 1);
  return monotonicCurve((points || []).map(p => ({ x: p.x, y: p.x + (p.y - p.x) * factor })));
}
function protectPixelTransferCurves(curves, compensation) {
  if (!validCurveSet(curves)) return curves;
  const neutral = compensation.targetProtection?.neutralWhite;
  const matchNeed = Number(compensation.evidence?.matchNeedScore) || 0;
  // CDF matching is powerful; scale it by actual pairwise need and target
  // protection so a high-key wedding target cannot be crushed to mimic a
  // low-key Reference distribution.
  let baseScale = clamp(matchNeed / 24, 0.32, 0.78);
  if (neutral?.active) baseScale *= clamp(1 - neutral.strength * 0.42, 0.48, 1);
  const master = curves.master.map(p => {
    const highWeight = clamp((p.x - 150) / 105, 0, 1);
    const shadowWeight = clamp((95 - p.x) / 95, 0, 1);
    const endpointProtection = 1 - Math.max(highWeight, shadowWeight) * (neutral?.active ? 0.25 : 0.12);
    return { x: p.x, y: p.x + (p.y - p.x) * baseScale * endpointProtection };
  });
  const channelScale = clamp(baseScale * 0.55, 0.18, 0.52);
  return {
    master: monotonicCurve(master),
    red: blendCurveToIdentity(curves.red, channelScale),
    green: blendCurveToIdentity(curves.green, channelScale),
    blue: blendCurveToIdentity(curves.blue, channelScale),
  };
}
function mergeHslIntent(semantic, gaussian) {
  if (!gaussian || (gaussian.confidence || 0) < 0.08) return semantic;
  const confidence = clamp(gaussian.confidence, 0, 1);
  const pixelWeight = 0.35 + confidence * 0.35;
  const semanticWeight = 1 - pixelWeight;
  return {
    hue: semantic.hue * semanticWeight + gaussian.hue * pixelWeight,
    saturation: semantic.saturation * semanticWeight + gaussian.saturation * pixelWeight,
    luminance: semantic.luminance * semanticWeight + gaussian.luminance * pixelWeight,
    source: 'SEMANTIC_PLUS_GAUSSIAN_PALETTE',
    gaussianConfidence: confidence,
  };
}

function buildCalibration(compensation) {
  const h = compensation.semanticIntents.hsl;
  return {
    cal_red_h: round(clamp(-((h.red?.hue || 0) + (h.orange?.hue || 0)) * 0.16, -8, 8)),
    cal_red_s: round(clamp(((h.red?.saturation || 0) + (h.orange?.saturation || 0)) * 0.09, -6, 6)),
    cal_green_h: round(clamp(((h.green?.hue || 0) - (h.aqua?.hue || 0)) * 0.12, -8, 8)),
    cal_green_s: round(clamp((h.green?.saturation || 0) * 0.08, -6, 6)),
    cal_blue_h: round(clamp(((h.blue?.hue || 0) + (h.aqua?.hue || 0)) * 0.12, -8, 8)),
    cal_blue_s: round(clamp(((h.blue?.saturation || 0) + (h.aqua?.saturation || 0)) * 0.07, -6, 6)),
  };
}

function buildGrading(compensation) {
  const wb = compensation.semanticIntents.whiteBalance;
  const warmHue = wb.warmth >= 0 ? 42 : 215;
  const tintHue = wb.tint >= 0 ? 115 : 315;
  const wbMagnitude = Math.hypot(wb.warmth, wb.tint);
  const neutralScale = compensation.targetProtection?.neutralWhite?.highlightGradingScale ?? 1;
  const skinScale = compensation.targetProtection?.skin?.gradingScale ?? 1;
  const rawSat = wbMagnitude * 0.34 * skinScale;
  const minimumVisibleGrade = wbMagnitude >= 4 ? (compensation.targetProtection?.skin?.targetAlreadySaturated ? 1 : 2) : 0;
  const sat = round(clamp(Math.max(rawSat, minimumVisibleGrade), 0, 12));
  return {
    grd_sh_h: wb.warmth >= 0 ? 215 : warmHue,
    grd_sh_s: round(sat * 0.55),
    grd_sh_l: 0,
    grd_mid_h: wb.tint !== 0 ? tintHue : warmHue,
    grd_mid_s: round(sat * 0.45),
    grd_mid_l: 0,
    grd_hi_h: warmHue,
    grd_hi_s: round(sat * 0.7 * neutralScale),
    grd_hi_l: 0,
    grd_blend: 50,
  };
}


function applyTargetAwareCandidateSafety(rawPreset, compensation) {
  const preset = JSON.parse(JSON.stringify(rawPreset));
  const adjustments = [];
  const neutral = compensation.targetProtection?.neutralWhite;
  const skin = compensation.targetProtection?.skin;
  if (neutral?.active) {
    const capPositive = (key, cap, label) => {
      if ((preset[key] || 0) > cap) {
        adjustments.push(`${label} ${preset[key]} capped to ${cap} by high-key/neutral-white protection.`);
        preset[key] = cap;
      }
    };
    const highKeyCap = Math.max(0, Math.round(12 * (1 - neutral.strength)));
    capPositive('exp', highKeyCap, 'Exposure');
    capPositive('hi', Math.max(0, Math.round(8 * (1 - neutral.strength))), 'Highlights');
    capPositive('wh', Math.max(0, Math.round(6 * (1 - neutral.strength))), 'Whites');
    if (preset.temp > 0) {
      const tempCap = Math.max(4, Math.round(20 * (1 - neutral.strength * 0.72)));
      capPositive('temp', tempCap, 'Temperature');
    }
    const tintCap = Math.max(4, Math.round(15 * (1 - neutral.strength * 0.65)));
    if (Math.abs(preset.tint) > tintCap) {
      adjustments.push(`Tint ${preset.tint} capped to ±${tintCap} by neutral-white protection.`);
      preset.tint = Math.sign(preset.tint) * tintCap;
    }
  }
  if (skin?.active) {
    if (skin.targetAlreadyWarm && preset.temp > 10) {
      adjustments.push(`Temperature ${preset.temp} capped to +10 because target skin is already warm.`);
      preset.temp = 10;
    }
    if (skin.targetAlreadySaturated) {
      for (const channel of ['red', 'orange', 'yellow']) {
        const key = `hsl_s_${channel}`;
        if ((preset.hsl[key] || 0) > 5) {
          adjustments.push(`HSL ${channel} saturation ${preset.hsl[key]} capped to +5 by target-skin protection.`);
          preset.hsl[key] = 5;
        }
      }
      if (preset.vib > 8) { adjustments.push(`Vibrance ${preset.vib} capped to +8 by target-skin protection.`); preset.vib = 8; }
      if (preset.sat > 4) { adjustments.push(`Saturation ${preset.sat} capped to +4 by target-skin protection.`); preset.sat = 4; }
    }
  }
  return { preset, adjustments };
}
function buildReasonTrace(compensation, rawPreset, safePreset, adjustments) {
  const trace = [];
  const push = (parameter, value, sourceCodes, evidence, safety = null) => trace.push({
    parameter,
    value,
    sourceCodes,
    evidence,
    safety,
  });
  push('Temperature', safePreset.temp, compensation.reasonCodes, {
    semanticWarmth: compensation.semanticIntents.whiteBalance.warmth,
    illuminantConfidence: compensation.illuminant.illuminantConfidence,
    objectBiasScore: compensation.objectColorBias.score,
  });
  push('Tint', safePreset.tint, compensation.reasonCodes, {
    semanticTint: compensation.semanticIntents.whiteBalance.tint,
    zoneConsistency: compensation.illuminant.zoneConsistency,
  });
  for (const [parameter, key] of [
    ['Exposure', 'exp'], ['Contrast', 'con'], ['Highlights', 'hi'], ['Shadows', 'sh'], ['Whites', 'wh'], ['Blacks', 'bl'],
    ['Clarity', 'clarity'], ['Dehaze', 'dehaze'], ['Texture', 'texture'], ['Vibrance', 'vib'], ['Saturation', 'sat'],
  ]) {
    push(parameter, safePreset[key], compensation.reasonCodes, {
      n2Intent: rawPreset[key],
      highlightRisk: compensation.dynamicRange.highlightRisk,
      shadowRisk: compensation.dynamicRange.shadowRisk,
    });
  }
  for (const channel of CHANNELS) {
    push(`HSL.${channel}`, {
      hue: safePreset.hsl[`hsl_h_${channel}`],
      saturation: safePreset.hsl[`hsl_s_${channel}`],
      luminance: safePreset.hsl[`hsl_l_${channel}`],
    }, compensation.skinProtection.active && ['red', 'orange', 'yellow'].includes(channel)
      ? ['SKIN_PROTECTION_APPLIED'] : compensation.reasonCodes,
    compensation.semanticIntents.hsl[channel]);
  }
  push('ToneCurves', safePreset.curves, ['PERCEPTUAL_TONE_HISTOGRAM_TRANSFER'], {
    curveSource: safePreset.transferDiagnostics?.curveSource || rawPreset.transferDiagnostics?.curveSource || 'SEMANTIC_FALLBACK',
    curveMagnitude: rawPreset.transferDiagnostics?.curveMagnitude || 0,
  });
  if (adjustments.length) trace.push({ parameter: 'PRE_XMP_SAFETY', value: adjustments.length, sourceCodes: ['QUICK_SAFETY_CLAMP'], evidence: adjustments, safety: 'CLAMPED' });
  return trace;
}

export function mapCompensationToLightroomCandidate({ compensation, name = 'LUMIXA-Core-Color-Match-Candidate', targetMediaContext = null, pixelTransfer = null, gaussianHsl = null, unifiedFusion = null } = {}) {
  validate(compensation);
  const blocked = compensation.state === COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE;
  const intent = compensation.semanticIntents;
  const hsl = {};
  const hslTransferTrace = {};
  for (const channel of CHANNELS) {
    const c = mergeHslIntent(intent.hsl[channel], gaussianHsl?.channels?.[channel]);
    hsl[`hsl_h_${channel}`] = blocked ? 0 : round(clamp(c.hue, -18, 18));
    hsl[`hsl_s_${channel}`] = blocked ? 0 : round(clamp(c.saturation, -28, 28));
    hsl[`hsl_l_${channel}`] = blocked ? 0 : round(clamp(c.luminance, -22, 22));
    hslTransferTrace[channel] = c;
  }
  const curves = protectPixelTransferCurves(
    validCurveSet(pixelTransfer?.curves) ? pixelTransfer.curves : buildToneCurves(intent),
    compensation,
  );
  const rawPreset = {
    name,
    exp: blocked ? 0 : round(clamp(intent.tone.exposureEv * 100, -135, 135)),
    con: blocked ? 0 : round(intent.tone.contrast),
    hi: blocked ? 0 : round(intent.tone.highlights),
    sh: blocked ? 0 : round(intent.tone.shadows),
    wh: blocked ? 0 : round(intent.tone.whites),
    bl: blocked ? 0 : round(intent.tone.blacks),
    clarity: blocked ? 0 : round(intent.presence.clarity),
    dehaze: blocked ? 0 : round(intent.presence.dehaze),
    texture: blocked ? 0 : round(intent.presence.texture),
    temp: blocked ? 0 : round(clamp(intent.whiteBalance.warmth, -45, 45)),
    tint: blocked ? 0 : round(clamp(-intent.whiteBalance.tint, -30, 30)),
    vib: blocked ? 0 : round(intent.presence.vibrance),
    sat: blocked ? 0 : round(intent.presence.saturation),
    sharp: 0,
    noise: 0,
    crv_sh: 0, crv_mid: 0, crv_hi: 0,
    hsl,
    grade: blocked ? {
      grd_sh_h: 0, grd_sh_s: 0, grd_sh_l: 0,
      grd_mid_h: 0, grd_mid_s: 0, grd_mid_l: 0,
      grd_hi_h: 0, grd_hi_s: 0, grd_hi_l: 0,
      grd_blend: 50,
    } : buildGrading(compensation),
    cal: blocked ? { cal_red_h: 0, cal_red_s: 0, cal_green_h: 0, cal_green_s: 0, cal_blue_h: 0, cal_blue_s: 0 } : buildCalibration(compensation),
    curves,
    transferDiagnostics: {
      curveSource: validCurveSet(pixelTransfer?.curves) ? 'PERCEPTUAL_CDF_TONE_MERGE' : 'SEMANTIC_FALLBACK',
      curveMagnitude: pixelTransfer?.curveMagnitude ?? 0,
      gaussianHslConfidence: gaussianHsl?.confidence ?? 0,
      gaussianSupportedChannelCount: gaussianHsl?.supportedChannelCount ?? 0,
      hslTransferTrace,
    },
  };
  const fusedPreset = applyUnifiedFusionToPreset(rawPreset, unifiedFusion);
  const targetSafety = applyTargetAwareCandidateSafety(fusedPreset, compensation);
  const { preset: safePreset, adjustments: validatorAdjustments } = quickSafetyClamp(targetSafety.preset);
  const adjustments = [...targetSafety.adjustments, ...validatorAdjustments];
  const codecResult = serializeCandidateXMP({ preset: safePreset, targetMediaContext, candidateName: name });
  const readback = verifyCandidateXmpReadback({ preset: safePreset, codecResult });
  const directionGate = evaluateColorMatchDirection({
    analysis: compensation.analysis,
    compensation,
    preset: safePreset,
    wbContext: codecResult.wb,
  });
  const dataLineage = buildXmpDataLineage({ analysis: compensation.analysis, compensation, rawPreset, safePreset, codecResult, readback, directionGate, safetyAdjustments: adjustments });
  const compatibilityProfile = buildLightroomCompatibilityProfile(targetMediaContext || {});
  const reasonTrace = buildReasonTrace(compensation, rawPreset, safePreset, adjustments);
  let candidateState = blocked ? 'BLOCKED' : compensation.state === COMPENSATION_STATES.SAFE_IDENTITY ? 'IDENTITY_CANDIDATE' : 'MAPPED_CANDIDATE';
  if (!blocked && unifiedFusion?.gate?.decision === 'FAIL') candidateState = unifiedFusion.gate.code;
  else if (!blocked && readback.decision !== 'PASS') candidateState = 'XMP_PARAMETER_PIPELINE_MISMATCH';
  else if (!blocked && directionGate.decision !== 'PASS') candidateState = directionGate.code;
  const exportReady = ['MAPPED_CANDIDATE', 'IDENTITY_CANDIDATE'].includes(candidateState) && codecResult.wb.exportReady && readback.decision === 'PASS' && directionGate.decision === 'PASS';

  return {
    kind: LIGHTROOM_CANDIDATE_KIND,
    schemaVersion: LIGHTROOM_CANDIDATE_SCHEMA_VERSION,
    stage: 'N3_LIGHTROOM_CANDIDATE_MAPPING',
    candidateState,
    analysisGenerationId: compensation.analysisGenerationId,
    rawPreset,
    fusedPreset,
    safePreset,
    candidateXmp: exportReady ? codecResult.xmp : null,
    candidateXmpLength: exportReady ? codecResult.xmp.length : 0,
    exportReady,
    serializerPreset: safePreset,
    xmpCodec: codecResult,
    xmpReadback: readback,
    directionGate,
    dataLineage,
    safetyAdjustments: adjustments,
    transferEvidence: { pixelTransfer, gaussianHsl, hslTransferTrace },
    unifiedCoreFusion: unifiedFusion,
    reasonTrace,
    fidelityContract: {
      previewUsesSafePreset: true,
      xmpUsesSafePreset: true,
      presetAndXmpSingleSourceOfTruth: readback.decision === 'PASS',
      structuralReadbackVerified: readback.decision === 'PASS',
      directionGatePassed: directionGate.decision === 'PASS',
      browserPreviewIsAdobeRawRender: false,
      lightroomRoundTripRequired: true,
    },
    compatibilityProfile,
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      candidateXmpInMemoryOnly: true,
      controlledV2Apply: false,
    },
  };
}
