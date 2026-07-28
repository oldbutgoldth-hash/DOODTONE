/**
 * EPIC 2E-O8 — Best-of-both pixel transfer integration.
 * Combines OpenCode's percentile tone-curve and CDF histogram concepts,
 * but feeds the result into LUMIXA's candidate-only/readback-gated path.
 */
import { deriveToneCurves } from './tone-curve-transfer-engine.js';
import { matchHistograms, mergeWithToneCurves } from './histogram-matching-engine.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const round = (v, d = 3) => { const p = 10 ** d; return Math.round((Number(v) || 0) * p) / p; };
function monotonic(points, { maxShift = 36, endpointShift = 8 } = {}) {
  const out = (points || []).map((p, i, a) => {
    const endpoint = i === 0 || i === a.length - 1;
    const cap = endpoint ? endpointShift : maxShift;
    return { x: Math.round(clamp(p.x, 0, 255)), y: Math.round(clamp(p.x + clamp(p.y - p.x, -cap, cap), 0, 255)) };
  }).sort((a, b) => a.x - b.x);
  for (let i = 1; i < out.length; i += 1) out[i].y = Math.max(out[i - 1].y, out[i].y);
  return out;
}
function curveMagnitude(curves) {
  let sum = 0;
  for (const ch of ['master', 'red', 'green', 'blue']) for (const p of curves?.[ch] || []) sum += Math.abs(p.y - p.x);
  return round(sum, 2);
}

export async function buildPerceptualPixelTransfer({ referenceImg, targetImg, intensity = 60, mode = 'Natural' } = {}) {
  if (!referenceImg || !targetImg) throw new TypeError('Pixel transfer requires Reference and Target images.');
  const [tone, hist] = await Promise.all([
    deriveToneCurves({ referenceImg, targetImg, intensity, mode }),
    matchHistograms({ referenceImg, targetImg, intensity, mode }),
  ]);
  const master = monotonic(mergeWithToneCurves(hist.master, tone.master.points, 0.55), { maxShift: 22, endpointShift: 4 });
  const red = monotonic(mergeWithToneCurves(hist.red, tone.red, 0.45), { maxShift: 9, endpointShift: 3 });
  const green = monotonic(mergeWithToneCurves(hist.green, tone.green, 0.45), { maxShift: 9, endpointShift: 3 });
  const blue = monotonic(mergeWithToneCurves(hist.blue, tone.blue, 0.45), { maxShift: 9, endpointShift: 3 });
  const curves = { master, red, green, blue };
  const magnitude = curveMagnitude(curves);
  return {
    kind: 'LUMIXA_PERCEPTUAL_PIXEL_TRANSFER', schemaVersion: 1,
    state: magnitude >= 4 ? 'PIXEL_TRANSFER_READY' : 'PIXEL_TRANSFER_IDENTITY',
    curves, curveMagnitude: magnitude,
    toneDiagnostic: tone.diagnostic,
    histogramDiagnostic: hist.diagnostic,
    source: {
      toneCurveMethod: '13_POINT_PERCENTILE_CDF',
      histogramMethod: 'PER_CHANNEL_CDF_MATCH',
      mergeWeights: { masterHistogram: 0.55, channelHistogram: 0.45 },
    },
    production: { productionSource: 'legacy', productionWrite: false, xmpWriteAllowed: false },
  };
}
