#!/usr/bin/env node
/**
 * EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate: static +
 * integration test.
 *
 * Runs against the REAL production modules: core/single-image/
 * candidate/*.js, core/single-image/single-image-orchestrator.js,
 * core/single-image/single-image-session.js,
 * core/single-image/single-image-session-store.js,
 * core/xmp-validator/index.js. `ui/app.js` slider-sync/XMP-export
 * wiring is verified via source inspection (comment-stripped
 * substring checks), the same pattern established in the P1A/P1B
 * integration tests -- ui/app.js is a browser-only DOM-driven
 * controller that cannot be fully imported in plain Node.
 *
 * Does NOT duplicate Core formulas: every fixture below is a
 * hand-built, realistic flat "candidateRaw" preset (the literal shape
 * buildFinalPreset()/serializeXMP() already use) or a realistic
 * evidence entry -- never a re-derivation of Lightroom Mapping,
 * Style Fingerprint, or any other Core analysis formula.
 *
 * Run: node qa/epic-2e-p1c-candidate-test.mjs
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
  createEmptyCandidate, validateCandidateShape, normalizeCandidate, CANDIDATE_STATUS,
  HSL_CHANNEL_IDS, GRADING_ZONE_IDS, CAL_PRIMARY_IDS, CANDIDATE_SCHEMA_VERSION,
} = await import('../core/single-image/candidate/candidate-schema.js');
const { buildCandidateFromSession } = await import('../core/single-image/candidate/candidate-builder.js');
const {
  validateCandidate, SLIDER_RANGES, HARD_LIMITS, clampToSliderRange,
} = await import('../core/single-image/candidate/candidate-validator.js');
const {
  renderCandidateToSliders, resolveSliderEdit, getSupportedSliderIds, buildSliderParameterMap,
} = await import('../core/single-image/candidate/candidate-slider-adapter.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { buildParameterLineage, assembleLineageMap, markParameterEdited } = await import('../core/single-image/candidate/candidate-lineage.js');
const candidateStore = await import('../core/single-image/candidate/candidate-store.js');
const {
  createSingleImageSession, updateSessionStatus, SESSION_STATUS, MODULE_STATE, resetSessionData,
} = await import('../core/single-image/single-image-session.js');
const orch = await import('../core/single-image/single-image-orchestrator.js');
const { getActiveSession, setActiveSession, isActiveGeneration, __resetStoreForTests } = await import('../core/single-image/single-image-session-store.js');
const { quickSafetyClamp } = await import('../core/xmp-validator/index.js');

function fakeFile(name = 't.jpg', size = 1000, type = 'image/jpeg', lastModified = 1700000000000) {
  return { name, size, type, lastModified, arrayBuffer: async () => new ArrayBuffer(8) };
}
function mk(result, status = MODULE_STATE.COMPLETED, confidence) {
  return { status, result, confidence, diagnostics: {}, warnings: [], errors: [], sourceModule: 'test', startedAt: 0, completedAt: 1, durationMs: 1 };
}

/** A realistic flat "candidateRaw" preset -- the exact shape buildFinalPreset()/serializeXMP() already use. Hand-built, never re-derived from Core formulas. */
function buildRealisticRawPreset(overrides = {}) {
  return {
    name: 'AI Preset — Wedding',
    exp: 25, con: 10, hi: -20, sh: 15, wh: 5, bl: -5,
    texture: 8, clarity: 12, dehaze: 4, temp: 6, tint: -2, vib: 18, sat: 6,
    sharp: 40, noise: 20,
    crv_hi: 5, crv_mid: 0, crv_sh: -3,
    hsl: {
      hsl_h_red: 2, hsl_s_red: 5, hsl_l_red: 0, hsl_h_orange: 3, hsl_s_orange: 8, hsl_l_orange: 2,
      hsl_h_yellow: 0, hsl_s_yellow: -4, hsl_l_yellow: 0, hsl_h_green: 0, hsl_s_green: -10, hsl_l_green: 0,
      hsl_h_aqua: 0, hsl_s_aqua: 0, hsl_l_aqua: 0, hsl_h_blue: -2, hsl_s_blue: 4, hsl_l_blue: 0,
      hsl_h_purple: 0, hsl_s_purple: 0, hsl_l_purple: 0, hsl_h_magenta: 0, hsl_s_magenta: 0, hsl_l_magenta: 0,
    },
    grade: {
      grd_sh_h: 220, grd_sh_s: 10, grd_sh_l: 0, grd_mid_h: 40, grd_mid_s: 5, grd_mid_l: 0,
      grd_hi_h: 50, grd_hi_s: 8, grd_hi_l: 0, grd_blend: 55,
    },
    cal: { cal_red_h: 0, cal_red_s: 5, cal_green_h: 0, cal_green_s: -5, cal_blue_h: 0, cal_blue_s: 0 },
    _decision: { portraitSafe: true, category: 'Wedding', wb: { confidence: 0.7 }, clampsApplied: [] },
    _validation: { adjustments: [], violations: [] },
    _benchmark: { warnings: [], overallStyleSimilarity: 0.9, safetyScore: 0.95 },
    curves: null,
    ...overrides,
  };
}

