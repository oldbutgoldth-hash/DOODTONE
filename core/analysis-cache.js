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

/* ── EPIC 2E-P0.7 R6 — four separate evidence caches ──────────────────
 *
 * The two caches above are untouched (additive-only) and keep working
 * exactly as before for any caller still using the R5-era API.
 *
 * R6 splits evidence caching into four independent stores so a FAST
 * (cheap, first-preview) analysis and a REFINED (heavy, deferred)
 * analysis for the same image never collide or get confused with each
 * other, and so Reference/Target stay independent:
 *
 *   referenceFastEvidence      referenceRefinedEvidence
 *   targetFastEvidence         targetRefinedEvidence
 *
 * Key formula deliberately includes an image fingerprint, dimensions,
 * proxy dimensions, the analysis profile name, and an engine version —
 * and just as deliberately EXCLUDES the output-strength slider's
 * current value, exactly like the original two caches above. That
 * value must never appear in an analysis-cache key: it does not change
 * what the Core analysis of the ORIGINAL Reference/Target pixels
 * finds, only how the resulting candidate is subsequently graded. */

const FOUR_STORE_NAMES = Object.freeze([
  'referenceFastEvidence',
  'targetFastEvidence',
  'referenceRefinedEvidence',
  'targetRefinedEvidence',
]);

const _fourStores = {
  referenceFastEvidence: new Map(),
  targetFastEvidence: new Map(),
  referenceRefinedEvidence: new Map(),
  targetRefinedEvidence: new Map(),
};
const _fourStats = {
  referenceFastEvidence: { hits: 0, misses: 0 },
  targetFastEvidence: { hits: 0, misses: 0 },
  referenceRefinedEvidence: { hits: 0, misses: 0 },
  targetRefinedEvidence: { hits: 0, misses: 0 },
};

function _assertStoreName(storeName) {
  if (!FOUR_STORE_NAMES.includes(storeName)) {
    throw new Error(`Unknown analysis-cache store: ${storeName}. Expected one of ${FOUR_STORE_NAMES.join(', ')}`);
  }
}

/**
 * Build the R6 four-store cache key. The output-strength slider value
 * is intentionally not a parameter of this function — it must never be
 * able to leak into an evidence-cache key by accident.
 */
export function buildEvidenceCacheKey({ fingerprint, dimensions, proxyDimensions, profile, engineVersion = 'v1' }) {
  return `${fingerprint}:${dimensions}:${proxyDimensions}:${profile}:${engineVersion}`;
}

export function getEvidenceCache(storeName, keyParts) {
  _assertStoreName(storeName);
  const key = buildEvidenceCacheKey(keyParts);
  const hit = _fourStores[storeName].get(key);
  if (hit) _fourStats[storeName].hits++; else _fourStats[storeName].misses++;
  return hit?.value ?? null;
}

export function setEvidenceCache(storeName, keyParts, value) {
  _assertStoreName(storeName);
  const key = buildEvidenceCacheKey(keyParts);
  _fourStores[storeName].set(key, { value, ts: Date.now() });
  return value;
}

export function clearEvidenceCaches() {
  for (const storeName of FOUR_STORE_NAMES) {
    _fourStores[storeName].clear();
    _fourStats[storeName] = { hits: 0, misses: 0 };
  }
}

export function getEvidenceCacheStats() {
  const out = {};
  for (const storeName of FOUR_STORE_NAMES) {
    out[storeName] = { ..._fourStats[storeName], size: _fourStores[storeName].size };
  }
  return out;
}
