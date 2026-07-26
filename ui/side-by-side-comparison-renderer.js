/**
 * ui/side-by-side-comparison-renderer.js
 *
 * Side-by-Side Preview Comparison Console (EPIC 2E-G Phase C).
 *
 * A pure, READ-ONLY UI layer over the already-computed
 * `finalStyleIntent.sideBySidePreviewComparisonV2` object. This module
 * NEVER:
 * - re-runs image analysis, K-Means, or any analysis pipeline stage
 * - calls decision-engine, lightroom-mapping-engine, preset-engine,
 *   xmp-validator, or the Comparison Engine itself
 * - writes to production XMP or Lightroom Mapping in any way
 * - calculates similarity, divergence, saferSide, approval, evidence
 *   score, or preferred side itself — every value shown is read
 *   directly from the canonical object already computed by
 *   mapping-v2-side-by-side-comparison.js
 * - renders a real or fake preview image, a Before/After slider, zoom,
 *   pan, or ANY comparison-changing / Export / Apply / activation
 *   control (no checkboxes, no approval actions, no state mutation of
 *   any kind) — this phase is data-level display only. The ONE
 *   exception is a single, optional, safe internal-navigation button
 *   ("Go to Review Console") that only scrolls the page to the
 *   existing Review Console section — it changes no data, mutates no
 *   state, and calls no engine.
 * - persists anything to localStorage or any other storage
 *
 * VISUAL HONESTY: this module never implies a rendered image preview
 * exists. `canRenderLegacyPreview`/`canRenderV2Preview`/
 * `canCompareVisually` are always displayed as their actual (currently
 * always-false) values — never inferred, never defaulted to a
 * reassuring state from missing evidence.
 *
 * XSS SAFETY: every piece of text that ultimately originates from
 * upstream comparison data (summaries, reasons, warnings, evidence) is
 * inserted via `textContent`/`document.createElement`, never via
 * `innerHTML` string interpolation. Clearing the container uses
 * `replaceChildren()`.
 *
 * RESILIENCE: every value read from the comparison object is treated
 * as UNTRUSTED — wrong types, missing fields, null array entries,
 * non-finite numbers, and circular references are all handled without
 * throwing. The top-level render is wrapped in a try/catch so no
 * malformed data can throw an uncaught exception out of this module.
 */

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase B/J:
// all user-facing text in this module is now sourced from the
// centralized ui/i18n module (`t()`), threaded through as an explicit
// `locale` parameter on every render function -- never captured once
// and reused stale. English remains the automatic fallback for any
// key genuinely missing in Thai (see ui/i18n/index.js). This module
// still computes NOTHING about business state -- `locale` only
// changes which strings are shown, never which branch is taken.
import { t } from './i18n/index.js';
import { presentDimensionName, presentComparisonBlockerCode, presentComparisonWarningCode, presentComparisonRecommendationCode, presentComparisonSummaryCode } from './i18n/domain-presenters.js';

/** Converts a hyphenated internal code ('legacy-stronger') to the camelCase leaf key used under each i18n namespace ('legacyStronger'). Pure text mapping only -- never used for business logic. */
function _camelFromCode(code) {
  return typeof code === 'string' ? code.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) : code;
}

/** Looks up a normalized internal code under an i18n namespace, e.g. _trCode('comparison.direction', 'legacy-stronger', locale). Never throws; falls back to the raw code if no translation exists (never blank). */
function _trCode(namespace, code, locale) {
  if (typeof code !== 'string' || !code) return t('common.unknown', null, locale);
  const key = `${namespace}.${_camelFromCode(code)}`;
  const text = t(key, null, locale);
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase F BUGFIX: `t()` returns the
  // LITERAL KEY when a key is missing (it never returns '' or
  // undefined), so the previous `t(key) || code` fallback could never
  // fire -- an unmapped code rendered a raw dotted key path such as
  // "comparison.evidenceLevel.moderate" straight onto a
  // photographer-facing surface. Detect that passthrough explicitly and
  // degrade to the honest localized "unknown" label instead.
  if (text === key) return t('common.unknown', null, locale);
  return text;
}

const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', unknown: 'Unknown' };
const RISK_COLOR = { low: 'var(--success)', medium: 'var(--warn)', high: 'var(--danger)', critical: 'var(--danger)', unknown: 'var(--text-faint)' };
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

const DIRECTION_LABEL = {
  similar: 'Similar', 'legacy-stronger': 'Legacy Stronger', 'v2-stronger': 'V2 Stronger',
  'legacy-safer': 'Legacy Safer', 'v2-safer': 'V2 Safer', mixed: 'Mixed', unknown: 'Unknown',
};
const DIRECTION_COLOR = {
  similar: 'var(--success)', 'legacy-stronger': 'var(--accent)', 'v2-stronger': 'var(--accent)',
  'legacy-safer': 'var(--success)', 'v2-safer': 'var(--success)', mixed: 'var(--warn)', unknown: 'var(--text-faint)',
};

const SIDE_LABEL = { legacy: 'Legacy', v2: 'V2', tie: 'Tie', 'human-review': 'Human Review Required', unknown: 'Unknown' };
const SIDE_COLOR = { legacy: 'var(--accent)', v2: 'var(--accent)', tie: 'var(--text-dim)', 'human-review': 'var(--warn)', unknown: 'var(--text-faint)' };

const STATE_LABEL = {
  unavailable: 'Unavailable', partial: 'Partial', blocked: 'Blocked',
  'ready-for-review': 'Ready for Review', reviewed: 'Reviewed', 'insufficient-evidence': 'Insufficient Evidence',
};
const STATE_COLOR = {
  unavailable: 'var(--text-faint)', partial: 'var(--warn)', blocked: 'var(--danger)',
  'ready-for-review': 'var(--accent)', reviewed: 'var(--success)', 'insufficient-evidence': 'var(--text-faint)',
};

const EVIDENCE_LABEL = { insufficient: 'Insufficient', limited: 'Limited', moderate: 'Moderate', strong: 'Strong' };
const EVIDENCE_COLOR = { insufficient: 'var(--text-faint)', limited: 'var(--warn)', moderate: 'var(--accent)', strong: 'var(--success)' };

const APPROVAL_STATE_LABEL = {
  'not-started': 'Not Started', 'in-progress': 'In Progress', blocked: 'Blocked',
  'needs-adjustment': 'Needs Adjustment', rejected: 'Rejected', approved: 'Approved', unavailable: 'Unavailable',
};
const APPROVAL_STATE_COLOR = {
  'not-started': 'var(--text-faint)', 'in-progress': 'var(--accent)', blocked: 'var(--danger)',
  'needs-adjustment': 'var(--warn)', rejected: 'var(--danger)', approved: 'var(--success)', unavailable: 'var(--text-faint)',
};
function _normalizeApprovalState(v) {
  return typeof v === 'string' && APPROVAL_STATE_LABEL[v] ? v : 'unavailable';
}

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

