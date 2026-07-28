/**
 * EPIC 2E-N1 — Reference / Target Signature Engine
 *
 * Normalises analysis evidence into the same deterministic contract for
 * both images. This engine does not recommend Lightroom sliders and does
 * not write XMP. Its only job is to describe the visual state of each image
 * in a directly comparable form.
 */
import {
  COLOR_MATCH_CHANNELS,
  COLOR_MATCH_SIGNATURE_KIND,
  COLOR_MATCH_SIGNATURE_SCHEMA_VERSION,
  assertSignatureRole,
} from './signature-schema.js';

const round = (value, digits = 3) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const zoneLuma = zone => zone?.avgColor
  ? (Number(zone.avgColor.r || 0) + Number(zone.avgColor.g || 0) + Number(zone.avgColor.b || 0)) / 3
  : 128;

function weightedZoneAverage(toneZones, field) {
  const zones = ['shadow', 'midtone', 'highlight'];
  let weighted = 0;
  let total = 0;
  for (const name of zones) {
    const zone = toneZones?.[name];
    if (!zone) continue;
    const weight = clamp(zone.pixelShare, 0, 1);
    weighted += (Number(zone[field]) || 0) * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

function channelForHue(hue) {
  const h = ((Number(hue) % 360) + 360) % 360;
  if (h >= 337.5 || h < 22.5) return 'red';
  if (h < 52.5) return 'orange';
  if (h < 82.5) return 'yellow';
  if (h < 157.5) return 'green';
  if (h < 202.5) return 'aqua';
  if (h < 247.5) return 'blue';
  if (h < 292.5) return 'purple';
  return 'magenta';
}

function buildPaletteChannels(palette) {
  const acc = Object.fromEntries(COLOR_MATCH_CHANNELS.map(channel => [channel, {
    weight: 0, saturationWeighted: 0, luminanceWeighted: 0,
    hueSin: 0, hueCos: 0, sampleCount: 0,
  }]));
  let neutralShare = 0;
  let totalWeight = 0;
  for (const color of palette?.colors ?? []) {
    const weight = clamp(color?.weight, 0, 1);
    const hue = Number(color?.hsl?.h) || 0;
    const saturation = clamp(color?.hsl?.s, 0, 100);
    const luminance = clamp(color?.hsl?.l, 0, 100);
    totalWeight += weight;
    if (saturation < 10) neutralShare += weight;
    const channel = channelForHue(hue);
    const bucket = acc[channel];
    bucket.weight += weight;
    bucket.saturationWeighted += saturation * weight;
    bucket.luminanceWeighted += luminance * weight;
    const radians = hue * Math.PI / 180;
    bucket.hueSin += Math.sin(radians) * weight;
    bucket.hueCos += Math.cos(radians) * weight;
    bucket.sampleCount += 1;
  }

  const channels = {};
  for (const channel of COLOR_MATCH_CHANNELS) {
    const bucket = acc[channel];
    const weight = bucket.weight;
    let meanHue = 0;
    if (weight > 0) {
      meanHue = Math.atan2(bucket.hueSin, bucket.hueCos) * 180 / Math.PI;
      if (meanHue < 0) meanHue += 360;
    }
    channels[channel] = {
      weight: round(weight, 4),
      meanHue: round(meanHue, 2),
      meanSaturation: round(weight > 0 ? bucket.saturationWeighted / weight : 0, 2),
      meanLuminance: round(weight > 0 ? bucket.luminanceWeighted / weight : 0, 2),
      sampleCount: bucket.sampleCount,
    };
  }

  const weightedSaturation = (palette?.colors ?? []).reduce(
    (sum, color) => sum + clamp(color?.hsl?.s, 0, 100) * clamp(color?.weight, 0, 1), 0,
  );
  const weightedLuminance = (palette?.colors ?? []).reduce(
    (sum, color) => sum + clamp(color?.hsl?.l, 0, 100) * clamp(color?.weight, 0, 1), 0,
  );

  return {
    channels,
    totalWeight: round(totalWeight, 4),
    neutralShare: round(neutralShare, 4),
    weightedSaturation: round(weightedSaturation, 2),
    weightedLuminance: round(weightedLuminance, 2),
    dominantChannel: COLOR_MATCH_CHANNELS
      .map(channel => ({ channel, weight: channels[channel].weight }))
      .sort((a, b) => b.weight - a.weight)[0]?.channel ?? 'red',
  };
}

function buildEvidenceQuality({ palette, toneZones, hslAnalysis, skinAnalysis, histogram }) {
  const sources = {
    palette: Boolean(palette?.colors?.length),
    toneZones: Boolean(toneZones?.shadow && toneZones?.midtone && toneZones?.highlight),
    hsl: Boolean(hslAnalysis?.channels),
    skin: Boolean(skinAnalysis),
    histogram: Boolean(histogram),
  };
  const weights = { palette: 0.3, toneZones: 0.35, hsl: 0.15, skin: 0.1, histogram: 0.1 };
  let coverage = 0;
  for (const [key, present] of Object.entries(sources)) if (present) coverage += weights[key];
  const paletteConfidence = clamp(palette?.confidence ?? (sources.palette ? 0.65 : 0), 0, 1);
  const hslConfidence = clamp(hslAnalysis?.confidence ?? (sources.hsl ? 0.6 : 0), 0, 1);
  const skinConfidence = clamp(skinAnalysis?.confidence ?? (sources.skin ? 0.55 : 0), 0, 1);
  const confidence = clamp(
    coverage * 0.55 + paletteConfidence * 0.25 + hslConfidence * 0.12 + skinConfidence * 0.08,
    0,
    1,
  );
  const warningCodes = [];
  if (!sources.palette) warningCodes.push('PALETTE_EVIDENCE_MISSING');
  if (!sources.toneZones) warningCodes.push('TONE_ZONE_EVIDENCE_MISSING');
  if (!sources.hsl) warningCodes.push('HSL_EVIDENCE_PARTIAL');
  if (!sources.skin) warningCodes.push('SKIN_EVIDENCE_UNKNOWN');
  return { sources, coverage: round(coverage, 3), confidence: round(confidence, 3), warningCodes };
}

export function buildColorMatchSignature({
  role,
  palette = null,
  toneZones = null,
  hslAnalysis = null,
  skinAnalysis = null,
  histogram = null,
  styleFingerprint = null,
  analysisGenerationId = null,
} = {}) {
  assertSignatureRole(role);
  if (!palette?.colors?.length || !toneZones?.shadow || !toneZones?.midtone || !toneZones?.highlight) {
    throw new TypeError('Color-match signature requires palette and all three tone zones.');
  }

  const paletteSummary = buildPaletteChannels(palette);
  const evidence = buildEvidenceQuality({ palette, toneZones, hslAnalysis, skinAnalysis, histogram });
  const midtoneLuma = zoneLuma(toneZones.midtone);
  const shadowLuma = zoneLuma(toneZones.shadow);
  const highlightLuma = zoneLuma(toneZones.highlight);
  const tonalSpan = Math.max(0, highlightLuma - shadowLuma);

  return {
    kind: COLOR_MATCH_SIGNATURE_KIND,
    schemaVersion: COLOR_MATCH_SIGNATURE_SCHEMA_VERSION,
    role,
    analysisGenerationId: analysisGenerationId == null ? null : String(analysisGenerationId),
    whiteBalance: {
      warmth: round(weightedZoneAverage(toneZones, 'temperatureHint'), 2),
      tint: round(weightedZoneAverage(toneZones, 'tintHint'), 2),
      zones: {
        shadow: { warmth: round(toneZones.shadow.temperatureHint, 2), tint: round(toneZones.shadow.tintHint, 2) },
        midtone: { warmth: round(toneZones.midtone.temperatureHint, 2), tint: round(toneZones.midtone.tintHint, 2) },
        highlight: { warmth: round(toneZones.highlight.temperatureHint, 2), tint: round(toneZones.highlight.tintHint, 2) },
      },
    },
    tone: {
      shadowLuma: round(shadowLuma, 2),
      midtoneLuma: round(midtoneLuma, 2),
      highlightLuma: round(highlightLuma, 2),
      tonalSpan: round(tonalSpan, 2),
      contrast: round(toneZones.contrast, 2),
      blackPoint: round(toneZones.blackPoint, 2),
      whitePoint: round(toneZones.whitePoint, 2),
      zoneShares: {
        shadow: round(toneZones.shadow.pixelShare, 4),
        midtone: round(toneZones.midtone.pixelShare, 4),
        highlight: round(toneZones.highlight.pixelShare, 4),
      },
    },
    color: paletteSummary,
    skin: {
      evidenceAvailable: Boolean(skinAnalysis),
      detected: Boolean(skinAnalysis?.detected),
      coveragePct: round(skinAnalysis?.coveragePct, 2),
      confidence: round(skinAnalysis?.confidence, 3),
      meanHue: round(skinAnalysis?.avgHue ?? skinAnalysis?.hue, 2),
      meanSaturation: round(skinAnalysis?.avgSat ?? skinAnalysis?.sat, 2),
      meanLuminance: round(skinAnalysis?.avgLum ?? skinAnalysis?.lum, 2),
    },
    style: {
      evidenceAvailable: Boolean(styleFingerprint),
      mood: styleFingerprint?.mood ?? null,
      warmth: styleFingerprint?.warmth ?? null,
      contrastLevel: styleFingerprint?.contrastLevel ?? null,
      harmonyScheme: styleFingerprint?.harmonyScheme ?? null,
      overallConfidence: round(styleFingerprint?.overallConfidence, 3),
    },
    captureRisk: {
      clipHiPct: round(histogram?.clipHiPct ?? styleFingerprint?.clipHiPct, 3),
      clipLoPct: round(histogram?.clipLoPct ?? styleFingerprint?.clipLoPct, 3),
      dynamicRangeStops: round(histogram?.drStops ?? styleFingerprint?.dynamicRangeStops, 2),
    },
    evidence,
  };
}
