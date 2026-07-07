/**
 * core/lightroom-mapping-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONLY PLACE THAT MAPS A STYLE FINGERPRINT INTO LIGHTROOM VALUES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Reference Image → 22 Analysis Modules → Feature Vector →
 *   Style Fingerprint → Decision Engine → [ LIGHTROOM MAPPING ENGINE ] →
 *   Pre-XMP Validation Pass → XMP Export
 *
 * STAGE 2.3 — Intelligent Lightroom Mapping
 * ───────────────────────────────────────────────────────────────────────────
 * Analysis quality and Decision Intelligence were already strong; the
 * remaining quality loss happened when translating Style Intent into
 * individual Lightroom slider values, each computed in isolation. This
 * stage does NOT change what the engine maps FROM (still the Style
 * Fingerprint + Decision) or add a new pipeline stage — it improves HOW
 * the numbers are produced, in four ways, all inside this one module:
 *
 *   1. Intent-aware mapping — a small _deriveIntentSummary() reads the
 *      Decision Engine's existing finalStyleIntent (Stage 2.2) into a
 *      few plain-English flags (isAiry, isMatte, naturalSkin, ...) that
 *      the mapping/optimisation steps below consult, instead of every
 *      function re-reading raw engine output independently.
 *   2. Photographer mapping rules — scene-aware nudges (Portrait->skin,
 *      Wedding->clean highlights, Landscape->palette, Food->colour
 *      richness, Street->atmosphere, Night->ambient mood) that INFLUENCE,
 *      never override, the values already computed.
 *   3. Cross-slider optimisation — a pass that runs AFTER every section
 *      is mapped, treating sliders as a connected system (Exposure<->
 *      Highlights<->Whites, Temp<->Tint, Contrast<->Tone Curve, Texture<->
 *      Clarity, Saturation<->Vibrance<->HSL, Calibration<->HSL) and
 *      softening compounding combinations rather than trusting each
 *      slider alone.
 *   4. Mapping explainability — every adjustment made by 2/3 above is
 *      recorded in an additive _mappingTrace field (new, but doesn't
 *      change any existing field) that core/decision-report-engine reads
 *      to explain WHY a value ended up where it did.
 *
 * Nothing here reads the DOM or writes to sliders — pure data in, preset
 * object out. core/xmp-validator runs immediately after this as the
 * Pre-XMP Validation Pass.
 */

import { clamp } from '../color-engine/index.js';

const HSL_CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
const SKIN_CHANNELS = new Set(['red','orange','yellow']);
const COLOR_CHANNELS = new Set(['blue','aqua']);

const STYLE_LIMIT = {
  exposure:   [-35, 35],
  contrast:   [-20, 25],
  highlights: [-55, 10],
  shadows:    [-25, 35],
  whites:     [-30, 20],
  blacks:     [-35, 15],
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   fingerprint: object,   // from core/style-fingerprint
 *   decision:    object,   // from core/decision-engine (strategy, not values)
 *   stats: object, basic: object|null, wb: object|null, hsl: object|null,
 *   calibration: object|null, grading: object|null, toneCurves: object|null,
 * }} ctx
 * @returns {object} flat Lightroom preset (exp,con,hi,sh,wh,bl,temp,tint,...)
 *   plus an additive `_mappingTrace` field (Stage 2.3) — every existing
 *   field/shape from before Stage 2.3 is unchanged.
 */
export function mapStyleFingerprintToLightroom(ctx) {
  const { fingerprint, decision, stats, basic, wb, hsl, calibration, grading, toneCurves } = ctx;
  const {
    isPortrait, portraitSafe, hasSkin, skinPct, gradeStrength: gradeStrengthIn, skinLockScale,
    hslDampen: hslDampenIn = 1.0, calDampen: calDampenIn = 1.0,   // Phase 4: Feature Fusion conflict dampening
    // Phase 5: Adaptive Decision Intelligence — scene-specific trust/guards
    basicDampen = 0.85, wbDampen = 1.0,
    noAutoBrighten = false, noAggressiveDarken = false,
    protectWarmChannels = false, strongColorAllowed = false,
    // Stage 2.2: transfer-aware confidence
    transferAwareConfidence = 0.7,
    transferRiskEstimate = null,
    category = 'General', decisionStrategy = 'general',
    // Stage 2.4: Photographer Intelligence Layer
    editingStrategy = null, styleBudget = null,
  } = decision;

  // ── Mapping trace (Stage 2.3, Task 2.3G) ──────────────────────────────────
  // Every adjustment the optimisation/priority passes make is logged here.
  // Purely additive — never read by anything except Explainability.
  const trace = [];
  const log = (stage, message, extra = {}) => trace.push({ stage, message, ...extra });

  // ── Intent summary (Task 2.3B) ────────────────────────────────────────────
  const intent = _deriveIntentSummary(fingerprint, decision);

  // transferAwareConfidence 1.0 → no extra softening (scale 1.0)
  // transferAwareConfidence 0.3 or below → up to 30% extra softening
  const transferSoftenScale = Math.max(0.7, Math.min(1.0, 0.7 + transferAwareConfidence * 0.3));
  const hslDampen     = hslDampenIn * transferSoftenScale;
  const calDampen     = calDampenIn * transferSoftenScale;
  const gradeStrength = gradeStrengthIn * transferSoftenScale;
  if (transferSoftenScale < 1.0) {
    log('transfer', `Transfer-aware confidence ${transferAwareConfidence} -> style engines scaled x${transferSoftenScale.toFixed(2)} before mapping.`);
  }

  // ── 1. Basic Panel → supporting-only, extra-dampened, hard-clamped ──────
  const basicOut = _mapBasicPanel(basic, basicDampen, noAutoBrighten, noAggressiveDarken);

  // ── 2. White Balance → mood-preserving, not auto-neutralising ───────────
  const { temp, tint } = _mapWhiteBalance(wb, fingerprint, portraitSafe, hasSkin, decision.skinHue, wbDampen);

  // ── 3. Presence (vibrance/saturation) ────────────────────────────────────
  const vib = _mapVibrance(stats, portraitSafe);
  const sat = portraitSafe ? clamp(-5, -8, 0) : 0;

  // ── 4. Detail ─────────────────────────────────────────────────────────────
  let clarity = isPortrait ? -5 : 0;
  let dehaze  = 0;
  let texture = isPortrait ? -5 : 0;
  const sharp   = 40;
  const noise   = isPortrait ? 20 : 10;

  // ── 5. Tone curve anchor points (parametric sliders) ──────────────────────
  const crv_hi  = toneCurves?.master?.points?.[4]?.y ?? 248;
  const crv_mid = toneCurves?.master?.points?.[2]?.y ?? 128;
  const crv_sh  = toneCurves?.master?.points?.[0]?.y ?? 5;

  // ── 6. HSL — the primary colour-style carrier ──────────────────────────
  const hslOut = _mapHSL(hsl, isPortrait, portraitSafe, skinLockScale, hslDampen, protectWarmChannels, strongColorAllowed);

  // ── 7. Colour Grading — the primary mood carrier ───────────────────────
  const gradeOut = _mapColorGrading(grading, isPortrait, portraitSafe, gradeStrength, strongColorAllowed);

  // ── 8. Calibration — kept subtle, never the main style-transfer tool ──
  const calOut = _mapCalibration(calibration, hasSkin, portraitSafe, calDampen);

  let preset = {
    exp: basicOut.exp, con: basicOut.con, hi: basicOut.hi,
    sh: basicOut.sh, wh: basicOut.wh, bl: basicOut.bl,
    temp, tint, vib, sat,
    clarity, dehaze, texture, sharp, noise,
    crv_hi, crv_mid, crv_sh,
    hsl: hslOut, grade: gradeOut, cal: calOut,
  };

  // ── Task 2.3D: Photographer Mapping Rules ─────────────────────────────────
  // Scene INFLUENCES the mapping — it is never treated as absolute truth;
  // every branch below nudges values that were already computed above.
  preset = _applyPhotographerPriority(preset, { category, decisionStrategy, fingerprint, intent }, log);

  // ── Task 2.4B: Editing Strategy — avoid tools this style family should
  //    not stack aggressively (e.g. avoid strong green HSL saturation for
  //    a green-family look, since Colour Grading/Curve should lead instead).
  preset = _applyEditingStrategy(preset, editingStrategy, log);

  // ── Task 2.4C: Style Budget — prevent multiple engines from
  //    independently over-building the same mood dimension.
  preset = _enforceStyleBudget(preset, styleBudget, { decisionConfidence: decision.decisionConfidence, transferAwareConfidence, transferRiskEstimate, hasSkin }, log);

  // ── Task 2.3A + 2.3C: Slider Relationship Modelling + Cross-slider
  //    Optimisation — run once, after every section has a value, so
  //    compounding combinations (not just individual sliders) get checked.
  preset = _crossSliderOptimize(preset, { intent, transferRiskEstimate }, log);

  // ── Task 2.3F: Final Mapping Validation — cross-SECTION consistency ─────
  preset = _finalMappingValidation(preset, { intent, decision }, log);

  return { ...preset, _mappingTrace: { intent, log: trace } };
}

