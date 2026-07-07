/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALIBRATION REGISTRY (EPIC 1.1 — Calibration Registry Foundation)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * Every prior development stage's "Remaining Risks" section has said some
 * version of the same thing: "this weight/threshold is a reasoned default,
 * not tuned from real-world samples." That is true across
 * core/decision-engine, core/lightroom-mapping-engine,
 * core/reference-transfer-engine, and core/xmp-validator — dozens of
 * numeric constants live scattered across those files with no single place
 * to see them all, understand what each one is FOR, or safely change one
 * without hunting through several modules.
 *
 * This module is that single place. It is a CENTRALISED, READ-ONLY,
 * EXPLAINABLE catalogue of the calibration values already in use across the
 * codebase today — every entry below mirrors a real constant that already
 * exists in the engine named in its `owner` field, verified against the
 * current source before being copied here.
 *
 * WHAT THIS STAGE DELIBERATELY DOES NOT DO
 * - Does NOT change any engine's behaviour. Every engine listed as an
 *   `owner` below still reads its OWN internal constant, not this registry.
 *   This file is a mirror/catalogue for now, not a dependency.
 * - Does NOT redesign the pipeline, modify the UI, or touch XMP export.
 * - Does NOT add new image analysis.
 *
 * FUTURE USE (see docs/development/EPIC-01.1_Calibration_Registry_Foundation.md
 * for the full migration plan)
 * A future stage can migrate engines to this registry ONE AT A TIME:
 * replace `const BUDGET_SCALE = 40;` in core/lightroom-mapping-engine with
 * `const BUDGET_SCALE = getCalibrationValue('styleBudget.scale.budgetScale', 40);`
 * — the `fallback` argument means a migrated engine keeps working even if a
 * key is ever removed from the registry by mistake. Because every entry
 * here already matches the engine's current constant value, migrating an
 * engine to read from here is a NO-OP on behaviour by construction; only
 * future edits to the registry value itself would change anything.
 */

