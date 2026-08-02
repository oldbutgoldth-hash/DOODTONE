/**
 * EPIC 2E-P1A — Single Image Analysis Session Foundation
 *
 * Canonical Session object for the single-image analysis workflow.
 * This module owns identity, status, evidence-shape, and mutation
 * helpers for a Session. It does NOT run analysis itself — see
 * single-image-orchestrator.js for the lifecycle driver, and
 * single-image-session-store.js for the "currently active session"
 * registry.
 *
 * Evidence keys deliberately match this project's real
 * `ui/app.js` `state.last*` field names (minus the `last` prefix,
 * lower-camel), NOT the illustrative names in the P1A spec, because
 * this project's convention (see the lumixa-ai-development skill) is
 * to reuse real, already-established names rather than invent a
 * parallel vocabulary. See P1A_SINGLE_IMAGE_EVIDENCE_CONTRACT.md for
 * the full key-by-key mapping and P1A_SOURCE_LINEAGE_AUDIT.md for how
 * each key was confirmed against the real source.
 */

export const SESSION_STATUS = Object.freeze({
  CREATED: 'CREATED',
  IMAGE_DECODING: 'IMAGE_DECODING',
  IMAGE_READY: 'IMAGE_READY',
  ANALYSIS_QUEUED: 'ANALYSIS_QUEUED',
  ANALYZING: 'ANALYZING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ABORTING: 'ABORTING',
  ABORTED: 'ABORTED',
  RESET: 'RESET',
});

export const MODULE_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CACHE_HIT: 'CACHE_HIT',
  SOFT_FAILED: 'SOFT_FAILED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  ABORTED: 'ABORTED',
  SKIPPED: 'SKIPPED',
});

// The full, real evidence key set the single-image pipeline produces.
// See single-image-analysis-profile.js for which Core module writes
// each key and in what order.
export const EVIDENCE_KEYS = Object.freeze([
  'stats',              // <- state.lastStats (histogram-engine)
  'imageAnalysis',       // <- state.lastImageAnalysis (image-analysis-core, Worker-backed)
  'palette',             // <- state.lastPalette (kmeans-engine)
  'harmony',             // <- state.lastHarmony (color-harmony-engine)
  'skin',                // <- state.lastSkin (skin-classifier + skintone-engine merge)
  'colorCast',           // <- local `castRes` in runAnalysis (color-cast-detector) — no legacy state mirror exists today
  'scene',               // <- local `sceneRes` in runAnalysis (scene-classifier) — no legacy state mirror exists today
  'wb',                  // <- state.lastWB (whitebalance-engine)
  'hsl',                 // <- state.lastHSL (hsl-analyzer-engine)
  'grading',             // <- state.lastGrading (colorgrading-ai-engine)
  'toneCurves',          // <- state.lastToneCurves (tone-curve-ai-engine)
  'calibration',         // <- state.lastCalibration (calibration-engine)
  'styleRecognition',    // <- state.lastStyleRecognition (style-recognition-engine)
  'basic',               // <- state.lastBasic (basic-panel-engine)
  'styleFeatureGraph',   // <- state.lastStyleFeatureGraph (feature-fusion-engine)
  'styleFingerprint',    // <- state.lastStyleFingerprint (style-fingerprint)
  'validationReport',    // <- state.lastValidationReport (xmp-validator)
  'benchmark',           // <- state.lastBenchmark (style-benchmark-engine)
  'decisionReport',      // <- state.lastDecisionReport (decision-report-engine)
  'referenceTransfer',   // <- state.lastReferenceTransfer (reference-transfer-engine)
  'processingLog',       // <- state.lastProcessingLog
]);

let _sessionSeq = 0;
let _generationSeq = 0;

function _nextSessionId() {
  _sessionSeq += 1;
  return `simg-session-${Date.now().toString(36)}-${_sessionSeq}`;
}

export function nextGenerationId() {
  _generationSeq += 1;
  return `simg-gen-${Date.now().toString(36)}-${_generationSeq}`;
}

function _emptyEvidence() {
  const evidence = {};
  for (const key of EVIDENCE_KEYS) evidence[key] = null;
  return evidence;
}

function _emptyImage() {
  return {
    file: null,
    fingerprint: null,
    filename: null,
    mimeType: null,
    fileSize: null,
    lastModified: null,
    width: null,
    height: null,
    aspectRatio: null,
    megapixels: null,
    decodedSource: null,
    analysisProxy: null,
    displaySource: null,
  };
}

/**
 * Create a new canonical Single Image Analysis Session.
 * @param {object} [opts]
 * @param {File}   [opts.file] - the raw uploaded File, if already known.
 * @returns {object} a fresh Session in CREATED status.
 */
