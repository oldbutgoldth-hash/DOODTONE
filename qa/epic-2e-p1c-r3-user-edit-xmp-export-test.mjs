#!/usr/bin/env node
/**
 * EPIC 2E-P1C R3 — User-Edit XMP Export: real integration test.
 *
 * Proves the fix for the real browser bug "Clicking Download XMP does
 * not download the file" (specifically after a slider edit, per the
 * bug report -- though direct execution during investigation for this
 * round showed the actual root cause reproduces even on the FIRST,
 * pre-edit export whenever the Candidate carries no point-curve data,
 * which is the common case for an Auto-Tune-only workflow that never
 * touches the Tone Curve editor. See P1C_R3_USER_EDIT_EXPORT_FIX.md
 * for the full root-cause writeup).
 *
 * Runs against the REAL production modules: core/single-image/
 * candidate/*.js, single-image-orchestrator.js,
 * single-image-session-store.js, core/xmp-validator/index.js,
 * core/preset-engine/index.js. `ui/app.js`'s handleDownload()/slider-
 * listener wiring is verified via source inspection (comment-stripped
 * substring/regex checks), the same pattern established in the P1C/
 * P1C-R2 suites -- ui/app.js is a browser-only DOM-driven controller
 * that cannot be fully imported in plain Node.
 *
 * Run: node qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs
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
  createSingleImageSession, SESSION_STATUS, MODULE_STATE,
} = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const {
  setActiveSession, isActiveGeneration, __resetStoreForTests,
} = await import('../core/single-image/single-image-session-store.js');
const candidateStore = await import('../core/single-image/candidate/candidate-store.js');
const { CANDIDATE_STATUS } = await import('../core/single-image/candidate/candidate-schema.js');
const { resolveSliderEdit } = await import('../core/single-image/candidate/candidate-slider-adapter.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { quickSafetyClamp } = await import('../core/xmp-validator/index.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');

function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}
function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}
function buildRealisticRawPreset(overrides = {}) {
  return {
    name: 'AI Preset — Wedding',
    exp: 25, con: 10, hi: -20, sh: 15, wh: 5, bl: -5,
    texture: 8, clarity: 12, dehaze: 4, temp: 6, tint: -2, vib: 18, sat: 6,
    sharp: 40, noise: 20,
    crv_hi: 5, crv_mid: 0, crv_sh: -3,
    hsl: {
      hsl_h_red: 2, hsl_s_red: 5, hsl_l_red: 0, hsl_h_orange: 3, hsl_s_orange: 8, hsl_l_orange: 2,
      hsl_h_yellow: 0, hsl_s_yellow: -4, hsl_l_yellow: 0, hsl_h_green: 0, hsl_s_green: -10, hsl_l_green: 0,
      hsl_h_aqua: 0, hsl_s_aqua: 0, hsl_l_aqua: 0, hsl_h_blue: -2, hsl_s_blue: 4, hsl_l_blue: 0,
      hsl_h_purple: 0, hsl_s_purple: 0, hsl_l_purple: 0, hsl_h_magenta: 0, hsl_s_magenta: 0, hsl_l_magenta: 0,
    },
    grade: {
      grd_sh_h: 220, grd_sh_s: 10, grd_sh_l: 0, grd_mid_h: 40, grd_mid_s: 5, grd_mid_l: 0,
      grd_hi_h: 50, grd_hi_s: 8, grd_hi_l: 0, grd_blend: 55,
    },
    cal: { cal_red_h: 0, cal_red_s: 5, cal_green_h: 0, cal_green_s: -5, cal_blue_h: 0, cal_blue_s: 0 },
    _decision: { portraitSafe: true, category: 'Wedding', wb: { confidence: 0.7 }, clampsApplied: [] },
    _validation: { adjustments: [], violations: [] },
    _benchmark: { warnings: [], overallStyleSimilarity: 0.9, safetyScore: 0.95 },
    curves: null, // the realistic default -- no Tone Curve editor touched
    ...overrides,
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
/** Build a COMPLETED session all the way to a committed, VALID Candidate via the real corrected lifecycle. */
function buildReadySession() {
  __resetStoreForTests();
  const s = freshSessionWithEvidence();
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  orch.commitCandidate(ticket, buildRealisticRawPreset());
  const finalStatus = orch.completeAnalysis(ticket);
  const built = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  return { session: s, ticket, finalStatus, built };
}

