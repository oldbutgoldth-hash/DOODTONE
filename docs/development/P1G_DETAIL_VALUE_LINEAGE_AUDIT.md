# P1G_DETAIL_VALUE_LINEAGE_AUDIT.md

**EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction**
**Audit date:** 2026-08-04
**Baseline:** LUMIXA AI v2.6.0 (EPIC 2E-P1F, fully verified — 77/77 P1F tests, 70/70 static suites)

This is a from-source audit, not a design proposal. Every claim below is
backed by a file path + line reference, verified against the actual
`lumixa_p1g` working copy (an exact `rsync -a` clone of the delivered
P1F project). No claim in this document is asserted from memory or from
an older EPIC's audit.

---

## 1. Scope of this audit

Trace, from real source, the full lifecycle of every Detail Candidate
field: `detail.sharpening`, `detail.noiseReduction`,
`detail.colorNoiseReduction`, `detail.radius`, `detail.detail`,
`detail.masking`, `detail.noiseReductionDetail`,
`detail.colorNoiseReductionDetail`, `detail.colorNoiseReductionSmoothness`.

For each field: evidence source, current engine/source module,
Candidate raw path, canonical Candidate path, slider ID, slider range,
Legacy Preset key, safety clamp behavior, XMP property, P1D readback
support, Lightroom display unit, current export support status, and
whether the value is fixed/dynamic/null/ignored.

---

## 2. Per-field lineage table

| Candidate path | Evidence source (current) | Source module | Legacy Preset key | Slider ID / range | XMP property | Layer A clamp | Layer B clamp (`quickSafetyClamp`) | P1D readback support | Export status | Fixed / Dynamic |
|---|---|---|---|---|---|---|---|---|---|---|
| `detail.sharpening` | **None** — literal constant | `core/lightroom-mapping-engine/index.js:96` (`const sharp = 40;`) | `sharp` | `#sliderSharpening` (Lightroom range 0–150; current UI clamp band narrower — see §5) | `crs:Sharpness` (`core/preset-engine/index.js:146`) | **None** — `clampGroup: null` in `xmp-property-map.js` `BASIC_ENTRIES` | **None** — `core/xmp-validator/index.js` `HARD_LIMITS` has no `detail`/`sharp` group at all | Yes — `EXACT_INT` compare, `required: true` | **Supported, real** — Candidate → Legacy Preset → XMP → readback, full round-trip proven | **Fixed** (always 40, every image) |
| `detail.noiseReduction` | **Binary heuristic** — `isPortrait` flag only, no measured noise | `core/lightroom-mapping-engine/index.js:97` (`const noise = isPortrait ? 20 : 10;`) | `noise` | `#sliderNoiseReduction` | `crs:LuminanceSmoothing` (`core/preset-engine/index.js:147`) | **None** | **None** | Yes — `EXACT_INT`, `required: true` | **Supported, real** | **Fixed-binary** (20 or 10, never anything else) |
| `detail.colorNoiseReduction` | **None** — literal string, never reads Candidate at all | `core/preset-engine/index.js:148` (`crs:ColorNoiseReduction="25"`) | *(not read from `rawPreset` at all in the serializer — `candidate-builder.js:178` sets `candidate.detail.colorNoiseReduction = 25` as a display mirror only)* | `#sliderColorNoiseReduction` (if present in UI — value is cosmetic) | `crs:ColorNoiseReduction` (**hardcoded literal `"25"`**, see `XMP_FIXED_ATTRIBUTES['crs:ColorNoiseReduction'] = '25'` in `xmp-property-map.js`) | N/A | N/A | **No** — `xmp-property-map.js` lists `'detail.colorNoiseReduction'` in `UNSUPPORTED_CANDIDATE_PATHS`; P1D treats it as never-a-mismatch, not a proven parity | **Unsupported (hardcoded serializer literal)** | **Fixed** (always `"25"`, literally never varies) |
| `detail.radius` | none | none | none | none — `createEmptyCandidate()` leaves it `null` | none | N/A | N/A | Listed in `UNSUPPORTED_CANDIDATE_PATHS` and `candidate-schema.js`'s `UNSUPPORTED_FIELD_PATHS` | **Unsupported** | `null` always |
| `detail.detail` | none | none | none | none (`null`) | none | N/A | N/A | Unsupported (both lists) | **Unsupported** | `null` always |
| `detail.masking` | none | none | none | none (`null`) | none | N/A | N/A | Unsupported (both lists) | **Unsupported** | `null` always |
| `detail.noiseReductionDetail` | none | none | none | none (`null`) | none | N/A | N/A | Unsupported (both lists) | **Unsupported** | `null` always |
| `detail.colorNoiseReductionDetail` | none | none | none | none (`null`) | none | N/A | N/A | Unsupported (both lists) | **Unsupported** | `null` always |
| `detail.colorNoiseReductionSmoothness` | none | none | none | none (`null`) | none | N/A | N/A | Unsupported (both lists) | **Unsupported** | `null` always |

