/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Color Transfer Engine (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the genuinely new logic this EPIC adds — everything else in
 * core/color-match/ deliberately reuses an existing engine. Given a
 * reference image's extracted palette + tone zones, and a target image's
 * own tone zones/stats, this module computes a bounded set of Lightroom-
 * style parameter deltas that would push the target's colour character
 * toward the reference's — scaled by a 0–100 intensity and shaped by one
 * of five named modes.
 *
 * "Must avoid extreme colour damage" (an explicit requirement) is handled
 * two ways: (1) every computed delta is clamped against SAFE_BOUNDS below,
 * which are intentionally tighter than core/xmp-validator's own
 * HARD_LIMITS, treating this module's output as a first, conservative
 * safety pass; (2) core/xmp-validator's quickSafetyClamp() is still run
 * again in reference-xmp-generator.js as the final, authoritative safety
 * net before export — the same "more than one safety net" pattern used
 * throughout the rest of the pipeline (see docs/project/01_PROJECT_VISION.md).
 */

// ── Safe bounds — intentionally tighter than core/xmp-validator's HARD_LIMITS.
// This is the module's OWN conservative ceiling; xmp-validator's ceiling is
// the separate, final authority applied later during XMP generation.
const SAFE_BOUNDS = {
  temp: 55, tint: 35, exposure: 45, contrast: 22, highlights: 35, shadows: 35,
  whites: 22, blacks: 22, clarity: 25, dehaze: 20, texture: 20, vibrance: 35, saturation: 25,
  hslSat: 18, hslHue: 12, hslLum: 12, gradeSat: 22, gradeLum: 15,
};
const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));

// ── Mode weight profiles — each scales a DIFFERENT part of the transfer,
// not just an overall multiplier, so each mode reads as a genuinely
// different photographic approach rather than "same thing, weaker/stronger".
const MODES = {
  Natural:   { wb: 0.55, tone: 0.65, colorGrade: 0.45, hsl: 0.45, contrast: 0.55, clarity: 0.35, label: 'Natural — closest to a faithful, restrained match' },
  Cinematic: { wb: 0.70, tone: 0.80, colorGrade: 1.00, hsl: 0.60, contrast: 0.90, clarity: 0.60, label: 'Cinematic — leans on Colour Grading shadow/highlight separation' },
  Vintage:   { wb: 0.90, tone: 0.55, colorGrade: 0.70, hsl: 0.40, contrast: 0.40, clarity: 0.20, label: 'Vintage — warmer, flatter, softer clarity' },
  Soft:      { wb: 0.50, tone: 0.50, colorGrade: 0.40, hsl: 0.30, contrast: 0.30, clarity: 0.10, label: 'Soft — gentle contrast and clarity, protective by nature' },
  Bold:      { wb: 0.70, tone: 0.90, colorGrade: 0.80, hsl: 0.85, contrast: 1.00, clarity: 0.75, label: 'Bold — strongest colour and contrast transfer' },
};

export const AVAILABLE_MODES = Object.keys(MODES);

function _weightedZoneAvg(zones, field) {
  const total = (zones.shadow.pixelShare + zones.midtone.pixelShare + zones.highlight.pixelShare) || 1;
  return (zones.shadow[field] * zones.shadow.pixelShare +
          zones.midtone[field] * zones.midtone.pixelShare +
          zones.highlight[field] * zones.highlight.pixelShare) / total;
}

/** Converts an avg RGB colour into a hue/saturation offset relative to
 *  neutral grey — the basis for this zone's Colour Grading contribution. */
