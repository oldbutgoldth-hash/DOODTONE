/**
 * core/skintone-engine/index.js
 *
 * Skin Tone Detection Pro — three independent detection models,
 * each operating in a different colour space.
 *
 * ─── Models ────────────────────────────────────────────────────────────────
 *
 * 1. RGB  — empirical rule-set (Kovac et al. 2003)
 *    Fastest; works well in controlled lighting.
 *    Rules: R>95, G>40, B>20, R>G, R>B, |R−G|>15, max−min>15
 *    Extended with normalised chromaticity r/g/b bounds.
 *
 * 2. HSV  — hue/saturation gating (Chai & Ngan 1999, refined)
 *    Robust to illumination changes; covers a wider skin range.
 *    Rules: H∈[0°,50°], S∈[0.23,0.68], V∈[0.35,1.0]
 *
 * 3. YCbCr — perceptual colour model (ITU-R BT.601)
 *    Best for mixed illumination and diverse skin tones.
 *    Rules: Y∈[80,235], Cb∈[77,127], Cr∈[133,173]
 *
 * ─── Consensus ──────────────────────────────────────────────────────────────
 *
 * A pixel is marked "confirmed skin" when ≥2 of 3 models agree.
 * Statistical descriptors (Hue, Saturation, Luminance) are computed
 * over the confirmed-skin pixel set only.
 *
 * ─── Output ─────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} SkinToneResult
 * @property {number}  pixelCount        absolute skin pixel count
 * @property {number}  coveragePct       % of total sampled pixels
 * @property {boolean} detected          true if coverage > threshold
 * @property {string}  toneLabel         e.g. "Light", "Medium", "Dark"
 * @property {string}  fitzpatrickScale  I – VI
 *
 * @property {Object}  avgHSL
 * @property {number}  avgHSL.h          average hue of skin pixels (°)
 * @property {number}  avgHSL.s          average saturation (0–100 %)
 * @property {number}  avgHSL.l          average lightness  (0–100 %)
 *
 * @property {Object}  avgRGB
 * @property {number}  avgRGB.r
 * @property {number}  avgRGB.g
 * @property {number}  avgRGB.b
 *
 * @property {Object}  avgYCbCr
 * @property {number}  avgYCbCr.y
 * @property {number}  avgYCbCr.cb
 * @property {number}  avgYCbCr.cr
 *
 * @property {Object}  modelAgreement
 * @property {number}  modelAgreement.rgb      % pixels matched by RGB model
 * @property {number}  modelAgreement.hsv      % pixels matched by HSV model
 * @property {number}  modelAgreement.ycbcr    % pixels matched by YCbCr model
 * @property {number}  modelAgreement.consensus % pixels confirmed by ≥2 models
 *
 * @property {Object}  hueHistogram      32-bucket hue histogram (skin pixels)
 * @property {Object}  luminanceHistogram 16-bucket lum histogram (skin pixels)
 *
 * @property {string}  recommendation    Lightroom adjustment advice
 */

import { rgbToHsl, luminance, clamp } from '../color-engine/index.js';

// ─── Sampling config ──────────────────────────────────────────────────────────

const MAX_DIM          = 400;    // downsample long edge
const SAMPLE_STEP      = 2;      // analyse every Nth pixel
const MIN_COVERAGE_PCT = 2.0;    // threshold to declare "detected"
const CONSENSUS_MIN    = 2;      // models that must agree

// ─── RGB model thresholds (Kovac et al. + normalised chromaticity) ────────────

const RGB_RULES = {
  rMin: 95, gMin: 40, bMin: 20,
  maxMinDiff: 15,                // max(r,g,b) − min(r,g,b) > this
  rgDiff:     15,                // |r − g| > this
  // Normalised chromaticity  r = R/(R+G+B)
  rNormMin: 0.36, rNormMax: 0.80,
  gNormMin: 0.28, gNormMax: 0.36,
};

