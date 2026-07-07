/**
 * core/xmp-validator/index.js
 *
 * PRE-XMP VALIDATION PASS
 *
 * Validates a Lightroom preset object against a Style Fingerprint
 * (core/style-fingerprint) right before it becomes the exported XMP.
 * Never writes/reads the DOM — pure data in, corrected data + report out.
 *
 * Two entry points:
 *
 *  validateFinalPreset(preset, fingerprint)
 *    Full validation — runs right after Decision Engine, before the
 *    preset is applied to sliders. Uses the fingerprint for context-aware
 *    checks (Rules 2, 3, 6, 7, 8) plus hard ceilings (Rules 1, 4, 5).
 *
 *  quickSafetyClamp(preset)
 *    Lightweight, fingerprint-free hard-ceiling pass — runs again at the
 *    moment of XMP export (handleDownload), so manual slider edits made
 *    after analysis can never push the exported file into unsafe territory
 *    (neon HSL, uncontrolled green cast, dominant Basic Panel, heavy
 *    calibration). Cheap enough to run on every export click.
 */

// ─── Hard ceilings — the absolute safety net, independent of fingerprint ────
// These mirror (and in some cases tighten) the STYLE_LIMITS already applied
// upstream in basic-panel-engine / decision-engine. Keeping a second,
// independent copy here means a regression upstream can't silently produce
// an unsafe XMP — this module is the last gate before export.
export const HARD_LIMITS = {
  basic: {
    exposure:   [-35, 35],
    contrast:   [-20, 25],
    highlights: [-55, 10],
    shadows:    [-25, 35],
    whites:     [-30, 20],
    blacks:     [-35, 15],
  },
  wb: {
    tempCap:         40,   // |temp| beyond this is not "reproducing mood", it's overcorrection
    tintGreenFloor: -12,   // tint below this = risk of unintended green cast
    tintMagentaCeil: 30,   // tint above this = risk of unintended magenta cast
    tintGreenFloorIntentional: -25,  // relaxed floor when fingerprint confirms an intentional green mood
  },
  hsl: {
    skinHueCap: 4,  skinSatLo: -8, skinSatHi: 6,
    colorHueCap: 15, colorSatCap: 25,   // "neon" ceiling for non-skin channels
  },
  calibration: { hueCap: 10, satCap: 15 },
  presence: { vibCap: 30, satCap: 20 },
  curve: { shadowY: [0, 60], midY: [80, 180], highlightY: [180, 255] },
};

const SKIN_CHANNELS = new Set(['red', 'orange', 'yellow']);
const ALL_HSL_CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];

// ─── Full validation (fingerprint-aware) ─────────────────────────────────────

/**
 * @param {object} preset      output of buildFinalPreset (decision-engine)
 * @param {object} fingerprint output of buildStyleFingerprint
 * @returns {{ preset: object, report: object }}
 */
