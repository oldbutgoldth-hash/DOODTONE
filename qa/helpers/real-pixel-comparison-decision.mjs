/**
 * qa/helpers/real-pixel-comparison-decision.mjs
 *
 * EPIC 2E-K-R2-FIX2 -- Section 9: Real Pixel Comparison strict
 * classification -- a PURE, Node-testable function factored OUT of
 * qa/epic-2e-k-calibration-lab-browser-test.mjs specifically so its
 * decision logic can be hostile-tested without a real Chromium/
 * Playwright runtime (this project's established pattern -- see e.g.
 * "FIX 1: factor pure fail-closed decision function" earlier in this
 * project's history).
 *
 * Reported bug #10 / Section 9's exact complaint: the Browser Test used
 * condition patterns shaped like `!v2ClaimsRendered || pixelsAreValid`
 * -- an OR-shortcut that is trivially TRUE (a false PASS) whenever
 * `v2State` is 'unknown'/'partial'/'blocked'/'failed'/'cancelled'/
 * anything other than the literal string 'rendered'. This module
 * replaces that shape entirely with a POSITIVE, all-of proof for a
 * genuine "rendered" claim, and separately, honestly classifies a
 * real (non-rendered) blocked/failed state as either a recognized,
 * acceptable outcome or an indeterminate failure -- never a silent
 * pass either way.
 */

// The only two previewTruthCode values that mean "both sides genuinely
// rendered, with real backing pixels on both" -- see
// core/calibration-lab/preview-evidence.js's classifyPreviewTruth().
export const RENDERED_TRUTH_CODES = Object.freeze(['BOTH_RENDERED_DIFFERENT', 'BOTH_RENDERED_IDENTITY']);
const RENDERED_TRUTH_CODE_SET = new Set(RENDERED_TRUTH_CODES);

// previewTruthCode values that represent a genuine, honestly-reported
// NON-render outcome (V2 ineligible/blocked/failed for a real, mapped
// reason) -- Section 10's outcome (C): "blocked with a correct Safety
// Reason" is an ACCEPTABLE, non-failing result for an individual image,
// never silently treated as equivalent to a genuine rendered proof.
export const RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES = Object.freeze([
  'CALIBRATION_V2_PLAN_UNAVAILABLE', 'CALIBRATION_V2_PLAN_BLOCKED', 'CALIBRATION_V2_RENDER_FAILED',
  'V2_RENDER_FAILED', 'V2_EMPTY_CANVAS', 'PIXEL_HASH_UNAVAILABLE', 'NOT_RENDERED',
]);
const RECOGNIZED_HONEST_BLOCKED_TRUTH_CODE_SET = new Set(RECOGNIZED_HONEST_BLOCKED_TRUTH_CODES);

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const DEFAULT_BLANK_CANVAS_WIDTH = 300;
const DEFAULT_BLANK_CANVAS_HEIGHT = 150;

/**
 * @param {object} p - the live-DOM + authoritative-evidence snapshot
 *   captured by the Browser suite for one image:
 *   { v2State, previewTruthCode, browserVerified, visualDecisionEligible,
 *     v2Width, v2Height, v2NonTransparentPixelCount, controlledV2PixelHash,
 *     sameSourceGeometry, sourceFingerprintMatch }
 * @returns {{ verdict: 'RENDERED_PROOF_PASS'|'HONEST_BLOCKED'|'FALSE_CLAIM_FAIL'|'INDETERMINATE_FAIL', reasons: string[] }}
 */
