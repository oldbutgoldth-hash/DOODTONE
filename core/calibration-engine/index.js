/**
 * core/calibration-engine/index.js  v3
 *
 * Calibration Engine
 *
 * Derives Camera Calibration values for Red / Green / Blue primaries
 * by analysing the actual colour gamut of the image at pixel level.
 *
 * ─── What Lightroom Calibration Does ────────────────────────────────────────
 * Camera Calibration shifts the raw-decode primary colours:
 *   Red   Primary Hue   → rotate the red primary chromaticity  (−100…+100)
 *   Red   Primary Sat   → expand/compress red gamut radius     (−100…+100)
 *   Green Primary Hue   → rotate green primary                 (−100…+100)
 *   Green Primary Sat   → expand/compress green gamut          (−100…+100)
 *   Blue  Primary Hue   → rotate blue primary                  (−100…+100)
 *   Blue  Primary Sat   → expand/compress blue gamut           (−100…+100)
 *
 * ─── Analysis Method ────────────────────────────────────────────────────────
 *
 * 1. Isolate pixels dominated by each primary:
 *    Red-dominant:   R > G*1.3 && R > B*1.3
 *    Green-dominant: G > R*1.2 && G > B*1.2
 *    Blue-dominant:  B > R*1.2 && B > G*1.2
 *
 * 2. Per-primary statistics:
 *    · Avg HSL (hue, saturation, luminance)
 *    · Chromaticity centroid (CIE xy approximated from sRGB)
 *    · Hue drift from expected primary hue
 *    · Saturation relative to sRGB gamut boundary
 *    · Colour temperature contribution
 *
 * 3. Calibration derivation:
 *    · Hue adjustment = −(measured hue drift) × scene_weight
 *    · Sat adjustment = (target_gamut_radius − measured_radius) × scale
 *
 * 4. Scene-aware targets:
 *    Portrait  → skin-safe red, suppress green, cool blue
 *    Landscape → rich green, vivid blue, neutral red
 *    Wedding   → warm red/orange, gentle green, airy blue
 *    Travel    → balanced, slight gamut expansion
 *    General   → pure data-driven
 *
 * ─── Output ─────────────────────────────────────────────────────────────────
 * { red, green, blue } each with:
 *   hue         LR slider (−100…+100)
 *   sat         LR slider (−100…+100)
 *   pixelCount
 *   coveragePct
 *   avgHue      measured (°)
 *   avgSat      measured (0-100 %)
 *   avgLum      measured (0-100 %)
 *   hueReason
 *   satReason
 *   chromaticity  { x, y }   CIE xy approximation
 */

import { rgbToHsl, clamp } from '../color-engine/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DIM      = 380;
const SAMPLE_STEP  = 2;
const MIN_DOMINANCE= 1.25;   // ratio to qualify as "dominated by primary"
const MIN_SAT_HSL  = 0.15;   // skip near-grey pixels

// Expected primary hues in sRGB (°)
const PRIMARY_HUE = { red: 0, green: 120, blue: 240 };

// sRGB primary chromaticity (CIE xy, D65)
const PRIMARY_XY = {
  red:   { x: 0.640, y: 0.330 },
  green: { x: 0.300, y: 0.600 },
  blue:  { x: 0.150, y: 0.060 },
};

// ─── Scene calibration targets ───────────────────────────────────────────────