// ─── HSV model thresholds ─────────────────────────────────────────────────────

const HSV_RULES = {
  hMin: 0, hMax: 50,             // degrees
  sMin: 0.20, sMax: 0.70,
  vMin: 0.30, vMax: 1.00,
};

// ─── YCbCr model thresholds (BT.601) ─────────────────────────────────────────

const YCBCR_RULES = {
  yMin: 80,  yMax: 235,
  cbMin: 77, cbMax: 127,
  crMin: 133,crMax: 173,
};

// ─── Fitzpatrick / tone label ─────────────────────────────────────────────────

const FITZPATRICK_TABLE = [
  { lMax: 0.22, fitz: 'VI',  label: 'Very Dark'   },
  { lMax: 0.32, fitz: 'V',   label: 'Dark'         },
  { lMax: 0.44, fitz: 'IV',  label: 'Medium-Dark'  },
  { lMax: 0.58, fitz: 'III', label: 'Medium'        },
  { lMax: 0.72, fitz: 'II',  label: 'Light-Medium'  },
  { lMax: 1.01, fitz: 'I',   label: 'Light'         },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse skin tones in an HTMLImageElement.
 * @param {HTMLImageElement} img
 * @returns {Promise<SkinToneResult>}
 */
export function analyzeSkinTone(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_analyze(img)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _analyze(img) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for skin tone analysis');

  const { pixels, total } = _sample(img);

  // Per-pixel model votes
  let rgbCount = 0, hsvCount = 0, ycbcrCount = 0, consensusCount = 0;

  // Accumulators for consensus pixels
  let rSum = 0, gSum = 0, bSum = 0;
  let hSum = 0, sSum = 0, lSum = 0;
  let ySum = 0, cbSum = 0, crSum = 0;

  // Hue histogram (32 buckets × 11.25° each, only 0–90° range used)
  const hueHist = new Float32Array(32);
  // Luminance histogram (16 buckets)
  const lumHist = new Float32Array(16);

  for (const [r, g, b] of pixels) {
    const rgb   = _testRGB(r, g, b);
    const hsv   = _testHSV(r, g, b);
    const ycbcr = _testYCbCr(r, g, b);

    if (rgb)   rgbCount++;
    if (hsv)   hsvCount++;
    if (ycbcr) ycbcrCount++;

    const votes = (rgb ? 1 : 0) + (hsv ? 1 : 0) + (ycbcr ? 1 : 0);
    if (votes < CONSENSUS_MIN) continue;

    // Confirmed skin pixel
    consensusCount++;
    rSum += r; gSum += g; bSum += b;

    const hsl = rgbToHsl(r, g, b);
    hSum += hsl.h; sSum += hsl.s; lSum += hsl.l;

    const lum = luminance(r, g, b) / 255;
    const { y, cb, cr } = _rgbToYCbCr(r, g, b);
    ySum += y; cbSum += cb; crSum += cr;

    // Histograms
    const hBucket = Math.min(31, Math.floor(hsl.h / (360 / 32)));
    hueHist[hBucket]++;
    const lBucket = Math.min(15, Math.floor(lum * 16));
    lumHist[lBucket]++;
  }

  const n           = consensusCount;
  const coveragePct = +((n / total) * 100).toFixed(2);
  const detected    = coveragePct >= MIN_COVERAGE_PCT;

  if (n === 0) return _emptyResult(total, rgbCount, hsvCount, ycbcrCount);

  const avgHSL = {
    h: Math.round(hSum / n),
    s: Math.round((sSum / n) * 100),
    l: Math.round((lSum / n) * 100),
  };
  const avgRGB = {
    r: Math.round(rSum / n),
    g: Math.round(gSum / n),
    b: Math.round(bSum / n),
  };
  const avgYCbCr = {
    y:  Math.round(ySum  / n),
    cb: Math.round(cbSum / n),
    cr: Math.round(crSum / n),
  };

  // Fitzpatrick scale from average lightness
  const { fitz, label } = _fitzpatrick(lSum / n);

  // ── Confidence score ──────────────────────────────────────────────────────
  // Based on: model agreement ratio, pixel count, coverage spread
  const rgbPct    = (rgbCount   / total);
  const hsvPct    = (hsvCount   / total);
  const ycbcrPct  = (ycbcrCount / total);
  const agreement = (rgbPct + hsvPct + ycbcrPct) / 3;  // avg model vote fraction
  const confidence = +Math.max(0.05, Math.min(1,
    agreement * 0.6 +
    (coveragePct > 5 ? 0.2 : coveragePct / 25) +  // enough coverage
    (n > 100 ? 0.2 : n / 500)                      // enough confirmed pixels
  )).toFixed(3);

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];
  if (!detected)
    warnings.push('No skin detected — scene may be landscape, food, or object photography');
  if (detected && coveragePct > 70)
    warnings.push(`Very high skin coverage (${coveragePct}%) — may include false positives from warm-coloured objects`);
  if (detected && n < 50)
    warnings.push(`Only ${n} confirmed skin pixels — measurement may be unreliable`);
  if (detected && Math.max(rgbPct, hsvPct, ycbcrPct) - Math.min(rgbPct, hsvPct, ycbcrPct) > 0.15)
    warnings.push('Models disagree significantly — lighting conditions may be challenging for skin detection');
  if (avgHSL.l < 25)
    warnings.push('Detected skin tone is very dark — Fitzpatrick VI or under-exposed image');
  if (avgHSL.l > 85)
    warnings.push('Detected skin tone is very bright — possible overexposure in skin region');

  return {
    pixelCount:   n,
    coveragePct,
    detected,
    toneLabel:    label,
    fitzpatrickScale: fitz,

    avgHSL,
    avgRGB,
    avgYCbCr,

    modelAgreement: {
      rgb:       +((rgbCount   / total) * 100).toFixed(2),
      hsv:       +((hsvCount   / total) * 100).toFixed(2),
      ycbcr:     +((ycbcrCount / total) * 100).toFixed(2),
      consensus: coveragePct,
    },

    hueHistogram:       _normaliseHist(hueHist,  n),
    luminanceHistogram: _normaliseHist(lumHist,  n),

    recommendation: _recommend(avgHSL, avgRGB, coveragePct),
    hex: _toHex(avgRGB.r, avgRGB.g, avgRGB.b),

    // Phase 1 additions
    confidence,
    warnings,
  };
}

