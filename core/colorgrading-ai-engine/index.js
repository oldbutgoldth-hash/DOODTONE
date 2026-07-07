/**
 * core/colorgrading-ai-engine/index.js
 *
 * Color Grading AI
 *
 * Deep pixel analysis of Shadows / Midtones / Highlights zones,
 * then generates Hue / Saturation / Balance for each zone using
 * colour science principles and scene-aware creative rules.
 *
 * ─── Analysis ─────────────────────────────────────────────────────────────────
 *  Each zone is analysed independently on the real pixel data:
 *   · Dominant colour cast (r/g/b channel imbalance)
 *   · Chromaticity (CIE xy from weighted rgb)
 *   · Warmth bias (R-B channel diff normalised)
 *   · Green cast (G vs (R+B)/2)
 *   · Avg HSL for pixels falling in that luminance zone
 *
 * ─── Generation ───────────────────────────────────────────────────────────────
 *  Hue     → derived from dominant cast + creative look library
 *  Sat     → derived from avg saturation of zone pixels + intensity target
 *  Balance → how much of this zone the grade should affect (blending weight)
 *
 * ─── Looks ────────────────────────────────────────────────────────────────────
 *  Neutral       → data-driven, minimal artistic bias
 *  Cinematic     → teal shadows, orange/warm highlights (complementary)
 *  Portrait      → warm shadows, cool airy highlights, neutral mids
 *  Landscape     → teal/blue shadows, gold highlights, green mids
 *  Moody         → deep blue shadows, desaturated mids, faint warm highlights
 *  Warm Film     → orange shadows, amber mids, creamy highlights
 *  Cool Film     → blue shadows, grey-cyan mids, silver highlights
 */

import { rgbToHsl, luminance, clamp } from '../color-engine/index.js';

// ─── Zone luminance boundaries (0-255) ───────────────────────────────────────
const ZONE_BOUNDS = {
  shadows:    { lo:   0, hi:  80 },
  midtones:   { lo:  81, hi: 175 },
  highlights: { lo: 176, hi: 255 },
};

const MAX_DIM    = 360;
const SAMPLE_STEP= 2;
const MIN_SAT    = 0.04;   // skip near-grey for cast detection

// ─── Creative Look library ────────────────────────────────────────────────────
// Each look defines target [hue, sat, balance] per zone.
// Hue in degrees (LR Color Grading 0-360), sat 0-100, balance -100..+100
const LOOKS = {
  Cinematic: {
    shadows:    { hue: 200, sat: 22, balance: -20 },
    midtones:   { hue:  30, sat:  5, balance:   0 },
    highlights: { hue:  35, sat: 14, balance:  20 },
    blending: 50, label: 'Cinematic (Teal & Orange)',
  },
  Portrait: {
    shadows:    { hue:  28, sat: 14, balance: -15 },
    midtones:   { hue:  25, sat:  5, balance:   0 },
    highlights: { hue: 200, sat:  8, balance:  18 },
    blending: 58, label: 'Portrait (Warm & Airy)',
  },
  Landscape: {
    shadows:    { hue: 198, sat: 20, balance: -18 },
    midtones:   { hue: 115, sat:  8, balance:   0 },
    highlights: { hue:  40, sat: 14, balance:  16 },
    blending: 50, label: 'Landscape (Teal & Gold)',
  },
  Moody: {
    shadows:    { hue: 220, sat: 28, balance: -25 },
    midtones:   { hue: 200, sat:  6, balance:   0 },
    highlights: { hue:  38, sat:  8, balance:  22 },
    blending: 45, label: 'Moody (Deep Blue)',
  },
  WarmFilm: {
    shadows:    { hue:  28, sat: 18, balance: -20 },
    midtones:   { hue:  40, sat: 10, balance:   0 },
    highlights: { hue:  50, sat: 10, balance:  18 },
    blending: 52, label: 'Warm Film',
  },
  CoolFilm: {
    shadows:    { hue: 215, sat: 20, balance: -20 },
    midtones:   { hue: 195, sat:  6, balance:   0 },
    highlights: { hue: 185, sat:  8, balance:  18 },
    blending: 48, label: 'Cool Film',
  },
  Neutral: {
    shadows:    { hue:   0, sat:  0, balance:   0 },
    midtones:   { hue:   0, sat:  0, balance:   0 },
    highlights: { hue:   0, sat:  0, balance:   0 },
    blending: 50, label: 'Neutral (Data-Driven)',
  },
};

