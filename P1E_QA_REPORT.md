# P1E — QA Report

**EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate**
Version 2.5.1 (R2). Baseline: EPIC 2E-P1E R1 (v2.5.0).

## R2 -- Circular Grading Hue fix

A real mathematical defect was reported and fixed this round: Color
Grading Hue (`grading.{shadows,midtones,highlights}.hue`) was being
restored with the same generic linear/signed helper
(`_restoreTowardEvidence()`) used for every other field, but Grading Hue
is an absolute, cyclic 0-359 degree angle, not a signed relative
adjustment. Linear interpolation across the 0/360 boundary (e.g. current
350 -> target 10) produced a wildly wrong intermediate result (112,
landing in an unrelated green/cyan hue) instead of the correct short
circular path (4, a small warm-hue nudge). Full root cause, fix, and
verification are in the new `P1E_R2_CIRCULAR_GRADING_HUE_FIX.md`. In
summary:

- Two new pure helpers, `normalizeHue()` and `restoreCircularHue()`,
  were added to `color-plan-builder.js` and are used only for Color
  Grading Hue -- never for HSL Hue or Calibration Hue, which remain
  signed relative adjustments on the original linear path.
- Color Grading Saturation and Luminance formulas, all P1E bounds, and
  the default BALANCED strength mode are byte-identical to R1.
- 24 new checks (tests 71-90) were added to
  `qa/epic-2e-p1e-color-intelligence-test.mjs`, covering every scenario
  requested in the fix report (short path both directions, both
  directions across the exact 359/1 red boundary, two ordinary non-
  wrapping cases, a wide in-range sweep, fraction 0/1 boundaries,
  fraction > 1 under STRONG, the exact-180-degree tie-break in both
  directions, and source-level plus numeric proof that HSL Hue,
  Calibration Hue, and Grading Saturation/Luminance are all unchanged).
  94/94 PASS, 0 FAIL (70 R1 checks + 24 new R2 checks, all in the same
  file, same run).
- Re-verified after the fix, standalone: `qa/epic-2e-p1c-candidate-
  test.mjs` 86/86 PASS, `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs`
  71/71 PASS.
- All 68 suites in `qa/run-static-suites.mjs` were individually
  re-verified to exit 0 from a freshly extracted R2 ZIP (see the
  methodology section below, and
  `qa/baselines/p1e_r2_full_static_suite_results.txt`).

No other P1E module, no Candidate/Session/XMP/Fidelity-Gate file, and no
Production-locked file changed in R2 -- only `color-plan-builder.js`,
the test file, `package.json`'s version, and this documentation set.

## R1 baseline note (unchanged from the original P1E delivery)

No new project ZIP was attached to this round's request; the working
directory that produced the delivered `LUMIXA_EPIC_2E_P1D_XMP_READBACK_
FIDELITY_GATE_R2.zip` was used as the confirmed current baseline, per
this project's "Latest Project File Rule". This is stated here explicitly
per that rule rather than left implicit.

## New test suite: `qa/epic-2e-p1e-color-intelligence-test.mjs`

**94/94 PASS, 0 FAIL (70 R1 checks + 24 new R2 circular-hue checks).** Run against the real production modules
(`buildCandidateFromSession`, `candidateToLegacyPreset`, `quickSafetyClamp`,
`serializeXMP`, `runXmpFidelityGate`, the real orchestrator, the real
Candidate Store). Covers:

- **Schema (checks 1–6):** version string, monotonic strength scalars,
  default mode, `skinCautionScale()` monotonicity, `buildEmptyColorPlan()`
  shape.
- **Evidence signals (7–14):** never-throws on empty evidence, correct
  no-op on the exact minimal P1C fixture shape, correct rejection of
  `SOFT_FAILED` evidence even with a rich result, correct extraction from
  full `hsl-analyzer-engine`/`colorgrading-ai-engine`/`calibration-engine`-
  shaped results, skin extraction, non-mutation of the input evidence.
