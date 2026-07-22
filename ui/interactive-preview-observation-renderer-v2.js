/**
 * ui/interactive-preview-observation-renderer-v2.js
 *
 * EPIC 2E-J Phase A (+ EPIC 2E-J-A-F/-F2/-F3 correctness patches,
 * EPIC 2E-J Phase B reason tags/context/session extension) — pure DOM
 * builder/updater for the Preview Observation section. Holds no state
 * of its own; every render call is a pure function of the state object
 * it's given. Never uses innerHTML with untrusted content, never
 * evaluates strings.
 */

const OBSERVATION_OPTIONS = [
  { value: 'prefer-legacy', label: 'Prefer Legacy' },
  { value: 'prefer-v2', label: 'Prefer Controlled V2' },
  { value: 'no-visible-difference', label: 'No visible difference' },
  { value: 'unsure', label: 'Unsure' },
];

// EPIC 2E-J Phase B: reason tags — descriptive UI feedback only.
const REASON_OPTIONS = [
  { value: 'skin-tone', label: 'Skin tone' },
  { value: 'white-balance', label: 'White balance' },
  { value: 'highlight-detail', label: 'Highlight detail' },
  { value: 'shadow-detail', label: 'Shadow detail' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'color-balance', label: 'Color balance' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'natural-look', label: 'Natural look' },
  { value: 'clarity-detail', label: 'Clarity / detail' },
  { value: 'no-specific-reason', label: 'No specific reason' },
];
const REASON_LABEL_BY_VALUE = Object.fromEntries(REASON_OPTIONS.map((o) => [o.value, o.label]));

const SELECTED_MESSAGE = {
  'prefer-legacy': 'Observation recorded: Legacy preview preferred.',
  'prefer-v2': 'Observation recorded: Controlled V2 preview preferred.',
  'no-visible-difference': 'Observation recorded: no meaningful visual difference noticed.',
  unsure: 'Observation recorded: undecided.',
};

const STATE_MESSAGE = {
  ready: 'Choose an observation for this comparison.',
  cleared: 'Observation cleared. Production output was not changed.',
  disposed: 'Observation is unavailable.',
};

// One honest message per real cause — never a single generic
// "unavailable" message regardless of the actual reason.
const UNAVAILABLE_REASON_MESSAGE = {
  preparing: 'Observation will be available when both previews finish rendering.',
  partial: 'Observation is unavailable because only one preview rendered.',
  failed: 'Observation is unavailable because the comparison could not be prepared.',
  cancelled: 'The previous observation was cleared because a newer analysis is active.',
  alignment: 'Observation is unavailable because the previews cannot be aligned safely.',
  'preview-state': 'Observation is unavailable because one preview did not pass its render requirements.',
  source: 'Observation is unavailable because the preview sources are incomplete.',
  'missing-generation': 'Observation is unavailable because the current analysis generation is unknown.',
  'not-ready': 'Observation is available after both previews are ready.',
  // DEPLOY GEOMETRY R1 — Phase D: must match the controller's own
  // UNAVAILABLE_REASON_MESSAGE['pixel-mismatch'] exactly (same
  // rationale documented there).
  'pixel-mismatch': 'Observation is unavailable because exact pixel dimensions between the two previews have not been proven.',
};
const SAFETY_BLOCKED_MESSAGE = 'Observation is unavailable while the comparison is blocked by a safety anomaly.';
// Must match the controller's own PROVIDER_UNCONFIRMED_WARNING text
// exactly, for priority matching.
const PROVIDER_UNCONFIRMED_WARNING = 'Current generation could not be independently confirmed.';

const SAFETY_NOTE = 'Observation only \u00B7 Legacy remains production \u00B7 XMP unchanged';
const V2_REMINDER = 'Controlled V2 remains non-production.';
const REASON_DETAILS_NOTE = 'Observation details stay in this page session only and do not change production output.';
const REASON_LIMIT_MESSAGE = 'You can select up to five reasons.';
// Step 7B-B-F3-P1 FIX 4 — the exact bounded accessible message shown
// when Reasons are genuinely cleared while the current Observation
// remains selected. Reuses the existing #ipoReasonLimit polite live
// region — no fourth live region is added.
const REASONS_CLEARED_MESSAGE = 'Reasons cleared. Observation remains selected. Production output was not changed.';
const SESSION_NOTE = 'This summary resets when the page reloads and does not affect Mapping, XMP, or production.';
const SESSION_EMPTY_MESSAGE = 'No observations have been recorded in this page session.';