const SCENE_CAL = {
  Portrait: {
    // v3: lower satTarget for red (55→45) — avoids expanding red gamut → skin oversaturation
    // v3: lower satTarget for green (40→32) — suppresses green primary more strongly
    red:   { hueTarget: 3, satTarget: 45, hueScale: 0.55, satScale: 0.55 },
    green: { hueTarget:-3, satTarget: 32, hueScale: 0.50, satScale: 0.50 },
    blue:  { hueTarget:-5, satTarget: 40, hueScale: 0.55, satScale: 0.55 },
    label: 'Portrait (skin-safe)',
  },
  Wedding: {
    red:   { hueTarget: 5, satTarget: 48, hueScale: 0.60, satScale: 0.55 },
    green: { hueTarget:-2, satTarget: 34, hueScale: 0.50, satScale: 0.45 },
    blue:  { hueTarget:-4, satTarget: 38, hueScale: 0.55, satScale: 0.50 },
    label: 'Wedding (warm & airy)',
  },
  Landscape: {
    red:   { hueTarget: 0,   satTarget: 50, hueScale: 0.75, satScale: 0.75 },
    green: { hueTarget: 5,   satTarget: 58, hueScale: 0.80, satScale: 0.80 },
    blue:  { hueTarget:-8,   satTarget: 55, hueScale: 0.80, satScale: 0.80 },
    label: 'Landscape (vivid primaries)',
  },
  Travel: {
    red:   { hueTarget: 2,   satTarget: 48, hueScale: 0.70, satScale: 0.70 },
    green: { hueTarget: 2,   satTarget: 48, hueScale: 0.70, satScale: 0.70 },
    blue:  { hueTarget:-3,   satTarget: 48, hueScale: 0.70, satScale: 0.70 },
    label: 'Travel (balanced)',
  },
  General: {
    red:   { hueTarget: 0,   satTarget: 50, hueScale: 0.70, satScale: 0.70 },
    green: { hueTarget: 0,   satTarget: 50, hueScale: 0.70, satScale: 0.70 },
    blue:  { hueTarget: 0,   satTarget: 50, hueScale: 0.70, satScale: 0.70 },
    label: 'General (data-driven)',
  },
};