// ─── Task 2.3B: Intent summary ───────────────────────────────────────────────
// Reads the Decision Engine's EXISTING finalStyleIntent (Stage 2.2, itself
// built from the Style Feature Graph) into a compact set of plain flags.
// This does not recompute anything — it is a lens onto data that already
// exists, so downstream mapping/optimisation logic can ask "is this an
// airy look?" instead of re-deriving mood from raw numbers each time.
function _deriveIntentSummary(fingerprint, decision) {
  const fsi = decision?.finalStyleIntent;
  const moodTag = fsi?.moodIntent?.tag ?? fingerprint?.mood ?? 'balanced';
  const contrastLevel = fsi?.contrastIntent?.level ?? fingerprint?.contrastLevel ?? 'medium';
  const paletteAvgSat = fsi?.paletteIntent?.avgSat ?? null;
  return {
    moodTag,
    warmthDirection: fsi?.wbIntent?.direction ?? fingerprint?.warmth ?? 'neutral',
    contrastLevel,
    isAiry:  moodTag === 'airy_bright',
    isMatte: moodTag === 'matte_shadow',
    isMoody: moodTag === 'moody_dark',
    isSoft:  ['soft_highlight', 'matte_shadow', 'low_contrast'].includes(moodTag),
    isHighContrast: contrastLevel === 'high' || moodTag === 'high_contrast',
    naturalSkin: !!(fsi?.skinIntent?.protected),
    paletteMuted: paletteAvgSat != null ? paletteAvgSat < 25 : null,
    transferRiskLevel: fsi?.transferRiskIntent?.level ?? 'low',
  };
}

// ─── Task 2.3D: Photographer Mapping Rules ───────────────────────────────────
// Scene/style category is a SIGNAL that influences mapping, never an
// absolute rule — every adjustment here is a small, bounded nudge on
// values already computed by the section mappers above, and every branch
// is gated on the actual slider state (not applied blindly).
function _applyPhotographerPriority(preset, { category, decisionStrategy, fingerprint, intent }, log) {
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };
  const styleTop = fingerprint?.styleRecognitionTop;

  // Portrait / Wedding — skin already prioritised upstream (portraitSafe,
  // skinLockScale); Wedding specifically also prioritises CLEAN highlights
  // — a wedding dress/venue reference rarely wants highlights crushed.
  if (category === 'Wedding' && p.hi < -30) {
    const before = p.hi;
    p.hi = Math.round(p.hi * 0.7);
    log('photographer', `Wedding scene prioritises clean highlights - hi softened from ${before} to ${p.hi}.`);
  }

  // Landscape — prioritise palette fidelity: if Basic Panel's contrast
  // push is fighting the palette-driven Colour Grading saturation, ease
  // Basic Panel's contrast back so palette colour reads clearly.
  if ((category === 'Landscape' || decisionStrategy === 'landscape') && p.con > 15 && (p.grade.grd_sh_s + p.grade.grd_hi_s) > 20) {
    const before = p.con;
    p.con = Math.round(p.con * 0.8);
    log('photographer', `Landscape scene prioritises palette - Basic contrast eased from ${before} to ${p.con} so Colour Grading saturation reads clearly.`);
  }

  // Food — prioritise colour richness within safe bounds: if warm-channel
  // protection has pulled saturation very low, allow a small controlled
  // lift back toward the (still-capped) ceiling.
  if (decisionStrategy === 'food' || styleTop === 'Food') {
    for (const ch of ['red', 'orange']) {
      const key = `hsl_s_${ch}`;
      if (Math.abs(p.hsl[key] ?? 0) < 4 && (fingerprint?.paletteAvgSat ?? 30) > 35) {
        const before = p.hsl[key] ?? 0;
        p.hsl[key] = clamp(before + Math.sign(before || 1) * 3, -12, 12);
        log('photographer', `Food scene prioritises colour richness - HSL "${ch}" nudged from ${before} to ${p.hsl[key]} (still within warm-channel protection).`);
      }
    }
  }

  // Street — preserve atmosphere: avoid over-clarifying a scene whose
  // mood likely depends on haze/depth/ambient softness.
  if (styleTop === 'Street' || category === 'Travel') {
    if (p.clarity > 8) { const before = p.clarity; p.clarity = 8; log('photographer', `Street/travel atmosphere preserved - clarity eased from ${before} to ${p.clarity}.`); }
    if (p.dehaze > 15) { const before = p.dehaze; p.dehaze = 15; log('photographer', `Street/travel atmosphere preserved - dehaze eased from ${before} to ${p.dehaze}.`); }
  }

  // Night / Moody — preserve ambient lighting: never let Whites punch
  // through the low-key look the mood/scene already established.
  if ((decisionStrategy === 'moody' || intent.isMoody) && p.wh > 5) {
    const before = p.wh;
    p.wh = Math.round(p.wh * 0.4);
    log('photographer', `Night/moody ambient lighting preserved - whites eased from ${before} to ${p.wh}.`);
  }

  return p;
}

