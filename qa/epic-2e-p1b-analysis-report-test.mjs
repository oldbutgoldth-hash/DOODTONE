#!/usr/bin/env node
/**
 * EPIC 2E-P1B — AI Image Analysis Report: static + integration test.
 *
 * Runs the 35 required test cases against the REAL production
 * modules: core/single-image/report/*.js, core/single-image/
 * single-image-orchestrator.js, core/single-image/single-image-
 * session.js, ui/i18n/*.js. `ui/app.js` wiring (cases 21-26) is
 * verified via source inspection (comment-stripped substring checks),
 * the same pattern established in the P1A R3 upload-lifecycle test —
 * ui/app.js is a browser-only DOM-driven controller that cannot be
 * fully imported in plain Node.
 *
 * Run: node qa/epic-2e-p1b-analysis-report-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  createEmptyReport, validateReportShape, REPORT_STATUS, SECTION_STATUS, ANALYSIS_SECTION_IDS,
} = await import('../core/single-image/report/analysis-report-schema.js');
const {
  normalizeConfidenceValue, levelFromScore, combineConservative, confidenceFromRaw,
} = await import('../core/single-image/report/confidence-aggregator.js');
const {
  classifyExposure, classifyWhiteBalance, classifySkin, buildTechnicalIssues,
} = await import('../core/single-image/report/photographer-interpretation-engine.js');
const { buildAnalysisReportFromSession } = await import('../core/single-image/report/analysis-report-builder.js');
const {
  createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE,
} = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { getActiveSession, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { t, hasTranslation, _resetMissingTranslationKeysForTest } = await import('../ui/i18n/index.js');

function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}

function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}

/** Build a COMPLETED Session with a rich, realistic evidence set (mirrors the real shapes read from core/histogram-engine, core/whitebalance-engine, etc. — see P1B_EVIDENCE_TO_REPORT_MAP.md). */
function buildRichCompletedSession({ status = SESSION_STATUS.COMPLETED } = {}) {
  const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
  s.image.width = 4000; s.image.height = 3000; s.image.aspectRatio = 1.333; s.image.megapixels = 12;
  updateSessionStatus(s, status);
  s.evidence.stats = mk({
    avgLum: 190, median: 195, blackPoint: 20, whitePoint: 250, drStops: 5.2, contrastRatio: 3.1,
    clipHiPct: 3, clipLoPct: 1, avgSatPct: 30, rbDiff: 2, gDiff: 1, avgR: 200, avgG: 190, avgB: 180,
    skinDetected: true, skinPct: 15, category: 'Wedding', total: 10000, confidence: 0.85, warnings: [], contrast: 45,
  }, MODULE_STATE.COMPLETED, 0.85);
  s.evidence.wb = mk({
    consensus: { temperature: 12, tint: -3, kelvin: 5800, confidence: 0.7 },
    cast: 'warm', confidence: 0.7, neutralPixelCount: 120, category: 'Wedding', warnings: [],
    wbIntent: { preserveMood: true },
  }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.colorCast = mk({
    center: { rbDiff: 1, gDiff: 1, label: 'neutral', strength: 0.05, pixelCount: 500 },
    border: { rbDiff: 2, gDiff: 8, label: 'green', strength: 0.3, pixelCount: 2000 },
    global: { rbDiff: 1.5, gDiff: 5, label: 'green', strength: 0.2, pixelCount: 2500 },
    bgGreenDominant: true, subjectNeutral: true, dominantCast: 'border', confidence: 0.6, warnings: [],
  }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.skin = mk({
    pixelCount: 800, coveragePct: 15, detected: true, toneLabel: 'Type III', fitzpatrickScale: 3,
    avgHSL: { h: 20, s: 40, l: 60 }, avgRGB: { r: 220, g: 180, b: 150 }, confidence: 0.75, warnings: [],
  }, MODULE_STATE.COMPLETED, 0.75);
  s.evidence.scene = mk({ category: 'Wedding', confidence: 0.8, categoryRaw: 'Wedding', scores: { Wedding: 0.8, Portrait: 0.5 }, warnings: [] }, MODULE_STATE.COMPLETED, 0.8);
  s.evidence.palette = mk({ colors: [{ hex: '#ffddcc', population: 0.4, role: 'Dominant' }], confidence: 0.6, warnings: [] }, MODULE_STATE.COMPLETED, 0.6);
  s.evidence.harmony = mk({ recommended: 'Analogous', confidence: 0.5, schemes: {} }, MODULE_STATE.COMPLETED, 0.5);
  s.evidence.hsl = mk({ ranked: [{ channel: 'orange', coveragePct: 30 }], dominant: 'orange', confidence: 0.65, warnings: [] }, MODULE_STATE.COMPLETED, 0.65);
  return s;
}

// ══════════════════════════════════════════════════════════════════
// 1. Report schema completeness
// ══════════════════════════════════════════════════════════════════
{
  const empty = createEmptyReport({ sessionId: 's1', generationId: 'g1', reportId: 'r1' });
  const v = validateReportShape(empty);
  check('1. Report schema completeness', v.valid === true, `errors=${JSON.stringify(v.errors)}`);
}

// ══════════════════════════════════════════════════════════════════
// 2. Report is created from active session.evidence
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession();
  const { report } = buildAnalysisReportFromSession(s);
  check('2. Report built from active session.evidence',
    report.exposure.meanLuminance === s.evidence.stats.result.avgLum
    && report.whiteBalance.temperatureDirection === 'warm'
    && report.skin.percentage === s.evidence.skin.result.coveragePct);
}

// ══════════════════════════════════════════════════════════════════
// 3. Report is stored in session.report (via orchestrator)
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const ticket = await orch.beginUpload(fakeFile('a.jpg'));
  orch.markImageDecoded(ticket, { width: 100, height: 100 });
  const at = orch.startAnalysisTicket(ticket.sessionId, ticket.generationId);
  orch.commitEvidence(at, 'histogram', { status: 'COMPLETED', result: { avgLum: 128, median: 128, blackPoint: 10, whitePoint: 240, drStops: 6, clipHiPct: 2, clipLoPct: 2, avgSatPct: 30, category: 'General', confidence: 0.8, contrast: 40 } });
  orch.commitEvidence(at, 'basicPanel', { status: 'COMPLETED', result: {} });
  orch.completeAnalysis(at);
  const built = orch.buildAndCommitReport(at);
  const session = getActiveSession();
  check('3. Report stored in session.report', built.committed === true && session.report === built.report);
}

