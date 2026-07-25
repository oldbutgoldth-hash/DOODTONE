#!/usr/bin/env node
/**
 * qa/epic-2e-j-review-state-engine-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase G2 (UI-facing layer).
 *
 * The Review Console UI (ui/review-console-renderer.js) renders from
 * `core/lightroom-mapping-engine/mapping-v2-preview-review-state.js`'s
 * output, NOT from the Preview Sandbox's own `humanReviewChecklist`
 * directly (that separate object is already covered by
 * qa/epic-2e-j-controlled-v2-review-static-test.mjs). This suite
 * proves the SAME system-verified/never-manual guarantee holds in
 * THIS engine — the one that actually feeds the real UI — across all
 * three of its exports: createPreviewReviewStateV2,
 * updatePreviewReviewItemV2, and resetPreviewReviewStateV2.
 *
 * Pure Node import, no DOM/Browser required.
 */
import {
  createPreviewReviewStateV2,
  evaluatePreviewReviewStateV2,
  updatePreviewReviewItemV2,
  resetPreviewReviewStateV2,
} from '../core/lightroom-mapping-engine/mapping-v2-preview-review-state.js';

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const SYSTEM_IDS = ['legacy-output-preserved', 'rollback-confirmed', 'preview-non-production-confirmed', 'export-path-unchanged'];
const VISUAL_IDS = ['source-image-reviewed', 'skin-tones-reviewed', 'highlights-reviewed', 'shadows-reviewed', 'white-balance-reviewed', 'color-stacking-reviewed'];

function buildHealthySandbox() {
  return {
    canGeneratePreview: true,
    canExportPreview: false,
    canWriteProduction: false,
    selectedOutputSource: 'legacy',
    fallbackStrategy: { useLegacyMapping: true },
    rollbackPlan: { available: true, restoreSource: 'legacy' },
    simulatedPreviewPreset: { appliedToProduction: false, exportEligible: false, containsRealSliderValues: false, containsXMPValues: false },
    previewRiskReview: { skinRisk: 'low', highlightRisk: 'low', shadowRisk: 'low', whiteBalanceRisk: 'low', colorRisk: 'low', overStackSeverity: 'low' },
  };
}

function findItem(state, id) {
  return (state.reviewItems ?? []).find((i) => i && i.id === id) ?? null;
}

// ── 1: fresh create — 4 system items auto-pass, 6 visual items pending ──
{
  const state = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: buildHealthySandbox() });
  const allSystemPassed = SYSTEM_IDS.every((id) => findItem(state, id)?.status === 'passed' && findItem(state, id)?.reviewSource === 'system-verified' && findItem(state, id)?.manual === false);
  record('createPreviewReviewStateV2: all 4 system items auto-pass with manual=false, reviewSource=system-verified', allSystemPassed, SYSTEM_IDS.map((id) => findItem(state, id)?.status));

  const allVisualPending = VISUAL_IDS.every((id) => findItem(state, id)?.status === 'pending' && findItem(state, id)?.manual === true);
  record('createPreviewReviewStateV2: all 6 visual items remain pending with manual=true', allVisualPending, VISUAL_IDS.map((id) => findItem(state, id)?.status));

  record('createPreviewReviewStateV2: reviewGuidance present with correct counts', state.reviewGuidance?.systemRequired === 4 && state.reviewGuidance?.systemVerified === 4 && state.reviewGuidance?.visualRequired === 6 && state.reviewGuidance?.visualPassed === 0 && state.reviewGuidance?.readyToBuildV2 === false, state.reviewGuidance);
}

// ── 2: a manual "existingReviewState" trying to fail a system item is ignored on the next build ──
{
  const healthy = buildHealthySandbox();
  const priorState = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: healthy });
  const poisoned = {
    ...priorState,
    reviewItems: priorState.reviewItems.map((i) => (i.id === 'legacy-output-preserved' ? { ...i, status: 'failed', reviewerDecision: 'reject' } : i)),
  };
  const rebuilt = evaluatePreviewReviewStateV2({ existingReviewState: poisoned, controlledOverlayPreviewSandboxV2: healthy });
  const stillPassed = findItem(rebuilt, 'legacy-output-preserved')?.status === 'passed';
  record('evaluatePreviewReviewStateV2: a poisoned existingReviewState "failed" on a system item is ignored — re-derived fresh from sandbox', stillPassed, findItem(rebuilt, 'legacy-output-preserved'));
}

