/**
 * ui/interactive-preview-observation-session-v2.js
 *
 * EPIC 2E-J Phase B (+ EPIC 2E-J-B-F correctness patch) — an in-memory,
 * UI-local session summary for the Preview Observation layer.
 * Aggregates AT MOST ONE record per analysis generation across the
 * current page session. Disappears on page reload by design — no
 * persistence, no network, no user identity, no image data of any kind
 * is ever stored here.
 *
 * This module is a pure aggregator: it never reads or writes
 * finalStyleIntent, Mapping, XMP, Decision Report, Reference Transfer,
 * Review State, or Controlled Activation. It has zero awareness of
 * production output.
 *
 * FIX 4 (EPIC 2E-J-B-F): the record model tracks LIFECYCLE EVENTS
 * (`clearedCounted`/`invalidatedCounted`) separately from the CURRENT
 * `active` flag, rather than a single mutually-exclusive status. This
 * means a generation can be simultaneously "currently active" AND
 * "historically cleared" (if the person cleared it once, then made a
 * new selection) — the lifecycle event counts survive an explicit
 * later reselection, matching real usage.
 */

const VALID_OBSERVATIONS = ['prefer-legacy', 'prefer-v2', 'no-visible-difference', 'unsure'];
const VALID_REASONS = [
  'skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail', 'contrast',
  'color-balance', 'saturation', 'natural-look', 'clarity-detail', 'no-specific-reason',
];
const REASON_FIELD_MAP = {
  'skin-tone': 'skinTone', 'white-balance': 'whiteBalance', 'highlight-detail': 'highlightDetail',
  'shadow-detail': 'shadowDetail', contrast: 'contrast', 'color-balance': 'colorBalance',
  saturation: 'saturation', 'natural-look': 'naturalLook', 'clarity-detail': 'clarityDetail',
  'no-specific-reason': 'noSpecificReason',
};
const MAX_RECORDS = 100;
const REASON_LIMIT = 5;

