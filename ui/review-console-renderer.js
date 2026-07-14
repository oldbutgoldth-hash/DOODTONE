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

const STATUS_COLOR = { passed: 'var(--success)', failed: 'var(--danger)', pending: 'var(--text-faint)', unavailable: 'var(--text-faint)', 'not-required': 'var(--text-faint)' };
const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', pending: 'Pending', unavailable: 'Unavailable', 'not-required': 'Not required' };
const ALLOWED_STATUSES = new Set(Object.keys(STATUS_LABEL));

const DECISION_LABEL = { approve: 'Approve', reject: 'Reject', 'needs-adjustment': 'Needs adjustment', undecided: 'Undecided' };
const DECISION_COLOR = { approve: 'var(--success)', reject: 'var(--danger)', 'needs-adjustment': 'var(--warn)', undecided: 'var(--text-faint)' };
const ALLOWED_DECISIONS = new Set(Object.keys(DECISION_LABEL));

const APPROVAL_COLOR = { approved: 'var(--success)', rejected: 'var(--danger)', blocked: 'var(--danger)', 'needs-adjustment': 'var(--warn)', 'in-progress': 'var(--accent)', 'not-started': 'var(--text-faint)', unavailable: 'var(--text-faint)' };

// Risk levels normalize to exactly these 5 — "unknown" must never be
// treated or colored as "low". "none" is accepted as an upstream
// synonym for "low" (it genuinely means equal-or-less risk than low,
// never more) since the data model sometimes uses it for over-stack
// severity; everything else unrecognized becomes "unknown".
const RISK_SYNONYMS = { none: 'low', low: 'low', medium: 'medium', med: 'medium', high: 'high', critical: 'critical' };
const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', unknown: 'Unknown' };
const RISK_COLOR = { low: 'var(--success)', medium: 'var(--warn)', high: 'var(--danger)', critical: 'var(--danger)', unknown: 'var(--text-faint)' };