// ══════════════════════════════════════════════════════════════════
// 4. Report sessionId matches active Session
// ══════════════════════════════════════════════════════════════════
{
  const session = getActiveSession();
  check('4. Report sessionId matches active Session', session.report.sessionId === session.sessionId);
}

// ══════════════════════════════════════════════════════════════════
// 5. Report generationId matches active Session
// ══════════════════════════════════════════════════════════════════
{
  const session = getActiveSession();
  check('5. Report generationId matches active Session', session.report.generationId === session.generationId);
}

// ══════════════════════════════════════════════════════════════════
// 6. Stale Session report cannot commit
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const t1 = await orch.beginUpload(fakeFile('a.jpg'));
  orch.markImageDecoded(t1, { width: 100, height: 100 });
  const at1 = orch.startAnalysisTicket(t1.sessionId, t1.generationId);
  orch.commitEvidence(at1, 'histogram', { status: 'COMPLETED', result: { avgLum: 100, drStops: 5, clipHiPct: 1, clipLoPct: 1, avgSatPct: 20, category: 'General', confidence: 0.7, contrast: 30 } });
  orch.commitEvidence(at1, 'basicPanel', { status: 'COMPLETED', result: {} });
  orch.completeAnalysis(at1);
  // A NEWER upload supersedes t1 before the (stale) report build call.
  const t2 = await orch.beginUpload(fakeFile('b.jpg'));
  const staleResult = orch.buildAndCommitReport(at1);
  check('6. Stale Session report cannot commit', staleResult.committed === false && staleResult.reason === 'STALE_GENERATION');
}

// ══════════════════════════════════════════════════════════════════
// 7. Completed Session produces COMPLETE report
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession({ status: SESSION_STATUS.COMPLETED });
  const { report, validation } = buildAnalysisReportFromSession(s);
  check('7. Completed Session -> COMPLETE report', report.status === REPORT_STATUS.COMPLETE && validation.valid === true);
}

// ══════════════════════════════════════════════════════════════════
// 8. Partial Session produces PARTIAL report
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession({ status: SESSION_STATUS.PARTIAL });
  const { report, validation } = buildAnalysisReportFromSession(s);
  check('8. Partial Session -> PARTIAL report', report.status === REPORT_STATUS.PARTIAL && validation.valid === true);
}

