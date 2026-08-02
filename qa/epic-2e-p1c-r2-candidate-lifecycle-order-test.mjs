#!/usr/bin/env node
/**
 * EPIC 2E-P1C R2 — Candidate Runtime Lifecycle Order: integration test.
 *
 * Proves the fix for the real browser bug "สร้างค่า AUTO-TUNE ไม่สำเร็จ"
 * / "Auto-Tune Candidate build failed": buildAndCommitCandidate() was
 * being called while the Session was still ANALYZING (before
 * completeAnalysis() ever ran), so its own terminal-status guard
 * always rejected the build with reason SESSION_NOT_TERMINAL.
 *
 * Two kinds of check, both against REAL production code:
 *   A) Source-order checks against the actual ui/app.js -- proves the
 *      shipped UI file itself calls the orchestrator functions in the
 *      corrected order (commitCandidate -> completeAnalysis ->
 *      buildAndCommitCandidate), not just that the pattern is
 *      theoretically possible.
 *   B) Functional checks that exercise the real
 *      core/single-image/single-image-orchestrator.js,
 *      single-image-session-store.js and candidate/candidate-store.js
 *      modules directly, in the exact sequence ui/app.js now uses --
 *      proving the corrected sequence actually produces a committed
 *      Candidate, and that every unsafe variant (ANALYZING, FAILED,
 *      stale ticket) is refused.
 *
 * This file's UI_APP_JS_PATH can be overridden via argv[2] so the
 * same source-order checks can be run against a reconstructed
 * pre-fix copy of ui/app.js to prove they fail on the broken source
 * -- see P1C_R2_RUNTIME_LIFECYCLE_FIX.md for that verification run.
 *
 * Run: node qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const UI_APP_JS_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'ui/app.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE,
} = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const {
  setActiveSession, isActiveGeneration, __resetStoreForTests,
} = await import('../core/single-image/single-image-session-store.js');
const candidateStore = await import('../core/single-image/candidate/candidate-store.js');
const { CANDIDATE_STATUS } = await import('../core/single-image/candidate/candidate-schema.js');

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
    curves: null,
    ...overrides,
  };
}
function freshSessionWithEvidence({ degraded = false } = {}) {
  const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 'wedding.jpg';
  s.evidence.stats = mk({ avgLum: 190, category: 'Wedding', confidence: 0.85 }, MODULE_STATE.COMPLETED, 0.85);
  s.evidence.wb = mk({ consensus: { temperature: 6, tint: -2 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.hsl = mk({ dominant: 'orange', confidence: 0.65 }, degraded ? MODULE_STATE.SOFT_FAILED : MODULE_STATE.COMPLETED, degraded ? 0 : 0.65);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.runtime.moduleStates.stats = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.wb = MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.hsl = degraded ? MODULE_STATE.SOFT_FAILED : MODULE_STATE.COMPLETED;
  s.runtime.moduleStates.styleFeatureGraph = MODULE_STATE.COMPLETED;
  return s;
}

// ══════════════════════════════════════════════════════════════════
// A. Source-order checks against the real ui/app.js runAnalysis() lifecycle
// ══════════════════════════════════════════════════════════════════
{
  const appSrc = readFileSync(UI_APP_JS_PATH, 'utf8');
  const stripped = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const commitCandidateIdx = stripped.indexOf('singleImageOrchestrator.commitCandidate(analysisTicket');
  const completeAnalysisIdx = stripped.indexOf('singleImageOrchestrator.completeAnalysis(analysisTicket');
  const buildAndCommitCandidateIdx = stripped.indexOf('singleImageOrchestrator.buildAndCommitCandidate(analysisTicket');

  check(
    '1. commitCandidate() occurs before completeAnalysis() in ui/app.js runAnalysis()',
    commitCandidateIdx > -1 && completeAnalysisIdx > -1 && commitCandidateIdx < completeAnalysisIdx,
    `commitCandidate@${commitCandidateIdx}, completeAnalysis@${completeAnalysisIdx}`,
  );
  check(
    '2. buildAndCommitCandidate() occurs after completeAnalysis() in ui/app.js runAnalysis()',
    buildAndCommitCandidateIdx > -1 && completeAnalysisIdx > -1 && buildAndCommitCandidateIdx > completeAnalysisIdx,
    `completeAnalysis@${completeAnalysisIdx}, buildAndCommitCandidate@${buildAndCommitCandidateIdx}`,
  );

  // 3. Structural proof the build is never reachable while ANALYZING: the
  // ONLY buildAndCommitCandidate() call site must be textually inside an
  // `if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL')`
  // gate that itself starts after the completeAnalysis() assignment.
  const gateIdx = stripped.indexOf(
    "if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL')",
    completeAnalysisIdx > -1 ? completeAnalysisIdx : 0,
  );
  check(
    '3. buildAndCommitCandidate() is never attempted while Session status is ANALYZING (call site is gated on the real finalSessionStatus returned by completeAnalysis())',
    gateIdx > -1 && gateIdx < buildAndCommitCandidateIdx,
    `gate@${gateIdx}, build@${buildAndCommitCandidateIdx}`,
  );

  check(
    '(structural) Exactly one buildAndCommitCandidate() call site in ui/app.js',
    (stripped.match(/singleImageOrchestrator\.buildAndCommitCandidate\(/g) || []).length === 1,
  );

  // 7a. Slider synchronization (renderCandidateToSliders) must be textually
  // inside the successful-commit branch, after the buildAndCommitCandidate() call.
  const renderIdx = stripped.indexOf('renderCandidateToSliders(candidateResult.candidate', buildAndCommitCandidateIdx > -1 ? buildAndCommitCandidateIdx : 0);
  check(
    '7a. Slider synchronization (renderCandidateToSliders) is textually inside the successful-commit branch, after buildAndCommitCandidate()',
    renderIdx > -1 && buildAndCommitCandidateIdx > -1 && renderIdx > buildAndCommitCandidateIdx,
  );
  check(
    '7b. Slider-sync guard is set true before rendering and unset in a finally block (cannot stick true on a thrown error)',
    /_candidateSliderSyncGuard = true;\s*try\s*\{[\s\S]{0,400}renderCandidateToSliders\(candidateResult\.candidate[\s\S]{0,400}\}\s*finally\s*\{\s*state\._candidateSliderSyncGuard = false;/.test(stripped),
  );

  check(
    '(diagnostics) The required [P1C Candidate Build Failed] console.error diagnostic is present with all 7 required fields',
    ["reason: candidateResult?.reason", "sessionStatus:", "sessionId: analysisTicket?.sessionId", "generationId: analysisTicket?.generationId", "candidateRawAvailable:", "validationErrors: candidateResult?.validation?.errors", "validationWarnings: candidateResult?.validation?.warnings"]
      .every((needle) => stripped.includes(needle)) && stripped.includes("console.error('[P1C Candidate Build Failed]'"),
  );
}

// ══════════════════════════════════════════════════════════════════
// B. Functional checks against the real orchestrator/session-store/candidate-store
// ══════════════════════════════════════════════════════════════════

// 3 (functional half). The already-existing terminal-status guard inside
// buildAndCommitCandidate() itself refuses to build while ANALYZING.
{
  __resetStoreForTests();
  const s = freshSessionWithEvidence();
  s.candidateRaw = buildRealisticRawPreset();
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  check('3b. (functional) buildAndCommitCandidate() called while status is ANALYZING returns committed:false, reason SESSION_NOT_TERMINAL (the preserved guard)', (() => {
    const r = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
    return r.committed === false && r.reason === 'SESSION_NOT_TERMINAL' && s.candidate === null;
  })());
}

// 4. COMPLETED Session builds and commits exactly one Candidate, via the
// exact corrected sequence: commitCandidate -> completeAnalysis -> gate -> buildAndCommitCandidate.
{
  __resetStoreForTests();
  const s = freshSessionWithEvidence({ degraded: false });
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  orch.commitCandidate(ticket, buildRealisticRawPreset());
  const finalStatus = orch.completeAnalysis(ticket);
  let candidateResult = null;
  if (finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL') {
    candidateResult = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  }
  check('4. A COMPLETED Session builds and commits exactly one Candidate', finalStatus === SESSION_STATUS.COMPLETED && candidateResult?.committed === true && candidateStore.getActiveCandidate()?.candidateId === candidateResult.candidate.candidateId);
  check('8. No FAILED/INVALID Candidate badge status results from a valid COMPLETED Session', ![CANDIDATE_STATUS.FAILED, CANDIDATE_STATUS.INVALID].includes(candidateResult.candidate.status), candidateResult.candidate.status);
}

// 5. PARTIAL Session (an optional module degraded) with candidateRaw
// present still builds a Candidate.
{
  __resetStoreForTests();
  const s = freshSessionWithEvidence({ degraded: true });
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  orch.commitCandidate(ticket, buildRealisticRawPreset());
  const finalStatus = orch.completeAnalysis(ticket);
  let candidateResult = null;
  if (finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL') {
    candidateResult = orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  }
  check('5. A PARTIAL Session with candidateRaw available still builds and commits a Candidate', finalStatus === SESSION_STATUS.PARTIAL && candidateResult?.committed === true);
}

// 6. FAILED Session (a required module failed) does not build a Candidate.
{
  __resetStoreForTests();
  const s = freshSessionWithEvidence();
  s.status = SESSION_STATUS.FAILED; // mirrors commitEvidence()'s own REQUIRED_MODULE_FAILED path
  const ticket = { sessionId: s.sessionId, generationId: s.generationId };
  setActiveSession(s);
  orch.commitCandidate(ticket, buildRealisticRawPreset());
  const finalStatus = orch.completeAnalysis(ticket);
  let attempted = false;
  if (finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL') {
    attempted = true;
    orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' });
  }
  check('6a. A FAILED Session never reaches the Candidate-build call (finalSessionStatus gate skips it)', finalStatus === SESSION_STATUS.FAILED && attempted === false);
  check('6b. A FAILED Session leaves session.candidate null (no Candidate ever committed)', s.candidate === null);
}

// 6/9. ABORTED / stale ticket: Image A superseded by Image B before
// completeAnalysis() runs -- must never build or synchronize a Candidate
// for Image A, and must never touch Image B's active Candidate.
{
  __resetStoreForTests();
  const sessionA = freshSessionWithEvidence();
  const ticketA = { sessionId: sessionA.sessionId, generationId: sessionA.generationId };
  setActiveSession(sessionA);
  orch.commitCandidate(ticketA, buildRealisticRawPreset({ name: 'Image A Preset' }));

  const sessionB = freshSessionWithEvidence();
  setActiveSession(sessionB);
  const ticketB = { sessionId: sessionB.sessionId, generationId: sessionB.generationId };
  orch.commitCandidate(ticketB, buildRealisticRawPreset({ name: 'Image B Preset' }));
  const finalStatusB = orch.completeAnalysis(ticketB);
  let candidateResultB = null;
  if (finalStatusB === 'COMPLETED' || finalStatusB === 'PARTIAL') {
    candidateResultB = orch.buildAndCommitCandidate(ticketB, { engineVersion: 'test' });
  }

  const finalStatusA = orch.completeAnalysis(ticketA);
  let attemptedA = false;
  if (finalStatusA === 'COMPLETED' || finalStatusA === 'PARTIAL') {
    attemptedA = true;
    orch.buildAndCommitCandidate(ticketA, { engineVersion: 'test' });
  }

  check('9a. completeAnalysis() for a superseded ticket (Image A after Image B became active) returns null, not a terminal status', finalStatusA === null);
  check('9b. A stale Image A callback never reaches the Candidate-build call after Image B became active', attemptedA === false);
  check("9c. isActiveGeneration() confirms Image A is no longer the active generation", isActiveGeneration(ticketA.sessionId, ticketA.generationId) === false);
  check('9d. Image B\'s Candidate build/commit succeeds and is unaffected by Image A\'s stale callback', finalStatusB === SESSION_STATUS.COMPLETED && candidateResultB?.committed === true);
  check('9e. The active Candidate Store still reflects only Image B\'s Candidate (Image A never overwrote it)', candidateStore.getActiveCandidate()?.profile?.name === candidateResultB.candidate.profile.name && candidateStore.getActiveCandidate()?.sessionId === sessionB.sessionId);
}

// 10. Candidate Store receives exactly one canonical Candidate per
// successful analysis (sequential images, not concurrent).
{
  __resetStoreForTests();
  const results = [];
  for (const label of ['first', 'second']) {
    const s = freshSessionWithEvidence();
    const ticket = { sessionId: s.sessionId, generationId: s.generationId };
    setActiveSession(s);
    orch.commitCandidate(ticket, buildRealisticRawPreset({ name: `${label} image` }));
    const finalStatus = orch.completeAnalysis(ticket);
    const r = (finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL') ? orch.buildAndCommitCandidate(ticket, { engineVersion: 'test' }) : null;
    results.push({ s, r });
  }
  check('10. Each successful analysis commits exactly one canonical Candidate to the store, and the store always reflects only the most recent', results.every((r) => r.r?.committed === true) && candidateStore.getActiveCandidate()?.profile?.name === 'second image');
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
