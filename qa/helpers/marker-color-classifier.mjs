/**
 * qa/helpers/marker-color-classifier.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase D: robust marker-color classification.
 *
 * The prior geometry suite compared a sampled canvas pixel directly to a
 * pure reference color (e.g. [255,0,0]) using a single absolute per-
 * channel tolerance (60). Real JPEG compression pushes a nominally-pure
 * red marker patch to something like [171-173, 3-4, 2] -- a channel
 * delta of ~84 on the red channel alone, which exceeds a tolerance of 60
 * and produces a false FAIL even though the patch is unambiguously
 * "red" to the eye and to any reasonable classifier. This is exactly
 * the root cause the independent review flagged: "JPEG marker absolute
 * RGB tolerance is too strict."
 *
 * This module replaces the absolute-distance comparison with a
 * DOMINANCE-based classifier: a channel counts as "the" color only when
 * it is both bright enough on its own (MIN_DOMINANT) AND clearly ahead
 * of the other channels by a fixed margin (DOMINANCE_DELTA) -- which
 * tolerates real compression noise while still rejecting a wrong color,
 * a wrong corner (which would sample a different, non-dominant patch),
 * or a low-saturation gray (which fails the dominance-margin check
 * entirely, since no channel leads by DOMINANCE_DELTA).
 */

const MIN_DOMINANT = 100; // a channel must be reasonably bright to count as "that" color at all
const DOMINANCE_DELTA = 40; // a channel must exceed BOTH other channels by at least this margin
const YELLOW_RG_CLOSENESS = 60; // red and green must be close to each other for "yellow" (both high, blue low)

/**
 * Classifies a single { r, g, b } sample into one of
 * 'red' | 'green' | 'blue' | 'yellow' | 'gray' | 'unknown'.
 * 'gray' is returned for low-saturation / no-clear-dominant-channel
 * samples (including near-black, near-white, and true grays) --
 * deliberately distinct from 'unknown', which covers samples that have
 * SOME dominant channel but don't cleanly match any of the four named
 * marker colors (e.g. cyan/magenta/orange).
 */
export function classifyDominantColor(sample) {
  if (!sample || typeof sample.r !== 'number' || typeof sample.g !== 'number' || typeof sample.b !== 'number') {
    return 'unknown';
  }
  const { r, g, b } = sample;
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const spread = maxChannel - minChannel;

  const isRed = r >= MIN_DOMINANT && (r - g) >= DOMINANCE_DELTA && (r - b) >= DOMINANCE_DELTA;
  const isGreen = g >= MIN_DOMINANT && (g - r) >= DOMINANCE_DELTA && (g - b) >= DOMINANCE_DELTA;
  const isBlue = b >= MIN_DOMINANT && (b - r) >= DOMINANCE_DELTA && (b - g) >= DOMINANCE_DELTA;
  const isYellow = r >= MIN_DOMINANT && g >= MIN_DOMINANT
    && (r - b) >= DOMINANCE_DELTA && (g - b) >= DOMINANCE_DELTA
    && Math.abs(r - g) <= YELLOW_RG_CLOSENESS;

  // Low-saturation gray: no channel meaningfully leads the others.
  // Checked explicitly (not merely "none of the above") so a genuinely
  // ambiguous/washed-out sample is labeled 'gray' rather than 'unknown'
  // -- required by Phase D's hostile self-test "low-saturation gray
  // fails" as its own named, deliberate outcome.
  if (spread < DOMINANCE_DELTA && !isRed && !isGreen && !isBlue && !isYellow) {
    return 'gray';
  }

  if (isRed) return 'red';
  if (isGreen) return 'green';
  if (isBlue) return 'blue';
  if (isYellow) return 'yellow';
  return 'unknown';
}

/**
 * True only when the sample classifies as EXACTLY the expected named
 * color. A wrong color, a wrong corner (sampling a differently-colored
 * or background patch), or a gray/washed-out sample all correctly
 * return false here.
 */
export function matchesExpectedColor(sample, expectedColorName) {
  if (typeof expectedColorName !== 'string' || expectedColorName.length === 0) return false;
  return classifyDominantColor(sample) === expectedColorName;
}

export const MARKER_CLASSIFIER_THRESHOLDS = Object.freeze({
  MIN_DOMINANT,
  DOMINANCE_DELTA,
  YELLOW_RG_CLOSENESS,
});