- **Plan builder (15–32):** non-trivial engagement for a colorful scene,
  ≥3 field families boosted, meaningful (not near-zero) HSL push, every
  HSL/Calibration/Presence value bounded by its own independently-owned
  `BOUNDS`, low-coverage channel left untouched, restoration never
  overshoots the evidence target, heavy-skin scene protection
  (`skinProtection.applied`/`scale`), skin push measurably smaller than a
  comparable non-skin push, no sign-flip on skin channels, sign-conflict
  conservatism, Grading confidence gate, NATURAL vs. CINEMATIC strength
  difference, bound invariance across strength modes, source-level checks
  that calibration skin-scaling only applies to the red primary and that
  the plan builder is a pure function.
- **Engine (33–39):** in-place mutation (same object returned), diagnostics
  schema version, engagement flag, non-color fields (`basic.exposure`,
  `whiteBalance.*`, `curves`) untouched, documented-UNSUPPORTED fields
  (`grading.balance`, `cal.shadowTint`) remain `null`.
- **Real `buildCandidateFromSession()` integration (40–47):** succeeds
  with rich evidence, `diagnostics.colorIntelligence` populated, HSL blue
  saturation meaningfully non-zero, `autoValues`/lineage correctly reflect
  the enriched value (not the pre-enrichment one) — and, as a permanent
  regression guard, the exact minimal P1C-fixture-shaped evidence still
  yields the exact pre-P1E values (`hsl.hue.orange === 3`,
  `grading.shadows.hue === 220`, `cal.redPrimarySaturation === 5`).
- **Full pipeline (48–53):** Candidate build succeeds for both a colorful
  scene and a heavy-skin scene; `quickSafetyClamp()` does not further
  alter the already Layer-A-bounded HSL saturation value; `serializeXMP()`
  produces a real, non-empty XMP string; the P1D XMP Fidelity Gate still
  reports PASS or PASS_WITH_WARNINGS in both scenarios; the exported
  skin-adjacent HSL saturation stays under the app's existing hard skin
  ceiling.
- **User edit + lifecycle (54–58):** the enriched Candidate is committed
  to the Candidate Store; a simulated user edit on top of a P1E-enriched
  Candidate still round-trips through export and the Fidelity Gate;
  Reset clears the Candidate Store (no stale enrichment/diagnostics
  survive); a fresh upload after Reset builds its own independent,
  correctly-enriched Candidate with no leakage from the prior session;
  Candidate build/commit still happens exactly once.
- **Purity / hostile checks (59–62):** no `document`/`window`/
  `localStorage` access, no network access, no calls to
  `buildFinalPreset`/`validateFinalPreset`/`quickSafetyClamp`, no import
  of `core/decision-engine` or `core/xmp-validator` — checked against
  comment-stripped source (the modules' own doc comments legitimately
  *discuss* these names in prose to explain what they deliberately do
  not do; only executable code is scanned).
- **Delegated regression (63–70):** P1A, P1A R3 (16/16), P1B, P1C R2
  (19/19), Reference Color Match integration (6/6), RCM N1–N5 (5/5),
  Production-lock manifest (92/92 internal checks), and the ESM syntax
  gate all re-verified passing, spawned directly from this suite.

### Why `qa/epic-2e-p1c-candidate-test.mjs`, `-p1c-r3-...`, and
### `-p1d-xmp-fidelity-gate-...` are NOT spawned from inside the new suite

Those three suites each already spawn several further suites of their
own (their own delegated-regression sections) — spawning them recursively
from inside `epic-2e-p1e-color-intelligence-test.mjs` chains into a
process count that does not finish inside this environment's single-
command execution budget. They were instead run directly, standalone,
as part of this round's verification (see next section), which is both
faster and avoids double-counting the same suites' own internal spawns.

## Direct standalone verification (run individually, not nested)

| Suite | Result |
|---|---|
| `qa/epic-2e-p1c-candidate-test.mjs` | **86/86 PASS** — proves the P1E integration edit to `candidate-builder.js` causes zero regression to the exact-value HSL/Grading/Calibration assertions this suite depends on |
| `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` | **19/19 PASS** |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | **39/39 PASS** |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | **71/71 PASS** — the Fidelity Gate mechanism itself is completely unaffected; it validates whatever ends up in the Candidate at export time, and now simply sees stronger, still-valid color values |

