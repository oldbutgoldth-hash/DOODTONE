#!/usr/bin/env node
/**
 * qa/epic-2e-j-qa-snapshot-controlled-v2-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase J.
 *
 * Proves ui/app.js's getPreviewPipelineSnapshot() (the ?qa=1-gated
 * window.__LUMIXA_QA__ hook used by every Browser suite in this
 * project) exposes the new `controlledV2Translation` and
 * `reviewGuidance` fields, each:
 *   - read directly from an already-computed object (never a new
 *     engine call, never re-derived/re-filtered locally)
 *   - passed through the project's existing _qaSafe* bounding helpers
 *     (never raw/untrusted values)
 *   - bounded (changedFields capped at 10 small records; no raw
 *     adjustmentModel, no image bytes/filenames/paths)
 * Source-pattern static test, consistent with this project's
 * established style for files with no DOM available under plain Node.
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

// ── controlledV2Translation ─────────────────────────────────────────────
{
  const readsFromRenderPlan = /const t = fsi\?\.visualPreviewRenderPlanV2\?\.controlledV2Translation \?\? null;/.test(appSrc);
  record('controlledV2Translation is read directly from fsi.visualPreviewRenderPlanV2.controlledV2Translation (the already-computed render plan)', readsFromRenderPlan, { readsFromRenderPlan });

  const hasAllRequiredFields = ['mode:', 'meaningful:', 'identityFallback:', 'visualizedAdjustmentCount:', 'supportedAdjustments:', 'changedFields:', 'confidence:']
    .every((f) => appSrc.includes(f));
  record('controlledV2Translation exposes mode/meaningful/identityFallback/visualizedAdjustmentCount/supportedAdjustments/changedFields/confidence', hasAllRequiredFields, { hasAllRequiredFields });

  const usesSafeChangedFields = /changedFields: _qaSafeChangedFields\(t\?\.changedFields\),/.test(appSrc);
  record('changedFields is passed through the dedicated _qaSafeChangedFields bounding helper', usesSafeChangedFields, { usesSafeChangedFields });

  const noRawAdjustmentModel = !/adjustmentModel: t\?\.adjustmentModel|t\?\.adjustmentModel,/.test(appSrc);
  record('The raw adjustmentModel is never exposed in the QA snapshot', noRawAdjustmentModel, { noRawAdjustmentModel });
}

// ── _qaSafeChangedFields bounding helper ────────────────────────────────
{
  const helperExists = /function _qaSafeChangedFields\(v\) \{/.test(appSrc);
  record('_qaSafeChangedFields helper exists', helperExists, { helperExists });

  const capsAtTen = /\.slice\(0, 10\)/.test(appSrc.split('_qaSafeChangedFields')[1] ?? '');
  record('_qaSafeChangedFields caps the array at 10 entries (defense-in-depth on top of the render plan\'s own cap)', capsAtTen, { capsAtTen });

  const projectsOnlyNamedFields = /field: _qaSafeStr\(e\.field\),\s*before: _qaSafeNum\(e\.before\),\s*after: _qaSafeNum\(e\.after\),\s*delta: _qaSafeNum\(e\.delta\),\s*action: _qaSafeStr\(e\.action\),\s*reason: _qaSafeStr\(e\.reason\),/.test(appSrc);
  record('Each changedFields entry projects only the 6 named, bounded fields (field/before/after/delta/action/reason)', projectsOnlyNamedFields, { projectsOnlyNamedFields });

  const dropsMalformedEntries = /\.filter\(\(e\) => e\.field !== null\);/.test(appSrc);
  record('Entries without a valid string field name are dropped, never coerced into a fake entry', dropsMalformedEntries, { dropsMalformedEntries });
}

// ── reviewGuidance ───────────────────────────────────────────────────────
{
  const readsFromReviewState = /const g = state\.lastPreviewReviewState\?\.reviewGuidance \?\? null;/.test(appSrc);
  record('reviewGuidance is read directly from state.lastPreviewReviewState.reviewGuidance (the Review State Engine\'s own output)', readsFromReviewState, { readsFromReviewState });

  const hasAllRequiredFields = ['visualRequired:', 'visualPassed:', 'systemRequired:', 'systemVerified:', 'readyToBuildV2:']
    .every((f) => appSrc.includes(f));
  record('reviewGuidance exposes visualRequired/visualPassed/systemRequired/systemVerified/readyToBuildV2', hasAllRequiredFields, { hasAllRequiredFields });

  const noLocalRecompute = !/g\.reviewItems\.filter|reviewGuidance:.*filter\(/.test(appSrc);
  record('reviewGuidance is never locally re-filtered/re-derived from reviewItems in the QA hook', noLocalRecompute, { noLocalRecompute });
}

// ── Both fields are part of the returned snapshot object ───────────────
{
  const sessionSummaryIdx = appSrc.indexOf('sessionSummary,');
  const controlledV2Idx = appSrc.indexOf('controlledV2Translation: (() => {');
  const reviewGuidanceIdx = appSrc.indexOf('reviewGuidance: (() => {');
  const bothInReturnedObject = sessionSummaryIdx !== -1 && controlledV2Idx !== -1 && reviewGuidanceIdx !== -1
    && sessionSummaryIdx < controlledV2Idx && controlledV2Idx < reviewGuidanceIdx
    && (reviewGuidanceIdx - controlledV2Idx) < 2500; // both blocks are close together, not scattered elsewhere in the file
  record('Both controlledV2Translation and reviewGuidance are present in getPreviewPipelineSnapshot()\'s returned object, in order, right after sessionSummary', bothInReturnedObject, { sessionSummaryIdx, controlledV2Idx, reviewGuidanceIdx });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
