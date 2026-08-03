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

function _clamp(v, mag) { return Math.max(-mag, Math.min(mag, v)); }

/**
 * Restores a bounded fraction of the gap between `current` (the
 * already-dampened Candidate value) and `evidenceTarget` (the Core
 * engine's own reasoned recommendation), never exceeding
 * `evidenceTarget` in magnitude and never flipping sign relative to
 * `evidenceTarget` when the two disagree (a sign conflict signals
 * real uncertainty -- the conservative choice is to change nothing).
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
    const fraction = scalar * extraCaution;

    const hueBound = bound.hue;
    const satBound = isSkin ? Math.max(bound.satLow, bound.satHigh) : bound.sat;
    const lumBound = bound.luminance;

    const newHue = _restoreTowardEvidence(curHue, evid.hueAdj, fraction, hueBound);
    let newSat = _restoreTowardEvidence(curSat, evid.satAdj, fraction, satBound);
    // Skin channels get an asymmetric final safety clamp: a touch more
    // warmth is fine, aggressive desaturation or oversaturation is not.
    if (isSkin) newSat = Math.max(-bound.satLow, Math.min(bound.satHigh, newSat));
    const newLum = _restoreTowardEvidence(curLum, evid.lumAdj, fraction, lumBound);

    plan.hsl.hue[ch] = newHue;
    plan.hsl.saturation[ch] = newSat;
    plan.hsl.luminance[ch] = newLum;

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
      const fraction = scalar; // grading has no per-channel skin adjacency; global skin caution still applies lightly via presence step below
      const newHue = _restoreTowardEvidence(curZone.hue ?? 0, evid.hue, fraction, 359 /* hue is cyclic 0-359, bounded elsewhere by the tiny magnitude of gap */);
      const newSat = _restoreTowardEvidence(curZone.saturation ?? 0, evid.sat, fraction, satBound);
      const newLum = _restoreTowardEvidence(curZone.luminance ?? 0, evid.balance, fraction, lumBound);
      plan.grading[zone] = { hue: newHue, saturation: newSat, luminance: newLum };
      if (newSat !== curZone.saturation || newLum !== curZone.luminance) {
        fieldsBoosted.push(`grading.${zone}`);
        reasons.push(`grading.${zone}: grading confidence ${gradingConfidence} >= ${MIN_GRADING_CONFIDENCE} -> restored toward "${signals?.grading?.look ?? 'evidence'}" look (sat ${curZone.saturation}->${newSat}, lum ${curZone.luminance}->${newLum}).`);
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
    const fraction = scalar * 0.8 * extraCaution;
    const newHue = _restoreTowardEvidence(curHue, evid.hue, fraction, BOUNDS.calibration.hue);
    const newSat = _restoreTowardEvidence(curSat, evid.sat, fraction, BOUNDS.calibration.saturation);
    plan.cal[`${key}Hue`] = newHue;
    plan.cal[`${key}Saturation`] = newSat;
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
    const vibTarget = BOUNDS.presence.vibrance * opportunityScore;
    const satTarget = BOUNDS.presence.saturation * opportunityScore * 0.7; // Saturation stays more conservative than Vibrance (real photographic practice: Vibrance protects already-saturated/skin tones, Saturation does not)
    const presenceFraction = scalar * skinScale;
    const newVib = _restoreTowardEvidence(curVib, Math.sign(curVib || 1) * Math.max(Math.abs(curVib), vibTarget), presenceFraction, BOUNDS.presence.vibrance);
    const newSat2 = _restoreTowardEvidence(curSat, Math.sign(curSat || 1) * Math.max(Math.abs(curSat), satTarget), presenceFraction, BOUNDS.presence.saturation);
    plan.presence.vibrance = newVib;
    plan.presence.saturation = newSat2;
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
