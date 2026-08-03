# P1E — Color Intelligence Architecture

**EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate**
Version 2.5.0. Baseline: EPIC 2E-P1D R2.

## Problem statement

Export works reliably (P1D), Exposure/technical values flow well, but color
recommendations were too conservative: HSL shifts too small, Color Grading
saturation too low, Calibration moves too weak, Vibrance/Saturation too
restrained. The XMP was correct but the "look" wasn't strong enough to feel
like a real auto-tone recommendation.

## Root cause (diagnosed, not re-litigated)

The Core analysis engines (`core/hsl-analyzer-engine`,
`core/colorgrading-ai-engine`, `core/calibration-engine`) already compute
reasoned, bounded, guardrail-aware per-channel/zone/primary recommendations
from real evidence. By the time those recommendations pass through the
Production legacy pipeline (`core/decision-engine/index.js`'s
`buildFinalPreset()`, in particular its `SCENE_STRATEGIES` trust-multiplier
table with `hslTrust`/`gradeTrust`/`calTrust` ranging 0.45–1.00) and the
confidence-scaling pass in `core/xmp-validator/index.js`, several
individually-reasonable dampening layers compound, pushing many color values
toward zero even when the original evidence justified something stronger.

**This EPIC does not touch `core/decision-engine/index.js` or
`core/xmp-validator/index.js`.** Both are explicitly out of scope per the
project brief. Instead, P1E adds one new, pure enrichment layer downstream
of that pipeline, inside the Candidate-generation step that P1C already
owns as the single source of truth for the exported XMP.

## Design principle: "restoration, not invention"

The Core engines already did the hard work. P1E's only question, per
field family, is: *how much of the gap between what evidence originally
recommended and what actually survived into the Candidate should be
restored, bounded and skin-safe?*

- Never overshoots the Core engine's own original recommendation.
- Never flips sign relative to that recommendation (a sign conflict between
  the legacy-dampened Candidate value and the fresh evidence re-derivation
  signals real uncertainty; the conservative choice is to change nothing).
