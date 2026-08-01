# EPIC 2E-P1B — Confidence Model

Implemented in `core/single-image/report/confidence-aggregator.js`. This
is the single, documented method every confidence value in the report
goes through — no section computes confidence its own separate way.

## 1. Score and level

Every confidence value in the report is `{score, level}`:
- `score`: `null`, or a number in `[0, 100]`.
- `level`: one of `HIGH` / `MEDIUM` / `LOW` / `UNAVAILABLE`.

Thresholds (`CONFIDENCE_THRESHOLDS`, the single place they're defined):

| score | level |
|---|---|
| `null` (not measured) | `UNAVAILABLE` |
| `>= 75` | `HIGH` |
| `>= 50` | `MEDIUM` |
| `>= 0` (including a genuine `0`) | `LOW` |

A genuine `0` is a real, meaningful confidence measurement (the module
ran and found essentially no support) and is deliberately kept distinct
from `null`/`UNAVAILABLE` (the module never ran, or its evidence is
missing) — `isGenuineZero()` exists so callers can tell the two apart.
Neither case is ever silently promoted to a higher level.

## 2. Normalization (`normalizeConfidenceValue`)

Core modules in this codebase return confidence as either a `0-1` float
(most engines) or occasionally already `0-100`. `normalizeConfidenceValue`
detects which by range (`raw <= 1` -> multiply by 100) and never applies
a double scale-up — audited against the actual Core module outputs
before implementation, not assumed.

## 3. Conservative combination (`combineConservative`)

Used whenever a report value depends on more than one evidence source
(for example `report.summary.overallConfidence`, which combines the
exposure/dynamicRange/whiteBalance/tone/color/scene section
confidences).

```
scores = normalize(each raw value), dropping nulls (not zero-filling)
if scores is empty -> {score: null, level: 'UNAVAILABLE'}
mean = average(scores)
disagreementPenalty = min(20, stddev(scores))
combined = min(mean - disagreementPenalty, min(scores) + 15)
result = levelFromScore(max(0, combined))
```

Two deliberate safety properties, both directly required by the spec:

- **Disagreement reduces confidence.** The `stddev`-based penalty means
  sources that disagree pull the combined score down, never up.
- **Weak sources cannot average into false confidence.** The
  `min(scores) + 15` cap means even if every *other* source is high
  confidence, the combined result can never exceed the single weakest
  source by more than 15 points. Multiple 40-confidence sources cannot
  combine into an 80.

This is intentionally simple and fully inspectable — no ML fusion, no
opaque weighting. The header comment in the source file is this same
documentation, kept in sync as the single source of truth per the
spec's "document the method" requirement.

## 4. Missing/failed evidence is always UNAVAILABLE, never inferred

- A missing evidence entry, or one whose Core module status is
  `SOFT_FAILED`/`FAILED`/`TIMED_OUT`/`ABORTED`, is dropped from the
  `combineConservative` input list rather than counted as `0` — a
  missing measurement and a genuine zero-confidence measurement are not
  the same thing (see §1).
- If ALL inputs to a combination are missing, the result is `{score:
  null, level: UNAVAILABLE}` — never a fabricated midpoint value.

## 5. Section-specific confidence adjustments

Beyond the generic aggregator, three sections apply the spec's specific
safety rules using domain evidence *before* calling the aggregator (the
aggregator itself stays generic; these are callers passing it the right
inputs):

- **White balance**: when `colorCast.bgGreenDominant &&
  colorCast.subjectNeutral` (background color, not an illuminant cast),
  `classifyWhiteBalance` caps the illuminant-confidence input at `0.5`
  before it reaches the aggregator, and emits the
  `whiteBalance.backgroundColorNotCast` observation instead of a cast
  claim. When neutral-point evidence is weak (below the module's own
  0.4 threshold), the `whiteBalance.lowNeutralConfidence` warning is
  emitted with the spec's exact required phrasing (see
  `P1B_PHOTOGRAPHER_LANGUAGE_GUIDE.md`).
- **Tone/exposure**: clipped-highlight/shadow percentages feed directly
  into the classification branch chosen (see
  `P1B_EVIDENCE_TO_REPORT_MAP.md` §3) — a heavily clipped image cannot
  land in a `balanced` classification with a high confidence score
  regardless of mean luminance.
- **Skin**: `classifySkin` only computes a confidence value at all when
  real `skin` evidence exists; with no evidence the section confidence
  is unconditionally `{score: null, level: UNAVAILABLE}`, and a
  `skin.lowConfidence` warning is added when the module's own
  confidence is below its threshold even though skin *was* detected.

## 6. What this model explicitly does not do

- It does not claim 100% accuracy anywhere — `HIGH` is the ceiling
  level, not a certainty guarantee, and every section's confidence is
  shown alongside its observations rather than presented as a bare
  number.
- It never computes a confidence value from data the report itself
  fabricated (no confidence-of-a-confidence loops).
- It never rounds `LOW`/`UNAVAILABLE` up to `MEDIUM` for presentation
  purposes — the raw thresholds in §1 are what the UI renders.
