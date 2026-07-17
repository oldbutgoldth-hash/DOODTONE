/**
 * ui/interactive-preview-observation-renderer-v2.js
 *
 * EPIC 2E-J Phase A (+ EPIC 2E-J-A-F correctness patch) — pure DOM
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

// FIX 6 (EPIC 2E-J-A-F): one honest message per real cause — never a
// single generic "unavailable" message regardless of the actual
// reason. Mirrors the controller's own UNAVAILABLE_REASON_MESSAGE map.
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
};
const SAFETY_BLOCKED_MESSAGE = 'Observation is unavailable while the comparison is blocked by a safety anomaly.';
// FIX 8 (EPIC 2E-J-A-F2): must match the controller's own
// PROVIDER_UNCONFIRMED_WARNING text exactly, for priority matching.
const PROVIDER_UNCONFIRMED_WARNING = 'Current generation could not be independently confirmed.';

const SAFETY_NOTE = 'Observation only \u00B7 Legacy remains production \u00B7 XMP unchanged';
const V2_REMINDER = 'Controlled V2 remains non-production.';

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

function _safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function el(tag, { style, cls, text, attrs } = {}) {
  const e = document.createElement(tag);
  if (style) e.setAttribute('style', style);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
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

  // FIX 10 (EPIC 2E-J-A-F): scoped :focus-visible rules for the radio
  // labels and the Clear button — the section had no explicit focus
  // style at all before this patch.
  const styleTag = el('style', {
    text: '#ipoFieldset label:focus-within{outline:2px solid var(--accent, #4a9eff);outline-offset:2px;} '
      + '#ipoClearButton:focus-visible{outline:2px solid var(--accent, #4a9eff);outline-offset:2px;}',
  });
  root.appendChild(styleTag);

  root.appendChild(el('h4', { style: 'margin:0;font-size:13px;font-weight:600;color:var(--text)', text: 'Preview Observation' }));
  root.appendChild(el('p', { style: 'margin:0;font-size:11px;color:var(--text-dim)', text: 'Record what you notice in the approximate browser comparison' }));

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
    style: 'align-self:flex-start;padding:6px 14px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);color:var(--text-dim);font-size:10.5px;cursor:pointer',
    text: 'Clear observation',
    attrs: { type: 'button' },
  });
  clearButton.id = 'ipoClearButton';
  fieldset.appendChild(clearButton);

  root.appendChild(fieldset);

  const statusEl = el('div', { style: 'font-size:11px;color:var(--text-dim)', attrs: { 'aria-live': 'polite' } });
  statusEl.id = 'ipoStatus';
  root.appendChild(statusEl);

  // FIX 7 (EPIC 2E-J-A-F): a separate, bounded warning element — the
  // renderer previously read `state.warnings` but never displayed them
  // at all.
  const warningEl = el('div', { style: 'font-size:10.5px;color:var(--warn, orange)', attrs: { 'aria-live': 'polite' } });
  warningEl.id = 'ipoWarning';
  root.appendChild(warningEl);

  // FIX 10: text-faint (low contrast) replaced with text-dim.
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
  };
}

/**
 * Renders the current observation state into the DOM. Pure function of
 * `state` — never reads anything from the controller directly.
 * FIX 3 (EPIC 2E-J-A-F): every projected field read exactly once via
 * `_safeGetR`, stored, then reused — never a second direct access.
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

  const normalizedState = typeof rawState === 'string' ? rawState : 'unavailable';
  const enabled = normalizedState === 'ready' || normalizedState === 'selected' || normalizedState === 'cleared';

  const fieldset = container.querySelector('#ipoFieldset');
  const optionInputs = Array.from(container.querySelectorAll('input[name="ipoObservation"]'));
  const clearButton = container.querySelector('#ipoClearButton');
  const statusEl = container.querySelector('#ipoStatus');
  const warningEl = container.querySelector('#ipoWarning');
  const safetyNoteEl = container.querySelector('#ipoSafetyNote');

  if (fieldset) fieldset.disabled = !enabled;
  optionInputs.forEach((input) => {
    input.disabled = !enabled;
    input.checked = enabled && input.value === rawObservation;
  });
  if (clearButton) clearButton.disabled = !enabled || rawObservation === null || rawObservation === undefined;

  // FIX 6 (EPIC 2E-J-A-F): status message chosen from the ACTUAL
  // cause, never a single generic fallback. Priority: a specific
  // selected-observation message > the state-level message (ready/
  // cleared/disposed) > safety-blocked message > the honest
  // unavailableReason message.
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

  // FIX 8 (EPIC 2E-J-A-F2): explicit warning priority — (1) an actual
  // stale-generation mismatch, (2) a safety blocker, (3) the
  // provider-confirmation-unavailable notice, (4) the honest
  // unavailable reason, (5) nothing (normal selected/ready status needs
  // no separate warning). Deduplicated against the status message text
  // (never repeats the same text in both elements). The
  // provider-unconfirmed notice is rendered in NEUTRAL/informational
  // styling — never as an error/danger, and never labeled "stale".
  if (warningEl) {
    const candidates = _safeArray(rawWarnings).map((w) => _safeText(w)).filter(Boolean);
    const isStaleWarning = (w) => w === UNAVAILABLE_REASON_MESSAGE.cancelled;
    const isProviderUnconfirmed = (w) => w === PROVIDER_UNCONFIRMED_WARNING;

    let primaryWarning = candidates.find(isStaleWarning) ?? null;
    let warningTone = 'danger';
    if (!primaryWarning && normalizedState === 'blocked') {
      primaryWarning = null; // the safety-blocked cause is already the primary status message itself — no separate warning duplicate.
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
}

/** Resets the section's display to the unavailable/empty state without destroying the skeleton. */
export function clearInteractivePreviewObservationDisplay(container) {
  if (!container || container.dataset.ipoLayoutBuilt !== '1') return;
  renderInteractivePreviewObservationV2(container, { state: 'unavailable', observation: null, warnings: [], metadata: { blockers: [], unavailableReason: 'not-ready' } });
}
