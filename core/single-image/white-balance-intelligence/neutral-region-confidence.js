/**
 * core/single-image/white-balance-intelligence/neutral-region-confidence.js
 *
 * EPIC 2E-P1H — how much real neutral-pixel evidence backs this WB
 * reading. Reuses whitebalance-engine's own neutral-candidate-pixel
 * scan (neutralPixelCount / wbIntent.neutralBias, already computed --
 * see core/whitebalance-engine/index.js _filterNeutralCandidates())
 * rather than re-scanning pixels. This module's job is only to turn
 * that already-measured signal into an explainable confidence + reason
 * pair for the WB Plan's diagnostics, per P1H_WHITE_BALANCE_VALUE_
 * LINEAGE_AUDIT.md §7.
 */

function _clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/**
 * @param {object} wbEvidence  output of extractWBEvidence().evidence
 * @returns {{confidence:number, reason:string}}
 */
export function neutralRegionConfidence(wbEvidence) {
  if (!wbEvidence) return { confidence: 0, reason: 'no evidence' };
  const confidence = _clamp01(wbEvidence.neutralReferenceConfidence ?? 0);
  const reason = confidence >= 0.6
    ? 'strong neutral-pixel evidence backs this reading (grey-world/white-patch/neutral-candidate sources agree)'
    : confidence >= 0.3
      ? 'moderate neutral-pixel evidence -- some real neutral reference pixels found, but coverage or source agreement is limited'
      : 'weak neutral-pixel evidence -- few or no reliable neutral reference pixels found; this reading leans on non-neutral estimators (white patch / shades of gray / skin refinement)';
  return { confidence: +confidence.toFixed(3), reason };
}