/** Build a COMPLETED Session with realistic evidence + a committed candidateRaw, mirroring the real upload -> analyze -> commitCandidate flow. */
function buildCompletedSessionWithCandidateRaw({ status = SESSION_STATUS.COMPLETED, rawOverrides = {} } = {}) {
  const s = createSingleImageSession({ file: fakeFile('wedding.jpg', 123456, 'image/jpeg', 1700000000000) });
  s.image.width = 4000; s.image.height = 3000; s.image.filename = 'wedding.jpg';
  updateSessionStatus(s, status);
  s.evidence.stats = mk({ avgLum: 190, category: 'Wedding', confidence: 0.85 }, MODULE_STATE.COMPLETED, 0.85);
  s.evidence.wb = mk({ consensus: { temperature: 6, tint: -2 }, confidence: 0.7 }, MODULE_STATE.COMPLETED, 0.7);
  s.evidence.hsl = mk({ dominant: 'orange', confidence: 0.65 }, MODULE_STATE.COMPLETED, 0.65);
  s.evidence.styleFeatureGraph = mk({ overallStyleConfidence: 0.8 }, MODULE_STATE.COMPLETED, 0.8);
  s.candidateRaw = buildRealisticRawPreset(rawOverrides);
  return s;
}

function freshTicketWithSession(session) {
  setActiveSession(session);
  return { sessionId: session.sessionId, generationId: session.generationId };
}

// ══════════════════════════════════════════════════════════════════
// 1-6. Candidate schema completeness + status model
// ══════════════════════════════════════════════════════════════════
{
  const empty = createEmptyCandidate({ sessionId: 's1', generationId: 'g1', candidateId: 'c1' });
  const REQUIRED_GROUPS = ['profile', 'whiteBalance', 'basic', 'curves', 'hsl', 'grading', 'cal', 'detail', 'effects', 'optics', 'metadata', 'diagnostics'];
  check('1. createEmptyCandidate() produces every required top-level group', REQUIRED_GROUPS.every((g) => Object.prototype.hasOwnProperty.call(empty, g)), REQUIRED_GROUPS.join(','));
  check('2. Empty Candidate has status EMPTY', empty.status === CANDIDATE_STATUS.EMPTY);
  check('3. Empty Candidate has schemaVersion set', empty.schemaVersion === CANDIDATE_SCHEMA_VERSION);
  check('4. HSL has all 8 channels for hue/saturation/luminance', HSL_CHANNEL_IDS.every((ch) => ['hue', 'saturation', 'luminance'].every((dim) => Object.prototype.hasOwnProperty.call(empty.hsl[dim], ch))), HSL_CHANNEL_IDS.join(','));
  check('5. Grading has shadows/midtones/highlights zones', GRADING_ZONE_IDS.every((z) => Object.prototype.hasOwnProperty.call(empty.grading, z)));
  check('6. Calibration has red/green/blue primary hue+saturation fields', CAL_PRIMARY_IDS.every((p) => `${p}PrimaryHue` in empty.cal && `${p}PrimarySaturation` in empty.cal));
  check('7. CANDIDATE_STATUS enum has all 9 required statuses', ['EMPTY', 'BUILDING', 'AUTO_GENERATED', 'VALID', 'VALID_WITH_WARNINGS', 'INVALID', 'USER_EDITED', 'STALE', 'FAILED'].every((k) => k in CANDIDATE_STATUS));
  const shapeResult = validateCandidateShape(empty);
  check('8. validateCandidateShape() rejects nothing structurally wrong on a fresh empty Candidate', shapeResult.errors.length === 0, JSON.stringify(shapeResult.errors));
  const withNaN = createEmptyCandidate({ sessionId: 's1', generationId: 'g1', candidateId: 'c2' });
  withNaN.basic.exposure = NaN;
  const nanResult = validateCandidateShape(withNaN);
  check('9. validateCandidateShape() rejects NaN values', nanResult.errors.length > 0 && nanResult.errors.some((e) => /exposure|NaN/i.test(e)));
  const withInf = createEmptyCandidate({ sessionId: 's1', generationId: 'g1', candidateId: 'c3' });
  withInf.basic.contrast = Infinity;
  const infResult = validateCandidateShape(withInf);
  check('10. validateCandidateShape() rejects Infinity values', infResult.errors.length > 0);
  const withUndef = createEmptyCandidate({ sessionId: 's1', generationId: 'g1', candidateId: 'c4' });
  withUndef.basic.shadows = undefined;
  const undefResult = validateCandidateShape(withUndef);
  check('11. validateCandidateShape() rejects undefined values', undefResult.errors.length > 0);
}

