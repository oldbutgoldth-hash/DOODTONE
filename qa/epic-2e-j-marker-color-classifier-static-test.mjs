#!/usr/bin/env node
/**
 * qa/epic-2e-j-marker-color-classifier-static-test.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase D: hostile self-tests for the
 * dominance-based marker color classifier (qa/helpers/marker-color-
 * classifier.mjs), required by the spec:
 *   - correct red-dominant compressed patch passes
 *   - wrong green/blue patch fails
 *   - low-saturation gray fails
 *   - wrong corner fails
 *
 * "Wrong corner fails" is modeled here as: sampling a DIFFERENT corner
 * of a real 4-quadrant marker layout (i.e. a patch that is legitimately
 * some other color, or the neutral background) must not be misreported
 * as matching the EXPECTED corner's color -- exactly what a genuine
 * wrong-corner sample would look like once actually captured from a
 * canvas.
 */

import { classifyDominantColor, matchesExpectedColor } from './helpers/marker-color-classifier.mjs';

const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);
function recordStatus(rows, name, status, detail) {
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`Invalid status "${status}" for case "${name}"`);
  rows.push({ name, status, detail: detail ?? null });
}

export function evaluateCases() {
  const rows = [];

  // 1. Correct red-dominant COMPRESSED patch passes (the exact real-
  //    world regression this phase exists to fix: a nominally-pure red
  //    marker, degraded by real JPEG compression to ~[171-173,3-4,2],
  //    must still classify as 'red').
  {
    const compressedRed = { r: 172, g: 3, b: 2 };
    const ok = matchesExpectedColor(compressedRed, 'red') === true && classifyDominantColor(compressedRed) === 'red';
    recordStatus(rows, 'compressed_red_patch_passes', ok ? 'PASS' : 'FAIL', JSON.stringify(compressedRed));
  }

  // 2. Wrong color (green) when red is expected -> fails.
  {
    const greenPatch = { r: 10, g: 180, b: 8 };
    const ok = matchesExpectedColor(greenPatch, 'red') === false && classifyDominantColor(greenPatch) === 'green';
    recordStatus(rows, 'wrong_color_green_when_red_expected_fails', ok ? 'PASS' : 'FAIL', JSON.stringify(greenPatch));
  }

  // 3. Wrong color (blue) when red is expected -> fails.
  {
    const bluePatch = { r: 8, g: 12, b: 190 };
    const ok = matchesExpectedColor(bluePatch, 'red') === false && classifyDominantColor(bluePatch) === 'blue';
    recordStatus(rows, 'wrong_color_blue_when_red_expected_fails', ok ? 'PASS' : 'FAIL', JSON.stringify(bluePatch));
  }

  // 4. Low-saturation gray fails (both a mid-gray and a near-black/near-white sample).
  {
    const midGray = { r: 128, g: 126, b: 130 };
    const nearBlack = { r: 6, g: 5, b: 7 };
    const nearWhite = { r: 248, g: 246, b: 250 };
    const ok = classifyDominantColor(midGray) === 'gray'
      && classifyDominantColor(nearBlack) === 'gray'
      && classifyDominantColor(nearWhite) === 'gray'
      && matchesExpectedColor(midGray, 'red') === false;
    recordStatus(rows, 'low_saturation_gray_fails', ok ? 'PASS' : 'FAIL', JSON.stringify({ midGray, nearBlack, nearWhite }));
  }

  // 5. Wrong corner fails -- sampling the GREEN quadrant of a real
  //    4-quadrant marker layout when RED was expected at this position
  //    (i.e. the canvas was flipped/rotated incorrectly, so the wrong
  //    quadrant landed under the expected-red sample point).
  {
    const wrongCornerSample = { r: 4, g: 165, b: 6 }; // real green-quadrant compressed sample
    const ok = matchesExpectedColor(wrongCornerSample, 'red') === false;
    recordStatus(rows, 'wrong_corner_fails', ok ? 'PASS' : 'FAIL', JSON.stringify(wrongCornerSample));
  }

  // 6. Correct green/blue/yellow patches still pass for their OWN expected color (dominance symmetry).
  {
    const greenCompressed = { r: 5, g: 168, b: 4 };
    const blueCompressed = { r: 3, g: 6, b: 175 };
    const yellowCompressed = { r: 212, g: 188, b: 18 };
    const ok = matchesExpectedColor(greenCompressed, 'green') === true
      && matchesExpectedColor(blueCompressed, 'blue') === true
      && matchesExpectedColor(yellowCompressed, 'yellow') === true;
    recordStatus(rows, 'green_blue_yellow_compressed_patches_pass', ok ? 'PASS' : 'FAIL', JSON.stringify({ greenCompressed, blueCompressed, yellowCompressed }));
  }

  // 7. Malformed/missing sample input fails closed (never throws, never silently matches).
  {
    const ok = classifyDominantColor(null) === 'unknown'
      && classifyDominantColor(undefined) === 'unknown'
      && classifyDominantColor({}) === 'unknown'
      && matchesExpectedColor(null, 'red') === false
      && matchesExpectedColor({ r: 200, g: 0, b: 0 }, '') === false
      && matchesExpectedColor({ r: 200, g: 0, b: 0 }, null) === false;
    recordStatus(rows, 'malformed_input_fails_closed', ok ? 'PASS' : 'FAIL', 'null/undefined/empty-object/empty-expected-name all handled without throwing');
  }

  return rows;
}

export function computeDecision(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'FAIL_MARKER_CLASSIFIER_SELFTEST';
  return rows.every((r) => r.status === 'PASS') ? 'PASS_MARKER_CLASSIFIER_SELFTEST' : 'FAIL_MARKER_CLASSIFIER_SELFTEST';
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const rows = evaluateCases();
  const decision = computeDecision(rows);
  for (const r of rows) {
    console.log(`  [${r.status}] ${r.name}${r.status === 'FAIL' ? ' -- ' + r.detail : ''}`);
  }
  console.log(`Marker color classifier self-test decision: ${decision}`);
  process.exit(decision === 'PASS_MARKER_CLASSIFIER_SELFTEST' ? 0 : 1);
}
