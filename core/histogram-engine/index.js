/**
 * histogram-engine  v3
 *
 * Phase 1 Accuracy Foundation changes:
 *  - drStops: protect against blackPoint=0 (was log2(0) → -Infinity)
 *  - drStops: use p1/p99 percentiles, not raw min/max — more robust
 *  - Added confidence score (0-1) reflecting reliability of measurements
 *  - Added warnings[] array for edge-case conditions
 *  - skinPct: still uses loose RGB model (intentional — skin-classifier is
 *    the accurate path; this value is retained for backward compat only)
 */

import { luminance, rgbToHsl } from '../color-engine/index.js';

const MAX_DIM  = 380;
const CLIP_HI  = 250;
const CLIP_LO  = 5;

export function analyzeImage(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_compute(img)); }
      catch (err) { reject(err); }
    }, 100);
  });
}

function _compute(img) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready — naturalWidth is 0');

  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const histL = new Uint32Array(256);
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);

  let rSum = 0, gSum = 0, bSum = 0, satSum = 0;
  let clipHi = 0, clipLo = 0, skinCount = 0, total = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] < 128) continue;  // skip transparent pixels
    const lum = Math.min(255, Math.round(luminance(r, g, b)));

    histL[lum]++; histR[r]++; histG[g]++; histB[b]++;
    rSum += r; gSum += g; bSum += b;
    satSum += rgbToHsl(r, g, b).s;
    total++;

    if (r >= CLIP_HI || g >= CLIP_HI || b >= CLIP_HI) clipHi++;
    if (r <= CLIP_LO && g <= CLIP_LO && b <= CLIP_LO) clipLo++;

    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (r > 95 && g > 40 && b > 20 && (mx - mn) > 15 && Math.abs(r - g) > 15 && r > g && r > b)
      skinCount++;
  }

  if (total === 0) {
    // Completely transparent or empty image
    return _emptyResult();
  }

  const pct = (hist, p) => {
    const target = p * total; let cum = 0;
    for (let i = 0; i < 256; i++) { cum += hist[i]; if (cum >= target) return i; }
    return 255;
  };

  // Use p0.5/p99.5 for black/white points (robust to isolated outliers)
  const blackPoint = pct(histL, 0.005);
  const whitePoint = pct(histL, 0.995);
  const median     = pct(histL, 0.5);
  // p1/p99 for dynamic range — more stable than min/max
  const p1  = pct(histL, 0.01);
  const p99 = pct(histL, 0.99);

  let lumSum = 0;
  for (let i = 0; i < 256; i++) lumSum += i * histL[i];
  const avgLum = lumSum / total;

  let varSum = 0;
  for (let i = 0; i < 256; i++) varSum += (i - avgLum) ** 2 * histL[i];
  const contrast = Math.round(Math.sqrt(varSum / total));

  const avgR = rSum / total, avgG = gSum / total, avgB = bSum / total;
  const rbDiff = avgR - avgB;
  const gDiff  = avgG - (avgR + avgB) / 2;

  // Dynamic range: use p1/p99 to avoid log2(0) when blackPoint=0
  // Guard: if p99 <= p1 (rare, near-uniform image), drStops = 0
  const drStops = p99 > p1
    ? +(Math.log2(Math.max(1, p99) / Math.max(1, p1))).toFixed(2)
    : 0;

  // Weber contrast ratio (p90 / p10 — tighter window for stability)
  const lo10 = pct(histL, 0.10);
  const hi90 = pct(histL, 0.90);
  const contrastRatio = lo10 > 0
    ? +(hi90 / lo10).toFixed(1)
    : +(hi90).toFixed(1);

  const clipHiPct = +((clipHi / total) * 100).toFixed(2);
  const clipLoPct = +((clipLo / total) * 100).toFixed(2);

  const skinPct      = Math.round((skinCount / total) * 100);
  const skinDetected = skinPct > 3;

  let category = 'General';
  if      (skinPct > 12)           category = 'Portrait';
  else if (skinPct > 3)            category = 'Wedding';
  else if (satSum / total > 0.35)  category = 'Landscape';
  else                             category = 'Travel';

  // ── Confidence score ──────────────────────────────────────────────────────
  // Reflect how trustworthy this measurement set is.
  // Degraded by: extreme clipping, very small pixel count, near-uniform image
  const clipPenalty    = Math.min(0.4, (clipHiPct + clipLoPct) / 100 * 2);
  const uniformPenalty = drStops < 1 ? 0.2 : 0;          // near-uniform image
  const sizePenalty    = total < 500 ? 0.15 : 0;          // very downscaled
  const confidence     = +Math.max(0, 1 - clipPenalty - uniformPenalty - sizePenalty).toFixed(3);

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];
  if (clipHiPct > 5)  warnings.push(`High highlight clipping: ${clipHiPct}%`);
  if (clipLoPct > 5)  warnings.push(`High shadow clipping: ${clipLoPct}%`);
  if (drStops < 1.5)  warnings.push(`Very low dynamic range (${drStops} EV) — near-uniform image`);
  if (drStops > 14)   warnings.push(`Unusually high dynamic range (${drStops} EV) — possible HDR or artifact`);
  if (total < 500)    warnings.push(`Small pixel sample (${total} px) — accuracy reduced`);
  if (Math.abs(rbDiff) > 40) warnings.push(`Strong colour cast (rbDiff=${rbDiff.toFixed(1)}) — may affect WB`);

  return {
    // histograms (unchanged — backward compat)
    histL, histR, histG, histB,
    // luminance stats
    median: Math.round(median), blackPoint, whitePoint,
    avgLum: Math.round(avgLum), contrast,
    dynamicRange: whitePoint - blackPoint,
    // dynamic range (improved)
    drStops, contrastRatio,
    clipHiPct, clipLoPct, clipHiCount: clipHi, clipLoCount: clipLo,
    // color
    avgSatPct: Math.round((satSum / total) * 100),
    rbDiff: +rbDiff.toFixed(2), gDiff: +gDiff.toFixed(2),
    avgR: Math.round(avgR), avgG: Math.round(avgG), avgB: Math.round(avgB),
    // scene
    skinDetected, skinPct, category, total,
    // Phase 1 additions
    confidence,
    warnings,
  };
}

function _emptyResult() {
  return {
    histL: new Uint32Array(256), histR: new Uint32Array(256),
    histG: new Uint32Array(256), histB: new Uint32Array(256),
    median: 0, blackPoint: 0, whitePoint: 0, avgLum: 0, contrast: 0,
    dynamicRange: 0, drStops: 0, contrastRatio: 1,
    clipHiPct: 0, clipLoPct: 0, clipHiCount: 0, clipLoCount: 0,
    avgSatPct: 0, rbDiff: 0, gDiff: 0, avgR: 0, avgG: 0, avgB: 0,
    skinDetected: false, skinPct: 0, category: 'General', total: 0,
    confidence: 0, warnings: ['Image has no visible pixels'],
  };
}
