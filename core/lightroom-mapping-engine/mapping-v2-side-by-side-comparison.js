/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIDE-BY-SIDE PREVIEW COMPARISON V2 (EPIC 2E-G Phase A) — DATA MODEL ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Compares (1) Legacy Mapping/Legacy Preview information against (2) the
 * V2 Controlled Overlay Preview Sandbox, and answers "what is similar,
 * what is different, what may improve, what may become riskier, is
 * there enough evidence, and is human visual review still required?"
 *
 * This is a STANDALONE COMPARISON ENGINE ONLY:
 * - creates no UI
 * - is not wired into the main pipeline (decision-engine/index.js is
 *   NOT modified by this file's existence — a future Phase B will do
 *   that integration)
 * - never changes the project version
 * - never generates a real Lightroom slider value
 * - never touches XMP
 * - never activates V2 production mapping
 *
 * `selectedProductionSource` is hard-coded `"legacy"`. `canCompareVisually`
 * is hard-coded `false` — this codebase has no image-rendering pipeline
 * anywhere; this module produces DATA comparisons only, never a fake or
 * real rendered preview image. Every input is OPTIONAL; every access
 * below is null-safe. Never mutates any input object — only reads and
 * summarises.
 *
 * FUTURE integration path (not implemented in this phase):
 *   finalStyleIntent.sideBySidePreviewComparisonV2
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalizes any value to a safe array. Never trusts `x ?? []` alone —
 * that only guards null/undefined, not a malformed non-array truthy
 * value like a string or plain object, which would still reach
 * `.map`/`.filter`/`.slice`/spread and either throw or silently
 * produce wrong results (e.g. spreading a string iterates characters).
 * Applied everywhere an untrusted field is used as a collection —
 * adjustments, blockers, warnings, reasons, strengths, hardStops,
 * reviewItems, evidence collections.
 */
function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

/** Normalizes an arbitrary risk-level-ish value to low/medium/high/critical/unknown. Unknown NEVER becomes low. */
function _normalizeRiskLevel(v) {
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (RISK_LEVELS.has(lower)) return lower;
    if (lower === 'none') return 'low'; // "none" genuinely means equal-or-less risk than low, never more
  }
  return 'unknown';
}

/** Classifies a 0-1-ish magnitude into an abstract category — never a real slider value. Same pattern as mapping-v2-shadow-compare.js's _directionOf. */
function _directionOf(magnitude) {
  if (magnitude == null || !Number.isFinite(magnitude)) return 'unknown';
  const m = Math.abs(magnitude);
  return m < 0.15 ? 'conservative' : m < 0.4 ? 'balanced' : 'strong';
}

/**
 * Normalizes an arbitrary "hard stops" value into a safe, finite,
 * non-negative integer count. Supports every shape the spec lists:
 * array → length; finite positive number → integer count; boolean
 * true → 1, false → 0; object with a numeric `.count` → that count;
 * object with `.active === true` → 1; anything else (null, missing,
 * malformed) → 0.
 */
function _normalizeHardStopCount(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (_isRecord(v)) {
    if (typeof v.count === 'number' && Number.isFinite(v.count) && v.count > 0) return Math.floor(v.count);
    if (v.active === true) return 1;
    return 0;
  }
  return 0;
}

/**
 * Reads a hard-stop count from BOTH possible sources
 * (lightroomSafetyClampV2.hardStops and
 * controlledOverlayPreviewSandboxV2.previewRiskReview.hardStops) and
 * combines them without double-counting: if both sources are arrays,
 * their lengths are summed only when they are clearly non-overlapping
 * signals (different subsystems reporting independently) — since
 * neither array shares identifiable entries in this data model, the
 * safest, most honest merge is the GREATER of the two normalized
 * counts (per spec: "use the greater confirmed count"), not a naive
 * sum that could double-count the same underlying condition reported
 * by two subsystems.
 */
function _mergedHardStopCount(safetyClamp, sandbox) {
  const fromSafetyClamp = _normalizeHardStopCount(safetyClamp?.hardStops);
  const fromSandbox = _normalizeHardStopCount(_isRecord(sandbox?.previewRiskReview) ? sandbox.previewRiskReview.hardStops : undefined);
  return Math.max(fromSafetyClamp, fromSandbox);
}

/**
 * Compares two abstract "direction" strings (e.g. 'conservative'/
 * 'balanced'/'strong') and produces a similarity/direction/preferredSide
 * verdict. Missing evidence on either side always yields "unknown" —
 * never a guessed similarity.
 */
function _compareDirectionPair(legacyDir, v2Dir) {
  if (!legacyDir || !v2Dir || legacyDir === 'unknown' || v2Dir === 'unknown') {
    return { similarity: 0.3, direction: 'unknown', preferredSide: 'unknown' };
  }
  if (legacyDir === v2Dir) return { similarity: 0.85, direction: 'similar', preferredSide: 'tie' };
  if (legacyDir === 'balanced' || v2Dir === 'balanced') return { similarity: 0.55, direction: 'mixed', preferredSide: 'human-review' };
  return { similarity: 0.3, direction: v2Dir === 'strong' ? 'v2-stronger' : 'legacy-stronger', preferredSide: 'human-review' };
}

/**
 * Compares two normalized risk levels and produces a similarity/
 * direction/preferredSide verdict framed around SAFETY (lower risk is
 * "safer", not "stronger"). Missing evidence on either side always
 * yields "unknown".
 */
function _compareRiskPair(legacyRisk, v2Risk) {
  const l = _normalizeRiskLevel(legacyRisk), v = _normalizeRiskLevel(v2Risk);
  if (l === 'unknown' || v === 'unknown') return { similarity: 0.3, direction: 'unknown', preferredSide: 'unknown' };
  if (RISK_RANK[l] === RISK_RANK[v]) return { similarity: 0.8, direction: 'similar', preferredSide: 'tie' };
  return RISK_RANK[v] < RISK_RANK[l]
    ? { similarity: 0.45, direction: 'v2-safer', preferredSide: 'v2' }
    : { similarity: 0.45, direction: 'legacy-safer', preferredSide: 'legacy' };
}

