/**
 * ui/app.js — LUMIXA AI (Application controller / entry-point)
 * Adapted from the original engine controller: all analysis / preset /
 * export logic is untouched. Only presentation-state wiring (dark mode,
 * tabs, modals, drag state) has been switched from stylesheet classes to
 * inline CSS custom properties + direct style assignment, to match the
 * LUMIXA visual system (no external stylesheet).
 */

import { analyzeImage }                        from '../core/histogram-engine/index.js';
import { buildPreset, serializeXMP, downloadXMP } from '../core/preset-engine/index.js';
import { extractPalette }                      from '../core/kmeans-engine/index.js';
import { analyzeWhiteBalance }                 from '../core/whitebalance-engine/index.js';
import {
  setSlider, bindSliders, switchTab,
  renderHSLPanel, renderGradingPanel, renderCalibrationPanel,
  renderAnalysisPanel, setAnalysisBox, flashSuccess,
} from './ui-engine.js';
import { renderHistograms }    from './histogram-renderer.js';
import { renderPalette }       from './palette-renderer.js';
import { renderWhiteBalance }  from './whitebalance-renderer.js';
import { ToneCurveEditor }     from './tone-curve-editor.js';
import { analyzeSkinTone }     from '../core/skintone-engine/index.js';
import { renderSkinTone }      from './skintone-renderer.js';
import { generateBasicPanel }  from '../core/basic-panel-engine/index.js';
import { renderBasicPanel }    from './basic-panel-renderer.js';
import { analyzeHSL }          from '../core/hsl-analyzer-engine/index.js';
import { renderHSLAnalyzer }   from './hsl-analyzer-renderer.js';
import { analyzeColorGrading }  from '../core/colorgrading-ai-engine/index.js';
import { renderColorGrading }   from './colorgrading-renderer.js';
import { generateToneCurves }   from '../core/tone-curve-ai-engine/index.js';
import { renderToneCurves }     from './tone-curve-renderer.js';
import { analyzeCalibration }   from '../core/calibration-engine/index.js';
import { recognizeStyle }       from '../core/style-recognition-engine/index.js';
import { renderCalibration }    from './calibration-renderer.js';
import { generateHarmonies }    from '../core/color-harmony-engine/index.js';
import { renderColorHarmony }   from './color-harmony-renderer.js';
import { analyzeImageCore }     from '../core/image-analysis-core/index.js';
import { renderImageAnalysis }  from './image-analysis-renderer.js';
import { scenePreset }         from '../core/curve-engine/index.js';
import { buildFinalPreset }     from '../core/decision-engine/index.js';
import { classifySkin }         from '../core/skin-classifier/index.js';
import { processingLog }        from '../core/processing-log/index.js';
import { buildStyleFingerprint } from '../core/style-fingerprint/index.js';
import { buildStyleFeatureGraph } from '../core/feature-fusion-engine/index.js';
import { validateFinalPreset, quickSafetyClamp } from '../core/xmp-validator/index.js';
import { benchmarkStylePreservation } from '../core/style-benchmark-engine/index.js';
import { buildDecisionReport } from '../core/decision-report-engine/index.js';
import { renderReviewConsole } from './review-console-renderer.js';
import { createReviewConsoleController } from './review-console-controller.js';
import { buildReferenceTransferReport } from '../core/reference-transfer-engine/index.js';
import { classifyScene }        from '../core/scene-classifier/index.js';
import { detectColorCast }      from '../core/color-cast-detector/index.js';

// ─── Theme tokens (LUMIXA visual system) ───────────────────────────────────────
const THEME = {
  dark: {
    '--bg': '#15110c', '--surface-1': '#1c1712', '--surface-2': '#241d16', '--surface-3': '#332a1c',
    '--border': '#3a2f22', '--border-strong': '#55432d',
    '--text': '#f2e8d8', '--text-dim': '#b9a582', '--text-faint': '#7d6c52',
    '--accent': '#c9a24b', '--accent-soft': 'rgba(201,162,75,.14)', '--accent-strong': '#e0bd6e', '--on-accent': '#241a0a',
    '--success': '#93ac84', '--warn': '#d99a4e', '--danger': '#c17361',
  },
  light: {
    '--bg': '#f6efe1', '--surface-1': '#fbf6ec', '--surface-2': '#f1e7d4', '--surface-3': '#e7d9c0',
    '--border': '#e0d0b2', '--border-strong': '#c9b48c',
    '--text': '#2a2013', '--text-dim': '#7d6a4d', '--text-faint': '#a5926f',
    '--accent': '#a3762a', '--accent-soft': 'rgba(163,118,42,.12)', '--accent-strong': '#8a611f', '--on-accent': '#fff8ec',
    '--success': '#5c7657', '--warn': '#b5762c', '--danger': '#9c4f3f',
  },
};
function applyThemeVars(dark) {
  const root = document.getElementById('lumixaApp');
  if (!root) return;
  const map = dark ? THEME.dark : THEME.light;
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  darkMode:    localStorage.getItem('dm') !== '0',   // dark by default
  lang:        localStorage.getItem('lang')     || 'th',
  isPremium:   true,   // UNLIMITED MODE — quota system disabled
  freeCount:   0,      // unused
  imageLoaded: false,
  activeAnalysisGroup: 'overview', // which .agroup tab is currently visible — 'overview' matches its default display:flex in index.html
  lastStats:   null,
  lastPalette: null,
  lastWB:      null,
  lastSkin:    null,
  lastBasic:   null,
  lastHSL:     null,
  lastGrading: null,
  lastToneCurves: null,
  lastCalibration: null,
  lastHarmony:     null,
  lastImageAnalysis: null,
  lastStyleRecognition: null,
  lastStyleFeatureGraph: null,
  lastBenchmark: null,
  lastDecisionReport: null,
  lastReferenceTransfer: null,
  // EPIC 2E-F Phase C-A: Controlled Preview Review Console state — a
  // pure UI reflection of already-computed, shadow-only analysis
  // results. Never influences production output.
  lastPreviewSandbox: null,
  lastPreviewReviewState: null,
  lastProcessingLog: null,
  curveEditor: null,
};

// EPIC 2E-F Phase C-B: must be declared BEFORE waitForRoot(...) below —
// waitForRoot's callback (which calls ensureReviewConsoleController(),
// defined later in this file as a hoisted function declaration) can
// run SYNCHRONOUSLY if the DOM root already exists on the very first
// check, i.e. before this file has finished executing top-to-bottom
// past this point. A `let`/`const` declared further down the file is
// in the temporal dead zone until its own statement runs, so it must
// live here, ahead of the immediately-invoked waitForRoot call.
let reviewConsoleController = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
// The DC/React runtime streams and mounts the template asynchronously, so the
// real DOM (#lumixaApp and its children) does not necessarily exist yet by the
// time the browser fires DOMContentLoaded for this thin host document. Poll
// until the root is actually present before wiring anything up.
function waitForRoot(cb) {
  const root = document.getElementById('lumixaApp');
  if (root && document.getElementById('darkBtn')) { cb(); return; }
  requestAnimationFrame(() => waitForRoot(cb));
}
waitForRoot(() => {
  applyDarkMode();
  updateStatusPills();
  setupFileHandlers();
  setupHeaderActions();
  setupNavigation();
  setupRedeemCode();

  const hslCard  = document.getElementById('hslCard');
  const gradCard = document.getElementById('gradCard');
  const calCard  = document.getElementById('calCard');
  if (hslCard)  renderHSLPanel(hslCard);
  if (gradCard) renderGradingPanel(gradCard);
  if (calCard)  renderCalibrationPanel(calCard);

  bindSliders(document.body);
  window.switchTab = switchTab;
  setupAnalysisTabs();
  setupAnalysisResizeObserver();
  ensureReviewConsoleController();

  // Tone Curve Editor — init after DOM ready
  const curveCanvas = document.getElementById('toneCurveCanvas');
  if (curveCanvas) {
    state.curveEditor = new ToneCurveEditor(curveCanvas, {
      dark:      state.darkMode,
      onChange:  (cs) => { state.lastCurveSet = cs; },
    });
    // Wire channel buttons
    document.querySelectorAll('[data-curve-ch]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-curve-ch]').forEach(b => styleCurveBtn(b, false));
        styleCurveBtn(btn, true);
        state.curveEditor.setChannel(btn.dataset.curveCh);
      });
    });
    document.getElementById('btnCurveReset')?.addEventListener('click', () => {
      state.curveEditor.resetChannel();
    });
    document.getElementById('btnCurveResetAll')?.addEventListener('click', () => {
      state.curveEditor.resetAll();
    });
  }
});

