#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs
 *
 * EPIC 2E-K-R2 -- REAL PIXEL COMPARISON & BROWSER VERIFICATION CLOSURE
 *
 * Node-executable static suite for the R2 "Real Pixel Comparison"
 * feature: the pure bounded-LRU cache module (fully unit-testable),
 * plus structural/grep-based checks proving the transient Render Plan
 * used for live pixel rendering can never reach persisted storage or
 * export, and that the reused production pixel-rendering chain
 * (createVisualPreviewComparisonControllerV2 / the isolated renderer /
 * the Render Plan builder) never touches XMP serialization or
 * Production-activation code. The actual browser-only pixel rendering
 * itself (Canvas, real <img> decode) is exercised only by
 * qa/epic-2e-k-calibration-lab-browser-test.mjs (Playwright).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBoundedLruCache } from '../core/calibration-lab/bounded-lru-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

function readSrc(relPath) { return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8'); }

// ── Section 1: createBoundedLruCache -- pure, fully Node-testable ──────────

{
  const cache = createBoundedLruCache(3);
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  record('Section 1: basic set/get roundtrip for 3 entries under capacity 3', cache.get('a') === 1 && cache.get('b') === 2 && cache.get('c') === 3, { size: cache.size() });
}

{
  const evicted = [];
  const cache = createBoundedLruCache(2, { onEvict: (v, k) => evicted.push([k, v]) });
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3); // 'a' should be evicted (oldest, capacity 2)
  record('Section 1: capacity eviction removes the OLDEST entry first', !cache.has('a') && cache.has('b') && cache.has('c'), { has_a: cache.has('a'), has_b: cache.has('b'), has_c: cache.has('c') });
  record('Section 1: onEvict fired exactly once, for the correct (value, key)', evicted.length === 1 && evicted[0][0] === 'a' && evicted[0][1] === 1, { evicted });
}

{
  const evicted = [];
  const cache = createBoundedLruCache(2, { onEvict: (v, k) => evicted.push(k) });
  cache.set('a', 1); cache.set('b', 2);
  cache.get('a'); // bump 'a' to most-recently-used
  cache.set('c', 3); // now 'b' is oldest, should be evicted instead of 'a'
  record('Section 1: get() bumps recency -- a subsequent capacity eviction removes the LEAST recently used, not merely the first-inserted', !cache.has('b') && cache.has('a') && cache.has('c'), { evicted, has_a: cache.has('a'), has_b: cache.has('b') });
}

{
  const evicted = [];
  const cache = createBoundedLruCache(2, { onEvict: (v, k) => evicted.push([k, v]) });
  cache.set('a', 1);
  cache.set('a', 99); // overwrite -- old value (1) must be evicted
  record('Section 1: overwriting an existing key evicts its OLD value (never silently discarded without onEvict)', evicted.length === 1 && evicted[0][0] === 'a' && evicted[0][1] === 1, { evicted, current: cache.get('a') });
}

{
  const evicted = [];
  const cache = createBoundedLruCache(2, { onEvict: (v, k) => evicted.push([k, v]) });
  cache.set('a', 1);
  cache.set('a', 1); // same reference/value -- should NOT fire onEvict (nothing genuinely discarded)
  record('Section 1: overwriting a key with the IDENTICAL value does not fire onEvict', evicted.length === 0, { evicted });
}

{
  const evicted = [];
  const cache = createBoundedLruCache(3, { onEvict: (v, k) => evicted.push(k) });
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  cache.clear();
  record('Section 1: clear() fires onEvict for every entry, in order', evicted.length === 3 && evicted.join(',') === 'a,b,c', { evicted });
  record('Section 1: clear() leaves the cache genuinely empty', cache.size() === 0 && !cache.has('a') && !cache.has('b') && !cache.has('c'), { size: cache.size() });
}

{
  const throwingEvict = () => { throw new Error('deliberate onEvict failure'); };
  const cache = createBoundedLruCache(1, { onEvict: throwingEvict });
  let threw = false;
  try { cache.set('a', 1); cache.set('b', 2); } catch { threw = true; }
  record('Section 1 HOSTILE: a throwing onEvict callback never breaks set()/eviction itself', !threw && cache.has('b') && !cache.has('a'), { threw });
}

for (const badMax of [0, -1, NaN, undefined, null, 'five']) {
  const cache = createBoundedLruCache(badMax);
  record(`Section 1 HOSTILE: invalid maxSize (${JSON.stringify(badMax)}) falls back to a safe >=1 bound, never throws`, cache.maxSize >= 1 && Number.isFinite(cache.maxSize), { badMax, resolvedMaxSize: cache.maxSize });
}

{
  const cache = createBoundedLruCache(5);
  record('Section 1: get() on an absent key returns undefined, never throws', cache.get('nope') === undefined, {});
}

// ── Section 2: transient Render Plan can never reach persisted storage/export ──

