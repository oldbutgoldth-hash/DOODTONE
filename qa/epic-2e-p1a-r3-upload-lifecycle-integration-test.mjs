#!/usr/bin/env node
/**
 * EPIC 2E-P1A R3 — Upload Lifecycle Integration Test.
 *
 * Regression coverage for a real, verified defect: ui/app.js's
 * loadFile() called singleImageOrchestrator.beginUpload(file) BEFORE
 * handleReset(). handleReset() unconditionally calls
 * singleImageOrchestrator.resetActiveSession(state), which aborts,
 * clears, and empties the active-Session store slot — destroying the
 * Session beginUpload() had just created one line earlier and nulling
 * activeUploadTicket. Every subsequent img.onload -> runAnalysis()
 * call then found no ticket and returned immediately, permanently
 * stranding the UI on "loading". See P1A_UPLOAD_LIFECYCLE_FIX.md for
 * the full root-cause writeup and P1A_MODIFIED_FILES.md for the exact
 * ui/app.js diff.
 *
 * This test does two things the pre-R3 suite did not:
 *
 *  1. It reproduces the BROKEN and FIXED orderings using the REAL
 *     single-image-orchestrator.js functions (beginUpload,
 *     resetActiveSession, markImageDecoded, startAnalysisTicket,
 *     commitEvidence, completeAnalysis) — not a mock of the bug — so
 *     it fails against the broken ordering and passes against the
 *     fixed one for the actual reason the real bug existed.
 *  2. It statically confirms the SHIPPED ui/app.js source actually
 *     uses the fixed ordering (handleReset() textually before
 *     beginUpload() inside loadFile()), tying the abstract proof to
 *     the concrete file being delivered.
 *
 * Run: node qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs
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

const orch = await import('../core/single-image/single-image-orchestrator.js');
const { getActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { SESSION_STATUS } = await import('../core/single-image/single-image-session.js');

function fakeFile(name, size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified };
}

// A minimal, real handleReset() equivalent for this test's purposes:
// exactly the two Session-lifecycle lines that matter for this
// regression (the DOM-clearing / state.last*=null lines in the real
// handleReset() are irrelevant to whether the Session survives, and
// are already covered by other tests / P1A_LEGACY_COMPATIBILITY_MAP.md).
function simulateHandleReset(legacyState) {
  orch.resetActiveSession(legacyState);
}

/**
 * Mirrors the CURRENT (fixed, R3) ui/app.js loadFile() ordering:
 * reset/abort whatever was active, THEN create the new Session, THEN
 * capture its ticket into a per-call-local constant.
 */
async function simulateLoadFile_FIXED(file, legacyState) {
  simulateHandleReset(legacyState);
  const uploadTicket = await orch.beginUpload(file);
  legacyState.currentRetainedFile = file;
  return uploadTicket; // caller's own "closure" — never re-read from a shared mutable var
}

/**
 * Mirrors the R2 (BROKEN) ui/app.js loadFile() ordering: create the
 * new Session FIRST, then reset — which is what actually shipped in
 * R2 and produced the permanent "loading" hang. This function exists
 * only to prove the regression is caught, not as ongoing behavior.
 */
async function simulateLoadFile_BROKEN(file, legacyState) {
  const uploadTicket = await orch.beginUpload(file);
  simulateHandleReset(legacyState); // this is the bug: destroys the Session just created above
  legacyState.currentRetainedFile = file;
  return uploadTicket;
}

/** Mirrors runAnalysis()'s real ticket-gated entry sequence, using a
 * small set of real orchestrator calls (required modules only) so the
 * Session reaches a genuine terminal status without needing to invoke
 * actual Core engines (already covered elsewhere — this test is about
 * lifecycle ordering, not Core math). */
function simulateMinimalAnalysisRun(ticket) {
  const analysisTicket = ticket
    ? orch.startAnalysisTicket(ticket.sessionId, ticket.generationId)
    : null;
  if (!analysisTicket) return { started: false, finalStatus: null };
  orch.commitEvidence(analysisTicket, 'histogram', { status: 'COMPLETED', result: {} });
  orch.commitEvidence(analysisTicket, 'basicPanel', { status: 'COMPLETED', result: {} });
  const finalStatus = orch.completeAnalysis(analysisTicket);
  return { started: true, finalStatus };
}

// ─── 1. BROKEN ordering reproduces the real defect ──────────────────
// Proves the test can actually fail against the old bug: using the
// real orchestrator functions in R2's shipped (buggy) order, the
// Session created by beginUpload() must be gone/unusable by the time
// img.onload would fire, so no analysis can ever start.
{
  __resetStoreForTests();
  const legacy = {};
  const ticket = await simulateLoadFile_BROKEN(fakeFile('a.jpg'), legacy);
  const sessionAfterBrokenReset = getActiveSession();
  const decodedApplied = orch.markImageDecoded(ticket, { width: 100, height: 80 });
  const analysisResult = simulateMinimalAnalysisRun(ticket);
  check('1. BROKEN ordering (R2 regression) reproduces the stuck-loading defect',
    sessionAfterBrokenReset === null && decodedApplied === false && analysisResult.started === false,
    `sessionAfterBrokenReset=${sessionAfterBrokenReset}, decodedApplied=${decodedApplied}, analysisStarted=${analysisResult.started} — this is EXPECTED to demonstrate the bug this suite catches`);
}