function _colorGradeOffset(avgColor) {
  const { r, g, b } = avgColor;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const chroma = mx - mn;
  if (chroma < 4) return { hue: 0, sat: 0 }; // effectively neutral — no meaningful grade direction
  let hue;
  if (mx === r) hue = ((g - b) / chroma) % 6;
  else if (mx === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = Math.round(hue * 60); if (hue < 0) hue += 360;
  const sat = Math.round((chroma / 255) * 100);
  return { hue, sat };
}

/**
 * Builds a bounded Lightroom-style delta profile transferring the
 * reference's colour character toward the target.
 *
 * @param {object} params
 * @param {object} params.referencePalette   from palette-extractor.js
 * @param {object} params.referenceToneZones from tone-zone-analyzer.js
 * @param {object} params.targetToneZones    from tone-zone-analyzer.js (the target image's OWN zones)
 * @param {number} params.intensity          0–100
 * @param {string} params.mode               one of AVAILABLE_MODES
 * @returns {object} delta profile (see inline fields) — NOT yet a full XMP preset;
 *          reference-xmp-generator.js converts this into the preset-engine shape.
 */
export function buildColorTransferProfile({ referencePalette, referenceToneZones, targetToneZones, intensity = 60, mode = 'Natural' }) {
  const modeWeights = MODES[mode] ?? MODES.Natural;
  const amt = Math.max(0, Math.min(100, intensity)) / 100;
  const reasons = [];

  // ── White Balance: overall warmth/tint difference, reference minus target ──
  const refWarmth = _weightedZoneAvg(referenceToneZones, 'temperatureHint');
  const tgtWarmth = _weightedZoneAvg(targetToneZones, 'temperatureHint');
  const refTint    = _weightedZoneAvg(referenceToneZones, 'tintHint');
  const tgtTint    = _weightedZoneAvg(targetToneZones, 'tintHint');
  const temp = clamp(Math.round((refWarmth - tgtWarmth) * 0.8 * amt * modeWeights.wb), SAFE_BOUNDS.temp);
  const tint = clamp(Math.round((refTint - tgtTint) * 0.8 * amt * modeWeights.wb), SAFE_BOUNDS.tint);
  reasons.push(`ปรับสมดุลแสง (White Balance) ให้เข้าใกล้ความอุ่นของภาพอ้างอิง (ผลต่าง Δ${refWarmth.toFixed(0)} เทียบกับภาพเป้าหมาย ${tgtWarmth.toFixed(0)})`);

  // ── Tonal balance: contrast + per-zone brightness (highlights/shadows/whites/blacks) ──
  const contrastDelta = clamp(Math.round((referenceToneZones.contrast - targetToneZones.contrast) * 0.5 * amt * modeWeights.contrast), SAFE_BOUNDS.contrast);
  const shadowLumDiff  = (referenceToneZones.shadow.avgColor.r + referenceToneZones.shadow.avgColor.g + referenceToneZones.shadow.avgColor.b) / 3
                       - (targetToneZones.shadow.avgColor.r + targetToneZones.shadow.avgColor.g + targetToneZones.shadow.avgColor.b) / 3;
  const highlightLumDiff = (referenceToneZones.highlight.avgColor.r + referenceToneZones.highlight.avgColor.g + referenceToneZones.highlight.avgColor.b) / 3
                       - (targetToneZones.highlight.avgColor.r + targetToneZones.highlight.avgColor.g + targetToneZones.highlight.avgColor.b) / 3;
  const shadows    = clamp(Math.round(shadowLumDiff * 0.4 * amt * modeWeights.tone), SAFE_BOUNDS.shadows);
  const highlights = clamp(Math.round(highlightLumDiff * 0.4 * amt * modeWeights.tone), SAFE_BOUNDS.highlights);
  const whites = clamp(Math.round(highlightLumDiff * 0.25 * amt * modeWeights.tone), SAFE_BOUNDS.whites);
  const blacks = clamp(Math.round(shadowLumDiff * 0.25 * amt * modeWeights.tone), SAFE_BOUNDS.blacks);
  const exposure = clamp(Math.round(((referenceToneZones.midtone.avgColor.r + referenceToneZones.midtone.avgColor.g + referenceToneZones.midtone.avgColor.b) / 3
                       - (targetToneZones.midtone.avgColor.r + targetToneZones.midtone.avgColor.g + targetToneZones.midtone.avgColor.b) / 3) * 0.35 * amt * modeWeights.tone), SAFE_BOUNDS.exposure);
  reasons.push(`ปรับโทนภาพ (Contrast/Shadows/Highlights) จากการเปรียบเทียบความสว่างของแต่ละโซน ปรับตามน้ำหนักของโหมด "${mode}"`);

  // ── Colour Grading: reference's own shadow/midtone/highlight average
  //    colour, converted into a hue/sat offset per zone.
  const gradeShadow    = _colorGradeOffset(referenceToneZones.shadow.avgColor);
  const gradeMidtone   = _colorGradeOffset(referenceToneZones.midtone.avgColor);
  const gradeHighlight = _colorGradeOffset(referenceToneZones.highlight.avgColor);
  const grade = {
    shadowHue: gradeShadow.hue, shadowSat: clamp(Math.round(gradeShadow.sat * amt * modeWeights.colorGrade), SAFE_BOUNDS.gradeSat),
    midtoneHue: gradeMidtone.hue, midtoneSat: clamp(Math.round(gradeMidtone.sat * amt * modeWeights.colorGrade), SAFE_BOUNDS.gradeSat),
    highlightHue: gradeHighlight.hue, highlightSat: clamp(Math.round(gradeHighlight.sat * amt * modeWeights.colorGrade), SAFE_BOUNDS.gradeSat),
    blending: 50,
  };
  reasons.push('ค่าสี Colour Grading ในส่วนเงา/กลาง/สว่าง นำมาจากสีเฉลี่ยของแต่ละโซนในภาพอ้างอิงโดยตรง');

  // ── HSL: nudge the target's HSL toward the reference palette's top
  //    non-neutral hues (skips near-grey colours, which carry no useful
  //    hue direction and would just add noise).
  const hueBucket = h => Math.round(h / 45) % 8; // 8 HSL channel buckets, 45° each
  const CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const hslShift = Object.fromEntries(CHANNELS.map(c => [c, { h: 0, s: 0, l: 0 }]));
  const meaningfulColors = referencePalette.colors.filter(c => c.hsl.s > 12).slice(0, 4);
  for (const c of meaningfulColors) {
    const ch = CHANNELS[hueBucket(c.hsl.h)];
    hslShift[ch].s += c.weight * 40; // weight-proportional nudge, bounded below
  }
  for (const ch of CHANNELS) {
    hslShift[ch].s = clamp(Math.round(hslShift[ch].s * amt * modeWeights.hsl), SAFE_BOUNDS.hslSat);
  }
  reasons.push('ปรับความอิ่มตัวสี HSL แต่ละช่องสีตามโทนสีเด่นที่ไม่เป็นกลางจากพาเลทของภาพอ้างอิง');

  // ── Presence: Vibrance/Saturation follow overall palette saturation vs a mid baseline.
  const avgPaletteSat = referencePalette.colors.reduce((s, c) => s + c.hsl.s * c.weight, 0);
  const vibrance   = clamp(Math.round((avgPaletteSat - 35) * 0.6 * amt * modeWeights.hsl), SAFE_BOUNDS.vibrance);
  const saturation = clamp(Math.round((avgPaletteSat - 35) * 0.3 * amt * modeWeights.hsl), SAFE_BOUNDS.saturation);

  // ── Detail: Clarity/Texture/Dehaze follow the contrast delta lightly —
  //    a punchier reference implies a bit more clarity/dehaze, a flatter one less.
  const clarity = clamp(Math.round(contrastDelta * 0.5 * modeWeights.clarity), SAFE_BOUNDS.clarity);
  const dehaze  = clamp(Math.round(contrastDelta * 0.35 * modeWeights.clarity), SAFE_BOUNDS.dehaze);
  const texture = clamp(Math.round(contrastDelta * 0.25 * modeWeights.clarity), SAFE_BOUNDS.texture);

  return {
    mode, modeLabel: modeWeights.label, intensity: Math.round(amt * 100),
    wb: { temp, tint },
    tone: { exposure, contrast: contrastDelta, highlights, shadows, whites, blacks },
    detail: { clarity, dehaze, texture },
    presence: { vibrance, saturation },
    hsl: hslShift,
    grade,
    reasons,
  };
}
