/**
 * qa/phase-c-suite-source-manifest.mjs
 *
 * DEPLOY GEOMETRY R1 — Phase H1: the single shared suite-source
 * manifest used by BOTH each Browser suite (to compute the sourceHash
 * it writes into its own result JSON) AND the Final aggregator (to
 * independently RECOMPUTE the current sourceHash for the exact same
 * file set and compare). This is the fix for the R3 known evidence
 * defect: the previous aggregator compared a result's `generatedAt`
 * timestamp against the suite source file's on-disk `mtime`, which
 * produces a FALSE "STALE, must be rerun" rejection after a ZIP
 * extraction — ZIP tools frequently set every extracted file's mtime
 * to the moment of extraction (or otherwise fail to preserve a
 * trustworthy relative ordering), so a genuinely fresh, matching
 * result can appear to "predate" its own just-extracted source file
 * purely from filesystem noise, never from an actual source change.
 *
 * sourceHash is the PRIMARY freshness proof from here on: when a
 * result's stored `sourceHash` exactly matches the CURRENT recomputed
 * hash of this exact file list, the result is proven fresh regardless
 * of what mtime the filesystem currently reports — mtime becomes
 * purely informational, never a rejection reason on its own. Fail
 * closed when: sourceHash is missing on the result, the recomputed
 * hash does not match, this manifest itself doesn't have an entry for
 * the suite, or any listed source file cannot be read.
 *
 * Every path below is PROJECT_ROOT-relative (e.g. "qa/foo.mjs",
 * "ui/bar.js") — never a machine-specific absolute path — so this
 * manifest itself is fully portable, matching Phase H2's fix for the
 * Production-lock baseline.
 *
 * IMPORTANT: this list must be kept in sync BY HAND with each suite's
 * own local `SOURCE_HASH_INPUTS` constant. This is a deliberate,
 * visible, single point of truth rather than an automatically-derived
 * one, so a suite's source-hash-input list can never silently drift
 * out of the aggregator's view.
 */

import path from 'node:path';
import { computeSourceHash } from './helpers/playwright-lumixa-test-runtime.mjs';

export const SUITE_SOURCE_FILES = {
  // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B/10: the Baseline
  // Upload Contract suite's own sourceHash inputs — includes ui/app.js
  // itself, since this suite exists specifically to prove the upload/
  // generation lifecycle inside that file.
  uploadBaseline: [
    'qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
    'ui/app.js',
  ],
  liveApp: [
    'qa/epic-2e-j-phase-c-live-app-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
    'qa/helpers/playwright-opaque-origin-storage.mjs',
  ],
  observationSmoke: [
    'qa/epic-2e-j-phase-c-observation-smoke-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
  ],
  step7bA: [
    'qa/epic-2e-j-phase-c-step7b-a-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
    'qa/helpers/playwright-opaque-origin-cookie.mjs',
    'ui/interactive-preview-observation-session-v2.js',
  ],
  step7bB: [
    'qa/epic-2e-j-phase-c-step7b-b-test.mjs',
    'qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
    'qa/helpers/playwright-opaque-origin-storage.mjs',
  ],
  previewGeometryStatic: [
    'qa/epic-2e-j-preview-geometry-static-test.mjs',
    'qa/helpers/exif-orientation-reader.mjs',
    'qa/fixtures/preview-geometry/manifest.json',
  ],
  previewGeometryBrowser: [
    'qa/epic-2e-j-preview-geometry-browser-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/playwright-in-memory-app.mjs',
    'qa/helpers/exif-orientation-reader.mjs',
    'qa/fixtures/preview-geometry/manifest.json',
  ],
  deployPreviewGeometry: [
    'qa/epic-2e-j-deploy-preview-geometry-test.mjs',
    'qa/helpers/playwright-lumixa-test-runtime.mjs',
    'qa/helpers/exif-orientation-reader.mjs',
    'qa/fixtures/preview-geometry/manifest.json',
  ],
};

/**
 * Recomputes the CURRENT sourceHash for the given gate key, reading
 * every listed file fresh off disk. Throws if the gate key is unknown
 * or any listed file cannot be read — callers must treat a throw as a
 * fail-closed "cannot verify freshness" condition, never silently
 * skip the check.
 */
export async function computeCurrentSourceHash(gateKey, projectRoot) {
  const relFiles = SUITE_SOURCE_FILES[gateKey];
  if (!Array.isArray(relFiles) || relFiles.length === 0) {
    throw new Error(`No suite-source-manifest entry for gate key "${gateKey}".`);
  }
  const absFiles = relFiles.map((rel) => path.join(projectRoot, rel));
  return computeSourceHash(absFiles);
}
