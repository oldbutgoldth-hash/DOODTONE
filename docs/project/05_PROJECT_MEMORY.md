# 05 — PROJECT MEMORY

Summary snapshot of the current project state, written by inspecting the
actual source in this package. This is the file to read first when
resuming work on LUMIXA AI after time away.

## Current Version

**AI Workflow v1.1.8 (EPIC 2E-H)** — "Lightroom Mapping V2 — Isolated
Visual Preview Rendering" — as shown in the header/footer/sidebar
badges (source of truth: `core/project-version.js`). Status line:
"Legacy Active · Browser Preview Available · V2 Non-Production · XMP
Unchanged". EPIC 2E-H is CLOSED as of this Phase D release; production
output is still produced exclusively by Legacy Lightroom Mapping
(`decision.styleBudget` → `core/lightroom-mapping-engine/index.js`) —
the entire V2 shadow pipeline, Preview Sandbox, Human Review Console,
Side-by-Side Comparison, and now the isolated Visual Preview Render
Plan + browser canvas renderer, all remain non-production, layered on
top. Real Legacy/Controlled-V2 browser preview images DO now exist
(this is what EPIC 2E-H added) — but they are strictly
UI-local/approximate, never written back into `finalStyleIntent`,
never Lightroom-accurate, and never affect Production Mapping or XMP
in any way.

(Historical note: earlier revisions of this file referenced a separate,
older "LUMIXA AI, UI v1.0.0" / "Stage 2.4.2B.2" version scheme from
before the `core/project-version.js` badge existed. That scheme is no
longer tracked or displayed anywhere in the current UI — the AI
Workflow badge above is the only version identifier the current
codebase maintains.)

`core/` = 50 modules (confirmed via `find core -name "*.js" | wc -l`).
`ui/` = 18 files: `app.js` (pipeline orchestration/state) + `ui-engine.js`
+ `review-console-renderer.js` + `review-console-controller.js` + 14
canvas/panel renderer files. `index.html` = single-page static entry
point, no build step, no framework.

## Completed Development Stages (verified in source)

