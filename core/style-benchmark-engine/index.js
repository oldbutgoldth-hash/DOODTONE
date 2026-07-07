/**
 * core/style-benchmark-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STYLE SIMILARITY / BENCHMARK LITE (Phase 6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ... Style Fingerprint → Decision Engine → Lightroom Mapping Engine →
 *   Pre-XMP Validation Pass → [ STYLE BENCHMARK ENGINE ] → XMP Export
 *
 * This is a diagnostic/reporting layer, NOT a correction stage. It answers
 * one question: "does the final Lightroom preset still look like the
 * reference's Style Fingerprint, or did the pipeline drift away from it?"
 *
 * It is explicitly "Lite":
 *  - No machine learning, no automatic weight tuning, no training loop.
 *  - Every score is a hand-written, explainable formula over data that
 *    already exists in the pipeline (Style Fingerprint, Style Feature
 *    Graph, Decision strategy, the final mapped preset, and the Pre-XMP
 *    Validation report).
 *  - It does not gate the export pipeline on its own — core/xmp-validator
 *    remains the only place that actually clamps values. When the
 *    benchmark's safetyScore is extremely low, the caller (ui/app.js) may
 *    choose to run the EXISTING quickSafetyClamp() again as an extra
 *    pass — this module only recommends that, it never mutates presets.
 *
 * Nothing here reads the DOM. Pure data in, a scored report out.
 */

// ─── Scoring configuration ───────────────────────────────────────────────────
// Centralised, commented, and intentionally conservative — see Phase 4.1's
// CONFLICT_THRESHOLDS pattern in core/feature-fusion-engine for precedent.
const WEIGHTS = {
  // How much each similarity dimension contributes to overallStyleSimilarity.
  mood: 0.20, palette: 0.14, warmth: 0.12, skin: 0.14,
  contrast: 0.10, highlight: 0.08, shadow: 0.08, toneCurve: 0.14,
};
const SAFETY_WEIGHTS = { hsl: 0.28, calibration: 0.20, wb: 0.20, tone: 0.16, basic: 0.16 };
const OVERALL_SAFETY_BLEND = 0.20;   // overallStyleSimilarity leans 80% style / 20% safety

const THRESHOLDS = {
  basicMagCritical: 60,     // Basic Panel footprint above which mood similarity bottoms out
  neonSatCap: 25,           // HSL |satAdj| beyond this is "neon" for non-skin channels
  skinSatCap: 8,            // HSL |satAdj| beyond this on red/orange/yellow risks skin drift
  calMagCritical: 30,       // combined |hue|+|sat| across R/G/B calibration considered unsafe
  wbMagCritical: 45,        // |temp|+|tint| combined considered an unsafe WB push
  extremelyUnsafe: 0.15,    // safetyScore below this = caller should re-run quickSafetyClamp
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   styleFingerprint: object,
 *   styleFeatureGraph: object,
 *   decisionStrategy: object|null,   // finalPreset._decision (Phase 5 shape)
 *   finalPreset: object,
 *   preXmpValidation: object|null,   // the validateFinalPreset() report
 * }} ctx
 * @returns {object} BenchmarkResult
 */
