/**
 * ui/interactive-before-after-renderer-v2.js
 *
 * EPIC 2E-I Phase A — pure DOM presentation layer for the Interactive
 * Before/After section. Never calls the controller's interaction
 * logic, never validates alignment itself, never copies pixels —
 * reads only the `state` object returned by
 * `interactive-before-after-controller-v2.js`.
 *
 * XSS-SAFE: every piece of dynamic text is inserted via `textContent`
 * or `document.createElement` — never `innerHTML`.
 *
 * SKELETON/DISPLAY SEPARATION: `ensureInteractiveBeforeAfterLayout()`
 * builds the static skeleton — including the two bounded DISPLAY
 * canvases (never the original preview source canvases, which remain
 * owned by `visual-preview-comparison-controller-v2.js`) — exactly
 * once per container. `renderInteractiveBeforeAfterStatus()` only ever
 * updates the status/warning/technical-details text on every call,
 * never touching the canvases or the CSS split variable directly
 * (that remains the controller's own responsibility via
 * `setSplit()`/`updateSources()`).
 */

const LEGACY_DISPLAY_CANVAS_ID = 'ibaLegacyDisplayCanvasV2';
const V2_DISPLAY_CANVAS_ID = 'ibaV2DisplayCanvasV2';

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

function badge(text, color) {
  const safeColor = typeof color === 'string' && color ? color : 'var(--text-faint)';
  return el('span', {
    style: `display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.04em;background:${safeColor}22;color:${safeColor};border:1px solid ${safeColor}44;overflow-wrap:anywhere`,
    text,
  });
}

