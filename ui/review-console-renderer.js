/**
 * ui/review-console-renderer.js
 *
 * Controlled Preview Review Console (EPIC 2E-F Phase C-A,
 * patched EPIC 2E-F-C-A-F/F2 — Honesty and Resilience Patches,
 * upgraded EPIC 2E-F Phase C-B — Interactive Checklist Controls).
 *
 * Renders the Preview Sandbox / Human Review state and, as of Phase
 * C-B, the interactive controls that let a user Pass/Fail/Request
 * Adjustment/Return-to-Pending each review item, edit a reviewer note,
 * and Reset the whole Review State. This module NEVER:
 * - re-runs image analysis, K-Means, or any analysis pipeline stage
 * - calls decision-engine, lightroom-mapping-engine, preset-engine, or
 *   xmp-validator
 * - writes to production XMP or Lightroom Mapping in any way
 * - computes approval, progress, or ANY derived Review State field
 *   itself — every value shown is read directly from the `reviewState`
 *   object already computed by the Review State Engine
 *   (mapping-v2-preview-review-state.js); state MUTATION in response to
 *   a click/note-edit is entirely the responsibility of
 *   `ui/review-console-controller.js`, which calls that same engine's
 *   `updatePreviewReviewItemV2`/`resetPreviewReviewStateV2` and passes
 *   the ENGINE'S returned new state back in for re-render. This file
 *   itself never imports or calls those engine functions.
 * - enables Preview Export, Production Write, or Production Mapping
 *   activation from any control — approval remains purely informational
 * - persists anything to localStorage or any other storage
 *
 * This module performs ZERO mutation of its own `sandbox`/`reviewState`
 * inputs — it only ever reads them and renders DOM content (including
 * the interactive controls, whose event WIRING lives entirely in the
 * controller, not here — this file only marks elements with
 * `data-review-action`/`data-review-item-id`/`data-review-note`
 * attributes for the controller's event delegation to find).
 *
 * XSS SAFETY: every piece of text that ultimately originates from
 * upstream analysis/review data (reviewer notes, blocker/warning
 * strings, evidence values, IDs, labels) is inserted via `textContent`,
 * `document.createElement`, or a form element's `.value` property,
 * never via `innerHTML` string interpolation. Clearing the container
 * uses `replaceChildren()` (falling back to `innerHTML = ''` only if
 * unsupported). The only literal HTML strings in this file are
 * hardcoded, static markup with no interpolated dynamic values.
 *
 * HONESTY: this module never asserts a safety guarantee (e.g. "export
 * remains disabled") more confidently than the underlying data
 * actually supports. Every confirmation line distinguishes CONFIRMED
 * (the field explicitly holds the expected value), ANOMALY (the field
 * explicitly holds an unexpected value — flagged, never silently
 * hidden or misreported), and UNKNOWN (the field is missing/unreadable
 * — never assumed to be safe by default).
 *
 * RESILIENCE / MALFORMED-DATA SAFETY: every value read from `sandbox`/
 * `reviewState` is treated as UNTRUSTED — wrong types, missing fields,
 * null entries inside arrays, non-finite numbers, and circular
 * references are all handled without throwing. The top-level render is
 * additionally wrapped in a try/catch so that no combination of
 * malformed upstream data can ever throw an uncaught exception out of
 * this module; on any unexpected failure it clears whatever partial
 * content exists and shows a neutral, honest fallback message instead.
 */

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase B/J:
// user-facing text now sourced from the centralized ui/i18n module.
// STATUS_LABEL/DECISION_LABEL below remain as the ENGLISH-only
// canonical code->label maps (used for internal validity checks via
// `ALLOWED_STATUSES`/`ALLOWED_DECISIONS` and as the safe English
// fallback) -- actual on-screen text is looked up via `t()` using the
// same status/decision code, translated at the render boundary.
import { t } from './i18n/index.js';
import {
  presentReviewItemField, presentUnknownReviewItemNote, isCanonicalReviewItemId,
  presentRiskLevel, presentReviewSummaryState,
  presentReviewBlockerCode, presentReviewWarningCode, presentReviewGuidanceCode,
} from './i18n/domain-presenters.js';

const STATUS_COLOR = { passed: 'var(--success)', failed: 'var(--danger)', pending: 'var(--text-faint)', unavailable: 'var(--text-faint)', 'not-required': 'var(--text-faint)' };
const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', pending: 'Pending', unavailable: 'Unavailable', 'not-required': 'Not required' };
const ALLOWED_STATUSES = new Set(Object.keys(STATUS_LABEL));
const STATUS_I18N_KEY = { passed: 'review.statusLabel.passed', failed: 'review.statusLabel.failed', pending: 'review.statusLabel.pending', unavailable: 'review.statusLabel.unavailable', 'not-required': 'review.statusLabel.notRequired' };
const DECISION_I18N_KEY = { approve: 'review.decisionLabel.approve', reject: 'review.decisionLabel.reject', 'needs-adjustment': 'review.decisionLabel.needsAdjustment', undecided: 'review.decisionLabel.undecided' };
function _trStatus(statusKey, lang) { return t(STATUS_I18N_KEY[statusKey] ?? 'review.statusLabel.unavailable', null, lang) || STATUS_LABEL[statusKey]; }
function _trDecision(decisionKey, lang) { return t(DECISION_I18N_KEY[decisionKey] ?? 'review.decisionLabel.undecided', null, lang) || DECISION_LABEL[decisionKey]; }

const DECISION_LABEL = { approve: 'Approve', reject: 'Reject', 'needs-adjustment': 'Needs adjustment', undecided: 'Undecided' };
const DECISION_COLOR = { approve: 'var(--success)', reject: 'var(--danger)', 'needs-adjustment': 'var(--warn)', undecided: 'var(--text-faint)' };
const ALLOWED_DECISIONS = new Set(Object.keys(DECISION_LABEL));

const APPROVAL_COLOR = { approved: 'var(--success)', rejected: 'var(--danger)', blocked: 'var(--danger)', 'needs-adjustment': 'var(--warn)', 'in-progress': 'var(--accent)', 'not-started': 'var(--text-faint)', unavailable: 'var(--text-faint)' };

// CONTROLLED V2 VISUAL TRANSLATION R1 — Phase G2: the Review
// Checklist is grouped into three sections. The four system-verified
// items (group: 'system-integrity'/'safety-guarantees') are rendered
// read-only — no Pass/Fail/Adjust controls, no note field — since a
// manual click can never change them (see
// core/lightroom-mapping-engine/mapping-v2-preview-review-state.js's
// SYSTEM_VERIFIED_IDS / _evaluateSystemVerifiedAutoStatus). The one
// group genuinely requiring human judgment is 'visual-inspection'.
const GROUP_ORDER = ['visual-inspection', 'system-integrity', 'safety-guarantees'];
// FULL-SYSTEM I18N COMPLETION R2 -- Phase J: the previous local
// { en, th } label maps have been removed. Group labels are now stable
// CODES resolved through the centralized dictionary at render time.
const GROUP_I18N_KEY = {
  'visual-inspection': 'review.groupLabel.visualInspection',
  'system-integrity': 'review.groupLabel.systemIntegrity',
  'safety-guarantees': 'review.groupLabel.safetyGuarantees',
};
const GROUP_FALLBACK_I18N_KEY = 'review.groupLabel.other';

/** Bilingual text lookup — `lang` other than 'th' always falls back to English (never a blank string). */
function _t(dict, lang) {
  if (!dict || typeof dict !== 'object') return '';
  const l = lang === 'th' ? 'th' : 'en';
  return typeof dict[l] === 'string' ? dict[l] : (typeof dict.en === 'string' ? dict.en : '');
}

// Risk levels normalize to exactly these 5 — "unknown" must never be
// treated or colored as "low". "none" is accepted as an upstream
// synonym for "low" (it genuinely means equal-or-less risk than low,
// never more) since the data model sometimes uses it for over-stack
// severity; everything else unrecognized becomes "unknown".
const RISK_SYNONYMS = { none: 'low', low: 'low', medium: 'medium', med: 'medium', high: 'high', critical: 'critical' };
const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', unknown: 'Unknown' };
const RISK_COLOR = { low: 'var(--success)', medium: 'var(--warn)', high: 'var(--danger)', critical: 'var(--danger)', unknown: 'var(--text-faint)' };

