/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH × PHOTOGRAPHER INTELLIGENCE BRIDGE (EPIC 1.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Turns Reference Color Match's own lightweight signals (palette, tone
 * zones, the transfer profile, and the preservation report) into
 * "Reference Color Intelligence" — a photographer-readable colour reading
 * that can SUPPORT the existing Photographer Intelligence layer
 * (core/decision-engine's Style Vocabulary/DNA/Validation/Feasibility)
 * without ever replacing, overwriting, or decreasing its confidence.
 *
 * Deliberately does NOT duplicate core/decision-engine's own
 * _classifyPhotographerStyle() — that classifier needs a full Style
 * Feature Graph / Style Fingerprint (histogram, HSL analysis, skin
 * classification, scene classification, colour harmony, etc.), none of
 * which Reference Color Match computes. This module instead produces its
 * own, independent, much lighter-weight `styleHints` guess from colour
 * evidence alone — named using the SAME 17-style vocabulary so the two
 * can be compared by name, but computed via entirely separate, simpler
 * heuristics. See core/decision-engine's optional
 * `referenceColorIntelligence` input for how a match between the two is
 * turned into supporting evidence (never a score change).
 *
 * No Lightroom sliders. No XMP values. No mapping. Every function here
 * reads already-computed values from core/color-match/* and computes
 * nothing from raw pixels.
 */

// ── Hue family naming (0-360°) ──────────────────────────────────────────────
const HUE_BANDS = [
  { max: 15, name: 'Red' }, { max: 40, name: 'Orange' }, { max: 55, name: 'Gold' },
  { max: 90, name: 'Olive' }, { max: 150, name: 'Green' }, { max: 185, name: 'Teal' },
  { max: 215, name: 'Sky Blue' }, { max: 255, name: 'Blue' }, { max: 290, name: 'Purple' },
  { max: 330, name: 'Magenta' }, { max: 346, name: 'Rose' }, { max: 361, name: 'Red' },
];
function _hueFamily(h) {
  for (const band of HUE_BANDS) if (h <= band.max) return band.name;
  return 'Red';
}

/**
 * Names one HSL colour in plain photographer language (e.g. "Muted
 * Green", "Warm Brown", "Cream White", "Golden Skin"). Deliberately a
 * heuristic naming table, not a colorimetric standard — consistent with
 * tone-zone-analyzer.js's own "directional hint, not colour science"
 * approach elsewhere in this feature.
 */
function _nameColor({ h, s, l }, { skinLike = false, zoneSuffix = null } = {}) {
  if (s < 10) {
    let base;
    if (l > 88) base = 'Cream White';
    else if (l > 62) base = 'Neutral Gray';
    else if (l > 28) base = 'Charcoal Gray';
    else base = 'Deep Black';
    return zoneSuffix ? `${base} ${zoneSuffix}` : base;
  }
  let family = _hueFamily(h);
  // Warm hue + moderate saturation + low-mid lightness reads as "Brown", not "Dark Orange"
  if ((family === 'Orange' || family === 'Gold') && l < 48 && s < 70) family = 'Brown';
  if (skinLike && (family === 'Orange' || family === 'Gold' || family === 'Brown') && l > 42) {
    const label = s > 32 ? 'Golden Skin' : 'Soft Skin';
    return zoneSuffix ? `${label} ${zoneSuffix}` : label;
  }
  let modifier = '';
  if (s < 24) modifier = 'Muted';
  else if (l > 76) modifier = 'Pastel';
  else if (l < 30) modifier = 'Deep';
  else if (s > 66) modifier = 'Rich';
  else if (family === 'Olive') modifier = 'Film';
  const label = modifier ? `${modifier} ${family}` : family;
  return zoneSuffix ? `${label} ${zoneSuffix}` : label;
}

// ── Task 3: Palette Signature ───────────────────────────────────────────────
function _buildPaletteSignature(palette) {
  const colors = palette?.colors ?? [];
  const named = colors.map(c => ({ ...c, name: _nameColor(c.hsl, { skinLike: c.hsl.h >= 15 && c.hsl.h <= 45 && c.hsl.l > 45 }) }));
  const byWeight = [...named].sort((a, b) => b.weight - a.weight);
  const primary = byWeight.slice(0, 2);
  const secondary = byWeight.slice(2, 4);
  const neutral = named.filter(c => c.hsl.s < 15);
  const accent = named.filter(c => c.hsl.s >= 55).sort((a, b) => b.hsl.s - a.hsl.s).slice(0, 2);
  return {
    primaryColors: primary.map(c => ({ name: c.name, hex: c.hex, weight: c.weight })),
    secondaryColors: secondary.map(c => ({ name: c.name, hex: c.hex, weight: c.weight })),
    neutralColors: neutral.map(c => ({ name: c.name, hex: c.hex, weight: c.weight })),
    accentColors: accent.map(c => ({ name: c.name, hex: c.hex, weight: c.weight })),
    summary: primary.map(c => c.name).join(' + ') || 'No dominant colour detected',
  };
}

// ── Tone Zone Signature (Shadow/Midtone/Highlight, named) ──────────────────
function _buildToneZoneSignature(toneZones) {
  const nameZone = (zone, label) => {
    const hsl = _rgbToHslLite(zone.avgColor.r, zone.avgColor.g, zone.avgColor.b);
    return { name: _nameColor(hsl, { zoneSuffix: label }), hex: zone.avgColor.hex, saturation: zone.saturation, temperatureHint: zone.temperatureHint };
  };
  return {
    shadow: nameZone(toneZones.shadow, 'Shadow'),
    midtone: nameZone(toneZones.midtone, 'Midtone'),
    highlight: nameZone(toneZones.highlight, 'Highlight'),
  };
}
function _rgbToHslLite(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ── Tasks: dominant hue / luminance / contrast / saturation / temperature/tint ──
function _deriveHueFamilies(palette) {
  const colors = palette?.colors ?? [];
  const meaningful = colors.filter(c => c.hsl.s > 12);
  const families = {};
  for (const c of meaningful) {
    const fam = _hueFamily(c.hsl.h);
    families[fam] = (families[fam] ?? 0) + c.weight;
  }
  return Object.entries(families).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, weight]) => ({ name, weight: +weight.toFixed(3) }));
}
function _deriveLuminancePattern(toneZones) {
  const shadowShare = toneZones.shadow.pixelShare, highlightShare = toneZones.highlight.pixelShare;
  if (highlightShare > shadowShare * 1.6) return 'high-key';
  if (shadowShare > highlightShare * 1.6) return 'low-key';
  return 'balanced';
}
function _deriveContrastStyle(toneZones) {
  const c = toneZones.contrast ?? 50;
  if (c >= 65) return 'punchy';
  if (c <= 35) return 'soft-flat';
  return 'moderate';
}
function _deriveSaturationStyle(palette) {
  const colors = palette?.colors ?? [];
  const avgSat = colors.reduce((s, c) => s + c.hsl.s * c.weight, 0);
  if (avgSat < 22) return 'muted';
  if (avgSat > 55) return 'vivid';
  return 'moderate';
}
function _deriveTemperatureIntent(toneZones) {
  const avg = (toneZones.shadow.temperatureHint * toneZones.shadow.pixelShare +
               toneZones.midtone.temperatureHint * toneZones.midtone.pixelShare +
               toneZones.highlight.temperatureHint * toneZones.highlight.pixelShare) || 0;
  const direction = avg > 8 ? 'warm' : avg < -8 ? 'cool' : 'neutral';
  return { direction, magnitude: Math.round(Math.abs(avg)) };
}
function _deriveTintIntent(toneZones) {
  const avg = (toneZones.shadow.tintHint * toneZones.shadow.pixelShare +
               toneZones.midtone.tintHint * toneZones.midtone.pixelShare +
               toneZones.highlight.tintHint * toneZones.highlight.pixelShare) || 0;
  const direction = avg > 6 ? 'green-leaning' : avg < -6 ? 'magenta-leaning' : 'neutral';
  return { direction, magnitude: Math.round(Math.abs(avg)) };
}
function _deriveZoneCharacter(zone, zoneName) {
  const hsl = _rgbToHslLite(zone.avgColor.r, zone.avgColor.g, zone.avgColor.b);
  const parts = [];
  parts.push(zone.temperatureHint > 10 ? 'warm' : zone.temperatureHint < -10 ? 'cool' : 'neutral');
  parts.push(zone.saturation < 15 ? 'clean' : zone.saturation > 45 ? 'richly coloured' : 'lightly coloured');
  if (zoneName === 'highlight' && hsl.l > 92 && zone.saturation < 10) parts.push('roll-off toward pure white');
  if (zoneName === 'shadow' && hsl.l > 25) parts.push('lifted/matte rather than crushed');
  return parts.join(', ');
}

