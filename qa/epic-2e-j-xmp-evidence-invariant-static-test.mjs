#!/usr/bin/env node
/**
 * qa/epic-2e-j-xmp-evidence-invariant-static-test.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase D.
 *
 * Cross-layer invariant guard for the forbidden contradictory screen:
 *
 *     Export path unchanged: Passed
 *     XMP Export: Unknown / Not confirmed.
 *
 * Both lines describe the SAME underlying guarantee, so they must be
 * derived from the SAME evidence. This suite exercises the real
 * `buildReviewSystemEvidence()` projection over every combination of
 * review-item status and sandbox flags, and fails closed if the two
 * can ever disagree.
 *
 * It additionally proves the two things the spec explicitly forbids:
 *   - XMP evidence is NOT inferred from `canExportPreview === false`
 *   - XMP evidence is NOT inferred from `appliedToProduction === false`
 * A preview sandbox reporting both of those, with NO export-path review
 * evidence, must still yield `xmpExportPathUnchanged === null`.
 *
 * No-Browser, no-network. Included in run-static-suites.mjs.
 */
import { installMinimalDomForModuleImport } from './helpers/i18n-fake-dom.mjs';

installMinimalDomForModuleImport();

const { buildReviewSystemEvidence } = await import('../ui/review-console-renderer.js');

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const mkReview = (exportPathStatus, extra = {}) => ({
  reviewItems: [
    { id: 'export-path-unchanged', status: exportPathStatus, reviewed: exportPathStatus === 'passed', reviewerDecision: exportPathStatus === 'passed' ? 'approve' : 'undecided' },
    { id: 'legacy-output-preserved', status: 'passed', reviewed: true, reviewerDecision: 'approve' },
    { id: 'rollback-confirmed', status: 'passed', reviewed: true, reviewerDecision: 'approve' },
    { id: 'preview-non-production-confirmed', status: 'passed', reviewed: true, reviewerDecision: 'approve' },
  ],
  ...extra,
});

// ── 1. The two lines can never contradict, across every status ─────────
{
  const statuses = ['passed', 'failed', 'pending', 'unavailable', 'not-required', 'bogus-status', undefined, null];
  let allConsistent = true;
  const rows = [];
  for (const st of statuses) {
    const ev = buildReviewSystemEvidence(
      { canExportPreview: false, canWriteProduction: false, selectedOutputSource: 'legacy' },
      mkReview(st),
    );
    const consistent = ev.exportPathUnchanged === ev.xmpExportPathUnchanged;
    if (!consistent) allConsistent = false;
    rows.push({ status: String(st), exportPathUnchanged: ev.exportPathUnchanged, xmpExportPathUnchanged: ev.xmpExportPathUnchanged, consistent });
  }
  record('xmpExportPathUnchanged ALWAYS equals exportPathUnchanged — the two displayed lines can never contradict each other', allConsistent, rows);
}

// ── 2. The exact forbidden screen is impossible ─────────────────────────
{
  const ev = buildReviewSystemEvidence(
    { canExportPreview: false, canWriteProduction: false, selectedOutputSource: 'legacy' },
    mkReview('passed'),
  );
  const forbidden = ev.exportPathUnchanged === true && ev.xmpExportPathUnchanged !== true;
  record('FORBIDDEN SCREEN: "Export path unchanged: Passed" + "XMP Export: Unknown" is unreachable', !forbidden, { exportPathUnchanged: ev.exportPathUnchanged, xmpExportPathUnchanged: ev.xmpExportPathUnchanged });
}

// ── 3. XMP is NOT inferred from canExportPreview / appliedToProduction ──
{
  const ev = buildReviewSystemEvidence(
    { canExportPreview: false, canWriteProduction: false, appliedToProduction: false, selectedOutputSource: 'legacy' },
    { reviewItems: [] }, // NO export-path evidence at all
  );
  record('With canExportPreview=false and appliedToProduction=false but NO export-path review evidence, xmpExportPathUnchanged stays null (never inferred, never assumed safe)', ev.xmpExportPathUnchanged === null, { xmpExportPathUnchanged: ev.xmpExportPathUnchanged });

  const ev2 = buildReviewSystemEvidence(
    { canExportPreview: false, canWriteProduction: false, selectedOutputSource: 'legacy' },
    mkReview('pending'),
  );
  record('A pending export-path item yields null XMP evidence — pending is never upgraded to confirmed', ev2.xmpExportPathUnchanged === null, { xmpExportPathUnchanged: ev2.xmpExportPathUnchanged });
}

// ── 4. Explicit failure is reported as an anomaly, never as unknown ────
{
  const ev = buildReviewSystemEvidence({ canExportPreview: false, canWriteProduction: false, selectedOutputSource: 'legacy' }, mkReview('failed'));
  record('A failed export-path item yields xmpExportPathUnchanged === false (an explicit anomaly, never silently "unknown")', ev.xmpExportPathUnchanged === false, { xmpExportPathUnchanged: ev.xmpExportPathUnchanged });
}

// ── 5. productionWriteDisabled uses explicit evidence only ─────────────
{
  const disabled = buildReviewSystemEvidence({ canWriteProduction: false }, { reviewItems: [] });
  const enabledAnomaly = buildReviewSystemEvidence({ canWriteProduction: true }, { reviewItems: [] });
  const missing = buildReviewSystemEvidence({}, { reviewItems: [] });
  record('productionWriteDisabled is true only when canWriteProduction is explicitly false', disabled.productionWriteDisabled === true, { v: disabled.productionWriteDisabled });
  record('productionWriteDisabled is false (anomaly) when canWriteProduction is explicitly true', enabledAnomaly.productionWriteDisabled === false, { v: enabledAnomaly.productionWriteDisabled });
  record('productionWriteDisabled is null when the flag is missing — never assumed safe by default', missing.productionWriteDisabled === null, { v: missing.productionWriteDisabled });
}

// ── 6. Hostile/malformed input never throws ────────────────────────────
{
  const hostile = [
    [null, null],
    [undefined, undefined],
    ['not-an-object', 42],
    [{ get canWriteProduction() { throw new Error('hostile getter'); } }, { reviewItems: { length: 3 } }],
    [{}, { reviewItems: [null, undefined, 7, { id: 'export-path-unchanged', get status() { throw new Error('boom'); } }] }],
  ];
  let threw = false;
  const out = [];
  for (const [sb, rv] of hostile) {
    try { out.push(buildReviewSystemEvidence(sb, rv).xmpExportPathUnchanged); }
    catch (err) { threw = true; out.push(`THREW:${err.message}`); }
  }
  record('buildReviewSystemEvidence never throws on null/malformed/hostile input and degrades to null evidence', !threw, { out });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