// ─── Visual-state helpers (inline-style based) ─────────────────────────────────
function styleCurveBtn(btn, active) {
  const ch = btn.dataset.curveCh;
  const colors = { master: 'var(--accent)', red: '#b5544a', green: '#7c9468', blue: '#5f7fa3' };
  if (active) {
    btn.style.background = colors[ch]; btn.style.color = '#fff8ec'; btn.style.borderColor = colors[ch];
  } else {
    btn.style.background = 'var(--surface-2)'; btn.style.color = 'var(--text-dim)'; btn.style.borderColor = 'var(--border)';
  }
}
function styleAtab(btn, active) {
  btn.style.background = active ? 'var(--accent)' : 'transparent';
  btn.style.color = active ? 'var(--on-accent)' : 'var(--text-dim)';
}
function styleNavItem(btn, active) {
  btn.style.background = active ? 'var(--accent-soft)' : 'transparent';
  btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  btn.style.fontWeight = active ? '700' : '500';
}
window.openModal  = (id) => { const m = document.getElementById(id); if (m) m.style.display = 'flex'; };
window.closeModal = (id) => { const m = document.getElementById(id); if (m) m.style.display = 'none'; };

// ─── Dark mode ────────────────────────────────────────────────────────────────
function applyDarkMode() {
  applyThemeVars(state.darkMode);
  document.documentElement.classList.toggle('light', !state.darkMode);
  const btn = document.getElementById('darkBtn');
  if (btn) {
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = state.darkMode ? 'light_mode' : 'dark_mode';
  }
}
function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  localStorage.setItem('dm', state.darkMode ? '1' : '0');
  applyDarkMode();
  // Re-render canvases with new theme
  if (state.curveEditor) {
    state.curveEditor.setDark(state.darkMode);
  }
  if (state.lastStats) {
    const hc = document.getElementById('histCanvas');
    if (hc) renderHistograms(hc, state.lastStats, { dark: state.darkMode });
  }
  if (state.lastPalette) {
    const pc = document.getElementById('paletteCanvas');
    if (pc) renderPalette(pc, state.lastPalette, { dark: state.darkMode });
  }
  if (state.lastHarmony) {
    const hc = document.getElementById('harmonyCanvas');
    if (hc) renderColorHarmony(hc, state.lastHarmony, { dark: state.darkMode });
  }
  if (state.lastImageAnalysis) {
    const iac = document.getElementById('imageAnalysisCanvas');
    if (iac) renderImageAnalysis(iac, state.lastImageAnalysis, { dark: state.darkMode });
  }
  if (state.lastCalibration) {
    const cc = document.getElementById('calibrationCanvas');
    if (cc) renderCalibration(cc, state.lastCalibration, { dark: state.darkMode });
  }
  if (state.lastToneCurves) {
    const tc = document.getElementById('toneCurveAICanvas');
    if (tc) renderToneCurves(tc, state.lastToneCurves, state.lastStats, { dark: state.darkMode });
  }
  if (state.lastGrading) {
    const cc = document.getElementById('colorGradingCanvas');
    if (cc) renderColorGrading(cc, state.lastGrading, { dark: state.darkMode });
  }
  if (state.lastHSL) {
    const hc = document.getElementById('hslAnalyzerCanvas');
    if (hc) renderHSLAnalyzer(hc, state.lastHSL, { dark: state.darkMode });
  }
  if (state.lastBasic) {
    const bc = document.getElementById('basicCanvas');
    if (bc) renderBasicPanel(bc, state.lastBasic, { dark: state.darkMode });
  }
  if (state.lastSkin) {
    const sc = document.getElementById('skinCanvas');
    if (sc) renderSkinTone(sc, state.lastSkin, { dark: state.darkMode });
  }
  if (state.lastWB) {
    const wc = document.getElementById('wbCanvas');
    if (wc) renderWhiteBalance(wc, state.lastWB, { dark: state.darkMode });
  }
}

// ─── Status pills ─────────────────────────────────────────────────────────────
function updateStatusPills() {
  const planEl  = document.getElementById('planText');
  const usageEl = document.getElementById('usageText');
  if (planEl)  planEl.textContent  = 'UNLIMITED';
  if (usageEl) usageEl.textContent = '∞';
}

// ─── Language ─────────────────────────────────────────────────────────────────
function openLangModal()  { const m = document.getElementById('langModal');  if (m) m.style.display = 'flex'; }
function closeLangModal() { const m = document.getElementById('langModal');  if (m) m.style.display = 'none'; }
function setLang(lang) {
  state.lang = lang; localStorage.setItem('lang', lang);
  document.querySelectorAll('.lang-opt').forEach(o => {
    const active = o.dataset.lang === lang;
    o.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    o.style.background  = active ? 'var(--accent-soft)' : 'transparent';
  });
}
window.setLang   = setLang;
window.closeLang = closeLangModal;

