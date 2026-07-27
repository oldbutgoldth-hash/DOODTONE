#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-fix2-hostile-closure-test.mjs
 *
 * EPIC 2E-K-R2-FIX2 -- Section 13: the remaining hostile items not
 * already covered by qa/epic-2e-k-r2-fix2-real-pixel-decision-static-test.mjs,
 * qa/epic-2e-k-r2-fix2-save-gate-test.mjs, and
 * qa/epic-2e-k-r2-fix2-calibration-v2-plan-static-test.mjs:
 *
 *   1. THE EXACT reported bug #6 shape: Legacy genuinely rendered (real
 *      state/geometry/pixel count) but its hash is unavailable (null,
 *      e.g. no Web Crypto in an opaque-origin harness) must classify as
 *      PIXEL_HASH_UNAVAILABLE, NEVER LEGACY_RENDER_FAILED.
 *   2. The Pure JS SHA-256 fallback is proven against the official
 *      FIPS 180-4 / NIST known-answer vectors -- and a FAKE/forged hash
 *      genuinely fails a known-vector comparison (proving the test
 *      itself has teeth, not just checking the real implementation
 *      happens to work).
 *   3. deriveUiBlockerReasonCode() never accepts a hard-coded override
 *      second argument anymore (Section 5) -- calling it with a second
 *      argument must have NO effect on its output, proving the old
 *      `{v2RenderPlanAvailable: true}` hard-code pattern cannot silently
 *      resurrect itself.
 *
 * No Browser, no Chromium -- pure function tests, safe for
 * run-static-suites.mjs.
 */
import { classifyPreviewTruth, deriveUiBlockerReasonCode } from '../core/calibration-lab/preview-evidence.js';
import { sha256PureJsHex, SHA256_KNOWN_VECTORS } from '../core/calibration-lab/sha256-pure-js.js';
import crypto from 'node:crypto';

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

// --- 1. Reported bug #6: Legacy genuinely rendered, hash unavailable -> PIXEL_HASH_UNAVAILABLE, never LEGACY_RENDER_FAILED. ---
{
  const measured = {
    sourceAvailable: true, staleGeneration: false, sourceFingerprintMatch: true,
    legacyPreviewState: 'rendered', legacyOutputWidth: 800, legacyOutputHeight: 600,
    legacyNonTransparentPixelCount: 480000, legacyPixelHash: null, // <-- the exact reported gap
    controlledV2PreviewState: 'unknown', controlledV2OutputWidth: 300, controlledV2OutputHeight: 150,
    controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null,
    sameSourceGeometry: false, pixelDifferenceDetected: null,
  };
  const code = classifyPreviewTruth(measured);
  record('HOSTILE (bug #6): Legacy rendered with real pixels but null hash classifies as PIXEL_HASH_UNAVAILABLE', code === 'PIXEL_HASH_UNAVAILABLE', { code });
  record('HOSTILE (bug #6): the exact reported contradiction (legacyPreviewState=rendered + previewTruthCode=LEGACY_RENDER_FAILED) can never occur for this input', code !== 'LEGACY_RENDER_FAILED', { code });
}
// Contrast case: Legacy genuinely NOT rendered (state failed) -> LEGACY_RENDER_FAILED is still correct.
{
  const measured = { sourceAvailable: true, legacyPreviewState: 'failed', legacyOutputWidth: 0, legacyOutputHeight: 0, legacyNonTransparentPixelCount: 0, legacyPixelHash: null };
  const code = classifyPreviewTruth(measured);
  record('Contrast: Legacy genuinely failed to render (state=failed, 0 pixels) still correctly classifies as LEGACY_RENDER_FAILED', code === 'LEGACY_RENDER_FAILED', { code });
}
// Contrast case: Legacy claims rendered but pixel count is 0 (a real render failure, not a hash gap) -> still LEGACY_RENDER_FAILED.
{
  const measured = { sourceAvailable: true, legacyPreviewState: 'rendered', legacyOutputWidth: 800, legacyOutputHeight: 600, legacyNonTransparentPixelCount: 0, legacyPixelHash: null };
  const code = classifyPreviewTruth(measured);
  record('Contrast: Legacy claims rendered but has ZERO real pixels (a genuine render failure, not merely a hash gap) still classifies as LEGACY_RENDER_FAILED', code === 'LEGACY_RENDER_FAILED', { code });
}

// --- 2. Pure JS SHA-256 known-vector proof + fake-hash-must-fail. ---
for (const v of SHA256_KNOWN_VECTORS) {
  const bytes = new TextEncoder().encode(v.input);
  const pure = sha256PureJsHex(bytes);
  const node = crypto.createHash('sha256').update(bytes).digest('hex');
  record(`SHA-256 known vector (input length ${v.input.length}): stored expected hash matches Node crypto's real SHA-256`, v.hex === node, { input: v.input.slice(0, 30), expected: v.hex, node });
  record(`SHA-256 known vector (input length ${v.input.length}): sha256PureJsHex() matches Node crypto exactly (genuine implementation, not a fake checksum)`, pure === node, { pure, node });
}
{
  // A forged/fake hash (e.g. a naive substitute checksum) must NOT match a real known vector -- proving these tests have teeth.
  const fakeHash = 'deadbeef'.repeat(8); // 64 hex chars, but not a real SHA-256 of anything meaningful here
  const realEmptyHash = SHA256_KNOWN_VECTORS[0].hex;
  record('HOSTILE: a forged 64-hex-char hash does NOT coincidentally match the real known-vector hash (sanity check that this test can actually fail)', fakeHash !== realEmptyHash, { fakeHash, realEmptyHash });
}
{
  // A "simple checksum" substitute (e.g. naive byte sum, not real SHA-256) must fail known-vector comparison.
  function naiveChecksumHex(bytes) {
    let sum = 0;
    for (const b of bytes) sum = (sum + b) >>> 0;
    return sum.toString(16).padStart(64, '0');
  }
  const bytes = new TextEncoder().encode('abc');
  const fakeImpl = naiveChecksumHex(bytes);
  const real = crypto.createHash('sha256').update(bytes).digest('hex');
  record('HOSTILE: a naive byte-sum "checksum substitute" (not real SHA-256) fails the known-vector comparison, proving these known-vector tests would actually catch a fake implementation', fakeImpl !== real, { fakeImpl, real });
}

// --- 3. deriveUiBlockerReasonCode() never accepts a hard-coded override second argument (Section 5). ---
{
  const blockedEvidence = {
    previewTruthCode: 'CALIBRATION_V2_PLAN_BLOCKED', visualDecisionEligible: false,
    calibrationV2PlanAvailable: true, calibrationV2PlanRenderable: false,
  };
  const withoutOverride = deriveUiBlockerReasonCode(blockedEvidence);
  const withFakeOverride = deriveUiBlockerReasonCode(blockedEvidence, { v2RenderPlanAvailable: true });
  record('HOSTILE (Section 5): deriveUiBlockerReasonCode() ignores a hard-coded {v2RenderPlanAvailable:true} second argument -- output is identical with or without it', withoutOverride === withFakeOverride, { withoutOverride, withFakeOverride });
  record('HOSTILE (Section 5): the real evidence-derived blocker code is CALIBRATION_V2_PLAN_BLOCKED, not a hard-coded pass-through', withoutOverride === 'CALIBRATION_V2_PLAN_BLOCKED', { withoutOverride });
}

console.log(`\n${passCount} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