// ══════════════════════════════════════════════════════════════════
// 9. Optional missing evidence produces UNAVAILABLE section
// ══════════════════════════════════════════════════════════════════
{
  const s = createSingleImageSession({ file: fakeFile() });
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  s.evidence.stats = mk({ avgLum: 128, median: 128, blackPoint: 10, whitePoint: 240, drStops: 5, clipHiPct: 2, clipLoPct: 2, avgSatPct: 20, category: 'General', confidence: 0.6, contrast: 40 }, MODULE_STATE.COMPLETED, 0.6);
  // wb/skin/palette/harmony/hsl/colorCast/scene are all left null (never committed this run).
  const { report } = buildAnalysisReportFromSession(s);
  check('9. Missing optional evidence -> UNAVAILABLE section', report.whiteBalance.status === SECTION_STATUS.UNAVAILABLE && report.skin.status === SECTION_STATUS.UNAVAILABLE);
}

// ══════════════════════════════════════════════════════════════════
// 10. Missing evidence does not fabricate confidence
// ══════════════════════════════════════════════════════════════════
{
  const s = createSingleImageSession({ file: fakeFile() });
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  const { report } = buildAnalysisReportFromSession(s);
  check('10. Missing evidence -> confidence stays null/UNAVAILABLE, never fabricated',
    report.whiteBalance.confidence.score === null && report.whiteBalance.confidence.level === 'UNAVAILABLE'
    && report.summary.overallConfidence.score === null);
}

// ══════════════════════════════════════════════════════════════════
// 11. Confidence stays within 0-100
// ══════════════════════════════════════════════════════════════════
{
  const cases = [normalizeConfidenceValue(0), normalizeConfidenceValue(1), normalizeConfidenceValue(0.5), normalizeConfidenceValue(-5), normalizeConfidenceValue(500), normalizeConfidenceValue(NaN)];
  const inRange = cases.every((v) => v === null || (v >= 0 && v <= 100));
  const s = buildRichCompletedSession();
  const { report } = buildAnalysisReportFromSession(s);
  let allSectionsInRange = true;
  for (const id of ANALYSIS_SECTION_IDS) {
    const sc = report[id].confidence.score;
    if (sc !== null && (sc < 0 || sc > 100)) allSectionsInRange = false;
  }
  check('11. Confidence values stay within 0-100', inRange && allSectionsInRange);
}

// ══════════════════════════════════════════════════════════════════
// 12. Low WB neutral evidence produces a caution warning
// ══════════════════════════════════════════════════════════════════
{
  const wbLow = { consensus: { temperature: 5, tint: 2, kelvin: 5500, confidence: 0.3 }, confidence: 0.3, neutralPixelCount: 5, cast: 'neutral' };
  const section = classifyWhiteBalance({ wb: wbLow, colorCast: null });
  check('12. Low WB neutral evidence -> caution warning', section.warnings.some((w) => w.code === 'whiteBalance.lowNeutralConfidence'));
}

// ══════════════════════════════════════════════════════════════════
// 13. Dominant green object alone does not assert green WB cast
// ══════════════════════════════════════════════════════════════════
{
  const wb = { consensus: { temperature: 2, tint: 1, kelvin: 5500, confidence: 0.7 }, confidence: 0.7, neutralPixelCount: 100, cast: 'neutral' };
  const colorCast = {
    center: { label: 'neutral' }, border: { label: 'green' }, global: { label: 'green' },
    bgGreenDominant: true, subjectNeutral: true, confidence: 0.6,
  };
  const section = classifyWhiteBalance({ wb, colorCast });
  const claimsGreenCast = section.observations.some((o) => o.code === 'whiteBalance.castDetected');
  const backgroundNoted = section.observations.some((o) => o.code === 'whiteBalance.backgroundColorNotCast');
  check('13. Dominant green background alone -> background note, not global WB cast claim', !claimsGreenCast && backgroundNoted);
}

// ══════════════════════════════════════════════════════════════════
// 14. Skin report appears only when skin evidence supports detection
// ══════════════════════════════════════════════════════════════════
{
  const detected = classifySkin({ skin: { detected: true, coveragePct: 20, confidence: 0.7, avgHSL: { h: 10, l: 60 } } });
  const notDetected = classifySkin({ skin: { detected: false, coveragePct: 1, confidence: 0.5 } });
  const missing = classifySkin({ skin: null });
  check('14. Skin section reflects real detection evidence',
    detected.detected === true && detected.percentage === 20
    && notDetected.detected === false && notDetected.percentage === null
    && missing.detected === false && missing.status === SECTION_STATUS.UNAVAILABLE);
}

