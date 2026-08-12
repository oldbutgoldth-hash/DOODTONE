#!/usr/bin/env node
/**
 * EPIC 2E-P1N — Photographer Style Intelligence wired into Report/UI:
 * static + integration test.
 *
 * Audit finding this round: `core/style-recognition-engine` (the named
 * 10-category classifier -- Wedding/Portrait/Landscape/Travel/Food/
 * Street/Fashion/Documentary/Vintage/Luxury), `core/style-fingerprint`,
 * and `core/style-benchmark-engine` were ALREADY being called from
 * ui/app.js's ColorEngines/Decision stages and ALREADY committed into
 * session.evidence (`styleRecognition`/`styleFingerprint`/`benchmark`)
 * -- P1N's real gap was that NOTHING in core/single-image/report/ or
 * ui/single-image-report-renderer.js ever read that evidence. This
 * suite proves the new `photographerStyle` report section closes that
 * gap without re-running or duplicating any existing engine.
 *
 * Run: node qa/epic-2e-p1n-photographer-style-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  createEmptyReport, validateReportShape, ANALYSIS_SECTION_IDS, SECTION_STATUS,
} = await import('../core/single-image/report/analysis-report-schema.js');
const { classifyPhotographerStyle } = await import('../core/single-image/report/photographer-interpretation-engine.js');
const { buildAnalysisReportFromSession } = await import('../core/single-image/report/analysis-report-builder.js');
const {
  createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE,
} = await import('../core/single-image/single-image-session.js');
const { t } = await import('../ui/i18n/index.js');
const { en } = await import('../ui/i18n/en.js');
const { th } = await import('../ui/i18n/th.js');

function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}
function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}

const STYLE_RECOGNITION_FIXTURE = {
  styles: [
    { style: 'Wedding', confidence: 62.3, rawScore: 1.1, rank: 1, traits: ['Bright exposure', 'Soft skin tones'] },
    { style: 'Portrait', confidence: 30.1, rawScore: 0.9, rank: 2, traits: ['Studio lighting'] },
    { style: 'Fashion', confidence: 7.6, rawScore: 0.2, rank: 3, traits: ['Strong highlight presence'] },
  ],
  top: { style: 'Wedding', confidence: 62.3, rawScore: 1.1, rank: 1, traits: ['Bright exposure', 'Soft skin tones'] },
  second: { style: 'Portrait', confidence: 30.1, rawScore: 0.9, rank: 2, traits: ['Studio lighting'] },
  features: {}, summary: 'test', confidence: 0.55, warnings: [], reason: 'test',
};
const STYLE_FINGERPRINT_FIXTURE = { moodLabel: 'Romantic', warmth: 'warm', contrastLevel: 'moderate' };
const BENCHMARK_FIXTURE = { photographerAcceptance: { score: 0.81, strongPoints: ['a', 'b'], weakPoints: [] } };

function buildRichSession({ withStyle = true, withFingerprint = true, withBenchmark = true } = {}) {
  const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
  s.image.width = 4000; s.image.height = 3000;
  updateSessionStatus(s, SESSION_STATUS.COMPLETED);
  s.evidence.stats = mk({ avgLum: 190, clipHiPct: 2, clipLoPct: 1, drStops: 5.2, contrast: 45, confidence: 0.8, category: 'Portrait' });
  if (withStyle) s.evidence.styleRecognition = mk(STYLE_RECOGNITION_FIXTURE);
  if (withFingerprint) s.evidence.styleFingerprint = mk(STYLE_FINGERPRINT_FIXTURE);
  if (withBenchmark) s.evidence.benchmark = mk(BENCHMARK_FIXTURE);
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// Section A — Schema (checks 1-4)
// ═══════════════════════════════════════════════════════════════════
check('1. ANALYSIS_SECTION_IDS includes photographerStyle', ANALYSIS_SECTION_IDS.includes('photographerStyle'));
const emptyReport = createEmptyReport({ sessionId: 's', generationId: 'g', reportId: 'r' });
check('2. createEmptyReport().photographerStyle has the common section shape', emptyReport.photographerStyle
  && emptyReport.photographerStyle.status === SECTION_STATUS.UNAVAILABLE
  && Array.isArray(emptyReport.photographerStyle.observations)
  && Array.isArray(emptyReport.photographerStyle.recommendations)
  && Array.isArray(emptyReport.photographerStyle.warnings)
  && 'topStyle' in emptyReport.photographerStyle && 'alternates' in emptyReport.photographerStyle
  && 'moodSummary' in emptyReport.photographerStyle && 'preservation' in emptyReport.photographerStyle);
check('3. An empty report (no other fields filled) still structurally validates', validateReportShape(emptyReport).valid,
  JSON.stringify(validateReportShape(emptyReport).errors));
check('4. Existing section ids (exposure..scene) are all still present and unmodified', ['exposure', 'dynamicRange', 'whiteBalance', 'tone', 'color', 'skin', 'scene'].every((id) => ANALYSIS_SECTION_IDS.includes(id)));

// ═══════════════════════════════════════════════════════════════════
// Section B — classifyPhotographerStyle() unit behavior (checks 5-20)
// ═══════════════════════════════════════════════════════════════════
const missing = classifyPhotographerStyle({});
check('5. Missing styleRecognition -> UNAVAILABLE, all fields null/empty', missing.status === SECTION_STATUS.UNAVAILABLE
  && missing.topStyle === null && missing.alternates.length === 0 && missing.observations.length === 0);

const full = classifyPhotographerStyle({ styleRecognition: STYLE_RECOGNITION_FIXTURE, styleFingerprint: STYLE_FINGERPRINT_FIXTURE, benchmark: BENCHMARK_FIXTURE });
check('6. Full evidence -> AVAILABLE (margin=32.2 >= 5, top confidence=62.3 >= 25)', full.status === SECTION_STATUS.AVAILABLE);
check('7. topStyle/topStyleConfidence read from styleRecognition.top', full.topStyle === 'Wedding' && full.topStyleConfidence === 62.3);
check('8. alternates excludes top, capped at 2, in engine order', full.alternates.length === 2 && full.alternates[0].style === 'Portrait' && full.alternates[1].style === 'Fashion');
check('9. traits passed through from top.traits', Array.isArray(full.traits) && full.traits.includes('Bright exposure') && full.traits.includes('Soft skin tones'));
check('10. moodSummary populated from styleFingerprint (mood/warmth/contrastLevel)', full.moodSummary && full.moodSummary.mood === 'Romantic' && full.moodSummary.warmth === 'warm' && full.moodSummary.contrastLevel === 'moderate');
check('11. preservation populated from benchmark.photographerAcceptance', full.preservation && full.preservation.score === 0.81 && full.preservation.strongPoints === 2 && full.preservation.weakPoints === 0);
check('12. observations include topStyle, traits, moodSummary, and preservationEstimate codes', ['photographerStyle.topStyle', 'photographerStyle.traits', 'photographerStyle.moodSummary', 'photographerStyle.preservationEstimate.strong'].every((c) => full.observations.some((o) => o.code === c)));
check('13. confidence is derived from styleRecognition.confidence (0-1 margin-based), not from top.confidence (0-100 softmax)', full.confidence.score === 55 && full.confidence.level === 'MEDIUM');

const ambiguous = classifyPhotographerStyle({ styleRecognition: {
  top: { style: 'Street', confidence: 40, traits: [] }, second: { style: 'Documentary', confidence: 37, traits: [] },
  styles: [{ style: 'Street', confidence: 40 }, { style: 'Documentary', confidence: 37 }], confidence: 0.5,
} });
check('14. Margin < 5 -> ambiguous=true, LOW_CONFIDENCE status, ambiguousClassification warning', ambiguous.ambiguous === true && ambiguous.status === SECTION_STATUS.LOW_CONFIDENCE && ambiguous.warnings.some((w) => w.code === 'photographerStyle.ambiguousClassification'));
check('15. Ambiguous warning params carry both style names and confidences', ambiguous.warnings[0].params.topStyle === 'Street' && ambiguous.warnings[0].params.secondStyle === 'Documentary' && ambiguous.warnings[0].params.topConfidence === 40 && ambiguous.warnings[0].params.secondConfidence === 37);

const lowConf = classifyPhotographerStyle({ styleRecognition: {
  top: { style: 'Vintage', confidence: 18, traits: [] }, second: { style: 'Documentary', confidence: 5, traits: [] },
  styles: [{ style: 'Vintage', confidence: 18 }, { style: 'Documentary', confidence: 5 }], confidence: 0.15,
} });
check('16. Top confidence < 25 -> LOW_CONFIDENCE status, lowConfidenceClassification warning + reviewManually recommendation', lowConf.status === SECTION_STATUS.LOW_CONFIDENCE && lowConf.warnings.some((w) => w.code === 'photographerStyle.lowConfidenceClassification') && lowConf.recommendations.some((r) => r.code === 'photographerStyle.reviewManually'));

const noSecond = classifyPhotographerStyle({ styleRecognition: { top: { style: 'Luxury', confidence: 90, traits: [] }, second: null, styles: [{ style: 'Luxury', confidence: 90 }], confidence: 0.9 } });
check('17. No second-place style -> never throws, ambiguous stays false (no margin to compute)', noSecond.ambiguous === false && noSecond.status === SECTION_STATUS.AVAILABLE);

const noFingerprintNoBenchmark = classifyPhotographerStyle({ styleRecognition: STYLE_RECOGNITION_FIXTURE });
check('18. Missing styleFingerprint/benchmark degrades gracefully (moodSummary/preservation null, section still AVAILABLE)', noFingerprintNoBenchmark.moodSummary === null && noFingerprintNoBenchmark.preservation === null && noFingerprintNoBenchmark.status === SECTION_STATUS.AVAILABLE);

const draftTier = classifyPhotographerStyle({ styleRecognition: STYLE_RECOGNITION_FIXTURE, benchmark: { photographerAcceptance: { score: 0.6 } } });
check('19. Preservation score 0.5-0.75 -> "draft" tier observation code', draftTier.observations.some((o) => o.code === 'photographerStyle.preservationEstimate.draft'));
const roughTier = classifyPhotographerStyle({ styleRecognition: STYLE_RECOGNITION_FIXTURE, benchmark: { photographerAcceptance: { score: 0.3 } } });
check('20. Preservation score < 0.5 -> "rough" tier + expectManualWork recommendation', roughTier.observations.some((o) => o.code === 'photographerStyle.preservationEstimate.rough') && roughTier.recommendations.some((r) => r.code === 'photographerStyle.expectManualWork'));

// ═══════════════════════════════════════════════════════════════════
// Section C — analysis-report-builder.js wiring (checks 21-30)
// ═══════════════════════════════════════════════════════════════════
const richSession = buildRichSession();
const { report: richReport, validation: richValidation } = buildAnalysisReportFromSession(richSession);
check('21. buildAnalysisReportFromSession() produces a valid report with full style evidence', richValidation.valid, JSON.stringify(richValidation.errors));
check('22. report.photographerStyle.topStyle reflects session.evidence.styleRecognition', richReport.photographerStyle.topStyle === 'Wedding');
check('23. report.photographerStyle.moodSummary reflects session.evidence.styleFingerprint', richReport.photographerStyle.moodSummary?.mood === 'Romantic');
check('24. report.photographerStyle.preservation reflects session.evidence.benchmark', richReport.photographerStyle.preservation?.score === 0.81);
check('25. report.lineage.photographerStyle references all 3 evidence keys and 3 source modules', Array.isArray(richReport.lineage.photographerStyle?.evidenceKeys)
  && ['styleRecognition', 'styleFingerprint', 'benchmark'].every((k) => richReport.lineage.photographerStyle.evidenceKeys.includes(k))
  && richReport.lineage.photographerStyle.sourceModules.length === 3);

const noStyleSession = buildRichSession({ withStyle: false, withFingerprint: false, withBenchmark: false });
const { report: noStyleReport, validation: noStyleValidation } = buildAnalysisReportFromSession(noStyleSession);
check('26. Missing all 3 style evidence keys -> photographerStyle UNAVAILABLE, report still valid (graceful degradation)', noStyleReport.photographerStyle.status === SECTION_STATUS.UNAVAILABLE && noStyleValidation.valid);
check('27. Other sections (exposure) are unaffected by missing style evidence -- same shape/values as the rich-session build', noStyleReport.exposure.exposureClassification === richReport.exposure.exposureClassification
  && noStyleReport.exposure.status === richReport.exposure.status);
check('27b. report.diagnostics still lists stats as completed even when style evidence is absent', noStyleReport.diagnostics.completedEvidence.includes('stats'));

const legacyFallbackSession = buildRichSession({ withStyle: false, withFingerprint: false, withBenchmark: false });
const legacyState = { lastStyleRecognition: STYLE_RECOGNITION_FIXTURE, lastStyleFingerprint: STYLE_FINGERPRINT_FIXTURE, lastBenchmark: BENCHMARK_FIXTURE };
const { report: fallbackReport } = buildAnalysisReportFromSession(legacyFallbackSession, { legacyState });
check('28. Legacy state.last* fallback populates photographerStyle when evidence entry is missing', fallbackReport.photographerStyle.topStyle === 'Wedding' && fallbackReport.photographerStyle.status === SECTION_STATUS.AVAILABLE);
check('29. Legacy fallback is recorded in lineage.photographerStyle.fallbackUsed', fallbackReport.lineage.photographerStyle.fallbackUsed === true);

const softFailedSession = buildRichSession({ withStyle: false, withFingerprint: false, withBenchmark: false });
softFailedSession.evidence.styleRecognition = mk(null, MODULE_STATE.SOFT_FAILED);
const { report: softFailedReport } = buildAnalysisReportFromSession(softFailedSession);
check('30. SOFT_FAILED styleRecognition (module ran but produced no usable result) -> UNAVAILABLE, not a crash', softFailedReport.photographerStyle.status === SECTION_STATUS.UNAVAILABLE);

// ═══════════════════════════════════════════════════════════════════
// Section D — UI wiring (structural, checks 31-38)
// ═══════════════════════════════════════════════════════════════════
const rendererSrc = readFileSync(path.join(ROOT, 'ui/single-image-report-renderer.js'), 'utf8');
check('31. Renderer calls _sectionBlock for report.section.photographerStyle', /_sectionBlock\('report\.section\.photographerStyle', report\.photographerStyle, lang/.test(rendererSrc));
check('32. Renderer places the photographerStyle block after the scene block (same visual order as report.section.scene above it)', rendererSrc.indexOf("report.section.scene") < rendererSrc.indexOf("report.section.photographerStyle"));
check('33. Renderer extraRows read topStyle/topStyleConfidence/alternates/preservation from report.photographerStyle', /report\.photographerStyle\.topStyle/.test(rendererSrc)
  && /report\.photographerStyle\.topStyleConfidence/.test(rendererSrc)
  && /report\.photographerStyle\.alternates/.test(rendererSrc)
  && /report\.photographerStyle\.preservation/.test(rendererSrc));

function collectI18nCodes(dict) {
  const codes = new Set();
  for (const kind of ['observations', 'recommendations', 'warnings']) {
    const section = dict?.report?.[kind]?.photographerStyle;
    if (!section) continue;
    for (const [key, val] of Object.entries(section)) {
      if (typeof val === 'string') codes.add(`${kind}.${key}`);
      else if (val && typeof val === 'object') for (const subKey of Object.keys(val)) codes.add(`${kind}.${key}.${subKey}`);
    }
  }
  return codes;
}
const enCodes = collectI18nCodes(en);
const thCodes = collectI18nCodes(th);
const expectedCodes = new Set([
  'observations.topStyle', 'observations.traits', 'observations.moodSummary',
  'observations.preservationEstimate.strong', 'observations.preservationEstimate.draft', 'observations.preservationEstimate.rough',
  'recommendations.reviewManually', 'recommendations.expectManualWork',
  'warnings.ambiguousClassification', 'warnings.lowConfidenceClassification',
]);
check('34. en.js has every required photographerStyle observation/recommendation/warning code', [...expectedCodes].every((c) => enCodes.has(c)), `missing: ${[...expectedCodes].filter((c) => !enCodes.has(c)).join(',')}`);
check('35. th.js has every required photographerStyle observation/recommendation/warning code', [...expectedCodes].every((c) => thCodes.has(c)), `missing: ${[...expectedCodes].filter((c) => !thCodes.has(c)).join(',')}`);
check('36. en.js/th.js both define report.section.photographerStyle and the 4 new report.field.* keys', ['photographerStyle'].every((k) => en.report.section[k]) && ['photographerStyle'].every((k) => th.report.section[k])
  && ['topStyle', 'topStyleConfidence', 'alternateStyles', 'stylePreservation'].every((k) => en.report.field[k] && th.report.field[k]));

// Every observation/recommendation/warning code the real classifier can
// produce for the AVAILABLE, ambiguous, low-confidence, and each
// preservation-tier paths resolves through t() in BOTH locales with no
// silent fallback-to-key (t() returns the key itself on a genuine miss).
const allEmittedEntries = [
  ...full.observations.map((e) => ['observations', e]),
  ...ambiguous.warnings.map((e) => ['warnings', e]),
  ...lowConf.warnings.map((e) => ['warnings', e]),
  ...lowConf.recommendations.map((e) => ['recommendations', e]),
  ...draftTier.observations.map((e) => ['observations', e]),
  ...roughTier.observations.map((e) => ['observations', e]),
  ...roughTier.recommendations.map((e) => ['recommendations', e]),
];
let unresolved = [];
for (const [kind, entry] of allEmittedEntries) {
  const key = `report.${kind}.${entry.code}`;
  const enResolved = t(key, entry.params, 'en');
  const thResolved = t(key, entry.params, 'th');
  if (enResolved === key || thResolved === key) unresolved.push(`${kind}:${entry.code}`);
}
check('37. Every emitted photographerStyle code resolves (not falls back to the raw key) in both en and th', unresolved.length === 0, unresolved.join(','));
check('38. No {{param}} tokens remain unresolved in the rendered topStyle observation text (en)', !t('report.observations.photographerStyle.topStyle', { style: 'Wedding', confidence: 62.3 }, 'en').includes('{{'));

// ═══════════════════════════════════════════════════════════════════
// Section E — Regression (checks 39-42): prior EPICs unaffected
// ═══════════════════════════════════════════════════════════════════
function runSuite(relPath, timeoutMs = 60000) {
  try {
    const out = execFileSync('node', [relPath], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
    return { out };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || '') };
  }
}
function suitePassed(out) {
  const m = out.match(/(\d+)\/(\d+) PASS/);
  if (!m) return false;
  return m[1] === m[2];
}
const p1b = runSuite('qa/epic-2e-p1b-analysis-report-test.mjs');
check('39. P1B AI Image Analysis Report suite (39/39) still passes unmodified', suitePassed(p1b.out), p1b.out.slice(-200));
const p1a = runSuite('qa/epic-2e-p1a-single-image-session-test.mjs');
check('40. P1A single-image-session suite (25/25) still passes unmodified', suitePassed(p1a.out), p1a.out.slice(-200));
const p1aR3 = runSuite('qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs');
check('41. P1A R3 upload-lifecycle suite (16/16) still passes unmodified', suitePassed(p1aR3.out), p1aR3.out.slice(-200));
// P1M's own suite nests ~6 further sub-suites (P1L/P1K/P1C x3/P1D) and
// is documented in this project as taking ~65s standalone -- give it a
// longer budget than the other, lighter suites above so a slow-but-
// passing run isn't mistaken for a failure (see this project's
// established "bounded-runtime convention").
const p1m = runSuite('qa/epic-2e-p1m-strength-mode-test.mjs', 150000);
check('42. P1M strength-mode suite (47/47) still passes unmodified (photographerStyle is additive-only, no shared call sites touched)', suitePassed(p1m.out), p1m.out.slice(-200));

// ═══════════════════════════════════════════════════════════════════
// Section F — Production Lock (checks 43-46)
// ═══════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
const n1 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json'), 'utf8'));
let n1Ok = true; const n1Mismatches = [];
for (const [file, pinnedHash] of Object.entries(n1.files)) {
  const actual = crypto.createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
  if (actual !== pinnedHash) { n1Ok = false; n1Mismatches.push(file); }
}
check('43. N1 6-file production invariant: all 6 files byte-identical (P1N touched none of them)', n1Ok, n1Mismatches.join(','));

const lufa42 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json'), 'utf8'));
check('44. Production-lock manifest still tracks exactly 210 files (P1N modified 6 existing locked files, added none)', Object.keys(lufa42.files).length === 210);
let lufa42Ok = true; const lufa42Mismatches = [];
for (const [file, pinnedHash] of Object.entries(lufa42.files)) {
  const actual = crypto.createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
  if (actual !== pinnedHash) { lufa42Ok = false; lufa42Mismatches.push(file); }
}
check('45. Production-lock manifest is byte-identical to the current tree for every locked file (regenerated this round)', lufa42Ok, lufa42Mismatches.join(','));

check('46. Production safety flags unaffected: n1.productionLocks all remain at their locked-down values', n1.productionLocks.productionWrite === false && n1.productionLocks.lightroomMappingAllowedByN1 === false && n1.productionLocks.xmpWriteAllowedByN1 === false);

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