const STATE_COLOR = {
  unavailable: 'var(--text-faint)',
  waiting: 'var(--text-faint)',
  preparing: 'var(--text-faint)',
  ready: 'var(--success, green)',
  partial: 'var(--warn, orange)',
  blocked: 'var(--warn, orange)',
  failed: 'var(--danger, red)',
  cancelled: 'var(--text-faint)',
};
const STATE_LABEL = {
  unavailable: 'Unavailable',
  waiting: 'Waiting',
  preparing: 'Preparing',
  ready: 'Ready',
  partial: 'Partial',
  blocked: 'Blocked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
function _normalizeState(v) {
  return Object.prototype.hasOwnProperty.call(STATE_LABEL, v) ? v : 'unavailable';
}

const STATUS_MESSAGE = {
  ready: 'Interactive comparison is ready.',
  partial: 'Interactive comparison is unavailable because only one preview rendered.',
  // FIX 9 (EPIC 2E-I-A-F2): explicit that this is a GEOMETRY mismatch —
  // never implies the previews' Tone/Color differences caused it.
  blocked: 'Preview geometry differs beyond the safe comparison tolerance.',
  preparing: 'Waiting for the latest Legacy and V2 previews.',
  waiting: 'Waiting for the latest Legacy and V2 previews.',
  cancelled: 'Interactive comparison was cancelled because a newer analysis is active.',
  failed: 'Interactive comparison could not be prepared. Existing analysis and production output were not changed.',
  unavailable: 'Waiting for the latest Legacy and V2 previews.',
};

/**
 * Builds the static skeleton exactly once per container — safe to
 * call on every analysis run (no-op if already built, checked via a
 * dataset flag). Returns element references the controller needs.
 */
export function ensureInteractiveBeforeAfterLayout(container) {
  if (!container) return null;
  if (container.dataset.ibaLayoutBuilt === '1') return getInteractiveBeforeAfterElements(container);
  container.dataset.ibaLayoutBuilt = '1';

  const root = el('div', { style: 'display:flex;flex-direction:column;gap:12px' });

  const header = el('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;justify-content:space-between' });
  const titleWrap = el('div');
  titleWrap.appendChild(el('h3', { style: 'margin:0;font-size:14px;font-weight:700;color:var(--text)', text: 'Interactive Before / After' }));
  titleWrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim);margin-top:2px', text: 'Legacy vs. Controlled V2 · Approximate browser preview' }));
  header.appendChild(titleWrap);
  const statusBadgeWrap = el('div', { attrs: { 'aria-live': 'polite' } });
  statusBadgeWrap.id = 'ibaStatusBadge';
  header.appendChild(statusBadgeWrap);
  root.appendChild(header);

  // Disclaimer — always visible, exact required wording.
  root.appendChild(el('div', {
    style: 'font-size:11px;color:var(--text-dim);background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px 12px;line-height:1.5',
    text: 'Before/After uses approximate browser previews and may differ from Lightroom and Adobe Camera Raw.',
  }));

  // Comparison viewport: base layer (Legacy) + clipped overlay layer (V2) + divider/handle + labels.
  // Phase B: `touch-action: none` remains scoped to this interaction
  // surface only (never applied globally); `user-select` is handled
  // via the local `.iba-dragging` class below instead of a permanent
  // global `user-select: none`, so ordinary page text selection is
  // never affected outside an active drag.
  const styleTag = el('style', { text: '.iba-viewport.iba-dragging{cursor:ew-resize;user-select:none;}' });
  root.appendChild(styleTag);

  // Phase B: compact Legacy/V2/Alignment status summary — friendly
  // labels only, never raw internal state values.
  const sourceStatusRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;font-size:10px' });
  sourceStatusRow.id = 'ibaSourceStatusRow';
  root.appendChild(sourceStatusRow);

  const viewport = el('div', {
    cls: 'iba-viewport',
    style: 'position:relative;width:100%;background:var(--surface-1);border:1px solid var(--border);border-radius:2px;overflow:hidden;touch-action:none;--comparison-split:50%',
  });
  viewport.id = 'ibaViewport';

  const legacyCanvas = el('canvas', { style: 'display:block;width:100%;height:auto;max-width:100%', attrs: { 'aria-hidden': 'true' } });
  legacyCanvas.id = LEGACY_DISPLAY_CANVAS_ID;
  viewport.appendChild(legacyCanvas);

  const overlayWrapper = el('div', { style: 'position:absolute;inset:0;overflow:hidden;clip-path:inset(0 50% 0 0)' });
  overlayWrapper.id = 'ibaOverlayWrapper';
  const v2Canvas = el('canvas', { style: 'display:block;width:100%;height:auto;max-width:100%', attrs: { 'aria-hidden': 'true' } });
  v2Canvas.id = V2_DISPLAY_CANVAS_ID;
  overlayWrapper.appendChild(v2Canvas);
  viewport.appendChild(overlayWrapper);

  const divider = el('div', { style: 'position:absolute;top:0;bottom:0;left:50%;width:2px;background:var(--accent);pointer-events:none;transform:translateX(-1px)' });
  divider.id = 'ibaDivider';
  viewport.appendChild(divider);

  const handle = el('div', {
    style: 'position:absolute;top:50%;left:50%;width:32px;height:32px;min-width:44px;min-height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:var(--accent);border:2px solid var(--surface-1);cursor:ew-resize;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.3)',
    attrs: {
      role: 'slider', tabindex: '0', 'aria-label': 'Comparison split between Legacy and Controlled V2 previews',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50', 'aria-orientation': 'horizontal',
    },
  });
  handle.id = 'ibaHandle';
  handle.appendChild(el('span', { style: 'color:#fff;font-size:10px;font-weight:700', text: '⇔' }));
  viewport.appendChild(handle);

  viewport.appendChild(el('div', { style: 'position:absolute;top:6px;left:6px;padding:2px 8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;border-radius:2px;pointer-events:none', text: 'Legacy' }));
  viewport.appendChild(el('div', { style: 'position:absolute;top:6px;right:6px;padding:2px 8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;border-radius:2px;pointer-events:none', text: 'Controlled V2' }));

  const placeholder = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;text-align:center;font-size:11px;color:var(--text-faint);background:var(--surface-1)' });
  placeholder.id = 'ibaPlaceholder';
  placeholder.textContent = 'Waiting for the latest Legacy and V2 previews.';
  viewport.appendChild(placeholder);

  root.appendChild(viewport);

  // Phase B: concise split guidance, always visible.
  root.appendChild(el('div', { style: 'font-size:10px;color:var(--text-faint)', text: 'Drag the divider or use the slider below.' }));

  // Accessible keyboard-operable range control (kept visible, not hidden).
  const rangeWrap = el('div', { style: 'display:flex;align-items:center;gap:8px' });
  rangeWrap.appendChild(el('span', { style: 'font-size:10px;color:var(--text-faint);white-space:nowrap', text: '0% V2' }));
  const range = el('input', {
    style: 'flex:1;accent-color:var(--accent)',
    attrs: { type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Comparison split between Legacy and Controlled V2 previews' },
  });
  range.id = 'ibaRangeInput';
  rangeWrap.appendChild(range);
  rangeWrap.appendChild(el('span', { style: 'font-size:10px;color:var(--text-faint);white-space:nowrap', text: '100% Legacy' }));
  root.appendChild(rangeWrap);

  // Phase B: a small non-live visual percentage/direction readout —
  // updated on every state change but never itself an aria-live
  // region (per the phase's "do not update aria-live on every percent
  // movement" requirement).
  const splitReadout = el('div', { style: 'font-size:10px;color:var(--text-faint)' });
  splitReadout.id = 'ibaSplitReadout';
  root.appendChild(splitReadout);

  const statusLine = el('div', { style: 'font-size:11px;color:var(--text-dim)', attrs: { 'aria-live': 'polite' } });
  statusLine.id = 'ibaStatusLine';
  root.appendChild(statusLine);

  const messagesWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
  messagesWrap.id = 'ibaMessages';
  root.appendChild(messagesWrap);

  const details = el('details', { style: 'font-size:10.5px;color:var(--text-dim)' });
  details.appendChild(el('summary', { style: 'cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em', text: 'Technical details' }));
  const detailsBody = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
  // FIX 10 (EPIC 2E-I-A-F): dynamic per-generation alignment info,
  // updated on every renderInteractiveBeforeAfterStatus() call —
  // separate from the static limitations list below it.
  const alignmentInfo = el('div', { style: 'display:flex;flex-direction:column;gap:3px;padding-bottom:4px;margin-bottom:4px;border-bottom:1px solid var(--border)' });
  alignmentInfo.id = 'ibaAlignmentInfo';
  detailsBody.appendChild(alignmentInfo);
  [
    'Both previews come from the isolated Canvas 2D browser renderer.',
    'RAW development is not reproduced.',
    'Exact camera profiles are not reproduced.',
    'Local masks are not reproduced.',
    'Color Grading support is partial (shadow/highlight saturation only).',
    'There is no production write path from this viewer.',
  ].forEach(t => detailsBody.appendChild(el('div', { text: t })));
  details.appendChild(detailsBody);
  root.appendChild(details);

  container.replaceChildren(root);
  return getInteractiveBeforeAfterElements(container);
}

