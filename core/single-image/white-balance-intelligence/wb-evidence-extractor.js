/**
 * core/single-image/white-balance-intelligence/wb-evidence-extractor.js
 *
 * EPIC 2E-P1H — extracts the White Balance Plan's evidence object from
 * session.evidence, which by this point in the pipeline already holds
 * the REAL result of core/whitebalance-engine's analyzeWhiteBalance()
 * (evidenceKey 'wb') and core/color-cast-detector's detectColorCast()
 * (evidenceKey 'colorCast' -- wired to session.evidence for the first
 * time by this EPIC; see P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md §0
 * and the ui/app.js commitEvidence('colorCast', ...) call added
 * alongside this module). Never touches the DOM/Canvas -- both
 * analyses already ran for real upstream; this module only reads
 * their output.
 */

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const usable = entry.status === 'COMPLETED' || entry.status === 'CACHE_HIT';
  return usable ? (entry.result ?? null) : null;
}

/**
 * EPIC 2E-P1I: is the pixel-level multi-estimator WB bundle usable as
 * corroborating evidence? Requires the bundle itself to be present,
 * NOT status UNAVAILABLE, and to have produced at least one usable
 * individual estimator -- an empty/degraded-to-nothing bundle is
 * treated exactly like "P1I did not run" (R1 fallback), never as a
 * false signal.
 */
function _p1iUsable(wbEstimators) {
  return !!(wbEstimators
    && wbEstimators.status !== 'UNAVAILABLE'
    && wbEstimators.ensemble
    && Array.isArray(wbEstimators.ensemble.usableEstimatorIds)
    && wbEstimators.ensemble.usableEstimatorIds.length > 0);
}

function _clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/**
 * @param {object} evidence  session.evidence (read-only)
 * @returns {{ok:boolean, degraded:boolean, confidence:number, evidence:object|null, reasons:string[]}}
 */
