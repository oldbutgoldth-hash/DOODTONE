/**
 * core/single-image/detail-intelligence/detail-evidence-extractor.js
 *
 * EPIC 2E-P1G — extracts the Detail Plan's evidence object from
 * session.evidence (already computed upstream by the existing
 * pipeline) plus the already-committed P1F Basic Tone diagnostics on
 * the Candidate. Consumes ONLY real, already-computed evidence:
 *
 *   session.evidence.imageAnalysis (core/image-analysis-core/index.js
 *     analyzeImageCore() -- sharpnessScore, sharpnessLabel,
 *     blurDetected, blurConfidence, noiseScore, noiseLabel,
 *     jpegArtifactScore, jpegArtifactLabel)
 *   session.evidence.skin (core/skin-classifier + skintone-engine
 *     merge -- coveragePct, confidence)
 *   session.evidence.stats (histogram-engine -- avgLum, for a
 *     lowLightConfidence cross-reference)
 *   candidate.diagnostics.basicToneIntelligence (P1F's OWN
 *     sceneClass/protections -- read-only, never recomputed here)
 *
 * Never infers camera ISO (no EXIF reader exists in this pipeline --
 * see P1G_DETAIL_VALUE_LINEAGE_AUDIT.md §6). Where a required evidence
 * field has no dedicated per-pixel measurement (chromaNoise,
 * edgeDensity, fineDetailDensity), this module derives an explicitly
 * documented PROXY from the real fields above rather than fabricating
 * a new pixel-analysis engine (reuse-first convention).
 *
 * Pure function: never touches the DOM, never mutates its input.
 */

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const usable = entry.status === 'COMPLETED' || entry.status === 'CACHE_HIT';
  return usable ? (entry.result ?? null) : null;
}

function _clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Maps sharpnessLabel/sharpnessScore into a 0-1 focus-confidence scalar. */
function _focusConfidenceFrom(sharpnessScore, sharpnessLabel) {
  const score = Number.isFinite(sharpnessScore) ? _clamp01(sharpnessScore / 100) : 0.5;
  const labelFloor = { Sharp: 0.7, Acceptable: 0.45, Soft: 0.2, Blurry: 0.0 };
  const floor = labelFloor[sharpnessLabel] ?? 0.35;
  return _clamp01(Math.max(floor, score * 0.9));
}

/**
 * @param {object} evidence   session.evidence (read-only)
 * @param {object} [basicToneDiagnostics]  candidate.diagnostics.basicToneIntelligence (P1F, read-only, may be null)
 * @returns {{ok:boolean, confidence:number, evidence:object, reasons:string[]}}
 */
export function extractDetailEvidence(evidence, basicToneDiagnostics = null) {
  const ia = _resultOf(evidence, 'imageAnalysis');
  const stats = _resultOf(evidence, 'stats');
  const skinResult = _resultOf(evidence, 'skin');
  const reasons = [];

  if (!ia || typeof ia.noiseScore !== 'number' || typeof ia.sharpnessScore !== 'number') {
    return { ok: false, confidence: 0, evidence: null, reasons: ['no usable Image Analysis Core evidence (sharpnessScore/noiseScore missing)'] };
  }

  const luminanceNoise = _clamp01(ia.noiseScore / 100);
  const focusConfidence = _focusConfidenceFrom(ia.sharpnessScore, ia.sharpnessLabel);
  const blurConfidence = _clamp01(ia.blurConfidence ?? 0);
  const motionBlurRisk = ia.blurDetected ? Math.max(blurConfidence, 0.5) : blurConfidence * 0.4;
  const compressionArtifactRisk = _clamp01((ia.jpegArtifactScore ?? 0) / 100);

  // PROXY -- no dedicated per-channel chroma-noise measurement exists
  // in this pipeline (see audit §6). Derived from measured luminance
  // noise, discounted when overall saturation is high (chroma noise is
  // most visible in low-saturation/near-neutral regions). Documented
  // explicitly as a proxy: never used to claim Color Noise Reduction
  // export support, which remains a separate, audited-unsupported
  // question (see noise-reduction-planner.js / P1G_SUPPORTED_XMP_DETAIL_FIELDS.md).
  const avgSatPct = typeof stats?.avgSatPct === 'number' ? stats.avgSatPct : 35;
  const chromaNoise = _clamp01(luminanceNoise * (1 - _clamp01(avgSatPct / 140)));

  // PROXY -- no dedicated edge-density/high-frequency-energy
  // measurement is exposed separately from the focus (sharpness)
  // measure in image-analysis-core today. edgeDensity/fineDetailDensity
  // are derived from sharpnessScore, discounted when blur is detected
  // (blurred edges are not real recoverable fine detail).
  const edgeDensity = _clamp01((ia.sharpnessScore / 100) * (1 - 0.6 * motionBlurRisk));
  const fineDetailDensity = _clamp01(edgeDensity * (ia.sharpnessLabel === 'Sharp' ? 1.0 : 0.7));

  const skinCoverage = typeof skinResult?.coveragePct === 'number' ? _clamp01(skinResult.coveragePct / 100) : null;
  const skinConfidence = typeof skinResult?.confidence === 'number' ? _clamp01(skinResult.confidence) : null;

  // lowLightConfidence -- cross-references P1F's OWN sceneClass rather
  // than re-deriving a second low-light classifier (never recomputes
  // P1F's own plan -- see P1G_P1F_DETAIL_COORDINATION_POLICY.md).
  const p1fSceneClass = basicToneDiagnostics?.sceneClass ?? null;
  const p1fIsLowLight = p1fSceneClass === 'UNDEREXPOSED' || p1fSceneClass === 'LOW_KEY';
  const avgLum = typeof stats?.avgLum === 'number' ? stats.avgLum : 128;
  const lowLightConfidence = _clamp01((p1fIsLowLight ? 0.55 : 0) + Math.max(0, (95 - avgLum) / 190));

  // shadowLiftRisk -- reuses P1F's OWN protections.shadowProtection /
  // .noiseProtection (already computed by basic-tone-guardrails.js's
  // noise-risk check) rather than re-deriving a second shadow-lift
  // signal.
  const p1fProtections = basicToneDiagnostics?.protections ?? null;
  const shadowLiftRisk = p1fProtections?.noiseProtection ? 0.75 : (p1fProtections?.shadowProtection ? 0.4 : 0);

  const dataPoints = [
    Number.isFinite(ia.sharpnessScore), Number.isFinite(ia.noiseScore),
    typeof skinResult === 'object' && skinResult !== null, typeof stats === 'object' && stats !== null,
  ].filter(Boolean).length;
  const confidence = _clamp01(0.4 + 0.15 * dataPoints);

  if (skinCoverage === null) reasons.push('skin evidence unavailable -- skin protection defaults to a conservative fallback');
  if (!stats) reasons.push('histogram evidence unavailable -- lowLightConfidence/shadowLiftRisk use Image Analysis Core only');

  return {
    ok: true,
    confidence,
    reasons,
    evidence: {
      source: 'image-analysis-core+skin-classifier',
      luminanceNoise, chromaNoise, edgeDensity, fineDetailDensity,
      motionBlurRisk, focusConfidence, skinCoverage, lowLightConfidence,
      shadowLiftRisk, compressionArtifactRisk,
      _raw: { sharpnessLabel: ia.sharpnessLabel, noiseLabel: ia.noiseLabel, blurDetected: !!ia.blurDetected, jpegArtifactLabel: ia.jpegArtifactLabel },
    },
  };
}
