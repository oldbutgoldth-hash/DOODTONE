/**
 * ui/calibration-lab/calibration-lab-renderer.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * DOM rendering for the Calibration Lab overlay. Pure presentation --
 * reads controller state via `controller.getState()`/`subscribe()` and
 * calls controller action methods; never touches `ui/app.js`'s own
 * `state` or DOM. Inherits the app's CSS custom properties (`--bg`,
 * `--accent`, etc.) by being mounted INSIDE `#lumixaApp` (see
 * `calibration-lab-entry.js`), so it automatically follows dark/light
 * mode without its own theme system.
 *
 * EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: the Side-by-Side / Before-
 * After view now renders GENUINELY DIFFERENT Legacy vs Controlled V2
 * pixels for any image added during the current runtime session, by
 * reusing (never reimplementing) the exact same production functions
 * ui/app.js's own Visual Preview Comparison uses --
 * createVisualPreviewComparisonControllerV2 (from
 * ui/visual-preview-comparison-controller-v2.js) bound to two
 * Calibration-Lab-owned canvases, never the main app's own canvases or
 * controller instance. The decoded <img> + transient Render Plan live
 * in ui/calibration-lab/calibration-lab-controller.js's bounded,
 * never-persisted pixelPreviewCache (see getPixelPreviewInput()/
 * MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE) -- a session restored from
 * storage (a fresh page load) honestly has no live image to render,
 * and falls back to a clear, translated unavailable message rather
 * than pretending.
 *
 * Accessibility (R1 Section 15): the overlay is a `role="dialog"
 * aria-modal="true"` with a focus trap while open, closes on Escape
 * (returning focus to the nav trigger), respects
 * `prefers-reduced-motion`, and every interactive control meets the
 * 44px touch-target minimum.
 */

import { calibrationLabT } from './calibration-lab-i18n.js';
import {
  IMAGE_CATEGORIES, LIGHTING_CONDITIONS, USER_DECISIONS, ISSUE_CODES,
} from '../../core/calibration-lab/codes.js';
import { computeImageFingerprint } from '../../core/calibration-lab/run-comparison-pipeline.js';
// EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: reuse the exact same
// production Visual Preview Comparison controller the main app uses
// (never a reimplementation of pixel rendering logic). A FRESH
// instance is created for each render, bound to the Calibration Lab's
// OWN two canvases -- it never touches ui/app.js's own controller
// instance or canvases.
import { createVisualPreviewComparisonControllerV2 } from '../visual-preview-comparison-controller-v2.js';

const STYLE_ID = 'calibrationLabStyles';

