/**
 * color-engine
 * Pure color-space conversion utilities.
 * No DOM, no side-effects — every function is a pure transform.
 */

/**
 * Convert sRGB (0–255 each) to HSL.
 * @returns {{ h: number, s: number, l: number }}  h ∈ [0,360), s/l ∈ [0,1]
 */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
    case g: h = ((b - r) / d + 2) * 60; break;
    case b: h = ((r - g) / d + 4) * 60; break;
  }
  return { h, s, l };
}

/**
 * Convert HSL to sRGB (0–255 each).
 * @param {number} h  Hue ∈ [0, 360)
 * @param {number} s  Saturation ∈ [0, 1]
 * @param {number} l  Lightness ∈ [0, 1]
 * @returns {{ r: number, g: number, b: number }}
 */
export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

/**
 * Perceived luminance (ITU-R BT.709) for a single pixel.
 * @returns {number} ∈ [0, 255]
 */
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Clamp a value to [lo, hi].
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Linear interpolation between a and b at t ∈ [0, 1].
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map a value from one range to another.
 */
export function mapRange(v, inMin, inMax, outMin, outMax) {
  return ((v - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}
