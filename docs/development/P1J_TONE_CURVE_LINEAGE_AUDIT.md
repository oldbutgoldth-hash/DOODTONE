# P1J — Tone Curve Lineage Audit

## Question

Does `candidate.curves.rgb/red/green/blue` (the point-curve arrays the real
XMP serializer reads for `crs:ToneCurvePV2012[Red/Green/Blue]`) ever reflect
this photo's actual tonal content, or does every AI-analyzed photo silently
export a flat identity curve?

## Method

Traced the full data path from Core analysis engine to XMP export, reading
every function in the chain directly (no assumptions from memory or prior
documentation), the same discipline that found and fixed the identical
defect class in P1F (Basic Panel).

## Findings

1. **`core/tone-curve-ai-engine/index.js::generateToneCurves(img, stats)`**
   is a real, working, already-invoked-on-every-analysis-run engine. It
   builds a histogram-derived master S-curve plus per-channel (R/G/B)
   cast-correction curves, each a 5-point array, with a genuine
   `confidence` score and per-channel `reason` text. This was already
   confirmed running every analysis via `session.evidence.toneCurves`.

2. That evidence was consumed in exactly two places prior to this round:
   - `ui/app.js` line ~2526 assigns it to a local `toneCurves` variable
     used only for confidence-model scaling inside `buildFinalPreset()`.
   - `ui/app.js` lines 2783-2793 feed `toneCurves.{master,red,green,blue}.points`
     into `state.curveEditor.loadPreset(...)` — the **optional, separate,
     manual** Curve Editor UI widget. This never touches the Candidate.

3. **`core/decision-engine/index.js::buildFinalPreset(inputs)`** destructures
   `toneCurves` from its inputs (confirmed at line 146) and uses it only
   for `curveTrust` confidence scaling (line 654). Grepping the entire
   function for `.curves` returns **zero matches** — it never assigns a
   `curves` field on the object it returns.

4. Consequently `session.candidateRaw.curves` was always `undefined`, and
   `core/single-image/candidate/candidate-builder.js`'s own pre-existing
   fallback (`rawPreset.curves ?? null`) always evaluated to `null` in
   every real analysis run — confirmed dead code, not a bug introduced by
   an earlier round, just never wired to a producer.

5. `core/single-image/candidate/legacy-preset-adapter.js` correctly emits
   `curves: null` when `candidate.curves.rgb == null` (the P1C R3
   shell-vs-null fix), so the null propagated cleanly all the way to
   `core/preset-engine/index.js::serializeXMP()`, whose `_curveStr()`
   fell back to `defaultCurveSet()` — a flat identity curve — for every
   photo, regardless of its actual tonal content.

6. `core/single-image/xmp-fidelity/xmp-property-map.js`'s `CURVE_PROPERTIES`
   confirms Tone Curve **is** genuinely export-supported
   (`crs:ToneCurvePV2012[Red/Green/Blue]`, `required: true`) — unlike
   Vignette/Grain (`UNSUPPORTED_CANDIDATE_PATHS`), which is why this EPIC
   targeted Tone Curve rather than Effects.

## Root cause

Identical defect class to P1F: a real, working Core engine computes a
genuine per-photo recommendation every run, but the value never reaches
the canonical Candidate because no wiring step exists between the engine's
evidence and `candidate.curves.*`.

## Fix

`core/single-image/tone-curve-intelligence/tone-curve-plan-builder.js`
reads `session.evidence.toneCurves` (already computed, unmodified) and
produces a `finalValues.{master,red,green,blue}` point-array plan.
`candidate-builder.js` writes it into `candidate.curves.rgb/red/green/blue`
when engaged, leaving the pre-existing dead fallback in place (documented,
not removed) for any future caller that populates `rawPreset.curves`
directly.

## Scope boundary (explicit)

This EPIC wires **point-curve arrays only**
(`candidate.curves.rgb/red/green/blue`). It does **not** touch
`candidate.curves.parametric` (shadows/midtones/highlights scalar
sliders) — no existing engine computes parametric slider values, and `0`
(no override) is a legitimate, safe default distinct from the point-curve
null-fallback bug this EPIC fixes. Confirmed via real integration test
(P1J suite check 36): `candidate.curves.parametric.*` comes exclusively
from `rawPreset.crv_sh/crv_mid/crv_hi`, never touched by the new plan.
