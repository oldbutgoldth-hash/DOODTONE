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
  titleWrap.appendChild(el('h3', { style: 'margin:0;font-size:14px;font-weight:700;color:var(--text)', text: 'Visual Preview Comparison' }));
  titleWrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim);margin-top:2px', text: 'Approximate browser preview · Not Lightroom-accurate' }));
  header.appendChild(titleWrap);
  const overallStatusWrap = el('div', { attrs: { id: '', 'aria-live': 'polite' } });
  overallStatusWrap.id = 'vprOverallStatusBadge';
  header.appendChild(overallStatusWrap);
  root.appendChild(header);

  // Top safety notice — always visible, exact required wording.
  const notice = el('div', {
    style: 'font-size:11px;color:var(--text-dim);background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px 12px;line-height:1.5',
    text: 'These previews are browser approximations. They do not reproduce Lightroom, Adobe Camera Raw, RAW profiles, local masks or exact color management. Results may differ from Lightroom and Adobe Camera Raw.',
  });
  root.appendChild(notice);

  // UX Polish (EPIC 2E-H Phase D): a compact, ALWAYS-VISIBLE technical
  // limitations list — deliberately not hidden only inside a collapsed
  // `<details>` section, per this phase's explicit requirement.
  const limitationsNotice = el('div', { style: 'font-size:10px;color:var(--text-faint);line-height:1.6' });
  const limitationsList = el('ul', { style: 'margin:4px 0 0;padding-left:16px' });
  [
    'RAW development is not reproduced',
    'Camera profiles are not reproduced',
    'Local masks are not reproduced',
    'Full ICC proofing is not reproduced',
    'Sharpening and noise reduction are not guaranteed',
    'Color Grading support is partial (shadow/highlight saturation only)',
    'Midtone grading and Hue rendering remain unsupported',
  ].forEach(t => limitationsList.appendChild(el('li', { text: t })));
  limitationsNotice.appendChild(limitationsList);
  root.appendChild(limitationsNotice);

  // Safety confirmations strip (tri-state, filled in on render)
  const safetyStrip = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;font-size:10.5px' });
  safetyStrip.id = 'vprSafetyStrip';
  root.appendChild(safetyStrip);

  // Two-panel grid — reuses the project's existing responsive
  // stack-on-mobile grid class.
  const grid = el('div', { cls: 'lx-2col-grid', style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px' });

  function buildPanel(side, canvasId, ariaLabel, titleText) {
    const panel = el('div', { style: 'display:flex;flex-direction:column;gap:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:12px' });
    const panelHeader = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px' });
    panelHeader.appendChild(el('div', { style: 'font-size:12px;font-weight:700;color:var(--text)', text: titleText }));
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
    placeholder.textContent = 'Waiting for analysis and Render Plan.';
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
    const summary = el('summary', { style: 'cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em', text: 'Render details' });
    details.appendChild(summary);
    const detailsBody = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
    detailsBody.id = `vpr${side}Details`;
    details.appendChild(detailsBody);
    panel.appendChild(details);

    const disclaimer = el('div', { style: 'font-size:9.5px;color:var(--text-faint);font-style:italic', text: 'Approximate browser preview.' });
    panel.appendChild(disclaimer);

    return panel;
  }

  grid.appendChild(buildPanel('Legacy', LEGACY_CANVAS_ID, 'Approximate Legacy browser preview', 'Legacy Preview'));
  grid.appendChild(buildPanel('V2', V2_CANVAS_ID, 'Approximate Controlled V2 browser preview', 'Controlled V2 Preview'));
  root.appendChild(grid);

  // Overall warnings/blockers
  const overallMessages = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
  overallMessages.id = 'vprOverallMessages';
  overallMessages.setAttribute('aria-live', 'polite');
  root.appendChild(overallMessages);

  container.replaceChildren(root);
}

function _renderSidePanel(side, sideResult, selectedProductionSource, v2BlockerCode) {
  const badgesEl = document.getElementById(`vpr${side}Badges`);
  const placeholderEl = document.getElementById(`vpr${side}Placeholder`);
  const statusLineEl = document.getElementById(`vpr${side}StatusLine`);
  const warningsEl = document.getElementById(`vpr${side}Warnings`);
  const detailsEl = document.getElementById(`vpr${side}Details`);
  if (!badgesEl || !placeholderEl || !statusLineEl || !warningsEl || !detailsEl) return;

  badgesEl.replaceChildren();
  warningsEl.replaceChildren();
  detailsEl.replaceChildren();

  const sourceLabel = side === 'Legacy' ? 'legacy' : 'controlled-v2-preview';
  badgesEl.appendChild(badge(sourceLabel, side === 'Legacy' ? 'var(--accent)' : 'var(--text-dim)'));
  badgesEl.appendChild(badge('preview-only', 'var(--text-faint)'));
  // FIX 8 (EPIC 2E-H-C-F): the Legacy panel's "production-source" badge
  // is shown ONLY when selectedProductionSource is explicitly
  // "legacy" — never unconditionally. If evidence reports "v2" (a
  // critical anomaly, surfaced separately by the safety strip) or is
  // missing/unknown, this panel shows no false confirmation badge.
  if (side === 'Legacy') {
    if (selectedProductionSource === 'legacy') badgesEl.appendChild(badge('production-source', 'var(--success, green)'));
    else if (selectedProductionSource !== 'v2') badgesEl.appendChild(badge('production source not confirmed', 'var(--text-faint)'));
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
      msg = 'Complete Human Review to prepare the Controlled V2 preview.';
    }
    else if (!sideResult) msg = side === 'Legacy' ? 'Legacy preview plan is unavailable.' : 'V2 preview plan is unavailable.';
    else if (state === 'blocked') msg = 'Preview rendering is blocked by current safety evidence.';
    else if (state === 'cancelled') msg = 'Preview render was cancelled because a newer analysis is available.';
    else if (state === 'failed') msg = 'Preview rendering failed. The source image and production output were not changed.';
    else if (state === 'unavailable') msg = side === 'Legacy' ? 'Legacy preview plan is unavailable.' : 'V2 preview plan is unavailable.';
    else if (state === 'preparing') {
      // FIX 3 (EPIC 2E-H-C-F2): two genuinely different "preparing"
      // contexts share the same state value — distinguished via a
      // metadata flag rather than conflating their wording. When the
      // whole analysis pipeline is still running (`analysisInProgress`),
      // neither side has begun anything yet. Otherwise (the Legacy-vs-V2
      // sequential-render queue from EPIC 2E-H-C-F), V2 is simply
      // waiting its turn while Legacy renders first.
      msg = sideResult?.metadata?.analysisInProgress === true
        ? 'Waiting for the latest analysis…'
        : 'Waiting for the sequential render to begin…';
    }
    else if (state === 'rendering') msg = 'Rendering approximate browser preview…';
    else msg = 'Waiting for analysis and Render Plan.';
    placeholderEl.textContent = msg;
  }

  statusLineEl.textContent = `Status: ${STATE_LABEL[state] ?? 'Unavailable'}`;

  const visualAdjustmentsApplied = sideResult?.metadata?.visualAdjustmentsApplied;
  if (rendered && visualAdjustmentsApplied === false) {
    // DEPLOY GEOMETRY R1 — Phase C2: for the V2 side, this is the
    // valid Identity Preview state (available + renderable +
    // previewOnly + zero supported adjustments) — use the spec's exact
    // required wording. This branch only runs when `rendered` is
    // already true (the "Unavailable" placeholder above is hidden in
    // that case, and STATE_LABEL['rendered'] is 'Rendered') — an
    // Identity Preview must never be described as Unavailable.
    const identityText = side !== 'Legacy'
      ? 'Identity preview — no supported browser adjustment was applied'
      : 'Preview rendered from the source image, but no supported visual adjustments were applied.';
    warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: identityText }));
  }
  _safeArray(sideResult?.warnings).slice(0, 4).forEach(w => {
    const t = _safeText(w);
    if (t) warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', text: t }));
  });
  _safeArray(sideResult?.reasons).slice(0, 2).forEach(r => {
    const t = _safeText(r);
    if (t) warningsEl.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-dim)', text: t }));
  });

  const rows = [
    ['Applied adjustments', _safeArray(sideResult?.appliedAdjustments).length],
    ['Skipped adjustments', _safeArray(sideResult?.skippedAdjustments).length],
    ['Processing time', Number.isFinite(sideResult?.processingTimeMs) ? `${sideResult.processingTimeMs.toFixed(1)} ms` : 'unknown'],
    ['CSS size', (Number.isFinite(sideResult?.cssWidth) && Number.isFinite(sideResult?.cssHeight)) ? `${sideResult.cssWidth}×${sideResult.cssHeight}` : 'unknown'],
    ['Backing size', (Number.isFinite(sideResult?.backingWidth) && Number.isFinite(sideResult?.backingHeight)) ? `${sideResult.backingWidth}×${sideResult.backingHeight}` : 'unknown'],
    ['Requested DPR', Number.isFinite(sideResult?.metadata?.requestedDevicePixelRatio) ? sideResult.metadata.requestedDevicePixelRatio : 'unknown'],
    ['Effective DPR', Number.isFinite(sideResult?.devicePixelRatio) ? sideResult.devicePixelRatio : 'unknown'],
    ['Pixel count', Number.isFinite(sideResult?.metadata?.pixelCount) ? sideResult.metadata.pixelCount : 'unknown'],
    ['Memory downscaled', sideResult?.metadata?.downscaledForMemorySafety === true ? 'Yes' : sideResult?.metadata?.downscaledForMemorySafety === false ? 'No' : 'unknown'],
    ['Processing mode', _safeText(sideResult?.metadata?.processingMode) || 'unknown'],
    ['Commit atomicity', _safeText(sideResult?.metadata?.commitAtomicity) || 'unknown'],
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
export function renderVisualPreviewComparison(container, comparisonState) {
  if (!container) return;
  ensureVisualPreviewComparisonLayout(container);

  const cs = (comparisonState && typeof comparisonState === 'object') ? comparisonState : {};
  const overallState = _normalizeState(cs.state);

  const overallBadgeEl = document.getElementById('vprOverallStatusBadge');
  if (overallBadgeEl) {
    overallBadgeEl.replaceChildren(badge(STATE_LABEL[overallState], STATE_COLOR[overallState]));
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
      safetyStripEl.appendChild(badge('Production Mapping: Legacy', 'var(--success, green)'));
    } else if (selectedProductionSource === 'v2') {
      safetyStripEl.appendChild(badge('Critical anomaly: V2 reported as production source', 'var(--danger, red)'));
    } else {
      safetyStripEl.appendChild(badge('Production Mapping: Not confirmed', 'var(--text-faint)'));
    }

    // FIX 7: Preview Export — confirmed-disabled / enabled-anomaly / unknown.
    if (allowExport === false) safetyStripEl.appendChild(badge('Preview Export: Confirmed disabled', 'var(--success, green)'));
    else if (allowExport === true) safetyStripEl.appendChild(badge('Preview Export: Enabled anomaly', 'var(--danger, red)'));
    else safetyStripEl.appendChild(badge('Preview Export: Not confirmed', 'var(--text-faint)'));

    // FIX 7: Production Write — same tri-state pattern.
    if (allowProductionWrite === false) safetyStripEl.appendChild(badge('Production Write: Confirmed disabled', 'var(--success, green)'));
    else if (allowProductionWrite === true) safetyStripEl.appendChild(badge('Production Write: Enabled anomaly', 'var(--danger, red)'));
    else safetyStripEl.appendChild(badge('Production Write: Not confirmed', 'var(--text-faint)'));

    safetyStripEl.appendChild(badge(
      cs.visualComparisonAvailable === true ? 'Actual visual comparison: Available' : 'Actual visual comparison: Not available',
      cs.visualComparisonAvailable === true ? 'var(--success, green)' : 'var(--text-faint)',
    ));
  }

  _renderSidePanel('Legacy', cs.legacy, selectedProductionSource);
  // DEPLOY GEOMETRY R1 — Phase A FIX A1/A4: md.v2BlockerCode is a
  // bounded, stable diagnostic code (never a raw object/exception)
  // computed upstream (ui/app.js, which has access to both the Render
  // Plan and the Preview Sandbox) and threaded through in metadata —
  // used ONLY to select a more specific, honest placeholder message
  // for the V2 side; never changes eligibility/rendering itself.
  _renderSidePanel('V2', cs.v2, undefined, md.v2BlockerCode);

  const overallMessagesEl = document.getElementById('vprOverallMessages');
  if (overallMessagesEl) {
    overallMessagesEl.replaceChildren();
    const legacyRendered = cs.legacy?.rendered === true;
    const v2Rendered = cs.v2?.rendered === true;

    // UX Polish (EPIC 2E-H Phase D): a clear overall-outcome sentence,
    // exact required wording — never implies accuracy, only completion.
    if (overallState === 'rendered') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--success, green)', text: 'Both approximate browser previews are available.' }));
    } else if (overallState === 'partial') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: 'Partial preview: only one side rendered successfully.' }));
    } else if (overallState === 'cancelled') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim)', text: 'Preview rendering was cancelled because a newer analysis is active.' }));
    } else if (overallState === 'failed') {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--danger, red)', text: 'Visual Preview rendering failed. Analysis results and production output were not changed.' }));
    }

    if (legacyRendered && v2Rendered && (cs.legacy?.metadata?.visualAdjustmentsApplied === false || cs.v2?.metadata?.visualAdjustmentsApplied === false)) {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: 'One preview contains no supported visual adjustment.' }));
    }
    // UX Polish: memory-downscale messaging, deduplicated across sides.
    if ((legacyRendered && cs.legacy?.metadata?.downscaledForMemorySafety === true) || (v2Rendered && cs.v2?.metadata?.downscaledForMemorySafety === true)) {
      overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--text-dim)', text: 'Preview resolution was reduced for memory safety.' }));
    }
    const blockers = _safeArray(cs.blockers).slice(0, 4);
    blockers.forEach(b => {
      const t = _safeText(b);
      if (t) overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--danger, red)', text: t }));
    });
    const warnings = _safeArray(cs.warnings).slice(0, 4);
    warnings.forEach(w => {
      const t = _safeText(w);
      if (t) overallMessagesEl.appendChild(el('div', { style: 'font-size:11px;color:var(--warn, orange)', text: t }));
    });
  }
}

/** Resets the section to its empty/waiting visual state without destroying the skeleton (canvases remain in the DOM, cleared separately by the controller). */
export function clearVisualPreviewComparisonDisplay(container) {
  if (!container || container.dataset.vprLayoutBuilt !== '1') return;
  renderVisualPreviewComparison(container, { state: 'unavailable', legacy: null, v2: null, bothRendered: false, visualComparisonAvailable: false, warnings: [], blockers: [] });
}