function _dimension(id, label, { available, legacy, v2, verdict, confidence, riskLevel, evidence, reasons, warnings }) {
  return {
    id, label, available: available === true,
    legacy: legacy ?? 'unknown', v2: v2 ?? 'unknown',
    similarity: +clamp01(verdict?.similarity ?? 0.3).toFixed(2),
    direction: verdict?.direction ?? 'unknown',
    preferredSide: verdict?.preferredSide ?? 'unknown',
    confidence: +clamp01(confidence ?? (available ? 0.4 : 0.15)).toFixed(2),
    riskLevel: _normalizeRiskLevel(riskLevel),
    evidence: evidence ?? [],
    reasons: reasons ?? [],
    warnings: warnings ?? [],
  };
}

// ── Legacy Preview Model ─────────────────────────────────────────────────────
function _buildLegacyPreview(legacyPreset, legacyMappingSummary) {
  const hasPreset = _isRecord(legacyPreset);
  const hasSummary = _isRecord(legacyMappingSummary);
  const available = hasPreset || hasSummary;
  const strengths = [], risks = [], warnings = [], reasons = [];

  if (!available) {
    reasons.push('No legacy preset or legacy mapping summary was supplied — legacy preview data is unavailable, not assumed.');
    return {
      available: false, dataAvailable: false, visualPreviewAvailable: false, source: 'legacy', productionSource: true, previewOnly: true,
      evidence: [], strengths, risks, warnings, reasons,
      summary: 'Legacy preview data is not available for this comparison.',
    };
  }

  strengths.push('Legacy Mapping is the current, proven production path — every exported preset today comes from it.');
  if (hasSummary && legacyMappingSummary.riskLevel) {
    reasons.push(`Legacy mapping summary reports risk level "${legacyMappingSummary.riskLevel}".`);
    if (legacyMappingSummary.riskLevel === 'high') risks.push('Legacy mapping summary itself reports a "high" abstract risk level for this input.');
  }
  if (hasPreset) reasons.push('Legacy preset values are available — abstract direction can be derived from them.');
  else warnings.push('Legacy preset object was not supplied; relying on legacyMappingSummary only, which is a coarser signal.');

  return {
    available: true, dataAvailable: true, visualPreviewAvailable: false, source: 'legacy', productionSource: true, previewOnly: true,
    // A DATA summary existing (numbers to classify) is NOT the same as a
    // renderable visual preview image existing — this codebase has no
    // image-rendering pipeline, so "evidence" here is always data-level.
    evidence: [hasPreset ? 'legacyPreset values present' : null, hasSummary ? 'legacyMappingSummary present' : null].filter(Boolean),
    strengths, risks, warnings, reasons,
    summary: 'Legacy Mapping data is available for abstract comparison. This is data-level evidence only, not a rendered visual preview.',
  };
}

// ── V2 Preview Model ──────────────────────────────────────────────────────────
function _buildV2Preview(sandbox) {
  const hasSandbox = _isRecord(sandbox);
  const preset = hasSandbox && _isRecord(sandbox.simulatedPreviewPreset) ? sandbox.simulatedPreviewPreset : null;
  const presetAvailable = preset?.available === true;
  const strengths = [], risks = [], warnings = [], reasons = [];

  if (!hasSandbox) {
    reasons.push('No controlledOverlayPreviewSandboxV2 was supplied — V2 preview data is unavailable, not assumed.');
    return {
      available: false, dataAvailable: false, visualPreviewAvailable: false, source: 'controlled-v2-preview', productionSource: false, previewOnly: true,
      exportEligible: false, appliedToProduction: false,
      evidence: [], strengths, risks, warnings, reasons,
      summary: 'V2 preview data is not available for this comparison.',
    };
  }

  // EPIC 2E-G Phase A explicit rule: never claim a V2 preview exists
  // merely because the Sandbox object exists — only when
  // simulatedPreviewPreset.available is genuinely true.
  if (!presetAvailable) {
    reasons.push(`Sandbox previewState is "${sandbox.previewState ?? 'unknown'}" and simulatedPreviewPreset.available is not true — no V2 preview data exists yet to compare.`);
    const sandboxBlockers = _safeArray(sandbox.blockers);
    if (sandboxBlockers.length) warnings.push(`Sandbox reports ${sandboxBlockers.length} blocker(s) preventing preview generation.`);
    return {
      available: false, dataAvailable: false, visualPreviewAvailable: false, source: 'controlled-v2-preview', productionSource: false, previewOnly: true,
      exportEligible: false, appliedToProduction: false,
      evidence: [], strengths, risks, warnings, reasons,
      summary: 'The V2 Controlled Preview has not been generated yet (Sandbox is not currently eligible) — nothing to compare against Legacy yet.',
    };
  }

  const adjustments = _safeArray(preset.adjustments);
  strengths.push(..._safeArray(adjustments.slice(0, 5).map(a => _isRecord(a) ? a.reason : null)).filter(Boolean));
  const risk = _isRecord(sandbox.previewRiskReview) ? sandbox.previewRiskReview : null;
  if (risk) {
    const hardStops = _normalizeHardStopCount(risk.hardStops);
    if (hardStops > 0) risks.push(`${hardStops} hard stop(s) currently active in the V2 preview.`);
    const overStack = _normalizeRiskLevel(risk.overStackSeverity);
    if (overStack === 'high' || overStack === 'critical') risks.push(`Over-stack severity is "${overStack}".`);
  }
  reasons.push('V2 preview object exists as an abstract, non-production comparison object — normalized 0-1 intensities only.');

  return {
    available: true, dataAvailable: true, visualPreviewAvailable: false, source: 'controlled-v2-preview', productionSource: false, previewOnly: true,
    exportEligible: false, appliedToProduction: false,
    evidence: [`simulatedPreviewPreset.available=true`, `${adjustments.length} adjustment(s) simulated`],
    strengths, risks, warnings, reasons,
    summary: 'V2 Controlled Preview data is available for abstract comparison. This is data-level evidence only, not a rendered visual preview — no real Lightroom slider values or XMP fields are involved.',
  };
}

