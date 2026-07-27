#!/usr/bin/env node
/**
 * FIX4 regression guard: Preview is generated automatically from
 * safety/render eligibility. The former Build button is now a
 * navigation/view control and is NEVER gated by Candidate Review.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const app = await readFile(path.join(ROOT, 'ui/app.js'), 'utf8');
const results = [];
function record(test, ok, evidence = {}) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${JSON.stringify(evidence)}`);
}

record('Controlled V2 view button exists and starts disabled', /<button id="btnBuildControlledV2" type="button" disabled aria-disabled="true"/.test(html));
record('Dedicated live region remains present', /id="buildControlledV2LiveRegion" aria-live="polite"/.test(html));
record('Click listener remains wired', /btnBuildControlledV2'\)\?\.addEventListener\('click', handleBuildControlledV2Preview\)/.test(app));

const handlerMatch = app.match(/async function handleBuildControlledV2Preview\(\) \{[\s\S]*?\n\}/);
const handler = handlerMatch?.[0] ?? '';
record('View handler never calls runAnalysis()', !/runAnalysis\s*\(/.test(handler), { handlerFound: !!handlerMatch });
record('View handler requires current pixel evidence, not Candidate Review approval', /_getCandidateReviewAvailability\(\)\.available/.test(handler) && !/readyToBuildV2|candidateReviewComplete/.test(handler));
record('View handler reads the already-rendered controller state', /visualPreviewComparisonController \? visualPreviewComparisonController\.getState\(\)/.test(handler));
record('View handler only navigates/focuses the rendered comparison', /scrollIntoView/.test(handler) && /focus\(\{ preventScroll: true \}\)/.test(handler));

const syncMatch = app.match(/function _syncBuildControlledV2Button\(\) \{[\s\S]*?\n\}/);
const sync = syncMatch?.[0] ?? '';
record('Button readiness is derived from preview evidence', /_getCandidateReviewAvailability\(\)\.available/.test(sync));
record('Button does not read reviewGuidance.readyToBuildV2', !/readyToBuildV2/.test(sync));
record('Button label becomes View Controlled V2 Preview when ready', /review\.buildButton\.viewPreview/.test(sync));
record('Preview eligibility reads sandbox safety/render state', /lastPreviewSandbox\?\.canGeneratePreview/.test(sync));
record('Every Review Console render re-syncs the view button', /function renderReviewConsoleFromState\(\) \{[\s\S]{0,700}_syncBuildControlledV2Button\(\)/.test(app));

const pass = results.filter(r => r.result === 'PASS').length;
const fail = results.length - pass;
console.log(`\n${pass}/${results.length} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
