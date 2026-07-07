/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Tone Zone Analyzer (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * core/histogram-engine already computes a 256-bin luminance histogram,
 * black/white points, median, and overall contrast — reused here via
 * analyzeImage() rather than recomputed, per "do not duplicate existing
 * engines." What histogram-engine does NOT expose (its per-bin histogram
 * arrays are internal to that module, not part of its returned object) is
 * a per-zone AVERAGE COLOUR — which is the actual new capability this
 * module adds: splitting sampled pixels into Shadow/Midtone/Highlight by
 * luminance and averaging each zone's own colour, saturation, and a simple
 * temperature/tint hint.
 */
import { analyzeImage } from '../histogram-engine/index.js';
import { rgbToHsl, luminance } from '../color-engine/index.js';

const MAX_DIM = 200;      // matches histogram-engine/kmeans-engine's own sampling scale
const SAMPLE_STRIDE = 2;  // every 2nd pixel — enough signal for a 3-zone average, stays fast

function _sampleForZones(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function _emptyZone() {
  return { avgColor: { r: 128, g: 128, b: 128, hex: '#808080' }, saturation: 0, temperatureHint: 0, tintHint: 0, pixelShare: 0 };
}

/**
 * @param {HTMLImageElement} img
 * @returns {Promise<{ shadow, midtone, highlight, contrast:number, blackPoint:number, whitePoint:number }>}
 *   Each zone: { avgColor:{r,g,b,hex}, saturation:0-100, temperatureHint:-100..100, tintHint:-100..100, pixelShare:0-1 }
 */
export async function analyzeToneZones(img) {
  const hist = await analyzeImage(img); // reuse existing histogram/contrast/black-white-point analysis

  const data = _sampleForZones(img);
  const zones = { shadow: [], midtone: [], highlight: [] };

  for (let i = 0; i < data.length; i += 4 * SAMPLE_STRIDE) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] < 128) continue; // skip transparent
    const lum = luminance(r, g, b);
    // Zone split uses histogram-engine's own black/white points as the
    // shadow/highlight boundary, so this module's zone definition stays
    // consistent with the rest of the pipeline's tonal analysis rather
    // than inventing an unrelated fixed 85/170 split.
    const zone = lum <= hist.blackPoint + 40 ? 'shadow' : lum >= hist.whitePoint - 40 ? 'highlight' : 'midtone';
    zones[zone].push([r, g, b]);
  }

  const totalSampled = zones.shadow.length + zones.midtone.length + zones.highlight.length;

  const summarize = (pixels) => {
    if (!pixels.length) return _emptyZone();
    let rSum = 0, gSum = 0, bSum = 0, satSum = 0;
    for (const [r, g, b] of pixels) {
      rSum += r; gSum += g; bSum += b;
      satSum += rgbToHsl(r, g, b).s;
    }
    const n = pixels.length;
    const r = Math.round(rSum / n), g = Math.round(gSum / n), b = Math.round(bSum / n);
    // Simple, explainable hints (not a colour-science-accurate Kelvin
    // computation): warmth = red vs blue balance, tint = green vs
    // red/blue balance — the same directional signals
    // core/whitebalance-engine already reasons about, at a much lighter
    // weight appropriate for a quick reference-side hint only.
    const temperatureHint = Math.round(((r - b) / 255) * 100);
    const tintHint = Math.round(((g - (r + b) / 2) / 255) * 100);
    return {
      avgColor: { r, g, b, hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') },
      saturation: Math.round((satSum / n) * 100),
      temperatureHint, tintHint,
      pixelShare: totalSampled > 0 ? +(n / totalSampled).toFixed(3) : 0,
    };
  };

  return {
    shadow: summarize(zones.shadow),
    midtone: summarize(zones.midtone),
    highlight: summarize(zones.highlight),
    contrast: hist.contrast,
    blackPoint: hist.blackPoint,
    whitePoint: hist.whitePoint,
  };
}
