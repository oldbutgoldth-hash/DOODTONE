/**
 * core/whitebalance-engine/index.js  v4
 *
 * White Balance Pro — v4
 *
 * Key changes from v2:
 *  1. Neutral-candidate detection (sat<0.12, lum 45-235, exclude skin/clip/green)
 *  2. Weighted multi-source blend:
 *     45% neutral pixels · 20% white-patch · 25% skin refinement · 10% gray-edge
 *  3. Confidence score → clamp output if low confidence
 *  4. Portrait guardrails: temp ±18, tint ±15/+18
 *  5. Corrected tint direction: green cast → positive tint (toward magenta)
 */

import { clamp, luminance, rgbToHsl } from '../color-engine/index.js';

// Robertson CCT table (CIE 1960 UCS)
const RBT = [
  {r:0,u:.18006,v:.26352,t:-.24341},{r:10,u:.18066,v:.26589,t:-.25479},
  {r:20,u:.18133,v:.26846,t:-.26876},{r:30,u:.18208,v:.27119,t:-.28539},
  {r:40,u:.18293,v:.27407,t:-.30470},{r:50,u:.18388,v:.27709,t:-.32675},
  {r:60,u:.18494,v:.28021,t:-.35156},{r:70,u:.18611,v:.28342,t:-.37915},
  {r:80,u:.18740,v:.28668,t:-.40955},{r:90,u:.18880,v:.28997,t:-.44278},
  {r:100,u:.19032,v:.29326,t:-.47888},{r:125,u:.19462,v:.30141,t:-.58204},
  {r:150,u:.19962,v:.30921,t:-.70471},{r:175,u:.20525,v:.31647,t:-.84901},
  {r:200,u:.21142,v:.32312,t:-1.0182},{r:225,u:.21807,v:.32909,t:-1.2168},
  {r:250,u:.22511,v:.33439,t:-1.4512},{r:275,u:.23247,v:.33904,t:-1.7298},
  {r:300,u:.24010,v:.34308,t:-2.0637},{r:325,u:.24792,v:.34655,t:-2.4681},
  {r:350,u:.25591,v:.34951,t:-2.9641},{r:375,u:.26400,v:.35200,t:-3.5814},
  {r:400,u:.27218,v:.35407,t:-4.3633},{r:425,u:.28039,v:.35577,t:-5.3762},
  {r:450,u:.28863,v:.35714,t:-6.7262},{r:475,u:.29685,v:.35823,t:-8.5955},
  {r:500,u:.30505,v:.35907,t:-11.324},{r:525,u:.31320,v:.35968,t:-15.628},
  {r:550,u:.32129,v:.36011,t:-23.325},{r:575,u:.32931,v:.36038,t:-40.770},
  {r:600,u:.33724,v:.36051,t:-116.45},
];

const MAX_DIM    = 320;
const STEP       = 3;
const SOG_P      = 6;
const WP_TOP_PCT = 0.005;
const CCT_MIN    = 2000;
const CCT_MAX    = 50000;
const CCT_MID    = 5500;

// ─── Public API (unchanged signatures) ───────────────────────────────────────

export function analyzeWhiteBalance(img, opts = {}) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(_analyze(img, opts)); }
      catch (e) { reject(e); }
    }, 0);
  });
}

/** Legacy compat — used by preset-engine */
export function inferWhiteBalance(stats) {
  const WS = { Portrait: 8, Wedding: 6, Landscape: -2, Travel: 2, General: 0 };
  return {
    temperature: clamp(Math.round(stats.rbDiff * 1.8 + (WS[stats.category] ?? 0)), -100, 100),
    tint:        clamp(Math.round(+stats.gDiff * 1.8), -100, 100),  // green cast → +tint (magenta)
  };
}

export function sliderToKelvin(s) {
  return s >= 0 ? Math.round(CCT_MID + s * (CCT_MAX - CCT_MID) / 100)
                : Math.round(CCT_MID + s * (CCT_MID - CCT_MIN) / 100);
}

export function kelvinToSlider(k) {
  return k >= CCT_MID
    ? clamp(Math.round((k - CCT_MID) / (CCT_MAX - CCT_MID) * 100), 0, 100)
    : clamp(Math.round((k - CCT_MID) / (CCT_MID - CCT_MIN) * 100), -100, 0);
}

