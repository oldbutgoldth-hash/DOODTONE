#!/usr/bin/env node
/**
 * EPIC 2E-P1J — Tone Curve Intelligence & Point-Curve Export Wiring:
 * dedicated real-integration test suite.
 *
 * Proves the fix documented in P1J_TONE_CURVE_LINEAGE_AUDIT.md: the real,
 * already-computed core/tone-curve-ai-engine/index.js::generateToneCurves()
 * output now actually reaches candidate.curves.rgb/red/green/blue (was
 * always null before this round), via:
 *   - core/single-image/tone-curve-intelligence/tone-curve-schema.js (NEW)
 *   - core/single-image/tone-curve-intelligence/tone-curve-plan-builder.js (NEW)
 *   - core/single-image/candidate/candidate-builder.js (EDITED -- wires the
 *     new plan into candidate.curves.* and candidate.diagnostics.toneCurveIntelligence)
 *   - core/xmp-validator/index.js (EDITED -- HARD_LIMITS.curve calibrated +
 *     _clampToneCurvePanel(), the Layer-B export-safety net for point-curve
 *     arrays, wired into quickSafetyClamp())
 *
 * Never re-implements generateToneCurves()'s own curve math -- every
 * "legitimate engine output" fixture below uses point values taken
 * directly from that function's own documented clamp() ranges (read from
 * source, not guessed), matching this project's calibration-before-coding
 * convention.
 *
 * Run: node qa/epic-2e-p1j-tone-curve-intelligence-test.mjs
 */
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
  TONE_CURVE_SCHEMA_VERSION, STRENGTH_MODE, DEFAULT_STRENGTH_MODE, STRENGTH_SCALARS,
  MAX_POINT_DEVIATION, MIN_ENGAGEMENT_CONFIDENCE, buildEmptyToneCurvePlan,
} = await import('../core/single-image/tone-curve-intelligence/tone-curve-schema.js');
const { buildToneCurvePlan } = await import('../core/single-image/tone-curve-intelligence/tone-curve-plan-builder.js');
const { quickSafetyClamp, HARD_LIMITS } = await import('../core/xmp-validator/index.js');
const { computeExportParity } = await import('../core/single-image/candidate/candidate-export-parity.js');
const { createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE } = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { setActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');

// ── Fixtures ─────────────────────────────────────────────────────────────
function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}
function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}
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
/** Realistic generateToneCurves() result -- exact channel/reason shape read from core/tone-curve-ai-engine/index.js. */
function realisticToneCurveResult(overrides = {}) {
  return {
    category: 'Portrait Warm',
    confidence: 0.72,
    master: { points: [{ x: 0, y: 12 }, { x: 64, y: 70 }, { x: 128, y: 132 }, { x: 192, y: 198 }, { x: 255, y: 248 }], reason: 'S-curve for portrait contrast' },
    red:    { points: [{ x: 0, y: 10 }, { x: 64, y: 68 }, { x: 128, y: 128 }, { x: 192, y: 195 }, { x: 255, y: 250 }], reason: 'warm red lift' },
    green:  { points: [{ x: 0, y: 8 },  { x: 64, y: 64 }, { x: 128, y: 128 }, { x: 192, y: 190 }, { x: 255, y: 252 }], reason: 'neutral green' },
    blue:   { points: [{ x: 0, y: 5 },  { x: 64, y: 60 }, { x: 128, y: 122 }, { x: 192, y: 185 }, { x: 255, y: 245 }], reason: 'cool blue pull-down' },
    warnings: [],
    ...overrides,
  };
}
function baseSession() {
  const s = createSingleImageSession({ file: fakeFile('scene.jpg', 234567, 'image/jpeg', 1700000001000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 'scene.jpg';
  s.evidence.stats = mk({ avgLum: 150, category: 'Landscape', confidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.evidence.wb = mk({ consensus: { temperature: 4, tint: -1 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
  return s;
}
function buildReadyCandidate(session, rawOverrides = {}) {
  __resetStoreForTests();
  const ticket = { sessionId: session.sessionId, generationId: session.generationId };
  setActiveSession(session);
  orch.commitCandidate(ticket, buildRealisticRawPreset(rawOverrides));
  orch.completeAnalysis(ticket);
  return orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
}
function pointArraysEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.x !== b[i]?.x || a[i]?.y !== b[i]?.y) return false;
  return true;
}

console.log('=== EPIC 2E-P1J Tone Curve Intelligence -- Real Integration Test Suite ===\n');

// ── SCHEMA (tests 1-8) ─────────────────────────────────────────────────
console.log('--- SCHEMA ---');
check('1. TONE_CURVE_SCHEMA_VERSION is a non-empty string', typeof TONE_CURVE_SCHEMA_VERSION === 'string' && TONE_CURVE_SCHEMA_VERSION.length > 0);
check('2. STRENGTH_MODE has exactly NATURAL/BALANCED/DRAMATIC', Object.keys(STRENGTH_MODE).sort().join(',') === 'BALANCED,DRAMATIC,NATURAL');
check('3. DEFAULT_STRENGTH_MODE is BALANCED', DEFAULT_STRENGTH_MODE === STRENGTH_MODE.BALANCED);
check('4. STRENGTH_SCALARS.BALANCED === 1.00', STRENGTH_SCALARS[STRENGTH_MODE.BALANCED] === 1.0);
check('5. STRENGTH_SCALARS.NATURAL < BALANCED < DRAMATIC', STRENGTH_SCALARS[STRENGTH_MODE.NATURAL] < STRENGTH_SCALARS[STRENGTH_MODE.BALANCED] && STRENGTH_SCALARS[STRENGTH_MODE.BALANCED] < STRENGTH_SCALARS[STRENGTH_MODE.DRAMATIC]);
check('6. MAX_POINT_DEVIATION is a positive number <= 255', typeof MAX_POINT_DEVIATION === 'number' && MAX_POINT_DEVIATION > 0 && MAX_POINT_DEVIATION <= 255);
check('7. MIN_ENGAGEMENT_CONFIDENCE is between 0 and 1', typeof MIN_ENGAGEMENT_CONFIDENCE === 'number' && MIN_ENGAGEMENT_CONFIDENCE > 0 && MIN_ENGAGEMENT_CONFIDENCE < 1);
{
  const empty = buildEmptyToneCurvePlan();
  check('8. buildEmptyToneCurvePlan() returns all-null finalValues, engaged:false', empty.finalValues.master === null && empty.finalValues.red === null && empty.finalValues.green === null && empty.finalValues.blue === null && empty.diagnostics.engaged === false);
}

// ── PLAN BUILDER: engagement gating (tests 9-16) ────────────────────────
console.log('\n--- PLAN BUILDER: engagement gating ---');
{
  const plan = buildToneCurvePlan({}, {});
  check('9. Missing evidence -> empty plan (engaged=false, all-null)', plan.diagnostics.engaged === false && plan.finalValues.master === null);
}
{
  const plan = buildToneCurvePlan({ toneCurves: mk(realisticToneCurveResult(), MODULE_STATE.FAILED, 0) }, {});
  check('10. FAILED evidence status -> empty plan (not read)', plan.diagnostics.engaged === false);
}
{
  const plan = buildToneCurvePlan({ toneCurves: mk(realisticToneCurveResult({ confidence: 0.05 })) }, {});
  check('11. Confidence below MIN_ENGAGEMENT_CONFIDENCE -> not engaged, confidence preserved for diagnostics', plan.diagnostics.engaged === false && plan.confidence === 0.05);
}
{
  const plan = buildToneCurvePlan({ toneCurves: mk(realisticToneCurveResult({ confidence: MIN_ENGAGEMENT_CONFIDENCE })) }, {});
  check('12. Confidence exactly at the engagement floor -> engages (boundary is inclusive)', plan.diagnostics.engaged === true);
}
{
  const plan = buildToneCurvePlan({ toneCurves: mk(realisticToneCurveResult()) }, {});
  check('13. Valid, high-confidence evidence -> engaged=true', plan.diagnostics.engaged === true);
  check('14. All four channels populated with 5-point arrays', plan.finalValues.master.length === 5 && plan.finalValues.red.length === 5 && plan.finalValues.green.length === 5 && plan.finalValues.blue.length === 5);
  check('15. category/confidence carried through from evidence', plan.category === 'Portrait Warm' && plan.confidence === 0.72);
  check('16. reasons[] includes each channel\'s own engine-provided reason text', plan.diagnostics.reasons.some(r => r.includes('S-curve for portrait contrast')) && plan.diagnostics.reasons.some(r => r.includes('warm red lift')));
}

// ── PLAN BUILDER: per-channel validation (tests 17-24) ──────────────────
console.log('\n--- PLAN BUILDER: per-channel validation ---');
{
  const result = realisticToneCurveResult({ red: { points: null, reason: 'n/a' } });
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('17. One invalid channel (null points) -> that channel left null, others still populated', plan.finalValues.red === null && plan.finalValues.master !== null && plan.diagnostics.engaged === true);
}
{
  const result = realisticToneCurveResult({ green: { points: [{ x: 0, y: 0 }], reason: 'too short' } }); // <2 points
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('18. Single-point (too-short) channel array -> rejected, left null', plan.finalValues.green === null);
}
{
  const result = realisticToneCurveResult({ blue: { points: [{ x: 64, y: 60 }, { x: 0, y: 5 }], reason: 'out of order' } }); // x decreasing
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('19. Non-ascending x-order channel -> rejected, left null', plan.finalValues.blue === null);
}
{
  const result = realisticToneCurveResult({ master: { points: [{ x: 0, y: 300 }, { x: 255, y: 10 }], reason: 'out of range' } }); // y > 255
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('20. Out-of-[0,255]-range point -> rejected, left null', plan.finalValues.master === null);
}
{
  const result = realisticToneCurveResult({ red: { points: [{ x: 0, y: NaN }, { x: 255, y: 200 }], reason: 'NaN' } });
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('21. Non-finite (NaN) point value -> rejected, left null', plan.finalValues.red === null);
}
{
  const result = realisticToneCurveResult();
  result.master = result.green = result.red = result.blue = null;
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('22. All four channels invalid -> engaged=false (matches pre-P1J null behavior for this photo)', plan.diagnostics.engaged === false);
}
{
  const result = realisticToneCurveResult();
  const plan = buildToneCurvePlan({ toneCurves: mk(result, MODULE_STATE.CACHE_HIT, 0.72) }, {});
  check('23. CACHE_HIT status (not just COMPLETED) is also usable', plan.diagnostics.engaged === true);
}
{
  const plan = buildToneCurvePlan({ toneCurves: mk(realisticToneCurveResult({ warnings: ['low dynamic range'] })) }, {});
  check('24. Engine warnings[] carried through to plan.diagnostics.warnings', plan.diagnostics.warnings.includes('low dynamic range'));
}

// ── PLAN BUILDER: Layer-A restraint + strength modes (tests 25-32) ──────
console.log('\n--- PLAN BUILDER: Layer-A restraint + strength modes ---');
{
  // Extreme point far outside the engine's normal output but structurally valid -- proves the independent restraint layer engages.
  const result = realisticToneCurveResult({ master: { points: [{ x: 0, y: 0 }, { x: 64, y: 250 }, { x: 128, y: 128 }, { x: 255, y: 255 }], reason: 'adversarial spike' } });
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, { strengthMode: STRENGTH_MODE.BALANCED });
  const pt64 = plan.finalValues.master.find(p => p.x === 64);
  check('25. Point deviating > MAX_POINT_DEVIATION from identity is restrained toward x', Math.abs(pt64.y - 64) <= MAX_POINT_DEVIATION + 0.001);
  check('26. pointsRestrained > 0 when restraint actually engaged', plan.diagnostics.pointsRestrained > 0);
  check('27. Restraint note appended to that channel\'s reason string', plan.diagnostics.reasons.some(r => r.includes('restrained toward identity')));
}
{
  // A legitimate engine point (small deviation) must NOT be restrained.
  const result = realisticToneCurveResult();
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, { strengthMode: STRENGTH_MODE.BALANCED });
  check('28. Realistic (small-deviation) engine points pass through unrestrained', plan.diagnostics.pointsRestrained === 0);
}
{
  const result = realisticToneCurveResult({ master: { points: [{ x: 0, y: 0 }, { x: 128, y: 128 + MAX_POINT_DEVIATION + 5 }, { x: 255, y: 255 }], reason: 'boundary test' } });
  const natural = buildToneCurvePlan({ toneCurves: mk(result) }, { strengthMode: STRENGTH_MODE.NATURAL });
  const dramatic = buildToneCurvePlan({ toneCurves: mk(result) }, { strengthMode: STRENGTH_MODE.DRAMATIC });
  const naturalPt = natural.finalValues.master.find(p => p.x === 128);
  const dramaticPt = dramatic.finalValues.master.find(p => p.x === 128);
  check('29. NATURAL strength mode restrains MORE tightly than DRAMATIC (smaller allowed deviation)', Math.abs(naturalPt.y - 128) <= Math.abs(dramaticPt.y - 128));
  check('30. strengthMode is carried through onto the returned plan', natural.strengthMode === STRENGTH_MODE.NATURAL && dramatic.strengthMode === STRENGTH_MODE.DRAMATIC);
}
{
  const result = realisticToneCurveResult();
  const plan = buildToneCurvePlan({ toneCurves: mk(result) }, {});
  check('31. Point count is never changed by restraint (only y is pulled toward x)', plan.finalValues.master.length === result.master.points.length);
  const xs = plan.finalValues.master.map(p => p.x);
  check('32. x-ordering is preserved after restraint', xs.every((x, i) => i === 0 || x >= xs[i - 1]));
}

// ── CANDIDATE INTEGRATION (tests 33-40) ──────────────────────────────────
console.log('\n--- CANDIDATE INTEGRATION (real buildAndCommitCandidate()) ---');
{
  const s = baseSession();
  s.evidence.toneCurves = mk(realisticToneCurveResult());
  s.runtime.moduleStates.toneCurves = MODULE_STATE.COMPLETED;
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  const built = buildReadyCandidate(s);
  const candidate = built.candidate;
  check('33. Candidate builds to VALID status with real Tone Curve evidence present', candidate.status !== 'FAILED' && candidate.status !== 'EMPTY');
  check('34. candidate.curves.rgb/red/green/blue are populated point arrays (root cause fixed)', Array.isArray(candidate.curves.rgb) && candidate.curves.rgb.length === 5 && Array.isArray(candidate.curves.red) && Array.isArray(candidate.curves.green) && Array.isArray(candidate.curves.blue));
  check('35. candidate.diagnostics.toneCurveIntelligence is populated (engaged=true, category/confidence set)', candidate.diagnostics.toneCurveIntelligence?.engaged === true && candidate.diagnostics.toneCurveIntelligence?.category === 'Portrait Warm');
  check('36. candidate.curves.parametric fields come from rawPreset crv_sh/crv_mid/crv_hi only -- P1J never writes them (documented scope boundary)', candidate.curves.parametric.shadows === -2 && candidate.curves.parametric.midtones === 0 && candidate.curves.parametric.highlights === 4);

  const parity = computeExportParity(candidate);
  const exp = parity.exportExpectedPreset;
  check('37. exportExpectedPreset.curves.master matches Candidate rgb (no unexpected clamp for legitimate output)', pointArraysEqual(candidate.curves.rgb, exp.curves.master));
  check('38. exportExpectedPreset.curves.red/green/blue all match Candidate (legitimate output untouched)', pointArraysEqual(candidate.curves.red, exp.curves.red) && pointArraysEqual(candidate.curves.green, exp.curves.green) && pointArraysEqual(candidate.curves.blue, exp.curves.blue));
}
{
  // No usable tone-curve evidence at all, AND no rawPreset.curves fallback data
  // either (rawOverrides forces curves:null so the P1C dead-fallback path --
  // which would otherwise populate rgb from rawPreset.curves.master -- is
  // isolated out) -- must reproduce the EXACT pre-P1J behavior (null curves),
  // never force a fabricated curve.
  const s = baseSession();
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  const built = buildReadyCandidate(s, { curves: null });
  const candidate = built.candidate;
  check('39. No tone-curve evidence + no rawPreset fallback -> candidate.curves.rgb stays null (matches pre-P1J behavior exactly)', candidate.curves.rgb === null);
  check('40. diagnostics.toneCurveIntelligence.engaged === false when evidence is unavailable', candidate.diagnostics.toneCurveIntelligence?.engaged === false);
}

// ── LAYER-B EXPORT SAFETY CLAMP (tests 41-48) ────────────────────────────
console.log('\n--- LAYER-B EXPORT SAFETY CLAMP (xmp-validator quickSafetyClamp) ---');
function fullPresetWithCurves(curves) {
  return { exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, hsl: {}, grade: {}, cal: {}, vib: 0, sat: 0, temp: 0, tint: 0, crv_sh: 0, crv_mid: 0, crv_hi: 0, sharp: 0, noise: 0, curves };
}
{
  check('41. HARD_LIMITS.curve exists and is calibrated to the engine\'s real ranges (shadowY covers up to y=90 at x=64)', HARD_LIMITS.curve.shadowY[1] >= 90);
  check('42. HARD_LIMITS.curve highlightY covers down to y=160 at x=192', HARD_LIMITS.curve.highlightY[0] <= 160);
}
{
  const legit = fullPresetWithCurves({
    master: [{ x: 0, y: 25 }, { x: 64, y: 85 }, { x: 128, y: 155 }, { x: 192, y: 215 }, { x: 255, y: 230 }],
    red: [{ x: 0, y: 20 }, { x: 64, y: 90 }, { x: 128, y: 100 }, { x: 192, y: 160 }, { x: 255, y: 235 }],
    green: null, blue: null,
  });
  const { preset, adjustments } = quickSafetyClamp(legit);
  check('43. Legitimate engine-boundary points (y=90 at x=64, y=160 at x=192) pass through UNCLAMPED', preset.curves.master[1].y === 85 && preset.curves.red[1].y === 90 && preset.curves.red[3].y === 160);
  check('44. No Tone Curve adjustment message for legitimate points', !adjustments.some(a => a.includes('Tone Curve')));
}
{
  const adversarial = fullPresetWithCurves({ master: [{ x: 0, y: 255 }, { x: 255, y: 0 }], red: null, green: null, blue: null });
  const { preset, adjustments } = quickSafetyClamp(adversarial);
  check('45. Genuinely out-of-range/adversarial points ARE clamped into HARD_LIMITS.curve bounds', preset.curves.master[0].y === HARD_LIMITS.curve.shadowY[1] && preset.curves.master[1].y === HARD_LIMITS.curve.highlightY[0]);
  check('46. Adjustment message recorded for the adversarial clamp', adjustments.some(a => a.includes('Tone Curve') && a.includes('master')));
}
{
  const withNaN = fullPresetWithCurves({ master: [{ x: 0, y: NaN }, { x: 128, y: 128 }, { x: 255, y: 200 }], red: null, green: null, blue: null });
  const { preset } = quickSafetyClamp(withNaN);
  check('47. Non-finite point is dropped fail-closed (never passed through as NaN)', preset.curves.master.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) && preset.curves.master.length === 2);
}
{
  const withoutCurves = fullPresetWithCurves(null);
  const { preset } = quickSafetyClamp(withoutCurves);
  check('48. Absent/null curves left untouched (no-op, never fabricates a curve)', preset.curves === null);
}

// ── REGRESSION: prior EPICs still pass unchanged (tests 49-58) ──────────
console.log('\n--- REGRESSION: prior EPICs (spawned real suites) ---');
const REGRESSION_SUITES = [
  ['49. P1I R2 (Pixel Skin Validation) suite still passes', 'qa/epic-2e-p1i-r2-pixel-skin-validation-test.mjs'],
  ['50. P1I (Pixel Multi-Estimator WB) suite still passes', 'qa/epic-2e-p1i-pixel-multi-estimator-wb-test.mjs'],
  ['51. P1H (White Balance Intelligence) suite still passes', 'qa/epic-2e-p1h-white-balance-intelligence-test.mjs'],
  ['52. P1G R2 (Detail Export Safety Clamp) suite still passes', 'qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs'],
  ['53. P1G (Detail Intelligence) suite still passes', 'qa/epic-2e-p1g-detail-intelligence-test.mjs'],
  ['54. P1F (Basic Tone Intelligence) suite still passes', 'qa/epic-2e-p1f-basic-tone-intelligence-test.mjs'],
  ['55. P1E R3 (Color Parity + Creative Tone) suite still passes', 'qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs'],
  ['56. P1D (XMP Fidelity Gate) suite still passes', 'qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs'],
  ['57. P1C R3 (User-Edit XMP Export) suite still passes', 'qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs'],
  ['58. P1A (Single Image Session) suite still passes', 'qa/epic-2e-p1a-single-image-session-test.mjs'],
];
for (const [name, rel] of REGRESSION_SUITES) {
  const r = runSuite(rel);
  check(name, r.ok, r.ok ? '' : (r.out.split('\n').filter(l => l.includes('[FAIL]')).slice(0, 3).join(' | ') || r.err.slice(0, 200)));
}

// ── SUMMARY ───────────────────────────────────────────────────────────
console.log(`\n=== P1J SUITE RESULT: ${pass} passed, ${fail} failed (of ${pass + fail}) ===`);
process.exit(fail === 0 ? 0 : 1);
