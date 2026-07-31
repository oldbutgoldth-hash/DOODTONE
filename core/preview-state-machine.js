export const PREVIEW_STATE = {
  IDLE: 'IDLE',
  WAITING: 'WAITING',
  ANALYZING_LAYER_1: 'ANALYZING_LAYER_1',
  FAST_PREVIEW_READY: 'FAST_PREVIEW_READY',
  ANALYZING_LAYER_2: 'ANALYZING_LAYER_2',
  REFINED_READY: 'REFINED_READY',
  /* EPIC 2E-P0.7 R5 — dedicated state for a cached Intensity-only
   * rerender (reused Reference/Target evidence, no Core analysis).
   * Never enter this state via ANALYZING_LAYER_1/2 — those imply real
   * Core analysis is running, which an Intensity rerender never does. */
  INTENSITY_RERENDERING: 'INTENSITY_RERENDERING',
  ERROR: 'ERROR',
  STALE: 'STALE',
};

const TRANSITIONS = {
  [PREVIEW_STATE.IDLE]: [PREVIEW_STATE.WAITING],
  [PREVIEW_STATE.WAITING]: [PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.ANALYZING_LAYER_1]: [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.FAST_PREVIEW_READY]: [PREVIEW_STATE.ANALYZING_LAYER_2, PREVIEW_STATE.INTENSITY_RERENDERING, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.ANALYZING_LAYER_2]: [PREVIEW_STATE.REFINED_READY, PREVIEW_STATE.INTENSITY_RERENDERING, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.REFINED_READY]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.INTENSITY_RERENDERING, PREVIEW_STATE.STALE, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.INTENSITY_RERENDERING]: [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.ERROR]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.IDLE],
  [PREVIEW_STATE.STALE]: [PREVIEW_STATE.WAITING],
};

export class PreviewStateMachine {
  constructor() {
    this._state = PREVIEW_STATE.IDLE;
    this._onTransition = null;
  }

  get state() { return this._state; }

  onTransition(fn) {
    this._onTransition = fn;
  }

  transition(to) {
    const allowed = TRANSITIONS[this._state] || [];
    if (!allowed.includes(to)) {
      console.warn(`PSM: invalid transition ${this._state} -> ${to}`);
      return false;
    }
    const from = this._state;
    this._state = to;
    if (this._onTransition) this._onTransition({ from, to });
    return true;
  }

  canTransition(to) {
    return (TRANSITIONS[this._state] || []).includes(to);
  }

  reset() {
    this._state = PREVIEW_STATE.IDLE;
  }
}
