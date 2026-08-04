/**
 * core/single-image/white-balance-intelligence/illuminant-object-bias-separator.js
 *
 * EPIC 2E-P1H — the spec's "central requirement": distinguish a
 * scene-wide illuminant cast from a strongly-colored OBJECT in the
 * frame (green foliage, a red/pink costume, a blue wall). An object
 * color should never force a strong opposite-direction Temperature/
 * Tint correction.
 *
 * Reuses the real per-zone measurement (center = likely subject,
 * border = likely background) from core/color-cast-detector, already
 * extracted into evidence.bgObjectColorRisk by wb-evidence-extractor.js.
 * This module turns that raw signal into a final, explainable score +
 * boolean + reason, and generalizes the existing green-only
 * bgGreenDominant flag (whitebalance-engine only ever attenuates for
 * GREEN background dominance) to any strongly-colored, spatially-
 * separated background cast -- the concrete gap identified in
 * P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md §8.
 */

function _clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/**
 * @param {object} wbEvidence  output of extractWBEvidence().evidence
 * @returns {{score:number, isObjectColorBias:boolean, reason:string}}
 */
export function separateIlluminantFromObjectBias(wbEvidence) {
  if (!wbEvidence) return { score: 0, isObjectColorBias: false, reason: 'no evidence' };

  const raw = wbEvidence._raw ?? {};
  const bgGreenDominant = !!raw.bgGreenDominant;
  const subjectNeutral = !!raw.subjectNeutral;
  const centerLabel = raw.centerLabel;
  const borderLabel = raw.borderLabel;

  let score = _clamp01(wbEvidence.bgObjectColorRisk ?? 0);
  const notes = [];

  if (bgGreenDominant && subjectNeutral) {
    notes.push('background reads green while the subject/center zone is neutral -- classic foliage/plant background, not a scene illuminant');
  } else if (bgGreenDominant) {
    notes.push('background reads green-dominant');
  }
  if (centerLabel === 'neutral' && borderLabel && borderLabel !== 'neutral' && borderLabel !== 'green') {
    // Generalization: the SAME spatial-separation logic that already
    // protects against a green background is extended here to any
    // non-neutral border label (warm/cool/magenta) paired with a
    // neutral center -- e.g. a red/pink costume or a colored wall
    // filling the border/background zone while the subject itself
    // reads neutral.
    notes.push(`background reads "${borderLabel}" while the subject/center zone is neutral -- likely a strongly-colored object/background, not scene-wide illuminant`);
  }

  const isObjectColorBias = score > 0.5;
  const reason = notes.length
    ? notes.join('; ')
    : 'no spatial center/border cast separation evidence suggesting an object-color bias';

  return { score: +score.toFixed(3), isObjectColorBias, reason };
}
