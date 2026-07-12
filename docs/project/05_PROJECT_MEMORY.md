# 05 — PROJECT MEMORY

Summary snapshot of the current project state, written by inspecting the
actual source in this package. This is the file to read first when
resuming work on LUMIXA AI after time away.

## Current Version

**LUMIXA AI, UI v1.0.0** (as displayed in the sidebar), built on a
**Stage 2.4.2B.2** core pipeline — confirmed directly in
`core/decision-engine/index.js` and `core/reference-transfer-engine/index.js`
header comments and function bodies (`_computeStyleFeasibility`,
`_validateStyleDNA`, `_buildStyleDNA`, `_classifyPhotographerStyle` all
present and wired into the pipeline).

`core/` = 29 modules. `ui/` = `app.js` (pipeline orchestration/state) +
`ui-engine.js` + 12 canvas renderer files. `index.html` = single-page
static entry point, no build step.

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

## Current Version (update)

Following EPIC 1.1, the core pipeline itself is still Stage 2.4.2B.2
(unchanged) — EPIC 1.1 added a documentation/configuration foundation
alongside it, not a new pipeline capability.

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
