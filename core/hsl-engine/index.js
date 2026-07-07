/**
 * hsl-engine
 * Manages the 8-channel HSL mixer (Hue / Saturation / Luminance).
 * Provides default values and applies scene-aware adjustments.
 */

import { clamp } from '../color-engine/index.js';

/** Canonical channel order used throughout the app */
export const HSL_CHANNELS = [
  'red', 'orange', 'yellow', 'green',
  'aqua', 'blue', 'purple', 'magenta',
];

/** Human-readable labels */
export const HSL_LABELS = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta',
};

/**
 * @typedef {Object} HSLChannel
 * @property {number} h  Hue adjustment      ∈ [−100, 100]
 * @property {number} s  Saturation adj.     ∈ [−100, 100]
 * @property {number} l  Luminance adj.      ∈ [−100, 100]
 */

/** @typedef {Record<string, HSLChannel>} HSLMix */

/**
 * Return zeroed HSL mix (Lightroom default).
 * @returns {HSLMix}
 */
export function defaultHSLMix() {
  return Object.fromEntries(
    HSL_CHANNELS.map((c) => [c, { h: 0, s: 0, l: 0 }])
  );
}

/**
 * Generate a scene-aware HSL starting point.
 *
 * @param {{ category: string, avgSatPct: number }} stats
 * @returns {HSLMix}
 */
export function inferHSLMix(stats) {
  const mix = defaultHSLMix();

  switch (stats.category) {
    case 'Portrait':
      // Soften skin tones; de-saturate competing greens
      mix.orange.s = clamp(-10 + Math.round(stats.avgSatPct * -0.1), -30, 0);
      mix.orange.l =  5;
      mix.red.s    = clamp(-8  + Math.round(stats.avgSatPct * -0.05), -20, 0);
      mix.green.s  = -15;
      break;

    case 'Wedding':
      mix.orange.l =  8;
      mix.yellow.s = -10;
      mix.blue.s   =  10;
      break;

    case 'Landscape':
      mix.green.s  = clamp(Math.round(stats.avgSatPct * 0.3), 0, 30);
      mix.green.l  =  5;
      mix.aqua.s   = 15;
      mix.blue.s   = 20;
      mix.yellow.s = 10;
      break;

    case 'Travel':
      mix.blue.s   = 10;
      mix.orange.s =  5;
      break;

    default:
      break;
  }

  return mix;
}

/**
 * Flatten an HSLMix into the flat param bag expected by the XMP engine.
 *
 * @param {HSLMix} mix
 * @returns {Record<string, number>}
 */
export function flattenHSL(mix) {
  const out = {};
  for (const ch of HSL_CHANNELS) {
    out[`hsl_h_${ch}`] = mix[ch].h;
    out[`hsl_s_${ch}`] = mix[ch].s;
    out[`hsl_l_${ch}`] = mix[ch].l;
  }
  return out;
}