// ── Comparison Dimensions (15) ────────────────────────────────────────────────
function _buildComparisonDimensions({ legacyPreset, sandbox, safetyClamp, translation, photographerIntent, photographerStyle, styleDNA, captureCapability, shadowCompare }) {
  const preset = _isRecord(legacyPreset) ? legacyPreset : {};
  const risk = _isRecord(sandbox?.previewRiskReview) ? sandbox.previewRiskReview : {};
  const toolPriorityMap = _isRecord(translation?.toolPriorityMap) ? translation.toolPriorityMap : {};
  const legacyHasPreset = _isRecord(legacyPreset);
  const v2HasSandbox = _isRecord(sandbox);

  const exp = preset.exp ?? null, con = preset.con ?? null, hi = preset.hi ?? null, sh = preset.sh ?? null;
  const temp = preset.temp ?? null, tint = preset.tint ?? null, vib = preset.vib ?? null, sat = preset.sat ?? null;

  const legacyTonal = legacyHasPreset ? _directionOf(((Math.abs(exp ?? 0) + Math.abs(hi ?? 0) + Math.abs(sh ?? 0)) / 3) / 50) : 'unknown';
  const v2Tonal = toolPriorityMap.basicTone ? _directionOf(toolPriorityMap.basicTone.intensity) : 'unknown';

  const legacyExp = legacyHasPreset && exp != null ? _directionOf(Math.abs(exp) / 50) : 'unknown';
  const v2Exp = toolPriorityMap.basicTone ? _directionOf(toolPriorityMap.basicTone.intensity) : 'unknown';

  const legacyCon = legacyHasPreset && con != null ? _directionOf(Math.abs(con) / 50) : 'unknown';
  const v2Con = toolPriorityMap.basicTone ? _directionOf(toolPriorityMap.basicTone.intensity) : 'unknown';

  const legacyHighlightRisk = legacyHasPreset && hi != null ? (Math.abs(hi) > 30 ? 'high' : Math.abs(hi) > 10 ? 'medium' : 'low') : 'unknown';
  const v2HighlightRisk = risk.highlightRisk ?? 'unknown';

  const legacyShadowRisk = legacyHasPreset && sh != null ? (Math.abs(sh) > 30 ? 'high' : Math.abs(sh) > 10 ? 'medium' : 'low') : 'unknown';
  const v2ShadowRisk = risk.shadowRisk ?? 'unknown';

  const legacyWb = legacyHasPreset && (temp != null || tint != null) ? _directionOf((Math.abs(temp ?? 0) / 500 + Math.abs(tint ?? 0) / 50) / 2) : 'unknown';
  const v2WbRisk = risk.whiteBalanceRisk ?? 'unknown';

  const legacySat = legacyHasPreset && (vib != null || sat != null) ? _directionOf(((Math.abs(vib ?? 0) + Math.abs(sat ?? 0)) / 2) / 50) : 'unknown';
  const v2ColorRisk = risk.colorRisk ?? 'unknown';

  const legacyColorSep = 'unknown'; // legacy mapping has no explicit color-separation concept
  const v2ColorSep = risk.colorRisk ?? 'unknown';

  const legacySkin = 'unknown'; // legacy preset has no explicit skin-protection concept
  const v2Skin = risk.skinRisk ?? 'unknown';

  const legacyStacking = 'unknown'; // legacy mapping does not evaluate combined-tool over-stacking at all
  const v2Stacking = _normalizeRiskLevel(risk.overStackSeverity ?? safetyClamp?.overStackAnalysis?.severity);

  const legacyOverstack = 'unknown';
  const v2Overstack = _normalizeRiskLevel(risk.overStackSeverity ?? safetyClamp?.overStackAnalysis?.severity);

  const captureAvailable = _isRecord(captureCapability);
  const legacyCapture = 'unknown'; // legacy mapping does not consult capture-capability data
  const v2Capture = captureAvailable ? (captureCapability.overallScore != null ? _directionOf(1 - captureCapability.overallScore) : 'unknown') : 'unknown';

  const styleAvailable = _isRecord(photographerStyle) || _isRecord(styleDNA);
  const legacyStyle = 'unknown'; // legacy mapping does not consult Photographer Style/DNA
  const v2Style = styleAvailable ? 'balanced' : 'unknown'; // qualitative only — style alignment is descriptive, not a magnitude

  const intentAvailable = _isRecord(photographerIntent);
  const legacyIntent = 'unknown'; // legacy mapping does not consult Photographer Intent
  const v2Intent = intentAvailable ? 'balanced' : 'unknown';

  const legacySafetyConf = 'unknown'; // legacy mapping has no safety-confidence score of its own
  const v2SafetyConf = safetyClamp?.globalSafetyScore != null ? (safetyClamp.globalSafetyScore >= 0.7 ? 'strong' : safetyClamp.globalSafetyScore >= 0.45 ? 'balanced' : 'conservative') : 'unknown';

  const dims = [
    _dimension('tonal-balance', 'Tonal Balance', { available: legacyHasPreset || !!toolPriorityMap.basicTone, legacy: legacyTonal, v2: v2Tonal, verdict: _compareDirectionPair(legacyTonal, v2Tonal), confidence: legacyHasPreset && toolPriorityMap.basicTone ? 0.55 : 0.25, reasons: ['Compares overall exposure/highlight/shadow magnitude classification.'] }),
    _dimension('exposure-direction', 'Exposure Direction', { available: exp != null || !!toolPriorityMap.basicTone, legacy: legacyExp, v2: v2Exp, verdict: _compareDirectionPair(legacyExp, v2Exp), confidence: exp != null && toolPriorityMap.basicTone ? 0.5 : 0.2 }),
    _dimension('contrast-direction', 'Contrast Direction', { available: con != null || !!toolPriorityMap.basicTone, legacy: legacyCon, v2: v2Con, verdict: _compareDirectionPair(legacyCon, v2Con), confidence: con != null && toolPriorityMap.basicTone ? 0.5 : 0.2 }),
    _dimension('highlight-protection', 'Highlight Protection', { available: hi != null || risk.highlightRisk != null, legacy: legacyHighlightRisk, v2: v2HighlightRisk, verdict: _compareRiskPair(legacyHighlightRisk, v2HighlightRisk), confidence: hi != null && risk.highlightRisk ? 0.55 : 0.2, riskLevel: v2HighlightRisk }),
    _dimension('shadow-protection', 'Shadow Protection', { available: sh != null || risk.shadowRisk != null, legacy: legacyShadowRisk, v2: v2ShadowRisk, verdict: _compareRiskPair(legacyShadowRisk, v2ShadowRisk), confidence: sh != null && risk.shadowRisk ? 0.55 : 0.2, riskLevel: v2ShadowRisk }),
    _dimension('white-balance-direction', 'White Balance Direction', { available: (temp != null || tint != null) || risk.whiteBalanceRisk != null, legacy: legacyWb, v2: v2WbRisk, verdict: _compareDirectionPair(legacyWb, v2WbRisk === 'unknown' ? 'unknown' : (v2WbRisk === 'low' ? 'conservative' : v2WbRisk === 'medium' ? 'balanced' : 'strong')), confidence: 0.3, riskLevel: v2WbRisk }),
    _dimension('saturation-direction', 'Saturation Direction', { available: (vib != null || sat != null) || risk.colorRisk != null, legacy: legacySat, v2: v2ColorRisk, verdict: _compareDirectionPair(legacySat, v2ColorRisk === 'unknown' ? 'unknown' : (v2ColorRisk === 'low' ? 'conservative' : v2ColorRisk === 'medium' ? 'balanced' : 'strong')), confidence: 0.3, riskLevel: v2ColorRisk }),
    _dimension('color-separation', 'Color Separation', { available: risk.colorRisk != null, legacy: legacyColorSep, v2: v2ColorSep, verdict: _compareRiskPair(legacyColorSep, v2ColorSep), confidence: 0.2, riskLevel: v2ColorSep, reasons: ['Legacy mapping has no explicit color-separation concept to compare against.'] }),
    _dimension('skin-protection', 'Skin Protection', { available: risk.skinRisk != null, legacy: legacySkin, v2: v2Skin, verdict: _compareRiskPair(legacySkin, v2Skin), confidence: risk.skinRisk ? 0.35 : 0.15, riskLevel: v2Skin, reasons: ['Legacy preset has no explicit skin-protection concept — only V2 evaluates this directly.'] }),
    _dimension('color-stacking', 'Color Stacking', { available: risk.overStackSeverity != null || safetyClamp?.overStackAnalysis?.severity != null, legacy: legacyStacking, v2: v2Stacking, verdict: _compareRiskPair(legacyStacking, v2Stacking), confidence: v2Stacking !== 'unknown' ? 0.4 : 0.15, riskLevel: v2Stacking, reasons: ['Legacy mapping does not evaluate combined-tool stacking at all — only V2 does.'] }),
    _dimension('over-stack-severity', 'Over-stack Severity', { available: risk.overStackSeverity != null || safetyClamp?.overStackAnalysis?.severity != null, legacy: legacyOverstack, v2: v2Overstack, verdict: _compareRiskPair(legacyOverstack, v2Overstack), confidence: v2Overstack !== 'unknown' ? 0.4 : 0.15, riskLevel: v2Overstack, reasons: ['Legacy mapping has no over-stack concept — only V2 evaluates this directly.'] }),
    _dimension('capture-compatibility', 'Capture Compatibility', { available: captureAvailable, legacy: legacyCapture, v2: v2Capture, verdict: { similarity: 0.3, direction: 'unknown', preferredSide: 'unknown' }, confidence: captureAvailable ? 0.3 : 0.1, reasons: ['Legacy mapping does not consult capture-capability data; only V2 planning considers it.'] }),
    _dimension('style-alignment', 'Style Alignment', { available: styleAvailable, legacy: legacyStyle, v2: v2Style, verdict: { similarity: 0.3, direction: 'unknown', preferredSide: 'unknown' }, confidence: styleAvailable ? 0.3 : 0.1, reasons: ['Legacy mapping does not consult Photographer Style/DNA; only V2 planning considers it.'] }),
    _dimension('intent-alignment', 'Intent Alignment', { available: intentAvailable, legacy: legacyIntent, v2: v2Intent, verdict: { similarity: 0.3, direction: 'unknown', preferredSide: 'unknown' }, confidence: intentAvailable ? 0.3 : 0.1, reasons: ['Legacy mapping does not consult Photographer Intent; only V2 planning considers it.'] }),
    _dimension('safety-confidence', 'Safety Confidence', { available: safetyClamp?.globalSafetyScore != null, legacy: legacySafetyConf, v2: v2SafetyConf, verdict: { similarity: 0.3, direction: 'unknown', preferredSide: safetyClamp?.globalSafetyScore != null ? 'human-review' : 'unknown' }, confidence: safetyClamp?.globalSafetyScore ?? 0.15, reasons: ['Legacy mapping has no safety-confidence score of its own — only V2 Safety Clamp computes one.'] }),
  ];
  return dims;
}

