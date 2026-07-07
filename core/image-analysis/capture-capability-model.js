/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAPTURE CAPABILITY INTELLIGENCE (EPIC 1.6, RAW-Aware)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A NEW aggregation/interpretation module — NOT a new pixel-analysis
 * engine. Every signal read here already exists somewhere in this
 * codebase (core/histogram-engine's stats, core/image-analysis-core's
 * noise/sharpness quality pass, Style Feasibility, Transfer Confidence,
 * Style Benchmark) — this module only INTERPRETS them into a single
 * question no prior stage answered directly: "what is this SOURCE
 * CAPTURE realistically capable of reproducing, independent of what
 * style/intent someone wants to apply to it?"
 *
 * This is deliberately a DIFFERENT question from Style DNA/Feasibility
 * (Stage 2.4.2B/B.1/B.2), which ask "is the DETECTED STYLE internally
 * consistent/reproducible?" — Capture Capability asks about the RAW
 * FILE's own technical ceiling, before any style is even considered.
 *
 * Circular-dependency note (same pattern as every prior transfer-risk
 * stage in this project): full noise/sharpness data
 * (core/image-analysis-core's output) is only available once
 * core/reference-transfer-engine runs — core/decision-engine calls this
 * SAME function with `imageAnalysisCore: null`, which this module
 * degrades from gracefully (documented per-field below) rather than
 * duplicating a second, simplified copy of this logic.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

/**
 * Task 1 + 2: builds the full captureCapability model from whatever
 * signals are available at the call site. Called from BOTH
 * core/decision-engine (preliminary, imageAnalysisCore always null there)
 * and core/reference-transfer-engine (authoritative, imageAnalysisCore
 * usually available) — the SAME function, never duplicated, so the two
 * callers can never silently drift into different scoring logic.
 *
 * @param {object} params
 * @param {object} params.stats - histogram-engine output (blackPoint, whitePoint, drStops, clipHiPct, clipLoPct, contrast, avgLum, avgSatPct, rbDiff, gDiff)
 * @param {object|null} params.imageAnalysisCore - image-analysis-core output (noiseScore, sharpnessScore) — null when not yet resolved
 * @param {number|null} params.skinConfidence - from Decision Engine's own skin analysis, if available
 * @param {object|null} params.styleFeasibility - authoritative or preliminary feasibility estimate, if available (Task 6 — supporting evidence only)
 * @param {object|null} params.transferConfidence - from Reference Transfer, if available
 * @param {object|null} params.benchmark - Style Benchmark result, if available
 */
export function buildCaptureCapability({ stats, imageAnalysisCore = null, skinConfidence = null, styleFeasibility = null, transferConfidence = null, benchmark = null }) {
  const drStops = stats?.drStops ?? 5;
  const clipHiPct = stats?.clipHiPct ?? 0;
  const clipLoPct = stats?.clipLoPct ?? 0;
  const whitePoint = stats?.whitePoint ?? 245;
  const blackPoint = stats?.blackPoint ?? 10;
  const avgSatPct = stats?.avgSatPct ?? 30;
  const castStrength = Math.abs(stats?.rbDiff ?? 0) + Math.abs(stats?.gDiff ?? 0);

  const hasQualityData = !!imageAnalysisCore;
  const noiseScore = imageAnalysisCore?.noiseScore ?? null;      // 0-100, higher = noisier
  const sharpnessScore = imageAnalysisCore?.sharpnessScore ?? null; // 0-100, higher = sharper

  // ── Individual capability dimensions (0-1, higher = more capable) ───────
  const dynamicRange = clamp01(drStops / 9);
  const highlightRecovery = clamp01(1 - clipHiPct / 15);
  const shadowRecovery = clamp01(1 - clipLoPct / 15);
  // Noise tolerance: without quality data, use a neutral (not optimistic)
  // default rather than assuming a clean capture — see `confidence` below,
  // which is reduced to reflect this uncertainty.
  const noiseTolerance = hasQualityData ? clamp01(1 - noiseScore / 55) : 0.55;
  const whiteBalanceLatitude = clamp01(1 - castStrength / 35);
  const colorLatitude = clamp01(1 - Math.max(0, avgSatPct - 55) / 40);
  const skinReliability = skinConfidence != null ? clamp01(skinConfidence) : 0.6;
  const highlightLatitude = clamp01(((255 - whitePoint) / 55) * 0.6 + highlightRecovery * 0.4);
  const shadowLatitude = clamp01((blackPoint / 55) * 0.6 + shadowRecovery * 0.4);

  // Task 4: Editing Headroom — a DIFFERENT weighted blend from
  // overallScore below, deliberately emphasising recoverability/latitude
  // (what's left to push) over raw technical cleanliness (noise), since
  // "how much room is there to grade" is a distinct question from
  // "how technically clean is this file."
  const editingHeadroom = clamp01(
    highlightRecovery * 0.25 + shadowRecovery * 0.25 +
    whiteBalanceLatitude * 0.20 + colorLatitude * 0.15 + dynamicRange * 0.15
  );

  const overallScore = clamp01(
    dynamicRange * 0.20 + highlightRecovery * 0.15 + shadowRecovery * 0.15 +
    noiseTolerance * 0.20 + whiteBalanceLatitude * 0.15 + colorLatitude * 0.15
  );

  // Task 3: Capability Classes
  const overallCapability = overallScore >= 0.85 ? 'Excellent' : overallScore >= 0.70 ? 'Very Good'
    : overallScore >= 0.50 ? 'Good' : overallScore >= 0.30 ? 'Limited' : 'Poor';

  const strengths = [], limitations = [], warnings = [], reasons = [];
  if (dynamicRange > 0.7) strengths.push('Wide dynamic range — clean tonal transitions available.');
  if (highlightRecovery > 0.75) strengths.push('High highlight recovery potential.');
  if (shadowRecovery > 0.75) strengths.push('High shadow recovery potential.');
  if (whiteBalanceLatitude > 0.75) strengths.push('Reliable white balance adjustment latitude.');
  if (hasQualityData && noiseTolerance > 0.75) strengths.push('Clean, low-noise capture.');

  if (clipHiPct > 8) limitations.push(`Heavy highlight clipping (${clipHiPct.toFixed(1)}%) — highlight recovery is constrained.`);
  if (clipLoPct > 8) limitations.push(`Heavy shadow clipping (${clipLoPct.toFixed(1)}%) — shadow recovery is constrained.`);
  if (castStrength > 25) limitations.push('Strong colour cast reduces white balance flexibility.');
  if (hasQualityData && noiseScore > 45) limitations.push(`Elevated noise (score ${noiseScore}) — aggressive grading risks amplifying it.`);
  if (avgSatPct > 60) limitations.push('Already-high saturation limits further colour latitude before clipping.');

  if (!hasQualityData) warnings.push('Noise/sharpness data not yet available at this point in the pipeline — noiseTolerance uses a neutral estimate, not a measured one.');

  const confidence = +clamp01(0.55 + (hasQualityData ? 0.25 : 0) + (skinConfidence != null ? 0.1 : 0) + (transferConfidence ? 0.1 : 0)).toFixed(3);

  reasons.push(`Overall capability "${overallCapability}" (${overallScore.toFixed(2)}) from dynamic range ${dynamicRange.toFixed(2)}, highlight/shadow recovery ${highlightRecovery.toFixed(2)}/${shadowRecovery.toFixed(2)}, noise tolerance ${noiseTolerance.toFixed(2)}${hasQualityData ? '' : ' (estimated)'}, WB latitude ${whiteBalanceLatitude.toFixed(2)}.`);
  reasons.push(`Editing headroom ${editingHeadroom.toFixed(2)} — ${editingHeadroom >= 0.7 ? 'large room for grading.' : editingHeadroom >= 0.45 ? 'moderate room; keep grading measured.' : 'aggressive grading may damage image quality.'}`);

  // Task 6: Style Feasibility Extension — supporting evidence only, never
  // replacing or overwriting the existing feasibility score.
  if (styleFeasibility) {
    const feasScore = styleFeasibility.score ?? (styleFeasibility.level === 'high' ? 0.8 : styleFeasibility.level === 'medium' ? 0.5 : 0.25);
    const gap = Math.abs(overallScore - feasScore);
    if (gap > 0.3) {
      warnings.push(`Capture Capability (${overallScore.toFixed(2)}) and Style Feasibility (${feasScore.toFixed(2)}) diverge notably — worth reviewing whether the detected style's demands match what this capture can actually support.`);
    } else {
      reasons.push(`Capture Capability is broadly consistent with the existing Style Feasibility estimate — corroborating, not overriding, that score.`);
    }
  }

  return {
    overallScore: +overallScore.toFixed(3), overallCapability,
    dynamicRange: +dynamicRange.toFixed(3), highlightRecovery: +highlightRecovery.toFixed(3), shadowRecovery: +shadowRecovery.toFixed(3),
    noiseTolerance: +noiseTolerance.toFixed(3), whiteBalanceLatitude: +whiteBalanceLatitude.toFixed(3), colorLatitude: +colorLatitude.toFixed(3),
    skinReliability: +skinReliability.toFixed(3), highlightLatitude: +highlightLatitude.toFixed(3), shadowLatitude: +shadowLatitude.toFixed(3),
    editingHeadroom: +editingHeadroom.toFixed(3), confidence,
    limitations, strengths, warnings, reasons,
  };
}

// ── Task 5: Intent Compatibility ────────────────────────────────────────────
// Static, per-intent capability requirements — checked against the
// captureCapability just built. Not exhaustive for all 21 intents (only
// the ones with a clear, explainable capability dependency get a
// specific profile); everything else falls back to a generic check.
const INTENT_CAPABILITY_REQUIREMENTS = {
  'Premium':   { minSkinReliability: 0.6, minHighlightLatitude: 0.5, minColorLatitude: 0.4, note: 'Clean whites and refined skin depend on solid highlight latitude and reliable skin reading.' },
  'Elegant':   { minSkinReliability: 0.6, minHighlightLatitude: 0.45, note: 'A graceful, refined read depends on clean skin and controllable highlights.' },
  'Dreamy':    { minHighlightRecovery: 0.5, minShadowRecovery: 0.4, note: 'Soft highlight roll-off and open shadows both need real recovery headroom.' },
  'Cinematic': { minShadowLatitude: 0.4, minNoiseTolerance: 0.4, note: 'Controlled shadow grading needs shadow latitude and some noise tolerance (shadows amplify noise).' },
  'Low Key':   { minShadowLatitude: 0.35, minNoiseTolerance: 0.45, note: 'A dense, dark look pushes shadows hard — needs both shadow latitude and noise tolerance.' },
  'High Key':  { minHighlightRecovery: 0.5, minHighlightLatitude: 0.45, note: 'A bright, open look depends on highlights that aren\'t already clipped.' },
  'Editorial': { minColorLatitude: 0.4, minWhiteBalanceLatitude: 0.4, note: 'Deliberate colour separation needs both colour and WB room to work with.' },
  'Bold':      { minColorLatitude: 0.45, note: 'Vivid colour push needs real colour latitude to avoid clipping into an unnatural result.' },
  'Filmic':    { minNoiseTolerance: 0.35, minColorLatitude: 0.35, note: 'Film emulation colour separation needs some colour latitude; a little noise is usually acceptable (reads as grain).' },
  'Commercial':{ minSkinReliability: 0.5, minWhiteBalanceLatitude: 0.5, note: 'Market-clean rendering depends on reliable WB and skin reading.' },
};
const DEFAULT_INTENT_REQUIREMENT = { minOverallScore: 0.35, note: 'General creative intent — checked against overall capture capability only.' };

export function buildIntentCompatibility(intentName, captureCapability) {
  const req = INTENT_CAPABILITY_REQUIREMENTS[intentName] ?? DEFAULT_INTENT_REQUIREMENT;
  const limitations = [], reasons = [];
  let failedChecks = 0, totalChecks = 0;

  const checks = [
    ['minOverallScore', captureCapability.overallScore, 'overall capability'],
    ['minSkinReliability', captureCapability.skinReliability, 'skin reliability'],
    ['minHighlightLatitude', captureCapability.highlightLatitude, 'highlight latitude'],
    ['minShadowLatitude', captureCapability.shadowLatitude, 'shadow latitude'],
    ['minHighlightRecovery', captureCapability.highlightRecovery, 'highlight recovery'],
    ['minShadowRecovery', captureCapability.shadowRecovery, 'shadow recovery'],
    ['minColorLatitude', captureCapability.colorLatitude, 'colour latitude'],
    ['minWhiteBalanceLatitude', captureCapability.whiteBalanceLatitude, 'white balance latitude'],
    ['minNoiseTolerance', captureCapability.noiseTolerance, 'noise tolerance'],
  ];
  for (const [key, actual, label] of checks) {
    if (req[key] == null) continue;
    totalChecks++;
    if (actual < req[key]) {
      failedChecks++;
      limitations.push(`${label.charAt(0).toUpperCase() + label.slice(1)} (${actual.toFixed(2)}) is below what "${intentName}" typically needs (${req[key]}).`);
    }
  }

  const passRatio = totalChecks > 0 ? 1 - failedChecks / totalChecks : 1;
  const score = passRatio >= 0.99 ? 'High' : passRatio >= 0.6 ? 'Medium' : 'Low';
  const compatible = passRatio >= 0.6;

  reasons.push(req.note);
  if (limitations.length) reasons.push(...limitations);
  else reasons.push(`This capture meets all checked capability requirements for "${intentName}".`);

  const recommendations = [];
  if (!compatible) recommendations.push(`Treat "${intentName}" as an ambitious target for this capture — consider a more conservative intent or accept some quality trade-offs.`);
  else if (score === 'Medium') recommendations.push(`"${intentName}" is achievable, but apply grading conservatively in the areas noted above.`);

  return { compatible, score, limitations, recommendations, reasons };
}

// ── Task 9: Capture Budget Hints — priorities only, NOT Lightroom values.
//    Consumed by a future stage (EPIC 1.7), never applied to any slider here.
export function buildCaptureBudgetHints(captureCapability) {
  const c = captureCapability;
  const reasons = [
    'These are priority hints for a FUTURE budget-allocation stage (EPIC 1.7) — not Lightroom values, and nothing here changes any slider in this stage.',
  ];
  if (c.highlightLatitude < 0.4) reasons.push('Highlight budget kept low — limited recovery headroom detected.');
  if (c.shadowLatitude < 0.4) reasons.push('Shadow budget kept low — limited recovery headroom detected.');
  if (c.whiteBalanceLatitude < 0.4) reasons.push('WB budget kept low — a strong colour cast limits safe correction range.');
  if (c.colorLatitude < 0.4) reasons.push('Colour budget kept low — palette is already near a safe saturation ceiling.');

  return {
    highlightBudget: +c.highlightLatitude.toFixed(3),
    shadowBudget: +c.shadowLatitude.toFixed(3),
    wbBudget: +c.whiteBalanceLatitude.toFixed(3),
    colorBudget: +c.colorLatitude.toFixed(3),
    contrastBudget: +clamp01(c.dynamicRange * 0.6 + c.editingHeadroom * 0.4).toFixed(3),
    textureBudget: +c.noiseTolerance.toFixed(3),
    reasons,
  };
}
