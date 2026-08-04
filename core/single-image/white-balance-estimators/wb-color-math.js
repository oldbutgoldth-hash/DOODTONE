/**
 * core/single-image/white-balance-estimators/wb-color-math.js
 *
 * EPIC 2E-P1I — shared, documented colour math for every pixel-level
 * White Balance estimator in this module family. Centralised here so
 * no formula is duplicated per-estimator (per the P1I spec's Color-
 * Math Policy: "avoid duplicated formulas across modules").
 *
 * ── Color space policy (documented, not silent) ─────────────────────
 * All gain/ratio computation in this module family runs in
 * GAMMA-ENCODED sRGB (the raw 0-255 bytes Canvas 2D's getImageData()
 * returns), matching core/whitebalance-engine/index.js's existing
 * _grayWorld/_whitePatch/_shadesOfGray, which have always operated
 * directly on gamma-encoded RGB (classic Gray World / White Patch /
 * Shades-of-Gray literature is conventionally applied this way — these
 * are white-BALANCE gain estimators, not photometric/appearance
 * models, so linearisation is not required for correctness and adding
 * it here would silently diverge from the existing engine's numbers
 * for the same scene). See P1I_WHITE_BALANCE_COLOR_MATH.md for the
 * full policy writeup and the explicit alternative (linear/XYZ) that
 * was considered and rejected for this reason.
 *
 * Luminance banding (used by the highlight/shadow estimator and pixel
 * sampler's near-black rejection) reuses core/color-engine/index.js's
 * existing luminance() — the SAME ITU-R BT.709-weighted, gamma-space
 * formula every other engine in this project already uses for
 * luminance (image-analysis-core's histL, whitebalance-engine's own
 * neutral-candidate luminance filter, color-cast-detector's tonal
 * zones). Never re-derived, never mixed with a linear-light luminance.
 *
 * Every function here is pure, DOM-free, and rejects NaN/Infinity
 * inputs safely (falls back to a neutral/zero value rather than
 * propagating a poisoned number downstream).
 */

import { luminance, rgbToHsl, clamp } from '../../color-engine/index.js';

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Returns `v` if finite, else `fallback`. Never lets NaN/Infinity escape. */
export function safeNumber(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

/** clamp() that first sanitises NaN/Infinity to `fallback` before clamping. */
export function safeClamp(v, lo, hi, fallback = 0) {
  return clamp(safeNumber(v, fallback), lo, hi);
}

// ─── Pixel-level classification (shared across estimators) ───────────────────

export const ALPHA_REJECT_THRESHOLD = 128;   // matches whitebalance-engine/_sample(), color-cast-detector/_detect(), image-analysis-core/mainPass() exactly
export const NEAR_BLACK_LUM = 8;             // luminance below this is treated as sensor-floor noise, not scene colour
export const FULL_CLIP_CHANNEL = 255;        // a channel at the literal byte ceiling is unrecoverable, not just "bright"

/** True if the pixel's alpha channel marks it fully/mostly transparent. */
export function isAlphaRejected(a) {
  return !Number.isFinite(a) || a < ALPHA_REJECT_THRESHOLD;
}

/** True if r/g/b contain a non-finite (NaN/Infinity) value — must never reach an estimator's math. */
export function hasInvalidChannel(r, g, b) {
  return !Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b);
}

/** True if the pixel is at/near the sensor floor (near-black), unreliable for WB gain estimation. */
export function isNearBlack(r, g, b) {
  return luminance(r, g, b) < NEAR_BLACK_LUM;
}

/** True if ALL three channels are at the literal 255 ceiling (fully, unrecoverably clipped). */
export function isFullyClipped(r, g, b) {
  return r >= FULL_CLIP_CHANNEL && g >= FULL_CLIP_CHANNEL && b >= FULL_CLIP_CHANNEL;
}

/** True if ANY channel is at/above the clip ceiling (used by estimators needing a stricter highlight guard). */
export function isAnyChannelClipped(r, g, b) {
  return r >= FULL_CLIP_CHANNEL || g >= FULL_CLIP_CHANNEL || b >= FULL_CLIP_CHANNEL;
}

/** 0-1 saturation via the shared rgbToHsl(), never re-derived per estimator. */
export function saturationOf(r, g, b) {
  if (hasInvalidChannel(r, g, b)) return 0;
  return rgbToHsl(r, g, b).s;
}

// ─── Gain <-> Candidate-unit conversion ───────────────────────────────────────
//
// Mirrors core/whitebalance-engine/index.js's private, unexported
// _gainsToEst() conversion EXACTLY (rbDiff*28 / gDiff*22, same clamp
// bounds) so every P1I estimator's temp/tint intent lands in the SAME
// Candidate-compatible "slider units" P1H's guardrails already expect
// (see P1H_TEMPERATURE_TINT_GUARDRAILS.md) — not Kelvin, and not a
// second, incompatible scale. This formula cannot be imported (the
// source function is private/unexported in whitebalance-engine), so
// it is intentionally re-implemented here byte-for-byte; parity is
// proven by qa/epic-2e-p1i-pixel-multi-estimator-wb-test.mjs's colour-
// math parity check against known gain inputs.

const TEMP_GAIN_SCALE = 28;
const TINT_GAIN_SCALE = 22;
const TEMP_TINT_BOUND = 100;

/**
 * @param {{r:number,g:number,b:number}} gains  per-channel correction gains (1.0 = no change)
 * @returns {{temperature:number, tint:number, gainR:number, gainG:number, gainB:number}}
 */
