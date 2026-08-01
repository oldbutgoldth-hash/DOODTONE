/**
 * EPIC 2E-P1B — AI Image Analysis Report Schema
 *
 * Defines the canonical, stable report contract every single-image
 * Session's report must conform to, plus a safe-empty constructor and
 * a strict validator. This module contains NO analysis/interpretation
 * logic — see analysis-report-builder.js for that. It never invents a
 * value; every numeric field here defaults to `null`, not 0, so a
 * downstream renderer can tell "genuinely zero" apart from "unknown".
 */

export const REPORT_SCHEMA_VERSION = 'P1B_REPORT@1';

export const REPORT_STATUS = Object.freeze({
  WAITING_FOR_ANALYSIS: 'WAITING_FOR_ANALYSIS',
  BUILDING: 'BUILDING',
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  STALE: 'STALE',
});

export const SECTION_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  UNAVAILABLE: 'UNAVAILABLE',
  FAILED: 'FAILED',
});

export const CONFIDENCE_LEVEL = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const ISSUE_SEVERITY = Object.freeze({
  INFO: 'INFO',
  CAUTION: 'CAUTION',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});

/** Section IDs that carry the common {status, confidence, observations,
 * recommendations, warnings} shape (i.e. everything except `summary`,
 * which has its own, simpler shape, and `image`, which is metadata). */
export const ANALYSIS_SECTION_IDS = Object.freeze([
  'exposure', 'dynamicRange', 'whiteBalance', 'tone', 'color', 'skin', 'scene',
]);

const REQUIRED_TOP_KEYS = Object.freeze([
  'reportId', 'sessionId', 'generationId', 'schemaVersion', 'status', 'createdAt',
  'image', 'summary', 'exposure', 'dynamicRange', 'whiteBalance', 'tone', 'color',
  'skin', 'scene', 'technicalIssues', 'creativeCharacteristics',
  'recommendedCorrections', 'safetyWarnings', 'lineage', 'diagnostics',
  'reportBuildCount',
]);

function _emptyConfidence() {
  return { score: null, level: CONFIDENCE_LEVEL.UNAVAILABLE };
}

/** Common shape shared by exposure/dynamicRange/whiteBalance/tone/color/skin/scene. */
function _emptyAnalysisSection(extra = {}) {
  return {
    status: SECTION_STATUS.UNAVAILABLE,
    confidence: _emptyConfidence(),
    observations: [],
    recommendations: [],
    warnings: [],
    ...extra,
  };
}

export function createEmptySection(extra = {}) {
  return _emptyAnalysisSection(extra);
}

export function createEmptyReport({ sessionId = null, generationId = null, reportId = null } = {}) {
  return {
    reportId,
    sessionId,
    generationId,
    schemaVersion: REPORT_SCHEMA_VERSION,
    status: REPORT_STATUS.WAITING_FOR_ANALYSIS,
    createdAt: null,
    reportBuildCount: 0,
    image: {
      filename: null, width: null, height: null, aspectRatio: null,
      megapixels: null, mimeType: null, fileSize: null,
    },
    summary: {
      overallClassification: null,
      shortDescriptionCode: null,
      shortDescriptionParams: null,
      overallConfidence: _emptyConfidence(),
      qualityFlags: [],
      primaryRecommendations: [],
    },
    exposure: _emptyAnalysisSection({
      exposureClassification: null, meanLuminance: null,
      clippedHighlightsPercent: null, crushedShadowsPercent: null,
      exposureBalance: null,
    }),
    dynamicRange: _emptyAnalysisSection({
      classification: null, score: null, shadowHeadroom: null, highlightHeadroom: null,
    }),
    whiteBalance: _emptyAnalysisSection({
      temperatureDirection: null, tintDirection: null, neutralConfidence: _emptyConfidence(),
      dominantColorBias: null, illuminantConfidence: _emptyConfidence(),
    }),
    tone: _emptyAnalysisSection({
      blackPoint: null, shadows: null, midtones: null, highlights: null,
      whitePoint: null, contrastProfile: null,
    }),
    color: _emptyAnalysisSection({
      dominantColors: [], saturationProfile: null, harmony: null,
      channelPresence: [], colorCast: null,
    }),
    skin: _emptyAnalysisSection({
      detected: null, percentage: null, hueRange: null, luminanceRange: null,
      protectionRecommended: null,
    }),
    scene: _emptyAnalysisSection({
      primaryType: null, typeHints: [], lightingHints: [], environmentHints: [],
    }),
    technicalIssues: [],
    creativeCharacteristics: [],
    recommendedCorrections: { technical: [], creative: [], safety: [] },
    safetyWarnings: [],
    lineage: {},
    diagnostics: {
      completedEvidence: [],
      unavailableEvidence: [],
      softFailedModules: [],
      sourceSessionStatus: null,
    },
  };
}

function _isSafeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Recursively walk a plain-JSON-serializable structure, failing on
 * undefined/NaN/Infinity/functions/circular refs. Never throws — returns
 * a list of error strings (empty = clean). */
function _walkForUnsafeValues(value, path, errors, seen) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'undefined') { errors.push(`undefined value at ${path}`); return; }
  if (t === 'function') { errors.push(`function value at ${path} (not serializable)`); return; }
  if (t === 'number' && !Number.isFinite(value)) { errors.push(`non-finite number (NaN/Infinity) at ${path}`); return; }
  if (t === 'object') {
    // `seen` models the current ANCESTOR PATH (a recursion stack), not
    // "visited anywhere" — the same plain object (e.g. a shared
    // {score,level} confidence object referenced from two different
    // report branches) is common and NOT circular; only a true cycle
    // back to one of its own ancestors is an error. The entry is
    // removed again after this node's children finish, so sibling
    // branches sharing a reference never false-positive.
    if (seen.has(value)) { errors.push(`circular reference at ${path}`); return; }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => _walkForUnsafeValues(v, `${path}[${i}]`, errors, seen));
    } else {
      for (const k of Object.keys(value)) {
        _walkForUnsafeValues(value[k], `${path}.${k}`, errors, seen);
      }
    }
    seen.delete(value);
  }
}