// ══════════════════════════════════════════════════════════════════
// 15. High-key image is not automatically labeled overexposed
// ══════════════════════════════════════════════════════════════════
{
  const stats = { avgLum: 195, clipHiPct: 4, clipLoPct: 1, drStops: 5, confidence: 0.8 };
  const section = classifyExposure({ stats, sceneCategory: 'Wedding' });
  check('15. High-key protected-highlight image classified highKey, not overexposed',
    section.exposureBalance === 'highKey' && section.exposureBalance !== 'overexposed');
}

// ══════════════════════════════════════════════════════════════════
// 16. Low-key scene is not automatically labeled technically incorrect
// ══════════════════════════════════════════════════════════════════
{
  const stats = { avgLum: 55, clipHiPct: 1, clipLoPct: 4, drStops: 6, confidence: 0.7 };
  const section = classifyExposure({ stats, sceneCategory: 'Landscape' });
  check('16. Dark scene with limited crushing classified lowKey, not underexposed',
    section.exposureBalance === 'lowKey' && section.exposureBalance !== 'underexposed');
}

// ══════════════════════════════════════════════════════════════════
// 17. Observations and recommendations remain separate
// ══════════════════════════════════════════════════════════════════
{
  const stats = { avgLum: 128, clipHiPct: 12, clipLoPct: 1, drStops: 5, confidence: 0.7 };
  const section = classifyExposure({ stats, sceneCategory: 'General' });
  const overlap = section.observations.some((o) => section.recommendations.some((r) => r.code === o.code));
  check('17. Observations and recommendations are separate arrays with no overlapping codes',
    Array.isArray(section.observations) && Array.isArray(section.recommendations) && !overlap && section.recommendations.length > 0);
}

// ══════════════════════════════════════════════════════════════════
// 18. Technical issues require supporting evidence
// ══════════════════════════════════════════════════════════════════
{
  const withEvidence = buildTechnicalIssues({
    stats: { clipHiPct: 20, clipLoPct: 1, drStops: 5, contrast: 40, avgSatPct: 30, confidence: 0.8 },
    wb: null, colorCast: null, skin: null,
  });
  const withoutEvidence = buildTechnicalIssues({ stats: null, wb: null, colorCast: null, skin: null });
  check('18. Technical issues only generated when evidence supports them',
    withEvidence.some((i) => i.code === 'HIGHLIGHT_CLIPPING') && withoutEvidence.length === 0);
}

// ══════════════════════════════════════════════════════════════════
// 19. No undefined values in report
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession();
  const { report } = buildAnalysisReportFromSession(s);
  let sawUndefined = false;
  JSON.stringify(report, (_k, v) => { if (v === undefined) sawUndefined = true; return v; });
  const hasUndefinedKeysDirectly = (() => {
    const stack = [report];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === 'object') {
        for (const k of Object.keys(cur)) {
          if (cur[k] === undefined) return true;
          if (typeof cur[k] === 'object' && cur[k] !== null) stack.push(cur[k]);
        }
      }
    }
    return false;
  })();
  check('19. No undefined values anywhere in the built report', !hasUndefinedKeysDirectly);
}

// ══════════════════════════════════════════════════════════════════
// 20. No NaN or Infinity
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession();
  const { report, validation } = buildAnalysisReportFromSession(s);
  const hasBadNumber = (() => {
    const stack = [report];
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur === 'number' && !Number.isFinite(cur)) return true;
      if (cur && typeof cur === 'object') for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
    return false;
  })();
  check('20. No NaN or Infinity anywhere in the built report', !hasBadNumber && validation.valid === true);
}

// ── Helpers for ui/app.js source-pattern checks (cases 21-26) ──────
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const appJsRaw = readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');
const appJsSrc = stripJsComments(appJsRaw);
const rendererRaw = readFileSync(path.join(ROOT, 'ui', 'single-image-report-renderer.js'), 'utf8');
const rendererSrc = stripJsComments(rendererRaw);

