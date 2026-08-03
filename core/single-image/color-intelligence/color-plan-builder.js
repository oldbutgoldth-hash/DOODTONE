/**
 * core/single-image/color-intelligence/color-plan-builder.js
 *
 * EPIC 2E-P1E — turns `colorSignals` (evidence-color-signals.js) plus
 * the Candidate's CURRENT (already reshaped, already legacy-dampened)
 * color fields into a bounded "Color Plan": the final values P1E will
 * write into the Candidate, plus a per-field, human-readable reason.
 *
 * CORE IDEA ("restoration, not invention"): the real Core engines
 * (hsl-analyzer-engine, colorgrading-ai-engine, calibration-engine)
 * already compute a reasoned, bounded, guardrail-aware recommendation
 * per channel/zone/primary. By the time that recommendation reaches
 * the canonical Candidate, several independent, individually-
 * reasonable trust/confidence multipliers in the legacy decision
 * pipeline have already been applied to it (scene trust weights,
 * per-engine confidence scaling, safety clamps) -- and because those
 * multipliers compound, many fields end up far closer to zero than
 * the original evidence justified, even though no single step was
 * wrong on its own.
 *
 * P1E does not re-run or second-guess that pipeline, and it does not
 * invent new color from nothing. For each field family it asks one
 * question only: "how much of the gap between what evidence originally
 * recommended and what actually survived into the Candidate should be
 * restored, bounded and skin-safe?" -- never overshooting the
 * original evidence recommendation, and never acting on a
 * channel/zone/primary that lacks real coverage in the image.
 *
 * Pure function. No Session/DOM/Core-analysis access.
 */

import {
  STRENGTH_SCALARS, DEFAULT_STRENGTH_MODE, BOUNDS,
  MIN_MEANINGFUL_COVERAGE_PCT, MIN_GRADING_CONFIDENCE,
  HSL_CHANNEL_IDS, GRADING_ZONE_IDS, CAL_PRIMARY_IDS,
  SKIN_ADJACENT_HSL_CHANNELS, skinCautionScale, buildEmptyColorPlan,
} from './color-intelligence-schema.js';
import { classifyScene, getFamilyMultiplier } from './creative-tone-strategy.js';

function _clamp(v, mag) { return Math.max(-mag, Math.min(mag, v)); }

/**
 * EPIC 2E-P1E R3 -- Export-safe integer normalization.
 *
 * Every P1E-computed color field (HSL Hue/Saturation/Luminance,
 * Color Grading Hue/Saturation/Luminance, Calibration Hue/Saturation,
 * Vibrance/Saturation) corresponds to a real Lightroom slider whose
 * DOM step is always 1 whole unit (see candidate-validator.js
 * SLIDER_RANGES) and whose XMP property Lightroom itself stores and
 * displays as a whole number. Before this fix, a fractional
 * restoration result (e.g. `2 + 20 * 0.805 = 18.1`) was written into
 * the Candidate AS-IS and serialized into the XMP string verbatim
 * (`core/preset-engine/index.js` never rounds `hsl_s_*`/`grd_*_s`/
 * `cal_*_s` etc.) -- producing a non-integer XMP attribute value that
 * Lightroom would round or reject on its own terms, silently
 * reintroducing a Candidate/UI vs. Lightroom divergence identical in
 * class to the one this R3 round exists to close. Rounding HERE, once,
 * at the moment P1E commits its own recommendation, guarantees
 * Candidate current value === UI displayed value === export-expected
 * value === XMP value === Lightroom's own displayed value, for every
 * P1E-authored color field. See P1E_R3_EXPORT_SAFE_VALUE_POLICY.md.
 */
function _roundClean(v) { return Math.round(v); }

/**
 * EPIC 2E-P1E R2 — Circular Grading Hue fix.
 *
 * Normalizes any hue-like number into the canonical 0-359 degree
 * range. `((value % 360) + 360) % 360` (rather than a plain
 * `value % 360`) is required because JS's `%` returns a negative
 * result for a negative left-hand operand (e.g. `-10 % 360 === -10`,
 * not `350`).
 */
export function normalizeHue(value) {
  const v = Number.isFinite(value) ? value : 0;
  return ((v % 360) + 360) % 360;
}

