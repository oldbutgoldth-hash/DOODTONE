#!/usr/bin/env node
/**
 * EPIC 2E-J R5 — semantic presentation and fail-closed locale QA guard.
 * No Browser, network, or Production engine mutation.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');
const [comparison, controller, observationRenderer, liveApp, step7bb, i18nBrowser, localeAudit] = await Promise.all([
  read('ui/side-by-side-comparison-renderer.js'),
  read('ui/interactive-preview-observation-controller-v2.js'),
  read('ui/interactive-preview-observation-renderer-v2.js'),
  read('qa/epic-2e-j-phase-c-live-app-test.mjs'),
  read('qa/epic-2e-j-phase-c-step7b-b-test.mjs'),
  read('qa/epic-2e-j-full-system-i18n-browser-test.mjs'),
  read('qa/helpers/visible-locale-audit.mjs'),
]);

const results = [];
function record(test, pass, evidence = '') {
  const result = pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence: String(evidence) });
  console.log(`${pass ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

// Hostile source-pattern detector: raw Core prose may never be used as
// the main text projection. These samples protect the detector itself.
function detectRawCorePresentation(src) {
  const patterns = [
    /textContent\s*=\s*dimension\.description/,
    /text\s*:\s*photographerSummary\b/,
    /appendChild\([^\n]*\brawCoreReason\b/,
    /recommendations\.map\([^)]*render\s*\)/,
    /rollback(?:Plan)?\.steps\.map\([^)]*textContent/,
    /out\.push\(matched\s*\|\|\s*text\)/,
    /function _translateSingleViaClassifier[\s\S]{0,700}\breturn text;/,
  ];
  return patterns.filter((re) => re.test(src)).map(String);
}
const hostileSamples = [
  'node.textContent = dimension.description;',
  'const row = { text: photographerSummary };',
  'list.appendChild(el("li", { text: rawCoreReason }));',
  'out.push(matched || text);',
  'function _translateSingleViaClassifier(){ return text; }',
];
record('Hostile detector rejects every raw-Core main-UI presentation class', hostileSamples.every((sample) => detectRawCorePresentation(sample).length > 0), JSON.stringify(hostileSamples.map((s) => detectRawCorePresentation(s).length)));
record('Current Data Comparison renderer has zero raw-Core main-UI presentation patterns', detectRawCorePresentation(comparison).length === 0, JSON.stringify(detectRawCorePresentation(comparison)));
record('Unknown comparison lists use a bounded localized presenter fallback', comparison.includes("out.push(matched || presenter('UNKNOWN', null, lang));"), 'presenter UNKNOWN fallback');
record('Unknown comparison summaries use a bounded localized presenter fallback', comparison.includes("return presenter('UNKNOWN', lang, '');"), 'summary UNKNOWN fallback');
record('Rollback and fallback prose are projected through stable presentation codes', comparison.includes('comparison.rollbackStepCode.') && comparison.includes('comparison.fallbackReasonCode.generic') && !/stepsList\.appendChild\([^\n]*_safeText\(step/.test(comparison), 'stable rollback/fallback keys');

record('Observation controller stores semantic stale/provider warning codes', controller.includes("const STALE_WARNING_MESSAGE = 'stale-generation';") && controller.includes("const PROVIDER_UNCONFIRMED_WARNING = 'provider-unconfirmed';"), 'semantic warning codes');
record('Observation renderer localizes semantic warning codes before DOM presentation', observationRenderer.includes("w === 'stale-generation'") && observationRenderer.includes("w === 'provider-unconfirmed'") && observationRenderer.includes('primaryWarning = staleCandidate ? cancelledMessage : null'), 'code-to-current-locale projection');

record('Live App honesty assertion uses semantic data attributes, not English mode prose', liveApp.includes('el.dataset.v2TranslationMode') && liveApp.includes('el.dataset.previewHonesty') && liveApp.includes("semanticHonesty?.productionSource === 'legacy'") && liveApp.includes("semanticHonesty?.productionWrite === 'disabled'"), 'semantic preview evidence');
record('Step 7B-B Session correctness uses QA snapshot rather than localized counter parsing', step7bb.includes('async function sessionSummarySnapshot(page)') && !step7bb.includes('function parseSessionSummary(') && !step7bb.includes('function parseSessionSecondary('), 'locale-neutral sessionSummary');
record('Step 7B-B canonical Reason assertions use stable reason codes', step7bb.includes("row.reason === 'skin-tone'") && step7bb.includes("row.reason === 'contrast'") && !step7bb.includes("includes('Skin tone')"), 'canonical reason codes');

const requiredKeys = ['appHeader','primaryNavigation','rightSidebar','appFooter','languageControl','uploadArea','analysisSummary','analysisTabsAndControls','supportPanel','promptPayModal','usdtModal','reviewConsole','dataComparison','visualPreview','beforeAfter','observation','sessionSummary','bodyAggregate'];
record('Full-system i18n has precise per-region sections plus bodyAggregate', requiredKeys.every((key) => i18nBrowser.includes(`key: '${key}'`)) && !i18nBrowser.includes("{ key: 'appShell', selector: 'body' }"), `${requiredKeys.length} section keys`);
record('Hidden language/payment modals are explicitly opened for locale audit', i18nBrowser.includes("for (const id of ['langModal', 'ppModal', 'usdtModal'])") && i18nBrowser.includes('await setAuditModalsOpen(page, true);'), 'explicit modal workflow');
record('Visible locale audit fails closed on zero visible nodes', localeAudit.includes("reason: 'zero-visible-nodes'") && localeAudit.includes('visibleNodeCount <= 0') && localeAudit.includes('el.getClientRects().length === 0'), 'visibility and coverage proof');

const summary = {
  total: results.length,
  pass: results.filter((r) => r.result === 'PASS').length,
  fail: results.filter((r) => r.result === 'FAIL').length,
};
const out = { suite: 'EPIC 2E-J R5 Semantic Presentation Static', completed: true, generatedAt: new Date().toISOString(), summary, results, decision: summary.fail === 0 ? 'PASS' : 'FAIL' };
await writeFile(path.join(ROOT, 'qa', 'epic-2e-j-r5-semantic-presentation-static-results.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n${summary.pass}/${summary.total} PASS, ${summary.fail} FAIL`);
process.exit(summary.fail === 0 ? 0 : 1);
