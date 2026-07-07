/**
 * core/basic-panel-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 3 ROLE: TONE DESCRIPTOR / VALIDATOR — not a value generator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * In the Reference Tone Extraction architecture
 * (Analysis → Feature Vector → Style Fingerprint → Decision Engine →
 *  Lightroom Mapping Engine → Pre-XMP Validation → XMP Export), this module
 * is an ANALYSIS step only. It does not decide the final Exposure/Contrast/
 * Highlights/Shadows/Whites/Blacks slider values — it describes the
 * reference's existing tonal character (toneStyle) and returns small,
 * advisory nudge values that the Lightroom Mapping Engine treats as a
 * SUPPORTING signal, dampened further and never the primary style driver.
 * Its output is also consulted by core/xmp-validator (Pre-XMP Validation
 * Rule 1 — "Basic values must be modest and supporting only").
 *
 * STYLE-PRESERVATION MODE (Reference Tone Extraction)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PresetForge treats the source image as an ALREADY-EDITED, intentional look
 * — not a raw capture that needs correcting. The Basic Panel's job is no
 * longer to push exposure/tone toward some "ideal" target; it is to:
 *
 *   1. Describe the existing tonal style (airy bright / soft highlight /
 *      matte shadow / moody dark / high contrast / low contrast / balanced)
 *   2. Protect against genuine technical data loss (highlight/shadow
 *      clipping) with small, proportional recovery nudges
 *   3. Leave everything else at (or very near) zero, so that Tone Curve,
 *      Colour Grading, HSL, and Calibration — which carry the actual STYLE
 *      information — remain the dominant contributors to the final preset.
 *
 * What changed vs the old "correction" engine:
 *   - Exposure no longer compares avgLum/median/LAB L* against a scene
 *     target and pushes toward it. It defaults to 0 and only moves for
 *     clipping recovery or genuinely broken (near-black/near-white, near-
 *     zero dynamic range) frames.
 *   - Highlights/Whites no longer "stretch" a low white point upward —
 *     boosting whites to fill the tonal range IS auto-correction.
 *   - Shadows/Blacks no longer lift/deepen toward an "ideal" black point —
 *     an elevated black point is very often an intentional matte/faded
 *     look, and a low one is very often an intentional moody-dark look.
 *     Both are preserved, not "fixed."
 *   - Contrast no longer normalises σ toward an ideal value; it only
 *     nudges gently at the extremes.
 *   - STYLE_LIMITS apply to ALL scenes — modest values are the rule
 *     everywhere, reinforced by an extra dampening factor applied in
 *     core/lightroom-mapping-engine (Phase 3).
 *
 * Public API is unchanged: generateBasicPanel(stats) → same return shape,
 * with one additive field: `toneStyle` (style classification metadata).
 */

import { clamp } from '../color-engine/index.js';

const Z = {
  shadows:     { lo:   0, hi:  51 },
  darkTones:   { lo:  52, hi: 101 },
  midtones:    { lo: 102, hi: 152 },
  brightTones: { lo: 153, hi: 203 },
  highlights:  { lo: 204, hi: 255 },
};

// Scene table now only carries light descriptive bias — NOT correction
// targets. tMed/tAvg (the old "push luminance toward this" values) are gone.
const SCENE = {
  Portrait:  { label: 'Portrait'  },
  Wedding:   { label: 'Wedding'   },
  Landscape: { label: 'Landscape' },
  Travel:    { label: 'Travel'    },
  General:   { label: 'General'   },
};

// Style-preservation guardrails — modest, explainable ranges.
// Applied to ALL scenes now (previously portrait-only). Values match the
// original portrait guardrails, which were already the most conservative.
const STYLE_LIMITS = {
  exposure:   { lo: -35, hi:  35 },
  contrast:   { lo: -20, hi:  25 },
  highlights: { lo: -55, hi:  10 },
  shadows:    { lo: -25, hi:  35 },
  whites:     { lo: -30, hi:  20 },
  blacks:     { lo: -35, hi:  15 },
};

