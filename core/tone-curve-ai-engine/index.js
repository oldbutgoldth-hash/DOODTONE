/**
 * core/tone-curve-ai-engine/index.js
 *
 * Tone Curve AI Generator
 *
 * Analyses real pixel histograms (R / G / B / Luminance) and derives
 * mathematically optimal control points for all four Lightroom curves:
 *   Master (RGB) · Red · Green · Blue
 *
 * ─── Method ──────────────────────────────────────────────────────────────────
 *
 * 1. Per-channel statistics from histogram data:
 *    • Black / White point at 0.5th and 99.5th percentile
 *    • Gamma midpoint (where 50% of pixels lie below)
 *    • Average channel imbalance vs reference grey
 *
 * 2. Master curve derivation (zone-system):
 *    • Shadows  → lift if clipped or crushed, deepen if milky
 *    • Midtones → S-curve strength from std-dev
 *    • Highlights → roll-off if blown, boost if flat
 *    • Scene category modifies targets
 *
 * 3. Per-channel colour correction:
 *    • Compare each channel's mean vs neutral grey
 *    • Shift channel curve up/down to compensate cast
 *    • Protect midtones from over-correction
 *
 * 4. Output:
 *    { master, red, green, blue } – arrays of {x,y} control points
 *    Each is ready for serializeCurvePoints() → XMP string
 *
 * 5. XMP serialisation is handled by curve-engine.serializeCurvePoints
 */

import { clamp } from '../color-engine/index.js';
import {
  evaluateCurve, buildLUT, serializeCurvePoints,
  defaultCurveSet, scenePreset,
} from '../curve-engine/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DIM    = 400;
const STEP       = 2;