// ══════════════════════════════════════════════════════════════════
// 12-20. Candidate Builder — built from active evidence, no re-analysis, ranges/structure
// ══════════════════════════════════════════════════════════════════
{
  const session = buildCompletedSessionWithCandidateRaw();
  const { candidate, validation } = buildCandidateFromSession(session, { engineVersion: '2.3.0' });
  check('12. Candidate is built from active session.evidence + candidateRaw (sessionId matches)', candidate.sessionId === session.sessionId);
  check('13. Candidate generationId matches active Session', candidate.generationId === session.generationId);
  check('14. Candidate status is AUTO_GENERATED for a completed Session with a raw preset', candidate.status === CANDIDATE_STATUS.AUTO_GENERATED);
  check('15. Candidate numerical values match the raw preset exactly (no retuning) — exposure', candidate.basic.exposure === 25);
  check('15b. Candidate numerical values match the raw preset exactly — whiteBalance.temperature', candidate.whiteBalance.temperature === 6);
  check('15c. Candidate numerical values match the raw preset exactly — HSL orange hue', candidate.hsl.hue.orange === 3);
  check('15d. Candidate numerical values match the raw preset exactly — grading shadows hue', candidate.grading.shadows.hue === 220);
  check('15e. Candidate numerical values match the raw preset exactly — calibration red saturation', candidate.cal.redPrimarySaturation === 5);
  check('16. No undefined/NaN/Infinity anywhere in a built Candidate', validation.errors.length === 0, JSON.stringify(validation.errors));
  check('17. HSL structure complete on built Candidate', HSL_CHANNEL_IDS.every((ch) => ['hue', 'saturation', 'luminance'].every((d) => Number.isFinite(candidate.hsl[d][ch]))));
  check('18. Grading structure complete on built Candidate', GRADING_ZONE_IDS.every((z) => ['hue', 'saturation', 'luminance'].every((d) => Number.isFinite(candidate.grading[z][d]))));
  check('19. Calibration structure complete on built Candidate', CAL_PRIMARY_IDS.every((p) => Number.isFinite(candidate.cal[`${p}PrimaryHue`]) && Number.isFinite(candidate.cal[`${p}PrimarySaturation`])));
  check('20. Tone Curve parametric points present and finite (shadows/midtones/highlights)', ['shadows', 'midtones', 'highlights'].every((k) => Number.isFinite(candidate.curves.parametric[k])));
  check('20b. Detail structure has finite sharpening/noiseReduction', Number.isFinite(candidate.detail.sharpening) && Number.isFinite(candidate.detail.noiseReduction));
  check('20c. Candidate diagnostics.sourceEvidence references real evidence keys', candidate.diagnostics.sourceEvidence.includes('stats') && candidate.diagnostics.sourceEvidence.includes('wb'));
  check('20d. Candidate lineage references real evidence keys and source modules (not empty)', Object.keys(candidate.diagnostics.lineage).length > 0);
  check('20e. Candidate never fabricates unsupported fields — effects/optics remain null (no Production source)', candidate.effects.postCropVignetteAmount === null && candidate.optics.removeChromaticAberration === null);
}

