/**
 * core/calibration-lab/run-comparison-pipeline.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Runs the SAME analysis + decision pipeline `ui/app.js`'s
 * `runAnalysis()` runs (same engines, same call order, same
 * `buildFinalPreset()` entry point) against one already-decoded image,
 * then extracts a BOUNDED, numeric/stable-code snapshot of the Legacy
 * result and the Controlled V2 shadow-preview result for Calibration
 * Lab storage. It is READ-ONLY against the production pipeline:
 *
 *   - It only ever CALLS existing engines and reads their return
 *     values -- it never sets `allowProductionWrite`, `allowExport`,
 *     `controlledV2ProductionActivation`, or any other Production
 *     flag (those are hard-coded `false` inside the Production-locked
 *     engines themselves and are never touched here).
 *   - It never calls `serializeXMP`/`downloadXMP` -- no XMP is ever
 *     produced by the Calibration Lab.
 *   - It never persists the source image, a Base64 encoding of it, or
 *     any Local File Path -- only a perceptual fingerprint (a
 *     dHash-style bit pattern derived purely from downsampled pixel
 *     luminance) is kept, exactly like the rest of this codebase's
 *     analysis engines already reduce a photo to bounded numeric
 *     features.
 *
 * `extractLegacySnapshot`/`extractControlledV2Snapshot`/
 * `extractSafetySnapshot`/`computeContainsSkin` are pure functions of
 * an already-computed `finalPreset` (+ optional `benchmark`) and are
 * safe to unit-test in Node with a synthetic mock object -- no canvas,
 * no image decode required. `runCalibrationComparisonPipeline` itself
 * needs a real `<img>` + `document.createElement('canvas')` (same
 * browser-only assumption every other core/*-engine already makes) and
 * is exercised only via the Playwright Calibration Lab Browser suite.
 */

import { analyzeImage }         from '../histogram-engine/index.js';
import { extractPalette }       from '../kmeans-engine/index.js';
import { analyzeWhiteBalance }  from '../whitebalance-engine/index.js';
import { analyzeSkinTone }      from '../skintone-engine/index.js';
import { generateBasicPanel }   from '../basic-panel-engine/index.js';
import { analyzeHSL }           from '../hsl-analyzer-engine/index.js';
import { analyzeColorGrading }  from '../colorgrading-ai-engine/index.js';
import { generateToneCurves }   from '../tone-curve-ai-engine/index.js';
import { analyzeCalibration }   from '../calibration-engine/index.js';
import { recognizeStyle }       from '../style-recognition-engine/index.js';
import { generateHarmonies }    from '../color-harmony-engine/index.js';
import { buildFinalPreset }     from '../decision-engine/index.js';
import { classifySkin }         from '../skin-classifier/index.js';
import { buildStyleFingerprint } from '../style-fingerprint/index.js';
import { buildStyleFeatureGraph } from '../feature-fusion-engine/index.js';
import { validateFinalPreset, quickSafetyClamp } from '../xmp-validator/index.js';
import { benchmarkStylePreservation } from '../style-benchmark-engine/index.js';
import { classifyScene }        from '../scene-classifier/index.js';
import { detectColorCast }      from '../color-cast-detector/index.js';

function _num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

/**
 * Bounded Legacy snapshot -- reads the SAME `visualPreviewRenderPlanV2.
 * legacyRenderPlan.adjustmentModel` the production Visual Preview /
 * Side-by-Side Comparison UI already reads for its own Legacy display,
 * plus the Style Benchmark safety score already computed by
 * `benchmarkStylePreservation()`. Never reads or stores prose.
 */
export function extractLegacySnapshot(finalPreset, benchmark = null) {
  const plan = finalPreset?._decision?.finalStyleIntent?.visualPreviewRenderPlanV2;
  const legacyModel = plan?.legacyRenderPlan?.adjustmentModel;
  return {
    temperature: _num(legacyModel?.temperature),
    tint: _num(legacyModel?.tint),
    confidence: _num(plan?.legacyRenderPlan?.confidence),
    safetyScore: _num(benchmark?.safetyScore),
    category: typeof finalPreset?.category === 'string' ? finalPreset.category : null,
  };
}