// Safe single-read property access for the renderer boundary.
function _safeGetR(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

function _safeText(value, maxLen = 240) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

// FIX (Step 7B-B, genuine defect found and proven via hostile-input
// testing): previously this only checked `Array.isArray()` and
// returned the caller's array UNCHANGED — a hostile array with a
// throwing index getter would still crash later when `.filter()`/
// `.includes()` iterated it (both access every index natively). This
// now performs a genuine safe, bounded projection: verifies
// `Array.isArray` itself defensively, safe-reads `.length` once,
// clamps to a reasonable bound, and safe-reads each numeric index with
// a per-index try/catch — never `for...of`/spread on the caller's
// array (which would invoke a possibly-hostile `Symbol.iterator`).
// Returns a brand-new plain array; the input is never mutated.
function _safeArray(value, maxLen = 32) {
  let isArr;
  try { isArr = Array.isArray(value); } catch { return []; }
  if (!isArr) return [];
  let length;
  try { length = value.length; } catch { return []; }
  if (!Number.isFinite(length) || length <= 0) return [];
  const bound = Math.min(Math.floor(length), maxLen);
  const out = [];
  for (let i = 0; i < bound; i++) {
    try { out.push(value[i]); } catch { /* hostile index getter skipped, never crashes */ }
  }
  return out;
}

function el(tag, { style, cls, text, attrs } = {}) {
  const e = document.createElement(tag);
  if (style) e.setAttribute('style', style);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// A friendly, non-raw display of a generation ID. Only primitives are
// shown directly; anything else (including a hostile/non-primitive
// value) safely degrades to "Available" rather than being serialized.
function _friendlyGenerationLabel(generationId) {
  if (generationId === null || generationId === undefined) return 'None yet';
  if (typeof generationId === 'string' || typeof generationId === 'number') return String(generationId);
  return 'Available';
}

/**
 * Builds the section skeleton once. Idempotent — safe to call multiple
 * times; only builds on the first call for a given container.
 */
export function ensureInteractivePreviewObservationLayout(container) {
  if (!container) return null;
  if (container.dataset.ipoLayoutBuilt === '1') {
    return getInteractivePreviewObservationElements(container);
  }

  const root = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });

  // Scoped :focus-visible rules for the radio/checkbox labels and
  // buttons.
  const styleTag = el('style', {
    text: '#ipoFieldset label:focus-within,#ipoReasonFieldset label:focus-within{outline:2px solid var(--accent, #4a9eff);outline-offset:2px;} '
      + '#ipoClearButton:focus-visible,#ipoClearReasonsButton:focus-visible,#ipoClearSessionButton:focus-visible{outline:2px solid var(--accent, #4a9eff);outline-offset:2px;}',
  });
  root.appendChild(styleTag);

  root.appendChild(el('h4', { style: 'margin:0;font-size:13px;font-weight:600;color:var(--text)', text: 'Preview Observation' }));
  root.appendChild(el('p', { style: 'margin:0;font-size:11px;color:var(--text-dim)', text: 'Record what you notice in the approximate browser comparison' }));

  // EPIC 2E-J Phase B: compact context summary.
  const contextEl = el('div', { style: 'font-size:10px;color:var(--text-dim);display:flex;flex-wrap:wrap;gap:10px;padding:8px;border:1px solid var(--border);border-radius:3px' });
  contextEl.id = 'ipoContext';
  root.appendChild(contextEl);

  const fieldset = el('fieldset', { style: 'border:1px solid var(--border);border-radius:3px;padding:12px;margin:0;display:flex;flex-direction:column;gap:8px' });
  fieldset.id = 'ipoFieldset';
  const legend = el('legend', { style: 'font-size:10.5px;color:var(--text-dim);padding:0 6px', text: 'Observation options' });
  fieldset.appendChild(legend);

  const optionsWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' });
  OBSERVATION_OPTIONS.forEach(({ value, label }) => {
    const optionLabel = el('label', {
      style: 'display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11.5px;color:var(--text);min-height:44px;flex:1 1 140px',
    });
    const input = el('input', { attrs: { type: 'radio', name: 'ipoObservation', value, id: `ipoOption_${value}` } });
    input.style.cursor = 'pointer';
    optionLabel.appendChild(input);
    optionLabel.appendChild(el('span', { text: label }));
    optionsWrap.appendChild(optionLabel);
  });
  fieldset.appendChild(optionsWrap);

  const clearButton = el('button', {
    style: 'align-self:flex-start;padding:6px 14px;min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);color:var(--text-dim);font-size:10.5px;cursor:pointer',
    text: 'Clear observation',
    attrs: { type: 'button' },
  });
  clearButton.id = 'ipoClearButton';
  fieldset.appendChild(clearButton);

  root.appendChild(fieldset);

  const statusEl = el('div', { style: 'font-size:11px;color:var(--text-dim)', attrs: { 'aria-live': 'polite' } });
  statusEl.id = 'ipoStatus';
  root.appendChild(statusEl);

  const warningEl = el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', attrs: { 'aria-live': 'polite' } });
  warningEl.id = 'ipoWarning';
  root.appendChild(warningEl);

  // EPIC 2E-J Phase B: reason tags fieldset ("Why?").
  const reasonFieldset = el('fieldset', { style: 'border:1px solid var(--border);border-radius:3px;padding:12px;margin:0;display:flex;flex-direction:column;gap:8px' });
  reasonFieldset.id = 'ipoReasonFieldset';
  reasonFieldset.appendChild(el('legend', { style: 'font-size:10.5px;color:var(--text-dim);padding:0 6px', text: 'Why?' }));

  const reasonsWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
  REASON_OPTIONS.forEach(({ value, label }) => {
    const reasonLabel = el('label', {
      style: 'display:flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:10.5px;color:var(--text);min-height:44px',
    });
    const input = el('input', { attrs: { type: 'checkbox', name: 'ipoReason', value, id: `ipoReason_${value}` } });
    input.style.cursor = 'pointer';
    reasonLabel.appendChild(input);
    reasonLabel.appendChild(el('span', { text: label }));
    reasonsWrap.appendChild(reasonLabel);
  });
  reasonFieldset.appendChild(reasonsWrap);

  const reasonLimitEl = el('div', { style: 'font-size:10px;color:var(--text-dim)', attrs: { 'aria-live': 'polite' } });
  reasonLimitEl.id = 'ipoReasonLimit';
  reasonFieldset.appendChild(reasonLimitEl);

  const clearReasonsButton = el('button', {
    style: 'align-self:flex-start;padding:6px 14px;min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);color:var(--text-dim);font-size:10.5px;cursor:pointer',
    text: 'Clear reasons',
    attrs: { type: 'button' },
  });
  clearReasonsButton.id = 'ipoClearReasonsButton';
  reasonFieldset.appendChild(clearReasonsButton);

  const reasonStatusEl = el('div', { style: 'font-size:10px;color:var(--text-dim)' });
  reasonStatusEl.id = 'ipoReasonStatus';
  reasonFieldset.appendChild(reasonStatusEl);

  root.appendChild(reasonFieldset);

  const detailsNoteEl = el('div', { style: 'font-size:10px;color:var(--text-dim)', text: REASON_DETAILS_NOTE });
  root.appendChild(detailsNoteEl);

  const safetyNoteEl = el('div', { style: 'font-size:10px;color:var(--text-dim)', text: SAFETY_NOTE });
  safetyNoteEl.id = 'ipoSafetyNote';
  root.appendChild(safetyNoteEl);

  container.replaceChildren(root);
  container.dataset.ipoLayoutBuilt = '1';
  return getInteractivePreviewObservationElements(container);
}

