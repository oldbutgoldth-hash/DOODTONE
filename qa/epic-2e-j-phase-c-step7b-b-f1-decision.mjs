/**
 * qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs
 *
 * EPIC 2E-J — Step 7B-B-F1-R (Clean F1-Only Fail-Closed and
 * Console/Resource Patch).
 *
 * FIX 1: a small, pure, browser-free decision function factored out of
 * qa/epic-2e-j-phase-c-step7b-b-test.mjs so it can be unit-tested
 * without Chromium (see qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs).
 * Takes no DOM/page/network dependency of any kind — plain data in,
 * plain string out.
 *
 * Required behavior:
 *   - any FAIL                                  => 'FAIL'
 *   - any NOT_TESTED outside the permitted set   => 'FAIL'
 *   - zero FAIL and zero NOT_TESTED              => 'PASS'
 *   - only permitted manual gaps remain          => 'CONDITIONAL_PASS'
 *
 * For the Step 7B-B browser suite, the only currently permitted manual
 * NOT_TESTED result is the exact test name 'Physical touch hardware'.
 * Contrast NOT_TESTED, Clear Session NOT_TESTED, a missing-element
 * NOT_TESTED, and Console/Resource NOT_TESTED are all NOT permitted and
 * force FAIL — matched by EXACT test-name equality (never a substring/
 * regex match), so a differently-worded check can never accidentally
 * ride through as a permitted gap.
 *
 * FIX 2: isAllowedExternalFontUrl(url) — the only two external hosts
 * this suite tolerates in its console/resource audit. Kept here
 * alongside the decision function because it is equally pure/static and
 * needs the same no-Chromium unit-test coverage.
 */

export const PERMITTED_NOT_TESTED_STEP_7BB = Object.freeze(['Physical touch hardware']);

/**
 * @param {Array<{test: string, result: 'PASS'|'FAIL'|'NOT_TESTED', evidence?: string}>} results
 * @param {string[]} [permittedNotTested] exact test names allowed to be NOT_TESTED
 * @returns {'PASS'|'CONDITIONAL_PASS'|'FAIL'}
 */
export function computeStep7BBDecision(results, permittedNotTested = PERMITTED_NOT_TESTED_STEP_7BB) {
  const list = Array.isArray(results) ? results : [];

  // Any FAIL forces FAIL, unconditionally — checked first so nothing
  // downstream can ever soften it.
  const failCount = list.filter((r) => r && r.result === 'FAIL').length;
  if (failCount > 0) return 'FAIL';

  // Any NOT_TESTED whose exact test name is not in the permitted list
  // also forces FAIL — this is the fail-closed guarantee: an unexpected
  // gap is never treated as an acceptable manual exception.
  const notTested = list.filter((r) => r && r.result === 'NOT_TESTED');
  const permittedSet = new Set(permittedNotTested);
  const unexpectedNotTested = notTested.filter((r) => !permittedSet.has(r.test));
  if (unexpectedNotTested.length > 0) return 'FAIL';

  if (notTested.length === 0) return 'PASS';
  return 'CONDITIONAL_PASS';
}

/**
 * FIX 2 — Google Fonts allowlist. Returns true ONLY for the two exact
 * hosts named in the spec (fonts.googleapis.com, fonts.gstatic.com).
 * Every other host — including lookalike/subdomain tricks such as
 * "fonts.googleapis.com.evil.com" or "evil.com/fonts.googleapis.com"
 * embedded in a path — is deliberately NOT allowed. Parses the URL
 * properly (never a substring/`.includes()` check) so a hostname can't
 * be spoofed by embedding the allowed string elsewhere in the URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedExternalFontUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.hostname === 'fonts.googleapis.com' || parsed.hostname === 'fonts.gstatic.com';
}