function _injectStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#calibrationLabRoot { display:none; }
#calibrationLabRoot.cal-open {
  display:flex; flex-direction:column; position:fixed; inset:0; z-index:900;
  background:var(--bg); color:var(--text); font-family:var(--font-sans);
}
#calibrationLabRoot * { box-sizing:border-box; }
.cal-header {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:14px 16px; border-bottom:1px solid var(--border); background:var(--surface-1);
  flex-wrap:wrap;
}
.cal-body { flex:1; overflow:auto; padding:16px; -webkit-overflow-scrolling:touch; }
.cal-btn {
  min-height:44px; min-width:44px; padding:10px 16px; border-radius:4px;
  border:1px solid var(--border-strong); background:var(--surface-2); color:var(--text);
  font-family:var(--font-sans); font-size:13px; cursor:pointer;
}
.cal-btn:focus-visible, .cal-icon-btn:focus-visible, .cal-chip:focus-visible, .cal-check-label:focus-within {
  outline:3px solid var(--accent); outline-offset:2px;
}
.cal-btn.cal-btn-primary { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
.cal-icon-btn { min-height:44px; min-width:44px; display:flex; align-items:center; justify-content:center; border-radius:4px; border:1px solid var(--border); background:transparent; color:var(--text-dim); cursor:pointer; }
.cal-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.cal-grid-2 { display:flex; gap:16px; flex-wrap:wrap; }
.cal-grid-2 > * { flex:1 1 280px; min-width:0; }
.cal-panel { background:var(--surface-1); border:1px solid var(--border); border-radius:6px; padding:14px; }
.cal-chip {
  display:inline-flex; align-items:center; min-height:44px; padding:8px 14px; margin:3px;
  border-radius:20px; border:1px solid var(--border-strong); background:var(--surface-2); color:var(--text-dim);
  font-size:12.5px; cursor:pointer; user-select:none;
}
.cal-chip[aria-pressed="true"] { background:var(--accent-soft); color:var(--accent-strong); border-color:var(--accent); }
.cal-check-label {
  display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:6px 10px; margin:2px;
  border-radius:4px; cursor:pointer; font-size:12.5px; color:var(--text-dim);
}
.cal-check-label input { width:20px; height:20px; }
.cal-slider-wrap { position:relative; width:100%; max-width:520px; aspect-ratio:4/3; background:var(--surface-2); border:1px solid var(--border); border-radius:6px; overflow:hidden; touch-action:none; }
.cal-slider-wrap img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.cal-slider-wrap canvas.cal-compare-canvas { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.cal-slider-handle {
  position:absolute; top:0; bottom:0; width:3px; background:var(--accent); left:50%;
  transform:translateX(-1.5px); cursor:ew-resize;
}
.cal-slider-handle::after {
  content:''; position:absolute; top:50%; left:50%; width:44px; height:44px; margin:-22px 0 0 -22px;
  border-radius:50%; background:var(--accent);
}
.cal-label-side { position:absolute; top:8px; font-family:var(--font-mono); font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:4px 8px; border-radius:12px; background:rgba(0,0,0,.5); color:#fff; }
.cal-textarea { width:100%; min-height:80px; padding:10px; border-radius:4px; border:1px solid var(--border-strong); background:var(--surface-2); color:var(--text); font-family:var(--font-sans); font-size:13px; }
.cal-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.cal-table th, .cal-table td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); }
.cal-note { font-size:11.5px; color:var(--text-faint); }
@media (prefers-reduced-motion: reduce) { #calibrationLabRoot * { transition:none !important; animation:none !important; } }
@media (max-width: 700px) { .cal-grid-2 > * { flex:1 1 100%; } }
`;
  document.head.appendChild(style);
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function mountCalibrationLabUI(root, controller, { getLocale } = {}) {
  _injectStylesOnce();
  let lastFocusedBeforeOpen = null;
  let sliderPct = 50;
  // EPIC 2E-K-R2 -- the live pixel-compare controller instance bound
  // to the CURRENT comparison view's two canvases. Canvases are
  // recreated fresh every render() call (render() does
  // root.innerHTML = ''), so this instance must be disposed and
  // recreated alongside them -- never reused across a DOM rebuild,
  // and never shared with ui/app.js's own instance/canvases.
  let pixelCompareCtrl = null;
  function _disposePixelCompareCtrl() {
    if (pixelCompareCtrl) { try { pixelCompareCtrl.dispose(); } catch { /* ignore */ } pixelCompareCtrl = null; }
  }

  function lang() { return (getLocale ? getLocale() : controller.getState().locale) || 'th'; }
  function T(path) { return calibrationLabT(path, lang()); }

  function _trapFocus(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(el => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    lastFocusedBeforeOpen = document.activeElement;
    root.classList.add('cal-open');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', T('nav.title'));
    document.addEventListener('keydown', _trapFocus, true);
    render();
    const firstFocusable = root.querySelector(FOCUSABLE_SELECTOR);
    if (firstFocusable) firstFocusable.focus();
  }

  function close() {
    root.classList.remove('cal-open');
    document.removeEventListener('keydown', _trapFocus, true);
    _disposePixelCompareCtrl();
    if (lastFocusedBeforeOpen && typeof lastFocusedBeforeOpen.focus === 'function') lastFocusedBeforeOpen.focus();
  }

  function _el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  function _renderHeader(state) {
    const header = _el('div', { class: 'cal-header' });
    header.appendChild(_el('div', {}, [
      _el('div', { style: 'font-weight:700;font-size:15px', text: T('nav.title'), 'data-cal-role': 'title' }),
      _el('div', { class: 'cal-note', text: T('nav.subtitle') }),
    ]));
    const persistenceNote = state.persistenceMode === 'INDEXEDDB' ? T('session.persistenceModeIndexedDb') : T('session.persistenceModeInMemory');
    header.appendChild(_el('div', { class: 'cal-note', text: persistenceNote, 'data-cal-role': 'persistence-note' }));
    header.appendChild(_el('button', {
      class: 'cal-icon-btn', 'aria-label': T('a11y.closeDialog'), title: T('nav.closeButton'), text: '✕',
      onclick: close,
    }));
    return header;
  }

  function _renderSessionPicker(state) {
    const panel = _el('div', { class: 'cal-panel' });
    panel.appendChild(_el('div', { class: 'cal-row' }, [
      _el('button', { class: 'cal-btn cal-btn-primary', text: T('session.newSession'), onclick: async () => { await controller.startNewSession(); render(); } }),
    ]));
    if (state.lastActionError === 'SESSION_LIMIT_REACHED') panel.appendChild(_el('div', { class: 'cal-note', style: 'color:var(--danger)', text: T('session.sessionLimitReached') }));
    panel.appendChild(_el('div', { style: 'margin-top:14px;font-weight:600;font-size:12.5px', text: T('session.openSession') }));
    const list = _el('div', { class: 'cal-row', style: 'margin-top:8px' });
    controller.listAvailableSessions().then(sessions => {
      list.innerHTML = '';
      if (!sessions.length) { list.appendChild(_el('div', { class: 'cal-note', text: T('session.noSessionOpen') })); return; }
      for (const s of sessions) {
        list.appendChild(_el('button', {
          class: 'cal-btn', text: `${s.sessionId.slice(0, 18)}… (${s.imageCount})`,
          onclick: async () => { await controller.openSession(s.sessionId); render(); },
        }));
      }
    });
    panel.appendChild(list);
    return panel;
  }

  /** Each chip owns its own `aria-pressed` toggle -- self-contained, no external mutable array to keep in sync. Callers read the CURRENT selection later by querying `[aria-pressed="true"]` chips directly (see `_renderAddImageForm`). */
  function _renderCategoryChecklist() {
    const wrap = _el('div', { role: 'group', 'aria-label': T('a11y.categoryChecklist') });
    for (const cat of IMAGE_CATEGORIES) {
      const chip = _el('button', {
        class: 'cal-chip', type: 'button', 'aria-pressed': 'false', text: T(`category.${cat}`), 'data-cal-category': cat,
      });
      chip.addEventListener('click', () => chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function _renderAddImageForm(state) {
    const panel = _el('div', { class: 'cal-panel' });
    panel.appendChild(_el('div', { style: 'font-weight:600;margin-bottom:8px', text: T('session.addImage') }));
    const catWrap = _renderCategoryChecklist();
    panel.appendChild(catWrap);

    const lightingSelect = _el('select', { class: 'cal-btn', style: 'margin-top:8px' });
    for (const cond of LIGHTING_CONDITIONS) lightingSelect.appendChild(_el('option', { value: cond, text: T(`lighting.${cond}`) }));
    panel.appendChild(lightingSelect);

    const fileInput = _el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    const pickBtn = _el('button', { class: 'cal-btn', style: 'margin-top:8px', text: T('session.addImage'), onclick: () => fileInput.click() });
    const statusNote = _el('div', { class: 'cal-note', style: 'margin-top:6px' });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      // Re-read the checklist's CURRENT pressed chips at click time
      // (the closure above is intentionally simplistic; categories are
      // re-derived here from the live DOM so a user can toggle chips
      // freely before picking a file).
      const selectedCats = [...catWrap.querySelectorAll('.cal-chip[aria-pressed="true"]')].map(btn => btn.getAttribute('data-cal-category'));
      if (selectedCats.length === 0) { statusNote.textContent = 'Select at least one image category first.'; return; }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      try {
        await img.decode();
        const before = controller.getState().records.length;
        // EPIC 2E-K-R2 -- ownership of `objectUrl` moves to the
        // controller's bounded pixelPreviewCache once addImage()
        // succeeds (it revokes it later, on eviction/session change).
        // This call site only revokes it itself on a FAILURE path
        // below, where the controller never cached it.
        await controller.addImage(img, { imageCategories: selectedCats, lightingCondition: lightingSelect.value, objectUrl });
        const afterState = controller.getState();
        if (afterState.records.length <= before) {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        URL.revokeObjectURL(objectUrl);
      } finally {
        fileInput.value = '';
      }
      render();
    });

    panel.appendChild(fileInput);
    panel.appendChild(pickBtn);
    panel.appendChild(statusNote);
    return panel;
  }

  function _renderComparisonView(state) {
    const record = state.currentRecord;
    const wrap = _el('div', { class: 'cal-grid-2' });

    const sliderPanel = _el('div', { class: 'cal-panel' });
    sliderPanel.appendChild(_el('div', { style: 'font-weight:600;margin-bottom:8px', text: T('a11y.sideBySide') }));
    const sliderWrap = _el('div', {
      class: 'cal-slider-wrap', role: 'slider', 'aria-label': T('a11y.beforeAfterSlider'),
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(sliderPct), tabindex: '0',
    });

    // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: any pixel-compare instance
    // bound to the PREVIOUS render's canvases is now stale (those
    // canvases were just discarded by render()'s root.innerHTML = '')
    // -- dispose it before possibly creating a fresh one below.
    _disposePixelCompareCtrl();
    const pixelInput = record
      ? controller.getPixelPreviewInput(record.imageId)
      : { available: false, reasonCode: 'PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION' };

    if (pixelInput.available) {
      const legacyCanvas = _el('canvas', { class: 'cal-compare-canvas', 'aria-hidden': 'true', 'data-cal-role': 'pixel-canvas-legacy' });
      const v2Canvas = _el('canvas', { class: 'cal-compare-canvas', 'aria-hidden': 'true', 'data-cal-role': 'pixel-canvas-v2' });
      legacyCanvas.style.clipPath = `inset(0 ${100 - sliderPct}% 0 0)`;
      v2Canvas.style.clipPath = `inset(0 0 0 ${sliderPct}%)`;
      sliderWrap.appendChild(_el('span', { class: 'cal-label-side', style: 'left:8px', text: T('pixelPreview.legacyLabel') }));
      sliderWrap.appendChild(legacyCanvas);
      sliderWrap.appendChild(_el('span', { class: 'cal-label-side', style: 'right:8px', text: T('pixelPreview.v2Label') }));
      sliderWrap.appendChild(v2Canvas);
      const handle = _el('div', { class: 'cal-slider-handle', style: `left:${sliderPct}%` });
      sliderWrap.appendChild(handle);
      function setPct(pct) {
        sliderPct = Math.max(0, Math.min(100, pct));
        handle.style.left = `${sliderPct}%`;
        legacyCanvas.style.clipPath = `inset(0 ${100 - sliderPct}% 0 0)`;
        v2Canvas.style.clipPath = `inset(0 0 0 ${sliderPct}%)`;
        sliderWrap.setAttribute('aria-valuenow', String(Math.round(sliderPct)));
      }
      sliderWrap.addEventListener('pointerdown', (e) => {
        const rect = sliderWrap.getBoundingClientRect();
        function onMove(ev) { setPct(((ev.clientX - rect.left) / rect.width) * 100); }
        function onUp() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        onMove(e);
      });
      sliderWrap.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { setPct(sliderPct - 5); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { setPct(sliderPct + 5); e.preventDefault(); }
      });
      sliderPanel.appendChild(sliderWrap);

      const pixelStatusNote = _el('div', {
        class: 'cal-note', style: 'margin-top:6px', text: T('pixelPreview.rendering'), 'data-cal-role': 'pixel-preview-status',
      });
      sliderPanel.appendChild(pixelStatusNote);

      // Reuse (never reimplement) the exact same production isolated
      // pixel renderer ui/app.js's own Visual Preview Comparison uses,
      // bound to THESE two Calibration-Lab-owned canvases only.
      pixelCompareCtrl = createVisualPreviewComparisonControllerV2({ legacyCanvas, v2Canvas });
      pixelCompareCtrl.render({
        source: pixelInput.imgElement,
        renderPlan: pixelInput.renderPlan,
        analysisGenerationId: pixelInput.analysisGenerationId,
      }).then((result) => {
        // Guard: only touch this node if render() hasn't rebuilt the
        // DOM again in the meantime (e.g. user navigated to a
        // different image before this async render resolved).
        if (!pixelStatusNote.isConnected) return;
        const stateKey = (st) => (
          st === 'rendered' ? 'stateRendered'
          : st === 'blocked' ? 'stateBlocked'
          : st === 'failed' ? 'stateFailed'
          : st === 'cancelled' ? 'stateCancelled'
          : 'stateUnavailable'
        );
        const legacyState = result?.legacy?.state ?? null;
        const v2State = result?.v2?.state ?? null;
        pixelStatusNote.textContent =
          `${T('pixelPreview.legacyLabel')}: ${T('pixelPreview.' + stateKey(legacyState))} | ${T('pixelPreview.v2Label')}: ${T('pixelPreview.' + stateKey(v2State))}`;
        pixelStatusNote.setAttribute('data-cal-pixel-legacy-state', legacyState ?? 'unknown');
        pixelStatusNote.setAttribute('data-cal-pixel-v2-state', v2State ?? 'unknown');
        pixelStatusNote.setAttribute('data-cal-pixel-overall-state', result?.state ?? 'unknown');
      }).catch(() => {
        if (pixelStatusNote.isConnected) pixelStatusNote.textContent = T('pixelPreview.stateFailed');
      });
    } else {
      sliderWrap.appendChild(_el('div', {
        class: 'cal-note', style: 'padding:16px', 'data-cal-role': 'pixel-preview-unavailable',
        text: T('pixelPreview.unavailableNotInSession'),
      }));
      sliderPanel.appendChild(sliderWrap);
    }
    wrap.appendChild(sliderPanel);

    const dataPanel = _el('div', { class: 'cal-panel' });
    const table = _el('table', { class: 'cal-table' });
    const legacy = record?.legacySnapshot ?? {};
    const v2 = record?.controlledV2Snapshot ?? {};
    const rows = [
      ['Temperature', legacy.temperature, v2.temperature],
      ['Tint', legacy.tint, v2.tint],
      ['Confidence', legacy.confidence, v2.confidence],
      ['Safety score', legacy.safetyScore, v2.safetyScore],
    ];
    table.appendChild(_el('tr', {}, [_el('th', { text: '' }), _el('th', { text: 'Legacy' }), _el('th', { text: 'Controlled V2' })]));
    for (const [label, l, v] of rows) {
      table.appendChild(_el('tr', {}, [
        _el('td', { text: label }),
        _el('td', { text: l === null || l === undefined ? '—' : String(l) }),
        _el('td', { text: v === null || v === undefined ? '—' : String(v) }),
      ]));
    }
    dataPanel.appendChild(table);
    wrap.appendChild(dataPanel);
    return wrap;
  }

  function _renderDecisionControls(state) {
    const record = state.currentRecord;
    const panel = _el('div', { class: 'cal-panel', style: 'margin-top:16px' });
    const decisionRow = _el('div', { class: 'cal-row', role: 'radiogroup', 'aria-label': 'Decision' });
    let pendingDecision = record?.userDecision ?? 'NOT_REVIEWED';
    let pendingIssues = record?.issueCodes ? [...record.issueCodes] : [];
    for (const d of USER_DECISIONS) {
      if (d === 'NOT_REVIEWED') continue;
      decisionRow.appendChild(_el('button', {
        class: 'cal-chip', type: 'button', 'aria-pressed': String(pendingDecision === d), text: T(`decision.${d}`),
        onclick: (e) => { pendingDecision = d; [...decisionRow.children].forEach(c => c.setAttribute('aria-pressed', String(c === e.target))); },
      }));
    }
    panel.appendChild(decisionRow);

    panel.appendChild(_el('div', { style: 'font-weight:600;margin-top:12px', text: T('a11y.issueChecklist') }));
    const issueWrap = _el('div', { role: 'group', 'aria-label': T('a11y.issueChecklist') });
    for (const code of ISSUE_CODES) {
      const id = `cal-issue-${code}`;
      const checked = pendingIssues.includes(code);
      const input = _el('input', { type: 'checkbox', id, ...(checked ? { checked: 'checked' } : {}) });
      input.addEventListener('change', () => {
        pendingIssues = input.checked ? [...pendingIssues, code] : pendingIssues.filter(c => c !== code);
      });
      issueWrap.appendChild(_el('label', { class: 'cal-check-label', for: id }, [input, document.createTextNode(T(`issue.${code}`))]));
    }
    panel.appendChild(issueWrap);

    const notes = _el('textarea', { class: 'cal-textarea', style: 'margin-top:10px', 'aria-label': T('notes.label'), placeholder: T('notes.placeholder') });
    notes.value = record?.notes ?? '';
    panel.appendChild(notes);

    const actionRow = _el('div', { class: 'cal-row', style: 'margin-top:12px' });
    actionRow.appendChild(_el('button', {
      class: 'cal-btn cal-btn-primary', text: T('session.saveDecision'),
      onclick: async () => { await controller.saveCurrentDecision({ userDecision: pendingDecision, issueCodes: pendingIssues, notes: notes.value }); render(); },
    }));
    actionRow.appendChild(_el('button', { class: 'cal-btn', text: T('session.clearCurrentAnswer'), onclick: async () => { await controller.clearCurrentAnswer(); render(); } }));
    panel.appendChild(actionRow);
    return panel;
  }

  function _renderNav(state) {
    const nav = _el('div', { class: 'cal-row', style: 'margin-bottom:14px' });
    nav.appendChild(_el('button', { class: 'cal-btn', text: '← ' + T('session.previousImage'), onclick: async () => { _revokeCurrentImage(); controller.goToPrevious(); render(); } }));
    nav.appendChild(_el('span', { class: 'cal-note', text: `${T('session.reviewedCountLabel')}: ${state.session?.reviewedCount ?? 0} / ${state.records.length} · ${T('session.pendingCountLabel')}: ${state.session?.pendingCount ?? 0}` }));
    nav.appendChild(_el('button', { class: 'cal-btn', text: T('session.nextImage') + ' →', onclick: async () => { _revokeCurrentImage(); controller.goToNext(); render(); } }));
    return nav;
  }

  function _renderDashboard() {
    const dash = controller.getDashboard();
    const panel = _el('div', { class: 'cal-panel' });
    panel.appendChild(_el('div', { style: 'font-weight:700;font-size:14px', text: T('dashboard.title') }));
    const s = dash.summary;
    const summaryTable = _el('table', { class: 'cal-table' });
    const rows = [
      [T('dashboard.totalImages'), s.totalImages], [T('dashboard.reviewedCount'), s.reviewedCount],
      [T('dashboard.v2WinRate'), s.v2WinRate], [T('dashboard.legacyWinRate'), s.legacyWinRate],
      [T('dashboard.tieRate'), s.tieRate], [T('dashboard.bothUnacceptableRate'), s.bothUnacceptableRate],
      [T('dashboard.safetyWarningCount'), dash.safetySignals.safetyWarningCount],
      [T('dashboard.lowConfidenceCount'), dash.safetySignals.lowConfidenceCount],
      [T('dashboard.mixedLightFailureCount'), dash.safetySignals.mixedLightFailureCount],
      [T('dashboard.skinToneIssueCount'), dash.safetySignals.skinToneIssueCount],
    ];
    for (const [label, val] of rows) summaryTable.appendChild(_el('tr', {}, [_el('td', { text: label }), _el('td', { text: val === null ? '—' : String(val) })]));
    panel.appendChild(summaryTable);
    panel.appendChild(_el('div', { class: 'cal-note', style: 'margin-top:10px', text: T('dashboard.noSingleScoreWarning') }));
    return panel;
  }

  function _renderReadiness() {
    const rr = controller.getReadinessReport();
    const panel = _el('div', { class: 'cal-panel' });
    panel.appendChild(_el('div', { style: 'font-weight:700;font-size:14px', text: T('readiness.reportTitle') }));
    panel.appendChild(_el('div', { style: 'font-weight:600;margin-top:8px;color:var(--accent)', text: T(`readiness.${rr.readinessStatus}`) }));
    const table = _el('table', { class: 'cal-table', style: 'margin-top:8px' });
    const rows = [
      ['Sample count', rr.sampleCount], ['Category coverage', rr.categoryCoverage], ['Lighting coverage', rr.lightingCoverage],
      ['V2 win rate', rr.v2WinRate], ['Legacy win rate', rr.legacyWinRate], ['Severe issue rate', rr.severeIssueRate],
      ['Safety warning rate', rr.safetyWarningRate], ['Low confidence rate', rr.lowConfidenceRate],
      ['Regression category count', rr.regressionCategoryCount],
    ];
    for (const [label, val] of rows) table.appendChild(_el('tr', {}, [_el('td', { text: label }), _el('td', { text: val === null ? '—' : String(val) })]));
    panel.appendChild(table);
    panel.appendChild(_el('div', { class: 'cal-note', style: 'margin-top:10px', text: T('readiness.disclaimer') }));
    return panel;
  }

  function _renderModeSwitcher(state) {
    const row = _el('div', { class: 'cal-row', style: 'margin-bottom:14px' });
    for (const [mode, labelPath] of [['REVIEW', 'session.addImage'], ['DASHBOARD', 'dashboard.title'], ['READINESS', 'readiness.reportTitle']]) {
      row.appendChild(_el('button', { class: state.calibrationMode === mode ? 'cal-btn cal-btn-primary' : 'cal-btn', text: T(labelPath), onclick: () => { controller.setMode(mode); render(); } }));
    }
    row.appendChild(_el('button', { class: 'cal-btn', text: T('exportPanel.exportButton'), onclick: () => _doExport() }));
    row.appendChild(_el('button', { class: 'cal-btn', text: T('session.endSession'), onclick: async () => { await controller.endSession(); render(); } }));
    return row;
  }

  function _doExport() {
    const json = controller.exportJson();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${json.session.sessionId || 'calibration'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function render() {
    const state = controller.getState();
    // Redundant, DOM-visible Semantic State for Browser QA (R1 Section
    // 14) -- mirrors `controller.getQaSnapshot()` exactly, so an
    // assertion can read either the QA global or these data attributes
    // without ever depending on visible Thai/English text.
    root.setAttribute('data-cal-mode', state.calibrationMode);
    root.setAttribute('data-cal-session-state', state.sessionState);
    root.setAttribute('data-cal-persistence-mode', state.persistenceMode);
    root.setAttribute('data-cal-image-count', String(state.records.length));
    root.setAttribute('data-cal-reviewed-count', String(state.session?.reviewedCount ?? 0));
    root.setAttribute('data-cal-current-decision', state.currentRecord?.userDecision ?? 'NOT_REVIEWED');
    root.innerHTML = '';
    root.appendChild(_renderHeader(state));
    const body = _el('div', { class: 'cal-body' });
    if (state.sessionState !== 'ACTIVE') {
      body.appendChild(_renderSessionPicker(state));
    } else if (state.calibrationMode === 'DASHBOARD') {
      body.appendChild(_renderModeSwitcher(state));
      body.appendChild(_renderDashboard());
    } else if (state.calibrationMode === 'READINESS') {
      body.appendChild(_renderModeSwitcher(state));
      body.appendChild(_renderReadiness());
    } else {
      body.appendChild(_renderModeSwitcher(state));
      body.appendChild(_renderAddImageForm(state));
      if (state.records.length > 0) {
        body.appendChild(_renderNav(state));
        body.appendChild(_renderComparisonView(state));
        body.appendChild(_renderDecisionControls(state));
      }
    }
    root.appendChild(body);
  }

  controller.subscribe(() => { if (root.classList.contains('cal-open')) render(); });

  return { open, close, render };
}
