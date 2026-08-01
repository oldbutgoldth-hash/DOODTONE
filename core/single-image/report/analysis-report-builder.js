/**
 * EPIC 2E-P1B — AI Image Analysis Report Builder
 *
 * Builds ONE canonical report from a completed or partial single-image
 * Session's `evidence` (see core/single-image/single-image-session.js).
 * This is the ONLY place P1B reads evidence from — never DOM/slider
 * values, never a freshly re-run Core module, never synthetic sample
 * data. Legacy `state.last*` is read ONLY as a documented fallback
 * when an evidence key is genuinely absent, and every fallback use is
 * recorded (lineage.fallbackUsed=true + a diagnostics warning) — see
 * P1A_LEGACY_COMPATIBILITY_MAP.md / P1A_SINGLE_IMAGE_EVIDENCE_CONTRACT.md
 * for the key mapping this builder relies on.
 */

import { createEmptyReport, validateReportShape, REPORT_STATUS, SECTION_STATUS } from './analysis-report-schema.js';
import { combineConservative } from './confidence-aggregator.js';
import { assembleLineage } from './report-lineage.js';
import {
  classifyExposure, classifyDynamicRange, classifyWhiteBalance, classifyTone,
  classifyColor, classifySkin, classifyScene, buildTechnicalIssues, buildCreativeCharacteristics,
} from './photographer-interpretation-engine.js';
import { SESSION_STATUS, MODULE_STATE } from '../single-image-session.js';

let _reportSeq = 0;
function _nextReportId(sessionId) {
  _reportSeq += 1;
  return `simg-report-${sessionId}-${_reportSeq}-${Date.now().toString(36)}`;
}

/** Legacy `state.last*` key each evidence key maps to (per P1A's contract). Used ONLY as fallback. */
const LEGACY_FALLBACK_KEY = {
  stats: 'lastStats', wb: 'lastWB', skin: 'lastSkin', palette: 'lastPalette',
  harmony: 'lastHarmony', hsl: 'lastHSL',
  // colorCast/scene have no legacy mirror by design (P1A comment in
  // single-image-session.js) -- no fallback key for these; if their
  // evidence entry is missing, the section is genuinely UNAVAILABLE.
};

/**
 * Read one evidence entry's raw `.result`, falling back to
 * `legacyState[LEGACY_FALLBACK_KEY[key]]` ONLY if the evidence entry
 * itself is missing/null AND a legacy mirror exists. Returns
 * {value, fallbackUsed, evidenceStatus}.
 */
function _readEvidence(session, key, legacyState) {
  const entry = session?.evidence?.[key];
  if (entry && entry.result !== null && entry.result !== undefined
      && (entry.status === MODULE_STATE.COMPLETED || entry.status === MODULE_STATE.CACHE_HIT)) {
    return { value: entry.result, fallbackUsed: false, evidenceStatus: entry.status };
  }
  const legacyKey = LEGACY_FALLBACK_KEY[key];
  if (legacyState && legacyKey && legacyState[legacyKey]) {
    return { value: legacyState[legacyKey], fallbackUsed: true, evidenceStatus: 'LEGACY_FALLBACK' };
  }
  return { value: null, fallbackUsed: false, evidenceStatus: entry?.status ?? 'MISSING' };
}

function _sectionStatusForBuild(status, evidenceStatus) {
  if (evidenceStatus === 'MISSING') return SECTION_STATUS.UNAVAILABLE;
  if (evidenceStatus === MODULE_STATE.SOFT_FAILED || evidenceStatus === MODULE_STATE.FAILED
    || evidenceStatus === MODULE_STATE.TIMED_OUT || evidenceStatus === MODULE_STATE.ABORTED) {
    return SECTION_STATUS.UNAVAILABLE;
  }
  return status;
}

/**
 * Build the canonical report from a Session. Pure function: does not
 * mutate `session`, does not call any Core module. `legacyState` is
 * optional and used only for the documented fallback described above.
 * @returns {{report: object, validation: {valid: boolean, errors: string[]}}}
 */
