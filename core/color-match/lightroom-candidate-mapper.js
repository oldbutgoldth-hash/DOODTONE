/**
 * EPIC 2E-N3 — Bounded Lightroom Candidate Mapper
 *
 * Translates N2 semantic intents into Lightroom-compatible candidate values.
 * This is a separate Reference Color Match candidate path. It may serialize
 * an in-memory candidate XMP for fidelity testing, but cannot mutate the main
 * Production preset, activate Controlled V2, or write Production state.
 */
import { defaultCurveSet } from '../curve-engine/index.js';
import { quickSafetyClamp } from '../xmp-validator/index.js';
import { serializeXMP } from '../preset-engine/index.js';
import {
  PHOTOGRAPHIC_COMPENSATION_KIND,
  COMPENSATION_STATES,
} from './photographic-compensation-engine.js';
import { buildLightroomCompatibilityProfile } from './lightroom-compatibility-profile.js';

export const LIGHTROOM_CANDIDATE_KIND = 'LUMIXA_LIGHTROOM_COLOR_MATCH_CANDIDATE';
export const LIGHTROOM_CANDIDATE_SCHEMA_VERSION = 2;
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

function buildToneCurve(intent) {
  const span = clamp(intent.tone.tonalSpan, -18, 18);
  const contrast = clamp(intent.tone.contrast, -28, 28);
  const shadows = clamp(5 - span * 0.2 - Math.max(0, contrast) * 0.08, 2, 12);
  const mid = clamp(128 + intent.tone.exposureEv * 8, 118, 138);
  const highlights = clamp(248 + span * 0.2 + Math.max(0, contrast) * 0.08, 242, 253);
  return { crv_sh: round(shadows), crv_mid: round(mid), crv_hi: round(highlights) };
}

function buildGrading(compensation) {
  const wb = compensation.semanticIntents.whiteBalance;
  const warmHue = wb.warmth >= 0 ? 42 : 215;
  const tintHue = wb.tint >= 0 ? 115 : 315;
  const wbMagnitude = Math.hypot(wb.warmth, wb.tint);
  const neutralScale = compensation.targetProtection?.neutralWhite?.highlightGradingScale ?? 1;
  const skinScale = compensation.targetProtection?.skin?.gradingScale ?? 1;
  const sat = round(clamp(wbMagnitude * 0.22 * skinScale, 0, 12));
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
  if (adjustments.length) trace.push({ parameter: 'PRE_XMP_SAFETY', value: adjustments.length, sourceCodes: ['QUICK_SAFETY_CLAMP'], evidence: adjustments, safety: 'CLAMPED' });
  return trace;
}

export function mapCompensationToLightroomCandidate({ compensation, name = 'LUMIXA-Core-Color-Match-Candidate', targetMediaContext = null } = {}) {
  validate(compensation);
  const blocked = compensation.state === COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE;
  const intent = compensation.semanticIntents;
  const hsl = {};
  for (const channel of CHANNELS) {
    const c = intent.hsl[channel];
    hsl[`hsl_h_${channel}`] = blocked ? 0 : round(clamp(c.hue, -18, 18));
    hsl[`hsl_s_${channel}`] = blocked ? 0 : round(clamp(c.saturation, -28, 28));
    hsl[`hsl_l_${channel}`] = blocked ? 0 : round(clamp(c.luminance, -22, 22));
  }
  const curve = buildToneCurve(intent);
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
    ...curve,
    hsl,
    grade: blocked ? {
      grd_sh_h: 0, grd_sh_s: 0, grd_sh_l: 0,
      grd_mid_h: 0, grd_mid_s: 0, grd_mid_l: 0,
      grd_hi_h: 0, grd_hi_s: 0, grd_hi_l: 0,
      grd_blend: 50,
    } : buildGrading(compensation),
    cal: { cal_red_h: 0, cal_red_s: 0, cal_green_h: 0, cal_green_s: 0, cal_blue_h: 0, cal_blue_s: 0 },
    curves: defaultCurveSet(),
  };
  const targetSafety = applyTargetAwareCandidateSafety(rawPreset, compensation);
  const { preset: safePreset, adjustments: validatorAdjustments } = quickSafetyClamp(targetSafety.preset);
  const adjustments = [...targetSafety.adjustments, ...validatorAdjustments];
  const xmp = serializeXMP(safePreset);
  const compatibilityProfile = buildLightroomCompatibilityProfile(targetMediaContext || {});
  const reasonTrace = buildReasonTrace(compensation, rawPreset, safePreset, adjustments);
  const candidateState = blocked ? 'BLOCKED' : compensation.state === COMPENSATION_STATES.SAFE_IDENTITY ? 'IDENTITY_CANDIDATE' : 'MAPPED_CANDIDATE';

  return {
    kind: LIGHTROOM_CANDIDATE_KIND,
    schemaVersion: LIGHTROOM_CANDIDATE_SCHEMA_VERSION,
    stage: 'N3_LIGHTROOM_CANDIDATE_MAPPING',
    candidateState,
    analysisGenerationId: compensation.analysisGenerationId,
    rawPreset,
    safePreset,
    candidateXmp: xmp,
    candidateXmpLength: xmp.length,
    safetyAdjustments: adjustments,
    reasonTrace,
    fidelityContract: {
      previewUsesSafePreset: true,
      xmpUsesSafePreset: true,
      presetAndXmpSingleSourceOfTruth: true,
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