export function validateFinalPreset(preset, fingerprint) {
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };
  const violations   = [];
  const adjustments  = [];
  const explanations = [];

  // ── Rule 8z: Adaptive Decision Strategy awareness (Phase 5) ──────────────
  // preset._decision (set by core/decision-engine before this function is
  // called) already carries decisionStrategy, appliedGuards, and per-engine
  // confidence context. This is an independent re-check — a final safety
  // net catching cases where the strategy's own guard (in Lightroom
  // Mapping) was somehow bypassed, e.g. by a future code change or a
  // manually-edited preset re-entering validation.
  const decisionCtx = preset._decision ?? {};
  if (decisionCtx.decisionStrategy) {
    explanations.push(`Decision strategy: "${decisionCtx.decisionStrategy}" — ${(decisionCtx.appliedGuards ?? []).length} guard(s) applied upstream.`);
  }
  if (decisionCtx.finalStyleIntent?.mood === 'moody_dark' && p.exp > 5) {
    adjustments.push(`Strategy "moody" forbids brightening — exposure ${p.exp} clamped to 0.`);
    p.exp = 0;
    violations.push('strategy_moody_unwanted_brighten');
  }
  if (decisionCtx.finalStyleIntent?.mood === 'airy_bright' && p.exp < -15) {
    adjustments.push(`Strategy "airy" forbids aggressive darkening — exposure ${p.exp} clamped to -15.`);
    p.exp = -15;
    violations.push('strategy_airy_unwanted_darken');
  }
  if (decisionCtx.decisionStrategy === 'food') {
    for (const ch of ['red','orange','yellow']) {
      const s = p.hsl[`hsl_s_${ch}`] ?? 0;
      if (Math.abs(s) > 12) {
        adjustments.push(`Strategy "food" protects warm channel "${ch}" — sat ${s} clamped to ±12.`);
        p.hsl[`hsl_s_${ch}`] = Math.sign(s) * 12;
        violations.push(`strategy_food_warm_channel_${ch}`);
      }
    }
  }

  // Stage 2.2: Transfer-risk clamp awareness — Decision Engine's internal
  // transferRiskEstimate (proxy assessment, see decision-engine.js) already
  // softens trust weights before mapping. This is an independent final
  // check: when risk was flagged HIGH, re-verify the mapped values actually
  // ended up modest, and tighten further if a future code path bypassed
  // the softening upstream.
  if (decisionCtx.transferRiskEstimate?.level === 'high') {
    explanations.push(`Transfer risk high (score ${decisionCtx.transferRiskEstimate.score}) — extra clamp scrutiny applied.`);
    const HSL_HIGH_RISK_CAP = 18, CAL_HIGH_RISK_CAP = 6;
    for (const ch of ALL_HSL_CHANNELS) {
      const s = p.hsl[`hsl_s_${ch}`] ?? 0;
      if (Math.abs(s) > HSL_HIGH_RISK_CAP) {
        p.hsl[`hsl_s_${ch}`] = Math.sign(s) * HSL_HIGH_RISK_CAP;
        adjustments.push(`High transfer risk — HSL "${ch}" saturation (${s}) re-capped to ±${HSL_HIGH_RISK_CAP}.`);
        violations.push(`transfer_risk_hsl_${ch}`);
      }
    }
    for (const prim of ['red','green','blue']) {
      const s = p.cal[`cal_${prim}_s`] ?? 0;
      if (Math.abs(s) > CAL_HIGH_RISK_CAP) {
        p.cal[`cal_${prim}_s`] = Math.sign(s) * CAL_HIGH_RISK_CAP;
        adjustments.push(`High transfer risk — Calibration "${prim}" saturation (${s}) re-capped to ±${CAL_HIGH_RISK_CAP}.`);
        violations.push(`transfer_risk_calibration_${prim}`);
      }
    }
  }

  // Stage 2.3 (Task 2.3F): Final cross-section safety net. Lightroom
  // Mapping Engine already runs its own _finalMappingValidation() pass
  // (Basic vs Colour Grading mood, Tone Curve vs Style Intent), but this
  // is the LAST gate before export — an independent, cheap re-check in
  // case a future upstream change bypasses that pass.
  const gradeBias = (p.grade?.grd_hi_l ?? 0) - (p.grade?.grd_sh_l ?? 0);
  if (p.exp > 10 && gradeBias < -15) {
    adjustments.push(`Basic Panel (exp=+${p.exp}) contradicts Colour Grading's darker balance (${gradeBias}) — exposure re-eased.`);
    p.exp = Math.round(p.exp * 0.6);
    violations.push('final_mapping_basic_vs_grading_mood');
  }
  if (p.exp < -10 && gradeBias > 15) {
    adjustments.push(`Basic Panel (exp=${p.exp}) contradicts Colour Grading's brighter balance (+${gradeBias}) — exposure re-eased.`);
    p.exp = Math.round(p.exp * 0.6);
    violations.push('final_mapping_basic_vs_grading_mood');
  }

  // ── Rule 8a: Feature Fusion conflict-awareness ───────────────────────────
  // Decision Engine already dampens implicated slider groups when the
  // Style Feature Graph reports a conflict (see hslDampen/calDampen), but
  // Pre-XMP Validation independently re-checks that those groups actually
  // ended up modest — conflicts are visible here even if a future upstream
  // change forgets to apply the dampening.
  const graphConflicts = fingerprint.featureGraph?.conflicts ?? [];
  for (const c of graphConflicts) {
    explanations.push(`Style Feature Graph conflict "${c.type}": ${c.description} (resolution: ${c.resolution})`);
    if (c.type === 'hsl_vs_palette_saturation') {
      const maxSat = Math.max(...ALL_HSL_CHANNELS.map(ch => Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0)));
      if (maxSat > 12) {
        for (const ch of ALL_HSL_CHANNELS) p.hsl[`hsl_s_${ch}`] = Math.round((p.hsl[`hsl_s_${ch}`] ?? 0) * 0.6);
        adjustments.push(`HSL saturation re-dampened post-conflict (max was ${maxSat}) — palette says muted, HSL disagreed.`);
        violations.push('conflict_hsl_vs_palette_unresolved');
      }
    }
    if (c.type === 'calibration_vs_skin') {
      const calMag = ['red','green','blue'].reduce((s,pr)=>s+Math.abs(p.cal[`cal_${pr}_h`]??0)+Math.abs(p.cal[`cal_${pr}_s`]??0),0);
      if (calMag > 10) {
        for (const pr of ['red','green','blue']) { p.cal[`cal_${pr}_h`]=Math.round((p.cal[`cal_${pr}_h`]??0)*0.5); p.cal[`cal_${pr}_s`]=Math.round((p.cal[`cal_${pr}_s`]??0)*0.5); }
        adjustments.push(`Calibration re-dampened post-conflict (magnitude was ${calMag.toFixed(0)}) — high-confidence skin detected.`);
        violations.push('conflict_calibration_vs_skin_unresolved');
      }
    }
  }
  if (fingerprint.featureGraph && fingerprint.featureGraph.overallStyleConfidence < 0.35) {
    explanations.push(`Style Feature Graph overall confidence is low (${fingerprint.featureGraph.overallStyleConfidence}) — Rule 8 confidence scaling below applies extra caution.`);
  }

  // ── Rule 8 first: low-confidence engines get scaled down before we even
  //    check them against hard limits, so the limit checks see realistic
  //    values, not a low-confidence outlier. ──────────────────────────────
  _applyConfidenceScaling(p, fingerprint, adjustments);

  // ── Rule 1: Basic Panel must not be aggressive / must not dominate ──────
  _clampBasicPanel(p, HARD_LIMITS.basic, adjustments);
  const basicMag = Math.abs(p.exp)/100*20 + Math.abs(p.con) + Math.abs(p.hi) + Math.abs(p.sh) + Math.abs(p.wh) + Math.abs(p.bl);
  const colorMag = ALL_HSL_CHANNELS.reduce((s,ch)=>s+Math.abs(p.hsl[`hsl_s_${ch}`]??0),0)
                  + Math.abs(p.grade.grd_sh_s??0) + Math.abs(p.grade.grd_mid_s??0) + Math.abs(p.grade.grd_hi_s??0);
  const basicDominant = basicMag > 60 && basicMag > colorMag * 2.5;
  if (basicDominant) {
    const scale = 0.6;
    for (const k of ['exp','con','hi','sh','wh','bl']) p[k] = Math.round(p[k] * scale);
    violations.push('basic_panel_dominant');
    adjustments.push(`Basic Panel magnitude (${basicMag.toFixed(0)}) far exceeded colour-engine magnitude (${colorMag.toFixed(0)}) — scaled down ${Math.round((1-scale)*100)}% to keep it a supporting descriptor, not the main style driver.`);
  }

  // ── Rule 2: White Balance must not create an unintended green/yellow cast ─
  const intentionalGreen = fingerprint.colorCast === 'green';
  const greenFloor = intentionalGreen ? HARD_LIMITS.wb.tintGreenFloorIntentional : HARD_LIMITS.wb.tintGreenFloor;
  if (p.tint < greenFloor) {
    adjustments.push(`Tint ${p.tint} exceeded green floor (${greenFloor}) for detected cast "${fingerprint.colorCast}" — clamped.`);
    p.tint = greenFloor;
    violations.push('wb_unintended_green');
  }
  if (p.tint > HARD_LIMITS.wb.tintMagentaCeil) {
    adjustments.push(`Tint ${p.tint} exceeded magenta ceiling — clamped to ${HARD_LIMITS.wb.tintMagentaCeil}.`);
    p.tint = HARD_LIMITS.wb.tintMagentaCeil;
    violations.push('wb_unintended_magenta');
  }
  if (Math.abs(p.temp) > HARD_LIMITS.wb.tempCap) {
    const clamped = Math.sign(p.temp) * HARD_LIMITS.wb.tempCap;
    adjustments.push(`Temp ${p.temp} exceeded ±${HARD_LIMITS.wb.tempCap} — clamped to ${clamped} (WB should support the reference mood, not overcorrect it).`);
    p.temp = clamped;
    violations.push('wb_temp_excessive');
  }

  // ── Rule 3: Skin must not shift unnaturally ──────────────────────────────
  if (fingerprint.skin?.detected) {
    for (const ch of SKIN_CHANNELS) {
      const hKey = `hsl_h_${ch}`, sKey = `hsl_s_${ch}`;
      const h = p.hsl[hKey] ?? 0, s = p.hsl[sKey] ?? 0;
      const hClamped = Math.max(-HARD_LIMITS.hsl.skinHueCap, Math.min(HARD_LIMITS.hsl.skinHueCap, h));
      const sClamped = Math.max(HARD_LIMITS.hsl.skinSatLo,  Math.min(HARD_LIMITS.hsl.skinSatHi,  s));
      if (hClamped !== h || sClamped !== s) {
        adjustments.push(`Skin-relevant channel "${ch}" hue/sat (${h}/${s}) exceeded natural-skin bounds — clamped to (${hClamped}/${sClamped}).`);
        violations.push(`skin_shift_${ch}`);
      }
      p.hsl[hKey] = hClamped; p.hsl[sKey] = sClamped;
    }
  }

  // ── Rule 4: HSL must not create neon colours ─────────────────────────────
  for (const ch of ALL_HSL_CHANNELS) {
    const sKey = `hsl_s_${ch}`, hKey = `hsl_h_${ch}`;
    const isSkin = SKIN_CHANNELS.has(ch);
    const satCap = isSkin ? HARD_LIMITS.hsl.skinSatHi : HARD_LIMITS.hsl.colorSatCap;
    const hueCap = isSkin ? HARD_LIMITS.hsl.skinHueCap : HARD_LIMITS.hsl.colorHueCap;
    const s = p.hsl[sKey] ?? 0, h = p.hsl[hKey] ?? 0;
    const sClamped = Math.max(-satCap, Math.min(satCap, s));
    const hClamped = Math.max(-hueCap, Math.min(hueCap, h));
    if (sClamped !== s) {
      adjustments.push(`HSL saturation "${ch}" (${s}) risked a neon result — clamped to ${sClamped}.`);
      violations.push(`neon_sat_${ch}`);
    }
    if (hClamped !== h) {
      adjustments.push(`HSL hue "${ch}" (${h}) exceeded safe shift — clamped to ${hClamped}.`);
      violations.push(`neon_hue_${ch}`);
    }
    p.hsl[sKey] = sClamped; p.hsl[hKey] = hClamped;
  }
  // Vibrance / Saturation global ceiling
  if (Math.abs(p.vib) > HARD_LIMITS.presence.vibCap) { p.vib = Math.sign(p.vib)*HARD_LIMITS.presence.vibCap; adjustments.push('Vibrance clamped to prevent oversaturation.'); }
  if (Math.abs(p.sat) > HARD_LIMITS.presence.satCap) { p.sat = Math.sign(p.sat)*HARD_LIMITS.presence.satCap; adjustments.push('Saturation clamped to prevent oversaturation.'); }

  // ── Rule 5: Calibration must remain subtle ───────────────────────────────
  for (const prim of ['red','green','blue']) {
    const hKey = `cal_${prim}_h`, sKey = `cal_${prim}_s`;
    const h = p.cal[hKey] ?? 0, s = p.cal[sKey] ?? 0;
    const hClamped = Math.max(-HARD_LIMITS.calibration.hueCap, Math.min(HARD_LIMITS.calibration.hueCap, h));
    const sClamped = Math.max(-HARD_LIMITS.calibration.satCap, Math.min(HARD_LIMITS.calibration.satCap, s));
    if (hClamped !== h || sClamped !== s) {
      adjustments.push(`Calibration "${prim}" (${h}/${s}) exceeded subtle-style bounds — clamped to (${hClamped}/${sClamped}). Calibration must not be the main style-transfer mechanism.`);
      violations.push(`calibration_excessive_${prim}`);
    }
    p.cal[hKey] = hClamped; p.cal[sKey] = sClamped;
  }

  // ── Rule 6: Tone Curve must preserve dynamic range ───────────────────────
  // crv_hi/crv_mid/crv_sh are the flat numeric fields written to
  // ParametricHighlights/Midtones/Shadows — clamp to sane bounds and flag
  // if shadows/highlights are pushed to extremes without clipping evidence
  // or a fingerprint mood that calls for it (moody_dark / high_contrast).
  const crushCandidate = p.crv_sh < 5 && fingerprint.clipLoPct < 1 &&
    !['moody_dark','high_contrast'].includes(fingerprint.mood);
  const blowCandidate  = p.crv_hi > 250 && fingerprint.clipHiPct < 1 &&
    !['airy_bright','high_contrast'].includes(fingerprint.mood);
  if (crushCandidate) {
    explanations.push(`Shadow curve anchor near-zero without shadow clipping evidence or a moody/high-contrast fingerprint — dynamic range may be over-compressed.`);
    violations.push('curve_shadow_crush_risk');
  }
  if (blowCandidate) {
    explanations.push(`Highlight curve anchor near-max without highlight clipping evidence or an airy/high-contrast fingerprint — dynamic range may be over-compressed.`);
    violations.push('curve_highlight_blow_risk');
  }

  // ── Rule 7: Final XMP must match the Style Fingerprint (score + explain) ─
  const { score, explain } = _scoreFingerprintMatch(p, fingerprint);
  explanations.push(...explain);

  const report = {
    fingerprintMatchScore: score,
    violations,
    adjustments,
    explanations,
    fingerprint,
  };

  return { preset: p, report };
}