// ── Similarity / Divergence Summaries ─────────────────────────────────────────
function _levelFromScore(score, thresholds = [0.2, 0.4, 0.6, 0.8]) {
  if (score == null || !Number.isFinite(score)) return 'unknown';
  if (score < thresholds[0]) return 'very-low';
  if (score < thresholds[1]) return 'low';
  if (score < thresholds[2]) return 'moderate';
  if (score < thresholds[3]) return 'high';
  return 'very-high';
}

function _buildSimilaritySummary(dims) {
  const available = dims.filter(d => d.available && d.direction !== 'unknown');
  if (!available.length) {
    return { overallSimilarity: 0, level: 'unknown', strongestMatches: [], weakestMatches: [], reasons: ['No dimensions have enough evidence on both sides to compute similarity.'] };
  }
  const overallSimilarity = +clamp01(available.reduce((s, d) => s + d.similarity, 0) / available.length).toFixed(3);
  const sorted = [...available].sort((a, b) => b.similarity - a.similarity);
  return {
    overallSimilarity, level: _levelFromScore(overallSimilarity),
    strongestMatches: sorted.slice(0, 3).map(d => d.id),
    weakestMatches: sorted.slice(-3).reverse().map(d => d.id),
    reasons: [`Similarity computed from ${available.length} of ${dims.length} dimension(s) with sufficient evidence on both sides.`],
  };
}