## Full static suite verification methodology

Same methodology established in P1D R2: `node qa/run-static-suites.mjs`
cannot complete within this tool's hard 45-second single-command timeout,
so every suite in `STATIC_SUITES` (68 entries, up from 67 in P1D R2 — the
new P1E suite was added) was extracted from `qa/run-static-suites.mjs` in
its exact declared order and run individually (`node <suite-path>`,
capturing its real process exit code) across several chunked tool calls.
`qa/run-static-suites.mjs`'s own exit logic is unchanged from P1D R2:
`spawnSync` each suite in-process, in that same order; exit 1 if any
failed, else exit 0.

**Result: all 68/68 suites exited 0 (re-confirmed in R2, after the
circular-hue fix, from a freshly extracted ZIP).** Raw evidence logs
saved at `qa/baselines/p1e_full_static_suite_results.txt` (R1) and
`qa/baselines/p1e_r2_full_static_suite_results.txt` (R2, current). This
makes
`node qa/run-static-suites.mjs`'s exit code deterministically `0` per its
own source logic, per the same reasoning documented in P1D R2's report.

## Production Safety Locks

`productionSource = legacy`, `productionWrite = false`,
`controlledV2Apply = false`, `xmpWriteAllowed = false`,
`productionActivationAllowed = false` — all re-verified unchanged.
`qa/epic-2e-j-r2-phase-e-static-test.mjs` (the 145-file Production-lock
manifest check) re-ran clean: **92/92 PASS, 0 FAIL, 0 NOT_TESTED**, all
145 locked files byte-for-byte identical to the checked-in manifest. Note:
a single incidental grep match for "candidate-schema" inside that
manifest refers to an unrelated, differently-pathed legacy file
(`core/candidate-schema.js`, top-level `core/`) — not
`core/single-image/candidate/candidate-schema.js`, which P1E did modify
and which is confirmed NOT part of the locked-file set (consistent with
it having already been legitimately modified in the P1C/P1C R2/P1C R3/P1D
rounds without breaking this check). No manifest regeneration was
necessary this round.

## Browser QA — honest scope

Real browser verification (Playwright/Chromium) was not attempted this
round beyond re-confirming the same environment finding from every prior
round: Chromium is not installable in this sandbox (`npx playwright
install chromium` returns a network-allowlist block) and no system
Chrome/Chromium binary is present. All P1E behavior above was verified at
the module and full-pipeline level in real Node against the real
production modules (not mocked), which is the strongest verification
available in this environment. No browser-only click-through scenario
(e.g. visually confirming a stronger color result on a real photo in the
running app) is claimed as verified.

## Known limitations

- Grading's trust gate is necessarily all-or-nothing across shadows/
  midtones/highlights together, because `colorgrading-ai-engine` exposes
  one blended `confidence` value rather than per-zone coverage. A future
  engine change exposing per-zone confidence could let P1E trust
  individual zones independently; not attempted this round (would be a
  Core engine change, out of scope).
- No new user-facing intensity control is exposed this round, per the
  EPIC's explicit non-goal ("keep visible UX minimal... default behavior
  clearly improved even without new UI control"). The internal
  `STRENGTH_MODE` architecture exists specifically so a future control
  could be added additively.
- As documented in P1D, 23 Candidate fields (including
  `candidate.grading.balance` and `candidate.cal.shadowTint`) are not
  exported by the current serializer at all; P1E does not write to
  either of them, matching that pre-existing, documented limitation.
- (Resolved in R2) R1 shipped with the Color Grading Hue
  circular-interpolation defect described in
  `P1E_R2_CIRCULAR_GRADING_HUE_FIX.md` -- Grading Hue was restored with
  the same linear formula as every signed relative field, which is
  wrong for an absolute cyclic angle and could turn a small warm-hue
  push into an unrelated hue near the 0/360 boundary. Fixed in R2; no
  other known defect of this kind was found in HSL Hue or Calibration
  Hue, both of which are genuinely signed relative adjustments and
  correctly remain on the linear path.
