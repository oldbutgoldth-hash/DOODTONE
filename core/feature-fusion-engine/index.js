/**
 * core/feature-fusion-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FEATURE FUSION ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Reference Image → 22 Analysis Modules → [ FEATURE FUSION ENGINE ] →
 *   Style Feature Graph → Style Fingerprint → Decision Engine →
 *   Lightroom Mapping Engine → Pre-XMP Validation Pass → XMP Export
 *
 * Every analysis module produces its own opinion about the image, in its
 * own shape, with its own notion of confidence — and until now, the Style
 * Fingerprint read each of those opinions directly and gave them roughly
 * equal say. This module is the layer in between: it normalises every
 * engine's output into one common shape, weights each by BOTH how much we
 * trust that class of engine in general (enginePriority) and how confident
 * THIS run of the engine was (confidence), detects when two engines
 * disagree about the same thing, resolves the disagreement in favour of
 * the higher-trust source, and emits a single, coherent Style Feature
 * Graph — the thing the Style Fingerprint should actually read from.
 *
 * Nothing here reads the DOM or produces Lightroom values — pure data in,
 * a structured graph out.
 */

// ─── Engine priority weights (as specified) ──────────────────────────────────
// Higher = more trusted as a STYLE signal. Basic Panel and Histogram sit at
// the bottom on purpose — they describe raw pixel statistics, not editorial
// intent, and must never outweigh the engines that actually recognise style.
export const ENGINE_PRIORITY = {
  'style-recognition-engine': 1.00,
  'skintone-engine':          0.95,
  'skin-classifier':          0.95,
  'colorgrading-ai-engine':   0.94,
  'kmeans-engine':            0.92,   // palette
  'color-harmony-engine':     0.90,
  'tone-curve-ai-engine':     0.90,
  'curve-engine':             0.88,
  'whitebalance-engine':      0.85,
  'calibration-engine':       0.82,
  'hsl-analyzer-engine':      0.80,
  'hsl-engine':               0.78,
  'color-cast-detector':      0.76,
  'scene-classifier':         0.75,
  'histogram-engine':         0.40,
  'basic-panel-engine':       0.20,
};

// Preference order used as a tiebreaker when two features disagree about
// the same intent and their effectiveWeights land close together.
const PREFERRED_OVER = [
  'style-recognition-engine', 'skintone-engine', 'skin-classifier',
  'kmeans-engine', 'color-harmony-engine', 'colorgrading-ai-engine',
  'tone-curve-ai-engine', 'curve-engine', 'whitebalance-engine',
  'calibration-engine', 'hsl-analyzer-engine', 'hsl-engine',
  'color-cast-detector', 'scene-classifier',
  'histogram-engine', 'basic-panel-engine',
];

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

// ─── Conflict detection thresholds (Phase 4.1) ───────────────────────────────
// Centralised here so every trigger point for a disagreement is easy to find
// and tune in one place, instead of scattered magic numbers inside
// _detectConflicts(). Defaults are kept conservative — they flag only
// clear, sizeable disagreements, not minor noise between two engines that
// are basically in agreement. Do not over-tune without real-world samples.
export const CONFLICT_THRESHOLDS = {
  warmth: {
    // WB temp slider units beyond which we call it "warm"/"cool" rather
    // than neutral, for the purpose of comparing against palette hue.
    wbWarmCool: 6,
    // Palette dominant-hue bands (degrees) treated as warm/cool for the
    // WB-vs-palette warmth comparison. Anything outside both bands is
    // ambiguous (yellow-green/teal transition zones) and not flagged.
    paletteWarmHueMax: 60,     // hue < 60° or > 300° = warm band
    paletteWarmHueMin: 300,
    paletteCoolHueMin: 150,    // 150°–260° = cool band
    paletteCoolHueMax: 260,
  },
  highlight: {
    // Histogram clipHiPct (%) above which we consider "bright" enough to
    // compare against a Style Recognition high-key/luxury trait match.
    histBrightClipPct: 3,
  },
  calibration: {
    // Skin-detection confidence above which we trust it enough to flag a
    // conflict if Calibration wants a large simultaneous shift.
    skinConfidenceHigh: 0.7,
    // Combined |hue|+|sat| magnitude across R/G/B primaries considered a
    // "strong" calibration shift worth flagging against high-confidence skin.
    calibrationMagnitude: 15,
  },
  hslVsPalette: {
    // Max per-channel |satAdj| considered a "strong" HSL saturation push.
    hslMaxSatAdj: 15,
    // Palette average saturation (%) below which the image is considered
    // "muted" for the purpose of this comparison.
    paletteMutedAvgSat: 25,
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   stats: object, basic: object|null, wb: object|null, skin: object|null,
 *   hsl: object|null, calibration: object|null, grading: object|null,
 *   toneCurves: object|null, palette: object|null, harmony: object|null,
 *   styleRecognition: object|null,
 * }} ctx  same shape app.js already gathers for buildStyleFingerprint
 * @returns {object} StyleFeatureGraph
 */