/** True for plain, non-null, non-array objects — the only shape we treat as a "record" to read named fields from. */
// FULL-SYSTEM I18N COMPLETION R2 -- Phase E: `_safeText` is a deep,
// widely-called helper whose "(unrepresentable value)" fallback is
// photographer-facing. The ACTIVE RENDER LOCALE is recorded here at the
// start of each render pass and read back only for that fallback --
// presentation state only, reset on every render, never business logic.
let _unrepresentableLang = 'en';

function _isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Safely converts an arbitrary, possibly-malformed value into short
 * display text. Never throws (guards circular references), never
 * produces the unhelpful default `"[object Object]"` for plain
 * objects/arrays (uses JSON.stringify instead, itself guarded).
 */
function _safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' && json.length ? json : fallback;
  } catch {
    // Circular reference or other non-serializable value.
    return t('review.console.unrepresentableValue', null, _unrepresentableLang);
  }
}

function _normalizeStatus(value) {
  return (typeof value === 'string' && ALLOWED_STATUSES.has(value)) ? value : 'unavailable';
}
function _normalizeDecision(value) {
  return (typeof value === 'string' && ALLOWED_DECISIONS.has(value)) ? value : 'undecided';
}
function _normalizeRiskLevel(value) {
  if (typeof value === 'string') {
    const key = RISK_SYNONYMS[value.toLowerCase()];
    if (key) return key;
  }
  return 'unknown';
}

/**
 * Evaluates whether the current Sandbox's `simulatedPreviewPreset`
 * explicitly proves this preview is non-production — never assumed
 * true by default. Checks three canonical fields (mode,
 * appliedToProduction, productionSafe); if ANY of them explicitly
 * contradicts non-production (mode is a different string,
 * appliedToProduction===true, or productionSafe===true), the result is
 * 'anomaly' regardless of any other field that might look safe —
 * erring on the side of caution rather than letting one good signal
 * paper over one bad one. Returns 'unknown' when no relevant field is
 * present/readable at all.
 */
/**
 * FULL-SYSTEM I18N COMPLETION R2 -- Phase D: the ONE canonical, bounded
 * system-evidence projection used by every evidence line this console
 * renders.
 *
 * The defect this fixes: the XMP line previously read a separate,
 * frequently-absent `metadata.xmpExportUnchanged` hint, so the console
 * could simultaneously show "Export path unchanged: Passed" (from the
 * system-verified Review item) and "XMP Export: Unknown / Not
 * confirmed." (from the missing hint) -- an internally contradictory
 * screen.
 *
 * `xmpExportPathUnchanged` is now derived from THE SAME evidence as the
 * canonical `export-path-unchanged` system Review item, so the two can
 * never disagree. It is deliberately NOT inferred from
 * `canExportPreview === false` or `appliedToProduction === false`:
 * those are different guarantees, and treating them as XMP evidence
 * would be exactly the kind of over-claiming this console forbids.
 *
 * Every field is strictly tri-state: true (explicitly verified),
 * false (explicit anomaly), or null (no sufficient evidence -- never
 * assumed safe).
 */
function _reviewItemStatusById(reviewRecord, itemId) {
  // Every read below is individually guarded: `reviewItems` is an
  // untrusted external boundary and may be a hostile Proxy, may expose
  // throwing getters, or may not be a real array at all.
  let items;
  try { items = Array.isArray(reviewRecord?.reviewItems) ? reviewRecord.reviewItems : []; } catch { return null; }
  let length;
  try { length = items.length; } catch { return null; }
  if (!Number.isFinite(length) || length <= 0) return null;
  const bound = Math.min(Math.floor(length), 32);
  for (let i = 0; i < bound; i++) {
    let raw;
    try { raw = items[i]; } catch { continue; }
    if (!_isRecord(raw)) continue;
    let id;
    try { id = raw.id; } catch { continue; }
    if (id !== itemId) continue;
    try { return _normalizeStatus(raw.status); } catch { return null; }
  }
  return null;
}

function _triFromItemStatus(status) {
  if (status === 'passed') return true;
  if (status === 'failed') return false;
  return null; // pending / unavailable / not-required / missing -> no claim
}

export function buildReviewSystemEvidence(sandboxRecord, reviewRecord) {
  let sb = null;
  try { sb = _isRecord(sandboxRecord) ? sandboxRecord : null; } catch { sb = null; }
  // Safe single read of one sandbox flag -- a throwing getter degrades
  // to "no evidence" (null), never to a false safety claim and never
  // to an exception escaping into the render path.
  const readFlag = (key) => { try { const v = sb ? sb[key] : undefined; return typeof v === 'boolean' ? v : null; } catch { return null; } };
  const readStr = (key) => { try { const v = sb ? sb[key] : undefined; return typeof v === 'string' ? v : null; } catch { return null; } };

  const exportPathItemStatus = _reviewItemStatusById(reviewRecord, 'export-path-unchanged');
  const exportPathUnchanged = _triFromItemStatus(exportPathItemStatus);

  return {
    legacyOutputPreserved: _triFromItemStatus(_reviewItemStatusById(reviewRecord, 'legacy-output-preserved')),
    rollbackAvailable: _triFromItemStatus(_reviewItemStatusById(reviewRecord, 'rollback-confirmed')),
    previewNonProduction: _triFromItemStatus(_reviewItemStatusById(reviewRecord, 'preview-non-production-confirmed')),
    exportPathUnchanged,
    // Same evidence as the export-path-unchanged system item -- by
    // construction these two can never contradict each other on screen.
    xmpExportPathUnchanged: exportPathUnchanged,
    productionWriteDisabled: (() => { const v = readFlag('canWriteProduction'); return v === null ? null : v === false; })(),
    // Raw sandbox flags, kept separate so they are never mistaken for
    // XMP evidence.
    canExportPreview: readFlag('canExportPreview'),
    selectedOutputSource: readStr('selectedOutputSource'),
  };
}

/** Translates the sandbox's stable previewState code for display. */
function _trPreviewState(code, lang) {
  const safe = typeof code === 'string' && code.trim() ? code.trim() : null;
  if (!safe) return t('common.unknown', null, lang);
  const key = `visualPreview.stateLabel.${safe.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase())}`;
  const text = t(key, null, lang);
  return text === key ? t('common.unknown', null, lang) : text;
}

function _evaluatePreviewNonProduction(sandboxRecord) {
  const preset = _isRecord(sandboxRecord?.simulatedPreviewPreset) ? sandboxRecord.simulatedPreviewPreset : null;
  if (!preset) return 'unknown';

  const modeVal = preset.mode;
  const appliedVal = preset.appliedToProduction;
  const safeVal = preset.productionSafe;

  const hasModeEvidence = typeof modeVal === 'string';
  const hasAppliedEvidence = typeof appliedVal === 'boolean';
  const hasSafeEvidence = typeof safeVal === 'boolean';
  if (!hasModeEvidence && !hasAppliedEvidence && !hasSafeEvidence) return 'unknown';

  const anomaly = (hasModeEvidence && modeVal !== 'non-production-preview')
    || (hasAppliedEvidence && appliedVal === true)
    || (hasSafeEvidence && safeVal === true);
  if (anomaly) return 'anomaly';

  const confirmed = (hasModeEvidence && modeVal === 'non-production-preview')
    || (hasAppliedEvidence && appliedVal === false)
    || (hasSafeEvidence && safeVal === false);
  return confirmed ? 'confirmed' : 'unknown';
}

/**
 * Describes `hardStops` for display regardless of its actual shape
 * (array/number/boolean/object/missing) without ever dumping a raw
 * object or throwing.
 */
