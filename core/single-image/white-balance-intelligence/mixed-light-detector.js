/**
 * core/single-image/white-balance-intelligence/mixed-light-detector.js
 *
 * EPIC 2E-P1H — detects shadow/highlight illuminant mismatch (mixed
 * lighting) using the REAL per-zone tonal cast already measured by
 * core/color-cast-detector (evidence.shadowCastLabel/highlightCastLabel)
 * and cross-referenced against whitebalance-engine's own
 * wbIntent.mixedLightingRisk (same underlying signal, computed
 * upstream -- reused, not re-derived). When mixed lighting is likely,
 * this module signals that global correction should be reduced (never
 * aggressively neutralized) and surfaces the exact bilingual
 * diagnostic string the spec requires.
 */

const MIXED_LIGHT_MESSAGE = Object.freeze({
  th: 'ตรวจพบแสงหลายอุณหภูมิ ระบบจึงปรับสมดุลสีขาวแบบระมัดระวัง',
  en: 'Mixed lighting detected; white-balance correction was kept conservative.',
});

function _clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/**
 * @param {object} wbEvidence  output of extractWBEvidence().evidence
 * @returns {{isMixedLight:boolean, score:number, message:{th:string,en:string}|null, reason:string}}
 */
export function detectMixedLight(wbEvidence) {
  if (!wbEvidence) return { isMixedLight: false, score: 0, message: null, reason: 'no evidence' };

  const shadow = wbEvidence.shadowCastLabel;
  const highlight = wbEvidence.highlightCastLabel;
  const engineRisk = _clamp01(wbEvidence.mixedLightingRisk ?? 0);

  const zonesDisagree = shadow !== 'unknown' && highlight !== 'unknown' &&
    shadow !== highlight && shadow !== 'neutral' && highlight !== 'neutral';

  const score = zonesDisagree ? Math.max(engineRisk, 0.5) : engineRisk;
  const isMixedLight = score > 0.3;

  return {
    isMixedLight,
    score: +score.toFixed(3),
    message: isMixedLight ? MIXED_LIGHT_MESSAGE : null,
    reason: zonesDisagree
      ? `shadow zone reads "${shadow}" while highlight zone reads "${highlight}" -- non-uniform cast across the tonal range`
      : (engineRisk > 0 ? 'whitebalance-engine flagged mixed-lighting risk from its own shadow/highlight bias comparison' : 'no mixed-lighting signature detected'),
  };
}

export { MIXED_LIGHT_MESSAGE };
