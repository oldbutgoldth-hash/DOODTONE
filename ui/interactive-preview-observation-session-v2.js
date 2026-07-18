/**
 * ui/interactive-preview-observation-session-v2.js
 *
 * EPIC 2E-J Phase B — an in-memory, UI-local session summary for the
 * Preview Observation layer. Aggregates AT MOST ONE active record per
 * analysis generation across the current page session. Disappears on
 * page reload by design — no persistence, no network, no user
 * identity, no image data of any kind is ever stored here.
 *
 * This module is a pure aggregator: it never reads or writes
 * finalStyleIntent, Mapping, XMP, Decision Report, Reference Transfer,
 * Review State, or Controlled Activation. It has zero awareness of
 * production output.
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

function _normalizeReasons(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!VALID_REASONS.includes(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= 5) break;
  }
  return out;
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
  // each entry holds at most ONE record per generation (upsert model).
  const records = new Map();
  let sequence = 0; // deterministic insertion order, independent of wall-clock
  let disposed = false;

  function _safeGenerationKey(generationId) {
    if (generationId === null || generationId === undefined) return null;
    if (typeof generationId === 'string' || typeof generationId === 'number' || typeof generationId === 'boolean') {
      return `${typeof generationId}:${generationId}`;
    }
    return null; // non-primitive generation IDs are never used as a map key
  }

  function _evictIfOverBound() {
    if (records.size <= MAX_RECORDS) return;
    // Discard the oldest INACTIVE record first; if none exist, discard
    // the oldest record overall (by insertion/sequence order).
    let oldestInactiveKey = null, oldestInactiveSeq = Infinity;
    let oldestKey = null, oldestSeq = Infinity;
    for (const [key, rec] of records) {
      if (rec.seq < oldestSeq) { oldestSeq = rec.seq; oldestKey = key; }
      if (rec.status !== 'active' && rec.seq < oldestInactiveSeq) { oldestInactiveSeq = rec.seq; oldestInactiveKey = key; }
    }
    const evictKey = oldestInactiveKey ?? oldestKey;
    if (evictKey !== null) records.delete(evictKey);
  }

  /**
   * Upserts the active record for a generation. Never creates a
   * duplicate record for the same generation — updates in place.
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
    const reasons = _normalizeReasons(safeGet(rec, 'reasons'));

    const existing = records.get(key);
    const now = _safeNow();
    if (existing && existing.status === 'active') {
      existing.observation = observation;
      existing.reasons = reasons;
      existing.updatedAt = now;
    } else {
      records.set(key, {
        generationId, observation, reasons,
        createdAt: now, updatedAt: now, status: 'active', seq: sequence++,
      });
    }
    _evictIfOverBound();
  }

  /**
   * Marks the current generation's record as cleared (user explicitly
   * cleared the Observation). Idempotent — clearing an already-cleared
   * or absent record for this generation is a safe no-op (never
   * double-counts).
   */
  function removeObservation(generationId) {
    if (disposed) return;
    const key = _safeGenerationKey(generationId);
    if (key === null) return;
    const existing = records.get(key);
    if (!existing || existing.status !== 'active') return; // idempotent: already non-active, or never recorded
    existing.status = 'cleared';
    existing.updatedAt = _safeNow();
  }

  /**
   * Marks the current generation's record as invalidated (a newer
   * analysis superseded it, or the comparison stopped being Ready/was
   * safety-blocked). Idempotent per generation.
   */
  function invalidateGeneration(generationId) {
    if (disposed) return;
    const key = _safeGenerationKey(generationId);
    if (key === null) return;
    const existing = records.get(key);
    if (!existing || existing.status !== 'active') return; // idempotent
    existing.status = 'invalidated';
    existing.updatedAt = _safeNow();
  }

  /** Clears all session records. Per this phase's documented policy: the caller may immediately re-record the current valid Observation afterward (see ui/app.js integration) so the summary never misleadingly shows zero while a current selection is visible. */
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

    let lastRecord = null;
    for (const rec of records.values()) {
      summary.totalObserved++;
      if (rec.status === 'active') {
        summary.activeObservations++;
        if (rec.observation === 'prefer-legacy') summary.preferLegacy++;
        else if (rec.observation === 'prefer-v2') summary.preferV2++;
        else if (rec.observation === 'no-visible-difference') summary.noVisibleDifference++;
        else if (rec.observation === 'unsure') summary.unsure++;
        for (const reason of rec.reasons) {
          const field = REASON_FIELD_MAP[reason];
          if (field) summary.reasonCounts[field]++;
        }
        if (!lastRecord || rec.seq > lastRecord.seq) lastRecord = rec;
      } else if (rec.status === 'cleared') {
        summary.cleared++;
      } else if (rec.status === 'invalidated') {
        summary.invalidated++;
      }
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

    if (lastRecord) {
      summary.lastObservation = { generationId: lastRecord.generationId, observation: lastRecord.observation, reasons: lastRecord.reasons.slice() };
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