/**
 * Bounded Controlled V2 snapshot -- reads the SAME `visualPreviewRenderPlanV2.
 * v2RenderPlan.adjustmentModel`/`controlledV2Translation` the production
 * Controlled V2 preview UI already reads, plus
 * `lightroomSafetyClampV2.globalSafetyScore`. `translationMode` is a
 * stable code (e.g. `"legacy-derived-safety-restraint"`,
 * `"identity-fallback"`) already produced upstream -- never a
 * freshly-composed sentence.
 */
export function extractControlledV2Snapshot(finalPreset) {
  const finalStyleIntent = finalPreset?._decision?.finalStyleIntent;
  const plan = finalStyleIntent?.visualPreviewRenderPlanV2;
  const v2Model = plan?.v2RenderPlan?.adjustmentModel;
  return {
    temperature: _num(v2Model?.temperature),
    tint: _num(v2Model?.tint),
    confidence: _num(plan?.v2RenderPlan?.confidence),
    safetyScore: _num(finalStyleIntent?.lightroomSafetyClampV2?.globalSafetyScore),
    translationMode: typeof plan?.v2RenderPlan?.controlledV2Translation?.mode === 'string'
      ? plan.v2RenderPlan.controlledV2Translation.mode : null,
  };
}

/**
 * Bounded safety snapshot -- COUNTS and BOOLEANS only, deliberately
 * never the `hardStops[]`/`softCaps[]`/`photographerSummary` prose
 * strings those engines also return (those are the exact kind of Raw
 * Core Prose the Calibration Lab's own hostile tests must prove never
 * leaks into a canonical/stored field).
 */
export function extractSafetySnapshot(finalPreset, benchmark = null) {
  const safetyClamp = finalPreset?._decision?.finalStyleIntent?.lightroomSafetyClampV2;
  const hardStopCount = Array.isArray(safetyClamp?.hardStops) ? safetyClamp.hardStops.length : 0;
  const softCapCount = Array.isArray(safetyClamp?.softCaps) ? safetyClamp.softCaps.length : 0;
  const legacyWarningCount = Array.isArray(benchmark?.warnings) ? benchmark.warnings.length : 0;
  return {
    legacySafetyWarningCount: legacyWarningCount,
    v2HardStopCount: hardStopCount,
    v2SoftCapCount: softCapCount,
    severeIssueDetected: benchmark?.details?.extremelyUnsafe === true || hardStopCount > 0,
  };
}

/** `containsSkin` -- a bounded boolean, never a raw coverage percentage prose string. */
export function computeContainsSkin(skin, skinPctAccurate) {
  const pct = _num(skinPctAccurate) ?? _num(skin?.coveragePct) ?? 0;
  return pct >= 5 || skin?.isFaceCandidate === true;
}

/**
 * Perceptual image fingerprint -- a 64-bit dHash computed from a 9x8
 * downsampled grayscale thumbnail (adjacent-pixel luminance
 * comparison, a standard difference-hash). Deterministic from pixel
 * content only -- never derived from (and never able to reveal) the
 * original file name or Local File Path. Returns `null` if canvas is
 * unavailable (never throws).
 */
export function computeImageFingerprint(imgElement) {
  try {
    const w = 9, h = 8;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    let bits = '';
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w - 1; col++) {
        bits += gray[row * w + col] > gray[row * w + col + 1] ? '1' : '0';
      }
    }
    // 64 bits -> 16 hex chars.
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
    }
    return `dhash-${hex}`;
  } catch {
    return null;
  }
}

/**
 * Runs the full existing analysis + decision pipeline against one
 * already-decoded `<img>` element (browser-only -- same assumption
 * every core/*-engine already makes) and returns a bounded Semantic
 * Image Test Record payload: `{ imageFingerprint, containsSkin,
 * legacySnapshot, controlledV2Snapshot, safetySnapshot,
 * analysisGenerationId }`. The image element itself is never retained
 * by this function or its caller -- only these bounded, serializable
 * fields are returned.
 */