// ─── Task 2.4B: Editing Strategy application ─────────────────────────────────
// Reads the avoidedTools list Decision Engine computed for this style
// family and dampens the corresponding slider group a bit further — this
// INFLUENCES the values already mapped, it never zeroes them out.
function _applyEditingStrategy(preset, editingStrategy, log) {
  if (!editingStrategy) return preset;
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };
  const avoid = new Set(editingStrategy.avoidedTools ?? []);

  if (avoid.has('hsl_green_saturation_strong') && Math.abs(p.hsl.hsl_s_green ?? 0) > 15) {
    const before = p.hsl.hsl_s_green;
    p.hsl.hsl_s_green = Math.round(p.hsl.hsl_s_green * 0.7);
    log('editing-strategy', `Editing strategy avoids strong green HSL saturation for this style — eased from ${before} to ${p.hsl.hsl_s_green}.`);
  }
  if (avoid.has('calibration_strong')) {
    const mag = ['red','green','blue'].reduce((s,c)=>s+Math.abs(p.cal[`cal_${c}_s`]??0),0);
    if (mag > 20) {
      for (const c of ['red','green','blue']) p.cal[`cal_${c}_s`] = Math.round((p.cal[`cal_${c}_s`] ?? 0) * 0.75);
      log('editing-strategy', `Editing strategy avoids strong Calibration for this style — magnitude ${mag.toFixed(0)} eased.`);
    }
  }
  if (avoid.has('wb_strong_warm') && p.temp > 20) {
    const before = p.temp;
    p.temp = Math.round(p.temp * 0.75);
    log('editing-strategy', `Editing strategy avoids over-warming WB for this style — temp eased from ${before} to ${p.temp}.`);
  }
  if (avoid.has('hsl_orange_red_strong')) {
    for (const ch of ['red', 'orange']) {
      const key = `hsl_s_${ch}`;
      if (Math.abs(p.hsl[key] ?? 0) > 6) {
        const before = p.hsl[key];
        p.hsl[key] = Math.round(p.hsl[key] * 0.7);
        log('editing-strategy', `Editing strategy protects skin orange/red channels — HSL "${ch}" eased from ${before} to ${p.hsl[key]}.`);
      }
    }
  }
  if (avoid.has('exposure_darken') && p.exp < -10) {
    const before = p.exp;
    p.exp = Math.round(p.exp * 0.5);
    log('editing-strategy', `Editing strategy avoids darkening exposure for this style — eased from ${before} to ${p.exp}.`);
  }
  if (avoid.has('shadows_lifted_flat') && p.sh > 15) {
    const before = p.sh;
    p.sh = Math.round(p.sh * 0.6);
    log('editing-strategy', `Editing strategy avoids flat lifted shadows for this cinematic style — eased from ${before} to ${p.sh}.`);
  }

  return p;
}

// ─── Task 2.4C/2.4.1/2.4.1-Refinement: Mathematical Scaling Matrix ───────────
// Stage 2.4.1 (first pass) fixed the core bug: budget enforcement now
// compares TOTAL combined engine usage against the dimension's 1.0 share
// (not each engine against its own share independently), and covers all
// four budget shapes including the previously-unenforced `balancedBudget`.
//
// Stage 2.4.1 Refinement Patch adds what was still missing:
//   1. Two more UNIVERSAL dimensions — `skin` (HSL+Calibration red/orange,
//      checked whenever skin is present, regardless of which style budget
//      is active) and `presence` (Vibrance+Saturation+HSL, checked always)
//      — covering two explicit stacking patterns the spec calls out that
//      the style-specific green/warm/shadow/general dimensions don't.
//   2. PRIORITY-WEIGHTED scaling, replacing the previous uniform scale.
//      "Keep the highest-priority contributor, soften lower-priority
//      contributors" cannot be satisfied by applying the same scale to
//      every engine — ENGINE_PRIORITY_WEIGHT below encodes the spec's
//      explicit ordering (Curve > Colour Grading > HSL > WB > Calibration
//      > Basic Panel) so the excess-over-budget is absorbed mostly by the
//      lowest-priority contributors, not spread evenly.
//   3. Structured trace entries — every adjustment now logs
//      {section, dimension, originalValue, finalValue, scaleFactor,
//      reason, budget, stackingRisk, softened} instead of a message
//      string alone, so Decision Report can explain precisely which
//      value changed, by how much, and why (Task 3).
//   4. A safe default budget when styleBudget is missing, so skin/
//      presence protection still runs even with no style-specific budget.

// ── Centralised constants (Requirement 6: avoid magic numbers) ───────────────
const BUDGET_SCALE = 40;              // magnitude units per 1.0 budget share
const MIN_ENGINE_SCALE = 0.15;        // never scale an engine's contribution below this
const DEFAULT_BUDGET = { name: 'balancedBudget', total: 1.0, hsl: 0.20, calibration: 0.20, colorGrading: 0.30, wb: 0.15, curve: 0.15 };
const SKIN_BUDGET = { hsl: 0.60, calibration: 0.40 };            // total 1.0 — skin protection is always strict
const PRESENCE_BUDGET = { presence: 0.40, hsl: 0.60 };            // total 1.0

// Requirement/Task 2 priority order: "Prefer HSL/Curve for local colour
// style. Prefer Colour Grading for mood. Prefer WB for ambient mood only.
// Prefer Curve for tonal character. Never let Calibration dominate. Never
// let Basic Panel become dominant." Higher weight = more protected (scaled
// less) when a dimension is over budget.
const ENGINE_PRIORITY_WEIGHT = {
  curve: 1.00, colorGrading: 0.90, hsl: 0.80, wb: 0.50,
  calibration: 0.30, basicPanel: 0.20, presence: 0.35,
};

