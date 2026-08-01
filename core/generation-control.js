let _activeGenerationId = 0;
let _abortController = null;

export function createGeneration() {
  _abortController?.abort('stale');
  _activeGenerationId++;
  const generationId = _activeGenerationId;
  const controller = new AbortController();
  _abortController = controller;
  return { generationId, signal: controller.signal, abort: () => controller.abort('cancelled') };
}

export function getActiveGenerationId() {
  return _activeGenerationId;
}

export function getAbortSignal() {
  return _abortController?.signal || null;
}

export function isStale(generationId) {
  return generationId !== _activeGenerationId;
}

export function cancelActiveGeneration() {
  _abortController?.abort('cancelled');
  _abortController = null;
}

export function createGenerationGuard(generationId) {
  return (label) => {
    if (isStale(generationId)) {
      return { stale: true, reason: `stale generation ${generationId} (active: ${_activeGenerationId})` };
    }
    return { stale: false };
  };
}

/* ── EPIC 2E-P0.7 R6 — three separate, independently-cancellable
 * ownership tokens ──────────────────────────────────────────────────
 *
 * The single `_activeGenerationId` above identifies "which
 * Reference/Target pair are we on" (a whole-pipeline generation). R6
 * needs three FINER-grained, independently-superseded tokens layered
 * on top of that, because a new Fast Preview, a new Deep Analysis
 * enrichment pass, and a new Intensity-cached rerender can each become
 * obsolete on their own schedule without necessarily invalidating the
 * others:
 *
 *   fastPreviewGeneration    — one per Fast Preview build attempt
 *                               (new pair, or a retry after ERROR)
 *   refinedAnalysisTask      — one per Deep Analysis enrichment attempt
 *                               (superseded by a newer pair OR a newer
 *                               Fast Preview OR an Intensity change that
 *                               arrives mid-flight)
 *   intensityRenderGeneration — one per cached Intensity-only rerender
 *                               attempt (formalizes the existing
 *                               runSeq/activeRunId pattern used inside
 *                               ui/reference-color-match-panel.js as a
 *                               named, independently-testable token)
 *
 * Additive only: nothing above this point is modified. Each token is
 * its own independent counter — bumping one never invalidates another,
 * by design, since they represent genuinely different kinds of work. */

const _namedTokens = {
  fastPreviewGeneration: 0,
  refinedAnalysisTask: 0,
  intensityRenderGeneration: 0,
};

const VALID_TOKEN_NAMES = Object.freeze(Object.keys(_namedTokens));

function _assertTokenName(name) {
  if (!VALID_TOKEN_NAMES.includes(name)) {
    throw new Error(`Unknown generation token name: ${name}. Expected one of ${VALID_TOKEN_NAMES.join(', ')}`);
  }
}

/**
 * Mint a new value for one of the three named ownership tokens. Bumping
 * a token immediately makes every previously-issued id for that SAME
 * token name stale (via isNamedTokenStale); it has no effect on the
 * other two token names or on the whole-pipeline generation above.
 */
export function createNamedGeneration(name) {
  _assertTokenName(name);
  _namedTokens[name]++;
  return _namedTokens[name];
}

export function getActiveNamedGeneration(name) {
  _assertTokenName(name);
  return _namedTokens[name];
}

export function isNamedTokenStale(name, id) {
  _assertTokenName(name);
  return id !== _namedTokens[name];
}

/** Convenience wrappers — one per required named token. */
export function createFastPreviewGeneration() { return createNamedGeneration('fastPreviewGeneration'); }
export function isFastPreviewStale(id) { return isNamedTokenStale('fastPreviewGeneration', id); }

export function createRefinedAnalysisTask() { return createNamedGeneration('refinedAnalysisTask'); }
export function isRefinedAnalysisStale(id) { return isNamedTokenStale('refinedAnalysisTask', id); }

export function createIntensityRenderGeneration() { return createNamedGeneration('intensityRenderGeneration'); }
export function isIntensityRenderStale(id) { return isNamedTokenStale('intensityRenderGeneration', id); }

/** Test/debug visibility into all three counters at once. */
export function getNamedGenerationSnapshot() {
  return { ..._namedTokens };
}
