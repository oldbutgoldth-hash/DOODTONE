/**
 * core/single-image/white-balance-intelligence/skin-consistency-validator.js
 *
 * EPIC 2E-P1H — skin evidence VALIDATES, never DICTATES, White
 * Balance (per spec). This module decides whether the already-
 * computed skin-warmth evidence is trustworthy enough to corroborate
 * (raise confidence in) a WB reading, and explicitly rejects samples
 * that look saturated/costume-lit/too-small-to-trust.
 *
 * PROXY note (documented per project convention -- see
 * P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md §9): this pipeline has no
 * dedicated per-pixel saturated-makeup/costume-lit/clipped-skin
 * detector. Trustworthiness is approximated from the real fields that
 * DO exist -- skin coverage percentage and the skin-warmth estimator's
 * own confidence (core/whitebalance-engine's _skinRefinement()) -- and
 * this approximation is stated explicitly rather than presented as a
 * precise pixel-level check. This module never alters P1E's own skin
 * HSL protection (a completely separate module/field).
 */

const MIN_COVERAGE_PCT = 3;      // below this, a skin sample is too small to trust (single stray pixel cluster)
const MIN_WARMTH_CONFIDENCE = 0.45; // below this, the skin-warmth read itself is too uncertain to use as corroboration
const MAX_TRUSTED_MAGNITUDE = 25;   // an skin-implied temperature delta this large usually means saturated/colored light on skin, not neutral skin tone

/**
 * @param {object} wbEvidence  output of extractWBEvidence().evidence
 * @returns {{trusted:boolean, confidence:number, reason:string}}
 */
export function validateSkinConsistency(wbEvidence) {
  if (!wbEvidence) return { trusted: false, confidence: 0, reason: 'no evidence' };
  const raw = wbEvidence._raw ?? {};
  const skinWarmth = raw.wbIntent?.skinWarmth ?? null;
  const coveragePct = raw.skinCoveragePct;

  if (coveragePct == null || coveragePct < MIN_COVERAGE_PCT) {
    return { trusted: false, confidence: 0, reason: coveragePct == null ? 'no skin evidence available' : `skin coverage too small to trust (${coveragePct}% < ${MIN_COVERAGE_PCT}%)` };
  }
  if (!skinWarmth || skinWarmth.direction === 'unknown' || (skinWarmth.confidence ?? 0) < MIN_WARMTH_CONFIDENCE) {
    return { trusted: false, confidence: wbEvidence.skinConsistencyConfidence ?? 0, reason: 'skin-warmth estimate confidence too low to corroborate WB' };
  }
  if ((skinWarmth.magnitude ?? 0) > MAX_TRUSTED_MAGNITUDE) {
    return { trusted: false, confidence: wbEvidence.skinConsistencyConfidence ?? 0, reason: `skin-implied temperature shift too large (${skinWarmth.magnitude}) -- likely saturated makeup, costume lighting, or a clipped sample rather than neutral skin tone` };
  }

  return { trusted: true, confidence: wbEvidence.skinConsistencyConfidence ?? 0, reason: `skin evidence corroborates a ${skinWarmth.direction} reading (confidence ${skinWarmth.confidence})` };
}