/** Returns references to the section's key elements. Safe to call repeatedly; returns null fields if the layout hasn't been built or elements are missing. */
export function getInteractivePreviewObservationElements(container) {
  if (!container) return null;
  return {
    optionInputs: Array.from(container.querySelectorAll('input[name="ipoObservation"]')),
    clearButton: container.querySelector('#ipoClearButton') || null,
    reasonInputs: Array.from(container.querySelectorAll('input[name="ipoReason"]')),
    clearReasonsButton: container.querySelector('#ipoClearReasonsButton') || null,
  };
}

/**
 * Renders the current observation state into the DOM. Pure function of
 * `state` — never reads anything from the controller directly.
 * Every projected field read exactly once via `_safeGetR`, stored, then
 * reused — never a second direct access.
 */
export function renderInteractivePreviewObservationV2(container, state) {
  if (!container) return;
  ensureInteractivePreviewObservationLayout(container);

  const s = (state && typeof state === 'object') ? state : {};
  const rawState = _safeGetR(s, 'state');
  const rawObservation = _safeGetR(s, 'observation');
  const rawWarnings = _safeGetR(s, 'warnings');
  const rawMetadata = _safeGetR(s, 'metadata');
  const rawUnavailableReason = _safeGetR(rawMetadata, 'unavailableReason');
  const rawReasons = _safeGetR(s, 'reasons');
  const rawReasonLimitReached = _safeGetR(s, 'reasonLimitReached');
  // Step 7B-B-F3-P1 FIX 4/7 — an unknown/hostile token is treated
  // exactly like null (no Clear Reasons message); only the exact
  // string 'reasons-cleared' is ever accepted.
  const rawReasonAnnouncement = _safeGetR(s, 'reasonAnnouncement');
  const reasonAnnouncementActive = rawReasonAnnouncement === 'reasons-cleared';

  const normalizedState = typeof rawState === 'string' ? rawState : 'unavailable';
  const enabled = normalizedState === 'ready' || normalizedState === 'selected' || normalizedState === 'cleared';
  const hasSelection = normalizedState === 'selected' && typeof rawObservation === 'string';

  const fieldset = container.querySelector('#ipoFieldset');
  const optionInputs = Array.from(container.querySelectorAll('input[name="ipoObservation"]'));
  const clearButton = container.querySelector('#ipoClearButton');
  const statusEl = container.querySelector('#ipoStatus');
  const warningEl = container.querySelector('#ipoWarning');
  const safetyNoteEl = container.querySelector('#ipoSafetyNote');
  const reasonFieldset = container.querySelector('#ipoReasonFieldset');
  const reasonInputs = Array.from(container.querySelectorAll('input[name="ipoReason"]'));
  const reasonLimitEl = container.querySelector('#ipoReasonLimit');
  const clearReasonsButton = container.querySelector('#ipoClearReasonsButton');
  const reasonStatusEl = container.querySelector('#ipoReasonStatus');

  if (fieldset) fieldset.disabled = !enabled;
  optionInputs.forEach((input) => {
    input.disabled = !enabled;
    input.checked = enabled && input.value === rawObservation;
  });
  if (clearButton) clearButton.disabled = !enabled || rawObservation === null || rawObservation === undefined;

  let message;
  if (normalizedState === 'selected' && typeof rawObservation === 'string' && SELECTED_MESSAGE[rawObservation]) {
    message = SELECTED_MESSAGE[rawObservation];
  } else if (STATE_MESSAGE[normalizedState]) {
    message = STATE_MESSAGE[normalizedState];
  } else if (normalizedState === 'blocked') {
    message = SAFETY_BLOCKED_MESSAGE;
  } else if (typeof rawUnavailableReason === 'string' && UNAVAILABLE_REASON_MESSAGE[rawUnavailableReason]) {
    message = UNAVAILABLE_REASON_MESSAGE[rawUnavailableReason];
  } else {
    message = UNAVAILABLE_REASON_MESSAGE['not-ready'];
  }
  if (statusEl) statusEl.textContent = message;

  // Explicit warning priority — (1) an actual stale-generation
  // mismatch, (2) a safety blocker, (3) the provider-confirmation-
  // unavailable notice, (4) the honest unavailable reason, (5) nothing.
  // Deduplicated against the status message text. The
  // provider-unconfirmed notice is rendered in NEUTRAL/informational
  // styling — never as an error/danger, and never labeled "stale".
  if (warningEl) {
    const candidates = _safeArray(rawWarnings).map((w) => _safeText(w)).filter(Boolean);
    const isStaleWarning = (w) => w === UNAVAILABLE_REASON_MESSAGE.cancelled;
    const isProviderUnconfirmed = (w) => w === PROVIDER_UNCONFIRMED_WARNING;

    let primaryWarning = candidates.find(isStaleWarning) ?? null;
    let warningTone = 'danger';
    if (!primaryWarning && normalizedState === 'blocked') {
      primaryWarning = null;
    }
    if (!primaryWarning) {
      const providerNotice = candidates.find(isProviderUnconfirmed);
      if (providerNotice) { primaryWarning = providerNotice; warningTone = 'neutral'; }
    }
    if (!primaryWarning) {
      primaryWarning = candidates.find((w) => w !== message) ?? null;
      warningTone = 'neutral';
    }

    warningEl.textContent = primaryWarning ?? '';
    warningEl.style.color = warningTone === 'danger' ? 'var(--warn, orange)' : 'var(--text-dim)';
  }

  if (safetyNoteEl) {
    let note = SAFETY_NOTE;
    if (normalizedState === 'selected' && rawObservation === 'prefer-v2') {
      note = `${SAFETY_NOTE} \u00B7 ${V2_REMINDER}`;
    }
    safetyNoteEl.textContent = note;
  }

  // EPIC 2E-J Phase B: reason tags — enabled only when an Observation is
  // genuinely selected for the current generation.
  const reasonsList = _safeArray(rawReasons).filter((r) => typeof r === 'string');
  const reasonLimitReached = rawReasonLimitReached === true;
  const reasonsEnabled = hasSelection;

  if (reasonFieldset) reasonFieldset.disabled = !reasonsEnabled;
  reasonInputs.forEach((input) => {
    const isChecked = reasonsEnabled && reasonsList.includes(input.value);
    input.checked = isChecked;
    // At the limit, unchecked boxes become disabled (checked ones stay
    // removable); when not enabled at all, everything is disabled.
    const isDisabled = !reasonsEnabled || (reasonLimitReached && !isChecked);
    input.disabled = isDisabled;

    // COMBINED CLOSEOUT R1 — Phase C FIX C1/C2: an explicit, measurable,
    // Renderer-owned visible style difference on the Reason's own
    // label — never relying on native checkbox rendering, cursor alone,
    // the bare `disabled` property, or a className with no attached
    // CSS. `data-ipo-disabled` is the bounded Production attribute.
    // COMBINED CLOSEOUT R2 — Phase A FIX A1: the label (and its text) is
    // NEVER dimmed via `opacity` — a Contrast audit measuring a
    // group-opacity Element correctly requires full foreground/
    // background alpha compositing, which five simultaneously-disabled
    // labels turned into an unmeasurable/NOT_TESTED result. The visible
    // disabled distinction now comes ONLY from fully-opaque
    // backgroundColor/borderColor/boxShadow changes (and, optionally,
    // dimming the checkbox INPUT itself — never the label or its text)
    // so every disabled Reason still yields a real, directly-computable
    // two-opaque-color Contrast ratio. Applied/removed idempotently on
    // every render — explicit values in BOTH branches, never a partial
    // clear that could leave stale inline styling behind — and enabled
    // text/contrast is fully restored to its ORIGINAL values (never left
    // dimmer or otherwise degraded) so FIX C4/A2 (no contrast
    // regression) holds.
    const reasonLabel = input.closest('label');
    if (reasonLabel) {
      if (isDisabled) {
        reasonLabel.dataset.ipoDisabled = 'true';
        reasonLabel.style.opacity = '1'; // FIX A1: label/text group opacity is NEVER reduced
        reasonLabel.style.backgroundColor = 'var(--surface-2)';
        reasonLabel.style.borderColor = 'var(--border-strong, var(--border))';
        reasonLabel.style.boxShadow = 'inset 0 0 0 1px var(--surface-3, var(--border))';
        reasonLabel.style.cursor = 'not-allowed';
        input.style.opacity = '0.6'; // FIX A1: dimming is confined to the checkbox input itself
      } else {
        delete reasonLabel.dataset.ipoDisabled;
        reasonLabel.style.opacity = '1';
        reasonLabel.style.backgroundColor = 'transparent';
        reasonLabel.style.borderColor = 'var(--border)';
        reasonLabel.style.boxShadow = 'none';
        reasonLabel.style.cursor = 'pointer';
        input.style.opacity = '1'; // FIX A2: exact restoration, no stale dimming left behind
      }
    }
  });
  // Step 7B-B-F3-P1 FIX 4 — render priority into the EXISTING
  // #ipoReasonLimit polite live region (no fourth live region added):
  // (1) the Reasons-cleared announcement, (2) otherwise the five-Reason
  // limit message, (3) otherwise empty. textContent only — no HTML/
  // innerHTML — and the message is the exact bounded string, never
  // concatenated or interpolated with untrusted data.
  let reasonLimitMessage = '';
  if (reasonsEnabled && reasonAnnouncementActive) {
    reasonLimitMessage = REASONS_CLEARED_MESSAGE;
  } else if (reasonsEnabled && reasonLimitReached) {
    reasonLimitMessage = REASON_LIMIT_MESSAGE;
  }
  if (reasonLimitEl) reasonLimitEl.textContent = reasonLimitMessage;
  if (clearReasonsButton) clearReasonsButton.disabled = !reasonsEnabled || reasonsList.length === 0;
  if (reasonStatusEl) {
    reasonStatusEl.textContent = reasonsEnabled && reasonsList.length > 0
      ? `Selected: ${reasonsList.map((r) => REASON_LABEL_BY_VALUE[r] ?? r).join(', ')}`
      : '';
  }
}