export function generateBasicPanel(stats) {
  const sc    = SCENE[stats.category] ?? SCENE.General;
  const zones = _zones(stats.histL, stats.total);
  const expCls= _expClass(stats);
  const isPortrait = stats.category === 'Portrait' || stats.category === 'Wedding';

  // ── Classify the existing tonal style BEFORE computing sliders ──────────
  // This drives the "describe, don't correct" behaviour of every slider.
  const toneStyle = _classifyToneStyle(stats, zones);

  const exp_r = _exposure  (stats, zones, toneStyle);
  const con_r = _contrast  (stats, toneStyle);
  const hi_r  = _highlights(stats, zones, toneStyle);
  const sh_r  = _shadows   (stats, zones, toneStyle);
  const wh_r  = _whites    (stats, zones, toneStyle);
  const bl_r  = _blacks    (stats, zones, toneStyle);

  const sliderConfs = [exp_r, con_r, hi_r, sh_r, wh_r, bl_r].map(s => s.confidence);
  const avgConf     = sliderConfs.reduce((a,b)=>a+b,0) / sliderConfs.length;
  const clipPenalty = Math.min(0.3, ((stats.clipHiPct??0) + (stats.clipLoPct??0)) / 100 * 1.5);
  const confidence  = +Math.max(0.1, avgConf - clipPenalty).toFixed(3);

  const warnings = [];
  const minConf = Math.min(...sliderConfs);
  if (minConf < 0.35) {
    const weakSliders = [exp_r,con_r,hi_r,sh_r,wh_r,bl_r]
      .filter(s => s.confidence < 0.35)
      .map(s => s.reason?.split(' ')[0] ?? '?');
    warnings.push(`Low-confidence sliders: ${weakSliders.join(', ')} — image statistics may be ambiguous`);
  }
  if ((stats.clipHiPct??0) > 5)
    warnings.push(`Highlight clipping ${stats.clipHiPct}% — small recovery nudge applied (style preserved otherwise)`);
  if ((stats.clipLoPct??0) > 5)
    warnings.push(`Shadow clipping ${stats.clipLoPct}% — small recovery nudge applied (style preserved otherwise)`);
  if (toneStyle.tag !== 'balanced')
    warnings.push(`Detected "${toneStyle.label}" style — Basic Panel is preserving this look, not correcting it`);

  return {
    exposure:   exp_r,
    contrast:   con_r,
    highlights: hi_r,
    shadows:    sh_r,
    whites:     wh_r,
    blacks:     bl_r,
    zones,
    sceneLabel:    stats.category,
    exposureClass: expCls,
    toneStyle,
    summary:       _summary(stats, expCls, zones, toneStyle),
    confidence,
    warnings,
  };
}

function _zones(histL, total) {
  const out = {};
  for (const [name, { lo, hi }] of Object.entries(Z)) {
    let mass=0, lSum=0, vSum=0;
    for (let i=lo; i<=hi; i++) { mass+=histL[i]; lSum+=i*histL[i]; }
    const mean = mass>0 ? lSum/mass : (lo+hi)/2;
    for (let i=lo; i<=hi; i++) vSum += (i-mean)**2 * histL[i];
    out[name] = {
      massPct: +((mass/Math.max(1,total))*100).toFixed(2),
      mean:    Math.round(mean),
      stdDev:  mass>0 ? Math.round(Math.sqrt(vSum/mass)) : 0,
    };
  }
  return out;
}

function _expClass(s) {
  // Descriptive only — informs the UI label, does NOT drive correction.
  if (s.avgLum<85  && (s.clipLoPct??0)>2) return 'underexposed';
  if (s.avgLum>185 && (s.clipHiPct??0)>2) return 'overexposed';
  if (s.avgLum<100) return 'slightly_under';
  if (s.avgLum>165) return 'slightly_over';
  return 'correct';
}

// ─── Tone style classification ─────────────────────────────────────────────
// Reads the image's existing tonal character so every slider function below
// can decide whether to PRESERVE it (value≈0) or protect it from clipping.