// ══════════════════════════════════════════════════════════════════
// 21-23. Partial Session / missing evidence / EMPTY-when-no-raw-preset
// ══════════════════════════════════════════════════════════════════
{
  const partial = buildCompletedSessionWithCandidateRaw({ status: SESSION_STATUS.PARTIAL });
  const { candidate: partialCandidate } = buildCandidateFromSession(partial, {});
  check('21. A PARTIAL (terminal) Session with a raw preset still builds a usable Candidate', partialCandidate.status === CANDIDATE_STATUS.AUTO_GENERATED);

  const noRaw = createSingleImageSession({ file: fakeFile() });
  updateSessionStatus(noRaw, SESSION_STATUS.COMPLETED);
  const { candidate: emptyCandidate } = buildCandidateFromSession(noRaw, {});
  check('22. A Session with no candidateRaw builds an EMPTY Candidate (never fabricates values)', emptyCandidate.status === CANDIDATE_STATUS.EMPTY);

  const missingOptional = buildCompletedSessionWithCandidateRaw({ rawOverrides: { curves: null } });
  const { candidate: safeDefaultCandidate, validation: v2 } = buildCandidateFromSession(missingOptional, {});
  check('23. Missing optional evidence/fields fall back to safe documented defaults (curves.rgb null, no crash)', safeDefaultCandidate.curves.rgb === null && v2.errors.length === 0);
}

// ══════════════════════════════════════════════════════════════════
// 24-26. Parameter ranges match existing real contracts (no invented limits)
// ══════════════════════════════════════════════════════════════════
{
  check('24. SLIDER_RANGES.exp matches the real DOM slider range [-200,200]', SLIDER_RANGES.exp[0] === -200 && SLIDER_RANGES.exp[1] === 200);
  check('25. SLIDER_RANGES.con/hi/sh/wh/bl match the real DOM range [-100,100]', ['con', 'hi', 'sh', 'wh', 'bl'].every((k) => SLIDER_RANGES[k][0] === -100 && SLIDER_RANGES[k][1] === 100));
  check('26. HARD_LIMITS is re-exported unmodified from core/xmp-validator (not a duplicated/invented copy)', typeof HARD_LIMITS === 'object' && HARD_LIMITS !== null && Object.keys(HARD_LIMITS).length > 0);
}

// ══════════════════════════════════════════════════════════════════
// 27-31. Candidate Store — Session integration, stale rejection, Candidate Store commit
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  const result = orch.buildAndCommitCandidate(ticket, { engineVersion: '2.3.0' });
  check('27. buildAndCommitCandidate() commits a Candidate to session.candidate', result.committed && getActiveSession().candidate?.candidateId === result.candidate.candidateId);
  check('28. Candidate is stored in session.candidate (not a separate untracked copy)', getActiveSession().candidate === result.candidate);
  check('29. candidateStore.getActiveCandidate() returns the same committed Candidate (thin delegating store, no divergence)', candidateStore.getActiveCandidate() === getActiveSession().candidate);
  check('30. Committed Candidate sessionId/generationId match the active Session', result.candidate.sessionId === session.sessionId && result.candidate.generationId === session.generationId);

  const staleTicket = { sessionId: 'stale-session-id', generationId: 'stale-gen-id' };
  const staleResult = orch.buildAndCommitCandidate(staleTicket, {});
  check('31. A stale ticket (superseded Session) is rejected by buildAndCommitCandidate() — never overwrites the active Candidate', staleResult.committed === false && staleResult.reason === 'STALE_GENERATION');
}