const DIMENSION_EXTRACTORS = {
  green: {
    hsl:          (p) => Math.abs(p.hsl.hsl_s_green ?? 0) + Math.abs(p.hsl.hsl_s_aqua ?? 0) * 0.5,
    calibration:  (p) => Math.abs(p.cal.cal_green_s ?? 0),
    colorGrading: (p) => ((p.grade.grd_sh_s ?? 0) + (p.grade.grd_mid_s ?? 0) + (p.grade.grd_hi_s ?? 0)) / 3,
    wb: () => 0, curve: () => 0, basicPanel: () => 0,
  },
  warm: {
    wb:           (p) => Math.abs(p.temp ?? 0),
    colorGrading: (p) => ((p.grade.grd_sh_s ?? 0) + (p.grade.grd_mid_s ?? 0) + (p.grade.grd_hi_s ?? 0)) / 3,
    calibration:  (p) => ['red','green','blue'].reduce((s,c) => s + Math.abs(p.cal[`cal_${c}_s`] ?? 0), 0) / 3,
    hsl:          (p) => (Math.abs(p.hsl.hsl_s_red ?? 0) + Math.abs(p.hsl.hsl_s_orange ?? 0)) / 2,
    curve: () => 0, basicPanel: () => 0,
  },
  shadow: {
    curve:        (p) => Math.max(0, (p.crv_sh ?? 5) - 5),
    basicPanel:   (p) => Math.abs(p.con ?? 0) + Math.abs(p.bl ?? 0),
    colorGrading: (p) => Math.abs(p.grade.grd_sh_s ?? 0),
    hsl: () => 0, calibration: () => 0, wb: () => 0,
  },
  general: {
    hsl:          (p) => HSL_CHANNELS.reduce((s, ch) => s + Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0), 0) / HSL_CHANNELS.length,
    calibration:  (p) => ['red','green','blue'].reduce((s,c) => s + Math.abs(p.cal[`cal_${c}_s`] ?? 0), 0) / 3,
    colorGrading: (p) => ((p.grade.grd_sh_s ?? 0) + (p.grade.grd_mid_s ?? 0) + (p.grade.grd_hi_s ?? 0)) / 3,
    wb:           (p) => (Math.abs(p.temp ?? 0) + Math.abs(p.tint ?? 0)) / 2,
    curve:        (p) => Math.abs((p.crv_hi ?? 248) - 248) + Math.abs((p.crv_sh ?? 5) - 5),
    basicPanel:   (p) => Math.abs(p.con ?? 0),
  },
  // NEW (Refinement Patch): HSL + Calibration both pushing red/orange skin
  // channels — checked whenever skin is present, independent of whichever
  // style budget the reference's colour family selected.
  skin: {
    hsl:         (p) => (Math.abs(p.hsl.hsl_s_red ?? 0) + Math.abs(p.hsl.hsl_s_orange ?? 0)) / 2,
    calibration: (p) => Math.abs(p.cal.cal_red_s ?? 0),
    colorGrading: () => 0, wb: () => 0, curve: () => 0, basicPanel: () => 0, presence: () => 0,
  },
  // NEW (Refinement Patch): Vibrance + Saturation + HSL saturation all
  // increasing colour intensity together — checked on every image.
  presence: {
    presence: (p) => (Math.abs(p.vib ?? 0) + Math.abs(p.sat ?? 0) * 1.5) / 2,
    hsl:      (p) => HSL_CHANNELS.reduce((s, ch) => s + Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0), 0) / HSL_CHANNELS.length,
    calibration: () => 0, colorGrading: () => 0, wb: () => 0, curve: () => 0, basicPanel: () => 0,
  },
};
const BUDGET_NAME_TO_DIMENSION = {
  greenMoodBudget: 'green', warmMoodBudget: 'warm', shadowMoodBudget: 'shadow', balancedBudget: 'general',
};
const DIMENSION_LABEL = { green: 'Green', warm: 'Warm', shadow: 'Shadow', general: 'Overall', skin: 'Skin protection', presence: 'Colour intensity' };
const ENGINE_LABEL = { hsl: 'HSL', calibration: 'Calibration', colorGrading: 'Colour Grading', wb: 'White Balance', curve: 'Tone Curve', basicPanel: 'Basic Panel', presence: 'Vibrance/Saturation' };

/** Applies a scale factor to whichever preset fields represent `engine`'s
 *  contribution to `dimension` — the concrete counterpart to the abstract
 *  magnitude the extractor table measured above. Returns {before, after}
 *  for the PRIMARY field touched, for structured trace logging. */
function _applyEngineDimensionScale(p, engine, dimension, scale) {
  const r = (v) => Math.round((v ?? 0) * scale);
  let before = 0, after = 0;
  if (dimension === 'green') {
    if (engine === 'hsl')          { before = p.hsl.hsl_s_green; p.hsl.hsl_s_green = r(p.hsl.hsl_s_green); p.hsl.hsl_s_aqua = r(p.hsl.hsl_s_aqua); after = p.hsl.hsl_s_green; }
    if (engine === 'calibration')  { before = p.cal.cal_green_s; p.cal.cal_green_s = r(p.cal.cal_green_s); after = p.cal.cal_green_s; }
    if (engine === 'colorGrading') { before = p.grade.grd_sh_s; for (const z of ['sh','mid','hi']) p.grade[`grd_${z}_s`] = r(p.grade[`grd_${z}_s`]); after = p.grade.grd_sh_s; }
  } else if (dimension === 'warm') {
    if (engine === 'wb')           { before = p.temp; p.temp = r(p.temp); after = p.temp; }
    if (engine === 'colorGrading') { before = p.grade.grd_sh_s; for (const z of ['sh','mid','hi']) p.grade[`grd_${z}_s`] = r(p.grade[`grd_${z}_s`]); after = p.grade.grd_sh_s; }
    if (engine === 'calibration')  { before = p.cal.cal_red_s; for (const c of ['red','green','blue']) p.cal[`cal_${c}_s`] = r(p.cal[`cal_${c}_s`]); after = p.cal.cal_red_s; }
    if (engine === 'hsl')          { before = p.hsl.hsl_s_red; p.hsl.hsl_s_red = r(p.hsl.hsl_s_red); p.hsl.hsl_s_orange = r(p.hsl.hsl_s_orange); after = p.hsl.hsl_s_red; }
  } else if (dimension === 'shadow') {
    if (engine === 'curve')        { before = p.crv_sh; p.crv_sh = 5 + r((p.crv_sh ?? 5) - 5); after = p.crv_sh; }
    if (engine === 'basicPanel')   { before = p.con; p.con = r(p.con); p.bl = r(p.bl); after = p.con; }
    if (engine === 'colorGrading') { before = p.grade.grd_sh_s; p.grade.grd_sh_s = r(p.grade.grd_sh_s); after = p.grade.grd_sh_s; }
  } else if (dimension === 'skin') {
    if (engine === 'hsl')          { before = p.hsl.hsl_s_red; p.hsl.hsl_s_red = r(p.hsl.hsl_s_red); p.hsl.hsl_s_orange = r(p.hsl.hsl_s_orange); after = p.hsl.hsl_s_red; }
    if (engine === 'calibration')  { before = p.cal.cal_red_s; p.cal.cal_red_s = r(p.cal.cal_red_s); after = p.cal.cal_red_s; }
  } else if (dimension === 'presence') {
    if (engine === 'presence')     { before = p.vib; p.vib = r(p.vib); p.sat = r(p.sat); after = p.vib; }
    if (engine === 'hsl')          { before = HSL_CHANNELS.reduce((s,ch)=>s+Math.abs(p.hsl[`hsl_s_${ch}`]??0),0); for (const ch of HSL_CHANNELS) p.hsl[`hsl_s_${ch}`] = r(p.hsl[`hsl_s_${ch}`]); after = HSL_CHANNELS.reduce((s,ch)=>s+Math.abs(p.hsl[`hsl_s_${ch}`]??0),0); }
  } else { // general — covers balancedBudget
    if (engine === 'hsl')          { before = HSL_CHANNELS.reduce((s,ch)=>s+Math.abs(p.hsl[`hsl_s_${ch}`]??0),0); for (const ch of HSL_CHANNELS) p.hsl[`hsl_s_${ch}`] = r(p.hsl[`hsl_s_${ch}`]); after = HSL_CHANNELS.reduce((s,ch)=>s+Math.abs(p.hsl[`hsl_s_${ch}`]??0),0); }
    if (engine === 'calibration')  { before = p.cal.cal_red_s; for (const c of ['red','green','blue']) p.cal[`cal_${c}_s`] = r(p.cal[`cal_${c}_s`]); after = p.cal.cal_red_s; }
    if (engine === 'colorGrading') { before = p.grade.grd_sh_s; for (const z of ['sh','mid','hi']) p.grade[`grd_${z}_s`] = r(p.grade[`grd_${z}_s`]); after = p.grade.grd_sh_s; }
    if (engine === 'wb')           { before = p.temp; p.temp = r(p.temp); p.tint = r(p.tint); after = p.temp; }
    if (engine === 'curve')        { before = p.crv_hi; p.crv_hi = 248 + r((p.crv_hi ?? 248) - 248); p.crv_sh = 5 + r((p.crv_sh ?? 5) - 5); after = p.crv_hi; }
    if (engine === 'basicPanel')   { before = p.con; p.con = r(p.con); after = p.con; }
  }
  return { before, after };
}

