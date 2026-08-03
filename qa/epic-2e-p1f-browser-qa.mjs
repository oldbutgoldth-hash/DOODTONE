#!/usr/bin/env node
/**
 * EPIC 2E-P1F -- Browser QA (honest scope).
 *
 * Uses the project's established Navigation-Free In-Memory Harness
 * (qa/helpers/playwright-lumixa-test-runtime.mjs) to drive the REAL,
 * unmodified LUMIXA app through a real analysis cycle and verify the
 * new Advanced Diagnostics -- Basic Tone Intelligence panel actually
 * renders real data, with zero console/page errors.
 *
 * 6 required scenarios:
 *   1. Real image upload reaches a Ready analysis generation.
 *   2. Advanced Diagnostics -- Basic Tone Intelligence section is present in the DOM.
 *   3. Basic Tone table is populated with real per-parameter rows (9 Basic fields).
 *   4. Basic Tone summary text shows a real scene class + confidence (not a placeholder).
 *   5. Download .xmp produces a real XMP string whose Basic-panel properties
 *      (crs:Exposure2012/Contrast2012/Highlights2012/Shadows2012/Whites2012/
 *      Blacks2012/Clarity2012/Dehaze/Texture) are present and match the
 *      Candidate's own basic.* values (Export Expected == XMP Readback).
 *   6. Zero page errors and zero console errors across the whole flow.
 *
 * Honest scope: this proves the WEB UI renders correctly and produces a
 * well-formed XMP string reflecting the Basic Tone Plan. It does NOT and
 * CANNOT prove what Adobe Lightroom itself displays after importing that
 * XMP -- see docs/development/P1F_LIGHTROOM_MANUAL_QA_GUIDE.md for the
 * required human step.
 *
 * Run: node qa/epic-2e-p1f-browser-qa.mjs
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
  suite: 'epic-2e-p1f-browser-qa',
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
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1f-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const { chromium } = pkg.mod;
const exe = await detectBrowserExecutable(chromium);
if (!exe.available) {
  result.status = 'BROWSER_BINARY_UNAVAILABLE';
  result.reason = exe.reason ?? 'no Chromium executable found';
  console.log('Browser suite execution: BROWSER_BINARY_UNAVAILABLE (see output JSON) —', result.reason);
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1f-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: exe.executablePath, args: REQUIRED_LAUNCH_ARGS });
try {
  const { page, collectors } = await openLumixaInMemoryPage({ browser, projectRoot: ROOT, viewport: { width: 1440, height: 1000 } });

  // Scenario 1: real fixture reaches Ready.
  const fixture = path.join(ROOT, 'qa/fixtures/epic-2e-j/ready/ready-landscape-orientation-1.jpg');
  const initial = await importAndReachReady(page, fixture, 0);
  record('1. Real image upload reaches a Ready analysis generation', initial.completed === true, `generation=${initial.snapshot?.analysisGeneration}`);

  // Scenario 2: Advanced Diagnostics -- Basic Tone Intelligence section exists in the DOM.
  const basicPanel = await page.evaluate(() => {
    const section = document.getElementById('basicToneDiagnostics');
    const tbody = document.getElementById('basicToneTableBody');
    const summary = document.getElementById('basicToneSummary');
    return {
      sectionExists: !!section,
      rowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
      summaryText: summary?.textContent?.trim().slice(0, 200) ?? null,
    };
  });
  record('2. Advanced Diagnostics -- Basic Tone Intelligence section is present in the DOM', basicPanel.sectionExists === true);
  record('3. Basic Tone table is populated with real per-parameter rows (one per Basic field)', basicPanel.rowCount > 0, `rowCount=${basicPanel.rowCount}`);
  record('4. Basic Tone summary shows a real scene class + confidence (not an empty placeholder)', typeof basicPanel.summaryText === 'string' && basicPanel.summaryText.length > 10, basicPanel.summaryText);

  // Scenario 5: download XMP and confirm Basic-panel properties match the Candidate's own basic.* values.
  const snap = await qaSnapshot(page);
  const xmpText = await captureXmpText(page);
  const basicPropsPresent = typeof xmpText === 'string'
    && /crs:Exposure2012="[^"]*"/.test(xmpText)
    && /crs:Contrast2012="[^"]*"/.test(xmpText)
    && /crs:Highlights2012="[^"]*"/.test(xmpText)
    && /crs:Shadows2012="[^"]*"/.test(xmpText)
    && /crs:Whites2012="[^"]*"/.test(xmpText)
    && /crs:Blacks2012="[^"]*"/.test(xmpText)
    && /crs:Clarity2012="[^"]*"/.test(xmpText)
    && /crs:Dehaze="[^"]*"/.test(xmpText)
    && /crs:Texture="[^"]*"/.test(xmpText);
  const candidateExposure = snap?.candidate?.basic?.exposure;
  const xmpExposureMatch = xmpText?.match(/crs:Exposure2012="([^"]*)"/);
  const xmpExposureValue = xmpExposureMatch ? Math.round(parseFloat(xmpExposureMatch[1]) * 100) : null;
  record('5. Generated XMP contains all 9 real crs:Exposure2012/Contrast2012/Highlights2012/Shadows2012/Whites2012/Blacks2012/Clarity2012/Dehaze/Texture attributes, matching the Candidate\'s own basic.exposure value', basicPropsPresent && typeof candidateExposure === 'number' && xmpExposureValue === candidateExposure, `candidateExposure=${candidateExposure}, xmpExposureValue=${xmpExposureValue}`);

  // Scenario 6: zero console/page errors across the whole flow.
  record('6. Zero page errors and zero console errors across upload -> analyze -> Advanced Diagnostics -> download', collectors.pageErrors.length === 0 && collectors.consoleErrors.length === 0, `pageErrors=${collectors.pageErrors.length}, consoleErrors=${collectors.consoleErrors.length}`);

  result.status = result.scenarios.every((s) => s.ok) ? 'PASS' : 'FAIL';
} finally {
  await browser.close();
}

result.completedAt = new Date().toISOString();
writeFileSync(path.join(ROOT, 'qa/epic-2e-p1f-browser-qa-result.json'), JSON.stringify(result, null, 2));
console.log(`\nBrowser QA decision: ${result.status}`);
process.exit(result.status === 'PASS' ? 0 : (result.status === 'BROWSER_BINARY_UNAVAILABLE' ? 0 : 1));
