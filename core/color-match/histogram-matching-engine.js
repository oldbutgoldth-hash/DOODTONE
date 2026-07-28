/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Histogram Matching Engine (EPIC 1.5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Histogram matching (histogram specification) transfers the tonal
 * distribution of a reference image onto a target image. This is the
 * "missing link" between palette transfer (per-pixel color) and tone
 * curve transfer (global luminance curve) — it handles the fine-grained
 * per-bin tonal distribution that tone curves approximate but don't
 * precisely capture.
 *
 * Method:
 *   1. Compute CDFs for both reference and target luminance histograms
 *   2. For each luminance bin in the target, find the corresponding
 *      bin in the reference that matches the same CDF percentile
 *   3. Build a mapping curve: target_bin → reference_bin
 *   4. Optionally extend to per-channel (R/G/B) matching
 *   5. Convert the mapping to Lightroom ToneCurvePV2012 point format
 *
 * This module produces curve data compatible with both:
 *   - tone-curve-transfer-engine's output format (for merging)
 *   - curve-engine's serializeCurvePoints() for XMP export
 */

import { clamp } from '../color-engine/index.js';

const MAX_DIM = 400;
const SAMPLE_STEP = 2;
const NUM_BINS = 256;

// ─── Sampling ────────────────────────────────────────────────────────────────

function _sampleImage(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Build per-channel + luminance histograms from pixel data.
 * @returns {{ hR, hG, hB, hL, total }}
 */
function _buildHistograms(data) {
  const hR = new Uint32Array(NUM_BINS);
  const hG = new Uint32Array(NUM_BINS);
  const hB = new Uint32Array(NUM_BINS);
  const hL = new Uint32Array(NUM_BINS);
  let total = 0;

  for (let i = 0; i < data.length; i += 4 * SAMPLE_STEP) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    hR[r]++; hG[g]++; hB[b]++;
    const lum = Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
    hL[lum]++;
    total++;
  }
  return { hR, hG, hB, hL, total };
}

/**
 * Build a CDF from a histogram.
 * @returns {Float64Array} cdf[i] = fraction of pixels with value <= i
 */
function _buildCDF(hist, total) {
  const cdf = new Float64Array(NUM_BINS);
  let cumulative = 0;
  for (let i = 0; i < NUM_BINS; i++) {
    cumulative += hist[i];
    cdf[i] = total > 0 ? cumulative / total : i / 255;
  }
  return cdf;
}

/**
 * Build histogram matching lookup table.
 * For each bin i in the target's CDF, find the bin j in the reference's
 * CDF that has the closest CDF value, and map i → j.
 *
 * @param {Float64Array} refCDF  reference CDF
 * @param {Float64Array} tgtCDF  target CDF
 * @returns {Uint8Array} mapping where mapping[i] = j (target bin i → reference bin j)
 */
function _buildMapping(refCDF, tgtCDF) {
  const mapping = new Uint8Array(NUM_BINS);
  let refIdx = 0;
  for (let i = 0; i < NUM_BINS; i++) {
    const targetCDF = tgtCDF[i];
    // Advance refIdx until we find the closest match
    while (refIdx < NUM_BINS - 1 && Math.abs(refCDF[refIdx + 1] - targetCDF) < Math.abs(refCDF[refIdx] - targetCDF)) {
      refIdx++;
    }
    mapping[i] = refIdx;
  }
  return mapping;
}

/**
 * Smooth a mapping curve to avoid harsh transitions.
 * Uses a simple moving average with window size ~5 bins.
 */
function _smoothMapping(mapping) {
  const smoothed = new Uint8Array(NUM_BINS);
  const halfWin = 3;
  for (let i = 0; i < NUM_BINS; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - halfWin); j <= Math.min(255, i + halfWin); j++) {
      sum += mapping[j];
      count++;
    }
    smoothed[i] = Math.round(sum / count);
  }
  return smoothed;
}

/**
 * Convert a 256-bin lookup mapping into ToneCurvePV2012 point format.
 * We select ~13 evenly-spaced control points for a smooth curve.
 *
 * @param {Uint8Array} mapping  256-bin lookup (input → output)
 * @returns {Array<{x: number, y: number}>} curve points (x=input, y=output, both 0–255)
 */
function _mappingToCurvePoints(mapping) {
  // 13 control points: every 20 bins from 0 to 255, plus endpoints
  const indices = [0, 10, 20, 40, 64, 80, 100, 128, 155, 175, 192, 220, 240, 255];
  const points = [];
  for (const i of indices) {
    points.push({ x: i, y: clamp(mapping[i], 0, 255) });
  }
  // Ensure monotonicity
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[i - 1].y) {
      points[i].y = points[i - 1].y;
    }
  }
  return points;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Perform histogram matching between reference and target images.
 * Returns per-channel and luminance curve mappings.
 *
 * @param {object} params
 * @param {HTMLImageElement} params.referenceImg
 * @param {HTMLImageElement} params.targetImg
 * @param {number} [params.intensity=60]  0–100 strength of the matching
 * @param {string} [params.mode='Natural']  Natural, Cinematic, Vintage, Soft, Bold
 * @returns {Promise<{
 *   master: Array<{x,y}>,
 *   red: Array<{x,y}>,
 *   green: Array<{x,y}>,
 *   blue: Array<{x,y}>,
 *   mapping: Uint8Array,
 *   diagnostic: object
 * }>}
 */
