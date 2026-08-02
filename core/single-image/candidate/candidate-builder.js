/**
 * EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate Builder
 *
 * Builds ONE canonical, nested Candidate from a Session's already-
 * computed `candidateRaw` (the flat `buildFinalPreset()` output,
 * already validated/benchmarked/possibly reclamped by the existing
 * P1A/P1B pipeline — see P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §2/§6)
 * plus `session.evidence` for confidence/lineage context. This is a
 * PURE reshape — it never calls buildFinalPreset, validateFinalPreset,
 * quickSafetyClamp, or any Core analysis module itself, and it never
 * changes a numerical value beyond what the existing pipeline already
 * computed (see P1C_QA_REPORT.md's pre/post equivalence report).
 */

import {
  createEmptyCandidate, validateCandidateShape, normalizeCandidate,
  CANDIDATE_STATUS, HSL_CHANNEL_IDS, GRADING_ZONE_IDS, CANDIDATE_SCHEMA_VERSION,
} from './candidate-schema.js';
import { buildParameterLineage, assembleLineageMap } from './candidate-lineage.js';
import { SINGLE_IMAGE_FULL, PROFILE_VERSION } from '../single-image-analysis-profile.js';
import { SESSION_STATUS, MODULE_STATE } from '../single-image-session.js';
import { confidenceFromRaw } from '../report/confidence-aggregator.js';

let _candidateSeq = 0;
function _nextCandidateId(sessionId) {
  _candidateSeq += 1;
  return `simg-candidate-${sessionId}-${_candidateSeq}-${Date.now().toString(36)}`;
}

// evidenceKey -> [sourceEngine, ...] built once from the real, already-
// declarative analysis profile table (single source of truth — no
// duplicated module-name list here).
const _EVIDENCE_KEY_TO_SOURCE_ENGINES = (() => {
  const m = {};
  for (const mod of SINGLE_IMAGE_FULL) {
    if (!m[mod.evidenceKey]) m[mod.evidenceKey] = [];
    m[mod.evidenceKey].push(mod.sourceEngine);
  }
  return m;
})();

const GRADE_ZONE_ABBR = { shadows: 'sh', midtones: 'mid', highlights: 'hi' };

function _sourceEnginesFor(...evidenceKeys) {
  const out = [];
  for (const k of evidenceKeys) for (const e of (_EVIDENCE_KEY_TO_SOURCE_ENGINES[k] ?? [])) if (!out.includes(e)) out.push(e);
  return out;
}

/** True only if the evidence entry actually completed (COMPLETED or CACHE_HIT). */
function _evidenceOk(evidence, key) {
  const e = evidence?.[key];
  return !!(e && (e.status === MODULE_STATE.COMPLETED || e.status === MODULE_STATE.CACHE_HIT));
}

/**
 * @param {object} session   The active Session (read-only; not mutated).
 * @param {object} opts
 * @param {string} [opts.engineVersion]  package.json version, for metadata only.
 * @returns {{candidate: object, validation: {status,errors,warnings,normalizedCandidate}}}
 */