// ── 3: updatePreviewReviewItemV2 targeting a system-verified item is a safe no-op ──
{
  const state = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: buildHealthySandbox() });
  const before = findItem(state, 'rollback-confirmed');
  const after = updatePreviewReviewItemV2(state, 'rollback-confirmed', { status: 'failed', reviewerDecision: 'reject' });
  const afterItem = findItem(after, 'rollback-confirmed');
  const unchanged = afterItem.status === before.status && afterItem.reviewerDecision === before.reviewerDecision && afterItem.status === 'passed';
  record('updatePreviewReviewItemV2: attempting to fail a system-verified item is ignored (status unchanged)', unchanged, { before: before.status, after: afterItem.status });
  const hasWarning = (after.warnings ?? []).some((w) => typeof w === 'string' && w.includes('system-verified') && w.includes('rollback-confirmed'));
  record('updatePreviewReviewItemV2: the ignored system-item update produces an honest warning naming the item', hasWarning, after.warnings);
  record('updatePreviewReviewItemV2: system-item no-op still returns a fully valid reviewProgress/reviewGuidance', typeof after.reviewProgress?.percentage === 'number' && typeof after.reviewGuidance?.overallRequired === 'number', { reviewProgress: after.reviewProgress, reviewGuidance: after.reviewGuidance });
}

// ── 4: updatePreviewReviewItemV2 targeting a genuine visual item still works normally (no regression) ──
{
  const state = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: buildHealthySandbox() });
  const after = updatePreviewReviewItemV2(state, 'source-image-reviewed', { status: 'passed' });
  const item = findItem(after, 'source-image-reviewed');
  record('updatePreviewReviewItemV2: a genuine visual item can still be passed manually', item?.status === 'passed' && item?.reviewed === true, item);
}

// ── 5: resetPreviewReviewStateV2 preserves system items, clears only visual items ──
{
  const healthy = buildHealthySandbox();
  let state = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: healthy });
  for (const id of VISUAL_IDS) state = updatePreviewReviewItemV2(state, id, { status: 'passed' });
  const beforeReset = { systemAllPassed: SYSTEM_IDS.every((id) => findItem(state, id)?.status === 'passed'), visualAllPassed: VISUAL_IDS.every((id) => findItem(state, id)?.status === 'passed') };
  record('Setup: before reset, all 10 items are passed', beforeReset.systemAllPassed && beforeReset.visualAllPassed, beforeReset);

  const resetState = resetPreviewReviewStateV2(state);
  const systemStillPassed = SYSTEM_IDS.every((id) => findItem(resetState, id)?.status === 'passed' && findItem(resetState, id)?.reviewSource === 'system-verified');
  record('resetPreviewReviewStateV2: system-verified items remain passed after reset (never fabricated back to pending)', systemStillPassed, SYSTEM_IDS.map((id) => findItem(resetState, id)?.status));

  const visualAllPending = VISUAL_IDS.every((id) => findItem(resetState, id)?.status === 'pending' && findItem(resetState, id)?.reviewed === false);
  record('resetPreviewReviewStateV2: visual (manual) items are genuinely returned to pending', visualAllPending, VISUAL_IDS.map((id) => findItem(resetState, id)?.status));

  record('resetPreviewReviewStateV2: reviewGuidance reflects 4 still-verified, 0 visual passed', resetState.reviewGuidance?.systemVerified === 4 && resetState.reviewGuidance?.visualPassed === 0 && resetState.reviewGuidance?.readyToBuildV2 === false, resetState.reviewGuidance);
}

// ── 6: missing/incomplete sandbox evidence -> system items are honestly "unavailable", never "passed" ──
{
  const state = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: { canGeneratePreview: false } });
  const allUnavailable = SYSTEM_IDS.every((id) => findItem(state, id)?.status === 'unavailable' && findItem(state, id)?.reviewSource === 'system-unavailable');
  record('createPreviewReviewStateV2: incomplete sandbox evidence -> all 4 system items are "unavailable", never fabricated "passed"', allUnavailable, SYSTEM_IDS.map((id) => findItem(state, id)?.status));
}

// ── 7: no sandbox at all -> still never throws, system items unavailable ──
{
  let threw = false;
  let state = null;
  try {
    state = createPreviewReviewStateV2({});
  } catch (e) {
    threw = true;
  }
  record('createPreviewReviewStateV2({}) never throws with no sandbox at all', !threw, { threw });
  const allUnavailable = !threw && SYSTEM_IDS.every((id) => findItem(state, id)?.status === 'unavailable');
  record('createPreviewReviewStateV2({}): system items are "unavailable" (not passed, not pending) with no sandbox', allUnavailable, !threw ? SYSTEM_IDS.map((id) => findItem(state, id)?.status) : 'N/A (threw)');
}

// ── 8: two independent builds from the same healthy sandbox re-derive identically (no caching/memoization) ──
{
  const healthy = buildHealthySandbox();
  const a = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: healthy });
  const b = createPreviewReviewStateV2({ controlledOverlayPreviewSandboxV2: healthy });
  const identical = SYSTEM_IDS.every((id) => findItem(a, id)?.status === findItem(b, id)?.status);
  record('Two independent createPreviewReviewStateV2 calls from the same sandbox agree exactly (no stale caching)', identical, { a: SYSTEM_IDS.map((id) => findItem(a, id)?.status), b: SYSTEM_IDS.map((id) => findItem(b, id)?.status) });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