function _describeHardStops(value, lang) {
  const none = () => ({ text: t('review.console.none', null, lang), color: 'var(--success)' });
  const active = (n) => ({ text: t('review.console.activeCount', { count: n }, lang), color: 'var(--danger)' });
  const unknown = () => ({ text: t('common.unknown', null, lang), color: 'var(--text-faint)' });
  if (Array.isArray(value)) return value.length === 0 ? none() : active(value.length);
  if (typeof value === 'number') return Number.isFinite(value) ? (value <= 0 ? none() : active(value)) : unknown();
  if (typeof value === 'boolean') return value ? { text: t('review.console.present', null, lang), color: 'var(--danger)' } : none();
  if (_isRecord(value)) return { text: t('review.console.presentDetailsUnavailable', null, lang), color: 'var(--warn)' };
  return unknown();
}

/**
 * Safely formats a date value for display. Returns '' (never renders
 * anything) for missing or invalid dates — this module must never show
 * the literal text "Invalid Date".
 */
function _safeDateText(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    try { return d.toISOString(); } catch { return ''; }
  }
}

/**
 * Merges one or more possibly-malformed arrays (e.g.
 * reviewState.blockers and sandbox.blockers) into a single
 * deduplicated list of trimmed display strings. Both sources are
 * ALWAYS combined — an empty or missing array from one source never
 * suppresses genuine messages from the other. Each entry may be a
 * string or a record with a `.blocker`/`.warning`/`.message` field;
 * anything else is safely stringified. Never calls JSON.stringify on
 * an object without a try/catch (via _safeText), so a circular
 * reference can never throw here.
 */
function _mergeAndDedupe(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      let text;
      if (typeof raw === 'string') text = raw;
      else if (_isRecord(raw)) text = _safeText(raw.blocker ?? raw.warning ?? raw.message, _safeText(raw, ''));
      else text = _safeText(raw, '');
      const trimmed = text.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * I18N RUNTIME CLOSURE R3 — Phase E: the code-array counterpart of
 * `_mergeAndDedupe()` above — merges the additive `blockerCodes`/
 * `warningCodes` arrays (each entry `{ code, params }`, added
 * alongside the existing English `blockers`/`warnings` arrays in
 * core/lightroom-mapping-engine/mapping-v2-preview-review-state.js and
 * mapping-v2-overlay-preview-sandbox.js — never replacing them).
 * Dedupes by `code|JSON(params)` signature. A malformed entry (missing
 * `code`, non-record `params`) is silently skipped, never crashes.
 */
function _mergeAndDedupeCodes(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!_isRecord(raw) || typeof raw.code !== 'string' || !raw.code) continue;
      const params = _isRecord(raw.params) ? raw.params : null;
      const signature = `${raw.code}|${JSON.stringify(params)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push({ code: raw.code, params });
    }
  }
  return out;
}

/**
 * Normalizes a reviewProgress record into safe, finite, non-negative
 * display values. Never produces NaN/Infinity/undefined/negative
 * counts and never silently shows 0% when progress genuinely cannot
 * be determined.
 *
 * Percentage resolution order:
 *   1. Use `progress.percentage` directly if it is already a finite
 *      number (clamped to 0–100).
 *   2. Otherwise, if both `completed` and `required` are finite,
 *      non-negative numbers and `required > 0`, calculate
 *      `completed / required * 100`.
 *   3. Otherwise, progress is unavailable — `available` is false and
 *      the caller must show "Review progress unavailable" rather than
 *      inventing a 0% value.
 *
 * `completed` is clamped so it can never exceed a known-valid
 * `required` (a malformed/inconsistent completed count is corrected
 * rather than displayed as an impossible "12 of 10").
 */
function _normalizeProgress(progress) {
  const completedValid = Number.isFinite(progress?.completed) && progress.completed >= 0;
  const requiredValid = Number.isFinite(progress?.required) && progress.required >= 0;

  let completed = completedValid ? progress.completed : null;
  const required = requiredValid ? progress.required : null;
  if (completed !== null && required !== null && completed > required) completed = required;

  let percentage = null;
  if (Number.isFinite(progress?.percentage)) {
    percentage = Math.max(0, Math.min(100, progress.percentage));
  } else if (completed !== null && required !== null && required > 0) {
    percentage = Math.max(0, Math.min(100, (completed / required) * 100));
  }

  return { available: percentage !== null, completed, required, percentage };
}

/** Creates an element with optional class/style/text/attrs — text is always set via textContent (never innerHTML), and always passed through _safeText first so non-string values can never crash el(). */
function el(tag, { cls, style, text, attrs } = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) e.setAttribute('style', style);
  if (text !== undefined && text !== null) e.textContent = _safeText(text, '');
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) e.setAttribute(k, String(v));
    }
  }
  return e;
}

function badge(text, color) {
  const safeColor = typeof color === 'string' && color ? color : 'var(--text-faint)';
  return el('span', {
    style: `display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.04em;background:${safeColor}22;color:${safeColor};border:1px solid ${safeColor}44;overflow-wrap:anywhere`,
    text,
  });
}

function sectionHeading(text, iconGlyph) {
  const row = el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0 10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)' });
  if (iconGlyph) {
    const icon = el('span', { cls: 'material-symbols-outlined', style: "font-family:'Material Symbols Outlined';font-size:14px;color:var(--accent)", text: iconGlyph });
    row.appendChild(icon);
  }
  row.appendChild(el('span', { text }));
  return row;
}

/**
 * Renders a "label: value" row. `valueNode` may be a real DOM Node (in
 * which case it is appended as-is) or any other value (safely
 * stringified via _safeText) — this guards a real crash that existed
 * before this patch: appendChild() throws a TypeError if handed a
 * non-Node value (e.g. a number or plain object), which could happen
 * if upstream data supplied a non-string `restoreSource`.
 */
function listRow(labelText, valueNode) {
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px' });
  row.appendChild(el('span', { style: 'color:var(--text-dim)', text: labelText }));
  const valWrap = el('div', { style: 'text-align:right;color:var(--text);overflow-wrap:anywhere' });
  if (valueNode instanceof Node) valWrap.appendChild(valueNode);
  else valWrap.textContent = _safeText(valueNode, '');
  row.appendChild(valWrap);
  return row;
}

/**
 * A single risk cell showing a label and a normalized value/color —
 * used for both risk-level rows (low/medium/high/critical/unknown) and
 * the specially-handled hard-stops row. Cells wrap naturally via
 * flex-wrap on the parent grid, collapsing to one column on narrow
 * screens without needing a CSS media query (consistent with this
 * project's inline-style-only architecture).
 */
function riskCell(label, valueText, color) {
  const safeColor = typeof color === 'string' && color ? color : 'var(--text-faint)';
  const item = el('div', { style: `flex:1 1 150px;min-width:150px;padding:8px 10px;background:var(--surface-2);border-radius:3px;border-left:2px solid ${safeColor}` });
  item.appendChild(el('div', { style: 'font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em;font-family:var(--font-mono)', text: label }));
  item.appendChild(el('div', { style: `font-size:12px;font-weight:600;color:${safeColor};margin-top:2px;overflow-wrap:anywhere`, text: valueText }));
  return item;
}

/**
 * A tri-state confirmation line: CONFIRMED (green check — the field
 * explicitly holds the safe/expected value), ANOMALY (red warning —
 * the field explicitly holds an unexpected value; this should never
 * happen upstream, but if it ever does, this UI must say so rather
 * than silently showing a false green checkmark), or UNKNOWN (neutral
 * dash — the field is missing/unreadable, never assumed safe).
 */
function statusLine(wrap, { confirmedText, anomalyText, unknownText, status }) {
  const color = status === 'confirmed' ? 'var(--success)' : status === 'anomaly' ? 'var(--danger)' : 'var(--text-faint)';
  const icon = status === 'confirmed' ? '\u2713' : status === 'anomaly' ? '\u26A0' : '\u2014';
  const text = status === 'confirmed' ? confirmedText : status === 'anomaly' ? anomalyText : unknownText;
  wrap.appendChild(el('div', { style: `font-size:11.5px;color:${color};display:flex;align-items:flex-start;gap:6px;overflow-wrap:anywhere`, text: `${icon}  ${text}` }));
}

/**
 * Resolves reviewSummary.nextRequiredItem into safe display text.
 * Accepts a string ID, a string label, an object with `.id` and/or
 * `.label`, or null/malformed input. IDs are resolved against
 * `idLabelMap` (built from the actual reviewItems) so the resolved
 * LABEL is shown rather than a raw ID where possible. Never returns
 * the literal text "[object Object]" for an unresolvable object —
 * falls back to '' (caller shows "All required review items
 * completed" in that case) rather than dumping raw data.
 */
function _resolveNextRequiredItemLabel(nextRequiredItem, idLabelMap) {
  if (nextRequiredItem === null || nextRequiredItem === undefined) return '';
  if (typeof nextRequiredItem === 'string') {
    if (!nextRequiredItem.trim()) return '';
    return idLabelMap.get(nextRequiredItem) ?? nextRequiredItem; // resolves a real ID to its label; otherwise treats the string itself as an already-human label
  }
  if (_isRecord(nextRequiredItem)) {
    if (typeof nextRequiredItem.label === 'string' && nextRequiredItem.label.trim()) return nextRequiredItem.label;
    if (typeof nextRequiredItem.id === 'string' && nextRequiredItem.id.trim()) return idLabelMap.get(nextRequiredItem.id) ?? nextRequiredItem.id;
  }
  return '';
}

function _buildIdLabelMap(reviewItems) {
  const map = new Map();
  for (const raw of reviewItems) {
    if (_isRecord(raw) && typeof raw.id === 'string') map.set(raw.id, _safeText(raw.label, raw.id));
  }
  return map;
}

const ACTION_LABEL = { pass: 'Pass', fail: 'Fail', adjust: 'Needs Adjustment', pending: 'Pending' };

/**
 * Renders the four status-control buttons for one review item (Pass /
 * Fail / Needs Adjustment / Pending), or — when Fail is armed for
 * confirmation — a "Confirm Fail?" + Cancel pair instead. Every button
 * is `type="button"` (never submits a form), has a >=44px touch
 * target, an `aria-label` that includes the item's own label (so
 * screen readers announce which item a button belongs to, not just
 * "Pass"), and `aria-pressed` reflecting whether that action is the
 * item's CURRENT state — never relying on color alone (each button
 * also has a distinct, always-visible text label).
 */
function renderActionButtons(item, itemLabel, statusKey, decisionKey, isFailConfirmPending, lang, disabled = false) {
  const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:7px;margin-top:10px' });
  const al = { pass: t('review.action.pass', null, lang) || ACTION_LABEL.pass, fail: t('review.action.fail', null, lang) || ACTION_LABEL.fail, adjust: t('review.action.adjust', null, lang) || ACTION_LABEL.adjust, pending: t('review.action.pending', null, lang) || ACTION_LABEL.pending };
  const makeBtn = ({ label, action, active, color, ariaLabel }) => el('button', {
    style: `min-height:44px;padding:9px 15px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '.48' : '1'};border:1.5px solid ${active ? color : 'var(--border)'};background:${active ? color + '20' : 'var(--surface-2)'};color:${active ? color : 'var(--text-dim)'};overflow-wrap:anywhere`,
    text: label,
    attrs: {
      type: 'button',
      'data-review-action': action,
      'aria-label': ariaLabel,
      'aria-pressed': String(active),
      'aria-disabled': String(disabled),
      disabled: disabled ? '' : null,
    },
  });

  if (isFailConfirmPending) {
    wrap.appendChild(makeBtn({ label: t('review.action.confirmFail', null, lang), action: 'fail', active: true, color: 'var(--danger)', ariaLabel: `Confirm marking "${itemLabel}" as failed` }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 15px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
      text: t('review.action.cancel', null, lang),
      attrs: { type: 'button', 'data-review-action': 'cancel-confirm', 'aria-label': `Cancel failing "${itemLabel}"` },
    }));
    return wrap;
  }

  wrap.appendChild(makeBtn({ label: al.pass, action: 'pass', active: statusKey === 'passed' && decisionKey === 'approve', color: 'var(--success)', ariaLabel: `${al.pass} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: al.fail, action: 'fail', active: statusKey === 'failed', color: 'var(--danger)', ariaLabel: `${al.fail} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: al.adjust, action: 'adjust', active: decisionKey === 'needs-adjustment', color: 'var(--warn)', ariaLabel: `${al.adjust} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: al.pending, action: 'pending', active: statusKey === 'pending' && decisionKey === 'undecided', color: 'var(--text-dim)', ariaLabel: `Return "${itemLabel}" to ${al.pending.toLowerCase()}` }));
  return wrap;
}