// ─── Navigation ───────────────────────────────────────────────────────────────
function redrawGroup(groupName) {
  const groupEl = document.querySelector(`.agroup[data-group="${groupName}"]`);
  const draw = {
    overview: () => {
      if (state.lastImageAnalysis) { const c=document.getElementById('imageAnalysisCanvas'); if(c) renderImageAnalysis(c, state.lastImageAnalysis, {dark:state.darkMode}); }
      if (state.lastStats)         { const c=document.getElementById('histCanvas');          if(c) renderHistograms(c, state.lastStats, {dark:state.darkMode}); }
      if (state.lastPalette)       { const c=document.getElementById('paletteCanvas');       if(c) renderPalette(c, state.lastPalette, {dark:state.darkMode}); }
    },
    tone: () => {
      if (state.lastBasic)      { const c=document.getElementById('basicCanvas');       if(c) renderBasicPanel(c, state.lastBasic, {dark:state.darkMode}); }
      if (state.lastToneCurves) { const c=document.getElementById('toneCurveAICanvas'); if(c) renderToneCurves(c, state.lastToneCurves, state.lastStats, {dark:state.darkMode}); }
      if (state.lastWB)         { const c=document.getElementById('wbCanvas');          if(c) renderWhiteBalance(c, state.lastWB, {dark:state.darkMode}); }
    },
    colour: () => {
      if (state.lastHSL)         { const c=document.getElementById('hslAnalyzerCanvas'); if(c) renderHSLAnalyzer(c, state.lastHSL, {dark:state.darkMode}); }
      if (state.lastGrading)     { const c=document.getElementById('colorGradingCanvas');if(c) renderColorGrading(c, state.lastGrading, {dark:state.darkMode}); }
      if (state.lastCalibration) { const c=document.getElementById('calibrationCanvas'); if(c) renderCalibration(c, state.lastCalibration, {dark:state.darkMode}); }
      if (state.lastHarmony)     { const c=document.getElementById('harmonyCanvas');     if(c) renderColorHarmony(c, state.lastHarmony, {dark:state.darkMode}); }
    },
    detail: () => {
      if (state.lastSkin) { const c=document.getElementById('skinCanvas'); if(c) renderSkinTone(c, state.lastSkin, {dark:state.darkMode}); }
    },
  };
  // Same shared readiness flow as first-import: waits for the now-visible
  // group's layout to settle (not just one requestAnimationFrame) before
  // drawing — RE-ANALYZE CONSISTENCY requires the same sizing logic on
  // every render path. `groupEl` is only used to wait for LAYOUT
  // readiness here (image/fonts/frames/non-zero-size) — its width is
  // NOT passed down to renderImageAnalysis/renderPalette, since each
  // section has its own padding different from the .agroup's. Each
  // renderer resolves its OWN canvas's content width via
  // resolveCanvasCssWidth once its section is visible and settled.
  waitForAnalysisRenderReady({ containers: [groupEl] }).then(() => {
    (draw[groupName] || (() => {}))();
  });
}

function setupAnalysisTabs() {
  const tabs = document.querySelectorAll('.atab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.dataset.group;
      tabs.forEach(t => styleAtab(t, t === tab));
      document.querySelectorAll('.agroup').forEach(g => {
        g.style.display = (g.dataset.group === group) ? 'flex' : 'none';
      });
      state.activeAnalysisGroup = group;
      redrawGroup(group);   // re-render now-visible canvases (fixes offsetWidth 0)
    });
  });
}

// ─── Analysis canvas resize handling ───────────────────────────────────────────
// Redraws the currently-visible analysis group's canvases from CACHED
// state.last* results when its container is resized (browser resize,
// mobile rotation, sidebar collapse, etc.) — never re-runs K-Means or any
// other analysis computation, only re-renders the existing data at the
// new measured size.
function setupAnalysisResizeObserver() {
  const activeGroupEl = () => document.querySelector(`.agroup[data-group="${state.activeAnalysisGroup}"]`) || document.querySelector('.agroup[data-group="overview"]');

  const scheduleRedraw = (() => {
    let rafPending = false;
    return () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const el = activeGroupEl();
        const group = el?.dataset?.group;
        if (group) redrawGroup(group);
      });
    };
  })();

  if (typeof ResizeObserver === 'undefined') {
    // Safe fallback for browsers without ResizeObserver support.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scheduleRedraw, 150);
    });
    return;
  }

  const lastWidths = new WeakMap();
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = entry.target;
      const newWidth = entry.contentRect.width;
      const previousWidth = lastWidths.get(target) ?? 0;
      // Skip when width hasn't meaningfully changed — prevents redraw
      // (and any possible ResizeObserver) loops from a sub-pixel/no-op
      // trigger. Tracked PER ELEMENT so one hidden group reporting 0
      // width can never clobber another group's last-known width.
      if (Math.abs(newWidth - previousWidth) < 1) continue;
      lastWidths.set(target, newWidth);
      // Only the currently active/visible group with a genuinely
      // positive width should ever trigger a redraw — a hidden .agroup
      // (display:none) reports contentRect.width === 0 and must never
      // schedule a redraw of the group that's actually on screen.
      const isActiveGroup = target.dataset?.group === state.activeAnalysisGroup;
      if (isActiveGroup && newWidth > 0) scheduleRedraw();
    }
  });
  document.querySelectorAll('.agroup').forEach(el => ro.observe(el));
}

function setupNavigation() {
  window.scrollToSection = (id, btn) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    document.querySelectorAll('.nav-item').forEach(b => styleNavItem(b, false));
    if (btn) styleNavItem(btn, true);
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────
function setupHeaderActions() {
  document.getElementById('darkBtn')?.addEventListener('click', toggleDarkMode);
  document.getElementById('langBtn')?.addEventListener('click', openLangModal);
  document.getElementById('langModal')?.addEventListener('click', e => {
    if (e.target.id === 'langModal') closeLangModal();
  });
}

// ─── File handling ────────────────────────────────────────────────────────────
function setupFileHandlers() {
  document.getElementById('fileIn')?.addEventListener('change',  e => loadFile(e.target.files[0]));
  document.getElementById('fileIn2')?.addEventListener('change', e => loadFile(e.target.files[0]));

  const zone = document.getElementById('dropZone');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; zone.style.background = 'var(--accent-soft)'; });
    zone.addEventListener('dragleave', ()  => { zone.style.borderColor = 'var(--border)'; zone.style.background = 'var(--surface-1)'; });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.style.borderColor = 'var(--border)'; zone.style.background = 'var(--surface-1)';
      loadFile(e.dataTransfer.files[0]);
    });
  }

  document.getElementById('btnDownload')?.addEventListener('click',  handleDownload);
  document.getElementById('btnReanalyze')?.addEventListener('click', handleReanalyze);
  document.getElementById('btnReset')?.addEventListener('click',     handleReset);
}

function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;

  // Fix (requested): clear all previous analysis state BEFORE starting a
  // new one, every time a file is selected — not just on the very first
  // upload. Without this, selecting a second/third image while the
  // previous image's state.last* values (WB, HSL, basic panel, style
  // fingerprint, etc.) are still populated can let stale results flash
  // or mix with the new analysis while each pipeline stage resolves
  // asynchronously, causing visible display glitches. handleReset()
  // already clears every state.last* field and hides all analysis
  // panels — safe to call unconditionally here since the code below
  // immediately re-shows the correct "loading" UI afterward.
  handleReset();

  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('previewImg');
    if (!img) return;

    // Show loading state immediately
    document.getElementById('uploadWrap').style.display  = 'none';
    document.getElementById('previewWrap').style.display = 'block';
    document.getElementById('sliders').style.display     = 'none';
    setAnalysisBox('loading', 'กำลังโหลดรูปภาพ…');

    // Wait for image to fully decode before reading pixels
    img.onload = () => {
      state.imageLoaded = true;
      runAnalysis();
    };
    img.onerror = () => setAnalysisBox('error', 'ไม่สามารถโหลดรูปภาพได้');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Analysis canvas render readiness ──────────────────────────────────────────
// Root cause of the "first import renders wrong, Re-analyze fixes it" bug:
// the first-import path used to commit a canvas render after only ONE
// requestAnimationFrame following a display:none→block change, without
// waiting for (a) the image to fully decode, (b) web fonts used by the
// canvas text (Inter, JetBrains Mono — canvases never auto-redraw when a
// font finishes loading later), or (c) the container's layout to
// genuinely settle. Re-analyze happened to look correct only because by
// that point the container had already been visible for a while and
// fonts had long since loaded — it was never actually a different/more
// correct code path, just a lucky later timing. This helper is shared by
// every render call (first import, Re-analyze, tab switch, resize) so
// there is exactly one readiness contract instead of two silently
// different ones.
let analysisRenderGeneration = 0;

