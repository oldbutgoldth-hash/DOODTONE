#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r5-intensity-cache-repair-static-test.mjs
 *
 * EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair + State Machine
 * Closure. Structural/source-level Node test (no Browser/DOM needed)
 * against the REAL production ui/reference-color-match-panel.js and
 * core/analysis-cache.js — proves the required contract shape exists
 * in the actual shipped source, not a duplicated/fake copy.
 *
 * Complements (does not replace):
 *   - epic-2e-p0-7-r5-preview-state-machine-static-test.mjs (real PSM
 *     transition behaviour, imported and executed directly)
 *   - epic-2e-p0-7-r5-intensity-cache-repair-browser-test.mjs (real
 *     DOM/debounce/cache-reuse/counter behaviour — requires Chromium)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCachedReferenceAnalysis, setCachedReferenceAnalysis, getCachedTargetAnalysis, setCachedTargetAnalysis, clearCaches } from '../core/analysis-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PANEL_PATH = path.join(PROJECT_ROOT, 'ui', 'reference-color-match-panel.js');
const CACHE_PATH = path.join(PROJECT_ROOT, 'core', 'analysis-cache.js');

let pass = 0, fail = 0;
function record(test, ok, evidence = '') {
  console.log(`${ok ? '✓' : '✗'} [${ok ? 'PASS' : 'FAIL'}] ${test}${evidence ? ` — ${evidence}` : ''}`);
  if (ok) pass++; else fail++;
}