/**
 * EPIC 2E-P1E R2 — Circular Grading Hue fix.
 *
 * Restores a `fraction` of the way from `current` to `target` along
 * the SHORTEST path around the 0/360 wrap point, for an ABSOLUTE,
 * cyclic hue value (Lightroom Color Grading Hue only). This is NOT a
 * drop-in replacement for `_restoreTowardEvidence()` below: it is
 * used ONLY for `grading.{shadows,midtones,highlights}.hue`, never
 * for HSL Hue adjustments or Calibration Hue -- both of the latter
 * are SIGNED RELATIVE adjustments (e.g. "+6 degrees"), not absolute
 * angles, and the generic linear/signed-conflict logic in
 * `_restoreTowardEvidence()` remains correct for them. See
 * P1E_R2_CIRCULAR_GRADING_HUE_FIX.md and
 * P1E_CREATIVE_TONE_HEURISTICS.md for the full rationale.
 *
 * `((targetHue - currentHue + 540) % 360) - 180` yields the shortest
 * SIGNED delta in the half-open range [-180, 180) (the `+540`, i.e.
 * `+180 + 360`, rather than `+180`, keeps the operand to `%` always
 * non-negative in JS, avoiding the same negative-modulo pitfall
 * `normalizeHue()` guards against). At an exact 180-degree
 * separation this formula deterministically evaluates to `-180` in
 * both directions (350->170 and 170->350 both compute a -180 delta
 * from their own starting point) -- i.e. the documented, deterministic
 * tie-break rule for an exact 180-degree difference is "always rotate
 * in the decreasing-degree direction from `current`". A fraction
 * greater than 1 (relevant to the internal STRONG strength mode, not
 * exposed in the UI this round) is never clamped to the evidence
 * target here -- the result is simply renormalized into 0-359, kept
 * deterministic by the same modulo arithmetic regardless of
 * magnitude.
 */
export function restoreCircularHue(current, target, fraction) {
  const currentHue = normalizeHue(current);
  const targetHue = normalizeHue(target);
  const shortestDelta = ((targetHue - currentHue + 540) % 360) - 180;
  return normalizeHue(currentHue + shortestDelta * fraction);
}

/**
 * Restores a bounded fraction of the gap between `current` (the
 * already-dampened Candidate value) and `evidenceTarget` (the Core
 * engine's own reasoned recommendation), never exceeding
 * `evidenceTarget` in magnitude and never flipping sign relative to
 * `evidenceTarget` when the two disagree (a sign conflict signals
 * real uncertainty -- the conservative choice is to change nothing).
 *
 * NOT used for Color Grading Hue (see `restoreCircularHue()` above) --
 * still used for every other field this module restores, including
 * HSL Hue and Calibration Hue, which are signed relative adjustments,
 * not absolute cyclic angles.
 */
function _restoreTowardEvidence(current, evidenceTarget, fraction, hardBound) {
  const cur = Number.isFinite(current) ? current : 0;
  const tgt = Number.isFinite(evidenceTarget) ? evidenceTarget : 0;
  if (tgt === 0) return _clamp(cur, hardBound);
  if (cur !== 0 && Math.sign(cur) !== Math.sign(tgt)) {
    // Genuine disagreement between legacy pipeline and fresh evidence
    // re-derivation -- stay conservative, keep the smaller-magnitude
    // (already-vetted) legacy value rather than push in either
    // direction on P1E's own authority.
    return _clamp(cur, hardBound);
  }
  const gap = tgt - cur;
  const restored = cur + gap * fraction;
  // Never overshoot the evidence target itself.
  const boundedByEvidence = Math.abs(restored) > Math.abs(tgt) ? tgt : restored;
  return _clamp(boundedByEvidence, hardBound);
}