// ── Task 2: Color Mood Intelligence ─────────────────────────────────────────
const MOOD_RULES = [
  // Specific, named looks are checked (and weighted) ahead of generic
  // catch-alls (High Key/Low Key) that would otherwise win ties on
  // references that legitimately match both — e.g. a Luxury Wedding
  // photo is very often also technically "high-key," but the more
  // specific label is the more useful one to report.
  { name: 'Luxury Wedding', test: (s) => s.luminancePattern === 'high-key' && s.temperatureIntent.direction !== 'cool' && s.saturationStyle === 'muted', weight: 0.92 },
  { name: 'Golden Hour', test: (s) => s.temperatureIntent.direction === 'warm' && s.temperatureIntent.magnitude > 20 && s.luminancePattern !== 'low-key', weight: 0.85 },
  { name: 'Warm Luxury', test: (s) => s.temperatureIntent.direction === 'warm' && s.saturationStyle !== 'vivid' && s.contrastStyle === 'moderate', weight: 0.8 },
  { name: 'Moody Film', test: (s) => s.luminancePattern === 'low-key' && s.saturationStyle !== 'vivid' && s.hueFamilies.some(h => h.name === 'Olive' || h.name === 'Brown'), weight: 0.85 },
  { name: 'High Key', test: (s) => s.luminancePattern === 'high-key' && s.contrastStyle === 'soft-flat', weight: 0.78 },
  { name: 'Low Key', test: (s) => s.luminancePattern === 'low-key' && s.contrastStyle !== 'soft-flat', weight: 0.78 },
  { name: 'Dreamy', test: (s) => s.contrastStyle === 'soft-flat' && s.saturationStyle === 'muted' && s.luminancePattern !== 'low-key', weight: 0.75 },
  { name: 'Soft Portrait', test: (s) => s.contrastStyle === 'soft-flat' && s.saturationStyle !== 'vivid', weight: 0.7 },
  { name: 'Muted Film', test: (s) => s.saturationStyle === 'muted' && s.contrastStyle !== 'punchy', weight: 0.65 },
  { name: 'Clean Commercial', test: (s) => s.contrastStyle === 'punchy' && s.saturationStyle === 'moderate' && s.temperatureIntent.direction === 'neutral', weight: 0.75 },
  { name: 'Editorial', test: (s) => s.contrastStyle === 'punchy' && s.saturationStyle === 'vivid', weight: 0.75 },
  { name: 'Natural Documentary', test: (s) => s.contrastStyle === 'moderate' && s.saturationStyle === 'moderate' && s.temperatureIntent.magnitude < 15, weight: 0.6 },
  { name: 'Minimal', test: (s) => s.saturationStyle === 'muted' && s.hueFamilies.length <= 1, weight: 0.6 },
  { name: 'Pastel', test: (s) => s.saturationStyle === 'muted' && s.luminancePattern === 'high-key', weight: 0.68 },
  { name: 'Earth Tone', test: (s) => s.hueFamilies.some(h => ['Brown', 'Olive', 'Gold', 'Orange'].includes(h.name)) && s.saturationStyle !== 'vivid', weight: 0.75 },
];

