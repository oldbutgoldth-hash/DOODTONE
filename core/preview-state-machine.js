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
  /* EPIC 2E-P0.7 R6 — granular fast-preview-critical-path states.
   * These replace ANALYZING_LAYER_1's single opaque step for the real
   * production flow (old state/transitions kept below, untouched, for
   * additive-only compatibility). Only PAIRWISE_FAST modules run here —
   * heavy modules (Color Grading, Calibration, Image Analysis Core,
   * Skin Tone) are explicitly excluded and deferred to
   * DEEP_ANALYSIS_RUNNING, which only starts AFTER FAST_PREVIEW_READY. */
  ANALYZING_FAST_REFERENCE: 'ANALYZING_FAST_REFERENCE',
  ANALYZING_FAST_TARGET: 'ANALYZING_FAST_TARGET',
  FAST_FUSION: 'FAST_FUSION',
  FAST_PREVIEW_RENDERING: 'FAST_PREVIEW_RENDERING',
  /* Deferred, off-critical-path heavy analysis (Color Grading,
   * Calibration, Image Analysis Core, Skin Tone) — starts only once the
   * user already has a visible Fast Preview. Never blocks first paint. */
  DEEP_ANALYSIS_RUNNING: 'DEEP_ANALYSIS_RUNNING',
  REFINED_PREVIEW_RENDERING: 'REFINED_PREVIEW_RENDERING',
  REFINED_PREVIEW_READY: 'REFINED_PREVIEW_READY',
  ERROR: 'ERROR',
  STALE: 'STALE',
};

const TRANSITIONS = {
  [PREVIEW_STATE.IDLE]: [PREVIEW_STATE.WAITING],
  [PREVIEW_STATE.WAITING]: [PREVIEW_STATE.ANALYZING_LAYER_1, PREVIEW_STATE.ANALYZING_FAST_REFERENCE, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.ANALYZING_LAYER_1]: [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.FAST_PREVIEW_READY]: [
    PREVIEW_STATE.ANALYZING_LAYER_2,
    PREVIEW_STATE.DEEP_ANALYSIS_RUNNING,
    PREVIEW_STATE.INTENSITY_RERENDERING,
    PREVIEW_STATE.ERROR,
    PREVIEW_STATE.STALE,
  ],
  [PREVIEW_STATE.ANALYZING_LAYER_2]: [PREVIEW_STATE.REFINED_READY, PREVIEW_STATE.INTENSITY_RERENDERING, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.REFINED_READY]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.INTENSITY_RERENDERING, PREVIEW_STATE.STALE, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.INTENSITY_RERENDERING]: [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ERROR],
  [PREVIEW_STATE.ERROR]: [PREVIEW_STATE.WAITING, PREVIEW_STATE.IDLE],
  [PREVIEW_STATE.STALE]: [PREVIEW_STATE.WAITING],

  /* ── EPIC 2E-P0.7 R6 additions (additive only — nothing above changed
   *    except FAST_PREVIEW_READY gaining two new valid exits) ── */
  [PREVIEW_STATE.ANALYZING_FAST_REFERENCE]: [PREVIEW_STATE.ANALYZING_FAST_TARGET, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.ANALYZING_FAST_TARGET]: [PREVIEW_STATE.FAST_FUSION, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.FAST_FUSION]: [PREVIEW_STATE.FAST_PREVIEW_RENDERING, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.FAST_PREVIEW_RENDERING]: [PREVIEW_STATE.FAST_PREVIEW_READY, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.DEEP_ANALYSIS_RUNNING]: [
    PREVIEW_STATE.REFINED_PREVIEW_RENDERING,
    PREVIEW_STATE.INTENSITY_RERENDERING,
    PREVIEW_STATE.ERROR,
    PREVIEW_STATE.STALE,
  ],
  [PREVIEW_STATE.REFINED_PREVIEW_RENDERING]: [PREVIEW_STATE.REFINED_PREVIEW_READY, PREVIEW_STATE.ERROR, PREVIEW_STATE.STALE],
  [PREVIEW_STATE.REFINED_PREVIEW_READY]: [
    PREVIEW_STATE.ANALYZING_LAYER_2,
    PREVIEW_STATE.INTENSITY_RERENDERING,
    PREVIEW_STATE.WAITING,
    PREVIEW_STATE.STALE,
    PREVIEW_STATE.ERROR,
  ],
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