export function benchmarkStylePreservation(ctx) {
  const { styleFingerprint: fp, styleFeatureGraph: graph, decisionStrategy: dec, finalPreset: p, preXmpValidation: val } = ctx;

  const warnings = [];
  const reasons = [];
  const recommendations = [];

  // ── Basic Panel footprint (used by mood + safety) ────────────────────────
  const basicMag = Math.abs(p.exp)/100*20 + Math.abs(p.con) + Math.abs(p.hi) + Math.abs(p.sh) + Math.abs(p.wh) + Math.abs(p.bl);
  const colorMag = _hslMagnitude(p) + Math.abs(p.grade?.grd_sh_s??0) + Math.abs(p.grade?.grd_mid_s??0) + Math.abs(p.grade?.grd_hi_s??0);

  // ── 1. Mood similarity ────────────────────────────────────────────────────
  const moodSimilarity = _clamp01(1 - basicMag / THRESHOLDS.basicMagCritical);
  reasons.push(`Mood: Basic Panel footprint=${basicMag.toFixed(1)} → ${(moodSimilarity*100).toFixed(0)}% preserved ("${fp.moodLabel}" character kept intact when footprint is low).`);
  if (moodSimilarity < 0.5) {
    warnings.push(`Basic Panel footprint (${basicMag.toFixed(1)}) is pulling the preset away from the detected "${fp.moodLabel}" mood.`);
    recommendations.push('Reduce Basic Panel exposure/highlights/shadows magnitude, or verify the scene strategy chosen is correct.');
  }

  // ── 2. Palette similarity ─────────────────────────────────────────────────
  const paletteIntent = graph?.paletteIntent;
  let paletteSimilarity = 0.6;
  if (paletteIntent?.avgSat != null) {
    const maxHslSat = _hslMaxAbs(p, 's');
    const gradeSat = Math.max(p.grade?.grd_sh_s??0, p.grade?.grd_mid_s??0, p.grade?.grd_hi_s??0);
    const pushMag  = Math.max(maxHslSat, gradeSat);
    // Muted palette + heavy saturation push = mismatch; anything else scores well.
    const muted = paletteIntent.avgSat < 25;
    paletteSimilarity = muted ? _clamp01(1 - pushMag / 30) : _clamp01(1 - Math.max(0, pushMag - 20) / 30);
    reasons.push(`Palette: avg sat ${paletteIntent.avgSat}% (${muted?'muted':'saturated'}), max colour push=${pushMag} → ${(paletteSimilarity*100).toFixed(0)}% match.`);
    if (paletteSimilarity < 0.5) {
      warnings.push(`Colour saturation pushes (${pushMag}) risk contradicting the extracted palette (avg sat ${paletteIntent.avgSat}%).`);
      recommendations.push('Let Colour Grading / HSL saturation follow the palette more closely, or verify no unresolved hsl_vs_palette_saturation conflict remains.');
    }
  } else {
    reasons.push('Palette: not resolved in time for this run — neutral score used.');
    warnings.push('Palette data unavailable for benchmarking — score may be optimistic.');
  }

  // ── 3. Warmth / colour-cast similarity ────────────────────────────────────
  const warmthDir = fp.warmth;   // 'warm' | 'cool' | 'neutral'
  const tempDir = p.temp > 4 ? 'warm' : p.temp < -4 ? 'cool' : 'neutral';
  const warmthSimilarity = (tempDir === warmthDir || warmthDir === 'neutral' || tempDir === 'neutral') ? 1.0
    : _clamp01(1 - Math.abs(p.temp) / 40);   // contradicts direction → penalise by magnitude
  reasons.push(`Warmth: fingerprint="${warmthDir}", preset reads "${tempDir}" (temp=${p.temp}) → ${(warmthSimilarity*100).toFixed(0)}% match.`);
  if (warmthSimilarity < 0.5) {
    warnings.push(`White Balance direction (${tempDir}) contradicts the reference's detected warmth (${warmthDir}).`);
    recommendations.push('Review wbMoodPreservation.preservationFactor — the raw WB correction may be overriding the intended mood.');
  }

  // ── 4. Skin similarity ────────────────────────────────────────────────────
  let skinSimilarity = 1.0;
  if (fp.skin?.detected) {
    const skinPush = ['red','orange','yellow'].reduce((m, ch) => Math.max(m, Math.abs(p.hsl?.[`hsl_s_${ch}`] ?? 0)), 0);
    const calSkinPush = ['red'].reduce((m, ch) => Math.max(m, Math.abs(p.cal?.[`cal_${ch}_s`] ?? 0)), 0);
    const push = Math.max(skinPush, calSkinPush);
    skinSimilarity = _clamp01(1 - push / THRESHOLDS.skinSatCap);
    reasons.push(`Skin: detected (confidence ${fp.skin.confidence}) — max protective-channel push=${push} → ${(skinSimilarity*100).toFixed(0)}% natural.`);
    if (skinSimilarity < 0.6) {
      warnings.push(`Skin-relevant channels show a saturation push of ${push} — risk of unnatural skin tone.`);
      recommendations.push('Tighten skinLockScale or verify portraitSafe is active for this image.');
    }
  } else {
    reasons.push('Skin: not detected — full score (not applicable).');
  }

  // ── 5/6/7. Contrast / Highlight / Shadow intent similarity ───────────────
  const contrastSimilarity  = _intentSimilarity(graph?.contrastIntent?.level,  p.con, { low:-8, medium:0, high:8 });
  const highlightSimilarity = _intentSimilarity(graph?.highlightIntent?.level, p.hi,  { sparse:6, balanced:0, bright:-10 }, { sparse:'bright', bright:'sparse' });
  const shadowSimilarity    = _intentSimilarity(graph?.shadowIntent?.level,    p.sh,  { sparse:-6, balanced:0, deep:8 });
  reasons.push(`Contrast intent "${graph?.contrastIntent?.level ?? '?'}" vs con=${p.con} → ${(contrastSimilarity*100).toFixed(0)}% match.`);
  reasons.push(`Highlight intent "${graph?.highlightIntent?.level ?? '?'}" vs hi=${p.hi} → ${(highlightSimilarity*100).toFixed(0)}% match.`);
  reasons.push(`Shadow intent "${graph?.shadowIntent?.level ?? '?'}" vs sh=${p.sh} → ${(shadowSimilarity*100).toFixed(0)}% match.`);

  // ── 8. Tone curve similarity ──────────────────────────────────────────────
  let toneCurveSimilarity = 0.7;
  const curveIntent = graph?.curveIntent;
  if (curveIntent?.shadowY != null && curveIntent?.highlightY != null) {
    const shDiff = Math.abs((p.crv_sh  ?? 0)   - curveIntent.shadowY);
    const hiDiff = Math.abs((p.crv_hi  ?? 255) - curveIntent.highlightY);
    toneCurveSimilarity = _clamp01(1 - (shDiff + hiDiff) / 120);
    reasons.push(`Tone curve: anchor deltas sh=${shDiff}, hi=${hiDiff} → ${(toneCurveSimilarity*100).toFixed(0)}% match (should be near-identical since Lightroom Mapping reads these directly).`);
  } else {
    reasons.push('Tone curve: intent not resolved — neutral score used.');
  }

  // ── Safety sub-scores ──────────────────────────────────────────────────────
  const hslSafety   = _clamp01(1 - Math.max(0, _hslMaxAbs(p, 's') - THRESHOLDS.neonSatCap) / 25);
  const calMag       = ['red','green','blue'].reduce((s,c)=>s+Math.abs(p.cal?.[`cal_${c}_h`]??0)+Math.abs(p.cal?.[`cal_${c}_s`]??0), 0);
  const calSafety    = _clamp01(1 - Math.max(0, calMag - THRESHOLDS.calMagCritical) / 30);
  const wbMag         = Math.abs(p.temp ?? 0) + Math.abs(p.tint ?? 0);
  const wbSafety      = _clamp01(1 - Math.max(0, wbMag - THRESHOLDS.wbMagCritical) / 40);
  const toneSafety    = _toneSafety(p, fp);
  const basicSafety   = _clamp01(1 - Math.max(0, basicMag - THRESHOLDS.basicMagCritical) / 40);

  if (_hslMaxAbs(p, 's') > THRESHOLDS.neonSatCap) { warnings.push(`HSL saturation reaches ${_hslMaxAbs(p,'s')} — approaching neon territory.`); recommendations.push('Lower HSL saturation adjustments or check for an unresolved conflict.'); }
  if (calMag > THRESHOLDS.calMagCritical)          { warnings.push(`Calibration combined magnitude ${calMag.toFixed(0)} is strong for a "subtle" tool.`); recommendations.push('Calibration should stay subtle — verify skin/portraitSafe caps are engaging.'); }
  if (wbMag > THRESHOLDS.wbMagCritical)             { warnings.push(`White Balance combined magnitude ${wbMag} is large.`); recommendations.push('Check wbMoodPreservation — this may be over-correcting rather than preserving mood.'); }
  if (basicMag > THRESHOLDS.basicMagCritical)       { warnings.push(`Basic Panel magnitude ${basicMag.toFixed(1)} exceeds the "supporting only" threshold.`); recommendations.push('Basic Panel should not dominate — investigate why its dampened value is still large.'); }

  const safetyScore = _clamp01(
    hslSafety * SAFETY_WEIGHTS.hsl + calSafety * SAFETY_WEIGHTS.calibration +
    wbSafety * SAFETY_WEIGHTS.wb + toneSafety * SAFETY_WEIGHTS.tone + basicSafety * SAFETY_WEIGHTS.basic
  );

  // ── Roll up ────────────────────────────────────────────────────────────────
  const styleAvg = _clamp01(
    moodSimilarity      * WEIGHTS.mood +
    paletteSimilarity   * WEIGHTS.palette +
    warmthSimilarity    * WEIGHTS.warmth +
    skinSimilarity       * WEIGHTS.skin +
    contrastSimilarity   * WEIGHTS.contrast +
    highlightSimilarity  * WEIGHTS.highlight +
    shadowSimilarity      * WEIGHTS.shadow +
    toneCurveSimilarity  * WEIGHTS.toneCurve
  );
  const overallStyleSimilarity = _clamp01(styleAvg * (1 - OVERALL_SAFETY_BLEND) + safetyScore * OVERALL_SAFETY_BLEND);

  // ── Cross-reference Pre-XMP Validation (if provided) ──────────────────────
  if (val?.violations?.length) {
    reasons.push(`Pre-XMP Validation already corrected ${val.violations.length} issue(s): ${val.violations.join(', ')}.`);
  }
  if (dec?.decisionStrategy) {
    reasons.push(`Decision strategy "${dec.decisionStrategy}" was applied — engineTrustWeights: ${JSON.stringify(dec.engineTrustWeights ?? {})}.`);
  }

  if (overallStyleSimilarity < 0.4) recommendations.push('Overall style similarity is low — consider reviewing the Style Fingerprint or re-running analysis.');
  if (safetyScore < THRESHOLDS.extremelyUnsafe) {
    warnings.push('safetyScore is extremely low — recommend re-running Pre-XMP Validation (quickSafetyClamp) before export.');
    recommendations.push('Caller should invoke core/xmp-validator quickSafetyClamp() again on this preset.');
  }

  // ── Stage 2.4 Task 2.4D: Photographer Acceptance Estimate ────────────────
  // Reuses the similarity/safety scores already computed above — this is
  // an interpretation layer, not a new measurement, answering "how usable
  // is this XMP as a professional starting point?"
  const photographerAcceptance = _buildPhotographerAcceptance({
    p, fp, moodSimilarity, paletteSimilarity, warmthSimilarity, skinSimilarity,
    contrastSimilarity, toneCurveSimilarity, safetyScore, val, basicMag,
  });

  return {
    overallStyleSimilarity: +overallStyleSimilarity.toFixed(3),
    moodSimilarity:        +moodSimilarity.toFixed(3),
    paletteSimilarity:     +paletteSimilarity.toFixed(3),
    warmthSimilarity:      +warmthSimilarity.toFixed(3),
    skinSimilarity:        +skinSimilarity.toFixed(3),
    contrastSimilarity:    +contrastSimilarity.toFixed(3),
    toneCurveSimilarity:   +toneCurveSimilarity.toFixed(3),
    safetyScore:           +safetyScore.toFixed(3),
    warnings, reasons, recommendations,
    // Stage 2.4: photographer-facing usability estimate
    photographerAcceptance,
    // Additive detail block — not part of the required top-level contract,
    // kept for explainability (Rule 7) without renaming any required key.
    details: {
      highlightSimilarity: +highlightSimilarity.toFixed(3),
      shadowSimilarity:    +shadowSimilarity.toFixed(3),
      basicMagnitude:      +basicMag.toFixed(1),
      colorMagnitude:      +colorMag.toFixed(1),
      hslSafety: +hslSafety.toFixed(3), calSafety: +calSafety.toFixed(3),
      wbSafety: +wbSafety.toFixed(3), toneSafety: +toneSafety.toFixed(3), basicSafety: +basicSafety.toFixed(3),
      extremelyUnsafe: safetyScore < THRESHOLDS.extremelyUnsafe,
    },
  };
}

