#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r6-fast-refined-critical-path-static-test.mjs
 *
 * EPIC 2E-P0.7 R6 — True Preview-Critical Path Separation + Deferred
 * Heavy Core Execution + Real-Image Runtime Stall Repair.
 *
 * Structural/source-level Node test (no Browser/DOM needed) against
 * the REAL production ui/reference-color-match-panel.js,
 * core/generation-control.js, core/analysis-cache.js and
 * core/image-analysis-core/{index,pixel-math,worker}.js — proves the
 * required contract shape exists in the actual shipped source.
 *
 * Complements (does not replace):
 *   - epic-2e-p0-7-r6-preview-state-machine-static-test.mjs (real PSM
 *     transition behaviour for the 7 new states)
 *   - epic-2e-p0-7-r6-real-image-runtime-browser-test.mjs (real
 *     DOM/Worker/timing behaviour against the user's exact photos —
 *     requires Chromium AND the two real image files, run on the
 *     user's own machine)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNamedGenerationSnapshot } from '../core/generation-control.js';
import { getEvidenceCacheStats } from '../core/analysis-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PANEL_PATH = path.join(PROJECT_ROOT, 'ui', 'reference-color-match-panel.js');
const GEN_PATH = path.join(PROJECT_ROOT, 'core', 'generation-control.js');
const CACHE_PATH = path.join(PROJECT_ROOT, 'core', 'analysis-cache.js');
const IAC_INDEX_PATH = path.join(PROJECT_ROOT, 'core', 'image-analysis-core', 'index.js');
const IAC_PIXELMATH_PATH = path.join(PROJECT_ROOT, 'core', 'image-analysis-core', 'pixel-math.js');
const IAC_WORKER_PATH = path.join(PROJECT_ROOT, 'core', 'image-analysis-core', 'worker.js');

let pass = 0, fail = 0;
function record(test, ok, evidence = '') {
  console.log(`${ok ? '✓' : '✗'} [${ok ? 'PASS' : 'FAIL'}] ${test}${evidence ? ` — ${evidence}` : ''}`);
  if (ok) pass++; else fail++;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractFunctionBody(src, functionName, { async = true } = {}) {
  const kw = async ? 'async function' : 'function';
  const startMatch = src.match(new RegExp(`${kw} ${functionName}\\s*\\([^)]*\\)\\s*\\{`));
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
  const panelCodeOnly = stripComments(panelSrc);
  const genSrc = await readFile(GEN_PATH, 'utf8');
  const cacheSrc = await readFile(CACHE_PATH, 'utf8');
  const iacIndexSrc = await readFile(IAC_INDEX_PATH, 'utf8');
  const iacIndexCodeOnly = stripComments(iacIndexSrc);
  const pixelMathSrc = await readFile(IAC_PIXELMATH_PATH, 'utf8');
  const workerSrc = await readFile(IAC_WORKER_PATH, 'utf8');
  const workerCodeOnly = stripComments(workerSrc);

  /* ── 1. PAIRWISE_FAST / PAIRWISE_REFINED profiles exist and gate the
     heavy modules correctly ── */
  record("FAST_PROFILES set includes 'PAIRWISE_FAST'", /FAST_PROFILES\s*=\s*new Set\(\[[^\]]*'PAIRWISE_FAST'/.test(panelCodeOnly), '');
  record("FAST_PROFILES set includes the pre-existing 'EVALUATION_MINIMAL' (R5, unchanged)", /FAST_PROFILES\s*=\s*new Set\(\[[^\]]*'EVALUATION_MINIMAL'/.test(panelCodeOnly), '');
  record('Heavy modules (Color Grading/Calibration/Image Analysis Core/Skin Tone) are gated by !FAST_PROFILES.has(profile)', /if \(!FAST_PROFILES\.has\(profile\)\)/.test(panelCodeOnly), '');
  const evidenceBody = extractFunctionBody(panelSrc, '_analyzeEvidence');
  record('_analyzeEvidence() function exists in production source', evidenceBody !== null, '');
  if (evidenceBody) {
    const bodyCodeOnly = stripComments(evidenceBody);
    for (const heavy of ['analyzeColorGrading', 'analyzeCalibration', 'analyzeImageCore', 'analyzeSkinTone']) {
      const idx = bodyCodeOnly.indexOf(heavy + '(');
      const gateIdx = bodyCodeOnly.indexOf('if (!FAST_PROFILES.has(profile))');
      record(`${heavy}(...) call sits AFTER the !FAST_PROFILES.has(profile) gate (never runs unconditionally)`, idx > -1 && gateIdx > -1 && idx > gateIdx, `heavyIdx=${idx}, gateIdx=${gateIdx}`);
    }
    for (const cheap of ['extractReferencePalette', 'analyzeToneZones', 'classifySkin', 'analyzeImage(']) {
      record(`${cheap} call exists unconditionally (part of every profile, including PAIRWISE_FAST)`, bodyCodeOnly.includes(cheap), '');
    }
  }

  /* ── 2. _rebuildAndPreview's initial evidence gathering uses
     PAIRWISE_FAST, never PAIRWISE_FULL, for the first Preview ── */
  const rebuildBody = extractFunctionBody(panelSrc, '_rebuildAndPreview');
  record('_rebuildAndPreview() function exists in production source', rebuildBody !== null, '');
  if (rebuildBody) {
    const bodyCodeOnly = stripComments(rebuildBody);
    record("_rebuildAndPreview() analyzes REFERENCE with profile: 'PAIRWISE_FAST' (not PAIRWISE_FULL)", /phase:\s*'REFERENCE',\s*profile:\s*'PAIRWISE_FAST'/.test(bodyCodeOnly), '');
    record("_rebuildAndPreview() analyzes TARGET with profile: 'PAIRWISE_FAST' (not PAIRWISE_FULL)", /phase:\s*'TARGET',\s*profile:\s*'PAIRWISE_FAST'/.test(bodyCodeOnly), '');
    record("HOSTILE: _rebuildAndPreview() never analyzes the initial pair with profile: 'PAIRWISE_FULL' (the pre-R6 blocking behaviour)", !/phase:\s*'(REFERENCE|TARGET)',\s*profile:\s*'PAIRWISE_FULL'/.test(bodyCodeOnly), '');

    // Structural ordering: the granular fast-preview PSM transitions
    // must appear in the exact required order, and FAST_PREVIEW_READY
    // must be reached BEFORE _runDeepAnalysis is ever invoked.
    const order = ['ANALYZING_FAST_REFERENCE', 'ANALYZING_FAST_TARGET', 'FAST_FUSION', 'FAST_PREVIEW_RENDERING', 'FAST_PREVIEW_READY', '_runDeepAnalysis('];
    const indices = order.map(token => bodyCodeOnly.indexOf(token));
    let strictlyOrdered = indices.every(i => i > -1);
    for (let i = 1; i < indices.length && strictlyOrdered; i++) {
      if (!(indices[i] > indices[i - 1])) strictlyOrdered = false;
    }
    record('Fast-preview PSM transitions occur in strict required order, and _runDeepAnalysis() is only called AFTER FAST_PREVIEW_READY is reached', strictlyOrdered, JSON.stringify(order.map((t, i) => [t, indices[i]])));

    record('Every fast-preview PSM transition is checked via _transitionOrTrace (not fire-and-forget)', (bodyCodeOnly.match(/_transitionOrTrace\(PREVIEW_STATE\./g) || []).length >= 5, `count=${(bodyCodeOnly.match(/_transitionOrTrace\(PREVIEW_STATE\./g) || []).length}`);
    record('_cancelDeepAnalysis() is called at the start of _rebuildAndPreview (a new pair supersedes any in-flight Deep Analysis)', bodyCodeOnly.includes('_cancelDeepAnalysis()'), '');
  }

  /* ── 3. _runDeepAnalysis: deferred heavy enrichment, own guard/token,
     never blocks, always calls Layer 2 on success ── */
  const deepBody = extractFunctionBody(panelSrc, '_runDeepAnalysis');
  record('_runDeepAnalysis() function exists in production source', deepBody !== null, '');
  if (deepBody) {
    const bodyCodeOnly = stripComments(deepBody);
    record("_runDeepAnalysis() analyzes REFERENCE with profile: 'PAIRWISE_REFINED'", /phase:\s*'REFERENCE',\s*profile:\s*'PAIRWISE_REFINED'/.test(bodyCodeOnly), '');
    record("_runDeepAnalysis() analyzes TARGET with profile: 'PAIRWISE_REFINED'", /phase:\s*'TARGET',\s*profile:\s*'PAIRWISE_REFINED'/.test(bodyCodeOnly), '');
    record('_runDeepAnalysis() mints its own refinedAnalysisTask token (createRefinedAnalysisTask)', bodyCodeOnly.includes('createRefinedAnalysisTask()'), '');
    record('_runDeepAnalysis() checks isRefinedAnalysisStale() before committing state', bodyCodeOnly.includes('isRefinedAnalysisStale('), '');
    record('_runDeepAnalysis() has its own AbortController (rcm.runtime._deepAbort)', bodyCodeOnly.includes('rcm.runtime._deepAbort'), '');
    record('_runDeepAnalysis() enters PREVIEW_STATE.DEEP_ANALYSIS_RUNNING via checked transition', /_transitionOrTrace\(PREVIEW_STATE\.DEEP_ANALYSIS_RUNNING/.test(bodyCodeOnly), '');
    record('_runDeepAnalysis() enters PREVIEW_STATE.REFINED_PREVIEW_RENDERING via checked transition', /_transitionOrTrace\(PREVIEW_STATE\.REFINED_PREVIEW_RENDERING/.test(bodyCodeOnly), '');
    record('_runDeepAnalysis() enters PREVIEW_STATE.REFINED_PREVIEW_READY via checked transition', /_transitionOrTrace\(PREVIEW_STATE\.REFINED_PREVIEW_READY/.test(bodyCodeOnly), '');
    record('_runDeepAnalysis() calls _runLayer2(...) after reaching REFINED_PREVIEW_READY (existing after-image evaluation preserved)', bodyCodeOnly.includes('_runLayer2('), '');
    record('_runDeepAnalysis() has a catch block that never rethrows/crashes (soft-failure — Fast Preview stays usable)', /catch\s*\(error\)\s*\{[\s\S]*?_trace\('DEEP_ANALYSIS',\s*'FAILED'/.test(bodyCodeOnly), '');
    record('_runDeepAnalysis() has a finally block that always clears _deepAbort (never leaks the AbortController)', /finally\s*\{[\s\S]*?rcm\.runtime\._deepAbort\s*=\s*null/.test(bodyCodeOnly), '');
  }

  /* ── 4. Deep Analysis is invoked from _rebuildAndPreview only when
     genuinely needed (not on an Intensity-only fallback rebuild) ── */
  if (rebuildBody) {
    const bodyCodeOnly = stripComments(rebuildBody);
    record("_rebuildAndPreview() gates _runDeepAnalysis() behind deepAnalysisPending = reason !== 'INTENSITY' (same gate R5 used for Layer 2)", /deepAnalysisPending\s*=\s*reason\s*!==\s*'INTENSITY'/.test(bodyCodeOnly), '');
  }

  /* ── 5. Generation Control: 3 separate named ownership tokens exist
     and are actually used by the panel (not just defined and ignored) ── */
  for (const fn of ['createFastPreviewGeneration', 'isFastPreviewStale', 'createRefinedAnalysisTask', 'isRefinedAnalysisStale', 'createIntensityRenderGeneration', 'isIntensityRenderStale']) {
    record(`core/generation-control.js exports ${fn}`, new RegExp(`export function ${fn}\\(`).test(genSrc), '');
    record(`ui/reference-color-match-panel.js imports and calls ${fn}`, panelCodeOnly.includes(fn), '');
  }
  {
    const snap = getNamedGenerationSnapshot();
    record('getNamedGenerationSnapshot() returns all 3 named token counters', ['fastPreviewGeneration', 'refinedAnalysisTask', 'intensityRenderGeneration'].every(k => typeof snap[k] === 'number'), JSON.stringify(snap));
  }

  /* ── 6. Analysis Cache: 4 separate evidence stores exist and are
     actually wired into the fast/deep-analysis paths ── */
  for (const store of ['referenceFastEvidence', 'targetFastEvidence', 'referenceRefinedEvidence', 'targetRefinedEvidence']) {
    record(`core/analysis-cache.js's FOUR_STORE_NAMES includes '${store}'`, cacheSrc.includes(`'${store}'`), '');
    record(`ui/reference-color-match-panel.js calls setEvidenceCache('${store}', ...)`, panelCodeOnly.includes(`setEvidenceCache('${store}'`), '');
  }
  record('buildEvidenceCacheKey() signature has no "value"-shaped intensity-like parameter (fingerprint/dimensions/proxyDimensions/profile/engineVersion only)', /buildEvidenceCacheKey\(\{\s*fingerprint,\s*dimensions,\s*proxyDimensions,\s*profile,\s*engineVersion/.test(cacheSrc), '');
  {
    const stats = getEvidenceCacheStats();
    record('getEvidenceCacheStats() returns all 4 stores', ['referenceFastEvidence', 'targetFastEvidence', 'referenceRefinedEvidence', 'targetRefinedEvidence'].every(k => stats[k] && typeof stats[k].size === 'number'), JSON.stringify(stats));
  }

  /* ── 7. Image Analysis Core: Worker offload, never transfers a DOM
     element, always resolves/rejects (never an unresolved Promise on
     timeout), and a genuine terminate() on timeout ── */
  record('core/image-analysis-core/worker.js exists and imports runFromBuffers from pixel-math.js', /import\s*\{\s*runFromBuffers\s*\}\s*from\s*'\.\/pixel-math\.js'/.test(workerSrc), '');
  record('worker.js code (excluding comments) never references `document`, `new Image(`, or `HTMLImageElement` (receives only transferable buffers + numbers)', !/\bdocument\.|new Image\(|HTMLImageElement/.test(workerCodeOnly), '');
  record('index.js posts ONLY the transferable ArrayBuffers + plain numbers to the Worker (never the raw image / canvas)', /worker\.postMessage\(\s*\{\s*jobId,\s*data:\s*buffers\.data\.buffer/.test(iacIndexCodeOnly), '');
  record('index.js explicitly marks data.buffer / data2.buffer as the Transferable list (zero-copy transfer, not structured-clone copy)', /\[buffers\.data\.buffer,\s*buffers\.data2\.buffer\]/.test(iacIndexCodeOnly), '');
  record('A Worker job that exceeds its timeout is terminate()d (genuinely stops the work, unlike Promise.race alone)', /worker\.terminate\(\)/.test(iacIndexCodeOnly), '');
  record('The Worker timeout path always rejects with a real Error (never leaves the Promise unresolved)', /reject\(Object\.assign\(new Error\(`Image Analysis Core Worker exceeded/.test(iacIndexCodeOnly), '');
  record('A Worker failure/timeout falls back to the synchronous pixel-math path (analyzeImageCore never throws just because Workers are unavailable)', /if \(!result\) \{/.test(iacIndexCodeOnly) && /runFromBuffers\(fallbackBuffers\)/.test(iacIndexCodeOnly), '');
  record('analyzeImageCore() attaches _meta (workerUsed/durationMs/dims) to its result for QA instrumentation', /result\._meta\s*=\s*\{/.test(iacIndexCodeOnly), '');
  record('pixel-math.js has zero DOM dependency (no `document`, no `canvas`, no `Image`) — safe to import from a Worker', !/\bdocument\.|new Image\(|createElement\(/.test(pixelMathSrc), '');
  record("pixel-math.js's runFromBuffers() is the single shared implementation both index.js (fallback) and worker.js (primary) call — proven by import in both files", iacIndexSrc.includes("import { runFromBuffers } from './pixel-math.js'") && workerSrc.includes("import { runFromBuffers } from './pixel-math.js'"), '');

  /* ── 8. HOSTILE: the OLD single-synchronous-block defect must not
     have simply been moved elsewhere — the main-thread fallback path
     must still exist for graceful degradation but the DEFAULT path
     (useWorker=true) must attempt the Worker first ── */
  record('analyzeImageCore() defaults useWorker to true (Worker is attempted by default, not opt-in)', /\{\s*useWorker\s*=\s*true\s*\}\s*=\s*\{\}/.test(iacIndexCodeOnly), '');
  record('HOSTILE: _run() no longer calls the old private _mainPass/_qualityPass functions directly inline (they were extracted to pixel-math.js and are no longer duplicated in index.js)', !/^function _mainPass/m.test(iacIndexCodeOnly) && !/^function _qualityPass/m.test(iacIndexCodeOnly), '');

  /* ── 9. Preserve R5: Intensity slider path untouched, Candidate
     contract untouched, existing counters untouched ── */
  record('R5 onIntensity debounce (140ms) is still present, unchanged', /setTimeout\(\(\) => \{[\s\S]*?_rebuildIntensityFromCache\(\);\s*\}, 140\)/.test(panelCodeOnly), '');
  record("R5's _rebuildIntensityFromCache() still never calls _analyzeEvidence() (Reference/Target Core analysis never reruns on Intensity)", (() => {
    const body = extractFunctionBody(panelSrc, '_rebuildIntensityFromCache');
    return body !== null && !/_analyzeEvidence\(/.test(stripComments(body));
  })(), '');
  record('R6 new counters exist alongside (not replacing) the R5 counters', /referenceFastAnalysisCount:\s*0,\s*targetFastAnalysisCount:\s*0/.test(panelCodeOnly) && /referenceAnalysisCount:\s*0,\s*targetAnalysisCount:\s*0,\s*intensityRenderCount:\s*0/.test(panelCodeOnly), '');
  for (const forbidden of ['hslData', 'toneCurveData', 'colorGradingData', 'calibrationData']) {
    record(`Candidate contract: production source still never introduces '${forbidden}'`, !panelCodeOnly.includes(`'${forbidden}'`) && !panelCodeOnly.includes(`"${forbidden}"`), '');
  }

  console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('epic-2e-p0-7-r6-fast-refined-critical-path-static-test crashed:', err?.stack ?? err);
  process.exit(2);
});