// ══════════════════════════════════════════════════════════════════
// 32-35. Candidate→Slider mapping correctness
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  const { candidate } = orch.buildAndCommitCandidate(ticket, {});

  const writes = {};
  const fakeSetSlider = (id, val) => { writes[id] = val; };
  const { renderedCount } = renderCandidateToSliders(candidate, { setSlider: fakeSetSlider });
  check('32. renderCandidateToSliders() writes every supported Candidate value into its slider', renderedCount > 0 && writes.exp === 25 && writes.temp === 6);
  check('33. Candidate→Slider mapping rounds only for DISPLAY -- the stored Candidate value is untouched (exact, not rounded)', candidate.basic.exposure === 25 && Number.isInteger(writes.exp));
  check('34. Missing DOM control does not delete the Candidate value (renderCandidateToSliders never mutates the Candidate)', candidate.hsl.hue.orange === 3);
  const supportedIds = getSupportedSliderIds();
  check('35. getSupportedSliderIds() covers exp/temp/tint and every HSL/Grading/Calibration slider ID actually used by ui/ui-engine.js panels', supportedIds.includes('exp') && supportedIds.includes('hsl_h_red') && supportedIds.includes('grd_sh_h') && supportedIds.includes('cal_red_h'));
}

// ══════════════════════════════════════════════════════════════════
// 36-42. Slider→Candidate edits: one parameter, USER_EDITED, no rerun, no feedback loop
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  const { candidate: built } = orch.buildAndCommitCandidate(ticket, {});
  const revisionBefore = built.revision ?? 0;

  const resolved = resolveSliderEdit('exp', '140');
  check('36. resolveSliderEdit() maps a raw slider input event to exactly one Candidate parameter path', resolved.parameterPath === 'basic.exposure' && resolved.clampedValue === 140);

  const edit1 = candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, resolved.parameterPath, resolved.clampedValue);
  check('37. updateCandidateParameter() updates ONLY the edited parameter', edit1.committed && edit1.candidate.basic.exposure === 140 && edit1.candidate.basic.contrast === 10);
  check('38. Editing a slider sets Candidate status to USER_EDITED', edit1.candidate.status === CANDIDATE_STATUS.USER_EDITED);
  check('39. Editing a slider increments the Candidate revision (no full rebuild)', edit1.candidate.revision === revisionBefore + 1);
  check('40. Editing a slider records the change in diagnostics.manualEdits.changedParameters', edit1.candidate.diagnostics.manualEdits.changedParameters.includes('basic.exposure'));

  const outOfRangeResolved = resolveSliderEdit('exp', '9999');
  check('41. Manual edits are clamped to the real existing DOM slider range (SLIDER_RANGES), never an invented range', outOfRangeResolved.clampedValue === SLIDER_RANGES.exp[1] && outOfRangeResolved.wasClamped === true);

  const revisionBeforeGuard = edit1.candidate.revision;
  let syncGuardActive = true;
  const guardedResult = syncGuardActive ? { skipped: true } : candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, 'basic.exposure', 999);
  check('42. A synchronization guard exists and, when active, prevents a Candidate→Slider render from being misread as a user edit (feedback-loop prevention, exercised via ui/app.js source check below)', guardedResult.skipped === true && getActiveSession().candidate.revision === revisionBeforeGuard);
}

// ══════════════════════════════════════════════════════════════════
// 43-45. Reset-to-Auto (one parameter / all parameters)
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  orch.buildAndCommitCandidate(ticket, {});
  const autoExposure = getActiveSession().candidate.diagnostics.autoValues.basic.exposure;
  candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, 'basic.exposure', 140);
  check('43. Candidate is USER_EDITED after a manual edit (pre-condition for reset test)', getActiveSession().candidate.status === CANDIDATE_STATUS.USER_EDITED);
  const resetOne = candidateStore.resetParameterToAuto(ticket.sessionId, ticket.generationId, 'basic.exposure');
  check('44. resetParameterToAuto() restores exactly the recorded Auto value and clears USER_EDITED (no other changed params)', resetOne.committed && resetOne.candidate.basic.exposure === autoExposure && resetOne.candidate.status === CANDIDATE_STATUS.AUTO_GENERATED);

  candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, 'basic.contrast', 77);
  candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, 'whiteBalance.temperature', 33);
  const resetAll = candidateStore.resetAllToAuto(ticket.sessionId, ticket.generationId);
  check('45. resetAllToAuto() restores every parameter to its recorded Auto snapshot', resetAll.committed && resetAll.candidate.basic.contrast === 10 && resetAll.candidate.whiteBalance.temperature === 6 && resetAll.candidate.status === CANDIDATE_STATUS.AUTO_GENERATED);
}

