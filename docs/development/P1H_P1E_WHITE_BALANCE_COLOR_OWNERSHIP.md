# P1H / P1E — White Balance / Color Ownership Boundary

## The rule

- **P1H owns exactly**: `candidate.whiteBalance.temperature`,
  `candidate.whiteBalance.tint`, and
  `candidate.diagnostics.whiteBalanceIntelligence` (its own
  diagnostics/lineage object).
- **P1E owns**: `candidate.hsl.*`, `candidate.grading.*` (excluding
  `balance`), `candidate.cal.*` (excluding `shadowTint`), and
  `candidate.basic.vibrance`/`.saturation` — technical color
  correction and creative-mood/grading, never Temperature/Tint.
- Neither module may write into the other's fields. This is the same
  ownership-separation pattern P1F/P1E and P1F/P1G already established
  for Basic/Color and Basic/Detail respectively.

## Why this matters

Temperature/Tint and HSL/Grading/Calibration are visually related
(both affect the image's overall color balance) but serve different
purposes: White Balance corrects a technical defect or represents an
intentional lighting choice; Color Grading applies a creative
look/mood on top of an already-correct (or intentionally-preserved)
base. Letting one module adjust the other's fields would make it
impossible to reason about "why does this image look the way it
does" — a core explainability requirement for this project.

## How it is enforced

1. **Source-level**: `wb-plan-builder.js` and every module under
   `core/single-image/white-balance-intelligence/` never reference
   `candidate.hsl`, `candidate.grading`, or `candidate.cal` anywhere in
   their source (proven by regex over comment-stripped source in the
   P1H test suite, check 1).
2. **Build-order**: `candidate-builder.js` calls
   `buildWhiteBalancePlan()` and writes its result BEFORE
   `applyColorIntelligence()` runs (P1E's own enrichment step), so
   P1E's own evidence-gate logic never has to guess whether
   Temperature/Tint changed underneath it — it simply never reads
   those fields.
3. **Reverse check**: `core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js`
   (P1F) is independently confirmed to never reference `whiteBalance`
   either (P1H test suite check 8), closing the loop on all three
   modules' mutual boundaries.
