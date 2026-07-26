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

function _currentLocale() {
  const htmlLang = document.documentElement.lang;
  return htmlLang === 'en' ? 'en' : 'th';
}

function _readAppVersion() {
  const el = document.getElementById('aiWorkflowHeaderVersion');
  return el && el.textContent ? el.textContent.trim() : 'unknown';
}

async function _bootstrap() {
  const navBtn = document.getElementById('calibrationLabNavBtn');
  const root = document.getElementById('calibrationLabRoot');
  if (!navBtn || !root) return; // index.html markup not present -- nothing to wire.

  const controller = createCalibrationLabController({ locale: _currentLocale(), appVersion: _readAppVersion() });
  await controller.init();

  const ui = mountCalibrationLabUI(root, controller, { getLocale: _currentLocale });

  navBtn.addEventListener('click', () => {
    controller.setLocale(_currentLocale());
    ui.open();
  });

  // Reactive locale updates while the Lab is open -- observes the
  // standard `<html lang>` attribute only; never reads app.js internals.
  const langObserver = new MutationObserver(() => {
    controller.setLocale(_currentLocale());
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootstrap);
} else {
  _bootstrap();
}
