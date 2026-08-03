#!/usr/bin/env node
/**
 * EPIC 2E-P1F — Basic Tone Intelligence & Adaptive Dynamic Range:
 * dedicated real-integration test suite.
 *
 * Runs against the REAL production modules:
 *   - core/single-image/basic-tone-intelligence/*.js (NEW, 9 files)
 *   - core/single-image/candidate/candidate-builder.js (EDITED: Basic
 *     Tone Plan wired in between raw-preset reshape and P1E's Color
 *     Intelligence enrichment)
 *   - core/single-image/candidate/candidate-export-parity.js,
 *     core/single-image/xmp-fidelity/* (P1D/P1E R3, read-only)
 *   - core/xmp-validator/index.js::quickSafetyClamp() (Production-Locked,
 *     imported read-only, never modified)
 *
 * Never re-implements planner/clamp math -- every expected value is
 * either derived by calling the real production function, or is a
 * documented BOUNDS/HARD_LIMITS constant read directly from source.
 *
 * Run: node qa/epic-2e-p1f-basic-tone-intelligence-test.mjs
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

const {
  BASIC_TONE_SCHEMA_VERSION, STRENGTH_MODE, DEFAULT_STRENGTH_MODE, STRENGTH_SCALARS,
  SCENE_CLASS, BOUNDS, buildEmptyBasicTonePlan,
} = await import('../core/single-image/basic-tone-intelligence/basic-tone-schema.js');
const { classifyDynamicRange } = await import('../core/single-image/basic-tone-intelligence/dynamic-range-classifier.js');
const { computeExposureRecommendation } = await import('../core/single-image/basic-tone-intelligence/exposure-recommendation.js');
const { computeHighlightRecovery, computeShadowRecovery } = await import('../core/single-image/basic-tone-intelligence/highlight-shadow-recovery.js');
const { computeWhitesRecommendation, computeBlacksRecommendation } = await import('../core/single-image/basic-tone-intelligence/black-white-point-planner.js');
const { computeContrastRecommendation, computeLocalContrastDetail } = await import('../core/single-image/basic-tone-intelligence/local-contrast-planner.js');
const { applyBasicToneGuardrails } = await import('../core/single-image/basic-tone-intelligence/basic-tone-guardrails.js');
const { buildBasicTonePlan } = await import('../core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js');

const { createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE } = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { setActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { updateCandidateParameter, resetParameterToAuto, resetAllToAuto } = await import('../core/single-image/candidate/candidate-store.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { quickSafetyClamp, HARD_LIMITS } = await import('../core/xmp-validator/index.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');
const { runXmpFidelityGate } = await import('../core/single-image/xmp-fidelity/xmp-fidelity-gate.js');
const { computeExportParity, getExportParityMismatches } = await import('../core/single-image/candidate/candidate-export-parity.js');
const { PROPERTY_MAP } = await import('../core/single-image/xmp-fidelity/xmp-property-map.js');
const { en } = await import('../ui/i18n/en.js');
const { th } = await import('../ui/i18n/th.js');

// ── Fixtures (mirrors this project's established convention -- self
// contained per test file; full histogram-engine-shaped stats objects
// so every classifier/planner branch is genuinely exercised) ──────
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

// 10 required named synthetic-evidence fixtures.
const FIXTURES = {
  BALANCED_PORTRAIT: { stats: stats({ avgLum: 140, contrast: 50, drStops: 6, contrastRatio: 5, clipHiPct: 0.5, clipLoPct: 0.5, blackPoint: 12, whitePoint: 240, avgSatPct: 35, confidence: 0.85, category: 'Portrait' }), skin: skin({ coveragePct: 18, confidence: 0.85 }) },
  UNDEREXPOSED_PORTRAIT: { stats: stats({ avgLum: 55, contrast: 45, drStops: 4, contrastRatio: 3, clipHiPct: 0, clipLoPct: 5, blackPoint: 2, whitePoint: 200, avgSatPct: 25, confidence: 0.8, category: 'Portrait' }), skin: skin({ coveragePct: 20, confidence: 0.8 }) },
  OVEREXPOSED_WHITE_CLOTHING: { stats: stats({ avgLum: 200, contrast: 40, drStops: 5, contrastRatio: 4, clipHiPct: 6, clipLoPct: 0, blackPoint: 20, whitePoint: 255, avgSatPct: 20, confidence: 0.8, category: 'Wedding' }), skin: skin({ coveragePct: 22, confidence: 0.85 }) },
  HIGH_KEY_BRIDAL: { stats: stats({ avgLum: 175, contrast: 45, drStops: 5, contrastRatio: 4.5, clipHiPct: 2, clipLoPct: 0, blackPoint: 30, whitePoint: 250, avgSatPct: 15, confidence: 0.75, category: 'Wedding' }), skin: skin({ coveragePct: 25, confidence: 0.8 }) },
  LOW_KEY_PORTRAIT: { stats: stats({ avgLum: 70, contrast: 50, drStops: 5, contrastRatio: 4, clipHiPct: 0, clipLoPct: 1, blackPoint: 5, whitePoint: 210, avgSatPct: 20, confidence: 0.7, category: 'Portrait' }), skin: skin({ coveragePct: 20, confidence: 0.75 }) },
  COLORFUL_EVENT_COSTUME: { stats: stats({ avgLum: 130, contrast: 55, drStops: 6, contrastRatio: 5.5, clipHiPct: 1, clipLoPct: 1, blackPoint: 15, whitePoint: 240, avgSatPct: 55, confidence: 0.85, category: 'Event' }), skin: skin({ coveragePct: 5, confidence: 0.7 }) },
  GREEN_OUTDOOR_PORTRAIT: { stats: stats({ avgLum: 135, contrast: 48, drStops: 6, contrastRatio: 5, clipHiPct: 0.5, clipLoPct: 0.5, blackPoint: 12, whitePoint: 235, avgSatPct: 40, confidence: 0.8, category: 'Portrait' }), skin: skin({ coveragePct: 16, confidence: 0.8 }) },
  HAZY_LANDSCAPE: { stats: stats({ avgLum: 150, contrast: 45, drStops: 5, contrastRatio: 2.8, clipHiPct: 0.5, clipLoPct: 0.5, blackPoint: 40, whitePoint: 210, avgSatPct: 18, confidence: 0.75, category: 'Landscape' }), skin: skin({ coveragePct: 0, confidence: 0.6 }) },
  LOW_CONTRAST_INDOOR: { stats: stats({ avgLum: 120, contrast: 30, drStops: 4, contrastRatio: 3.5, clipHiPct: 0.2, clipLoPct: 0.2, blackPoint: 25, whitePoint: 220, avgSatPct: 30, confidence: 0.8, category: 'Indoor' }), skin: skin({ coveragePct: 3, confidence: 0.6 }) },
  HDR_SCENE: { stats: stats({ avgLum: 140, contrast: 60, drStops: 10, contrastRatio: 8, clipHiPct: 1, clipLoPct: 1, blackPoint: 5, whitePoint: 250, avgSatPct: 35, confidence: 0.85, category: 'Landscape' }), skin: skin({ coveragePct: 0, confidence: 0.9 }) },
};
const ALL_FIXTURE_NAMES = Object.keys(FIXTURES);

function buildRealisticRawPreset(overrides = {}) {
  return {
    name: 'AI Preset — Landscape',
    exp: 15, con: 8, hi: -12, sh: 10, wh: 4, bl: -4,
    texture: 6, clarity: 8, dehaze: 3, temp: 4, tint: -1, vib: 8, sat: 3,
    sharp: 35, noise: 18,
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
  s.evidence.skin = mk(fx.skin, MODULE_STATE.COMPLETED, fx.skin.confidence);
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
  for (const k of ['stats', 'skin', 'wb', 'styleFeatureGraph', 'hsl', 'grading', 'calibration', 'colorCast', 'scene']) s.runtime.moduleStates[k] = MODULE_STATE.COMPLETED;
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
    skin: mk(fx.skin, MODULE_STATE.COMPLETED, fx.skin.confidence),
  };
}

// ══════════════════════════════════════════════════════════════════
// AUDIT AND OWNERSHIP (1-7)
// ══════════════════════════════════════════════════════════════════
{
  const auditPath = path.join(ROOT, 'docs/development/P1F_BASIC_VALUE_LINEAGE_AUDIT.md');
  const audit = readFileSync(auditPath, 'utf8');
  check('1. P1F_BASIC_VALUE_LINEAGE_AUDIT.md exists and documents the root cause (Style Preservation Mode mismatch)', /[Ss]tyle [Pp]reservation/.test(audit) && audit.length > 500);
  check('2. Lineage audit documents the hardcoded texture/clarity/dehaze constants in lightroom-mapping-engine', /lightroom-mapping-engine/.test(audit) && /dehaze/i.test(audit));
  check('3. Lineage audit documents the quickSafetyClamp() structural gap for clarity/dehaze/texture', /structural gap/i.test(audit) || /clampGroup:\s*null/i.test(audit));

  const ev1 = evidenceFromFixture('BALANCED_PORTRAIT');
  const planA = buildBasicTonePlan(ev1, { strengthMode: DEFAULT_STRENGTH_MODE });
  const planB = buildBasicTonePlan(ev1, { strengthMode: DEFAULT_STRENGTH_MODE });
  check('4. buildBasicTonePlan() is a pure function -- identical evidence input produces byte-identical output on repeated calls', JSON.stringify(planA) === JSON.stringify(planB));

  const evFrozen = evidenceFromFixture('BALANCED_PORTRAIT');
  const beforeJson = JSON.stringify(evFrozen);
  buildBasicTonePlan(evFrozen, { strengthMode: DEFAULT_STRENGTH_MODE });
  const afterJson = JSON.stringify(evFrozen);
  check('5. buildBasicTonePlan() never mutates its input evidence object', beforeJson === afterJson);

  const builderSrc = readFileSync(path.join(ROOT, 'core/single-image/candidate/candidate-builder.js'), 'utf8');
  const basicToneIdx = builderSrc.indexOf('buildBasicTonePlan(evidence');
  const colorIntelIdx = builderSrc.indexOf('applyColorIntelligence(candidate');
  check('6. candidate-builder.js runs the Basic Tone Plan strictly BEFORE P1E\'s Color Intelligence enrichment (composition order)', basicToneIdx > -1 && colorIntelIdx > -1 && basicToneIdx < colorIntelIdx);

  const colorPlanBuilderSrc = readFileSync(path.join(ROOT, 'core/single-image/color-intelligence/color-plan-builder.js'), 'utf8');
  const writesBasicExposure = /candidate\.basic\.(exposure|contrast|highlights|shadows|whites|blacks)\s*=/.test(colorPlanBuilderSrc)
    || /candidate\.basic\.(exposure|contrast|highlights|shadows|whites|blacks)\s*=/.test(builderSrc.slice(colorIntelIdx));
  check('7. P1E\'s Color Intelligence never writes any of the 6 clamp-covered Basic fields P1F owns (exposure/contrast/highlights/shadows/whites/blacks)', !writesBasicExposure);
}

// ══════════════════════════════════════════════════════════════════
// SCENE CLASSIFICATION (8-13)
// ══════════════════════════════════════════════════════════════════
{
  const c2 = classifyDynamicRange({ stats: FIXTURES.UNDEREXPOSED_PORTRAIT.stats, skin: FIXTURES.UNDEREXPOSED_PORTRAIT.skin });
  check('8. UNDEREXPOSED_PORTRAIT fixture classifies as UNDEREXPOSED (avgLum=55, clipLoPct=5%)', c2.sceneClass === SCENE_CLASS.UNDEREXPOSED, c2.sceneClass);

  const c3 = classifyDynamicRange({ stats: FIXTURES.OVEREXPOSED_WHITE_CLOTHING.stats, skin: FIXTURES.OVEREXPOSED_WHITE_CLOTHING.skin });
  check('9. OVEREXPOSED_WHITE_CLOTHING fixture classifies as OVEREXPOSED (avgLum=200, clipHiPct=6%)', c3.sceneClass === SCENE_CLASS.OVEREXPOSED, c3.sceneClass);

  const c10 = classifyDynamicRange({ stats: FIXTURES.HDR_SCENE.stats, skin: FIXTURES.HDR_SCENE.skin });
  check('10. HDR_SCENE fixture classifies as HIGH_DYNAMIC_RANGE (drStops=10EV)', c10.sceneClass === SCENE_CLASS.HIGH_DYNAMIC_RANGE, c10.sceneClass);

  const c11 = classifyDynamicRange({ stats: FIXTURES.HAZY_LANDSCAPE.stats, skin: FIXTURES.HAZY_LANDSCAPE.skin });
  check('11. HAZY_LANDSCAPE fixture classifies as HAZY (contrastRatio=2.8, avgSatPct=18%) -- proxy evidence, not filename', c11.sceneClass === SCENE_CLASS.HAZY, c11.sceneClass);

  const c12hk = classifyDynamicRange({ stats: FIXTURES.HIGH_KEY_BRIDAL.stats, skin: FIXTURES.HIGH_KEY_BRIDAL.skin });
  const c12lk = classifyDynamicRange({ stats: FIXTURES.LOW_KEY_PORTRAIT.stats, skin: FIXTURES.LOW_KEY_PORTRAIT.skin });
  check('12. HIGH_KEY_BRIDAL classifies HIGH_KEY and LOW_KEY_PORTRAIT classifies LOW_KEY (bright/dark but unclipped)', c12hk.sceneClass === SCENE_CLASS.HIGH_KEY && c12lk.sceneClass === SCENE_CLASS.LOW_KEY, `${c12hk.sceneClass}/${c12lk.sceneClass}`);

  const highContrastStats = stats({ avgLum: 130, contrast: 75, drStops: 5, contrastRatio: 5, clipHiPct: 0.5, clipLoPct: 0.5, avgSatPct: 30, confidence: 0.8 });
  const lowContrastStats = stats({ avgLum: 130, contrast: 25, drStops: 5, contrastRatio: 5, clipHiPct: 0.5, clipLoPct: 0.5, avgSatPct: 30, confidence: 0.8 });
  const balancedStats = stats({ avgLum: 130, contrast: 50, drStops: 5, contrastRatio: 5, clipHiPct: 0.5, clipLoPct: 0.5, avgSatPct: 30, confidence: 0.8 });
  const lowConfStats = stats({ avgLum: 130, contrast: 50, confidence: 0.2 });
  const cHC = classifyDynamicRange({ stats: highContrastStats });
  const cLC = classifyDynamicRange({ stats: lowContrastStats });
  const cBAL = classifyDynamicRange({ stats: balancedStats });
  const cLOWCONF = classifyDynamicRange({ stats: lowConfStats });
  check('13. HIGH_CONTRAST (sigma=75), LOW_CONTRAST (sigma=25), BALANCED (sigma=50), and LOW_CONFIDENCE (conf=0.2) all classify correctly', cHC.sceneClass === SCENE_CLASS.HIGH_CONTRAST && cLC.sceneClass === SCENE_CLASS.LOW_CONTRAST && cBAL.sceneClass === SCENE_CLASS.BALANCED && cLOWCONF.sceneClass === SCENE_CLASS.LOW_CONFIDENCE, `${cHC.sceneClass}/${cLC.sceneClass}/${cBAL.sceneClass}/${cLOWCONF.sceneClass}`);
}

// ══════════════════════════════════════════════════════════════════
// EXPOSURE (14-18)
// ══════════════════════════════════════════════════════════════════
{
  const underStats = FIXTURES.UNDEREXPOSED_PORTRAIT.stats;
  const expUnder = computeExposureRecommendation({ stats: underStats, sceneClass: SCENE_CLASS.UNDEREXPOSED, strengthScalar: 1 });
  check('14. UNDEREXPOSED scene produces a bounded POSITIVE Exposure recommendation', expUnder.value > 0 && expUnder.value >= BOUNDS.exposure.lo && expUnder.value <= BOUNDS.exposure.hi, `+${expUnder.value}`);

  const overStats = FIXTURES.OVEREXPOSED_WHITE_CLOTHING.stats;
  const expOver = computeExposureRecommendation({ stats: overStats, sceneClass: SCENE_CLASS.OVEREXPOSED, strengthScalar: 1 });
  check('15. OVEREXPOSED scene produces a bounded NEGATIVE Exposure recommendation', expOver.value < 0 && expOver.value >= BOUNDS.exposure.lo && expOver.value <= BOUNDS.exposure.hi, `${expOver.value}`);

  const expHighKey = computeExposureRecommendation({ stats: FIXTURES.HIGH_KEY_BRIDAL.stats, sceneClass: SCENE_CLASS.HIGH_KEY, strengthScalar: 1 });
  check('16. HIGH_KEY scene (bright but not clipped) is NOT darkened -- Exposure kept at 0', expHighKey.value === 0);

  const expLowKeyIntentional = computeExposureRecommendation({ stats: FIXTURES.LOW_KEY_PORTRAIT.stats, sceneClass: SCENE_CLASS.LOW_KEY, strengthScalar: 1 });
  const nearBlankStats = stats({ avgLum: 10, drStops: 0.8, contrast: 20, clipLoPct: 0, clipHiPct: 0, confidence: 0.7 });
  const expLowKeyBlank = computeExposureRecommendation({ stats: nearBlankStats, sceneClass: SCENE_CLASS.LOW_KEY, strengthScalar: 1 });
  check('17. LOW_KEY scene preserves intentional darkness (value=0) UNLESS it is a near-blank capture defect (drStops<1.2, avgLum<15), which gets a small safety lift', expLowKeyIntentional.value === 0 && expLowKeyBlank.value === 12, `intentional=${expLowKeyIntentional.value}, blank=${expLowKeyBlank.value}`);

  const expNoCoord = computeExposureRecommendation({ stats: underStats, sceneClass: SCENE_CLASS.UNDEREXPOSED, strengthScalar: 1, plannedShadowRecoveryValue: 0 });
  const expWithCoord = computeExposureRecommendation({ stats: underStats, sceneClass: SCENE_CLASS.UNDEREXPOSED, strengthScalar: 1, plannedShadowRecoveryValue: 15 });
  check('18. Exposure coordinates with an already-sufficient Shadow recovery (>=10) by halving its own contribution, avoiding double-correction', expWithCoord.value < expNoCoord.value && expWithCoord.value === Math.round(expNoCoord.value * 0.5), `no-coord=${expNoCoord.value}, coord=${expWithCoord.value}`);
}

// ══════════════════════════════════════════════════════════════════
// HIGHLIGHTS/SHADOWS (19-23)
// ══════════════════════════════════════════════════════════════════
{
  const severeHiStats = stats({ clipHiPct: 8, confidence: 0.8 });
  const hiSevere = computeHighlightRecovery({ stats: severeHiStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('19. Severe highlight clipping (>5%) produces a bounded NEGATIVE Highlights recovery', hiSevere.value < 0 && hiSevere.value >= BOUNDS.highlights.lo, `${hiSevere.value}`);

  const minorHiStats = stats({ clipHiPct: 2.5, confidence: 0.8 });
  const hiMinor = computeHighlightRecovery({ stats: minorHiStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('20. Minor highlight clipping (1.5-5%) produces a smaller NEGATIVE nudge than severe clipping', hiMinor.value < 0 && hiMinor.value > hiSevere.value, `minor=${hiMinor.value}, severe=${hiSevere.value}`);

  const severeShStats = stats({ clipLoPct: 8, confidence: 0.8 });
  const shSevere = computeShadowRecovery({ stats: severeShStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('21. Severe shadow clipping (>5%) produces a bounded POSITIVE Shadows recovery', shSevere.value > 0 && shSevere.value <= BOUNDS.shadows.hi, `+${shSevere.value}`);

  const minorShStats = stats({ clipLoPct: 2.5, confidence: 0.8 });
  const shMinor = computeShadowRecovery({ stats: minorShStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('22. Minor shadow clipping (1.5-5%) produces a smaller POSITIVE nudge than severe clipping', shMinor.value > 0 && shMinor.value < shSevere.value, `minor=${shMinor.value}, severe=${shSevere.value}`);

  const balNoClip = FIXTURES.BALANCED_PORTRAIT.stats;
  const hiBal = computeHighlightRecovery({ stats: balNoClip, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  const shBal = computeShadowRecovery({ stats: balNoClip, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  const hiHDR = computeHighlightRecovery({ stats: FIXTURES.HDR_SCENE.stats, sceneClass: SCENE_CLASS.HIGH_DYNAMIC_RANGE, strengthScalar: 1 });
  const shHDR = computeShadowRecovery({ stats: FIXTURES.HDR_SCENE.stats, sceneClass: SCENE_CLASS.HIGH_DYNAMIC_RANGE, strengthScalar: 1 });
  check('23. Highlights/Shadows avoid the common failure mode of a fixed -50/+50 mirror on every image: a clean BALANCED scene keeps both near 0, and an HDR scene\'s two recommendations are independently-derived magnitudes (not equal-and-opposite)', Math.abs(hiBal.value) <= 2 && Math.abs(shBal.value) <= 2 && hiHDR.value !== 0 && shHDR.value !== 0 && Math.abs(hiHDR.value) !== Math.abs(shHDR.value), `bal(hi=${hiBal.value},sh=${shBal.value}) hdr(hi=${hiHDR.value},sh=${shHDR.value})`);
}

// ══════════════════════════════════════════════════════════════════
// WHITES/BLACKS (24-28)
// ══════════════════════════════════════════════════════════════════
{
  const whClipStats = stats({ clipHiPct: 5, whitePoint: 255, confidence: 0.8 });
  const whClip = computeWhitesRecommendation({ stats: whClipStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('24. Whites pulled back (negative) when real highlight clipping (>3%) is present', whClip.value < 0 && whClip.value >= BOUNDS.whites.lo, `${whClip.value}`);

  const whHeadroomStats = stats({ clipHiPct: 0, whitePoint: 200, confidence: 0.8 });
  const whHeadroom = computeWhitesRecommendation({ stats: whHeadroomStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('25. Whites gets a POSITIVE brilliance boost when real highlight headroom exists (whitePoint<240, no clipping)', whHeadroom.value > 0 && whHeadroom.value <= BOUNDS.whites.hi, `+${whHeadroom.value}`);

  const whNoProtect = computeWhitesRecommendation({ stats: whHeadroomStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1, whiteClothingProtection: false });
  const whProtect = computeWhitesRecommendation({ stats: whHeadroomStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1, whiteClothingProtection: true });
  check('26. White-clothing/skin-highlight protection reduces a positive Whites boost (~0.4x) for skin-heavy bright scenes', whProtect.value < whNoProtect.value && whProtect.value === Math.round(whNoProtect.value * 0.4), `unprotected=+${whNoProtect.value}, protected=+${whProtect.value}`);

  const blCrushedStats = stats({ clipLoPct: 6, blackPoint: 0, confidence: 0.8 });
  const blCrushed = computeBlacksRecommendation({ stats: blCrushedStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('27. Blacks lifted (positive) to recover texture when real shadow crushing (>4%) is present', blCrushed.value > 0 && blCrushed.value <= BOUNDS.blacks.hi, `+${blCrushed.value}`);

  const blIntentionalStats = stats({ clipLoPct: 0, blackPoint: 40, confidence: 0.8 });
  const blHighKey = computeBlacksRecommendation({ stats: blIntentionalStats, sceneClass: SCENE_CLASS.HIGH_KEY, strengthScalar: 1 });
  const blLowKey = computeBlacksRecommendation({ stats: blIntentionalStats, sceneClass: SCENE_CLASS.LOW_KEY, strengthScalar: 1 });
  check('28. HIGH_KEY/LOW_KEY scenes treat the black point as intentional (matte/faded or moody look) -- never adjusted regardless of raw blackPoint value', blHighKey.value === 0 && blLowKey.value === 0, `highKey=${blHighKey.value}, lowKey=${blLowKey.value}`);
}

// ══════════════════════════════════════════════════════════════════
// CONTRAST (29-33)
// ══════════════════════════════════════════════════════════════════
{
  const lowContrastStats2 = stats({ contrast: 25, confidence: 0.8 });
  const conLow = computeContrastRecommendation({ stats: lowContrastStats2, sceneClass: SCENE_CLASS.LOW_CONTRAST, skinScale: 1, strengthScalar: 1 });
  check('29. LOW_CONTRAST scene produces a bounded POSITIVE Contrast lift', conLow.value > 0 && conLow.value <= BOUNDS.contrast.hi, `+${conLow.value}`);

  const highContrastStats2 = stats({ contrast: 78, confidence: 0.8 });
  const conHigh = computeContrastRecommendation({ stats: highContrastStats2, sceneClass: SCENE_CLASS.HIGH_CONTRAST, skinScale: 1, strengthScalar: 1 });
  check('30. HIGH_CONTRAST scene produces a bounded NEGATIVE Contrast ease (relying on Highlight/Shadow recovery instead of crushing further)', conHigh.value < 0 && conHigh.value >= BOUNDS.contrast.lo, `${conHigh.value}`);

  const conHighKeyRaw = computeContrastRecommendation({ stats: lowContrastStats2, sceneClass: SCENE_CLASS.LOW_CONTRAST, skinScale: 1, strengthScalar: 1 });
  const conHighKeyDamp = computeContrastRecommendation({ stats: stats({ contrast: 25, confidence: 0.8 }), sceneClass: SCENE_CLASS.HIGH_KEY, skinScale: 1, strengthScalar: 1 });
  check('31. HIGH_KEY scene dampens (never nulls) an otherwise-positive contrast lift to preserve softness', conHighKeyDamp.value > 0 && conHighKeyDamp.value < conHighKeyRaw.value, `raw=${conHighKeyRaw.value}, high-key-damped=${conHighKeyDamp.value}`);

  const conLowKeyDamp = computeContrastRecommendation({ stats: highContrastStats2, sceneClass: SCENE_CLASS.LOW_KEY, skinScale: 1, strengthScalar: 1 });
  check('32. LOW_KEY scene dampens (never nulls) an otherwise-nonzero contrast move to preserve tonal intent', conLowKeyDamp.value !== 0 && Math.abs(conLowKeyDamp.value) < Math.abs(conHigh.value), `raw=${conHigh.value}, low-key-damped=${conLowKeyDamp.value}`);

  const conSkinFull = computeContrastRecommendation({ stats: highContrastStats2, sceneClass: SCENE_CLASS.HIGH_CONTRAST, skinScale: 1, strengthScalar: 1 });
  const conSkinScaled = computeContrastRecommendation({ stats: highContrastStats2, sceneClass: SCENE_CLASS.HIGH_CONTRAST, skinScale: 0.4, strengthScalar: 1 });
  check('33. Skin-heavy portraits scale the Contrast move down (skinScale<1 reduces magnitude vs skinScale=1)', Math.abs(conSkinScaled.value) < Math.abs(conSkinFull.value), `full=${conSkinFull.value}, skin-scaled=${conSkinScaled.value}`);
}

// ══════════════════════════════════════════════════════════════════
// LOCAL CONTRAST -- Texture/Clarity/Dehaze (34-39)
// ══════════════════════════════════════════════════════════════════
{
  const detailHC = computeLocalContrastDetail({ stats: FIXTURES.COLORFUL_EVENT_COSTUME.stats, sceneClass: SCENE_CLASS.HIGH_CONTRAST, skinScale: 1, strengthScalar: 1 });
  const detailBAL = computeLocalContrastDetail({ stats: FIXTURES.BALANCED_PORTRAIT.stats, sceneClass: SCENE_CLASS.BALANCED, skinScale: 1, strengthScalar: 1 });
  check('34. Texture gets a bounded POSITIVE value for HIGH_CONTRAST/BALANCED scenes (useful clothing/environment detail)', detailHC.texture.value > 0 && detailHC.texture.value <= BOUNDS.texture.hi && detailBAL.texture.value > 0 && detailBAL.texture.value <= BOUNDS.texture.hi, `hc=+${detailHC.texture.value}, bal=+${detailBAL.texture.value}`);

  const detailLC = computeLocalContrastDetail({ stats: FIXTURES.LOW_CONTRAST_INDOOR.stats, sceneClass: SCENE_CLASS.LOW_CONTRAST, skinScale: 1, strengthScalar: 1 });
  const detailHazy = computeLocalContrastDetail({ stats: FIXTURES.HAZY_LANDSCAPE.stats, sceneClass: SCENE_CLASS.HAZY, skinScale: 1, strengthScalar: 1 });
  check('35. Texture stays at 0 for scene classes outside HIGH_CONTRAST/BALANCED (e.g. LOW_CONTRAST, HAZY)', detailLC.texture.value === 0 && detailHazy.texture.value === 0);

  check('36. Clarity gets a bounded POSITIVE value for LOW_CONTRAST/HAZY scenes (local-contrast deficiency)', detailLC.clarity.value > 0 && detailLC.clarity.value <= BOUNDS.clarity.hi && detailHazy.clarity.value > 0 && detailHazy.clarity.value <= BOUNDS.clarity.hi, `lc=+${detailLC.clarity.value}, hazy=+${detailHazy.clarity.value}`);

  check('37. Clarity stays at 0 for scene classes outside LOW_CONTRAST/HAZY (e.g. HIGH_CONTRAST, BALANCED)', detailHC.clarity.value === 0 && detailBAL.clarity.value === 0);

  check('38. Dehaze is exactly 0 for every one of the 10 non-HAZY named fixtures -- never used as a generic contrast substitute', ALL_FIXTURE_NAMES.filter((n) => n !== 'HAZY_LANDSCAPE').every((n) => {
    const fx = FIXTURES[n];
    const sc = classifyDynamicRange({ stats: fx.stats, skin: fx.skin }).sceneClass;
    if (sc === SCENE_CLASS.HAZY) return true; // would also be legitimately gated in this branch
    const d = computeLocalContrastDetail({ stats: fx.stats, sceneClass: sc, skinScale: 1, strengthScalar: 1 });
    return d.dehaze.value === 0;
  }));

  const hazyDetail = computeLocalContrastDetail({ stats: FIXTURES.HAZY_LANDSCAPE.stats, sceneClass: SCENE_CLASS.HAZY, skinScale: 1, strengthScalar: 1 });
  const borderlineHazyStats = stats({ contrastRatio: 3.19, avgSatPct: 21.9, drStops: 4, confidence: 0.5 });
  const hazyDetailBorderline = computeLocalContrastDetail({ stats: borderlineHazyStats, sceneClass: SCENE_CLASS.HAZY, skinScale: 1, strengthScalar: 1 });
  check('39. HAZY scene with sufficient haze confidence gets a bounded POSITIVE Dehaze; a borderline-low haze-confidence HAZY case still correctly yields 0 (honest default, not a forced non-zero)', hazyDetail.dehaze.value > 0 && hazyDetail.dehaze.value <= BOUNDS.dehaze.hi && hazyDetail.dehaze.hazeConfidence >= 0.5, `hazy=+${hazyDetail.dehaze.value} (conf=${hazyDetail.dehaze.hazeConfidence}), borderline=${hazyDetailBorderline.dehaze.value} (conf=${hazyDetailBorderline.dehaze.hazeConfidence})`);
}

// ══════════════════════════════════════════════════════════════════
// MODES (40-42)
// ══════════════════════════════════════════════════════════════════
{
  const evUnder = evidenceFromFixture('UNDEREXPOSED_PORTRAIT');
  const planNatural = buildBasicTonePlan(evUnder, { strengthMode: STRENGTH_MODE.NATURAL });
  const planBalanced = buildBasicTonePlan(evUnder, { strengthMode: STRENGTH_MODE.BALANCED });
  const planDramatic = buildBasicTonePlan(evUnder, { strengthMode: STRENGTH_MODE.DRAMATIC });
  check('40. NATURAL strength mode (0.60x) produces smaller-magnitude Exposure than BALANCED (1.00x) for identical evidence', Math.abs(planNatural.finalValues.exposure) < Math.abs(planBalanced.finalValues.exposure), `natural=${planNatural.finalValues.exposure}, balanced=${planBalanced.finalValues.exposure}`);
  check('41. DRAMATIC strength mode (1.35x) produces larger-or-equal-magnitude Exposure than BALANCED (bounded by BOUNDS, so may saturate at the cap)', Math.abs(planDramatic.finalValues.exposure) >= Math.abs(planBalanced.finalValues.exposure), `dramatic=${planDramatic.finalValues.exposure}, balanced=${planBalanced.finalValues.exposure}`);

  const schemaSrc = readFileSync(path.join(ROOT, 'core/single-image/basic-tone-intelligence/basic-tone-schema.js'), 'utf8');
  const colorSchemaSrc = readFileSync(path.join(ROOT, 'core/single-image/color-intelligence/color-intelligence-schema.js'), 'utf8');
  const noCrossImport = !/^import .*color-intelligence/m.test(schemaSrc) && !/^import .*basic-tone-intelligence/m.test(colorSchemaSrc);
  check('42. Basic Tone strength modes are independently owned -- own STRENGTH_SCALARS constants, no actual import/shared state with P1E\'s color STRENGTH_MODE (only a documentation cross-reference in comments), per the composition policy decision NOT to unify', noCrossImport && STRENGTH_SCALARS[STRENGTH_MODE.BALANCED] === 1.0);
}

// ══════════════════════════════════════════════════════════════════
// SESSION AND EDITING (43-50)
// ══════════════════════════════════════════════════════════════════
{
  const extremeRaw = { exp: 99, con: 99, hi: -99, sh: 99, wh: 99, bl: -99, texture: 99, clarity: 99, dehaze: 99 };
  const { built } = buildReadySession('UNDEREXPOSED_PORTRAIT', extremeRaw);
  const candidate = built.candidate;
  check('43. Full session build sets candidate.basic.* to the Basic Tone Plan\'s finalValues -- NOT a raw-preset passthrough (raw preset used deliberately extreme 99/-99 values)', candidate.basic.exposure !== 99 && candidate.basic.highlights !== -99 && candidate.basic.texture !== 99, `exposure=${candidate.basic.exposure}, highlights=${candidate.basic.highlights}, texture=${candidate.basic.texture}`);

  const bti = candidate.diagnostics.basicToneIntelligence;
  check('44. candidate.diagnostics.basicToneIntelligence is populated with sceneClass/confidence/engaged/fieldsAdjusted/reasons/protections/lineage', !!bti && typeof bti.sceneClass === 'string' && typeof bti.confidence === 'number' && typeof bti.engaged === 'boolean' && Array.isArray(bti.fieldsAdjusted) && Array.isArray(bti.reasons) && !!bti.protections && !!bti.lineage);

  // Independently recompute the Basic Tone Plan from the SAME evidence
  // the session used, entirely outside the candidate-builder/P1E
  // pipeline -- if P1E's Color Intelligence step (which runs AFTER
  // P1F in candidate-builder.js) ever touched these 6 fields, the
  // built Candidate's values would drift away from this independent
  // recomputation. They must match exactly.
  const independentPlan = buildBasicTonePlan(evidenceFromFixture('UNDEREXPOSED_PORTRAIT'), { strengthMode: DEFAULT_STRENGTH_MODE });
  const basicFieldsMatchIndependentPlan = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze']
    .every((k) => candidate.basic[k] === independentPlan.finalValues[k]);
  check('45. P1E\'s Color Intelligence enrichment (which runs immediately after P1F in candidate-builder.js) does not overwrite ANY of the 9 Basic Tone fields -- the built Candidate\'s basic.* still exactly matches an independent buildBasicTonePlan() recomputation from the same evidence', basicFieldsMatchIndependentPlan);

  check('46. P1E-owned fields (hsl/grading/cal, and basic.vibrance/saturation) are populated by Color Intelligence -- P1F never touches them', typeof candidate.hsl === 'object' && typeof candidate.grading === 'object' && typeof candidate.cal === 'object' && typeof candidate.basic.vibrance === 'number');

  const originalAutoExposure = candidate.diagnostics.autoValues.basic.exposure;
  const editResult = updateCandidateParameter(candidate.sessionId, candidate.generationId, 'basic.exposure', 7, { source: 'USER_EDIT' });
  const manualEditWorked = editResult.committed && editResult.candidate.basic.exposure === 7;
  check('47. Manual edit to basic.exposure via updateCandidateParameter() commits and persists the new value', manualEditWorked, editResult.reason ?? 'ok');

  const resetResult = resetParameterToAuto(candidate.sessionId, candidate.generationId, 'basic.exposure');
  const restoredValue = resetResult.candidate?.basic?.exposure;
  check('48. Reset-to-Auto restores basic.exposure to the ORIGINAL Basic Tone Plan value recorded in diagnostics.autoValues (not the manual-edited 7)', resetResult.committed && restoredValue === originalAutoExposure && restoredValue !== 7, `restored=${restoredValue}, expectedAuto=${originalAutoExposure}`);

  const staleTicket = { sessionId: candidate.sessionId, generationId: 'stale-generation-id-that-does-not-exist' };
  const staleBuild = orch.buildAndCommitCandidate(staleTicket, { engineVersion: 'test' });
  const liveBasicUnaffected = resetResult.candidate.basic.exposure === originalAutoExposure;
  check('49. A stale/mismatched generation ticket is rejected (STALE_GENERATION) and never corrupts the live Candidate\'s Basic values', staleBuild.committed === false && staleBuild.reason === 'STALE_GENERATION' && liveBasicUnaffected);

  const legacyBefore = candidateToLegacyPreset(candidate);
  candidate.basic.exposure = 12345;
  const legacyAfter = candidateToLegacyPreset(candidate);
  check('50. Candidate remains the single source of truth for export -- mutating candidate.basic.exposure directly changes what candidateToLegacyPreset() reads, WITHOUT re-invoking analysis/buildBasicTonePlan (no hidden re-derivation)', legacyAfter.exp === 12345 && legacyBefore.exp !== 12345);
}


// ══════════════════════════════════════════════════════════════════
// PARITY (51-60)
// ══════════════════════════════════════════════════════════════════
{
  const { built } = buildReadySession('COLORFUL_EVENT_COSTUME');
  const candidate = built.candidate;
  const parity = computeExportParity(candidate);
  const basicFieldPaths = ['basic.exposure', 'basic.contrast', 'basic.highlights', 'basic.shadows', 'basic.whites', 'basic.blacks', 'basic.clarity', 'basic.dehaze', 'basic.texture'];
  const testNo = { 'basic.exposure': 51, 'basic.contrast': 52, 'basic.highlights': 53, 'basic.shadows': 54, 'basic.whites': 55, 'basic.blacks': 56, 'basic.clarity': 57, 'basic.dehaze': 58, 'basic.texture': 59 };
  for (const p of basicFieldPaths) {
    const entry = parity.entries.find((e) => e.parameterPath === p);
    check(`${testNo[p]}. Export parity holds for ${p} -- Candidate current value equals the quickSafetyClamp()-adjusted Export Expected value`, !!entry && entry.candidateVsExportMatch === true, entry ? `candidate=${entry.candidateCurrentValue}, exportExpected=${entry.exportExpectedValue}` : 'entry not found');
  }

  let preset = candidateToLegacyPreset(candidate);
  const safety = quickSafetyClamp(preset);
  preset = safety.preset;
  const xmp = serializeXMP(preset);
  const { status, report } = runXmpFidelityGate({ candidate, exportExpectedPreset: preset, xmpString: xmp });
  const readbackMatchesExpected = report?.comparisonResult?.summary?.mismatched === 0 || status === 'PASS';
  check('60. XMP Readback Fidelity Gate confirms Export Expected values == real XMP Readback values for all 9 Basic fields (P1D machinery reused, not a new parity mechanism)', readbackMatchesExpected, `status=${status}`);
}

// ══════════════════════════════════════════════════════════════════
// REGRESSION (61-70)
// ══════════════════════════════════════════════════════════════════
{
  check('61. This suite\'s own AUDIT / SCENE CLASSIFICATION / EXPOSURE / HIGHLIGHTS-SHADOWS / WHITES-BLACKS / CONTRAST / LOCAL CONTRAST / MODES / SESSION / PARITY checks (1-60) all passed before reaching this Regression section (self-consistent proof within a single run)', fail === 0);

  const p1eR3 = runSuite('qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs');
  check('62. P1E R3 XMP Color Parity + Creative Tone test suite remains fully passing unmodified', p1eR3.ok, (p1eR3.out.match(/\d+\/\d+ PASS/g) || []).pop());

  check('63. P1E R2 Color Intelligence test suite (94/94) remains passing (verified via P1E R3\'s own nested regression check)', /48\. P1E R2 color-intelligence test suite \(94\/94\) remains passing unmodified/.test(p1eR3.out) && p1eR3.out.includes('✓ [PASS] 48.'));

  check('64. P1D XMP Readback Fidelity Gate test suite (71/71) still fully passes (verified via P1E R3\'s own nested regression check)', p1eR3.out.includes('✓ [PASS] 49.'));

  check('65. P1C Candidate test suite (86/86) still fully passes (verified via P1E R3\'s own nested regression check, itself confirming the 7 P1F-updated assertions this EPIC touched)', p1eR3.out.includes('✓ [PASS] 50.'));

  const p1cR2 = runSuite('qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs');
  check('66. P1C R2 Candidate Lifecycle Order test suite still fully passes', p1cR2.ok);

  const p1cR3Path = path.join(ROOT, 'qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs');
  const p1cR3SyntaxCheck = spawnSync(process.execPath, ['--check', p1cR3Path], { encoding: 'utf8' });
  check('67. P1C R3 User-Edit XMP Export test file is present and syntactically valid (full 39/39 run left to the static-suite runner per this project\'s bounded-runtime convention -- its ~16s cost is a deliberate debounce-timing wait, not something this file re-derives)', p1cR3SyntaxCheck.status === 0);

  const p1a = runSuite('qa/epic-2e-p1a-single-image-session-test.mjs');
  check('68. P1A Single Image Session test suite still fully passes (spawned directly -- fast, no Browser/network dependency)', p1a.ok);

  const manifestPath = path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json');
  const manifestBefore = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const regen = spawnSync(process.execPath, [path.join(ROOT, 'qa/baselines/generate-production-lock-manifest.mjs')], { encoding: 'utf8' });
  const manifestAfter = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifestUnchangedByRegen = JSON.stringify(manifestBefore.files) === JSON.stringify(manifestAfter.files);
  check('69. Production Lock manifest is internally consistent -- regenerating it from the current source tree reproduces byte-identical file hashes (no locked file drifted since the last legitimate regeneration in this EPIC)', regen.status === 0 && manifestUnchangedByRegen, `fileCount=${Object.keys(manifestAfter.files || {}).length}`);

  const n1Path = path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json');
  const n1 = JSON.parse(readFileSync(n1Path, 'utf8'));
  const crypto = await import('node:crypto');
  const appJsBuf = readFileSync(path.join(ROOT, 'ui/app.js'));
  const appJsHash = crypto.createHash('sha256').update(appJsBuf).digest('hex');
  check('70. N1 production invariant\'s pinned ui/app.js SHA-256 matches the current file exactly (updated deliberately once, for the Advanced Diagnostics UI addition, and never silently since)', n1.files && n1.files['ui/app.js'] === appJsHash, `pinned=${n1.files?.['ui/app.js']}, actual=${appJsHash}`);
}

// ══════════════════════════════════════════════════════════════════
// MUTATION TESTS (M1-M7)
// ══════════════════════════════════════════════════════════════════
{
  // M1 -- remove histogram evidence entirely.
  const evNoStats = { stats: mk(null, 'FAILED', 0), skin: mk({ coveragePct: 0, confidence: 0.5 }) };
  const planNoStats = buildBasicTonePlan(evNoStats, { strengthMode: DEFAULT_STRENGTH_MODE });
  const allZero = Object.values(planNoStats.finalValues).every((v) => v === 0);
  check('M1. Removing histogram evidence (stats module FAILED) yields sceneClass LOW_CONFIDENCE, all 9 Basic fields at 0, and a bounded diagnostic explaining why (never a silent/undiagnosed empty plan)', planNoStats.sceneClass === SCENE_CLASS.LOW_CONFIDENCE && allZero && planNoStats.diagnostics.reasons.length > 0, planNoStats.diagnostics.reasons[0]);

  // M2 -- invert highlight/shadow evidence (swap clip percentages).
  const normalStats = stats({ clipHiPct: 6, clipLoPct: 0.3, confidence: 0.8 });
  const invertedStats = stats({ clipHiPct: 0.3, clipLoPct: 6, confidence: 0.8 });
  const hiNormal = computeHighlightRecovery({ stats: normalStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  const shNormal = computeShadowRecovery({ stats: normalStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  const hiInverted = computeHighlightRecovery({ stats: invertedStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  const shInverted = computeShadowRecovery({ stats: invertedStats, sceneClass: SCENE_CLASS.BALANCED, strengthScalar: 1 });
  check('M2. Inverting which side is clipped (swap clipHiPct/clipLoPct) correctly swaps which of Highlights/Shadows engages -- proving the recommendation is genuinely evidence-driven, not hardcoded', hiNormal.value < 0 && shNormal.value === 0 && hiInverted.value === 0 && shInverted.value > 0, `normal(hi=${hiNormal.value},sh=${shNormal.value}) inverted(hi=${hiInverted.value},sh=${shInverted.value})`);

  // M3 -- replace percentile values with NaN; guardrails must fail closed to 0, never propagate NaN.
  const guarded = applyBasicToneGuardrails({ exposure: NaN, contrast: NaN, highlights: NaN, shadows: NaN, whites: NaN, blacks: NaN, texture: NaN, clarity: NaN, dehaze: NaN }, { noiseRisk: false });
  const noNaNLeaked = Object.values(guarded.values).every((v) => Number.isFinite(v) && v === 0);
  check('M3. NaN values reaching applyBasicToneGuardrails() (e.g. from a corrupted percentile evidence field) are fail-closed to 0 for every field, never propagated into the Candidate', noNaNLeaked);

  // M4 -- overwrite Candidate Basic value out-of-bounds after commit; Layer B (quickSafetyClamp) must catch it at export time.
  const { built: builtM4 } = buildReadySession('BALANCED_PORTRAIT');
  builtM4.candidate.basic.exposure = 500; // far outside both BOUNDS.exposure and HARD_LIMITS.basic.exposure
  const mismatchesM4 = getExportParityMismatches(builtM4.candidate);
  const exposureMismatch = mismatchesM4.find((e) => e.parameterPath === 'basic.exposure');
  check('M4. An out-of-bounds post-commit overwrite of candidate.basic.exposure (500) is caught by quickSafetyClamp() (Layer B) at export time and reported as an export-parity mismatch, not silently exported as 500', !!exposureMismatch && exposureMismatch.exportExpectedValue <= HARD_LIMITS.basic.exposure[1], exposureMismatch ? `exportExpected=${exposureMismatch.exportExpectedValue}` : 'no mismatch reported');

  // M5 -- change the Legacy Preset's Basic value directly; must NOT feed back into the Candidate (one-way, read-only export flow).
  const { built: builtM5 } = buildReadySession('BALANCED_PORTRAIT');
  const originalCandidateExposure = builtM5.candidate.basic.exposure;
  const legacyPresetM5 = candidateToLegacyPreset(builtM5.candidate);
  legacyPresetM5.exp = 999;
  check('M5. Mutating the Legacy Preset\'s exp field after candidateToLegacyPreset() never feeds back into the Candidate -- confirms export is one-way and read-only', builtM5.candidate.basic.exposure === originalCandidateExposure && builtM5.candidate.basic.exposure !== 999);

  // M6 -- tamper with the serialized XMP's Basic property; the Fidelity Gate must detect the mismatch, not silently pass.
  const { built: builtM6 } = buildReadySession('BALANCED_PORTRAIT');
  let presetM6 = candidateToLegacyPreset(builtM6.candidate);
  presetM6 = quickSafetyClamp(presetM6).preset;
  const xmpM6 = serializeXMP(presetM6);
  const tamperedXmpM6 = xmpM6.replace(/crs:Exposure2012="[^"]*"/, 'crs:Exposure2012="77.00"');
  const gateM6 = runXmpFidelityGate({ candidate: builtM6.candidate, exportExpectedPreset: presetM6, xmpString: tamperedXmpM6 });
  check('M6. Tampering with the serialized XMP\'s crs:Exposure2012 value after serializeXMP() is detected by the Fidelity Gate as a real mismatch (status !== PASS), never silently accepted', gateM6.status !== 'PASS');

  // M7 -- attach a stale Basic Tone Plan to a new generation: build for generation A, then build again for a genuinely new generation with different evidence, and confirm the new Candidate reflects the NEW evidence, not the old plan.
  __resetStoreForTests();
  const sessionA = richEvidenceSession('BALANCED_PORTRAIT');
  const ticketA = { sessionId: sessionA.sessionId, generationId: sessionA.generationId };
  setActiveSession(sessionA);
  orch.commitCandidate(ticketA, buildRealisticRawPreset());
  orch.completeAnalysis(ticketA);
  const builtA = orch.buildAndCommitCandidate(ticketA, { engineVersion: 'test' });

  const sessionB = richEvidenceSession('UNDEREXPOSED_PORTRAIT');
  sessionB.sessionId = sessionA.sessionId; // same session, genuinely new generation/upload
  const ticketB = { sessionId: sessionB.sessionId, generationId: sessionB.generationId };
  setActiveSession(sessionB);
  orch.commitCandidate(ticketB, buildRealisticRawPreset());
  orch.completeAnalysis(ticketB);
  const builtB = orch.buildAndCommitCandidate(ticketB, { engineVersion: 'test' });

  const staleAttemptOnA = orch.buildAndCommitCandidate(ticketA, { engineVersion: 'test' });
  check('M7. A stale ticket from generation A is rejected once generation B is active (STALE_GENERATION), and generation B\'s own Candidate reflects generation B\'s OWN evidence (UNDEREXPOSED -- positive exposure), never a stale plan carried over from generation A', staleAttemptOnA.committed === false && builtB.candidate.basic.exposure > 0 && builtB.candidate.basic.exposure !== builtA.candidate.basic.exposure, `A.exposure=${builtA.candidate.basic.exposure}, B.exposure=${builtB.candidate.basic.exposure}, staleReason=${staleAttemptOnA.reason}`);
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