/**
 * Renders the editable reviewer-note field for one item: a labeled
 * textarea (max 500 characters, enforced both by the `maxlength`
 * attribute and defensively again by the controller on commit) plus a
 * live character counter. The textarea's initial value is set via the
 * `.value` property (the correct, safe way to seed a form control's
 * content — never via textContent/innerHTML). Committing the note to
 * the Review State Engine is the controller's job (on focusout,
 * delegated from the console container) — this function only builds
 * the field and wires no listeners itself.
 */
function renderNoteField(item, itemId, itemLabel, lang, disabled = false) {
  const wrap = el('div', { style: 'margin-top:10px' });
  const fieldId = `review-note-${itemId}`;
  wrap.appendChild(el('label', {
    style: 'display:block;font-size:9.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;font-family:var(--font-mono);margin-bottom:4px',
    text: t('review.reviewerNote', null, lang),
    attrs: { for: fieldId },
  }));
  const currentNote = _safeText(item.reviewerNote, '');
  const textarea = el('textarea', {
    style: 'width:100%;min-height:52px;padding:8px 10px;border-radius:3px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-family:var(--font-sans);font-size:12px;line-height:1.5;resize:vertical;overflow-wrap:anywhere;box-sizing:border-box',
    attrs: {
      id: fieldId,
      maxlength: '500',
      'data-review-note': 'true',
      placeholder: `Add a note about "${itemLabel}"…`,
      'aria-label': `Reviewer note for ${itemLabel}, up to 500 characters`,
      'aria-disabled': String(disabled),
      disabled: disabled ? '' : null,
    },
  });
  textarea.value = currentNote; // seeding a form control's content — always via .value, never textContent/innerHTML
  wrap.appendChild(textarea);
  wrap.appendChild(el('div', {
    style: 'text-align:right;font-size:9px;color:var(--text-faint);font-family:var(--font-mono);margin-top:2px',
    text: `${currentNote.length}/500`,
    attrs: { 'data-note-counter': itemId },
  }));
  return wrap;
}

/**
 * Renders one checklist item row — label, description, category,
 * Required/Optional badge, normalized status, normalized reviewer
 * decision, evidence summary, item warnings, updated time (only when
 * valid), the interactive Pass/Fail/Needs-Adjustment/Pending controls,
 * and an editable reviewer-note field. Gracefully handles a malformed
 * entry (null/undefined/non-object/array) inside
 * reviewState.reviewItems instead of throwing — such an entry is shown
 * as an explicit "invalid item" placeholder (with no interactive
 * controls, since there is no valid ID to act on) rather than being
 * silently dropped or crashing the whole console.
 *
 * `uiState` (optional) carries transient, controller-owned UI state —
 * currently just which item IDs have an armed "Confirm Fail?" prompt.
 * It is read-only here; this function never mutates it.
 */