Every row above was verified directly against source, not inferred:

- `core/lightroom-mapping-engine/index.js` lines 90–97 (the "── 4. Detail
  ─────" section) — the actual root cause.
- `core/single-image/candidate/candidate-builder.js` lines 176–180 — the
  pure passthrough from `rawPreset.sharp`/`rawPreset.noise` into the
  Candidate, plus the `colorNoiseReduction = 25` literal.
- `core/single-image/candidate/legacy-preset-adapter.js` line 52 — only
  `sharp`/`noise` are read back out of the Candidate into the Legacy
  Preset (proof that Color NR, Radius, Detail, Masking etc. have no
  Legacy Preset roundtrip at all today).
- `core/preset-engine/index.js` lines 146–148 (`serializeXMP`) — proof
  Sharpness/LuminanceSmoothing are Candidate-sourced (`${p.sharp}` /
  `${p.noise}`) and ColorNoiseReduction is a bare literal string
  (`"25"`), never reading `p.` at all.
- `core/single-image/xmp-fidelity/xmp-property-map.js` — `BASIC_ENTRIES`
  (2 real Detail entries, both `clampGroup: null`), `XMP_FIXED_ATTRIBUTES`
  (`crs:ColorNoiseReduction`), `UNSUPPORTED_CANDIDATE_PATHS` (all 7 of the
  "audit but do not fabricate" fields already listed there, pre-dating
  this EPIC — P1D's own audit already found this).
- `core/xmp-validator/index.js` — grepped for `sharp|noise|detail|HARD_LIMITS`:
  confirmed zero entries for any Detail field in any `HARD_LIMITS` group
  (`basic`, `wb`, `hsl`, `presence`, `calibration` are the only groups that
  exist).
- `core/single-image/candidate/candidate-schema.js` lines 43–44 (
  `UNSUPPORTED_FIELD_PATHS`) and lines 93–97 (`createEmptyCandidate()`'s
  `detail:` block) — confirms the 6 always-null fields and the
  `colorNoiseReduction: 25` static default.

---

## 3. Root cause

`core/lightroom-mapping-engine/index.js`, function that assembles the
Legacy flat preset, section literally commented `// ── 4. Detail
─────────────────────────────────────────────────────────────────────`:

```js
const sharp   = 40;
const noise   = isPortrait ? 20 : 10;
```

Both are **unconditional or near-unconditional literals** — Sharpening
is the exact same value 40 for every single image regardless of scene
content, focus, noise, or subject; Noise Reduction is a binary
`isPortrait` switch with no relationship to measured noise, ISO
context, or shadow lift. Neither value ever reads any evidence
(`session.evidence.imageAnalysis.sharpnessScore/noiseScore`,
`session.evidence.skin`, or anything else) — this is the same
"hardcoded literal, not an intelligence layer" defect class P1F found
for Basic Panel and Texture/Clarity/Dehaze, now confirmed for the
entire Detail group.

This flows unmodified into the Candidate via
`candidate-builder.js:176-177`:

```js
candidate.detail.sharpening = rawPreset.sharp ?? 0;
candidate.detail.noiseReduction = rawPreset.noise ?? 0;
```

— a pure reshape, exactly mirroring the pre-P1F state of
`candidate.basic.*`.

---

## 4. Answers to the 10 required audit questions

**1. Why are Detail recommendations weak, fixed, or unsafe today?**
Because they are not recommendations at all — `sharp = 40` is a bare
numeric literal and `noise = isPortrait ? 20 : 10` is a two-value
lookup table, both hardcoded in `lightroom-mapping-engine/index.js`
with zero evidence input. There is no evidence-driven Detail layer in
the current pipeline; P1G is building the first one.

**2. Is the current Sharpening value derived from any real evidence
(sharpness score, edge density, noise)?**
No. It is the literal integer `40` for every image, unconditionally.
`core/image-analysis-core/index.js`'s `sharpnessScore`/`sharpnessLabel`
(already computed and committed to `session.evidence.imageAnalysis` —
see §6) is never read by the mapping engine's Detail section.

**3. Is Noise Reduction derived from any measured noise data, or is it
a fixed guess?**
It is a fixed two-value guess keyed only on `isPortrait` (a scene
classification flag), not on `core/image-analysis-core`'s own
`noiseScore`/`noiseLabel` (0–100, higher = noisier — already computed,
already available in `session.evidence.imageAnalysis`, never consumed
here).

**4. Is Color Noise Reduction genuinely Candidate-driven, or is it a
hardcoded/fake value?**
Genuinely hardcoded. `core/preset-engine/index.js:148` emits
`crs:ColorNoiseReduction="25"` as a bare string literal — it never
reads `p.` (the flat preset object) at all, unlike Sharpness and
Luminance Smoothing on the two lines immediately above it. The Legacy
Preset adapter (`legacy-preset-adapter.js:52`) does not even produce a
`colorNr` field to read from. `candidate.detail.colorNoiseReduction =
25` (`candidate-builder.js:178`) is a display-only mirror of the same
literal, not a value that reaches the serializer through the Candidate
at all. This confirms the spec's expectation exactly: Color NR is
audited-unsupported, not silently working.

**5. Are the currently-unsupported Detail fields (Radius, Detail,
Masking, Noise Reduction Detail, Color NR Detail, Color NR Smoothness)
visible anywhere in the UI in a way that could mislead a user into
thinking they work?**
No live slider bound to a Candidate value was found for any of these 6
fields in `index.html`/`ui/app.js` (grep for `sliderRadius`,
`sliderMasking`, `sliderNoiseReductionDetail`, etc. — no matches). They
are already correctly `null` in `createEmptyCandidate()` and already
listed in `UNSUPPORTED_FIELD_PATHS`/`UNSUPPORTED_CANDIDATE_PATHS`. This
audit's job is to keep this true, not introduce a working-looking
control for any of them.

**6. Does Texture/Clarity (P1F territory) duplicate what Sharpening
should be doing?**
Functionally, yes, there is real overlap risk: P1F's
`basic-tone-plan-builder.js` already computes evidence-driven
Texture/Clarity values (bounded ±20/±18) that increase local
mid-frequency contrast — the same visual territory Sharpening's
high-frequency edge boost operates in. Today there is no coordination
at all between the two because Detail has never been evidence-driven.
P1G must read the **final, already-committed** P1F Basic values (via
`candidate.basic.texture`/`candidate.basic.clarity`, available at
candidate-builder time since P1F runs first — see §7) and reduce
Sharpening pressure when Texture/Clarity are already strongly positive,
per the required
`P1G_P1F_DETAIL_COORDINATION_POLICY.md`.

**7. Does the Preview pipeline simulate Detail (Sharpening/NR)
accurately, or does Preview show something different from the export?**
Out of scope to change (Preview geometry/pixel pipeline is explicitly
forbidden territory for this EPIC), but worth recording: P0.8A's pixel
pipeline audit (`P0.8A` docs) did not implement a Sharpening/NR-specific
convolution in the live Preview canvas — Preview approximates tonal and
color changes, not frequency-domain sharpening or denoising. This is a
pre-existing, documented limitation, not something P1G introduces or
must fix; P1G's `P1G_KNOWN_LIMITATIONS.md` will restate it so it isn't
lost.

**8. Are skin-heavy images (portraits) protected from excessive
sharpening or noise reduction today?**
No real protection exists. The only skin-aware behavior in the entire
current Detail path is the `isPortrait ? 20 : 10` Noise Reduction
switch — which is scene-classification-based, not skin-coverage-based,
and does nothing at all for Sharpening (`40` regardless of portrait
status). `session.evidence.skin.result.coveragePct`/`.confidence`
(`core/skin-classifier/index.js`, merged evidence key `'skin'`) is
already computed and already consumed by P1F/P1E's skin-caution logic,
but never by Detail. P1G's `detail-guardrails.js` must add the first
real skin-aware Sharpening/NR restraint.

**9. Does P1D's Fidelity Gate validate the current Detail values
correctly?**
Yes, for the two fields that are genuinely Candidate-driven
(`detail.sharpening`→`crs:Sharpness`, `detail.noiseReduction`→
`crs:LuminanceSmoothing`) — both are `required: true`, `EXACT_INT`
entries in `BASIC_ENTRIES`, both round-trip through the real serializer
with no known mismatch (no clamp exists to disagree with, since Layer B
has zero Detail entries — see §5). For Color NR and the 6 always-null
fields, P1D correctly treats them as `UNSUPPORTED_CANDIDATE_PATHS` /
`XMP_FIXED_ATTRIBUTES` and never flags them as a fidelity failure — this
is correct behavior given they are genuinely unsupported, not a P1D
defect.

**10. Does Lightroom actually receive the exact value the Candidate
displays for Sharpening and Luminance NR?**
Yes for these two fields specifically — `serializeXMP()` emits
`crs:Sharpness="${p.sharp}"` and `crs:LuminanceSmoothing="${p.noise}"`
directly from the flat preset object that the Legacy Preset adapter
built from `candidate.detail.sharpening`/`.noiseReduction`, with no
intermediate transform. The round-trip is real; the *values themselves*
are simply not evidence-driven yet, which is exactly what Part B fixes.

---

## 5. The two-layer safety net gap (stronger than P1F's finding)

`core/xmp-validator/index.js`'s `HARD_LIMITS` object has groups for
`basic`, `wb`, `hsl`, `presence`, and `calibration` — **there is no
`detail` group and no `sharp`/`noise` entry anywhere in the file.**
Combined with `clampGroup: null` on both real Detail
`xmp-property-map.js` entries, this means **Layer B
(`quickSafetyClamp`) provides literally zero protection for the entire
Detail group** — a strictly stronger version of the P1F finding (which
was that Texture/Clarity/Dehaze specifically had no Layer B; here,
*nothing* in Detail has one, including the two fields that already
export today).

This makes P1G's own `detail-guardrails.js` (Layer A) the **sole**
safety net for Sharpening and Noise Reduction, both before this EPIC
and after it. P1G does not modify `xmp-validator` (out of the stated
scope — "This phase is photographic detail intelligence" — and
consistent with the project's established precedent of not touching
shared validators without a proven compatibility defect); it instead
makes its own local bound tight and always-enforced, exactly like
P1F's `basic-tone-guardrails.js` did for Texture/Clarity/Dehaze.

---

## 6. Available real evidence P1G can legitimately consume

Per the explicit instruction "use only evidence available or safely
derivable from the current pipeline; never infer camera ISO when
metadata does not exist," the following are already computed by the
existing pipeline and already committed to `session.evidence` before
Candidate build time:

- **`session.evidence.imageAnalysis`** (`core/image-analysis-core/index.js`
  → `analyzeImageCore()`, committed under evidence key `imageAnalysis`
  per `single-image-analysis-profile.js:37-38` and
  `ui/app.js:2387-2395`'s `commitEvidence(..., 'imageAnalysisCore', ...)`
  call). Confirmed real fields on its result (JSDoc + return object,
  `core/image-analysis-core/index.js` lines 160-175): `sharpnessScore`
  (0–100), `sharpnessLabel` ('Sharp'|'Acceptable'|'Soft'|'Blurry'),
  `blurDetected` (boolean), `blurConfidence` (0–1), `noiseScore` (0–100,
  higher=noisier), `noiseLabel` ('Clean'|'Light'|'Moderate'|'Heavy'),
  `jpegArtifactScore` (0–100), `jpegArtifactLabel`
  ('None'|'Mild'|'Moderate'|'Severe'). This is a genuine, real,
  already-computed evidence source for focus/blur confidence,
  measured-noise level, and compression-artifact risk — exactly the
  signals the spec's evidence schema calls for
  (`luminanceNoise`, `focusConfidence`, `motionBlurRisk` (via
  `blurDetected`/`blurConfidence`), `compressionArtifactRisk`).
- **`session.evidence.skin`** (`core/skin-classifier/index.js` +
  `core/skintone-engine/index.js`, merged) — `coveragePct` (0-100),
  `confidence` (0-1), `detected` (bool), `isFaceCandidate` (bool),
  `clusterRatio` (0-1). Already the P1F/P1E convention for
  `skinCoverage`.
- **`session.evidence.stats`** (histogram-engine) — `avgSatPct`,
  `contrastRatio`, `drStops`, `blackPoint`/`whitePoint`, etc.; used here
  only for `shadowLiftRisk`/`lowLightConfidence` cross-reference against
  P1F's own `sceneClass`/protections (never re-deriving P1F's own
  classification — read `candidate.diagnostics.basicToneIntelligence`
  instead, since P1F has already run by the time P1G's plan is built).
- **`candidate.basic.*`** (final, already-clamped P1F output) and
  `candidate.diagnostics.basicToneIntelligence` (P1F's own
  `sceneClass`/`protections`/`fieldsAdjusted`) — read-only, for
  P1F/P1G coordination (§7), never re-computed.
- **No** dedicated edge-density, chroma-noise-region, or motion-blur
  primitive exists as a *named* field distinct from the above; P1G's
  `edge-detail-classifier.js` and `noise-profile-estimator.js` derive
  `edgeDensity`/`fineDetailDensity`/`chromaNoise` proxies from the
  `sharpnessScore`/`noiseScore`/`jpegArtifactScore` combination already
  available, documented explicitly as *derived proxies*, not raw
  per-pixel measurements — consistent with "safely derivable from the
  current pipeline," not a new pixel-analysis engine (which would be
  out of this EPIC's minimal-UI/minimal-new-analysis scope; reusing
  `image-analysis-core`'s existing single-pass Worker-backed analysis
  is the reuse-first-over-new-engine convention this project always
  follows).
- **No ISO/camera metadata exists anywhere in this pipeline** (no EXIF
  reader was found in `core/`) — confirmed by grep; P1G never infers or
  fabricates ISO, consistent with the explicit constraint.

---

## 7. Composition order confirmed from source

`candidate-builder.js` (lines 90-270+) proves the following real,
already-existing composition order:

```
rawPreset reshape (incl. old candidate.detail passthrough, line 176-178)
  -> basicTonePlan = buildBasicTonePlan(evidence, ...)   [P1F, line 228]
     candidate.basic.* = basicTonePlan.finalValues        [line 229-237]
  -> colorIntelligenceResult = applyColorIntelligence(candidate, evidence, ...)  [P1E, line 263]
     candidate.hsl/grading/cal/basic.vibrance/saturation enriched
  -> (candidate.detail.* still holds the raw hardcoded passthrough at this point)
```

P1G's integration point is **after** the P1E Color Intelligence call
(so P1G can read the final `candidate.basic.*` and
`candidate.diagnostics.colorIntelligence`/`basicToneIntelligence` for
coordination) and **before** the lineage/`autoValues` snapshot and
`validateCandidate()` call further down — exactly mirroring where P1F
and P1E each insert their own plan. This gives the required order:
`Evidence -> P1F Basic Tone Plan -> P1E Color Plan -> P1G Detail Plan ->
canonical Candidate validation -> UI -> XMP`.

`candidate.diagnostics.detailIntelligence` (additive-only, mirroring
`basicToneIntelligence`/`colorIntelligence`) will hold P1G's plan
summary; `autoValues`/`resetAllToAuto()` in `candidate-store.js:236`
already spreads `candidate.detail` wholesale
(`s.candidate.detail = { ...av.detail };`), so Reset-to-Auto will
transparently pick up P1G's new values with zero further changes to
that mechanism — the same free ride P1F and P1E got.

---

## 8. Forbidden-scope confirmation (Reference Color Match)

`core/color-match/lightroom-candidate-mapper.js:267-268` and
`core/color-match/reference-xmp-generator.js:54` both already set
`sharp: 0, noise: 0` explicitly, with an existing comment
"Reference Color Match does not analyse sharpening/noise — left
neutral." This confirms RCM's own Detail values are already correctly
inert and require zero changes from P1G, consistent with the "Do not
modify Reference Color Match" constraint.

---

## 9. Summary of what Part B must build

1. A real evidence extractor consuming `session.evidence.imageAnalysis`
   + `session.evidence.skin` (never inventing new pixel analysis).
2. A non-exclusive Detail scene classifier (CLEAN_HIGH_DETAIL,
   CLEAN_PORTRAIT, LOW_LIGHT_PORTRAIT, HIGH_NOISE, COLOR_NOISE,
   SOFT_FOCUS, MOTION_BLUR_RISK, FINE_TEXTURE, LOW_DETAIL,
   LOW_CONFIDENCE) from that evidence.
3. A Sharpening planner and Noise Reduction planner replacing the
   `sharp = 40` / `noise = isPortrait ? 20 : 10` literals with bounded,
   evidence-driven, scene-aware values.
4. Guardrails (Layer A) as the sole safety net for the whole Detail
   group (§5).
5. Explicit, honest documentation that Color Noise Reduction and the 6
   already-unsupported fields remain unsupported — never a working-
   looking Candidate value for any of them beyond what already exists.
6. Coordination logic reading P1F's final `candidate.basic.texture`/
   `.clarity` (never recomputing P1F's own plan) and P1E's diagnostics,
   per §6/§7 above.
