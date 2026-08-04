# EPIC 2E-P1H — White Balance Value Lineage Audit (Part A)

Status: written from direct source reading of the P1G R2 baseline
(copied into `lumixa_p1h`), not from prior documentation. Every claim
below cites the file/line it was read from. Deviation note: the spec's
named source archive `LUCAA6~1.ZIP` was not attached to this session;
the audit instead uses the just-delivered P1G R2 working tree, verified
file-for-file (698/698 non-`node_modules` files) to contain every
prerequisite path the spec asks this audit to check. See
`P1H_KNOWN_LIMITATIONS.md` for the full deviation record.

## 0. The single most important correction to prior assumptions

Earlier EPICs in this project (P1F Basic Tone, P1G Detail) found a
recurring pattern: a real, sophisticated analysis engine existed, but it
was either dead code or its output was discarded before reaching the
Candidate. **White Balance is architecturally different.** Both
`analyzeWhiteBalance()` (`core/whitebalance-engine/index.js`) and
`detectColorCast()` (`core/color-cast-detector/index.js`) are called for
real, on the real uploaded `<img>`, inside the same `runAnalysis()`
function in `ui/app.js` that drives the whole single-image pipeline:

```js
// ui/app.js ~2445-2448
const [skinClassRes, castRes] = (await Promise.allSettled([
  classifySkin(img),
  detectColorCast(img),
])).map(r => r.status === 'fulfilled' ? r.value : null);

// ui/app.js ~2484-2487
const [skinToneRes, wbRes, hslRes, gradingRes, tcRes, calRes, styleRecRes] =
  (await Promise.allSettled([
    analyzeSkinTone(img),
    analyzeWhiteBalance(img, { category: sceneRes.category, skinPct: skinPctAccurate, cast: castRes }),
    ...
  ])).map(r => r.status === 'fulfilled' ? r.value : null);
```

So the "often zero" symptom is **not** an unwired-engine problem. It is
a real evidence value being progressively, multiplicatively dampened as
it travels downstream. That mechanism is documented in Q1 below.

## 1. Why do Temperature and Tint often remain zero?

**Confirmed root cause: three independent multiplicative dampening
factors compound on the way from `wb.consensus` to the Legacy Preset's
`temp`/`tint` fields, and for the majority of common casts the product
of the three factors is small enough that `Math.round()` collapses it
to 0, 1, or 2 — even when the raw upstream reading was a real,
human-visible cast.**

The mapping is `core/lightroom-mapping-engine/index.js`, `_mapWhiteBalance()`:

```js
// lightroom-mapping-engine/index.js ~727-745
function _mapWhiteBalance(wb, fingerprint, portraitSafe, hasSkin, skinHue, wbDampen = 1.0) {
  const rawTemp = wb?.consensus?.temperature ?? 0;
  const rawTint = wb?.consensus?.tint ?? 0;
  const pf = fingerprint?.wbMoodPreservation?.preservationFactor ?? 0.4;
  const intent = wb?.wbIntent;
  const intensityScale = intent ? (WB_INTENSITY_SCALE[intent.intensity] ?? 0.8) : 0.8;
  let temp = Math.round(rawTemp * pf * intensityScale * wbDampen);
  let tint = Math.round(rawTint * pf * intensityScale * wbDampen);
  ...
```

The three factors:

**(a) `pf` — mood-preservation factor**, from
`core/whitebalance-engine/index.js` `_moodPreservation()`:

```js
const defectLikelihood = { green: 0.65, magenta: 0.35, warm: 0.25, cool: 0.40, neutral: 0.20 }[castLabel] ?? 0.35;
const magnitudeBoost = magnitude > 30 ? 0.25 : magnitude > 15 ? 0.10 : 0;
const preservationFactor = clamp(defectLikelihood + magnitudeBoost, 0.15, 0.85);
```