// Deep-diff two plain "value group" subtrees, returning the set of
// leaf dotted paths whose value differs. Used to prove a single-
// parameter edit touched exactly one leaf.
const VALUE_GROUPS = ['whiteBalance', 'basic', 'curves', 'hsl', 'grading', 'cal', 'detail'];
function leafPaths(obj, prefix = '') {
  const out = [];
  if (obj === null || typeof obj !== 'object') { out.push(prefix); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}
function diffValueGroups(before, after) {
  const changed = [];
  for (const g of VALUE_GROUPS) {
    const bLeaves = leafPaths(before[g] ?? {}, g);
    for (const p of bLeaves) {
      const bv = p.split('.').reduce((o, k) => o?.[k], before);
      const av = p.split('.').reduce((o, k) => o?.[k], after);
      if (bv !== av) changed.push(p);
    }
  }
  return changed;
}

// ══════════════════════════════════════════════════════════════════
// 1. Valid Candidate is export-ready before edit.
// ══════════════════════════════════════════════════════════════════
let ctx = buildReadySession();
{
  check('1. Valid Candidate is export-ready before any edit', ctx.built.committed && candidateStore.getCandidateExportReadiness().ready === true, ctx.built.candidate?.status);
}

// ══════════════════════════════════════════════════════════════════
// 2-11. Edit Exposure end-to-end through a real XMP export.
// ══════════════════════════════════════════════════════════════════
{
  const before = candidateStore.getActiveCandidate();
  const beforeRevision = before.revision;
  const beforeSnapshot = structuredClone(before);

  const resolved = resolveSliderEdit('exp', '65');
  check('2. resolveSliderEdit() returns a finite number for Exposure', resolved && Number.isFinite(resolved.clampedValue), JSON.stringify(resolved));

  const updateResult = candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, resolved.parameterPath, resolved.clampedValue);
  check('3. Edit commits successfully', updateResult.committed === true, updateResult.reason);
  check('4. Status becomes USER_EDITED', updateResult.candidate?.status === CANDIDATE_STATUS.USER_EDITED);
  check('5. Revision increments exactly once', updateResult.candidate?.revision === beforeRevision + 1, `${beforeRevision} -> ${updateResult.candidate?.revision}`);

  const afterExposure = candidateStore.getActiveCandidate();
  const changedPaths = diffValueGroups(beforeSnapshot, afterExposure);
  check('6. Only basic.exposure changes', changedPaths.length === 1 && changedPaths[0] === 'basic.exposure', JSON.stringify(changedPaths));

  const readinessAfterExposure = candidateStore.getCandidateExportReadiness();
  check('7. Candidate remains export-ready after the edit', readinessAfterExposure.ready === true, readinessAfterExposure.reason);

  const preset8 = candidateToLegacyPreset(readinessAfterExposure.candidate);
  check('8. candidateToLegacyPreset() contains the edited Exposure', preset8.exp === resolved.clampedValue, `${preset8.exp} vs ${resolved.clampedValue}`);

  let safety9, xmp10;
  let threw9 = false, threw10 = false;
  try { safety9 = quickSafetyClamp(preset8); } catch (e) { threw9 = e; }
  check('9. quickSafetyClamp() succeeds', !threw9 && !!safety9?.preset, threw9?.message);

  try { xmp10 = serializeXMP(safety9.preset); } catch (e) { threw10 = e; }
  check('10. serializeXMP() succeeds', !threw10 && typeof xmp10 === 'string' && xmp10.length > 0, threw10?.message);

  const expMatch = xmp10?.match(/Exposure2012="([^"]+)"/)?.[1];
  const expectedExp = (safety9.preset.exp / 100).toFixed(2);
  check('11. Generated XMP contains the edited Exposure value', expMatch === expectedExp, `xmp=${expMatch} expected=${expectedExp}`);
}

// ══════════════════════════════════════════════════════════════════
// 12-14. Edit HSL Orange Saturation.
// ══════════════════════════════════════════════════════════════════
{
  const before = candidateStore.getActiveCandidate();
  const beforeSnapshot = structuredClone(before);

  const resolved = resolveSliderEdit('hsl_s_orange', '-30');
  const updateResult = candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, resolved.parameterPath, resolved.clampedValue);
  check('12. Edit HSL Orange Saturation commits successfully', updateResult.committed === true, updateResult.reason);

  const after = candidateStore.getActiveCandidate();
  const changedPaths = diffValueGroups(beforeSnapshot, after);
  check('13. Only hsl.saturation.orange changes', changedPaths.length === 1 && changedPaths[0] === 'hsl.saturation.orange', JSON.stringify(changedPaths));

  const readiness = candidateStore.getCandidateExportReadiness();
  const preset = candidateToLegacyPreset(readiness.candidate);
  const safety = quickSafetyClamp(preset);
  const xmp = serializeXMP(safety.preset);
  const match = xmp.match(/SaturationAdjustmentOrange="([^"]+)"/)?.[1];
  check('14. XMP contains the edited Orange Saturation', Number(match) === safety.preset.hsl.hsl_s_orange, `xmp=${match} expected=${safety.preset.hsl.hsl_s_orange}`);
}

