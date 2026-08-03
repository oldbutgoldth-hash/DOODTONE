/**
 * core/single-image/color-intelligence/evidence-color-signals.js
 *
 * EPIC 2E-P1E — reads the SAME evidence the rest of the single-image
 * pipeline already produced (session.evidence, populated by
 * core/hsl-analyzer-engine, core/colorgrading-ai-engine,
 * core/calibration-engine, core/skin-classifier + core/skintone-engine
 * (merged into evidence.skin), core/color-cast-detector,
 * core/scene-classifier) and reshapes it into a small, defensive
 * "color signals" object for color-plan-builder.js to consume.
 *
 * This module is PURE and read-only: it never calls a Core analysis
 * function itself, never mutates the evidence object it is given, and
 * never throws -- a missing, soft-failed, or minimally-shaped evidence
 * entry (e.g. the synthetic fixtures used by earlier P1C tests, which
 * only set `{dominant, confidence}` on evidence.hsl) simply yields
 * "no usable signal" for that field family rather than an error.
 * "No usable signal" is the correct, safe default: color-plan-builder
 * treats it as "insufficient evidence to justify a stronger push",
 * never as "assume strong color present".
 */

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  // Only COMPLETED/CACHE_HIT evidence is trustworthy; SOFT_FAILED/
  // FAILED/TIMED_OUT/ABORTED/SKIPPED entries carry no usable `result`
  // by the existing evidence-normalizer contract, but we defensively
  // re-check here rather than trusting that alone.
  const status = entry.status;
  const usable = status === 'COMPLETED' || status === 'CACHE_HIT';
  if (!usable) return null;
  return entry.result ?? null;
}

/**
 * @param {object} evidence  session.evidence (read-only)
 * @returns {object} colorSignals -- always a complete, safely-defaulted shape
 */
export function deriveColorSignals(evidence) {
  const hslResult = _resultOf(evidence, 'hsl');
  const gradingResult = _resultOf(evidence, 'grading');
  const calResult = _resultOf(evidence, 'calibration');
  const skinResult = _resultOf(evidence, 'skin');
  const castResult = _resultOf(evidence, 'colorCast');
  const sceneResult = _resultOf(evidence, 'scene') ?? _resultOf(evidence, 'stats');

  // ── Skin ────────────────────────────────────────────────────────
  const skin = {
    present: typeof skinResult?.detected === 'boolean' ? skinResult.detected : null,
    coveragePct: typeof skinResult?.coveragePct === 'number' ? skinResult.coveragePct : null,
    confidence: typeof skinResult?.confidence === 'number' ? skinResult.confidence : null,
    isFaceCandidate: typeof skinResult?.isFaceCandidate === 'boolean' ? skinResult.isFaceCandidate : null,
  };

  // ── Color cast (whole-image warm/cool/green/magenta tendency) ───
  let castLabel = null; let castStrength = 0;
  if (castResult && typeof castResult === 'object') {
    castLabel = castResult.dominantCast ?? null;
    if (castLabel && castResult[castLabel] && typeof castResult[castLabel].strength === 'number') {
      castStrength = castResult[castLabel].strength;
    } else if (typeof castResult.confidence === 'number') {
      castStrength = castResult.confidence;
    }
  }

  // ── Scene ───────────────────────────────────────────────────────
  const sceneCategory = sceneResult?.category ?? null;
  const sceneConfidence = typeof sceneResult?.confidence === 'number' ? sceneResult.confidence : null;

  // ── HSL per-channel signals ──────────────────────────────────────
  // core/hsl-analyzer-engine already computes a bounded, guardrail-
  // aware per-channel recommendation (hueAdj/satAdj/lumAdj) -- this is
  // the "already-reasoned Core recommendation" P1E treats as its
  // evidence target, never a value P1E invents independently. Only
  // channels with a real `channels` map (the full engine shape, not
  // the minimal synthetic `{dominant, confidence}` fixture shape used
  // by earlier P1C tests) produce a usable per-channel signal.
  const hslChannels = {};
  if (hslResult && hslResult.channels && typeof hslResult.channels === 'object') {
    for (const [ch, data] of Object.entries(hslResult.channels)) {
      if (!data || typeof data !== 'object') continue;
      hslChannels[ch] = {
        coveragePct: typeof data.coveragePct === 'number' ? data.coveragePct : 0,
        hueAdj: typeof data.hueAdj === 'number' ? data.hueAdj : 0,
        satAdj: typeof data.satAdj === 'number' ? data.satAdj : 0,
        lumAdj: typeof data.lumAdj === 'number' ? data.lumAdj : 0,
        dominance: data.dominance ?? null,
      };
    }
  }
  const hslConfidence = typeof hslResult?.confidence === 'number' ? hslResult.confidence : null;

  // ── Color Grading per-zone signals ───────────────────────────────
  // core/colorgrading-ai-engine already selects a scene-appropriate
  // creative "look" and computes per-zone hue/sat/balance -- P1E's
  // evidence target for grading is this already-computed
  // recommendation, gated on the engine's own blended confidence
  // (no per-zone coverage is exposed by this engine's return shape,
  // so the single top-level confidence is the correct, honest gate).
  const gradingZones = {};
  if (gradingResult && typeof gradingResult === 'object') {
    for (const zone of ['shadows', 'midtones', 'highlights']) {
      const z = gradingResult[zone];
      if (!z || typeof z !== 'object') continue;
      gradingZones[zone] = {
        hue: typeof z.hue === 'number' ? z.hue : 0,
        sat: typeof z.sat === 'number' ? z.sat : 0,
        balance: typeof z.balance === 'number' ? z.balance : 0,
      };
    }
  }
  const gradingConfidence = typeof gradingResult?.confidence === 'number' ? gradingResult.confidence : null;
  const lookName = gradingResult?.look ?? null;

  // ── Calibration per-primary signals ──────────────────────────────
  const calPrimaries = {};
  if (calResult && typeof calResult === 'object') {
    for (const prim of ['red', 'green', 'blue']) {
      const p = calResult[prim];
      if (!p || typeof p !== 'object') continue;
      calPrimaries[prim] = {
        coveragePct: typeof p.coveragePct === 'number' ? p.coveragePct : 0,
        hue: typeof p.hue === 'number' ? p.hue : 0,
        sat: typeof p.sat === 'number' ? p.sat : 0,
      };
    }
  }
  const calConfidence = typeof calResult?.confidence === 'number' ? calResult.confidence : null;

  // ── Overall "how much color-grading opportunity does this image
  // genuinely offer" signal -- used to decide how much of the
  // Vibrance/Saturation restoration fraction to spend. Blended from
  // whichever confidences are actually available; never fabricated
  // from nothing.
  const availableConfidences = [hslConfidence, gradingConfidence, calConfidence].filter((c) => typeof c === 'number');
  const overallColorConfidence = availableConfidences.length
    ? availableConfidences.reduce((a, b) => a + b, 0) / availableConfidences.length
    : null;

  return {
    schemaVersion: 'P1E_COLOR_SIGNALS@1',
    skin,
    cast: { label: castLabel, strength: castStrength },
    scene: { category: sceneCategory, confidence: sceneConfidence },
    hsl: { channels: hslChannels, confidence: hslConfidence },
    grading: { zones: gradingZones, confidence: gradingConfidence, look: lookName },
    calibration: { primaries: calPrimaries, confidence: calConfidence },
    overallColorConfidence,
  };
}
