/**
 * core/image-analysis-core/pixel-math.js
 *
 * EPIC 2E-P0.7 R6 — pure, DOM-free pixel math extracted verbatim out of
 * index.js's private _mainPass/_toGreyscale/_qualityPass and their
 * helpers, so the exact same algorithm can run either:
 *   (a) synchronously on the main thread (index.js's original
 *       behaviour, kept as the graceful-degradation fallback), or
 *   (b) inside a Web Worker (worker.js), off the main thread — the
 *       Worker receives only transferable typed-array pixel buffers
 *       and plain numbers, never an HTMLImageElement or any DOM object.
 *
 * No behaviour change: every number produced here is byte-for-byte the
 * same computation that index.js's old _run() performed inline. This
 * file has zero DOM dependency (no `document`, no `Image`, no
 * `canvas`) so it is safe to import from a Worker module.
 */
import { rgbToHsl, luminance, clamp } from '../color-engine/index.js';

const CLIP_HI = 250;
const CLIP_LO = 5;

const HUE_NAMES = [
  [0,'Red'],[30,'Orange'],[60,'Yellow'],[90,'Yellow-Green'],[120,'Green'],
  [150,'Spring Green'],[180,'Cyan'],[210,'Azure'],[240,'Blue'],[270,'Violet'],
  [300,'Magenta'],[330,'Rose'],
];
function _hueName(h) {
  let best='Red', bestD=360;
  for (const [a,name] of HUE_NAMES) {
    const d = Math.min(Math.abs(h-a), 360-Math.abs(h-a));
    if (d<bestD) { bestD=d; best=name; }
  }
  return best;
}

