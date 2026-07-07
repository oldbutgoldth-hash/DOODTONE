/**
 * core/skin-classifier/index.js
 *
 * Triple-model skin detection with spatial coherence check.
 * Replaces the RGB-threshold-only model in histogram-engine that produced
 * high false-positive rates for warm-coloured non-skin objects.
 *
 * Models used:
 *  1. YCbCr  — ITU-R BT.601: luminance + chrominance ranges
 *  2. HSV    — hue/saturation/value skin envelope
 *  3. Chroma-weighted hue — saturation-scaled hue window
 *
 * Spatial coherence:
 *  Divides image into a coarse grid and checks what fraction of cells
 *  contain skin pixels. Real skin (face/body) clusters in few cells.
 *  Warm-coloured textures (wood, stone, autumn) spread across many cells.
 *
 * Public API matches skintone-engine output shape so decision-engine
 * can use either without changes.
 */

import { clamp } from '../color-engine/index.js';

const MAX_DIM   = 320;
const STEP      = 2;
const GRID_COLS = 8;
const GRID_ROWS = 8;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SkinClassification
 * @property {number}  skinPct         0-100 — % of sampled pixels classified as skin
 * @property {number}  coveragePct     alias for skinPct (compat with skintone-engine)
 * @property {boolean} detected        skinPct > threshold
 * @property {number}  confidence      0-1 — how certain the classification is
 * @property {boolean} isFaceCandidate spatial cluster check passed
 * @property {number}  clusterRatio    fraction of grid cells with skin pixels
 * @property {{ h:number, s:number, l:number }} avgHSL  avg HSL of skin pixels
 * @property {{ r:number, g:number, b:number }} avgRGB
 */

/**
 * @param {HTMLImageElement} img
 * @returns {Promise<SkinClassification>}
 */
export function classifySkin(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_classify(img)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _classify(img) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for skin classification');

  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;

  let skinCount=0, total=0;
  let rSum=0, gSum=0, bSum=0, hSum=0, sSum=0, lSum=0;

  // Grid for spatial coherence (GRID_COLS × GRID_ROWS cells)
  const cellW = Math.max(1, Math.floor(w / GRID_COLS));
  const cellH = Math.max(1, Math.floor(h / GRID_ROWS));
  const cellHasSkin = new Uint8Array(GRID_COLS * GRID_ROWS);

  // Per-model vote tallies (for confidence scoring)
  let ycbcrVotes=0, hsvVotes=0, chromaVotes=0;

  for (let py=0; py<h; py+=STEP) {
    for (let px=0; px<w; px+=STEP) {
      const o = (py*w+px)*4;
      const r=data[o], g=data[o+1], b=data[o+2], a=data[o+3];
      if (a < 128) continue;
      total++;

      const isSkin = _tripleTest(r, g, b);
      if (!isSkin) continue;

      skinCount++;
      rSum+=r; gSum+=g; bSum+=b;

      // HSL accumulation for skin pixels
      const hsl = _rgbToHsl(r,g,b);
      hSum+=hsl.h; sSum+=hsl.s; lSum+=hsl.l;

      // Mark grid cell
      const col = Math.min(GRID_COLS-1, Math.floor(px / cellW));
      const row = Math.min(GRID_ROWS-1, Math.floor(py / cellH));
      cellHasSkin[row*GRID_COLS+col] = 1;

      // Count per-model votes
      if (_ycbcr(r,g,b))  ycbcrVotes++;
      if (_hsv(r,g,b))    hsvVotes++;
      if (_chroma(r,g,b)) chromaVotes++;
    }
  }

  const n = Math.max(1, total);
  const sk = Math.max(1, skinCount);
  const skinPct = +((skinCount / n) * 100).toFixed(1);
  const detected = skinPct > 4;

  // Spatial coherence: skin should cluster, not spread everywhere
  const cellsWithSkin = cellHasSkin.reduce((s,v)=>s+v,0);
  const totalCells    = GRID_COLS * GRID_ROWS;
  const clusterRatio  = cellsWithSkin / totalCells;

  // isFaceCandidate: skin is clustered (not all-over like a warm-toned scene)
  // Real portraits: cluster in 15-50% of cells (face + some body)
  // False positives (food, wood, autumn): spread across >60-70% of cells
  const isFaceCandidate = detected && clusterRatio < 0.65;

  // Confidence: how much do models agree?
  // If 3/3 agree → high confidence. If 1/3 → likely false positive
  const modelAgreement = skinCount > 0
    ? (ycbcrVotes + hsvVotes + chromaVotes) / (3 * skinCount)
    : 0;

  const confidence = clamp(
    modelAgreement * 0.6 +
    (isFaceCandidate ? 0.3 : 0) +
    Math.min(0.1, (skinPct > 4 ? 0.1 : 0)),
    0, 1
  );

  // Effective skinPct: discount when clustering suggests false positive
  const effectiveSkinPct = isFaceCandidate
    ? skinPct
    : skinPct * Math.max(0.2, 1 - clusterRatio);  // discount spread-out skin

  const avgHSL = skinCount > 0
    ? { h: Math.round(hSum/sk), s: +(sSum/sk).toFixed(3), l: +(lSum/sk).toFixed(3) }
    : { h: 28, s: 0.45, l: 0.60 };

  const avgRGB = skinCount > 0
    ? { r: Math.round(rSum/sk), g: Math.round(gSum/sk), b: Math.round(bSum/sk) }
    : { r: 190, g: 155, b: 130 };

  const skinWarnings = [];
  if (skinPct > 0 && !isFaceCandidate)
    skinWarnings.push(`Skin pixels found (${skinPct.toFixed(1)}%) but spread across ${(clusterRatio*100).toFixed(0)}% of grid cells — likely warm-toned objects, not face`);
  if (effectiveSkinPct > 60)
    skinWarnings.push(`Very high effective skin coverage (${effectiveSkinPct.toFixed(1)}%) — consider scene context`);
  if (skinCount > 0 && skinCount < 30)
    skinWarnings.push('Very few skin pixels detected — estimate may not be reliable');

  const reason = isFaceCandidate
    ? `Triple-model consensus: ${skinPct.toFixed(1)}% raw, clustered in ${(clusterRatio*100).toFixed(0)}% of grid → face candidate`
    : `Skin pixels spread across ${(clusterRatio*100).toFixed(0)}% of grid → likely false positive, discounted to ${effectiveSkinPct.toFixed(1)}%`;

  return {
    skinPct: +effectiveSkinPct.toFixed(1),
    coveragePct: +effectiveSkinPct.toFixed(1),
    detected: effectiveSkinPct > 4,
    confidence: +confidence.toFixed(3),
    isFaceCandidate,
    clusterRatio: +clusterRatio.toFixed(3),
    rawSkinPct: +skinPct.toFixed(1),
    avgHSL,
    avgRGB,
    // Phase 1
    warnings: skinWarnings,
    reason,
  };
}

