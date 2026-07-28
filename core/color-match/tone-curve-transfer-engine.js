/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Tone Curve Transfer Engine (EPIC 1.4 + 1.5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The single biggest gap in the original Color Transfer Pipeline: tone
 * curves carry a huge portion of a photograph's "look" — the matte
 * shadow lift, the filmic highlight roll-off, the S-curve punch — yet the
 * original color-transfer-engine.js hardcoded neutral curve anchors.
 *
 * This module analyses BOTH the reference and target images' tonal
 * distributions and derives per-channel (Master + R/G/B) tone curve
 * control points that, when applied to the target in Lightroom, shift
 * its tonal character toward the reference's.
 *
 * Method:
 *   1. Sample per-channel cumulative distribution functions (CDFs)
 *   2. Compute percentile-based tonal anchors (13 control points)
 *   3. Derive a mapping curve: for each anchor in the target's CDF,
 *      find the corresponding luminance in the reference's CDF
 *   4. Apply intensity scaling and mode-specific shaping
 *   5. Output 13-point control curves compatible with Lightroom's
 *      ToneCurvePV2012 XMP format
 *
 * EPIC 1.5 additions:
 *   - 13 control points instead of 5 (much more accurate tonal mapping)
 *   - Per-channel curve shaping based on LAB color cast analysis
 *   - Better endpoint handling to preserve dynamic range
 */

import { clamp } from '../color-engine/index.js';
import { rgbToLab, deltaE2000 } from './perceptual-color-science.js';

const MAX_DIM = 400;
const SAMPLE_STEP = 2;

// ── Percentile anchors that define the curve shape ──────────────────────────
// EPIC 1.5: 13 control points instead of 5, giving much more granular control.
// These are evenly distributed across the tonal range:
const ANCHOR_PERCENTILES = [
  0.005, 0.02, 0.05, 0.10, 0.20, 0.35,
  0.50,
  0.65, 0.80, 0.90, 0.95, 0.98, 0.995
];
const ANCHOR_INPUTS = [
  0, 10, 25, 50, 75, 100,
  128,
  155, 180, 205, 230, 245, 255
];

// ── Mode-specific curve shaping ─────────────────────────────────────────────
const CURVE_MODE_PROFILES = {
  Natural:   { shadowLift: 0.6, contrastBoost: 0.5, highlightRolloff: 0.5, channelDivergence: 0.4, curveSmoothing: 0.35 },
  Cinematic: { shadowLift: 0.8, contrastBoost: 0.8, highlightRolloff: 0.7, channelDivergence: 0.7, curveSmoothing: 0.2 },
  Vintage:   { shadowLift: 1.0, contrastBoost: 0.3, highlightRolloff: 0.9, channelDivergence: 0.5, curveSmoothing: 0.4 },
  Soft:      { shadowLift: 0.7, contrastBoost: 0.3, highlightRolloff: 0.8, channelDivergence: 0.3, curveSmoothing: 0.5 },
  Bold:      { shadowLift: 0.5, contrastBoost: 1.0, highlightRolloff: 0.4, channelDivergence: 0.6, curveSmoothing: 0.1 },
};

// ── Sampling ────────────────────────────────────────────────────────────────

function _sampleChannelHistogram(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const hR = new Uint32Array(256);
  const hG = new Uint32Array(256);
  const hB = new Uint32Array(256);
  const hL = new Uint32Array(256);
  let total = 0;

  for (let i = 0; i < data.length; i += 4 * SAMPLE_STEP) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    hR[r]++; hG[g]++; hB[b]++;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hL[Math.min(255, lum)]++;
    total++;
  }

  return { hR, hG, hB, hL, total };
}

function _buildCDF(hist, total) {
  const cdf = new Float64Array(256);
  let cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    cdf[i] = total > 0 ? cumulative / total : i / 255;
  }
  return cdf;
}

function _percentileValue(cdf, pct) {
  for (let i = 0; i < 256; i++) {
    if (cdf[i] >= pct) return i;
  }
  return 255;
}

