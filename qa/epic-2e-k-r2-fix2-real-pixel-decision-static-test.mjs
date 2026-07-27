#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-fix2-real-pixel-decision-static-test.mjs
 *
 * EPIC 2E-K-R2-FIX2 -- Section 9/13: hostile proof for the pure
 * classifier qa/helpers/real-pixel-comparison-decision.mjs.
 *
 * Directly tests the exact failure class Section 9 describes: an
 * OR-shortcut condition (`!v2ClaimsRendered || pixelsAreValid`) that
 * would trivially pass for 'unknown'/'partial'/'blocked'/'failed'/
 * 'cancelled' states. Every one of the required-FAIL states listed in
 * the spec is exercised here with a genuine, well-formed-looking
 * fixture object -- proving the classifier rejects each one on its own
 * terms, not merely because the fixture is otherwise garbage.
 *
 * No Browser, no Chromium -- pure function, safe for
 * run-static-suites.mjs.
 */
import { classifyRealPixelComparisonResult, isAcceptableRealPixelComparisonOutcome, RENDERED_TRUTH_CODES, RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES } from './helpers/real-pixel-comparison-decision.mjs';

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

const REAL_HASH_A = 'a'.repeat(64);
const REAL_HASH_B = 'b'.repeat(64);

function genuinelyRenderedFixture(overrides = {}) {
  return {
    v2State: 'rendered', previewTruthCode: 'BOTH_RENDERED_DIFFERENT',
    browserVerified: true, visualDecisionEligible: true,
    v2Width: 800, v2Height: 600, v2NonTransparentPixelCount: 480000,
    controlledV2PixelHash: REAL_HASH_B, sameSourceGeometry: true, sourceFingerprintMatch: true,
    ...overrides,
  };
}

// --- 1. The genuine, fully-honest PASS case must actually pass. ---
{
  const r = classifyRealPixelComparisonResult(genuinelyRenderedFixture());
  record('Genuinely rendered, fully-verified fixture -> RENDERED_PROOF_PASS', r.verdict === 'RENDERED_PROOF_PASS', r);
  record('isAcceptableRealPixelComparisonOutcome() is true for a genuine pass', isAcceptableRealPixelComparisonOutcome(genuinelyRenderedFixture()) === true, {});
}
// BOTH_RENDERED_IDENTITY (no pixel difference) is equally a genuine pass.
{
  const r = classifyRealPixelComparisonResult(genuinelyRenderedFixture({ previewTruthCode: 'BOTH_RENDERED_IDENTITY' }));
  record('Genuinely rendered with BOTH_RENDERED_IDENTITY -> RENDERED_PROOF_PASS', r.verdict === 'RENDERED_PROOF_PASS', r);
}

// --- 2. Every reported required-FAIL v2State must actually fail (never silently pass via an OR-shortcut). ---
const requiredFailStates = ['unknown', 'partial', 'unavailable', 'blocked', 'failed', 'cancelled', 'rendering', null, undefined];
for (const state of requiredFailStates) {
  // Give it an otherwise-plausible, well-formed fixture EXCEPT for
  // v2State and a previewTruthCode that is NOT a recognized honest
  // blocked code either -- proving the classifier does not merely
  // pass anything that isn't literally 'rendered'.
  const fixture = genuinelyRenderedFixture({ v2State: state, previewTruthCode: 'SOME_UNRECOGNIZED_CODE' });
  const r = classifyRealPixelComparisonResult(fixture);
  record(`v2State=${JSON.stringify(state)} with an unrecognized previewTruthCode -> never RENDERED_PROOF_PASS or silently accepted`, r.verdict === 'INDETERMINATE_FAIL', { verdict: r.verdict, reasons: r.reasons });
  record(`v2State=${JSON.stringify(state)} (unrecognized) -> isAcceptableRealPixelComparisonOutcome() is false`, isAcceptableRealPixelComparisonOutcome(fixture) === false, {});
}

