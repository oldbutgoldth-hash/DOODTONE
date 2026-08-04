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
  // aggregate/readiness/export logic, plus the FIX5 dependency-independent
  // IndexedDB storage-contract harness covering schemaVersion, migration
  // guard, corrupt-record handling, limits, clear-current/clear-all, and
  // usage summary. Native Browser IndexedDB remains a separate fail-closed
  // suite and is never represented as passed by this static runner.
  'qa/epic-2e-k-calibration-lab-static-test.mjs',
  'qa/epic-2e-k-r2-fix5-storage-contract-test.mjs',
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
  // EPIC 2E-K-R2-FIX1 -- PIXEL TRUTH, DECISION GATE AND EVIDENCE CLOSURE.
  'qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs',
  // EPIC 2E-K-R2-FIX2 -- Section 6/11: real behavioral proof (fake-
  // indexeddb, the actual controller) that Save Result rejects
  // userDecision=NOT_REVIEWED with DECISION_REQUIRED, never mutates
  // notes/issueCodes/reviewedAt/session counters when blocked, and
  // that the pre-existing DECISION_NOT_ELIGIBLE gate still works
  // independently.
  'qa/epic-2e-k-r2-fix2-save-gate-test.mjs',
  // EPIC 2E-K-R2-FIX2 -- Section 7: Browser Detection Contract static
  // proof (found/executablePath/available agree in both the not-found
  // and genuinely-found cases; no top-level `import 'playwright'` in
  // preflight.mjs; Windows Chrome/Edge candidate paths present).
  'qa/epic-2e-k-r2-fix2-browser-contract-static-test.mjs',
  // EPIC 2E-K-R2-FIX2 -- Section 9/13: hostile proof for the pure
  // Real Pixel Comparison classifier (every required-FAIL state
  // genuinely fails; the genuine pass genuinely passes; honest-blocked
  // outcomes are accepted; false claims are always caught).
  'qa/epic-2e-k-r2-fix2-real-pixel-decision-static-test.mjs',
  // EPIC 2E-K-R2-FIX2 -- Section 1/13: dedicated coverage for
  // build-calibration-v2-preview-plan.js (previously untested) --
  // eligibility ladder, hard-stop/critical-overstack blocking,
  // production-safety hard-coded fields, and the
  // isCalibrationPlanProductionSafe() guard hostile-tested directly.
  'qa/epic-2e-k-r2-fix2-calibration-v2-plan-static-test.mjs',
  // EPIC 2E-K-R2-FIX2 -- Section 13: remaining hostile items (bug #6
  // exact-shape regression, SHA-256 known-vector + fake-hash-must-fail
  // proof, deriveUiBlockerReasonCode() hard-code-immunity proof).
  'qa/epic-2e-k-r2-fix2-hostile-closure-test.mjs',
  // EPIC 2E-K-R2-FIX4 -- Preview-before-review workflow and
  // Candidate-only approval safety contract.
  'qa/epic-2e-k-r2-fix4-preview-before-review-static-test.mjs',
  // EPIC 2E-L -- verified-pixel Candidate Review Pilot cohort math,
  // safety/regression gates, export hygiene, UI mode and i18n coverage.
  'qa/epic-2e-l-candidate-pilot-static-test.mjs',
  'qa/epic-2e-l-candidate-pilot-integration-static-test.mjs',
  // EPIC 2E-M -- guided Cohort intake, explicit-decision save gate,
  // save receipt, and next-pending navigation.
  'qa/epic-2e-m-guided-cohort-intake-static-test.mjs',
  // EPIC 2E-N1 -- Core Color Match Reference/Target signature and semantic delta foundation.
  'qa/epic-2e-n1-core-color-match-signature-static-test.mjs',
  'qa/epic-2e-n1-core-color-match-integration-static-test.mjs',
  // EPIC 2E-N2..N5 — photographic compensation, Lightroom candidate, preview fidelity and evaluation harness.
  'qa/epic-2e-n2-photographic-compensation-static-test.mjs',
  'qa/epic-2e-n3-lightroom-candidate-static-test.mjs',
  'qa/epic-2e-n4-preview-evaluation-static-test.mjs',
  'qa/epic-2e-n5-evaluation-harness-static-test.mjs',
  'qa/epic-2e-n1-n5-integration-static-test.mjs',
  // EPIC 2E-O — target-aware neutral/skin/highlight protection and Lightroom round-trip fidelity.
  'qa/epic-2e-o-target-aware-roundtrip-static-test.mjs',
  // EPIC 2E-O3..O7 — Candidate XMP data lineage, structural readback, direction gate and true pairwise preview.
  'qa/epic-2e-o3-o7-xmp-lineage-static-test.mjs',
  // EPIC 2E-O8 — perceptual LAB/CIEDE2000, Gaussian HSL and real tone/histogram curve integration.
  'qa/epic-2e-o8-best-of-both-color-match-static-test.mjs',
  // EPIC 2E-P0.7 — Pipeline Runtime Architecture (generation control, cache, heartbeat, state machine, ledger, schema, tracer, core runner).
  'qa/epic-2e-p0-7-pipeline-runtime-static-test.mjs',
  // EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair + State Machine Closure.
  'qa/epic-2e-p0-7-r5-preview-state-machine-static-test.mjs',
  'qa/epic-2e-p0-7-r5-intensity-cache-repair-static-test.mjs',
  // EPIC 2E-P0.7 R6 — True Preview-Critical Path Separation + Deferred Heavy Core Execution.
  'qa/epic-2e-p0-7-r6-preview-state-machine-static-test.mjs',
  'qa/epic-2e-p0-7-r6-fast-refined-critical-path-static-test.mjs',
  // EPIC 2E-P0.8A — Preview Rendering Artifact Repair + Posterization Removal + Candidate-to-Preview Fidelity.
  'qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs',
  // EPIC 2E-P1A — Single Image Analysis Session Foundation + Central Analysis Orchestrator.
  'qa/epic-2e-p1a-single-image-session-test.mjs',
  // EPIC 2E-P1A R3 — Upload lifecycle ordering regression (real loadFile()/handleReset()/beginUpload() sequencing).
  'qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs',
  // EPIC 2E-P1B — AI Image Analysis Report (normalized report contract, photographer interpretation, confidence model).
  'qa/epic-2e-p1b-analysis-report-test.mjs',
  // EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate + Candidate Store + Slider Synchronization + Candidate-Owned XMP Source.
  'qa/epic-2e-p1c-candidate-test.mjs',
  // EPIC 2E-P1C R2 — Candidate Runtime Lifecycle Order fix (build only after completeAnalysis() reaches COMPLETED/PARTIAL).
  'qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs',
  // EPIC 2E-P1C R3 — User-Edit XMP Export fix (transactional manual edits, export-readiness diagnostics, real edited-value XMP export).
  'qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs',
  // EPIC 2E-P1D -- XMP Serialize + Readback Fidelity Gate
  'qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs',
  // EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate.
  'qa/epic-2e-p1e-color-intelligence-test.mjs',
  // EPIC 2E-P1E R3 — XMP Color Parity Repair + Stronger Creative Tone Engine.
  'qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs',
  // EPIC 2E-P1F — Basic Tone Intelligence & Adaptive Dynamic Range.
  'qa/epic-2e-p1f-basic-tone-intelligence-test.mjs',
  // EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction.
  'qa/epic-2e-p1g-detail-intelligence-test.mjs',
  // EPIC 2E-P1G R2 — Detail Export Safety Clamp (Layer-B quickSafetyClamp() hard limits).
  'qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs',
  // EPIC 2E-P1H — White Balance Intelligence & Illuminant Separation.
  'qa/epic-2e-p1h-white-balance-intelligence-test.mjs',
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