/** True for plain, non-null, non-array objects — the only shape we treat as a "record" to read named fields from. */
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
    return '(unrepresentable value)';
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
function _describeHardStops(value) {
  if (Array.isArray(value)) return value.length === 0 ? { text: 'None', color: 'var(--success)' } : { text: `${value.length} active`, color: 'var(--danger)' };
  if (typeof value === 'number') return Number.isFinite(value) ? (value <= 0 ? { text: 'None', color: 'var(--success)' } : { text: `${value} active`, color: 'var(--danger)' }) : { text: 'Unknown', color: 'var(--text-faint)' };
  if (typeof value === 'boolean') return value ? { text: 'Present', color: 'var(--danger)' } : { text: 'None', color: 'var(--success)' };
  if (_isRecord(value)) return { text: 'Present (details unavailable)', color: 'var(--warn)' };
  return { text: 'Unknown', color: 'var(--text-faint)' };
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
function renderActionButtons(item, itemLabel, statusKey, decisionKey, isFailConfirmPending) {
  const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:7px;margin-top:10px' });
  const makeBtn = ({ label, action, active, color, ariaLabel }) => el('button', {
    style: `min-height:44px;padding:9px 15px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${active ? color : 'var(--border)'};background:${active ? color + '20' : 'var(--surface-2)'};color:${active ? color : 'var(--text-dim)'};overflow-wrap:anywhere`,
    text: label,
    attrs: {
      type: 'button',
      'data-review-action': action,
      'aria-label': ariaLabel,
      'aria-pressed': String(active),
    },
  });

  if (isFailConfirmPending) {
    wrap.appendChild(makeBtn({ label: 'Confirm Fail?', action: 'fail', active: true, color: 'var(--danger)', ariaLabel: `Confirm marking "${itemLabel}" as failed` }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 15px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
      text: 'Cancel',
      attrs: { type: 'button', 'data-review-action': 'cancel-confirm', 'aria-label': `Cancel failing "${itemLabel}"` },
    }));
    return wrap;
  }

  wrap.appendChild(makeBtn({ label: ACTION_LABEL.pass, action: 'pass', active: statusKey === 'passed' && decisionKey === 'approve', color: 'var(--success)', ariaLabel: `${ACTION_LABEL.pass} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: ACTION_LABEL.fail, action: 'fail', active: statusKey === 'failed', color: 'var(--danger)', ariaLabel: `${ACTION_LABEL.fail} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: ACTION_LABEL.adjust, action: 'adjust', active: decisionKey === 'needs-adjustment', color: 'var(--warn)', ariaLabel: `${ACTION_LABEL.adjust} — ${itemLabel}` }));
  wrap.appendChild(makeBtn({ label: ACTION_LABEL.pending, action: 'pending', active: statusKey === 'pending' && decisionKey === 'undecided', color: 'var(--text-dim)', ariaLabel: `Return "${itemLabel}" to ${ACTION_LABEL.pending.toLowerCase()}` }));
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
function renderNoteField(item, itemId, itemLabel) {
  const wrap = el('div', { style: 'margin-top:10px' });
  const fieldId = `review-note-${itemId}`;
  wrap.appendChild(el('label', {
    style: 'display:block;font-size:9.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;font-family:var(--font-mono);margin-bottom:4px',
    text: 'Reviewer note',
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
function renderChecklistItem(item, uiState) {
  const wrap = el('div', { style: 'padding:12px 0;border-bottom:1px solid var(--border)' });

  if (!_isRecord(item)) {
    wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-faint);font-style:italic', text: 'Invalid review item data — skipped.' }));
    return wrap;
  }

  const itemId = typeof item.id === 'string' ? item.id : '';
  if (itemId) wrap.setAttribute('data-review-item-id', itemId);

  const top = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px' });
  const labelCol = el('div', { style: 'flex:1;min-width:0' });
  const itemLabel = _safeText(item.label, 'Untitled review item');
  labelCol.appendChild(el('div', { style: 'font-size:13px;font-weight:600;color:var(--text);overflow-wrap:anywhere', text: itemLabel }));
  const descriptionText = _safeText(item.description, '');
  if (descriptionText) {
    labelCol.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px;line-height:1.4;overflow-wrap:anywhere', text: descriptionText }));
  }
  top.appendChild(labelCol);
  const statusKey = _normalizeStatus(item.status); // unknown/malformed statuses normalize to "unavailable" — NEVER "passed"
  top.appendChild(badge(STATUS_LABEL[statusKey], STATUS_COLOR[statusKey]));
  wrap.appendChild(top);

  // ── Category / Required-Optional / Reviewer decision — always shown ──────
  const metaRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:7px' });
  const categoryText = _safeText(item.category, '');
  if (categoryText) metaRow.appendChild(badge(categoryText.toUpperCase(), 'var(--text-faint)'));
  const isRequired = item.required !== false; // anything other than an explicit `false` is treated as required (never silently downgraded)
  metaRow.appendChild(badge(isRequired ? 'Required' : 'Optional', isRequired ? 'var(--accent)' : 'var(--text-faint)'));
  const decisionKey = _normalizeDecision(item.reviewerDecision); // unknown/malformed decisions normalize to "undecided"
  metaRow.appendChild(badge(DECISION_LABEL[decisionKey], DECISION_COLOR[decisionKey]));
  wrap.appendChild(metaRow);

  const reasonText = _safeText(item.reason, '');
  if (reasonText) {
    wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:6px;font-style:italic;overflow-wrap:anywhere', text: reasonText }));
  }
  if (_isRecord(item.evidence) && Object.keys(item.evidence).length) {
    const evWrap = el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:6px;font-family:var(--font-mono);overflow-wrap:anywhere' });
    const parts = Object.entries(item.evidence).map(([k, v]) => `${_safeText(k, '?')}=${_safeText(v, 'null')}`);
    evWrap.textContent = parts.join(' \u00B7 '); // evidence values (e.g. "skinRisk=low") — plain text only, never HTML
    wrap.appendChild(evWrap);
  }
  const itemWarnings = Array.isArray(item.warnings) ? item.warnings : [];
  if (itemWarnings.length) {
    const warnWrap = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
    for (const w of itemWarnings) {
      const text = typeof w === 'string' ? w : _safeText(w, '(unrepresentable warning)');
      if (!text) continue;
      warnWrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    }
    wrap.appendChild(warnWrap);
  }
  const updatedText = _safeDateText(item.updatedAt); // '' for missing/invalid — never renders "Invalid Date"
  if (updatedText) {
    wrap.appendChild(el('div', { style: 'font-size:10px;color:var(--text-faint);margin-top:6px;font-family:var(--font-mono)', text: `Updated ${updatedText}` }));
  }

  // ── Interactive controls — only when the item has a real, actionable ID ──
  if (itemId) {
    const isFailConfirmPending = uiState?.pendingConfirmItemIds instanceof Set && uiState.pendingConfirmItemIds.has(itemId);
    wrap.appendChild(renderActionButtons(item, itemLabel, statusKey, decisionKey, isFailConfirmPending));
    wrap.appendChild(renderNoteField(item, itemId, itemLabel));
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
function renderResetButton(uiState) {
  const wrap = el('div', { style: 'margin-top:18px;padding-top:16px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:9px' });

  if (uiState?.resetConfirmPending) {
    wrap.appendChild(el('span', { style: 'font-size:12px;color:var(--text-dim);overflow-wrap:anywhere', text: 'Reset all review progress? This clears every status, decision, and note.' }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 16px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid var(--danger);background:var(--danger);color:var(--on-accent)',
      text: 'Yes, Reset',
      attrs: { type: 'button', 'data-review-action': 'reset-review', 'aria-label': 'Confirm reset of all review progress' },
    }));
    wrap.appendChild(el('button', {
      style: 'min-height:44px;padding:9px 16px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
      text: 'Cancel',
      attrs: { type: 'button', 'data-review-action': 'reset-cancel', 'aria-label': 'Cancel reset' },
    }));
    return wrap;
  }

  wrap.appendChild(el('button', {
    style: 'min-height:44px;padding:9px 18px;border-radius:3px;font-family:var(--font-sans);font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
    text: 'Reset Review',
    attrs: { type: 'button', 'data-review-action': 'reset-review', 'aria-label': 'Reset all review progress' },
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
function renderPreviewRiskReview(container, riskReview) {
  if (!_isRecord(riskReview)) return;
  container.appendChild(sectionHeading('Preview Risk Review', 'shield'));
  const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' });

  const overallLevel = _normalizeRiskLevel(riskReview.level);
  grid.appendChild(riskCell('Overall Level', RISK_LABEL[overallLevel], RISK_COLOR[overallLevel]));

  const hardStops = _describeHardStops(riskReview.hardStops);
  grid.appendChild(riskCell('Hard Stops', hardStops.text, hardStops.color));

  const rows = [
    ['Over-stack Severity', riskReview.overStackSeverity],
    ['Skin Risk', riskReview.skinRisk],
    ['Highlight Risk', riskReview.highlightRisk],
    ['Shadow Risk', riskReview.shadowRisk],
    ['White Balance Risk', riskReview.whiteBalanceRisk],
    ['Color Risk', riskReview.colorRisk],
    ['Export Risk', riskReview.exportRisk],
    ['Production Write Risk', riskReview.productionWriteRisk],
  ];
  for (const [label, raw] of rows) {
    const level = _normalizeRiskLevel(raw);
    grid.appendChild(riskCell(label, RISK_LABEL[level], RISK_COLOR[level]));
  }

  container.appendChild(grid);
}

/**
 * Builds the full console body into `container`. Assumes `container`
 * has already been validated and cleared by the caller
 * (renderReviewConsole). Any exception thrown while building this body
 * is caught by the caller, never escapes to the host page.
 */
function _renderBody(container, sandbox, reviewState, uiState) {
  const sandboxRecord = _isRecord(sandbox) ? sandbox : null;
  const reviewRecord = _isRecord(reviewState) ? reviewState : null;

  if (!sandboxRecord && !reviewRecord) {
    container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text-faint);padding:10px 0', text: 'No preview is available to review yet.' }));
    return;
  }

  // ── Top summary ──────────────────────────────────────────────────────────
  const summaryRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px' });
  if (sandboxRecord) summaryRow.appendChild(badge(`Preview: ${_safeText(sandboxRecord.previewState, 'unknown')}`, sandboxRecord.canGeneratePreview === true ? 'var(--success)' : 'var(--text-faint)'));
  if (reviewRecord) summaryRow.appendChild(badge(`Review: ${_safeText(reviewRecord.approvalState, 'unknown')}`, APPROVAL_COLOR[reviewRecord.approvalState] ?? 'var(--text-faint)'));
  container.appendChild(summaryRow);

  const photographerLine = _safeText(reviewRecord?.reviewSummary?.photographerMessage, '') || _safeText(sandboxRecord?.photographerSummary, '') || 'Preparing preview review information.';
  container.appendChild(el('div', { style: 'font-size:13px;color:var(--text);line-height:1.6;margin-bottom:4px;overflow-wrap:anywhere', text: photographerLine }));

  // ── Tri-state confirmations — never claim more than the data supports ────
  const confirmWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px;margin:14px 0;padding:12px 14px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--success)' });

  const previewNonProductionStatus = _evaluatePreviewNonProduction(sandboxRecord);
  statusLine(confirmWrap, {
    confirmedText: 'Preview: Confirmed Non-production.',
    anomalyText: 'Preview reports an unexpected production state — treat with caution.',
    unknownText: 'Preview: Unknown / Not confirmed.',
    status: previewNonProductionStatus,
  });

  const canExportPreview = sandboxRecord ? sandboxRecord.canExportPreview : undefined;
  statusLine(confirmWrap, {
    confirmedText: 'Export remains disabled (canExportPreview=false).',
    anomalyText: `Export flag reports an unexpected value (canExportPreview=${_safeText(canExportPreview, 'unknown')}) — this should never happen; treat with caution.`,
    unknownText: 'Export status cannot be confirmed yet (preview sandbox not available).',
    status: typeof canExportPreview !== 'boolean' ? 'unknown' : (canExportPreview === false ? 'confirmed' : 'anomaly'),
  });

  const canWriteProduction = sandboxRecord ? sandboxRecord.canWriteProduction : undefined;
  statusLine(confirmWrap, {
    confirmedText: 'Production write remains disabled (canWriteProduction=false).',
    anomalyText: `Production write flag reports an unexpected value (canWriteProduction=${_safeText(canWriteProduction, 'unknown')}) — this should never happen; treat with caution.`,
    unknownText: 'Production write status cannot be confirmed yet (preview sandbox not available).',
    status: typeof canWriteProduction !== 'boolean' ? 'unknown' : (canWriteProduction === false ? 'confirmed' : 'anomaly'),
  });

  const selectedOutputSource = sandboxRecord ? sandboxRecord.selectedOutputSource : undefined;
  statusLine(confirmWrap, {
    confirmedText: 'Production Mapping remains legacy (selectedOutputSource="legacy").',
    anomalyText: `Production Mapping reports an unexpected source (selectedOutputSource=${_safeText(selectedOutputSource, 'unknown')}) — this should never happen; treat with caution.`,
    unknownText: 'Production Mapping status cannot be confirmed yet (preview sandbox not available).',
    status: typeof selectedOutputSource !== 'string' ? 'unknown' : (selectedOutputSource === 'legacy' ? 'confirmed' : 'anomaly'),
  });
  container.appendChild(confirmWrap);

  // ── XMP Export confirmation — only asserted when explicit evidence exists ─
  const xmpUnchangedHint = reviewRecord?.metadata?.xmpExportUnchanged ?? sandboxRecord?.metadata?.xmpExportUnchanged;
  const xmpStripWrap = el('div', { style: 'margin-bottom:14px' });
  statusLine(xmpStripWrap, {
    confirmedText: 'XMP Export: Unchanged.',
    anomalyText: 'XMP Export reports an unexpected state — this should never happen; treat with caution.',
    unknownText: 'XMP Export: Unknown / Not confirmed.',
    status: typeof xmpUnchangedHint !== 'boolean' ? 'unknown' : (xmpUnchangedHint === true ? 'confirmed' : 'anomaly'),
  });
  container.appendChild(xmpStripWrap);

  // ── Preview Risk Review ──────────────────────────────────────────────────
  renderPreviewRiskReview(container, sandboxRecord?.previewRiskReview);

  // ── Review progress (with ARIA progressbar semantics) ────────────────────
  const progress = _isRecord(reviewRecord?.reviewProgress) ? reviewRecord.reviewProgress : null;
  const normalizedProgress = progress ? _normalizeProgress(progress) : null;
  if (normalizedProgress?.available) {
    container.appendChild(sectionHeading('Review Progress', 'fact_check'));
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
        'aria-label': `Review progress: ${completedText} of ${requiredText} required checks completed`,
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
      text: resolvedNext ? `Next: ${resolvedNext}` : 'All required review items completed',
    }));
  } else if (reviewRecord) {
    container.appendChild(sectionHeading('Review Progress', 'fact_check'));
    container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: 'Review progress unavailable.' }));
  }

  // ── Checklist (interactive — Pass/Fail/Adjust/Pending + note) ────────────
  const reviewItems = Array.isArray(reviewRecord?.reviewItems) ? reviewRecord.reviewItems : [];
  if (reviewItems.length) {
    container.appendChild(sectionHeading('Human Review Checklist', 'checklist'));
    const listWrap = el('div');
    for (const item of reviewItems) {
      listWrap.appendChild(renderChecklistItem(item, uiState));
    }
    container.appendChild(listWrap);
    container.appendChild(renderResetButton(uiState));
  }

  // ── Blockers — merged and deduplicated from BOTH sources ─────────────────
  const blockers = _mergeAndDedupe(reviewRecord?.blockers, sandboxRecord?.blockers);
  if (blockers.length) {
    container.appendChild(sectionHeading('Blockers', 'block'));
    const blkWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    for (const text of blockers) {
      blkWrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--danger);padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--danger);overflow-wrap:anywhere', text }));
    }
    container.appendChild(blkWrap);
  }

  // ── Warnings — merged and deduplicated from BOTH sources ─────────────────
  const warnings = _mergeAndDedupe(reviewRecord?.warnings, sandboxRecord?.warnings);
  if (warnings.length) {
    container.appendChild(sectionHeading('Warnings', 'warning'));
    const warnWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    for (const text of warnings) {
      warnWrap.appendChild(el('div', { style: 'font-size:11px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    }
    container.appendChild(warnWrap);
  }

  // ── Rollback ──────────────────────────────────────────────────────────────
  const rollback = _isRecord(reviewRecord?.rollbackPlan) ? reviewRecord.rollbackPlan
    : _isRecord(sandboxRecord?.rollbackPlan) ? sandboxRecord.rollbackPlan
    : null;
  if (rollback) {
    container.appendChild(sectionHeading('Rollback', 'settings_backup_restore'));
    container.appendChild(listRow('Available', rollback.available === true ? 'Yes' : 'No'));
    const restoreSourceText = _safeText(rollback.restoreSource, '');
    if (restoreSourceText) container.appendChild(listRow('Restore source', restoreSourceText));
    if (Array.isArray(rollback.steps) && rollback.steps.length) {
      const stepsList = el('ol', { style: 'margin:6px 0 0;padding-left:18px;font-size:11.5px;color:var(--text-dim);line-height:1.7;overflow-wrap:anywhere' });
      for (const step of rollback.steps) {
        stepsList.appendChild(el('li', { text: _safeText(step, '(unrepresentable step)') }));
      }
      container.appendChild(stepsList);
    }
  } else {
    container.appendChild(sectionHeading('Rollback', 'settings_backup_restore'));
    container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: 'Rollback information unavailable.' }));
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
export function renderReviewConsole(container, sandbox, reviewState, uiState = null) {
  if (!container || typeof container.appendChild !== 'function') return;

  try {
    _clearContainer(container); // clearing our OWN previously-rendered (trusted, DOM-API-built) content — not an XSS vector
    _renderBody(container, sandbox, reviewState, uiState);
  } catch (err) {
    // Never let malformed upstream data crash the host page. Clear any
    // partial content and show a neutral, honest fallback — this never
    // pretends the console rendered successfully, and never affects
    // production output regardless of what failed.
    try { _clearContainer(container); } catch { /* container itself is unusable — nothing more we can safely do */ }
    try {
      container.appendChild(el('div', {
        style: 'font-size:12px;color:var(--warn);padding:10px 0',
        text: 'Preview review data could not be displayed (unexpected format). This does not affect your exported preset.',
      }));
    } catch { /* even the fallback failed — give up silently rather than throwing */ }
  }
}