// ─── Core v3 ─────────────────────────────────────────────────────────────────

function _analyze(img, opts) {
  if (!img.naturalWidth) throw new Error('Image not ready for WB');
  const { pixels } = _sample(img);

  const category  = opts.category ?? 'General';
  const skinPct   = opts.skinPct  ?? 0;
  const isPortrait= category === 'Portrait' || category === 'Wedding';
  const hasSkin   = skinPct > 5;
  // v4: cast context from color-cast-detector
  // If background is green but subject/center is neutral, reduce WB response
  const cast      = opts.cast ?? null;
  const bgGreenDom     = cast?.bgGreenDominant ?? false;
  const subjectNeutral = cast?.subjectNeutral  ?? false;

  // ── Source 1: neutral candidate pixels ──────────────────────────────────
  const neutralPx = _filterNeutralCandidates(pixels, hasSkin);
  const neutralEst = neutralPx.length > 40
    ? _gainsToEst(_grayWorld(neutralPx), 'Neutral Candidates')
    : null;

  // ── Source 2: white patch (brightest non-clipped) ────────────────────────
  const wpEst = _gainsToEst(_whitePatch(pixels), 'White Patch');

  // ── Source 3: shades-of-gray (whole image) ────────────────────────────
  const sogEst = _gainsToEst(_shadesOfGray(pixels), 'Shades of Gray');

  // ── Source 4: skin refinement (when skin present) ─────────────────────
  const skinEst = hasSkin ? _skinRefinement(pixels) : null;

  // ── Source 5: gray-edge (gradient-weighted) ───────────────────────────
  const geEst = _grainsToEst(_grayEdge(pixels), 'Gray Edge');

  // ── Weighted blend ────────────────────────────────────────────────────
  const sources = [];
  if (neutralEst) sources.push({ e: neutralEst, w: 0.45 });
  sources.push({ e: wpEst,  w: neutralEst ? 0.20 : 0.35 });
  if (skinEst)    sources.push({ e: skinEst,   w: 0.25 });
  sources.push({ e: geEst,  w: neutralEst ? 0.10 : 0.20 });
  if (!neutralEst && !skinEst) sources.push({ e: sogEst, w: 0.45 });

  // Normalise weights
  const totalW = sources.reduce((s, x) => s + x.w, 0);
  sources.forEach(x => { x.w /= totalW; });

  const consensus = _blend(sources);

  // ── Confidence score ─────────────────────────────────────────────────
  // High confidence: many neutral pixels, sources agree
  const tempSpread = _spread(sources.map(s => s.e.temperature));
  const tintSpread = _spread(sources.map(s => s.e.tint));
  const neutralRatio = neutralPx.length / Math.max(1, pixels.length);
  const confidence = clamp(
    0.4 * Math.min(1, neutralRatio * 5) +    // neutral pixel coverage
    0.3 * (1 - Math.min(1, tempSpread / 20)) + // source agreement on temp
    0.3 * (1 - Math.min(1, tintSpread / 10)),  // source agreement on tint
    0, 1
  );

  // ── Apply guardrails ─────────────────────────────────────────────────
  let { temperature, tint } = consensus;

  // Low confidence → clamp strongly toward neutral
  if (confidence < 0.4) {
    temperature = Math.round(temperature * 0.4);
    tint        = Math.round(tint * 0.4);
  } else if (confidence < 0.65) {
    temperature = Math.round(temperature * 0.7);
    tint        = Math.round(tint * 0.7);
  }

  // v4: Background green dominance with neutral subject → attenuate WB strongly.
  // The green is a background problem, not a scene-wide illuminant issue.
  // We still apply a small correction but don't let BG drive the whole preset.
  if (bgGreenDom && subjectNeutral) {
    temperature = Math.round(temperature * 0.35);
    tint        = Math.round(tint        * 0.35);
  } else if (bgGreenDom) {
    temperature = Math.round(temperature * 0.60);
    tint        = Math.round(tint        * 0.60);
  }

  // Portrait guardrails
  if (isPortrait) {
    temperature = clamp(temperature, -18, 18);
    tint        = clamp(tint,        -15, 18);
    // If skin detected and already yellow/green, never push tint further green
    if (hasSkin && tint < -8) tint = -8;
  }

  // Tint direction correction:
  // green cast (gDiff > 0) → positive tint (toward magenta) ← already correct in our calc
  // but clamp extreme tint values that look unnatural
  tint = clamp(tint, -30, 30);

  const finalConsensus = { temperature, tint,
    kelvin: sliderToKelvin(temperature),
    confidence: +confidence.toFixed(2),
  };

  // ── Legacy per-source results for canvas renderer ─────────────────────
  const gw  = _gainsToEst(_grayWorld(pixels),   'Gray World');
  const n = pixels.length;
  const sceneAvg = {
    r: Math.round(pixels.reduce((s,p) => s+p[0], 0) / n),
    g: Math.round(pixels.reduce((s,p) => s+p[1], 0) / n),
    b: Math.round(pixels.reduce((s,p) => s+p[2], 0) / n),
  };

  // ── Warnings ───────────────────────────────────────────────────────────────
  const wbWarnings = [];
  if (neutralPx.length < 20)
    wbWarnings.push(`Only ${neutralPx.length} neutral candidate pixels found — WB estimate may be unreliable`);
  if (confidence < 0.4)
    wbWarnings.push(`Low WB confidence (${(confidence*100).toFixed(0)}%) — sources disagree or neutral pixels scarce`);
  if (bgGreenDom && subjectNeutral)
    wbWarnings.push('Background green cast detected but subject is neutral — WB attenuation applied (70% reduction)');
  else if (bgGreenDom)
    wbWarnings.push('Background green dominant — WB response attenuated to avoid over-correction');
  const absTemp = Math.abs(finalConsensus.temperature);
  if (absTemp > 10 && confidence < 0.5)
    wbWarnings.push(`Temperature correction of ${finalConsensus.temperature} applied with low confidence — review result`);
  const absTint = Math.abs(finalConsensus.tint);
  if (absTint > 8 && confidence < 0.5)
    wbWarnings.push(`Tint correction of ${finalConsensus.tint} applied with low confidence — review result`);

  const castLabel = _cast(finalConsensus);
  const moodPreservation = _moodPreservation(finalConsensus, castLabel);
  // Stage 2.1: White Balance Intent — describes WHAT the reference's lighting
  // situation IS (mood, ambient colour, risk of scene-dependent cast) so
  // downstream stages can transfer INTENT, not raw Temp/Tint sliders.
  const wbIntent = _buildWBIntent({
    finalConsensus, castLabel, moodPreservation, cast, skinEst, hasSkin,
    confidence, neutralPxCount: neutralPx.length, isPortrait,
  });

  return {
    grayWorld:   gw,
    whitePatch:  wpEst,
    shadesOfGray: sogEst,
    consensus:   finalConsensus,
    sceneAvg,
    cast:        castLabel,
    // Phase 3: describes the reference's mood/cast rather than treating the
    // raw correction as something to apply in full. The Lightroom Mapping
    // Engine uses preservationFactor to decide how much of this computed
    // correction is "fixing a real defect" vs "neutralising an intentional
    // mood" — WB should describe, not auto-neutralise.
    moodPreservation,
    // Stage 2.1: the structured intent object — this is the single source
    // of truth for WB mood/risk read by Decision Engine, Lightroom Mapping,
    // Reference Transfer Intelligence, and the Explainability report.
    wbIntent,
    confidence,
    neutralPixelCount: neutralPx.length,
    category,
    // Phase 1 completion
    warnings: wbWarnings,
  };
}

