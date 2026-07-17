/**
 * ui/interactive-preview-observation-renderer-v2.js
 *
 * EPIC 2E-J Phase A — pure DOM builder/updater for the Preview
 * Observation section. Holds no state of its own; every render call is
 * a pure function of the state object it's given. Never uses
 * innerHTML with untrusted content, never evaluates strings.
 */

const OBSERVATION_OPTIONS = [
  { value: 'prefer-legacy', label: 'Prefer Legacy' },
  { value: 'prefer-v2', label: 'Prefer Controlled V2' },
  { value: 'no-visible-difference', label: 'No visible difference' },
  { value: 'unsure', label: 'Unsure' },
];

const STATUS_MESSAGE = {
  ready: 'Choose an observation for this comparison.',
  'prefer-legacy': 'Observation recorded: Legacy preview preferred.',
  'prefer-v2': 'Observation recorded: Controlled V2 preview preferred.',
  'no-visible-difference': 'Observation recorded: no meaningful visual difference noticed.',
  unsure: 'Observation recorded: undecided.',
  cleared: 'Observation cleared. Production output was not changed.',
  unavailable: 'Observation is available after both previews are ready.',
  blocked: 'Observation is unavailable while the comparison is blocked.',
  disposed: 'Observation is unavailable.',
};

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

function _safeText(value, maxLen = 300) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
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

  root.appendChild(el('h4', { style: 'margin:0;font-size:13px;font-weight:600;color:var(--text)', text: 'Preview Observation' }));
  root.appendChild(el('p', { style: 'margin:0;font-size:11px;color:var(--text-dim)', text: 'Record what you notice in the approximate browser comparison' }));

  const fieldset = el('fieldset', { style: 'border:1px solid var(--border);border-radius:3px;padding:12px;margin:0;display:flex;flex-direction:column;gap:8px' });
  fieldset.id = 'ipoFieldset';
  const legend = el('legend', { style: 'font-size:10.5px;color:var(--text-dim);padding:0 6px', text: 'Observation options' });
  fieldset.appendChild(legend);

  const optionsWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' });
  OBSERVATION_OPTIONS.forEach(({ value, label }, i) => {
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

  const safetyNoteEl = el('div', { style: 'font-size:10px;color:var(--text-faint)', text: SAFETY_NOTE });
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
    root: container.querySelector('div') || null,
    fieldset: container.querySelector('#ipoFieldset') || null,
    optionInputs: Array.from(container.querySelectorAll('input[name="ipoObservation"]')),
    clearButton: container.querySelector('#ipoClearButton') || null,
    statusElement: container.querySelector('#ipoStatus') || null,
    safetyNoteElement: container.querySelector('#ipoSafetyNote') || null,
  };
}

/**
 * Renders the current observation state into the DOM. Pure function of
 * `state` — never reads anything from the controller directly.
 */
export function renderInteractivePreviewObservationV2(container, state) {
  if (!container) return;
  ensureInteractivePreviewObservationLayout(container);

  const s = (state && typeof state === 'object') ? state : {};
  const rawState = _safeGetR(s, 'state');
  const rawObservation = _safeGetR(s, 'observation');
  const rawWarnings = _safeGetR(s, 'warnings');
  const rawMetadata = _safeGetR(s, 'metadata');
  const rawBlockers = _safeGetR(rawMetadata, 'blockers');

  const normalizedState = typeof rawState === 'string' ? rawState : 'unavailable';
  const enabled = normalizedState === 'ready' || normalizedState === 'selected' || normalizedState === 'cleared';

  const fieldset = container.querySelector('#ipoFieldset');
  const optionInputs = Array.from(container.querySelectorAll('input[name="ipoObservation"]'));
  const clearButton = container.querySelector('#ipoClearButton');
  const statusEl = container.querySelector('#ipoStatus');
  const safetyNoteEl = container.querySelector('#ipoSafetyNote');

  if (fieldset) fieldset.disabled = !enabled;
  optionInputs.forEach((input) => {
    input.disabled = !enabled;
    input.checked = enabled && input.value === rawObservation;
  });
  if (clearButton) clearButton.disabled = !enabled || rawObservation === null || rawObservation === undefined;

  // Status message: prefer a specific observation-value message when one
  // is selected; otherwise use the state-level message. Never render
  // undefined/[object Object].
  let message;
  if (normalizedState === 'selected' && typeof rawObservation === 'string' && STATUS_MESSAGE[rawObservation]) {
    message = STATUS_MESSAGE[rawObservation];
  } else {
    message = STATUS_MESSAGE[normalizedState] ?? STATUS_MESSAGE.unavailable;
  }
  // Blockers (e.g. "Observation is unavailable while the comparison is
  // blocked.") take precedence when present and the state itself isn't
  // already a specific message.
  const blockerText = _safeArray(rawBlockers).map((b) => _safeText(b)).find(Boolean);
  if ((normalizedState === 'blocked' || normalizedState === 'unavailable') && blockerText) {
    message = blockerText;
  }
  if (statusEl) statusEl.textContent = message;

  if (safetyNoteEl) {
    let note = SAFETY_NOTE;
    if (normalizedState === 'selected' && rawObservation === 'prefer-v2') {
      note = `${SAFETY_NOTE} \u00B7 ${V2_REMINDER}`;
    }
    safetyNoteEl.textContent = note;
  }
}

function _safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Resets the section's display to the unavailable/empty state without destroying the skeleton. */
export function clearInteractivePreviewObservationDisplay(container) {
  if (!container || container.dataset.ipoLayoutBuilt !== '1') return;
  renderInteractivePreviewObservationV2(container, { state: 'unavailable', observation: null, warnings: [], metadata: { blockers: [] } });
}