By design (per the project's own stated philosophy — "White Balance
transfers mood-intent, not raw Temp/Tint"), warm casts get `pf` as low
as **0.25** and magenta casts as low as **0.35** unless the raw
magnitude exceeds 15-30. Warm and magenta are the two most common casts
in real photography (golden hour, tungsten interiors, skin-tone film
looks), so this alone means roughly 65-75% of a real warm/magenta
reading is treated as "intentional mood" and never applied as
correction.

**(b) `intensityScale`** — from `wb.wbIntent.intensity`, one of
`{subtle: 0.5, moderate: 0.8, limited: 1.0}`. A `subtle` classification
(low transfer confidence) halves the correction again.

**(c) `wbDampen`** — from `core/decision-engine/index.js`, derived from
a per-scene-strategy base (`wbTrust`, 0.70-1.00) then reduced further by
up to three independent triggers, all of which can fire simultaneously:

```js
// decision-engine/index.js ~649-668
if ((cm.wb ?? 0.5) < 0.40) { wbTrust *= 0.6; }                         // low WB confidence
if (overallConf < 0.40) { wbTrust *= 0.85; ... }                       // low overall confidence
if (wbIntent.transferRisk === 'high') { wbTrust *= 0.55; }             // else 'medium' -> *0.80
...
const wbDampen = Math.max(0.20, Math.min(1.0, wbTrust));
```

**Worked example** (realistic, not a contrived edge case): a warm cast
with `wb.consensus = {temperature: 10, tint: 3}` (a genuinely visible
cast — magnitude ≈ 10.4, below the 15/30 magnitude-boost thresholds),
`intent.intensity = 'moderate'`, best-case `wbDampen = 1.0`:

```
pf = 0.25 (warm, no magnitude boost)
temp = round(10 * 0.25 * 0.8 * 1.0) = round(2.0) = 2
tint = round( 3 * 0.25 * 0.8 * 1.0) = round(0.6) = 1
```

Even in the *best case* (full trust, no confidence penalties), a real
10/3 reading maps to 2/1. Add just one confidence penalty
(`wbDampen ≈ 0.48-0.6`, common for portraits/indoor scenes where WB
confidence legitimately runs lower) and the same reading rounds to 0/0
or 1/0. This reproduces the user-observed "often zero" symptom exactly,
without needing to assume any bug — it is the intended behavior of a
conservative-by-design mood-preservation system, but the compounding of
three independently-conservative factors makes it far more aggressive
in combination than any single factor looks in isolation. **This is the
gap P1H closes**: not by removing the mood-preservation philosophy, but
by adding an evidence layer that distinguishes cases where the "genuine
defect" reading should be trusted more (neutral-reference agreement,
skin-consistency corroboration, multi-estimator agreement) from cases
where mood-preservation is correctly protecting an intentional look.

## 2. Are the White Balance algorithms actually executed?

**Yes.** See §0 above — `analyzeWhiteBalance()` and `detectColorCast()`
are called for real on the real uploaded image in `ui/app.js`'s
`runAnalysis()`. Both are DOM/Canvas-based (`document.createElement('canvas')`)
and use a real multi-estimator ensemble (Gray World, White Patch, Shades
of Gray, Gray Edge, neutral-candidate filtering, skin refinement) —
confirmed by full read of `core/whitebalance-engine/index.js` (575
lines).

## 3 & 4. Does the Candidate Builder lose or discard WB values?

**No loss at the assignment point itself.** `core/single-image/candidate/candidate-builder.js`:

```js
// candidate-builder.js 120-121
candidate.whiteBalance.temperature = rawPreset.temp ?? 0;
candidate.whiteBalance.tint = rawPreset.tint ?? 0;
```

This is a direct, lossless passthrough of `rawPreset.temp`/`.tint`
(the Legacy Preset fields already computed by `_mapWhiteBalance()`).
The value has already been dampened by the time it reaches this line —
the loss happens upstream in Lightroom Mapping (Q1), not here.

## 5. Does P1E's Color Intelligence integration overwrite Candidate WB?

**No.** Grep of every `whiteBalance.` occurrence in
`candidate-builder.js` shows exactly two writes (lines 120-121, quoted
above) and the rest are read-only lineage/diagnostics entries
(`parameterPath: 'whiteBalance.temperature'`, etc., used for
explainability, not assignment). P1E's Color Intelligence block writes
only to `candidate.hsl`/`candidate.grading`/`candidate.cal`/etc. — it
never touches `candidate.whiteBalance`. Ownership separation already
holds at the Candidate level; P1H must preserve this and extend it to
the new WB Plan modules.

## 6. Is confidence gating too strict?

**Partially — the gating is not one gate but three independently
multiplying ones**, all converging on the same `wbDampen` value (Q1c):
a low-WB-confidence penalty (`×0.6` below 0.40), a low-overall-confidence
penalty (`×0.85`), and a WB-transfer-risk penalty (`×0.55`/`×0.80`).
None of the three is unreasonable in isolation, but because they can
co-occur and then further multiply against the separate `pf` and
`intensityScale` factors from Q1, the effective floor on a real
correction is much lower than the nominal `wbDampen` floor of 0.20
would suggest. P1H's job is to add richer evidence (neutral-region
confidence, skin-consistency confidence, multi-estimator agreement) so
that the *replacement* WB Plan can justify trusting a correction more
when that evidence is strong — not to remove the existing conservative
gates, which the project's own philosophy explicitly wants kept.

## 7. Are neutral-reference areas being detected at all?

**Yes, partially.** `core/whitebalance-engine/index.js` already performs
neutral-candidate filtering as part of its Gray-World/White-Patch
ensemble, and exposes a `referenceConfidence` field on `wbIntent`. There
is no dedicated, explainable "neutral-region detector" module with its
own confidence/reason contract — this is one of the modules P1H's Part B
adds (`neutral-region-detector.js`), consuming the existing evidence
rather than re-deriving it from pixels (P1H's new modules are pure/Node
-testable and cannot touch Canvas directly).

