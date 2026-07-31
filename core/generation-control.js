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