/** Resets the section's display to the unavailable/empty state without destroying the skeleton. */
export function clearInteractivePreviewObservationDisplay(container) {
  if (!container || container.dataset.ipoLayoutBuilt !== '1') return;
  renderInteractivePreviewObservationV2(container, { state: 'unavailable', observation: null, warnings: [], metadata: { blockers: [], unavailableReason: 'not-ready' }, reasons: [], reasonLimitReached: false });
}

/**
 * EPIC 2E-J Phase B: renders the compact Context summary inside the
 * Preview Observation section. Pure function of a compact context
 * projection — never exposes a raw generation object or full timestamp.
 * @param {{ generationId: any, legacyStatus: string, v2Status: string, alignmentStatus: string, generationConfirmed: (boolean|null) }} contextInfo
 */
export function renderInteractivePreviewObservationContextV2(container, contextInfo) {
  const contextEl = container ? container.querySelector('#ipoContext') : null;
  if (!contextEl) return;
  const c = (contextInfo && typeof contextInfo === 'object') ? contextInfo : {};
  const generationId = _safeGetR(c, 'generationId');
  const legacyStatus = _safeText(_safeGetR(c, 'legacyStatus')) ?? 'Unknown';
  const v2Status = _safeText(_safeGetR(c, 'v2Status')) ?? 'Unknown';
  const alignmentStatus = _safeText(_safeGetR(c, 'alignmentStatus')) ?? 'Unknown';
  const rawConfirmed = _safeGetR(c, 'generationConfirmed');
  const confirmedLabel = rawConfirmed === true ? 'Confirmed' : rawConfirmed === false ? 'Context fallback' : 'Unavailable';

  contextEl.replaceChildren();
  const rows = [
    ['Comparison generation', _friendlyGenerationLabel(generationId)],
    ['Legacy preview', legacyStatus],
    ['Controlled V2 preview', v2Status],
    ['Alignment', alignmentStatus],
    ['Generation confirmation', confirmedLabel],
    ['Observation session', 'In-memory only'],
  ];
  rows.forEach(([label, value]) => {
    const item = el('span', {});
    item.appendChild(el('span', { style: 'color:var(--text-dim)', text: `${label}: ` }));
    item.appendChild(el('span', { style: 'color:var(--text)', text: value }));
    contextEl.appendChild(item);
  });
}