function _buildAnchors(img) {
  const { hR, hG, hB, hL, total } = _sampleChannelHistogram(img);
  return {
    R: ANCHOR_PERCENTILES.map(p => _percentileValue(_buildCDF(hR, total), p)),
    G: ANCHOR_PERCENTILES.map(p => _percentileValue(_buildCDF(hG, total), p)),
    B: ANCHOR_PERCENTILES.map(p => _percentileValue(_buildCDF(hB, total), p)),
    L: ANCHOR_PERCENTILES.map(p => _percentileValue(_buildCDF(hL, total), p)),
  };
}

// ── Curve derivation ────────────────────────────────────────────────────────

/**
 * Derive a 13-point tone curve that maps target's tonal distribution
 * toward the reference's.
 */
function _deriveMappingCurve(refAnchors, tgtAnchors, intensity, modeProfile) {
  const points = ANCHOR_INPUTS.map((inputX, i) => {
    const refVal = refAnchors[i];
    const tgtVal = tgtAnchors[i];

    const isEndpoint = i === 0 || i === ANCHOR_INPUTS.length - 1;
    const isShadow = i <= 2;
    const isHighlight = i >= ANCHOR_INPUTS.length - 3;

    let shift = refVal - tgtVal;

    if (isShadow) {
      shift *= modeProfile.shadowLift;
    } else if (isHighlight) {
      shift *= modeProfile.highlightRolloff;
    } else {
      shift *= modeProfile.contrastBoost;
    }

    // Graduated endpoint dampening: extreme endpoints are most dampened,
    // adjacent points are less dampened — smoother dynamic range preservation
    if (isEndpoint) {
      shift *= 0.2;
    } else if (i === 1 || i === ANCHOR_INPUTS.length - 2) {
      shift *= 0.4;
    } else if (i === 2 || i === ANCHOR_INPUTS.length - 3) {
      shift *= 0.7;
    }

    shift *= intensity;

    const y = clamp(Math.round(inputX + shift), 0, 255);
    return { x: inputX, y };
  });

  // Ensure smoothness: apply light smoothing to reduce harsh transitions
  const smoothing = modeProfile.curveSmoothing ?? 0.3;
  if (smoothing > 0) {
    const smoothed = points.map(p => ({ ...p }));
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1].y;
      const curr = points[i].y;
      const next = points[i + 1].y;
      smoothed[i].y = Math.round(curr * (1 - smoothing) + (prev + next) / 2 * smoothing);
    }
    points.splice(0, points.length, ...smoothed);
  }

  // Ensure monotonicity
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[i - 1].y) {
      points[i].y = points[i - 1].y;
    }
  }

  const shadowShift = points[2].y - ANCHOR_INPUTS[2];
  const midShift = points[6].y - ANCHOR_INPUTS[6];
  const hiShift = points[10].y - ANCHOR_INPUTS[10];
  const reason = `Shadow ${shadowShift > 0 ? 'lift' : 'drop'} ${Math.abs(shadowShift)}, ` +
                 `midtone ${midShift > 0 ? 'lift' : 'drop'} ${Math.abs(midShift)}, ` +
                 `highlight ${hiShift > 0 ? 'lift' : 'drop'} ${Math.abs(hiShift)}`;

  return { points, reason };
}

/**
 * Derive per-channel (R/G/B) correction curves from the difference
 * between reference and target channel distributions.
 */
function _deriveChannelCurves(refAnchors, tgtAnchors, intensity, channelDivergence) {
  const channels = {};
  for (const ch of ['R', 'G', 'B']) {
    const refPts = refAnchors[ch];
    const tgtPts = tgtAnchors[ch];
    const refL = refAnchors.L;
    const tgtL = tgtAnchors.L;

    const points = ANCHOR_INPUTS.map((inputX, i) => {
      const refChannelDiff = refPts[i] - refL[i];
      const tgtChannelDiff = tgtPts[i] - tgtL[i];
      const channelShift = (refChannelDiff - tgtChannelDiff) * channelDivergence * intensity;

      const y = clamp(Math.round(inputX + channelShift * 0.5), 0, 255);
      return { x: inputX, y };
    });

    // Ensure monotonicity
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[i - 1].y) {
        points[i].y = points[i - 1].y;
      }
    }

    channels[ch] = points;
  }
  return channels;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyse reference and target images and derive tone curves that transfer
 * the reference's tonal character to the target.
 *
 * @param {object} params
 * @param {HTMLImageElement} params.referenceImg
 * @param {HTMLImageElement} params.targetImg
 * @param {number} params.intensity  0–100 strength
 * @param {string} params.mode       one of: Natural, Cinematic, Vintage, Soft, Bold
 * @returns {Promise<{
 *   master: { points: Array<{x,y}>, reason: string },
 *   red: Array<{x,y}>, green: Array<{x,y}>, blue: Array<{x,y}>,
 *   diagnostic: object
 * }>}
 */