function _classifyToneStyle(s, zones) {
  const labL   = s.avgLabL ?? (s.avgLum / 255) * 100;
  const hiM    = zones.highlights.massPct;
  const brM    = zones.brightTones.massPct;
  const shM    = zones.shadows.massPct;
  const dkM    = zones.darkTones.massPct;
  const bp     = s.blackPoint ?? 0;
  const wp     = s.whitePoint ?? 255;
  const sigma  = s.contrast ?? 50;

  // High-key / airy: lots of bright & highlight mass, elevated black point
  // (soft, lifted shadows rather than deep blacks), low overall contrast.
  if ((hiM + brM) > 45 && bp > 8 && sigma < 60)
    return { tag: 'airy_bright', label: 'Airy Bright', desc: `High-key look — ${(hiM+brM).toFixed(0)}% of pixels in bright/highlight zones, lifted black point (${bp}).` };

  // Soft highlight: highlights present but gently rolled off, not blown.
  if (hiM > 20 && hiM <= 45 && (s.clipHiPct ?? 0) < 2)
    return { tag: 'soft_highlight', label: 'Soft Highlight', desc: `Highlights well-populated (${hiM.toFixed(0)}%) with minimal clipping — soft rolloff already present.` };

  // Matte shadow: elevated black point + low shadow mass = faded/lifted
  // blacks, a common intentional film-matte treatment.
  if (bp > 15 && shM < 20 && sigma < 55)
    return { tag: 'matte_shadow', label: 'Matte Shadow', desc: `Black point elevated (${bp}) with flat shadow contrast — faded/matte treatment detected.` };

  // Moody dark: heavy shadow/dark-tone mass, true (low) black point, often
  // paired with higher contrast in the mids.
  if ((shM + dkM) > 40 && bp < 10)
    return { tag: 'moody_dark', label: 'Moody Dark', desc: `Low-key look — ${(shM+dkM).toFixed(0)}% of pixels in shadow/dark zones, true blacks (bp=${bp}).` };

  // High contrast: wide standard deviation, both ends populated.
  if (sigma > 72 && hiM > 10 && shM > 10)
    return { tag: 'high_contrast', label: 'High Contrast', desc: `Wide tonal spread (σ=${sigma}) with both shadow and highlight presence — punchy/contrasty edit.` };

  // Low contrast: narrow standard deviation, mids-heavy.
  if (sigma < 32)
    return { tag: 'low_contrast', label: 'Low Contrast', desc: `Narrow tonal spread (σ=${sigma}) — flat, low-contrast treatment.` };

  return { tag: 'balanced', label: 'Balanced', desc: `Well-distributed tones (σ=${sigma}, L*=${labL.toFixed(0)}) — no dominant stylistic skew detected.` };
}

// ─── Exposure ─────────────────────────────────────────────────────────────────
// Style-preservation: default 0. The ONLY legitimate reasons to move this
// slider are (a) real highlight/shadow clipping — unrecoverable data loss,
// not a style choice — and (b) a genuinely broken frame (near-black or
// near-white average with almost no dynamic range, i.e. a capture defect,
// not an intentional moody/airy edit).
function _exposure(s, zones, toneStyle) {
  const clipHi = s.clipHiPct ?? 0;
  const clipLo = s.clipLoPct ?? 0;
  const dr     = s.drStops ?? 5;

  let value = 0;
  let reasonKind = 'preserved';

  if (clipHi > 2) {
    // Small, proportional recovery nudge — not a brightness correction.
    value = -clamp(Math.round(clipHi * 3), 3, 30);
    reasonKind = 'clip_hi';
  } else if (clipLo > 2) {
    value = clamp(Math.round(clipLo * 2), 3, 20);
    reasonKind = 'clip_lo';
  }

  // Genuinely broken frame safety net — near-uniform AND extreme luminance.
  // A true moody-dark or airy-bright EDIT still has meaningful dynamic
  // range; this only fires for flat, essentially blank frames.
  if (dr < 1.2 && s.avgLum < 15)  { value = Math.max(value, 15);  reasonKind = 'broken_dark';  }
  if (dr < 1.2 && s.avgLum > 240) { value = Math.min(value, -15); reasonKind = 'broken_bright'; }

  value = clamp(value, STYLE_LIMITS.exposure.lo, STYLE_LIMITS.exposure.hi);

  const conf = reasonKind === 'preserved' ? 0.80 : 0.70;
  const dir  = value >  3 ? 'increase' : value < -3 ? 'decrease' : 'neutral';
  const expStr = (value >= 0 ? '+' : '') + (value / 100).toFixed(2);

  const reason = {
    preserved:     `Exposure kept near 0 (${expStr} EV) — reference treated as an intentional edit, not auto-corrected.`,
    clip_hi:       `${clipHi}% highlight clipping — small ${expStr} EV recovery nudge; style otherwise preserved.`,
    clip_lo:       `${clipLo}% shadow clipping — small ${expStr} EV recovery nudge; style otherwise preserved.`,
    broken_dark:   `Near-blank dark frame (avgLum=${Math.round(s.avgLum)}, DR=${dr}EV) — treated as a capture defect, not a moody edit.`,
    broken_bright: `Near-blank bright frame (avgLum=${Math.round(s.avgLum)}, DR=${dr}EV) — treated as a capture defect, not an airy edit.`,
  }[reasonKind];

  return { value, confidence: conf, reason, direction: dir };
}