// ─── Registry Entries ─────────────────────────────────────────────────────
// Each entry: { key, value, category, owner, purpose, rationale, risk }
// `key` is a dotted path grouping related values (e.g. "styleWeight.<style>").
// `value` may be a number, a [min, max] range pair, or a boolean flag.
const ENTRIES = [

  // ── Category: style-weight ────────────────────────────────────────────
  // Fixed per-style priority used ONLY to break ties between similarly-
  // scoring photographer styles during classification — never affects the
  // raw signal-match score itself. Mirrors core/decision-engine's
  // STYLE_PROFILES[].priority for all 17 styles.
  { key: 'styleWeight.airyWedding.priority', value: 1.00, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for the Airy Wedding style profile.',
    rationale: 'Airy Wedding is a well-established, high-recognisability look — given top priority when signals are ambiguous between it and a vaguer style.',
    risk: 'Raising further could make Airy Wedding win ties it should lose to a more specific match; lowering could let a weaker generic style win instead.' },
  { key: 'styleWeight.luxuryWedding.priority', value: 0.95, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Luxury Wedding.', rationale: 'Distinct enough from Airy Wedding to warrant near-top priority.',
    risk: 'Too close to Airy Wedding\'s value could cause frequent flip-flopping between the two on similar references.' },
  { key: 'styleWeight.brownFilm.priority', value: 0.95, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Brown Film.', rationale: 'A strong, specific film-emulation signature deserves high priority once matched.',
    risk: 'Too high could over-claim ambiguous warm/earthy references that are actually Warm Earth.' },
  { key: 'styleWeight.greenPastel.priority', value: 0.90, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Green Pastel.', rationale: 'Specific green+muted signature is fairly unambiguous once both conditions are true.',
    risk: 'Too high risks over-claiming any green-dominant reference, including Dark Forest.' },
  { key: 'styleWeight.softPortrait.priority', value: 0.85, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Soft Portrait.', rationale: 'Common but less distinctive than film/pastel signatures, so mid-tier priority.',
    risk: 'Too high could win ties against Clean Portrait even when the reference is more neutral than soft.' },
  { key: 'styleWeight.cleanPortrait.priority', value: 0.80, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Clean Portrait.', rationale: 'The most "default/unstylised" portrait look, kept as a lower-priority fallback.',
    risk: 'Too low could make Clean Portrait rarely win even when it is the best description.' },
  { key: 'styleWeight.naturalDocumentary.priority', value: 0.85, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Natural Documentary.', rationale: 'Style-recognition-engine agreement (Documentary/Street) is a strong signal, warranting mid-high priority.',
    risk: 'Too high could override a more specific style when style-recognition alone agrees.' },
  { key: 'styleWeight.editorialFashion.priority', value: 0.90, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Editorial Fashion.', rationale: 'Fashion style-recognition agreement plus bold contrast/palette is a strong, specific combination.',
    risk: 'Too high could over-claim any high-contrast portrait as fashion.' },
  { key: 'styleWeight.moodyCinematic.priority', value: 0.90, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Moody Cinematic.', rationale: 'Distinctive dark+high-contrast combination deserves high priority.',
    risk: 'Too high could over-claim any simply dark/underexposed reference.' },
  { key: 'styleWeight.darkForest.priority', value: 0.90, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Dark Forest.', rationale: 'The dark counterpart to Green Pastel needs equal priority to avoid one systematically dominating the other.',
    risk: 'Imbalance versus greenPastel.priority could bias green-dominant references toward one look regardless of actual mood.' },
  { key: 'styleWeight.fineArtPortrait.priority', value: 0.85, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Fine Art Portrait.', rationale: 'Requires deliberate colour-harmony evidence, a fairly specific and reliable signal.',
    risk: 'Too high could over-claim any high-contrast portrait with incidental harmony.' },
  { key: 'styleWeight.softMatte.priority', value: 0.75, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Soft Matte.', rationale: 'A deliberately generic catch-all for flat/muted looks without a specific colour direction — kept low priority so specific styles win first.',
    risk: 'Too high could suppress more specific matches (Brown Film, Green Pastel) that also show some matte character.' },
  { key: 'styleWeight.brightLifestyle.priority', value: 0.80, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Bright Lifestyle.', rationale: 'Common everyday look, mid-tier priority relative to more specific editorial looks.',
    risk: 'Too high could override Airy Wedding on non-wedding bright scenes it should still win.' },
  { key: 'styleWeight.mutedLifestyle.priority', value: 0.75, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Muted Lifestyle.', rationale: 'Generic desaturated-everyday catch-all, deliberately low priority.',
    risk: 'Too high could suppress Japanese Soft or Soft Matte matches on the same reference.' },
  { key: 'styleWeight.warmEarth.priority', value: 0.80, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Warm Earth.', rationale: 'General warm/earthy catch-all distinct from the more specific Brown Film.',
    risk: 'Too close to brownFilm.priority could cause frequent flip-flopping on warm references.' },
  { key: 'styleWeight.koreanClean.priority', value: 0.85, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Korean Clean.', rationale: 'A recognisable, fairly specific combination of brightness + low saturation + skin.',
    risk: 'Too high could over-claim references that are actually just generically bright/clean.' },
  { key: 'styleWeight.japaneseSoft.priority', value: 0.85, category: 'style-weight', owner: 'decision-engine',
    purpose: 'Tie-breaking priority for Japanese Soft.', rationale: 'Matches Korean Clean\'s priority since the two are close relatives distinguished mainly by warmth direction.',
    risk: 'Imbalance versus koreanClean.priority could systematically bias neutral-cool soft references toward one label.' },

  // ── Category: style-threshold ─────────────────────────────────────────
  // Thresholds used inside the style-matching/confidence formula itself
  // (not the priority weights above). Mirrors core/decision-engine's
  // _classifyPhotographerStyle confidence formula and ambiguity checks.
  { key: 'styleThreshold.confidence.overallConfWeight', value: 0.5, category: 'style-threshold', owner: 'decision-engine',
    purpose: 'Weight given to the Style Fingerprint\'s own overallConfidence when computing a style match\'s reported confidence.',
    rationale: 'A style detected from low-confidence upstream analysis should be reported as less certain even with a strong raw signal match — ties reported confidence partly to source reliability.',
    risk: 'Too high makes style confidence swing heavily with unrelated upstream noise; too low makes style confidence ignore genuine upstream uncertainty.' },
  { key: 'styleThreshold.confidence.baseFactor', value: 0.5, category: 'style-threshold', owner: 'decision-engine',
    purpose: 'Base multiplier floor in the style confidence formula: rawScore × (0.5 + 0.5 × overallConf).',
    rationale: 'Ensures a strongly-matched style is never reported below ~50% confidence purely due to upstream uncertainty — ambiguity should lower, not erase, a strong signal match.',
    risk: 'Raising this floor could overstate confidence for genuinely unreliable references.' },
  { key: 'styleThreshold.lowConfidenceCutoff', value: 0.25, category: 'style-threshold', owner: 'decision-engine',
    purpose: 'Raw score below which a style match is flagged as "no strong match found" and a warning is attached.',
    rationale: 'Below this point the detected label is a loose approximation at best and callers should not treat it as reliable.',
    risk: 'Too low lets weak matches through silently; too high flags too many legitimate-but-modest matches as unreliable.' },
  { key: 'styleThreshold.ambiguityGap', value: 0.08, category: 'style-threshold', owner: 'decision-engine',
    purpose: 'Maximum gap between the top two styles\' weighted scores before an ambiguity warning fires ("this reference sits between two looks").',
    rationale: 'A small gap between competing styles means the choice is not confident, and the report should say so rather than pick silently.',
    risk: 'Too large triggers ambiguity warnings on clear-cut matches; too small misses genuinely ambiguous cases.' },

  // ── Category: feasibility-threshold ───────────────────────────────────
  // Level cutoffs used by both the authoritative Style Feasibility
  // (core/reference-transfer-engine) and its decision-time preliminary
  // estimate (core/decision-engine).
  { key: 'feasibilityThreshold.highCutoff', value: 0.7, category: 'feasibility-threshold', owner: 'reference-transfer-engine',
    purpose: 'Score at or above which Style Feasibility is reported as "high".',
    rationale: 'Matches the same high-confidence cutoff used elsewhere in the pipeline (e.g. finalStyleIntentConfidence) for consistency.',
    risk: 'Raising this makes fewer references qualify as "high" feasibility, understating transferability; lowering overstates it.' },
  { key: 'feasibilityThreshold.mediumCutoff', value: 0.4, category: 'feasibility-threshold', owner: 'reference-transfer-engine',
    purpose: 'Score at or above which (but below the high cutoff) Style Feasibility is reported as "medium".',
    rationale: 'Leaves a clear "low" band below 0.4 for references that are genuinely poor transfer candidates.',
    risk: 'Moving this changes how many borderline references get the more cautious "medium" framing versus "low".' },
  { key: 'feasibilityThreshold.styleAdjustment.min', value: -0.2, category: 'feasibility-threshold', owner: 'reference-transfer-engine',
    purpose: 'Lower bound on the style-specific feasibility adjustment (Airy Wedding, Green Pastel, Brown Film, Moody Cinematic, Luxury Wedding rules).',
    rationale: 'Prevents any single style-specific rule from swinging the base score by more than a bounded amount.',
    risk: 'Widening lets style-specific rules dominate the generic score more than intended.' },
  { key: 'feasibilityThreshold.styleAdjustment.max', value: 0.15, category: 'feasibility-threshold', owner: 'reference-transfer-engine',
    purpose: 'Upper bound on the style-specific feasibility adjustment.',
    rationale: 'Matches the min bound\'s intent — style-specific rules nudge, they do not override, the base feasibility calculation.',
    risk: 'Widening lets style-specific rules dominate the generic score more than intended.' },

  // ── Category: transfer-threshold ──────────────────────────────────────
  // Level cutoffs for the family of "risk score → low/medium/high label"
  // conversions inside core/reference-transfer-engine.
  { key: 'transferThreshold.wbRisk.highCutoff', value: 0.55, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'WB transfer-risk score at or above which transferRisk is labelled "high".',
    rationale: 'Reserved for cases where white balance is clearly scene-dependent enough that a different photo would need real manual correction.',
    risk: 'Lowering this over-warns about WB risk on ordinary references; raising it under-warns on genuinely risky ones.' },
  { key: 'transferThreshold.wbRisk.mediumCutoff', value: 0.25, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'WB transfer-risk score at or above which (but below high) transferRisk is labelled "medium".',
    rationale: 'Creates a cautious middle band rather than a binary low/high split.',
    risk: 'Moving this changes how often a mild WB dependency gets flagged versus ignored.' },
  { key: 'transferThreshold.editingDistance.highCutoff', value: 0.55, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'Editing-distance score at or above which the estimate is labelled "high" (rough starting point only).',
    rationale: 'Mirrors the WB-risk cutoff for consistency across the "distance/risk score → label" conversions in this module.',
    risk: 'Same trade-off as other high-cutoffs: too low over-warns, too high under-warns.' },
  { key: 'transferThreshold.editingDistance.mediumCutoff', value: 0.30, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'Editing-distance score at or above which (but below high) the estimate is labelled "medium".',
    rationale: 'Creates the same three-band structure used elsewhere in this module.',
    risk: 'Moving this shifts how many presets get the more cautious "medium — expect touch-ups" framing.' },
  { key: 'transferThreshold.acceptance.highCutoff', value: 0.65, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'Distance-similarity score at or above which a related concept in this module reads "high".',
    rationale: 'Kept slightly different from the 0.55/0.7 cutoffs used elsewhere because this scoring path weighs inputs differently.',
    risk: 'Not currently harmonised with the other threshold pairs above — a future stage may want to unify all three-band cutoffs.' },
  { key: 'transferThreshold.acceptance.mediumCutoff', value: 0.35, category: 'transfer-threshold', owner: 'reference-transfer-engine',
    purpose: 'Distance-similarity score at or above which (but below high) reads "medium".',
    rationale: 'Paired with the highCutoff above.', risk: 'See highCutoff risk note.' },

  // ── Category: validation-threshold ────────────────────────────────────
  // Hard ceilings enforced by core/xmp-validator immediately before/after
  // mapping — these are the LAST safety net before a value reaches the
  // exported .xmp file. Mirrors HARD_LIMITS exactly.
  { key: 'validationThreshold.basic.exposure', value: [-35, 35], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Exposure.', rationale: 'Beyond this range a "preset" reads as a correction, not a style transfer.',
    risk: 'Widening risks genuinely broken-looking presets on unusual references; narrowing could clip legitimately extreme (but intentional) exposure moods.' },
  { key: 'validationThreshold.basic.contrast', value: [-20, 25], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Contrast.', rationale: 'Prevents Basic Panel alone from creating an extreme contrast look that should instead come from Tone Curve/Colour Grading.',
    risk: 'Same trade-off pattern as the exposure ceiling.' },
  { key: 'validationThreshold.basic.highlights', value: [-55, 10], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Highlights.', rationale: 'Asymmetric range reflects that highlight recovery (negative) is far more common/safe than highlight boosting.',
    risk: 'Narrowing the negative side could prevent legitimate highlight recovery on overexposed references.' },
  { key: 'validationThreshold.basic.shadows', value: [-25, 35], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Shadows.', rationale: 'Asymmetric range reflects that shadow lifting (positive) is more common than shadow crushing via this specific slider.',
    risk: 'Same trade-off pattern as other Basic Panel ceilings.' },
  { key: 'validationThreshold.basic.whites', value: [-30, 20], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Whites.', rationale: 'Keeps the white point adjustment within a range that reads as tasteful rather than clipped/blown.',
    risk: 'Same trade-off pattern as other Basic Panel ceilings.' },
  { key: 'validationThreshold.basic.blacks', value: [-35, 15], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Hard ceiling on Basic Panel Blacks.', rationale: 'Keeps the black point within a range that supports both punchy and matte looks without total clipping.',
    risk: 'Same trade-off pattern as other Basic Panel ceilings.' },
  { key: 'validationThreshold.wb.tempCap', value: 40, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum absolute White Balance Temperature shift.', rationale: 'Beyond this, WB is "overcorrection", not "reproducing mood" — the core WB-intent philosophy in 01_PROJECT_VISION.md.',
    risk: 'Raising this could let extreme, scene-specific WB moods transfer in ways that look broken on a different photo.' },
  { key: 'validationThreshold.wb.tintGreenFloor', value: -12, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Minimum (most-negative) Tint value under normal conditions.', rationale: 'Below this is an unintended green colour cast risk rather than an intentional mood.',
    risk: 'Lowering (more negative) risks visible green casts; raising could clip legitimately intentional cool-green looks.' },
  { key: 'validationThreshold.wb.tintGreenFloorIntentional', value: -25, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Relaxed Tint floor used only when the Style Fingerprint confirms an intentional green mood.',
    rationale: 'Green Pastel and Dark Forest genuinely need more green-leaning tint than the default floor allows.',
    risk: 'Widening further risks a visible, unintended green cast even for styles that do want some green lean.' },
  { key: 'validationThreshold.wb.tintMagentaCeil', value: 30, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum (most-positive) Tint value.', rationale: 'Beyond this, an unintended magenta cast risk outweighs any stylistic benefit.',
    risk: 'Raising risks a visible magenta cast on skin tones especially.' },
  { key: 'validationThreshold.hsl.skinHueCap', value: 4, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum HSL Hue shift on skin-related channels (red/orange/yellow).', rationale: 'Skin hue is extremely sensitive to shift — even a few degrees reads as an unnatural colour cast on faces.',
    risk: 'Raising risks visibly unnatural skin tones; this is one of the tightest ceilings in the whole system by design.' },
  { key: 'validationThreshold.hsl.skinSatLo', value: -8, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Minimum HSL Saturation shift on skin channels.', rationale: 'Some desaturation is acceptable for muted/matte looks, but too much makes skin look grey/lifeless.',
    risk: 'Lowering further risks lifeless-looking skin on muted-style presets.' },
  { key: 'validationThreshold.hsl.skinSatHi', value: 6, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum HSL Saturation shift on skin channels.', rationale: 'Keeps skin from ever reading as artificially vivid/sunburnt.',
    risk: 'Raising risks an artificial, over-saturated skin look.' },
  { key: 'validationThreshold.hsl.colorHueCap', value: 15, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum HSL Hue shift on non-skin channels.', rationale: 'Non-skin colours can tolerate a larger hue shift than skin before looking wrong.',
    risk: 'Raising risks colours reading as artificially shifted rather than stylised.' },
  { key: 'validationThreshold.hsl.colorSatCap', value: 25, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum HSL Saturation shift on non-skin channels — the "neon ceiling".', rationale: 'Prevents any colour family (especially green foliage) from becoming an artificial neon look.',
    risk: 'Raising risks the neon-foliage failure mode explicitly called out in the Green Pastel style\'s own risk notes.' },
  { key: 'validationThreshold.calibration.hueCap', value: 10, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum Calibration Hue shift on any primary.', rationale: 'Calibration is meant to stay subtle — a wide hue shift here affects the whole image\'s colour foundation, not just one HSL channel.',
    risk: 'Raising risks a global colour-cast-like shift that is hard to undo downstream.' },
  { key: 'validationThreshold.calibration.satCap', value: 15, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum Calibration Saturation shift on any primary.', rationale: 'Same subtlety principle as the hue cap.',
    risk: 'Raising risks Calibration dominating the whole look instead of staying a subtle foundation adjustment (the explicit "never let Calibration dominate" principle from Stage 2.4.1).' },
  { key: 'validationThreshold.presence.vibCap', value: 30, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum Vibrance value.', rationale: 'Keeps overall colour intensity within a tasteful range regardless of style.',
    risk: 'Raising risks an oversaturated, unnatural overall look.' },
  { key: 'validationThreshold.presence.satCap', value: 20, category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Maximum Saturation value.', rationale: 'Paired with the Vibrance cap for the same reason.', risk: 'Same as vibCap.' },
  { key: 'validationThreshold.curve.shadowY', value: [0, 60], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Valid output range for the Tone Curve shadow anchor point.', rationale: 'Keeps the shadow anchor within a range that supports both deep and matte-lifted looks without becoming physically invalid.',
    risk: 'Widening risks a curve shape that clips or inverts unexpectedly downstream in Lightroom.' },
  { key: 'validationThreshold.curve.midY', value: [80, 180], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Valid output range for the Tone Curve midtone anchor point.', rationale: 'Keeps midtones within a plausible brightness band regardless of style.',
    risk: 'Same trade-off pattern as the shadow anchor range.' },
  { key: 'validationThreshold.curve.highlightY', value: [180, 255], category: 'validation-threshold', owner: 'xmp-validator',
    purpose: 'Valid output range for the Tone Curve highlight anchor point.', rationale: 'Keeps highlights within a plausible brightness band regardless of style.',
    risk: 'Same trade-off pattern as the shadow anchor range.' },

  // ── Category: engine-trust-default ────────────────────────────────────
  // Baseline per-engine trust weights for the "general" scene strategy —
  // the fallback used when no more specific scene (portrait/landscape/
  // wedding/etc.) strategy applies. Mirrors core/decision-engine's
  // SCENE_STRATEGIES.general.
  { key: 'engineTrustDefault.general.basicTrust', value: 0.75, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in Basic Panel\'s own analysis under the general (no specific scene) strategy.',
    rationale: 'Basic Panel is a supporting signal by design (per 01_PROJECT_VISION.md) — trusted, but never the primary style driver.',
    risk: 'Raising this lets Basic Panel influence the final look more than the "supporting signal only" philosophy intends.' },
  { key: 'engineTrustDefault.general.wbTrust', value: 0.85, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in White Balance analysis under the general strategy.', rationale: 'WB intent is usually a reliable, central signal for mood.',
    risk: 'Lowering this would under-trust WB even on references where it read the mood correctly.' },
  { key: 'engineTrustDefault.general.gradeTrust', value: 0.95, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in Colour Grading AI analysis under the general strategy.', rationale: 'Colour Grading is one of the most reliable mood-carrying signals across scene types.',
    risk: 'Lowering this would under-use one of the system\'s strongest signals for general references.' },
  { key: 'engineTrustDefault.general.hslTrust', value: 0.80, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in HSL analysis under the general strategy.', rationale: 'HSL is a strong colour-family signal but slightly less universally reliable than Colour Grading.',
    risk: 'Raising too high risks HSL dominating over Colour Grading\'s broader mood read.' },
  { key: 'engineTrustDefault.general.calTrust', value: 0.65, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in Calibration analysis under the general strategy.', rationale: 'Calibration is intentionally a subtle, secondary signal — lower baseline trust reflects that by design.',
    risk: 'Raising this risks Calibration having an outsized effect relative to its intended subtlety.' },
  { key: 'engineTrustDefault.general.curveTrust', value: 0.90, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in Tone Curve AI analysis under the general strategy.', rationale: 'Tone Curve is a reliable tonal-character signal across most scene types.',
    risk: 'Lowering this would under-use a generally trustworthy signal.' },
  { key: 'engineTrustDefault.general.paletteTrust', value: 0.85, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline trust in Palette (k-means) analysis under the general strategy.', rationale: 'Palette extraction is generally reliable outside of extreme edge cases.',
    risk: 'Lowering this would under-use the palette signal for style/DNA classification.' },
  { key: 'engineTrustDefault.general.skinProtect', value: 0.70, category: 'engine-trust-default', owner: 'decision-engine',
    purpose: 'Baseline skin-protection strength under the general strategy (portraits/weddings use a stricter 1.00).',
    rationale: 'General scenes may or may not contain skin — a moderate default avoids either ignoring skin entirely or over-protecting a background-only image.',
    risk: 'Lowering this under-protects skin on general-category images that do contain a person; raising it over-constrains non-portrait general images.' },

  // ── Category: style-budget ─────────────────────────────────────────────
  // The mathematical scaling matrix that prevents multiple Lightroom tools
  // from over-building the same mood dimension at once. Mirrors
  // core/lightroom-mapping-engine's BUDGET_SCALE, MIN_ENGINE_SCALE,
  // ENGINE_PRIORITY_WEIGHT, and the default per-dimension budget shares.
  { key: 'styleBudget.scale.budgetScale', value: 40, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Converts a 1.0 budget share into a slider-magnitude ceiling for style-budget enforcement.',
    rationale: 'Calibrated so a "full share" (e.g. 0.30 of the green-mood budget) corresponds to a magnitude that reads as a deliberate, visible push rather than a negligible one.',
    risk: 'Raising this makes the budget system trigger less often (more headroom before "over budget"); lowering makes it trigger more aggressively.' },
  { key: 'styleBudget.scale.minEngineScale', value: 0.15, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Floor below which an over-budget engine\'s contribution is never scaled further, even under heavy stacking.',
    rationale: 'Prevents a low-priority engine (e.g. Calibration) from being scaled all the way to zero, which would look like the engine was silently disabled rather than eased back.',
    risk: 'Raising this floor lets over-budget engines retain more influence than intended; lowering it risks a jarring near-zero result for the lowest-priority contributor.' },
  { key: 'styleBudget.priority.curve', value: 1.00, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for Tone Curve in style-budget stacking resolution.', rationale: '"Prefer Curve for tonal character" — the highest-priority, least-eased tool when multiple engines compete for the same mood dimension.',
    risk: 'Lowering this would let Tone Curve be eased back more than intended when it is usually the most appropriate primary tool.' },
  { key: 'styleBudget.priority.colorGrading', value: 0.90, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for Colour Grading in style-budget stacking resolution.', rationale: '"Prefer Colour Grading for mood" — second-highest priority.',
    risk: 'Same trade-off pattern as the Curve priority.' },
  { key: 'styleBudget.priority.hsl', value: 0.80, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for HSL in style-budget stacking resolution.', rationale: '"Prefer HSL/Curve for local colour style" — a strong but not top-tier tool.',
    risk: 'Same trade-off pattern as the Curve priority.' },
  { key: 'styleBudget.priority.wb', value: 0.50, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for White Balance in style-budget stacking resolution.', rationale: '"Prefer WB for ambient mood only" — a mid-tier tool, eased back more readily than Curve/Grading/HSL.',
    risk: 'Raising this would let WB compete with core mood tools more than its intended narrower role.' },
  { key: 'styleBudget.priority.calibration', value: 0.30, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for Calibration in style-budget stacking resolution.', rationale: '"Never let Calibration dominate" — deliberately low priority so it is eased back first/most under stacking.',
    risk: 'Raising this directly contradicts the explicit design principle from Stage 2.4.1 and risks Calibration dominating a look.' },
  { key: 'styleBudget.priority.basicPanel', value: 0.20, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for Basic Panel in style-budget stacking resolution.', rationale: '"Never let Basic Panel become dominant" — the lowest priority, consistent with Basic Panel\'s supporting-signal-only role.',
    risk: 'Raising this contradicts the core "Basic Panel is supportive, not primary" philosophy.' },
  { key: 'styleBudget.priority.presence', value: 0.35, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Priority weight for the Vibrance/Saturation "presence" dimension in style-budget stacking resolution.',
    rationale: 'Presence (overall colour intensity) is a secondary contributor relative to HSL\'s more targeted colour-family control.',
    risk: 'Raising this could let Vibrance/Saturation compete with HSL more than intended for the same colour-intensity effect.' },
  { key: 'styleBudget.default.greenMood.hsl', value: 0.30, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Default HSL share of the green-mood budget (Green Pastel / Dark Forest).', rationale: 'HSL is the primary tool for green luminance/saturation control, given the largest share.',
    risk: 'Raising further could let HSL dominate green-mood stacking even more than intended relative to Calibration/Grading.' },
  { key: 'styleBudget.default.warmMood.colorGrading', value: 0.30, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Default Colour Grading share of the warm-mood budget (Brown Film / Warm Earth).', rationale: 'Colour Grading is the primary tool for warm-mood colour separation, given the largest share.',
    risk: 'Raising further could under-allocate the WB/Calibration shares that also contribute meaningfully to warm mood.' },
  { key: 'styleBudget.default.skinProtection.hsl', value: 0.60, category: 'style-budget', owner: 'lightroom-mapping-engine',
    purpose: 'Default HSL share of the universal skin-protection budget (checked whenever skin is present, regardless of style).',
    rationale: 'HSL red/orange is the primary, most surgical tool for skin-tone protection.',
    risk: 'Lowering this would let Calibration (the other skin-budget contributor) have more relative influence on skin tone than intended.' },

  // ── Category: photographer-style-rule ─────────────────────────────────
  // Named required/forbidden Style DNA combinations, presence-only flags
  // (the actual rule content lives in core/decision-engine's
  // STYLE_DNA_RULES — this registry entry set documents WHICH 8 of the 17
  // styles currently have explicit rules, not the rule text itself, to
  // avoid duplicating a large data structure verbatim).
  { key: 'photographerStyleRule.hasExplicitRules.airyWedding', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Airy Wedding has explicit required/forbidden Style DNA rules.',
    rationale: 'Named directly in the Style DNA Validation specification\'s worked examples (e.g. "Airy Wedding with Heavy Contrast" is explicitly invalid).',
    risk: 'None from this flag itself — see core/decision-engine STYLE_DNA_RULES for the actual required/forbidden lists and their own risk notes.' },
  { key: 'photographerStyleRule.hasExplicitRules.brownFilm', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Brown Film has explicit required/forbidden Style DNA rules.', rationale: 'Named directly in the Style DNA Validation specification.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.greenPastel', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Green Pastel has explicit required/forbidden Style DNA rules.', rationale: 'Named directly in the Style DNA Validation specification.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.luxuryWedding', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Luxury Wedding has explicit required/forbidden Style DNA rules.', rationale: 'Named directly in the Style DNA Validation specification.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.softPortrait', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Soft Portrait has explicit required/forbidden Style DNA rules.', rationale: 'Named directly in the Style DNA Validation specification.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.moodyCinematic', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Moody Cinematic has explicit required/forbidden Style DNA rules.', rationale: 'Named directly in the Style DNA Validation specification.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.fineArtPortrait', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Fine Art Portrait has explicit required/forbidden Style DNA rules.', rationale: 'Added to cover the "Fine Art Portrait with Neon HSL" invalid-combination example.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.hasExplicitRules.cleanPortrait', value: true, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Flags that Clean Portrait has explicit required/forbidden Style DNA rules.', rationale: 'Added to cover the "Clean Portrait with Heavy Matte Blacks" invalid-combination example.', risk: 'See core/decision-engine STYLE_DNA_RULES.' },
  { key: 'photographerStyleRule.dnaValidationAmbiguity.scoreCutoff', value: 0.7, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Detected style\'s own DNA validation score below which an alternative-style ambiguity comparison is triggered.',
    rationale: 'A validation score below this suggests the detected style\'s DNA may itself be inconsistent, worth checking whether an alternative fits better.',
    risk: 'Lowering this triggers the ambiguity comparison less often (may miss genuinely inconsistent detections); raising it triggers more comparisons than necessary.' },
  { key: 'photographerStyleRule.dnaValidationAmbiguity.scoreGap', value: 0.15, category: 'photographer-style-rule', owner: 'decision-engine',
    purpose: 'Minimum improvement an alternative style\'s DNA validation score must show over the detected style\'s before an ambiguity warning fires.',
    rationale: 'Prevents flagging trivial score differences as meaningful ambiguity.',
    risk: 'Lowering this makes the warning fire on marginal differences; raising it could miss genuinely more-consistent alternatives.' },

  // ── Category: confidence-clamp ────────────────────────────────────────
  // Universal bounds used to keep every 0–1 confidence-like value in this
  // codebase within a sane range, plus the specific clamp constants used
  // by Style Feasibility's risk multiplier.
  { key: 'confidenceClamp.universal.min', value: 0, category: 'confidence-clamp', owner: 'decision-engine',
    purpose: 'Universal lower bound applied by clamp01() to every confidence-like value across the codebase.',
    rationale: 'A confidence, score, or weight below 0 is not meaningful and would break downstream percentage displays/comparisons.',
    risk: 'This is a structural floor, not a tunable calibration — changing it would require auditing every consumer of clamp01() across all engines.' },
  { key: 'confidenceClamp.universal.max', value: 1, category: 'confidence-clamp', owner: 'decision-engine',
    purpose: 'Universal upper bound applied by clamp01() to every confidence-like value across the codebase.',
    rationale: 'Same reasoning as the universal minimum — 100% is the structural ceiling for a confidence-like value.',
    risk: 'Same as the universal minimum — this is structural, not a calibration knob.' },
  { key: 'confidenceClamp.styleBudgetRisk.min', value: 0.5, category: 'confidence-clamp', owner: 'lightroom-mapping-engine',
    purpose: 'Lower bound on the Style Budget risk multiplier (derived from decisionConfidence/transferAwareConfidence/transferRiskEstimate).',
    rationale: 'Even under the least favourable confidence conditions, style-budget enforcement should not become more than 2× as aggressive as its baseline.',
    risk: 'Lowering this could let low-confidence references trigger extremely aggressive budget scaling; raising it reduces the multiplier\'s effect entirely.' },
  { key: 'confidenceClamp.styleBudgetRisk.max', value: 1.0, category: 'confidence-clamp', owner: 'lightroom-mapping-engine',
    purpose: 'Upper bound on the Style Budget risk multiplier.', rationale: 'The multiplier should only ever tighten enforcement, never loosen it beyond baseline.',
    risk: 'Raising above 1.0 would let high-confidence references bypass budget enforcement entirely, which is not the intended behaviour.' },
];

// ─── Internal index (built once, not exported) ───────────────────────────
const _byKey = new Map();
for (const entry of ENTRIES) {
  if (!_byKey.has(entry.key)) _byKey.set(entry.key, entry);
  // Intentionally does NOT overwrite on duplicate — validateCalibrationRegistry()
  // below is what surfaces duplicates as an explicit issue, rather than this
  // index silently picking a "winner".
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Returns the full calibration entry (value + all metadata) for a key, or
 * `undefined` if the key does not exist. Prefer this over
 * getCalibrationValue() when you need the metadata (purpose/rationale/risk),
 * e.g. for a debug panel or documentation generator.
 */
export function getCalibration(key) {
  return _byKey.get(key);
}

/**
 * Returns just the `.value` for a key, or `fallback` if the key does not
 * exist. This is the function a future migrated engine would call in place
 * of a hard-coded constant, e.g.:
 *   const BUDGET_SCALE = getCalibrationValue('styleBudget.scale.budgetScale', 40);
 * The `fallback` argument means a typo'd or removed key degrades safely to
 * the engine's own previous default rather than throwing or returning
 * `undefined` into a numeric computation.
 */
export function getCalibrationValue(key, fallback) {
  const entry = _byKey.get(key);
  return entry ? entry.value : fallback;
}

/** Returns all entries in a given category, e.g. listCalibrationByCategory('style-weight'). */
export function listCalibrationByCategory(category) {
  return ENTRIES.filter(e => e.category === category);
}

/** Returns every distinct category currently present in the registry. */
export function listCalibrationCategories() {
  return [...new Set(ENTRIES.map(e => e.category))];
}

/** Returns the full raw entry list (read-only — callers must not mutate this). */
export function listAllCalibrations() {
  return ENTRIES;
}

/**
 * Validates the registry's own internal consistency. Does not validate
 * against any engine's actual runtime behaviour (this registry is not yet
 * wired into any engine) — only that the registry itself is well-formed.
 *
 * Checks:
 * - missing required fields (key, value, category, owner, purpose,
 *   rationale, risk all being required per the EPIC 1.1 spec)
 * - invalid numeric values (NaN, or a [min,max] pair where min > max)
 * - duplicate keys
 * - missing rationale / missing owner (called out explicitly since these
 *   are the two fields most likely to be skipped when adding an entry
 *   quickly)
 *
 * Returns { isValid, issues, warnings, summary }.
 */
export function validateCalibrationRegistry() {
  const issues = [];
  const warnings = [];
  const seenKeys = new Map(); // key -> count

  for (const entry of ENTRIES) {
    const label = entry.key ?? '(missing key)';

    // Missing required fields
    for (const field of ['key', 'value', 'category', 'owner', 'purpose', 'rationale', 'risk']) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
        issues.push(`"${label}": missing required field "${field}".`);
      }
    }

    // Missing rationale / owner called out explicitly (Requirement 5),
    // even though the generic loop above already catches them, so a
    // caller filtering issues by substring can find these reliably.
    if (!entry.rationale) issues.push(`"${label}": missing rationale (explicit check).`);
    if (!entry.owner) issues.push(`"${label}": missing owner module (explicit check).`);

    // Invalid numeric values
    if (typeof entry.value === 'number' && Number.isNaN(entry.value)) {
      issues.push(`"${label}": value is NaN.`);
    }
    if (Array.isArray(entry.value)) {
      if (entry.value.length !== 2 || entry.value.some(v => typeof v !== 'number' || Number.isNaN(v))) {
        issues.push(`"${label}": range value must be a [min, max] pair of numbers.`);
      } else if (entry.value[0] > entry.value[1]) {
        issues.push(`"${label}": invalid range — min (${entry.value[0]}) is greater than max (${entry.value[1]}).`);
      }
    }

    // Invalid ranges for known 0–1 confidence/threshold categories
    if (typeof entry.value === 'number' &&
        ['style-weight', 'style-threshold', 'feasibility-threshold', 'transfer-threshold', 'confidence-clamp'].includes(entry.category) &&
        !entry.key.includes('Adjustment') // style-specific adjustment bounds legitimately go negative
    ) {
      if (entry.value < 0 || entry.value > 1) {
        warnings.push(`"${label}": value ${entry.value} is outside the conventional 0–1 range for category "${entry.category}" — confirm this is intentional.`);
      }
    }

    // Duplicate keys
    seenKeys.set(entry.key, (seenKeys.get(entry.key) ?? 0) + 1);
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) issues.push(`Duplicate key "${key}" appears ${count} times.`);
  }

  const isValid = issues.length === 0;
  return {
    isValid,
    issues,
    warnings,
    summary: `${ENTRIES.length} calibration entries checked across ${listCalibrationCategories().length} categories — ${issues.length} issue(s), ${warnings.length} warning(s).`,
  };
}