export function buildStyleFeatureGraph(ctx) {
  const features = _collectFeatures(ctx);

  const mood            = _resolveMood(ctx, features);
  const warmth           = _resolveWarmth(ctx, features);
  const colorCast        = _resolveColorCast(ctx, features);
  const paletteIntent    = _resolvePalette(ctx, features);
  const harmonyIntent    = _resolveHarmony(ctx, features);
  const skinIntent       = _resolveSkin(ctx, features);
  const contrastIntent   = _resolveContrast(ctx, features);
  const highlightIntent  = _resolveHighlight(ctx, features);
  const shadowIntent     = _resolveShadow(ctx, features);
  const curveIntent      = _resolveCurve(ctx, features);
  const gradingIntent    = _resolveGrading(ctx, features);
  const calibrationIntent= _resolveCalibration(ctx, features);
  const hslIntent        = _resolveHSL(ctx, features);
  const basicToneIntent  = _resolveBasicTone(ctx, features);

  const conflicts = _detectConflicts(ctx, features, {
    mood, warmth, colorCast, paletteIntent, skinIntent, calibrationIntent, hslIntent,
  });

  const warnings = features.flatMap(f => f.warnings.map(w => `[${f.id}] ${w}`));
  const reasons  = [
    mood.reason, warmth.reason, colorCast.reason, paletteIntent.reason,
    harmonyIntent.reason, skinIntent.reason, contrastIntent.reason,
    highlightIntent.reason, shadowIntent.reason, curveIntent.reason,
    gradingIntent.reason, calibrationIntent.reason, hslIntent.reason,
    basicToneIntent.reason,
  ].filter(Boolean);

  const overallStyleConfidence = _overallConfidence(features);

  return {
    mood, warmth, colorCast, paletteIntent, harmonyIntent, skinIntent,
    contrastIntent, highlightIntent, shadowIntent, curveIntent, gradingIntent,
    calibrationIntent, hslIntent, basicToneIntent,
    overallStyleConfidence, conflicts, warnings, reasons,
    // Raw normalised feature list — useful for debugging / Pre-XMP awareness.
    features,
  };
}

/**
 * Normalise one engine's contribution into the common shape.
 * Exported so other modules (decision-engine, xmp-validator) can build ad
 * hoc normalised features too, keeping the shape consistent everywhere.
 *
 * @returns {{id,category,value,confidence,weight,effectiveWeight,warnings,reasons}}
 */
export function normalizeFeature(id, category, value, confidence, warnings = [], reasons = []) {
  const weight = ENGINE_PRIORITY[id] ?? 0.5;
  const conf   = clamp01(confidence);
  return {
    id, category, value,
    confidence: +conf.toFixed(3),
    weight,
    effectiveWeight: +(weight * conf).toFixed(4),
    warnings: warnings ?? [],
    reasons:  reasons ?? [],
  };
}

// ─── Feature collection ─────────────────────────────────────────────────────
// Extracts every usable signal from the raw engine outputs into the common
// normalised shape. One engine can contribute multiple features (e.g. WB
// contributes both a "warmth" feature and a "colorCast" feature).

