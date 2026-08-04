# P1G R2 — Detail Export Safety Clamp

## The verified defect this round closes

P1G R1 shipped Layer-A guardrails (`detail-guardrails.js`) that protect
every *auto-generated* Sharpening/Luminance Noise Reduction value the
Detail Plan itself produces. But P1G R1 also documented — accurately,
as a known limitation — that `core/xmp-validator/index.js`'s
`quickSafetyClamp()` (Layer B, the second, export-time safety net
every other panel already has) had **zero rules** for `preset.sharp`/
`preset.noise`. Mutation test M4 proved the gap concretely: a
post-commit overwrite of `candidate.detail.sharpening = 999` survived
`candidateToLegacyPreset()` → `quickSafetyClamp()` unchanged, and
`serializeXMP()` exported `crs:Sharpness="999"` — an out-of-range,
unsafe Lightroom preset value. Layer A only ever runs once, before
Candidate commit; it cannot protect against a bug elsewhere in the
codebase, a future regression, or any direct in-place mutation of the
Candidate after that point. This round adds the missing Layer B.

## What changed

`core/xmp-validator/index.js` — the one Production-Locked file this
round is allowed to touch:

- Added a new `HARD_LIMITS.detail` entry:
  ```js
  detail: {
    sharpening: { min: 0, max: 40 },
    noiseReduction: { min: 0, max: 40 },
  }
  ```
- Added `_clampDetailPanel(p, HARD_LIMITS.detail, adjustments)`, called
  from `quickSafetyClamp()` immediately after the existing
  `_clampBasicPanel(...)` call — same position in the pipeline, same
  calling convention, same `adjustments` diagnostics array every other
  panel already writes to.
- `_clampDetailPanel()` follows the exact fail-closed pattern already
  established in `detail-guardrails.js` (P1G R1): `Number.isFinite()`
  is checked *before* clamping, because `Math.max(lo, Math.min(hi,
  NaN))` evaluates to `NaN`, not a safe default. `NaN`/`Infinity`/
  `-Infinity` all resolve to `0` (the documented minimum), never pass
  through unclamped, and never silently coerce to a dangerous
  default. Negative values clamp to `0`; values above the ceiling
  clamp to the ceiling.

Nothing else in `quickSafetyClamp()` changed — every existing Basic/
WB/HSL/Calibration/Presence rule, bound, and clamp order is byte-for-
byte the same as before this round (verified: `HARD_LIMITS.basic`,
`.wb`, `.hsl`, `.calibration`, `.presence` are untouched; test 23).
Color Noise Reduction remains unsupported and unclamped (it has no
Candidate→XMP export path at all — see
`P1G_SUPPORTED_XMP_DETAIL_FIELDS.md` — so there is nothing for a
Layer-B export clamp to protect).

## Why 0–40 for both fields

Three independent data points were cross-referenced before choosing
the ceiling (`P1G_DETAIL_VALUE_LINEAGE_AUDIT.md` §5 has the full
slider audit):

1. **Real Lightroom/UI slider range**: Sharpening 0–150, Luminance
   Noise Reduction 0–100 (confirmed via `index.html` grep — genuine
   Adobe Lightroom Develop-module ranges, not an app-specific bug).
2. **P1G's own planner ceiling**: `detail-schema.js`'s `BOUNDS` never
   lets the Sharpening or Noise Reduction planner emit a value above
   35 for either field, across every strength mode (`NATURAL` /
   `BALANCED` / `CRISP`) and every fixture tested.
3. **This round's spec recommendation**: 0–40 for both fields.

40 sits just above the planner's own real ceiling (35) — enough
headroom that a normal, correctly auto-generated Candidate value is
*never* touched by the export clamp (test 7, test 8, test 12) — while
staying far below the UI's own much wider slider bounds, so it
genuinely catches out-of-range/corrupted values rather than only
theoretical extremes.

## Required flow (now true end-to-end)

```
Candidate → candidateToLegacyPreset() → quickSafetyClamp() → safe Detail values → serializeXMP() → P1D readback → Lightroom
```

Verified directly against the real production pipeline (not
reimplemented in the test file): a corrupted `candidate.detail.sharpening
= 999` is clamped to `40` by `quickSafetyClamp()`, `serializeXMP()`
writes `crs:Sharpness="40"`, and P1D's real `runXmpFidelityGate()`
reports `status: PASS` because both sides of its comparison (Export
Expected and XMP readback) already reflect the safe, clamped value —
not the unsafe 999 the Candidate still literally holds for lineage
purposes.

## Parity policy (unchanged code, new correct behavior)

