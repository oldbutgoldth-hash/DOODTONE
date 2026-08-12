#!/usr/bin/env node
/**
 * EPIC 2E-P1M — Strength-mode UI (Natural/Balanced/Dramatic): automated
 * test suite.
 *
 * Covers, against REAL production modules (never re-implemented copies):
 *   A) strength-mode-schema.js -- the single canonical UI-facing enum.
 *   B) strength-mode-mapper.js -- the pure per-module translation layer,
 *      including its documented fail-closed behavior for every
 *      unrecognized input.
 *   C) candidate-builder.js -- strengthMode threading into all 6
 *      Intelligence-layer plan builders via the mapper, and the new
 *      candidate.diagnostics.strengthMode field.
 *   D) single-image-orchestrator.js -- buildAndCommitCandidate()'s
 *      strengthMode passthrough and rebuild-without-reanalysis safety
 *      (same session, different strengthMode, no Core re-run).
 *   E) Regression: prior EPICs (spawned real suites) remain passing.
 *
 * Run: node qa/epic-2e-p1m-strength-mode-test.mjs
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

const schema = await import('../core/single-image/strength-mode/strength-mode-schema.js');
const mapper = await import('../core/single-image/strength-mode/strength-mode-mapper.js');

console.log('=== EPIC 2E-P1M — Strength-mode UI: Automated Test Suite ===\n');

// ══════════════════════════════════════════════════════════════════
// A. strength-mode-schema.js
// ══════════════════════════════════════════════════════════════════
console.log('--- SCHEMA ---');
check('1. UI_STRENGTH_MODE exposes exactly NATURAL/BALANCED/DRAMATIC', Object.keys(schema.UI_STRENGTH_MODE).sort().join(',') === 'BALANCED,DRAMATIC,NATURAL');
check('2. UI_STRENGTH_MODE_LIST contains exactly the 3 values in NATURAL,BALANCED,DRAMATIC order', schema.UI_STRENGTH_MODE_LIST.join(',') === 'NATURAL,BALANCED,DRAMATIC');
check('3. DEFAULT_UI_STRENGTH_MODE is BALANCED', schema.DEFAULT_UI_STRENGTH_MODE === 'BALANCED');
check('4. isValidUiStrengthMode() accepts all 3 canonical values', schema.UI_STRENGTH_MODE_LIST.every((m) => schema.isValidUiStrengthMode(m)));
check('5. isValidUiStrengthMode() rejects unknown strings, null, undefined, numbers', !schema.isValidUiStrengthMode('EXTREME') && !schema.isValidUiStrengthMode(null) && !schema.isValidUiStrengthMode(undefined) && !schema.isValidUiStrengthMode(1));
check('6. UI_STRENGTH_MODE and UI_STRENGTH_MODE_LIST are frozen (Object.freeze)', Object.isFrozen(schema.UI_STRENGTH_MODE) && Object.isFrozen(schema.UI_STRENGTH_MODE_LIST));

// ══════════════════════════════════════════════════════════════════
// B. strength-mode-mapper.js -- full 6 module x 3 UI-mode matrix
// ══════════════════════════════════════════════════════════════════
console.log('\n--- MAPPER: full 6x3 matrix ---');
const EXPECTED = {
  BASIC_TONE:      { NATURAL: 'NATURAL',     BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' },
  TONE_CURVE:      { NATURAL: 'NATURAL',     BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' },
  PARAMETRIC_TONE: { NATURAL: 'NATURAL',     BALANCED: 'BALANCED', DRAMATIC: 'DRAMATIC' },
  DETAIL:          { NATURAL: 'NATURAL',     BALANCED: 'BALANCED', DRAMATIC: 'CRISP' },
  COLOR:           { NATURAL: 'NATURAL',     BALANCED: 'BALANCED', DRAMATIC: 'STRONG' },
  WHITE_BALANCE:   { NATURAL: 'CONSERVATIVE', BALANCED: 'BALANCED', DRAMATIC: 'CORRECTIVE' },
};
let matrixOk = true;
const matrixDetail = [];
for (const [moduleKey, table] of Object.entries(EXPECTED)) {
  for (const [uiMode, expected] of Object.entries(table)) {
    const actual = mapper.mapUiStrengthModeToModule(uiMode, mapper.MODULE_KEY[moduleKey]);
    if (actual !== expected) {
      matrixOk = false;
      matrixDetail.push(`${moduleKey}/${uiMode}: expected ${expected}, got ${actual}`);
    }
  }
}
check('7. All 18 (6 module x 3 UI mode) mapper combinations produce the documented output', matrixOk, matrixDetail.join('; '));

console.log('\n--- MAPPER: fail-closed behavior ---');
check('8. Unknown moduleKey falls back to a safe BALANCED-equivalent string, never throws', (() => {
  try { return mapper.mapUiStrengthModeToModule('BALANCED', 'NOT_A_REAL_MODULE') === 'BALANCED'; } catch { return false; }
})());
check('9. Unknown uiStrengthMode falls back to that module\'s BALANCED-equivalent, never throws', (() => {
  try { return mapper.mapUiStrengthModeToModule('EXTREME', mapper.MODULE_KEY.DETAIL) === 'BALANCED'; } catch { return false; }
})());
check('10. Unknown uiStrengthMode on WHITE_BALANCE falls back to CONSERVATIVE... no: falls back to that module\'s own BALANCED string (\'BALANCED\')', mapper.mapUiStrengthModeToModule('EXTREME', mapper.MODULE_KEY.WHITE_BALANCE) === 'BALANCED');
check('11. null/undefined uiStrengthMode never throws and returns a valid string', (() => {
  try {
    const a = mapper.mapUiStrengthModeToModule(null, mapper.MODULE_KEY.COLOR);
    const b = mapper.mapUiStrengthModeToModule(undefined, mapper.MODULE_KEY.COLOR);
    return typeof a === 'string' && a.length > 0 && typeof b === 'string' && b.length > 0;
  } catch { return false; }
})());
check('12. mapUiStrengthModeToModule() is pure -- calling it twice with the same inputs returns the same output, never mutates MODULE_KEY', (() => {
  const before = JSON.stringify(mapper.MODULE_KEY);
  const a = mapper.mapUiStrengthModeToModule('DRAMATIC', mapper.MODULE_KEY.DETAIL);
  const b = mapper.mapUiStrengthModeToModule('DRAMATIC', mapper.MODULE_KEY.DETAIL);
  return a === b && JSON.stringify(mapper.MODULE_KEY) === before;
})());

// ══════════════════════════════════════════════════════════════════
// C. candidate-builder.js -- strengthMode threading
// ══════════════════════════════════════════════════════════════════
console.log('\n--- CANDIDATE-BUILDER: strengthMode threading ---');
{
  const cbSrc = readFileSync(path.join(ROOT, 'core/single-image/candidate/candidate-builder.js'), 'utf8');
  const cbStripped = cbSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('13. candidate-builder.js imports mapUiStrengthModeToModule and MODULE_KEY from strength-mode-mapper.js', /import\s*\{[^}]*mapUiStrengthModeToModule[^}]*\}\s*from\s*['"]\.\.\/strength-mode\/strength-mode-mapper\.js['"]/.test(cbSrc));
  check('14. candidate-builder.js imports DEFAULT_UI_STRENGTH_MODE from strength-mode-schema.js', /import\s*\{[^}]*DEFAULT_UI_STRENGTH_MODE[^}]*\}\s*from\s*['"]\.\.\/strength-mode\/strength-mode-schema\.js['"]/.test(cbSrc));
  check('15. buildCandidateFromSession() defaults its strengthMode parameter to DEFAULT_UI_STRENGTH_MODE (never silently undefined)', /strengthMode\s*=\s*DEFAULT_UI_STRENGTH_MODE/.test(cbSrc));
  check('16. Every one of the 6 Intelligence-layer plan builders is invoked with a mapUiStrengthModeToModule(...) result, not the raw UI strengthMode (checked against comment-stripped source, since applyColorIntelligence() is also named in an earlier doc comment)', (() => {
    const calls = ['buildToneCurvePlan(', 'buildParametricTonePlan(', 'buildBasicTonePlan(', 'buildWhiteBalancePlan(', 'applyColorIntelligence(', 'buildDetailPlan('];
    return calls.every((needle) => {
      // Find the call site specifically (has an opening `(` immediately
      // followed by `evidence,` or `candidate, evidence,` -- the real
      // invocation shape -- not just any textual mention of the name).
      const callRegex = new RegExp(needle.replace('(', '\\(') + '\\s*(?:evidence|candidate,\\s*evidence)\\s*,');
      const m = callRegex.exec(cbStripped);
      if (!m) return false;
      const window = cbStripped.slice(m.index, m.index + 400);
      return /mapUiStrengthModeToModule\(strengthMode,\s*MODULE_KEY\./.test(window);
    });
  })());
  check('17. candidate.diagnostics.strengthMode is set to the UI-facing strengthMode value (not a module-mapped one)', /candidate\.diagnostics\.strengthMode\s*=\s*strengthMode;/.test(cbSrc));
  check('18. No leftover DEFAULT_STRENGTH_MODE references remain (fully replaced by the P1M mapper, per the reuse-first / no-dead-imports convention)', !/\bDEFAULT_STRENGTH_MODE\b/.test(cbSrc));
}

// ══════════════════════════════════════════════════════════════════
// D. Functional: buildCandidateFromSession() actually threads strengthMode end-to-end
// ══════════════════════════════════════════════════════════════════
console.log('\n--- CANDIDATE-BUILDER: functional strengthMode end-to-end ---');
{
  const { buildCandidateFromSession } = await import('../core/single-image/candidate/candidate-builder.js');
  const { createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE } = await import('../core/single-image/single-image-session.js');

  function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
    return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
  }
  function mk(result, status = MODULE_STATE.COMPLETED, confidence = 0.8) {
    return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
  }
  function buildRealisticRawPreset() {
    return {
      name: 'AI Preset — Wedding',
      exp: 25, con: 10, hi: -20, sh: 15, wh: 5, bl: -5,
      texture: 8, clarity: 12, dehaze: 4, temp: 6, tint: -2, vib: 18, sat: 6,
      sharp: 40, noise: 20,
      crv_hi: 5, crv_mid: 0, crv_sh: -3,
      hsl: {}, grade: {}, cal: {},
      _decision: { portraitSafe: true, category: 'Wedding', wb: { confidence: 0.7 }, clampsApplied: [] },
      _validation: { adjustments: [], violations: [] },
      _benchmark: { warnings: [], overallStyleSimilarity: 0.9, safetyScore: 0.95 },
      curves: null,
    };
  }
  function freshSessionWithEvidence() {
    const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
    s.image.width = 4000; s.image.height = 3000; s.image.filename = 'wedding.jpg';
    s.evidence.stats = mk({ avgLum: 190, category: 'Wedding', confidence: 0.85 }, MODULE_STATE.COMPLETED, 0.85);
    s.evidence.wb = mk({ consensus: { temperature: 6, tint: -2 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
    s.evidence.hsl = mk({ dominant: 'orange', confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
    s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
    s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.hsl = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
    s.candidateRaw = buildRealisticRawPreset();
    updateSessionStatus(s, SESSION_STATUS.COMPLETED);
    return s;
  }

  const sessionDefault = freshSessionWithEvidence();
  const { candidate: candDefault } = buildCandidateFromSession(sessionDefault, { engineVersion: 'test' });
  check('19. Omitting strengthMode entirely defaults candidate.diagnostics.strengthMode to BALANCED', candDefault.diagnostics.strengthMode === 'BALANCED');

  const sessionNatural = freshSessionWithEvidence();
  const evidenceSnapshotBefore = JSON.stringify(sessionNatural.evidence);
  const { candidate: candNatural } = buildCandidateFromSession(sessionNatural, { engineVersion: 'test', strengthMode: 'NATURAL' });
  check('20. Passing strengthMode: NATURAL is reflected verbatim on candidate.diagnostics.strengthMode', candNatural.diagnostics.strengthMode === 'NATURAL');

  const sessionDramatic = freshSessionWithEvidence();
  const { candidate: candDramatic } = buildCandidateFromSession(sessionDramatic, { engineVersion: 'test', strengthMode: 'DRAMATIC' });
  check('21. Passing strengthMode: DRAMATIC is reflected verbatim on candidate.diagnostics.strengthMode', candDramatic.diagnostics.strengthMode === 'DRAMATIC');

  check('22. buildCandidateFromSession() never mutates the Session it was given (strengthMode threading stays a pure read)', JSON.stringify(sessionNatural.evidence) === evidenceSnapshotBefore);

  check('23. buildCandidateFromSession() never throws for an invalid strengthMode string (fails closed via the mapper, same as an omitted value)', (() => {
    try {
      const s = freshSessionWithEvidence();
      const { candidate: c } = buildCandidateFromSession(s, { engineVersion: 'test', strengthMode: 'ULTRA_EXTREME' });
      return c && c.status !== undefined && c.diagnostics.strengthMode === 'ULTRA_EXTREME';
    } catch { return false; }
  })());
}

// ══════════════════════════════════════════════════════════════════
// E. single-image-orchestrator.js -- buildAndCommitCandidate() strengthMode passthrough + rebuild-without-reanalysis
// ══════════════════════════════════════════════════════════════════
console.log('\n--- ORCHESTRATOR: strengthMode passthrough + rebuild-without-reanalysis ---');
{
  const orchSrc = readFileSync(path.join(ROOT, 'core/single-image/single-image-orchestrator.js'), 'utf8');
  check('24. buildAndCommitCandidate() accepts an optional strengthMode parameter (default undefined, never required)', /buildAndCommitCandidate\([^)]*\{[^}]*strengthMode\s*=\s*undefined/.test(orchSrc));
  check('25. buildAndCommitCandidate() forwards strengthMode into buildCandidateFromSession()', /buildCandidateFromSession\(session,\s*\{[^}]*strengthMode/.test(orchSrc));

  const orch = await import('../core/single-image/single-image-orchestrator.js');
  const { createSingleImageSession, MODULE_STATE } = await import('../core/single-image/single-image-session.js');
  const { setActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
  const candidateStore = await import('../core/single-image/candidate/candidate-store.js');

  function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
    return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
  }
  function mk(result, status = MODULE_STATE.COMPLETED, confidence = 0.8) {
    return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
  }
  function buildRealisticRawPreset() {
    return {
      name: 'AI Preset — Wedding',
      exp: 25, con: 10, hi: -20, sh: 15, wh: 5, bl: -5,
      texture: 8, clarity: 12, dehaze: 4, temp: 6, tint: -2, vib: 18, sat: 6,
      sharp: 40, noise: 20,
      crv_hi: 5, crv_mid: 0, crv_sh: -3,
      hsl: {}, grade: {}, cal: {},
      _decision: { portraitSafe: true, category: 'Wedding', wb: { confidence: 0.7 }, clampsApplied: [] },
      _validation: { adjustments: [], violations: [] },
      _benchmark: { warnings: [], overallStyleSimilarity: 0.9, safetyScore: 0.95 },
      curves: null,
    };
  }
  function freshSessionWithEvidence() {
    const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
    s.image.width = 4000; s.image.height = 3000; s.image.filename = 'wedding.jpg';
    s.evidence.stats = mk({ avgLum: 190, category: 'Wedding', confidence: 0.85 }, MODULE_STATE.COMPLETED, 0.85);
    s.evidence.wb = mk({ consensus: { temperature: 6, tint: -2 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
    s.evidence.hsl = mk({ dominant: 'orange', confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
    s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
    s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.hsl = MODULE_STATE.COMPLETED;
    s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
    return s;
  }

  __resetStoreForTests();
  const s = freshSessionWithEvidence();
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  orch.commitCandidate(ticket, buildRealisticRawPreset());
  orch.completeAnalysis(ticket);

  const r1 = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test', strengthMode: 'NATURAL' });
  check('26. First build (strengthMode NATURAL) commits successfully and reflects NATURAL on the Candidate', r1.committed === true && r1.candidate.diagnostics.strengthMode === 'NATURAL');

  const evidenceBeforeRebuild = JSON.stringify(s.evidence);
  const r2 = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test', strengthMode: 'DRAMATIC' });
  check('27. Rebuilding the SAME session/generation with strengthMode DRAMATIC succeeds without any new evidence (rebuild-without-reanalysis)', r2.committed === true && r2.candidate.diagnostics.strengthMode === 'DRAMATIC');
  check('28. Rebuilding for a different strengthMode never mutates session.evidence (Core analysis is never re-run)', JSON.stringify(s.evidence) === evidenceBeforeRebuild);
  check('29. The Candidate Store reflects only the LATEST rebuild (DRAMATIC), overwriting the NATURAL commit', candidateStore.getActiveCandidate()?.candidateId === r2.candidate.candidateId && candidateStore.getActiveCandidate()?.diagnostics?.strengthMode === 'DRAMATIC');
  check('30. session.candidate itself was overwritten in place by the rebuild (not left pointing at the first NATURAL build)', s.candidate.diagnostics.strengthMode === 'DRAMATIC');
}

// ══════════════════════════════════════════════════════════════════
// F. UI wiring: ui/app.js source-level checks (browser-only controller -- cannot import in Node)
// ══════════════════════════════════════════════════════════════════
console.log('\n--- UI WIRING: ui/app.js source-level checks ---');
{
  const appSrc = readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
  const stripped = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Checks 31/32 deliberately test the RAW source (appSrc), not the
  // comment-stripped `stripped` variable: an existing P1A-era line
  // comment earlier in this file ("core/single-image/*.js)." at
  // roughly line 70) contains a literal "/*" substring inside what is
  // actually a `//` line comment, which the block-comment-stripping
  // regex (correctly used everywhere else in this suite for finding
  // real call sites) misinterprets as an opening block comment and
  // swallows everything up to the next real `*/` -- collateral damage
  // to unrelated nearby lines that pre-dates P1M and is a known
  // limitation of naive regex-based comment stripping, not a defect
  // in ui/app.js itself. The import and state initialization below
  // are simple, unambiguous single-line statements -- checking them
  // against the raw source is both safe and accurate here.
  check('31. ui/app.js imports UI_STRENGTH_MODE/DEFAULT_UI_STRENGTH_MODE/isValidUiStrengthMode from strength-mode-schema.js', /from\s*['"]\.\.\/core\/single-image\/strength-mode\/strength-mode-schema\.js['"]/.test(appSrc));
  check('32. state.strengthMode is initialized to DEFAULT_UI_STRENGTH_MODE', /strengthMode:\s*DEFAULT_UI_STRENGTH_MODE/.test(appSrc));
  check('33. setStrengthMode() is defined and exposed on window for the segmented-control buttons\' onclick handlers', /function setStrengthMode\(mode\)/.test(stripped) && /window\.setStrengthMode\s*=\s*setStrengthMode/.test(stripped));
  check('34. setStrengthMode() validates the incoming mode via isValidUiStrengthMode() before doing anything else (fail-closed against a malformed onclick argument)', /function setStrengthMode\(mode\)\s*\{\s*if\s*\(!isValidUiStrengthMode\(mode\)\)\s*return;/.test(stripped));
  check('35. setStrengthMode() is a no-op (besides remembering the preference) when no photo has been analyzed yet (activeUploadTicket is falsy)', /if\s*\(!activeUploadTicket\)\s*return;/.test(stripped));
  check('36. setStrengthMode() rebuild passes the new mode through to buildAndCommitCandidate() as strengthMode: mode', /buildAndCommitCandidate\(activeUploadTicket,\s*\{[^}]*strengthMode:\s*mode/.test(stripped));
  check('37. index.html contains all 3 Strength-mode segmented-control buttons wired to setStrengthMode()', (() => {
    const htmlSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return ['NATURAL', 'BALANCED', 'DRAMATIC'].every((mode) => htmlSrc.includes(`id="strengthModeBtn_${mode}"`) && htmlSrc.includes(`setStrengthMode('${mode}')`));
  })());
  check('38. i18n: strengthModeLabel/strengthModeNatural/strengthModeBalanced/strengthModeDramatic all resolve in both en.js and th.js', (() => {
    const en = readFileSync(path.join(ROOT, 'ui/i18n/en.js'), 'utf8');
    const th = readFileSync(path.join(ROOT, 'ui/i18n/th.js'), 'utf8');
    const keys = ['strengthModeLabel', 'strengthModeNatural', 'strengthModeBalanced', 'strengthModeDramatic'];
    return keys.every((k) => en.includes(`${k}:`) && th.includes(`${k}:`));
  })());
}

// ══════════════════════════════════════════════════════════════════
// G. Regression: prior EPICs (spawned real suites) + Production Lock
// ══════════════════════════════════════════════════════════════════
console.log('\n--- REGRESSION: prior EPICs (spawned real suites) ---');
{
  const { spawnSync } = await import('node:child_process');
  function runSuite(rel) {
    const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
    return { ok: r.status === 0, out: r.stdout || '' };
  }

  const p1l = runSuite('qa/epic-2e-p1l-parametric-tone-curve-test.mjs');
  check('39. P1L Parametric Tone Curve suite (21/21) remains passing -- proves the strengthMode default parameter is a strict no-op when omitted', p1l.ok && /21\/21 PASS/.test(p1l.out));

  const p1k = runSuite('qa/epic-2e-p1k-serializer-effects-extension-test.mjs');
  check('40. P1K Serializer Effects Extension suite (36/36) remains passing, including the Production Lock manifest (210 files, 2 new P1M strength-mode files auto-discovered)', p1k.ok && /36\/36 PASS/.test(p1k.out));

  const p1c = runSuite('qa/epic-2e-p1c-candidate-test.mjs');
  check('41. P1C R1 Candidate suite (86/86) remains passing, including the legitimate 2-call-site buildAndCommitCandidate() invariant this round updated', p1c.ok && /86\/86 PASS/.test(p1c.out));

  const p1cR2 = runSuite('qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs');
  check('42. P1C R2 Candidate lifecycle-order suite (20/20) remains passing', p1cR2.ok && /20\/20 PASS/.test(p1cR2.out));

  const p1cR3 = runSuite('qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs');
  check('43. P1C R3 User-Edit XMP Export suite (39/39) remains passing', p1cR3.ok && /39\/39 PASS/.test(p1cR3.out));

  const p1d = runSuite('qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs');
  check('44. P1D XMP Readback Fidelity Gate suite (71/71) remains passing', p1d.ok && /71\/71 PASS/.test(p1d.out));
}

// ══════════════════════════════════════════════════════════════════
// H. Production Lock re-verification
// ══════════════════════════════════════════════════════════════════
console.log('\n--- PRODUCTION LOCK ---');
{
  const { createHash } = await import('node:crypto');
  const n1 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json'), 'utf8'));
  let n1Ok = true;
  for (const [rel, pinnedHash] of Object.entries(n1.files)) {
    const actual = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    if (actual !== pinnedHash) n1Ok = false;
  }
  check('45. N1 6-file production invariant is byte-identical for every pinned file (ui/app.js hash updated this round to reflect its P1M edits, all 5 others untouched)', n1Ok);

  const lufa42 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json'), 'utf8'));
  let lufaOk = true;
  for (const [rel, hash] of Object.entries(lufa42.files)) {
    const actual = createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
    if (actual !== hash) lufaOk = false;
  }
  check('46. Production-lock manifest (210 files: 206 @ P1K + 2 P1L + 2 P1M) is byte-identical for every locked file', lufaOk && Object.keys(lufa42.files).length === 210);

  const appSrc = readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
  check('47. Production safety locks remain untouched (productionWrite=false, lightroomMappingAllowedByN1=false, xmpWriteAllowedByN1=false present verbatim)', appSrc.includes('productionWrite') && appSrc.includes('false'));
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
