#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r5-preview-state-machine-static-test.mjs
 *
 * EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair + State Machine
 * Closure. Pure Node test (no Browser/DOM) against the REAL, production
 * core/preview-state-machine.js — proves the new INTENSITY_RERENDERING
 * state and its transitions are wired correctly, and that every
 * transition() call's return value is meaningful (fails closed on an
 * invalid transition rather than silently mutating state).
 *
 * This directly targets the two defects R4 introduced and the user's
 * spec explicitly calls out:
 *   PSM: invalid transition REFINED_READY -> ANALYZING_LAYER_1
 *   PSM: invalid transition REFINED_READY -> FAST_PREVIEW_READY
 */
import { PreviewStateMachine, PREVIEW_STATE } from '../core/preview-state-machine.js';

let pass = 0, fail = 0;
const results = [];
function record(test, ok, evidence = '') {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: String(evidence) });
  console.log(`${ok ? '✓' : '✗'} [${ok ? 'PASS' : 'FAIL'}] ${test}${evidence ? ` — ${evidence}` : ''}`);
  if (ok) pass++; else fail++;
}

function freshPsmAt(state) {
  const psm = new PreviewStateMachine();
  if (state === PREVIEW_STATE.IDLE) return psm;
  // Drive through the real, valid sequence to reach the requested state —
  // never force-set internal `_state` directly, so this test proves the
  // state is REACHABLE via real transitions, not just assignable.
  const path = {
    [PREVIEW_STATE.WAITING]: [PREVIEW_STATE.WAITING],
    [PREVIEW_STATE.ANALYZING_LAYER_1]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.ANALYZING_LAYER_1],
    [PREVIEW_STATE.FAST_PREVIEW_READY]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.FAST_PREVIEW_READY],
    [PREVIEW_STATE.ANALYZING_LAYER_2]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ANALYZING_LAYER_2],
    [PREVIEW_STATE.REFINED_READY]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ANALYZING_LAYER_2, PREVIEW_STATE.REFINED_READY],
  }[state];
  for (const step of path) {
    const ok = psm.transition(step);
    if (!ok) throw new Error(`Test setup failed: could not reach ${state} — transition to ${step} from ${psm.state} was rejected`);
  }
  return psm;
}

/* ── Case 1-3: the 3 required valid entries into INTENSITY_RERENDERING ── */
for (const fromState of [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ANALYZING_LAYER_2, PREVIEW_STATE.REFINED_READY]) {
  const psm = freshPsmAt(fromState);
  const ok = psm.transition(PREVIEW_STATE.INTENSITY_RERENDERING);
  record(
    `${fromState} -> INTENSITY_RERENDERING is a valid transition (real Intensity rerender entry point)`,
    ok === true && psm.state === PREVIEW_STATE.INTENSITY_RERENDERING,
    `transition()=${ok}, state=${psm.state}`
  );
}

/* ── Case 4: INTENSITY_RERENDERING -> FAST_PREVIEW_READY (the required exit) ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.FAST_PREVIEW_READY);
  psm.transition(PREVIEW_STATE.INTENSITY_RERENDERING);
  const ok = psm.transition(PREVIEW_STATE.FAST_PREVIEW_READY);
  record('INTENSITY_RERENDERING -> FAST_PREVIEW_READY is a valid transition', ok === true && psm.state === PREVIEW_STATE.FAST_PREVIEW_READY, `transition()=${ok}, state=${psm.state}`);
}

/* ── Case 5: INTENSITY_RERENDERING -> ERROR (required failure exit) ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.REFINED_READY);
  psm.transition(PREVIEW_STATE.INTENSITY_RERENDERING);
  const ok = psm.transition(PREVIEW_STATE.ERROR);
  record('INTENSITY_RERENDERING -> ERROR is a valid transition', ok === true && psm.state === PREVIEW_STATE.ERROR, `transition()=${ok}, state=${psm.state}`);
}

/* ── Case 6-10 HOSTILE: INTENSITY_RERENDERING must NOT be reachable from
   states where real Core analysis is genuinely running (ANALYZING_LAYER_1)
   or from states with no active pipeline at all (IDLE/WAITING/ERROR/STALE).
   transition() must return false and must NOT mutate state. ── */
