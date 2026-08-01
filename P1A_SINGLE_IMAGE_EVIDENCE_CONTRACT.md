# EPIC 2E-P1A — Single Image Evidence Contract

## Evidence entry shape (`evidence-normalizer.js`)

Every module's result is wrapped in this stable outer shape before it
is stored in `session.evidence[evidenceKey]`. P1A validates only this
outer contract — it never re-checks, alters, or invents a Core module's
own numeric output.

```js
{
  status: 'COMPLETED' | 'SOFT_FAILED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED' | 'SKIPPED',
  result: <the real Core module's return value, or null on failure>,
  confidence: <number 0-1, or 0 if result is null>,
  diagnostics: {},
  warnings: [],
  errors: [],
  sourceModule: '<moduleId>',
  startedAt: <ms epoch>,
  completedAt: <ms epoch>,
}
```

An optional module that fails produces `{status: 'SOFT_FAILED', result:
null, confidence: 0, warnings: [...]}` — never a thrown exception,
never a fabricated placeholder value.

## `EVIDENCE_KEYS` (21 keys, `single-image-session.js`)

`stats`, `imageAnalysis`, `palette`, `harmony`, `skin`, `colorCast`,
`scene`, `wb`, `hsl`, `grading`, `toneCurves`, `calibration`,
`styleRecognition`, `basic`, `styleFeatureGraph`, `styleFingerprint`,
`validationReport`, `benchmark`, `decisionReport`, `referenceTransfer`,
`processingLog`.

These names deliberately reuse the real `ui/app.js` `state.last*`
field-name suffixes (lower-camel, `last` prefix dropped) instead of the
P1A spec's illustrative names (`histogram`, `whiteBalance`,
`toneZones`), per this project's established "reuse real names"
convention (see the lumixa-ai-development skill and
`P1A_SOURCE_LINEAGE_AUDIT.md`). `colorCast` and `scene` have no legacy
`state.last*` mirror today (they are local variables inside
`runAnalysis()`) — `LEGACY_MAP` maps both to `null`, meaning the
Session still stores their evidence, but the legacy adapter has nothing
to sync it to.

## `SINGLE_IMAGE_FULL` analysis profile (`PROFILE_VERSION =
'SINGLE_IMAGE_FULL@1'`, 23 module descriptors)

Each descriptor: `{moduleId, evidenceKey, required, dependencies,
executionMode, groupId, timeoutMs, fallbackPolicy, sourceEngine,
sourceFunction}`. `sourceEngine`/`sourceFunction` point at the real,
unmodified Core module and export used today — no invented modules.

| moduleId | evidenceKey | required | executionMode | source |
|---|---|---|---|---|
| histogram | stats | yes | SEQUENTIAL | histogram-engine.analyzeImage |
| imageAnalysisCore | imageAnalysis | no | FIRE_AND_FORGET | image-analysis-core.analyzeImageCore |
| palette | palette | no | FIRE_AND_FORGET | kmeans-engine.extractPalette |
| harmony | harmony | no | FIRE_AND_FORGET | color-harmony-engine.generateHarmonies |
| skinClassify | skin | no | PARALLEL_GROUP | skin-classifier.classifySkin |
| colorCast | colorCast | no | PARALLEL_GROUP | color-cast-detector.detectColorCast |
| scene | scene | no | SEQUENTIAL | scene-classifier.classifyScene |
| skinTone | skin | no | PARALLEL_GROUP | skintone-engine.analyzeSkinTone |
| whiteBalance | wb | no | PARALLEL_GROUP | whitebalance-engine.analyzeWhiteBalance |
| hsl | hsl | no | PARALLEL_GROUP | hsl-analyzer-engine.analyzeHSL |
| colorGrading | grading | no | PARALLEL_GROUP | colorgrading-ai-engine.analyzeColorGrading |
| toneCurves | toneCurves | no | PARALLEL_GROUP | tone-curve-ai-engine.generateToneCurves |
| calibration | calibration | no | PARALLEL_GROUP | calibration-engine.analyzeCalibration |
| styleRecognition | styleRecognition | no | PARALLEL_GROUP | style-recognition-engine.recognizeStyle |
| basicPanel | basic | **yes** | SEQUENTIAL | basic-panel-engine.generateBasicPanel |
| styleFeatureGraph | styleFeatureGraph | no | SEQUENTIAL | feature-fusion-engine.buildStyleFeatureGraph |
| styleFingerprint | styleFingerprint | no | SEQUENTIAL | style-fingerprint.buildStyleFingerprint |
| decisionCandidate | candidate | **yes** | SEQUENTIAL | decision-engine.buildFinalPreset |
| validation | validationReport | **yes** | SEQUENTIAL | xmp-validator.validateFinalPreset |
| benchmark | benchmark | no | SEQUENTIAL | style-benchmark-engine.benchmarkStylePreservation |
| decisionReport | decisionReport | no | SEQUENTIAL | decision-report-engine.buildDecisionReport |
| referenceTransfer | referenceTransfer | no | SEQUENTIAL | reference-transfer-engine.buildReferenceTransferReport |
| processingLog | processingLog | no | SEQUENTIAL | processingLog.snapshot() |

`skinClassify` and `skinTone` intentionally share the `skin` evidence
key — they are merged into one `state.lastSkin` object in the real
`runAnalysis()` (`ui/app.js:2284`), so P1A's contract mirrors that merge
rather than inventing two separate evidence slots. `required: true`
matches the exact three fields whose absence already caused
`runAnalysis()` to `return` early in the pre-P1A code (`stats`/`basic`
being falsy skips the rest of the function; `validateFinalPreset`
failing is fatal to the whole XMP path) — no new failure behavior was
introduced.

## `computeImageFingerprint` (image identity)

Deterministic, async. Inputs: `filename`, `size`, `MIME type`,
`lastModified`, decoded `width`/`height`, plus a bounded content
sample (first + middle + last N bytes of the file, hashed with FNV-1a —
a fast non-cryptographic hash, chosen deliberately over SHA-256 because
this is a dedup key, not a security/integrity mechanism). Filename
alone is never used as the fingerprint.

## Cache key inputs (`single-image-analysis-cache.js`)

`computeCacheKey({fingerprint, profileVersion, engineVersion,
proxySize})`. Explicitly excludes: UI tab selection, report section,
XMP generation/download status, slider visibility — none of these
affect what the Core engines would compute, so none of them should
cause a cache miss.