export function createSingleImageSession(opts = {}) {
  const generationId = nextGenerationId();
  const session = {
    sessionId: _nextSessionId(),
    generationId,
    workflow: 'SINGLE_IMAGE',
    status: SESSION_STATUS.CREATED,
    image: _emptyImage(),
    timing: {
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      durationMs: null,
    },
    progress: {
      stage: 'CREATED',
      currentModule: null,
      completedModules: 0,
      totalModules: 0,
      percentage: 0,
    },
    evidence: _emptyEvidence(),
    report: null,
    candidate: null,
    // EPIC 2E-P1C: the raw, flat buildFinalPreset() output (already
    // validated/benchmarked by the existing pipeline). `candidate`
    // above is now reserved exclusively for the canonical, nested P1C
    // Candidate built FROM this raw value -- see
    // core/single-image/candidate/candidate-builder.js.
    candidateRaw: null,
    validation: {
      evidenceValid: false,
      candidateValid: false,
      xmpValid: false,
      status: 'NOT_EVALUATED',
      errors: [],
      warnings: [],
    },
    xmp: {
      content: null,
      readback: null,
      filename: null,
      status: 'NOT_GENERATED',
    },
    cache: {
      key: null,
      fingerprint: null,
      profileVersion: null,
      engineVersion: null,
      proxySize: null,
      cacheHit: false,
    },
    runtime: {
      abortController: (typeof AbortController !== 'undefined') ? new AbortController() : null,
      trace: [],
      moduleStates: {},
    },
    errors: [],
    warnings: [],
  };

  if (opts.file) {
    session.image.file = opts.file;
    session.image.filename = opts.file.name ?? null;
    session.image.mimeType = opts.file.type ?? null;
    session.image.fileSize = typeof opts.file.size === 'number' ? opts.file.size : null;
    session.image.lastModified = typeof opts.file.lastModified === 'number' ? opts.file.lastModified : null;
  }

  return session;
}

/**
 * Validate the OUTER contract shape of a Session object.
 * P1A validates the outer contract only — it never re-checks or
 * alters the numeric correctness of any Core module's own output.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateSessionShape(session) {
  const errors = [];
  if (!session || typeof session !== 'object') {
    return { valid: false, errors: ['session is not an object'] };
  }
  const requiredTopKeys = [
    'sessionId', 'generationId', 'workflow', 'status', 'image', 'timing',
    'progress', 'evidence', 'report', 'candidate', 'candidateRaw', 'validation', 'xmp',
    'cache', 'runtime', 'errors', 'warnings',
  ];
  for (const key of requiredTopKeys) {
    if (!(key in session)) errors.push(`missing top-level key: ${key}`);
  }
  if (session.workflow !== 'SINGLE_IMAGE') {
    errors.push(`workflow must be "SINGLE_IMAGE", got ${JSON.stringify(session.workflow)}`);
  }
  if (session.status && !Object.values(SESSION_STATUS).includes(session.status)) {
    errors.push(`unknown status: ${session.status}`);
  }
  if (session.evidence && typeof session.evidence === 'object') {
    for (const key of EVIDENCE_KEYS) {
      if (!(key in session.evidence)) errors.push(`missing evidence key: ${key}`);
    }
  } else {
    errors.push('evidence is not an object');
  }
  if (!Array.isArray(session.errors)) errors.push('errors must be an array');
  if (!Array.isArray(session.warnings)) errors.push('warnings must be an array');
  return { valid: errors.length === 0, errors };
}

export function updateSessionStatus(session, status, extra = {}) {
  if (!Object.values(SESSION_STATUS).includes(status)) {
    throw new Error(`updateSessionStatus: unknown status "${status}"`);
  }
  session.status = status;
  if (status === SESSION_STATUS.ANALYZING && !session.timing.startedAt) {
    session.timing.startedAt = Date.now();
  }
  if ([SESSION_STATUS.COMPLETED, SESSION_STATUS.PARTIAL, SESSION_STATUS.FAILED, SESSION_STATUS.ABORTED].includes(status)) {
    session.timing.completedAt = Date.now();
    session.timing.durationMs = session.timing.startedAt
      ? session.timing.completedAt - session.timing.startedAt
      : null;
  }
  if (extra.stage) session.progress.stage = extra.stage;
  return session;
}

export function appendSessionWarning(session, code, message, context = {}) {
  const entry = { code, message, context, at: Date.now() };
  session.warnings.push(entry);
  return entry;
}

export function appendSessionError(session, code, message, context = {}) {
  const entry = { code, message, context, at: Date.now() };
  session.errors.push(entry);
  return entry;
}

/**
 * Null out mutable Session data (evidence/report/candidate/validation/
 * xmp/progress) while preserving identity fields (sessionId,
 * generationId, workflow) and image identity. Used by RESET flows.
 * This does NOT create a new Session — callers that need a fresh
 * identity should call createSingleImageSession() instead.
 */
export function resetSessionData(session) {
  session.status = SESSION_STATUS.RESET;
  session.evidence = _emptyEvidence();
  session.report = null;
  session.candidate = null;
  session.candidateRaw = null;
  session.validation = {
    evidenceValid: false,
    candidateValid: false,
    xmpValid: false,
    status: 'NOT_EVALUATED',
    errors: [],
    warnings: [],
  };
  session.xmp = { content: null, readback: null, filename: null, status: 'NOT_GENERATED' };
  session.progress = { stage: 'RESET', currentModule: null, completedModules: 0, totalModules: 0, percentage: 0 };
  session.runtime.moduleStates = {};
  return session;
}