function _inferColorMood(signals) {
  const matches = MOOD_RULES.filter(r => r.test(signals)).sort((a, b) => b.weight - a.weight);
  if (!matches.length) {
    return { colorMood: 'Balanced Natural', confidence: 0.35, reason: 'No strong colour-mood signature matched — treated as a balanced, natural colour reading.' };
  }
  const top = matches[0];
  const confidence = +Math.min(0.95, top.weight * (matches.length === 1 ? 1.0 : 0.9)).toFixed(2);
  return { colorMood: top.name, confidence, reason: `Colour evidence (${signals.temperatureIntent.direction} temperature, ${signals.contrastStyle} contrast, ${signals.saturationStyle} saturation, ${signals.luminancePattern} luminance) matched "${top.name}".` };
}

// ── styleHints: independent, colour-only guesses named with the SAME
//    17-style vocabulary Photographer Intelligence uses, so the two can
//    be compared by name — computed via completely separate heuristics,
//    never by calling into core/decision-engine.
const MOOD_TO_STYLE_HINTS = {
  'High Key': ['Airy Wedding', 'Bright Lifestyle', 'Korean Clean'],
  'Low Key': ['Moody Cinematic', 'Dark Forest'],
  'Golden Hour': ['Warm Earth', 'Bright Lifestyle'],
  'Warm Luxury': ['Luxury Wedding', 'Warm Earth'],
  'Luxury Wedding': ['Luxury Wedding', 'Airy Wedding'],
  'Dreamy': ['Soft Portrait', 'Japanese Soft'],
  'Soft Portrait': ['Soft Portrait', 'Clean Portrait'],
  'Moody Film': ['Brown Film', 'Moody Cinematic'],
  'Muted Film': ['Brown Film', 'Muted Lifestyle'],
  'Clean Commercial': ['Editorial Fashion', 'Clean Portrait'],
  'Editorial': ['Editorial Fashion', 'Fine Art Portrait'],
  'Natural Documentary': ['Natural Documentary'],
  'Minimal': ['Korean Clean', 'Soft Matte'],
  'Pastel': ['Green Pastel', 'Japanese Soft'],
  'Earth Tone': ['Warm Earth', 'Brown Film'],
  'Balanced Natural': ['Clean Portrait', 'Natural Documentary'],
};
function _deriveStyleHints({ colorMood, moodConfidence, hueFamilies }) {
  const names = MOOD_TO_STYLE_HINTS[colorMood] ?? ['Clean Portrait'];
  return names.map((name, i) => ({
    styleName: name,
    matchScore: +Math.max(0.2, moodConfidence - i * 0.15).toFixed(2),
    reason: `Suggested by colour mood "${colorMood}"${hueFamilies[0] ? ` and ${hueFamilies[0].name.toLowerCase()}-dominant palette` : ''}.`,
  }));
}

