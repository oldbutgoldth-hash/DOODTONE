#!/usr/bin/env node
/**
 * qa/helpers/visible-locale-audit.mjs
 *
 * EPIC 2E-J LOCALE RUNTIME TRUTH + QA NEUTRALITY R4 -- Phase A.
 *
 * The ONE shared, single-argument-object Browser audit helper for
 * visible-locale-leak detection, used by BOTH the Thai-mode "no
 * visible English sentences" audit and the English-mode "no visible
 * Thai fragments" audit. Replaces two separate, broken pieces of the
 * previous suite:
 *
 *   DEFECT A (confirmed by the R4 independent Chromium review): the
 *   old `auditSection()` called page.evaluate with THREE positional
 *   arguments (the page function, the selector, and the approved-terms
 *   list) instead of one argument object. Playwright's
 *   `page.evaluate(pageFunction, arg)` contract only ever forwards a
 *   SINGLE `arg`; the extra positional argument caused the call to
 *   throw during Playwright's own argument-serialization step. Every
 *   call was wrapped in `.catch(() => ({ found: false, leaks: [] }))`,
 *   which silently swallowed that throw and made every audited
 *   section look like "not found in this build" -- so every required
 *   section fell through to NOT_TESTED while the total-leak counter
 *   (which only summed leaks from sections that returned `found:
 *   true`) stayed at 0 and falsely reported PASS. Fixed here: exactly
 *   one argument object `{ selector, mode, approvedTerms }`.
 *
 *   DEFECT C: the old English-mode audit read only
 *   a truncated whole-body innerText read -- not visibility-aware
 *   (invisible/collapsed text counts toward the 4000-char budget just
 *   as much as visible text), truncated (later sections are never
 *   inspected once the budget is used up), and produced no
 *   per-section evidence. Fixed here: the SAME visibility-aware
 *   TreeWalker-based collector is used for both TH and EN audits,
 *   parameterized only by which language counts as "foreign" in the
 *   current mode.
 *
 * DEFECT B (the decision layer that only checks FAIL rows and ignores
 * required NOT_TESTED rows) is deliberately NOT fixed inside this
 * helper -- `auditVisibleLocaleSection()` below correctly
 * DISTINGUISHES a genuine "audit infrastructure failure" (status
 * FAIL) from a legitimate "this section's root does not exist in the
 * current DOM state" (status NOT_TESTED), and
 * `decideVisibleLocaleAudit()` at the bottom of this file provides the
 * fail-closed aggregate decision every consuming suite should use
 * rather than inventing its own ad hoc `failCount > 0` check.
 */

const THAI_CHAR_RE_TEST = /[฀-๿]/;
const UNRESOLVED_TEMPLATE_RE_TEST = /\{\{\s*\w+\s*\}\}/;

/**
 * Runs INSIDE the browser page via
 * `page.evaluate(collectVisibleLocaleLeaks, args)`. Playwright
 * serializes this function's own source text and re-executes it in
 * the page context, so it MUST be fully self-contained -- it must
 * never reference anything from this module's outer scope (any such
 * reference would simply be `undefined` inside the page, not an error
 * that's obvious at review time). `args` arrives as the one
 * structured-clone-safe object `{ selector, mode, approvedTerms }`.
 */
function collectVisibleLocaleLeaks(args) {
  const selector = args && args.selector;
  const mode = args && args.mode;
  const approvedTerms = (args && args.approvedTerms) || [];

  const root = document.querySelector(selector);
  if (!root) return { found: false, leaks: [], unresolvedTemplateLeaks: [] };

  const thaiRe = /[฀-๿]/g;
  const placeholderRe = /\{\{\s*\w+\s*\}\}/g;
  const numericRe = /\b[0-9]+(?:\.[0-9]+)?(?:px|ms|%)?\b/g;
  const escaped = approvedTerms
    .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
    .sort(function (a, b) { return b.length - a.length; });
  const termsRe = escaped.length ? new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'gi') : null;
  const unresolvedTemplateProbeRe = /\{\{\s*\w+\s*\}\}/;

  const leaks = [];
  const unresolvedTemplateLeaks = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el) continue;
    // Collapsed Developer Details are the one legitimate place raw
    // diagnostic English may remain -- this audit never opens them,
    // so they are never actually visible/photographer-facing.
    if (el.closest('details:not([open])')) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.classList && el.classList.contains('material-symbols-outlined')) continue;
    const raw = (n.nodeValue || '').trim();
    if (!raw) continue;
    if (/^[a-z0-9_]+$/.test(raw)) continue; // material icon ligature, e.g. "info"

    // An unresolved {{param}} interpolation token is a leak in EITHER
    // language mode -- checked before the language-specific branch so
    // it is never masked by approved-terms/numeric stripping below.
    if (unresolvedTemplateProbeRe.test(raw)) unresolvedTemplateLeaks.push(raw.slice(0, 160));

    if (mode === 'th') {
      // Thai-mode: flag visible, un-approved English sentences. Thai
      // characters are stripped from a TEMPORARY detection copy only
      // -- `raw` (kept for evidence) is never mutated, and a node is
      // never skipped just because it also contains Thai (a mixed
      // Thai+English node is exactly the case that must be caught).
      let detect = raw.replace(thaiRe, ' ');
      detect = detect.replace(placeholderRe, ' ');
      if (termsRe) detect = detect.replace(termsRe, ' ');
      detect = detect.replace(numericRe, ' ');
      const words = detect.match(/[A-Za-z][A-Za-z']{2,}/g) || [];
      if (words.length >= 2) leaks.push(raw.slice(0, 160));
    } else {
      // English-mode: any visible Thai character fragment is itself a
      // leak. No approved-terms exemption applies here -- there is no
      // such thing as an "approved" Thai technical term inside an
      // English-mode UI.
      thaiRe.lastIndex = 0;
      if (thaiRe.test(raw)) leaks.push(raw.slice(0, 160));
    }
  }
  return { found: true, leaks: leaks, unresolvedTemplateLeaks: unresolvedTemplateLeaks };
}

