/**
 * core/single-image/white-balance-estimators/neutral-region-estimator.js
 *
 * EPIC 2E-P1I — genuine neutral-REGION estimator: groups accepted
 * pixels into a coarse grid, classifies grid cells as neutral
 * candidates, then flood-fills adjacent qualifying cells into
 * connected regions. This is deliberately region-level, not a flat
 * neutral-pixel list (whitebalance-engine's existing
 * `_filterNeutralCandidates()` already does the flat-list version) —
 * region-level aggregation is what lets this estimator require
 * genuine spatial continuity and area, and reject skin-dominated or
 * specular-only "regions" that a flat pixel filter cannot distinguish
 * from a real neutral wall/backdrop.
 */

import { ESTIMATOR_ID, ESTIMATOR_STATUS, REJECTION_REASON, unavailableResult } from './wb-estimator-schema.js';
import {
  meanToNeutralGains, gainsToTempTint, castAxisFromTempTint, safeClamp,
  isLikelySkinPixelYCbCr,
} from './wb-color-math.js';

const CELL_SIZE = 12;              // px, at analysis resolution — grid coarseness
const NEUTRAL_SAT_MAX = 0.14;      // cell mean saturation must be at/below this to be a neutral candidate cell
const NEUTRAL_LUM_MIN = 40;        // matches whitebalance-engine's existing neutral-candidate luminance band
const NEUTRAL_LUM_MAX = 235;
const MIN_CELL_PIXELS = 3;         // a cell needs at least this many accepted pixels to be classified at all
const MIN_REGION_PIXELS = 60;      // a connected region needs at least this many total pixels to be "sufficient area"
const MIN_REGION_CELL_SPAN = 2;    // region must span >=2 cells in BOTH x and y — rejects thin one-cell-wide slivers (specular streaks)
const SKIN_DOMINATION_RATIO = 0.5; // if >=50% of a candidate region's pixels are skin-toned, the region is skin-dominated, not a neutral reference

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateNeutralRegion(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;
  const width = sample?.width ?? 0, height = sample?.height ?? 0;

  if (!accepted.length || !width || !height) {
    return unavailableResult(ESTIMATOR_ID.NEUTRAL_REGION, REJECTION_REASON.NO_NEUTRAL_CANDIDATES, {
      sampleCount: totalScanned, rejectedPixelCount: totalScanned,
    });
  }

  const cols = Math.max(1, Math.ceil(width / CELL_SIZE));
  const rows = Math.max(1, Math.ceil(height / CELL_SIZE));
  const cells = new Map(); // key `${cx},${cy}` -> {pixels:[], skinCount:number}

  for (const px of accepted) {
    const cx = Math.min(cols - 1, Math.floor(px.x / CELL_SIZE));
    const cy = Math.min(rows - 1, Math.floor(px.y / CELL_SIZE));
    const key = `${cx},${cy}`;
    let cell = cells.get(key);
    if (!cell) { cell = { cx, cy, pixels: [], skinCount: 0 }; cells.set(key, cell); }
    cell.pixels.push(px);
    if (isLikelySkinPixelYCbCr(px.r, px.g, px.b)) cell.skinCount++;
  }

  // Classify neutral-candidate cells
  const neutralCells = new Map();
  for (const [key, cell] of cells) {
    if (cell.pixels.length < MIN_CELL_PIXELS) continue;
    const n = cell.pixels.length;
    const meanSat = cell.pixels.reduce((s, p) => s + p.sat, 0) / n;
    const meanLum = cell.pixels.reduce((s, p) => s + p.lum, 0) / n;
    if (meanSat > NEUTRAL_SAT_MAX) continue;
    if (meanLum < NEUTRAL_LUM_MIN || meanLum > NEUTRAL_LUM_MAX) continue;
    neutralCells.set(key, cell);
  }

  if (neutralCells.size === 0) {
    return unavailableResult(ESTIMATOR_ID.NEUTRAL_REGION, REJECTION_REASON.NO_NEUTRAL_CANDIDATES, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  // Flood-fill connected regions over the neutral-candidate cell grid (4-connectivity)
  const visited = new Set();
  const regions = [];
  for (const key of neutralCells.keys()) {
    if (visited.has(key)) continue;
    const stack = [key];
    const regionCells = [];
    visited.add(key);
    while (stack.length) {
      const k = stack.pop();
      const cell = neutralCells.get(k);
      regionCells.push(cell);
      const { cx, cy } = cell;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cy + dy}`;
        if (neutralCells.has(nk) && !visited.has(nk)) { visited.add(nk); stack.push(nk); }
      }
    }
    regions.push(regionCells);
  }

  // Score each region: total pixels, skin domination, spatial span (reject slivers)
  const scored = regions.map(regionCells => {
    const pixels = regionCells.flatMap(c => c.pixels);
    const skinCount = regionCells.reduce((s, c) => s + c.skinCount, 0);
    const minCx = Math.min(...regionCells.map(c => c.cx)), maxCx = Math.max(...regionCells.map(c => c.cx));
    const minCy = Math.min(...regionCells.map(c => c.cy)), maxCy = Math.max(...regionCells.map(c => c.cy));
    const spanX = maxCx - minCx + 1, spanY = maxCy - minCy + 1;
    return { pixels, cellCount: regionCells.length, pixelCount: pixels.length, skinRatio: pixels.length ? skinCount / pixels.length : 0, spanX, spanY };
  });

  const eligible = scored.filter(r => r.pixelCount >= MIN_REGION_PIXELS);
  if (eligible.length === 0) {
    return unavailableResult(ESTIMATOR_ID.NEUTRAL_REGION, REJECTION_REASON.REGION_TOO_SMALL, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  const specularOnly = eligible.every(r => r.spanX < MIN_REGION_CELL_SPAN || r.spanY < MIN_REGION_CELL_SPAN);
  if (specularOnly) {
    return unavailableResult(ESTIMATOR_ID.NEUTRAL_REGION, REJECTION_REASON.SPECULAR_ONLY, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }
  const spatiallyValid = eligible.filter(r => r.spanX >= MIN_REGION_CELL_SPAN && r.spanY >= MIN_REGION_CELL_SPAN);

  const nonSkinDominated = spatiallyValid.filter(r => r.skinRatio < SKIN_DOMINATION_RATIO);
  if (nonSkinDominated.length === 0) {
    return unavailableResult(ESTIMATOR_ID.NEUTRAL_REGION, REJECTION_REASON.DOMINATED_BY_SKIN, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  // Primary region = largest surviving by pixel count
  nonSkinDominated.sort((a, b) => b.pixelCount - a.pixelCount);
  const primary = nonSkinDominated[0];
  const n = primary.pixels.length;
  const meanR = primary.pixels.reduce((s, p) => s + p.r, 0) / n;
  const meanG = primary.pixels.reduce((s, p) => s + p.g, 0) / n;
  const meanB = primary.pixels.reduce((s, p) => s + p.b, 0) / n;
  const meanSat = primary.pixels.reduce((s, p) => s + p.sat, 0) / n;

  const gains = meanToNeutralGains(meanR, meanG, meanB);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);

  const totalNeutralArea = nonSkinDominated.reduce((s, r) => s + r.pixelCount, 0);
  const areaFactor = safeClamp(totalNeutralArea / Math.max(1, accepted.length), 0, 1);
  const regionCountFactor = safeClamp(nonSkinDominated.length / 3, 0, 1); // more corroborating regions = more confidence, caps at 3
  const cleanlinessFactor = safeClamp(1 - meanSat / NEUTRAL_SAT_MAX, 0, 1);
  const sizeFactor = safeClamp(primary.pixelCount / 300, 0, 1);

  let confidence = safeClamp(
    0.30 * sizeFactor +
    0.25 * areaFactor +
    0.25 * cleanlinessFactor +
    0.20 * regionCountFactor,
    0, 1
  );

  const warnings = [];
  if (nonSkinDominated.length === 1 && primary.pixelCount < 150) {
    warnings.push('Only one modest-sized neutral region found — estimate has limited corroboration.');
  }

  return {
    estimatorId: ESTIMATOR_ID.NEUTRAL_REGION,
    status: ESTIMATOR_STATUS.OK,
    confidence: +confidence.toFixed(3),
    estimate: {
      rgbGain: { r: gainR, g: gainG, b: gainB },
      temperatureIntent: temperature, tintIntent: tint,
      castAxis, castStrength: +castStrength.toFixed(3),
    },
    evidence: {
      sampleCount: totalScanned,
      acceptedPixelCount: n,
      rejectedPixelCount: totalScanned - n,
      luminanceRange: { min: Math.round(Math.min(...primary.pixels.map(p => p.lum))), max: Math.round(Math.max(...primary.pixels.map(p => p.lum))) },
      saturationRange: { min: +Math.min(...primary.pixels.map(p => p.sat)).toFixed(3), max: +Math.max(...primary.pixels.map(p => p.sat)).toFixed(3) },
      clippingRate: 0,
      spatialCoverage: +areaFactor.toFixed(3),
    },
    diagnostics: {
      rejectionReason: null, warnings,
      regionCount: nonSkinDominated.length,
      totalNeutralArea,
      primaryRegionPixelCount: primary.pixelCount,
    },
  };
}
