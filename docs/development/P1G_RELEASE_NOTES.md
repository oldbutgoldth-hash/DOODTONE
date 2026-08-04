# P1G Release Notes

## LUMIXA AI v2.7.0 — EPIC 2E-P1G: Detail Intelligence, Sharpening and Noise Reduction

### What changed

Detail-panel recommendations (Sharpening, Luminance Noise Reduction)
are now computed from real, per-image evidence instead of the two
fixed literals this project's audit traced to
`core/lightroom-mapping-engine/index.js` (`sharp = 40`, `noise =
isPortrait ? 20 : 10`). A new evidence-driven Detail Intelligence layer
(`core/single-image/detail-intelligence/`, 9 modules) classifies each
image's Detail-relevant scene characteristics and produces bounded,
explainable Sharpening + Luminance Noise Reduction recommendations,
integrated into the existing Candidate pipeline at the correct
composition point (after P1F's Basic Tone Plan and P1E's Color
Intelligence, before validation).

### New capabilities

- **Evidence-driven Sharpening**: bucketed by scene (clean/detailed
  vs. noisy/soft/motion-blurred), scaled by strength mode, restrained
  for skin-heavy portraits, never used to "repair" blur.
- **Evidence-driven Luminance Noise Reduction**: bucketed by measured
  noise, boosted when P1F's own shadow-lift risk signal indicates
  amplified shadow noise, protected against oversmoothing on skin.
- **Three strength modes** (`NATURAL` / `BALANCED` / `CRISP`), all
  export-safe across every evidence fixture tested.
- **Advanced Diagnostics — Detail Intelligence** UI section (bilingual
  EN/TH): scene flags, confidence, per-field values with rationale,
  bounded evidence scalars, skin-coverage note, focus-limited note,
  Color Noise Reduction unsupported note.
- **Honest documentation of a real, permanent limitation**: Color
  Noise Reduction has no proven export path in this codebase (the
  serializer hardcodes `crs:ColorNoiseReduction="25"`) — this EPIC
  computes a diagnostic-only recommendation for that field and clearly
  labels it unsupported rather than pretending it works.

### What did NOT change

Reference Color Match, the Preview/pixel pipeline, P1D's XMP Fidelity
Gate mechanics, P1E's Color Intelligence, P1F's Basic Tone
Intelligence, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, and all Production-locked files (182
locked files, byte-identical hashes reproduced on regeneration).

### Test coverage

`qa/epic-2e-p1g-detail-intelligence-test.mjs` — 67/67 PASS (60
required numbered test cases across 7 groups — AUDIT AND OWNERSHIP
1-7, EVIDENCE 8-14, SHARPENING 15-22, NOISE REDUCTION 23-30, MODES
31-34, SESSION AND EDITING 35-43, PARITY 44-49, REGRESSION 50-60 —
plus 7 mutation tests M1-M7).

### Known limitations

See `P1G_KNOWN_LIMITATIONS.md` — most notably, Detail fields have no
Layer-B (`quickSafetyClamp`) hard-limit entry (pre-existing gap, not
introduced by this EPIC; P1G's own Layer-A guardrails are the fix
already shipped for it), and Color Noise Reduction remains
Candidate-independent.

---

## LUMIXA AI v2.7.1 — EPIC 2E-P1G R2: Detail Export Safety Clamp

### What changed

A real, verified export-safety defect in the P1G R1 delivery is
closed: `core/xmp-validator/index.js`'s `quickSafetyClamp()` (Layer B,
the export-time safety net every other panel already has) had zero
rules for Sharpening/Luminance Noise Reduction. This round adds
`HARD_LIMITS.detail = { sharpening: {min:0,max:40}, noiseReduction:
{min:0,max:40} }` and a new `_clampDetailPanel()`, wired into
`quickSafetyClamp()` at the same position every other panel's clamp
already runs. See `P1G_R2_DETAIL_EXPORT_SAFETY_CLAMP.md` for the full
writeup.

### What did NOT change

P1G evidence extraction, scene classification, the Sharpening/Noise
Reduction planners, P1F's Basic-tone formulas, P1E's color formulas,
the Candidate Store, every serializer property name, P1D's comparison
policy, Reference Color Match, the Preview pipeline, and every
Production-write safety flag. No export support was added for Color
Noise Reduction this round.

### Test coverage

`qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs` — 35/35 PASS
(32 required numbered cases). `qa/epic-2e-p1g-detail-intelligence-test.mjs`
(P1G R1) — 68/68 PASS, with mutation test M4 updated and M4b added to
prove the new protection directly.

### Known limitations (updated)

See `P1G_KNOWN_LIMITATIONS.md` — the "no Layer-B hard limit" limitation
is now closed. Color Noise Reduction remains Candidate-independent
(unchanged, out of scope this round).
