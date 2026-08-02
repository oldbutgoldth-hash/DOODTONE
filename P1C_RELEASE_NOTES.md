# LUMIXA AI — EPIC 2E-P1C Release Notes

**Version:** 2.3.0
**Title:** Canonical Lightroom Auto-Tune Candidate + Candidate Store +
Slider Synchronization + Candidate-Owned XMP Source
**Baseline:** EPIC 2E-P1B (AI Image Analysis Report) — v2.2.0

## Summary

The single-image Auto-Tune workflow now has one canonical, nested
**Candidate** object as its only source of Lightroom values, from the
moment analysis completes through slider display, manual edits, and
XMP export. Previously, XMP export reconstructed its values by reading
the DOM sliders at download time — a hidden, easy-to-desync source of
truth. That reconstruction path is retired for the main export flow.

## What's new

- **Canonical Candidate contract** — a single, versioned, nested JSON
  shape (`profile`, `whiteBalance`, `basic`, `curves`, `hsl`, `grading`,
  `cal`, `detail`, `effects`, `optics`, `metadata`, `diagnostics`) built
  once per analysis from `session.evidence` + the existing
  decision/validation/benchmark output. See `P1C_CANDIDATE_SCHEMA.md`.
- **Candidate Store** — a thin, generation-gated facade over
  `session.candidate` with `getActiveCandidate`, `updateCandidateParameter`,
  `resetParameterToAuto`/`resetAllToAuto`, `clearActiveCandidate`, and
  `getValidatedCandidate`.
- **Slider synchronization, both directions** — Candidate values render
  into the existing sliders after every analysis; editing a slider
  updates exactly one Candidate parameter, marks the Candidate
  `USER_EDITED`, and never re-runs analysis.
- **Reset-to-Auto** — per-parameter and reset-all, restoring the exact
  values captured right after the original build.
- **Candidate-owned XMP export** — `handleDownload()` now reads the
  validated Candidate, converts it with the new
  `legacy-preset-adapter.js`, and hands it to the existing, unmodified
  `quickSafetyClamp()` → `serializeXMP()` → `downloadXMP()` chain.
  Export is blocked with an explicit message if no valid Candidate
  exists — never a silent fallback to stale slider values.
- **Minimal Candidate status badge** — a small, text/color-only UI
  element (`#candidateStatusBadge`) showing Building / Ready / Valid /
  Valid with warnings / Invalid / User edited / Failed. Not a redesign
  — the sliders remain the one visible editor.

## What's explicitly unchanged

- Core analysis formulas (Style Fingerprint, Lightroom Mapping, Basic
  Panel, HSL, Grading, Calibration engines) — untouched.
- The XMP serializer (`core/preset-engine/index.js`), the final safety
  clamp (`core/xmp-validator/index.js`'s `quickSafetyClamp`), and the
  Lightroom Mapping Engine — byte-identical, verified by hash.
- Reference Color Match, P0.8A Preview pixel pipeline, Preview State
  Machine — untouched; all pinned-baseline invariant tests still pass.
- Production safety locks (`productionSource=legacy`,
  `productionWrite=false`, `controlledV2Apply=false`,
  `xmpWriteAllowed=false`, `productionActivationAllowed=false`) —
  unchanged.
- Numerical Lightroom output for a given evidence set — a Candidate
  built from the exact same raw preset produces the exact same exported
  XMP values as the pre-P1C DOM-reconstruction path (verified by a
  round-trip equivalence test).

## Scope boundary (deferred to P1D)

Full XMP readback fidelity validation — parsing an exported XMP file
back and proving pixel-for-pixel equivalence against the Candidate — is
out of scope for P1C. P1C only makes the Candidate the export *source*;
the serializer itself is untouched and its output is not yet
round-trip-validated end-to-end.

## Verification

- 86/86 new P1C static/integration test cases pass (real production
  modules, no duplicated Core formulas) — see
  `qa/epic-2e-p1c-candidate-test.mjs`.
- Full existing static suite (P1A 25/25 + P1A R3 16/16, P1B 39/39,
  P0.8A/RCM invariants, Production-lock manifest across 145 files,
  i18n coverage/leak audits, and every prior EPIC's regression suite)
  passes unmodified — 302/302 files parse as valid ES modules.
- Browser QA: Chromium unavailable in this environment — see honest
  scope statement in `P1C_QA_REPORT.md`.


---

# R2 — Candidate Runtime Lifecycle Order Fix

**Version:** 2.3.1
**Title:** Candidate Runtime Lifecycle Order Fix
**Baseline:** EPIC 2E-P1C R1 — v2.3.0

## Summary

Fixes a real, 100%-reproducible browser bug: every real analysis run
showed **"สร้างค่า AUTO-TUNE ไม่สำเร็จ" / "Auto-Tune Candidate build
failed"** because the canonical Candidate was being built while the
Single Image Session was still `ANALYZING` — before `completeAnalysis()`
had ever run. `buildAndCommitCandidate()`'s own terminal-status safety
guard (preserved, not weakened) correctly rejected every one of these
premature calls with `reason: SESSION_NOT_TERMINAL`, which is exactly
what the UI then displayed as a failure.

## What changed

- The Candidate build/validate/store-commit/slider-sync step in
  `ui/app.js` now runs immediately after
  `completeAnalysis()` returns, gated on the real `finalSessionStatus`
  value (`COMPLETED` or `PARTIAL` only) — mirroring the already-correct
  pattern used for the AI Image Analysis Report build.
- The slider-synchronization guard is now wrapped in `try/finally`, so
  a thrown error mid-render can never leave it stuck `true`.
- A new, exact-shape `console.error('[P1C Candidate Build Failed]',
  {...})` diagnostic (7 fields: reason, sessionStatus, sessionId,
  generationId, candidateRawAvailable, validationErrors,
  validationWarnings — never image/binary data) fires on any build
  failure.
- FAILED, ABORTED, and stale-ticket Sessions now explicitly clear the
  Candidate Store and badge rather than relying only on the outer
  exception handler.

## What's explicitly unchanged

- `buildAndCommitCandidate()`'s terminal-status guard inside
  `core/single-image/single-image-orchestrator.js` — preserved exactly
  as-is, per explicit requirement. The fix is entirely in its caller's
  call-site ordering.
- The Candidate schema, Candidate Store ownership model,
  Candidate-to-slider mapping, slider-to-Candidate manual editing, XMP
  serializer, Legacy Preset Adapter mapping, P1B Report calculations,
  P1A upload lifecycle, Reference Color Match, P0.8A Preview renderer,
  and Production safety locks — all untouched, all re-verified passing.

## Verification

- New `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs`: 19/19
  PASS on the fixed source; independently confirmed to drop to 15/19
  (4 FAIL, exactly the 4 checks that encode this fix) against a
  reconstructed copy of the pre-fix source.
- Existing P1C suite (86/86), P1B suite (39/39), P1A + P1A R3 suites
  (25/25 + 16/16), P0.8A suite (22/22), full static suite (75 suite
  files), Reference Color Match / Production-invariant hash suites, and
  the 145-file Production Lock manifest — all pass, 0 FAIL.
- Browser QA: Chromium remains unavailable in this environment (network
  allowlist blocks the Playwright CDN download, no system binary) — see
  the honest scope statement in `P1C_QA_REPORT.md` and full detail in
  `P1C_R2_RUNTIME_LIFECYCLE_FIX.md`.