// ─── Contrast ─────────────────────────────────────────────────────────────────
// Style-preservation: the existing σ IS the style (punchy vs flat). Only
// tiny nudges at the extremes — never a push toward an "ideal" value.
function _contrast(s, toneStyle) {
  const sigma = s.contrast ?? 50;
  let value = 0;

  if      (sigma < 28) value = 8;    // very flat — tiny lift for minimal definition
  else if (sigma < 38) value = 4;
  else if (sigma > 80) value = -6;   // already very punchy — tiny protective ease
  else if (sigma > 68) value = -2;

  value = clamp(value, STYLE_LIMITS.contrast.lo, STYLE_LIMITS.contrast.hi);

  const conf = 0.65;
  const dir  = value > 3 ? 'increase' : value < -3 ? 'decrease' : 'neutral';
  const reason = dir === 'neutral'
    ? `Contrast (σ=${sigma}) preserved as-is — "${toneStyle.label}" style already established.`
    : value > 0
    ? `Very flat histogram (σ=${sigma}) — tiny +${value} lift, well short of a full correction.`
    : `Already high-contrast (σ=${sigma}) — tiny ${value} ease to protect extremes, style preserved.`;
  return { value, confidence: conf, reason, direction: dir };
}

// ─── Highlights ───────────────────────────────────────────────────────────────
// Style-preservation: airy/bright and soft-highlight looks are PRESERVED
// (value stays 0) — pulling highlights down would destroy exactly the look
// we're trying to extract. Only real clipping triggers a recovery nudge.
function _highlights(s, zones, toneStyle) {
  const hiM  = zones.highlights.massPct;
  const clip = s.clipHiPct ?? 0;
  let value = 0;
  let reasonKind = 'preserved';

  if (clip > 5) {
    value = -clamp(Math.round(20 + clip * 4), 20, 55);
    reasonKind = 'clip_major';
  } else if (clip > 1.5) {
    value = -clamp(Math.round(8 + clip * 6), 8, 28);
    reasonKind = 'clip_minor';
  }
  // No else branch: airy_bright / soft_highlight / moody_dark / balanced
  // all leave highlights at 0 — the existing rolloff character is the style.

  value = clamp(value, STYLE_LIMITS.highlights.lo, STYLE_LIMITS.highlights.hi);

  const conf = reasonKind === 'preserved' ? (toneStyle.tag !== 'balanced' ? 0.75 : 0.60) : 0.90;
  const dir  = value < -3 ? 'decrease' : value > 3 ? 'increase' : 'neutral';
  const reason = {
    preserved:   `Highlights (${hiM.toFixed(0)}% mass) preserved — part of the "${toneStyle.label}" look, not reduced.`,
    clip_minor:  `Minor clipping (${clip}%) — small ${value} recovery nudge to protect highlight detail.`,
    clip_major:  `${clip}% clipped — ${value} recovery nudge to prevent further data loss.`,
  }[reasonKind];
  return { value, confidence: conf, reason, direction: dir };
}

// ─── Shadows ──────────────────────────────────────────────────────────────────
// Style-preservation: matte (lifted) and moody-dark (deep) shadow looks are
// both preserved. Lifting shadows to "open up detail" is exactly the
// auto-correction behaviour we must avoid — an editor who wanted deep
// shadows crushed them on purpose.
function _shadows(s, zones, toneStyle) {
  const shM  = zones.shadows.massPct;
  const clip = s.clipLoPct ?? 0;
  let value = 0;
  let reasonKind = 'preserved';

  if (clip > 5) {
    value = clamp(Math.round(15 + clip * 4), 15, 45);
    reasonKind = 'clip_major';
  } else if (clip > 1.5) {
    value = clamp(Math.round(6 + clip * 5), 6, 22);
    reasonKind = 'clip_minor';
  }
  // matte_shadow / moody_dark / airy_bright / balanced: value stays 0 —
  // whatever shadow depth exists is the intended style.

  value = clamp(value, STYLE_LIMITS.shadows.lo, STYLE_LIMITS.shadows.hi);

  const conf = reasonKind === 'preserved' ? (toneStyle.tag !== 'balanced' ? 0.75 : 0.60) : 0.88;
  const dir  = value > 3 ? 'increase' : value < -3 ? 'decrease' : 'neutral';
  const reason = {
    preserved:  `Shadows (${shM.toFixed(0)}% mass) preserved — "${toneStyle.label}" character kept intact, not lifted.`,
    clip_minor: `Minor shadow clipping (${clip}%) — small +${value} recovery nudge for detail.`,
    clip_major: `${clip}% crushed — +${value} recovery nudge to prevent total detail loss.`,
  }[reasonKind];
  return { value, confidence: conf, reason, direction: dir };
}

