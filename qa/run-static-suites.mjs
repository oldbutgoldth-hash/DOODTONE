#!/usr/bin/env node
/**
 * qa/run-static-suites.mjs
 *
 * SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 8: the real, non-destructive
 * `npm test` / `npm run test:static` entry point, replacing the
 * placeholder `"echo \"Error: no test specified\" && exit 1"` script
 * that would fail any CI/build step that happened to invoke `npm test`.
 *
 * Runs ONLY no-Browser, no-network, no-Chromium-download suites — safe
 * to run in ANY environment, including a Vercel build container. Never
 * launches Playwright/Chromium, never downloads a browser binary,
 * never reaches the network. Exits non-zero if any listed suite exits
 * non-zero, so this is safe to wire into CI as a real gate.
 *
 * This is deliberately a thin sequential runner (not a parallel one)
 * so output ordering is stable and a failing suite's output is never
 * interleaved with the next suite's.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Every file here is a no-Browser static/self-test suite — verified by
// direct inspection (none imports playwright, none calls
// chromium.launch()). Kept as an explicit, visible list rather than a
// directory glob so this list can never silently pick up a future
// Browser suite by accident.
const STATIC_SUITES = [
  'qa/epic-2e-j-c-f2-preview-gate-smoke-test.mjs',
  'qa/epic-2e-j-env-b2-f1-static-test.mjs',
  'qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs',
  'qa/epic-2e-j-phase-c-step7b-b-f2-static-test.mjs',
  'qa/epic-2e-j-phase-c-step7b-b-f3-static-test.mjs',
  'qa/epic-2e-j-r2-phase-e-static-test.mjs',
  'qa/playwright-virtual-origin-helper-static-test.mjs',
  'qa/playwright-in-memory-app-static-test.mjs',
  'qa/epic-2e-j-preview-geometry-static-test.mjs',
  'qa/epic-2e-j-preview-source-geometry-normalizer-static-test.mjs',
  'qa/epic-2e-j-safe-recovery-upload-baseline-static-test.mjs',
];

let anyFailed = false;
for (const rel of STATIC_SUITES) {
  console.log(`\n=== ${rel} ===`);
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, rel)], { stdio: 'inherit', cwd: PROJECT_ROOT });
  if (result.status !== 0) {
    anyFailed = true;
    console.error(`FAILED (exit ${result.status}): ${rel}`);
  }
}

console.log(anyFailed ? '\nOne or more static suites FAILED.' : '\nAll static suites PASSED.');
process.exit(anyFailed ? 1 : 0);