// ─── White Balance Intent (Stage 2.1) ────────────────────────────────────────
// Transfer WB Intent, not WB sliders. This function reads everything the
// engine already computed above and turns it into a structured description
// of the reference's lighting situation — mood warmth, ambient colour
// direction, skin protection need, and how safe this is to transfer onto a
// DIFFERENT raw image under different lighting.

function _buildWBIntent({ finalConsensus, castLabel, moodPreservation, cast, skinEst, hasSkin, confidence, neutralPxCount, isPortrait }) {
  const { temperature: temp, tint } = finalConsensus;
  const reasons = [], warnings = [];

  // ── Mood warmth: direction + strength of the reference's overall WB ──────
  const moodWarmth = {
    direction: temp > 6 ? 'warm' : temp < -6 ? 'cool' : 'neutral',
    strength: clamp(Math.abs(temp) / 40, 0, 1),
  };
  reasons.push(`Reference mood reads ${moodWarmth.direction} (temp=${temp}, strength ${moodWarmth.strength.toFixed(2)}).`);

  // ── Skin warmth: how far the skin-region estimate sits from the neutral-
  //    warm target used by _skinRefinement, only meaningful when skin exists ─
  const skinWarmth = skinEst
    ? { direction: skinEst.temperature > 2 ? 'warm' : skinEst.temperature < -2 ? 'cool' : 'balanced',
        magnitude: +Math.abs(skinEst.temperature).toFixed(1), confidence: skinEst.confidence ?? 0.6 }
    : { direction: 'unknown', magnitude: 0, confidence: 0 };
  if (skinEst) reasons.push(`Skin warmth reads ${skinWarmth.direction} (Δ${skinWarmth.magnitude}).`);

  // ── Shadow/highlight bias — per-zone cast, when color-cast-detector ran ──
  const shadowBias    = cast?.shadows?.label    ?? 'unknown';
  const highlightBias = cast?.highlights?.label ?? 'unknown';

  // ── Ambient colour — the background/border cast, distinct from the
  //    subject: this is the "environment light colour", not the correction ─
  const ambientColor = cast?.border?.label ?? castLabel;

  // ── Neutral bias — how much real neutral-pixel evidence backs this
  //    estimate (more neutral pixels = more trustworthy WB read) ───────────
  const neutralBias = clamp(neutralPxCount / 200, 0, 1);

  // ── Risk flags ─────────────────────────────────────────────────────────
  const greenBounceRisk = clamp(
    (cast?.bgGreenDominant ? 0.6 : 0) + (castLabel === 'green' ? 0.4 : 0), 0, 1);
  if (greenBounceRisk > 0.3) warnings.push('Green ambient/bounce risk detected — Tint should be limited to avoid an unwanted green skin cast.');

  const magentaRisk = clamp(tint > 8 ? Math.min(1, tint / 30) : 0, 0, 1);
  if (magentaRisk > 0.3) warnings.push('Tint leans strongly magenta — verify this matches an intentional film-emulation look, not overcorrection.');

  const mixedLightingRisk = (shadowBias !== 'unknown' && highlightBias !== 'unknown' &&
    shadowBias !== highlightBias && shadowBias !== 'neutral' && highlightBias !== 'neutral')
    ? clamp(0.5 + Math.abs(temp) / 100, 0, 1) : 0;
  if (mixedLightingRisk > 0) warnings.push(`Mixed lighting signature: shadows read "${shadowBias}", highlights read "${highlightBias}" — this scene's cast is not uniform.`);

  // ── Transfer risk / confidence — how safely this WB reading generalises
  //    to a DIFFERENT raw image, as distinct from how well we understood
  //    THIS one (referenceConfidence, below). ──────────────────────────────
  const transferRiskScore = clamp(
    greenBounceRisk * 0.30 + magentaRisk * 0.20 + mixedLightingRisk * 0.35 +
    Math.min(0.15, Math.abs(temp) / 200), 0, 1);
  const transferRisk = transferRiskScore >= 0.55 ? 'high' : transferRiskScore >= 0.25 ? 'medium' : 'low';

  const referenceConfidence = +confidence.toFixed(3);
  const transferConfidence = +clamp(
    referenceConfidence * 0.5 + (1 - transferRiskScore) * 0.5, 0, 1
  ).toFixed(3);
  if (transferRisk !== 'low') reasons.push(`Transfer risk is ${transferRisk} (score ${transferRiskScore.toFixed(2)}) — this WB depends on this scene's specific lighting.`);

  // ── Preserve-mood vs neutralise decision + suggested Temp/Tint intensity ─
  const preserveMood = !moodPreservation.isLikelyDefect;
  const intensity = transferRiskScore >= 0.55 || referenceConfidence < 0.35 ? 'limited'
    : transferRiskScore >= 0.25 || referenceConfidence < 0.6 ? 'moderate'
    : 'subtle';
  reasons.push(preserveMood
    ? `Reading treated as intentional mood, not a defect — Temp/Tint intensity: ${intensity}.`
    : `Reading treated as a likely lighting defect — some correction is warranted (intensity: ${intensity}).`);

  // ── Skin-aware notes ───────────────────────────────────────────────────
  if (hasSkin) {
    if (greenBounceRisk > 0.3) warnings.push('Skin detected — green/bounce risk will be protected against in Lightroom Mapping regardless of transfer intensity.');
    if (moodWarmth.direction === 'warm' && skinWarmth.direction === 'warm' && (skinWarmth.confidence ?? 0) > 0.5) {
      reasons.push('Warm mood is supported by skin-tone confidence — warm skin rendering is safe to preserve.');
    } else if (moodWarmth.direction === 'warm') {
      warnings.push('Warm mood detected but skin-tone confidence is limited — avoid pushing warmth further than the reference itself.');
    }
  }

  return {
    moodWarmth, skinWarmth, shadowBias, highlightBias, ambientColor, neutralBias,
    greenBounceRisk: +greenBounceRisk.toFixed(3),
    magentaRisk: +magentaRisk.toFixed(3),
    mixedLightingRisk: +mixedLightingRisk.toFixed(3),
    transferRisk, transferRiskScore: +transferRiskScore.toFixed(3),
    referenceConfidence, transferConfidence,
    preserveMood, intensity,
    reasons, warnings,
  };
}