// ─── Model tests ──────────────────────────────────────────────────────────────

/** Kovac RGB rule-set */
function _testRGB(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (r < RGB_RULES.rMin || g < RGB_RULES.gMin || b < RGB_RULES.bMin) return false;
  if ((mx - mn) <= RGB_RULES.maxMinDiff) return false;
  if (Math.abs(r - g) <= RGB_RULES.rgDiff) return false;
  if (r <= g || r <= b) return false;
  const sum = r + g + b || 1;
  const rn = r / sum, gn = g / sum;
  return (
    rn >= RGB_RULES.rNormMin && rn <= RGB_RULES.rNormMax &&
    gn >= RGB_RULES.gNormMin && gn <= RGB_RULES.gNormMax
  );
}

/** HSV hue/saturation/value gate */
function _testHSV(r, g, b) {
  const { h, s, v } = _rgbToHsv(r, g, b);
  return (
    h  >= HSV_RULES.hMin  && h  <= HSV_RULES.hMax  &&
    s  >= HSV_RULES.sMin  && s  <= HSV_RULES.sMax  &&
    v  >= HSV_RULES.vMin  && v  <= HSV_RULES.vMax
  );
}

/** YCbCr channel range gate */
function _testYCbCr(r, g, b) {
  const { y, cb, cr } = _rgbToYCbCr(r, g, b);
  return (
    y  >= YCBCR_RULES.yMin  && y  <= YCBCR_RULES.yMax  &&
    cb >= YCBCR_RULES.cbMin && cb <= YCBCR_RULES.cbMax &&
    cr >= YCBCR_RULES.crMin && cr <= YCBCR_RULES.crMax
  );
}

