/** EPIC 2E-N1..N5 + 2E-O — Complete candidate Color Match pipeline. */
import { buildCoreColorMatchAnalysis } from './core-color-match-analysis.js';
import { buildPhotographicCompensation } from './photographic-compensation-engine.js';
import { mapCompensationToLightroomCandidate } from './lightroom-candidate-mapper.js';
import { deriveGaussianHslTransfer } from './gaussian-hsl-transfer-engine.js';

export function buildCoreColorMatchPipeline({
  reference,
  target,
  analysisGenerationId = null,
  intensity = 70,
  candidateName,
  protectionOptions = {},
  targetMediaContext = null,
  pixelTransfer = null,
} = {}) {
  const analysis = buildCoreColorMatchAnalysis({ reference, target, analysisGenerationId });
  const compensation = buildPhotographicCompensation({ analysis, intensity, protectionOptions });
  const gaussianHsl = deriveGaussianHslTransfer({
    referencePalette: reference?.palette,
    targetPalette: target?.palette,
    intensity,
    sigma: 25,
  });
  const candidate = mapCompensationToLightroomCandidate({
    compensation,
    name: candidateName,
    targetMediaContext,
    pixelTransfer,
    gaussianHsl,
  });
  return {
    kind: 'LUMIXA_CORE_COLOR_MATCH_PIPELINE',
    schemaVersion: 3,
    stage: '2E_O8_PERCEPTUAL_TRANSFER_CANDIDATE_READY_FOR_ROUNDTRIP',
    analysis,
    compensation,
    transferEvidence: { pixelTransfer, gaussianHsl },
    candidate,
    nextStage: '2E_O_RENDER_REANALYZE_AND_LIGHTROOM_ROUNDTRIP',
    production: {
      productionSource: 'legacy', productionWrite: false, xmpWriteAllowed: false,
      candidateXmpInMemoryOnly: true, productionActivationAllowed: false,
    },
  };
}