// ─── Mood preservation heuristic (Phase 3) ────────────────────────────────────
// Gray World / White Patch / Shades of Gray all compute a correction TOWARD
// neutral gray. Applying that correction at full strength auto-neutralises
// any intentional warm/cool mood the photographer built into the reference
// (golden hour, tungsten grade, blue-hour cool look, film-emulation
// magenta cast, etc.) — exactly what Reference Tone Extraction must avoid.
//
// This heuristic estimates how much of the computed correction is likely
// fixing a genuine technical defect (mixed lighting, sensor cast) versus
// how much is intentional creative mood that should be preserved.
function _moodPreservation(consensus, castLabel) {
  const { temperature, tint } = consensus;
  const magnitude = Math.sqrt(temperature ** 2 + tint ** 2);

  // Base "defect likelihood" per cast type, from common real-world causes:
  //  - green casts are overwhelmingly fluorescent/mixed-lighting defects
  //  - warm casts are overwhelmingly intentional (golden hour, warm grade)
  //  - magenta casts are commonly intentional (film-emulation looks)
  //  - cool casts are ambiguous (shade defect vs. intentional blue-hour)
  const defectLikelihood = {
    green:   0.65,
    magenta: 0.35,
    warm:    0.25,
    cool:    0.40,
    neutral: 0.20,
  }[castLabel] ?? 0.35;

  // Very large corrections are less likely to be a "pleasing" intentional
  // choice regardless of direction — nudge toward correcting them.
  const magnitudeBoost = magnitude > 30 ? 0.25 : magnitude > 15 ? 0.10 : 0;

  const preservationFactor = clamp(defectLikelihood + magnitudeBoost, 0.15, 0.85);
  const isLikelyDefect = preservationFactor > 0.5;

  return {
    preservationFactor: +preservationFactor.toFixed(2),
    isLikelyDefect,
    magnitude: +magnitude.toFixed(1),
    reason: `Cast="${castLabel}" (defect-likelihood ${defectLikelihood}), magnitude=${magnitude.toFixed(1)} → apply ${Math.round(preservationFactor*100)}% as correction, preserve ${Math.round((1-preservationFactor)*100)}% as intentional mood.`,
  };
}