`candidate-export-parity.js`'s `computeExportParity()` already called
`quickSafetyClamp()` internally to compute `exportExpectedValue` for
every field — this was true before this round and needed **zero code
changes**. Adding the new `HARD_LIMITS.detail` entry made every
downstream consumer (Advanced Diagnostics parity table, the Fidelity
Gate, `renderDetailIntelligenceDiagnostics()`) automatically correct,
by construction:

- **Normal, auto-generated Candidate** (the overwhelming common case):
  the Detail Plan's own values are already within `[0, 35]`, well
  inside the new `[0, 40]` export ceiling — `quickSafetyClamp()` makes
  **zero** changes, `candidateVsExportMatch` stays `true`, no
  adjustment is reported (tests 7, 8, 12, 20).
- **Corrupted/manually out-of-range Candidate**: `quickSafetyClamp()`
  applies the new protection, Export Expected differs from the raw
  Candidate value, `computeExportParity()` correctly reports
  `candidateVsExportMatch: false`, and the Advanced Diagnostics panel
  shows the adjustment (tests 13, 15, 19) — this is the clamp working
  as designed, not a parity failure. P1D's Fidelity Gate compares XMP
  readback against Export Expected (the already-clamped value), never
  against the unsafe pre-clamp Candidate value, so it correctly
  reports `PASS` for a safely-exported corrupted input (test 18).

## UI

The Detail sliders' real HTML `min`/`max`/`step` attributes were
verified in `index.html` to already sit inside safe, sane ranges — the
UI cannot normally produce an out-of-range value through ordinary use.
No UI redesign was required or made. When `computeExportParity()`
(recomputed fresh on every Advanced Diagnostics render — not a stale
build-time snapshot) detects a real Candidate-vs-Export-Expected
difference for either Detail field, a new bilingual notice appears
inside the existing Detail Intelligence Advanced Diagnostics section:

- Thai: "ค่ารายละเอียดบางรายการถูกปรับให้อยู่ในช่วงปลอดภัยก่อนส่งออก"
- English: "Some detail values were adjusted to export-safe limits"

This reuses the exact same parity-computation code path the panel
already used in P1G R1 for its Candidate-vs-Export-Expected table —
the fix required no new parity mechanism, only a new conditional
notice driven by data that mechanism already produced.

## Tests

`qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs` — **35/35
PASS** (32 required numbered cases across CORE CLAMP BEHAVIOR 1-6,
NORMAL VALUES UNCHANGED 7-12, DIAGNOSTICS AND LINEAGE 13-19, USER EDIT
AND RESET 20-21, UNCHANGED BEHAVIOR 22-23, REGRESSION 24-32, plus a
self-consistency check and two mutation-evidence sub-checks 24b/24c/
24d), run directly against the real production modules. See
`P1G_R2_QA_REPORT.md` for the full verification log and exact
commands.

`qa/epic-2e-p1g-detail-intelligence-test.mjs` (P1G R1's own suite) —
mutation test **M4** was rewritten this round from its old expectation
(sharp=999 passes through unclamped — proving the gap existed) to its
new required expectation (sharp=999 → clamp applied → safe maximum
exported → adjustment recorded → P1D readback equals the safe
maximum). A new mutation test **M4b** was added immediately after it,
proving the identical protection for Noise Reduction. Full suite:
**68/68 PASS**.

## Deviations / additional findings from this round

While building this round's test 17 (P1D readback matches the clamped
value), a pre-existing, unrelated defect was found in P1G R1's own
test file: tests 7 and 46 read
`gateReport?.comparisonResult?.comparisons` — a path that does not
exist on the real object `runXmpFidelityGate()`/`buildFidelityReport()`
returns (the real path is the flat `report.comparisons`). Because the
wrong path always evaluated to `undefined` and both checks used a `??
[]`/`|| []` fallback, both assertions were **vacuously true** —
passing regardless of the actual Detail-field comparison result,
rather than genuinely verifying it. This was scoped strictly to
`qa/epic-2e-p1g-detail-intelligence-test.mjs` (the one P1G R1 test
file) and fixed this round; it is not a production-code defect — the
real `runXmpFidelityGate()`/`quickSafetyClamp()` pipeline was already
behaving correctly for the scenarios those two tests exercise, only
the test assertion itself was silently checking the wrong thing. Both
tests now genuinely pass against real gate output (`detailMismatches:
0`, `status: PASS`). See `P1G_R2_QA_REPORT.md` for full detail.

## What did NOT change this round

P1G evidence extraction, scene classification, the Sharpening/Noise
Reduction planners, P1F's Basic-tone formulas, P1E's color formulas,
the Candidate Store, every serializer property name, P1D's comparison
policy, Reference Color Match, the Preview pipeline, and every
Production-write safety flag. No export support was added for Color
Noise Reduction this round — it remains diagnostic-only, unchanged
from P1G R1.