function _buildDivergenceSummary(dims) {
  const available = dims.filter(d => d.available && d.direction !== 'unknown');
  const incomplete = dims.filter(d => !d.available || d.direction === 'unknown');
  const major = available.filter(d => d.similarity < 0.4);
  const minor = available.filter(d => d.similarity >= 0.4 && d.similarity < 0.7);
  const warnings = [];
  if (incomplete.length) warnings.push(`${incomplete.length} of ${dims.length} dimension(s) lack sufficient evidence — their divergence is unresolved, not assumed low.`);
  // EPIC 2E-G explicit rule: do not simply invert similarity when
  // evidence is incomplete — unresolved dimensions are tracked
  // separately from measured divergence.
  const overallDivergence = available.length ? +clamp01(1 - (available.reduce((s, d) => s + d.similarity, 0) / available.length)).toFixed(3) : null;
  return {
    overallDivergence: overallDivergence ?? 0,
    level: overallDivergence == null ? 'unknown' : _levelFromScore(overallDivergence),
    majorDifferences: major.map(d => d.id),
    minorDifferences: minor.map(d => d.id),
    unresolvedDifferences: incomplete.map(d => d.id),
    reasons: [`${major.length} major, ${minor.length} minor, and ${incomplete.length} unresolved (insufficient-evidence) dimension(s) out of ${dims.length}.`],
    warnings,
  };
}

// ── Safety Comparison ──────────────────────────────────────────────────────────
function _buildSafetyComparison(legacyPreview, v2Preview, safetyClamp, sandbox) {
  const reasons = [], warnings = [];
  const legacyEvidence = legacyPreview.available;
  const v2Evidence = v2Preview.available;
  const hardStops = _mergedHardStopCount(safetyClamp, sandbox);
  const overStack = _normalizeRiskLevel(safetyClamp?.overStackAnalysis?.severity ?? (_isRecord(sandbox?.previewRiskReview) ? sandbox.previewRiskReview.overStackSeverity : undefined));
  const criticalOverstack = overStack === 'critical';
  const v2SafetyScore = typeof safetyClamp?.globalSafetyScore === 'number' && Number.isFinite(safetyClamp.globalSafetyScore) ? safetyClamp.globalSafetyScore : null;
  // Legacy mapping has no equivalent numeric safety score of its own —
  // it is the current production path by definition, so its "score"
  // here is deliberately left null/uncertain rather than assumed 1.0.
  // BUG 5: this being null is exactly why a strong V2 score ALONE must
  // never be enough to claim "v2" is the safer side — there is no
  // comparable legacy number to actually compare it against.
  const legacySafetyScore = null;

  if (!legacyEvidence) warnings.push('Missing legacy evidence prevents a confident safety comparison.');
  if (!v2Evidence) warnings.push('Missing V2 evidence prevents a confident safety comparison.');
  if (hardStops > 0) { reasons.push(`${hardStops} hard stop(s) prevent a confident "V2 safer" claim.`); warnings.push(`${hardStops} active hard stop(s).`); }
  if (criticalOverstack) { reasons.push('Critical over-stack severity prevents a confident "V2 safer" claim.'); warnings.push('Critical over-stack severity detected.'); }
  if (v2SafetyScore != null && v2SafetyScore < 0.5) warnings.push(`V2 safety score (${v2SafetyScore}) is below the confidence threshold — reflected honestly, not hidden.`);

  let saferSide, confidence;
  if (!legacyEvidence || !v2Evidence) { saferSide = 'uncertain'; confidence = 0.2; reasons.push('Insufficient evidence on one or both sides for a safety-side verdict.'); }
  else if (hardStops > 0 || criticalOverstack) { saferSide = 'legacy'; confidence = 0.55; reasons.push('Legacy remains the safer default while V2 carries unresolved hard-stop/over-stack risk.'); }
  else if (legacySafetyScore == null) {
    // BUG 5 fix: no comparable legacy safety score exists, so the
    // comparative "safer side" can never be resolved to "v2" or
    // "legacy" purely from V2's own internal score, no matter how
    // strong that score is — it is honestly "uncertain".
    saferSide = 'uncertain'; confidence = v2SafetyScore != null ? 0.3 : 0.2;
    reasons.push(v2SafetyScore != null
      ? `V2 reports a strong internal safety score (${v2SafetyScore}), but no comparable Legacy safety score exists — the comparative safer side remains uncertain, not "v2".`
      : 'No V2 safety score available, and no comparable Legacy safety score exists either.');
  }
  else {
    // Unreachable while legacySafetyScore is always null in this
    // codebase — kept as an honest, explicit branch for the day a real
    // comparable legacy safety score becomes available, rather than
    // silently folding this case into the "uncertain" branch above.
    saferSide = 'tie'; confidence = 0.3; reasons.push('Comparable legacy safety evidence exists but did not clearly favor either side.');
  }

  return {
    legacySafetyScore, v2SafetyScore, saferSide,
    confidence: +clamp01(confidence).toFixed(2),
    hardStops, criticalRisks: criticalOverstack ? 1 : 0,
    uncertainty: !legacyEvidence || !v2Evidence || v2SafetyScore == null || legacySafetyScore == null,
    reasons, warnings,
  };
}

