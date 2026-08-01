/**
 * EPIC 2E-P1A — Evidence Normalizer
 *
 * Wraps each Core module's raw output in a stable outer contract
 * before it is committed to Session.evidence. Never inspects or
 * alters the actual numerical result — this file has zero knowledge
 * of what any engine's numbers mean.
 */

import { MODULE_STATE } from './single-image-session.js';

/**
 * @param {string} moduleId
 * @param {object} opts
 * @param {string} opts.status        - one of MODULE_STATE
 * @param {*}      [opts.result]      - the raw, untouched Core output
 * @param {number} [opts.confidence]  - 0 when result is null/unavailable
 * @param {object} [opts.diagnostics]
 * @param {string[]} [opts.warnings]
 * @param {object[]} [opts.errors]
 * @param {string}  [opts.sourceModule]
 * @param {number}  [opts.startedAt]
 * @param {number}  [opts.completedAt]
 * @returns {object} normalized evidence entry
 */
export function normalizeEvidence(moduleId, opts = {}) {
  const {
    status,
    result = null,
    confidence,
    diagnostics = {},
    warnings = [],
    errors = [],
    sourceModule = moduleId,
    startedAt = null,
    completedAt = null,
  } = opts;

  if (!Object.values(MODULE_STATE).includes(status)) {
    throw new Error(`normalizeEvidence(${moduleId}): unknown status "${status}"`);
  }

  const isUnavailable = result === null || result === undefined
    || status === MODULE_STATE.SOFT_FAILED
    || status === MODULE_STATE.FAILED
    || status === MODULE_STATE.TIMED_OUT
    || status === MODULE_STATE.ABORTED
    || status === MODULE_STATE.SKIPPED;

  return {
    status,
    result: (result === undefined) ? null : result,
    confidence: isUnavailable ? 0 : (typeof confidence === 'number' ? confidence : 1),
    diagnostics,
    warnings: Array.isArray(warnings) ? warnings : [warnings].filter(Boolean),
    errors: Array.isArray(errors) ? errors : [errors].filter(Boolean),
    sourceModule,
    startedAt,
    completedAt,
    durationMs: (startedAt != null && completedAt != null) ? (completedAt - startedAt) : null,
  };
}

/** A SKIPPED evidence entry, used for modules never reached this run. */
export function createEmptyEvidenceEntry(moduleId, reason = 'Module was not executed this Session.') {
  return normalizeEvidence(moduleId, {
    status: MODULE_STATE.SKIPPED,
    result: null,
    confidence: 0,
    warnings: [reason],
    sourceModule: moduleId,
  });
}

/**
 * Build a normalized evidence entry from a settled Promise.allSettled()
 * result — the exact shape `runAnalysis()` already produces internally
 * for its parallel groups. Never invents a value on rejection.
 */
export function normalizeFromSettled(moduleId, settledResult, opts = {}) {
  const startedAt = opts.startedAt ?? null;
  const completedAt = opts.completedAt ?? Date.now();
  if (settledResult.status === 'fulfilled') {
    return normalizeEvidence(moduleId, {
      status: MODULE_STATE.COMPLETED,
      result: settledResult.value,
      confidence: opts.confidence,
      diagnostics: opts.diagnostics,
      sourceModule: opts.sourceModule ?? moduleId,
      startedAt,
      completedAt,
    });
  }
  const isRequired = !!opts.required;
  return normalizeEvidence(moduleId, {
    status: isRequired ? MODULE_STATE.FAILED : MODULE_STATE.SOFT_FAILED,
    result: null,
    confidence: 0,
    warnings: isRequired ? [] : [`${moduleId} failed and was soft-failed (optional module): ${settledResult.reason?.message ?? settledResult.reason}`],
    errors: isRequired ? [{ code: 'MODULE_FAILED', message: String(settledResult.reason?.message ?? settledResult.reason) }] : [],
    sourceModule: opts.sourceModule ?? moduleId,
    startedAt,
    completedAt,
  });
}
