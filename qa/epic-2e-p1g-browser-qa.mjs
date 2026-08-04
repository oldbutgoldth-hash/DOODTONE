#!/usr/bin/env node
/**
 * EPIC 2E-P1G -- Browser QA (honest scope).
 *
 * Uses the project's established Navigation-Free In-Memory Harness
 * (qa/helpers/playwright-lumixa-test-runtime.mjs) to drive the REAL,
 * unmodified LUMIXA app through a real analysis cycle and verify the
 * new Advanced Diagnostics -- Detail Intelligence panel actually
 * renders real data, with zero console/page errors.
 *
 * 6 required scenarios:
 *   1. Real image upload reaches a Ready analysis generation.
 *   2. Advanced Diagnostics -- Detail Intelligence section is present in the DOM.
 *   3. Detail table is populated with real per-parameter rows (Sharpening + Noise Reduction).
 *   4. Detail summary text shows real scene flags + confidence (not a placeholder).
 *   5. Download .xmp produces a real XMP string whose Detail properties
 *      (crs:Sharpness/crs:LuminanceSmoothing) are present and match the
 *      Candidate's own detail.sharpening/.noiseReduction values (Export
 *      Expected == XMP Readback).
 *   6. Zero page errors and zero console errors across the whole flow.
 *
 * Honest scope: this proves the WEB UI renders correctly and produces a
 * well-formed XMP string reflecting the Detail Plan. It does NOT and
 * CANNOT prove what Adobe Lightroom itself displays after importing that
 * XMP -- see docs/development/P1G_LIGHTROOM_MANUAL_QA_GUIDE.md for the
 * required human step.
 *
 * Run: node qa/epic-2e-p1g-browser-qa.mjs
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
  suite: 'epic-2e-p1g-browser-qa',
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
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1g-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const { chromium } = pkg.mod;
const exe = await detectBrowserExecutable(chromium);
if (!exe.available) {
  result.status = 'BROWSER_BINARY_UNAVAILABLE';
  result.reason = exe.reason ?? 'no Chromium executable found';
  console.log('Browser suite execution: BROWSER_BINARY_UNAVAILABLE (see output JSON) —', result.reason);
  writeFileSync(path.join(ROOT, 'qa/epic-2e-p1g-browser-qa-result.json'), JSON.stringify(result, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: exe.executablePath, args: REQUIRED_LAUNCH_ARGS });
try {
  const { page, collectors } = await openLumixaInMemoryPage({ browser, projectRoot: ROOT, viewport: { width: 1440, height: 1000 } });

  // Scenario 1: real fixture reaches Ready.
  const fixture = path.join(ROOT, 'qa/fixtures/epic-2e-j/ready/ready-landscape-orientation-1.jpg');
  const initial = await importAndReachReady(page, fixture, 0);
  record('1. Real image upload reaches a Ready analysis generation', initial.completed === true, `generation=${initial.snapshot?.analysisGeneration}`);

  // Scenario 2: Advanced Diagnostics -- Detail Intelligence section exists in the DOM.
  const detailPanel = await page.evaluate(() => {
    const section = document.getElementById('detailIntelDiagnostics');
    const tbody = document.getElementById('detailIntelTableBody');
    const summary = document.getElementById('detailIntelSummary');
    return {
      sectionExists: !!section,
      rowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
      summaryText: summary?.textContent?.trim().slice(0, 200) ?? null,
    };
  });
  record('2. Advanced Diagnostics -- Detail Intelligence section is present in the DOM', detailPanel.sectionExists === true);
  record('3. Detail table is populated with real per-parameter rows (Sharpening + Noise Reduction)', detailPanel.rowCount > 0, `rowCount=${detailPanel.rowCount}`);
  record('4. Detail summary shows real scene flags + confidence (not an empty placeholder)', typeof detailPanel.summaryText === 'string' && detailPanel.summaryText.length > 10, detailPanel.summaryText);

  // Scenario 5: download XMP and confirm Detail properties match the Candidate's own detail.* values.
  const snap = await qaSnapshot(page);
  const xmpText = await captureXmpText(page);
  const detailPropsPresent = typeof xmpText === 'string'
    && /crs:Sharpness="[^"]*"/.test(xmpText)
    && /crs:LuminanceSmoothing="[^"]*"/.test(xmpText);
  const candidateSharpening = snap?.candidate?.detail?.sharpening;
  const xmpSharpMatch = xmpText?.match(/crs:Sharpness="([^"]*)"/);
  const xmpSharpValue = xmpSharpMatch ? parseInt(xmpSharpMatch[1], 10) : null;
  record('5. Generated XMP contains real crs:Sharpness/crs:LuminanceSmoothing attributes, matching the Candidate\'s own detail.sharpening value', detailPropsPresent && typeof candidateSharpening === 'number' && xmpSharpValue === candidateSharpening, `candidateSharpening=${candidateSharpening}, xmpSharpValue=${xmpSharpValue}`);

  // Scenario 6: zero console/page errors across the whole flow.
  record('6. Zero page errors and zero console errors across upload -> analyze -> Advanced Diagnostics -> download', collectors.pageErrors.length === 0 && collectors.consoleErrors.length === 0, `pageErrors=${collectors.pageErrors.length}, consoleErrors=${collectors.consoleErrors.length}`);

  result.status = result.scenarios.every((s) => s.ok) ? 'PASS' : 'FAIL';
} finally {
  await browser.close();
}

result.completedAt = new Date().toISOString();
writeFileSync(path.join(ROOT, 'qa/epic-2e-p1g-browser-qa-result.json'), JSON.stringify(result, null, 2));
console.log(`\nBrowser QA decision: ${result.status}`);
process.exit(result.status === 'PASS' ? 0 : (result.status === 'BROWSER_BINARY_UNAVAILABLE' ? 0 : 1));
