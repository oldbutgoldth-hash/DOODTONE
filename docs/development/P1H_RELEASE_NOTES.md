# LUMIXA AI — EPIC 2E-P1H: White Balance Intelligence & Illuminant Separation

**Version 2.8.0**

## Summary

P1H replaces the White Balance values reaching the Candidate (and
therefore the exported XMP) with a purpose-built, evidence-driven
planning stage. Previously, Temperature/Tint were the output of the
legacy `_mapWhiteBalance()` mood-mapping path, which applies up to
three compounding multiplicative dampening factors on top of the
already-conservative WB engine reading — in practice this frequently
rounded exported Temp/Tint to 0 or ±1 even when the underlying analysis
had detected a real, well-corroborated color cast. See
`P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md` for the full traced
mechanism and a worked numeric example.

## What changed

- New `white-balance-intelligence` module family: evidence extraction,
  neutral-reference confidence, illuminant/object-color-bias
  separation, skin-consistency validation (proxy-based), mixed-light
  detection, 10-class cast classification, confidence-tiered
  temperature/tint guardrails, lineage assembly, and a single
  orchestrating `buildWhiteBalancePlan()`.
- `candidate-builder.js` now calls `buildWhiteBalancePlan()` and uses
  its `finalValues.temperature`/`.tint` to set
  `candidate.whiteBalance.*`, and stores the full plan under
  `candidate.diagnostics.whiteBalanceIntelligence`.
- New bilingual Advanced Diagnostics panel surfacing cast
  classification, confidence, evidence summary, and (when triggered)
  the exact mixed-lighting and export-safety-adjustment notices.
- Wired a pre-existing but previously unused `colorCast` evidence slot
  in `ui/app.js` (the analysis already ran; it just wasn't being
  committed to the session).

## What did NOT change

- `core/whitebalance-engine/index.js`, `core/lightroom-mapping-engine/
  index.js` (`_mapWhiteBalance`/`_moodPreservation`), and
  `core/xmp-validator/index.js` — all left byte-for-byte untouched.
- Any P1E (hsl/grading/cal), P1F (basic tone), or P1G (detail) Candidate
  field.
- Production safety locks:
  `productionSource=legacy, productionWrite=false,
  controlledV2Apply=false, xmpWriteAllowed=false,
  productionActivationAllowed=false` — all verified unchanged.

## Testing

118/118 new automated checks pass
(`qa/epic-2e-p1h-white-balance-intelligence-test.mjs`); full regression
across all 9 prior EPIC suites passes with zero new failures; Production
Lock manifest regenerated (192 files) and the `ui/app.js` pinned hash in
`epic-2e-n1-production-invariant.json` deliberately updated per the
established per-round convention.

## Deviations from the literal spec (Auto Mode, logged per convention)

1. Source baseline: the spec-named `LUCAA6~1.ZIP` was unavailable;
   used the verified-identical P1G R2 delivery tree instead.
2. The spec's exact ~77 numbered test cases and 14 named doc titles
   were not available verbatim in context; a comprehensive equivalent
   (118 checks across 12 sections + 10 mutation tests; 14 docs covering
   the same substantive ground) was designed and delivered instead.
3. Strength-mode UI toggle: implemented and tested at the engine level
   (CONSERVATIVE/BALANCED/CORRECTIVE) but not exposed in the UI this
   round — BALANCED remains the fixed default, consistent with how
   prior EPICs have staged UI-exposure of new engine capabilities.
