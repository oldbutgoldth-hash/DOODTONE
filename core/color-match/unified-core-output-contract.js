/** EPIC 2E-O9 — Unified Core Output Contract. */
export const CORE_ROLES = Object.freeze({
  PRIMARY: 'PRIMARY_ADJUSTMENT',
  EVIDENCE: 'EVIDENCE',
  PROTECTION: 'PROTECTION',
  DECISION: 'DECISION',
});

export const REQUIRED_PRIMARY_MODULES = Object.freeze([
  'whiteBalancePro', 'lightroomBasicPanel', 'toneCurveAI',
  'hslAnalyzerPro', 'colorGradingAI', 'calibrationEngine',
]);

const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));

const ROLE_BY_ID = Object.freeze({
  whiteBalancePro: CORE_ROLES.PRIMARY,
  lightroomBasicPanel: CORE_ROLES.PRIMARY,
  toneCurveAI: CORE_ROLES.PRIMARY,
  hslAnalyzerPro: CORE_ROLES.PRIMARY,
  colorGradingAI: CORE_ROLES.PRIMARY,
  calibrationEngine: CORE_ROLES.PRIMARY,
  imageAnalysisCore: CORE_ROLES.EVIDENCE,
  colourPaletteKMeans: CORE_ROLES.EVIDENCE,
  histogramMetrics: CORE_ROLES.EVIDENCE,
  toneZoneAnalyzer: CORE_ROLES.EVIDENCE,
  colorHarmony: CORE_ROLES.EVIDENCE,
  styleFingerprint: CORE_ROLES.EVIDENCE,
  sceneClassificationAI: CORE_ROLES.EVIDENCE,
  dynamicRangeAnalyzer: CORE_ROLES.EVIDENCE,
  skinToneDetectionPro: CORE_ROLES.PROTECTION,
  neutralWhiteProtection: CORE_ROLES.PROTECTION,
  highlightRecoveryAI: CORE_ROLES.PROTECTION,
  shadowRecoveryAI: CORE_ROLES.PROTECTION,
  xmpValidator: CORE_ROLES.PROTECTION,
  featureFusionEngine: CORE_ROLES.DECISION,
  decisionEngine: CORE_ROLES.DECISION,
});

export function normalizeCoreOutput(moduleId, value, { generationId = null, fallbackRole = null } = {}) {
  const role = value?.role || ROLE_BY_ID[moduleId] || fallbackRole || CORE_ROLES.EVIDENCE;
  const available = value != null && value.available !== false;
  return {
    moduleId,
    role,
    available,
    confidence: available ? clamp01(value?.confidence ?? value?.score ?? 0.5) : 0,
    generationId: value?.generationId ?? generationId,
    evidence: clone(value?.evidence ?? value?.metrics ?? value?.analysis ?? null),
    recommendedAdjustments: clone(value?.recommendedAdjustments ?? value?.adjustments ?? value?.output ?? null),
    constraints: clone(value?.constraints ?? value?.protection ?? null),
    reasonCodes: Array.isArray(value?.reasonCodes) ? [...value.reasonCodes] : [],
    source: value?.source || 'CORE_RUNTIME',
  };
}

export function buildUnifiedCoreMatrix({ reference = {}, target = {}, analysis = null, generationId = null } = {}) {
  const ref = reference.coreOutputs || {};
  const tar = target.coreOutputs || {};
  const ids = new Set([...Object.keys(ROLE_BY_ID), ...Object.keys(ref), ...Object.keys(tar)]);
  const modules = [];
  for (const moduleId of ids) {
    modules.push({
      moduleId,
      role: ROLE_BY_ID[moduleId] || ref[moduleId]?.role || tar[moduleId]?.role || CORE_ROLES.EVIDENCE,
      reference: normalizeCoreOutput(moduleId, ref[moduleId], { generationId }),
      target: normalizeCoreOutput(moduleId, tar[moduleId], { generationId }),
    });
  }
  return {
    kind: 'LUMIXA_UNIFIED_CORE_MATRIX',
    schemaVersion: 1,
    generationId,
    modules,
    analysisEvidence: analysis ? {
      matchNeedScore: analysis.matchNeedScore,
      evidenceConfidence: analysis.evidenceConfidence,
    } : null,
  };
}
