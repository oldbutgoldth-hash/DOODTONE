#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs
 *
 * EPIC 2E-K-R2-FIX1 -- PIXEL TRUTH, DECISION GATE AND EVIDENCE CLOSURE
 *
 * Node-executable hostile static suite for Sections 1, 2, 3, 5, 6, 7,
 * 8 and 11 of FIX1. Every scenario Section 11 explicitly lists is
 * exercised here as a PURE function call against
 * core/calibration-lab/preview-evidence.js and
 * core/calibration-lab/migrate-v1-to-v2.js with synthetic "measured"
 * evidence objects -- this genuinely proves the CLASSIFICATION and
 * GATING logic is correct without needing a real browser (the actual
 * pixel CAPTURE via Canvas is inherently browser-only and is instead
 * exercised, as honestly as this sandbox allows, by
 * qa/epic-2e-k-calibration-lab-browser-test.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyPreviewTruth, computeVisualDecisionEligibility, buildPreviewEvidence,
  isDecisionAllowedForEvidence, deriveUiBlockerReasonCode, createNotRenderedPreviewEvidence,
  isValidPreviewEvidence, isPlausibleSha256Hex, isPixelHashConsistentWithCount,
  countNonTransparentPixels, DEFAULT_BLANK_CANVAS_WIDTH, DEFAULT_BLANK_CANVAS_HEIGHT,
} from '../core/calibration-lab/preview-evidence.js';
import { classifyMigrationNeed, migrateImageRecordV1ToV2, needsV1ToV2Migration } from '../core/calibration-lab/migrate-v1-to-v2.js';
import {
  CALIBRATION_SCHEMA_VERSION, RECORD_SCHEMA_VERSION, createImageTestRecord, validateImageRecord,
  recomputeSessionCounts, createCalibrationSession,
} from '../core/calibration-lab/schema.js';
import { computeDashboardSummary } from '../core/calibration-lab/aggregate.js';
import { computeReadinessReport } from '../core/calibration-lab/readiness.js';
import { PREVIEW_TRUTH_CODES, READINESS_STATUSES } from '../core/calibration-lab/codes.js';
import { calibrationLabT, checkCalibrationLabDictionaryCoverage } from '../ui/calibration-lab/calibration-lab-i18n.js';

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

// Fully genuine, valid-looking evidence for BOTH sides -- the baseline
// every hostile scenario below perturbs exactly one field of.
function genuineBothRenderedDifferent() {
  return {
    sourceAvailable: true, staleGeneration: false, sourceFingerprintMatch: true, sameSourceGeometry: true,
    legacyPreviewState: 'rendered', legacyOutputWidth: 800, legacyOutputHeight: 600,
    legacyNonTransparentPixelCount: 480000, legacyPixelHash: 'a'.repeat(64),
    controlledV2PreviewState: 'rendered', controlledV2OutputWidth: 800, controlledV2OutputHeight: 600,
    controlledV2NonTransparentPixelCount: 480000, controlledV2PixelHash: 'b'.repeat(64),
    pixelDifferenceDetected: true, browserVerified: true,
  };
}

// ── Section 11: hostile Pixel Truth scenarios ──────────────────────────────

{
  const m = genuineBothRenderedDifferent();
  record('Section 11: a fully genuine BOTH_RENDERED_DIFFERENT measurement classifies correctly', classifyPreviewTruth(m) === 'BOTH_RENDERED_DIFFERENT', { code: classifyPreviewTruth(m) });
  record('Section 11: the same genuine measurement is visualDecisionEligible=true', computeVisualDecisionEligibility(m, classifyPreviewTruth(m)) === true, {});
  record('Section 11: LEGACY_BETTER/V2_BETTER are allowed for BOTH_RENDERED_DIFFERENT genuine evidence', isDecisionAllowedForEvidence('V2_BETTER', buildPreviewEvidence(m)) === true && isDecisionAllowedForEvidence('LEGACY_BETTER', buildPreviewEvidence(m)) === true, {});
}