function _collectFeatures(ctx) {
  const { stats, basic, wb, skin, hsl, calibration, grading, toneCurves, palette, harmony, styleRecognition } = ctx;
  const out = [];
  const push = (id, category, value, confidence, warnings, reasons) =>
    out.push(normalizeFeature(id, category, value, confidence, warnings, reasons));

  // ── style-recognition-engine (1.00) ──────────────────────────────────────
  if (styleRecognition?.top) {
    const t = styleRecognition.top;
    push('style-recognition-engine', 'mood', { style: t.style, traits: t.traits ?? [] },
      (t.confidence ?? 0) / 100, styleRecognition.warnings, [styleRecognition.reason]);
    if (styleRecognition.features) {
      const f = styleRecognition.features;
      push('style-recognition-engine', 'warmth', f.warmth, (t.confidence ?? 50) / 100);
      push('style-recognition-engine', 'contrast', f.contrast, (t.confidence ?? 50) / 100);
      push('style-recognition-engine', 'highlight', f.highlightMass, (t.confidence ?? 50) / 100);
      push('style-recognition-engine', 'shadow', f.shadowMass, (t.confidence ?? 50) / 100);
    }
  }

  // ── skintone-engine / skin-classifier (0.95) ─────────────────────────────
  if (skin?.detected || (skin?.coveragePct ?? 0) > 4) {
    const sourceId = skin?.modelAgreement ? 'skintone-engine' : 'skin-classifier';
    const s = skin.avgHSL?.s ?? 0, l = skin.avgHSL?.l ?? 0;
    push(sourceId, 'skin', {
      hue: skin.avgHSL?.h ?? 30,
      sat: s > 1 ? s : s * 100,
      lum: l > 1 ? l : l * 100,
    }, skin.confidence ?? 0.5, skin.warnings, [skin.reason]);
  }

  // ── colorgrading-ai-engine (0.94) ────────────────────────────────────────
  if (grading) {
    push('colorgrading-ai-engine', 'grading', {
      shadows: grading.shadows, midtones: grading.midtones, highlights: grading.highlights,
      look: grading.look,
    }, grading.confidence ?? 0.5, grading.warnings);
  }

  // ── kmeans-engine / palette (0.92) ───────────────────────────────────────
  if (palette?.colors?.length) {
    const avgSat = palette.colors.reduce((s, c) => s + c.hsl.s, 0) / palette.colors.length;
    push('kmeans-engine', 'palette', {
      dominantHue: palette.dominant?.hsl?.h ?? null,
      avgSat: +avgSat.toFixed(1),
      colours: palette.colors.length,
    }, palette.confidence ?? 0.5, palette.warnings);
  }

  // ── color-harmony-engine (0.90) ──────────────────────────────────────────
  if (harmony) {
    push('color-harmony-engine', 'harmony', {
      scheme: harmony.recommended, matchScore: harmony.recommendedMatchScore,
    }, harmony.confidence ?? 0.5, harmony.warnings);
  }

  // ── tone-curve-ai-engine (0.90) ──────────────────────────────────────────
  if (toneCurves?.master) {
    const pts = toneCurves.master.points ?? [];
    push('tone-curve-ai-engine', 'curve', {
      shadowY: pts[0]?.y ?? null, highlightY: pts[pts.length - 1]?.y ?? null,
      gamma: toneCurves.master.gamma,
    }, toneCurves.confidence ?? 0.5, toneCurves.warnings);
  }

  // ── whitebalance-engine (0.85) ────────────────────────────────────────────
  if (wb?.consensus) {
    push('whitebalance-engine', 'warmth', wb.consensus.temperature, wb.confidence ?? 0.5, wb.warnings);
    push('whitebalance-engine', 'colorCast', wb.cast, wb.confidence ?? 0.5);
  }

  // ── calibration-engine (0.82) ────────────────────────────────────────────
  if (calibration) {
    push('calibration-engine', 'calibration', {
      red: calibration.red, green: calibration.green, blue: calibration.blue,
    }, calibration.confidence ?? 0.5, calibration.warnings);
  }

  // ── hsl-analyzer-engine (0.80) ────────────────────────────────────────────
  if (hsl?.channels) {
    push('hsl-analyzer-engine', 'hsl', hsl.channels, hsl.confidence ?? 0.5, hsl.warnings);
  }

  // ── color-cast-detector (0.76) ───────────────────────────────────────────
  if (ctx.cast) {
    push('color-cast-detector', 'colorCast', ctx.cast.global?.label ?? ctx.cast.dominantCast,
      ctx.cast.confidence ?? 0.5, ctx.cast.warnings);
  }

  // ── scene-classifier (0.75) ──────────────────────────────────────────────
  if (ctx.scene) {
    push('scene-classifier', 'scene', ctx.scene.category, ctx.scene.confidence ?? 0.5, ctx.scene.warnings);
  }

  // ── histogram-engine (0.40) ──────────────────────────────────────────────
  if (stats) {
    push('histogram-engine', 'warmth', stats.rbDiff, stats.confidence ?? 0.5);
    push('histogram-engine', 'contrast', stats.contrast, stats.confidence ?? 0.5);
    push('histogram-engine', 'highlight', stats.clipHiPct, stats.confidence ?? 0.5);
    push('histogram-engine', 'shadow', stats.clipLoPct, stats.confidence ?? 0.5);
  }

  // ── basic-panel-engine (0.20) ────────────────────────────────────────────
  if (basic) {
    push('basic-panel-engine', 'basicTone', {
      toneStyle: basic.toneStyle?.tag, exposureClass: basic.exposureClass,
    }, basic.confidence ?? 0.5, basic.warnings);
  }

  return out;
}

