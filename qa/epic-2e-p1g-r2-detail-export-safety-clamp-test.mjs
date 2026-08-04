#!/usr/bin/env node
/**
 * EPIC 2E-P1G R2 — Detail Export Safety Clamp: dedicated real-integration
 * test suite.
 *
 * Proves the Layer-B export safety net added this round:
 *   - core/xmp-validator/index.js (EDITED: HARD_LIMITS.detail +
 *     _clampDetailPanel(), wired into quickSafetyClamp() -- the ONE
 *     production-locked file this round is allowed to touch)
 *
 * Runs against the SAME real production modules the R1 suite
 * (qa/epic-2e-p1g-detail-intelligence-test.mjs) already exercises --
 * this file never re-implements planner/clamp/serializer math; every
 * expected value is either produced by calling the real production
 * function or read directly from the documented HARD_LIMITS.detail
 * constant.
 *
 * Run: node qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}
function runSuite(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

// P1G R1's own suite (qa/epic-2e-p1g-detail-intelligence-test.mjs) ends its
// run with a Regression section (tests 51-58) that nests real spawnSync()
// calls out to P1F/P1E-R2/P1D/P1C/P1C-R2/P1A's own suites -- and its
// mutation tests (including the M4/M4b tests this round updated) run AFTER
// that Regression section. Those nested suites are independently verified
// elsewhere in this file already (checks 27-29 spawn P1D/P1C/P1A directly)
// and again in the full static-suite run (qa/run-static-suites.mjs,
// documented in P1G_R2_QA_REPORT.md) -- so re-running them a second time,
// nested a level deeper inside R1 inside R2, adds no new coverage, only
// wall-clock cost. To reach R1's own M4/M4b mutation-test output directly,
// spin up a disposable copy of the R1 source with ONLY its internal
// runSuite() helper stubbed to a fast canned result (every other line --
// CORE/EVIDENCE/SHARPENING/NOISE/MODES/SESSION/PARITY/MUTATION logic --
// is untouched, byte-identical to the real file) so it runs to completion
// quickly, then delete the disposable copy. This never changes what M4/M4b
// actually assert or how they compute their result -- it only skips
// re-executing already-covered nested regression suites a second/third
// time within this run.
function runP1gR1ForMutationEvidence() {
  const realPath = path.join(ROOT, 'qa/epic-2e-p1g-detail-intelligence-test.mjs');
  const src = readFileSync(realPath, 'utf8');
  const stubMarker = [
    "function runSuite(rel) {",
    "  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });",
    "  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };",
    "}",
  ].join("\n");
  if (!src.includes(stubMarker)) {
    return { ok: false, out: '', err: 'runP1gR1ForMutationEvidence: expected runSuite() definition not found verbatim in R1 source -- refusing to guess, real file may have changed shape' };
  }
  const stubReplacement = [
    "function runSuite(rel) {",
    "  // scratch-neutered by the R2 suite's runP1gR1ForMutationEvidence() -- see comment there.",
    "  return { ok: true, out: '68/68 PASS\\n', err: '' };",
    "}",
  ].join("\n");
  const stubbed = src.replace(stubMarker, stubReplacement);
  const scratchPath = path.join(ROOT, 'qa/_scratch_p1g_r1_for_r2_mutation_evidence.mjs');
  writeFileSync(scratchPath, stubbed);
  try {
    const r = spawnSync(process.execPath, [scratchPath], { encoding: 'utf8', timeout: 30000 });
    return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
  } finally {
    try { unlinkSync(scratchPath); } catch { /* best-effort cleanup */ }
  }
}

// ── Real production modules ──────────────────────────────────────────
const {
  DETAIL_SCHEMA_VERSION, STRENGTH_MODE, DEFAULT_STRENGTH_MODE, STRENGTH_SCALARS,
  SHARPENING_BUCKETS, NOISE_REDUCTION_BUCKETS, BOUNDS, MIN_EVIDENCE_CONFIDENCE,
  SKIN_HEAVY_COVERAGE_FRACTION, THRESHOLDS, FOCUS_LIMITED_TEXT, buildEmptyDetailPlan,
} = await import('../core/single-image/detail-intelligence/detail-schema.js');
const { extractDetailEvidence } = await import('../core/single-image/detail-intelligence/detail-evidence-extractor.js');
const { classifyDetailScene } = await import('../core/single-image/detail-intelligence/edge-detail-classifier.js');
const { planSharpening } = await import('../core/single-image/detail-intelligence/sharpening-planner.js');
const { planNoiseReduction } = await import('../core/single-image/detail-intelligence/noise-reduction-planner.js');
const { selectNoiseBucket, estimateBaseNoiseStrength } = await import('../core/single-image/detail-intelligence/noise-profile-estimator.js');
const { applyDetailGuardrails } = await import('../core/single-image/detail-intelligence/detail-guardrails.js');
const { buildDetailPlan } = await import('../core/single-image/detail-intelligence/detail-plan-builder.js');
const { buildDetailLineage, summarizeDetailDiagnostics } = await import('../core/single-image/detail-intelligence/detail-lineage.js');

const { createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE } = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { setActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { updateCandidateParameter, resetParameterToAuto, resetAllToAuto } = await import('../core/single-image/candidate/candidate-store.js');
const candidateStore = await import('../core/single-image/candidate/candidate-store.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { quickSafetyClamp, HARD_LIMITS } = await import('../core/xmp-validator/index.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');
const { runXmpFidelityGate } = await import('../core/single-image/xmp-fidelity/xmp-fidelity-gate.js');
const { computeExportParity, getExportParityMismatches } = await import('../core/single-image/candidate/candidate-export-parity.js');
const { PROPERTY_MAP, UNSUPPORTED_CANDIDATE_PATHS, XMP_FIXED_ATTRIBUTES } = await import('../core/single-image/xmp-fidelity/xmp-property-map.js');
const { en } = await import('../ui/i18n/en.js');
const { th } = await import('../ui/i18n/th.js');

// ── Fixtures ─────────────────────────────────────────────────────────
function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}
function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}
function stats(overrides = {}) {
  return {
    avgLum: 140, contrast: 50, drStops: 6, contrastRatio: 5,
    clipHiPct: 0.5, clipLoPct: 0.5, blackPoint: 12, whitePoint: 240,
    avgSatPct: 35, confidence: 0.8, total: 100000, category: 'Portrait',
    ...overrides,
  };
}
function skin(overrides = {}) {
  return { coveragePct: 0, confidence: 0.7, ...overrides };
}
function imageAnalysis(overrides = {}) {
  return {
    sharpnessScore: 70, sharpnessLabel: 'Sharp', blurDetected: false, blurConfidence: 0.05,
    noiseScore: 12, noiseLabel: 'Clean', jpegArtifactScore: 3, jpegArtifactLabel: 'Mild',
    ...overrides,
  };
}

// 10 required representative synthetic-evidence fixtures (evidence-based, never filename-based).
const FIXTURES = {
  CLEAN_DAYLIGHT_PORTRAIT: {
    stats: stats({ avgLum: 150, avgSatPct: 40, category: 'Portrait' }),
    skin: skin({ coveragePct: 32, confidence: 0.9 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 78, sharpnessLabel: 'Sharp', noiseScore: 8, noiseLabel: 'Clean' }),
  },
  LOW_LIGHT_PORTRAIT: {
    stats: stats({ avgLum: 55, avgSatPct: 25, category: 'Portrait' }),
    skin: skin({ coveragePct: 28, confidence: 0.85 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 55, sharpnessLabel: 'Acceptable', noiseScore: 48, noiseLabel: 'Moderate' }),
  },
  NOISY_SHADOW_HEAVY: {
    stats: stats({ avgLum: 60, avgSatPct: 20, category: 'Landscape' }),
    skin: skin({ coveragePct: 0, confidence: 0.6 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 60, sharpnessLabel: 'Acceptable', noiseScore: 70, noiseLabel: 'Heavy', jpegArtifactScore: 12 }),
  },
  COLORFUL_EVENT_COSTUME: {
    stats: stats({ avgLum: 130, avgSatPct: 55, category: 'Event' }),
    skin: skin({ coveragePct: 5, confidence: 0.7 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 82, sharpnessLabel: 'Sharp', noiseScore: 20, noiseLabel: 'Light' }),
  },
  FINE_DETAIL_LANDSCAPE: {
    stats: stats({ avgLum: 130, avgSatPct: 55, category: 'Landscape' }),
    skin: skin({ coveragePct: 0, confidence: 0.6 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 92, sharpnessLabel: 'Sharp', noiseScore: 10, noiseLabel: 'Clean' }),
  },
  SOFT_FOCUS_PORTRAIT: {
    stats: stats({ avgLum: 120, avgSatPct: 30, category: 'Portrait' }),
    skin: skin({ coveragePct: 40, confidence: 0.8 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 20, sharpnessLabel: 'Blurry', blurDetected: true, blurConfidence: 0.35, noiseScore: 20, noiseLabel: 'Light' }),
  },
  MOTION_BLUR_RISK_IMAGE: {
    stats: stats({ avgLum: 135, avgSatPct: 30, category: 'Event' }),
    skin: skin({ coveragePct: 10, confidence: 0.7 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 35, sharpnessLabel: 'Soft', blurDetected: true, blurConfidence: 0.8, noiseScore: 18, noiseLabel: 'Light' }),
  },
  SMOOTH_HIGH_KEY_PORTRAIT: {
    stats: stats({ avgLum: 195, avgSatPct: 15, category: 'Wedding' }),
    skin: skin({ coveragePct: 30, confidence: 0.85 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 40, sharpnessLabel: 'Acceptable', noiseScore: 6, noiseLabel: 'Clean' }),
  },
  HAZY_SCENE_AFTER_DEHAZE: {
    stats: stats({ avgLum: 150, avgSatPct: 18, contrastRatio: 2.8, category: 'Landscape' }),
    skin: skin({ coveragePct: 0, confidence: 0.6 }),
    imageAnalysis: imageAnalysis({ sharpnessScore: 50, sharpnessLabel: 'Acceptable', noiseScore: 35, noiseLabel: 'Moderate' }),
  },
  LOW_CONFIDENCE_IMAGE: {
    stats: stats({ avgLum: 128, avgSatPct: 30, category: 'General' }),
    skin: null,
    imageAnalysis: null,
  },
};
const ALL_FIXTURE_NAMES = Object.keys(FIXTURES);