/** Requirement 1: fold transferConfidence/decisionConfidence/reference
 *  complexity (proxied by transferRiskEstimate, the only complexity signal
 *  available at mapping time) into a single multiplier that tightens
 *  budget enforcement further on risky-to-transfer references, even when
 *  nothing is technically over its raw budget share yet.
 *
 *  Note: finalStyleIntentConfidence, photographerAcceptance, and
 *  editingDistanceEstimate are all computed LATER in the pipeline (Decision
 *  Report, Style Benchmark, and Reference Transfer Intelligence
 *  respectively all run after Lightroom Mapping) and genuinely cannot
 *  inform this pass without reordering the pipeline, which this patch
 *  explicitly forbids. decisionConfidence/transferAwareConfidence/
 *  transferRiskEstimate are the three requested factors that ARE available
 *  here, and stand in as the practical proxy set — documented honestly
 *  rather than faked. */
function _computeBudgetRiskMultiplier({ decisionConfidence = 0.7, transferAwareConfidence = 0.7, transferRiskEstimate = null }) {
  const complexityProxy = transferRiskEstimate?.score ?? 0.3;
  const base = decisionConfidence * 0.35 + transferAwareConfidence * 0.35 + (1 - complexityProxy) * 0.30;
  return clamp(base, 0.5, 1.0);
}

/**
 * Enforces one dimension's budget: measures total combined usage, and if
 * over 1.0, distributes the reduction using PRIORITY-WEIGHTED scaling —
 * lower-priority engines (Calibration, Basic Panel) absorb more of the
 * excess than higher-priority ones (Tone Curve, Colour Grading), per the
 * spec's "keep the highest-priority contributor, soften lower-priority
 * contributors" requirement. Logs a structured trace entry per adjustment.
 */
function _enforceDimensionBudget(p, dimension, budget, riskMultiplier, log, engines) {
  const extractors = DIMENSION_EXTRACTORS[dimension];
  const usage = {};
  let totalRatio = 0;
  for (const eng of engines) {
    const share = budget[eng] ?? 0;
    if (share <= 0) continue;
    const magnitude = extractors[eng]?.(p) ?? 0;
    const maxAllowed = share * BUDGET_SCALE;
    const ratio = maxAllowed > 0 ? magnitude / maxAllowed : 0;
    usage[eng] = { magnitude, maxAllowed, ratio };
    totalRatio += ratio;
  }
  const involved = Object.keys(usage).filter(e => usage[e].magnitude > 0.5);
  if (!involved.length) return false;

  const label = DIMENSION_LABEL[dimension] ?? dimension;

  if (totalRatio > 1.0) {
    // Priority-weighted excess distribution: engines with LOWER priority
    // weight absorb a larger share of the (totalRatio - 1.0) excess.
    const excess = totalRatio - 1.0;
    const inversePriority = {};
    let totalInverse = 0;
    for (const eng of involved) {
      inversePriority[eng] = 1 - (ENGINE_PRIORITY_WEIGHT[eng] ?? 0.5);
      totalInverse += inversePriority[eng] || 0.05;   // avoid zero-division for top-priority-only cases
    }
    for (const eng of involved) {
      const engineExcessShare = excess * ((inversePriority[eng] || 0.05) / totalInverse);
      const newRatio = Math.max(0.05, usage[eng].ratio - engineExcessShare);
      let scale = usage[eng].ratio > 0 ? newRatio / usage[eng].ratio : 1.0;
      scale = clamp(scale * riskMultiplier, MIN_ENGINE_SCALE, 1.0);
      if (scale >= 0.98) continue;   // negligible — skip logging a no-op
      const { before, after } = _applyEngineDimensionScale(p, eng, dimension, scale);
      log('style-budget',
        `${label} mood budget: ${ENGINE_LABEL[eng]} was contributing to the same ${dimension === 'general' ? 'overall' : dimension} mood alongside ${involved.filter(e=>e!==eng).map(e=>ENGINE_LABEL[e]).join(', ')} (combined usage ${totalRatio.toFixed(2)}× the 1.0 share) — softened ×${scale.toFixed(2)} because it has lower editing priority here.`,
        {
          section: ENGINE_LABEL[eng], dimension, originalValue: before, finalValue: after,
          scaleFactor: +scale.toFixed(3), reason: 'stacking-over-budget', budget: budget.name ?? DIMENSION_LABEL[dimension],
          stackingRisk: +totalRatio.toFixed(2), softened: true, clamped: false,
        });
    }
    return true;
  } else if (riskMultiplier < 0.9 && involved.length > 1) {
    for (const eng of involved) {
      const scale = clamp(riskMultiplier, MIN_ENGINE_SCALE, 1.0);
      if (scale >= 0.98) continue;
      const { before, after } = _applyEngineDimensionScale(p, eng, dimension, scale);
      log('style-budget',
        `${label} mood budget within share, but transfer/decision confidence (risk multiplier ×${scale.toFixed(2)}) applied extra caution to ${ENGINE_LABEL[eng]}.`,
        { section: ENGINE_LABEL[eng], dimension, originalValue: before, finalValue: after, scaleFactor: +scale.toFixed(3), reason: 'low-confidence-caution', budget: budget.name ?? DIMENSION_LABEL[dimension], stackingRisk: +totalRatio.toFixed(2), softened: true, clamped: false });
    }
    return true;
  }
  return false;
}