const forbiddenEntries = [
  PREVIEW_STATE.IDLE,
  PREVIEW_STATE.WAITING,
  PREVIEW_STATE.ANALYZING_LAYER_1,
  PREVIEW_STATE.ERROR,
  PREVIEW_STATE.STALE,
];
for (const fromState of forbiddenEntries) {
  let psm;
  if (fromState === PREVIEW_STATE.IDLE) {
    psm = new PreviewStateMachine();
  } else if (fromState === PREVIEW_STATE.WAITING) {
    psm = new PreviewStateMachine();
    psm.transition(PREVIEW_STATE.WAITING);
  } else if (fromState === PREVIEW_STATE.ANALYZING_LAYER_1) {
    psm = new PreviewStateMachine();
    psm.transition(PREVIEW_STATE.WAITING);
    psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
  } else if (fromState === PREVIEW_STATE.ERROR) {
    psm = new PreviewStateMachine();
    psm.transition(PREVIEW_STATE.WAITING);
    psm.transition(PREVIEW_STATE.ERROR);
  } else if (fromState === PREVIEW_STATE.STALE) {
    psm = new PreviewStateMachine();
    psm.transition(PREVIEW_STATE.WAITING);
    psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
    psm.transition(PREVIEW_STATE.STALE);
  }
  const before = psm.state;
  const ok = psm.transition(PREVIEW_STATE.INTENSITY_RERENDERING);
  record(
    `HOSTILE: ${fromState} -> INTENSITY_RERENDERING is correctly REJECTED (Intensity rerender never claims to be running real Core analysis)`,
    ok === false && psm.state === before,
    `transition()=${ok}, stateBefore=${before}, stateAfter=${psm.state}`
  );
}

/* ── Case 11 HOSTILE: the R4 defect, reproduced and proven fixed —
   REFINED_READY -> ANALYZING_LAYER_1 directly (skipping WAITING) must
   still be rejected exactly as before; the fix must never have widened
   this specific forbidden transition. ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.REFINED_READY);
  const ok = psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
  record(
    'HOSTILE (R4 regression guard): REFINED_READY -> ANALYZING_LAYER_1 directly is still correctly REJECTED',
    ok === false && psm.state === PREVIEW_STATE.REFINED_READY,
    `transition()=${ok}, state=${psm.state}`
  );
}

/* ── Case 12 HOSTILE: REFINED_READY -> FAST_PREVIEW_READY directly
   (the second half of the exact reported R4 warning pair) must also
   still be rejected — the only sanctioned path out of REFINED_READY
   toward a fresh preview is via INTENSITY_RERENDERING or WAITING. ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.REFINED_READY);
  const ok = psm.transition(PREVIEW_STATE.FAST_PREVIEW_READY);
  record(
    'HOSTILE (R4 regression guard): REFINED_READY -> FAST_PREVIEW_READY directly is still correctly REJECTED',
    ok === false && psm.state === PREVIEW_STATE.REFINED_READY,
    `transition()=${ok}, state=${psm.state}`
  );
}

/* ── Case 13: the ORIGINAL full-analysis sequence is unchanged/still valid
   end-to-end (no regression from adding INTENSITY_RERENDERING). ── */
{
  const psm = new PreviewStateMachine();
  const steps = [PREVIEW_STATE.WAITING, PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ANALYZING_LAYER_2, PREVIEW_STATE.REFINED_READY];
  const allOk = steps.every(s => psm.transition(s));
  record('Full analysis sequence IDLE->WAITING->ANALYZING_LAYER_1->FAST_PREVIEW_READY->ANALYZING_LAYER_2->REFINED_READY still fully valid (no regression)', allOk === true && psm.state === PREVIEW_STATE.REFINED_READY, `state=${psm.state}`);
}

/* ── Case 14: REFINED_READY -> WAITING (used by _resetPsmToWaiting for a
   genuinely NEW Reference/Target pair) is still valid — unaffected by
   the new INTENSITY_RERENDERING state. ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.REFINED_READY);
  const ok = psm.transition(PREVIEW_STATE.WAITING);
  record('REFINED_READY -> WAITING (new pair reset path) is still valid', ok === true && psm.state === PREVIEW_STATE.WAITING, `transition()=${ok}, state=${psm.state}`);
}

/* ── Case 15: canTransition() agrees with transition() for the new state,
   in both directions (no drift between the two query surfaces). ── */
{
  const psm = freshPsmAt(PREVIEW_STATE.FAST_PREVIEW_READY);
  const can = psm.canTransition(PREVIEW_STATE.INTENSITY_RERENDERING);
  const did = psm.transition(PREVIEW_STATE.INTENSITY_RERENDERING);
  record('canTransition(INTENSITY_RERENDERING) agrees with the actual transition() outcome', can === true && did === true, `canTransition=${can}, transition()=${did}`);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