function _validateConfidence(conf, path, errors) {
  if (!conf || typeof conf !== 'object') { errors.push(`${path} is not an object`); return; }
  if (conf.score !== null && !( _isSafeNumber(conf.score) && conf.score >= 0 && conf.score <= 100)) {
    errors.push(`${path}.score must be null or a number within 0-100, got ${JSON.stringify(conf.score)}`);
  }
  if (!Object.values(CONFIDENCE_LEVEL).includes(conf.level)) {
    errors.push(`${path}.level invalid: ${JSON.stringify(conf.level)}`);
  }
}

function _validateAnalysisSection(section, sectionId, errors) {
  if (!section || typeof section !== 'object') { errors.push(`section "${sectionId}" is not an object`); return; }
  if (!Object.values(SECTION_STATUS).includes(section.status)) {
    errors.push(`section "${sectionId}".status invalid: ${JSON.stringify(section.status)}`);
  }
  _validateConfidence(section.confidence, `${sectionId}.confidence`, errors);
  for (const arrKey of ['observations', 'recommendations', 'warnings']) {
    if (!Array.isArray(section[arrKey])) errors.push(`section "${sectionId}".${arrKey} must be an array`);
  }
}

/**
 * Validate the OUTER report contract. Never mutates. Returns
 * {valid, errors}. A failing report must be marked FAILED by the
 * caller (analysis-report-builder.js / orchestrator), never partially
 * rendered.
 */
export function validateReportShape(report) {
  const errors = [];
  if (!report || typeof report !== 'object') return { valid: false, errors: ['report is not an object'] };

  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in report)) errors.push(`missing top-level key: ${key}`);
  }
  if (typeof report.reportId !== 'string' || !report.reportId) errors.push('reportId must be a non-empty string');
  if (typeof report.sessionId !== 'string' || !report.sessionId) errors.push('sessionId must be a non-empty string');
  if (typeof report.generationId !== 'string' || !report.generationId) errors.push('generationId must be a non-empty string');
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push(`schemaVersion must be "${REPORT_SCHEMA_VERSION}", got ${JSON.stringify(report.schemaVersion)}`);
  if (!Object.values(REPORT_STATUS).includes(report.status)) errors.push(`status invalid: ${JSON.stringify(report.status)}`);
  if (!_isSafeNumber(report.reportBuildCount) || report.reportBuildCount < 0) errors.push('reportBuildCount must be a non-negative finite number');

  if (report.summary && typeof report.summary === 'object') {
    _validateConfidence(report.summary.overallConfidence, 'summary.overallConfidence', errors);
    if (!Array.isArray(report.summary.qualityFlags)) errors.push('summary.qualityFlags must be an array');
    if (!Array.isArray(report.summary.primaryRecommendations)) errors.push('summary.primaryRecommendations must be an array');
  } else {
    errors.push('summary is not an object');
  }

  for (const sectionId of ANALYSIS_SECTION_IDS) {
    _validateAnalysisSection(report[sectionId], sectionId, errors);
  }

  if (!Array.isArray(report.technicalIssues)) errors.push('technicalIssues must be an array');
  else report.technicalIssues.forEach((issue, i) => {
    if (!issue || typeof issue !== 'object') { errors.push(`technicalIssues[${i}] is not an object`); return; }
    if (!Object.values(ISSUE_SEVERITY).includes(issue.severity)) errors.push(`technicalIssues[${i}].severity invalid: ${JSON.stringify(issue.severity)}`);
    if (typeof issue.code !== 'string' || !issue.code) errors.push(`technicalIssues[${i}].code must be a non-empty string`);
    if (!Array.isArray(issue.sourceEvidence)) errors.push(`technicalIssues[${i}].sourceEvidence must be an array`);
  });

  if (!Array.isArray(report.creativeCharacteristics)) errors.push('creativeCharacteristics must be an array');
  if (!Array.isArray(report.safetyWarnings)) errors.push('safetyWarnings must be an array');

  if (report.recommendedCorrections && typeof report.recommendedCorrections === 'object') {
    for (const k of ['technical', 'creative', 'safety']) {
      if (!Array.isArray(report.recommendedCorrections[k])) errors.push(`recommendedCorrections.${k} must be an array`);
    }
  } else {
    errors.push('recommendedCorrections is not an object');
  }

  if (!report.lineage || typeof report.lineage !== 'object' || Array.isArray(report.lineage)) {
    errors.push('lineage must be an object');
  }

  if (!report.diagnostics || typeof report.diagnostics !== 'object') {
    errors.push('diagnostics is not an object');
  } else {
    for (const k of ['completedEvidence', 'unavailableEvidence', 'softFailedModules']) {
      if (!Array.isArray(report.diagnostics[k])) errors.push(`diagnostics.${k} must be an array`);
    }
  }

  // Whole-tree scan for undefined/NaN/Infinity/functions/circular refs —
  // catches anything a section-specific check above didn't already flag.
  _walkForUnsafeValues(report, 'report', errors, new WeakSet());

  return { valid: errors.length === 0, errors };
}