export function buildAnalysisReportFromSession(session, { legacyState = null } = {}) {
  const report = createEmptyReport({
    sessionId: session?.sessionId ?? null,
    generationId: session?.generationId ?? null,
    reportId: _nextReportId(session?.sessionId ?? 'unknown'),
  });
  report.createdAt = Date.now();
  report.reportBuildCount = (session?.report?.reportBuildCount ?? 0) + 1;

  const sessionStatus = session?.status ?? null;
  const isTerminalUsable = sessionStatus === SESSION_STATUS.COMPLETED || sessionStatus === SESSION_STATUS.PARTIAL;
  if (!isTerminalUsable) {
    report.status = REPORT_STATUS.WAITING_FOR_ANALYSIS;
    report.diagnostics.sourceSessionStatus = sessionStatus;
    return { report, validation: validateReportShape(report) };
  }

  // ── Image metadata (from Session.image, never DOM) ──────────────────
  if (session.image) {
    report.image = {
      filename: session.image.filename ?? null,
      width: session.image.width ?? null,
      height: session.image.height ?? null,
      aspectRatio: session.image.aspectRatio ?? null,
      megapixels: session.image.megapixels ?? null,
      mimeType: session.image.mimeType ?? null,
      fileSize: session.image.fileSize ?? null,
    };
  }

  // ── Read raw evidence (with documented legacy fallback) ─────────────
  const statsR = _readEvidence(session, 'stats', legacyState);
  const wbR = _readEvidence(session, 'wb', legacyState);
  const skinR = _readEvidence(session, 'skin', legacyState);
  const paletteR = _readEvidence(session, 'palette', legacyState);
  const harmonyR = _readEvidence(session, 'harmony', legacyState);
  const hslR = _readEvidence(session, 'hsl', legacyState);
  const colorCastR = _readEvidence(session, 'colorCast', legacyState);
  const sceneR = _readEvidence(session, 'scene', legacyState);

  const stats = statsR.value, wb = wbR.value, skin = skinR.value, palette = paletteR.value;
  const harmony = harmonyR.value, hsl = hslR.value, colorCast = colorCastR.value, scene = sceneR.value;

  const sceneCategory = scene?.category ?? stats?.category ?? null;

  // ── Sections ──────────────────────────────────────────────────────
  const exposureSection = classifyExposure({ stats, sceneCategory });
  exposureSection.status = _sectionStatusForBuild(exposureSection.status, statsR.evidenceStatus);

  const dynamicRangeSection = classifyDynamicRange({ stats });
  dynamicRangeSection.status = _sectionStatusForBuild(dynamicRangeSection.status, statsR.evidenceStatus);

  const whiteBalanceSection = classifyWhiteBalance({ wb, colorCast });
  whiteBalanceSection.status = _sectionStatusForBuild(whiteBalanceSection.status, wbR.evidenceStatus);

  const toneSection = classifyTone({ stats });
  toneSection.status = _sectionStatusForBuild(toneSection.status, statsR.evidenceStatus);

  const colorSection = classifyColor({ stats, palette, harmony, hsl, colorCast });
  const colorEvidenceStatus = [paletteR, harmonyR, hslR].some((r) => r.evidenceStatus !== 'MISSING') ? statsR.evidenceStatus : 'MISSING';
  colorSection.status = _sectionStatusForBuild(colorSection.status, colorEvidenceStatus === 'MISSING' && !stats ? 'MISSING' : (statsR.evidenceStatus === 'MISSING' ? colorEvidenceStatus : statsR.evidenceStatus));

  const skinSection = classifySkin({ skin });
  skinSection.status = skin ? _sectionStatusForBuild(skinSection.status, skinR.evidenceStatus) : SECTION_STATUS.UNAVAILABLE;

  const sceneSection = classifyScene({ scene, stats });

  report.exposure = exposureSection;
  report.dynamicRange = dynamicRangeSection;
  report.whiteBalance = whiteBalanceSection;
  report.tone = toneSection;
  report.color = colorSection;
  report.skin = skinSection;
  report.scene = sceneSection;

  // ── Technical issues (only when evidence supports them) ─────────────
  report.technicalIssues = buildTechnicalIssues({ stats, wb, colorCast, skin });

  // ── Creative characteristics ──────────────────────────────────────
  report.creativeCharacteristics = buildCreativeCharacteristics({
    exposureSection, colorSection, wbSection: whiteBalanceSection,
  });

  // ── Recommended corrections (aggregated from section recommendations) ─
  report.recommendedCorrections = {
    technical: [
      ...exposureSection.recommendations, ...dynamicRangeSection.recommendations,
      ...toneSection.recommendations, ...colorSection.recommendations,
    ],
    creative: whiteBalanceSection.observations.filter((o) => o.code === 'whiteBalance.creativeMoodPreserved'),
    safety: [...whiteBalanceSection.recommendations, ...skinSection.recommendations],
  };

  // ── Safety warnings (aggregated) ───────────────────────────────────
  report.safetyWarnings = [
    ...exposureSection.warnings, ...dynamicRangeSection.warnings, ...whiteBalanceSection.warnings,
    ...toneSection.warnings, ...colorSection.warnings, ...skinSection.warnings, ...sceneSection.warnings,
  ];

  // ── Summary ────────────────────────────────────────────────────────
  const sectionConfidences = [
    exposureSection.confidence.score, dynamicRangeSection.confidence.score,
    whiteBalanceSection.confidence.score, toneSection.confidence.score,
    colorSection.confidence.score, sceneSection.confidence.score,
  ];
  const overallConfidence = combineConservative(sectionConfidences);
  const qualityFlags = report.technicalIssues.filter((i) => i.severity === 'WARNING' || i.severity === 'CRITICAL').map((i) => i.code);
  report.summary = {
    overallClassification: sceneCategory,
    shortDescriptionCode: 'summary.shortDescription',
    shortDescriptionParams: {
      exposure: exposureSection.exposureClassification ?? 'unknown',
      scene: sceneCategory ?? 'unknown',
    },
    overallConfidence,
    qualityFlags,
    primaryRecommendations: report.recommendedCorrections.technical.slice(0, 3),
  };

  // ── Lineage ────────────────────────────────────────────────────────
  report.lineage = assembleLineage({
    exposure: { evidenceKeys: ['stats'], sourceModules: ['core/histogram-engine'], fallbackUsed: statsR.fallbackUsed, confidenceInputs: [stats?.confidence] },
    dynamicRange: { evidenceKeys: ['stats'], sourceModules: ['core/histogram-engine'], fallbackUsed: statsR.fallbackUsed, confidenceInputs: [stats?.confidence] },
    whiteBalance: { evidenceKeys: ['wb', 'colorCast'], sourceModules: ['core/whitebalance-engine', 'core/color-cast-detector'], fallbackUsed: wbR.fallbackUsed || colorCastR.fallbackUsed, confidenceInputs: [wb?.confidence, colorCast?.confidence] },
    tone: { evidenceKeys: ['stats'], sourceModules: ['core/histogram-engine'], fallbackUsed: statsR.fallbackUsed, confidenceInputs: [stats?.confidence] },
    color: { evidenceKeys: ['stats', 'palette', 'harmony', 'hsl', 'colorCast'], sourceModules: ['core/kmeans-engine', 'core/color-harmony-engine', 'core/hsl-analyzer-engine'], fallbackUsed: paletteR.fallbackUsed || harmonyR.fallbackUsed || hslR.fallbackUsed, confidenceInputs: [palette?.confidence, harmony?.confidence, hsl?.confidence] },
    skin: { evidenceKeys: ['skin'], sourceModules: ['core/skintone-engine', 'core/skin-classifier'], fallbackUsed: skinR.fallbackUsed, confidenceInputs: [skin?.confidence] },
    scene: { evidenceKeys: ['scene', 'stats'], sourceModules: ['core/scene-classifier'], fallbackUsed: sceneR.fallbackUsed, confidenceInputs: [scene?.confidence] },
  });

  // ── Diagnostics ─────────────────────────────────────────────────────
  const evidenceEntries = session.evidence ?? {};
  const completedEvidence = [];
  const unavailableEvidence = [];
  const softFailedModules = [];
  for (const [key, entry] of Object.entries(evidenceEntries)) {
    if (!entry) { unavailableEvidence.push(key); continue; }
    if (entry.status === MODULE_STATE.COMPLETED || entry.status === MODULE_STATE.CACHE_HIT) completedEvidence.push(key);
    else if (entry.status === MODULE_STATE.SOFT_FAILED || entry.status === MODULE_STATE.FAILED || entry.status === MODULE_STATE.TIMED_OUT || entry.status === MODULE_STATE.ABORTED) {
      unavailableEvidence.push(key); softFailedModules.push(key);
    } else {
      unavailableEvidence.push(key);
    }
  }
  report.diagnostics = { completedEvidence, unavailableEvidence, softFailedModules, sourceSessionStatus: sessionStatus };

  // ── Overall report status ───────────────────────────────────────────
  report.status = sessionStatus === SESSION_STATUS.PARTIAL ? REPORT_STATUS.PARTIAL : REPORT_STATUS.COMPLETE;

  const validation = validateReportShape(report);
  if (!validation.valid) {
    report.status = REPORT_STATUS.FAILED;
  }
  return { report, validation };
}