/** Approximate CIE L* from sRGB (D65, simplified gamma) */
function _rgbToLabL(r, g, b) {
  const toLin = c => { c/=255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
  const Y = 0.2126*toLin(r) + 0.7152*toLin(g) + 0.0722*toLin(b);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

export function toGreyscale(data, w, h) {
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = luminance(data[i], data[i + 1], data[i + 2]);
  }
  return grey;
}

export function mainPass(data, w, h) {
  const histL = new Uint32Array(256);
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  const hueHist = new Uint32Array(36);     // 10° buckets
  const satHist = new Uint32Array(20);     // 5% buckets

  let rSum=0,gSum=0,bSum=0,satSum=0,labLSum=0;
  let clipHi=0,clipLo=0,skinCount=0,total=0;
  let skinHSum=0,skinSSum=0,skinLSum=0;

  for (let i=0; i<data.length; i+=4) {
    if (data[i+3] < 128) continue;
    const r=data[i], g=data[i+1], b=data[i+2];
    const lum = Math.min(255, Math.round(luminance(r,g,b)));

    histL[lum]++; histR[r]++; histG[g]++; histB[b]++;
    rSum+=r; gSum+=g; bSum+=b;
    total++;

    const hsl = rgbToHsl(r,g,b);
    satSum += hsl.s;
    if (hsl.s >= 0.05) hueHist[Math.min(35,Math.floor(hsl.h/10))]++;
    satHist[Math.min(19, Math.floor(hsl.s*20))]++;

    labLSum += _rgbToLabL(r,g,b);

    if (r>=CLIP_HI||g>=CLIP_HI||b>=CLIP_HI) clipHi++;
    if (r<=CLIP_LO&&g<=CLIP_LO&&b<=CLIP_LO) clipLo++;

    // YCbCr skin detection
    const Y=0.299*r+0.587*g+0.114*b;
    const Cb=128-0.168736*r-0.331264*g+0.5*b;
    const Cr=128+0.5*r-0.418688*g-0.081312*b;
    if (Y>80&&Y<235&&Cb>77&&Cb<127&&Cr>133&&Cr<173) {
      skinCount++;
      skinHSum+=hsl.h; skinSSum+=hsl.s; skinLSum+=hsl.l;
    }
  }

  const n = Math.max(1,total);
  const pct=(hist,p)=>{const t=p*n;let c=0;for(let i=0;i<256;i++){c+=hist[i];if(c>=t)return i;}return 255;};
  const blackPoint=pct(histL,.005), whitePoint=pct(histL,.995), median=pct(histL,.5);

  let lumSum=0; for(let i=0;i<256;i++) lumSum+=i*histL[i];
  const avgLum=lumSum/n;

  let varSum=0; for(let i=0;i<256;i++) varSum+=(i-avgLum)**2*histL[i];
  const contrast=Math.round(Math.sqrt(varSum/n));

  const avgR=rSum/n, avgG=gSum/n, avgB=bSum/n;
  const rbDiff=avgR-avgB, gDiff=avgG-(avgR+avgB)/2;

  const p1  = pct(histL, 0.01);
  const p99 = pct(histL, 0.99);
  const drStops = p99 > p1
    ? +(Math.log2(Math.max(1, p99) / Math.max(1, p1))).toFixed(2)
    : 0;

  const lo5=pct(histL,.05), hi95=pct(histL,.95);
  const contrastRatio=+(hi95/Math.max(1,lo5)).toFixed(1);

  const clipHiPct=+((clipHi/n)*100).toFixed(2);
  const clipLoPct=+((clipLo/n)*100).toFixed(2);

  const skinPct = +((skinCount/n)*100).toFixed(1);
  const skinDetected = skinPct > 3;
  const skinTone = skinCount>0 ? {
    h: Math.round(skinHSum/skinCount),
    s: Math.round((skinSSum/skinCount)*100),
    l: Math.round((skinLSum/skinCount)*100),
  } : { h:0, s:0, l:0 };

  let category='General';
  if      (skinPct>12)         category='Portrait';
  else if (skinPct>3)          category='Wedding';
  else if (satSum/n>0.35)      category='Landscape';
  else                          category='Travel';

  let whiteBalanceCast='neutral';
  if (Math.abs(rbDiff)<=4 && Math.abs(gDiff)<=4) whiteBalanceCast='neutral';
  else if (rbDiff>8)  whiteBalanceCast='warm';
  else if (rbDiff<-8) whiteBalanceCast='cool';
  else if (gDiff>6)   whiteBalanceCast='green';
  else if (gDiff<-6)  whiteBalanceCast='magenta';
  else whiteBalanceCast = rbDiff>0 ? 'warm' : 'cool';

  const maxHueIdx = hueHist.indexOf(Math.max(...hueHist));
  const dominantHue = maxHueIdx*10+5;

  const satHistogram = Array.from(satHist).map(v=>+(v/n*100).toFixed(2));

  const clipTotal = clipHiPct + clipLoPct;
  const coreConfidence = +Math.max(0, Math.min(1,
    1 -
    Math.min(0.4, clipTotal / 100 * 2) -
    (drStops < 1 ? 0.2 : 0) -
    (n < 500 ? 0.15 : 0)
  )).toFixed(3);

  const coreWarnings = [];
  if (clipHiPct > 5)  coreWarnings.push(`Highlight clipping ${clipHiPct}% — exposure/WB may be unreliable`);
  if (clipLoPct > 5)  coreWarnings.push(`Shadow clipping ${clipLoPct}% — shadow detail lost`);
  if (drStops < 1)    coreWarnings.push('Near-uniform image — dynamic range, WB, and colour measurements unreliable');
  if (n < 500)        coreWarnings.push(`Small pixel count (${n}) — reduce MAX_DIM or check image source`);
  if (Math.abs(gDiff) > 20) coreWarnings.push(`Strong green/magenta cast (gDiff=${gDiff.toFixed(1)}) — may skew WB`);

  return {
    histL, histR, histG, histB,
    avgLum: Math.round(avgLum),
    avgLabL: +(labLSum/n).toFixed(1),
    median: Math.round(median), blackPoint, whitePoint, contrast,
    dynamicRange: whitePoint-blackPoint, drStops, contrastRatio,
    clipHiPct, clipLoPct, clipHiCount: clipHi, clipLoCount: clipLo,
    rbDiff: +rbDiff.toFixed(2), gDiff: +gDiff.toFixed(2), whiteBalanceCast,
    avgR: Math.round(avgR), avgG: Math.round(avgG), avgB: Math.round(avgB),
    avgSatPct: Math.round((satSum/n)*100), satHistogram,
    dominantHue, dominantHueName: _hueName(dominantHue),
    category,
    skinDetected, skinPct, skinTone,
    total: n,
    confidence: coreConfidence,
    warnings: coreWarnings,
  };
}

function _laplacianVariance(grey, w, h) {
  let sum=0, sumSq=0, n=0;
  for (let y=1; y<h-1; y+=2) {
    for (let x=1; x<w-1; x+=2) {
      const idx = y*w+x;
      const lap = grey[idx-w] + grey[idx+w] + grey[idx-1] + grey[idx+1] - 4*grey[idx];
      sum += lap; sumSq += lap*lap; n++;
    }
  }
  if (n===0) return 0;
  const mean = sum/n;
  return Math.max(0, sumSq/n - mean*mean);
}

function _edgeDensity(grey, w, h) {
  let edgeCount=0, n=0;
  const thresh = 25;
  for (let y=1; y<h-1; y+=2) {
    for (let x=1; x<w-1; x+=2) {
      const idx=y*w+x;
      const gx = grey[idx+1]-grey[idx-1];
      const gy = grey[idx+w]-grey[idx-w];
      const mag = Math.sqrt(gx*gx+gy*gy);
      if (mag > thresh) edgeCount++;
      n++;
    }
  }
  return n>0 ? edgeCount/n : 0;
}

function _estimateNoise(grey, w, h) {
  let noiseSum=0, flatCount=0;
  const gradThresh = 8;

  for (let y=2; y<h-2; y+=3) {
    for (let x=2; x<w-2; x+=3) {
      const idx=y*w+x;
      const gx = Math.abs(grey[idx+1]-grey[idx-1]);
      const gy = Math.abs(grey[idx+w]-grey[idx-w]);
      if (gx<gradThresh && gy<gradThresh) {
        const hp = Math.abs(
          4*grey[idx] - grey[idx-1] - grey[idx+1] - grey[idx-w] - grey[idx+w]
        );
        noiseSum += hp;
        flatCount++;
      }
    }
  }
  if (flatCount < 10) return { score: 0.5, flatCount };
  const avgNoise = noiseSum/flatCount;
  return { score: clamp(avgNoise / 20, 0, 1), flatCount };
}

function _jpegArtifactScore(grey, w, h) {
  let boundarySum=0, boundaryCount=0;
  let interiorSum=0, interiorCount=0;

  for (let y=1; y<h-1; y++) {
    for (let x=8; x<w-1; x+=8) {
      const d = Math.abs(grey[y*w+x] - grey[y*w+x-1]);
      boundarySum += d; boundaryCount++;
    }
    for (let x=4; x<w-1; x+=8) {
      const d = Math.abs(grey[y*w+x] - grey[y*w+x-1]);
      interiorSum += d; interiorCount++;
    }
  }

  if (boundaryCount===0 || interiorCount===0) return 0;
  const avgBoundary = boundarySum/boundaryCount;
  const avgInterior = interiorSum/interiorCount;
  const ratio = avgBoundary / Math.max(0.5, avgInterior);
  return clamp((ratio - 1) / 1.5, 0, 1);
}

export function qualityPass(grey, w, h) {
  const lap = _laplacianVariance(grey, w, h);
  const edgeDensity = _edgeDensity(grey, w, h);
  const { score: noise, flatCount } = _estimateNoise(grey, w, h);
  const jpeg  = _jpegArtifactScore(grey, w, h);

  const sharpnessScore = clamp(Math.round(Math.sqrt(lap) * 3.2), 0, 100);
  const sharpnessLabel =
    sharpnessScore >= 65 ? 'Sharp' :
    sharpnessScore >= 40 ? 'Acceptable' :
    sharpnessScore >= 20 ? 'Soft' : 'Blurry';

  const blurConfidence = clamp(
    (1 - sharpnessScore / 100) * 0.7 + (1 - edgeDensity) * 0.3,
    0, 1
  );
  const blurDetected = blurConfidence > 0.55;

  const noiseScore = clamp(Math.round(noise * 100), 0, 100);
  const noiseLabel =
    noiseScore < 15 ? 'Clean' :
    noiseScore < 35 ? 'Light' :
    noiseScore < 60 ? 'Moderate' : 'Heavy';

  const jpegArtifactScore = clamp(Math.round(jpeg * 100), 0, 100);
  const jpegArtifactLabel =
    jpegArtifactScore < 10 ? 'None' :
    jpegArtifactScore < 30 ? 'Mild' :
    jpegArtifactScore < 55 ? 'Moderate' : 'Severe';

  const qualityWarnings = [];
  if (sharpnessScore === 0) qualityWarnings.push('Laplacian variance is zero — image may be synthetic or empty');
  if (noiseScore === 50 && flatCount < 10) qualityWarnings.push('Noise estimate unreliable — image has few flat regions');
  if (blurConfidence > 0.9) qualityWarnings.push('Very high blur confidence — may be artistic shallow-DOF');

  const qualityConfidence = +Math.max(0.1, Math.min(1,
    0.5 +
    (edgeDensity > 0.02 ? 0.3 : 0) +
    (flatCount >= 10 ? 0.2 : 0) -
    (sharpnessScore === 0 ? 0.3 : 0)
  )).toFixed(3);

  return {
    sharpnessScore, sharpnessLabel,
    blurDetected, blurConfidence: +blurConfidence.toFixed(2),
    noiseScore, noiseLabel,
    jpegArtifactScore, jpegArtifactLabel,
    qualityConfidence,
    qualityWarnings,
  };
}

/**
 * Runs the full two-pass analysis given ALREADY-EXTRACTED pixel
 * buffers (no canvas/DOM access needed) — this is the one function
 * both the main-thread fallback path (index.js) and the Worker
 * (worker.js) call, so behaviour is guaranteed identical either way.
 */
export function runFromBuffers({ data, w, h, data2, w2, h2 }) {
  const main = mainPass(data, w, h);
  const grey = toGreyscale(data2, w2, h2);
  const quality = qualityPass(grey, w2, h2);
  const result = { ...main, ...quality, total: main.total };
  result.summary = _summaryText(result);
  return result;
}

function _summaryText(r) {
  // Verbatim copy of index.js's original private _summary() — must stay
  // byte-for-byte identical so the Worker path and the main-thread
  // fallback path never disagree.
  const parts = [r.category, `${r.dominantHueName} dominant`];
  if (r.clipHiPct > 1) parts.push(`${r.clipHiPct}% highlight clip`);
  if (r.clipLoPct > 1) parts.push(`${r.clipLoPct}% shadow clip`);
  if (r.whiteBalanceCast !== 'neutral') parts.push(`${r.whiteBalanceCast} WB`);
  parts.push(r.sharpnessLabel);
  if (r.blurDetected) parts.push('blur detected');
  if (r.noiseLabel !== 'Clean') parts.push(`${r.noiseLabel.toLowerCase()} noise`);
  if (r.jpegArtifactLabel !== 'None') parts.push(`${r.jpegArtifactLabel.toLowerCase()} JPEG artifacts`);
  return parts.join(' · ');
}
