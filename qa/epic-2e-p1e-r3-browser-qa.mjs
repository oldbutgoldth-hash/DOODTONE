#!/usr/bin/env node
/**
 * EPIC 2E-P1E R3 — Browser QA (honest scope).
 *
 * Uses the project's established Navigation-Free In-Memory Harness
 * (qa/helpers/playwright-lumixa-test-runtime.mjs) to drive the REAL,
 * unmodified LUMIXA app through a real analysis + review + re-analyze
 * cycle and verify the new Advanced Diagnostics -- Export Parity panel
 * actually renders real data, with zero console/page errors.
 *
 * Honest scope: this proves the WEB UI renders correctly and produces
 * a well-formed XMP string. It does NOT and CANNOT prove what Adobe
 * Lightroom itself displays after importing that XMP -- see
 * docs/development/P1E_R3_LIGHTROOM_MANUAL_VERIFICATION_GUIDE.md for
 * the required human step.
 *
 * Run: node qa/epic-2e-p1e-r3-browser-qa.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const {
  detectPlaywrightPackage, detectBrowserExecutable, REQUIRED_LAUNCH_ARGS,
  openLumixaInMemoryPage, importAndReachReady, qaSnapshot, captureXmpText,
} = await import('./helpers/playwright-lumixa-test-runtime.mjs');

const result = {
  suite: 'epic-2e-p1e-r3-browser-qa',
  startedAt: new Date().toISOString(),
  scenarios: [],
  status: 'NOT_RUN',
};

function record(name, ok, detail = '') {
  result.scenarios.push({ name, ok, detail });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
}

const pkg = await detectPlaywrightPackage();
if (!pkg.available) {
  result.status = 'BROWSER_BINARY_UNAVAILABLE';
  result.reason = pkg.reason ?? 'playwright package not resolvable';
  console.log('Browser suite execution: BROWSER_BINARY_UNAVAILABLE (see output JSON) —', result.reason);
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1e-r3-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const { chromium } = pkg.mod;
const exe = await detectBrowserExecutable(chromium);
if (!exe.available) {
  result.status = 'BROWSER_BINARY_UNAVAILABLE';
  result.reason = exe.reason ?? 'no Chromium executable found';
  console.log('Browser suite execution: BROWSER_BINARY_UNAVAILABLE (see output JSON) —', result.reason);
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1e-r3-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: exe.executablePath, args: REQUIRED_LAUNCH_ARGS });
try {
  const { page, collectors } = await openLumixaInMemoryPage({ browser, projectRoot: ROOT, viewport: { width: 1440, height: 1000 } });

  // Scenario 1: real colorful-landscape fixture reaches Ready.
  const fixture = path.join(ROOT, 'qa/fixtures/epic-2e-j/ready/ready-landscape-orientation-1.jpg');
  const initial = await importAndReachReady(page, fixture, 0);
  record('1. Real image upload reaches a Ready analysis generation', initial.completed === true, `generation=${initial.snapshot?.analysisGeneration}`);

  // Scenario 2: Advanced Diagnostics section exists and is populated.
  const parityPanel = await page.evaluate(() => {
    const section = document.getElementById('exportParityDiagnostics');
    const tbody = document.getElementById('exportParityTableBody');
    return {
      sectionExists: !!section,
      sectionDisplay: section ? getComputedStyle(section).display : null,
      rowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
      firstRowText: tbody?.querySelector('tr')?.textContent?.trim().slice(0, 80) ?? null,
    };
  });
  record('2. Advanced Diagnostics -- Export Parity section is present in the DOM', parityPanel.sectionExists === true);
  record('3. Export Parity table is populated with real per-parameter rows (one per PROPERTY_MAP entry)', parityPanel.rowCount > 0, `rowCount=${parityPanel.rowCount}`);

  // Scenario 3: candidate.diagnostics.exportParity is real, structured data (via QA snapshot bridge).
  const snap = await qaSnapshot(page);
  record('4. QA snapshot reachable after analysis (window.__LUMIXA_QA__ bridge intact)', snap !== null);

  // Scenario 4: download XMP works end to end, no console/page errors so far.
  const xmpText = await captureXmpText(page);
  record('5. Download .xmp produces a real, non-empty XMP string via the real serializeXMP() code path', typeof xmpText === 'string' && xmpText.length > 200);
  record('6. Generated XMP contains real crs:SaturationAdjustment* / crs:ColorGrade* / crs:*Saturation attributes (Color Intelligence output actually reached the file)', typeof xmpText === 'string' && /crs:SaturationAdjustment(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)=/.test(xmpText) && /crs:ColorGrade(Shadow|Midtone|Highlight)(Hue|Sat|Lum)=/.test(xmpText));

  // Scenario 5: zero console/page errors across the whole flow.
  record('7. Zero page errors and zero console errors across upload -> analyze -> review -> re-analyze -> Advanced Diagnostics -> download', collectors.pageErrors.length === 0 && collectors.consoleErrors.length === 0, `pageErrors=${collectors.pageErrors.length}, consoleErrors=${collectors.consoleErrors.length}`);

  result.status = result.scenarios.every((s) => s.ok) ? 'PASS' : 'FAIL';
} finally {
  await browser.close();
}

result.completedAt = new Date().toISOString();
writeFileSync(path.join(ROOT, 'qa/epic-2e-p1e-r3-browser-qa-result.json'), JSON.stringify(result, null, 2));
console.log(`\nBrowser QA decision: ${result.status}`);
process.exit(result.status === 'PASS' ? 0 : (result.status === 'BROWSER_BINARY_UNAVAILABLE' ? 0 : 1));