export function gainsToTempTint(gains) {
  const r = safeNumber(gains?.r, 1);
  const g = safeNumber(gains?.g, 1) || 1;
  const b = safeNumber(gains?.b, 1);
  const gFactor = g || 1;
  const rCorr = (r / gFactor - 1);
  const bCorr = (b / gFactor - 1);
  const rbDiff = rCorr - bCorr;
  const gDiff = 1 - g; // gainG<1 (green-heavy image) -> gDiff>0 -> tint positive (toward magenta), matches legacy convention
  const temperature = safeClamp(Math.round(rbDiff * TEMP_GAIN_SCALE), -TEMP_TINT_BOUND, TEMP_TINT_BOUND);
  const tint = safeClamp(Math.round(gDiff * TINT_GAIN_SCALE), -TEMP_TINT_BOUND, TEMP_TINT_BOUND);
  return {
    temperature, tint,
    gainR: +safeNumber(r, 1).toFixed(4),
    gainG: +safeNumber(g, 1).toFixed(4),
    gainB: +safeNumber(b, 1).toFixed(4),
  };
}

/** Channel-mean gains that would neutralise `{r,g,b}` toward the achromatic reference (r+g+b)/3. Returns {r,g,b}=1 for degenerate input. */
export function meanToNeutralGains(meanR, meanG, meanB) {
  const aR = safeNumber(meanR, 0), aG = safeNumber(meanG, 0), aB = safeNumber(meanB, 0);
  const ref = (aR + aG + aB) / 3;
  if (ref <= 0) return { r: 1, g: 1, b: 1 };
  return {
    r: ref / Math.max(1, aR),
    g: ref / Math.max(1, aG),
    b: ref / Math.max(1, aB),
  };
}

/** Castigation-axis label from a temp/tint pair — shared so every estimator/ensemble uses one vocabulary. */
export function castAxisFromTempTint(temperature, tint) {
  const t = safeNumber(temperature, 0), n = safeNumber(tint, 0);
  if (Math.abs(t) <= 3 && Math.abs(n) <= 3) return 'neutral';
  if (Math.abs(t) >= Math.abs(n)) return t > 0 ? 'warm' : 'cool';
  return n > 0 ? 'magenta' : 'green';
}

// ─── Shared aggregate helpers (used by 3+ estimators; centralised to avoid
// duplicated formulas across modules per the P1I Color-Math Policy) ──────────

const DOMINANCE_HUE_BUCKETS = 12;
const DOMINANCE_SAT_ELIGIBLE = 0.12; // pixels below this saturation don't count toward "which hue dominates"

/**
 * Buckets accepted pixels' hues into 12 x 30-degree bins and returns the
 * fraction the single largest bin represents among hue-eligible
 * (meaningfully saturated) pixels — the shared "does one object colour
 * dominate this scene" signal used by Gray World, Shades of Gray, and
 * the ensemble's object-bias evidence.
 *
 * @param {{r:number,g:number,b:number,sat:number}[]} pixels
 * @returns {{dominanceRatio:number, dominantHueDegrees:number|null, hueEligibleCount:number}}
 */
export function hueDominance(pixels) {
  const buckets = new Array(DOMINANCE_HUE_BUCKETS).fill(0);
  let eligible = 0;
  for (const px of pixels) {
    if (px.sat >= DOMINANCE_SAT_ELIGIBLE) {
      const { h } = rgbToHsl(px.r, px.g, px.b);
      buckets[Math.min(DOMINANCE_HUE_BUCKETS - 1, Math.floor(h / (360 / DOMINANCE_HUE_BUCKETS)))]++;
      eligible++;
    }
  }
  if (eligible === 0) return { dominanceRatio: 0, dominantHueDegrees: null, hueEligibleCount: 0 };
  let maxIdx = 0;
  for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[maxIdx]) maxIdx = i;
  return {
    dominanceRatio: safeClamp(buckets[maxIdx] / eligible, 0, 1),
    dominantHueDegrees: maxIdx * (360 / DOMINANCE_HUE_BUCKETS) + (360 / DOMINANCE_HUE_BUCKETS) / 2,
    hueEligibleCount: eligible,
  };
}

/**
 * Bounding-box spatial coverage: area spanned by `pixels` (each with x,y)
 * as a fraction of the full frame area. Shared so every estimator's
 * "spatialCoverage" evidence field is computed identically.
 */
export function spatialCoverageOf(pixels, width, height) {
  if (!pixels.length || !width || !height) return 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const px of pixels) {
    if (px.x < minX) minX = px.x;
    if (px.x > maxX) maxX = px.x;
    if (px.y < minY) minY = px.y;
    if (px.y > maxY) maxY = px.y;
  }
  const bboxArea = Math.max(1, maxX - minX) * Math.max(1, maxY - minY);
  const frameArea = Math.max(1, width * height);
  return safeClamp(bboxArea / frameArea, 0, 1);
}

/** Hue name family (coarse) — used by object-bias reason codes, never for skin/ethnicity inference. */
export function hueDegreesToFamily(hueDegrees) {
  if (hueDegrees == null) return 'none';
  const h = ((hueDegrees % 360) + 360) % 360;
  if (h < 20 || h >= 340) return 'red';
  if (h < 50) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 320) return 'magenta';
  return 'red';
}

/**
 * Standard YCbCr skin-tone range check — the SAME formula already used
 * twice in this codebase (whitebalance-engine's _skinRefinement() and
 * _filterNeutralCandidates()) for the identical purpose (excluding
 * skin-toned pixels from a neutral-reference computation). Reused here
 * (third use, same well-established published heuristic) rather than
 * reinvented, per reuse-first.
 */
export function isLikelySkinPixelYCbCr(r, g, b) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return Y > 80 && Y < 235 && Cb > 77 && Cb < 127 && Cr > 133 && Cr < 173;
}

export { luminance, rgbToHsl, clamp };