// ─── Colour-space conversions ─────────────────────────────────────────────────

/** RGB → HSV (h ∈ [0,360), s/v ∈ [0,1]) */
function _rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const v   = Math.max(r, g, b);
  const mn  = Math.min(r, g, b);
  const d   = v - mn;
  const s   = v === 0 ? 0 : d / v;
  let h = 0;
  if (d !== 0) {
    if      (v === r) h = ((g - b) / d % 6) * 60;
    else if (v === g) h = ((b - r) / d + 2) * 60;
    else              h = ((r - g) / d + 4) * 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/** RGB → YCbCr (BT.601, full swing 0-255) */
function _rgbToYCbCr(r, g, b) {
  const y  = clamp(Math.round(  0.299  * r + 0.587  * g + 0.114  * b),       0, 255);
  const cb = clamp(Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b), 0, 255);
  const cr = clamp(Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b), 0, 255);
  return { y, cb, cr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _sample(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pixels = [];
  for (let i = 0; i < w * h; i += SAMPLE_STEP) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  return { pixels, total: pixels.length };
}

function _fitzpatrick(avgL) {
  for (const row of FITZPATRICK_TABLE)
    if (avgL <= row.lMax) return row;
  return FITZPATRICK_TABLE[FITZPATRICK_TABLE.length - 1];
}

function _normaliseHist(hist, total) {
  return Array.from(hist).map(v => +(v / Math.max(1, total) * 100).toFixed(2));
}

function _toHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

function _emptyResult(total, rgb, hsv, ycbcr) {
  return {
    pixelCount: 0, coveragePct: 0, detected: false,
    toneLabel: 'Not detected', fitzpatrickScale: '—',
    avgHSL: { h: 0, s: 0, l: 0 },
    avgRGB: { r: 0, g: 0, b: 0 },
    avgYCbCr: { y: 0, cb: 0, cr: 0 },
    modelAgreement: {
      rgb:   +((rgb   / total) * 100).toFixed(2),
      hsv:   +((hsv   / total) * 100).toFixed(2),
      ycbcr: +((ycbcr / total) * 100).toFixed(2),
      consensus: 0,
    },
    hueHistogram: new Array(32).fill(0),
    luminanceHistogram: new Array(16).fill(0),
    recommendation: 'No skin tone detected in this image.',
    hex: '#808080',
  };
}

/**
 * Generate a Lightroom-style correction recommendation.
 */
function _recommend(hsl, rgb, pct) {
  const tips = [];

  // Warmth
  if (hsl.h > 30) tips.push('Cool the Temperature slider slightly to neutralise warm cast on skin.');
  else if (hsl.h < 15) tips.push('Add warmth (+Temperature) to bring out natural skin tone.');

  // Saturation
  if (hsl.s > 55) tips.push('Reduce HSL Orange Saturation (−10 to −20) to prevent over-saturation.');
  else if (hsl.s < 25) tips.push('Boost HSL Orange Saturation (+5 to +15) for more vibrant skin.');

  // Luminance / exposure
  if (hsl.l > 72) tips.push('Recover highlights: pull Highlights slider (−20 to −40).');
  else if (hsl.l < 35) tips.push('Lift shadows on skin: push Shadows slider (+15 to +30).');

  // Coverage
  if (pct > 40) tips.push('High skin coverage — use Clarity sparingly (−5 to −15) for smoothness.');
  if (pct < 5 && pct > 0) tips.push('Small skin area detected — ensure subject is well-lit.');

  return tips.length ? tips.join(' ') : 'Skin tone looks balanced — minor HSL Orange tweaks may refine further.';
}