// ─── Intent resolvers ───────────────────────────────────────────────────────
// Each resolver looks at the features tagged with its category, picks the
// winner by effectiveWeight (confidence × enginePriority), and explains why.

function _byCategory(features, cat) {
  return features.filter(f => f.category === cat).sort((a, b) => b.effectiveWeight - a.effectiveWeight);
}

// ─── Mood resolution helpers (Phase 4.1) ─────────────────────────────────────

// Structured lookup: style-recognition-engine's `style` field is a fixed,
// closed set of 10 categories (see core/style-recognition-engine PROFILES).
// This is a far more robust signal than parsing free-text traits — use it
// as the PRIMARY source whenever a style-recognition result is available.
const STYLE_TO_MOOD = {
  Wedding:     'airy_bright',    // 'Bright & airy', 'Soft highlights', 'Lifted shadows'
  Portrait:    'balanced',       // 'Controlled contrast' — no strong directional skew
  Landscape:   'high_contrast',  // 'Wide dynamic range', 'High saturation'
  Travel:      'balanced',       // 'Diverse palette', 'Mixed scene elements'
  Food:        'airy_bright',    // 'Bright exposure', 'Warm saturated palette'
  Street:      'high_contrast',  // 'High contrast', 'Deep shadows', 'Gritty texture'
  Fashion:     'soft_highlight', // 'Studio lighting', 'Strong highlight presence'
  Documentary: 'low_contrast',   // 'Muted palette', 'Natural contrast'
  Vintage:     'matte_shadow',   // 'Faded blacks', 'Compressed contrast'
  Luxury:      'airy_bright',    // 'Clean blacks', 'Bright highlights', 'High-end look'
};

// Keyword aliases used ONLY as a fallback when the structured style lookup
// above is unavailable (e.g. style-recognition failed, or a future style
// name isn't in the table yet). Covers the common mood vocabulary a trait
// string is likely to contain. `warm`/`cool` intentionally map to null —
// they describe WARMTH (handled by _resolveWarmth), not tonal character,
// so they must not silently overwrite a mood tag here.
const MOOD_ALIASES = {
  airy: 'airy_bright', bright: 'airy_bright', 'high-key': 'airy_bright',
  highkey: 'airy_bright', pastel: 'airy_bright', clean: 'airy_bright',
  soft: 'soft_highlight',
  moody: 'moody_dark', 'deep shadow': 'moody_dark', gritty: 'moody_dark',
  cinematic: 'high_contrast',
  filmic: 'matte_shadow', matte: 'matte_shadow', 'faded black': 'matte_shadow',
  muted: 'low_contrast', desaturated: 'low_contrast',
  warm: null, cool: null,   // warmth signal, not a mood tag — see note above
};

/** Look up a mood tag from free-text traits using MOOD_ALIASES (fallback only). */
function _moodFromTraitsKeywords(traits) {
  const text = (traits ?? []).join(' ').toLowerCase();
  for (const [alias, tag] of Object.entries(MOOD_ALIASES)) {
    if (tag && text.includes(alias)) return tag;
  }
  return null;
}

function _resolveMood(ctx, features) {
  const basicTone = _byCategory(features, 'basicTone')[0];
  const styleFeat = _byCategory(features, 'mood')[0];

  const fallbackTag = ctx.stats ? (ctx.stats.avgLum < 90 ? 'moody_dark' : ctx.stats.avgLum > 175 ? 'airy_bright' : 'balanced') : 'balanced';
  const basicTag = basicTone?.value?.toneStyle ?? fallbackTag;

  // ── Primary: structured style-recognition category lookup ────────────────
  const styleName = styleFeat?.value?.style;
  const structuredTag = styleName ? STYLE_TO_MOOD[styleName] : null;

  // ── Fallback: keyword/alias matching over traits, only if the structured
  //    lookup produced nothing (unknown style name or no style-recognition) ─
  const traits = styleFeat?.value?.traits ?? [];
  const aliasTag = structuredTag ? null : _moodFromTraitsKeywords(traits);

  const styleTag = structuredTag ?? aliasTag;   // whichever source produced a result
  const sourceLabel = structuredTag ? `structured style "${styleName}"` : aliasTag ? 'trait keyword fallback' : null;

  let tag = basicTag, confidence = basicTone?.confidence ?? 0.5, reason;

  if (styleTag && styleTag !== 'balanced' && basicTag !== styleTag) {
    // Style Recognition (weight 1.00) outranks Basic Panel (weight 0.20) —
    // its resolved tag wins whenever it disagrees and isn't itself neutral.
    tag = styleTag;
    confidence = Math.max(confidence, styleFeat?.confidence ?? 0.5);
    reason = `Mood: Basic Panel says "${basicTag}", overridden by Style Recognition (${sourceLabel}) → "${tag}".`;
  } else if (styleTag && styleTag === basicTag) {
    confidence = Math.max(confidence, styleFeat?.confidence ?? 0.5);
    reason = `Mood: "${tag}" — Basic Panel and Style Recognition (${sourceLabel}) agree.`;
  } else {
    reason = `Mood: "${tag}" from Basic Panel tone descriptor (weight ${basicTone?.weight ?? 0.2}, low-priority — no stronger structured signal available).`;
  }

  const labelMap = { airy_bright:'Airy Bright', soft_highlight:'Soft Highlight', matte_shadow:'Matte Shadow',
    moody_dark:'Moody Dark', high_contrast:'High Contrast', low_contrast:'Low Contrast', balanced:'Balanced' };

  return { tag, label: labelMap[tag] ?? tag, confidence: +confidence.toFixed(3), reason };
}

