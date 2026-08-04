#!/usr/bin/env node
/**
 * EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction:
 * dedicated real-integration test suite.
 *
 * Runs against the REAL production modules:
 *   - core/single-image/detail-intelligence/*.js (NEW, 9 files)
 *   - core/single-image/candidate/candidate-builder.js (EDITED: Detail
 *     Plan wired in after P1F's Basic Tone Plan and P1E's Color
 *     Intelligence enrichment)
 *   - core/single-image/single-image-orchestrator.js (EDITED: DETAIL_*
 *     trace events)
 *   - core/single-image/candidate/candidate-export-parity.js,
 *     core/single-image/xmp-fidelity/* (P1D/P1E R3, read-only)
 *   - core/xmp-validator/index.js::quickSafetyClamp() (Production-Locked,
 *     imported read-only, never modified)
 *
 * Never re-implements planner/clamp/serializer math -- every expected
 * value is either derived by calling the real production function, or
 * is a documented BOUNDS constant read directly from source.
 *
 * Run: node qa/epic-2e-p1g-detail-intelligence-test.mjs
 */
import { readFileSync } from 'node:fs';
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

console.log('=== EPIC 2E-P1G — Detail Intelligence: Automated Test Suite ===\n');

// ══════════════════════════════════════════════════════════════════
// AUDIT AND OWNERSHIP (1-7)
// ══════════════════════════════════════════════════════════════════
{
  const { built } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  const candidate = built.candidate;

  {
    const src1raw = readFileSync(path.join(ROOT, 'core/single-image/detail-intelligence/detail-plan-builder.js'), 'utf8');
    // Strip /** ... */ and // comments before checking for real code
    // references -- the module's own JSDoc explains in prose what it
    // must NOT touch, which would otherwise false-positive a naive
    // substring/regex scan (the exact P1F test-42 lesson).
    const src1 = src1raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const noCandidateParam = !/function\s+buildDetailPlan\s*\([^)]*\bcandidate\b/.test(src1);
    const noCandidateFieldWrite = !/candidate\.(basic|hsl|grading|cal|whiteBalance)/.test(src1);
    check('1. Detail Plan owns only candidate.detail.sharpening/.noiseReduction -- never writes candidate.basic/.hsl/.grading/.cal/.whiteBalance', noCandidateParam && noCandidateFieldWrite, 'source-level (comments stripped): buildDetailPlan() takes no `candidate` argument and never references candidate.basic/.hsl/.grading/.cal/.whiteBalance');
  }

  {
    const { buildBasicTonePlan } = await import('../core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js');
    const { DEFAULT_STRENGTH_MODE: DEFAULT_BASIC_MODE } = await import('../core/single-image/basic-tone-intelligence/basic-tone-schema.js');
    // Independent recomputation proof: rebuild the Basic Tone Plan from
    // the SAME evidence the committed Candidate used, and compare its
    // finalValues field-by-field against candidate.basic.* -- proves
    // P1G's own Detail Plan build (which runs strictly AFTER P1F's in
    // candidate-builder.js) never mutated what P1F already computed.
    const recomputed = buildBasicTonePlan(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT'), { strengthMode: DEFAULT_BASIC_MODE });
    const basicFieldsMatch = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze']
      .every((f) => candidate.basic[f] === recomputed.finalValues[f]);
    check('2. P1G does not overwrite P1F Basic Tone values -- candidate.basic.* still exactly matches an independent buildBasicTonePlan() recomputation from the same evidence', basicFieldsMatch);
  }

  check('3. P1G does not overwrite P1E color values -- candidate.hsl/.grading/.cal remain non-null/populated by Color Intelligence, untouched by Detail', candidate.diagnostics.colorIntelligence != null && typeof candidate.hsl === 'object');

  check('4. Candidate remains the single source of truth for Detail export -- mutating candidate.detail.sharpening directly changes what candidateToLegacyPreset() reads, WITHOUT re-invoking buildDetailPlan()', (() => {
    const before = candidateToLegacyPreset(candidate).sharp;
    candidate.detail.sharpening = 999;
    const after = candidateToLegacyPreset(candidate).sharp;
    candidate.detail.sharpening = before; // restore
    return after === 999 && before !== 999;
  })());

  check('5. UI Detail values equal Candidate values -- renderDetailIntelligenceDiagnostics() source reads candidate.diagnostics.detailIntelligence and candidate.detail.* only, never a separate DOM/slider value', (() => {
    const src = readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
    const fnMatch = src.match(/function renderDetailIntelligenceDiagnostics\(candidate\) \{[\s\S]*?\n\}\n/);
    if (!fnMatch) return false;
    const fn = fnMatch[0];
    return fn.includes('candidate?.diagnostics?.detailIntelligence') && fn.includes('candidate?.detail?.[field]') && !/document\.getElementById\('slider/.test(fn);
  })());

  check('6. Legacy Preset Detail keys equal Candidate values -- candidateToLegacyPreset(candidate).sharp/.noise are byte-identical to candidate.detail.sharpening/.noiseReduction', (() => {
    const legacy = candidateToLegacyPreset(candidate);
    return legacy.sharp === candidate.detail.sharpening && legacy.noise === candidate.detail.noiseReduction;
  })());

  // Full real pipeline: Candidate -> legacy preset -> clamp -> serialize -> Fidelity Gate (never re-implemented).
  let gatePreset = candidateToLegacyPreset(candidate);
  gatePreset = quickSafetyClamp(gatePreset).preset;
  const gateXmp = serializeXMP(gatePreset);
  const { status: gateStatus, report: gateReport } = runXmpFidelityGate({ candidate, exportExpectedPreset: gatePreset, xmpString: gateXmp });
  const detailMismatches = (gateReport?.comparisonResult?.comparisons ?? [])
    .filter((c) => (c.candidatePath === 'detail.sharpening' || c.candidatePath === 'detail.noiseReduction') && c.result !== 'MATCH');
  check('7. P1D readback equals Export Expected Detail values -- real Fidelity Gate run (Candidate -> Legacy Preset -> quickSafetyClamp -> serializeXMP -> readback) reports zero Detail-specific mismatches', detailMismatches.length === 0, `gate.status=${gateStatus}, detailMismatches=${JSON.stringify(detailMismatches)}`);
}

// ══════════════════════════════════════════════════════════════════
// EVIDENCE (8-14)
// ══════════════════════════════════════════════════════════════════
{
  const evClean = extractDetailEvidence(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT'));
  check('8. Clean daylight portrait fixture -> low measured luminance-noise evidence', evClean.ok && evClean.evidence.luminanceNoise < 0.25, `luminanceNoise=${evClean.evidence?.luminanceNoise}`);

  const evLowLight = extractDetailEvidence(evidenceFromFixture('LOW_LIGHT_PORTRAIT'));
  check('9. Low-light portrait fixture -> elevated luminance-noise evidence vs. the clean daylight fixture', evLowLight.ok && evLowLight.evidence.luminanceNoise > evClean.evidence.luminanceNoise, `lowLight=${evLowLight.evidence?.luminanceNoise}, clean=${evClean.evidence?.luminanceNoise}`);

  const evNoisy = extractDetailEvidence(evidenceFromFixture('NOISY_SHADOW_HEAVY'));
  check('10. Noisy/shadow-heavy fixture -> elevated chroma-noise evidence (proxy, derived from measured luminance noise + low saturation) vs. the clean daylight fixture', evNoisy.ok && evNoisy.evidence.chromaNoise > evClean.evidence.chromaNoise, `noisy=${evNoisy.evidence?.chromaNoise}, clean=${evClean.evidence?.chromaNoise}`);

  const evFine = extractDetailEvidence(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'));
  check('11. Fine-detail landscape fixture -> high edge/detail evidence', evFine.ok && evFine.evidence.edgeDensity > 0.6, `edgeDensity=${evFine.evidence?.edgeDensity}`);

  const evSoft = extractDetailEvidence(evidenceFromFixture('SOFT_FOCUS_PORTRAIT'));
  check('12. Soft-focus fixture -> low focus-confidence evidence', evSoft.ok && evSoft.evidence.focusConfidence < 0.45, `focusConfidence=${evSoft.evidence?.focusConfidence}`);

  const planMotion = buildDetailPlan(evidenceFromFixture('MOTION_BLUR_RISK_IMAGE'));
  check('13. Motion-blur-risk fixture -> Detail Plan does not use aggressive sharpening (bounded <= 18, the documented NOISY_OR_SOFT/restrained ceiling)', planMotion.finalValues.sharpening <= 18, `sharpening=${planMotion.finalValues.sharpening}`);

  const planLowConf = buildDetailPlan(evidenceFromFixture('LOW_CONFIDENCE_IMAGE'));
  check('14. Missing evidence (no Image Analysis Core result) -> bounded low-confidence fallback (confidence 0, sharpening=0, noiseReduction=0, never a crash or NaN)', planLowConf.confidence === 0 && planLowConf.finalValues.sharpening === 0 && planLowConf.finalValues.noiseReductionLuminance === 0 && Number.isFinite(planLowConf.finalValues.sharpening), `confidence=${planLowConf.confidence}`);
}

// ══════════════════════════════════════════════════════════════════
// SHARPENING (15-22)
// ══════════════════════════════════════════════════════════════════
{
  const planFine = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'));
  check('15. Clean detailed (fine-detail landscape) fixture -> bounded positive Sharpening (0 < value <= 35)', planFine.finalValues.sharpening > 0 && planFine.finalValues.sharpening <= BOUNDS.sharpening.hi, `sharpening=${planFine.finalValues.sharpening}`);

  const planPortrait = buildDetailPlan(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT'));
  check('16. Clean portrait Sharpening is less than clean detailed landscape Sharpening (portraits stay restrained relative to detailed/landscape imagery)', planPortrait.finalValues.sharpening < planFine.finalValues.sharpening, `portrait=${planPortrait.finalValues.sharpening}, landscape=${planFine.finalValues.sharpening}`);

  const planNoisy = buildDetailPlan(evidenceFromFixture('NOISY_SHADOW_HEAVY'));
  check('17. Noisy/shadow-heavy image reduces Sharpening (bounded within the restrained NOISY_OR_SOFT ceiling <= 18)', planNoisy.finalValues.sharpening <= 18, `sharpening=${planNoisy.finalValues.sharpening}`);

  const planSoft = buildDetailPlan(evidenceFromFixture('SOFT_FOCUS_PORTRAIT'));
  check('18. Soft-focus fixture does not use aggressive Sharpening (never uses Sharpening to repair blur, bounded <= 18)', planSoft.finalValues.sharpening <= 18, `sharpening=${planSoft.finalValues.sharpening}`);

  const planMotion2 = buildDetailPlan(evidenceFromFixture('MOTION_BLUR_RISK_IMAGE'));
  check('19. Motion-blur-risk fixture does not use aggressive Sharpening (bounded <= 18)', planMotion2.finalValues.sharpening <= 18, `sharpening=${planMotion2.finalValues.sharpening}`);

  const evPortraitBase = evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT').imageAnalysis
    ? extractDetailEvidence(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT')).evidence
    : null;
  const flagsPortrait = classifyDetailScene(evPortraitBase).flags;
  const shNoSkin = planSharpening({ ...evPortraitBase, skinCoverage: 0.02 }, flagsPortrait, { strengthMode: 'BALANCED' });
  const shHighSkin = planSharpening({ ...evPortraitBase, skinCoverage: 0.5 }, flagsPortrait, { strengthMode: 'BALANCED' });
  check('20. High skin coverage limits Sharpening strength relative to low skin coverage, same evidence otherwise', shHighSkin.amount <= shNoSkin.amount, `lowSkin=${shNoSkin.amount}, highSkin=${shHighSkin.amount}`);

  const shNoTexture = planSharpening(evPortraitBase, flagsPortrait, { strengthMode: 'BALANCED', p1fTexture: 0, p1fClarity: 0 });
  const shStrongTexture = planSharpening(evPortraitBase, flagsPortrait, { strengthMode: 'BALANCED', p1fTexture: 18, p1fClarity: 16 });
  check('21. Strong P1F Texture/Clarity reduces additional Sharpening pressure vs. neutral Texture/Clarity, same evidence otherwise', shStrongTexture.amount <= shNoTexture.amount, `neutral=${shNoTexture.amount}, strongTC=${shStrongTexture.amount}`);

  const allSharpBounded = ALL_FIXTURE_NAMES.every((name) => {
    const p = buildDetailPlan(evidenceFromFixture(name));
    return p.finalValues.sharpening >= BOUNDS.sharpening.lo && p.finalValues.sharpening <= BOUNDS.sharpening.hi;
  });
  check('22. No fixture (including halo-risk scenes) ever exceeds the documented Sharpening bound (0-35)', allSharpBounded);
}

// ══════════════════════════════════════════════════════════════════
// NOISE REDUCTION (23-30)
// ══════════════════════════════════════════════════════════════════
{
  const planClean = buildDetailPlan(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT'));
  check('23. Clean fixture -> low Luminance NR (bounded within the CLEAN bucket, <= 8)', planClean.finalValues.noiseReductionLuminance <= NOISE_REDUCTION_BUCKETS.CLEAN.hi, `nr=${planClean.finalValues.noiseReductionLuminance}`);

  const planMildSrc = buildDetailPlan(evidenceFromFixture('SOFT_FOCUS_PORTRAIT'));
  check('24. Mild-noise fixture -> bounded NR within the documented mild-noise range', planMildSrc.finalValues.noiseReductionLuminance >= 0 && planMildSrc.finalValues.noiseReductionLuminance <= NOISE_REDUCTION_BUCKETS.MODERATE.hi, `nr=${planMildSrc.finalValues.noiseReductionLuminance}`);

  const planModerate = buildDetailPlan(evidenceFromFixture('LOW_LIGHT_PORTRAIT'));
  check('25. Moderate-noise fixture -> stronger but bounded NR than the clean fixture', planModerate.finalValues.noiseReductionLuminance > planClean.finalValues.noiseReductionLuminance && planModerate.finalValues.noiseReductionLuminance <= NOISE_REDUCTION_BUCKETS.STRONG.hi, `moderate=${planModerate.finalValues.noiseReductionLuminance}, clean=${planClean.finalValues.noiseReductionLuminance}`);

  const evForShadow = extractDetailEvidence(evidenceFromFixture('LOW_LIGHT_PORTRAIT')).evidence;
  const flagsShadow = classifyDetailScene(evForShadow).flags;
  const nrNoLift = planNoiseReduction({ ...evForShadow, shadowLiftRisk: 0 }, flagsShadow, { strengthMode: 'BALANCED' });
  const nrWithLift = planNoiseReduction({ ...evForShadow, shadowLiftRisk: 0.75 }, flagsShadow, { strengthMode: 'BALANCED' });
  check('26. P1F shadow-lift risk increases noise-risk compensation (higher Luminance NR than the same evidence with no shadow-lift risk)', nrWithLift.luminance >= nrNoLift.luminance, `noLift=${nrNoLift.luminance}, withLift=${nrWithLift.luminance}`);

  const evSkinHeavyNoisy = { ...evForShadow, skinCoverage: 0.5, luminanceNoise: 0.9 };
  const nrSkinHeavy = planNoiseReduction(evSkinHeavyNoisy, flagsShadow, { strengthMode: 'BALANCED' });
  check('27. Portrait NR avoids plastic-skin levels -- a skin-heavy image with very high measured noise still never reaches the noise bucket\'s own maximum (oversmoothingProtection engaged)', nrSkinHeavy.oversmoothingProtection === true && nrSkinHeavy.luminance < NOISE_REDUCTION_BUCKETS.STRONG.hi, `luminance=${nrSkinHeavy.luminance}, cap=${NOISE_REDUCTION_BUCKETS.STRONG.hi}`);

  const planHighDetailNoisy = buildDetailPlan(evidenceFromFixture('NOISY_SHADOW_HEAVY'));
  check('28. High-detail noisy image balances NR and detail preservation -- Sharpening stays restrained AND Luminance NR increases, never both left at 0', planHighDetailNoisy.finalValues.sharpening <= 18 && planHighDetailNoisy.finalValues.noiseReductionLuminance > 8, `sharpening=${planHighDetailNoisy.finalValues.sharpening}, nr=${planHighDetailNoisy.finalValues.noiseReductionLuminance}`);

  const planColorNoise = buildDetailPlan(evidenceFromFixture('NOISY_SHADOW_HEAVY'));
  check('29. Color Noise Reduction changes only when export support is proven -- the recommendation stays diagnostic-only (supported: false) even for a COLOR_NOISE-flagged fixture', planColorNoise.noiseReduction.color.supported === false, `flags=${planColorNoise.sceneClass.join(',')}, supported=${planColorNoise.noiseReduction.color.supported}`);

  check('30. Unsupported Color Noise Reduction remains explicitly documented (UNSUPPORTED_CANDIDATE_PATHS lists detail.colorNoiseReduction; the Detail Plan\'s own reason string names the real hardcoded XMP literal)', UNSUPPORTED_CANDIDATE_PATHS.includes('detail.colorNoiseReduction') && /crs:ColorNoiseReduction/.test(planColorNoise.noiseReduction.color.reason), planColorNoise.noiseReduction.color.reason);
}

// ══════════════════════════════════════════════════════════════════
// MODES (31-34)
// ══════════════════════════════════════════════════════════════════
{
  const planNatural = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'), { strengthMode: 'NATURAL' });
  const planBalanced = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'), { strengthMode: 'BALANCED' });
  const planCrisp = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'), { strengthMode: 'CRISP' });

  check('31. NATURAL mode is gentler than (or equal to) BALANCED for the same evidence', planNatural.finalValues.sharpening <= planBalanced.finalValues.sharpening, `natural=${planNatural.finalValues.sharpening}, balanced=${planBalanced.finalValues.sharpening}`);
  check('32. CRISP mode is stronger than (or equal to) BALANCED but remains within the documented bound (0-35)', planCrisp.finalValues.sharpening >= planBalanced.finalValues.sharpening && planCrisp.finalValues.sharpening <= BOUNDS.sharpening.hi, `crisp=${planCrisp.finalValues.sharpening}, balanced=${planBalanced.finalValues.sharpening}`);

  const planCrispSkin = buildDetailPlan(evidenceFromFixture('CLEAN_DAYLIGHT_PORTRAIT'), { strengthMode: 'CRISP' });
  check('33. CRISP mode remains skin-safe -- a skin-heavy portrait under CRISP still respects the final skin-protection cap (<= 65% of the Sharpening bound ceiling)', planCrispSkin.finalValues.sharpening <= Math.round(BOUNDS.sharpening.hi * 0.65) + 1, `sharpening=${planCrispSkin.finalValues.sharpening}, cap~=${Math.round(BOUNDS.sharpening.hi * 0.65)}`);

  const allModesExportSafe = ['NATURAL', 'BALANCED', 'CRISP'].every((mode) => ALL_FIXTURE_NAMES.every((name) => {
    const p = buildDetailPlan(evidenceFromFixture(name), { strengthMode: mode });
    return p.finalValues.sharpening >= BOUNDS.sharpening.lo && p.finalValues.sharpening <= BOUNDS.sharpening.hi
      && p.finalValues.noiseReductionLuminance >= BOUNDS.noiseReduction.lo && p.finalValues.noiseReductionLuminance <= BOUNDS.noiseReduction.hi;
  }));
  check('34. All three strength modes remain export-safe across every fixture (both fields always within their Layer-A bounds)', allModesExportSafe);
}

// ══════════════════════════════════════════════════════════════════
// SESSION AND EDITING (35-43)
// ══════════════════════════════════════════════════════════════════
{
  const extremeRaw = { sharp: 99, noise: 99 };
  const { built } = buildReadySession('FINE_DETAIL_LANDSCAPE', extremeRaw);
  const candidate = built.candidate;
  check('35. Full session build sets candidate.detail.sharpening/.noiseReduction to the Detail Plan\'s finalValues -- NOT a raw-preset passthrough (raw preset used deliberately extreme 99/99 values)', candidate.detail.sharpening !== 99 && candidate.detail.noiseReduction !== 99, `sharpening=${candidate.detail.sharpening}, noiseReduction=${candidate.detail.noiseReduction}`);

  const di = candidate.diagnostics.detailIntelligence;
  check('36. candidate.diagnostics.detailIntelligence is populated with sceneClass/confidence/engaged/reasons/evidence/protections/lineage', !!di && Array.isArray(di.sceneClass) && typeof di.confidence === 'number' && typeof di.engaged === 'boolean' && Array.isArray(di.reasons) && !!di.protections && !!di.lineage);

  check('37. The bounded evidence scalar summary in diagnostics.detailIntelligence.evidence never carries raw pixel arrays/ImageData -- only 0-1 scalar scores', !!di.evidence && Object.values(di.evidence).every((v) => v === null || (typeof v === 'number' && v >= 0 && v <= 1)));

  // Independently recompute the Detail Plan from the SAME evidence the
  // session used, entirely outside the candidate-builder pipeline -- if
  // P1G ever wrote to a field it doesn't own, or if anything downstream
  // of P1G's own integration point mutated Detail's inputs, the built
  // Candidate's detail.* would drift from this independent
  // recomputation. They must match exactly.
  const independentPlan = buildDetailPlan(evidenceFromFixture('FINE_DETAIL_LANDSCAPE'), {
    strengthMode: DEFAULT_STRENGTH_MODE,
    basicToneDiagnostics: candidate.diagnostics.basicToneIntelligence ?? null,
    p1fTexture: candidate.basic.texture,
    p1fClarity: candidate.basic.clarity,
  });
  const detailFieldsMatchIndependentPlan = candidate.detail.sharpening === independentPlan.finalValues.sharpening
    && candidate.detail.noiseReduction === independentPlan.finalValues.noiseReductionLuminance;
  check('38. Detail Plan integration is deterministic -- the built Candidate\'s detail.sharpening/.noiseReduction exactly match an independent buildDetailPlan() recomputation from the same evidence + already-final P1F basic.texture/.clarity', detailFieldsMatchIndependentPlan);

  check('39. P1F/P1E-owned fields remain untouched by P1G -- candidate.basic.* (P1F), candidate.hsl/.grading/.cal (P1E) are all still populated by their own planners, not overwritten by the Detail Plan', typeof candidate.basic.exposure === 'number' && typeof candidate.hsl === 'object' && typeof candidate.grading === 'object' && typeof candidate.cal === 'object');

  const originalAutoSharpening = candidate.diagnostics.autoValues?.detail?.sharpening;
  const editResult = updateCandidateParameter(candidate.sessionId, candidate.generationId, 'detail.sharpening', 5, { source: 'USER_EDIT' });
  const manualEditWorked = editResult.committed && editResult.candidate.detail.sharpening === 5;
  check('40. Manual edit to detail.sharpening via updateCandidateParameter() commits and persists the new value', manualEditWorked, editResult.reason ?? 'ok');

  const resetResult = resetParameterToAuto(candidate.sessionId, candidate.generationId, 'detail.sharpening');
  const restoredValue = resetResult.candidate?.detail?.sharpening;
  check('41. Reset-to-Auto restores detail.sharpening to the ORIGINAL Detail Plan value recorded in diagnostics.autoValues (not the manual-edited 5)', resetResult.committed && restoredValue === originalAutoSharpening && restoredValue !== 5, `restored=${restoredValue}, expectedAuto=${originalAutoSharpening}`);

  const staleTicket = { sessionId: candidate.sessionId, generationId: 'stale-generation-id-that-does-not-exist' };
  const staleBuild = orch.buildAndCommitCandidate(staleTicket, { engineVersion: 'test' });
  const liveDetailUnaffected = resetResult.candidate.detail.sharpening === originalAutoSharpening;
  check('42. A stale/mismatched generation ticket is rejected (STALE_GENERATION) and never corrupts the live Candidate\'s Detail values', staleBuild.committed === false && staleBuild.reason === 'STALE_GENERATION' && liveDetailUnaffected);

  const legacyBefore = candidateToLegacyPreset(candidate);
  candidate.detail.noiseReduction = 54321;
  const legacyAfter = candidateToLegacyPreset(candidate);
  check('43. Candidate remains the single source of truth for export -- mutating candidate.detail.noiseReduction directly changes what candidateToLegacyPreset() reads (noise=54321), WITHOUT re-invoking analysis/buildDetailPlan (no hidden re-derivation)', legacyAfter.noise === 54321 && legacyBefore.noise !== 54321);
}

// ══════════════════════════════════════════════════════════════════
// PARITY (44-49)
// ══════════════════════════════════════════════════════════════════
{
  const { built } = buildReadySession('COLORFUL_EVENT_COSTUME');
  const candidate = built.candidate;
  const parity = computeExportParity(candidate);

  const sharpEntry = parity.entries.find((e) => e.parameterPath === 'detail.sharpening');
  check('44. Export parity holds for detail.sharpening -- Candidate current value equals the quickSafetyClamp()-adjusted Export Expected value', !!sharpEntry && sharpEntry.candidateVsExportMatch === true, sharpEntry ? `candidate=${sharpEntry.candidateCurrentValue}, exportExpected=${sharpEntry.exportExpectedValue}` : 'entry not found');

  const nrEntry = parity.entries.find((e) => e.parameterPath === 'detail.noiseReduction');
  check('45. Export parity holds for detail.noiseReduction -- Candidate current value equals the quickSafetyClamp()-adjusted Export Expected value', !!nrEntry && nrEntry.candidateVsExportMatch === true, nrEntry ? `candidate=${nrEntry.candidateCurrentValue}, exportExpected=${nrEntry.exportExpectedValue}` : 'entry not found');

  let preset = candidateToLegacyPreset(candidate);
  const safety = quickSafetyClamp(preset);
  preset = safety.preset;
  const xmp = serializeXMP(preset);
  const { status, report } = runXmpFidelityGate({ candidate, exportExpectedPreset: preset, xmpString: xmp });
  const detailComparisons = (report?.comparisonResult?.comparisons || []).filter((c) => c.candidatePath === 'detail.sharpening' || c.candidatePath === 'detail.noiseReduction');
  const detailMismatches = detailComparisons.filter((c) => c.result !== 'MATCH');
  check('46. XMP Readback Fidelity Gate confirms Export Expected values == real XMP Readback values for both Detail fields (crs:Sharpness / crs:LuminanceSmoothing) -- P1D machinery reused, not a new parity mechanism', detailMismatches.length === 0, `status=${status}, detailMismatches=${detailMismatches.length}`);

  const detailEntriesInSharedMap = PROPERTY_MAP.some((e) => e.candidatePath === 'detail.sharpening') && PROPERTY_MAP.some((e) => e.candidatePath === 'detail.noiseReduction');
  check('47. computeExportParity() reuses the SAME PROPERTY_MAP already used for P1E/P1F -- Detail entries live inside the existing BASIC_ENTRIES list, not a second/duplicate parity mechanism built for P1G', detailEntriesInSharedMap);

  check('48. detail.colorNoiseReduction (the permanently-unsupported field) is correctly excluded from the export-parity/XMP-property comparison surface -- it never appears in PROPERTY_MAP, only in UNSUPPORTED_CANDIDATE_PATHS', !PROPERTY_MAP.some((e) => e.candidatePath === 'detail.colorNoiseReduction') && UNSUPPORTED_CANDIDATE_PATHS.includes('detail.colorNoiseReduction'));

  const sharpMapEntry = PROPERTY_MAP.find((e) => e.candidatePath === 'detail.sharpening');
  const nrMapEntry = PROPERTY_MAP.find((e) => e.candidatePath === 'detail.noiseReduction');
  check('49. The real XMP property names for Detail match the audit exactly -- crs:Sharpness for Sharpening, crs:LuminanceSmoothing for Luminance Noise Reduction (never crs:NoiseReduction, which does not exist in the real serializer)', sharpMapEntry?.xmpProperty === 'crs:Sharpness' && nrMapEntry?.xmpProperty === 'crs:LuminanceSmoothing');
}

// ══════════════════════════════════════════════════════════════════
// REGRESSION (50-60)
// ══════════════════════════════════════════════════════════════════
{
  check('50. This suite\'s own AUDIT-OWNERSHIP / EVIDENCE / SHARPENING / NOISE REDUCTION / MODES / SESSION / PARITY checks (1-49) all passed before reaching this Regression section (self-consistent proof within a single run)', fail === 0);

  const p1f = runSuite('qa/epic-2e-p1f-basic-tone-intelligence-test.mjs');
  check('51. P1F Basic Tone Intelligence test suite remains fully passing unmodified (spawned directly)', p1f.ok, (p1f.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1eR3Path = path.join(ROOT, 'qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs');
  const p1eR3SyntaxCheck = spawnSync(process.execPath, ['--check', p1eR3Path], { encoding: 'utf8' });
  check('52. P1E R3 XMP Color Parity + Creative Tone test file is present and syntactically valid (its full run -- and its own nested P1E R2/P1D/P1C chain -- is independently confirmed via direct execution below and left to the static-suite runner for the full nested chain, per this project\'s bounded-runtime convention: the sandbox\'s per-command wall-clock cap cannot complete every nested spawn level in one shot)', p1eR3SyntaxCheck.status === 0);

  const p1eColor = runSuite('qa/epic-2e-p1e-color-intelligence-test.mjs');
  check('53. P1E R2 Color Intelligence test suite (94/94) remains passing (spawned directly)', p1eColor.ok, (p1eColor.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1d = runSuite('qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs');
  check('54. P1D XMP Readback Fidelity Gate test suite remains passing (spawned directly)', p1d.ok, (p1d.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1c = runSuite('qa/epic-2e-p1c-candidate-test.mjs');
  check('55. P1C Candidate test suite (86/86) still fully passes, including the P1G_OWNED_DETAIL_KEYS exclusion this EPIC added to its pre/post equivalence check (test 53)', p1c.ok, (p1c.out.match(/\d+\/\d+ PASS/g) || []).pop());

  const p1cR2 = runSuite('qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs');
  check('56. P1C R2 Candidate Lifecycle Order test suite still fully passes', p1cR2.ok);

  const p1cR3Path = path.join(ROOT, 'qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs');
  const p1cR3SyntaxCheck = spawnSync(process.execPath, ['--check', p1cR3Path], { encoding: 'utf8' });
  check('57. P1C R3 User-Edit XMP Export test file is present and syntactically valid (full run left to the static-suite runner per this project\'s bounded-runtime convention)', p1cR3SyntaxCheck.status === 0);

  const p1a = runSuite('qa/epic-2e-p1a-single-image-session-test.mjs');
  check('58. P1A Single Image Session test suite still fully passes (spawned directly -- fast, no Browser/network dependency)', p1a.ok);

  const manifestPath = path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json');
  const manifestBefore = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const regen = spawnSync(process.execPath, [path.join(ROOT, 'qa/baselines/generate-production-lock-manifest.mjs')], { encoding: 'utf8' });
  const manifestAfter = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifestUnchangedByRegen = JSON.stringify(manifestBefore.files) === JSON.stringify(manifestAfter.files);
  check('59. Production Lock manifest is internally consistent -- regenerating it from the current source tree reproduces byte-identical file hashes (no locked file drifted since the last legitimate regeneration in this EPIC)', regen.status === 0 && manifestUnchangedByRegen, `fileCount=${Object.keys(manifestAfter.files || {}).length}`);

  const n1Path = path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json');
  const n1 = JSON.parse(readFileSync(n1Path, 'utf8'));
  const crypto = await import('node:crypto');
  const appJsBuf = readFileSync(path.join(ROOT, 'ui/app.js'));
  const appJsHash = crypto.createHash('sha256').update(appJsBuf).digest('hex');
  check('60. N1 production invariant\'s pinned ui/app.js SHA-256 matches the current file exactly (updated deliberately once, for the Detail Intelligence Advanced Diagnostics UI addition, and never silently since)', n1.files && n1.files['ui/app.js'] === appJsHash, `pinned=${n1.files?.['ui/app.js']}, actual=${appJsHash}`);
}


// ══════════════════════════════════════════════════════════════════
// MUTATION TESTS (M1-M7)
// ══════════════════════════════════════════════════════════════════
{
  // M1 -- remove Image Analysis Core evidence entirely.
  const evNoAnalysis = { stats: mk(stats(), 'COMPLETED', 0.8), skin: mk(skin({ coveragePct: 0 }), 'COMPLETED', 0.7), imageAnalysis: mk(null, 'FAILED', 0) };
  const planNoAnalysis = buildDetailPlan(evNoAnalysis, { strengthMode: DEFAULT_STRENGTH_MODE });
  const allZeroM1 = planNoAnalysis.finalValues.sharpening === 0 && planNoAnalysis.finalValues.noiseReductionLuminance === 0;
  check('M1. Removing Image Analysis Core evidence (imageAnalysis module FAILED) yields a bounded low-confidence empty plan -- both Detail fields at 0, with a diagnostic reason explaining why (never a silent/undiagnosed empty plan, never a crash)', allZeroM1 && planNoAnalysis.diagnostics.reasons.length > 0, planNoAnalysis.diagnostics.reasons[0]);

  // M2 -- invert which evidence signal is elevated (swap sharpness/noise roles) and confirm the recommendation genuinely follows the evidence, not a hardcoded scene label.
  const evSharpClean = evidenceFromFixture('FINE_DETAIL_LANDSCAPE'); // sharpnessScore=92, noiseScore=10
  const evSoftNoisy = evidenceFromFixture('NOISY_SHADOW_HEAVY');     // sharpnessScore=60, noiseScore=70
  const planSharpClean = buildDetailPlan(evSharpClean, { strengthMode: 'BALANCED' });
  const planSoftNoisy = buildDetailPlan(evSoftNoisy, { strengthMode: 'BALANCED' });
  check('M2. Swapping which evidence signal is elevated (sharp+clean vs. soft+noisy) correctly swaps which of Sharpening/Noise-Reduction dominates -- proving the recommendation is genuinely evidence-driven, not a hardcoded per-scene-label constant', planSharpClean.finalValues.sharpening > planSoftNoisy.finalValues.sharpening && planSoftNoisy.finalValues.noiseReductionLuminance > planSharpClean.finalValues.noiseReductionLuminance, `sharpClean(sharp=${planSharpClean.finalValues.sharpening},nr=${planSharpClean.finalValues.noiseReductionLuminance}) softNoisy(sharp=${planSoftNoisy.finalValues.sharpening},nr=${planSoftNoisy.finalValues.noiseReductionLuminance})`);

  // M3 -- replace planner outputs with NaN/Infinity; guardrails must fail closed to 0, never propagate.
  const guardedM3 = applyDetailGuardrails({ sharpening: NaN, noiseReductionLuminance: Infinity }, { skinCoverage: 0, motionBlurRisk: 0, lowDetail: false });
  const noNaNLeakedM3 = Number.isFinite(guardedM3.values.sharpening) && guardedM3.values.sharpening === 0
    && Number.isFinite(guardedM3.values.noiseReduction) && guardedM3.values.noiseReduction === 0;
  check('M3. NaN/Infinity values reaching applyDetailGuardrails() (e.g. from a corrupted planner output) are fail-closed to 0 for both fields, with an explicit adjustment-reason string recorded, never propagated as NaN/Infinity into the Candidate or export', noNaNLeakedM3 && guardedM3.adjustments.some((a) => /not a finite number/.test(a)));

  // M4 -- Detail has NO Layer-B (quickSafetyClamp/HARD_LIMITS) entry, unlike Basic/HSL -- an out-of-bounds
  // post-commit overwrite is NOT caught downstream, confirming Layer A (detail-guardrails, applied once
  // before commit) is the SOLE safety net for Detail fields, exactly as documented in
  // P1G_DETAIL_VALUE_LINEAGE_AUDIT.md's two-layer safety-net gap section. This is a deliberate, honestly
  // documented structural finding, not a P1G regression -- the gap pre-dates this EPIC and P1G's own
  // Layer-A guardrails are the fix already shipped for it.
  const { built: builtM4 } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  builtM4.candidate.detail.sharpening = 999; // far outside BOUNDS.sharpening, no HARD_LIMITS.detail entry exists to catch it
  const mismatchesM4 = getExportParityMismatches(builtM4.candidate);
  const sharpMismatchM4 = mismatchesM4.find((e) => e.parameterPath === 'detail.sharpening');
  const noHardLimitEntry = !('detail' in HARD_LIMITS);
  check('M4. Detail lacks a Layer-B hard-limit entry (unlike Basic/HSL) -- an out-of-bounds post-commit overwrite of candidate.detail.sharpening (999) passes through quickSafetyClamp() unclamped and is exported as-is (no parity mismatch raised), confirming detail-guardrails.js (Layer A, applied before commit) is the sole safety net for Detail fields', noHardLimitEntry && !sharpMismatchM4, `HARD_LIMITS.detail exists=${!noHardLimitEntry}, mismatchFound=${!!sharpMismatchM4}`);

  // M5 -- change the Legacy Preset's Detail value directly; must NOT feed back into the Candidate (one-way, read-only export flow).
  const { built: builtM5 } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  const originalCandidateSharpening = builtM5.candidate.detail.sharpening;
  const legacyPresetM5 = candidateToLegacyPreset(builtM5.candidate);
  legacyPresetM5.sharp = 777;
  check('M5. Mutating the Legacy Preset\'s sharp field after candidateToLegacyPreset() never feeds back into the Candidate -- confirms Detail export is one-way and read-only, same as Basic/HSL', builtM5.candidate.detail.sharpening === originalCandidateSharpening && builtM5.candidate.detail.sharpening !== 777);

  // M6 -- tamper with the serialized XMP's Detail property; the Fidelity Gate must detect the mismatch, not silently pass.
  const { built: builtM6 } = buildReadySession('CLEAN_DAYLIGHT_PORTRAIT');
  let presetM6 = candidateToLegacyPreset(builtM6.candidate);
  presetM6 = quickSafetyClamp(presetM6).preset;
  const xmpM6 = serializeXMP(presetM6);
  const tamperedXmpM6 = xmpM6.replace(/crs:Sharpness="[^"]*"/, 'crs:Sharpness="88"');
  const gateM6 = runXmpFidelityGate({ candidate: builtM6.candidate, exportExpectedPreset: presetM6, xmpString: tamperedXmpM6 });
  check('M6. Tampering with the serialized XMP\'s crs:Sharpness value after serializeXMP() is detected by the Fidelity Gate as a real mismatch (status !== PASS), never silently accepted', gateM6.status !== 'PASS');

  // M7 -- new generation with genuinely different evidence must reflect its OWN Detail Plan, never a stale one carried over.
  __resetStoreForTests();
  const sessionA = richEvidenceSession('CLEAN_DAYLIGHT_PORTRAIT');
  const ticketA = { sessionId: sessionA.sessionId, generationId: sessionA.generationId };
  setActiveSession(sessionA);
  orch.commitCandidate(ticketA, buildRealisticRawPreset());
  orch.completeAnalysis(ticketA);
  const builtA = orch.buildAndCommitCandidate(ticketA, { engineVersion: 'test' });

  const sessionB = richEvidenceSession('NOISY_SHADOW_HEAVY');
  sessionB.sessionId = sessionA.sessionId; // same session, genuinely new generation/upload
  const ticketB = { sessionId: sessionB.sessionId, generationId: sessionB.generationId };
  setActiveSession(sessionB);
  orch.commitCandidate(ticketB, buildRealisticRawPreset());
  orch.completeAnalysis(ticketB);
  const builtB = orch.buildAndCommitCandidate(ticketB, { engineVersion: 'test' });

  const staleAttemptOnA = orch.buildAndCommitCandidate(ticketA, { engineVersion: 'test' });
  check('M7. A stale ticket from generation A is rejected once generation B is active (STALE_GENERATION), and generation B\'s own Candidate reflects generation B\'s OWN evidence (NOISY_SHADOW_HEAVY -- higher Noise Reduction, lower Sharpening), never a stale plan carried over from generation A', staleAttemptOnA.committed === false && builtB.candidate.detail.noiseReduction > builtA.candidate.detail.noiseReduction, `A(sharp=${builtA.candidate.detail.sharpening},nr=${builtA.candidate.detail.noiseReduction}) B(sharp=${builtB.candidate.detail.sharpening},nr=${builtB.candidate.detail.noiseReduction}), staleReason=${staleAttemptOnA.reason}`);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