| Stage | What it added | Verified by |
|---|---|---|
| Phase 3 (pre-numbered) | Reference Tone Extraction architecture; Basic Panel demoted to supporting signal | `core/basic-panel-engine`, `core/lightroom-mapping-engine` structure |
| Phase 4 | Feature Fusion Engine; Style Feature Graph; conflict detection | `core/feature-fusion-engine` |
| Phase 5 | Adaptive Decision Engine (scene-specific strategy, not one fixed weighting) | `core/decision-engine` `SCENE_STRATEGIES` |
| Phase 6 | Style Benchmark Lite | `core/style-benchmark-engine` |
| Phase 6.1 | Explainable AI Decision Report | `core/decision-report-engine` |
| Phase 6.3 / 6.3.1 | Reference Transfer Intelligence (Reference/Transfer Confidence, Complexity, Lightroom Reproduction, WB Transfer Risk) | `core/reference-transfer-engine` |
| Stage 2.1 | WB Intent (mood-preserving, not raw Temp/Tint) | `wbIntent` in `core/whitebalance-engine` |
| Stage 2.2 | Decision Intelligence Optimization (transfer-risk-aware trust weighting) | `_estimateTransferRisk` in `core/decision-engine` |
| Stage 2.3 | Intelligent Lightroom Mapping (intent-aware, cross-slider optimisation, photographer priority rules) | `_crossSliderOptimize`, `_applyPhotographerPriority` in `core/lightroom-mapping-engine` |
| Stage 2.4 | Photographer Intelligence Layer v1 (colour-based 12-look vocabulary, Editing Strategy, Style Budget, Photographer Acceptance, Editing Distance Estimate) | `_deriveStyleVocabulary`, `_buildEditingStrategy`, `_buildStyleBudget` |
| Stage 2.4.1 (×2 patches) | Style Budget mathematical scaling matrix, made genuinely functional (verified `adjustmentsMade: 0 → 1 → 5` across two fixes) and priority-weighted | `_enforceDimensionBudget`, `ENGINE_PRIORITY_WEIGHT` |
| Stage 2.4.2A | Style Vocabulary Intelligence v2 — 17-style photographer-oriented classifier, decoupled from the colour-based one | `_classifyPhotographerStyle`, `STYLE_PROFILES` |
| Stage 2.4.2B | Style DNA — 61-element shared ingredient catalog, per-style profiles, Style Distance | `_buildStyleDNA`, `DNA_ELEMENTS`, `_computeStyleDistance` |
| Stage 2.4.2B.1 | Style DNA Validation — required/forbidden rules for 8 styles, ambiguity detection | `_validateStyleDNA`, `STYLE_DNA_RULES` |
| Stage 2.4.2B.2 | Style Feasibility Intelligence — authoritative + preliminary feasibility scoring, 5 styles with explicit rules | `_computeStyleFeasibility` (reference-transfer-engine), `_estimateStyleFeasibilityProxy` (decision-engine) |
| (UI) LUMIXA AI redesign | Full visual redesign (warm graphite/gold theme, Cormorant Garamond/Public Sans/JetBrains Mono), replacing an earlier "Lumina Precision" purple theme | `index.html` inline styling, `ui/app.js`/`ui-engine.js` |
| (UI) Mobile/tablet responsive fix | Fixed a hand-off with zero `@media` rules (topbar overflow, unconstrained grid tracks, permanent 3-column layout) | `@media` blocks in `index.html`, `.lx-*` classes |
| (UI) File-reselection bug fix | `loadFile()` now clears all prior state before every new analysis, not just the first | `handleReset()` call inside `loadFile()` |
| (UI) Image Preview Viewer | Scrollable, actual-resolution, conditionally-centred, zoom-ready image viewer replacing a static `object-fit:cover` `<img>` | `#viewerViewport`, `.lx-viewer-viewport` CSS, inline enhancement `<script>` |
| EPIC 1.1 | Calibration Registry Foundation — 87 hard-coded weights/thresholds mirrored into one centralised, explainable, self-validating registry; zero behaviour change (no engine reads from it yet) | `core/calibration-registry/index.js`, `validateCalibrationRegistry()` |
| EPIC 1.2 | Reference Color Match Engine — standalone reference→target colour transfer feature (palette extraction, tone-zone analysis, intensity/mode-based transfer, skin/highlight/shadow preservation, XMP export), fully separate from the main pipeline and from Photographer Intelligence | `core/color-match/*.js`, `ui/reference-color-match-panel.js`, new `#rcmSec` in `index.html` |
| EPIC 1.3 | Reference Color Match × Photographer Intelligence Bridge — a new `color-match-intelligence-bridge.js` turns Reference Color Match's palette/tone-zones into "Reference Color Intelligence" (colour mood, palette signature, independent style hints) that SUPPORTS (never replaces/overwrites/lowers confidence of) the existing Photographer Style/DNA/Feasibility detection; verified via direct comparison that confidence/DNA scores are byte-identical with and without this new evidence | `core/color-match/color-match-intelligence-bridge.js`, additive changes to `decision-engine`/`decision-report-engine`/`reference-transfer-engine`, JS-injected UI section in `ui/reference-color-match-panel.js` |
| EPIC 1.4 | Photographer Intent Intelligence — a new, structurally separate axis from photographerStyle (look category) answering "what creative/emotional direction is intended?" (19 intents: Dreamy, Premium, Clean, Editorial, Natural, Emotional, Minimal, Romantic, Cinematic, Bold, Muted, Warm, Soft, Classic, Modern, Documentary, Filmic, High Key, Low Key) — declarative-table classifier reusing only already-computed signals (photographerStyle, Style DNA Validation, styleFeasibilityEstimate, optional Reference Color Intelligence), with structured evidence weighting and 8 named conflict-detection rules, all verified against isolated synthetic test cases | Additive changes to `decision-engine`/`decision-report-engine`/`reference-transfer-engine` only — no new files, no UI |
| EPIC 1.5 | Intent Hierarchy & Intent Strength — upgrades EPIC 1.4's flat intent label with a many-to-many family system (7 families, 2 new intents "Elegant"/"Commercial" added to complete it), a genuinely separate `intentStrength`/`strengthLevel` measure (verified concretely: identical topScore produced 0.76 vs 0.41 strength purely from a conflict-severity difference — proving it's structurally independent from confidence), an intent↔style relationship map, a 9th conflict rule, and explanation-only Intent Budget Hints for a future (not-yet-built) Style Budget stage — 100% backward compatible with every EPIC 1.4 field | Additive changes to `decision-engine`/`decision-report-engine`/`reference-transfer-engine` only — no new files, no UI |
| EPIC 1.6 | Capture Capability Intelligence (RAW-Aware) — a new `core/image-analysis/capture-capability-model.js` answers "what is this source capture realistically capable of?" independent of style/intent (dynamic range, highlight/shadow recovery, noise tolerance, WB/colour latitude, editing headroom), with Intent Compatibility scoring and explanation-only Capture Budget Hints for a future EPIC 1.7; same preliminary (Decision Engine)/authoritative (Reference Transfer) circular-dependency pattern as Style Feasibility, using the exact same scoring function in both places (verified: Excellent-capture and Poor-capture synthetic tests produced correctly contrasting scores, strengths, and limitations) | New `core/image-analysis/capture-capability-model.js`; additive changes to `decision-engine`/`decision-report-engine`/`reference-transfer-engine` |
| EPIC 1.7 | Style Budget Intelligence — a new `core/decision-engine/style-budget-model.js` answers "how should editing effort be distributed?" given Intent + Style DNA + Feasibility + Capture Capability, as an ABSTRACT resource-allocation layer (11 budget dimensions, 0-1 priorities only — no Lightroom slider values). Named `styleBudgetIntelligence` specifically to avoid colliding with the pre-existing, unrelated Stage 2.4C `styleBudget` (verified: legacy object came back byte-identical after this stage). Intent-aware base allocation (6 named examples + family-level fallback for the rest), capture-aware reduction (verified: identical input through Excellent vs. Poor capture correctly shifted tonalBudget 0.85→0.70 and safetyBudget to its clamp), Style-DNA-aware reinforcement (verified: Green Pastel DNA correctly suppressed "green saturation" almost verbatim to the spec's own example), 5-pattern stacking-risk detection (verified both non-triggering and triggering cases), and a budget confidence formula verified structurally distinct from intent confidence (0.578 vs. 0.85 in one deliberately-contrasting test) | New `core/decision-engine/style-budget-model.js`; additive changes to `decision-engine`/`decision-report-engine`/`reference-transfer-engine`; legacy `styleBudget` (Stage 2.4C) completely untouched |
| EPIC 1.7F | Style Budget Intelligence Cleanup Patch (production hardening) — `assertive` replaced with `expressive`; new `aggressive-risky` warning-only budgetLevel (high budget + real risk signal, never modifies mapping); `priorities[]` upgraded to `{area, dimension, value, level, reason, source}` (dimension/value kept for backward compat); fallback confidence now explicitly penalised by a `missingInputCount` (verified: empty input → confidence 0.3, within the required 0.25-0.38 band, vs. previously drifting toward 0.5); new `noiseReliability {status, source, confidence, reason}` distinguishing measured/estimated/unavailable noise data, so noise-driven budget cuts are never claimed with more certainty than actually exists; Decision Report and Reference Transfer Report text updated to use the new vocabulary and readable priority areas | `core/decision-engine/style-budget-model.js` (main patch); small follow-on text updates in `reference-transfer-engine`/`decision-report-engine`; legacy `decision.styleBudget` and Lightroom Mapping verified completely untouched |
| EPIC 2A | Lightroom Mapping V2 Planner — a new, **shadow-only** `core/lightroom-mapping-engine/mapping-v2-planner.js` answers "how should Lightroom Mapping V2 think about this image?" as a purely abstract planning layer (10 plan dimensions, each `{priority, direction, intensity 0-1, safetyLimit 0-1, reason, sourceSignals}` — no Lightroom slider values anywhere, verified). Reads photographerIntent/styleDNA/styleFeasibility/captureCapability/styleBudgetIntelligence, never writes back to any of them. Attached (wrapped in try/catch as defense-in-depth) to `finalStyleIntent.lightroomMappingPlanV2` — verified safe because the existing production `mapStyleFingerprintToLightroom()` never reads `finalStyleIntent` at all (confirmed via grep), so nothing here can reach XMP export. `fallbackStrategy.useLegacyMapping` is always `true` this phase. Verified: production XMP-ready output (`exp/con/hi/sh/wh/bl/temp/tint/vib/sat/clarity/dehaze/texture/sharp/noise/crv_*/hsl/grade/cal`) is byte-identical across repeated calls with this stage's changes in place; legacy `decision.styleBudget` unchanged; empty-input planner call (`buildLightroomMappingPlanV2({})`) never throws | New `core/lightroom-mapping-engine/mapping-v2-planner.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed: zero references to the planner or to styleBudgetIntelligence anywhere in that file) |
| EPIC 2B | Budget-to-Lightroom Translation V2 + AI Workflow version display — a new, **shadow-only** `core/lightroom-mapping-engine/mapping-v2-translator.js` translates styleBudgetIntelligence + lightroomMappingPlanV2 + captureCapability + photographerIntent + Style DNA into `lightroomTranslationV2` (per-tool target-range hints for Basic Tone/Tone Curve/White Balance/HSL/Color Grading/Calibration/Presence/Detail, each a 0-1 abstract intensity range — no Lightroom slider values anywhere, verified). Attached to `finalStyleIntent.lightroomTranslationV2` via the same try/catch defense-in-depth pattern as EPIC 2A's planner. `fallbackStrategy.useLegacyMapping` is `true` unconditionally — even verified at the highest readiness level ("ready-for-controlled-activation"), production mapping is still NOT activated. Also added `core/project-version.js` (single source of truth for the "AI Workflow" version badge: v1.0.0/EPIC 2B/title/status/10 upgraded systems) and a compact, expandable footer badge in `index.html` (native `<details>/<summary>`, no new JS) showing "AI Workflow v1.0.0 (EPIC 2B)" / "Lightroom Mapping V2 — Shadow Translation" / "Shadow-only · Legacy Mapping Active · XMP Unchanged" plus the 10 upgraded systems. Verified: production XMP output unchanged, legacy `decision.styleBudget` unchanged, badge visible and expandable on both desktop and mobile (390px) with zero horizontal overflow before or after expansion | New `core/lightroom-mapping-engine/mapping-v2-translator.js`, `core/project-version.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; minimal, additive footer-badge markup + 2 small CSS rules in `index.html` (no layout/responsive structure changes); production `core/lightroom-mapping-engine/index.js` completely untouched |
| EPIC 2B-FIX | AI Workflow Badge visibility fix — the EPIC 2B badge lived only in the footer (not visible without scrolling on a typical page load). Added a second, PRIMARY badge inside the sticky topbar (`#aiWorkflowHeaderBadge`, next to the Plan badge) — visible immediately on page load with zero scrolling, on both desktop ("AI Workflow v1.0.0 (EPIC 2B)") and mobile ("AI v1.0.0" compact form via a `max-width:680px` media query, replacing the Plan badge's own mobile-hidden slot). Both header and footer badges now render from the same `core/project-version.js` single source of truth via one shared wiring script. A real self-caught mistake during this fix: an early edit accidentally orphaned the pre-existing EPIC 1.2 Reference Color Match init `<script>` block (missing its opening tag) — caught immediately via a browser DOM check (RCM elements briefly appeared absent) before finalizing, and fixed | Additive markup + 2 small CSS blocks + updated wiring script in `index.html`; no other files touched — Lightroom Mapping, XMP generation, analysis engines, and Reference Color Match behavior all confirmed untouched |
| EPIC 2B-F | Translation Hint Safety Patch — a real bug found and fixed in `mapping-v2-translator.js`: several hint groups (hslHints, colorGradingHints, calibrationHints, presenceHints, detailHints) and targetRangeHints entries could return `intensity > maxIntensity` or `maxIntensity > safetyLimit` (verified concretely on a Filmic-intent + low-colorLatitude/noiseTolerance test: calibrationHints 0.90>0.85, detailHints 0.90>0.40, presenceHints 0.63>0.32, plus 5 targetRangeHints with maxIntensity exceeding safetyLimit) — dangerous for a future EPIC 2C Safety Clamp reading intensity as already-safe. Fixed with a final normalization pass (`normalizeTranslationSafety`, `normalizeHintSafety`, `normalizeRangeHint`) that runs LAST, right before the object returns, guaranteeing `intensity <= maxIntensity <= safetyLimit <= 1` everywhere — verified all previously-buggy values now pass, with deduplicated warnings (`translationWarnings`) and specific per-field developer notes only when an actual cap occurred. `mode`/`fallbackStrategy.useLegacyMapping`/`safeMode` reconfirmed unchanged; production XMP output reconfirmed byte-identical/deterministic across repeated `buildFinalPreset()` calls; legacy `decision.styleBudget` reconfirmed unchanged. Header AI Workflow badge (from EPIC 2B-FIX) reconfirmed still visible without scrolling on both desktop and mobile, zero new overflow | `core/lightroom-mapping-engine/mapping-v2-translator.js` only — no other files needed changes; `index.html`'s header badge from EPIC 2B-FIX was verified already satisfying this stage's Task 5 requirements as-is |
| EPIC 2C | Safety Clamp & Over-stack Protection V2 — a new, **shadow-only** `core/lightroom-mapping-engine/mapping-v2-safety-clamp.js` reviews lightroomTranslationV2 and answers "which mapping directions are safe, which must be capped, which tool combinations are risky?" — `globalSafetyScore` (0-1, weighted from translation/plan/budget confidence, feasibility, DNA validation, capture score/headroom, minus noise/over-stack/critical-protection penalties, with an explicit missing-input penalty), `activationGate` (hard-coded `canActivate: false` inside the module itself, not just by omission — verified this cannot be flipped by any input combination), 8 per-tool `clampProfiles`, `toolCaps[]` derived from the translation's own targetRangeHints capped further by clampProfiles, `channelProtections[]`, a 10-pattern `overStackAnalysis` (verified both a non-triggering case and a triggering multi-tool-stack case with an accurate, condition-matched hard-stop message), `hardStops[]`/`softCaps[]`, and a `safeTranslationPreview` built via deep-clone (verified: the original `lightroomTranslationV2` object is provably untouched — byte-identical JSON before/after — never mutated). Also bumped `core/project-version.js` and both header/footer badge static-fallback text to "AI Workflow v1.0.1 (EPIC 2C)" / "Lightroom Mapping V2 — Safety Clamp", with the upgraded-systems list updated to include "Safety Clamp & Over-stack Protection V2". Verified: production XMP output byte-identical/deterministic across repeated `buildFinalPreset()` calls, legacy `decision.styleBudget` unchanged, badge visible without scrolling on desktop and mobile (compacts to "AI v1.0.1"), zero new overflow, zero console errors | New `core/lightroom-mapping-engine/mapping-v2-safety-clamp.js`; minor version-bump edits to `core/project-version.js` and `index.html` (badge text/title/systems-list fallback only — no layout/CSS structure changes); minimal, try/catch-wrapped attachment in `core/decision-engine/index.js` following the exact EPIC 2A/2B pattern; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep: zero references to the safety clamp or styleBudgetIntelligence anywhere in that file) |
| EPIC 2C-F | Safety Clamp Preview Consistency Patch — 2 real defensive gaps found and fixed in `mapping-v2-safety-clamp.js`. **Patch 1:** `buildLightroomSafetyClampV2` confirmed to genuinely throw (`(dna ?? []).map is not a function`) when `styleDNA` arrived as `{elements:[...]}` instead of a plain array — fixed with a new `normalizeStyleDNA()` helper (array / `{elements}` / `{items}` / null-missing → all handled, unknown shapes safely return `[]`), used at the single point Safety Clamp reads styleDNA. **Patch 2/3:** `safeTranslationPreview.safeTargetRangeHints` could in principle return `minIntensity > maxIntensity` after a tool/safetyLimit cap pushed `maxIntensity` below a range's original `minIntensity` — not reproducible through the current translator's own output (its own `minIntensity` values are always 0-0.1, below every clamp-profile floor), but confirmed fixable and verified correct via a direct mock-translation test (0.6/0.9 range capped down to a consistent 0.3/0.3), with a deduplicated developer note added exactly when the reduction happens. `rangeType` reconfirmed always `"abstract-intensity"`; original `lightroomTranslationV2` reconfirmed never mutated (byte-identical JSON before/after); `activationGate.canActivate`/`fallbackStrategy.useLegacyMapping` reconfirmed unchanged; production XMP output reconfirmed byte-identical/deterministic; AI Workflow badge reconfirmed still showing "v1.0.1 (EPIC 2C)" | `core/lightroom-mapping-engine/mapping-v2-safety-clamp.js` only — no other files needed changes |
| EPIC 2D | Shadow Compare Report V2 — a new `core/lightroom-mapping-engine/mapping-v2-shadow-compare.js` compares (1) legacy production mapping (read-only, summarised abstractly — never re-derives slider values), (2) `lightroomMappingPlanV2`, (3) `lightroomTranslationV2`, (4) `lightroomSafetyClampV2`, answering "how does V2 think differently from production mapping, and is it safer?" Produces a 10-dimension `comparisonMatrix` (tonal/color/skin/wb/curve/hsl/calibration/colorGrading/detail/safety, each with legacy vs. V2 abstract direction, alignment, divergence), `alignmentScores` (7 sub-scores), `divergenceAnalysis`, `safetyDelta` (estimate only, explicitly not a final-quality claim), `expectedImprovement`, and `activationReadiness` with `canProceedToControlledActivation` hard-coded `false` (EPIC 2E, a real activation stage, does not exist yet). Attached to `finalStyleIntent.lightroomShadowCompareReportV2` (try/catch defense-in-depth, same EPIC 2A-2C pattern); a compact, non-JSON-dump "Lightroom Mapping V2 Shadow Compare" section added to Decision Report (safe if the report is missing); a compact `shadowCompareContext` + 2-3 narration lines added to Reference Transfer Report (read-only, transfer algorithm untouched). Also bumped `core/project-version.js`/badges to "AI Workflow v1.0.2 (EPIC 2D)" / "Lightroom Mapping V2 — Shadow Compare". Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, empty-input call never throws, badge visible without scrolling on desktop and mobile (compacts to "AI v1.0.2"), zero console errors. Known limitation confirmed directly: `legacySummary.available` is `false` when called from `core/decision-engine` (the circular-dependency pattern this project has hit repeatedly — legacy mapping's actual slider output isn't computed yet at that point in the pipeline) | New `core/lightroom-mapping-engine/mapping-v2-shadow-compare.js`; minor version-bump edits to `core/project-version.js`/`index.html`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-A | Controlled Activation Gate — answers "is Mapping V2 allowed to influence production output?" New `core/lightroom-mapping-engine/mapping-v2-flags.js` (`LIGHTROOM_MAPPING_V2_FLAGS` — every production-impacting flag defaults `false`: `enableControlledActivation`, `allowProductionOverride`, `allowLegacySafetyOverlay`; requirement flags default to the safest/most demanding setting) and `mapping-v2-activation-controller.js` (`buildLightroomControlledActivationV2` — 11 gate checks, blockers, rollback plan, fallback strategy, activation confidence as a technical-readiness metric only, never a trigger). Verified with THREE distinct test cases, not just the default: (1) empty input → `activationState: "legacy-only"`, `canUseV2: false`; (2) a synthetically "perfect" input (high confidence, no hard stops, no over-stack, legacy available, safer-estimate) with DEFAULT flags → `canUseV2` still `false`, `activationState` correctly upgrades to `"ready-for-human-review"` (proving the gate reflects genuine technical readiness rather than being trivially always-blocked); (3) the SAME perfect input with `enableControlledActivation`/`allowProductionOverride` flags manually forced `true` → `canUseV2` STILL `false`, because the "human review completed" gate check is hard-coded `passed: false` with no mechanism in this codebase able to satisfy it — proving no combination of flags or upstream signals can bypass that specific gate. Attached to `finalStyleIntent.lightroomControlledActivationV2` (try/catch defense-in-depth, no `flags` override passed — always resolves to the safe defaults); compact sections added to Decision Report ("Lightroom Mapping V2 Controlled Activation") and Reference Transfer Report (`activationContext`), both safe if the gate object is missing. Bumped `core/project-version.js`/badges to "AI Workflow v1.1.0 (EPIC 2E-A)". Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge visible without scrolling (compacts to "AI v1.1.0"), zero console errors | New `core/lightroom-mapping-engine/mapping-v2-flags.js`, `mapping-v2-activation-controller.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html`; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-A-F | Controlled Activation Gate Consistency Patch — 2 small consistency fixes. **Patch 1 (real bug):** the "Human review is required" blocker and the human-review gate's failing state were emitted unconditionally, even when `flags.requireHumanReview === false` (verified before the patch: with `requireHumanReview:false`, the blocker still appeared and the gate still showed `passed:false`). Fixed so the blocker is only pushed when `requireHumanReview` is true, and the gate now reports `passed:true`/"not enforced" when review isn't required — verified the full matrix: default (`requireHumanReview:true`) still blocks and keeps `canUseV2:false`; `requireHumanReview:false` alone drops the blocker but `canUseV2` stays `false` (other flags still off); and `requireHumanReview:false` + both production flags forced true + perfect input → `canUseV2:true` with `activationState:"ready-for-controlled-test"`, proving the gate logic is genuinely flag-driven rather than hard-stuck. Default behavior is unchanged and still safe because default `requireHumanReview` remains `true`. **Patch 2:** the AI Workflow badge `statusLine` (and both static HTML fallbacks) still read the older "Shadow-only · Legacy Mapping Active · XMP Unchanged" — updated to "Legacy Active · V2 Gate Ready · Override Disabled" to match the EPIC 2E-A gate state. **Patch 3:** confirmed Decision Report / Reference Transfer wording already says "Mapping V2 is prepared but not active. The current XMP still uses Legacy Mapping." and never implies V2 is active with default flags (Reference Transfer's "active/not yet active" is correctly conditioned on `canUseV2`, which is `false` by default). Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge shows the new status on desktop and mobile without overflow, zero console errors | `core/lightroom-mapping-engine/mapping-v2-activation-controller.js` (Patch 1); `core/project-version.js` + `index.html` static fallbacks (Patch 2); no changes needed for Patch 3 (wording already correct) |
| EPIC 2E-B | Legacy Safety Overlay V2 — answers "can V2 safety intelligence warn, cap, or guide the current LEGACY mapping safely — without replacing it?" Legacy Mapping remains driver; V2 Safety becomes advisor/guardrail. New `core/lightroom-mapping-engine/mapping-v2-legacy-safety-overlay.js` (`buildLegacySafetyOverlayV2` — 11 overlay gate checks, a read-only `legacyRiskReview` that classifies existing legacy preset/budget values abstractly without ever modifying or regenerating them, `overlayRecommendations[]`/`overlayClampPlan` both report-only by default, `protectedAreas[]`, `suppressedLegacyRisks[]` with `active:false` hard-guaranteed regardless of flags, rollback plan). Added 8 new flags to `mapping-v2-flags.js` (`enableLegacySafetyOverlay`/`allowLegacyOverlayProductionClamp` default `false`; `allowLegacyOverlayWarningsOnly` defaults `true` since report-only output can never touch XMP). Verified with the same THREE-case discipline as EPIC 2E-A: (1) empty input → `overlayState:"warnings-only"`, `canApplyOverlay:false`; (2) full input with a synthetically risky legacy preset (high highlight/shadow/clarity/WB/grading/calibration values) → correctly detects `legacyRiskReview.riskLevel:"high"` and produces 7 report-only recommendations, still `canApplyOverlay:false`; (3) the same input with `enableLegacySafetyOverlay`/`allowLegacyOverlayProductionClamp` flags forced `true` → `canApplyOverlay` correctly flips to `true` (proving the gate is genuinely flag-driven), yet `overlayClampPlan.canApply` and every `suppressedLegacyRisks[].active` remain hard-coded `false` regardless — the overlay's own internal "would this touch production" flags are never derived from the outer gate, by design. Attached to `finalStyleIntent.legacySafetyOverlayV2` (try/catch defense-in-depth, no `flags` override); compact sections added to Decision Report ("Legacy Safety Overlay V2" via `legacySafetyOverlay`) and Reference Transfer Report (`overlayContext`), both safe if missing. Bumped `core/project-version.js`/badges to "AI Workflow v1.1.1 (EPIC 2E-B)" / "Legacy Active · Safety Overlay Ready · XMP Unchanged". Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge visible without scrolling (compacts to "AI v1.1.1"), zero console errors | New `core/lightroom-mapping-engine/mapping-v2-legacy-safety-overlay.js`; additive flags in `mapping-v2-flags.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html`; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-C | Overlay Preview / Controlled Overlay Simulation — answers "if Legacy Safety Overlay WERE allowed to act, what would it recommend capping, protecting, or suppressing?" A pure simulation/preview layer; Legacy Mapping remains driver. New `core/lightroom-mapping-engine/mapping-v2-overlay-simulation.js` (`buildLegacyOverlaySimulationV2` — 10 simulation gate checks, a read-only `legacyInputSummary` classifying legacy source type/risk abstractly, `simulatedOverlayActions[]` with `simulationOnly:true`/`wouldAffectProduction:false` on every item, `simulatedClampPreview` never applied, before/after/delta risk estimates that explicitly hedge language and never claim final image-quality improvement, `protectedAreas[]`/`suppressedRisks[]` with `activeInProduction:false` hard-guaranteed). Added 9 new flags to `mapping-v2-flags.js` — `enableLegacyOverlaySimulation`/`allowOverlaySimulationReport` default `true` (report-only output can never touch XMP), `allowOverlaySimulationProductionWrite`/`allowOverlaySimulationPresetMutation` default `false`; also documented the older EPIC 2E-A `allowLegacySafetyOverlay` flag as a confirmed-unused deprecated alias (grep-verified zero references anywhere in the codebase) pointing to `enableLegacySafetyOverlay` as canonical, without removing it. Verified `canApplyToProduction`/`selectedOutputSource` are HARD-CODED (`false`/`"legacy"`) inside the module itself, not merely flag-gated — confirmed this stays true even when `allowOverlaySimulationProductionWrite`/`allowOverlaySimulationPresetMutation` are manually forced to `true` (the corresponding gate checks correctly flip to `passed:false` "unexpected in this phase" in that case, but the two hard-coded output fields never move). Verified with a synthetically risky legacy preset (high highlight/shadow/clarity/WB/grading values + risky Overlay V2 risk review) that the ORIGINAL `legacyPreset` object is provably untouched — byte-identical JSON before/after the call — confirming the "never mutates legacy preset" guarantee empirically, not just by code inspection. Attached to `finalStyleIntent.legacyOverlaySimulationV2` (try/catch defense-in-depth, no `flags` override); compact sections added to Decision Report ("Overlay Simulation V2" via `overlaySimulation`) and Reference Transfer Report (`simulationContext`), both safe if missing. Bumped `core/project-version.js`/badges to "AI Workflow v1.1.2 (EPIC 2E-C)" / "Legacy Active · Overlay Simulation Ready · XMP Unchanged". Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge visible without scrolling (compacts to "AI v1.1.2"), zero console errors | New `core/lightroom-mapping-engine/mapping-v2-overlay-simulation.js`; additive flags in `mapping-v2-flags.js` (plus a documentation-only comment on the deprecated `allowLegacySafetyOverlay` alias); minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html`; production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-C-F | AI Workflow Sidebar Version Sync Patch — confirmed a real stale-UI bug: the left sidebar's "AI Workflow" block still showed hardcoded, long-outdated "v1.0.0 · Online" text (grep-verified before the patch), while the header/footer badges correctly showed "v1.1.2 (EPIC 2E-C)" — a visible inconsistency after deploy. Fixed by giving the sidebar version `<p>` an id (`aiWorkflowSidebarVersion`) and extending the SAME existing `core/project-version.js` import script (no duplicate hardcoded version logic) to also fill it, deriving a compact "vX.Y.Z · <short title>" string by splitting `AI_WORKFLOW_VERSION.title` on " — " (falls back to `.epic` if no split found) — genuinely single-source-of-truth, not a second hardcoded string. Static HTML fallback also updated to "v1.1.2 · Overlay Simulation" so even a failed module import can never show the old "v1.0.0 · Online" again. Verified: zero remaining matches for "v1.0.0 · Online" anywhere in the codebase; sidebar renders "v1.1.2 · Overlay Simulation" in-browser; header badge still correctly shows "AI Workflow v1.1.2 (EPIC 2E-C)"; production XMP output byte-identical/deterministic; legacy `decision.styleBudget` unchanged; full E2E (main pipeline + RCM) valid; mobile 390px no new overflow; zero console errors | `index.html` only (sidebar markup id + static fallback text + one small addition to the existing wiring script) — no JS module files, no decision-engine, no Lightroom mapping files touched |
| EPIC 2E-D | Controlled Overlay Test Gate V2 — answers "is the overlay simulation safe enough to enter a controlled TEST mode?" NOT production activation. New `core/lightroom-mapping-engine/mapping-v2-overlay-test-gate.js` (`buildControlledOverlayTestGateV2` — 16 test-gate checks, `testEligibility` with a 5-level ladder, `testPlan` with allowed/prohibited actions, required steps, success/stop criteria, a 10-item `humanReviewChecklist` all defaulting to "pending", `safetyRequirements` with `productionWriteDisabled` always `true`). Added 15 new flags to `mapping-v2-flags.js` — `enableControlledOverlayTestGate` defaults `true` (evaluating readiness never touches production by itself), `allowControlledOverlayTest`/`allowOverlayTestPresetPreview`/`allowOverlayTestProductionWrite` all default `false`. Verified `canWriteProduction` is HARD-CODED `false` inside the module itself (not merely flag-gated, per Task 3's explicit "must remain false for this EPIC" requirement) — confirmed this stays false even when every other flag (`allowControlledOverlayTest`, `allowOverlayTestPresetPreview`, `requireHumanReviewForOverlayTest:false`) is manually forced favourable and `canEnterControlledTest`/`canPreviewOverlayPreset` correctly flip to `true` in that scenario (proving those two ARE genuinely flag-driven, while `canWriteProduction`/`selectedOutputSource` never move). "Production write disabled by design" is treated as a deliberate safety blocker (Task 5), not a system failure. Attached to `finalStyleIntent.controlledOverlayTestGateV2` (try/catch defense-in-depth, no `flags` override); compact sections added to Decision Report ("Controlled Overlay Test Gate V2" via `controlledOverlayTestGate`) and Reference Transfer Report (`testGateContext`), both safe if missing. Bumped `core/project-version.js`/badges/sidebar to "AI Workflow v1.1.3 (EPIC 2E-D)" / "Legacy Active · Overlay Test Gate Ready · XMP Unchanged" — sidebar sync (from EPIC 2E-C-F's title-splitting script) verified to update automatically with zero additional code, confirming that fix's single-source-of-truth design works across EPICs. Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge and sidebar both visible without scrolling on desktop and mobile, zero console errors, zero remaining stale version text anywhere | New `core/lightroom-mapping-engine/mapping-v2-overlay-test-gate.js`; additive flags in `mapping-v2-flags.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html` (sidebar synced automatically, no extra script changes needed); production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-E | Controlled Overlay Preview Sandbox V2 — answers "if we previewed the overlay safely, what abstract preset changes would be simulated?" NOT production activation; builds a SEPARATE, non-production preview object. New `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js` (`buildControlledOverlayPreviewSandboxV2` — 16 preview gate checks, a read-only, explicitly-immutable `legacyPreviewInput`, `previewOverlayPlan`, a `previewPresetShadow` with abstract 0-1 normalized `changes[]` only, before/after/delta risk estimates that hedge language and never claim visual-quality improvement, `previewComparison` that compares risk CATEGORIES only — never pixels, and 4+ `humanReviewNotes`). Added 15 new flags to `mapping-v2-flags.js` — `enableControlledOverlayPreviewSandbox`/`allowOverlayPreviewSandboxReport`/`allowOverlayPreviewPresetObject` default `true` (building an abstract preview object never touches production by itself), `allowOverlayPreviewXMPExport`/`allowOverlayPreviewProductionWrite`/`allowOverlayPreviewPresetMutation` all default `false`. Verified FIVE hard guarantees hold simultaneously and independently of any flag: `canExportPreviewXMP`, `canWriteProduction`, `previewPresetShadow.containsRealSliderValues`, `previewPresetShadow.containsXMPValues` all stay `false`, and the original `legacyPreset` object is provably never mutated (byte-identical JSON snapshot before/after a full-input call) — confirmed all five stay true even when every export/write/mutation flag (`allowOverlayPreviewXMPExport`, `allowOverlayPreviewProductionWrite`, `allowOverlayPreviewPresetMutation`) is manually forced `true`, while `canCreatePreview` (the one genuinely flag-driven output) correctly builds a real abstract preview object in that same test. Attached to `finalStyleIntent.controlledOverlayPreviewSandboxV2` (try/catch defense-in-depth, no `flags` override); compact sections added to Decision Report ("Controlled Overlay Preview Sandbox V2" via `controlledOverlayPreviewSandbox`) and Reference Transfer Report (`previewSandboxContext`), both safe if missing. Bumped `core/project-version.js`/badges/sidebar to "AI Workflow v1.1.4 (EPIC 2E-E)" / "Legacy Active · Preview Sandbox Ready · XMP Unchanged" — self-caught and fixed a real leftover bug during this stage: the sidebar's static HTML fallback had drifted to read "v1.1.3 · Overlay Test Gate" (a stale hand-edited string from the EPIC 2E-D patch, not derived from the dynamic script) instead of matching the new version; caught via the QA-recommended stale-version grep and corrected to "v1.1.4 · Overlay Preview Sandbox". Verified: production XMP output byte-identical/deterministic, legacy `decision.styleBudget` unchanged, badge and sidebar both visible without scrolling on desktop and mobile, zero console errors, zero remaining stale version text anywhere in the codebase (grep-verified for v1.0.0, v1.1.2, and v1.1.3 strings) | New `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`; additive flags in `mapping-v2-flags.js`; minimal, try/catch-wrapped attachment in `core/decision-engine/index.js`; additive, safe-if-missing sections in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html` (including a manual fix to the sidebar's stale static fallback text); production `core/lightroom-mapping-engine/index.js` completely untouched (confirmed via grep) |
| EPIC 2E-E-F | Preview Sandbox Contract and Gate Consistency Patch — confirmed two real defects in EPIC 2E-E's implementation: (1) `canCreatePreview` eligibility only checked "simulation or overlay exists", never actually verifying test-gate eligibility, hard stops, over-stack severity, confidence/safety thresholds, or human review; (2) human review was represented only as free-text `humanReviewNotes`, with no structured, honestly-tracked checklist. Rewrote `mapping-v2-overlay-preview-sandbox.js`'s public contract to canonical field names (`previewState`, `canGeneratePreview`, `canExportPreview`, `previewEligibility`, `previewPlan`, `simulatedPreviewPreset`, `previewRiskReview`, `humanReviewChecklist`, `safetyRequirements`) while keeping the EPIC 2E-E names as backward-compatible aliases pointing at the same values (`sandboxState`, `canCreatePreview`, `canExportPreviewXMP`, `previewOverlayPlan`, `previewPresetShadow`, `humanReviewNotes`, `previewRiskBefore/After/Delta`). `canGeneratePreview` now requires ALL required gates simultaneously — sandbox enabled, generation explicitly allowed, test gate existing AND indicating real controlled-test eligibility, simulation/overlay/safety clamp all existing, no hard stops, no critical over-stack, sufficient confidence AND safety score, AND a complete 10-item human review checklist (`legacy-output-preserved` through `export-path-unchanged`) that is NEVER assumed passed — every item defaults to "pending" unless an optional `humanReviewState` map explicitly supplies "passed"/"failed" per item. Added canonical flags to `mapping-v2-flags.js` (`enableOverlayPreviewSandbox`, `allowOverlayPreviewGeneration`, `allowOverlayPreviewExport`, `requireHumanReviewForPreview`, `minOverlayPreviewConfidence`, `minOverlayPreviewSafetyScore`), keeping the EPIC 2E-E names as documented deprecated aliases (grep-confirmed unused elsewhere). Ran all 7 required QA scenarios: empty input, default flags, forced-dangerous-flags (export/write/mutation all forced true — `canExportPreview`/`canWriteProduction` still hard-coded `false`; `canGeneratePreview` correctly still `false` because the export/write/mutation gate checks themselves fail when those flags are abnormally enabled — a deliberate fail-closed design, not a bug), complete-technical-gates-but-incomplete-human-review (→ `previewState:"awaiting-human-review"`, `canGeneratePreview:false`), all-gates-and-review-complete (→ `previewState:"preview-ready"`, `canGeneratePreview:true`, `simulatedPreviewPreset.available:true`, export/write still `false`), and a full immutability test (legacyPreset/simulation/safety-clamp/test-gate all byte-identical before/after, `simulatedPreviewPreset` confirmed to be a genuinely new object, never the same reference as `legacyPreset`). Updated `decision-report-engine/index.js` and `reference-transfer-engine/index.js` to read canonical field names directly (not the aliases). Confirmed no calls to preset-engine, xmp-validator, or `mapStyleFingerprintToLightroom` anywhere in the rewritten module (grep-verified); production XMP output byte-identical/deterministic; legacy `decision.styleBudget` unchanged; AI Workflow badge/version unchanged (this patch touched no version metadata); zero console errors | `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js` (full rewrite of the public contract and eligibility logic); additive canonical flags in `mapping-v2-flags.js` (EPIC 2E-E names kept as deprecated aliases); comment-only update in `core/decision-engine/index.js` (no field-access changes needed — it only stores the whole returned object); canonical-field updates in `core/decision-report-engine/index.js` and `core/reference-transfer-engine/index.js`; production `core/lightroom-mapping-engine/index.js` completely untouched |
| EPIC 2E-F Phase A | Controlled Preview Review State Model (standalone) — new `mapping-v2-preview-review-state.js` with 4 exports: `createPreviewReviewStateV2`, `updatePreviewReviewItemV2`, `resetPreviewReviewStateV2`, `evaluatePreviewReviewStateV2`. A pure state machine tracking the 10-item human review checklist (all default "pending", never auto-approved — especially the 6 visual items: source-image/skin-tones/highlights/shadows/white-balance/color-stacking-reviewed). Two-dimension approval: `approvalState` reflects checklist completion only; `canApprovePreview` additionally requires `sandbox.canGeneratePreview===true`. Self-caught bug during build: metadata used to track sandbox readiness via fragile blocker-text matching — fixed by storing `sandboxCanGeneratePreview` as a direct boolean in `metadata` | New `mapping-v2-preview-review-state.js` only, not yet wired into the pipeline |
| EPIC 2E-F-A-F | Preview Review State Consistency Patch — 2 real defensive bugs found and fixed. Bug 1: `{status:"passed", reviewed:false}` was a reachable combination — fixed so a final "passed"/"failed" status always forces `reviewed:true`; an explicit `reviewed:false` override is only honored for pending/unavailable/not-required. Bug 2: the unknown-item-ID code path rebuilt state via `_buildReviewState` with a forced-null sandbox, incorrectly resetting `approvalState` to "unavailable" even on an already-approved state — fixed to deep-clone every field directly from the real current state (no `_buildReviewState`, no JSON stringify/parse round-trip) and add exactly one warning, verified every nested array/object is a genuinely new reference | `mapping-v2-preview-review-state.js` only |
| EPIC 2E-F Phase B | Review State Pipeline Integration — wired `createPreviewReviewStateV2` into `decision-engine/index.js` as the LAST stage (integration order #11, after the Preview Sandbox), attached to `finalStyleIntent.controlledPreviewReviewStateV2`. Added a "Controlled Preview Human Review" Decision Report section (nested under `photographerIntelligence`, matching the existing pattern) and Reference Transfer `reviewStateContext`. Pipeline was stateless at this point — `existingReviewState` always `null` (no caller mechanism existed yet to supply prior progress; that came in EPIC 2E-F-B-F). Bumped to v1.1.5/EPIC 2E-F, sidebar auto-updated via the existing title-splitting script with zero extra code | Integration-only in `core/decision-engine/index.js`; report sections in `decision-report-engine/index.js`/`reference-transfer-engine/index.js`; version bump in `core/project-version.js`/`index.html`; `mapping-v2-preview-review-state.js` itself untouched |
| EPIC 2E-F-B-F | Existing Review State Input Plumbing Patch — confirmed the gap described in Phase B's own comment was real: `buildFinalPreset(inputs)` had no `controlledPreviewReviewStateV2` field and `_buildDecision` had no matching parameter, so a caller genuinely had no way to pass prior review progress in. Added `inputs.controlledPreviewReviewStateV2` (default `null`, documented via JSDoc, fully backward-compatible) → threaded through `_buildDecision`'s new `existingControlledPreviewReviewStateV2` parameter → passed as `existingReviewState` to `createPreviewReviewStateV2`, with the explicit incoming state given priority. Every derived field (approvalState, canApprovePreview, etc.) is still fully recalculated by the engine — nothing in decision-engine copies an approval field from the incoming state. Verified with 14 QA scenarios: no-input backward compat, partial/full/failed/needs-adjustment input, 6 malformed-input shapes (none crashed), unknown/duplicate item IDs, deterministic output | `core/decision-engine/index.js` only |
| EPIC 2E-F Phase C-A | Controlled Preview Review Console UI Foundation — new `ui/review-console-renderer.js` (pure, read-only at this stage — explicitly NO interactive controls yet) rendering the safety strip, review progress, checklist, risk summary, blockers/warnings, rollback status, from the already-computed Sandbox/Review State objects. Self-caught and fixed a real pre-existing defect during this stage: `renderReviewConsole` was already wired with interactive Approve/Reject/Needs-Adjustment buttons calling `updatePreviewReviewItemV2` directly from the UI — this violated the phase's explicit "read-only, no actions yet" contract, so all three buttons and the `onAction` callback were removed, leaving pure DOM display. Confirmed 0 buttons render anywhere; XSS-safe via `textContent`/`createElement` throughout | New `ui/review-console-renderer.js`; wiring in `ui/app.js` (`renderReviewConsoleFromState`, called after analysis and on Reset); new `#reviewConsoleSection`/`#reviewConsoleInner` in `index.html` |
| EPIC 2E-F-C-A-F / F2 | Review Console Honesty and Resilience Patches — two rounds. **F:** fixed a genuine crash bug (`listRow()`'s `appendChild()` threw on a non-Node, non-string value like a numeric `restoreSource`), a circular-reference crash in blocker `JSON.stringify`, a `null`-array-entry crash in `reviewItems`, and the core honesty defect — the safety-strip confirmation lines always showed a green checkmark and fixed wording regardless of what the underlying boolean actually said. Replaced with a tri-state `statusLine()` (Confirmed/Anomaly/Unknown) that never shows a false checkmark for missing or contradictory evidence; also added the previously-missing Preview Risk Review section, full checklist completeness (category/required-optional/reviewer-decision/item-warnings/updatedAt), blocker/warning array-type guards, and `Number.isFinite` progress guards. **F2:** two more real defects found in the SAME areas — the "This preview is non-production" line was STILL hard-coded true regardless of `simulatedPreviewPreset` evidence (fixed with `_evaluatePreviewNonProduction()` reading `mode`/`appliedToProduction`/`productionSafe`, any one contradicting field forces "anomaly"), and the progress-percentage fallback silently showed 0% instead of computing `completed/required*100` when `percentage` itself was invalid (fixed per the spec's exact 3 worked examples, all verified) | `ui/review-console-renderer.js` only, both patches |
| EPIC 2E-F Phase C-B | Interactive Checklist Controls — upgraded the console from read-only to interactive. New `ui/review-console-controller.js`: ONE delegated event-listener set (click/focusout/input) attached ONCE per page session to the persistent `#reviewConsoleInner` container (never re-attached per render, since only its children — not the container itself — are replaced on each render), calling ONLY `updatePreviewReviewItemV2`/`resetPreviewReviewStateV2` from the existing engine (zero approval logic duplicated in the UI). Pass/Fail/Needs-Adjustment/Pending buttons (Fail uses an inline 2-step "Confirm Fail?" pattern, no `window.confirm`), a 500-char reviewer-note textarea (commits on `focusout`), and a Reset Review control (same 2-step confirm pattern) added to the renderer. `buildFinalPreset()` now receives `controlledPreviewReviewStateV2: state.lastPreviewReviewState` so same-image Re-analyze preserves progress/notes (pipeline re-normalizes against the fresh Sandbox); `handleReset()` (called before every new-image import) already cleared this field, so a different image never inherits approval. Self-caught and fixed a real Temporal-Dead-Zone crash during this build: `let reviewConsoleController` was declared AFTER an immediately-invoked `waitForRoot(...)` call whose callback can run synchronously if the DOM root already exists — fixed by moving the declaration ahead of that call. Verified: 0 Export/Apply buttons ever appear even at full approval; technical Sandbox blockers remain visible even when the checklist is 100% complete; XSS injection in notes produces 0 script elements and 0 fired alerts; rapid clicks and 3x Re-analyze + 1 click produce exactly 1 live-region mutation (no duplicate listeners); 44px touch targets confirmed; XMP byte-identical after heavy review interaction | New `ui/review-console-controller.js`; interactive-controls additions to `ui/review-console-renderer.js`; wiring + `buildFinalPreset` input + TDZ fix in `ui/app.js`; new persistent `#reviewConsoleLiveRegion` in `index.html` |
| EPIC 2E-F-C-B-F | Interactive Review Lifecycle Patch — two real interaction bugs found and fixed. **Bug 1:** the controller's transient confirmation state (`pendingConfirm`/`resetConfirmPending`) persists for the whole page session with no clearing mechanism, so a "Confirm Fail?" armed on one image's item could visually reappear on a DIFFERENT image's item sharing the same canonical ID (every image uses the same fixed item-ID set) — fixed with a new public `resetTransientUiState()` method (clears only the transient flags, never touches Review State, never rerenders, never tears down listeners), called from `handleReset()` (new-image import / full reset) but never from `handleReanalyze()`. **Bug 2:** `focusout`'s immediate `rerender()` destroyed the DOM — including the button about to receive a `click` — before that click could ever fire, silently dropping the action whenever a user typed a note and clicked Pass/Fail/etc. without blurring first; fixed with `_isPendingActionControl()`: when focus is moving to another review action control, the note still commits to state immediately but the DOM re-render is deferred to that control's own click handler, producing exactly one final render. Verified against the spec's exact expected sequence (type note → click Pass → `{reviewerNote, status:"passed", reviewed:true, reviewerDecision:"approve"}` in one render) plus the Fail-confirm and Reset sequences, new-image stale-confirmation clearing, Re-analyze regression, rapid clicks, and a duplicate-listener check (still exactly 1 mutation per click) | `ui/review-console-controller.js`, `ui/app.js` |
| Initial Analysis Canvas Layout Fix + Fix-F | Two-stage fix for a first-import canvas sizing bug (unrelated to Review Console, bundled here for the same release). Root cause: the first-import render path used only 1 `requestAnimationFrame` and never waited for `document.fonts.ready` or a settled container width, with a silent `560`px hardcoded fallback on zero-width reads — causing the canvas to render at the wrong size on first import (only "fixed" itself once the user hit Re-analyze, when layout had incidentally settled). Fix-F found and corrected a second-order bug in the first fix: the readiness flow measured the SECTION's border-box width (including 40px+ of padding/border) instead of the canvas's own content width, causing a smaller but still-real overshoot. Final fix: a shared `waitForAnalysisRenderReady()` helper (image.decode → fonts.ready → 2 rAF → bounded container-width retry) plus a `resolveCanvasCssWidth()` resolver that only ever trusts the canvas element's own measured width, never a parent/section rect; `canvas.style.width` kept as responsive `100%` (never a fixed px value); per-element `WeakMap` tracking replaces a single shared `lastWidth` in the `ResizeObserver` (a hidden group's 0-width report can no longer clobber the active group's state). Verified: first-import and Re-analyze produce byte-identical canvas dimensions; DPR 1 and DPR 2 backing-store sizes exact; mobile 390px no overflow; K-Means/analysis values unchanged | `ui/app.js`, `ui/image-analysis-renderer.js`, `ui/palette-renderer.js` |
| EPIC 2E-F Phase D | Documentation + Final Release Check — closed out EPIC 2E-F as a stable, documented, regression-checked release. Bumped to **v1.1.6 (EPIC 2E-F)**, title "Lightroom Mapping V2 — Controlled Preview Human Review", status "Legacy Active · Human Review Console Ready · XMP Unchanged". Self-caught and fixed a real, multi-EPIC-old stale-version bug during this stage's version-consistency audit: the header/footer/sidebar static HTML fallback text had been silently stuck at **"v1.1.4 (EPIC 2E-E)" / "Legacy Active · Preview Sandbox Ready"** since before Phase B — undetected because the dynamic `project-version.js`-driven script always overwrote it correctly in a working browser, masking the stale fallback in every normal session; also found the `upgradedSystems` static `<li>` list was missing "Controlled Preview Human Review" and "Interactive Review Console" entirely. All fixed and re-verified in-browser (header/footer/sidebar all agree on v1.1.6). Ran the full 15-point release QA audit (syntax, import/export, pipeline order, default safety, dangerous-flag override attempts, Review State engine full test matrix, UI interaction suite, Re-analyze/new-image lifecycle, canvas regression, production isolation, XMP byte-identical regression, mutation/immutability, storage audit, UI version audit) — see `08_EPIC_2E_F_QA_REPORT.md` for full evidence. Added `06_EPIC_2E_F_RELEASE_NOTES.md` and `07_CONTROLLED_PREVIEW_REVIEW_ARCHITECTURE.md` | `core/project-version.js`, `index.html` (version bump + stale-text fixes only — no layout/structure changes); new docs; no other source files modified |
| EPIC 2E-G Phase A | Side-by-Side Preview Comparison Data Model — new standalone `mapping-v2-side-by-side-comparison.js` exporting `buildSideBySidePreviewComparisonV2(input)`, comparing Legacy Mapping data against the V2 Controlled Overlay Preview Sandbox across 15 abstract dimensions (tonal balance, exposure/contrast direction, highlight/shadow protection, white balance/saturation direction, color separation, skin protection, color stacking, over-stack severity, capture compatibility, style/intent alignment, safety confidence). Not integrated into the pipeline yet (Phase A explicitly standalone). `canCompareVisually`/`selectedProductionSource` hard-coded `false`/`"legacy"` — this codebase has no image-rendering pipeline anywhere, so this module produces DATA comparisons only, never a fake or real rendered preview image. 20 QA scenarios passed including empty/partial/malformed input, full immutability (no `JSON.stringify`/`parse` cloning — object spread only) | New `core/lightroom-mapping-engine/mapping-v2-side-by-side-comparison.js` only |
| EPIC 2E-G-A-F | Side-by-Side Comparison Honesty and Resilience Patch — 6 real bugs found and fixed. Malformed-array safety (`?? []` doesn't guard non-null truthy non-arrays like strings — added `_safeArray()` everywhere). Visual-review-complete honesty (Map-keyed-by-canonical-ID check requiring all 6 items present/passed/reviewed, replacing a `[].every()` that was vacuously `true` on empty/partial sets). Data-availability vs. visual-renderability separation (`canRenderLegacyPreview`/`canRenderV2Preview` were incorrectly derived from `.available` — now hard-coded `false` with new `dataAvailable`/`visualPreviewAvailable` fields added to distinguish the concepts). Hard-stop normalization (`_normalizeHardStopCount()`/`_mergedHardStopCount()` supporting array/number/boolean/`{count}`/`{active}`, merged from both `lightroomSafetyClampV2` and `sandbox.previewRiskReview` via the greater confirmed count). V2-safer-claim honesty (`saferSide` could become `"v2"` from a strong V2 score alone while `legacySafetyScore` was always `null` — fixed to stay `"uncertain"` unless comparable Legacy evidence exists). Full null-safe contract audit | `mapping-v2-side-by-side-comparison.js` only |
| EPIC 2E-G-A-F2 | Human Review Metadata Recalculation Patch — confirmed and fixed a genuine contradictory-output bug: `_buildHumanReviewStatus` still trusted incoming top-level `approvalState`/`canApprovePreview`/`reviewProgress`, so `{approvalState:"approved", canApprovePreview:true, visualReviewComplete:false}` was a reachable, self-contradicting combination when `reviewItems` were actually partial/unreviewed. Fixed by recalculating `approvalState`/`canApprovePreview`/`completed`/`required`/`progress` exclusively from canonical `reviewItems` (never trusting incoming top-level fields as source of truth — they're preserved only in a new `metadata.{incomingApprovalState,incomingCanApprovePreview,incomingProgress}` field, with warnings raised on disagreement) | `mapping-v2-side-by-side-comparison.js` only |
| EPIC 2E-G-A-F3 | Review Decision Priority Patch — confirmed and fixed a real priority-ordering bug: `canonicalFailed` was checked before `canonicalRejected`, so a normal Fail action (which the Review Console always produces as `{status:"failed", reviewerDecision:"reject"}` together) incorrectly reported `approvalState:"blocked"` instead of `"rejected"`. Reordered to reject → needs-adjustment → blocked → approved → in-progress; `"blocked"` is now reserved for a failed item with no explicit reject decision | `mapping-v2-side-by-side-comparison.js` only |
| EPIC 2E-G Phase B | Side-by-Side Comparison Pipeline Integration — wired `buildSideBySidePreviewComparisonV2` into `decision-engine/index.js` as integration order #12 (after Preview Sandbox #10 and Review State #11), attached to `finalStyleIntent.sideBySidePreviewComparisonV2`. **Key architectural finding**: unlike stages #1–#11, this could NOT be built inside `_buildDecision()` — the real production Legacy preset (`mapped`, with actual `exp`/`con`/`hi`/`sh`/etc. from `mapStyleFingerprintToLightroom`) doesn't exist until AFTER `_buildDecision()` returns — so it's built in `buildFinalPreset()` itself, right after `mapped` is computed, mutating the SAME `decision.finalStyleIntent` object reference `_buildDecision()` already returned (verified this makes it automatically visible to Decision Report/Reference Transfer with zero rebuild). Wrapped in try/catch, falling back to the engine's own safe empty-input result (never a hand-duplicated shape) on any exception. Added a "Side-by-Side Preview Comparison" Decision Report section and a `sideBySideComparisonContext` Reference Transfer compact context (confirmed `reference-transfer-engine` never rebuilds `finalStyleIntent` — pure pass-through, so the canonical object is preserved automatically without needing this addition, which exists only for consistency with the established per-object-context pattern). 18 QA scenarios passed; XMP byte-identical (length 2962) before/after | `core/decision-engine/index.js`, `core/decision-report-engine/index.js`, `core/reference-transfer-engine/index.js` |
| EPIC 2E-G-B-F | Comparison Report Safety Evidence Patch — 2 real honesty bugs found and fixed in the Decision Report section added by Phase B. `previewExportDisabled`/`productionWriteDisabled` defaulted to `true` ("confirmed safe") whenever `controlledOverlayPreviewSandboxV2` was simply missing — fixed to tri-state (`sandbox ? sandbox.canExportPreview === false : null`), never defaulting missing evidence to a false safety claim. `xmpUnchanged: true` was hard-coded, implying an actual runtime XMP regression comparison had been performed when this integration only proves the comparison module has no XMP write path — replaced with `xmpIsolation: {comparisonModuleHasNoWritePath:true, regressionVerified:false, status:"structurally-isolated"}`, keeping `xmpUnchanged` for backward compat but permanently `null`. Also found and fixed a self-introduced `ReferenceError` (undefined `_isRecordLike` helper — `node --check` doesn't catch this class of runtime-only reference error) during this same patch, caught via the QA run before delivery | `core/decision-report-engine/index.js` only |
| EPIC 2E-G Phase C | Side-by-Side Comparison UI Foundation — new `ui/side-by-side-comparison-renderer.js`, a pure read-only display of the canonical comparison object: visual-honesty banner (tri-state Production Mapping/Preview Export/Production Write confirmations — same pattern as the Review Console's safety strip), Legacy/V2 summary cards, all 15 comparison dimensions, similarity/divergence summaries, safety/risk comparisons, evidence quality, Human Review status (with exactly ONE interactive element in the whole module — a "Go to Review Console" scroll-only navigation button, never a comparison-changing control), blockers/warnings/recommendations, rollback/fallback, and a collapsible developer-details `<details>` panel. New `#sideBySideComparisonSection` placed directly after the Review Console in `index.html`, following the exact same show/hide/clear lifecycle pattern in `ui/app.js`. 25 QA scenarios passed: zero crashes across 13 malformed-input shapes, zero XSS execution, no duplicate sections across Re-analyze/new-image cycles, all 5 empty states verified, mobile 390px no overflow | New `ui/side-by-side-comparison-renderer.js`; `ui/app.js` (render integration + lifecycle); `index.html` (new section) |
| EPIC 2E-G-C-F | Comparison UI Honesty and Resilience Patch — 7 real bugs found and fixed. Empty-state logic bug (`!_isRecord(cmp.legacyPreview)?.dataAvailable` — `_isRecord()` returns a boolean, and optional-chaining `.dataAvailable` off a boolean is always `undefined`, making the condition a permanent no-op — fixed using the already-normalized `legacyDataAvailable`/`v2DataAvailable` values, extracted before use). Safety banner completeness (`statusLine()` extended to a real tri-state confirmed/anomaly/unknown; added the previously-missing Preview Export and Production Write rows). Unknown-vs-zero safety counts (`hardStops`/`criticalRisks` now show "Unknown" when missing instead of a dishonest silent `0`, while an explicit numeric `0` still displays `0`). Human Review normalization (`approvalState` validated against a 7-value allow-list; "Progress unavailable" replaces a dishonest silent `0/0` on malformed `completed`/`required`). Removed arbitrary-object JSON dumping from `_safeText()` (now tries known keys — `message`/`reason`/`summary`/`label`/`description`/`finding`/`text`/`warning`/`blocker` — before a neutral non-technical fallback; 500-char truncation). `"none"` no longer silently maps to `"low"` risk (this UI-layer rule is intentionally stricter than the core engine's own synonym handling — an unrecognized risk string here is always `"unknown"`). File-comment corrected to acknowledge the one existing navigation button | `ui/side-by-side-comparison-renderer.js` only |
| EPIC 2E-G-C-F2 | Final Comparison UI Evidence Semantics Patch — 2 real semantic bugs found and fixed. `appliedToProduction` (meaning "not currently applied") was being used as proof that Production Write is explicitly disabled — a genuinely different concept; fixed to prefer a canonical `canWriteProduction` boolean (checked at both the comparison root and `v2Preview`, forward-compatible since no current engine output has this field yet, so it honestly shows "Unknown / Not confirmed" today), with a separate honestly-labeled "Production Application" row shown only when `canWriteProduction` is unavailable but `appliedToProduction` is. Developer Details no longer defaults missing `selectedProductionSource` to `"legacy"` or missing `canRender*`/`canCompareVisually` booleans to `false` — both are now genuinely tri-state. **Self-caught bug during this same patch**: the first edit deleted the `appliedToProduction` variable declaration while a later `if` block still referenced it via `typeof appliedToProduction === 'boolean'` — since `typeof` never throws on an undeclared variable (it silently evaluates to `"undefined"`), this did NOT crash, but *would* have made the new "Production Application" row permanently unreachable; caught via direct QA testing (not by `node --check`, which cannot catch this class of bug) and fixed by restoring the declaration before delivery | `ui/side-by-side-comparison-renderer.js` only |
| EPIC 2E-G Phase D | QA, Documentation & Release Closeout — closed out EPIC 2E-G as a stable, documented, regression-checked release. Bumped to **v1.1.7 (EPIC 2E-G)**, title "Lightroom Mapping V2 — Side-by-Side Data Comparison", status "Legacy Active · Comparison Console Ready · Visual Preview Pending · XMP Unchanged". Version-consistency audit found (again) that the static HTML title fallback ("Lightroom Mapping V2 — Overlay Preview Sandbox") had drifted even further back than the EPIC 2E-F Phase D finding — it had NEVER been updated across the entire EPIC 2E-F cycle either, despite the dynamic script correctly overwriting it every session; also found the `upgradedSystems` static `<li>` list missing "Side-by-Side Data Comparison"/"Data-level Legacy vs. V2 Analysis". Both fixed and re-verified live (header/footer/sidebar all agree on v1.1.7). Ran the full 16-point release QA audit (syntax ×2 methods, import/export, pipeline order — confirming Side-by-Side is built in `buildFinalPreset()` itself, not `_buildDecision()`, specifically because it needs the real `mapped` Legacy preset that doesn't exist yet inside `_buildDecision()` — default safety, 5 data-availability + 11 human-review + 7 safety test scenarios, Decision Report, Reference Transfer, UI, visual honesty, production isolation, XMP byte-identical regression, mutation/immutability, storage audit, version audit) — see `11_EPIC_2E_G_QA_REPORT.md` for full evidence. Added `09_EPIC_2E_G_RELEASE_NOTES.md` and `10_SIDE_BY_SIDE_COMPARISON_ARCHITECTURE.md` | `core/project-version.js`, `index.html` (version bump + stale-text fixes only); new docs; no other source files modified |

(A second, contradicting "Current Version" section that referenced the
stale "Stage 2.4.2B.2" scheme from EPIC 1.1 was removed here during the
EPIC 2E-G Phase D documentation audit — it duplicated and directly
contradicted the single "Current Version" section above, which already
states that scheme is no longer tracked.)

## Current Architecture (one-line summary)

Reference Image → parallel analysis engines (15 pixel-analysis modules,
see `04_PROJECT_ARCHITECTURE.md` for the exact, verified module
breakdown) → Feature Fusion → Style Feature Graph → Style Fingerprint →
Decision Engine (Photographer Intelligence: Style Vocabulary/DNA/
Validation/Feasibility-estimate) → Lightroom Mapping Engine (the only
slider-value computer) → Pre-XMP Validation (×2 passes) → Style Benchmark
→ Decision Report → Reference Transfer Intelligence (authoritative
confidence/complexity/feasibility) → XMP Export. Full diagram in
`04_PROJECT_ARCHITECTURE.md`.

**Since EPIC 1.1**, a parallel, not-yet-wired-in
`core/calibration-registry` mirrors 87 of the weights/thresholds scattered
across the above engines into one centralised, self-validating,
explainable catalogue — no engine currently reads from it (see
`docs/development/EPIC-01.1_Calibration_Registry_Foundation.md`).

## Known Risks (carried forward from stage-level reasoning, still
## applicable to the current code)

- **Every scoring formula's weights/thresholds are hand-reasoned, not
  learned or tuned against a large labelled sample** — this applies
  uniformly across Style Fingerprint confidence, Feature Fusion conflict
  thresholds, Decision Engine trust weighting, Style Benchmark scoring,
  Reference Transfer complexity/feasibility scoring, and Style Budget's
  `BUDGET_SCALE`/`ENGINE_PRIORITY_WEIGHT` constants.
- **17-style vocabulary has inherent overlap** for visually-similar looks
  (Korean Clean vs. Japanese Soft vs. Muted Lifestyle in particular) —
  distinguished only by coarse warmth/cast/saturation thresholds.
- **Style DNA element vocabulary doesn't fully overlap between
  conceptually related styles** (e.g. Airy Wedding's "Soft Contrast" vs.
  Clean Portrait's "Balanced Contrast" are semantically close but
  distinct strings), which can push computed Style Distance toward 0 or 1
  more than a human would judge two related looks to actually be.
- **Style DNA Validation rules exist for only 8 of 17 styles**; the
  remaining 9 rely on generic checks only (no style-specific
  required/forbidden combinations).
- **Style Feasibility rules exist for only 5 of 17 styles**; the
  remaining 12 get accurate generic scoring but no style-specific
  nuance.
- **Preliminary and authoritative versions of the same concept can
  diverge** (documented, by design) — a consumer reading only the
  Decision Report's preliminary `styleFeasibilityEstimate` will
  sometimes see a number Reference Transfer later revises.
- **Four input signals the Style Feasibility spec originally asked for
  (`finalStyleIntentConfidence`, full `referenceComplexity`, validation
  warnings, `photographerAcceptance`) remain structurally unavailable at
  Decision Engine time** due to pipeline ordering — this is an accepted,
  documented architectural constraint, not an oversight.
- **The Image Preview Viewer's centering logic uses a hard-coded padding
  constant (32px)** that must be kept in sync manually if the viewer's
  CSS padding is ever changed.
- **Zoom is architected for (`--lx-zoom` CSS variable) but not
  implemented** — no zoom UI exists yet.
- **No automated regression test suite exists.** All verification to
  date has been manual, via Playwright-driven browser sessions per
  development stage — there is no CI or repeatable test file checked
  into this package.
- **The new calibration registry (EPIC 1.1) is descriptive, not
  enforced.** No engine currently reads from it — its 87 mirrored values
  can silently drift out of sync with the engines' own constants over
  time until a future stage actually migrates an engine to read from it.
- **Reference Color Match (EPIC 1.2) was specified as TypeScript/React
  but implemented as plain ES modules** to preserve the project's
  no-build-step architecture — a deliberate, documented deviation (see
  `docs/development/EPIC-01.2_Reference_Color_Match_Engine.md`). If a
  build toolchain is genuinely wanted later, that is an unmade
  architecture decision, not an oversight.
- **Reference Color Match's before/after preview is an approximate
  per-pixel simulation**, not colour-accurate to what Lightroom will
  actually render from the exported XMP.
- **Reference Color Match is entirely independent of Photographer
  Intelligence** (Style Vocabulary/DNA/Validation/Feasibility) — no style
  label, DNA, or feasibility score is computed for a Reference Color
  Match export. Integrating the two was not attempted.
- **(EPIC 1.3) The Reference Color Match ↔ main pipeline UI connection
  does not exist yet** — `referenceColorIntelligence` is a tested,
  working capability in Decision Engine, but no UI flow currently passes
  "the image I analyzed in Reference Color Match" into the main
  pipeline's `buildFinalPreset` call (`ui/app.js` was outside EPIC 1.3's
  allowed directories). A future stage would need to bridge this UI gap.
- **(EPIC 1.3) `styleHints`' colour-mood rule table can misclassify
  overlapping moods** (one concrete Luxury-Wedding-vs-High-Key tie was
  found and fixed; others may exist untested) and its colour-naming
  heuristic degenerates on very low-colour-variety images (observed:
  "Brown + Brown" on a flat-colour synthetic test).
- **(EPIC 1.4) 19 hand-written intent profiles inevitably overlap** —
  only the 8 named conflict pairs from the spec have been individually
  verified with isolated synthetic tests; other overlapping pairs (e.g.
  Dreamy vs. Romantic) likely exist untested.
- **(EPIC 1.4) `photographerIntent` is read-only** with respect to Style
  DNA/Feasibility/Lightroom Mapping — it doesn't yet inform Style Budget
  or any slider computation, per this stage's explicit constraints. No
  UI panel displays it yet either (report-level integration only).
- **(EPIC 1.5) Family resolution can tie** when detected intents spread
  evenly across families with no clear majority — reported honestly via
  `alternativeFamilies` but no explicit ambiguity warning is raised yet
  (unlike Style Vocabulary's own ambiguous-style warning).
- **(EPIC 1.5) `INTENT_STYLE_SUPPORT` only covers 6 of the now-21
  intents** — sparse by design (no invented relationships), but worth
  knowing when reading an empty `supportingIntents` array.
- **(EPIC 1.5) `Elegant`/`Commercial` are new intents added only to
  complete the family membership system** — not independently requested
  as detectable intents, and not tested as extensively as the original
  19.
- **(EPIC 1.5) Intent Strength formula weights are newly hand-reasoned**,
  not tuned against any labelled "how dominant does this look read"
  ground truth.
- **(EPIC 1.6) `INTENT_CAPABILITY_REQUIREMENTS` covers only 10 of 21
  intents** — the rest use a generic overall-score-only check.
- **(EPIC 1.6) The preliminary `captureCapabilityEstimate` (Decision
  Engine) always lacks real noise/sharpness data** — its
  `noiseTolerance` is a neutral guess until the authoritative
  `captureCapability` (Reference Transfer Report) supersedes it. Code
  reading the preliminary estimate alone should treat noise-related
  fields with reduced trust.
- **(EPIC 1.6) `captureBudgetHints` are explicitly inert** — nothing
  reads them back into any decision yet; EPIC 1.7 is the stage that
  would need to consume them.
- **(EPIC 1.6) `core/image-analysis/` is a NEW directory**, distinct
  from the pre-existing `core/image-analysis-core/` — the spec named the
  former but only the latter existed; created fresh per the same
  "new aggregation module, not a new analysis engine" precedent EPIC 1.3
  established.
- **(EPIC 1.7) Calibration Registry was not read from** — its 12
  existing `style-budget`-category entries belong to the unrelated
  legacy Stage 2.4C system; no new keys were added for the new 11
  budget dimensions.
- **(EPIC 1.7) `INTENT_BUDGET_ALLOCATION` only has 6 hand-written
  entries** (of 21 intents) — the rest rely on family-level fallback.
- **(EPIC 1.7) `DNA_BUDGET_RULES` covers 13 named DNA elements** — DNA
  elements outside this list are silently ignored (correct, but partial
  coverage).
- **(EPIC 1.7) `styleBudgetIntelligence` is entirely inert w.r.t.
  Lightroom Mapping** — a future "Lightroom Mapping V2" stage (named in
  this EPIC's own architecture diagram) would need to be built before
  this budget affects any slider value. That stage does not exist yet.
- **(EPIC 1.7F) `overallBudget`'s high-budget threshold (0.54) was
  empirically calibrated against this system's own 6 named intent
  allocations** — if future stages add many more named intent
  allocations with substantially different weight totals, this
  threshold may need re-calibration.
- **(EPIC 1.7F) `noiseReliability` can only distinguish "measured" from
  "estimated" by pattern-matching a specific warning string** that
  `capture-capability-model.js` (EPIC 1.6) emits — there is no dedicated
  field for this. If that warning's wording changes in a future stage,
  this detection would silently stop working; a more robust approach
  would be a dedicated boolean/enum field on `captureCapability` itself.
- **(EPIC 2A) `lightroomMappingPlanV2` is shadow-only and has zero
  consumers** — it is attached to `finalStyleIntent` purely for future
  shadow-compare analysis; nothing in production mapping or XMP export
  reads it (verified via grep — the planner is referenced nowhere inside
  `core/lightroom-mapping-engine/index.js`). A future EPIC 2B+ stage
  would need to (a) shadow-compare this plan against real legacy mapping
  output across a representative image set, (b) get human review of
  protected-area/avoided-tool coverage, and (c) build the actual
  abstract-plan-to-slider-value translation layer — none of which exist
  yet.
- **(EPIC 2A) Intent/DNA plan guidance covers 6 named intents + a Green
  Pastel DNA special case** — every other intent falls back to family-
  level or generic conservative guidance, same coverage-limitation
  pattern as EPIC 1.7's own `INTENT_BUDGET_ALLOCATION`.
- **(EPIC 2A) The planner's `readiness`/`confidence` weightings are
  newly hand-reasoned**, consistent with every other scoring system in
  this project — not validated against real shadow-compare data since
  none has been run yet (that is explicitly the next required step
  before any activation, per `fallbackStrategy.requiredBeforeActivation`).
- **(EPIC 2B) `lightroomTranslationV2` is shadow-only and has zero
  consumers**, same as EPIC 2A's planner — `fallbackStrategy.
  useLegacyMapping` stays `true` even when `readiness` reaches
  "ready-for-controlled-activation"; reaching that readiness level is
  informational only and does not itself trigger anything.
- **(EPIC 2B) Intent/tool guidance covers the same 6 named intents +
  Green Pastel DNA special case as EPIC 2A's planner** — same
  family/generic-fallback coverage limitation.
- **(EPIC 2B) The AI Workflow version badge is rendered dynamically from
  `core/project-version.js`** via a small additive `<script type="module">`
  in `index.html` that imports `AI_WORKFLOW_VERSION` and writes it into
  the badge's DOM elements on load — genuinely a single source of truth,
  not hand-duplicated text. The script is defensive (wrapped in
  `.catch()`); if the import ever fails, the static fallback text already
  present in the HTML markup remains visible and correct as of this EPIC.
- **(EPIC 2B) Translation confidence/readiness weightings are newly
  hand-reasoned**, same caveat as EPIC 2A — not validated against real
  shadow-compare data.
- **(EPIC 2C) `lightroomSafetyClampV2` has zero consumers**, same as the
  planner/translator before it — `activationGate.canActivate` is
  hard-coded `false` and cannot be flipped by any input; reaching
  `eligible-for-shadow-compare`-equivalent readiness is informational
  only.
- **(EPIC 2C) The 10 over-stack patterns and clamp-profile
  thresholds/penalties are newly hand-reasoned**, consistent with every
  other scoring system built across this project — not validated against
  real shadow-compare data or real edited photos.
- **(EPIC 2C) `toolCaps[]` only covers tools present in the translation's
  own `targetRangeHints`** (mapped via a fixed tool-name lookup) — if a
  future translator version renames or adds tool categories, this
  mapping would need a matching update to keep producing caps for them.
- **(EPIC 2C-F) Patch 2's `minIntensity > maxIntensity` scenario is not
  reproducible through the current translator's own output** — its
  ranges always start at 0-0.1, comfortably below every clamp-profile
  floor (0.25-0.40). The fix is verified correct via a direct
  mock-translation test, but has not (and currently cannot) been
  exercised by the real pipeline; it exists as forward-looking defensive
  coverage in case a future translator or a different caller ever
  supplies a higher starting `minIntensity`.
- **(EPIC 2D) `legacySummary.available` is `false` when Shadow Compare is
  called from `core/decision-engine`** — legacy mapping's real slider
  output (`mapStyleFingerprintToLightroom()`'s return value) isn't
  computed yet at that point in the pipeline (same circular-dependency
  shape this project has hit repeatedly for Style Feasibility/Capture
  Capability/Style Budget). A future stage could pass the legacy mapping
  output in from `buildFinalPreset()` itself (after mapping runs) for a
  fuller legacy comparison, but that wiring doesn't exist yet.
- **(EPIC 2D) `comparisonMatrix`/`alignmentScores`/`safetyDelta`
  thresholds and weights are newly hand-reasoned**, consistent with
  every other scoring system built across this project — not validated
  against real edited photos or real shadow-compare data.
- **(EPIC 2D) `lightroomShadowCompareReportV2` has zero consumers beyond
  its own Decision Report/Reference Transfer Report narration** —
  `activationReadiness.canProceedToControlledActivation` is hard-coded
  `false` and cannot be flipped; EPIC 2E (the stage that would actually
  act on this report) does not exist yet.
- **(EPIC 2D-F) The `safer-estimate` threshold (≥2 concrete safety
  improvements + all guards clear) is newly hand-reasoned** — not tuned
  against any real-world "was V2 actually safer" ground truth, since none
  exists yet. It is a conservative default by design, not a validated one.
- **(EPIC 2D-F) The "2 static baseline blockers" assumption is specific
  to Safety Clamp's CURRENT wording** — if a future EPIC changes how many
  phase-level blockers Safety Clamp always includes, `_buildSafetyDelta`'s
  `extraBlockersCount` calculation would need a matching update to avoid
  either over- or under-counting real risk signals.
- **(EPIC 2E-A) The "human review completed" gate is permanently
  `passed: false`** by design — there is no mechanism anywhere in this
  codebase that can mark it complete. This is intentional (human sign-off
  cannot be automated), but means a genuine future activation path will
  require either a new, explicit human-review-recording mechanism or a
  deliberate code change to how that specific gate is evaluated — neither
  exists yet.
- **(EPIC 2E-A) Gate thresholds (`minGlobalSafetyScore: 0.75`,
  `minShadowAlignment: 0.65`, `minActivationConfidence: 0.72`,
  `maxAllowedOverStackSeverity: "medium"`) are newly hand-reasoned**,
  consistent with every other threshold set across this project — not
  validated against real activation outcomes, since no real activation
  has ever occurred.
- **(EPIC 2E-A) `lightroomControlledActivationV2` has zero production
  consumers** — `canUseV2`/`selectedMappingSource` are read only by the
  Decision Report and Reference Transfer Report narration added in this
  stage; nothing in `core/lightroom-mapping-engine/index.js` or the XMP
  generator reads this object in any way (confirmed via grep).
- **(EPIC 2E-B) `legacyRiskReview`'s thresholds for classifying legacy
  preset values as "risky" (e.g. highlight/shadow magnitude cutoffs) are
  newly hand-reasoned**, same caveat as every other threshold set in this
  project — not validated against real edited photos.
- **(EPIC 2E-B) `overlayClampPlan.canApply` and `suppressedLegacyRisks[].active`
  are intentionally hard-coded `false` independent of the outer
  `canApplyOverlay` gate** — this is a deliberate double-guarantee (the
  overlay's OWN internal "would touch production" flags never trust the
  gate result), but means a genuine future activation of the overlay
  would require a second, explicit code change to those two hard-coded
  values, not just a flag flip.
- **(EPIC 2E-B) `legacySafetyOverlayV2` has zero production consumers** —
  read only by Decision Report/Reference Transfer Report narration;
  nothing in `core/lightroom-mapping-engine/index.js` or the XMP
  generator reads this object (confirmed via grep).
- **(EPIC 2E-C) `legacyInputSummary`'s risk-classification thresholds and
  `simulatedRiskBefore`/`After`/`Delta` estimates are newly
  hand-reasoned** — same caveat as every other threshold set in this
  project, not validated against real edited photos.
- **(EPIC 2E-C) `legacyOverlaySimulationV2` has zero production
  consumers** — read only by Decision Report/Reference Transfer Report
  narration; `canApplyToProduction` is hard-coded `false` and cannot be
  changed by any input or flag combination in this stage.
- **(EPIC 2E-C) The `allowLegacySafetyOverlay` flag from EPIC 2E-A
  remains in `mapping-v2-flags.js` as a documented-but-unused
  deprecated alias** — confirmed zero references anywhere in the
  codebase (grep-verified). A future cleanup could remove it once
  confirmed nothing external depends on the flag object's exact shape,
  but it was deliberately left in place per this stage's "do not remove
  unless clearly unused and safe" instruction, with a clear comment
  pointing to the canonical `enableLegacySafetyOverlay`.
- **(EPIC 2E-D) The "human review completed" gate is permanently
  `passed:false` by default** (same design as EPIC 2E-A's activation
  gate) — there is still no mechanism anywhere in this codebase that can
  mark it complete. A real controlled-test path needs either a new,
  explicit human-review-recording mechanism or a deliberate future flag
  change (`requireHumanReviewForOverlayTest:false`), neither of which
  exists as a real pathway today.
- **(EPIC 2E-D) Test-gate thresholds
  (`minOverlayTestConfidence:0.72`, `minOverlayTestSafetyScore:0.75`,
  `minOverlaySimulationConfidence:0.6`,
  `minOverlaySimulationSafetyScore:0.65`) are newly hand-reasoned** —
  same caveat as every other threshold set in this project, not
  validated against any real controlled-test outcome, since none has
  ever run.
- **(EPIC 2E-D) `controlledOverlayTestGateV2` has zero production
  consumers** — read only by Decision Report/Reference Transfer Report
  narration; `canWriteProduction` is hard-coded `false` and cannot be
  changed by any input or flag combination in this stage.
- **(EPIC 2E-E) Preview risk classification (`legacyPreviewInput.riskLevel`,
  `previewRiskBefore`/`After`/`Delta`) uses newly hand-reasoned
  thresholds** — same caveat as every other threshold set in this
  project, not validated against real edited photos.
- **(EPIC 2E-E) `previewPresetShadow.changes[].intensity` values are
  derived from a fixed severity→intensity mapping (critical→0.85,
  high→0.65, medium→0.45, low→0.25)** — a simple, hand-chosen scale, not
  tuned from any real preset data. It exists only to give the abstract
  preview object a normalized 0-1 number per change, never a real slider
  value.
- **(EPIC 2E-E) `controlledOverlayPreviewSandboxV2` has zero production
  consumers** — read only by Decision Report/Reference Transfer Report
  narration; `canExportPreviewXMP`/`canWriteProduction` are hard-coded
  `false` and cannot be changed by any input or flag combination in this
  stage.
- **(Process note, EPIC 2E-E) A stale hand-edited sidebar fallback string
  ("v1.1.3 · Overlay Test Gate" from the EPIC 2E-D patch) was caught and
  fixed during this stage's QA pass** — a reminder that static HTML
  fallback text for version displays needs the same "search for stale
  versions" grep discipline applied at the START of every version-bump
  EPIC, not just the end, since a manual edit in one stage can silently
  drift from the dynamic value in the next.
- **(EPIC 2E-E-F) The backward-compatible aliases
  (`sandboxState`/`canCreatePreview`/etc.) are computed once and copied
  onto the result object, not re-derived independently** — this
  guarantees they can never drift from the canonical fields, but any
  future removal of the canonical fields would need the aliases removed
  or re-pointed in the same change.
- **(EPIC 2E-E-F) `humanReviewState` is an optional, unvalidated
  pass-through input** — this module trusts whatever `'passed'`/`'failed'`
  values a caller supplies per checklist item; there is still no actual
  human-review-recording mechanism anywhere in this codebase (same open
  item as EPIC 2E-A/2E-D's human-review gates) — a real integration would
  need a genuine review-recording system to populate this map honestly.
- **(EPIC 2E-F, all sub-stages) Preview is not Lightroom-accurate** —
  `simulatedPreviewPreset.changes[]` are abstract, normalized 0-1
  intensity values on a hand-chosen severity scale, never real slider
  values; the Preview Console shows risk/status information, not a
  rendered image preview of what the change would visually look like.
- **(EPIC 2E-F Phase C-B onward) Human Review is entirely manual and
  in-memory only.** There is still no automated verification that a
  reviewer's Pass/Fail decision is correct — approval is only ever a
  recorded human judgment. Review State lives in
  `state.lastPreviewReviewState` in `ui/app.js` for the lifetime of the
  page; refreshing the browser loses all review progress with no
  warning (no persistence exists by design, per this phase's explicit
  "no local storage yet" requirement).
- **(EPIC 2E-F) Approval never activates anything.** Even a fully
  "approved" Review State (`canApprovePreview:true`) does not enable
  Preview Export, Production Write, or Mapping V2 activation — those
  three booleans remain hard-coded `false` inside
  `mapping-v2-overlay-preview-sandbox.js` itself, independent of any
  flag or Review State value. Preview Export itself is not implemented
  anywhere in this codebase; there is no code path that could write a
  Preview object to a `.xmp` file even if every gate were satisfied.
- **(EPIC 2E-F) Production Mapping V2 is not activated** and has no
  activation path — Legacy Mapping (`decision.styleBudget` →
  `core/lightroom-mapping-engine/index.js`) remains the sole producer of
  XMP output through this entire EPIC; the V2 shadow pipeline
  (`finalStyleIntent.*`) has zero production consumers, confirmed via
  repeated grep audits across every sub-stage.
- **(EPIC 2E-F) All Preview Risk Review and human-review-gate
  thresholds remain hand-calibrated**, same caveat as every other
  threshold set in this project (see EPIC 2E-A through 2E-E-F entries
  above) — none of it has been validated against real edited photos or
  a real reviewer's judgment.
- **(EPIC 2E-F) Real-image regression testing is still required.** All
  QA in this EPIC used synthetic test images/inputs (solid-color JPEGs,
  hand-built mock analysis objects) — no test has run against a diverse
  set of real photographer-submitted images.
- **(EPIC 2E-F) Mobile layout has been verified only at the 390px
  Playwright viewport**, not on real physical devices — ongoing
  real-device testing is still recommended before treating mobile
  support as fully proven.
- **(EPIC 2E-F) No automated full-browser test suite exists** — every
  QA pass in this EPIC (including this Phase D release audit) was a
  manual, one-time Playwright script written and run for that specific
  patch; there is no persisted, re-runnable regression suite checked
  into the repository.
- **(Phase D — release process note) Static HTML version-fallback text
  had silently drifted for at least 4 sub-stages (stuck at "v1.1.4
  (EPIC 2E-E)" since before Phase B) before being caught in this
  release's version-consistency audit** — the dynamic
  `project-version.js`-driven script always overwrote it correctly in a
  working browser session, which is exactly why the drift went
  unnoticed for so long: the bug is only visible if the module import
  ever fails, or via direct source grep. This reinforces the existing
  "grep for stale versions at the START of every version-bump stage"
  lesson (first noted at EPIC 2E-E) — it needs to be a mandatory
  release-audit step, not just a start-of-stage courtesy, since a
  silent multi-stage drift is easy to miss without one.
- **(EPIC 2E-G, all sub-stages) No actual Legacy or V2 image preview
  exists.** The comparison is entirely data-level — abstract dimension
  comparisons, normalized similarity/divergence scores, risk-level
  labels — never a rendered image. There is no Before/After slider, no
  zoom, no synchronized pan; none of this exists anywhere in the
  codebase yet.
- **(EPIC 2E-G) Similarity/divergence values may be qualitative, not
  measured.** Several of the 15 comparison dimensions (style alignment,
  intent alignment, capture compatibility) have no real magnitude to
  compare — Legacy Mapping never consults Photographer Style/Intent/
  Capture-Capability data at all, so these dimensions are honestly
  low-confidence/qualitative rather than precisely measured.
- **(EPIC 2E-G) No Lightroom-accurate rendering exists or is planned
  for this EPIC** — even a future visual-preview implementation (see
  "Next Recommended EPIC" below) would need to explicitly avoid
  claiming pixel-perfect Lightroom accuracy.
- **(EPIC 2E-G) Side-by-Side approval does not activate output** — same
  guarantee as EPIC 2E-F's Review Console: `canApprovePreview`
  becoming `true` structurally cannot enable Preview Export, Production
  Write, or Mapping V2 activation, since those booleans are hard-coded
  false inside `mapping-v2-overlay-preview-sandbox.js` itself,
  independent of anything the Side-by-Side module reports.
- **(EPIC 2E-G) Real-image regression testing is still required** — all
  QA in this EPIC used synthetic test images/inputs and hand-built mock
  comparison objects, same caveat as EPIC 2E-F.
- **(EPIC 2E-G) XMP regression in this EPIC was verified via live
  browser byte-length/schema comparison, not an exhaustive semantic
  diff** — the Decision Report's own `xmpIsolation.regressionVerified`
  field is honestly `false` (see EPIC 2E-G-B-F above) precisely because
  no dedicated semantic XMP-regression test suite exists; this is
  itself documented as a known gap, not silently assumed safe.
- **(EPIC 2E-G) No automated, persisted browser test suite exists** —
  every QA pass across all of EPIC 2E-G's ten sub-stages was a
  one-time manual Playwright script, same caveat as EPIC 2E-F.
- **(EPIC 2E-G) Mobile layout verified only at the 390px emulated
  Playwright viewport**, not on real physical devices — same caveat as
  EPIC 2E-F.

No forward-looking roadmap entry is enforced anywhere in the current
codebase — any future stage should still be defined fresh against the
actual state, not assumptions. That said, EPIC 1.1 does leave one
concrete, documented option on the table: **gradual migration of
individual engines to read from `core/calibration-registry` instead of
their own hard-coded constants**, one engine/one constant at a time (see
"How Future Stages Will Use This Registry" in
`docs/development/EPIC-01.1_Calibration_Registry_Foundation.md` for the
suggested order — validation-threshold first, feasibility/transfer
scoring coefficients last). This is an option, not a commitment; no
migration has been scheduled or started.

## EPIC 2E-H Pipeline Order (final, as integrated in `core/decision-engine/index.js`)

1. Style Budget Intelligence
2. Mapping V2 Planner
3. Translation V2
4. Safety Clamp V2
5. Shadow Compare V2
6. Controlled Activation V2
7. Legacy Safety Overlay V2
8. Overlay Simulation V2
9. Controlled Overlay Test Gate V2
10. Controlled Overlay Preview Sandbox V2
11. Controlled Preview Review State V2 (built only after the Preview
    Sandbox it depends on already exists)
12. Side-by-Side Preview Comparison V2 (built after `mapped` — see the
    important architectural note below)
13. Visual Preview Render Plan V2 (LAST — built immediately after
    stage 12, for the identical structural reason: it also needs
    `mapped`, plus every stage before it)

Stages 1–11 all attach their own object to `finalStyleIntent` INSIDE
`_buildDecision()`, each in its own try/catch block (defense-in-depth
— a failure in any one stage cannot break analysis or fall back to any
unsafe default). Stages 12 and 13 are DIFFERENT: neither can live
inside `_buildDecision()` because both need `mapped` — the REAL
production Legacy preset (`exp`/`con`/`hi`/`sh`/etc. from
`mapStyleFingerprintToLightroom`) — which does not exist until AFTER
`_buildDecision()` has already returned. So both are built in
`buildFinalPreset()` itself, right after `mapped` is computed, using
an IMMUTABLE spread attachment pattern (`decision.finalStyleIntent =
{...decision.finalStyleIntent, visualPreviewRenderPlanV2, ...}` —
fixed from an earlier direct-mutation bug caught in EPIC 2E-H-B-F),
which preserves every prior stage's field while adding the new one.
This is automatically visible to Decision Report / Reference Transfer
without any rebuild. None of these 13 stages are read by
`core/lightroom-mapping-engine/index.js`
(`mapStyleFingerprintToLightroom`), `preset-engine`, or `xmp-validator`
— confirmed via repeated grep audits across every sub-stage of EPIC
2E-F, EPIC 2E-G, and EPIC 2E-H, most recently in this Phase D release
audit.

## Canonical Object Paths

```
finalStyleIntent.controlledOverlayPreviewSandboxV2
finalStyleIntent.controlledPreviewReviewStateV2
finalStyleIntent.sideBySidePreviewComparisonV2
finalStyleIntent.visualPreviewRenderPlanV2
```

All four live under `p._decision.finalStyleIntent` on the object
returned by `buildFinalPreset()`. The UI reads them via
`state.lastPreviewSandbox`/`state.lastPreviewReviewState`/
`state.lastSideBySideComparison` in `ui/app.js`, set once per analysis
run right after `buildFinalPreset()` returns.
`visualPreviewRenderPlanV2` is read directly from
`finalPreset._decision.finalStyleIntent` at the point `runAnalysis()`
kicks off the (fire-and-forget, generation-checked) Visual Preview
Comparison render — see the EPIC 2E-H section below for the full
actual-rendering path, which is entirely separate from this canonical
Render Plan object.

**Human Review approval is purely informational.** `canApprovePreview`
becoming `true` does not — and structurally cannot, since the relevant
booleans are hard-coded inside `mapping-v2-overlay-preview-sandbox.js`
itself — enable Preview Export, Production Write, or Production Mapping
activation. There is no code path anywhere in this codebase, as of
v1.1.8, that reads Review State (or Side-by-Side Comparison, or Visual
Preview Render Plan capability) approval/renderability and produces or
alters any production output.

## Safety Boundaries (EPIC 2E-F + EPIC 2E-G)

- **Legacy Mapping vs. V2 shadow pipeline:** completely separate code
  paths. `decision.styleBudget` (computed by
  `core/lightroom-mapping-engine/index.js`) is the ONLY input to XMP
  export. The entire `finalStyleIntent.*` V2 chain (all 12 stages
  above) is attached to a sibling object that no production code
  reads.
- **Preview Sandbox vs. XMP export:** `simulatedPreviewPreset` contains
  only abstract, normalized 0-1 "changes" — never real Lightroom slider
  values, never XMP-schema values. `canExportPreview`/
  `canWriteProduction` are hard-coded `false` inside the Sandbox module
  itself; confirmed (this release and every prior sub-stage) that no
  combination of feature flags can flip them.
- **Side-by-Side Comparison vs. XMP export (EPIC 2E-G):** the
  comparison module has NO write path to XMP at all — this was proven
  structurally (no such code exists), not via a runtime regression
  comparison (`xmpIsolation.regressionVerified` is honestly `false` in
  the Decision Report — see `11_EPIC_2E_G_QA_REPORT.md`).
  `canRenderLegacyPreview`/`canRenderV2Preview`/`canCompareVisually`
  are all hard-coded `false` — this codebase has no image-rendering
  pipeline anywhere; the comparison is DATA-level only.
- **Review State Engine vs. UI:** all approval/progress/blocker
  calculation happens exclusively in
  `mapping-v2-preview-review-state.js`; the UI (`review-console-controller.js`)
  only ever calls `updatePreviewReviewItemV2`/`resetPreviewReviewStateV2`
  and renders whatever they return — zero approval logic is duplicated
  client-side. The Side-by-Side Comparison module independently
  RE-CALCULATES its own honest `humanReviewStatus` from canonical
  `reviewItems` (never trusting incoming top-level approval metadata)
  rather than reading the Review State Engine's output directly —
  see the EPIC 2E-G-A-F2 entry above for why this was necessary.
- **UI state ownership:** `state.lastPreviewReviewState` in
  `ui/app.js` is the single editable Review State for the current
  analysis result. Same-image Re-analyze passes it back into
  `buildFinalPreset()` so the engine can re-normalize it against a
  fresh Sandbox (safely downgrading stale approval). New-image import
  always clears it (via `handleReset()`, called unconditionally before
  every `loadFile()`), so a different image can never inherit approval.
  `state.lastSideBySideComparison` follows the identical clear/refresh
  lifecycle.
- **Event delegation lifecycle:** `review-console-controller.js`
  attaches exactly ONE delegated listener set, once per page session,
  to the persistent `#reviewConsoleInner` container — verified this
  never duplicates across repeated Re-analyze/new-image cycles (a
  MutationObserver-based test confirmed exactly 1 DOM mutation per 1
  user click even after 3 Re-analyzes). The Side-by-Side Comparison UI
  has exactly one interactive element in total (a "Go to Review
  Console" scroll-only navigation button) and needs no comparable
  listener-lifecycle management.
- **No local persistence:** confirmed via grep — zero
  `localStorage`/`sessionStorage`/`indexedDB`/cookie usage in any
  Review Console, Preview Sandbox, or Side-by-Side Comparison file. The
  pre-existing, unrelated dark-mode/language `localStorage` keys in
  `ui/app.js` predate both EPICs and are explicitly out of scope.
- **Rollback / fail-safe behavior:** every V2 stage's `rollbackPlan`
  reports `restoreSource:"legacy"`/`available:true`. If
  `createPreviewReviewStateV2`/`updatePreviewReviewItemV2`/
  `buildSideBySidePreviewComparisonV2` ever throws unexpectedly, the
  caller preserves the last valid state (UI controller) or falls back
  to the engine's own safe empty-input result (decision-engine
  integration), never a hand-duplicated shape and never an
  approved-looking state.

## Next Recommended EPIC

**EPIC 2E-I — Interactive Before/After Visual Comparison.** Purpose:
add a safe Before/After slider comparing the two already-rendered
Legacy/V2 canvases interactively; add optional synchronized view
behavior; preserve read-only state throughout; keep Export and
Production Write disabled; remain honest about browser approximation;
prepare for structured real-image validation. Not implemented as part
of EPIC 2E-H; this is a recommendation only, to be scoped fresh against
the actual implementation when work begins.

## EPIC 2E-H — Isolated Visual Preview Rendering (CLOSED)

**Final version: v1.1.8.** Added the actual browser-rendered preview
layer on top of EPIC 2E-G's data-level comparison — see the dedicated
architecture document (`docs/project/13_VISUAL_PREVIEW_RENDERING_ARCHITECTURE.md`)
for the full three-path breakdown (production / preview-planning /
actual-UI-render). Summary of what changed:

- **Render Plan Builder** (`core/preview-rendering/visual-preview-render-plan-v2.js`)
  — data-only capability modeling for Legacy/V2, conservative
  normalized adjustment model (-1..1), Color Grading supported only
  for real non-zero shadow/highlight saturation (Hue-only and
  Midtone-only are honestly unsupported), non-production V2 evidence
  checks, rollback/fallback metadata, immutable inputs, safe fallback
  on any internal error (never `null`).
- **Isolated Canvas Renderer** (`ui/isolated-visual-preview-renderer-v2.js`)
  — Canvas 2D pixel processing (exposure, highlights/shadows,
  whites/blacks, contrast/tone-curve, temperature/tint,
  saturation/vibrance, clarity/dehaze, limited color grading), alpha
  preservation, `Uint8ClampedArray` channel safety, bounded preview
  dimensions with DPR-aware `maxPixelCount` enforcement, `image.decode()`
  readiness, chunked main-thread processing (~100k-pixel chunks,
  cancellation-checked between every chunk), stale-generation
  protection at two levels (per-renderer + per-controller), dispose
  lifecycle, staged best-effort commit (`commitAtomicity:
  "staged-best-effort"`, pixel-content restoration honestly
  unsupported after a commit failure — only dimensions are restored).
- **Pipeline integration** — stage #13, `finalStyleIntent.visualPreviewRenderPlanV2`,
  immutable spread attachment (fixed a real direct-mutation bug),
  non-null canonical fallback, tri-state Decision Report projection,
  bounded Reference Transfer preservation, single-read `safeGet`
  contract against hostile getters throughout.
- **UI** (`ui/visual-preview-comparison-controller-v2.js` +
  `ui/visual-preview-comparison-renderer-v2.js`) — two isolated target
  canvases (`legacyVisualPreviewCanvasV2` / `controlledV2VisualPreviewCanvasV2`),
  sequential Legacy-then-V2 rendering (never two large buffers held at
  once), real render-cancellation on `clear()` (disposes+recreates the
  underlying renderers — an earlier version only incremented a counter,
  letting stale pixels commit after clear), Preparing → Rendering →
  Partial/Rendered/Blocked/Failed/Cancelled states, source/canvas
  validation with specific blockers, evidence-driven safety strip
  (Production Mapping/Preview Export/Production Write, each
  confirmed/anomaly/unknown), read-only throughout (zero Apply/Export/
  Activate/persistence controls).

**Known limitations (honest, not fixed in this EPIC):** browser preview
is not Lightroom-accurate; no RAW development, camera-profile
reproduction, exact tone-curve/Highlight/Shadow parity, full Color
Grading model (Hue and Midtone remain unsupported), local/AI masks,
complete ICC proofing, sharpening/noise-reduction reproduction, lens
corrections, or geometry transforms; rendering is main-thread only;
large images are downscaled; actual rendered state is UI-local only
(never written back to `finalStyleIntent`); no automated full-browser
regression suite exists; real-device mobile and real screen-reader
testing remain outstanding; exact XMP semantic regression still
requires a dedicated comparison tool (byte-length/schema/substring
checks were used instead); Side-by-Side/Review/Render-Plan approval
never activates V2 in any way.
