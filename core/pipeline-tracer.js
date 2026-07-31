const TRACES = new Map();

let _traceCounter = 0;

export function createTrace(generationId) {
  const trace = {
    generationId,
    entries: [],
    startTime: performance.now(),
    endTime: null,
  };
  TRACES.set(generationId, trace);
  return trace;
}

export function recordTrace({ generationId, stageId, moduleId, status, detail, error, stackTrace }) {
  const trace = TRACES.get(generationId);
  if (!trace) return;
  const entry = {
    id: ++_traceCounter,
    generationId,
    stageId,
    moduleId,
    status,
    detail: detail || '',
    error: error || '',
    stackTrace: stackTrace || '',
    timestamp: performance.now(),
    elapsed: performance.now() - trace.startTime,
  };
  trace.entries.push(entry);
}

export function getTrace(generationId) {
  return TRACES.get(generationId);
}

export function getAllTraces() {
  return Array.from(TRACES.values());
}

export function closeTrace(generationId) {
  const trace = TRACES.get(generationId);
  if (trace) {
    trace.endTime = performance.now();
  }
}

export function pruneTraces(maxAge = 100) {
  const ids = Array.from(TRACES.keys());
  if (ids.length > maxAge) {
    const toRemove = ids.slice(0, ids.length - maxAge);
    for (const id of toRemove) TRACES.delete(id);
  }
}

export function formatTraceSummary(generationId) {
  const trace = TRACES.get(generationId);
  if (!trace) return 'No trace';
  const lines = trace.entries.map(e => {
    const ms = e.elapsed.toFixed(0);
    return `[GEN-${generationId}] ${e.stageId} / ${e.moduleId} ${e.status} ${e.detail ? '(' + e.detail + ')' : ''}${e.error ? ' ERROR=' + e.error : ''} +${ms}ms`;
  });
  return lines.join('\n');
}