// ─── Lightweight, fingerprint-free safety net (runs again at export time) ──

/**
 * @param {object} preset  output of readSlidersAsPreset()
 * @returns {{ preset: object, adjustments: string[] }}
 */
export function quickSafetyClamp(preset) {
  const p = { ...preset, hsl: { ...preset.hsl }, grade: { ...preset.grade }, cal: { ...preset.cal } };
  const adjustments = [];

  _clampBasicPanel(p, HARD_LIMITS.basic, adjustments);

  if (p.tint < HARD_LIMITS.wb.tintGreenFloorIntentional) { adjustments.push(`Tint hard-floored (was ${p.tint}).`); p.tint = HARD_LIMITS.wb.tintGreenFloorIntentional; }
  if (p.tint > HARD_LIMITS.wb.tintMagentaCeil)            { adjustments.push(`Tint hard-ceilinged (was ${p.tint}).`); p.tint = HARD_LIMITS.wb.tintMagentaCeil; }
  if (Math.abs(p.temp) > HARD_LIMITS.wb.tempCap * 1.5)    { const c = Math.sign(p.temp)*HARD_LIMITS.wb.tempCap*1.5; adjustments.push(`Temp hard-capped (was ${p.temp}).`); p.temp = c; }

  for (const ch of ALL_HSL_CHANNELS) {
    const isSkin = SKIN_CHANNELS.has(ch);
    const satCap = isSkin ? HARD_LIMITS.hsl.skinSatHi + 4 : HARD_LIMITS.hsl.colorSatCap + 5; // slightly looser: manual edits get a little more trust
    const sKey = `hsl_s_${ch}`;
    const s = p.hsl[sKey] ?? 0;
    if (Math.abs(s) > satCap) { adjustments.push(`HSL sat "${ch}" hard-capped (was ${s}).`); p.hsl[sKey] = Math.sign(s)*satCap; }
  }
  for (const prim of ['red','green','blue']) {
    const sKey = `cal_${prim}_s`;
    const s = p.cal[sKey] ?? 0;
    if (Math.abs(s) > HARD_LIMITS.calibration.satCap + 5) { adjustments.push(`Calibration sat "${prim}" hard-capped (was ${s}).`); p.cal[sKey] = Math.sign(s)*(HARD_LIMITS.calibration.satCap+5); }
  }
  if (Math.abs(p.vib) > HARD_LIMITS.presence.vibCap + 10) { p.vib = Math.sign(p.vib)*(HARD_LIMITS.presence.vibCap+10); adjustments.push('Vibrance hard-capped.'); }
  if (Math.abs(p.sat) > HARD_LIMITS.presence.satCap + 10) { p.sat = Math.sign(p.sat)*(HARD_LIMITS.presence.satCap+10); adjustments.push('Saturation hard-capped.'); }

  return { preset: p, adjustments };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _clampBasicPanel(p, limits, adjustments) {
  const fields = { exp:'exposure', con:'contrast', hi:'highlights', sh:'shadows', wh:'whites', bl:'blacks' };
  for (const [key, name] of Object.entries(fields)) {
    const [lo, hi] = limits[name];
    const v = p[key] ?? 0;
    const clamped = Math.max(lo, Math.min(hi, v));
    if (clamped !== v) { adjustments.push(`Basic Panel "${key}" (${v}) outside modest range [${lo},${hi}] — clamped to ${clamped}.`); p[key] = clamped; }
  }
}

function _applyConfidenceScaling(p, fingerprint, adjustments) {
  const LOW = 0.40, VERY_LOW = 0.25;
  const cm = fingerprint.confidenceMap ?? {};

  const scaleFactor = (conf) => conf < VERY_LOW ? 0.25 : conf < LOW ? 0.5 : 1.0;

  // Phase 4: Style Feature Graph overall confidence — an additional,
  // engine-agnostic signal (effectiveWeight-blended across all 22
  // modules). When the WHOLE graph is uncertain, not just one engine,
  // apply a small global dampening on top of the per-engine scaling below.
  const graphConf = fingerprint.featureGraph?.overallStyleConfidence ?? 0.6;
  const globalScale = graphConf < VERY_LOW ? 0.6 : graphConf < LOW ? 0.8 : 1.0;
  if (globalScale < 1) {
    for (const k of ['temp','tint','vib','sat']) p[k] = Math.round(p[k] * globalScale);
    adjustments.push(`Style Feature Graph overall confidence low (${graphConf}) — WB/presence scaled ×${globalScale} globally.`);
  }

  const wbScale = scaleFactor(cm.wb ?? 0.5);
  if (wbScale < 1) { p.temp = Math.round(p.temp * wbScale); p.tint = Math.round(p.tint * wbScale); adjustments.push(`WB confidence low (${cm.wb}) — temp/tint scaled ×${wbScale}.`); }

  const hslScale = scaleFactor(cm.hsl ?? 0.5);
  if (hslScale < 1) {
    for (const ch of ALL_HSL_CHANNELS) {
      p.hsl[`hsl_h_${ch}`] = Math.round((p.hsl[`hsl_h_${ch}`]??0) * hslScale);
      p.hsl[`hsl_s_${ch}`] = Math.round((p.hsl[`hsl_s_${ch}`]??0) * hslScale);
      p.hsl[`hsl_l_${ch}`] = Math.round((p.hsl[`hsl_l_${ch}`]??0) * hslScale);
    }
    adjustments.push(`HSL confidence low (${cm.hsl}) — all channel adjustments scaled ×${hslScale}.`);
  }

  const calScale = scaleFactor(cm.calibration ?? 0.5);
  if (calScale < 1) {
    for (const prim of ['red','green','blue']) {
      p.cal[`cal_${prim}_h`] = Math.round((p.cal[`cal_${prim}_h`]??0) * calScale);
      p.cal[`cal_${prim}_s`] = Math.round((p.cal[`cal_${prim}_s`]??0) * calScale);
    }
    adjustments.push(`Calibration confidence low (${cm.calibration}) — scaled ×${calScale}.`);
  }

  const gradeScale = scaleFactor(cm.grading ?? 0.5);
  if (gradeScale < 1) {
    for (const zone of ['sh','mid','hi']) p.grade[`grd_${zone}_s`] = Math.round((p.grade[`grd_${zone}_s`]??0) * gradeScale);
    adjustments.push(`Grading confidence low (${cm.grading}) — saturation scaled ×${gradeScale}.`);
  }

  const basicScale = scaleFactor(cm.basic ?? 0.5);
  if (basicScale < 1) {
    for (const k of ['exp','con','hi','sh','wh','bl']) p[k] = Math.round(p[k] * basicScale);
    adjustments.push(`Basic Panel confidence low (${cm.basic}) — scaled ×${basicScale}.`);
  }

  const curveScale = scaleFactor(cm.toneCurves ?? 0.5);
  if (curveScale < 1) {
    const neutral = { crv_sh: 5, crv_mid: 128, crv_hi: 248 };
    for (const k of ['crv_sh','crv_mid','crv_hi']) p[k] = Math.round(neutral[k] + (p[k]-neutral[k]) * curveScale);
    adjustments.push(`Tone curve confidence low (${cm.toneCurves}) — pulled toward neutral ×${curveScale}.`);
  }
}

function _scoreFingerprintMatch(p, fp) {
  const explain = [];
  let total = 0, count = 0;

  // Mood match: Basic Panel should stay modest → high score when it does
  const basicMag = Math.abs(p.exp)/100*20 + Math.abs(p.con) + Math.abs(p.hi) + Math.abs(p.sh) + Math.abs(p.wh) + Math.abs(p.bl);
  const moodScore = basicMag < 20 ? 1.0 : basicMag < 50 ? 0.7 : basicMag < 90 ? 0.4 : 0.15;
  explain.push(`Mood preservation: Basic Panel magnitude=${basicMag.toFixed(0)} → ${(moodScore*100).toFixed(0)}% match ("${fp.moodLabel}" kept intact).`);
  total += moodScore; count++;

  // Warmth match: temp sign should agree with fingerprint warmth (or be near-neutral)
  const tempSign = p.temp > 4 ? 'warm' : p.temp < -4 ? 'cool' : 'neutral';
  const warmthScore = tempSign === fp.warmth || fp.warmth === 'neutral' ? 1.0 : 0.5;
  explain.push(`Warmth: preset leans "${tempSign}", fingerprint says "${fp.warmth}" → ${(warmthScore*100).toFixed(0)}% match.`);
  total += warmthScore; count++;

  // Cast match: tint shouldn't contradict detected cast
  const tintDir = p.tint < -4 ? 'green' : p.tint > 4 ? 'magenta' : 'neutral';
  const castScore = (tintDir === 'neutral') || (tintDir === fp.colorCast) || (fp.colorCast === 'warm' || fp.colorCast === 'cool') ? 1.0 : 0.4;
  explain.push(`Colour cast: preset tint reads "${tintDir}", fingerprint detected "${fp.colorCast}" → ${(castScore*100).toFixed(0)}% match.`);
  total += castScore; count++;

  // Skin match
  if (fp.skin?.detected) {
    const skinShift = SKIN_CHANNELS.has('orange') ? Math.abs(p.hsl.hsl_s_orange ?? 0) + Math.abs(p.hsl.hsl_h_orange ?? 0) : 0;
    const skinScore = skinShift <= 8 ? 1.0 : skinShift <= 16 ? 0.6 : 0.25;
    explain.push(`Skin naturalism: shift magnitude=${skinShift} → ${(skinScore*100).toFixed(0)}% match.`);
    total += skinScore; count++;
  }

  // Saturation / neon check
  const maxHslSat = Math.max(...ALL_HSL_CHANNELS.map(ch => Math.abs(p.hsl[`hsl_s_${ch}`] ?? 0)));
  const neonScore = maxHslSat <= 15 ? 1.0 : maxHslSat <= 25 ? 0.7 : 0.3;
  explain.push(`Colour restraint: max HSL saturation shift=${maxHslSat} → ${(neonScore*100).toFixed(0)}% match (no neon).`);
  total += neonScore; count++;

  const score = +(total / count).toFixed(3);
  return { score, explain };
}