function renderChecklistItem(item, uiState, lang) {
  const wrap = el('div', { style: 'padding:12px 0;border-bottom:1px solid var(--border)' });

  if (!_isRecord(item)) {
    wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-faint);font-style:italic', text: t('review.invalidItem', null, lang) }));
    return wrap;
  }

  const itemId = typeof item.id === 'string' ? item.id : '';
  if (itemId) wrap.setAttribute('data-review-item-id', itemId);

  const top = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px' });
  const labelCol = el('div', { style: 'flex:1;min-width:0' });
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase B: for the ten canonical
  // review items the visible title comes from the STABLE ID, never from
  // Core's English `label`. A non-canonical (developer-defined) item
  // falls back to its own bounded source label AND is marked as such,
  // so an unknown check can never masquerade as a standard one.
  const canonicalTitle = presentReviewItemField(item.id, 'title', lang);
  const itemLabel = canonicalTitle ?? _safeText(item.label, t('review.console.untitledItem', null, lang));
  const isDeveloperDefinedItem = !isCanonicalReviewItemId(item.id);
  labelCol.appendChild(el('div', { style: 'font-size:13px;font-weight:600;color:var(--text);overflow-wrap:anywhere', text: itemLabel }));
  // I18N RUNTIME CLOSURE R3 — Phase E: for the ten canonical items the
  // visible description must ALSO come from the stable ID (mirrors
  // canonicalTitle immediately above) — this call site was the single
  // biggest source of the 28 Runtime leaks the R3 review found, since
  // every canonical item's raw Core English `item.description` was
  // rendered unconditionally with no canonical override at all.
  const canonicalDescription = presentReviewItemField(item.id, 'description', lang);
  const descriptionText = canonicalDescription ?? _safeText(item.description, '');
  if (descriptionText) {
    labelCol.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px;line-height:1.4;overflow-wrap:anywhere', text: descriptionText }));
  }
  top.appendChild(labelCol);
  const statusKey = _normalizeStatus(item.status); // unknown/malformed statuses normalize to "unavailable" — NEVER "passed"
  top.appendChild(badge(_trStatus(statusKey, lang), STATUS_COLOR[statusKey]));
  wrap.appendChild(top);

  // ── Category / Required-Optional / Reviewer decision — always shown ──────
  const metaRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:7px' });
  const categoryText = _safeText(item.category, '');
  if (categoryText) metaRow.appendChild(badge(categoryText.toUpperCase(), 'var(--text-faint)'));
  const isRequired = item.required !== false; // anything other than an explicit `false` is treated as required (never silently downgraded)
  metaRow.appendChild(badge(isRequired ? t('review.console.required', null, lang) : t('review.console.optional', null, lang), isRequired ? 'var(--accent)' : 'var(--text-faint)'));
  const decisionKey = _normalizeDecision(item.reviewerDecision); // unknown/malformed decisions normalize to "undecided"
  metaRow.appendChild(badge(_trDecision(decisionKey, lang), DECISION_COLOR[decisionKey]));
  wrap.appendChild(metaRow);

  const reasonText = _safeText(item.reason, '');
  if (reasonText) {
    wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:6px;font-style:italic;overflow-wrap:anywhere', text: reasonText }));
  }
  // I18N RUNTIME CLOSURE R3 — Phase E: raw evidence field identifiers
  // (selectedOutputSource=legacy, skinRisk=low, useLegacyMapping=true,
  // ...) are internal diagnostic keys, not photographer-facing prose —
  // per the spec these must live inside collapsed Developer Details,
  // never in the always-visible card body. This is the same
  // `common.developerDetails` <details>/<summary> pattern already used
  // by ui/side-by-side-comparison-renderer.js.
  if (_isRecord(item.evidence) && Object.keys(item.evidence).length) {
    const evDetails = el('details', { style: 'margin-top:6px' });
    const evSummary = el('summary', { style: 'cursor:pointer;font-size:10px;font-family:var(--font-mono);color:var(--text-faint);letter-spacing:.04em;text-transform:uppercase;min-height:28px;display:flex;align-items:center', text: t('common.developerDetails', null, lang) });
    evDetails.appendChild(evSummary);
    const evWrap = el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:4px;font-family:var(--font-mono);overflow-wrap:anywhere' });
    const parts = Object.entries(item.evidence).map(([k, v]) => `${_safeText(k, '?')}=${_safeText(v, 'null')}`);
    evWrap.textContent = parts.join(' \u00B7 '); // evidence values (e.g. "skinRisk=low") — plain text only, never HTML
    evDetails.appendChild(evWrap);
    wrap.appendChild(evDetails);
  }
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase H:
  // FIX for Defect 3 -- a manual visual item's "no automatic evidence"
  // note is EXPECTED (a human must look at the image), never a real
  // problem, so it must never render as an alarming orange warning
  // line. For manual items (item.manual !== false), replace the raw
  // internal warning text with one bounded, neutral, bilingual
  // reassurance line instead. System-verified items (manual === false)
  // keep their real warnings exactly as before -- missing/malformed
  // system evidence IS a genuine warning.
  const itemWarnings = Array.isArray(item.warnings) ? item.warnings : [];
  const isManualItem = item.manual !== false;
  if (isManualItem && itemWarnings.length) {
    wrap.appendChild(el('div', {
      style: 'margin-top:6px;font-size:10.5px;color:var(--text-faint);font-style:italic;overflow-wrap:anywhere',
      text: t('review.manualNoAutoEvidence', null, lang),
    }));
  } else if (itemWarnings.length) {
    // I18N RUNTIME CLOSURE R3 — Phase E: every one of the four
    // system-verified items' possible warnings follows the exact same
    // Core template ('System evidence for "<title>" is missing or
    // incomplete — never auto-passed.', see
    // _evaluateSystemVerifiedAutoStatus() in
    // mapping-v2-preview-review-state.js) — translated generically by
    // ONE localized template using the item's own already-canonical
    // title, rather than displaying Core's raw English sentence.
    const warnWrap = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
    const translatedSystemWarning = t('review.console.systemEvidenceIncomplete', { title: itemLabel }, lang);
    for (const w of itemWarnings) {
      const rawText = typeof w === 'string' ? w : _safeText(w, '(unrepresentable warning)');
      if (!rawText) continue;
      const text = !isManualItem ? translatedSystemWarning : rawText; // !isManualItem === item.manual === false (system-verified) — isSystemVerified is defined later in this function
      warnWrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    }
    wrap.appendChild(warnWrap);
  }
  const updatedText = _safeDateText(item.updatedAt); // '' for missing/invalid — never renders "Invalid Date"
  if (updatedText) {
    wrap.appendChild(el('div', { style: 'font-size:10px;color:var(--text-faint);margin-top:6px;font-family:var(--font-mono)', text: `${t('review.console.lastUpdated', null, lang)} ${updatedText}` }));
  }

  // ── Help text — FULL-SYSTEM I18N COMPLETION R2, Phase B ──────────────
  //    For the ten CANONICAL items the what/where/why text is resolved
  //    from the centralized dictionary by STABLE ITEM ID, so it always
  //    matches the active locale. Core's own bilingual `item.help`
  //    payload is used only as the fallback for a non-canonical,
  //    developer-defined item (which is additionally badged as such).
  const canonicalWhat = presentReviewItemField(item.id, 'whatThisChecks', lang);
  const canonicalWhere = presentReviewItemField(item.id, 'whatToLookFor', lang);
  const canonicalWhy = presentReviewItemField(item.id, 'whyItMatters', lang);
  if (canonicalWhat || canonicalWhere || canonicalWhy || _isRecord(item.help)) {
    const helpWrap = el('div', { style: 'margin-top:8px;padding:8px 10px;background:var(--surface-2);border-radius:3px;font-size:11px;color:var(--text-dim);line-height:1.6;overflow-wrap:anywhere' });
    const helpRecord = _isRecord(item.help) ? item.help : null;
    const whatText = canonicalWhat ?? _t(helpRecord?.en ? { en: helpRecord.en.whatThisChecks, th: helpRecord.th?.whatThisChecks } : null, lang);
    const whereText = canonicalWhere ?? _t(helpRecord?.en ? { en: helpRecord.en.whatToLookFor, th: helpRecord.th?.whatToLookFor } : null, lang);
    const whyText = canonicalWhy ?? _t(helpRecord?.en ? { en: helpRecord.en.whyItMatters, th: helpRecord.th?.whyItMatters } : null, lang);
    if (isDeveloperDefinedItem) {
      helpWrap.appendChild(el('div', { style: 'margin-bottom:3px;color:var(--warn)', text: presentUnknownReviewItemNote(lang) }));
    }
    if (whatText) helpWrap.appendChild(el('div', { text: whatText }));
    if (whereText) helpWrap.appendChild(el('div', { style: 'margin-top:3px;color:var(--text-faint)', text: whereText }));
    if (whyText) helpWrap.appendChild(el('div', { style: 'margin-top:3px;font-style:italic;color:var(--text-faint)', text: whyText }));
    if (whatText || whereText || whyText || isDeveloperDefinedItem) wrap.appendChild(helpWrap);
  }

  // ── Controls — system-verified items are always read-only (a manual
  //    click can never change them; see updatePreviewReviewItemV2's
  //    dedicated no-op guard); genuine manual (visual) items get the
  //    interactive Pass/Fail/Adjust/Pending controls + note field ──
  const isSystemVerified = item.manual === false;
  if (isSystemVerified) {
    const roWrap = el('div', { style: 'margin-top:9px;display:flex;align-items:center;gap:7px' });
    roWrap.appendChild(badge(t('review.console.systemVerifiedReadOnly', null, lang), 'var(--text-faint)'));
    wrap.appendChild(roWrap);
  } else if (itemId) {
    const isFailConfirmPending = uiState?.pendingConfirmItemIds instanceof Set && uiState.pendingConfirmItemIds.has(itemId);
    const reviewDisabled = uiState?.reviewAvailable === false;
    wrap.appendChild(renderActionButtons(item, itemLabel, statusKey, decisionKey, isFailConfirmPending, lang, reviewDisabled));
    wrap.appendChild(renderNoteField(item, itemId, itemLabel, lang, reviewDisabled));
  }

  return wrap;
}