{
  const identical = { ...genuineBothRenderedDifferent(), pixelDifferenceDetected: false, controlledV2PixelHash: 'a'.repeat(64) };
  const code = classifyPreviewTruth(identical);
  record('Section 11: BOTH_RENDERED_IDENTITY classifies correctly when pixelDifferenceDetected=false', code === 'BOTH_RENDERED_IDENTITY', { code });
  record('Section 11: V2_BETTER/LEGACY_BETTER are REJECTED for BOTH_RENDERED_IDENTITY (identical pixels can never mean one side is "better")', isDecisionAllowedForEvidence('V2_BETTER', buildPreviewEvidence(identical)) === false, {});
  record('Section 11: ABOUT_EQUAL IS allowed for BOTH_RENDERED_IDENTITY', isDecisionAllowedForEvidence('ABOUT_EQUAL', buildPreviewEvidence(identical)) === true, {});
}

{
  // "V2 unknown must FAIL" -- the EXACT reported bug scenario.
  const m = { ...genuineBothRenderedDifferent(), controlledV2PreviewState: 'unknown', controlledV2OutputWidth: 0, controlledV2OutputHeight: 0, controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: V2 state "unknown" must FAIL classification (never BOTH_RENDERED_*), reproducing the exact reported defect', code !== 'BOTH_RENDERED_DIFFERENT' && code !== 'BOTH_RENDERED_IDENTITY', { code });
  record('Section 11 HOSTILE: V2 "unknown" state must make visualDecisionEligible=false', computeVisualDecisionEligibility(m, code) === false, {});
  record('Section 11 HOSTILE: Decision Controls are disabled (no decision code allowed) when V2 state is unknown', ['LEGACY_BETTER', 'V2_BETTER', 'ABOUT_EQUAL', 'BOTH_UNACCEPTABLE', 'NOT_SURE'].every(d => isDecisionAllowedForEvidence(d, buildPreviewEvidence(m)) === false), {});
}

{
  // "V2 Canvas empty 300x150 must FAIL" -- the literal untouched default canvas.
  const m = { ...genuineBothRenderedDifferent(), controlledV2PreviewState: 'rendered', controlledV2OutputWidth: DEFAULT_BLANK_CANVAS_WIDTH, controlledV2OutputHeight: DEFAULT_BLANK_CANVAS_HEIGHT, controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: V2 canvas at the untouched default 300x150 size with zero pixels must FAIL as V2_EMPTY_CANVAS, never PASS as rendered', code === 'V2_EMPTY_CANVAS', { code, width: DEFAULT_BLANK_CANVAS_WIDTH, height: DEFAULT_BLANK_CANVAS_HEIGHT });
}

{
  // "Canvas has a size but all-Alpha-zero must FAIL" -- non-default size, still zero non-transparent pixels.
  const m = { ...genuineBothRenderedDifferent(), controlledV2OutputWidth: 640, controlledV2OutputHeight: 480, controlledV2NonTransparentPixelCount: 0 };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: a non-default-size canvas that is nonetheless fully alpha-zero (nonTransparentPixelCount=0) must FAIL, not PASS just because it is not exactly 300x150', code !== 'BOTH_RENDERED_DIFFERENT' && code !== 'BOTH_RENDERED_IDENTITY', { code });
}

{
  // "Legacy rendered but V2 failed must Disable Decision"
  const m = { ...genuineBothRenderedDifferent(), controlledV2PreviewState: 'failed', controlledV2OutputWidth: 0, controlledV2OutputHeight: 0, controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null };
  const ev = buildPreviewEvidence(m);
  record('Section 11 HOSTILE: Legacy rendered + V2 failed classifies as V2_RENDER_FAILED and disables every comparative decision', ev.previewTruthCode === 'V2_RENDER_FAILED' && ev.visualDecisionEligible === false, { previewTruthCode: ev.previewTruthCode });
}

{
  // "Legacy failed but V2 rendered must Disable Decision"
  const m = { ...genuineBothRenderedDifferent(), legacyPreviewState: 'failed', legacyOutputWidth: 0, legacyOutputHeight: 0, legacyNonTransparentPixelCount: 0, legacyPixelHash: null };
  const ev = buildPreviewEvidence(m);
  record('Section 11 HOSTILE: Legacy failed + V2 rendered classifies as LEGACY_RENDER_FAILED and disables every comparative decision (a rendered V2 alone is never sufficient)', ev.previewTruthCode === 'LEGACY_RENDER_FAILED' && ev.visualDecisionEligible === false, { previewTruthCode: ev.previewTruthCode });
}

{
  // "fake Pixel Hash must FAIL" -- syntactically invalid hash string.
  const m = { ...genuineBothRenderedDifferent(), controlledV2PixelHash: 'not-a-real-sha256-hash' };
  record('Section 11 HOSTILE: a syntactically invalid (fake) pixel hash is rejected by isPlausibleSha256Hex', isPlausibleSha256Hex(m.controlledV2PixelHash) === false, {});
  const ev = buildPreviewEvidence(m);
  record('Section 11 HOSTILE: a record with a fake V2 pixel hash never carries that fake hash forward in previewEvidence (sanitized to null)', ev.controlledV2PixelHash === null, { controlledV2PixelHash: ev.controlledV2PixelHash });
}

{
  // "Hash of a Blank Canvas must FAIL" -- a hash that matches the known blank-buffer reference hash for this exact size, even though nonTransparentPixelCount claims > 0 (a hostile/buggy measurement).
  const blankHash = 'c'.repeat(64);
  const consistent = isPixelHashConsistentWithCount(blankHash, 500, blankHash);
  record('Section 11 HOSTILE: a pixel hash that matches the known blank-canvas reference hash for this size is rejected as evidence even if a non-zero pixel count is claimed alongside it', consistent === false, { consistent });
}

{
  // "different Source fingerprints must FAIL"
  const m = { ...genuineBothRenderedDifferent(), sourceFingerprintMatch: false };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: sourceFingerprintMatch=false classifies as SOURCE_MISMATCH regardless of otherwise-genuine pixel data', code === 'SOURCE_MISMATCH', { code });
  record('Section 11 HOSTILE: SOURCE_MISMATCH disables every comparative decision', ['LEGACY_BETTER', 'V2_BETTER', 'ABOUT_EQUAL'].every(d => isDecisionAllowedForEvidence(d, buildPreviewEvidence(m)) === false), {});
}

{
  // "old Generation ID must FAIL"
  const m = { ...genuineBothRenderedDifferent(), staleGeneration: true };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: staleGeneration=true classifies as STALE_GENERATION even with otherwise-genuine pixel data', code === 'STALE_GENERATION', { code });
}

{
  // "different Geometry must FAIL"
  const m = { ...genuineBothRenderedDifferent(), sameSourceGeometry: false };
  const code = classifyPreviewTruth(m);
  record('Section 11 HOSTILE: sameSourceGeometry=false classifies as GEOMETRY_MISMATCH', code === 'GEOMETRY_MISMATCH', { code });
}

{
  // "CSS-filter-only preview / screenshot-evidence-only must FAIL" --
  // modeled as browserVerified=false (no genuine Canvas pixel capture
  // occurred), which must make visualDecisionEligible false even if
  // every OTHER field claims success.
  const m = { ...genuineBothRenderedDifferent(), browserVerified: false };
  record('Section 11 HOSTILE: browserVerified=false (no genuine Canvas capture -- e.g. CSS-filter-only or screenshot-only evidence) makes visualDecisionEligible false even when every other field claims success', computeVisualDecisionEligibility(m, classifyPreviewTruth(m)) === false, {});
}

{
  // "V1 Decision must never enter Readiness" -- exercised via the real schema/readiness modules together.
  const session = createCalibrationSession({ locale: 'th', appVersion: 'test' });
  const migratedLikeRecord = {
    ...createImageTestRecord({ imageCategories: ['EVENT'], lightingCondition: 'MIXED' }),
    userDecision: 'V2_BETTER', legacyDecisionPreservedForAudit: true, requiresVisualReReview: true,
  };
  const recomputed = recomputeSessionCounts(session, [migratedLikeRecord]);
  record('Section 11 HOSTILE: a V1-migrated decision (legacyDecisionPreservedForAudit=true) never increments session.v2Wins/legacyWins/ties/bothRejected', recomputed.v2Wins === 0 && recomputed.legacyWins === 0 && recomputed.ties === 0 && recomputed.bothRejected === 0 && recomputed.legacyAuditOnlyCount === 1, { recomputed });
  const dash = computeDashboardSummary([migratedLikeRecord]);
  record('Section 11 HOSTILE: a V1-migrated decision never counts toward Dashboard reviewedCount/win-rate math', dash.reviewedCount === 0, { dash });
  const readiness = computeReadinessReport([migratedLikeRecord]);
  record('Section 11 HOSTILE: unverifiedLegacyRecordCount reflects the pending-re-review record', readiness.unverifiedLegacyRecordCount === 1, { unverifiedLegacyRecordCount: readiness.unverifiedLegacyRecordCount });
}

{
  // "Controller must reject V2_BETTER even when called directly, bypassing the UI" / "reject LEGACY_BETTER when V2 unavailable" --
  // proven here at the pure-gate level (the Controller itself calls
  // this exact function -- see calibration-lab-controller.js's
  // saveCurrentDecision(), verified structurally further below).
  const notRendered = createNotRenderedPreviewEvidence();
  record('Section 11 HOSTILE: isDecisionAllowedForEvidence rejects V2_BETTER against NOT_RENDERED evidence (the Controller-level gate, independent of any UI)', isDecisionAllowedForEvidence('V2_BETTER', notRendered) === false, {});
  record('Section 11 HOSTILE: isDecisionAllowedForEvidence rejects LEGACY_BETTER when V2 is unavailable (NOT_RENDERED evidence)', isDecisionAllowedForEvidence('LEGACY_BETTER', notRendered) === false, {});
  record('Section 11 HOSTILE: isDecisionAllowedForEvidence rejects a malformed/missing previewEvidence object entirely (fails closed, never throws)', isDecisionAllowedForEvidence('V2_BETTER', null) === false && isDecisionAllowedForEvidence('V2_BETTER', undefined) === false, {});
  record('Section 11: NOT_REVIEWED is always allowed regardless of evidence state (the one universal "clear" decision)', isDecisionAllowedForEvidence('NOT_REVIEWED', null) === true && isDecisionAllowedForEvidence('NOT_REVIEWED', notRendered) === true, {});
}

// ── Section 1: UI blocker reason codes ─────────────────────────────────────

{
  const cases = [
    ['V2_RENDER_FAILED', { ...genuineBothRenderedDifferent(), controlledV2PreviewState: 'failed', controlledV2OutputWidth: 0, controlledV2OutputHeight: 0, controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null }],
    ['V2_EMPTY_CANVAS', { ...genuineBothRenderedDifferent(), controlledV2OutputWidth: DEFAULT_BLANK_CANVAS_WIDTH, controlledV2OutputHeight: DEFAULT_BLANK_CANVAS_HEIGHT, controlledV2NonTransparentPixelCount: 0, controlledV2PixelHash: null }],
    ['V2_STALE_GENERATION', { ...genuineBothRenderedDifferent(), staleGeneration: true }],
    ['V2_SOURCE_MISMATCH', { ...genuineBothRenderedDifferent(), sourceFingerprintMatch: false }],
    ['GEOMETRY_MISMATCH', { ...genuineBothRenderedDifferent(), sameSourceGeometry: false }],
  ];
  for (const [expected, m] of cases) {
    const ev = buildPreviewEvidence(m);
    const blocker = deriveUiBlockerReasonCode(ev, { v2RenderPlanAvailable: true });
    record(`Section 1: deriveUiBlockerReasonCode() returns ${expected} for the corresponding evidence`, blocker === expected, { blocker, previewTruthCode: ev.previewTruthCode });
  }
  const eligibleEv = buildPreviewEvidence(genuineBothRenderedDifferent());
  record('Section 1: deriveUiBlockerReasonCode() returns null when nothing is blocked', deriveUiBlockerReasonCode(eligibleEv, { v2RenderPlanAvailable: true }) === null, {});
  record('Section 1: deriveUiBlockerReasonCode() returns V2_RENDER_PLAN_UNAVAILABLE when no render plan was ever available', deriveUiBlockerReasonCode(createNotRenderedPreviewEvidence(), { v2RenderPlanAvailable: false }) === 'V2_RENDER_PLAN_UNAVAILABLE', {});
}

// ── Section 2: Calibration Schema V2 ───────────────────────────────────────

{
  record('Section 2: CALIBRATION_SCHEMA_VERSION is 2', CALIBRATION_SCHEMA_VERSION === 2, { CALIBRATION_SCHEMA_VERSION });
  record('Section 2: RECORD_SCHEMA_VERSION is 2', RECORD_SCHEMA_VERSION === 2, { RECORD_SCHEMA_VERSION });
  const rec = createImageTestRecord({ imageCategories: ['PORTRAIT'], lightingCondition: 'DAYLIGHT' });
  record('Section 2: a freshly created record has a previewEvidence object', isValidPreviewEvidence(rec.previewEvidence), {});
  record('Section 2: a freshly created record defaults to previewTruthCode=NOT_RENDERED (never eligible by default)', rec.previewEvidence.previewTruthCode === 'NOT_RENDERED' && rec.previewEvidence.visualDecisionEligible === false, {});
  record('Section 2: a freshly created record defaults legacyDecisionPreservedForAudit/requiresVisualReReview to false', rec.legacyDecisionPreservedForAudit === false && rec.requiresVisualReReview === false, {});
  record('Section 2: validateImageRecord() accepts the freshly created v2 record', validateImageRecord(rec), {});
  record('Section 2: validateImageRecord() REJECTS a record with a malformed previewEvidence (fails closed)', validateImageRecord({ ...rec, previewEvidence: { garbage: true } }) === false, {});
  record('Section 2: validateImageRecord() REJECTS a record missing recordSchemaVersion entirely', validateImageRecord((() => { const { recordSchemaVersion, ...rest } = rec; return rest; })()) === false, {});
  record('Section 2: previewTruthCode enum has exactly the 10 FIX1-required stable codes plus the 4 FIX2 additions (14 total)', PREVIEW_TRUTH_CODES.length === 14, { PREVIEW_TRUTH_CODES });
  record('Section 2: readiness statuses now include the 3 new FIX1 statuses', ['NEEDS_BROWSER_VERIFICATION', 'NEEDS_PIXEL_PREVIEW', 'NEEDS_REVIEW_REFRESH'].every(s => READINESS_STATUSES.includes(s)), { READINESS_STATUSES });
}

// ── Section 5: Migration idempotency/fail-closed/never-loses-data ─────────

{
  const v1 = { imageId: 'cal-image-mig-1', imageFingerprint: 'dhash-abc', imageCategories: ['PORTRAIT'], lightingCondition: 'DAYLIGHT', containsSkin: false, analysisGenerationId: 'gen-1', legacySnapshot: null, controlledV2Snapshot: null, safetySnapshot: null, userDecision: 'LEGACY_BETTER', issueCodes: ['WB_TOO_WARM'], notes: 'original note', reviewedAt: '2024-01-01T00:00:00.000Z' };
  record('Section 5: a raw v1-shaped record (no previewEvidence/recordSchemaVersion) is classified NEEDS_MIGRATION', classifyMigrationNeed(v1) === 'NEEDS_MIGRATION', {});
  const migrated = migrateImageRecordV1ToV2(v1);
  record('Section 5: migration adds recordSchemaVersion=2 and a NOT_RENDERED previewEvidence', migrated.recordSchemaVersion === 2 && migrated.previewEvidence.previewTruthCode === 'NOT_RENDERED', {});
  record('Section 5: migration PRESERVES the original decision/notes/issueCodes/reviewedAt verbatim (never resets or loses them)', migrated.userDecision === 'LEGACY_BETTER' && migrated.notes === 'original note' && JSON.stringify(migrated.issueCodes) === JSON.stringify(['WB_TOO_WARM']) && migrated.reviewedAt === '2024-01-01T00:00:00.000Z', {});
  record('Section 5: migration flags legacyDecisionPreservedForAudit=true and requiresVisualReReview=true for a record that HAD a prior decision', migrated.legacyDecisionPreservedForAudit === true && migrated.requiresVisualReReview === true, {});
  record('Section 5: migration is IDEMPOTENT -- migrating an already-migrated record returns the exact same object reference, unchanged', migrateImageRecordV1ToV2(migrated) === migrated, {});
  record('Section 5: the migrated record passes validateImageRecord() (a genuinely valid v2 shape)', validateImageRecord(migrated), {});

  const v1NeverReviewed = { ...v1, imageId: 'cal-image-mig-2', userDecision: 'NOT_REVIEWED', notes: '' };
  const migratedNeverReviewed = migrateImageRecordV1ToV2(v1NeverReviewed);
  record('Section 5: a v1 record that was NEVER reviewed does not get flagged for audit/re-review (nothing to preserve/re-review)', migratedNeverReviewed.legacyDecisionPreservedForAudit === false && migratedNeverReviewed.requiresVisualReReview === false, {});

  record('Section 5 FAIL-CLOSED: a record missing imageId is classified CORRUPT, never guessed at', classifyMigrationNeed({ notes: 'no imageId here' }) === 'CORRUPT', {});
  record('Section 5 FAIL-CLOSED: migrateImageRecordV1ToV2() returns null (never throws, never invents data) for a corrupt row', migrateImageRecordV1ToV2({ notes: 'no imageId here' }) === null, {});
  record('Section 5 FAIL-CLOSED: migrateImageRecordV1ToV2() returns null for a completely non-object input', migrateImageRecordV1ToV2(null) === null && migrateImageRecordV1ToV2(undefined) === null && migrateImageRecordV1ToV2('a string') === null, {});
  record('Section 5: needsV1ToV2Migration() is false for an already-up-to-date record and false for a corrupt one (only true for the genuine migration case)', needsV1ToV2Migration(migrated) === false && needsV1ToV2Migration({ notes: 'corrupt' }) === false && needsV1ToV2Migration(v1) === true, {});
}

// ── Section 7: Clear Current Answer genuinely empties Notes ────────────────

{
  const controllerSrc = readSrc('ui/calibration-lab/calibration-lab-controller.js');
  const clearFn = controllerSrc.match(/async function clearCurrentAnswer\(\)\s*\{[\s\S]*?\n  \}/);
  record('Section 7: clearCurrentAnswer() exists as its own real implementation (not a thin wrapper around saveCurrentDecision reusing the old notes value)', !!clearFn, {});
  if (clearFn) {
    record('Section 7: clearCurrentAnswer() sets notes to an empty string literal, never `records[currentIndex]?.notes` (the exact R2 bug)', /notes:\s*''/.test(clearFn[0]) && !/notes:\s*records\[currentIndex\]\?\.notes/.test(clearFn[0]), {});
    record('Section 7: clearCurrentAnswer() resets userDecision to NOT_REVIEWED', /userDecision:\s*'NOT_REVIEWED'/.test(clearFn[0]), {});
    record('Section 7: clearCurrentAnswer() resets issueCodes to an empty array', /issueCodes:\s*\[\]/.test(clearFn[0]), {});
    record('Section 7: clearCurrentAnswer() resets reviewedAt to null', /reviewedAt:\s*null/.test(clearFn[0]), {});
  }
}

// ── Section 3: Decision Eligibility Gate is checked in BOTH renderer and controller ──

{
  const controllerSrc = readSrc('ui/calibration-lab/calibration-lab-controller.js');
  const rendererSrc = readSrc('ui/calibration-lab/calibration-lab-renderer.js');
  record('Section 3: the Controller imports isDecisionAllowedForEvidence from the shared pure gate module', /import\s*\{[^}]*isDecisionAllowedForEvidence[^}]*\}\s*from\s*'\.\.\/\.\.\/core\/calibration-lab\/preview-evidence\.js'/.test(controllerSrc), {});
  record('Section 3: saveCurrentDecision() calls isDecisionAllowedForEvidence() BEFORE persisting (never relies on the caller having already checked)', /isDecisionAllowedForEvidence\(userDecision,\s*currentEvidence\)/.test(controllerSrc), {});
  record('Section 3: the Renderer ALSO imports isDecisionAllowedForEvidence from the exact SAME module (no second, UI-only copy of the gate logic)', /import\s*\{[^}]*isDecisionAllowedForEvidence[^}]*\}\s*from\s*'\.\.\/\.\.\/core\/calibration-lab\/preview-evidence\.js'/.test(rendererSrc), {});
  record('Section 3: the Renderer sets a real `disabled` attribute on ineligible decision chips', /disabled:\s*'disabled'/.test(rendererSrc), {});
}