// ─── 2. FIXED ordering: new Session survives reset preparation ──────
{
  __resetStoreForTests();
  const legacy = {};
  const ticket = await simulateLoadFile_FIXED(fakeFile('a.jpg'), legacy);
  const activeAfter = getActiveSession();
  check('2. FIXED ordering: new active Session still exists after reset preparation',
    activeAfter !== null && activeAfter.sessionId === ticket.sessionId);
}

// ─── 3. activeUploadTicket-equivalent is not null before decode completes ──
{
  __resetStoreForTests();
  const legacy = {};
  const ticket = await simulateLoadFile_FIXED(fakeFile('a.jpg'), legacy);
  check('3. Upload ticket is not null before decode completion', ticket !== null && !!ticket.sessionId && !!ticket.generationId);
}

// ─── 4-6. Simulate img.onload: startAnalysisTicket called exactly once, Session reaches ANALYZING then terminal ──
{
  __resetStoreForTests();
  const legacy = {};
  const ticket = await simulateLoadFile_FIXED(fakeFile('a.jpg'), legacy);

  // "img.onload" step
  const decodedApplied = orch.markImageDecoded(ticket, { width: 100, height: 80, decodedSource: {}, displaySource: {}, analysisProxy: null });
  const sessionAfterDecode = getActiveSession();
  const statusAfterDecode = sessionAfterDecode?.status;

  // startAnalysisTicket must succeed exactly once for this ticket —
  // call it twice in a row, mirroring the duplicate-Analyze guard,
  // and confirm the SECOND call is rejected (already covered by test 6
  // in the main suite, re-verified here in the real upload-lifecycle
  // sequence specifically).
  const at1 = orch.startAnalysisTicket(ticket.sessionId, ticket.generationId);
  const sessionAfterFirstStart = getActiveSession();
  const at2 = orch.startAnalysisTicket(ticket.sessionId, ticket.generationId);

  check('4. img.onload uses the correct ticket and decode is recorded', decodedApplied === true && statusAfterDecode === SESSION_STATUS.IMAGE_READY);
  check('5. startAnalysisTicket() is called exactly once (second call rejected)', at1 !== null && at2 === null);
  check('6. Session progresses beyond IMAGE_READY to ANALYZING', sessionAfterFirstStart.status === SESSION_STATUS.ANALYZING);

  // Complete the run and confirm a terminal status + that the
  // "loading" condition (status still IMAGE_DECODING/ANALYSIS_QUEUED,
  // which is what drives the real ui/app.js's setAnalysisBox('loading',
  // ...) call) has been left behind. Live DOM confirmation that the
  // loading spinner itself disappears is Browser QA's job (see
  // P1A_QA_REPORT.md §3) — this proves the underlying Session-state
  // signal the DOM reads reaches a non-loading state, which is the
  // only thing this Node-level test can observe directly.
  orch.commitEvidence(at1, 'histogram', { status: 'COMPLETED', result: {} });
  orch.commitEvidence(at1, 'basicPanel', { status: 'COMPLETED', result: {} });
  const finalStatus = orch.completeAnalysis(at1);
  const loadingClear = ![SESSION_STATUS.CREATED, SESSION_STATUS.IMAGE_DECODING, SESSION_STATUS.ANALYSIS_QUEUED, SESSION_STATUS.ANALYZING].includes(finalStatus);
  check('7. Loading state is cleared (Session leaves the loading-driving statuses)', loadingClear, `finalStatus=${finalStatus}`);
  check('8. Analysis terminates as COMPLETED, PARTIAL, FAILED or ABORTED',
    [SESSION_STATUS.COMPLETED, SESSION_STATUS.PARTIAL, SESSION_STATUS.FAILED, SESSION_STATUS.ABORTED].includes(finalStatus), `finalStatus=${finalStatus}`);
}