export function classifyRealPixelComparisonResult(p) {
  const input = p || {};
  const isDefaultBlankCanvas = input.v2Width === DEFAULT_BLANK_CANVAS_WIDTH && input.v2Height === DEFAULT_BLANK_CANVAS_HEIGHT;
  const hasRealHash = typeof input.controlledV2PixelHash === 'string' && SHA256_HEX_PATTERN.test(input.controlledV2PixelHash);
  const hasRealPixelCount = Number.isFinite(Number(input.v2NonTransparentPixelCount)) && Number(input.v2NonTransparentPixelCount) > 0;
  const hasPositiveGeometry = Number(input.v2Width) > 0 && Number(input.v2Height) > 0;
  const geometryMatches = input.sameSourceGeometry !== false; // undefined (older evidence shape) is not itself a failure signal here; explicit `false` is.
  const sourceMatches = input.sourceFingerprintMatch !== false;

  // POSITIVE, all-of proof -- every one of these must independently be
  // true. No `!x || y` shortcut anywhere in this expression.
  const strictPass = (
    input.v2State === 'rendered' &&
    RENDERED_TRUTH_CODE_SET.has(input.previewTruthCode) &&
    hasPositiveGeometry &&
    !isDefaultBlankCanvas &&
    hasRealPixelCount &&
    hasRealHash &&
    input.browserVerified === true &&
    input.visualDecisionEligible === true &&
    geometryMatches &&
    sourceMatches
  );
  if (strictPass) return { verdict: 'RENDERED_PROOF_PASS', reasons: [] };

  // v2State claims 'rendered' but at least one strict criterion above
  // failed -- this is the EXACT false-positive bug class Section 9
  // exists to catch (a canvas claiming success without genuine,
  // independently-verified pixels/hash/geometry). Always a hard FAIL,
  // never downgraded.
  if (input.v2State === 'rendered') {
    const reasons = [];
    if (!RENDERED_TRUTH_CODE_SET.has(input.previewTruthCode)) reasons.push(`previewTruthCode (${input.previewTruthCode}) is not a rendered-truth code`);
    if (!hasPositiveGeometry) reasons.push(`v2Width/v2Height not both positive (${input.v2Width}x${input.v2Height})`);
    if (isDefaultBlankCanvas) reasons.push('v2 canvas is the untouched default 300x150 blank size');
    if (!hasRealPixelCount) reasons.push(`v2NonTransparentPixelCount is not > 0 (${input.v2NonTransparentPixelCount})`);
    if (!hasRealHash) reasons.push(`controlledV2PixelHash is not a real 64-hex-char SHA-256 (${input.controlledV2PixelHash})`);
    if (input.browserVerified !== true) reasons.push(`browserVerified is not true (${input.browserVerified})`);
    if (input.visualDecisionEligible !== true) reasons.push(`visualDecisionEligible is not true (${input.visualDecisionEligible})`);
    if (!geometryMatches) reasons.push('sameSourceGeometry is explicitly false');
    if (!sourceMatches) reasons.push('sourceFingerprintMatch is explicitly false');
    return { verdict: 'FALSE_CLAIM_FAIL', reasons };
  }

  // v2State is anything other than 'rendered' -- unknown/partial/
  // unavailable/blocked/failed/cancelled/stuck-rendering(null)/etc.
  // Only an ACCEPTABLE, non-failing outcome if the authoritative
  // evidence's own previewTruthCode independently agrees this is a
  // recognized, honestly-reported non-render classification -- never
  // accepted merely because v2State happened not to equal 'rendered'.
  if (RECOGNIZED_HONEST_BLOCKED_TRUTH_CODE_SET.has(input.previewTruthCode)) {
    return { verdict: 'HONEST_BLOCKED', reasons: [`v2State=${input.v2State}, previewTruthCode=${input.previewTruthCode} is a recognized honest non-render outcome`] };
  }

  return {
    verdict: 'INDETERMINATE_FAIL',
    reasons: [`v2State=${input.v2State}, previewTruthCode=${input.previewTruthCode} is neither a strict RENDERED_PROOF_PASS nor a recognized HONEST_BLOCKED code -- this must never be silently accepted`],
  };
}

/**
 * Convenience boolean the Browser suite's recordCondition() can use
 * directly -- PASS iff the classification is RENDERED_PROOF_PASS or
 * HONEST_BLOCKED; FAIL for FALSE_CLAIM_FAIL or INDETERMINATE_FAIL.
 */
export function isAcceptableRealPixelComparisonOutcome(p) {
  const { verdict } = classifyRealPixelComparisonResult(p);
  return verdict === 'RENDERED_PROOF_PASS' || verdict === 'HONEST_BLOCKED';
}