function _resolveWarmth(ctx, features) {
  const cands = _byCategory(features, 'warmth');
  if (!cands.length) return { direction: 'neutral', strength: 0, confidence: 0.3, reason: 'Warmth: no source available — defaulting neutral.' };

  // Convert each candidate to a signed [-1,1] warmth score for comparison,
  // then take an effectiveWeight-weighted average (not just the top pick) —
  // this is a genuinely continuous quantity, unlike categorical intents.
  const scored = cands.map(f => {
    let s = 0;
    if (f.id === 'style-recognition-engine') s = Math.max(-1, Math.min(1, f.value / 40));   // avgR-avgB, ±40 → ±1
    else if (f.id === 'whitebalance-engine')  s = Math.max(-1, Math.min(1, f.value / 30));   // temp slider units
    else if (f.id === 'histogram-engine')     s = Math.max(-1, Math.min(1, f.value / 15));   // rbDiff
    return { ...f, score: s };
  });
  const totalW = scored.reduce((s, f) => s + f.effectiveWeight, 0) || 1;
  const blended = scored.reduce((s, f) => s + f.score * f.effectiveWeight, 0) / totalW;

  const direction = blended > 0.12 ? 'warm' : blended < -0.12 ? 'cool' : 'neutral';
  const strength  = +Math.min(1, Math.abs(blended)).toFixed(3);
  const topSource = scored[0];
  const conf = +(scored.reduce((s, f) => s + f.confidence * f.effectiveWeight, 0) / totalW).toFixed(3);

  return {
    direction, strength, confidence: conf,
    reason: `Warmth: blended ${scored.length} source(s) [${scored.map(f=>f.id).join(', ')}] → ${direction} (strength ${strength}). Dominant: ${topSource.id}.`,
  };
}

function _resolveColorCast(ctx, features) {
  const cands = _byCategory(features, 'colorCast');
  if (!cands.length) return { label: 'neutral', confidence: 0.3, reason: 'Colour cast: no source available — defaulting neutral.' };
  const winner = cands[0];
  const agreeing = cands.filter(f => f.value === winner.value);
  const disagreeing = cands.filter(f => f.value !== winner.value);
  const reason = disagreeing.length
    ? `Colour cast: "${winner.value}" wins (${winner.id}, effectiveWeight ${winner.effectiveWeight}) over ${disagreeing.map(f=>`"${f.value}" (${f.id})`).join(', ')}.`
    : `Colour cast: "${winner.value}" — ${agreeing.length} source(s) agree [${agreeing.map(f=>f.id).join(', ')}].`;
  return { label: winner.value, confidence: winner.confidence, reason };
}

function _resolvePalette(ctx, features) {
  const f = _byCategory(features, 'palette')[0];
  if (!f) return { dominantHue: null, avgSat: null, confidence: 0.3, reason: 'Palette: not yet resolved.' };
  return {
    dominantHue: f.value.dominantHue, avgSat: f.value.avgSat, colourCount: f.value.colours,
    confidence: f.confidence,
    reason: `Palette: dominant hue ${f.value.dominantHue ?? '?'}°, avg sat ${f.value.avgSat ?? '?'}% across ${f.value.colours} clusters.`,
  };
}