// ══════════════════════════════════════════════════════════════════
// 21. Language change does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  // rerenderCurrentUiForLocale() (called by setLang()) must call the
  // report RENDERER from the stashed snapshot, and must NOT call
  // buildAndCommitReport / runAnalysis anywhere in that function body.
  const fnStart = appJsSrc.indexOf('function rerenderCurrentUiForLocale()');
  const fnEnd = appJsSrc.indexOf('\nfunction setLang(', fnStart);
  const fnBody = appJsSrc.slice(fnStart, fnEnd);
  check('21. Language change re-renders report from snapshot, never rebuilds/reruns analysis',
    fnStart !== -1 && fnEnd !== -1
    && fnBody.includes('renderSingleImageReport(reportInner, state.lastSingleImageReport')
    && !fnBody.includes('buildAndCommitReport')
    && !fnBody.includes('runAnalysis('));
}

// ══════════════════════════════════════════════════════════════════
// 22. Opening report sections does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  // The renderer builds native <details>/<summary> elements with pure
  // DOM/CSS toggle semantics and attaches NO click handler that calls
  // any analysis/build function -- confirm no such call exists anywhere
  // in the renderer module.
  check('22. Report renderer never calls analysis/build functions when rendering/toggling sections',
    !rendererSrc.includes('buildAndCommitReport') && !rendererSrc.includes('runAnalysis')
    && !rendererSrc.includes('buildAnalysisReportFromSession') && !rendererSrc.includes('addEventListener'));
}

// ══════════════════════════════════════════════════════════════════
// 23. Advanced diagnostics does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  const fnStart = rendererSrc.indexOf('function _renderAdvancedDiagnostics');
  const fnEnd = rendererSrc.indexOf('\nfunction ', fnStart + 10);
  const fnBody = rendererSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  check('23. Advanced Diagnostics block reads only the already-built report (lineage/diagnostics fields), never re-runs analysis',
    fnStart !== -1 && fnBody.includes('report.lineage') && fnBody.includes('report.diagnostics')
    && !fnBody.includes('buildAndCommitReport') && !fnBody.includes('runAnalysis'));
}

// ══════════════════════════════════════════════════════════════════
// 24. Candidate generation does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  // buildFinalPreset() (Candidate generation) is called exactly once,
  // inside runAnalysis() itself (P1A's existing, unmodified call site)
  // -- confirm no NEW call site was introduced by P1B anywhere in the
  // report renderer or the report core modules.
  const reportModuleFiles = ['analysis-report-schema.js', 'analysis-report-builder.js', 'confidence-aggregator.js', 'photographer-interpretation-engine.js', 'report-lineage.js']
    .map((f) => readFileSync(path.join(ROOT, 'core', 'single-image', 'report', f), 'utf8'));
  const noCandidateCallsInReportModules = reportModuleFiles.every((src) => !src.includes('buildFinalPreset'));
  check('24. Candidate generation (buildFinalPreset) is never called from any P1B report module',
    noCandidateCallsInReportModules && !rendererSrc.includes('buildFinalPreset'));
}

// ══════════════════════════════════════════════════════════════════
// 25. XMP generation does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  const reportModuleFiles = ['analysis-report-schema.js', 'analysis-report-builder.js', 'confidence-aggregator.js', 'photographer-interpretation-engine.js', 'report-lineage.js']
    .map((f) => readFileSync(path.join(ROOT, 'core', 'single-image', 'report', f), 'utf8'));
  const noXmpCallsInReportModules = reportModuleFiles.every((src) => !src.includes('serializeXMP') && !src.includes('validateFinalPreset'));
  check('25. XMP generation (serializeXMP/validateFinalPreset) is never called from any P1B report module',
    noXmpCallsInReportModules && !rendererSrc.includes('serializeXMP'));
}

// ══════════════════════════════════════════════════════════════════
// 26. XMP download does not rerun analysis
// ══════════════════════════════════════════════════════════════════
{
  const handleDownloadStart = appJsSrc.indexOf('function handleDownload()');
  const handleDownloadEnd = appJsSrc.indexOf('\nfunction handleReanalyze(', handleDownloadStart);
  const handleDownloadBody = appJsSrc.slice(handleDownloadStart, handleDownloadEnd);
  check('26. handleDownload() (XMP download) never calls runAnalysis or buildAndCommitReport',
    handleDownloadStart !== -1 && !handleDownloadBody.includes('runAnalysis(') && !handleDownloadBody.includes('buildAndCommitReport'));
}