/**
 * Stage 2.4 Task 2.4D: estimates how usable the generated XMP is as a
 * professional starting point, which sliders a photographer will likely
 * still touch, and whether it's close enough for a real editing workflow.
 * Built entirely from scores already computed above — no new measurement.
 */
function _buildPhotographerAcceptance({ p, fp, moodSimilarity, paletteSimilarity, warmthSimilarity, skinSimilarity, contrastSimilarity, toneCurveSimilarity, safetyScore, val, basicMag }) {
  const likelyManualAdjustments = [];
  const strongPoints = [];
  const weakPoints = [];
  const reasons = [];
  const recommendations = [];

  if (basicMag < 15) strongPoints.push('Exposure/tone required minimal correction — the base look should hold up well.');
  else likelyManualAdjustments.push('Exposure may need a small manual nudge (±0.2–0.5) depending on the target RAW\'s actual brightness.');

  if (warmthSimilarity < 0.6) {
    likelyManualAdjustments.push('WB may need manual tuning — the reference\'s warmth/cast reading did not fully align with the mapped result.');
    weakPoints.push('White Balance alignment');
  } else {
    strongPoints.push('White Balance mood matched the reference well.');
  }
  if ((fp?.wbMoodPreservation?.isLikelyDefect === false) && (fp?.colorCast === 'green' || fp?.colorCast === 'warm')) {
    likelyManualAdjustments.push('WB may need manual tuning because the reference depends on ambient/environmental colour that won\'t match a different scene.');
  }

  if (paletteSimilarity < 0.6) {
    likelyManualAdjustments.push('Green/foliage or dominant-hue saturation may need reduction or increase depending on how similar the target scene\'s palette is.');
    weakPoints.push('Palette fidelity');
  } else {
    strongPoints.push('Colour palette handling matched the extracted reference palette.');
  }

  if (skinSimilarity < 0.7 && fp?.skin?.detected) {
    likelyManualAdjustments.push('Skin tone should be checked after applying the preset — protective clamping may have left a visible shift.');
    weakPoints.push('Skin tone naturalism');
  } else if (fp?.skin?.detected) {
    strongPoints.push('Skin tone stayed natural and well-protected.');
  }

  if (contrastSimilarity < 0.6 || toneCurveSimilarity < 0.6) {
    likelyManualAdjustments.push('Contrast/Tone Curve shape may need a manual tweak to better match the intended mood.');
    weakPoints.push('Contrast / tone curve shape');
  } else {
    strongPoints.push('Contrast and tone curve shape closely follow the reference.');
  }

  if ((val?.violations?.length ?? 0) > 2) {
    weakPoints.push('Multiple Pre-XMP corrections were required');
    recommendations.push('Several values were near their safety limits — treat this preset as a strong draft rather than a final look.');
  }

  const score = +Math.max(0.05, Math.min(1,
    moodSimilarity * 0.20 + paletteSimilarity * 0.15 + warmthSimilarity * 0.15 +
    skinSimilarity * 0.15 + contrastSimilarity * 0.10 + toneCurveSimilarity * 0.10 + safetyScore * 0.15
  )).toFixed(3);

  reasons.push(`Photographer acceptance ${score} — blended from mood/palette/warmth/skin/contrast/curve similarity and safety, weighted toward how close the look reads rather than exact numeric match.`);
  const workflowVerdict = score >= 0.75 ? 'Likely close enough to use directly as a starting point.'
    : score >= 0.5 ? 'Usable as a draft — expect a few manual adjustments before finishing.'
    : 'Treat as a rough starting point only — significant manual work is likely needed.';
  reasons.push(workflowVerdict);

  return { score, likelyManualAdjustments, strongPoints, weakPoints, reasons, recommendations };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _clamp01(v) { return Math.max(0, Math.min(1, v)); }

const HSL_CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];

