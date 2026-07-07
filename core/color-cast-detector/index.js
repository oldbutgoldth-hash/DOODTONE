/**
 * core/color-cast-detector/index.js
 *
 * Per-zone cast analysis separating BACKGROUND cast from SUBJECT cast.
 *
 * Key insight: in a portrait with green background, the cast detected
 * by whole-image WB algorithms is dominated by the background, not
 * the subject. But the WB correction should be driven by the subject
 * (or at least not overcorrected by background).
 *
 * This module measures cast per zone (shadows/mids/highlights AND
 * spatial center vs border) so downstream engines can weight sources
 * appropriately.
 *
 * Output is consumed by whitebalance-engine v4 and decision-engine.
 */

import { luminance, rgbToHsl, clamp } from '../color-engine/index.js';

const MAX_DIM = 280;
const STEP    = 3;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ZoneCast
 * @property {number} rbDiff   avgR - avgB  (+ = warm)
 * @property {number} gDiff    avgG - avg(R,B)/2  (+ = green)
 * @property {string} label    'warm'|'cool'|'green'|'magenta'|'neutral'
 * @property {number} strength 0-1 magnitude of cast
 * @property {number} pixelCount
 */

/**
 * @typedef {Object} CastResult
 * @property {ZoneCast} shadows
 * @property {ZoneCast} midtones
 * @property {ZoneCast} highlights
 * @property {ZoneCast} center     spatial center (likely subject)
 * @property {ZoneCast} border     spatial border (likely background)
 * @property {ZoneCast} global
 * @property {boolean}  bgGreenDominant  border zone is greener than center
 * @property {boolean}  subjectNeutral   center zone is near-neutral despite BG cast
 * @property {string}   dominantCast     which zone drives the global cast
 */

/**
 * @param {HTMLImageElement} img
 * @returns {Promise<CastResult>}
 */
export function detectColorCast(img) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_detect(img)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function _detect(img) {
  if (!img.naturalWidth) throw new Error('Image not ready for cast detection');

  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;

  // Zone accumulators
  const zones = {
    shadows:    { rS:0, gS:0, bS:0, n:0 },
    midtones:   { rS:0, gS:0, bS:0, n:0 },
    highlights: { rS:0, gS:0, bS:0, n:0 },
    center:     { rS:0, gS:0, bS:0, n:0 },   // spatial center 40%
    border:     { rS:0, gS:0, bS:0, n:0 },   // spatial border
    global:     { rS:0, gS:0, bS:0, n:0 },
  };

  // Spatial center bounds (inner 40% of each dimension)
  const cx1 = Math.floor(w * 0.30), cx2 = Math.floor(w * 0.70);
  const cy1 = Math.floor(h * 0.20), cy2 = Math.floor(h * 0.80);

  for (let py=0; py<h; py+=STEP) {
    for (let px=0; px<w; px+=STEP) {
      const o=(py*w+px)*4;
      const r=data[o], g=data[o+1], b=data[o+2], a=data[o+3];
      if (a<128) continue;

      const lum = luminance(r,g,b);

      // Tonal zone
      if (lum <= 80)       _acc(zones.shadows,    r,g,b);
      else if (lum <= 175) _acc(zones.midtones,   r,g,b);
      else                 _acc(zones.highlights,  r,g,b);

      // Spatial zone
      const inCenter = px>=cx1 && px<cx2 && py>=cy1 && py<cy2;
      if (inCenter) _acc(zones.center, r,g,b);
      else          _acc(zones.border, r,g,b);

      _acc(zones.global, r,g,b);
    }
  }

  const results = {};
  for (const [name, acc] of Object.entries(zones)) {
    results[name] = _castFromAcc(acc);
  }

  // Diagnostic flags
  const bgGreenDominant = (results.border.gDiff - results.center.gDiff) > 3;
  const subjectNeutral  = Math.abs(results.center.gDiff) < 4 &&
                          Math.abs(results.center.rbDiff) < 6;

  // Which zone is primarily responsible for the global cast?
  const casts = [
    { name:'shadows',    strength: results.shadows.strength    },
    { name:'midtones',   strength: results.midtones.strength   },
    { name:'highlights', strength: results.highlights.strength },
  ];
  const dominantCast = casts.sort((a,b)=>b.strength-a.strength)[0].name;

  // ── Confidence ─────────────────────────────────────────────────────────────
  // High when cast is strong and consistent across zones.
  // Low when subject zone has few pixels (tiny center or cropped image).
  const globalStr   = results.global.strength;
  const centerPixels= results.center.pixelCount;
  const totalPixels = results.global.pixelCount;
  const centerRatio = centerPixels / Math.max(1, totalPixels);

  const confidence = +Math.max(0.1, Math.min(1,
    globalStr * 0.5 +                        // stronger cast → more certain
    (centerRatio > 0.1 ? 0.3 : centerRatio * 3) +   // need center pixels
    (bgGreenDominant || subjectNeutral ? 0.2 : 0.1)  // clear spatial separation
  )).toFixed(3);

  // ── Warnings ───────────────────────────────────────────────────────────────
  const warnings = [];
  if (globalStr < 0.05)
    warnings.push('Very weak global cast — image appears colour-balanced, WB correction may be unnecessary');
  if (centerRatio < 0.05)
    warnings.push('Center zone has very few pixels — spatial cast separation may be unreliable');
  if (bgGreenDominant && !subjectNeutral)
    warnings.push('Background is green-dominant and subject also shows green cast — may be mixed illumination');
  if (results.shadows.label !== results.highlights.label &&
      results.shadows.label !== 'neutral' && results.highlights.label !== 'neutral')
    warnings.push(`Cast changes across tonal range: shadows=${results.shadows.label}, highlights=${results.highlights.label} — possible mixed lighting`);

  return { ...results, bgGreenDominant, subjectNeutral, dominantCast,
    // Phase 1
    confidence, warnings };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _acc(z, r, g, b) { z.rS+=r; z.gS+=g; z.bS+=b; z.n++; }

function _castFromAcc({ rS, gS, bS, n }) {
  if (n === 0) return { rbDiff:0, gDiff:0, label:'neutral', strength:0, pixelCount:0 };
  const aR = rS/n, aG = gS/n, aB = bS/n;
  const rbDiff  = aR - aB;
  const gDiff   = aG - (aR + aB) / 2;
  const strength = clamp(Math.sqrt(rbDiff**2 + gDiff**2) / 30, 0, 1);
  const label = _label(rbDiff, gDiff);
  return { rbDiff: +rbDiff.toFixed(2), gDiff: +gDiff.toFixed(2), label, strength: +strength.toFixed(3), pixelCount: n };
}

function _label(rbDiff, gDiff) {
  if (Math.abs(rbDiff) <= 4 && Math.abs(gDiff) <= 3) return 'neutral';
  if (Math.abs(gDiff) > Math.abs(rbDiff)) return gDiff > 0 ? 'green' : 'magenta';
  return rbDiff > 0 ? 'warm' : 'cool';
}
