/**
 * core/calibration-lab/bounded-lru-cache.js
 *
 * EPIC 2E-K-R2 -- REAL PIXEL COMPARISON
 *
 * A tiny, generic, fully pure bounded LRU cache with zero DOM/browser
 * dependency -- factored out specifically so its eviction/recency
 * behavior is Node-testable in isolation, following this project's
 * established "pure logic vs. browser-only orchestrator" split (see
 * core/calibration-lab/run-comparison-pipeline.js's own pure
 * extractors vs. its browser-only pipeline function).
 *
 * Used by ui/calibration-lab/calibration-lab-controller.js to bound
 * how many decoded <img> elements + transient Render Plans are kept in
 * memory for the live pixel-comparison feature -- but this module
 * itself knows nothing about images, Render Plans, or object URLs; it
 * is a plain key/value LRU with an optional eviction callback.
 */

/**
 * @param {number} maxSize Maximum number of entries retained. Must be >= 1.
 * @param {{ onEvict?: (value: any, key: any) => void }} [options]
 *   `onEvict` is called synchronously for every entry removed by
 *   capacity eviction OR by `clear()` -- never for a `set()` that
 *   merely overwrites an existing key's value (that case fires
 *   `onEvict` too, for the OLD value, since it is genuinely being
 *   replaced/discarded).
 */
export function createBoundedLruCache(maxSize, { onEvict } = {}) {
  const safeMax = Number.isFinite(maxSize) && maxSize >= 1 ? Math.floor(maxSize) : 1;
  const map = new Map();

  function _fireEvict(value, key) {
    if (typeof onEvict === 'function') {
      try { onEvict(value, key); } catch { /* an eviction callback failure must never break the cache */ }
    }
  }

  /** Inserts/overwrites `key`. If `key` already existed, its OLD value is evicted (onEvict fires for it) before the new value is stored. Marks `key` as most-recently-used. Then evicts the least-recently-used entries beyond `maxSize`. */
  function set(key, value) {
    if (map.has(key)) {
      const old = map.get(key);
      map.delete(key);
      if (old !== value) _fireEvict(old, key);
    }
    map.set(key, value);
    while (map.size > safeMax) {
      const oldestKey = map.keys().next().value;
      const oldestVal = map.get(oldestKey);
      map.delete(oldestKey);
      _fireEvict(oldestVal, oldestKey);
    }
  }

  /** Returns the value for `key`, or `undefined` if absent. A hit marks `key` as most-recently-used (moves it to the end of iteration order). */
  function get(key) {
    if (!map.has(key)) return undefined;
    const val = map.get(key);
    map.delete(key);
    map.set(key, val);
    return val;
  }

  function has(key) { return map.has(key); }

  /** Removes every entry, firing `onEvict` for each one (in insertion/recency order). */
  function clear() {
    for (const [k, v] of map.entries()) _fireEvict(v, k);
    map.clear();
  }

  function size() { return map.size; }

  /** Keys in least-recently-used-first order -- exposed for tests only (never used by production logic, which only ever needs get/set/has/clear/size). */
  function _keysOldestFirst() { return [...map.keys()]; }

  return { set, get, has, clear, size, maxSize: safeMax, _keysOldestFirst };
}