// ── Session Observation Summary ──────────────────────────────────────

const REASON_FIELD_LABEL = {
  skinTone: 'Skin tone', whiteBalance: 'White balance', highlightDetail: 'Highlight detail',
  shadowDetail: 'Shadow detail', contrast: 'Contrast', colorBalance: 'Color balance',
  saturation: 'Saturation', naturalLook: 'Natural look', clarityDetail: 'Clarity / detail', noSpecificReason: 'No specific reason',
};

/** Builds the Session Observation Summary section skeleton once. Idempotent. */
export function ensureInteractivePreviewObservationSessionLayout(container) {
  if (!container) return null;
  if (container.dataset.ipoSessionLayoutBuilt === '1') {
    return getInteractivePreviewObservationSessionElements(container);
  }

  const root = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  root.appendChild(el('h4', { style: 'margin:0;font-size:12.5px;font-weight:600;color:var(--text)', text: 'Session Observation Summary' }));
  root.appendChild(el('p', { style: 'margin:0;font-size:10.5px;color:var(--text-dim)', text: 'Current page session only' }));
  root.appendChild(el('div', { style: 'font-size:10px;color:var(--text-dim)', text: SESSION_NOTE }));

  const metricsEl = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;font-size:10.5px' });
  metricsEl.id = 'ipoSessionMetrics';
  root.appendChild(metricsEl);

  const secondaryEl = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--text-dim)' });
  secondaryEl.id = 'ipoSessionSecondary';
  root.appendChild(secondaryEl);

  const topReasonsEl = el('div', { style: 'font-size:10px;color:var(--text-dim)' });
  topReasonsEl.id = 'ipoSessionTopReasons';
  root.appendChild(topReasonsEl);

  const clearSessionButton = el('button', {
    style: 'align-self:flex-start;padding:6px 14px;min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);color:var(--text-dim);font-size:10.5px;cursor:pointer',
    text: 'Clear session summary',
    attrs: { type: 'button' },
  });
  clearSessionButton.id = 'ipoClearSessionButton';
  root.appendChild(clearSessionButton);

  container.replaceChildren(root);
  container.dataset.ipoSessionLayoutBuilt = '1';
  return getInteractivePreviewObservationSessionElements(container);
}