export async function matchHistograms({ referenceImg, targetImg, intensity = 60, mode = 'Natural' }) {
  const amt = clamp(intensity, 0, 100) / 100;

  const refData = _sampleImage(referenceImg);
  const tgtData = _sampleImage(targetImg);

  const refHist = _buildHistograms(refData);
  const tgtHist = _buildHistograms(tgtData);

  // Build CDFs
  const refCDF_L = _buildCDF(refHist.hL, refHist.total);
  const tgtCDF_L = _buildCDF(tgtHist.hL, tgtHist.total);

  const refCDF_R = _buildCDF(refHist.hR, refHist.total);
  const tgtCDF_R = _buildCDF(tgtHist.hR, tgtHist.total);
  const refCDF_G = _buildCDF(refHist.hG, refHist.total);
  const tgtCDF_G = _buildCDF(tgtHist.hG, tgtHist.total);
  const refCDF_B = _buildCDF(refHist.hB, refHist.total);
  const tgtCDF_B = _buildCDF(tgtHist.hB, tgtHist.total);

  // Build raw mappings
  const rawMapping_L = _buildMapping(refCDF_L, tgtCDF_L);
  const rawMapping_R = _buildMapping(refCDF_R, tgtCDF_R);
  const rawMapping_G = _buildMapping(refCDF_G, tgtCDF_G);
  const rawMapping_B = _buildMapping(refCDF_B, tgtCDF_B);

  // Smooth for natural transitions
  const mapping_L = _smoothMapping(rawMapping_L);

  // Apply intensity: blend the mapping with identity (linear)
  const blendedMapping = new Uint8Array(NUM_BINS);
  for (let i = 0; i < NUM_BINS; i++) {
    blendedMapping[i] = Math.round(i * (1 - amt) + mapping_L[i] * amt);
  }

  // Convert to curve points
  const master = _mappingToCurvePoints(blendedMapping);

  // For per-channel, apply lighter blending
  const blendChannel = (rawMapping) => {
    const blended = new Uint8Array(NUM_BINS);
    for (let i = 0; i < NUM_BINS; i++) {
      blended[i] = Math.round(i * (1 - amt * 0.6) + rawMapping[i] * amt * 0.6);
    }
    return _mappingToCurvePoints(blended);
  };

  const red   = blendChannel(rawMapping_R);
  const green = blendChannel(rawMapping_G);
  const blue  = blendChannel(rawMapping_B);

  const diagnostic = {
    refTotalPixels: refHist.total,
    tgtTotalPixels: tgtHist.total,
    mode,
    intensity: Math.round(amt * 100),
    mappingRange: {
      min: Math.min(...blendedMapping),
      max: Math.max(...blendedMapping),
    },
  };

  return { master, red, green, blue, mapping: blendedMapping, diagnostic };
}

/**
 * Merge histogram matching curves with tone-curve-transfer-engine curves.
 * Histogram matching provides the fine-grained shape; tone curves provide
 * the broader tonal character. Merging both gives the best result.
 *
 * @param {Array<{x,y}>} histMaster  from matchHistograms()
 * @param {Array<{x,y}>} tcMaster    from deriveToneCurves()
 * @param {number} [histWeight=0.6]   weight given to histogram matching (vs tone curves)
 * @returns {Array<{x,y>} merged curve points
 */
export function mergeWithToneCurves(histMaster, tcMaster, histWeight = 0.65) {
  const tcWeight = 1 - histWeight;
  const merged = [];
  const numPoints = Math.max(histMaster.length, tcMaster.length);

  // Build lookup tables for both curves
  const histLUT = new Float64Array(256);
  const tcLUT = new Float64Array(256);
  _interpolateToLUT(histMaster, histLUT);
  _interpolateToLUT(tcMaster, tcLUT);

  // Sample at the union of both curves' x-values plus some evenly spaced points
  const xValues = new Set();
  for (const p of histMaster) xValues.add(p.x);
  for (const p of tcMaster) xValues.add(p.x);
  for (let i = 0; i <= 255; i += 10) xValues.add(i);

  const sortedX = [...xValues].sort((a, b) => a - b);
  for (const x of sortedX) {
    const y = Math.round(histLUT[x] * histWeight + tcLUT[x] * tcWeight);
    merged.push({ x, y: clamp(y, 0, 255) });
  }

  // Ensure monotonicity
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].y < merged[i - 1].y) {
      merged[i].y = merged[i - 1].y;
    }
  }

  return merged;
}

/**
 * Interpolate curve points into a 256-element LUT.
 */
function _interpolateToLUT(points, lut) {
  for (let x = 0; x < 256; x++) {
    // Find the two surrounding points
    let left = points[0], right = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].x <= x && points[i + 1].x >= x) {
        left = points[i];
        right = points[i + 1];
        break;
      }
    }
    if (right.x === left.x) {
      lut[x] = left.y;
    } else {
      const t = (x - left.x) / (right.x - left.x);
      lut[x] = left.y + (right.y - left.y) * t;
    }
  }
}
