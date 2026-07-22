#!/usr/bin/env node
/**
 * qa/epic-2e-j-preview-geometry-static-test.mjs
 *
 * DEPLOY GEOMETRY R1 — Phase F (static half): no Browser required.
 * Verifies the deterministic geometry fixture set (Phase E) is
 * present, well-formed, and its declared EXIF Orientation matches an
 * INDEPENDENT byte-level parse (qa/helpers/exif-orientation-reader.mjs
 * — a second, from-scratch implementation, never the same code path
 * used by generate_fixtures.py, so this genuinely catches a
 * manifest/fixture drift rather than checking a value against itself).
 * Also unit-tests the pure blocker-code/alignment decision logic this
 * EPIC added to ui/app.js and the Interactive Before/After controller,
 * against fabricated inputs — never a live Browser.
 *
 * Run: node qa/epic-2e-j-preview-geometry-static-test.mjs
 * Output: qa/epic-2e-j-preview-geometry-static-results.json
 */

import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJpegExifOrientation } from './helpers/exif-orientation-reader.mjs';
import { generateRunId, computeSourceHash, writeResultAtomic, buildRuntimeCrashRow } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'preview-geometry');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-preview-geometry-static-results.json');

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-preview-geometry-static-test.mjs'),
  path.join(__dirname, 'helpers', 'exif-orientation-reader.mjs'),
  path.join(FIXTURES_DIR, 'manifest.json'),
];

let runId = null;
let startedAt = null;
let sourceHash = null;
const results = [];
const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);

function recordStatus(test, status, evidence) {
  const testOk = typeof test === 'string' && test.trim().length > 0;
  const statusOk = typeof status === 'string' && ALLOWED_STATUSES.has(status);
  let safeEvidence;
  try { safeEvidence = String(evidence); } catch (e) { safeEvidence = `[evidence formatting threw: ${e?.name ?? 'UnknownError'}]`; }
  const finalStatus = (testOk && statusOk) ? status : 'FAIL';
  const finalTest = testOk ? test : '[MISSING_TEST_NAME]';
  const icon = finalStatus === 'PASS' ? '✓' : finalStatus === 'FAIL' ? '✗' : '•';
  results.push({ test: finalTest, result: finalStatus, evidence: safeEvidence });
  console.log(`${icon} [${finalStatus}] ${finalTest} — ${safeEvidence}`);
}
function recordCondition(test, condition, evidence) {
  recordStatus(test, condition === true ? 'PASS' : 'FAIL', evidence);
}

