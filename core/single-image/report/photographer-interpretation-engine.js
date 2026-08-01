/**
 * EPIC 2E-P1B — Photographer Interpretation Engine
 *
 * Converts RAW Core evidence (already normalized/committed to
 * session.evidence by P1A) into photographer-friendly report
 * sections. This module NEVER modifies Candidate values, NEVER
 * re-runs any Core module, and NEVER invents a number that isn't
 * already present in the evidence it was given.
 *
 * Text is emitted as {code, params} pairs, not hardcoded strings —
 * `ui/single-image-report-renderer.js` resolves each code through the
 * existing i18n `t()` function at render time (`report.<section>.<code>`).
 * This mirrors this project's existing domain-presenters.js convention
 * (present*Code() functions) rather than inventing a parallel one.
 *
 * Every classification function below is defensive: any missing/null
 * evidence field results in a null-safe fallback, never a thrown
 * error and never a fabricated value.
 */

import { confidenceFromRaw, combineConservative, levelFromScore } from './confidence-aggregator.js';
import { SECTION_STATUS } from './analysis-report-schema.js';

function _obs(code, params = null) { return { code, params }; }

function _num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

// ─────────────────────────────────────────────────────────────────────────
// Exposure
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classify exposure using clipping + luminance + scene context, not
 * mean luminance alone — a bright wedding image with protected
 * highlights is "high-key", not "overexposed"; a dark scene with
 * modest shadow clipping is "low-key", not automatically "incorrect".
 */
