/**
 * core/color-harmony-engine/index.js
 *
 * Color Harmony Engine
 *
 * Extracts the dominant hue from the image (via K-Means palette),
 * then generates all 5 classical colour harmony schemes:
 *
 *   Complementary       → 1 base + 1 opposite (180°)
 *   Analogous           → base + 2 neighbours (±30°)
 *   Triadic             → 3 colours equally spaced (120° apart)
 *   Split Complementary → base + 2 colours flanking the complement (150°, 210°)
 *   Tetradic (Square)   → 4 colours at 90° intervals
 *
 * Each scheme colour is returned with:
 *   hex · rgb · hsl · name · role
 *
 * The engine also scores each scheme for:
 *   balance     how evenly the image's palette is distributed
 *   tension     contrast / visual interest
 *   harmony     perceptual pleasantness
 */

import { rgbToHsl, hslToRgb, clamp } from '../color-engine/index.js';

// ─── Hue angle helpers ────────────────────────────────────────────────────────

/** Normalise angle to [0, 360) */
const norm = h => ((h % 360) + 360) % 360;

/** Angular distance (shortest arc) */
const angDist = (a, b) => {
  const d = Math.abs(norm(a) - norm(b));
  return d > 180 ? 360 - d : d;
};

// ─── Colour name approximation ────────────────────────────────────────────────

const HUE_NAMES = [
  [0,   'Red'],       [15,  'Red-Orange'],  [30,  'Orange'],
  [45,  'Amber'],     [60,  'Yellow'],      [75,  'Yellow-Green'],
  [90,  'Chartreuse'],[120, 'Green'],       [150, 'Spring Green'],
  [165, 'Cyan-Green'],[180, 'Cyan'],        [195, 'Sky Blue'],
  [210, 'Azure'],     [240, 'Blue'],        [255, 'Blue-Violet'],
  [270, 'Violet'],    [285, 'Purple'],      [300, 'Magenta'],
  [315, 'Rose'],      [330, 'Crimson'],     [345, 'Red-Pink'],
];

function hueName(h) {
  h = norm(h);
  let best = HUE_NAMES[0];
  let bestD = 360;
  for (const [angle, name] of HUE_NAMES) {
    const d = angDist(h, angle);
    if (d < bestD) { bestD = d; best = [angle, name]; }
  }
  return best[1];
}

// ─── Colour builder ───────────────────────────────────────────────────────────

function makeColour(h, s, l, role) {
  h = norm(h);
  s = clamp(s, 0.15, 0.95);
  l = clamp(l, 0.20, 0.85);
  const { r, g, b } = hslToRgb(h, s, l);
  const hex = '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  return {
    role,
    name: hueName(h),
    hex,
    rgb:  { r: Math.round(r), g: Math.round(g), b: Math.round(b) },
    hsl:  { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) },
  };
}

// ─── Scheme generators ────────────────────────────────────────────────────────

export function complementary(h, s, l) {
  return {
    name: 'Complementary',
    description: 'Two colours directly opposite (180°). Maximum contrast, high tension.',
    colours: [
      makeColour(h,        s,    l,    'Base'),
      makeColour(h + 180,  s,    l,    'Complement'),
    ],
    scores: { balance: 0.60, tension: 0.95, harmony: 0.70 },
  };
}

export function analogous(h, s, l) {
  return {
    name: 'Analogous',
    description: 'Three adjacent hues (±30°). Natural, serene, low tension.',
    colours: [
      makeColour(h - 30, s * 0.85, l + 0.04, 'Analogous −30°'),
      makeColour(h,      s,         l,         'Base'),
      makeColour(h + 30, s * 0.85, l + 0.04, 'Analogous +30°'),
    ],
    scores: { balance: 0.90, tension: 0.25, harmony: 0.95 },
  };
}

export function triadic(h, s, l) {
  return {
    name: 'Triadic',
    description: 'Three colours equally spaced at 120°. Vibrant, balanced.',
    colours: [
      makeColour(h,       s,         l,         'Primary'),
      makeColour(h + 120, s * 0.90, l + 0.02, 'Triadic 1'),
      makeColour(h + 240, s * 0.90, l + 0.02, 'Triadic 2'),
    ],
    scores: { balance: 0.85, tension: 0.70, harmony: 0.80 },
  };
}

export function splitComplementary(h, s, l) {
  return {
    name: 'Split Complementary',
    description: 'Base + two colours flanking its complement (±30° from 180°). High contrast, less tension than complementary.',
    colours: [
      makeColour(h,       s,         l,         'Base'),
      makeColour(h + 150, s * 0.88, l + 0.03, 'Split 1'),
      makeColour(h + 210, s * 0.88, l + 0.03, 'Split 2'),
    ],
    scores: { balance: 0.75, tension: 0.80, harmony: 0.78 },
  };
}

