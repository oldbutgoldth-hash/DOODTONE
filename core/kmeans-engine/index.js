/**
 * kmeans-engine
 * K-Means++ clustering → Dominant / Secondary / Accent / Shadow / Highlight
 */

import { rgbToHsl, luminance, clamp } from '../color-engine/index.js';

const MAX_DIM    = 200;
const K          = 8;
const MAX_ITER   = 40;
const CONVERGE   = 1.5;
const SAMPLE_CAP = 6000;

export function extractPalette(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_run(img)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

function _run(img) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for K-Means');
  const pixels = _sample(img);
  const centroids = _kmeanspp(pixels, K);
  const final = _lloyd(pixels, centroids);
  return _buildResult(final, pixels.length);
}

function _sample(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor((w * h) / SAMPLE_CAP));
  const pixels = [];
  for (let i = 0; i < w * h; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  return pixels;
}

function _kmeanspp(pixels, k) {
  // Seed RNG from pixel content so same image always gives same clusters
  let seed = 0;
  for (let i = 0; i < Math.min(pixels.length, 50); i++)
    seed = (seed * 31 + pixels[i][0] * 7 + pixels[i][1] * 13 + pixels[i][2] * 17) >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const centroids = [[...pixels[Math.floor(rng() * pixels.length)]]];
  for (let c = 1; c < k; c++) {
    const dists = pixels.map(p => centroids.reduce((mn, cn) => Math.min(mn, _d2(p, cn)), Infinity));
    const sum = dists.reduce((a, b) => a + b, 0);
    let rand = rng() * sum, chosen = pixels[pixels.length - 1];
    for (let i = 0; i < pixels.length; i++) { rand -= dists[i]; if (rand <= 0) { chosen = pixels[i]; break; } }
    centroids.push([...chosen]);
  }
  return centroids;
}

function _lloyd(pixels, centroids) {
  let cens = centroids.map(c => [...c]);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const buckets = Array.from({ length: cens.length }, () => []);
    for (const p of pixels) {
      let best = 0, bestD = Infinity;
      for (let ci = 0; ci < cens.length; ci++) { const d = _d2(p, cens[ci]); if (d < bestD) { bestD = d; best = ci; } }
      buckets[best].push(p);
    }
    let moved = 0;
    cens = cens.map((old, ci) => {
      const b = buckets[ci]; if (!b.length) return old;
      const nc = [b.reduce((s,p)=>s+p[0],0)/b.length, b.reduce((s,p)=>s+p[1],0)/b.length, b.reduce((s,p)=>s+p[2],0)/b.length];
      moved += _d2(old, nc); return nc;
    });
    if (moved < CONVERGE) break;
  }
  const counts = new Array(cens.length).fill(0);
  for (const p of pixels) {
    let best = 0, bestD = Infinity;
    for (let ci = 0; ci < cens.length; ci++) { const d = _d2(p, cens[ci]); if (d < bestD) { bestD = d; best = ci; } }
    counts[best]++;
  }
  return cens.map((c, i) => ({ r: Math.round(clamp(c[0],0,255)), g: Math.round(clamp(c[1],0,255)), b: Math.round(clamp(c[2],0,255)), count: counts[i] }));
}

function _buildResult(raw, total) {
  const sorted = [...raw].sort((a, b) => b.count - a.count);
  const colors = sorted.map((cl, idx) => {
    const { r, g, b } = cl;
    const hsl = rgbToHsl(r, g, b);
    const lum = luminance(r, g, b);
    return {
      r, g, b, hex: _hex(r,g,b),
      hsl: { h: Math.round(hsl.h), s: Math.round(hsl.s*100), l: Math.round(hsl.l*100) },
      population: cl.count / total,
      luminance: Math.round(lum),
      role: 'Supporting', rank: idx + 1
    };
  });

  const byLum = [...colors].sort((a,b) => a.luminance - b.luminance);
  const bySat = [...colors].sort((a,b) => b.hsl.s - a.hsl.s);

  colors[byLum[0].rank - 1].role = 'Shadow';
  colors[byLum[byLum.length - 1].rank - 1].role = 'Highlight';

  for (const c of colors) { if (c.role === 'Supporting') { c.role = 'Dominant'; break; } }
  for (const c of colors) { if (c.role === 'Supporting') { c.role = 'Secondary'; break; } }
  for (const c of bySat)  { if (colors[c.rank-1].role === 'Supporting') { colors[c.rank-1].role = 'Accent'; break; } }

  // ── Palette quality metrics ───────────────────────────────────────────────
  // Distribution evenness: if top cluster has >60% of pixels, palette is skewed
  const topPop   = colors[0]?.population ?? 0;
  const dominated = topPop > 0.60;

  // Minimum inter-cluster distance (separation quality)
  let minDist = Infinity;
  for (let i = 0; i < colors.length - 1; i++)
    for (let j = i + 1; j < colors.length; j++) {
      const d = Math.sqrt(_d2([colors[i].r,colors[i].g,colors[i].b],[colors[j].r,colors[j].g,colors[j].b]));
      if (d < minDist) minDist = d;
    }
  const wellSeparated = minDist > 30;   // clusters more than ~12% of RGB space apart

  // Confidence: high when clusters are well-separated and distribution is even
  const confidence = +Math.max(0.1, Math.min(1,
    (wellSeparated ? 0.5 : 0.2) +
    (dominated ? 0 : 0.3) +
    (colors.length >= 6 ? 0.2 : 0.1)
  )).toFixed(3);

  const warnings = [];
  if (dominated)     warnings.push(`Single colour dominates palette (${(topPop*100).toFixed(0)}%) — limited colour variety`);
  if (!wellSeparated) warnings.push(`Clusters are close together (minDist=${minDist.toFixed(0)}) — image may be monochromatic`);
  if (total < 100)    warnings.push('Very few pixels sampled — palette may not represent full image');

  const get = (role) => colors.find(c => c.role === role) ?? colors[0];
  return {
    colors, dominant: get('Dominant'), secondary: get('Secondary'),
    accent: get('Accent'), shadow: get('Shadow'), highlight: get('Highlight'),
    // Phase 1 additions
    confidence, warnings,
  };
}

const _d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
const _hex = (r,g,b) => '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