export async function deriveToneCurves({ referenceImg, targetImg, intensity = 60, mode = 'Natural' }) {
  const modeProfile = CURVE_MODE_PROFILES[mode] ?? CURVE_MODE_PROFILES.Natural;
  const amt = Math.max(0, Math.min(100, intensity)) / 100;

  const refAnchors = _buildAnchors(referenceImg);
  const tgtAnchors = _buildAnchors(targetImg);

  const master = _deriveMappingCurve(refAnchors.L, tgtAnchors.L, amt, modeProfile);
  const channelCurves = _deriveChannelCurves(refAnchors, tgtAnchors, amt, modeProfile.channelDivergence);

  const diagnostic = {
    refLuminanceProfile: refAnchors.L.map((v, i) => ({
      percentile: Math.round(ANCHOR_PERCENTILES[i] * 100) + '%',
      value: v,
    })),
    tgtLuminanceProfile: tgtAnchors.L.map((v, i) => ({
      percentile: Math.round(ANCHOR_PERCENTILES[i] * 100) + '%',
      value: v,
    })),
    perceptualEndpointDeltaE: {
      shadow: deltaE2000(rgbToLab({r:refAnchors.R[2],g:refAnchors.G[2],b:refAnchors.B[2]}), rgbToLab({r:tgtAnchors.R[2],g:tgtAnchors.G[2],b:tgtAnchors.B[2]})),
      midtone: deltaE2000(rgbToLab({r:refAnchors.R[6],g:refAnchors.G[6],b:refAnchors.B[6]}), rgbToLab({r:tgtAnchors.R[6],g:tgtAnchors.G[6],b:tgtAnchors.B[6]})),
      highlight: deltaE2000(rgbToLab({r:refAnchors.R[10],g:refAnchors.G[10],b:refAnchors.B[10]}), rgbToLab({r:tgtAnchors.R[10],g:tgtAnchors.G[10],b:tgtAnchors.B[10]})),
    },
    channelOffsets: {
      R: refAnchors.R.map((v, i) => v - tgtAnchors.R[i]),
      G: refAnchors.G.map((v, i) => v - tgtAnchors.G[i]),
      B: refAnchors.B.map((v, i) => v - tgtAnchors.B[i]),
    },
    controlPoints: master.points.length,
    mode,
    intensity: Math.round(amt * 100),
  };

  return {
    master,
    red: channelCurves.R,
    green: channelCurves.G,
    blue: channelCurves.B,
    diagnostic,
  };
}

/**
 * Convert derived tone curves into the flat preset fields that
 * reference-xmp-generator.js and preset-engine's serializeXMP() expect.
 */
export function curvesToPresetFields(curves) {
  const m = curves.master.points;

  // Derive parametric values from the master curve's key points.
  // With 13 points, we have more precise anchors:
  //   point[1] = 10th input → shadow adjustment
  //   point[6] = 128 input  → midtone adjustment
  //   point[10] = 230 input → highlight adjustment
  const crv_sh = clamp(Math.round(m[1].y - 10), -20, 20);
  const crv_mid = clamp(Math.round(m[6].y - 128), -20, 20);
  const crv_hi = clamp(Math.round(m[10].y - 230), -20, 20);

  // Parametric darks/lights from adjacent control points
  const crv_darks = clamp(Math.round(m[3].y - 50), -15, 15);
  const crv_lights = clamp(Math.round(m[8].y - 180), -15, 15);

  return {
    parametric: { crv_sh, crv_mid, crv_hi, crv_darks, crv_lights },
    pointCurves: {
      master: curves.master.points,
      red:    curves.red,
      green:  curves.green,
      blue:   curves.blue,
    },
  };
}
