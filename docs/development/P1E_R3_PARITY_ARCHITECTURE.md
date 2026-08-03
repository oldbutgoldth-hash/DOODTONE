# EPIC 2E-P1E R3 — Parity Architecture

## Required Parity Policy (chosen)

**Sliders show the exact current Candidate value. Candidate values are
normalized into export-safe ranges at the moment P1E computes them, so
Candidate == UI == Export Expected == XMP == Lightroom for every
P1E-authored color field.** The final `quickSafetyClamp()` safety net
remains unchanged and unremoved, as a defensive layer for the one
scenario it can still fire on: manual, out-of-P1E-bounds slider edits.

This is the "Normalize P1E Candidate values into export-safe ranges
before commit" option from the round's required policy choice — it
was chosen over "show a warning banner whenever clamp would differ"
because the audit (`P1E_R3_COLOR_VALUE_PARITY_AUDIT.md`) proved P1E's
own BOUNDS are always strictly tighter than every export-time hard cap,
making a warning banner a permanent false-negative for auto-generated
color. The Advanced Diagnostics panel (§ below) still exists for the
one case a divergence CAN legitimately occur: manual edits.

## Pipeline, end to end

```
Core engines (hsl-analyzer / colorgrading-ai / calibration)
        │  evidence, already scene-trust-weighted upstream
        ▼
evidence-color-signals.js :: deriveColorSignals()
        │  defensive extraction, never fabricates a missing signal
        ▼
creative-tone-strategy.js :: classifyScene() + getFamilyMultiplier()
        │  bounded [0.5,1.3] scene multiplier, read-only signal
        ▼
color-plan-builder.js :: buildColorPlan()
        │  fraction = strengthScalar × sceneMultiplier × skinCaution
        │  _restoreTowardEvidence() / restoreCircularHue() (unchanged math)
        │  _roundClean() -- EVERY field rounded to whole Lightroom units (R3, new)
        ▼
candidate-builder.js :: applyColorIntelligence()  [wraps buildColorPlan]
        │  writes plan.* onto candidate.hsl/.grading/.cal/.basic
        │  diagnostics.sceneClass/.sceneReasons/.layers now propagated (R3 fix)
        ▼
single-image-orchestrator.js :: buildAndCommitCandidate()
        │  commits Candidate once; computes Export Parity once (R3, new)
        │  candidate.diagnostics.exportParity = computeExportParity(candidate)
        ▼
   ┌────────────────────┬─────────────────────────────┐
   │ UI slider render   │ Advanced Diagnostics panel   │
   │ (live Candidate)   │ (candidate.diagnostics.exportParity) │
   └────────────────────┴─────────────────────────────┘
        │
        ▼ (only on "Download .xmp")
legacy-preset-adapter.js :: candidateToLegacyPreset(candidate)
        ▼
xmp-validator/index.js :: quickSafetyClamp(preset)   [Production-Locked, unchanged]
        ▼
preset-engine/index.js :: serializeXMP(exportExpectedPreset)  [Production-Locked, unchanged]
        ▼
xmp-fidelity-gate.js :: runXmpFidelityGate()   [P1D, unchanged]
        │  parses the ONE generated XMP string back, compares against
        │  exportExpectedPreset -- proves serializer/parser fidelity
        ▼
   Lightroom import
```

## computeExportParity() — what it proves, and what it does not

`core/single-image/candidate/candidate-export-parity.js` (NEW, R3)
recomputes `candidateToLegacyPreset(candidate)` then
`quickSafetyClamp()` FRESH, every time it is called, and compares the
result field-by-field against the live Candidate. It answers: **"if I
exported this Candidate right now, would every value survive
unchanged through the safety clamp?"** — entirely independent of
whether an export has ever actually happened.

It does NOT catch: a bug where the real serializer or a hand-edited
intermediate preset object diverges from what `candidateToLegacyPreset`
would produce fresh (that class of bug is P1D's job —
`compareCandidateToReadback()`/`runXmpFidelityGate()`, which compares
the ACTUAL generated XMP string against the export-expected preset
used to build it). The two utilities are complementary, not
overlapping: `computeExportParity` = Candidate-vs-export-safe-range;
P1D Fidelity Gate = export-preset-vs-actual-serialized-XMP. See the
Mutation Tests in `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs`
for a worked example of each layer catching a different corruption
class.

## Trace events (bounded, no image data)

Added to `single-image-orchestrator.js::buildAndCommitCandidate()`,
right after the existing `CANDIDATE_NORMALIZED` trace, all carrying
`sessionId`/`generationId`/`candidateId` (candidateRevision is on the
Candidate itself, referenced via candidateId):

`CREATIVE_TONE_PLAN_CREATED` (strengthMode, sceneClass,
fieldsBoostedCount) → `COLOR_PARITY_AUDIT_STARTED` →
[`COLOR_EXPORT_SAFE_ADJUSTMENT` once per mismatched field, if any] →
`COLOR_PARITY_MATCH` or `COLOR_PARITY_MISMATCH` (mismatchCount) →
`COLOR_PARITY_AUDIT_COMPLETED` (allMatch, totalChecked) →
`CREATIVE_TONE_PLAN_APPLIED` (engaged).

## UI: Advanced Diagnostics parity panel

`index.html` adds a `<details id="exportParityDiagnostics">` block
(collapsed by default, opt-in — main UI stays unchanged), rendered by
`ui/app.js::renderExportParityDiagnostics(candidate)` right after
`renderCandidateToSliders()`. Table columns: Parameter / Candidate
current / Export expected / Match status, one row per
`PROPERTY_MAP` entry, sourced directly from
`candidate.diagnostics.exportParity`. If any mismatch exists, a notice
div shows the exact required bilingual text (`en.appShell.exportParitySafeAdjustmentNotice`
/ `th.appShell.exportParitySafeAdjustmentNotice`) plus the affected
parameter names and before/after values. Never renders raw XML.