export function extractWBEvidence(evidence) {
  const wb = _resultOf(evidence, 'wb');
  const cast = _resultOf(evidence, 'colorCast');
  const skin = _resultOf(evidence, 'skin');
  // EPIC 2E-P1I: optional pixel-level multi-estimator evidence -- an
  // ADDITIONAL, higher-quality evidence source layered on top of the
  // existing R1 (whitebalance-engine-only) evidence, never a
  // replacement for it. See P1I_P1H_INTEGRATION_POLICY.md for the
  // exact ownership boundary this function preserves: P1I supplies
  // evidence fields only, P1H's confidence/classification/guardrail
  // logic downstream in wb-plan-builder.js is completely unchanged.
  const wbEstimators = _resultOf(evidence, 'wbEstimators');
  const reasons = [];

  if (!wb || !wb.consensus || typeof wb.consensus.temperature !== 'number') {
    return { ok: false, degraded: false, confidence: 0, evidence: null, reasons: ['no usable White Balance engine evidence (wb.consensus missing)'] };
  }

  const intent = wb.wbIntent ?? null;
  const degraded = !cast;
  if (degraded) reasons.push('color-cast-detector evidence unavailable -- shadow/highlight cast labels and object-color-bias signals fall back to whitebalance-engine-internal estimates only');

  // ── The 9 required evidence fields (adapted to real repo contracts) ──
  let rawTemperature = wb.consensus.temperature;
  let rawTint = wb.consensus.tint;

  // Neutral-reference confidence: how much real neutral-pixel evidence
  // backs this WB reading. Reuses wbIntent.neutralBias/referenceConfidence
  // (already computed in whitebalance-engine's _buildWBIntent()) rather
  // than re-deriving a second neutral-pixel scan -- see
  // P1H_ILLUMINANT_OBJECT_BIAS_POLICY.md.
  let neutralReferenceConfidence = intent
    ? _clamp01(0.5 * intent.neutralBias + 0.5 * intent.referenceConfidence)
    : _clamp01(wb.confidence ?? 0.4);

  // Skin-consistency confidence: whether skin evidence, if present, is
  // internally consistent enough to corroborate (never dictate) WB.
  // PROXY -- no dedicated saturated-makeup/costume-lit/clipped-skin
  // detector exists; approximated from skinWarmth.confidence (already
  // computed) discounted when skin coverage is very small. See
  // skin-consistency-validator.js for the full accept/reject decision.
  const skinCoveragePct = typeof skin?.coveragePct === 'number' ? skin.coveragePct : null;
  const skinWarmthConfidence = intent?.skinWarmth?.confidence ?? 0;
  const skinConsistencyConfidence = skinCoveragePct != null
    ? _clamp01(skinWarmthConfidence * (skinCoveragePct >= 3 ? 1 : skinCoveragePct / 3))
    : 0;

  // Estimator agreement: whitebalance-engine's own confidence score is
  // ALREADY, by its own documented formula (see core/whitebalance-engine
  // /index.js lines ~120-129), 30% temp-source-agreement + 30%
  // tint-source-agreement + 40% neutral-pixel coverage. Reused directly
  // (not re-derived) as this plan's estimator-agreement evidence field --
  // duplicating that spread computation here would violate the
  // reuse-first / never-duplicate-an-existing-formula convention.
  const estimatorAgreement = _clamp01(wb.confidence ?? 0.4);

  // Shadow/highlight per-zone cast labels -- real per-zone measurement
  // when color-cast-detector evidence is present; falls back to the
  // engine-internal wbIntent shadow/highlight bias strings (which are
  // themselves sourced from the SAME detectColorCast() call via the
  // `cast` option passed into analyzeWhiteBalance -- see
  // core/whitebalance-engine/index.js _buildWBIntent()).
  const shadowCastLabel = cast?.shadows?.label ?? intent?.shadowBias ?? 'unknown';
  const highlightCastLabel = cast?.highlights?.label ?? intent?.highlightBias ?? 'unknown';

  // Background/object-color risk -- combines the real per-zone
  // background-vs-center comparison (cast.bgGreenDominant/subjectNeutral,
  // center/border labels) with wbIntent's existing greenBounceRisk.
  // illuminant-object-bias-separator.js turns this into the final
  // objectColorBiasScore; this evidence field is the raw signal only.
  const centerLabel = cast?.center?.label ?? null;
  const borderLabel = cast?.border?.label ?? null;
  const centerStrength = cast?.center?.strength ?? 0;
  const borderStrength = cast?.border?.strength ?? 0;
  let bgObjectColorRisk = cast
    ? _clamp01(
        (cast.bgGreenDominant ? 0.5 : 0) +
        (cast.subjectNeutral && cast.bgGreenDominant ? 0.3 : 0) +
        // Generalized spatial-separation signal (NOT green-only): a
        // neutral subject/center paired with a meaningfully stronger,
        // non-neutral border/background cast -- red costume, blue
        // wall, colored backdrop, etc. -- is on its own enough to
        // flag object-color bias, matching the weight the green-only
        // legacy bgGreenDominant flag already carries above (0.5+0.3),
        // per the spec's "central requirement" to generalize beyond
        // green. See P1H_ILLUMINANT_OBJECT_BIAS_POLICY.md.
        (centerLabel && borderLabel && centerLabel !== borderLabel && centerLabel === 'neutral' && borderStrength > centerStrength + 0.15 ? 0.6 : 0)
      )
    : _clamp01(intent?.greenBounceRisk ?? 0);

  let mixedLightingRisk = _clamp01(intent?.mixedLightingRisk ?? 0);

  const dataPoints = [!!wb, !!cast, !!skin, !!intent].filter(Boolean).length;
  let confidence = _clamp01(0.35 + 0.15 * dataPoints);

  // ── EPIC 2E-P1I: layer pixel-level estimator evidence on top, when
  // usable. Every field below starts from the EXACT R1 value computed
  // above; when P1I evidence is absent/unavailable, none of this
  // branch executes and the function's output is byte-for-byte
  // identical to P1H R1 -- verified by test #56 ("P1H falls back to
  // R1 evidence when P1I is unavailable"). ──────────────────────────
  const p1iUsable = _p1iUsable(wbEstimators);
  let source = cast ? 'whitebalance-engine+color-cast-detector' : 'whitebalance-engine';
  let p1iSummary = null;

  if (p1iUsable) {
    const p1iConfidence = _clamp01(wbEstimators.ensemble.confidence);
    const legacyConfidence = _clamp01(intent?.referenceConfidence ?? wb.confidence ?? 0.4);
    const totalWeight = p1iConfidence + legacyConfidence;
    if (totalWeight > 0) {
      rawTemperature = Math.round(
        (rawTemperature * legacyConfidence + wbEstimators.ensemble.consensus.temperature * p1iConfidence) / totalWeight
      );
      rawTint = Math.round(
        (rawTint * legacyConfidence + wbEstimators.ensemble.consensus.tint * p1iConfidence) / totalWeight
      );
    }

    const nrResult = wbEstimators.estimators?.neutralRegion;
    if (nrResult && Number.isFinite(nrResult.confidence)) {
      neutralReferenceConfidence = _clamp01(0.5 * neutralReferenceConfidence + 0.5 * nrResult.confidence);
    }

    if (wbEstimators.objectBias && Number.isFinite(wbEstimators.objectBias.objectBiasProbability)) {
      bgObjectColorRisk = _clamp01(0.5 * bgObjectColorRisk + 0.5 * wbEstimators.objectBias.objectBiasProbability);
    }

    if (wbEstimators.mixedLight && Number.isFinite(wbEstimators.mixedLight.score)) {
      mixedLightingRisk = _clamp01(0.5 * mixedLightingRisk + 0.5 * wbEstimators.mixedLight.score);
    }

    source = `${source}+pixel-multi-estimator`;
    confidence = _clamp01(confidence + 0.05); // one additional real, independent data source
    p1iSummary = {
      ensembleConfidence: wbEstimators.ensemble.confidence,
      ensembleConsensus: wbEstimators.ensemble.consensus,
      usableEstimatorIds: wbEstimators.ensemble.usableEstimatorIds,
      outlierEstimatorIds: wbEstimators.ensemble.outlierEstimatorIds,
      objectBiasProbability: wbEstimators.objectBias?.objectBiasProbability ?? null,
      objectBiasReasonCodes: wbEstimators.objectBias?.reasonCodes ?? [],
      mixedLightScore: wbEstimators.mixedLight?.score ?? null,
      mixedLightIsMixed: wbEstimators.mixedLight?.isMixedLight ?? false,
    };
  } else if (wbEstimators) {
    reasons.push('pixel-level estimator bundle present but unusable (no estimator produced a usable result) -- falling back to R1 whitebalance-engine evidence only');
  }

  return {
    ok: true,
    degraded,
    confidence,
    reasons,
    evidence: {
      source,
      rawTemperature, rawTint,
      neutralReferenceConfidence, skinConsistencyConfidence, estimatorAgreement,
      shadowCastLabel, highlightCastLabel, bgObjectColorRisk, mixedLightingRisk,
      _raw: {
        castLabel: wb.cast ?? null,
        moodPreservation: wb.moodPreservation ?? null,
        wbIntent: intent,
        centerLabel, borderLabel, bgGreenDominant: cast?.bgGreenDominant ?? null, subjectNeutral: cast?.subjectNeutral ?? null,
        skinCoveragePct,
        pixelEstimators: p1iSummary,
      },
    },
  };
}