export function buildCandidateFromSession(session, { engineVersion = null } = {}) {
  const rawPreset = session?.candidateRaw ?? null;
  const evidence = session?.evidence ?? {};

  const candidate = createEmptyCandidate({
    sessionId: session?.sessionId ?? null,
    generationId: session?.generationId ?? null,
    candidateId: _nextCandidateId(session?.sessionId ?? 'unknown'),
  });
  candidate.createdAt = Date.now();
  candidate.updatedAt = candidate.createdAt;

  const sessionStatus = session?.status ?? null;
  const isTerminalUsable = sessionStatus === SESSION_STATUS.COMPLETED || sessionStatus === SESSION_STATUS.PARTIAL;
  if (!isTerminalUsable || !rawPreset) {
    candidate.status = CANDIDATE_STATUS.EMPTY;
    candidate.diagnostics.warnings.push({ code: 'candidateRaw.missing', reason: !rawPreset ? 'no candidateRaw on session' : 'session not terminal' });
    return { candidate, validation: validateCandidateShape(candidate) };
  }

  // ── profile ─────────────────────────────────────────────────────
  candidate.profile.name = rawPreset.name ?? null;
  // treatment/processVersion are fixed — the real serializer always
  // emits Color / ProcessVersion 11.0 (core/preset-engine/index.js);
  // there is no Production path that produces Monochrome or a
  // different process version today, so nothing to read from evidence.

  // ── whiteBalance ────────────────────────────────────────────────
  candidate.whiteBalance.temperature = rawPreset.temp ?? 0;
  candidate.whiteBalance.tint = rawPreset.tint ?? 0;

  // ── basic ───────────────────────────────────────────────────────
  candidate.basic.exposure = rawPreset.exp ?? 0;
  candidate.basic.contrast = rawPreset.con ?? 0;
  candidate.basic.highlights = rawPreset.hi ?? 0;
  candidate.basic.shadows = rawPreset.sh ?? 0;
  candidate.basic.whites = rawPreset.wh ?? 0;
  candidate.basic.blacks = rawPreset.bl ?? 0;
  candidate.basic.texture = rawPreset.texture ?? 0;
  candidate.basic.clarity = rawPreset.clarity ?? 0;
  candidate.basic.dehaze = rawPreset.dehaze ?? 0;
  candidate.basic.vibrance = rawPreset.vib ?? 0;
  candidate.basic.saturation = rawPreset.sat ?? 0;

  // ── curves ──────────────────────────────────────────────────────
  const curves = rawPreset.curves ?? null;
  candidate.curves.rgb = curves?.master ?? null;
  candidate.curves.red = curves?.red ?? null;
  candidate.curves.green = curves?.green ?? null;
  candidate.curves.blue = curves?.blue ?? null;
  candidate.curves.parametric = {
    shadows: rawPreset.crv_sh ?? 0, midtones: rawPreset.crv_mid ?? 0, highlights: rawPreset.crv_hi ?? 0,
  };

  // ── hsl ─────────────────────────────────────────────────────────
  const hslRaw = rawPreset.hsl ?? {};
  for (const ch of HSL_CHANNEL_IDS) {
    candidate.hsl.hue[ch] = hslRaw[`hsl_h_${ch}`] ?? 0;
    candidate.hsl.saturation[ch] = hslRaw[`hsl_s_${ch}`] ?? 0;
    candidate.hsl.luminance[ch] = hslRaw[`hsl_l_${ch}`] ?? 0;
  }

  // ── grading ─────────────────────────────────────────────────────
  const gradeRaw = rawPreset.grade ?? {};
  for (const zone of GRADING_ZONE_IDS) {
    const abbr = GRADE_ZONE_ABBR[zone];
    candidate.grading[zone] = {
      hue: gradeRaw[`grd_${abbr}_h`] ?? 0,
      saturation: gradeRaw[`grd_${abbr}_s`] ?? 0,
      luminance: gradeRaw[`grd_${abbr}_l`] ?? 0,
    };
  }
  candidate.grading.blending = gradeRaw.grd_blend ?? 50;
  // grading.balance: no Production field exists for this — left null.

  // ── cal ─────────────────────────────────────────────────────────
  const calRaw = rawPreset.cal ?? {};
  candidate.cal.redPrimaryHue = calRaw.cal_red_h ?? 0;
  candidate.cal.redPrimarySaturation = calRaw.cal_red_s ?? 0;
  candidate.cal.greenPrimaryHue = calRaw.cal_green_h ?? 0;
  candidate.cal.greenPrimarySaturation = calRaw.cal_green_s ?? 0;
  candidate.cal.bluePrimaryHue = calRaw.cal_blue_h ?? 0;
  candidate.cal.bluePrimarySaturation = calRaw.cal_blue_s ?? 0;
  // cal.shadowTint: no Production field/slider exists — left null.

  // ── detail ──────────────────────────────────────────────────────
  candidate.detail.sharpening = rawPreset.sharp ?? 0;
  candidate.detail.noiseReduction = rawPreset.noise ?? 0;
  candidate.detail.colorNoiseReduction = 25; // fixed — hardcoded in serializeXMP itself
  // radius/detail/masking/noiseReductionDetail/colorNoiseReductionDetail/
  // colorNoiseReductionSmoothness: no Production field — left null.

  // effects / optics: entirely unsupported by the current pipeline —
  // left at their createEmptyCandidate() null defaults.

  // ── metadata ────────────────────────────────────────────────────
  candidate.metadata.sourceFilename = session?.image?.filename ?? null;
  candidate.metadata.generatedBy = 'LUMIXA AI';
  candidate.metadata.engineVersion = engineVersion;
  candidate.metadata.profileVersion = PROFILE_VERSION;

  // ── diagnostics: confidence ─────────────────────────────────────
  const featureGraphConfidence = evidence?.styleFeatureGraph?.result?.overallStyleConfidence;
  candidate.diagnostics.confidence = confidenceFromRaw(featureGraphConfidence);

  // ── diagnostics: safety clamps / warnings (from the existing
  // pipeline's OWN validation/benchmark output — never recomputed) ──
  const validationReport = rawPreset._validation ?? null;
  const benchmark = rawPreset._benchmark ?? null;
  candidate.diagnostics.safetyClamps = [
    ...((validationReport?.adjustments) ?? []),
    ...((rawPreset._reclampAdjustments) ?? []),
  ];
  candidate.diagnostics.warnings = [
    ...((validationReport?.violations) ?? []).map((v) => ({ code: 'styleFingerprintViolation', detail: v })),
    ...((benchmark?.warnings) ?? []).map((w) => ({ code: 'benchmarkWarning', detail: w })),
  ];

  // ── diagnostics: source evidence + per-parameter lineage ─────────
  candidate.diagnostics.sourceEvidence = Object.keys(evidence).filter((k) => _evidenceOk(evidence, k));

  const decisionCtx = rawPreset._decision ?? {};
  const wbConfidence = decisionCtx.wb?.confidence != null ? confidenceFromRaw(decisionCtx.wb.confidence).score : null;

  const lineageEntries = [];
  const _basicLineage = (field, key) => lineageEntries.push(buildParameterLineage({
    parameterPath: `basic.${field}`, evidenceKeys: ['stats', 'basic'], sourceModules: _sourceEnginesFor('stats', 'basic'),
    rawRecommendation: candidate.basic[field], autoValue: candidate.basic[field], currentValue: candidate.basic[field],
    confidence: candidate.diagnostics.confidence.score,
  }));
  ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'].forEach((f) => _basicLineage(f));

  lineageEntries.push(buildParameterLineage({
    parameterPath: 'whiteBalance.temperature', evidenceKeys: ['wb', 'colorCast'], sourceModules: _sourceEnginesFor('wb', 'colorCast'),
    rawRecommendation: candidate.whiteBalance.temperature, autoValue: candidate.whiteBalance.temperature, currentValue: candidate.whiteBalance.temperature,
    confidence: wbConfidence,
  }));
  lineageEntries.push(buildParameterLineage({
    parameterPath: 'whiteBalance.tint', evidenceKeys: ['wb', 'colorCast'], sourceModules: _sourceEnginesFor('wb', 'colorCast'),
    rawRecommendation: candidate.whiteBalance.tint, autoValue: candidate.whiteBalance.tint, currentValue: candidate.whiteBalance.tint,
    confidence: wbConfidence,
  }));

  for (const ch of HSL_CHANNEL_IDS) {
    for (const dim of ['hue', 'saturation', 'luminance']) {
      const v = candidate.hsl[dim][ch];
      lineageEntries.push(buildParameterLineage({
        parameterPath: `hsl.${dim}.${ch}`, evidenceKeys: ['hsl'], sourceModules: _sourceEnginesFor('hsl'),
        rawRecommendation: v, autoValue: v, currentValue: v, confidence: candidate.diagnostics.confidence.score,
      }));
    }
  }
  for (const zone of GRADING_ZONE_IDS) {
    for (const dim of ['hue', 'saturation', 'luminance']) {
      const v = candidate.grading[zone][dim];
      lineageEntries.push(buildParameterLineage({
        parameterPath: `grading.${zone}.${dim}`, evidenceKeys: ['grading'], sourceModules: _sourceEnginesFor('grading'),
        rawRecommendation: v, autoValue: v, currentValue: v, confidence: candidate.diagnostics.confidence.score,
      }));
    }
  }
  for (const prim of ['red', 'green', 'blue']) {
    for (const dim of ['Hue', 'Saturation']) {
      const path = `cal.${prim}Primary${dim}`;
      const v = candidate.cal[`${prim}Primary${dim}`];
      lineageEntries.push(buildParameterLineage({
        parameterPath: path, evidenceKeys: ['calibration'], sourceModules: _sourceEnginesFor('calibration'),
        rawRecommendation: v, autoValue: v, currentValue: v, confidence: candidate.diagnostics.confidence.score,
      }));
    }
  }
  candidate.diagnostics.lineage = assembleLineageMap(lineageEntries);

  // ── auto-values snapshot (for Reset-to-Auto) ─────────────────────
  candidate.diagnostics.autoValues = {
    whiteBalance: { ...candidate.whiteBalance },
    basic: { ...candidate.basic },
    curves: { ...candidate.curves, parametric: { ...candidate.curves.parametric } },
    hsl: {
      hue: { ...candidate.hsl.hue }, saturation: { ...candidate.hsl.saturation }, luminance: { ...candidate.hsl.luminance },
    },
    grading: {
      shadows: { ...candidate.grading.shadows }, midtones: { ...candidate.grading.midtones }, highlights: { ...candidate.grading.highlights },
      blending: candidate.grading.blending, balance: candidate.grading.balance,
    },
    cal: { ...candidate.cal },
    detail: { ...candidate.detail },
  };

  normalizeCandidate(candidate);
  candidate.status = CANDIDATE_STATUS.AUTO_GENERATED;

  const validation = validateCandidateShape(candidate);
  if (validation.errors.length > 0) candidate.status = CANDIDATE_STATUS.FAILED;

  return { candidate, validation };
}