export function classifyExposure({ stats, sceneCategory } = {}) {
  if (!stats) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      exposureClassification: null, meanLuminance: null,
      clippedHighlightsPercent: null, crushedShadowsPercent: null, exposureBalance: null };
  }
  const avgLum = _num(stats.avgLum);
  const clipHi = _num(stats.clipHiPct) ?? 0;
  const clipLo = _num(stats.clipLoPct) ?? 0;
  const drStops = _num(stats.drStops);

  let exposureBalance = 'balanced';
  const observations = [];
  const recommendations = [];
  const warnings = [];

  const isPortraitLike = sceneCategory === 'Portrait' || sceneCategory === 'Wedding';

  if (clipHi > 15) {
    exposureBalance = 'overexposed';
    observations.push(_obs('exposure.highlightsClipped', { pct: clipHi }));
    recommendations.push(_obs('exposure.recoverHighlights'));
  } else if (avgLum !== null && avgLum > 180 && clipHi < 8) {
    // Bright overall AND highlights largely protected -> high-key, not a defect.
    exposureBalance = 'highKey';
    observations.push(_obs('exposure.highKeyProtected', { avgLum }));
    if (isPortraitLike) observations.push(_obs('exposure.highKeyPortraitContext'));
  } else if (clipHi > 5) {
    exposureBalance = 'slightlyOverexposed';
    observations.push(_obs('exposure.highlightsMildClipping', { pct: clipHi }));
    recommendations.push(_obs('exposure.watchHighlights'));
  } else if (clipLo > 15) {
    exposureBalance = 'underexposed';
    observations.push(_obs('exposure.shadowsClipped', { pct: clipLo }));
    recommendations.push(_obs('exposure.liftShadowsCautiously'));
  } else if (avgLum !== null && avgLum < 70 && clipLo < 8 && (drStops ?? 0) >= 3) {
    // Dark overall, shadows not badly crushed, and enough dynamic range
    // remains to suggest an intentional low-key/silhouette treatment.
    exposureBalance = 'lowKey';
    observations.push(_obs('exposure.lowKeyIntentional', { avgLum }));
  } else if (clipLo > 5) {
    exposureBalance = 'slightlyUnderexposed';
    observations.push(_obs('exposure.shadowsMildClipping', { pct: clipLo }));
    recommendations.push(_obs('exposure.watchShadows'));
  } else {
    observations.push(_obs('exposure.balancedObservation', { avgLum }));
  }

  if (clipHi > 5 && clipLo > 5) {
    warnings.push(_obs('exposure.bothEndsClipping'));
  }

  const confidence = confidenceFromRaw(stats.confidence);
  const status = confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
    : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE);

  return {
    status, confidence, observations, recommendations, warnings,
    exposureClassification: exposureBalance, meanLuminance: avgLum,
    clippedHighlightsPercent: clipHi, crushedShadowsPercent: clipLo,
    exposureBalance,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic Range
// ─────────────────────────────────────────────────────────────────────────

export function classifyDynamicRange({ stats } = {}) {
  if (!stats) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      classification: null, score: null, shadowHeadroom: null, highlightHeadroom: null };
  }
  const drStops = _num(stats.drStops);
  const blackPoint = _num(stats.blackPoint);
  const whitePoint = _num(stats.whitePoint);
  const shadowHeadroom = blackPoint !== null ? blackPoint : null;
  const highlightHeadroom = whitePoint !== null ? 255 - whitePoint : null;

  let classification = null;
  const observations = [];
  const recommendations = [];
  const warnings = [];

  if (drStops !== null) {
    if (drStops < 1.5) { classification = 'veryLow'; observations.push(_obs('dynamicRange.veryLow', { drStops })); warnings.push(_obs('dynamicRange.nearUniformWarning')); }
    else if (drStops < 4) { classification = 'low'; observations.push(_obs('dynamicRange.low', { drStops })); }
    else if (drStops < 8) { classification = 'moderate'; observations.push(_obs('dynamicRange.moderate', { drStops })); }
    else if (drStops <= 14) { classification = 'high'; observations.push(_obs('dynamicRange.high', { drStops })); }
    else { classification = 'veryHigh'; observations.push(_obs('dynamicRange.veryHigh', { drStops })); warnings.push(_obs('dynamicRange.unusuallyHighWarning')); }
  }

  if (classification === 'veryLow' || classification === 'low') {
    recommendations.push(_obs('dynamicRange.considerContrastBoost'));
  }

  const confidence = confidenceFromRaw(stats.confidence);
  const status = confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
    : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE);

  return {
    status, confidence, observations, recommendations, warnings,
    classification, score: drStops, shadowHeadroom, highlightHeadroom,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// White Balance
// ─────────────────────────────────────────────────────────────────────────

/**
 * Distinguishes: likely illuminant cast vs dominant subject/object
 * color vs creative warm/cool grade vs uncertain neutral evidence.
 * Never claims a global WB cast from background color alone.
 */
export function classifyWhiteBalance({ wb, colorCast } = {}) {
  if (!wb) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      temperatureDirection: null, tintDirection: null, neutralConfidence: { score: null, level: 'UNAVAILABLE' },
      dominantColorBias: null, illuminantConfidence: { score: null, level: 'UNAVAILABLE' } };
  }
  const temp = _num(wb.consensus?.temperature);
  const tint = _num(wb.consensus?.tint);
  const temperatureDirection = temp === null ? null : (temp > 5 ? 'warm' : (temp < -5 ? 'cool' : 'neutral'));
  const tintDirection = tint === null ? null : (tint > 5 ? 'magenta' : (tint < -5 ? 'green' : 'neutral'));

  const neutralPx = _num(wb.neutralPixelCount) ?? 0;
  const wbConfidenceRaw = _num(wb.confidence);
  const neutralConfidence = confidenceFromRaw(neutralPx >= 40 ? wbConfidenceRaw : Math.min(wbConfidenceRaw ?? 0, 0.35));

  const observations = [];
  const recommendations = [];
  const warnings = [];

  const bgGreenDominant = !!colorCast?.bgGreenDominant;
  const subjectNeutral = !!colorCast?.subjectNeutral;
  const castLabel = colorCast?.global?.label ?? null;

  let dominantColorBias = null;
  let illuminantConfidenceRaw = wbConfidenceRaw;

  if (bgGreenDominant && subjectNeutral) {
    // Background is green-dominant but the subject reads neutral —
    // report this as a background color observation, NOT a global
    // illuminant/WB cast claim.
    dominantColorBias = colorCast?.border?.label ?? 'green';
    observations.push(_obs('whiteBalance.backgroundColorNotCast', { label: dominantColorBias }));
    illuminantConfidenceRaw = Math.min(illuminantConfidenceRaw ?? 0.5, 0.5);
  } else if (castLabel && castLabel !== 'neutral' && (colorCast?.confidence ?? 0) >= 0.4) {
    dominantColorBias = castLabel;
    observations.push(_obs('whiteBalance.castDetected', { label: castLabel }));
  }

  if (neutralPx < 20 || (wbConfidenceRaw ?? 0) < 0.4) {
    warnings.push(_obs('whiteBalance.lowNeutralConfidence'));
  }

  if (wb.wbIntent?.preserveMood) {
    observations.push(_obs('whiteBalance.creativeMoodPreserved'));
  }

  if (temperatureDirection && temperatureDirection !== 'neutral') {
    observations.push(_obs('whiteBalance.temperatureObservation', { direction: temperatureDirection, value: Math.abs(temp) }));
  }
  if (tintDirection && tintDirection !== 'neutral') {
    observations.push(_obs('whiteBalance.tintObservation', { direction: tintDirection, value: Math.abs(tint) }));
  }

  if (neutralConfidence.level === 'LOW' || neutralConfidence.level === 'UNAVAILABLE') {
    recommendations.push(_obs('whiteBalance.reviewManually'));
  }

  const illuminantConfidence = confidenceFromRaw(illuminantConfidenceRaw);
  const overall = combineConservative([wbConfidenceRaw, illuminantConfidenceRaw]);
  const status = overall.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
    : (overall.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE);

  return {
    status, confidence: overall, observations, recommendations, warnings,
    temperatureDirection, tintDirection, neutralConfidence,
    dominantColorBias, illuminantConfidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tone / Contrast
// ─────────────────────────────────────────────────────────────────────────

export function classifyTone({ stats } = {}) {
  if (!stats) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      blackPoint: null, shadows: null, midtones: null, highlights: null, whitePoint: null, contrastProfile: null };
  }
  const blackPoint = _num(stats.blackPoint);
  const whitePoint = _num(stats.whitePoint);
  const median = _num(stats.median);
  const contrast = _num(stats.contrast);

  let contrastProfile = null;
  const observations = [];
  const recommendations = [];
  const warnings = [];

  if (contrast !== null) {
    if (contrast < 30) { contrastProfile = 'flat'; observations.push(_obs('tone.flatMidtones', { contrast })); recommendations.push(_obs('tone.addContrast')); }
    else if (contrast > 70) { contrastProfile = 'harsh'; observations.push(_obs('tone.harshContrast', { contrast })); recommendations.push(_obs('tone.softenContrast')); }
    else { contrastProfile = 'normal'; observations.push(_obs('tone.normalContrast', { contrast })); }
  }

  const confidence = confidenceFromRaw(stats.confidence);
  const status = confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
    : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE);

  return {
    status, confidence, observations, recommendations, warnings,
    blackPoint, shadows: blackPoint, midtones: median, highlights: whitePoint, whitePoint, contrastProfile,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Color
// ─────────────────────────────────────────────────────────────────────────

export function classifyColor({ stats, palette, harmony, hsl, colorCast } = {}) {
  const hasAny = stats || palette || harmony || hsl;
  if (!hasAny) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      dominantColors: [], saturationProfile: null, harmony: null, channelPresence: [], colorCast: null };
  }
  const observations = [];
  const recommendations = [];
  const warnings = [];

  const avgSat = _num(stats?.avgSatPct);
  let saturationProfile = null;
  if (avgSat !== null) {
    saturationProfile = avgSat < 15 ? 'low' : (avgSat > 55 ? 'vivid' : 'moderate');
    observations.push(_obs('color.saturationProfile', { profile: saturationProfile, pct: avgSat }));
    if (saturationProfile === 'vivid' && avgSat > 65) recommendations.push(_obs('color.moderateSaturation'));
  }

  const dominantColors = Array.isArray(palette?.colors)
    ? palette.colors.slice(0, 5).map((c) => ({
        hex: c.hex ?? null, populationPercent: _num(c.population) !== null ? +(c.population * 100).toFixed(1) : null, role: c.role ?? null,
      }))
    : [];

  const harmonyInfo = harmony?.recommended ? { scheme: harmony.recommended, confidence: confidenceFromRaw(harmony.confidence) } : null;
  if (harmonyInfo) observations.push(_obs('color.harmonyDetected', { scheme: harmonyInfo.scheme }));

  const channelPresence = Array.isArray(hsl?.ranked)
    ? hsl.ranked.slice(0, 4).map((c) => ({ channel: c.channel ?? null, coveragePct: _num(c.coveragePct) }))
    : [];

  let colorCastInfo = null;
  if (colorCast?.global?.label && colorCast.global.label !== 'neutral') {
    colorCastInfo = colorCast.global.label;
    observations.push(_obs('color.castObservation', { label: colorCastInfo }));
  }

  const confidence = combineConservative([stats?.confidence, palette?.confidence, harmony?.confidence, hsl?.confidence]);
  const status = confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
    : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE);

  return {
    status, confidence, observations, recommendations, warnings,
    dominantColors, saturationProfile, harmony: harmonyInfo, channelPresence, colorCast: colorCastInfo,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Skin
// ─────────────────────────────────────────────────────────────────────────

export function classifySkin({ skin } = {}) {
  if (!skin) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [_obs('skin.notDetected')], recommendations: [], warnings: [],
      detected: false, percentage: null, hueRange: null, luminanceRange: null, protectionRecommended: null };
  }
  const detected = !!skin.detected;
  const percentage = _num(skin.coveragePct);
  const observations = [];
  const recommendations = [];
  const warnings = [];

  if (!detected) {
    observations.push(_obs('skin.notDetected'));
  } else {
    observations.push(_obs('skin.detected', { pct: percentage }));
    recommendations.push(_obs('skin.avoidExcessSaturation'));
    recommendations.push(_obs('skin.carefulTextureClarity'));
    recommendations.push(_obs('skin.avoidStrongDehaze'));
    recommendations.push(_obs('skin.protectFaceHighlights'));
  }

  const confRaw = _num(skin.confidence);
  if (detected && confRaw !== null && confRaw < 0.4) {
    warnings.push(_obs('skin.lowConfidence'));
  }

  const hueRange = (detected && skin.avgHSL) ? { avgHue: _num(skin.avgHSL.h) } : null;
  const luminanceRange = (detected && skin.avgHSL) ? { avgLuminance: _num(skin.avgHSL.l) } : null;

  const confidence = confidenceFromRaw(skin.confidence);
  const status = !detected ? SECTION_STATUS.AVAILABLE
    : (confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
      : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE));

  return {
    status, confidence, observations, recommendations, warnings,
    detected, percentage: detected ? percentage : null, hueRange, luminanceRange,
    protectionRecommended: detected,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Scene
// ─────────────────────────────────────────────────────────────────────────

export function classifyScene({ scene, stats } = {}) {
  const fallbackUsed = !scene && !!stats?.category;
  const primaryType = scene?.category ?? stats?.category ?? null;
  if (!primaryType) {
    return { status: SECTION_STATUS.UNAVAILABLE, confidence: { score: null, level: 'UNAVAILABLE' },
      observations: [], recommendations: [], warnings: [],
      primaryType: null, typeHints: [], lightingHints: [], environmentHints: [] };
  }
  const observations = [_obs('scene.primaryType', { type: primaryType })];
  const recommendations = [];
  const warnings = [];
  if (fallbackUsed) warnings.push(_obs('scene.fallbackToHistogramCategory'));

  const typeHints = scene?.scores
    ? Object.entries(scene.scores)
        .filter(([k]) => k !== primaryType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k, v]) => ({ type: k, score: _num(v) }))
    : [];

  const avgLum = _num(stats?.avgLum);
  const lightingHints = [];
  if (avgLum !== null) {
    lightingHints.push({ code: avgLum > 170 ? 'bright' : (avgLum < 80 ? 'dim' : 'moderate'), avgLum });
  }

  const environmentHints = [];

  const confidence = fallbackUsed ? { score: null, level: 'UNAVAILABLE' } : confidenceFromRaw(scene.confidence);
  const status = fallbackUsed ? SECTION_STATUS.PARTIAL
    : (confidence.level === 'UNAVAILABLE' ? SECTION_STATUS.UNAVAILABLE
      : (confidence.level === 'LOW' ? SECTION_STATUS.LOW_CONFIDENCE : SECTION_STATUS.AVAILABLE));

  return {
    status, confidence, observations, recommendations, warnings,
    primaryType, typeHints, lightingHints, environmentHints,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Technical Issues — only generated when supporting evidence exists.
// ─────────────────────────────────────────────────────────────────────────

export function buildTechnicalIssues({ stats, wb, colorCast, skin } = {}) {
  const issues = [];

  if (stats) {
    const clipHi = _num(stats.clipHiPct) ?? 0;
    const clipLo = _num(stats.clipLoPct) ?? 0;
    const drStops = _num(stats.drStops);
    const contrast = _num(stats.contrast);
    const avgSat = _num(stats.avgSatPct);

    if (clipHi > 5) {
      issues.push({
        code: 'HIGHLIGHT_CLIPPING', severity: clipHi > 15 ? 'CRITICAL' : 'WARNING',
        titleKey: 'report.issues.HIGHLIGHT_CLIPPING.title', descriptionKey: 'report.issues.HIGHLIGHT_CLIPPING.description',
        descriptionParams: { pct: clipHi }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.HIGHLIGHT_CLIPPING.recommendation',
      });
    }
    if (clipLo > 5) {
      issues.push({
        code: 'SHADOW_CRUSH', severity: clipLo > 15 ? 'CRITICAL' : 'WARNING',
        titleKey: 'report.issues.SHADOW_CRUSH.title', descriptionKey: 'report.issues.SHADOW_CRUSH.description',
        descriptionParams: { pct: clipLo }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.SHADOW_CRUSH.recommendation',
      });
    }
    if (drStops !== null && drStops < 1.5) {
      issues.push({
        code: 'LOW_DYNAMIC_RANGE', severity: 'WARNING',
        titleKey: 'report.issues.LOW_DYNAMIC_RANGE.title', descriptionKey: 'report.issues.LOW_DYNAMIC_RANGE.description',
        descriptionParams: { drStops }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.LOW_DYNAMIC_RANGE.recommendation',
      });
    }
    if (contrast !== null && contrast > 70) {
      issues.push({
        code: 'HARSH_CONTRAST', severity: 'CAUTION',
        titleKey: 'report.issues.HARSH_CONTRAST.title', descriptionKey: 'report.issues.HARSH_CONTRAST.description',
        descriptionParams: { contrast }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.HARSH_CONTRAST.recommendation',
      });
    }
    if (contrast !== null && contrast < 20) {
      issues.push({
        code: 'FLAT_MIDTONES', severity: 'INFO',
        titleKey: 'report.issues.FLAT_MIDTONES.title', descriptionKey: 'report.issues.FLAT_MIDTONES.description',
        descriptionParams: { contrast }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.FLAT_MIDTONES.recommendation',
      });
    }
    if (avgSat !== null && avgSat > 60) {
      issues.push({
        code: 'EXCESSIVE_SATURATION', severity: 'CAUTION',
        titleKey: 'report.issues.EXCESSIVE_SATURATION.title', descriptionKey: 'report.issues.EXCESSIVE_SATURATION.description',
        descriptionParams: { pct: avgSat }, confidence: confidenceFromRaw(stats.confidence),
        sourceEvidence: ['stats'], recommendationKey: 'report.issues.EXCESSIVE_SATURATION.recommendation',
      });
    }
  }

  if (wb) {
    const neutralPx = _num(wb.neutralPixelCount) ?? 0;
    const wbConf = _num(wb.confidence);
    if (neutralPx < 20 || (wbConf ?? 0) < 0.4) {
      issues.push({
        code: 'WB_LOW_CONFIDENCE', severity: 'CAUTION',
        titleKey: 'report.issues.WB_LOW_CONFIDENCE.title', descriptionKey: 'report.issues.WB_LOW_CONFIDENCE.description',
        descriptionParams: { neutralPx }, confidence: confidenceFromRaw(wbConf),
        sourceEvidence: ['wb'], recommendationKey: 'report.issues.WB_LOW_CONFIDENCE.recommendation',
      });
    }
  }

  if (colorCast?.global?.label && colorCast.global.label !== 'neutral'
      && (colorCast.confidence ?? 0) >= 0.4
      && !(colorCast.bgGreenDominant && colorCast.subjectNeutral)) {
    issues.push({
      code: 'DOMINANT_COLOR_BIAS', severity: 'CAUTION',
      titleKey: 'report.issues.DOMINANT_COLOR_BIAS.title', descriptionKey: 'report.issues.DOMINANT_COLOR_BIAS.description',
      descriptionParams: { label: colorCast.global.label }, confidence: confidenceFromRaw(colorCast.confidence),
      sourceEvidence: ['colorCast'], recommendationKey: 'report.issues.DOMINANT_COLOR_BIAS.recommendation',
    });
  }

  if (skin?.detected && _num(skin.confidence) !== null && skin.confidence < 0.4) {
    issues.push({
      code: 'LOW_SKIN_CONFIDENCE', severity: 'CAUTION',
      titleKey: 'report.issues.LOW_SKIN_CONFIDENCE.title', descriptionKey: 'report.issues.LOW_SKIN_CONFIDENCE.description',
      descriptionParams: null, confidence: confidenceFromRaw(skin.confidence),
      sourceEvidence: ['skin'], recommendationKey: 'report.issues.LOW_SKIN_CONFIDENCE.recommendation',
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────
// Creative characteristics — descriptive, non-judgmental tags.
// ─────────────────────────────────────────────────────────────────────────

export function buildCreativeCharacteristics({ exposureSection, colorSection, wbSection } = {}) {
  const tags = [];
  if (exposureSection?.exposureBalance === 'highKey') tags.push({ code: 'HIGH_KEY', confidence: exposureSection.confidence });
  if (exposureSection?.exposureBalance === 'lowKey') tags.push({ code: 'LOW_KEY', confidence: exposureSection.confidence });
  if (colorSection?.saturationProfile === 'vivid') tags.push({ code: 'VIVID_COLOR', confidence: colorSection.confidence });
  if (colorSection?.saturationProfile === 'low') tags.push({ code: 'MUTED_COLOR', confidence: colorSection.confidence });
  if (wbSection?.temperatureDirection === 'warm') tags.push({ code: 'WARM_MOOD', confidence: wbSection.confidence });
  if (wbSection?.temperatureDirection === 'cool') tags.push({ code: 'COOL_MOOD', confidence: wbSection.confidence });
  if (colorSection?.harmony?.scheme) tags.push({ code: 'HARMONIOUS_PALETTE', params: { scheme: colorSection.harmony.scheme }, confidence: colorSection.harmony.confidence });
  return tags;
}