async function waitForAnalysisRenderReady({ image = null, containers = [], maxFrames = 6 } = {}) {
  // 1. Wait for the image to fully decode. img.onload (used to trigger
  // runAnalysis) already guarantees naturalWidth/naturalHeight are
  // available, but decode() additionally guarantees the browser has
  // finished the (potentially async) image decode work — falls back
  // safely if unsupported or if it rejects on an already-loaded image.
  if (image && typeof image.decode === 'function') {
    try { await image.decode(); } catch { /* onload already fired — safe to continue with the fallback (already-loaded) state */ }
  }
  // 2. Wait for web fonts used by canvas text. Canvas text is drawn as
  // pixels once, at draw time — unlike DOM text it never reflows when a
  // font finishes loading afterward, so drawing before fonts are ready
  // can bake in fallback-font metrics permanently until the next redraw.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* Font Loading API unsupported/failed — proceed with whatever font is currently available rather than blocking forever */ }
  }
  // 3/4. Wait for the browser to complete layout after any display
  // change. Two animation frames, not one: the first frame is when the
  // browser commits a display:none→block layout change; the second
  // guarantees layout/paint has fully settled before we measure.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // 5. Measure the actual containers. Bounded retry (never an infinite
  // loop) if a container still reports zero width/height — e.g. an
  // ancestor element is still settling its own layout.
  const measure = () => containers.map(c => (c ? c.getBoundingClientRect() : null));
  let rects = measure();
  let attempt = 0;
  while (rects.some(rect => !rect || rect.width <= 0) && attempt < maxFrames) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    rects = measure();
    attempt++;
  }
  return rects;
}

// ─── Analysis pipeline ────────────────────────────────────────────────────────
// EPIC 2E-F Phase C-A, upgraded Phase C-B: renders the Controlled
// Preview Review Console from the current
// state.lastPreviewSandbox/lastPreviewReviewState. As of Phase C-B this
// includes interactive Pass/Fail/Needs-Adjustment/Pending controls and
// an editable reviewer note, but THIS function still never calls
// runAnalysis(), never re-runs any analysis stage, and never touches
// XMP/production output directly — it only re-renders DOM from
// whatever state.lastPreviewReviewState currently holds. All actual
// state MUTATION happens inside review-console-controller.js, via the
// Review State Engine's own update/reset functions, never here.
// (`reviewConsoleController` itself is declared earlier, just before
// waitForRoot(...) — see the comment there for why.)

function renderReviewConsoleFromState() {
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (!reviewInner) return;
  const uiState = reviewConsoleController ? reviewConsoleController.getUiState() : null;
  renderReviewConsole(reviewInner, state.lastPreviewSandbox, state.lastPreviewReviewState, uiState);
}

// EPIC 2E-F Phase C-B: attaches the interactive controller EXACTLY
// ONCE per page session — not once per analysis/render. This is safe
// (and is the recommended "one-time listener registration" pattern)
// because `reviewConsoleInner` is a persistent DOM element that is
// never itself replaced; every render only replaces ITS CHILDREN via
// replaceChildren(), so a single delegated listener set attached to
// `reviewConsoleInner` continues to correctly catch clicks/input on
// freshly-rendered children across every Re-analyze and new-image
// import, with zero risk of accumulating duplicate listeners.
function ensureReviewConsoleController() {
  if (reviewConsoleController) return;
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (!reviewInner) return;
  reviewConsoleController = createReviewConsoleController({
    container: reviewInner,
    // getState/setState close over `state.lastPreviewReviewState`
    // itself (re-read on every call, never captured once) — this is
    // the ONE editable Review State object for the currently active
    // analysis result, exactly as the phase spec's "State Ownership"
    // section describes. The controller never mutates the object this
    // getter returns; every call to updatePreviewReviewItemV2/
    // resetPreviewReviewStateV2 inside the controller produces a NEW
    // object, which setState below then stores.
    getState: () => state.lastPreviewReviewState,
    setState: (next) => { state.lastPreviewReviewState = next; },
    rerender: renderReviewConsoleFromState,
    announce: (message) => {
      const liveRegion = document.getElementById('reviewConsoleLiveRegion');
      if (liveRegion) liveRegion.textContent = message;
    },
  });
}