// ── Section 8: locale header hardcoded-English hostile check ──────────────

{
  const indexHtml = readSrc('index.html');
  const navBtnMatch = indexHtml.match(/<button id="calibrationLabNavBtn"[\s\S]*?<\/button>/);
  record('Section 8 HOSTILE: index.html\'s #calibrationLabNavBtn markup does not contain the literal visible text "Calibration Lab" anywhere (the exact reported defect)', !!navBtnMatch && !/>\s*Calibration Lab\s*</.test(navBtnMatch[0]) && !/Calibration Lab\s*<\/button>/.test(navBtnMatch[0]), { snippet: navBtnMatch ? navBtnMatch[0].slice(0, 200) : null });
  record('Section 8 HOSTILE: the button markup no longer hardcodes a `title="Calibration Lab"` attribute', !!navBtnMatch && !/title="Calibration Lab"/.test(navBtnMatch[0]), {});

  const entrySrc = readSrc('ui/calibration-lab/calibration-lab-entry.js');
  record('Section 8: calibration-lab-entry.js sets the nav button\'s text/title/aria-label from calibrationLabT(\'nav.openButton\', ...) reactively', /calibrationLabT\('nav\.openButton'/.test(entrySrc) && /navBtn\.title\s*=\s*label/.test(entrySrc) && /navBtn\.setAttribute\('aria-label',\s*label\)/.test(entrySrc), {});
  record('Section 8: the nav label is re-applied inside the MutationObserver callback (genuinely reactive to language changes, not just set once at bootstrap)', (() => {
    const observerBlock = entrySrc.match(/const langObserver = new MutationObserver\(\(\) => \{[\s\S]*?\}\);/);
    return !!observerBlock && observerBlock[0].includes('_applyNavButtonLabel(navBtn)');
  })(), {});

  const th = calibrationLabT('nav.openButton', 'th');
  const en = calibrationLabT('nav.openButton', 'en');
  record('Section 8: Thai nav.openButton translation is genuinely different from the English one', th !== en && th.length > 0, { th, en });
  record('Section 8: Thai nav.openButton does NOT contain the literal English words "Calibration Lab"', !/Calibration Lab/i.test(th), { th });
}

// ── Coverage: dictionary still fully covers every stable code + new keys ──

{
  const coverage = checkCalibrationLabDictionaryCoverage();
  record('Coverage: calibrationLabT dictionary has zero missing keys across en/th (including the new pixelPreview.blocker.* and readiness.* FIX1 entries)', coverage.ok === true, { missing: coverage.missing });
}

console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