// ─── Triple model tests ───────────────────────────────────────────────────────

/**
 * Pixel is classified as skin if at least 2 of 3 models agree.
 * This reduces both false positives (RGB-only) and false negatives.
 */
function _tripleTest(r, g, b) {
  const y = _ycbcr(r,g,b) ? 1 : 0;
  const h = _hsv(r,g,b)   ? 1 : 0;
  const c = _chroma(r,g,b)? 1 : 0;
  return (y + h + c) >= 2;
}

/**
 * YCbCr model — ITU-R BT.601
 * Most reliable single model. Separates chrominance from luminance.
 */
function _ycbcr(r, g, b) {
  const Y  =  0.299*r  + 0.587*g  + 0.114*b;
  const Cb = -0.168736*r - 0.331264*g + 0.5*b + 128;
  const Cr =  0.5*r - 0.418688*g - 0.081312*b + 128;
  return Y > 70 && Y < 240 &&
         Cb > 77 && Cb < 127 &&
         Cr > 133 && Cr < 173;
}

/**
 * HSV model — Hue-Saturation-Value skin envelope
 * Handles variation in lighting better than RGB ranges.
 */
function _hsv(r, g, b) {
  const rn=r/255, gn=g/255, bn=b/255;
  const mx=Math.max(rn,gn,bn), mn=Math.min(rn,gn,bn);
  const d=mx-mn;
  if (mx===0) return false;
  const s=d/mx, v=mx;
  if (s < 0.10 || s > 0.92) return false;  // too grey or too saturated
  if (v < 0.30) return false;               // too dark
  // Hue (degrees)
  let h = 0;
  if (d > 0) {
    if      (mx===rn) h = (60*((gn-bn)/d)+360)%360;
    else if (mx===gn) h = 60*((bn-rn)/d)+120;
    else               h = 60*((rn-gn)/d)+240;
  }
  // Skin hue range: yellow-orange-red (0-25° and 340-360° with saturation check)
  const inHue = (h <= 25 || h >= 340) || (h > 25 && h <= 50 && s > 0.20);
  return inHue;
}

/**
 * Chroma-weighted hue model
 * Uses saturation as a gating condition then checks normalised hue position.
 * Good at catching mid-tone skin that YCbCr misses.
 */
function _chroma(r, g, b) {
  if (r <= g || r <= b) return false;   // red must dominate
  const total = r + g + b;
  if (total < 120) return false;         // too dark overall
  const rn = r/total, gn = g/total, bn = b/total;
  // Skin: normalised R 0.35-0.65, normalised G 0.28-0.40, normalised B 0.10-0.28
  return rn > 0.35 && rn < 0.65 &&
         gn > 0.25 && gn < 0.42 &&
         bn > 0.08 && bn < 0.30 &&
         (r - b) > 20;                  // meaningful R-B spread
}

// ─── Inline HSL (no import cycle risk) ───────────────────────────────────────
function _rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  const l=(mx+mn)/2;
  if (d===0) return {h:0,s:0,l};
  const s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  let h=0;
  if      (mx===r) h=((g-b)/d+(g<b?6:0))*60;
  else if (mx===g) h=((b-r)/d+2)*60;
  else              h=((r-g)/d+4)*60;
  return {h,s,l};
}