// ─── Neutral candidate filter (Task 001 spec) ─────────────────────────────────

function _filterNeutralCandidates(pixels, hasSkin) {
  return pixels.filter(([r, g, b]) => {
    const lum = luminance(r, g, b);
    if (lum < 45 || lum > 235)     return false;   // too dark or clipped
    const { s } = rgbToHsl(r, g, b);
    if (s > 0.12)                  return false;   // colourful pixel

    // Exclude green-biased pixels (vegetation, green backgrounds)
    // v4: tightened to 1.07 — even subtle green BG should not count as neutral
    if (g > r * 1.07 && g > b * 1.07) return false;

    // Exclude skin-range pixels when skin present (YCbCr model)
    if (hasSkin) {
      const Y  = 0.299*r + 0.587*g + 0.114*b;
      const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
      const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
      if (Y>80&&Y<235&&Cb>77&&Cb<127&&Cr>133&&Cr<173) return false;
    }

    // Exclude strong red or blue clothing / objects
    if (r > g * 1.35 && r > b * 1.35) return false;
    if (b > r * 1.35 && b > g * 1.35) return false;

    // Exclude strong yellow/amber (scarf, warm light spill)
    if (r > b * 1.5 && g > b * 1.3)   return false;

    return true;
  });
}

// ─── Skin refinement ──────────────────────────────────────────────────────────
// Skin pixels should be slightly warm (R>B). Compute what temp/tint
// correction would neutralise any green/cool cast in the skin area.