const _KNOWN_TEXT_KEYS = ['message', 'reason', 'summary', 'label', 'description', 'finding', 'text', 'warning', 'blocker'];
const _MAX_TEXT_LENGTH = 500;

function _truncate(text) {
  if (typeof text !== 'string') return text;
  return text.length > _MAX_TEXT_LENGTH ? `${text.slice(0, _MAX_TEXT_LENGTH)}\u2026` : text;
}

/**
 * Safely converts an arbitrary value to display text — never dumps raw
 * JSON of an unknown object, never "[object Object]", never throws on
 * circular references. For objects, tries a short list of known
 * human-readable keys first (message/reason/summary/label/description/
 * finding/text/warning/blocker) and returns the first non-empty string
 * found; only falls back to a neutral, generic message if none of
 * those keys yield a usable string — this is deliberately NOT a JSON
 * dump, since that could expose large/technical/circular structures
 * directly to a photographer-facing surface. Long text is truncated
 * safely with an ellipsis.
 */
// FULL-SYSTEM I18N COMPLETION R2 -- Phase F/J: `_safeText` is a deep,
// widely-called generic helper whose neutral fallback string is
// photographer-facing. Threading `locale` through every one of its ~40
// call sites would be a large, risk-bearing refactor for no behavioural
// gain, so the ACTIVE RENDER LOCALE is recorded here at the top of each
// render pass and read back only for that one generic fallback. This is
// presentation state only -- it never affects business logic, never
// persists beyond the current synchronous render, and is reset on every
// render call.
let _renderLocale = 'en';
function _genericInfoFallback() {
  return t('comparison.additionalInfoAvailable', null, _renderLocale);
}

function _safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return _truncate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.filter(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean').map(v => String(v)).slice(0, 10);
    return parts.length ? _truncate(parts.join(', ')) : _genericInfoFallback();
  }
  if (typeof value === 'object') {
    for (const key of _KNOWN_TEXT_KEYS) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return _truncate(candidate);
    }
    // Unknown object shape (including circular references, which never
    // even reach here since we never attempt JSON.stringify on them) —
    // a neutral, non-technical fallback rather than any raw dump.
    return _genericInfoFallback();
  }
  return fallback;
}

function _normalizeRiskLevel(v) {
  if (typeof v === 'string' && RISK_LEVELS.has(v.toLowerCase())) return v.toLowerCase();
  return 'unknown';
}

function _normalizeDirection(v) {
  return typeof v === 'string' && DIRECTION_LABEL[v] ? v : 'unknown';
}

function _normalizeSide(v) {
  return typeof v === 'string' && SIDE_LABEL[v] ? v : 'unknown';
}

function _normalizeState(v) {
  return typeof v === 'string' && STATE_LABEL[v] ? v : 'unavailable';
}

function _normalizeEvidenceLevel(v) {
  return typeof v === 'string' && EVIDENCE_LABEL[v] ? v : 'insufficient';
}

/** Formats a 0-1 similarity/confidence value as a whole-number percentage — never false precision, never NaN/Infinity. */
function _formatPercent(v) {
  if (!Number.isFinite(v)) return 'Unknown';
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `${pct}%`;
}

function _yesNoUnknown(v, locale) {
  if (v === true) return t('common.yes', null, locale);
  if (v === false) return t('common.no', null, locale);
  return t('common.unknown', null, locale);
}

/** Creates an element with optional class/style/text/attrs — text always via textContent. */
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
  if (iconGlyph) row.appendChild(el('span', { cls: 'material-symbols-outlined', style: "font-family:'Material Symbols Outlined';font-size:14px;color:var(--accent)", text: iconGlyph }));
  row.appendChild(el('span', { text }));
  return row;
}

/** A "label: value" row — valueNode may be a real DOM Node or any other value (safely stringified). */
function listRow(labelText, valueNode) {
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11.5px' });
  row.appendChild(el('span', { style: 'color:var(--text-dim)', text: labelText }));
  const valWrap = el('div', { style: 'text-align:right;color:var(--text);overflow-wrap:anywhere' });
  if (valueNode instanceof Node) valWrap.appendChild(valueNode);
  else valWrap.textContent = _safeText(valueNode, '');
  row.appendChild(valWrap);
  return row;
}

/** A tri-state confirmation line (same visual language as the Review Console's safety strip): Confirmed/Anomaly/Unknown — never a false green checkmark for missing evidence. */
/**
 * A tri-state confirmation line (same visual language as the Review
 * Console's safety strip): CONFIRMED (green checkmark — explicit
 * evidence supports the safe state), ANOMALY (red/danger warning icon
 * — explicit evidence shows an unexpected, unsafe state; this should
 * never happen upstream, but must be reported honestly, never hidden),
 * or UNKNOWN (neutral dash — no evidence to confirm anything either
 * way). Missing evidence must never be inferred as safe.
 */
function statusLine(wrap, { confirmedText, anomalyText, unknownText, status }) {
  const color = status === 'confirmed' ? 'var(--success)' : status === 'anomaly' ? 'var(--danger)' : 'var(--text-faint)';
  const icon = status === 'confirmed' ? '\u2713' : status === 'anomaly' ? '\u26A0' : '\u2014';
  const text = status === 'confirmed' ? confirmedText : status === 'anomaly' ? anomalyText : unknownText;
  wrap.appendChild(el('div', { style: `font-size:11.5px;color:${color};display:flex;align-items:flex-start;gap:6px;overflow-wrap:anywhere`, text: `${icon}  ${text}` }));
}