function _enforceStyleBudget(preset, budget, riskCtx, log) {
  // Requirement 3 (Implementation Requirements): safe default so the
  // universal skin/presence checks below still run even with no
  // style-specific budget at all.
  const effectiveBudget = budget ?? DEFAULT_BUDGET;
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };
  const riskMultiplier = _computeBudgetRiskMultiplier(riskCtx);
  const allEngines = ['hsl', 'calibration', 'colorGrading', 'wb', 'curve', 'basicPanel', 'presence'];

  // 1. Style-specific dimension (green / warm / shadow / general).
  const dimension = BUDGET_NAME_TO_DIMENSION[effectiveBudget.name] ?? 'general';
  _enforceDimensionBudget(p, dimension, effectiveBudget, riskMultiplier, log, allEngines);

  // 2. Universal: skin protection — HSL + Calibration both pushing
  //    red/orange, checked whenever skin is present regardless of style.
  if (riskCtx.hasSkin) {
    _enforceDimensionBudget(p, 'skin', SKIN_BUDGET, riskMultiplier, log, ['hsl', 'calibration']);
  }

  // 3. Universal: presence — Vibrance + Saturation + HSL all increasing
  //    colour intensity together, checked on every image.
  _enforceDimensionBudget(p, 'presence', PRESENCE_BUDGET, riskMultiplier, log, ['presence', 'hsl']);

  return p;
}

// ─── Task 2.3A + 2.3C: Slider Relationship Modelling & Cross-slider
//     Optimisation ────────────────────────────────────────────────────────
// Sliders are treated as a CONNECTED SYSTEM here, not optimised in
// isolation — this pass runs once, after every section has a value, and
// only softens (never strengthens) compounding combinations.
function _crossSliderOptimize(preset, { intent, transferRiskEstimate }, log) {
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };

  // 1. Exposure ↔ Highlights ↔ Whites — both pushing the same direction
  //    compounds past what either alone would do.
  if (p.exp > 10 && p.wh > 10) {
    const before = p.wh;
    p.wh = Math.round(p.wh * 0.7);
    log('cross-slider', `Exposure (+${p.exp}) and Whites (+${before}) both push brighter - Whites eased to ${p.wh} to avoid compounding.`);
  }
  if (p.exp < -10 && p.hi < -20) {
    const before = p.hi;
    p.hi = Math.round(p.hi * 0.75);
    log('cross-slider', `Exposure (${p.exp}) and Highlights (${before}) both push darker - Highlights eased to ${p.hi} to avoid compounding.`);
  }

  // 2. Contrast ↔ Tone Curve — if the curve's own anchors already imply
  //    strong contrast (wide shadow->highlight spread), Basic Panel's
  //    contrast push is redundant and should ease back.
  const curveSpread = (p.crv_hi ?? 248) - (p.crv_sh ?? 5);
  const curveIsContrasty = curveSpread > 250;   // wider than the ~243 baseline
  if (p.con > 15 && curveIsContrasty) {
    const before = p.con;
    p.con = Math.round(p.con * 0.7);
    log('cross-slider', `Tone Curve already implies strong contrast (spread ${curveSpread}) - Basic contrast eased from ${before} to ${p.con}.`);
  }

  // 3. Temp ↔ Tint — both strong at once is a common over-correction sign.
  if (Math.abs(p.temp) > 25 && Math.abs(p.tint) > 15) {
    const beforeTemp = p.temp, beforeTint = p.tint;
    p.temp = Math.round(p.temp * 0.75);
    p.tint = Math.round(p.tint * 0.75);
    log('cross-slider', `Temp (${beforeTemp}) and Tint (${beforeTint}) are both strong - softened to temp=${p.temp}, tint=${p.tint}.`);
  }

  // 4. Texture ↔ Clarity — both pushing soft/negative compounds into an
  //    overly hazy result; Clarity is the primary tool, Texture eases back.
  if (p.texture < -8 && p.clarity < -8) {
    const before = p.texture;
    p.texture = Math.round(p.texture * 0.5);
    log('cross-slider', `Texture (${before}) and Clarity (${p.clarity}) both push soft - Texture eased to ${p.texture} (Clarity remains primary).`);
  }

  // 5. Saturation ↔ Vibrance ↔ HSL — three separate levers pushing
  //    saturation up at once compounds far past any single one's intent.
  const avgHslSat = HSL_CHANNELS.reduce((s, ch) => s + Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0), 0) / HSL_CHANNELS.length;
  if (p.vib > 15 && p.sat > 0 && avgHslSat > 8) {
    const beforeVib = p.vib;
    p.vib = Math.round(p.vib * 0.8);
    log('cross-slider', `Vibrance (${beforeVib}), Saturation, and HSL (avg ${avgHslSat.toFixed(1)}) all push saturation together - Vibrance eased to ${p.vib}.`);
  }

  // 6. Calibration ↔ HSL — both producing strong colour separation in the
  //    same direction is a compounding risk the spec calls out explicitly.
  const calMag = ['red','green','blue'].reduce((s, c) => s + Math.abs(p.cal[`cal_${c}_s`] ?? 0), 0);
  const hslMag = HSL_CHANNELS.reduce((s, ch) => s + Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0), 0);
  if (calMag > 15 && hslMag > 40) {
    const beforeCal = calMag;
    for (const c of ['red','green','blue']) p.cal[`cal_${c}_s`] = Math.round((p.cal[`cal_${c}_s`] ?? 0) * 0.6);
    for (const ch of HSL_CHANNELS) p.hsl[`hsl_s_${ch}`] = Math.round((p.hsl[`hsl_s_${ch}`] ?? 0) * 0.8);
    log('cross-slider', `Calibration (magnitude ${beforeCal.toFixed(0)}) and HSL (magnitude ${hslMag.toFixed(0)}) both drive strong colour separation - both reduced.`);
  }

  // 7. High contrast + strong matte + lifted blacks — physically
  //    contradictory combination named explicitly in the spec: a "matte"
  //    look (lifted blacks) doesn't usually co-occur with punchy high
  //    contrast. Defer to the detected intent to decide which one gives way.
  if (p.con > 15 && p.bl > 10) {
    if (intent.isMatte || intent.isSoft) {
      const before = p.con;
      p.con = Math.round(p.con * 0.6);
      log('cross-slider', `High contrast (+${before}) conflicts with lifted blacks (+${p.bl}, matte look) - contrast reduced to ${p.con} in favour of the detected matte intent.`);
    } else {
      const before = p.bl;
      p.bl = Math.round(p.bl * 0.6);
      log('cross-slider', `High contrast (+${p.con}) conflicts with lifted blacks (+${before}) - blacks reduced to ${p.bl} in favour of the detected high-contrast intent.`);
    }
  }

  // Task 2.3E: Transfer-aware mapping — high estimated transfer risk means
  // this look depends heavily on THIS scene; avoid trying to push an
  // aggressive imitation of it onto a different photo. (decisionConfidence/
  // transferAwareConfidence already scaled the trust weights upstream —
  // this is an additional pass specifically over the FINAL compounded
  // values, catching cases the earlier per-engine scaling couldn't see.)
  if (transferRiskEstimate?.level === 'high') {
    const gradeMag = (p.grade.grd_sh_s ?? 0) + (p.grade.grd_mid_s ?? 0) + (p.grade.grd_hi_s ?? 0);
    if (gradeMag > 25) {
      const scale = 0.8;
      p.grade.grd_sh_s = Math.round(p.grade.grd_sh_s * scale);
      p.grade.grd_mid_s = Math.round(p.grade.grd_mid_s * scale);
      p.grade.grd_hi_s = Math.round(p.grade.grd_hi_s * scale);
      log('transfer', `High transfer risk (${transferRiskEstimate.score}) - Colour Grading saturation (was ${gradeMag.toFixed(0)}) eased x${scale} to avoid imitating a look this scene-dependent on a different photo.`);
    }
  }

  return p;
}