function _skinRefinement(pixels) {
  const skinPx = pixels.filter(([r, g, b]) => {
    const Y  = 0.299*r + 0.587*g + 0.114*b;
    const Cb = 128 - 0.168736*r - 0.331264*g + 0.5*b;
    const Cr = 128 + 0.5*r - 0.418688*g - 0.081312*b;
    return Y>80&&Y<235&&Cb>77&&Cb<127&&Cr>133&&Cr<173;
  });
  if (skinPx.length < 20) return null;
  const n  = skinPx.length;
  const aR = skinPx.reduce((s,[r])=>s+r,0)/n;
  const aG = skinPx.reduce((s,[,g])=>s+g,0)/n;
  const aB = skinPx.reduce((s,[,,b])=>s+b,0)/n;
  // Ideal skin: R should exceed B. Correct cast in skin zone.
  const gDiff   = aG - (aR + aB) / 2;
  // Skin warmth reference model:
  // Natural skin has R > B. We compare against a reference warmth ratio,
  // not raw R-B, to avoid overcorrecting warm skin tones.
  const skinWarmth  = (aR - aB) / Math.max(1, (aR + aG + aB) / 3);
  const targetWarmth= 0.18;   // tuneable — conservative neutral-warm target
  const warmthError = skinWarmth - targetWarmth;
  const temp    = clamp(Math.round(-warmthError * 35), -8, 8);  // fine-tune only
  const tint    = clamp(Math.round(+gDiff * 1.2), -12, 12);  // green cast → gDiff>0 → +tint (magenta)
  const kelvin  = sliderToKelvin(temp);
  return { temperature: temp, tint, kelvin, confidence: 0.7, source: 'Skin Refinement' };
}

// ─── Gray Edge ────────────────────────────────────────────────────────────────
// Weight pixels by local gradient magnitude — edges of neutral objects
// are a reliable WB cue (van de Weijer et al.)

function _grayEdge(pixels) {
  // Approximate: low-sat pixels with moderate luminance spread near neutral
  const candidates = pixels.filter(([r, g, b]) => {
    const { s } = rgbToHsl(r, g, b);
    const lum = luminance(r, g, b);
    return s < 0.18 && lum > 30 && lum < 240;
  });
  if (candidates.length < 10) return { r: 1, g: 1, b: 1 };
  const n = candidates.length;
  const aR = candidates.reduce((s,[r])=>s+r,0)/n;
  const aG = candidates.reduce((s,[,g])=>s+g,0)/n;
  const aB = candidates.reduce((s,[,,b])=>s+b,0)/n;
  const ref = (aR + aG + aB) / 3;
  return { r: ref/Math.max(1,aR), g: ref/Math.max(1,aG), b: ref/Math.max(1,aB) };
}

// ─── Classic algorithms (unchanged) ──────────────────────────────────────────

function _grayWorld(pixels) {
  const n = pixels.length; if (!n) return {r:1,g:1,b:1};
  let rS=0,gS=0,bS=0;
  for (const [r,g,b] of pixels) { rS+=r; gS+=g; bS+=b; }
  const ref = (rS+gS+bS)/(3*n);
  return { r:ref/(rS/n), g:ref/(gS/n), b:ref/(bS/n) };
}

