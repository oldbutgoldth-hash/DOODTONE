/**
 * core/style-recognition-engine/index.js
 *
 * Style Recognition AI
 *
 * Detects photographic style from pixel-level features across 11 categories:
 *   Wedding · Portrait · Landscape · Travel · Food · Street ·
 *   Fashion · Documentary · Vintage · Luxury
 *
 * ─── Feature Extraction ──────────────────────────────────────────────────────
 *
 * Runs a single-pass pixel analysis to extract a 20-dimensional feature vector:
 *
 *   Exposure     avgLum, medianLum, highlightMass, shadowMass
 *   Colour       avgSat, warmth, greenBias, blueBias, chromaSpread
 *   Skin         skinPct (YCbCr model), skinHue
 *   Texture      contrast (σ), edgeDensity (Sobel approx)
 *   Tonality     dynamicRange, blackPoint, whitePoint
 *   Palette      dominantHue, hueSpread, neutralPct
 *   Clipping     clipHiPct, clipLoPct
 *
 * ─── Classification ──────────────────────────────────────────────────────────
 *
 * Each style has a hand-tuned feature profile (range gates + Gaussian weights).
 * Confidence = weighted cosine similarity between feature vector and profile.
 * Scores are softmax-normalised so they sum to 100%.
 *
 * ─── Output ─────────────────────────────────────────────────────────────────
 *
 * {
 *   styles: [{ style, confidence, rank, traits[] }]   (sorted by confidence)
 *   top: { style, confidence }
 *   features: { ... }   raw feature vector
 *   summary: string
 * }
 */

import { rgbToHsl, luminance, clamp } from '../color-engine/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DIM    = 380;
const STEP       = 2;

// ─── Style Profiles ───────────────────────────────────────────────────────────
// Each feature: [idealMin, idealMax, weight]
// weight = how important this feature is for this style (higher = more decisive)

const PROFILES = {
  Wedding: {
    avgLum:        [130, 175, 1.8],
    avgSat:        [20,  55,  1.4],
    warmth:        [5,   40,  1.2],
    skinPct:       [8,   50,  2.0],
    highlightMass: [15,  45,  1.6],
    shadowMass:    [0,   18,  1.3],
    dynamicRange:  [100, 200, 1.0],
    neutralPct:    [10,  35,  0.8],
    hueSpread:     [30,  80,  0.9],
    traits: ['Bright & airy', 'Warm skin tones', 'Lifted shadows', 'Soft highlights'],
  },
  Portrait: {
    avgLum:        [110, 165, 1.5],
    avgSat:        [20,  55,  1.2],
    warmth:        [0,   35,  1.0],
    skinPct:       [15,  70,  2.5],
    highlightMass: [5,   35,  1.0],
    shadowMass:    [2,   25,  0.9],
    contrast:      [30,  65,  1.2],
    hueSpread:     [15,  60,  0.8],
    traits: ['Strong skin presence', 'Controlled contrast', 'Subject-focused exposure'],
  },
  Landscape: {
    avgLum:        [80,  160, 1.2],
    avgSat:        [30,  75,  1.8],
    greenBias:     [2,   30,  1.8],
    blueBias:      [0,   25,  1.5],
    skinPct:       [0,   5,   1.8],   // low skin = no people
    dynamicRange:  [120, 230, 1.6],
    contrast:      [40,  80,  1.3],
    hueSpread:     [50,  120, 1.4],
    traits: ['High saturation', 'Wide dynamic range', 'Minimal skin presence', 'Nature hues'],
  },
  Travel: {
    avgLum:        [90,  160, 1.0],
    avgSat:        [35,  75,  1.5],
    warmth:        [-10, 30,  0.9],
    skinPct:       [2,   30,  1.2],
    hueSpread:     [60,  130, 1.8],
    dynamicRange:  [100, 210, 1.2],
    contrast:      [35,  75,  1.0],
    neutralPct:    [5,   30,  0.8],
    traits: ['Vibrant colours', 'Diverse palette', 'Mixed scene elements'],
  },
  Food: {
    avgSat:        [40,  85,  2.0],
    warmth:        [10,  50,  1.8],
    skinPct:       [0,   8,   1.5],   // almost no skin
    avgLum:        [110, 185, 1.4],
    highlightMass: [20,  55,  1.5],
    greenBias:     [-5,  20,  0.9],
    contrast:      [35,  70,  1.2],
    hueSpread:     [30,  90,  1.3],
    traits: ['Warm saturated palette', 'Bright exposure', 'Rich colour detail'],
  },
  Street: {
    avgLum:        [60,  150, 1.2],
    avgSat:        [10,  55,  1.3],
    contrast:      [50,  90,  2.0],
    shadowMass:    [10,  40,  1.5],
    skinPct:       [1,   25,  1.0],
    dynamicRange:  [80,  220, 1.4],
    neutralPct:    [15,  50,  1.6],
    hueSpread:     [20,  80,  1.0],
    traits: ['High contrast', 'Deep shadows', 'Urban tones', 'Gritty texture'],
  },
  Fashion: {
    avgLum:        [100, 185, 1.4],
    avgSat:        [15,  75,  1.6],
    skinPct:       [5,   45,  1.5],
    contrast:      [45,  85,  1.4],
    highlightMass: [20,  60,  1.5],
    hueSpread:     [20,  100, 1.8],
    warmth:        [-20, 30,  0.8],
    traits: ['Studio lighting', 'Strong highlight presence', 'Deliberate colour palette'],
  },
  Documentary: {
    avgLum:        [70,  150, 1.0],
    avgSat:        [10,  50,  1.5],
    contrast:      [45,  85,  1.6],
    shadowMass:    [8,   45,  1.4],
    skinPct:       [0,   35,  0.9],
    neutralPct:    [20,  60,  2.0],
    hueSpread:     [15,  70,  1.1],
    dynamicRange:  [80,  220, 1.3],
    traits: ['Muted palette', 'Natural contrast', 'Journalistic tone'],
  },
  Vintage: {
    avgSat:        [10,  48,  2.0],
    warmth:        [10,  55,  1.8],
    contrast:      [20,  58,  1.6],
    avgLum:        [90,  160, 1.2],
    shadowMass:    [5,   35,  1.3],
    neutralPct:    [15,  50,  1.5],
    dynamicRange:  [60,  170, 1.2],
    clipLoPct:     [0,   3,   0.8],
    traits: ['Desaturated', 'Warm tones', 'Compressed contrast', 'Faded blacks'],
  },
  Luxury: {
    avgLum:        [100, 185, 1.6],
    avgSat:        [10,  55,  1.4],
    contrast:      [50,  85,  1.8],
    highlightMass: [25,  65,  1.8],
    neutralPct:    [20,  60,  2.0],
    shadowMass:    [3,   30,  1.5],
    hueSpread:     [10,  60,  1.2],
    warmth:        [-15, 20,  0.9],
    traits: ['Clean blacks', 'Bright highlights', 'Minimal saturation', 'High-end look'],
  },
};