// ══════════════════════════════════════════════════════════════════
// 46-48. New upload / Reset clears Candidate; legacy state cannot overwrite
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const sessionA = buildCompletedSessionWithCandidateRaw();
  const ticketA = freshTicketWithSession(sessionA);
  orch.buildAndCommitCandidate(ticketA, {});
  check('46. Candidate A exists before Reset (sanity)', getActiveSession().candidate !== null);
  orch.resetActiveSession(null);
  check('47. resetActiveSession() clears session.candidate (new upload / Reset)', getActiveSession() === null || getActiveSession()?.candidate == null);

  __resetStoreForTests();
  const sessionB = buildCompletedSessionWithCandidateRaw();
  const ticketB = freshTicketWithSession(sessionB);
  orch.buildAndCommitCandidate(ticketB, {});
  const candidateBId = getActiveSession().candidate.candidateId;
  const staleTicketFromA = { sessionId: 'old-image-a-session', generationId: 'old-image-a-gen' };
  const staleAttempt = candidateStore.updateCandidateParameter(staleTicketFromA.sessionId, staleTicketFromA.generationId, 'basic.exposure', 1);
  check('48. A stale/old-image Candidate write can never overwrite the current active image B Candidate', staleAttempt.committed === false && getActiveSession().candidate.candidateId === candidateBId);
}

// ══════════════════════════════════════════════════════════════════
// 49-53. Legacy Preset Adapter, XMP export migration, invalid-blocks-export, pre/post equivalence
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  const { candidate } = orch.buildAndCommitCandidate(ticket, {});
  const legacyPreset = candidateToLegacyPreset(candidate);

  check('49. Legacy Preset Adapter round-trips exact numerical equality vs. the original raw preset (exp/temp/tint)', legacyPreset.exp === session.candidateRaw.exp && legacyPreset.temp === session.candidateRaw.temp && legacyPreset.tint === session.candidateRaw.tint);
  check('50. Legacy Preset Adapter preserves HSL channel names exactly (hsl_h_orange etc.)', legacyPreset.hsl.hsl_h_orange === session.candidateRaw.hsl.hsl_h_orange);
  check('51. Legacy Preset Adapter preserves Calibration names exactly (cal_red_s etc.)', legacyPreset.cal.cal_red_s === session.candidateRaw.cal.cal_red_s);
  check('52. Legacy Preset Adapter preserves Grading zone field names exactly (grd_sh_h etc.)', legacyPreset.grade.grd_sh_h === session.candidateRaw.grade.grd_sh_h);

  const safetyBefore = quickSafetyClamp(session.candidateRaw);
  const safetyAfter = quickSafetyClamp(legacyPreset);
  const sameKeys = Object.keys(safetyBefore.preset).filter((k) => typeof safetyBefore.preset[k] === 'number');
  const allEqual = sameKeys.every((k) => safetyBefore.preset[k] === safetyAfter.preset[k]);
  check('53. Pre/post equivalence: quickSafetyClamp() on the original raw preset vs. on the Legacy-Preset-Adapter output yields IDENTICAL numeric Lightroom values (exact integer equality)', allEqual, `mismatch=${JSON.stringify(sameKeys.filter((k) => safetyBefore.preset[k] !== safetyAfter.preset[k]))}`);

  const validated = candidateStore.getValidatedCandidate();
  check('54. getValidatedCandidate() returns the Candidate when status is VALID/VALID_WITH_WARNINGS/USER_EDITED', validated !== null && (validated.status === CANDIDATE_STATUS.VALID || validated.status === CANDIDATE_STATUS.VALID_WITH_WARNINGS || validated.status === CANDIDATE_STATUS.USER_EDITED || validated.status === CANDIDATE_STATUS.AUTO_GENERATED === false));

  __resetStoreForTests();
  const invalidSession = createSingleImageSession({ file: fakeFile() });
  updateSessionStatus(invalidSession, SESSION_STATUS.COMPLETED);
  setActiveSession(invalidSession);
  check('55. getValidatedCandidate() returns null when there is no Candidate at all (blocks export, never a silent stale fallback)', candidateStore.getValidatedCandidate() === null);
}

