/**
 * EPIC 2E-P1A — Single Image Analysis Cache
 *
 * A dedicated, in-memory evidence cache for the SINGLE_IMAGE workflow.
 * This is deliberately a SEPARATE module from `core/analysis-cache.js`
 * — that file's own exports (`getCachedReferenceAnalysis`,
 * `getCachedTargetAnalysis`, `getEvidenceCache`/`setEvidenceCache`)
 * are confirmed (P1A_SOURCE_LINEAGE_AUDIT.md §10) to exist solely for
 * the two-image Reference Color Match workflow, with
 * `ui/reference-color-match-panel.js` as their only consumer. Per the
 * spec's "Reference Color Match Isolation" requirement, this file
 * does not import from or mutate that module in any way.
 *
 * Cache key inputs (spec-required): image fingerprint, profile
 * version, engine version, analysis proxy size. Deliberately EXCLUDED
 * from the key: open UI tab, report section, XMP generation status,
 * download action, slider visibility — none of those may affect
 * whether cached evidence is considered reusable.
 */

const _store = new Map();

/**
 * @param {object} parts
 * @param {string} parts.fingerprint
 * @param {string} parts.profileVersion
 * @param {string} parts.engineVersion
 * @param {number} [parts.proxySize]
 * @returns {string} a deterministic cache key
 */
export function computeCacheKey({ fingerprint, profileVersion, engineVersion, proxySize = 0 }) {
  if (!fingerprint) throw new Error('computeCacheKey: fingerprint is required');
  if (!profileVersion) throw new Error('computeCacheKey: profileVersion is required');
  if (!engineVersion) throw new Error('computeCacheKey: engineVersion is required');
  return `${fingerprint}::${profileVersion}::${engineVersion}::${proxySize}`;
}

/**
 * @returns {object|null} a shallow copy of the cached evidence bundle,
 * or null on a cache miss (missing key or incompatible entry).
 */
export function readCompatibleEvidence(cacheKey) {
  const entry = _store.get(cacheKey);
  if (!entry) return null;
  return { ...entry, evidence: { ...entry.evidence } };
}

/**
 * Store a COMPLETED (or PARTIAL) Session's evidence bundle under the
 * given cache key. Only call this once a Session has reached a
 * terminal, cacheable status — never mid-analysis.
 */
export function writeCompletedEvidence(cacheKey, evidence, meta = {}) {
  _store.set(cacheKey, {
    evidence: { ...evidence },
    cachedAt: Date.now(),
    ...meta,
  });
  return cacheKey;
}

/** Drop every cache entry whose key does not carry the given profile/engine version pair. */
export function invalidateIncompatible(profileVersion, engineVersion) {
  let removed = 0;
  for (const key of _store.keys()) {
    const parts = key.split('::');
    const [, keyProfile, keyEngine] = parts;
    if (keyProfile !== profileVersion || keyEngine !== engineVersion) {
      _store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function clearSingleImageAnalysisCache() {
  const size = _store.size;
  _store.clear();
  return size;
}

export function getSingleImageAnalysisCacheStats() {
  return { entries: _store.size, keys: [..._store.keys()] };
}