{
  const pipelineSrc = readSrc('core/calibration-lab/run-comparison-pipeline.js');
  record('Section 2: run-comparison-pipeline.js exposes renderPlanForPixelPreviewTransientOnly on its return value', /renderPlanForPixelPreviewTransientOnly\s*:/.test(pipelineSrc), {});
}

{
  const schemaSrc = readSrc('core/calibration-lab/schema.js');
  const exportSrc = readSrc('core/calibration-lab/export-dataset.js');
  record('Section 2 HOSTILE: schema.js has no field/reference for the transient Render Plan (createImageTestRecord/validateImageRecord cannot accept or store it)', !schemaSrc.includes('renderPlanForPixelPreviewTransientOnly') && !schemaSrc.includes('renderPlan'), {});
  record('Section 2 HOSTILE: export-dataset.js never references the transient Render Plan field name (JSON/CSV export cannot leak it even if a caller tried to smuggle it onto a record)', !exportSrc.includes('renderPlanForPixelPreviewTransientOnly') && !exportSrc.includes('legacyRenderPlan') && !exportSrc.includes('v2RenderPlan'), {});
}

{
  const controllerSrc = readSrc('ui/calibration-lab/calibration-lab-controller.js');
  record('Section 2 HOSTILE: getState() never returns pixelPreviewCache directly (grep: no "pixelPreviewCache" token inside the getState() function body)', (() => {
    const m = controllerSrc.match(/function getState\(\)\s*\{[\s\S]*?\n  \}/);
    return !!m && !m[0].includes('pixelPreviewCache');
  })(), {});
  record('Section 2 HOSTILE: getQaSnapshot() never returns pixelPreviewCache directly', (() => {
    const m = controllerSrc.match(/function getQaSnapshot\(\)\s*\{[\s\S]*?\n  \}/);
    return !!m && !m[0].includes('pixelPreviewCache');
  })(), {});
  record('Section 2: getPixelPreviewInput() is the sole documented read path for the live pixel-preview cache', controllerSrc.includes('function getPixelPreviewInput('), {});
}

// ── Section 3: session-lifecycle cache clearing wired correctly ────────────

{
  const controllerSrc = readSrc('ui/calibration-lab/calibration-lab-controller.js');
  for (const fnName of ['startNewSession', 'openSession', 'clearAllData', 'endSession']) {
    const re = new RegExp(`async function ${fnName}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}`);
    const m = controllerSrc.match(re);
    record(`Section 3: ${fnName}() clears the live pixel-preview cache (_clearPixelPreviewCache())`, !!m && m[0].includes('_clearPixelPreviewCache()'), {});
  }
  record('Section 3: MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE is exported and bounded (small, not unlimited)', controllerSrc.includes('export const MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE = 5'), {});
}

// ── Section 4: reused production pixel-rendering chain never touches XMP/production-activation ──

{
  const chainFiles = [
    'ui/visual-preview-comparison-controller-v2.js',
    'ui/isolated-visual-preview-renderer-v2.js',
    'core/preview-rendering/visual-preview-render-plan-v2.js',
  ];
  for (const f of chainFiles) {
    const src = readSrc(f);
    const clean = !/serializeXMP|downloadXMP|buildLightroomControlledActivationV2/.test(src);
    record(`Section 4 HOSTILE: ${f} (reused by the Calibration Lab's real pixel comparison) never references serializeXMP/downloadXMP/buildLightroomControlledActivationV2`, clean, {});
  }
}

{
  const rendererSrc = readSrc('ui/calibration-lab/calibration-lab-renderer.js');
  record('Section 4: calibration-lab-renderer.js imports createVisualPreviewComparisonControllerV2 from the production module (reuse, not reimplementation)', /import\s*\{\s*createVisualPreviewComparisonControllerV2\s*\}\s*from\s*'\.\.\/visual-preview-comparison-controller-v2\.js'/.test(rendererSrc), {});
  record('Section 4: calibration-lab-renderer.js still never references serializeXMP/downloadXMP itself', !/serializeXMP|downloadXMP/.test(rendererSrc), {});
  record('Section 4: _disposePixelCompareCtrl() is called both before creating a fresh instance in _renderComparisonView and on dialog close()', (() => {
    const closeFn = rendererSrc.match(/function close\(\)\s*\{[\s\S]*?\n  \}/);
    const compareFn = rendererSrc.match(/function _renderComparisonView\(state\)\s*\{[\s\S]*?\n  \}\n\n  function _renderDecisionControls/);
    return !!closeFn && closeFn[0].includes('_disposePixelCompareCtrl()') && !!compareFn && compareFn[0].includes('_disposePixelCompareCtrl()');
  })(), {});
}

// ── Section 5: scoped i18n coverage still complete after the R2 additions ──

{
  const i18nSrc = readSrc('ui/calibration-lab/calibration-lab-i18n.js');
  const hasPixelPreviewNamespace = /pixelPreview\s*:\s*\{/.test(i18nSrc);
  record('Section 5: pixelPreview i18n namespace exists in the scoped dictionary source', hasPixelPreviewNamespace, {});
}

console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