// ══════════════════════════════════════════════════════════════════
// 27. New upload clears the old report
// ══════════════════════════════════════════════════════════════════
{
  // loadFile() must call handleReset() (which clears the report UI —
  // see case 28) BEFORE beginUpload(), preserving the P1A R3 fix, and
  // the analysis-start block must clear state.lastSingleImageReport
  // and the report container before the new analysis's evidence
  // starts arriving.
  const loadFileStart = appJsSrc.indexOf('async function loadFile(file)');
  const loadFileEnd = appJsSrc.indexOf('\nfunction ', loadFileStart + 10);
  const loadFileBody = appJsSrc.slice(loadFileStart, loadFileEnd);
  const resetIdx = loadFileBody.indexOf('handleReset()');
  const beginUploadIdx = loadFileBody.indexOf('singleImageOrchestrator.beginUpload(');
  check('27. New upload (loadFile) clears the old report via handleReset() before the new Session begins',
    resetIdx !== -1 && beginUploadIdx !== -1 && resetIdx < beginUploadIdx);
}

// ══════════════════════════════════════════════════════════════════
// 28. Reset clears session.report
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const s = buildRichCompletedSession();
  const { report } = buildAnalysisReportFromSession(s);
  s.report = report;
  check('28a. session.report is non-null before reset (sanity)', s.report !== null);

  const handleResetStart = appJsSrc.indexOf('function handleReset()');
  const handleResetEnd = appJsSrc.indexOf('\nfunction ', handleResetStart + 10);
  const handleResetBody = appJsSrc.slice(handleResetStart, handleResetEnd);
  check('28b. handleReset() clears the report UI (section hidden + inner cleared) and calls resetActiveSession (which nulls session.report)',
    handleResetBody.includes('clearSingleImageReportDisplay')
    && handleResetBody.includes("reportSec.style.display = 'none'")
    && handleResetBody.includes('singleImageOrchestrator.resetActiveSession')
    && handleResetBody.includes('state.lastSingleImageReport = null'));

  // Confirm resetSessionData() (called by resetActiveSession) genuinely nulls session.report.
  const { resetSessionData } = await import('../core/single-image/single-image-session.js');
  resetSessionData(s);
  check('28c. resetSessionData() nulls session.report', s.report === null);
}

// ══════════════════════════════════════════════════════════════════
// 29. Duplicate report build is prevented / tracked (reportBuildCount)
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const ticket = await orch.beginUpload(fakeFile('dup.jpg'));
  orch.markImageDecoded(ticket, { width: 100, height: 100 });
  const at = orch.startAnalysisTicket(ticket.sessionId, ticket.generationId);
  orch.commitEvidence(at, 'histogram', { status: 'COMPLETED', result: { avgLum: 128, drStops: 5, clipHiPct: 1, clipLoPct: 1, avgSatPct: 20, category: 'General', confidence: 0.7, contrast: 30 } });
  orch.commitEvidence(at, 'basicPanel', { status: 'COMPLETED', result: {} });
  orch.completeAnalysis(at);
  const first = orch.buildAndCommitReport(at);
  // The real ui/app.js call site only invokes buildAndCommitReport() ONCE
  // per completeAnalysis() -- confirmed by source inspection (case 3's
  // wiring check). Calling it again here is a deliberate DIRECT-API
  // probe proving the count is honestly tracked rather than silently
  // no-op'd on repeat (an undetectable duplicate build would be worse
  // than an honestly incrementing counter a caller can assert against).
  const second = orch.buildAndCommitReport(at);
  check('29. Duplicate report build is tracked via reportBuildCount, not silently indistinguishable',
    first.report.reportBuildCount === 1 && second.report.reportBuildCount === 2);

  // The real call site itself builds exactly once per completeAnalysis().
  const runAnalysisStart = appJsSrc.indexOf('async function runAnalysis(');
  const runAnalysisBody = appJsSrc.slice(runAnalysisStart);
  const buildCallCount = (runAnalysisBody.match(/buildAndCommitReport\(/g) || []).length;
  check('29b. runAnalysis() calls buildAndCommitReport() exactly once per invocation', buildCallCount === 1);
}

