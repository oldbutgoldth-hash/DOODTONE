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
 *   pan, or ANY interactive control (no buttons, no checkboxes, no
 *   approval actions) — this phase is data-level display only
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

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

/** Safely converts an arbitrary value to display text — never "[object Object]", never throws on circular references. */
function _safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' && json.length ? json : fallback;
  } catch {
    return '(unrepresentable value)';
  }
}

function _normalizeRiskLevel(v) {
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (RISK_LEVELS.has(lower)) return lower;
    if (lower === 'none') return 'low';
  }
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

function _yesNoUnknown(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return 'Unknown';
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
function statusLine(wrap, { confirmedText, unknownText, status }) {
  const color = status === 'confirmed' ? 'var(--success)' : 'var(--text-faint)';
  const icon = status === 'confirmed' ? '\u2713' : '\u2014';
  wrap.appendChild(el('div', { style: `font-size:11.5px;color:${color};display:flex;align-items:flex-start;gap:6px;overflow-wrap:anywhere`, text: `${icon}  ${status === 'confirmed' ? confirmedText : unknownText}` }));
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

// ── Legacy/V2 summary cards ─────────────────────────────────────────────────
function _renderPreviewCard(title, preview, extraRows) {
  const card = el('div', { style: 'flex:1;min-width:220px;background:var(--surface-2);border-radius:4px;padding:14px;display:flex;flex-direction:column;gap:8px' });
  card.appendChild(el('div', { style: 'font-size:12.5px;font-weight:700;color:var(--text)', text: title }));

  const p = _isRecord(preview) ? preview : {};
  const rows = el('div', { style: 'display:flex;flex-direction:column' });
  rows.appendChild(listRow('Data available', _yesNoUnknown(p.dataAvailable ?? p.available)));
  rows.appendChild(listRow('Visual preview', 'Not available'));
  rows.appendChild(listRow('Source', _safeText(p.source, 'unknown')));
  rows.appendChild(listRow('Production source', _yesNoUnknown(p.productionSource)));
  rows.appendChild(listRow('Preview only', _yesNoUnknown(p.previewOnly)));
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
function _renderDimensionRow(dim) {
  if (!_isRecord(dim)) {
    return el('div', { style: 'padding:9px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-faint);font-style:italic', text: 'Invalid comparison dimension — skipped.' });
  }
  const wrap = el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--border)' });
  const top = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px' });
  top.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--text)', text: _safeText(dim.label, _safeText(dim.id, 'Dimension')) }));
  const badges = el('div', { style: 'display:flex;flex-wrap:wrap;gap:5px' });
  const direction = _normalizeDirection(dim.direction);
  badges.appendChild(badge(DIRECTION_LABEL[direction], DIRECTION_COLOR[direction]));
  const side = _normalizeSide(dim.preferredSide);
  badges.appendChild(badge(SIDE_LABEL[side], SIDE_COLOR[side]));
  const risk = _normalizeRiskLevel(dim.riskLevel);
  badges.appendChild(badge(RISK_LABEL[risk], RISK_COLOR[risk]));
  top.appendChild(badges);
  wrap.appendChild(top);

  if (dim.available !== true) {
    wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:4px', text: 'Not enough evidence to compare this dimension.' }));
  }

  const valRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:5px;font-size:11px' });
  valRow.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Legacy: ${_safeText(dim.legacy, 'unknown')}` }));
  valRow.appendChild(el('span', { style: 'color:var(--text-dim)', text: `V2: ${_safeText(dim.v2, 'unknown')}` }));
  valRow.appendChild(el('span', { style: 'color:var(--text-faint)', text: `Similarity: ${_formatPercent(dim.similarity)}` }));
  valRow.appendChild(el('span', { style: 'color:var(--text-faint)', text: `Confidence: ${_formatPercent(dim.confidence)}` }));
  wrap.appendChild(valRow);

  const reasons = _safeArray(dim.reasons);
  if (reasons.length) wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:4px;overflow-wrap:anywhere', text: reasons.map(r => _safeText(r, '')).filter(Boolean).join(' ') }));
  const warns = _safeArray(dim.warnings);
  if (warns.length) wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);margin-top:3px;overflow-wrap:anywhere', text: warns.map(w => `\u26A0 ${_safeText(w, '')}`).filter(Boolean).join(' ') }));

  return wrap;
}

// ── Risk comparison row ──────────────────────────────────────────────────────
const RISK_AREA_LABEL = { skin: 'Skin', highlights: 'Highlights', shadows: 'Shadows', 'white-balance': 'White Balance', color: 'Color', overstack: 'Over-stack', export: 'Export', 'production-write': 'Production Write' };

function _renderRiskRow(risk) {
  if (!_isRecord(risk)) return null;
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:11px' });
  row.appendChild(el('span', { style: 'min-width:110px;color:var(--text)', text: RISK_AREA_LABEL[risk.area] ?? _safeText(risk.area, 'Unknown area') }));
  const legacyLevel = _normalizeRiskLevel(risk.legacyLevel);
  const v2Level = _normalizeRiskLevel(risk.v2Level);
  row.appendChild(badge(`Legacy: ${RISK_LABEL[legacyLevel]}`, RISK_COLOR[legacyLevel]));
  row.appendChild(badge(`V2: ${RISK_LABEL[v2Level]}`, RISK_COLOR[v2Level]));
  const side = _normalizeSide(risk.preferredSide);
  row.appendChild(badge(SIDE_LABEL[side], SIDE_COLOR[side]));
  return row;
}

/**
 * Builds the full Side-by-Side Comparison console body into `container`.
 * `comparison` is the canonical, already-computed
 * finalStyleIntent.sideBySidePreviewComparisonV2 object (or any
 * malformed/missing value — every access below is defensive).
 */
function _renderBody(container, comparison) {
  const cmp = _isRecord(comparison) ? comparison : null;

  if (!cmp) {
    container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text-faint);padding:10px 0', text: 'Side-by-Side comparison data is unavailable for this analysis.' }));
    return;
  }

  const state = _normalizeState(cmp.comparisonState);

  // ── Section header + status badge ───────────────────────────────────────
  const headerRow = el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' });
  headerRow.appendChild(el('div', { style: 'font-size:13px;font-weight:700;color:var(--text)', text: 'Side-by-Side Preview Comparison' }));
  headerRow.appendChild(badge(STATE_LABEL[state], STATE_COLOR[state]));
  container.appendChild(headerRow);
  container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-bottom:12px', text: 'Data comparison only \u00B7 Visual previews not available yet' }));

  // Insufficient-evidence / blocked empty-state framing (still shows partial diagnostic data below, per spec).
  if (state === 'insufficient-evidence') {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--text-dim);padding:8px 0 4px', text: 'There is not enough evidence to compare Legacy and V2 reliably.' }));
  } else if (state === 'blocked') {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--danger);padding:8px 0 4px', text: 'The comparison is blocked by current safety requirements.' }));
  } else if (!cmp.comparisonAvailable && !_isRecord(cmp.legacyPreview)?.dataAvailable && !_isRecord(cmp.v2Preview)?.dataAvailable) {
    container.appendChild(el('div', { style: 'font-size:12px;color:var(--text-dim);padding:8px 0 4px', text: 'Comparison data is available, but visual preview images are not implemented yet.' }));
  }

  // ── Visual honesty banner ────────────────────────────────────────────────
  const banner = el('div', { style: 'display:flex;flex-direction:column;gap:5px;margin:10px 0 14px;padding:12px 14px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--warn)' });
  banner.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-dim);font-weight:600', text: 'Visual Legacy/V2 preview images are not available in this stage.' }));
  const legacyPreview = _isRecord(cmp.legacyPreview) ? cmp.legacyPreview : null;
  const v2Preview = _isRecord(cmp.v2Preview) ? cmp.v2Preview : null;
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: `Legacy data available: ${_yesNoUnknown(legacyPreview?.dataAvailable ?? legacyPreview?.available)}` }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: `V2 data available: ${_yesNoUnknown(v2Preview?.dataAvailable ?? v2Preview?.available)}` }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: 'Legacy visual preview: Not available' }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: 'V2 visual preview: Not available' }));
  banner.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: 'Visual comparison: Not available' }));
  // Production Mapping / Export / Write — only ever claimed confirmed when explicit evidence exists.
  statusLine(banner, {
    confirmedText: 'Production Mapping: Legacy.',
    unknownText: 'Production Mapping: not confirmed.',
    status: cmp.selectedProductionSource === 'legacy' ? 'confirmed' : 'unknown',
  });
  container.appendChild(banner);

  // ── Legacy / V2 summary cards ───────────────────────────────────────────
  container.appendChild(sectionHeading('Legacy vs. V2 Data', 'compare_arrows'));
  const cardsRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:12px' });
  cardsRow.appendChild(_renderPreviewCard('Legacy', legacyPreview));
  cardsRow.appendChild(_renderPreviewCard('Controlled V2 Preview', v2Preview, v2Preview ? [
    ['Export eligible', _yesNoUnknown(v2Preview.exportEligible)],
    ['Applied to production', _yesNoUnknown(v2Preview.appliedToProduction)],
  ] : null));
  container.appendChild(cardsRow);

  // ── Comparison dimensions ───────────────────────────────────────────────
  const dims = _safeArray(cmp.comparisonMatrix ?? cmp.comparisonDimensions);
  if (dims.length) {
    container.appendChild(sectionHeading('Comparison Dimensions', 'grid_view'));
    const dimsWrap = el('div');
    for (const d of dims) dimsWrap.appendChild(_renderDimensionRow(d));
    container.appendChild(dimsWrap);
  }

  // ── Similarity summary ──────────────────────────────────────────────────
  const sim = _isRecord(cmp.similaritySummary) ? cmp.similaritySummary : null;
  if (sim) {
    container.appendChild(sectionHeading('Similarity', 'join_inner'));
    const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' });
    row.appendChild(el('span', { style: 'font-size:16px;font-weight:700;color:var(--text)', text: _formatPercent(sim.overallSimilarity) }));
    const level = typeof sim.level === 'string' ? sim.level : 'unknown';
    row.appendChild(badge(level.charAt(0).toUpperCase() + level.slice(1), 'var(--accent)'));
    container.appendChild(row);
    const strongest = _safeArray(sim.strongestMatches);
    const weakest = _safeArray(sim.weakestMatches);
    if (strongest.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:4px', text: `Strongest matches: ${strongest.map(x => _safeText(x, '')).join(', ')}` }));
    if (weakest.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `Weakest matches: ${weakest.map(x => _safeText(x, '')).join(', ')}` }));
  }

  // ── Divergence summary ──────────────────────────────────────────────────
  const div = _isRecord(cmp.divergenceSummary) ? cmp.divergenceSummary : null;
  if (div) {
    container.appendChild(sectionHeading('Divergence', 'call_split'));
    const row = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px' });
    row.appendChild(el('span', { style: 'font-size:16px;font-weight:700;color:var(--text)', text: _formatPercent(div.overallDivergence) }));
    const level = typeof div.level === 'string' ? div.level : 'unknown';
    row.appendChild(badge(level.charAt(0).toUpperCase() + level.slice(1), 'var(--warn)'));
    container.appendChild(row);
    const major = _safeArray(div.majorDifferences), minor = _safeArray(div.minorDifferences), unresolved = _safeArray(div.unresolvedDifferences);
    if (major.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--danger);margin-top:4px', text: `Major differences: ${major.map(x => _safeText(x, '')).join(', ')}` }));
    if (minor.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `Minor differences: ${minor.map(x => _safeText(x, '')).join(', ')}` }));
    if (unresolved.length) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px', text: `Unresolved (insufficient evidence): ${unresolved.map(x => _safeText(x, '')).join(', ')}` }));
  }

  // ── Safety comparison ───────────────────────────────────────────────────
  const safety = _isRecord(cmp.safetyComparison) ? cmp.safetyComparison : null;
  if (safety) {
    container.appendChild(sectionHeading('Safety Comparison', 'shield'));
    const side = _normalizeSide(safety.saferSide === 'uncertain' ? 'unknown' : safety.saferSide);
    const saferBadgeColor = safety.saferSide === 'uncertain' ? 'var(--text-faint)' : SIDE_COLOR[side];
    const saferBadgeLabel = safety.saferSide === 'uncertain' ? 'Uncertain' : SIDE_LABEL[side];
    container.appendChild(badge(`Safer side: ${saferBadgeLabel}`, saferBadgeColor));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Legacy score: ${Number.isFinite(safety.legacySafetyScore) ? safety.legacySafetyScore : 'Unknown'}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `V2 score: ${Number.isFinite(safety.v2SafetyScore) ? safety.v2SafetyScore : 'Unknown'}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-faint)', text: `Confidence: ${_formatPercent(safety.confidence)}` }));
    grid.appendChild(el('span', { style: 'color:var(--danger)', text: `Hard stops: ${Number.isFinite(safety.hardStops) ? safety.hardStops : 0}` }));
    grid.appendChild(el('span', { style: 'color:var(--danger)', text: `Critical risks: ${Number.isFinite(safety.criticalRisks) ? safety.criticalRisks : 0}` }));
    container.appendChild(grid);
  }

  // ── Risk comparison ─────────────────────────────────────────────────────
  const risks = _safeArray(cmp.riskComparison);
  if (risks.length) {
    container.appendChild(sectionHeading('Risk Comparison', 'warning'));
    const risksWrap = el('div');
    for (const r of risks) { const row = _renderRiskRow(r); if (row) risksWrap.appendChild(row); }
    container.appendChild(risksWrap);
  }

  // ── Evidence quality ────────────────────────────────────────────────────
  const evidence = _isRecord(cmp.evidenceQuality) ? cmp.evidenceQuality : null;
  if (evidence) {
    container.appendChild(sectionHeading('Evidence Quality', 'fact_check'));
    const level = _normalizeEvidenceLevel(evidence.level);
    container.appendChild(badge(EVIDENCE_LABEL[level], EVIDENCE_COLOR[level]));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Legacy evidence: ${_yesNoUnknown(evidence.legacyEvidenceAvailable)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `V2 evidence: ${_yesNoUnknown(evidence.v2EvidenceAvailable)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Visual evidence: ${_yesNoUnknown(evidence.visualEvidenceAvailable)}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Review evidence: ${_yesNoUnknown(evidence.reviewEvidenceAvailable)}` }));
    container.appendChild(grid);
    const missing = _safeArray(evidence.missingEvidence);
    if (missing.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:5px', text: `Missing: ${missing.map(x => _safeText(x, '')).join(', ')}` }));
  }

  // ── Human Review status ─────────────────────────────────────────────────
  const review = _isRecord(cmp.humanReviewStatus) ? cmp.humanReviewStatus : null;
  if (review) {
    container.appendChild(sectionHeading('Human Review Status', 'rate_review'));
    const approvalState = typeof review.approvalState === 'string' ? review.approvalState : 'unavailable';
    container.appendChild(badge(approvalState, approvalState === 'approved' ? 'var(--success)' : approvalState === 'rejected' || approvalState === 'blocked' ? 'var(--danger)' : 'var(--text-faint)'));
    const grid = el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px' });
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Visual review complete: ${_yesNoUnknown(review.visualReviewComplete)}` }));
    const completed = Number.isFinite(review.completed) ? review.completed : 0;
    const required = Number.isFinite(review.required) ? review.required : 0;
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Progress: ${completed}/${required}` }));
    grid.appendChild(el('span', { style: 'color:var(--text-dim)', text: `Can approve preview: ${_yesNoUnknown(review.canApprovePreview)}` }));
    container.appendChild(grid);
    const failed = _safeArray(review.failedItems), pending = _safeArray(review.pendingItems), adjust = _safeArray(review.needsAdjustment);
    if (failed.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--danger);margin-top:5px', text: `Failed items: ${failed.map(x => _safeText(x, '')).join(', ')}` }));
    if (adjust.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn);margin-top:3px', text: `Needs adjustment: ${adjust.map(x => _safeText(x, '')).join(', ')}` }));
    if (pending.length) container.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:3px', text: `Pending: ${pending.map(x => _safeText(x, '')).join(', ')}` }));
    // Concise, non-duplicating link to the existing Review Console — no controls here.
    const reviewSectionExists = !!document.getElementById('reviewConsoleSection');
    if (reviewSectionExists) {
      const link = el('button', {
        style: 'margin-top:8px;padding:8px 14px;min-height:36px;border-radius:3px;font-family:var(--font-sans);font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--surface-2);color:var(--text-dim)',
        text: 'Go to Review Console',
        attrs: { type: 'button', 'aria-label': 'Scroll to the Controlled Preview Review Console' },
      });
      link.addEventListener('click', () => document.getElementById('reviewConsoleSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      container.appendChild(link);
    }
  }

  // ── Blockers / Warnings / Recommendations ───────────────────────────────
  const blockers = _mergeMessages(cmp.blockers);
  if (blockers.length) {
    container.appendChild(sectionHeading('Blockers', 'block'));
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    for (const text of blockers) wrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--danger);padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--danger);overflow-wrap:anywhere', text }));
    container.appendChild(wrap);
  }
  const warningsList = _mergeMessages(cmp.warnings);
  if (warningsList.length) {
    container.appendChild(sectionHeading('Warnings', 'warning'));
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    for (const text of warningsList) wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--warn);overflow-wrap:anywhere', text: `\u26A0  ${text}` }));
    container.appendChild(wrap);
  }
  const recommendations = _mergeMessages(cmp.recommendations);
  if (recommendations.length) {
    container.appendChild(sectionHeading('Recommendations', 'lightbulb'));
    const list = el('ul', { style: 'margin:0;padding-left:18px;font-size:11.5px;color:var(--text-dim);line-height:1.7' });
    for (const text of recommendations) list.appendChild(el('li', { text }));
    container.appendChild(list);
  }

  // ── Rollback / Fallback ─────────────────────────────────────────────────
  const rollback = _isRecord(cmp.rollbackPlan) ? cmp.rollbackPlan : null;
  const fallback = _isRecord(cmp.fallbackStrategy) ? cmp.fallbackStrategy : null;
  if (rollback || fallback) {
    container.appendChild(sectionHeading('Rollback & Fallback', 'settings_backup_restore'));
    if (rollback) {
      container.appendChild(listRow('Rollback available', _yesNoUnknown(rollback.available)));
      container.appendChild(listRow('Restore source', _safeText(rollback.restoreSource, 'Unavailable')));
      container.appendChild(listRow('Production mutation detected', _yesNoUnknown(rollback.productionMutationDetected)));
      const steps = _safeArray(rollback.steps);
      if (steps.length) {
        const stepsList = el('ol', { style: 'margin:6px 0 0;padding-left:18px;font-size:11px;color:var(--text-dim);line-height:1.7' });
        for (const step of steps) stepsList.appendChild(el('li', { text: _safeText(step, '(unrepresentable step)') }));
        container.appendChild(stepsList);
      }
    } else {
      container.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-faint)', text: 'Rollback information unavailable.' }));
    }
    if (fallback) {
      container.appendChild(listRow('Fallback uses Legacy Mapping', _yesNoUnknown(fallback.useLegacyMapping)));
      container.appendChild(listRow('Safe mode', _yesNoUnknown(fallback.safeMode)));
      const reasonText = _safeText(fallback.reason, '');
      if (reasonText) container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:4px;overflow-wrap:anywhere', text: reasonText }));
    }
  }

  // ── Photographer summary ────────────────────────────────────────────────
  const photographerSummary = _safeText(cmp.photographerSummary, '') || 'Legacy remains the active production path. The comparison currently contains data-level analysis only.';
  container.appendChild(sectionHeading('Summary', 'summarize'));
  container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text);line-height:1.6;overflow-wrap:anywhere', text: photographerSummary }));

  // ── Developer details (collapsible) ─────────────────────────────────────
  const details = el('details', { style: 'margin-top:14px;border-top:1px solid var(--border);padding-top:10px' });
  const summaryToggle = el('summary', { style: 'cursor:pointer;font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint);min-height:32px;display:flex;align-items:center', text: 'Developer Details' });
  details.appendChild(summaryToggle);
  const devWrap = el('div', { style: 'display:flex;flex-direction:column;gap:2px;margin-top:8px' });
  devWrap.appendChild(listRow('mode', _safeText(cmp.mode, 'unknown')));
  devWrap.appendChild(listRow('comparisonState', state));
  devWrap.appendChild(listRow('confidence', Number.isFinite(cmp.confidence) ? cmp.confidence : 'unknown'));
  devWrap.appendChild(listRow('dimension coverage', `${dims.filter(d => _isRecord(d) && d.available).length}/${dims.length}`));
  devWrap.appendChild(listRow('evidence score', Number.isFinite(evidence?.score) ? evidence.score : 'unknown'));
  devWrap.appendChild(listRow('selectedProductionSource', _safeText(cmp.selectedProductionSource, 'legacy')));
  devWrap.appendChild(listRow('canRenderLegacyPreview', String(cmp.canRenderLegacyPreview === true)));
  devWrap.appendChild(listRow('canRenderV2Preview', String(cmp.canRenderV2Preview === true)));
  devWrap.appendChild(listRow('canCompareVisually', String(cmp.canCompareVisually === true)));
  devWrap.appendChild(listRow('fallback.useLegacyMapping', _yesNoUnknown(fallback?.useLegacyMapping)));
  devWrap.appendChild(listRow('rollback.available', _yesNoUnknown(rollback?.available)));
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
export function renderSideBySideComparison(container, comparison) {
  if (!container || typeof container.appendChild !== 'function') return;

  try {
    if (typeof container.replaceChildren === 'function') container.replaceChildren();
    else container.innerHTML = '';
    _renderBody(container, comparison);
  } catch (err) {
    try {
      if (typeof container.replaceChildren === 'function') container.replaceChildren();
      else container.innerHTML = '';
    } catch { /* container itself is unusable */ }
    try {
      container.appendChild(el('div', {
        style: 'font-size:12px;color:var(--warn);padding:10px 0',
        text: 'Side-by-side comparison data could not be displayed (unexpected format). This does not affect your exported preset.',
      }));
    } catch { /* even the fallback failed — give up silently rather than throwing */ }
  }
}
