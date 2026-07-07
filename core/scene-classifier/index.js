/**
 * core/scene-classifier/index.js
 *
 * Multi-feature scene classification.
 * Replaces the single-metric (skinPct) classifier in histogram-engine.
 *
 * Features used:
 *  - skinPct + isFaceCandidate (from skin-classifier)
 *  - hue spread (narrow = portrait, wide = landscape/travel)
 *  - luminance zone distribution
 *  - saturation profile
 *  - channel dominance (blue sky, green vegetation, neutral)
 *
 * Returns category with confidence so decision-engine can calibrate
 * guardrail strength proportionally.
 */

import { clamp } from '../color-engine/index.js';

// Category confidence thresholds — below this, treat as 'General'
const MIN_CONFIDENCE = 0.45;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SceneResult
 * @property {string}  category     Portrait|Wedding|Landscape|Travel|General
 * @property {number}  confidence   0-1
 * @property {string}  categoryRaw  from histogram-engine (for comparison/debug)
 * @property {object}  features     intermediate feature values
 */

/**
 * @param {object} stats    from histogram-engine
 * @param {object} skin     from skin-classifier
 * @returns {SceneResult}
 */
export function classifyScene(stats, skin) {
  const feats = _extract(stats, skin);
  return _decide(feats, stats.category);
}

// ─── Feature extraction ───────────────────────────────────────────────────────

function _extract(stats, skin) {
  const histL = stats.histL;
  const total = stats.total ?? 1;

  // Luminance zone masses
  let shadowMass=0, midMass=0, highlightMass=0;
  for (let i=0;   i<=80;  i++) shadowMass    += histL[i] ?? 0;
  for (let i=81;  i<=175; i++) midMass        += histL[i] ?? 0;
  for (let i=176; i<256;  i++) highlightMass  += histL[i] ?? 0;
  const shadowPct    = shadowMass    / total;
  const midPct       = midMass       / total;
  const highlightPct = highlightMass / total;

  // Channel dominance (are R, G, or B channels notably elevated?)
  const avgR = stats.avgR ?? 128;
  const avgG = stats.avgG ?? 128;
  const avgB = stats.avgB ?? 128;
  const avgAll = (avgR + avgG + avgB) / 3;
  const blueDominance  = (avgB - avgAll) / Math.max(1, avgAll);  // + = blue heavy
  const greenDominance = (avgG - avgAll) / Math.max(1, avgAll);  // + = green heavy

  // Saturation level
  const avgSat = (stats.avgSatPct ?? 30) / 100;

  // Skin metrics from classifier
  const skinPct         = skin?.coveragePct ?? skin?.skinPct ?? stats.skinPct ?? 0;
  const skinConfidence  = skin?.confidence  ?? 0.3;
  const isFaceCandidate = skin?.isFaceCandidate ?? (skinPct > 8);
  const clusterRatio    = skin?.clusterRatio    ?? 0.5;
  const effectiveSkin   = isFaceCandidate ? skinPct : skinPct * 0.4;

  // Contrast / dynamic range
  const drStops = stats.drStops ?? 3;

  return {
    skinPct, effectiveSkin, skinConfidence, isFaceCandidate, clusterRatio,
    shadowPct, midPct, highlightPct,
    blueDominance, greenDominance, avgSat, drStops,
    avgR, avgG, avgB,
  };
}

// ─── Decision logic ───────────────────────────────────────────────────────────

