# 09 — EPIC 2E-G RELEASE NOTES

**AI Workflow v1.1.7 (EPIC 2E-G)** — "Lightroom Mapping V2 — Side-by-Side Data Comparison"
Status: Legacy Active · Comparison Console Ready · Visual Preview Pending · XMP Unchanged

This release closes out EPIC 2E-G: a Side-by-Side Comparison Data
Model comparing Legacy Mapping against the V2 Controlled Overlay
Preview Sandbox, fully integrated into the pipeline and Decision
Report, plus a read-only comparison UI. This entire EPIC remains
strictly non-production and data-level only — no actual preview
images exist yet.

## Core Additions

- **Side-by-Side Comparison Data Model** (`mapping-v2-side-by-side-comparison.js`)
  — compares Legacy Mapping data against the V2 Controlled Overlay
  Preview Sandbox across 15 abstract dimensions (tonal balance,
  exposure/contrast direction, highlight/shadow protection, white
  balance/saturation direction, color separation, skin protection,
  color stacking, over-stack severity, capture compatibility, style/
  intent alignment, safety confidence).
- **Similarity/divergence summaries** — overall scores with strongest/
  weakest matches and major/minor/unresolved differences, never
  inverting similarity blindly when evidence is incomplete.
- **Safety comparison** — Legacy/V2 safety scores, safer-side
  determination that never claims "V2 safer" from a strong V2 score
  alone without comparable Legacy evidence.
- **Risk comparison** — 8-area risk breakdown (skin, highlights,
  shadows, white balance, color, overstack, export, production write).
- **Evidence quality scoring** — insufficient/limited/moderate/strong,
  honestly low for missing data, never inflated.
- **Human Review status recalculation** — re-derives approval state,
  visual-review-completeness, and progress exclusively from canonical
  `reviewItems`, never trusting stale incoming top-level metadata.
- **Hard-stop normalization** — safely handles array/number/boolean/
  object shapes, merged from both Safety Clamp and Sandbox sources.
- **Reject-priority correction** — a normal Fail action correctly
  reports `"rejected"`, not the less-specific `"blocked"`.
- **Data availability vs. visual renderability separation** —
  `dataAvailable` (data exists) is never conflated with
  `canRenderLegacyPreview`/`canRenderV2Preview` (an image exists) —
  the latter are hard-coded `false` everywhere in this EPIC.

## Integration

- **Decision Engine integration** — wired as pipeline stage #12,
  built in `buildFinalPreset()` itself (not `_buildDecision()`) since
  it requires the real Legacy Mapping output, which doesn't exist
  until after `_buildDecision()` returns.
- **Canonical object**: `finalStyleIntent.sideBySidePreviewComparisonV2`
  — exactly one per analysis run.
- **Decision Report section** — "Side-by-Side Preview Comparison" with
  tri-state safety evidence (never defaulting missing Sandbox evidence
  to a false "confirmed safe" claim) and honest XMP-isolation wording
  (`xmpIsolation.regressionVerified: false` — this integration proves
  structural isolation, not a runtime regression check).
- **Reference Transfer preservation** — the canonical object is
  preserved automatically (Reference Transfer never rebuilds
  `finalStyleIntent`), plus a compact `sideBySideComparisonContext`.
- **Safe fallback** — any unexpected exception falls back to the
  engine's own safe empty-input result, never a hand-duplicated shape.

## UI

- **Side-by-Side data cards** — Legacy vs. Controlled V2 Preview,
  showing data availability, source, strengths/risks/warnings.
- **Dimension comparison** — all 15 dimensions with similarity,
  direction, preferred side, confidence, risk level.
- **Similarity/divergence panels**, **safety and risk panels**,
  **evidence quality**, **Human Review status** (read-only, with one
  safe "Go to Review Console" navigation link).
- **Blockers/warnings/recommendations**, **rollback/fallback**.
- **Responsive/mobile layout** — verified no overflow at 390px.
- **Malformed-data safety** — verified across dozens of scenarios
  (null/circular/non-array/unknown-enum inputs), zero crashes.
- **Tri-state evidence semantics** — Production Mapping/Preview
  Export/Production Write shown as Confirmed/Anomaly/Unknown, never
  inferred safe from missing evidence.
- **No fake preview images** — `canRenderLegacyPreview`/
  `canRenderV2Preview`/`canCompareVisually` always shown as their real
  (currently always-false) values.

## Safety Confirmation

- Legacy remains the selected production source — verified in every
  tested scenario, including full Human Review approval.
- No Preview Export — never active, never falsely claimed enabled.
- No Production Write — same guarantee, extended to a corrected
  `canWriteProduction`-based tri-state check (distinct from
  `appliedToProduction`, a different concept).
- No Mapping V2 activation anywhere in this codebase.
- No XMP write path in the comparison module (structural, not
  runtime-regression-verified — documented honestly as a gap).
- No input mutation — verified via before/after snapshot comparison at
  every integration boundary.
- No local persistence — zero `localStorage`/`sessionStorage`/
  `indexedDB`/cookie usage in any Side-by-Side file.
- No backend or API dependency — fully client-side, single-page,
  no-build-step application, unchanged.

## Known Limitations

- No actual Legacy image preview exists.
- No actual V2 image preview exists.
- No Before/After slider, zoom, or synchronized pan exists.
- The comparison is data-level only — never a rendered image.
- Similarity values may be qualitative for dimensions Legacy Mapping
  never actually evaluates (style/intent/capture-capability alignment).
- No Lightroom-accurate rendering exists or is claimed.
- Human Review remains entirely manual.
- Review State remains in-memory only — refreshing the page loses it.
- Real-image validation remains required — all QA used synthetic data.
- Thresholds remain partly hand-calibrated.
- No automated, persisted browser test suite exists.
- Mobile verified only at a 390px emulated viewport, not real devices.
- XMP regression was verified via live byte-length/schema comparison,
  not an exhaustive semantic diff (`xmpIsolation.regressionVerified`
  is honestly `false`).
- Side-by-Side approval does not activate any production output.

## Release Decision

**CONDITIONAL PASS** — see `11_EPIC_2E_G_QA_REPORT.md` for full
evidence and reasoning. Safe to ship: no syntax errors, Production
Mapping and XMP confirmed unchanged, visual renderability flags remain
false everywhere, Preview Export/Production Write cannot become
active, and injected HTML/script does not execute. Manual real-device,
real-photo, and exhaustive semantic-XMP-diff QA remain recommended
before treating this as fully production-hardened.

## Next Recommended EPIC

**EPIC 2E-H — Visual Preview Rendering Foundation** — create actual
isolated Legacy and V2 preview render plans, remaining strictly
non-production; build a safe browser preview renderer while avoiding
Lightroom-accuracy claims; prepare for Before/After visual comparison;
keep Export and Production Write disabled throughout. Not implemented
as part of EPIC 2E-G.