async function runAnalysis() {
  const img = document.getElementById('previewImg');
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    setAnalysisBox('error', 'รูปภาพยังโหลดไม่เสร็จ');
    return;
  }

  // New generation for this analysis run — any in-flight render callback
  // from a PREVIOUS import that resolves after this point will see its
  // captured generation number no longer match and skip committing its
  // (now stale) render. Fixes "rapid import of two different images"
  // showing a mix of the old and new image's analysis.
  const renderGeneration = ++analysisRenderGeneration;

  setAnalysisBox('loading', 'กำลังวิเคราะห์ histogram…');

  try {
    setAnalysisBox('loading', 'กำลังวิเคราะห์ histogram…');

    processingLog.reset({
      width:    img.naturalWidth,
      height:   img.naturalHeight,
      fileName: img.src ? img.src.split('/').pop().split('?')[0].slice(0,80) : '(unknown)',
    });
    const logS1 = processingLog.startStage('HistogramEngine');

    const stats = await analyzeImage(img);
    state.lastStats = stats;

    logS1.output({
      avgLum: stats.avgLum, median: stats.median,
      blackPoint: stats.blackPoint, whitePoint: stats.whitePoint,
      drStops: stats.drStops, avgSatPct: stats.avgSatPct,
      avgR: stats.avgR, avgG: stats.avgG, avgB: stats.avgB,
      rbDiff: +stats.rbDiff.toFixed(2), gDiff: +stats.gDiff.toFixed(2),
      categoryRaw: stats.category, skinPctRaw: stats.skinPct,
    });
    logS1.end('ok');

    const imageAnalysisCorePromise = analyzeImageCore(img).then(coreResult => {
      state.lastImageAnalysis = coreResult;
      const iaSec = document.getElementById('imageAnalysisSection');
      const iac = document.getElementById('imageAnalysisCanvas');
      if (iaSec && iac) {
        iaSec.style.display = 'block';
        // UI FIX-F: measure the CANVAS itself, not the section — the
        // section's rect is a border-box width that includes its 20px
        // padding on each side, which would overshoot the canvas's
        // actual (width:100%) content box by 40px.
        waitForAnalysisRenderReady({ image: img, containers: [iac] }).then(([rect]) => {
          if (renderGeneration !== analysisRenderGeneration) return; // a newer import superseded this one
          if (!rect || rect.width <= 0) return; // FIX 6: skip safely — never commit a distorted render; ResizeObserver/tab visibility can trigger a later redraw
          renderImageAnalysis(iac, coreResult, { dark: state.darkMode, cssWidth: rect.width });
        });
      }
      return coreResult;
    }).catch(err => { console.warn('ImageAnalysisCore:', err); return null; });

    const paletteHarmonyPromise = extractPalette(img).then(palette => {
      state.lastPalette = palette;
      const palSec = document.getElementById('paletteSection');
      const pc = document.getElementById('paletteCanvas');
      if (palSec && pc) {
        palSec.style.display = 'block';
        // UI FIX-F: measure the canvas itself, same rationale as above.
        waitForAnalysisRenderReady({ image: img, containers: [pc] }).then(([rect]) => {
          if (renderGeneration !== analysisRenderGeneration) return; // a newer import superseded this one
          if (!rect || rect.width <= 0) return; // FIX 6: skip safely
          renderPalette(pc, palette, { dark: state.darkMode, cssWidth: rect.width });
        });
      }
      let harmony = null;
      try {
        harmony = generateHarmonies(palette);
        state.lastHarmony = harmony;
        const harSec = document.getElementById('harmonySection');
        const hc = document.getElementById('harmonyCanvas');
        if (harSec && hc) {
          harSec.style.display = 'block';
          waitForAnalysisRenderReady({ image: img, containers: [hc] }).then(() => {
            if (renderGeneration !== analysisRenderGeneration) return;
            renderColorHarmony(hc, harmony, { dark: state.darkMode });
          });
        }
      } catch (err) { console.warn('ColorHarmony:', err); }
      return { palette, harmony };
    }).catch(err => { console.warn('Palette:', err); return { palette: null, harmony: null }; });

    setAnalysisBox('loading', 'AI กำลังวิเคราะห์ผิวและสี…');
    const logS3a = processingLog.startStage('SkinClassifier+CastDetector');

    const [skinClassRes, castRes] = (await Promise.allSettled([
      classifySkin(img),
      detectColorCast(img),
    ])).map(r => r.status === 'fulfilled' ? r.value : null);

    const skinPctAccurate = skinClassRes?.coveragePct ?? stats?.skinPct ?? 0;

    logS3a.output({
      skinPct: skinClassRes?.skinPct, skinPctEffective: skinPctAccurate,
      skinConfidence: skinClassRes?.confidence,
      isFaceCandidate: skinClassRes?.isFaceCandidate,
      clusterRatio: skinClassRes?.clusterRatio,
      castGlobal: castRes?.global?.label,
      castBgGreen: castRes?.bgGreenDominant,
      castSubjectNeutral: castRes?.subjectNeutral,
      castCenter: castRes?.center?.label,
      castBorder: castRes?.border?.label,
    });
    if (!skinClassRes) logS3a.warn('SkinClassifier failed — falling back to stats.skinPct');
    if (!castRes)      logS3a.warn('CastDetector failed — BG attenuation skipped');
    logS3a.end('ok');

    const logS3b = processingLog.startStage('SceneClassifier');
    const sceneRes = classifyScene(stats, skinClassRes);
    logS3b.output({
      category: sceneRes.category, confidence: sceneRes.confidence,
      categoryRaw: sceneRes.categoryRaw,
    });
    logS3b.decide('category', sceneRes.category,
      `score=${JSON.stringify(Object.fromEntries(Object.entries(sceneRes.scores ?? {}).map(([k,v])=>[k,+v.toFixed(2)])))} conf=${sceneRes.confidence}`);
    if (sceneRes.category !== sceneRes.categoryRaw)
      logS3b.warn(`Scene overrode histogram category: ${sceneRes.categoryRaw} → ${sceneRes.category}`);
    logS3b.end('ok');

    setAnalysisBox('loading', 'AI กำลังวิเคราะห์สีและแสง…');
    const logS3c = processingLog.startStage('ColorEngines',
      { category: sceneRes.category, skinPct: skinPctAccurate });

    const [skinToneRes, wbRes, hslRes, gradingRes, tcRes, calRes, styleRecRes] =
      (await Promise.allSettled([
        analyzeSkinTone(img),
        analyzeWhiteBalance(img, { category: sceneRes.category, skinPct: skinPctAccurate, cast: castRes }),
        analyzeHSL(img, { category: sceneRes.category }),
        analyzeColorGrading(img, { category: sceneRes.category }),
        generateToneCurves(img, stats),
        analyzeCalibration(img, { category: sceneRes.category, skinPct: skinPctAccurate }),
        recognizeStyle(img),
      ])).map(r => r.status === 'fulfilled' ? r.value : null);

    const skinMerged = skinToneRes
      ? { ...skinToneRes, coveragePct: skinPctAccurate, isFaceCandidate: skinClassRes?.isFaceCandidate ?? true, confidence: skinClassRes?.confidence ?? 0.5 }
      : skinClassRes;
    const skin       = state.lastSkin         = skinMerged;
    const wb         = state.lastWB           = wbRes;
    const cast       = castRes;
    const hsl        = state.lastHSL          = hslRes;
    const grading    = state.lastGrading      = gradingRes;
    const toneCurves = state.lastToneCurves   = tcRes;
    const calibration= state.lastCalibration  = calRes;
    const basic      = state.lastBasic        = generateBasicPanel(stats);
    const styleRecognition = state.lastStyleRecognition = styleRecRes;

    logS3c.output({
      wb_temp: wb?.consensus?.temperature, wb_tint: wb?.consensus?.tint,
      wb_confidence: wb?.confidence, wb_neutralPx: wb?.neutralPixelCount,
      wb_cast: wb?.cast, wb_moodPreservation: wb?.moodPreservation?.preservationFactor,
      skin_coveragePct: skin?.coveragePct, skin_isFace: skin?.isFaceCandidate,
      hsl_dominant: hsl?.dominant, hsl_guardrails: hsl?.guardrailsApplied,
      cal_category: calibration?.category,
      basic_exp: basic?.exposure?.value, basic_hi: basic?.highlights?.value,
      basic_toneStyle: basic?.toneStyle?.tag,
      grading_look: grading?.look,
      tc_category: toneCurves?.category,
      style_top: styleRecognition?.top?.style,
    });
    if (!wbRes)      logS3c.warn('WhiteBalance engine failed');
    if (!hslRes)     logS3c.warn('HSL engine failed');
    if (!calRes)     logS3c.warn('Calibration engine failed');
    if (!gradingRes) logS3c.warn('ColorGrading engine failed');
    if (!tcRes)      logS3c.warn('ToneCurve engine failed');
    if (!styleRecRes) logS3c.warn('StyleRecognition engine failed');
    logS3c.end('ok');

    const logPh = processingLog.startStage('PaletteHarmonyAwait');
    await Promise.allSettled([paletteHarmonyPromise]);
    logPh.output({ paletteResolved: !!state.lastPalette, harmonyResolved: !!state.lastHarmony });
    if (!state.lastPalette) logPh.warn('Palette did not resolve — Feature Fusion proceeds with graceful fallback (palette-derived intents will be null)');
    if (!state.lastHarmony) logPh.warn('Harmony did not resolve — Feature Fusion proceeds with graceful fallback');
    logPh.end('ok');

    const fusionCtx = {
      stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
      palette: state.lastPalette, harmony: state.lastHarmony, styleRecognition,
      scene: sceneRes, cast: castRes,
    };
    const logFusion = processingLog.startStage('FeatureFusionEngine');
    const styleFeatureGraph = buildStyleFeatureGraph(fusionCtx);
    state.lastStyleFeatureGraph = styleFeatureGraph;
    logFusion.output({
      featureCount: styleFeatureGraph.features.length,
      conflictCount: styleFeatureGraph.conflicts.length,
      overallStyleConfidence: styleFeatureGraph.overallStyleConfidence,
      moodTag: styleFeatureGraph.mood.tag,
    });
    styleFeatureGraph.conflicts.forEach(c => logFusion.decide(c.type, null, c.description));
    if (styleFeatureGraph.conflicts.length) logFusion.warn(`${styleFeatureGraph.conflicts.length} engine conflict(s) detected and resolved: ${styleFeatureGraph.conflicts.map(c=>c.type).join(', ')}`);
    logFusion.end('ok');

    const logFp = processingLog.startStage('StyleFingerprint');
    const styleFingerprint = buildStyleFingerprint({ ...fusionCtx, featureGraph: styleFeatureGraph });
    state.lastStyleFingerprint = styleFingerprint;
    logFp.output({
      mood: styleFingerprint.mood, warmth: styleFingerprint.warmth,
      colorCast: styleFingerprint.colorCast, contrastLevel: styleFingerprint.contrastLevel,
      overallConfidence: styleFingerprint.overallConfidence,
      styleRecognitionTop: styleFingerprint.styleRecognitionTop,
    });
    logFp.end('ok');

    const logS4 = processingLog.startStage('DecisionEngine', {
      mode: 'single-image-auto', portraitSafe: !!(sceneRes.category === 'Portrait' || skinPctAccurate > 8),
    });
    const rawPreset = buildFinalPreset({
      stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
      scene: sceneRes, cast: castRes, styleRecognition,
      palette: state.lastPalette, harmony: state.lastHarmony,
      fingerprint: styleFingerprint,
      // EPIC 2E-F Phase C-B: hand the CURRENT editable Review State
      // back into the pipeline (EPIC 2E-F-B-F input plumbing) so
      // in-progress human review survives Re-analyze. On a genuine new
      // image import this is always null here, because handleReset()
      // (called unconditionally at the start of loadFile(), before
      // runAnalysis() ever runs) already cleared
      // state.lastPreviewReviewState — so a different image can never
      // inherit approval from the previous one. On Re-analyze of the
      // SAME image, handleReset() is NOT called, so this carries the
      // user's current review progress in; the Review State Engine
      // then normalizes it against the freshly-computed Preview
      // Sandbox, safely downgrading any now-stale approval.
      controlledPreviewReviewStateV2: state.lastPreviewReviewState,
    });

    const { preset: validatedPreset, report: validationReport } = validateFinalPreset(rawPreset, styleFingerprint);
    validatedPreset._decision   = rawPreset._decision;
    validatedPreset._validation = validationReport;
    state.lastValidationReport = validationReport;

    const logBench = processingLog.startStage('StyleBenchmark');
    const benchmark = benchmarkStylePreservation({
      styleFingerprint: styleFingerprint,
      styleFeatureGraph: styleFeatureGraph,
      decisionStrategy: validatedPreset._decision,
      finalPreset: validatedPreset,
      preXmpValidation: validationReport,
    });
    state.lastBenchmark = benchmark;
    logBench.output({
      overallStyleSimilarity: benchmark.overallStyleSimilarity,
      safetyScore: benchmark.safetyScore,
      moodSimilarity: benchmark.moodSimilarity,
      warningCount: benchmark.warnings.length,
    });
    benchmark.warnings.forEach(w => logBench.warn(w));

    let finalPreset = validatedPreset;
    if (benchmark.details.extremelyUnsafe) {
      const reclamp = quickSafetyClamp(validatedPreset);
      finalPreset = { ...reclamp.preset, _decision: validatedPreset._decision, _validation: validationReport, _benchmark: benchmark };
      logBench.decide('reclamp', null, `safetyScore ${benchmark.safetyScore} < threshold — quickSafetyClamp re-applied (${reclamp.adjustments.length} adjustment(s)).`);
      reclamp.adjustments.forEach(a => logBench.decide('reclamp_detail', null, a));
    } else {
      finalPreset._benchmark = benchmark;
    }
    logBench.end('ok');

    applyPresetToSliders(finalPreset);

    const logVal = processingLog.startStage('PreXMPValidation', {
      mood: styleFingerprint.mood, colorCast: styleFingerprint.colorCast,
      overallConfidence: styleFingerprint.overallConfidence,
    });
    logVal.output({
      fingerprintMatchScore: validationReport.fingerprintMatchScore,
      violationCount: validationReport.violations.length,
      adjustmentCount: validationReport.adjustments.length,
    });
    validationReport.adjustments.forEach(a => logVal.decide('clamp', null, a));
    if (validationReport.violations.length) logVal.warn(`${validationReport.violations.length} style-fingerprint violation(s) corrected: ${validationReport.violations.join(', ')}`);
    logVal.end('ok');

    const d = finalPreset._decision ?? {};
    logS4.output({
      temp: finalPreset.temp, tint: finalPreset.tint,
      exp: finalPreset.exp, con: finalPreset.con,
      hi: finalPreset.hi, sh: finalPreset.sh,
      vib: finalPreset.vib, sat: finalPreset.sat,
      portraitSafe: d.portraitSafe, category: d.category,
      wbTempRaw: d.wb?.tempRaw, wbTintRaw: d.wb?.tintRaw,
      wbTempFinal: d.wb?.tempFinal, wbTintFinal: d.wb?.tintFinal,
      wbConf: d.wb?.confidence,
      castBgGreen: d.castBgGreen, castSubjectNeutral: d.castSubjectNeutral,
      clampsApplied: (d.clampsApplied ?? []).join(' | ') || 'none',
      fingerprintMatchScore: validationReport.fingerprintMatchScore,
      validationViolations: validationReport.violations.join(', ') || 'none',
    });
    (d.wb?.sources ?? []).forEach(s =>
      logS4.decide(`wb.${s.name}`, `temp=${s.temp} tint=${s.tint}`, `source weight in blend`));
    (d.clampsApplied ?? []).forEach(c => logS4.decide('clamp', null, c));
    logS4.end('ok');

    const logReport = processingLog.startStage('DecisionReport');
    const decisionReport = buildDecisionReport({
      styleFeatureGraph: styleFeatureGraph,
      styleFingerprint: styleFingerprint,
      decisionStrategy: finalPreset._decision,
      finalPreset: finalPreset,
      preXmpValidation: validationReport,
      styleBenchmark: finalPreset._benchmark,
    });
    finalPreset._report = decisionReport;
    state.lastDecisionReport = decisionReport;
    logReport.output({
      summary: decisionReport.summary,
      topContributorCount: decisionReport.topContributors.length,
      reducedInfluenceCount: decisionReport.reducedInfluence.length,
      warningCount: decisionReport.warnings.length,
    });
    logReport.end('ok');
    console.debug('[DecisionReport]', decisionReport);

    const logTransfer = processingLog.startStage('ReferenceTransfer');
    await Promise.allSettled([imageAnalysisCorePromise]);
    if (!state.lastImageAnalysis) logTransfer.warn('imageAnalysisCore unresolved — texture/smoothness complexity signals skipped this run.');
    const referenceTransferReport = buildReferenceTransferReport({
      stats, styleFeatureGraph: styleFeatureGraph, styleFingerprint: styleFingerprint,
      decisionStrategy: finalPreset._decision, finalPreset: finalPreset,
      preXmpValidation: validationReport, styleBenchmark: finalPreset._benchmark,
      wb, cast: castRes, imageAnalysisCore: state.lastImageAnalysis,
    });
    finalPreset._transfer = referenceTransferReport;
    state.lastReferenceTransfer = referenceTransferReport;
    logTransfer.output({
      referenceConfidence: referenceTransferReport.referenceConfidence.score,
      transferConfidence: referenceTransferReport.transferConfidence.score,
      complexityLevel: referenceTransferReport.complexity.level,
      wbTransferRisk: referenceTransferReport.wbTransferRisk.transferRisk,
      expectedLightroomSimilarity: referenceTransferReport.lightroomReproduction.expectedSimilarity,
    });
    referenceTransferReport.transferConfidence.risks.forEach(r => logTransfer.warn(r));
    logTransfer.end('ok');
    console.debug('[ReferenceTransfer]', referenceTransferReport);

    processingLog.setFinalPreset(finalPreset);
    state.lastProcessingLog = processingLog.snapshot();
    console.debug('[ProcessingLog]', state.lastProcessingLog);

    if (state.curveEditor) {
      state.curveEditor.setHistStats(stats);
      if (toneCurves) {
        state.curveEditor.loadPreset({
          master: toneCurves.master.points,
          red:    toneCurves.red.points,
          green:  toneCurves.green.points,
          blue:   toneCurves.blue.points,
        });
      } else {
        state.curveEditor.loadPreset(scenePreset(stats.category));
      }
    }

    const showSection = (id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    };
    showSection('basicSection');
    showSection('histSection');

    requestAnimationFrame(() => {
      const bc = document.getElementById('basicCanvas');
      if (bc) renderBasicPanel(bc, basic, { dark: state.darkMode });
      const hc = document.getElementById('histCanvas');
      if (hc) renderHistograms(hc, stats, { dark: state.darkMode });
    });

    if (wb)       { showSection('wbSection');          requestAnimationFrame(() => { const c=document.getElementById('wbCanvas');          if(c) renderWhiteBalance(c, wb, {dark:state.darkMode}); }); }
    if (skin)     { showSection('skinSection');        requestAnimationFrame(() => { const c=document.getElementById('skinCanvas');        if(c) renderSkinTone(c, skin, {dark:state.darkMode}); }); }
    if (hsl)      { showSection('hslAnalyzerSection'); requestAnimationFrame(() => { const c=document.getElementById('hslAnalyzerCanvas'); if(c) renderHSLAnalyzer(c, hsl, {dark:state.darkMode}); }); }
    if (grading)  { showSection('colorGradingSection');requestAnimationFrame(() => { const c=document.getElementById('colorGradingCanvas');if(c) renderColorGrading(c, grading, {dark:state.darkMode}); }); }
    if (toneCurves){ showSection('toneCurveAISection');requestAnimationFrame(() => { const c=document.getElementById('toneCurveAICanvas'); if(c) renderToneCurves(c, toneCurves, stats, {dark:state.darkMode}); }); }
    if (calibration){ showSection('calibrationSection');requestAnimationFrame(() => { const c=document.getElementById('calibrationCanvas'); if(c) renderCalibration(c, calibration, {dark:state.darkMode}); }); }

    const analysisContainer = document.getElementById('analysisInner');
    if (analysisContainer) renderAnalysisPanel(analysisContainer, buildAnalysisDisplay(stats, finalPreset));

    const dec = finalPreset._decision;
    const val = finalPreset._validation;
    const bench = finalPreset._benchmark;
    const wb_d = dec.wb;
    setAnalysisBox('ok',
      `<strong>✓ วิเคราะห์เสร็จแล้ว — ${dec.category ?? stats.category}${dec.portraitSafe ? ' · Portrait Safe ✓' : ''}</strong><br>
       <small>` +
      `WB Temp: ${wb_d.tempFinal} (raw ${wb_d.tempRaw}) · Tint: ${wb_d.tintFinal} (raw ${wb_d.tintRaw}) · ` +
      `Confidence: ${Math.round(wb_d.confidence * 100)}% · Neutral px: ${wb_d.neutralPixelCount} · ` +
      `Skin: ${dec.skinPct}% (${dec.skinSource}) · ` +
      `Style Fingerprint match: ${Math.round((val?.fingerprintMatchScore ?? 1) * 100)}%` +
      `${bench ? ` · Style Similarity: ${Math.round(bench.overallStyleSimilarity*100)}% (safety ${Math.round(bench.safetyScore*100)}%)` : ''}` +
      `${dec.clampsApplied.length ? '<br><span style="color:var(--warn)">Clamps: ' + dec.clampsApplied.join(' | ') + '</span>' : ''}` +
      `${val?.violations?.length ? '<br><span style="color:var(--warn)">Pre-XMP corrections: ' + val.violations.join(', ') + '</span>' : ''}` +
      `${bench?.warnings?.length ? '<br><span style="color:var(--warn)">Benchmark warnings: ' + bench.warnings.slice(0,2).join(' | ') + '</span>' : ''}` +
      `</small>`
    );
    document.getElementById('sliders').style.display = 'block';
    const groups = document.getElementById('analysisGroups');
    if (groups) groups.style.display = 'block';

    // EPIC 2E-F Phase C-A: Controlled Preview Review Console — pure
    // read-only display of the already-computed, shadow-only Preview
    // Sandbox + Review State. Does NOT re-run any analysis, does NOT
    // call decision-engine/lightroom-mapping-engine/preset-engine/
    // xmp-validator, and does NOT affect XMP export.
    state.lastPreviewSandbox = finalPreset._decision?.finalStyleIntent?.controlledOverlayPreviewSandboxV2 ?? null;
    state.lastPreviewReviewState = finalPreset._decision?.finalStyleIntent?.controlledPreviewReviewStateV2 ?? null;
    const reviewSec = document.getElementById('reviewConsoleSection');
    const reviewInner = document.getElementById('reviewConsoleInner');
    if (reviewSec && reviewInner && (state.lastPreviewSandbox || state.lastPreviewReviewState)) {
      reviewSec.style.display = 'block';
      renderReviewConsoleFromState();
    } else if (reviewSec) {
      reviewSec.style.display = 'none';
    }

  } catch (err) {
    setAnalysisBox('error', `<strong>⚠ ล้มเหลว:</strong> ${err.message}`);
    console.error('runAnalysis error:', err);
  }
}