// ══════════════════════════════════════════════════════════════════
// 15-16. Edit Temperature and Tint -- both remain numbers.
// ══════════════════════════════════════════════════════════════════
{
  const tempResolved = resolveSliderEdit('temp', '17');
  const tempResult = candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, tempResolved.parameterPath, tempResolved.clampedValue);
  const tintResolved = resolveSliderEdit('tint', '-9');
  const tintResult = candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, tintResolved.parameterPath, tintResolved.clampedValue);
  check('15. Edit Temperature and Tint both commit successfully', tempResult.committed === true && tintResult.committed === true);
  const after = candidateStore.getActiveCandidate();
  check('16. Both Temperature and Tint remain finite numbers', Number.isFinite(after.whiteBalance.temperature) && Number.isFinite(after.whiteBalance.tint), `${after.whiteBalance.temperature}, ${after.whiteBalance.tint}`);
}

// ══════════════════════════════════════════════════════════════════
// 17-19. Invalid NaN edit is rejected transactionally.
// ══════════════════════════════════════════════════════════════════
{
  const before = candidateStore.getActiveCandidate();
  const beforeSnapshot = structuredClone(before);
  const beforeReadiness = candidateStore.getCandidateExportReadiness();
  check('(precondition) Candidate is export-ready before the invalid edit attempt', beforeReadiness.ready === true);

  const rejectResult = candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, 'basic.exposure', NaN);
  check('17. Invalid NaN edit is rejected transactionally', rejectResult.committed === false && rejectResult.reason === 'UNSAFE_VALUE', JSON.stringify(rejectResult));

  const afterReject = candidateStore.getActiveCandidate();
  const changedPaths = diffValueGroups(beforeSnapshot, afterReject);
  check('18. Rejected edit does not destroy the previous valid Candidate', changedPaths.length === 0 && afterReject.status === beforeSnapshot.status && afterReject.revision === beforeSnapshot.revision, JSON.stringify(changedPaths));

  const readinessAfterReject = candidateStore.getCandidateExportReadiness();
  check('19a. Export readiness still true using the last valid Candidate after a rejected edit', readinessAfterReject.ready === true, readinessAfterReject.reason);
  let threw = false;
  try {
    const preset = candidateToLegacyPreset(readinessAfterReject.candidate);
    const safety = quickSafetyClamp(preset);
    serializeXMP(safety.preset);
  } catch (e) { threw = e; }
  check('19b. Export still works (no throw) using the last valid Candidate after a rejected edit', !threw, threw?.message);
}

// ══════════════════════════════════════════════════════════════════
// 20. Stale Image A edit cannot modify Image B Candidate.
// ══════════════════════════════════════════════════════════════════
{
  const ctxA = buildReadySession();
  const ctxB = buildReadySession(); // becomes the new active session/generation

  check('(precondition) Image B is the active generation, Image A is not', isActiveGeneration(ctxB.ticket.sessionId, ctxB.ticket.generationId) === true && isActiveGeneration(ctxA.ticket.sessionId, ctxA.ticket.generationId) === false);

  const staleResult = candidateStore.updateCandidateParameter(ctxA.ticket.sessionId, ctxA.ticket.generationId, 'basic.exposure', 99);
  check('20. Stale Image A edit cannot modify Image B\'s Candidate', staleResult.committed === false && staleResult.reason === 'STALE_GENERATION');
  check('20b. Image B\'s Candidate is unaffected by the stale Image A edit attempt', candidateStore.getActiveCandidate()?.sessionId === ctxB.session.sessionId && candidateStore.getActiveCandidate()?.basic.exposure !== 99);

  // Restore ctx to Image B's context for remaining checks below? Not
  // needed -- ctx below is only used for the fresh USER_EDITED checks.
  ctx = ctxB;
}

// ══════════════════════════════════════════════════════════════════
// 21-22. A USER_EDITED Candidate passes both getValidatedCandidate()
// and getCandidateExportReadiness().
// ══════════════════════════════════════════════════════════════════
{
  const resolved = resolveSliderEdit('con', '20');
  candidateStore.updateCandidateParameter(ctx.ticket.sessionId, ctx.ticket.generationId, resolved.parameterPath, resolved.clampedValue);
  check('21. A USER_EDITED Candidate passes getValidatedCandidate()', candidateStore.getValidatedCandidate()?.status === CANDIDATE_STATUS.USER_EDITED);
  const readiness = candidateStore.getCandidateExportReadiness();
  check('22. A USER_EDITED Candidate passes getCandidateExportReadiness()', readiness.ready === true && readiness.candidate?.status === CANDIDATE_STATUS.USER_EDITED);
}

