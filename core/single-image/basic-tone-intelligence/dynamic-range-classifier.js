/**
 * core/single-image/basic-tone-intelligence/dynamic-range-classifier.js
 *
 * EPIC 2E-P1F — classifies the image's dynamic-range / tonal
 * character from REAL histogram-engine evidence only
 * (session.evidence.stats) -- never from filename, UI state, or
 * category label alone. Skin protection is checked as a structural
 * signal (skinCoveragePct/skinConfidence passed through to the
 * caller), but does NOT itself change the classification -- scene
 * class here describes the image's TONAL structure; skin-aware
 * dampening is applied later by the individual planners and by
 * basic-tone-guardrails.js, matching this project's "skin protection
 * has structural priority but is a separate concern from scene
 * classification" convention (see creative-tone-strategy.js for the
 * analogous P1E pattern).
 */

import { SCENE_CLASS, MIN_EVIDENCE_CONFIDENCE, HAZE_CONTRAST_RATIO_MAX, HAZE_SAT_PCT_MAX, HAZE_MIN_CONFIDENCE } from './basic-tone-schema.js';

/**
 * @param {object} params
 * @param {object|null} params.stats  histogram-engine result (avgLum, contrast, drStops,
 *   contrastRatio, clipHiPct, clipLoPct, blackPoint, whitePoint, avgSatPct, confidence)
 * @param {object|null} [params.skin] { coveragePct, confidence } -- passthrough only
 * @returns {{sceneClass:string, confidence:number, reasons:string[], signalsUsed:object}}
 */
export function classifyDynamicRange({ stats, skin = null } = {}) {
  const reasons = [];
  const signalsUsed = {
    avgLum: stats?.avgLum ?? null, contrast: stats?.contrast ?? null,
    drStops: stats?.drStops ?? null, contrastRatio: stats?.contrastRatio ?? null,
    clipHiPct: stats?.clipHiPct ?? null, clipLoPct: stats?.clipLoPct ?? null,
    blackPoint: stats?.blackPoint ?? null, whitePoint: stats?.whitePoint ?? null,
    avgSatPct: stats?.avgSatPct ?? null, statsConfidence: stats?.confidence ?? null,
    skinCoveragePct: skin?.coveragePct ?? null, skinConfidence: skin?.confidence ?? null,
  };

  // Accept a minimal/synthetic stats shape (avgLum + confidence only --
  // the same minimal fixture shape this project's other evidence-
  // consuming modules, e.g. P1E's deriveColorSignals(), already handle
  // gracefully) -- `total` is only used as an explicit "definitely no
  // real pixels" signal, never required for a usable classification.
  if (!stats || typeof stats.avgLum !== 'number' || stats.total === 0) {
    reasons.push('no usable histogram-engine evidence (missing/empty stats) -- classified LOW_CONFIDENCE.');
    return { sceneClass: SCENE_CLASS.LOW_CONFIDENCE, confidence: 0, reasons, signalsUsed };
  }

  const statsConf = typeof stats.confidence === 'number' ? stats.confidence : 0;
  if (statsConf < MIN_EVIDENCE_CONFIDENCE) {
    reasons.push(`histogram-engine confidence ${statsConf} below minimum ${MIN_EVIDENCE_CONFIDENCE} -- classified LOW_CONFIDENCE.`);
    return { sceneClass: SCENE_CLASS.LOW_CONFIDENCE, confidence: statsConf, reasons, signalsUsed };
  }

  const { avgLum, contrast: sigma, drStops = 0, contrastRatio = 1, clipHiPct = 0, clipLoPct = 0, avgSatPct = 0 } = stats;

  // ── Severe exposure classes first (clipping-backed, highest priority) ──
  if (avgLum < 70 && clipLoPct > 3) {
    reasons.push(`avgLum ${avgLum} with ${clipLoPct}% shadow clipping -- UNDEREXPOSED.`);
    return { sceneClass: SCENE_CLASS.UNDEREXPOSED, confidence: statsConf, reasons, signalsUsed };
  }
  if (avgLum > 190 && clipHiPct > 3) {
    reasons.push(`avgLum ${avgLum} with ${clipHiPct}% highlight clipping -- OVEREXPOSED.`);
    return { sceneClass: SCENE_CLASS.OVEREXPOSED, confidence: statsConf, reasons, signalsUsed };
  }

  // ── High dynamic range (both ends genuinely populated, wide spread) ──
  if (drStops >= 9.5) {
    reasons.push(`drStops ${drStops}EV -- HIGH_DYNAMIC_RANGE.`);
    return { sceneClass: SCENE_CLASS.HIGH_DYNAMIC_RANGE, confidence: statsConf, reasons, signalsUsed };
  }

  // ── Hazy (proxy: narrow contrast ratio + desaturated + not already
  //    covered by a more specific class above) ──
  if (contrastRatio <= HAZE_CONTRAST_RATIO_MAX && avgSatPct <= HAZE_SAT_PCT_MAX && statsConf >= HAZE_MIN_CONFIDENCE && drStops < 9.5 && drStops >= 2) {
    reasons.push(`contrastRatio ${contrastRatio} <= ${HAZE_CONTRAST_RATIO_MAX} and avgSatPct ${avgSatPct}% <= ${HAZE_SAT_PCT_MAX}% -- HAZY (proxy evidence, no dedicated haze sensor).`);
    return { sceneClass: SCENE_CLASS.HAZY, confidence: statsConf, reasons, signalsUsed };
  }

  // ── High-key / low-key (avgLum + black/white point evidence) ──
  if (avgLum > 165 && clipHiPct <= 3) {
    reasons.push(`avgLum ${avgLum} without significant clipping -- HIGH_KEY (bright but not overexposed).`);
    return { sceneClass: SCENE_CLASS.HIGH_KEY, confidence: statsConf, reasons, signalsUsed };
  }
  if (avgLum < 90 && clipLoPct <= 3) {
    reasons.push(`avgLum ${avgLum} without significant clipping -- LOW_KEY (dark but not underexposed).`);
    return { sceneClass: SCENE_CLASS.LOW_KEY, confidence: statsConf, reasons, signalsUsed };
  }

  // ── Contrast spread classes ──
  if (sigma > 68) {
    reasons.push(`contrast sigma ${sigma} -- HIGH_CONTRAST.`);
    return { sceneClass: SCENE_CLASS.HIGH_CONTRAST, confidence: statsConf, reasons, signalsUsed };
  }
  if (sigma < 38) {
    reasons.push(`contrast sigma ${sigma} -- LOW_CONTRAST.`);
    return { sceneClass: SCENE_CLASS.LOW_CONTRAST, confidence: statsConf, reasons, signalsUsed };
  }

  reasons.push(`avgLum ${avgLum}, sigma ${sigma}, drStops ${drStops} all within normal ranges -- BALANCED.`);
  return { sceneClass: SCENE_CLASS.BALANCED, confidence: statsConf, reasons, signalsUsed };
}