export function tetradic(h, s, l) {
  return {
    name: 'Tetradic (Square)',
    description: 'Four colours at 90° intervals. Rich, complex; needs careful balance.',
    colours: [
      makeColour(h,       s,         l,         'Primary'),
      makeColour(h +  90, s * 0.88, l + 0.02, 'Secondary'),
      makeColour(h + 180, s * 0.92, l,         'Tertiary'),
      makeColour(h + 270, s * 0.88, l + 0.02, 'Quaternary'),
    ],
    scores: { balance: 0.70, tension: 0.85, harmony: 0.65 },
  };
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HarmonyScheme
 * @property {string}   name
 * @property {string}   description
 * @property {object[]} colours    each: { role, name, hex, rgb, hsl }
 * @property {{ balance: number, tension: number, harmony: number }} scores
 */

/**
 * @typedef {Object} ColorHarmonyResult
 * @property {HarmonyScheme}  complementary
 * @property {HarmonyScheme}  analogous
 * @property {HarmonyScheme}  triadic
 * @property {HarmonyScheme}  splitComplementary
 * @property {HarmonyScheme}  tetradic
 * @property {{ h:number, s:number, l:number }} dominantHSL
 * @property {string}         dominantHex
 * @property {string}         dominantName
 * @property {string}         recommended   name of best scheme for this image
 * @property {string}         summary
 */

/**
 * Generate all 5 harmony schemes from palette result.
 *
 * @param {import('../kmeans-engine/index.js').PaletteResult} palette
 * @returns {ColorHarmonyResult}
 */
export function generateHarmonies(palette) {
  // Use dominant colour as base
  const dom  = palette.dominant;
  const { h, s, l } = dom.hsl;
  const hs   = s / 100;
  const ll   = l / 100;

  const schemes = {
    complementary:      complementary(h, hs, ll),
    analogous:          analogous(h, hs, ll),
    triadic:            triadic(h, hs, ll),
    splitComplementary: splitComplementary(h, hs, ll),
    tetradic:           tetradic(h, hs, ll),
  };

  // Score against actual palette coverage
  const recResult  = _recommend(schemes, palette);
  const recommended = recResult.name;

  // Palette saturation spread — how colourful is the image really?
  const palSats = palette.colors.filter(c => c.hsl.s > 5).map(c => c.hsl.s);
  const avgPalSat = palSats.length > 0 ? palSats.reduce((a,b)=>a+b,0)/palSats.length : 0;

  // Confidence: high when base colour is saturated and palette has enough variety
  const confidence = +Math.min(1, Math.max(0.1,
    (hs > 0.20 ? 0.4 : 0.15) +        // base colour is saturated
    recResult.confidence * 0.4 +       // recommendation certainty
    (palette.colors.length >= 5 ? 0.2 : 0.1)
  )).toFixed(3);

  const warnings = [];
  if (hs < 0.15)       warnings.push('Base colour is near-achromatic — harmony schemes may appear muted');
  if (avgPalSat < 15)  warnings.push('Image palette is mostly desaturated — colour harmony less meaningful');
  if (recResult.matchScore < 0.3) warnings.push('Low palette-to-scheme match — image colours do not strongly conform to any classical harmony');

  return {
    ...schemes,
    dominantHSL:  { h: Math.round(h), s: Math.round(s), l: Math.round(l) },
    dominantHex:  dom.hex,
    dominantName: hueName(h),
    recommended,
    recommendedMatchScore: recResult.matchScore,
    summary: `Base: ${hueName(h)} (${Math.round(h)}°) · Recommended: ${recommended}`,
    // Phase 1 additions
    confidence, warnings,
  };
}

// ─── Recommendation ───────────────────────────────────────────────────────────

/**
 * Pick the scheme whose colour angles best match the actual image palette.
 */
function _recommend(schemes, palette) {
  const palHues = palette.colors
    .filter(c => c.hsl.s > 15)
    .map(c => c.hsl.h);

  if (palHues.length < 2) return { name: 'Complementary', matchScore: 0, confidence: 0.3 };

  let bestScheme = 'Complementary';
  let bestScore  = -1;
  const scores = {};

  for (const [key, scheme] of Object.entries(schemes)) {
    const schemeHues = scheme.colours.map(c => c.hsl.h);
    let matches = 0;
    for (const ph of palHues) {
      if (schemeHues.some(sh => angDist(ph, sh) < 25)) matches++;
    }
    const score = matches / Math.max(palHues.length, 1);
    scores[key] = score;
    if (score > bestScore) { bestScore = score; bestScheme = key; }
  }

  const nameMap = {
    complementary: 'Complementary', analogous: 'Analogous',
    triadic: 'Triadic', splitComplementary: 'Split Complementary', tetradic: 'Tetradic',
  };

  // Confidence: how much better is the best scheme vs second best?
  const sortedScores = Object.values(scores).sort((a,b)=>b-a);
  const margin = sortedScores[0] - (sortedScores[1] ?? 0);
  const confidence = +Math.min(1, 0.3 + margin * 0.7 + (bestScore > 0.6 ? 0.2 : 0)).toFixed(3);

  return { name: nameMap[bestScheme] ?? 'Complementary', matchScore: +bestScore.toFixed(3), confidence };
}