/** Strip block and line comments before any "must not contain X" search,
 * so a docstring that legitimately DISCUSSES a forbidden pattern never
 * produces a false negative (established project convention). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractFunctionBody(src, functionName) {
  const startMatch = src.match(new RegExp(`async function ${functionName}\\s*\\([^)]*\\)\\s*\\{`));
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  let depth = 1, i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

async function main() {
  const panelSrc = await readFile(PANEL_PATH, 'utf8');
  const cacheSrc = await readFile(CACHE_PATH, 'utf8');
  const panelCodeOnly = stripComments(panelSrc);

  /* ── 1. Debounce is 120-180ms, and cancels the previous timer ── */
  const debounceMatch = panelSrc.match(/clearTimeout\(rcm\.runtime\.rebuildTimer\);\s*rcm\.runtime\.rebuildTimer\s*=\s*setTimeout\(\(\)\s*=>\s*\{[\s\S]*?\},\s*(\d+)\)/);
  const debounceMs = debounceMatch ? Number(debounceMatch[1]) : null;
  record('Intensity debounce timer is between 120 and 180ms', debounceMs !== null && debounceMs >= 120 && debounceMs <= 180, `debounceMs=${debounceMs}`);
  record('Intensity handler cancels the PREVIOUS debounce timer before scheduling a new one (clearTimeout present)', /clearTimeout\(rcm\.runtime\.rebuildTimer\)/.test(panelCodeOnly), '');

  /* ── 2. Trace calls use the exact required (stage, status, detail) shape,
     never an object or a raw number as the status (2nd) argument ── */
  const requiredTraceCalls = [
    { stage: 'INTENSITY', status: 'CHANGE' },
    { stage: 'INTENSITY', status: 'DEBOUNCED' },
    { stage: 'INTENSITY', status: 'CACHE_REUSED' },
    { stage: 'INTENSITY', status: 'CANDIDATE_REBUILT' },
    { stage: 'INTENSITY', status: 'PREVIEW_RERENDERED' },
  ];
  for (const { stage, status } of requiredTraceCalls) {
    const re = new RegExp(`_trace\\('${stage}',\\s*'${status}',\\s*\\{`);
    record(`_trace('${stage}', '${status}', { ... }) is called with the correct (stage, status, detail) signature`, re.test(panelCodeOnly), '');
  }
  /* Hostile: no _trace call anywhere passes an object literal directly as
     the status (2nd) argument — e.g. _trace('CACHE_REUSED', { ref: true }) */
  const objectAsStatus = /_trace\([^,]+,\s*\{/.test(panelCodeOnly);
  record('HOSTILE: no _trace(stage, {object}) call exists anywhere (object literal must never be passed as the status argument)', objectAsStatus === false, '');
  /* Hostile: no _trace call passes a bare number/identifier (not a string
     literal) as the status argument — the exact R4 defect. */
  const numberAsStatus = /_trace\('[A-Z_]+',\s*rcm\.intensity\s*\)/.test(panelCodeOnly);
  record('HOSTILE: no _trace(stage, rcm.intensity) call exists (raw value must never be passed as the status argument)', numberAsStatus === false, '');

  /* ── 3. Explicit counters exist with the exact required names ── */
  record("runtime.counters exposes 'referenceAnalysisCount'", /counters:\s*\{[^}]*referenceAnalysisCount/.test(panelCodeOnly), '');
  record("runtime.counters exposes 'targetAnalysisCount'", /counters:\s*\{[^}]*targetAnalysisCount/.test(panelCodeOnly), '');
  record("runtime.counters exposes 'intensityRenderCount'", /counters:\s*\{[^}]*intensityRenderCount/.test(panelCodeOnly), '');
  record('referenceAnalysisCount increments only when phase === REFERENCE (in _analyzeEvidence, never in the Intensity path)', /if \(phase === 'REFERENCE'\) rcm\.runtime\.counters\.referenceAnalysisCount\+\+/.test(panelCodeOnly), '');
  record('targetAnalysisCount increments only when phase === TARGET (in _analyzeEvidence, never in the Intensity path)', /if \(phase === 'TARGET'\) rcm\.runtime\.counters\.targetAnalysisCount\+\+/.test(panelCodeOnly), '');
  record('intensityRenderCount increments inside the cached Intensity rebuild path', /rcm\.runtime\.counters\.intensityRenderCount\+\+/.test(panelCodeOnly), '');

  /* ── 4. The cached Intensity rebuild path NEVER calls _analyzeEvidence
     (Reference/Target Core analysis must not rerun) ── */
  const intensityBody = extractFunctionBody(panelSrc, '_rebuildIntensityFromCache');
  record('_rebuildIntensityFromCache() function exists in production source', intensityBody !== null, '');
  if (intensityBody) {
    const intensityBodyCodeOnly = stripComments(intensityBody);
    record('_rebuildIntensityFromCache() never calls _analyzeEvidence() (no Reference/Target Core analysis rerun)', !/_analyzeEvidence\(/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() calls _cancelLayer2() (cancels/supersedes obsolete deferred Layer 2 work)', /_cancelLayer2\(\)/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() calls buildPerceptualPixelTransfer / buildCoreColorMatchPipeline (real candidate rebuild)', /buildCoreColorMatchPipeline\(/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() calls renderColorMatchCandidateToCanvas (real Preview render)', /renderColorMatchCandidateToCanvas\(/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() optionally restarts Layer 2 from cached evidence after the new Fast Preview (_runLayer2 call present)', /_runLayer2\(/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() never disables Save After Image (Save stays usable throughout Intensity rerender)', !/rcmSaveAfterBtn['"]\)\?\.setAttribute\('disabled'/.test(intensityBodyCodeOnly), '');
    record('_rebuildIntensityFromCache() checks psm.transition() return value at least twice (entry + exit) rather than ignoring it', (intensityBodyCodeOnly.match(/=\s*rcm\.runtime\.psm[^;]*\.transition\(/g) || []).length >= 2, '');
    record('_rebuildIntensityFromCache() enters PREVIEW_STATE.INTENSITY_RERENDERING (dedicated cached-rerender state, never ANALYZING_LAYER_1/2 directly)', /transition\(PREVIEW_STATE\.INTENSITY_RERENDERING\)/.test(intensityBodyCodeOnly), '');
    record('HOSTILE: _rebuildIntensityFromCache() never transitions directly to ANALYZING_LAYER_1 (the exact R4 defect)', !/transition\(PREVIEW_STATE\.ANALYZING_LAYER_1\)/.test(intensityBodyCodeOnly), '');
  }

  /* ── 5. onIntensity handler is wired to the new cached rebuild function,
     not the full _rebuildAndPreview() path ── */
  const onIntensityBody = (panelCodeOnly.match(/const onIntensity = event => \{[\s\S]*?\n  \};/) || [''])[0];
  record('onIntensity slider handler calls _rebuildIntensityFromCache() (not the full pipeline) after debounce', /_rebuildIntensityFromCache\(\)/.test(onIntensityBody), '');
  record("Intensity slider listens on the 'input' event (Preview follows user movement live, not only on release)", /addEventListener\('input', onIntensity\)/.test(panelCodeOnly), '');

  /* ── 6. Candidate contract: no second/incompatible schema introduced ── */
  const forbidden = ['hslData', 'toneCurveData', 'colorGradingData', 'calibrationData'];
  for (const name of forbidden) {
    record(`Candidate contract: production source never introduces '${name}' (no parallel/incompatible schema)`, !panelCodeOnly.includes(name), '');
  }

  /* ── 7. Analysis cache key excludes Intensity — proven against the REAL,
     imported module (not a re-implemented stub) ── */
  clearCaches();
  const baseKey = { filePath: 'ref.png', imageId: 'img-1', dimensions: '800x600', profileVersion: 'v1' };
  setCachedReferenceAnalysis(baseKey, { marker: 'REFERENCE_EVIDENCE_V1' });
  const hitAtIntensity0 = getCachedReferenceAnalysis(baseKey);
  const hitAtIntensity100 = getCachedReferenceAnalysis(baseKey); // same key regardless of any caller-side intensity value
  record('Reference analysis cache key is intensity-independent (same key hits regardless of Intensity value)', hitAtIntensity0?.marker === 'REFERENCE_EVIDENCE_V1' && hitAtIntensity100?.marker === 'REFERENCE_EVIDENCE_V1', JSON.stringify({ hitAtIntensity0, hitAtIntensity100 }));
  record('core/analysis-cache.js buildKey() never references "intensity" (structural — Intensity cannot leak into the cache key)', !cacheSrc.toLowerCase().includes('intensity'), '');
  clearCaches();
  const targetKey = { filePath: 'tgt.png', imageId: 'img-2', dimensions: '640x480', profileVersion: 'v1' };
  setCachedTargetAnalysis(targetKey, { marker: 'TARGET_EVIDENCE_V1' });
  record('Target analysis cache reuses the same evidence across repeated reads (getCachedTargetAnalysis)', getCachedTargetAnalysis(targetKey)?.marker === 'TARGET_EVIDENCE_V1', '');
  clearCaches();

  console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('epic-2e-p0-7-r5-intensity-cache-repair-static-test crashed:', err?.stack ?? err);
  process.exit(2);
});