// ─── Whites ───────────────────────────────────────────────────────────────────
// Style-preservation: NEVER boost whites to "stretch" a low white point —
// that is auto-correction by definition. Only pull back for real clipping.
function _whites(s, zones, toneStyle) {
  const wp   = s.whitePoint ?? 255;
  const clip = s.clipHiPct ?? 0;
  let value = 0;
  let reasonKind = 'preserved';

  if (clip > 3) {
    value = -clamp(Math.round(10 + clip * 5), 10, 40);
    reasonKind = 'clip_major';
  } else if (clip > 1) {
    value = -clamp(Math.round(clip * 8), 5, 20);
    reasonKind = 'clip_minor';
  }
  // wp < 200 previously triggered a +boost "stretch" — removed. A low white
  // point is very often an intentional flat/matte edit, not a defect.

  value = clamp(value, STYLE_LIMITS.whites.lo, STYLE_LIMITS.whites.hi);

  const conf = reasonKind === 'preserved' ? 0.70 : 0.85;
  const dir  = value > 3 ? 'increase' : value < -3 ? 'decrease' : 'neutral';
  const reason = {
    preserved:  `White point (${wp}) preserved as-is — no stretching applied, style kept intact.`,
    clip_minor: `Minor clipping (${clip}%) — small ${value} pullback for headroom.`,
    clip_major: `${clip}% clipped — ${value} pullback to reduce highlight data loss.`,
  }[reasonKind];
  return { value, confidence: conf, reason, direction: dir };
}

// ─── Blacks ───────────────────────────────────────────────────────────────────
// Style-preservation: an elevated black point is very often an intentional
// matte/faded treatment; a near-zero black point is very often intentional
// moody depth. Neither is "fixed" — only real crushing triggers recovery.
function _blacks(s, zones, toneStyle) {
  const bp   = s.blackPoint ?? 0;
  const clip = s.clipLoPct ?? 0;
  let value = 0;
  let reasonKind = 'preserved';

  if (clip > 4) {
    value = clamp(Math.round(bp * 0.7 + clip * 3), 10, 40);
    reasonKind = 'clip_major';
  } else if (toneStyle.tag === 'moody_dark' && bp < 6 && clip < 1) {
    // Tiny reinforcing deepen — well within "modest," never a big push.
    value = -3;
    reasonKind = 'moody_reinforce';
  }
  // matte_shadow (bp already elevated): value stays 0 — deepening blacks
  // here would destroy the matte look, which is exactly what we must avoid.

  value = clamp(value, STYLE_LIMITS.blacks.lo, STYLE_LIMITS.blacks.hi);

  const conf = reasonKind === 'preserved' ? (toneStyle.tag !== 'balanced' ? 0.72 : 0.55) : 0.85;
  const dir  = value > 3 ? 'increase' : value < -3 ? 'decrease' : 'neutral';
  const reason = {
    preserved:       `Black point (${bp}) preserved — "${toneStyle.label}" treatment kept intact, not deepened or lifted.`,
    moody_reinforce: `Moody-dark style detected — tiny ${value} reinforcement, well within modest range.`,
    clip_major:       `${clip}% crushed — +${value} recovery nudge to preserve shadow texture.`,
  }[reasonKind];
  return { value, confidence: conf, reason, direction: dir };
}

function _summary(s, expCls, zones, toneStyle) {
  const parts  = [s.category, toneStyle.label];
  if ((s.clipHiPct ?? 0) > 1) parts.push(`${s.clipHiPct}% highlight clip`);
  if ((s.clipLoPct ?? 0) > 1) parts.push(`${s.clipLoPct}% shadow clip`);
  return parts.join(' · ');
}