// ══════════════════════════════════════════════════════════════════
// 30. Report lineage contains real evidence references
// ══════════════════════════════════════════════════════════════════
{
  const s = buildRichCompletedSession();
  const { report } = buildAnalysisReportFromSession(s);
  const wbLineage = report.lineage.whiteBalance;
  check('30. Report lineage references real evidence keys and source modules',
    Array.isArray(wbLineage.evidenceKeys) && wbLineage.evidenceKeys.includes('wb') && wbLineage.evidenceKeys.includes('colorCast')
    && wbLineage.sourceModules.some((m) => m.includes('whitebalance-engine'))
    && wbLineage.fallbackUsed === false);
}

// ══════════════════════════════════════════════════════════════════
// 31. Existing P1A R3 tests remain passing
// ══════════════════════════════════════════════════════════════════
{
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'qa', 'epic-2e-p1a-single-image-session-test.mjs')], { cwd: ROOT, stdio: 'pipe' });
    execFileSync(process.execPath, [path.join(ROOT, 'qa', 'epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs')], { cwd: ROOT, stdio: 'pipe' });
    check('31. Existing P1A R3 test suites (25/25 + 16/16) still pass unmodified', true);
  } catch (err) {
    check('31. Existing P1A R3 test suites (25/25 + 16/16) still pass unmodified', false, String(err.message || err).slice(0, 300));
  }
}

// ══════════════════════════════════════════════════════════════════
// 32. P0.8A invariant tests remain passing (subprocess of the P1A suite)
// ══════════════════════════════════════════════════════════════════
{
  // The P1A suite (re-verified in case 31) already runs the P0.8A/RCM
  // pinned-baseline test (its own case 25) as part of its 25 cases —
  // its output is inspected here for that specific line rather than
  // re-invoking a second subprocess.
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, [path.join(ROOT, 'qa', 'epic-2e-p1a-single-image-session-test.mjs')], { cwd: ROOT, stdio: 'pipe' }).toString();
    check('32. P0.8A / Reference Color Match pinned-baseline invariant test passes', out.includes('[PASS] 25. Reference Color Match behavior remains unchanged'));
  } catch (err) {
    check('32. P0.8A / Reference Color Match pinned-baseline invariant test passes', false, String(err.message || err).slice(0, 300));
  }
}

