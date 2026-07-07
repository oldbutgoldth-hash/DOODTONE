/**
 * core/style-fingerprint/index.js
 *
 * Builds a compact "Style Fingerprint" — a summary of what the reference
 * image's editing style actually IS.
 *
 * Phase 4 — Feature Fusion Intelligence: this module no longer reads each
 * raw engine output directly and trusts them equally. It first asks
 * core/feature-fusion-engine to normalise, confidence-weight, and
 * conflict-resolve everything into a Style Feature Graph, then derives the
 * (unchanged) StyleFingerprint shape FROM that graph. The graph itself is
 * also attached to the fingerprint (`.featureGraph`) so Decision Engine and
 * the Pre-XMP Validation Pass can see conflicts/warnings directly.
 *
 * The fingerprint is the ground truth that core/xmp-validator checks the
 * final Lightroom preset against, right before XMP export. It does not
 * itself modify anything — it only describes.
 */

import { buildStyleFeatureGraph, ENGINE_PRIORITY } from '../feature-fusion-engine/index.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   stats: object, basic: object|null, wb: object|null, skin: object|null,
 *   hsl: object|null, calibration: object|null, grading: object|null,
 *   toneCurves: object|null, palette: object|null, harmony: object|null,
 *   styleRecognition: object|null, scene: object|null, cast: object|null,
 *   featureGraph: object|null,   // pre-built Style Feature Graph (preferred)
 * }} ctx
 * @returns {object} StyleFingerprint
 */
export function buildStyleFingerprint(ctx) {
  const { stats, basic, wb, skin, hsl, calibration, grading, toneCurves } = ctx;

  // Prefer a pre-built graph (app.js builds this once); fall back to
  // building one here for backward compatibility with older call sites.
  const graph = ctx.featureGraph ?? buildStyleFeatureGraph(ctx);

  // ── Mood — now the Feature Fusion Engine's conflict-resolved intent ──────
  // (previously read basic.toneStyle directly and trusted it unconditionally;
  // now cross-checked against Style Recognition traits inside the graph)
  const mood          = graph.mood.tag;
  const moodLabel      = graph.mood.label;
  const moodConfidence = graph.mood.confidence;

  // ── Warmth & colour cast — blended across WB, palette, style-recognition,
  //    and histogram, weighted by enginePriority × confidence ───────────────
  const warmth         = graph.warmth.direction;
  const warmthStrength = graph.warmth.strength;
  const cast            = graph.colorCast.label;
  const wbMoodPreservation = wb?.moodPreservation ?? {
    preservationFactor: 0.4, isLikelyDefect: false, magnitude: 0,
    reason: 'No WB analysis available — default moderate preservation.',
  };

  // ── Contrast level — resolved intent (style-recognition/tone-curve now
  //    outrank raw histogram σ when they disagree) ──────────────────────────
  const contrastLevel = graph.contrastIntent.level;
  const sigma          = graph.contrastIntent.sigma ?? stats?.contrast ?? 50;

  // ── Skin — resolved intent (skintone-engine / skin-classifier, whichever
  //    has the higher effectiveWeight) ──────────────────────────────────────
  const skinInfo = graph.skinIntent.detected ? {
    detected: true, hue: graph.skinIntent.hue, sat: graph.skinIntent.sat,
    lum: graph.skinIntent.lum, confidence: graph.skinIntent.confidence,
  } : null;

  // ── Palette / harmony — resolved intents ──────────────────────────────────
  const paletteDominantHue = graph.paletteIntent.dominantHue;
  const paletteAvgSat      = graph.paletteIntent.avgSat;
  const harmonyScheme      = graph.harmonyIntent.scheme;

  // ── Tone curve intent — resolved (tone-curve-ai-engine primary source) ───
  const toneCurveShadowY    = graph.curveIntent.shadowY;
  const toneCurveHighlightY = graph.curveIntent.highlightY;

  // ── Style recognition — top label, unchanged field names ────────────────
  const styleRecognitionTop        = ctx.styleRecognition?.top?.style ?? null;
  const styleRecognitionConfidence = ctx.styleRecognition?.top?.confidence ?? null;

  // ── Per-engine confidence map — used for Rule 8 (low-confidence clamp) ───
  const confidenceMap = {
    wb:         wb?.confidence         ?? 0.5,
    hsl:        hsl?.confidence        ?? 0.5,
    calibration:calibration?.confidence?? 0.5,
    grading:    grading?.confidence    ?? 0.5,
    basic:      basic?.confidence      ?? 0.5,
    toneCurves: toneCurves?.confidence ?? 0.5,
  };
  // overallConfidence blends two views:
  //   (a) a priority-weighted average across the six engines that directly
  //       feed Lightroom Mapping (wb/hsl/calibration/grading/basic/curve)
  //   (b) the Feature Fusion Engine's overallStyleConfidence, which already
  //       covers ALL 22 analysis modules with proper effectiveWeight
  //       (enginePriority × confidence) weighting.
  // Phase 4.1 fix: (a) used to be a naive unweighted average — giving
  // Basic Panel (priority 0.20) the same 1/6 say as White Balance (0.85)
  // or Colour Grading (0.94). It now uses the same ENGINE_PRIORITY table
  // as Feature Fusion, and the blend leans toward (b) since it reflects
  // the full, conflict-resolved picture rather than just six engines.
  const CONF_ENGINE_ID = {
    wb: 'whitebalance-engine', hsl: 'hsl-analyzer-engine',
    calibration: 'calibration-engine', grading: 'colorgrading-ai-engine',
    basic: 'basic-panel-engine', toneCurves: 'tone-curve-ai-engine',
  };
  let weightedSum = 0, weightTotal = 0;
  for (const [key, conf] of Object.entries(confidenceMap)) {
    const w = ENGINE_PRIORITY[CONF_ENGINE_ID[key]] ?? 0.5;
    weightedSum += conf * w;
    weightTotal += w;
  }
  const rawWeightedConfidence = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
  const overallConfidence = +((rawWeightedConfidence * 0.35) + (graph.overallStyleConfidence * 0.65)).toFixed(3);

  return {
    mood, moodLabel, moodConfidence,
    warmth, warmthStrength, colorCast: cast, wbMoodPreservation,
    contrastLevel, contrastSigma: sigma,
    dynamicRangeStops: stats?.drStops ?? null,
    clipHiPct: stats?.clipHiPct ?? 0,
    clipLoPct: stats?.clipLoPct ?? 0,
    skin: skinInfo,
    paletteDominantHue, paletteAvgSat, harmonyScheme,
    toneCurveShadowY, toneCurveHighlightY,
    styleRecognitionTop, styleRecognitionConfidence,
    confidenceMap, overallConfidence,
    // Phase 4: expose the full graph so Decision Engine and the Pre-XMP
    // Validation Pass can see conflicts/warnings/per-feature detail directly.
    featureGraph: graph,
  };
}

