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

import { t } from './i18n/index.js';
import { presentBeforeAfterBlockerCode, presentBeforeAfterWarningCode } from './i18n/domain-presenters.js';

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
  const safeColor = typeof color === 'string' && color ? color : 'var(--text-dim)';
  return el('span', {
    style: `display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.04em;background:${safeColor}22;color:${safeColor};border:1px solid ${safeColor}44;overflow-wrap:anywhere`,
    text,
  });
}

const STATE_COLOR = {
  unavailable: 'var(--text-dim)',
  waiting: 'var(--text-dim)',
  preparing: 'var(--text-dim)',
  ready: 'var(--success, green)',
  partial: 'var(--warn, orange)',
  blocked: 'var(--warn, orange)',
  failed: 'var(--danger, red)',
  cancelled: 'var(--text-dim)',
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

// FIX 9 (EPIC 2E-I-B-F): safe single-read property access for the
// renderer boundary — a malformed/hostile `state` object with a
// throwing getter must never crash rendering; degrades to a safe
// fallback instead.
function _safeGetR(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase B/J:
// the Blocked/Status message TEXT now comes from the centralized i18n
// module (`beforeAfter.blockedMessage.*` / `beforeAfter.statusMessage.*`)
// -- FIX 6's invariant (Blocked message chosen from the controller's
// explicit `blockedReason`, never hard-coded as a geometry mismatch
// regardless of cause) is unchanged, only the string source moved.
function _blockedMessage(blockedReason, lang) {
  const key = blockedReason === 'safety' ? 'safety' : blockedReason === 'alignment' ? 'alignment' : 'previewState';
  return t(`beforeAfter.blockedMessage.${key}`, null, lang);
}
function _statusMessage(normalized, lang) {
  const known = ['ready', 'partial', 'blocked', 'preparing', 'waiting', 'cancelled', 'failed', 'unavailable'];
  const key = known.includes(normalized) ? normalized : 'unavailable';
  return t(`beforeAfter.statusMessage.${key}`, null, lang);
}

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
  const titleEl = el('h3', { style: 'margin:0;font-size:14px;font-weight:700;color:var(--text)' });
  titleEl.id = 'ibaTitle';
  titleWrap.appendChild(titleEl);
  const subtitleEl = el('div', { style: 'font-size:10.5px;color:var(--text-dim);margin-top:2px' });
  subtitleEl.id = 'ibaSubtitle';
  titleWrap.appendChild(subtitleEl);
  header.appendChild(titleWrap);
  const statusBadgeWrap = el('div', { attrs: { 'aria-live': 'polite' } });
  statusBadgeWrap.id = 'ibaStatusBadge';
  header.appendChild(statusBadgeWrap);
  root.appendChild(header);

  // Disclaimer — always visible, exact required wording.
  const noticeEl = el('div', {
    style: 'font-size:11px;color:var(--text-dim);background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px 12px;line-height:1.5',
  });
  noticeEl.id = 'ibaNotice';
  root.appendChild(noticeEl);

  // Comparison viewport: base layer (Legacy) + clipped overlay layer (V2) + divider/handle + labels.
  // Phase B: `touch-action: none` remains scoped to this interaction
  // surface only (never applied globally); `user-select` is handled
  // via the local `.iba-dragging` class below instead of a permanent
  // global `user-select: none`, so ordinary page text selection is
  // never affected outside an active drag.
  const styleTag = el('style', {
    text: '.iba-viewport.iba-dragging{cursor:ew-resize;user-select:none;} '
      + '#ibaHandle:focus-visible{outline:3px solid var(--accent, #4a9eff);outline-offset:2px;} '
      + '#ibaRangeInput:focus-visible{outline:2px solid var(--accent, #4a9eff);outline-offset:2px;}',
  });
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
      role: 'slider', tabindex: '0', 'aria-label': t('beforeAfter.sliderAriaLabel', null, 'en'),
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50', 'aria-orientation': 'horizontal',
    },
  });
  handle.id = 'ibaHandle';
  handle.appendChild(el('span', { style: 'color:#fff;font-size:10px;font-weight:700', text: '⇔' }));
  viewport.appendChild(handle);

  const legacyCaption = el('div', { style: 'position:absolute;top:6px;left:6px;padding:2px 8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;border-radius:2px;pointer-events:none' });
  legacyCaption.id = 'ibaLegacyCaption';
  viewport.appendChild(legacyCaption);
  const v2Caption = el('div', { style: 'position:absolute;top:6px;right:6px;padding:2px 8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;border-radius:2px;pointer-events:none' });
  v2Caption.id = 'ibaV2Caption';
  viewport.appendChild(v2Caption);

  const placeholder = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;text-align:center;font-size:11px;color:var(--text-dim);background:var(--surface-1)' });
  placeholder.id = 'ibaPlaceholder';
  viewport.appendChild(placeholder);

  root.appendChild(viewport);

  // Phase B: concise split guidance, always visible.
  const guidanceEl = el('div', { style: 'font-size:10px;color:var(--text-dim)' });
  guidanceEl.id = 'ibaGuidance';
  root.appendChild(guidanceEl);

  // Accessible keyboard-operable range control (kept visible, not hidden).
  const rangeWrap = el('div', { style: 'display:flex;align-items:center;gap:8px' });
  const sliderV2EndEl = el('span', { style: 'font-size:10px;color:var(--text-dim);white-space:nowrap' });
  sliderV2EndEl.id = 'ibaSliderV2End';
  rangeWrap.appendChild(sliderV2EndEl);
  const range = el('input', {
    style: 'flex:1;accent-color:var(--accent)',
    attrs: { type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': t('beforeAfter.sliderAriaLabel', null, 'en') },
  });
  range.id = 'ibaRangeInput';
  rangeWrap.appendChild(range);
  const sliderLegacyEndEl = el('span', { style: 'font-size:10px;color:var(--text-dim);white-space:nowrap' });
  sliderLegacyEndEl.id = 'ibaSliderLegacyEnd';
  rangeWrap.appendChild(sliderLegacyEndEl);
  root.appendChild(rangeWrap);

  // Phase B: a small non-live visual percentage/direction readout —
  // updated on every state change but never itself an aria-live
  // region (per the phase's "do not update aria-live on every percent
  // movement" requirement).
  const splitReadout = el('div', { style: 'font-size:10px;color:var(--text-dim)' });
  splitReadout.id = 'ibaSplitReadout';
  root.appendChild(splitReadout);

  const statusLine = el('div', { style: 'font-size:11px;color:var(--text-dim)', attrs: { 'aria-live': 'polite' } });
  statusLine.id = 'ibaStatusLine';
  root.appendChild(statusLine);

  const messagesWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
  messagesWrap.id = 'ibaMessages';
  root.appendChild(messagesWrap);

  const details = el('details', { style: 'font-size:10.5px;color:var(--text-dim)' });
  const detailsSummary = el('summary', { style: 'cursor:pointer;color:var(--text-dim);font-family:var(--font-mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em' });
  detailsSummary.id = 'ibaDetailsSummary';
  details.appendChild(detailsSummary);
  const detailsBody = el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px' });
  // FIX 10 (EPIC 2E-I-A-F): dynamic per-generation alignment info,
  // updated on every renderInteractiveBeforeAfterStatus() call —
  // separate from the static limitations list below it.
  const alignmentInfo = el('div', { style: 'display:flex;flex-direction:column;gap:3px;padding-bottom:4px;margin-bottom:4px;border-bottom:1px solid var(--border)' });
  alignmentInfo.id = 'ibaAlignmentInfo';
  detailsBody.appendChild(alignmentInfo);
  const limitationsList = el('div', { style: 'display:flex;flex-direction:column;gap:3px' });
  limitationsList.id = 'ibaLimitationsList';
  for (let i = 0; i < 6; i++) limitationsList.appendChild(el('div', {}));
  detailsBody.appendChild(limitationsList);
  details.appendChild(detailsBody);
  root.appendChild(details);

  container.replaceChildren(root);
  return getInteractiveBeforeAfterElements(container);
}

// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase C/J:
// re-applies the skeleton's static translatable text on every render
// call (the skeleton itself is only ever built once per container) --
// this is what lets a setLang() locale switch update this section
// without rebuilding the viewport/canvases.
function _applyStaticSkeletonTranslations(container, lang) {
  // FULL-SYSTEM I18N COMPLETION R2 -- Phase H: the two slider handles'
  // accessible names live in the build-once skeleton, so they must be
  // re-applied here on every locale change; otherwise a screen-reader
  // user would keep hearing the previous language.
  try {
    const sliderAria = t('beforeAfter.sliderAriaLabel', null, lang);
    const handle = container.querySelector('[role="slider"]');
    if (handle) handle.setAttribute('aria-label', sliderAria);
    const range = container.querySelector('input[type="range"]') || container.querySelector('[type="range"]');
    if (range) range.setAttribute('aria-label', sliderAria);
  } catch { /* skeleton not built yet -- nothing to refresh */ }

  if (!container) return;
  const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
  set('ibaTitle', t('beforeAfter.title', null, lang));
  set('ibaSubtitle', t('beforeAfter.subtitle', null, lang));
  set('ibaNotice', t('beforeAfter.notice', null, lang));
  set('ibaLegacyCaption', t('beforeAfter.legacyLabel', null, lang));
  set('ibaV2Caption', t('beforeAfter.v2Label', null, lang));
  set('ibaGuidance', t('beforeAfter.guidance', null, lang));
  set('ibaSliderV2End', t('beforeAfter.sliderV2End', null, lang));
  set('ibaSliderLegacyEnd', t('beforeAfter.sliderLegacyEnd', null, lang));
  set('ibaDetailsSummary', t('beforeAfter.technicalDetails', null, lang));
  const limitationsList = document.getElementById('ibaLimitationsList');
  if (limitationsList) {
    const keys = ['limitation1', 'limitation2', 'limitation3', 'limitation4', 'limitation5', 'limitation6'];
    const items = limitationsList.children ?? [];
    keys.forEach((key, i) => { if (items[i]) items[i].textContent = t(`beforeAfter.${key}`, null, lang); });
  }
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
const TONE_COLOR = {
  success: 'var(--success, green)',
  neutral: 'var(--text-dim)',
  danger: 'var(--danger, red)',
};

const VALID_TONES = ['success', 'neutral', 'danger', 'warning'];
// FIX 6/7 (EPIC 2E-I-B-F2): validates a friendly status object from
// the controller's metadata — bounded text length, tone restricted to
// the 4 known values (unsupported tone becomes neutral). Returns null
// if malformed/missing so the caller can fall back to local derivation.
function _validateFriendlyStatus(statusObj) {
  const rawText = _safeGetR(statusObj, 'text');
  const rawTone = _safeGetR(statusObj, 'tone');
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const text = rawText.length > 60 ? `${rawText.slice(0, 60)}…` : rawText;
  const tone = VALID_TONES.includes(rawTone) ? rawTone : 'neutral';
  return { text, tone };
}

export function renderInteractiveBeforeAfterStatus(container, state, lang) {
  if (!container) return;
  ensureInteractiveBeforeAfterLayout(container);
  _applyStaticSkeletonTranslations(container, lang);

  // FIX 9 (EPIC 2E-I-B-F): every field read exactly once, safely,
  // here — never a repeated direct read of `state` scattered through
  // the rest of this function. A malformed/hostile `state` object
  // degrades safely to Unavailable, never a crash.
  const s = (state && typeof state === 'object') ? state : {};
  const rawState = _safeGetR(s, 'state');
  const rawInteractive = _safeGetR(s, 'interactive');
  const rawSplitPercent = _safeGetR(s, 'splitPercent');
  const rawLegacyAvailable = _safeGetR(s, 'legacyAvailable');
  const rawV2Available = _safeGetR(s, 'v2Available');
  const rawAlignment = _safeGetR(s, 'alignment');
  const rawMetadata = _safeGetR(s, 'metadata');
  const rawWarnings = _safeGetR(s, 'warnings');
  const rawBlockers = _safeGetR(s, 'blockers');
  const rawWarningCodes = _safeGetR(s, 'warningCodes');
  const rawBlockerCodes = _safeGetR(s, 'blockerCodes');
  const rawBlockedReason = _safeGetR(s, 'blockedReason');

  const normalized = _normalizeState(rawState);
  const interactive = rawInteractive === true;
  const legacyAvailable = rawLegacyAvailable === true;
  const v2Available = rawV2Available === true;
  // FIX 5 (EPIC 2E-I-B-F2): `a` is read from `rawAlignment` exactly
  // once here — never re-read as `s.alignment` again later (e.g. in
  // Technical details below, which now reuses this same variable).
  const a = (rawAlignment && typeof rawAlignment === 'object') ? rawAlignment : null;
  const meta = (rawMetadata && typeof rawMetadata === 'object') ? rawMetadata : {};
  // FIX 4: every nested metadata/alignment field read exactly once
  // through _safeGetR here, stored, then used everywhere below —
  // never a second direct `meta.x`/`a.x` access.
  const rawLegacyEffect = _safeGetR(meta, 'legacyVisualAdjustmentsApplied');
  const rawV2Effect = _safeGetR(meta, 'v2VisualAdjustmentsApplied');
  const rawLegacyStatus = _safeGetR(meta, 'legacyStatus');
  const rawV2Status = _safeGetR(meta, 'v2Status');
  const legacyEffect = rawLegacyEffect === true ? true : rawLegacyEffect === false ? false : null;
  const v2Effect = rawV2Effect === true ? true : rawV2Effect === false ? false : null;

  const rawSourceLegacyWidth = _safeGetR(a, 'sourceLegacyWidth');
  const rawSourceLegacyHeight = _safeGetR(a, 'sourceLegacyHeight');
  const rawSourceV2Width = _safeGetR(a, 'sourceV2Width');
  const rawSourceV2Height = _safeGetR(a, 'sourceV2Height');
  const rawDisplayWidth = _safeGetR(a, 'displayWidth');
  const rawDisplayHeight = _safeGetR(a, 'displayHeight');
  const rawSameAspectRatio = _safeGetR(a, 'sameAspectRatio');
  const rawExactSourcePixelMatch = _safeGetR(a, 'exactSourcePixelMatch');
  const rawDisplayDimensionsNormalized = _safeGetR(a, 'displayDimensionsNormalized');
  const rawAspectRatioRelativeDifference = _safeGetR(a, 'aspectRatioRelativeDifference');
  const rawAspectRatioTolerance = _safeGetR(a, 'aspectRatioTolerance');

  const badgeEl = document.getElementById('ibaStatusBadge');
  if (badgeEl) badgeEl.replaceChildren(badge(t(`beforeAfter.stateLabel.${normalized}`, null, lang), STATE_COLOR[normalized]));

  const statusLineEl = document.getElementById('ibaStatusLine');
  // Phase B: Partial explicitly names which side is available/missing.
  // FIX 6: Blocked chooses its message from `blockedReason` — never a
  // hard-coded geometry claim regardless of the real cause.
  let statusMessage = _statusMessage(normalized, lang);
  if (normalized === 'partial') {
    statusMessage = legacyAvailable
      ? t('beforeAfter.partialMessage.legacyAvailable', null, lang)
      : t('beforeAfter.partialMessage.v2Available', null, lang);
  } else if (normalized === 'blocked') {
    statusMessage = _blockedMessage(rawBlockedReason, lang);
  }
  if (statusLineEl) statusLineEl.textContent = statusMessage;

  const placeholderEl = document.getElementById('ibaPlaceholder');
  const viewportEl = document.getElementById('ibaViewport');
  const handleEl = document.getElementById('ibaHandle');
  const rangeEl = document.getElementById('ibaRangeInput');
  if (placeholderEl) placeholderEl.style.display = interactive ? 'none' : 'flex';
  if (placeholderEl && !interactive) placeholderEl.textContent = statusMessage;
  if (handleEl) handleEl.setAttribute('aria-disabled', interactive ? 'false' : 'true');
  if (rangeEl) rangeEl.disabled = !interactive;
  if (viewportEl) viewportEl.style.opacity = interactive || normalized === 'ready' ? '1' : '0.4';

  // Phase B: compact Legacy/V2/Alignment source status summary —
  // friendly labels, never raw internal state values.
  // FIX 6 (EPIC 2E-I-B-F2): the controller's own `metadata.legacyStatus`
  // / `metadata.v2Status` (built by `_friendlySideStatus()`) are now
  // the AUTHORITATIVE source for these badges — local derivation below
  // is only a fallback for when that friendly metadata is missing or
  // malformed.
  // FIX 10 (EPIC 2E-I-B-F): "No supported adjustment" is never styled
  // as success; success requires actually-rendered AND explicit `true`
  // adjustment evidence. Missing (`null`) evidence uses neutral
  // "Rendered · adjustment evidence unknown" wording, never green.
  const sourceStatusRowEl = document.getElementById('ibaSourceStatusRow');
  if (sourceStatusRowEl) {
    sourceStatusRowEl.replaceChildren();

    function _fallbackSideBadgeInfo(name, available, effectTriState, unavailableLabel) {
      if (available) {
        if (effectTriState === false) return { text: t('beforeAfter.badges.noSupportedAdjustment', { name }, lang), tone: 'neutral' };
        if (effectTriState === true) return { text: t('beforeAfter.badges.rendered', { name }, lang), tone: 'success' };
        return { text: t('beforeAfter.badges.renderedUnknown', { name }, lang), tone: 'neutral' };
      }
      return { text: t('beforeAfter.badges.unavailableWithLabel', { name, label: unavailableLabel }, lang), tone: 'neutral' };
    }

    // FIX 7: an explicit failed/blocked side must never be presented
    // merely as "Unavailable" — the fallback label reflects the real
    // normalized overall state when the controller's friendly status
    // metadata itself is unavailable.
    const fallbackLabel = normalized === 'failed' ? t('beforeAfter.badges.failedLabel', null, lang) : normalized === 'blocked' ? t('beforeAfter.badges.blockedLabel', null, lang) : t('beforeAfter.badges.unavailableLabel', null, lang);
    const legacyName = t('beforeAfter.badges.legacyName', null, lang);
    const v2Name = t('beforeAfter.badges.v2Name', null, lang);

    const legacyInfo = _validateFriendlyStatus(rawLegacyStatus) ?? _fallbackSideBadgeInfo(legacyName, legacyAvailable, legacyEffect, fallbackLabel);
    const v2Info = _validateFriendlyStatus(rawV2Status) ?? _fallbackSideBadgeInfo(v2Name, v2Available, v2Effect, fallbackLabel);
    sourceStatusRowEl.appendChild(badge(legacyInfo.text, TONE_COLOR[legacyInfo.tone] ?? TONE_COLOR.neutral));
    sourceStatusRowEl.appendChild(badge(v2Info.text, TONE_COLOR[v2Info.tone] ?? TONE_COLOR.neutral));

    if (a && rawSourceLegacyWidth !== null && rawSourceV2Width !== null) {
      let alignLabel, alignColor;
      // DEPLOY GEOMETRY R1 — Phase A FIX A3: "Blocked geometry" is
      // reserved for a genuine evaluated mismatch (a real Boolean
      // `false`) — never shown merely because geometry has not been
      // evaluated yet (honest `null`).
      if (rawSameAspectRatio === false) { alignLabel = t('beforeAfter.badges.alignmentBlocked', null, lang); alignColor = TONE_COLOR.danger; }
      else if (rawDisplayDimensionsNormalized === true) { alignLabel = t('beforeAfter.badges.alignmentNormalized', null, lang); alignColor = TONE_COLOR.neutral; }
      else if (rawExactSourcePixelMatch === true) { alignLabel = t('beforeAfter.badges.alignmentExact', null, lang); alignColor = TONE_COLOR.success; }
      else if (rawSameAspectRatio === null && rawExactSourcePixelMatch === null) { alignLabel = t('beforeAfter.badges.alignmentNotEvaluated', null, lang); alignColor = TONE_COLOR.neutral; }
      else { alignLabel = t('beforeAfter.badges.alignmentUnknown', null, lang); alignColor = TONE_COLOR.neutral; }
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
    const pct = Number.isFinite(rawSplitPercent) ? Math.round(rawSplitPercent) : 50;
    let guidance;
    if (pct <= 0) guidance = t('beforeAfter.splitGuidance.v2Shown', null, lang);
    else if (pct >= 100) guidance = t('beforeAfter.splitGuidance.legacyShown', null, lang);
    else guidance = t('beforeAfter.splitGuidance.both', null, lang);
    splitReadoutEl.textContent = t('beforeAfter.rows.percentLabel', { pct, guidance }, lang);
  }

  const messagesEl = document.getElementById('ibaMessages');
  if (messagesEl) {
    messagesEl.replaceChildren();
    // Phase B: normalize + dedupe, bounded count, safe string
    // extraction only — never a raw object, never a repeated
    // approximation warning across multiple cards.
    const seen = new Set();
    const pushUnique = (text, color) => {
      const txt = _safeText(text);
      if (!txt || seen.has(txt)) return;
      seen.add(txt);
      messagesEl.appendChild(el('div', { style: `font-size:11px;color:${color}`, text: txt }));
    };
    // I18N RUNTIME CLOSURE R3 -- Phase G: prefer the controller's
    // STABLE CODES (translated) over the raw English blockers/warnings
    // arrays -- the raw arrays are used only when a given entry has no
    // corresponding code (an older/unrecognized producer), same
    // fail-open-toward-visibility convention used elsewhere in R3.
    const blockerCodesList = _safeArray(rawBlockerCodes);
    if (blockerCodesList.length) {
      blockerCodesList.slice(0, 3).forEach(code => pushUnique(presentBeforeAfterBlockerCode(code, lang), 'var(--danger, red)'));
    } else {
      _safeArray(rawBlockers).slice(0, 3).forEach(b => pushUnique(b, 'var(--danger, red)'));
    }
    const warningCodesList = _safeArray(rawWarningCodes);
    if (warningCodesList.length) {
      warningCodesList.slice(0, 3).forEach(code => pushUnique(presentBeforeAfterWarningCode(code, lang), 'var(--warn, orange)'));
    } else {
      _safeArray(rawWarnings).slice(0, 3).forEach(w => pushUnique(w, 'var(--warn, orange)'));
    }
  }

  // FIX 10 (EPIC 2E-I-A-F): compact alignment technical metadata,
  // shown when both sides carry real alignment data (Ready or
  // Blocked) — never claims exact pixel alignment when dimensions
  // actually differed and resampling was required.
  const alignmentInfoEl = document.getElementById('ibaAlignmentInfo');
  if (alignmentInfoEl) {
    alignmentInfoEl.replaceChildren();
    // FIX 5 (EPIC 2E-I-B-F2): reuses `a`/the raw* variables captured
    // ONCE at the top of this function — never a second read of
    // `s.alignment` or its fields here.
    if (a && rawSourceLegacyWidth !== null && rawSourceV2Width !== null) {
      const yesLabel = t('beforeAfter.rows.yes', null, lang);
      const noLabel = t('beforeAfter.rows.no', null, lang);
      const unknownLabel = t('beforeAfter.rows.unknown', null, lang);
      const unavailableLabel = t('beforeAfter.rows.unavailable', null, lang);
      const rows = [
        [t('beforeAfter.rows.exactSourcePixelMatch', null, lang), rawExactSourcePixelMatch === true ? yesLabel : rawExactSourcePixelMatch === false ? noLabel : unknownLabel],
        [t('beforeAfter.rows.sameAspectRatio', null, lang), rawSameAspectRatio === true ? yesLabel : rawSameAspectRatio === false ? noLabel : unknownLabel],
        [t('beforeAfter.rows.aspectRatioDifference', null, lang), Number.isFinite(rawAspectRatioRelativeDifference) ? `${(rawAspectRatioRelativeDifference * 100).toFixed(3)}%` : unknownLabel],
        [t('beforeAfter.rows.comparisonTolerance', null, lang), Number.isFinite(rawAspectRatioTolerance) ? `${(rawAspectRatioTolerance * 100).toFixed(3)}%` : unknownLabel],
        [t('beforeAfter.rows.displayDimensionsNormalized', null, lang), rawDisplayDimensionsNormalized === true ? yesLabel : rawDisplayDimensionsNormalized === false ? noLabel : unknownLabel],
        [t('beforeAfter.rows.displayResolution', null, lang), (Number.isFinite(rawDisplayWidth) && Number.isFinite(rawDisplayHeight)) ? `${rawDisplayWidth}×${rawDisplayHeight}` : unavailableLabel],
        [t('beforeAfter.rows.legacySourceResolution', null, lang), (Number.isFinite(rawSourceLegacyWidth) && Number.isFinite(rawSourceLegacyHeight)) ? `${rawSourceLegacyWidth}×${rawSourceLegacyHeight}` : unknownLabel],
        [t('beforeAfter.rows.v2SourceResolution', null, lang), (Number.isFinite(rawSourceV2Width) && Number.isFinite(rawSourceV2Height)) ? `${rawSourceV2Width}×${rawSourceV2Height}` : unknownLabel],
      ];
      rows.forEach(([label, value]) => {
        const row = el('div', { style: 'display:flex;justify-content:space-between;gap:8px' });
        row.appendChild(el('span', { style: 'color:var(--text-dim)', text: label }));
        row.appendChild(el('span', { style: 'color:var(--text-dim);overflow-wrap:anywhere;text-align:right', text: String(value) }));
        alignmentInfoEl.appendChild(row);
      });
      if (rawDisplayDimensionsNormalized === true) {
        alignmentInfoEl.appendChild(el('div', { style: 'font-size:10px;color:var(--text-dim);font-style:italic;margin-top:2px', text: t('beforeAfter.dimensionNote', null, lang) }));
      }
    }
  }
}

/** Resets the section's status display to the empty/waiting state without destroying the skeleton. */
export function clearInteractiveBeforeAfterDisplay(container, lang) {
  if (!container || container.dataset.ibaLayoutBuilt !== '1') return;
  renderInteractiveBeforeAfterStatus(container, { state: 'unavailable', interactive: false, warnings: [], blockers: [] }, lang);
}