// --- 3. A genuinely honest, recognized blocked outcome for a NON-rendered state is accepted (Section 10 outcome C) -- but never RENDERED_PROOF_PASS. ---
for (const truthCode of RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES) {
  const fixture = { v2State: 'unavailable', previewTruthCode: truthCode, browserVerified: false, visualDecisionEligible: false, v2Width: 300, v2Height: 150, v2NonTransparentPixelCount: 0, controlledV2PixelHash: null, sameSourceGeometry: false, sourceFingerprintMatch: true };
  const r = classifyRealPixelComparisonResult(fixture);
  record(`Recognized honest-blocked previewTruthCode=${truthCode} -> HONEST_BLOCKED (an acceptable, non-failing outcome), never RENDERED_PROOF_PASS`, r.verdict === 'HONEST_BLOCKED', r);
  record(`Recognized honest-blocked previewTruthCode=${truthCode} -> isAcceptableRealPixelComparisonOutcome() is true (acceptable per Section 10 outcome C)`, isAcceptableRealPixelComparisonOutcome(fixture) === true, {});
}

// --- 4. THE EXACT reported defect: v2State='rendered' but empty canvas (bugs #1/#5/#7's shape) -> FALSE_CLAIM_FAIL, never a silent pass. ---
{
  const fixture = { v2State: 'rendered', previewTruthCode: 'BOTH_RENDERED_DIFFERENT', browserVerified: true, visualDecisionEligible: true, v2Width: 300, v2Height: 150, v2NonTransparentPixelCount: 0, controlledV2PixelHash: null, sameSourceGeometry: true, sourceFingerprintMatch: true };
  const r = classifyRealPixelComparisonResult(fixture);
  record('EXACT reported defect (v2State=rendered, 300x150, 0 pixels, null hash) -> FALSE_CLAIM_FAIL', r.verdict === 'FALSE_CLAIM_FAIL', r);
  record('EXACT reported defect -> reasons cite the default-blank-canvas AND zero-pixel-count AND null-hash problems', r.reasons.some(x => x.includes('300x150')) && r.reasons.some(x => x.includes('NonTransparentPixelCount')) && r.reasons.some(x => x.includes('SHA-256')), { reasons: r.reasons });
}

// --- 5. Individual strict criteria: each one alone, when violated, must flip a genuine pass to FALSE_CLAIM_FAIL. ---
const strictBreakers = [
  ['browserVerified=false', { browserVerified: false }],
  ['visualDecisionEligible=false', { visualDecisionEligible: false }],
  ['v2Width=0', { v2Width: 0 }],
  ['v2Height=0', { v2Height: 0 }],
  ['v2NonTransparentPixelCount=0', { v2NonTransparentPixelCount: 0 }],
  ['controlledV2PixelHash=null', { controlledV2PixelHash: null }],
  ['controlledV2PixelHash is a fake short string (not real SHA-256)', { controlledV2PixelHash: 'not-a-real-hash' }],
  ['default blank 300x150 canvas', { v2Width: 300, v2Height: 150 }],
  ['sameSourceGeometry=false (geometry mismatch)', { sameSourceGeometry: false }],
  ['sourceFingerprintMatch=false (source mismatch)', { sourceFingerprintMatch: false }],
  ['previewTruthCode is neither BOTH_RENDERED_DIFFERENT nor BOTH_RENDERED_IDENTITY', { previewTruthCode: 'V2_RENDER_FAILED' }],
];
for (const [label, override] of strictBreakers) {
  const r = classifyRealPixelComparisonResult(genuinelyRenderedFixture(override));
  record(`Strict criterion violated (${label}) -> v2State still 'rendered' so this is FALSE_CLAIM_FAIL, never a silent pass`, r.verdict === 'FALSE_CLAIM_FAIL', r);
}

// --- 6. RENDERED_TRUTH_CODES and RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES are disjoint (no code can mean both things at once). ---
{
  const overlap = RENDERED_TRUTH_CODES.filter(c => RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES.includes(c));
  record('RENDERED_TRUTH_CODES and RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES share no code', overlap.length === 0, { overlap });
}

console.log(`\n${passCount} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
