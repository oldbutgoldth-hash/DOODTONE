/**
 * ui/visual-preview-comparison-renderer-v2.js
 *
 * EPIC 2E-H Phase C — pure, read-only DOM presentation layer for the
 * Visual Preview Comparison section. Never calls the controller, never
 * calls the pixel renderer, never mutates finalStyleIntent or the
 * canonical Side-by-Side Comparison object — reads only the
 * `comparisonState` object returned by
 * `visual-preview-comparison-controller-v2.js`'s `render()`/`getState()`.
 *
 * XSS-SAFE: every piece of dynamic text is inserted via `textContent`
 * or `document.createElement` — never `innerHTML`.
 *
 * SKELETON/METADATA SEPARATION: `ensureVisualPreviewComparisonLayout()`
 * builds the static skeleton — including the two target `<canvas>`
 * elements — EXACTLY ONCE per container (idempotent, checked via a
 * dataset flag). `renderVisualPreviewComparison()` only ever updates
 * the metadata/status regions around the canvases on every call,
 * NEVER touching, replacing, or recreating the canvas elements
 * themselves — the controller holds long-lived references to those
 * exact DOM nodes, so replacing them would silently break rendering.
 */

import { t } from './i18n/index.js';
import { presentLimitationCode, presentReasonCode, presentBlockerCode, presentCodeList } from './i18n/domain-presenters.js';

const LEGACY_CANVAS_ID = 'legacyVisualPreviewCanvasV2';
const V2_CANVAS_ID = 'controlledV2VisualPreviewCanvasV2';

function el(tag, { cls, style, text, attrs } = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) e.setAttribute('style', style);
  if (text !== undefined && text !== null) e.textContent = _safeText(text);
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) e.setAttribute(k, String(v));
    }
  }
  return e;
}

/** Safely stringifies any value for text display — never [object Object], never raw stack traces, always length-bounded. */
function _safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase B/J:
// this module now sources ALL its translatable text from the
// centralized runtime i18n module (`ui/i18n/index.js`) rather than
// its own local dictionary. `_t` is kept as a thin, drop-in-compatible
// wrapper (same call shape as the prior local helper) so the rest of
// this file's call sites did not need to change shape -- it now reads
// from the `visualPreview.v2.*` namespace instead of a local object.
function _t(key, lang) {
  return t(`visualPreview.v2.${key}`, null, lang);
}

