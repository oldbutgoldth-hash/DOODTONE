# EPIC 2E-P1C — Legacy Preset Migration Map

## What changed

| Before P1C | After P1C |
|---|---|
| `handleDownload()` called `readSlidersAsPreset()` to reconstruct a flat preset **from the DOM sliders** | `handleDownload()` calls `candidateStore.getValidatedCandidate()` to read the canonical Candidate, then `candidateToLegacyPreset(candidate)` to reshape it into the same flat preset shape |
| `runAnalysis()`'s Candidate-commit block called `applyPresetToSliders(finalPreset)` to write the raw flat preset **directly** into the DOM sliders | `runAnalysis()` calls `singleImageOrchestrator.buildAndCommitCandidate()` to build+commit the canonical Candidate, then `renderCandidateToSliders(candidate, { setSlider })` to render **from the Candidate** |
| `session.candidate` held the raw flat `buildFinalPreset()` output | `session.candidate` holds the canonical nested P1C Candidate; the raw flat output moved to `session.candidateRaw` |

## `readSlidersAsPreset()` — deprecated compatibility function

**Status: unused by the main single-image export path as of P1C.**
Confirmed via project-wide grep: zero remaining callers in this
codebase (its own definition is the only match). Not deleted outright
— retained as a documented, explicitly-commented compatibility fallback
in `ui/app.js`, per the spec's legacy-compatibility guidance, in case a
currently-undiscovered path is later found to need it. If a future EPIC
confirms it has no remaining purpose, it can be safely removed at that
point.

## `applyPresetToSliders()` — deprecated compatibility function

**Status: unused as of P1C.** Its one call site (inside `runAnalysis()`)
was replaced with `renderCandidateToSliders()`. Confirmed via
project-wide grep: zero remaining callers. Retained with an explicit
deprecation comment for the same reason as above, not deleted.

## `commitCandidate()` — repurposed, not removed

P1A's `commitCandidate(ticket, candidate)` in
`single-image-orchestrator.js` is unchanged in behavior — it still
writes the flat, already-validated/benchmarked preset the moment the
existing decision/validation/benchmark pipeline finishes. Only its
write target changed: `s.candidate = candidate` → `s.candidateRaw =
candidate`, because `session.candidate` is now reserved for the
canonical Candidate. See `P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md` §6/§13
for the full safety analysis of this rename.

## New XMP export flow (verbatim, from `ui/app.js`'s `handleDownload()`)

```
candidateStore.getValidatedCandidate()
  → null?  block export, trace XMP_EXPORT_BLOCKED_NO_CANDIDATE,
           show t('appShell.downloadBlockedNoCandidate', ...), return
  → candidate:
      candidateToLegacyPreset(candidate)          // NEW — canonical → flat
        → quickSafetyClamp(preset)                // UNCHANGED — same final safety net
          → serializeXMP(preset)                  // UNCHANGED — same serializer
            → downloadXMP(xmp, name)               // UNCHANGED — same download
      trace XMP_EXPORT_USING_CANDIDATE
```

`quickSafetyClamp()`, `serializeXMP()`, and `downloadXMP()` are
byte-identical to their pre-P1C source (verified by the Production-lock
manifest and the N1 production-invariant hash suite, both of which
still pass — see `P1C_QA_REPORT.md`). Only the *input* reaching
`quickSafetyClamp()` changed, from a DOM-reconstructed preset to
`candidateToLegacyPreset(validatedCandidate)`.

## Numerical equivalence

`candidateToLegacyPreset()` is the exact structural inverse of
`candidate-builder.js`'s reshape — verified by a round-trip test
(static test 49-53 in `qa/epic-2e-p1c-candidate-test.mjs`): building a
Candidate from a raw preset, then converting it back via
`candidateToLegacyPreset()`, and running `quickSafetyClamp()` on both
the original raw preset and the round-tripped one, yields identical
numeric values for every field. Field names for HSL channels
(`hsl_h_orange` etc.), Calibration primaries (`cal_red_s` etc.), and
Color Grading zones (`grd_sh_h` etc.) are preserved exactly.