function applyPresetToSliders(preset) {
  setSlider('exp', preset.exp); setSlider('con', preset.con);
  setSlider('hi',  preset.hi);  setSlider('sh',  preset.sh);
  setSlider('wh',  preset.wh);  setSlider('bl',  preset.bl);
  setSlider('temp', preset.temp); setSlider('tint', preset.tint);
  setSlider('vib',  preset.vib);  setSlider('sat',  preset.sat);
  setSlider('clarity', preset.clarity); setSlider('dehaze', preset.dehaze);
  setSlider('texture', preset.texture); setSlider('sharp',  preset.sharp);
  setSlider('noise', preset.noise);
  setSlider('crv_hi', preset.crv_hi); setSlider('crv_mid', preset.crv_mid); setSlider('crv_sh', preset.crv_sh);
  for (const [id, val] of Object.entries(preset.hsl))   setSlider(id, val);
  for (const [id, val] of Object.entries(preset.grade)) setSlider(id, val);
  for (const [id, val] of Object.entries(preset.cal))   setSlider(id, val);
  const nameEl = document.getElementById('presetName');
  if (nameEl) nameEl.value = preset.name;
}

function buildAnalysisDisplay(stats, preset) {
  return {
    'Scene Type':          stats.category,
    'Brightness':          `Avg ${stats.avgLum}  ·  Median ${stats.median}`,
    'Dynamic Range':       `${stats.drStops ?? stats.dynamicRange} EV  (${stats.dynamicRange} levels)`,
    'Contrast Ratio':      `1 : ${stats.contrastRatio ?? stats.contrast}`,
    'Highlight Clipping':  `${stats.clipHiPct ?? 0}%`,
    'Shadow Clipping':     `${stats.clipLoPct ?? 0}%`,
    'White Balance':       `${stats.rbDiff > 3 ? 'Warm' : stats.rbDiff < -3 ? 'Cool' : 'Neutral'}  (temp ${preset.temp})`,
    'Avg Saturation':      `${stats.avgSatPct}%`,
    'Skin Tone':           stats.skinDetected ? `Detected (${stats.skinPct}%)` : 'Not detected',
    'Black / White Point': `${stats.blackPoint}  /  ${stats.whitePoint}`,
  };
}

