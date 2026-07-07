/**
 * core/hsl-analyzer-engine/index.js  v3
 *
 * HSL Analyzer Pro — Task 001 guardrails applied
 *
 * Portrait/Wedding limits per spec:
 *   Red   sat   ±10
 *   Orange hue  ±5
 *   Orange sat  −12…+6
 *   Orange lum  ±8
 *   Yellow sat  ±10
 *   Green  sat  ±12
 *   Blue   sat  ±12
 *
 * Values from reference image must NEVER be applied directly to target.
 * Adjustments are scene-weighted corrections, not raw measurements.
 */

import { rgbToHsl, clamp } from '../color-engine/index.js';

const HUE_RANGES = {
  red:     { lo: 315, hi:  30, wrap: true  },
  orange:  { lo:  15, hi:  60, wrap: false },
  yellow:  { lo:  45, hi:  90, wrap: false },
  green:   { lo:  75, hi: 165, wrap: false },
  aqua:    { lo: 150, hi: 210, wrap: false },
  blue:    { lo: 195, hi: 255, wrap: false },
  purple:  { lo: 240, hi: 300, wrap: false },
  magenta: { lo: 285, hi: 345, wrap: false },
};

const CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];

const CHANNEL_META = {
  red:     { icon:'🔴', label:'Red',     hue:   0 },
  orange:  { icon:'🟠', label:'Orange',  hue:  30 },
  yellow:  { icon:'🟡', label:'Yellow',  hue:  60 },
  green:   { icon:'🟢', label:'Green',   hue: 120 },
  aqua:    { icon:'🩵', label:'Aqua',    hue: 180 },
  blue:    { icon:'🔵', label:'Blue',    hue: 220 },
  purple:  { icon:'🟣', label:'Purple',  hue: 270 },
  magenta: { icon:'🩷', label:'Magenta', hue: 315 },
};

// ── Task 001 guardrail limits per channel per scene ───────────────────────────
const GUARDRAILS = {
  Portrait: {
    red:     { hue: [-10, 10], sat: [-10,  8],  lum: [-15, 15] },
    orange:  { hue: [-5,   5], sat: [-12,  6],  lum: [-8,   8] },
    yellow:  { hue: [-8,   8], sat: [-10, 10],  lum: [-12, 12] },
    green:   { hue: [-10, 10], sat: [-12,  4],  lum: [-12, 12] },   // v3: sat cap +4 (was +12)
    aqua:    { hue: [-12, 12], sat: [-10,  4],  lum: [-12, 12] },   // v3: tighter (was ±15)
    blue:    { hue: [-12, 12], sat: [-10,  8],  lum: [-12, 12] },   // v3: tighter (was ±12)
    purple:  { hue: [-15, 15], sat: [-15, 15],  lum: [-20, 20] },
    magenta: { hue: [-12, 12], sat: [-12, 12],  lum: [-15, 15] },
  },
  Wedding: {
    red:     { hue: [-10, 10], sat: [-10,  8],  lum: [-15, 15] },
    orange:  { hue: [-5,   5], sat: [-12,  6],  lum: [-8,   8] },
    yellow:  { hue: [-8,   8], sat: [-10, 10],  lum: [-12, 12] },
    green:   { hue: [-12, 12], sat: [-12,  6],  lum: [-12, 12] },   // v3: sat cap +6
    aqua:    { hue: [-12, 12], sat: [-10,  6],  lum: [-12, 12] },   // v3: tighter
    blue:    { hue: [-12, 12], sat: [-10,  8],  lum: [-12, 12] },   // v3: tighter
    purple:  { hue: [-15, 15], sat: [-15, 15],  lum: [-20, 20] },
    magenta: { hue: [-12, 12], sat: [-12, 12],  lum: [-15, 15] },
  },
};

const MAX_DIM    = 360;
const SAMPLE_STEP= 2;
const MIN_SAT    = 0.08;
const DOM = { primary: 20, secondary: 8, accent: 2 };

// ─── Public API (unchanged) ───────────────────────────────────────────────────