/** Merges and deduplicates one or more possibly-malformed message arrays into safe display strings. */
function _mergeMessages(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      let text;
      if (typeof raw === 'string') text = raw;
      else text = _safeText(raw, '');
      const trimmed = text.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

// I18N RUNTIME CLOSURE R3 -- Phase F: `core/lightroom-mapping-engine/
// mapping-v2-side-by-side-comparison.js` is a PRODUCTION-LOCKED file
// (byte-for-byte hash checked by
// qa/epic-2e-j-r2-phase-e-static-test.mjs against
// qa/baselines/lufa42-production-lock-manifest.json) -- it cannot be
// edited to emit stable codes. Its raw English blockers/warnings/
// recommendations/photographerSummary are instead drawn from a SMALL,
// FIXED, ENUMERABLE set of literal sentences (never free-form user or
// AI-generated text), so this UI-local classifier safely maps each
// EXACT known sentence to a stable code entirely at the presentation
// boundary -- the locked file's contract (its exact string outputs)
// is never altered, read, or depended upon beyond string equality.
// An unrecognized sentence (a genuinely new Core message not yet
// classified here) safely falls through to the raw English text,
// same fail-open-toward-visibility convention used throughout R3.
const _COMPARISON_BLOCKER_CLASSIFIERS = [
  [/^Both Legacy and V2 preview data are unavailable\.$/, 'BOTH_PREVIEWS_DATA_UNAVAILABLE', null],
  [/^V2 preview is unavailable — nothing to compare against Legacy yet\.$/, 'V2_DATA_UNAVAILABLE', null],
  [/^Legacy comparison evidence is missing\.$/, 'LEGACY_EVIDENCE_MISSING', null],
  [/^(\d+) hard stop\(s\) are currently active\.$/, 'HARD_STOPS_ACTIVE', (m) => ({ count: m[1] })],
  [/^Critical over-stack severity is currently active\.$/, 'CRITICAL_OVERSTACK_ACTIVE', null],
  [/^Comparison confidence is too low \(insufficient evidence\)\.$/, 'CONFIDENCE_TOO_LOW', null],
  [/^Human visual evidence is required but not yet complete\.$/, 'VISUAL_REVIEW_INCOMPLETE', null],
];
const _COMPARISON_WARNING_CLASSIFIERS = [
  [/^Comparison is based on partial evidence — one or both preview sides are unavailable\.$/, 'PARTIAL_EVIDENCE', null],
];
const _COMPARISON_RECOMMENDATION_CLASSIFIERS = [
  [/^Continue using Legacy Mapping — production output is unaffected by this comparison\.$/, 'CONTINUE_LEGACY_MAPPING', null],
  [/^Rerun analysis or wait for the V2 Preview Sandbox to become eligible before comparing\.$/, 'RERUN_OR_WAIT_FOR_SANDBOX', null],
  [/^Review skin tones manually\.$/, 'REVIEW_SKIN_TONES_MANUALLY', null],
  [/^Review highlights manually\.$/, 'REVIEW_HIGHLIGHTS_MANUALLY', null],
  [/^Compare white balance visually\.$/, 'COMPARE_WHITE_BALANCE_VISUALLY', null],
  [/^Resolve over-stack risk before further review\.$/, 'RESOLVE_OVERSTACK_RISK', null],
  [/^Collect legacy mapping data before drawing conclusions\.$/, 'COLLECT_LEGACY_DATA', null],
  [/^Collect more evidence \(rerun analysis\) for a more reliable comparison\.$/, 'COLLECT_MORE_EVIDENCE', null],
  [/^Do not activate production output based on this comparison\.$/, 'DO_NOT_ACTIVATE_PRODUCTION', null],
];
const _COMPARISON_SUMMARY_CLASSIFIERS = [
  [/^There is not enough evidence to compare the two previews reliably\.$/, 'INSUFFICIENT_EVIDENCE', null],
  [/^The V2 preview is not ready yet, so there is nothing to compare against the Legacy preview right now\. Legacy remains the active production path\.$/, 'V2_NOT_READY', null],
  [/^The V2 preview currently has unresolved safety concerns, so a confident comparison is not possible yet\. Legacy remains the active production path\.$/, 'V2_UNRESOLVED_SAFETY_CONCERNS', null],
  [/^The Legacy and V2 data comparisons are similar in most areas, but some parts still require manual human review — no rendered image preview is available yet\. Legacy remains the active production path\.$/, 'SIMILAR_NEEDS_MANUAL_REVIEW', null],
  [/^The Legacy and V2 data comparisons differ in some areas and still require manual human review before any conclusions are drawn — no rendered image preview is available yet\. Legacy remains the active production path\.$/, 'DIFFERS_NEEDS_MANUAL_REVIEW', null],
];

/** Classifies+translates a list of raw English sentences via the given classifier table + presenter. Falls back to the raw sentence when no classifier matches. */
function _translateViaClassifier(rawList, table, presenter, lang) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const text = typeof raw === 'string' ? raw : _safeText(raw, '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    let matched = null;
    for (const [re, code, paramsFn] of table) {
      const m = text.match(re);
      if (m) { matched = presenter(code, paramsFn ? paramsFn(m) : null, lang); break; }
    }
    out.push(matched || text);
  }
  return out;
}

/** Same classification for a single sentence (photographerSummary), never an array. */
function _translateSingleViaClassifier(rawText, table, presenter, lang) {
  const text = _safeText(rawText, '');
  if (!text) return '';
  for (const [re, code] of table) {
    if (re.test(text)) {
      const translated = presenter(code, lang, text);
      if (translated) return translated;
    }
  }
  return text;
}

// ── Legacy/V2 summary cards ─────────────────────────────────────────────────
function _renderPreviewCard(title, preview, extraRows, locale) {
  const card = el('div', { style: 'flex:1;min-width:220px;background:var(--surface-2);border-radius:4px;padding:14px;display:flex;flex-direction:column;gap:8px' });
  card.appendChild(el('div', { style: 'font-size:12.5px;font-weight:700;color:var(--text)', text: title }));

  const p = _isRecord(preview) ? preview : {};
  const rows = el('div', { style: 'display:flex;flex-direction:column' });
  rows.appendChild(listRow(t('comparison.card.dataAvailable', null, locale), _yesNoUnknown(p.dataAvailable ?? p.available, locale)));
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase D:
  // FIX for Defect 2A -- this row previously always said "Visual
  // preview: Not available", which reads as "this app has no visual
  // preview anywhere" even when the separate Visual Preview Comparison
  // section below has genuinely rendered pixels. This row only ever
  // means "this Data Comparison card does not render pixels itself" --
  // worded that way explicitly now, never claiming unavailability of
  // the whole app's visual preview capability.
  rows.appendChild(listRow(t('comparison.pixelPreviewNotRenderedHere', null, locale), ''));
  // Phase F: the raw source code ('controlled-v2-preview', 'legacy-preset', ...)
  // is a stable internal code, translated here rather than shown raw.
  rows.appendChild(listRow(t('comparison.card.source', null, locale), _trCode('comparison.sourceCode', _safeText(p.source, 'unknown'), locale)));
  rows.appendChild(listRow(t('comparison.card.productionSource', null, locale), _yesNoUnknown(p.productionSource, locale)));
  rows.appendChild(listRow(t('comparison.card.previewOnly', null, locale), _yesNoUnknown(p.previewOnly, locale)));
  if (extraRows) for (const [label, value] of extraRows) rows.appendChild(listRow(label, value));
  card.appendChild(rows);

  const strengths = _safeArray(p.strengths);
  const risks = _safeArray(p.risks);
  const warnings = _safeArray(p.warnings);
  if (strengths.length) {
    const wrap = el('div', { style: 'font-size:10.5px;color:var(--success);margin-top:2px' });
    wrap.textContent = strengths.map(s => _safeText(s, '')).filter(Boolean).slice(0, 3).join(' \u00B7 ');
    if (wrap.textContent) card.appendChild(wrap);
  }
  if (risks.length) {
    const wrap = el('div', { style: 'font-size:10.5px;color:var(--danger)' });
    wrap.textContent = risks.map(s => _safeText(s, '')).filter(Boolean).slice(0, 3).join(' \u00B7 ');
    if (wrap.textContent) card.appendChild(wrap);
  }
  if (warnings.length) {
    const wrap = el('div', { style: 'font-size:10.5px;color:var(--warn)' });
    wrap.textContent = warnings.map(s => _safeText(s, '')).filter(Boolean).slice(0, 3).join(' \u00B7 ');
    if (wrap.textContent) card.appendChild(wrap);
  }
  const summaryText = _safeText(p.summary, '');
  if (summaryText) card.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim);line-height:1.5;margin-top:4px;overflow-wrap:anywhere', text: summaryText }));

  return card;
}

