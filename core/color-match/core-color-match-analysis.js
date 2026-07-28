/**
 * EPIC 2E-N1 — Core Color Match Analysis Orchestrator
 *
 * Builds comparable signatures and their semantic delta in one call. The
 * output is intentionally shadow-only: no Lightroom Mapping, no preset
 * serialization, no XMP, and no Production activation.
 */
import { buildColorMatchSignature } from './reference-target-signature-engine.js';
import { compareColorMatchSignatures } from './signature-delta-engine.js';

export function buildCoreColorMatchAnalysis({ reference, target, analysisGenerationId = null } = {}) {
  const referenceSignature = buildColorMatchSignature({
    role: 'REFERENCE', analysisGenerationId,
    ...(reference ?? {}),
  });
  const targetSignature = buildColorMatchSignature({
    role: 'TARGET', analysisGenerationId,
    ...(target ?? {}),
  });
  const delta = compareColorMatchSignatures({ referenceSignature, targetSignature });
  return {
    kind: 'LUMIXA_CORE_COLOR_MATCH_ANALYSIS',
    schemaVersion: 1,
    stage: 'N1_SIGNATURE_DELTA_FOUNDATION',
    referenceSignature,
    targetSignature,
    delta,
    nextStage: 'N2_PHOTOGRAPHIC_COMPENSATION',
    production: {
      productionSource: 'legacy',
      productionWrite: false,
      xmpWriteAllowed: false,
      lightroomMappingAllowed: false,
    },
  };
}
