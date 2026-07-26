#!/usr/bin/env node
/**
 * qa/epic-2e-j-build-controlled-v2-button-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase H.
 *
 * Static, source-pattern-based proof (no Browser available in this
 * sandbox, same as every prior round) that the "Build Controlled V2
 * Preview" button is wired correctly:
 *   - starts disabled in the markup (never enabled by default)
 *   - reuses the EXISTING runAnalysis() pipeline — no new analysis
 *     engine is introduced
 *   - its enabled/disabled state and label are kept in sync with
 *     reviewGuidance.readyToBuildV2 on every Review Console re-render
 *   - stays disabled for the duration of the run (no overlapping
 *     invocations)
 *   - announces an honest, distinct outcome for each of the three
 *     possible translationMode values via a dedicated aria-live region
 *   - scrolls/focuses the Visual Preview Comparison section only after
 *     confirming the session is still the same one that started the run
 * A real Browser suite (Phase K) is required to prove this actually
 * behaves correctly at runtime; this file only proves the source is
 * wired as intended.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const htmlSrc = await readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
const appSrc = await readFile(path.join(PROJECT_ROOT, 'ui/app.js'), 'utf8');

// ── Markup ───────────────────────────────────────────────────────────────
{
  const hasButton = /<button id="btnBuildControlledV2" type="button" disabled aria-disabled="true"/.test(htmlSrc);
  record('btnBuildControlledV2 exists in markup and starts disabled/aria-disabled', hasButton, { hasButton });

  const hasLiveRegion = /<div id="buildControlledV2LiveRegion" aria-live="polite" aria-atomic="true"/.test(htmlSrc);
  record('A dedicated aria-live=polite region exists for the Build-V2 outcome announcement, separate from reviewConsoleLiveRegion', hasLiveRegion, { hasLiveRegion });

  const liveRegionIsDistinct = htmlSrc.includes('id="buildControlledV2LiveRegion"') && htmlSrc.includes('id="reviewConsoleLiveRegion"') && !htmlSrc.match(/id="reviewConsoleLiveRegion"[^>]*buildControlledV2LiveRegion/);
  record('The two aria-live regions are genuinely distinct elements (not aliases of the same id)', liveRegionIsDistinct, { liveRegionIsDistinct });
}

// ── Wiring in app.js ─────────────────────────────────────────────────────
{
  const listenerWired = /document\.getElementById\('btnBuildControlledV2'\)\?\.addEventListener\('click', handleBuildControlledV2Preview\);/.test(appSrc);
  record('The button\'s click listener is wired to handleBuildControlledV2Preview', listenerWired, { listenerWired });

  const callsExistingRunAnalysis = /async function handleBuildControlledV2Preview\(\) \{[\s\S]{0,2000}?await runAnalysis\(\);/.test(appSrc);
  record('handleBuildControlledV2Preview awaits the EXISTING runAnalysis() — no new analysis engine is introduced', callsExistingRunAnalysis, { callsExistingRunAnalysis });

  const noNewAnalysisFunctionIntroduced = !/function runControlledV2Analysis|function analyzeControlledV2|function runV2Analysis/.test(appSrc);
  record('No parallel/duplicate analysis-running function was introduced for this button', noNewAnalysisFunctionIntroduced, { noNewAnalysisFunctionIntroduced });
}

// ── Gating on reviewGuidance.readyToBuildV2 ─────────────────────────────────
{
  const syncReadsReadyToBuildV2 = /function _syncBuildControlledV2Button\(\) \{[\s\S]{0,2000}?guidance\?\.readyToBuildV2 === true;[\s\S]{0,200}?btn\.disabled = !ready;/.test(appSrc);
  record('_syncBuildControlledV2Button derives btn.disabled purely from reviewGuidance.readyToBuildV2 (never invents its own readiness rule)', syncReadsReadyToBuildV2, { syncReadsReadyToBuildV2 });

  const calledOnEveryReviewRender = /function renderReviewConsoleFromState\(\) \{[\s\S]{0,500}?_syncBuildControlledV2Button\(\);/.test(appSrc);
  record('_syncBuildControlledV2Button is called on every renderReviewConsoleFromState() (never only once at load)', calledOnEveryReviewRender, { calledOnEveryReviewRender });

  const defenseInDepthGuard = /if \(guidance\?\.readyToBuildV2 !== true\) return;/.test(appSrc);
  record('handleBuildControlledV2Preview defensively re-checks readyToBuildV2 even though the button should already be disabled', defenseInDepthGuard, { defenseInDepthGuard });
}

// ── Disabled during processing (no overlapping runs) ────────────────────
{
  const hasInProgressFlag = /let buildControlledV2InProgress = false;/.test(appSrc);
  record('A module-level buildControlledV2InProgress flag exists', hasInProgressFlag, { hasInProgressFlag });

  const setsFlagBeforeAwait = /buildControlledV2InProgress = true;\s*_syncBuildControlledV2Button\(\);[\s\S]{0,400}?try \{\s*await runAnalysis\(\);/.test(appSrc);
  record('The in-progress flag is set (and the button synced to disabled) BEFORE the await, not after', setsFlagBeforeAwait, { setsFlagBeforeAwait });

  const clearsFlagInFinally = /\} finally \{\s*buildControlledV2InProgress = false;\s*_syncBuildControlledV2Button\(\);\s*\}/.test(appSrc);
  record('The in-progress flag is cleared in a finally block (so it can never get stuck true if runAnalysis() throws)', clearsFlagInFinally, { clearsFlagInFinally });

  const earlyReturnGuard = /if \(!btn \|\| btn\.disabled \|\| buildControlledV2InProgress\) return;/.test(appSrc);
  record('handleBuildControlledV2Preview refuses to start a second run while one is already in progress', earlyReturnGuard, { earlyReturnGuard });
}

// ── Outcome announcement covers all three translationMode branches, honestly ──
{
  // I18N RUNTIME CLOSURE R3 — Phase H: the outcome announcement now
  // resolves through the centralized dictionary
  // (review.outcome.safetyRestraint/identityFallback/unavailable) via
  // t('review.outcome.<key>', null, state.lang) instead of an inline
  // isThai ternary — the same three distinct, honest outcomes are
  // still covered, just sourced from one place instead of duplicated
  // English/Thai literals in app.js itself.
  const coversSafetyRestraint = /translationMode === 'legacy-derived-safety-restraint'/.test(appSrc)
    && /t\('review\.outcome\.safetyRestraint', null, state\.lang\)/.test(appSrc);
  const coversIdentityFallback = /translationMode === 'identity-fallback'/.test(appSrc)
    && /t\('review\.outcome\.identityFallback', null, state\.lang\)/.test(appSrc);
  const hasHonestElseBranch = /t\('review\.outcome\.unavailable', null, state\.lang\)/.test(appSrc);
  record('The outcome announcement distinguishes Safety-restraint, Identity-fallback, and an honest else/unavailable case', coversSafetyRestraint && coversIdentityFallback && hasHonestElseBranch, { coversSafetyRestraint, coversIdentityFallback, hasHonestElseBranch });

  const readsFromControllerState = /visualPreviewComparisonController\.getState\(\)/.test(appSrc) && /vprState\?\.metadata\?\.controlledV2Translation\?\.mode/.test(appSrc);
  record('translationMode is read from the already-rendered Visual Preview Comparison controller\'s own state — never guessed or re-derived', readsFromControllerState, { readsFromControllerState });

  // No inline isThai ternary may reappear in this outcome block — the
  // Static visible-text audit (Phase J) separately guards against a
  // FUTURE inline bilingual branch anywhere in the file; this check is
  // the narrow, file-specific regression guard for the exact defect
  // fixed in this round.
  const noInlineIsThaiInOutcomeBlock = !/isThai\s*\?\s*'/.test(appSrc);
  const usesCentralizedDictionaryForOutcome = /t\('review\.outcome\./.test(appSrc);
  record('The outcome text is sourced from the centralized i18n dictionary (review.outcome.*) rather than an inline isThai ternary', noInlineIsThaiInOutcomeBlock && usesCentralizedDictionaryForOutcome, { noInlineIsThaiInOutcomeBlock, usesCentralizedDictionaryForOutcome });
}

// ── Staleness guard before scroll/focus ─────────────────────────────────
{
  const capturesBeforeState = /const reviewSecVisibleBefore = document\.getElementById\('reviewConsoleSection'\)\?\.style\.display !== 'none';/.test(appSrc);
  record('A "before" snapshot of the Review Console section\'s visibility is captured prior to the await', capturesBeforeState, { capturesBeforeState });

  const checksStillSameSession = /const stillSameSession = state\.imageLoaded && reviewSecVisibleBefore && document\.getElementById\('reviewConsoleSection'\)\?\.style\.display !== 'none';/.test(appSrc);
  record('A "stillSameSession" check runs after the await, before any scroll/focus/announcement', checksStillSameSession, { checksStillSameSession });

  const scrollGatedByStaleness = /if \(!stillSameSession\) return;[\s\S]{0,2000}?vprSec\.scrollIntoView/.test(appSrc);
  record('scrollIntoView is only reachable after the staleness check passes', scrollGatedByStaleness, { scrollGatedByStaleness });

  const focusManagedSafely = /vprSec\.setAttribute\('tabindex', '-1'\)/.test(appSrc) && /vprSec\.focus\(\{ preventScroll: true \}\)/.test(appSrc);
  record('Focus is moved to the Visual Preview Comparison section using a safe, standard tabindex="-1" + preventScroll pattern', focusManagedSafely, { focusManagedSafely });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