/** Returns the live element references the controller needs, without rebuilding anything. */
export function getInteractiveBeforeAfterElements(container) {
  if (!container) return null;
  return {
    viewport: document.getElementById('ibaViewport'),
    legacyDisplayCanvas: document.getElementById(LEGACY_DISPLAY_CANVAS_ID),
    v2DisplayCanvas: document.getElementById(V2_DISPLAY_CANVAS_ID),
    overlayWrapper: document.getElementById('ibaOverlayWrapper'),
    dividerElement: document.getElementById('ibaDivider'),
    handleElement: document.getElementById('ibaHandle'),
    rangeInput: document.getElementById('ibaRangeInput'),
  };
}

/**
 * Updates the status/warning/technical-details text from a controller
 * state object. Never touches the canvases, the split CSS variable, or
 * the clip-path — those remain the controller's own responsibility.
 */
export function renderInteractiveBeforeAfterStatus(container, state) {
  if (!container) return;
  ensureInteractiveBeforeAfterLayout(container);

  const s = (state && typeof state === 'object') ? state : {};
  const normalized = _normalizeState(s.state);

  const badgeEl = document.getElementById('ibaStatusBadge');
  if (badgeEl) badgeEl.replaceChildren(badge(STATE_LABEL[normalized], STATE_COLOR[normalized]));

  const statusLineEl = document.getElementById('ibaStatusLine');
  // Phase B: Partial explicitly names which side is available/missing,
  // per the phase's requirement ("state which side is available").
  let statusMessage = STATUS_MESSAGE[normalized] ?? STATUS_MESSAGE.unavailable;
  if (normalized === 'partial') {
    const legacyOk = s.legacyAvailable === true;
    statusMessage = legacyOk
      ? 'Partial preview: Legacy preview available, Controlled V2 preview unavailable.'
      : 'Partial preview: Controlled V2 preview available, Legacy preview unavailable.';
  }
  if (statusLineEl) statusLineEl.textContent = statusMessage;

  const placeholderEl = document.getElementById('ibaPlaceholder');
  const viewportEl = document.getElementById('ibaViewport');
  const handleEl = document.getElementById('ibaHandle');
  const rangeEl = document.getElementById('ibaRangeInput');
  const interactive = s.interactive === true;
  if (placeholderEl) placeholderEl.style.display = interactive ? 'none' : 'flex';
  if (placeholderEl && !interactive) placeholderEl.textContent = statusMessage;
  if (handleEl) handleEl.setAttribute('aria-disabled', interactive ? 'false' : 'true');
  if (rangeEl) rangeEl.disabled = !interactive;
  if (viewportEl) viewportEl.style.opacity = interactive || normalized === 'ready' ? '1' : '0.4';

  // Phase B: compact Legacy/V2/Alignment source status summary —
  // friendly labels, never raw internal state values.
  const sourceStatusRowEl = document.getElementById('ibaSourceStatusRow');
  if (sourceStatusRowEl) {
    sourceStatusRowEl.replaceChildren();
    const a = (s.alignment && typeof s.alignment === 'object') ? s.alignment : null;
    const meta = (s.metadata && typeof s.metadata === 'object') ? s.metadata : {};

    const legacyLabel = s.legacyAvailable === true
      ? (meta.legacyVisualAdjustmentsApplied === false ? 'Legacy: No supported adjustment' : 'Legacy: Rendered')
      : 'Legacy: Unavailable';
    sourceStatusRowEl.appendChild(badge(legacyLabel, s.legacyAvailable === true ? 'var(--success, green)' : 'var(--text-faint)'));

    const v2Label = s.v2Available === true
      ? (meta.v2VisualAdjustmentsApplied === false ? 'Controlled V2: No supported adjustment' : 'Controlled V2: Rendered')
      : (normalized === 'blocked' ? 'Controlled V2: Blocked' : 'Controlled V2: Unavailable');
    sourceStatusRowEl.appendChild(badge(v2Label, s.v2Available === true ? 'var(--success, green)' : 'var(--text-faint)'));

    if (a && a.sourceLegacyWidth !== null && a.sourceV2Width !== null) {
      let alignLabel, alignColor;
      if (a.sameAspectRatio === false) { alignLabel = 'Alignment: Blocked geometry'; alignColor = 'var(--danger, red)'; }
      else if (a.displayDimensionsNormalized === true) { alignLabel = 'Alignment: Normalized once'; alignColor = 'var(--text-dim)'; }
      else if (a.exactSourcePixelMatch === true) { alignLabel = 'Alignment: Exact dimensions'; alignColor = 'var(--success, green)'; }
      else { alignLabel = 'Alignment: Unknown'; alignColor = 'var(--text-faint)'; }
      sourceStatusRowEl.appendChild(badge(alignLabel, alignColor));
    }
  }

  // Phase B: non-live split percentage + direction guidance — never
  // itself an aria-live region, updated on every state change only
  // (not spammed on every 1% pointer movement, since this function is
  // only called from onStateChange / explicit render calls, never
  // from the controller's own internal per-frame split application).
  const splitReadoutEl = document.getElementById('ibaSplitReadout');
  if (splitReadoutEl) {
    const pct = Number.isFinite(s.splitPercent) ? Math.round(s.splitPercent) : 50;
    let guidance;
    if (pct <= 0) guidance = 'Controlled V2 shown';
    else if (pct >= 100) guidance = 'Legacy shown';
    else guidance = 'Legacy left · Controlled V2 right';
    splitReadoutEl.textContent = `${pct}% — ${guidance}`;
  }

  const messagesEl = document.getElementById('ibaMessages');
  if (messagesEl) {
    messagesEl.replaceChildren();
    // Phase B: normalize + dedupe, bounded count, safe string
    // extraction only — never a raw object, never a repeated
    // approximation warning across multiple cards.
    const seen = new Set();
    const pushUnique = (text, color) => {
      const t = _safeText(text);
      if (!t || seen.has(t)) return;
      seen.add(t);
      messagesEl.appendChild(el('div', { style: `font-size:11px;color:${color}`, text: t }));
    };
    _safeArray(s.blockers).slice(0, 3).forEach(b => pushUnique(b, 'var(--danger, red)'));
    _safeArray(s.warnings).slice(0, 3).forEach(w => pushUnique(w, 'var(--warn, orange)'));
  }

  // FIX 10 (EPIC 2E-I-A-F): compact alignment technical metadata,
  // shown when both sides carry real alignment data (Ready or
  // Blocked) — never claims exact pixel alignment when dimensions
  // actually differed and resampling was required.
  const alignmentInfoEl = document.getElementById('ibaAlignmentInfo');
  if (alignmentInfoEl) {
    alignmentInfoEl.replaceChildren();
    const a = (s.alignment && typeof s.alignment === 'object') ? s.alignment : null;
    if (a && a.sourceLegacyWidth !== null && a.sourceV2Width !== null) {
      const rows = [
        ['Exact source pixel match', a.exactSourcePixelMatch === true ? 'Yes' : a.exactSourcePixelMatch === false ? 'No' : 'unknown'],
        ['Same aspect ratio', a.sameAspectRatio === true ? 'Yes' : a.sameAspectRatio === false ? 'No' : 'unknown'],
        ['Aspect-ratio difference', Number.isFinite(a.aspectRatioRelativeDifference) ? `${(a.aspectRatioRelativeDifference * 100).toFixed(3)}%` : 'unknown'],
        ['Comparison tolerance', Number.isFinite(a.aspectRatioTolerance) ? `${(a.aspectRatioTolerance * 100).toFixed(3)}%` : 'unknown'],
        ['Display dimensions normalized', a.displayDimensionsNormalized === true ? 'Yes' : a.displayDimensionsNormalized === false ? 'No' : 'unknown'],
        ['Display resolution', (Number.isFinite(a.displayWidth) && Number.isFinite(a.displayHeight)) ? `${a.displayWidth}×${a.displayHeight}` : 'unavailable'],
        ['Legacy source resolution', (Number.isFinite(a.sourceLegacyWidth) && Number.isFinite(a.sourceLegacyHeight)) ? `${a.sourceLegacyWidth}×${a.sourceLegacyHeight}` : 'unknown'],
        ['V2 source resolution', (Number.isFinite(a.sourceV2Width) && Number.isFinite(a.sourceV2Height)) ? `${a.sourceV2Width}×${a.sourceV2Height}` : 'unknown'],
      ];
      rows.forEach(([label, value]) => {
        const row = el('div', { style: 'display:flex;justify-content:space-between;gap:8px' });
        row.appendChild(el('span', { style: 'color:var(--text-faint)', text: label }));
        row.appendChild(el('span', { style: 'color:var(--text-dim);overflow-wrap:anywhere;text-align:right', text: String(value) }));
        alignmentInfoEl.appendChild(row);
      });
      if (a.displayDimensionsNormalized === true) {
        alignmentInfoEl.appendChild(el('div', { style: 'font-size:10px;color:var(--text-faint);font-style:italic;margin-top:2px', text: 'Display dimensions were normalized once for alignment; source preview canvases were not changed.' }));
      }
    }
  }
}

/** Resets the section's status display to the empty/waiting state without destroying the skeleton. */
export function clearInteractiveBeforeAfterDisplay(container) {
  if (!container || container.dataset.ibaLayoutBuilt !== '1') return;
  renderInteractiveBeforeAfterStatus(container, { state: 'unavailable', interactive: false, warnings: [], blockers: [] });
}