function _hslMagnitude(p) {
  return HSL_CHANNELS.reduce((s, ch) => s + Math.abs(p.hsl?.[`hsl_s_${ch}`] ?? 0), 0);
}
function _hslMaxAbs(p, kind) {
  return HSL_CHANNELS.reduce((m, ch) => Math.max(m, Math.abs(p.hsl?.[`hsl_${kind}_${ch}`] ?? 0)), 0);
}

/**
 * Generic intent-vs-value similarity: given a categorical intent label and
 * the actual slider value, look up the "expected direction" for that label
 * and score based on how far the value deviates from a neutral response in
 * the WRONG direction. `oppositeMap` lets a label mean "value should NOT
 * go the other way" (e.g. highlight="sparse" boosting is fine, reducing
 * further is a mismatch) without hand-writing every branch.
 */
function _intentSimilarity(level, value, expectedMap, oppositeMap = {}) {
  if (!level || !(level in expectedMap)) return 0.7;   // unresolved — neutral
  const expected = expectedMap[level];
  // If expected is 0 ("balanced"), any small value is fine, penalise large swings.
  if (expected === 0) return _clamp01(1 - Math.abs(value) / 25);
  // If value moves the SAME sign as expected (or stays near 0), good match.
  const sameSign = Math.sign(value) === Math.sign(expected) || value === 0;
  if (sameSign) return 1.0;
  // Opposite sign — penalise by magnitude of the contradiction.
  return _clamp01(1 - Math.abs(value) / 25);
}

/** Detects crushed blacks / blown highlights without matching clipping evidence or mood intent. */
function _toneSafety(p, fp) {
  const clipHi = fp?.clipHiPct ?? 0, clipLo = fp?.clipLoPct ?? 0;
  const moodAllowsDark  = ['moody_dark','high_contrast'].includes(fp?.mood);
  const moodAllowsBright= ['airy_bright','high_contrast'].includes(fp?.mood);
  let score = 1.0;
  if ((p.crv_sh ?? 5) < 3 && clipLo < 1 && !moodAllowsDark) score -= 0.4;      // crushed blacks, unwarranted
  if ((p.crv_hi ?? 248) > 252 && clipHi < 1 && !moodAllowsBright) score -= 0.4; // blown highlights, unwarranted
  if ((p.bl ?? 0) < -30 && clipLo < 1) score -= 0.2;
  if ((p.wh ?? 0) > 15 && clipHi < 1) score -= 0.2;
  return _clamp01(score);
}