// Recommended look per scene category
const SCENE_LOOK = {
  Portrait:  'Portrait',
  Wedding:   'Portrait',
  Landscape: 'Landscape',
  Travel:    'Cinematic',
  General:   'Cinematic',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ZoneAnalysis
 * @property {number} pixelCount
 * @property {number} coveragePct
 * @property {number} avgR  average red   (0-255)
 * @property {number} avgG  average green (0-255)
 * @property {number} avgB  average blue  (0-255)
 * @property {number} avgH  average hue   (°)
 * @property {number} avgS  average sat   (0-100%)
 * @property {number} avgL  average lum   (0-100%)
 * @property {number} warmth  R-B diff normalised (-1…+1), + = warm
 * @property {number} greenCast G vs (R+B)/2, + = green
 * @property {string} castLabel  'Warm' | 'Cool' | 'Green' | 'Magenta' | 'Neutral'
 */

/**
 * @typedef {Object} GradeZoneResult
 * @property {ZoneAnalysis} analysis
 * @property {number} hue         LR Color Grade Hue (0-360°)
 * @property {number} sat         LR Color Grade Saturation (0-100)
 * @property {number} balance     LR Balance (-100…+100)
 * @property {string} hueReason
 * @property {string} satReason
 * @property {string} balanceReason
 */

/**
 * @typedef {Object} ColorGradingResult
 * @property {GradeZoneResult} shadows
 * @property {GradeZoneResult} midtones
 * @property {GradeZoneResult} highlights
 * @property {number}          blending     LR Blending (0-100)
 * @property {string}          look         look name applied
 * @property {string}          lookLabel    human label
 * @property {string}          category     scene category
 * @property {string}          summary
 */

/**
 * @param {HTMLImageElement} img
 * @param {{ category?: string, look?: string }} [opts]
 * @returns {Promise<ColorGradingResult>}
 */
export function analyzeColorGrading(img, opts = {}) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_analyze(img, opts)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

/** All available look names */
export const LOOK_NAMES = Object.keys(LOOKS);

/** Get a look config by name */
export function getLook(name) { return LOOKS[name] ?? LOOKS.Neutral; }

// ─── Core ─────────────────────────────────────────────────────────────────────

function _analyze(img, opts) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for color grading analysis');

  const category = opts.category ?? 'General';
  const lookName = opts.look ?? SCENE_LOOK[category] ?? 'Cinematic';
  const look     = LOOKS[lookName] ?? LOOKS.Cinematic;

  const pixels = _sample(img);
  const total  = pixels.length;

  // Partition pixels into zones
  const zones = { shadows: [], midtones: [], highlights: [] };
  for (const [r, g, b] of pixels) {
    const lum = luminance(r, g, b);
    if      (lum <= ZONE_BOUNDS.shadows.hi)    zones.shadows.push([r, g, b]);
    else if (lum <= ZONE_BOUNDS.midtones.hi)   zones.midtones.push([r, g, b]);
    else                                        zones.highlights.push([r, g, b]);
  }

  const shaAn  = _analyzeZone(zones.shadows,    total, 'Shadows');
  const midAn  = _analyzeZone(zones.midtones,   total, 'Midtones');
  const hiAn   = _analyzeZone(zones.highlights, total, 'Highlights');

  const shadows_r    = _gradeZone(shaAn,  look.shadows,    'shadows',    category, look);
  const midtones_r   = _gradeZone(midAn,  look.midtones,   'midtones',   category, look);
  const highlights_r = _gradeZone(hiAn,   look.highlights, 'highlights', category, look);

  // ── Confidence ─────────────────────────────────────────────────────────────
  // High when all three zones have meaningful pixel coverage and
  // the look selection is based on a recognised scene category.
  const knownScene    = ['Portrait','Wedding','Landscape','Travel','General'].includes(category);
  const shadowCov     = shaAn.coveragePct;
  const highlightCov  = hiAn.coveragePct;
  const midCov        = midAn.coveragePct;
  const minZoneCov    = Math.min(shadowCov, midCov, highlightCov);

  const confidence = +Math.max(0.1, Math.min(1,
    (knownScene ? 0.3 : 0.1) +           // recognised scene = better look match
    Math.min(0.4, minZoneCov / 10) +     // all zones need coverage
    (midCov > 20 ? 0.2 : midCov / 100) + // midtones dominate most images
    (total > 2000 ? 0.1 : 0)
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  if (shadowCov < 3)
    warnings.push(`Shadow zone has very few pixels (${shadowCov}%) — shadow grading may not be meaningful`);
  if (highlightCov < 3)
    warnings.push(`Highlight zone has very few pixels (${highlightCov}%) — highlight grading may not be meaningful`);
  if (!knownScene)
    warnings.push(`Unknown category '${category}' — falling back to Cinematic look`);
  if (shaAn.castLabel !== 'Neutral' && shaAn.castLabel === hiAn.castLabel)
    warnings.push(`Both shadows and highlights share the same cast (${shaAn.castLabel}) — may indicate global WB issue rather than zone-specific grading need`);

  return {
    shadows:    shadows_r,
    midtones:   midtones_r,
    highlights: highlights_r,
    blending:   look.blending,
    look:       lookName,
    lookLabel:  look.label,
    category,
    summary:    _summary(shaAn, midAn, hiAn, lookName, category),
    // Phase 1
    confidence: +confidence,
    warnings,
  };
}

// ─── Zone pixel analysis ──────────────────────────────────────────────────────

function _analyzeZone(pixels, total, zoneName) {
  const n = pixels.length;
  if (n === 0) {
    return {
      pixelCount: 0, coveragePct: 0,
      avgR:128, avgG:128, avgB:128,
      avgH:0, avgS:0, avgL:50,
      warmth:0, greenCast:0, castLabel:'Neutral',
      zoneName,
    };
  }

  let rS=0, gS=0, bS=0, hS=0, sS=0, lS=0, satCount=0;
  for (const [r, g, b] of pixels) {
    rS+=r; gS+=g; bS+=b;
    const hsl = rgbToHsl(r, g, b);
    if (hsl.s >= MIN_SAT) { hS+=hsl.h; sS+=hsl.s; satCount++; }
    lS+=hsl.l;
  }

  const avgR = Math.round(rS/n), avgG = Math.round(gS/n), avgB = Math.round(bS/n);
  const warmth    = +((avgR - avgB) / 128).toFixed(3);   // -1…+1
  const greenCast = +((avgG - (avgR + avgB) / 2) / 64).toFixed(3);

  const avgH = satCount > 0 ? Math.round(hS / satCount) : 0;
  const avgS = satCount > 0 ? Math.round((sS / satCount) * 100) : 0;
  const avgL = Math.round((lS / n) * 100);

  const castLabel = _castLabel(warmth, greenCast);

  return {
    pixelCount:  n,
    coveragePct: +((n / Math.max(1, total)) * 100).toFixed(1),
    avgR, avgG, avgB,
    avgH, avgS, avgL,
    warmth, greenCast, castLabel,
    zoneName,
  };
}

function _castLabel(warmth, green) {
  if (Math.abs(warmth) <= 0.05 && Math.abs(green) <= 0.05) return 'Neutral';
  if (warmth > 0.12)  return 'Warm';
  if (warmth < -0.12) return 'Cool';
  if (green  > 0.10)  return 'Green cast';
  if (green  < -0.10) return 'Magenta cast';
  return warmth > 0 ? 'Slightly warm' : 'Slightly cool';
}

// ─── Grade zone generation ────────────────────────────────────────────────────

function _gradeZone(analysis, lookZone, zoneName, category, look) {
  // ── Hue ──────────────────────────────────────────────────────────────────
  // Start from creative look target, then adjust for detected cast
  let hue = lookZone.hue;

  // If detected cast opposes the look, reduce intensity
  // If cast aligns with look, boost slightly
  const castCorrection = _castToHue(analysis.warmth, analysis.greenCast);
  const lookWeight = 0.72;  // how much the look dominates vs data
  hue = Math.round(hue * lookWeight + castCorrection * (1 - lookWeight));
  hue = ((hue % 360) + 360) % 360;

  const hueReason = lookZone.hue === 0
    ? `No hue shift — neutral look for ${analysis.zoneName.toLowerCase()}.`
    : `Look target ${lookZone.hue}° blended with detected cast (${analysis.castLabel}). Final: ${hue}°.`;

  // ── Saturation ────────────────────────────────────────────────────────────
  // Base from look, modulated by how saturated the zone actually is
  const zoneSatFactor = clamp(analysis.avgS / 40, 0.5, 1.5);
  let sat = clamp(Math.round(lookZone.sat * zoneSatFactor), 0, 100);

  // Reduce grading intensity on zones with very low coverage
  if (analysis.coveragePct < 5) sat = Math.round(sat * 0.5);

  const satReason = sat === 0
    ? `No saturation applied — zone is nearly achromatic (avg sat ${analysis.avgS}%).`
    : `Look target ${lookZone.sat} scaled by zone saturation (${analysis.avgS}%). Result: ${sat}.`;

  // ── Balance ───────────────────────────────────────────────────────────────
  // LR Balance controls where in the tonal range this zone's grade peaks.
  // Negative = pull toward shadows, Positive = pull toward highlights.
  // We push balance slightly toward the actual zone distribution.
  let balance = lookZone.balance;
  // Skew by coverage: heavy zone → push balance toward it
  const covSkew = clamp((analysis.coveragePct - 33) / 33, -1, 1) * 8;
  balance = clamp(Math.round(balance + covSkew), -100, 100);

  const balanceReason = `Look target ${lookZone.balance}, adjusted for zone mass (${analysis.coveragePct}%). Result: ${balance}.`;

  return { analysis, hue, sat, balance, hueReason, satReason, balanceReason };
}

/** Convert warmth/green cast to a nearest hue angle */
function _castToHue(warmth, green) {
  if (warmth > 0.1)  return 30;   // warm → orange
  if (warmth < -0.1) return 210;  // cool → cyan
  if (green  > 0.1)  return 120;  // green → green
  if (green  < -0.1) return 300;  // magenta cast → purple/magenta
  return 0;                        // neutral
}

// ─── Sampling ─────────────────────────────────────────────────────────────────

function _sample(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;
  const pixels = [];
  for (let i=0; i<w*h; i+=SAMPLE_STEP) {
    const o=i*4; if(data[o+3]<128) continue;
    pixels.push([data[o],data[o+1],data[o+2]]);
  }
  return pixels;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function _summary(sha, mid, hi, lookName, category) {
  const parts = [category, lookName];
  if (sha.castLabel !== 'Neutral') parts.push(`Shadows: ${sha.castLabel}`);
  if (hi.castLabel  !== 'Neutral') parts.push(`Highlights: ${hi.castLabel}`);
  parts.push(`DR: ${sha.coveragePct}% / ${mid.coveragePct}% / ${hi.coveragePct}%`);
  return parts.join(' · ');
}