export function analyzeHSL(img, opts = {}) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_analyze(img, opts)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _analyze(img, opts) {
  if (!img.naturalWidth) throw new Error('Image not ready for HSL analysis');
  const category = opts.category ?? 'General';
  const pixels   = _sample(img);
  const total    = pixels.length;
  const acc = {};
  for (const ch of CHANNELS) acc[ch] = { count:0, hSum:0, sSum:0, lSum:0 };

  for (const [r,g,b] of pixels) {
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < MIN_SAT) continue;
    const ch = _assignChannel(h);
    if (!ch) continue;
    acc[ch].count++; acc[ch].hSum+=h; acc[ch].sSum+=s; acc[ch].lSum+=l;
  }

  const guardrails = GUARDRAILS[category] ?? null;
  const channels = {};

  for (const ch of CHANNELS) {
    const a   = acc[ch];
    const n   = a.count || 1;
    const cov = +((a.count / Math.max(1,total)) * 100).toFixed(2);
    const avgH= a.count > 0 ? Math.round(a.hSum / n) : CHANNEL_META[ch].hue;
    const avgS= a.count > 0 ? Math.round((a.sSum / n) * 100) : 0;
    const avgL= a.count > 0 ? Math.round((a.lSum / n) * 100) : 0;
    const dom = cov >= DOM.primary   ? 'primary'
              : cov >= DOM.secondary ? 'secondary'
              : cov >= DOM.accent    ? 'accent' : 'minimal';

    let { hueAdj, satAdj, lumAdj, hueReason, satReason, lumReason } =
      _recommend(ch, avgH, avgS, avgL, cov, dom, category);

    // ── Apply guardrails ─────────────────────────────────────────────────
    if (guardrails?.[ch]) {
      const gl = guardrails[ch];
      hueAdj = clamp(hueAdj, gl.hue[0], gl.hue[1]);
      satAdj = clamp(satAdj, gl.sat[0], gl.sat[1]);
      lumAdj = clamp(lumAdj, gl.lum[0], gl.lum[1]);
    }

    channels[ch] = {
      channel: ch, ...CHANNEL_META[ch],
      pixelCount: a.count, coveragePct: cov,
      avgHue: avgH, avgSat: avgS, avgLum: avgL, dominance: dom,
      hueAdj, satAdj, lumAdj,
      hueReason, satReason, lumReason,
    };
  }

  const ranked = [...Object.values(channels)].sort((a,b) => b.coveragePct - a.coveragePct);

  // ── Confidence ─────────────────────────────────────────────────────────────
  // High when dominant channel is clearly separated from the rest.
  // Low when pixels are almost all achromatic (sat < MIN_SAT → skipped).
  const saturatedPx = CHANNELS.reduce((s, ch) => s + acc[ch].count, 0);
  const satRatio    = saturatedPx / Math.max(1, total);
  const topCov      = ranked[0]?.coveragePct ?? 0;
  const secondCov   = ranked[1]?.coveragePct ?? 0;
  const dominanceGap= topCov - secondCov;

  const confidence = +Math.max(0.1, Math.min(1,
    satRatio * 0.5 +                          // how many pixels have usable colour
    Math.min(0.3, dominanceGap / 40) +        // how clear the dominant channel is
    (guardrails ? 0.1 : 0.05) +               // guardrails = known scene = more context
    (total > 1000 ? 0.1 : total / 10000)      // sample size
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  if (satRatio < 0.20)
    warnings.push(`Only ${(satRatio*100).toFixed(0)}% of pixels are saturated — HSL analysis may not be meaningful for near-monochromatic images`);
  if (topCov < 8)
    warnings.push('No channel clearly dominant — colour distribution is very even across hues');
  if (dominanceGap < 3 && topCov < 15)
    warnings.push('Dominant channel not well-separated from runner-up — recommendation may be unstable');
  if (!guardrails && (category === 'Portrait' || category === 'Wedding'))
    warnings.push('No guardrails table for this category — using unclamped adjustments');

  return {
    channels, ranked,
    dominant: ranked[0]?.channel ?? 'red',
    category,
    guardrailsApplied: !!guardrails,
    summary: `${category} · Dominant: ${ranked[0]?.label} (${ranked[0]?.coveragePct}%)`,
    // Phase 1
    confidence: +confidence,
    warnings,
  };
}

function _assignChannel(h) {
  // v3: contiguous, non-overlapping, exhaustive coverage of 0-360°
  // Priority order resolves previous overlaps (195-210, 285-300)
  if (h >= 315 || h < 15)  return 'red';      // 315-360 + 0-15
  if (h < 45)               return 'orange';   // 15-45
  if (h < 75)               return 'yellow';   // 45-75
  if (h < 165)              return 'green';    // 75-165  (was 75-150, now covers gap)
  if (h < 210)              return 'aqua';     // 165-210 (was 150-210)
  if (h < 255)              return 'blue';     // 210-255 (was 195-255, no more overlap)
  if (h < 300)              return 'purple';   // 255-300 (was 240-300)
  return 'magenta';                            // 300-315
}

function _recommend(ch, avgH, avgS, avgL, cov, dom, category) {
  const idealHue = CHANNEL_META[ch].hue;
  const hueDrift = avgH - idealHue;
  let hueAdj = 0, hueReason = '';
  if (Math.abs(hueDrift) > 8 && cov > DOM.accent) {
    hueAdj    = clamp(Math.round(-hueDrift * 0.6), -30, 30);
    hueReason = `Avg hue ${avgH}° drifts ${hueDrift>0?'+':''}${Math.round(hueDrift)}° from ideal.`;
  } else {
    hueReason = `Hue centred at ${avgH}° — within ideal range.`;
  }
  if (category === 'Portrait' || category === 'Wedding') {
    if (ch === 'orange') { hueAdj = clamp(hueAdj + 3, -30, 30); hueReason += ' +3 warm for skin.'; }
    if (ch === 'red')    { hueAdj = clamp(hueAdj + 2, -30, 30); hueReason += ' +2 for healthy lips.'; }
  }
  if (category === 'Landscape') {
    if (ch === 'green') { hueAdj = clamp(hueAdj - 5, -30, 30); }
    if (ch === 'blue')  { hueAdj = clamp(hueAdj + 5, -30, 30); }
  }

  const idealSat = _idealSat(ch, category);
  let satAdj = 0, satReason = '';
  if (cov < DOM.accent) {
    satReason = `Minimal coverage (${cov}%). No adjustment.`;
  } else {
    satAdj    = clamp(Math.round((idealSat - avgS) * 0.8), -50, 50);
    satReason = satAdj > 5 ? `Avg sat ${avgS}% below ideal ${idealSat}%. +${satAdj}.`
              : satAdj < -5 ? `Avg sat ${avgS}% above ideal ${idealSat}%. ${satAdj}.`
              : `Sat (${avgS}%) near ideal.`;
  }

  const idealLum = _idealLum(ch, category);
  let lumAdj = 0, lumReason = '';
  if (cov < DOM.accent) {
    lumReason = `Minimal coverage. Luminance unchanged.`;
  } else {
    lumAdj    = clamp(Math.round((idealLum - avgL) * 0.7), -40, 40);
    lumReason = lumAdj > 5 ? `Avg lum ${avgL}% below ideal. +${lumAdj}.`
              : lumAdj < -5 ? `Avg lum ${avgL}% above ideal. ${lumAdj}.`
              : `Lum (${avgL}%) balanced.`;
  }
  return { hueAdj, satAdj, lumAdj, hueReason, satReason, lumReason };
}

function _idealSat(ch, category) {
  const base = {red:45,orange:50,yellow:48,green:52,aqua:55,blue:58,purple:45,magenta:42}[ch]??50;
  if (category==='Portrait'||category==='Wedding') {
    if (ch==='orange'||ch==='red')  return base - 10;  // protect skin tones
    // v3: reduce green target so BG vegetation doesn't get boosted
    if (ch==='green')               return base - 12;  // 52→40: suppress green BG
    if (ch==='aqua')                return base -  8;  // 55→47: suppress teal BG
    // v3: blue clothing should not be over-boosted in portrait
    if (ch==='blue')                return base -  8;  // 58→50
  }
  if (category==='Landscape') {
    if (ch==='green'||ch==='aqua'||ch==='blue') return base + 8;
  }
  return base;
}

function _idealLum(ch, category) {
  const base = {red:45,orange:52,yellow:55,green:48,aqua:50,blue:44,purple:42,magenta:48}[ch]??50;
  if (category==='Portrait'||category==='Wedding') {
    if (ch==='orange') return base + 5;
  }
  if (category==='Landscape') {
    if (ch==='green') return base - 3;
    if (ch==='blue')  return base - 5;
  }
  return base;
}

function _sample(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;
  const pixels = [];
  for (let i=0; i<w*h; i+=SAMPLE_STEP) {
    const o=i*4; if(data[o+3]<128) continue;
    pixels.push([data[o],data[o+1],data[o+2]]);
  }
  return pixels;
}