## 8. Is object color (e.g. green foliage, red costume) being treated
as illuminant?

**Partially protected already, not fully separated.**
`core/color-cast-detector/index.js` already distinguishes background
cast from subject/center cast (`bgGreenDominant`, `subjectNeutral`), and
`whitebalance-engine`'s `wbIntent.greenBounceRisk` already attenuates
green-cast tint corrections. But there is no general illuminant-vs-
object-color classification producing an explicit `OBJECT_COLOR_BIAS`
class, nor equivalent protection for non-green dominant object colors
(red/pink costumes, blue walls). This is the spec's "central
requirement" and the main new capability Part B must add.

## 9. Is skin evidence being used, and is it trustworthy?

**Used, but not independently validated.** `whitebalance-engine` applies
portrait guardrails and skin-warmth-informed tint floors
(`intent.skinWarmth`), and `_mapWhiteBalance()` uses `hasSkin`/`skinHue`
to floor tint in portrait scenes. There is no explicit rejection of
saturated/costume-lit/clipped skin samples before they inform WB — this
is a gap Part B's `skin-consistency-validator.js` fills, consuming
existing skin evidence (never re-deriving pixel-level skin detection,
and never altering P1E's own skin HSL protection, which lives in a
different module).

## 10. Does the P1D readback pipeline preserve Temperature/Tint
correctly?

**Yes, and it already avoids double-conversion.**
`core/single-image/xmp-fidelity/xmp-property-map.js`:

```js
{ candidatePath: 'whiteBalance.temperature', legacyPresetKey: 'temp', xmpProperty: 'crs:Temperature', compareMode: 'TEMPERATURE_KELVIN', clampGroup: 'wb', required: true },
{ candidatePath: 'whiteBalance.tint',        legacyPresetKey: 'tint', xmpProperty: 'crs:Tint',        compareMode: 'EXACT_INT',           clampGroup: 'wb', required: true },
```

`candidate-xmp-comparator.js` converts both the Export-Expected slider
value and the parsed-back XMP value through the *same injected*
`sliderToKelvin()` function (imported from `whitebalance-engine`, never
duplicated) before comparing Temperature; Tint is compared as an exact
integer in slider units directly, matching how it's written
(`crs:Tint="${p.tint}"`, no conversion). No double-conversion risk
exists.

## 11. Does Lightroom show the expected Kelvin value for a given slider
Temperature?

**Yes, via `sliderToKelvin()`**, the sole canonical conversion (`CCT_MID
= 5500`, `CCT_MAX = 50000`, `CCT_MIN = 2000`, asymmetric around 5500K).
Measured directly against the current source (`node --input-type=module`
against the live `whitebalance-engine/index.js`):

| slider | Kelvin |
|---|---|
| -60 | 3400 |
| -40 | 4100 |
| -12 (HARD_LIMITS.wb.tintGreenFloor, for reference only — this is a *tint* bound, not temp) | 5080 |
| 0 | 5500 |
| 5 | 7725 |
| 12 | 10840 |
| 40 (HARD_LIMITS.wb.tempCap) | 23300 |
| 60 (quickSafetyClamp hard cap = tempCap × 1.5) | 32200 |

`serializeXMP()` writes `crs:Temperature="${sliderToKelvin(p.temp)}"`
and `crs:Tint="${p.tint}"` directly (`core/preset-engine/index.js`
~150-151) — this is the value Lightroom will display.

## 12. Is Candidate Temperature a relative slider value or an absolute
Kelvin value?

**A relative slider value**, on the same `-100..100` range as the UI's
`#temp` slider (`index.html` line 679: `<input type="range" id="temp"
min="-100" max="100" ...>`). Absolute Kelvin only exists transiently, at
XMP-serialization time, via `sliderToKelvin()`. `candidate.whiteBalance.temperature`,
`rawPreset.temp`, and the `#temp` DOM slider's `value` are all the same
unit; `wb.consensus.temperature` (the raw multi-estimator output, before
`_mapWhiteBalance()`'s dampening) is also already in this same slider
unit, not Kelvin — confirmed by `sliderToKelvin(p.temp)` being applied
exactly once, at serialization, never twice.

## Export/safety-limit reference (existing, unmodified by this audit)

`core/xmp-validator/index.js` `HARD_LIMITS.wb` (pre-existing, from an
earlier EPIC, not part of P1H's scope to loosen):

```js
wb: {
  tempCap:         40,
  tintGreenFloor: -12,
  tintMagentaCeil: 30,
  tintGreenFloorIntentional: -25,
},
```

`quickSafetyClamp()` additionally hard-floors/-caps at
`tintGreenFloorIntentional` / `tintMagentaCeil` / `tempCap × 1.5` as an
absolute last-resort net. P1H's new WB Plan's own guardrail ranges (spec
§ "Temperature model" / "Tint model") must stay well inside these
existing limits, exactly as P1G R2's detail clamp did for
sharpening/noise.