export async function runCalibrationComparisonPipeline(imgElement, { analysisGenerationId = null } = {}) {
  const stats = await analyzeImage(imgElement);

  const [skinClassRes, castRes] = (await Promise.allSettled([
    classifySkin(imgElement),
    detectColorCast(imgElement),
  ])).map(r => r.status === 'fulfilled' ? r.value : null);

  const skinPctAccurate = skinClassRes?.coveragePct ?? stats?.skinPct ?? 0;
  const sceneRes = classifyScene(stats, skinClassRes);

  const [skinToneRes, wbRes, hslRes, gradingRes, tcRes, calRes, styleRecRes] =
    (await Promise.allSettled([
      analyzeSkinTone(imgElement),
      analyzeWhiteBalance(imgElement, { category: sceneRes.category, skinPct: skinPctAccurate, cast: castRes }),
      analyzeHSL(imgElement, { category: sceneRes.category }),
      analyzeColorGrading(imgElement, { category: sceneRes.category }),
      generateToneCurves(imgElement, stats),
      analyzeCalibration(imgElement, { category: sceneRes.category, skinPct: skinPctAccurate }),
      recognizeStyle(imgElement),
    ])).map(r => r.status === 'fulfilled' ? r.value : null);

  const skin = skinToneRes
    ? { ...skinToneRes, coveragePct: skinPctAccurate, isFaceCandidate: skinClassRes?.isFaceCandidate ?? true, confidence: skinClassRes?.confidence ?? 0.5 }
    : skinClassRes;
  const basic = generateBasicPanel(stats);

  let palette = null, harmony = null;
  try { palette = await extractPalette(imgElement); } catch { palette = null; }
  if (palette) { try { harmony = generateHarmonies(palette); } catch { harmony = null; } }

  const fusionCtx = {
    stats, basic, wb: wbRes, skin, hsl: hslRes, calibration: calRes, grading: gradingRes, toneCurves: tcRes,
    palette, harmony, styleRecognition: styleRecRes, scene: sceneRes, cast: castRes,
  };
  const styleFeatureGraph = buildStyleFeatureGraph(fusionCtx);
  const styleFingerprint = buildStyleFingerprint({ ...fusionCtx, featureGraph: styleFeatureGraph });

  const rawPreset = buildFinalPreset({
    stats, basic, wb: wbRes, skin, hsl: hslRes, calibration: calRes, grading: gradingRes, toneCurves: tcRes,
    scene: sceneRes, cast: castRes, styleRecognition: styleRecRes,
    palette, harmony, fingerprint: styleFingerprint,
    mode: 'single-image-auto',
    // Calibration Lab never carries forward a Human Review state --
    // every comparison run is independent, exactly like a fresh image
    // import in Production (never Re-analyze semantics).
    controlledPreviewReviewStateV2: null,
  });

  const { preset: validatedPreset, report: validationReport } = validateFinalPreset(rawPreset, styleFingerprint);
  validatedPreset._decision = rawPreset._decision;
  validatedPreset._validation = validationReport;

  const benchmark = benchmarkStylePreservation({
    styleFingerprint, styleFeatureGraph,
    decisionStrategy: validatedPreset._decision,
    finalPreset: validatedPreset,
    preXmpValidation: validationReport,
  });

  let finalPreset = validatedPreset;
  if (benchmark.details?.extremelyUnsafe) {
    const reclamp = quickSafetyClamp(validatedPreset);
    finalPreset = { ...reclamp.preset, _decision: validatedPreset._decision, _validation: validationReport };
  }

  return {
    imageFingerprint: computeImageFingerprint(imgElement),
    containsSkin: computeContainsSkin(skin, skinPctAccurate),
    analysisGenerationId,
    legacySnapshot: extractLegacySnapshot(finalPreset, benchmark),
    controlledV2Snapshot: extractControlledV2Snapshot(finalPreset),
    safetySnapshot: extractSafetySnapshot(finalPreset, benchmark),
    // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: the full Visual Preview
    // Render Plan (the exact object `ui/visual-preview-comparison-controller-v2.js`
    // already consumes for the production preview) is returned here
    // TRANSIENT-ONLY, alongside the bounded snapshots above. The
    // controller (ui/calibration-lab/calibration-lab-controller.js)
    // MUST NEVER write this field into a persisted session/image
    // record -- core/calibration-lab/schema.js's createImageTestRecord()
    // has no field for it and validateImageRecord() does not accept
    // one, so there is no schema path by which it could reach
    // IndexedDB or JSON/CSV export. It exists purely so the Calibration
    // Lab's before/after view can call the SAME production isolated
    // pixel renderer (never a reimplementation) for the image that was
    // just analyzed in this runtime session. See docs/project/29_EPIC_2E_K_R2_REAL_PIXEL_COMPARISON.md.
    renderPlanForPixelPreviewTransientOnly: finalPreset?._decision?.finalStyleIntent?.visualPreviewRenderPlanV2 ?? null,
  };
}