- Never acts on a channel/zone/primary that lacks real coverage in the
  image (no fabricated color for hues that aren't actually present).
- Every push is independently bounded by a Layer A bound (`BOUNDS` in
  `color-intelligence-schema.js`) that sits strictly inside the values
  `quickSafetyClamp()`/`validateFinalPreset()` (Layer B) already enforce
  elsewhere — the two-layer safety net convention this project already
  uses everywhere else.

## Module layout

```
core/single-image/color-intelligence/
  color-intelligence-schema.js     Pure constants: STRENGTH_MODE, BOUNDS,
                                    coverage/confidence thresholds,
                                    skinCautionScale(), buildEmptyColorPlan().
  evidence-color-signals.js        deriveColorSignals(evidence) -- reshapes
                                    session.evidence into a small, defensive
                                    "color signals" object. Pure, read-only,
                                    never throws.
  color-plan-builder.js            buildColorPlan({candidateColorFields,
                                    signals, strengthMode}) -- the
                                    "restoration toward evidence" math.
                                    Pure. Returns a ColorPlan.
  color-intelligence-engine.js     applyColorIntelligence(candidate,
                                    evidence, {strengthMode}) -- the single
                                    entry point. Mutates the Candidate's
                                    color sub-objects in place, returns
                                    diagnostics.
```

Each module answers a different question, matching this project's layered-
architecture convention (see `photographer-style-intelligence` design
pattern used elsewhere in this codebase): schema owns *what is allowed*,
evidence-color-signals owns *what did the image actually show*, color-plan-
builder owns *how much should we restore*, and the engine owns *where does
this plug into the real pipeline*.

## Data flow

```
session.evidence (already computed by the existing P1A/P1B pipeline)
        |
        v
deriveColorSignals(evidence)  ---->  colorSignals (P1E_COLOR_SIGNALS@1)
        |
        v
buildColorPlan({candidateColorFields: candidate's CURRENT (already
                reshaped, already legacy-dampened) hsl/grading/cal/
                basic.vibrance/basic.saturation,
                signals, strengthMode})
        |
        v
ColorPlan (P1E_COLOR_PLAN@1) -- bounded final values + reasons +
                                 skinProtection + fieldsBoosted
        |
        v
applyColorIntelligence() writes the plan onto candidate.hsl/grading
(excl. balance)/cal (excl. shadowTint)/basic.vibrance/basic.saturation,
in place, and returns diagnostics for candidate.diagnostics.colorIntelligence
```

## Where this plugs into the real pipeline

`core/single-image/candidate/candidate-builder.js::buildCandidateFromSession()`
already performs a pure reshape of `session.candidateRaw` (the legacy
`buildFinalPreset()` output) into the nested Candidate shape. P1E adds
exactly one call, `applyColorIntelligence(candidate, evidence, {strengthMode:
DEFAULT_STRENGTH_MODE})`, immediately after that raw reshape completes and
**before** the per-parameter lineage entries and the `autoValues` snapshot
are built. See `P1E_CANDIDATE_INTEGRATION_NOTE.md` for the exact reasoning
behind that ordering and its consequence for "Reset to Auto".

Because the Candidate is P1C's own single source of truth for the exported
XMP, every downstream step — `candidateToLegacyPreset()` →
`quickSafetyClamp()` → `serializeXMP()` → the P1D Fidelity Gate — sees the
enriched values automatically, with zero changes to any of those functions.

## Internal strength strategy (architecture only, no new UI this round)

`STRENGTH_MODE` defines `NATURAL` / `BALANCED` / `CINEMATIC` / `STRONG`,
each a scalar (0.35 / 0.70 / 1.00 / 1.30) applied to the restoration
fraction before the hard bound is applied. `BALANCED` is the new default —
intentionally stronger than a conservative default, still bounded and
skin-safe. No new user-facing control is added in this EPIC; the internal
modes exist for extensibility (a future intensity slider could select one)
and are exercised by tests even though nothing in the UI exposes them yet.

## Skin safety

`skinCautionScale({skinCoveragePct, skinConfidence})` returns a
confidence-and-coverage-weighted extra dampening factor (never a single
hardcoded threshold), applied multiplicatively on top of the already-
tighter skin-channel bounds for the three skin-adjacent HSL channels
(`red`/`orange`/`yellow`, per `SKIN_ADJACENT_HSL_CHANNELS`) and for the
red Calibration primary. No skin evidence at all (module didn't run) is
treated as "moderately cautious by default" (scale 0.5), never as "assume
no skin" — matching this project's "skin protection has structural
priority" convention.

## What P1E deliberately never touches

`candidate.whiteBalance`, `candidate.basic.exposure/contrast/highlights/
shadows/whites/blacks/texture/clarity/dehaze`, `candidate.curves`,
`candidate.grading.balance` (documented UNSUPPORTED field, no Production
field exists), `candidate.cal.shadowTint` (also UNSUPPORTED),
`candidate.detail/effects/optics`, `candidate.profile`. Also never touches:
`core/decision-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `core/color-match/*` (Reference Color
Match), any preview/production-lock file, any Production Safety Lock flag.

## Regression posture

The existing `qa/epic-2e-p1c-candidate-test.mjs` fixture
(`buildCompletedSessionWithCandidateRaw()`) sets only minimal, synthetic
evidence (e.g. `evidence.hsl = {dominant, confidence}`, no `channels` map).
`deriveColorSignals()` treats that shape as "no usable signal" for every
color field family, so `applyColorIntelligence()` is a complete no-op
against it — verified directly (86/86 of that suite still passes with
exact pre-P1E values on `candidate.hsl.hue.orange`, `candidate.grading.
shadows.hue`, `candidate.cal.redPrimarySaturation`). P1E only engages when
real, richly-shaped evidence is present.