/**
 * Renders the console-level "Reset Review" control. When
 * `uiState.resetConfirmPending` is true, shows an inline "Reset all
 * review progress?" confirmation with Confirm/Cancel instead of the
 * single button — the same lightweight, no-window.confirm() pattern
 * used for the per-item Fail confirmation, since this app has no
 * existing modal system to reuse.
 */
function renderResetButton(uiState, lang) {
  const wrap = el('div', { style: 'margin-top:18px;padding-top:16px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:9px' });

  if (uiState?.resetConfirmPending) {
    wrap.appendChild(el('span', { style: 'font-size:12px;color:var(--text-dim);overflow-wrap:anywhere', text: t('review.resetConfirm', null, lang) }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 16px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid var(--danger);background:var(--danger);color:var(--on-accent)',
      text: t('review.yesReset', null, lang),
      attrs: { type: 'button', 'data-review-action': 'reset-review', 'aria-label': t('review.aria.confirmReset', null, lang) },
    }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 16px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
      text: t('review.cancel', null, lang),
      attrs: { type: 'button', 'data-review-action': 'reset-cancel', 'aria-label': t('review.aria.cancelReset', null, lang) },
    }));
    return wrap;
  }

  wrap.appendChild(el('button', {
    style: 'min-height:44px;padding:9px 18px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
    text: t('review.resetReview', null, lang),
    attrs: { type: 'button', 'data-review-action': 'reset-review', 'aria-label': t('review.aria.resetAll', null, lang) },
  }));
  return wrap;
}

/**
 * Renders the Preview Risk Review section from
 * sandbox.previewRiskReview. Every risk field is normalized to
 * low/medium/high/critical/unknown — an unrecognized or missing value
 * always displays "Unknown" and is never styled or labeled as "Low".
 * hardStops is handled specially since it isn't itself a risk level
 * (it may be an array, number, boolean, object, or missing).
 */
function renderPreviewRiskReview(container, riskReview, lang) {
  if (!_isRecord(riskReview)) return;
  container.appendChild(sectionHeading(t('review.console.previewRiskReview', null, lang), 'shield'));
  const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' });

  const overallLevel = _normalizeRiskLevel(riskReview.level);
  grid.appendChild(riskCell(t('review.risk.overallLevel', null, lang), presentRiskLevel(overallLevel, lang), RISK_COLOR[overallLevel]));

  const hardStops = _describeHardStops(riskReview.hardStops, lang);
  grid.appendChild(riskCell(t('review.risk.hardStops', null, lang), hardStops.text, hardStops.color));

  const rows = [
    ['review.risk.overStackSeverity', riskReview.overStackSeverity],
    ['review.risk.skinRisk', riskReview.skinRisk],
    ['review.risk.highlightRisk', riskReview.highlightRisk],
    ['review.risk.shadowRisk', riskReview.shadowRisk],
    ['review.risk.whiteBalanceRisk', riskReview.whiteBalanceRisk],
    ['review.risk.colorRisk', riskReview.colorRisk],
    ['review.risk.exportRisk', riskReview.exportRisk],
    ['review.risk.productionWriteRisk', riskReview.productionWriteRisk],
  ];
  for (const [labelKey, raw] of rows) {
    const level = _normalizeRiskLevel(raw);
    grid.appendChild(riskCell(t(labelKey, null, lang), presentRiskLevel(level, lang), RISK_COLOR[level]));
  }

  container.appendChild(grid);
}

/**
 * Builds the full console body into `container`. Assumes `container`
 * has already been validated and cleared by the caller
 * (renderReviewConsole). Any exception thrown while building this body
 * is caught by the caller, never escapes to the host page.
 */