// ─── 9. Image A upload -> Image B upload before A completes -> A aborted, B active, B analysis starts, A cannot overwrite B ──
{
  __resetStoreForTests();
  const legacy = {};

  // Image A: upload, decode, start analysis (still "in flight" — not completed)
  const ticketA = await simulateLoadFile_FIXED(fakeFile('image-a.jpg'), legacy);
  orch.markImageDecoded(ticketA, { width: 100, height: 80 });
  const analysisTicketA = orch.startAnalysisTicket(ticketA.sessionId, ticketA.generationId);
  const sessionIdA = getActiveSession().sessionId;

  // Image B uploaded while A is still ANALYZING (real user action:
  // selecting a new file mid-analysis) — this calls loadFile() again,
  // which per the FIXED ordering resets/aborts A first.
  const ticketB = await simulateLoadFile_FIXED(fakeFile('image-b.jpg'), legacy);
  const activeAfterB = getActiveSession();

  // A's stale "onload" callback fires late (mirrors a slow decode that
  // resolves after B has already started) — it must use its OWN
  // captured ticketA (per the R3 fix), and every orchestrator call it
  // makes must no-op.
  const aLateDecodeApplied = orch.markImageDecoded(ticketA, { width: 4000, height: 3000 }); // would corrupt B's image metadata if it applied
  const aLateCommitResult = orch.commitEvidence(analysisTicketA, 'histogram', { status: 'COMPLETED', result: { corrupt: true } }, legacy);
  const aLateAnalysisStart = orch.startAnalysisTicket(ticketA.sessionId, ticketA.generationId);

  // B's own analysis must be able to start and complete normally.
  const bRun = simulateMinimalAnalysisRun(ticketB);

  check('9a. Uploading Image B while Image A is analyzing aborts Image A',
    activeAfterB.sessionId !== sessionIdA && activeAfterB.sessionId === ticketB.sessionId);
  check('9b. Image A\'s stale onload cannot overwrite Image B\'s Session',
    aLateDecodeApplied === false && activeAfterB.image.width !== 4000);
  check('9c. Image A\'s stale evidence commit is rejected (STALE_GENERATION)',
    aLateCommitResult.committed === false && aLateCommitResult.reason === 'STALE_GENERATION');
  check('9d. Image A\'s stale callback cannot start analysis for Image B',
    aLateAnalysisStart === null);
  check('9e. Image B\'s own Session remains active and its analysis starts/completes',
    bRun.started === true && [SESSION_STATUS.COMPLETED, SESSION_STATUS.PARTIAL].includes(bRun.finalStatus));
}

// ─── 10. Shipped ui/app.js source uses the FIXED ordering ───────────
// Strips // line comments and /* */ block comments before searching —
// a naive substring search on the raw source is unsound here: R2's
// actual bug had a `// ... handleReset() ...` comment mentioning the
// function BEFORE the real (buggy, later) beginUpload() call, which
// would make a comment-blind check pass even against the broken code.
// Confirmed against a real R2 copy of ui/app.js during development of
// this test (see P1A_QA_REPORT.md §1b) — this exact regex was the fix.
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '');      // line comments
}
{
  const appSrc = readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');
  const fnMatch = appSrc.match(/async function loadFile\(file\)\s*\{[\s\S]*?\n\}/);
  const rawBody = fnMatch ? fnMatch[0] : '';
  const body = stripJsComments(rawBody);
  const resetIdx = body.indexOf('handleReset()');
  const beginUploadIdx = body.indexOf('singleImageOrchestrator.beginUpload(');
  const orderingCorrect = body.length > 0 && resetIdx !== -1 && beginUploadIdx !== -1 && resetIdx < beginUploadIdx;
  check('10. Shipped ui/app.js loadFile() calls handleReset() before beginUpload() (comment-stripped source)',
    orderingCorrect, `resetIdx=${resetIdx}, beginUploadIdx=${beginUploadIdx}`);
}

// ─── 11. img.onload references a per-call local ticket, not the shared mutable activeUploadTicket, when calling markImageDecoded/runAnalysis ──
{
  const appSrc = readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');
  const fnMatch = appSrc.match(/async function loadFile\(file\)\s*\{[\s\S]*?\n\}/);
  const body = fnMatch ? fnMatch[0] : '';
  const declaresLocalTicket = /const uploadTicket = await singleImageOrchestrator\.beginUpload\(file\)/.test(body);
  const onloadUsesLocalTicket = /img\.onload = \(\) => \{[\s\S]*?markImageDecoded\(uploadTicket,/.test(body)
    && /img\.onload = \(\) => \{[\s\S]*?runAnalysis\(uploadTicket\)/.test(body);
  const onerrorUsesLocalTicket = /img\.onerror = \(\) => \{[\s\S]*?markImageDecodeFailed\(uploadTicket,/.test(body);
  check('11. img.onload/onerror use the per-call captured uploadTicket (not shared activeUploadTicket)',
    declaresLocalTicket && onloadUsesLocalTicket && onerrorUsesLocalTicket);
}

// ─── 12. runAnalysis() accepts an explicit ticket override, defaulting to activeUploadTicket for Re-analyze ──
{
  const appSrc = readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');
  const hasOverrideParam = /async function runAnalysis\(callerTicket = null\)/.test(appSrc);
  const fallsBackCorrectly = /const ticket = callerTicket \|\| activeUploadTicket;/.test(appSrc);
  // handleReanalyze()'s existing no-arg call site must still work
  // unmodified (it wants "whatever Session is current right now").
  const reanalyzeStillNoArg = /if \(state\.imageLoaded && img\?\.complete && img\.naturalWidth\) runAnalysis\(\);/.test(appSrc);
  check('12. runAnalysis() supports a caller-supplied ticket while Re-analyze keeps using the current active ticket',
    hasOverrideParam && fallsBackCorrectly && reanalyzeStillNoArg);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