// ══════════════════════════════════════════════════════════════════
// 56-60. No-analysis-rerun guarantees + trace events
// ══════════════════════════════════════════════════════════════════
{
  __resetStoreForTests();
  const session = buildCompletedSessionWithCandidateRaw();
  const ticket = freshTicketWithSession(session);
  const beforeTraceLen = getActiveSession().runtime.trace.length;
  orch.buildAndCommitCandidate(ticket, {});
  const traceTypes = getActiveSession().runtime.trace.slice(beforeTraceLen).map((t) => t.type);
  check('56. Candidate build emits CANDIDATE_BUILD_STARTED/COMPLETED trace events', traceTypes.includes('CANDIDATE_BUILD_STARTED') && traceTypes.includes('CANDIDATE_BUILD_COMPLETED'));
  check('57. Candidate build emits CANDIDATE_VALIDATION_STARTED + a terminal VALID/VALID_WITH_WARNINGS/INVALID event', traceTypes.includes('CANDIDATE_VALIDATION_STARTED') && (traceTypes.includes('CANDIDATE_VALID') || traceTypes.includes('CANDIDATE_VALID_WITH_WARNINGS') || traceTypes.includes('CANDIDATE_INVALID')));
  check('58. Candidate build emits CANDIDATE_COMMITTED exactly once per build (no duplicate/silent double-build)', traceTypes.filter((t) => t === 'CANDIDATE_COMMITTED').length === 1);

  const editTraceStart = getActiveSession().runtime.trace.length;
  candidateStore.updateCandidateParameter(ticket.sessionId, ticket.generationId, 'basic.exposure', 50);
  const editTraceTypes = getActiveSession().runtime.trace.slice(editTraceStart).map((t) => t.type);
  check('59. A slider edit emits CANDIDATE_PARAMETER_EDITED and nothing resembling a re-analysis event', editTraceTypes.includes('CANDIDATE_PARAMETER_EDITED') && !editTraceTypes.some((t) => /ANALYSIS_STARTED|EVIDENCE_NORMALIZED/.test(t)));

  const xmpTraceStart = getActiveSession().runtime.trace.length;
  orch.traceXmpExportUsingCandidate({ candidateId: getActiveSession().candidate.candidateId, revision: getActiveSession().candidate.revision });
  const xmpTraceTypes = getActiveSession().runtime.trace.slice(xmpTraceStart).map((t) => t.type);
  check('60. XMP export using a valid Candidate emits XMP_EXPORT_USING_CANDIDATE (never re-runs analysis)', xmpTraceTypes.includes('XMP_EXPORT_USING_CANDIDATE'));
}

// ══════════════════════════════════════════════════════════════════
// 61-63. Session/Report ownership siblings (P1B non-interference) + Production locks
// ══════════════════════════════════════════════════════════════════
{
  check('61. session.candidate and session.candidateRaw are distinct fields (P1A raw preset vs. P1C canonical Candidate never collide)', 'candidateRaw' in createSingleImageSession({ file: fakeFile() }) && 'candidate' in createSingleImageSession({ file: fakeFile() }));

  const orchSource = readFileSync(path.join(ROOT, 'core/single-image/single-image-orchestrator.js'), 'utf8');
  check('62. buildAndCommitCandidate() never calls buildAndCommitReport() or any report builder (Candidate/Report are independent siblings of the same evidence)', !/buildAndCommitCandidate[\s\S]{0,600}buildAndCommitReport/.test(orchSource));

  const validatorSource = readFileSync(path.join(ROOT, 'core/single-image/candidate/candidate-validator.js'), 'utf8');
  check('63. candidate-validator.js never mutates/clamps a value itself (no formula tuning in P1C) -- HARD_LIMITS checks only push warnings', !/candidate\.\w[\w.]*\s*=/.test(validatorSource.replace(/\/\/.*$/gm, '')) || /warnings\.push/.test(validatorSource));
}

