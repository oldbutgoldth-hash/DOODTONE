export const MODULE_STATUS = {
  QUEUED: 'QUEUED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  CACHED: 'CACHED',
};

export const LAYER = {
  LAYER_1: 'LAYER_1',
  LAYER_2: 'LAYER_2',
};

const DEFAULT_TIMEOUT = 30000;

export async function runModule({
  moduleId,
  layer,
  generationId,
  signal,
  isStale,
  heartbeatRef,
  cacheProvider,
  fallbackProvider,
  guard,
  executor,
  timeout = DEFAULT_TIMEOUT,
}) {
  if (guard().stale) return { aborted: true, moduleId, reason: 'stale pre-execution' };
  if (signal?.aborted) return { aborted: true, moduleId, reason: signal.reason || 'aborted pre-execution' };

  const startTime = performance.now();

  if (heartbeatRef) heartbeatRef.current = `RUNNING:${moduleId}`;

  try {
    if (cacheProvider) {
      const cached = await cacheProvider();
      if (cached !== undefined && cached !== null) {
        if (guard().stale) return { aborted: true, moduleId, reason: 'stale after cache' };
        return { moduleId, result: cached, cached: true, elapsed: performance.now() - startTime };
      }
    }

    const result = await Promise.race([
      executor({ generationId, signal, guard }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT:${timeout}ms`)), timeout)
      ),
    ]);

    if (guard().stale) return { aborted: true, moduleId, reason: 'stale post-execution' };

    return { moduleId, result, cached: false, elapsed: performance.now() - startTime };
  } catch (err) {
    if (err.name === 'AbortError') return { aborted: true, moduleId, reason: 'aborted' };
    if (guard().stale) return { aborted: true, moduleId, reason: 'stale during execution' };

    if (fallbackProvider) {
      try {
        const fallback = await fallbackProvider();
        return { moduleId, result: fallback, fallback: true, elapsed: performance.now() - startTime };
      } catch (fbErr) {
        return { moduleId, error: err, fallbackError: fbErr, elapsed: performance.now() - startTime };
      }
    }
    return { moduleId, error: err, elapsed: performance.now() - startTime };
  }
}