function _whitePatch(pixels) {
  // Task 002: filter to near-white candidates only, excluding saturated colours
  const candidates = pixels.filter(([r, g, b]) => {
    const lum = (r + g + b) / 3;
    if (lum < 170 || lum > 245)       return false;  // must be bright but not clipped
    if (r > 250 || g > 250 || b > 250) return false;  // exclude clipped channels
    // Compute approximate saturation — reject coloured objects
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const sat = max > 0 ? (max - min) / max : 0;
    if (sat > 0.18)                    return false;  // too colourful
    // Exclude strong colour bias (red scarf, blue shirt, green BG, yellow)
    if (r > g * 1.3 || r > b * 1.3)   return false;  // red bias
    if (b > r * 1.3 || b > g * 1.3)   return false;  // blue bias
    if (g > r * 1.2 || g > b * 1.2)   return false;  // green bias
    if (r > b * 1.5 && g > b * 1.3)   return false;  // yellow/amber bias
    return true;
  });
  // Fallback: if not enough white candidates, return neutral (no-op)
  if (candidates.length < 20) return { r: 1, g: 1, b: 1 };
  const n   = candidates.length;
  const aR  = candidates.reduce((s,[r])=>s+r,0)/n;
  const aG  = candidates.reduce((s,[,g])=>s+g,0)/n;
  const aB  = candidates.reduce((s,[,,b])=>s+b,0)/n;
  const ref = (aR+aG+aB)/3;
  return {r:ref/Math.max(1,aR),g:ref/Math.max(1,aG),b:ref/Math.max(1,aB)};
}

function _shadesOfGray(pixels) {
  const p = SOG_P;
  const n = pixels.length; if (!n) return {r:1,g:1,b:1};
  let rS=0,gS=0,bS=0;
  for (const [r,g,b] of pixels) { rS+=r**p; gS+=g**p; bS+=b**p; }
  const rM=(rS/n)**(1/p),gM=(gS/n)**(1/p),bM=(bS/n)**(1/p);
  const ref=(rM+gM+bM)/3;
  return {r:ref/Math.max(1,rM),g:ref/Math.max(1,gM),b:ref/Math.max(1,bM)};
}

function _gainsToEst(gains, source) {
  const { r, g, b } = gains;
  const gFactor = g || 1;
  const rCorr   = (r / gFactor - 1);
  const bCorr   = (b / gFactor - 1);
  const rbDiff  = rCorr - bCorr;
  // gDiff: green fraction relative to (r+b)/2
  // green cast → g > avg(r,b) → gDiff > 0 → tint positive (toward magenta) ✓
  // gDiff: green EXCESS in image (not gain direction).
  // gainG < 1 → image has too much green → gDiff positive → tint positive (magenta) ✓
  // This is the INVERSE of the gain value: (1 - gainG) = green excess fraction
  const gDiff   = 1 - g;   // g is gainG; if gainG<1 (green heavy) → gDiff>0 ✓
  const temp    = clamp(Math.round(rbDiff * 28), -100, 100);
  const tint    = clamp(Math.round(gDiff  * 22), -100, 100);
  const kelvin  = sliderToKelvin(temp);
  const confidence = 0.5;
  // Backward-compat fields used by whitebalance-renderer
  const label   = source;
  const gainR   = +(r).toFixed(4);
  const gainG   = +(g).toFixed(4);
  const gainB   = +(b).toFixed(4);
  return { temperature: temp, tint, kelvin, confidence, source, label, gainR, gainG, gainB };
}

// Gray Edge gains → estimate (same conversion)
function _grainsToEst(gains, source) {
  return _gainsToEst(gains, source);
}

function _blend(sources) {
  let tempW=0,tintW=0,totalW=0;
  for (const {e,w} of sources) {
    if (!e) continue;
    tempW += (e.temperature ?? 0) * w;
    tintW += (e.tint ?? 0) * w;
    totalW += w;
  }
  const temperature = Math.round(totalW > 0 ? tempW / totalW : 0);
  const tint        = Math.round(totalW > 0 ? tintW / totalW : 0);
  return { temperature, tint, kelvin: sliderToKelvin(temperature), confidence: 0.6 };
}

function _spread(vals) {
  const n = vals.length; if (n < 2) return 0;
  const mean = vals.reduce((s,v)=>s+v,0)/n;
  return Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/n);
}

function _cast({ temperature, tint }) {
  if (Math.abs(temperature) <= 3 && Math.abs(tint) <= 3) return 'neutral';
  if (temperature >  8) return 'warm';
  if (temperature < -8) return 'cool';
  if (tint >  8) return 'magenta';      // renderer key
  if (tint < -8) return 'green';        // renderer key
  return temperature > 0 ? 'warm' : 'cool';
}

function _sample(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx = cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const data = ctx.getImageData(0,0,w,h).data;
  const pixels = [];
  for (let i=0; i<w*h; i+=STEP) {
    const o=i*4; if(data[o+3]<128) continue;
    pixels.push([data[o],data[o+1],data[o+2]]);
  }
  return { pixels };
}