/** Formats one changed-field entry as a compact, honest "Field: +before -> +after" line — normalized browser-preview units, never labeled as a Lightroom slider value. */
function _formatChangedField(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const fieldLabel = _safeText(entry.field).replace(/\./g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
  const fmt = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}` : '?');
  return `${fieldLabel}: ${fmt(entry.before)} → ${fmt(entry.after)}`;
}

function badge(text, color) {
  const safeColor = typeof color === 'string' && color ? color : 'var(--text-faint)';
  return el('span', {
    style: `display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.04em;background:${safeColor}22;color:${safeColor};border:1px solid ${safeColor}44;overflow-wrap:anywhere`,
    text,
  });
}

const STATE_COLOR = {
  unavailable: 'var(--text-faint)',
  preparing: 'var(--text-faint)',
  rendering: 'var(--accent)',
  partial: 'var(--warn, orange)',
  rendered: 'var(--success, green)',
  blocked: 'var(--warn, orange)',
  failed: 'var(--danger, red)',
  cancelled: 'var(--text-faint)',
};

const STATE_LABEL = {
  unavailable: 'Unavailable',
  preparing: 'Preparing',
  rendering: 'Rendering',
  partial: 'Partial',
  rendered: 'Rendered',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function _normalizeState(v) {
  return Object.prototype.hasOwnProperty.call(STATE_LABEL, v) ? v : 'unavailable';
}

/**
 * Builds the static skeleton exactly once per container. Safe to call
 * on every analysis run — a no-op if the skeleton already exists
 * (checked via `container.dataset.vprLayoutBuilt`).
 */
export function ensureVisualPreviewComparisonLayout(container) {
  if (!container || container.dataset.vprLayoutBuilt === '1') return;
  container.dataset.vprLayoutBuilt = '1';

  const root = el('div', { style: 'display:flex;flex-direction:column;gap:14px' });

  // Header + subtitle
  const header = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;justify-content:space-between' });
  const titleWrap = el('div');
  const titleEl = el('h3', { style: 'margin:0;font-size:14px;font-weight:700;color:var(--text)' });
  titleEl.id = 'vprTitle';
  titleWrap.appendChild(titleEl);
  const subtitleEl = el('div', { style: 'font-size:10.5px;color:var(--text-dim);margin-top:2px' });
  subtitleEl.id = 'vprSubtitle';
  titleWrap.appendChild(subtitleEl);
  header.appendChild(titleWrap);
  const overallStatusWrap = el('div', { attrs: { id: '', 'aria-live': 'polite' } });
  overallStatusWrap.id = 'vprOverallStatusBadge';
  header.appendChild(overallStatusWrap);
  root.appendChild(header);

  // Top safety notice — always visible, exact required wording.
  const notice = el('div', {
    style: 'font-size:11px;color:var(--text-dim);background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px 12px;line-height:1.5',
  });
  notice.id = 'vprTopNotice';
  root.appendChild(notice);

  // UX Polish (EPIC 2E-H Phase D): a compact, ALWAYS-VISIBLE technical
  // limitations list — deliberately not hidden only inside a collapsed
  // `<details>` section, per this phase's explicit requirement.
  const limitationsNotice = el('div', { style: 'font-size:10px;color:var(--text-faint);line-height:1.6' });
  const limitationsList = el('ul', { style: 'margin:4px 0 0;padding-left:16px' });
  limitationsList.id = 'vprLimitationsList';
  for (let i = 0; i < 7; i++) limitationsList.appendChild(el('li', {}));
  limitationsNotice.appendChild(limitationsList);
  root.appendChild(limitationsNotice);

  // Safety confirmations strip (tri-state, filled in on render)
  const safetyStrip = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;font-size:10.5px' });
  safetyStrip.id = 'vprSafetyStrip';
  root.appendChild(safetyStrip);

  // Two-panel grid — reuses the project's existing responsive
  // stack-on-mobile grid class.
  const grid = el('div', { cls: 'lx-2col-grid', style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px' });

  function buildPanel(side, canvasId, ariaLabel) {
    const panel = el('div', { style: 'display:flex;flex-direction:column;gap:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:12px' });
    const panelHeader = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px' });
    const panelTitleEl = el('div', { style: 'font-size:12px;font-weight:700;color:var(--text)' });
    panelTitleEl.id = `vpr${side}Title`;
    panelHeader.appendChild(panelTitleEl);
    const panelBadges = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
    panelBadges.id = `vpr${side}Badges`;
    panelHeader.appendChild(panelBadges);
    panel.appendChild(panelHeader);

    const canvasWrap = el('div', { style: 'position:relative;width:100%;background:var(--surface-1);border:1px solid var(--border);border-radius:2px;min-height:60px;display:flex;align-items:center;justify-content:center' });
    const canvas = el('canvas', {
      style: 'width:100%;height:auto;display:block;max-width:100%',
      attrs: { 'aria-label': ariaLabel },
    });
    canvas.id = canvasId;
    canvasWrap.appendChild(canvas);
    const placeholder = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;text-align:center;font-size:11px;color:var(--text-faint)' });
    placeholder.id = `vpr${side}Placeholder`;
    canvasWrap.appendChild(placeholder);
    panel.appendChild(canvasWrap);

    const statusLine = el('div', { style: 'font-size:11px;color:var(--text-dim)' });
    statusLine.id = `vpr${side}StatusLine`;
    statusLine.setAttribute('aria-live', 'polite');
    panel.appendChild(statusLine);

    const warningsWrap = el('div', { style: 'display:flex;flex-direction:column;gap:3px' });
    warningsWrap.id = `vpr${side}Warnings`;
    panel.appendChild(warningsWrap);

    const details = el('details', { style: 'font-size:10.5px;color:var(--text-dim)' });
    const summary = el('summary', { style: 'cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em' });
    summary.id = `vpr${side}DetailsSummary`;
    details.appendChild(summary);
    const detailsBody = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
    detailsBody.id = `vpr${side}Details`;
    details.appendChild(detailsBody);
    panel.appendChild(details);

    const disclaimer = el('div', { style: 'font-size:9.5px;color:var(--text-faint);font-style:italic' });
    disclaimer.id = `vpr${side}Disclaimer`;
    panel.appendChild(disclaimer);

    return panel;
  }

  grid.appendChild(buildPanel('Legacy', LEGACY_CANVAS_ID, 'Approximate Legacy browser preview'));
  grid.appendChild(buildPanel('V2', V2_CANVAS_ID, 'Approximate Controlled V2 browser preview'));
  root.appendChild(grid);

  // Overall warnings/blockers
  const overallMessages = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
  overallMessages.id = 'vprOverallMessages';
  overallMessages.setAttribute('aria-live', 'polite');
  root.appendChild(overallMessages);

  container.replaceChildren(root);
}

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase C/J:
// the skeleton above is built EXACTLY ONCE per container (see the
// SKELETON/METADATA SEPARATION note at the top of this file), so its
// static translatable text must be re-applied on EVERY render call
// (not just at skeleton-build time) for a language switch to actually
// update it -- this is what makes this section state-preserving under
// setLang(): the canvases/pixels are untouched, only these text nodes
// are refreshed.
function _applyStaticSkeletonTranslations(container, lang) {
  if (!container) return;
  const byId = (id) => document.getElementById(id);
  const set = (id, text) => { const e = byId(id); if (e) e.textContent = text; };
  set('vprTitle', t('visualPreview.title', null, lang));
  set('vprSubtitle', t('visualPreview.subtitle', null, lang));
  set('vprTopNotice', t('visualPreview.topNotice', null, lang));
  const limitationsList = byId('vprLimitationsList');
  if (limitationsList) {
    const limitationKeys = ['limitation1', 'limitation2', 'limitation3', 'limitation4', 'limitation5', 'limitation6', 'limitation7'];
    const items = limitationsList.querySelectorAll('li');
    limitationKeys.forEach((key, i) => { if (items[i]) items[i].textContent = t(`visualPreview.${key}`, null, lang); });
  }
  set('vprLegacyTitle', t('visualPreview.legacyPanelTitle', null, lang));
  set('vprV2Title', t('visualPreview.v2PanelTitle', null, lang));
  set('vprLegacyPlaceholder', t('visualPreview.waitingPlaceholder', null, lang));
  set('vprV2Placeholder', t('visualPreview.waitingPlaceholder', null, lang));
  set('vprLegacyDetailsSummary', t('visualPreview.renderDetails', null, lang));
  set('vprV2DetailsSummary', t('visualPreview.renderDetails', null, lang));
  set('vprLegacyDisclaimer', t('visualPreview.disclaimer', null, lang));
  set('vprV2Disclaimer', t('visualPreview.disclaimer', null, lang));
}

function _renderSidePanel(side, sideResult, selectedProductionSource, v2BlockerCode, controlledV2Translation, lang) {
  const badgesEl = document.getElementById(`vpr${side}Badges`);
  const placeholderEl = document.getElementById(`vpr${side}Placeholder`);
  const statusLineEl = document.getElementById(`vpr${side}StatusLine`);
  const warningsEl = document.getElementById(`vpr${side}Warnings`);
  const detailsEl = document.getElementById(`vpr${side}Details`);
  if (!badgesEl || !placeholderEl || !statusLineEl || !warningsEl || !detailsEl) return;

  badgesEl.replaceChildren();
  warningsEl.replaceChildren();
  detailsEl.replaceChildren();

  const sourceLabel = side === 'Legacy' ? t('visualPreview.badges.sourceLegacy', null, lang) : t('visualPreview.badges.sourceControlledV2', null, lang);
  badgesEl.appendChild(badge(sourceLabel, side === 'Legacy' ? 'var(--accent)' : 'var(--text-dim)'));
  badgesEl.appendChild(badge(t('visualPreview.badges.previewOnly', null, lang), 'var(--text-faint)'));
  // FIX 8 (EPIC 2E-H-C-F): the Legacy panel's "production-source" badge
  // is shown ONLY when selectedProductionSource is explicitly
  // "legacy" — never unconditionally. If evidence reports "v2" (a
  // critical anomaly, surfaced separately by the safety strip) or is
  // missing/unknown, this panel shows no false confirmation badge.
  if (side === 'Legacy') {
    if (selectedProductionSource === 'legacy') badgesEl.appendChild(badge(t('visualPreview.badges.productionSource', null, lang), 'var(--success, green)'));
    else if (selectedProductionSource !== 'v2') badgesEl.appendChild(badge(t('visualPreview.badges.productionSourceNotConfirmed', null, lang), 'var(--text-faint)'));
    // selectedProductionSource === 'v2': no badge here at all — the
    // anomaly is already shown loudly at the top-level safety strip;
    // this panel never claims Legacy is the confirmed production
    // source when the evidence says otherwise.
  }

  const rendered = sideResult?.rendered === true;
  const state = _normalizeState(sideResult?.state);

  if (rendered) {
    placeholderEl.style.display = 'none';
  } else {
    placeholderEl.style.display = 'flex';
    // DEPLOY GEOMETRY R1 — Phase A FIX A4: when V2 is unavailable ONLY
    // because Human Review is incomplete, state the exact, bounded
    // reason rather than a generic "unavailable" — never label an
    // ordinary review-incomplete state a geometry failure, and never
    // automatically approve Review items to work around it.
    const isReviewIncompleteV2 = side !== 'Legacy' && v2BlockerCode === 'REVIEW_INCOMPLETE';
    let msg;
    if (isReviewIncompleteV2 && (!sideResult || state === 'unavailable')) {
      msg = t('visualPreview.msg.reviewIncomplete', null, lang);
    }
    else if (!sideResult) msg = side === 'Legacy' ? t('visualPreview.msg.legacyPlanUnavailable', null, lang) : t('visualPreview.msg.v2PlanUnavailable', null, lang);
    else if (state === 'blocked') msg = t('visualPreview.msg.blocked', null, lang);
    else if (state === 'cancelled') msg = t('visualPreview.msg.cancelled', null, lang);
    else if (state === 'failed') msg = t('visualPreview.msg.failed', null, lang);
    else if (state === 'unavailable') msg = side === 'Legacy' ? t('visualPreview.msg.legacyPlanUnavailable', null, lang) : t('visualPreview.msg.v2PlanUnavailable', null, lang);
    else if (state === 'preparing') {
      // FIX 3 (EPIC 2E-H-C-F2): two genuinely different "preparing"
      // contexts share the same state value — distinguished via a
      // metadata flag rather than conflating their wording. When the
      // whole analysis pipeline is still running (`analysisInProgress`),
      // neither side has begun anything yet. Otherwise (the Legacy-vs-V2
      // sequential-render queue from EPIC 2E-H-C-F), V2 is simply
      // waiting its turn while Legacy renders first.
      msg = sideResult?.metadata?.analysisInProgress === true
        ? t('visualPreview.msg.waitingAnalysis', null, lang)
        : t('visualPreview.msg.waitingSequential', null, lang);
    }
    else if (state === 'rendering') msg = t('visualPreview.msg.rendering', null, lang);
    else msg = t('visualPreview.waitingPlaceholder', null, lang);
    placeholderEl.textContent = msg;
  }

  statusLineEl.textContent = t('visualPreview.msg.statusLine', { value: t(`visualPreview.stateLabel.${state}`, null, lang) || t('visualPreview.stateLabel.unavailable', null, lang) }, lang);

  const visualAdjustmentsApplied = sideResult?.metadata?.visualAdjustmentsApplied;
  if (side !== 'Legacy' && rendered) {
    // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase F: the V2 panel now
    // distinguishes a MEANINGFUL Safety-restraint translation from an
    // honest Identity fallback — both are valid, non-Production,
    // preview-only outcomes, but they must never share the same vague
    // "Identity preview" wording, since only one of them actually
    // changed a pixel.
    const mode = controlledV2Translation?.mode ?? null;
    if (mode === 'legacy-derived-safety-restraint') {
      warningsEl.appendChild(el('div', { style: 'font-size:11px;font-weight:700;color:var(--accent)', text: _t('safetyRestraintLabel', lang) }));
      warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim)', text: _t('safetyRestraintLine1', lang) }));
      warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: _t('safetyRestraintLine2', lang) }));
    } else if (mode === 'identity-fallback' || visualAdjustmentsApplied === false) {
      warningsEl.appendChild(el('div', { style: 'font-size:11px;font-weight:700;color:var(--text-dim)', text: _t('identityFallbackLabel', lang) }));
      warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim)', text: _t('identityFallbackLine1', lang) }));
      warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: _t('identityFallbackLine2', lang) }));
    }

    // Bounded diagnostics — normalized browser-preview units only,
    // never labeled as Lightroom slider values. Max 5 changed fields.
    if (controlledV2Translation && typeof controlledV2Translation === 'object') {
      const diagWrap = el('div', { style: 'font-size:10px;color:var(--text-faint);margin-top:4px;display:flex;flex-direction:column;gap:2px' });
      diagWrap.appendChild(el('div', { text: `${_t('visualizedAdjustments', lang)}: ${Number.isFinite(controlledV2Translation.visualizedAdjustmentCount) ? controlledV2Translation.visualizedAdjustmentCount : 0}` }));
      diagWrap.appendChild(el('div', { text: `${_t('translationMode', lang)}: ${_safeText(controlledV2Translation.mode) || 'unavailable'}` }));
      diagWrap.appendChild(el('div', { text: `${_t('confidence', lang)}: ${Number.isFinite(controlledV2Translation.confidence) ? controlledV2Translation.confidence : 0}` }));
      const changed = _safeArray(controlledV2Translation.changedFields).slice(0, 5);
      if (changed.length > 0) {
        diagWrap.appendChild(el('div', { style: 'margin-top:2px;font-weight:600', text: `${_t('topChanges', lang)}:` }));
        changed.forEach((c) => {
          const line = _formatChangedField(c);
          if (line) diagWrap.appendChild(el('div', { style: 'padding-left:8px', text: line }));
        });
      }
      warningsEl.appendChild(diagWrap);
    }
  } else if (rendered && visualAdjustmentsApplied === false) {
    // Legacy side — unchanged wording (this side is not affected by
    // the Controlled V2 translation, so its Identity messaging stays
    // exactly as before).
    warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: t('visualPreview.v2.noAdjustments', null, lang) }));
  }
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase G: prefer the renderer's
  // STABLE codes and render fully localized sentences. The raw English
  // `warnings`/`reasons` arrays are only used when no code accompanies
  // them (an older/!unknown producer), and even then they are shown as
  // the honest last resort rather than silently dropped.
  const warningCodes = _safeArray(sideResult?.warningCodes).slice(0, 5);
  if (warningCodes.length) {
    presentCodeList(warningCodes, presentLimitationCode, lang, 5).forEach(txt => {
      warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: txt }));
    });
  } else {
    _safeArray(sideResult?.warnings).slice(0, 4).forEach(w => {
      const txt = _safeText(w);
      if (txt) warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: txt }));
    });
  }

  const reasonCodes = _safeArray(sideResult?.reasonCodes).slice(0, 2);
  if (reasonCodes.length) {
    const reasonParams = sideResult?.reasonParams && typeof sideResult.reasonParams === 'object' ? sideResult.reasonParams : null;
    reasonCodes.forEach(code => {
      const txt = presentReasonCode(code, lang, reasonParams);
      if (txt) warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim)', text: txt }));
    });
  } else {
    _safeArray(sideResult?.reasons).slice(0, 2).forEach(r => {
      const txt = _safeText(r);
      if (txt) warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim)', text: txt }));
    });
  }

  const unknownLabel = t('visualPreview.rows.unknownLower', null, lang);
  const rows = [
    [t('visualPreview.rows.appliedAdjustments', null, lang), _safeArray(sideResult?.appliedAdjustments).length],
    [t('visualPreview.rows.skippedAdjustments', null, lang), _safeArray(sideResult?.skippedAdjustments).length],
    [t('visualPreview.rows.processingTime', null, lang), Number.isFinite(sideResult?.processingTimeMs) ? t('visualPreview.rows.msSuffix', { value: sideResult.processingTimeMs.toFixed(1) }, lang) : unknownLabel],
    [t('visualPreview.rows.cssSize', null, lang), (Number.isFinite(sideResult?.cssWidth) && Number.isFinite(sideResult?.cssHeight)) ? `${sideResult.cssWidth}×${sideResult.cssHeight}` : unknownLabel],
    [t('visualPreview.rows.backingSize', null, lang), (Number.isFinite(sideResult?.backingWidth) && Number.isFinite(sideResult?.backingHeight)) ? `${sideResult.backingWidth}×${sideResult.backingHeight}` : unknownLabel],
    [t('visualPreview.rows.requestedDpr', null, lang), Number.isFinite(sideResult?.metadata?.requestedDevicePixelRatio) ? sideResult.metadata.requestedDevicePixelRatio : unknownLabel],
    [t('visualPreview.rows.effectiveDpr', null, lang), Number.isFinite(sideResult?.devicePixelRatio) ? sideResult.devicePixelRatio : unknownLabel],
    [t('visualPreview.rows.pixelCount', null, lang), Number.isFinite(sideResult?.metadata?.pixelCount) ? sideResult.metadata.pixelCount : unknownLabel],
    [t('visualPreview.rows.memoryDownscaled', null, lang), sideResult?.metadata?.downscaledForMemorySafety === true ? t('visualPreview.rows.yesLower', null, lang) : sideResult?.metadata?.downscaledForMemorySafety === false ? t('visualPreview.rows.noLower', null, lang) : unknownLabel],
    [t('visualPreview.rows.processingMode', null, lang), _safeText(sideResult?.metadata?.processingMode) || unknownLabel],
    [t('visualPreview.rows.commitAtomicity', null, lang), _safeText(sideResult?.metadata?.commitAtomicity) || unknownLabel],
  ];
  rows.forEach(([label, value]) => {
    const row = el('div', { style: 'display:flex;justify-content:space-between;gap:8px' });
    row.appendChild(el('span', { style: 'color:var(--text-faint)', text: label }));
    row.appendChild(el('span', { style: 'color:var(--text-dim);overflow-wrap:anywhere;text-align:right', text: String(value) }));
    detailsEl.appendChild(row);
  });
}

/**
 * FIX 2 (EPIC 2E-H-C-F2): builds a local, synthetic "Preparing" state
 * to display at the very start of a new analysis run — after the old
 * preview render has been cancelled/cleared, but before the new
 * analysis pipeline (Histogram/Skin/HSL/Decision/Render Plan) has
 * even finished. This is deliberately distinct from
 * `buildRenderingPlaceholderState()` (which represents "the Render
 * Plan is ready and pixel rendering is actively starting") — this one
 * represents "no Render Plan exists yet at all, analysis is still
 * running". Never claims pixel rendering has started.
 */
export function buildPreparingAnalysisState() {
  return {
    state: 'preparing',
    legacy: { state: 'preparing', rendered: false, metadata: { analysisInProgress: true } },
    v2: { state: 'preparing', rendered: false, metadata: { analysisInProgress: true } },
    bothRendered: false,
    visualComparisonAvailable: false,
    warnings: [],
    blockers: [],
    metadata: {},
  };
}

/**
 * FIX 4 (EPIC 2E-H-C-F): builds a local, synthetic "in progress" state
 * to display immediately BEFORE `controller.render()` begins — so the
 * section never shows a stale "Waiting for analysis and Render Plan"
 * placeholder while pixel rendering is actively in flight. Legacy
 * renders first (state "rendering"); V2 waits for its sequential turn
 * (state "preparing") per this module's Legacy-then-V2 render order.
 * This never rebuilds or duplicates the controller's own render
 * logic — it is purely a display-only placeholder.
 */
export function buildRenderingPlaceholderState() {
  return {
    state: 'rendering',
    legacy: { state: 'rendering', rendered: false, metadata: {} },
    v2: { state: 'preparing', rendered: false, metadata: {} },
    bothRendered: false,
    visualComparisonAvailable: false,
    warnings: [],
    blockers: [],
    metadata: {},
  };
}

/**
 * Updates the metadata/status regions from a comparisonState object
 * (as returned by the controller's `render()`/`getState()`). Never
 * touches the canvas elements — the controller commits pixels to them
 * directly and independently of this function.
 */
export function renderVisualPreviewComparison(container, comparisonState, lang) {
  if (!container) return;
  ensureVisualPreviewComparisonLayout(container);
  // EPIC 2E-J Phase C/J: re-apply skeleton translations on EVERY call
  // (idempotent — a no-op in content terms if lang hasn't changed)
  // so a setLang() re-render picks up the new locale even though the
  // skeleton itself is only ever built once.
  _applyStaticSkeletonTranslations(container, lang);

  const cs = (comparisonState && typeof comparisonState === 'object') ? comparisonState : {};
  const overallState = _normalizeState(cs.state);

  const overallBadgeEl = document.getElementById('vprOverallStatusBadge');
  if (overallBadgeEl) {
    overallBadgeEl.replaceChildren(badge(t(`visualPreview.stateLabel.${overallState}`, null, lang), STATE_COLOR[overallState]));
  }

  const safetyStripEl = document.getElementById('vprSafetyStrip');
  const md = (cs.metadata && typeof cs.metadata === 'object') ? cs.metadata : {};
  const selectedProductionSource = md.selectedProductionSource === 'legacy' ? 'legacy' : md.selectedProductionSource === 'v2' ? 'v2' : 'unknown';
  const allowExport = md.allowExport === true ? true : md.allowExport === false ? false : null;
  const allowProductionWrite = md.allowProductionWrite === true ? true : md.allowProductionWrite === false ? false : null;

  if (safetyStripEl) {
    safetyStripEl.replaceChildren();

    // FIX 7 (EPIC 2E-H-C-F): Production Mapping — three genuinely
    // distinct states, never a fixed "Legacy" claim regardless of
    // evidence.
    if (selectedProductionSource === 'legacy') {
      safetyStripEl.appendChild(badge(t('visualPreview.badges.productionMappingLegacy', null, lang), 'var(--success, green)'));
    } else if (selectedProductionSource === 'v2') {
      safetyStripEl.appendChild(badge(t('visualPreview.badges.productionMappingAnomaly', null, lang), 'var(--danger, red)'));
    } else {
      safetyStripEl.appendChild(badge(t('visualPreview.badges.productionMappingNotConfirmed', null, lang), 'var(--text-faint)'));
    }

    // FIX 7: Preview Export — confirmed-disabled / enabled-anomaly / unknown.
    if (allowExport === false) safetyStripEl.appendChild(badge(t('visualPreview.badges.previewExportDisabled', null, lang), 'var(--success, green)'));
    else if (allowExport === true) safetyStripEl.appendChild(badge(t('visualPreview.badges.previewExportAnomaly', null, lang), 'var(--danger, red)'));
    else safetyStripEl.appendChild(badge(t('visualPreview.badges.previewExportNotConfirmed', null, lang), 'var(--text-faint)'));

    // FIX 7: Production Write — same tri-state pattern.
    if (allowProductionWrite === false) safetyStripEl.appendChild(badge(t('visualPreview.badges.productionWriteDisabled', null, lang), 'var(--success, green)'));
    else if (allowProductionWrite === true) safetyStripEl.appendChild(badge(t('visualPreview.badges.productionWriteAnomaly', null, lang), 'var(--danger, red)'));
    else safetyStripEl.appendChild(badge(t('visualPreview.badges.productionWriteNotConfirmed', null, lang), 'var(--text-faint)'));

    safetyStripEl.appendChild(badge(
      cs.visualComparisonAvailable === true ? t('visualPreview.badges.visualComparisonAvailable', null, lang) : t('visualPreview.badges.visualComparisonNotAvailable', null, lang),
      cs.visualComparisonAvailable === true ? 'var(--success, green)' : 'var(--text-faint)',
    ));
  }

  _renderSidePanel('Legacy', cs.legacy, selectedProductionSource, undefined, undefined, lang);
  // DEPLOY GEOMETRY R1 — Phase A FIX A1/A4: md.v2BlockerCode is a
  // bounded, stable diagnostic code (never a raw object/exception)
  // computed upstream (ui/app.js, which has access to both the Render
  // Plan and the Preview Sandbox) and threaded through in metadata —
  // used ONLY to select a more specific, honest placeholder message
  // for the V2 side; never changes eligibility/rendering itself.
  // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase F: md.controlledV2Translation
  // is likewise a bounded, pre-sanitized diagnostics object threaded
  // through unchanged from the Render Plan (Phase D) — never recomputed here.
  _renderSidePanel('V2', cs.v2, undefined, md.v2BlockerCode, md.controlledV2Translation, lang);

  const overallMessagesEl = document.getElementById('vprOverallMessages');
  if (overallMessagesEl) {
    overallMessagesEl.replaceChildren();
    const legacyRendered = cs.legacy?.rendered === true;
    const v2Rendered = cs.v2?.rendered === true;

    // UX Polish (EPIC 2E-H Phase D): a clear overall-outcome sentence,
    // exact required wording — never implies accuracy, only completion.
    if (overallState === 'rendered') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--success, green)', text: t('visualPreview.overall.bothRendered', null, lang) }));
    } else if (overallState === 'partial') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: t('visualPreview.overall.partial', null, lang) }));
    } else if (overallState === 'cancelled') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim)', text: t('visualPreview.overall.cancelled', null, lang) }));
    } else if (overallState === 'failed') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--danger, red)', text: t('visualPreview.overall.failed', null, lang) }));
    }

    if (legacyRendered && v2Rendered && (cs.legacy?.metadata?.visualAdjustmentsApplied === false || cs.v2?.metadata?.visualAdjustmentsApplied === false)) {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: t('visualPreview.overall.noAdjustment', null, lang) }));
    }
    // UX Polish: memory-downscale messaging, deduplicated across sides.
    if ((legacyRendered && cs.legacy?.metadata?.downscaledForMemorySafety === true) || (v2Rendered && cs.v2?.metadata?.downscaledForMemorySafety === true)) {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim)', text: t('visualPreview.overall.resolutionReduced', null, lang) }));
    }
    // Phase G: the controller now emits stable blocker CODES; translate
    // those. Raw English blockers are the fallback for an unknown producer.
    const blockerCodes = _safeArray(cs.blockerCodes).slice(0, 4);
    if (blockerCodes.length) {
      presentCodeList(blockerCodes, presentBlockerCode, lang, 4).forEach(txt => {
        overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--danger, red)', text: txt }));
      });
    } else {
      const blockers = _safeArray(cs.blockers).slice(0, 4);
      blockers.forEach(b => {
        const txt = _safeText(b);
        if (txt) overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--danger, red)', text: txt }));
      });
    }
    const warnings = _safeArray(cs.warnings).slice(0, 4);
    warnings.forEach(w => {
      const txt = _safeText(w);
      if (txt) overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: txt }));
    });
  }
}

/** Resets the section to its empty/waiting visual state without destroying the skeleton (canvases remain in the DOM, cleared separately by the controller). */
export function clearVisualPreviewComparisonDisplay(container, lang) {
  if (!container || container.dataset.vprLayoutBuilt !== '1') return;
  renderVisualPreviewComparison(container, { state: 'unavailable', legacy: null, v2: null, bothRendered: false, visualComparisonAvailable: false, warnings: [], blockers: [] }, lang);
}