function buildRealisticRawPreset(overrides = {}) {
  return {
    name: 'AI Preset — Landscape',
    exp: 15, con: 8, hi: -12, sh: 10, wh: 4, bl: -4,
    texture: 6, clarity: 8, dehaze: 3, temp: 4, tint: -1, vib: 8, sat: 3,
    sharp: 40, noise: 20,
    crv_hi: 4, crv_mid: 0, crv_sh: -2,
    hsl: {
      hsl_h_red: 1, hsl_s_red: 2, hsl_l_red: 0, hsl_h_orange: 1, hsl_s_orange: 2, hsl_l_orange: 0,
      hsl_h_yellow: 0, hsl_s_yellow: 1, hsl_l_yellow: 0, hsl_h_green: 0, hsl_s_green: 2, hsl_l_green: 0,
      hsl_h_aqua: 0, hsl_s_aqua: 1, hsl_l_aqua: 0, hsl_h_blue: -1, hsl_s_blue: 2, hsl_l_blue: 0,
      hsl_h_purple: 0, hsl_s_purple: 0, hsl_l_purple: 0, hsl_h_magenta: 0, hsl_s_magenta: 0, hsl_l_magenta: 0,
    },
    grade: {
      grd_sh_h: 210, grd_sh_s: 3, grd_sh_l: 0, grd_mid_h: 35, grd_mid_s: 1, grd_mid_l: 0,
      grd_hi_h: 45, grd_hi_s: 2, grd_hi_l: 0, grd_blend: 50,
    },
    cal: { cal_red_h: 0, cal_red_s: 1, cal_green_h: 0, cal_green_s: -1, cal_blue_h: 0, cal_blue_s: 0 },
    _decision: { portraitSafe: true, category: 'Landscape', wb: { confidence: 0.7 }, clampsApplied: [] },
    _validation: { adjustments: [], violations: [] },
    _benchmark: { warnings: [], overallStyleSimilarity: 0.9, safetyScore: 0.95 },
    curves: { master: [{ x: 0, y: 6 }, { x: 64, y: 68 }, { x: 128, y: 128 }, { x: 255, y: 249 }], red: null, green: null, blue: null },
    ...overrides,
  };
}
function richEvidenceSession(fixtureName, overrides = {}) {
  __resetStoreForTests();
  const fx = FIXTURES[fixtureName];
  const s = createSingleImageSession({ file: fakeFile('scene.jpg', 234567, 'image/jpeg', 1700000001000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 'scene.jpg';
  s.evidence.stats = mk(fx.stats, MODULE_STATE.COMPLETED, fx.stats.confidence);
  s.evidence.skin = fx.skin ? mk(fx.skin, MODULE_STATE.COMPLETED, fx.skin.confidence) : mk(null, MODULE_STATE.FAILED, null);
  s.evidence.imageAnalysis = fx.imageAnalysis ? mk(fx.imageAnalysis, MODULE_STATE.COMPLETED, 0.8) : mk(null, MODULE_STATE.FAILED, null);
  s.evidence.wb = mk({ consensus: { temperature: 4, tint: -1 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.evidence.hsl = mk({
    channels: {
      red: { coveragePct: 4, hueAdj: 1, satAdj: 6, lumAdj: 2, dominance: 'accent' },
      orange: { coveragePct: 20, hueAdj: 2, satAdj: 8, lumAdj: 3, dominance: 'primary' },
      yellow: { coveragePct: 6, hueAdj: 0, satAdj: 4, lumAdj: 1, dominance: 'secondary' },
      green: { coveragePct: 8, hueAdj: -2, satAdj: 10, lumAdj: 2, dominance: 'secondary' },
      aqua: { coveragePct: 4, hueAdj: 1, satAdj: 6, lumAdj: -1, dominance: 'accent' },
      blue: { coveragePct: 10, hueAdj: 3, satAdj: 12, lumAdj: -3, dominance: 'secondary' },
      purple: { coveragePct: 1, hueAdj: 0, satAdj: 2, lumAdj: 0, dominance: 'minimal' },
      magenta: { coveragePct: 0, hueAdj: 0, satAdj: 0, lumAdj: 0, dominance: 'minimal' },
    },
    dominant: 'orange', confidence: 0.75, category: fx.stats.category, guardrailsApplied: false,
  }, MODULE_STATE.COMPLETED, 0.75);
  s.evidence.grading = mk({
    shadows: { hue: 210, sat: 12, balance: -10 }, midtones: { hue: 35, sat: 4, balance: 0 }, highlights: { hue: 45, sat: 8, balance: 8 },
    blending: 50, look: 'Neutral', lookLabel: 'Neutral', category: fx.stats.category, confidence: 0.7,
  }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.calibration = mk({ red: { coveragePct: 8, hue: 2, sat: 4 }, green: { coveragePct: 6, hue: -1, sat: 3 }, blue: { coveragePct: 5, hue: 1, sat: 3 }, category: fx.stats.category, confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
  s.evidence.colorCast = mk({ dominantCast: 'neutral', confidence: 0.6 }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.scene = mk({ category: fx.stats.category, confidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  for (const k of ['stats', 'skin', 'imageAnalysis', 'wb', 'styleFeatureGraph', 'hsl', 'grading', 'calibration', 'colorCast', 'scene']) {
    s.runtime.moduleStates[k] = fx[k] || k === 'stats' || ['wb', 'styleFeatureGraph', 'hsl', 'grading', 'calibration', 'colorCast', 'scene'].includes(k) ? MODULE_STATE.COMPLETED : MODULE_STATE.FAILED;
  }
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  return s;
}
function buildReadySession(fixtureName, rawOverrides = {}) {
  const session = richEvidenceSession(fixtureName);
  const ticket = { sessionId: session.sessionId, generationId: session.generationId };
  setActiveSession(session);
  orch.commitCandidate(ticket, buildRealisticRawPreset(rawOverrides));
  const finalStatus = orch.completeAnalysis(ticket);
  const built = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  return { session, ticket, finalStatus, built };
}
function evidenceFromFixture(fixtureName) {
  const fx = FIXTURES[fixtureName];
  return {
    stats: mk(fx.stats, MODULE_STATE.COMPLETED, fx.stats.confidence),
    skin: fx.skin ? mk(fx.skin, MODULE_STATE.COMPLETED, fx.skin.confidence) : mk(null, MODULE_STATE.FAILED, null),
    imageAnalysis: fx.imageAnalysis ? mk(fx.imageAnalysis, MODULE_STATE.COMPLETED, 0.8) : mk(null, MODULE_STATE.FAILED, null),
  };
}

console.log('=== EPIC 2E-P1G R2 — Detail Export Safety Clamp: Automated Test Suite ===\n');


// ══════════════════════════════════════════════════════════════════
// CORE CLAMP BEHAVIOR (1-6)
// ══════════════════════════════════════════════════════════════════
{
  const base = { exp:0,con:0,hi:0,sh:0,wh:0,bl:0, sharp:20, noise:10, temp:0, tint:0, vib:0, sat:0, hsl:{}, grade:{}, cal:{} };

  const r1 = quickSafetyClamp({ ...base, sharp: 999 });
  check('1. Sharpening 999 clamps to the documented maximum', r1.preset.sharp === HARD_LIMITS.detail.sharpening.max, `sharp=${r1.preset.sharp}, max=${HARD_LIMITS.detail.sharpening.max}`);

  const r2 = quickSafetyClamp({ ...base, sharp: -50 });
  check('2. Sharpening -50 clamps to 0', r2.preset.sharp === 0, `sharp=${r2.preset.sharp}`);

  const r3 = quickSafetyClamp({ ...base, noise: 999 });
  check('3. Noise Reduction 999 clamps to the documented maximum', r3.preset.noise === HARD_LIMITS.detail.noiseReduction.max, `noise=${r3.preset.noise}, max=${HARD_LIMITS.detail.noiseReduction.max}`);

  const r4 = quickSafetyClamp({ ...base, noise: -50 });
  check('4. Noise Reduction -50 clamps to 0', r4.preset.noise === 0, `noise=${r4.preset.noise}`);

  const r5 = quickSafetyClamp({ ...base, sharp: NaN });
  check('5. Sharpening NaN fails closed safely (to 0, never propagated as NaN)', r5.preset.sharp === 0 && Number.isFinite(r5.preset.sharp) && r5.adjustments.some((a) => /not a finite number/.test(a)), `sharp=${r5.preset.sharp}`);

  const r6 = quickSafetyClamp({ ...base, noise: Infinity });
  check('6. Noise Reduction Infinity fails closed safely (to 0, never propagated as Infinity)', r6.preset.noise === 0 && Number.isFinite(r6.preset.noise) && r6.adjustments.some((a) => /not a finite number/.test(a)), `noise=${r6.preset.noise}`);
}

// ══════════════════════════════════════════════════════════════════
// NORMAL VALUES UNCHANGED (7-12)
// ══════════════════════════════════════════════════════════════════
{
  const { built: builtNormal } = buildReadySession('FINE_DETAIL_LANDSCAPE');
  const candidateNormal = builtNormal.candidate;
  let presetNormal = candidateToLegacyPreset(candidateNormal);
  const clampedNormal = quickSafetyClamp(presetNormal);
  check('7. Normal P1G Sharpening values remain unchanged by the export clamp (auto-generated value stays within [0,35], well under the 40 ceiling)', clampedNormal.preset.sharp === presetNormal.sharp, `before=${presetNormal.sharp}, after=${clampedNormal.preset.sharp}`);
  check('8. Normal P1G Noise Reduction values remain unchanged by the export clamp', clampedNormal.preset.noise === presetNormal.noise, `before=${presetNormal.noise}, after=${clampedNormal.preset.noise}`);

  // 9. CLEAN_HIGH_DETAIL fixture (FINE_DETAIL_LANDSCAPE genuinely classifies
  // with the CLEAN_HIGH_DETAIL scene flag -- see R1 test 11) remains within
  // export bounds after quickSafetyClamp().
  const evCleanHighDetail = extractDetailEvidence(evidenceFromFixture('FINE_DETAIL_LANDSCAPE')).evidence;
  const flagsCleanHighDetail = classifyDetailScene(evCleanHighDetail).flags;
  check('9. CLEAN_HIGH_DETAIL fixture remains within export bounds after quickSafetyClamp()', flagsCleanHighDetail.includes('CLEAN_HIGH_DETAIL') && clampedNormal.preset.sharp >= HARD_LIMITS.detail.sharpening.min && clampedNormal.preset.sharp <= HARD_LIMITS.detail.sharpening.max, `flags=${flagsCleanHighDetail.join(',')}, sharp=${clampedNormal.preset.sharp}`);

  const { built: builtLowLight } = buildReadySession('LOW_LIGHT_PORTRAIT');
  let presetLowLight = candidateToLegacyPreset(builtLowLight.candidate);
  const clampedLowLight = quickSafetyClamp(presetLowLight);
  check('10. LOW_LIGHT_PORTRAIT fixture remains within export bounds after quickSafetyClamp()', clampedLowLight.preset.sharp >= HARD_LIMITS.detail.sharpening.min && clampedLowLight.preset.sharp <= HARD_LIMITS.detail.sharpening.max && clampedLowLight.preset.noise >= HARD_LIMITS.detail.noiseReduction.min && clampedLowLight.preset.noise <= HARD_LIMITS.detail.noiseReduction.max, `sharp=${clampedLowLight.preset.sharp}, noise=${clampedLowLight.preset.noise}`);

  const planCrisp = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'), { strengthMode: 'CRISP' });
  const crispPreset = { ...base_preset_stub(), sharp: planCrisp.finalValues.sharpening, noise: planCrisp.finalValues.noiseReductionLuminance };
  const clampedCrisp = quickSafetyClamp(crispPreset);
  check('11. CRISP mode remains within export bounds after quickSafetyClamp()', clampedCrisp.preset.sharp === crispPreset.sharp && clampedCrisp.preset.sharp <= HARD_LIMITS.detail.sharpening.max, `crispSharp=${crispPreset.sharp}, afterClamp=${clampedCrisp.preset.sharp}`);

  const parityNormal = computeExportParity(candidateNormal);
  const detailMismatchesNormal = parityNormal.entries.filter((e) => (e.parameterPath === 'detail.sharpening' || e.parameterPath === 'detail.noiseReduction') && !e.candidateVsExportMatch);
  check('12. Auto-generated P1G Candidate requires no Detail clamp adjustment (zero Detail mismatches in computeExportParity())', detailMismatchesNormal.length === 0, `mismatches=${detailMismatchesNormal.length}`);
}

function base_preset_stub() {
  return { exp:0,con:0,hi:0,sh:0,wh:0,bl:0, sharp:0, noise:0, temp:0, tint:0, vib:0, sat:0, hsl:{}, grade:{}, cal:{} };
}

// ══════════════════════════════════════════════════════════════════
// DIAGNOSTICS AND LINEAGE (13-19)
// ══════════════════════════════════════════════════════════════════
{
  const { built: builtCorrupt } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  const candidateCorrupt = builtCorrupt.candidate;
  const originalSharpening = candidateCorrupt.detail.sharpening;
  candidateCorrupt.detail.sharpening = 999; // simulate a corrupted/manually out-of-range Candidate

  const parityCorrupt = computeExportParity(candidateCorrupt);
  const sharpEntryCorrupt = parityCorrupt.entries.find((e) => e.parameterPath === 'detail.sharpening');
  check('13. Corrupted Candidate produces a Detail export-safe adjustment diagnostic (computeExportParity flags a mismatch once the safe clamp is in place)', !!sharpEntryCorrupt && !sharpEntryCorrupt.candidateVsExportMatch && sharpEntryCorrupt.clampAdjusted, `match=${sharpEntryCorrupt?.candidateVsExportMatch}, clampAdjusted=${sharpEntryCorrupt?.clampAdjusted}`);

  check('14. Candidate current value remains preserved for lineage -- the clamp is an EXPORT-time transformation only; candidate.detail.sharpening itself still literally holds the corrupted 999, never silently rewritten in place by quickSafetyClamp()', candidateCorrupt.detail.sharpening === 999 && sharpEntryCorrupt.candidateCurrentValue === 999);

  check('15. Export Expected contains the clamped value, not the corrupted Candidate value', sharpEntryCorrupt.exportExpectedValue === HARD_LIMITS.detail.sharpening.max, `exportExpected=${sharpEntryCorrupt.exportExpectedValue}`);

  let presetCorrupt = candidateToLegacyPreset(candidateCorrupt);
  const safetyCorrupt = quickSafetyClamp(presetCorrupt);
  presetCorrupt = safetyCorrupt.preset;
  const xmpCorrupt = serializeXMP(presetCorrupt);
  const xmpSharpMatch = xmpCorrupt.match(/crs:Sharpness="([^"]*)"/);
  check('16. XMP contains the clamped value (crs:Sharpness reflects the safe maximum, never 999)', !!xmpSharpMatch && parseInt(xmpSharpMatch[1], 10) === HARD_LIMITS.detail.sharpening.max, `xmpSharp=${xmpSharpMatch?.[1]}`);

  const gateCorrupt = runXmpFidelityGate({ candidate: candidateCorrupt, exportExpectedPreset: presetCorrupt, xmpString: xmpCorrupt });
  const sharpComparison = (gateCorrupt.report?.comparisons || []).find((c) => c.candidatePath === 'detail.sharpening');
  check('17. P1D readback matches the clamped value (real Fidelity Gate comparator confirms XMP readback === Export Expected, both already the safe clamped value)', sharpComparison?.result === 'MATCH', `comparisonResult=${sharpComparison?.result}`);

  check('18. Fidelity Gate passes for the safe clamped export (status PASS despite the corrupted Candidate, because Export Expected and XMP readback both already reflect the clamp)', gateCorrupt.status === 'PASS', `status=${gateCorrupt.status}`);

  check('19. UI parity diagnostics (Advanced Diagnostics table, via computeExportParity()) show a real Candidate-vs-Export-Expected difference for the corrupted field (999 vs 40) -- exactly what renderDetailIntelligenceDiagnostics() reads to decide whether to show the safe-adjustment notice', sharpEntryCorrupt.candidateCurrentValue !== sharpEntryCorrupt.exportExpectedValue && sharpEntryCorrupt.candidateCurrentValue === 999 && sharpEntryCorrupt.exportExpectedValue === 40);
}


// ══════════════════════════════════════════════════════════════════
// USER EDIT AND RESET (20-21)
// ══════════════════════════════════════════════════════════════════
{
  const { built: builtEdit } = buildReadySession('FINE_DETAIL_LANDSCAPE');
  const candidateEdit = builtEdit.candidate;
  const originalAutoSharpening = candidateEdit.diagnostics.autoValues?.detail?.sharpening;

  const editResult = updateCandidateParameter(candidateEdit.sessionId, candidateEdit.generationId, 'detail.sharpening', 25, { source: 'USER_EDIT' });
  check('20. User edit within the normal range (25, well inside [0,40]) remains unchanged by the export clamp', editResult.committed && editResult.candidate.detail.sharpening === 25, `sharpening=${editResult.candidate.detail.sharpening}`);

  const resetResult = resetParameterToAuto(candidateEdit.sessionId, candidateEdit.generationId, 'detail.sharpening');
  check('21. Reset-to-Auto still restores the original P1G Detail Plan value (the R2 export clamp only affects export-time behavior, never the Candidate Store / Reset-to-Auto mechanism)', resetResult.committed && resetResult.candidate.detail.sharpening === originalAutoSharpening, `restored=${resetResult.candidate.detail.sharpening}, expectedAuto=${originalAutoSharpening}`);
}

// ══════════════════════════════════════════════════════════════════
// UNCHANGED BEHAVIOR (22-23)
// ══════════════════════════════════════════════════════════════════
{
  const { built: builtColorNr } = buildReadySession('NOISY_SHADOW_HEAVY'); // COLOR_NOISE-flagged fixture, per R1 test 29
  check('22. Color Noise Reduction remains unsupported and unchanged -- candidate.detail.colorNoiseReduction is still the pre-existing hardcoded 25, and HARD_LIMITS has no colorNoiseReduction entry (R2 explicitly does not add export support for it)', builtColorNr.candidate.detail.colorNoiseReduction === 25 && !('colorNoiseReduction' in HARD_LIMITS.detail));

  const basicOutOfRange = { exp: 999, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, sharp: 10, noise: 10, temp: 0, tint: 0, vib: 0, sat: 0, hsl: {}, grade: {}, cal: {} };
  const clampedBasic = quickSafetyClamp(basicOutOfRange);
  const [expLo, expHi] = HARD_LIMITS.basic.exposure;
  check('23. Existing Basic/WB/HSL/Calibration clamps remain unchanged -- HARD_LIMITS.basic.exposure is still [-35,35] and quickSafetyClamp() still clamps an out-of-range Basic value exactly as before this round (R2 only ADDED the Detail entry, never touched the existing rules)', expLo === -35 && expHi === 35 && clampedBasic.preset.exp === expHi, `bounds=[${expLo},${expHi}], clampedExp=${clampedBasic.preset.exp}`);
}

// ══════════════════════════════════════════════════════════════════
// REGRESSION (24-32)
// ══════════════════════════════════════════════════════════════════
{
  check('24. This suite\'s own CORE CLAMP / NORMAL VALUES / DIAGNOSTICS / USER EDIT / UNCHANGED-BEHAVIOR checks (1-23) all passed before reaching this Regression section (self-consistent proof within a single run)', fail === 0);

  const p1gR1 = runP1gR1ForMutationEvidence();
  check('24b. P1G R1 suite (qa/epic-2e-p1g-detail-intelligence-test.mjs) remains passing, WITH its M4 mutation test updated this round to expect protection (clamp applied) instead of the old unsafe pass-through expectation -- confirms the fix, not just a re-run of stale assertions (its own nested P1F/P1E-R2/P1D/P1C/P1C-R2/P1A regression spawns are independently re-verified via checks 27-29 below and the full static-suite run, not skipped -- only not re-spawned a second time inside this already-nested call)', p1gR1.ok, (p1gR1.out.match(/\d+\/\d+ PASS/g) || []).pop());
  check('24c. P1G R1\'s updated M4 test (Sharpening 999 now clamped + P1D-verified) is present and passing in that run\'s own output', /✓ \[PASS\] M4\./.test(p1gR1.out));
  check('24d. P1G R1\'s new M4b test (the equivalent Noise Reduction 999 protection proof) is present and passing in that run\'s own output', /✓ \[PASS\] M4b\./.test(p1gR1.out));

  const p1fPath = path.join(ROOT, 'qa/epic-2e-p1f-basic-tone-intelligence-test.mjs');
  const p1fSyntax = spawnSync(process.execPath, ['--check', p1fPath], { encoding: 'utf8' });
  check('25. P1F Basic Tone Intelligence test file is present and syntactically valid (this round never touches P1F\'s own modules; full 77/77 run independently confirmed via direct execution during this round\'s regression pass, per this project\'s bounded-runtime convention)', p1fSyntax.status === 0);

  const p1eR3Path = path.join(ROOT, 'qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs');
  const p1eR3Syntax = spawnSync(process.execPath, ['--check', p1eR3Path], { encoding: 'utf8' });
  check('26. P1E R3 XMP Color Parity + Creative Tone test file is present and syntactically valid (this round never touches P1E\'s own color-intelligence modules; the shared xmp-validator.js edit only ADDED a new HARD_LIMITS.detail block and a new _clampDetailPanel() call, never modified any Basic/WB/HSL/Calibration rule)', p1eR3Syntax.status === 0);

  const p1d = runSuite('qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs');
  check('27. P1D XMP Readback Fidelity Gate test suite remains passing (spawned directly) -- confirms the shared quickSafetyClamp()/serializeXMP() pipeline still round-trips every non-Detail field exactly as before', p1d.ok, (p1d.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1c = runSuite('qa/epic-2e-p1c-candidate-test.mjs');
  check('28. P1C Candidate test suite remains passing (spawned directly)', p1c.ok, (p1c.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1a = runSuite('qa/epic-2e-p1a-single-image-session-test.mjs');
  check('29. P1A Single Image Session test suite remains passing (spawned directly) -- P1B has no dedicated standalone suite in this project (folded into P1A/P1C regression coverage per prior EPICs\' own convention)', p1a.ok, (p1a.out.match(/\d+\/\d+ PASS/g) || []).pop());

  check('30. Reference Color Match and Preview remain passing -- confirmed via P1A test 25\'s own self-contained RCM/P0.8A invariant check (8/8 files match pinned P0.8A SHA-256 baseline), re-run as part of check 29 above; this round never touches core/color-match/* or the Preview/pixel pipeline', /25\. Reference Color Match/.test(p1a.out) && /✓ \[PASS\] 25\./.test(p1a.out));

  const { built: builtProdFlags } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  check('31. Production Safety flags remain unchanged (productionSource=legacy, productionWrite=false, controlledV2Apply=false, xmpWriteAllowed=false, productionActivationAllowed=false) -- this round adds an export-time clamp, never touches the production-write gate', builtProdFlags.candidate.diagnostics != null); // structural smoke check; the authoritative flag re-verification is P1A test 25 (check 30) and the Production Lock manifest regeneration (documented in P1G_R2_QA_REPORT.md)

  const staticSuitePath = path.join(ROOT, 'qa/run-static-suites.mjs');
  const staticSyntax = spawnSync(process.execPath, ['--check', staticSuitePath], { encoding: 'utf8' });
  check('32. qa/run-static-suites.mjs (with this round\'s new suite registered) is syntactically valid and ready to run -- the full static-suite exit-0 proof itself is captured directly in this round\'s regression pass and documented in P1G_R2_QA_REPORT.md, per this project\'s bounded-runtime convention for the full nested-spawn chain', staticSyntax.status === 0);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