function _renderBody(container, sandbox, reviewState, uiState, lang) {
  const sandboxRecord = _isRecord(sandbox) ? sandbox : null;
  const reviewRecord = _isRecord(reviewState) ? reviewState : null;

  if (!sandboxRecord && !reviewRecord) {
    container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text-faint);padding:10px 0', text: t('review.noPreview', null, lang) }));
    return;
  }

  // ── Top summary ──────────────────────────────────────────────────────────
  const summaryRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px' });
  if (sandboxRecord) {
    summaryRow.appendChild(badge(
      `${t('visualPreview.badges.previewOnly', null, lang)}: ${_trPreviewState(sandboxRecord.previewState, lang)}`,
      sandboxRecord.canGeneratePreview === true ? 'var(--success)' : 'var(--text-faint)',
    ));
  }
  if (reviewRecord) {
    summaryRow.appendChild(badge(
      `${t('review.console.reviewProgress', null, lang)}: ${presentReviewSummaryState(reviewRecord.approvalState, lang)}`,
      APPROVAL_COLOR[reviewRecord.approvalState] ?? 'var(--text-faint)',
    ));
  }
  container.appendChild(summaryRow);

  // FULL-SYSTEM I18N COMPLETION R2 -- Phase C: the photographer-facing
  // summary is derived from the STABLE approval-state code, never from
  // Core's English `photographerMessage`/`photographerSummary` prose.
  // Those raw Core sentences are still shown, but only inside the
  // collapsed Developer Details block at the bottom of this console.
  const approvalStateCode = typeof reviewRecord?.candidateReviewStatus === 'string'
    ? reviewRecord.candidateReviewStatus
    : typeof reviewRecord?.approvalState === 'string'
      ? reviewRecord.approvalState
      : 'unavailable';
  const photographerLine = presentReviewSummaryState(approvalStateCode, lang);
  container.appendChild(el('div', { style: 'font-size:13px;color:var(--text);line-height:1.6;margin-bottom:4px;overflow-wrap:anywhere', text: photographerLine }));

  // Raw upstream Core prose -- developer-facing only, never the primary
  // photographer message (see Phase C of the R2 spec).
  const rawCoreSummary = _safeText(reviewRecord?.reviewSummary?.photographerMessage, '') || _safeText(sandboxRecord?.photographerSummary, '');

  // ── Tri-state confirmations — never claim more than the data supports ────
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase D: all evidence lines read
  // from ONE canonical projection so they can never contradict each
  // other, and every sentence comes from the centralized dictionary.
  const systemEvidence = buildReviewSystemEvidence(sandboxRecord, reviewRecord);
  const confirmWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px;margin:14px 0;padding:12px 14px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--success)' });

  const triStatus = (v) => (v === true ? 'confirmed' : v === false ? 'anomaly' : 'unknown');

  statusLine(confirmWrap, {
    confirmedText: t('review.evidence.previewNonProductionConfirmed', null, lang),
    anomalyText: t('review.evidence.previewNonProductionAnomaly', null, lang),
    unknownText: t('review.evidence.previewNonProductionUnknown', null, lang),
    status: _evaluatePreviewNonProduction(sandboxRecord),
  });

  const canExportPreview = systemEvidence.canExportPreview;
  statusLine(confirmWrap, {
    confirmedText: t('review.evidence.exportConfirmed', null, lang),
    anomalyText: t('review.evidence.exportAnomaly', null, lang),
    unknownText: t('review.evidence.exportUnknown', null, lang),
    status: typeof canExportPreview !== 'boolean' ? 'unknown' : (canExportPreview === false ? 'confirmed' : 'anomaly'),
  });

  statusLine(confirmWrap, {
    confirmedText: t('review.evidence.productionWriteConfirmed', null, lang),
    anomalyText: t('review.evidence.productionWriteAnomaly', null, lang),
    unknownText: t('review.evidence.productionWriteUnknown', null, lang),
    status: triStatus(systemEvidence.productionWriteDisabled),
  });

  const selectedOutputSource = systemEvidence.selectedOutputSource;
  statusLine(confirmWrap, {
    confirmedText: t('review.evidence.productionMappingConfirmed', null, lang),
    anomalyText: t('review.evidence.productionMappingAnomaly', null, lang),
    unknownText: t('review.evidence.productionMappingUnknown', null, lang),
    status: typeof selectedOutputSource !== 'string' ? 'unknown' : (selectedOutputSource === 'legacy' ? 'confirmed' : 'anomaly'),
  });
  container.appendChild(confirmWrap);

  // ── XMP export path — SAME evidence as the export-path-unchanged item ────
  const xmpStripWrap = el('div', { style: 'margin-bottom:14px' });
  statusLine(xmpStripWrap, {
    confirmedText: t('review.evidence.xmpConfirmed', null, lang),
    anomalyText: t('review.evidence.xmpAnomaly', null, lang),
    unknownText: t('review.evidence.xmpUnknown', null, lang),
    status: triStatus(systemEvidence.xmpExportPathUnchanged),
  });
  container.appendChild(xmpStripWrap);

  // ── Preview Risk Review ──────────────────────────────────────────────────
  renderPreviewRiskReview(container, sandboxRecord?.previewRiskReview, lang);

  // ── Review progress (with ARIA progressbar semantics) ────────────────────
  const progress = _isRecord(reviewRecord?.reviewProgress) ? reviewRecord.reviewProgress : null;
  const normalizedProgress = progress ? _normalizeProgress(progress) : null;
  if (normalizedProgress?.available) {
    container.appendChild(sectionHeading(t('review.console.reviewProgress', null, lang), 'fact_check'));
    const pct = Math.round(normalizedProgress.percentage);
    const completedText = normalizedProgress.completed !== null ? String(normalizedProgress.completed) : '\u2014';
    const requiredText = normalizedProgress.required !== null ? String(normalizedProgress.required) : '\u2014';

    const progWrap = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:6px' });
    const barOuter = el('div', {
      style: 'flex:1;height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden',
      attrs: {
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(pct),
        'aria-label': t('review.aria.progressBar', { done: completedText, total: requiredText }, lang),
      },
    });
    const barInner = el('div', { style: `height:100%;width:${pct}%;background:var(--accent);border-radius:3px` });
    barOuter.appendChild(barInner);
    progWrap.appendChild(barOuter);
    progWrap.appendChild(el('span', { style: 'font-family:var(--font-mono);font-size:11px;color:var(--text-dim);white-space:nowrap', text: `${pct}% \u00B7 ${completedText}/${requiredText}` }));
    container.appendChild(progWrap);

    const reviewItemsForResolve = Array.isArray(reviewRecord?.reviewItems) ? reviewRecord.reviewItems : [];
    const idLabelMap = _buildIdLabelMap(reviewItemsForResolve);
    const resolvedNext = _resolveNextRequiredItemLabel(reviewRecord?.reviewSummary?.nextRequiredItem, idLabelMap);
    container.appendChild(el('div', {
      style: 'font-size:11px;color:var(--text-faint);overflow-wrap:anywhere',
      text: resolvedNext ? t('review.console.nextItem', { label: resolvedNext }, lang) : t('review.console.allRequiredCompleted', null, lang),
    }));

    // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase G2/G4: a bounded
    // "Visual X/6 · System X/4" summary plus one primary-guidance
    // sentence, read directly from the engine's own reviewGuidance —
    // never re-derived here, so the UI can never say something like
    // "review all 10 items" when four are already system-verified.
    const guidance = _isRecord(reviewRecord?.reviewGuidance) ? reviewRecord.reviewGuidance : null;
    if (guidance) {
      const guidanceWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' });
      const visualReq = typeof guidance.visualRequired === 'number' ? guidance.visualRequired : null;
      const visualPass = typeof guidance.visualPassed === 'number' ? guidance.visualPassed : null;
      const sysReq = typeof guidance.systemRequired === 'number' ? guidance.systemRequired : null;
      const sysVerified = typeof guidance.systemVerified === 'number' ? guidance.systemVerified : null;
      if (visualReq !== null && visualPass !== null) {
        guidanceWrap.appendChild(badge(t('review.console.visualProgress', { done: visualPass, total: visualReq }, lang), visualPass >= visualReq ? 'var(--success)' : 'var(--text-dim)'));
      }
      if (sysReq !== null && sysVerified !== null) {
        guidanceWrap.appendChild(badge(t('review.console.systemProgress', { done: sysVerified, total: sysReq }, lang), sysVerified >= sysReq ? 'var(--success)' : 'var(--text-faint)'));
      }
      container.appendChild(guidanceWrap);
      // I18N RUNTIME CLOSURE R3 — Phase E: translate by stable code
      // first (guidance.primaryGuidanceCode, additive alongside the
      // raw English guidance.primaryGuidance which Core still emits
      // and which is used only as the last-resort fallback).
      const primaryGuidanceText = presentReviewGuidanceCode(guidance.primaryGuidanceCode, guidance.primaryGuidanceParams, lang, _safeText(guidance.primaryGuidance, ''));
      if (primaryGuidanceText) {
        container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text);margin-top:6px;overflow-wrap:anywhere', text: primaryGuidanceText }));
      }
    }
  } else if (reviewRecord) {
    container.appendChild(sectionHeading(t('review.console.reviewProgress', null, lang), 'fact_check'));
    container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: t('review.progressUnavailable', null, lang) }));
  }

  // ── Checklist (grouped: Visual inspection / System integrity / Safety
  //    guarantees — interactive Pass/Fail/Adjust/Pending + note ONLY
  //    for the genuinely manual Visual items; the other two groups are
  //    read-only, system-verified, and never manually overridable) ──
  const reviewItems = Array.isArray(reviewRecord?.reviewItems) ? reviewRecord.reviewItems : [];
  if (reviewItems.length) {
    container.appendChild(sectionHeading(t('review.console.humanReviewChecklist', null, lang), 'checklist'));
    if (uiState?.reviewAvailable === false) {
      container.appendChild(el('div', {
        style: 'margin:8px 0 12px;padding:10px 12px;border:1px solid var(--border);background:var(--surface-2);color:var(--warn);font-size:11.5px;line-height:1.6;border-radius:3px',
        text: t('review.previewEvidencePending', null, lang),
        attrs: { role: 'status', 'data-review-availability': 'pending-preview-evidence' },
      }));
    } else {
      container.appendChild(el('div', {
        style: 'margin:8px 0 12px;padding:8px 12px;border:1px solid var(--border);background:var(--surface-2);color:var(--success);font-size:11.5px;line-height:1.6;border-radius:3px',
        text: t('review.previewEvidenceReady', null, lang),
        attrs: { role: 'status', 'data-review-availability': 'ready' },
      }));
    }

    const grouped = new Map();
    for (const item of reviewItems) {
      const groupKey = _isRecord(item) && typeof item.group === 'string' && GROUP_I18N_KEY[item.group] ? item.group : '__ungrouped__';
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey).push(item);
    }
    const orderedKeys = [...GROUP_ORDER.filter((k) => grouped.has(k)), ...[...grouped.keys()].filter((k) => !GROUP_ORDER.includes(k))];

    for (const groupKey of orderedKeys) {
      const itemsInGroup = grouped.get(groupKey) ?? [];
      if (!itemsInGroup.length) continue;
      const groupLabelText = t(GROUP_I18N_KEY[groupKey] ?? GROUP_FALLBACK_I18N_KEY, null, lang);
      container.appendChild(el('div', {
        style: 'font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint);margin:14px 0 4px;font-family:var(--font-mono)',
        text: groupLabelText,
      }));
      const listWrap = el('div');
      for (const item of itemsInGroup) {
        listWrap.appendChild(renderChecklistItem(item, uiState, lang));
      }
      container.appendChild(listWrap);
    }
    container.appendChild(renderResetButton(uiState, lang));
  }

  // ── Blockers — merged and deduplicated from BOTH sources ─────────────────
  // I18N RUNTIME CLOSURE R3 — Phase E: these three section headings
  // were literal English strings ('Blockers'/'Warnings'/'Rollback')
  // passed directly to sectionHeading() — never routed through t(),
  // even though the matching review.console.blockers/.warnings/
  // .rollback dictionary keys already existed in both locales. Also,
  // blockers/warnings themselves are now translated by stable code
  // (via presentReviewBlockerCode/presentReviewWarningCode) whenever
  // Core supplied one, with the raw English merged-and-deduped string
  // kept only as the last-resort fallback for a genuinely unknown
  // blocker/warning (never silently dropped).
  const blockerCodes = _mergeAndDedupeCodes(reviewRecord?.blockerCodes, sandboxRecord?.blockerCodes);
  const blockers = _mergeAndDedupe(reviewRecord?.blockers, sandboxRecord?.blockers);
  if (blockers.length) {
    container.appendChild(sectionHeading(t('review.console.blockers', null, lang), 'block'));
    const blkWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    const translatedBlockers = blockerCodes.length
      ? blockerCodes.map((entry) => presentReviewBlockerCode(entry.code, entry.params, lang))
      : blockers.map((text) => presentReviewBlockerCode(null, null, lang, text));
    for (const text of translatedBlockers) {
      blkWrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--danger);padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--danger);overflow-wrap:anywhere', text }));
    }
    container.appendChild(blkWrap);
  }

  // ── Warnings — merged and deduplicated from BOTH sources ─────────────────
  const warningCodes = _mergeAndDedupeCodes(reviewRecord?.warningCodes, sandboxRecord?.warningCodes);
  const warnings = _mergeAndDedupe(reviewRecord?.warnings, sandboxRecord?.warnings);
  if (warnings.length) {
    container.appendChild(sectionHeading(t('review.console.warnings', null, lang), 'warning'));
    const warnWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    const translatedWarnings = warningCodes.length
      ? warningCodes.map((entry) => presentReviewWarningCode(entry.code, entry.params, lang))
      : warnings.map((text) => presentReviewWarningCode(null, null, lang, text));
    for (const text of translatedWarnings) {
      warnWrap.appendChild(el('div', { style: 'font-size:11px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    }
    container.appendChild(warnWrap);
  }

  // ── Rollback ──────────────────────────────────────────────────────────────
  const rollback = _isRecord(reviewRecord?.rollbackPlan) ? reviewRecord.rollbackPlan
    : _isRecord(sandboxRecord?.rollbackPlan) ? sandboxRecord.rollbackPlan
    : null;
  if (rollback) {
    container.appendChild(sectionHeading(t('review.console.rollback', null, lang), 'settings_backup_restore'));
    container.appendChild(listRow(t('review.console.available', null, lang), rollback.available === true ? t('common.yes', null, lang) : t('common.no', null, lang)));
    const restoreSourceText = _safeText(rollback.restoreSource, '');
    if (restoreSourceText) container.appendChild(listRow(t('review.console.restoreSource', null, lang), restoreSourceText === 'legacy' ? t('common.legacy', null, lang) || restoreSourceText : restoreSourceText));
    if (Array.isArray(rollback.steps) && rollback.steps.length) {
      const stepsList = el('ol', { style: 'margin:6px 0 0;padding-left:18px;font-size:11.5px;color:var(--text-dim);line-height:1.7;overflow-wrap:anywhere' });
      // The five rollback steps are a fixed, stable sequence (never
      // dynamic/parameterized) — translated by ordinal position via
      // the review.console.rollbackStep.<n> dictionary namespace,
      // falling back to Core's raw English only for an unexpected
      // (6th+) step, which should never happen in practice.
      rollback.steps.forEach((step, idx) => {
        const stepKey = `review.console.rollbackStep.${idx}`;
        const translated = t(stepKey, null, lang);
        const text = translated !== stepKey ? translated : _safeText(step, '(unrepresentable step)');
        stepsList.appendChild(el('li', { text }));
      });
      container.appendChild(stepsList);
    }
  } else {
    container.appendChild(sectionHeading(t('review.console.rollback', null, lang), 'settings_backup_restore'));
    container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: t('review.rollbackUnavailable', null, lang) }));
  }
}