function _resolveHarmony(ctx, features) {
  const f = _byCategory(features, 'harmony')[0];
  if (!f) return { scheme: null, confidence: 0.3, reason: 'Harmony: not yet resolved.' };
  return { scheme: f.value.scheme, matchScore: f.value.matchScore, confidence: f.confidence,
    reason: `Harmony: recommended "${f.value.scheme}" (match ${f.value.matchScore}).` };
}

function _resolveSkin(ctx, features) {
  const f = _byCategory(features, 'skin')[0];
  if (!f) return { detected: false, confidence: 0.3, reason: 'Skin: not detected.' };
  return { detected: true, hue: f.value.hue, sat: f.value.sat, lum: f.value.lum, confidence: f.confidence,
    reason: `Skin: detected via ${f.id} (confidence ${f.confidence}) — hue ${Math.round(f.value.hue)}°.` };
}

function _resolveContrast(ctx, features) {
  const cands = _byCategory(features, 'contrast');
  if (!cands.length) return { level: 'medium', confidence: 0.3, reason: 'Contrast: no source — defaulting medium.' };
  const winner = cands[0];
  const sigma = typeof winner.value === 'number' ? winner.value : (ctx.stats?.contrast ?? 50);
  const level = sigma < 32 ? 'low' : sigma > 72 ? 'high' : 'medium';
  return { level, sigma, confidence: winner.confidence,
    reason: `Contrast: σ=${sigma} (from ${winner.id}) → "${level}".` };
}

function _resolveHighlight(ctx, features) {
  const cands = _byCategory(features, 'highlight');
  if (!cands.length) return { level: 'balanced', confidence: 0.3, reason: 'Highlight: no source available.' };
  const winner = cands[0];
  const hiM = typeof winner.value === 'number' ? winner.value : 0;
  const level = hiM > 30 ? 'bright' : hiM < 8 ? 'sparse' : 'balanced';
  return { level, mass: hiM, confidence: winner.confidence,
    reason: `Highlight: ${hiM}% mass (from ${winner.id}) → "${level}".` };
}

function _resolveShadow(ctx, features) {
  const cands = _byCategory(features, 'shadow');
  if (!cands.length) return { level: 'balanced', confidence: 0.3, reason: 'Shadow: no source available.' };
  const winner = cands[0];
  const shM = typeof winner.value === 'number' ? winner.value : 0;
  const level = shM > 30 ? 'deep' : shM < 8 ? 'sparse' : 'balanced';
  return { level, mass: shM, confidence: winner.confidence,
    reason: `Shadow: ${shM}% mass (from ${winner.id}) → "${level}".` };
}

function _resolveCurve(ctx, features) {
  const f = _byCategory(features, 'curve')[0];
  if (!f) return { shadowY: null, highlightY: null, confidence: 0.3, reason: 'Curve: not yet resolved.' };
  return { shadowY: f.value.shadowY, highlightY: f.value.highlightY, gamma: f.value.gamma, confidence: f.confidence,
    reason: `Curve intent: shadow anchor Y=${f.value.shadowY}, highlight anchor Y=${f.value.highlightY}.` };
}

function _resolveGrading(ctx, features) {
  const f = _byCategory(features, 'grading')[0];
  if (!f) return { look: null, confidence: 0.3, reason: 'Grading: not yet resolved.' };
  return { look: f.value.look, confidence: f.confidence, reason: `Grading intent: "${f.value.look}" look.` };
}

function _resolveCalibration(ctx, features) {
  const f = _byCategory(features, 'calibration')[0];
  if (!f) return { magnitude: 0, confidence: 0.3, reason: 'Calibration: not yet resolved.' };
  const mag = ['red','green','blue'].reduce((s, p) => s + Math.abs(f.value[p]?.hue ?? 0) + Math.abs(f.value[p]?.sat ?? 0), 0);
  return { magnitude: +mag.toFixed(1), confidence: f.confidence,
    reason: `Calibration intent: combined |hue|+|sat| magnitude=${mag.toFixed(1)}.` };
}

function _resolveHSL(ctx, features) {
  const f = _byCategory(features, 'hsl')[0];
  if (!f) return { maxSatAdj: 0, confidence: 0.3, reason: 'HSL: not yet resolved.' };
  const maxSat = Math.max(0, ...Object.values(f.value).map(c => Math.abs(c.satAdj ?? 0)));
  return { maxSatAdj: maxSat, dominant: ctx.hsl?.dominant ?? null, confidence: f.confidence,
    reason: `HSL intent: max channel |satAdj|=${maxSat}.` };
}