// ── Risk Comparison (8 areas) ───────────────────────────────────────────────────
function _buildRiskComparison(sandbox, safetyClamp) {
  const risk = _isRecord(sandbox?.previewRiskReview) ? sandbox.previewRiskReview : {};
  const hardStopsCount = _mergedHardStopCount(safetyClamp, sandbox);

  const areas = [
    ['skin', risk.skinRisk],
    ['highlights', risk.highlightRisk],
    ['shadows', risk.shadowRisk],
    ['white-balance', risk.whiteBalanceRisk],
    ['color', risk.colorRisk],
    ['overstack', risk.overStackSeverity ?? safetyClamp?.overStackAnalysis?.severity],
    ['export', 'none'], // export is hard-blocked in this EPIC — no export risk can exist
    ['production-write', 'none'], // production write is hard-blocked in this EPIC
  ];

  return areas.map(([area, v2Raw]) => {
    const v2Level = _normalizeRiskLevel(v2Raw);
    // Legacy mapping does not compute any of these 8 risk areas itself —
    // it is the current production default, so legacyLevel is always
    // "unknown" here (never assumed low), except export/production-write
    // which are meaningfully "low" for legacy since it IS the production
    // path already operating within its own established safety envelope.
    const legacyLevel = (area === 'export' || area === 'production-write') ? 'low' : 'unknown';
    const verdict = _compareRiskPair(legacyLevel, v2Level);
    return {
      area, legacyLevel, v2Level,
      preferredSide: (area === 'export' || area === 'production-write') ? 'legacy' : verdict.preferredSide,
      confidence: +clamp01(v2Level !== 'unknown' ? 0.45 : 0.15).toFixed(2),
      evidence: v2Level !== 'unknown' ? [`sandbox.previewRiskReview.${area === 'white-balance' ? 'whiteBalanceRisk' : area === 'overstack' ? 'overStackSeverity' : area + 'Risk'}=${v2Raw}`] : [],
      findings: area === 'export' ? ['Preview Export is hard-blocked in this EPIC — no export risk can currently materialize.']
        : area === 'production-write' ? ['Production Write is hard-blocked in this EPIC — no production-write risk can currently materialize.']
        : hardStopsCount > 0 && (area === 'overstack') ? [`${hardStopsCount} hard stop(s) currently active.`]
        : [],
    };
  });
}

// ── Evidence Quality ────────────────────────────────────────────────────────────
function _buildEvidenceQuality(legacyPreview, v2Preview, reviewState, dims) {
  const legacyEvidenceAvailable = legacyPreview.available === true;
  const v2EvidenceAvailable = v2Preview.available === true;
  const reviewEvidenceAvailable = _isRecord(reviewState);
  const visualEvidenceAvailable = false; // hard-coded — no image-rendering pipeline exists anywhere in this codebase
  const coveredDims = dims.filter(d => d.available).length;
  const coverageRatio = dims.length ? coveredDims / dims.length : 0;

  const missingEvidence = [];
  if (!legacyEvidenceAvailable) missingEvidence.push('legacy preview/mapping data');
  if (!v2EvidenceAvailable) missingEvidence.push('V2 preview data');
  if (!reviewEvidenceAvailable) missingEvidence.push('human review state');
  if (coverageRatio < 0.5) missingEvidence.push('sufficient comparison-dimension coverage');

  const limitations = ['No rendered visual preview exists for either side — this is a data-level comparison only.'];
  if (!reviewEvidenceAvailable) limitations.push('No human review has been recorded yet.');

  const score = +clamp01(
    (legacyEvidenceAvailable ? 0.3 : 0) + (v2EvidenceAvailable ? 0.3 : 0) +
    (reviewEvidenceAvailable ? 0.15 : 0) + coverageRatio * 0.25
  ).toFixed(3);
  const level = score < 0.3 ? 'insufficient' : score < 0.55 ? 'limited' : score < 0.8 ? 'moderate' : 'strong';

  return {
    score, level, legacyEvidenceAvailable, v2EvidenceAvailable, visualEvidenceAvailable, reviewEvidenceAvailable,
    missingEvidence, limitations,
    reasons: [`Evidence score ${score} from legacy=${legacyEvidenceAvailable}, v2=${v2EvidenceAvailable}, review=${reviewEvidenceAvailable}, dimension coverage ${coveredDims}/${dims.length}.`],
  };
}

// ── Human Review Status ────────────────────────────────────────────────────────
const CANONICAL_VISUAL_IDS = ['source-image-reviewed', 'skin-tones-reviewed', 'highlights-reviewed', 'shadows-reviewed', 'white-balance-reviewed', 'color-stacking-reviewed'];

/**
 * EPIC 2E-G-A-F Bug 2 fix: `visualReviewComplete` may be true ONLY when
 * every one of the 6 canonical visual-review items is present, has
 * `status === "passed"`, `reviewed === true`, and a `reviewerDecision`
 * that is neither "reject" nor "needs-adjustment". Uses a Map keyed by
 * canonical ID so duplicate IDs can never count as multiple completed
 * items (the last valid entry for a given ID simply overwrites the
 * previous one in the map — deterministic, never double-counted).
 * `[].every(...)` on an empty/partial set was the previous (buggy)
 * approach — vacuously true for an empty array and blind to missing
 * IDs; this always explicitly checks map SIZE and every canonical ID
 * individually instead.
 */
function _computeVisualReviewComplete(items) {
  const map = new Map();
  for (const item of _safeArray(items)) {
    if (!_isRecord(item) || typeof item.id !== 'string' || !CANONICAL_VISUAL_IDS.includes(item.id)) continue;
    map.set(item.id, item); // duplicate IDs: last valid entry wins, never counted twice
  }
  if (map.size < CANONICAL_VISUAL_IDS.length) return false; // an empty or partial checklist can never be complete
  for (const id of CANONICAL_VISUAL_IDS) {
    const item = map.get(id);
    if (item.status !== 'passed') return false;
    if (item.reviewed !== true) return false;
    if (item.reviewerDecision === 'reject' || item.reviewerDecision === 'needs-adjustment') return false;
  }
  return true;
}

