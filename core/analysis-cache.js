const referenceAnalysisCache = new Map();
const targetAnalysisCache = new Map();

let _hits = 0;
let _misses = 0;

function buildKey(filePath, imageId, dimensions, profileVersion) {
  return `${filePath}:${imageId}:${dimensions}:${profileVersion}`;
}

export function getCachedReferenceAnalysis({ filePath, imageId, dimensions, profileVersion }) {
  const key = buildKey(filePath, imageId, dimensions, profileVersion);
  const hit = referenceAnalysisCache.get(key);
  if (hit) _hits++;
  else _misses++;
  return hit?.value || null;
}

export function setCachedReferenceAnalysis({ filePath, imageId, dimensions, profileVersion }, value) {
  const key = buildKey(filePath, imageId, dimensions, profileVersion);
  referenceAnalysisCache.set(key, { value, ts: Date.now() });
  return value;
}

export function getCachedTargetAnalysis({ filePath, imageId, dimensions, profileVersion }) {
  const key = buildKey(filePath, imageId, dimensions, profileVersion);
  const hit = targetAnalysisCache.get(key);
  if (hit) _hits++;
  else _misses++;
  return hit?.value || null;
}

export function setCachedTargetAnalysis({ filePath, imageId, dimensions, profileVersion }, value) {
  const key = buildKey(filePath, imageId, dimensions, profileVersion);
  targetAnalysisCache.set(key, { value, ts: Date.now() });
  return value;
}

export function clearCaches() {
  referenceAnalysisCache.clear();
  targetAnalysisCache.clear();
  _hits = 0;
  _misses = 0;
}

export function invalidateTargetCache() {
  targetAnalysisCache.clear();
}

export function getCacheStats() {
  return { hits: _hits, misses: _misses, refSize: referenceAnalysisCache.size, tgtSize: targetAnalysisCache.size };
}