// ── Comparison dimension row ─────────────────────────────────────────────────
function _renderDimensionRow(dim, locale) {
  if (!_isRecord(dim)) {
    return el('div', { style: 'padding:9px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-faint);font-style:italic', text: t('comparison.dimension.invalid', null, locale) });
  }
  const wrap = el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' });
  const top = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px' });
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase F: the dimension title is
  // resolved from the STABLE dimension ID, never from Core's own
  // English `label`. Core prose is available in Developer Details only.
  const dimTitle = typeof dim.id === 'string' && dim.id
    ? presentDimensionName(dim.id, locale)
    : _safeText(dim.label, t('comparison.dimensionLabel', null, locale));
  top.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--text)', text: dimTitle }));
  const badges = el('div', { style: 'display:flex;flex-wrap:wrap;gap:5px' });
  const direction = _normalizeDirection(dim.direction);
  badges.appendChild(badge(_trCode('comparison.direction', direction, locale), DIRECTION_COLOR[direction]));
  const side = _normalizeSide(dim.preferredSide);
  badges.appendChild(badge(_trCode('comparison.side', side, locale), SIDE_COLOR[side]));
  const risk = _normalizeRiskLevel(dim.riskLevel);
  badges.appendChild(badge(_trCode('comparison.risk', risk, locale), RISK_COLOR[risk]));
  top.appendChild(badges);
  wrap.appendChild(top);

  if (dim.available !== true) {
    wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:4px', text: t('comparison.dimension.notEnoughEvidence', null, locale) }));
  }

  const unknownText = t('common.unknown', null, locale);
  const valRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:5px;font-size:11px' });
  valRow.appendChild(el('span', { style: 'color:var(--text-dim)', text: t('comparison.dimension.legacy', { value: _safeText(dim.legacy, unknownText) }, locale) }));
  valRow.appendChild(el('span', { style: 'color:var(--text-dim)', text: t('comparison.dimension.v2', { value: _safeText(dim.v2, unknownText) }, locale) }));
  valRow.appendChild(el('span', { style: 'color:var(--text-faint)', text: t('comparison.dimension.similarity', { value: _formatPercent(dim.similarity) }, locale) }));
  valRow.appendChild(el('span', { style: 'color:var(--text-faint)', text: t('comparison.dimension.confidence', { value: _formatPercent(dim.confidence) }, locale) }));
  wrap.appendChild(valRow);

  const reasons = _safeArray(dim.reasons);
  if (reasons.length) wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:4px;overflow-wrap:anywhere', text: reasons.map(r => _safeText(r, '')).filter(Boolean).join(' ') }));
  const warns = _safeArray(dim.warnings);
  if (warns.length) wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);margin-top:3px;overflow-wrap:anywhere', text: warns.map(w => `\u26A0 ${_safeText(w, '')}`).filter(Boolean).join(' ') }));

  return wrap;
}

// ── Risk comparison row ──────────────────────────────────────────────────────
function _renderRiskRow(risk, locale) {
  if (!_isRecord(risk)) return null;
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:11px' });
  const areaLabel = typeof risk.area === 'string' ? t(`comparison.riskArea.${_camelFromCode(risk.area)}`, null, locale) : t('common.unknown', null, locale);
  row.appendChild(el('span', { style: 'min-width:110px;color:var(--text)', text: (areaLabel && areaLabel !== `comparison.riskArea.${_camelFromCode(risk.area)}`) ? areaLabel : _safeText(risk.area, t('common.unknown', null, locale)) }));
  const legacyLevel = _normalizeRiskLevel(risk.legacyLevel);
  const v2Level = _normalizeRiskLevel(risk.v2Level);
  row.appendChild(badge(`${t('comparison.side.legacy', null, locale)}: ${_trCode('comparison.risk', legacyLevel, locale)}`, RISK_COLOR[legacyLevel]));
  row.appendChild(badge(`${t('comparison.side.v2', null, locale)}: ${_trCode('comparison.risk', v2Level, locale)}`, RISK_COLOR[v2Level]));
  const side = _normalizeSide(risk.preferredSide);
  row.appendChild(badge(_trCode('comparison.side', side, locale), SIDE_COLOR[side]));
  return row;
}

/**
 * Builds the full Side-by-Side Comparison console body into `container`.
 * `comparison` is the canonical, already-computed
 * finalStyleIntent.sideBySidePreviewComparisonV2 object (or any
 * malformed/missing value — every access below is defensive).
 */