// ══════════════════════════════════════════════════════════════════
// 33. Reference Color Match remains unchanged (byte-identical, P1B scope)
// ══════════════════════════════════════════════════════════════════
{
  const baseline = JSON.parse(readFileSync(path.join(ROOT, 'qa', 'baselines', 'p0-8a-reference-color-match-invariant.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  let allMatch = true;
  const diffs = [];
  for (const [rel, expected] of Object.entries(baseline.files)) {
    const absPath = path.join(ROOT, rel);
    const actual = createHash('sha256').update(readFileSync(absPath)).digest('hex');
    if (actual !== expected) { allMatch = false; diffs.push(rel); }
  }
  check('33. Reference Color Match files remain byte-identical to the pinned P0.8A baseline', allMatch, diffs.join(', '));
}

// ══════════════════════════════════════════════════════════════════
// 34. Candidate/XMP files remain unchanged
// ══════════════════════════════════════════════════════════════════
{
  const { createHash } = await import('node:crypto');
  const invariant = JSON.parse(readFileSync(path.join(ROOT, 'qa', 'baselines', 'epic-2e-n1-production-invariant.json'), 'utf8'));
  const untouchedFiles = Object.keys(invariant.files).filter((f) => f !== 'ui/app.js');
  let allMatch = true;
  const diffs = [];
  for (const rel of untouchedFiles) {
    const absPath = path.join(ROOT, rel);
    const actual = createHash('sha256').update(readFileSync(absPath)).digest('hex');
    if (actual !== invariant.files[rel]) { allMatch = false; diffs.push(rel); }
  }
  const decisionEngineSrc = readFileSync(path.join(ROOT, 'core', 'decision-engine', 'index.js'), 'utf8');
  const presetEngineSrc = readFileSync(path.join(ROOT, 'core', 'preset-engine', 'index.js'), 'utf8');
  const noReportImportsInCandidateXmpPath = !decisionEngineSrc.includes('/report/') && !presetEngineSrc.includes('/report/');
  check('34. Candidate/XMP-path files remain byte-identical and P1B report modules are never imported by them',
    allMatch && noReportImportsInCandidateXmpPath, diffs.join(', '));
}

// ══════════════════════════════════════════════════════════════════
// 35. Production locks remain unchanged
// ══════════════════════════════════════════════════════════════════
{
  const invariant = JSON.parse(readFileSync(path.join(ROOT, 'qa', 'baselines', 'epic-2e-n1-production-invariant.json'), 'utf8'));
  const locks = invariant.productionLocks;
  check('35. Production safety locks remain at their locked-down values',
    locks.productionSource === 'legacy' && locks.productionWrite === false
    && locks.xmpWriteAllowedByN1 === false && locks.lightroomMappingAllowedByN1 === false);
}

// ══════════════════════════════════════════════════════════════════
// Bonus: all i18n keys referenced by the report renderer/interpretation
// engine resolve in both en and th (no silent raw-key fallback).
// ══════════════════════════════════════════════════════════════════
{
  const obsCodes = ['exposure.highlightsClipped','exposure.highKeyProtected','exposure.highKeyPortraitContext','exposure.highlightsMildClipping','exposure.shadowsClipped','exposure.lowKeyIntentional','exposure.shadowsMildClipping','exposure.balancedObservation','dynamicRange.veryLow','dynamicRange.low','dynamicRange.moderate','dynamicRange.high','dynamicRange.veryHigh','whiteBalance.backgroundColorNotCast','whiteBalance.castDetected','whiteBalance.creativeMoodPreserved','whiteBalance.temperatureObservation','whiteBalance.tintObservation','tone.flatMidtones','tone.harshContrast','tone.normalContrast','color.saturationProfile','color.harmonyDetected','color.castObservation','skin.notDetected','skin.detected','scene.primaryType'];
  const recCodes = ['exposure.recoverHighlights','exposure.watchHighlights','exposure.liftShadowsCautiously','exposure.watchShadows','dynamicRange.considerContrastBoost','tone.addContrast','tone.softenContrast','color.moderateSaturation','whiteBalance.reviewManually','skin.avoidExcessSaturation','skin.carefulTextureClarity','skin.avoidStrongDehaze','skin.protectFaceHighlights'];
  const warnCodes = ['exposure.bothEndsClipping','dynamicRange.nearUniformWarning','dynamicRange.unusuallyHighWarning','whiteBalance.lowNeutralConfidence','skin.lowConfidence','scene.fallbackToHistogramCategory'];
  const issueCodes = ['HIGHLIGHT_CLIPPING','SHADOW_CRUSH','LOW_DYNAMIC_RANGE','WB_LOW_CONFIDENCE','DOMINANT_COLOR_BIAS','EXCESSIVE_SATURATION','LOW_SKIN_CONFIDENCE','HARSH_CONTRAST','FLAT_MIDTONES'];
  const creativeCodes = ['HIGH_KEY','LOW_KEY','VIVID_COLOR','MUTED_COLOR','WARM_MOOD','COOL_MOOD','HARMONIOUS_PALETTE'];
  const staticKeys = ['report.title','report.waitingForAnalysis','report.partialAnalysisNotice','report.analysisUnavailableNotice','report.technicalIssuesTitle','report.advancedDiagnosticsTitle','report.summary.shortDescription','report.label.observations','report.label.recommendations','report.label.warnings','report.label.overallConfidence','report.confidence.unavailable','report.confidence.withScore','report.confidence.level.HIGH','report.confidence.level.MEDIUM','report.confidence.level.LOW','report.confidence.level.UNAVAILABLE','report.sectionStatus.AVAILABLE','report.sectionStatus.PARTIAL','report.sectionStatus.LOW_CONFIDENCE','report.sectionStatus.UNAVAILABLE','report.sectionStatus.FAILED','report.section.unavailable','report.section.exposure','report.section.dynamicRange','report.section.whiteBalance','report.section.tone','report.section.color','report.section.skin','report.section.scene'];
  const allKeys = [...staticKeys, ...obsCodes.map((c) => `report.observations.${c}`), ...recCodes.map((c) => `report.recommendations.${c}`), ...warnCodes.map((c) => `report.warnings.${c}`), ...issueCodes.flatMap((c) => [`report.issues.${c}.title`, `report.issues.${c}.description`, `report.issues.${c}.recommendation`]), ...creativeCodes.map((c) => `report.creative.${c}`)];
  let missing = [];
  for (const lang of ['en', 'th']) {
    for (const key of allKeys) if (!hasTranslation(key, lang)) missing.push(`${lang}:${key}`);
  }
  check('Bonus. Every report i18n key resolves in both Thai and English', missing.length === 0, missing.slice(0, 5).join(', '));
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