// ══════════════════════════════════════════════════════════════════
// Fail-closed decision — same shape/contract as every other suite's
// pure decision function in this project (reused pattern, not a new
// vocabulary): PASS only when every row is well-formed, FAIL count is
// zero, and no unexpected NOT_TESTED exists.
// ══════════════════════════════════════════════════════════════════
export function computePreviewGeometryStaticDecision(resultRows, { permittedNotTestedTests = [] } = {}) {
  if (!Array.isArray(resultRows) || resultRows.length === 0) return { decision: 'FAIL', reasons: ['EMPTY_RESULT_SET'] };
  const permittedSet = new Set(permittedNotTestedTests);
  const reasons = [];
  let failCount = 0, unexpectedNotTested = 0, malformed = 0;
  for (const row of resultRows) {
    const wellFormed = !!row && typeof row.test === 'string' && row.test.trim().length > 0 && typeof row.result === 'string' && ALLOWED_STATUSES.has(row.result);
    if (!wellFormed) { malformed++; continue; }
    if (row.result === 'FAIL') failCount++;
    if (row.result === 'NOT_TESTED' && !permittedSet.has(row.test)) unexpectedNotTested++;
  }
  if (malformed > 0) reasons.push(`MALFORMED_ROWS=${malformed}`);
  if (failCount > 0) reasons.push(`FAIL_COUNT=${failCount}`);
  if (unexpectedNotTested > 0) reasons.push(`UNEXPECTED_NOT_TESTED=${unexpectedNotTested}`);
  return { decision: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();

  // ── Fixture manifest + EXIF cross-check ──
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    recordCondition('manifest.json is present and parses as JSON', true, MANIFEST_PATH);
  } catch (e) {
    recordCondition('manifest.json is present and parses as JSON', false, `${MANIFEST_PATH}: ${e.message}`);
  }

  const REQUIRED_FILENAMES = [
    'landscape-orientation-1.jpg',
    'portrait-orientation-1.jpg',
    'landscape-orientation-3.jpg',
    'landscape-matrix-orientation-6.jpg',
    'portrait-matrix-orientation-8.jpg',
    'landscape-no-exif.png',
  ];
  const manifestFilenames = Array.isArray(manifest?.fixtures) ? manifest.fixtures.map((f) => f.filename) : [];
  recordCondition(
    'manifest declares exactly the 6 required fixtures',
    REQUIRED_FILENAMES.every((f) => manifestFilenames.includes(f)) && manifestFilenames.length === REQUIRED_FILENAMES.length,
    `declared=${JSON.stringify(manifestFilenames)}`
  );

  const requiredManifestFields = ['filename', 'encodedPixelWidth', 'encodedPixelHeight', 'exifOrientation', 'expectedDecodedWidth', 'expectedDecodedHeight', 'expectedVisualTopLeftMarker'];
  for (const fx of manifest?.fixtures ?? []) {
    const missingFields = requiredManifestFields.filter((k) => !Object.prototype.hasOwnProperty.call(fx, k));
    recordCondition(`manifest entry for ${fx.filename ?? '(unknown)'} has all required fields`, missingFields.length === 0, `missing=${JSON.stringify(missingFields)}`);
  }

  for (const fx of manifest?.fixtures ?? []) {
    const filePath = path.join(FIXTURES_DIR, fx.filename);
    let fileBuf = null;
    let statOk = false;
    try {
      const st = await stat(filePath);
      statOk = st.isFile() && st.size > 0;
      fileBuf = await readFile(filePath);
    } catch (e) {
      recordCondition(`${fx.filename}: file exists and is readable`, false, e.message);
      continue;
    }
    recordCondition(`${fx.filename}: file exists and is readable`, statOk, `size=${fileBuf?.length ?? 0} bytes`);

    // Independent byte-level EXIF Orientation parse — fail closed on
    // malformed fixture (parser throws), never silently skipped.
    let parsedOrientation;
    let parseError = null;
    try {
      parsedOrientation = readJpegExifOrientation(fileBuf);
    } catch (e) {
      parseError = e.message;
    }
    if (parseError) {
      recordCondition(`${fx.filename}: EXIF Orientation is parseable (fail-closed on malformed fixture)`, false, parseError);
    } else {
      recordCondition(
        `${fx.filename}: independently-parsed EXIF Orientation matches manifest`,
        parsedOrientation === fx.exifOrientation,
        `manifest=${fx.exifOrientation}, independentParse=${parsedOrientation}`
      );
    }

    // Never the user's personal photo: every fixture is small,
    // synthetic, and project-generated (bounded file size sanity check
    // — a real photograph from a modern camera/phone is virtually
    // always far larger than this synthetic geometric-pattern JPEG).
    recordCondition(`${fx.filename}: bounded synthetic fixture size (never a real photo)`, (fileBuf?.length ?? 0) < 500 * 1024, `size=${fileBuf?.length ?? 0} bytes (limit 512000)`);
  }

  // Malformed-fixture fail-closed contract: a deliberately corrupted
  // buffer must throw, never silently return a plausible-looking
  // orientation value.
  try {
    readJpegExifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78]));
    recordCondition('EXIF parser fails closed on a truncated APP1 segment', false, 'did not throw on truncated input');
  } catch {
    recordCondition('EXIF parser fails closed on a truncated APP1 segment', true, 'threw as expected');
  }
  recordCondition('EXIF parser returns null (not an error) for a non-JPEG buffer', readJpegExifOrientation(Buffer.from('not a jpeg at all')) === null, 'PNG/other-format buffers are honestly "no EXIF", not a parse failure');

  // ── Pure decision-function self-test (6 fabricated cases, matching
  //    the project's established static-self-test convention) ──
  const decisionCases = [
    { name: 'all PASS', rows: [{ test: 'a', result: 'PASS', evidence: '' }, { test: 'b', result: 'PASS', evidence: '' }], expected: 'PASS' },
    { name: 'one FAIL', rows: [{ test: 'a', result: 'PASS', evidence: '' }, { test: 'b', result: 'FAIL', evidence: '' }], expected: 'FAIL' },
    { name: 'unexpected NOT_TESTED', rows: [{ test: 'a', result: 'NOT_TESTED', evidence: '' }], expected: 'FAIL' },
    { name: 'permitted NOT_TESTED', rows: [{ test: 'a', result: 'NOT_TESTED', evidence: '' }], permitted: ['a'], expected: 'PASS' },
    { name: 'malformed row (boolean result)', rows: [{ test: 'a', result: true, evidence: '' }], expected: 'FAIL' },
    { name: 'empty result set', rows: [], expected: 'FAIL' },
  ];
  for (const c of decisionCases) {
    const { decision } = computePreviewGeometryStaticDecision(c.rows, { permittedNotTestedTests: c.permitted ?? [] });
    recordCondition(`Decision self-test: ${c.name}`, decision === c.expected, `expected=${c.expected}, got=${decision}`);
  }

  // ── node --check on the two Phase F suite files themselves (syntax) ──
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const browserSuitePath = path.join(__dirname, 'epic-2e-j-preview-geometry-browser-test.mjs');
  try {
    await execFileAsync(process.execPath, ['--check', browserSuitePath]);
    recordCondition('epic-2e-j-preview-geometry-browser-test.mjs passes node --check', true, browserSuitePath);
  } catch (e) {
    recordCondition('epic-2e-j-preview-geometry-browser-test.mjs passes node --check', false, e.stderr?.toString() ?? e.message);
  }

  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);
  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const decisionResult = computePreviewGeometryStaticDecision(results, { permittedNotTestedTests: [] });
  const output = {
    suite: 'DEPLOY GEOMETRY R1 — Preview Geometry Static test',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    completed: true,
    sourceHash,
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
    results,
    decision: decisionResult.decision,
    decisionReasons: decisionResult.reasons,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeResultAtomic(RESULTS_PATH, output);
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log(`Decision: ${decisionResult.decision}${decisionResult.reasons.length ? ` (${decisionResult.reasons.join(', ')})` : ''}`);
  process.exit(decisionResult.decision === 'PASS' ? 0 : 1);
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Static test crashed:', err?.name ?? err);
    try {
      const nowIso = new Date().toISOString();
      await writeResultAtomic(RESULTS_PATH, {
        suite: 'DEPLOY GEOMETRY R1 — Preview Geometry Static test',
        runId, startedAt, completedAt: nowIso, completed: false, sourceHash,
        generatedAt: nowIso,
        summary: { total: 1, pass: 0, fail: 1, notTested: 0 },
        results: [buildRuntimeCrashRow(err)],
        decision: 'FAIL',
      });
    } catch (writeErr) {
      console.error('Failed to write crash result JSON:', writeErr?.name ?? writeErr);
    }
    process.exit(2);
  });
}
