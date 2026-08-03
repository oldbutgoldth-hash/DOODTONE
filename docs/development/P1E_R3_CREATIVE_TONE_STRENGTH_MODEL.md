# EPIC 2E-P1E R3 — Creative Tone Strength Model

## Objective B summary

Formalizes the `technicalCorrection` vs `creativeTone` split requested
this round, WITHOUT duplicating or replacing any restoration formula
already owned by `color-plan-builder.js`. New file:
`core/single-image/color-intelligence/creative-tone-strategy.js`.

```
finalValue = compose(baselineCoreValue, technicalCorrection, creativeTone, safetyLimits)
```

maps onto the EXISTING, unchanged compose expression inside
`color-plan-builder.js`:

```
fraction = strengthScalar × technicalMultiplier × creativeMultiplier × skinCaution
newValue = _clamp( _restoreTowardEvidence(current, evidenceTarget, fraction, hardBound) )
```

`technicalMultiplier` and `creativeMultiplier` are BOTH represented by
the single `getFamilyMultiplier(sceneClass, family)` return value per
field family this round (documented as `plan.layers.technicalCorrection`
/ `plan.layers.creativeTone` for explainability — see below); there is
no separate, parallel computation path.

## Strength modes (STRENGTH_SCALARS, unchanged from R1/R2)

| Mode | Scalar | Role |
|---|---|---|
| NATURAL | 0.35 | intentionally close to pre-P1E conservative behavior |
| BALANCED | 0.70 | **default this round** — new, intentionally stronger than R1's original default, still bounded and skin-safe |
| CINEMATIC | 1.00 | architectural extensibility, not exposed in UI |
| STRONG | 1.30 | architectural extensibility, not exposed in UI |

No public UI control for strength mode exists this round, per the
instruction "No complicated public UI is required in this round" —
`DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED` is applied
unconditionally by `candidate-builder.js`.

## Scene classes (SCENE_CLASS, new this round)

`classifyScene({ signals, candidateColorFields })` returns exactly one
scene class, evidence-driven, with skin protection checked FIRST (so a
skin-heavy portrait can never be reclassified as e.g. "already
saturated" just because its background happens to match a different
pattern):

| Scene class | Trigger (from real evidence only) |
|---|---|
| `PORTRAIT_SKIN` | `signals.skin.coveragePct >= 15%` |
| `GREEN_OUTDOOR` | scene confidence ≥ 0.40 AND category matches `/outdoor\|landscape\|nature\|forest\|park\|garden\|foliage\|mountain\|hike\|countryside/` |
| `COLORFUL_COSTUME` | scene confidence ≥ 0.40 AND category matches `/travel\|costume\|festival\|market\|culture\|parade\|carnival\|street/` |
| `ALREADY_SATURATED` | sum of `\|candidate.hsl.saturation[ch]\|` across all 8 channels ≥ 40 |
| `LOW_SATURATION` | same sum ≤ 8 (and not already-saturated) |
| `GENERIC` | none of the above met their threshold — neutral 1.0 multipliers |

## Bounded per-family multiplier table (FAMILY_MULTIPLIERS, exact values)

Every value is in `[0.5, 1.3]` — proven by test 31 of
`qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` across every
scene-class × family combination, and structurally guaranteed to never
push a value outside `BOUNDS` regardless (the multiplier only changes
how much of the already-bounded restoration gap is spent, never the
ceiling itself).

| Scene class | hslNonSkin | presenceVibrance | presenceSaturation | grading | calibration |
|---|---|---|---|---|---|
| PORTRAIT_SKIN | 1.05 | 1.15 | 0.75 | 0.85 | 0.85 |
| GREEN_OUTDOOR | 1.15 | 1.05 | 1.00 | 1.05 | 1.00 |
| COLORFUL_COSTUME | 1.20 | 1.10 | 1.05 | 1.10 | 1.05 |
| ALREADY_SATURATED | 0.70 | 0.70 | 0.60 | 0.85 | 0.90 |
| LOW_SATURATION | 1.00 | 1.25 | 0.90 | 1.00 | 1.00 |
| GENERIC | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

`hslNonSkin` never applies to skin-adjacent channels
(red/orange/yellow) — those keep their own, separate, always-active
`skinCautionScale()` regardless of scene class, unconditionally.

## technicalCorrection / creativeTone explainability record

`color-plan-builder.js` (R3) now records, per build, on
`plan.layers` (propagated onto `candidate.diagnostics.colorIntelligence.layers`
as of the R3 fix documented in `P1E_R3_RELEASE_NOTES.md`):

```js
plan.layers = {
  technicalCorrection: { sceneClass, appliesRestraint: sceneClass === 'ALREADY_SATURATED', skinCautionScale },
  creativeTone: { strengthMode, strengthScalar, sceneClass, sceneMultipliers },
};
```

This is recorded for explainability only — the actual math is the
same fraction composition described above; `technicalCorrection`
signals (ALREADY_SATURATED restraint, skin caution) only ever scale a
multiplier DOWN from 1.0, and `creativeTone` signals (every other
scene class) scale it UP, bounded to +30% max.

## Per-field-family fraction formulas (as implemented)

- HSL non-skin: `fraction = scalar × sceneMult.hslNonSkin`
- HSL skin: `fraction = scalar × skinScale` (no scene multiplier — full-time skin protection)
- Color Grading: `fraction = scalar × sceneMult.grading`
- Calibration: `fraction = scalar × 0.8 × extraCaution × sceneMult.calibration` (extraCaution = skinScale only for the red primary)
- Presence (Vibrance/Saturation): target itself scaled by `sceneMult.presenceVibrance` / `sceneMult.presenceSaturation`; the restoration fraction toward that target is `scalar × skinScale`