// Scene curve intensity multipliers
const SCENE_INTENSITY = {
  Portrait:  { masterS: 0.65, colorCorr: 0.60, shadowLift: 0.80 },
  Wedding:   { masterS: 0.60, colorCorr: 0.55, shadowLift: 0.90 },
  Landscape: { masterS: 1.10, colorCorr: 0.85, shadowLift: 0.50 },
  Travel:    { masterS: 0.90, colorCorr: 0.75, shadowLift: 0.70 },
  General:   { masterS: 0.85, colorCorr: 0.75, shadowLift: 0.70 },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CurvePoint
 * @property {number} x  input  ∈ [0,255]
 * @property {number} y  output ∈ [0,255]
 */

/**
 * @typedef {Object} ChannelCurveResult
 * @property {CurvePoint[]} points
 * @property {string}       xmp          XMP-ready string
 * @property {string}       reason       why these points were chosen
 * @property {number}       blackPoint
 * @property {number}       whitePoint
 * @property {number}       gamma        midtone shift (>1 = brighter)
 */

/**
 * @typedef {Object} ToneCurveAIResult
 * @property {ChannelCurveResult}  master
 * @property {ChannelCurveResult}  red
 * @property {ChannelCurveResult}  green
 * @property {ChannelCurveResult}  blue
 * @property {string}              category
 * @property {string}              summary
 * @property {Uint8Array[]}        luts      LUTs for preview [master,r,g,b]
 */

/**
 * Generate all four tone curves from histogram statistics + raw image.
 *
 * @param {HTMLImageElement}                                     img
 * @param {import('../histogram-engine/index.js').HistogramStats} stats
 * @returns {Promise<ToneCurveAIResult>}
 */
export function generateToneCurves(img, stats) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_generate(img, stats)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _generate(img, stats) {
  const category  = stats.category ?? 'General';
  const intensity = SCENE_INTENSITY[category] ?? SCENE_INTENSITY.General;

  // ── Sample per-channel histograms from image ───────────────────────────────
  const chanStats = _sampleChannels(img);

  // ── Master (RGB) curve ─────────────────────────────────────────────────────
  const master = _masterCurve(stats, intensity);

  // ── Per-channel colour correction curves ───────────────────────────────────
  const red   = _channelCurve(chanStats.r, chanStats.ref, 'Red',   intensity, stats);
  const green = _channelCurve(chanStats.g, chanStats.ref, 'Green', intensity, stats);
  const blue  = _channelCurve(chanStats.b, chanStats.ref, 'Blue',  intensity, stats);

  // ── Build LUTs for visual preview ─────────────────────────────────────────
  const luts = [master, red, green, blue].map(c => _buildLUT(c.points));

  // ── Confidence ─────────────────────────────────────────────────────────────
  // Based on: histogram quality (good black/white points), channel balance,
  // and whether the scene category drove scene-specific curves.
  const bp = stats?.blackPoint ?? 0;
  const wp = stats?.whitePoint ?? 255;
  const dr = wp - bp;
  const knownScene = !!SCENE_INTENSITY[category];

  // Per-channel gamma spread: if R/G/B gammas are all ≈1.0 the image is flat
  const gammas = [master.gamma, red.gamma, green.gamma, blue.gamma];
  const gammaSpread = Math.max(...gammas) - Math.min(...gammas);

  const confidence = +Math.max(0.1, Math.min(1,
    (dr > 50 ? 0.3 : dr / 170) +         // usable dynamic range
    (knownScene ? 0.2 : 0.1) +           // known scene = appropriate intensity
    (gammaSpread < 0.4 ? 0.3 : 0.1) +   // channels are in reasonable agreement
    (stats?.total > 1000 ? 0.2 : 0.1)
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  if (dr < 30)
    warnings.push(`Very low dynamic range (${dr} levels) — tone curve corrections will be minimal`);
  if (stats?.clipHiPct > 5)
    warnings.push(`${stats.clipHiPct}% highlight clipping — white point may be inaccurate`);
  if (stats?.clipLoPct > 5)
    warnings.push(`${stats.clipLoPct}% shadow clipping — black point may be inaccurate`);
  if (gammaSpread > 0.5)
    warnings.push(`Large channel gamma spread (${gammaSpread.toFixed(2)}) — strong colour cast detected, WB correction recommended first`);
  if (master.blackPoint === 0 && master.whitePoint === 255)
    warnings.push('Tone curve using full 0-255 range — no meaningful histogram endpoints found');

  return {
    master, red, green, blue,
    category,
    summary: _summary(master, red, green, blue, category),
    luts,
    // Phase 1
    confidence: +confidence,
    warnings,
  };
}

// ─── Channel sampling ─────────────────────────────────────────────────────────

function _sampleChannels(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;

  const hR=new Uint32Array(256), hG=new Uint32Array(256), hB=new Uint32Array(256);
  let total=0;

  for (let i=0; i<w*h; i+=STEP) {
    const o=i*4;
    if(data[o+3]<128) continue;
    hR[data[o]]++; hG[data[o+1]]++; hB[data[o+2]]++;
    total++;
  }

  const pct=(hist,p)=>{const t=p*total;let c=0;for(let i=0;i<256;i++){c+=hist[i];if(c>=t)return i;}return 255;};
  const mean=(hist)=>{let s=0,n=0;for(let i=0;i<256;i++){s+=i*hist[i];n+=hist[i];}return n>0?s/n:128;};

  const rMean=mean(hR), gMean=mean(hG), bMean=mean(hB);
  const ref=(rMean+gMean+bMean)/3;   // expected neutral grey

  return {
    r:  { hist:hR, bp:pct(hR,.005), wp:pct(hR,.995), med:pct(hR,.5), mean:rMean },
    g:  { hist:hG, bp:pct(hG,.005), wp:pct(hG,.995), med:pct(hG,.5), mean:gMean },
    b:  { hist:hB, bp:pct(hB,.005), wp:pct(hB,.995), med:pct(hB,.5), mean:bMean },
    ref,
    total,
  };
}

// ─── Master (luminance) curve ─────────────────────────────────────────────────

function _masterCurve(stats, intensity) {
  const bp  = stats.blackPoint;
  const wp  = stats.whitePoint;
  const med = stats.median;
  const sig = stats.contrast;
  const hiClip = stats.clipHiPct ?? 0;
  const loClip = stats.clipLoPct ?? 0;

  // Shadow anchor
  const shadowY = _shadowAnchor(bp, loClip, intensity.shadowLift);

  // Midtone S-curve strength (based on std-dev)
  const sStr = clamp((sig - 40) / 30, -0.5, 1.0) * intensity.masterS;

  // Midtone lift/lower
  const midShift = Math.round((128 - med) * 0.55);

  // Highlight roll-off
  const hilY = _highlightAnchor(wp, hiClip);

  const points = _buildSCurve(shadowY, midShift, sStr, hilY);

  const reason = [
    `BP ${bp}, WP ${wp}, median ${med}, σ=${sig}.`,
    shadowY !== bp ? `Shadow anchor lifted to ${shadowY}.` : '',
    midShift !== 0 ? `Midtone shift ${midShift > 0 ? '+' : ''}${midShift}.` : '',
    `S-curve strength ${(sStr * 100).toFixed(0)}%.`,
    hilY < 255 ? `Highlight roll-off at ${hilY}.` : '',
  ].filter(Boolean).join(' ');

  return {
    points,
    xmp:        serializeCurvePoints(points),
    reason,
    blackPoint: bp,
    whitePoint: wp,
    gamma:      +(med / 128).toFixed(3),
  };
}

// ─── Per-channel colour correction curve ─────────────────────────────────────

function _channelCurve(ch, ref, label, intensity, stats) {
  const bp   = ch.bp;
  const wp   = ch.wp;
  const cast = ch.mean - ref;      // positive = channel too hot, negative = too cold

  // Scale correction by scene intensity + protect midtones
  const corrScale = intensity.colorCorr;
  const castCorr  = clamp(cast * corrScale, -40, 40);

  // Shadow anchor: correct cast in shadows
  const shAdj = clamp(Math.round(-castCorr * 0.6), -30, 30);
  // Midtone anchor: partial correction
  const midAdj= clamp(Math.round(-castCorr * 0.4), -20, 20);
  // Highlight anchor: full correction
  const hiAdj = clamp(Math.round(-castCorr * 0.7), -35, 35);

  const points = [
    { x:   0, y: clamp(bp + shAdj,  0, 20)  },
    { x:  64, y: clamp(64 + shAdj,  30, 90) },
    { x: 128, y: clamp(128 + midAdj, 100, 155) },
    { x: 192, y: clamp(192 + hiAdj,  160, 220) },
    { x: 255, y: clamp(wp + hiAdj,  235, 255) },
  ];

  const dir = castCorr > 5 ? `reducing ${label} cast (${castCorr > 0 ? '+' : ''}${castCorr.toFixed(1)})` :
              castCorr < -5 ? `boosting ${label} (${castCorr.toFixed(1)})` : 'balanced';

  const reason = `${label} mean ${Math.round(ch.mean)} vs neutral ${Math.round(ref)} (cast ${cast > 0 ? '+' : ''}${cast.toFixed(1)}). ${dir}. BP=${bp} WP=${wp}.`;

  return {
    points,
    xmp:        serializeCurvePoints(points),
    reason,
    blackPoint: bp,
    whitePoint: wp,
    gamma:      +(ch.med / 128).toFixed(3),
  };
}

// ─── S-curve builder ──────────────────────────────────────────────────────────

function _buildSCurve(shadowY, midShift, strength, hilY) {
  // 5-point S-curve: anchors + 3 interior points
  const deepSha = clamp(shadowY, 0, 25);
  const sha     = clamp(64  + Math.round(-strength * 10) + Math.round(midShift * 0.3), 40, 85);
  const mid     = clamp(128 + midShift, 100, 155);
  const bri     = clamp(192 + Math.round(strength * 12) + Math.round(midShift * 0.2), 175, 215);
  const whi     = clamp(hilY, 230, 255);

  return [
    { x:   0, y: deepSha },
    { x:  64, y: sha     },
    { x: 128, y: mid     },
    { x: 192, y: bri     },
    { x: 255, y: whi     },
  ];
}

function _shadowAnchor(bp, loClip, liftScale) {
  if (loClip > 2) return clamp(Math.round(bp + loClip * 3 * liftScale), 5, 30);
  if (bp > 15)    return clamp(Math.round(bp * 0.5), 0, 15);  // milky blacks — deepen
  return clamp(Math.round(bp * 0.8), 0, 12);
}

function _highlightAnchor(wp, hiClip) {
  if (hiClip > 2) return clamp(Math.round(255 - hiClip * 4), 220, 248);
  if (wp < 220)   return clamp(Math.round(220 + (wp - 200) * 0.5), 210, 250);
  return 255;
}

// ─── LUT builder (re-export wrapper) ─────────────────────────────────────────

function _buildLUT(points) {
  const lut = new Uint8Array(256);
  for (let i=0; i<256; i++) lut[i] = evaluateCurve(points, i);
  return lut;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function _summary(master, r, g, b, category) {
  const castParts = [];
  if (Math.abs(r.gamma - 1) > 0.05) castParts.push(`R${r.gamma > 1 ? '↑' : '↓'}`);
  if (Math.abs(g.gamma - 1) > 0.05) castParts.push(`G${g.gamma > 1 ? '↑' : '↓'}`);
  if (Math.abs(b.gamma - 1) > 0.05) castParts.push(`B${b.gamma > 1 ? '↑' : '↓'}`);
  return `${category} · Master γ=${master.gamma} · BP=${master.blackPoint} WP=${master.whitePoint}${castParts.length ? ' · Cast: ' + castParts.join(' ') : ''}`;
}
