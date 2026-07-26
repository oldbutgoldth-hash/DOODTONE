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
  // LOCAL-FIRST GEOMETRY R3 — Phase A2/A3: runs first, deliberately.
  // This is the regression guard for the fatal duplicate-lexical-
  // declaration defect class that every prior round's `node --check`
  // sweep failed to catch. If this ever regresses, nothing else in the
  // suite matters until it is fixed again.
  'qa/epic-2e-j-esm-syntax-gate-static-test.mjs',
  // LOCAL-FIRST GEOMETRY R3 — Phase D: dominance-based marker color
  // classifier hostile self-tests (replaces the brittle absolute-RGB
  // comparison the old combined geometry suite used).
  'qa/epic-2e-j-marker-color-classifier-static-test.mjs',
  'qa/epic-2e-j-local-display-static-test.mjs',
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
  // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase E/K: pure translator
  // policy tests and pure pixel-pipeline proofs (both no-Browser).
  'qa/epic-2e-j-controlled-v2-translator-static-test.mjs',
  'qa/epic-2e-j-controlled-v2-translator-pixel-static-test.mjs',
  'qa/epic-2e-j-controlled-v2-review-static-test.mjs',
  'qa/epic-2e-j-review-state-engine-static-test.mjs',
  'qa/epic-2e-j-review-console-ui-static-test.mjs',
  'qa/epic-2e-j-build-controlled-v2-button-static-test.mjs',
  'qa/epic-2e-j-comparison-honesty-note-static-test.mjs',
  'qa/epic-2e-j-qa-snapshot-controlled-v2-static-test.mjs',
  // FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 — Phase K: centralized
  // i18n module contract + EN/TH key-parity, and the Defect-1
  // regression guard for the state-preserving locale switch.
  'qa/epic-2e-j-i18n-module-static-test.mjs',
  'qa/epic-2e-j-locale-switch-rerender-static-test.mjs',
  // FULL-SYSTEM I18N COMPLETION R2 — Phase D/L: the cross-layer XMP
  // evidence invariant (the "Export path unchanged: Passed" +
  // "XMP Export: Unknown" contradiction can never render again) and the
  // repository-wide hardcoded-visible-English audit.
  'qa/epic-2e-j-xmp-evidence-invariant-static-test.mjs',
  'qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs',
  'qa/epic-2e-j-i18n-coverage-report-static-test.mjs',
  // I18N RUNTIME CLOSURE + QA INTEGRITY R3 -- Phase J: static audit's
  // own regression guard against the 7 QA-integrity defect classes the
  // EP9CD1 review found (Playwright contract mismatch, wrong button
  // selector, hardcoded-true acceptance, mixed-language fail-open,
  // inline bilingual branches, uncoded raw arrays, wrong DOM
  // selectors) -- each with a hostile self-test.
  'qa/epic-2e-j-r3-qa-integrity-static-test.mjs',
  // LOCALE RUNTIME TRUTH + QA NEUTRALITY R4 -- Phase M: static audit's
  // own regression guard against the R4 defect classes (A, B, C, D, F,
  // G, L) ever silently recurring.
  'qa/epic-2e-j-r4-locale-runtime-truth-static-test.mjs',
  // FINAL LOCALE CLOSURE + SEMANTIC QA R5.
  'qa/epic-2e-j-r5-semantic-presentation-static-test.mjs',
  // CONTROLLED V2 CALIBRATION LAB R1 -- Phase J: pure schema/codes/
  // aggregate/readiness/export logic, and a genuine IndexedDB behavior
  // test (via fake-indexeddb, a real IndexedDB implementation -- not a
  // mock) covering schemaVersion, migration guard, corrupt-record
  // handling, session limits, clear-current/clear-all, and the storage
  // usage summary. Both are no-Browser, no-network.
  'qa/epic-2e-k-calibration-lab-static-test.mjs',
  'qa/epic-2e-k-calibration-lab-storage-test.mjs',
  // CONTROLLED V2 CALIBRATION LAB R1 -- Phase M: the dedicated Section-17
  // hostile-test suite (production-lock immutability, no-XMP, no raw
  // Core prose, no localized-sentence-as-decision, no Base64/file-path
  // in exports, corrupt-session-never-crashes, and a genuine end-to-end
  // proof that a tampered result file can never survive a real local
  // gate run).
  'qa/epic-2e-k-calibration-lab-hostile-static-test.mjs',
  // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON & BROWSER VERIFICATION
  // CLOSURE: the pure bounded-LRU cache module's own behavior
  // (eviction order, recency, onEvict correctness, hostile invalid-
  // input handling), plus structural/grep proofs that the transient
  // Render Plan used for live pixel rendering can never reach
  // persisted storage or export, and that the reused production
  // pixel-rendering chain never touches XMP serialization or
  // Production-activation code.
  'qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs',
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