// ── Task 001: skin-detected calibration guardrails ────────────────────────────
// When skin is present, calibration must be subtle — not a style-transfer tool.
const SKIN_GUARDRAILS = {
  red:   { hue: [-4, 4], sat: [-6, 6] },
  green: { hue: [-4, 4], sat: [-6, 6] },
  blue:  { hue: [-4, 4], sat: [-6, 6] },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PrimaryResult
 * @property {string}  primary         'red' | 'green' | 'blue'
 * @property {number}  hue             LR Calibration Hue  (−100…+100)
 * @property {number}  sat             LR Calibration Sat  (−100…+100)
 * @property {number}  pixelCount
 * @property {number}  coveragePct
 * @property {number}  avgHue          measured hue (°)
 * @property {number}  avgSat          measured saturation (0-100 %)
 * @property {number}  avgLum          measured luminance  (0-100 %)
 * @property {number}  hueDrift        degrees from expected primary hue
 * @property {{x:number,y:number}} chromaticity  CIE xy approximation
 * @property {string}  hueReason
 * @property {string}  satReason
 */

/**
 * @typedef {Object} CalibrationResult
 * @property {PrimaryResult}  red
 * @property {PrimaryResult}  green
 * @property {PrimaryResult}  blue
 * @property {string}         sceneLabel
 * @property {string}         category
 * @property {string}         summary
 */

/**
 * @param {HTMLImageElement} img
 * @param {{ category?: string }} [opts]
 * @returns {Promise<CalibrationResult>}
 */
export function analyzeCalibration(img, opts = {}) {
  // opts.skinPct — used for guardrail tightening
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_analyze(img, opts)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _analyze(img, opts) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for calibration analysis');

  const category = opts.category ?? 'General';
  const scene    = SCENE_CAL[category] ?? SCENE_CAL.General;
  const pixels   = _sample(img);
  const total    = pixels.length;

  const redPx   = [], greenPx = [], bluePx = [];

  for (const [r, g, b] of pixels) {
    const { s } = rgbToHsl(r, g, b);
    if (s < MIN_SAT_HSL) continue;  // skip near-grey

    const maxC = Math.max(r, g, b);
    if (r === maxC && r > g * MIN_DOMINANCE && r > b * MIN_DOMINANCE) redPx.push([r,g,b]);
    else if (g === maxC && g > r * MIN_DOMINANCE && g > b * MIN_DOMINANCE) greenPx.push([r,g,b]);
    else if (b === maxC && b > r * MIN_DOMINANCE && b > g * MIN_DOMINANCE) bluePx.push([r,g,b]);
  }

  const hasSkin = (opts.skinPct ?? 0) > 5;
  const applyGuard = (p, name) => {
    if (!hasSkin) return p;
    const g = SKIN_GUARDRAILS[name];
    return { ...p,
      hue: Math.max(g.hue[0], Math.min(g.hue[1], p.hue)),
      sat: Math.max(g.sat[0], Math.min(g.sat[1], p.sat)),
    };
  };
  const red_r   = applyGuard(_primary('red',   redPx,   total, scene.red,   PRIMARY_HUE.red,   PRIMARY_XY.red  ), 'red');
  const green_r = applyGuard(_primary('green', greenPx, total, scene.green, PRIMARY_HUE.green, PRIMARY_XY.green), 'green');
  const blue_r  = applyGuard(_primary('blue',  bluePx,  total, scene.blue,  PRIMARY_HUE.blue,  PRIMARY_XY.blue ), 'blue');

  // ── Confidence ─────────────────────────────────────────────────────────────
  // Calibration is only meaningful when enough primary-dominant pixels exist.
  // JPEG sRGB source means this is already an approximation of raw primaries.
  const redCov   = red_r.coveragePct;
  const greenCov = green_r.coveragePct;
  const blueCov  = blue_r.coveragePct;
  const avgCoverage = (redCov + greenCov + blueCov) / 3;

  // Penalise if any primary has near-zero coverage (can't measure it)
  const zeroPrimaries = [redCov, greenCov, blueCov].filter(c => c < 0.5).length;
  const confidence = +Math.max(0.1, Math.min(1,
    Math.min(0.5, avgCoverage / 10) +    // coverage quality 0→0.5
    (hasSkin ? 0 : 0.1) +               // skin guardrails reduce reliability
    (zeroPrimaries === 0 ? 0.3 : zeroPrimaries === 1 ? 0.15 : 0) +
    (total > 2000 ? 0.1 : 0)
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  warnings.push('Calibration values derived from sRGB JPEG — not equivalent to raw primary calibration');
  if (redCov < 0.5)   warnings.push(`Red primary: very few dominant pixels (${redCov}%) — hue/sat correction unreliable`);
  if (greenCov < 0.5) warnings.push(`Green primary: very few dominant pixels (${greenCov}%) — correction unreliable`);
  if (blueCov < 0.5)  warnings.push(`Blue primary: very few dominant pixels (${blueCov}%) — correction unreliable`);
  if (hasSkin)        warnings.push('Skin guardrails active — calibration values clamped to avoid skin-tone distortion');

  return {
    red: red_r, green: green_r, blue: blue_r,
    sceneLabel: scene.label + (hasSkin ? ' [skin guardrails active]' : ''),
    category,
    summary: _summary(redPx.length, greenPx.length, bluePx.length, total, category),
    // Phase 1
    confidence: +confidence,
    warnings,
  };
}

// ─── Per-primary derivation ───────────────────────────────────────────────────

function _primary(name, pixels, total, scene, idealHue, idealXY) {
  const n = pixels.length;
  const cov = +((n / Math.max(1, total)) * 100).toFixed(2);

  if (n === 0) {
    return {
      primary: name, hue: 0, sat: 0,
      pixelCount: 0, coveragePct: 0,
      avgHue: idealHue, avgSat: 0, avgLum: 50,
      hueDrift: 0, chromaticity: idealXY,
      hueReason: `No ${name}-dominant pixels detected. Using neutral calibration.`,
      satReason: `No ${name}-dominant pixels detected. Saturation unchanged.`,
    };
  }

  // ── Statistics ──────────────────────────────────────────────────────────────
  let hSum=0, sSum=0, lSum=0, xSum=0, ySum=0, satCount=0;

  for (const [r, g, b] of pixels) {
    const hsl = rgbToHsl(r, g, b);
    hSum += hsl.h;
    lSum += hsl.l;
    if (hsl.s >= MIN_SAT_HSL) { sSum += hsl.s; satCount++; }

    // Approximate CIE xy from linear sRGB (simplified, no gamma)
    const rl=r/255, gl=g/255, bl=b/255;
    const X = 0.4124*rl + 0.3576*gl + 0.1805*bl;
    const Y = 0.2126*rl + 0.7152*gl + 0.0722*bl;
    const Z = 0.0193*rl + 0.1192*gl + 0.9505*bl;
    const denom = X + Y + Z || 1;
    xSum += X / denom;
    ySum += Y / denom;
  }

  const avgHue  = Math.round(hSum / n);
  const avgSat  = satCount > 0 ? Math.round((sSum / satCount) * 100) : 0;
  const avgLum  = Math.round((lSum / n) * 100);
  const chromX  = +(xSum / n).toFixed(4);
  const chromY  = +(ySum / n).toFixed(4);

  // ── Hue drift ───────────────────────────────────────────────────────────────
  // Handle red wrap-around (e.g. avgHue=350 vs idealHue=0 → drift=-10)
  let hueDrift = avgHue - idealHue;
  if (name === 'red') {
    if (hueDrift > 180)  hueDrift -= 360;
    if (hueDrift < -180) hueDrift += 360;
  }

  // ── Calibration Hue ─────────────────────────────────────────────────────────
  // v3: removed hueTargetCorr — scene.hueTarget was adding systematic bias
  // (e.g. Portrait red always got +1.5 warm bias regardless of actual drift).
  // Now only correct measured drift, proportionally.
  const driftCorr = -hueDrift * scene.hueScale;
  const hue = clamp(Math.round(driftCorr), -100, 100);

  // ── Calibration Sat ─────────────────────────────────────────────────────────
  const satDiff = scene.satTarget - avgSat;
  const sat = clamp(Math.round(satDiff * scene.satScale), -100, 100);

  // ── Chromaticity distance from ideal ────────────────────────────────────────
  const chromDist = +Math.sqrt(
    (chromX - idealXY.x)**2 + (chromY - idealXY.y)**2
  ).toFixed(4);

  // ── Reasons ─────────────────────────────────────────────────────────────────
  const driftLabel = Math.abs(hueDrift) > 8
    ? `${hueDrift > 0 ? 'yellow-shifted' : 'purple-shifted'} by ${Math.abs(Math.round(hueDrift))}°`
    : 'centred near ideal';

  const hueReason = [
    `${name.charAt(0).toUpperCase()+name.slice(1)} primary measured at ${avgHue}° (ideal ${idealHue}°, drift ${hueDrift > 0 ? '+' : ''}${Math.round(hueDrift)}°).`,
    `Primary is ${driftLabel}.`,
    hue !== 0 ? `Correction: ${hue >= 0 ? '+' : ''}${hue} to align with scene target.` : 'No hue correction needed.',
  ].join(' ');

  const satLabel = avgSat < scene.satTarget - 8 ? 'undersaturated'
                 : avgSat > scene.satTarget + 8 ? 'oversaturated'
                 : 'balanced';

  const satReason = [
    `${name.charAt(0).toUpperCase()+name.slice(1)} avg saturation ${avgSat}% (target ${scene.satTarget}%).`,
    `Primary is ${satLabel}.`,
    sat !== 0 ? `Adjustment: ${sat >= 0 ? '+' : ''}${sat}.` : 'No saturation correction needed.',
  ].join(' ');

  return {
    primary: name, hue, sat,
    pixelCount: n, coveragePct: cov,
    avgHue, avgSat, avgLum, hueDrift: Math.round(hueDrift),
    chromaticity: { x: chromX, y: chromY },
    chromDist,
    hueReason, satReason,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function _summary(rN, gN, bN, total, category) {
  const rPct=((rN/Math.max(1,total))*100).toFixed(1);
  const gPct=((gN/Math.max(1,total))*100).toFixed(1);
  const bPct=((bN/Math.max(1,total))*100).toFixed(1);
  return `${category} · Red ${rPct}% · Green ${gPct}% · Blue ${bPct}% dominant pixels`;
}