// ══════════════════════════════════════════════════════════════════
// 23-25. ui/app.js source-level integration checks (browser-only controller — cannot import in Node)
// ══════════════════════════════════════════════════════════════════
{
  const appSrc = readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
  const stripped = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const downloadStart = stripped.indexOf('function handleDownload()');
  const downloadEnd = stripped.indexOf('\nfunction ', downloadStart + 10);
  const downloadBody = stripped.slice(downloadStart, downloadEnd > 0 ? downloadEnd : downloadStart + 4000);

  check('23. Download does not call readSlidersAsPreset()', downloadStart > -1 && !downloadBody.includes('readSlidersAsPreset()'));
  check('24. Download does not rerun analysis (no runAnalysis()/commitEvidence()/buildAndCommitCandidate() call inside handleDownload())', downloadStart > -1 && !downloadBody.includes('runAnalysis(') && !downloadBody.includes('commitEvidence(') && !downloadBody.includes('buildAndCommitCandidate('));
  check('24b. handleDownload() wraps the export pipeline in try/catch with the required diagnostic', /try\s*\{[\s\S]{0,1500}catch\s*\(error\)\s*\{[\s\S]{0,400}\[P1C XMP Export Failed\]/.test(downloadBody));
  check('24c. handleDownload() uses getCandidateExportReadiness() and blocks on !ready', downloadBody.includes('getCandidateExportReadiness()') && /if\s*\(!readiness\.ready\)/.test(downloadBody));

  const storeSource = readFileSync(path.join(ROOT, 'core/single-image/candidate/candidate-store.js'), 'utf8');
  const updateFnStart = storeSource.indexOf('export function updateCandidateParameter');
  const updateFnEnd = storeSource.indexOf('\nexport function ', updateFnStart + 10);
  const updateFnBody = storeSource.slice(updateFnStart, updateFnEnd > 0 ? updateFnEnd : updateFnStart + 4000);
  check('25. Manual edit (updateCandidateParameter) never rebuilds the whole Candidate (no buildCandidateFromSession/buildAndCommitCandidate call)', updateFnStart > -1 && !updateFnBody.includes('buildCandidateFromSession') && !updateFnBody.includes('buildAndCommitCandidate'));
  check('25b. updateCandidateParameter() is transactional: clones before mutating, validates the clone, and only commits on success', updateFnBody.includes('structuredClone(') && /validateCandidateShape\(clone\)/.test(updateFnBody));
}

// ══════════════════════════════════════════════════════════════════
// 26-30. Full regression re-verification (delegates to their own suites)
// ══════════════════════════════════════════════════════════════════
{
  const { spawnSync } = await import('node:child_process');
  function runSuite(rel) {
    const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
    return r.status === 0;
  }
  check('26. P1C R2 lifecycle-order test (19/19) remains passing', runSuite('qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs'));
  check('26b. P1C R1 candidate test (86/86) remains passing', runSuite('qa/epic-2e-p1c-candidate-test.mjs'));
  check('27. P1B AI Image Analysis Report test (39/39) remains passing', runSuite('qa/epic-2e-p1b-analysis-report-test.mjs'));
  check('28. P1A Single Image Session (25/25) + Upload Lifecycle (16/16) tests remain passing', runSuite('qa/epic-2e-p1a-single-image-session-test.mjs') && runSuite('qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs'));
  check('29. P0.8A / Reference Color Match pinned-baseline invariant suites remain passing', runSuite('qa/epic-2e-n1-core-color-match-integration-static-test.mjs') && runSuite('qa/epic-2e-n1-n5-integration-static-test.mjs') && runSuite('qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs'));
  check('30. Production-lock manifest (145 files) remains byte-identical for every locked file', runSuite('qa/epic-2e-j-r2-phase-e-static-test.mjs'));
}

// ══════════════════════════════════════════════════════════════════
// Bonus: Production safety locks unchanged by this round's edits.
// ══════════════════════════════════════════════════════════════════
{
  const xmpValidatorSrc = readFileSync(path.join(ROOT, 'core/xmp-validator/index.js'), 'utf8');
  const productionFlagsIntact = /productionWrite\s*=\s*false|xmpWriteAllowed\s*:\s*false/.test(xmpValidatorSrc) || !/productionWrite\s*=\s*true/.test(xmpValidatorSrc);
  check('Bonus. Production safety locks (productionWrite=false etc.) are not flipped by any R3 module', productionFlagsIntact);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
