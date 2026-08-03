/**
 * core/single-image/basic-tone-intelligence/highlight-shadow-recovery.js
 *
 * EPIC 2E-P1F — Highlight and Shadow recovery, gated on REAL clipping
 * evidence (histogram-engine clipHiPct/clipLoPct) first, with a small
 * additional scene-class structural component for HIGH_DYNAMIC_RANGE
 * and UNDEREXPOSED/OVEREXPOSED. Crucially, real clipping evidence
 * always triggers SOME recovery regardless of scene class -- data
 * loss protection takes priority over style preservation, matching
 * core/basic-panel-engine's own "protect against genuine technical
 * data loss" convention -- so even a LOW_KEY (intentionally dark)
 * scene still gets Shadow recovery if real shadow clipping is present.
 */

import { clamp } from '../../color-engine/index.js';
import { SCENE_CLASS, BOUNDS } from './basic-tone-schema.js';

export function computeHighlightRecovery({ stats, sceneClass, strengthScalar = 1 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient evidence -- Highlights kept at 0.' };
  }
  const { clipHiPct = 0, confidence = 0.5 } = stats;
  let value = 0;
  let reason = 'Normal highlights, no meaningful clipping risk -- kept near neutral.';

  if (clipHiPct > 5) {
    value = -clamp(Math.round(15 + clipHiPct * 3), 15, -BOUNDS.highlights.lo);
    reason = `${clipHiPct}% highlight clipping -- bounded ${value} recovery to protect detail.`;
  } else if (clipHiPct > 1.5) {
    value = -clamp(Math.round(6 + clipHiPct * 4), 6, 22);
    reason = `Minor highlight clipping (${clipHiPct}%) -- small ${value} recovery nudge.`;
  }

  // Scene-class structural component (added, not a replacement for clip-based recovery).
  if (sceneClass === SCENE_CLASS.OVEREXPOSED) { value -= 8; reason += ' OVEREXPOSED scene -- additional -8 structural pullback.'; }
  else if (sceneClass === SCENE_CLASS.HIGH_DYNAMIC_RANGE) { value -= 6; reason += ' HIGH_DYNAMIC_RANGE scene -- additional -6 to coordinate with Shadows.'; }

  if (confidence < 0.6) { value = Math.round(value * 0.6); reason += ` Low confidence (${confidence}) -- recovery reduced.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.highlights.lo, BOUNDS.highlights.hi);
  return { value, confidence, reason };
}

export function computeShadowRecovery({ stats, sceneClass, strengthScalar = 1 } = {}) {
  if (!stats || sceneClass === SCENE_CLASS.LOW_CONFIDENCE) {
    return { value: 0, confidence: stats?.confidence ?? 0, reason: 'Insufficient evidence -- Shadows kept at 0.' };
  }
  const { clipLoPct = 0, confidence = 0.5 } = stats;
  let value = 0;
  let reason = 'No blocked shadows detected -- kept at 0.';

  if (clipLoPct > 5) {
    value = clamp(Math.round(15 + clipLoPct * 3), 15, BOUNDS.shadows.hi);
    reason = `${clipLoPct}% shadow clipping -- bounded +${value} recovery for detail.`;
  } else if (clipLoPct > 1.5) {
    value = clamp(Math.round(6 + clipLoPct * 4), 6, 18);
    reason = `Minor shadow clipping (${clipLoPct}%) -- small +${value} recovery nudge.`;
  }

  // Structural component -- only for genuinely accidental dark scenes /
  // HDR coordination, never for an intentionally dark LOW_KEY scene
  // (which still gets the clip-based recovery above if real clipping
  // exists, but no extra "lift for its own sake").
  if (sceneClass === SCENE_CLASS.UNDEREXPOSED) { value += 10; reason += ' UNDEREXPOSED scene -- additional +10 structural recovery.'; }
  else if (sceneClass === SCENE_CLASS.HIGH_DYNAMIC_RANGE) { value += 12; reason += ' HIGH_DYNAMIC_RANGE scene -- additional +12 to coordinate with Highlights.'; }

  // Noisy/low-confidence shadows limit recovery -- lifting shadows in a
  // noisy, uncertain measurement risks revealing sensor noise.
  if (confidence < 0.6) { value = Math.round(value * 0.5); reason += ` Low confidence (${confidence}) -- recovery limited to protect against noise.`; }

  value = clamp(Math.round(value * strengthScalar), BOUNDS.shadows.lo, BOUNDS.shadows.hi);
  return { value, confidence, reason };
}