// ─── Task 2.3F: Final Mapping Validation ─────────────────────────────────────
// Checks SECTIONS against each other, not individual sliders — the last
// gate before Pre-XMP Validation. Never strengthens a value, only pulls
// contradicting sections back toward agreement.
function _finalMappingValidation(preset, { intent, decision }, log) {
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };

  // Basic Panel vs Colour Grading mood direction: Basic exposure direction
  // should not fight the overall brightness balance Colour Grading implies
  // (shadow/highlight luminance balance).
  const gradeBrightnessBias = (p.grade.grd_hi_l ?? 0) - (p.grade.grd_sh_l ?? 0);
  if (p.exp > 8 && gradeBrightnessBias < -10) {
    const before = p.exp;
    p.exp = Math.round(p.exp * 0.6);
    log('validation', `Basic Panel pushed brighter (exp=+${before}) while Colour Grading balance leans darker (${gradeBrightnessBias}) - exposure eased to ${p.exp} for mood consistency.`);
  }
  if (p.exp < -8 && gradeBrightnessBias > 10) {
    const before = p.exp;
    p.exp = Math.round(p.exp * 0.6);
    log('validation', `Basic Panel pushed darker (exp=${before}) while Colour Grading balance leans brighter (+${gradeBrightnessBias}) - exposure eased to ${p.exp} for mood consistency.`);
  }

  // Tone Curve vs Style Intent: an airy/high-key intent contradicted by a
  // curve that still crushes shadows hard, or a moody/matte intent
  // contradicted by a curve blowing highlights up, gets nudged back.
  if (intent.isAiry && (p.crv_sh ?? 5) < 3) {
    const before = p.crv_sh;
    p.crv_sh = 8;
    log('validation', `Tone Curve shadow anchor (${before}) contradicted the detected airy/high-key intent - nudged to ${p.crv_sh}.`);
  }
  if ((intent.isMoody || intent.isMatte) && (p.crv_hi ?? 248) > 252) {
    const before = p.crv_hi;
    p.crv_hi = 248;
    log('validation', `Tone Curve highlight anchor (${before}) contradicted the detected moody/matte intent - nudged to ${p.crv_hi}.`);
  }

  return p;
}

// ─── Basic Panel mapping ────────────────────────────────────────────────────
// basic-panel-engine already returns modest, style-preserving values. Here
// we (a) clamp to the same universal STYLE_LIMIT as a safety net, (b) apply
// a scene-adaptive support-only dampening factor (Phase 5: basicDampen,
// chosen per-image by Decision Engine instead of one fixed constant) so
// Basic Panel mathematically cannot out-weigh the colour-style engines, and
// (c) enforce direction guards for moody/airy scenes: a moody-dark
// reference must never get auto-brightened, and an airy-bright reference
// must never get aggressively darkened, regardless of what Basic Panel's
// own (already-modest) suggestion was.
function _mapBasicPanel(basic, basicDampen = 0.85, noAutoBrighten = false, noAggressiveDarken = false) {
  const dampen = (v, [lo, hi]) => clamp(Math.round((v ?? 0) * basicDampen), lo, hi);
  let exp = dampen(basic?.exposure?.value,   STYLE_LIMIT.exposure);
  let hi  = dampen(basic?.highlights?.value, STYLE_LIMIT.highlights);
  const con = dampen(basic?.contrast?.value,   STYLE_LIMIT.contrast);
  const sh  = dampen(basic?.shadows?.value,    STYLE_LIMIT.shadows);
  const wh  = dampen(basic?.whites?.value,     STYLE_LIMIT.whites);
  const bl  = dampen(basic?.blacks?.value,     STYLE_LIMIT.blacks);

  // Guard: moody_dark mood — never let Basic Panel brighten the image.
  if (noAutoBrighten) { exp = Math.min(exp, 0); hi = Math.min(hi, 0); }
  // Guard: airy_bright mood — never let Basic Panel darken aggressively;
  // relax the floor to a gentler minimum than the universal STYLE_LIMIT.
  if (noAggressiveDarken) { exp = Math.max(exp, -15); hi = Math.max(hi, -25); }

  return { exp, con, hi, sh, wh, bl };
}

// ─── White Balance mapping ──────────────────────────────────────────────────
// Stage 2.1: maps WB INTENT, not raw correction. wb.wbIntent already encodes
// how much of the raw temperature/tint reading should survive transfer
// (intensity: subtle/moderate/limited, driven by transferRisk/confidence) —
// this function applies that intent-scale on top of the existing mood-
// preservation factor, rather than reading the raw consensus directly.
const WB_INTENSITY_SCALE = { subtle: 0.5, moderate: 0.8, limited: 1.0 };

