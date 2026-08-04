# P1G Noise Evidence Model

## Real evidence this EPIC legitimately consumes

Per `P1G_DETAIL_VALUE_LINEAGE_AUDIT.md`'s "available real evidence"
section, `detail-evidence-extractor.js::extractDetailEvidence()` reads
only fields that genuinely exist on `session.evidence`:

- `imageAnalysis.noiseScore` (0-100, from `core/image-analysis-core`) — the only real per-image noise measurement in this codebase.
- `imageAnalysis.sharpnessScore` / `.sharpnessLabel` / `.blurDetected` / `.blurConfidence`.
- `imageAnalysis.jpegArtifactScore`.
- `stats.avgSatPct` (histogram-engine) — used only to discount the chroma-noise proxy.
- `skin.coveragePct` (skin-classifier/skintone-engine, merged).
- `candidate.diagnostics.basicToneIntelligence` (P1F, read-only) — supplies a shadow-lift-risk signal already computed for Basic Tone.

There is **no ISO/EXIF metadata anywhere in this codebase** — confirmed
by the audit's source grep. Noise evidence is image-content-derived
only, never camera-metadata-derived.

## Derived scalars (all bounded 0-1)

```js
luminanceNoise = clamp01(imageAnalysis.noiseScore / 100)
focusConfidence = f(sharpnessScore, sharpnessLabel)
blurConfidence = clamp01(imageAnalysis.blurConfidence ?? 0)
motionBlurRisk = blurDetected ? max(blurConfidence, 0.5) : blurConfidence * 0.4
compressionArtifactRisk = clamp01((jpegArtifactScore ?? 0) / 100)
chromaNoise = clamp01(luminanceNoise * (1 - clamp01(avgSatPct / 140)))
edgeDensity = clamp01((sharpnessScore / 100) * (1 - 0.6 * motionBlurRisk))
fineDetailDensity = clamp01(edgeDensity * (sharpnessLabel === 'Sharp' ? 1.0 : 0.7))
```

## Honesty about proxies

`chromaNoise` and `edgeDensity`/`fineDetailDensity` are explicitly
documented in their own module docblocks as **proxies**, not real
per-channel or per-frequency pixel measurements — no such engine
exists in this codebase (confirmed by the audit). `chromaNoise` is
`luminanceNoise` discounted by saturation (low-saturation + noisy →
more likely chroma-heavy noise, a reasonable but approximate
heuristic); `edgeDensity`/`fineDetailDensity` are derived from
`sharpnessScore`, discounted by measured blur. This EPIC never
fabricates a distinction the evidence can't support, per the spec's
explicit instruction.

## Confidence gate

`buildDetailPlan()` refuses to trust `imageAnalysis` evidence at all
below `MIN_EVIDENCE_CONFIDENCE = 0.4` (mirrors P1F's own
`MIN_EVIDENCE_CONFIDENCE` convention) — below that, the entire Detail
Plan falls back to `buildEmptyDetailPlan()`: both fields at 0, scene
class `['LOW_CONFIDENCE']`, and an explicit diagnostic reason ("no
usable Image Analysis Core evidence — Detail Plan left at neutral
defaults"). This is never a silent/undiagnosed empty plan (test 14,
mutation test M1).