function _resolveBasicTone(ctx, features) {
  const f = _byCategory(features, 'basicTone')[0];
  if (!f) return { toneStyle: 'balanced', confidence: 0.2, reason: 'Basic tone: no data.' };
  return { toneStyle: f.value.toneStyle, exposureClass: f.value.exposureClass, confidence: f.confidence,
    reason: `Basic tone descriptor: "${f.value.toneStyle}" (low-priority, supporting signal only, weight ${f.weight}).` };
}

// ─── Conflict detection ─────────────────────────────────────────────────────
// Implements the five example patterns from spec, plus a generic scan.

function _detectConflicts(ctx, features, resolved) {
  const conflicts = [];
  const T = CONFLICT_THRESHOLDS;

  // 1. WB warm/cool vs palette warm/cool
  const wbF = features.find(f => f.id === 'whitebalance-engine' && f.category === 'warmth');
  const paletteHue = resolved.paletteIntent?.dominantHue;
  if (wbF && paletteHue != null) {
    const paletteWarm = (paletteHue < T.warmth.paletteWarmHueMax || paletteHue > T.warmth.paletteWarmHueMin);
    const paletteCool = (paletteHue > T.warmth.paletteCoolHueMin && paletteHue < T.warmth.paletteCoolHueMax);
    const wbWarm = wbF.value > T.warmth.wbWarmCool, wbCool = wbF.value < -T.warmth.wbWarmCool;
    if ((wbWarm && paletteCool) || (wbCool && paletteWarm)) {
      conflicts.push(_conflict('wb_vs_palette_warmth',
        `White Balance reads ${wbWarm ? 'warm' : 'cool'} (temp=${wbF.value}) but the palette's dominant hue (${paletteHue}°) suggests the opposite.`,
        ['whitebalance-engine', 'kmeans-engine'],
        `Palette (weight ${ENGINE_PRIORITY['kmeans-engine']}) preferred over WB (weight ${ENGINE_PRIORITY['whitebalance-engine']}) for mood; WB's raw correction is still mood-preservation-scaled downstream.`));
    }
  }

  // 2. Basic Panel "overexposed" vs Style Recognition "airy bright" traits
  const basicF = features.find(f => f.id === 'basic-panel-engine');
  const styleF = features.find(f => f.id === 'style-recognition-engine' && f.category === 'mood');
  if (basicF?.value?.exposureClass === 'overexposed' && styleF) {
    const traits = (styleF.value.traits ?? []).map(t => t.toLowerCase());
    if (traits.some(t => t.includes('bright') || t.includes('airy'))) {
      conflicts.push(_conflict('basic_vs_style_exposure',
        `Basic Panel classifies the image as "overexposed" but Style Recognition ("${styleF.value.style}") carries bright/airy traits — likely an intentional high-key look, not a defect.`,
        ['basic-panel-engine', 'style-recognition-engine'],
        `Style Recognition (weight ${ENGINE_PRIORITY['style-recognition-engine']}) preferred; Basic Panel's exposure suggestion stays near zero regardless (supporting-only role).`));
    }
  }

  // 3. Histogram "bright" vs Style Recognition "high-key"/luxury traits
  const histBrightF = features.find(f => f.id === 'histogram-engine' && f.category === 'highlight');
  if (histBrightF && (histBrightF.value ?? 0) > T.highlight.histBrightClipPct && styleF) {
    const traits = (styleF.value.traits ?? []).map(t => t.toLowerCase());
    if (traits.some(t => t.includes('high-end') || t.includes('clean blacks') || t.includes('bright')))
      conflicts.push(_conflict('histogram_vs_style_highkey',
        `Histogram shows highlight clipping (${histBrightF.value}%) while Style Recognition suggests a deliberate high-key/luxury look ("${styleF.value.style}").`,
        ['histogram-engine', 'style-recognition-engine'],
        `Style Recognition preferred for mood; Pre-XMP Validation still protects against real clipping via Basic Panel's clip-recovery nudge.`));
  }

  // 4. Calibration wants a strong shift but skin confidence is high
  const calF = features.find(f => f.id === 'calibration-engine');
  const skinF = features.find(f => f.category === 'skin');
  if (calF && skinF && skinF.confidence > T.calibration.skinConfidenceHigh) {
    const mag = ['red','green','blue'].reduce((s,p)=>s+Math.abs(calF.value[p]?.hue??0)+Math.abs(calF.value[p]?.sat??0), 0);
    if (mag > T.calibration.calibrationMagnitude) {
      conflicts.push(_conflict('calibration_vs_skin',
        `Calibration suggests a combined shift magnitude of ${mag.toFixed(1)} while skin detection confidence is high (${skinF.confidence}) — risk of distorting skin tone.`,
        ['calibration-engine', skinF.id],
        `Skin (weight ${skinF.weight}) preferred; Calibration stays hard-capped to ±3-4°/±4-6% in Lightroom Mapping regardless of this engine's raw suggestion.`));
    }
  }

  // 5. HSL suggests strong saturation but palette is muted
  const hslF = features.find(f => f.id === 'hsl-analyzer-engine');
  if (hslF && resolved.paletteIntent?.avgSat != null) {
    const maxSat = Math.max(0, ...Object.values(hslF.value).map(c => Math.abs(c.satAdj ?? 0)));
    if (maxSat > T.hslVsPalette.hslMaxSatAdj && resolved.paletteIntent.avgSat < T.hslVsPalette.paletteMutedAvgSat) {
      conflicts.push(_conflict('hsl_vs_palette_saturation',
        `HSL analyzer suggests a saturation adjustment up to ${maxSat} but the extracted palette is muted (avg sat ${resolved.paletteIntent.avgSat}%) — likely an intentionally desaturated look.`,
        ['hsl-analyzer-engine', 'kmeans-engine'],
        `Palette (weight ${ENGINE_PRIORITY['kmeans-engine']}) preferred; HSL saturation contribution should be dampened in Decision Engine when this conflict is present.`));
    }
  }

  // 6. WB correction magnitude vs WB mood preservation (Stage 2.2)
  // whitebalance-engine's own wbIntent already judges whether a reading is
  // an intentional mood or a likely defect — this conflict fires when the
  // RAW correction magnitude is large but the engine itself says to
  // preserve mood (transferRisk not high, preserveMood true), signalling
  // that Decision Engine should trust wbIntent.intensity over the raw size
  // of the correction.
  if (wbF) {
    const wbIntent = ctx.wb?.wbIntent;
    const tempMag = Math.abs(ctx.wb?.consensus?.temperature ?? 0);
    const tintMag = Math.abs(ctx.wb?.consensus?.tint ?? 0);
    const combinedMag = tempMag + tintMag;
    if (wbIntent && wbIntent.preserveMood && combinedMag > 25) {
      conflicts.push(_conflict('wb_correction_vs_mood_preservation',
        `Raw WB correction magnitude is large (temp=${tempMag}, tint=${tintMag}) but wbIntent judges this an intentional mood (preserveMood=true, intensity="${wbIntent.intensity}"), not a defect.`,
        ['whitebalance-engine'],
        `wbIntent (the engine's own structured judgement) is preferred over the raw correction size — Decision Engine should scale Temp/Tint by wbIntent.intensity, not apply the full raw magnitude.`));
    }
  }

  // 7. Tone Curve style vs Dynamic Range safety (Stage 2.2)
  // A curve that compresses dynamic range hard (shadow anchor lifted AND
  // highlight anchor pulled down simultaneously) without clipping evidence
  // or a mood that calls for it is a genuine safety concern, not just style.
  const curveF = features.find(f => f.id === 'tone-curve-ai-engine');
  if (curveF?.value) {
    const shY = curveF.value.shadowY, hiY = curveF.value.highlightY;
    const compressed = shY != null && hiY != null && shY > 20 && hiY < 235;
    const clipLo = ctx.stats?.clipLoPct ?? 0, clipHi = ctx.stats?.clipHiPct ?? 0;
    const moodTag = resolved.mood?.tag;
    const moodAllows = moodTag === 'matte_shadow' || moodTag === 'low_contrast';
    if (compressed && clipLo < 1 && clipHi < 1 && !moodAllows) {
      conflicts.push(_conflict('curve_vs_dynamic_range_safety',
        `Tone curve compresses dynamic range (shadow anchor Y=${shY}, highlight anchor Y=${hiY}) with no clipping evidence and no matte/low-contrast mood detected — may be over-compressing.`,
        ['tone-curve-ai-engine'],
        `Tone Curve (weight ${ENGINE_PRIORITY['tone-curve-ai-engine']}) is still preferred for style, but Decision Engine should flag this for extra Pre-XMP Validation scrutiny rather than blindly trusting the compression.`));
    }
  }

  return conflicts;
}

function _conflict(type, description, involvedEngines, resolution) {
  return { type, description, involvedEngines, resolution };
}

// ─── Overall confidence ─────────────────────────────────────────────────────

function _overallConfidence(features) {
  if (!features.length) return 0.3;
  const totalW = features.reduce((s, f) => s + f.effectiveWeight, 0) || 1;
  const weighted = features.reduce((s, f) => s + f.confidence * f.effectiveWeight, 0) / totalW;
  return +weighted.toFixed(3);
}