function _decide(f, rawCategory) {
  // Score each category 0-1
  const scores = {
    Portrait:  _scorePortrait(f),
    Wedding:   _scoreWedding(f),
    Landscape: _scoreLandscape(f),
    Travel:    _scoreTravel(f),
    General:   0.30,             // baseline — always possible
  };

  // Normalise
  const entries = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const best = entries[0];
  const runner = entries[1];

  let category = best[0];
  let confidence = best[1];

  // If top two are close and neither is Portrait, fall back to General
  const margin = best[1] - runner[1];
  if (margin < 0.10 && category !== 'Portrait' && category !== 'Landscape') {
    category   = 'General';
    confidence = 0.40;
  }

  // Minimum confidence gate
  if (confidence < MIN_CONFIDENCE) {
    category   = 'General';
    confidence = 0.35;
  }

  const sceneWarnings = [];
  if (confidence < MIN_CONFIDENCE)
    sceneWarnings.push(`Classification confidence below threshold (${(confidence*100).toFixed(0)}%) — falling back to General`);
  if (rawCategory !== category)
    sceneWarnings.push(`Scene overridden: histogram said '${rawCategory}', multi-feature says '${category}'`);
  if (margin < 0.05)
    sceneWarnings.push('Top two categories are very close — scene is ambiguous');
  if (f.effectiveSkin > 0 && !f.isFaceCandidate)
    sceneWarnings.push('Skin detected but not clustered as face — may be warm-toned objects or scattered skin');

  return {
    category,
    confidence: +confidence.toFixed(3),
    categoryRaw: rawCategory,
    features: f,
    scores,
    // Phase 1
    warnings: sceneWarnings,
    reason: `Scores: ${Object.entries(scores).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${(v*100).toFixed(0)}%`).join(', ')}`,
  };
}

// ─── Category scorers ─────────────────────────────────────────────────────────

function _scorePortrait(f) {
  let score = 0;
  // Strong skin presence + face candidate pattern
  if (f.effectiveSkin > 15 && f.isFaceCandidate)  score += 0.40;
  else if (f.effectiveSkin > 8 && f.isFaceCandidate) score += 0.25;
  // Skin confidence multiplier
  score *= (0.5 + f.skinConfidence * 0.5);
  // Supportive: moderate highlights (catchlights, bright skin)
  if (f.highlightPct > 0.08 && f.highlightPct < 0.35) score += 0.10;
  // Supportive: not heavily blue-dominant (outdoor portrait can be)
  if (f.blueDominance < 0.05) score += 0.05;
  // Penalty: high green dominance (more likely landscape)
  if (f.greenDominance > 0.08) score -= 0.15;
  // Penalty: skin spread all over image (false positive)
  if (f.clusterRatio > 0.65)   score -= 0.20;
  return clamp(score, 0, 1);
}

function _scoreWedding(f) {
  let score = 0;
  // Moderate skin (people present) but not dominant
  if (f.effectiveSkin > 4 && f.effectiveSkin < 20) score += 0.20;
  // High highlights: white dress, bright venue
  if (f.highlightPct > 0.15) score += 0.20;
  // Relatively low saturation overall (white/neutral tones)
  if (f.avgSat < 0.35) score += 0.15;
  // Not heavily coloured backgrounds
  if (Math.abs(f.greenDominance) < 0.05 && Math.abs(f.blueDominance) < 0.05) score += 0.10;
  // Penalty: heavy skin without face clustering → product/food
  if (f.effectiveSkin > 20 && !f.isFaceCandidate) score -= 0.15;
  return clamp(score, 0, 1);
}

function _scoreLandscape(f) {
  let score = 0;
  // High saturation
  if (f.avgSat > 0.38) score += 0.30;
  // Green or blue dominant (vegetation, sky)
  if (f.greenDominance > 0.03) score += 0.20;
  if (f.blueDominance  > 0.04) score += 0.15;
  // Wide dynamic range
  if (f.drStops > 5) score += 0.10;
  // Low shadow mass (bright outdoor) OR high shadow (moody landscape)
  if (f.shadowPct < 0.12 || f.highlightPct < 0.10) score += 0.05;
  // Penalty: significant clustered skin → probably not landscape
  if (f.effectiveSkin > 8 && f.isFaceCandidate) score -= 0.25;
  return clamp(score, 0, 1);
}

function _scoreTravel(f) {
  let score = 0.20;  // base — travel is diverse
  // Moderate saturation (not extreme)
  if (f.avgSat > 0.25 && f.avgSat < 0.55) score += 0.15;
  // Some but not dominant skin
  if (f.effectiveSkin > 2 && f.effectiveSkin < 15) score += 0.10;
  // Balanced luminance zones
  const balance = Math.abs(f.highlightPct - f.shadowPct);
  if (balance < 0.15) score += 0.10;
  // No strong colour dominance
  if (Math.abs(f.greenDominance) < 0.08 && Math.abs(f.blueDominance) < 0.08) score += 0.05;
  return clamp(score, 0, 1);
}
