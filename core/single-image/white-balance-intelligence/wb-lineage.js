/**
 * core/single-image/white-balance-intelligence/wb-lineage.js
 *
 * EPIC 2E-P1H — explainability lineage for the White Balance Plan,
 * mirroring core/single-image/detail-intelligence/detail-lineage.js's
 * shape/conventions so candidate-lineage.js's existing consumers need
 * no special-casing.
 */

export function buildWBLineage({ evidence, classification, mixedLight, objectBias, skinValidation, neutralConfidence, correction, finalValues, confidenceTier, strengthMode }) {
  return {
    sourceEngines: ['core/whitebalance-engine/index.js', 'core/color-cast-detector/index.js'],
    rawReading: { temperature: evidence?.rawTemperature ?? null, tint: evidence?.rawTint ?? null },
    confidenceTier, strengthMode,
    neutralReference: neutralConfidence ?? null,
    objectColorBias: objectBias ?? null,
    mixedLight: mixedLight ? { isMixedLight: mixedLight.isMixedLight, score: mixedLight.score } : null,
    skinValidation: skinValidation ?? null,
    classification,
    correction, finalValues,
  };
}