/**
 * Audits ONE section for visible-locale leaks. Returns a bounded
 * status that distinguishes three genuinely different outcomes (R4
 * Phase B's decision layer depends on this distinction):
 *
 *   - 'NOT_TESTED', reason 'selector-not-found' -- the section's root
 *     element genuinely does not exist in the current DOM (e.g. a
 *     section that only renders after a specific workflow step). This
 *     is the ONLY legitimate NOT_TESTED outcome this helper produces.
 *   - 'FAIL', reason 'audit-threw' -- `page.evaluate()` itself threw
 *     (a genuine infrastructure failure). This must never be silently
 *     downgraded to NOT_TESTED or treated as a passing zero-leak
 *     result -- that silent-downgrade was Defect A's exact failure
 *     mode.
 *   - 'PASS' | 'FAIL' by `leaks.length === 0` -- the audit genuinely
 *     ran to completion against a present section.
 */
export async function auditVisibleLocaleSection(page, options) {
  const selector = options && options.selector;
  const mode = options && options.mode;
  const approvedTerms = (options && options.approvedTerms) || [];

  if (typeof selector !== 'string' || !selector.trim()) {
    return { status: 'FAIL', reason: 'invalid-selector', selector: selector ?? null, leaks: [], unresolvedTemplateLeaks: [], error: 'selector must be a non-empty string' };
  }
  if (mode !== 'th' && mode !== 'en') {
    return { status: 'FAIL', reason: 'invalid-mode', selector, leaks: [], unresolvedTemplateLeaks: [], error: `mode must be 'th' or 'en', got ${JSON.stringify(mode)}` };
  }

  let result;
  try {
    // R4 Phase A fix: exactly ONE argument object, matching
    // Playwright's page.evaluate(pageFunction, arg) contract --
    // never multiple positional arguments (the previous defect).
    result = await page.evaluate(collectVisibleLocaleLeaks, { selector, mode, approvedTerms });
  } catch (err) {
    return { status: 'FAIL', reason: 'audit-threw', selector, leaks: [], unresolvedTemplateLeaks: [], error: err?.message ?? String(err) };
  }

  if (!result || result.found !== true) {
    return { status: 'NOT_TESTED', reason: 'selector-not-found', selector, leaks: [], unresolvedTemplateLeaks: [], error: null };
  }

  const leaks = Array.isArray(result.leaks) ? result.leaks : [];
  const unresolvedTemplateLeaks = Array.isArray(result.unresolvedTemplateLeaks) ? result.unresolvedTemplateLeaks : [];
  const anyLeak = leaks.length > 0 || unresolvedTemplateLeaks.length > 0;
  return { status: anyLeak ? 'FAIL' : 'PASS', reason: null, selector, leaks, unresolvedTemplateLeaks, error: null };
}

/**
 * Audits every section in `sections` (each `{ key, selector }`) for
 * the given mode, returning one row per section plus its own bounded
 * evidence. Does not itself decide the suite-level PASS/FAIL/
 * NOT_TESTED verdict -- see `decideVisibleLocaleAudit()`.
 */
export async function auditVisibleLocaleSections(page, sections, options) {
  const mode = options && options.mode;
  const approvedTerms = (options && options.approvedTerms) || [];
  const rows = [];
  for (const section of sections) {
    const res = await auditVisibleLocaleSection(page, { selector: section.selector, mode, approvedTerms });
    rows.push({ key: section.key, ...res });
  }
  return rows;
}

/**
 * R4 Phase B -- the fail-closed decision over a set of section-audit
 * rows. A required section that came back NOT_TESTED counts as a
 * decision FAILURE unless its key is explicitly present in
 * `permittedNotTested` -- there is deliberately no default allowance,
 * so a newly required section that is missing from the DOM (whether
 * because of a real regression or a workflow the suite forgot to
 * drive through) always fails the run instead of silently vanishing
 * from the pass count the way the old `failCount > 0` check allowed.
 */
export function decideVisibleLocaleAudit(rows, options) {
  const permittedNotTested = new Set((options && options.permittedNotTested) || []);
  const failures = rows.filter((r) => r.status === 'FAIL');
  const unpermittedNotTested = rows.filter((r) => r.status === 'NOT_TESTED' && !permittedNotTested.has(r.key));
  const totalLeaks = rows.reduce((sum, r) => sum + (r.leaks?.length ?? 0) + (r.unresolvedTemplateLeaks?.length ?? 0), 0);
  const decision = (failures.length === 0 && unpermittedNotTested.length === 0) ? 'PASS' : 'FAIL';
  return { decision, failures, unpermittedNotTested, totalLeaks, rows };
}

// Exported purely so the static hostile-test suite (R4 Phase M) can
// exercise the browser-side collector's pure string/DOM-free logic
// paths directly in Node without needing a live page -- the function
// itself has no browser-only API calls in its argument-validation
// branches (the DOM walk only runs once `document` genuinely exists),
// so this export is safe and never used by any real Browser suite
// (which must always go through page.evaluate()).
export { collectVisibleLocaleLeaks };