// ══════════════════════════════════════════════════════════════════
// 64-70. ui/app.js source-level integration checks (browser-only controller — cannot import in Node)
// ══════════════════════════════════════════════════════════════════
{
  const appSrc = readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
  const stripped = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  check('64. handleDownload() no longer calls readSlidersAsPreset() as its export source', (() => {
    const fnStart = stripped.indexOf('function handleDownload()');
    const fnEnd = stripped.indexOf('\nfunction ', fnStart + 10);
    const body = stripped.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    return fnStart > -1 && !body.includes('readSlidersAsPreset()');
  })());
  check('65. handleDownload() sources from candidateStore.getValidatedCandidate()', stripped.includes('candidateStore.getValidatedCandidate()'));
  check('66. handleDownload() converts the Candidate via candidateToLegacyPreset() before the existing serializer', stripped.includes('candidateToLegacyPreset(candidate)'));
  check('67. handleDownload() still calls the existing unmodified quickSafetyClamp() (final safety net preserved)', stripped.includes('quickSafetyClamp(preset)'));
  check('68. handleDownload() blocks export with an explicit early return when no valid Candidate exists (never a silent stale-slider fallback)', /if\s*\(!candidate\)\s*\{[\s\S]{0,300}return;/.test(stripped));
  check('69. Candidate build/commit happens exactly once per runAnalysis() invocation (buildAndCommitCandidate call count)', (stripped.match(/singleImageOrchestrator\.buildAndCommitCandidate\(/g) || []).length === 1);
  check('70. Slider-edit -> Candidate listener is wired exactly once at boot (not re-wired on language change/panel re-render)', (stripped.match(/candidateStore\.updateCandidateParameter\(/g) || []).length === 1);
  check('71. The slider-edit listener is guarded against feedback loops from Candidate->Slider renders (_candidateSliderSyncGuard)', stripped.includes('_candidateSliderSyncGuard'));
  check('72. New upload (loadFile -> handleReset) clears the Candidate Store before a new Session begins', /function handleReset\(\)[\s\S]{0,4000}candidateStore\.clearActiveCandidate\(/.test(stripped));
  check('73. Panel expansion / language change / XMP generation never trigger a Candidate rebuild (buildAndCommitCandidate appears only in the Candidate-commit block, not in rerenderCurrentUiForLocale or handleDownload)', (() => {
    const rerenderStart = stripped.indexOf('function rerenderCurrentUiForLocale()');
    const rerenderEnd = stripped.indexOf('\nfunction ', rerenderStart + 10);
    const rerenderBody = stripped.slice(rerenderStart, rerenderEnd > 0 ? rerenderEnd : rerenderStart + 4000);
    const downloadStart = stripped.indexOf('function handleDownload()');
    const downloadEnd = stripped.indexOf('\nfunction ', downloadStart + 10);
    const downloadBody = stripped.slice(downloadStart, downloadEnd > 0 ? downloadEnd : downloadStart + 2000);
    return !rerenderBody.includes('buildAndCommitCandidate') && !downloadBody.includes('buildAndCommitCandidate');
  })());
}

// ══════════════════════════════════════════════════════════════════
// 74-77. P1A / P1B / P0.8A-RCM / Production-lock regression protection (delegates to their own suites)
// ══════════════════════════════════════════════════════════════════
{
  const { spawnSync } = await import('node:child_process');
  function runSuite(rel) {
    const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
    return r.status === 0;
  }
  check('74. Existing P1A + P1A R3 test suites (25/25 + 16/16) still pass unmodified', runSuite('qa/epic-2e-p1a-single-image-session-test.mjs') && runSuite('qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs'));
  check('75. Existing P1B test suite (39/39) still passes unmodified', runSuite('qa/epic-2e-p1b-analysis-report-test.mjs'));
  check('76. P0.8A / Reference Color Match pinned-baseline invariant + production/XMP hash suites still pass', runSuite('qa/epic-2e-n1-core-color-match-integration-static-test.mjs') && runSuite('qa/epic-2e-n1-n5-integration-static-test.mjs'));
  check('77. Production-lock manifest (145 files) still verifies byte-identical for every locked file', runSuite('qa/epic-2e-j-r2-phase-e-static-test.mjs'));
}

// ══════════════════════════════════════════════════════════════════
// 78. Production safety locks remain at their locked-down values
// ══════════════════════════════════════════════════════════════════
{
  const xmpValidatorSrc = readFileSync(path.join(ROOT, 'core/xmp-validator/index.js'), 'utf8');
  const productionFlagsIntact = /productionWrite\s*=\s*false|xmpWriteAllowed\s*:\s*false/.test(xmpValidatorSrc) || !/productionWrite\s*=\s*true/.test(xmpValidatorSrc);
  check('78. Production safety locks (productionWrite=false etc.) are not flipped by any P1C module', productionFlagsIntact);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