function safeGet(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

function _isRecord(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function _normalizeObservation(value) {
  return VALID_OBSERVATIONS.includes(value) ? value : null;
}

// FIX 7 (EPIC 2E-J-B-F): a safe bounded projection of an untrusted
// array — never `.slice()`/`for...of`/spread/`.map()` directly on
// caller-supplied input. Safe-reads `.length` once, clamps to 32,
// safe-reads each index once (skipping a hostile getter that throws).
function _safeBoundedArray(input, maxLen = 32) {
  if (!Array.isArray(input)) return [];
  let length;
  try {
    length = input.length;
  } catch {
    return [];
  }
  if (!Number.isFinite(length) || length <= 0) return [];
  const bound = Math.min(Math.floor(length), maxLen);
  const out = [];
  for (let i = 0; i < bound; i++) {
    try {
      out.push(input[i]);
    } catch {
      /* hostile index getter skipped, never crashes */
    }
  }
  return out;
}

// FIX 6 (EPIC 2E-J-B-F): the Session module independently enforces its
// own reason normalization — it never trusts that a Controller-supplied
// `reasons` array is already clean (defense in depth: exact valid
// values only, dedupe, maximum 5, `no-specific-reason` mutual
// exclusivity — specific reasons always win over the generic one when
// both are present in the same input).
function _normalizeReasons(value) {
  const bounded = _safeBoundedArray(value);
  const seen = new Set();
  const out = [];
  for (const item of bounded) {
    if (!VALID_REASONS.includes(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  if (out.length > 1 && out.includes('no-specific-reason')) {
    return out.filter((r) => r !== 'no-specific-reason').slice(0, REASON_LIMIT);
  }
  return out.slice(0, REASON_LIMIT);
}

function _safeNow() {
  try {
    const t = Date.now();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * @param {{}} options currently unused, reserved for future extension.
 */
export function createInteractivePreviewObservationSessionV2(_options) {
  // Insertion-ordered map keyed by generationId (stringified safely) —
  // each entry holds at most ONE record per generation.
  const records = new Map();
  let sequence = 0; // deterministic insertion/update order, independent of wall-clock
  let disposed = false;

  function _safeGenerationKey(generationId) {
    if (generationId === null || generationId === undefined) return null;
    if (typeof generationId === 'string' || typeof generationId === 'number' || typeof generationId === 'boolean') {
      return `${typeof generationId}:${generationId}`;
    }
    return null; // non-primitive generation IDs are never used as a map key
  }

  // FIX 9 (EPIC 2E-J-B-F): eviction uses `createdSequence` (not
  // `updatedSequence`) so that updating an existing record never
  // changes its position in creation-order eviction — only genuinely
  // NEW records shift the eviction boundary. Historical lifecycle
  // flags remain attached to whichever record is retained.
  function _evictIfOverBound() {
    if (records.size <= MAX_RECORDS) return;
    let oldestInactiveKey = null, oldestInactiveSeq = Infinity;
    let oldestKey = null, oldestSeq = Infinity;
    for (const [key, rec] of records) {
      if (rec.createdSequence < oldestSeq) { oldestSeq = rec.createdSequence; oldestKey = key; }
      if (!rec.active && rec.createdSequence < oldestInactiveSeq) { oldestInactiveSeq = rec.createdSequence; oldestInactiveKey = key; }
    }
    const evictKey = oldestInactiveKey ?? oldestKey;
    if (evictKey !== null) records.delete(evictKey);
  }

  /**
   * Upserts the record for a generation as a genuine new user
   * selection/update event: sets `active = true` with the given
   * observation/reasons. Historical `clearedCounted`/`invalidatedCounted`
   * flags are PRESERVED across this call — they are never reset by a
   * reselection, per FIX 4's lifecycle-event-count semantics. Never
   * creates more than one record per generation.
   * @param {{ generationId: any, observation: (string|null), reasons: (string[]|null) }} input
   */
  function recordObservation(input) {
    if (disposed) return;
    const rec = _isRecord(input) ? input : {};
    const generationId = safeGet(rec, 'generationId');
    const key = _safeGenerationKey(generationId);
    if (key === null) return; // no usable generation identity — nothing to record
    const observation = _normalizeObservation(safeGet(rec, 'observation'));
    if (observation === null) return; // nothing meaningful to record
    // FIX 6/7: independently normalized here, never trusting the
    // caller's array to already be clean.
    const reasons = _normalizeReasons(safeGet(rec, 'reasons'));

    const now = _safeNow();
    const existing = records.get(key);
    if (existing) {
      // FIX 5: this is only ever called from a genuine new user
      // selection/update event (never automatically on provider/context
      // recovery) — reactivating here is always a real, explicit choice.
      existing.active = true;
      existing.observation = observation;
      existing.reasons = reasons;
      existing.updatedAt = now;
      existing.updatedSequence = sequence++;
      // clearedCounted/invalidatedCounted are intentionally left
      // untouched — historical lifecycle events survive reselection.
    } else {
      const seq = sequence++;
      records.set(key, {
        generationId, active: true, observation, reasons,
        clearedCounted: false, invalidatedCounted: false,
        createdAt: now, updatedAt: now, createdSequence: seq, updatedSequence: seq,
      });
    }
    _evictIfOverBound();
  }

  /**
   * Marks the current generation's record inactive (user explicitly
   * cleared the Observation) and increments the cleared-event count
   * EXACTLY ONCE per generation — idempotent across repeated calls, and
   * the `clearedCounted` flag survives any later reselection (it is
   * never reset).
   */
  function removeObservation(generationId) {
    if (disposed) return;
    const key = _safeGenerationKey(generationId);
    if (key === null) return;
    const existing = records.get(key);
    if (!existing || !existing.active) return; // idempotent: already inactive, or never recorded
    existing.active = false;
    existing.clearedCounted = true; // sticky — never reset
    existing.updatedAt = _safeNow();
    existing.updatedSequence = sequence++;
  }

  /**
   * Marks the current generation's record inactive (a newer analysis
   * superseded it, or the comparison stopped being Ready/was
   * safety-blocked) and increments the invalidated-event count EXACTLY
   * ONCE per generation. FIX 5: this function ONLY ever sets `active`
   * to `false` — it never reactivates a record, so a Provider/Context
   * recovery can never auto-restore an old Observation through this
   * path.
   */
  function invalidateGeneration(generationId) {
    if (disposed) return;
    const key = _safeGenerationKey(generationId);
    if (key === null) return;
    const existing = records.get(key);
    if (!existing || !existing.active) return; // idempotent
    existing.active = false;
    existing.invalidatedCounted = true; // sticky — never reset
    existing.updatedAt = _safeNow();
    existing.updatedSequence = sequence++;
  }

  /** Clears all session records. Per this phase's documented policy: the caller may immediately re-record the current valid Observation afterward (see ui/app.js integration) so the summary never misleadingly shows zero while a current selection is visible. This intentionally resets ALL historical lifecycle counters — a fresh session start. */
  function clearSession() {
    if (disposed) return;
    records.clear();
  }

  /**
   * Returns a safe, copied summary snapshot. Never exposes internal
   * record references.
   */
  function getSummary() {
    const summary = {
      totalObserved: 0, activeObservations: 0,
      preferLegacy: 0, preferV2: 0, noVisibleDifference: 0, unsure: 0,
      cleared: 0, invalidated: 0,
      reasonCounts: { skinTone: 0, whiteBalance: 0, highlightDetail: 0, shadowDetail: 0, contrast: 0, colorBalance: 0, saturation: 0, naturalLook: 0, clarityDetail: 0, noSpecificReason: 0 },
      topReasons: [],
      lastObservation: null,
    };
    if (disposed) return summary;

    // FIX 8 (EPIC 2E-J-B-F): lastObservation reflects the most recently
    // UPDATED active record (by `updatedSequence`), never merely the
    // most recently CREATED generation.
    let lastActiveRecord = null;
    for (const rec of records.values()) {
      summary.totalObserved++;
      if (rec.active) {
        summary.activeObservations++;
        if (rec.observation === 'prefer-legacy') summary.preferLegacy++;
        else if (rec.observation === 'prefer-v2') summary.preferV2++;
        else if (rec.observation === 'no-visible-difference') summary.noVisibleDifference++;
        else if (rec.observation === 'unsure') summary.unsure++;
        for (const reason of rec.reasons) {
          const field = REASON_FIELD_MAP[reason];
          if (field) summary.reasonCounts[field]++;
        }
        if (!lastActiveRecord || rec.updatedSequence > lastActiveRecord.updatedSequence) lastActiveRecord = rec;
      }
      // FIX 4: cleared/invalidated counts reflect LIFECYCLE EVENTS
      // (sticky flags), independent of the record's CURRENT active
      // state — a record can be currently active AND historically
      // cleared/invalidated at the same time.
      if (rec.clearedCounted) summary.cleared++;
      if (rec.invalidatedCounted) summary.invalidated++;
    }

    // Top reasons: order by count descending, deterministic tie-break
    // using canonical VALID_REASONS order (no-specific-reason sorts
    // after every specific reason on a tie), maximum 3.
    const entries = VALID_REASONS.map((reason) => ({ reason, count: summary.reasonCounts[REASON_FIELD_MAP[reason]] })).filter((e) => e.count > 0);
    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aIsGeneric = a.reason === 'no-specific-reason';
      const bIsGeneric = b.reason === 'no-specific-reason';
      if (aIsGeneric !== bIsGeneric) return aIsGeneric ? 1 : -1;
      return VALID_REASONS.indexOf(a.reason) - VALID_REASONS.indexOf(b.reason);
    });
    summary.topReasons = entries.slice(0, 3).map((e) => ({ reason: e.reason, count: e.count }));

    if (lastActiveRecord) {
      summary.lastObservation = { generationId: lastActiveRecord.generationId, observation: lastActiveRecord.observation, reasons: lastActiveRecord.reasons.slice() };
    }

    return summary;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    records.clear();
  }

  return { recordObservation, removeObservation, invalidateGeneration, clearSession, getSummary, dispose };
}

export { VALID_REASONS };
