/**
 * EPIC 2E-P1B — Confidence Aggregator
 *
 * Normalizes and conservatively combines confidence signals from
 * multiple Core evidence entries into the report's {score, level}
 * shape. This module never inflates missing or low-confidence
 * evidence and never invents a value — a missing input is treated as
 * UNAVAILABLE, not as 0 folded into an average.
 *
 * ── Aggregation method (documented per P1B spec "must be documented") ──
 * 1. Each input confidence is normalized to a 0-100 score. Core
 *    modules in this project return confidence as either a 0-1 float
 *    (most engines) or already 0-100 — normalizeConfidenceValue()
 *    detects which by range and never double-scales.
 * 2. `combineConservative(scores)` computes the arithmetic mean of the
 *    available scores, then applies a disagreement penalty equal to
 *    `min(20, stddev)` subtracted from the mean — sources that
 *    disagree pull the combined confidence DOWN, never up. The result
 *    is then capped at the MINIMUM individual score + 15, so several
 *    weak sources can never average into a falsely high confidence.
 * 3. `level` thresholds (documented, adjustable in one place only):
 *      score === null        -> UNAVAILABLE
 *      score >= 75            -> HIGH
 *      score >= 50            -> MEDIUM
 *      score >= 1              -> LOW
 *      score === 0 (genuine)   -> LOW (never silently promoted)
 */

export const CONFIDENCE_THRESHOLDS = Object.freeze({ HIGH: 75, MEDIUM: 50, LOW: 0 });

/** Normalize a raw Core confidence value (0-1 float OR 0-100 already) to 0-100. Returns null if not a usable number. */
export function normalizeConfidenceValue(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  // Values > 1 are already on a 0-100-ish scale in this codebase (none
  // of the real engines return >1 today, but this guards forward
  // compatibility without ever inventing a scale factor guess).
  const score = raw <= 1 ? raw * 100 : raw;
  return +Math.max(0, Math.min(100, score)).toFixed(1);
}

/** Build the report's {score, level} confidence shape from ONE normalized 0-100 score (or null). */
export function levelFromScore(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return { score: null, level: 'UNAVAILABLE' };
  }
  const clamped = Math.max(0, Math.min(100, score));
  let level;
  if (clamped >= CONFIDENCE_THRESHOLDS.HIGH) level = 'HIGH';
  else if (clamped >= CONFIDENCE_THRESHOLDS.MEDIUM) level = 'MEDIUM';
  else level = 'LOW';
  return { score: +clamped.toFixed(1), level };
}

/** Build a {score, level} confidence directly from one raw Core confidence value. */
export function confidenceFromRaw(raw) {
  return levelFromScore(normalizeConfidenceValue(raw));
}

function _stddev(values, mean) {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Conservatively combine multiple raw (0-1 or 0-100) confidence values.
 * Missing/non-numeric entries are dropped, not zero-filled. Returns
 * the report {score, level} shape. Empty input -> UNAVAILABLE.
 */
export function combineConservative(rawValues) {
  const scores = (rawValues || [])
    .map(normalizeConfidenceValue)
    .filter((v) => v !== null);
  if (scores.length === 0) return { score: null, level: 'UNAVAILABLE' };

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const disagreementPenalty = Math.min(20, _stddev(scores, mean));
  const minScore = Math.min(...scores);
  const combined = Math.min(mean - disagreementPenalty, minScore + 15);
  return levelFromScore(Math.max(0, combined));
}

/** True if a confidence value genuinely reflects zero evidence weight
 * (as opposed to null/UNAVAILABLE, which means "not measured at all"). */
export function isGenuineZero(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) && raw === 0;
}