/** Clears `container`'s content using replaceChildren() where supported, falling back to innerHTML='' only for environments without it. Never uses dynamic innerHTML with content. */
function _clearContainer(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else container.innerHTML = '';
}

/**
 * Main entry point. Renders the full Controlled Preview Review Console
 * into `container` (an existing DOM element — its previous content is
 * cleared and replaced, never appended-to indefinitely).
 *
 * As of Phase C-B this includes interactive Pass/Fail/Needs-Adjustment/
 * Pending controls and an editable reviewer-note field per item, plus
 * a console-level Reset Review control — but this function ITSELF
 * still performs zero state mutation and computes zero derived Review
 * State field: it only builds DOM marked with
 * `data-review-action`/`data-review-item-id`/`data-review-note`
 * attributes for `ui/review-console-controller.js`'s event delegation
 * to act on; all engine calls happen exclusively in that controller.
 *
 * `uiState` (optional, 4th param) is the read-only, controller-owned
 * transient UI state (currently: which item IDs have an armed "Confirm
 * Fail?" prompt, and whether the console-level Reset confirmation is
 * showing) — obtained from the controller's `getUiState()`. Omitting
 * it (or passing `null`) is safe and simply renders every control in
 * its default, non-confirming state.
 *
 * RESILIENT BY DESIGN: safe to call with `sandbox`/`reviewState` in
 * ANY shape — both `null`, missing fields, wrong types, malformed
 * array entries, non-finite numbers, or circular references — this
 * function is guaranteed never to throw. On any unexpected internal
 * failure it clears whatever partial content may exist and renders a
 * neutral, honest fallback message instead of leaving a half-built or
 * crashed console on screen.
 */
export function renderReviewConsole(container, sandbox, reviewState, uiState = null, lang = 'en') {
  if (!container || typeof container.appendChild !== 'function') return;

  try {
    _clearContainer(container); // clearing our OWN previously-rendered (trusted, DOM-API-built) content — not an XSS vector
    _unrepresentableLang = lang === 'th' ? 'th' : 'en';
    _renderBody(container, sandbox, reviewState, uiState, lang === 'th' ? 'th' : 'en');
  } catch (err) {
    // Never let malformed upstream data crash the host page. Clear any
    // partial content and show a neutral, honest fallback — this never
    // pretends the console rendered successfully, and never affects
    // production output regardless of what failed.
    try { _clearContainer(container); } catch { /* container itself is unusable — nothing more we can safely do */ }
    try {
      container.appendChild(el('div', {
        style: 'font-size:12px;color:var(--warn);padding:10px 0',
        text: t('review.malformedFallback', null, lang) || 'Preview review data could not be displayed (unexpected format). This does not affect your exported preset.',
      }));
    } catch { /* even the fallback failed — give up silently rather than throwing */ }
  }
}