export function getInteractivePreviewObservationSessionElements(container) {
  if (!container) return null;
  return { clearSessionButton: container.querySelector('#ipoClearSessionButton') || null };
}

/**
 * Renders a session summary snapshot. Pure function — never mutates the
 * summary object, never shows percentages when the denominator is
 * zero, never shows NaN/Infinity.
 */
// FIX 10 (EPIC 2E-J-B-F): single-read, clamped-to-finite-non-negative-
// integer projection of a count value — never a `Number.isFinite(_safeGetR(...)) ? s.field : 0`
// double-read pattern.
function _normalizeNonNegativeCount(value) {
  return (Number.isFinite(value) && value >= 0) ? Math.floor(value) : 0;
}

const REASON_VALUE_TO_FIELD = {
  'skin-tone': 'skinTone', 'white-balance': 'whiteBalance', 'highlight-detail': 'highlightDetail',
  'shadow-detail': 'shadowDetail', contrast: 'contrast', 'color-balance': 'colorBalance',
  saturation: 'saturation', 'natural-look': 'naturalLook', 'clarity-detail': 'clarityDetail', 'no-specific-reason': 'noSpecificReason',
};

// FIX 7/11 (EPIC 2E-J-B-F): a safe bounded projection of an untrusted
// array, mirroring the controller/session modules' own helper — never
// `.map()`/`.filter()` directly on caller-supplied input.
function _safeBoundedArrayR(input, maxLen = 8) {
  let isArr;
  try {
    isArr = Array.isArray(input);
  } catch {
    return [];
  }
  if (!isArr) return [];
  let length;
  try {
    length = input.length;
  } catch {
    return [];
  }
  if (!Number.isFinite(length) || length <= 0) return [];
  const bound = Math.min(Math.floor(length), maxLen);
  const out = [];
  for (let i = 0; i < bound; i++) {
    try {
      out.push(input[i]);
    } catch {
      /* hostile index getter skipped */
    }
  }
  return out;
}

