#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r6-preview-state-machine-static-test.mjs
 *
 * EPIC 2E-P0.7 R6 — True Preview-Critical Path Separation. Real,
 * Node-executed transition assertions against the actual
 * core/preview-state-machine.js (no DOM needed) for every new state
 * this round introduced, proving:
 *   - the exact required 9-ish-state fast/refined sequence is valid
 *   - Intensity can interrupt at every stage that must support it
 *   - the R5 states/transitions are completely unchanged (additive-only)
 *   - hostile skips (e.g. straight to a heavy-module state) are rejected
 */
import { PreviewStateMachine, PREVIEW_STATE } from '../core/preview-state-machine.js';

let pass = 0, fail = 0;
function record(test, ok, evidence = '') {
  console.log(`${ok ? '✓' : '✗'} [${ok ? 'PASS' : 'FAIL'}] ${test}${evidence ? ` — ${evidence}` : ''}`);
  if (ok) pass++; else fail++;
}

function runSequence(seq) {
  const psm = new PreviewStateMachine();
  for (const s of seq) {
    if (!psm.transition(PREVIEW_STATE[s])) return { ok: false, failedAt: s, state: psm.state };
  }
  return { ok: true, state: psm.state };
}

function main() {
  // 1. The exact real-image fast/refined critical-path sequence a
  // brand-new Reference/Target pair drives through in production.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING',
      'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY', 'ANALYZING_LAYER_2', 'REFINED_READY',
    ]);
    record('Full R6 sequence: WAITING through REFINED_READY (Fast Preview -> Deep Analysis -> Layer 2) is entirely valid', r.ok, JSON.stringify(r));
  }

  // 2. FAST_PREVIEW_READY is reachable WITHOUT ever passing through
  // DEEP_ANALYSIS_RUNNING first — i.e. it is a real, independently
  // reachable milestone, not merely a label reused after heavy work.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY',
    ]);
    record('FAST_PREVIEW_READY is reachable on its own, before any DEEP_ANALYSIS_RUNNING transition exists', r.ok && r.state === 'FAST_PREVIEW_READY', JSON.stringify(r));
  }

  // 3. Intensity can interrupt at FAST_PREVIEW_READY (no Deep Analysis
  // has started yet) and correctly returns to FAST_PREVIEW_READY.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'INTENSITY_RERENDERING', 'FAST_PREVIEW_READY',
    ]);
    record('Intensity can interrupt from FAST_PREVIEW_READY and return to FAST_PREVIEW_READY', r.ok, JSON.stringify(r));
  }

  // 4. Intensity can interrupt MID Deep Analysis (heavy modules still
  // running) and the machine still lands back on FAST_PREVIEW_READY —
  // required so an Intensity drag never gets stuck waiting on Image
  // Analysis Core etc.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING',
      'INTENSITY_RERENDERING', 'FAST_PREVIEW_READY',
    ]);
    record('Intensity can interrupt DEEP_ANALYSIS_RUNNING mid-flight and still resolve to FAST_PREVIEW_READY', r.ok, JSON.stringify(r));
  }

  // 5. Intensity can interrupt after REFINED_PREVIEW_READY too.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING',
      'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY', 'INTENSITY_RERENDERING', 'FAST_PREVIEW_READY',
    ]);
    record('Intensity can interrupt from REFINED_PREVIEW_READY and return to FAST_PREVIEW_READY', r.ok, JSON.stringify(r));
  }

  // 6. A new pair (WAITING reset) is reachable from REFINED_PREVIEW_READY.
  {
    const r = runSequence([
      'WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION',
      'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING',
      'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY', 'WAITING',
    ]);
    record('New-pair reset (-> WAITING) is reachable from REFINED_PREVIEW_READY', r.ok, JSON.stringify(r));
  }

  // 7. HOSTILE: cannot skip straight from WAITING into any heavy-module
  // state — Fast Preview's granular states must all be traversed first.
  for (const target of ['ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING', 'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY']) {
    const psm = new PreviewStateMachine();
    psm.transition(PREVIEW_STATE.WAITING);
    const ok = psm.transition(PREVIEW_STATE[target]);
    record(`HOSTILE: WAITING -> ${target} directly (skipping the granular fast-preview states) is correctly REJECTED`, !ok, `transition()=${ok}`);
  }

  // 8. HOSTILE: cannot enter DEEP_ANALYSIS_RUNNING before FAST_PREVIEW_READY.
  {
    const psm = new PreviewStateMachine();
    for (const s of ['WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING']) psm.transition(PREVIEW_STATE[s]);
    const ok = psm.transition(PREVIEW_STATE.DEEP_ANALYSIS_RUNNING);
    record('HOSTILE: FAST_PREVIEW_RENDERING -> DEEP_ANALYSIS_RUNNING directly (skipping FAST_PREVIEW_READY) is correctly REJECTED', !ok, `transition()=${ok}`);
  }

  // 9. HOSTILE: cannot enter REFINED_PREVIEW_READY before REFINED_PREVIEW_RENDERING.
  {
    const psm = new PreviewStateMachine();
    for (const s of ['WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING']) psm.transition(PREVIEW_STATE[s]);
    const ok = psm.transition(PREVIEW_STATE.REFINED_PREVIEW_READY);
    record('HOSTILE: DEEP_ANALYSIS_RUNNING -> REFINED_PREVIEW_READY directly (skipping REFINED_PREVIEW_RENDERING) is correctly REJECTED', !ok, `transition()=${ok}`);
  }

  // 10. R5's original sequence is completely unaffected (additive-only proof).
  {
    const r = runSequence(['WAITING', 'ANALYZING_LAYER_1', 'FAST_PREVIEW_READY', 'ANALYZING_LAYER_2', 'REFINED_READY']);
    record('R5/legacy sequence WAITING->ANALYZING_LAYER_1->FAST_PREVIEW_READY->ANALYZING_LAYER_2->REFINED_READY is completely unchanged', r.ok, JSON.stringify(r));
  }
  {
    const r = runSequence(['WAITING', 'ANALYZING_LAYER_1', 'FAST_PREVIEW_READY', 'INTENSITY_RERENDERING', 'FAST_PREVIEW_READY']);
    record('R5 Intensity-from-FAST_PREVIEW_READY sequence is completely unchanged', r.ok, JSON.stringify(r));
  }

  // 11. HOSTILE regression guard: the exact R4-era defect must still be rejected.
  {
    const psm = new PreviewStateMachine();
    for (const s of ['WAITING', 'ANALYZING_LAYER_1', 'FAST_PREVIEW_READY', 'ANALYZING_LAYER_2', 'REFINED_READY']) psm.transition(PREVIEW_STATE[s]);
    const ok = psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
    record('HOSTILE (R4 regression guard, still enforced in R6): REFINED_READY -> ANALYZING_LAYER_1 directly is still correctly REJECTED', !ok, `transition()=${ok}`);
  }

  // 12. canTransition() agrees with transition() for a new-state edge.
  {
    const psm = new PreviewStateMachine();
    for (const s of ['WAITING', 'ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY']) psm.transition(PREVIEW_STATE[s]);
    const can = psm.canTransition(PREVIEW_STATE.DEEP_ANALYSIS_RUNNING);
    const did = psm.transition(PREVIEW_STATE.DEEP_ANALYSIS_RUNNING);
    record('canTransition(DEEP_ANALYSIS_RUNNING) agrees with the actual transition() outcome from FAST_PREVIEW_READY', can === did && did === true, `canTransition=${can}, transition()=${did}`);
  }

  // 13. All 7 new states exist with the exact names the R6 spec requires.
  const requiredNewStates = ['ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING', 'DEEP_ANALYSIS_RUNNING', 'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY'];
  for (const s of requiredNewStates) {
    record(`PREVIEW_STATE.${s} exists`, PREVIEW_STATE[s] === s, '');
  }

  console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