export function buildColorPlan({ candidateColorFields, signals, strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const plan = buildEmptyColorPlan();
  plan.strengthMode = strengthMode;
  const scalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS[DEFAULT_STRENGTH_MODE];
  const reasons = [];
  const fieldsBoosted = [];

  const skinScale = skinCautionScale({
    skinCoveragePct: signals?.skin?.coveragePct ?? null,
    skinConfidence: signals?.skin?.confidence ?? null,
  });
  plan.skinProtection = {
    applied: skinScale < 1,
    coveragePct: signals?.skin?.coveragePct ?? null,
    confidence: signals?.skin?.confidence ?? null,
    scale: skinScale,
  };

  // EPIC 2E-P1E R3 -- scene-aware creative tone layer. classifyScene()
  // reads ONLY evidence already available (signals) plus the
  // Candidate's own current color fields (never fabricates a signal).
  // getFamilyMultiplier() returns a small, bounded [0.5, 1.3] per-
  // field-family multiplier folded into the SAME restoration
  // `fraction` every field family already computes below -- the final
  // result is still always passed through the SAME hard `_clamp(...,
  // hardBound)` inside `_restoreTowardEvidence()`/`restoreCircularHue()`,
  // so no scene multiplier can ever push a value outside `BOUNDS`.
  // Skin channels never receive the `hslNonSkin` multiplier -- they
  // keep ONLY their own, separate, always-active `skinScale` above,
  // preserving "skin protection has structural priority" regardless
  // of scene class. See P1E_R3_EVIDENCE_TO_CREATIVE_TONE_MAP.md and
  // P1E_R3_CREATIVE_TONE_STRENGTH_MODEL.md.
  const sceneResult = classifyScene({ signals, candidateColorFields });
  plan.sceneClass = sceneResult.sceneClass;
  plan.sceneReasons = sceneResult.reasons;
  plan.sceneSignalsUsed = sceneResult.signalsUsed;
  const sceneMult = {
    hslNonSkin: getFamilyMultiplier(sceneResult.sceneClass, 'hslNonSkin'),
    presenceVibrance: getFamilyMultiplier(sceneResult.sceneClass, 'presenceVibrance'),
    presenceSaturation: getFamilyMultiplier(sceneResult.sceneClass, 'presenceSaturation'),
    grading: getFamilyMultiplier(sceneResult.sceneClass, 'grading'),
    calibration: getFamilyMultiplier(sceneResult.sceneClass, 'calibration'),
  };
  // Documented technicalCorrection / creativeTone split (R3
  // formalization, no duplicated formula -- see creative-tone-
  // strategy.js header): technicalCorrection = restraint-only signals
  // (ALREADY_SATURATED scene class + the pre-existing skinScale, both
  // <=1.0 multipliers); creativeTone = intentional-strengthening
  // signals (every other scene class, each <=1.3 multiplier).
  // Recorded here for explainability only -- the actual math is the
  // SAME fraction composition used below (compose = strengthScalar *
  // technical * creative * skinCaution, then the existing hard clamp).
  plan.layers = {
    technicalCorrection: {
      sceneClass: sceneResult.sceneClass,
      appliesRestraint: sceneResult.sceneClass === 'ALREADY_SATURATED',
      skinCautionScale: skinScale,
    },
    creativeTone: {
      strengthMode, strengthScalar: scalar, sceneClass: sceneResult.sceneClass, sceneMultipliers: sceneMult,
    },
  };

  // ── HSL ───────────────────────────────────────────────────────────
  const hslChannels = signals?.hsl?.channels ?? {};
  for (const ch of HSL_CHANNEL_IDS) {
    const evid = hslChannels[ch];
    const cur = candidateColorFields?.hsl ?? { hue: {}, saturation: {}, luminance: {} };
    const curHue = cur.hue?.[ch] ?? 0;
    const curSat = cur.saturation?.[ch] ?? 0;
    const curLum = cur.luminance?.[ch] ?? 0;
    if (!evid || evid.coveragePct < MIN_MEANINGFUL_COVERAGE_PCT.hslChannel) {
      // Not enough real presence of this hue in the image -- never
      // fabricate a push for a channel that isn't actually there.
      plan.hsl.hue[ch] = curHue; plan.hsl.saturation[ch] = curSat; plan.hsl.luminance[ch] = curLum;
      continue;
    }
    const isSkin = SKIN_ADJACENT_HSL_CHANNELS.has(ch);
    const bound = isSkin ? BOUNDS.hsl.skin : BOUNDS.hsl.color;
    const extraCaution = isSkin ? skinScale : 1.0;
    // Non-skin channels also receive the bounded scene-aware
    // multiplier (R3); skin channels never do -- extraCaution
    // (skinScale) already governs them exclusively.
    const fraction = isSkin ? (scalar * extraCaution) : (scalar * extraCaution * sceneMult.hslNonSkin);

    const hueBound = bound.hue;
    const satBound = isSkin ? Math.max(bound.satLow, bound.satHigh) : bound.sat;
    const lumBound = bound.luminance;

    const newHue = _restoreTowardEvidence(curHue, evid.hueAdj, fraction, hueBound);
    let newSat = _restoreTowardEvidence(curSat, evid.satAdj, fraction, satBound);
    // Skin channels get an asymmetric final safety clamp: a touch more
    // warmth is fine, aggressive desaturation or oversaturation is not.
    if (isSkin) newSat = Math.max(-bound.satLow, Math.min(bound.satHigh, newSat));
    const newLum = _restoreTowardEvidence(curLum, evid.lumAdj, fraction, lumBound);

    plan.hsl.hue[ch] = _roundClean(newHue);
    plan.hsl.saturation[ch] = _roundClean(newSat);
    plan.hsl.luminance[ch] = _roundClean(newLum);

    if (newHue !== curHue || newSat !== curSat || newLum !== curLum) {
      fieldsBoosted.push(`hsl.${ch}`);
      reasons.push(`hsl.${ch}: coverage ${evid.coveragePct}% -> restored toward evidence (hue ${curHue}->${newHue}, sat ${curSat}->${newSat}, lum ${curLum}->${newLum})${isSkin ? ` [skin-scaled x${extraCaution.toFixed(2)}]` : ''}.`);
    }
  }

  // ── Color Grading ───────────────────────────────────────────────
  const gradingConfidence = signals?.grading?.confidence ?? 0;
  const gradingZones = signals?.grading?.zones ?? {};
  const curGrading = candidateColorFields?.grading ?? {};
  if (gradingConfidence >= MIN_GRADING_CONFIDENCE) {
    for (const zone of GRADING_ZONE_IDS) {
      const evid = gradingZones[zone];
      const curZone = curGrading[zone] ?? { hue: 0, saturation: 0, luminance: 0 };
      if (!evid) { plan.grading[zone] = { ...curZone }; continue; }
      const satBound = BOUNDS.grading.saturation + (zone !== 'midtones' ? BOUNDS.grading.shadowsHighlightsExtra : 0);
      const lumBound = BOUNDS.grading.luminance;
      const fraction = scalar * sceneMult.grading; // grading has no per-channel skin adjacency; global skin caution still applies lightly via presence step below
      // EPIC 2E-P1E R2 fix: Color Grading Hue is an ABSOLUTE, cyclic
      // 0-359 angle (unlike HSL/Calibration Hue, which are signed
      // relative adjustments) -- it must be restored along the
      // shortest circular path, never the generic linear gap, or a
      // small warm-hue adjustment near the 0/360 boundary (e.g.
      // 350 -> 10) can be misread as a huge swing through an
      // unrelated green/cyan hue. If the evidence carries no real
      // saturation intent for this zone (`evid.sat === 0`), there is
      // no meaningful color direction to rotate toward either --
      // preserve the current hue unchanged rather than inventing a
      // rotation for an effectively neutral zone. See
      // P1E_R2_CIRCULAR_GRADING_HUE_FIX.md.
      const curHueNorm = normalizeHue(curZone.hue ?? 0);
      const newHue = (evid.sat ?? 0) === 0
        ? curHueNorm
        : restoreCircularHue(curHueNorm, evid.hue, fraction);
      const newSat = _restoreTowardEvidence(curZone.saturation ?? 0, evid.sat, fraction, satBound);
      const newLum = _restoreTowardEvidence(curZone.luminance ?? 0, evid.balance, fraction, lumBound);
      plan.grading[zone] = { hue: _roundClean(newHue), saturation: _roundClean(newSat), luminance: _roundClean(newLum) };
      if (newHue !== curHueNorm || newSat !== curZone.saturation || newLum !== curZone.luminance) {
        fieldsBoosted.push(`grading.${zone}`);
        reasons.push(`grading.${zone}: grading confidence ${gradingConfidence} >= ${MIN_GRADING_CONFIDENCE} -> restored toward "${signals?.grading?.look ?? 'evidence'}" look (hue ${curHueNorm}->${newHue} [circular], sat ${curZone.saturation}->${newSat}, lum ${curZone.luminance}->${newLum}).`);
      }
    }
  } else {
    for (const zone of GRADING_ZONE_IDS) plan.grading[zone] = { ...(curGrading[zone] ?? { hue: 0, saturation: 0, luminance: 0 }) };
    if (gradingConfidence > 0) reasons.push(`grading: confidence ${gradingConfidence} below trust threshold ${MIN_GRADING_CONFIDENCE} -- left unchanged.`);
  }

  // ── Calibration ─────────────────────────────────────────────────
  const calPrimaries = signals?.calibration?.primaries ?? {};
  const curCal = candidateColorFields?.cal ?? {};
  for (const prim of CAL_PRIMARY_IDS) {
    const key = `${prim}Primary`;
    const evid = calPrimaries[prim];
    const curHue = curCal[`${key}Hue`] ?? 0;
    const curSat = curCal[`${key}Saturation`] ?? 0;
    if (!evid || evid.coveragePct < MIN_MEANINGFUL_COVERAGE_PCT.calibrationPrimary) {
      plan.cal[`${key}Hue`] = curHue; plan.cal[`${key}Saturation`] = curSat;
      continue;
    }
    // Calibration is a blunt, global tool (moves the whole primary,
    // not a local hue range) -- kept at the tightest fraction of the
    // three color layers, and additionally skin-cautioned since red
    // primary shifts affect skin more than green/blue.
    const extraCaution = prim === 'red' ? skinScale : 1.0;
    const fraction = scalar * 0.8 * extraCaution * sceneMult.calibration;
    const newHue = _restoreTowardEvidence(curHue, evid.hue, fraction, BOUNDS.calibration.hue);
    const newSat = _restoreTowardEvidence(curSat, evid.sat, fraction, BOUNDS.calibration.saturation);
    plan.cal[`${key}Hue`] = _roundClean(newHue);
    plan.cal[`${key}Saturation`] = _roundClean(newSat);
    if (newHue !== curHue || newSat !== curSat) {
      fieldsBoosted.push(`cal.${key}`);
      reasons.push(`cal.${key}: coverage ${evid.coveragePct}% -> restored toward evidence (hue ${curHue}->${newHue}, sat ${curSat}->${newSat}).`);
    }
  }

  // ── Presence (Vibrance / Saturation) ────────────────────────────
  // No single Core engine owns global Vibrance/Saturation the way
  // hsl/grading/calibration own their fields, so P1E derives its
  // target from how much real, un-exploited color-grading opportunity
  // the rest of the plan just found: the more HSL/grading/calibration
  // fields it meaningfully touched, and the higher the overall color
  // confidence, the more it is safe to lift the global Presence
  // sliders -- itself still bounded and skin-cautioned. This keeps
  // the rule evidence-driven and explainable rather than a fixed
  // "always +20 vibrance" constant.
  const curVib = candidateColorFields?.basic?.vibrance ?? 0;
  const curSat = candidateColorFields?.basic?.saturation ?? 0;
  const opportunityScore = Math.min(1, fieldsBoosted.length / 6) * (signals?.overallColorConfidence ?? 0.3);
  if (opportunityScore > 0.05) {
    const vibTarget = BOUNDS.presence.vibrance * opportunityScore * sceneMult.presenceVibrance;
    const satTarget = BOUNDS.presence.saturation * opportunityScore * 0.7 * sceneMult.presenceSaturation; // Saturation stays more conservative than Vibrance (real photographic practice: Vibrance protects already-saturated/skin tones, Saturation does not)
    const presenceFraction = scalar * skinScale; // vibrance/saturation targets themselves are scaled by sceneMult below, not this fraction
    const newVib = _restoreTowardEvidence(curVib, Math.sign(curVib || 1) * Math.max(Math.abs(curVib), vibTarget), presenceFraction, BOUNDS.presence.vibrance);
    const newSat2 = _restoreTowardEvidence(curSat, Math.sign(curSat || 1) * Math.max(Math.abs(curSat), satTarget), presenceFraction, BOUNDS.presence.saturation);
    plan.presence.vibrance = _roundClean(newVib);
    plan.presence.saturation = _roundClean(newSat2);
    if (newVib !== curVib || newSat2 !== curSat) {
      fieldsBoosted.push('presence');
      reasons.push(`presence: opportunity score ${opportunityScore.toFixed(2)} (from ${fieldsBoosted.length} boosted color fields, overall confidence ${(signals?.overallColorConfidence ?? 0).toFixed(2)}) -> vibrance ${curVib}->${newVib}, saturation ${curSat}->${newSat2}.`);
    }
  } else {
    plan.presence.vibrance = curVib;
    plan.presence.saturation = curSat;
  }

  plan.engaged = fieldsBoosted.length > 0;
  plan.reasons = reasons;
  plan.fieldsBoosted = fieldsBoosted;
  return plan;
}