function _buildHumanReviewStatus(reviewState) {
  if (!_isRecord(reviewState)) {
    return {
      available: false, approvalState: 'unavailable', progress: 0, completed: 0, required: 0,
      failedItems: [], pendingItems: [], needsAdjustment: [], canApprovePreview: false,
      visualReviewComplete: false,
      reasons: ['No controlledPreviewReviewStateV2 was supplied.'],
      warnings: [],
    };
  }
  const items = _safeArray(reviewState.reviewItems);
  const progress = _isRecord(reviewState.reviewProgress) ? reviewState.reviewProgress : null;
  const failedItems = items.filter(i => _isRecord(i) && i.status === 'failed').map(i => i.id);
  const pendingItems = items.filter(i => _isRecord(i) && i.status === 'pending').map(i => i.id);
  const needsAdjustment = items.filter(i => _isRecord(i) && i.reviewerDecision === 'needs-adjustment').map(i => i.id);
  const visualReviewComplete = _computeVisualReviewComplete(items);

  // BUG 2: normalize progress fields to finite, non-negative values —
  // never trust reviewProgress blindly, malformed/missing values fall
  // back to 0 rather than NaN/undefined/negative leaking outward.
  const safeNonNegative = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  const normalizedProgress = safeNonNegative(progress?.percentage);
  const normalizedCompleted = safeNonNegative(progress?.completed);
  const normalizedRequired = safeNonNegative(progress?.required);

  const warnings = [];
  // EPIC 2E-G explicit rule: never trust stale top-level approval
  // metadata blindly — always re-derive from the canonical reviewItems/
  // reviewProgress fields, exactly as consumed above.
  if (reviewState.canApprovePreview === true && failedItems.length > 0) warnings.push('canApprovePreview claims true while failed items exist — using recalculated canonical fields, not the top-level flag, for this status.');

  return {
    available: true,
    approvalState: typeof reviewState.approvalState === 'string' ? reviewState.approvalState : 'unavailable',
    progress: normalizedProgress,
    completed: normalizedCompleted,
    required: normalizedRequired,
    failedItems, pendingItems, needsAdjustment,
    // Recalculated defensively: canApprovePreview is only ever true here
    // if the engine's own flag says so AND there are no failed items —
    // approval never activates output regardless.
    canApprovePreview: reviewState.canApprovePreview === true && failedItems.length === 0,
    visualReviewComplete,
    reasons: [`Review approvalState="${reviewState.approvalState ?? 'unknown'}", ${normalizedCompleted}/${normalizedRequired} required items complete.`],
    warnings,
  };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildSideBySidePreviewComparisonV2({})`.
 * Never mutates any input object — only reads and summarises.
 */
export function buildSideBySidePreviewComparisonV2(input = {}) {
  const {
    legacyPreset = null,
    legacyMappingSummary = null,
    lightroomShadowCompareReportV2: shadowCompare = null,
    controlledOverlayPreviewSandboxV2: sandbox = null,
    controlledPreviewReviewStateV2: reviewState = null,
    legacyOverlaySimulationV2: overlaySimulation = null,
    legacySafetyOverlayV2: safetyOverlay = null,
    lightroomSafetyClampV2: safetyClamp = null,
    lightroomTranslationV2: translation = null,
    photographerIntent = null,
    photographerStyle = null,
    styleDNA = null,
    captureCapability = null,
  } = _isRecord(input) ? input : {};

  const warnings = [], reasons = [], blockers = [], recommendations = [];

  // ── Legacy / V2 preview models ─────────────────────────────────────────────
  const legacyPreview = _buildLegacyPreview(legacyPreset, legacyMappingSummary);
  const v2Preview = _buildV2Preview(sandbox);

  // ── Comparison dimensions / matrix ──────────────────────────────────────────
  const comparisonDimensions = _buildComparisonDimensions({ legacyPreset, sandbox, safetyClamp, translation, photographerIntent, photographerStyle, styleDNA, captureCapability, shadowCompare });
  const comparisonMatrix = comparisonDimensions.map(d => ({ ...d })); // new array of new objects — never the raw internal engine objects

  const similaritySummary = _buildSimilaritySummary(comparisonDimensions);
  const divergenceSummary = _buildDivergenceSummary(comparisonDimensions);
  const safetyComparison = _buildSafetyComparison(legacyPreview, v2Preview, safetyClamp, sandbox);
  const riskComparison = _buildRiskComparison(sandbox, safetyClamp);
  const evidenceQuality = _buildEvidenceQuality(legacyPreview, v2Preview, reviewState, comparisonDimensions);
  const humanReviewStatus = _buildHumanReviewStatus(reviewState);

  // ── Blocking rules ───────────────────────────────────────────────────────────
  const hardStopsCount = safetyComparison.hardStops;
  const criticalOverstack = safetyComparison.criticalRisks > 0;
  if (!legacyPreview.available && !v2Preview.available) blockers.push('Both Legacy and V2 preview data are unavailable.');
  if (!v2Preview.available) blockers.push('V2 preview is unavailable — nothing to compare against Legacy yet.');
  if (!legacyPreview.available) blockers.push('Legacy comparison evidence is missing.');
  if (hardStopsCount > 0) blockers.push(`${hardStopsCount} hard stop(s) are currently active.`);
  if (criticalOverstack) blockers.push('Critical over-stack severity is currently active.');
  if (evidenceQuality.level === 'insufficient') blockers.push('Comparison confidence is too low (insufficient evidence).');
  if (!humanReviewStatus.visualReviewComplete) blockers.push('Human visual evidence is required but not yet complete.');

  // ── Comparison state ─────────────────────────────────────────────────────────
  // BUG 3: every state below describes DATA/human-review readiness only
  // — "ready-for-review" means "ready for a human to review the DATA
  // comparison", never "a rendered image preview is ready to view
  // side-by-side". This codebase has no image-rendering pipeline.
  let comparisonState;
  if (!legacyPreview.available && !v2Preview.available) comparisonState = 'unavailable';
  else if (evidenceQuality.level === 'insufficient') comparisonState = 'insufficient-evidence';
  else if (hardStopsCount > 0 || criticalOverstack) comparisonState = 'blocked';
  else if (humanReviewStatus.available && humanReviewStatus.completed > 0) comparisonState = 'reviewed';
  else if (legacyPreview.available && v2Preview.available) comparisonState = 'ready-for-review';
  else comparisonState = 'partial';

  const comparisonAvailable = comparisonState !== 'unavailable' && comparisonState !== 'insufficient-evidence';

  // ── Recommendations (never V2 activation) ───────────────────────────────────
  recommendations.push('Continue using Legacy Mapping — production output is unaffected by this comparison.');
  if (!v2Preview.available) recommendations.push('Rerun analysis or wait for the V2 Preview Sandbox to become eligible before comparing.');
  if (comparisonDimensions.find(d => d.id === 'skin-protection')?.direction !== 'similar') recommendations.push('Review skin tones manually.');
  if (comparisonDimensions.find(d => d.id === 'highlight-protection')?.riskLevel === 'high') recommendations.push('Review highlights manually.');
  if (comparisonDimensions.find(d => d.id === 'white-balance-direction')?.direction === 'unknown') recommendations.push('Compare white balance visually.');
  if (hardStopsCount > 0 || criticalOverstack) recommendations.push('Resolve over-stack risk before further review.');
  if (!legacyPreview.available) recommendations.push('Collect legacy mapping data before drawing conclusions.');
  if (evidenceQuality.level === 'insufficient' || evidenceQuality.level === 'limited') recommendations.push('Collect more evidence (rerun analysis) for a more reliable comparison.');
  recommendations.push('Do not activate production output based on this comparison.');

  // ── Confidence ───────────────────────────────────────────────────────────────
  const dimCoverage = comparisonDimensions.length ? comparisonDimensions.filter(d => d.available).length / comparisonDimensions.length : 0;
  const confidence = +clamp01(
    (legacyPreview.available ? 0.2 : 0) + (v2Preview.available ? 0.2 : 0) +
    dimCoverage * 0.2 + (safetyComparison.confidence ?? 0) * 0.15 +
    (humanReviewStatus.available ? 0.15 : 0) -
    (hardStopsCount > 0 ? 0.15 : 0) - (criticalOverstack ? 0.15 : 0)
  ).toFixed(3);

  reasons.push(`comparisonState="${comparisonState}", evidence="${evidenceQuality.level}", confidence=${confidence}.`);
  if (!legacyPreview.available || !v2Preview.available) warnings.push('Comparison is based on partial evidence — one or both preview sides are unavailable.');

  // ── Photographer-facing summary (plain language, no internal flags) ────────
  let photographerSummary;
  if (!legacyPreview.available && !v2Preview.available) {
    photographerSummary = 'There is not enough evidence to compare the two previews reliably.';
  } else if (!v2Preview.available) {
    photographerSummary = 'The V2 preview is not ready yet, so there is nothing to compare against the Legacy preview right now. Legacy remains the active production path.';
  } else if (hardStopsCount > 0 || criticalOverstack) {
    photographerSummary = 'The V2 preview currently has unresolved safety concerns, so a confident comparison is not possible yet. Legacy remains the active production path.';
  } else if (similaritySummary.level === 'high' || similaritySummary.level === 'very-high') {
    photographerSummary = 'The Legacy and V2 data comparisons are similar in most areas, but some parts still require manual human review — no rendered image preview is available yet. Legacy remains the active production path.';
  } else {
    photographerSummary = 'The Legacy and V2 data comparisons differ in some areas and still require manual human review before any conclusions are drawn — no rendered image preview is available yet. Legacy remains the active production path.';
  }

  // ── Developer summary ────────────────────────────────────────────────────────
  const developerSummary = [
    `mode=side-by-side-preview-comparison, comparisonState=${comparisonState}, comparisonAvailable=${comparisonAvailable}, canCompareVisually=false (hard-coded — no image-rendering pipeline exists).`,
    `dimensionCoverage=${comparisonDimensions.filter(d => d.available).length}/${comparisonDimensions.length}, evidenceScore=${evidenceQuality.score} (${evidenceQuality.level}), confidence=${confidence}.`,
    `saferSide=${safetyComparison.saferSide}, humanReviewApprovalState=${humanReviewStatus.approvalState}, visualReviewComplete=${humanReviewStatus.visualReviewComplete}.`,
    `blockers=${blockers.length}, warnings=${warnings.length}.`,
    'fallbackStrategy.useLegacyMapping=true, safeMode=true.',
    'Production isolation: this module is not imported by core/lightroom-mapping-engine/index.js, preset-engine, or xmp-validator, and finalStyleIntent.sideBySidePreviewComparisonV2 is not yet attached anywhere (Phase A only).',
  ].join(' ');

  return {
    mode: 'side-by-side-preview-comparison',
    comparisonState,
    comparisonAvailable,
    canRenderLegacyPreview: false, // hard-coded — this codebase has no image-rendering pipeline; data availability (legacyPreview.available) is NOT the same as visual renderability
    canRenderV2Preview: false, // hard-coded — same reason; v2Preview.available means DATA exists, never that a renderable image exists
    canCompareVisually: false, // hard-coded — no image-rendering pipeline exists anywhere in this codebase
    selectedProductionSource: 'legacy', // hard-coded — this module can never select V2 as the production source
    legacyPreview, v2Preview,
    comparisonDimensions, comparisonMatrix,
    similaritySummary, divergenceSummary,
    safetyComparison, riskComparison, evidenceQuality, humanReviewStatus,
    blockers, warnings, reasons, recommendations,
    rollbackPlan: {
      available: true, restoreSource: 'legacy', productionMutationDetected: false,
      steps: [
        'Discard the side-by-side comparison object.',
        'Discard the isolated V2 preview object.',
        'Keep Legacy Lightroom Mapping as the selected production source.',
        'Keep the existing XMP export path unchanged.',
      ],
    },
    fallbackStrategy: {
      useLegacyMapping: true, safeMode: true,
      reason: 'EPIC 2E-G Phase A produces a comparison data model only — production XMP generation continues to use Legacy Mapping exclusively, regardless of this comparison\'s findings.',
    },
    confidence,
    photographerSummary, developerSummary,
    metadata: {
      phase: 'EPIC 2E-G Phase A', integrated: false,
      futureObjectPath: 'finalStyleIntent.sideBySidePreviewComparisonV2',
    },
  };
}