function _mapWhiteBalance(wb, fingerprint, portraitSafe, hasSkin, skinHue, wbDampen = 1.0) {
  const rawTemp = wb?.consensus?.temperature ?? 0;
  const rawTint = wb?.consensus?.tint ?? 0;
  const pf = fingerprint?.wbMoodPreservation?.preservationFactor ?? 0.4;

  const intent = wb?.wbIntent;
  const intensityScale = intent ? (WB_INTENSITY_SCALE[intent.intensity] ?? 0.8) : 0.8;

  let temp = Math.round(rawTemp * pf * intensityScale * wbDampen);
  let tint = Math.round(rawTint * pf * intensityScale * wbDampen);

  if (intent?.mixedLightingRisk > 0.3) {
    temp = Math.round(temp * 0.7);
    tint = Math.round(tint * 0.7);
  }
  if (intent?.greenBounceRisk > 0.3 && tint < 0) {
    tint = Math.round(tint * 0.5);
  }

  if (portraitSafe) {
    temp = clamp(temp, -12, 12);
    tint = clamp(tint, -10, 12);
    if (hasSkin) {
      const hue = skinHue ?? 30;
      const skinIsYellowGreen = hue > 40 && hue < 90;
      if (skinIsYellowGreen && tint < -6) tint = -6;
      if (intent?.skinWarmth?.direction !== 'unknown' && (intent?.skinWarmth?.confidence ?? 0) > 0.6) {
        if (intent.skinWarmth.direction === 'warm' && tint < -4) tint = -4;
      }
    }
  }
  temp = clamp(temp, -50, 50);
  tint = clamp(tint, -30, 30);
  return { temp, tint };
}

// ─── Vibrance mapping ───────────────────────────────────────────────────────
function _mapVibrance(stats, portraitSafe) {
  const avgSat = stats?.avgSatPct ?? 30;
  if (portraitSafe) return clamp(Math.round((50 - avgSat) * 0.45), 0, 12);
  return clamp(Math.round((55 - avgSat) * 0.6), -10, 30);
}

// ─── HSL mapping ────────────────────────────────────────────────────────────
const WARM_CHANNELS = new Set(['red','orange','yellow']);
const LANDSCAPE_CHANNELS = new Set(['green','aqua','blue']);

function _mapHSL(hsl, isPortrait, portraitSafe, skinLockScale, hslDampen = 1.0, protectWarmChannels = false, strongColorAllowed = false) {
  const out = {};
  if (!hsl) {
    for (const ch of HSL_CHANNELS) { out[`hsl_h_${ch}`]=0; out[`hsl_s_${ch}`]=0; out[`hsl_l_${ch}`]=0; }
    return out;
  }
  for (const ch of HSL_CHANNELS) {
    const r = hsl.channels?.[ch];
    if (!r) { out[`hsl_h_${ch}`]=0; out[`hsl_s_${ch}`]=0; out[`hsl_l_${ch}`]=0; continue; }
    const skinScale = isPortrait && SKIN_CHANNELS.has(ch) ? skinLockScale : 1.0;
    const scale = skinScale * hslDampen;
    const hAdj = Math.round(r.hueAdj * scale);
    let   sAdj = Math.round(r.satAdj * scale);
    const lAdj = Math.round(r.lumAdj * scale);

    if (portraitSafe && SKIN_CHANNELS.has(ch)) {
      out[`hsl_h_${ch}`] = clamp(hAdj, -2, 2);
      out[`hsl_s_${ch}`] = clamp(sAdj, -6, 4);
      out[`hsl_l_${ch}`] = ch === 'orange' ? clamp(lAdj, -4, 8) : clamp(lAdj, -6, 6);
      continue;
    }
    if (portraitSafe && COLOR_CHANNELS.has(ch)) {
      out[`hsl_h_${ch}`] = clamp(hAdj, -8, 8);
      out[`hsl_s_${ch}`] = clamp(sAdj, -10, 0);
      out[`hsl_l_${ch}`] = clamp(lAdj, -8, 8);
      continue;
    }
    if (protectWarmChannels && WARM_CHANNELS.has(ch)) {
      out[`hsl_h_${ch}`] = clamp(hAdj, -6, 6);
      out[`hsl_s_${ch}`] = clamp(sAdj, -10, 12);
      out[`hsl_l_${ch}`] = clamp(lAdj, -8, 10);
      continue;
    }
    if (strongColorAllowed && LANDSCAPE_CHANNELS.has(ch)) {
      out[`hsl_h_${ch}`] = clamp(hAdj, -20, 20);
      out[`hsl_s_${ch}`] = clamp(sAdj, -20, 24);
      out[`hsl_l_${ch}`] = clamp(lAdj, -20, 20);
      continue;
    }
    out[`hsl_h_${ch}`] = hAdj;
    out[`hsl_s_${ch}`] = sAdj;
    out[`hsl_l_${ch}`] = lAdj;
  }
  return out;
}

// ─── Colour Grading mapping ─────────────────────────────────────────────────
function _mapColorGrading(g, isPortrait, portraitSafe, strength = 1.0, strongColorAllowed = false) {
  const out = { grd_sh_h:0,grd_sh_s:0,grd_sh_l:0,grd_mid_h:0,grd_mid_s:0,grd_mid_l:0,grd_hi_h:0,grd_hi_s:0,grd_hi_l:0,grd_blend:50 };
  if (!g) return out;
  const SAT_MAX = isPortrait ? 12 : strongColorAllowed ? 26 : 22;
  const scaleHue = (hue) => hue === 0 ? 0 : Math.round(hue);
  out.grd_sh_h  = scaleHue(g.shadows?.hue  ?? 0);
  out.grd_sh_s  = clamp(Math.round((g.shadows?.sat  ?? 0) * strength), 0, SAT_MAX);
  out.grd_sh_l  = clamp(g.shadows?.balance ?? 0, -25, 25);
  out.grd_mid_h = clamp(g.midtones?.hue    ?? 0, 0, 360);
  out.grd_mid_s = clamp(g.midtones?.sat    ?? 0, 0, portraitSafe ? 4 : isPortrait ? 6 : 14);
  out.grd_mid_l = clamp(g.midtones?.balance?? 0, -15, 15);
  out.grd_hi_h  = scaleHue(g.highlights?.hue ?? 0);
  out.grd_hi_s  = clamp(Math.round((g.highlights?.sat ?? 0) * strength), 0, SAT_MAX);
  out.grd_hi_l  = clamp(g.highlights?.balance ?? 0, -25, 25);
  out.grd_blend = clamp(g.blending ?? 50, 30, 70);
  return out;
}

// ─── Calibration mapping ────────────────────────────────────────────────────
function _mapCalibration(cal, hasSkin, portraitSafe, calDampen = 1.0) {
  const MAX  = portraitSafe ? 3 : hasSkin ? 4 : 20;
  const SMAX = portraitSafe ? 4 : hasSkin ? 6 : 30;
  const d = (v) => Math.round((v ?? 0) * calDampen);
  return {
    cal_red_h:   clamp(d(cal?.red?.hue),   -MAX,  MAX),
    cal_red_s:   clamp(d(cal?.red?.sat),   -SMAX, SMAX),
    cal_green_h: clamp(d(cal?.green?.hue), -MAX,  MAX),
    cal_green_s: clamp(d(cal?.green?.sat), -SMAX, SMAX),
    cal_blue_h:  clamp(d(cal?.blue?.hue),  -MAX,  MAX),
    cal_blue_s:  clamp(d(cal?.blue?.sat),  -SMAX, SMAX),
  };
}
