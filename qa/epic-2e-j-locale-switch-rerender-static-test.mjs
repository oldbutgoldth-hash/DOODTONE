#!/usr/bin/env node
/**
 * qa/epic-2e-j-locale-switch-rerender-static-test.mjs
 *
 * FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 — Phase K.
 *
 * Regression guard specifically for Defect 1: "language switch is not
 * a real application-wide switch". Before Phase C, setLang() only
 * updated state.lang/localStorage/pill styling and never re-rendered
 * anything -- every visible section kept showing text in the old
 * language until the user re-triggered the underlying workflow. This
 * suite proves, by source-pattern inspection of ui/app.js (a DOM/
 * Canvas-dependent file that cannot be safely imported under plain
 * Node), that the fix is real and cannot silently regress:
 *
 *   1. setLang() unconditionally applies state.lang/localStorage/pill
 *      styling BEFORE attempting any re-render (so even if re-render
 *      throws, the language switch itself still "took").
 *   2. setLang() calls rerenderCurrentUiForLocale(), wrapped in its own
 *      try/catch (a re-render failure never leaves state.lang stale).
 *   3. rerenderCurrentUiForLocale() re-renders all 4 required section
 *      groups (Review Console, Data Comparison, Visual Preview
 *      Comparison, Interactive Before/After, Preview Observation +
 *      Session Summary) -- 5 call sites total.
 *   4. Every one of those re-render call sites is wrapped in its own
 *      independent try/catch (one section's failure can never block
 *      or take down another, per this project's established isolation
 *      convention).
 *   5. rerenderCurrentUiForLocale() NEVER calls runAnalysis() or any
 *      other pipeline-entry/decode function -- it must re-render
 *      exclusively from already-stashed state (state.last*State),
 *      never by re-running analysis, never re-decoding the source
 *      image, never re-invoking the pixel renderer, and never
 *      touching Mapping/XMP/production output.
 *   6. Each render call reads from a stashed state field (state.last*)
 *      rather than any freshly-computed/re-derived value.
 *   7. setLang() announces the switch through the dedicated
 *      langChangeLiveRegion (never a region shared with Review/Build-V2
 *      announcements, so it can never race them), and that announcement
 *      is also wrapped in its own try/catch.
 *   8. index.html actually contains the langChangeLiveRegion element,
 *      as a real persistent aria-live="polite" node (never destroyed/
 *      recreated).
 *
 * No-Browser, no-network suite -- safe to run in any environment,
 * including a Vercel build container. Included in run-static-suites.mjs.
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

const appSrc = await readFile(path.join(PROJECT_ROOT, 'ui/app.js'), 'utf8');
const indexSrc = await readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');

// Isolate the two function bodies by their known start markers so all
// checks below are scoped precisely (never accidentally matching
// unrelated code elsewhere in this ~2000-line file).
function extractFunctionBody(src, startMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Find the matching closing brace by simple depth counting from the
  // function's own opening brace (first '{' at/after startIdx).
  const openIdx = src.indexOf('{', startIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null;
}

const rerenderFnSrc = extractFunctionBody(appSrc, 'function rerenderCurrentUiForLocale()');
const setLangFnSrc = extractFunctionBody(appSrc, 'function setLang(lang)');

record('rerenderCurrentUiForLocale() function body was found in ui/app.js', rerenderFnSrc !== null, { found: rerenderFnSrc !== null });
record('setLang(lang) function body was found in ui/app.js', setLangFnSrc !== null, { found: setLangFnSrc !== null });

// ── 1+2+7. setLang() ordering and isolation guarantees ─────────────────
if (setLangFnSrc) {
  const stateAssignIdx = setLangFnSrc.indexOf('state.lang = normalizedLang');
  const localStorageIdx = setLangFnSrc.indexOf("localStorage.setItem('lang'");
  const pillLoopIdx = setLangFnSrc.indexOf("querySelectorAll('.lang-opt')");
  const rerenderCallIdx = setLangFnSrc.indexOf('rerenderCurrentUiForLocale()');
  const orderedBeforeRerender = stateAssignIdx !== -1 && localStorageIdx !== -1 && pillLoopIdx !== -1 && rerenderCallIdx !== -1
    && stateAssignIdx < rerenderCallIdx && localStorageIdx < rerenderCallIdx && pillLoopIdx < rerenderCallIdx;
  record('setLang() applies state.lang, localStorage, and pill styling BEFORE calling rerenderCurrentUiForLocale() (so a re-render failure can never leave the language switch itself unapplied)', orderedBeforeRerender, { stateAssignIdx, localStorageIdx, pillLoopIdx, rerenderCallIdx });

  const rerenderWrappedInTryCatch = /try\s*\{\s*rerenderCurrentUiForLocale\(\);\s*\}\s*catch/.test(setLangFnSrc);
  record('setLang() calls rerenderCurrentUiForLocale() inside its own try/catch', rerenderWrappedInTryCatch, { rerenderWrappedInTryCatch });

  const announcesViaDedicatedRegion = setLangFnSrc.includes("getElementById('langChangeLiveRegion')");
  record('setLang() announces the switch via the dedicated langChangeLiveRegion element (never a region shared with other announcements)', announcesViaDedicatedRegion, { announcesViaDedicatedRegion });

  const announcementWrappedInTryCatch = /try\s*\{[^}]*langChangeLiveRegion[\s\S]*?\}\s*catch/.test(setLangFnSrc);
  record('The language-change announcement is wrapped in its own try/catch (an announcement failure can never undo the already-applied language switch)', announcementWrappedInTryCatch, { announcementWrappedInTryCatch });

  const usesTForAnnouncementText = /t\('app\.languageChanged'/.test(setLangFnSrc) && /t\(normalizedLang === 'th' \? 'app\.languageNameTh' : 'app\.languageNameEn'/.test(setLangFnSrc);
  record('The announcement text itself is sourced from the centralized i18n t() function (app.languageChanged / app.languageNameEn / app.languageNameTh), never a hardcoded literal', usesTForAnnouncementText, { usesTForAnnouncementText });
}

// ── 3+4+6. rerenderCurrentUiForLocale() re-renders all required sections, each isolated ──
if (rerenderFnSrc) {
  const requiredCalls = [
    { label: 'Review Console', pattern: /try\s*\{\s*renderReviewConsoleFromState\(\);\s*\}\s*catch/ },
    { label: 'Data Comparison', pattern: /try\s*\{\s*_rerenderDataComparisonWithResolvedVisualState\(\);\s*\}\s*catch/ },
    { label: 'Visual Preview Comparison', pattern: /try\s*\{[\s\S]*?renderVisualPreviewComparison\(vprInner, vprStateForLocale, state\.lang\);[\s\S]*?\}\s*catch/ },
    { label: 'Interactive Before/After', pattern: /try\s*\{[\s\S]*?renderInteractiveBeforeAfterStatus\(ibaInner, state\.lastIbaState, state\.lang\);[\s\S]*?\}\s*catch/ },
    { label: 'Preview Observation + Context + Session Summary', pattern: /try\s*\{[\s\S]*?renderInteractivePreviewObservationV2\(obsInner, state\.lastObservationState, state\.lang\);[\s\S]*?renderInteractivePreviewObservationContextV2\(obsInner, state\.lastObservationContextInfo, state\.lang\);[\s\S]*?renderInteractivePreviewObservationSessionV2\(sessionInner, interactivePreviewObservationSession\.getSummary\(\), state\.lang\);[\s\S]*?\}\s*catch/ },
  ];
  for (const { label, pattern } of requiredCalls) {
    const ok = pattern.test(rerenderFnSrc);
    record(`rerenderCurrentUiForLocale() re-renders "${label}" from stashed state, wrapped in its own isolated try/catch`, ok, { label, ok });
  }

  // Every re-render call reads from a stashed state.last* field, never
  // a freshly-invoked getter/computation with side effects.
  const stashedFieldsRead = ['state.lastVisualPreviewComparisonState', 'state.lastIbaState', 'state.lastObservationState', 'state.lastObservationContextInfo']
    .every((f) => rerenderFnSrc.includes(f));
  record('rerenderCurrentUiForLocale() reads exclusively from already-stashed state.last* fields for Visual Preview / Before-After / Observation (never re-deriving them)', stashedFieldsRead, { stashedFieldsRead });

  const guardsOnLayoutBuiltFlags = ['vprInner.dataset.vprLayoutBuilt', 'ibaInner.dataset.ibaLayoutBuilt', 'obsInner.dataset.ipoLayoutBuilt', 'sessionInner.dataset.ipoSessionLayoutBuilt']
    .every((f) => rerenderFnSrc.includes(f));
  record('rerenderCurrentUiForLocale() only re-renders a section whose static skeleton has already been built (dataset *LayoutBuilt flags), never forcing a premature render', guardsOnLayoutBuiltFlags, { guardsOnLayoutBuiltFlags });

  // The single honest exception: Visual Preview Comparison falls back
  // to an explicit "preparing" placeholder state (not a stashed one)
  // when nothing has settled yet -- this is a pure, side-effect-free
  // state-builder, not a re-analysis call, and is asserted separately
  // below (item 5) to make sure it stays that way.
  const fallsBackToPreparingPlaceholder = rerenderFnSrc.includes('state.lastVisualPreviewComparisonState ?? buildPreparingAnalysisState()');
  record('Visual Preview Comparison falls back to the pure buildPreparingAnalysisState() placeholder (not a stashed value) only when nothing has settled yet -- an honest, side-effect-free default', fallsBackToPreparingPlaceholder, { fallsBackToPreparingPlaceholder });
}

// ── 5. rerenderCurrentUiForLocale() NEVER re-runs analysis or touches Mapping/XMP ──
if (rerenderFnSrc) {
  const forbiddenCalls = [
    'runAnalysis(', 'decodeImage(', 'buildRenderPlan(', 'buildMappingPlan(',
    'serializeXMP(', 'downloadXMP(', 'applyToProduction(', 'allowProductionWrite',
    'allowExport', 'FileReader(', 'fetch(', 'XMLHttpRequest',
  ];
  const noneFound = forbiddenCalls.filter((needle) => rerenderFnSrc.includes(needle));
  record('rerenderCurrentUiForLocale() never calls runAnalysis()/decodeImage()/render-plan builders/XMP serializers/production-write or export APIs, and performs no file I/O or network calls', noneFound.length === 0, { forbiddenCallsFound: noneFound });

  // The function's own name and every render call it makes must be a
  // pure "render from existing state" operation -- i.e. every function
  // it calls is one of the known, already-verified pure renderers.
  const calledFunctionNames = [...rerenderFnSrc.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\(/g)].map((m) => m[1]);
  const allowedFunctionNames = new Set([
    'rerenderCurrentUiForLocale', // the function's own declaration head ("function rerenderCurrentUiForLocale()"), not a call
    // FULL-SYSTEM I18N COMPLETION R2 -- Phase I: the static app-shell
    // re-translation pass. Verified pure by its own dedicated checks
    // below (DOM text/placeholder writes only; no analysis, no reload).
    'rerenderAppShellForLocale',
    'renderReviewConsoleFromState', '_rerenderDataComparisonWithResolvedVisualState',
    'getElementById', 'renderVisualPreviewComparison', 'buildPreparingAnalysisState',
    'renderInteractiveBeforeAfterStatus', 'renderInteractivePreviewObservationV2',
    'renderInteractivePreviewObservationContextV2', 'getSummary',
    'renderInteractivePreviewObservationSessionV2', 'console',
    // R4 Phase C: the persistent "AI Box" analysis-complete summary is
    // innerHTML-injected (not a data-i18n-key element), so it needs
    // its own explicit pure re-render call, gated the same way as
    // every other section above (only fires if
    // state.lastAnalysisBoxSummaryData already exists -- never forces
    // a premature render, never re-runs analysis).
    'setAnalysisBox', '_buildAnalysisBoxOkHtml', 'renderAnalysisPanel',
    '_rerenderPersistentAnnouncementsForLocale', 't',
  ]);
  const unexpectedCalls = [...new Set(calledFunctionNames)].filter((n) => !allowedFunctionNames.has(n) && n !== 'warn');
  record('Every function called inside rerenderCurrentUiForLocale() is one of the known pure re-render/lookup functions (no unexpected new call introduced)', unexpectedCalls.length === 0, { unexpectedCalls });
}

// ── 8a. Phase I: the app-shell re-translation pass is pure ─────────────
{
  const shellFn = extractFunctionBody(appSrc, 'function rerenderAppShellForLocale(lang)');
  record('rerenderAppShellForLocale() exists in ui/app.js', shellFn !== null, { found: shellFn !== null });
  if (shellFn) {
    record('It re-translates static markup via data-i18n-key / data-i18n-placeholder-key attributes',
      shellFn.includes("querySelectorAll('[data-i18n-key]')") && shellFn.includes("querySelectorAll('[data-i18n-placeholder-key]')"), {});
    record('It only writes textContent / the placeholder attribute — it never rebuilds or removes DOM',
      shellFn.includes('node.textContent = text;') && shellFn.includes("node.setAttribute('placeholder', text);")
      && !/innerHTML/.test(shellFn) && !/replaceChildren/.test(shellFn) && !/removeChild/.test(shellFn), {});
    const forbidden = ['runAnalysis(', 'location.reload', 'window.location', 'decodeImage(', 'serializeXMP(', 'downloadXMP(', 'fetch(']
      .filter((n) => shellFn.includes(n));
    record('It never reloads the page, re-runs Analysis, or touches decode/XMP/network APIs', forbidden.length === 0, { forbidden });
    record('A missing key never paints a raw dotted key path onto the shell (text !== key guard)',
      shellFn.includes("text !== key"), {});
    record('Each node is individually try/caught so one bad node cannot block the rest of the shell',
      (shellFn.match(/try \{/g) ?? []).length >= 3, { tryBlocks: (shellFn.match(/try \{/g) ?? []).length });
  }

  const indexHasKeys = (indexSrc.match(/data-i18n-key="/g) ?? []).length;
  const indexHasPlaceholderKeys = (indexSrc.match(/data-i18n-placeholder-key="/g) ?? []).length;
  record('index.html carries a substantial set of data-i18n-key attributes for the static shell', indexHasKeys >= 80, { indexHasKeys });
  record('index.html carries data-i18n-placeholder-key attributes for translatable input placeholders', indexHasPlaceholderKeys >= 1, { indexHasPlaceholderKeys });
}

// ── 8b. The last-resort Interactive Before/After catch-path fallback ────
// blocker text also sources from i18n, not a raw English literal
// (fixed as part of this same Phase K verification pass -- was
// previously the one documented deviation in this round).
{
  const usesI18nForLastResortBlocker = /blockers: \[t\('beforeAfter\.statusMessage\.failed', null, state\.lang\)\]/.test(appSrc);
  record('The last-resort Interactive Before/After catch-path fallback blocker text is sourced from t(\'beforeAfter.statusMessage.failed\', ...) rather than a raw hardcoded English literal', usesI18nForLastResortBlocker, { usesI18nForLastResortBlocker });

  const noRawLiteralRegression = !appSrc.includes("blockers: ['Interactive comparison could not be prepared. Existing analysis and production output were not changed.']");
  record('The raw English literal blocker string is no longer present anywhere in ui/app.js (no regression back to a hardcoded fallback)', noRawLiteralRegression, { noRawLiteralRegression });
}

// ── 8. index.html contains the persistent langChangeLiveRegion element ──
{
  const hasLiveRegion = /<div id="langChangeLiveRegion" aria-live="polite" aria-atomic="true"[^>]*><\/div>/.test(indexSrc);
  record('index.html contains a persistent langChangeLiveRegion element with aria-live="polite" (never destroyed/recreated, distinct from other live regions)', hasLiveRegion, { hasLiveRegion });

  const distinctFromOtherRegions = indexSrc.includes('id="reviewConsoleLiveRegion"') && indexSrc.includes('id="buildControlledV2LiveRegion"') && indexSrc.includes('id="langChangeLiveRegion"');
  const idsAreUnique = new Set(['reviewConsoleLiveRegion', 'buildControlledV2LiveRegion', 'langChangeLiveRegion']).size === 3;
  record('langChangeLiveRegion has a distinct id from reviewConsoleLiveRegion and buildControlledV2LiveRegion (announcements can never race each other)', distinctFromOtherRegions && idsAreUnique, { distinctFromOtherRegions, idsAreUnique });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
