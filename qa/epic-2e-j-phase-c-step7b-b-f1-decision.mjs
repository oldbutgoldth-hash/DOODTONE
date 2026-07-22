/**
 * qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs
 *
 * EPIC 2E-J — Step 7B-B-F1-R (Clean F1-Only Fail-Closed and
 * Console/Resource Patch), hardened by Step 7B-B-F1-R2 (Malformed
 * Decision Input and URL Protocol Final Lock).
 *
 * A small, pure, browser-free decision function factored out of
 * qa/epic-2e-j-phase-c-step7b-b-test.mjs so it can be unit-tested
 * without Chromium (see qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs).
 * Takes no DOM/page/network dependency of any kind — plain data in,
 * plain string out.
 *
 * Required behavior:
 *   - results is not an Array, or is empty         => 'FAIL'
 *   - any result row is null / not a plain object   => 'FAIL'
 *   - a row's `test` is missing or not a non-empty
 *     string, or `result` is missing or not exactly
 *     'PASS' | 'FAIL' | 'NOT_TESTED'                => 'FAIL'
 *   - any row with result 'FAIL'                    => 'FAIL'
 *   - any NOT_TESTED outside the permitted set       => 'FAIL'
 *   - zero FAIL and zero NOT_TESTED                  => 'PASS'
 *   - only permitted manual gaps remain              => 'CONDITIONAL_PASS'
 *
 * Malformed rows are never silently ignored/skipped — a single
 * malformed row anywhere in the array forces the whole decision to
 * FAIL, exactly like a genuine FAIL result would.
 *
 * For the Step 7B-B browser suite, the only currently permitted manual
 * NOT_TESTED result is the exact test name 'Physical touch hardware'.
 * Contrast NOT_TESTED, Clear Session NOT_TESTED, a missing-element
 * NOT_TESTED, and Console/Resource NOT_TESTED are all NOT permitted and
 * force FAIL — matched by EXACT test-name equality (never a substring/
 * regex match), so a differently-worded check can never accidentally
 * ride through as a permitted gap.
 *
 * isAllowedExternalFontUrl(url) — the only two external hosts this
 * suite tolerates in its console/resource audit, reachable only over
 * http:/https:. Kept here alongside the decision function because it is
 * equally pure/static and needs the same no-Chromium unit-test coverage.
 */

export const PERMITTED_NOT_TESTED_STEP_7BB = Object.freeze(['Physical touch hardware']);

const VALID_RESULT_VALUES = new Set(['PASS', 'FAIL', 'NOT_TESTED']);

// F1-R2 FIX 2 — validates an optional permittedNotTested override
// safely: never throws (even on a hostile/getter-throwing value), and
// never lets a malformed value broaden the permitted set beyond the
// frozen production default. Only a genuine array of plain strings is
// ever accepted as an override.
function _safePermittedList(permittedNotTested) {
  try {
    if (Array.isArray(permittedNotTested) && permittedNotTested.every((v) => typeof v === 'string')) {
      return permittedNotTested;
    }
  } catch {
    /* hostile array (e.g. a throwing element getter) — fall through to the safe default */
  }
  return PERMITTED_NOT_TESTED_STEP_7BB;
}

/**
 * @param {Array<{test: string, result: 'PASS'|'FAIL'|'NOT_TESTED', evidence?: string}>} results
 * @param {string[]} [permittedNotTested] exact test names allowed to be NOT_TESTED — malformed values are ignored in favor of the safe default (see FIX 2)
 * @returns {'PASS'|'CONDITIONAL_PASS'|'FAIL'}
 */
export function computeStep7BBDecision(results, permittedNotTested = PERMITTED_NOT_TESTED_STEP_7BB) {
  // F1-R2 FIX 1 — fail-closed on the container itself: not an Array, or
  // an empty Array, is never treated as vacuously "PASS".
  if (!Array.isArray(results) || results.length === 0) return 'FAIL';

  const permittedSet = new Set(_safePermittedList(permittedNotTested));

  let failCount = 0;
  let notTestedCount = 0;
  let unexpectedNotTestedCount = 0;

  for (const row of results) {
    // F1-R2 FIX 1 — a malformed row is never silently ignored/skipped;
    // it forces FAIL immediately, same as a genuine FAIL would.
    if (row === null || typeof row !== 'object') return 'FAIL';
    if (typeof row.test !== 'string' || row.test.trim().length === 0) return 'FAIL';
    if (typeof row.result !== 'string' || !VALID_RESULT_VALUES.has(row.result)) return 'FAIL';

    if (row.result === 'FAIL') {
      failCount++;
    } else if (row.result === 'NOT_TESTED') {
      notTestedCount++;
      if (!permittedSet.has(row.test)) unexpectedNotTestedCount++;
    }
  }

  // Any FAIL forces FAIL, unconditionally.
  if (failCount > 0) return 'FAIL';
  // Any NOT_TESTED whose exact test name is not in the permitted list
  // also forces FAIL — an unexpected gap is never treated as an
  // acceptable manual exception.
  if (unexpectedNotTestedCount > 0) return 'FAIL';

  if (notTestedCount === 0) return 'PASS';
  return 'CONDITIONAL_PASS';
}

/**
 * Google Fonts allowlist. Returns true ONLY when the URL's protocol is
 * exactly http: or https: AND its hostname is exactly
 * fonts.googleapis.com or fonts.gstatic.com. Every other protocol
 * (ftp:, javascript:, data:, etc. — several of which are "special"
 * schemes in the WHATWG URL parser and would otherwise still yield a
 * matching `hostname`) and every lookalike/subdomain host
 * ("fonts.googleapis.com.evil.com", "evil.com/fonts.googleapis.com"
 * embedded in a path, etc.) is deliberately NOT allowed. Parses the URL
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
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'fonts.googleapis.com' || parsed.hostname === 'fonts.gstatic.com';
}
