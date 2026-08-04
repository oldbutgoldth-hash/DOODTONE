# P1H — White Balance Plan Schema, Mapped to Real Repo Contracts

The spec's requested schema, adapted to this repo's real evidence
shapes (see `core/single-image/white-balance-intelligence/white-balance-schema.js`):

```
{
  schemaVersion: '1.0.0',
  status: 'OK' | 'DEGRADED' | 'NO_EVIDENCE',
  strengthMode: 'CONSERVATIVE' | 'BALANCED' | 'CORRECTIVE',
  confidence: 0-1,
  confidenceTier: 'high' | 'moderate' | 'low',
  evidence: {
    source, rawTemperature, rawTint,
    neutralReferenceConfidence, skinConsistencyConfidence, estimatorAgreement,
    shadowCastLabel, highlightCastLabel, bgObjectColorRisk, mixedLightingRisk,
    _raw: { castLabel, moodPreservation, wbIntent, centerLabel, borderLabel,
            bgGreenDominant, subjectNeutral, skinCoveragePct },
  },
  classification: {
    primaryCast: one of the 10 CAST_CLASS values,
    flags: [CAST_CLASS, ...],
    isIntentional: boolean,
    mixedLightDetected: boolean,
    objectColorBiasScore: 0-1,
  },
  correction: { temperature, tint },   // pre-final-clamp planned correction
  protections: {
    neutralReferenceTrusted, skinValidationApplied,
    objectColorBiasGuard, mixedLightGuard, intentionalLightPreserved,
  },
  finalValues: { temperature, tint },  // === correction (no further transform)
  lineage: { sourceEngines, rawReading, confidenceTier, strengthMode,
             neutralReference, objectColorBias, mixedLight, skinValidation,
             classification, correction, finalValues },
  diagnostics: { engaged, reasons: [...], warnings: [...], mixedLightMessage: {th,en}|null },
}
```

## Deviations from the spec's literal field list, and why

- The spec lists 9 evidence fields; this repo's real evidence sources
  (whitebalance-engine's `wbIntent`, color-cast-detector's per-zone
  labels) map onto exactly those 9 conceptually, but under names that
  match THIS repo's existing vocabulary (`bgObjectColorRisk` rather
  than a generic "objectBiasRisk", `estimatorAgreement` reusing the
  engine's own `confidence` field rather than re-deriving a spread
  metric) — reuse-first, per project convention.
- `correction` and `finalValues` are identical in this implementation
  (no separate "pre-guardrail" vs "post-guardrail" split beyond what
  the guard multipliers already apply) — simpler than the spec's
  implied two-stage model, but equally traceable via `lineage`.