function _renderBody(container, comparison, visualPreviewInfo, locale) {
  const cmp = _isRecord(comparison) ? comparison : null;

  if (!cmp) {
    container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text-faint);padding:10px 0', text: t('comparison.unavailable', null, locale) }));
    return;
  }

  const state = _normalizeState(cmp.comparisonState);

  // ── Section header + status badge ───────────────────────────────────────
  const headerRow = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' });
  headerRow.appendChild(el('div', { style: 'font-size:13px;font-weight:700;color:var(--text)', text: t('comparison.title', null, locale) }));
  headerRow.appendChild(badge(_trCode('comparison.stateLabel', state, locale), STATE_COLOR[state]));
  container.appendChild(headerRow);
  container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-bottom:12px', text: t('comparison.subtitle', null, locale) }));

  // Extracted early (before the empty-state framing below) so both
  // this section and the Visual Honesty Banner can use the same
  // already-normalized preview objects — FIX 1 was previously reading
  // `!_isRecord(cmp.legacyPreview)?.dataAvailable`, which is a no-op
  // bug: `_isRecord()` returns a boolean, and a boolean has no
  // `.dataAvailable` property, so that expression was always
  // `undefined` regardless of the actual preview data.
  const legacyPreview = _isRecord(cmp.legacyPreview) ? cmp.legacyPreview : null;
  const v2Preview = _isRecord(cmp.v2Preview) ? cmp.v2Preview : null;
  const legacyDataAvailable = legacyPreview?.dataAvailable === true || legacyPreview?.available === true;
  const v2DataAvailable = v2Preview?.dataAvailable === true || v2Preview?.available === true;

  // Insufficient-evidence / blocked empty-state framing (still shows partial diagnostic data below, per spec).
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase D:
  // FIX for Defect 2A -- the old "but visual preview images are not
  // implemented yet" wording (legacyDataAvailable || v2DataAvailable
  // branch below) read as a whole-app capability claim. Replaced with
  // the spec's exact truthful wording: this layer compares
  // semantic/planning data only; rendered pixels are a separate
  // section below.
  if (state === 'insufficient-evidence') {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--text-dim);padding:8px 0 4px', text: t('comparison.insufficientEvidence', null, locale) }));
  } else if (state === 'blocked') {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--danger);padding:8px 0 4px', text: t('comparison.blocked', null, locale) }));
  } else if (legacyDataAvailable || v2DataAvailable) {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--text-dim);padding:8px 0 4px', text: t('comparison.dataOnlyNotice', null, locale) }));
  } else {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--text-dim);padding:8px 0 4px', text: t('comparison.noData', null, locale) }));
  }

  // ── Visual honesty banner ────────────────────────────────────────────────
  // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase I (retained) / EPIC
  // 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 — Phase D/G/J: this
  // Data Comparison layer NEVER renders pixels itself and NEVER
  // reinterprets its own "Unknown"/not-available evidence based on
  // what the SEPARATE Visual Preview Comparison section can do — the
  // two are genuinely different evidence layers (semantic/planning
  // data here vs. approximate rendered pixels there), and this banner
  // says so explicitly. `visualPreviewInfo` (when supplied) is
  // read-only diagnostic passed in from
  // finalStyleIntent.visualPreviewRenderPlanV2 by the caller (now
  // correctly read from the nested `.v2RenderPlan`/`.sharedRenderConstraints`
  // fields — see ui/app.js Phase E) — this module never fetches or
  // re-derives it, and never lets it override any value already shown
  // above (legacyDataAvailable/v2DataAvailable stay exactly as read
  // from THIS comparison object, always).
  const banner = el('div', { style: 'display:flex;flex-direction:column;gap:5px;margin:10px 0 14px;padding:12px 14px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--warn)' });
  banner.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-dim);font-weight:600', text: t('comparison.honestyBannerTitle', null, locale) }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: t('comparison.legacyDataAvailable', { value: _yesNoUnknown(legacyPreview ? legacyDataAvailable : undefined, locale) }, locale) }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: t('comparison.v2DataAvailable', { value: _yesNoUnknown(v2Preview ? v2DataAvailable : undefined, locale) }, locale) }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: t('comparison.pixelPreviewNotRenderedHere', null, locale) + ' (Legacy)' }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: t('comparison.pixelPreviewNotRenderedHere', null, locale) + ' (V2)' }));

  const vpInfo = _isRecord(visualPreviewInfo) ? visualPreviewInfo : null;
  const vpTranslation = _isRecord(vpInfo?.controlledV2Translation) ? vpInfo.controlledV2Translation : null;
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase F:
  // FIX for Defect 2D -- when the caller has already resolved the
  // actual (post-render) Visual Preview state (`vpInfo.resolved`, built
  // AFTER visualPreviewComparisonController.render() settles -- see
  // ui/app.js), prefer that AUTHORITATIVE evidence over the earlier
  // plan-time-only `renderable`/`controlledV2Translation.mode` hint,
  // which only ever describes what the render plan INTENDED, not what
  // actually rendered. Never overwrites this comparison object's own
  // "Unknown" semantic fields either way -- purely a display choice
  // between two honest, read-only hints from the SAME separate layer.
  const resolvedVisual = _isRecord(vpInfo?.resolved) ? vpInfo.resolved : null;
  const vpRenderable = resolvedVisual ? (resolvedVisual.legacyRendered === true || resolvedVisual.v2Rendered === true) : vpInfo?.renderable === true;
  const effectiveTranslationMode = resolvedVisual?.translationMode ?? vpTranslation?.mode;
  let visualLayerNote;
  if (resolvedVisual && resolvedVisual.bothRendered === true) {
    visualLayerNote = t('visualPreview.resolved.meaningfulRendered', null, locale);
  } else if (resolvedVisual && (resolvedVisual.legacyRendered === true || resolvedVisual.v2Rendered === true)) {
    visualLayerNote = effectiveTranslationMode === 'identity-fallback' ? t('visualPreview.resolved.identityRendered', null, locale) : t('visualPreview.resolved.partial', null, locale);
  } else if (!vpInfo) {
    visualLayerNote = t('comparison.visualLayerNote.none', null, locale);
  } else if (vpRenderable && effectiveTranslationMode === 'legacy-derived-safety-restraint') {
    visualLayerNote = t('comparison.visualLayerNote.safetyRestraint', null, locale);
  } else if (vpRenderable && effectiveTranslationMode === 'identity-fallback') {
    visualLayerNote = t('comparison.visualLayerNote.identityFallback', null, locale);
  } else {
    visualLayerNote = t('comparison.visualLayerNote.notAvailable', null, locale);
  }
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px;font-style:italic;overflow-wrap:anywhere', text: visualLayerNote }));
  // Production Mapping / Preview Export / Production Write — only ever
  // claimed CONFIRMED when explicit evidence exists; an unexpected
  // (anomalous) explicit value is reported honestly, never hidden;
  // missing evidence is always UNKNOWN, never inferred as safe.
  statusLine(banner, {
    confirmedText: t('comparison.productionMapping.confirmed', null, locale),
    anomalyText: t('comparison.productionMapping.anomaly', { source: _safeText(cmp.selectedProductionSource, t('common.unknown', null, locale)) }, locale),
    unknownText: t('comparison.productionMapping.unknown', null, locale),
    status: typeof cmp.selectedProductionSource !== 'string' ? 'unknown' : (cmp.selectedProductionSource === 'legacy' ? 'confirmed' : 'anomaly'),
  });
  const exportEligible = v2Preview ? v2Preview.exportEligible : undefined;
  const appliedToProduction = v2Preview ? v2Preview.appliedToProduction : undefined;
  statusLine(banner, {
    confirmedText: t('comparison.previewExport.confirmed', null, locale),
    anomalyText: t('comparison.previewExport.anomaly', null, locale),
    unknownText: t('comparison.previewExport.unknown', null, locale),
    status: typeof exportEligible !== 'boolean' ? 'unknown' : (exportEligible === false ? 'confirmed' : 'anomaly'),
  });
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase G:
  // FIX for Defect 4 -- `canWriteProduction` never exists anywhere in
  // the current engine output, so this row previously always fell
  // through to "Unknown / Not confirmed" even though the Visual
  // Preview Render Plan's own `sharedRenderConstraints.allowProductionWrite`
  // (an EXPLICIT `=== false`) was available the whole time. This now
  // prefers that explicit, already-computed evidence (passed in via
  // the bounded `visualPreviewInfo.allowProductionWrite` field -- see
  // ui/app.js Phase E) over the never-populated `canWriteProduction`
  // field, and only falls back to Unknown when NEITHER is available.
  // Never inferred from `appliedToProduction` or
  // `selectedProductionSource` alone.
  const explicitAllowProductionWrite = typeof vpInfo?.allowProductionWrite === 'boolean' ? vpInfo.allowProductionWrite : undefined;
  const canWriteProduction = typeof cmp.canWriteProduction === 'boolean' ? cmp.canWriteProduction
    : (v2Preview && typeof v2Preview.canWriteProduction === 'boolean' ? v2Preview.canWriteProduction
    : explicitAllowProductionWrite);
  statusLine(banner, {
    confirmedText: t('comparison.productionWrite.confirmed', null, locale),
    anomalyText: t('comparison.productionWrite.anomaly', null, locale),
    unknownText: t('comparison.productionWrite.unknown', null, locale),
    status: typeof canWriteProduction !== 'boolean' ? 'unknown' : (canWriteProduction === false ? 'confirmed' : 'anomaly'),
  });
  // Only shown when canWriteProduction itself is unavailable but
  // appliedToProduction IS available — a separate, honestly-labeled
  // row that never claims "Write Disabled" from this weaker evidence.
  if (typeof canWriteProduction !== 'boolean' && typeof appliedToProduction === 'boolean') {
    statusLine(banner, {
      confirmedText: t('comparison.productionApplication.confirmed', null, locale),
      anomalyText: t('comparison.productionApplication.anomaly', null, locale),
      unknownText: t('comparison.productionApplication.unknown', null, locale),
      status: appliedToProduction === false ? 'confirmed' : 'anomaly',
    });
  }
  container.appendChild(banner);

  // ── Legacy / V2 summary cards ───────────────────────────────────────────
  container.appendChild(sectionHeading(t('comparison.heading.legacyVsV2Data', null, locale), 'compare_arrows'));
  const cardsRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px' });
  cardsRow.appendChild(_renderPreviewCard(t('common.legacy', null, locale), legacyPreview, null, locale));
  cardsRow.appendChild(_renderPreviewCard(t('common.controlledV2', null, locale) + ' Preview', v2Preview, v2Preview ? [
    [t('comparison.exportEligible', null, locale), _yesNoUnknown(v2Preview.exportEligible, locale)],
    [t('comparison.appliedToProduction', null, locale), _yesNoUnknown(v2Preview.appliedToProduction, locale)],
  ] : null, locale));
  container.appendChild(cardsRow);

  // ── Comparison dimensions ───────────────────────────────────────────────
  const dims = _safeArray(cmp.comparisonMatrix ?? cmp.comparisonDimensions);
  if (dims.length) {
    container.appendChild(sectionHeading(t('comparison.heading.comparisonDimensions', null, locale), 'grid_view'));
    const dimsWrap = el('div');
    for (const d of dims) dimsWrap.appendChild(_renderDimensionRow(d, locale));
    container.appendChild(dimsWrap);
  }

  // ── Similarity summary ──────────────────────────────────────────────────
  const sim = _isRecord(cmp.similaritySummary) ? cmp.similaritySummary : null;
  if (sim) {
    container.appendChild(sectionHeading(t('comparison.heading.similarity', null, locale), 'join_inner'));
    const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' });
    row.appendChild(el('span', { style: 'font-size:16px;font-weight:700;color:var(--text)', text: _formatPercent(sim.overallSimilarity) }));
    const level = typeof sim.level === 'string' ? sim.level : 'unknown';
    row.appendChild(badge(_trCode('comparison.scoreLevel', level, locale), 'var(--accent)'));
    container.appendChild(row);
    const strongest = _safeArray(sim.strongestMatches);
    const weakest = _safeArray(sim.weakestMatches);
    if (strongest.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:4px', text: `${t('comparison.strongestMatches', null, locale)}: ${strongest.map(x => presentDimensionName(_safeText(x, ''), locale)).join(', ')}` }));
    if (weakest.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `${t('comparison.weakestMatches', null, locale)}: ${weakest.map(x => presentDimensionName(_safeText(x, ''), locale)).join(', ')}` }));
  }

  // ── Divergence summary ──────────────────────────────────────────────────
  const div = _isRecord(cmp.divergenceSummary) ? cmp.divergenceSummary : null;
  if (div) {
    container.appendChild(sectionHeading(t('comparison.heading.divergence', null, locale), 'call_split'));
    const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' });
    row.appendChild(el('span', { style: 'font-size:16px;font-weight:700;color:var(--text)', text: _formatPercent(div.overallDivergence) }));
    const level = typeof div.level === 'string' ? div.level : 'unknown';
    row.appendChild(badge(_trCode('comparison.scoreLevel', level, locale), 'var(--warn)'));
    container.appendChild(row);
    const major = _safeArray(div.majorDifferences), minor = _safeArray(div.minorDifferences), unresolved = _safeArray(div.unresolvedDifferences);
    if (major.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--danger);margin-top:4px', text: `${t('comparison.majorDifferences', null, locale)}: ${major.map(x => presentDimensionName(_safeText(x, ''), locale)).join(', ')}` }));
    if (minor.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `${t('comparison.minorDifferences', null, locale)}: ${minor.map(x => presentDimensionName(_safeText(x, ''), locale)).join(', ')}` }));
    if (unresolved.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `${t('comparison.field.unresolvedInsufficientEvidence', null, locale)}: ${unresolved.map(x => presentDimensionName(_safeText(x, ''), locale)).join(', ')}` }));
  }

  // ── Safety comparison ───────────────────────────────────────────────────
  const safety = _isRecord(cmp.safetyComparison) ? cmp.safetyComparison : null;
  if (safety) {
    container.appendChild(sectionHeading(t('comparison.heading.safetyComparison', null, locale), 'shield'));
    const side = _normalizeSide(safety.saferSide === 'uncertain' ? 'unknown' : safety.saferSide);
    const saferBadgeColor = safety.saferSide === 'uncertain' ? 'var(--text-faint)' : SIDE_COLOR[side];
    const saferBadgeLabel = safety.saferSide === 'uncertain' ? t('comparison.field.uncertain', null, locale) : _trCode('comparison.side', side, locale);
    container.appendChild(badge(`${t('comparison.field.saferSide', null, locale)}: ${saferBadgeLabel}`, saferBadgeColor));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    const unknownText = t('common.unknown', null, locale);
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.side.legacy', null, locale)} score: ${Number.isFinite(safety.legacySafetyScore) ? safety.legacySafetyScore : unknownText}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.side.v2', null, locale)} score: ${Number.isFinite(safety.v2SafetyScore) ? safety.v2SafetyScore : unknownText}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-faint)', text: `${t('comparison.field.confidence', null, locale)}: ${_formatPercent(safety.confidence)}` }));
    const hardStopsText = Number.isFinite(safety.hardStops) && safety.hardStops >= 0 ? safety.hardStops : unknownText;
    const criticalRisksText = Number.isFinite(safety.criticalRisks) && safety.criticalRisks >= 0 ? safety.criticalRisks : unknownText;
    grid.appendChild(el('span', { style: 'color:var(--danger)', text: `${t('comparison.field.hardStops', null, locale)}: ${hardStopsText}` }));
    grid.appendChild(el('span', { style: 'color:var(--danger)', text: `${t('comparison.field.criticalRisks', null, locale)}: ${criticalRisksText}` }));
    container.appendChild(grid);
  }

  // ── Risk comparison ─────────────────────────────────────────────────────
  const risks = _safeArray(cmp.riskComparison);
  if (risks.length) {
    container.appendChild(sectionHeading(t('comparison.heading.riskComparison', null, locale), 'warning'));
    const risksWrap = el('div');
    for (const r of risks) { const row = _renderRiskRow(r, locale); if (row) risksWrap.appendChild(row); }
    container.appendChild(risksWrap);
  }

  // ── Evidence quality ────────────────────────────────────────────────────
  const evidence = _isRecord(cmp.evidenceQuality) ? cmp.evidenceQuality : null;
  if (evidence) {
    container.appendChild(sectionHeading(t('comparison.heading.evidenceQuality', null, locale), 'fact_check'));
    const level = _normalizeEvidenceLevel(evidence.level);
    container.appendChild(badge(_trCode('comparison.scoreLevel', level, locale), EVIDENCE_COLOR[level]));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.side.legacy', null, locale)} ${t('comparison.field.evidence', null, locale)}: ${_yesNoUnknown(evidence.legacyEvidenceAvailable, locale)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.side.v2', null, locale)} ${t('comparison.field.evidence', null, locale)}: ${_yesNoUnknown(evidence.v2EvidenceAvailable, locale)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.field.visualEvidence', null, locale)}: ${_yesNoUnknown(evidence.visualEvidenceAvailable, locale)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.field.reviewEvidence', null, locale)}: ${_yesNoUnknown(evidence.reviewEvidenceAvailable, locale)}` }));
    container.appendChild(grid);
    const missing = _safeArray(evidence.missingEvidence);
    if (missing.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:5px', text: `${t('comparison.field.missing', null, locale)}: ${missing.map(x => _safeText(x, '')).join(', ')}` }));
  }

  // ── Human Review status ─────────────────────────────────────────────────
  const review = _isRecord(cmp.humanReviewStatus) ? cmp.humanReviewStatus : null;
  if (review) {
    container.appendChild(sectionHeading(t('comparison.heading.humanReviewStatus', null, locale), 'rate_review'));
    const approvalState = _normalizeApprovalState(review.approvalState);
    container.appendChild(badge(_trCode('comparison.approvalState', approvalState, locale), APPROVAL_STATE_COLOR[approvalState]));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.field.visualReviewComplete', null, locale)}: ${_yesNoUnknown(review.visualReviewComplete, locale)}` }));
    const completedValid = Number.isFinite(review.completed) && review.completed >= 0;
    const requiredValid = Number.isFinite(review.required) && review.required >= 0;
    let progressText;
    if (completedValid && requiredValid) {
      const clampedCompleted = Math.min(review.completed, review.required);
      progressText = `${clampedCompleted}/${review.required}`;
    } else {
      progressText = t('comparison.field.progressUnavailable', null, locale);
    }
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: progressText }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${t('comparison.field.canApprovePreview', null, locale)}: ${_yesNoUnknown(review.canApprovePreview, locale)}` }));
    container.appendChild(grid);
    const failed = _safeArray(review.failedItems), pending = _safeArray(review.pendingItems), adjust = _safeArray(review.needsAdjustment);
    if (failed.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--danger);margin-top:5px', text: `${t('comparison.field.failedItems', null, locale)}: ${failed.map(x => _safeText(x, '')).join(', ')}` }));
    if (adjust.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);margin-top:3px', text: `${t('comparison.field.needsAdjustmentItems', null, locale)}: ${adjust.map(x => _safeText(x, '')).join(', ')}` }));
    if (pending.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:3px', text: `${t('comparison.field.pendingItems', null, locale)}: ${pending.map(x => _safeText(x, '')).join(', ')}` }));
    // Concise, non-duplicating link to the existing Review Console — no controls here.
    const reviewSectionExists = !!document.getElementById('reviewConsoleSection');
    if (reviewSectionExists) {
      const link = el('button', {
        style: 'margin-top:8px;padding:8px 14px;min-height:36px;border-radius:3px;font-family:var(--font-sans);font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
        text: t('common.goToReviewConsole', null, locale),
        attrs: { type: 'button', 'aria-label': t('comparison.scrollToReviewConsole', null, locale) },
      });
      link.addEventListener('click', () => document.getElementById('reviewConsoleSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      container.appendChild(link);
    }
  }

  // ── Blockers / Warnings / Recommendations ───────────────────────────────
  // I18N RUNTIME CLOSURE R3 -- Phase F: prefer the engine's STABLE
  // CODES (translated) over the raw English blockers/warnings/
  // recommendations arrays -- the raw arrays are used only when no
  // codes are present (older/unrecognized producer), same
  // fail-open-toward-visibility convention used throughout R3.
  const blockers = _translateViaClassifier(_mergeMessages(cmp.blockers), _COMPARISON_BLOCKER_CLASSIFIERS, presentComparisonBlockerCode, locale);
  if (blockers.length) {
    container.appendChild(sectionHeading(t('comparison.heading.blockers', null, locale), 'block'));
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    for (const text of blockers) wrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--danger);padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--danger);overflow-wrap:anywhere', text }));
    container.appendChild(wrap);
  }
  const warningsList = _translateViaClassifier(_mergeMessages(cmp.warnings), _COMPARISON_WARNING_CLASSIFIERS, presentComparisonWarningCode, locale);
  if (warningsList.length) {
    container.appendChild(sectionHeading(t('comparison.heading.warnings', null, locale), 'warning'));
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    for (const text of warningsList) wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    container.appendChild(wrap);
  }
  const recommendations = _translateViaClassifier(_mergeMessages(cmp.recommendations), _COMPARISON_RECOMMENDATION_CLASSIFIERS, presentComparisonRecommendationCode, locale);
  if (recommendations.length) {
    container.appendChild(sectionHeading(t('comparison.heading.recommendations', null, locale), 'lightbulb'));
    const list = el('ul', { style: 'margin:0;padding-left:18px;font-size:11.5px;color:var(--text-dim);line-height:1.7' });
    for (const text of recommendations) list.appendChild(el('li', { text }));
    container.appendChild(list);
  }

  // ── Rollback / Fallback ─────────────────────────────────────────────────
  const rollback = _isRecord(cmp.rollbackPlan) ? cmp.rollbackPlan : null;
  const fallback = _isRecord(cmp.fallbackStrategy) ? cmp.fallbackStrategy : null;
  if (rollback || fallback) {
    container.appendChild(sectionHeading(t('comparison.heading.rollbackFallback', null, locale), 'settings_backup_restore'));
    if (rollback) {
      container.appendChild(listRow(t('comparison.field.rollbackAvailable', null, locale), _yesNoUnknown(rollback.available, locale)));
      container.appendChild(listRow(t('comparison.field.restoreSource', null, locale), _safeText(rollback.restoreSource, t('common.notAvailable', null, locale))));
      container.appendChild(listRow(t('comparison.field.productionMutationDetected', null, locale), _yesNoUnknown(rollback.productionMutationDetected, locale)));
      const steps = _safeArray(rollback.steps);
      if (steps.length) {
        const stepsList = el('ol', { style: 'margin:6px 0 0;padding-left:18px;font-size:11px;color:var(--text-dim);line-height:1.7' });
        for (const step of steps) stepsList.appendChild(el('li', { text: _safeText(step, '(unrepresentable step)') }));
        container.appendChild(stepsList);
      }
    } else {
      container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: t('review.rollbackUnavailable', null, locale) }));
    }
    if (fallback) {
      container.appendChild(listRow(t('comparison.field.fallbackUsesLegacyMapping', null, locale), _yesNoUnknown(fallback.useLegacyMapping, locale)));
      container.appendChild(listRow(t('comparison.field.safeMode', null, locale), _yesNoUnknown(fallback.safeMode, locale)));
      const reasonText = _safeText(fallback.reason, '');
      if (reasonText) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:4px;overflow-wrap:anywhere', text: reasonText }));
    }
  }

  // ── Photographer summary ────────────────────────────────────────────────
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase I:
  // FIX -- split into two explicit lines (data evidence vs. rendered
  // Visual Preview) so this never claims "no rendered preview exists"
  // once a real Controlled V2 render has actually succeeded elsewhere
  // on the page. Never rewrites this comparison object's own semantic
  // Unknown values -- only adds a second, separate line describing the
  // OTHER (resolved visual) layer's status, sourced from
  // `visualPreviewInfo` alone.
  // I18N RUNTIME CLOSURE R3 -- Phase F: prefer the engine's STABLE
  // photographerSummaryCode (translated) over the raw English
  // photographerSummary sentence -- the raw text is the fallback
  // only when no code is present.
  const photographerSummaryRaw = _safeText(cmp.photographerSummary, '');
  const photographerSummary = photographerSummaryRaw
    ? _translateSingleViaClassifier(photographerSummaryRaw, _COMPARISON_SUMMARY_CLASSIFIERS, presentComparisonSummaryCode, locale)
    : t('comparison.summarySplit.defaultDataEvidence', null, locale);
  container.appendChild(sectionHeading(t('comparison.heading.summary', null, locale), 'summarize'));
  container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text);line-height:1.6;overflow-wrap:anywhere', text: `${t('comparison.summarySplit.dataEvidenceLabel', null, locale)} ${photographerSummary}` }));
  let renderedVisualSummary;
  if (resolvedVisual && resolvedVisual.bothRendered === true) {
    renderedVisualSummary = t('comparison.summarySplit.renderedMeaningful', null, locale);
  } else if (resolvedVisual && (resolvedVisual.legacyRendered === true || resolvedVisual.v2Rendered === true) && effectiveTranslationMode === 'identity-fallback') {
    renderedVisualSummary = t('comparison.summarySplit.renderedIdentity', null, locale);
  } else if (vpRenderable && effectiveTranslationMode === 'legacy-derived-safety-restraint') {
    renderedVisualSummary = t('comparison.summarySplit.renderedMeaningful', null, locale);
  } else if (vpRenderable && effectiveTranslationMode === 'identity-fallback') {
    renderedVisualSummary = t('comparison.summarySplit.renderedIdentity', null, locale);
  } else {
    renderedVisualSummary = t('comparison.summarySplit.renderedNotAvailable', null, locale);
  }
  container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text);line-height:1.6;overflow-wrap:anywhere;margin-top:4px', text: `${t('comparison.summarySplit.renderedVisualLabel', null, locale)} ${renderedVisualSummary}` }));

  // ── Developer details (collapsible) ─────────────────────────────────────
  const details = el('details', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:10px' });
  const summaryToggle = el('summary', { style: 'cursor:pointer;font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint);min-height:32px;display:flex;align-items:center', text: t('common.developerDetails', null, locale) });
  details.appendChild(summaryToggle);
  const devWrap = el('div', { style: 'display:flex;flex-direction:column;gap:2px;margin-top:8px' });
  devWrap.appendChild(listRow(t('comparison.developer.mode', null, locale), _safeText(cmp.mode, t('common.unknown', null, locale))));
  devWrap.appendChild(listRow(t('comparison.developer.comparisonState', null, locale), state));
  devWrap.appendChild(listRow(t('comparison.developer.confidence', null, locale), Number.isFinite(cmp.confidence) ? cmp.confidence : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.dimensionCoverage', null, locale), `${dims.filter(d => _isRecord(d) && d.available).length}/${dims.length}`));
  devWrap.appendChild(listRow(t('comparison.developer.evidenceScore', null, locale), Number.isFinite(evidence?.score) ? evidence.score : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.selectedProductionSource', null, locale), typeof cmp.selectedProductionSource === 'string' ? cmp.selectedProductionSource : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.canRenderLegacyPreview', null, locale), typeof cmp.canRenderLegacyPreview === 'boolean' ? String(cmp.canRenderLegacyPreview) : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.canRenderV2Preview', null, locale), typeof cmp.canRenderV2Preview === 'boolean' ? String(cmp.canRenderV2Preview) : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.canCompareVisually', null, locale), typeof cmp.canCompareVisually === 'boolean' ? String(cmp.canCompareVisually) : t('common.unknown', null, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.fallbackUseLegacyMapping', null, locale), _yesNoUnknown(fallback?.useLegacyMapping, locale)));
  devWrap.appendChild(listRow(t('comparison.developer.rollbackAvailable', null, locale), _yesNoUnknown(rollback?.available, locale)));
  const developerSummaryText = _safeText(cmp.developerSummary, '');
  if (developerSummaryText) devWrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:6px;overflow-wrap:anywhere', text: developerSummaryText }));
  details.appendChild(devWrap);
  container.appendChild(details);
}

/**
 * Main entry point. Renders the full Side-by-Side Comparison console
 * into `container`. `comparison` is
 * finalStyleIntent.sideBySidePreviewComparisonV2 (or any malformed/
 * missing value — always safe). PURE READ-ONLY: no interactive
 * controls, no state mutation, no engine calls.
 */
export function renderSideBySideComparison(container, comparison, visualPreviewInfo = null, locale = 'en') {
  if (!container || typeof container.appendChild !== 'function') return;
  // Record the active locale for this render pass so the generic
  // `_safeText` fallback can be localized without threading `locale`
  // through every nested helper call site.
  _renderLocale = locale === 'th' ? 'th' : 'en';

  try {
    if (typeof container.replaceChildren === 'function') container.replaceChildren();
    else container.innerHTML = '';
    _renderBody(container, comparison, visualPreviewInfo, locale);
  } catch (err) {
    try {
      if (typeof container.replaceChildren === 'function') container.replaceChildren();
      else container.innerHTML = '';
    } catch { /* container itself is unusable */ }
    try {
      container.appendChild(el('div', {
        style: 'font-size:12px;color:var(--warn);padding:10px 0',
        text: t('comparison.malformedFallback', null, locale) || 'Side-by-side comparison data could not be displayed (unexpected format). This does not affect your exported preset.',
      }));
    } catch { /* even the fallback failed — give up silently rather than throwing */ }
  }
}