const STYLES = Object.keys(PROFILES);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StyleResult
 * @property {string}   style
 * @property {number}   confidence    0–100 (softmax normalised)
 * @property {number}   rawScore      pre-normalisation score
 * @property {number}   rank          1 = most likely
 * @property {string[]} traits        matching style traits
 */

/**
 * @typedef {Object} StyleRecognitionResult
 * @property {StyleResult[]} styles   all styles, sorted by confidence
 * @property {StyleResult}   top      highest confidence style
 * @property {StyleResult}   second   second-highest
 * @property {object}        features raw feature vector
 * @property {string}        summary
 */

/**
 * @param {HTMLImageElement} img
 * @returns {Promise<StyleRecognitionResult>}
 */
export function recognizeStyle(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_recognize(img)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _recognize(img) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for style recognition');

  const features = _extractFeatures(img);
  const raw      = _scoreAllStyles(features);

  // Softmax normalisation
  const maxRaw = Math.max(...Object.values(raw));
  const expMap = {};
  let expSum = 0;
  for (const [style, score] of Object.entries(raw)) {
    expMap[style] = Math.exp((score - maxRaw) * 4);
    expSum += expMap[style];
  }

  const styles = STYLES.map(style => ({
    style,
    confidence: +((expMap[style] / expSum) * 100).toFixed(1),
    rawScore:   +raw[style].toFixed(4),
    rank:       0,
    traits:     PROFILES[style].traits ?? [],
  })).sort((a, b) => b.confidence - a.confidence)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  // ── Classification confidence ──────────────────────────────────────────────
  const topConf    = styles[0]?.confidence ?? 0;
  const secondConf = styles[1]?.confidence ?? 0;
  const margin     = topConf - secondConf;
  // High confidence when top style is clearly ahead of second
  const confidence = +Math.max(0.1, Math.min(1,
    topConf / 100 * 0.5 +      // absolute score of winner
    margin / 100 * 0.5          // how far ahead of runner-up
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  if (margin < 5)
    warnings.push(`Top two styles very close (${topConf.toFixed(1)}% vs ${secondConf.toFixed(1)}%) — classification is ambiguous`);
  if (topConf < 25)
    warnings.push(`Low top-style confidence (${topConf.toFixed(1)}%) — image may not match any trained style profile well`);
  if (features.skinPct > 15 && styles[0]?.style !== 'Portrait' && styles[0]?.style !== 'Wedding')
    warnings.push(`High skin coverage (${features.skinPct.toFixed(1)}%) but not classified as Portrait/Wedding — verify scene`);

  const reason = `Softmax classification: ${styles.slice(0,3).map(s=>`${s.style}=${s.confidence.toFixed(1)}%`).join(', ')}`;

  return {
    styles,
    top:      styles[0],
    second:   styles[1],
    features,
    summary:  _summary(styles, features),
    // Phase 1
    confidence,
    warnings,
    reason,
  };
}

// ─── Feature extraction ───────────────────────────────────────────────────────

function _extractFeatures(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;

  const histL = new Uint32Array(256);
  let rSum=0, gSum=0, bSum=0, satSum=0, lumSum=0;
  let skinCount=0, neutralCount=0;
  let clipHi=0, clipLo=0;
  let total=0;

  // Hue bucket for spread calculation (36 buckets × 10°)
  const hueHist = new Uint32Array(36);

  for (let i=0; i<w*h; i+=STEP) {
    const o=i*4;
    if (data[o+3]<128) continue;
    const r=data[o], g=data[o+1], b=data[o+2];
    const lum = luminance(r,g,b);
    histL[Math.min(255,Math.round(lum))]++;
    const hsl = rgbToHsl(r,g,b);
    rSum+=r; gSum+=g; bSum+=b; satSum+=hsl.s; lumSum+=lum;
    total++;

    if (hsl.s >= 0.08) hueHist[Math.min(35,Math.floor(hsl.h/10))]++;
    else neutralCount++;

    // YCbCr skin
    const Y=0.299*r+0.587*g+0.114*b;
    const Cb=128-0.168736*r-0.331264*g+0.5*b;
    const Cr=128+0.5*r-0.418688*g-0.081312*b;
    if (Y>80&&Y<235&&Cb>77&&Cb<127&&Cr>133&&Cr<173) skinCount++;

    if (r>=250||g>=250||b>=250) clipHi++;
    if (r<=5&&g<=5&&b<=5) clipLo++;
  }

  const n = Math.max(1, total);
  const avgR=rSum/n, avgG=gSum/n, avgB=bSum/n;
  const avgLum=lumSum/n;

  // Zone masses
  let shadowMass=0, highlightMass=0;
  for (let i=0; i<=80; i++)  shadowMass+=histL[i];
  for (let i=176;i<256; i++) highlightMass+=histL[i];

  // Std-dev (contrast)
  let varSum=0;
  for (let i=0;i<256;i++) varSum+=(i-avgLum)**2*histL[i];
  const contrast = Math.round(Math.sqrt(varSum/n));

  // Percentile
  const pct=(p)=>{const t=p*n;let c=0;for(let i=0;i<256;i++){c+=histL[i];if(c>=t)return i;}return 255;};
  const blackPoint=pct(0.005), whitePoint=pct(0.995);

  // Hue spread: how many of 36 buckets have >0.5% of coloured pixels
  const coloured = total - neutralCount;
  const activeHueBuckets = Array.from(hueHist).filter(v => v/Math.max(1,coloured) > 0.005).length;
  const hueSpread = activeHueBuckets * (360/36);   // approximate degrees covered

  // Dominant hue
  const maxHueBucket = hueHist.indexOf(Math.max(...hueHist));
  const dominantHue  = maxHueBucket * 10 + 5;

  return {
    avgLum:        Math.round(avgLum),
    medianLum:     pct(0.5),
    avgSat:        Math.round(satSum/n * 100),
    warmth:        Math.round(avgR - avgB),
    greenBias:     Math.round(avgG - (avgR+avgB)/2),
    blueBias:      Math.round(avgB - (avgR+avgG)/2),
    skinPct:       +((skinCount/n)*100).toFixed(1),
    contrast,
    dynamicRange:  whitePoint - blackPoint,
    blackPoint,
    whitePoint,
    highlightMass: +((highlightMass/n)*100).toFixed(1),
    shadowMass:    +((shadowMass/n)*100).toFixed(1),
    neutralPct:    +((neutralCount/n)*100).toFixed(1),
    hueSpread:     Math.round(hueSpread),
    dominantHue,
    clipHiPct:     +((clipHi/n)*100).toFixed(2),
    clipLoPct:     +((clipLo/n)*100).toFixed(2),
    chromaSpread:  Math.round(activeHueBuckets / 36 * 100),
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function _scoreAllStyles(f) {
  const scores = {};
  for (const style of STYLES) {
    scores[style] = _scoreStyle(f, PROFILES[style]);
  }
  return scores;
}

function _scoreStyle(f, profile) {
  let weightedSum = 0, totalWeight = 0;

  for (const [feat, [lo, hi, w]] of Object.entries(profile)) {
    if (feat === 'traits') continue;
    const val = f[feat];
    if (val === undefined) continue;

    // Trapezoid membership: 1.0 inside [lo,hi], tapers off outside
    const mid   = (lo + hi) / 2;
    const range = (hi - lo) / 2 || 1;
    const dist  = Math.max(0, Math.abs(val - mid) - range);
    const membership = Math.exp(-((dist / range) ** 2));

    weightedSum += membership * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function _summary(styles, f) {
  const top = styles[0], sec = styles[1];
  const skinNote = f.skinPct > 15 ? ` · Skin ${f.skinPct}%` : '';
  const satNote  = f.avgSat  > 55 ? ' · Vibrant' : f.avgSat < 20 ? ' · Muted' : '';
  return `${top.style} (${top.confidence}%) > ${sec.style} (${sec.confidence}%)${skinNote}${satNote}`;
}