export function renderInteractivePreviewObservationSessionV2(container, summary) {
  if (!container) return;
  ensureInteractivePreviewObservationSessionLayout(container);
  const s = (summary && typeof summary === 'object') ? summary : {};
  const metricsEl = container.querySelector('#ipoSessionMetrics');
  const secondaryEl = container.querySelector('#ipoSessionSecondary');
  const topReasonsEl = container.querySelector('#ipoSessionTopReasons');

  // FIX 10: every field read exactly once via _safeGetR, then clamped
  // — never a second direct access of the original object.
  const totalObserved = _normalizeNonNegativeCount(_safeGetR(s, 'totalObserved'));
  const activeObservations = _normalizeNonNegativeCount(_safeGetR(s, 'activeObservations'));
  const preferLegacy = _normalizeNonNegativeCount(_safeGetR(s, 'preferLegacy'));
  const preferV2 = _normalizeNonNegativeCount(_safeGetR(s, 'preferV2'));
  const noVisibleDifference = _normalizeNonNegativeCount(_safeGetR(s, 'noVisibleDifference'));
  const unsure = _normalizeNonNegativeCount(_safeGetR(s, 'unsure'));
  const cleared = _normalizeNonNegativeCount(_safeGetR(s, 'cleared'));
  const invalidated = _normalizeNonNegativeCount(_safeGetR(s, 'invalidated'));
  const rawTopReasons = _safeGetR(s, 'topReasons');
  const topReasons = _safeBoundedArrayR(rawTopReasons);

  if (metricsEl) {
    metricsEl.replaceChildren();
    if (totalObserved === 0) {
      metricsEl.appendChild(el('div', { style: 'color:var(--text-dim)', text: SESSION_EMPTY_MESSAGE }));
    } else {
      const pct = (n) => (activeObservations > 0 ? `${Math.round((n / activeObservations) * 100)}%` : '');
      const metric = (label, value, percentLabel) => {
        const box = el('div', { style: 'color:var(--text)' });
        const text = percentLabel ? `${label}: ${value}${percentLabel ? ` (${percentLabel})` : ''}` : `${label}: ${value}`;
        box.textContent = text;
        metricsEl.appendChild(box);
      };
      metric('Observed', totalObserved, null);
      metric('Prefer Legacy', preferLegacy, pct(preferLegacy));
      metric('Prefer V2', preferV2, pct(preferV2));
      metric('No visible difference', noVisibleDifference, pct(noVisibleDifference));
      metric('Unsure', unsure, pct(unsure));
    }
  }

  if (secondaryEl) {
    secondaryEl.replaceChildren();
    secondaryEl.appendChild(el('span', { text: `Cleared: ${cleared}` }));
    secondaryEl.appendChild(el('span', { text: `Invalidated: ${invalidated}` }));
  }

  if (topReasonsEl) {
    topReasonsEl.replaceChildren();
    // FIX 11: each entry safe-read (reason, count) exactly once;
    // malformed entries (unknown reason, non-finite/negative count) are
    // silently rejected — never rendered as NaN/Infinity/[object Object].
    const validEntries = [];
    for (const entry of topReasons) {
      const reason = _safeGetR(entry, 'reason');
      const rawCount = _safeGetR(entry, 'count');
      const field = typeof reason === 'string' ? REASON_VALUE_TO_FIELD[reason] : undefined;
      const label = field ? REASON_FIELD_LABEL[field] : null;
      const count = _normalizeNonNegativeCount(rawCount);
      if (label && count > 0) validEntries.push(`${label} (${count})`);
    }
    if (validEntries.length > 0) {
      topReasonsEl.appendChild(el('div', { text: `Top reasons: ${validEntries.join(', ')}` }));
    }
  }
}
