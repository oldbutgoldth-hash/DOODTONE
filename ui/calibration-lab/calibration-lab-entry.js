/**
 * ui/calibration-lab/calibration-lab-entry.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Bootstraps the entire Calibration Lab feature: creates its own
 * controller + storage, mounts its own renderer into `#calibrationLabRoot`,
 * and wires the `#calibrationLabNavBtn` nav button `index.html` provides.
 *
 * ZERO imports from, or edits to, `ui/app.js` -- this file is loaded by
 * its own `<script type="module">` tag placed AFTER app.js's tag in
 * index.html, so it runs after app.js has finished its own module-level
 * setup (ES module scripts execute in document order). It reads the
 * CURRENT UI language reactively via a `MutationObserver` on
 * `document.documentElement`'s standard `lang` attribute (which
 * `ui/app.js`'s own `setLang()` already updates for accessibility) --
 * this is the only "connection" to the main app, and it is read-only.
 *
 * `window.__LUMIXA_QA__` is EXTENDED at runtime (never edited in
 * source) with `getCalibrationLabSnapshot()`, preserving whatever
 * `ui/app.js` already assigned to that global.
 */

import { createCalibrationLabController } from './calibration-lab-controller.js';
import { mountCalibrationLabUI } from './calibration-lab-renderer.js';
import { calibrationLabT } from './calibration-lab-i18n.js';

function _currentLocale() {
  const htmlLang = document.documentElement.lang;
  return htmlLang === 'en' ? 'en' : 'th';
}

function _readAppVersion() {
  const el = document.getElementById('aiWorkflowHeaderVersion');
  return el && el.textContent ? el.textContent.trim() : 'unknown';
}

// EPIC 2E-K-R2-FIX1 -- Section 8: the nav button's visible text,
// `title`, and `aria-label` must NEVER be a hardcoded English string
// in index.html's markup (the exact reported defect: the Thai UI kept
// showing "CALIBRATION LAB" verbatim) -- this is the ONLY place any of
// those three attributes are ever set, and it is called both at
// bootstrap and on every genuine language change, so the button always
// reflects the CURRENT `<html lang>`, never a stale/default value.
function _applyNavButtonLabel(navBtn) {
  const label = calibrationLabT('nav.openButton', _currentLocale());
  // Preserve the existing icon <span> (if index.html's markup still
  // has one) -- only the trailing text node is ever replaced/added, so
  // this never fights with the icon's own markup.
  const iconSpan = navBtn.querySelector('.material-symbols-outlined');
  navBtn.textContent = '';
  if (iconSpan) navBtn.appendChild(iconSpan);
  navBtn.appendChild(document.createTextNode(label));
  navBtn.title = label;
  navBtn.setAttribute('aria-label', label);
}

async function _bootstrap() {
  const navBtn = document.getElementById('calibrationLabNavBtn');
  const root = document.getElementById('calibrationLabRoot');
  if (!navBtn || !root) return; // index.html markup not present -- nothing to wire.

  const controller = createCalibrationLabController({ locale: _currentLocale(), appVersion: _readAppVersion() });
  await controller.init();

  const ui = mountCalibrationLabUI(root, controller, { getLocale: _currentLocale });

  _applyNavButtonLabel(navBtn);

  navBtn.addEventListener('click', () => {
    controller.setLocale(_currentLocale());
    ui.open();
  });

  // Reactive locale updates while the Lab is open -- observes the
  // standard `<html lang>` attribute only; never reads app.js internals.
  const langObserver = new MutationObserver(() => {
    controller.setLocale(_currentLocale());
    _applyNavButtonLabel(navBtn);
    if (root.classList.contains('cal-open')) ui.render();
  });
  langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // Merge onto the existing QA snapshot global rather than replacing it
  // -- `ui/app.js` sets `window.__LUMIXA_QA__` itself; this script runs
  // after it (document order), so the merge is safe and additive.
  window.__LUMIXA_QA__ = {
    ...(window.__LUMIXA_QA__ || {}),
    getCalibrationLabSnapshot: () => controller.getQaSnapshot(),
  };

  // EPIC 2E-K-R2-FIX1 -- Section 11: exposes the Calibration Lab's OWN
  // controller instance for the Browser QA suite to call DIRECTLY,
  // bypassing the UI entirely -- this is how the hostile test proves
  // saveCurrentDecision() rejects an ineligible decision even when
  // called outside any button click (Section 3's explicit requirement
  // that the gate must never rely on the UI's `disabled` attribute
  // alone). Never read by, or connected to, the main app/Production
  // pipeline -- this is the Calibration Lab's own Preview/Shadow-only
  // controller, the exact same instance the renderer above uses.
  window.__LUMIXA_CAL_LAB_CONTROLLER_FOR_QA__ = controller;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootstrap);
} else {
  _bootstrap();
}