// ─── Action handlers ──────────────────────────────────────────────────────────
function handleDownload() {
  let preset = readSlidersAsPreset();

  const safety = quickSafetyClamp(preset);
  preset = safety.preset;
  if (safety.adjustments.length) {
    console.debug('[Pre-XMP Validation · Export]', safety.adjustments);
    const msgEl = document.getElementById('successMsg');
    if (msgEl) msgEl.innerHTML = `✅ ดาวน์โหลดแล้ว! <span style="opacity:.85">(ปรับ ${safety.adjustments.length} ค่าเพื่อความปลอดภัยของสไตล์)</span>`;
  } else {
    const msgEl = document.getElementById('successMsg');
    if (msgEl) msgEl.innerHTML = '✅ ดาวน์โหลดแล้ว!';
  }

  const xmp    = serializeXMP(preset);
  const name   = document.getElementById('presetName')?.value || 'AI Preset';
  downloadXMP(xmp, name);
  flashSuccess();
}

function handleReanalyze() {
  const img = document.getElementById('previewImg');
  if (state.imageLoaded && img?.complete && img.naturalWidth) runAnalysis();
}

function handleReset() {
  // EPIC 2E-F-C-B-F Bug 1 fix: clear the review console controller's
  // TRANSIENT confirmation state (armed "Confirm Fail?" prompts, the
  // Reset-confirmation prompt) before this image's Review State is
  // cleared below and a new image's analysis begins. Without this, a
  // confirmation armed on one image's item could visually reappear on
  // a different image's item that happens to reuse the same canonical
  // review item ID (every image shares the same fixed set of IDs).
  // This never touches the Review State object itself, never
  // rerenders on its own, and never tears down the controller's event
  // listeners — handleReset() is called unconditionally at the start
  // of loadFile() (genuine new image import) and by the app's own
  // Reset button, but NEVER by handleReanalyze() (which calls
  // runAnalysis() directly), so an ordinary same-image Re-analyze
  // never clears this.
  if (reviewConsoleController) reviewConsoleController.resetTransientUiState();

  state.imageLoaded = false; state.lastStats = null; state.lastPalette = null; state.lastWB = null;
  state.lastCurveSet = null;
  state.lastSkin = null;
  state.lastBasic = null;
  state.lastHSL = null;
  state.lastGrading = null;
  state.lastToneCurves = null;
  state.lastCalibration = null;
  state.lastHarmony = null;
  state.lastImageAnalysis = null;
  state.lastStyleRecognition = null;
  state.lastProcessingLog = null;
  state.lastStyleFingerprint = null;
  state.lastStyleFeatureGraph = null;
  state.lastValidationReport = null;
  state.lastBenchmark = null;
  state.lastDecisionReport = null;
  state.lastReferenceTransfer = null;
  state.lastPreviewSandbox = null;
  state.lastPreviewReviewState = null;
  if (state.curveEditor) state.curveEditor.resetAll();
  document.getElementById('uploadWrap').style.display  = 'block';
  document.getElementById('previewWrap').style.display = 'none';
  document.getElementById('sliders').style.display     = 'none';
  document.getElementById('aiBox').style.display       = 'none';
  const groups = document.getElementById('analysisGroups');
  if (groups) groups.style.display = 'none';
  const reviewSec = document.getElementById('reviewConsoleSection');
  if (reviewSec) reviewSec.style.display = 'none';
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (reviewInner) reviewInner.innerHTML = '';
  // Reset active tab back to Overview
  document.querySelectorAll('.atab').forEach(t => styleAtab(t, t.dataset.group === 'overview'));
  document.querySelectorAll('.agroup').forEach(g => { g.style.display = (g.dataset.group === 'overview') ? 'flex' : 'none'; });
  ['basicSection','toneCurveAISection','calibrationSection','harmonySection','colorGradingSection','hslAnalyzerSection','histSection','paletteSection','wbSection','skinSection','imageAnalysisSection'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const fi = document.getElementById('fileIn');   if (fi)  fi.value  = '';
  const fi2= document.getElementById('fileIn2');  if (fi2) fi2.value = '';
}

// ─── Read sliders ─────────────────────────────────────────────────────────────
const gv = id => parseInt(document.getElementById(id)?.value ?? 0, 10);

function readSlidersAsPreset() {
  const HSL_CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const hsl = {};
  for (const ch of HSL_CHANNELS) {
    hsl[`hsl_h_${ch}`] = gv(`hsl_h_${ch}`);
    hsl[`hsl_s_${ch}`] = gv(`hsl_s_${ch}`);
    hsl[`hsl_l_${ch}`] = gv(`hsl_l_${ch}`);
  }
  const grade = {
    grd_sh_h: gv('grd_sh_h'), grd_sh_s: gv('grd_sh_s'), grd_sh_l: gv('grd_sh_l'),
    grd_mid_h:gv('grd_mid_h'),grd_mid_s:gv('grd_mid_s'),grd_mid_l:gv('grd_mid_l'),
    grd_hi_h: gv('grd_hi_h'), grd_hi_s: gv('grd_hi_s'), grd_hi_l: gv('grd_hi_l'),
    grd_blend:gv('grd_blend'),
  };
  const cal = {
    cal_red_h:gv('cal_red_h'),cal_red_s:gv('cal_red_s'),
    cal_green_h:gv('cal_green_h'),cal_green_s:gv('cal_green_s'),
    cal_blue_h:gv('cal_blue_h'),cal_blue_s:gv('cal_blue_s'),
  };
  return {
    exp:gv('exp'),con:gv('con'),hi:gv('hi'),sh:gv('sh'),wh:gv('wh'),bl:gv('bl'),
    clarity:gv('clarity'),dehaze:gv('dehaze'),texture:gv('texture'),
    temp:gv('temp'),tint:gv('tint'),vib:gv('vib'),sat:gv('sat'),
    sharp:gv('sharp'),noise:gv('noise'),
    crv_hi:gv('crv_hi'),crv_mid:gv('crv_mid'),crv_sh:gv('crv_sh'),
    hsl, grade, cal,
    curves: state.curveEditor ? state.curveEditor.getCurveSet() : null,
  };
}

// ─── Supporter code ───────────────────────────────────────────────────────────
function setupRedeemCode() {
  document.getElementById('btnRedeem')?.addEventListener('click', redeemCode);
}
function redeemCode() {
  const input = document.getElementById('codeIn');
  const msg   = document.getElementById('redeemMsg');
  if (!input || !msg) return;
  const code = input.value.trim().toUpperCase();
  if (!code) { msg.innerHTML = '<div style="margin-top:9px;padding:10px 13px;border-radius:2px;border-left:2px solid var(--danger);background:var(--surface-2);color:var(--danger);font-size:12px">กรุณากรอกโค้ด</div>'; return; }
  msg.innerHTML = '<div style="margin-top:9px;padding:10px 13px;border-radius:2px;border-left:2px solid var(--success);background:var(--surface-2);color:var(--success);font-size:12px">✅ ระบบ Unlimited Mode อยู่แล้ว</div>';
  input.value = '';
  setTimeout(() => (msg.innerHTML = ''), 3000);
}
