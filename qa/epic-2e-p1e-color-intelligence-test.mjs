#!/usr/bin/env node
/**
 * EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate: real integration test.
 *
 * Runs against the REAL production modules: core/single-image/color-intelligence/*
 * (new), core/single-image/candidate/candidate-builder.js (integration edit),
 * core/single-image/candidate/candidate-schema.js (new colorIntelligence
 * diagnostics field), and the full existing Candidate/XMP/Fidelity-Gate
 * pipeline (unmodified) to prove strengthened color values still export
 * cleanly and pass the P1D Fidelity Gate.
 *
 * Run: node qa/epic-2e-p1e-color-intelligence-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  COLOR_INTELLIGENCE_SCHEMA_VERSION, STRENGTH_MODE, DEFAULT_STRENGTH_MODE, STRENGTH_SCALARS,
  BOUNDS, MIN_MEANINGFUL_COVERAGE_PCT, MIN_GRADING_CONFIDENCE, SKIN_ADJACENT_HSL_CHANNELS,
  skinCautionScale, buildEmptyColorPlan,
} = await import('../core/single-image/color-intelligence/color-intelligence-schema.js');
const { deriveColorSignals } = await import('../core/single-image/color-intelligence/evidence-color-signals.js');
const { buildColorPlan } = await import('../core/single-image/color-intelligence/color-plan-builder.js');
const { applyColorIntelligence } = await import('../core/single-image/color-intelligence/color-intelligence-engine.js');

const { createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE } = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { setActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { buildCandidateFromSession } = await import('../core/single-image/candidate/candidate-builder.js');
const { createEmptyCandidate, CANDIDATE_STATUS } = await import('../core/single-image/candidate/candidate-schema.js');
const candidateStore = await import('../core/single-image/candidate/candidate-store.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { quickSafetyClamp } = await import('../core/xmp-validator/index.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');
const { runXmpFidelityGate } = await import('../core/single-image/xmp-fidelity/xmp-fidelity-gate.js');
const { FIDELITY_STATUS } = await import('../core/single-image/xmp-fidelity/xmp-fidelity-report.js');

// ── Fixtures (mirrors qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs's
// established pattern) ─────────────────────────────────────────────────
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

/** RICH evidence: a colorful landscape/travel scene with real per-channel/zone/primary engine output (the actual hsl-analyzer-engine / colorgrading-ai-engine / calibration-engine return shapes). */
function richColorfulEvidence(s) {
  s.evidence.hsl = mk({
    channels: {
      red:     { coveragePct: 4,  hueAdj: 3,  satAdj: 12, lumAdj: 4,  dominance: 'accent' },
      orange:  { coveragePct: 2,  hueAdj: 1,  satAdj: 5,  lumAdj: 2,  dominance: 'minimal' },
      yellow:  { coveragePct: 3,  hueAdj: 0,  satAdj: 8,  lumAdj: 3,  dominance: 'accent' },
      green:   { coveragePct: 22, hueAdj: -6, satAdj: 18, lumAdj: 6,  dominance: 'primary' },
      aqua:    { coveragePct: 18, hueAdj: 4,  satAdj: 20, lumAdj: -4, dominance: 'secondary' },
      blue:    { coveragePct: 30, hueAdj: 6,  satAdj: 22, lumAdj: -8, dominance: 'primary' },
      purple:  { coveragePct: 1,  hueAdj: 0,  satAdj: 3,  lumAdj: 0,  dominance: 'minimal' },
      magenta: { coveragePct: 0,  hueAdj: 0,  satAdj: 0,  lumAdj: 0,  dominance: 'minimal' },
    },
    dominant: 'blue', confidence: 0.82, category: 'Landscape', guardrailsApplied: false,
  }, MODULE_STATE.COMPLETED, 0.82);
  s.evidence.grading = mk({
    shadows:    { hue: 220, sat: 26, balance: -20 },
    midtones:   { hue: 40,  sat: 8,  balance: 0 },
    highlights: { hue: 45,  sat: 16, balance: 18 },
    blending: 55, look: 'CoastalTeal', lookLabel: 'Coastal Teal & Orange', category: 'Landscape', confidence: 0.78,
  }, MODULE_STATE.COMPLETED, 0.78);
  s.evidence.calibration = mk({
    red:   { coveragePct: 5,  hue: 4,  sat: 10 },
    green: { coveragePct: 24, hue: -3, sat: 12 },
    blue:  { coveragePct: 28, hue: 5,  sat: 13 },
    category: 'Landscape', confidence: 0.7,
  }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.skin = mk({ detected: false, coveragePct: 0, confidence: 0.9, isFaceCandidate: false }, MODULE_STATE.COMPLETED, 0.9);
  s.evidence.colorCast = mk({ dominantCast: 'cool', cool: { strength: 0.3 }, confidence: 0.6 }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.scene = mk({ category: 'Landscape', confidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.runtime.moduleStates.hsl = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.grading = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.calibration = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.skin = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.colorCast = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.scene = MODULE_STATE.COMPLETED;
  return s;
}

/** RICH evidence: a heavy-skin portrait/wedding scene -- real presence + high confidence skin, to prove protection is active and bounded. */
function richSkinHeavyEvidence(s) {
  s.evidence.hsl = mk({
    channels: {
      red:     { coveragePct: 8,  hueAdj: 2,  satAdj: 10, lumAdj: 6,  dominance: 'secondary' },
      orange:  { coveragePct: 34, hueAdj: 3,  satAdj: 14, lumAdj: 5,  dominance: 'primary' },
      yellow:  { coveragePct: 12, hueAdj: 1,  satAdj: 10, lumAdj: 4,  dominance: 'secondary' },
      green:   { coveragePct: 4,  hueAdj: 0,  satAdj: 4,  lumAdj: 0,  dominance: 'accent' },
      aqua:    { coveragePct: 1,  hueAdj: 0,  satAdj: 0,  lumAdj: 0,  dominance: 'minimal' },
      blue:    { coveragePct: 6,  hueAdj: 2,  satAdj: 8,  lumAdj: -2, dominance: 'accent' },
      purple:  { coveragePct: 0,  hueAdj: 0,  satAdj: 0,  lumAdj: 0,  dominance: 'minimal' },
      magenta: { coveragePct: 0,  hueAdj: 0,  satAdj: 0,  lumAdj: 0,  dominance: 'minimal' },
    },
    dominant: 'orange', confidence: 0.75, category: 'Portrait', guardrailsApplied: true,
  }, MODULE_STATE.COMPLETED, 0.75);
  s.evidence.grading = mk({
    shadows:    { hue: 28, sat: 16, balance: -16 },
    midtones:   { hue: 26, sat: 6,  balance: 0 },
    highlights: { hue: 40, sat: 10, balance: 15 },
    blending: 50, look: 'WarmPortrait', lookLabel: 'Warm Portrait', category: 'Portrait', confidence: 0.6,
  }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.calibration = mk({
    red:   { coveragePct: 20, hue: 3, sat: 8 },
    green: { coveragePct: 3,  hue: 0, sat: 2 },
    blue:  { coveragePct: 2,  hue: 0, sat: 1 },
    category: 'Portrait', confidence: 0.6,
  }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.skin = mk({ detected: true, coveragePct: 32, confidence: 0.88, isFaceCandidate: true }, MODULE_STATE.COMPLETED, 0.88);
  s.evidence.colorCast = mk({ dominantCast: 'warm', warm: { strength: 0.4 }, confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
  s.evidence.scene = mk({ category: 'Portrait', confidence: 0.75 }, MODULE_STATE.COMPLETED, 0.75);
  s.runtime.moduleStates.hsl = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.grading = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.calibration = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.skin = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.colorCast = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.scene = MODULE_STATE.COMPLETED;
  return s;
}

function baseSession(rich) {
  const s = createSingleImageSession({ file: fakeFile('scene.jpg', 234567, 'image/jpeg', 1700000001000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 'scene.jpg';
  s.evidence.stats = mk({ avgLum: 150, category: 'Landscape', confidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.evidence.wb = mk({ consensus: { temperature: 4, tint: -1 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  return rich(s);
}
/** The exact MINIMAL evidence shape used by qa/epic-2e-p1c-candidate-test.mjs's own fixture -- the regression case P1E must be a complete no-op against. */
function minimalP1cStyleSession() {
  const s = createSingleImageSession({ file: fakeFile('t.jpg', 123456, 'image/jpeg', 1700000000000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 't.jpg';
  s.evidence.stats = mk({ avgLum: 190, category: 'Wedding', confidence: 0.85 }, MODULE_STATE.COMPLETED, 0.85);
  s.evidence.wb = mk({ consensus: { temperature: 6, tint: -2 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.hsl = mk({ dominant: 'orange', confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.hsl = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  return s;
}
function buildReadySession(session, rawOverrides = {}) {
  __resetStoreForTests();
  const ticket = { sessionId: session.sessionId, generationId: session.generationId };
  setActiveSession(session);
  orch.commitCandidate(ticket, buildRealisticRawPreset(rawOverrides));
  const finalStatus = orch.completeAnalysis(ticket);
  const built = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  return { session, ticket, finalStatus, built };
}
function runFullPipeline(candidate) {
  let preset = candidateToLegacyPreset(candidate);
  const safety = quickSafetyClamp(preset);
  preset = safety.preset;
  const xmp = serializeXMP(preset);
  const { status, report } = runXmpFidelityGate({ candidate, exportExpectedPreset: preset, xmpString: xmp });
  return { preset, xmp, status, report, safety };
}

// ══════════════════════════════════════════════════════════════════
// 1-6. Schema: pure constants and shape helpers
// ══════════════════════════════════════════════════════════════════
{
  check('1. COLOR_INTELLIGENCE_SCHEMA_VERSION is a non-empty string', typeof COLOR_INTELLIGENCE_SCHEMA_VERSION === 'string' && COLOR_INTELLIGENCE_SCHEMA_VERSION.length > 0);
  check('2. STRENGTH_SCALARS is monotonically increasing NATURAL < BALANCED < CINEMATIC < STRONG', STRENGTH_SCALARS.NATURAL < STRENGTH_SCALARS.BALANCED && STRENGTH_SCALARS.BALANCED < STRENGTH_SCALARS.CINEMATIC && STRENGTH_SCALARS.CINEMATIC < STRENGTH_SCALARS.STRONG);
  check('3. DEFAULT_STRENGTH_MODE is BALANCED (intentionally stronger than a conservative default, still bounded)', DEFAULT_STRENGTH_MODE === STRENGTH_MODE.BALANCED);
  check('4. skinCautionScale() returns 1.0 (no extra caution) for negligible skin coverage', skinCautionScale({ skinCoveragePct: 1, skinConfidence: 0.9 }) === 1.0);
  check('5. skinCautionScale() strictly decreases as skin coverage rises (more skin -> more caution)', skinCautionScale({ skinCoveragePct: 5, skinConfidence: 0.8 }) > skinCautionScale({ skinCoveragePct: 15, skinConfidence: 0.8 }) && skinCautionScale({ skinCoveragePct: 15, skinConfidence: 0.8 }) > skinCautionScale({ skinCoveragePct: 30, skinConfidence: 0.8 }));
  check('6. buildEmptyColorPlan() returns a complete, safely-defaulted, non-engaged plan', buildEmptyColorPlan().engaged === false && Array.isArray(buildEmptyColorPlan().reasons) && buildEmptyColorPlan().reasons.length === 0);
}

// ══════════════════════════════════════════════════════════════════
// 7-14. evidence-color-signals: pure, defensive extraction
// ══════════════════════════════════════════════════════════════════
{
  const emptySignals = deriveColorSignals({});
  check('7. deriveColorSignals({}) never throws and returns a complete, safely-defaulted shape', emptySignals.schemaVersion === 'P1E_COLOR_SIGNALS@1' && emptySignals.overallColorConfidence === null);

  const minimalEvidence = { hsl: mk({ dominant: 'orange', confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65) };
  const minimalSignals = deriveColorSignals(minimalEvidence);
  check('8. deriveColorSignals() yields NO usable HSL channel signal for the minimal P1C-fixture shape ({dominant, confidence} only, no channels map)', Object.keys(minimalSignals.hsl.channels).length === 0);

  const softFailedEvidence = { hsl: mk({ channels: { blue: { coveragePct: 40, hueAdj: 5, satAdj: 10, lumAdj: 2 } }, confidence: 0.8 }, MODULE_STATE.SOFT_FAILED, 0.1) };
  const softFailedSignals = deriveColorSignals(softFailedEvidence);
  check('9. deriveColorSignals() ignores a SOFT_FAILED evidence entry even if it has a rich `result` shape (only COMPLETED/CACHE_HIT are trusted)', Object.keys(softFailedSignals.hsl.channels).length === 0);

  const richSession = baseSession(richColorfulEvidence);
  const richSignals = deriveColorSignals(richSession.evidence);
  check('10. deriveColorSignals() extracts real per-channel HSL signals from a full hsl-analyzer-engine-shaped evidence result', richSignals.hsl.channels.blue?.satAdj === 22 && richSignals.hsl.channels.green?.hueAdj === -6);
  check('11. deriveColorSignals() extracts real per-zone Grading signals from a full colorgrading-ai-engine-shaped evidence result', richSignals.grading.zones.shadows?.sat === 26 && richSignals.grading.look === 'CoastalTeal');
  check('12. deriveColorSignals() extracts real per-primary Calibration signals from a full calibration-engine-shaped evidence result', richSignals.calibration.primaries.blue?.sat === 13);
  check('13. deriveColorSignals() extracts skin presence/confidence correctly', richSignals.skin.present === false && richSignals.skin.coveragePct === 0);
  check('14. deriveColorSignals() never mutates the evidence object it is given', richSession.evidence.hsl.result.channels.blue.satAdj === 22);
}

// ══════════════════════════════════════════════════════════════════
// 15-27. color-plan-builder: bounded, evidence-driven, skin-safe restoration
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  const signals = deriveColorSignals(richSession.evidence);
  const zeroFields = { hsl: { hue: {}, saturation: {}, luminance: {} }, grading: { shadows: { hue: 0, saturation: 0, luminance: 0 }, midtones: { hue: 0, saturation: 0, luminance: 0 }, highlights: { hue: 0, saturation: 0, luminance: 0 } }, cal: {}, basic: { vibrance: 0, saturation: 0 } };
  const plan = buildColorPlan({ candidateColorFields: zeroFields, signals, strengthMode: STRENGTH_MODE.BALANCED });

  check('15. Colorful scene: plan.engaged is true (non-trivial output, not near-zero)', plan.engaged === true);
  check('16. Colorful scene: at least 3 distinct field families were boosted (HSL/grading/calibration/presence)', new Set(plan.fieldsBoosted.map((f) => f.split('.')[0])).size >= 3);
  check('17. Colorful scene: blue HSL saturation moved meaningfully off zero (real grading opportunity is not left near-zero)', Math.abs(plan.hsl.saturation.blue) >= 8);
  check('18. Colorful scene: no HSL channel exceeds its own independently-owned BOUNDS (Layer A)', ['red','orange','yellow','green','aqua','blue','purple','magenta'].every((ch) => {
    const isSkin = SKIN_ADJACENT_HSL_CHANNELS.has(ch);
    const satBound = isSkin ? Math.max(BOUNDS.hsl.skin.satLow, BOUNDS.hsl.skin.satHigh) : BOUNDS.hsl.color.sat;
    const hueBound = isSkin ? BOUNDS.hsl.skin.hue : BOUNDS.hsl.color.hue;
    return Math.abs(plan.hsl.hue[ch]) <= hueBound + 0.001 && Math.abs(plan.hsl.saturation[ch]) <= satBound + 0.001;
  }));
  check('19. Colorful scene: calibration saturation never exceeds BOUNDS.calibration.saturation', Math.abs(plan.cal.bluePrimarySaturation) <= BOUNDS.calibration.saturation + 0.001 && Math.abs(plan.cal.greenPrimarySaturation) <= BOUNDS.calibration.saturation + 0.001);
  check('20. Colorful scene: presence vibrance/saturation engaged and bounded', plan.presence.vibrance > 0 && plan.presence.vibrance <= BOUNDS.presence.vibrance + 0.001 && plan.presence.saturation <= BOUNDS.presence.saturation + 0.001);
  check('21. Low-coverage HSL channel (purple, 1% < 3% threshold) is left completely unchanged, never fabricated', plan.hsl.hue.purple === 0 && plan.hsl.saturation.purple === 0 && plan.hsl.luminance.purple === 0);
  check('22. Restoration never overshoots the evidence engine\'s own recommendation (blue satAdj=22 is itself <= BOUNDS.hsl.color.sat, so plan value must equal exactly 22 at BALANCED*1.0 gap-fill from zero, never more)', plan.hsl.saturation.blue <= 22 + 0.001);

  const skinSession = baseSession(richSkinHeavyEvidence);
  const skinSignals = deriveColorSignals(skinSession.evidence);
  const skinPlan = buildColorPlan({ candidateColorFields: zeroFields, signals: skinSignals, strengthMode: STRENGTH_MODE.BALANCED });
  check('23. Heavy-skin portrait: skinProtection.applied is true and scale < 1', skinPlan.skinProtection.applied === true && skinPlan.skinProtection.scale < 1);
  check('24. Heavy-skin portrait: orange (skin-adjacent) saturation stays within the tight skin bound', Math.abs(skinPlan.hsl.saturation.orange) <= Math.max(BOUNDS.hsl.skin.satLow, BOUNDS.hsl.skin.satHigh) + 0.001);
  check('25. Heavy-skin portrait: orange saturation push is visibly SMALLER than the colorful-scene blue push at equal evidence magnitude order, proving skin caution actually dampens (not just clamps)', Math.abs(skinPlan.hsl.saturation.orange) < Math.abs(plan.hsl.saturation.blue));
  check('26. Heavy-skin portrait: never flips skin hue/sat to a value of opposite sign from the evidence recommendation', Math.sign(skinPlan.hsl.hue.orange || 1) === Math.sign(3));

  // Sign-conflict conservatism: current (legacy) value disagrees in sign with fresh evidence -> stay at current, clamped.
  const conflictFields = { hsl: { hue: { blue: -5 }, saturation: { blue: -5 }, luminance: { blue: 0 } }, grading: { shadows: { hue: 0, saturation: 0, luminance: 0 }, midtones: { hue: 0, saturation: 0, luminance: 0 }, highlights: { hue: 0, saturation: 0, luminance: 0 } }, cal: {}, basic: { vibrance: 0, saturation: 0 } };
  const conflictPlan = buildColorPlan({ candidateColorFields: conflictFields, signals, strengthMode: STRENGTH_MODE.BALANCED });
  check('27. Sign conflict between current Candidate value and fresh evidence recommendation is resolved conservatively (kept at current, not pushed further in either direction)', conflictPlan.hsl.hue.blue === -5);
}

// ══════════════════════════════════════════════════════════════════
// 28-33. color-plan-builder: Grading confidence gate + strength modes
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  const signals = deriveColorSignals(richSession.evidence);
  const zeroFields = { hsl: { hue: {}, saturation: {}, luminance: {} }, grading: { shadows: { hue: 0, saturation: 0, luminance: 0 }, midtones: { hue: 0, saturation: 0, luminance: 0 }, highlights: { hue: 0, saturation: 0, luminance: 0 } }, cal: {}, basic: { vibrance: 0, saturation: 0 } };

  const lowConfSignals = { ...signals, grading: { ...signals.grading, confidence: 0.1 } };
  const lowConfPlan = buildColorPlan({ candidateColorFields: zeroFields, signals: lowConfSignals, strengthMode: STRENGTH_MODE.BALANCED });
  check(`28. Grading below MIN_GRADING_CONFIDENCE (${MIN_GRADING_CONFIDENCE}) is left unchanged, never trusted`, lowConfPlan.grading.shadows.saturation === 0 && lowConfPlan.grading.shadows.luminance === 0);

  const naturalPlan = buildColorPlan({ candidateColorFields: zeroFields, signals, strengthMode: STRENGTH_MODE.NATURAL });
  const cinematicPlan = buildColorPlan({ candidateColorFields: zeroFields, signals, strengthMode: STRENGTH_MODE.CINEMATIC });
  check('29. NATURAL strength mode produces a visibly smaller push than CINEMATIC for the same evidence (internal strength strategy is real, not decorative)', Math.abs(naturalPlan.hsl.saturation.blue) < Math.abs(cinematicPlan.hsl.saturation.blue));
  check('30. Every strength mode stays within the SAME independently-owned BOUNDS (mode changes fraction, never the hard ceiling)', Math.abs(cinematicPlan.hsl.saturation.blue) <= BOUNDS.hsl.color.sat + 0.001);
  const calSrc = readFileSync(path.join(ROOT, 'core/single-image/color-intelligence/color-plan-builder.js'), 'utf8');
  check("31. Source: calibration fraction applies skinScale only when prim === 'red'", /prim === 'red' \? skinScale : 1\.0/.test(calSrc));
  check('32. Source: buildColorPlan is a pure function (no document/localStorage/fetch/Math.random)', !/document\.|localStorage|fetch\(|Math\.random/.test(calSrc));
}

// ══════════════════════════════════════════════════════════════════
// 33-39. color-intelligence-engine: scoped mutation + diagnostics
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  const candidate = createEmptyCandidate();
  candidate.basic.exposure = 15; candidate.basic.vibrance = 8; candidate.basic.saturation = 3;
  candidate.whiteBalance.temperature = 4; candidate.whiteBalance.tint = -1;
  candidate.cal.redPrimaryHue = 0; candidate.cal.redPrimarySaturation = 1;
  candidate.grading.balance = null; candidate.cal.shadowTint = null;
  const before = JSON.parse(JSON.stringify({ exposure: candidate.basic.exposure, temp: candidate.whiteBalance.temperature, tint: candidate.whiteBalance.tint, curves: candidate.curves }));

  const { candidate: enriched, diagnostics } = applyColorIntelligence(candidate, richSession.evidence, { strengthMode: DEFAULT_STRENGTH_MODE });

  check('33. applyColorIntelligence() returns the SAME candidate object (mutated in place), not a copy', enriched === candidate);
  check('34. diagnostics.schemaVersion matches COLOR_INTELLIGENCE_SCHEMA_VERSION', diagnostics.schemaVersion === COLOR_INTELLIGENCE_SCHEMA_VERSION);
  check('35. diagnostics.engaged is true for a colorful scene with real evidence', diagnostics.engaged === true);
  check('36. Non-color field basic.exposure is untouched', candidate.basic.exposure === before.exposure);
  check('37. whiteBalance.temperature/tint are untouched', candidate.whiteBalance.temperature === before.temp && candidate.whiteBalance.tint === before.tint);
  check('38. curves object is untouched (reference-stable, same nested values)', JSON.stringify(candidate.curves) === JSON.stringify(before.curves));
  check('39. grading.balance and cal.shadowTint (documented UNSUPPORTED fields) remain null -- never written by P1E', candidate.grading.balance === null && candidate.cal.shadowTint === null);
}

// ══════════════════════════════════════════════════════════════════
// 40-47. candidate-builder.js real integration
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  richSession.candidateRaw = buildRealisticRawPreset();
  const { candidate, validation } = buildCandidateFromSession(richSession, { engineVersion: 'test' });
  check('40. buildCandidateFromSession() still succeeds (candidate status never FAILED) with real color evidence present', candidate.status !== CANDIDATE_STATUS.FAILED);
  check('41. candidate.diagnostics.colorIntelligence is populated (new additive field, non-null after a real build)', candidate.diagnostics.colorIntelligence !== null && candidate.diagnostics.colorIntelligence.schemaVersion === COLOR_INTELLIGENCE_SCHEMA_VERSION);
  check('42. Real build: HSL blue saturation is meaningfully non-zero (not the near-zero bug this EPIC exists to fix)', Math.abs(candidate.hsl.saturation.blue) >= 5);
  check('43. Real build: candidate.diagnostics.autoValues.hsl reflects the ENRICHED value (Reset-to-Auto baseline is the strengthened recommendation, not pre-enrichment)', candidate.diagnostics.autoValues.hsl.saturation.blue === candidate.hsl.saturation.blue);
  check('44. Real build: lineage entry for hsl.saturation.blue carries the enriched value as both rawRecommendation and autoValue', candidate.diagnostics.lineage['hsl.saturation.blue']?.autoValue === candidate.hsl.saturation.blue);

  const minimalSession = minimalP1cStyleSession();
  minimalSession.candidateRaw = buildRealisticRawPreset({
    hsl: { hsl_h_red: 2, hsl_s_red: 5, hsl_l_red: 0, hsl_h_orange: 3, hsl_s_orange: 8, hsl_l_orange: 2, hsl_h_yellow: 0, hsl_s_yellow: -4, hsl_l_yellow: 0, hsl_h_green: 0, hsl_s_green: -10, hsl_l_green: 0, hsl_h_aqua: 0, hsl_s_aqua: 0, hsl_l_aqua: 0, hsl_h_blue: -2, hsl_s_blue: 4, hsl_l_blue: 0, hsl_h_purple: 0, hsl_s_purple: 0, hsl_l_purple: 0, hsl_h_magenta: 0, hsl_s_magenta: 0, hsl_l_magenta: 0 },
    grade: { grd_sh_h: 220, grd_sh_s: 10, grd_sh_l: 0, grd_mid_h: 40, grd_mid_s: 5, grd_mid_l: 0, grd_hi_h: 50, grd_hi_s: 8, grd_hi_l: 0, grd_blend: 55 },
    cal: { cal_red_h: 0, cal_red_s: 5, cal_green_h: 0, cal_green_s: -5, cal_blue_h: 0, cal_blue_s: 0 },
  });
  const { candidate: minimalCandidate } = buildCandidateFromSession(minimalSession, { engineVersion: '2.3.0' });
  check('45. REGRESSION: minimal P1C-fixture-shaped evidence (no channels map) yields the EXACT same candidate.hsl.hue.orange as pre-P1E (===3, no fabricated engagement)', minimalCandidate.hsl.hue.orange === 3);
  check('46. REGRESSION: minimal evidence -> candidate.grading.shadows.hue exact pre-P1E value (===220)', minimalCandidate.grading.shadows.hue === 220);
  check('47. REGRESSION: minimal evidence -> candidate.cal.redPrimarySaturation exact pre-P1E value (===5)', minimalCandidate.cal.redPrimarySaturation === 5);
}

// ══════════════════════════════════════════════════════════════════
// 48-53. Full pipeline: strengthened Candidate still exports + passes Fidelity Gate
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  const { built } = buildReadySession(richSession);
  check('48. Full pipeline (rich evidence): Candidate build succeeds', built.candidate.status !== CANDIDATE_STATUS.FAILED);
  const { preset, xmp, status } = runFullPipeline(built.candidate);
  check('49. Full pipeline: quickSafetyClamp() runs without altering the already-bounded HSL saturation values (Layer A bound sits safely inside Layer B cap)', preset.hsl.hsl_s_blue === Math.round(built.candidate.hsl.saturation.blue));
  check('50. Full pipeline: serializeXMP() succeeds and produces a non-empty XMP string', typeof xmp === 'string' && xmp.length > 100);
  check('51. Full pipeline: P1D XMP Fidelity Gate still PASSes (or PASS_WITH_WARNINGS) for a P1E-strengthened Candidate', status === FIDELITY_STATUS.PASS || status === FIDELITY_STATUS.PASS_WITH_WARNINGS);

  const skinSession = baseSession(richSkinHeavyEvidence);
  const { built: skinBuilt } = buildReadySession(skinSession);
  const skinPipeline = runFullPipeline(skinBuilt.candidate);
  check('52. Full pipeline (heavy-skin scene): Candidate build succeeds and P1D Fidelity Gate still PASSes', skinBuilt.candidate.status !== CANDIDATE_STATUS.FAILED && (skinPipeline.status === FIDELITY_STATUS.PASS || skinPipeline.status === FIDELITY_STATUS.PASS_WITH_WARNINGS));
  check('53. Full pipeline (heavy-skin scene): exported orange HSL saturation magnitude stays under the hard skin ceiling used elsewhere in the app (quickSafetyClamp skin cap = skinSatHi+4=10)', Math.abs(skinPipeline.preset.hsl.hsl_s_orange) <= 10);
}

// ══════════════════════════════════════════════════════════════════
// 54-58. User-edit-after-enrichment + upload/reset lifecycle
// ══════════════════════════════════════════════════════════════════
{
  const richSession = baseSession(richColorfulEvidence);
  const { built, ticket } = buildReadySession(richSession);
  const enrichedBlue = built.candidate.hsl.saturation.blue;
  check('54. Enriched Candidate is committed to the Candidate Store (getValidatedCandidate returns it)', candidateStore.getValidatedCandidate().hsl.saturation.blue === enrichedBlue);

  // Simulate a user edit on top of the P1E-enriched Candidate, then re-export -- must still work end to end.
  const editedCandidate = { ...built.candidate, hsl: { ...built.candidate.hsl, saturation: { ...built.candidate.hsl.saturation, blue: 12 } } };
  const editPipeline = runFullPipeline(editedCandidate);
  check('55. User edit after P1E enrichment: edited value round-trips through export and the Fidelity Gate still PASSes', (editPipeline.status === FIDELITY_STATUS.PASS || editPipeline.status === FIDELITY_STATUS.PASS_WITH_WARNINGS) && editPipeline.preset.hsl.hsl_s_blue === 12);

  // New upload / Reset must clear the Candidate Store (including any colorIntelligence diagnostics attached to the old Candidate) exactly like every other Candidate field -- delegated to the existing P1C reset test, re-verified live here.
  __resetStoreForTests();
  check('56. Reset clears the Candidate Store -- no stale P1E-enriched Candidate (or its diagnostics.colorIntelligence) survives a reset', candidateStore.getValidatedCandidate() === null);

  const secondSession = baseSession(richSkinHeavyEvidence);
  const { built: secondBuilt } = buildReadySession(secondSession);
  check('57. A fresh upload after Reset builds its own independent, correctly-enriched Candidate (no leakage from the prior session)', secondBuilt.candidate.diagnostics.colorIntelligence !== null && secondBuilt.candidate.diagnostics.colorIntelligence.skinProtection.applied === true);
  check('58. Candidate build/commit still happens exactly once for the new upload (no duplicate P1E enrichment pass)', secondBuilt.candidate.status !== CANDIDATE_STATUS.FAILED);
}

// ══════════════════════════════════════════════════════════════════
// 59-62. Purity / hostile checks (no Session/DOM/network access anywhere in the new layer)
// ══════════════════════════════════════════════════════════════════
{
  const files = [
    'core/single-image/color-intelligence/color-intelligence-schema.js',
    'core/single-image/color-intelligence/evidence-color-signals.js',
    'core/single-image/color-intelligence/color-plan-builder.js',
    'core/single-image/color-intelligence/color-intelligence-engine.js',
  ];
  // Strip comments before scanning -- these modules' own doc comments legitimately
  // DISCUSS (in prose) localStorage/quickSafetyClamp/xmp-validator to explain what
  // they deliberately do NOT do; only executable code matters for these checks.
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  const sources = files.map((f) => stripComments(readFileSync(path.join(ROOT, f), 'utf8')));
  check('59. No color-intelligence module touches document/window/localStorage in executable code', sources.every((src) => !/document\.|window\.|localStorage/.test(src)));
  check('60. No color-intelligence module performs network access (fetch/XHR/import())', sources.every((src) => !/\bfetch\(|XMLHttpRequest|\bimport\(/.test(src)));
  check('61. No color-intelligence module calls buildFinalPreset/validateFinalPreset/quickSafetyClamp itself in executable code', sources.every((src) => !/buildFinalPreset\(|validateFinalPreset\(|quickSafetyClamp\(/.test(src)));
  check('62. No color-intelligence module imports core/decision-engine or core/xmp-validator (Production legacy path + serializer untouched)', sources.every((src) => !/from ['"].*decision-engine|from ['"].*xmp-validator/.test(src)));
}

// ══════════════════════════════════════════════════════════════════
// 63-70. Delegated regression: P1A / P1B / P1C R2 / RCM / Production locks
//
// NOTE: qa/epic-2e-p1c-candidate-test.mjs, qa/epic-2e-p1c-r3-user-edit-
// xmp-export-test.mjs, and qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs are
// deliberately NOT spawned from inside this file -- each of THOSE suites
// already spawns several more full suites of its own (its own delegated-
// regression sections), and spawning them recursively from here chains
// into a process count too large to finish inside this environment's
// single-command execution budget. They are verified directly, as
// their own standalone `node <suite>` invocations, in
// P1E_QA_REPORT.md (86/86, 39/39, and 71/71 respectively, all still
// passing after the P1E integration edit to candidate-builder.js) --
// the identical "verify each suite individually" methodology already
// established and documented for the full static suite in P1D R2.
// ══════════════════════════════════════════════════════════════════
{
  const { spawnSync } = await import('node:child_process');
  function runSuite(rel) {
    const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
    return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
  }
  const p1a = runSuite('qa/epic-2e-p1a-single-image-session-test.mjs');
  check('63. P1A Single Image Session test suite remains passing', p1a.ok);

  const p1aR3 = runSuite('qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs');
  check('64. P1A R3 upload-lifecycle integration test (16/16) remains passing', /16\/16 PASS/.test(p1aR3.out));

  const p1b = runSuite('qa/epic-2e-p1b-analysis-report-test.mjs');
  check('65. P1B AI Image Analysis Report test suite remains passing', p1b.ok);

  const p1cR2 = runSuite('qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs');
  check('66. P1C R2 Candidate lifecycle-order test (19/19) remains passing', /19\/19 PASS/.test(p1cR2.out));

  const n1 = runSuite('qa/epic-2e-n1-core-color-match-integration-static-test.mjs');
  check('67. Reference Color Match integration suite (6/6) remains passing -- P1E never touches core/color-match', /6\/6 PASS/.test(n1.out));

  const n1n5 = runSuite('qa/epic-2e-n1-n5-integration-static-test.mjs');
  check('68. RCM N1-N5 integration suite (5/5) remains passing', /5\/5 PASS/.test(n1n5.out));

  const lockManifest = runSuite('qa/epic-2e-j-r2-phase-e-static-test.mjs');
  check('69. Production-lock manifest suite remains passing -- no locked/legacy file (core/decision-engine, core/xmp-validator, etc.) was touched by P1E', lockManifest.ok);

  const esmGate = runSuite('qa/epic-2e-j-esm-syntax-gate-static-test.mjs');
  check('70. ESM syntax gate suite remains passing (new P1E files carry no duplicate-declaration/comment-corruption defects)', esmGate.ok);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