/**
 * Main entry point. Reads outputs already computed elsewhere in
 * core/color-match/* — computes no new pixel analysis.
 * @param {object} params
 * @param {object} params.palette - from palette-extractor.js
 * @param {object} params.toneZones - from tone-zone-analyzer.js (the REFERENCE image's own zones)
 * @param {object} params.transferProfile - from color-transfer-engine.js
 * @param {object} params.preserveReport - from preserve-engine.js (the profile after applyPreservation, carries `preservationNotes`)
 * @returns {object} referenceColorIntelligence
 */
export function buildReferenceColorIntelligence({ palette, toneZones, transferProfile, preserveReport }) {
  const paletteSignature = _buildPaletteSignature(palette);
  const toneZoneSignature = _buildToneZoneSignature(toneZones);
  const dominantHueFamilies = _deriveHueFamilies(palette);
  const dominantLuminancePattern = _deriveLuminancePattern(toneZones);
  const dominantContrastStyle = _deriveContrastStyle(toneZones);
  const dominantSaturationStyle = _deriveSaturationStyle(palette);
  const temperatureIntent = _deriveTemperatureIntent(toneZones);
  const tintIntent = _deriveTintIntent(toneZones);
  const highlightCharacter = _deriveZoneCharacter(toneZones.highlight, 'highlight');
  const shadowCharacter = _deriveZoneCharacter(toneZones.shadow, 'shadow');

  const moodSignals = {
    hueFamilies: dominantHueFamilies, luminancePattern: dominantLuminancePattern,
    contrastStyle: dominantContrastStyle, saturationStyle: dominantSaturationStyle, temperatureIntent,
  };
  const { colorMood, confidence: moodConfidence, reason: moodReason } = _inferColorMood(moodSignals);
  const styleHints = _deriveStyleHints({ colorMood, moodConfidence, hueFamilies: dominantHueFamilies });

  const risks = [];
  if ((palette?.confidence ?? 1) < 0.5) risks.push('Palette extraction confidence is low — the reference image may have limited colour variety or be hard to sample reliably.');
  if (dominantHueFamilies.length === 0) risks.push('No clearly dominant hue family — colour mood inference is based mostly on tone/contrast, not colour.');
  if ((preserveReport?.preservationNotes ?? []).some(n => n.includes('no easing applied') === false && n.includes('Preserve Skin Tone'))) {
    risks.push('Skin protection was actively applied — some colour signature values reflect a protected, not raw, reading.');
  }

  const reasons = [
    moodReason,
    `Palette signature: ${paletteSignature.summary}.`,
    `Tone reading: ${dominantLuminancePattern} luminance, ${dominantContrastStyle} contrast, ${dominantSaturationStyle} saturation.`,
    `White balance intent: ${temperatureIntent.direction} (${temperatureIntent.magnitude}), tint ${tintIntent.direction} (${tintIntent.magnitude}).`,
  ];

  const confidence = +Math.max(0.1, Math.min(0.95,
    moodConfidence * 0.5 + (palette?.confidence ?? 0.6) * 0.3 + (dominantHueFamilies.length > 0 ? 0.2 : 0.05)
  )).toFixed(3);

  return {
    paletteSignature, toneZoneSignature, colorMood, dominantHueFamilies,
    dominantLuminancePattern, dominantContrastStyle, dominantSaturationStyle,
    temperatureIntent, tintIntent, highlightCharacter, shadowCharacter,
    styleHints, confidence, risks, reasons,
  };
}
